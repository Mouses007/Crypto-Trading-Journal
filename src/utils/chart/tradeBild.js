/**
 * Chartbild zu einem Trade — ohne sichtbares Panel.
 *
 * Für die Einstiegsbewertung auf „Pendente Trades": das System holt den Chart
 * der gewählten Zeiteinheit selbst, zeichnet den Trade mit dem Long/Short-
 * Positionswerkzeug des Charts ein (dieselbe ZeichenEbene, also dieselben
 * Flächen und dieselbe R-Angabe; fehlt Stop oder Ziel, als Preislinien) und —
 * wenn ein Strategie-Tag gesetzt ist (LSOB, GUSS) — die Setups der Strategie
 * mit ihrem Order Block bzw. ihrer EMA-Zone. Das Bild wird wie ein von Hand
 * hochgeladener Screenshot am Trade abgelegt und wandert beim Abschluss mit
 * ins Journal.
 *
 * Gebaut wird ein echter Lightweight-Charts-Chart in einem unsichtbaren
 * Container mit fester Grösse, dann `takeScreenshot`. Das Attribution-Logo von
 * TradingView bleibt im Bild an (Lizenz der Bibliothek, Apache-2.0 + Hinweis).
 */
import {
    createChart, CandlestickSeries, LineSeries, ColorType, LineStyle, createSeriesMarkers, createTextWatermark,
} from 'lightweight-charts'
import axios from 'axios'
import dayjs from 'dayjs'
import { ladeKerzen, INTERVALL_MS } from './kerzenQuelle.js'
import { SignalZeichnung } from './signalZeichnung.js'
import { ZeichenEbene } from './zeichnungen/ZeichenEbene.js'
import { ema } from '../../../shared/indicators.js'
import { normSymbol } from '../../../shared/symbol.js'

/** Zeiteinheit der Bewertung (1D, 1W, 2m …) → Zeiteinheit des Charts. */
const TF_KARTE = {
    '1m': '1m', '2m': '3m', '3m': '3m', '5m': '5m', '6m': '5m', '10m': '15m', '15m': '15m', '30m': '30m', '45m': '1h',
    '1h': '1h', '2h': '2h', '3h': '4h', '4h': '4h', '1D': '1d', '1d': '1d', '1W': '1w', '1w': '1w', '1M': '1M',
}
export const chartZeiteinheit = (tf) => TF_KARTE[tf] || null

/** Strategie aus den Tags des Trades: „LSOB" → lsob, „GUSS"/„EMA Touch" → ema_touch. */
export function strategieAusTags(tags) {
    const namen = (tags || []).map((t) => String(t?.name || t || '').toUpperCase())
    if (namen.some((n) => n.includes('LSOB'))) return 'lsob'
    if (namen.some((n) => n.includes('GUSS') || n.includes('EMA TOUCH') || n.includes('EMA-TOUCH'))) return 'ema_touch'
    return null
}
const STRATEGIE_NAME = { lsob: 'LSOB', ema_touch: 'GUSS' }
const STRATEGIE_TF = ['5m', '15m', '30m', '1h', '4h', '1d']

// Ein Bild-Takt — mit Zeitgrenze: im Hintergrund-Tab laufen keine requestAnimationFrame,
// und das Bild hinge (takeScreenshot zeichnet ohnehin selbst neu).
const warteFrame = () => new Promise((r) => { const u = setTimeout(r, 60); requestAnimationFrame(() => { clearTimeout(u); r() }) })

/**
 * @param {{ symbol, interval, richtung: 'long'|'short', einstiegT: number (ms), einstiegP: number,
 *           sl?: number, tp?: number, strategie?: 'lsob'|'ema_touch'|null, breite?: number, hoehe?: number }} o
 * @returns {Promise<string>} JPEG als Data-URL
 */
