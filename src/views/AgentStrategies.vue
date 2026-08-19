<script setup>
/**
 * Strategie-Instanzen: anlegen, einstellen, starten, stoppen.
 *
 * Das Formular kennt keine einzige Strategie — es rendert das Schema, das der
 * Server im Manifest mitliefert (StrategyParamForm). Eine weitere Strategie
 * erscheint hier deshalb automatisch, sobald sie serverseitig registriert ist.
 */
import { ref, computed, onBeforeMount, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { spinnerLoadingPage } from '../stores/ui.js'
import StrategyParamForm from '../components/StrategyParamForm.vue'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import { useXDecCurrencyFormat } from '../utils/formatters.js'
import { logError } from '../utils/logger.js'
import { apiFehlerText } from '../utils/apiError.js'

const { t } = useI18n()
const router = useRouter()

const registry = ref({ strategies: [], riskParams: [], riskDefaults: {}, agentDefaults: {}, modes: [] })
const instanzen = ref([])
const engine = ref({ killSwitch: false, liveEnabled: false, running: false })
const meldung = ref('')
const fehler = ref('')
let pollTimer = null

// ── Editor ──────────────────────────────────────────────────────────────
const bearbeite = ref(null)          // null = Liste, sonst der Entwurf
const istNeu = ref(false)
const speichern = ref(false)
const symbolEingabe = ref('')

const gewaehlteStrategie = computed(
    () => registry.value.strategies.find((s) => s.id === bearbeite.value?.strategyId) || null,
)

async function laden() {
    try {
        const [reg, inst, status] = await Promise.all([
            axios.get('/api/strategies/registry'),
            axios.get('/api/strategies/instances'),
            axios.get('/api/strategies/engine/status'),
        ])
        registry.value = reg.data
        instanzen.value = inst.data
        engine.value = status.data
    } catch (e) {
        logError('AgentStrategies', 'Laden fehlgeschlagen', e)
        fehler.value = t('strategies.loadFailed')
    }
}

onBeforeMount(async () => {
    spinnerLoadingPage.value = true
    await laden()
    spinnerLoadingPage.value = false
    pollTimer = setInterval(laden, 30000)
})
onBeforeUnmount(() => { if (pollTimer) clearInterval(pollTimer) })

// ── Parameter-Verlauf ────────────────────────────────────────────────────
// Je Instanz aufklappbar: welche Version galt wann, WAS wurde geändert
// (Diff zur Vorgängerversion) und was hat sie gebracht (Trades, ΣR).
const verlaufOffen = ref(null)          // instanceId oder null
const verlaufDaten = ref([])
const verlaufLaedt = ref(false)

async function verlaufAnzeigen(inst) {
    if (verlaufOffen.value === inst.id) { verlaufOffen.value = null; return }
    verlaufOffen.value = inst.id
    verlaufLaedt.value = true
    verlaufDaten.value = []
    try {
        const r = await axios.get(`/api/strategies/instances/${inst.id}/history`)
        const zeilen = r.data
        // Diff gegen die jeweils ÄLTERE Version (Liste kommt absteigend)
        for (let i = 0; i < zeilen.length; i++) {
            const aelter = zeilen[i + 1]
            zeilen[i].diff = aelter ? parameterDiff(aelter, zeilen[i]) : []
        }
        verlaufDaten.value = zeilen
    } catch (e) {
        logError('AgentStrategies', 'Verlauf laden fehlgeschlagen', e)
    } finally {
        verlaufLaedt.value = false
    }
}

/** Geänderte Schlüssel zweier Versionen als lesbare "key: alt → neu"-Liste. */
function parameterDiff(alt, neu) {
    const aus = []
    for (const [bereich, a, b] of [['', alt.params, neu.params], ['risk.', alt.risk, neu.risk]]) {
        const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
        for (const k of keys) {
            if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) {
                aus.push({ key: bereich + k, alt: a?.[k] ?? '–', neu: b?.[k] ?? '–' })
            }
        }
    }
    return aus
}

