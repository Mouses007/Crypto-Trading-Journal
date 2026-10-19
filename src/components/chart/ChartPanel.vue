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
    createChart, CandlestickSeries, HistogramSeries, CrosshairMode, PriceScaleMode, LineStyle, ColorType,
    createTextWatermark,
} from 'lightweight-charts'
import { ladeKerzen, LiveKerze, RestKerze, fuegeZusammen, INTERVALL_MS, istRestQuelle, QUELLEN_MAX } from '../../utils/chart/kerzenQuelle.js'
import { loadSymbolMeta } from '../../utils/liveSymbols.js'
import { IndikatorZeichner } from '../../utils/chart/indikatorZeichner.js'
import { kurzname } from '../../utils/chart/indikatorRegister.js'
import { ZeichenEbene } from '../../utils/chart/zeichnungen/ZeichenEbene.js'
import { zeichnungenVon, legeAn, aendere, loesche } from '../../stores/chartZeichnungen.js'
import ZeichnungStil from './ZeichnungStil.vue'
import { kiVorschau } from '../../utils/chart/kiZeichnungen.js'
import TradeKarte from './TradeKarte.vue'
import axios from 'axios'
import { JournalEbene } from '../../utils/chart/overlays/JournalEbene.js'
import { StrategieEbene } from '../../utils/chart/overlays/StrategieEbene.js'
import { MarktEbene, waendeAusBuch } from '../../utils/chart/overlays/MarktEbene.js'
import { benoetigteQuellen, vwapVectorQuellen, INTRA_BUDGET, saubereParams, INDIKATOREN, strategieParams } from '../../utils/chart/indikatorRegister.js'
import { ladeOffenePositionen } from '../../utils/chart/overlays/positionen.js'
import { positionenAus } from '../../stores/chartPositionen.js'
import { letzterStil, merkeStil } from '../../stores/zeichenStil.js'
import { overlayAn as overlayAnFuer } from '../../utils/chart/overlays/liste.js'

const props = defineProps({
    panel: { type: Object, required: true },     // { symbol, markt, interval, skala }
    aktiv: { type: Boolean, default: false },
    nummer: { type: Number, default: 0 },
    werkzeug: { type: String, default: null },      // nur im aktiven Panel gesetzt
    magnet: { type: Boolean, default: false },
    zeichnungenVersteckt: { type: Boolean, default: false },
    alarmLinien: { type: Array, default: () => [] },  // aktive Preis-Alarme dieses Symbols
})
const emit = defineEmits(['fokus', 'kreuz', 'bereich', 'kerzen', 'indikator', 'werkzeugFertig', 'alarmAufZeichnung', 'alarmBeiPreis', 'alleLoeschen', 'panel'])
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
let wasserzeichen = null

/** Symbol und Zeiteinheit blass im Hintergrund — wer vier Charts offen hat, sieht sofort, welcher welcher ist. */
function wasserzeichenOptionen(schrift) {
    return {
        horzAlign: 'center', vertAlign: 'center',
        lines: [
            { text: props.panel.symbol, color: 'rgba(1,180,255,0.07)', fontSize: 56, fontFamily: schrift, fontStyle: 'bold' },
            { text: `${props.panel.interval} · ${props.panel.markt === 'spot' ? 'Spot' : 'Perp'}`, color: 'rgba(1,180,255,0.06)', fontSize: 20, fontFamily: schrift, fontStyle: '' },
        ],
    }
}
let ebene = null
const auswahlId = ref(null)
let journalEbene = null
const gewaehlterTrade = ref(null)
const journalInfo = ref(null)          // { anzahl, gekappt } für die Legende
let journalUhr = null
let journalTakt = null
let positionsTakt = null
let positionsLinien = []               // [{ linie, art, pos }]
let positionen = []
let strategieEbene = null
const strategieDaten = shallowRef(null)  // Antwort von /api/chart/strategie (für die Seitenleiste)
const strategieVorschau = shallowRef(null)
const strategieBacktest = shallowRef(null)
let marktEbene = null
let marktTakt = null
let marktZaehler = 0
const marktHinweise = ref({})          // liquidationen/hebelzonen/momentum → Text für die Legende
const MOMENTUM_TF = ['5m', '15m', '1h', '4h']
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
    const blau = farbe('--blue-color', '#01B4FF')
    const schrift = getComputedStyle(document.body).fontFamily || "'Nunito Sans', sans-serif"

    /*
     * Eigener Look im Stil des Journals statt der Vorgaben der Bibliothek:
     * App-Schrift, leichter Verlauf im Hintergrund, nur waagerechtes Raster,
     * Fadenkreuz und Kursmarke im Journal-Blau.
     *
     * TradingView-Logo bleibt an: die Lizenz (Apache-2.0 + NOTICE) verlangt
     * den Hinweis auf TradingView mit Link für die Nutzer. Der Link in der
     * Seitenleiste (`Chart.vue`) allein reichte nicht — die Leiste lässt
     * sich zuklappen, dann war der Hinweis weg.
     */
    const c = createChart(huelle.value, {
        autoSize: true,
        layout: {
            background: { type: ColorType.VerticalGradient, topColor: '#101826', bottomColor: '#0a0e16' },
            textColor: text,
            fontSize: 11,
            fontFamily: schrift,
            attributionLogo: true,
            panes: { separatorColor: 'rgba(1,180,255,0.12)', separatorHoverColor: 'rgba(1,180,255,0.25)', enableResize: true },
        },
        grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(1,180,255,0.05)' } },
        crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: { color: 'rgba(1,180,255,0.45)', width: 1, style: LineStyle.LargeDashed, labelBackgroundColor: blau },
            horzLine: { color: 'rgba(1,180,255,0.45)', width: 1, style: LineStyle.LargeDashed, labelBackgroundColor: blau },
        },
        rightPriceScale: { borderVisible: false },
        timeScale: {
            borderVisible: false,
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
        // Steigende Kerzen hohl mit farbigem Rand, fallende gefüllt — so liest
        // sich der Chart auch ohne Farbsinn und sieht nicht aus wie die Vorgabe.
        upColor: 'rgba(38,166,154,0.12)', downColor: rot, borderUpColor: gruen, borderDownColor: rot,
        wickUpColor: gruen, wickDownColor: rot,
        priceLineColor: blau, priceLineStyle: LineStyle.Dotted,
    })
    wasserzeichen = createTextWatermark(c.panes()[0], wasserzeichenOptionen(schrift))
    const vs = c.addSeries(HistogramSeries, {
        priceScaleId: 'vol',
        priceFormat: { type: 'volume' },
        lastValueVisible: false,
        priceLineVisible: false,
    })
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    vs.applyOptions({ visible: volumenAn.value })

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
    zeichner = new IndikatorZeichner(c, zuLwc, (ind) => kurzname(ind.typ, ind.params, t('chart.ind.' + ind.typ + '.name')),
        { kerzenSerie: ks, faerbeKerzen })
    ebene = new ZeichenEbene({
        huelle: huelle.value,
        chart: c,
        serie: ks,
        formatPreis: (p) => ks.priceFormatter().format(p),
        rueckruf: {
            neu: zeichnungNeu,
            aendern: (id, patch) => aendere(props.panel.symbol, id, patch),
            auswahl: (id) => { auswahlId.value = id },
            werkzeugFertig: () => emit('werkzeugFertig'),
            textBearbeiten: textBearbeiten,
        },
    })
    marktEbene = new MarktEbene({
        chart: c, serie: ks,
        texte: { kauf: t('chart.markt.kaufwand'), verkauf: t('chart.markt.verkaufswand'), liqLong: t('chart.markt.liqLong'), liqShort: t('chart.markt.liqShort') },
    })
    strategieEbene = new StrategieEbene({ chart: c, serie: ks, formatPreis: (p) => ks.priceFormatter().format(p) })
    journalEbene = new JournalEbene({ chart: c, serie: ks, formatPreis: (p) => ks.priceFormatter().format(p) })
    c.subscribeClick((p) => {
        if (!p?.point || props.werkzeug) return
        const tr = journalEbene?.trefferTest(p.point.x, p.point.y) || null
        gewaehlterTrade.value = tr
        journalEbene?.hebeHervor(tr?.id ?? null)
    })
    ebene.setzeWerkzeug(props.werkzeug)
    ebene.setzeMagnet(props.magnet)
    ebene.setzeZeichnungen(sichtbareZeichnungen.value)
    wendeSkalaAn()
}

