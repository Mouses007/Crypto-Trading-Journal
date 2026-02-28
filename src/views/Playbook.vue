<script setup>
import { ref, computed, onBeforeMount, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import NoData from '../components/NoData.vue'
import { spinnerLoadingPage, timeZoneTrade } from '../stores/ui.js'
import { allTradeTimeframes, selectedTradeTimeframes, selectedBroker } from '../stores/filters.js'
import { availableTags } from '../stores/trades.js'
import { useGetAvailableTags, useGetTagInfo } from '../utils/daily.js'
import { useCreatedDateFormat } from '../utils/formatters.js'
import { dbFind, dbGet, dbUpdate, dbCreate, dbDelete } from '../utils/db.js'
import Quill from 'quill'
import { sanitizeHtml } from '../utils/sanitize'
import { useI18n } from 'vue-i18n'
import dayjs from '../utils/dayjs-setup.js'

const route = useRoute()
const { t } = useI18n()
const playbookEntries = ref([])
const expandedId = ref(null)
const editingId = ref(null)
const savingId = ref(null)
const quillInstances = {}
const screenshotMap = ref([]) // array of screenshot records
const fullscreenImg = ref(null) // base64 string for fullscreen modal
const trendScreenshotPreviews = ref({}) // tradeId → base64 preview
const entryScreenshotPreviews = ref({}) // tradeId → base64 preview
const closingScreenshotPreviews = ref({}) // tradeId → base64 preview

// Timeframes aus Settings (oder Fallback auf alle)
const timeframeOptions = computed(() => {
    if (selectedTradeTimeframes.length > 0) {
        return allTradeTimeframes.value.filter(tf => selectedTradeTimeframes.includes(tf.value))
    }
    return allTradeTimeframes.value
})

onBeforeMount(async () => {
    spinnerLoadingPage.value = true
    await useGetAvailableTags()
    await loadPlaybookEntries()
    spinnerLoadingPage.value = false

    // Auto-expand entry if tradeId query param is present (e.g. from Screenshots link or Bewerten)
    const targetTradeId = route.query.tradeId
    if (targetTradeId) {
        let entry = playbookEntries.value.find(e => e.tradeId === targetTradeId)

        // If no note exists yet, create an empty one so the user can evaluate
        if (!entry) {
            const allTrades = await dbFind('trades', { descending: 'dateUnix', limit: 500 })
            let tradeDay = null
            let tradeDetail = null
            for (const day of allTrades) {
                if (day.trades && Array.isArray(day.trades)) {
                    const found = day.trades.find(tr => tr.id === targetTradeId)
                    if (found) {
                        tradeDay = day
                        tradeDetail = found
                        break
                    }
                }
            }

            if (tradeDay) {
                await dbCreate('notes', {
                    dateUnix: tradeDay.dateUnix,
                    tradeId: targetTradeId,
                    note: '<p>-</p>',
                    entryStressLevel: 0,
                    emotionLevel: 0,
                    entryNote: '',
                    feelings: '',
                    playbook: '',
                    timeframe: '',
                    closingNote: '',
                    closingStressLevel: 0,
                    closingEmotionLevel: 0,
                    closingFeelings: '',
                    closingTimeframe: '',
                    closingPlaybook: '',
                })
                await loadPlaybookEntries()
                entry = playbookEntries.value.find(e => e.tradeId === targetTradeId)
            }
        }

        if (entry) {
            await nextTick()
            toggleExpand(entry.tradeId)
            await nextTick()
            // Auto-start edit mode for new entries (no data yet)
            if (!hasData(entry)) {
                startEdit(entry.tradeId)
                await nextTick()
            }
            setTimeout(() => {
                const el = document.getElementById('playbook-' + entry.tradeId)
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }, 100)
        }
    }
})

// --- Parse old HTML notes for backwards compatibility ---
function parseOldNoteHtml(noteHtml) {
    if (!noteHtml || !noteHtml.trim()) return {}

    const result = {
        entryStressLevel: 0,
        feelings: '',
        playbook: '',
        timeframe: '',
        entryNote: ''
    }

    let html = noteHtml

    const entryStressMatch = html.match(/<p><strong>Einstiegs-Stresslevel:\s*(\d+)\/\d+<\/strong><\/p>/)
    if (entryStressMatch) {
        result.entryStressLevel = parseInt(entryStressMatch[1]) || 0
        html = html.replace(entryStressMatch[0], '')
    }

    const stressMatch = html.match(/<p><strong>Stresslevel:\s*(\d+)\/\d+<\/strong><\/p>/)
    if (stressMatch && !result.entryStressLevel) {
        result.entryStressLevel = parseInt(stressMatch[1]) || 0
        html = html.replace(stressMatch[0], '')
    }

    const exitStressMatch = html.match(/<p><strong>Ausstiegs-Stresslevel:\s*\d+\/\d+<\/strong><\/p>/)
    if (exitStressMatch) {
        html = html.replace(exitStressMatch[0], '')
    }

    const tfMatch = html.match(/<p><strong>Timeframe:\s*([\w]+)<\/strong><\/p>/)
    if (tfMatch) {
        result.timeframe = tfMatch[1]
        html = html.replace(tfMatch[0], '')
    }

    const entryNoteMatch = html.match(/<p><em>Einstiegs-Grund:\s*(.*?)<\/em><\/p>/)
    if (entryNoteMatch) {
        result.entryNote = entryNoteMatch[1]
        html = html.replace(entryNoteMatch[0], '')
    }

    const feelingsMatch = html.match(/<p><em>(.*?)<\/em><\/p>/)
    if (feelingsMatch) {
        result.feelings = feelingsMatch[1]
        html = html.replace(feelingsMatch[0], '')
    }

    const remaining = html.trim()
    if (remaining && remaining !== '<p>-</p>' && remaining !== '<p><br></p>' && remaining !== '<p></p>') {
        result.playbook = remaining
    }

    return result
}

async function loadPlaybookEntries() {
    const [allNotes, allSatisfactions, allTags, allTrades, allScreenshots] = await Promise.all([
        dbFind('notes', { descending: 'dateUnix', limit: 200 }),
        dbFind('satisfactions', { limit: 500 }),
        dbFind('tags', { limit: 500 }),
        dbFind('trades', { descending: 'dateUnix', limit: 200 }),
        dbFind('screenshots', { descending: 'dateUnix', limit: 500, exclude: ['original', 'annotated', 'maState'] })
    ])
    // Broker filter for screenshots: only show screenshots matching selected exchange
    // Screenshots with no broker field (legacy) are shown for all brokers
    const broker = selectedBroker.value
    if (broker) {
        screenshotMap.value = allScreenshots.filter(s => !s.broker || s.broker === broker)
    } else {
        screenshotMap.value = allScreenshots
    }

    // Broker filter: only show trades matching selected exchange
    const brokerFilteredTrades = broker
        ? allTrades.filter(t => {
            if (t.trades && Array.isArray(t.trades)) {
                return t.trades.some(tr => tr.broker === broker)
            }
            return false
        })
        : allTrades

    const entries = []
    for (const note of allNotes) {
        if (!note.tradeId) continue

        const trade = brokerFilteredTrades.find(t => {
            if (t.trades && Array.isArray(t.trades)) {
                return t.trades.some(tr => tr.id === note.tradeId)
            }
            return false
        })

        // Skip notes that don't belong to the selected broker
        if (broker && !trade) continue

        const satisfaction = allSatisfactions.find(s => s.tradeId === note.tradeId)

        const tagRecord = allTags.find(t => t.tradeId === note.tradeId)
        const resolvedTags = []
        if (tagRecord && tagRecord.tags && Array.isArray(tagRecord.tags)) {
            for (const tagId of tagRecord.tags) {
                const info = useGetTagInfo(tagId)
                if (info) {
                    resolvedTags.push({
                        id: tagId,
                        name: info.tagName || tagId,
                        color: info.groupColor || '#6c757d'
                    })
                }
            }
        }
        const resolvedClosingTags = []
        if (tagRecord && tagRecord.closingTags && Array.isArray(tagRecord.closingTags)) {
            for (const tagId of tagRecord.closingTags) {
                const info = useGetTagInfo(tagId)
                if (info) {
                    resolvedClosingTags.push({
                        id: tagId,
                        name: info.tagName || tagId,
                        color: info.groupColor || '#6c757d'
                    })
                }
            }
        }

        let tradeDetail = null
        if (trade && trade.trades && Array.isArray(trade.trades)) {
            tradeDetail = trade.trades.find(tr => tr.id === note.tradeId)
        }

        const needsParsing = (
            !note.feelings && !note.playbook && !note.entryStressLevel &&
            note.note && note.note.trim() && note.note.trim() !== '<p>-</p>'
        )
        let parsed = {}
        if (needsParsing) {
            parsed = parseOldNoteHtml(note.note)
        }

        entries.push({
            noteObjectId: note.objectId,
            tagRecordObjectId: tagRecord?.objectId || null,
            satisfactionObjectId: satisfaction?.objectId || null,
            dateUnix: note.dateUnix,
            tradeId: note.tradeId,
            // Opening fields
            tradeType: note.tradeType || '',
            entryStressLevel: note.entryStressLevel || parsed.entryStressLevel || 0,
            emotionLevel: note.emotionLevel || 0,
            entryNote: note.entryNote || parsed.entryNote || '',
            feelings: note.feelings || parsed.feelings || '',
            playbook: note.playbook || parsed.playbook || '',
            timeframe: note.timeframe || parsed.timeframe || '',
            screenshotId: note.screenshotId || '',
            // Closing fields
            closingNote: note.closingNote || '',
            closingStressLevel: note.closingStressLevel || 0,
            closingEmotionLevel: note.closingEmotionLevel || 0,
            closingFeelings: note.closingFeelings || '',
            closingTimeframe: note.closingTimeframe || '',
            closingPlaybook: note.closingPlaybook || '',
            closingScreenshotId: note.closingScreenshotId || '',
            // General
            note: note.note || '',
            satisfaction: satisfaction ? satisfaction.satisfaction : null,
            tags: resolvedTags,
            closingTags: resolvedClosingTags,
            symbol: tradeDetail?.symbol || trade?.trades?.[0]?.symbol || '',
            side: tradeDetail?.strategy || '',
            pnl: tradeDetail?.netProceeds || tradeDetail?.grossProceeds || 0,
            tradingMetadata: note.tradingMetadata || null,
        })
    }

    playbookEntries.value = entries
}

function formatSide(side) {
    if (side === 'long' || side === 'B') return 'LONG'
    if (side === 'short' || side === 'SS' || side === 'S') return 'SHORT'
    return side
}

// ===== TRADING METADATA HELPERS =====
function hasTradingMetadata(meta) {
    if (!meta) return false
    return (meta.fills?.length > 0) || meta.sl != null || meta.tp != null
        || meta.positionSize || (meta.tpslHistory?.length > 0) || meta.rrr
}

// Filter tpslHistory: remove entries recorded after the last fill (position close)
function getFilteredTpslHistory(meta) {
    if (!meta?.tpslHistory?.length) return []
    if (!meta.fills?.length) return meta.tpslHistory
    const lastFillTime = Math.max(...meta.fills.map(f => parseInt(f.time || 0)))
    if (!lastFillTime) return meta.tpslHistory
    const cutoff = lastFillTime + 60000
    return meta.tpslHistory.filter(h => h.time <= cutoff)
}

function getEntryFillsFromMeta(fills, side) {
    if (!fills || !Array.isArray(fills)) return []
    return fills.filter(f => !f.reduceOnly)
}

function getAvgEntryPriceFromMeta(fills, side) {
    const entryFills = getEntryFillsFromMeta(fills, side)
    if (entryFills.length === 0) return 0
    let totalValue = 0, totalQty = 0
    for (const f of entryFills) {
        totalValue += parseFloat(f.qty || 0) * parseFloat(f.price || 0)
        totalQty += parseFloat(f.qty || 0)
    }
    return totalQty > 0 ? totalValue / totalQty : 0
}

function formatMetaFillTime(timestamp) {
    return dayjs(parseInt(timestamp)).tz(timeZoneTrade.value).format('DD.MM. HH:mm')
}

function getFillBadgeType(fill, idx, allFills) {
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

function getTagColor(tagId) {
    const info = useGetTagInfo(tagId)
    return info?.groupColor || '#6c757d'
}

function hasData(entry) {
    return entry.tradeType || entry.entryStressLevel > 0 || entry.emotionLevel > 0 || entry.timeframe || entry.feelings ||
        (entry.playbook && stripHtml(entry.playbook).trim()) ||
        (entry.tags && entry.tags.length > 0) ||
        entry.satisfaction !== null || entry.entryNote ||
        entry.closingStressLevel > 0 || entry.closingEmotionLevel > 0 || entry.closingTimeframe ||
        entry.closingFeelings || (entry.closingPlaybook && stripHtml(entry.closingPlaybook).trim()) ||
        entry.closingNote
}

// --- Expand/Collapse ---
function toggleExpand(tradeId) {
    if (expandedId.value === tradeId) {
        if (editingId.value === tradeId) cancelEdit(tradeId)
        expandedId.value = null
        return
    }
    if (expandedId.value && editingId.value === expandedId.value) {
        cancelEdit(expandedId.value)
    }
    expandedId.value = tradeId
}

// --- Edit mode ---
async function startEdit(tradeId) {
    editingId.value = tradeId

    await nextTick()
    const entry = playbookEntries.value.find(e => e.tradeId === tradeId)

    // Opening Quill
    const openingKey = tradeId + '_opening'
    const openingEl = document.getElementById('quillPlaybook-' + tradeId + '-opening')
    if (openingEl && !quillInstances[openingKey]) {
        const quill = new Quill(openingEl, {
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, false] }],
                    ['bold', 'italic', 'underline'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    ['clean']
                ]
            },
            placeholder: t('incoming.note') + '...',
            theme: 'snow'
        })
        quill.root.innerHTML = sanitizeHtml(entry?.playbook || '')
        quillInstances[openingKey] = quill
    }

    // Closing Quill
    const closingKey = tradeId + '_closing'
    const closingEl = document.getElementById('quillPlaybook-' + tradeId + '-closing')
    if (closingEl && !quillInstances[closingKey]) {
        const quill = new Quill(closingEl, {
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, false] }],
                    ['bold', 'italic', 'underline'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    ['clean']
                ]
            },
            placeholder: t('incoming.note') + '...',
            theme: 'snow'
        })
        quill.root.innerHTML = sanitizeHtml(entry?.closingPlaybook || '')
        quillInstances[closingKey] = quill
    }
}

