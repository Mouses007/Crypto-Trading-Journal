<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { useVorlagenKategorieLabel } from '../utils/formatters.js'

const { t } = useI18n()

const props = defineProps({
    trade: Object,
    visible: Boolean
})

const emit = defineEmits(['close'])

const generating = ref(false)
const generatedImage = ref(null)
const error = ref('')
const promptText = ref('')
const promptCollapsed = ref(true)
const hidePnlAmount = ref(false)
const showTags = ref(true)
const showRrr = ref(true)
const commentText = ref('')

// ====== Template state ======
const templates = ref([])
const selectedTemplateId = ref(null) // null = "Neu generieren"
// Eigenes Dropdown statt <select>: native <option>s können kein farbiges
// Long/Short-Badge tragen, nur Klartext (Browser-Grenze, kein HTML in <option>).
const hgOffen = ref(false)
const hgKnopfEl = ref(null)
const hgWahlEl = ref(null)
const selectedTemplate = computed(() =>
    templates.value.find((t) => String(t.id) === String(selectedTemplateId.value)) || null)

function hgWaehlen(id) {
    selectedTemplateId.value = id
    hgOffen.value = false
    hgKnopfEl.value?.focus()
}

// Sobald das Panel öffnet, Fokus auf die aktive (oder erste) Zeile setzen —
// sonst bliebe der Fokus auf dem Knopf stehen und Pfeiltasten liefen ins Leere.
watch(hgOffen, async (offen) => {
    if (!offen) return
    await nextTick()
    const aktiv = hgWahlEl.value?.querySelector('.hgZeile.hgAktiv') || hgWahlEl.value?.querySelector('.hgZeile')
    aktiv?.focus()
})

