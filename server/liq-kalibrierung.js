/**
 * Gemessene Hebelverteilung aus den eigenen Liquidations-Aufzeichnungen.
 *
 * Die Liquidationskarte gewichtet ihre Hebelstufen mit `levMapWeights` —
 * bis zur Kalibrierung geratene 40/30/20/10. Die Aufzeichnung
 * (`live_recordings`, kind 'liq') enthält aber zehntausende ECHTE
 * Liquidationen, und aus jeder lässt sich der Einstieg je Hebel-Hypothese
 * exakt zurückrechnen (Inversion von `shared/liquidation.js`). Welche
 * Hypothese plausibel ist, entscheidet eine falsifizierbare Frage: wurde der
 * implizierte Einstiegspreis im Rückblick überhaupt gehandelt — und wie viel
 * offenes Interesse entstand dort?
 *
 * Bewusst KEINE Distanz-zum-Referenzpreis-Heuristik: jeder „Referenz-
 * Einstieg" (lokales Extrem, VWAP) wäre eine zweite Schätzung mit eigener
 * Willkür, deren Fehler sich multiplizieren.
 *
 * Bekannte, dokumentierte Verzerrungen:
 *  - Der Binance-`@forceOrder`-Strom ist gedrosselt (max. ~1 Event/s/Symbol,
 *    nur das grösste) — die Verteilung ist eine STICHPROBE. Das Notional-
 *    Gewicht mildert das nur teilweise.
 *  - Bybit ('liqB') bleibt bewusst draussen: dessen `p` ist der Bankruptcy-
 *    Preis, nicht der Liquidationspreis — für eine Preis-Inversion ein
 *    systematischer Versatz.
 *  - Cross-Margin und Nachschuss machen einzelne Events unerklärbar; die
 *    landen im Topf `unerklaert` und werden ausgewiesen statt verteilt.
 *
 * `schaetzeHebelVerteilung` ist pure (kein Netz, keine DB) und über
 * `server/__selftest-liq-kalibrierung.mjs` getestet; die Route darunter
 * besorgt Events, Kerzen und Margin-Daten und cached das Ergebnis einen Tag
 * in `market_snapshots` (kind `levkal:SYMBOL`).
 */

import axios from 'axios'
import { hebelHaltbar } from '../shared/liquidation.js'
import { leseLiquidationen } from './live-recorder.js'
import { holeMarginRate, MMR_VORGABE } from './margin-rates.js'
import { notiereGewicht, melde429, warteAufGewicht } from './binance-takt.js'
import { getKnex } from './database.js'
import { logWarn } from './logger.js'

const HTTP_TIMEOUT = 12000
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/
const FENSTER_TAGE = 14
const MIN_EVENTS = 200
const KERZEN_INTERVALL_MS = 5 * 60 * 1000

/** Erste Einfügeposition, deren Wert >= ziel ist (Kerzen sind aufsteigend). */
function untereGrenze(zeiten, ziel) {
    let lo = 0
    let hi = zeiten.length
    while (lo < hi) {
        const mitte = (lo + hi) >> 1
        if (zeiten[mitte] < ziel) lo = mitte + 1
        else hi = mitte
    }
    return lo
}

/**
 * Kern der Kalibrierung — pure.
 *
 * @param {Array<{t:number, price:number, qty:number, isBuy:boolean}>} events
 *        aufgezeichnete Liquidationen; `isBuy: true` = SHORT liquidiert
 *        (Projekt-Konvention, siehe live-recorder.js)
 * @param {Array<{t:number, l:number, h:number, add:number}>} kerzen
 *        aufsteigend; `add` = max(0, ΔOI) der Kerze, 0 wenn unbekannt
 * @param {object} opts
 * @param {number[]} [opts.tiers]     nominale Hebelstufen
 * @param {number}   [opts.mmr]      Wartungsmarge als BRUCH
 * @param {number}   [opts.maxHebel] echter Max-Hebel des Symbols (klemmt)
 * @param {number}   [opts.rueckblickMs] wie weit vor dem Event Einstiege zählen
 * @returns {{gewichte: Object<string, number>|null, unerklaertPct: number,
 *            anzahl: number, stufen: number[]}}
 *          `gewichte` je NOMINALER Stufe, Summe 1 (ohne die unerklärten)
 */
