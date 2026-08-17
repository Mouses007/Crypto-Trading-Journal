/**
 * Selbsttest der CSV-Import-Kerne (Bitunix + Bitget).
 *
 *   node src/utils/__selftest-brokers.mjs
 *
 * Der Import ist der geldführendste Pfad des Journals: ein Parser-Fehler
 * verfälscht still den Bestand, und niemand rechnet einen CSV-Import nach.
 * Getestet wird der reine Kern (`brokers-kern.js`) — Zeilen rein, Trades raus.
 */

import { parseBitunixRows, parseBitgetRows } from './brokers-kern.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const nah = (a, b) => Math.abs(a - b) < 1e-9

console.log('\nBitunix-Kontoauszug\n')

{
    const zeilen = [
        // Gewinn: Incoming Amount ist NETTO, Fee kommt fürs Brutto obendrauf
        { 'Date (UTC)': '2026-08-01 10:00:00', Label: 'Futures Profit', 'Incoming Asset': 'USDT', 'Incoming Amount': '16.5607', 'Fee Asset': 'USDT', 'Fee Amount': '1.1726', 'Trx. ID': 'T1', Comment: 'BTCUSDT' },
        // Verlust: Outgoing Amount ist der NETTO-Abfluss, Vorzeichen wird negativ
        { 'Date (UTC)': '2026-08-01 12:00:00', Label: 'Futures Loss', 'Outgoing Asset': 'USDT', 'Outgoing Amount': '24.50', 'Fee Asset': 'USDT', 'Fee Amount': '0.50', 'Trx. ID': 'T2', Comment: 'ETHUSDT' },
        // Andere Kontobewegungen sind KEINE Trades
        { 'Date (UTC)': '2026-08-01 13:00:00', Label: 'Transfer', 'Incoming Amount': '100', 'Trx. ID': 'T3' },
        { 'Date (UTC)': '2026-08-01 14:00:00', Label: 'Funding Fee', 'Outgoing Amount': '0.01', 'Trx. ID': 'T4' },
    ]
    const { trades, uebersprungen } = parseBitunixRows(zeilen)

    check('nur Profit-/Loss-Zeilen werden Trades', trades.length === 2 && uebersprungen === 2, `${trades.length}/${uebersprungen}`)

    const [g, v] = trades
    check('Gewinn: netto = CSV-Betrag', nah(g.NetProceeds, 16.5607), String(g.NetProceeds))
    check('Gewinn: brutto = netto + Gebühr', nah(g.GrossProceeds, 16.5607 + 1.1726), String(g.GrossProceeds))
    check('Symbol kommt aus dem Kommentar', g.Symbol === 'BTCUSDT')

    check('Verlust wird negativ gebucht', nah(v.NetProceeds, -24.5), String(v.NetProceeds))
    check('Verlust brutto = netto + Gebühr (näher an null)', nah(v.GrossProceeds, -24.0), String(v.GrossProceeds))
    check('Gebühr immer positiv geführt', v.Fee === 0.5 && g.Fee === 1.1726)

    // Ein Verlust, der als positive Zahl exportiert wird, darf nicht als
    // Gewinn durchgehen — Outgoing wird IMMER negativ gebucht.
    const { trades: absTest } = parseBitunixRows([
        { Label: 'Futures Loss', 'Outgoing Amount': '-3.00', 'Fee Amount': '0' },
    ])
    check('Vorzeichen im Outgoing-Feld ist egal, Verlust bleibt Verlust', nah(absTest[0].NetProceeds, -3))

    check('fehlende Fee-Spalte ergibt 0, nicht NaN',
        parseBitunixRows([{ Label: 'Futures Profit', 'Incoming Amount': '5' }]).trades[0].Fee === 0)
    check('leere Eingabe ergibt leere Liste', parseBitunixRows([]).trades.length === 0)
    check('undefined kippt nicht um', parseBitunixRows(undefined).trades.length === 0)
}

console.log('\nBitget-Verlauf\n')

