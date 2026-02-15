import axios from 'axios'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
dayjs.extend(utc)
import { dbFind, dbFirst, dbCreate, dbUpdate, dbDelete } from './db.js'
import { incomingPositions, incomingPollingActive, incomingLastFetched, evaluationQueue, evaluationPopupVisible, currentUser } from '../stores/globals.js'

let globalPollingInterval = null

/**
 * Fetch open positions from Bitunix API, sync with local DB,
 * detect closed positions and create trade records.
 */
export async function useFetchOpenPositions() {
    console.log(' -> Fetching open positions from Bitunix')
    incomingPollingActive.value = true

    try {
        const response = await axios.get('/api/bitunix/open-positions')

        if (!response.data.ok) {
            throw new Error(response.data.error || 'Fehler beim Abrufen offener Positionen')
        }

        const apiPositions = response.data.positions || []
        console.log(` -> ${apiPositions.length} offene Positionen von API erhalten`)

        await syncPositionsWithDb(apiPositions)
        await loadIncomingPositions()

        incomingLastFetched.value = new Date()
    } catch (error) {
        console.error(' -> Fehler beim Abrufen:', error)
        throw error
    } finally {
        incomingPollingActive.value = false
    }
}

/**
 * Sync API positions with the incoming_positions table:
 * - New positions → create rows
 * - Existing positions → update unrealizedPNL, markPrice
 * - Missing positions → closed → handle transition to trades
 */
async function syncPositionsWithDb(apiPositions) {
    // Get all open positions from DB
    const dbPositions = await dbFind('incoming_positions', { equalTo: { status: 'open' } })
    const dbMap = new Map(dbPositions.map(p => [p.positionId, p]))
    const apiIds = new Set(apiPositions.map(p => p.positionId))

    // 1. Detect closed positions (in DB but not in API)
    const closedPositions = dbPositions.filter(p => !apiIds.has(p.positionId))
    if (closedPositions.length > 0) {
        console.log(` -> ${closedPositions.length} Positionen geschlossen erkannt`)
        await handleClosedPositions(closedPositions)
    }

    // 2. Update existing / create new
    for (const apiPos of apiPositions) {
        const existing = dbMap.get(apiPos.positionId)

        if (existing) {
            // Update unrealizedPNL, markPrice, bitunixData
            // Pending API fields: avgOpenPrice, qty, unrealizedPNL, liqPrice
            await dbUpdate('incoming_positions', existing.objectId, {
                unrealizedPNL: parseFloat(apiPos.unrealizedPNL || 0),
                markPrice: parseFloat(apiPos.liqPrice || 0),
                quantity: parseFloat(apiPos.qty || existing.quantity),
                entryPrice: parseFloat(apiPos.avgOpenPrice || existing.entryPrice || 0),
                bitunixData: apiPos
            })
        } else {
            // New open position
            // Pending API: avgOpenPrice (not entryPrice), qty (not maxQty), liqPrice (no markPrice)
            // Pending API uses BUY/SELL for side, map to LONG/SHORT for consistency
            const normalizedSide = apiPos.side === 'BUY' ? 'LONG' : apiPos.side === 'SELL' ? 'SHORT' : apiPos.side
            await dbCreate('incoming_positions', {
                positionId: apiPos.positionId,
                symbol: apiPos.symbol || '',
                side: normalizedSide,
                entryPrice: parseFloat(apiPos.avgOpenPrice || apiPos.entryPrice || 0),
                leverage: parseFloat(apiPos.leverage || 0),
                quantity: parseFloat(apiPos.qty || apiPos.maxQty || 0),
                unrealizedPNL: parseFloat(apiPos.unrealizedPNL || 0),
                markPrice: parseFloat(apiPos.liqPrice || 0),
                status: 'open',
                bitunixData: apiPos
            })
            console.log(` -> Neue Position: ${apiPos.symbol} ${apiPos.side}`)

            // Push opening evaluation to queue if popups enabled
            if (currentUser.value?.showTradePopups !== 0) {
                const created = await dbFind('incoming_positions', { equalTo: { positionId: apiPos.positionId } })
                if (created.length > 0) {
                    evaluationQueue.push({
                        type: 'opening',
                        positionObjectId: created[0].objectId,
                        position: { ...created[0] }
                    })
                }
            }
        }
    }
}

/**
 * Handle positions that have been closed on Bitunix.
 * For each: fetch history data → create trade record → link metadata → remove from incoming.
 */
