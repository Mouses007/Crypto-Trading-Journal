<script setup>
/**
 * Momentum Radar — Mo's Pine-Indikator als Kachel.
 *
 * Gerechnet wird auf dem Server (`server/momentum-radar.js`), hier wird nur
 * gezeichnet: oben der Verlauf der gewählten Chart-Zeitebene wie im Pine-Panel
 * (Welle, Geldfluss, Punkte, Rauten, Schienen, Divergenzen, Farbleiste),
 * darunter das Panel in Kurzform.
 *
 * Bewusst SVG statt ECharts: die Zeichen des Indikators (zwei Punktgrössen,
 * Schienen mit Grösse je Zeitebene, Rauten, Divergenzlinien mit Endpunkten)
 * sind in einer Chartbibliothek mehr Konfiguration als Zeichnung. Gezeichnet
 * wird in echten Pixeln (ResizeObserver) und nicht mit gestrecktem viewBox —
 * sonst würden aus den Punkten Ellipsen.
 *
 * Keine laufende Kerze, kein hohler Vorschau-Kreis: die Kachel kennt nur
 * geschlossene Kerzen. Was bis zum Kerzenschluss noch kippen kann, steht hier
 * gar nicht erst.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from '../../utils/dayjs-setup.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
    params: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['params'])
const { t } = useI18n()

const CHART_TF = ['5m', '15m', '1h', '4h']

/** Farben aus dem Pine (Gruppe 7), damit Kachel und TradingView gleich lesen. */
const F = {
    welle: '#6fa8ff',
    schatten: '#1f3a8a',
    signal: '#3d63d6',
    rein: '#4caf50',
    raus: '#c62828',
    futures: '#8e6cef',
    long: '#4caf50',
    short: '#ef5350',
    longStark: '#00e676',
    shortStark: '#ff1744',
    extrem: '#ffa726',
}
const TF_FARBE = { '1h': '#ffa726', '4h': '#ba68c8', '1d': '#ffffff', '1w': '#ffd54f' }
const TF_RADIUS = { '1h': 2.5, '4h': 3.5, '1d': 4.5, '1w': 5.5 }
const TF_NAME = { '1w': 'W', '1d': 'D', '4h': '4h', '1h': '1h', '15m': '15m', '5m': '5m' }

const tf = computed(() => props.daten?.chartTf || props.params?.tf || '15m')
const v = computed(() => props.daten?.verlauf || null)

// ── Zeichenfläche ──────────────────────────────────────────────────────────
const flaeche = ref(null)
const breite = ref(400)
const gemesseneHoehe = ref(150)
let ro = null
onMounted(() => {
    if (!flaeche.value) return
    ro = new ResizeObserver(([e]) => {
        breite.value = Math.max(120, e.contentRect.width)
        gemesseneHoehe.value = Math.max(110, e.contentRect.height)
    })
    ro.observe(flaeche.value)
})
onBeforeUnmount(() => { ro?.disconnect(); ro = null })

/* In der Kachel füllt der Verlauf, was das Panel übrig lässt — wer die Kachel
   am Anfasser höher zieht, bekommt einen höheren Verlauf. Gross: fest. */
const hoehe = computed(() => (props.gross ? 340 : gemesseneHoehe.value))
/** Wertebereich: Schienen bei ±115, Farbleiste darunter. */
const Y_OBEN = 128
const Y_UNTEN = -140
const RAND_R = 34  // rechts Platz für die Beschriftung der Linien

const n = computed(() => v.value?.w1?.length || 0)
const schritt = computed(() => (n.value > 1 ? (breite.value - RAND_R) / (n.value - 1) : 0))
const x = (i) => i * schritt.value
const y = (w) => ((Y_OBEN - w) / (Y_OBEN - Y_UNTEN)) * hoehe.value

/** Pfad einer Linie; Lücken (null) unterbrechen sie, statt sie auf 0 zu ziehen. */
function linie(werte) {
    let d = ''
    let offen = false
    werte.forEach((w, i) => {
        if (w === null || w === undefined) { offen = false; return }
        d += `${offen ? 'L' : 'M'}${x(i).toFixed(1)},${y(w).toFixed(1)}`
        offen = true
    })
    return d
}

