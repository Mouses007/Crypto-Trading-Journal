/**
 * Selbsttest des LSOB-Detectors.
 *
 * Das Projekt hat kein Test-Framework. Für einen deterministischen Detector ist
 * das der wunde Punkt, deshalb dieser Harness: synthetische Kerzen, ein Fall je
 * Regel aus dem Referenz-PDF, kein Netz und keine DB.
 *
 *   node server/strategies/__selftest.mjs
 *
 * Alle Short-Fälle werden zusätzlich gespiegelt als Long-Fall geprüft
 * (Preis → M − Preis). Ein Detector, der nur in eine Richtung funktioniert,
 * fällt damit sofort auf.
 */

import lsob, { INVALID_REASONS } from './lsob.js'

const TF_MS = 900000        // 15m
const MIRROR = 200          // Spiegelachse für die Long-Variante

// ── Mini-Harness ─────────────────────────────────────────────────────────
let passed = 0
let failed = 0
const failures = []

function check(name, ok, detail) {
    if (ok) {
        passed++
        console.log(`  \x1b[32m✓\x1b[0m ${name}`)
    } else {
        failed++
        failures.push(name)
        console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
    }
}

// ── Fixture-Bau ──────────────────────────────────────────────────────────

/** [o, h, l, c] → Kerze mit fortlaufender Zeit. */
function series(rows, startT = 1700000000000) {
    return rows.map((r, i) => ({
        t: startT + i * TF_MS,
        o: r[0], h: r[1], l: r[2], c: r[3],
        v: 100,
        closeTime: startT + (i + 1) * TF_MS - 1,
    }))
}

/**
 * Streng steigender Vorlauf: erzeugt bewusst KEINE Pivots (jede Kerze höher
 * als die vorige), damit die Tests nur den gebauten Fall sehen.
 * Liefert genug Kerzen, damit ATR(14) definiert ist.
 */
function prefix(n = 25) {
    const rows = []
    for (let i = 0; i < n; i++) {
        const b = 80 + i
        rows.push([b, b + 0.6, b - 0.4, b + 0.5])
    }
    return rows
}

/**
 * Der Kern-Aufbau eines gültigen Short-Setups:
 *   Pivot-Hoch 110 → Rücksetzer → Sweep auf 111 mit Schluss 109 (bullische
 *   Kerze = Order Block, Körper 108–109) → zwei bärische Kerzen → Impuls auf 100.
 * Danach fehlt nur noch die Retest-Kerze, die jeder Testfall selbst anhängt.
 */
function shortBase() {
    return [
        ...prefix(),
        [104.5, 110.0, 104.2, 109.0],   // 25  Pivot-Hoch 110
        [109.0, 109.5, 107.0, 107.5],   // 26  tieferes Hoch
        [107.5, 108.0, 106.0, 106.5],   // 27  tieferes Hoch
        [106.5, 107.5, 105.5, 106.0],   // 28
        [106.0, 108.0, 105.8, 107.5],   // 29
        [107.5, 109.0, 107.0, 108.5],   // 30
        [108.0, 111.0, 107.8, 109.0],   // 31  SWEEP + Order Block (Körper 108–109)
        [109.0, 109.2, 106.0, 106.5],   // 32  Gegenkerze 1
        [106.5, 106.8, 103.0, 103.5],   // 33  Gegenkerze 2
        [103.5, 104.0, 100.0, 100.5],   // 34  Impuls-Extrem 100
        [100.5, 103.0, 100.0, 102.5],   // 35  Rücklauf
    ]
}

/** Spiegelt eine Kerzenreihe an MIRROR — aus jedem Short wird ein Long. */
function mirror(candles) {
    return candles.map((k) => ({
        ...k,
        o: MIRROR - k.o,
        h: MIRROR - k.l,
        l: MIRROR - k.h,
        c: MIRROR - k.c,
    }))
}

function params(overrides = {}) {
    const p = {}
    for (const def of lsob.params) p[def.key] = def.default
    return { ...p, tpMode: 'rr', tpRR: 2, ...overrides }
}

/**
 * Führt detect() zweimal aus: einmal um das Setup zu finden, einmal um es
 * fortzuschreiben. Genau so läuft es später auch in der Engine.
 */
function runScenario(rows, { long = false, overrides = {} } = {}) {
    let candles = series(rows)
    // Die Laufrichtung wird vorgegeben, ein Testfall darf sie aber überstimmen.
    const richtung = long
        ? { allowLong: true, allowShort: false }
        : { allowLong: false, allowShort: true }
    const p = params({ ...richtung, ...overrides })
    if (long) candles = mirror(candles)

    const first = lsob.detect({ candles, params: p, openSetups: [] })
    const openSetups = first.setups.map((s, i) => ({ ...s, id: i + 1 }))
    const second = lsob.detect({ candles, params: p, openSetups })

    return { candles, first, second, openSetups }
}

