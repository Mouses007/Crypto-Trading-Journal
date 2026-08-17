<script setup>
/**
 * Kachel „Marktübersicht" — der ganze Markt auf einen Blick, in zwei Lesarten:
 *
 * - **Blasen** (wie cryptobubbles): Fläche = Stärke der Bewegung, Farbe =
 *   Richtung. Zeigt, WER sich bewegt — auch wenn es ein kleiner Wert ist.
 * - **Kacheln** (Treemap wie bei Finviz): Fläche = Marktkapitalisierung,
 *   Farbe = Veränderung. Zeigt, ob die Bewegung überhaupt Gewicht hat.
 *
 * Beide beantworten verschiedene Fragen, deshalb beide statt einer.
 * Stablecoins sind serverseitig aussortiert — sie stehen bauartbedingt bei 0 %.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import { liveSymbol } from '../../stores/live.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
    /** Gemerkte Anzeige-Einstellungen der Seite (überleben das Neuladen) */
    params: { type: Object, default: () => ({}) },
})

const { t } = useI18n()
const chartEl = ref(null)
let chart = null
let ro = null
let neuRechnen = null

/** Ranglisten-Grössen wie in den anderen Kacheln — mehr Stufen gibt es nicht. */
const TOP_N = [10, 50, 100]

/** Die Kachel meldet Parameteränderungen nach oben; die SEITE holt die Daten. */
const emit = defineEmits(['params', 'anzeige'])

const FENSTER = [
    { id: 'w1h', label: '1h' },
    { id: 'w24h', label: '24h' },
    { id: 'w7d', label: '7d' },
]

// Kacheln als Vorgabe: die Treemap ist die ruhigere Lesart und braucht keine
// Einarbeitung — die Blasen sind der Zweitblick.
const ansicht = ref(props.params.ansicht || 'kacheln')
const fenster = ref(props.params.fenster || 'w24h')
/**
 * Wonach sich die Fläche bemisst. Der Punkt, an dem die erste Fassung
 * gescheitert ist: an einem ruhigen Tag liegen alle Bewegungen zwischen
 * 0 und 3 %, und wenn man die Fläche direkt daran hängt, sind alle Blasen
 * gleich klein. Umgekehrt erschlägt Bitcoin jede Treemap nach Marktwert.
 *   'bewegung' — auf die Spanne des Tages GESPREIZT: die grösste Bewegung ist
 *                immer die grösste Fläche, egal wie ruhig es ist
 *   'mcap'     — nach Marktkapitalisierung, mit Wurzel gedämpft
 *   'gleich'   — alle gleich gross, es zählt nur die Farbe
 */
const flaeche = ref(props.params.flaeche || 'bewegung')

const muenzen = computed(() =>
    (props.daten?.muenzen || []).filter(m => Number.isFinite(m[fenster.value])))

/** Grün/Rot mit Sättigung nach Stärke — ±10 % ist voll ausgereizt. */
function farbe(v) {
    const t2 = Math.min(1, Math.abs(v) / 10)
    const a = 0.28 + 0.62 * t2
    return v >= 0 ? `rgba(38,190,150,${a})` : `rgba(255,95,86,${a})`
}

const proz = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} %`
const mcapText = (v) => (v >= 1e12 ? `${(v / 1e12).toFixed(2)} Bio.` : v >= 1e9 ? `${(v / 1e9).toFixed(1)} Mrd` : `${Math.round(v / 1e6)} Mio`)

function tooltipText(m) {
    const w = m[fenster.value]
    return `<b>${m.symbol}</b> — ${m.name}<br/>`
        + `${t('marktradar.markt.change')}: <b style="color:${w >= 0 ? '#26be96' : '#ff5f56'}">${proz(w)}</b><br/>`
        + `<span style="opacity:.65">${t('marktradar.markt.mcap')}: ${mcapText(m.mcap)} $ · #${m.rang}</span>`
        // Ohne Perp-Markt führt ein Klick nirgendwohin — das gehört dazugesagt
        + (m.perp ? '' : `<br/><span style="opacity:.65">${t('marktradar.markt.noPerp')}</span>`)
}

