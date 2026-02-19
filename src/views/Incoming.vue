<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import NoData from '../components/NoData.vue'
import { spinnerLoadingPage } from '../stores/ui.js'
import { allTradeTimeframes, selectedTradeTimeframes } from '../stores/filters.js'
import { incomingPositions, incomingPollingActive, incomingLastFetched, availableTags } from '../stores/trades.js'
import { useFetchOpenPositions, useGetIncomingPositions, useUpdateIncomingPosition, useDeleteIncomingPosition, useTransferClosingMetadata } from '../utils/incoming'
import { useGetAvailableTags, useGetTagInfo } from '../utils/daily.js'
import { dbCreate, dbUpdate } from '../utils/db.js'
import dayjs from '../utils/dayjs-setup.js'
import Quill from 'quill'
import { sanitizeHtml } from '../utils/sanitize'

let pollingInterval = null
const expandedId = ref(null)
const quillInstances = {} // key: positionId_opening / positionId_closing
const incomingError = ref(null)
const savingId = ref(null)

// Screenshot upload state — separate previews for entry and closing
const entryScreenshotPreviews = ref({}) // positionId → base64
const closingScreenshotPreviews = ref({}) // positionId → base64

// Timeframes aus Settings (oder Fallback auf alle)
const timeframeOptions = computed(() => {
    if (selectedTradeTimeframes.length > 0) {
        return allTradeTimeframes.filter(tf => selectedTradeTimeframes.includes(tf.value))
    }
    return allTradeTimeframes
})

