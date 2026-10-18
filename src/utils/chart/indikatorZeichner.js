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
import { LineSeries, HistogramSeries, LineStyle } from 'lightweight-charts'
import { INDIKATOREN, rechneIndikator } from './indikatorRegister.js'
import { MomentumZeichnung } from './momentumZeichnung.js'

const GRUEN = 'rgba(38,166,154,0.7)'
const ROT = 'rgba(255,105,96,0.7)'

export class IndikatorZeichner {
    /**
     * @param {object} chart  Lightweight-Charts-Instanz
     * @param {function} zuLwc  ms → Sekunden
     */
    constructor(chart, zuLwc) {
        this.chart = chart
        this.zuLwc = zuLwc
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
        const sig = JSON.stringify(sichtbar.map((i) => [i.id, i.typ, i.params, i.farben]))
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
            for (const a of def.ausgaben) {
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
                serien[a.key] = a.art === 'histogramm'
                    ? this.chart.addSeries(HistogramSeries, { ...gemeinsam, color: farbe, priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } }, pane)
                    : this.chart.addSeries(LineSeries, { ...gemeinsam, color: farbe, lineWidth: a.breite || 1 }, pane)
            }
            const erste = serien[def.ausgaben.find((a) => a.art === 'linie')?.key] || Object.values(serien)[0]
            for (const marke of def.linien || []) {
                erste?.createPriceLine({ price: marke, color: 'rgba(255,255,255,0.18)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false })
            }
            const zeichnung = def.zeichner === 'momentum' && serien.w1
                ? new MomentumZeichnung({ chart: this.chart, serie: serien.w1 })
                : null
            this.eintraege.push({ instanz, def, serien, werte: {}, zeichnung })
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
        const art = e.def.ausgaben.find((a) => a.key === key)?.art
        if (art === 'histogramm' && key === 'hist') return { time, value: wert, color: wert >= 0 ? GRUEN : ROT }
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
            e.zeichnung?.setze(this.extern[e.def.extern], this.zeiten, this.kerzenAbstand())
        }
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
            if (neueKerze) e.zeichnung?.setze(this.extern[e.def.extern], this.zeiten, this.kerzenAbstand())
        }
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
            aus[e.instanz.id] = e.def.ausgaben
                .filter((a) => e.werte[a.key])
                .map((a) => ({ key: a.key, farbe: e.instanz.farben?.[a.key] || a.farbe, wert: i >= 0 ? e.werte[a.key][i] : null }))
        }
        return aus
    }
}
