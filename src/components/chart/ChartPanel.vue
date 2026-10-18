<script setup>
/**
 * Ein Chart-Panel: eine Lightweight-Charts-Instanz mit Kerzen und Volumen.
 *
 * Zeitbasis: intern MILLISEKUNDEN wie im ganzen Projekt; Lightweight Charts
 * rechnet in Sekunden. Umgerechnet wird nur hier (`zuLwc`/`vonLwc`). Angezeigt
 * wird Ortszeit über Formatierer — die Zeitstempel selbst bleiben UTC. Die
 * naheliegende Abkürzung, alle Zeitstempel um den Zonenversatz zu schieben,
 * erzeugt bei der Herbst-Umstellung eine doppelte Stunde, und die Bibliothek
 * verweigert dann die ganze Reihe („data must be asc ordered").
 *
 * Das Panel holt seine Kerzen selbst (Symbol, Markt, Zeiteinheit kommen als
 * Prop). Was darüber liegt — Indikatoren, Zeichnungen, Journal- und
 * Strategie-Overlays — hängt sich über `defineExpose` an.
 */
import { ref, shallowRef, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import {
    createChart, CandlestickSeries, HistogramSeries, CrosshairMode, PriceScaleMode, LineStyle,
} from 'lightweight-charts'
import { ladeKerzen, LiveKerze, fuegeZusammen, INTERVALL_MS } from '../../utils/chart/kerzenQuelle.js'
import { loadSymbolMeta } from '../../utils/liveSymbols.js'
import { IndikatorZeichner } from '../../utils/chart/indikatorZeichner.js'
import { kurzname } from '../../utils/chart/indikatorRegister.js'

const props = defineProps({
    panel: { type: Object, required: true },     // { symbol, markt, interval, skala }
    aktiv: { type: Boolean, default: false },
    nummer: { type: Number, default: 0 },
})
const emit = defineEmits(['fokus', 'kreuz', 'bereich', 'kerzen', 'indikator'])
const { t, locale } = useI18n()

const huelle = ref(null)
const chart = shallowRef(null)
const kerzenSerie = shallowRef(null)
const volumenSerie = shallowRef(null)
const kerzen = shallowRef([])        // [{t,o,h,l,c,v}] aufsteigend
const laedt = ref(false)
const fehler = ref('')
const status = ref('')               // connecting | open | closed
const legende = ref(null)            // Kerze unter dem Fadenkreuz (oder die letzte)
const preisStellen = ref(2)
const indikatorWerte = ref({})       // id → [{key, farbe, wert}] unter dem Fadenkreuz
let zeichner = null
let kreuzZeit = null                 // t (ms) unter dem Fadenkreuz; null = letzte Kerze
let nachfuehrUhr = null

let live = null
let ladeNummer = 0                   // verwirft Antworten auf überholte Anfragen
let nachladenLaeuft = false
let historieZuEnde = false
let extern = false                   // Fadenkreuz von aussen gesetzt → nicht zurückmelden

const zuLwc = (ms) => Math.floor(ms / 1000)
const vonLwc = (s) => Number(s) * 1000

function farbe(name, ersatz) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || ersatz
}

const istTagOderMehr = computed(() => (INTERVALL_MS[props.panel.interval] || 0) >= 86_400_000)

function zeitText(sek) {
    const d = dayjs.unix(sek)
    const tag = d.toDate().toLocaleString(locale.value, { weekday: 'short' })
    return istTagOderMehr.value ? `${tag} ${d.format('DD.MM.YY')}` : `${tag} ${d.format('DD.MM.YY HH:mm')}`
}

