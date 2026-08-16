/**
 * Auf welcher Zeiteinheit soll eine Rangliste laufen?
 *
 * Der Nutzer hat es so festgelegt: auf DER, auf der die erfolgreichen Tests
 * dieser Strategie liefen. Also nicht raten und nicht fest verdrahten, sondern
 * aus dem ableiten, was tatsächlich gemessen wurde — und den Grund dazusagen.
 *
 * Vier Stufen, von der stärksten Aussage zur schwächsten:
 *
 *   1. ÜBERNOMMEN   Ein Backtest, den der Nutzer ausdrücklich angenommen hat.
 *                   Eine getroffene Entscheidung schlägt jede Statistik.
 *   2. BESTANDEN    Läufe mit mindestens 30 Trades und positivem Erwartungswert.
 *   3. INSTANZ      Läuft genau eine Zeiteinheit im Papierbetrieb, ist sie es.
 *                   Bei mehreren wird NICHT entschieden — fünf LSOB-Instanzen
 *                   auf fünf Zeiteinheiten sagen über die beste nichts aus.
 *   4. NICHTS       Kein Vorschlag. Ehrlicher als ein geratener.
 *
 * Vorgeschaltet ist eine Sperre für Zeiteinheiten, die im gewählten Zeitraum
 * gar nicht rechenbar sind — sonst gewinnt eine Stufe eine Zeiteinheit, an der
 * anschliessend jeder einzelne Coin scheitert.
 *
 * Backtests und Instanzen werden EINGESPEIST, nicht selbst geholt: so ist die
 * Ableitung ohne Datenbank prüfbar (dasselbe Muster wie `backtest` in
 * `walkForward`).
 */

import { getStrategy } from './strategies/index.js'
import { schaetzeKerzen, MAX_BACKTEST_CANDLES, MIN_TRADES_BELASTBAR } from './strategy-backtest.js'

/**
 * Wie viele Kerzen soll eine Hälfte mindestens messen, damit überhaupt eine
 * belastbare Zahl herauskommen kann?
 *
 * Das ist bewusst KEINE Sperre, sondern ein Hinweis. Mechanisch läuft auch eine
 * Hälfte mit 90 Kerzen durch — sie wird nur nie die 30 Trades erreichen, ab
 * denen das Projekt eine Zahl belastbar nennt. Der Nutzer soll das vorher
 * wissen und trotzdem dürfen.
 */
const KNAPP_AB_KERZEN = 500

/** Stats eines gespeicherten Laufs — mal Objekt, mal JSON-Text aus der DB. */
function alsStats(roh) {
    if (!roh) return {}
    if (typeof roh === 'object') return roh
    try { return JSON.parse(roh) || {} } catch { return {} }
}

/**
 * Hätte dieser Lauf als belastbar gegolten?
 *
 * BEWUSST selbst gerechnet statt `stats.belastbar` zu lesen: das Feld kam erst
 * später dazu, und im Altbestand hat es fast keine Zeile (am 16.08.2026: eine
 * von 25). Ein Filter darauf hätte für jede Strategie leer geliefert — und die
 * Ableitung wäre still auf die schwächste Stufe gefallen, ohne dass jemand den
 * Grund gesehen hätte.
 */
function hatBestanden(stats) {
    return (Number(stats.trades) || 0) >= MIN_TRADES_BELASTBAR
        && (Number(stats.expectancyR) || 0) > 0
}

function median(werte) {
    if (!werte.length) return 0
    const s = [...werte].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
}

/** Menschliche Schreibweise für eine Kerzenzahl. */
const zahl = (n) => Number(n).toLocaleString('de-CH')

/**
 * @param {string} strategyId
 * @param {object} ctx
 * @param {number} ctx.fromTs      Beginn des Rangliste-Zeitraums
 * @param {number} ctx.toTs        Ende
 * @param {Array}  [ctx.backtests] Zeilen aus `strategy_backtests` dieser Strategie
 * @param {Array}  [ctx.instanzen] Zeilen aus `strategy_instances` dieser Strategie
 * @returns {{timeframe, quelle, begruendung, kandidaten, gesperrt, knapp}}
 */
