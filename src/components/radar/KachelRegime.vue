<script setup>
/**
 * Kachel „Deine Trades × Marktregime".
 *
 * Die einzige Kachel hier, die es fertig nirgends zu kaufen gibt: sie kreuzt
 * das eigene Journal mit der Stimmungslage am Handelstag. Die Frage dahinter
 * ist nicht „wie steht der Markt", sondern „wie handle ICH, wenn er so steht".
 *
 * Zurückhaltung ist Absicht: bei wenigen Trades je Eimer steht die Zahl grau
 * und mit Hinweis da. Sieben Trades sind keine Erkenntnis, und eine Kachel,
 * die aus sieben Trades eine Regel macht, richtet mehr Schaden an als Nutzen.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()
const chartEl = ref(null)
let chart = null
let ro = null

/** Unter dieser Zahl gilt ein Eimer als nicht aussagekräftig. */
const MINDEST_TRADES = 10

const FARBEN = {
    extremeFear: '#d13b3b', fear: '#e07a3b', neutral: '#9aa0aa',
    greed: '#7cb342', extremeGreed: '#26be96',
}

const buckets = computed(() => props.daten?.buckets || [])
const beste = computed(() => buckets.value.find(b => b.id === props.daten?.beste) || null)
/** Alles im Minus? Dann ist „beste Phase" die falsche Vokabel. */
const alleNegativ = computed(() => buckets.value.every(b => b.anzahl === 0 || b.summe <= 0))

const geld = (v) => `${v >= 0 ? '+' : ''}${Math.round(v).toLocaleString('de-CH')} $`

function zeichne() {
    if (!chart || !buckets.value.length) return

    chart.setOption(props.gross ? optionStreu() : optionBalken(), true)
}

/** Klein: Summe je Stimmungslage — die eine Zahl, die zählt. */
function optionBalken() {
    return {
        backgroundColor: 'transparent',
        animation: false,
        grid: { left: 52, right: 10, top: 10, bottom: 34 },
        tooltip: {
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => {
                const b = buckets.value[p.dataIndex]
                return `<b>${t('marktradar.regime.b_' + b.id)}</b><br/>`
                    + `${t('marktradar.regime.sum')}: <b>${geld(b.summe)}</b><br/>`
                    + `${t('marktradar.regime.trades')}: ${b.anzahl}`
                    + (b.trefferquote !== null ? ` · ${t('marktradar.regime.winrate')} ${b.trefferquote} %` : '')
            },
        },
        xAxis: {
            type: 'category',
            data: buckets.value.map(b => t('marktradar.regime.kurz_' + b.id)),
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 11, interval: 0 },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
        },
        yAxis: {
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        series: [{
            type: 'bar',
            data: buckets.value.map(b => ({
                value: b.summe,
                itemStyle: {
                    color: b.summe >= 0 ? 'rgb(38,190,150)' : 'rgb(255,95,86)',
                    // Zu dünne Datenlage wird blass gezeichnet statt weggelassen
                    opacity: b.anzahl >= MINDEST_TRADES ? 1 : 0.4,
                },
            })),
        }],
    }
}

