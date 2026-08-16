<script setup>
/**
 * Auswertung der Agent-Trades.
 *
 * Wertet ausschliesslich `strategy_trades` aus — die echten Journal-Kennzahlen
 * bleiben unberührt, Paper-Ergebnisse verfälschen also weder Dashboard noch
 * Kontostand.
 *
 * Kernstück ist der Setup-Trichter: er zeigt nicht nur WIE GUT, sondern WO
 * Setups verloren gehen. Genau diese Daten lesen später auch die Agenten, um
 * Parameter-Verbesserungen vorzuschlagen.
 */
import { ref, computed, onBeforeMount, onBeforeUnmount, nextTick } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import { spinnerLoadingPage } from '../stores/ui.js'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import { useXDecCurrencyFormat } from '../utils/formatters.js'
import { useAgentTimelineChart } from '../utils/charts.js'
import { logError } from '../utils/logger.js'
import dayjs from '../utils/dayjs-setup.js'

const { t } = useI18n()

const instanzen = ref([])
const daten = ref(null)
const laden = ref(false)
const filter = ref({ instanceId: '', mode: '', symbol: '', paramsVersion: '', from: '', to: '' })
let equityChart = null
let rChart = null
let zeitstrahlChart = null

// Zeitstrahl: was der Agent im Kursverlauf gesehen und getan hat
const zsSymbol = ref('')
const zsTage = ref(7)
const zsMeldung = ref('')
const zsLaedt = ref(false)

const geld = (v) => useXDecCurrencyFormat(Number(v) || 0, 2)
const zahl = (v, n = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(n))

/**
 * Der Profit-Faktor ist ohne Verlust-Trades nicht definiert. Er kommt dann als
 * `null` — das darf nicht als 0 durchgehen, sonst liest sich ein makelloser
 * Verlauf wie ein Totalausfall.
 */
const profitFaktor = (v, trades) => (v === null || v === undefined ? (trades > 0 ? '∞' : '–') : zahl(v))
const profitFaktorGut = (v) => v === null || v === undefined || v >= 1

const kpi = computed(() => daten.value?.kpis || {})

// ── Brücke: vom Trade zurück zur Fassung, unter der er entstand ────────
// `paramsVersion` steht am Trade, die Werte dazu in der Historie. Ohne diesen
// Weg zeigt ein alter Trade auf eine Strategie, deren Einstellungen inzwischen
// andere sind — und niemand kann mehr sagen, wonach gehandelt wurde.
const kontextFuer = ref(null)
const kontext = ref(null)
const kontextLaedt = ref(false)

async function kontextZeigen(tr) {
    if (kontextFuer.value === tr.id) { kontextFuer.value = null; kontext.value = null; return }
    kontextFuer.value = tr.id
    kontext.value = null
    kontextLaedt.value = true
    try {
        const r = await axios.get(`/api/strategies/trades/${tr.id}/context`)
        kontext.value = r.data
    } catch (e) {
        logError('AgentPerformance', 'Kontext laden fehlgeschlagen', e)
    } finally {
        kontextLaedt.value = false
    }
}

/** Die letzten Trades, neueste zuerst. */
// ── Mehrfachauswahl: spiegeln und wieder entfernen ──────────────────────
const gewaehlt = ref(new Set())
const spiegelLaeuft = ref(false)
const spiegelMeldung = ref('')

const alleGewaehlt = computed(() =>
    letzteTrades.value.length > 0 && letzteTrades.value.every((t) => gewaehlt.value.has(t.id)))

function auswahlUmschalten(tr) {
    const neu = new Set(gewaehlt.value)
    if (neu.has(tr.id)) neu.delete(tr.id); else neu.add(tr.id)
    gewaehlt.value = neu
}

function alleUmschalten() {
    gewaehlt.value = alleGewaehlt.value ? new Set() : new Set(letzteTrades.value.map((t) => t.id))
}

