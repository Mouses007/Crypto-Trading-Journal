/**
 * LSOB — Liquidity Sweep + Order Block.
 *
 * Regelwerk aus den beiden Referenz-PDFs (Claudius Vertesi / Kryptomano):
 *
 *   1. Markantes Swing-Hoch/-Tief mit gesammelter Liquidität
 *   2. Liquidity Sweep: Docht durchbricht das Level, Kerze SCHLIESST zurück
 *   3. Zwei entgegengerichtete Kerzen als Reaktion
 *   4. Order Block: letzte gegenläufige Kerze vor dem Impuls
 *   5. Impuls weg von der Zone (zeigt: die andere Seite ist aktiv geworden)
 *   6. Retest der Zone → Einstieg am Zonenanfang
 *   7. SL knapp jenseits des Sweep-Extrems, TP an der nächsten Liquiditätszone
 *
 * Die wichtigste Feinheit, die man beim Nachbauen leicht falsch macht:
 * beim Retest darf der DOCHT tief in die Zone schneiden (»Kerze schneidet nicht
 * zu tief rein« = gültig), aber ein SCHLUSSKURS jenseits von `maxRetestDepthPct`
 * macht das Setup ungültig (»schliesst zu weit rein«). Docht- und Schluss-
 * prüfung sind deshalb strikt getrennt.
 *
 * detect() ist eine REINE Funktion: keine DB, kein Netz, kein Date.now().
 */

import {
    pivotHighs, pivotLows, rsi, atr, ema, fibLevel,
    isBull, isBear, bodyHigh, bodyLow, range, hasRejectionCandle,
} from './indicators.js'

export const DETECTOR_VERSION = 1

/** Gründe, aus denen ein Setup ungültig wird — 1:1 die Fälle aus PDF 1. */
export const INVALID_REASONS = {
    EQUAL_HIGHS: 'equal_highs_no_sweep',
    CLOSED_TOO_DEEP: 'closed_too_deep',
    ZONE_BROKEN: 'zone_broken',
    ZONE_NOT_REACHED: 'zone_not_reached',
    NEW_SWEEP: 'new_liquidity_sweep',
    NO_OPPOSITE: 'no_opposite_candles',
    NO_IMPULSE: 'no_impulse',
    BAD_ZONE: 'invalid_zone',
}