function cancelEdit(tradeId) {
    delete quillInstances[tradeId + '_opening']
    delete quillInstances[tradeId + '_closing']
    editingId.value = null
}

// --- Trade Type ---
const tradeTypeOptions = [
    { value: 'scalp', labelKey: 'incoming.scalptrade' },
    { value: 'day', labelKey: 'incoming.daytrade' },
    { value: 'swing', labelKey: 'incoming.swingtrade' },
]

function updateTradeType(entry, value) {
    entry.tradeType = entry.tradeType === value ? '' : value
}

function getTradeTypeLabel(value) {
    const opt = tradeTypeOptions.find(o => o.value === value)
    return opt ? t(opt.labelKey) : value
}

// --- Opening Stress Level ---
function updateEntryStress(entry, level) {
    entry.entryStressLevel = entry.entryStressLevel === level ? 0 : level
}

// --- Opening Emotion Level ---
function updateEmotionLevel(entry, level) {
    entry.emotionLevel = entry.emotionLevel === level ? 0 : level
}

// --- Closing Stress Level ---
function updateClosingStress(entry, level) {
    entry.closingStressLevel = (entry.closingStressLevel || 0) === level ? 0 : level
}

// --- Closing Emotion Level ---
function updateClosingEmotionLevel(entry, level) {
    entry.closingEmotionLevel = (entry.closingEmotionLevel || 0) === level ? 0 : level
}

// --- Closing Timeframe ---
function updateClosingTimeframe(entry, tf) {
    entry.closingTimeframe = (entry.closingTimeframe || '') === tf ? '' : tf
}

// --- Tags ---
function addTag(entry, tagData) {
    if (!entry.tags) entry.tags = []
    if (!entry.tags.some(t => t.id === tagData.id)) {
        entry.tags.push(tagData)
    }
}

