/**
 * Ein Coin innerhalb eines Rangliste-Laufs — der rechnende Kern.
 *
 * ── Der Kunstgriff: ein Abruf, zwei Hälften ──
 *
 * Die Rangliste teilt den Zeitraum: die erste Hälfte bestimmt den Rang, die
 * zweite prüft ihn auf Daten, die bei der Auswahl niemand gesehen hat. Zwei
 * getrennte Backtests wären zwei Netzwege je Coin — bei 100 Coins also doppelt
 * so viele Binance-Abrufe wie nötig.
 *
 * `runBacktest` ruft aber gar nichts ab, wenn man ihm fertige Kerzen mitgibt.
 * Also wird EINMAL die ganze Reihe geholt und beiden Hälften als Ausschnitt
 * gereicht — jede mit ihrem eigenen Vorlauf davor:
 *
 *      |<-- Vorlauf -->|<----- Hälfte A ----->|<----- Hälfte B ----->|
 *                      |<-- Vorlauf -->|
 *
 * Das ist nicht nur billiger, es ist auch richtiger. Ohne den eigenen Vorlauf
 * für Hälfte B frässe `warmupCandles` deren Anfang auf: bei LSOB (300 Kerzen
 * Vorlauf) und 4 h über 180 Tage blieben von 90 gemessenen Tagen nur 40 übrig,
 * und auf der Tageskerze bliebe gar nichts — jeder Coin meldete „zu wenige
 * Kerzen".
 *
 * ── Was hier NICHT aus `stats` gelesen wird ──
 *
 * Die Abdeckung. `pruefeAbdeckung` teilt vorhandene durch erwartete Kerzen —
 * und die Vorlaufkerzen zählen mit, sobald man ihr einen Ausschnitt mit Vorlauf
 * gibt. Sie stünde also auf 100 %, während vorne Wochen fehlen. Deshalb wird
 * sie hier EINMAL je Coin auf der Reihe OHNE Vorlauf gerechnet.
 *
 * `backtest` und `holeKerzen` sind einspeisbar (Muster wie `walkForward`) —
 * sonst wäre dieser Kern nur mit Netzverbindung prüfbar.
 */

import { runBacktest, pruefeAbdeckung, MIN_TRADES_BELASTBAR, MAX_BACKTEST_CANDLES } from './strategy-backtest.js'
import { getHistoricalCandles, timeframeMs } from './market-data.js'
import { getStrategy } from './strategies/index.js'

/** Wie viele R-Werte je Coin aufgehoben werden (Grundlage der Nullverteilung). */
const R_REIHE_MAX = 300

/**
 * Sicherheitszuschlag auf den Vorlauf beim Abruf.
 * Börsen haben Lücken; ohne Puffer kämen bei einem löchrigen Symbol weniger
 * Kerzen zurück als gerechnet, und der Vorlauf wäre stillschweigend zu kurz.
 */
const VORLAUF_PUFFER = 20

/** Kennzahlen einer Hälfte in die flache Zeilenform bringen. */
function haelfteAlsFelder(stats, praefix) {
    const s = stats || {}
    return {
        [`${praefix}Trades`]: Number(s.trades) || 0,
        [`${praefix}WinRate`]: Number(s.winRate) || 0,
        [`${praefix}ExpectancyR`]: Number(s.expectancyR) || 0,
        [`${praefix}OhneTopR`]: Number(s.expectancyROhneTop) || 0,
        [`${praefix}ProfitFactor`]: s.profitFactor === null || s.profitFactor === undefined
            ? null : Number(s.profitFactor),
        [`${praefix}ReturnPct`]: Number(s.returnPct) || 0,
        [`${praefix}MaxDdPct`]: Number(s.maxDrawdownPct) || 0,
    }
}

/** Abgeschlossene R-Werte eines Laufs — die Zwangsbewertung am Ende zählt nicht. */
function rWerte(ergebnis) {
    return (ergebnis?.trades || [])
        .filter((t) => t.exitReason !== 'open_at_end')
        .map((t) => Number(t.rMultiple))
        .filter((v) => Number.isFinite(v))
        .slice(0, R_REIHE_MAX)
}