function letzteLegende() {
    const k = kerzen.value[kerzen.value.length - 1]
    return k ? { t: k.t, open: k.o, high: k.h, low: k.l, close: k.c } : null
}

function volumenBalken(k) {
    return { time: zuLwc(k.t), value: k.v, color: k.c >= k.o ? 'rgba(38,166,154,0.28)' : 'rgba(255,105,96,0.28)' }
}

/** Volumenbalken unter den Kerzen — je Panel im Layout, fehlt der Eintrag: an. */
const volumenAn = computed(() => props.panel.volumen !== false)
watch(volumenAn, (an) => volumenSerie.value?.applyOptions({ visible: an }))

/*
 * Vektorkerzen (VWAP Vector): Farbe je Kerze für Körper, Rand und Docht —
 * wie `barcolor` in der Vorlage. `null` = zurück zu den normalen Farben.
 */
let kerzenFarben = null
function kerzenPunkt(k, i) {
    const f = kerzenFarben?.[i]
    const p = { time: zuLwc(k.t), open: k.o, high: k.h, low: k.l, close: k.c }
    return f ? { ...p, color: f, borderColor: f, wickColor: f } : p
}
function faerbeKerzen(farben, nurLetzte) {
    kerzenFarben = farben
    const liste = kerzen.value
    if (!kerzenSerie.value || !liste.length) return
    if (nurLetzte && farben) kerzenSerie.value.update(kerzenPunkt(liste[liste.length - 1], liste.length - 1))
    else kerzenSerie.value.setData(liste.map(kerzenPunkt))
}

function setzeDaten(liste) {
    kerzen.value = liste
    kerzenSerie.value?.setData(liste.map(kerzenPunkt))
    volumenSerie.value?.setData(liste.map(volumenBalken))
    legende.value = letzteLegende()
    zeichner?.setze(props.panel.indikatoren, liste)
    if (zeichner) indikatorWerte.value = zeichner.werteBei(kreuzZeit)
    ebene?.setzeKerzen(liste, INTERVALL_MS[props.panel.interval])
    journalEbene?.setzeKerzen(liste, INTERVALL_MS[props.panel.interval])
    strategieEbene?.setzeKerzen(liste, INTERVALL_MS[props.panel.interval])
    marktEbene?.setzeKerzen(liste, INTERVALL_MS[props.panel.interval])
    planeJournal()
    emit('kerzen', liste)
}

// ── Eigene Marktdaten und Datenfenster ───────────────────────────────────
function hinweis(name, text) {
    marktHinweise.value = { ...marktHinweise.value, [name]: text }
}

async function ladeLiquidationen() {
    if (!marktEbene) return
    if (!overlayAn('liquidationen') || props.panel.markt === 'spot' || !kerzen.value.length) {
        marktEbene.setzeLiquidationen([]); hinweis('liquidationen', null); return
    }
    const symbol = props.panel.symbol
    // Höchstens eine Woche: der Rekorder hält eine Stichprobe je Sekunde, und
    // auf einem Wochenchart über Jahre gäbe es ohnehin nur die letzten Tage.
    const von = Math.max(kerzen.value[0].t, Date.now() - 7 * 86_400_000)
    try {
        const { data } = await axios.get('/api/live/liquidations', { params: { symbol, from: von, to: Date.now(), venue: 'binance' } })
        if (symbol !== props.panel.symbol) return
        marktEbene.setzeLiquidationen(data.events)
        hinweis('liquidationen', data.events.length ? t('chart.markt.liqAnzahl', { n: data.events.length }) : t('chart.markt.liqKeine'))
    } catch { hinweis('liquidationen', t('chart.markt.liqKeine')) }
}

async function ladeHebelzonen() {
    if (!marktEbene) return
    if (!overlayAn('hebelzonen') || props.panel.markt === 'spot') { marktEbene.setzeZonen(null); hinweis('hebelzonen', null); return }
    const symbol = props.panel.symbol
    try {
        const { data } = await axios.get('/api/chart/hebelzonen', { params: { symbol } })
        if (symbol !== props.panel.symbol) return
        marktEbene.setzeZonen(data.zonen)
        hinweis('hebelzonen', data.zonen ? t(data.zonen.duenn ? 'chart.markt.hebelDuenn' : 'chart.markt.hebelModell') : t('chart.markt.hebelKeine'))
    } catch { marktEbene.setzeZonen(null); hinweis('hebelzonen', t('chart.markt.hebelKeine')) }
}

/*
 * Durchschnittlicher Umsatz je Minute (24h-Umsatz / 1440) — der absolute
 * Massstab für Wände. 10 Minuten gemerkt; fehlt er, gilt nur der relative.
 */
const umsatzCache = new Map()
async function umsatzJeMinute(symbol, markt) {
    const k = `${markt}|${symbol}`
    const c = umsatzCache.get(k)
    if (c && Date.now() - c.zeit < 600_000) return c.wert
    try {
        const { data } = await axios.get('/api/chart/ticker', { params: { markt, symbole: symbol } })
        const q = Number(data.kurse?.[symbol]?.q)
        const wert = q > 0 ? q / 1440 : null
        umsatzCache.set(k, { zeit: Date.now(), wert })
        return wert
    } catch { return null }
}

async function ladeWaende() {
    if (!marktEbene) return
    if (!overlayAn('orderbuch')) { marktEbene.setzeWaende(null); hinweis('orderbuch', null); return }
    const { symbol, markt } = props.panel
    try {
        // limit 500 statt 1000: halbes Gewicht, und Wände jenseits von ±5 %
        // zeigt der Chart ohnehin nicht.
        const m = markt === 'spot' ? 'spot' : 'futures'
        const [{ data }, proMin] = await Promise.all([
            axios.get('/api/chart/tiefe', { params: { symbol, markt: m } }),
            umsatzJeMinute(symbol, m),
        ])
        if (symbol !== props.panel.symbol) return
        const w = waendeAusBuch(data, { umsatzJeMinute: proMin })
        marktEbene.setzeWaende(w)
        // Wie weit der Snapshot reicht — bei BTC nur ±0,07 %, dahinter kann er keine Wand zeigen.
        if (w.spanne) hinweis('orderbuch', t(w.kaeufe.length || w.verkaeufe.length ? 'chart.markt.buchReicht' : 'chart.markt.buchKeineWand',
            { p: Math.min(w.spanne.unten, w.spanne.oben).toFixed(w.spanne.unten < 1 ? 2 : 1) }))
    } catch { marktEbene.setzeWaende(null); hinweis('orderbuch', null) }
}