function addClosingTag(entry, tagData) {
    if (!entry.closingTags) entry.closingTags = []
    if (!entry.closingTags.some(t => t.id === tagData.id)) {
        entry.closingTags.push(tagData)
    }
}

function removeTag(entry, idx, groupName) {
    const groupTags = getTagsForGroup(entry, groupName)
    if (idx >= 0 && idx < groupTags.length) {
        const tagToRemove = groupTags[idx]
        const realIdx = entry.tags.findIndex(t => t.id === tagToRemove.id)
        if (realIdx !== -1) entry.tags.splice(realIdx, 1)
    }
}

function getTagsForGroup(entry, groupName) {
    return (entry.tags || []).filter(t => {
        const info = useGetTagInfo(t.id)
        return info?.tagGroupName === groupName
    })
}

function getGroupTags(groupId) {
    const group = availableTags.find(g => g.id === groupId)
    return group ? group.tags : []
}

// --- Timeframe ---
function updateTimeframe(entry, tf) {
    entry.timeframe = entry.timeframe === tf ? '' : tf
}

// --- Satisfaction ---
function updateSatisfaction(entry, val) {
    entry.satisfaction = entry.satisfaction === val ? null : val
}

// --- Screenshots ---
function getScreenshotById(screenshotId) {
    if (!screenshotId) return null
    const list = screenshotMap.value
    if (!list || !list.length) return null
    return list.find(s => s.objectId === screenshotId) || null
}

function getEntryScreenshot(entry) {
    // 1. By screenshotId field (explicit link — always trust)
    const byId = getScreenshotById(entry.screenshotId)
    if (byId) return byId

    const list = screenshotMap.value
    if (!list || !list.length) return null

    // Helper: exclude screenshots that belong to the closing evaluation
    const isClosing = (s) => {
        if (entry.closingScreenshotId && s.objectId === entry.closingScreenshotId) return true
        if (s.name && s.name.includes('_closing')) return true
        return false
    }

    // 2. Match by name containing "_entry"
    let match = list.find(s => s.name && s.name.includes(entry.tradeId) && s.name.includes('_entry'))
    if (match) return match

    // 3. Exact match by name (legacy)
    match = list.find(s => s.name === entry.tradeId && !isClosing(s))
    if (match) return match

    // 4. Match by name containing tradeId prefix (exclude closing)
    match = list.find(s => s.name && entry.tradeId && s.name.includes(entry.tradeId) && !isClosing(s))
    if (match) return match

    // 5. Match by dateUnix + symbol (exclude closing)
    if (entry.dateUnix && entry.symbol) {
        match = list.find(s =>
            s.symbol === entry.symbol &&
            (s.dateUnixDay === entry.dateUnix || s.dateUnix === entry.dateUnix) &&
            !isClosing(s)
        )
        if (match) return match
    }

    // 6. Fuzzy: dateUnixDay prefix (exclude closing)
    if (entry.tradeId) {
        const m = entry.tradeId.match(/^t?(\d+)_/)
        if (m) {
            const prefix = m[1]
            match = list.find(s => s.name && s.name.startsWith(prefix + '_') && !isClosing(s))
            if (match) return match
            match = list.find(s => s.dateUnixDay && s.dateUnixDay.toString() === prefix && !isClosing(s))
            if (match) return match
        }
    }

    return null
}

function getTrendScreenshot(entry) {
    const byId = getScreenshotById(entry.trendScreenshotId)
    if (byId) return byId

    const list = screenshotMap.value
    if (!list || !list.length) return null

    const match = list.find(s => s.name && s.name.includes(entry.tradeId) && s.name.includes('_trend'))
    return match || null
}

function getClosingScreenshot(entry) {
    // By closingScreenshotId
    const byId = getScreenshotById(entry.closingScreenshotId)
    if (byId) return byId

    const list = screenshotMap.value
    if (!list || !list.length) return null

    // Match by name containing "_closing"
    const match = list.find(s => s.name && s.name.includes(entry.tradeId) && s.name.includes('_closing'))
    return match || null
}

function openFullscreen(screenshotObj) {
    if (screenshotObj) {
        fullscreenImg.value = screenshotObj.annotatedBase64 || screenshotObj.originalBase64
    }
}

function closeFullscreen() {
    fullscreenImg.value = null
}

// --- Screenshot Upload / Remove ---
async function handleEntryScreenshotUpload(event, entry) {
    const file = event.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = async () => {
        const base64 = reader.result
        const screenshot = await dbCreate('screenshots', {
            name: entry.tradeId + '_entry',
            symbol: entry.symbol || '',
            side: entry.side || '',
            broker: selectedBroker.value || 'bitunix',
            originalBase64: base64,
            annotatedBase64: base64,
            markersOnly: true,
            maState: {},
            dateUnix: entry.dateUnix,
            dateUnixDay: entry.dateUnix
        })
        entry.screenshotId = screenshot.objectId
        entryScreenshotPreviews.value[entry.tradeId] = base64
        // Add to screenshotMap cache
        screenshotMap.value.push(screenshot)
    }
    reader.readAsDataURL(file)
}

async function removeEntryScreenshot(entry) {
    const screenshotId = entry.screenshotId
    const matchedScreenshot = getEntryScreenshot(entry)

    // 1. Clear in-memory state
    entry.screenshotId = ''
    delete entryScreenshotPreviews.value[entry.tradeId]

    // 2. Persist to DB — clear the reference in the notes record
    if (entry.noteObjectId) {
        await dbUpdate('notes', entry.noteObjectId, { screenshotId: '' })
    }

    // 3. Delete the actual screenshot record
    if (screenshotId) {
        try {
            await dbDelete('screenshots', screenshotId)
            const idx = screenshotMap.value.findIndex(s => s.objectId === screenshotId)
            if (idx !== -1) screenshotMap.value.splice(idx, 1)
        } catch (e) {
            console.warn('Could not delete screenshot record:', e.message)
        }
    } else if (matchedScreenshot) {
        try {
            await dbDelete('screenshots', matchedScreenshot.objectId)
            const idx = screenshotMap.value.findIndex(s => s.objectId === matchedScreenshot.objectId)
            if (idx !== -1) screenshotMap.value.splice(idx, 1)
        } catch (e) {
            console.warn('Could not delete screenshot record:', e.message)
        }
    }
}

async function handleTrendScreenshotUpload(event, entry) {
    const file = event.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = async () => {
        const base64 = reader.result
        const screenshot = await dbCreate('screenshots', {
            name: entry.tradeId + '_trend',
            symbol: entry.symbol || '',
            side: entry.side || '',
            broker: selectedBroker.value || 'bitunix',
            originalBase64: base64,
            annotatedBase64: base64,
            markersOnly: true,
            maState: {},
            dateUnix: entry.dateUnix,
            dateUnixDay: entry.dateUnix
        })
        entry.trendScreenshotId = screenshot.objectId
        trendScreenshotPreviews.value[entry.tradeId] = base64
        screenshotMap.value.push(screenshot)
    }
    reader.readAsDataURL(file)
}

async function removeTrendScreenshot(entry) {
    const screenshotId = entry.trendScreenshotId
    const matchedScreenshot = getTrendScreenshot(entry)

    entry.trendScreenshotId = ''
    delete trendScreenshotPreviews.value[entry.tradeId]

    if (entry.noteObjectId) {
        await dbUpdate('notes', entry.noteObjectId, { trendScreenshotId: '' })
    }

    if (screenshotId) {
        try {
            await dbDelete('screenshots', screenshotId)
            const idx = screenshotMap.value.findIndex(s => s.objectId === screenshotId)
            if (idx !== -1) screenshotMap.value.splice(idx, 1)
        } catch (e) {
            console.warn('Could not delete screenshot record:', e.message)
        }
    } else if (matchedScreenshot) {
        try {
            await dbDelete('screenshots', matchedScreenshot.objectId)
            const idx = screenshotMap.value.findIndex(s => s.objectId === matchedScreenshot.objectId)
            if (idx !== -1) screenshotMap.value.splice(idx, 1)
        } catch (e) {
            console.warn('Could not delete screenshot record:', e.message)
        }
    }
}