/**
 * Einen Coin durchrechnen.
 *
 * @param {object} lauf   Zeile aus `rangliste_laeufe` (aufgelöst: params/risk als Objekt)
 * @param {string} symbol
 * @param {object} [werkzeug] `{ backtest, holeKerzen }` — nur zum Prüfen
 * @returns {object} Zeile für `rangliste_zeilen` (ohne `laufId`)
 */
export async function bearbeiteCoin(lauf, symbol, werkzeug = {}) {
    const backtest = werkzeug.backtest || runBacktest
    const holeKerzen = werkzeug.holeKerzen || getHistoricalCandles
    const begonnen = Date.now()

    const strategie = getStrategy(lauf.strategyId)
    if (!strategie) return { symbol, klasse: 'fehler', fehler: `Unbekannte Strategie: ${lauf.strategyId}` }

    const tf = lauf.timeframe
    const tfMs = timeframeMs(tf)
    if (!tfMs) return { symbol, klasse: 'fehler', fehler: `Ungültige Zeiteinheit: ${tf}` }

    const warmup = strategie.warmupCandles || 200
    const von = Number(lauf.fromTs)
    const mitte = Number(lauf.mitteTs)
    const bis = Number(lauf.toTs)
    const market = lauf.market === 'spot' ? 'spot' : 'futures'

    // ── 1. Ein Abruf, weit genug zurück für den Vorlauf ──────────────────
    let kerzen
    try {
        kerzen = await holeKerzen(symbol, tf, von - (warmup + VORLAUF_PUFFER) * tfMs, bis, {
            market,
            // Vorlauf gehört zum Deckel dazu, sonst schneidet der Abruf hinten
            // ab und der jüngste — interessanteste — Teil fehlt.
            maxCandles: MAX_BACKTEST_CANDLES + warmup + VORLAUF_PUFFER,
        })
    } catch (e) {
        return { symbol, klasse: 'fehler', fehler: String(e?.message || e).slice(0, 300),
                 dauerMs: Date.now() - begonnen }
    }
    if (!Array.isArray(kerzen) || !kerzen.length) {
        return { symbol, klasse: 'ohne_daten', kerzen: 0, dauerMs: Date.now() - begonnen }
    }

    // ── 2. Die drei Marken in der Reihe finden ───────────────────────────
    const iStart = kerzen.findIndex((k) => k.t >= von)
    let iMitte = kerzen.findIndex((k) => k.t >= mitte)
    if (iMitte === -1) iMitte = kerzen.length          // alles liegt vor der Mitte
    if (iStart === -1) {
        return { symbol, klasse: 'ohne_daten', kerzen: kerzen.length, dauerMs: Date.now() - begonnen }
    }

    // ── 3. Abdeckung EINMAL, ohne Vorlauf ────────────────────────────────
    const imZeitraum = kerzen.slice(iStart)
    const abdeckung = pruefeAbdeckung(imZeitraum, von, bis, tf)

    // Weniger als eine Handvoll Kerzen im Zeitraum: da ist nichts zu messen.
    if (imZeitraum.length <= 10) {
        return {
            symbol, klasse: 'ohne_daten',
            kerzen: imZeitraum.length,
            abdeckungPct: abdeckung.prozent,
            historieAb: kerzen[0].t,
            dauerMs: Date.now() - begonnen,
        }
    }

    // ── 4. Beide Hälften mit eigenem Vorlauf ─────────────────────────────
    const haelfteA = kerzen.slice(Math.max(0, iStart - warmup), iMitte)
    const haelfteB = kerzen.slice(Math.max(0, iMitte - warmup))

    const gemeinsam = {
        strategyId: lauf.strategyId,
        params: lauf.params || {},
        risk: lauf.risk || {},
        symbol, timeframe: tf, market,
        startEquity: Number(lauf.startEquity) || 1000,
        maxLeverage: Number(lauf.maxLeverage) || 0,
    }

    let ergA
    let ergB
    try {
        // `fromTs`/`toTs` passen zur jeweiligen Hälfte — sie steuern zwar nicht
        // mehr den Abruf, aber die Abdeckungsrechnung innerhalb von runBacktest.
        ergA = await backtest({ ...gemeinsam, candles: haelfteA, fromTs: von, toTs: mitte })
        ergB = haelfteB.length > warmup + 10
            ? await backtest({ ...gemeinsam, candles: haelfteB, fromTs: mitte, toTs: bis })
            : { stats: {}, trades: [] }
    } catch (e) {
        return { symbol, klasse: 'fehler', fehler: String(e?.message || e).slice(0, 300),
                 kerzen: imZeitraum.length, dauerMs: Date.now() - begonnen }
    }

    const aTrades = Number(ergA.stats?.trades) || 0
    const bTrades = Number(ergB.stats?.trades) || 0

    // ── 5. Einordnen statt filtern ───────────────────────────────────────
    //
    // Ein Coin fällt nie unter den Tisch: er bekommt eine Klasse und steht
    // damit entweder in der Rangliste oder sichtbar darunter. Etwas
    // wegzulassen wäre eine Behauptung über seine Bedeutungslosigkeit.
    let klasse
    if (abdeckung.vollstaendig === false) klasse = 'datenluecke'
    else if (aTrades < MIN_TRADES_BELASTBAR) klasse = 'zu_wenig_trades'
    else klasse = 'belastbar'

    const bOhneTop = Number(ergB.stats?.expectancyROhneTop) || 0

    return {
        symbol,
        klasse,
        ...haelfteAlsFelder(ergA.stats, 'a'),
        ...haelfteAlsFelder(ergB.stats, 'b'),
        // Die Prüfhälfte bestätigt nur, wenn sie selbst etwas zu sagen hat.
        // Ein positives Ergebnis aus vier Trades ist keine Bestätigung.
        bestaetigt: bOhneTop > 0 && bTrades >= MIN_TRADES_BELASTBAR ? 1 : 0,
        kerzen: imZeitraum.length,
        abdeckungPct: abdeckung.prozent,
        fehlend: abdeckung.fehlend || [],
        historieAb: kerzen[0].t,
        rReiheA: rWerte(ergA),
        dauerMs: Date.now() - begonnen,
    }
}