/** Prüft einen Fall in beiden Richtungen (Short und gespiegelt als Long). */
function bothDirections(name, rows, assert, overrides) {
    for (const long of [false, true]) {
        const label = `${name} [${long ? 'long/gespiegelt' : 'short'}]`
        try {
            assert(label, runScenario(rows, { long, overrides }), long)
        } catch (e) {
            check(label, false, `Ausnahme: ${e.message}`)
        }
    }
}

// ── Testfälle ────────────────────────────────────────────────────────────

console.log('\nLSOB-Detector — Selbsttest\n')

console.log('Setup-Erkennung')

bothDirections('gültiges Setup wird erkannt', [...shortBase(),
    [102.5, 108.2, 102.0, 106.0],   // Retest: Docht berührt 108, Schluss ausserhalb
], (label, { first, openSetups }, long) => {
    const s = first.setups[0]
    if (!s) return check(label, false, 'kein Setup erkannt')
    const okDir = s.direction === (long ? 'long' : 'short')
    // Zone im Short: 108–109. Gespiegelt: 91–92.
    const zone = long ? [MIRROR - 109, MIRROR - 108] : [108, 109]
    const okZone = Math.abs(s.obLow - zone[0]) < 1e-6 && Math.abs(s.obHigh - zone[1]) < 1e-6
    const okEntry = Math.abs(s.entry - (long ? zone[1] : zone[0])) < 1e-6
    const okSl = long ? s.stopLoss < s.entry : s.stopLoss > s.entry
    check(label, okDir && okZone && okEntry && okSl && openSetups.length === 1,
        `dir=${s.direction} zone=[${s.obLow},${s.obHigh}] entry=${s.entry} sl=${s.stopLoss.toFixed(3)}`)
})

bothDirections('Sweep-Kerze wird als Order Block gewählt', [...shortBase(),
    [102.5, 108.2, 102.0, 106.0],
], (label, { first, candles }) => {
    const s = first.setups[0]
    check(label, !!s && s.obCandleTime === candles[31].t,
        s ? `obCandleTime zeigt auf Index ${candles.findIndex((c) => c.t === s.obCandleTime)}` : 'kein Setup')
})

console.log('\nUngültig laut PDF')

bothDirections('Equal Highs ohne echten Sweep', [
    ...prefix(),
    [104.5, 110.0, 104.2, 109.0],
    [109.0, 109.5, 107.0, 107.5],
    [107.5, 108.0, 106.0, 106.5],
    [106.5, 107.5, 105.5, 106.0],
    [106.0, 108.0, 105.8, 107.5],
    [107.5, 109.0, 107.0, 108.5],
    [108.0, 110.02, 107.8, 109.0],  // egalisiert das Hoch nur (Toleranz 0,05 %)
    [109.0, 109.2, 106.0, 106.5],
    [106.5, 106.8, 103.0, 103.5],
    [103.5, 104.0, 100.0, 100.5],
    [100.5, 103.0, 100.0, 102.5],
    [102.5, 108.2, 102.0, 106.0],
], (label, { first }) => {
    check(label,
        first.setups.length === 0 && first.diagnostics.rejected[INVALID_REASONS.EQUAL_HIGHS] > 0,
        `setups=${first.setups.length} gründe=${JSON.stringify(first.diagnostics.rejected)}`)
})

bothDirections('Schluss zu weit in der Zone', [...shortBase(),
    [102.5, 108.6, 102.0, 108.5],   // Schluss bei 50 % Eindringtiefe (max 25 %)
], (label, { second }) => {
    const ev = second.events[0]
    check(label, ev?.status === 'invalidated' && ev.invalidReason === INVALID_REASONS.CLOSED_TOO_DEEP,
        JSON.stringify(ev))
})

bothDirections('Zone wird nicht respektiert', [...shortBase(),
    [107.0, 110.0, 106.0, 109.5],   // Schluss oberhalb der Zone
], (label, { second }) => {
    const ev = second.events[0]
    check(label, ev?.status === 'invalidated' && ev.invalidReason === INVALID_REASONS.ZONE_BROKEN,
        JSON.stringify(ev))
})

bothDirections('neuer Liquidity Sweep durch die Zone', [...shortBase(),
    [107.0, 111.5, 106.5, 108.2],   // Docht über das alte Sweep-Extrem hinaus
], (label, { second }) => {
    const ev = second.events[0]
    check(label, ev?.status === 'invalidated' && ev.invalidReason === INVALID_REASONS.NEW_SWEEP,
        JSON.stringify(ev))
})

bothDirections('Zone wird nicht getroffen', [...shortBase(),
    [102.5, 103.0, 102.0, 102.5],
    [102.5, 103.0, 102.0, 102.5],
    [102.5, 103.0, 102.0, 102.5],
    [102.5, 103.0, 102.0, 102.5],
    [102.5, 103.0, 102.0, 102.5],
], (label, { second }) => {
    const ev = second.events[0]
    check(label, ev?.status === 'expired' && ev.invalidReason === INVALID_REASONS.ZONE_NOT_REACHED,
        JSON.stringify(ev))
}, { retestMaxCandles: 3 })

