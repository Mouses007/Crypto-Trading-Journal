
import { timeZoneTrade } from "../stores/ui.js"
import { tradesData } from "../stores/trades.js"
import { selectedBroker } from "../stores/filters.js"

/* MODULES */
import dayjs from './dayjs-setup.js'
import Papa from 'papaparse'

/**
 * Parse Bitunix CSV export.
 * CSV Format: Date (UTC),Label,Outgoing Asset,Outgoing Amount,Incoming Asset,Incoming Amount,Fee Asset,Fee Amount,Trx. ID,Comment
 * Only processes "Futures Profit" and "Futures Loss" rows.
 * Each row becomes a completed trade entry in tradesData.
 */
export async function useBrokerBitunix(csvInput) {
    return new Promise((resolve, reject) => {
        try {
            const parsed = Papa.parse(csvInput, { header: true, skipEmptyLines: true })

            if (parsed.errors.length > 0 && parsed.data.length === 0) {
                reject("CSV parse error: " + parsed.errors[0].message)
                return
            }

            tradesData.length = 0

            const relevantRows = parsed.data.filter(row => {
                const label = (row.Label || '').trim()
                return label === 'Futures Profit' || label === 'Futures Loss'
            })

            if (relevantRows.length === 0) {
                reject("No 'Futures Profit' or 'Futures Loss' rows found in CSV")
                return
            }

            relevantRows.forEach(row => {
                const label = row.Label.trim()
                const isProfit = label === 'Futures Profit'

                let grossPL = 0
                if (isProfit) {
                    grossPL = parseFloat(row['Incoming Amount'] || 0)
                } else {
                    grossPL = -Math.abs(parseFloat(row['Outgoing Amount'] || 0))
                }

                const fee = Math.abs(parseFloat(row['Fee Amount'] || 0))
                const netPL = grossPL - fee

                // Extract symbol from Comment if available
                const comment = (row.Comment || '').trim()
                const symbol = comment || 'FUTURES'

                // Parse date - CSV dates are in UTC
                const dateStr = (row['Date (UTC)'] || '').trim()

                tradesData.push({
                    Account: 'bitunix',
                    DateUTC: dateStr,
                    Symbol: symbol,
                    Type: 'futures',
                    GrossProceeds: grossPL,
                    Fee: fee,
                    NetProceeds: netPL,
                    TrxId: (row['Trx. ID'] || '').trim(),
                    IncomingAsset: (row['Incoming Asset'] || '').trim(),
                    OutgoingAsset: (row['Outgoing Asset'] || '').trim(),
                })
            })

            console.log(" -> Parsed " + tradesData.length + " Bitunix trades")
            resolve()
        } catch (error) {
            reject("Error parsing Bitunix CSV: " + error.message)
        }
    })
}

/**
 * Parse Bitget CSV export (Futures P&L / Trade History).
 * Bitget CSV typically has columns like:
 * - Symbol, Side/holdSide, Open Price, Close Price, PnL, Net Profit, Open Fee, Close Fee, Funding, Time
 * We try multiple column name patterns to be flexible.
 */
export async function useBrokerBitget(csvInput) {
    return new Promise((resolve, reject) => {
        try {
            const parsed = Papa.parse(csvInput, { header: true, skipEmptyLines: true })

            if (parsed.errors.length > 0 && parsed.data.length === 0) {
                reject("CSV parse error: " + parsed.errors[0].message)
                return
            }

            tradesData.length = 0

            if (parsed.data.length === 0) {
                reject("Keine Daten in der CSV-Datei gefunden")
                return
            }

            // Detect columns — Bitget CSV can have various headers
            const headers = Object.keys(parsed.data[0])
            const findCol = (...names) => headers.find(h => names.some(n => h.toLowerCase().includes(n.toLowerCase())))

            const colSymbol = findCol('symbol', 'Symbol', 'Pair')
            const colSide = findCol('holdSide', 'side', 'Side', 'Direction')
            const colOpenPrice = findCol('openAvgPrice', 'Open Price', 'Entry Price', 'openPrice', 'Avg Open')
            const colClosePrice = findCol('closeAvgPrice', 'Close Price', 'Exit Price', 'closePrice', 'Avg Close')
            const colPnl = findCol('pnl', 'PnL', 'Profit', 'realizedPnl', 'Realized PnL')
            const colNetProfit = findCol('netProfit', 'Net Profit', 'Net PnL')
            const colOpenFee = findCol('openFee', 'Open Fee')
            const colCloseFee = findCol('closeFee', 'Close Fee')
            const colFunding = findCol('totalFunding', 'Funding', 'funding')
            const colFee = findCol('Fee', 'fee', 'Fee Amount')
            const colQuantity = findCol('closeTotalPos', 'openTotalPos', 'Quantity', 'Size', 'qty')
            const colTime = findCol('uTime', 'cTime', 'Time', 'Date', 'Close Time', 'closeTime')
            const colOpenTime = findCol('cTime', 'openTime', 'Open Time')
            const colTrxId = findCol('positionId', 'Position ID', 'TradeId', 'Trx')

            parsed.data.forEach(row => {
                const grossPL = parseFloat(row[colPnl] || 0)
                if (grossPL === 0 && !row[colPnl]) return // skip empty rows

                let fee = 0
                if (colOpenFee && colCloseFee) {
                    fee = Math.abs(parseFloat(row[colOpenFee] || 0)) + Math.abs(parseFloat(row[colCloseFee] || 0))
                    if (colFunding) fee += Math.abs(parseFloat(row[colFunding] || 0))
                } else if (colFee) {
                    fee = Math.abs(parseFloat(row[colFee] || 0))
                }

                const netPL = colNetProfit ? parseFloat(row[colNetProfit] || 0) : (grossPL - fee)

                // Parse side
                const rawSide = (row[colSide] || '').toLowerCase()
                let side = 'SS' // default short
                if (rawSide === 'long' || rawSide === 'buy' || rawSide === 'b') side = 'B'

                // Parse dates — could be timestamp (ms) or date string
                let dateStr = row[colTime] || ''
                if (/^\d{13}$/.test(dateStr)) {
                    dateStr = dayjs(parseInt(dateStr)).utc().format('YYYY-MM-DD HH:mm:ss')
                }
                let entryDateStr = row[colOpenTime] || dateStr
                if (/^\d{13}$/.test(entryDateStr)) {
                    entryDateStr = dayjs(parseInt(entryDateStr)).utc().format('YYYY-MM-DD HH:mm:ss')
                }

                tradesData.push({
                    Account: 'bitget',
                    Broker: 'bitget',
                    DateUTC: dateStr,
                    EntryDateUTC: entryDateStr,
                    Symbol: row[colSymbol] || 'FUTURES',
                    Type: 'futures',
                    GrossProceeds: grossPL,
                    Fee: fee,
                    NetProceeds: netPL,
                    TrxId: row[colTrxId] || '',
                    Side: side,
                    EntryPrice: parseFloat(row[colOpenPrice] || 0),
                    ClosePrice: parseFloat(row[colClosePrice] || 0),
                    Quantity: parseFloat(row[colQuantity] || 1),
                    IncomingAsset: 'USDT',
                    OutgoingAsset: 'USDT',
                })
            })

            if (tradesData.length === 0) {
                reject("Keine gültigen Trades in der Bitget CSV gefunden")
                return
            }

            console.log(" -> Parsed " + tradesData.length + " Bitget trades")
            resolve()
        } catch (error) {
            reject("Error parsing Bitget CSV: " + error.message)
        }
    })
}
