<script setup>
/**
 * Strategie im Gespräch bauen.
 *
 * Man legt eine Regelbeschreibung, Chartbilder oder ein PDF hinein und bekommt
 * eine fertige Strategie zurück — nicht mehr nur eine Beschreibung, aus der
 * jemand Code bauen müsste, sondern eine, die sofort backtestbar ist.
 *
 * Was dabei NICHT passiert: es wird kein Code erzeugt und keiner ausgeführt.
 * Das Modell füllt eine Beschreibung aus einem festen Vokabular aus, die der
 * Interpreter ausführt. Alles läuft durch dieselbe Prüfung wie eine von Hand
 * gebaute Strategie — der Grund steht in `server/rule-builder.js`.
 */
import { ref, computed, onBeforeMount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { spinnerLoadingPage } from '../stores/ui.js'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import { logError } from '../utils/logger.js'
import { apiFehlerText } from '../utils/apiError.js'

const { t } = useI18n()
const router = useRouter()

const faehigkeiten = ref({ provider: '', model: '', pdf: false, image: false })
const entwuerfe = ref([])
const aktuellerEntwurf = ref(null)
const verlauf = ref([])
const eingabe = ref('')
const anhaenge = ref([])
const laeuft = ref(false)
const fehler = ref('')
const regeln = ref(null)
const offeneFragen = ref([])
const nichtUmsetzbar = ref([])
const pruefFehler = ref([])
const versuche = ref(0)
const kosten = ref(0)
const gespeichert = ref(null)

const MAX_BYTES = 8 * 1024 * 1024

const erlaubteTypen = computed(() => {
    const x = ['.txt', '.md', '.json', '.csv']
    if (faehigkeiten.value.image) x.push('image/png', 'image/jpeg', 'image/webp')
    if (faehigkeiten.value.pdf) x.push('.pdf')
    return x.join(',')
})

/** Kurzbeschreibung eines Bausteins fürs Auge — die Rohform ist unlesbar. */
function alsText(o) {
    if (!o) return '–'
    if (typeof o !== 'object') return String(o)
    if (o.param !== undefined) return `⟨${o.param}⟩`
    if (o.value !== undefined) return String(o.value)
    return JSON.stringify(o)
}

const bedingungText = (b) => {
    const op = t('strategies.op_' + b.op)
    if (['isBullish', 'isBearish', 'higherThanPrevSignal', 'lowerThanPrevSignal'].includes(b.op)) return op
    const wert = b.value !== undefined ? ` ${alsText(b.value)}` : ''
    return `${alsText(b.left)} ${op} ${alsText(b.right)}${wert}`
}

async function laden() {
    try {
        const [f, d] = await Promise.all([
            axios.get('/api/strategies/builder/capabilities'),
            axios.get('/api/strategies/builder/drafts'),
        ])
        faehigkeiten.value = f.data
        entwuerfe.value = d.data
    } catch (e) {
        logError('AgentBuilder', 'Laden fehlgeschlagen', e)
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    }
}

onBeforeMount(async () => {
    spinnerLoadingPage.value = true
    await laden()
    spinnerLoadingPage.value = false
})

/** Datei → base64 (ohne den `data:`-Präfix, den die Anbieter nicht wollen). */
function alsBase64(datei) {
    return new Promise((resolve, reject) => {
        const leser = new FileReader()
        leser.onload = () => resolve(String(leser.result).split(',')[1] || '')
        leser.onerror = reject
        leser.readAsDataURL(datei)
    })
}

async function dateienGewaehlt(ereignis) {
    fehler.value = ''
    for (const datei of [...ereignis.target.files].slice(0, 10)) {
        if (datei.size > MAX_BYTES) {
            fehler.value = t('strategies.fileTooBig', { name: datei.name })
            continue
        }
        const typ = datei.type || ''
        if (typ === 'application/pdf' && !faehigkeiten.value.pdf) {
            fehler.value = t('strategies.pdfUnsupported', { provider: faehigkeiten.value.provider })
            continue
        }
        if (typ.startsWith('image/') && !faehigkeiten.value.image) {
            fehler.value = t('strategies.imageUnsupported', { provider: faehigkeiten.value.provider })
            continue
        }
        anhaenge.value.push({
            name: datei.name,
            mediaType: typ || 'text/plain',
            groesse: datei.size,
            base64: await alsBase64(datei),
        })
    }
    ereignis.target.value = ''
}

const anhangWeg = (i) => anhaenge.value.splice(i, 1)
const kb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' kB')

