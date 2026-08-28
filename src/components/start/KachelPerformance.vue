<script setup>
/**
 * Kachel „Performance-Splits" — Netto-PnL nach Wochentag, Haltedauer oder Symbol.
 *
 * Self-supplying: bucketet die einzelnen Trades aus dem Startseiten-Store
 * (`journalTage`). Umschaltbar über einen kleinen Regler; die Wahl wird gemerkt
 * (`@anzeige`, kein Neuabruf). `daten` bleibt ungenutzt.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import dayjs from '../../utils/dayjs-setup.js'
import { journalTage, journalZustand } from '../../stores/startseite.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
    params: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['anzeige'])

const { t } = useI18n()
const chartEl = ref(null)
let chart = null
let ro = null

const MODI = ['wochentag', 'dauer', 'symbol']
const modus = computed(() => (MODI.includes(props.params?.modus) ? props.params.modus : 'wochentag'))
function setzeModus(m) {
    if (m !== modus.value) emit('anzeige', { modus: m })
}

/** Alle Einzel-Trades flach. */
const alleTrades = computed(() => {
    const out = []
    for (const tag of journalTage) {
        for (const el of (tag.trades || [])) {
            out.push({
                netto: Number(el.netProceeds) || 0,
                symbol: (el.symbol || '—').replace(/USDT$/, ''),
                entry: Number(el.entryTime) || Number(tag.dateUnix) || 0,
                exit: Number(el.exitTime) || 0,
            })
        }
    }
    return out
})

const WOCHENTAGE = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so']
const DAUER_STUFEN = [
    { key: 'lt5m', max: 5 * 60 },
    { key: 'lt30m', max: 30 * 60 },
    { key: 'lt4h', max: 4 * 3600 },
    { key: 'lt1d', max: 24 * 3600 },
    { key: 'gt1d', max: Infinity },
]

/** [ { label, wert }, … ] je nach Modus. */
const buckets = computed(() => {
    const ts = alleTrades.value
    if (modus.value === 'wochentag') {
        const summe = new Array(7).fill(0)
        for (const tr of ts) {
            // dayjs day(): 0=So..6=Sa → auf Mo=0..So=6 mappen
            const d = (dayjs.unix(tr.entry).day() + 6) % 7
            summe[d] += tr.netto
        }
        return WOCHENTAGE.map((k, i) => ({ label: t('startseite.performance.tag_' + k), wert: summe[i] }))
    }
    if (modus.value === 'dauer') {
        const summe = {}
        for (const st of DAUER_STUFEN) summe[st.key] = 0
        for (const tr of ts) {
            const d = tr.exit && tr.entry ? tr.exit - tr.entry : 0
            const st = DAUER_STUFEN.find(s => d < s.max) || DAUER_STUFEN[DAUER_STUFEN.length - 1]
            summe[st.key] += tr.netto
        }
        return DAUER_STUFEN.map(st => ({ label: t('startseite.performance.dauer_' + st.key), wert: summe[st.key] }))
    }
    // symbol — nach Betrag die auffälligsten
    const summe = {}
    for (const tr of ts) summe[tr.symbol] = (summe[tr.symbol] || 0) + tr.netto
    return Object.entries(summe)
        .map(([label, wert]) => ({ label, wert }))
        .sort((a, b) => Math.abs(b.wert) - Math.abs(a.wert))
        .slice(0, props.gross ? 20 : 8)
        .sort((a, b) => b.wert - a.wert)
})

function zeichne() {
    if (!chart) return
    const b = buckets.value
    chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        grid: { left: 8, right: 12, top: 10, bottom: 22, containLabel: true },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => `${p[0].axisValue}<br/><b>${Number(p[0].data).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> USDT`,
        },
        xAxis: {
            type: 'category',
            data: b.map(x => x.label),
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 10, interval: 0, rotate: modus.value === 'symbol' ? 40 : 0 },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
        },
        yAxis: {
            type: 'value',
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 10 },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        series: [{
            type: 'bar',
            data: b.map(x => Math.round(x.wert * 100) / 100),
            itemStyle: {
                color: (p) => (p.data >= 0 ? 'rgb(38, 190, 150)' : 'rgb(255, 95, 86)'),
                borderRadius: [2, 2, 0, 0],
            },
            barMaxWidth: 34,
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

watch([buckets, () => props.gross], () => { zeichne(); requestAnimationFrame(() => chart?.resize()) })
</script>

<template>
    <div class="pfWrap" :class="{ gross }">
        <div class="pfRegler">
            <button v-for="m in MODI" :key="m" type="button" class="pfPill" :class="{ aktiv: modus === m }"
                @click.stop="setzeModus(m)">
                {{ t('startseite.performance.modus_' + m) }}
            </button>
        </div>
        <div ref="chartEl" class="pfChart"></div>
        <p v-if="!alleTrades.length" class="pfLeer">{{ journalZustand === 'fehler' ? t('startseite.abrufFehler') : t('startseite.performance.leer') }}</p>
    </div>
</template>

<style scoped>
.pfWrap {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 140px;
}

.pfRegler {
    display: flex;
    gap: 0.3rem;
    margin-bottom: 0.3rem;
}

.pfPill {
    font-size: 0.72rem;
    padding: 0.1rem 0.55rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: transparent;
    color: var(--white-60);
    cursor: pointer;
}

.pfPill.aktiv {
    background: rgba(74, 144, 226, 0.18);
    border-color: rgba(74, 144, 226, 0.5);
    color: var(--white-87);
}

.pfChart {
    flex: 1 1 auto;
    min-height: 140px;
}

.pfLeer {
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