/** Fläche zwischen Linie und Nulllinie, je zusammenhängendem Stück. */
function flaechePfad(werte) {
    const stuecke = []
    let akt = []
    werte.forEach((w, i) => {
        if (w === null || w === undefined) { if (akt.length) stuecke.push(akt); akt = []; return }
        akt.push(i)
    })
    if (akt.length) stuecke.push(akt)
    return stuecke.map(s => {
        const oben = s.map(i => `${x(i).toFixed(1)},${y(werte[i]).toFixed(1)}`).join('L')
        return `M${x(s[0]).toFixed(1)},${y(0).toFixed(1)}L${oben}L${x(s[s.length - 1]).toFixed(1)},${y(0).toFixed(1)}Z`
    }).join('')
}

/** Geldfluss als Balken je Kerze — so kann jede Kerze ihre eigene Farbe haben (violett!). */
const mfBalken = computed(() => {
    if (!v.value?.mf) return []
    const b = Math.max(1, schritt.value * 0.92)
    const nullY = y(0)
    return v.value.mf.map((w, i) => {
        if (w === null || w === undefined) return null
        const yy = y(w)
        const tr = v.value.treiber?.[i]
        return {
            x: x(i) - b / 2, y: Math.min(yy, nullY), h: Math.max(0.5, Math.abs(yy - nullY)), b,
            farbe: tr === 'f' ? F.futures : w >= 0 ? F.rein : F.raus,
        }
    }).filter(Boolean)
})

/** Farbleiste: 4h-Geldfluss je Kerze, ganz unten. */
const leiste = computed(() => {
    if (!v.value?.mf4) return []
    const b = Math.max(1, schritt.value)
    return v.value.mf4.map((w, i) => ({
        x: x(i) - b / 2, b,
        farbe: w === null || w === undefined ? 'rgba(120,123,134,0.4)' : w >= 0 ? F.rein : F.raus,
    }))
})

const punkte = computed(() => (v.value?.punkte || []).map(p => ({
    ...p,
    cx: x(p.i),
    cy: y(v.value.w1[p.i] ?? 0),
    r: p.stark ? (props.gross ? 6 : 4.5) : (props.gross ? 3.5 : 2.6),
    farbe: p.seite === 'long' ? (p.stark ? F.longStark : F.long) : (p.stark ? F.shortStark : F.short),
})))

const rauten = computed(() => (v.value?.rauten || []).map(r => {
    const cx = x(r.i)
    const cy = y(v.value.w1[r.i] ?? 0)
    const s = props.gross ? 5 : 3.5
    return { ...r, d: `M${cx},${cy - s}L${cx + s},${cy}L${cx},${cy + s}L${cx - s},${cy}Z` }
}))

const schienen = computed(() => (v.value?.schienen || []).map(s => ({
    ...s,
    cx: x(s.i),
    cy: y(s.seite === 'long' ? -115 : 115),
    r: TF_RADIUS[s.tf] * (props.gross ? 1.25 : 0.9),
    farbe: TF_FARBE[s.tf],
})))

const divergenzen = computed(() => (v.value?.divergenzen || []).map(d => ({
    ...d,
    x1: x(d.i1), y1: y(d.w1), x2: x(d.i2), y2: y(d.w2),
    farbe: d.seite === 'long' ? F.long : F.short,
})))

// ── Fadenkreuz ─────────────────────────────────────────────────────────────
const zeiger = ref(null)
function beiBewegung(e) {
    if (!n.value || !schritt.value) return
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round((e.clientX - r.left) / schritt.value)
    zeiger.value = i >= 0 && i < n.value ? i : null
}
const zeigerText = computed(() => {
    const i = zeiger.value
    if (i === null || !v.value) return ''
    const z = (w) => (w === null || w === undefined ? '—' : `${w > 0 ? '+' : ''}${w.toFixed(1)}`)
    return `${dayjs(v.value.t[i]).format('DD.MM. HH:mm')} · ${t('livetrading.momentum.welle')} ${z(v.value.w1[i])}`
        + ` · ${t('livetrading.momentum.fluss')} ${z(v.value.mf[i])}`
        + (v.value.mfSpot ? ` · Spot ${z(v.value.mfSpot[i])}` : '')
})

