<script setup>
/**
 * Kachel „RSI-Heatmap" — die Verteilung des ganzen Marktes auf einer Skala.
 *
 * Bewusst ein Streubild und keine Matrix aus Zahlen: die interessante Frage ist
 * nicht „welchen RSI hat Coin X", sondern „hängt der ganze Markt oben oder
 * unten, und wer schert aus". Jeder Punkt ist ein Markt, die Höhe sein RSI, die
 * Farbe seine Zone. Von links nach rechts nach Umsatz — links die grossen.
 *
 * Der Durchschnitt als waagerechte Linie ist der eigentliche Mehrwert: er sagt,
 * ob ein einzelner Ausschlag zum Markt passt oder gegen ihn läuft.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import { liveSymbol } from '../../stores/live.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const emit = defineEmits(['params'])

const { t } = useI18n()
const chartEl = ref(null)
let chart = null
let ro = null

const TFS = ['15m', '1h', '4h', '1d', '1w']
const TOP_N = [10, 50, 100]

/**
 * Nur drei Zonen. Die Vorstufen „stark" (60–70) und „schwach" (30–40) sind
 * wieder raus: dazwischen passiert nichts, was eine eigene Farbe verdient —
 * interessant ist ausschliesslich, wer über 70 oder unter 30 steht. Weniger
 * Bänder heissen auch, dass die zwei verbleibenden Grenzen wirklich ins Auge
 * fallen.
 */
const ZONEN = [
    { von: 70, bis: 100, farbe: '#ff5f56', key: 'overbought' },
    { von: 30, bis: 70, farbe: '#9aa0aa', key: 'neutral' },
    { von: 0, bis: 30, farbe: '#26be96', key: 'oversold' },
]

const zoneFuer = (v) => ZONEN.find(z => v >= z.von && v <= z.bis) || ZONEN[2]

const punkte = computed(() => props.daten?.punkte || [])
const kurz = (s) => s.replace(/USDT$/, '')

function zeichne() {
    if (!chart || !punkte.value.length) return

    const daten = punkte.value.map((p, i) => ({
        value: [i, p.rsi],
        name: p.symbol,
        itemStyle: { color: zoneFuer(p.rsi).farbe },
        label: {
            // Alle beschriften; was sich überlagert, schiebt oder versteckt
            // labelLayout weiter unten — von Hand vorzufiltern hiess, dass
            // ausgerechnet die Punkte im dichten Mittelfeld namenlos blieben.
            show: true,
            position: 'top', distance: 3,
            fontSize: props.gross ? 13 : 11,
            color: 'rgba(255,255,255,0.8)',
            formatter: () => kurz(p.symbol),
        },
    }))

    chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        grid: { left: 30, right: 8, top: 12, bottom: props.gross ? 24 : 8 },
        tooltip: {
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => {
                const eintrag = punkte.value[p.data.value[0]]
                const z = zoneFuer(eintrag.rsi)
                const umsatz = eintrag.volumen24h >= 1e9
                    ? `${(eintrag.volumen24h / 1e9).toFixed(1)} Mrd`
                    : `${Math.round(eintrag.volumen24h / 1e6)} Mio`
                return `<b>${kurz(eintrag.symbol)}</b> · ${props.daten.tf}<br/>`
                    + `RSI <b>${eintrag.rsi}</b> — ${t('marktradar.rsi.zone_' + z.key)}<br/>`
                    + `<span style="opacity:.6">${t('marktradar.funding.volume')}: ${umsatz}</span>`
            },
        },
        xAxis: {
            type: 'value', min: -1, max: punkte.value.length,
            show: false, axisPointer: { show: false },
        },
        yAxis: {
            type: 'value', min: 0, max: 100, interval: 20,
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
        },
        series: [{
            type: 'scatter',
            symbolSize: props.gross ? 11 : 8,
            data: daten,
            // Überlappende Namen werden senkrecht auseinandergeschoben; was
            // dann immer noch kollidiert, fällt weg statt zu Brei zu werden
            labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
            // Die Zonen als Flächen: der Punkt allein sagt wenig ohne die Skala
            markArea: {
                silent: true,
                label: {
                    show: props.gross, position: 'insideRight',
                    color: 'rgba(255,255,255,0.28)', fontSize: 12,
                },
                data: ZONEN.map(z => ([
                    {
                        yAxis: z.von,
                        name: props.gross ? t('marktradar.rsi.zone_' + z.key) : '',
                        // Neutral bekommt einen leichten Grauton: vorher war das
                        // Band praktisch unsichtbar und die Zone dadurch nicht
                        // als eigener Bereich erkennbar
                        itemStyle: { color: z.key === 'neutral' ? 'rgba(255,255,255,0.07)' : z.farbe + '1f' },
                    },
                    { yAxis: z.bis },
                ])),
            },
            markLine: {
                silent: true, symbol: 'none',
                label: { show: false },
                lineStyle: { color: 'rgba(255,255,255,0.45)', type: 'dashed', width: 1 },
                data: [
                    // Zonengrenzen: die Flächen allein liessen offen, wo genau
                    // 30, 40, 60 und 70 liegen — bei einem Punkt knapp an der
                    // Kante ist das aber genau die Frage
                    ...ZONEN.slice(1).map(z => ({
                        yAxis: z.bis,
                        lineStyle: { color: 'rgba(255,255,255,0.4)', type: 'dashed', width: 1 },
                    })),
                    // Der Marktdurchschnitt hebt sich davon ab: heller, breiter,
                    // beschriftet — er ist eine Messung, keine feste Marke
                    ...(props.daten.schnitt !== null ? [{
                        yAxis: props.daten.schnitt,
                        lineStyle: { color: 'rgba(255,255,255,0.85)', type: [6, 4], width: 1.6 },
                        label: {
                            show: true, position: 'insideEndTop', fontSize: 12,
                            color: 'rgba(255,255,255,0.85)',
                            formatter: () => `${t('marktradar.rsi.average')} ${props.daten.schnitt}`,
                        },
                    }] : []),
                ],
            },
        }],
    }, true)
}