async function handleClosingScreenshotUpload(event, entry) {
    const file = event.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = async () => {
        const base64 = reader.result
        const screenshot = await dbCreate('screenshots', {
            name: entry.tradeId + '_closing',
            symbol: entry.symbol || '',
            side: entry.side || '',
            broker: selectedBroker.value || 'bitunix',
            originalBase64: base64,
            annotatedBase64: base64,
            markersOnly: true,
            maState: {},
            dateUnix: entry.dateUnix,
            dateUnixDay: entry.dateUnix
        })
        entry.closingScreenshotId = screenshot.objectId
        closingScreenshotPreviews.value[entry.tradeId] = base64
        screenshotMap.value.push(screenshot)
    }
    reader.readAsDataURL(file)
}

async function removeClosingScreenshot(entry) {
    const screenshotId = entry.closingScreenshotId
    const matchedScreenshot = getClosingScreenshot(entry)

    // 1. Clear in-memory state
    entry.closingScreenshotId = ''
    delete closingScreenshotPreviews.value[entry.tradeId]

    // 2. Persist to DB — clear the reference in the notes record
    if (entry.noteObjectId) {
        await dbUpdate('notes', entry.noteObjectId, { closingScreenshotId: '' })
    }

    // 3. Delete the actual screenshot record
    if (screenshotId) {
        try {
            await dbDelete('screenshots', screenshotId)
            // Remove from local screenshotMap
            const idx = screenshotMap.value.findIndex(s => s.objectId === screenshotId)
            if (idx !== -1) screenshotMap.value.splice(idx, 1)
        } catch (e) {
            console.warn('Could not delete screenshot record:', e.message)
        }
    } else if (matchedScreenshot) {
        // Fallback: screenshot was matched by name, not by ID
        try {
            await dbDelete('screenshots', matchedScreenshot.objectId)
            const idx = screenshotMap.value.findIndex(s => s.objectId === matchedScreenshot.objectId)
            if (idx !== -1) screenshotMap.value.splice(idx, 1)
        } catch (e) {
            console.warn('Could not delete screenshot record:', e.message)
        }
    }
}

// --- Strip HTML ---
function stripHtml(html) {
    if (!html) return ''
    const tmp = document.createElement('div')
    tmp.innerHTML = sanitizeHtml(html)
    return tmp.textContent || tmp.innerText || ''
}

// --- Save ---
async function saveEntry(entry) {
    savingId.value = entry.tradeId

    try {
        // Get opening Quill content
        const openingKey = entry.tradeId + '_opening'
        if (quillInstances[openingKey]) {
            entry.playbook = quillInstances[openingKey].root.innerHTML
        }

        // Get closing Quill content
        const closingKey = entry.tradeId + '_closing'
        if (quillInstances[closingKey]) {
            entry.closingPlaybook = quillInstances[closingKey].root.innerHTML
        }

        let noteText = ''
        if (entry.playbook && entry.playbook.trim()) {
            noteText += entry.playbook
        }
        if (!noteText.trim()) {
            noteText = '<p>-</p>'
        }
        entry.note = noteText

        await dbUpdate('notes', entry.noteObjectId, {
            note: entry.note,
            // Opening fields
            tradeType: entry.tradeType || '',
            entryStressLevel: entry.entryStressLevel || 0,
            emotionLevel: entry.emotionLevel || 0,
            entryNote: entry.entryNote || '',
            feelings: entry.feelings || '',
            playbook: entry.playbook || '',
            timeframe: entry.timeframe || '',
            screenshotId: entry.screenshotId || '',
            // Closing fields
            closingNote: entry.closingNote || '',
            closingStressLevel: entry.closingStressLevel || 0,
            closingEmotionLevel: entry.closingEmotionLevel || 0,
            closingFeelings: entry.closingFeelings || '',
            closingTimeframe: entry.closingTimeframe || '',
            closingPlaybook: entry.closingPlaybook || '',
            closingScreenshotId: entry.closingScreenshotId || '',
        })

        if (entry.satisfactionObjectId) {
            await dbUpdate('satisfactions', entry.satisfactionObjectId, {
                satisfaction: entry.satisfaction
            })
        } else if (entry.satisfaction !== null && entry.satisfaction !== undefined) {
            const { dbCreate } = await import('../utils/db.js')
            const result = await dbCreate('satisfactions', {
                dateUnix: entry.dateUnix,
                tradeId: entry.tradeId,
                satisfaction: entry.satisfaction
            })
            entry.satisfactionObjectId = result.objectId
        }

        const tagIds = (entry.tags || []).map(t => typeof t === 'object' ? t.id : t)
        const closingTagIds = (entry.closingTags || []).map(t => typeof t === 'object' ? t.id : t)
        if (entry.tagRecordObjectId) {
            await dbUpdate('tags', entry.tagRecordObjectId, {
                tags: tagIds,
                closingTags: closingTagIds
            })
        } else if (tagIds.length > 0 || closingTagIds.length > 0) {
            const { dbCreate } = await import('../utils/db.js')
            const result = await dbCreate('tags', {
                dateUnix: entry.dateUnix,
                tradeId: entry.tradeId,
                tags: tagIds,
                closingTags: closingTagIds
            })
            entry.tagRecordObjectId = result.objectId
        }

    } catch (error) {
        console.error(' -> Playbook saveEntry Fehler:', error)
    } finally {
        delete quillInstances[entry.tradeId + '_opening']
        delete quillInstances[entry.tradeId + '_closing']
        editingId.value = null
        savingId.value = null
    }
}
</script>

