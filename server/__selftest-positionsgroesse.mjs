/**
 * Selbsttest der Positionsgrösse.
 *
 *   node server/__selftest-positionsgroesse.mjs
 *
 * `computePositionSize` hatte bis zum 20.08.2026 KEINE Abdeckung — obwohl sie
 * entscheidet, wie viel Geld je Setup im Feuer steht. Anlass war der Umbau auf
 * getrennte Maker-/Taker-Sätze: die Funktion rechnete vorher pauschal
 * `2 × (Gebühr + Slippage)`, also beide Seiten zum selben Satz und beide
 * rutschend. Das ist bei einer Limit-Order an der Zone doppelt falsch.
 *
 * Gerechnet wird jetzt der WEG ZUM STOP — Einstieg zu seiner Ordersorte,
 * Ausstieg als Stop-Market. Der gute Ausgang ist billiger; ihn einzupreisen
 * würde die Position vergrössern, und die Grösse soll sich am schlechten
 * Ausgang bemessen.
 */

import { computePositionSize, RISK_REASONS } from './risk-engine.js'

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}
const nah = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

console.log('\nPositionsgrösse')

// Grundfall: 1000 USDT, 1 % Risiko, Stop 1 % entfernt → 10 USDT / 1 USD = 10 Stück
const basis = { equity: 1000, riskPerTradePct: 1, entry: 100, stopLoss: 99, leverage: 10, maxNotionalUsdt: 1e9 }
{
    const s = computePositionSize({ ...basis, costs: {} })
    pruefe('ohne Kosten: qty = Risiko / Stopabstand', nah(s.qty, 10), `qty ${s.qty}`)
    pruefe('kein Deckel gemeldet', s.capped === false)
}

// Limit-Einstieg (Maker 1,4), Stop als Markt (Taker 4,2 + 2 Slippage):
// Kosten je Einheit = 100 × 7,6/10000 = 0,076 → qty = 10 / 1,076
{
    const costs = { feeMakerBps: 1.4, feeTakerBps: 4.2, slippageBps: 2, entryOrder: 'limit' }
    const s = computePositionSize({ ...basis, costs })
    pruefe('Limit-Einstieg rechnet nur den Stop-Ausstieg als Markt',
        nah(s.qty, 10 / 1.076, 1e-9), `qty ${s.qty}`)
}

// Markt-Einstieg: beide Seiten Taker + beide rutschen = 12,4 bp
{
    const costs = { feeMakerBps: 1.4, feeTakerBps: 4.2, slippageBps: 2, entryOrder: 'market' }
    const s = computePositionSize({ ...basis, costs })
    pruefe('Markt-Einstieg ist teurer und ergibt eine kleinere Position',
        nah(s.qty, 10 / 1.124, 1e-9), `qty ${s.qty}`)
}

// Ein Maker-Satz von 0 ist real (manche Gebührenstufen) und darf nicht
// versehentlich den Taker-Satz mitnullen.
{
    const s = computePositionSize({ ...basis, costs: { feeMakerBps: 0, feeTakerBps: 4.2, slippageBps: 0, entryOrder: 'limit' } })
    pruefe('Maker 0 nullt den Taker-Satz nicht', nah(s.qty, 10 / 1.042, 1e-9), `qty ${s.qty}`)
}

// Rückfall auf den alten Einzelsatz
{
    const s = computePositionSize({ ...basis, costs: { feeBps: 6, slippageBps: 2, entryOrder: 'market' } })
    pruefe('alter Einzelsatz gilt weiter für beide Seiten',
        nah(s.qty, 10 / 1.16, 1e-9), `qty ${s.qty}`)
}

// Der Deckel ist bindend — und macht `riskPerTradePct` unerreichbar.
// Genau das war am 20.08.2026 der Fall: 43 von 62 Trades hingen am Deckel,
// das echte Risiko lag bei Ø 2,82 statt 10 USDT. Das ist gewolltes Verhalten
// (Schutz gegen enge Stops), aber es soll niemanden überraschen.
{
    const s = computePositionSize({ ...basis, maxNotionalUsdt: 500, costs: {} })
    const echtesRisiko = s.qty * Math.abs(basis.entry - basis.stopLoss)
    pruefe('Deckel greift und meldet sich', s.capped === true && nah(s.qty, 5))
    pruefe('…und das echte Risiko liegt dann UNTER dem eingestellten Prozentsatz',
        nah(echtesRisiko, 5) && echtesRisiko < 10, `${echtesRisiko} statt 10 USDT`)
}

// Marge deckelt ebenfalls: Hebel 1 erlaubt höchstens Kontostand/Kurs Stück.
{
    const s = computePositionSize({ ...basis, riskPerTradePct: 10, leverage: 1, costs: {} })
    pruefe('Marge deckelt bei Hebel 1', s.capped === true && nah(s.qty, 10))
}

// Ungültige Eingaben ergeben keine Position, sondern einen Grund.
{
    pruefe('Stop auf dem Einstieg ergibt keine Position',
        computePositionSize({ ...basis, stopLoss: 100, costs: {} }).reason === RISK_REASONS.BAD_LEVELS)
    pruefe('ohne Kontostand keine Position',
        computePositionSize({ ...basis, equity: 0, costs: {} }).reason === RISK_REASONS.NO_EQUITY)
    pruefe('fehlendes costs-Objekt bricht nicht',
        nah(computePositionSize({ ...basis }).qty, 10))
}

// Short: der Stopabstand zählt, nicht die Richtung.
{
    const s = computePositionSize({ ...basis, entry: 100, stopLoss: 101, costs: {} })
    pruefe('Short spiegelt sauber', nah(s.qty, 10), `qty ${s.qty}`)
}

console.log(`\n${fehler === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler === 0 ? 0 : 1)