/**
 * Wie viele Binance-Abrufe kostet ein Lauf voraussichtlich?
 * Steht VOR dem Start in der Oberfläche — ein Lauf, der zwölf Minuten dauert,
 * soll das vorher sagen und nicht hinterher.
 */
export function schaetzeAufwand({ strategyId, timeframe, fromTs, toTs, anzahlCoins }) {
    const strategie = getStrategy(strategyId)
    const tfMs = timeframeMs(timeframe)
    if (!strategie || !tfMs) return { kerzenJeCoin: 0, abrufe: 0, gewicht: 0, sekunden: 0 }

    const warmup = strategie.warmupCandles || 200
    const kerzenJeCoin = Math.ceil((Number(toTs) - Number(fromTs)) / tfMs) + warmup + VORLAUF_PUFFER
    // Futures liefert 1500 Kerzen je Abruf; jeder kostet 10 Gewicht.
    const seitenJeCoin = Math.max(1, Math.ceil(kerzenJeCoin / 1500))
    const abrufe = seitenJeCoin * (Number(anzahlCoins) || 0)
    return {
        kerzenJeCoin,
        abrufe,
        gewicht: abrufe * 10,
        // Grob: die Bremse lässt 100 Abrufe je Minute durch, dazu die Rechenzeit
        // von etwa 26 µs je Kerze und Hälfte.
        sekunden: Math.round(abrufe * 0.6 + (kerzenJeCoin * (Number(anzahlCoins) || 0) * 2 * 26) / 1e6),
    }
}
