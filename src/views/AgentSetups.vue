<script setup>
/**
 * Erkannte Setups mit Chart.
 *
 * Der Chart ist hier kein Beiwerk: ein LSOB lässt sich ohne eingezeichnete
 * Order-Block-Zone und Sweep-Level nicht beurteilen. Wer prüfen will, ob der
 * Detector die Regeln des Referenz-PDFs richtig anwendet, braucht genau dieses
 * Bild — deshalb liegt es direkt an der Setup-Liste.
 */
import { ref, computed, onBeforeMount, onBeforeUnmount, nextTick } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { spinnerLoadingPage } from '../stores/ui.js'
import SpinnerLoadingPage from '../components/SpinnerLoadingPage.vue'
import { useSetupChart } from '../utils/charts.js'
import { useBotTradeChart } from '../utils/botChart.js'
import { useXDecCurrencyFormat } from '../utils/formatters.js'
import { logError } from '../utils/logger.js'
import dayjs from '../utils/dayjs-setup.js'

const { t } = useI18n()

const instanzen = ref([])
const setups = ref([])
const positionen = ref([])
const gewaehlt = ref(null)
const chartFehler = ref('')
const gezeigterTrade = ref(null)
const filter = ref({ instanceId: '', status: '' })
let chart = null
let pollTimer = null

const zahl = (v, n = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(n) : '–')
const geld = (v) => useXDecCurrencyFormat(Number(v) || 0, 2)
const zeit = (t) => (t ? dayjs(Number(t)).format('DD.MM.YY HH:mm') : '–')

const statusFarbe = (s) => ({
    open: 'bg-primary', closed: 'bg-secondary', triggered: 'bg-info text-dark',
    waiting_retest: 'bg-warning text-dark', armed: 'bg-warning text-dark',
    invalidated: 'bg-danger', expired: 'bg-dark', rejected: 'bg-danger',
}[s] || 'bg-dark')

const instanzVon = (id) => instanzen.value.find((i) => i.id === id) || null

async function laden() {
    try {
        const p = { limit: 300 }
        if (filter.value.instanceId) p.instanceId = filter.value.instanceId
        if (filter.value.status) p.status = filter.value.status
        const [s, pos] = await Promise.all([
            axios.get('/api/strategies/setups', { params: p }),
            axios.get('/api/db/strategy_positions', { params: { equalTo: JSON.stringify({ status: 'open' }) } }),
        ])
        setups.value = s.data
        positionen.value = pos.data
    } catch (e) {
        logError('AgentSetups', 'Laden fehlgeschlagen', e)
    }
}

onBeforeMount(async () => {
    spinnerLoadingPage.value = true
    try {
        instanzen.value = (await axios.get('/api/strategies/instances')).data
    } catch (e) { /* Filter ist optional */ }
    await laden()
    spinnerLoadingPage.value = false
    pollTimer = setInterval(laden, 30000)
})

onBeforeUnmount(() => {
    if (pollTimer) clearInterval(pollTimer)
    chart?.dispose()
})

/**
 * Kerzen rund um das Setup holen und zeichnen. Der Ausschnitt beginnt bewusst
 * einige Kerzen vor dem Sweep, damit das gesweepte Swing-Level sichtbar ist.
 */
async function anzeigen(setup) {
    gewaehlt.value = setup
    chartFehler.value = ''
    await nextTick()

    try {
        const inst = instanzVon(setup.instanceId)
        const markt = inst?.market || 'futures'
        const r = await axios.get('/api/binance/klines', {
            params: {
                symbol: setup.symbol, interval: setup.timeframe,
                market: markt, limit: 200,
            },
        })
        const candles = r.data.map((k) => ({
            t: Number(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4],
        }))
        // Ist das Setup schon zu einem Trade geworden, zeigt der Journal-Chart
        // mehr: Ein- und Ausstieg, SL/TP und den Höchststand dazwischen. Die
        // Order-Block-Zone kommt aus dem Setup obendrauf.
        let trade = null
        if (setup.status === 'closed' || setup.status === 'open') {
            try {
                const tr = await axios.get('/api/db/strategy_trades', {
                    params: { equalTo: JSON.stringify({ setupId: setup.objectId ?? setup.id }), limit: 1 },
                })
                trade = tr.data?.[0] || null
            } catch (e) { /* ohne Trade bleibt der Setup-Chart */ }
        }
        gezeigterTrade.value = trade

        chart?.dispose()
        chart = trade
            ? await useBotTradeChart('setupChart', candles, trade, setup)
            : useSetupChart('setupChart', candles, setup)
        if (!chart) chartFehler.value = t('strategies.chartFailed')
    } catch (e) {
        logError('AgentSetups', 'Kerzen laden fehlgeschlagen', e)
        chartFehler.value = t('strategies.chartFailed')
    }
}