// ── Panel ──────────────────────────────────────────────────────────────────
const status = computed(() => props.daten?.status ?? 0)
const statusText = computed(() => t('livetrading.momentum.status_' + (status.value > 0 ? 'long' : status.value < 0 ? 'short' : 'warten')))
const modusText = computed(() => t('livetrading.momentum.modus_' + (props.daten?.modus || 'day')))
const setupText = (d) => t('livetrading.momentum.setup_' + (d > 0 ? 'long' : d < 0 ? 'short' : 'kein'))
const richtungKlasse = (d) => (d > 0 ? 'mrLong' : d < 0 ? 'mrShort' : 'mrNeutral')
const pfeil = (d) => (d > 0 ? '▲' : d < 0 ? '▼' : '•')

const zeitebenen = computed(() => props.daten?.zeitebenen || [])
const zustandText = (z) => (z.zustand ? t('livetrading.momentum.zustand_' + z.zustand) : '—')

const letzter = computed(() => props.daten?.letzterPunkt || null)

const her = computed(() => props.daten?.herkunft || {})
const herkunftText = computed(() => {
    if (props.daten?.spotStatus === 'gestoert') return t('livetrading.momentum.herkunft_gestoert')
    if (!props.daten?.spotVerfuegbar) return t('livetrading.momentum.herkunft_keinSpot')
    if (!her.value.urteil) return t('livetrading.momentum.herkunft_unbekannt')
    return t('livetrading.momentum.herkunft_' + her.value.urteil)
})
/**
 * Zum Ablesen die Aufteilung (Fut + Spot = 100 %), geurteilt wird aber über
 * das Verhältnis gegen sein Normalmass — deshalb steht das daneben: „9,0×
 * (Ø 6,7×)" sagt, wie weit es vom Üblichen weg ist, ein Anteil nahe 100 %
 * sagt das nicht mehr.
 */
const herkunftZahl = computed(() => {
    const a = her.value.anteil
    const r = her.value.verhaeltnis
    if (a === null || a === undefined || r === null || r === undefined) return ''
    const s = her.value.schnitt
    const x = (w) => `${w.toFixed(w >= 10 ? 0 : 1)}×`
    // Nur das Verhältnis gegen sein Normalmass — danach wird geurteilt. Die
    // Aufteilung in Prozent steht im Tooltip des Feldes (`herkunftTitel`).
    return `${x(r)}${s ? ` · Ø ${x(s)}` : ''}`
})

const herkunftTitel = computed(() => {
    const a = her.value.anteil
    const teile = [herkunftText.value, herkunftZahl.value]
    if (a !== null && a !== undefined) teile.push(`Fut ${Math.round(a * 100)} % · Spot ${Math.round(100 - a * 100)} %`)
    return teile.filter(Boolean).join(' · ')
})

const fluss = computed(() => props.daten?.geldfluss || {})
const zahl = (w) => (w === null || w === undefined ? '—' : `${w > 0 ? '+' : ''}${w.toFixed(1)}`)

const vw = computed(() => props.daten?.vwap || {})
// Ein blosser Pfeil sagt nur "drueber" oder "drunter" - der Abstand sagt, wie weit.
const istZahl = (x) => typeof x === 'number' && Number.isFinite(x)
const vwAbw = (kurs) => (istZahl(kurs) && kurs !== 0 && istZahl(vw.value.preis)
    ? ((vw.value.preis - kurs) / kurs) * 100 : null)
