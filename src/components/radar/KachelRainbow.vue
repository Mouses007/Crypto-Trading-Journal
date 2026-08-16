<script setup>
/**
 * Kachel „Regenbogen-Chart".
 *
 * Eine logarithmische Regression über die gesamte Kurshistorie, dazu Bänder im
 * Abstand halber Standardabweichungen. Was das ist und was nicht:
 *
 *   Es ist eine Kurvenanpassung an die VERGANGENHEIT. Die Bänder verschieben
 *   sich mit jedem neuen Kurs, und wo der Preis in zwei Jahren steht, sagt das
 *   Ding nicht. Deshalb sind die Regressionswerte offen ausgewiesen — man kann
 *   die Kurve nachrechnen, statt sie glauben zu müssen.
 *
 * Die Bandwerte werden hier im Browser aus a, b und s gerechnet und nicht vom
 * Server mitgeschickt: neun Bänder über 1600 Zeitpunkte wären das Zehnfache
 * der Nutzlast für Zahlen, die aus drei Parametern folgen.
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

const TAG = 24 * 60 * 60 * 1000

const reg = computed(() => props.daten?.regression || null)
const baender = computed(() => props.daten?.baender || [])

/** Bandwert zum Zeitpunkt t — exakt die Formel aus dem Serverkommentar. */
function bandWert(k, t) {
    const r = reg.value
    if (!r) return null
    return Math.exp(r.a * Math.log((t - props.daten.genesis) / TAG) + r.b + k * r.s)
}

const preisText = (v) => (v >= 1000 ? Math.round(v).toLocaleString('de-CH') : v.toFixed(2))

function zeichne() {
    if (!chart || !props.daten?.punkte?.length) return
    const punkte = props.daten.punkte
    const zeiten = punkte.map(p => p[0])

    // Bänder von oben nach unten zeichnen: jedes füllt bis zum Boden, das
    // nächstniedrigere übermalt es. So entsteht der Farbverlauf ohne Stapeln,
    // was auf einer logarithmischen Achse ohnehin nicht ginge.
    const bandSerien = baender.value.map((b, i) => ({
        name: t('marktradar.rainbow.band_' + b.key),
        type: 'line',
        data: zeiten.map(t0 => [t0, bandWert(b.k, t0)]),
        showSymbol: false,
        lineStyle: { width: 0 },
        areaStyle: { color: b.farbe, opacity: 0.85 },
        silent: true,
        z: 2 + i,
    }))

    chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        grid: {
            left: props.gross ? 62 : 52, right: 8,
            top: 10, bottom: props.gross ? 28 : 18,
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => {
                const kurs = p.find(x => x.seriesName === 'BTC')
                if (!kurs) return ''
                const t0 = kurs.data[0]
                const band = baender.value.find(b => kurs.data[1] >= bandWert(b.k, t0)) || baender.value[baender.value.length - 1]
                return `${dayjs(t0).format('MM/YYYY')}<br/><b>${preisText(kurs.data[1])} $</b><br/>`
                    + `<span style="color:${band.farbe}">${t('marktradar.rainbow.band_' + band.key)}</span>`
            },
        },
        xAxis: {
            type: 'time',
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
        },
        yAxis: {
            // Ohne logarithmische Achse ist alles vor 2017 eine Nulllinie
            type: 'log', logBase: 10,
            axisLabel: {
                color: 'rgba(255,255,255,0.72)', fontSize: 12,
                formatter: (v) => (v >= 1000 ? `${v / 1000}k` : v),
            },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        series: [
            ...bandSerien,
            {
                name: 'BTC', type: 'line', data: punkte, showSymbol: false,
                lineStyle: { width: props.gross ? 1.8 : 1.4, color: '#fff' },
                z: 20,
                markPoint: {
                    symbol: 'circle', symbolSize: 9, z: 21,
                    itemStyle: { color: '#fff', borderColor: '#000', borderWidth: 1 },
                    label: { show: false },
                    data: [{ coord: punkte[punkte.length - 1] }],
                },
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
    <div v-if="daten" class="rbWrap" :class="{ gross }">
        <div class="rbKopf">
            <span class="rbPreis">{{ preisText(daten.jetzt.preis) }} $</span>
            <span class="rbBand" :style="{ color: (baender.find(b => b.key === daten.jetzt.band) || {}).farbe }">
                {{ t('marktradar.rainbow.band_' + daten.jetzt.band) }}
            </span>
        </div>

        <div ref="chartEl" class="rbChart"></div>

        <template v-if="gross">
            <div class="rbLegende">
                <span v-for="b in baender" :key="b.key" class="rbLegendeEintrag">
                    <i :style="{ background: b.farbe }"></i>{{ t('marktradar.rainbow.band_' + b.key) }}
                </span>
            </div>
            <p class="rbWarnung">{{ t('marktradar.rainbow.caveat') }}</p>
            <p class="rbQuelle">
                {{ t('marktradar.rainbow.params', {
                    a: reg.a.toFixed(4), b: reg.b.toFixed(4), s: reg.s.toFixed(4), n: reg.n
                }) }}
                · {{ daten.quelle }}
            </p>
        </template>
    </div>
</template>

<style scoped>
.rbWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.rbKopf {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.rbPreis {
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--white-87);
}

.rbBand {
    font-size: 0.86rem;
    font-weight: 600;
}

.rbChart {
    flex: 1 1 auto;
    min-height: 130px;
}

.rbWrap.gross .rbChart {
    min-height: 52vh;
}

.rbLegende {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.9rem;
    margin-top: 0.6rem;
    font-size: 0.78rem;
    color: var(--white-60);
}

.rbLegendeEintrag i {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    margin-right: 0.35rem;
}

.rbWarnung {
    margin: 0.6rem 0 0;
    padding: 0.4rem 0.6rem;
    border-left: 3px solid rgba(240, 196, 25, 0.8);
    background: rgba(240, 196, 25, 0.08);
    font-size: 0.82rem;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
}

.rbQuelle {
    margin: 0.5rem 0 0;
    font-size: 0.78rem;
    color: var(--white-60);
    font-variant-numeric: tabular-nums;
}
</style>
