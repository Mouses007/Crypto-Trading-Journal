<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import NoData from '../components/NoData.vue'
import { spinnerLoadingPage, timeZoneTrade } from '../stores/ui.js'
import { allTradeTimeframes, selectedTradeTimeframes, selectedBroker } from '../stores/filters.js'
import { incomingPositions, incomingPollingActive, incomingLastFetched, availableTags } from '../stores/trades.js'
import { currentUser } from '../stores/settings.js'
import { useFetchOpenPositions, useGetIncomingPositions, useUpdateIncomingPosition, useDeleteIncomingPosition, useTransferClosingMetadata } from '../utils/incoming'
import { useGetAvailableTags, useGetTagInfo } from '../utils/daily.js'
import { dbCreate, dbUpdate, dbFind } from '../utils/db.js'
import dayjs from '../utils/dayjs-setup.js'
import Quill from 'quill'
import { sanitizeHtml } from '../utils/sanitize'

const route = useRoute()
const { t } = useI18n()

let pollingInterval = null
const expandedId = ref(null)
const quillInstances = {} // key: positionId_opening / positionId_closing
const incomingError = ref(null)
const savingId = ref(null)

// ===== COMPOUND/FILLS TRACKING =====
import axios from 'axios'
const positionFills = ref({}) // Map: positionId → { loading, trades[], error }

async function fetchPositionFills(positionId, force = false, broker = 'bitunix', symbol = '') {
    if (!positionId) return
    if (!force && positionFills.value[positionId]?.trades) return // cached
    positionFills.value[positionId] = { loading: true, trades: [], error: null }
    try {
        let url, data
        if (broker === 'bitget') {
            // Bitget uses symbol instead of positionId for fills
            const resp = await axios.get(`/api/bitget/position-trades/${encodeURIComponent(symbol)}`)
            data = resp.data
            // Map Bitget fill fields to unified format
            if (data.ok && data.trades) {
                data.trades = data.trades.map(f => ({
                    tradeId: f.tradeId,
                    orderId: f.orderId,
                    symbol: f.symbol,
                    side: f.side === 'buy' ? 'BUY' : 'SELL',
                    price: f.price,
                    qty: f.baseVolume || f.size,
                    fee: f.fee,
                    ctime: f.cTime,
                    reduceOnly: f.tradeSide === 'close' || f.tradeSide === 'reduce_close_short' || f.tradeSide === 'reduce_close_long',
                }))
            }
        } else {
            const resp = await axios.get(`/api/bitunix/position-trades/${positionId}`)
            data = resp.data
        }
        if (data.ok && data.trades) {
            const trades = data.trades.sort((a, b) => parseInt(a.ctime || a.cTime || 0) - parseInt(b.ctime || b.cTime || 0))
            positionFills.value[positionId] = { loading: false, trades, error: null }
        } else {
            positionFills.value[positionId] = { loading: false, trades: [], error: data.error || 'No data' }
        }
    } catch (err) {
        positionFills.value[positionId] = { loading: false, trades: [], error: err.message }
    }
}

function getFillsForPosition(positionId) {
    return positionFills.value[positionId] || { loading: false, trades: [], error: null }
}

function getEntryFills(positionId, side) {
    const fills = getFillsForPosition(positionId)
    // Entry fills: same side as position and not reduceOnly
    const entrySide = side === 'LONG' ? 'BUY' : 'SELL'
    return fills.trades.filter(t => t.side === entrySide && !t.reduceOnly)
}

function getAvgEntryPrice(positionId, side) {
    const entries = getEntryFills(positionId, side)
    if (entries.length === 0) return 0
    let totalValue = 0, totalQty = 0
    for (const e of entries) {
        const qty = parseFloat(e.qty || 0)
        const price = parseFloat(e.price || 0)
        totalValue += qty * price
        totalQty += qty
    }
    return totalQty > 0 ? totalValue / totalQty : 0
}

function getBreakevenPrice(positionId, side) {
    const fillData = getFillsForPosition(positionId)
    if (!fillData.trades || fillData.trades.length === 0) return 0

    const isShort = side === 'SHORT' || side === 'SELL'
    const entrySide = isShort ? 'SELL' : 'BUY'
    const closeSide = isShort ? 'BUY' : 'SELL'

    let entryValue = 0, entryQty = 0
    let closeValue = 0, closeQty = 0
    let totalFees = 0

    for (const f of fillData.trades) {
        const qty = parseFloat(f.qty || 0)
        const price = parseFloat(f.price || 0)
        const fee = parseFloat(f.fee || 0)
        totalFees += fee

        if (f.side === entrySide && !f.reduceOnly) {
            entryValue += qty * price
            entryQty += qty
        } else if (f.reduceOnly || f.side === closeSide) {
            closeValue += qty * price
            closeQty += qty
        }
    }

    const remainingQty = entryQty - closeQty
    if (remainingQty <= 0) return 0

    if (isShort) {
        // SHORT: breakeven = (entryValue - closeValue - totalFees) / remainingQty
        return (entryValue - closeValue - totalFees) / remainingQty
    } else {
        // LONG: breakeven = (entryValue - closeValue + totalFees) / remainingQty
        return (entryValue - closeValue + totalFees) / remainingQty
    }
}

function getRRR(positionId, side) {
    const tpsl = getTpSlForPosition(positionId)
    if (!tpsl.sl || !tpsl.tp) return null
    const entry = getAvgEntryPrice(positionId, side)
    if (entry <= 0) return null
    const riskDist = Math.abs(entry - parseFloat(tpsl.sl))
    const rewardDist = Math.abs(entry - parseFloat(tpsl.tp))
    if (riskDist <= 0) return null
    return (rewardDist / riskDist).toFixed(1)
}

function isSLAboveBreakeven(positionId, side) {
    const tpsl = getTpSlForPosition(positionId)
    if (!tpsl.sl) return false
    const be = getBreakevenPrice(positionId, side)
    if (be <= 0) return false
    const isShort = side === 'SHORT' || side === 'SELL'
    // SHORT: SL is "above BE" (safe) when SL price is BELOW BE (closer to profit)
    // LONG: SL is "above BE" (safe) when SL price is ABOVE BE (closer to profit)
    if (isShort) return tpsl.sl < be
    return tpsl.sl > be
}

function formatFillTime(ctime) {
    return dayjs(parseInt(ctime)).tz(timeZoneTrade.value).format('DD.MM. HH:mm')
}

function getIncomingFillBadgeType(fill, idx, allFills) {
    if (fill.reduceOnly) {
        const openQty = allFills.filter(f => !f.reduceOnly).reduce((sum, f) => sum + parseFloat(f.qty || 0), 0)
        const totalClosedQty = allFills.filter(f => f.reduceOnly).reduce((sum, f) => sum + parseFloat(f.qty || 0), 0)
        return totalClosedQty >= openQty ? 'close' : 'partialClose'
    }
    if (idx === 0 || allFills.slice(0, idx).every(f => f.reduceOnly)) return 'initial'
    return 'compound'
}

function groupFillsByMinute(fills, timeField = 'time') {
    if (!fills || fills.length === 0) return []
    const groups = []
    let current = null
    for (let i = 0; i < fills.length; i++) {
        const fill = fills[i]
        const minute = dayjs(parseInt(fill[timeField])).tz(timeZoneTrade.value).format('YYYY-MM-DD HH:mm')
        const key = minute + '_' + (fill.reduceOnly ? '1' : '0')
        if (current && current.key === key) {
            current.fills.push(fill)
        } else {
            current = { key, fills: [fill], time: fill[timeField], reduceOnly: fill.reduceOnly }
            groups.push(current)
        }
    }
    return groups.map(g => {
        const totalQty = g.fills.reduce((s, f) => s + parseFloat(f.qty || 0), 0)
        const totalValue = g.fills.reduce((s, f) => s + parseFloat(f.qty || 0) * parseFloat(f.price || 0), 0)
        const totalFee = g.fills.reduce((s, f) => s + parseFloat(f.fee || 0), 0)
        return {
            ...g,
            totalQty,
            avgPrice: totalQty > 0 ? totalValue / totalQty : 0,
            totalValue,
            totalFee,
            isGroup: g.fills.length > 1,
            firstFillIdx: fills.indexOf(g.fills[0])
        }
    })
}

const expandedFillGroups = ref(new Set())
function toggleFillGroup(key) {
    if (expandedFillGroups.value.has(key)) {
        expandedFillGroups.value.delete(key)
    } else {
        expandedFillGroups.value.add(key)
    }
}

// ===== TP/SL TRACKING =====
const positionTpSl = ref({}) // Map: positionId → { loading, orders[], error }
const tpSlHistory = ref({}) // Map: positionId → [{ time, type, oldVal, newVal }]

// Load history from localStorage
function loadTpSlHistory(positionId) {
    if (tpSlHistory.value[positionId]) return tpSlHistory.value[positionId]
    try {
        const stored = localStorage.getItem(`tpsl_history_${positionId}`)
        const history = stored ? JSON.parse(stored) : []
        tpSlHistory.value[positionId] = history
        return history
    } catch { return [] }
}