const params = [
    // ── Struktur ──────────────────────────────────────────────
    { key: 'swingLookback', type: 'integer', default: 5, min: 2, max: 50, step: 1, group: 'structure' },
    { key: 'swingConfirmBars', type: 'integer', default: 2, min: 1, max: 20, step: 1, group: 'structure' },
    { key: 'scanWindowCandles', type: 'integer', default: 200, min: 30, max: 1000, step: 10, group: 'structure' },

    // ── Sweep ─────────────────────────────────────────────────
    { key: 'equalHighTolerancePct', type: 'number', default: 0.05, min: 0, max: 2, step: 0.01, group: 'sweep' },
    { key: 'sweepMinWickPct', type: 'number', default: 15, min: 0, max: 100, step: 1, group: 'sweep' },

    // ── Order Block ───────────────────────────────────────────
    { key: 'oppositeCandles', type: 'integer', default: 2, min: 1, max: 5, step: 1, group: 'orderblock' },
    { key: 'obSearchBack', type: 'integer', default: 3, min: 0, max: 10, step: 1, group: 'orderblock' },
    {
        key: 'obSource', type: 'select', default: 'body', group: 'orderblock',
        options: [{ value: 'body', labelKey: 'strategies.lsob.obSourceBody' },
                  { value: 'wick', labelKey: 'strategies.lsob.obSourceWick' }],
    },
    { key: 'impulseMinAtr', type: 'number', default: 1.0, min: 0, max: 10, step: 0.1, group: 'orderblock' },
    { key: 'impulseMaxCandles', type: 'integer', default: 10, min: 1, max: 50, step: 1, group: 'orderblock' },

    // ── Retest / Einstieg ─────────────────────────────────────
    { key: 'maxRetestDepthPct', type: 'number', default: 25, min: 5, max: 60, step: 1, group: 'entry' },
    { key: 'retestMaxCandles', type: 'integer', default: 40, min: 3, max: 500, step: 1, group: 'entry' },
    {
        key: 'entryMode', type: 'select', default: 'zone_touch', group: 'entry',
        options: [{ value: 'zone_touch', labelKey: 'strategies.lsob.entryZoneTouch' },
                  { value: 'rejection_confirmed', labelKey: 'strategies.lsob.entryRejection' }],
    },

    // ── Bestätigungen (optional) ──────────────────────────────
    { key: 'requireRejectionCandle', type: 'boolean', default: false, group: 'confirm' },
    { key: 'useFib786', type: 'boolean', default: false, group: 'confirm' },
    { key: 'fibLevelValue', type: 'number', default: 0.786, min: 0.1, max: 0.99, step: 0.001, group: 'confirm' },
    { key: 'fibTolerancePct', type: 'number', default: 0.5, min: 0.01, max: 5, step: 0.01, group: 'confirm' },
    { key: 'useRsi', type: 'boolean', default: false, group: 'confirm' },
    { key: 'rsiPeriod', type: 'integer', default: 14, min: 2, max: 100, step: 1, group: 'confirm' },
    { key: 'rsiOversold', type: 'number', default: 35, min: 1, max: 50, step: 1, group: 'confirm' },
    { key: 'rsiOverbought', type: 'number', default: 65, min: 50, max: 99, step: 1, group: 'confirm' },
    { key: 'requireAllConfirmations', type: 'boolean', default: false, group: 'confirm' },
    { key: 'htfTrendFilter', type: 'boolean', default: false, group: 'confirm' },
    {
        key: 'htfTimeframe', type: 'select', default: '4h', group: 'confirm',
        options: ['1h', '4h', '1d', '1w'],
    },
    { key: 'htfEmaPeriod', type: 'integer', default: 50, min: 5, max: 400, step: 1, group: 'confirm' },

    // ── Ausstieg ──────────────────────────────────────────────
    { key: 'slBufferPct', type: 'number', default: 0.1, min: 0, max: 5, step: 0.01, group: 'exit' },
    {
        key: 'tpMode', type: 'select', default: 'lastSwing', group: 'exit',
        options: [{ value: 'lastSwing', labelKey: 'strategies.lsob.tpLastSwing' },
                  { value: 'rr', labelKey: 'strategies.lsob.tpRr' },
                  { value: 'none', labelKey: 'strategies.lsob.tpNone' }],
    },
    { key: 'tpRR', type: 'number', default: 2, min: 0.5, max: 20, step: 0.1, group: 'exit' },
    { key: 'breakEvenAtR', type: 'number', default: 1, min: 0, max: 10, step: 0.1, group: 'exit' },
    // Zeitausstieg. Ohne ihn kann eine Position ohne Ziel (tpMode 'none')
    // unbegrenzt laufen und dabei das Symbol für alle weiteren Setups sperren.
    { key: 'maxHoldCandles', type: 'integer', default: 0, min: 0, max: 2000, step: 1, group: 'exit' },

    // ── Richtung ──────────────────────────────────────────────
    { key: 'allowLong', type: 'boolean', default: true, group: 'direction' },
    { key: 'allowShort', type: 'boolean', default: true, group: 'direction' },
]

const paramGroups = [
    { id: 'structure', labelKey: 'strategies.groups.structure' },
    { id: 'sweep', labelKey: 'strategies.groups.sweep' },
    { id: 'orderblock', labelKey: 'strategies.groups.orderblock' },
    { id: 'entry', labelKey: 'strategies.groups.entry' },
    { id: 'confirm', labelKey: 'strategies.groups.confirm' },
    { id: 'exit', labelKey: 'strategies.groups.exit' },
    { id: 'direction', labelKey: 'strategies.groups.direction' },
]

// ── Hilfsfunktionen ──────────────────────────────────────────────────────

/** Zone eines Order-Block-Kerze nach `obSource`. */
function zoneOf(candle, obSource) {
    return obSource === 'wick'
        ? { high: candle.h, low: candle.l }
        : { high: bodyHigh(candle), low: bodyLow(candle) }
}

/**
 * Wie tief liegt `price` in der Zone, in Prozent der Zonenhöhe?
 * Gemessen ab der Kante, an der der Preis eintritt:
 * short → von unten (obLow), long → von oben (obHigh).
 * 0 % = gerade eben berührt, 100 % = an der gegenüberliegenden Kante.
 */