export function leiteZeiteinheitAb(strategyId, { fromTs, toTs, backtests = [], instanzen = [] } = {}) {
    const strategie = getStrategy(strategyId)
    if (!strategie) {
        return {
            timeframe: '', quelle: 'unbekannt', kandidaten: [], gesperrt: [], knapp: [],
            begruendung: `Unbekannte Strategie: ${strategyId}`,
        }
    }

    const von = Number(fromTs) || 0
    const bis = Number(toTs) || 0
    const mitte = Math.floor((von + bis) / 2)
    const warmup = strategie.warmupCandles || 200
    const unterstuetzt = strategie.supportedTimeframes || []

    // ── Stufe 0: was ist überhaupt rechenbar? ────────────────────────────
    //
    // Zwei echte Ausschlussgründe — beide mechanisch, nicht geschmacklich:
    //
    //  (a) Die ganze Reihe inklusive Vorlauf passt nicht in einen Abruf.
    //      `getHistoricalCandles` deckelt bei `MAX_BACKTEST_CANDLES` und
    //      schneidet dann hinten ab — der Lauf würde stillschweigend einen
    //      kürzeren Zeitraum messen als bestellt. (5m über 180 Tage: 51 840.)
    //
    //  (b) Eine Hälfte hat so wenige Kerzen, dass `runBacktest` sofort
    //      umkehrt. Weil beide Hälften ihren vollen Vorlauf mitbekommen,
    //      greift das erst bei zehn Kerzen — nicht schon bei `warmup`, wie
    //      man ohne den Vorlauf-Kunstgriff annehmen würde.
    const gesperrt = []
    const knapp = []
    const offen = []
    for (const tf of unterstuetzt) {
        const gesamtKerzen = schaetzeKerzen(von, bis, tf)
        const halbeKerzen = schaetzeKerzen(von, mitte, tf)
        if (!gesamtKerzen) continue

        if (gesamtKerzen + warmup > MAX_BACKTEST_CANDLES) {
            gesperrt.push({ timeframe: tf, grund: 'zu_viele_kerzen',
                text: `${zahl(gesamtKerzen)} Kerzen plus ${zahl(warmup)} Vorlauf — erlaubt sind ${zahl(MAX_BACKTEST_CANDLES)}` })
            continue
        }
        if (halbeKerzen <= 10) {
            gesperrt.push({ timeframe: tf, grund: 'haelfte_zu_kurz',
                text: `eine Hälfte hätte nur ${zahl(halbeKerzen)} Kerzen` })
            continue
        }
        offen.push(tf)
        if (halbeKerzen < KNAPP_AB_KERZEN) {
            knapp.push({ timeframe: tf, kerzen: halbeKerzen,
                text: `je Hälfte nur ${zahl(halbeKerzen)} Kerzen — ${MIN_TRADES_BELASTBAR} Trades je Coin sind damit unwahrscheinlich` })
        }
    }

    const nurOffen = (tf) => offen.includes(tf)
    const gesperrtText = gesperrt.length
        ? ' ' + gesperrt.map((g) => `${g.timeframe} ist gesperrt (${g.text}).`).join(' ')
        : ''

    if (!offen.length) {
        return {
            timeframe: '', quelle: 'nichts', kandidaten: [], gesperrt, knapp,
            begruendung: `Keine Zeiteinheit von ${strategie.name} ist in diesem Zeitraum rechenbar.${gesperrtText}`,
        }
    }

    // ── Stufe 1: ausdrücklich übernommen ─────────────────────────────────
    const uebernommen = {}
    for (const b of backtests) {
        if (b.entscheidung !== 'uebernommen' || !nurOffen(b.timeframe)) continue
        uebernommen[b.timeframe] = (uebernommen[b.timeframe] || 0) + 1
    }
    const besteUebernommen = Object.entries(uebernommen).sort((a, b) => b[1] - a[1])[0]
    if (besteUebernommen) {
        return {
            timeframe: besteUebernommen[0], quelle: 'uebernommen', kandidaten: offen, gesperrt, knapp,
            begruendung: `${besteUebernommen[0]} — du hast ${besteUebernommen[1]} Backtest(s) auf dieser `
                + `Zeiteinheit ausdrücklich übernommen.${gesperrtText}`,
        }
    }

    // ── Stufe 2: was bestanden hätte ─────────────────────────────────────
    const je = {}
    for (const b of backtests) {
        if (!b.timeframe) continue
        const s = alsStats(b.stats)
        je[b.timeframe] = je[b.timeframe] || { gesamt: 0, bestanden: 0, eR: [] }
        je[b.timeframe].gesamt++
        if (hatBestanden(s)) {
            je[b.timeframe].bestanden++
            je[b.timeframe].eR.push(Number(s.expectancyR))
        }
    }
    const bewerber = Object.entries(je)
        .filter(([tf, v]) => v.bestanden > 0 && nurOffen(tf))
        .map(([tf, v]) => ({ tf, ...v, medianR: median(v.eR) }))
        // meiste bestandene Läufe, dann höherer Median, dann kleinere Zeiteinheit
        .sort((a, b) => b.bestanden - a.bestanden
            || b.medianR - a.medianR
            || unterstuetzt.indexOf(a.tf) - unterstuetzt.indexOf(b.tf))

    if (bewerber.length) {
        const s = bewerber[0]
        // Die unterlegenen Zeiteinheiten gehören in den Satz: „1h gewinnt" ist
        // nur dann eine Aussage, wenn dabeisteht, wogegen.
        const andere = Object.entries(je)
            .filter(([tf]) => tf !== s.tf && nurOffen(tf))
            .map(([tf, v]) => v.bestanden
                ? `${tf} hatte ${v.bestanden} von ${v.gesamt}`
                : `${tf} hatte ${v.gesamt} ${v.gesamt === 1 ? 'Lauf' : 'Läufe'}, keinen davon mit `
                    + `${MIN_TRADES_BELASTBAR} Trades und positivem Erwartungswert`)
        return {
            timeframe: s.tf, quelle: 'bestanden', kandidaten: offen, gesperrt, knapp,
            begruendung: `${s.tf} — aus ${s.bestanden} von ${s.gesamt} gespeicherten Läufen dieser Strategie `
                + `mit mindestens ${MIN_TRADES_BELASTBAR} Trades und positivem Erwartungswert `
                + `(Median ${s.medianR.toFixed(2)} R).`
                + (andere.length ? ` ${andere.join('. ')}.` : '')
                + gesperrtText,
        }
    }

    // ── Stufe 3: laufende Instanzen ──────────────────────────────────────
    const ausInstanzen = new Set()
    for (const i of instanzen) {
        for (const tf of [i.timeframe, ...(Array.isArray(i.timeframes) ? i.timeframes : [])]) {
            if (tf && nurOffen(tf)) ausInstanzen.add(tf)
        }
    }
    if (ausInstanzen.size === 1) {
        const tf = [...ausInstanzen][0]
        return {
            timeframe: tf, quelle: 'instanz', kandidaten: offen, gesperrt, knapp,
            begruendung: `${tf} — es gibt keine aussagekräftigen Backtests, aber genau eine `
                + `Zeiteinheit läuft im Papierbetrieb.${gesperrtText}`,
        }
    }
    if (ausInstanzen.size > 1) {
        const liste = [...ausInstanzen]
        return {
            timeframe: '', quelle: 'nichts', kandidaten: liste, gesperrt, knapp,
            begruendung: `Keine Empfehlung: es gibt keine aussagekräftigen Backtests, und im `
                + `Papierbetrieb laufen ${liste.length} Zeiteinheiten nebeneinander `
                + `(${liste.join(', ')}). Welche davon besser ist, sagt das nicht.${gesperrtText}`,
        }
    }

    // ── Stufe 4: nichts ──────────────────────────────────────────────────
    return {
        timeframe: '', quelle: 'nichts', kandidaten: offen, gesperrt, knapp,
        begruendung: `Keine Empfehlung: für ${strategie.name} gibt es weder einen übernommenen `
            + `noch einen aussagekräftigen Backtest und keine laufende Instanz.${gesperrtText}`,
    }
}