export async function erzeugeTradeBild({ symbol, interval, richtung, einstiegT, einstiegP, sl = null, tp = null, strategie = null, breite = 1400, hoehe = 760 }) {
    const sym = normSymbol(symbol)
    const iv = INTERVALL_MS[interval]
    if (!sym || !iv) throw new Error(`Zeiteinheit ${interval} wird für das Chartbild nicht unterstützt`)

    // Kerzen: die jüngsten — liegt der Einstieg weiter zurück, ein Fenster um ihn herum.
    let kerzen = await ladeKerzen({ markt: 'futures', symbol: sym, interval, limit: 400 })
    if (kerzen.length && einstiegT < kerzen[0].t + 60 * iv) {
        kerzen = await ladeKerzen({ markt: 'futures', symbol: sym, interval, limit: 400, endTime: einstiegT + 250 * iv })
    }
    if (kerzen.length < 20) throw new Error(`Zu wenige Kerzen für ${sym} ${interval}`)

    let signale = null
    if (strategie && STRATEGIE_TF.includes(interval)) {
        try {
            const { data } = await axios.get('/api/chart/signale', { params: { strategie, symbol: sym, interval, markt: 'futures' } })
            signale = data
        } catch { signale = null }   // ohne Signale trotzdem ein Bild
    }

    const huelle = document.createElement('div')
    huelle.style.cssText = `position:fixed;left:-20000px;top:0;width:${breite}px;height:${hoehe}px;pointer-events:none;`
    document.body.appendChild(huelle)
    const chart = createChart(huelle, {
        width: breite, height: hoehe,
        layout: {
            background: { type: ColorType.VerticalGradient, topColor: '#101826', bottomColor: '#0a0e16' },
            textColor: '#9aa4b2', fontSize: 12,
            attributionLogo: true,
        },
        grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(1,180,255,0.05)' } },
        rightPriceScale: { borderVisible: false },
        timeScale: {
            borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6,
            tickMarkFormatter: (z, art) => {
                const d = dayjs.unix(z)
                if (art === 0) return d.format('YYYY')
                if (art === 1) return d.format('MM.YYYY')
                if (art === 2) return d.format('DD.MM.')
                return d.format('HH:mm')
            },
        },
        localization: { locale: 'de-CH', timeFormatter: (z) => dayjs.unix(z).format('DD.MM.YY HH:mm') },
    })
    let zeichenEbene = null
    try {
        const zuLwc = (t) => Math.floor(t / 1000)
        const serie = chart.addSeries(CandlestickSeries, {
            upColor: 'rgba(38,166,154,0.12)', downColor: '#ef5350', borderUpColor: '#26a69a', borderDownColor: '#ef5350',
            wickUpColor: '#26a69a', wickDownColor: '#ef5350',
        })
        serie.setData(kerzen.map((k) => ({ time: zuLwc(k.t), open: k.o, high: k.h, low: k.l, close: k.c })))

        // GUSS: die EMAs der Strategie dazu, ohne sie ist die Zone nicht lesbar
        if (strategie === 'ema_touch') {
            for (const [n, farbe, b] of [[21, '#29b6f6', 1], [50, '#f5c542', 2], [200, '#ab47bc', 1]]) {
                const w = ema(kerzen, n)
                const s = chart.addSeries(LineSeries, { color: farbe, lineWidth: b, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
                s.setData(kerzen.map((k, i) => (w[i] == null ? { time: zuLwc(k.t) } : { time: zuLwc(k.t), value: w[i] })))
            }
        }

        const long = richtung === 'long'
        const iE = kerzen.reduce((b, k, i) => (k.t <= einstiegT ? i : b), 0)
        if (sl > 0 && tp > 0 && einstiegP > 0) {
            // Wie das Positionswerkzeug: Fläche ab der Einstiegskerze bis zur letzten
            // Kerze (mindestens 20 Kerzen breit), Punkte = Einstieg, Ziel, Stop.
            const ende = Math.max(kerzen[kerzen.length - 1].t, kerzen[iE].t + 20 * iv)
            zeichenEbene = new ZeichenEbene({ huelle, chart, serie, rueckruf: {}, formatPreis: (p) => serie.priceFormatter().format(p) })
            zeichenEbene.setzeKerzen(kerzen, iv)
            zeichenEbene.setzeZeichnungen([{
                id: 1, typ: 'position', stil: {}, gesperrt: true,
                punkte: [{ t: kerzen[iE].t, p: einstiegP }, { t: ende, p: tp }, { t: ende, p: sl }],
            }])
        } else {
            // Ohne Stop oder Ziel gibt es keine Position — dann Linien an der Preisachse.
            const linie = (preis, farbe, titel, stil) => {
                if (!(preis > 0)) return
                serie.createPriceLine({ price: preis, color: farbe, lineWidth: 2, lineStyle: stil, axisLabelVisible: true, title: titel })
            }
            linie(einstiegP, '#e0e0e0', `Einstieg ${long ? 'Long' : 'Short'}`, LineStyle.Solid)
            linie(sl, '#ef5350', 'Stop', LineStyle.Dashed)
            linie(tp, '#26a69a', 'Ziel', LineStyle.Dashed)
        }
        // Pfeil an der Einstiegskerze
        createSeriesMarkers(serie, [{
            time: zuLwc(kerzen[iE].t), position: long ? 'belowBar' : 'aboveBar',
            color: long ? '#26a69a' : '#ef5350', shape: long ? 'arrowUp' : 'arrowDown', text: long ? 'Long' : 'Short',
        }])

        if (signale?.setups?.length) {
            const sz = new SignalZeichnung({ chart, serie })
            sz.setze(signale, kerzen.map((k) => k.t), iv, {})
        }

        createTextWatermark(chart.panes()[0], {
            horzAlign: 'left', vertAlign: 'top',
            lines: [
                { text: `${sym} · ${interval}${strategie ? ` · ${STRATEGIE_NAME[strategie]}` : ''}`, color: 'rgba(255,255,255,0.75)', fontSize: 22 },
                { text: dayjs(einstiegT).format('DD.MM.YYYY HH:mm'), color: 'rgba(255,255,255,0.45)', fontSize: 14 },
            ],
        })

        // Ausschnitt: ~120 Kerzen vor dem Einstieg bis zur letzten (höchstens 220 sichtbar)
        const bis = kerzen.length - 1
        const von = Math.max(0, Math.min(iE - 120, bis - 220))
        chart.timeScale().setVisibleLogicalRange({ from: von, to: bis + 6 })
        await warteFrame(); await warteFrame()
        return chart.takeScreenshot(true).toDataURL('image/jpeg', 0.88)
    } finally {
        zeichenEbene?.abbauen()
        chart.remove()
        huelle.remove()
    }
}

/**
 * Chartbild aus dem ECHTEN Chart: ein ChartPanel mit den Indikatoren und
 * Overlays des aktiven Layouts (wie auf /chart eingestellt), unsichtbar
 * gerendert. Die offene Position zeichnet die Journal-Ebene des Panels als
 * Box wie das Positionswerkzeug; rechts bleibt Platz, damit Box und Schilder
 * ganz im Bild stehen. Mit Strategie-Tag kommt deren Signal-Indikator dazu.
 * Schlägt etwas fehl, das schlanke Bild von `erzeugeTradeBild`.
 *
 * @param {object} o wie `erzeugeTradeBild`
 */
export async function erzeugeChartBild(o) {
    try {
        return await chartBildAusPanel(o)
    } catch (e) {
        console.warn(' -> Chartbild aus dem Layout fehlgeschlagen, schlankes Bild:', e?.message || e)
        return erzeugeTradeBild(o)
    }
}

const STRATEGIE_INDIKATOR = { lsob: 'lsob', ema_touch: 'guss' }
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

async function chartBildAusPanel({ symbol, interval, strategie = null, breite = 1600, hoehe = 900 }) {
    const [{ createApp, h, ref }, { default: ChartPanel }, { default: i18n }, { neueInstanz, INDIKATOREN }] = await Promise.all([
        import('vue'), import('../../components/chart/ChartPanel.vue'), import('../../i18n/index.js'), import('./indikatorRegister.js'),
    ])
    const sym = normSymbol(symbol)
    if (!sym || !INTERVALL_MS[interval]) throw new Error(`Zeiteinheit ${interval} wird für das Chartbild nicht unterstützt`)

    // Indikatoren und Overlays des aktiven Layouts — bevorzugt vom Panel mit demselben Symbol.
    let vorlage = null
    try {
        const { data } = await axios.get('/api/chart/layouts')
        const layout = (data || []).find((l) => l.aktiv) || (data || [])[0]
        const panels = layout?.daten?.panels || []
        vorlage = panels.find((p) => normSymbol(p.symbol) === sym) || panels[layout?.daten?.aktiv || 0] || panels[0] || null
    } catch { vorlage = null }
    const indikatoren = (vorlage?.indikatoren || []).filter((i) => INDIKATOREN[i.typ] && i.sichtbar !== false)
    const sTyp = STRATEGIE_INDIKATOR[strategie]
    if (sTyp && INDIKATOREN[sTyp] && !indikatoren.some((i) => i.typ === sTyp)) indikatoren.push(neueInstanz(sTyp))
    const panel = ref({
        symbol: sym, markt: 'futures', boerse: 'binance', interval, skala: vorlage?.skala || 'normal',
        indikatoren, overlays: { ...(vorlage?.overlays || {}), journal: true, positionen: true }, autoSkala: true,
    })

    const huelle = document.createElement('div')
    huelle.style.cssText = `position:fixed;left:-20000px;top:0;width:${breite}px;height:${hoehe}px;pointer-events:none;display:flex;`
    document.body.appendChild(huelle)
    const panelRef = ref(null)
    const app = createApp({ render: () => h(ChartPanel, { ref: panelRef, panel: panel.value, nummer: 0, aktiv: false, style: 'flex:1;min-width:0;' }) })
    app.use(i18n)
    try {
        app.mount(huelle)
        // Kerzen abwarten, dann die nachgeladenen Daten (höhere Zeiteinheiten, Positionen, Journal).
        const bis = Date.now() + 20_000
        while (Date.now() < bis && !(panelRef.value?.kerzen?.length > 20)) await pause(200)
        const p = panelRef.value
        if (!(p?.kerzen?.length > 20)) throw new Error('keine Kerzen')
        await pause(3500)
        const n = p.kerzen.length
        // Rechts Platz für die Box (20 Kerzen) und ihre Schilder.
        p.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 160), to: n + 32 })
        await warteFrame(); await warteFrame(); await pause(150)
        const leinwand = p.bildschirmfoto()
        if (!leinwand) throw new Error('kein Bild')
        return leinwand.toDataURL('image/jpeg', 0.88)
    } finally {
        app.unmount()
        huelle.remove()
    }
}