/** Gewählte Trades ins Journal spiegeln — je Instanz, weil der Endpunkt daran hängt. */
async function gewaehlteSpiegeln() {
    const ids = [...gewaehlt.value]
    if (!ids.length) return
    spiegelLaeuft.value = true
    spiegelMeldung.value = ''
    try {
        // Nach Instanz gruppieren: ein Trade gehört immer genau einer.
        const proInstanz = new Map()
        for (const tr of letzteTrades.value) {
            if (!gewaehlt.value.has(tr.id)) continue
            if (!proInstanz.has(tr.instanceId)) proInstanz.set(tr.instanceId, [])
            proInstanz.get(tr.instanceId).push(tr.id)
        }
        let gespiegelt = 0
        let uebersprungen = 0
        for (const [instanceId, tradeIds] of proInstanz) {
            const r = await axios.post(`/api/strategies/instances/${instanceId}/mirror-journal`, { tradeIds })
            gespiegelt += r.data.gespiegelt || 0
            uebersprungen += r.data.uebersprungen || 0
        }
        spiegelMeldung.value = t('strategies.mirrorDone', { n: gespiegelt, u: uebersprungen })
    } catch (e) {
        spiegelMeldung.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    } finally {
        spiegelLaeuft.value = false
    }
}

/** Gewählte wieder aus dem Journal nehmen. */
async function gewaehlteEntfernen() {
    const ids = [...gewaehlt.value]
    if (!ids.length) return
    spiegelLaeuft.value = true
    spiegelMeldung.value = ''
    try {
        const r = await axios.post('/api/strategies/journal/unmirror', { tradeIds: ids })
        spiegelMeldung.value = t('strategies.unmirrorDone', { n: r.data.entfernt || 0 })
    } catch (e) {
        spiegelMeldung.value = apiFehlerText(e, t('strategies.saveFailed'), t)
    } finally {
        spiegelLaeuft.value = false
    }
}

const letzteTrades = computed(() => [...(daten.value?.trades || [])]
    .sort((a, b) => Number(b.exitTime) - Number(a.exitTime)).slice(0, 60))
const trichter = computed(() => daten.value?.funnel || {})

/** Symbole aus den geladenen Instanzen — spart einen eigenen Endpunkt. */
const symbole = computed(() => [...new Set(instanzen.value.flatMap((i) => i.symbols || []))])
const versionen = computed(() =>
    (daten.value?.byGroup?.paramsVersion || []).map((g) => g.key).sort((a, b) => a - b))

async function holen() {
    laden.value = true
    try {
        const p = {}
        for (const [k, v] of Object.entries(filter.value)) {
            if (v !== '' && v !== null) p[k] = v
        }
        if (p.from) p.from = dayjs(p.from).valueOf()
        if (p.to) p.to = dayjs(p.to).endOf('day').valueOf()

        const r = await axios.get('/api/strategies/performance', { params: p })
        daten.value = r.data
        await nextTick()
        zeichne()
        await zeitstrahlLaden()
    } catch (e) {
        logError('AgentPerformance', 'Auswertung laden fehlgeschlagen', e)
    } finally {
        laden.value = false
    }
}

/** Zeiteinheit einer Instanz ('1h', '15m', '4h') in Minuten. */
function tfMinuten(tf) {
    const m = String(tf || '1h').match(/^(\d+)([mhd])$/)
    if (!m) return 60
    return Number(m[1]) * (m[2] === 'm' ? 1 : m[2] === 'h' ? 60 : 1440)
}

/**
 * Kurs, Zonen und Trades eines Symbols zusammenführen.
 *
 * Bewusst NICHT an `kpi.trades` gebunden: gerade solange noch kein Trade
 * abgeschlossen ist, ist die Frage »sieht der Agent überhaupt etwas?« am
 * wichtigsten — dann zeigt der Chart eben nur Zonen.
 */
async function zeitstrahlLaden() {
    const symbol = zsSymbol.value || filter.value.symbol || symbole.value[0] || ''
    zsSymbol.value = symbol
    zsMeldung.value = ''
    if (!symbol) return

    // Instanz, die dieses Symbol handelt — sie bestimmt Zeiteinheit und Markt.
    const inst = instanzen.value.find((i) => (i.symbols || []).includes(symbol)) || instanzen.value[0]
    const timeframe = inst?.timeframe || '1h'
    const limit = Math.min(1000, Math.ceil((zsTage.value * 1440) / tfMinuten(timeframe)) + 5)

    zsLaedt.value = true
    try {
        const [k, s] = await Promise.all([
            axios.get('/api/binance/klines', {
                params: { symbol, interval: timeframe, market: inst?.market || 'futures', limit },
            }),
            axios.get('/api/strategies/setups', {
                params: { symbol, limit: 500, ...(filter.value.instanceId ? { instanceId: filter.value.instanceId } : {}) },
            }),
        ])
        const candles = k.data.map((c) => ({ t: Number(c[0]), o: +c[1], h: +c[2], l: +c[3], c: +c[4] }))
        if (!candles.length) { zsMeldung.value = t('strategies.timelineNoData'); return }

        const trades = (daten.value?.trades || []).filter((x) => x.symbol === symbol)
        if (!s.data.length && !trades.length) zsMeldung.value = t('strategies.timelineNoSetups', { symbol })

        await nextTick()
        zeitstrahlChart?.dispose()
        zeitstrahlChart = useAgentTimelineChart('agentZeitstrahl', candles, s.data, trades)
    } catch (e) {
        logError('AgentPerformance', 'Zeitstrahl laden fehlgeschlagen', e)
        zsMeldung.value = t('strategies.chartFailed')
    } finally {
        zsLaedt.value = false
    }
}

