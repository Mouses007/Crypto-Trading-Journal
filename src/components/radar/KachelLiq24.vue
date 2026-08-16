<script setup>
/**
 * Kachel „Liquidationen 24 h" — aus der EIGENEN Aufzeichnung.
 *
 * Für aggregierte Liquidationen gibt es nichts Brauchbares umsonst. Der
 * Recorder schreibt sie ohnehin mit; diese Kachel liest nur, was schon da ist.
 *
 * Farblogik: liquidierte LONGS sind rot (jemand wurde nach unten rausgeworfen),
 * liquidierte SHORTS grün. Wer das dreht, liest die Kachel genau falsch herum.
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

const ROT = 'rgb(255, 95, 86)'
const GRUEN = 'rgb(38, 190, 150)'

const gesamt = computed(() => props.daten?.gesamt || { longUsd: 0, shortUsd: 0, anzahl: 0 })
const summe = computed(() => gesamt.value.longUsd + gesamt.value.shortUsd)
const longAnteil = computed(() => (summe.value ? (gesamt.value.longUsd / summe.value) * 100 : 50))

const geld = (v) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)} Mrd` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} Mio` : `${Math.round(v / 1000)}k`)
const kurz = (s) => s.replace(/USDT$/, '')

function zeichne() {
    if (!chart || !props.daten?.verlauf?.length) return
    const v = props.daten.verlauf
    chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        grid: { left: 46, right: 8, top: 10, bottom: props.gross ? 26 : 18 },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => `${dayjs(v[p[0].dataIndex].t).format('DD.MM. HH:mm')}<br/>`
                + p.map(x => `${x.marker}${x.seriesName}: <b>${geld(x.value)} $</b>`).join('<br/>'),
        },
        xAxis: {
            type: 'category', data: v.map(x => x.t),
            axisLabel: {
                color: 'rgba(255,255,255,0.72)', fontSize: 12,
                formatter: (val) => dayjs(Number(val)).format('HH'),
            },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
        },
        yAxis: {
            axisLabel: {
                color: 'rgba(255,255,255,0.72)', fontSize: 12,
                formatter: (val) => geld(val),
            },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        series: [
            {
                name: t('marktradar.liq.long'), type: 'bar', stack: 'x',
                data: v.map(x => x.longUsd), itemStyle: { color: ROT },
            },
            {
                name: t('marktradar.liq.short'), type: 'bar', stack: 'x',
                data: v.map(x => x.shortUsd), itemStyle: { color: GRUEN },
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
    <div v-if="daten" class="lqWrap" :class="{ gross }">
        <!-- Aufzeichnung aus: das ist kein Fehler und auch keine Null, sondern
             eine Einstellung. Entsprechend steht hier ein Weg, kein Balken. -->
        <div v-if="!daten.aktiv" class="lqAus">
            <i class="uil uil-record-audio"></i>
            <p>{{ t('marktradar.liq.inactive') }}</p>
            <a href="/settings" class="ctl-pill">{{ t('marktradar.liq.activate') }}</a>
        </div>

        <template v-else>
            <div class="lqKopf">
                <div class="lqZahl">
                    <span class="lqLabel">{{ t('marktradar.liq.long') }}</span>
                    <b :style="{ color: ROT }">{{ geld(gesamt.longUsd) }} $</b>
                </div>
                <div class="lqZahl">
                    <span class="lqLabel">{{ t('marktradar.liq.short') }}</span>
                    <b :style="{ color: GRUEN }">{{ geld(gesamt.shortUsd) }} $</b>
                </div>
                <div class="lqZahl">
                    <span class="lqLabel">{{ t('marktradar.liq.events') }}</span>
                    <b>{{ gesamt.anzahl }}</b>
                </div>
            </div>

            <div class="lqBalken">
                <div :style="{ width: longAnteil + '%', background: ROT }"></div>
                <div :style="{ width: (100 - longAnteil) + '%', background: GRUEN }"></div>
            </div>

            <div ref="chartEl" class="lqChart"></div>

            <template v-if="gross">
                <div class="lqTabellen">
                    <div>
                        <div class="lqTitel">{{ t('marktradar.liq.perSymbol') }}</div>
                        <div v-for="s in daten.symbole" :key="s.symbol" class="lqZeile">
                            <span>{{ kurz(s.symbol) }}</span>
                            <span :style="{ color: ROT }">{{ geld(s.longUsd) }}</span>
                            <span :style="{ color: GRUEN }">{{ geld(s.shortUsd) }}</span>
                        </div>
                    </div>
                    <div>
                        <div class="lqTitel">{{ t('marktradar.liq.biggest') }}</div>
                        <div v-for="(g, i) in daten.groesste" :key="i" class="lqZeile">
                            <span>{{ dayjs(g.t).format('HH:mm') }}</span>
                            <span>{{ kurz(g.symbol) }}</span>
                            <span :style="{ color: g.seite === 'long' ? ROT : GRUEN }">{{ geld(g.usd) }} $</span>
                        </div>
                    </div>
                </div>
                <p class="lqQuelle">
                    {{ t('marktradar.liq.source') }}
                    <span v-if="daten.seit"> {{ t('marktradar.liq.since', { zeit: dayjs(daten.seit).format('DD.MM. HH:mm') }) }}</span>
                </p>
            </template>
        </template>
    </div>
</template>

<style scoped>
.lqWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.lqAus {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    text-align: center;
    font-size: 0.82rem;
    color: var(--white-60);
}

.lqAus i {
    font-size: 1.5rem;
    opacity: 0.5;
}

.lqAus p {
    margin: 0;
    max-width: 22rem;
}

.lqKopf {
    display: flex;
    gap: 1.2rem;
    flex-wrap: wrap;
}

.lqZahl {
    display: flex;
    flex-direction: column;
}

.lqLabel {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--white-60);
}

.lqZahl b {
    font-size: 1.1rem;
    color: var(--white-87);
    font-variant-numeric: tabular-nums;
}

.lqBalken {
    display: flex;
    height: 10px;
    margin: 0.4rem 0 0.3rem;
    border-radius: 3px;
    overflow: hidden;
}

.lqChart {
    flex: 1 1 auto;
    min-height: 90px;
}

.lqWrap.gross .lqChart {
    min-height: 34vh;
}

.lqTabellen {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.2rem;
    margin-top: 0.8rem;
}

.lqTitel {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--white-60);
    margin-bottom: 0.2rem;
}

.lqZeile {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    font-size: 0.84rem;
    padding: 0.1rem 0;
    font-variant-numeric: tabular-nums;
}

.lqQuelle {
    margin: 0.7rem 0 0;
    font-size: 0.78rem;
    color: var(--white-60);
}
</style>
