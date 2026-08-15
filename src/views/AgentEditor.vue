<script setup>
/**
 * Strategie-Editor.
 *
 * Hier entstehen Strategien ohne eine Zeile Code: Bausteine zusammenstellen,
 * prüfen lassen, backtesten. Der Server führt die Beschreibung mit einem festen
 * Interpreter aus — es wird nichts erzeugt und nichts ausgewertet, was von hier
 * kommt.
 *
 * Der Aufbau folgt dem Lebenslauf eines Setups, weil Strategien so gedacht
 * werden: Was löst aus? Was muss dabei stimmen? Wann steige ich ein? Was bricht
 * ab? Wo liegen Stop und Ziel?
 */
import { ref, computed, onBeforeMount } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { spinnerLoadingPage } from '../stores/ui.js'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import { logError } from '../utils/logger.js'
import { apiFehlerText } from '../utils/apiError.js'

const { t } = useI18n()

const bausteine = ref({ indikatoren: [], signale: [], einstieg: [], vergleiche: [], anker: [], ziele: [] })
const vorlagen = ref([])
const liste = ref([])
const meldung = ref('')
const fehler = ref('')
const pruefung = ref(null)

const entwurf = ref(null)
const istNeu = ref(false)
const speichert = ref(false)

// ── Backtest direkt aus dem Editor ──────────────────────────────────────
const test = ref({ symbol: 'BTCUSDT', timeframe: '1h', tage: 180 })
const testLaeuft = ref(false)
const testErgebnis = ref(null)

const ZEITEINHEITEN = ['5m', '15m', '30m', '1h', '4h', '1d']

async function laden() {
    try {
        const [b, l] = await Promise.all([
            axios.get('/api/strategies/rules/blocks'),
            axios.get('/api/strategies/rules'),
        ])
        bausteine.value = b.data.bausteine
        vorlagen.value = b.data.vorlagen
        liste.value = l.data
    } catch (e) {
        logError('AgentEditor', 'Laden fehlgeschlagen', e)
        fehler.value = apiFehlerText(e, t('strategies.loadFailed'), t)
    }
}

onBeforeMount(async () => {
    spinnerLoadingPage.value = true
    await laden()
    spinnerLoadingPage.value = false
})

/** Alle Referenzen, die in einem Vergleich stehen dürfen. */
const referenzen = computed(() => [
    ...(bausteine.value.anker || []),
    ...(entwurf.value?.rules.indicators || []).map((i) => i.id),
])

const parameterNamen = computed(() => (entwurf.value?.rules.params || []).map((p) => p.key))

/** Farbe der Marktphasen-Badge: Trend blau, Seitwärts gelb, Rest neutral. */
function marktKlasse(markt) {
    const m = String(markt || '').toLowerCase()
    if (m.startsWith('seitwärts')) return 'marktSeitwaerts'
    if (m.startsWith('trend') || m.startsWith('bullentrend')) return 'marktTrend'
    return 'marktNeutral'
}

function ausVorlage(v) {
    istNeu.value = true
    entwurf.value = {
        strategyId: v.key,
        name: v.titel,
        description: v.beschreibung,
        rules: JSON.parse(JSON.stringify(v.rules)),
    }
    testErgebnis.value = null
    pruefen()
}

function leer() {
    istNeu.value = true
    entwurf.value = {
        strategyId: '', name: '', description: '',
        rules: {
            timeframes: ['1h'], direction: 'long', warmupCandles: 300,
            params: [], indicators: [], signal: { type: 'pivotHigh', left: 5, right: 2 },
            // `signalPrice` als Vorgabe: ein frisches Regelwerk soll LAUFFÄHIG
            // starten — ein leerer Anker begrüsste den Nutzer sonst mit einem
            // kryptischen Validierungsfehler, bevor er irgendetwas getan hat.
            signalFilters: [], entry: { type: 'touch', anchor: 'signalPrice', from: 'above' },
            invalidations: [{ type: 'timeout', code: 'zu_lang', candles: 20 }],
            stopLoss: { anchor: 'correctionLow', offsetPct: 0.3 },
            takeProfit: { mode: 'rr', rr: 2 },
            breakEvenAtR: 1,
        },
    }
    testErgebnis.value = null
    pruefung.value = null
}

