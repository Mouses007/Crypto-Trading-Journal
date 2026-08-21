<script setup>
/**
 * Kachel „ETF-Fluss".
 *
 * Wie viele Bitcoin die Spot-ETFs halten und wie sich das täglich ändert.
 * Der Zufluss IST die Bestandsänderung — es gibt keine zweite Zahl dafür.
 *
 * Bewusst in BTC und nicht in Dollar: der Bestand steht in BTC, und mal
 * Tageskurs gerechnet bewegte sich der „Zufluss" auch an Tagen, an denen kein
 * einziger Anteil geschaffen wurde. Wer Dollar sehen will, multipliziert im
 * Kopf — das ist ehrlicher als eine Zahl, die zwei Dinge vermischt.
 *
 * Die Kurve wächst mit: der Gratis-Tarif der Quelle gibt 30 Tage her, alles
 * Ältere ist selbst gesammelt. Deshalb steht unten, auf wie vielen eigenen
 * Tagen sie steht.
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

const gesamt = computed(() => props.daten?.gesamt || null)
const leer = computed(() => !!props.daten?.leer)

/** Bestände sind gross, Flüsse klein — beide sollen lesbar bleiben. */
const btc = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('de-CH') : '—')
const flussText = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString('de-CH')}` : '—')
const klasse = (v) => (!Number.isFinite(v) ? '' : v > 0 ? 'zu' : v < 0 ? 'ab' : '')

/**
 * Fenstersummen tragen mit, worauf sie beruhen. Fehlen Tage, steht es dabei —
 * eine 7-Tage-Summe aus drei Tagen ist keine Wochenbilanz.
 */
const fenster = (f) => {
    if (!f || f.summe === null) return { text: '—', luecke: false }
    return {
        text: flussText(f.summe),
        luecke: f.bekannt < f.moeglich,
    }
}
const woche = computed(() => fenster(gesamt.value?.fluss7))
const monat = computed(() => fenster(gesamt.value?.fluss30))

function zeichne() {
    if (!chart || !props.daten?.reihe?.length) return
    const reihe = props.daten.reihe

    chart.setOption({
        backgroundColor: 'transparent',
        animation: false,
        grid: {
            left: props.gross ? 64 : 46, right: props.gross ? 60 : 42,
            top: props.gross ? 28 : 10, bottom: props.gross ? 28 : 18,
        },
        legend: props.gross ? {
            top: 0, textStyle: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
            data: [t('marktradar.etf.fluss'), t('marktradar.etf.bestand')],
        } : { show: false },
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => `${dayjs(p[0].data[0]).format('DD.MM.YYYY')}<br/>`
                + p.map(x => `${x.marker}${x.seriesName}: <b>${x.data[1] === null ? '—' : btc(x.data[1])} BTC</b>`).join('<br/>'),
        },
        xAxis: {
            type: 'time',
            axisLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 11 },
            axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
        },
        yAxis: [
            {
                // Fluss: um die Null herum, damit Zu- und Abfluss vergleichbar bleiben
                type: 'value',
                axisLabel: {
                    color: 'rgba(255,255,255,0.6)', fontSize: 11,
                    formatter: (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v),
                },
                splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
            },
            {
                // Bestand: eigene Achse, sonst wäre der Fluss ein Strich auf der Null
                type: 'value', scale: true, position: 'right',
                axisLabel: {
                    color: 'rgba(255,255,255,0.45)', fontSize: 11,
                    formatter: (v) => `${Math.round(v / 1000)}k`,
                },
                splitLine: { show: false },
            },
        ],
        series: [
            {
                name: t('marktradar.etf.fluss'), type: 'bar', yAxisIndex: 0,
                data: reihe.map(p => [p[0], p[2]]),
                itemStyle: {
                    color: (p) => (p.data[1] >= 0 ? 'rgba(38,190,150,0.85)' : 'rgba(255,95,86,0.85)'),
                },
                barMaxWidth: 14,
                z: 3,
            },
            {
                name: t('marktradar.etf.bestand'), type: 'line', yAxisIndex: 1, showSymbol: false,
                data: reihe.map(p => [p[0], p[1]]),
                lineStyle: { width: 1.4, color: 'rgba(255,255,255,0.5)' },
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
    <div v-if="daten" class="etfWrap" :class="{ gross }">
        <!-- Kein Schlüssel ist kein Fehler, sondern der Auslieferungszustand.
             Deshalb ein Weg statt einer Fehlermeldung. -->
        <div v-if="leer" class="etfLeer">
            <i class="uil" :class="daten.ohneSchluessel ? 'uil-key-skeleton' : 'uil-clock-three'"></i>
            <p v-if="daten.ohneSchluessel">
                {{ t('marktradar.etf.keinSchluessel') }}
                <router-link to="/settings" class="etfLink">{{ t('marktradar.etf.zuEinstellungen') }}</router-link>
            </p>
            <p v-else>{{ daten.hinweis || t('marktradar.etf.wartet') }}</p>
        </div>

        <template v-else>
            <div class="etfKopf">
                <span class="etfFluss" :class="klasse(gesamt?.fluss1)">{{ flussText(gesamt?.fluss1) }}</span>
                <span class="etfEinheit">BTC</span>
                <span class="etfTag">
                    {{ gesamt?.tag ? dayjs(gesamt.tag).format('DD.MM.') : '—' }}
                </span>
            </div>

            <div class="etfZeile">
                <span>{{ t('marktradar.etf.woche') }}</span>
                <b :class="klasse(gesamt?.fluss7?.summe)">{{ woche.text }}</b>
                <i v-if="woche.luecke" class="uil uil-exclamation-circle etfLuecke"
                    :title="t('marktradar.etf.unvollstaendig')"></i>
                <span class="etfTrenner">·</span>
                <span>{{ t('marktradar.etf.monat') }}</span>
                <b :class="klasse(gesamt?.fluss30?.summe)">{{ monat.text }}</b>
                <i v-if="monat.luecke" class="uil uil-exclamation-circle etfLuecke"
                    :title="t('marktradar.etf.unvollstaendig')"></i>
            </div>

            <div ref="chartEl" class="etfChart"></div>

            <div class="etfFuss">
                {{ t('marktradar.etf.bestandGesamt') }} <b>{{ btc(gesamt?.bestand) }} BTC</b>
            </div>

            <template v-if="gross">
                <table class="etfTabelle">
                    <thead>
                        <tr>
                            <th>{{ t('marktradar.etf.fonds') }}</th>
                            <th class="r">{{ t('marktradar.etf.bestand') }}</th>
                            <th class="r">{{ t('marktradar.etf.anteil') }}</th>
                            <th class="r">{{ t('marktradar.etf.tagesfluss') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="f in daten.fonds" :key="f.id">
                            <td>{{ f.name }}</td>
                            <td class="r">{{ btc(f.bestand) }}</td>
                            <td class="r sub">{{ f.anteilPct === null ? '—' : f.anteilPct + ' %' }}</td>
                            <td class="r" :class="klasse(f.fluss1)">{{ flussText(f.fluss1) }}</td>
                        </tr>
                        <!-- Der Rest ist keine Schätzung, sondern die Differenz
                             zur fremden Gesamtsumme: alle Fonds, die wir nicht
                             einzeln abfragen. -->
                        <tr v-if="daten.rest" class="etfRest">
                            <td>{{ t('marktradar.etf.rest') }}</td>
                            <td class="r">{{ btc(daten.rest) }}</td>
                            <td class="r sub">
                                {{ gesamt?.bestand ? Math.round((daten.rest / gesamt.bestand) * 1000) / 10 + ' %' : '—' }}
                            </td>
                            <td class="r sub">—</td>
                        </tr>
                    </tbody>
                </table>

                <p class="etfNotiz">
                    {{ t('marktradar.etf.eigeneTage', { n: daten.tageEigen }) }}
                    {{ t('marktradar.etf.nachtrag') }}
                </p>
            </template>
        </template>
    </div>
</template>

<style scoped>
.etfWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.etfLeer {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    text-align: center;
    color: var(--white-60);
    font-size: 0.85rem;
}

.etfLeer i {
    font-size: 1.6rem;
    opacity: 0.7;
}

.etfLeer p { margin: 0; }

.etfLink {
    color: var(--blue-color, #01B4FF);
    text-decoration: none;
    white-space: nowrap;
}

.etfKopf {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    flex-wrap: wrap;
}

.etfFluss {
    font-size: 1.6rem;
    font-weight: 700;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    color: var(--white-87);
}

.etfFluss.zu { color: #26be96; }
.etfFluss.ab { color: rgb(255, 95, 86); }

.etfEinheit {
    font-size: 0.85rem;
    color: var(--white-60);
}

.etfTag {
    margin-left: auto;
    font-size: 0.78rem;
    color: var(--white-60);
    font-variant-numeric: tabular-nums;
}

.etfZeile {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin-top: 0.15rem;
    font-size: 0.8rem;
    color: var(--white-60);
}

.etfZeile b {
    color: var(--white-87);
    font-variant-numeric: tabular-nums;
}

.etfZeile b.zu { color: #26be96; }
.etfZeile b.ab { color: rgb(255, 95, 86); }

.etfTrenner { opacity: 0.5; }

.etfLuecke {
    color: rgba(240, 196, 25, 0.9);
    font-size: 0.85rem;
}

.etfChart {
    flex: 1 1 auto;
    min-height: 96px;
}

.etfWrap.gross .etfChart { min-height: 40vh; }

.etfFuss {
    font-size: 0.78rem;
    color: var(--white-60);
}

.etfFuss b {
    color: var(--white-87);
    font-variant-numeric: tabular-nums;
}

.etfTabelle {
    width: 100%;
    margin-top: 0.8rem;
    border-collapse: collapse;
    font-size: 0.84rem;
}

.etfTabelle th {
    text-align: left;
    font-weight: 500;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--white-60);
    padding-bottom: 0.3rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.etfTabelle td {
    padding: 0.28rem 0;
    color: var(--white-87);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    font-variant-numeric: tabular-nums;
}

.etfTabelle .r { text-align: right; }
.etfTabelle .sub { color: var(--white-60); }
.etfTabelle .zu { color: #26be96; }
.etfTabelle .ab { color: rgb(255, 95, 86); }

.etfRest td { color: var(--white-60); font-style: italic; }

.etfNotiz {
    margin: 0.7rem 0 0;
    font-size: 0.8rem;
    color: var(--white-60);
}
</style>