export function schaetzeHebelVerteilung(events, kerzen, opts = {}) {
    const {
        tiers = [10, 25, 50, 100], mmr = MMR_VORGABE, maxHebel = 0,
        rueckblickMs = 48 * 60 * 60 * 1000,
    } = opts

    // Stufen klemmen wie im Kartenmodell (effektiveStufen in
    // src/utils/leverageMap.js — hier lokal, der Server importiert nicht aus
    // src/): kollabierte und unhaltbare Stufen existieren beim Symbol nicht.
    const deckel = Number(maxHebel) > 1 ? Number(maxHebel) : 0
    const belegt = new Set()
    const stufen = []
    for (const L of tiers) {
        const effektiv = deckel ? Math.min(L, deckel) : L
        if (belegt.has(effektiv) || !hebelHaltbar(effektiv, mmr)) continue
        belegt.add(effektiv)
        stufen.push({ nominal: L, effektiv })
    }

    const leer = {
        gewichte: null, unerklaertPct: 0, anzahl: events.length,
        stufen: stufen.map(s => s.nominal),
    }
    if (!stufen.length || !events.length || !kerzen.length) return leer

    // Notional-Klipp am p99: ein einzelner Wal darf die Verteilung nicht
    // allein setzen.
    const notionale = events.map(e => (e.price * e.qty) || 0).sort((a, b) => a - b)
    const p99 = notionale[Math.min(notionale.length - 1, Math.floor(notionale.length * 0.99))] || 1

    const zeiten = kerzen.map(k => k.t)
    const summeJeStufe = new Map(stufen.map(s => [s.nominal, 0]))
    let unerklaert = 0
    let gesamt = 0

    for (const e of events) {
        const notional = (e.price * e.qty) || 0
        const gewicht = notional > 0 ? Math.min(notional, p99) : 1
        gesamt += gewicht

        const start = untereGrenze(zeiten, e.t - rueckblickMs)

        // Score je Hypothese: ΔOI-Summe der Kerzen, deren Spanne den
        // implizierten Einstieg enthält; daneben die blosse Trefferzahl als
        // Rückfallebene für Fenster ohne OI-Daten.
        const oiScores = new Array(stufen.length).fill(0)
        const trefferScores = new Array(stufen.length).fill(0)
        for (let s = 0; s < stufen.length; s++) {
            const L = stufen[s].effektiv
            // Inversion von liqPreisLong/liqPreisShort (shared/liquidation.js)
            const entry = e.isBuy
                ? e.price * (1 + mmr) / (1 + 1 / L)   // SHORT liquidiert
                : e.price * (1 - mmr) / (1 - 1 / L)   // LONG liquidiert
            for (let i = start; i < kerzen.length && kerzen[i].t < e.t; i++) {
                const k = kerzen[i]
                if (entry >= k.l && entry <= k.h) {
                    trefferScores[s]++
                    if (k.add > 0) oiScores[s] += k.add
                }
            }
        }

        const oiSumme = oiScores.reduce((a, b) => a + b, 0)
        const trefferSumme = trefferScores.reduce((a, b) => a + b, 0)
        const scores = oiSumme > 0 ? oiScores : trefferScores
        const summe = oiSumme > 0 ? oiSumme : trefferSumme
        if (summe <= 0) {
            // Kein implizierter Einstieg wurde je gehandelt — Cross-Margin,
            // Nachschuss oder ein Hebel ausserhalb der Stufen.
            unerklaert += gewicht
            continue
        }
        // FRAKTIONALE Zuordnung: ein Event, dessen 25x- und 50x-Einstieg
        // beide gehandelt wurden, zählt anteilig für beide — ehrlicher als
        // ein argmax, der Scheinpräzision vortäuschte.
        for (let s = 0; s < stufen.length; s++) {
            if (scores[s] > 0) {
                summeJeStufe.set(stufen[s].nominal,
                    summeJeStufe.get(stufen[s].nominal) + gewicht * (scores[s] / summe))
            }
        }
    }

    const erklaert = gesamt - unerklaert
    if (erklaert <= 0) return { ...leer, unerklaertPct: 100 }

    const gewichte = {}
    for (const s of stufen) {
        gewichte[s.nominal] = summeJeStufe.get(s.nominal) / erklaert
    }
    return {
        gewichte,
        unerklaertPct: Math.round((unerklaert / gesamt) * 1000) / 10,
        anzahl: events.length,
        stufen: stufen.map(s => s.nominal),
    }
}

// ── Datenbeschaffung + Route ────────────────────────────────────────────

/** Kerzen (5m) über das ganze Fenster holen — 1500er-Seiten, ~3 Abrufe. */
async function holeKerzen(symbol, vonMs, bisMs) {
    const kerzen = []
    let start = vonMs
    while (start < bisMs) {
        await warteAufGewicht(10)
        const res = await axios.get('https://fapi.binance.com/fapi/v1/klines', {
            params: { symbol, interval: '5m', startTime: start, endTime: bisMs, limit: 1500 },
            timeout: HTTP_TIMEOUT,
        })
        notiereGewicht(res.headers)
        const seite = Array.isArray(res.data) ? res.data : []
        if (!seite.length) break
        for (const k of seite) {
            kerzen.push({ t: Number(k[0]), l: +k[3], h: +k[2], add: 0 })
        }
        const letzte = Number(seite[seite.length - 1][0])
        if (letzte <= start) break
        start = letzte + KERZEN_INTERVALL_MS
        if (seite.length < 1500) break
    }
    return kerzen
}

/**
 * ΔOI an die Kerzen heften. `openInterestHist` reicht nur ~41 h zurück
 * (500 × 5m) — ältere Kerzen behalten add = 0 und die Kalibrierung fällt
 * dort auf die Trefferzahl zurück. Der Zeitstempel der Historie ist das
 * PERIODEN-ENDE, die Kerze trägt ihre Öffnungszeit (siehe binance-api.js,
 * empirisch verifiziert 14.08.2026).
 */
