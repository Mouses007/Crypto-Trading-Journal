/**
 * EMA Touch — Sniper-Einstieg an der EMA50 nach ununterbrochener Korrektur.
 *
 * Regelwerk aus dem Referenz-PDF (Kryptomano, „GUSS Sniperentry"):
 *
 *   1. Neues höheres Hoch mit klarer Aufwärtsdynamik
 *   2. Der Kurs steht dabei deutlich über der EMA21 — überdehnt
 *   3. Es folgt eine Korrektur »in einem Guss« zur EMA50:
 *      KEINE einzige bullische Kerze darf dazwischenkommen
 *   4. Berührt der Kurs die EMA50, ist das der Einstieg
 *   5. Optional bestätigt durch ein Fibonacci-Level nahe der EMA50
 *   6. Erstes Ziel ist die EMA21, Stop unter dem Korrekturtief
 *
 * Die namensgebende Bedingung ist Punkt 3. Eine einzige grüne Kerze macht das
 * Setup ungültig — das ist ein sehr scharfer Filter, der wenige, dafür saubere
 * Signale liefert. Genau das lässt sich im Trichter der Auswertung ablesen.
 *
 * ── Was das Dokument NICHT festlegt ──
 * »Deutlich über der EMA21« ist nirgends quantifiziert, ebenso wenig die
 * Fibonacci-Messstrecke, die Nähe-Toleranz und die Dauer der Korrektur. Diese
 * Werte sind hier Parameter mit weitem Bereich; welcher trägt, entscheidet der
 * Backtest — nicht eine geratene Zahl im Code.
 *
 * ── Bewusst nicht umgesetzt ──
 * Das Dokument beschreibt einen Teilausstieg (25 % an der EMA21, Rest laufen
 * lassen) und ein Nachkaufen an der EMA50 in tieferen Korrekturen. Beides
 * braucht Teilpositionen, die die Ausführungsschicht nicht kennt — sie führt
 * eine Position je Symbol mit einem Stop und einem Ziel. Ebenso fehlt der
 * nachgezogene Ausstieg »Schlusskurs unter der EMA21«: dafür müsste der
 * Fill-Simulator Indikatoren kennen. Statt einen Modus anzubieten, der etwas
 * anderes tut als sein Name verspricht, gibt es hier nur die beiden
 * umsetzbaren Varianten (vollständiger Ausstieg an der EMA21 oder festes RR).
 *
 * Die Timeframe-Ausweichregel (bei bullischer Kerze eine Zeiteinheit höher
 * gehen) wird über MEHRERE INSTANZEN abgebildet, nicht hier drin: eine Instanz
 * fährt genau eine Zeiteinheit.
 *
 * detect() ist eine REINE Funktion: keine DB, kein Netz, kein Date.now().
 */

import { pivotHighs, pivotLows, ema, isBull } from './indicators.js'

export const DETECTOR_VERSION = 1

/** Abbruchgründe. Die Auswertung gruppiert danach — Codes stabil halten. */
export const INVALID_REASONS = {
    BULLISH_CANDLE: 'bullish_candle_in_correction',
    CORRECTION_TIMEOUT: 'correction_timeout',
    EMA_CROSS: 'ema_cross_negative',
    PRICE_BELOW_EMA50: 'price_below_ema50',
    EMA200_FILTER: 'ema200_filter_violated',
    NO_OVEREXTENSION: 'no_overextension',
    NO_HIGHER_HIGH: 'no_higher_high',
    NO_UPTREND: 'no_uptrend',
    NO_FIB_CONFLUENCE: 'no_fib_confluence',
}

