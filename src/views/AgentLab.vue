<script setup>
/**
 * Labor: Backtest und Verbesserungsvorschläge.
 *
 * Der Backtest ist der Ort, an dem Parameter überhaupt erst beurteilbar werden
 * — ohne ihn sind Werte wie »Retest-Tiefe 25 %« geraten. Dieselbe Engine läuft
 * hier wie im Papierbetrieb, damit die Zahlen übertragbar sind.
 *
 * Vorschläge (auch die der Agenten) werden hier angenommen oder verworfen.
 * Angenommen werden sie ausschliesslich hier, durch den Nutzer — ein Agent kann
 * Parameter nie selbst setzen.
 */
import { ref, computed, onBeforeMount } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { spinnerLoadingPage } from '../stores/ui.js'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import StrategyParamForm from '../components/StrategyParamForm.vue'
import { useXDecCurrencyFormat } from '../utils/formatters.js'
import { logError } from '../utils/logger.js'
import { apiFehlerText } from '../utils/apiError.js'
import dayjs from '../utils/dayjs-setup.js'

const { t } = useI18n()
const router = useRouter()

const registry = ref({ strategies: [], riskParams: [], riskDefaults: {} })
const instanzen = ref([])
const laeufe = ref([])
const vorschlaege = ref([])
const ergebnis = ref(null)
const laueft = ref(false)
const fehler = ref('')

const form = ref({
    strategyId: '', instanceId: '', symbol: 'BTCUSDT', timeframe: '1h',
    tage: 90, startEquity: 1000, label: '',
    params: {}, risk: {},
})

const strategie = computed(() => registry.value.strategies.find((s) => s.id === form.value.strategyId) || null)
const zahl = (v, n = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))
// Ohne Verlust-Trades ist der Profit-Faktor nicht definiert (kommt als null).
const profitFaktor = (v, trades) => (v === null || v === undefined ? (trades > 0 ? '∞' : '–') : zahl(v))
const profitFaktorGut = (v) => v === null || v === undefined || v >= 1
const geld = (v) => useXDecCurrencyFormat(Number(v) || 0, 2)

async function laden() {
    try {
        const [reg, inst, bt, vs] = await Promise.all([
            axios.get('/api/strategies/registry'),
            axios.get('/api/strategies/instances'),
            axios.get('/api/strategies/backtests'),
            axios.get('/api/strategies/suggestions'),
        ])
        registry.value = reg.data
        instanzen.value = inst.data
        laeufe.value = bt.data
        vorschlaege.value = vs.data

        if (!form.value.strategyId && reg.data.strategies.length) {
            form.value.strategyId = reg.data.strategies[0].id
            strategieGewechselt()
        }
        form.value.risk = { ...reg.data.riskDefaults }
    } catch (e) {
        logError('AgentLab', 'Laden fehlgeschlagen', e)
    }
}

onBeforeMount(async () => {
    spinnerLoadingPage.value = true
    await laden()
    spinnerLoadingPage.value = false
})

function strategieGewechselt() {
    const s = strategie.value
    if (!s) return
    form.value.params = Object.fromEntries(s.params.map((p) => [p.key, p.default]))
    if (!s.supportedTimeframes.includes(form.value.timeframe)) {
        form.value.timeframe = s.supportedTimeframes[0]
    }
}

/** Parameter einer bestehenden Instanz übernehmen — der häufigste Ausgangspunkt. */
function vonInstanz() {
    const inst = instanzen.value.find((i) => i.id === Number(form.value.instanceId))
    if (!inst) return
    form.value.strategyId = inst.strategyId
    form.value.timeframe = inst.timeframe
    form.value.symbol = inst.symbols?.[0] || form.value.symbol
    form.value.params = { ...inst.params }
    form.value.risk = { ...inst.risk }
    form.value.label = t('strategies.fromInstance', { name: inst.name })
}

async function starten() {
    laueft.value = true
    fehler.value = ''
    ergebnis.value = null
    try {
        const toTs = Date.now()
        const fromTs = toTs - Number(form.value.tage) * 86400000
        const r = await axios.post('/api/strategies/backtest', {
            strategyId: form.value.strategyId,
            instanceId: Number(form.value.instanceId) || 0,
            symbol: form.value.symbol,
            timeframe: form.value.timeframe,
            fromTs, toTs,
            startEquity: Number(form.value.startEquity),
            label: form.value.label,
            params: form.value.params,
            risk: form.value.risk,
        })
        ergebnis.value = r.data
        laeufe.value = (await axios.get('/api/strategies/backtests')).data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.backtestFailed'), t)
    } finally {
        laueft.value = false
    }
}

