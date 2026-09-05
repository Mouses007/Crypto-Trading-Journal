/**
 * Canvas-Renderer für Liquiditäts-Heatmap + Bookmap-Overlay.
 *
 * Framework-frei und ohne Vue-Reaktivität: der Hot Path liest ausschliesslich
 * TypedArrays. Gezeichnet wird auf drei Layer, weil die Auffrischraten weit
 * auseinanderliegen — eine Mausbewegung darf nie die Heatmap neu zeichnen:
 *   heat    ~2 Hz (neue Spalte / verschobenes Preisfenster)
 *   overlay bis 60 Hz (Trades, Mid-Linie, Achsen)
 *   ui      nur bei Mausbewegung (Crosshair, Tooltip)
 *
 * Kern der Heatmap ist ein Offscreen-Canvas mit exakt einem Pixel pro Zelle:
 * einmal als ImageData befüllen, dann hochskaliert blitten. Das ersetzt
 * zehntausende fillRect-Aufrufe durch einen einzigen drawImage.
 */

import { decimalsFor } from '../../shared/priceBins.js'

// Breiter als früher (66), weil die Achsenschrift von 10 auf 12 px gewachsen
// ist: „112345.67" braucht bei 12 px rund 62 px plus Innenabstand.
export const AXIS_W = 78      // Preisachse rechts
export const AXIS_H = 24      // Zeitachse unten
export const VOLUME_H = 56    // Spur mit gehandeltem Volumen je Zeitabschnitt
export const DELTA_H = 40     // Spur mit dem laufenden Kauf-/Verkaufssaldo (CVD)
// Vielfaches der ruhenden Menge, ab dem gehandeltes Volumen an einer Preisstufe
// als Absorption gilt. Bewusst grosszügig gewählt: eine normale Umsatzspitze
// an einer dünnen Zeile soll nicht schon als Wand-Absorption durchgehen.
const ABSORPTION_MULT = 3
export const PROFILE_W = 74   // Vorgabebreite der Volumenprofil-Spur
// Rasterbreite der Handelspunkte in Pixeln (über setDotStep einstellbar).
// Muss grösser sein als der Durchmesser eines typischen Punktes (~8 px),
// sonst berühren sie sich lückenlos und ergeben ein Band statt einzelner
// Blasen. Nur die wirklich grossen Punkte überlappen dann noch — was sie zu
// Recht heraushebt. Gegengemessen bei 388 px Plotbreite: 1 px ergab eine
// einzige 270 px lange Kette, 6 px noch 104 px, 11 px höchstens 17 px.
const DOT_STEP_DEFAULT = 11

const COLORS = {
    grid: 'rgba(255,255,255,0.10)',
    axisText: 'rgba(255,255,255,0.78)',
    midLine: 'rgba(255,255,255,0.75)',
    accent: '#01B4FF',
    // Handelsblasen: deckend statt additiv überblendet, dazu ein dunkler Rand.
    // Additives Blending liess überlappende Blasen zu weissem Brei verlaufen.
    buy: 'rgb(38,190,150)',          // --green
    sell: 'rgb(255,95,86)',          // --red-color
    buyEdge: 'rgba(6,60,48,0.85)',
    sellEdge: 'rgba(70,14,10,0.85)',
    gap: 'rgba(140,140,140,0.18)',
    tooltipBg: 'rgba(18,18,18,0.94)',
}

// Stützpunkte der Farbrampen (t = 0..1)
const RAMPS = {
    // Näher an Bookmaps Klassik: der Übergang nach Gelb/Rot setzt deutlich
    // früher ein, damit mittlere Liquidität nicht im Blau untergeht.
    //
    // Endet bewusst in Rot statt in Weiss. Weiss lag früher bei 1,0, also beim
    // Vierfachen des Bezugswerts — praktisch nie erreicht, und die Beschriftung
    // warb damit für eine Farbe, die man nie zu Gesicht bekam. Die frei
    // gewordenen obersten Prozente stehen jetzt für Rot-Abstufungen zur
    // Verfügung, sodass sich grosse Wände untereinander unterscheiden lassen.
    bookmap: [
        [0, 6, 14, 48], [0.18, 20, 80, 190], [0.38, 24, 190, 205],
        [0.58, 150, 230, 90], [0.74, 250, 215, 55], [0.86, 246, 150, 40],
        [1, 226, 46, 38],
    ],
    journal: [
        [0, 8, 12, 20], [0.35, 1, 90, 150], [0.7, 1, 180, 255], [1, 235, 250, 255],
    ],
    // Viridis — die Rampe, die Coinglass & Co. verwenden: dunkelviolett über
    // Blau und Grün nach Gelb. Wahrnehmungslinear, also sind Helligkeits-
    // unterschiede auch echte Mengenunterschiede.
    viridis: [
        [0, 68, 1, 84], [0.25, 59, 82, 139], [0.5, 33, 145, 140],
        [0.75, 94, 201, 98], [1, 253, 231, 37],
    ],
}

function rampColor(stops, t) {
    for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
            const [t0, r0, g0, b0] = stops[i - 1]
            const [t1, r1, g1, b1] = stops[i]
            const f = (t - t0) / (t1 - t0 || 1)
            return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f]
        }
    }
    const last = stops[stops.length - 1]
    return [last[1], last[2], last[3]]
}

/** 256-Einträge-LUT, gepackt als ABGR für direktes Schreiben in Uint32Array. */
function buildLut(rampName) {
    const stops = RAMPS[rampName] || RAMPS.bookmap
    const lut = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
        const t = i / 255
        const [r, g, b] = rampColor(stops, t)
        // schwache Liquidität bleibt weitgehend transparent
        const a = Math.round(30 + 225 * Math.pow(t, 0.6))
        lut[i] = (a << 24) | (b << 16) | (g << 8) | (r & 255)
    }
    return lut
}

