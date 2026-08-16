import { timeZoneTrade } from "../stores/ui.js"
import { tradesData } from "../stores/trades.js"
import { selectedBroker } from "../stores/filters.js"

/* MODULES */
import Papa from 'papaparse'
import i18n from '../i18n'
import { parseBitunixRows, parseBitgetRows } from './brokers-kern.js'

/**
 * Parse Bitunix CSV export.
 * CSV Format: Date (UTC),Label,Outgoing Asset,Outgoing Amount,Incoming Asset,Incoming Amount,Fee Asset,Fee Amount,Trx. ID,Comment
 * Only processes "Futures Profit" and "Futures Loss" rows.
 * Each row becomes a completed trade entry in tradesData.
 *
 * Die Zeilen-Logik liegt in `brokers-kern.js` (dort testbar, ohne Vue-Globals);
 * dieser Wrapper macht nur noch CSV-Parsing und das Befüllen von tradesData.
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

            const { trades } = parseBitunixRows(parsed.data)
            if (trades.length === 0) {
                reject("No 'Futures Profit' or 'Futures Loss' rows found in CSV")
                return
            }
            tradesData.push(...trades)

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
                reject(i18n.global.t('addTrades.noCsvData'))
                return
            }

            const { trades, unbekannteSides } = parseBitgetRows(parsed.data)

            if (trades.length === 0) {
                reject(i18n.global.t('addTrades.noValidBitgetTrades'))
                return
            }
            tradesData.push(...trades)

            console.log(" -> Parsed " + tradesData.length + " Bitget trades")
            if (unbekannteSides > 0) {
                // Sichtbar machen statt still raten: der Import läuft durch,
                // aber der Nutzer erfährt, dass die Richtung geraten wurde.
                console.warn(` -> ${unbekannteSides} Zeile(n) ohne erkennbare Richtung — als Short importiert`)
                alert(`${unbekannteSides} von ${tradesData.length} Zeilen hatten keine erkennbare Richtung (Long/Short) und wurden als Short importiert. Bitte Long/Short-Statistik prüfen.`)
            }
            resolve()
        } catch (error) {
            reject("Error parsing Bitget CSV: " + error.message)
        }
    })
}
