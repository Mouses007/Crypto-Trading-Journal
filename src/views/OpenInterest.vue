<script setup>
/**
 * Open-Interest-Verlauf.
 *
 * Bewusst ECharts statt eigenem Canvas: das hier ist eine gewöhnliche
 * Zeitreihe mit zwei Achsen, kein Hochfrequenz-Rendering. Der Canvas-Apparat
 * der Heatmap wäre reiner Mehraufwand ohne Gegenwert.
 *
 * Gezeigt wird bewusst OI UND Preis übereinander — der Verlauf allein sagt
 * wenig. Erst zusammen wird lesbar, ob eine Bewegung von neuen Positionen
 * getragen wurde (Preis + OI steigen) oder ob nur geschlossen wurde
 * (Preis steigt, OI fällt).
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import PageInfo from '../components/PageInfo.vue'
import * as echarts from 'echarts'
import axios from 'axios'
import { pickPeriod, LEVMAP_PERIODS } from '../utils/leverageMapSource.js'
import { liveSymbol, levMapHours } from '../stores/live.js'

const { t } = useI18n()

const chartEl = ref(null)
const status = ref('idle')
const hinweis = ref('')
const punkte = ref([])

let chart = null
let ro = null
let timer = null
// Volle Tiefe der geladenen Periode. Das Zeitfenster ist nur ein Ausschnitt
// daraus — Umschalten innerhalb derselben Periode braucht deshalb keinen
// Netzverkehr und ist sofort da.
let rohPunkte = []
let rohPeriode = null
let laufendeAnfrage = 0

/**
 * ΔOI je Periode. Das ist die eigentlich interessante Grösse: der Bestand
 * selbst driftet langsam, die Veränderung zeigt, wann Positionen aufgebaut
 * oder abgebaut wurden.
 */
const kennzahlen = computed(() => {
    const p = punkte.value
    if (p.length < 2) return null
    const ersteOi = p[0].oi, letzteOi = p[p.length - 1].oi
    const erstePreis = p[0].c, letzterPreis = p[p.length - 1].c
    const oiPct = ersteOi > 0 ? ((letzteOi - ersteOi) / ersteOi) * 100 : 0
    const preisPct = erstePreis > 0 ? ((letzterPreis - erstePreis) / erstePreis) * 100 : 0
    let deutung = 'neutral'
    if (oiPct > 1 && preisPct > 0.3) deutung = 'longAufbau'
    else if (oiPct > 1 && preisPct < -0.3) deutung = 'shortAufbau'
    else if (oiPct < -1 && preisPct > 0.3) deutung = 'shortDeckung'
    else if (oiPct < -1 && preisPct < -0.3) deutung = 'longAufloesung'
    return { oiPct, preisPct, deutung, oiJetzt: letzteOi }
})