function baueChart() {
    const gruen = farbe('--green', '#26a69a')
    const rot = farbe('--red-color', '#FF6960')
    const text = farbe('--grey-text', '#8a9199')
    const raster = 'rgba(255,255,255,0.04)'

    const c = createChart(huelle.value, {
        autoSize: true,
        layout: {
            background: { color: 'transparent' },
            textColor: text,
            fontSize: 11,
            // Das Logo verlangt die Lizenz der Bibliothek (Apache-2.0 mit
            // Namensnennung) — es bleibt an.
            attributionLogo: true,
            panes: { separatorColor: 'rgba(255,255,255,0.08)', enableResize: true },
        },
        grid: { vertLines: { color: raster }, horzLines: { color: raster } },
        crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: { color: 'rgba(255,255,255,0.25)', style: LineStyle.Dashed, labelBackgroundColor: '#2a2e39' },
            horzLine: { color: 'rgba(255,255,255,0.25)', style: LineStyle.Dashed, labelBackgroundColor: '#2a2e39' },
        },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
        timeScale: {
            borderColor: 'rgba(255,255,255,0.08)',
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 8,
            tickMarkFormatter: (zeit, art) => {
                const d = dayjs.unix(zeit)
                // 0 Jahr, 1 Monat, 2 Tag, 3 Uhrzeit, 4 Uhrzeit mit Sekunden.
                // Monatsnamen über Intl in der App-Sprache — dayjs steht global
                // auf Englisch und schrieb „Oct".
                if (art === 0) return d.format('YYYY')
                if (art === 1) return d.toDate().toLocaleString(locale.value, { month: 'short' })
                if (art === 2) return d.format('DD.')
                return d.format('HH:mm')
            },
        },
        localization: { locale: 'de-CH', timeFormatter: zeitText },
    })

    const ks = c.addSeries(CandlestickSeries, {
        upColor: gruen, downColor: rot, borderUpColor: gruen, borderDownColor: rot,
        wickUpColor: gruen, wickDownColor: rot,
        priceLineStyle: LineStyle.Dotted,
    })
    const vs = c.addSeries(HistogramSeries, {
        priceScaleId: 'vol',
        priceFormat: { type: 'volume' },
        lastValueVisible: false,
        priceLineVisible: false,
    })
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    c.subscribeCrosshairMove((p) => {
        const bar = p?.time != null ? p.seriesData?.get(ks) : null
        legende.value = bar ? { ...bar, t: vonLwc(p.time) } : letzteLegende()
        kreuzZeit = p?.time != null ? vonLwc(p.time) : null
        if (zeichner) indikatorWerte.value = zeichner.werteBei(kreuzZeit)
        if (extern) return
        if (p?.time == null || !p.point) { emit('kreuz', null); return }
        emit('kreuz', { t: vonLwc(p.time), preis: ks.coordinateToPrice(p.point.y) })
    })
    c.timeScale().subscribeVisibleLogicalRangeChange((bereich) => {
        if (!bereich) return
        emit('bereich', bereich)
        if (bereich.from < 30) ladeAeltere()
    })

    chart.value = c
    kerzenSerie.value = ks
    volumenSerie.value = vs
    zeichner = new IndikatorZeichner(c, zuLwc)
    wendeSkalaAn()
}

function letzteLegende() {
    const k = kerzen.value[kerzen.value.length - 1]
    return k ? { t: k.t, open: k.o, high: k.h, low: k.l, close: k.c } : null
}

function volumenBalken(k) {
    return { time: zuLwc(k.t), value: k.v, color: k.c >= k.o ? 'rgba(38,166,154,0.35)' : 'rgba(255,105,96,0.35)' }
}

function setzeDaten(liste) {
    kerzen.value = liste
    kerzenSerie.value?.setData(liste.map((k) => ({ time: zuLwc(k.t), open: k.o, high: k.h, low: k.l, close: k.c })))
    volumenSerie.value?.setData(liste.map(volumenBalken))
    legende.value = letzteLegende()
    zeichner?.setze(props.panel.indikatoren, liste)
    if (zeichner) indikatorWerte.value = zeichner.werteBei(kreuzZeit)
    emit('kerzen', liste)
}

/*
 * Indikatoren bei der laufenden Kerze höchstens viermal je Sekunde
 * nachrechnen — der Kline-Stream schickt bei lebhaftem Markt deutlich mehr,
 * und für das Auge ändert sich unterhalb davon nichts.
 */
function planeNachfuehren() {
    if (nachfuehrUhr) return
    nachfuehrUhr = setTimeout(() => {
        nachfuehrUhr = null
        zeichner?.nachfuehren(kerzen.value)
        if (zeichner) indikatorWerte.value = zeichner.werteBei(kreuzZeit)
    }, 250)
}