/*
 * Schlägt ein Abruf fehl (Server-Neustart, Netz), blieb das Datenfenster bis zum
 * nächsten regulären Takt leer — bei OI fünf, bei Funding zehn Minuten, mit
 * dem Wert der letzten Kerze in der Legende, aber ohne Linie. Jetzt: nach 20 s
 * erneut, höchstens dreimal hintereinander.
 */
const externNochmal = new Map()   // quelle → { uhr, versuche }
function externSpaeter(quelle) {
    const alt = externNochmal.get(quelle) || { versuche: 0 }
    if (alt.versuche >= 3) return
    clearTimeout(alt.uhr)
    externNochmal.set(quelle, { versuche: alt.versuche + 1, uhr: setTimeout(() => ladeExtern([quelle]), 20_000) })
}
function externGeladen(quelle) {
    const alt = externNochmal.get(quelle)
    if (alt) { clearTimeout(alt.uhr); externNochmal.delete(quelle) }
}

async function ladeExtern(nurWelche = null) {
    if (!zeichner) return
    const { symbol, interval } = props.panel
    for (const quelle of benoetigteQuellen(props.panel.indikatoren)) {
        if (nurWelche && !nurWelche.includes(quelle)) continue
        try {
            if (quelle === 'oi') {
                // 500 Stunden = das, was Binance je Abruf gibt; vorher 200 — das OI-Fenster begann in der Bildmitte
                const { data } = await axios.get('/api/marktradar/ls-oi', { params: { symbol, stunden: 500 } })
                if (symbol === props.panel.symbol) zeichner.setzeExtern('oi', data.punkte || [])
            } else if (quelle === 'funding') {
                const { data } = await axios.get('/api/chart/funding', { params: { symbol } })
                if (symbol === props.panel.symbol) zeichner.setzeExtern('funding', data.punkte || [])
            } else if (quelle.startsWith('signale_')) {
                // Strategie-Signale (LSOB, GUSS) — nur Binance und nur auf den Zeiteinheiten der Strategie
                const strategie = quelle.slice('signale_'.length)
                const inst = (props.panel.indikatoren || []).find((i) => i.sichtbar !== false && INDIKATOREN[i.typ]?.extern === quelle)
                const sp = inst ? strategieParams(inst.typ, inst.params) : {}
                try {
                    const { data } = await axios.get('/api/chart/signale', { params: { strategie, symbol, interval, markt: props.panel.markt, params: JSON.stringify(sp) } })
                    if (symbol === props.panel.symbol && interval === props.panel.interval) { zeichner.setzeExtern(quelle, data); hinweis(quelle, null) }
                } catch (e) {
                    if (e.response?.status !== 400) throw e
                    zeichner.setzeExtern(quelle, null)
                    hinweis(quelle, e.response.data?.error || null)
                }
            } else if (quelle === 'vwapVector') {
                await ladeVwapVector()
            } else if (quelle === 'momentum') {
                if (!MOMENTUM_TF.includes(interval)) {
                    zeichner.setzeExtern('momentum', null)
                    hinweis('momentum', t('chart.markt.momentumTf'))
                    continue
                }
                // lang=1: ganzer Verlauf statt der letzten 150 Kerzen (die der Kachel genügen)
                const { data } = await axios.get('/api/livetrading/momentum', { params: { symbol, tf: interval, lang: 1 } })
                if (symbol === props.panel.symbol && interval === props.panel.interval) {
                    zeichner.setzeExtern('momentum', data.verlauf || null)
                    hinweis('momentum', null)
                }
            }
            externGeladen(quelle)
        } catch { externSpaeter(quelle) }
    }
    if (zeichner) indikatorWerte.value = zeichner.werteBei(kreuzZeit)
}

/*
 * VWAP Vector: Kerzen höherer Zeiteinheiten (MTF-EMA, Fibonacci) und
 * Intrabar-Kerzen (Candle-POC). Immer von Binance — Bitunix/Bitget liefern
 * zu wenig Historie für eine EMA 50 auf dem Tag. Intrabar höchstens
 * INTRA_BUDGET Kerzen (Seiten à 1500); ältere Chartkerzen bekommen keinen
 * Candle-POC. „auto" wählt die Auflösung so, dass das Budget reicht.
 */
const vvCache = { schluessel: '', htf: {}, intra: [] }
async function ladeVwapVector() {
    const { symbol, markt, interval } = props.panel
    const ivMs = INTERVALL_MS[interval]
    const instanzen = (props.panel.indikatoren || []).filter((i) => i.typ === 'vwapVector' && i.sichtbar !== false)
    const htf = new Set()
    let intra = null
    for (const i of instanzen) {
        const q = vwapVectorQuellen(saubereParams('vwapVector', i.params), ivMs, INTERVALL_MS, kerzen.value.length)
        q.htf.forEach((tf) => htf.add(tf))
        if (q.intra && (!intra || INTERVALL_MS[q.intra] < INTERVALL_MS[intra])) intra = q.intra
    }
    const schluessel = `${symbol}|${markt}|${interval}|${intra}`
    if (vvCache.schluessel !== schluessel) { vvCache.schluessel = schluessel; vvCache.htf = {}; vvCache.intra = [] }
    // Nur schreiben, solange der Speicher noch zu DIESEM Abruf gehört — ein späte
    // Antwort für das alte Symbol mischte sonst dessen Kerzen in den neuen Bestand.
    const nochMeins = () => vvCache.schluessel === schluessel
    const m = markt === 'spot' ? 'spot' : 'futures'
    await Promise.all([...htf].map(async (tf) => {
        try {
            const k = await ladeKerzen({ symbol, markt: m, interval: tf, limit: 1000 })
            if (nochMeins()) vvCache.htf[tf] = k
        } catch { /* Modul bleibt leer */ }
    }))
    if (intra) {
        try {
            if (!vvCache.intra.length) {
                // Nur so weit zurück, wie Chartkerzen da sind.
                let liste = await ladeKerzen({ symbol, markt: m, interval: intra, limit: 1500 })
                const ab = kerzen.value[0]?.t ?? 0
                for (let s = 1; s * 1500 < INTRA_BUDGET && liste.length && liste[0].t > ab; s++) {
                    const alt = await ladeKerzen({ symbol, markt: m, interval: intra, limit: 1500, endTime: liste[0].t - 1 })
                    if (!alt.length) break
                    liste = fuegeZusammen(alt, liste)
                }
                if (nochMeins()) vvCache.intra = liste
            } else {
                const neu = await ladeKerzen({ symbol, markt: m, interval: intra, limit: 200 })
                if (nochMeins()) vvCache.intra = fuegeZusammen(vvCache.intra, neu)
            }
        } catch { /* ohne Intrabar-Daten kein Candle-POC */ }
    }
    if (!nochMeins() || symbol !== props.panel.symbol || interval !== props.panel.interval) return
    zeichner.setzeExtern('vwapVector', { htf: { ...vvCache.htf }, intra: intra ? vvCache.intra : [], ivMs })
}