async function handleClosedPositions(closedPositions) {
    const popupsEnabled = currentUser.value?.showTradePopups !== 0

    for (const incoming of closedPositions) {
        try {
            // Fetch history data for the closed position
            const histResponse = await axios.get(`/api/bitunix/position-history/${incoming.positionId}`)

            if (!histResponse.data.ok || !histResponse.data.position) {
                // History not yet available — mark as closed but keep for retry
                console.log(` -> History für ${incoming.symbol} noch nicht verfügbar, wird übersprungen`)
                continue
            }

            const histPos = histResponse.data.position

            // Create trade record (skip metadata transfer if popups enabled — popup handles it)
            await createTradeFromClosedPosition(histPos, incoming, popupsEnabled)

            if (popupsEnabled) {
                // Keep position as pending_evaluation, store historyData for popup
                await dbUpdate('incoming_positions', incoming.objectId, {
                    status: 'pending_evaluation',
                    historyData: histPos
                })

                // Push closing evaluation to queue
                evaluationQueue.push({
                    type: 'closing',
                    positionObjectId: incoming.objectId,
                    position: { ...incoming },
                    historyData: histPos
                })
                console.log(` -> Position ${incoming.symbol} geschlossen — Bewertungs-Popup in Warteschlange`)
            } else {
                // No popups: existing behavior — transfer metadata and delete
                await dbDelete('incoming_positions', incoming.objectId)
                console.log(` -> Position ${incoming.symbol} geschlossen und als Trade übernommen`)
            }
        } catch (error) {
            console.error(` -> Fehler beim Verarbeiten geschlossener Position ${incoming.symbol}:`, error)
        }
    }
}

/**
 * Create a trade record from a closed position.
 * Uses the exact same ~40-field trade object format as quickImport.js.
 * Links metadata (playbook → notes, screenshotId → screenshot name).
 */