/**
 * Übergibt die gewählte Instanz an den KI-Coach. Der `?agentPrompt=`-Deep-Link
 * startet dort automatisch einen Agentenlauf — die Optimizer-Werkzeuge sind
 * dieselben, die auch der Coach im Journal nutzt.
 */
function optimierenLassen() {
    const inst = instanzen.value.find((i) => i.id === Number(form.value.instanceId))
    if (!inst) {
        fehler.value = t('strategies.pickInstanceFirst')
        return
    }
    // Über den Router statt window.location: KiAgent liest `agentPrompt` aus
    // route.query, ein vollständiger Seitenneuaufbau ist dafür unnötig.
    router.push({ path: '/ki-coach', query: {
        agentPrompt: t('strategies.optimizePrompt', { name: inst.name, id: inst.id }),
    } })
}

/**
 * Backtest-Läufe löschen. Zweistufig bestätigt, weil ein Lauf auch als Beleg für
 * einen Optimizer-Vorschlag dienen kann.
 */
const loeschBestaetigung = ref(null)
async function laufLoeschen(l) {
    try {
        await axios.delete(`/api/strategies/backtests/${l.id}`)
        loeschBestaetigung.value = null
        laeufe.value = (await axios.get('/api/strategies/backtests')).data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}

const alleLoeschenFrage = ref(false)
async function alleLaeufeLoeschen() {
    try {
        await axios.delete('/api/strategies/backtests?confirm=true')
        alleLoeschenFrage.value = false
        laeufe.value = (await axios.get('/api/strategies/backtests')).data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}

async function entscheiden(v, wie) {
    try {
        await axios.post(`/api/strategies/suggestions/${v.id}/${wie}`)
        vorschlaege.value = (await axios.get('/api/strategies/suggestions')).data
        instanzen.value = (await axios.get('/api/strategies/instances')).data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.decideFailed'), t)
    }
}

const sortiert = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])
const instanzName = (id) => instanzen.value.find((i) => i.id === id)?.name || '–'
</script>