const verlaufQuelle = (q) => {
    if (q === 'angelegt') return t('strategies.historySourceCreated')
    if (q === 'manuell') return t('strategies.historySourceManual')
    if (q === 'bestand') return t('strategies.historySourceBackfill')
    if (String(q).startsWith('vorschlag')) return t('strategies.historySourceSuggestion') + ' ' + String(q).replace('vorschlag ', '')
    return q
}

/**
 * Übergibt die Instanz an den KI-Coach — derselbe Weg wie im Labor. Der Knopf
 * steht bewusst auch hier: auf der Startseite des Modus war der Agent bisher
 * unsichtbar, obwohl er das zentrale Werkzeug zur Verbesserung ist.
 */
function kiOptimieren(inst) {
    router.push({ path: '/ki-coach', query: {
        agentPrompt: t('strategies.optimizePrompt', { name: inst.name, id: inst.id }),
    } })
}

function neu() {
    const s = registry.value.strategies[0]
    if (!s) return
    istNeu.value = true
    bearbeite.value = {
        strategyId: s.id,
        name: `${s.name} ${s.supportedTimeframes[1] || s.supportedTimeframes[0]}`,
        mode: 'paper',
        broker: 'bitunix',
        market: 'futures',
        timeframe: s.supportedTimeframes[1] || s.supportedTimeframes[0],
        timeframes: [],
        symbols: ['BTCUSDT'],
        params: Object.fromEntries(s.params.map((p) => [p.key, p.default])),
        risk: { ...registry.value.riskDefaults },
    }
}

// ── Reifegrad: welche Nachweise fehlen für den scharfen Betrieb? ────────
const reife = ref({})

async function reifeLaden(inst) {
    try {
        const r = await axios.get(`/api/strategies/instances/${inst.id}/readiness`)
        reife.value = { ...reife.value, [inst.id]: r.data }
    } catch { /* Anzeige ist Beiwerk — ein Fehler hier darf die Liste nicht stören */ }
}

function bearbeiten(inst) {
    istNeu.value = false
    bearbeite.value = JSON.parse(JSON.stringify(inst))
}

/** Strategiewechsel im Editor: Parameter auf die Defaults der neuen Strategie. */
function strategieGewechselt() {
    const s = gewaehlteStrategie.value
    if (!s) return
    bearbeite.value.params = Object.fromEntries(s.params.map((p) => [p.key, p.default]))
    if (!s.supportedTimeframes.includes(bearbeite.value.timeframe)) {
        bearbeite.value.timeframe = s.supportedTimeframes[0]
    }
    // Zeiteinheiten, welche die neue Strategie nicht kann, fallen weg — sonst
    // würde die Instanz mit einer Einstellung gespeichert, die der Server
    // ohnehin zurückweist.
    bearbeite.value.timeframes = tfListe()
        .filter((tf) => s.supportedTimeframes.includes(tf) && tf !== bearbeite.value.timeframe)
}

/**
 * Zeiteinheiten der Instanz. Die Haupt-Zeiteinheit ist immer dabei und lässt
 * sich nicht abwählen — sie bestimmt, was Auswertung und Backtest als
 * Ausgangspunkt nehmen. Alle weiteren laufen gleichberechtigt daneben.
 */
const tfListe = () => (Array.isArray(bearbeite.value.timeframes) ? bearbeite.value.timeframes : [])
const tfAktiv = (tf) => tf === bearbeite.value.timeframe || tfListe().includes(tf)

function tfUmschalten(tf) {
    if (tf === bearbeite.value.timeframe) return
    const liste = tfListe().filter((x) => x !== bearbeite.value.timeframe)
    bearbeite.value.timeframes = liste.includes(tf)
        ? liste.filter((x) => x !== tf)
        : [...liste, tf]
}

/** Wechselt die Haupt-Zeiteinheit, fliegt sie aus der Zusatzliste. */
function tfHauptGewechselt() {
    bearbeite.value.timeframes = tfListe().filter((x) => x !== bearbeite.value.timeframe)
}

