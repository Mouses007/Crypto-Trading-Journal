/**
 * Kern der Journal-Summen — rein, ohne Vue, ohne Stores, ohne Netz.
 *
 * Bisher lebte dieselbe ~35-Feld-Summierung zweimal in `trades.js` (globale
 * Totale und Tagesgruppen) und summierte `el.grossProceeds` & Co. ungeschützt:
 * EIN Trade ohne Feld machte alle Totale zu NaN, und das Dashboard zeigte
 * Müll. Hier steht die Summierung genau einmal, jede Zahl läuft durch `z()`,
 * und `__selftest-totals.mjs` rechnet sie nach.
 *
 * Vorzeichen-Konventionen (Journal-Kanon):
 *   - fundingFee: + = erhalten (erhöht Netto), − = bezahlt (senkt Netto)
 *     → aufgeteilt via `splitFunding` aus funding.js
 *   - Break-even (0) zählt als GEWINNER — wie in server/journal-bridge.js
 *     dokumentiert. Die Zählung selbst passiert beim Import (netWinsCount);
 *     hier wird nur summiert.
 */

import { splitFunding } from './funding.js'

/** Zahl oder 0 — nie NaN, nie undefined in eine Summe. */
export function z(v) {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}

/** Leerer Summen-Akkumulator mit allen Feldern, die Totale und Tagesgruppen tragen. */
export function neueSummen() {
    return {
        buyQuantity: 0, sellQuantity: 0,
        commission: 0, fundingFees: 0, fundingPaid: 0, fundingReceived: 0,
        tradingFees: 0, sec: 0, taf: 0, nscc: 0, nasdaq: 0,
        otherCommission: 0, fees: 0,
        grossProceeds: 0, grossWins: 0, grossLoss: 0, grossSharePL: 0,
        grossSharePLWins: 0, grossSharePLLoss: 0,
        highGrossSharePLWin: 0, highGrossSharePLLoss: 0,
        netProceeds: 0, netWins: 0, netLoss: 0, netSharePL: 0,
        netSharePLWins: 0, netSharePLLoss: 0,
        highNetSharePLWin: 0, highNetSharePLLoss: 0,
        executions: 0, trades: 0,
        grossWinsQuantity: 0, grossLossQuantity: 0, grossWinsCount: 0, grossLossCount: 0,
        netWinsQuantity: 0, netLossQuantity: 0, netWinsCount: 0, netLossCount: 0,
        financials: 0,
    }
}

/** Addiert einen Trade (eine Zeile aus `trades.trades`) auf den Akkumulator. */
export function summiereTrade(s, el) {
    s.buyQuantity += z(el.buyQuantity)
    s.sellQuantity += z(el.sellQuantity)

    s.commission += z(el.commission)
    s.fundingFees += z(el.fundingFee)
    const funding = splitFunding(el.fundingFee)
    s.fundingPaid += funding.paid
    s.fundingReceived += funding.received
    s.tradingFees += z(el.tradingFee)
    s.sec += z(el.sec)
    s.taf += z(el.taf)
    s.nscc += z(el.nscc)
    s.nasdaq += z(el.nasdaq)
    s.otherCommission += z(el.sec) + z(el.taf) + z(el.nscc) + z(el.nasdaq)
    s.fees += z(el.commission) + z(el.sec) + z(el.taf) + z(el.nscc) + z(el.nasdaq)

    s.grossProceeds += z(el.grossProceeds)
    s.grossWins += z(el.grossWins)
    s.grossLoss += z(el.grossLoss)
    s.grossSharePL += z(el.grossSharePL)
    s.grossSharePLWins += z(el.grossSharePLWins)
    s.grossSharePLLoss += z(el.grossSharePLLoss)
    const gsp = z(el.grossSharePL)
    if (gsp >= 0 && gsp > s.highGrossSharePLWin) s.highGrossSharePLWin = gsp
    if (gsp < 0 && gsp < s.highGrossSharePLLoss) s.highGrossSharePLLoss = gsp

    s.netProceeds += z(el.netProceeds)
    s.netWins += z(el.netWins)
    s.netLoss += z(el.netLoss)
    s.netSharePL += z(el.netSharePL)
    s.netSharePLWins += z(el.netSharePLWins)
    s.netSharePLLoss += z(el.netSharePLLoss)
    const nsp = z(el.netSharePL)
    if (nsp >= 0 && nsp > s.highNetSharePLWin) s.highNetSharePLWin = nsp
    if (nsp < 0 && nsp < s.highNetSharePLLoss) s.highNetSharePLLoss = nsp

    s.executions += z(el.executionsCount)
    s.trades += z(el.tradesCount)
    s.grossWinsQuantity += z(el.grossWinsQuantity)
    s.grossLossQuantity += z(el.grossLossQuantity)
    s.grossWinsCount += z(el.grossWinsCount)
    s.grossLossCount += z(el.grossLossCount)
    s.netWinsQuantity += z(el.netWinsQuantity)
    s.netLossQuantity += z(el.netLossQuantity)
    s.netWinsCount += z(el.netWinsCount)
    s.netLossCount += z(el.netLossCount)
    s.financials += z(el.financials)
    return s
}

/**
 * Abgeleitete Kennzahlen (Winrate, Durchschnitte) — geteilt wird nie durch 0.
 * Genau die Felder, die das Dashboard aus den Totalen liest.
 */
export function leiteKennzahlenAb(s) {
    return {
        probGrossWins: s.trades ? (s.grossWinsCount / s.trades) : 0,
        probGrossLoss: s.trades ? (s.grossLossCount / s.trades) : 0,
        probNetWins: s.trades ? (s.netWinsCount / s.trades) : 0,
        probNetLoss: s.trades ? (s.netLossCount / s.trades) : 0,
        avgGrossWins: s.grossWinsCount ? (s.grossWins / s.grossWinsCount) : 0,
        avgGrossLoss: s.grossLossCount ? -(s.grossLoss / s.grossLossCount) : 0,
        avgNetWins: s.netWinsCount ? (s.netWins / s.netWinsCount) : 0,
        avgNetLoss: s.netLossCount ? -(s.netLoss / s.netLossCount) : 0,
        avgGrossSharePLWins: s.grossWinsCount ? (s.grossSharePLWins / s.grossWinsCount) : 0,
        avgGrossSharePLLoss: s.grossLossCount ? -(s.grossSharePLLoss / s.grossLossCount) : 0,
        avgNetSharePLWins: s.netWinsCount ? (s.netSharePLWins / s.netWinsCount) : 0,
        avgNetSharePLLoss: s.netLossCount ? -(s.netSharePLLoss / s.netLossCount) : 0,
    }
}