async function senden() {
    if (laeuft.value) return
    if (!eingabe.value.trim() && !anhaenge.value.length) return
    laeuft.value = true
    fehler.value = ''
    gespeichert.value = null

    const eigene = eingabe.value.trim() || `[${anhaenge.value.map((a) => a.name).join(', ')}]`
    verlauf.value.push({ role: 'user', content: eigene })
    await nextTick()

    try {
        const r = await axios.post('/api/strategies/builder/rules/chat', {
            draftId: aktuellerEntwurf.value?.id || 0,
            message: eingabe.value.trim(),
            attachments: anhaenge.value.map((a) => ({
                name: a.name, mediaType: a.mediaType, base64: a.base64,
            })),
        })
        eingabe.value = ''
        anhaenge.value = []
        verlauf.value.push({ role: 'assistant', content: r.data.antwort })
        offeneFragen.value = r.data.offeneFragen || []
        nichtUmsetzbar.value = r.data.nichtUmsetzbar || []
        pruefFehler.value = r.data.fehler || []
        versuche.value = r.data.versuche || 0
        if (r.data.regeln) regeln.value = r.data.regeln
        kosten.value += r.data.costUsd || 0
        await laden()
        aktuellerEntwurf.value = entwuerfe.value.find((d) => d.id === r.data.draftId) || null
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.builderFailed'), t)
        verlauf.value.pop()
        eingabe.value = eigene
    } finally {
        laeuft.value = false
    }
}

function entwurfOeffnen(d) {
    aktuellerEntwurf.value = d
    verlauf.value = d.messages || []
    regeln.value = d.spec || null
    offeneFragen.value = []
    nichtUmsetzbar.value = []
    pruefFehler.value = []
    gespeichert.value = null
}

function neuerEntwurf() {
    aktuellerEntwurf.value = null
    verlauf.value = []
    regeln.value = null
    offeneFragen.value = []
    nichtUmsetzbar.value = []
    pruefFehler.value = []
    gespeichert.value = null
    anhaenge.value = []
}

async function uebernehmen() {
    try {
        const r = await axios.post(`/api/strategies/builder/rules/${aktuellerEntwurf.value.id}/save`)
        gespeichert.value = r.data
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    }
}

