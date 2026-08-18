<script setup>
/**
 * Kachel „Kalender-Heatmap" — Netto-PnL pro Tag.
 *
 * Self-supplying: liest die broker-weiten Trade-Tage aus dem Startseiten-Store
 * (`journalTage`). Grün = Gewinntag, Rot = Verlusttag. Klein zeigt die letzten
 * ~12 Monate, groß den gesamten erfassten Zeitraum. `daten` bleibt ungenutzt.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import dayjs from '../../utils/dayjs-setup.js'
import { journalTage } from '../../stores/startseite.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()
const chartEl = ref(null)
let chart = null
let ro = null

/** [ ['YYYY-MM-DD', netProceeds], … ] */
const eintraege = computed(() =>
    [...journalTage]
        .filter(tag => tag && tag.pAndL && typeof tag.pAndL === 'object' && tag.dateUnix)
        .map(tag => [dayjs.unix(tag.dateUnix).format('YYYY-MM-DD'), Math.round((Number(tag.pAndL.netProceeds) || 0) * 100) / 100]),
)

const maxAbs = computed(() => {
    let m = 0
    for (const [, v] of eintraege.value) m = Math.max(m, Math.abs(v))
    return m || 1
})

/** Zeitbereich des Kalenders: klein die letzten 12 Monate, groß alles. */
const bereich = computed(() => {
    if (!eintraege.value.length) {
        const j = dayjs().format('YYYY-MM-DD')
        return [dayjs().subtract(11, 'month').format('YYYY-MM-DD'), j]
    }
    const daten = eintraege.value.map(e => e[0]).sort()
    const min = daten[0]
    const max = daten[daten.length - 1]
    if (props.gross) return [min, max]
    const start = dayjs(max).subtract(11, 'month').format('YYYY-MM-DD')
    return [start > min ? start : min, max]
})

function zeichne() {
    if (!chart) return
    chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        tooltip: {
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => {
                const [d, v] = p.data
                return `${dayjs(d).format('DD.MM.YYYY')}<br/><b>${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> USDT`
            },
        },
        visualMap: {
            show: false,
            min: -maxAbs.value,
            max: maxAbs.value,
            calculable: true,
            inRange: { color: ['#d13b3b', '#3a3f4b', '#26be96'] },
        },
        calendar: {
            top: 26,
            left: 30,
            right: 12,
            bottom: 8,
            cellSize: ['auto', props.gross ? 16 : 12],
            range: bereich.value,
            splitLine: { show: false },
            itemStyle: { color: 'rgba(255,255,255,0.03)', borderColor: 'rgba(0,0,0,0.35)', borderWidth: 2 },
            yearLabel: { show: false },
            monthLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10, nameMap: 'de' },
            dayLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 9, firstDay: 1, nameMap: 'de' },
        },
        series: [{
            type: 'heatmap',
            coordinateSystem: 'calendar',
            data: eintraege.value,
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

watch([eintraege, () => props.gross], () => { zeichne(); requestAnimationFrame(() => chart?.resize()) })
</script>

<template>
    <div class="hmWrap" :class="{ gross }">
        <div ref="chartEl" class="hmChart"></div>
        <p v-if="!eintraege.length" class="hmLeer">{{ t('startseite.heatmap.leer') }}</p>
    </div>
</template>

<style scoped>
.hmWrap {
    position: relative;
    height: 100%;
    min-height: 140px;
}

.hmChart {
    width: 100%;
    height: 100%;
    min-height: 150px;
}

.hmLeer {
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
