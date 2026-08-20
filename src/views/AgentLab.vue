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

const { t, te } = useI18n()
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
    // Zeitraum wahlweise als „Tage zurück" (der schnelle Alltagsfall) oder als
    // festes von/bis-Datum — z.B. eine Short-Strategie gezielt ab dem letzten
    // Allzeithoch. Beide Werte bleiben erhalten, der Schalter entscheidet.
    zeitmodus: 'tage',
    tage: 90,
    von: dayjs().subtract(90, 'day').format('YYYY-MM-DD'),
    bis: dayjs().format('YYYY-MM-DD'),
    startEquity: 1000, label: '',
    params: {}, risk: {},
})

/** Zeitraum eines Formulars (Modus Tage oder Datum) → { fromTs, toTs } oder null. */
function zeitraumVon(f) {
    if (f.zeitmodus === 'tage') {
        const toTs = Date.now()
        return { fromTs: toTs - Number(f.tage) * 86400000, toTs }
    }
    const fromTs = dayjs(f.von).valueOf()
    const toTs = Math.min(dayjs(f.bis).endOf('day').valueOf(), Date.now())
    return fromTs < toTs ? { fromTs, toTs } : null
}

// Sucht das Allzeithoch in den Tageskerzen (~3 Jahre) und setzt „von" darauf.
const athLaedt = ref(false)
async function vonAufAth() {
    athLaedt.value = true
    try {
        const r = await axios.get('/api/binance/klines', {
            params: { symbol: form.value.symbol, interval: '1d', market: 'futures', limit: 1000 },
        })
        let hoch = -Infinity
        let hochT = null
        for (const k of r.data) {
            const h = Number(k[2])
            if (h > hoch) { hoch = h; hochT = Number(k[0]) }
        }
        if (hochT) {
            form.value.von = dayjs(hochT).format('YYYY-MM-DD')
            form.value.zeitmodus = 'datum'
            fehler.value = ''
        }
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.athFailed'), t)
    } finally {
        athLaedt.value = false
    }
}

// Mehrfach-Test: derselbe Parametersatz über mehrere Symbole und über zwei
// Zeitfenster. Die Trennung in Optimierungs- und Prüffenster ist der Kern —
// eine Einstellung, die nur dort gut ist, wo sie ausgesucht wurde, taugt nichts.
const matrix = ref({
    symbole: 'BTCUSDT, ETHUSDT',
    zeitmodus: 'tage',
    tage: 360,
    von: dayjs().subtract(360, 'day').format('YYYY-MM-DD'),
    bis: dayjs().format('YYYY-MM-DD'),
    gegenGespeicherte: true,
    laeuft: false,
    fehler: '',
    ergebnis: null,
})

const strategie = computed(() => registry.value.strategies.find((s) => s.id === form.value.strategyId) || null)
const zahl = (v, n = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))
// Ohne Verlust-Trades ist der Profit-Faktor nicht definiert (kommt als null).
const profitFaktor = (v, trades) => (v === null || v === undefined ? (trades > 0 ? '∞' : '–') : zahl(v))
const profitFaktorGut = (v) => v === null || v === undefined || v >= 1
const geld = (v) => useXDecCurrencyFormat(Number(v) || 0, 2)
/** Nur Datum — bei Abdeckungslücken zählt der Tag, nicht die Uhrzeit. */
const datum = (t) => (t ? new Date(Number(t)).toISOString().slice(0, 10) : '–')

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
        const zeitraum = zeitraumVon(form.value)
        if (!zeitraum) {
            fehler.value = t('strategies.rangeInvalid')
            laueft.value = false
            return
        }
        const { fromTs, toTs } = zeitraum
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

// ── Robustheit: Stabilität, Monte Carlo, Walk-forward ───────────────────
// Bewusst am SELBEN Formular wie der Backtest: Strategie, Symbol, Zeitraum und
// Parameter sollen für alle Prüfungen dieselben sein, sonst vergleicht man
// hinterher Äpfel mit Birnen.
const robust = ref({
    paramKey: '', von: 5, bis: 30, schritt: 5,
    laeufe: 1000, fenster: 4,
    laeuft: '', fehler: '',
    // Mehrere Symbole für die Matrix — der Einzellauf verleitet dazu, ein
    // Zufallsplateau für eine Eigenschaft der Strategie zu halten.
    symbole: 'BTCUSDT, ETHUSDT, SOLUSDT',
    stabilitaet: null, montecarlo: null, walkforward: null, matrixStab: null,
})

/** Zahlen-Parameter der gewählten Strategie — nur die lassen sich durchfahren. */
const zahlParameter = computed(() =>
    (strategie.value?.params || []).filter((p) => p.type === 'number' || p.type === 'integer'))

/** Stufenreihe aus von/bis/Schritt. Ganzzahl-Parameter bekommen ganze Stufen. */
const stufen = computed(() => {
    const p = zahlParameter.value.find((x) => x.key === robust.value.paramKey)
    const schritt = Math.abs(Number(robust.value.schritt)) || 1
    const raus = []
    for (let w = Number(robust.value.von); w <= Number(robust.value.bis) + 1e-9; w += schritt) {
        raus.push(p?.type === 'integer' ? Math.round(w) : Number(w.toFixed(4)))
        if (raus.length >= 25) break
    }
    return [...new Set(raus)]
})