{
    const zeilen = [
        // Voll ausgestattete Zeile: netProfit vorhanden (Wallet-Delta)
        { symbol: 'SOLUSDT', holdSide: 'long', openAvgPrice: '100', closeAvgPrice: '110', pnl: '10', netProfit: '9.4', openFee: '0.3', closeFee: '0.33', totalFunding: '0.03', closeTotalPos: '1', uTime: '1754040000000', cTime: '1754030000000', positionId: 'P1' },
        // Break-even: netProfit exakt 0 ist ein GÜLTIGER Wert, kein „fehlt"
        { symbol: 'ETHUSDT', holdSide: 'short', openAvgPrice: '3000', closeAvgPrice: '3000', pnl: '0.5', netProfit: '0', openFee: '0.25', closeFee: '0.25', totalFunding: '0', closeTotalPos: '0.1', uTime: '1754050000000', cTime: '1754040000000', positionId: 'P2' },
        // Ohne netProfit: netto = brutto − tradingFee + funding (signiert!)
        { symbol: 'XRPUSDT', holdSide: 'long', openAvgPrice: '0.5', closeAvgPrice: '0.55', pnl: '5', netProfit: '', openFee: '0.1', closeFee: '0.1', totalFunding: '-0.2', closeTotalPos: '100', uTime: '2026-08-01 10:00:00', cTime: '', positionId: 'P3' },
        // Unbekannte Side-Schreibweise → zählt als unerkannt
        { symbol: 'DOGEUSDT', holdSide: 'umgekehrt', openAvgPrice: '0.1', closeAvgPrice: '0.09', pnl: '-1', netProfit: '-1.1', openFee: '0.05', closeFee: '0.05', totalFunding: '0', closeTotalPos: '10', uTime: '1754060000000', cTime: '', positionId: 'P4' },
    ]
    const { trades, unbekannteSides } = parseBitgetRows(zeilen)

    check('vier Zeilen, vier Trades', trades.length === 4, String(trades.length))
    check('long → B, short → SS', trades[0].Side === 'B' && trades[1].Side === 'SS')
    check('unerkannte Richtung wird GEZÄHLT statt still geraten', unbekannteSides === 1, String(unbekannteSides))

    check('netProfit wird als Wallet-Delta übernommen', nah(trades[0].NetProceeds, 9.4))
    check('Trading-Fee = open + close, ohne Funding', nah(trades[0].Fee, 0.63), String(trades[0].Fee))

    check('Break-even 0 bleibt 0 (hasNet-Check)', trades[1].NetProceeds === 0, String(trades[1].NetProceeds))

    // Fallback-Formel: 5 − 0,2 + (−0,2) = 4,6
    check('ohne netProfit: netto = brutto − Fee + Funding (signiert)', nah(trades[2].NetProceeds, 4.6), String(trades[2].NetProceeds))

    // Funding und Trading-Fee dürfen nicht nur in den Netto-Fallback fliessen,
    // sondern müssen als eigene Felder im Trade landen — addTrades.js liest
    // row.FundingFee/row.TradingFee, und ohne die Felder zeigte das Journal
    // Funding=0, obwohl die CSV es hatte.
    check('FundingFee steht signiert im Trade-Objekt', nah(trades[0].FundingFee, 0.03) && nah(trades[2].FundingFee, -0.2),
        JSON.stringify({ p1: trades[0].FundingFee, p3: trades[2].FundingFee }))
    check('TradingFee steht getrennt im Trade-Objekt', nah(trades[0].TradingFee, 0.63), String(trades[0].TradingFee))

    // 1754040000000 ms = 2025-08-01 09:20:00 UTC
    check('13-stelliger Zeitstempel wird zu UTC-Datum', trades[0].DateUTC === '2025-08-01 09:20:00', trades[0].DateUTC)
    check('Datums-Text bleibt unangetastet', trades[2].DateUTC === '2026-08-01 10:00:00')
    check('fehlende Open-Zeit fällt auf die Schlusszeit zurück', trades[2].EntryDateUTC === trades[2].DateUTC)

    // Nur-Fee-Spalte (älteres Exportformat)
    const { trades: alt } = parseBitgetRows([
        { symbol: 'BTCUSDT', side: 'buy', pnl: '2', fee: '-0.4', qty: '1', Time: '2026-08-01 11:00:00' },
    ])
    check('altes Format: einzelne Fee-Spalte, Betrag positiv', alt.length === 1 && nah(alt[0].Fee, 0.4), JSON.stringify(alt[0] || {}))
    check('altes Format: netto = brutto − Fee', nah(alt[0].NetProceeds, 1.6), String(alt[0]?.NetProceeds))

    check('leere Zeilen ohne PnL werden übersprungen',
        parseBitgetRows([{ symbol: 'X', pnl: '' }]).trades.length === 0)
    check('leere Eingabe ergibt leere Liste', parseBitgetRows([]).trades.length === 0)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