/** Pfeiltasten wandern zwischen den Zeilen, Escape schliesst und gibt den Fokus zurück. */
function hgWahlKeydown(event) {
    if (event.key === 'Escape') {
        hgOffen.value = false
        hgKnopfEl.value?.focus()
        return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const zeilen = [...(hgWahlEl.value?.querySelectorAll('.hgZeile') || [])]
    const idx = zeilen.indexOf(document.activeElement)
    const naechste = event.key === 'ArrowDown'
        ? zeilen[(idx + 1) % zeilen.length]
        : zeilen[(idx - 1 + zeilen.length) % zeilen.length]
    naechste?.focus()
}
const lastBackgroundBase64 = ref('') // raw BG from last generation (for saving)
const savingTemplate = ref(false)
const templateName = ref('')
const showSaveForm = ref(false)
const deletingTemplateId = ref(null)

function smartDecimals(price) {
    const p = Number(price || 0)
    if (p === 0) return '0'
    if (p >= 100) return p.toFixed(2)
    if (p >= 1) return p.toFixed(4)
    if (p >= 0.01) return p.toFixed(5)
    return p.toFixed(6)
}

// Load templates from DB
async function loadTemplates() {
    try {
        const res = await axios.get('/api/db/share_card_templates', {
            params: { sort: '-createdAt' }
        })
        // API returns rows with objectId mapping
        templates.value = (res.data.results || res.data || []).map(r => ({
            id: r.objectId || r.id,
            name: r.name,
            category: r.category || '',
            imageBase64: r.imageBase64 || '',
            createdAt: r.createdAt
        }))
    } catch (e) {
        console.warn('Could not load templates:', e.message)
        templates.value = []
    }
}

// Auto-generate prompt when trade changes
watch(() => props.trade, (trade) => {
    if (!trade) return
    generatedImage.value = null
    error.value = ''
    selectedTemplateId.value = null
    showSaveForm.value = false
    hgOffen.value = false
    lastBackgroundBase64.value = ''
    promptText.value = buildClientPrompt(trade)
}, { immediate: true })

// Load templates when modal becomes visible
watch(() => props.visible, (vis) => {
    if (vis) loadTemplates()
})

// When selecting a template, show preview instantly
watch(selectedTemplateId, async (id) => {
    if (!id) {
        // "Neu generieren" selected — clear preview, restore default prompt
        generatedImage.value = null
        lastBackgroundBase64.value = ''
        showSaveForm.value = false
        if (props.trade) promptText.value = buildClientPrompt(props.trade)
        return
    }

    // Use template — generate with saved background (no API call)
    const tpl = templates.value.find(t => String(t.id) === String(id))
    if (!tpl) return

    generating.value = true
    error.value = ''
    generatedImage.value = null
    showSaveForm.value = false

    try {
        const res = await axios.post('/api/flux/generate-from-template', {
            templateId: tpl.id,
            trade: props.trade,
            hidePnlAmount: hidePnlAmount.value,
            showTags: showTags.value,
            showRrr: showRrr.value,
            comment: commentText.value
        })
        generatedImage.value = res.data.image
        lastBackgroundBase64.value = '' // template BG already saved
    } catch (e) {
        error.value = e.response?.data?.error || e.message
    }
    generating.value = false
})

function buildClientPrompt(trade) {
    if (!trade) return ''
    const isWin = (trade.netProceeds || 0) > 0
    const animal = isWin ? 'wallstreet bull' : 'bear'
    let mood, scene
    if (isWin) {
        mood = 'triumphant, golden rim lighting, epic atmosphere, glory'
        scene = 'bipedal bull, exactly four limbs total, beautiful city landscape with dramatic sunset, golden hour light'
    } else {
        mood = 'dramatic, moody blue lighting, rain, defeated atmosphere, failure'
        scene = 'on all four legs collapsed face-first onto the ground on a rainy city rooftop at night, four-legged animal lying defeated, neon reflections on wet ground'
    }
    return `Epic digital art of a powerful ${animal} in a dramatic pose, ${scene}, ${mood}, cinematic composition, crypto trading theme, professional illustration, ultra detailed, 4k quality. Clean image without any text or watermarks.`
}

// Trade summary computed
const tradeSummary = computed(() => {
    const t = props.trade
    if (!t) return {}
    const isWin = (t.netProceeds || 0) > 0
    const dir = t.strategy === 'long' ? 'Long' : 'Short'
    const lev = t.leverage || 1
    let pnlPercent = 0
    if (t.entryPrice && t.exitPrice && t.entryPrice !== 0) {
        const priceDiff = t.strategy === 'long'
            ? (t.exitPrice - t.entryPrice) / t.entryPrice
            : (t.entryPrice - t.exitPrice) / t.entryPrice
        pnlPercent = priceDiff * lev * 100
    }
    return {
        symbol: (t.symbol || '').replace(/USDT$/, 'USDT'),
        direction: dir,
        leverage: lev > 1 ? `${lev}X` : '',
        pnlPercent: `${isWin ? '+' : ''}${pnlPercent.toFixed(2)}%`,
        pnlAmount: hidePnlAmount.value ? '••••• USDT' : `${isWin ? '+' : ''}${(t.netProceeds || 0).toFixed(2)} USDT`,
        entryPrice: smartDecimals(t.entryPrice),
        exitPrice: smartDecimals(t.exitPrice),
        tagNames: t.tagNames || [],
        rrr: t.rrr || '',
        isWin,
        isLong: t.strategy === 'long'
    }
})

/**
 * Gefilterte Vorlagen nach Ausgang, nicht nach Richtung.
 *
 * Das Motiv (Bulle triumphierend vs. Bulle am Boden im Regen, siehe
 * `buildClientPrompt`) folgt Gewinn/Verlust — ein Long-Trade kann verlieren
 * und ein Short-Trade gewinnen, die Stimmung des Bilds hat mit der Richtung
 * nichts zu tun. Vorher stand hier `long`/`short`: „Friedhof der Bullen"
 * (ein Verlust-Bild) war als `long` einsortiert und tauchte bei jedem
 * gewonnenen Long-Trade zwischen den triumphierenden Bildern auf.
 */
const filteredTemplates = computed(() => {
    const cat = tradeSummary.value.isWin ? 'win' : 'loss'
    // Show matching category + uncategorized templates
    return templates.value.filter(t => !t.category || t.category === cat)
})

async function generateShareCard() {
    generating.value = true
    error.value = ''
    generatedImage.value = null
    showSaveForm.value = false

    try {
        const tradeWithLeverage = { ...props.trade }
        const res = await axios.post('/api/flux/generate', {
            trade: tradeWithLeverage,
            prompt: promptText.value,
            hidePnlAmount: hidePnlAmount.value,
            showTags: showTags.value,
            showRrr: showRrr.value,
            comment: commentText.value
        })
        generatedImage.value = res.data.image
        // Store raw background for template saving
        lastBackgroundBase64.value = res.data.backgroundImage || ''
    } catch (e) {
        const msg = e.response?.data?.error || e.message
        error.value = msg
    }
    generating.value = false
}

// Save current background as template
async function saveAsTemplate() {
    if (!templateName.value.trim()) return
    if (!lastBackgroundBase64.value) {
        error.value = 'Kein Hintergrundbild zum Speichern vorhanden'
        return
    }

    savingTemplate.value = true
    error.value = ''

    try {
        const isWin = (props.trade?.netProceeds || 0) > 0
        await axios.post('/api/db/share_card_templates', {
            name: templateName.value.trim(),
            imageBase64: lastBackgroundBase64.value,
            category: isWin ? 'win' : 'loss'
        })
        templateName.value = ''
        showSaveForm.value = false
        await loadTemplates()
    } catch (e) {
        error.value = e.response?.data?.error || e.message
    }
    savingTemplate.value = false
}

// Delete a template
async function deleteTemplate(id) {
    if (!confirm('Vorlage wirklich löschen?')) return
    deletingTemplateId.value = id
    try {
        await axios.delete(`/api/db/share_card_templates/${id}`)
        if (String(selectedTemplateId.value) === String(id)) {
            selectedTemplateId.value = null
        }
        await loadTemplates()
    } catch (e) {
        error.value = e.response?.data?.error || e.message
    }
    deletingTemplateId.value = null
}

function downloadImage() {
    if (!generatedImage.value) return
    const symbol = (props.trade?.symbol || 'trade').replace(/[^a-zA-Z0-9]/g, '')
    const a = document.createElement('a')
    a.href = generatedImage.value
    a.download = `sharecard-${symbol}-${Date.now()}.png`
    a.click()
}

async function shareImage() {
    if (!generatedImage.value) return
    const symbol = (props.trade?.symbol || 'Trade').replace(/USDT$/, '/USDT')
    const dir = props.trade?.strategy === 'long' ? 'Long' : 'Short'
    const filename = `sharecard-${symbol.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now()}.png`

    try {
        const res = await fetch(generatedImage.value)
        const blob = await res.blob()
        const file = new File([blob], filename, { type: 'image/png' })

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                title: `Share Card: ${symbol} ${dir}`,
                text: `Meine ${symbol} ${dir} Share Card\nErstellt mit Crypto Trading Journal`,
                files: [file]
            })
        } else {
            downloadImage()
            await new Promise(r => setTimeout(r, 500))
            const subject = encodeURIComponent(`Share Card: ${symbol} ${dir}`)
            const body = encodeURIComponent(`Meine ${symbol} ${dir} Share Card.\n\n(Bild wurde heruntergeladen — bitte über "Anhängen" einfügen)\n\nErstellt mit Crypto Trading Journal`)
            window.open(`mailto:?subject=${subject}&body=${body}`, '_self')
        }
    } catch (e) {
        if (e.name !== 'AbortError') console.error('Share failed:', e)
    }
}