async function wendePreisformatAn() {
    // Nachkommastellen aus der tickSize — ohne das zeigt PEPE „0.00".
    const meta = await loadSymbolMeta(props.panel.markt === 'spot' ? 'spot' : 'futures')
    const tick = Number(meta.find((s) => s.symbol === props.panel.symbol)?.tickSize)
    let stellen = 2
    if (tick > 0) stellen = Math.max(0, Math.min(10, Math.round(-Math.log10(tick))))
    else {
        const c = kerzen.value[kerzen.value.length - 1]?.c
        if (c) stellen = c >= 1000 ? 2 : c >= 1 ? 4 : Math.min(10, 2 - Math.floor(Math.log10(c)) + 2)
    }
    preisStellen.value = stellen
    kerzenSerie.value?.applyOptions({ priceFormat: { type: 'price', precision: stellen, minMove: tick > 0 ? tick : 10 ** -stellen } })
}

function wendeSkalaAn() {
    const modus = props.panel.skala === 'log' ? PriceScaleMode.Logarithmic
        : props.panel.skala === 'prozent' ? PriceScaleMode.Percentage
            : PriceScaleMode.Normal
    chart.value?.priceScale('right').applyOptions({ mode: modus })
}

async function ladeNeu() {
    const nr = ++ladeNummer
    live?.stop()
    live = null
    historieZuEnde = false
    fehler.value = ''
    laedt.value = true
    const { symbol, markt, interval } = props.panel
    try {
        const liste = await ladeKerzen({ symbol, markt, interval, limit: 1000 })
        if (nr !== ladeNummer) return
        setzeDaten(liste)
        if (liste.length < 1000) historieZuEnde = true
        // Die jüngsten ~150 Kerzen zeigen, nicht alle tausend gequetscht.
        const n = liste.length
        if (n) chart.value?.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 150), to: n + 8 })
        wendePreisformatAn()
        starteLive(nr)
    } catch (e) {
        if (nr !== ladeNummer) return
        setzeDaten([])
        fehler.value = e.response?.data?.error || e.message
    } finally {
        if (nr === ladeNummer) laedt.value = false
    }
}

async function ladeAeltere() {
    if (nachladenLaeuft || historieZuEnde || laedt.value || !kerzen.value.length) return
    nachladenLaeuft = true
    const nr = ladeNummer
    const { symbol, markt, interval } = props.panel
    try {
        const aeltere = await ladeKerzen({ symbol, markt, interval, endTime: kerzen.value[0].t - 1, limit: 1000 })
        if (nr !== ladeNummer) return
        if (aeltere.length < 1000) historieZuEnde = true
        if (!aeltere.length) return
        const ts = chart.value.timeScale()
        const vorher = ts.getVisibleLogicalRange()
        const zusammen = fuegeZusammen(aeltere, kerzen.value)
        const neu = zusammen.length - kerzen.value.length
        setzeDaten(zusammen)
        // Ansicht festhalten: die vorne eingefügten Kerzen verschieben jeden
        // logischen Index um `neu` — ohne Ausgleich spränge das Bild.
        if (vorher && neu > 0) ts.setVisibleLogicalRange({ from: vorher.from + neu, to: vorher.to + neu })
    } catch {
        // Nachladen ist Komfort; ein Fehler hier lässt das Bild stehen.
    } finally {
        nachladenLaeuft = false
    }
}

function starteLive(nr) {
    const { symbol, markt, interval } = props.panel
    live = new LiveKerze({
        symbol, markt, interval,
        onStatus: (s) => { if (nr === ladeNummer) status.value = s },
        onKerze: (k) => {
            if (nr !== ladeNummer) return
            const liste = kerzen.value
            const letzte = liste[liste.length - 1]
            if (letzte && k.t < letzte.t) return
            const bar = { t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }
            if (letzte && k.t === letzte.t) liste[liste.length - 1] = bar
            else liste.push(bar)
            kerzenSerie.value?.update({ time: zuLwc(bar.t), open: bar.o, high: bar.h, low: bar.l, close: bar.c })
            volumenSerie.value?.update(volumenBalken(bar))
            if (!extern) legende.value = letzteLegende()
            planeNachfuehren()
            emit('kerzen', liste)
        },
        onLuecke: async () => {
            // Nach einem Abriss die letzten Kerzen neu holen, sonst bliebe
            // genau die Zeit ohne Verbindung als Loch stehen.
            try {
                const frisch = await ladeKerzen({ symbol, markt, interval, limit: 500 })
                if (nr !== ladeNummer) return
                const ts = chart.value.timeScale()
                const vorher = ts.getVisibleLogicalRange()
                setzeDaten(fuegeZusammen(kerzen.value, frisch))
                if (vorher) ts.setVisibleLogicalRange(vorher)
            } catch { /* nächster Versuch beim nächsten Abriss */ }
        },
    })
}

