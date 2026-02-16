import axios from 'axios'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
dayjs.extend(utc)
import { dbCreate, dbFind, dbDelete, dbUpdate as dbUpdateRecord } from './db.js'
import { dbUpdateSettings } from './db.js'
import { currentUser } from '../stores/globals.js'

/**
 * Quick API Import: Fetches trades from Bitunix API since last import,
 * creates trade objects, filters duplicates, saves to DB.
 * Returns { success, message, count }
 */
export async function useQuickApiImport() {
    console.log(' -> Starting quick API import')

    // 1. Call server endpoint that fetches positions and updates lastApiImport
    const response = await axios.post('/api/bitunix/quick-import')

    if (!response.data.ok) {
        throw new Error(response.data.error || 'Import fehlgeschlagen')
    }

    const allPositions = response.data.positions || []
    if (allPositions.length === 0) {
        return { success: true, message: 'Keine neuen Positionen gefunden.', count: 0 }
    }

    // 2. Get existing trade dates to filter duplicates
    const existingTrades = await dbFind('trades', { descending: 'dateUnix', limit: 10000 })
    const existingDates = existingTrades.map(t => t.dateUnix)

    // 3. Convert positions to trade objects grouped by day
    const tradesByDay = {}
    const executionsByDay = {}

    allPositions.forEach((pos, i) => {
        const grossPL = parseFloat(pos.realizedPNL || 0)
        const fee = Math.abs(parseFloat(pos.fee || 0)) + Math.abs(parseFloat(pos.funding || 0))
        const closeTime = parseInt(pos.mtime || pos.ctime)
        const openTime = parseInt(pos.ctime)
        const dateUnix = dayjs(closeTime).utc().startOf('day').unix()

        if (!tradesByDay[dateUnix]) tradesByDay[dateUnix] = []
        if (!executionsByDay[dateUnix]) executionsByDay[dateUnix] = []

        // Bitunix API: Pending uses 'BUY'/'SELL', History uses 'LONG'/'SHORT' — accept both
        const side = (pos.side === 'LONG' || pos.side === 'BUY') ? 'B' : 'SS'
        const netPL = grossPL - fee
        const isGrossWin = grossPL > 0
        const isNetWin = netPL > 0
        const quantity = parseFloat(pos.maxQty || 1)
        const entryTime = dayjs(openTime).utc().unix()
        const exitTime = dayjs(closeTime).utc().unix()

        const tradeObj = {
            id: `t${dateUnix}_${i}_${pos.positionId || i}`,
            account: 'bitunix',
            broker: 'bitunix',
            td: dateUnix,
            currency: 'USDT',
            type: 'futures',
            side: side,
            strategy: side === 'B' ? 'long' : 'short',
            symbol: pos.symbol || 'FUTURES',
            buyQuantity: quantity,
            sellQuantity: quantity,
            entryPrice: parseFloat(pos.entryPrice || 0),
            exitPrice: parseFloat(pos.closePrice || 0),
            entryTime: entryTime,
            exitTime: exitTime,
            grossProceeds: grossPL,
            netProceeds: netPL,
            commission: fee,
            sec: 0, taf: 0, nscc: 0, nasdaq: 0,
            grossSharePL: grossPL,
            netSharePL: netPL,
            grossWins: isGrossWin ? grossPL : 0,
            grossLoss: isGrossWin ? 0 : grossPL,
            netWins: isNetWin ? netPL : 0,
            netLoss: isNetWin ? 0 : netPL,
            grossWinsCount: isGrossWin ? 1 : 0,
            grossLossCount: isGrossWin ? 0 : 1,
            netWinsCount: isNetWin ? 1 : 0,
            netLossCount: isNetWin ? 0 : 1,
            grossWinsQuantity: isGrossWin ? quantity : 0,
            grossLossQuantity: isGrossWin ? 0 : quantity,
            netWinsQuantity: isNetWin ? quantity : 0,
            netLossQuantity: isNetWin ? 0 : quantity,
            grossSharePLWins: isGrossWin ? grossPL : 0,
            grossSharePLLoss: isGrossWin ? 0 : grossPL,
            netSharePLWins: isNetWin ? netPL : 0,
            netSharePLLoss: isNetWin ? 0 : netPL,
            highGrossSharePLWin: isGrossWin ? grossPL : 0,
            highGrossSharePLLoss: isGrossWin ? 0 : grossPL,
            highNetSharePLWin: isNetWin ? netPL : 0,
            highNetSharePLLoss: isNetWin ? 0 : netPL,
            executionsCount: 1,
            tradesCount: 1,
            openPosition: false,
        }

        tradesByDay[dateUnix].push(tradeObj)
        executionsByDay[dateUnix].push({ ...tradeObj, trade: tradeObj.id })
    })

    // 4. Filter out already imported dates
    for (const existingDate of existingDates) {
        if (tradesByDay[existingDate]) {
            delete tradesByDay[existingDate]
            delete executionsByDay[existingDate]
        }
    }

    const newDays = Object.keys(tradesByDay)
    if (newDays.length === 0) {
        return { success: true, message: 'Alle Trades bereits importiert.', count: 0 }
    }

    // 5. Create blotter and P&L for each day, then save
    let savedCount = 0
    for (const dateUnix of newDays) {
        const dayTrades = tradesByDay[dateUnix]
        const dayExecutions = executionsByDay[dateUnix]

        // Build blotter (grouped by symbol)
        const blotterMap = {}
        dayTrades.forEach(t => {
            if (!blotterMap[t.symbol]) {
                blotterMap[t.symbol] = {
                    symbol: t.symbol,
                    grossProceeds: 0, netProceeds: 0, fees: 0,
                    grossWinsCount: 0, grossLossCount: 0, trades: 0
                }
            }
            const b = blotterMap[t.symbol]
            b.grossProceeds += t.grossProceeds
            b.netProceeds += t.netProceeds
            b.fees += t.commission
            b.grossWinsCount += t.grossWinsCount
            b.grossLossCount += t.grossLossCount
            b.trades += 1
        })
        const blotter = Object.values(blotterMap)

        // Build P&L summary
        let totalGross = 0, totalNet = 0, totalFees = 0
        let grossWinsCount = 0, grossLossCount = 0, totalTrades = 0
        dayTrades.forEach(t => {
            totalGross += t.grossProceeds
            totalNet += t.netProceeds
            totalFees += t.commission
            grossWinsCount += t.grossWinsCount
            grossLossCount += t.grossLossCount
            totalTrades += 1
        })
        const pAndL = {
            grossProceeds: totalGross,
            netProceeds: totalNet,
            fees: totalFees,
            grossWinsCount,
            grossLossCount,
            trades: totalTrades
        }

        // Save to DB
        await dbCreate('trades', {
            date: dayjs.unix(dateUnix).format('YYYY-MM-DD'),
            dateUnix: Number(dateUnix),
            executions: dayExecutions,
            trades: dayTrades,
            blotter: blotter,
            pAndL: pAndL,
            openPositions: false
        })
        savedCount++
        console.log(' -> Saved trades for ' + dayjs.unix(dateUnix).format('YYYY-MM-DD'))
    }

    // 6. Ensure 'bitunix' account exists in settings
    if (currentUser.value && currentUser.value.accounts) {
        const hasAccount = currentUser.value.accounts.find(a => a.value === 'bitunix')
        if (!hasAccount) {
            const accounts = [...currentUser.value.accounts, { value: 'bitunix', label: 'bitunix' }]
            await dbUpdateSettings({ accounts })
            currentUser.value.accounts = accounts
            // Also update localStorage
            const selected = localStorage.getItem('selectedAccounts')
            if (selected) {
                localStorage.setItem('selectedAccounts', selected + ',bitunix')
            } else {
                localStorage.setItem('selectedAccounts', 'bitunix')
            }
        }
    }

    // 7. Check incoming positions — link metadata for positions that were just imported
    try {
        const openIncoming = await dbFind('incoming_positions', { equalTo: { status: 'open' } })
        let linkedCount = 0

        for (const incoming of openIncoming) {
            const wasImported = allPositions.find(p => p.positionId === incoming.positionId)
            if (wasImported) {
                const closeTime = parseInt(wasImported.mtime || wasImported.ctime)
                const dateUnix = dayjs(closeTime).utc().startOf('day').unix()
                const tradeId = `t${dateUnix}_0_${wasImported.positionId}`

                // Link playbook/feelings/stress as note
                if (incoming.playbook || incoming.feelings || incoming.stressLevel) {
                    let noteText = ''
                    if (incoming.stressLevel) {
                        noteText += `<p><strong>Stresslevel: ${incoming.stressLevel}/5</strong></p>`
                    }
                    if (incoming.feelings) {
                        noteText += `<p><em>${incoming.feelings}</em></p>`
                    }
                    if (incoming.playbook) {
                        noteText += incoming.playbook
                    }
                    if (noteText) {
                        await dbCreate('notes', { dateUnix, tradeId, note: noteText })
                    }
                }

                // Link screenshot
                if (incoming.screenshotId) {
                    try {
                        await dbUpdateRecord('screenshots', incoming.screenshotId, {
                            name: `${dateUnix}_${wasImported.symbol}`,
                            dateUnixDay: dateUnix
                        })
                    } catch (e) { /* ignore */ }
                }

                // Remove from incoming
                await dbDelete('incoming_positions', incoming.objectId)
                linkedCount++
                console.log(` -> Incoming ${incoming.symbol} mit importiertem Trade verknüpft`)
            }
        }

        if (linkedCount > 0) {
            console.log(` -> ${linkedCount} Incoming-Positionen mit Trades verknüpft`)
        }
    } catch (e) {
        console.log(' -> Incoming-Verknüpfung übersprungen:', e.message)
    }

    return {
        success: true,
        message: `${allPositions.length} Positionen geladen, ${savedCount} neue Tage importiert.`,
        count: savedCount
    }
}