function closeModal() {
    generatedImage.value = null
    error.value = ''
    showSaveForm.value = false
    emit('close')
}
</script>

<template>
    <div v-if="visible" class="modal d-block" tabindex="-1" style="background: rgba(0,0,0,0.7); z-index: 1070;" @click.self="closeModal" @focusin.stop @mousedown.stop>
        <div class="modal-dialog modal-lg modal-dialog-centered">
            <div class="modal-content share-card-modal">
                <div class="modal-header border-0">
                    <h5 class="modal-title">
                        <i class="uil uil-image-share me-2"></i>{{ t('daily.shareCard') }}
                    </h5>
                    <button type="button" class="btn-close btn-close-white" @click="closeModal"></button>
                </div>
                <div class="modal-body">
                    <!-- Trade Summary -->
                    <div class="share-card-summary mb-3">
                        <div class="d-flex align-items-center gap-2 mb-2">
                            <span class="fw-bold fs-5">{{ tradeSummary.symbol }}</span>
                            <span class="badge" :class="tradeSummary.isLong ? 'bg-success' : 'bg-danger'">
                                {{ tradeSummary.direction }}
                            </span>
                            <span v-if="tradeSummary.leverage" class="badge bg-secondary">{{ tradeSummary.leverage }}</span>
                            <span v-if="tradeSummary.rrr && showRrr" class="badge" style="background: #7c3aed;">RRR 1:{{ tradeSummary.rrr }}</span>
                        </div>
                        <!-- Tags -->
                        <div v-if="tradeSummary.tagNames?.length && showTags" class="mb-2 d-flex gap-1 flex-wrap">
                            <span v-for="(tag, i) in tradeSummary.tagNames" :key="i" class="badge bg-info text-dark small">{{ tag }}</span>
                        </div>
                        <div class="d-flex gap-4 align-items-start">
                            <div>
                                <small class="text-muted">PnL</small>
                                <div class="fw-bold" :class="tradeSummary.isWin ? 'text-success' : 'text-danger'">
                                    {{ tradeSummary.pnlPercent }}
                                </div>
                                <div class="small" :class="tradeSummary.isWin ? 'text-success' : 'text-danger'">
                                    {{ tradeSummary.pnlAmount }}
                                </div>
                            </div>
                            <div>
                                <small class="text-muted">Entry</small>
                                <div>{{ tradeSummary.entryPrice }}</div>
                            </div>
                            <div>
                                <small class="text-muted">Exit</small>
                                <div>{{ tradeSummary.exitPrice }}</div>
                            </div>
                            <div v-if="tradeSummary.leverage" class="ms-auto text-center">
                                <small class="text-muted">Leverage</small>
                                <div class="fw-bold">{{ tradeSummary.leverage }}</div>
                            </div>
                        </div>
                    </div>

                    <!-- ====== TEMPLATE SELECTOR ====== -->
                    <div v-if="templates.length > 0" class="mb-3">
                        <label class="form-label small fw-bold">
                            <i class="uil uil-layers me-1"></i>Hintergrund
                        </label>
                        <div class="d-flex gap-2 align-items-center position-relative">
                            <!-- Eigenes Dropdown statt <select>: native <option>s
                                 können kein farbiges Long/Short-Badge tragen. Die
                                 Tastatursteuerung, die ein <select> kostenlos
                                 mitbringt, muss dafür von Hand nachgebaut werden
                                 (Pfeiltasten, Enter/Leertaste, Escape) — sonst ist
                                 die Auswahl für Tastatur-/Screenreader-Nutzer
                                 unerreichbar. -->
                            <button type="button" class="form-select form-select-sm text-start hgKnopf" ref="hgKnopfEl"
                                :disabled="generating" aria-haspopup="listbox" :aria-expanded="hgOffen"
                                @click="hgOffen = !hgOffen" style="max-width: 350px;">
                                <template v-if="selectedTemplate">
                                    {{ selectedTemplate.name }}
                                    <span v-if="selectedTemplate.category" class="badge ms-1"
                                          :class="selectedTemplate.category === 'win' ? 'bg-success' : 'bg-danger'">{{ useVorlagenKategorieLabel(selectedTemplate.category) }}</span>
                                </template>
                                <template v-else>Neu generieren (KI)</template>
                            </button>
                            <template v-if="hgOffen">
                                <div class="hgHinter" @click="hgOffen = false"></div>
                                <div class="hgWahl floatDropdown" role="listbox" ref="hgWahlEl" @keydown="hgWahlKeydown">
                                    <div class="hgZeile floatDropdownZeile" role="option" tabindex="0" :aria-selected="!selectedTemplateId"
                                         :class="{ hgAktiv: !selectedTemplateId }"
                                         @click="hgWaehlen(null)" @keydown.enter.prevent="hgWaehlen(null)" @keydown.space.prevent="hgWaehlen(null)">
                                        Neu generieren (KI)
                                    </div>
                                    <div v-for="tpl in filteredTemplates" :key="tpl.id" class="hgZeile floatDropdownZeile" role="option" tabindex="0"
                                         :aria-selected="String(selectedTemplateId) === String(tpl.id)"
                                         :class="{ hgAktiv: String(selectedTemplateId) === String(tpl.id) }"
                                         @click="hgWaehlen(tpl.id)" @keydown.enter.prevent="hgWaehlen(tpl.id)" @keydown.space.prevent="hgWaehlen(tpl.id)">
                                        {{ tpl.name }}
                                        <span v-if="tpl.category" class="badge ms-1"
                                              :class="tpl.category === 'win' ? 'bg-success' : 'bg-danger'">{{ useVorlagenKategorieLabel(tpl.category) }}</span>
                                    </div>
                                </div>
                            </template>
                            <button v-if="selectedTemplateId" class="btn btn-sm btn-outline-danger" @click="deleteTemplate(selectedTemplateId)"
                                :disabled="deletingTemplateId === selectedTemplateId" title="Vorlage löschen">
                                <i class="uil uil-trash-alt"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Options row -->
                    <div class="d-flex align-items-center gap-3 mb-3 flex-wrap">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="hidePnlCheck" v-model="hidePnlAmount" :disabled="generating" />
                            <label class="form-check-label small" for="hidePnlCheck">{{ t('daily.shareCardHidePrices') }}</label>
                        </div>
                        <div v-if="tradeSummary.tagNames?.length" class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="showTagsCheck" v-model="showTags" :disabled="generating" />
                            <label class="form-check-label small" for="showTagsCheck">{{ t('daily.shareCardShowTags') }}</label>
                        </div>
                        <div v-if="tradeSummary.rrr" class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="showRrrCheck" v-model="showRrr" :disabled="generating" />
                            <label class="form-check-label small" for="showRrrCheck">RRR</label>
                        </div>
                    </div>

                    <!-- Prompt (only when "Neu generieren" is selected) -->
                    <div v-if="!selectedTemplateId" class="mb-3">
                        <label class="form-label small fw-bold mb-0">
                            <i class="uil uil-pen me-1"></i>{{ t('daily.shareCardPrompt') }}
                        </label>
                        <textarea class="form-control share-card-prompt" rows="5" v-model="promptText"
                            :disabled="generating" style="resize: vertical; min-height: 100px;"></textarea>
                    </div>

                    <!-- Comment -->
                    <div class="mb-3">
                        <label class="form-label small fw-bold">
                            <i class="uil uil-comment-alt-message me-1"></i>{{ t('daily.shareCardComment') }}
                        </label>
                        <input type="text" class="form-control share-card-prompt" v-model="commentText"
                            :disabled="generating" maxlength="130" :placeholder="t('daily.shareCardCommentHint')" />
                    </div>

                    <!-- Error -->
                    <div v-if="error" class="alert alert-danger py-2 small">
                        <i class="uil uil-exclamation-triangle me-1"></i>{{ error }}
                    </div>

                    <!-- Generating spinner -->
                    <div v-if="generating" class="share-card-generating text-center py-5">
                        <div class="spinner-border text-primary mb-3" style="width: 3rem; height: 3rem;"></div>
                        <p class="text-muted">{{ t('daily.shareCardGenerating') }}</p>
                        <small class="text-muted">~10-30s</small>
                    </div>

                    <!-- Generated Image Preview -->
                    <div v-if="generatedImage && !generating" class="share-card-preview text-center">
                        <img :src="generatedImage" class="img-fluid rounded" style="max-height: 500px;" />
                    </div>

                    <!-- ====== SAVE AS TEMPLATE (after generation, only for new images) ====== -->
                    <div v-if="generatedImage && !generating && lastBackgroundBase64 && !selectedTemplateId" class="mt-3">
                        <div v-if="!showSaveForm">
                            <button class="btn btn-sm btn-outline-warning" @click="showSaveForm = true">
                                <i class="uil uil-save me-1"></i>Als Vorlage speichern
                            </button>
                        </div>
                        <div v-else class="d-flex gap-2 align-items-center">
                            <input type="text" class="form-control form-control-sm" v-model="templateName"
                                placeholder="Vorlagen-Name (z.B. Cyberpunk Bull)" style="max-width: 300px;"
                                @keyup.enter="saveAsTemplate" />
                            <button class="btn btn-sm btn-warning" @click="saveAsTemplate" :disabled="savingTemplate || !templateName.trim()">
                                <span v-if="savingTemplate" class="spinner-border spinner-border-sm me-1"></span>
                                <i v-else class="uil uil-save me-1"></i>Speichern
                            </button>
                            <button class="btn btn-sm btn-outline-secondary" @click="showSaveForm = false">
                                <i class="uil uil-times"></i>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="modal-footer border-0 d-flex justify-content-between">
                    <button class="btn btn-outline-secondary" @click="closeModal">
                        {{ t('common.close') }}
                    </button>
                    <div class="d-flex gap-2">
                        <button v-if="!selectedTemplateId" class="btn btn-primary" @click="generateShareCard" :disabled="generating">
                            <span v-if="generating">
                                <span class="spinner-border spinner-border-sm me-1"></span>
                            </span>
                            <i v-else class="uil uil-image me-1"></i>
                            {{ generating ? t('daily.shareCardGenerating') : t('daily.shareCardGenerate') }}
                        </button>
                        <button v-if="generatedImage && !generating" class="btn btn-outline-info" @click="shareImage" :title="t('daily.shareCardEmail')">
                            <i class="uil uil-share-alt"></i>
                        </button>
                        <button v-if="generatedImage && !generating" class="btn btn-success" @click="downloadImage">
                            <i class="uil uil-download-alt me-1"></i>{{ t('daily.shareCardDownload') }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* Eigenes Hintergrund-Dropdown, gleiche Machart wie `.divWahl*` in
   Settings.vue: die Modal-Box selbst hat z-index 1070, deshalb hier höher.
   Kasten- und Zeilen-Optik kommen aus den geteilten `.floatDropdown*`-Klassen
   in style-dark.css — hier nur, was an DIESER Stelle abweicht: Position und
   Grösse hängen vom umgebenden Modal ab, nicht vom Dropdown-Inhalt. */
.hgKnopf {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.hgHinter {
    position: fixed;
    inset: 0;
    z-index: 1080;
}

.hgWahl {
    position: absolute;
    z-index: 1090;
    top: calc(100% + 0.25rem);
    left: 0;
    width: 100%;
    max-width: 350px;
}

.hgZeile.hgAktiv {
    background: var(--blue-color, #4da3ff);
    color: white;
}
</style>