function saveTpSlHistory(positionId, history) {
    tpSlHistory.value[positionId] = history
    localStorage.setItem(`tpsl_history_${positionId}`, JSON.stringify(history))
}

function wasTpSlTriggered(positionId, type, oldPrice) {
    // Check if there's a recent reduceOnly fill near the SL/TP price
    const fillData = getFillsForPosition(positionId)
    if (!fillData.trades || fillData.trades.length === 0) return false
    const fiveMinAgo = Date.now() - 5 * 60 * 1000
    return fillData.trades.some(f => {
        if (!f.reduceOnly) return false
        const fillTime = parseInt(f.ctime || 0)
        if (fillTime < fiveMinAgo) return false
        const fillPrice = parseFloat(f.price || 0)
        // Price within 0.5% of target = triggered
        return Math.abs(fillPrice - oldPrice) / oldPrice < 0.005
    })
}

function trackTpSlChanges(positionId, newSl, newTp) {
    const history = loadTpSlHistory(positionId)
    const now = Date.now()

    // Get last known values from history
    let lastSl = null, lastTp = null
    for (let i = history.length - 1; i >= 0; i--) {
        if (lastSl === null && history[i].type === 'SL') lastSl = history[i].newVal
        if (lastTp === null && history[i].type === 'TP') lastTp = history[i].newVal
        if (lastSl !== null && lastTp !== null) break
    }

    let changed = false

    // Track SL changes
    if (newSl !== lastSl) {
        if (lastSl === null && newSl !== null) {
            history.push({ time: now, type: 'SL', oldVal: null, newVal: newSl, action: 'set' })
        } else if (lastSl !== null && newSl === null) {
            const triggered = wasTpSlTriggered(positionId, 'SL', lastSl)
            history.push({ time: now, type: 'SL', oldVal: lastSl, newVal: null, action: triggered ? 'triggered' : 'removed' })
        } else if (newSl !== null) {
            history.push({ time: now, type: 'SL', oldVal: lastSl, newVal: newSl, action: 'moved' })
        }
        changed = true
    }

    // Track TP changes
    if (newTp !== lastTp) {
        if (lastTp === null && newTp !== null) {
            history.push({ time: now, type: 'TP', oldVal: null, newVal: newTp, action: 'set' })
        } else if (lastTp !== null && newTp === null) {
            const triggered = wasTpSlTriggered(positionId, 'TP', lastTp)
            history.push({ time: now, type: 'TP', oldVal: lastTp, newVal: null, action: triggered ? 'triggered' : 'removed' })
        } else if (newTp !== null) {
            history.push({ time: now, type: 'TP', oldVal: lastTp, newVal: newTp, action: 'moved' })
        }
        changed = true
    }

    if (changed) saveTpSlHistory(positionId, history)
}

function getTpSlHistoryForPosition(positionId) {
    return loadTpSlHistory(positionId)
}

async function fetchPositionTpSl(positionId, force = false, broker = 'bitunix', symbol = '') {
    if (!positionId) return
    if (!force && positionTpSl.value[positionId]?.orders) return // cached
    positionTpSl.value[positionId] = { loading: true, orders: [], error: null }
    try {
        let data
        if (broker === 'bitget') {
            const resp = await axios.get(`/api/bitget/position-tpsl/${encodeURIComponent(symbol)}`)
            data = resp.data
        } else {
            const resp = await axios.get(`/api/bitunix/position-tpsl/${positionId}`)
            data = resp.data
        }
        if (data.ok && data.orders) {
            positionTpSl.value[positionId] = { loading: false, orders: data.orders, error: null }
            // Track changes
            const current = getTpSlForPosition(positionId)
            trackTpSlChanges(positionId, current.sl, current.tp)
        } else {
            positionTpSl.value[positionId] = { loading: false, orders: [], error: null }
            trackTpSlChanges(positionId, null, null)
        }
    } catch (err) {
        positionTpSl.value[positionId] = { loading: false, orders: [], error: err.message }
    }
}

function getTpSlForPosition(positionId) {
    const data = positionTpSl.value[positionId]
    if (!data || !data.orders || data.orders.length === 0) return { sl: null, tp: null, orders: [] }
    // Safety: filter orders by positionId (API may return all pending orders)
    const posId = String(positionId)
    const filtered = data.orders.filter(o =>
        !o.positionId && !o.position_id || String(o.positionId || o.position_id || '') === posId
    )
    // Aggregate: collect all SL/TP values
    let sl = null, tp = null, slQty = 0, tpQty = 0
    for (const o of filtered) {
        if (o.slPrice && parseFloat(o.slPrice) > 0) {
            sl = parseFloat(o.slPrice)
            slQty += parseFloat(o.slQty || 0)
        }
        if (o.tpPrice && parseFloat(o.tpPrice) > 0) {
            tp = parseFloat(o.tpPrice)
            tpQty += parseFloat(o.tpQty || 0)
        }
    }
    return { sl, tp, slQty, tpQty, orders: filtered }
}

// Screenshot upload state — separate previews for trend, entry and closing
const trendScreenshotPreviews = ref({}) // positionId → base64
const entryScreenshotPreviews = ref({}) // positionId → base64
const closingScreenshotPreviews = ref({}) // positionId → base64

// Timeframes from settings (or fallback to all)
const timeframeOptions = computed(() => {
    if (selectedTradeTimeframes.length > 0) {
        return allTradeTimeframes.value.filter(tf => selectedTradeTimeframes.includes(tf.value))
    }
    return allTradeTimeframes.value
})

// Always load from API when entering the page (including first open)
async function loadPageData() {
    spinnerLoadingPage.value = true
    incomingError.value = null
    try {
        await useGetAvailableTags()
        await useFetchOpenPositions()
    } catch (error) {
        incomingError.value = error.response?.data?.error || error.message || t('common.errorLoading')
    }
    spinnerLoadingPage.value = false
}

// Load when entering the route (first open + return from another page)
watch(() => route.name, (name) => {
    if (name === 'incoming') {
        loadPageData()
    }
}, { immediate: true })

onMounted(() => {
    // Polling every 60 seconds
    pollingInterval = setInterval(async () => {
        try {
            await useFetchOpenPositions()
            incomingError.value = null
        } catch (error) {
            console.error(' -> Polling error:', error)
        }
    }, 60000)
})

onBeforeUnmount(() => {
    if (pollingInterval) {
        clearInterval(pollingInterval)
        pollingInterval = null
    }
    // Destroy all Quill instances
    Object.keys(quillInstances).forEach(key => {
        delete quillInstances[key]
    })
})

async function manualRefresh() {
    incomingError.value = null
    try {
        await useFetchOpenPositions()
        // Re-fetch fills and TP/SL for expanded position
        if (expandedId.value) {
            const expandPos = incomingPositions.find(p => p.positionId === expandedId.value)
            if (expandPos) {
                fetchPositionFills(expandedId.value, true, expandPos.broker, expandPos.symbol)
                fetchPositionTpSl(expandedId.value, true, expandPos.broker, expandPos.symbol)
                // If position transitioned to pending_evaluation, init closing Quill
                if (expandPos.status === 'pending_evaluation') {
                    await nextTick()
                    initQuillEditor(expandedId.value, 'closing')
                    autoDetectAndSetTradeType(expandPos)
                }
            }
        }
    } catch (error) {
        incomingError.value = error.response?.data?.error || error.message || t('incoming.errorUpdatingCounters')
    }
}

async function toggleExpand(positionId) {
    // Close current: clean up Quill instances
    if (expandedId.value && expandedId.value !== positionId) {
        delete quillInstances[expandedId.value + '_opening']
        delete quillInstances[expandedId.value + '_closing']
    }

    if (expandedId.value === positionId) {
        delete quillInstances[positionId + '_opening']
        delete quillInstances[positionId + '_closing']
        expandedId.value = null
        return
    }

    expandedId.value = positionId

    // Fetch fills and TP/SL for open and pending_evaluation positions (Bitunix + Bitget)
    const expandPos = incomingPositions.find(p => p.positionId === positionId)
    // Screenshot-Previews aus DB laden
    if (expandPos) loadScreenshotPreviews(expandPos)
    if (expandPos && (expandPos.status === 'open' || expandPos.status === 'pending_evaluation') && (expandPos.broker === 'bitunix' || expandPos.broker === 'bitget')) {
        fetchPositionFills(positionId, false, expandPos.broker, expandPos.symbol)
        fetchPositionTpSl(positionId, false, expandPos.broker, expandPos.symbol)
    }

    // Initialize Quill editors after DOM renders
    await nextTick()
    initQuillEditor(positionId, 'opening')
    // Only init closing Quill if position is pending evaluation
    if (expandPos && expandPos.status === 'pending_evaluation') {
        initQuillEditor(positionId, 'closing')
        autoDetectAndSetTradeType(expandPos)
    }
}