function robustBasis() {
    const zeitraum = zeitraumVon(form.value)
    if (!zeitraum) return null
    return {
        strategyId: form.value.strategyId,
        symbol: form.value.symbol,
        timeframe: form.value.timeframe,
        fromTs: zeitraum.fromTs, toTs: zeitraum.toTs,
        startEquity: Number(form.value.startEquity),
        params: form.value.params, risk: form.value.risk,
    }
}

async function robustStarten(art) {
    const basis = robustBasis()
    if (!basis) { robust.value.fehler = t('strategies.rangeInvalid'); return }
    robust.value.laeuft = art
    robust.value.fehler = ''
    try {
        if (art === 'montecarlo') {
            const r = await axios.post('/api/strategies/robustness/montecarlo',
                { ...basis, laeufe: Number(robust.value.laeufe) || 1000 })
            robust.value.montecarlo = r.data
        } else if (art === 'stabilitaet') {
            const r = await axios.post('/api/strategies/robustness/stability',
                { ...basis, paramKey: robust.value.paramKey, werte: stufen.value })
            robust.value.stabilitaet = r.data
        } else if (art === 'matrix') {
            const r = await axios.post('/api/strategies/robustness/stability-matrix', {
                ...basis,
                paramKey: robust.value.paramKey,
                werte: stufen.value,
                symbole: robust.value.symbole.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
            })
            robust.value.matrixStab = r.data
        } else {
            const r = await axios.post('/api/strategies/robustness/walkforward',
                { ...basis, paramKey: robust.value.paramKey, werte: stufen.value, fenster: Number(robust.value.fenster) || 4 })
            robust.value.walkforward = r.data
        }
    } catch (e) {
        robust.value.fehler = apiFehlerText(e, t('strategies.backtestFailed'), t)
    } finally {
        robust.value.laeuft = ''
    }
}

/**
 * Lesbarer Name eines Parameters. Denselben Pfad benutzt auch das
 * Parameter-Formular (`strategies.<strategie>.<schlüssel>`) — eine zweite
 * Konvention hätte hier rohe Schlüssel angezeigt, während daneben Klartext steht.
 */
function parameterName(p) {
    const key = p.labelKey || `strategies.${form.value.strategyId}.${p.key}`
    return te(key) ? t(key) : p.key
}

/**
 * Entscheidung zu einem Lauf festhalten. Die Notiz ist freiwillig, aber genau
 * sie beantwortet in vier Wochen die Frage „warum eigentlich?" — deshalb wird
 * danach gefragt statt sie wegzulassen.
 */
async function laufEntscheiden(lauf, entscheidung) {
    const notiz = window.prompt(t('strategies.regNotePrompt'), lauf.notiz || '')
    if (notiz === null) return
    try {
        await axios.post(`/api/strategies/backtests/${lauf.id}/decision`, { entscheidung, notiz })
        laeufe.value = (await axios.get('/api/strategies/backtests')).data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    }
}

/** Farbe des Stabilitäts-Urteils — Plateau gut, Nadel warnend. */
const urteilKlasse = (u) => (u === 'plateau' ? 'bg-success'
    : (u === 'nadel' || u === 'schmal' || u === 'uneinig') ? 'bg-warning text-dark' : 'bg-secondary')

/**
 * Mehrfach-Test starten.
 *
 * Verglichen wird gegen die GESPEICHERTEN Parameter der gewählten Instanz —
 * nur so beantwortet der Lauf die eigentliche Frage: „ist meine Änderung besser
 * als das, was gerade läuft?" Ohne Instanz gibt es keinen Vergleich, dann zeigt
 * die Matrix nur die Zahlen des aktuellen Satzes.
 */
async function matrixStarten() {
    matrix.value.laeuft = true
    matrix.value.fehler = ''
    matrix.value.ergebnis = null
    try {
        const symbole = matrix.value.symbole.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
        const inst = instanzen.value.find((i) => i.id === Number(form.value.instanceId))
        const zeitraum = zeitraumVon(matrix.value)
        if (!zeitraum) {
            matrix.value.fehler = t('strategies.rangeInvalid')
            matrix.value.laeuft = false
            return
        }
        const { fromTs, toTs } = zeitraum
        const r = await axios.post('/api/strategies/backtest-matrix', {
            strategyId: form.value.strategyId,
            timeframe: form.value.timeframe,
            symbols: symbole,
            fromTs,
            toTs,
            startEquity: Number(form.value.startEquity),
            params: form.value.params,
            baselineParams: (matrix.value.gegenGespeicherte && inst) ? inst.params : null,
            risk: form.value.risk,
        })
        matrix.value.ergebnis = r.data
    } catch (e) {
        matrix.value.fehler = apiFehlerText(e, t('strategies.matrixFailed'), t)
    } finally {
        matrix.value.laeuft = false
    }
}