/** Ein Takt, verschiedene Abstände: Wände 10 s, Liquidationen 30 s, Momentum 60 s, Hebel 2 min, OI 5 min, Funding 10 min. */
function marktTick() {
    // Im Hintergrund-Tab nichts holen — vier Panels fragten dort weiter alle 10 s Orderbuch,
    // Liquidationen und Momentum ab, für ein Bild, das niemand sieht. Beim Zurückkommen
    // holt `sichtbarkeitGeaendert` alles einmal frisch.
    if (document.hidden) return
    const n = marktZaehler++
    ladeWaende()
    if (n % 3 === 0) ladeLiquidationen()
    if (n % 6 === 0) ladeExtern(['momentum', 'vwapVector', 'signale_lsob', 'signale_ema_touch'])
    if (n % 12 === 0) ladeHebelzonen()
    if (n % 30 === 0) ladeExtern(['oi'])
    if (n % 60 === 0) ladeExtern(['funding'])
}

function marktNeu() {
    marktZaehler = 0
    marktHinweise.value = {}
    clearInterval(marktTakt)
    clearTimeout(marktNeuUhr)
    marktTick()
    marktTakt = setInterval(marktTick, 10_000)
}

// ── Journal und offene Positionen ────────────────────────────────────────
const overlayAn = (name) => overlayAnFuer(props.panel, name)

/** Journal und Strategie für den geladenen Zeitraum holen — entprellt, weil Nachladen und Live-Neuaufbau kurz hintereinander kommen. */
function planeJournal() {
    clearTimeout(journalUhr)
    journalUhr = setTimeout(() => { ladeJournal(); ladeStrategie() }, 300)
}

// ── Strategie-Schicht ────────────────────────────────────────────────────
function strategieGefiltert() {
    const d = strategieDaten.value
    if (!d) return { setups: [], positionen: [], trades: [] }
    const f = props.panel.strategieFilter || {}
    const verborgen = new Set(f.verborgen || [])
    const passt = (x) => !verborgen.has(x.instanceId) && (f.alleZeiteinheiten || !x.timeframe || x.timeframe === props.panel.interval)
    return { setups: d.setups.filter(passt), positionen: d.positionen.filter(passt), trades: d.trades.filter(passt) }
}

function zeigeStrategie() {
    if (!strategieEbene) return
    const namen = new Map((strategieDaten.value?.instanzen || []).map((i) => [i.id, i.strategieName]))
    strategieEbene.setzeDaten(overlayAn('strategie') ? strategieGefiltert() : null, namen)
}

async function ladeStrategie() {
    if (!strategieEbene || !kerzen.value.length) return
    if (!overlayAn('strategie')) { strategieDaten.value = null; zeigeStrategie(); return }
    const nr = ladeNummer
    try {
        const { data } = await axios.get('/api/chart/strategie', {
            params: { symbol: props.panel.symbol, von: kerzen.value[0].t, bis: Date.now() + (INTERVALL_MS[props.panel.interval] || 0) },
        })
        if (nr !== ladeNummer) return
        strategieDaten.value = data
        zeigeStrategie()
    } catch { /* Beiwerk */ }
}

function setzeStrategieVorschau(v) {
    strategieVorschau.value = v
    strategieEbene?.setzeVorschau(v)
}

function setzeBacktest(b) {
    strategieBacktest.value = b
    strategieEbene?.setzeBacktest(b)
}

watch(() => props.panel.strategieFilter, zeigeStrategie, { deep: true })

// ── Alarme ───────────────────────────────────────────────────────────────
let alarmPreisLinien = []
const kontext = ref(null)              // { x, y, preis } — Rechtsklick-Menü

function zeichneAlarmLinien() {
    const serie = kerzenSerie.value
    if (!serie) return
    for (const l of alarmPreisLinien) { try { serie.removePriceLine(l) } catch { /* weg */ } }
    alarmPreisLinien = props.alarmLinien.map((a) => serie.createPriceLine({
        price: a.bedingung.preis, color: '#ff9800', lineWidth: 1, lineStyle: LineStyle.SparseDotted,
        axisLabelVisible: true, title: '⏰',
    }))
}
watch(() => props.alarmLinien, zeichneAlarmLinien, { deep: true })

function rechtsklick(e) {
    const r = huelle.value.getBoundingClientRect()
    const y = e.clientY - r.top
    const hoehe = chart.value?.panes()[0]?.getHeight() ?? r.height
    if (y < 0 || y > hoehe) return
    const preis = kerzenSerie.value?.coordinateToPrice(y)
    if (preis == null) return
    e.preventDefault()
    // Am rechten oder unteren Rand nach innen klappen — das Panel schneidet
    // über seinen Rand hinausragende Teile ab.
    const x = Math.min(e.clientX - r.left, r.width - 190)
    const yMenue = Math.min(y, r.height - 130)
    kontext.value = { x: Math.max(4, x), y: Math.max(4, yMenue), preis }
}

function alarmHier() {
    if (kontext.value) emit('alarmBeiPreis', Number(kontext.value.preis.toFixed(preisStellen.value)))
    kontext.value = null
}

function zeichnungHier(typ) {
    if (!kontext.value) return
    const k = kerzen.value[kerzen.value.length - 1]
    if (k) zeichnungNeu({ typ, punkte: [{ t: k.t, p: kontext.value.preis }] })
    kontext.value = null
}

async function ladeJournal() {
    if (!journalEbene) return
    if (!overlayAn('journal') || !kerzen.value.length) {
        journalEbene.setzeTrades([])
        journalInfo.value = null
        return
    }
    const nr = ladeNummer
    try {
        const { data } = await axios.get('/api/chart/journal', {
            params: { symbol: props.panel.symbol, von: kerzen.value[0].t, bis: Date.now() + (INTERVALL_MS[props.panel.interval] || 0) },
        })
        if (nr !== ladeNummer) return
        journalEbene.setzeTrades(data.trades)
        journalInfo.value = { anzahl: data.trades.length, gekappt: data.gekappt }
        if (gewaehlterTrade.value) gewaehlterTrade.value = data.trades.find((x) => x.id === gewaehlterTrade.value.id) || null
    } catch {
        // Journal ist Beiwerk — ohne Antwort bleibt der Chart, wie er ist.
    }
}

function entfernePositionsLinien() {
    for (const l of positionsLinien) {
        try { kerzenSerie.value?.removePriceLine(l.linie) } catch { /* Serie schon weg */ }
    }
    positionsLinien = []
}

function positionsTitel(pos, kurs) {
    const r = pos.richtung === 'long' ? 'Long' : 'Short'
    if (!kurs || !pos.einstieg || !pos.menge) return `${r} ${pos.menge ?? ''}`
    const pnl = (pos.richtung === 'long' ? kurs - pos.einstieg : pos.einstieg - kurs) * pos.menge
    return `${r} ${pos.menge} · ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`
}