function bearbeiten(row) {
    istNeu.value = false
    entwurf.value = {
        id: row.id, strategyId: row.strategyId, name: row.name,
        description: row.description, rules: JSON.parse(JSON.stringify(row.rules)),
    }
    testErgebnis.value = null
    pruefen()
}

/** Prüfung ohne Speichern — zeigt Fehler, während man baut. */
async function pruefen() {
    if (!entwurf.value) return
    try {
        const r = await axios.post('/api/strategies/rules/validate', {
            rules: { ...entwurf.value.rules, id: entwurf.value.strategyId || 'entwurf', name: entwurf.value.name },
        })
        pruefung.value = r.data
    } catch (e) {
        pruefung.value = null
    }
}

// ── Bausteine hinzufügen und entfernen ──────────────────────────────────
const r = () => entwurf.value.rules

function indikatorHinzu() {
    const n = r().indicators.length + 1
    r().indicators.push({ id: `ema${n}`, type: 'ema', period: 20 })
    pruefen()
}
const indikatorWeg = (i) => { r().indicators.splice(i, 1); pruefen() }

function paramHinzu() {
    r().params.push({ key: `wert${r().params.length + 1}`, type: 'number', label: '', default: 1, min: 0, max: 100, step: 0.1 })
    pruefen()
}
const paramWeg = (i) => { r().params.splice(i, 1); pruefen() }

function bedingungHinzu(liste) {
    r()[liste].push({ left: 'close', op: 'gt', right: referenzen.value[0] || 'close', code: '' })
    pruefen()
}
const bedingungWeg = (l, i) => { r()[l].splice(i, 1); pruefen() }

function abbruchHinzu(typ) {
    if (typ === 'timeout') r().invalidations.push({ type: 'timeout', code: 'zu_lang', candles: 20 })
    else r().invalidations.push({ type: 'condition', code: 'abbruch', when: { op: 'isBullish' } })
    pruefen()
}
const abbruchWeg = (i) => { r().invalidations.splice(i, 1); pruefen() }

const zeiteinheitAn = (tf) => {
    const l = r().timeframes
    const i = l.indexOf(tf)
    if (i >= 0) l.splice(i, 1); else l.push(tf)
    pruefen()
}

/** Referenz kann Text (Anker/Indikator) oder Parameter sein. */
function refText(ref) {
    if (ref && typeof ref === 'object') return ref.param ? `param:${ref.param}` : String(ref.value ?? '')
    return String(ref ?? '')
}
function refSetzen(obj, feld, wert) {
    obj[feld] = wert.startsWith('param:') ? { param: wert.slice(6) } : wert
    pruefen()
}

// ── Speichern, Kopieren, Löschen ────────────────────────────────────────
async function sichern() {
    speichert.value = true
    fehler.value = ''
    meldung.value = ''
    try {
        const daten = {
            strategyId: entwurf.value.strategyId,
            name: entwurf.value.name,
            description: entwurf.value.description,
            rules: entwurf.value.rules,
        }
        if (istNeu.value) {
            const a = await axios.post('/api/strategies/rules', daten)
            entwurf.value.id = a.data.id
            istNeu.value = false
            meldung.value = t('strategies.editorSaved', { id: a.data.strategyId })
        } else {
            await axios.put(`/api/strategies/rules/${entwurf.value.id}`, daten)
            meldung.value = t('strategies.saved')
        }
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    } finally {
        speichert.value = false
    }
}

const loeschFrage = ref(null)
async function loeschen(row) {
    try {
        await axios.delete(`/api/strategies/rules/${row.id}`)
        loeschFrage.value = null
        if (entwurf.value?.id === row.id) entwurf.value = null
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.deleteFailed'), t)
    }
}

async function kopieren(row) {
    try {
        await axios.post(`/api/strategies/rules/${row.id}/duplicate`)
        await laden()
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    }
}

// ── Test ────────────────────────────────────────────────────────────────
async function testen() {
    if (!entwurf.value?.id) {
        fehler.value = t('strategies.saveBeforeTest')
        return
    }
    testLaeuft.value = true
    fehler.value = ''
    testErgebnis.value = null
    try {
        const toTs = Date.now()
        const a = await axios.post('/api/strategies/backtest', {
            strategyId: entwurf.value.strategyId,
            symbol: test.value.symbol.toUpperCase(),
            timeframe: test.value.timeframe,
            fromTs: toTs - Number(test.value.tage) * 86400000,
            toTs,
            startEquity: 1000,
            label: entwurf.value.name,
            risk: { cooldownMinutes: 0, minRR: 0 },
            save: false,
        })
        testErgebnis.value = a.data
    } catch (e) {
        fehler.value = apiFehlerText(e, t('strategies.backtestFailed'), t)
    } finally {
        testLaeuft.value = false
    }
}

