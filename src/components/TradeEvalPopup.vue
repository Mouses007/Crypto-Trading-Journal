<template>
    <div class="modal fade" id="evalPopupModal" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1"
        aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content" v-if="currentEval">

                <!-- Header -->
                <div class="modal-header border-bottom-0 pb-1">
                    <h5 class="modal-title">
                        <span v-if="currentEval.type === 'opening'">
                            <i class="uil uil-arrow-growth me-2"></i>Einstiegsbewertung
                        </span>
                        <span v-else>
                            <i class="uil uil-chart me-2"></i>Ausstiegsbewertung
                        </span>
                    </h5>
                    <span class="badge bg-secondary ms-2" v-if="evaluationQueue.length > 1">
                        {{ evaluationQueue.length }} ausstehend
                    </span>
                </div>

                <!-- Body -->
                <div class="modal-body pt-1">

                    <!-- Position Info -->
                    <div class="eval-position-info mb-3">
                        <div class="d-flex align-items-center justify-content-between">
                            <div>
                                <span class="fw-bold fs-5">{{ currentEval.position?.symbol }}</span>
                                <span class="badge ms-2"
                                    :class="currentEval.position?.side === 'LONG' ? 'bg-success' : 'bg-danger'">
                                    {{ currentEval.position?.side }}
                                </span>
                                <span class="badge bg-secondary ms-1" v-if="currentEval.position?.leverage">
                                    {{ currentEval.position?.leverage }}x
                                </span>
                            </div>
                            <div class="text-end" v-if="currentEval.position?.entryPrice">
                                <small class="text-muted">Einstieg:</small>
                                <span class="ms-1">{{ formatPrice(currentEval.position?.entryPrice) }}</span>
                            </div>
                        </div>

                        <!-- Closing-specific: PnL summary -->
                        <div v-if="currentEval.type === 'closing' && currentEval.historyData" class="mt-2">
                            <div class="d-flex align-items-center justify-content-between">
                                <div>
                                    <small class="text-muted">Ausstieg:</small>
                                    <span class="ms-1">{{ formatPrice(currentEval.historyData.closePrice) }}</span>
                                </div>
                                <div>
                                    <span class="fw-bold fs-5"
                                        :class="parseFloat(currentEval.historyData.realizedPNL) >= 0 ? 'greenTrade' : 'redTrade'">
                                        {{ parseFloat(currentEval.historyData.realizedPNL) >= 0 ? '+' : '' }}{{
                                            parseFloat(currentEval.historyData.realizedPNL || 0).toFixed(2) }} USDT
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <hr class="my-2" style="border-color: var(--white-38);">

                    <!-- OPENING FORM -->
                    <div v-if="currentEval.type === 'opening'">
                        <!-- Stress Level -->
                        <div class="mb-3">
                            <label class="form-label small text-muted mb-1">Stresslevel</label>
                            <div class="d-flex align-items-end flex-wrap">
                                <template v-for="n in 10" :key="n">
                                    <span @click="toggleStress(n)"
                                        class="stress-dot pointerClass"
                                        :class="n <= formData.stressLevel ? 'active' : 'inactive'">
                                        <span class="stress-number">{{ n }}</span>&#x25CF;
                                    </span>
                                    <span v-if="n < 10" class="stress-dot stress-spacer"
                                        :class="n <= formData.stressLevel ? 'active' : 'inactive'">
                                        <span class="stress-number">&nbsp;</span>&#x25CF;
                                    </span>
                                </template>
                            </div>
                        </div>

                        <!-- Entry Reason -->
                        <div class="mb-3">
                            <label class="form-label small text-muted mb-1">Warum bist du eingestiegen?</label>
                            <textarea class="form-control" v-model="formData.entryNote" rows="3"
                                placeholder="Grund, Setup, Marktbedingungen..."></textarea>
                        </div>

                        <!-- Expandable: More details -->
                        <div class="mb-2">
                            <div class="d-flex align-items-center pointerClass" @click="openingExpanded = !openingExpanded">
                                <i class="uil me-1" :class="openingExpanded ? 'uil-angle-down' : 'uil-angle-right'"></i>
                                <small class="text-muted">Erweitert</small>
                            </div>
                            <div v-show="openingExpanded" class="mt-2">
                                <!-- Timeframe -->
                                <div class="mb-2">
                                    <label class="form-label small text-muted mb-1">Timeframe</label>
                                    <div class="d-flex flex-wrap gap-1">
                                        <button v-for="tf in timeframeOptions" :key="tf.value"
                                            class="btn btn-sm"
                                            :class="formData.entryTimeframe === tf.value ? 'btn-primary' : 'btn-outline-secondary'"
                                            @click="formData.entryTimeframe = formData.entryTimeframe === tf.value ? '' : tf.value">
                                            {{ tf.label }}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- CLOSING FORM -->
                    <div v-if="currentEval.type === 'closing'">
                        <!-- Satisfaction -->
                        <div class="mb-3">
                            <label class="form-label small text-muted mb-1">Zufriedenheit</label>
                            <div>
                                <i @click="toggleSatisfaction(true)"
                                    :class="['uil', 'uil-thumbs-up', 'fs-4', 'me-3', 'pointerClass', formData.satisfaction === true ? 'greenTrade' : '']"></i>
                                <i @click="toggleSatisfaction(false)"
                                    :class="['uil', 'uil-thumbs-down', 'fs-4', 'pointerClass', formData.satisfaction === false ? 'redTrade' : '']"></i>
                            </div>
                        </div>

                        <!-- Stress Level (Exit) -->
                        <div class="mb-3">
                            <label class="form-label small text-muted mb-1">Stresslevel (Ausstieg)</label>
                            <div class="d-flex align-items-end flex-wrap">
                                <template v-for="n in 10" :key="n">
                                    <span @click="toggleStress(n)"
                                        class="stress-dot pointerClass"
                                        :class="n <= formData.stressLevel ? 'active' : 'inactive'">
                                        <span class="stress-number">{{ n }}</span>&#x25CF;
                                    </span>
                                    <span v-if="n < 10" class="stress-dot stress-spacer"
                                        :class="n <= formData.stressLevel ? 'active' : 'inactive'">
                                        <span class="stress-number">&nbsp;</span>&#x25CF;
                                    </span>
                                </template>
                            </div>
                        </div>

                        <!-- Tags -->
                        <div class="mb-3">
                            <label class="form-label small text-muted mb-1">Tags</label>
                            <div class="d-flex flex-wrap align-items-center gap-1 mb-2">
                                <span v-for="(tag, idx) in formData.tags" :key="tag.id"
                                    class="badge me-1 pointerClass"
                                    :style="{ backgroundColor: getTagColor(tag.id) }"
                                    @click="removeTag(idx)">
                                    {{ tag.name }} <span class="ms-1">&times;</span>
                                </span>
                            </div>
                            <select class="form-select form-select-sm"
                                @change="addTag(JSON.parse($event.target.value)); $event.target.selectedIndex = 0">
                                <option selected disabled>Tag hinzufügen...</option>
                                <template v-for="group in availableTags" :key="group.id">
                                    <optgroup :label="group.name">
                                        <option v-for="tag in group.tags" :key="tag.id"
                                            :value="JSON.stringify({ id: tag.id, name: tag.name })"
                                            :disabled="formData.tags.some(t => t.id === tag.id)">
                                            {{ tag.name }}
                                        </option>
                                    </optgroup>
                                </template>
                            </select>
                        </div>

                        <!-- Personal Assessment -->
                        <div class="mb-2">
                            <label class="form-label small text-muted mb-1">Persönliche Bewertung</label>
                            <textarea class="form-control" v-model="formData.note" rows="3"
                                placeholder="Was ist gut gelaufen? Was hättest du anders gemacht?"></textarea>
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div class="modal-footer border-top-0 pt-0">
                    <button type="button" class="btn btn-outline-secondary btn-sm" @click="skipEvaluation">
                        Überspringen
                    </button>
                    <button type="button" class="btn btn-primary btn-sm" @click="saveEvaluation">
                        <i class="uil uil-check me-1"></i>Speichern
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue'
import { evaluationQueue, evaluationPopupVisible, currentEvaluation, availableTags, allTradeTimeframes, selectedTradeTimeframes } from '../stores/globals.js'
import { useUpdateIncomingPosition, useTransferClosingMetadata } from '../utils/incoming.js'
import { useGetTagInfo } from '../utils/daily.js'
import { dbUpdate, dbDelete } from '../utils/db.js'

