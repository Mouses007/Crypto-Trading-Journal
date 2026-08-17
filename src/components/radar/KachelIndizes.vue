<script setup>
/**
 * Kachel „Indizes (Intraday)".
 *
 * ES, NQ und der Dollar-Index als Fünf-Minuten-Kerzen. Krypto läuft rund um die
 * Uhr, aber der Takt kommt von hier: dreht der Nasdaq-Future, dreht Bitcoin
 * meistens mit — und die Bewegung beginnt dort, nicht hier.
 *
 * Bewusst FUTURES statt Kassa-Indizes (ES=F, NQ=F): der Kassa-Index steht
 * ausserhalb der Börsenzeiten still, und genau dann handelt man Krypto. Die
 * Begründung steht ausführlich in `server/makro.js`.
 *
 * Die senkrechte Linie markiert die US-Kassaeröffnung. Sie ist der wichtigste
 * Punkt des Tages: davor ist der Future dünn, danach kommt das Volumen.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import dayjs from '../../utils/dayjs-setup.js'
import { lageZu } from '../../../shared/handelszeiten.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
    params: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['params', 'anzeige'])

const { t } = useI18n()
const chartEl = ref(null)
let chart = null
let ro = null

const MAERKTE = [
    { id: 'nasdaq', kurz: 'NQ' },
    { id: 'sp500', kurz: 'ES' },
    { id: 'dxy', kurz: 'DXY' },
]

/** Welcher Markt gezeichnet wird — die anderen stehen als Zahl daneben. */
const markt = ref(props.params.markt || 'nasdaq')

const gewaehlt = computed(() => props.daten?.maerkte?.[markt.value] || null)
const kerzen = computed(() => gewaehlt.value?.kerzen || [])

/** Prozentabstand zum Vortagesschluss — die Zahl, auf die alle schauen. */
function delta(m) {
    if (!m?.preis || !m?.vorherClose) return null
    return ((m.preis - m.vorherClose) / m.vorherClose) * 100
}

const farbeFuer = (d) => d == null ? 'var(--white-60)' : (d >= 0 ? '#4ec9a0' : '#ff6b7a')

/**
 * Zeitpunkt der US-Kassaeröffnung im dargestellten Zeitraum.
 *
 * Kommt aus `shared/handelszeiten.js` statt aus einer festen Uhrzeit — sonst
 * läge die Linie in den Sommerzeit-Lücken eine Stunde falsch.
 */
const eroeffnung = computed(() => {
    if (!kerzen.value.length) return null
    const letzte = kerzen.value[kerzen.value.length - 1].t
    const lage = lageZu(letzte)
    // Die Marke kann heute schon vorbei oder noch nicht gekommen sein — beides
    // liefert `phasenHeute`, also dort nach der Kassasitzung fragen
    const kassa = lage.phasenHeute.find(p => p.id === 'usKassa')
    if (!kassa) return null
    const erste = kerzen.value[0].t
    return kassa.von >= erste && kassa.von <= letzte ? kassa.von : null
})

