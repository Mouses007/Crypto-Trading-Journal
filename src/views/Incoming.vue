<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import NoData from '../components/NoData.vue'
import { spinnerLoadingPage, incomingPositions, incomingPollingActive, incomingLastFetched, availableTags, allTradeTimeframes, selectedTradeTimeframes } from '../stores/globals'
import { useFetchOpenPositions, useGetIncomingPositions, useUpdateIncomingPosition, useDeleteIncomingPosition, useTransferClosingMetadata } from '../utils/incoming'
import { useGetAvailableTags, useGetTagInfo } from '../utils/daily.js'
import { dbCreate, dbUpdate } from '../utils/db.js'
import dayjs from 'dayjs'
import Quill from 'quill'

let pollingInterval = null
const expandedId = ref(null)
const quillInstances = {}
const incomingError = ref(null)
const savingId = ref(null)

// Screenshot upload state
const screenshotPreviews = ref({}) // positionId → base64 preview

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
    // Close current: clean up Quill instance (v-if destroys the DOM)
    if (expandedId.value && expandedId.value !== positionId) {
        delete quillInstances[expandedId.value]
    }

    if (expandedId.value === positionId) {
        delete quillInstances[positionId]
        expandedId.value = null
        return
    }

    expandedId.value = positionId

    // Initialize Quill for this position after DOM renders
    await nextTick()
    const editorEl = document.getElementById('quillIncoming-' + positionId)
    if (editorEl && !quillInstances[positionId]) {
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
        quillInstances[positionId] = quill

        // Load existing playbook content
        const pos = incomingPositions.find(p => p.positionId === positionId)
        if (pos && pos.playbook) {
            quill.root.innerHTML = pos.playbook
        }
    }
}

function updateStress(pos, level) {
    // Toggle: clicking same level resets to 0
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

function addTag(pos, tag) {
    if (!pos.tags) pos.tags = []
    // Don't add duplicate
    if (pos.tags.some(t => t.id === tag.id)) return
    pos.tags.push({ id: tag.id, name: tag.name })
}

function removeTag(pos, idx, groupName) {
    if (!pos.tags) return
    if (groupName) {
        const groupTags = getTagsForGroup(pos, groupName)
        if (idx >= 0 && idx < groupTags.length) {
            const tagToRemove = groupTags[idx]
            const realIdx = pos.tags.findIndex(t => t.id === tagToRemove.id)
            if (realIdx !== -1) pos.tags.splice(realIdx, 1)
        }
    } else {
        pos.tags.splice(idx, 1)
    }
}

function getTagsForGroup(pos, groupName) {
    return (pos.tags || []).filter(t => {
        const info = useGetTagInfo(t.id)
        return info?.tagGroupName === groupName
    })
}

function getStrategieTags() {
    const group = availableTags.find(g => g.name === 'Strategie')
    return group ? group.tags : []
}

function getTradeAbschlussTags() {
    const group = availableTags.find(g => g.name === 'Trade Abschluss')
    return group ? group.tags : []
}

function updateSatisfaction(pos, val) {
    pos.satisfaction = pos.satisfaction === val ? null : val
}

function getTagColor(tagId) {
    const info = useGetTagInfo(tagId)
    return info?.groupColor || '#6c757d'
}

async function saveMetadata(pos) {
    savingId.value = pos.objectId
    const data = {
        feelings: pos.feelings || '',
        stressLevel: pos.stressLevel || 0,
        emotionLevel: pos.emotionLevel || 0,
        entryTimeframe: pos.entryTimeframe || '',
        tags: pos.tags || [],
        closingNote: pos.closingNote || '',
        satisfaction: pos.satisfaction === true ? 1 : pos.satisfaction === false ? 0 : (pos.satisfaction ?? -1),
        skipEvaluation: pos.skipEvaluation || 0,
    }

    // Get Quill content
    if (quillInstances[pos.positionId]) {
        data.playbook = quillInstances[pos.positionId].root.innerHTML
    }

    await useUpdateIncomingPosition(pos.objectId, data)
    savingId.value = null

    // Save Quill content to pos and collapse card
    if (data.playbook) {
        pos.playbook = data.playbook
    }
    delete quillInstances[pos.positionId]
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
        closingNote: pos.closingNote || '',
        satisfaction: pos.satisfaction === true ? 1 : pos.satisfaction === false ? 0 : (pos.satisfaction ?? -1),
    }
    if (quillInstances[pos.positionId]) {
        data.playbook = quillInstances[pos.positionId].root.innerHTML
        pos.playbook = data.playbook
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
            closingNote: pos.closingNote || '',
        }
    )

    // Remove from local list
    const idx = incomingPositions.findIndex(p => p.objectId === pos.objectId)
    if (idx !== -1) {
        incomingPositions.splice(idx, 1)
    }

    delete quillInstances[pos.positionId]
    expandedId.value = null
    closingId.value = null
}