function beiKlick(p) {
    const eintrag = punkte.value[p.data?.value?.[0]]
    if (eintrag) liveSymbol.value = eintrag.symbol
}

onMounted(async () => {
    await nextTick()
    if (!chartEl.value) return
    chart = echarts.init(chartEl.value)
    chart.on('click', beiKlick)
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
    <div v-if="daten" class="rWrap" :class="{ gross }">
        <div class="rLeiste">
            <!-- Zeiteinheit umschalten lädt die Kachel neu; die Seite holt, wir sagen nur Bescheid -->
            <button v-for="tf in TFS" :key="tf" type="button"
                :class="['ctl-pill', daten.tf === tf ? 'active' : '']"
                @click.stop="emit('params', { tf })">{{ tf }}</button>

            <span class="ctl-sep"></span>

            <button type="button" :class="['ctl-pill', daten.quelle === 'top' ? 'active' : '']"
                :title="t('marktradar.rsi.topHint')"
                @click.stop="emit('params', { quelle: 'top' })">{{ t('marktradar.rsi.top') }}</button>
            <button type="button" :class="['ctl-pill', daten.quelle === 'eigene' ? 'active' : '']"
                :title="t('marktradar.rsi.ownHint')"
                @click.stop="emit('params', { quelle: 'eigene' })">{{ t('marktradar.rsi.own') }}</button>

            <!-- Ranglisten-Grösse: nur sinnvoll, solange die Quelle die Rangliste ist -->
            <template v-if="daten.quelle === 'top'">
                <span class="ctl-sep"></span>
                <span class="rLabel">{{ t('marktradar.top') }}</span>
                <button v-for="n in TOP_N" :key="n" type="button"
                    :class="['ctl-pill', daten.n === n ? 'active' : '']"
                    @click.stop="emit('params', { n })">{{ n }}</button>
            </template>

            <span class="rZahl">{{ t('marktradar.rsi.count', { n: daten.gezaehlt }) }}</span>
        </div>

        <div ref="chartEl" class="rChart"></div>

        <p v-if="gross" class="rQuelle">
            {{ t('marktradar.rsi.source') }}
            <span v-if="daten.quelle === 'eigene'"> {{ t('marktradar.rsi.derived') }}</span>
        </p>
    </div>
</template>

<style scoped>
.rWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.rLeiste {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    padding-bottom: 0.25rem;
}

.rLeiste::-webkit-scrollbar {
    display: none;
}

.rLeiste .ctl-pill {
    padding: 0.05rem 0.45rem;
    font-size: 0.74rem;
    flex: 0 0 auto;
}

.rLabel {
    font-size: 0.72rem;
    color: var(--white-60);
    margin: 0 0.1rem 0 0.15rem;
    white-space: nowrap;
}

.rZahl {
    margin-left: auto;
    padding-left: 0.4rem;
    font-size: 0.74rem;
    color: var(--white-60);
    white-space: nowrap;
}

.rChart {
    flex: 1 1 auto;
    min-height: 120px;
}

.rWrap.gross .rChart {
    min-height: 52vh;
}

.rQuelle {
    margin: 0.6rem 0 0;
    font-size: 0.8rem;
    color: var(--white-60);
}
</style>
