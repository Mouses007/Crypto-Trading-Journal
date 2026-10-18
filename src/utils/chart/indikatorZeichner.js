/**
 * Bringt Indikator-Instanzen eines Panels in den Chart.
 *
 * Die Rechnung kommt aus `indikatorRegister.js`; hier geht es nur um Serien,
 * Panes und das Nachführen bei der laufenden Kerze.
 *
 * Panes: Indikatoren mit `ort: 'eigen'` bekommen je ein Pane unter den
 * Kerzen, in der Reihenfolge der Instanzen. Ändert sich die Zusammensetzung
 * (hinzu, weg, Parameter, Farbe), wird alles abgebaut und neu aufgebaut —
 * leere Panes räumt die Bibliothek selbst ab. Das ist bei einem Dutzend Serien
 * billiger und vor allem einfacher als jede Umsortierung von Pane-Indizes.
 *
 * Bei der laufenden Kerze wird neu gerechnet (ein paar tausend Werte, im
 * Millisekundenbereich) und nur der letzte Punkt jeder Serie aktualisiert.
 */
import { LineSeries, HistogramSeries, AreaSeries, LineStyle } from 'lightweight-charts'
import { INDIKATOREN, rechneIndikator, ausgabenVon, saubereParams } from './indikatorRegister.js'
import { MomentumZeichnung } from './momentumZeichnung.js'
import { VwapVectorZeichnung, vektorFarben } from './vwapVectorZeichnung.js'
import { logischZuX } from './zeichnungen/geometrie.js'

const GRUEN = 'rgba(38,166,154,0.7)'
const ROT = 'rgba(255,105,96,0.7)'

/*
 * MACD-Histogramm in vier Stufen wie bei TradingView: über null kräftig grün,
 * solange es wächst, blass, wenn es schrumpft; unter null kräftig rot, solange
 * es fällt, blass, wenn es sich null nähert. So sieht man das Nachlassen des
 * Schwungs, bevor das Histogramm die Seite wechselt.
 */
const HIST4 = { hochSteigt: '#26a69a', hochFaellt: '#b2dfdb', tiefSteigt: '#ffcdd2', tiefFaellt: '#ff5252' }
function vierFarben(w, vorher) {
    const steigt = vorher == null || w >= vorher
    if (w >= 0) return steigt ? HIST4.hochSteigt : HIST4.hochFaellt
    return steigt ? HIST4.tiefSteigt : HIST4.tiefFaellt
}

/**
 * Band eines Oszillators (RSI 30–70, Stochastik 20–80) wie bei TradingView:
 * getönter Streifen zwischen den Marken, Ausschläge darüber grün, darunter rot
 * gefüllt — bis zur Marke, nicht bis zum Rand.
 */
class BandZeichnung {
    constructor({ chart, serie, band }) {
        this.chart = chart
        this.serie = serie
        this.band = band
        this.werte = []
        this.requestUpdate = () => {}
        this._ansichten = [{
            zOrder: () => 'bottom',
            renderer: () => ({ draw: (ziel) => ziel.useMediaCoordinateSpace(({ context, mediaSize }) => this.zeichne(context, mediaSize)) }),
        }]
        serie.attachPrimitive(this)
    }
    attached({ requestUpdate }) { this.requestUpdate = requestUpdate }
    detached() { this.requestUpdate = () => {} }
    paneViews() { return this._ansichten }
    updateAllViews() {}
    abbauen() { try { this.serie.detachPrimitive(this) } catch { /* weg */ } }
    setze(werte) { this.werte = werte || []; this.requestUpdate() }

    zeichne(ctx, g) {
        const yO = this.serie.priceToCoordinate(this.band.oben)
        const yU = this.serie.priceToCoordinate(this.band.unten)
        if (yO == null || yU == null) return
        ctx.fillStyle = 'rgba(126,87,194,0.10)'
        ctx.fillRect(0, Math.min(yO, yU), g.width, Math.abs(yU - yO))
        const ts = this.chart.timeScale()
        const fuelle = (grenze, yGrenze, ueber, farbe) => {
            ctx.fillStyle = farbe
            let stueck = []
            const zu = () => {
                if (stueck.length > 1) {
                    ctx.beginPath()
                    ctx.moveTo(stueck[0][0], yGrenze)
                    for (const [x, y] of stueck) ctx.lineTo(x, y)
                    ctx.lineTo(stueck[stueck.length - 1][0], yGrenze)
                    ctx.closePath()
                    ctx.fill()
                }
                stueck = []
            }
            for (let i = 0; i < this.werte.length; i++) {
                const w = this.werte[i]
                const x = logischZuX(ts, i)
                if (w == null || x == null) { zu(); continue }
                const drin = ueber ? w > grenze : w < grenze
                const y = this.serie.priceToCoordinate(drin ? w : grenze)
                if (y == null) { zu(); continue }
                // An der Marke abgeschnitten: wo die Linie innerhalb liegt, hat die Fläche die Höhe null.
                stueck.push([x, y])
            }
            zu()
        }
        fuelle(this.band.oben, yO, true, 'rgba(38,166,154,0.28)')
        fuelle(this.band.unten, yU, false, 'rgba(255,82,82,0.28)')
    }
}

