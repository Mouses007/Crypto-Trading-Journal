<script setup>
import { ref, computed, onBeforeMount, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import NoData from '../components/NoData.vue'
import { spinnerLoadingPage } from '../stores/ui.js'
import { allTradeTimeframes, selectedTradeTimeframes, selectedBroker } from '../stores/filters.js'
import { availableTags } from '../stores/trades.js'
import { useGetAvailableTags, useGetTagInfo } from '../utils/daily.js'
import { useCreatedDateFormat } from '../utils/formatters.js'
import { dbFind, dbUpdate, dbCreate } from '../utils/db.js'
import Quill from 'quill'
import { sanitizeHtml } from '../utils/sanitize'

const route = useRoute()
const playbookEntries = ref([])
const expandedId = ref(null)
const editingId = ref(null)
const savingId = ref(null)
const quillInstances = {}
const screenshotMap = ref([]) // array of screenshot records
const fullscreenImg = ref(null) // base64 string for fullscreen modal

// Timeframes aus Settings (oder Fallback auf alle)
const timeframeOptions = computed(() => {
    if (selectedTradeTimeframes.length > 0) {
        return allTradeTimeframes.filter(tf => selectedTradeTimeframes.includes(tf.value))
    }
    return allTradeTimeframes
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
    const allNotes = await dbFind('notes', { descending: 'dateUnix', limit: 200 })
    const allSatisfactions = await dbFind('satisfactions', { limit: 500 })
    const allTags = await dbFind('tags', { limit: 500 })
    const allTrades = await dbFind('trades', { descending: 'dateUnix', limit: 200 })
    const allScreenshots = await dbFind('screenshots', {
        descending: 'dateUnix',
        limit: 500,
        exclude: ['original', 'annotated', 'maState']
    })
    screenshotMap.value = allScreenshots

    // Broker filter: only show trades matching selected exchange
    const broker = selectedBroker.value
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
        })
    }

    playbookEntries.value = entries
}

function formatSide(side) {
    if (side === 'long' || side === 'B') return 'LONG'
    if (side === 'short' || side === 'SS' || side === 'S') return 'SHORT'
    return side
}

function getTagColor(tagId) {
    const info = useGetTagInfo(tagId)
    return info?.groupColor || '#6c757d'
}

function hasData(entry) {
    return entry.entryStressLevel > 0 || entry.emotionLevel > 0 || entry.timeframe || entry.feelings ||
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
            placeholder: 'Eröffnungs-Notiz...',
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
            placeholder: 'Abschluss-Notiz...',
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
    // 1. By screenshotId field
    const byId = getScreenshotById(entry.screenshotId)
    if (byId) return byId

    const list = screenshotMap.value
    if (!list || !list.length) return null

    // 2. Match by name containing "_entry"
    let match = list.find(s => s.name && s.name.includes(entry.tradeId) && s.name.includes('_entry'))
    if (match) return match

    // 3. Exact match by name (legacy)
    match = list.find(s => s.name === entry.tradeId)
    if (match) return match

    // 4. Match by name containing tradeId prefix
    match = list.find(s => s.name && entry.tradeId && s.name.includes(entry.tradeId))
    if (match) return match

    // 5. Match by dateUnix + symbol
    if (entry.dateUnix && entry.symbol) {
        match = list.find(s =>
            s.symbol === entry.symbol &&
            (s.dateUnixDay === entry.dateUnix || s.dateUnix === entry.dateUnix)
        )
        if (match) return match
    }

    // 6. Fuzzy: dateUnixDay prefix
    if (entry.tradeId) {
        const m = entry.tradeId.match(/^t?(\d+)_/)
        if (m) {
            const prefix = m[1]
            match = list.find(s => s.name && s.name.startsWith(prefix + '_'))
            if (match) return match
            match = list.find(s => s.dateUnixDay && s.dateUnixDay.toString() === prefix)
            if (match) return match
        }
    }

    return null
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
            entryStressLevel: entry.entryStressLevel || 0,
            emotionLevel: entry.emotionLevel || 0,
            entryNote: entry.entryNote || '',
            feelings: entry.feelings || '',
            playbook: entry.playbook || '',
            timeframe: entry.timeframe || '',
            // Closing fields
            closingNote: entry.closingNote || '',
            closingStressLevel: entry.closingStressLevel || 0,
            closingEmotionLevel: entry.closingEmotionLevel || 0,
            closingFeelings: entry.closingFeelings || '',
            closingTimeframe: entry.closingTimeframe || '',
            closingPlaybook: entry.closingPlaybook || '',
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

        delete quillInstances[entry.tradeId + '_opening']
        delete quillInstances[entry.tradeId + '_closing']
        editingId.value = null
    } catch (error) {
        console.error(' -> Playbook saveEntry Fehler:', error)
    } finally {
        savingId.value = null
    }
}
</script>