onMounted(async () => {
    spinnerLoadingPage.value = true
    incomingError.value = null

    try {
        await useGetAvailableTags()
        await useFetchOpenPositions()
    } catch (error) {
        incomingError.value = error.response?.data?.error || error.message || 'Fehler beim Laden'
    }

    spinnerLoadingPage.value = false

    // Start polling every 60 seconds
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
    } catch (error) {
        incomingError.value = error.response?.data?.error || error.message || 'Fehler beim Aktualisieren'
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

    // Initialize Quill editors after DOM renders
    await nextTick()
    initQuillEditor(positionId, 'opening')
    // Only init closing Quill if position is pending evaluation
    const pos = incomingPositions.find(p => p.positionId === positionId)
    if (pos && pos.status === 'pending_evaluation') {
        initQuillEditor(positionId, 'closing')
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
    if (!pos.tags) pos.tags = []
    if (pos.tags.some(t => t.id === tag.id)) return
    pos.tags.push({ id: tag.id, name: tag.name })
}

function removeTag(pos, idx) {
    if (!pos.tags) return
    pos.tags.splice(idx, 1)
}

function addClosingTag(pos, tag) {
    if (!pos.closingTags) pos.closingTags = []
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
        tags: pos.tags || [],
        skipEvaluation: pos.skipEvaluation || 0,
        // Closing fields
        closingStressLevel: pos.closingStressLevel || 0,
        closingEmotionLevel: pos.closingEmotionLevel || 0,
        closingFeelings: pos.closingFeelings || '',
        closingTimeframe: pos.closingTimeframe || '',
        closingTags: pos.closingTags || [],
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
    savingId.value = null

    // Save Quill content to pos and collapse card
    if (data.playbook) pos.playbook = data.playbook
    if (data.closingPlaybook) pos.closingPlaybook = data.closingPlaybook

    delete quillInstances[openingKey]
    delete quillInstances[closingKey]
    expandedId.value = null
}

const closingId = ref(null)

async function completeClosingEvaluation(pos) {
    if (!pos.historyData || pos.status !== 'pending_evaluation') return

    closingId.value = pos.objectId

    // First save any unsaved metadata
    const data = {
        feelings: pos.feelings || '',
        stressLevel: pos.stressLevel || 0,
        emotionLevel: pos.emotionLevel || 0,
        entryTimeframe: pos.entryTimeframe || '',
        tags: pos.tags || [],
        closingStressLevel: pos.closingStressLevel || 0,
        closingEmotionLevel: pos.closingEmotionLevel || 0,
        closingFeelings: pos.closingFeelings || '',
        closingTimeframe: pos.closingTimeframe || '',
        closingTags: pos.closingTags || [],
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

    // Transfer metadata to trade record and delete incoming position
    await useTransferClosingMetadata(
        pos,
        pos.historyData,
        {
            note: '',
            tags: pos.tags || [],
            satisfaction: pos.satisfaction,
            stressLevel: pos.stressLevel || 0,
            closingNote: pos.closingPlaybook || '',
            closingStressLevel: pos.closingStressLevel || 0,
            closingEmotionLevel: pos.closingEmotionLevel || 0,
            closingFeelings: pos.closingFeelings || '',
            closingTimeframe: pos.closingTimeframe || '',
            closingPlaybook: pos.closingPlaybook || '',
            closingScreenshotId: pos.closingScreenshotId || '',
            closingTags: pos.closingTags || [],
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
    closingId.value = null
}

// ===== FORMATTING =====

function formatCurrency(val) {
    const num = parseFloat(val || 0)
    return (num >= 0 ? '+' : '') + num.toFixed(2) + ' USDT'
}

function formatTime(date) {
    if (!date) return ''
    return dayjs(date).format('HH:mm:ss')
}

function getPositionDate(pos) {
    const ctime = pos.bitunixData?.ctime
    if (ctime) {
        return dayjs(parseInt(ctime)).format('DD.MM.YYYY')
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
                    <h5 class="mb-0">Pendente Trades</h5>
                    <small v-if="incomingLastFetched" class="text-muted">
                        Zuletzt aktualisiert: {{ formatTime(incomingLastFetched) }}
                        <span v-if="incomingPollingActive" class="spinner-border spinner-border-sm ms-2" role="status"></span>
                    </small>
                </div>
                <div class="col-auto">
                    <button class="btn btn-sm btn-outline-primary" @click="manualRefresh" :disabled="incomingPollingActive">
                        <i class="uil uil-sync me-1"></i>Aktualisieren
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
                        <span v-if="pos.status === 'pending_evaluation'" class="badge bg-warning text-dark ms-2">Geschlossen</span>
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
                            Einstieg: {{ parseFloat(pos.entryPrice || 0).toFixed(2) }}
                            <span v-if="pos.markPrice"> | Liq: {{ parseFloat(pos.markPrice || 0).toFixed(2) }}</span>
                            | Menge: {{ pos.quantity }}
                            <span v-if="getPositionDate(pos)"> | {{ getPositionDate(pos) }}</span>
                        </small>
                    </div>
                </div>

                <!-- Stress level indicator (always visible if set) -->
                <div v-if="pos.stressLevel > 0 && expandedId !== pos.positionId" class="mt-1">
                    <small class="incoming-info">Stress: </small>
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

                    <!-- ========== ERÖFFNUNGSBEWERTUNG ========== -->
                    <div class="opening-eval-section p-3 mb-2">
                    <div class="d-flex align-items-center mb-3">
                        <i class="uil uil-unlock-alt me-2" style="color: var(--green-color, #10b981); font-size: 1.1rem;"></i>
                        <span class="fw-bold" style="font-size: 0.95rem;">Eröffnungsbewertung</span>
                    </div>

                    <!-- Stresslevel -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Stresslevel</label>
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

                    <!-- Tags -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Tags</label>
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
                            <option selected disabled>Tag hinzufügen...</option>
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

                    <!-- Timeframe -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Timeframe</label>
                        <div class="d-flex flex-wrap gap-1">
                            <button v-for="tf in timeframeOptions" :key="tf.value"
                                class="btn btn-sm py-0 px-2"
                                :class="pos.entryTimeframe === tf.value ? 'btn-primary' : 'btn-outline-secondary'"
                                @click.stop="updateTimeframe(pos, tf.value)">
                                {{ tf.label }}
                            </button>
                        </div>
                    </div>

                    <!-- Emotionslevel -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Emotionslevel</label>
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
                        <label class="pb-edit-label">Emotionen</label>
                        <textarea class="form-control form-control-sm" v-model="pos.feelings"
                            placeholder="Wie fühlst du dich bei diesem Trade?" rows="2"></textarea>
                    </div>

                    <!-- Notiz (Quill Editor) -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Notiz</label>
                        <div :id="'quillIncoming-' + pos.positionId + '-opening'" class="quill-incoming"></div>
                    </div>

                    <!-- Eröffnungs-Screenshot -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Screenshot</label>
                        <div v-if="pos.entryScreenshotId">
                            <img v-if="entryScreenshotPreviews[pos.positionId]"
                                :src="entryScreenshotPreviews[pos.positionId]"
                                class="img-fluid rounded mb-1" style="max-height: 200px;" />
                            <span v-else class="badge bg-success">Screenshot verknüpft</span>
                            <button class="btn btn-sm btn-outline-danger ms-2" @click.stop="removeEntryScreenshot(pos)">
                                <i class="uil uil-times"></i> Entfernen
                            </button>
                        </div>
                        <input v-else type="file" accept="image/*" class="form-control form-control-sm"
                            @change="handleEntryScreenshotUpload($event, pos)" />
                    </div>

                    </div><!-- /opening-eval-section -->

                    <!-- ========== ABSCHLUSSBEWERTUNG ========== -->
                    <div v-if="pos.status === 'pending_evaluation'" class="closing-eval-section mt-3 p-3">
                        <div class="d-flex align-items-center mb-3">
                            <i class="uil uil-lock-alt me-2" style="color: var(--blue-color); font-size: 1.1rem;"></i>
                            <span class="fw-bold" style="font-size: 0.95rem;">Abschlussbewertung</span>
                        </div>

                        <!-- Tags -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">Tags</label>
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
                                <option selected disabled>Tag hinzufügen...</option>
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

                        <!-- Notiz (Quill Editor) -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">Notiz</label>
                            <div :id="'quillIncoming-' + pos.positionId + '-closing'" class="quill-incoming"></div>
                        </div>

                        <!-- Abschluss-Screenshot -->
                        <div class="pb-edit-section">
                            <label class="pb-edit-label">Screenshot</label>
                            <div v-if="pos.closingScreenshotId">
                                <img v-if="closingScreenshotPreviews[pos.positionId]"
                                    :src="closingScreenshotPreviews[pos.positionId]"
                                    class="img-fluid rounded mb-1" style="max-height: 200px;" />
                                <span v-else class="badge bg-success">Screenshot verknüpft</span>
                                <button class="btn btn-sm btn-outline-danger ms-2" @click.stop="removeClosingScreenshot(pos)">
                                    <i class="uil uil-times"></i> Entfernen
                                </button>
                            </div>
                            <input v-else type="file" accept="image/*" class="form-control form-control-sm"
                                @change="handleClosingScreenshotUpload($event, pos)" />
                        </div>
                    </div>

                    <!-- ===== SAVE / COMPLETE BUTTONS ===== -->
                    <div class="d-flex justify-content-between align-items-center mt-2">
                        <div class="d-flex align-items-center gap-3">
                            <button v-if="pos.status === 'pending_evaluation'"
                                class="btn btn-primary btn-sm"
                                @click.stop="completeClosingEvaluation(pos)"
                                :disabled="closingId === pos.objectId">
                                <span v-if="closingId === pos.objectId">
                                    <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                                </span>
                                <span v-else><i class="uil uil-check-circle me-1"></i></span>
                                Bewertung abschließen
                            </button>
                            <div class="form-check mb-0">
                                <input type="checkbox" class="form-check-input" :id="'skipEval-' + pos.positionId"
                                    v-model="pos.skipEvaluation" :true-value="1" :false-value="0"
                                    @click.stop>
                                <label class="form-check-label small text-muted" :for="'skipEval-' + pos.positionId">
                                    Trade nicht bewerten
                                </label>
                            </div>
                        </div>
                        <div>
                            <button class="btn btn-success btn-sm" @click.stop="saveMetadata(pos)" :disabled="savingId === pos.objectId">
                                <span v-if="savingId === pos.objectId">
                                    <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                                </span>
                                <span v-else><i class="uil uil-check me-1"></i></span>
                                Speichern
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
</style>