const matrixZahl = (v, n = 3) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))

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
                        </div>
                    </div>
                    <div class="col-12 col-md-3">
                        <label class="form-label small mb-1">&nbsp;</label>
                        <button class="btn btn-sm btn-info w-100 d-block" :disabled="!form.instanceId"
                            :title="t('strategies.optimizeTitle')"
                            @click="optimierenLassen">
                            <i class="uil uil-robot me-1"></i>{{ t('strategies.aiOptimize') }}
                        </button>
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
                        <label class="form-label small mb-1">{{ t('strategies.period') }}</label>
                        <select v-model="form.zeitmodus" class="form-select form-select-sm">
                            <option value="tage">{{ t('strategies.days') }}</option>
                            <option value="datum">{{ t('strategies.dateRange') }}</option>
                        </select>
                    </div>
                    <div v-if="form.zeitmodus === 'tage'" class="col-6 col-md-1">
                        <label class="form-label small mb-1">{{ t('strategies.days') }}</label>
                        <input v-model.number="form.tage" type="number" min="7" max="720"
                            class="form-control form-control-sm" />
                    </div>
                    <template v-else>
                        <div class="col-6 col-md-2">
                            <label class="form-label small mb-1">{{ t('strategies.from') }}</label>
                            <div class="d-flex gap-1">
                                <input v-model="form.von" type="date" class="form-control form-control-sm" />
                                <button class="btn btn-sm btn-outline-secondary flex-shrink-0"
                                    :disabled="athLaedt" :title="t('strategies.sinceAthTitle')"
                                    @click="vonAufAth">
                                    <span v-if="athLaedt" class="spinner-border spinner-border-sm"></span>
                                    <span v-else>{{ t('strategies.sinceAth') }}</span>
                                </button>
                            </div>
                        </div>
                        <div class="col-6 col-md-2">
                            <label class="form-label small mb-1">{{ t('strategies.to') }}</label>
                            <input v-model="form.bis" type="date" class="form-control form-control-sm" />
                        </div>
                    </template>
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

            <!-- ══ Robustheit ══
                 Drei Stufen zwischen „guter Backtest" und „belastbar". Sie
                 benutzen bewusst dasselbe Formular wie der Backtest darüber. -->
            <div class="dailyCard p-3 mb-3">
                <div class="section-title mb-1">
                    <i class="uil uil-shield-check me-1"></i>{{ t('strategies.robustTitle') }}
                </div>
                <p class="small text-muted">{{ t('strategies.robustHint') }}</p>

                <div class="row g-2 align-items-end mb-2">
                    <div class="col-6 col-md-3">
                        <label class="form-label small mb-1">{{ t('strategies.robustParam') }}</label>
                        <select v-model="robust.paramKey" class="form-select form-select-sm">
                            <option value="">—</option>
                            <option v-for="p in zahlParameter" :key="p.key" :value="p.key">
                                {{ parameterName(p) }}
                            </option>
                        </select>
                    </div>
                    <div class="col-4 col-md-2">
                        <label class="form-label small mb-1">{{ t('strategies.robustFrom') }}</label>
                        <input v-model.number="robust.von" type="number" class="form-control form-control-sm" />
                    </div>
                    <div class="col-4 col-md-2">
                        <label class="form-label small mb-1">{{ t('strategies.robustTo') }}</label>
                        <input v-model.number="robust.bis" type="number" class="form-control form-control-sm" />
                    </div>
                    <div class="col-4 col-md-2">
                        <label class="form-label small mb-1">{{ t('strategies.robustStep') }}</label>
                        <input v-model.number="robust.schritt" type="number" step="0.1" class="form-control form-control-sm" />
                    </div>
                    <div class="col-6 col-md-2">
                        <label class="form-label small mb-1">{{ t('strategies.robustRuns') }}</label>
                        <input v-model.number="robust.laeufe" type="number" min="100" max="5000" step="100"
                            class="form-control form-control-sm" />
                    </div>
                    <div class="col-6 col-md-1">
                        <label class="form-label small mb-1">{{ t('strategies.robustWindows') }}</label>
                        <input v-model.number="robust.fenster" type="number" min="2" max="12"
                            class="form-control form-control-sm" />
                    </div>
                    <div class="col-12">
                        <label class="form-label small mb-1">{{ t('strategies.robustSymbols') }}</label>
                        <input v-model="robust.symbole" class="form-control form-control-sm" placeholder="BTCUSDT, ETHUSDT" />
                    </div>
                    <div class="col-12">
                        <div class="stufenLeiste">
                            <span class="stufenTitel">{{ t('strategies.robustSteps', { n: stufen.length }) }}</span>
                            <span v-for="w in stufen" :key="w" class="stufenWert">{{ w }}</span>
                        </div>
                    </div>
                </div>

                <div class="d-flex flex-wrap gap-2 mb-3 robustKnoepfe">
                    <button class="btn btn-sm btn-outline-primary" :disabled="!!robust.laeuft || !robust.paramKey"
                        @click="robustStarten('stabilitaet')">
                        <span v-if="robust.laeuft === 'stabilitaet'" class="spinner-border spinner-border-sm me-1"></span>
                        {{ t('strategies.robustStability') }}
                    </button>
                    <button class="btn btn-sm btn-outline-primary" :disabled="!!robust.laeuft"
                        @click="robustStarten('montecarlo')">
                        <span v-if="robust.laeuft === 'montecarlo'" class="spinner-border spinner-border-sm me-1"></span>
                        {{ t('strategies.robustMonteCarlo') }}
                    </button>
                    <button class="btn btn-sm btn-primary" :disabled="!!robust.laeuft || !robust.paramKey"
                        @click="robustStarten('matrix')">
                        <span v-if="robust.laeuft === 'matrix'" class="spinner-border spinner-border-sm me-1"></span>
                        {{ t('strategies.robustMatrix') }}
                    </button>
                    <button class="btn btn-sm btn-outline-primary" :disabled="!!robust.laeuft || !robust.paramKey"
                        @click="robustStarten('walkforward')">
                        <span v-if="robust.laeuft === 'walkforward'" class="spinner-border spinner-border-sm me-1"></span>
                        {{ t('strategies.robustWalkForward') }}
                    </button>
                </div>

                <div v-if="robust.fehler" class="alert alert-danger py-2 small">{{ robust.fehler }}</div>

                <!-- Stabilität über mehrere Symbole und beide Fenster -->
                <div v-if="robust.matrixStab?.proWert" class="mb-3">
                    <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
                        <strong class="small">{{ t('strategies.robustMatrix') }}</strong>
                        <span class="badge" :class="urteilKlasse(robust.matrixStab.urteil)">
                            {{ t('strategies.mverdict_' + robust.matrixStab.urteil) }}
                        </span>
                        <span class="small text-muted">
                            {{ t('strategies.robustCells', {
                                n: robust.matrixStab.zellen.length,
                                s: robust.matrixStab.symbole.join(', '),
                            }) }}
                        </span>
                        <!-- Datenlücken gehören neben das Urteil, nicht in eine
                             Fussnote: sie erklären, warum eine Zelle schweigt. -->
                        <span v-if="robust.matrixStab.unvollstaendig" class="badge bg-warning text-dark">
                            {{ t('strategies.robustGaps', { n: robust.matrixStab.unvollstaendig }) }}
                        </span>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-sm table-borderless mb-0">
                            <thead><tr class="small text-muted">
                                <th>{{ t('strategies.robustValue') }}</th>
                                <th class="text-end">{{ t('strategies.mcolHolds') }}</th>
                                <th class="text-end">{{ t('strategies.mcolMedian') }}</th>
                                <th class="text-end">{{ t('strategies.mcolWorst') }}</th>
                                <th class="text-end">{{ t('strategies.mcolBest') }}</th>
                                <th></th>
                            </tr></thead>
                            <tbody>
                                <tr v-for="p in robust.matrixStab.proWert" :key="p.wert">
                                    <td class="small"><strong>{{ p.wert }}</strong></td>
                                    <td class="text-end small">{{ p.positiv }}/{{ p.zellen }}</td>
                                    <td class="text-end small" :class="p.median >= 0 ? 'greenTrade' : 'redTrade'">{{ zahl(p.median) }}</td>
                                    <td class="text-end small redTrade">{{ zahl(p.schlechteste) }}</td>
                                    <td class="text-end small greenTrade">{{ zahl(p.beste) }}</td>
                                    <td class="text-end">
                                        <span v-if="p.traegt" class="badge bg-success">{{ t('strategies.mHolds') }}</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p class="small text-muted mt-1 mb-0">{{ t('strategies.robustMatrixHint') }}</p>
                </div>

                <!-- Stabilität -->
                <div v-if="robust.stabilitaet && robust.stabilitaet.punkte" class="mb-3">
                    <div class="d-flex align-items-center gap-2 mb-1">
                        <strong class="small">{{ t('strategies.robustStability') }}</strong>
                        <span class="badge" :class="urteilKlasse(robust.stabilitaet.urteil)">
                            {{ t('strategies.verdict_' + robust.stabilitaet.urteil) }}
                        </span>
                        <span v-if="robust.stabilitaet.plateau?.length" class="small text-muted">
                            {{ t('strategies.robustPlateau', { werte: robust.stabilitaet.plateau.join(', ') }) }}
                        </span>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-sm table-borderless mb-0">
                            <thead><tr class="small text-muted">
                                <th>{{ t('strategies.robustValue') }}</th>
                                <th class="text-end">{{ t('strategies.kpiTrades') }}</th>
                                <th class="text-end">{{ t('strategies.kpiExpectancy') }}</th>
                                <th class="text-end">{{ t('strategies.kpiExpectancyOhneTop') }}</th>
                                <th class="text-end">{{ t('strategies.kpiReturn') }}</th>
                                <th class="text-end">{{ t('strategies.kpiMaxDd') }}</th>
                            </tr></thead>
                            <tbody>
                                <tr v-for="p in robust.stabilitaet.punkte" :key="p.wert"
                                    :class="{ besterWert: p.wert === robust.stabilitaet.besterWert }">
                                    <td class="small"><strong>{{ p.wert }}</strong></td>
                                    <td class="text-end small" :class="{ 'text-muted': !p.belastbar }">{{ p.trades }}</td>
                                    <td class="text-end small" :class="p.expectancyR >= 0 ? 'greenTrade' : 'redTrade'">{{ zahl(p.expectancyR) }}</td>
                                    <td class="text-end small" :class="p.expectancyROhneTop >= 0 ? 'greenTrade' : 'redTrade'">{{ zahl(p.expectancyROhneTop) }}</td>
                                    <td class="text-end small">{{ zahl(p.returnPct, 1) }} %</td>
                                    <td class="text-end small">{{ zahl(p.maxDrawdownPct, 1) }} %</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Monte Carlo -->
                <div v-if="robust.montecarlo?.monteCarlo" class="mb-3">
                    <strong class="small d-block mb-1">{{ t('strategies.robustMonteCarlo') }}</strong>
                    <div v-if="robust.montecarlo.monteCarlo.hinweis" class="small text-muted">
                        {{ robust.montecarlo.monteCarlo.hinweis }}
                    </div>
                    <template v-else>
                        <!-- Die wichtigste Zahl zuerst: wie oft ging es schief? -->
                        <div class="alert py-2 px-3 small mb-2"
                            :class="robust.montecarlo.monteCarlo.ziehen.anteilVerlust > 0.4 ? 'alert-warning' : 'alert-secondary'">
                            {{ t('strategies.robustLossShare', {
                                p: (robust.montecarlo.monteCarlo.ziehen.anteilVerlust * 100).toFixed(0),
                                n: robust.montecarlo.monteCarlo.laeufe,
                            }) }}
                        </div>
                        <div class="row g-2">
                            <div class="col-6 col-md-3" v-for="k in [
                                { l: t('strategies.mcEndP5'), v: geld(robust.montecarlo.monteCarlo.ziehen.endEquity.p5) },
                                { l: t('strategies.mcEndP50'), v: geld(robust.montecarlo.monteCarlo.ziehen.endEquity.p50) },
                                { l: t('strategies.mcEndP95'), v: geld(robust.montecarlo.monteCarlo.ziehen.endEquity.p95) },
                                { l: t('strategies.mcDdP95'), v: zahl(robust.montecarlo.monteCarlo.reihenfolge.maxDrawdownPct.p95, 1) + ' %' },
                            ]" :key="k.l">
                                <div class="text-center p-2">
                                    <div class="kpi-label">{{ k.l }}</div>
                                    <div class="kpi-value">{{ k.v }}</div>
                                </div>
                            </div>
                        </div>
                    </template>
                </div>

                <!-- Walk-forward -->
                <div v-if="robust.walkforward?.abschnitte">
                    <div class="d-flex align-items-center gap-2 mb-1">
                        <strong class="small">{{ t('strategies.robustWalkForward') }}</strong>
                        <span class="badge" :class="robust.walkforward.auswahlStabil ? 'bg-success' : 'bg-warning text-dark'">
                            {{ robust.walkforward.auswahlStabil ? t('strategies.wfStable') : t('strategies.wfUnstable') }}
                        </span>
                    </div>
                    <div class="table-responsive mb-2">
                        <table class="table table-sm table-borderless mb-0">
                            <thead><tr class="small text-muted">
                                <th>{{ t('strategies.wfSegment') }}</th>
                                <th>{{ t('strategies.wfChosen') }}</th>
                                <th class="text-end">{{ t('strategies.wfOos') }}</th>
                                <th class="text-end">{{ t('strategies.kpiTrades') }}</th>
                            </tr></thead>
                            <tbody>
                                <tr v-for="(a, i) in robust.walkforward.abschnitte" :key="i">
                                    <td class="small text-muted">{{ datum(a.pruefVon) }} – {{ datum(a.pruefBis) }}</td>
                                    <td class="small"><strong>{{ a.gewaehlt }}</strong></td>
                                    <td class="text-end small" :class="a.pruefExpectancyR >= 0 ? 'greenTrade' : 'redTrade'">
                                        {{ zahl(a.pruefExpectancyR) }} R
                                    </td>
                                    <td class="text-end small">{{ a.pruefTrades }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="alert alert-secondary py-2 px-3 small mb-0">
                        {{ t('strategies.wfTotal', {
                            trades: robust.walkforward.gesamt.trades,
                            expR: zahl(robust.walkforward.gesamt.expectancyR),
                            rendite: zahl(robust.walkforward.gesamt.returnPct, 2),
                            dd: zahl(robust.walkforward.gesamt.maxDrawdownPct, 1),
                        }) }}
                    </div>
                </div>
            </div>

            <!-- ══ Mehrfach-Test ══ -->
            <div class="dailyCard p-3 mb-3">
                <div class="section-title mb-1">
                    <i class="uil uil-apps me-1"></i>{{ t('strategies.matrixTitle') }}
                </div>
                <p class="text-muted small mb-2">{{ t('strategies.matrixHint') }}</p>
                <div class="row g-2 align-items-end mb-2">
                    <div class="col-12 col-md-3">
                        <label class="form-label small mb-1">{{ t('strategies.matrixSymbols') }}</label>
                        <input v-model="matrix.symbole" type="text" class="form-control form-control-sm"
                               placeholder="BTCUSDT, ETHUSDT" />
                    </div>
                    <div class="col-6 col-md-1">
                        <label class="form-label small mb-1">{{ t('strategies.period') }}</label>
                        <select v-model="matrix.zeitmodus" class="form-select form-select-sm">
                            <option value="tage">{{ t('strategies.days') }}</option>
                            <option value="datum">{{ t('strategies.dateRange') }}</option>
                        </select>
                    </div>
                    <div v-if="matrix.zeitmodus === 'tage'" class="col-6 col-md-1">
                        <label class="form-label small mb-1">{{ t('strategies.days') }}</label>
                        <input v-model.number="matrix.tage" type="number" min="14" max="720"
                            class="form-control form-control-sm" />
                    </div>
                    <template v-else>
                        <div class="col-6 col-md-2">
                            <label class="form-label small mb-1">{{ t('strategies.from') }}</label>
                            <input v-model="matrix.von" type="date" class="form-control form-control-sm" />
                        </div>
                        <div class="col-6 col-md-2">
                            <label class="form-label small mb-1">{{ t('strategies.to') }}</label>
                            <input v-model="matrix.bis" type="date" class="form-control form-control-sm" />
                        </div>
                    </template>
                    <div class="col-6 col-md-3">
                        <div class="form-check">
                            <input id="matrixVergleich" v-model="matrix.gegenGespeicherte"
                                   class="form-check-input" type="checkbox" />
                            <label class="form-check-label small" for="matrixVergleich">
                                {{ t('strategies.matrixCompare') }}
                            </label>
                        </div>
                    </div>
                    <div class="col-12 col-md-2">
                        <button class="btn btn-sm greenBtn w-100" :disabled="matrix.laeuft || !form.strategyId"
                                @click="matrixStarten">
                            {{ matrix.laeuft ? t('strategies.running') : t('strategies.matrixStart') }}
                        </button>
                    </div>
                </div>

                <div v-if="matrix.fehler" class="text-danger small mb-2">{{ matrix.fehler }}</div>

                <template v-if="matrix.ergebnis">
                    <div v-if="matrix.ergebnis.urteil?.identisch" class="alert alert-secondary py-2 px-3 small mb-2">
                        {{ t('strategies.matrixIdentical') }}
                    </div>
                    <div v-else-if="matrix.ergebnis.urteil"
                         class="alert py-2 px-3 small mb-2"
                         :class="matrix.ergebnis.urteil.bestanden ? 'alert-success' : 'alert-warning'">
                        <strong>{{ matrix.ergebnis.urteil.bestanden
                            ? t('strategies.matrixPassed') : t('strategies.matrixFailedVerdict') }}</strong>
                        —
                        {{ t('strategies.matrixScore', {
                            besser: matrix.ergebnis.urteil.besser,
                            felder: matrix.ergebnis.urteil.felder,
                        }) }}
                    </div>
                    <div class="table-responsive">
                        <table class="table table-sm table-borderless mb-0 small">
                            <thead>
                                <tr class="text-muted">
                                    <th>{{ t('strategies.symbol') }}</th>
                                    <th>{{ t('strategies.matrixWindow') }}</th>
                                    <th class="text-end">{{ t('strategies.kpiTrades') }}</th>
                                    <th class="text-end" v-if="matrix.ergebnis.urteil">{{ t('strategies.matrixBase') }}</th>
                                    <th class="text-end">{{ t('strategies.matrixCandidate') }}</th>
                                    <th class="text-end" v-if="matrix.ergebnis.urteil">Δ</th>
                                    <th class="text-end">{{ t('strategies.matrixWithoutBest') }}</th>
                                    <th class="text-end">{{ t('strategies.kpiMaxDd') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="(z, i) in matrix.ergebnis.zeilen" :key="i">
                                    <td>{{ z.symbol }}</td>
                                    <td>{{ z.fenster === 'optimierung'
                                        ? t('strategies.matrixWindowOpt') : t('strategies.matrixWindowCheck') }}</td>
                                    <td class="text-end" :class="{ 'text-warning': z.kandidat.trades < 30 }">
                                        {{ z.kandidat.trades }}
                                    </td>
                                    <td class="text-end" v-if="matrix.ergebnis.urteil">
                                        {{ matrixZahl(z.basis?.expectancyR) }}
                                    </td>
                                    <td class="text-end">{{ matrixZahl(z.kandidat.expectancyR) }}</td>
                                    <td class="text-end" v-if="matrix.ergebnis.urteil"
                                        :class="z.deltaR >= 0 ? 'greenTrade' : 'redTrade'">
                                        {{ z.deltaR >= 0 ? '+' : '' }}{{ matrixZahl(z.deltaR) }}
                                    </td>
                                    <td class="text-end">{{ matrixZahl(z.kandidat.ohneBestenR) }}</td>
                                    <td class="text-end">{{ matrixZahl(z.kandidat.maxDrawdownPct, 2) }} %</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p class="text-muted small mt-2 mb-0">{{ t('strategies.matrixFootnote') }}</p>
                </template>
            </div>

            <!-- ══ Ergebnis ══ -->
            <div v-if="ergebnis" class="dailyCard p-3 mb-3">
                <div class="section-title mb-2">{{ t('strategies.result') }}</div>
                <div v-if="!ergebnis.stats.trades" class="text-muted small">
                    {{ ergebnis.stats.hinweis || t('strategies.noTradesInPeriod') }}
                </div>
                <template v-else>
                    <!-- Zwei Warnungen, die vor jeder Zahl kommen müssen: zu
                         wenige Trades machen jede Kennzahl zum Zufall, und ein
                         unvollständiger Zeitraum misst still etwas anderes. -->
                    <div v-if="!ergebnis.stats.belastbar" class="alert alert-warning py-2 px-3 small mb-2">
                        <i class="uil uil-exclamation-triangle me-1"></i>
                        {{ t('strategies.nichtBelastbar', {
                            trades: ergebnis.stats.trades,
                            mindest: ergebnis.stats.mindestTrades,
                        }) }}
                    </div>
                    <div v-if="ergebnis.stats.abdeckung && !ergebnis.stats.abdeckung.vollstaendig"
                        class="alert alert-danger py-2 px-3 small mb-2">
                        <i class="uil uil-database me-1"></i>
                        {{ t('strategies.abdeckungLuecke', {
                            prozent: zahl(ergebnis.stats.abdeckung.prozent, 0),
                            vorhanden: ergebnis.stats.abdeckung.vorhanden,
                            erwartet: ergebnis.stats.abdeckung.erwartet,
                        }) }}
                        <template v-if="ergebnis.stats.abdeckung.fehlend.length">
                            — {{ t('strategies.abdeckungFehlt', { rand: ergebnis.stats.abdeckung.fehlend.join(' + ') }) }}
                            ({{ datum(ergebnis.stats.abdeckung.von) }} – {{ datum(ergebnis.stats.abdeckung.bis) }})
                        </template>
                    </div>

                    <!-- Ein Lauf, der wie ein gefilterter aussieht, aber keiner
                         war, ist die gefährlichste Sorte Ergebnis: man vergleicht
                         ihn mit gefilterten Läufen und zieht den falschen Schluss. -->
                    <div v-if="ergebnis.stats.htfFilter?.verlangt && !ergebnis.stats.htfFilter.aktiv"
                        class="alert alert-danger py-2 px-3 small mb-2">
                        <i class="uil uil-filter-slash me-1"></i>
                        {{ t('strategies.htfFilterInaktiv', {
                            tf: ergebnis.stats.htfFilter.timeframe,
                            kerzen: ergebnis.stats.htfFilter.kerzen,
                        }) }}
                    </div>

                    <!-- Der Hebel im Formular ist nicht zwingend der, mit dem
                         gerechnet wurde: der Betrieb kappt global, und das Labor
                         tut es seit dem Audit auch. Wer das nicht sieht,
                         vergleicht ein Laborergebnis mit einem Papierlauf, der
                         andere Positionsgrössen hatte. -->
                    <div v-if="ergebnis.stats.leverageGekappt" class="alert alert-warning py-2 px-3 small mb-2">
                        <i class="uil uil-compress-arrows me-1"></i>
                        {{ t('strategies.hebelGekappt', { hebel: ergebnis.stats.leverageEffektiv }) }}
                    </div>

                    <!-- Ein Lauf ohne Finanzierungskosten ist nicht dasselbe wie
                         einer, in dem sie nichts gekostet haben. Deshalb steht die
                         Annahme dabei — in beide Richtungen. -->
                    <div v-if="ergebnis.stats.trades" class="small text-muted mb-2">
                        <template v-if="ergebnis.stats.fundingModelliert">
                            <i class="uil uil-percentage me-1"></i>
                            {{ t('strategies.fundingKosten', {
                                bps: ergebnis.stats.fundingBpsPer8h,
                                betrag: geld(ergebnis.stats.funding),
                            }) }}
                        </template>
                        <template v-else>
                            <i class="uil uil-info-circle me-1"></i>
                            {{ t('strategies.fundingNichtModelliert') }}
                        </template>
                    </div>

                    <!-- Am Stichtag noch offene Positionen zählen in KEINER
                         Kennzahl mit — weder in Trefferquote und Erwartung noch
                         in Rendite und Rückgang. Was sie wert wären, steht
                         deshalb hier daneben statt still in der Rendite. -->
                    <div v-if="ergebnis.stats.nochOffen" class="alert alert-secondary py-2 px-3 small mb-2">
                        <i class="uil uil-clock me-1"></i>
                        {{ t('strategies.offenAmEnde', {
                            anzahl: ergebnis.stats.nochOffen,
                            wert: zahl(ergebnis.stats.unrealisiertPnl, 2),
                        }) }}
                    </div>

                    <!-- Sharpe ist `null`, wenn er nicht messbar ist (zu kurzer
                         Zeitraum oder eine Kurve ganz ohne Schwankung). Dann steht
                         hier ein Strich — eine 0 wäre an dieser Stelle keine
                         fehlende Zahl, sondern eine falsche Behauptung. -->
                    <div class="row g-2 mb-3">
                        <div class="col-4 col-md-2" v-for="k in [
                            { l: t('strategies.kpiTrades'), v: ergebnis.stats.trades },
                            { l: t('strategies.kpiWinRate'), v: zahl(ergebnis.stats.winRate, 1) + ' %' },
                            { l: t('strategies.kpiExpectancy'), v: zahl(ergebnis.stats.expectancyR) + ' R',
                              farbe: ergebnis.stats.expectancyR >= 0 },
                            { l: t('strategies.kpiExpectancyOhneTop'), v: zahl(ergebnis.stats.expectancyROhneTop) + ' R',
                              farbe: ergebnis.stats.expectancyROhneTop >= 0 },
                            { l: t('strategies.kpiProfitFactor'),
                              v: profitFaktor(ergebnis.stats.profitFactor, ergebnis.stats.trades),
                              farbe: profitFaktorGut(ergebnis.stats.profitFactor) },
                            { l: t('strategies.kpiNetPnl'), v: geld(ergebnis.stats.netPnl),
                              farbe: ergebnis.stats.netPnl >= 0 },
                            { l: t('strategies.kpiMaxDd'), v: zahl(ergebnis.stats.maxDrawdownPct, 1) + ' %' },
                            { l: t('strategies.kpiSharpe'),
                              v: ergebnis.stats.sharpe === null || ergebnis.stats.sharpe === undefined
                                  ? '—' : zahl(ergebnis.stats.sharpe, 2),
                              farbe: ergebnis.stats.sharpe === null || ergebnis.stats.sharpe === undefined
                                  ? undefined : ergebnis.stats.sharpe >= 1 },
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
                                <th :title="t('strategies.regCostsHint')">{{ t('strategies.regCosts') }}</th>
                                <th>{{ t('strategies.regDecision') }}</th>
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
                                <!-- Kostenmodell und Regelfassung: ohne beides ist
                                     ein alter Lauf nicht nachstellbar. -->
                                <td class="small text-muted" style="white-space: nowrap;">
                                    <!-- Läufe von vor der Maker/Taker-Aufteilung tragen
                                         nur einen Satz — der wird als solcher gezeigt,
                                         nicht in zwei erfundene Zahlen aufgeteilt. -->
                                    <template v-if="l.risk && l.risk.feeTakerBps !== undefined">
                                        {{ l.risk.feeMakerBps }}/{{ l.risk.feeTakerBps }}+{{ l.risk.slippageBps }} bp
                                    </template>
                                    <template v-else-if="l.risk && l.risk.feeBps !== undefined">
                                        {{ l.risk.feeBps }}+{{ l.risk.slippageBps }} bp
                                    </template>
                                    <template v-else>–</template>
                                    <span v-if="l.ruleVersion" class="badge bg-dark ms-1">v{{ l.ruleVersion }}</span>
                                    <span v-if="l.variantenGeprueft > 1" class="badge bg-warning text-dark ms-1"
                                        :title="t('strategies.regVariantsHint')">
                                        {{ t('strategies.regVariants', { n: l.variantenGeprueft }) }}
                                    </span>
                                </td>
                                <td style="white-space: nowrap;">
                                    <span v-if="l.entscheidung && l.entscheidung !== 'offen'"
                                        class="badge me-1" :class="l.entscheidung === 'uebernommen' ? 'bg-success' : 'bg-secondary'"
                                        :title="l.notiz || ''">
                                        {{ t('strategies.dec_' + l.entscheidung) }}
                                    </span>
                                    <button class="btn btn-sm btn-outline-success py-0 px-1"
                                        :title="t('strategies.dec_uebernommen')"
                                        @click="laufEntscheiden(l, 'uebernommen')"><i class="uil uil-check"></i></button>
                                    <button class="btn btn-sm btn-outline-secondary py-0 px-1 ms-1"
                                        :title="t('strategies.dec_verworfen')"
                                        @click="laufEntscheiden(l, 'verworfen')"><i class="uil uil-times"></i></button>
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

/* Abgeblendete Knöpfe waren auf dunklem Grund kaum zu entziffern — Bootstraps
   Vorgabe senkt die Deckkraft so weit, dass die Beschriftung verschwindet. */
.robustKnoepfe .btn:disabled {
    opacity: 1;
    color: var(--white-40, rgba(255, 255, 255, 0.45));
    border-color: var(--white-12, rgba(255, 255, 255, 0.15));
}

.stufenLeiste {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
}

.stufenTitel {
    font-size: 0.8rem;
    color: var(--white-60, rgba(255, 255, 255, 0.6));
    margin-right: 0.15rem;
}

.stufenWert {
    font-size: 0.8rem;
    padding: 0.1rem 0.45rem;
    border-radius: var(--border-radius, 6px);
    background: var(--white-6, rgba(255, 255, 255, 0.08));
    border: 1px solid var(--white-12, rgba(255, 255, 255, 0.12));
}

tr.besterWert {
    background: rgba(77, 144, 254, 0.10);
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