let modalInstance = null

const currentEval = ref(null)

const openingExpanded = ref(false)

// Timeframes aus Settings (oder Fallback auf alle)
const timeframeOptions = computed(() => {
    if (selectedTradeTimeframes.length > 0) {
        return allTradeTimeframes.filter(tf => selectedTradeTimeframes.includes(tf.value))
    }
    return allTradeTimeframes
})

const formData = reactive({
    stressLevel: 0,
    entryNote: '',
    entryTimeframe: '',
    note: '',
    satisfaction: null,
    tags: [],
})

onMounted(() => {
    console.log(' -> TradeEvalPopup: onMounted, creating modalInstance')
    modalInstance = new bootstrap.Modal('#evalPopupModal')

    document.getElementById('evalPopupModal').addEventListener('hidden.bs.modal', () => {
        evaluationPopupVisible.value = false
    })

    // Check if queue already has items (e.g. from useRestorePendingEvaluations)
    console.log(' -> TradeEvalPopup: queue length at mount =', evaluationQueue.length)
    if (evaluationQueue.length > 0 && !evaluationPopupVisible.value) {
        console.log(' -> TradeEvalPopup: showing queued popup from onMounted')
        showNext()
    }
})

// Watch queue — triggers when items are added
watch(() => evaluationQueue.length, (newLen, oldLen) => {
    console.log(' -> TradeEvalPopup: watcher fired, queue length', oldLen, '->', newLen, 'visible:', evaluationPopupVisible.value, 'modalInstance:', !!modalInstance)
    if (newLen > 0 && !evaluationPopupVisible.value && modalInstance) {
        showNext()
    }
})

