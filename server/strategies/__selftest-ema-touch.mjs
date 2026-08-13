/**
 * Selbsttest des EMA-Touch-Detectors.
 *
 *   node server/strategies/__selftest-ema-touch.mjs
 *
 * Ein Fall je Regel aus dem Referenz-PDF. Die wichtigste Prüfung ist die
 * Guss-Bedingung: EINE bullische Kerze in der Korrektur muss das Setup töten.
 */

import strategie, { INVALID_REASONS } from './ema_touch.js'
import { ema } from './indicators.js'

const TF_MS = 900000

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

function series(rows, startT = 1700000000000) {
    return rows.map((r, i) => ({
        t: startT + i * TF_MS, o: r[0], h: r[1], l: r[2], c: r[3], v: 100,
        closeTime: startT + (i + 1) * TF_MS - 1,
    }))
}

function params(over = {}) {
    const p = {}
    for (const d of strategie.params) p[d.key] = d.default
    // Kurze EMAs, damit ein Test mit ~120 Kerzen auskommt
    return { ...p, emaFast: 5, emaEntry: 10, swingLookback: 3, swingConfirmBars: 2, ...over }
}

/**
 * Vorlauf mit EINEM früheren Pivot-Hoch.
 *
 * Das ist keine Kosmetik: die Strategie verlangt ein höheres Hoch GEGENÜBER DEM
 * LETZTEN. Ohne ein früheres Vergleichshoch gibt es kein Setup — ein monoton
 * steigender Vorlauf erzeugt gar keine Pivots und damit auch keinen Testfall.
 */
function vorlauf() {
    const rows = []
    // Anstieg zum ersten Hoch
    for (let i = 0; i < 28; i++) { const b = 100 + i * 0.25; rows.push([b, b + 0.12, b - 0.08, b + 0.1]) }
    // Erstes Pivot-Hoch (das später überboten werden muss)
    rows.push([106.85, 107.40, 106.80, 107.30])
    // Rücksetzer — erzeugt zugleich das Pivot-Tief für die Fibonacci-Strecke
    for (let i = 0; i < 6; i++) { const b = 107.2 - i * 0.5; rows.push([b, b + 0.05, b - 0.55, b - 0.5]) }
    // Erneuter Anstieg bis kurz vor den Impuls
    for (let i = 0; i < 25; i++) { const b = 104.2 + i * 0.19; rows.push([b, b + 0.12, b - 0.08, b + 0.1]) }
    return rows
}

/**
 * Baut einen kompletten Fall: Vorlauf → Impuls auf ein höheres Hoch weit über
 * der schnellen EMA → Korrektur (deren Kerzen der Aufrufer bestimmt).
 */
function fall(korrektur, { impulsHoch = 122 } = {}) {
    const rows = vorlauf()
    const letzte = rows[rows.length - 1][3]   // Schlusskurs der letzten Vorlaufkerze
    // Impuls in drei kräftigen Kerzen auf das höhere Hoch
    rows.push([letzte, letzte + 4, letzte - 0.2, letzte + 3.8])
    rows.push([letzte + 3.8, letzte + 8, letzte + 3.6, letzte + 7.8])
    rows.push([letzte + 7.8, impulsHoch, letzte + 7.6, impulsHoch - 0.5])
    // Bestätigungskerzen rechts vom Pivot (swingConfirmBars = 2), bärisch
    rows.push([impulsHoch - 0.5, impulsHoch - 0.4, impulsHoch - 2.5, impulsHoch - 2.2])
    rows.push([impulsHoch - 2.2, impulsHoch - 2.1, impulsHoch - 4.5, impulsHoch - 4.2])
    return [...rows, ...korrektur]
}

/** Zwei Durchläufe wie in der Engine: erkennen, dann fortschreiben. */
function lauf(rows, over = {}) {
    const candles = series(rows)
    const p = params(over)
    const erst = strategie.detect({ candles, params: p, openSetups: [], knownSetupKeys: [] })
    const offen = erst.setups.map((s, i) => ({ ...s, id: i + 1 }))
    const zweit = strategie.detect({ candles, params: p, openSetups: offen, knownSetupKeys: [] })
    return { candles, p, erst, zweit, offen }
}

console.log('\nEMA Touch — Selbsttest\n')

// ── Erkennung ────────────────────────────────────────────────────────────
console.log('Setup-Erkennung')

const sinkend = (von, n, schritt = 1.6) => {
    const rows = []
    let k = von
    for (let i = 0; i < n; i++) {
        rows.push([k, k + 0.1, k - schritt - 0.1, k - schritt])
        k -= schritt
    }
    return rows
}