function symbolHinzu() {
    const roh = symbolEingabe.value.toUpperCase().trim()
    if (!/^[A-Z0-9]{2,20}$/.test(roh)) return
    if (!bearbeite.value.symbols.includes(roh)) bearbeite.value.symbols.push(roh)
    symbolEingabe.value = ''
}
const symbolWeg = (s) => { bearbeite.value.symbols = bearbeite.value.symbols.filter((x) => x !== s) }

async function sichern() {
    speichern.value = true
    fehler.value = ''
    meldung.value = ''
    try {
        const daten = bearbeite.value
        const antwort = istNeu.value
            ? await axios.post('/api/strategies/instances', daten)
            : await axios.put(`/api/strategies/instances/${daten.id}`, daten)

        if (antwort.data.hinweise?.length) {
            meldung.value = t('strategies.clamped', { keys: antwort.data.hinweise.join(', ') })
        } else if (antwort.data.paramsVersionErhoeht) {
            meldung.value = t('strategies.newParamsVersion', { v: antwort.data.paramsVersion })
        } else {
            meldung.value = t('strategies.saved')
        }
        bearbeite.value = null
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    } finally {
        speichern.value = false
    }
}

async function umschalten(inst) {
    fehler.value = ''
    try {
        await axios.post(`/api/strategies/instances/${inst.id}/enabled`, { enabled: !inst.enabled })
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.toggleFailed'), t)
    }
}

