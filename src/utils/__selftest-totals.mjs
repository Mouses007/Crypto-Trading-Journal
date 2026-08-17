/**
 * Selbsttest der Journal-Summen — ohne Vue, ohne Stores, ohne Netz.
 *
 *   node src/utils/__selftest-totals.mjs
 *
 * Bisher war der Geld-Pfad des Dashboards ungetestet — genau hier lag der
 * Funding-Vorzeichen-Bug, und ein einziges fehlendes Feld machte alle Totale
 * zu NaN. Der Kern (totals-kern.js) wird hier mit einem kleinen Fixture
 * nachgerechnet: Gewinn, Verlust, Break-even, Funding in beide Richtungen und
 * ein absichtlich kaputter Trade ohne Felder.
 */

import { z, neueSummen, summiereTrade, leiteKennzahlenAb } from './totals-kern.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const nahe = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

console.log('\nZahlen-Wächter z()\n')

check('Zahl bleibt Zahl', z(12.5) === 12.5 && z(-3) === -3 && z(0) === 0)
check('String-Zahl wird Zahl', z('7.25') === 7.25)
check('undefined/null/NaN/Text werden 0',
    z(undefined) === 0 && z(null) === 0 && z(NaN) === 0 && z('abc') === 0 && z(Infinity) === 0)

console.log('\nSummierung (Fixture: Gewinn, Verlust, Break-even, kaputter Trade)\n')

{
    // Felder wie sie eine Zeile aus `trades.trades` trägt (Tages-Blotter).
    const gewinn = {
        buyQuantity: 10, sellQuantity: 10, commission: 0, sec: 0, taf: 0, nscc: 0, nasdaq: 0,
        grossProceeds: 120, grossWins: 120, grossLoss: 0, grossSharePL: 12,
        grossSharePLWins: 12, grossSharePLLoss: 0,
        netProceeds: 100, netWins: 100, netLoss: 0, netSharePL: 10,
        netSharePLWins: 10, netSharePLLoss: 0,
        tradingFee: 15, fundingFee: -5,     // 5 bezahlt
        executionsCount: 2, tradesCount: 1,
        grossWinsQuantity: 10, grossLossQuantity: 0, grossWinsCount: 1, grossLossCount: 0,
        netWinsQuantity: 10, netLossQuantity: 0, netWinsCount: 1, netLossCount: 0,
        financials: 0,
    }
    const verlust = {
        buyQuantity: 4, sellQuantity: 4, commission: 0, sec: 0, taf: 0, nscc: 0, nasdaq: 0,
        grossProceeds: -50, grossWins: 0, grossLoss: -50, grossSharePL: -12.5,
        grossSharePLWins: 0, grossSharePLLoss: -12.5,
        netProceeds: -47, netWins: 0, netLoss: -47, netSharePL: -11.75,
        netSharePLWins: 0, netSharePLLoss: -11.75,
        tradingFee: 1, fundingFee: 4,       // 4 erhalten
        executionsCount: 1, tradesCount: 1,
        grossWinsQuantity: 0, grossLossQuantity: 4, grossWinsCount: 0, grossLossCount: 1,
        netWinsQuantity: 0, netLossQuantity: 4, netWinsCount: 0, netLossCount: 1,
        financials: 0,
    }
    // Break-even: 0 zählt nach Journal-Kanon als Gewinner (netWinsCount: 1).
    const breakEven = {
        buyQuantity: 1, sellQuantity: 1, commission: 0, sec: 0, taf: 0, nscc: 0, nasdaq: 0,
        grossProceeds: 0, grossWins: 0, grossLoss: 0, grossSharePL: 0,
        grossSharePLWins: 0, grossSharePLLoss: 0,
        netProceeds: 0, netWins: 0, netLoss: 0, netSharePL: 0,
        netSharePLWins: 0, netSharePLLoss: 0,
        tradingFee: 0, fundingFee: 0,
        executionsCount: 1, tradesCount: 1,
        grossWinsQuantity: 1, grossLossQuantity: 0, grossWinsCount: 1, grossLossCount: 0,
        netWinsQuantity: 1, netLossQuantity: 0, netWinsCount: 1, netLossCount: 0,
        financials: 0,
    }
    // Der Härtefall: eine Zeile ohne die Geld-Felder. Vor dem Kern machte
    // `+= undefined` daraus NaN — und zwar für ALLE Totale.
    const kaputt = { tradesCount: 1 }

    const s = neueSummen()
    for (const el of [gewinn, verlust, breakEven, kaputt]) summiereTrade(s, el)

    check('alle Summenfelder sind endliche Zahlen',
        Object.values(s).every((v) => Number.isFinite(v)), JSON.stringify(s))
    check('grossProceeds = 120 − 50 + 0 + 0 = 70', nahe(s.grossProceeds, 70), String(s.grossProceeds))
    check('netProceeds = 100 − 47 + 0 + 0 = 53', nahe(s.netProceeds, 53), String(s.netProceeds))
    check('tradingFees = 15 + 1 = 16', nahe(s.tradingFees, 16), String(s.tradingFees))
    check('fundingFees signiert: −5 + 4 = −1', nahe(s.fundingFees, -1), String(s.fundingFees))
    check('fundingPaid = 5, fundingReceived = 4 (Kanon: + = erhalten)',
        nahe(s.fundingPaid, 5) && nahe(s.fundingReceived, 4),
        `paid=${s.fundingPaid} received=${s.fundingReceived}`)
    check('trades zählt auch die kaputte Zeile (4)', s.trades === 4)
    check('netWinsCount = 2 (Gewinn + Break-even), netLossCount = 1',
        s.netWinsCount === 2 && s.netLossCount === 1)
    check('High-Wasser: bester netSharePL 10, schlechtester −11.75',
        nahe(s.highNetSharePLWin, 10) && nahe(s.highNetSharePLLoss, -11.75))

    const k = leiteKennzahlenAb(s)
    check('Winrate netto = 2/4 = 0.5 — unabhängig von der View', nahe(k.probNetWins, 0.5), String(k.probNetWins))
    check('avgNetWins = 100/2 = 50, avgNetLoss = −(−47/1) = 47',
        nahe(k.avgNetWins, 50) && nahe(k.avgNetLoss, 47),
        `avgNetWins=${k.avgNetWins} avgNetLoss=${k.avgNetLoss}`)
    check('alle Kennzahlen endlich', Object.values(k).every((v) => Number.isFinite(v)))

    const leer = leiteKennzahlenAb(neueSummen())
    check('leerer Bestand: Kennzahlen 0 statt NaN (keine Division durch 0)',
        Object.values(leer).every((v) => v === 0))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