bothDirections('keine Gegenkerzen nach dem Sweep', [
    ...prefix(),
    [104.5, 110.0, 104.2, 109.0],
    [109.0, 109.5, 107.0, 107.5],
    [107.5, 108.0, 106.0, 106.5],
    [106.5, 107.5, 105.5, 106.0],
    [106.0, 108.0, 105.8, 107.5],
    [107.5, 109.0, 107.0, 108.5],
    [108.0, 111.0, 107.8, 109.0],   // Sweep
    [109.0, 110.5, 108.8, 110.2],   // bullisch statt bärisch
    [110.2, 111.5, 110.0, 111.2],
    [111.2, 112.0, 110.5, 111.5],
    [111.5, 112.5, 111.0, 112.0],
], (label, { first }) => {
    check(label,
        first.setups.length === 0 && first.diagnostics.rejected[INVALID_REASONS.NO_OPPOSITE] > 0,
        `setups=${first.setups.length} gründe=${JSON.stringify(first.diagnostics.rejected)}`)
})

console.log('\nGültig laut PDF (die kritische Unterscheidung)')

bothDirections('tiefer Docht, Schluss ausserhalb → Einstieg', [...shortBase(),
    [102.5, 108.9, 102.0, 107.5],   // Docht 90 % in die Zone, Schluss darunter
], (label, { second }) => {
    const ev = second.events[0]
    check(label, ev?.status === 'triggered',
        `Docht darf tief schneiden, nur der Schluss zählt — ${JSON.stringify(ev)}`)
})

bothDirections('flacher Retest → Einstieg', [...shortBase(),
    [102.5, 108.2, 102.0, 106.0],
], (label, { second, first }) => {
    const ev = second.events[0]
    const s = first.setups[0]
    check(label, ev?.status === 'triggered' && Math.abs(ev.entry - s.entry) < 1e-9,
        JSON.stringify(ev))
})

console.log('\nParameter greifen')

bothDirections('maxRetestDepthPct=80 lässt tiefen Schluss zu', [...shortBase(),
    [102.5, 108.6, 102.0, 108.5],   // 50 % Tiefe
], (label, { second }) => {
    const ev = second.events[0]
    check(label, ev?.status === 'triggered', JSON.stringify(ev))
}, { maxRetestDepthPct: 80 })

bothDirections('obSource=wick vergrössert die Zone', [...shortBase(),
    [102.5, 108.2, 102.0, 106.0],
], (label, { first }, long) => {
    const s = first.setups[0]
    // Sweep-Kerze 31: Körper 108–109, ganze Kerze 107,8–111
    const zone = long ? [MIRROR - 111, MIRROR - 107.8] : [107.8, 111]
    check(label, !!s && Math.abs(s.obLow - zone[0]) < 1e-6 && Math.abs(s.obHigh - zone[1]) < 1e-6,
        s ? `zone=[${s.obLow},${s.obHigh}]` : 'kein Setup')
}, { obSource: 'wick' })

bothDirections('RSI-Bestätigung blockiert bei falschem Wert', [...shortBase(),
    [102.5, 108.2, 102.0, 106.0],
], (label, { second }) => {
    // Der Retest kommt nach einem Absturz — der RSI ist tief, also nicht
    // überkauft. Für einen Short muss die Bestätigung damit blockieren.
    check(label, second.events.length === 0, JSON.stringify(second.events))
}, { useRsi: true, requireAllConfirmations: true, rsiOverbought: 65, rsiOversold: 35 })

bothDirections('Richtungsschalter respektiert', [...shortBase(),
    [102.5, 108.2, 102.0, 106.0],
], (label, { first }) => {
    check(label, first.setups.length === 0, `setups=${first.setups.length}`)
}, { allowLong: false, allowShort: false })

console.log('\nDeterminismus')

{
    const rows = [...shortBase(), [102.5, 108.2, 102.0, 106.0]]
    const a = runScenario(rows)
    const b = runScenario(rows)
    check('gleiche Eingabe → gleiches Ergebnis',
        JSON.stringify(a.first) === JSON.stringify(b.first) &&
        JSON.stringify(a.second) === JSON.stringify(b.second))

    // Ein zweiter Lauf mit demselben offenen Setup darf es nicht doppelt anlegen
    const { first, second } = runScenario(rows)
    check('kein doppeltes Setup beim erneuten Scan',
        second.setups.length === 0,
        `erneut erkannt: ${second.setups.length} (erster Lauf: ${first.setups.length})`)
}

// ── Ergebnis ─────────────────────────────────────────────────────────────
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`)
if (failed) {
    console.log(`\nFehlgeschlagen:\n  ${failures.join('\n  ')}\n`)
    process.exit(1)
}
console.log('')