/**
 * Fläche eines Eintrags als Wert zwischen 0 und 1 — auf die tatsächliche
 * Spanne der Auswahl gespreizt. Dadurch sieht man Unterschiede auch dann,
 * wenn der ganze Markt nur um ein halbes Prozent zuckt.
 */
const gewichte = computed(() => {
    const roh = muenzen.value.map(m => {
        if (flaeche.value === 'gleich') return 1
        if (flaeche.value === 'mcap') return Math.sqrt(m.mcap || 0)
        return Math.abs(m[fenster.value])
    })
    // „Gleich" heisst mittlere Grösse, nicht maximale: 89 Blasen in
    // Höchstgrösse überdecken einander vollständig.
    if (flaeche.value === 'gleich') return roh.map(() => 0.4)
    const min = Math.min(...roh), max = Math.max(...roh)
    const spanne = Math.max(1e-9, max - min)
    // Wurzelartige Kennlinie: die Mitte bekommt mehr Platz, die Spitze
    // erdrückt den Rest nicht
    return roh.map(v => Math.pow((v - min) / spanne, 0.6))
})

function optionBlasen() {
    // Die Blasen sollen den Kasten füllen — nicht als kleiner Klumpen in der
    // Mitte kleben. Deshalb wird nicht mit festen Pixelgrössen gerechnet,
    // sondern die GESAMTFLÄCHE aller Blasen auf einen Anteil der Zeichenfläche
    // gesetzt. Zieht man die Kachel grösser, wachsen die Blasen mit.
    const breite = chart?.getWidth() || 600
    const hoehe = (chart?.getHeight() || 300)
    // 45 % der Fläche: das Kräftelayout ballt sich rund zusammen, ein rundes
    // Feld füllt ein breites Rechteck nie ganz. Mehr Füllung lässt die Blasen
    // ineinanderlaufen, weniger sieht verloren aus.
    const zielFlaeche = breite * hoehe * 0.45

    // Relative Grössen 0,4 … 1,0, dann so skaliert, dass die Summe der
    // Kreisflächen der Zielfläche entspricht
    const rel = gewichte.value.map(g => 0.4 + 0.6 * g)
    const quadratsumme = rel.reduce((s, r) => s + r * r, 0) || 1
    const k = Math.sqrt(zielFlaeche / ((Math.PI / 4) * quadratsumme))
    const deckel = Math.min(breite, hoehe) * 0.3

    const groessen = rel.map(r => Math.max(8, Math.min(deckel, r * k)))
    const mittel = groessen.reduce((s, v) => s + v, 0) / Math.max(1, groessen.length)

    return {
        backgroundColor: 'transparent',
        animation: true,
        animationDuration: 600,
        tooltip: {
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            formatter: (p) => tooltipText(p.data.roh),
        },
        series: [{
            type: 'graph',
            layout: 'force',
            roam: false,
            // Abstossung an der mittleren Blasengrösse ausgerichtet, kräftige
            // Anziehung zur Mitte: so entsteht ein dichtes Feld statt einer
            // dünn verteilten Punktwolke mit viel Leerraum.
            // Abstossung etwa an der mittleren Blasengrösse, schwache Anziehung:
            // stärkere Gravitation zog alles zu einem Klumpen in der Mitte
            // zusammen und liess den Rest des Kastens leer.
            force: {
                repulsion: mittel * 1.5,
                gravity: 0.08,
                edgeLength: 5,
                friction: 0.6,
            },
            data: muenzen.value.map((m, i) => {
                const w = m[fenster.value]
                const groesse = groessen[i]
                return {
                    name: m.symbol,
                    symbolSize: groesse,
                    roh: m,
                    itemStyle: { color: farbe(w), borderColor: 'rgba(0,0,0,0.35)', borderWidth: 1 },
                    label: {
                        // Beschriften, sobald der Text überhaupt hineinpasst;
                        // in grossen Blasen zusätzlich die Prozentzahl
                        show: groesse >= 22,
                        color: '#fff',
                        fontSize: Math.min(13, Math.max(9, groesse / 3.6)),
                        lineHeight: Math.min(14, Math.max(10, groesse / 3.4)),
                        formatter: () => (groesse >= 40 ? `${m.symbol}\n${proz(w)}` : m.symbol),
                    },
                }
            }),
        }],
    }
}