function initQuillEditor(positionId, type) {
    const editorId = `quillIncoming-${positionId}-${type}`
    const key = `${positionId}_${type}`
    const editorEl = document.getElementById(editorId)

    if (editorEl && !quillInstances[key]) {
        const quill = new Quill(editorEl, {
            modules: {
                toolbar: [
                    [{ header: [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                ]
            },
            theme: 'snow'
        })
        quill.root.setAttribute('spellcheck', true)
        quillInstances[key] = quill

        // Load existing content
        const pos = incomingPositions.find(p => p.positionId === positionId)
        if (pos) {
            if (type === 'opening' && pos.playbook) {
                quill.root.innerHTML = sanitizeHtml(pos.playbook)
            } else if (type === 'closing' && pos.closingPlaybook) {
                quill.root.innerHTML = sanitizeHtml(pos.closingPlaybook)
            }
        }
    }
}

// ===== TRADE TYPE HANDLER =====

const tradeTypeOptions = [
    { value: 'scalp', labelKey: 'incoming.scalptrade' },
    { value: 'day', labelKey: 'incoming.daytrade' },
    { value: 'swing', labelKey: 'incoming.swingtrade' },
]

function updateTradeType(pos, value) {
    const newValue = pos.tradeType === value ? '' : value
    pos.tradeType = newValue
    useUpdateIncomingPosition(pos.objectId, { tradeType: newValue })
    // Mark as manually overridden so auto-detect doesn't re-apply
    if (pos.status === 'pending_evaluation') {
        autoDetectedTradeType.value[pos.positionId] = false
    }
}

// ===== TRADE TYPE AUTO-DETECTION =====

const autoDetectedTradeType = ref({}) // positionId → true (auto) / false (manual override)
const tpslHistoryCollapsed = ref({}) // positionId → true/false

function getTradeDurationMinutes(pos) {
    let hd = pos.historyData
    if (!hd) return null
    if (typeof hd === 'string') { try { hd = JSON.parse(hd) } catch { return null } }
    const openTime = parseInt(hd.ctime || hd.cTime || 0)
    const closeTime = parseInt(hd.mtime || hd.uTime || 0)
    if (!openTime || !closeTime || closeTime <= openTime) return null
    return (closeTime - openTime) / (1000 * 60)
}

function detectTradeType(durationMinutes) {
    const scalpMax = currentUser.value?.scalpMaxMinutes ?? 15
    const daytradeMaxMinutes = (currentUser.value?.daytradeMaxHours ?? 24) * 60
    if (durationMinutes <= scalpMax) return 'scalp'
    if (durationMinutes <= daytradeMaxMinutes) return 'day'
    return 'swing'
}

function autoDetectAndSetTradeType(pos) {
    if (pos.status !== 'pending_evaluation') return
    if (!pos.historyData) return
    if (autoDetectedTradeType.value[pos.positionId] === false) return // manual override

    const durationMin = getTradeDurationMinutes(pos)
    if (durationMin === null) return

    const detected = detectTradeType(durationMin)
    if (pos.tradeType !== detected) {
        pos.tradeType = detected
        useUpdateIncomingPosition(pos.objectId, { tradeType: detected })
    }
    if (autoDetectedTradeType.value[pos.positionId] === undefined) {
        autoDetectedTradeType.value[pos.positionId] = true
    }
}

function formatDuration(minutes) {
    if (minutes === null || minutes === undefined) return ''
    if (minutes < 60) return `${Math.round(minutes)}m`
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`
    const days = Math.floor(minutes / 1440)
    const hours = Math.floor((minutes % 1440) / 60)
    return `${days}d ${hours}h`
}

// ===== OPENING FIELD HANDLERS =====

function updateStress(pos, level) {
    const newLevel = pos.stressLevel === level ? 0 : level
    pos.stressLevel = newLevel
    useUpdateIncomingPosition(pos.objectId, { stressLevel: newLevel })
}

function updateEmotionLevel(pos, level) {
    const newLevel = pos.emotionLevel === level ? 0 : level
    pos.emotionLevel = newLevel
    useUpdateIncomingPosition(pos.objectId, { emotionLevel: newLevel })
}

function updateTimeframe(pos, value) {
    const newValue = pos.entryTimeframe === value ? '' : value
    pos.entryTimeframe = newValue
    useUpdateIncomingPosition(pos.objectId, { entryTimeframe: newValue })
}

// ===== CLOSING FIELD HANDLERS =====

function updateStrategyFollowed(pos, value) {
    const newValue = pos.strategyFollowed === value ? -1 : value
    pos.strategyFollowed = newValue
    useUpdateIncomingPosition(pos.objectId, { strategyFollowed: newValue })
}

function updateClosingStress(pos, level) {
    const newLevel = (pos.closingStressLevel || 0) === level ? 0 : level
    pos.closingStressLevel = newLevel
    useUpdateIncomingPosition(pos.objectId, { closingStressLevel: newLevel })
}

function updateClosingEmotionLevel(pos, level) {
    const newLevel = (pos.closingEmotionLevel || 0) === level ? 0 : level
    pos.closingEmotionLevel = newLevel
    useUpdateIncomingPosition(pos.objectId, { closingEmotionLevel: newLevel })
}

function updateClosingTimeframe(pos, value) {
    const newValue = (pos.closingTimeframe || '') === value ? '' : value
    pos.closingTimeframe = newValue
    useUpdateIncomingPosition(pos.objectId, { closingTimeframe: newValue })
}

// ===== TAG HANDLERS =====

function addTag(pos, tag) {
    // Ensure opening and closing tags don't share the same reference
    if (pos.tags === pos.closingTags) pos.closingTags = Array.isArray(pos.closingTags) ? JSON.parse(JSON.stringify(pos.closingTags)) : []
    if (!Array.isArray(pos.tags)) pos.tags = []
    if (pos.tags.some(t => t.id === tag.id)) return
    pos.tags.push({ id: tag.id, name: tag.name })
}

function removeTag(pos, idx) {
    if (!pos.tags) return
    pos.tags.splice(idx, 1)
}

function addClosingTag(pos, tag) {
    // Ensure opening and closing tags don't share the same reference
    if (pos.closingTags === pos.tags) pos.tags = Array.isArray(pos.tags) ? JSON.parse(JSON.stringify(pos.tags)) : []
    if (!Array.isArray(pos.closingTags)) pos.closingTags = []
    if (pos.closingTags.some(t => t.id === tag.id)) return
    pos.closingTags.push({ id: tag.id, name: tag.name })
}

function removeClosingTag(pos, idx) {
    if (!pos.closingTags) return
    pos.closingTags.splice(idx, 1)
}

function getTagColor(tagId) {
    const info = useGetTagInfo(tagId)
    return info?.groupColor || '#6c757d'
}

// ===== SATISFACTION HANDLER =====

function updateSatisfaction(pos, val) {
    pos.satisfaction = pos.satisfaction === val ? null : val
    useUpdateIncomingPosition(pos.objectId, { satisfaction: pos.satisfaction })
}

// ===== SCREENSHOT HANDLERS =====

async function handleEntryScreenshotUpload(event, pos) {
    const file = event.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onloadend = async () => {
        const base64 = reader.result

        const screenshot = await dbCreate('screenshots', {
            name: `incoming_entry_${pos.positionId}`,
            symbol: pos.symbol,
            side: pos.side === 'LONG' ? 'B' : 'SS',
            broker: pos.broker || selectedBroker.value || 'bitunix',
            originalBase64: base64,
            annotatedBase64: '',
            markersOnly: 1,
            maState: {},
            dateUnix: dayjs().unix(),
            dateUnixDay: dayjs().utc().startOf('day').unix()
        })

        await useUpdateIncomingPosition(pos.objectId, { entryScreenshotId: screenshot.objectId })
        pos.entryScreenshotId = screenshot.objectId
        entryScreenshotPreviews.value[pos.positionId] = base64
    }
    reader.readAsDataURL(file)
}

async function removeEntryScreenshot(pos) {
    if (pos.entryScreenshotId) {
        await useUpdateIncomingPosition(pos.objectId, { entryScreenshotId: '' })
        pos.entryScreenshotId = ''
        delete entryScreenshotPreviews.value[pos.positionId]
    }
}

async function handleTrendScreenshotUpload(event, pos) {
    const file = event.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onloadend = async () => {
        const base64 = reader.result

        const screenshot = await dbCreate('screenshots', {
            name: `incoming_trend_${pos.positionId}`,
            symbol: pos.symbol,
            side: pos.side === 'LONG' ? 'B' : 'SS',
            broker: pos.broker || selectedBroker.value || 'bitunix',
            originalBase64: base64,
            annotatedBase64: '',
            markersOnly: 1,
            maState: {},
            dateUnix: dayjs().unix(),
            dateUnixDay: dayjs().utc().startOf('day').unix()
        })

        await useUpdateIncomingPosition(pos.objectId, { trendScreenshotId: screenshot.objectId })
        pos.trendScreenshotId = screenshot.objectId
        trendScreenshotPreviews.value[pos.positionId] = base64
    }
    reader.readAsDataURL(file)
}

async function removeTrendScreenshot(pos) {
    if (pos.trendScreenshotId) {
        await useUpdateIncomingPosition(pos.objectId, { trendScreenshotId: '' })
        pos.trendScreenshotId = ''
        delete trendScreenshotPreviews.value[pos.positionId]
    }
}

async function loadScreenshotPreviews(pos) {
    // Entry-Screenshot laden
    if (pos.entryScreenshotId && !entryScreenshotPreviews.value[pos.positionId]) {
        try {
            const results = await dbFind('screenshots', { equalTo: { objectId: pos.entryScreenshotId }, limit: 1 })
            if (results.length > 0) {
                entryScreenshotPreviews.value[pos.positionId] = results[0].annotatedBase64 || results[0].originalBase64
            }
        } catch (e) { console.log('Screenshot-Load fehlgeschlagen:', e) }
    }
    // Trend-Screenshot laden
    if (pos.trendScreenshotId && !trendScreenshotPreviews.value[pos.positionId]) {
        try {
            const results = await dbFind('screenshots', { equalTo: { objectId: pos.trendScreenshotId }, limit: 1 })
            if (results.length > 0) {
                trendScreenshotPreviews.value[pos.positionId] = results[0].annotatedBase64 || results[0].originalBase64
            }
        } catch (e) { console.log('Screenshot-Load fehlgeschlagen:', e) }
    }
    // Closing-Screenshot laden
    if (pos.closingScreenshotId && !closingScreenshotPreviews.value[pos.positionId]) {
        try {
            const results = await dbFind('screenshots', { equalTo: { objectId: pos.closingScreenshotId }, limit: 1 })
            if (results.length > 0) {
                closingScreenshotPreviews.value[pos.positionId] = results[0].annotatedBase64 || results[0].originalBase64
            }
        } catch (e) { console.log('Screenshot-Load fehlgeschlagen:', e) }
    }
}

async function handleClosingScreenshotUpload(event, pos) {
    const file = event.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onloadend = async () => {
        const base64 = reader.result

        const screenshot = await dbCreate('screenshots', {
            name: `incoming_closing_${pos.positionId}`,
            symbol: pos.symbol,
            side: pos.side === 'LONG' ? 'B' : 'SS',
            broker: pos.broker || selectedBroker.value || 'bitunix',
            originalBase64: base64,
            annotatedBase64: '',
            markersOnly: 1,
            maState: {},
            dateUnix: dayjs().unix(),
            dateUnixDay: dayjs().utc().startOf('day').unix()
        })

        await useUpdateIncomingPosition(pos.objectId, { closingScreenshotId: screenshot.objectId })
        pos.closingScreenshotId = screenshot.objectId
        closingScreenshotPreviews.value[pos.positionId] = base64
    }
    reader.readAsDataURL(file)
}

async function removeClosingScreenshot(pos) {
    if (pos.closingScreenshotId) {
        await useUpdateIncomingPosition(pos.objectId, { closingScreenshotId: '' })
        pos.closingScreenshotId = ''
        delete closingScreenshotPreviews.value[pos.positionId]
    }
}

// ===== SAVE / COMPLETE =====

async function saveMetadata(pos) {
    savingId.value = pos.objectId
    const data = {
        feelings: pos.feelings || '',
        stressLevel: pos.stressLevel || 0,
        emotionLevel: pos.emotionLevel || 0,
        entryTimeframe: pos.entryTimeframe || '',
        tradeType: pos.tradeType || '',
        tags: JSON.parse(JSON.stringify(pos.tags || [])),
        skipEvaluation: pos.skipEvaluation || 0,
        satisfaction: pos.satisfaction != null ? pos.satisfaction : null,
        // Closing fields
        strategyFollowed: pos.strategyFollowed != null ? pos.strategyFollowed : -1,
        closingStressLevel: pos.closingStressLevel || 0,
        closingEmotionLevel: pos.closingEmotionLevel || 0,
        closingFeelings: pos.closingFeelings || '',
        closingTimeframe: pos.closingTimeframe || '',
        closingTags: JSON.parse(JSON.stringify(pos.closingTags || [])),
    }

    // Get opening Quill content
    const openingKey = pos.positionId + '_opening'
    if (quillInstances[openingKey]) {
        data.playbook = quillInstances[openingKey].root.innerHTML
    }

    // Get closing Quill content
    const closingKey = pos.positionId + '_closing'
    if (quillInstances[closingKey]) {
        data.closingPlaybook = quillInstances[closingKey].root.innerHTML
    }

    await useUpdateIncomingPosition(pos.objectId, data)

    // Save Quill content to pos
    if (data.playbook) pos.playbook = data.playbook
    if (data.closingPlaybook) pos.closingPlaybook = data.closingPlaybook

    // If "Trade nicht bewerten" is checked and position is pending_evaluation,
    // just delete the incoming position — NO notes/satisfactions/tags transfer,
    // so the trade stays "unbewertet" in Settings and won't appear in Playbook.
    if (pos.skipEvaluation === 1 && pos.status === 'pending_evaluation') {
        try {
            await useDeleteIncomingPosition(pos.objectId)
        } catch (error) {
            console.error('Error skipping evaluation:', error)
        }
    }

    savingId.value = null
    delete quillInstances[openingKey]
    delete quillInstances[closingKey]
    expandedId.value = null
}

const closingId = ref(null)

async function completeClosingEvaluation(pos) {
    if (!pos.historyData || pos.status !== 'pending_evaluation') return

    closingId.value = pos.objectId

    try {
        // First save any unsaved metadata (deep-copy tags to prevent shared references)
        const data = {
            feelings: pos.feelings || '',
            stressLevel: pos.stressLevel || 0,
            emotionLevel: pos.emotionLevel || 0,
            entryTimeframe: pos.entryTimeframe || '',
            tradeType: pos.tradeType || '',
            tags: JSON.parse(JSON.stringify(pos.tags || [])),
            satisfaction: pos.satisfaction != null ? pos.satisfaction : null,
            strategyFollowed: pos.strategyFollowed != null ? pos.strategyFollowed : -1,
            closingStressLevel: pos.closingStressLevel || 0,
            closingEmotionLevel: pos.closingEmotionLevel || 0,
            closingFeelings: pos.closingFeelings || '',
            closingTimeframe: pos.closingTimeframe || '',
            closingTags: JSON.parse(JSON.stringify(pos.closingTags || [])),
        }
        const openingKey = pos.positionId + '_opening'
        const closingKey = pos.positionId + '_closing'
        if (quillInstances[openingKey]) {
            data.playbook = quillInstances[openingKey].root.innerHTML
            pos.playbook = data.playbook
        }
        if (quillInstances[closingKey]) {
            data.closingPlaybook = quillInstances[closingKey].root.innerHTML
            pos.closingPlaybook = data.closingPlaybook
        }
        await useUpdateIncomingPosition(pos.objectId, data)

        // Ensure fills are loaded before building metadata
        if (!positionFills.value[pos.positionId]?.trades?.length) {
            await fetchPositionFills(pos.positionId, true, pos.broker || 'bitunix', pos.symbol || '')
        }

        // Build trading metadata for AI review
        const tpsl = getTpSlForPosition(pos.positionId)
        const fillData = getFillsForPosition(pos.positionId)
        const bePrice = getBreakevenPrice(pos.positionId, pos.side)
        const slAboveBe = isSLAboveBreakeven(pos.positionId, pos.side)
        const margin = parseFloat(pos.bitunixData?.margin || 0)
        const leverage = parseFloat(pos.leverage || 1)
        const tpslHistory = getTpSlHistoryForPosition(pos.positionId)

        const rrr = getRRR(pos.positionId, pos.side)

        const tradingMeta = {
            sl: tpsl.sl || null,
            tp: tpsl.tp || null,
            slQty: tpsl.slQty || null,
            tpQty: tpsl.tpQty || null,
            breakeven: bePrice > 0 ? parseFloat(bePrice.toFixed(5)) : null,
            slAboveBreakeven: slAboveBe,
            rrr: rrr ? parseFloat(rrr) : null,
            margin: margin,
            leverage: leverage,
            positionSize: parseFloat((margin * leverage).toFixed(2)),
            fills: (fillData.trades || []).map(f => ({
                time: f.ctime,
                qty: parseFloat(f.qty || 0),
                price: parseFloat(f.price || 0),
                fee: parseFloat(f.fee || 0),
                reduceOnly: !!f.reduceOnly,
                side: f.side
            })),
            tpslHistory: (() => {
                // Filter out entries recorded after the last fill (position close artifacts)
                const fills = (fillData.trades || [])
                const lastFillTime = fills.length > 0
                    ? Math.max(...fills.map(f => parseInt(f.ctime || 0)))
                    : 0
                const cutoff = lastFillTime ? lastFillTime + 60000 : Infinity
                return tpslHistory
                    .filter(h => h.time <= cutoff)
                    .map(h => ({
                        time: h.time,
                        type: h.type,
                        action: h.action,
                        oldVal: h.oldVal,
                        newVal: h.newVal
                    }))
            })()
        }

        // Transfer metadata to trade record and delete incoming position
        await useTransferClosingMetadata(
            pos,
            pos.historyData,
            {
                note: '',
                tags: JSON.parse(JSON.stringify(pos.tags || [])),
                satisfaction: pos.satisfaction != null ? pos.satisfaction : null,
                stressLevel: pos.stressLevel || 0,
                tradeType: pos.tradeType || '',
                strategyFollowed: pos.strategyFollowed != null ? pos.strategyFollowed : -1,
                closingNote: pos.closingPlaybook || '',
                closingStressLevel: pos.closingStressLevel || 0,
                closingEmotionLevel: pos.closingEmotionLevel || 0,
                closingFeelings: pos.closingFeelings || '',
                closingTimeframe: pos.closingTimeframe || '',
                closingPlaybook: pos.closingPlaybook || '',
                closingScreenshotId: pos.closingScreenshotId || '',
                closingTags: JSON.parse(JSON.stringify(pos.closingTags || [])),
                tradingMetadata: tradingMeta,
            }
        )

        // Remove from local list
        const idx = incomingPositions.findIndex(p => p.objectId === pos.objectId)
        if (idx !== -1) {
            incomingPositions.splice(idx, 1)
        }

        delete quillInstances[openingKey]
        delete quillInstances[closingKey]
        expandedId.value = null
    } catch (error) {
        console.error('Error completing evaluation:', error)
        alert(t('common.errorPrefix') + (error?.response?.data?.error || error.message || t('common.error')))
    } finally {
        closingId.value = null
    }
}

// ===== FORMATTING =====

function formatCurrency(val) {
    const num = parseFloat(val || 0)
    return (num >= 0 ? '+' : '') + num.toFixed(2) + ' USDT'
}

function formatTime(date) {
    if (!date) return ''
    return dayjs(date).tz(timeZoneTrade.value).format('HH:mm:ss')
}

function getPositionDate(pos) {
    const ctime = pos.bitunixData?.ctime
    if (ctime) {
        return dayjs(parseInt(ctime)).tz(timeZoneTrade.value).format('DD.MM.YYYY')
    }
    if (pos.createdAt) {
        return dayjs(pos.createdAt).format('DD.MM.YYYY')
    }
    return ''
}
</script>

<template>
    <div class="row mt-2">
        <div v-show="!spinnerLoadingPage">
            <!-- Header -->
            <div class="row mb-3 align-items-center">
                <div class="col">
                    <small v-if="incomingLastFetched" class="text-muted">
                        {{ t('incoming.lastUpdated') }} {{ formatTime(incomingLastFetched) }}
                        <span v-if="incomingPollingActive" class="spinner-border spinner-border-sm ms-2" role="status"></span>
                    </small>
                </div>
                <div class="col-auto">
                    <button class="btn btn-sm btn-outline-primary" @click="manualRefresh" :disabled="incomingPollingActive">
                        <i class="uil uil-sync me-1"></i>{{ t('incoming.refresh') }}
                    </button>
                </div>
            </div>

            <!-- Error -->
            <div v-if="incomingError" class="alert alert-danger">{{ incomingError }}</div>

            <!-- No positions -->
            <NoData v-if="incomingPositions.length === 0 && !incomingError" />

            <!-- Position cards -->
            <div v-for="pos in incomingPositions" :key="pos.positionId" class="dailyCard incoming-card mb-2 p-2">
                <!-- Card header -->
                <div class="row align-items-center pointerClass" @click="toggleExpand(pos.positionId)">
                    <div class="col-auto">
                        <strong class="fs-5">{{ pos.symbol }}</strong>
                        <span class="ms-2 fw-bold" :class="pos.side === 'LONG' ? 'greenTrade' : 'redTrade'">
                            {{ pos.side }}
                        </span>
                        <span class="ms-2 incoming-info">{{ pos.leverage }}x</span>
                        <span v-if="pos.status === 'pending_evaluation'" class="badge bg-warning text-dark ms-2">{{ t('incoming.closed') }}</span>
                    </div>
                    <div class="col text-end">
                        <span v-if="pos.status === 'pending_evaluation' && pos.historyData?.realizedPNL"
                            class="incoming-pnl fw-bold"
                            :class="parseFloat(pos.historyData.realizedPNL) >= 0 ? 'greenTrade' : 'redTrade'">
                            {{ formatCurrency(pos.historyData.realizedPNL) }}
                        </span>
                        <span v-else class="incoming-pnl" :class="parseFloat(pos.unrealizedPNL || 0) >= 0 ? 'greenTrade' : 'redTrade'">
                            {{ formatCurrency(pos.unrealizedPNL) }}
                        </span>
                    </div>
                    <div class="col-auto">
                        <i :class="expandedId === pos.positionId ? 'uil-angle-up' : 'uil-angle-down'" class="uil fs-4"></i>
                    </div>
                </div>

                <!-- Trade info line -->
                <div class="row mt-1">
                    <div class="col">
                        <small class="incoming-info">
                            {{ t('incoming.entry') }}
                            <template v-if="getEntryFills(pos.positionId, pos.side).length > 1">
                                Ø {{ getAvgEntryPrice(pos.positionId, pos.side).toFixed(5) }} ({{ getEntryFills(pos.positionId, pos.side).length }}×)
                            </template>
                            <template v-else>
                                {{ parseFloat(pos.entryPrice || 0).toFixed(2) }}
                            </template>
                            <template v-if="getBreakevenPrice(pos.positionId, pos.side) > 0">
                                | <span class="text-muted">BE: {{ getBreakevenPrice(pos.positionId, pos.side).toFixed(2) }}</span>
                            </template>
                            <template v-if="getTpSlForPosition(pos.positionId).sl">
                                | <span :style="isSLAboveBreakeven(pos.positionId, pos.side) ? 'color: #86efac' : ''" :class="!isSLAboveBreakeven(pos.positionId, pos.side) ? 'text-danger' : ''">SL: {{ getTpSlForPosition(pos.positionId).sl }}</span>
                            </template>
                            <template v-if="getTpSlForPosition(pos.positionId).tp">
                                | <span style="color: #f59e0b;">TP: {{ getTpSlForPosition(pos.positionId).tp }}</span>
                            </template>
                            <span v-if="pos.markPrice"> | {{ t('incoming.liquidation') }} {{ parseFloat(pos.markPrice || 0).toFixed(2) }}</span>
                            | {{ t('incoming.margin') }} {{ parseFloat(pos.bitunixData?.margin || 0).toFixed(2) }} USDT
                            <span v-if="getPositionDate(pos)"> | {{ getPositionDate(pos) }}</span>
                        </small>
                    </div>
                </div>

                <!-- Stress level indicator (always visible if set) -->
                <div v-if="pos.stressLevel > 0 && expandedId !== pos.positionId" class="mt-1">
                    <small class="incoming-info">{{ t('incoming.stress') }} </small>
                    <template v-for="n in 10" :key="n">
                        <span class="stress-dot" :class="n <= pos.stressLevel ? 'active' : 'inactive'">
                            <span class="stress-number">{{ n }}</span>&#x25CF;
                        </span>
                        <span v-if="n < 10" class="stress-dot stress-spacer" :class="n <= pos.stressLevel ? 'active' : 'inactive'">
                            <span class="stress-number">&nbsp;</span>&#x25CF;
                        </span>
                    </template>
                </div>

                <!-- ===== EXPANDED DETAIL SECTION ===== -->
                <div v-if="expandedId === pos.positionId" class="mt-2 incoming-meta-section">

                    <!-- ========== FILLS / COMPOUND TRACKING ========== -->
                    <div v-if="pos.status === 'open' && (pos.broker === 'bitunix' || pos.broker === 'bitget')" class="fills-section p-3 mb-2">
                        <div class="d-flex align-items-center justify-content-between mb-2">
                            <span class="fw-bold" style="font-size: 0.95rem;">
                                <i class="uil uil-layers me-1"></i>
                                {{ t('incoming.fills') }}
                                <span v-if="getEntryFills(pos.positionId, pos.side).length > 1"
                                    class="text-muted ms-1">({{ getEntryFills(pos.positionId, pos.side).length }} {{ t('incoming.fillEntries') }})</span>
                            </span>
                            <span v-if="getEntryFills(pos.positionId, pos.side).length > 0" class="fw-bold" style="font-size: 0.85rem;">
                                {{ t('incoming.fillAvgPrice') }}: {{ getAvgEntryPrice(pos.positionId, pos.side).toFixed(5) }}
                            </span>
                        </div>

                        <!-- Loading -->
                        <div v-if="getFillsForPosition(pos.positionId).loading" class="text-muted small">
                            <span class="spinner-border spinner-border-sm me-1" style="width: 0.7rem; height: 0.7rem;"></span>
                            Loading...
                        </div>

                        <!-- Error -->
                        <div v-else-if="getFillsForPosition(pos.positionId).error" class="text-danger small">
                            {{ getFillsForPosition(pos.positionId).error }}
                        </div>

                        <!-- Fills table -->
                        <div v-else-if="getFillsForPosition(pos.positionId).trades.length > 0">
                            <table class="table table-sm table-borderless mb-1" style="font-size: 0.8rem; color: var(--white-80);">
                                <tbody>
                                    <template v-for="(group, gIdx) in groupFillsByMinute(getFillsForPosition(pos.positionId).trades, 'ctime')" :key="group.key">
                                        <tr :class="group.reduceOnly ? 'text-danger' : ''"
                                            :style="group.isGroup ? 'cursor: pointer;' : ''"
                                            @click="group.isGroup && toggleFillGroup(group.key)">
                                            <td class="text-muted ps-0" style="width: 100px;">
                                                <span v-if="group.isGroup" style="font-size: 0.6rem; margin-right: 2px;">{{ expandedFillGroups.has(group.key) ? '▼' : '▶' }}</span>
                                                {{ formatFillTime(group.time) }}
                                            </td>
                                            <td style="width: 80px;" class="text-end">{{ group.totalQty }}</td>
                                            <td class="text-muted px-1">×</td>
                                            <td style="width: 90px;">{{ group.isGroup ? group.avgPrice.toFixed(5) : parseFloat(group.fills[0].price) }}</td>
                                            <td class="text-muted px-1">=</td>
                                            <td class="text-end" style="width: 90px;">{{ group.totalValue.toFixed(2) }}</td>
                                            <td>
                                                <span v-if="getIncomingFillBadgeType(group.fills[0], group.firstFillIdx, getFillsForPosition(pos.positionId).trades) === 'close'"
                                                    class="badge bg-danger" style="font-size: 0.65rem;">{{ t('incoming.fillClose') }}</span>
                                                <span v-else-if="getIncomingFillBadgeType(group.fills[0], group.firstFillIdx, getFillsForPosition(pos.positionId).trades) === 'partialClose'"
                                                    class="badge bg-warning text-dark" style="font-size: 0.65rem;">{{ t('incoming.fillPartialClose') }}</span>
                                                <span v-else-if="getIncomingFillBadgeType(group.fills[0], group.firstFillIdx, getFillsForPosition(pos.positionId).trades) === 'initial'"
                                                    class="badge bg-secondary" style="font-size: 0.65rem;">{{ t('incoming.fillInitial') }}</span>
                                                <span v-else class="badge bg-info" style="font-size: 0.65rem;">{{ t('incoming.fillCompound') }}</span>
                                                <span v-if="group.isGroup" class="text-muted ms-1" style="font-size: 0.6rem;">({{ group.fills.length }})</span>
                                            </td>
                                            <td class="text-end text-muted pe-0" style="width: 90px;">{{ t('incoming.fillFee') }}: {{ group.totalFee.toFixed(4) }}</td>
                                        </tr>
                                        <template v-if="group.isGroup && expandedFillGroups.has(group.key)">
                                            <tr v-for="(fill, fIdx) in group.fills" :key="group.key + '_' + fIdx"
                                                :class="fill.reduceOnly ? 'text-danger' : ''" style="opacity: 0.6; font-size: 0.7rem;">
                                                <td class="ps-0" style="width: 100px;"></td>
                                                <td style="width: 80px;" class="text-end">{{ parseFloat(fill.qty) }}</td>
                                                <td class="text-muted px-1">×</td>
                                                <td style="width: 90px;">{{ parseFloat(fill.price) }}</td>
                                                <td class="text-muted px-1">=</td>
                                                <td class="text-end" style="width: 90px;">{{ (parseFloat(fill.qty) * parseFloat(fill.price)).toFixed(2) }}</td>
                                                <td></td>
                                                <td class="text-end text-muted pe-0" style="width: 90px;">{{ t('incoming.fillFee') }}: {{ parseFloat(fill.fee || 0).toFixed(4) }}</td>
                                            </tr>
                                        </template>
                                    </template>
                                </tbody>
                            </table>
                            <!-- Totals row -->
                            <div v-if="getEntryFills(pos.positionId, pos.side).length > 1"
                                class="d-flex justify-content-between border-top pt-1 mt-1" style="font-size: 0.8rem; border-color: var(--white-20) !important;">
                                <span class="text-muted">
                                    {{ t('incoming.fillTotal') }}:
                                    <strong class="text-white">{{ getEntryFills(pos.positionId, pos.side).reduce((sum, f) => sum + parseFloat(f.qty || 0), 0) }}</strong>
                                </span>
                                <span class="text-muted">
                                    {{ t('incoming.fillFee') }}:
                                    <strong class="text-white">{{ getFillsForPosition(pos.positionId).trades.reduce((sum, f) => sum + parseFloat(f.fee || 0), 0).toFixed(4) }}</strong>
                                </span>
                            </div>
                            <!-- Position Size: Marge × Hebel -->
                            <div class="d-flex justify-content-between border-top pt-1 mt-1" style="font-size: 0.8rem; border-color: var(--white-20) !important;">
                                <span class="text-muted">
                                    {{ t('incoming.positionSize') }}:
                                    <span class="text-white">{{ parseFloat(pos.bitunixData?.margin || 0).toFixed(2) }}</span>
                                    <span class="text-muted"> × </span>
                                    <span class="text-white">{{ pos.leverage }}x</span>
                                    <span class="text-muted"> = </span>
                                    <strong class="text-white">{{ (parseFloat(pos.bitunixData?.margin || 0) * parseFloat(pos.leverage || 1)).toFixed(2) }} USDT</strong>
                                </span>
                            </div>
                        </div>

                        <!-- TP/SL Orders + BE -->
                        <div v-if="getTpSlForPosition(pos.positionId).sl || getTpSlForPosition(pos.positionId).tp || getBreakevenPrice(pos.positionId, pos.side) > 0"
                            class="d-flex gap-3 mt-2 pt-2 border-top" style="font-size: 0.8rem; border-color: var(--white-20) !important;">
                            <span v-if="getTpSlForPosition(pos.positionId).sl">
                                <span class="fw-bold" :class="!isSLAboveBreakeven(pos.positionId, pos.side) ? 'text-danger' : ''" :style="isSLAboveBreakeven(pos.positionId, pos.side) ? 'color: #86efac' : ''">SL: {{ getTpSlForPosition(pos.positionId).sl }}</span>
                                <span class="text-muted ms-1">({{ getTpSlForPosition(pos.positionId).slQty }})</span>
                            </span>
                            <span v-if="getBreakevenPrice(pos.positionId, pos.side) > 0">
                                <span class="text-muted fw-bold">BE: {{ getBreakevenPrice(pos.positionId, pos.side).toFixed(2) }}</span>
                            </span>
                            <span v-if="getTpSlForPosition(pos.positionId).tp">
                                <span class="fw-bold" style="color: #f59e0b;">TP: {{ getTpSlForPosition(pos.positionId).tp }}</span>
                                <span class="text-muted ms-1">({{ getTpSlForPosition(pos.positionId).tpQty }})</span>
                            </span>
                            <span v-if="getRRR(pos.positionId, pos.side)" class="ms-auto">
                                <span class="fw-bold" style="color: #a78bfa;">RRR 1:{{ getRRR(pos.positionId, pos.side) }}</span>
                            </span>
                        </div>

                        <!-- TP/SL Change History -->
                        <div v-if="getTpSlHistoryForPosition(pos.positionId).length > 0"
                            class="mt-2 pt-2 border-top" style="font-size: 0.75rem; border-color: var(--white-20) !important;">
                            <div class="text-muted mb-1 pointerClass" @click.stop="tpslHistoryCollapsed[pos.positionId] = !tpslHistoryCollapsed[pos.positionId]">
                                <i class="uil uil-history me-1"></i>SL/TP Protokoll
                                <i :class="tpslHistoryCollapsed[pos.positionId] ? 'uil-angle-down' : 'uil-angle-up'" class="uil ms-1"></i>
                            </div>
                            <template v-if="!tpslHistoryCollapsed[pos.positionId]">
                                <div v-for="(entry, idx) in getTpSlHistoryForPosition(pos.positionId)" :key="idx"
                                    class="d-flex align-items-center gap-2 mb-1">
                                    <span class="text-muted" style="width: 90px;">{{ dayjs(entry.time).tz(timeZoneTrade.value).format('DD.MM. HH:mm') }}</span>
                                    <span :class="entry.type === 'SL' ? (isSLAboveBreakeven(pos.positionId, pos.side) ? '' : 'text-danger') : (entry.action === 'triggered' ? 'text-success fw-bold' : '')"
                                        :style="entry.type === 'SL' && isSLAboveBreakeven(pos.positionId, pos.side) ? 'color: #86efac' : (entry.type === 'TP' && entry.action !== 'triggered' ? 'color: #f59e0b' : '')">
                                        {{ entry.type }}
                                    </span>
                                    <template v-if="entry.action === 'set'">
                                        <span class="text-muted">→</span>
                                        <span class="text-white">{{ entry.newVal }}</span>
                                        <span class="badge bg-secondary" style="font-size: 0.6rem;">Gesetzt</span>
                                    </template>
                                    <template v-else-if="entry.action === 'moved'">
                                        <span class="text-muted" style="text-decoration: line-through;">{{ entry.oldVal }}</span>
                                        <span class="text-muted">→</span>
                                        <span class="text-white">{{ entry.newVal }}</span>
                                        <span class="badge bg-warning text-dark" style="font-size: 0.6rem;">Verschoben</span>
                                    </template>
                                    <template v-else-if="entry.action === 'triggered'">
                                        <span class="text-success" style="text-decoration: line-through;">{{ entry.oldVal }}</span>
                                        <span class="text-success">→</span>
                                        <span class="text-success fw-bold">Ausgelöst ✓</span>
                                    </template>
                                    <template v-else-if="entry.action === 'removed'">
                                        <span class="text-muted" style="text-decoration: line-through;">{{ entry.oldVal }}</span>
                                        <span class="text-muted">→ entfernt</span>
                                    </template>
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- ========== OPENING EVALUATION ========== -->
                    <div class="opening-eval-section p-3 mb-2">
                    <div class="d-flex align-items-center mb-3">
                        <i class="uil uil-unlock-alt me-2" style="color: var(--green-color, #10b981); font-size: 1.1rem;"></i>
                        <span class="fw-bold" style="font-size: 0.95rem;">{{ t('incoming.openingEvaluation') }}</span>
                    </div>

                    <!-- Trade-Typ -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.tradeType') }}</label>
                        <div class="d-flex flex-wrap gap-1">
                            <button v-for="tt in tradeTypeOptions" :key="tt.value"
                                class="btn btn-sm py-0 px-2"
                                :class="pos.tradeType === tt.value ? 'btn-primary' : 'btn-outline-secondary'"
                                @click.stop="updateTradeType(pos, tt.value)">
                                {{ t(tt.labelKey) }}
                            </button>
                        </div>
                    </div>

                    <!-- Timeframe -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.timeframe') }}</label>
                        <div class="d-flex flex-wrap gap-1">
                            <button v-for="tf in timeframeOptions" :key="tf.value"
                                class="btn btn-sm py-0 px-2"
                                :class="pos.entryTimeframe === tf.value ? 'btn-primary' : 'btn-outline-secondary'"
                                @click.stop="updateTimeframe(pos, tf.value)">
                                {{ tf.label }}
                            </button>
                        </div>
                    </div>

                    <!-- Stresslevel -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.stressLevel') }}</label>
                        <div class="d-flex align-items-end flex-wrap">
                            <template v-for="n in 10" :key="'os'+n">
                                <span @click.stop="updateStress(pos, n)"
                                    class="stress-dot pointerClass"
                                    :class="n <= pos.stressLevel ? 'active' : 'inactive'">
                                    <span class="stress-number">{{ n }}</span>&#x25CF;
                                </span>
                                <span v-if="n < 10" class="stress-dot stress-spacer"
                                    :class="n <= pos.stressLevel ? 'active' : 'inactive'">
                                    <span class="stress-number">&nbsp;</span>&#x25CF;
                                </span>
                            </template>
                        </div>
                    </div>

                    <!-- Emotionslevel -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.emotionLevel') }}</label>
                        <div class="d-flex align-items-end flex-wrap">
                            <template v-for="n in 10" :key="'oe'+n">
                                <span @click.stop="updateEmotionLevel(pos, n)"
                                    class="stress-dot pointerClass"
                                    :class="n <= pos.emotionLevel ? 'active' : 'inactive'">
                                    <span class="stress-number">{{ n }}</span>&#x25CF;
                                </span>
                                <span v-if="n < 10" class="stress-dot stress-spacer"
                                    :class="n <= pos.emotionLevel ? 'active' : 'inactive'">
                                    <span class="stress-number">&nbsp;</span>&#x25CF;
                                </span>
                            </template>
                        </div>
                    </div>

                    <!-- Emotionen -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.emotions') }}</label>
                        <textarea class="form-control form-control-sm" v-model="pos.feelings"
                            :placeholder="t('incoming.emotionsPlaceholder')" rows="2"></textarea>
                    </div>

                    <!-- Notiz (Quill Editor) -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.note') }}</label>
                        <div :id="'quillIncoming-' + pos.positionId + '-opening'" class="quill-incoming"></div>
                    </div>

                    <!-- Tags -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.tags') }}</label>
                        <div class="d-flex flex-wrap align-items-center gap-1 mb-1">
                            <span v-for="(tag, idx) in (pos.tags || [])" :key="tag.id"
                                class="badge me-1 pointerClass"
                                :style="{ backgroundColor: getTagColor(tag.id) }"
                                @click.stop="removeTag(pos, idx)">
                                {{ tag.name }} <span class="ms-1">&times;</span>
                            </span>
                        </div>
                        <select class="form-select form-select-sm"
                            @change.stop="addTag(pos, JSON.parse($event.target.value)); $event.target.selectedIndex = 0">
                            <option selected disabled>{{ t('incoming.addTag') }}</option>
                            <template v-for="group in availableTags" :key="group.id">
                                <optgroup :label="group.name">
                                    <option v-for="tag in group.tags" :key="tag.id"
                                        :value="JSON.stringify({ id: tag.id, name: tag.name })"
                                        :disabled="(pos.tags || []).some(t => t.id === tag.id)">
                                        {{ tag.name }}
                                    </option>
                                </optgroup>
                            </template>
                        </select>
                    </div>

                    <!-- Screenshots (max 2) -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.screenshot') }}</label>
                        <div class="d-flex flex-wrap align-items-start gap-2 mb-2">
                            <!-- Erster Screenshot (Thumbnail) -->
                            <div v-if="pos.entryScreenshotId" class="position-relative screenshot-thumb">
                                <img v-if="entryScreenshotPreviews[pos.positionId]"
                                    :src="entryScreenshotPreviews[pos.positionId]"
                                    class="rounded" style="max-height: 120px; max-width: 200px; object-fit: cover;" />
                                <span v-else class="badge bg-secondary"><i class="uil uil-image me-1"></i>1</span>
                                <i class="uil uil-times-circle screenshot-remove" @click.stop="removeEntryScreenshot(pos)"></i>
                            </div>
                            <!-- Zweiter Screenshot (Thumbnail) -->
                            <div v-if="pos.trendScreenshotId" class="position-relative screenshot-thumb">
                                <img v-if="trendScreenshotPreviews[pos.positionId]"
                                    :src="trendScreenshotPreviews[pos.positionId]"
                                    class="rounded" style="max-height: 120px; max-width: 200px; object-fit: cover;" />
                                <span v-else class="badge bg-secondary"><i class="uil uil-image me-1"></i>2</span>
                                <i class="uil uil-times-circle screenshot-remove" @click.stop="removeTrendScreenshot(pos)"></i>
                            </div>
                        </div>
                        <!-- Upload (sichtbar solange weniger als 2 Screenshots) -->
                        <input v-if="!pos.entryScreenshotId || !pos.trendScreenshotId" type="file" accept="image/*" class="form-control form-control-sm"
                            @change="!pos.entryScreenshotId ? handleEntryScreenshotUpload($event, pos) : handleTrendScreenshotUpload($event, pos)" />
                    </div>

                    </div><!-- /opening-eval-section -->

                    <!-- ========== CLOSING EVALUATION ========== -->
                    <div v-if="pos.status === 'pending_evaluation'" class="closing-eval-section mt-3 p-3">
                        <div class="d-flex align-items-center mb-3">
                            <i class="uil uil-lock-alt me-2" style="color: var(--blue-color); font-size: 1.1rem;"></i>
                            <span class="fw-bold" style="font-size: 0.95rem;">{{ t('incoming.closingEvaluation') }}</span>
                        </div>

                        <!-- Strategie eingehalten? (oberster Punkt) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.strategyFollowed') }}</label>
                            <div class="d-flex gap-2">
                                <button class="btn btn-sm px-3"
                                    :class="pos.strategyFollowed === 1 ? 'btn-success' : 'btn-outline-secondary'"
                                    @click.stop="updateStrategyFollowed(pos, 1)">
                                    {{ t('incoming.strategyYes') }}
                                </button>
                                <button class="btn btn-sm px-3"
                                    :class="pos.strategyFollowed === 0 ? 'btn-danger' : 'btn-outline-secondary'"
                                    @click.stop="updateStrategyFollowed(pos, 0)">
                                    {{ t('incoming.strategyNo') }}
                                </button>
                            </div>
                        </div>

                        <!-- Trade-Typ (auto-erkannt, manuell überschreibbar) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">
                                {{ t('incoming.tradeType') }}
                                <small v-if="autoDetectedTradeType[pos.positionId] === true" class="text-muted ms-1">{{ t('incoming.autoDetected') }}</small>
                            </label>
                            <div class="d-flex flex-wrap gap-1 align-items-center">
                                <button v-for="tt in tradeTypeOptions" :key="tt.value"
                                    class="btn btn-sm py-0 px-2"
                                    :class="pos.tradeType === tt.value ? 'btn-primary' : 'btn-outline-secondary'"
                                    @click.stop="updateTradeType(pos, tt.value)">
                                    {{ t(tt.labelKey) }}
                                </button>
                                <small v-if="getTradeDurationMinutes(pos)" class="text-muted ms-2">
                                    {{ t('incoming.holdDuration') }}: {{ formatDuration(getTradeDurationMinutes(pos)) }}
                                </small>
                            </div>
                        </div>

                        <!-- Stresslevel (Abschluss) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.closingStressLevel') }}</label>
                            <div class="d-flex align-items-end flex-wrap">
                                <template v-for="n in 10" :key="'cs'+n">
                                    <span @click.stop="updateClosingStress(pos, n)"
                                        class="stress-dot pointerClass"
                                        :class="n <= (pos.closingStressLevel || 0) ? 'active' : 'inactive'">
                                        <span class="stress-number">{{ n }}</span>&#x25CF;
                                    </span>
                                    <span v-if="n < 10" class="stress-dot stress-spacer"
                                        :class="n <= (pos.closingStressLevel || 0) ? 'active' : 'inactive'">
                                        <span class="stress-number">&nbsp;</span>&#x25CF;
                                    </span>
                                </template>
                            </div>
                        </div>

                        <!-- Emotionslevel (Abschluss) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.closingEmotionLevel') }}</label>
                            <div class="d-flex align-items-end flex-wrap">
                                <template v-for="n in 10" :key="'ce'+n">
                                    <span @click.stop="updateClosingEmotionLevel(pos, n)"
                                        class="stress-dot pointerClass"
                                        :class="n <= (pos.closingEmotionLevel || 0) ? 'active' : 'inactive'">
                                        <span class="stress-number">{{ n }}</span>&#x25CF;
                                    </span>
                                    <span v-if="n < 10" class="stress-dot stress-spacer"
                                        :class="n <= (pos.closingEmotionLevel || 0) ? 'active' : 'inactive'">
                                        <span class="stress-number">&nbsp;</span>&#x25CF;
                                    </span>
                                </template>
                            </div>
                        </div>

                        <!-- Emotionen (Abschluss) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.closingEmotions') }}</label>
                            <textarea class="form-control form-control-sm" v-model="pos.closingFeelings"
                                :placeholder="t('incoming.closingEmotionsPlaceholder')" rows="2"></textarea>
                        </div>

                        <!-- Notiz (Quill Editor) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.note') }}</label>
                            <div :id="'quillIncoming-' + pos.positionId + '-closing'" class="quill-incoming"></div>
                        </div>

                        <!-- Tags -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.tags') }}</label>
                            <div class="d-flex flex-wrap align-items-center gap-1 mb-1">
                                <span v-for="(tag, idx) in (pos.closingTags || [])" :key="tag.id"
                                    class="badge me-1 pointerClass"
                                    :style="{ backgroundColor: getTagColor(tag.id) }"
                                    @click.stop="removeClosingTag(pos, idx)">
                                    {{ tag.name }} <span class="ms-1">&times;</span>
                                </span>
                            </div>
                            <select class="form-select form-select-sm"
                                @change.stop="addClosingTag(pos, JSON.parse($event.target.value)); $event.target.selectedIndex = 0">
                                <option selected disabled>{{ t('incoming.addTag') }}</option>
                                <template v-for="group in availableTags" :key="group.id">
                                    <optgroup :label="group.name">
                                        <option v-for="tag in group.tags" :key="tag.id"
                                            :value="JSON.stringify({ id: tag.id, name: tag.name })"
                                            :disabled="(pos.closingTags || []).some(t => t.id === tag.id)">
                                            {{ tag.name }}
                                        </option>
                                    </optgroup>
                                </template>
                            </select>
                        </div>

                        <!-- Closing Screenshot -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.screenshot') }}</label>
                            <div v-if="pos.closingScreenshotId" class="d-flex align-items-start gap-2 mb-2">
                                <div class="position-relative screenshot-thumb">
                                    <img v-if="closingScreenshotPreviews[pos.positionId]"
                                        :src="closingScreenshotPreviews[pos.positionId]"
                                        class="rounded" style="max-height: 120px; max-width: 200px; object-fit: cover;" />
                                    <span v-else class="badge bg-secondary"><i class="uil uil-image me-1"></i>1</span>
                                    <i class="uil uil-times-circle screenshot-remove" @click.stop="removeClosingScreenshot(pos)"></i>
                                </div>
                            </div>
                            <input v-else type="file" accept="image/*" class="form-control form-control-sm"
                                @change="handleClosingScreenshotUpload($event, pos)" />
                        </div>

                        <!-- Satisfaction -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.satisfaction') }}</label>
                            <div class="d-flex gap-3">
                                <span class="pointerClass fs-4"
                                    :style="pos.satisfaction === 1 ? '' : 'opacity: 0.3; filter: grayscale(1)'"
                                    @click.stop="updateSatisfaction(pos, 1)">
                                    👍
                                </span>
                                <span class="pointerClass fs-4"
                                    :style="pos.satisfaction === 2 ? '' : 'opacity: 0.3; filter: grayscale(1)'"
                                    @click.stop="updateSatisfaction(pos, 2)">
                                    ✊
                                </span>
                                <span class="pointerClass fs-4"
                                    :style="pos.satisfaction === 0 ? '' : 'opacity: 0.3; filter: grayscale(1)'"
                                    @click.stop="updateSatisfaction(pos, 0)">
                                    👎
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- ===== SAVE / COMPLETE BUTTONS ===== -->
                    <div class="d-flex justify-content-between align-items-center mt-2">
                        <div class="form-check mb-0">
                            <input type="checkbox" class="form-check-input" :id="'skipEval-' + pos.positionId"
                                v-model="pos.skipEvaluation" :true-value="1" :false-value="0"
                                @click.stop>
                            <label class="form-check-label small text-muted" :for="'skipEval-' + pos.positionId">
                                {{ t('incoming.skipEvaluation') }}
                            </label>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <button v-if="pos.status === 'pending_evaluation'"
                                class="btn btn-primary btn-sm"
                                @click.stop="completeClosingEvaluation(pos)"
                                :disabled="closingId === pos.objectId">
                                <span v-if="closingId === pos.objectId">
                                    <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                                </span>
                                <span v-else><i class="uil uil-check-circle me-1"></i></span>
                                {{ t('incoming.completeEvaluation') }}
                            </button>
                            <button class="btn btn-success btn-sm" @click.stop="saveMetadata(pos)" :disabled="savingId === pos.objectId">
                                <span v-if="savingId === pos.objectId">
                                    <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                                </span>
                                <span v-else><i class="uil uil-check me-1"></i></span>
                                {{ t('common.save') }}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <SpinnerLoadingPage />
    </div>
</template>

<style scoped>
.opening-eval-section {
    background: var(--black-bg-3, #1a1a2e);
    border: 1px solid var(--white-10, rgba(255,255,255,0.06));
    border-left: 3px solid var(--green-color, #10b981);
    border-radius: var(--border-radius, 6px);
}
.closing-eval-section {
    background: var(--black-bg-3, #1a1a2e);
    border: 1px solid var(--white-10, rgba(255,255,255,0.06));
    border-left: 3px solid var(--blue-color, #3b82f6);
    border-radius: var(--border-radius, 6px);
}
.fills-section {
    background: var(--black-bg-3, #1a1a2e);
    border: 1px solid var(--white-10, rgba(255,255,255,0.06));
    border-left: 3px solid var(--grey-color, #6b7280);
    border-radius: var(--border-radius, 6px);
}
.fills-section .table {
    margin-bottom: 0;
}
.fills-section .table td {
    padding: 0.15rem 0.3rem;
    vertical-align: middle;
    border: none;
}
.screenshot-thumb {
    display: inline-block;
}
.screenshot-remove {
    position: absolute;
    top: -6px;
    right: -6px;
    color: var(--red-color, #ff6960);
    background: var(--black-bg-3, #1a1a2e);
    border-radius: 50%;
    font-size: 1.2rem;
    cursor: pointer;
    line-height: 1;
}
.screenshot-remove:hover {
    color: #ff4040;
}
</style>