async function createTradeFromClosedPosition(histPos, incoming, skipMetadata = false) {
    const grossPL = parseFloat(histPos.realizedPNL || 0)
    const fee = Math.abs(parseFloat(histPos.fee || 0)) + Math.abs(parseFloat(histPos.funding || 0))
    const closeTime = parseInt(histPos.mtime || histPos.ctime)
    const openTime = parseInt(histPos.ctime)
    const dateUnix = dayjs(closeTime).utc().startOf('day').unix()

    const side = histPos.side === 'LONG' ? 'B' : 'SS'
    const netPL = grossPL - fee
    const isGrossWin = grossPL > 0
    const isNetWin = netPL > 0
    const quantity = parseFloat(histPos.maxQty || 1)
    const entryTime = dayjs(openTime).utc().unix()
    const exitTime = dayjs(closeTime).utc().unix()

    const tradeId = `t${dateUnix}_0_${histPos.positionId}`

    const tradeObj = {
        id: tradeId,
        account: 'bitunix',
        broker: 'bitunix',
        td: dateUnix,
        currency: 'USDT',
        type: 'futures',
        side: side,
        strategy: side === 'B' ? 'long' : 'short',
        symbol: histPos.symbol || 'FUTURES',
        buyQuantity: quantity,
        sellQuantity: quantity,
        entryPrice: parseFloat(histPos.entryPrice || 0),
        exitPrice: parseFloat(histPos.closePrice || 0),
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

    const execution = { ...tradeObj, trade: tradeId }

    // Check if a trade record for this day already exists
    const existingDay = await dbFirst('trades', { equalTo: { dateUnix: dateUnix } })

    if (existingDay) {
        // Merge into existing day: append trade and execution
        const existingTrades = Array.isArray(existingDay.trades) ? existingDay.trades : []
        const existingExecs = Array.isArray(existingDay.executions) ? existingDay.executions : []

        existingTrades.push(tradeObj)
        existingExecs.push(execution)

        // Rebuild blotter
        const blotterMap = {}
        existingTrades.forEach(t => {
            if (!blotterMap[t.symbol]) {
                blotterMap[t.symbol] = { symbol: t.symbol, grossProceeds: 0, netProceeds: 0, fees: 0, grossWinsCount: 0, grossLossCount: 0, trades: 0 }
            }
            const b = blotterMap[t.symbol]
            b.grossProceeds += t.grossProceeds
            b.netProceeds += t.netProceeds
            b.fees += t.commission
            b.grossWinsCount += t.grossWinsCount
            b.grossLossCount += t.grossLossCount
            b.trades += 1
        })

        // Rebuild P&L
        let totalGross = 0, totalNet = 0, totalFees = 0, gwc = 0, glc = 0, tc = 0
        existingTrades.forEach(t => {
            totalGross += t.grossProceeds
            totalNet += t.netProceeds
            totalFees += t.commission
            gwc += t.grossWinsCount
            glc += t.grossLossCount
            tc += 1
        })

        await dbUpdate('trades', existingDay.objectId, {
            trades: existingTrades,
            executions: existingExecs,
            blotter: Object.values(blotterMap),
            pAndL: { grossProceeds: totalGross, netProceeds: totalNet, fees: totalFees, grossWinsCount: gwc, grossLossCount: glc, trades: tc }
        })
    } else {
        // Create new day
        const blotter = [{
            symbol: tradeObj.symbol,
            grossProceeds: tradeObj.grossProceeds,
            netProceeds: tradeObj.netProceeds,
            fees: tradeObj.commission,
            grossWinsCount: tradeObj.grossWinsCount,
            grossLossCount: tradeObj.grossLossCount,
            trades: 1
        }]

        const pAndL = {
            grossProceeds: grossPL,
            netProceeds: netPL,
            fees: fee,
            grossWinsCount: isGrossWin ? 1 : 0,
            grossLossCount: isGrossWin ? 0 : 1,
            trades: 1
        }

        await dbCreate('trades', {
            date: dayjs.unix(dateUnix).format('YYYY-MM-DD'),
            dateUnix: Number(dateUnix),
            executions: [execution],
            trades: [tradeObj],
            blotter: blotter,
            pAndL: pAndL,
            openPositions: false
        })
    }

    // Skip metadata transfer if popup will handle it
    if (!skipMetadata) {
        // Link metadata: playbook → notes table
        if (incoming.playbook && incoming.playbook.trim()) {
            let noteText = incoming.playbook
            if (incoming.stressLevel) {
                noteText = `<p><strong>Stresslevel: ${incoming.stressLevel}/10</strong></p>` + noteText
            }
            if (incoming.feelings && incoming.feelings.trim()) {
                noteText = `<p><em>${incoming.feelings}</em></p>` + noteText
            }
            await dbCreate('notes', {
                dateUnix: dateUnix,
                tradeId: tradeId,
                note: noteText
            })
        } else if (incoming.feelings || incoming.stressLevel) {
            // Save feelings/stress even without playbook
            let noteText = ''
            if (incoming.stressLevel) {
                noteText += `<p><strong>Stresslevel: ${incoming.stressLevel}/10</strong></p>`
            }
            if (incoming.feelings && incoming.feelings.trim()) {
                noteText += `<p><em>${incoming.feelings}</em></p>`
            }
            if (noteText) {
                await dbCreate('notes', {
                    dateUnix: dateUnix,
                    tradeId: tradeId,
                    note: noteText
                })
            }
        }

        // Link metadata: screenshotId → update screenshot name for trade linking
        if (incoming.screenshotId) {
            try {
                await dbUpdate('screenshots', incoming.screenshotId, {
                    name: `${dateUnix}_${histPos.symbol}`,
                    dateUnixDay: dateUnix
                })
            } catch (e) {
                console.log(' -> Screenshot-Verknüpfung fehlgeschlagen:', e)
            }
        }

        // Link metadata: tags → tags table
        if (incoming.tags && Array.isArray(incoming.tags) && incoming.tags.length > 0) {
            try {
                await dbCreate('tags', {
                    dateUnix: dateUnix,
                    tradeId: tradeId,
                    tags: incoming.tags.map(t => t.id)
                })
            } catch (e) {
                console.log(' -> Tag-Verknüpfung fehlgeschlagen:', e)
            }
        }
    }
}

/**
 * Load all incoming positions from local DB into reactive state.
 */
async function loadIncomingPositions() {
    // Load both open and pending_evaluation positions
    const openResults = await dbFind('incoming_positions', {
        equalTo: { status: 'open' },
        descending: 'id'
    })
    const pendingResults = await dbFind('incoming_positions', {
        equalTo: { status: 'pending_evaluation' },
        descending: 'id'
    })
    incomingPositions.length = 0
    // Open positions first, then pending evaluation
    openResults.forEach(r => incomingPositions.push(r))
    pendingResults.forEach(r => incomingPositions.push(r))
}

/**
 * Get incoming positions (for initial page load).
 */
export async function useGetIncomingPositions() {
    await loadIncomingPositions()
}

/**
 * Update metadata on an incoming position.
 */
export async function useUpdateIncomingPosition(objectId, data) {
    await dbUpdate('incoming_positions', objectId, data)
    // Update local state
    const idx = incomingPositions.findIndex(p => p.objectId === objectId)
    if (idx !== -1) {
        Object.assign(incomingPositions[idx], data)
    }
}

/**
 * Delete an incoming position manually.
 */
export async function useDeleteIncomingPosition(objectId) {
    await dbDelete('incoming_positions', objectId)
    const idx = incomingPositions.findIndex(p => p.objectId === objectId)
    if (idx !== -1) {
        incomingPositions.splice(idx, 1)
    }
}

/**
 * Restore pending evaluations after page reload.
 * Re-populates the evaluation queue from DB records:
 * - status: 'open' + openingEvalDone: 0 → Opening-Popups
 * - status: 'pending_evaluation' → Closing-Popups
 */
export async function useRestorePendingEvaluations() {
    if (currentUser.value?.showTradePopups === 0) return

    try {
        // Opening evaluations: open positions that haven't shown the popup yet
        const openPositions = await dbFind('incoming_positions', { equalTo: { status: 'open', openingEvalDone: 0 } })
        for (const pos of openPositions) {
            const alreadyInQueue = evaluationQueue.some(q => q.type === 'opening' && q.positionObjectId === pos.objectId)
            if (!alreadyInQueue) {
                evaluationQueue.push({
                    type: 'opening',
                    positionObjectId: pos.objectId,
                    position: { ...pos }
                })
            }
        }

        // Closing evaluations: positions waiting for closing popup
        const pendingPositions = await dbFind('incoming_positions', { equalTo: { status: 'pending_evaluation' } })
        for (const pos of pendingPositions) {
            const alreadyInQueue = evaluationQueue.some(q => q.type === 'closing' && q.positionObjectId === pos.objectId)
            if (!alreadyInQueue) {
                evaluationQueue.push({
                    type: 'closing',
                    positionObjectId: pos.objectId,
                    position: { ...pos },
                    historyData: pos.historyData || {}
                })
            }
        }

        if (evaluationQueue.length > 0) {
            console.log(` -> ${evaluationQueue.length} ausstehende Bewertungen wiederhergestellt`)
        }
    } catch (error) {
        console.error(' -> Fehler beim Wiederherstellen ausstehender Bewertungen:', error)
    }
}

/**
 * Start global polling for position changes (used in DashboardLayout).
 * Runs every 60 seconds. Detects new/closed positions and populates queue.
 * Only active when showTradePopups is enabled.
 */
export function useStartGlobalPolling() {
    if (globalPollingInterval) {
        clearInterval(globalPollingInterval)
        globalPollingInterval = null
    }

    if (currentUser.value?.showTradePopups === 0) return

    console.log(' -> Globales Positions-Polling gestartet (60s)')

    globalPollingInterval = setInterval(async () => {
        // Don't poll if already polling (e.g., from Incoming.vue)
        if (incomingPollingActive.value) return

        try {
            await useFetchOpenPositions()
        } catch (error) {
            // Silent fail — don't spam console on network errors
            console.log(' -> Globales Polling fehlgeschlagen:', error.message)
        }
    }, 60000)
}

/**
 * Stop global polling (cleanup).
 */
export function useStopGlobalPolling() {
    if (globalPollingInterval) {
        clearInterval(globalPollingInterval)
        globalPollingInterval = null
        console.log(' -> Globales Positions-Polling gestoppt')
    }
}

/**
 * Transfer metadata from closing evaluation popup to the trade record.
 * Called by TradeEvalPopup after user submits closing evaluation.
 */
export async function useTransferClosingMetadata(incoming, histPos, { note, tags, satisfaction, stressLevel }) {
    const closeTime = parseInt(histPos.mtime || histPos.ctime)
    const dateUnix = dayjs(closeTime).utc().startOf('day').unix()
    const tradeId = `t${dateUnix}_0_${histPos.positionId}`

    // Build combined note HTML for backwards compatibility (playbook-note-content display)
    let noteText = ''
    if (incoming.playbook && incoming.playbook.trim()) {
        noteText += incoming.playbook
    }
    if (note && note.trim()) {
        noteText += `<p>${note}</p>`
    }
    if (!noteText.trim()) {
        noteText = '<p>-</p>'
    }

    // Save note with structured metadata fields
    await dbCreate('notes', {
        dateUnix: dateUnix,
        tradeId: tradeId,
        note: noteText,
        entryStressLevel: incoming.stressLevel || 0,
        emotionLevel: incoming.emotionLevel || 0,
        entryNote: incoming.entryNote || '',
        feelings: incoming.feelings || '',
        playbook: incoming.playbook || '',
        timeframe: incoming.entryTimeframe || '',
        screenshotId: incoming.screenshotId || ''
    })

    // Save satisfaction
    if (satisfaction !== null && satisfaction !== undefined) {
        await dbCreate('satisfactions', {
            dateUnix: dateUnix,
            tradeId: tradeId,
            satisfaction: satisfaction
        })
    }

    // Save tags
    if (tags && Array.isArray(tags) && tags.length > 0) {
        await dbCreate('tags', {
            dateUnix: dateUnix,
            tradeId: tradeId,
            tags: tags.map(t => typeof t === 'object' ? t.id : t)
        })
    }

    // Link screenshot if present
    if (incoming.screenshotId) {
        try {
            await dbUpdate('screenshots', incoming.screenshotId, {
                name: `${dateUnix}_${histPos.symbol}`,
                dateUnixDay: dateUnix
            })
        } catch (e) {
            console.log(' -> Screenshot-Verknüpfung fehlgeschlagen:', e)
        }
    }

    // Delete incoming position (evaluation complete)
    await dbDelete('incoming_positions', incoming.objectId)
    console.log(` -> Bewertung abgeschlossen für ${incoming.symbol}`)
}