const params = [
    // ── Trendbestimmung ───────────────────────────────────────
    { key: 'emaFast', type: 'integer', default: 21, min: 5, max: 50, step: 1, group: 'trend' },
    { key: 'emaEntry', type: 'integer', default: 50, min: 20, max: 100, step: 1, group: 'trend' },
    { key: 'useEma200Filter', type: 'boolean', default: false, group: 'trend' },
    { key: 'emaSlow', type: 'integer', default: 200, min: 100, max: 300, step: 10, group: 'trend' },

    // ── Impuls & Überdehnung ──────────────────────────────────
    { key: 'minOverextensionPct', type: 'number', default: 2.5, min: 0.1, max: 15, step: 0.1, group: 'impulse' },
    { key: 'swingLookback', type: 'integer', default: 10, min: 2, max: 50, step: 1, group: 'impulse' },
    { key: 'swingConfirmBars', type: 'integer', default: 2, min: 1, max: 20, step: 1, group: 'impulse' },
    { key: 'scanWindowCandles', type: 'integer', default: 200, min: 30, max: 1000, step: 10, group: 'impulse' },

    // ── Korrektur ─────────────────────────────────────────────
    { key: 'maxCorrectionCandles', type: 'integer', default: 10, min: 2, max: 50, step: 1, group: 'correction' },
    // Ein Doji (Close == Open) gilt nicht als bullische Kerze. Bei sehr kleinen
    // Körpern ist die Farbe reines Rauschen — dieser Wert erlaubt es, solche
    // Kerzen zu tolerieren, gemessen als Körper in % der Kerzenspanne.
    { key: 'bullishToleranceBodyPct', type: 'number', default: 0, min: 0, max: 50, step: 1, group: 'correction' },

    // ── Fibonacci-Bestätigung ─────────────────────────────────
    { key: 'requireFib', type: 'boolean', default: false, group: 'fib' },
    { key: 'fib0500', type: 'boolean', default: true, group: 'fib' },
    { key: 'fib0559', type: 'boolean', default: true, group: 'fib' },
    { key: 'fib0618', type: 'boolean', default: true, group: 'fib' },
    { key: 'fib0667', type: 'boolean', default: true, group: 'fib' },
    { key: 'fib0786', type: 'boolean', default: true, group: 'fib' },
    { key: 'fibTolerancePct', type: 'number', default: 0.5, min: 0.05, max: 3, step: 0.05, group: 'fib' },

    // ── Ausstieg ──────────────────────────────────────────────
    { key: 'slBufferPct', type: 'number', default: 0.2, min: 0.01, max: 3, step: 0.01, group: 'exit' },
    {
        key: 'exitMode', type: 'select', default: 'ema21', group: 'exit',
        options: [{ value: 'ema21', labelKey: 'strategies.ema_touch.exitEma21' },
                  { value: 'rr', labelKey: 'strategies.ema_touch.exitRr' }],
    },
    { key: 'tpRR', type: 'number', default: 3, min: 0.5, max: 15, step: 0.5, group: 'exit' },
    { key: 'minRR', type: 'number', default: 0, min: 0, max: 10, step: 0.1, group: 'exit' },
    { key: 'breakEvenAtR', type: 'number', default: 1, min: 0, max: 10, step: 0.1, group: 'exit' },
    { key: 'maxHoldCandles', type: 'integer', default: 0, min: 0, max: 2000, step: 1, group: 'exit' },
]

const paramGroups = [
    { id: 'trend', labelKey: 'strategies.groups.trend' },
    { id: 'impulse', labelKey: 'strategies.groups.impulse' },
    { id: 'correction', labelKey: 'strategies.groups.correction' },
    { id: 'fib', labelKey: 'strategies.groups.fib' },
    { id: 'exit', labelKey: 'strategies.groups.exit' },
]

// ── Hilfsfunktionen ──────────────────────────────────────────────────────

/**
 * Gilt die Kerze als bullisch im Sinne der Guss-Bedingung?
 *
 * Ein Doji (Close == Open) zählt ausdrücklich NICHT als bullisch — das
 * Dokument spricht von einer bullischen Kerze, nicht von „nicht bärisch".
 * Über `bullishToleranceBodyPct` lassen sich zusätzlich Kerzen mit winzigem
 * grünem Körper durchgehen lassen, deren Farbe kaum Aussagekraft hat.
 */
function giltAlsBullisch(k, toleranzPct) {
    if (k.c <= k.o) return false
    if (toleranzPct <= 0) return true
    const spanne = k.h - k.l
    if (spanne <= 0) return true
    return ((k.c - k.o) / spanne) * 100 > toleranzPct
}

/** Aktive Fibonacci-Level laut Parametern. */
function aktiveFibLevel(p) {
    const level = []
    if (p.fib0500) level.push(0.5)
    if (p.fib0559) level.push(0.559)
    if (p.fib0618) level.push(0.618)
    if (p.fib0667) level.push(0.667)
    if (p.fib0786) level.push(0.786)
    return level
}

/**
 * Liegt die EMA50 nahe genug an einem aktiven Fibonacci-Level?
 * Gemessen wird vom letzten Pivot-Tief VOR dem Impuls bis zum höheren Hoch.
 */
function fibTrifft(emaWert, tief, hoch, p, kurs) {
    if (!(hoch > tief) || !(kurs > 0)) return { ok: false, level: null }
    for (const r of aktiveFibLevel(p)) {
        const preis = hoch - (hoch - tief) * r
        if ((Math.abs(emaWert - preis) / kurs) * 100 <= p.fibTolerancePct) {
            return { ok: true, level: r, preis }
        }
    }
    return { ok: false, level: null }
}

