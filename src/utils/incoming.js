import axios from 'axios'
import dayjs from './dayjs-setup.js'
import { dbFind, dbFirst, dbCreate, dbUpdate, dbDelete } from './db.js'
import { incomingPositions, incomingPollingActive, incomingLastFetched, pendingOpeningCount, pendingClosingCount, evalNotificationShown, evalNotificationDismissed, getNotifiedPositionIds, addNotifiedPositionIds, removeNotifiedPositionIds } from '../stores/trades.js'
import { currentUser } from '../stores/settings.js'

let globalPollingInterval = null

/**
 * Update the pending evaluation counters from the database.
 * Called after each sync cycle and on page load.
 */
export async function useUpdatePendingCounts() {
    try {
        const openPositions = await dbFind('incoming_positions', { equalTo: { status: 'open', openingEvalDone: 0 } })
        const pendingPositions = await dbFind('incoming_positions', { equalTo: { status: 'pending_evaluation' } })

        pendingOpeningCount.value = openPositions.length
        pendingClosingCount.value = pendingPositions.length

        // Collect all current position IDs that need evaluation
        const currentIds = new Set([
            ...openPositions.map(p => 'open_' + p.positionId),
            ...pendingPositions.map(p => 'close_' + p.positionId),
        ])

        // Compare with already-notified IDs from localStorage
        const alreadyNotified = getNotifiedPositionIds()
        const brandNewIds = [...currentIds].filter(id => !alreadyNotified.has(id))

        // Clean up notified IDs that are no longer pending (position was evaluated/deleted)
        const staleIds = [...alreadyNotified].filter(id => !currentIds.has(id))
        if (staleIds.length > 0) {
            removeNotifiedPositionIds(staleIds)
        }

        // Only show popup if there are truly new (never-before-notified) positions
        if (brandNewIds.length > 0) {
            // Mark them as notified so popup won't fire again for these
            addNotifiedPositionIds(brandNewIds)
            evalNotificationShown.value = true
            evalNotificationDismissed.value = false
        }
    } catch (error) {
        console.error(' -> Fehler beim Aktualisieren der Zähler:', error)
    }
}

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

        // Update counters after sync
        await useUpdatePendingCounts()

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
            await dbUpdate('incoming_positions', existing.objectId, {
                unrealizedPNL: parseFloat(apiPos.unrealizedPNL || 0),
                markPrice: parseFloat(apiPos.liqPrice || 0),
                quantity: parseFloat(apiPos.qty || existing.quantity),
                entryPrice: parseFloat(apiPos.avgOpenPrice || existing.entryPrice || 0),
                bitunixData: apiPos
            })
        } else {
            // New open position
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
                console.log(` -> History für ${incoming.symbol} noch nicht verfügbar, wird übersprungen`)
                continue
            }

            const histPos = histResponse.data.position

            // Create trade record (skip metadata transfer if popups enabled — pending evaluation handles it)
            await createTradeFromClosedPosition(histPos, incoming, popupsEnabled)

            if (incoming.skipEvaluation === 1) {
                // Skip evaluation: transfer existing metadata directly
                await useTransferClosingMetadata(incoming, histPos, {
                    note: '',
                    tags: incoming.tags || [],
                    satisfaction: incoming.satisfaction,
                    stressLevel: incoming.stressLevel || 0,
                    closingNote: incoming.closingNote || '',
                    closingStressLevel: 0,
                    closingEmotionLevel: 0,
                    closingFeelings: '',
                    closingTimeframe: '',
                    closingPlaybook: '',
                    closingScreenshotId: '',
                    closingTags: [],
                })
                console.log(` -> Position ${incoming.symbol} geschlossen — Bewertung übersprungen`)
            } else if (popupsEnabled) {
                // Keep position as pending_evaluation, store historyData
                await dbUpdate('incoming_positions', incoming.objectId, {
                    status: 'pending_evaluation',
                    historyData: histPos
                })
                console.log(` -> Position ${incoming.symbol} geschlossen — Abschlussbewertung ausstehend`)
            } else {
                // No popups: transfer metadata and delete
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

    const side = (histPos.side === 'LONG' || histPos.side === 'BUY') ? 'B' : 'SS'
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

    // Skip metadata transfer if pending evaluation will handle it
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

        // Link metadata: entryScreenshotId → update screenshot name for trade linking
        if (incoming.entryScreenshotId || incoming.screenshotId) {
            const ssId = incoming.entryScreenshotId || incoming.screenshotId
            try {
                await dbUpdate('screenshots', ssId, {
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
                    tags: incoming.tags.map(t => typeof t === 'object' ? t.id : t)
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
 * Start global polling for position changes (used in DashboardLayout).
 * Runs every 60 seconds. Detects new/closed positions and updates counters.
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
 * Transfer metadata from closing evaluation to the trade record.
 * Called when user completes closing evaluation on the Pendente Trades page.
 * Includes both opening and closing metadata fields.
 */
export async function useTransferClosingMetadata(incoming, histPos, {
    note = '',
    tags = [],
    satisfaction = null,
    stressLevel = 0,
    closingNote = '',
    closingStressLevel = 0,
    closingEmotionLevel = 0,
    closingFeelings = '',
    closingTimeframe = '',
    closingPlaybook = '',
    closingScreenshotId = '',
    closingTags = [],
}) {
    const closeTime = parseInt(histPos.mtime || histPos.ctime)
    const dateUnix = dayjs(closeTime).utc().startOf('day').unix()
    const tradeId = `t${dateUnix}_0_${histPos.positionId}`

    // Build combined note HTML for backwards compatibility
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

    // Save note with structured metadata fields (opening + closing)
    await dbCreate('notes', {
        dateUnix: dateUnix,
        tradeId: tradeId,
        note: noteText,
        // Opening fields
        entryStressLevel: incoming.stressLevel || 0,
        emotionLevel: incoming.emotionLevel || 0,
        entryNote: incoming.entryNote || '',
        feelings: incoming.feelings || '',
        playbook: incoming.playbook || '',
        timeframe: incoming.entryTimeframe || '',
        screenshotId: incoming.entryScreenshotId || incoming.screenshotId || '',
        // Closing fields
        closingNote: closingNote || incoming.closingNote || '',
        closingStressLevel: closingStressLevel,
        closingEmotionLevel: closingEmotionLevel,
        closingFeelings: closingFeelings,
        closingTimeframe: closingTimeframe,
        closingPlaybook: closingPlaybook,
        closingScreenshotId: closingScreenshotId,
    })

    // Save satisfaction
    if (satisfaction !== null && satisfaction !== undefined) {
        await dbCreate('satisfactions', {
            dateUnix: dateUnix,
            tradeId: tradeId,
            satisfaction: satisfaction
        })
    }

    // Save tags (combined opening + closing tags)
    const allTags = [
        ...(tags || []).map(t => typeof t === 'object' ? t.id : t),
        ...(closingTags || []).map(t => typeof t === 'object' ? t.id : t),
    ]
    // Deduplicate
    const uniqueTags = [...new Set(allTags)]
    if (uniqueTags.length > 0) {
        await dbCreate('tags', {
            dateUnix: dateUnix,
            tradeId: tradeId,
            tags: uniqueTags
        })
    }

    // Link entry screenshot if present
    const entryScreenshotId = incoming.entryScreenshotId || incoming.screenshotId
    if (entryScreenshotId) {
        try {
            await dbUpdate('screenshots', entryScreenshotId, {
                name: `${dateUnix}_${histPos.symbol}_entry`,
                dateUnixDay: dateUnix
            })
        } catch (e) {
            console.log(' -> Entry-Screenshot-Verknüpfung fehlgeschlagen:', e)
        }
    }

    // Link closing screenshot if present
    if (closingScreenshotId) {
        try {
            await dbUpdate('screenshots', closingScreenshotId, {
                name: `${dateUnix}_${histPos.symbol}_closing`,
                dateUnixDay: dateUnix
            })
        } catch (e) {
            console.log(' -> Closing-Screenshot-Verknüpfung fehlgeschlagen:', e)
        }
    }

    // Delete incoming position (evaluation complete)
    await dbDelete('incoming_positions', incoming.objectId)

    // Update counters
    await useUpdatePendingCounts()

    console.log(` -> Bewertung abgeschlossen für ${incoming.symbol}`)
}