const loeschFrage = ref(null)
async function entwurfLoeschen(d) {
    try {
        await axios.delete(`/api/strategies/builder/drafts/${d.id}`)
        loeschFrage.value = null
        if (aktuellerEntwurf.value?.id === d.id) neuerEntwurf()
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}
</script>

<template>
    <SpinnerLoadingPage />
    <div v-show="!spinnerLoadingPage" class="row mt-3 ps-3 pe-3">
        <div class="col-12 col-xl-11">

            <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
                <h5 class="mb-0 me-auto">{{ t('strategies.builderTitle') }}</h5>
                <span class="badge bg-dark">{{ faehigkeiten.provider }} · {{ faehigkeiten.model }}</span>
                <span v-if="kosten > 0" class="badge bg-secondary">${{ kosten.toFixed(4) }}</span>
                <button type="button" class="ctl-pill accent" @click="neuerEntwurf">
                    <i class="uil uil-plus me-1"></i>{{ t('strategies.newDraft') }}
                </button>
            </div>

            <div class="alert alert-secondary py-2 small">
                <i class="uil uil-shield-check me-1"></i>{{ t('strategies.builderSafety') }}
            </div>
            <div v-if="fehler" class="alert alert-danger py-2">{{ fehler }}</div>

            <div class="row g-3">
                <!-- ══ Gespräch ══ -->
                <div class="col-12 col-lg-7">
                    <div class="dailyCard p-3">
                        <div class="section-title mb-2">{{ t('strategies.conversation') }}</div>

                        <div v-if="!verlauf.length" class="text-muted small mb-3">
                            {{ t('strategies.builderIntro') }}
                        </div>

                        <div class="chat-messages" style="max-height: 42vh; overflow-y: auto;">
                            <div v-for="(m, i) in verlauf" :key="i"
                                :class="['chat-bubble', m.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai']">
                                {{ m.content }}
                            </div>
                            <div v-if="laeuft" class="chat-bubble chat-bubble-ai">
                                <span class="spinner-border spinner-border-sm me-2"></span>{{ t('strategies.reading') }}
                            </div>
                        </div>

                        <div v-if="offeneFragen.length" class="mt-2 p-2 border rounded">
                            <div class="small fw-bold mb-1">
                                <i class="uil uil-question-circle me-1"></i>{{ t('strategies.openQuestions') }}
                            </div>
                            <ul class="mb-0 ps-3 small">
                                <li v-for="(f, i) in offeneFragen" :key="i">{{ f }}</li>
                            </ul>
                        </div>

                        <!-- Was das Vokabular nicht abbildet — bewusst prominent -->
                        <div v-if="nichtUmsetzbar.length" class="alert alert-warning py-2 small mt-2 mb-0">
                            <strong>{{ t('strategies.notExpressible') }}</strong>
                            <ul class="mb-0 ps-3">
                                <li v-for="(f, i) in nichtUmsetzbar" :key="i">{{ f }}</li>
                            </ul>
                        </div>

                        <div v-if="pruefFehler.length" class="alert alert-danger py-2 small mt-2 mb-0">
                            <strong>{{ t('strategies.rejectedAfterRetries') }}</strong>
                            <ul class="mb-0 ps-3">
                                <li v-for="(f, i) in pruefFehler" :key="i">{{ f }}</li>
                            </ul>
                        </div>

                        <div v-if="anhaenge.length" class="mt-2">
                            <span v-for="(a, i) in anhaenge" :key="i"
                                class="badge bg-dark me-1 mb-1 pointerClass" @click="anhangWeg(i)">
                                <i class="uil uil-paperclip me-1"></i>{{ a.name }} ({{ kb(a.groesse) }})
                                <i class="uil uil-times ms-1"></i>
                            </span>
                        </div>

                        <div class="d-flex gap-2 mt-2">
                            <label class="btn btn-sm btn-outline-secondary mb-0" :title="t('strategies.attach')">
                                <i class="uil uil-paperclip"></i>
                                <input type="file" multiple :accept="erlaubteTypen" class="d-none"
                                    @change="dateienGewaehlt" />
                            </label>
                            <textarea v-model="eingabe" class="form-control chat-input" rows="2"
                                :placeholder="t('strategies.rulesPlaceholder')"
                                @keydown.enter.exact.prevent="senden"></textarea>
                            <button class="btn btn-sm btn-success" :disabled="laeuft" @click="senden">
                                <i class="uil uil-message"></i>
                            </button>
                        </div>
                        <small class="text-muted">
                            {{ t('strategies.acceptedFiles') }}:
                            {{ t('strategies.text') }}<template v-if="faehigkeiten.image">, {{ t('strategies.images') }}</template>
                            <template v-if="faehigkeiten.pdf">, PDF</template>
                            <template v-else> — {{ t('strategies.noPdfHere', { provider: faehigkeiten.provider }) }}</template>
                        </small>
                    </div>
                </div>

                <!-- ══ Erkannte Strategie ══ -->
                <div class="col-12 col-lg-5">
                    <div class="dailyCard p-3">
                        <div class="section-title mb-2">{{ t('strategies.recognisedStrategy') }}</div>

                        <div v-if="!regeln" class="text-muted small">{{ t('strategies.noRulesYet') }}</div>

                        <template v-else>
                            <p class="mb-1"><strong>{{ regeln.name }}</strong>
                                <span class="text-muted small ms-1">{{ regeln.id }}</span></p>
                            <div class="mb-2">
                                <span class="badge me-1"
                                    :class="regeln.direction === 'long' ? 'bg-success' : 'bg-danger'">
                                    {{ regeln.direction === 'long' ? 'LONG' : 'SHORT' }}
                                </span>
                                <span v-for="tf in regeln.timeframes" :key="tf" class="badge bg-dark me-1">{{ tf }}</span>
                                <span v-if="versuche > 1" class="badge bg-secondary"
                                    :title="t('strategies.retriesHint')">{{ versuche }}×</span>
                            </div>

                            <div style="max-height: 34vh; overflow-y: auto;">
                                <div class="mini-title">{{ t('strategies.blockIndicators') }}</div>
                                <div v-for="ind in regeln.indicators" :key="ind.id" class="mini-row">
                                    <span class="mono">{{ ind.id }}</span> = {{ ind.type.toUpperCase() }}
                                    <template v-if="ind.anchor"> ({{ t('strategies.vwapAnchor' + (ind.anchor === 'session' ? 'Session' : 'Rolling')) }})</template>
                                    <template v-else> {{ alsText(ind.period) }}</template>
                                </div>

                                <div class="mini-title">{{ t('strategies.blockSignal') }}</div>
                                <div class="mini-row">{{ t('strategies.signal_' + regeln.signal.type) }}</div>

                                <template v-if="regeln.signalFilters.length">
                                    <div class="mini-title">{{ t('strategies.blockFilters') }}</div>
                                    <div v-for="(b, i) in regeln.signalFilters" :key="i" class="mini-row">
                                        {{ bedingungText(b) }}
                                    </div>
                                </template>

                                <div class="mini-title">{{ t('strategies.blockEntry') }}</div>
                                <div class="mini-row">
                                    {{ t('strategies.entry_' + regeln.entry.type) }}
                                    <template v-if="regeln.entry.anchor"> — {{ regeln.entry.anchor }}</template>
                                </div>

                                <div class="mini-title">{{ t('strategies.blockInvalidations') }}</div>
                                <div v-for="(v, i) in regeln.invalidations" :key="i" class="mini-row">
                                    <span class="mono">{{ v.code }}</span>:
                                    <template v-if="v.type === 'timeout'">
                                        {{ t('strategies.afterCandles', { n: alsText(v.candles) }) }}
                                    </template>
                                    <template v-else>{{ bedingungText(v.when) }}</template>
                                </div>

                                <div class="mini-title">{{ t('strategies.blockExit') }}</div>
                                <div class="mini-row">
                                    {{ t('strategies.stop') }}: {{ regeln.stopLoss.anchor }}
                                    ± {{ alsText(regeln.stopLoss.offsetPct) }} %
                                </div>
                                <div class="mini-row">
                                    {{ t('strategies.target') }}: {{ t('strategies.tp_' + regeln.takeProfit.mode) }}
                                    <template v-if="regeln.takeProfit.rr"> {{ alsText(regeln.takeProfit.rr) }} R</template>
                                    <template v-if="regeln.takeProfit.anchor"> {{ regeln.takeProfit.anchor }}</template>
                                </div>

                                <div class="mini-title">
                                    {{ t('strategies.paramsFound', { n: regeln.params.length }) }}
                                </div>
                                <table class="table table-sm table-borderless mb-0">
                                    <tbody>
                                        <tr v-for="p in regeln.params" :key="p.key">
                                            <td class="small">{{ p.label || p.key }}</td>
                                            <td class="text-end small text-muted">{{ p.default }}</td>
                                            <td class="text-end small text-muted" style="width: 5rem;">
                                                <template v-if="p.min !== undefined">{{ p.min }}–{{ p.max }}</template>
                                                <template v-else>{{ p.type }}</template>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <button class="btn btn-sm btn-success mt-3" :disabled="!aktuellerEntwurf || gespeichert"
                                @click="uebernehmen">
                                <i class="uil uil-check me-1"></i>{{ t('strategies.takeOver') }}
                            </button>

                            <div v-if="gespeichert" class="alert alert-success py-2 mt-2 small mb-0">
                                {{ t('strategies.savedAndLoaded', { id: gespeichert.strategyId }) }}
                                <div class="mt-2 d-flex gap-2">
                                    <button class="btn btn-sm btn-outline-light py-0"
                                        @click="router.push('/agent/editor')">
                                        {{ t('strategies.openInEditor') }}
                                    </button>
                                    <button class="btn btn-sm btn-outline-light py-0"
                                        @click="router.push('/agent/lab')">
                                        {{ t('strategies.backtestNow') }}
                                    </button>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            </div>

            <!-- Entwürfe -->
            <div v-if="entwuerfe.length" class="dailyCard p-3 mt-3">
                <div class="section-title mb-2">{{ t('strategies.drafts') }}</div>
                <div class="table-responsive">
                    <table class="table table-sm table-borderless mb-0">
                        <tbody>
                            <tr v-for="d in entwuerfe" :key="d.id"
                                :class="aktuellerEntwurf?.id === d.id ? 'table-active' : ''">
                                <td class="small pointerClass" @click="entwurfOeffnen(d)">{{ d.title }}</td>
                                <td class="small text-muted">{{ d.sourceName }}</td>
                                <td class="small">
                                    <span class="badge" :class="d.status === 'generated' ? 'bg-success' : 'bg-secondary'">
                                        {{ t('strategies.draftStatus_' + d.status) }}
                                    </span>
                                </td>
                                <td class="text-end" style="white-space: nowrap;">
                                    <template v-if="loeschFrage === d.id">
                                        <button class="btn btn-sm btn-danger py-0 me-1"
                                            @click="entwurfLoeschen(d)">{{ t('common.yes') }}</button>
                                        <button class="btn btn-sm btn-outline-secondary py-0"
                                            @click="loeschFrage = null">{{ t('common.no') }}</button>
                                    </template>
                                    <button v-else class="btn btn-sm btn-outline-danger py-0"
                                        @click="loeschFrage = d.id"><i class="uil uil-trash-alt"></i></button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* `.dailyCard` setzt global height:100% — bei gestapelten Karten falsch. */
.dailyCard {
    height: auto;
}

.section-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--white-60, rgba(255, 255, 255, 0.6));
}

.mini-title {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
    margin-top: 0.7rem;
    margin-bottom: 0.15rem;
}

.mini-row {
    font-size: 0.8rem;
    padding: 0.1rem 0;
}

.mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.76rem;
}
</style>