async function positionSchliessen(pos) {
    try {
        await axios.post(`/api/strategies/positions/${pos.id}/close`)
        await laden()
    } catch (e) {
        logError('AgentSetups', 'Position schliessen fehlgeschlagen', e)
    }
}

const gruende = computed(() => {
    const m = {}
    for (const s of setups.value) {
        const g = s.invalidReason || s.rejectReason
        if (g) m[g] = (m[g] || 0) + 1
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
})
</script>

<template>
    <SpinnerLoadingPage />
    <div v-show="!spinnerLoadingPage" class="row mt-3 ps-3 pe-3">
        <div class="col-12 col-xl-11">

            <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
                <h5 class="mb-0 me-auto">{{ t('strategies.setupsTitle') }}</h5>
                <select v-model="filter.instanceId" class="form-select form-select-sm w-auto" @change="laden">
                    <option value="">{{ t('strategies.allInstances') }}</option>
                    <option v-for="i in instanzen" :key="i.id" :value="i.id">{{ i.name }}</option>
                </select>
                <select v-model="filter.status" class="form-select form-select-sm w-auto" @change="laden">
                    <option value="">{{ t('strategies.allStatus') }}</option>
                    <option value="waiting_retest,armed">{{ t('strategies.statusWaiting') }}</option>
                    <option value="open">{{ t('strategies.statusOpen') }}</option>
                    <option value="closed">{{ t('strategies.statusClosed') }}</option>
                    <option value="invalidated,expired,rejected">{{ t('strategies.statusDead') }}</option>
                </select>
            </div>

            <!-- Offene Positionen -->
            <div v-if="positionen.length" class="dailyCard p-3 mb-3">
                <div class="section-title mb-2">{{ t('strategies.openPositions') }}</div>
                <div class="table-responsive">
                    <table class="table table-sm table-borderless mb-0">
                        <thead>
                            <tr class="text-muted small">
                                <th>{{ t('strategies.symbol') }}</th>
                                <th>{{ t('strategies.direction') }}</th>
                                <th class="text-end">{{ t('strategies.qty') }}</th>
                                <th class="text-end">{{ t('strategies.entry') }}</th>
                                <th class="text-end">{{ t('strategies.stop') }}</th>
                                <th class="text-end">{{ t('strategies.target') }}</th>
                                <th class="text-end">{{ t('strategies.notional') }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="p in positionen" :key="p.id">
                                <td class="small">{{ p.symbol }}</td>
                                <td class="small" :class="p.direction === 'long' ? 'greenTrade' : 'redTrade'">
                                    {{ p.direction === 'long' ? 'LONG' : 'SHORT' }}
                                </td>
                                <td class="text-end small">{{ p.qty }}</td>
                                <td class="text-end small">{{ zahl(p.entryPrice) }}</td>
                                <td class="text-end small">{{ zahl(p.stopLoss) }}</td>
                                <td class="text-end small">{{ p.takeProfit ? zahl(p.takeProfit) : '–' }}</td>
                                <td class="text-end small">{{ geld(p.notionalUsdt) }}</td>
                                <td class="text-end">
                                    <button class="btn btn-sm btn-outline-danger py-0"
                                        @click="positionSchliessen(p)">
                                        {{ t('strategies.close') }}
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Chart des gewählten Setups -->
            <div v-if="gewaehlt" class="dailyCard p-3 mb-3">
                <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                    <strong>{{ gewaehlt.symbol }}</strong>
                    <span class="badge bg-dark">{{ gewaehlt.timeframe }}</span>
                    <span class="badge" :class="gewaehlt.direction === 'long' ? 'bg-success' : 'bg-danger'">
                        {{ gewaehlt.direction === 'long' ? 'LONG' : 'SHORT' }}
                    </span>
                    <span class="badge" :class="statusFarbe(gewaehlt.status)">
                        {{ t('strategies.status_' + gewaehlt.status) }}
                    </span>
                    <span v-if="gewaehlt.invalidReason" class="badge bg-dark">
                        {{ t('strategies.reason_' + gewaehlt.invalidReason) }}
                    </span>
                    <button class="btn btn-sm btn-outline-secondary ms-auto py-0" @click="gewaehlt = null">
                        <i class="uil uil-times"></i>
                    </button>
                </div>
                <div id="setupChart" style="height: 340px;"></div>
                <div v-if="chartFehler" class="text-muted small mt-2">{{ chartFehler }}</div>
                <div class="d-flex flex-wrap gap-3 mt-2 small text-muted">
                    <span>{{ t('strategies.zone') }}: {{ zahl(gewaehlt.obLow) }} – {{ zahl(gewaehlt.obHigh) }}</span>
                    <span>{{ t('strategies.entry') }}: {{ zahl(gewaehlt.entry) }}</span>
                    <span>{{ t('strategies.stop') }}: {{ zahl(gewaehlt.stopLoss) }}</span>
                    <span>{{ t('strategies.target') }}: {{ gewaehlt.takeProfit ? zahl(gewaehlt.takeProfit) : '–' }}</span>
                    <span>RR: {{ zahl(gewaehlt.rr) }}</span>
                    <span>{{ t('strategies.sweepAt') }}: {{ zeit(gewaehlt.sweepCandleTime) }}</span>
                </div>
            </div>

            <!-- Gründeübersicht -->
            <div v-if="gruende.length" class="dailyCard p-3 mb-3">
                <div class="section-title mb-2">{{ t('strategies.whyLost') }}</div>
                <span v-for="[g, n] in gruende" :key="g" class="badge bg-dark me-2 mb-1">
                    {{ t('strategies.reason_' + g) }}: {{ n }}
                </span>
            </div>

            <!-- Setup-Liste -->
            <div v-if="!setups.length" class="dailyCard p-4 text-center text-muted">
                {{ t('strategies.noSetups') }}
            </div>
            <div v-else class="dailyCard p-3">
                <div class="table-responsive">
                    <table class="table table-sm table-borderless mb-0">
                        <thead>
                            <tr class="text-muted small">
                                <th>{{ t('strategies.symbol') }}</th>
                                <th>{{ t('strategies.direction') }}</th>
                                <th>{{ t('strategies.statusLabel') }}</th>
                                <th class="text-end">{{ t('strategies.entry') }}</th>
                                <th class="text-end">{{ t('strategies.stop') }}</th>
                                <th class="text-end">RR</th>
                                <th>{{ t('strategies.sweepAt') }}</th>
                                <th>{{ t('strategies.reasonLabel') }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="s in setups" :key="s.id" class="pointerClass"
                                :class="gewaehlt?.id === s.id ? 'table-active' : ''" @click="anzeigen(s)">
                                <td class="small">{{ s.symbol }}</td>
                                <td class="small" :class="s.direction === 'long' ? 'greenTrade' : 'redTrade'">
                                    {{ s.direction === 'long' ? 'LONG' : 'SHORT' }}
                                </td>
                                <td><span class="badge" :class="statusFarbe(s.status)">
                                    {{ t('strategies.status_' + s.status) }}</span></td>
                                <td class="text-end small">{{ zahl(s.entry) }}</td>
                                <td class="text-end small">{{ zahl(s.stopLoss) }}</td>
                                <td class="text-end small">{{ zahl(s.rr) }}</td>
                                <td class="small">{{ zeit(s.sweepCandleTime) }}</td>
                                <td class="small text-muted">
                                    {{ s.invalidReason || s.rejectReason
                                        ? t('strategies.reason_' + (s.invalidReason || s.rejectReason)) : '' }}
                                </td>
                                <td class="text-end"><i class="uil uil-chart-line text-muted"></i></td>
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
</style>