/** Gross: jeder Trade ein Punkt — Stimmungswert gegen Ergebnis. */
function optionStreu() {
    const punkte = props.daten?.punkte || []
    return {
        backgroundColor: 'transparent',
        animation: false,
        grid: { left: 62, right: 14, top: 14, bottom: 34 },
        tooltip: {
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => `Fear & Greed <b>${p.data[0]}</b><br/>`
                + `${t('marktradar.regime.result')}: <b>${geld(p.data[1])}</b><br/>`
                + (p.data[2] ? 'Long' : 'Short'),
        },
        xAxis: {
            type: 'value', min: 0, max: 100, name: 'Fear & Greed',
            nameLocation: 'middle', nameGap: 24,
            nameTextStyle: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        yAxis: {
            type: 'value', name: t('marktradar.regime.result'),
            nameTextStyle: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        },
        series: [
            {
                type: 'scatter', symbolSize: 7, data: punkte,
                itemStyle: {
                    color: (p) => (p.data[1] >= 0 ? 'rgba(38,190,150,0.75)' : 'rgba(255,95,86,0.75)'),
                },
                markLine: {
                    silent: true, symbol: 'none',
                    lineStyle: { color: 'rgba(255,255,255,0.3)' },
                    data: [{ yAxis: 0 }],
                },
            },
        ],
    }
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

watch([() => props.daten, () => props.gross], zeichne)
</script>

<template>
    <div v-if="daten" class="rgWrap" :class="{ gross }">
        <div ref="chartEl" class="rgChart"></div>

        <p v-if="beste" class="rgSatz">
            <template v-if="alleNegativ">
                {{ t('marktradar.regime.leastBad', {
                    phase: t('marktradar.regime.b_' + beste.id), summe: geld(beste.summe), n: beste.anzahl
                }) }}
            </template>
            <template v-else>
                {{ t('marktradar.regime.best', {
                    phase: t('marktradar.regime.b_' + beste.id), summe: geld(beste.summe), n: beste.anzahl
                }) }}
            </template>
        </p>

        <template v-if="gross">
            <table class="rgTabelle">
                <thead>
                    <tr>
                        <th>{{ t('marktradar.regime.phase') }}</th>
                        <th class="r">{{ t('marktradar.regime.trades') }}</th>
                        <th class="r">{{ t('marktradar.regime.winrate') }}</th>
                        <th class="r">{{ t('marktradar.regime.sum') }}</th>
                        <th class="r">{{ t('marktradar.regime.avg') }}</th>
                        <th class="r">{{ t('marktradar.regime.pf') }}</th>
                        <th class="r">{{ t('marktradar.regime.longShare') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="b in buckets" :key="b.id" :class="{ duenn: b.anzahl < MINDEST_TRADES }">
                        <td><i :style="{ background: FARBEN[b.id] }"></i>{{ t('marktradar.regime.b_' + b.id) }}
                            <small>{{ b.von }}–{{ b.bis }}</small>
                        </td>
                        <td class="r">{{ b.anzahl }}</td>
                        <td class="r">{{ b.trefferquote === null ? '—' : b.trefferquote + ' %' }}</td>
                        <td class="r" :class="b.summe >= 0 ? 'up' : 'down'">{{ b.anzahl ? geld(b.summe) : '—' }}</td>
                        <td class="r">{{ b.schnitt === null ? '—' : geld(b.schnitt) }}</td>
                        <td class="r">{{ b.profitfaktor === null ? '—' : b.profitfaktor }}</td>
                        <td class="r">{{ b.longAnteil === null ? '—' : b.longAnteil + ' %' }}</td>
                    </tr>
                </tbody>
            </table>

            <p class="rgQuelle">
                {{ t('marktradar.regime.source', { n: daten.gesamt.bewertet, tage: daten.tage }) }}
                <span v-if="daten.gesamt.ohneFng"> {{ t('marktradar.regime.missing', { n: daten.gesamt.ohneFng }) }}</span>
                {{ t('marktradar.regime.thin', { n: MINDEST_TRADES }) }}
            </p>
        </template>
    </div>
</template>

<style scoped>
.rgWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.rgChart {
    flex: 1 1 auto;
    min-height: 130px;
}

.rgWrap.gross .rgChart {
    min-height: 44vh;
}

.rgSatz {
    margin: 0.35rem 0 0;
    font-size: 0.82rem;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
}

.rgTabelle {
    width: 100%;
    margin-top: 0.8rem;
    border-collapse: collapse;
    font-size: 0.86rem;
}

.rgTabelle th {
    text-align: left;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--white-60);
    padding: 0.3rem 0.4rem;
    white-space: nowrap;
}

.rgTabelle td {
    padding: 0.25rem 0.4rem;
    border-top: 1px solid var(--white-12, rgba(255, 255, 255, 0.07));
    font-variant-numeric: tabular-nums;
}

.rgTabelle td i {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 2px;
    margin-right: 0.4rem;
}

.rgTabelle td small {
    color: var(--white-38);
    margin-left: 0.3rem;
}

/* Dünne Datenlage: sichtbar, aber zurückgenommen */
.rgTabelle tr.duenn td {
    opacity: 0.55;
}

.r {
    text-align: right;
}

.up {
    color: rgb(38, 190, 150);
}

.down {
    color: rgb(255, 95, 86);
}

.rgQuelle {
    margin: 0.6rem 0 0;
    font-size: 0.78rem;
    color: var(--white-60);
}
</style>