function penetrationPct(price, zone, direction) {
    const height = zone.high - zone.low
    if (height <= 0) return 0
    return direction === 'short'
        ? ((price - zone.low) / height) * 100
        : ((zone.high - price) / height) * 100
}

/** Liegt der Preis (Docht) überhaupt in der Zone? */
function touchesZone(candle, zone) {
    return candle.h >= zone.low && candle.l <= zone.high
}

/**
 * Sucht die Order-Block-Kerze: die letzte gegenläufige Kerze bei/vor dem Sweep.
 * Für einen Short ist das die letzte bullische Kerze (das Kauflevel, das gleich
 * überrannt wird), für einen Long die letzte bärische.
 */
function findOrderBlock(candles, sweepIdx, direction, searchBack) {
    const wanted = direction === 'short' ? isBull : isBear
    const from = Math.max(0, sweepIdx - searchBack)
    for (let i = sweepIdx; i >= from; i--) {
        if (wanted(candles[i])) return i
    }
    return sweepIdx   // Rückfall: die Sweep-Kerze selbst
}

/**
 * Ein Setup entsteht nur, wenn nach dem Sweep wirklich die Gegenseite übernimmt.
 * @returns {{ ok: boolean, reason?: string, impulseIdx?: number, impulseExtreme?: number }}
 */
function checkReaction(candles, sweepIdx, direction, p, atrSeries) {
    const wanted = direction === 'short' ? isBear : isBull

    // Schritt 2 aus dem PDF: n entgegengerichtete Kerzen direkt nach dem Sweep
    for (let n = 1; n <= p.oppositeCandles; n++) {
        const c = candles[sweepIdx + n]
        if (!c || !wanted(c)) return { ok: false, reason: INVALID_REASONS.NO_OPPOSITE }
    }

    // Impuls: spürbare Bewegung weg von der Zone, gemessen in ATR
    const atrVal = atrSeries[sweepIdx] || 0
    const needed = atrVal * p.impulseMinAtr
    const startPrice = direction === 'short' ? candles[sweepIdx].l : candles[sweepIdx].h

    let extreme = startPrice
    let impulseIdx = sweepIdx
    const last = Math.min(candles.length - 1, sweepIdx + p.impulseMaxCandles)
    for (let i = sweepIdx + 1; i <= last; i++) {
        if (direction === 'short') {
            if (candles[i].l < extreme) { extreme = candles[i].l; impulseIdx = i }
        } else {
            if (candles[i].h > extreme) { extreme = candles[i].h; impulseIdx = i }
        }
    }

    const moved = Math.abs(extreme - startPrice)
    if (needed > 0 && moved < needed) return { ok: false, reason: INVALID_REASONS.NO_IMPULSE }

    return { ok: true, impulseIdx, impulseExtreme: extreme }
}

/**
 * Take-Profit-Preis je Modus. 0 = ausdrücklich kein Ziel (Swing laufen lassen).
 *
 * Wichtig: nur `tpMode: 'none'` darf 0 liefern. Früher fiel auch `lastSwing`
 * still auf 0 zurück, wenn kein passendes Swing-Level existierte — daraus wurde
 * unbeabsichtigt eine Position ohne Ausstieg. In einem Backtest über ein Jahr
 * hat genau das einen Trade über 200 Tage laufen lassen, der als einzelner
 * +85R-Ausreisser die ganze Statistik verfälscht hat (Erwartungswert 9,5R statt
 * ~1,9R) und nebenbei das Symbol für alle weiteren Setups blockierte.
 */
function computeTakeProfit(direction, entry, stopLoss, p, pivotsOpposite, sweepTime) {
    if (p.tpMode === 'none') return 0

    const nachRR = () => {
        const risk = Math.abs(entry - stopLoss)
        return direction === 'short' ? entry - risk * p.tpRR : entry + risk * p.tpRR
    }
    if (p.tpMode === 'rr') return nachRR()

    // 'lastSwing': die nächste offensichtliche Liquiditätszone in Trade-Richtung
    const before = pivotsOpposite.filter((pv) => pv.t < sweepTime)
    const target = before.length ? before[before.length - 1].price : null
    // Kein brauchbares Swing-Ziel → auf das RR-Ziel zurückfallen, NICHT auf 0
    if (target === null) return nachRR()
    if (direction === 'short' && target >= entry) return nachRR()
    if (direction === 'long' && target <= entry) return nachRR()
    return target
}