export class HeatmapRenderer {
    constructor({ heat, overlay, ui }) {
        this.heatEl = heat
        this.overlayEl = overlay
        this.uiEl = ui
        this.heatCtx = heat.getContext('2d')
        this.overlayCtx = overlay.getContext('2d')
        this.uiCtx = ui.getContext('2d')

        this.cssW = 0
        this.cssH = 0
        this.plotW = 0
        this.plotH = 0
        this.profileW = 0
        this.axisW = AXIS_W
        this.axisX = 0
        this.cols = 0
        /*
         * Spalten, die rechts für das AKTUELLE Buch frei bleiben.
         *
         * Bookmap hält dort Luft und zeichnet hinein, was gerade im Buch liegt.
         * In der Historie sind dieselben Orders über die Zeitachse verschmiert
         * und von Handelsspuren überlagert; im freien Raum stehen sie als
         * klare waagerechte Linien, und man sieht auf einen Blick, wo die
         * Wände liegen.
         *
         * 0 heisst: alles wie bisher, die Gegenwart klebt am rechten Rand.
         */
        this.zukunft = 0

        this.off = document.createElement('canvas')
        this.offCtx = this.off.getContext('2d')
        this.img = null
        this.buf32 = null

        this.lut = buildLut('bookmap')
        this.ref = 1
        this.satMult = 2.5
        this.invLogMax = 1 / Math.log1p(this.satMult)
        this.cursor = null
        this.colorMode = 'auto'   // 'auto' = rollendes p95, 'fixed' = gesetzter Wert
        this.threshold = 0        // 0..0.95 — blendet schwache Liquidität ganz aus
        this.dotStep = DOT_STEP_DEFAULT
        this.profileWanted = PROFILE_W
        this.profileVisible = false
        this.profileBins = null   // Werte der Spur, für den Tooltip
        this.volumeH = 0          // Höhe der Volumen-Spur unten (0 = aus)
        this.volumeBins = null    // Werte der Säulen, für den Tooltip
        this.deltaH = 0           // Höhe der Delta-Spur (CVD) unten (0 = aus)
        this.absorptionOn = false // Preisstufen mit auffälliger Absorption markieren
        // Beschriftungen der Canvas-Texte. Der Renderer ist bewusst Vue-frei und
        // kann kein useI18n() — die Komponente reicht die übersetzten Texte
        // durch. Die Vorgaben hier sind nur ein Notnagel, falls setLabels()
        // ausbleibt, damit nie ein leeres Etikett gezeichnet wird.
        this.labels = {
            coverage: '', traded: 'traded', max: 'max', liquidity: 'Liquidity',
            toMid: '% to mid', noRecording: '—', volumePer: 'Volume / {n}',
            bought: 'Bought', sold: 'Sold', sum: 'Total', buyerShare: 'Buyer share',
        }
        this.rampName = 'bookmap'
    }

    /** Zellen unterhalb dieses Anteils der Farbskala werden nicht gezeichnet. */
    setThreshold(value) {
        this.threshold = Math.max(0, Math.min(0.95, Number(value) || 0))
    }

    /**
     * Beim Wievielfachen des Bezugswerts ('auto': rollendes 95. Perzentil) eine
     * Zelle voll gesättigt ist. Kleiner lässt Wände schneller heiss aufleuchten,
     * grösser hält die Skala zurückhaltender — der bisherige Fixwert 4 liess nur
     * die obersten ~5 % aller Mengen je Farbe zeigen.
     */
    setSaturationMult(value) {
        this.satMult = Math.max(1.2, Math.min(8, Number(value) || 2.5))
        this.invLogMax = 1 / Math.log1p(this.satMult)
    }

    /** Rasterbreite der Handelspunkte in Pixeln (1 = jede Spalte einzeln). */
    setDotStep(value) {
        this.dotStep = Math.max(1, Math.min(40, Math.round(Number(value)) || DOT_STEP_DEFAULT))
    }

    /** Übersetzte Canvas-Texte setzen (siehe this.labels). */
    setLabels(labels) {
        if (labels) Object.assign(this.labels, labels)
    }

    setRamp(name) {
        this.rampName = RAMPS[name] ? name : 'bookmap'
        this.lut = buildLut(this.rampName)
    }

    /**
     * 'auto': Farbe wird laufend auf das 95. Perzentil der sichtbaren Mengen
     * normiert — gut lesbar, aber die Helligkeit bedeutet je nach Marktlage
     * etwas anderes. 'fixed': fester Sättigungsbezug, damit Bilder über Zeit und
     * zwischen Symbolen vergleichbar bleiben.
     */
    setColorScale(mode, value) {
        this.colorMode = mode === 'fixed' ? 'fixed' : 'auto'
        if (this.colorMode === 'fixed' && value > 0) this.ref = value
    }

    /** Aktueller Normierungswert — Vorschlag für „Auto-Wert übernehmen". */
    get currentRef() {
        return this.ref
    }

    /**
     * Das Volumenprofil bekommt eine eigene Spur zwischen Heatmap und
     * Preisachse. Es über die Heatmap zu legen verdeckte ausgerechnet die
     * neuesten Spalten und liess sich kaum von Liquiditätsbändern unterscheiden.
     */
    setProfileVisible(visible) {
        this.profileVisible = !!visible
        if (this.cssW) this.resize(this.cssW, this.cssH)
    }

    /**
     * Breite der Volumenprofil-Spur in CSS-Pixeln. Ab etwa 120 px ist Platz für
     * Zahlen neben den Balken — darunter blieben sie nur ein Balkendiagramm
     * ohne Massstab.
     */
    /**
     * Spur mit gehandeltem Volumen je Zeitabschnitt unter dem Chart. Grün, wenn
     * Käufer aggressiver waren, sonst rot — daran liest man den Wechsel der
     * Initiative ab, der in den Blasen nur schwer zu sehen ist.
     */
    setVolumeBarsVisible(visible) {
        const wanted = visible ? VOLUME_H : 0
        if (this.volumeH === wanted) return
        this.volumeH = wanted
        if (this.cssW) this.resize(this.cssW, this.cssH)
    }

    /** Spur mit dem laufenden Kauf-/Verkaufssaldo (Cumulative Volume Delta). */
    setDeltaVisible(visible) {
        const wanted = visible ? DELTA_H : 0
        if (this.deltaH === wanted) return
        this.deltaH = wanted
        if (this.cssW) this.resize(this.cssW, this.cssH)
    }

    /** Preisstufen markieren, an denen deutlich mehr gehandelt als geruht wurde. */
    setAbsorptionVisible(visible) {
        this.absorptionOn = !!visible
    }

    setProfileWidth(px) {
        this.profileWanted = Math.max(40, Math.min(320, Math.round(Number(px)) || PROFILE_W))
        if (!this.profileVisible) return
        if (this.cssW) this.resize(this.cssW, this.cssH)
    }