onBeforeMount(async () => {
    spinnerLoadingPage.value = true
    try {
        instanzen.value = (await axios.get('/api/strategies/instances')).data
    } catch (e) { /* Filterliste ist optional */ }
    await holen()
    spinnerLoadingPage.value = false
    // Gezeichnet wird noch hinter dem Ladebalken — der Inhalt hängt dort an
    // `v-show`, ist also `display:none`, und ECharts misst dann eine Breite von
    // null. Erst nach dem Einblenden stimmen die Masse.
    await nextTick()
    groesseAnpassen()
    window.addEventListener('resize', groesseAnpassen)
})

onBeforeUnmount(() => {
    window.removeEventListener('resize', groesseAnpassen)
    equityChart?.dispose()
    rChart?.dispose()
    zeitstrahlChart?.dispose()
})

function groesseAnpassen() {
    equityChart?.resize()
    rChart?.resize()
    zeitstrahlChart?.resize()
}

const achse = { axisLine: { lineStyle: { color: 'rgba(255,255,255,0.38)' } },
                axisLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10 } }

function zeichne() {
    const kurve = daten.value?.equityCurve || []
    const el = document.getElementById('agentEquityChart')
    if (el && kurve.length) {
        equityChart?.dispose()
        equityChart = echarts.init(el)
        equityChart.setOption({
            backgroundColor: 'transparent',
            grid: { left: 8, right: 12, top: 16, bottom: 20, containLabel: true },
            tooltip: { trigger: 'axis', backgroundColor: 'hsl(0,0%,5%)', borderColor: 'rgba(255,255,255,0.15)',
                       textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 11 } },
            xAxis: { type: 'category', ...achse,
                     data: kurve.map((p) => dayjs(p.t).format('DD.MM')), splitLine: { show: false } },
            yAxis: { type: 'value', scale: true, ...achse,
                     splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
            series: [{
                type: 'line', smooth: true, showSymbol: false,
                data: kurve.map((p) => p.equity),
                lineStyle: { color: '#01B4FF', width: 2 },
                areaStyle: { color: 'rgba(1,180,255,0.12)' },
            }],
        })
    }

    const r = daten.value?.rVerteilung || []
    const el2 = document.getElementById('agentRChart')
    if (el2 && r.length) {
        rChart?.dispose()
        rChart = echarts.init(el2)
        rChart.setOption({
            backgroundColor: 'transparent',
            grid: { left: 8, right: 12, top: 16, bottom: 20, containLabel: true },
            tooltip: { trigger: 'axis', backgroundColor: 'hsl(0,0%,5%)', borderColor: 'rgba(255,255,255,0.15)',
                       textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 11 } },
            xAxis: { type: 'category', ...achse, splitLine: { show: false },
                     data: r.map((b) => (b.bis === null || !Number.isFinite(b.bis) ? `≥${b.von}R` : `${b.von}…${b.bis}R`)) },
            yAxis: { type: 'value', ...achse, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
            series: [{
                type: 'bar',
                data: r.map((b) => ({
                    value: b.n,
                    itemStyle: { color: b.von < 0 ? 'rgba(235,87,87,0.85)' : 'rgba(72,199,142,0.85)' },
                })),
            }],
        })
    }
}

/** Anteil in Prozent für die Trichter-Balken. */
function anteil(wert) {
    const basis = trichter.value.erkannt || 0
    return basis > 0 ? Math.min(100, (wert / basis) * 100) : 0
}