const vwW = computed(() => vwAbw(vw.value.woche))
const vwM = computed(() => vwAbw(vw.value.monat))
const prozent = (w) => (w === null ? '—' : `${w > 0 ? '+' : ''}${w.toFixed(1)} %`)
const vwKlasse = (w) => (w === null ? 'mrNeutral' : w >= 0 ? 'mrLong' : 'mrShort')
// Die Kurse selbst beim Darueberfahren, damit die Zeile kurz bleibt
const vwTitel = computed(() => {
    const k = (x) => (istZahl(x) ? Math.round(x).toLocaleString('de-CH') : '—')
    return `Wochen-VWAP ${k(vw.value.woche)} · Monats-VWAP ${k(vw.value.monat)} · Kurs ${k(vw.value.preis)}`
})

const str = computed(() => props.daten?.struktur || null)
/** Kurs lesbar: ab 1000 ganze Zahl mit Tausenderlücke, darunter fünf Stellen. */
const kurs = (x) => (!istZahl(x) ? '—'
    : x >= 1000 ? Math.round(x).toLocaleString('de-CH').replace(/['’]/g, ' ') : x.toPrecision(5))
const strHaupt = computed(() => {
    const s = str.value
    if (!s) return '—'
    if (!s.richtung || s.level === null) return t('livetrading.momentum.keinBruch')
    return `${s.choch ? 'CHoCH' : 'BOS'} ${pfeil(s.richtung)} ${kurs(s.level)}`
})
const strNeben = computed(() => {
    const s = str.value
    if (!s) return ''
    return [
        s.richtung && s.alterKerzen !== null ? t('livetrading.momentum.vorKerzen', { n: s.alterKerzen }) : null,
        `EMA50 ${pfeil(s.emaRichtung)}`,
    ].filter(Boolean).join(' · ')
})

/** Die Level selbst unter den Abständen — wer handelt, will die Zahl. */
const vwNeben = computed(() => `W ${kurs(vw.value.woche)} · M ${kurs(vw.value.monat)}`)
</script>

<template>
    <div v-if="daten" class="mrWrap" :class="{ gross }">
        <div class="mrLeiste">
            <button v-for="z in CHART_TF" :key="z" type="button"
                :class="['ctl-pill', tf === z ? 'active' : '']"
                @click.stop="emit('params', { tf: z })">{{ z }}</button>
            <span class="mrStatus" :class="richtungKlasse(status)">
                ▶ {{ statusText }} · {{ modusText }}
            </span>
            <span class="mrSymbol">{{ daten.symbol?.replace(/USDT$/, '') }}</span>
        </div>

        <!-- Verlauf der Chart-Zeitebene -->
        <div ref="flaeche" class="mrFlaeche" :style="gross ? { height: hoehe + 'px' } : null"
            @mousemove="beiBewegung" @mouseleave="zeiger = null">
            <svg v-if="v && n > 1" :width="breite" :height="hoehe" class="mrSvg">
                <!-- Linien: Extrem ±100, Zonen ±50, Null, Schienen ±115 -->
                <line v-for="w in [100, -100]" :key="'ov' + w" x1="0" :x2="breite - RAND_R" :y1="y(w)" :y2="y(w)"
                    class="mrLinieExtrem" />
                <line v-for="w in [50, -50]" :key="'z' + w" x1="0" :x2="breite - RAND_R" :y1="y(w)" :y2="y(w)"
                    class="mrLinieZone" />
                <line x1="0" :x2="breite - RAND_R" :y1="y(0)" :y2="y(0)" class="mrLinieNull" />
                <line x1="0" :x2="breite - RAND_R" :y1="y(115)" :y2="y(115)" class="mrSchiene" :style="{ stroke: F.short }" />
                <line x1="0" :x2="breite - RAND_R" :y1="y(-115)" :y2="y(-115)" class="mrSchiene" :style="{ stroke: F.long }" />
                <text :x="breite - RAND_R + 4" :y="y(50) + 3" class="mrSkala">+50</text>
                <text :x="breite - RAND_R + 4" :y="y(-50) + 3" class="mrSkala">−50</text>
                <text v-if="gross" :x="breite - RAND_R + 4" :y="y(100) + 3" class="mrSkala">+100</text>
                <text v-if="gross" :x="breite - RAND_R + 4" :y="y(-100) + 3" class="mrSkala">−100</text>

                <!-- Welle: Schatten (Signallinie), helle Fläche, Geldfluss, Linien -->
                <path :d="flaechePfad(v.w2)" :fill="F.schatten" fill-opacity="0.85" />
                <path :d="flaechePfad(v.w1)" :fill="F.welle" fill-opacity="0.45" />
                <rect v-for="(b, i) in mfBalken" :key="'mf' + i" :x="b.x" :y="b.y" :width="b.b" :height="b.h"
                    :fill="b.farbe" fill-opacity="0.9" />
                <path v-if="v.mfSpot" :d="linie(v.mfSpot)" class="mrSpot" />
                <path :d="linie(v.w1)" class="mrWelle" :style="{ stroke: F.welle }" />
                <path :d="linie(v.w2)" class="mrSignal" :style="{ stroke: F.signal }" />

                <!-- Farbleiste: 4h-Geldfluss -->
                <rect v-for="(b, i) in leiste" :key="'fl' + i" :x="b.x" :y="y(-123)" :width="b.b"
                    :height="y(-136) - y(-123)" :fill="b.farbe" fill-opacity="0.75" />

                <!-- Divergenzen der Chart-Zeitebene: durchgezogen, mit Endpunkten -->
                <g v-for="(d, i) in divergenzen" :key="'dv' + i">
                    <line :x1="d.x1" :y1="d.y1" :x2="d.x2" :y2="d.y2" :stroke="d.farbe" stroke-width="2" />
                    <circle :cx="d.x1" :cy="d.y1" r="2.5" :fill="d.farbe" />
                    <circle :cx="d.x2" :cy="d.y2" r="2.5" :fill="d.farbe" />
                    <text v-if="gross" :x="(d.x1 + d.x2) / 2" :y="(d.y1 + d.y2) / 2 - 5" class="mrDiv"
                        :fill="d.farbe">DIV</text>
                </g>

                <circle v-for="(s, i) in schienen" :key="'sc' + i" :cx="s.cx" :cy="s.cy" :r="s.r" :fill="s.farbe" />
                <circle v-for="(p, i) in punkte" :key="'pt' + i" :cx="p.cx" :cy="p.cy" :r="p.r" :fill="p.farbe" />
                <path v-for="(r, i) in rauten" :key="'ra' + i" :d="r.d" :fill="F.extrem" />

                <line v-if="zeiger !== null" :x1="x(zeiger)" :x2="x(zeiger)" y1="0" :y2="hoehe" class="mrZeiger" />
            </svg>
            <div v-if="zeigerText" class="mrZeigerText">{{ zeigerText }}</div>
        </div>

        <!-- Panel: Zeitebenen als eine Zeile Chips -->
        <div class="mrTfs">
            <div v-for="z in zeitebenen" :key="z.tf" class="mrTf" :class="richtungKlasse(z.dir)"
                :title="(z.wert !== null ? `${TF_NAME[z.tf]}: ${zahl(z.wert)}` : '') + (z.zaehlt ? ' · ' + t('livetrading.momentum.zaehlt') : '')">
                <span class="mrTfName" :style="TF_FARBE[z.tf] ? { color: TF_FARBE[z.tf] } : null">{{ TF_NAME[z.tf] }}</span>
                <span class="mrTfZustand">{{ zustandText(z) }}</span>
                <span v-if="z.signal" class="mrTfSignal">●</span>
                <span v-if="z.zaehlt" class="mrTfZaehlt" />
            </div>
        </div>

        <!--
            Panel als Felder: Beschriftung klein oben, darunter der Wert und
            grau die Nebenangabe. Vier Spalten, zwei Reihen, feine Linien
            dazwischen — die frühere Fassung reihte Beschriftung und Wert
            abwechselnd in einer Zeile, und die vier Spalten liefen ineinander.
        -->
        <div class="mrFelder">
            <div class="mrFeld mrErste">
                <span class="mrLabel">Swing <small>D/4h/1h</small></span>
                <span class="mrWert" :class="richtungKlasse(daten.swing)">{{ setupText(daten.swing) }}</span>
            </div>
            <div class="mrFeld">
                <span class="mrLabel">Day <small>15m/5m</small></span>
                <span class="mrWert" :class="richtungKlasse(daten.day)">{{ setupText(daten.day) }}</span>
            </div>
            <div class="mrFeld">
                <span class="mrLabel">{{ t('livetrading.momentum.letzterPunkt') }}</span>
                <span v-if="letzter" class="mrWert">
                    <b :class="richtungKlasse(letzter.seite === 'long' ? 1 : -1)">{{ letzter.seite === 'long' ? 'Long' : 'Short' }}{{ letzter.stark ? ' · ' + t('livetrading.momentum.stark') : '' }}</b>
                    <small>{{ t('livetrading.momentum.vorKerzen', { n: letzter.vorKerzen }) }}</small>
                </span>
                <span v-else class="mrWert mrNeutral">—</span>
            </div>
            <div class="mrFeld">
                <span class="mrLabel">{{ t('livetrading.momentum.fluss') }}</span>
                <span class="mrWert">
                    <b :class="fluss.wert === null || fluss.wert === undefined ? 'mrNeutral' : fluss.wert >= 0 ? 'mrLong' : 'mrShort'">{{ zahl(fluss.wert) }}</b>
                    <small>4h {{ zahl(fluss.h4) }}<template v-if="fluss.spot !== null && fluss.spot !== undefined"> · Spot {{ zahl(fluss.spot) }}</template></small>
                </span>
            </div>

        </div>
        <!-- Untere Reihe dreigeteilt: VWAP und Struktur brauchen mehr als ein Viertel -->
        <div class="mrFelder mrDrei">
            <div class="mrFeld mrErste" :title="herkunftTitel">
                <span class="mrLabel">{{ t('livetrading.momentum.herkunft') }}</span>
                <span class="mrWert">
                    <b :class="{ mrViolett: her.urteil === 'futures', mrLong: her.urteil === 'spot', mrNeutral: !her.urteil }">{{ herkunftText }}</b>
                    <small v-if="herkunftZahl">{{ herkunftZahl }}</small>
                </span>
            </div>
            <div class="mrFeld" :title="vwTitel">
                <span class="mrLabel">VWAP</span>
                <span class="mrWert">
                    W <b :class="vwKlasse(vwW)">{{ prozent(vwW) }}</b>
                    · M <b :class="vwKlasse(vwM)">{{ prozent(vwM) }}</b>
                    <small>{{ vwNeben }}</small>
                </span>
            </div>
            <div class="mrFeld" :title="strHaupt + ' · ' + strNeben">
                <span class="mrLabel">{{ t('livetrading.momentum.struktur') }} <small>4h</small></span>
                <span class="mrWert">
                    <b :class="richtungKlasse(str?.richtung || 0)">{{ strHaupt }}</b>
                    <small>{{ strNeben }}</small>
                </span>
            </div>
        </div>

        <!-- Gross: die Zeichenerklärung, im Pine das „?" am Rand -->
        <div v-if="gross" class="mrLegende">
            <p v-for="z in ['punkte', 'flaeche', 'spot', 'schienen', 'linien', 'kopf', 'wann']" :key="z">
                {{ t('livetrading.momentum.legende_' + z) }}
            </p>
        </div>
    </div>
</template>

<style scoped>
.mrWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-height: 0;
    font-variant-numeric: tabular-nums;
}

.mrLeiste {
    display: flex;
    align-items: center;
    gap: 0.2rem;
}

.mrLeiste .ctl-pill {
    padding: 0.05rem 0.45rem;
    font-size: 0.74rem;
}

.mrStatus {
    margin-left: 0.5rem;
    padding: 0.08rem 0.55rem;
    border-radius: var(--border-radius, 6px);
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    border: 1px solid currentColor;
}

.mrSymbol {
    margin-left: auto;
    font-size: 0.86rem;
    font-weight: 600;
    color: rgb(90, 156, 255);
}

.mrFlaeche {
    position: relative;
    width: 100%;
    flex: 1 1 auto;
    min-height: 110px;
    overflow: hidden;
}

.mrWrap.gross .mrFlaeche { flex: 0 0 auto; }

.mrSvg { display: block; position: absolute; inset: 0; }

.mrLinieExtrem { stroke: rgba(224, 224, 224, 0.28); stroke-width: 1; }
.mrLinieZone { stroke: rgba(255, 255, 255, 0.5); stroke-width: 1.2; }
.mrLinieNull { stroke: rgba(120, 123, 134, 0.6); stroke-dasharray: 3 3; }
.mrSchiene { stroke-opacity: 0.4; stroke-width: 1; }
.mrSkala { font-size: 9px; fill: rgba(255, 255, 255, 0.45); }
.mrWelle { fill: none; stroke-width: 1.8; }
.mrSignal { fill: none; stroke-width: 1; stroke-opacity: 0.6; }
.mrSpot { fill: none; stroke: rgba(255, 255, 255, 0.85); stroke-width: 1; }
.mrDiv { font-size: 9px; font-weight: 600; text-anchor: middle; }
.mrZeiger { stroke: rgba(255, 255, 255, 0.25); stroke-width: 1; }

.mrZeigerText {
    position: absolute;
    top: 2px;
    left: 4px;
    font-size: 0.68rem;
    color: var(--white-87);
    background: rgba(13, 13, 20, 0.8);
    padding: 0 0.3rem;
    border-radius: 3px;
    pointer-events: none;
}

.mrTfs {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 0.2rem;
}

.mrTf {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.06rem 0.1rem;
    border-radius: 4px;
    font-size: 0.7rem;
    line-height: 1.15;
    background: rgba(120, 123, 134, 0.12);
}

.mrTf.mrLong { background: rgba(76, 175, 80, 0.2); }
.mrTf.mrShort { background: rgba(239, 83, 80, 0.2); }

.mrTfName { font-weight: 700; font-size: 0.74rem; color: var(--white-87); }
.mrTfZustand { color: var(--white-87); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.mrTfSignal { position: absolute; top: 1px; left: 4px; font-size: 0.55rem; color: #ffd54f; }

/* Kleiner Punkt rechts oben: diese Zeitebene zählt bei der Punktstärke mit */
.mrTfZaehlt {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.6);
}

.mrFelder {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.mrFeld {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
    padding: 0.16rem 0.55rem;
    line-height: 1.25;
    border-left: 1px solid rgba(255, 255, 255, 0.07);
}

.mrFeld.mrErste { border-left: 0; padding-left: 0.1rem; }
.mrFelder.mrDrei { grid-template-columns: minmax(0, 0.92fr) minmax(0, 1fr) minmax(0, 1.08fr); border-top-color: rgba(255, 255, 255, 0.07); margin-top: -0.25rem; }

.mrLabel {
    color: var(--white-60);
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
}

.mrLabel small {
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.62rem;
    color: var(--white-38, rgba(255, 255, 255, 0.38));
}

.mrWert {
    font-size: 0.82rem;
    color: var(--white-87);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.mrWert b { font-weight: 600; }
.mrWert small { margin-left: 0.35rem; font-size: 0.7rem; color: var(--white-60); }

.gross .mrWert { font-size: 0.92rem; }

.mrLong { color: #4caf50; }
.mrShort { color: #ef5350; }
.mrNeutral { color: var(--white-60); }
.mrViolett { color: #a58cf5; }
.mrTf.mrLong, .mrTf.mrShort, .mrTf.mrNeutral { color: inherit; }

.mrLegende {
    margin-top: 0.4rem;
    font-size: 0.8rem;
    color: var(--white-60);
    columns: 2;
    column-gap: 1.4rem;
}

.mrLegende p { margin: 0 0 0.35rem; break-inside: avoid; }
</style>