<template>
    <div class="row mt-2">
        <div v-show="!spinnerLoadingPage">
            <div class="row mb-3">
                <div class="col">
                    <small class="text-muted">Trade-Bewertungen und Notizen</small>
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
                                title="Bearbeiten">
                                <i class="uil uil-pen"></i>
                            </span>
                            <span class="text-muted small">{{ useCreatedDateFormat(entry.dateUnix) }}</span>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <span v-if="entry.satisfaction === true || entry.satisfaction === 1">
                                <i class="uil uil-thumbs-up greenTrade"></i>
                            </span>
                            <span v-if="entry.satisfaction === false || entry.satisfaction === 0">
                                <i class="uil uil-thumbs-down redTrade"></i>
                            </span>
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
                            <span v-if="entry.entryStressLevel > 0" class="pb-pill">
                                Stress {{ entry.entryStressLevel }}/10
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
                    <div v-if="entry.entryStressLevel > 0 || (entry.tags && entry.tags.length > 0) || entry.timeframe || entry.emotionLevel > 0 || entry.feelings || (entry.playbook && stripHtml(entry.playbook).trim())"
                        class="pb-view-opening mb-2 p-3">
                        <div class="d-flex align-items-center mb-2">
                            <i class="uil uil-unlock-alt me-2" style="color: var(--green-color, #10b981); font-size: 1rem;"></i>
                            <span class="fw-bold small">Eröffnungsbewertung</span>
                            <!-- Entry Screenshot inline -->
                            <div v-if="getEntryScreenshot(entry)" class="ms-auto">
                                <img :src="getEntryScreenshot(entry).annotatedBase64 || getEntryScreenshot(entry).originalBase64"
                                    class="pb-thumbnail-sm pointerClass"
                                    @click.stop="openFullscreen(getEntryScreenshot(entry))"
                                    title="Eröffnungs-Screenshot vergrößern" />
                            </div>
                        </div>
                        <div class="pb-grid">
                            <div v-if="entry.entryStressLevel > 0" class="pb-field">
                                <div class="pb-label">Stresslevel</div>
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

                            <div v-if="entry.tags && entry.tags.length > 0" class="pb-field">
                                <div class="pb-label">Tags</div>
                                <div class="pb-value">
                                    <span v-for="tag in entry.tags" :key="tag.id"
                                        class="pb-pill me-1"
                                        :style="{ backgroundColor: tag.color || getTagColor(tag.id), color: '#fff' }">
                                        {{ tag.name }}
                                    </span>
                                </div>
                            </div>

                            <div v-if="entry.timeframe" class="pb-field">
                                <div class="pb-label">Timeframe</div>
                                <div class="pb-value"><span class="pb-pill">{{ entry.timeframe }}</span></div>
                            </div>

                            <div v-if="entry.emotionLevel > 0" class="pb-field">
                                <div class="pb-label">Emotionslevel</div>
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
                                <div class="pb-label">Emotionen</div>
                                <div class="pb-value pb-text">{{ entry.feelings }}</div>
                            </div>

                            <div v-if="entry.playbook && stripHtml(entry.playbook).trim()" class="pb-field pb-field-wide">
                                <div class="pb-label">Notiz</div>
                                <div class="pb-value pb-note-content" v-html="sanitizeHtml(entry.playbook)"></div>
                            </div>
                        </div>
                    </div>

                    <!-- ===== ABSCHLUSSBEWERTUNG (View) — Tags + Notiz + Screenshot ===== -->
                    <div v-if="(entry.closingTags && entry.closingTags.length > 0) || (entry.closingPlaybook && stripHtml(entry.closingPlaybook).trim()) || entry.closingNote || (entry.satisfaction !== null && entry.satisfaction !== undefined) || getClosingScreenshot(entry)"
                        class="pb-view-closing mb-2 p-3">
                        <div class="d-flex align-items-center mb-2">
                            <i class="uil uil-lock-alt me-2" style="color: var(--blue-color, #3b82f6); font-size: 1rem;"></i>
                            <span class="fw-bold small">Abschlussbewertung</span>
                            <!-- Closing Screenshot inline -->
                            <div v-if="getClosingScreenshot(entry)" class="ms-auto">
                                <img :src="getClosingScreenshot(entry).annotatedBase64 || getClosingScreenshot(entry).originalBase64"
                                    class="pb-thumbnail-sm pointerClass"
                                    @click.stop="openFullscreen(getClosingScreenshot(entry))"
                                    title="Abschluss-Screenshot vergrößern" />
                            </div>
                        </div>
                        <div class="pb-grid">
                            <div v-if="entry.closingTags && entry.closingTags.length > 0" class="pb-field">
                                <div class="pb-label">Tags</div>
                                <div class="pb-value">
                                    <span v-for="tag in entry.closingTags" :key="tag.id"
                                        class="pb-pill me-1"
                                        :style="{ backgroundColor: tag.color || getTagColor(tag.id), color: '#fff' }">
                                        {{ tag.name }}
                                    </span>
                                </div>
                            </div>

                            <div v-if="entry.closingPlaybook && stripHtml(entry.closingPlaybook).trim()" class="pb-field pb-field-wide">
                                <div class="pb-label">Notiz</div>
                                <div class="pb-value pb-note-content" v-html="sanitizeHtml(entry.closingPlaybook)"></div>
                            </div>

                            <div v-if="entry.closingNote && !(entry.closingPlaybook && stripHtml(entry.closingPlaybook).trim())" class="pb-field pb-field-wide">
                                <div class="pb-label">Abschlussnotiz (alt)</div>
                                <div class="pb-value pb-note-content" v-html="sanitizeHtml(entry.closingNote)"></div>
                            </div>

                            <div v-if="entry.satisfaction !== null && entry.satisfaction !== undefined" class="pb-field">
                                <div class="pb-label">Zufriedenheit</div>
                                <div class="pb-value">
                                    <i v-if="entry.satisfaction === true || entry.satisfaction === 1"
                                        class="uil uil-thumbs-up fs-5 greenTrade"></i>
                                    <i v-else-if="entry.satisfaction === 'neutral'"
                                        class="uil uil-thumbs-up fs-5 neutralTrade" style="transform: rotate(-90deg); display: inline-block;"></i>
                                    <i v-else class="uil uil-thumbs-down fs-5 redTrade"></i>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Empty state -->
                    <div v-if="!hasData(entry)" class="text-center py-3">
                        <small class="text-muted">Noch keine Bewertung vorhanden</small>
                        <div class="mt-2">
                            <button class="btn btn-sm btn-outline-primary" @click.stop="startEdit(entry.tradeId)">
                                <i class="uil uil-pen me-1"></i>Jetzt bewerten
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
                        <span class="fw-bold" style="font-size: 0.95rem;">Eröffnungsbewertung</span>
                    </div>

                    <!-- Stresslevel -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Stresslevel</label>
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

                    <!-- Tags -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Tags</label>
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
                            <option selected disabled>Tag hinzufügen...</option>
                            <optgroup v-for="group in availableTags" :key="group.id" :label="group.name">
                                <option v-for="tag in getGroupTags(group.id)" :key="tag.id"
                                    :value="JSON.stringify({ id: tag.id, name: tag.name })"
                                    :disabled="(entry.tags || []).some(t => t.id === tag.id)">
                                    {{ tag.name }}
                                </option>
                            </optgroup>
                        </select>
                    </div>

                    <!-- Timeframe -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Timeframe</label>
                        <div class="d-flex flex-wrap gap-1">
                            <button v-for="tf in timeframeOptions" :key="tf.value"
                                class="btn btn-sm py-0 px-2"
                                :class="entry.timeframe === tf.value ? 'btn-primary' : 'btn-outline-secondary'"
                                @click.stop="updateTimeframe(entry, tf.value)">
                                {{ tf.label }}
                            </button>
                        </div>
                    </div>

                    <!-- Emotionslevel -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Emotionslevel</label>
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
                        <label class="pb-edit-label">Emotionen</label>
                        <textarea class="form-control form-control-sm" v-model="entry.feelings"
                            placeholder="Wie fühlst du dich bei diesem Trade?" rows="2"></textarea>
                    </div>

                    <!-- Playbook Notiz -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Notiz</label>
                        <div :id="'quillPlaybook-' + entry.tradeId + '-opening'" class="quill-incoming"></div>
                    </div>

                    <!-- ===== ABSCHLUSSBEWERTUNG (Edit) ===== -->
                    </div><!-- /opening-eval-edit -->

                    <div class="pb-edit-closing p-3 mt-2">
                        <div class="d-flex align-items-center mb-3">
                            <i class="uil uil-lock-alt me-2" style="color: var(--blue-color, #3b82f6); font-size: 1.1rem;"></i>
                            <span class="fw-bold" style="font-size: 0.95rem;">Abschlussbewertung</span>
                        </div>

                        <!-- Tags (Closing) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">Tags</label>
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
                                <option selected disabled>Tag hinzufügen...</option>
                                <optgroup v-for="group in availableTags" :key="group.id" :label="group.name">
                                    <option v-for="tag in getGroupTags(group.id)" :key="tag.id"
                                        :value="JSON.stringify({ id: tag.id, name: tag.name })"
                                        :disabled="(entry.closingTags || []).some(t => t.id === tag.id)">
                                        {{ tag.name }}
                                    </option>
                                </optgroup>
                            </select>
                        </div>

                        <!-- Notiz (Closing Quill) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">Notiz</label>
                            <div :id="'quillPlaybook-' + entry.tradeId + '-closing'" class="quill-incoming"></div>
                        </div>

                        <!-- Zufriedenheit -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">Zufriedenheit</label>
                            <div class="d-flex gap-3">
                                <span class="pointerClass fs-4"
                                    :class="entry.satisfaction === true || entry.satisfaction === 1 ? 'greenTrade' : 'text-muted'"
                                    @click.stop="updateSatisfaction(entry, true)">
                                    <i class="uil uil-thumbs-up"></i>
                                </span>
                                <span class="pointerClass fs-4"
                                    :class="entry.satisfaction === 'neutral' ? 'neutralTrade' : 'text-muted'"
                                    @click.stop="updateSatisfaction(entry, 'neutral')"
                                    style="transform: rotate(-90deg); display: inline-block;">
                                    <i class="uil uil-thumbs-up"></i>
                                </span>
                                <span class="pointerClass fs-4"
                                    :class="entry.satisfaction === false || entry.satisfaction === 0 ? 'redTrade' : 'text-muted'"
                                    @click.stop="updateSatisfaction(entry, false)">
                                    <i class="uil uil-thumbs-down"></i>
                                </span>
                            </div>
                        </div>
                    </div><!-- /closing-eval-edit -->

                    <!-- Actions -->
                    <div class="d-flex justify-content-end gap-2 mt-2">
                        <button class="btn btn-outline-secondary btn-sm" @click.stop="cancelEdit(entry.tradeId)">
                            Abbrechen
                        </button>
                        <button class="btn btn-success btn-sm" @click.stop="saveEntry(entry)"
                            :disabled="savingId === entry.tradeId">
                            <span v-if="savingId === entry.tradeId">
                                <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                            </span>
                            <span v-else><i class="uil uil-check me-1"></i></span>
                            Speichern
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <SpinnerLoadingPage />

        <!-- Fullscreen screenshot overlay -->
        <div v-if="fullscreenImg" class="pb-fullscreen-overlay" @click="closeFullscreen">
            <img :src="fullscreenImg" class="pb-fullscreen-img" />
            <span class="pb-fullscreen-close">&times;</span>
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
</style>