<template>
    <SpinnerLoadingPage />
    <div v-show="!spinnerLoadingPage" class="row mt-3 ps-3 pe-3">
        <div class="col-12 col-xl-11">
            <h5 class="mb-3">{{ t('strategies.labTitle') }}</h5>
            <div v-if="fehler" class="alert alert-danger py-2">{{ fehler }}</div>

            <!-- ══ Vorschläge ══ -->
            <div v-if="vorschlaege.filter(v => v.status === 'pending').length" class="dailyCard p-3 mb-3">
                <div class="section-title mb-2">
                    <i class="uil uil-lightbulb-alt me-1"></i>{{ t('strategies.suggestions') }}
                </div>
                <p class="text-muted small">{{ t('strategies.suggestionsHint') }}</p>
                <div v-for="v in vorschlaege.filter(v => v.status === 'pending')" :key="v.id"
                    class="border rounded p-2 mb-2">
                    <div class="d-flex align-items-center gap-2 mb-1">
                        <strong class="small">{{ v.title }}</strong>
                        <span class="badge bg-dark">{{ instanzName(v.instanceId) }}</span>
                        <span class="badge bg-secondary">{{ v.source }}</span>
                    </div>
                    <p class="small text-muted mb-2">{{ v.rationale }}</p>
                    <div class="mb-2">
                        <span v-for="(wert, key) in v.proposedParams" :key="key" class="badge bg-dark me-1">
                            {{ key }}: {{ wert }}
                        </span>
                    </div>
                    <button class="btn btn-sm btn-success me-2" @click="entscheiden(v, 'accept')">
                        {{ t('strategies.acceptSuggestion') }}
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" @click="entscheiden(v, 'reject')">
                        {{ t('strategies.rejectSuggestion') }}
                    </button>
                </div>
            </div>

            <!-- ══ Backtest ══ -->
            <div class="dailyCard p-3 mb-3">
                <div class="section-title mb-2">{{ t('strategies.backtest') }}</div>
                <div class="row g-2 align-items-end mb-3">
                    <div class="col-6 col-md-3">
                        <label class="form-label small mb-1">{{ t('strategies.strategy') }}</label>
                        <select v-model="form.strategyId" class="form-select form-select-sm" @change="strategieGewechselt">
                            <option v-for="s in registry.strategies" :key="s.id" :value="s.id">{{ s.name }}</option>
                        </select>
                    </div>
                    <div class="col-6 col-md-3">
                        <label class="form-label small mb-1">{{ t('strategies.fromInstanceLabel') }}</label>
                        <div class="d-flex gap-1">
                            <select v-model="form.instanceId" class="form-select form-select-sm">
                                <option value="">–</option>
                                <option v-for="i in instanzen" :key="i.id" :value="i.id">{{ i.name }}</option>
                            </select>
                            <button class="btn btn-sm btn-outline-primary" :disabled="!form.instanceId"
                                :title="t('strategies.copyFromInstance')"
                                @click="vonInstanz"><i class="uil uil-import"></i></button>
                            <button class="btn btn-sm btn-outline-info" :disabled="!form.instanceId"
                                :title="t('strategies.optimizeTitle')"
                                @click="optimierenLassen"><i class="uil uil-robot"></i></button>
                        </div>
                    </div>
                    <div class="col-6 col-md-2">
                        <label class="form-label small mb-1">{{ t('strategies.symbol') }}</label>
                        <input v-model="form.symbol" class="form-control form-control-sm" />
                    </div>
                    <div class="col-6 col-md-2">
                        <label class="form-label small mb-1">{{ t('strategies.timeframe') }}</label>
                        <select v-model="form.timeframe" class="form-select form-select-sm">
                            <option v-for="tf in strategie?.supportedTimeframes || []" :key="tf" :value="tf">{{ tf }}</option>
                        </select>
                    </div>
                    <div class="col-6 col-md-1">
                        <label class="form-label small mb-1">{{ t('strategies.days') }}</label>
                        <input v-model.number="form.tage" type="number" min="7" max="720"
                            class="form-control form-control-sm" />
                    </div>
                    <div class="col-6 col-md-1">
                        <button class="btn btn-sm btn-success w-100" :disabled="laueft" @click="starten">
                            <span v-if="laueft" class="spinner-border spinner-border-sm"></span>
                            <span v-else>{{ t('strategies.run') }}</span>
                        </button>
                    </div>
                </div>

                <p v-if="form.instanceId" class="small text-muted mb-2">
                    <i class="uil uil-robot me-1"></i>{{ t('strategies.optimizeHint') }}
                </p>

                <details>
                    <summary class="small text-muted pointerClass mb-2">{{ t('strategies.showParams') }}</summary>
                    <div class="row">
                        <div class="col-12 col-lg-7">
                            <StrategyParamForm v-model="form.params" :schema="strategie?.params || []"
                                :groups="strategie?.paramGroups || []" :i18nPrefix="'strategies.' + form.strategyId" />
                        </div>
                        <div class="col-12 col-lg-5">
                            <StrategyParamForm v-model="form.risk" :schema="registry.riskParams"
                                i18nPrefix="strategies.risk" />
                        </div>
                    </div>
                </details>
            </div>

            <!-- ══ Ergebnis ══ -->
            <div v-if="ergebnis" class="dailyCard p-3 mb-3">
                <div class="section-title mb-2">{{ t('strategies.result') }}</div>
                <div v-if="!ergebnis.stats.trades" class="text-muted small">
                    {{ ergebnis.stats.hinweis || t('strategies.noTradesInPeriod') }}
                </div>
                <template v-else>
                    <div class="row g-2 mb-3">
                        <div class="col-4 col-md-2" v-for="k in [
                            { l: t('strategies.kpiTrades'), v: ergebnis.stats.trades },
                            { l: t('strategies.kpiWinRate'), v: zahl(ergebnis.stats.winRate, 1) + ' %' },
                            { l: t('strategies.kpiExpectancy'), v: zahl(ergebnis.stats.expectancyR) + ' R',
                              farbe: ergebnis.stats.expectancyR >= 0 },
                            { l: t('strategies.kpiProfitFactor'),
                              v: profitFaktor(ergebnis.stats.profitFactor, ergebnis.stats.trades),
                              farbe: profitFaktorGut(ergebnis.stats.profitFactor) },
                            { l: t('strategies.kpiNetPnl'), v: geld(ergebnis.stats.netPnl),
                              farbe: ergebnis.stats.netPnl >= 0 },
                            { l: t('strategies.kpiMaxDd'), v: zahl(ergebnis.stats.maxDrawdownPct, 1) + ' %' },
                        ]" :key="k.l">
                            <div class="text-center p-2">
                                <div class="kpi-label">{{ k.l }}</div>
                                <div class="kpi-value"
                                    :class="k.farbe === undefined ? '' : (k.farbe ? 'greenTrade' : 'redTrade')">
                                    {{ k.v }}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-12 col-md-6">
                            <div class="section-title mb-1">{{ t('strategies.funnel') }}</div>
                            <table class="table table-sm table-borderless mb-0">
                                <tbody>
                                    <tr v-for="k in ['setupsDetected', 'triggered', 'executed']" :key="k">
                                        <td class="small">{{ t('strategies.bt_' + k) }}</td>
                                        <td class="text-end small"><strong>{{ ergebnis.funnel[k] }}</strong></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div class="col-12 col-md-6">
                            <div class="section-title mb-1">{{ t('strategies.whyLost') }}</div>
                            <table class="table table-sm table-borderless mb-0">
                                <tbody>
                                    <tr v-for="[g, n] in sortiert(ergebnis.funnel.invalidated)" :key="g">
                                        <td class="small">{{ t('strategies.reason_' + g) }}</td>
                                        <td class="text-end small">{{ n }}</td>
                                    </tr>
                                    <tr v-for="[g, n] in sortiert(ergebnis.funnel.riskRejected)" :key="'r' + g">
                                        <td class="small text-warning">{{ t('strategies.reason_' + g) }}</td>
                                        <td class="text-end small">{{ n }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </template>
            </div>

            <!-- ══ Frühere Läufe ══ -->
            <div v-if="laeufe.length" class="dailyCard p-3">
                <div class="d-flex align-items-center mb-2">
                    <div class="section-title me-auto">{{ t('strategies.previousRuns') }}</div>
                    <template v-if="alleLoeschenFrage">
                        <span class="small text-muted me-2">{{ t('strategies.deleteAllRunsConfirm') }}</span>
                        <button class="btn btn-sm btn-danger py-0 me-1" @click="alleLaeufeLoeschen">
                            {{ t('common.yes') }}
                        </button>
                        <button class="btn btn-sm btn-outline-secondary py-0"
                            @click="alleLoeschenFrage = false">{{ t('common.no') }}</button>
                    </template>
                    <button v-else class="btn btn-sm btn-outline-danger py-0"
                        @click="alleLoeschenFrage = true">
                        <i class="uil uil-trash-alt me-1"></i>{{ t('strategies.deleteAllRuns') }}
                    </button>
                </div>
                <div class="table-responsive">
                    <table class="table table-sm table-borderless mb-0">
                        <thead>
                            <tr class="text-muted small">
                                <th>{{ t('strategies.label') }}</th>
                                <th>{{ t('strategies.symbol') }}</th>
                                <th>{{ t('strategies.timeframe') }}</th>
                                <th class="text-end">{{ t('strategies.kpiTrades') }}</th>
                                <th class="text-end">{{ t('strategies.kpiWinRate') }}</th>
                                <th class="text-end">{{ t('strategies.kpiExpectancy') }}</th>
                                <th class="text-end">{{ t('strategies.kpiProfitFactor') }}</th>
                                <th>{{ t('strategies.period') }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="l in laeufe" :key="l.id">
                                <td class="small">{{ l.label || '–' }}</td>
                                <td class="small">{{ l.symbol }}</td>
                                <td class="small">{{ l.timeframe }}</td>
                                <td class="text-end small">{{ l.stats.trades ?? 0 }}</td>
                                <td class="text-end small">{{ zahl(l.stats.winRate, 1) }}</td>
                                <td class="text-end small"
                                    :class="(l.stats.expectancyR || 0) >= 0 ? 'greenTrade' : 'redTrade'">
                                    {{ zahl(l.stats.expectancyR) }}
                                </td>
                                <td class="text-end small">
                                    {{ profitFaktor(l.stats.profitFactor, l.stats.trades) }}
                                </td>
                                <td class="small text-muted">
                                    {{ dayjs(Number(l.fromTs)).format('DD.MM.YY') }} –
                                    {{ dayjs(Number(l.toTs)).format('DD.MM.YY') }}
                                </td>
                                <td class="text-end" style="white-space: nowrap;">
                                    <template v-if="loeschBestaetigung === l.id">
                                        <button class="btn btn-sm btn-danger py-0 me-1"
                                            @click="laufLoeschen(l)">{{ t('common.yes') }}</button>
                                        <button class="btn btn-sm btn-outline-secondary py-0"
                                            @click="loeschBestaetigung = null">{{ t('common.no') }}</button>
                                    </template>
                                    <button v-else class="btn btn-sm btn-outline-danger py-0"
                                        :title="t('strategies.deleteRun')"
                                        @click="loeschBestaetigung = l.id">
                                        <i class="uil uil-trash-alt"></i>
                                    </button>
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
/* `.dailyCard` setzt global `height: 100%`. Das passt für Raster mit einer Karte
   je Spalte, hier stehen die Karten aber gestapelt untereinander — dort zieht die
   Regel jede einzelne Karte auf die Höhe der GESAMTEN Spalte und erzeugt riesige
   Leerräume. Karten, die bewusst mitwachsen sollen, tragen `h-100` (mit
   !important) und bleiben davon unberührt. */
.dailyCard {
    height: auto;
}

.section-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--white-60, rgba(255, 255, 255, 0.6));
}

.kpi-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
}

.kpi-value {
    font-size: 1.1rem;
    font-weight: 600;
}
</style>