const trichterStufen = computed(() => [
    { key: 'erkannt', wert: trichter.value.erkannt || 0 },
    { key: 'getriggert', wert: trichter.value.getriggert || 0 },
    { key: 'ausgefuehrt', wert: trichter.value.ausgefuehrt || 0 },
    { key: 'gewonnen', wert: trichter.value.gewonnen || 0 },
])

const sortiert = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])
const wochentag = (n) => t('strategies.weekday' + n)
</script>

<template>
    <SpinnerLoadingPage />
    <div v-show="!spinnerLoadingPage" class="row mt-3 ps-3 pe-3">
        <div class="col-12 col-xl-11">

            <h5 class="mb-3">{{ t('strategies.performanceTitle') }}</h5>

            <!-- Filter -->
            <div class="dailyCard p-3 mb-3">
                <div class="row g-2 align-items-end">
                    <div class="col-6 col-md-3">
                        <label class="form-label small mb-1">{{ t('strategies.instance') }}</label>
                        <select v-model="filter.instanceId" class="form-select form-select-sm" @change="holen">
                            <option value="">{{ t('strategies.all') }}</option>
                            <option v-for="i in instanzen" :key="i.id" :value="i.id">{{ i.name }}</option>
                        </select>
                    </div>
                    <div class="col-6 col-md-2">
                        <label class="form-label small mb-1">{{ t('strategies.modeLabel') }}</label>
                        <select v-model="filter.mode" class="form-select form-select-sm" @change="holen">
                            <option value="">{{ t('strategies.all') }}</option>
                            <option value="paper">{{ t('strategies.mode_paper') }}</option>
                            <option value="shadow">{{ t('strategies.mode_shadow') }}</option>
                            <option value="live">{{ t('strategies.mode_live') }}</option>
                        </select>
                    </div>
                    <div class="col-6 col-md-2">
                        <label class="form-label small mb-1">{{ t('strategies.symbol') }}</label>
                        <select v-model="filter.symbol" class="form-select form-select-sm" @change="holen">
                            <option value="">{{ t('strategies.all') }}</option>
                            <option v-for="s in symbole" :key="s" :value="s">{{ s }}</option>
                        </select>
                    </div>
                    <div class="col-6 col-md-2">
                        <label class="form-label small mb-1">{{ t('strategies.paramsVersion') }}</label>
                        <select v-model="filter.paramsVersion" class="form-select form-select-sm" @change="holen">
                            <option value="">{{ t('strategies.all') }}</option>
                            <option v-for="v in versionen" :key="v" :value="v">v{{ v }}</option>
                        </select>
                    </div>
                    <div class="col-6 col-md-3 d-flex gap-2">
                        <div class="flex-fill">
                            <label class="form-label small mb-1">{{ t('strategies.from') }}</label>
                            <input v-model="filter.from" type="date" class="form-control form-control-sm" @change="holen" />
                        </div>
                        <div class="flex-fill">
                            <label class="form-label small mb-1">{{ t('strategies.to') }}</label>
                            <input v-model="filter.to" type="date" class="form-control form-control-sm" @change="holen" />
                        </div>
                    </div>
                </div>
            </div>

            <!-- Zeitstrahl: Zonen und Trades des Agenten im Kursverlauf -->
            <div class="dailyCard p-3 mb-3">
                <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
                    <span class="section-title mb-0">
                        <i class="uil uil-chart-line me-1"></i>{{ t('strategies.timelineTitle') }}
                    </span>
                    <div class="ms-auto d-flex gap-2">
                        <select v-model="zsSymbol" class="form-select form-select-sm w-auto" @change="zeitstrahlLaden">
                            <option v-for="s in symbole" :key="s" :value="s">{{ s }}</option>
                        </select>
                        <select v-model.number="zsTage" class="form-select form-select-sm w-auto" @change="zeitstrahlLaden">
                            <option :value="3">3 {{ t('strategies.days') }}</option>
                            <option :value="7">7 {{ t('strategies.days') }}</option>
                            <option :value="14">14 {{ t('strategies.days') }}</option>
                            <option :value="30">30 {{ t('strategies.days') }}</option>
                        </select>
                    </div>
                </div>
                <p class="text-muted small mb-2">{{ t('strategies.timelineHint') }}</p>
                <div v-if="zsMeldung" class="text-muted small mb-2">{{ zsMeldung }}</div>
                <div id="agentZeitstrahl" class="chartClass" style="height: 380px;"></div>
            </div>

            <div v-if="!kpi.trades" class="dailyCard p-4 text-center text-muted mb-3">
                {{ t('strategies.noTrades') }}
            </div>

            <template v-else>
                <!-- Kennzahlen -->
                <div class="row g-2 mb-3">
                    <div class="col-6 col-md-3 col-xl-2" v-for="k in [
                        { l: t('strategies.kpiTrades'), v: kpi.trades },
                        { l: t('strategies.kpiWinRate'), v: zahl(kpi.winRate, 1) + ' %' },
                        // Die Verliererseite gehört gleichberechtigt daneben: eine
                        // Trefferquote allein sagt nichts darüber, wie die Verluste
                        // aussahen — und genau dort entscheidet sich das Ergebnis.
                        { l: t('strategies.kpiWinsLosses'), v: (kpi.wins ?? 0) + ' / ' + (kpi.losses ?? 0) },
                        { l: t('strategies.kpiAvgWinLoss'),
                          v: zahl(kpi.avgWinR) + ' / ' + zahl(kpi.avgLossR) + ' R' },
                        { l: t('strategies.kpiNetPnl'), v: geld(kpi.netPnl), farbe: kpi.netPnl >= 0 },
                        { l: t('strategies.kpiExpectancy'), v: zahl(kpi.expectancyR) + ' R', farbe: kpi.expectancyR >= 0 },
                        { l: t('strategies.kpiProfitFactor'), v: profitFaktor(kpi.profitFactor, kpi.trades),
                          farbe: profitFaktorGut(kpi.profitFactor) },
                        { l: t('strategies.kpiMaxDd'), v: zahl(kpi.maxDrawdownPct, 1) + ' %' },
                    ]" :key="k.l">
                        <div class="dailyCard p-2 text-center h-100">
                            <div class="kpi-label">{{ k.l }}</div>
                            <div class="kpi-value"
                                :class="k.farbe === undefined ? '' : (k.farbe ? 'greenTrade' : 'redTrade')">
                                {{ k.v }}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Hinweise aus den Daten -->
                <div v-if="daten.hinweise?.length" class="dailyCard p-3 mb-3">
                    <div class="section-title mb-2">
                        <i class="uil uil-lightbulb-alt me-1"></i>{{ t('strategies.observations') }}
                    </div>
                    <ul class="mb-0 ps-3">
                        <li v-for="(h, i) in daten.hinweise" :key="i" class="small mb-1">{{ h.text }}</li>
                    </ul>
                </div>

                <div class="row g-3 mb-3">
                    <div class="col-12 col-lg-7">
                        <div class="dailyCard p-3">
                            <div class="section-title mb-2">{{ t('strategies.equityCurve') }}</div>
                            <div id="agentEquityChart" style="height: 240px;"></div>
                        </div>
                    </div>
                    <div class="col-12 col-lg-5">
                        <div class="dailyCard p-3">
                            <div class="section-title mb-2">{{ t('strategies.rDistribution') }}</div>
                            <div id="agentRChart" style="height: 240px;"></div>
                        </div>
                    </div>
                </div>
            </template>

            <!-- ══ Setup-Trichter ══ -->
            <div class="row g-3 mb-3">
                <div class="col-12 col-lg-6">
                    <div class="dailyCard p-3 h-100">
                        <div class="section-title mb-2">{{ t('strategies.funnel') }}</div>
                        <p class="text-muted small">{{ t('strategies.funnelHint') }}</p>
                        <div v-for="s in trichterStufen" :key="s.key" class="funnel-row">
                            <div class="d-flex justify-content-between small">
                                <span>{{ t('strategies.funnel_' + s.key) }}</span>
                                <strong>{{ s.wert }}</strong>
                            </div>
                            <div class="funnel-bar">
                                <div class="funnel-fill" :style="{ width: anteil(s.wert) + '%' }"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="col-12 col-lg-6">
                    <div class="dailyCard p-3 h-100">
                        <div class="section-title mb-2">{{ t('strategies.whyLost') }}</div>
                        <p class="text-muted small">{{ t('strategies.whyLostHint') }}</p>

                        <table class="table table-sm table-borderless mb-0">
                            <tbody>
                                <tr v-for="[grund, n] in sortiert(trichter.byInvalidReason)" :key="'i' + grund">
                                    <td class="small">{{ t('strategies.reason_' + grund) }}</td>
                                    <td class="text-end small"><strong>{{ n }}</strong></td>
                                    <td class="text-end small text-muted" style="width: 4rem;">
                                        {{ zahl(anteil(n), 0) }} %
                                    </td>
                                </tr>
                                <tr v-for="[grund, n] in sortiert(trichter.byRejectReason)" :key="'r' + grund">
                                    <td class="small text-warning">{{ t('strategies.reason_' + grund) }}</td>
                                    <td class="text-end small"><strong>{{ n }}</strong></td>
                                    <td class="text-end small text-muted">{{ zahl(anteil(n), 0) }} %</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- ══ Einzelne Trades ══
                 Bisher zeigte die Auswertung nur Summen. Ein Trade, den man
                 nicht anschauen kann, lässt sich auch nicht beurteilen. -->
            <div v-if="letzteTrades.length" class="dailyCard p-3 mb-3">
                <div class="d-flex align-items-center gap-2 mb-2 flex-wrap">
                    <div class="section-title mb-0">{{ t('strategies.tradeList') }}</div>
                    <template v-if="gewaehlt.size">
                        <span class="badge bg-primary">{{ t('strategies.selected', { n: gewaehlt.size }) }}</span>
                        <button class="btn btn-sm btn-outline-primary py-0" :disabled="spiegelLaeuft"
                            @click="gewaehlteSpiegeln">
                            <i class="uil uil-import me-1"></i>{{ t('strategies.mirrorJournal') }}
                        </button>
                        <button class="btn btn-sm btn-outline-secondary py-0" :disabled="spiegelLaeuft"
                            @click="gewaehlteEntfernen">
                            <i class="uil uil-times me-1"></i>{{ t('strategies.unmirrorJournal') }}
                        </button>
                    </template>
                    <span v-if="spiegelMeldung" class="small text-muted ms-auto">{{ spiegelMeldung }}</span>
                </div>
                <div class="table-responsive">
                    <table class="table table-sm table-borderless mb-0">
                        <thead>
                            <tr class="text-muted small">
                                <th style="width:2rem">
                                    <input type="checkbox" class="form-check-input" :checked="alleGewaehlt"
                                        :title="t('strategies.selectAll')" @change="alleUmschalten" />
                                </th>
                                <th>{{ t('strategies.exitTime') }}</th>
                                <th>{{ t('strategies.symbol') }}</th>
                                <th>{{ t('strategies.timeframe') }}</th>
                                <th>{{ t('strategies.direction') }}</th>
                                <th class="text-end">R</th>
                                <th class="text-end">PnL</th>
                                <th>{{ t('strategies.byExitReason') }}</th>
                                <th class="text-end">{{ t('strategies.paramsVersion') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <template v-for="tr in letzteTrades" :key="tr.id">
                                <tr class="pointerClass" @click="kontextZeigen(tr)">
                                    <td @click.stop>
                                        <input type="checkbox" class="form-check-input"
                                            :checked="gewaehlt.has(tr.id)" @change="auswahlUmschalten(tr)" />
                                    </td>
                                    <td class="small text-muted">{{ dayjs(Number(tr.exitTime)).format('DD.MM. HH:mm') }}</td>
                                    <td class="small">{{ tr.symbol }}</td>
                                    <td class="small">{{ tr.timeframe }}</td>
                                    <td class="small">{{ tr.direction }}</td>
                                    <td class="text-end small" :class="tr.rMultiple >= 0 ? 'greenTrade' : 'redTrade'">
                                        {{ zahl(tr.rMultiple) }}
                                    </td>
                                    <td class="text-end small" :class="tr.netPnl >= 0 ? 'greenTrade' : 'redTrade'">
                                        {{ geld(tr.netPnl) }}
                                    </td>
                                    <td class="small text-muted">{{ tr.exitReason }}</td>
                                    <td class="text-end small">
                                        <span class="badge bg-dark">v{{ tr.paramsVersion }}</span>
                                    </td>
                                </tr>
                                <tr v-if="kontextFuer === tr.id">
                                    <td colspan="9" class="kontextZelle">
                                        <div v-if="kontextLaedt" class="small text-muted">…</div>
                                        <div v-else-if="kontext">
                                            <div class="small mb-2">
                                                <strong>{{ t('strategies.contextTitle') }}</strong>
                                                <span class="text-muted">
                                                    — {{ kontext.instanz?.name }},
                                                    {{ t('strategies.paramsVersion') }} {{ kontext.paramsVersion }}
                                                    <template v-if="kontext.ruleVersion">· {{ t('strategies.ruleVersion') }} {{ kontext.ruleVersion }}</template>
                                                </span>
                                            </div>
                                            <div v-if="kontext.saetze?.length" class="mb-2">
                                                <div v-for="s in kontext.saetze" :key="s.titel" class="small">
                                                    <span class="text-muted">{{ s.titel }}:</span> {{ s.text }}
                                                </div>
                                            </div>
                                            <div v-if="kontext.params" class="small">
                                                <span class="text-muted">{{ t('strategies.contextParams') }}:</span>
                                                <span v-for="(v, k) in kontext.params" :key="k" class="paramChip">{{ k }}={{ v }}</span>
                                            </div>
                                            <div v-else class="small text-muted">{{ t('strategies.contextNoHistory') }}</div>
                                        </div>
                                    </td>
                                </tr>
                            </template>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- ══ Aufschlüsselungen ══ -->
            <div v-if="kpi.trades" class="row g-3">
                <div class="col-12 col-md-6 col-xl-3"
                    v-for="g in [
                        { titel: t('strategies.bySymbol'), rows: daten.byGroup.symbol },
                        { titel: t('strategies.byDirection'), rows: daten.byGroup.direction },
                        { titel: t('strategies.byExitReason'), rows: daten.byGroup.exitReason },
                        { titel: t('strategies.byParamsVersion'), rows: daten.byGroup.paramsVersion },
                    ]" :key="g.titel">
                    <div class="dailyCard p-3 h-100">
                        <div class="section-title mb-2">{{ g.titel }}</div>
                        <table class="table table-sm table-borderless mb-0">
                            <thead>
                                <tr class="text-muted small">
                                    <th></th>
                                    <th class="text-end">n</th>
                                    <th class="text-end" :title="t('strategies.kpiWinsLosses')">G/V</th>
                                    <th class="text-end">Ø R</th>
                                    <th class="text-end">PnL</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="row in g.rows" :key="row.key">
                                    <td class="small">{{ row.key }}</td>
                                    <td class="text-end small">{{ row.trades }}</td>
                                    <td class="text-end small">
                                        <span class="greenTrade">{{ row.wins }}</span><span class="text-muted">/</span><span class="redTrade">{{ row.trades - row.wins }}</span>
                                    </td>
                                    <td class="text-end small" :class="row.avgR >= 0 ? 'greenTrade' : 'redTrade'">
                                        {{ zahl(row.avgR) }}
                                    </td>
                                    <td class="text-end small" :class="row.netPnl >= 0 ? 'greenTrade' : 'redTrade'">
                                        {{ geld(row.netPnl) }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="col-12 col-xl-6">
                    <div class="dailyCard p-3">
                        <div class="section-title mb-2">{{ t('strategies.mfeReached') }}</div>
                        <p class="text-muted small">{{ t('strategies.mfeHint') }}</p>
                        <div class="d-flex gap-3">
                            <div v-for="(n, stufe) in kpi.mfeReached" :key="stufe" class="text-center flex-fill">
                                <div class="kpi-value">{{ n }}</div>
                                <div class="kpi-label">≥ {{ stufe }}</div>
                                <div class="kpi-label text-muted">{{ zahl((n / kpi.trades) * 100, 0) }} %</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="col-12 col-xl-6">
                    <div class="dailyCard p-3">
                        <div class="section-title mb-2">{{ t('strategies.byWeekday') }}</div>
                        <table class="table table-sm table-borderless mb-0">
                            <tbody>
                                <tr v-for="row in daten.byGroup.weekday" :key="row.key">
                                    <td class="small">{{ wochentag(row.key) }}</td>
                                    <td class="text-end small">{{ row.trades }}</td>
                                    <td class="text-end small">{{ zahl(row.winRate, 0) }} %</td>
                                    <td class="text-end small" :class="row.netPnl >= 0 ? 'greenTrade' : 'redTrade'">
                                        {{ geld(row.netPnl) }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
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

.kpi-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
}

.kpi-value {
    font-size: 1.15rem;
    font-weight: 600;
}

.section-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--white-60, rgba(255, 255, 255, 0.6));
}

.funnel-row {
    margin-bottom: 0.55rem;
}

.funnel-bar {
    height: 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.07);
    overflow: hidden;
}

.funnel-fill {
    height: 100%;
    background: linear-gradient(90deg, #01B4FF, #48c78e);
    transition: width 0.3s ease;
}
</style>