async function ladePositionen() {
    if (!kerzenSerie.value) return
    const symbol = props.panel.symbol
    // Im Reiter „Offene Trades" einzeln ausgeblendete Positionen weglassen.
    const liste = overlayAn('positionen') ? (await ladeOffenePositionen(symbol)).filter((p) => !positionenAus.value.has(String(p.id))) : []
    if (symbol !== props.panel.symbol || !kerzenSerie.value) return
    positionen = liste
    journalEbene?.setzeOffene(liste)
    entfernePositionsLinien()
    const kurs = kerzen.value[kerzen.value.length - 1]?.c
    for (const pos of liste) {
        // Einstieg, SL und TP zeichnet die Journal-Ebene als Box ab dem Einstieg —
        // hier nur noch ihre Schilder an der Achse, keine Linie über den ganzen Chart.
        // Die Liquidation bleibt als Linie: sie ist keine Grenze der Box.
        const linie = (preis, farbe, titel, art, stil = LineStyle.Solid) => {
            if (!preis) return
            positionsLinien.push({
                art, pos,
                linie: kerzenSerie.value.createPriceLine({ price: preis, color: farbe, lineWidth: 1, lineStyle: stil, axisLabelVisible: true, title: titel, lineVisible: art === 'liq' }),
            })
        }
        linie(pos.einstieg, pos.richtung === 'long' ? '#26a69a' : '#ff6960', positionsTitel(pos, kurs), 'einstieg', LineStyle.Solid)
        linie(pos.sl, '#ff6960', 'SL', 'sl', LineStyle.Dashed)
        linie(pos.tp, '#26a69a', 'TP', 'tp', LineStyle.Dashed)
        linie(pos.liq, '#ff9800', 'Liq', 'liq', LineStyle.Dotted)
    }
}

/** Live-P&L im Titel der Einstiegslinie nachführen. */
function aktualisierePositionsTitel() {
    const kurs = kerzen.value[kerzen.value.length - 1]?.c
    for (const l of positionsLinien) {
        if (l.art === 'einstieg') l.linie.applyOptions({ title: positionsTitel(l.pos, kurs) })
    }
}

function starteTakte() {
    clearInterval(journalTakt)
    clearInterval(positionsTakt)
    // Neue Trades kommen über den Import ins Journal; alle zwei Minuten reicht.
    journalTakt = setInterval(() => { if (!document.hidden) { ladeJournal(); ladeStrategie() } }, 120_000)
    positionsTakt = setInterval(() => { if (!document.hidden) ladePositionen() }, 15_000)
    ladePositionen()
}

let warVersteckt = false
function sichtbarkeitGeaendert() {
    if (document.hidden) { warVersteckt = true; return }
    if (!warVersteckt) return
    warVersteckt = false
    ladePositionen()
    marktNeu()
}

watch(positionenAus, () => ladePositionen())
watch(() => props.panel.overlays, () => { ladeJournal(); ladePositionen(); ladeStrategie(); marktNeu() }, { deep: true })
watch(() => benoetigteQuellen(props.panel.indikatoren).join(), () => ladeExtern())
// LSOB/GUSS: geänderte Strategie-Einstellungen → Signale neu rechnen lassen
watch(() => JSON.stringify((props.panel.indikatoren || []).filter((i) => INDIKATOREN[i.typ]?.zeichner === 'signale').map((i) => [i.typ, strategieParams(i.typ, i.params)])),
    () => ladeExtern(['signale_lsob', 'signale_ema_touch']))
// VWAP Vector: andere Zeiteinheiten (MTF-EMA, Fib, Intrabar) brauchen neue Kerzen.
watch(() => JSON.stringify((props.panel.indikatoren || []).filter((i) => i.typ === 'vwapVector').map((i) => [i.sichtbar, i.params])),
    () => ladeExtern(['vwapVector']))
watch(() => props.panel.symbol, () => {
    gewaehlterTrade.value = null
    entfernePositionsLinien()
    ladePositionen()
    setzeStrategieVorschau(null)
    setzeBacktest(null)
})
watch(() => props.panel.interval, () => { setzeStrategieVorschau(null); setzeKiVorschau(null) })
let marktNeuUhr = null
watch(() => [props.panel.symbol, props.panel.interval, props.panel.markt], () => {
    marktEbene?.setzeLiquidationen([])
    marktEbene?.setzeZonen(null)
    marktEbene?.setzeWaende(null)
    // OI, Funding, Momentum, VWAP-Vector-Kerzen gehören zum ALTEN Symbol. Ohne
    // Leeren rechneten die neuen Kerzen damit — und schlug der neue Abruf fehl,
    // stand BTC-OI dauerhaft unter einem anderen Coin.
    zeichner?.leereExtern()
    // Kurz warten, bis die neuen Kerzen da sind — Liquidationen und
    // Datenfenster richten sich nach deren Zeitraum. Uhr merken: wird das Panel
    // vorher abgebaut, legte marktNeu sonst einen Takt an, den niemand löscht.
    clearTimeout(marktNeuUhr)
    marktNeuUhr = setTimeout(marktNeu, 1500)
})

function schliesseTrade() {
    gewaehlterTrade.value = null
    journalEbene?.hebeHervor(null)
}

// ── Zeichnungen ──────────────────────────────────────────────────────────
const alleZeichnungen = computed(() => zeichnungenVon(props.panel.symbol).value)
const sichtbareZeichnungen = computed(() => (props.zeichnungenVersteckt ? [] : alleZeichnungen.value.filter((z) =>
    !z.versteckt && (!Array.isArray(z.sichtbarAuf) || !z.sichtbarAuf.length || z.sichtbarAuf.includes(props.panel.interval)))))
const ausgewaehlt = computed(() => sichtbareZeichnungen.value.find((z) => z.id === auswahlId.value) || null)

watch(sichtbareZeichnungen, (l) => ebene?.setzeZeichnungen(l))
watch(() => props.werkzeug, (w) => { ebene?.setzeWerkzeug(w); if (w) auswahlId.value = null })
watch(() => props.magnet, (m) => ebene?.setzeMagnet(m))
watch(() => props.panel.symbol, () => { auswahlId.value = null; ebene?.setzeAuswahl(null) })

async function zeichnungNeu({ typ, punkte, stil: vorgabeStil = {} }) {
    // Mit dem zuletzt benutzten Stil dieses Werkzeugs starten, nicht mit den Werksfarben.
    let stil = { ...letzterStil(typ), ...vorgabeStil }
    if (typ === 'text') {
        const text = window.prompt(t('chart.textEingeben'), '')
        if (!text) return
        stil = { ...stil, text: text.slice(0, 200) }
    }
    const z = await legeAn({ symbol: props.panel.symbol, typ, punkte, stil, sichtbarAuf: null, gesperrt: false, versteckt: false })
    if (z) { auswahlId.value = z.id; ebene?.setzeAuswahl(z.id) }
}