async function heftOiAnKerzen(symbol, kerzen) {
    try {
        await warteAufGewicht(1)
        const res = await axios.get('https://fapi.binance.com/futures/data/openInterestHist', {
            params: { symbol, period: '5m', limit: 500 }, timeout: HTTP_TIMEOUT,
        })
        notiereGewicht(res.headers)
        const hist = Array.isArray(res.data) ? res.data : []
        const nachOpenTime = new Map(kerzen.map(k => [k.t, k]))
        for (let i = 1; i < hist.length; i++) {
            const delta = Number(hist[i].sumOpenInterest) - Number(hist[i - 1].sumOpenInterest)
            if (!(delta > 0)) continue
            const kerze = nachOpenTime.get(Number(hist[i].timestamp) - KERZEN_INTERVALL_MS)
            if (kerze) kerze.add = delta
        }
    } catch (fehler) {
        const status = fehler.response?.status
        if (status === 429 || status === 418) melde429(status, fehler.response?.headers)
        // ΔOI ist Verfeinerung, nicht Voraussetzung — ohne läuft der
        // Treffer-Rückfall.
        logWarn('liq-kalibrierung', `OI-Historie ${symbol}: ${fehler.message}`)
    }
}

const laufend = new Map()   // symbol -> Promise, gegen Doppelrechnung

async function berechneFuerSymbol(symbol) {
    const bis = Date.now()
    const von = bis - FENSTER_TAGE * 24 * 60 * 60 * 1000

    const events = await leseLiquidationen(symbol, von, bis)
    if (events.length < MIN_EVENTS) {
        return {
            symbol, anzahl: events.length, gewichte: null,
            hinweis: `nur ${events.length} aufgezeichnete Liquidationen in ${FENSTER_TAGE} Tagen — zu wenige für eine Verteilung (mind. ${MIN_EVENTS})`,
        }
    }

    const kerzen = await holeKerzen(symbol, von - 48 * 60 * 60 * 1000, bis)
    await heftOiAnKerzen(symbol, kerzen)

    const rate = await holeMarginRate(symbol).catch(() => null)
    const ergebnis = schaetzeHebelVerteilung(events, kerzen, {
        mmr: rate?.mmr > 0 ? rate.mmr : MMR_VORGABE,
        maxHebel: rate?.maxHebel || 0,
    })

    return {
        symbol,
        zeitraum: { von, bis },
        anzahl: ergebnis.anzahl,
        stufen: ergebnis.stufen,
        gewichte: ergebnis.gewichte,
        unerklaertPct: ergebnis.unerklaertPct,
        mmr: rate?.mmr > 0 ? rate.mmr : MMR_VORGABE,
        maxHebel: rate?.maxHebel || 0,
        stand: bis,
    }
}

export function setupLiqKalibrierungRoutes(app) {
    /**
     * GET /api/liq/hebelverteilung?symbol=BTCUSDT[&force=1]
     *
     * On-demand mit Tages-Cache: gerechnet wird nur, wenn jemand die Seite
     * ansieht — kein Takt, keine Kosten im Leerlauf. Der Cache liegt in
     * `market_snapshots` (kind `levkal:SYMBOL`, extra = JSON), damit NAS und
     * dev ihn teilen und ein Neustart ihn nicht verwirft.
     */
    app.get('/api/liq/hebelverteilung', async (req, res) => {
        const symbol = String(req.query.symbol || '').toUpperCase()
        if (!SYMBOL_RE.test(symbol)) {
            return res.status(400).json({ error: 'symbol fehlt oder ist ungültig' })
        }
        try {
            const knex = getKnex()
            const kind = `levkal:${symbol}`
            const heute = Date.UTC(
                new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())

            if (req.query.force !== '1') {
                const zeile = await knex('market_snapshots').where({ kind, dayUnix: heute }).first()
                if (zeile?.extra) {
                    try {
                        res.setHeader('X-Cache', 'HIT')
                        return res.json(JSON.parse(zeile.extra))
                    } catch { /* kaputter Eintrag — neu rechnen */ }
                }
            }

            if (!laufend.has(symbol)) {
                laufend.set(symbol, berechneFuerSymbol(symbol).finally(() => laufend.delete(symbol)))
            }
            const ergebnis = await laufend.get(symbol)

            await knex('market_snapshots')
                .insert({
                    kind, dayUnix: heute, value: ergebnis.anzahl || 0,
                    extra: JSON.stringify(ergebnis), createdAt: Date.now(),
                })
                .onConflict(['kind', 'dayUnix'])
                .merge(['value', 'extra', 'createdAt'])

            res.setHeader('X-Cache', 'MISS')
            res.json(ergebnis)
        } catch (fehler) {
            logWarn('liq-kalibrierung', `${symbol}: ${fehler.message}`)
            res.status(500).json({ error: `Hebelverteilung für ${symbol} nicht berechenbar: ${fehler.message}` })
        }
    })
}