const zahl = (v, n = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))
const sortiert = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1])
</script>

<template>
    <SpinnerLoadingPage />
    <div v-show="!spinnerLoadingPage" class="row mt-3 ps-3 pe-3">
        <div class="col-12 col-xl-11">

            <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
                <h5 class="mb-0 me-auto">{{ t('strategies.editorTitle') }}</h5>
                <button class="btn btn-sm btn-outline-secondary" @click="leer">
                    <i class="uil uil-plus me-1"></i>{{ t('strategies.emptyStrategy') }}
                </button>
            </div>

            <div class="alert alert-secondary py-2 small">
                <i class="uil uil-info-circle me-1"></i>{{ t('strategies.editorIntro') }}
            </div>
            <div v-if="meldung" class="alert alert-info py-2">{{ meldung }}</div>
            <div v-if="fehler" class="alert alert-danger py-2">{{ fehler }}</div>

            <!-- ══ Vorlagen ══ -->
            <div v-if="!entwurf" class="row g-3 mb-3">
                <div v-for="v in vorlagen" :key="v.key" class="col-12 col-md-4">
                    <div class="dailyCard p-3 h-100 d-flex flex-column">
                        <strong>{{ v.titel }}</strong>
                        <div v-if="v.markt" class="mt-1">
                            <span class="badge marktBadge" :class="marktKlasse(v.markt)">
                                <i class="uil uil-chart-line me-1"></i>{{ v.markt }}
                            </span>
                        </div>
                        <p class="small text-muted flex-grow-1 mt-1">{{ v.beschreibung }}</p>
                        <button class="btn btn-sm btn-outline-primary" @click="ausVorlage(v)">
                            {{ t('strategies.useTemplate') }}
                        </button>
                    </div>
                </div>
            </div>

            <!-- ══ Editor ══ -->
            <template v-if="entwurf">
                <div class="dailyCard p-3 mb-3">
                    <div class="row g-2 mb-3">
                        <div class="col-12 col-md-3">
                            <label class="form-label small mb-1">{{ t('strategies.shortName') }}</label>
                            <input v-model="entwurf.strategyId" class="form-control form-control-sm"
                                :disabled="!istNeu" placeholder="meine_strategie" @change="pruefen" />
                        </div>
                        <div class="col-12 col-md-4">
                            <label class="form-label small mb-1">{{ t('strategies.name') }}</label>
                            <input v-model="entwurf.name" class="form-control form-control-sm" @change="pruefen" />
                        </div>
                        <div class="col-12 col-md-5">
                            <label class="form-label small mb-1">{{ t('strategies.descriptionLabel') }}</label>
                            <input v-model="entwurf.description" class="form-control form-control-sm" />
                        </div>
                        <div class="col-12 col-md-6">
                            <label class="form-label small mb-1">{{ t('strategies.timeframes') }}</label><br>
                            <span v-for="tf in ZEITEINHEITEN" :key="tf"
                                :class="['badge me-1 pointerClass', entwurf.rules.timeframes.includes(tf) ? 'bg-primary' : 'bg-dark']"
                                @click="zeiteinheitAn(tf)">{{ tf }}</span>
                        </div>
                        <div class="col-6 col-md-3">
                            <label class="form-label small mb-1">{{ t('strategies.direction') }}</label>
                            <select v-model="entwurf.rules.direction" class="form-select form-select-sm" @change="pruefen">
                                <option value="long">Long</option>
                                <option value="short">Short</option>
                            </select>
                        </div>
                    </div>

                    <!-- Prüfung -->
                    <div v-if="pruefung && !pruefung.ok" class="alert alert-warning py-2 small mb-3">
                        <strong>{{ t('strategies.notYetValid') }}</strong>
                        <ul class="mb-0 ps-3">
                            <li v-for="(f, i) in pruefung.fehler" :key="i">{{ f }}</li>
                        </ul>
                    </div>
                    <div v-else-if="pruefung?.hinweise?.length" class="alert alert-secondary py-2 small mb-3">
                        <ul class="mb-0 ps-3"><li v-for="(h, i) in pruefung.hinweise" :key="i">{{ h }}</li></ul>
                    </div>

                    <!-- ── 1. Parameter ── -->
                    <div class="block">
                        <div class="block-title">
                            <span class="nr">1</span>{{ t('strategies.blockParams') }}
                            <button class="btn btn-sm btn-outline-secondary py-0 ms-auto" @click="paramHinzu">+</button>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockParamsHint') }}</p>
                        <div v-for="(p, i) in entwurf.rules.params" :key="i" class="row g-1 mb-1 align-items-center">
                            <div class="col-3"><input v-model="p.key" class="form-control form-control-sm" placeholder="name" @change="pruefen" /></div>
                            <div class="col-4"><input v-model="p.label" class="form-control form-control-sm" :placeholder="t('strategies.labelPlaceholder')" /></div>
                            <div class="col-2">
                                <select v-model="p.type" class="form-select form-select-sm" @change="pruefen">
                                    <option value="number">{{ t('strategies.typeNumber') }}</option>
                                    <option value="integer">{{ t('strategies.typeInteger') }}</option>
                                    <option value="boolean">{{ t('strategies.typeBoolean') }}</option>
                                </select>
                            </div>
                            <div class="col-1"><input v-model.number="p.default" type="number" class="form-control form-control-sm" @change="pruefen" /></div>
                            <div class="col-1"><input v-model.number="p.min" type="number" class="form-control form-control-sm" @change="pruefen" /></div>
                            <div class="col-1 d-flex gap-1">
                                <input v-model.number="p.max" type="number" class="form-control form-control-sm" @change="pruefen" />
                                <button class="btn btn-sm btn-outline-danger py-0" @click="paramWeg(i)"><i class="uil uil-times"></i></button>
                            </div>
                        </div>
                    </div>

                    <!-- ── 2. Indikatoren ── -->
                    <div class="block">
                        <div class="block-title">
                            <span class="nr">2</span>{{ t('strategies.blockIndicators') }}
                            <button class="btn btn-sm btn-outline-secondary py-0 ms-auto" @click="indikatorHinzu">+</button>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockIndicatorsHint') }}</p>
                        <div v-for="(ind, i) in entwurf.rules.indicators" :key="i" class="row g-1 mb-1">
                            <div class="col-4"><input v-model="ind.id" class="form-control form-control-sm" @change="pruefen" /></div>
                            <div class="col-3">
                                <select v-model="ind.type" class="form-select form-select-sm" @change="pruefen">
                                    <option v-for="x in bausteine.indikatoren" :key="x" :value="x">{{ t('strategies.ind_' + x) }}</option>
                                </select>
                            </div>
                            <div class="col-4">
                                <!-- VWAP braucht statt einer Periode einen Anker; das Band
                                     zusätzlich den Faktor der Standardabweichung. -->
                                <template v-if="['vwap','vwapBand'].includes(ind.type)">
                                    <div class="d-flex gap-1">
                                        <select v-model="ind.anchor" class="form-select form-select-sm" @change="pruefen">
                                            <option value="session">{{ t('strategies.vwapAnchorSession') }}</option>
                                            <option value="rolling">{{ t('strategies.vwapAnchorRolling') }}</option>
                                        </select>
                                        <input v-if="ind.anchor === 'rolling'" v-model.number="ind.period" type="number" min="2"
                                            class="form-control form-control-sm" style="max-width:5rem" @change="pruefen" />
                                        <select v-if="ind.type === 'vwapBand'" class="form-select form-select-sm"
                                            style="max-width:7rem" :value="refText(ind.mult)"
                                            :title="t('strategies.vwapMultHint')"
                                            @change="refSetzen(ind, 'mult', $event.target.value)">
                                            <option v-for="m in [1,1.5,2,2.5,3,-1,-1.5,-2,-2.5,-3]" :key="m" :value="String(m)">{{ m }}σ</option>
                                            <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ pk }}</option>
                                        </select>
                                    </div>
                                </template>
                                <select v-else class="form-select form-select-sm" :value="refText(ind.period)"
                                    @change="refSetzen(ind, 'period', $event.target.value)">
                                    <option v-for="n in [9,14,20,21,50,100,200]" :key="n" :value="String(n)">{{ n }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                </select>
                            </div>
                            <div class="col-1"><button class="btn btn-sm btn-outline-danger py-0 w-100" @click="indikatorWeg(i)"><i class="uil uil-times"></i></button></div>
                        </div>
                    </div>

                    <!-- ── 3. Signal ── -->
                    <div class="block">
                        <div class="block-title"><span class="nr">3</span>{{ t('strategies.blockSignal') }}</div>
                        <p class="block-hint">{{ t('strategies.blockSignalHint') }}</p>
                        <div class="row g-1">
                            <div class="col-4">
                                <select v-model="entwurf.rules.signal.type" class="form-select form-select-sm" @change="pruefen">
                                    <option v-for="s in bausteine.signale" :key="s" :value="s">{{ t('strategies.signal_' + s) }}</option>
                                </select>
                            </div>
                            <template v-if="['pivotHigh','pivotLow'].includes(entwurf.rules.signal.type)">
                                <div class="col-4">
                                    <input v-model.number="entwurf.rules.signal.left" type="number" min="1" class="form-control form-control-sm"
                                        :placeholder="t('strategies.leftBars')" @change="pruefen" />
                                </div>
                                <div class="col-4">
                                    <input v-model.number="entwurf.rules.signal.right" type="number" min="1" class="form-control form-control-sm"
                                        :placeholder="t('strategies.rightBars')" @change="pruefen" />
                                </div>
                            </template>
                            <template v-else>
                                <div class="col-4">
                                    <select class="form-select form-select-sm" :value="refText(entwurf.rules.signal.a)"
                                        @change="refSetzen(entwurf.rules.signal, 'a', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="col-4">
                                    <select class="form-select form-select-sm" :value="refText(entwurf.rules.signal.b)"
                                        @change="refSetzen(entwurf.rules.signal, 'b', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- ── 4. Signalfilter ── -->
                    <div class="block">
                        <div class="block-title">
                            <span class="nr">4</span>{{ t('strategies.blockFilters') }}
                            <button class="btn btn-sm btn-outline-secondary py-0 ms-auto" @click="bedingungHinzu('signalFilters')">+</button>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockFiltersHint') }}</p>
                        <div v-for="(b, i) in entwurf.rules.signalFilters" :key="i" class="row g-1 mb-1">
                            <div class="col-3">
                                <select class="form-select form-select-sm" :value="refText(b.left)"
                                    @change="refSetzen(b, 'left', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                </select>
                            </div>
                            <div class="col-3">
                                <select v-model="b.op" class="form-select form-select-sm" @change="pruefen">
                                    <option v-for="o in bausteine.vergleiche" :key="o" :value="o">{{ t('strategies.op_' + o) }}</option>
                                </select>
                            </div>
                            <div class="col-3">
                                <select class="form-select form-select-sm" :value="refText(b.right)"
                                    @change="refSetzen(b, 'right', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                </select>
                            </div>
                            <div class="col-2">
                                <select v-if="['distancePctGt','distancePctLt','isBullish','isBearish'].includes(b.op)"
                                    class="form-select form-select-sm" :value="refText(b.value)"
                                    @change="refSetzen(b, 'value', $event.target.value)">
                                    <option v-for="n in [0,0.5,1,2,2.5,5,10]" :key="n" :value="String(n)">{{ n }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ pk }}</option>
                                </select>
                            </div>
                            <div class="col-1"><button class="btn btn-sm btn-outline-danger py-0 w-100" @click="bedingungWeg('signalFilters', i)"><i class="uil uil-times"></i></button></div>
                        </div>
                    </div>

                    <!-- ── 5. Einstieg ── -->
                    <div class="block">
                        <div class="block-title"><span class="nr">5</span>{{ t('strategies.blockEntry') }}</div>
                        <p class="block-hint">{{ t('strategies.blockEntryHint') }}</p>
                        <div class="row g-1">
                            <div class="col-4">
                                <select v-model="entwurf.rules.entry.type" class="form-select form-select-sm" @change="pruefen">
                                    <option v-for="e in bausteine.einstieg" :key="e" :value="e">{{ t('strategies.entry_' + e) }}</option>
                                </select>
                            </div>
                            <template v-if="entwurf.rules.entry.type === 'touch'">
                                <div class="col-4">
                                    <select class="form-select form-select-sm" :value="refText(entwurf.rules.entry.anchor)"
                                        @change="refSetzen(entwurf.rules.entry, 'anchor', $event.target.value)">
                                        <option value="">–</option>
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="col-4">
                                    <select v-model="entwurf.rules.entry.from" class="form-select form-select-sm" @change="pruefen">
                                        <option value="above">{{ t('strategies.fromAbove') }}</option>
                                        <option value="below">{{ t('strategies.fromBelow') }}</option>
                                    </select>
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- ── 6. Abbruchgründe ── -->
                    <div class="block">
                        <div class="block-title">
                            <span class="nr">6</span>{{ t('strategies.blockInvalidations') }}
                            <button class="btn btn-sm btn-outline-secondary py-0 ms-auto me-1" @click="abbruchHinzu('condition')">
                                + {{ t('strategies.condition') }}
                            </button>
                            <button class="btn btn-sm btn-outline-secondary py-0" @click="abbruchHinzu('timeout')">
                                + {{ t('strategies.timeout') }}
                            </button>
                        </div>
                        <p class="block-hint">{{ t('strategies.blockInvalidationsHint') }}</p>
                        <div v-for="(v, i) in entwurf.rules.invalidations" :key="i" class="row g-1 mb-1">
                            <div class="col-3"><input v-model="v.code" class="form-control form-control-sm" :placeholder="t('strategies.reasonCode')" @change="pruefen" /></div>
                            <template v-if="v.type === 'timeout'">
                                <div class="col-8">
                                    <select class="form-select form-select-sm" :value="refText(v.candles)"
                                        @change="refSetzen(v, 'candles', $event.target.value)">
                                        <option v-for="n in [3,5,10,15,20,30,50]" :key="n" :value="String(n)">{{ t('strategies.afterCandles', { n }) }}</option>
                                        <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                    </select>
                                </div>
                            </template>
                            <template v-else>
                                <div class="col-3">
                                    <select class="form-select form-select-sm" :value="refText(v.when.left)"
                                        @change="refSetzen(v.when, 'left', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                                <div class="col-3">
                                    <select v-model="v.when.op" class="form-select form-select-sm" @change="pruefen">
                                        <option v-for="o in bausteine.vergleiche" :key="o" :value="o">{{ t('strategies.op_' + o) }}</option>
                                    </select>
                                </div>
                                <div class="col-2">
                                    <select class="form-select form-select-sm" :value="refText(v.when.right)"
                                        @change="refSetzen(v.when, 'right', $event.target.value)">
                                        <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                    </select>
                                </div>
                            </template>
                            <div class="col-1"><button class="btn btn-sm btn-outline-danger py-0 w-100" @click="abbruchWeg(i)"><i class="uil uil-times"></i></button></div>
                        </div>
                    </div>

                    <!-- ── 7. Stop und Ziel ── -->
                    <div class="block">
                        <div class="block-title"><span class="nr">7</span>{{ t('strategies.blockExit') }}</div>
                        <div class="row g-1 mb-2">
                            <div class="col-2 small pt-1">{{ t('strategies.stop') }}</div>
                            <div class="col-4">
                                <select class="form-select form-select-sm" :value="refText(entwurf.rules.stopLoss.anchor)"
                                    @change="refSetzen(entwurf.rules.stopLoss, 'anchor', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                </select>
                            </div>
                            <div class="col-4">
                                <select class="form-select form-select-sm" :value="refText(entwurf.rules.stopLoss.offsetPct)"
                                    @change="refSetzen(entwurf.rules.stopLoss, 'offsetPct', $event.target.value)">
                                    <option v-for="n in [0,0.1,0.2,0.3,0.5,1,2]" :key="n" :value="String(n)">{{ n }} % {{ t('strategies.beyond') }}</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                </select>
                            </div>
                        </div>
                        <div class="row g-1">
                            <div class="col-2 small pt-1">{{ t('strategies.target') }}</div>
                            <div class="col-4">
                                <select v-model="entwurf.rules.takeProfit.mode" class="form-select form-select-sm" @change="pruefen">
                                    <option v-for="z in bausteine.ziele" :key="z" :value="z">{{ t('strategies.tp_' + z) }}</option>
                                </select>
                            </div>
                            <div class="col-4">
                                <select v-if="entwurf.rules.takeProfit.mode === 'rr'" class="form-select form-select-sm"
                                    :value="refText(entwurf.rules.takeProfit.rr)"
                                    @change="refSetzen(entwurf.rules.takeProfit, 'rr', $event.target.value)">
                                    <option v-for="n in [1,1.5,2,2.5,3,4,5]" :key="n" :value="String(n)">{{ n }} R</option>
                                    <option v-for="pk in parameterNamen" :key="pk" :value="'param:' + pk">{{ t('strategies.fromParam', { name: pk }) }}</option>
                                </select>
                                <select v-else-if="entwurf.rules.takeProfit.mode === 'anchor'" class="form-select form-select-sm"
                                    :value="refText(entwurf.rules.takeProfit.anchor)"
                                    @change="refSetzen(entwurf.rules.takeProfit, 'anchor', $event.target.value)">
                                    <option v-for="x in referenzen" :key="x" :value="x">{{ x }}</option>
                                </select>
                            </div>
                            <div class="col-2">
                                <input v-model.number="entwurf.rules.breakEvenAtR" type="number" step="0.5" min="0"
                                    class="form-control form-control-sm" :title="t('strategies.breakEvenTitle')" @change="pruefen" />
                            </div>
                        </div>
                    </div>

                    <div class="d-flex gap-2 mt-3">
                        <button class="btn btn-sm btn-success" :disabled="speichert || (pruefung && !pruefung.ok)" @click="sichern">
                            <i class="uil uil-save me-1"></i>{{ t('common.save') }}
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" @click="entwurf = null">{{ t('common.cancel') }}</button>
                    </div>
                </div>

                <!-- ══ Test ══ -->
                <div class="dailyCard p-3 mb-3">
                    <div class="section-title mb-2">{{ t('strategies.testNow') }}</div>
                    <div class="row g-2 align-items-end">
                        <div class="col-4 col-md-3">
                            <label class="form-label small mb-1">{{ t('strategies.symbol') }}</label>
                            <input v-model="test.symbol" class="form-control form-control-sm" />
                        </div>
                        <div class="col-4 col-md-2">
                            <label class="form-label small mb-1">{{ t('strategies.timeframe') }}</label>
                            <select v-model="test.timeframe" class="form-select form-select-sm">
                                <option v-for="tf in entwurf.rules.timeframes" :key="tf" :value="tf">{{ tf }}</option>
                            </select>
                        </div>
                        <div class="col-4 col-md-2">
                            <label class="form-label small mb-1">{{ t('strategies.days') }}</label>
                            <input v-model.number="test.tage" type="number" min="30" max="720" class="form-control form-control-sm" />
                        </div>
                        <div class="col-12 col-md-2">
                            <button class="btn btn-sm btn-success w-100" :disabled="testLaeuft" @click="testen">
                                <span v-if="testLaeuft" class="spinner-border spinner-border-sm"></span>
                                <span v-else>{{ t('strategies.run') }}</span>
                            </button>
                        </div>
                    </div>

                    <div v-if="testErgebnis" class="mt-3">
                        <div v-if="!testErgebnis.stats.trades" class="text-muted small">
                            {{ testErgebnis.stats.hinweis || t('strategies.noTradesInPeriod') }}
                        </div>
                        <div v-else class="row g-2">
                            <div class="col-4 col-md-2" v-for="k in [
                                { l: t('strategies.kpiTrades'), v: testErgebnis.stats.trades },
                                { l: t('strategies.kpiWinRate'), v: zahl(testErgebnis.stats.winRate, 1) + ' %' },
                                { l: t('strategies.kpiExpectancy'), v: zahl(testErgebnis.stats.expectancyR) + ' R',
                                  farbe: testErgebnis.stats.expectancyR >= 0 },
                                { l: t('strategies.kpiProfitFactor'), v: zahl(testErgebnis.stats.profitFactor) },
                                { l: t('strategies.kpiNetPnl'), v: zahl(testErgebnis.stats.netPnl), farbe: testErgebnis.stats.netPnl >= 0 },
                                { l: t('strategies.kpiMaxDd'), v: zahl(testErgebnis.stats.maxDrawdownPct, 1) + ' %' },
                            ]" :key="k.l">
                                <div class="text-center p-2">
                                    <div class="kpi-label">{{ k.l }}</div>
                                    <div class="kpi-value" :class="k.farbe === undefined ? '' : (k.farbe ? 'greenTrade' : 'redTrade')">{{ k.v }}</div>
                                </div>
                            </div>
                        </div>
                        <div v-if="testErgebnis.funnel" class="row mt-2">
                            <div class="col-12 col-md-6">
                                <div class="section-title mb-1">{{ t('strategies.funnel') }}</div>
                                <table class="table table-sm table-borderless mb-0">
                                    <tbody>
                                        <tr v-for="k in ['setupsDetected','triggered','executed']" :key="k">
                                            <td class="small">{{ t('strategies.bt_' + k) }}</td>
                                            <td class="text-end small"><strong>{{ testErgebnis.funnel[k] }}</strong></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div class="col-12 col-md-6">
                                <div class="section-title mb-1">{{ t('strategies.whyLost') }}</div>
                                <table class="table table-sm table-borderless mb-0">
                                    <tbody>
                                        <tr v-for="[g, n] in sortiert(testErgebnis.funnel.invalidated)" :key="g">
                                            <td class="small">{{ g }}</td>
                                            <td class="text-end small">{{ n }}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </template>

            <!-- ══ Eigene Strategien ══ -->
            <div v-if="liste.length" class="dailyCard p-3">
                <div class="section-title mb-2">{{ t('strategies.myStrategies') }}</div>
                <div class="table-responsive">
                    <table class="table table-sm table-borderless mb-0">
                        <tbody>
                            <tr v-for="s in liste" :key="s.id">
                                <td class="small pointerClass" @click="bearbeiten(s)"><strong>{{ s.name }}</strong></td>
                                <td class="small text-muted">{{ s.strategyId }}</td>
                                <td class="small">
                                    <span class="badge" :class="s.geladen ? 'bg-success' : 'bg-danger'">
                                        {{ s.geladen ? t('strategies.loaded') : t('strategies.notLoaded') }}
                                    </span>
                                </td>
                                <td class="small text-muted">{{ (s.rules.timeframes || []).join(', ') }}</td>
                                <td class="text-end" style="white-space: nowrap;">
                                    <button class="btn btn-sm btn-outline-secondary py-0 me-1" :title="t('strategies.duplicate')"
                                        @click="kopieren(s)"><i class="uil uil-copy"></i></button>
                                    <template v-if="loeschFrage === s.id">
                                        <button class="btn btn-sm btn-danger py-0 me-1" @click="loeschen(s)">{{ t('common.yes') }}</button>
                                        <button class="btn btn-sm btn-outline-secondary py-0" @click="loeschFrage = null">{{ t('common.no') }}</button>
                                    </template>
                                    <button v-else class="btn btn-sm btn-outline-danger py-0" @click="loeschFrage = s.id">
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
.dailyCard {
    height: auto;
}