function zeichne() {
    if (!chart) return
    const p = punkte.value
    if (!p.length) { chart.clear(); return }

    const zeiten = p.map(x => x.t)
    const oi = p.map(x => x.oi)
    const preis = p.map(x => x.c)
    const delta = p.map((x, i) => (i ? x.oi - p[i - 1].oi : 0))

    chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        grid: [
            { left: 62, right: 62, top: 24, height: '52%' },
            { left: 62, right: 62, top: '68%', height: '20%' },
        ],
        tooltip: {
            trigger: 'axis', axisPointer: { type: 'cross' },
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 11 },
        },
        axisPointer: { link: [{ xAxisIndex: 'all' }] },
        xAxis: [
            {
                type: 'category', data: zeiten, gridIndex: 0, boundaryGap: false,
                axisLabel: { show: false },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
            },
            {
                type: 'category', data: zeiten, gridIndex: 1, boundaryGap: false,
                axisLabel: {
                    color: 'rgba(255,255,255,0.5)', fontSize: 10,
                    formatter: (v) => new Date(Number(v)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
            },
        ],
        yAxis: [
            {
                gridIndex: 0, scale: true, name: t('oi.oi'), nameTextStyle: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
                axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
            {
                gridIndex: 0, scale: true, position: 'right', name: t('oi.price'),
                nameTextStyle: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
                axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
                splitLine: { show: false },
            },
            {
                gridIndex: 1, scale: true, name: t('oi.delta'),
                nameTextStyle: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
                axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
        ],
        series: [
            {
                name: t('oi.oi'), type: 'line', data: oi, gridIndex: 0, xAxisIndex: 0, yAxisIndex: 0,
                showSymbol: false, lineStyle: { width: 1.6, color: '#01B4FF' },
                areaStyle: { color: 'rgba(1,180,255,0.10)' },
            },
            {
                name: t('oi.price'), type: 'line', data: preis, gridIndex: 0, xAxisIndex: 0, yAxisIndex: 1,
                showSymbol: false, lineStyle: { width: 1.2, color: 'rgba(255,255,255,0.65)' },
            },
            {
                name: t('oi.delta'), type: 'bar', data: delta, xAxisIndex: 1, yAxisIndex: 2,
                itemStyle: {
                    color: (pm) => (pm.value >= 0 ? 'rgb(38,190,150)' : 'rgb(255,95,86)'),
                },
            },
        ],
    }, true)
}

/** Fenster aus dem Rohbestand schneiden — ohne Netzverkehr. */
function schneiden() {
    const { period } = pickPeriod(levMapHours.value)
    const noetig = Math.max(20, Math.ceil((levMapHours.value * 60) / LEVMAP_PERIODS[period]))
    punkte.value = rohPunkte.slice(-noetig)
    status.value = punkte.value.length ? 'ready' : 'empty'
    zeichne()
}

async function lade(erzwingen = false) {
    const { period } = pickPeriod(levMapHours.value)
    // Gleiche Periode und Symbol → der Rohbestand reicht schon
    if (!erzwingen && period === rohPeriode && rohPunkte.length) { schneiden(); return }

    const meine = ++laufendeAnfrage
    status.value = 'loading'
    try {
        const { data } = await axios.get('/api/binance/leverage-map', {
            params: { symbol: liveSymbol.value, period },
        })
        // Eine ältere Antwort darf eine neuere nicht überschreiben
        if (meine !== laufendeAnfrage) return
        const p = Array.isArray(data.points) ? data.points.slice() : []
        if (data.unvollstaendig && p.length) p.pop()
        rohPunkte = p
        rohPeriode = data.period || period
        hinweis.value = data.hinweis || ''
        schneiden()
    } catch (e) {
        if (meine !== laufendeAnfrage) return
        status.value = 'error'
        hinweis.value = e.response?.data?.error || e.message
    }
}

onMounted(async () => {
    await nextTick()
    chart = echarts.init(chartEl.value)
    ro = new ResizeObserver(() => chart?.resize())
    ro.observe(chartEl.value)
    await lade()
    timer = setInterval(() => lade(true), 60000)
})

onBeforeUnmount(() => {
    clearInterval(timer)
    ro?.disconnect()
    chart?.dispose()
    chart = null
})

watch(liveSymbol, () => { rohPunkte = []; rohPeriode = null; lade(true) })
watch(levMapHours, () => lade())
</script>

<template>
    <div class="oiWrap">
        <div class="liveHeader">
            <div class="liveTitle">
                <span class="liveSymbol">{{ liveSymbol }}</span>
                <!-- immer Perp: diese Seite gibt es für Spot nicht -->
                <span class="liveMarket">Perp</span>
                <span :class="['liveDot', 'dot-' + status]"></span>
                <span class="liveState">{{ t('levmap.status_' + status) }}</span>
            </div>
            <!-- Zeitfenster steht im Seitenmenü -->
            <div class="liveActions">
                <PageInfo section="info.oi" />
            </div>
        </div>

        <div v-if="kennzahlen" class="oiCards">
            <div class="oiCard">
                <span class="oiLabel">{{ t('oi.oiChange') }}</span>
                <span :class="['oiValue', kennzahlen.oiPct >= 0 ? 'up' : 'down']">
                    {{ kennzahlen.oiPct >= 0 ? '+' : '' }}{{ kennzahlen.oiPct.toFixed(2) }} %
                </span>
            </div>
            <div class="oiCard">
                <span class="oiLabel">{{ t('oi.priceChange') }}</span>
                <span :class="['oiValue', kennzahlen.preisPct >= 0 ? 'up' : 'down']">
                    {{ kennzahlen.preisPct >= 0 ? '+' : '' }}{{ kennzahlen.preisPct.toFixed(2) }} %
                </span>
            </div>
            <div class="oiCard oiWide">
                <span class="oiLabel">{{ t('oi.reading') }}</span>
                <span class="oiValue">{{ t('oi.read_' + kennzahlen.deutung) }}</span>
            </div>
        </div>

        <div ref="chartEl" class="oiChart"></div>

        <div v-if="hinweis" class="oiHint">{{ hinweis }}</div>
    </div>
</template>

<style scoped>
.oiWrap {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 90px);
    min-height: 420px;
}

.oiChart {
    flex: 1 1 auto;
    min-height: 0;
    background: var(--black-bg-2, #14141f);
    border-radius: var(--border-radius, 6px);
}

.oiCards {
    display: flex;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
}

.oiCard {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.4rem 0.7rem;
    background: var(--black-bg-3, #1a1a2e);
    border-radius: var(--border-radius, 6px);
    min-width: 8rem;
}

.oiWide {
    flex: 1 1 14rem;
}

.oiLabel {
    font-size: 0.7rem;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
}

.oiValue {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--white-87, rgba(255, 255, 255, 0.87));
}

.oiValue.up {
    color: rgb(38, 190, 150);
}

.oiValue.down {
    color: rgb(255, 95, 86);
}


.oiHint {
    padding-top: 0.4rem;
    font-size: 0.74rem;
    color: rgb(250, 190, 60);
}
</style>
