<script setup>
/**
 * Kachel „Long/Short + Offenes Interesse".
 *
 * Die Kontenquote von Binance sagt, wie viele KONTEN auf welcher Seite stehen —
 * nicht wie viel Kapital. Zusammen mit der Veränderung des offenen Interesses
 * und des Preises ergibt sich dieselbe Vier-Felder-Lesart wie auf der
 * Open-Interest-Seite; deren Übersetzungen werden hier wiederverwendet, statt
 * dieselben Sätze ein zweites Mal zu pflegen.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import dayjs from '../../utils/dayjs-setup.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()
const chartEl = ref(null)
let chart = null
let ro = null

const jetzt = computed(() => props.daten?.jetzt || null)
const punkte = computed(() => props.daten?.punkte || [])

function zeichne() {
    if (!chart || !punkte.value.length) return
    const zeiten = punkte.value.map(p => p.t)
    const ratio = punkte.value.map(p => p.ratio)
    const oi = punkte.value.map(p => p.oi)

    chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        // Oben mehr Luft: die Achsennamen sitzen über dem Diagramm und stiessen
        // sonst in den Balken der Kontenverteilung darüber
        grid: props.gross
            ? { left: 62, right: 66, top: 44, bottom: 30 }
            : { left: 2, right: 2, top: 6, bottom: 4, containLabel: false },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => {
                const i = p[0].dataIndex
                const d = punkte.value[i]
                return `${dayjs(d.t).format('DD.MM. HH:mm')}<br/>`
                    + `${t('marktradar.lsoi.ratio')}: <b>${d.ratio?.toFixed(2)}</b> `
                    + `(${d.longPct} % / ${d.shortPct} %)<br/>`
                    + (d.oi !== null ? `${t('oi.oi')}: ${Math.round(d.oi).toLocaleString()}` : '')
            },
        },
        xAxis: {
            type: 'category', data: zeiten, boundaryGap: false, show: props.gross,
            axisLabel: {
                color: 'rgba(255,255,255,0.72)', fontSize: 12,
                formatter: (v) => dayjs(Number(v)).format('HH:mm'),
            },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
        },
        yAxis: [
            {
                scale: true, show: props.gross, name: props.gross ? t('marktradar.lsoi.ratio') : '',
                nameGap: 16,
                nameTextStyle: { color: 'rgba(255,255,255,0.72)', fontSize: 12, align: 'left' },
                axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
            {
                scale: true, show: props.gross, position: 'right', name: props.gross ? t('oi.oi') : '',
                nameGap: 16,
                nameTextStyle: { color: 'rgba(255,255,255,0.72)', fontSize: 12, align: 'right' },
                axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
                splitLine: { show: false },
            },
        ],
        series: [
            {
                name: t('oi.oi'), type: 'line', data: oi, yAxisIndex: 1, showSymbol: false,
                lineStyle: { width: 1, color: 'rgba(255,255,255,0.35)' },
                areaStyle: { color: 'rgba(255,255,255,0.06)' },
                connectNulls: true,
            },
            {
                name: t('marktradar.lsoi.ratio'), type: 'line', data: ratio, yAxisIndex: 0, showSymbol: false,
                lineStyle: { width: 1.8, color: '#01B4FF' },
                // Die 1,0-Linie ist die Wasserscheide: darüber mehr Long-Konten
                markLine: props.gross ? {
                    silent: true, symbol: 'none',
                    label: { show: true, formatter: '1,0', color: 'rgba(255,255,255,0.38)', fontSize: 12 },
                    lineStyle: { color: 'rgba(255,255,255,0.25)', type: 'dashed' },
                    data: [{ yAxis: 1 }],
                } : undefined,
            },
        ],
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

watch(() => props.daten, zeichne)
</script>

<template>
    <div v-if="daten" class="lsWrap" :class="{ gross }">
        <div class="lsKopf">
            <div class="lsZahl">
                <span class="lsLabel">{{ t('marktradar.lsoi.ratio') }}</span>
                <b>{{ jetzt?.ratio?.toFixed(2) ?? '—' }}</b>
            </div>
            <div class="lsZahl">
                <span class="lsLabel">{{ t('marktradar.lsoi.oiDelta') }}</span>
                <b :class="(jetzt?.oiDelta24hPct ?? 0) >= 0 ? 'up' : 'down'">
                    {{ jetzt?.oiDelta24hPct === null ? '—'
                        : (jetzt.oiDelta24hPct >= 0 ? '+' : '') + jetzt.oiDelta24hPct + ' %' }}
                </b>
            </div>
            <div class="lsZahl">
                <span class="lsLabel">{{ t('marktradar.lsoi.priceDelta') }}</span>
                <b :class="(jetzt?.preisDelta24hPct ?? 0) >= 0 ? 'up' : 'down'">
                    {{ jetzt?.preisDelta24hPct === null ? '—'
                        : (jetzt.preisDelta24hPct >= 0 ? '+' : '') + jetzt.preisDelta24hPct + ' %' }}
                </b>
            </div>
        </div>

        <!-- Balken der Kontenverteilung: die Zahl allein liest sich schlecht -->
        <div v-if="jetzt?.longPct" class="lsBalken">
            <div class="lsLong" :style="{ width: jetzt.longPct + '%' }">{{ jetzt.longPct }} %</div>
            <div class="lsShort" :style="{ width: jetzt.shortPct + '%' }">{{ jetzt.shortPct }} %</div>
        </div>

        <div ref="chartEl" class="lsChart"></div>

        <p class="lsDeutung">{{ t('oi.read_' + (jetzt?.deutung || 'neutral')) }}</p>
        <p v-if="gross" class="lsQuelle">{{ t('marktradar.lsoi.source', { symbol: daten.symbol }) }}</p>
    </div>
</template>

<style scoped>
.lsWrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 140px;
}

.lsKopf {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
}

.lsZahl {
    display: flex;
    flex-direction: column;
}

.lsLabel {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--white-60);
}

.lsZahl b {
    font-size: 1.15rem;
    color: var(--white-87);
    font-variant-numeric: tabular-nums;
}

.up {
    color: rgb(38, 190, 150) !important;
}

.down {
    color: rgb(255, 95, 86) !important;
}

.lsBalken {
    display: flex;
    height: 16px;
    margin: 0.45rem 0 0.2rem;
    border-radius: 3px;
    overflow: hidden;
    font-size: 0.7rem;
    line-height: 16px;
}

.lsLong {
    background: rgba(38, 190, 150, 0.55);
    color: #04150f;
    text-align: left;
    padding-left: 4px;
}

.lsShort {
    background: rgba(255, 95, 86, 0.55);
    color: #1a0605;
    text-align: right;
    padding-right: 4px;
}

.lsChart {
    margin-top: 0.35rem;
    flex: 1 1 auto;
    min-height: 90px;
}

.lsWrap.gross .lsChart {
    min-height: 44vh;
}

.lsDeutung {
    margin: 0.35rem 0 0;
    font-size: 0.82rem;
    color: var(--white-60);
}

.lsQuelle {
    margin: 0.5rem 0 0;
    font-size: 0.8rem;
    color: var(--white-60);
}
</style>