/** Kerze zu einer Zeit (ms) — die letzte, die nicht danach beginnt. */
function kerzeBei(ms) {
    const liste = kerzen.value
    let lo = 0, hi = liste.length - 1, treffer = -1
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (liste[mid].t <= ms) { treffer = mid; lo = mid + 1 } else hi = mid - 1
    }
    return treffer >= 0 ? liste[treffer] : null
}

/** Fadenkreuz von einem anderen Panel übernehmen. */
function setzeKreuz(info) {
    const c = chart.value
    if (!c) return
    extern = true
    try {
        if (!info) { c.clearCrosshairPosition(); legende.value = letzteLegende(); return }
        const k = kerzeBei(info.t)
        if (!k) { c.clearCrosshairPosition(); return }
        c.setCrosshairPosition(k.c, zuLwc(k.t), kerzenSerie.value)
        legende.value = { t: k.t, open: k.o, high: k.h, low: k.l, close: k.c }
    } finally {
        extern = false
    }
}

/** Sichtbaren Zeitraum (ms) von aussen setzen — Zeit-Synchronisation. */
function setzeZeitraum(von, bis) {
    const ts = chart.value?.timeScale()
    if (!ts || !kerzen.value.length) return
    try { ts.setVisibleRange({ from: zuLwc(von), to: zuLwc(bis) }) } catch { /* ausserhalb der Daten */ }
}

function sichtbarerZeitraum() {
    const r = chart.value?.timeScale().getVisibleRange()
    return r ? { von: vonLwc(r.from), bis: vonLwc(r.to) } : null
}

function zurJetztzeit() {
    chart.value?.timeScale().scrollToRealTime()
}

function bildschirmfoto() {
    return chart.value?.takeScreenshot(true)
}

const fmt = (x) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(preisStellen.value))
const legendeDelta = computed(() => {
    const l = legende.value
    if (!l || !l.open) return null
    return ((l.close - l.open) / l.open) * 100
})

watch(() => [props.panel.symbol, props.panel.markt, props.panel.interval], ladeNeu)
watch(() => props.panel.skala, wendeSkalaAn)
watch(() => props.panel.indikatoren, (inst) => {
    zeichner?.setze(inst, kerzen.value)
    if (zeichner) indikatorWerte.value = zeichner.werteBei(kreuzZeit)
}, { deep: true })

function wertText(w) {
    if (w == null || !Number.isFinite(w)) return '—'
    const a = Math.abs(w)
    if (a >= 1e9) return (w / 1e9).toFixed(2) + 'B'
    if (a >= 1e6) return (w / 1e6).toFixed(2) + 'M'
    if (a >= 1e4) return (w / 1e3).toFixed(1) + 'K'
    return w.toFixed(a >= 100 ? 2 : a >= 1 ? Math.max(2, preisStellen.value > 4 ? 4 : preisStellen.value) : Math.min(8, preisStellen.value + 2))
}

onMounted(() => {
    baueChart()
    ladeNeu()
})
onBeforeUnmount(() => {
    ladeNummer++
    clearTimeout(nachfuehrUhr)
    zeichner?.abbauen()
    zeichner = null
    live?.stop()
    chart.value?.remove()
    chart.value = null
})

defineExpose({
    chart, kerzenSerie, kerzen, zuLwc, vonLwc, kerzeBei,
    setzeKreuz, setzeZeitraum, sichtbarerZeitraum, zurJetztzeit, bildschirmfoto, ladeNeu,
})
</script>