const proz = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)} %`

function zeichne() {
    if (!chart || !kerzen.value.length) return
    const k = kerzen.value
    const zeiten = k.map(c => c.t)
    // ECharts-Kerzen erwarten [open, close, low, high] — in genau dieser Folge
    const werte = k.map(c => [c.o, c.c, c.l, c.h])
    const vorher = gewaehlt.value?.vorherClose

    chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        grid: props.gross
            ? { left: 58, right: 14, top: 18, bottom: 30 }
            : { left: 44, right: 6, top: 10, bottom: 20 },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            backgroundColor: 'rgba(20,20,24,0.94)',
            borderWidth: 0,
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 11 },
            formatter: (p) => {
                const a = Array.isArray(p) ? p[0] : p
                const i = a?.dataIndex
                if (i == null || !k[i]) return ''
                const c = k[i]
                return [
                    dayjs(c.t).format('HH:mm'),
                    `O ${c.o}  H ${c.h}`,
                    `L ${c.l}  C ${c.c}`,
                    c.v ? `Vol ${c.v}` : '',
                ].filter(Boolean).join('<br>')
            },
        },
        xAxis: {
            type: 'category',
            data: zeiten.map(t => dayjs(t).format('HH:mm')),
            axisLabel: {
                color: 'rgba(255,255,255,0.6)',
                fontSize: props.gross ? 11 : 9,
                // Bei 120 Kerzen wäre jede Marke Brei
                interval: Math.max(1, Math.floor(k.length / (props.gross ? 10 : 5))),
            },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.14)' } },
            axisTick: { show: false },
        },
        yAxis: {
            type: 'value',
            scale: true,
            position: 'left',
            axisLabel: { color: 'rgba(255,255,255,0.6)', fontSize: props.gross ? 11 : 9 },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        series: [{
            type: 'candlestick',
            data: werte,
            itemStyle: {
                color: '#4ec9a0', color0: '#ff6b7a',
                borderColor: '#4ec9a0', borderColor0: '#ff6b7a',
                borderWidth: 1,
            },
            markLine: {
                silent: true,
                symbol: 'none',
                animation: false,
                data: [
                    // Vortagesschluss: die Nulllinie des Tages
                    ...(vorher ? [{
                        yAxis: vorher,
                        lineStyle: { color: 'rgba(255,255,255,0.35)', type: 'dashed', width: 1 },
                        label: {
                            show: props.gross, position: 'insideEndTop',
                            formatter: t('livetrading.indizes.vortag'),
                            color: 'rgba(255,255,255,0.6)', fontSize: 10,
                        },
                    }] : []),
                    // US-Kassaeröffnung
                    ...(eroeffnung.value ? [{
                        xAxis: dayjs(eroeffnung.value).format('HH:mm'),
                        lineStyle: { color: '#ffc93c', type: 'solid', width: 1 },
                        label: {
                            show: props.gross, position: 'insideEndBottom',
                            formatter: t('livetrading.indizes.eroeffnung'),
                            color: '#ffc93c', fontSize: 10,
                        },
                    }] : []),
                ],
            },
        }],
    }, true)
}

function waehle(id) {
    markt.value = id
    // Nur Anzeige: alle drei Märkte stecken schon in derselben Nutzlast, ein
    // Umschalten darf keinen neuen Abruf auslösen.
    emit('anzeige', { markt: id })
    nextTick(zeichne)
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
    <div v-if="daten" class="ixWrap" :class="{ gross }">
        <div class="ixKopf">
            <button v-for="m in MAERKTE" :key="m.id" type="button"
                :class="['ixPille', markt === m.id ? 'active' : '']"
                @click.stop="waehle(m.id)">
                <span class="ixKurz">{{ m.kurz }}</span>
                <span v-if="daten.maerkte?.[m.id]" class="ixDelta"
                    :style="{ color: farbeFuer(delta(daten.maerkte[m.id])) }">
                    {{ proz(delta(daten.maerkte[m.id])) }}
                </span>
                <span v-else class="ixDelta ixFehlt">—</span>
            </button>
        </div>

        <div v-if="gewaehlt" class="ixPreis">
            <b>{{ gewaehlt.preis?.toLocaleString(undefined, { maximumFractionDigits: 3 }) }}</b>
            <span class="ixName">{{ gewaehlt.name }}</span>
            <span v-if="gewaehlt.zeit" class="ixZeit">{{ dayjs(gewaehlt.zeit).format('HH:mm') }}</span>
        </div>

        <div ref="chartEl" class="ixChart"></div>

        <div v-if="!kerzen.length" class="radarLeer">{{ t('livetrading.indizes.keineKerzen') }}</div>
        <div v-if="daten.hinweis" class="ixHinweis">{{ daten.hinweis }}</div>
    </div>
</template>

<style scoped>
.ixWrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: 0.25rem;
}

.ixKopf {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
}

.ixPille {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid transparent;
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
    font-size: 0.76rem;
    color: var(--white-60);
    cursor: pointer;
}

.ixPille.active {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.2);
    color: var(--white-87);
}

.ixKurz { font-weight: 700; }
.ixDelta { font-variant-numeric: tabular-nums; }
.ixFehlt { opacity: 0.4; }

.ixPreis {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    font-variant-numeric: tabular-nums;
}

.ixPreis b {
    font-size: 1.05rem;
    color: var(--white-87);
}

.ixName {
    font-size: 0.72rem;
    color: var(--white-60);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ixZeit {
    margin-left: auto;
    font-size: 0.72rem;
    color: var(--white-60);
}

/* Der Chart nimmt den Rest — `min-height: 0` ist Pflicht, sonst sprengt der
   Canvas in einem Flex-Container die Kachelhöhe. */
.ixChart {
    flex: 1;
    min-height: 0;
    width: 100%;
}

.ixHinweis {
    font-size: 0.7rem;
    color: #ffc93c;
}
</style>
