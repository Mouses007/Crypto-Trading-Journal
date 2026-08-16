<script setup>
/**
 * Kachel „Fear & Greed".
 *
 * Klein: Halbkreis-Anzeige mit dem heutigen Wert und der Veränderung zu gestern.
 * Gross: Zeitreihe mit den fünf Stimmungszonen als Farbhinterlegung.
 *
 * Die Komponente holt selbst nichts — die Seite reicht `daten` herein. Dadurch
 * kostet das Aufklappen keinen zweiten Abruf.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()
const chartEl = ref(null)
let chart = null
let ro = null

const ZONEN = [
    { bis: 24, farbe: '#d13b3b' },
    { bis: 44, farbe: '#e07a3b' },
    { bis: 55, farbe: '#c9b53b' },
    { bis: 75, farbe: '#7cb342' },
    { bis: 100, farbe: '#26be96' },
]

const farbeFuer = (wert) => (ZONEN.find(z => wert <= z.bis) || ZONEN[4]).farbe

const aktuell = computed(() => props.daten?.aktuell || null)
const delta = computed(() => {
    if (!aktuell.value || !props.daten?.gestern) return null
    return aktuell.value.wert - props.daten.gestern.wert
})

function zeichne() {
    if (!chart || !props.daten) return
    chart.setOption(props.gross ? optionGross() : optionKlein(), true)
}

/** Klein: Halbkreis. Eine Zahl und ihre Zone — mehr passt auf 270 px nicht. */
function optionKlein() {
    const wert = aktuell.value?.wert ?? 0
    return {
        backgroundColor: 'transparent',
        animation: false,
        series: [{
            type: 'gauge',
            startAngle: 200, endAngle: -20,
            min: 0, max: 100,
            radius: '96%',
            center: ['50%', '70%'],
            progress: { show: false },
            // Statt eines Zeigers aus der Mitte nur eine Marke AUF dem Bogen —
            // ein Zeiger lag bei Werten um 50 quer über der Zahl.
            pointer: {
                icon: 'rect', width: 4, length: '13%',
                offsetCenter: [0, '-87%'],
                itemStyle: { color: '#fff' },
            },
            // ECharts erwartet [Anteil, Farbe] — die Zonengrenzen sind dieselben
            // wie in der Einordnung, damit Bogen und Beschriftung zusammenpassen
            axisLine: { lineStyle: { width: 13, color: ZONEN.map(z => [z.bis / 100, z.farbe]) } },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: {
                distance: 14, fontSize: 12, color: 'rgba(255,255,255,0.55)',
                // Nur die Eckpunkte und die Mitte — alles andere ist auf 300 px Krimskrams
                formatter: (v) => ([0, 50, 100].includes(v) ? String(v) : ''),
            },
            anchor: { show: false },
            title: { show: false },
            detail: {
                offsetCenter: [0, '-2%'],
                fontSize: 34, fontWeight: 700,
                color: farbeFuer(wert),
                formatter: '{value}',
            },
            data: [{ value: wert }],
        }],
    }
}

/** Gross: Verlauf mit Zonen — der Einzelwert sagt wenig ohne seine Vorgeschichte. */
function optionGross() {
    const historie = props.daten?.historie || []
    return {
        backgroundColor: 'transparent',
        animation: false,
        grid: { left: 44, right: 16, top: 16, bottom: 28 },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => {
                const [t0, v] = p[0].data
                return `${new Date(t0).toLocaleDateString()}<br/><b>${v}</b> — ${t('marktradar.fng.class_' + klasseFuer(v))}`
            },
        },
        xAxis: {
            type: 'time',
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
        },
        yAxis: {
            min: 0, max: 100,
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        visualMap: {
            show: false,
            type: 'piecewise',
            dimension: 1,
            seriesIndex: 0,
            pieces: [
                { lte: 24, color: ZONEN[0].farbe },
                { gt: 24, lte: 44, color: ZONEN[1].farbe },
                { gt: 44, lte: 55, color: ZONEN[2].farbe },
                { gt: 55, lte: 75, color: ZONEN[3].farbe },
                { gt: 75, color: ZONEN[4].farbe },
            ],
        },
        series: [{
            type: 'line', data: historie, showSymbol: false,
            lineStyle: { width: 1.6 },
            // Zonen als zarte Flächen statt gestrichelter Linien: man sieht auf
            // einen Blick, in welchem Bereich die Kurve läuft, ohne dass
            // Beschriftungen am rechten Rand abgeschnitten werden.
            markArea: {
                silent: true,
                data: [
                    [{ yAxis: 0, itemStyle: { color: 'rgba(209,59,59,0.13)' } }, { yAxis: 24 }],
                    [{ yAxis: 24, itemStyle: { color: 'rgba(224,122,59,0.08)' } }, { yAxis: 45 }],
                    [{ yAxis: 45, itemStyle: { color: 'rgba(255,255,255,0.03)' } }, { yAxis: 55 }],
                    [{ yAxis: 55, itemStyle: { color: 'rgba(124,179,66,0.08)' } }, { yAxis: 75 }],
                    [{ yAxis: 75, itemStyle: { color: 'rgba(38,190,150,0.13)' } }, { yAxis: 100 }],
                ],
            },
        }],
    }
}

