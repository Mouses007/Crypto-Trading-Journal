/**
 * Selbsttest Zwischenstand offener Positionen — ohne Netz, ohne Datenbank.
 *
 *   node server/execution/__selftest-zwischenstand.mjs
 *
 * Zwei Fallen: das Funding-Vorzeichen (Long zahlt bei positivem Satz, Short
 * erhält — vertauscht sieht jede Zahl plausibel aus) und eine zweite Rechnung
 * neben `closePosition()`, die von der späteren Buchung abweicht.
 */

import { fundingAusVerlauf, zwischenstandPosition, summiereJeInstanz } from './zwischenstand.js'
import { closePosition, kostenAus } from '../fill-simulator.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nahe = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

const H = 3600000
const t0 = Date.UTC(2026, 8, 1, 0, 0, 0)

console.log('\nFunding aus dem echten Verlauf\n')
{
    const verlauf = [
        { t: t0 - 8 * H, rate: 0.001, markPrice: 100 },   // vor dem Einstieg
        { t: t0 + 8 * H, rate: 0.0001, markPrice: 100 },
        { t: t0 + 16 * H, rate: 0.0002, markPrice: 110 },
        { t: t0 + 24 * H, rate: -0.0001, markPrice: 0 },  // ohne Mark-Preis
        { t: t0 + 32 * H, rate: 0.01, markPrice: 100 },   // nach `bis`
    ]
    const basis = { qty: 2, entryTime: t0, bis: t0 + 24 * H, ersatzPreis: 105 }
    const long = fundingAusVerlauf(verlauf, { ...basis, direction: 'long' })
    const short = fundingAusVerlauf(verlauf, { ...basis, direction: 'short' })
    // 2·100·0,0001 + 2·110·0,0002 + 2·105·(−0,0001) = 0,02 + 0,044 − 0,021 = 0,043
    check('Long zahlt bei positivem Satz (negatives Vorzeichen)', nahe(long, -0.043), `long=${long}`)
    check('Short erhält dieselben Zahlungen (positives Vorzeichen)', nahe(short, 0.043), `short=${short}`)
    check('Abrechnung vor dem Einstieg zählt nicht',
        nahe(fundingAusVerlauf([verlauf[0]], { ...basis, direction: 'long' }), 0))
    check('Abrechnung nach `bis` zählt nicht',
        nahe(fundingAusVerlauf([verlauf[4]], { ...basis, direction: 'long' }), 0))
    check('fehlender Mark-Preis → Ersatzpreis',
        nahe(fundingAusVerlauf([verlauf[3]], { ...basis, direction: 'long' }), 2 * 105 * 0.0001))
    check('leerer/kaputter Verlauf → 0',
        fundingAusVerlauf([], { ...basis, direction: 'long' }) === 0
        && fundingAusVerlauf(null, { ...basis, direction: 'long' }) === 0)
}

console.log('\nZwischenstand = Buchung beim Schliessen\n')
const costs = kostenAus({ feeMakerBps: 2, feeTakerBps: 6, slippageBps: 2, fundingBpsPer8h: 0 })
const pos = {
    setupId: 1, symbol: 'XRPUSDT', timeframe: '1d', direction: 'long',
    qty: 100, initialQty: 100, entryPrice: 1.5, entryTime: t0,
    stopLoss: 1.2, initialStopLoss: 1.2, takeProfit: 2.1,
    leverage: 3, notionalUsdt: 150, marginUsdt: 50, feeOpen: 0.03,
    maePrice: 1.5, mfePrice: 1.5, partialGross: 0, partialFee: 0,
}
{
    const jetzt = t0 + 36 * 24 * H
    const s = zwischenstandPosition(pos, { preis: 1.6, jetzt, costs, funding: -0.4 })
    const ref = closePosition(pos, { price: 1.6, reason: 'manual', time: jetzt }, costs, { funding: -0.4 })
    check('Brutto identisch mit closePosition()', nahe(s.grossPnl, ref.grossPnl))
    check('Netto identisch mit closePosition()', nahe(s.netPnl, ref.netPnl))
    check('R identisch mit closePosition()', nahe(s.rMultiple, ref.rMultiple))
    check('Ausstieg als Marktorder: Slippage drückt den Long-Ausstieg', s.exitPrice < 1.6)
    check('Gebühren zerlegt: bezahlt + beim Schliessen = gesamt',
        nahe(s.feeOpen + s.feePartial + s.feeClose, s.fees) && nahe(s.feeOpen, 0.03))
    check('Ausstiegsgebühr ist Taker (6 bps auf den Fill)',
        nahe(s.feeClose, s.exitPrice * 100 * 0.0006))
    check('Netto = Brutto − Gebühren + Funding', nahe(s.netPnl, s.grossPnl - s.fees + s.funding))
    check('Haltedauer stimmt', s.heldMs === 36 * 24 * H)

    const ohne = zwischenstandPosition(pos, { preis: 1.6, jetzt, costs, funding: null })
    check('unbekanntes Funding bleibt null, statt als 0 zu erscheinen', ohne.funding === null)
    check('… und fliesst nicht ins Netto ein', nahe(ohne.netPnl, ohne.grossPnl - ohne.fees))

    const short = zwischenstandPosition({ ...pos, direction: 'short', stopLoss: 1.8, initialStopLoss: 1.8 },
        { preis: 1.4, jetzt, costs, funding: 0 })
    check('Short im Plus bei fallendem Kurs', short.grossPnl > 0)
}

console.log('\nSummen je Instanz\n')
{
    const e = [
        { instanceId: 13, stand: { grossPnl: 2, fees: 0.5, funding: -0.1, netPnl: 1.4 } },
        { instanceId: 13, stand: { grossPnl: 1, fees: 0.2, funding: null, netPnl: 0.8 } },
        { instanceId: 14, stand: null },
    ]
    const s = summiereJeInstanz(e)
    check('Summen je Instanz', nahe(s[13].grossPnl, 3) && nahe(s[13].fees, 0.7) && nahe(s[13].netPnl, 2.2))
    check('unbekanntes Funding wird gezählt, nicht als 0 addiert',
        nahe(s[13].funding, -0.1) && s[13].fundingUnbekannt === 1)
    check('Position ohne Stand zählt nicht mit', s[14] === undefined)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
