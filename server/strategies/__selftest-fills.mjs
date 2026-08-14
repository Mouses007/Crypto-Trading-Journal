/**
 * Selbsttest des Fill-Simulators — Schwerpunkt Teilausstieg.
 *
 * Der Simulator ist die gemeinsame Grundlage von Backtest UND Papierbetrieb.
 * Eine falsche R-Verrechnung fällt hier nicht auf, sondern erst Wochen später
 * in einer Auswertung, die man dann glaubt. Deshalb dieser Harness.
 *
 *   node server/strategies/__selftest-fills.mjs
 *
 * Alle Fälle laufen ohne Gebühren und Slippage, damit die erwarteten Beträge
 * exakt aufgehen; die Kostenrechnung ist an anderer Stelle abgedeckt.
 */

import { createPosition, stepCandle, closePosition, riskPerUnit } from '../fill-simulator.js'

let passed = 0
let failed = 0

function check(name, ok, detail) {
    if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const costs = { feeBps: 0, slippageBps: 0 }
const k = (o, h, l, c, t) => ({ o, h, l, c, t })

/** Long: Einstieg 100, Stopp 90, Ziel 130 → Risiko 10/Einheit, 10 Stück = 1R à 100 USD. */
function long() {
    return createPosition({
        setup: { direction: 'long', symbol: 'X', timeframe: '1h', stopLoss: 90, takeProfit: 130 },
        qty: 10, entryPrice: 100, entryTime: 0, leverage: 1, costs,
    })
}

/** Short gespiegelt: Einstieg 100, Stopp 110, Ziel 70. */
function short() {
    return createPosition({
        setup: { direction: 'short', symbol: 'X', timeframe: '1h', stopLoss: 110, takeProfit: 70 },
        qty: 10, entryPrice: 100, entryTime: 0, leverage: 1, costs,
    })
}

console.log('\nTeilausstieg')

for (const [name, pos, teilKerze, zielKerze] of [
    ['long', long(), k(100, 112, 99, 111, 1), k(111, 131, 110, 130, 2)],
    ['short', short(), k(100, 101, 88, 89, 1), k(89, 90, 69, 70, 2)],
]) {
    const opts = { partialTpR: 1, partialTpPct: 50, costs }

    const e1 = stepCandle(pos, teilKerze, opts)
    check(`${name}: 1R nimmt die Hälfte, Position bleibt offen`,
        e1.exit === null && pos.qty === 5 && pos.partialDone === true && Math.abs(pos.partialGross - 50) < 1e-9,
        `qty=${pos.qty} partialGross=${pos.partialGross} exit=${JSON.stringify(e1.exit)}`)

    const e2 = stepCandle(pos, zielKerze, opts)
    const t = closePosition(pos, e2.exit, costs)
    check(`${name}: beide Teile ergeben EINEN Trade mit 2R`,
        Math.abs(t.grossPnl - 200) < 1e-9 && Math.abs(t.rMultiple - 2) < 1e-9 && t.qty === 10,
        `gross=${t.grossPnl} r=${t.rMultiple} qty=${t.qty}`)
}

console.log('\nZusammenspiel mit Break-Even')

{
    const pos = long()
    const opts = { partialTpR: 1, partialTpPct: 50, breakEvenAtR: 1, costs }
    stepCandle(pos, k(100, 112, 99, 111, 1), opts)
    check('Break-Even zieht den Stopp auf den Einstieg',
        pos.breakEvenDone === true && pos.stopLoss === 100, `stopLoss=${pos.stopLoss}`)

    const e = stepCandle(pos, k(111, 112, 99, 100, 2), opts)
    const t = closePosition(pos, e.exit, costs)
    check('Rest im Break-Even → nur der Teilgewinn zählt (0,5R)',
        Math.abs(t.rMultiple - 0.5) < 1e-9 && t.exitReason === 'be',
        `r=${t.rMultiple} grund=${t.exitReason}`)
}

console.log('\nGrenzfälle')

{
    // Kerze erreicht Teilziel UND volles Ziel: erst der Teil, dann der Rest.
    const pos = long()
    const e = stepCandle(pos, k(100, 135, 99, 134, 1), { partialTpR: 1, partialTpPct: 50, costs })
    const t = closePosition(pos, e.exit, costs)
    check('Teilziel und Ziel in derselben Kerze → beides gebucht',
        pos.partialDone === true && Math.abs(t.grossPnl - 200) < 1e-9,
        `gross=${t.grossPnl} partial=${pos.partialGross}`)
}

{
    // Stopp hat Vorrang: wird er in derselben Kerze berührt, gibt es keinen Teil.
    const pos = long()
    const e = stepCandle(pos, k(100, 112, 89, 91, 1), { partialTpR: 1, partialTpPct: 50, costs })
    check('Stopp in derselben Kerze schlägt den Teilausstieg',
        e.exit?.reason === 'sl' && !pos.partialDone, JSON.stringify(e.exit))
}

{
    // Abgeschaltet (0) muss sich exakt wie vorher verhalten.
    const pos = long()
    stepCandle(pos, k(100, 112, 99, 111, 1), { partialTpR: 0, partialTpPct: 50, costs })
    check('partialTpR=0 lässt die Position unangetastet',
        pos.qty === 10 && !pos.partialDone, `qty=${pos.qty}`)
}

{
    const pos = long()
    check('riskPerUnit bleibt am Einstiegs-Stopp verankert',
        riskPerUnit(pos) === 10, String(riskPerUnit(pos)))
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen\n`)
process.exit(failed ? 1 : 0)
