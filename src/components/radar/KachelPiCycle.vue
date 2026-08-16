<script setup>
/**
 * Kachel „Pi-Cycle-Top".
 *
 * Zwei gleitende Durchschnitte: 111 Tage gegen 350 Tage mal zwei. Kreuzt die
 * kurze Linie die lange von unten, lag das bisher nahe am Zyklushoch — 2013,
 * 2017 und 2021.
 *
 * Was die Kachel deshalb NICHT tut: daraus ein Signal machen. Drei Treffer bei
 * drei Gelegenheiten sind statistisch nichts. Der Name kommt daher, dass
 * 350/111 ungefähr π ergibt; auch das ist Zahlenspielerei und kein Mechanismus.
 * Angezeigt wird darum der ABSTAND, nicht ein „kaufen/verkaufen".
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
const preis = (v) => (v ? Math.round(v).toLocaleString('de-CH') : '—')

function zeichne() {
    if (!chart || !props.daten?.punkte?.length) return
    // Vor 2012 ist die 350-Tage-Linie noch leer und der Kurs unter einem Dollar
    const punkte = props.daten.punkte.filter(p => p[3] !== null)

    chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        grid: {
            left: props.gross ? 62 : 48, right: 8,
            top: props.gross ? 30 : 10, bottom: props.gross ? 28 : 18,
        },
        legend: props.gross ? {
            top: 0, textStyle: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
            data: ['BTC', t('marktradar.picycle.ma111'), t('marktradar.picycle.ma350')],
        } : { show: false },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => `${dayjs(p[0].data[0]).format('DD.MM.YYYY')}<br/>`
                + p.map(x => `${x.marker}${x.seriesName}: <b>${preis(x.data[1])} $</b>`).join('<br/>'),
        },
        xAxis: {
            type: 'time',
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
        },
        yAxis: {
            type: 'log', logBase: 10,
            axisLabel: {
                color: 'rgba(255,255,255,0.72)', fontSize: 12,
                formatter: (v) => (v >= 1000 ? `${v / 1000}k` : v),
            },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        series: [
            {
                name: 'BTC', type: 'line', showSymbol: false,
                data: punkte.map(p => [p[0], p[1]]),
                lineStyle: { width: 1, color: 'rgba(255,255,255,0.45)' },
                z: 1,
            },
            {
                name: t('marktradar.picycle.ma111'), type: 'line', showSymbol: false,
                data: punkte.map(p => [p[0], p[2]]),
                lineStyle: { width: 1.6, color: '#e8a33d' },
                z: 3,
                // Die Kreuzungen als Marken — sie sind der ganze Punkt der Kachel
                markPoint: props.gross ? {
                    symbol: 'pin', symbolSize: 34,
                    itemStyle: { color: 'rgba(255,95,86,0.9)' },
                    label: { fontSize: 10, color: '#fff', formatter: (p) => dayjs(p.data.coord[0]).format('MM/YY') },
                    data: (props.daten.kreuzungen || []).map(k => ({ coord: [k.t, k.preis] })),
                } : undefined,
            },
            {
                name: t('marktradar.picycle.ma350'), type: 'line', showSymbol: false,
                data: punkte.map(p => [p[0], p[3]]),
                lineStyle: { width: 1.6, color: '#26be96' },
                z: 2,
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
    <div v-if="daten" class="pcWrap" :class="{ gross }">
        <!-- Der Alarm ist der Zweck dieser Kachel: eine frische Kreuzung darf
             man nicht übersehen, alles andere ist Beiwerk. -->
        <div v-if="daten.frisch" class="pcAlarm">
            <i class="uil uil-exclamation-octagon"></i>
            {{ t('marktradar.picycle.alarm', { datum: dayjs(daten.letzteKreuzung.t).format('DD.MM.YYYY') }) }}
        </div>

        <div class="pcKopf">
            <span class="pcAbstand" :class="jetzt?.ausgeloest ? 'aus' : ''">
                {{ jetzt?.abstandPct === null ? '—' : (jetzt.abstandPct > 0 ? '+' : '') + jetzt.abstandPct + ' %' }}
            </span>
            <span class="pcLabel">
                {{ jetzt?.ausgeloest ? t('marktradar.picycle.triggered') : t('marktradar.picycle.distance') }}
            </span>
        </div>

        <div ref="chartEl" class="pcChart"></div>

        <template v-if="gross">
            <div class="pcZahlen">
                <div><span>{{ t('marktradar.picycle.ma111') }}</span><b>{{ preis(jetzt?.ma111) }} $</b></div>
                <div><span>{{ t('marktradar.picycle.ma350') }}</span><b>{{ preis(jetzt?.ma350x2) }} $</b></div>
                <div><span>BTC</span><b>{{ preis(jetzt?.preis) }} $</b></div>
            </div>

            <div class="pcKreuzungen">
                <span class="pcTitel">{{ t('marktradar.picycle.crossings') }}</span>
                <span v-for="k in daten.kreuzungen" :key="k.t" class="pcKreuzung">
                    {{ dayjs(k.t).format('DD.MM.YYYY') }} · {{ k.preis.toLocaleString('de-CH') }} $
                </span>
            </div>

            <p class="pcWarnung">{{ t('marktradar.picycle.caveat') }}</p>
        </template>
    </div>
</template>

<style scoped>
.pcWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.pcAlarm {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.4rem;
    padding: 0.35rem 0.6rem;
    border-radius: var(--border-radius);
    background: rgba(255, 95, 86, 0.16);
    border: 1px solid rgba(255, 95, 86, 0.5);
    color: rgb(255, 140, 130);
    font-size: 0.84rem;
    font-weight: 600;
}

.pcKopf {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.pcAbstand {
    font-size: 1.6rem;
    font-weight: 700;
    color: #26be96;
    line-height: 1.1;
}

.pcAbstand.aus {
    color: rgb(255, 95, 86);
}

.pcLabel {
    font-size: 0.8rem;
    color: var(--white-60);
}

.pcChart {
    flex: 1 1 auto;
    min-height: 110px;
}

.pcWrap.gross .pcChart {
    min-height: 46vh;
}

.pcZahlen {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 1.4rem;
    margin-top: 0.7rem;
    font-size: 0.84rem;
    color: var(--white-60);
}

.pcZahlen b {
    margin-left: 0.4rem;
    color: var(--white-87);
    font-variant-numeric: tabular-nums;
}

.pcKreuzungen {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 1rem;
    margin-top: 0.6rem;
    font-size: 0.82rem;
    color: var(--white-60);
}

.pcTitel {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.74rem;
}

.pcKreuzung {
    font-variant-numeric: tabular-nums;
}

.pcWarnung {
    margin: 0.7rem 0 0;
    padding: 0.4rem 0.6rem;
    border-left: 3px solid rgba(240, 196, 25, 0.8);
    background: rgba(240, 196, 25, 0.08);
    font-size: 0.82rem;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
}
</style>