/** 93673 → „93.67K" — grosse Bestände (OI) lesbar statt sechsstellig. */
function kompakt(v) {
    const a = Math.abs(v)
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B'
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M'
    if (a >= 1e4) return (v / 1e3).toFixed(2) + 'K'
    return a >= 100 ? v.toFixed(0) : v.toFixed(2)
}

function mitAlpha(farbe, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(farbe)
    if (!m) return farbe
    const n = parseInt(m[1], 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/**
 * Titel oben links in einem Indikator-Fenster. Als Primitive mit zOrder
 * „top" und eigenem Hintergrund: ein Wasserzeichen der Bibliothek liegt
 * HINTER den Serien und verschwände unter der OI-Fläche oder der Momentum-Welle.
 */
class FensterTitel {
    constructor(serie, text) {
        this.serie = serie
        this.text = text
        this.requestUpdate = () => {}
        this._ansichten = [{
            zOrder: () => 'top',
            renderer: () => ({ draw: (ziel) => ziel.useMediaCoordinateSpace(({ context }) => this.zeichne(context)) }),
        }]
        serie.attachPrimitive(this)
    }
    attached({ requestUpdate }) { this.requestUpdate = requestUpdate }
    detached() { this.requestUpdate = () => {} }
    paneViews() { return this._ansichten }
    updateAllViews() {}
    zeichne(ctx) {
        if (!this.text) return
        ctx.save()
        ctx.font = '600 11px -apple-system, "Segoe UI", Roboto, sans-serif'
        const b = ctx.measureText(this.text).width
        ctx.fillStyle = 'rgba(10,14,22,0.78)'
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(4, 4, b + 12, 18, 4); else ctx.rect(4, 4, b + 12, 18)
        ctx.fill()
        ctx.fillStyle = 'rgba(209,212,220,0.92)'
        ctx.textBaseline = 'middle'
        ctx.fillText(this.text, 10, 13.5)
        ctx.restore()
    }
    abbauen() { try { this.serie.detachPrimitive(this) } catch { /* Chart schon weg */ } }
}

export class IndikatorZeichner {
    /**
     * @param {object} chart  Lightweight-Charts-Instanz
     * @param {function} zuLwc  ms → Sekunden
     */
    /**
     * @param {object} [o]  { kerzenSerie, faerbeKerzen(farben|null, nurLetzte) } —
     *                      für Indikatoren, die im Kerzen-Pane selbst zeichnen
     *                      oder die Kerzen einfärben (VWAP Vector).
     */
    constructor(chart, zuLwc, titelFuer = null, o = {}) {
        this.chart = chart
        this.zuLwc = zuLwc
        this.kerzenSerie = o.kerzenSerie || null
        this.faerbeKerzen = o.faerbeKerzen || (() => {})
        this.hatteFarben = false
        this.titelFuer = titelFuer   // instanz → Text für den Fenstertitel (i18n kommt von aussen)
        this.signatur = ''
        this.eintraege = []          // [{ instanz, def, serien: {key: series}, werte: {key: Array} }]
        this.zeiten = []             // t (ms) der Kerzen, für die Legende
        this.extern = {}             // nachgeladene Datenquellen (oi, funding, momentum)
        this.kerzen = []
    }

    /** Eine fremde Datenquelle setzen und die betroffenen Reihen neu rechnen. */
    setzeExtern(name, daten) {
        this.extern = { ...this.extern, [name]: daten }
        if (this.eintraege.some((e) => e.def.extern === name)) this.daten(this.kerzen)
    }

    /**
     * Instanzen und Kerzen setzen. Baut die Serien nur neu auf, wenn sich die
     * Konfiguration geändert hat; sonst werden nur die Daten ersetzt.
     */
    setze(instanzen, kerzen) {
        const sichtbar = (instanzen || []).filter((i) => i.sichtbar !== false && INDIKATOREN[i.typ])
        const sig = JSON.stringify(sichtbar.map((i) => [i.id, i.typ, saubereParams(i.typ, i.params), i.farben]))
        if (sig !== this.signatur) {
            this.abbauen()
            this.aufbauen(sichtbar)
            this.signatur = sig
        }
        this.daten(kerzen)
    }

    aufbauen(instanzen) {
        let naechstesPane = 1
        for (const instanz of instanzen) {
            const def = INDIKATOREN[instanz.typ]
            const pane = def.ort === 'eigen' ? naechstesPane++ : 0
            const serien = {}
            const ausgaben = ausgabenVon(instanz.typ, instanz.params)
            for (const a of ausgaben) {
                // „wert": nur für die Legende gerechnet, gezeichnet wird es von
                // einer eigenen Zeichnung (Momentum-Geldfluss).
                if (a.art === 'wert') continue
                const farbe = instanz.farben?.[a.key] || a.farbe
                const gemeinsam = {
                    priceLineVisible: false,
                    lastValueVisible: def.ort === 'eigen',
                    crosshairMarkerVisible: false,
                    // Feste Skala für Oszillatoren mit Grenzen (RSI 0–100):
                    // ohne sie zoomt das Pane auf 48–52 und jede Delle sieht
                    // wie ein Ausschlag aus.
                    ...(def.bereich ? { autoscaleInfoProvider: () => ({ priceRange: { minValue: def.bereich[0], maxValue: def.bereich[1] } }) } : {}),
                }
                const format = def.kompakt
                    ? { priceFormat: { type: 'custom', formatter: kompakt, minMove: 0.01 } }
                    : null
                if (a.art === 'histogramm') {
                    serien[a.key] = this.chart.addSeries(HistogramSeries, {
                        ...gemeinsam, color: farbe,
                        ...(format || { priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } }),
                        // `unten`: eigene Skala im unteren Drittel des Panes, unter der Fläche.
                        ...(a.unten ? { priceScaleId: `unten-${instanz.id}`, lastValueVisible: false } : {}),
                    }, pane)
                    if (a.unten) serien[a.key].priceScale().applyOptions({ scaleMargins: { top: 0.72, bottom: 0 } })
                } else if (a.art === 'flaeche') {
                    serien[a.key] = this.chart.addSeries(AreaSeries, {
                        ...gemeinsam, ...(format || {}),
                        lineColor: farbe, lineWidth: a.breite || 2,
                        topColor: mitAlpha(farbe, 0.38), bottomColor: mitAlpha(farbe, 0.02),
                    }, pane)
                    serien[a.key].priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.3 } })
                } else {
                    serien[a.key] = this.chart.addSeries(LineSeries, { ...gemeinsam, ...(format || {}), color: farbe, lineWidth: a.breite || 1 }, pane)
                }
            }
            const erste = serien[ausgaben.find((a) => a.art === 'linie' || a.art === 'flaeche')?.key] || Object.values(serien)[0]
            for (const marke of def.linien || []) {
                // Mit Band: Grenzen gestrichelt, Mitte gepunktet — wie TradingView.
                const mitte = def.band && marke !== def.band.oben && marke !== def.band.unten
                erste?.createPriceLine({
                    price: marke, lineWidth: 1, axisLabelVisible: false,
                    color: def.band ? 'rgba(120,123,134,0.75)' : 'rgba(255,255,255,0.18)',
                    lineStyle: mitte ? LineStyle.Dotted : LineStyle.Dashed,
                })
            }
            // Fester Bereich (0–100): wenig Rand, sonst beschriftet die Achse bis 125.
            if (def.bereich && erste) erste.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.06 } })
            const band = def.band && serien[def.band.linie] ? new BandZeichnung({ chart: this.chart, serie: serien[def.band.linie], band: def.band }) : null
            const zeichnung = def.zeichner === 'momentum' && serien.w1
                ? new MomentumZeichnung({ chart: this.chart, serie: serien.w1 })
                : def.zeichner === 'vwapVector' && this.kerzenSerie
                    ? new VwapVectorZeichnung({ chart: this.chart, serie: this.kerzenSerie })
                    : null
            const titel = def.ort === 'eigen' && erste && this.titelFuer ? new FensterTitel(erste, this.titelFuer(instanz)) : null
            this.eintraege.push({ instanz, def, ausgaben, serien, werte: {}, zeichnung, titel, band })
        }
        // Das Kerzen-Pane soll den Löwenanteil behalten.
        const panes = this.chart.panes()
        if (panes.length > 1) {
            panes[0].setStretchFactor(Math.max(2, panes.length))
            for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1)
        }
    }

    abbauen() {
        for (const e of this.eintraege) {
            e.zeichnung?.abbauen()
            e.titel?.abbauen()
            e.band?.abbauen()
            for (const s of Object.values(e.serien)) {
                try { this.chart.removeSeries(s) } catch { /* Chart schon weg */ }
            }
        }
        this.eintraege = []
        this.signatur = ''
    }

    punkt(e, key, i, kerzen) {
        const wert = e.werte[key]?.[i]
        const time = this.zuLwc(kerzen[i].t)
        if (wert == null || !Number.isFinite(wert)) return { time }
        const a = e.ausgaben.find((x) => x.key === key)
        if (a?.vierFarben) return { time, value: wert, color: vierFarben(wert, e.werte[key]?.[i - 1]) }
        if (a?.art === 'histogramm' && a.vorzeichen) return { time, value: wert, color: wert >= 0 ? '#26a69a' : '#ef5350' }
        if (a?.art === 'histogramm' && key === 'hist') return { time, value: wert, color: wert >= 0 ? GRUEN : ROT }
        return { time, value: wert }
    }

    daten(kerzen) {
        this.kerzen = kerzen
        this.zeiten = kerzen.map((k) => k.t)
        for (const e of this.eintraege) {
            e.werte = rechneIndikator(e.instanz.typ, kerzen, e.instanz.params, this.extern)
            for (const [key, serie] of Object.entries(e.serien)) {
                serie.setData(kerzen.map((_, i) => this.punkt(e, key, i, kerzen)))
            }
            this.zeichnungSetzen(e)
        }
        this.farbenMelden(false)
    }

    zeichnungSetzen(e) {
        if (e.band) e.band.setze(e.werte[e.def.band.linie])
        if (e.def.zeichner === 'vwapVector') e.zeichnung?.setze(e.werte._vv, this.kerzen, saubereParams(e.instanz.typ, e.instanz.params))
        else e.zeichnung?.setze(this.extern[e.def.extern], this.zeiten, this.kerzenAbstand())
    }

    /** Vektorkerzen: Farben an das Panel geben; ohne VWAP Vector einmal null (zurück zur Vorgabe). */
    farbenMelden(nurLetzte) {
        const e = this.eintraege.find((x) => x.def.zeichner === 'vwapVector' && x.werte._vv?.stufen)
        const farben = e ? vektorFarben(e.werte._vv.stufen, saubereParams(e.instanz.typ, e.instanz.params)) : null
        if (!farben && !this.hatteFarben) return
        this.hatteFarben = !!farben
        this.faerbeKerzen(farben, nurLetzte)
    }

    kerzenAbstand() {
        const z = this.zeiten
        return z.length > 1 ? z[z.length - 1] - z[z.length - 2] : 3_600_000
    }

    /** Laufende Kerze: neu rechnen, nur die letzten beiden Punkte schreiben. */
    nachfuehren(kerzen) {
        if (!this.eintraege.length || !kerzen.length) return
        const neueKerze = kerzen.length !== this.zeiten.length
        this.kerzen = kerzen
        this.zeiten = kerzen.map((k) => k.t)
        for (const e of this.eintraege) {
            e.werte = rechneIndikator(e.instanz.typ, kerzen, e.instanz.params, this.extern)
            const n = kerzen.length
            for (const [key, serie] of Object.entries(e.serien)) {
                // Beim Wechsel auf eine neue Kerze ist die vorige gerade
                // abgeschlossen — ihr Endwert muss auch noch hinein.
                if (neueKerze && n > 1) serie.update(this.punkt(e, key, n - 2, kerzen))
                serie.update(this.punkt(e, key, n - 1, kerzen))
            }
            if (neueKerze || e.def.zeichner === 'vwapVector' || e.band) this.zeichnungSetzen(e)
        }
        this.farbenMelden(!neueKerze)
    }

    /** Werte unter dem Fadenkreuz (oder der letzten Kerze) für die Legende. */
    werteBei(t) {
        let i = this.zeiten.length - 1
        if (t != null) {
            let lo = 0, hi = this.zeiten.length - 1
            i = -1
            while (lo <= hi) {
                const m = (lo + hi) >> 1
                if (this.zeiten[m] <= t) { i = m; lo = m + 1 } else hi = m - 1
            }
        }
        const aus = {}
        for (const e of this.eintraege) {
            aus[e.instanz.id] = e.ausgaben
                .filter((a) => e.werte[a.key])
                .map((a) => {
                    const reihe = e.werte[a.key]
                    let j = i
                    // Ohne Fadenkreuz: der letzte VORHANDENE Wert. Reihen, die nur
                    // auf geschlossenen Kerzen rechnen (Momentum), haben an der
                    // laufenden Kerze keinen — die Legende zeigte dann „—".
                    if (t == null) while (j > 0 && reihe[j] == null) j--
                    return { key: a.key, farbe: e.instanz.farben?.[a.key] || a.farbe, wert: j >= 0 ? reihe[j] : null }
                })
        }
        return aus
    }
}