<template>
    <div class="row mt-2">
        <div v-show="!spinnerLoadingPage">
            <div class="row mb-3">
                <div class="col">
                    <small class="text-muted">{{ t('playbook.tradeEvaluations') }}</small>
                </div>
            </div>

            <NoData v-if="playbookEntries.length === 0" />

            <div v-for="entry in playbookEntries" :key="entry.tradeId" :id="'playbook-' + entry.tradeId"
                class="pb-card mb-2">

                <!-- Card header -->
                <div class="pb-header pointerClass" @click="toggleExpand(entry.tradeId)">
                    <div class="d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center gap-2">
                            <strong class="fs-5">{{ entry.symbol }}</strong>
                            <span v-if="entry.side" class="badge"
                                :class="entry.side === 'long' || entry.side === 'B' ? 'bg-success' : 'bg-danger'">
                                {{ formatSide(entry.side) }}
                            </span>
                            <span v-if="expandedId === entry.tradeId && editingId !== entry.tradeId"
                                class="pb-edit-btn pointerClass" @click.stop="startEdit(entry.tradeId)"
                                :title="t('common.edit')">
                                <i class="uil uil-pen"></i>
                            </span>
                            <span class="text-muted small">{{ useCreatedDateFormat(entry.dateUnix) }}</span>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <span v-if="entry.satisfaction === 1">👍</span>
                            <span v-if="entry.satisfaction === 2">✊</span>
                            <span v-if="entry.satisfaction === 0">👎</span>
                            <span v-if="entry.pnl" class="fw-bold"
                                :class="entry.pnl >= 0 ? 'greenTrade' : 'redTrade'">
                                {{ entry.pnl >= 0 ? '+' : '' }}{{ parseFloat(entry.pnl).toFixed(2) }}
                            </span>
                            <i :class="expandedId === entry.tradeId ? 'uil-angle-up' : 'uil-angle-down'"
                                class="uil fs-4 pb-chevron"></i>
                        </div>
                    </div>

                    <!-- Collapsed preview -->
                    <div v-if="expandedId !== entry.tradeId && hasData(entry)" class="mt-1">
                        <div class="d-flex flex-wrap align-items-center gap-1">
                            <span v-if="entry.tradeType" class="pb-pill">{{ getTradeTypeLabel(entry.tradeType) }}</span>
                            <span v-if="entry.entryStressLevel > 0" class="pb-pill">
                                {{ t('incoming.stress') }} {{ entry.entryStressLevel }}/10
                            </span>
                            <span v-if="entry.timeframe" class="pb-pill">{{ entry.timeframe }}</span>
                            <span v-for="tag in entry.tags" :key="'o'+tag.id"
                                class="pb-pill" :style="{ backgroundColor: tag.color, color: '#fff' }">
                                {{ tag.name }}
                            </span>
                            <span v-for="tag in (entry.closingTags || [])" :key="'c'+tag.id"
                                class="pb-pill" :style="{ backgroundColor: tag.color || getTagColor(tag.id), color: '#fff', opacity: 0.7 }">
                                {{ tag.name }}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Expanded: VIEW MODE -->
                <div v-if="expandedId === entry.tradeId && editingId !== entry.tradeId" class="pb-body">
                    <!-- ===== ERÖFFNUNGSBEWERTUNG (View) ===== -->
                    <div v-if="entry.tradeType || entry.entryStressLevel > 0 || (entry.tags && entry.tags.length > 0) || entry.timeframe || entry.emotionLevel > 0 || entry.feelings || (entry.playbook && stripHtml(entry.playbook).trim()) || getTrendScreenshot(entry) || getEntryScreenshot(entry)"
                        class="pb-view-opening mb-2 p-3">
                        <div class="d-flex align-items-center mb-2">
                            <i class="uil uil-unlock-alt me-2" style="color: var(--green-color, #10b981); font-size: 1rem;"></i>
                            <span class="fw-bold small">{{ t('incoming.openingEvaluation') }}</span>
                        </div>
                        <div class="pb-grid">
                            <div v-if="entry.tradeType" class="pb-field">
                                <div class="pb-label">{{ t('incoming.tradeType') }}</div>
                                <div class="pb-value"><span class="pb-pill">{{ getTradeTypeLabel(entry.tradeType) }}</span></div>
                            </div>

                            <div v-if="entry.timeframe" class="pb-field">
                                <div class="pb-label">{{ t('incoming.timeframe') }}</div>
                                <div class="pb-value"><span class="pb-pill">{{ entry.timeframe }}</span></div>
                            </div>

                            <div v-if="entry.entryStressLevel > 0" class="pb-field">
                                <div class="pb-label">{{ t('incoming.stressLevel') }}</div>
                                <div class="pb-value">
                                    <div class="d-flex align-items-center">
                                        <div class="pb-stress-bar">
                                            <div class="pb-stress-fill"
                                                :style="{ width: (entry.entryStressLevel * 10) + '%' }"
                                                :class="entry.entryStressLevel <= 3 ? 'stress-low' : entry.entryStressLevel <= 6 ? 'stress-mid' : 'stress-high'">
                                            </div>
                                        </div>
                                        <span class="small ms-2" style="color: var(--white-60)">{{ entry.entryStressLevel }}/10</span>
                                    </div>
                                </div>
                            </div>

                            <div v-if="entry.emotionLevel > 0" class="pb-field">
                                <div class="pb-label">{{ t('incoming.emotionLevel') }}</div>
                                <div class="pb-value">
                                    <div class="d-flex align-items-center">
                                        <div class="pb-stress-bar">
                                            <div class="pb-stress-fill"
                                                :style="{ width: (entry.emotionLevel * 10) + '%' }"
                                                :class="entry.emotionLevel <= 3 ? 'stress-high' : entry.emotionLevel <= 6 ? 'stress-mid' : 'stress-low'">
                                            </div>
                                        </div>
                                        <span class="small ms-2" style="color: var(--white-60)">{{ entry.emotionLevel }}/10</span>
                                    </div>
                                </div>
                            </div>

                            <div v-if="entry.feelings" class="pb-field">
                                <div class="pb-label">{{ t('incoming.emotions') }}</div>
                                <div class="pb-value pb-text">{{ entry.feelings }}</div>
                            </div>

                            <div v-if="entry.playbook && stripHtml(entry.playbook).trim()" class="pb-field pb-field-wide">
                                <div class="pb-label">{{ t('incoming.note') }}</div>
                                <div class="pb-value pb-note-content" v-html="sanitizeHtml(entry.playbook)"></div>
                            </div>

                            <div v-if="entry.tags && entry.tags.length > 0" class="pb-field">
                                <div class="pb-label">{{ t('incoming.tags') }}</div>
                                <div class="pb-value">
                                    <span v-for="tag in entry.tags" :key="tag.id"
                                        class="pb-pill me-1"
                                        :style="{ backgroundColor: tag.color || getTagColor(tag.id), color: '#fff' }">
                                        {{ tag.name }}
                                    </span>
                                </div>
                            </div>

                            <!-- Screenshots -->
                            <div v-if="getEntryScreenshot(entry) || getTrendScreenshot(entry)" class="pb-field pb-field-wide">
                                <div class="pb-label">{{ t('incoming.screenshot') }}</div>
                                <div class="pb-value">
                                    <div class="d-flex flex-wrap align-items-start gap-3">
                                        <div v-if="getEntryScreenshot(entry)">
                                            <img :src="getEntryScreenshot(entry).annotatedBase64 || getEntryScreenshot(entry).originalBase64"
                                                class="pb-screenshot-view pointerClass"
                                                @click.stop="openFullscreen(getEntryScreenshot(entry))" />
                                        </div>
                                        <div v-if="getTrendScreenshot(entry)">
                                            <img :src="getTrendScreenshot(entry).annotatedBase64 || getTrendScreenshot(entry).originalBase64"
                                                class="pb-screenshot-view pointerClass"
                                                @click.stop="openFullscreen(getTrendScreenshot(entry))" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- ===== TRADING METADATA (View) — Fills, Positionsgröße, SL/BE/TP, Protokoll ===== -->
                    <div v-if="hasTradingMetadata(entry.tradingMetadata)"
                        class="pb-view-trading-meta mb-2 p-3">
                        <div class="d-flex align-items-center mb-2">
                            <i class="uil uil-layers me-2" style="color: var(--grey-color, #6b7280); font-size: 1rem;"></i>
                            <span class="fw-bold small">{{ t('incoming.fills') }}</span>
                            <span v-if="getEntryFillsFromMeta(entry.tradingMetadata.fills, entry.side).length > 1"
                                class="text-muted small ms-2">
                                ({{ getEntryFillsFromMeta(entry.tradingMetadata.fills, entry.side).length }} {{ t('incoming.fillEntries') }})
                            </span>
                            <span v-if="getEntryFillsFromMeta(entry.tradingMetadata.fills, entry.side).length > 0"
                                class="ms-auto fw-bold" style="font-size: 0.85rem;">
                                {{ t('incoming.fillAvgPrice') }}: {{ getAvgEntryPriceFromMeta(entry.tradingMetadata.fills, entry.side).toFixed(5) }}
                            </span>
                        </div>

                        <!-- Fills Table -->
                        <div v-if="entry.tradingMetadata.fills && entry.tradingMetadata.fills.length > 0">
                            <table class="table table-sm table-borderless mb-1" style="font-size: 0.8rem; color: var(--white-80);">
                                <tbody>
                                    <template v-for="(group, gIdx) in groupFillsByMinute(entry.tradingMetadata.fills)" :key="group.key">
                                        <tr :class="group.reduceOnly ? 'text-danger' : ''"
                                            :style="group.isGroup ? 'cursor: pointer;' : ''"
                                            @click="group.isGroup && toggleFillGroup(group.key)">
                                            <td class="text-muted ps-0" style="width: 100px;">
                                                <span v-if="group.isGroup" style="font-size: 0.6rem; margin-right: 2px;">{{ expandedFillGroups.has(group.key) ? '▼' : '▶' }}</span>
                                                {{ formatMetaFillTime(group.time) }}
                                            </td>
                                            <td style="width: 80px;" class="text-end">{{ group.totalQty }}</td>
                                            <td class="text-muted px-1">&times;</td>
                                            <td style="width: 90px;">{{ group.isGroup ? group.avgPrice.toFixed(5) : parseFloat(group.fills[0].price) }}</td>
                                            <td class="text-muted px-1">=</td>
                                            <td class="text-end" style="width: 90px;">{{ group.totalValue.toFixed(2) }}</td>
                                            <td>
                                                <span v-if="getFillBadgeType(group.fills[0], group.firstFillIdx, entry.tradingMetadata.fills) === 'close'"
                                                    class="badge bg-danger" style="font-size: 0.65rem;">{{ t('incoming.fillClose') }}</span>
                                                <span v-else-if="getFillBadgeType(group.fills[0], group.firstFillIdx, entry.tradingMetadata.fills) === 'partialClose'"
                                                    class="badge bg-warning text-dark" style="font-size: 0.65rem;">{{ t('incoming.fillPartialClose') }}</span>
                                                <span v-else-if="getFillBadgeType(group.fills[0], group.firstFillIdx, entry.tradingMetadata.fills) === 'initial'"
                                                    class="badge bg-secondary" style="font-size: 0.65rem;">{{ t('incoming.fillInitial') }}</span>
                                                <span v-else
                                                    class="badge bg-info" style="font-size: 0.65rem;">{{ t('incoming.fillCompound') }}</span>
                                                <span v-if="group.isGroup" class="text-muted ms-1" style="font-size: 0.6rem;">({{ group.fills.length }})</span>
                                            </td>
                                            <td class="text-end text-muted pe-0" style="width: 90px;">{{ t('incoming.fillFee') }}: {{ group.totalFee.toFixed(4) }}</td>
                                        </tr>
                                        <template v-if="group.isGroup && expandedFillGroups.has(group.key)">
                                            <tr v-for="(fill, fIdx) in group.fills" :key="group.key + '_' + fIdx"
                                                :class="fill.reduceOnly ? 'text-danger' : ''" style="opacity: 0.6; font-size: 0.7rem;">
                                                <td class="ps-0" style="width: 100px;"></td>
                                                <td style="width: 80px;" class="text-end">{{ parseFloat(fill.qty) }}</td>
                                                <td class="text-muted px-1">&times;</td>
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
                            <div v-if="getEntryFillsFromMeta(entry.tradingMetadata.fills, entry.side).length > 1"
                                class="d-flex justify-content-between border-top pt-1 mt-1"
                                style="font-size: 0.8rem; border-color: var(--white-20) !important;">
                                <span class="text-muted">
                                    {{ t('incoming.fillTotal') }}:
                                    <strong class="text-white">{{ getEntryFillsFromMeta(entry.tradingMetadata.fills, entry.side).reduce((sum, f) => sum + parseFloat(f.qty || 0), 0) }}</strong>
                                </span>
                                <span class="text-muted">
                                    {{ t('incoming.fillFee') }}:
                                    <strong class="text-white">{{ entry.tradingMetadata.fills.reduce((sum, f) => sum + parseFloat(f.fee || 0), 0).toFixed(4) }}</strong>
                                </span>
                            </div>

                            <!-- Position Size row -->
                            <div v-if="entry.tradingMetadata.positionSize"
                                class="d-flex justify-content-between border-top pt-1 mt-1"
                                style="font-size: 0.8rem; border-color: var(--white-20) !important;">
                                <span class="text-muted">
                                    {{ t('incoming.positionSize') }}:
                                    <span class="text-white">{{ parseFloat(entry.tradingMetadata.margin || 0).toFixed(2) }}</span>
                                    <span class="text-muted"> &times; </span>
                                    <span class="text-white">{{ entry.tradingMetadata.leverage }}x</span>
                                    <span class="text-muted"> = </span>
                                    <strong class="text-white">{{ parseFloat(entry.tradingMetadata.positionSize).toFixed(2) }} USDT</strong>
                                </span>
                            </div>
                        </div>

                        <!-- SL / BE / TP Row -->
                        <div v-if="entry.tradingMetadata.sl || entry.tradingMetadata.tp || entry.tradingMetadata.breakeven"
                            class="d-flex gap-3 mt-2 pt-2 border-top"
                            style="font-size: 0.8rem; border-color: var(--white-20) !important;">
                            <span v-if="entry.tradingMetadata.sl">
                                <span class="fw-bold"
                                    :class="!entry.tradingMetadata.slAboveBreakeven ? 'text-danger' : ''"
                                    :style="entry.tradingMetadata.slAboveBreakeven ? 'color: #86efac' : ''">
                                    SL: {{ entry.tradingMetadata.sl }}
                                </span>
                                <span v-if="entry.tradingMetadata.slQty" class="text-muted ms-1">({{ entry.tradingMetadata.slQty }})</span>
                            </span>
                            <span v-if="entry.tradingMetadata.breakeven">
                                <span class="text-muted fw-bold">BE: {{ parseFloat(entry.tradingMetadata.breakeven).toFixed(2) }}</span>
                            </span>
                            <span v-if="entry.tradingMetadata.tp">
                                <span class="fw-bold" style="color: #f59e0b;">TP: {{ entry.tradingMetadata.tp }}</span>
                                <span v-if="entry.tradingMetadata.tpQty" class="text-muted ms-1">({{ entry.tradingMetadata.tpQty }})</span>
                            </span>
                            <span v-if="entry.tradingMetadata.rrr" class="ms-auto">
                                <span class="fw-bold" style="color: #a78bfa;">RRR 1:{{ entry.tradingMetadata.rrr }}</span>
                            </span>
                        </div>

                        <!-- SL/TP Protocol History -->
                        <div v-if="getFilteredTpslHistory(entry.tradingMetadata).length > 0"
                            class="mt-2 pt-2 border-top"
                            style="font-size: 0.75rem; border-color: var(--white-20) !important;">
                            <div class="text-muted mb-1"><i class="uil uil-history me-1"></i>SL/TP Protokoll</div>
                            <div v-for="(histEntry, idx) in getFilteredTpslHistory(entry.tradingMetadata)" :key="'hist-'+idx"
                                class="d-flex align-items-center gap-2 mb-1">
                                <span class="text-muted" style="width: 90px;">{{ dayjs(histEntry.time).tz(timeZoneTrade.value).format('DD.MM. HH:mm') }}</span>
                                <span :class="histEntry.type === 'SL' ? (entry.tradingMetadata.slAboveBreakeven ? '' : 'text-danger') : (histEntry.action === 'triggered' ? 'text-success fw-bold' : '')"
                                    :style="histEntry.type === 'SL' && entry.tradingMetadata.slAboveBreakeven ? 'color: #86efac' : (histEntry.type === 'TP' && histEntry.action !== 'triggered' ? 'color: #f59e0b' : '')">
                                    {{ histEntry.type }}
                                </span>
                                <template v-if="histEntry.action === 'set'">
                                    <span class="text-muted">&rarr;</span>
                                    <span class="text-white">{{ histEntry.newVal }}</span>
                                    <span class="badge bg-secondary" style="font-size: 0.6rem;">Gesetzt</span>
                                </template>
                                <template v-else-if="histEntry.action === 'moved'">
                                    <span class="text-muted" style="text-decoration: line-through;">{{ histEntry.oldVal }}</span>
                                    <span class="text-muted">&rarr;</span>
                                    <span class="text-white">{{ histEntry.newVal }}</span>
                                    <span class="badge bg-warning text-dark" style="font-size: 0.6rem;">Verschoben</span>
                                </template>
                                <template v-else-if="histEntry.action === 'triggered'">
                                    <span class="text-success" style="text-decoration: line-through;">{{ histEntry.oldVal }}</span>
                                    <span class="text-success">&rarr;</span>
                                    <span class="text-success fw-bold">Ausgelöst &#x2713;</span>
                                </template>
                                <template v-else-if="histEntry.action === 'removed'">
                                    <span class="text-muted" style="text-decoration: line-through;">{{ histEntry.oldVal }}</span>
                                    <span class="text-muted">&rarr; entfernt</span>
                                </template>
                            </div>
                        </div>
                    </div>

                    <!-- ===== ABSCHLUSSBEWERTUNG (View) — Tags + Notiz + Screenshot ===== -->
                    <div v-if="(entry.closingTags && entry.closingTags.length > 0) || (entry.closingPlaybook && stripHtml(entry.closingPlaybook).trim()) || entry.closingNote || (entry.satisfaction !== null && entry.satisfaction !== undefined) || getClosingScreenshot(entry)"
                        class="pb-view-closing mb-2 p-3">
                        <div class="d-flex align-items-center mb-2">
                            <i class="uil uil-lock-alt me-2" style="color: var(--blue-color, #3b82f6); font-size: 1rem;"></i>
                            <span class="fw-bold small">{{ t('incoming.closingEvaluation') }}</span>
                        </div>
                        <div class="pb-grid">
                            <div v-if="entry.closingPlaybook && stripHtml(entry.closingPlaybook).trim()" class="pb-field pb-field-wide">
                                <div class="pb-label">{{ t('incoming.note') }}</div>
                                <div class="pb-value pb-note-content" v-html="sanitizeHtml(entry.closingPlaybook)"></div>
                            </div>

                            <div v-if="entry.closingNote && !(entry.closingPlaybook && stripHtml(entry.closingPlaybook).trim())" class="pb-field pb-field-wide">
                                <div class="pb-label">{{ t('incoming.closingNote') }}</div>
                                <div class="pb-value pb-note-content" v-html="sanitizeHtml(entry.closingNote)"></div>
                            </div>

                            <div v-if="entry.closingTags && entry.closingTags.length > 0" class="pb-field">
                                <div class="pb-label">{{ t('incoming.tags') }}</div>
                                <div class="pb-value">
                                    <span v-for="tag in entry.closingTags" :key="tag.id"
                                        class="pb-pill me-1"
                                        :style="{ backgroundColor: tag.color || getTagColor(tag.id), color: '#fff' }">
                                        {{ tag.name }}
                                    </span>
                                </div>
                            </div>

                            <div v-if="entry.satisfaction !== null && entry.satisfaction !== undefined" class="pb-field">
                                <div class="pb-label">{{ t('incoming.satisfaction') }}</div>
                                <div class="pb-value">
                                    <span v-if="entry.satisfaction === 1" class="fs-5">👍</span>
                                    <span v-else-if="entry.satisfaction === 2" class="fs-5">✊</span>
                                    <span v-else class="fs-5">👎</span>
                                </div>
                            </div>

                            <!-- Closing Screenshot -->
                            <div v-if="getClosingScreenshot(entry)" class="pb-field pb-field-wide">
                                <div class="pb-label">{{ t('incoming.screenshot') }}</div>
                                <div class="pb-value">
                                    <div>
                                        <img :src="getClosingScreenshot(entry).annotatedBase64 || getClosingScreenshot(entry).originalBase64"
                                            class="pb-screenshot-view pointerClass"
                                            @click.stop="openFullscreen(getClosingScreenshot(entry))"
                                            :title="t('incoming.screenshot')" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Empty state -->
                    <div v-if="!hasData(entry)" class="text-center py-3">
                        <small class="text-muted">{{ t('playbook.noEvaluation') }}</small>
                        <div class="mt-2">
                            <button class="btn btn-sm btn-outline-primary" @click.stop="startEdit(entry.tradeId)">
                                <i class="uil uil-pen me-1"></i>{{ t('playbook.evaluateNow') }}
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Expanded: EDIT MODE -->
                <div v-if="expandedId === entry.tradeId && editingId === entry.tradeId" class="pb-body pb-edit-mode">

                    <!-- ===== ERÖFFNUNGSBEWERTUNG (Edit) ===== -->
                    <div class="pb-edit-opening p-3">
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
                                :class="entry.tradeType === tt.value ? 'btn-primary' : 'btn-outline-secondary'"
                                @click.stop="updateTradeType(entry, tt.value)">
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
                                :class="entry.timeframe === tf.value ? 'btn-primary' : 'btn-outline-secondary'"
                                @click.stop="updateTimeframe(entry, tf.value)">
                                {{ tf.label }}
                            </button>
                        </div>
                    </div>

                    <!-- Stresslevel -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.stressLevel') }}</label>
                        <div class="d-flex align-items-end flex-wrap">
                            <template v-for="n in 10" :key="n">
                                <span @click.stop="updateEntryStress(entry, n)"
                                    class="stress-dot pointerClass"
                                    :class="n <= entry.entryStressLevel ? 'active' : 'inactive'">
                                    <span class="stress-number">{{ n }}</span>&#x25CF;
                                </span>
                                <span v-if="n < 10" class="stress-dot stress-spacer"
                                    :class="n <= entry.entryStressLevel ? 'active' : 'inactive'">
                                    <span class="stress-number">&nbsp;</span>&#x25CF;
                                </span>
                            </template>
                        </div>
                    </div>

                    <!-- Emotionslevel -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.emotionLevel') }}</label>
                        <div class="d-flex align-items-end flex-wrap">
                            <template v-for="n in 10" :key="'emo'+n">
                                <span @click.stop="updateEmotionLevel(entry, n)"
                                    class="stress-dot pointerClass"
                                    :class="n <= entry.emotionLevel ? 'active' : 'inactive'">
                                    <span class="stress-number">{{ n }}</span>&#x25CF;
                                </span>
                                <span v-if="n < 10" class="stress-dot stress-spacer"
                                    :class="n <= entry.emotionLevel ? 'active' : 'inactive'">
                                    <span class="stress-number">&nbsp;</span>&#x25CF;
                                </span>
                            </template>
                        </div>
                    </div>

                    <!-- Gefühle -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.emotions') }}</label>
                        <textarea class="form-control form-control-sm" v-model="entry.feelings"
                            :placeholder="t('incoming.emotionsPlaceholder')" rows="2"></textarea>
                    </div>

                    <!-- Playbook Notiz -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.note') }}</label>
                        <div :id="'quillPlaybook-' + entry.tradeId + '-opening'" class="quill-incoming"></div>
                    </div>

                    <!-- Tags -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.tags') }}</label>
                        <!-- Zugewiesene Tags als Badges -->
                        <div class="d-flex flex-wrap align-items-center gap-1 mb-2">
                            <span v-for="(tag, idx) in (entry.tags || [])" :key="tag.id"
                                class="badge me-1 pointerClass"
                                :style="{ backgroundColor: getTagColor(tag.id) }"
                                @click.stop="entry.tags.splice(idx, 1)">
                                {{ tag.name }} <span class="ms-1">&times;</span>
                            </span>
                        </div>
                        <!-- Ein Dropdown mit allen Gruppen als optgroups -->
                        <select class="form-select form-select-sm"
                            @change.stop="addTag(entry, JSON.parse($event.target.value)); $event.target.selectedIndex = 0">
                            <option selected disabled>{{ t('incoming.addTag') }}</option>
                            <optgroup v-for="group in availableTags" :key="group.id" :label="group.name">
                                <option v-for="tag in getGroupTags(group.id)" :key="tag.id"
                                    :value="JSON.stringify({ id: tag.id, name: tag.name })"
                                    :disabled="(entry.tags || []).some(t => t.id === tag.id)">
                                    {{ tag.name }}
                                </option>
                            </optgroup>
                        </select>
                    </div>

                    <!-- Screenshots (max 2) -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">{{ t('incoming.screenshot') }}</label>
                        <!-- Erster Screenshot (entry) -->
                        <div v-if="entry.screenshotId || getEntryScreenshot(entry)" class="d-flex align-items-start gap-2 mb-2">
                            <img v-if="entryScreenshotPreviews[entry.tradeId]"
                                :src="entryScreenshotPreviews[entry.tradeId]"
                                class="img-fluid rounded" style="max-height: 150px;" />
                            <img v-else-if="getEntryScreenshot(entry)"
                                :src="getEntryScreenshot(entry).annotatedBase64 || getEntryScreenshot(entry).originalBase64"
                                class="img-fluid rounded" style="max-height: 150px;"
                                @click.stop="openFullscreen(getEntryScreenshot(entry))" />
                            <span v-else class="badge bg-success">{{ t('incoming.screenshotLinked') }}</span>
                            <i class="uil uil-times pointerClass text-danger" @click.stop="removeEntryScreenshot(entry)"></i>
                        </div>
                        <!-- Zweiter Screenshot (trend) -->
                        <div v-if="entry.trendScreenshotId || getTrendScreenshot(entry)" class="d-flex align-items-start gap-2 mb-2">
                            <img v-if="trendScreenshotPreviews[entry.tradeId]"
                                :src="trendScreenshotPreviews[entry.tradeId]"
                                class="img-fluid rounded" style="max-height: 150px;" />
                            <img v-else-if="getTrendScreenshot(entry)"
                                :src="getTrendScreenshot(entry).annotatedBase64 || getTrendScreenshot(entry).originalBase64"
                                class="img-fluid rounded" style="max-height: 150px;"
                                @click.stop="openFullscreen(getTrendScreenshot(entry))" />
                            <span v-else class="badge bg-success">{{ t('incoming.screenshotLinked') }}</span>
                            <i class="uil uil-times pointerClass text-danger" @click.stop="removeTrendScreenshot(entry)"></i>
                        </div>
                        <!-- Upload sichtbar bis 2 Screenshots vorhanden -->
                        <input v-if="!(entry.screenshotId || getEntryScreenshot(entry)) || !(entry.trendScreenshotId || getTrendScreenshot(entry))"
                            type="file" accept="image/*" class="form-control form-control-sm"
                            @change="!(entry.screenshotId || getEntryScreenshot(entry)) ? handleEntryScreenshotUpload($event, entry) : handleTrendScreenshotUpload($event, entry)" />
                    </div>

                    <!-- ===== ABSCHLUSSBEWERTUNG (Edit) ===== -->
                    </div><!-- /opening-eval-edit -->

                    <div class="pb-edit-closing p-3 mt-2">
                        <div class="d-flex align-items-center mb-3">
                            <i class="uil uil-lock-alt me-2" style="color: var(--blue-color, #3b82f6); font-size: 1.1rem;"></i>
                            <span class="fw-bold" style="font-size: 0.95rem;">{{ t('incoming.closingEvaluation') }}</span>
                        </div>

                        <!-- Trade-Typ (änderbar) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.tradeType') }}</label>
                            <div class="d-flex flex-wrap gap-1">
                                <button v-for="tt in tradeTypeOptions" :key="tt.value"
                                    class="btn btn-sm py-0 px-2"
                                    :class="entry.tradeType === tt.value ? 'btn-primary' : 'btn-outline-secondary'"
                                    @click.stop="updateTradeType(entry, tt.value)">
                                    {{ t(tt.labelKey) }}
                                </button>
                            </div>
                        </div>

                        <!-- Notiz (Closing Quill) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.note') }}</label>
                            <div :id="'quillPlaybook-' + entry.tradeId + '-closing'" class="quill-incoming"></div>
                        </div>

                        <!-- Tags (Closing) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.tags') }}</label>
                            <div class="d-flex flex-wrap align-items-center gap-1 mb-2">
                                <span v-for="(tag, idx) in (entry.closingTags || [])" :key="tag.id"
                                    class="badge me-1 pointerClass"
                                    :style="{ backgroundColor: getTagColor(tag.id) }"
                                    @click.stop="entry.closingTags.splice(idx, 1)">
                                    {{ tag.name }} <span class="ms-1">&times;</span>
                                </span>
                            </div>
                            <select class="form-select form-select-sm"
                                @change.stop="addClosingTag(entry, JSON.parse($event.target.value)); $event.target.selectedIndex = 0">
                                <option selected disabled>{{ t('incoming.addTag') }}</option>
                                <optgroup v-for="group in availableTags" :key="group.id" :label="group.name">
                                    <option v-for="tag in getGroupTags(group.id)" :key="tag.id"
                                        :value="JSON.stringify({ id: tag.id, name: tag.name })"
                                        :disabled="(entry.closingTags || []).some(t => t.id === tag.id)">
                                        {{ tag.name }}
                                    </option>
                                </optgroup>
                            </select>
                        </div>

                        <!-- Abschluss-Screenshot -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.screenshot') }}</label>
                            <div v-if="entry.closingScreenshotId || getClosingScreenshot(entry)">
                                <div class="d-flex align-items-center gap-2">
                                    <img v-if="closingScreenshotPreviews[entry.tradeId]"
                                        :src="closingScreenshotPreviews[entry.tradeId]"
                                        class="img-fluid rounded mb-1" style="max-height: 200px;" />
                                    <img v-else-if="getClosingScreenshot(entry)"
                                        :src="getClosingScreenshot(entry).annotatedBase64 || getClosingScreenshot(entry).originalBase64"
                                        class="img-fluid rounded mb-1" style="max-height: 200px;"
                                        @click.stop="openFullscreen(getClosingScreenshot(entry))" />
                                    <span v-else class="badge bg-success">{{ t('incoming.screenshotLinked') }}</span>
                                </div>
                                <div class="d-flex gap-2 mt-1">
                                    <button class="btn btn-sm btn-outline-danger" @click.stop="removeClosingScreenshot(entry)">
                                        <i class="uil uil-times me-1"></i>{{ t('common.remove') }}
                                    </button>
                                </div>
                            </div>
                            <input v-else type="file" accept="image/*" class="form-control form-control-sm"
                                @change="handleClosingScreenshotUpload($event, entry)" />
                        </div>

                        <!-- Zufriedenheit -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">{{ t('incoming.satisfaction') }}</label>
                            <div class="d-flex gap-3">
                                <span class="pointerClass fs-4"
                                    :style="entry.satisfaction === 1 ? '' : 'opacity: 0.3; filter: grayscale(1)'"
                                    @click.stop="updateSatisfaction(entry, 1)">
                                    👍
                                </span>
                                <span class="pointerClass fs-4"
                                    :style="entry.satisfaction === 2 ? '' : 'opacity: 0.3; filter: grayscale(1)'"
                                    @click.stop="updateSatisfaction(entry, 2)">
                                    ✊
                                </span>
                                <span class="pointerClass fs-4"
                                    :style="entry.satisfaction === 0 ? '' : 'opacity: 0.3; filter: grayscale(1)'"
                                    @click.stop="updateSatisfaction(entry, 0)">
                                    👎
                                </span>
                            </div>
                        </div>
                    </div><!-- /closing-eval-edit -->

                    <!-- Actions -->
                    <div class="d-flex justify-content-end gap-2 mt-2">
                        <button class="btn btn-outline-secondary btn-sm" @click.stop="cancelEdit(entry.tradeId)">
                            {{ t('common.cancel') }}
                        </button>
                        <button class="btn btn-success btn-sm" @click.stop="saveEntry(entry)"
                            :disabled="savingId === entry.tradeId">
                            <span v-if="savingId === entry.tradeId">
                                <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                            </span>
                            <span v-else><i class="uil uil-check me-1"></i></span>
                            {{ t('common.save') }}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <SpinnerLoadingPage />

        <!-- Fullscreen screenshot overlay -->
        <div v-if="fullscreenImg" class="pb-fullscreen-overlay" @click="closeFullscreen">
            <img :src="fullscreenImg" class="pb-fullscreen-img" @click.stop />
            <div class="pb-fullscreen-toolbar" @click.stop>
                <button class="btn btn-sm btn-outline-light" @click="closeFullscreen" :title="t('common.close')">
                    <i class="uil uil-times"></i>
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.pb-view-opening {
    background: var(--black-bg-3, #1a1a2e);
    border: 1px solid var(--white-10, rgba(255,255,255,0.06));
    border-left: 3px solid var(--green-color, #10b981);
    border-radius: var(--border-radius, 6px);
}
.pb-view-trading-meta {
    background: var(--black-bg-3, #1a1a2e);
    border: 1px solid var(--white-10, rgba(255,255,255,0.06));
    border-left: 3px solid var(--grey-color, #6b7280);
    border-radius: var(--border-radius, 6px);
}
.pb-view-trading-meta .table {
    margin-bottom: 0;
}
.pb-view-trading-meta .table td {
    padding: 0.15rem 0.3rem;
    vertical-align: middle;
    border: none;
}
.pb-view-closing {
    background: var(--black-bg-3, #1a1a2e);
    border: 1px solid var(--white-10, rgba(255,255,255,0.06));
    border-left: 3px solid var(--blue-color, #3b82f6);
    border-radius: var(--border-radius, 6px);
}
.pb-edit-opening {
    background: var(--black-bg-3, #1a1a2e);
    border: 1px solid var(--white-10, rgba(255,255,255,0.06));
    border-left: 3px solid var(--green-color, #10b981);
    border-radius: var(--border-radius, 6px);
}
.pb-edit-closing {
    background: var(--black-bg-3, #1a1a2e);
    border: 1px solid var(--white-10, rgba(255,255,255,0.06));
    border-left: 3px solid var(--blue-color, #3b82f6);
    border-radius: var(--border-radius, 6px);
}
.pb-thumbnail-sm {
    width: 80px;
    height: 50px;
    object-fit: cover;
    border-radius: 4px;
    border: 1px solid var(--white-10, rgba(255,255,255,0.1));
}
.pb-screenshot-view {
    max-height: 200px;
    max-width: 100%;
    object-fit: contain;
    border-radius: var(--border-radius, 6px);
    border: 1px solid var(--white-10, rgba(255,255,255,0.1));
}
.pb-fullscreen-toolbar {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 10000;
    display: flex;
    align-items: center;
}
</style>
