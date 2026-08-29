<script setup>
/**
 * Kachel „Kapitalkurve" — kumulativer Netto-PnL über die Zeit.
 *
 * Self-supplying: liest die broker-weiten Trade-Tage aus dem Startseiten-Store
 * (`journalTage`), den die Seite beim Mount befüllt. Zeichnet eine
 * Flächenlinie der aufsummierten Tagesergebnisse. `daten` bleibt ungenutzt.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import { journalTage, journalZustand } from '../../stores/startseite.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()
const chartEl = ref(null)
let chart = null
let ro = null

/** [ [ms, kumuliert], … ] aufsteigend nach Tag. */
const serie = computed(() => {
    const tage = [...journalTage]
        .filter(tag => tag && tag.pAndL && typeof tag.pAndL === 'object')
        .sort((a, b) => (a.dateUnix || 0) - (b.dateUnix || 0))
    let kum = 0
    return tage.map(tag => {
        kum += Number(tag.pAndL.netProceeds) || 0
        return [(tag.dateUnix || 0) * 1000, Math.round(kum * 100) / 100]
    })
})

const endwert = computed(() => (serie.value.length ? serie.value[serie.value.length - 1][1] : 0))
const positiv = computed(() => endwert.value >= 0)

function zeichne() {
    if (!chart) return
    const daten = serie.value
    const farbe = positiv.value ? 'rgb(38, 190, 150)' : 'rgb(255, 95, 86)'
    chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        grid: { left: 48, right: 12, top: 12, bottom: 24 },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => {
                const [ts, v] = p[0].data
                return `${new Date(ts).toLocaleDateString()}<br/><b>${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> USDT`
            },
        },
        xAxis: {
            type: 'time',
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 11 },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
        },
        yAxis: {
            type: 'value',
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 11 },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        series: [{
            type: 'line',
            data: daten,
            showSymbol: false,
            lineStyle: { width: 1.8, color: farbe },
            itemStyle: { color: farbe },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: positiv.value ? 'rgba(38,190,150,0.28)' : 'rgba(255,95,86,0.28)' },
                    { offset: 1, color: 'rgba(0,0,0,0)' },
                ]),
            },
            // Nulllinie zur Orientierung
            markLine: {
                silent: true, symbol: 'none',
                lineStyle: { color: 'rgba(255,255,255,0.25)', type: 'dashed', width: 1 },
                data: [{ yAxis: 0 }],
                label: { show: false },
            },
        }],
    }, true)
}

onMounted(async () => {
    await nextTick()
    if (!chartEl.value) return
    chart = echarts.init(chartEl.value)
    ro = new ResizeObserver(() => chart?.resize())
    ro.observe(chartEl.value)
    zeichne()
    requestAnimationFrame(() => chart?.resize())
})

onBeforeUnmount(() => {
    ro?.disconnect()
    ro = null
    chart?.dispose()
    chart = null
})

watch([serie, () => props.gross], () => { zeichne(); requestAnimationFrame(() => chart?.resize()) })
</script>

<template>
    <div class="kkWrap" :class="{ gross }">
        <!--
            Der Kopf stand ausserhalb jedes `v-if`: bei leerer Serie ist
            `endwert` 0, `positiv` damit true, und die Kachel zeigte ein
            gruenes „+0,00 USDT" ueber dem Hinweis, dass noch keine Trades
            erfasst sind. Eine erfundene Zahl in Gewinnfarbe ist schlimmer als
            gar keine — das Schadensmodell dieses Projekts ist die falsche
            Zahl, die vertrauenswuerdig aussieht.
        -->
        <div class="kkKopf">
            <span v-if="serie.length" class="kkEnd" :class="positiv ? 'up' : 'down'">
                {{ positiv ? '+' : '' }}{{ endwert.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}
                <span class="kkWaehrung">USDT</span>
            </span>
            <span v-else class="kkEnd kkOhne">–</span>
            <span class="kkLabel">{{ t('startseite.kapitalkurve.kumuliert') }}</span>
        </div>
        <div ref="chartEl" class="kkChart"></div>
        <p v-if="!serie.length" class="kkLeer">{{ journalZustand === 'fehler' ? t('startseite.abrufFehler') : t('startseite.kapitalkurve.leer') }}</p>
    </div>
</template>

<style scoped>
.kkWrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 140px;
    position: relative;
}

.kkKopf {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0 0.2rem 0.2rem;
}

.kkEnd {
    font-size: 1.25rem;
    font-weight: 700;
}

.kkEnd.up {
    color: rgb(38, 190, 150);
}

.kkEnd.down {
    color: rgb(255, 95, 86);
}

.kkWaehrung {
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--white-60);
}

.kkLabel {
    font-size: 0.76rem;
    color: var(--white-60);
}

.kkChart {
    flex: 1 1 auto;
    min-height: 150px;
}

.kkWrap.gross .kkChart {
    min-height: 46vh;
}

.kkOhne {
    color: var(--white-38, rgba(255, 255, 255, 0.6));
}

.kkLeer {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    color: var(--white-60);
    font-size: 0.85rem;
}
</style>
