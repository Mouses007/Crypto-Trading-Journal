import axios from 'axios'
import dayjs from './dayjs-setup.js'
import { dbCreate, dbFind, dbDelete, dbUpdate as dbUpdateRecord, dbFindTradeIdByPositionId } from './db.js'
import { dbUpdateSettings } from './db.js'
import { currentUser } from '../stores/settings.js'
import { selectedBroker } from '../stores/filters.js'
import { logWarn } from './logger.js'
import i18n from '../i18n'

/**
 * Quick API Import: Fetches trades from exchange API since last import,
 * creates trade objects, filters duplicates, saves to DB.
 * Works for both Bitunix and Bitget based on selectedBroker.
 * Returns { success, message, count }
 */
export async function useQuickApiImport(explicitBroker) {
    const broker = explicitBroker || selectedBroker.value || 'bitunix'
    console.log(` -> Starting quick API import for ${broker}`)

    // 1. Call server endpoint that fetches positions and updates lastApiImport
    const response = await axios.post(`/api/${broker}/quick-import`)

    if (!response.data.ok) {
        throw new Error(response.data.error || i18n.global.t('messages.importFailed'))
    }

    const allPositions = response.data.positions || []
    if (allPositions.length === 0) {
        return { success: true, message: i18n.global.t('messages.noNewPositions'), count: 0 }
    }

    // 2. Build set of already-imported positionIds (for same broker)
    const existingTrades = await dbFind('trades', { equalTo: { broker }, descending: 'dateUnix', limit: 10000 })
    const existingPositionIds = new Set()
    for (const record of existingTrades) {
        const dayTrades = Array.isArray(record.trades) ? record.trades : []
        for (const t of dayTrades) {
            // Trade-ID-Format: t{dateUnix}_{index}_{positionId}
            if (t.id) {
                const parts = t.id.split('_')
                if (parts.length >= 3) {
                    existingPositionIds.add(parts.slice(2).join('_'))
                }
            }
        }
    }

    // 3. Filter out already imported positions (Position-ID-Ebene statt Tagesebene)
    const newPositions = allPositions.filter(pos => {
        const posId = String(pos.positionId || '')
        return posId && !existingPositionIds.has(posId)
    })

    if (newPositions.length === 0) {
        return { success: true, message: i18n.global.t('messages.allTradesImported'), count: 0 }
    }

    // 4. Convert new positions to trade objects grouped by day
    const tradesByDay = {}
    const executionsByDay = {}

    newPositions.forEach((pos, i) => {
        let tradeObj

        if (broker === 'bitget') {
            tradeObj = createBitgetTradeObj(pos, i)
        } else {
            tradeObj = createBitunixTradeObj(pos, i)
        }

        const dateUnix = tradeObj.td
        if (!tradesByDay[dateUnix]) tradesByDay[dateUnix] = []
        if (!executionsByDay[dateUnix]) executionsByDay[dateUnix] = []

        tradesByDay[dateUnix].push(tradeObj)
        executionsByDay[dateUnix].push({ ...tradeObj, trade: tradeObj.id })
    })

    const newDays = Object.keys(tradesByDay)

    // 5. Für jeden Tag: existierenden Record mergen oder neuen anlegen
    // Index der existierenden Records für schnellen Lookup
    const existingByDate = {}
    for (const record of existingTrades) {
        existingByDate[record.dateUnix] = record
    }

    let savedCount = 0
    for (const dateUnix of newDays) {
        const dayTrades = tradesByDay[dateUnix]
        const dayExecutions = executionsByDay[dateUnix]
        const existingRecord = existingByDate[dateUnix]

        // Merge mit existierendem Tag-Record falls vorhanden
        let allDayTrades = dayTrades
        let allDayExecutions = dayExecutions
        if (existingRecord) {
            const prevTrades = Array.isArray(existingRecord.trades) ? existingRecord.trades : []
            const prevExec = Array.isArray(existingRecord.executions) ? existingRecord.executions : []
            allDayTrades = [...prevTrades, ...dayTrades]
            allDayExecutions = [...prevExec, ...dayExecutions]
        }

        // Build blotter (grouped by symbol) — über ALLE Trades des Tages
        const blotterMap = {}
        allDayTrades.forEach(t => {
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

        // Build P&L summary — über ALLE Trades des Tages
        let totalGross = 0, totalNet = 0, totalFees = 0
        let grossWinsCount = 0, grossLossCount = 0, totalTrades = 0
        allDayTrades.forEach(t => {
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

        if (existingRecord) {
            // Tag existiert → Merge: neue Trades anhängen, Blotter/P&L neu berechnen
            await dbUpdateRecord('trades', existingRecord.objectId, {
                executions: allDayExecutions,
                trades: allDayTrades,
                blotter: blotter,
                pAndL: pAndL,
            })
            console.log(` -> Merged ${dayTrades.length} new trade(s) into existing day ${dayjs.unix(dateUnix).format('YYYY-MM-DD')}`)
        } else {
            // Neuer Tag → Create
            await dbCreate('trades', {
                date: dayjs.unix(dateUnix).format('YYYY-MM-DD'),
                dateUnix: Number(dateUnix),
                broker: broker,
                executions: allDayExecutions,
                trades: allDayTrades,
                blotter: blotter,
                pAndL: pAndL,
                openPositions: false
            })
            console.log(' -> Saved trades for ' + dayjs.unix(dateUnix).format('YYYY-MM-DD'))
        }
        savedCount += dayTrades.length
    }

    // 6. Ensure broker account exists in settings
    if (currentUser.value && currentUser.value.accounts) {
        const hasAccount = currentUser.value.accounts.find(a => a.value === broker)
        if (!hasAccount) {
            const accounts = [...currentUser.value.accounts, { value: broker, label: broker }]
            await dbUpdateSettings({ accounts })
            currentUser.value.accounts = accounts
            // Also update localStorage
            const selected = localStorage.getItem('selectedAccounts')
            if (selected) {
                localStorage.setItem('selectedAccounts', selected + ',' + broker)
            } else {
                localStorage.setItem('selectedAccounts', broker)
            }
        }
    }

    // 7. Check incoming positions — link metadata for positions that were just imported
    try {
        const openIncoming = await dbFind('incoming_positions', { equalTo: { status: 'open' } })
        let linkedCount = 0

        for (const incoming of openIncoming) {
            const wasImported = allPositions.find(p =>
                String(p.positionId) === String(incoming.positionId)
            )
            if (wasImported) {
                const closeTime = parseInt(
                    wasImported.mtime || wasImported.uTime || wasImported.ctime || wasImported.cTime
                )
                const dateUnix = dayjs(closeTime).utc().startOf('day').unix()
                const tradeId = await dbFindTradeIdByPositionId(dateUnix, wasImported.positionId)

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
                            name: `${dateUnix}_${wasImported.symbol || wasImported.symbolName}`,
                            dateUnixDay: dateUnix
                        })
                    } catch (e) {
                        logWarn('quick-import', `Screenshot-Linking fehlgeschlagen (incoming=${incoming.objectId}, screenshot=${incoming.screenshotId})`, e)
                    }
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
        message: i18n.global.t('messages.positionsImported', { count: newPositions.length, days: newDays.length }),
        count: savedCount
    }
}

/**
 * Create a trade object from a Bitunix API position.
 */
function createBitunixTradeObj(pos, i) {
    const grossPL = parseFloat(pos.realizedPNL || 0)
    const tradingFee = Math.abs(parseFloat(pos.fee || 0))
    const fundingFee = parseFloat(pos.funding || 0)  // Vorzeichen beibehalten: positiv = bezahlt, negativ = erhalten
    const fee = tradingFee + fundingFee
    const closeTime = parseInt(pos.mtime || pos.ctime)
    const openTime = parseInt(pos.ctime)
    const dateUnix = dayjs(closeTime).utc().startOf('day').unix()

    // Bitunix API: Pending uses 'BUY'/'SELL', History uses 'LONG'/'SHORT' — accept both
    const side = (pos.side === 'LONG' || pos.side === 'BUY') ? 'B' : 'SS'
    const netPL = grossPL - fee
    const isGrossWin = grossPL > 0
    const isNetWin = netPL > 0
    const quantity = parseFloat(pos.maxQty || 1)
    const entryTime = dayjs(openTime).utc().unix()
    const exitTime = dayjs(closeTime).utc().unix()

    return buildTradeObj({
        id: `t${dateUnix}_${i}_${pos.positionId || i}`,
        broker: 'bitunix',
        td: dateUnix,
        side, quantity, entryTime, exitTime,
        entryPrice: parseFloat(pos.entryPrice || 0),
        exitPrice: parseFloat(pos.closePrice || 0),
        symbol: pos.symbol || 'FUTURES',
        grossPL, netPL, fee, tradingFee, fundingFee, isGrossWin, isNetWin
    })
}

/**
 * Create a trade object from a Bitget API position.
 * Bitget fields: positionId, symbol, holdSide, openAvgPrice, closeAvgPrice,
 *                openTotalPos, closeTotalPos, pnl, netProfit, openFee, closeFee,
 *                totalFunding, cTime, uTime
 */
function createBitgetTradeObj(pos, i) {
    const grossPL = parseFloat(pos.pnl || 0)
    const openFee = Math.abs(parseFloat(pos.openFee || 0))
    const closeFee = Math.abs(parseFloat(pos.closeFee || 0))
    const totalFunding = parseFloat(pos.totalFunding || 0)  // Vorzeichen beibehalten
    const tradingFee = openFee + closeFee
    const fundingFee = totalFunding
    const fee = tradingFee + fundingFee
    const closeTime = parseInt(pos.utime || pos.uTime || pos.ctime || pos.cTime)
    const openTime = parseInt(pos.ctime || pos.cTime)
    const dateUnix = dayjs(closeTime).utc().startOf('day').unix()

    // Bitget holdSide: 'long' or 'short'
    const holdSide = (pos.holdSide || '').toLowerCase()
    const side = holdSide === 'long' ? 'B' : 'SS'
    const netPL = parseFloat(pos.netProfit || 0) || (grossPL - fee)
    const isGrossWin = grossPL > 0
    const isNetWin = netPL > 0
    const quantity = parseFloat(pos.closeTotalPos || pos.openTotalPos || 1)
    const entryTime = dayjs(openTime).utc().unix()
    const exitTime = dayjs(closeTime).utc().unix()

    return buildTradeObj({
        id: `t${dateUnix}_${i}_${pos.positionId || i}`,
        broker: 'bitget',
        td: dateUnix,
        side, quantity, entryTime, exitTime,
        entryPrice: parseFloat(pos.openAvgPrice || 0),
        exitPrice: parseFloat(pos.closeAvgPrice || 0),
        symbol: pos.symbol || 'FUTURES',
        grossPL, netPL, fee, tradingFee, fundingFee, isGrossWin, isNetWin
    })
}

/**
 * Build a standardized trade object from normalized fields.
 */
function buildTradeObj({ id, broker, td, side, quantity, entryTime, exitTime,
    entryPrice, exitPrice, symbol, grossPL, netPL, fee, tradingFee, fundingFee, isGrossWin, isNetWin }) {
    return {
        id,
        account: broker,
        broker: broker,
        td,
        currency: 'USDT',
        type: 'futures',
        side,
        strategy: side === 'B' ? 'long' : 'short',
        symbol,
        buyQuantity: quantity,
        sellQuantity: quantity,
        entryPrice,
        exitPrice,
        entryTime,
        exitTime,
        grossProceeds: grossPL,
        netProceeds: netPL,
        commission: fee,
        tradingFee: tradingFee || 0,
        fundingFee: fundingFee || 0,
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
}