function showNext() {
    if (evaluationQueue.length === 0) {
        currentEval.value = null
        currentEvaluation.value = null
        if (modalInstance) modalInstance.hide()
        return
    }

    const next = evaluationQueue[0]
    currentEval.value = next
    currentEvaluation.value = next

    // Reset form
    formData.stressLevel = 0
    formData.entryNote = ''
    formData.entryTimeframe = ''
    formData.note = ''
    formData.satisfaction = null
    formData.tags = []
    openingExpanded.value = false

    // For opening: pre-fill existing data from position
    if (next.type === 'opening' && next.position?.stressLevel) {
        formData.stressLevel = next.position.stressLevel
    }
    if (next.type === 'opening' && next.position?.entryNote) {
        formData.entryNote = next.position.entryNote
    }
    if (next.type === 'opening' && next.position?.entryTimeframe) {
        formData.entryTimeframe = next.position.entryTimeframe
        openingExpanded.value = true // Show expanded if timeframe was previously set
    }

    // For closing: pre-fill tags from incoming position
    if (next.type === 'closing' && next.position?.tags && Array.isArray(next.position.tags)) {
        formData.tags = [...next.position.tags]
    }

    evaluationPopupVisible.value = true

    nextTick(() => {
        if (modalInstance) modalInstance.show()
    })
}

function toggleStress(level) {
    formData.stressLevel = formData.stressLevel === level ? 0 : level
}

function toggleSatisfaction(val) {
    formData.satisfaction = formData.satisfaction === val ? null : val
}

function getTagColor(tagId) {
    const info = useGetTagInfo(tagId)
    return info?.groupColor || '#6c757d'
}

function addTag(tag) {
    if (formData.tags.some(t => t.id === tag.id)) return
    formData.tags.push({ id: tag.id, name: tag.name })
}

function removeTag(index) {
    formData.tags.splice(index, 1)
}

function formatPrice(price) {
    if (!price) return '—'
    const p = parseFloat(price)
    if (p >= 1) return p.toFixed(2)
    if (p >= 0.01) return p.toFixed(4)
    return p.toFixed(6)
}

async function saveEvaluation() {
    const eval_ = currentEval.value
    if (!eval_) return

    try {
        if (eval_.type === 'opening') {
            // Save stress level + entry note + timeframe to incoming_positions
            await dbUpdate('incoming_positions', eval_.positionObjectId, {
                stressLevel: formData.stressLevel,
                entryNote: formData.entryNote,
                entryTimeframe: formData.entryTimeframe,
                openingEvalDone: 1
            })
        } else if (eval_.type === 'closing') {
            // Transfer all metadata to trade record, then delete incoming position
            await useTransferClosingMetadata(
                eval_.position,
                eval_.historyData,
                {
                    note: formData.note,
                    tags: formData.tags,
                    satisfaction: formData.satisfaction,
                    stressLevel: formData.stressLevel,
                    closingNote: formData.note,
                }
            )
        }
    } catch (error) {
        console.error(' -> Fehler beim Speichern der Bewertung:', error)
    }

    advanceQueue()
}

async function skipEvaluation() {
    const eval_ = currentEval.value
    if (!eval_) return

    try {
        if (eval_.type === 'opening') {
            // Mark as done without saving data
            await dbUpdate('incoming_positions', eval_.positionObjectId, {
                openingEvalDone: 1
            })
        } else if (eval_.type === 'closing') {
            // Delete incoming position without transferring popup metadata
            // But still transfer existing incoming metadata (playbook, feelings, screenshots, tags)
            // that were set before the popup
            await useTransferClosingMetadata(
                eval_.position,
                eval_.historyData,
                {
                    note: '',
                    tags: eval_.position?.tags || [],
                    satisfaction: null,
                    stressLevel: 0
                }
            )
        }
    } catch (error) {
        console.error(' -> Fehler beim Überspringen der Bewertung:', error)
    }

    advanceQueue()
}

function advanceQueue() {
    evaluationQueue.shift()

    if (evaluationQueue.length > 0) {
        // Short delay before showing next popup
        setTimeout(() => {
            showNext()
        }, 300)
    } else {
        currentEval.value = null
        currentEvaluation.value = null
        if (modalInstance) modalInstance.hide()
    }
}
</script>