function textBearbeiten(id) {
    const z = alleZeichnungen.value.find((x) => x.id === id)
    if (!z) return
    const text = window.prompt(t('chart.textEingeben'), z.stil?.text || '')
    if (text === null) return
    aendere(props.panel.symbol, id, { stil: { ...(z.stil || {}), text: text.slice(0, 200) } })
}

function aendereAuswahl(patch) {
    if (!ausgewaehlt.value) return
    if (patch.stil) merkeStil(ausgewaehlt.value.typ, patch.stil)
    aendere(props.panel.symbol, ausgewaehlt.value.id, patch)
    if (patch.versteckt) { auswahlId.value = null; ebene?.setzeAuswahl(null) }
}

function loescheAuswahl() {
    if (!ausgewaehlt.value || ausgewaehlt.value.gesperrt) return false
    loesche(props.panel.symbol, ausgewaehlt.value.id)
    auswahlId.value = null
    ebene?.setzeAuswahl(null)
    return true
}

/** Escape: laufende Zeichnung oder Messung verwerfen, sonst Auswahl lösen. */
function abbrechen() {
    if (ebene?.abbrechen()) return true
    if (auswahlId.value != null) { auswahlId.value = null; ebene?.setzeAuswahl(null); return true }
    return false
}

/** KI-Vorschläge gestrichelt einblenden (oder mit null entfernen). */
function setzeKiVorschau(analyse) {
    ebene?.setzeTemporaer(analyse && analyse.symbol === props.panel.symbol && analyse.interval === props.panel.interval ? kiVorschau(analyse, { profilStil: letzterStil('volprofil') }) : [])
}

function waehleZeichnung(id) {
    auswahlId.value = id
    ebene?.setzeAuswahl(id)
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
        aktualisierePositionsTitel()
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
    ebene?.setzeSkala(props.panel.skala)
}

/*
 * Automatisch einpassen: Zieht oder staucht man die Preisachse (auch mit dem
 * Mausrad über der Achse), schaltet das Einpassen ab — es bliebe sonst auch
 * nach einem Symbolwechsel aus (ETH auf der BTC-Skala 77 000–87 500, also
 * leer). Darum ist es bei jedem Öffnen und Neuladen wieder an; der Knopf „A"
 * unten rechts und „Auto" in der Kopfleiste zeigen und schalten es.
 */
const autoSkala = ref(props.panel.autoSkala !== false)
function preisSkalen() {
    const c = chart.value
    if (!c) return []
    return c.panes().map((_, i) => c.priceScale('right', i))
}
/** Zustand ins Layout melden (`panel.autoSkala`) — dort liest ihn der „Auto"-Schalter der Kopfleiste. */
function meldeAutoSkala() {
    if ((props.panel.autoSkala !== false) !== autoSkala.value) emit('panel', { autoSkala: autoSkala.value })
}
function pruefeAutoSkala() {
    const s0 = preisSkalen()[0]
    if (s0) autoSkala.value = !!s0.options().autoScale
    meldeAutoSkala()
}
function autoEinpassen(an = true) {
    for (const s of preisSkalen()) s.applyOptions({ autoScale: an })
    autoSkala.value = an
    meldeAutoSkala()
}
// Schalter in der Kopfleiste (oder ein anderes Gerät) hat umgestellt
watch(() => props.panel.autoSkala !== false, (an) => { if (an !== autoSkala.value) autoEinpassen(an) })

/**
 * Mausrad über der Preisachse = Höhe verstellen (wie in TradingView), um die
 * Mitte des sichtbaren Bereichs, im Log-Modus in Log-Preisen. Die Bibliothek
 * kennt das Rad nur für die Zeitachse. Danach ist „Auto" aus.
 */
function radAufAchse(e) {
    const c = chart.value
    if (!c || !huelle.value) return
    const rect = huelle.value.getBoundingClientRect()
    const breite = c.priceScale('right', 0).width()
    if (!breite || e.clientX < rect.right - breite) return
    // Welches Pane liegt unter dem Zeiger?
    let y = e.clientY - rect.top, idx = -1
    const panes = c.panes()
    for (let i = 0; i < panes.length; i++) {
        const h = panes[i].getHeight()
        if (y <= h) { idx = i; break }
        y -= h + 1
    }
    if (idx < 0) return
    const skala = c.priceScale('right', idx)
    const bereich = skala.getVisibleRange()
    if (!bereich || !(bereich.to > bereich.from)) return
    e.preventDefault()
    e.stopPropagation()
    const faktor = Math.pow(1.0015, Math.max(-200, Math.min(200, e.deltaY)))
    const log = skala.options().mode === PriceScaleMode.Logarithmic && bereich.from > 0
    const hin = log ? Math.log : (v) => v, her = log ? Math.exp : (v) => v
    const a = hin(bereich.from), b = hin(bereich.to), mitte = (a + b) / 2, halb = ((b - a) / 2) * faktor
    skala.applyOptions({ autoScale: false })
    skala.setVisibleRange({ from: her(mitte - halb), to: her(mitte + halb) })
    if (idx === 0) { autoSkala.value = false; meldeAutoSkala() }
}