/** Bestätigungen zum Zeitpunkt des Retests. `null` = nicht geprüft. */
function evaluateConfirmations({ candles, idx, direction, setup, p, rsiSeries, htfBias }) {
    const conf = { rejection: null, fib: null, rsi: null, htf: null }

    if (p.requireRejectionCandle || p.entryMode === 'rejection_confirmed') {
        conf.rejection = hasRejectionCandle(candles[idx - 1], candles[idx], direction)
    }

    if (p.useFib786) {
        // Retracement der Impulsbewegung: von der Zonenkante zum Impuls-Extrem
        const from = direction === 'short' ? setup.obLow : setup.obHigh
        const level = fibLevel(from, setup.impulseExtreme, p.fibLevelValue)
        const tol = Math.abs(level) * (p.fibTolerancePct / 100)
        conf.fib = Math.abs(setup.entry - level) <= tol
    }

    if (p.useRsi) {
        const v = rsiSeries[idx]
        conf.rsi = v === null || v === undefined
            ? null
            : (direction === 'short' ? v >= p.rsiOverbought : v <= p.rsiOversold)
    }

    if (p.htfTrendFilter) conf.htf = htfBias === null ? null : htfBias === direction

    return conf
}

/** Blockieren die Bestätigungen den Einstieg? */
function confirmationsBlock(conf, p) {
    if (p.requireRejectionCandle && conf.rejection === false) return true
    if (p.entryMode === 'rejection_confirmed' && conf.rejection === false) return true
    if (!p.requireAllConfirmations) return false
    // Strenger Modus: jede aktivierte Bestätigung muss zutreffen
    return [conf.fib, conf.rsi, conf.htf].some((v) => v === false)
}

/** Trendrichtung der höheren Zeiteinheit, oder null wenn nicht bestimmbar. */
function higherTimeframeBias(htfCandles, period) {
    if (!Array.isArray(htfCandles) || htfCandles.length < period + 1) return null
    const series = ema(htfCandles, period)
    const lastIdx = htfCandles.length - 1
    const e = series[lastIdx]
    if (e === null || e === undefined) return null
    return htfCandles[lastIdx].c >= e ? 'long' : 'short'
}

// ── detect ───────────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {Array}  input.candles        geschlossene Kerzen, aufsteigend
 * @param {object} input.params         validierte Parameter
 * @param {Array}  input.openSetups     laufende Setups (armed/waiting_retest) mit id
 * @param {Array}  [input.knownSetupKeys] bereits bekannte `${direction}|${obCandleTime}`
 *
 *   WICHTIG: `knownSetupKeys` muss ALLE je erkannten Setups im Scan-Fenster
 *   enthalten, nicht nur die noch offenen. Sonst wird ein bereits abgeschlossenes
 *   Setup bei jedem Takt neu erzeugt, solange sein Sweep im Fenster liegt —
 *   gemessen an echten BTC-Daten wurden daraus 793 statt 62 Setups in 45 Tagen.
 *   Die Engine lädt die Schlüssel deshalb statusunabhängig aus `strategy_setups`.
 * @param {Array}  [input.htfCandles]   Kerzen der höheren Zeiteinheit (optional)
 *
 * @returns {{ setups: Array, events: Array, diagnostics: object }}
 *   setups     – neu erkannte Setups (Status `waiting_retest`)
 *   events     – Fortschreibungen bestehender Setups (per `id`)
 *   diagnostics – Zähler für den Setup-Trichter in der Auswertung
 */