    /**
     * @param {number} cssW  Breite in CSS-Pixeln
     * @param {number} cssH  Höhe in CSS-Pixeln
     */
    resize(cssW, cssH) {
        // Über 2 lohnt die DPR-Auflösung bei einer Heatmap nicht mehr
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        this.cssW = cssW
        this.cssH = cssH
        // Auf dem Handy sind Achse und Profilspur zusammen breiter als die
        // Heatmap selbst. Beide werden deshalb an der verfügbaren Breite
        // gemessen statt an festen Vorgaben — die Spalten bleiben lesbar.
        this.axisW = cssW < 520 ? 64 : AXIS_W
        this.profileW = this.profileVisible
            ? Math.max(36, Math.min(this.profileWanted, Math.floor(cssW * 0.22)))
            : 0
        this.plotW = Math.max(50, Math.floor(cssW - this.axisW - this.profileW))
        this.plotH = Math.max(50, Math.floor(cssH - AXIS_H - this.volumeH - this.deltaH))
        this.axisX = this.plotW + this.profileW
        this.cols = this.plotW
        this._klemmeZukunft()

        for (const el of [this.heatEl, this.overlayEl, this.uiEl]) {
            el.width = Math.floor(cssW * dpr)
            el.height = Math.floor(cssH * dpr)
            el.style.width = cssW + 'px'
            el.style.height = cssH + 'px'
            // setTransform statt scale — scale würde sich bei jedem Resize aufaddieren
            el.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0)
        }
    }

    _ensureOffscreen(rowsView) {
        if (this.off.width === this.cols && this.off.height === rowsView && this.buf32) return
        this.off.width = this.cols
        this.off.height = rowsView
        this.img = this.offCtx.createImageData(this.cols, rowsView)
        this.buf32 = new Uint32Array(this.img.data.buffer)
    }

    /**
     * Normierung auf das 95. Perzentil der sichtbaren Mengen. Ohne Log-Stauchung
     * wäre alles ausser den grössten Wänden schwarz — Orderbuch-Liquidität
     * unterscheidet sich um Grössenordnungen.
     */
    /**
     * Breite, in der HISTORIE gezeichnet wird. Alles rechts davon gehört dem
     * aktuellen Buch.
     */
    get histCols() { return Math.max(1, this.cols - this.zukunft) }

    /** Höchstens ein Drittel der Fläche; darunter bliebe von der Historie zu wenig. */
    _klemmeZukunft() {
        const max = Math.floor(this.cols / 3)
        this.zukunft = Math.max(0, Math.min(max, Math.round(this.zukunft)))
    }

    /**
     * Wie viele Spalten rechts freibleiben sollen.
     * @returns {number} der tatsächlich gesetzte Wert (geklemmt)
     */
    setZukunft(spalten) {
        this.zukunft = Number(spalten) || 0
        this._klemmeZukunft()
        return this.zukunft
    }

    recalcNorm(ring, view, anchor) {
        if (!ring || !ring.count || this.colorMode === 'fixed') return
        const head = anchor ?? ring.head
        const sample = []
        const maxCols = Math.min(this.histCols, ring.count)
        for (let x = 0; x < maxCols; x += 7) {
            const col = ring.colFrom(head, x)
            for (let abs = view.lo; abs < view.hi; abs += 3) {
                const v = ring.valueAt(col, abs)
                if (v > 0) sample.push(v)
            }
        }
        if (!sample.length) return
        sample.sort((a, b) => a - b)
        this.ref = Math.max(sample[Math.floor(sample.length * 0.95)] || 0, 1e-9)
    }

    drawHeat(ring, view, anchor, jetztAnchor) {
        const ctx = this.heatCtx
        ctx.clearRect(0, 0, this.cssW, this.cssH)
        if (!ring || !ring.count) return
        const head = anchor ?? ring.head

        const rowsView = Math.max(1, view.hi - view.lo)
        this._ensureOffscreen(rowsView)
        const buf = this.buf32
        buf.fill(0)

        const lut = this.lut
        const ref = this.ref
        const invLogMax = this.invLogMax
        const threshold = this.threshold
        const histCols = this.histCols
        const visible = Math.min(histCols, ring.count)

        for (let x = 0; x < visible; x++) {
            const col = ring.colFrom(head, visible - 1 - x)
            const base = ring.base[col]
            const offset = col * ring.rows
            const px = histCols - visible + x
            for (let y = 0; y < rowsView; y++) {
                const r = (view.hi - 1 - y) - base
                if (r < 0 || r >= ring.rows) continue
                const v = ring.data[offset + r]
                if (v <= 0) continue
                const t = Math.log1p(v / ref) * invLogMax
                if (t < threshold) continue     // schwache Liquidität ausblenden
                buf[y * this.cols + px] = lut[t >= 1 ? 255 : (t * 255) | 0]
            }
        }

        /*
         * Das freie Feld rechts: die AKTUELLE Buchspalte, über die ganze
         * Breite wiederholt. So werden aus Punkten waagerechte Linien — man
         * sieht, wo die Wände liegen, statt sie aus der verschmierten
         * Historie herauslesen zu müssen.
         *
         * Genommen wird `jetztAnchor`, NICHT `anchor`: Blättert man in der
         * Historie zurück, soll rechts weiter das jüngste bekannte Buch
         * stehen. Sonst hätte man eine zweite Historie neben der Historie,
         * und die Linien beantworteten die Frage nicht mehr, für die sie da
         * sind („wo liegt jetzt Widerstand").
         */
        if (this.zukunft > 0) {
            const jetzt = jetztAnchor ?? head
            const col = ring.colFrom(jetzt, 0)
            const base = ring.base[col]
            const offset = col * ring.rows
            for (let y = 0; y < rowsView; y++) {
                const r = (view.hi - 1 - y) - base
                if (r < 0 || r >= ring.rows) continue
                const v = ring.data[offset + r]
                if (v <= 0) continue
                const t = Math.log1p(v / ref) * invLogMax
                if (t < threshold) continue
                const farbe = lut[t >= 1 ? 255 : (t * 255) | 0]
                const zeile = y * this.cols
                for (let px = histCols; px < this.cols; px++) buf[zeile + px] = farbe
            }
        }

        this.offCtx.putImageData(this.img, 0, 0)
        ctx.imageSmoothingEnabled = false   // harte Zellkanten statt Weichzeichner
        ctx.drawImage(this.off, 0, 0, this.cols, rowsView, 0, 0, this.plotW, this.plotH)
    }

    /**
     * @param {object} p
     * @param {HeatmapRing} p.ring
     * @param {TradeRing} p.trades
     * @param {{lo:number,hi:number}} p.view
     * @param {number} p.frameMs
     * @param {number} p.bucketSize
     * @param {function} p.formatTime  (ms) => string
     * @param {boolean} [p.showProfile]
     */
    drawOverlay({ ring, trades, liquidations, view, frameMs, bucketSize, formatTime, showProfile, showLiquidations, coverage, anchor }) {
        const ctx = this.overlayCtx
        ctx.clearRect(0, 0, this.cssW, this.cssH)
        if (!ring || !ring.count) return

        const head = anchor ?? ring.head
        const rowsView = Math.max(1, view.hi - view.lo)
        const rowH = this.plotH / rowsView
        // Alles Gezeichnete bezieht sich auf die HISTORIE; das freie Feld
        // rechts gehört dem aktuellen Buch und bekommt weder Handelspunkte
        // noch Mid-Linie — dort ist keine Zeit vergangen.
        const histCols = this.histCols
        const visible = Math.min(histCols, ring.count)
        const tRight = ring.ts[ring.colFrom(head, 0)]
        // Rechte Zeitgrenze: bei eingefrorener Ansicht laufen die Trade-Puffer
        // weiter — Ereignisse NACH der letzten sichtbaren Spalte gehören nicht
        // ins Bild, sonst sammeln sie sich am rechten Rand einer Vergangenheit,
        // zu der sie nie gehörten. (+frameMs: die letzte Spalte deckt ihr
        // volles Zeitfenster ab.)
        const tMax = tRight + frameMs

        // Zelle für Bucket b belegt [ (hi-1-b)*rowH , (hi-b)*rowH ) — die -0.5
        // trifft deren Mitte, sonst läge die Mid-Linie eine halbe Zelle daneben.
        const yFor = (price) => (view.hi - price / bucketSize - 0.5) * rowH

        // Zeitstempel der sichtbaren Spalten, aufsteigend (links → rechts).
        //
        // Warum nicht einfach linear aus tRight rechnen: die Heatmap zeichnet
        // Spalten nach INDEX, eine Spalte ist immer ein Pixel. Die Zeitachse
        // dahinter ist aber NICHT gleichmässig — pausiert der Feed (Tab im
        // Hintergrund), werden für diese Zeit gar keine Spalten geschrieben,
        // und der Zeitstempel springt zwischen zwei benachbarten Spalten um
        // Minuten. Eine lineare Umrechnung schob die Handelspunkte dann um
        // genau diese Differenz nach links, bei längerer Pause komplett aus
        // dem Bild — sichtbar als „Heatmap da, aber keine Blasen mehr".
        const colTs = new Float64Array(visible)
        for (let x = 0; x < visible; x++) {
            colTs[x] = ring.ts[ring.colFrom(head, visible - 1 - x)]
        }

        /** Pixelspalte für einen Zeitpunkt — über die echten Spaltenzeiten. */
        const xForTs = (ts) => {
            let lo = 0, hi = visible - 1
            while (lo < hi) {
                const mid = (lo + hi) >> 1
                if (colTs[mid] < ts) lo = mid + 1
                else hi = mid
            }
            // Die gefundene Spalte ist die erste, die nicht vor dem Trade liegt
            return histCols - visible + lo
        }

        // Lücken (Tab war im Hintergrund) sichtbar machen
        for (let x = 0; x < visible; x++) {
            const col = ring.colFrom(head, visible - 1 - x)
            if (!ring.flags[col]) continue
            ctx.fillStyle = COLORS.gap
            ctx.fillRect(histCols - visible + x, 0, 1, this.plotH)
        }

        // Mid-Preis-Linie
        ctx.beginPath()
        ctx.strokeStyle = COLORS.midLine
        ctx.lineWidth = 1
        let started = false
        for (let x = 0; x < visible; x++) {
            const col = ring.colFrom(head, visible - 1 - x)
            const mid = ring.mid[col]
            if (!mid) { started = false; continue }
            const px = histCols - visible + x + 0.5
            const py = yFor(mid)
            if (!started) { ctx.moveTo(px, py); started = true }
            else ctx.lineTo(px, py)
        }
        ctx.stroke()

        // Trades: pro Zelle (Zeitfenster × Preis-Bucket) zu EINEM Punkt
        // zusammenfassen. Einzelne Fills übereinander zu zeichnen ergäbe nur
        // einen weissen Schlauch — aggregiert entstehen unterscheidbare Punkte,
        // deren Fläche dem tatsächlich gehandelten Volumen entspricht.
        //
        // Entscheidend ist die Breite des Zeitfensters: eine Spalte ist genau
        // ein Pixel breit, ein Punkt aber bis zu 28 Pixel. Mit einem Punkt je
        // Spalte überlappen sie deshalb zwangsläufig zu einem durchgehenden
        // Band — gemessen 270 Pixel ununterbrochene Kette. Über dotStep Pixel
        // gebündelt stehen die Punkte auseinander und werden vergleichbar.
        // Die Zeitauflösung der Heatmap dahinter bleibt davon unberührt.
        // Linke Grenze aus der ältesten sichtbaren Spalte statt linear
        // gerechnet — sonst würden nach einer Feed-Pause Trades verworfen,
        // deren Spalte noch im Bild steht.
        const tLeft = colTs[0] || (tRight - visible * frameMs)
        const dotStep = this.dotStep
        const cells = new Map()
        for (let i = 0; i < trades.count; i++) {
            const idx = trades.idxFromEnd(i)
            const ts = trades.ts[idx]
            if (ts >= tMax) continue      // neuer als die (ggf. eingefrorene) Ansicht
            if (ts < tLeft) break
            const x = Math.round(xForTs(ts) / dotStep) * dotStep
            if (x < 0) continue
            const bucket = Math.round(trades.price[idx] / bucketSize)
            const key = x * 1e7 + (bucket & 0xffffff)
            let cell = cells.get(key)
            if (!cell) { cell = { x, bucket, buy: 0, sell: 0 }; cells.set(key, cell) }
            if (trades.buy[idx]) cell.buy += trades.qty[idx]
            else cell.sell += trades.qty[idx]
        }

        if (cells.size) {
            // Radius auf das 75. Perzentil der Zellsummen normieren, damit sich
            // die Punkte untereinander unterscheiden statt am Anschlag zu kleben.
            //
            // Weil die Normierung RELATIV ist, ändert stärkeres Zusammenfassen
            // für sich genommen gar nichts an der Grösse: alle Zellsummen wachsen
            // mit, der Bezugswert wächst mit, der Radius bleibt. Deshalb hängt
            // der Massstab am Raster — nur so macht der Schieber die Blasen auch
            // wirklich fetter und nicht bloss weiter auseinander.
            const totals = [...cells.values()].map(c => c.buy + c.sell).sort((a, b) => a - b)
            const ref = Math.max(totals[Math.floor(totals.length * 0.75)] || 0, 1e-9)
            const scale = Math.max(3, dotStep * 0.34)   // typische Blase ~ ein Drittel des Rasters
            const cap = Math.max(9, dotStep * 0.75)     // Grossorders bleiben gedeckelt
            // Deckend mit dunklem Rand statt additiv: beim Überblenden liefen
            // sich überlappende Blasen zu weissem Brei zusammen, und die Farbe
            // sagte nichts mehr über die Richtung. Grosse zuerst, damit kleine
            // Blasen nicht hinter grossen verschwinden.
            ctx.lineWidth = 1
            const sortiert = [...cells.values()].sort(
                (a, b) => (b.buy + b.sell) - (a.buy + a.sell))
            for (const cell of sortiert) {
                const total = cell.buy + cell.sell
                const y = yFor(cell.bucket * bucketSize)
                if (y < -10 || y > this.plotH + 10) continue
                const r = Math.max(1.5, Math.min(cap, Math.sqrt(total / ref) * scale))
                const kauf = cell.buy >= cell.sell
                ctx.beginPath()
                ctx.arc(cell.x, y, r, 0, Math.PI * 2)
                ctx.fillStyle = kauf ? COLORS.buy : COLORS.sell
                ctx.fill()
                if (r >= 3) {
                    ctx.strokeStyle = kauf ? COLORS.buyEdge : COLORS.sellEdge
                    ctx.stroke()
                }
            }
        }

        if (coverage) this._drawCoverage(ctx, coverage, yFor)
        if (showLiquidations && liquidations) this._drawLiquidations(ctx, liquidations, { yFor, xForTs, tLeft, tMax })
        if (showProfile) this._drawVolumeProfile(ctx, trades, { yFor, tLeft, tMax })
        if (this.volumeH) this._drawVolumeBars(ctx, trades, { xForTs, tLeft, tMax, dotStep })
        if (this.deltaH) this._drawDelta(ctx, trades, { xForTs, tLeft, tMax })
        // Absorption ist ein lokales, kein Gesamtfenster-Phänomen — nur die
        // letzte Minute (oder das ganze Fenster, falls kürzer) zählt.
        if (this.absorptionOn) {
            this._drawAbsorption(ctx, ring, {
                view, bucketSize, yFor, trades,
                windowMs: Math.min(60000, visible * frameMs), tMax, head,
            })
        }
        this._drawLegend(ctx)

        this._drawAxes(ctx, { ring, view, bucketSize, rowH, visible, frameMs, tRight, formatTime, head })
    }

    /**
     * Markiert, wie weit der Orderbuch-Snapshot gereicht hat.
     *
     * Binance liefert höchstens 1000 Preisstufen je Seite; bei einem dichten
     * Buch sind das nur wenige Zehntel Prozent um den Mittelkurs. Ausserhalb
     * dieser Linien stammt alles ausschliesslich aus laufenden Änderungen —
     * echte Werte, aber unvollständig: Orders, die seit dem Sync unverändert
     * liegen, fehlen dort. Die Linien sagen also „ab hier dünner werdend".
     */
    _drawCoverage(ctx, coverage, yFor) {
        if (!coverage.lo || !coverage.hi) return
        ctx.save()
        ctx.setLineDash([3, 4])
        ctx.strokeStyle = 'rgba(255,255,255,0.34)'
        ctx.lineWidth = 1
        let beschriftet = false
        for (const preis of [coverage.hi, coverage.lo]) {
            const y = yFor(preis)
            if (y < 6 || y > this.plotH - 4) continue
            ctx.beginPath()
            ctx.moveTo(0, y + 0.5)
            ctx.lineTo(this.plotW, y + 0.5)
            ctx.stroke()
            if (beschriftet) continue

            // Die Beschriftung liegt über der Heatmap und war ohne Unterlage
            // je nach Untergrund kaum zu lesen — dunkles Plättchen dahinter.
            ctx.setLineDash([])
            ctx.font = '12px system-ui, sans-serif'
            ctx.textAlign = 'left'
            ctx.textBaseline = 'bottom'
            const text = this.labels.coverage
            const breite = ctx.measureText(text).width
            ctx.fillStyle = 'rgba(12,12,12,0.82)'
            ctx.fillRect(4, y - 16, breite + 10, 15)
            ctx.fillStyle = 'rgba(255,255,255,0.82)'
            ctx.fillText(text, 9, y - 3)
            ctx.setLineDash([3, 4])
            beschriftet = true
        }
        ctx.restore()
    }

    /**
     * Zwangsliquidationen als Rauten mit heller Kontur — bewusst anders geformt
     * als die runden Trade-Punkte, damit man sie auch in einem Cluster erkennt.
     * `buy` = eine Short-Position wurde liquidiert (Kauf schliesst sie).
     */
    _drawLiquidations(ctx, liquidations, { yFor, xForTs, tLeft, tMax }) {
        if (!liquidations.count) return
        const ref = liquidations.quantile(0.9) || 1
        for (let i = 0; i < liquidations.count; i++) {
            const idx = liquidations.idxFromEnd(i)
            const ts = liquidations.ts[idx]
            if (ts >= tMax) continue
            if (ts < tLeft) break
            const x = xForTs(ts)
            const y = yFor(liquidations.price[idx])
            if (x < 0 || y < -10 || y > this.plotH + 10) continue
            const r = Math.max(4, Math.min(16, Math.sqrt(liquidations.qty[idx] / ref) * 6))
            ctx.beginPath()
            ctx.moveTo(x, y - r)
            ctx.lineTo(x + r, y)
            ctx.lineTo(x, y + r)
            ctx.lineTo(x - r, y)
            ctx.closePath()
            // Short-Liquidation = Kaufdruck (grün), Long-Liquidation = Verkaufsdruck (rot)
            ctx.fillStyle = liquidations.buy[idx] ? 'rgba(38,166,154,0.75)' : 'rgba(255,105,96,0.75)'
            ctx.fill()
            ctx.strokeStyle = 'rgba(255,255,255,0.9)'
            ctx.lineWidth = 1
            ctx.stroke()
        }
    }

    /**
     * Farbskala unten links: ohne sie sagt die Helligkeit nichts über die Menge.
     * Zeigt zusätzlich, wo die Ausblend-Schwelle liegt.
     */
    _drawLegend(ctx) {
        const w = 11
        const h = Math.min(110, this.plotH * 0.4)
        const x = 10
        const y = this.plotH - h - 26

        for (let i = 0; i < h; i++) {
            const t = 1 - i / (h - 1)
            const [r, g, b] = rampColor(RAMPS[this.rampName], t)
            ctx.fillStyle = t < this.threshold
                ? 'rgba(255,255,255,0.06)'          // ausgeblendeter Bereich
                : `rgb(${r | 0},${g | 0},${b | 0})`
            ctx.fillRect(x, y + i, w, 1)
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'
        ctx.lineWidth = 1
        ctx.strokeRect(x + 0.5, y + 0.5, w, h)

        ctx.font = '11px system-ui, sans-serif'
        ctx.fillStyle = COLORS.axisText
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        // Die Farbe sättigt bei 4× dem Bezugswert (siehe invLogMax)
        ctx.fillText(formatQty(this.ref * 4), x + w + 4, y + 4)
        ctx.fillText(formatQty(this.ref), x + w + 4, y + h * 0.63)
        ctx.fillText('0', x + w + 4, y + h - 3)
        if (this.threshold > 0) {
            const ty = y + (1 - this.threshold) * h
            ctx.strokeStyle = '#ffc107'
            ctx.beginPath()
            ctx.moveTo(x - 3, ty + 0.5)
            ctx.lineTo(x + w + 2, ty + 0.5)
            ctx.stroke()
        }
    }

    _drawVolumeProfile(ctx, trades, { yFor, tLeft, tMax }) {
        if (!this.profileW) return
        const width = this.profileW - 8
        const x0 = this.plotW + 4
        const bins = 60

        // Eigener Hintergrund + Trennlinie, damit die Spur nicht als
        // Fortsetzung der Heatmap gelesen wird
        ctx.fillStyle = 'rgba(0,0,0,0.45)'
        ctx.fillRect(this.plotW, 0, this.profileW, this.plotH)
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'
        ctx.beginPath()
        ctx.moveTo(this.plotW + 0.5, 0)
        ctx.lineTo(this.plotW + 0.5, this.plotH)
        ctx.stroke()
        const buy = new Float64Array(bins)
        const sell = new Float64Array(bins)
        let max = 0
        for (let i = 0; i < trades.count; i++) {
            const idx = trades.idxFromEnd(i)
            if (trades.ts[idx] >= tMax) continue
            if (trades.ts[idx] < tLeft) break
            const y = yFor(trades.price[idx])
            if (y < 0 || y > this.plotH) continue
            const bin = Math.min(bins - 1, Math.floor((y / this.plotH) * bins))
            if (trades.buy[idx]) buy[bin] += trades.qty[idx]
            else sell[bin] += trades.qty[idx]
            max = Math.max(max, buy[bin], sell[bin])
        }
        if (!max) return
        const binH = this.plotH / bins

        // Bewusst KEINE Dauerbeschriftung: bei sechzig Zeilen überschreiben sich
        // die Zahlen gegenseitig, und ohne Einheit sagen sie ohnehin wenig. Die
        // Werte wandern in den Tooltip — dort ist Platz für Menge UND Gegenwert.
        this.profileBins = { buy, sell, bins, max }
        const balkenW = width

        for (let b = 0; b < bins; b++) {
            const y = b * binH
            if (buy[b] > 0) {
                ctx.fillStyle = COLORS.buy
                ctx.fillRect(x0, y + binH * 0.15, (buy[b] / max) * balkenW, binH * 0.35)
            }
            if (sell[b] > 0) {
                ctx.fillStyle = COLORS.sell
                ctx.fillRect(x0, y + binH * 0.55, (sell[b] / max) * balkenW, binH * 0.35)
            }
        }
        // Beschriftung, damit klar ist, dass hier gehandeltes Volumen steht —
        // nicht ruhende Liquidität wie in der Heatmap
        ctx.font = '11px system-ui, sans-serif'
        ctx.fillStyle = COLORS.axisText
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(`${this.labels.traded} · ${this.labels.max} ${formatQty(max)}`, this.plotW + 4, 4)
    }

    _drawAxes(ctx, { ring, view, bucketSize, rowH, visible, frameMs, tRight, formatTime, head }) {
        const decimals = decimalsFor(bucketSize)
        ctx.font = '12px system-ui, sans-serif'
        ctx.textBaseline = 'middle'

        // Preisachse rechts
        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.fillRect(this.axisX, 0, this.axisW, this.plotH)
        const targetLines = Math.max(2, Math.floor(this.plotH / 46))
        const step = Math.max(1, Math.round((view.hi - view.lo) / targetLines))
        ctx.textAlign = 'left'
        for (let abs = Math.ceil(view.lo / step) * step; abs < view.hi; abs += step) {
            const y = (view.hi - abs - 0.5) * rowH
            if (y < 8 || y > this.plotH - 4) continue
            ctx.strokeStyle = COLORS.grid
            ctx.beginPath()
            ctx.moveTo(0, y + 0.5)
            ctx.lineTo(this.plotW, y + 0.5)
            ctx.stroke()
            ctx.fillStyle = COLORS.axisText
            ctx.fillText((abs * bucketSize).toFixed(decimals), this.axisX + 5, y)
        }

        // aktueller Mid als Badge
        const mid = ring.mid[ring.colFrom(head, 0)]
        if (mid) {
            const y = (view.hi - mid / bucketSize - 0.5) * rowH
            if (y > 0 && y < this.plotH) {
                ctx.fillStyle = COLORS.accent
                ctx.fillRect(this.axisX, y - 8, this.axisW, 16)
                ctx.fillStyle = '#001018'
                ctx.fillText(mid.toFixed(decimals), this.axisX + 5, y)
            }
        }

        // Zeitachse unten
        ctx.fillStyle = COLORS.axisText
        ctx.textAlign = 'center'
        const labelEvery = Math.max(60, Math.floor(this.plotW / 8))
        for (let x = this.histCols - 1; x > this.histCols - visible; x -= labelEvery) {
            // Zeitstempel der Spalte lesen statt linear hochrechnen — nach einer
            // Feed-Pause fehlen Spalten, die Achse würde sonst eine gleichmässige
            // Zeit vortäuschen, die es nie gab.
            const ts = ring.ts[ring.colFrom(head, this.histCols - 1 - x)] || tRight
            ctx.fillText(formatTime(ts), x, this.plotH + this.volumeH + this.deltaH + AXIS_H / 2)
        }

        /*
         * Grenze zum freien Feld. Ohne sie liest man die Linien rechts als
         * Fortsetzung der Zeitachse, also als Messung einer Zukunft, die es
         * nicht gibt — die Achse behauptete sonst etwas, das nirgends steht.
         */
        if (this.zukunft > 0) {
            ctx.save()
            ctx.strokeStyle = 'rgba(255,255,255,0.35)'
            ctx.setLineDash([2, 3])
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(this.histCols + 0.5, 0)
            ctx.lineTo(this.histCols + 0.5, this.plotH)
            ctx.stroke()
            ctx.setLineDash([])
            ctx.fillStyle = 'rgba(255,255,255,0.55)'
            ctx.textAlign = 'left'
            ctx.font = '11px system-ui, sans-serif'
            ctx.fillText('Buch jetzt', this.histCols + 4, this.plotH + this.volumeH + this.deltaH + AXIS_H / 2)
            ctx.restore()
        }
    }

    /** Crosshair + Tooltip; `cursor` = {x, y} in CSS-Pixeln oder null. */
    drawUi(cursor, { ring, view, bucketSize, frameMs, formatTime, anchor, baseLabel }) {
        const ctx = this.uiCtx
        ctx.clearRect(0, 0, this.cssW, this.cssH)
        if (!cursor || !ring || !ring.count) return
        const { x, y } = cursor

        // Zeiger über den Volumen-Säulen: eigener Tooltip mit den Mengen dieses
        // Zeitabschnitts. Muss VOR der plotH-Prüfung stehen, die Spur liegt
        // unterhalb des Charts.
        if (this.volumeH && y > this.plotH && y <= this.plotH + this.volumeH
            && x >= 0 && x <= this.plotW) {
            this._drawVolumeTooltip(ctx, x, y, { ring, anchor, baseLabel, formatTime })
            return
        }
        if (y < 0 || y > this.plotH) return

        const head = anchor ?? ring.head
        const rowsView = Math.max(1, view.hi - view.lo)
        const rowH = this.plotH / rowsView

        // Zeiger über der Spur „gehandelt": eigener Tooltip mit den Mengen
        // dieser Zeile. Das ersetzt die früheren Dauerzahlen — hier ist Platz
        // für Einheit und Gegenwert, statt nackter Ziffern im Balken.
        if (this.profileW && x > this.plotW && x <= this.plotW + this.profileW) {
            this._drawProfileTooltip(ctx, x, y, { ring, head, view, bucketSize, baseLabel })
            return
        }
        if (x < 0 || x > this.plotW) return
        const absBucket = Math.round(view.hi - 0.5 - y / rowH)
        const price = absBucket * bucketSize
        const histCols = this.histCols
        const visible = Math.min(histCols, ring.count)
        /*
         * Im freien Feld rechts steht das aktuelle Buch, dort ist keine Zeit
         * vergangen — also wird von dort auch die JÜNGSTE Spalte gelesen
         * (colFromRight 0) statt eine negative, die es nicht gibt.
         */
        const imFeld = x >= histCols
        const colFromRight = imFeld ? 0 : Math.round(histCols - 1 - x)
        // Links des aufgezeichneten Bereichs gibt es schlicht nichts. Den Index
        // dorthin zu klemmen zeigte die Werte der ältesten Spalte — also Zahlen,
        // die zu einem ganz anderen Zeitpunkt gehören.
        const hasData = colFromRight >= 0 && colFromRight < visible
        const col = hasData ? ring.colFrom(head, colFromRight) : -1
        const qty = hasData ? ring.valueAt(col, absBucket) : 0
        const mid = hasData ? (ring.mid[col] || 0) : 0
        const decimals = decimalsFor(bucketSize)

        ctx.setLineDash([3, 3])
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, y + 0.5); ctx.lineTo(this.plotW, y + 0.5)
        ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, this.plotH)
        ctx.stroke()
        ctx.setLineDash([])

        const lines = hasData
            ? [
                price.toFixed(decimals),
                `${this.labels.liquidity} ${qty ? formatQty(qty) : '—'}`,
                mid ? `${(((price - mid) / mid) * 100).toFixed(2)} ${this.labels.toMid}` : '',
                formatTime(ring.ts[col]),
            ].filter(Boolean)
            : [price.toFixed(decimals), this.labels.noRecording]

        ctx.font = '12px system-ui, sans-serif'
        const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14
        const boxH = lines.length * 15 + 8
        const bx = Math.min(x + 12, this.plotW - boxW)
        const by = Math.min(y + 12, this.plotH - boxH)
        ctx.fillStyle = COLORS.tooltipBg
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect(bx, by, boxW, boxH)
        ctx.strokeRect(bx + 0.5, by + 0.5, boxW, boxH)
        ctx.fillStyle = 'rgba(255,255,255,0.87)'
        ctx.textAlign = 'left'
        lines.forEach((line, i) => ctx.fillText(line, bx + 7, by + 11 + i * 13))
    }

    /**
     * Volumen je Zeitabschnitt als Säulen unter dem Chart. Die Farbe folgt der
     * Seite mit dem Übergewicht: grün = Käufer waren die Aggressoren, rot =
     * Verkäufer. Der Umschlag von grün auf rot ist genau das, was man in
     * Bookmap als Wechsel der Initiative liest.
     */
    _drawVolumeBars(ctx, trades, { xForTs, tLeft, tMax, dotStep }) {
        const y0 = this.plotH
        const h = this.volumeH

        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.fillRect(0, y0, this.plotW, h)
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'
        ctx.beginPath()
        ctx.moveTo(0, y0 + 0.5); ctx.lineTo(this.plotW, y0 + 0.5)
        ctx.stroke()

        // Dieselbe Rasterbreite wie die Handelspunkte, damit Säule und Blase
        // denselben Zeitabschnitt meinen — sonst liest man sie gegeneinander.
        const step = Math.max(2, dotStep)
        const bins = new Map()
        let max = 0
        for (let i = 0; i < trades.count; i++) {
            const idx = trades.idxFromEnd(i)
            const ts = trades.ts[idx]
            if (ts >= tMax) continue
            if (ts < tLeft) break
            const x = Math.round(xForTs(ts) / step) * step
            if (x < 0) continue
            let bin = bins.get(x)
            if (!bin) bins.set(x, bin = { buy: 0, sell: 0 })
            if (trades.buy[idx]) bin.buy += trades.qty[idx]
            else bin.sell += trades.qty[idx]
            max = Math.max(max, bin.buy + bin.sell)
        }
        if (!max) return
        this.volumeBins = { bins, max, step }

        const breite = Math.max(1, step - 1)
        for (const [x, bin] of bins) {
            const total = bin.buy + bin.sell
            const bh = Math.max(1, (total / max) * (h - 12))
            ctx.fillStyle = bin.buy >= bin.sell ? COLORS.buy : COLORS.sell
            ctx.fillRect(x - breite / 2, y0 + h - bh, breite, bh)
        }

        ctx.font = '11px system-ui, sans-serif'
        ctx.fillStyle = COLORS.axisText
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(`${this.labels.volumePer.replace('{n}', step)} · ${this.labels.max} ${formatQty(max)}`, 4, y0 + 3)
    }

    /**
     * Cumulative Volume Delta: laufende Summe aus Kauf- minus Verkaufsmenge
     * über die sichtbare Breite. Pro Bildschirmspalte einzeln aufsummiert
     * (feiner als das dotStep-Raster der Blasen) — die Linie soll auf jede
     * einzelne Ausführung reagieren, nicht erst auf ein gebündeltes Fenster.
     */
    _drawDelta(ctx, trades, { xForTs, tLeft, tMax }) {
        const y0 = this.plotH + this.volumeH
        const h = this.deltaH

        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.fillRect(0, y0, this.plotW, h)
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'
        ctx.beginPath()
        ctx.moveTo(0, y0 + 0.5); ctx.lineTo(this.plotW, y0 + 0.5)
        ctx.stroke()

        const perCol = new Float64Array(this.plotW)
        for (let i = 0; i < trades.count; i++) {
            const idx = trades.idxFromEnd(i)
            const ts = trades.ts[idx]
            if (ts >= tMax) continue
            if (ts < tLeft) break
            const x = Math.min(this.plotW - 1, Math.max(0, Math.round(xForTs(ts))))
            perCol[x] += trades.buy[idx] ? trades.qty[idx] : -trades.qty[idx]
        }
        const cum = new Float64Array(this.plotW)
        let running = 0
        let min = 0, max = 0
        for (let x = 0; x < this.plotW; x++) {
            running += perCol[x]
            cum[x] = running
            if (running < min) min = running
            if (running > max) max = running
        }
        const span = Math.max(max - min, 1e-9)
        const yFor = (v) => y0 + h - ((v - min) / span) * (h - 6) - 3

        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.beginPath()
        ctx.moveTo(0, yFor(0) + 0.5); ctx.lineTo(this.plotW, yFor(0) + 0.5)
        ctx.stroke()

        ctx.beginPath()
        ctx.strokeStyle = running >= 0 ? COLORS.buy : COLORS.sell
        ctx.lineWidth = 1.5
        for (let x = 0; x < this.plotW; x++) {
            const py = yFor(cum[x])
            if (x === 0) ctx.moveTo(x + 0.5, py)
            else ctx.lineTo(x + 0.5, py)
        }
        ctx.stroke()

        const sign = running < 0 ? '-' : '+'
        ctx.font = '11px system-ui, sans-serif'
        ctx.fillStyle = COLORS.axisText
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(`Δ ${sign}${formatQty(Math.abs(running))}`, 4, y0 + 3)
    }

    /**
     * Markiert Preisstufen, an denen im letzten kurzen Fenster deutlich mehr
     * gehandelt wurde als die Heatmap an ruhender Menge zeigt — ein Hinweis
     * auf eine versteckte grosse (Iceberg-)Order, die die Aufträge absorbiert.
     * Der Mindest-Bezug auf `this.ref` (statt einer festen Zahl) macht die
     * Schwelle automatisch symbolabhängig, ohne einen weiteren Regler zu
     * brauchen.
     */
    _drawAbsorption(ctx, ring, { view, bucketSize, yFor, trades, windowMs, tMax, head }) {
        const rowsView = view.hi - view.lo
        if (rowsView <= 0 || rowsView > 4000) return
        const traded = new Float64Array(rowsView)
        const tFrom = tMax - windowMs
        for (let i = 0; i < trades.count; i++) {
            const idx = trades.idxFromEnd(i)
            const ts = trades.ts[idx]
            if (ts >= tMax) continue
            if (ts < tFrom) break
            const bucket = Math.round(trades.price[idx] / bucketSize)
            const row = bucket - view.lo
            if (row < 0 || row >= rowsView) continue
            traded[row] += trades.qty[idx]
        }

        const newestCol = ring.colFrom(head, 0)
        const minRuhend = this.ref * 0.15
        let beschriftet = false
        for (let row = 0; row < rowsView; row++) {
            const gehandelt = traded[row]
            if (!gehandelt) continue
            const bucket = view.lo + row
            const ruhend = ring.valueAt(newestCol, bucket)
            if (ruhend < minRuhend) continue
            if (gehandelt < ABSORPTION_MULT * ruhend) continue
            const y = yFor(bucket * bucketSize)
            if (y < 4 || y > this.plotH - 4) continue

            ctx.save()
            ctx.setLineDash([2, 3])
            ctx.strokeStyle = 'rgba(255,193,7,0.85)'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.moveTo(0, y + 0.5); ctx.lineTo(this.plotW, y + 0.5)
            ctx.stroke()
            ctx.restore()

            if (!beschriftet) {
                ctx.font = '11px system-ui, sans-serif'
                ctx.fillStyle = 'rgba(255,193,7,0.95)'
                ctx.textAlign = 'right'
                ctx.textBaseline = 'bottom'
                ctx.fillText('Absorption', this.plotW - 4, y - 2)
                beschriftet = true   // nur einmal beschriften, sonst überladen bei mehreren Treffern
            }
        }
    }

    /** Tooltip für die Volumen-Säulen: Mengen und Übergewicht des Abschnitts. */
    _drawVolumeTooltip(ctx, x, y, { ring, anchor, baseLabel, formatTime }) {
        const v = this.volumeBins
        if (!v) return
        const head = anchor ?? ring.head
        const bx = Math.round(x / v.step) * v.step
        const bin = v.bins.get(bx)
        if (!bin) return

        const kauf = bin.buy, verkauf = bin.sell, total = kauf + verkauf
        const mid = ring.mid[ring.colFrom(head, 0)] || 0
        const einheit = baseLabel || ''
        const wert = (q) => mid ? ` ≈ ${formatUsd(q * mid)}` : ''

        // Zeit dieses Abschnitts aus der Spalte lesen, nicht hochrechnen
        const colFromRight = Math.round(this.histCols - 1 - bx)
        const visible = Math.min(this.histCols, ring.count)
        const ts = colFromRight >= 0 && colFromRight < visible
            ? ring.ts[ring.colFrom(head, colFromRight)] : 0

        // Säule hervorheben
        ctx.fillStyle = 'rgba(255,255,255,0.14)'
        ctx.fillRect(bx - v.step / 2, this.plotH, v.step, this.volumeH)

        const anteil = total ? Math.round((kauf / total) * 100) : 0
        const lines = [
            ts ? formatTime(ts) : '',
            `${this.labels.bought} ${formatQty(kauf)} ${einheit}${wert(kauf)}`,
            `${this.labels.sold} ${formatQty(verkauf)} ${einheit}${wert(verkauf)}`,
            `${this.labels.sum} ${formatQty(total)} ${einheit}${wert(total)}`,
            `${this.labels.buyerShare} ${anteil} %`,
        ].filter(Boolean)

        ctx.font = '12px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14
        const boxH = lines.length * 15 + 8
        // Über der Spur aufklappen — darunter ist die Zeitachse
        const tx = Math.max(4, Math.min(x + 12, this.plotW - boxW))
        const ty = Math.max(4, this.plotH - boxH - 4)
        ctx.fillStyle = COLORS.tooltipBg
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect(tx, ty, boxW, boxH)
        ctx.strokeRect(tx + 0.5, ty + 0.5, boxW, boxH)
        ctx.fillStyle = 'rgba(255,255,255,0.87)'
        lines.forEach((line, i) => ctx.fillText(line, tx + 7, ty + 15 + i * 13))
    }

    /** Tooltip für die Volumenprofil-Spur: Menge in Basiswährung + Gegenwert. */
    _drawProfileTooltip(ctx, x, y, { ring, head, view, bucketSize, baseLabel }) {
        const b = this.profileBins
        if (!b || !b.bins) return
        const bin = Math.min(b.bins - 1, Math.max(0, Math.floor((y / this.plotH) * b.bins)))
        const binH = this.plotH / b.bins
        const kauf = b.buy[bin] || 0
        const verkauf = b.sell[bin] || 0

        // Preisspanne dieser Zeile — eine Profilzeile deckt mehrere Preisstufen ab
        const rowsView = Math.max(1, view.hi - view.lo)
        const oben = (view.hi - (bin * binH / this.plotH) * rowsView) * bucketSize
        const unten = (view.hi - ((bin + 1) * binH / this.plotH) * rowsView) * bucketSize
        const decimals = decimalsFor(bucketSize)
        const mid = ring.mid[ring.colFrom(head, 0)] || 0
        const einheit = baseLabel || ''
        const wert = (q) => mid ? ` ≈ ${formatUsd(q * mid)}` : ''

        // Zeile hervorheben, damit klar ist, welcher Balken gemeint ist
        ctx.fillStyle = 'rgba(255,255,255,0.10)'
        ctx.fillRect(this.plotW, bin * binH, this.profileW, binH)

        const lines = [
            `${unten.toFixed(decimals)} – ${oben.toFixed(decimals)}`,
            `${this.labels.bought} ${formatQty(kauf)} ${einheit}${wert(kauf)}`,
            `${this.labels.sold} ${formatQty(verkauf)} ${einheit}${wert(verkauf)}`,
            `${this.labels.sum} ${formatQty(kauf + verkauf)} ${einheit}${wert(kauf + verkauf)}`,
        ]

        ctx.font = '12px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14
        const boxH = lines.length * 15 + 8
        // Nach links aufklappen — rechts ist die Preisachse im Weg
        const bx = Math.max(4, Math.min(x - boxW - 10, this.cssW - boxW - 4))
        const by = Math.min(Math.max(0, y - boxH / 2), this.plotH - boxH)
        ctx.fillStyle = COLORS.tooltipBg
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect(bx, by, boxW, boxH)
        ctx.strokeRect(bx + 0.5, by + 0.5, boxW, boxH)
        ctx.fillStyle = 'rgba(255,255,255,0.87)'
        lines.forEach((line, i) => ctx.fillText(line, bx + 7, by + 15 + i * 13))
    }
}

/** Gegenwert in USD, kurz gehalten — der Tooltip soll nicht zur Tabelle werden. */
function formatUsd(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(2) + ' Mio $'
    if (v >= 1e3) return Math.round(v / 1e3) + 'k $'
    return Math.round(v) + ' $'
}

function formatQty(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
    if (v >= 1e3) return (v / 1e3).toFixed(2) + 'k'
    return v.toFixed(v < 10 ? 3 : 1)
}