/**
 * Rohdaten eines Treemap-Knotens — oder `null`, wenn keine dranhängen.
 *
 * `roh` hängt nur an den selbst gebauten Knoten. ECharts legt darum aber einen
 * eigenen Wurzelknoten, und der ist in den Fugen zwischen den Kacheln und am
 * Rand der Zeichenfläche tatsächlich mit der Maus zu treffen — dort lief
 * vorher der Zugriff auf `roh` ins Leere.
 */
function rohVon(p) {
    return p?.data?.roh || null
}

function optionKacheln() {
    return {
        backgroundColor: 'transparent',
        animation: false,
        tooltip: {
            backgroundColor: 'rgba(18,18,18,0.94)',
            borderColor: 'rgba(255,255,255,0.18)',
            textStyle: { color: 'rgba(255,255,255,0.87)', fontSize: 12 },
            // Ohne Rohdaten gibt es nichts zu erzählen: `null` lässt ECharts
            // den Kasten ganz weg, ein leerer Text liesse ein leeres Kästchen
            // an der Maus kleben.
            formatter: (p) => (rohVon(p) ? tooltipText(rohVon(p)) : null),
        },
        series: [{
            type: 'treemap',
            roam: false,
            nodeClick: false,
            breadcrumb: { show: false },
            width: '100%', height: '100%',
            top: 0, left: 0, right: 0, bottom: 0,
            itemStyle: { borderColor: 'rgba(0,0,0,0.45)', borderWidth: 1, gapWidth: 1 },
            label: {
                show: true, fontSize: props.gross ? 12 : 11, color: '#fff',
                overflow: 'truncate', ellipsis: '',
                // Ohne Rohdaten bleibt der Name — sonst stünde dort eine
                // unbeschriftete Fläche
                formatter: (p) => {
                    const m = rohVon(p)
                    const name = p.data?.name || ''
                    return m ? `${name}\n${proz(m[fenster.value])}` : name
                },
            },
            // Kacheln unter 300 px² Fläche lässt ECharts weg — sonst entsteht
            // am Rand ein Streifen aus unlesbaren Splittern
            visibleMin: 300,
            // Fläche folgt der gewählten Skalierung: nach Marktkapitalisierung
            // (gedämpft), nach Stärke der Bewegung oder gleich gross
            data: muenzen.value.map((m, i) => ({
                name: m.symbol,
                value: Math.max(0.02, gewichte.value[i]),
                roh: m,
                itemStyle: { color: farbe(m[fenster.value]) },
            })),
        }],
    }
}

function zeichne() {
    if (!chart || !muenzen.value.length) return
    chart.setOption(ansicht.value === 'blasen' ? optionBlasen() : optionKacheln(), true)
}

/**
 * Klick setzt das Symbol der Live-Analyse — aber nur, wenn es den Markt auf
 * Binance überhaupt gibt. `perp` kommt vom Server aus der Binance-Symbolliste.
 */
function beiKlick(p) {
    const m = p.data?.roh
    if (m?.perp) liveSymbol.value = m.perp
}