async function handleScreenshotUpload(event, pos) {
    const file = event.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onloadend = async () => {
        const base64 = reader.result

        // Create screenshot in DB
        const screenshot = await dbCreate('screenshots', {
            name: `incoming_${pos.positionId}`,
            symbol: pos.symbol,
            side: pos.side === 'LONG' ? 'B' : 'SS',
            originalBase64: base64,
            annotatedBase64: '',
            markersOnly: 1,
            maState: {},
            dateUnix: dayjs().unix(),
            dateUnixDay: dayjs().utc().startOf('day').unix()
        })

        // Link screenshot to position
        await useUpdateIncomingPosition(pos.objectId, { screenshotId: screenshot.objectId })
        pos.screenshotId = screenshot.objectId

        // Store preview
        screenshotPreviews.value[pos.positionId] = base64
    }
    reader.readAsDataURL(file)
}

async function removeScreenshot(pos) {
    if (pos.screenshotId) {
        await useUpdateIncomingPosition(pos.objectId, { screenshotId: '' })
        pos.screenshotId = ''
        delete screenshotPreviews.value[pos.positionId]
    }
}

function formatCurrency(val) {
    const num = parseFloat(val || 0)
    return (num >= 0 ? '+' : '') + num.toFixed(2) + ' USDT'
}

function formatTime(date) {
    if (!date) return ''
    return dayjs(date).format('HH:mm:ss')
}