<template>
    <div class="chartPanel" :class="{ aktiv }" @mousedown="emit('fokus')" @touchstart.passive="emit('fokus')">
        <div ref="huelle" class="flaeche"></div>

        <div class="legende">
            <span class="sym">{{ panel.symbol }}</span>
            <span class="tf">{{ panel.interval }}</span>
            <span class="markt">{{ panel.markt === 'spot' ? 'Spot' : 'Perp' }}</span>
            <span class="punkt" :class="status" :title="t('chart.status.' + (status || 'connecting'))"></span>
            <template v-if="legende">
                <span>O <b>{{ fmt(legende.open) }}</b></span>
                <span>H <b>{{ fmt(legende.high) }}</b></span>
                <span>L <b>{{ fmt(legende.low) }}</b></span>
                <span>C <b>{{ fmt(legende.close) }}</b></span>
                <span v-if="legendeDelta != null" :class="legendeDelta >= 0 ? 'greenTrade' : 'redTrade'">
                    {{ legendeDelta >= 0 ? '+' : '' }}{{ legendeDelta.toFixed(2) }} %
                </span>
            </template>
            <div v-for="ind in (panel.indikatoren || [])" :key="ind.id" class="indZeile" :class="{ aus: ind.sichtbar === false }">
                <span class="indName">{{ kurzname(ind.typ, ind.params, t('chart.ind.' + ind.typ + '.kurz')) }}</span>
                <span v-for="w in (indikatorWerte[ind.id] || [])" :key="w.key" :style="{ color: w.farbe }">{{ wertText(w.wert) }}</span>
                <span class="indKnoepfe">
                    <button :title="t(ind.sichtbar === false ? 'chart.einblenden' : 'chart.ausblenden')"
                        @click.stop="emit('indikator', { aktion: 'umschalten', id: ind.id })">
                        <i :class="ind.sichtbar === false ? 'uil uil-eye-slash' : 'uil uil-eye'"></i></button>
                    <button :title="t('chart.einstellungen')" @click.stop="emit('indikator', { aktion: 'bearbeiten', id: ind.id })"><i
                            class="uil uil-setting"></i></button>
                    <button :title="t('chart.entfernen')" @click.stop="emit('indikator', { aktion: 'entfernen', id: ind.id })"><i
                            class="uil uil-times"></i></button>
                </span>
            </div>
        </div>

        <div v-if="laedt" class="hinweis"><span class="spinner-border spinner-border-sm"></span></div>
        <div v-else-if="fehler" class="hinweis fehler">
            {{ t('chart.ladeFehler') }}: {{ fehler }}
            <button class="btn btn-sm btn-outline-secondary ms-2" @click="ladeNeu">{{ t('chart.erneut') }}</button>
        </div>
        <slot />
    </div>
</template>

<style scoped>
.chartPanel {
    position: relative;
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--white-10);
    border-radius: 6px;
    overflow: hidden;
    background: var(--black-bg-7, #131722);
}

.chartPanel.aktiv {
    border-color: rgba(1, 180, 255, 0.45);
}

.flaeche {
    position: absolute;
    inset: 0;
}

.legende {
    position: absolute;
    top: 6px;
    left: 8px;
    z-index: 3;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    align-items: center;
    font-size: 11px;
    color: var(--grey-text);
    pointer-events: none;
    max-width: calc(100% - 80px);
}

.legende b {
    color: var(--white-87, #ddd);
    font-weight: 500;
}

.indZeile {
    flex-basis: 100%;
    display: flex;
    gap: 8px;
    align-items: center;
    pointer-events: auto;
    width: fit-content;
    padding: 0 4px;
    border-radius: 3px;
}

.indZeile:hover {
    background: rgba(0, 0, 0, 0.45);
}

.indZeile.aus {
    opacity: 0.45;
}

.indName {
    color: var(--white-87, #ddd);
}

.indKnoepfe {
    display: none;
    gap: 2px;
}

.indZeile:hover .indKnoepfe {
    display: inline-flex;
}

.indKnoepfe button {
    background: transparent;
    border: none;
    color: var(--grey-text);
    padding: 0 3px;
    font-size: 12px;
}

.indKnoepfe button:hover {
    color: var(--white-87, #eee);
}

.legende .sym {
    color: var(--white-87, #eee);
    font-weight: 600;
    font-size: 12px;
}

.legende .tf,
.legende .markt {
    color: var(--grey-text);
}

.punkt {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--grey-color);
}

.punkt.open {
    background: var(--green);
}

.punkt.closed {
    background: var(--red-color);
}

.hinweis {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 4;
    pointer-events: none;
    color: var(--grey-text);
    font-size: 12px;
}

.hinweis.fehler {
    pointer-events: auto;
    background: rgba(0, 0, 0, 0.35);
}
</style>