{
    const { erst, offen } = lauf(fall(sinkend(117.8, 6)))
    const s = erst.setups[0]
    check('höheres Hoch mit Überdehnung wird erkannt', !!s && offen.length === 1,
        `setups=${erst.setups.length} gründe=${JSON.stringify(erst.diagnostics.rejected)}`)
    if (s) {
        check('Richtung ist long', s.direction === 'long')
        check('Überdehnung wird festgehalten', s.confirmations.overextensionPct > 0,
            String(s.confirmations.overextensionPct))
    }
}

{
    // Ohne Überdehnung: Schwelle künstlich hochsetzen
    const { erst } = lauf(fall(sinkend(117.8, 6)), { minOverextensionPct: 14 })
    check('zu geringe Überdehnung wird abgelehnt',
        erst.setups.length === 0 && erst.diagnostics.rejected[INVALID_REASONS.NO_OVEREXTENSION] > 0,
        JSON.stringify(erst.diagnostics.rejected))
}

// ── Die Guss-Bedingung ───────────────────────────────────────────────────
console.log('\nGuss-Bedingung (die zentrale Regel)')

{
    // Saubere, durchgehend bärische Korrektur bis zur Einstiegs-EMA
    const { zweit } = lauf(fall(sinkend(117.8, 6)))
    const ev = zweit.events[0]
    check('ununterbrochene Korrektur löst aus', ev?.status === 'triggered', JSON.stringify(ev))
    if (ev?.status === 'triggered') {
        check('Einstieg liegt auf der Einstiegs-EMA', ev.entry > 0)
        check('Stop liegt unter dem Einstieg', ev.stopLoss < ev.entry,
            `entry=${ev.entry?.toFixed(2)} sl=${ev.stopLoss?.toFixed(2)}`)
        check('Ziel liegt über dem Einstieg', ev.takeProfit > ev.entry,
            `tp=${ev.takeProfit?.toFixed(2)}`)
        check('Anzahl Korrekturkerzen wird festgehalten', ev.confirmations.correctionCandles > 0)
    }
}

{
    // Dieselbe Korrektur, aber eine einzige grüne Kerze mittendrin
    // Muss VOR dem EMA-Kontakt liegen, sonst ist das Setup schon ausgelöst
    const k = sinkend(117.8, 6)
    k[0] = [117.8, 118.5, 117.6, 118.3]   // bullisch
    const { zweit } = lauf(fall(k))
    const ev = zweit.events[0]
    check('EINE bullische Kerze macht das Setup ungültig',
        ev?.status === 'invalidated' && ev.invalidReason === INVALID_REASONS.BULLISH_CANDLE,
        JSON.stringify(ev))
}

{
    // Doji: Close == Open. Laut Dokument keine bullische Kerze.
    const k = sinkend(117.8, 6)
    k[0] = [117.8, 118.1, 117.4, 117.8]   // Close == Open
    const { zweit } = lauf(fall(k))
    const ev = zweit.events[0]
    check('Doji gilt nicht als bullisch', ev?.status === 'triggered', JSON.stringify(ev))
}

{
    // Winziger grüner Körper, Toleranz aktiv
    const k = sinkend(117.8, 6)
    k[0] = [117.80, 118.40, 117.20, 117.85]   // Körper 0.05 bei Spanne 1.2 ≈ 4 %
    const streng = lauf(fall(k))
    const tolerant = lauf(fall(k), { bullishToleranceBodyPct: 10 })
    check('winziger grüner Körper bricht ohne Toleranz ab',
        streng.zweit.events[0]?.invalidReason === INVALID_REASONS.BULLISH_CANDLE,
        JSON.stringify(streng.zweit.events[0]))
    check('mit Toleranz wird er durchgelassen',
        tolerant.zweit.events[0]?.status === 'triggered',
        JSON.stringify(tolerant.zweit.events[0]))
}

// ── Weitere Abbruchgründe ────────────────────────────────────────────────
console.log('\nWeitere Abbruchgründe')

{
    // Korrektur bleibt oben stehen und erreicht die EMA nie
    const flach = []
    let k = 117.8
    for (let i = 0; i < 14; i++) { flach.push([k, k + 0.05, k - 0.12, k - 0.1]); k -= 0.1 }
    const { zweit } = lauf(fall(flach), { maxCorrectionCandles: 5 })
    const ev = zweit.events[0]
    check('Korrektur ohne EMA-Kontakt läuft in den Timeout',
        ev?.status === 'expired' && ev.invalidReason === INVALID_REASONS.CORRECTION_TIMEOUT,
        JSON.stringify(ev))
}