function getPositionDate(pos) {
    // Try bitunixData.ctime first (ms timestamp from API)
    const ctime = pos.bitunixData?.ctime
    if (ctime) {
        return dayjs(parseInt(ctime)).format('DD.MM.YYYY')
    }
    // Fallback to DB createdAt
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
                    <h5 class="mb-0">Offene Positionen</h5>
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
                            <span class="stress-number">{{ n }}</span>●
                        </span>
                        <span v-if="n < 10" class="stress-dot stress-spacer" :class="n <= pos.stressLevel ? 'active' : 'inactive'">
                            <span class="stress-number">&nbsp;</span>●
                        </span>
                    </template>
                </div>

                <!-- Expanded detail section -->
                <div v-if="expandedId === pos.positionId" class="mt-2 incoming-meta-section">

                    <!-- ===== ERÖFFNUNGSBEWERTUNG ===== -->
                    <p class="pb-edit-label fw-bold mb-2" style="color: var(--white-80); font-size: 0.95rem; border-bottom: 1px solid var(--white-10);">Eröffnungsbewertung</p>

                    <!-- Stress Level -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Stresslevel</label>
                        <div class="d-flex align-items-end flex-wrap">
                            <template v-for="n in 10" :key="n">
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

                    <!-- Tags Strategie -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Tags</label>
                        <div class="d-flex flex-wrap align-items-center gap-1 mb-1">
                            <span v-for="(tag, idx) in getTagsForGroup(pos, 'Strategie')" :key="tag.id"
                                class="badge me-1 pointerClass"
                                :style="{ backgroundColor: getTagColor(tag.id) }"
                                @click.stop="removeTag(pos, idx, 'Strategie')">
                                {{ tag.name }} <span class="ms-1">&times;</span>
                            </span>
                        </div>
                        <select class="form-select form-select-sm"
                            @change.stop="addTag(pos, JSON.parse($event.target.value)); $event.target.selectedIndex = 0">
                            <option selected disabled>Tag hinzufügen...</option>
                            <option v-for="tag in getStrategieTags()" :key="tag.id"
                                :value="JSON.stringify({ id: tag.id, name: tag.name })"
                                :disabled="(pos.tags || []).some(t => t.id === tag.id)">
                                {{ tag.name }}
                            </option>
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
                            <template v-for="n in 10" :key="'emo'+n">
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

                    <!-- Gefühle -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Emotionen</label>
                        <textarea class="form-control form-control-sm" v-model="pos.feelings"
                            placeholder="Wie fühlst du dich bei diesem Trade?" rows="2"></textarea>
                    </div>

                    <!-- Playbook Notiz -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Notiz</label>
                        <div :id="'quillIncoming-' + pos.positionId" class="quill-incoming"></div>
                    </div>

                    <!-- ===== ABSCHLUSSBEWERTUNG ===== -->
                    <p class="pb-edit-label fw-bold mb-2 mt-3" style="color: var(--white-80); font-size: 0.95rem; border-bottom: 1px solid var(--white-10);">Abschlussbewertung</p>

                    <!-- Zufriedenheit -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Zufriedenheit</label>
                        <div class="d-flex gap-3">
                            <span class="pointerClass fs-4"
                                :class="pos.satisfaction === true || pos.satisfaction === 1 ? 'greenTrade' : 'text-muted'"
                                @click.stop="updateSatisfaction(pos, true)">
                                <i class="uil uil-thumbs-up"></i>
                            </span>
                            <span class="pointerClass fs-4"
                                :class="pos.satisfaction === false || pos.satisfaction === 0 ? 'redTrade' : 'text-muted'"
                                @click.stop="updateSatisfaction(pos, false)">
                                <i class="uil uil-thumbs-down"></i>
                            </span>
                        </div>
                    </div>

                    <!-- Trade Abschluss Tags -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Trade Abschluss</label>
                        <div class="d-flex flex-wrap align-items-center gap-1 mb-1">
                            <span v-for="(tag, idx) in getTagsForGroup(pos, 'Trade Abschluss')" :key="tag.id"
                                class="badge me-1 pointerClass"
                                :style="{ backgroundColor: getTagColor(tag.id) }"
                                @click.stop="removeTag(pos, idx, 'Trade Abschluss')">
                                {{ tag.name }} <span class="ms-1">&times;</span>
                            </span>
                        </div>
                        <select class="form-select form-select-sm"
                            @change.stop="addTag(pos, JSON.parse($event.target.value)); $event.target.selectedIndex = 0">
                            <option selected disabled>Tag hinzufügen...</option>
                            <option v-for="tag in getTradeAbschlussTags()" :key="tag.id"
                                :value="JSON.stringify({ id: tag.id, name: tag.name })"
                                :disabled="(pos.tags || []).some(t => t.id === tag.id)">
                                {{ tag.name }}
                            </option>
                        </select>
                    </div>

                    <!-- Abschlussnotiz -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Abschlussnotiz</label>
                        <textarea class="form-control form-control-sm" v-model="pos.closingNote"
                            placeholder="Notizen zum Trade-Abschluss..." rows="2"></textarea>
                    </div>

                    <!-- Screenshot -->
                    <div class="pb-edit-section">
                        <label class="pb-edit-label">Screenshot</label>
                        <div v-if="pos.screenshotId">
                            <img v-if="screenshotPreviews[pos.positionId]"
                                :src="screenshotPreviews[pos.positionId]"
                                class="img-fluid rounded mb-1" style="max-height: 200px;" />
                            <span v-else class="badge bg-success">Screenshot verknüpft</span>
                            <button class="btn btn-sm btn-outline-danger ms-2" @click.stop="removeScreenshot(pos)">
                                <i class="uil uil-times"></i> Entfernen
                            </button>
                        </div>
                        <input v-else type="file" accept="image/*" class="form-control form-control-sm"
                            @change="handleScreenshotUpload($event, pos)" />
                    </div>

                    <!-- Save / Complete buttons -->
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