onMounted(async () => {
    await nextTick()
    if (!chartEl.value) return
    chart = echarts.init(chartEl.value)
    chart.on('click', beiKlick)
    // Nach dem Ändern der Kachelgrösse NEU RECHNEN, nicht nur skalieren: die
    // Blasengrösse hängt an der Zeichenfläche. Entprellt, weil beim Ziehen am
    // Anfasser viele Ereignisse hintereinander kommen.
    ro = new ResizeObserver(() => {
        chart?.resize()
        clearTimeout(neuRechnen)
        neuRechnen = setTimeout(zeichne, 180)
    })
    ro.observe(chartEl.value)
    zeichne()
    requestAnimationFrame(() => chart?.resize())
})

onBeforeUnmount(() => {
    clearTimeout(neuRechnen)
    ro?.disconnect()
    ro = null
    chart?.dispose()
    chart = null
})

watch([() => props.daten, ansicht, fenster, flaeche], zeichne)
</script>

<template>
    <div v-if="daten" class="mWrap" :class="{ gross }">
        <div class="mLeiste">
            <button v-for="f in FENSTER" :key="f.id" type="button"
                :class="['ctl-pill', fenster === f.id ? 'active' : '']"
                @click.stop="fenster = f.id; emit('anzeige', { fenster: f.id })">{{ f.label }}</button>

            <span class="ctl-sep"></span>

            <button type="button" :class="['ctl-pill', ansicht === 'blasen' ? 'active' : '']"
                @click.stop="ansicht = 'blasen'; emit('anzeige', { ansicht: 'blasen' })">
                <i class="uil uil-circle"></i>{{ t('marktradar.markt.bubbles') }}
            </button>
            <button type="button" :class="['ctl-pill', ansicht === 'kacheln' ? 'active' : '']"
                @click.stop="ansicht = 'kacheln'; emit('anzeige', { ansicht: 'kacheln' })">
                <i class="uil uil-web-grid"></i>{{ t('marktradar.markt.tiles') }}
            </button>

            <span class="ctl-sep"></span>

            <!-- Wonach sich die Fläche bemisst — der eigentliche Hebel dieser Kachel -->
            <button v-for="f in ['bewegung', 'mcap', 'gleich']" :key="f" type="button"
                :class="['ctl-pill', flaeche === f ? 'active' : '']" :title="t('marktradar.markt.areaHint')"
                @click.stop="flaeche = f; emit('anzeige', { flaeche: f })">{{ t('marktradar.markt.area_' + f) }}</button>

            <span class="ctl-sep"></span>
            <span class="mLabel">{{ t('marktradar.top') }}</span>

            <button v-for="n in TOP_N" :key="n" type="button"
                :class="['ctl-pill', daten.n === n ? 'active' : '']"
                @click.stop="emit('params', { n })">{{ n }}</button>

            <span class="mZahl">{{ t('marktradar.markt.count', { n: muenzen.length }) }}</span>
        </div>

        <div ref="chartEl" class="mChart"></div>

        <p v-if="gross" class="mQuelle">{{ t('marktradar.markt.source') }}</p>
    </div>
</template>

<style scoped>
.mWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.mLeiste {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    padding-bottom: 0.25rem;
}

.mLeiste::-webkit-scrollbar {
    display: none;
}

.mLeiste .ctl-pill {
    padding: 0.05rem 0.45rem;
    font-size: 0.74rem;
    flex: 0 0 auto;
}

.mLabel {
    font-size: 0.72rem;
    color: var(--white-60);
    margin: 0 0.1rem 0 0.15rem;
    white-space: nowrap;
}

.mZahl {
    margin-left: auto;
    padding-left: 0.4rem;
    font-size: 0.74rem;
    color: var(--white-60);
    white-space: nowrap;
}

.mChart {
    flex: 1 1 auto;
    min-height: 150px;
}

.mWrap.gross .mChart {
    min-height: 56vh;
}

.mQuelle {
    margin: 0.6rem 0 0;
    font-size: 0.8rem;
    color: var(--white-60);
}
</style>