function detect({ candles, params: p, openSetups = [], knownSetupKeys = [], htfCandles = null }) {
    const setups = []
    const events = []
    // `rejections` trägt zu jedem Grund einen stabilen Schlüssel. Der Aufrufer
    // ruft detect() je Kerze erneut auf und sieht dabei dieselben abgelehnten
    // Sweeps wieder; ohne Schlüssel wären die Zähler im Trichter vielfach
    // gezählt (gemessen: 67 617 statt ~1 500 »Sweeps« in 90 Tagen).
    const diagnostics = { sweepsFound: 0, setupsCreated: 0, rejected: {}, rejections: [] }

    const reject = (reason, key) => {
        diagnostics.rejected[reason] = (diagnostics.rejected[reason] || 0) + 1
        diagnostics.rejections.push({ reason, key })
    }

    if (!Array.isArray(candles) || candles.length < p.swingLookback + p.swingConfirmBars + 10) {
        return { setups, events, diagnostics }
    }

    const atrSeries = atr(candles, 14)
    const rsiSeries = p.useRsi ? rsi(candles, p.rsiPeriod) : []
    const htfBias = p.htfTrendFilter ? higherTimeframeBias(htfCandles, p.htfEmaPeriod) : null

    const highs = pivotHighs(candles, p.swingLookback, p.swingConfirmBars)
    const lows = pivotLows(candles, p.swingLookback, p.swingConfirmBars)

    const known = new Set(knownSetupKeys)
    for (const s of openSetups) known.add(`${s.direction}|${s.obCandleTime}`)

    // ══ Phase A: neue Setups suchen ═══════════════════════════════════════
    const scanFrom = Math.max(0, candles.length - p.scanWindowCandles)

    const directions = []
    if (p.allowShort) directions.push('short')
    if (p.allowLong) directions.push('long')

    for (const direction of directions) {
        const pivots = direction === 'short' ? highs : lows
        const pivotsOpposite = direction === 'short' ? lows : highs

        for (const pivot of pivots) {
            // Kein Blick in die Zukunft: das Pivot gilt erst als bekannt, wenn
            // seine Bestätigungskerzen durch sind.
            const earliestSweep = Math.max(pivot.index + p.swingConfirmBars + 1, scanFrom)
            const level = pivot.price
            const tol = Math.abs(level) * (p.equalHighTolerancePct / 100)

            for (let i = earliestSweep; i < candles.length; i++) {
                const k = candles[i]

                // Ein späteres, stärkeres Pivot macht dieses hier gegenstandslos
                if (direction === 'short' && k.c > level + tol) break
                if (direction === 'long' && k.c < level - tol) break

                const wickBreaks = direction === 'short' ? k.h > level : k.l < level
                if (!wickBreaks) continue

                diagnostics.sweepsFound++
                const rkey = `${direction}|${k.t}`

                // Fall »Equal Highs«: das Level wird nur egalisiert, nicht
                // wirklich gesweept → keine Liquidität geholt (PDF 1, INVALID)
                const exceeded = direction === 'short' ? k.h - level : level - k.l
                if (exceeded <= tol) { reject(INVALID_REASONS.EQUAL_HIGHS, rkey); continue }

                // Der Docht muss ein echter Docht sein, kein Körperbruch
                const kRange = range(k)
                if (kRange > 0 && (exceeded / kRange) * 100 < p.sweepMinWickPct) {
                    reject(INVALID_REASONS.EQUAL_HIGHS, rkey); continue
                }

                // Schlusskurs muss zurück hinter das Level — sonst ist es ein Ausbruch
                const closedBack = direction === 'short' ? k.c < level : k.c > level
                if (!closedBack) continue

                const reaction = checkReaction(candles, i, direction, p, atrSeries)
                if (!reaction.ok) { reject(reaction.reason, rkey); break }

                const obIdx = findOrderBlock(candles, i, direction, p.obSearchBack)
                const zone = zoneOf(candles[obIdx], p.obSource)
                if (!(zone.high > zone.low)) { reject(INVALID_REASONS.BAD_ZONE, rkey); break }

                const key = `${direction}|${candles[obIdx].t}`
                if (known.has(key)) break
                known.add(key)

                const sweepPrice = direction === 'short' ? k.h : k.l
                const entry = direction === 'short' ? zone.low : zone.high
                const stopLoss = direction === 'short'
                    ? sweepPrice * (1 + p.slBufferPct / 100)
                    : sweepPrice * (1 - p.slBufferPct / 100)
                const takeProfit = computeTakeProfit(direction, entry, stopLoss, p, pivotsOpposite, k.t)
                const risk = Math.abs(entry - stopLoss)
                const rr = takeProfit && risk > 0 ? Math.abs(takeProfit - entry) / risk : 0

                setups.push({
                    direction,
                    status: 'waiting_retest',
                    sweepLevel: level,
                    sweepPrice,
                    sweepCandleTime: k.t,
                    obHigh: zone.high,
                    obLow: zone.low,
                    obCandleTime: candles[obIdx].t,
                    impulseExtreme: reaction.impulseExtreme,
                    entry,
                    stopLoss,
                    takeProfit,
                    rr,
                    confirmations: {},
                    detectorVersion: DETECTOR_VERSION,
                    // Ab dieser Kerze wird auf den Retest gewartet
                    watchFrom: candles[Math.min(reaction.impulseIdx + 1, candles.length - 1)].t,
                })
                diagnostics.setupsCreated++
                break   // dieses Pivot ist verbraucht
            }
        }
    }

    // ══ Phase B: laufende Setups fortschreiben ════════════════════════════
    for (const s of openSetups) {
        if (s.status !== 'waiting_retest' && s.status !== 'armed') continue

        const zone = { high: s.obHigh, low: s.obLow }
        const dir = s.direction
        const startFrom = Number(s.watchFrom || s.obCandleTime) || 0
        const idxStart = candles.findIndex((c) => c.t > startFrom)
        if (idxStart === -1) continue

        let candlesWaited = 0
        let handled = false

        for (let i = idxStart; i < candles.length && !handled; i++) {
            const k = candles[i]
            candlesWaited++

            // (a) Zone komplett durchbrochen — Schlusskurs jenseits der fernen Kante.
            //     PDF: »Zone wird nicht respektiert«
            const brokeThrough = dir === 'short' ? k.c > zone.high : k.c < zone.low
            if (brokeThrough) {
                // Sonderfall: nur der Docht ging durch UND darüber hinaus über das
                // alte Sweep-Extrem → das ist ein NEUER Liquidity Sweep, kein Bruch.
                events.push({
                    id: s.id, status: 'invalidated',
                    invalidReason: INVALID_REASONS.ZONE_BROKEN, candleTime: k.t,
                })
                handled = true
                break
            }

            if (!touchesZone(k, zone)) continue

            // (b) Neuer Liquidity Sweep: Docht schiesst über das alte Extrem
            //     hinaus, Kerze schliesst aber zurück (PDF 1, INVALID)
            const wickBeyondSweep = dir === 'short' ? k.h > s.sweepPrice : k.l < s.sweepPrice
            if (wickBeyondSweep) {
                events.push({
                    id: s.id, status: 'invalidated',
                    invalidReason: INVALID_REASONS.NEW_SWEEP, candleTime: k.t,
                })
                handled = true
                break
            }

            // (c) Eindringtiefe — NUR der Schlusskurs zählt.
            //     Ein tiefer Docht ist ausdrücklich erlaubt.
            const closeInside = k.c >= zone.low && k.c <= zone.high
            if (closeInside && penetrationPct(k.c, zone, dir) > p.maxRetestDepthPct) {
                events.push({
                    id: s.id, status: 'invalidated',
                    invalidReason: INVALID_REASONS.CLOSED_TOO_DEEP, candleTime: k.t,
                })
                handled = true
                break
            }

            // (d) Gültiger Retest → Bestätigungen prüfen
            const conf = evaluateConfirmations({
                candles, idx: i, direction: dir, setup: s, p, rsiSeries, htfBias,
            })
            if (confirmationsBlock(conf, p)) {
                // Nicht ungültig — das Setup darf beim nächsten Antippen erneut
                // antreten, solange die Zone hält.
                continue
            }

            events.push({
                id: s.id,
                status: 'triggered',
                triggeredAt: k.t,
                entry: s.entry,
                stopLoss: s.stopLoss,
                takeProfit: s.takeProfit,
                confirmations: conf,
                candleTime: k.t,
            })
            handled = true
        }

        // (e) Zone wurde nie erreicht (PDF: »Zone wird nicht getroffen«)
        if (!handled && candlesWaited > p.retestMaxCandles) {
            events.push({
                id: s.id, status: 'expired',
                invalidReason: INVALID_REASONS.ZONE_NOT_REACHED,
                candleTime: candles[candles.length - 1].t,
            })
        }
    }

    return { setups, events, diagnostics }
}

export default {
    id: 'lsob',
    name: 'Liquidity Sweep + Order Block',
    description: 'Sweep eines markanten Hochs/Tiefs, Order Block als Reaktionszone, Einstieg beim Retest.',
    version: DETECTOR_VERSION,
    supportedTimeframes: ['5m', '15m', '30m', '1h', '4h', '1d'],
    warmupCandles: 300,
    params,
    paramGroups,
    detect,
}
