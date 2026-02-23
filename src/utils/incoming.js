import axios from 'axios'
import dayjs from './dayjs-setup.js'
import { dbFind, dbFirst, dbCreate, dbUpdate, dbDelete } from './db.js'
import { incomingPositions, incomingPollingActive, incomingLastFetched, pendingOpeningCount, pendingClosingCount, evalNotificationShown, evalNotificationDismissed, getNotifiedPositionIds, addNotifiedPositionIds, removeNotifiedPositionIds } from '../stores/trades.js'
import { currentUser } from '../stores/settings.js'
import { selectedBroker } from '../stores/filters.js'
import i18n from '../i18n'

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
 * Fetch open positions from exchange API, sync with local DB,
 * detect closed positions and create trade records.
 * Uses selectedBroker to determine which API to call.
 */
export async function useFetchOpenPositions() {
    const broker = selectedBroker.value || 'bitunix'
    console.log(` -> Fetching open positions from ${broker}`)
    incomingPollingActive.value = true

    try {
        const response = await axios.get(`/api/${broker}/open-positions`)

        if (!response.data.ok) {
            throw new Error(response.data.error || i18n.global.t('incoming.errorFetchingPositions'))
        }

        const apiPositions = response.data.positions || []
        console.log(` -> ${apiPositions.length} offene Positionen von API erhalten`)

        await syncPositionsWithDb(apiPositions)
        await fetchRecentlyClosed()
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
    const broker = selectedBroker.value || 'bitunix'
    // Normalize positionId to string everywhere (API may return number)
    const normalizeId = (p) => String(p?.positionId ?? p?.position_id ?? '')

    const dbPositions = await dbFind('incoming_positions', { equalTo: { status: 'open', broker: broker } })
    const dbMap = new Map(dbPositions.map(p => [String(p.positionId), p]))
    const apiIds = new Set(apiPositions.map(p => normalizeId(p)).filter(Boolean))

    // 1. Detect closed positions (in DB but not in API)
    const closedPositions = dbPositions.filter(p => !apiIds.has(String(p.positionId)))
    if (closedPositions.length > 0) {
        console.log(` -> ${closedPositions.length} Positionen geschlossen erkannt`)
        await handleClosedPositions(closedPositions)
    }

    // 2. Update existing / create new
    for (const apiPos of apiPositions) {
        const posId = normalizeId(apiPos)
        if (!posId) {
            console.warn(' -> Position ohne positionId übersprungen:', apiPos)
            continue
        }
        const existing = dbMap.get(posId)

        if (existing) {
            // Update unrealizedPNL, markPrice, bitunixData
            await dbUpdate('incoming_positions', existing.objectId, {
                unrealizedPNL: parseFloat(apiPos.unrealizedPNL ?? apiPos.unrealized_pnl ?? 0),
                markPrice: parseFloat(apiPos.liqPrice ?? apiPos.liq_price ?? apiPos.markPrice ?? 0),
                quantity: parseFloat(apiPos.qty ?? apiPos.maxQty ?? apiPos.quantity ?? existing.quantity ?? 0),
                entryPrice: parseFloat(apiPos.avgOpenPrice ?? apiPos.entryPrice ?? apiPos.avg_open_price ?? 0),
                bitunixData: apiPos
            })
        } else {
            // Support Bitunix (BUY/SELL/LONG/SHORT) and Bitget (holdSide: long/short, side: LONG/SHORT)
            const rawSide = apiPos.side || (apiPos.holdSide || '').toUpperCase() || ''
            const normalizedSide = (rawSide === 'BUY' || rawSide === 'LONG') ? 'LONG' : (rawSide === 'SELL' || rawSide === 'SHORT') ? 'SHORT' : rawSide
            try {
                await dbCreate('incoming_positions', {
                    positionId: posId,
                    symbol: String(apiPos.symbol ?? apiPos.symbolName ?? ''),
                    side: normalizedSide,
                    entryPrice: parseFloat(apiPos.avgOpenPrice ?? apiPos.entryPrice ?? apiPos.avg_open_price ?? 0),
                    leverage: parseFloat(apiPos.leverage ?? 0),
                    quantity: parseFloat(apiPos.qty ?? apiPos.maxQty ?? apiPos.quantity ?? 0),
                    unrealizedPNL: parseFloat(apiPos.unrealizedPNL ?? apiPos.unrealized_pnl ?? apiPos.unrealizedPL ?? 0),
                    markPrice: parseFloat(apiPos.liqPrice ?? apiPos.liq_price ?? apiPos.markPrice ?? apiPos.liquidationPrice ?? 0),
                    status: 'open',
                    broker: broker,
                    bitunixData: apiPos
                })
                console.log(` -> Neue Position in Pendente Trades: ${apiPos.symbol ?? apiPos.symbolName ?? ''} ${normalizedSide}`)
            } catch (err) {
                console.error(' -> Fehler beim Anlegen der Position in Pendente Trades:', err?.response?.data ?? err?.message ?? err)
            }
        }
    }
}

/**
 * Handle positions that have been closed on exchange.
 * For each: fetch history data → create trade record → link metadata → remove from incoming.
 */
async function handleClosedPositions(closedPositions) {
    const broker = selectedBroker.value || 'bitunix'
    const popupsEnabled = currentUser.value?.showTradePopups !== 0

    for (const incoming of closedPositions) {
        try {
            // Fetch history data for the closed position
            const histResponse = await axios.get(`/api/${broker}/position-history/${incoming.positionId}`)

            if (!histResponse.data.ok || !histResponse.data.position) {
                console.log(` -> History für ${incoming.symbol} noch nicht verfügbar, wird übersprungen`)
                continue
            }

            const histPos = histResponse.data.position

            // Create trade record (skip metadata transfer if popups enabled — pending evaluation handles it)
            await createTradeFromClosedPosition(histPos, incoming, popupsEnabled)

            if (incoming.skipEvaluation === 1) {
                // Skip evaluation: just delete the incoming position, no notes/tags transfer
                // Trade stays "unbewertet" in Settings and won't appear in Playbook
                await dbDelete('incoming_positions', incoming.objectId)
                await useUpdatePendingCounts()
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
 * Fetch recently closed positions from exchange history API
 * and create incoming_positions + trade records for any that are new.
 * This catches positions that closed while the app was not monitoring.
 */
async function fetchRecentlyClosed() {
    const broker = selectedBroker.value || 'bitunix'
    try {
        const response = await axios.get(`/api/${broker}/recent-closed`)

        if (!response.data.ok || !response.data.positions?.length) {
            return
        }

        const positions = response.data.positions
        console.log(` -> ${positions.length} kürzlich geschlossene Positionen aus History`)

        const popupsEnabled = currentUser.value?.showTradePopups !== 0

        for (const histPos of positions) {
            const positionId = String(histPos.positionId || '')
            if (!positionId) continue

            // Dedup 1: Check incoming_positions table
            const existingIncoming = await dbFirst('incoming_positions', {
                equalTo: { positionId: positionId }
            })
            if (existingIncoming) continue

            // Dedup 2: Check if trade already exists
            // Support both Bitunix (mtime/ctime) and Bitget (uTime/cTime) timestamps
            const closeTime = parseInt(histPos.mtime || histPos.uTime || histPos.ctime || histPos.cTime)
            const dateUnix = dayjs(closeTime).utc().startOf('day').unix()
            const expectedTradeId = `t${dateUnix}_0_${positionId}`

            const dayRecord = await dbFirst('trades', { equalTo: { dateUnix: dateUnix } })
            if (dayRecord) {
                const dayTrades = Array.isArray(dayRecord.trades) ? dayRecord.trades : []
                if (dayTrades.some(t => t.id === expectedTradeId)) continue
            }

            // New closed position: create trade record
            // Support both Bitunix (side: LONG/SHORT/BUY/SELL) and Bitget (holdSide: long/short)
            const rawSide = histPos.side || (histPos.holdSide || '').toUpperCase() || ''
            const normalizedSide = (rawSide === 'LONG' || rawSide === 'BUY') ? 'LONG' : 'SHORT'

            const incomingStub = {
                positionId: positionId,
                symbol: histPos.symbol || '',
                side: normalizedSide,
                entryPrice: parseFloat(histPos.entryPrice || histPos.openAvgPrice || 0),
                leverage: parseFloat(histPos.leverage || 0),
                quantity: parseFloat(histPos.maxQty || histPos.closeTotalPos || histPos.openTotalPos || 0),
            }

            // Create trade record (skipMetadata = true — no opening metadata yet)
            await createTradeFromClosedPosition(histPos, incomingStub, true)

            if (popupsEnabled) {
                try {
                    await dbCreate('incoming_positions', {
                        positionId: positionId,
                        symbol: histPos.symbol || '',
                        side: normalizedSide,
                        entryPrice: parseFloat(histPos.entryPrice || histPos.openAvgPrice || 0),
                        leverage: parseFloat(histPos.leverage || 0),
                        quantity: parseFloat(histPos.maxQty || histPos.closeTotalPos || histPos.openTotalPos || 0),
                        unrealizedPNL: 0,
                        markPrice: 0,
                        status: 'pending_evaluation',
                        broker: broker,
                        historyData: histPos,
                        bitunixData: histPos
                    })
                    console.log(` -> Neue geschlossene Position in Pendente Trades: ${histPos.symbol} ${normalizedSide}`)
                } catch (err) {
                    if (!err?.message?.includes('UNIQUE') && err?.response?.status !== 500) {
                        console.error(' -> Fehler beim Anlegen der geschlossenen Position:', err?.response?.data ?? err?.message ?? err)
                    }
                }
            } else {
                console.log(` -> Geschlossene Position ${histPos.symbol} als Trade importiert (Popups deaktiviert)`)
            }
        }
    } catch (error) {
        console.log(' -> History-Scan fehlgeschlagen:', error.message)
    }
}

/**
 * Create a trade record from a closed position.
 * Uses the exact same ~40-field trade object format as quickImport.js.
 * Links metadata (playbook → notes, screenshotId → screenshot name).
 */
async function createTradeFromClosedPosition(histPos, incoming, skipMetadata = false) {
    const broker = selectedBroker.value || 'bitunix'
    const isBitget = broker === 'bitget'

    // Bitunix: realizedPNL, fee, funding; Bitget: pnl, openFee, closeFee, totalFunding
    const grossPL = isBitget
        ? parseFloat(histPos.pnl || 0)
        : parseFloat(histPos.realizedPNL || 0)
    const fee = isBitget
        ? Math.abs(parseFloat(histPos.openFee || 0)) + Math.abs(parseFloat(histPos.closeFee || 0)) + Math.abs(parseFloat(histPos.totalFunding || 0))
        : Math.abs(parseFloat(histPos.fee || 0)) + Math.abs(parseFloat(histPos.funding || 0))
    // Bitunix: mtime/ctime; Bitget: uTime/cTime
    const closeTime = parseInt(histPos.mtime || histPos.uTime || histPos.ctime || histPos.cTime)
    const openTime = parseInt(histPos.ctime || histPos.cTime)
    const dateUnix = dayjs(closeTime).utc().startOf('day').unix()

    // Bitunix: side LONG/SHORT/BUY/SELL; Bitget: holdSide long/short
    const rawSide = histPos.side || (histPos.holdSide || '').toUpperCase() || ''
    const side = (rawSide === 'LONG' || rawSide === 'BUY') ? 'B' : 'SS'
    const netPL = isBitget
        ? (parseFloat(histPos.netProfit || 0) || (grossPL - fee))
        : (grossPL - fee)
    const isGrossWin = grossPL > 0
    const isNetWin = netPL > 0
    const quantity = parseFloat(histPos.maxQty || histPos.closeTotalPos || histPos.openTotalPos || 1)
    const entryTime = dayjs(openTime).utc().unix()
    const exitTime = dayjs(closeTime).utc().unix()

    const tradeId = `t${dateUnix}_0_${histPos.positionId}`

    const tradeObj = {
        id: tradeId,
        account: broker,
        broker: broker,
        td: dateUnix,
        currency: 'USDT',
        type: 'futures',
        side: side,
        strategy: side === 'B' ? 'long' : 'short',
        symbol: histPos.symbol || 'FUTURES',
        buyQuantity: quantity,
        sellQuantity: quantity,
        entryPrice: parseFloat(histPos.entryPrice || histPos.openAvgPrice || 0),
        exitPrice: parseFloat(histPos.closePrice || histPos.closeAvgPrice || 0),
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

    // Check if a trade record for this day already exists (same broker only!)
    const existingDay = await dbFirst('trades', { equalTo: { dateUnix: dateUnix, broker: broker } })

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
            broker: broker,
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
 * Ensures tags and closingTags are always independent deep-copied arrays.
 */
async function loadIncomingPositions() {
    const broker = selectedBroker.value || 'bitunix'
    // Load both open and pending_evaluation positions, filtered by broker
    const openResults = await dbFind('incoming_positions', {
        equalTo: { status: 'open', broker: broker },
        descending: 'id'
    })
    const pendingResults = await dbFind('incoming_positions', {
        equalTo: { status: 'pending_evaluation', broker: broker },
        descending: 'id'
    })
    incomingPositions.length = 0

    // Ensure tags and closingTags are independent deep-copied arrays (never shared reference)
    const normalizePosition = (pos) => {
        pos.tags = Array.isArray(pos.tags) ? JSON.parse(JSON.stringify(pos.tags)) : []
        pos.closingTags = Array.isArray(pos.closingTags) ? JSON.parse(JSON.stringify(pos.closingTags)) : []
        if (pos.tags === pos.closingTags) pos.closingTags = []
        return pos
    }

    // Open positions first, then pending evaluation
    openResults.forEach(r => incomingPositions.push(normalizePosition(r)))
    pendingResults.forEach(r => incomingPositions.push(normalizePosition(r)))
}

/**
 * Get incoming positions (for initial page load).
 */
export async function useGetIncomingPositions() {
    await loadIncomingPositions()
}

/**
 * Update metadata on an incoming position.
 * Deep-copies tags/closingTags to prevent shared references.
 */
export async function useUpdateIncomingPosition(objectId, data) {
    await dbUpdate('incoming_positions', objectId, data)
    // Update local state with deep-copied tag arrays
    const idx = incomingPositions.findIndex(p => p.objectId === objectId)
    if (idx !== -1) {
        const safeCopy = { ...data }
        if (safeCopy.tags !== undefined) {
            safeCopy.tags = JSON.parse(JSON.stringify(safeCopy.tags || []))
        }
        if (safeCopy.closingTags !== undefined) {
            safeCopy.closingTags = JSON.parse(JSON.stringify(safeCopy.closingTags || []))
        }
        Object.assign(incomingPositions[idx], safeCopy)
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
    tradeType = '',
    closingNote = '',
    closingStressLevel = 0,
    closingEmotionLevel = 0,
    closingFeelings = '',
    closingTimeframe = '',
    closingPlaybook = '',
    closingScreenshotId = '',
    closingTags = [],
    tradingMetadata = null,
}) {
    // Support both Bitunix (mtime/ctime) and Bitget (uTime/cTime) timestamps
    const closeTime = parseInt(histPos.mtime || histPos.uTime || histPos.ctime || histPos.cTime)
    if (!closeTime || isNaN(closeTime)) {
        console.error(' -> useTransferClosingMetadata: Kein gültiger Zeitstempel in histPos', histPos)
        throw new Error('Kein gültiger Zeitstempel für die geschlossene Position')
    }
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
        tradeType: tradeType || incoming.tradeType || '',
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
        tradingMetadata: tradingMetadata || null,
    })

    // Save satisfaction (only if user actually set a value, -1 = not set)
    if (satisfaction !== null && satisfaction !== undefined && satisfaction >= 0) {
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