/** Ziel je Ausstiegsmodus. `ema21` schnappt den EMA21-Wert der Einstiegskerze. */
function berechneZiel(p, entry, stopLoss, emaFastWert) {
    if (p.exitMode === 'rr') {
        return entry + (entry - stopLoss) * p.tpRR
    }
    // 'ema21': erstes Ziel laut Dokument. Liegt die EMA21 unter dem Einstieg
    // (kann bei sehr flachen Korrekturen vorkommen), ist sie kein Ziel.
    return emaFastWert > entry ? emaFastWert : 0
}

// ── detect ───────────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {Array}  input.candles          geschlossene Kerzen, aufsteigend
 * @param {object} input.params           validierte Parameter
 * @param {Array}  input.openSetups       laufende Setups mit id
 * @param {Array}  [input.knownSetupKeys] ALLE bekannten `${direction}|${obCandleTime}`
 *   im Scan-Fenster — statusunabhängig, sonst entsteht dasselbe Setup in jedem
 *   Takt neu (siehe die entsprechende Warnung in lsob.js).
 *
 * @returns {{ setups: Array, events: Array, diagnostics: object }}
 */
function detect({ candles, params: p, openSetups = [], knownSetupKeys = [] }) {
    const setups = []
    const events = []
    const diagnostics = { sweepsFound: 0, setupsCreated: 0, rejected: {}, rejections: [] }

    const reject = (reason, key) => {
        diagnostics.rejected[reason] = (diagnostics.rejected[reason] || 0) + 1
        diagnostics.rejections.push({ reason, key })
    }

    const mindestens = Math.max(p.emaEntry, p.useEma200Filter ? p.emaSlow : 0)
        + p.swingLookback + p.swingConfirmBars + 5
    if (!Array.isArray(candles) || candles.length < mindestens) {
        return { setups, events, diagnostics }
    }

    const emaFast = ema(candles, p.emaFast)
    const emaEntry = ema(candles, p.emaEntry)
    const emaSlow = p.useEma200Filter ? ema(candles, p.emaSlow) : []

    const hochs = pivotHighs(candles, p.swingLookback, p.swingConfirmBars)
    const tiefs = pivotLows(candles, p.swingLookback, p.swingConfirmBars)

    const bekannt = new Set(knownSetupKeys)
    for (const s of openSetups) bekannt.add(`${s.direction}|${s.obCandleTime}`)

    // ══ Phase A: neue Setups ══════════════════════════════════════════════
    const scanAb = Math.max(0, candles.length - p.scanWindowCandles)

    for (let n = 1; n < hochs.length; n++) {
        const pivot = hochs[n]
        const vorher = hochs[n - 1]
        if (pivot.index < scanAb) continue

        const key = `long|${candles[pivot.index].t}`
        if (bekannt.has(key)) continue

        const f = emaFast[pivot.index]
        const e = emaEntry[pivot.index]
        if (f === null || e === null) continue

        diagnostics.sweepsFound++

        // (1) Höheres Hoch — ohne Vergleichspunkt gibt es keinen Impuls
        if (!(pivot.price > vorher.price)) { reject(INVALID_REASONS.NO_HIGHER_HIGH, key); continue }

        // (2) Aufwärtstrend: die schnelle EMA muss über der Einstiegs-EMA liegen
        if (!(f > e)) { reject(INVALID_REASONS.NO_UPTREND, key); continue }

        // (3) Überdehnung über der schnellen EMA
        const ueberdehnung = ((pivot.price - f) / f) * 100
        if (ueberdehnung < p.minOverextensionPct) { reject(INVALID_REASONS.NO_OVEREXTENSION, key); continue }

        // Letztes Pivot-Tief VOR dem Impuls — Startpunkt der Fibonacci-Strecke
        const tiefDavor = [...tiefs].reverse().find((t) => t.index < pivot.index) || null

        bekannt.add(key)
        setups.push({
            direction: 'long',
            status: 'waiting_retest',
            sweepLevel: vorher.price,          // das überbotene frühere Hoch
            sweepPrice: pivot.price,           // das neue höhere Hoch
            sweepCandleTime: candles[pivot.index].t,
            // Zone zwischen Einstiegs-EMA und schneller EMA — das ist der
            // Bereich, in dem die Korrektur landen soll (für den Chart).
            obHigh: f,
            obLow: e,
            obCandleTime: candles[pivot.index].t,
            impulseExtreme: tiefDavor ? tiefDavor.price : pivot.price,
            entry: e,
            stopLoss: 0,
            takeProfit: 0,
            rr: 0,
            confirmations: { overextensionPct: Number(ueberdehnung.toFixed(2)) },
            detectorVersion: DETECTOR_VERSION,
            // Die Korrektur beginnt mit der Kerze nach dem Hoch
            watchFrom: candles[pivot.index].t,
        })
        diagnostics.setupsCreated++
    }

    // ══ Phase B: laufende Setups ══════════════════════════════════════════
    for (const s of openSetups) {
        if (s.status !== 'waiting_retest' && s.status !== 'armed') continue

        const ab = Number(s.watchFrom || s.obCandleTime) || 0
        const start = candles.findIndex((c) => c.t > ab)
        if (start === -1) continue

        let gewartet = 0
        let korrekturTief = Infinity
        let erledigt = false

        for (let i = start; i < candles.length && !erledigt; i++) {
            const k = candles[i]
            const f = emaFast[i]
            const e = emaEntry[i]
            if (f === null || e === null) continue

            gewartet++
            if (k.l < korrekturTief) korrekturTief = k.l

            // (a) Die Guss-Bedingung: eine einzige bullische Kerze beendet alles
            if (giltAlsBullisch(k, p.bullishToleranceBodyPct)) {
                events.push({ id: s.id, status: 'invalidated', invalidReason: INVALID_REASONS.BULLISH_CANDLE, candleTime: k.t })
                erledigt = true; break
            }

            // (b) Trend gebrochen
            if (f < e) {
                events.push({ id: s.id, status: 'invalidated', invalidReason: INVALID_REASONS.EMA_CROSS, candleTime: k.t })
                erledigt = true; break
            }

            // (c) Optionaler Filter der langsamen EMA
            if (p.useEma200Filter) {
                const l = emaSlow[i]
                if (l !== null && l !== undefined && (k.c < l || e < l)) {
                    events.push({ id: s.id, status: 'invalidated', invalidReason: INVALID_REASONS.EMA200_FILTER, candleTime: k.t })
                    erledigt = true; break
                }
            }

            // (d) Die ganze Kerze liegt unter der Einstiegs-EMA — der Kurs ist
            //     daran vorbeigesprungen, ein Einstieg dort war nie möglich.
            if (k.h < e) {
                events.push({ id: s.id, status: 'invalidated', invalidReason: INVALID_REASONS.PRICE_BELOW_EMA50, candleTime: k.t })
                erledigt = true; break
            }

            // (e) Berührung der Einstiegs-EMA → Einstieg
            if (k.l <= e) {
                if (p.requireFib) {
                    const treffer = fibTrifft(e, s.impulseExtreme, s.sweepPrice, p, k.c)
                    if (!treffer.ok) {
                        events.push({ id: s.id, status: 'invalidated', invalidReason: INVALID_REASONS.NO_FIB_CONFLUENCE, candleTime: k.t })
                        erledigt = true; break
                    }
                }

                const tief = Math.min(korrekturTief, k.l)
                const stopLoss = tief * (1 - p.slBufferPct / 100)
                const entry = e
                if (!(stopLoss < entry)) {
                    events.push({ id: s.id, status: 'invalidated', invalidReason: INVALID_REASONS.PRICE_BELOW_EMA50, candleTime: k.t })
                    erledigt = true; break
                }

                const takeProfit = berechneZiel(p, entry, stopLoss, f)
                const rr = takeProfit > 0 ? (takeProfit - entry) / (entry - stopLoss) : 0
                if (p.minRR > 0 && takeProfit > 0 && rr < p.minRR) {
                    events.push({ id: s.id, status: 'rejected', invalidReason: 'below_min_rr', candleTime: k.t })
                    erledigt = true; break
                }

                const conf = { ...(s.confirmations || {}) }
                if (p.requireFib) {
                    const treffer = fibTrifft(e, s.impulseExtreme, s.sweepPrice, p, k.c)
                    conf.fib = treffer.level
                }
                conf.correctionCandles = gewartet

                events.push({
                    id: s.id, status: 'triggered', triggeredAt: k.t, candleTime: k.t,
                    entry, stopLoss, takeProfit, rr, confirmations: conf,
                })
                erledigt = true
                break
            }

            // (f) Zu lange gewartet
            if (gewartet > p.maxCorrectionCandles) {
                events.push({ id: s.id, status: 'expired', invalidReason: INVALID_REASONS.CORRECTION_TIMEOUT, candleTime: k.t })
                erledigt = true; break
            }
        }
    }

    return { setups, events, diagnostics }
}

export default {
    id: 'ema_touch',
    name: 'EMA Touch',
    description: 'Höheres Hoch weit über der EMA21, danach Korrektur ohne eine einzige bullische Kerze bis zur EMA50 — dort der Einstieg.',
    version: DETECTOR_VERSION,
    supportedTimeframes: ['5m', '15m', '30m', '1h', '4h', '1d'],
    warmupCandles: 300,
    params,
    paramGroups,
    detect,
}