const klasseFuer = (wert) => {
    if (wert <= 24) return 'extremeFear'
    if (wert <= 44) return 'fear'
    if (wert <= 55) return 'neutral'
    if (wert <= 75) return 'greed'
    return 'extremeGreed'
}

onMounted(async () => {
    await nextTick()
    if (!chartEl.value) return
    chart = echarts.init(chartEl.value)
    ro = new ResizeObserver(() => chart?.resize())
    ro.observe(chartEl.value)
    zeichne()
    // Im Overlay ist der Kasten beim ersten Zeichnen noch nicht breit
    requestAnimationFrame(() => chart?.resize())
})

onBeforeUnmount(() => {
    ro?.disconnect()
    ro = null
    chart?.dispose()
    chart = null
})

watch(() => props.daten, zeichne)
</script>

<template>
    <div v-if="daten" class="fngWrap" :class="{ gross }">
        <div ref="chartEl" class="fngChart"></div>

        <div class="fngZahlen">
            <span class="fngKlasse" :style="{ color: farbeFuer(aktuell?.wert ?? 0) }">
                {{ t('marktradar.fng.class_' + (aktuell?.klasse || 'neutral')) }}
            </span>
            <span v-if="delta !== null" class="fngDelta" :class="delta > 0 ? 'up' : (delta < 0 ? 'down' : '')">
                {{ delta > 0 ? '+' : (delta < 0 ? '' : '±') }}{{ delta }} {{ t('marktradar.fng.vsYesterday') }}
            </span>
        </div>

        <div v-if="gross" class="fngGrossZahlen">
            <div><span>{{ t('marktradar.fng.avg30') }}</span><b>{{ daten.mittel30 ?? '—' }}</b></div>
            <div><span>{{ t('marktradar.fng.low') }}</span><b>{{ daten.tief }}</b></div>
            <div><span>{{ t('marktradar.fng.high') }}</span><b>{{ daten.hoch }}</b></div>
            <div><span>{{ t('marktradar.fng.days', { n: daten.tage }) }}</span></div>
        </div>

        <p v-if="gross" class="fngQuelle">{{ t('marktradar.fng.source') }}</p>
    </div>
</template>

<style scoped>
.fngWrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 140px;
}

.fngChart {
    flex: 1 1 auto;
    min-height: 165px;
}

.fngWrap.gross .fngChart {
    min-height: 46vh;
}

.fngZahlen {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.5rem;
    font-size: 0.8rem;
}

.fngKlasse {
    font-weight: 600;
}

.fngDelta.up {
    color: rgb(38, 190, 150);
}

.fngDelta.down {
    color: rgb(255, 95, 86);
}

.fngGrossZahlen {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.4rem;
    margin-top: 0.6rem;
    font-size: 0.86rem;
    color: var(--white-60);
}

.fngGrossZahlen b {
    margin-left: 0.4rem;
    color: var(--white-87);
}

.fngQuelle {
    margin: 0.6rem 0 0;
    font-size: 0.8rem;
    color: var(--white-60);
}
</style>