async function ladeNeu() {
    const nr = ++ladeNummer
    // Jedes Neuladen passt EINMAL ein — sonst zeigte die alte Skala den leeren
    // Bereich des vorigen Symbols. Ist „Auto" aus, friert die Skala danach an
    // dieser Stelle ein (siehe unten nach setzeDaten), statt dem Kurs zu folgen.
    for (const s of preisSkalen()) s.applyOptions({ autoScale: true })
    live?.stop()
    live = null
    historieZuEnde = false
    fehler.value = ''
    laedt.value = true
    const { symbol, markt, interval } = props.panel
    const boerse = boerseVon()
    const max = QUELLEN_MAX[boerse] || 1000
    try {
        let liste = await ladeKerzen({ symbol, markt, interval, limit: max, boerse })
        // Bei 200 Kerzen je Abruf (Bitunix) wäre der Chart halb leer — gleich
        // ein paar Seiten nachlegen, damit Indikatoren Vorlauf haben.
        for (let i = 0; i < 4 && istRestQuelle(boerse) && liste.length >= max && liste.length < 800; i++) {
            const aeltere = await ladeKerzen({ symbol, markt, interval, limit: max, boerse, endTime: liste[0].t - 1 })
            if (nr !== ladeNummer || !aeltere.length) break
            liste = fuegeZusammen(aeltere, liste)
        }
        if (nr !== ladeNummer) return
        setzeDaten(liste)
        // Bei den REST-Quellen sagt eine kurze erste Seite nichts: Bitget hält
        // die älteren Kerzen unter einem anderen Endpunkt bereit. Dort ist erst
        // Schluss, wenn das Nachladen leer zurückkommt.
        if (!istRestQuelle(boerse) && liste.length < max) historieZuEnde = true
        // Die jüngsten ~150 Kerzen zeigen, nicht alle tausend gequetscht.
        const n = liste.length
        if (n) chart.value?.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 150), to: n + 8 })
        // Beim Öffnen und nach jedem Wechsel ist „Auto" an, auch wenn es zuvor aus war.
        autoEinpassen(true)
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
    const boerse = boerseVon()
    const max = QUELLEN_MAX[boerse] || 1000
    try {
        const aeltere = await ladeKerzen({ symbol, markt, interval, endTime: kerzen.value[0].t - 1, limit: max, boerse })
        if (nr !== ladeNummer) return
        if (istRestQuelle(boerse) ? !aeltere.length : aeltere.length < max) historieZuEnde = true
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

/** Börse der Kerzen: Binance, oder Bitunix/Bitget (nur Futures). */
function boerseVon() {
    const b = props.panel.boerse
    return props.panel.markt !== 'spot' && istRestQuelle(b) ? b : 'binance'
}

function starteLive(nr) {
    const { symbol, markt, interval } = props.panel
    const Klasse = istRestQuelle(boerseVon()) ? RestKerze : LiveKerze
    live = new Klasse({
        symbol, markt, interval, boerse: boerseVon(),
        onStatus: (s) => { if (nr === ladeNummer) status.value = s },
        onKerze: (k) => {
            if (nr !== ladeNummer) return
            const liste = kerzen.value
            const letzte = liste[liste.length - 1]
            if (letzte && k.t < letzte.t) return
            const bar = { t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }
            if (letzte && k.t === letzte.t) liste[liste.length - 1] = bar
            else {
                liste.push(bar)
                ebene?.setzeKerzen(liste, INTERVALL_MS[props.panel.interval])
                journalEbene?.setzeKerzen(liste, INTERVALL_MS[props.panel.interval])
                strategieEbene?.setzeKerzen(liste, INTERVALL_MS[props.panel.interval])
                marktEbene?.setzeKerzen(liste, INTERVALL_MS[props.panel.interval])
            }
            kerzenSerie.value?.update(kerzenPunkt(bar, liste.length - 1))
            volumenSerie.value?.update(volumenBalken(bar))
            if (!extern) legende.value = letzteLegende()
            planeNachfuehren()
            emit('kerzen', liste)
        },
        onLuecke: async () => {
            // Nach einem Abriss die letzten Kerzen neu holen, sonst bliebe
            // genau die Zeit ohne Verbindung als Loch stehen.
            try {
                // Von DERSELBEN Börse — ohne `boerse` kamen in ein Bitunix-Chart Binance-Kerzen.
                const frisch = await ladeKerzen({ symbol, markt, interval, limit: 500, boerse: boerseVon() })
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

watch(() => [props.panel.symbol, props.panel.markt, props.panel.interval, props.panel.boerse], ladeNeu)
watch(() => [props.panel.symbol, props.panel.markt, props.panel.interval], () => {
    wasserzeichen?.applyOptions(wasserzeichenOptionen(getComputedStyle(document.body).fontFamily))
})
watch(() => props.panel.skala, wendeSkalaAn)
watch(() => props.panel.indikatoren, (inst) => {
    zeichner?.setze(inst, kerzen.value)
    if (zeichner) indikatorWerte.value = zeichner.werteBei(kreuzZeit)
}, { deep: true })

function wertText(w, typ) {
    if (w == null || !Number.isFinite(w)) return '—'
    // Linien im Kerzen-Pane (EMA, VWAP …) sind Kurse: wie der Kurs schreiben, nicht „83.5K".
    if (INDIKATOREN[typ]?.ort === 'preis') return w.toFixed(preisStellen.value)
    const a = Math.abs(w)
    if (a >= 1e9) return (w / 1e9).toFixed(2) + 'B'
    if (a >= 1e6) return (w / 1e6).toFixed(2) + 'M'
    if (a >= 1e4) return (w / 1e3).toFixed(1) + 'K'
    return w.toFixed(a >= 100 ? 2 : a >= 1 ? Math.max(2, preisStellen.value > 4 ? 4 : preisStellen.value) : Math.min(8, preisStellen.value + 2))
}

onMounted(() => {
    baueChart()
    ladeNeu()
    starteTakte()
    clearTimeout(marktNeuUhr)
    marktNeuUhr = setTimeout(marktNeu, 1500)
    zeichneAlarmLinien()
    huelle.value.addEventListener('contextmenu', rechtsklick)
    // Capture + nicht passiv: vor der Bibliothek, die das Rad sonst als Zeit-Zoom nimmt.
    huelle.value.addEventListener('wheel', radAufAchse, { capture: true, passive: false })
    document.addEventListener('visibilitychange', sichtbarkeitGeaendert)
})
onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', sichtbarkeitGeaendert)
    huelle.value?.removeEventListener('wheel', radAufAchse, { capture: true })
    ladeNummer++
    clearTimeout(nachfuehrUhr)
    zeichner?.abbauen()
    zeichner = null
    ebene?.abbauen()
    ebene = null
    clearTimeout(journalUhr)
    clearInterval(journalTakt)
    clearInterval(positionsTakt)
    journalEbene?.abbauen()
    journalEbene = null
    strategieEbene?.abbauen()
    strategieEbene = null
    clearInterval(marktTakt)
    clearTimeout(marktNeuUhr)
    for (const x of externNochmal.values()) clearTimeout(x.uhr)
    externNochmal.clear()
    marktEbene?.abbauen()
    marktEbene = null
    live?.stop()
    chart.value?.remove()
    chart.value = null
})

defineExpose({
    chart, kerzenSerie, kerzen, zuLwc, vonLwc, kerzeBei,
    setzeKreuz, setzeZeitraum, sichtbarerZeitraum, zurJetztzeit, bildschirmfoto, ladeNeu,
    loescheAuswahl, abbrechen, waehleZeichnung, auswahlId, setzeKiVorschau,
    strategieDaten, strategieVorschau, strategieBacktest, setzeStrategieVorschau, setzeBacktest, ladeStrategie,
})
</script>

<template>
    <div class="chartPanel" :class="{ aktiv }" @mousedown="emit('fokus')" @touchstart.passive="emit('fokus')">
        <div ref="huelle" class="flaeche" @pointerup="pruefeAutoSkala" @wheel.passive="pruefeAutoSkala" @dblclick="pruefeAutoSkala"></div>
        <button class="autoKnopf" :class="{ an: autoSkala }" :title="t(autoSkala ? 'chart.autoAn' : 'chart.autoAus')"
            @click.stop="autoEinpassen(!autoSkala)" :aria-label="t(autoSkala ? 'chart.autoAn' : 'chart.autoAus')">A</button>

        <div class="legende">
            <span class="sym">{{ panel.symbol }}</span>
            <span class="tf">{{ panel.interval }}</span>
            <span class="markt">{{ panel.markt === 'spot' ? 'Spot' : 'Perp' }}</span>
            <span v-if="boerseVon() !== 'binance'" class="quelleHinweis" :title="t('chart.quelle.restTitel.' + boerseVon())">
                {{ t('chart.quelle.' + boerseVon()) }} · REST ~3 s</span>
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
            <template v-for="(text, name) in marktHinweise" :key="name">
                <span v-if="text" class="marktHinweis" :title="t('chart.markt.titel.' + name)">{{ text }}</span>
            </template>
            <span v-if="journalInfo && journalInfo.anzahl" class="journalHinweis" :title="t('chart.journalHinweis')">
                <i class="uil uil-book-alt"></i> {{ journalInfo.anzahl }}{{ journalInfo.gekappt ? '+' : '' }}
            </span>
            <!-- Volumen ist kein Indikator aus dem Register, aber genauso ausblendbar; Zustand im Layout (panel.volumen). -->
            <div class="indZeile" :class="{ aus: !volumenAn }">
                <span class="indName">{{ t('chart.volumen') }}</span>
                <span class="indKnoepfe">
                    <button :title="t(volumenAn ? 'chart.ausblenden' : 'chart.einblenden')" @click.stop="emit('indikator', { aktion: 'volumen' })" :aria-label="t(volumenAn ? 'chart.ausblenden' : 'chart.einblenden')">
                        <i :class="volumenAn ? 'uil uil-eye' : 'uil uil-eye-slash'"></i></button>
                </span>
            </div>
            <div v-for="ind in (panel.indikatoren || [])" :key="ind.id" class="indZeile" :class="{ aus: ind.sichtbar === false }">
                <span class="indName">{{ kurzname(ind.typ, ind.params, t('chart.ind.' + ind.typ + '.kurz')) }}</span>
                <span v-for="w in (indikatorWerte[ind.id] || [])" :key="w.key" :style="{ color: w.farbe }">{{ wertText(w.wert, ind.typ) }}</span>
                <span class="indKnoepfe">
                    <button :title="t(ind.sichtbar === false ? 'chart.einblenden' : 'chart.ausblenden')"
                        @click.stop="emit('indikator', { aktion: 'umschalten', id: ind.id })" :aria-label="t(ind.sichtbar === false ? 'chart.einblenden' : 'chart.ausblenden')">
                        <i :class="ind.sichtbar === false ? 'uil uil-eye-slash' : 'uil uil-eye'"></i></button>
                    <button :title="t('chart.einstellungen')" @click.stop="emit('indikator', { aktion: 'bearbeiten', id: ind.id })" :aria-label="t('chart.einstellungen')"><i
                            class="uil uil-setting"></i></button>
                    <button :title="t('chart.entfernen')" @click.stop="emit('indikator', { aktion: 'entfernen', id: ind.id })" :aria-label="t('chart.entfernen')"><i
                            class="uil uil-times"></i></button>
                </span>
            </div>
        </div>

        <ZeichnungStil v-if="ausgewaehlt" :zeichnung="ausgewaehlt" :interval="panel.interval"
            :alarm-moeglich="['horizontale', 'strahlH', 'trendlinie', 'strahl', 'rechteck', 'kanal'].includes(ausgewaehlt.typ)"
            @aendere="aendereAuswahl" @loesche="loescheAuswahl" @text="textBearbeiten(ausgewaehlt.id)"
            @alarm="emit('alarmAufZeichnung', ausgewaehlt)" />

        <TradeKarte v-if="gewaehlterTrade" :trade="gewaehlterTrade" :format-preis="(p) => kerzenSerie?.priceFormatter().format(p) ?? String(p)"
            @schliesse="schliesseTrade" />

        <div v-if="kontext" class="kontextHintergrund" @mousedown.stop="kontext = null" @contextmenu.prevent="kontext = null"></div>
        <div v-if="kontext" class="kontextMenue" :style="{ left: kontext.x + 'px', top: kontext.y + 'px' }" @mousedown.stop>
            <div class="kopfzeile">{{ kerzenSerie?.priceFormatter().format(kontext.preis) }}</div>
            <button @click="alarmHier"><i class="uil uil-bell"></i> {{ t('chart.alarm.hier') }}</button>
            <button @click="zeichnungHier('horizontale')"><i class="uil uil-minus"></i> {{ t('chart.wz.horizontale') }}</button>
            <button @click="zeichnungHier('strahlH')"><i class="uil uil-arrow-right"></i> {{ t('chart.wz.strahlH') }}</button>
            <hr />
            <!-- Fragt nach (Chart.vue) und lässt gesperrte Zeichnungen stehen — wie der Mülleimer in der Werkzeugleiste. -->
            <button class="gefahr" @click="kontext = null; emit('alleLoeschen')"><i class="uil uil-trash-alt"></i> {{ t('chart.wzKurz.alleZeichnungenLoeschen') }}</button>
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
.autoKnopf {
    position: absolute;
    right: 6px;
    bottom: 5px;
    z-index: 6;
    width: 20px;
    height: 18px;
    padding: 0;
    font-size: 10px;
    font-weight: 600;
    line-height: 18px;
    border: 1px solid var(--white-18, rgba(255, 255, 255, 0.18));
    border-radius: 3px;
    background: rgba(10, 14, 22, 0.85);
    color: var(--grey-text);
}

.autoKnopf.an {
    color: var(--blue-color);
    border-color: var(--blue-color);
}

.chartPanel {
    position: relative;
    min-width: 0;
    min-height: 0;
    border: 1px solid rgba(1, 180, 255, 0.12);
    border-radius: var(--border-radius, 12px);
    overflow: hidden;
    background: #0a0e16;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.chartPanel.aktiv {
    border-color: rgba(1, 180, 255, 0.55);
    box-shadow: 0 0 0 1px rgba(1, 180, 255, 0.15), 0 0 18px rgba(1, 180, 255, 0.08);
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

.kontextHintergrund {
    position: absolute;
    inset: 0;
    z-index: 8;
}

.kontextMenue {
    position: absolute;
    z-index: 9;
    display: flex;
    flex-direction: column;
    min-width: 170px;
    background: var(--black-bg-5, #1e222d);
    border: 1px solid var(--white-18);
    border-radius: 6px;
    padding: 4px;
    box-shadow: var(--shadow-sm);
    font-size: 12px;
}

.kontextMenue .kopfzeile {
    color: var(--grey-text);
    padding: 2px 8px 4px;
    border-bottom: 1px solid var(--white-10);
    margin-bottom: 2px;
}

.kontextMenue button {
    background: transparent;
    border: none;
    color: var(--white-87, #ddd);
    text-align: left;
    padding: 5px 8px;
    border-radius: 4px;
}

.kontextMenue hr {
    margin: 4px 0;
    border-color: var(--white-18);
}

.kontextMenue button.gefahr:hover {
    color: var(--red-color);
}

.kontextMenue button:hover {
    background: var(--white-10);
}

.marktHinweis {
    color: #ff9800;
    font-size: 10px;
}

.quelleHinweis {
    color: #ff9800;
}

.journalHinweis {
    color: var(--blue-color);
}

.indZeile {
    flex-basis: 100%;
    display: flex;
    gap: 8px;
    align-items: center;
    pointer-events: auto;
    width: fit-content;
    padding: 1px 4px;
    border-radius: 4px;
    /* Eigener Hintergrund: sonst verschwimmt die Zeile mit Beschriftungen im Chart. */
    background: rgba(10, 14, 22, 0.72);
}

.indZeile:hover {
    background: rgba(10, 14, 22, 0.92);
}

.indZeile.aus {
    opacity: 0.45;
}

.indName {
    color: var(--white-87, #ddd);
}

.indKnoepfe {
    /* Immer sichtbar, nur gedämpft — nur-beim-Darüberfahren fand niemand,
       und am Telefon gibt es kein Darüberfahren. */
    display: inline-flex;
    gap: 2px;
    opacity: 0.55;
}

.indZeile:hover .indKnoepfe {
    opacity: 1;
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
