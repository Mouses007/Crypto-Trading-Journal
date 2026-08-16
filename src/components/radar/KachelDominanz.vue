<script setup>
/**
 * Kachel „BTC-Dominanz" — Anteil von Bitcoin an der gesamten Kryptomarkt-
 * Kapitalisierung.
 *
 * Die Kurve stammt aus dem EIGENEN Bestand, nicht aus einem fremden Rahmen.
 *
 * Vorher hing hier das TradingView-Einbettwidget. Es hat zwei Nachteile, die
 * sich beide gezeigt haben: Inhaltsblocker sperren die Widget-Domain — dann
 * bleibt ein schwarzes Loch statt einer Kurve — und es liefert ein Bild,
 * keine Daten, mit denen sich rechnen liesse.
 *
 * Stattdessen liegt die Historie in `market_snapshots` (sechs Jahre, einmalig
 * eingelagert, täglich nachgeführt). Gezeigt werden drei Reihen: Bitcoin,
 * Ethereum und der ganze Rest. Erst zusammen sagen sie etwas — steigt BTC,
 * während der Rest fällt, ist es eine Flucht in Bitcoin; steigen beide,
 * kommt frisches Geld in den Markt.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import dayjs from '../../utils/dayjs-setup.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t, locale } = useI18n()
const chartEl = ref(null)
let chart = null
let ro = null

const MINDEST_TAGE = 7

/** Zeitfenster der grossen Kurve, je Gerät gemerkt. */
const ZEITRAEUME = [
    { tage: 30, key: 'd30' },
    { tage: 365, key: 'y1' },
    { tage: 0, key: 'all' },
]
const SPEICHER = 'marktradar_dom_zeitraum'
const zeitraum = ref(Number(localStorage.getItem(SPEICHER) ?? 365))

function setzeZeitraum(tage) {
    zeitraum.value = tage
    localStorage.setItem(SPEICHER, String(tage))
    zeichne()
}

const historie = computed(() => props.daten?.historie || [])
const ethHistorie = computed(() => props.daten?.ethHistorie || [])

/** Auf das gewählte Fenster beschneiden; 0 heisst „alles". */
function imFenster(reihe) {
    if (!zeitraum.value) return reihe
    const ab = Date.now() - zeitraum.value * 86400000
    return reihe.filter(([t]) => t >= ab)
}

/**
 * „Rest" = alles ausser Bitcoin und Ethereum. Wird gerechnet, nicht geholt —
 * die Summe der drei ergibt zwangsläufig 100 %, und genau das macht die
 * Aussage lesbar.
 */
const restHistorie = computed(() => {
    const eth = new Map(ethHistorie.value)
    return historie.value
        .filter(([t]) => eth.has(t))
        .map(([t, btc]) => [t, Math.round((100 - btc - eth.get(t)) * 100) / 100])
})

const seitText = computed(() => (props.daten?.seit ? dayjs(props.daten.seit).format('DD.MM.YYYY') : ''))

/** Gesamtmarkt in Billionen/Milliarden — die rohe Zahl liest niemand. */
const mcapText = computed(() => {
    const v = props.daten?.jetzt?.mcapUsd
    if (!v) return ''
    const en = locale.value === 'en'
    if (v >= 1e12) return `${(v / 1e12).toFixed(2)} ${en ? 'T' : 'Bio.'} $`
    return `${(v / 1e9).toFixed(0)} ${en ? 'B' : 'Mrd.'} $`
})

function zeichne() {
    if (!chart || historie.value.length < 2) return

    if (props.gross) {
        const reihe = (daten, name, farbe, flaeche) => ({
            name, type: 'line', showSymbol: false, connectNulls: false,
            data: imFenster(daten),
            lineStyle: { width: 1.6, color: farbe },
            itemStyle: { color: farbe },
            areaStyle: flaeche ? { color: flaeche } : undefined,
        })
        chart.setOption({
            backgroundColor: 'transparent',
            animation: false,
            grid: { left: 44, right: 12, top: 28, bottom: 24 },
            legend: {
                top: 0, textStyle: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
                data: ['Bitcoin', 'Ethereum', t('marktradar.dom.rest')],
            },
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(18,18,18,0.94)',
                borderColor: 'rgba(255,255,255,0.18)',
                textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
                formatter: (ps) => `${dayjs(ps[0].data[0]).format('DD.MM.YYYY')}<br/>`
                    + ps.map(x => `${x.marker}${x.seriesName}: <b>${x.data[1].toFixed(2)} %</b>`).join('<br/>'),
            },
            xAxis: {
                type: 'time',
                axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
                axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
            },
            yAxis: {
                type: 'value', scale: true,
                axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12, formatter: '{value} %' },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
            series: [
                reihe(historie.value, 'Bitcoin', '#f7931a', 'rgba(247,147,26,0.10)'),
                reihe(ethHistorie.value, 'Ethereum', '#627eea'),
                reihe(restHistorie.value, t('marktradar.dom.rest'), '#9aa0aa'),
            ],
        }, true)
        return
    }

    chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        grid: { left: 2, right: 2, top: 4, bottom: 2, containLabel: false },
        xAxis: { type: 'time', show: false },
        yAxis: { type: 'value', scale: true, show: false },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => `${dayjs(p[0].data[0]).format('DD.MM.YYYY')}: <b>${p[0].data[1].toFixed(2)} %</b>`,
        },
        series: [{
            type: 'line', data: historie.value, showSymbol: false,
            // Lücken bleiben Lücken: war die Instanz aus, wurde nichts gemessen
            connectNulls: false,
            lineStyle: { width: 1.6, color: '#f7931a' },
            areaStyle: { color: 'rgba(247,147,26,0.12)' },
        }],
    }, true)
}