const loeschBestaetigung = ref(null)
async function loeschen(inst) {
    try {
        await axios.delete(`/api/strategies/instances/${inst.id}`)
        loeschBestaetigung.value = null
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}

// ── Live-Freigabe ───────────────────────────────────────────────────────
const freigabeFuer = ref(null)
const freigabeText = ref('')
/** Öffnet den Freigabe-Dialog und holt vorher die Nachweise. */
function freigabeOeffnen(inst) {
    freigabeFuer.value = inst
    freigabeText.value = ''
    reifeLaden(inst)
}

async function freigeben() {
    fehler.value = ''
    try {
        await axios.post(`/api/strategies/instances/${freigabeFuer.value.id}/approve-live`,
            { confirm: freigabeText.value })
        freigabeFuer.value = null
        freigabeText.value = ''
        meldung.value = t('strategies.liveApproved')
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.approveFailed'), t)
    }
}

async function jetztPruefen() {
    meldung.value = t('strategies.running')
    try {
        await axios.post('/api/strategies/engine/run')
        meldung.value = t('strategies.runDone')
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.runFailed'), t)
    }
}

const notAus = ref(false)
async function notAusAusloesen(positionenSchliessen) {
    try {
        const r = await axios.post('/api/strategies/kill-switch', { closePositions: positionenSchliessen })
        meldung.value = t('strategies.killDone', { n: r.data.geschlossen || 0 })
        notAus.value = false
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.killFailed'), t)
    }
}

const modusFarbe = (m) => (m === 'live' ? 'bg-danger' : m === 'shadow' ? 'bg-warning text-dark' : 'bg-secondary')
const geld = (v) => useXDecCurrencyFormat(Number(v) || 0, 2)
</script>

<template>
    <SpinnerLoadingPage />
    <div v-show="!spinnerLoadingPage" class="row mt-3 ps-3 pe-3">
        <div class="col-12 col-xl-11">

            <!-- Kopfzeile -->
            <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
                <h5 class="mb-0 me-auto">{{ t('strategies.title') }}</h5>
                <span v-if="engine.killSwitch" class="badge bg-danger">
                    <i class="uil uil-exclamation-octagon me-1"></i>{{ t('strategies.killSwitchActive') }}
                </span>
                <span v-if="!engine.liveEnabled" class="badge bg-secondary">{{ t('strategies.liveOffGlobal') }}</span>
                <button type="button" class="ctl-pill" @click="jetztPruefen">
                    <i class="uil uil-sync me-1"></i>{{ t('strategies.runNow') }}
                </button>
                <button type="button" class="ctl-pill warn" @click="notAus = true">
                    <i class="uil uil-power me-1"></i>{{ t('strategies.killSwitch') }}
                </button>
                <button v-if="!bearbeite" type="button" class="ctl-pill accent" @click="neu">
                    <i class="uil uil-plus me-1"></i>{{ t('strategies.newInstance') }}
                </button>
            </div>

            <div v-if="meldung" class="alert alert-info py-2">{{ meldung }}</div>
            <div v-if="fehler" class="alert alert-danger py-2">{{ fehler }}</div>

            <!-- Not-Aus -->
            <div v-if="notAus" class="dailyCard p-3 mb-3 border border-danger">
                <p class="mb-2"><strong>{{ t('strategies.killSwitchConfirm') }}</strong></p>
                <p class="text-muted small mb-3">{{ t('strategies.killSwitchHint') }}</p>
                <button class="btn btn-sm btn-danger me-2" @click="notAusAusloesen(true)">
                    {{ t('strategies.killAndClose') }}
                </button>
                <button class="btn btn-sm btn-outline-danger me-2" @click="notAusAusloesen(false)">
                    {{ t('strategies.killOnly') }}
                </button>
                <button class="btn btn-sm btn-outline-secondary" @click="notAus = false">{{ t('common.cancel') }}</button>
            </div>

            <!-- ══ Liste ══ -->
            <template v-if="!bearbeite">
                <div v-if="!instanzen.length" class="dailyCard p-4 text-center text-muted">
                    {{ t('strategies.noInstances') }}
                </div>

                <div v-for="inst in instanzen" :key="inst.id" class="dailyCard p-3 mb-2">
                    <div class="d-flex flex-wrap align-items-center gap-2">
                        <span :class="['status-dot', inst.enabled ? 'on' : 'off']"></span>
                        <strong>{{ inst.name }}</strong>
                        <span class="badge" :class="modusFarbe(inst.mode)">{{ t('strategies.mode_' + inst.mode) }}</span>
                        <span class="badge bg-dark">{{ (inst.timeframes?.length ? inst.timeframes : [inst.timeframe]).join(' · ') }}</span>
                        <span class="badge bg-dark">v{{ inst.paramsVersion }}</span>
                        <span v-for="s in inst.symbols" :key="s" class="badge bg-dark">{{ s }}</span>

                        <div class="ms-auto d-flex align-items-center gap-3">
                            <small class="text-muted">
                                {{ t('strategies.openPositions') }}: <strong>{{ inst.openPositions }}</strong>
                            </small>
                            <small class="text-muted">
                                {{ t('strategies.trades') }}: <strong>{{ inst.totalTrades }}</strong>
                            </small>
                            <small :class="inst.totalNetPnl >= 0 ? 'greenTrade' : 'redTrade'">
                                {{ geld(inst.totalNetPnl) }}
                            </small>
                        </div>
                    </div>

                    <div v-if="inst.lastError" class="alert alert-warning py-1 px-2 mt-2 mb-0 small">
                        {{ inst.lastError }}
                    </div>

                    <div v-if="verlaufOffen === inst.id" class="mt-2 verlaufBox p-2">
                        <div v-if="verlaufLaedt" class="text-muted small">
                            <span class="spinner-border spinner-border-sm me-1"></span>{{ t('strategies.historyLoading') }}
                        </div>
                        <template v-else>
                            <div v-for="z in verlaufDaten" :key="z.paramsVersion" class="verlaufZeile py-2">
                                <div class="d-flex flex-wrap align-items-center gap-2">
                                    <span class="badge" :class="z.paramsVersion === inst.paramsVersion ? 'bg-info text-dark' : 'bg-dark'">
                                        v{{ z.paramsVersion }}
                                    </span>
                                    <small class="text-muted">{{ new Date(z.createdAt).toLocaleString() }}</small>
                                    <small class="text-muted">· {{ verlaufQuelle(z.source) }}</small>
                                    <span class="ms-auto d-flex gap-3">
                                        <small class="text-muted">{{ t('strategies.trades') }}: <strong>{{ z.trades }}</strong></small>
                                        <small v-if="z.trades" :class="z.summeR >= 0 ? 'greenTrade' : 'redTrade'">
                                            {{ z.summeR >= 0 ? '+' : '' }}{{ z.summeR.toFixed(2) }}R
                                        </small>
                                        <small v-if="z.trades" class="text-muted">
                                            {{ t('strategies.kpiWinRate') }} {{ z.winRate?.toFixed(0) }}%
                                        </small>
                                    </span>
                                </div>
                                <div v-if="z.diff?.length" class="mt-1 d-flex flex-wrap gap-1">
                                    <span v-for="d in z.diff" :key="d.key" class="badge diffBadge">
                                        {{ d.key }}: {{ d.alt }} → {{ d.neu }}
                                    </span>
                                </div>
                                <div v-else-if="z.diff" class="mt-1">
                                    <small class="text-muted fst-italic">{{ t('strategies.historyNoDiff') }}</small>
                                </div>
                            </div>
                            <div v-if="!verlaufDaten.length" class="text-muted small">{{ t('strategies.historyEmpty') }}</div>
                        </template>
                    </div>

                    <div class="d-flex flex-wrap gap-2 mt-2">
                        <button class="btn btn-sm" :class="inst.enabled ? 'btn-outline-warning' : 'btn-outline-success'"
                            @click="umschalten(inst)">
                            <i :class="inst.enabled ? 'uil uil-pause' : 'uil uil-play'" class="me-1"></i>
                            {{ inst.enabled ? t('strategies.stop') : t('strategies.start') }}
                        </button>
                        <button class="btn btn-sm btn-outline-primary" @click="bearbeiten(inst)">
                            <i class="uil uil-edit me-1"></i>{{ t('common.edit') }}
                        </button>
                        <button class="btn btn-sm btn-outline-info" :title="t('strategies.optimizeTitle')"
                            @click="kiOptimieren(inst)">
                            <i class="uil uil-robot me-1"></i>{{ t('strategies.aiOptimize') }}
                        </button>
                        <button class="btn btn-sm btn-outline-secondary"
                            :class="{ active: verlaufOffen === inst.id }"
                            @click="verlaufAnzeigen(inst)">
                            <i class="uil uil-history me-1"></i>{{ t('strategies.historyBtn') }} (v{{ inst.paramsVersion }})
                        </button>
                        <button v-if="inst.mode === 'live' && !inst.liveApprovedAt"
                            class="btn btn-sm btn-outline-danger"
                            @click="freigabeOeffnen(inst)">
                            <i class="uil uil-lock-open-alt me-1"></i>{{ t('strategies.approveLive') }}
                        </button>
                        <span v-else-if="inst.mode === 'live'" class="badge bg-success align-self-center">
                            {{ t('strategies.liveApprovedBadge') }}
                        </span>

                        <template v-if="loeschBestaetigung === inst.id">
                            <button class="btn btn-sm btn-danger" @click="loeschen(inst)">{{ t('common.yes') }}</button>
                            <button class="btn btn-sm btn-outline-secondary"
                                @click="loeschBestaetigung = null">{{ t('common.no') }}</button>
                        </template>
                        <button v-else class="btn btn-sm btn-outline-danger ms-auto"
                            @click="loeschBestaetigung = inst.id">
                            <i class="uil uil-trash-alt"></i>
                        </button>
                    </div>

                    <!-- Live-Freigabe: verlangt den exakten Namen -->
                    <div v-if="freigabeFuer?.id === inst.id" class="mt-3 p-3 border border-danger rounded">
                        <p class="mb-2 small">{{ t('strategies.approveLiveWarning') }}</p>

                        <!-- Die Nachweise. Sie stehen VOR dem Eingabefeld, weil der
                             Nutzer sonst den Namen tippt und erst danach erfährt,
                             dass es ohnehin nicht geht. -->
                        <div v-if="reife[inst.id]" class="mb-3">
                            <div class="small mb-1">
                                <strong>{{ t('strategies.gatesTitle') }}</strong>
                                <span class="badge ms-1" :class="reife[inst.id].bereit ? 'bg-success' : 'bg-warning text-dark'">
                                    {{ reife[inst.id].bereit ? t('strategies.gatesReady')
                                        : t('strategies.gatesOpen', { n: reife[inst.id].offen.length }) }}
                                </span>
                            </div>
                            <div v-for="tor in reife[inst.id].tore" :key="tor.id" class="small torZeile">
                                <i :class="tor.erfuellt ? 'uil uil-check-circle torJa' : 'uil uil-times-circle torNein'"></i>
                                <span :class="tor.erfuellt ? '' : 'text-muted'">{{ t('strategies.gate_' + tor.id) }}</span>
                                <span class="text-muted">— {{ tor.detail }}</span>
                            </div>
                        </div>

                        <p class="mb-2 small">{{ t('strategies.approveLiveType', { name: inst.name }) }}</p>
                        <div class="d-flex gap-2">
                            <input v-model="freigabeText" class="form-control form-control-sm" :placeholder="inst.name" />
                            <button class="btn btn-sm btn-danger"
                                :disabled="freigabeText !== inst.name || reife[inst.id]?.bereit === false"
                                @click="freigeben">{{ t('strategies.approve') }}</button>
                            <button class="btn btn-sm btn-outline-secondary"
                                @click="freigabeFuer = null">{{ t('common.cancel') }}</button>
                        </div>
                    </div>
                </div>
            </template>

            <!-- ══ Editor ══ -->
            <template v-else>
                <div class="dailyCard p-3">
                    <div class="row mb-3">
                        <div class="col-12 col-md-6 mb-2">
                            <label class="form-label small">{{ t('strategies.strategy') }}</label>
                            <select v-model="bearbeite.strategyId" class="form-select form-select-sm"
                                :disabled="!istNeu" @change="strategieGewechselt">
                                <option v-for="s in registry.strategies" :key="s.id" :value="s.id">{{ s.name }}</option>
                            </select>
                            <small v-if="gewaehlteStrategie" class="text-muted">{{ gewaehlteStrategie.description }}</small>
                        </div>
                        <div class="col-12 col-md-6 mb-2">
                            <label class="form-label small">{{ t('strategies.name') }}</label>
                            <input v-model="bearbeite.name" class="form-control form-control-sm" />
                        </div>
                        <div class="col-6 col-md-3 mb-2">
                            <label class="form-label small">{{ t('strategies.modeLabel') }}</label>
                            <select v-model="bearbeite.mode" class="form-select form-select-sm">
                                <option v-for="m in registry.modes" :key="m" :value="m">{{ t('strategies.mode_' + m) }}</option>
                            </select>
                        </div>
                        <div class="col-6 col-md-3 mb-2">
                            <label class="form-label small">{{ t('strategies.timeframe') }}</label>
                            <select v-model="bearbeite.timeframe" class="form-select form-select-sm"
                                @change="tfHauptGewechselt">
                                <option v-for="tf in gewaehlteStrategie?.supportedTimeframes || []" :key="tf" :value="tf">
                                    {{ tf }}
                                </option>
                            </select>
                        </div>
                        <div class="col-12 mb-2">
                            <label class="form-label small">
                                {{ t('strategies.extraTimeframes') }}
                                <i class="uil uil-info-circle text-muted" :title="t('strategies.extraTimeframesHint')"></i>
                            </label>
                            <div class="d-flex flex-wrap gap-2">
                                <button v-for="tf in gewaehlteStrategie?.supportedTimeframes || []" :key="tf"
                                    type="button"
                                    class="btn btn-sm"
                                    :class="tfAktiv(tf) ? 'btn-primary' : 'btn-outline-secondary'"
                                    :disabled="tf === bearbeite.timeframe"
                                    @click="tfUmschalten(tf)">
                                    {{ tf }}
                                </button>
                            </div>
                            <small class="text-muted">{{ t('strategies.extraTimeframesHint') }}</small>
                        </div>
                        <div class="col-12 col-md-6 mb-2">
                            <label class="form-label small">{{ t('strategies.symbols') }}</label>
                            <div class="d-flex gap-2 mb-1">
                                <input v-model="symbolEingabe" class="form-control form-control-sm"
                                    placeholder="BTCUSDT" @keydown.enter.prevent="symbolHinzu" />
                                <button class="btn btn-sm btn-outline-primary" @click="symbolHinzu">
                                    <i class="uil uil-plus"></i>
                                </button>
                            </div>
                            <span v-for="s in bearbeite.symbols" :key="s"
                                class="badge bg-dark me-1 pointerClass" @click="symbolWeg(s)">
                                {{ s }} <i class="uil uil-times"></i>
                            </span>
                        </div>
                    </div>

                    <div v-if="bearbeite.mode === 'live'" class="alert alert-danger py-2 small">
                        <i class="uil uil-exclamation-triangle me-1"></i>{{ t('strategies.liveModeWarning') }}
                    </div>
                    <div v-else-if="bearbeite.mode === 'shadow'" class="alert alert-warning py-2 small">
                        <i class="uil uil-eye me-1"></i>{{ t('strategies.shadowModeHint') }}
                    </div>

                    <ul class="nav nav-pills mb-3">
                        <li class="nav-item"><a class="nav-link active" data-bs-toggle="pill" href="#tab-params">
                            {{ t('strategies.strategyParams') }}</a></li>
                        <li class="nav-item"><a class="nav-link" data-bs-toggle="pill" href="#tab-risk">
                            {{ t('strategies.riskParams') }}</a></li>
                    </ul>
                    <div class="tab-content">
                        <div class="tab-pane fade show active" id="tab-params">
                            <StrategyParamForm v-model="bearbeite.params"
                                :schema="gewaehlteStrategie?.params || []"
                                :groups="gewaehlteStrategie?.paramGroups || []"
                                :i18nPrefix="'strategies.' + bearbeite.strategyId" />
                        </div>
                        <div class="tab-pane fade" id="tab-risk">
                            <StrategyParamForm v-model="bearbeite.risk"
                                :schema="registry.riskParams" i18nPrefix="strategies.risk" />
                        </div>
                    </div>

                    <div class="d-flex gap-2 mt-3">
                        <button class="btn btn-sm btn-success" :disabled="speichern" @click="sichern">
                            <i class="uil uil-save me-1"></i>{{ t('common.save') }}
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" @click="bearbeite = null">
                            {{ t('common.cancel') }}
                        </button>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped>
.verlaufBox {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--white-18, rgba(255, 255, 255, 0.15));
    border-radius: var(--border-radius, 6px);
}

.verlaufZeile + .verlaufZeile {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.diffBadge {
    background: rgba(1, 180, 255, 0.12);
    border: 1px solid rgba(1, 180, 255, 0.35);
    color: var(--blue-color, #01B4FF);
    font-weight: 500;
}

/* `.dailyCard` setzt global `height: 100%`. Das passt für Raster mit einer Karte
   je Spalte, hier stehen die Karten aber gestapelt untereinander — dort zieht die
   Regel jede einzelne Karte auf die Höhe der GESAMTEN Spalte und erzeugt riesige
   Leerräume. Karten, die bewusst mitwachsen sollen, tragen `h-100` (mit
   !important) und bleiben davon unberührt. */
.dailyCard {
    height: auto;
}

.torZeile {
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
    padding: 0.1rem 0;
}

.torJa { color: var(--green-color, #27ae60); }
.torNein { color: var(--red-color, #e74c3c); }

.status-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: inline-block;
}

.status-dot.on {
    background: #48c78e;
    box-shadow: 0 0 6px rgba(72, 199, 142, 0.8);
}

.status-dot.off {
    background: rgba(255, 255, 255, 0.25);
}
</style>