{
    // Absturz weit unter die Einstiegs-EMA. Welcher Abbruchgrund zuerst greift,
    // hängt davon ab, wie schnell die EMAs nachziehen — entscheidend ist allein,
    // dass KEIN Einstieg zu einem Preis entsteht, den der Markt nie bot.
    const sturz = [
        [117.8, 117.9, 116.0, 116.2],
        [116.2, 116.3, 95.0, 95.5],
    ]
    const { zweit } = lauf(fall(sturz))
    const ev = zweit.events[0]
    check('Absturz an der EMA vorbei erzeugt keinen Einstieg',
        ev?.status === 'invalidated' && ev.status !== 'triggered',
        JSON.stringify(ev))
    check('und nennt einen nachvollziehbaren Grund',
        [INVALID_REASONS.PRICE_BELOW_EMA50, INVALID_REASONS.EMA_CROSS].includes(ev?.invalidReason),
        ev?.invalidReason)
}

// ── Fibonacci ────────────────────────────────────────────────────────────
console.log('\nFibonacci-Bestätigung')

{
    const ohne = lauf(fall(sinkend(117.8, 6)))
    const mit = lauf(fall(sinkend(117.8, 6)), { requireFib: true, fibTolerancePct: 0.01 })
    check('ohne Fib-Pflicht wird ausgelöst', ohne.zweit.events[0]?.status === 'triggered')
    check('mit strenger Fib-Pflicht wird abgelehnt',
        mit.zweit.events[0]?.invalidReason === INVALID_REASONS.NO_FIB_CONFLUENCE,
        JSON.stringify(mit.zweit.events[0]))
    const weit = lauf(fall(sinkend(117.8, 6)), { requireFib: true, fibTolerancePct: 3 })
    check('mit weiter Toleranz wird wieder ausgelöst',
        weit.zweit.events[0]?.status === 'triggered', JSON.stringify(weit.zweit.events[0]))
}

// ── Ausstiegsmodi ────────────────────────────────────────────────────────
console.log('\nAusstieg')

{
    const ema21 = lauf(fall(sinkend(117.8, 6)), { exitMode: 'ema21' })
    const rr = lauf(fall(sinkend(117.8, 6)), { exitMode: 'rr', tpRR: 3 })
    const a = ema21.zweit.events[0]
    const b = rr.zweit.events[0]
    check('Modus ema21 zielt auf die schnelle EMA', a?.takeProfit > a?.entry, JSON.stringify(a))
    if (b?.status === 'triggered') {
        const erwartet = b.entry + (b.entry - b.stopLoss) * 3
        check('Modus rr rechnet das Ziel aus dem Risiko',
            Math.abs(b.takeProfit - erwartet) < 1e-6,
            `tp=${b.takeProfit} erwartet=${erwartet}`)
    } else {
        check('Modus rr rechnet das Ziel aus dem Risiko', false, JSON.stringify(b))
    }
}

{
    const streng = lauf(fall(sinkend(117.8, 6)), { exitMode: 'rr', tpRR: 1, minRR: 5 })
    check('minRR lehnt zu magere Setups ab',
        streng.zweit.events[0]?.status === 'rejected', JSON.stringify(streng.zweit.events[0]))
}

// ── Determinismus und Abschottung ────────────────────────────────────────
console.log('\nDeterminismus')

{
    const rows = fall(sinkend(117.8, 6))
    const a = lauf(rows)
    const b = lauf(rows)
    check('gleiche Eingabe → gleiches Ergebnis',
        JSON.stringify(a.erst) === JSON.stringify(b.erst)
        && JSON.stringify(a.zweit) === JSON.stringify(b.zweit))
    check('kein doppeltes Setup im zweiten Lauf', a.zweit.setups.length === 0,
        `erneut: ${a.zweit.setups.length}`)

    const candles = series(rows)
    const p = params()
    const vorher = JSON.stringify(candles)
    strategie.detect({ candles, params: p, openSetups: [], knownSetupKeys: [] })
    check('detect() verändert die Kerzen nicht', JSON.stringify(candles) === vorher)
}

{
    // Die schnelle EMA muss über der Einstiegs-EMA liegen (Aufwärtstrend)
    const fallend = []
    for (let i = 0; i < 80; i++) {
        const b = 140 - i * 0.5
        fallend.push([b, b + 0.1, b - 0.6, b - 0.5])
    }
    const { erst } = lauf(fallend)
    check('im Abwärtstrend entsteht kein Setup', erst.setups.length === 0,
        JSON.stringify(erst.diagnostics.rejected))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log(`\nFehlgeschlagen:\n  ${fehler.join('\n  ')}\n`); process.exit(1) }
console.log('')