onMounted(async () => {
    await nextTick()
    if (chartEl.value) {
        chart = echarts.init(chartEl.value)
        ro = new ResizeObserver(() => chart?.resize())
        ro.observe(chartEl.value)
        zeichne()
        requestAnimationFrame(() => chart?.resize())
    }
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
    <div v-if="daten" class="domWrap" :class="{ gross }">
        <div class="domKopf">
            <span class="domWert">{{ daten.jetzt.pct?.toFixed(2) }} %</span>
            <span v-if="daten.delta7 !== null" class="domDelta"
                :class="daten.delta7 > 0 ? 'up' : (daten.delta7 < 0 ? 'down' : '')">
                {{ daten.delta7 > 0 ? '+' : '' }}{{ daten.delta7 }} {{ t('marktradar.dom.vs7d') }}
            </span>
            <span v-else class="domAufbau">
                {{ t('marktradar.dom.building', { n: daten.tage, ziel: MINDEST_TAGE }) }}
            </span>
            <span v-if="mcapText" class="domMcap">
                {{ t('marktradar.dom.totalMcap') }} <b>{{ mcapText }}</b>
            </span>
        </div>

        <!-- Klein: nur die eigene Reihe, keine Fremdskripte -->
        <template v-if="!gross">
            <div v-if="historie.length >= 2" ref="chartEl" class="domSpark"></div>
            <div v-else class="domLeer">
                <i class="uil uil-chart-line"></i>
                <span>{{ t('marktradar.dom.noHistory') }}</span>
            </div>
        </template>

        <!-- Gross: eigene Kurve aus dem eingelagerten Bestand -->
        <template v-else>
            <div class="domZeitraum">
                <button v-for="z in ZEITRAEUME" :key="z.tage" type="button"
                    class="ctl-pill" :class="{ active: zeitraum === z.tage }"
                    @click="setzeZeitraum(z.tage)">
                    {{ t('marktradar.dom.range.' + z.key) }}
                </button>
                <span v-if="daten.eth" class="domAufteilung">
                    BTC {{ daten.jetzt.pct }} % · ETH {{ daten.eth }} % ·
                    {{ t('marktradar.dom.rest') }} {{ (100 - daten.jetzt.pct - daten.eth).toFixed(1) }} %
                </span>
            </div>

            <!-- EIN Chart-Container, kein zweiter: `ref` darf nur einmal
                 vergeben werden, sonst bindet Vue an das letzte Vorkommen —
                 dann bleibt der obere Kasten leer und die Kurve klebt unten. -->
            <div ref="chartEl" class="domGross"></div>

            <p class="domQuelle">
                {{ t('marktradar.dom.ownSeries', { seit: seitText, n: daten.tage }) }}
                — {{ t('marktradar.dom.source') }}
            </p>
        </template>
    </div>
</template>

<style scoped>
.domWrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 140px;
}

/* Gross wächst mit dem Inhalt und wird vom Overlay gescrollt */
.domWrap.gross {
    height: auto;
}

.domKopf {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    text-align: center;
}

.domWert {
    font-size: 2.1rem;
    font-weight: 700;
    color: #f7931a;
    line-height: 1.15;
}

.domDelta {
    font-size: 0.8rem;
}

.domDelta.up {
    color: rgb(38, 190, 150);
}

.domDelta.down {
    color: rgb(255, 95, 86);
}

.domAufbau,
.domHinweis {
    font-size: 0.8rem;
    color: var(--white-60);
}

.domMcap {
    font-size: 0.84rem;
    color: var(--white-60);
}

.domMcap b {
    margin-left: 0.4rem;
    color: var(--white-87);
}

/* Tag 1: noch keine eigene Reihe. Lieber ein ehrlicher Platzhalter als eine
   flache Linie, die eine Messung vortäuscht. */
.domLeer {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    text-align: center;
    font-size: 0.8rem;
    color: var(--white-60);
}

.domLeer i {
    font-size: 1.4rem;
    opacity: 0.5;
}

.domSpark {
    flex: 1 1 auto;
    min-height: 120px;
}

/* position:relative ist Pflicht: das TradingView-Widget hängt seinen Rahmen
   absolut ein und suchte sich sonst den nächsten positionierten Vorfahren —
   den Overlay-Kasten — und legte sich damit über alles Nachfolgende. */
/* Die grosse Kurve skaliert mit dem Fenster; nach oben begrenzt, damit die
   eigene Reihe und die Quellenangabe darunter im Blick bleiben. */
.domGross {
    height: 46vh;
    min-height: 260px;
    max-height: 620px;
    margin: 0.5rem 0 0.8rem;
}

.domZeitraum {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
}

.domZeitraum .ctl-pill {
    padding: 0.05rem 0.55rem;
    font-size: 0.76rem;
}

.domAufteilung {
    margin-left: auto;
    font-size: 0.8rem;
    color: var(--white-60);
    white-space: nowrap;
}

.domQuelle {
    margin: 0.4rem 0 0;
    font-size: 0.8rem;
    color: var(--white-60);
}

</style>
