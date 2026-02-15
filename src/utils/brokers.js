
import { tradesData, timeZoneTrade } from "../stores/globals.js"

/* MODULES */
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
dayjs.extend(utc)
import timezone from 'dayjs/plugin/timezone.js'
dayjs.extend(timezone)
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