.section-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--white-60, rgba(255, 255, 255, 0.6));
}

.block {
    border-top: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
    padding-top: 0.7rem;
    margin-top: 0.7rem;
}

/* Marktphasen-Badge auf den Vorlagen-Karten */
.marktBadge {
    font-weight: 500;
    white-space: normal;
    text-align: left;
}
.marktTrend {
    background: rgba(1, 180, 255, 0.12);
    border: 1px solid rgba(1, 180, 255, 0.45);
    color: rgba(1, 180, 255, 0.95);
}
.marktSeitwaerts {
    background: rgba(240, 196, 25, 0.12);
    border: 1px solid rgba(240, 196, 25, 0.45);
    color: rgba(240, 196, 25, 0.95);
}
.marktNeutral {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.25);
    color: rgba(255, 255, 255, 0.75);
}

.block-title {
    display: flex;
    align-items: center;
    font-size: 0.85rem;
    font-weight: 600;
    margin-bottom: 0.2rem;
}

.block-title .nr {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3rem;
    height: 1.3rem;
    margin-right: 0.5rem;
    border-radius: 50%;
    background: var(--blue-color, #01B4FF);
    color: #fff;
    font-size: 0.7rem;
}

.block-hint {
    font-size: 0.74rem;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
    margin-bottom: 0.5rem;
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
