/**
 * Renderer der Liquidationskarte.
 *
 * Bewusst KEIN Offscreen-Canvas und keine Farb-LUT wie in der Heatmap: die
 * Karte hat keine Zeitachse, sie ist eine eindimensionale Verteilung über den
 * Preis. Gezeichnet werden höchstens `plotH` Pixelzeilen × 4 Segmente — unter
 * 3000 `fillRect` bei ≤ 2 Hz. Der ImageData-Apparat der Heatmap wird deshalb
 * gar nicht erst angefasst.
 *
 * Farben folgen der Heatmap: Long-Liquidation = Verkaufsdruck = rot,
 * Short-Liquidation = Kaufdruck = grün. Wer beide Ansichten nebeneinander
 * legt, soll nicht umdenken müssen.
 */

// Breiter als früher (78): die Achsenschrift ist von 10 auf 12 px gewachsen,
// und rechts vom Preis steht noch der Abstand zum Mittelkurs in Prozent.
const AXIS_W = 92          // Preisachse rechts
const LEGEND_H = 64        // Kopfzeile mit Massstab und Kennzahlen
const PAD_L = 10

const COLORS = {
    bg: 'rgba(0,0,0,0)',
    grid: 'rgba(255,255,255,0.08)',
    axisText: 'rgba(255,255,255,0.78)',
    midLine: 'rgba(255,255,255,0.85)',
    // Long-Liquidation drückt den Preis (Zwangsverkauf) → rot
    long: 'rgb(255,95,86)',
    short: 'rgb(38,190,150)',
    // Abgeräumt wird GRAU, nicht blass-rot/grün: die Seite spielt keine Rolle
    // mehr, sobald der Preis durchgelaufen ist — dort liegt nichts mehr, was
    // noch ausgelöst werden könnte. Farbe würde Handlungsrelevanz suggerieren.
    longSwept: 'rgba(190,190,200,0.30)',
    shortSwept: 'rgba(190,190,200,0.30)',
    sweptHeat: [172, 172, 172],   // neutral, kein Blaustich — sonst liest es sich als eigene Farbe
    tooltipBg: 'rgba(18,18,18,0.94)',
    warn: 'rgb(250,190,60)',
}

/** Helligkeit je Hebelstufe — höhere Hebel dunkler, damit sie unterscheidbar sind. */
const TIER_ALPHA = [1, 0.82, 0.64, 0.46, 0.34]

export class LeverageMapRenderer {
    constructor(canvas) {
        this.el = canvas
        this.ctx = canvas.getContext('2d')
        this.cssW = 0
        this.cssH = 0
        this.plotW = 0
        this.plotH = 0
        this.cursor = null
        this.threshold = 0        // 0..0.95 — blendet schwache Zonen aus
        this.profileW = 74        // Verteilungsprofil am rechten Rand des Verlaufs
        this.labels = {
            title: 'Liquidationszonen', model: 'Modell', long: 'Long', short: 'Short',
            swept: 'abgeräumt', mass: 'Modellmasse', window: 'Fenster', mmr: 'Margin-Rate',
            noData: 'keine Daten', toMid: '% zum Mid', tiers: 'Stufen', lift: 'Trefferquote',
            history: 'Verlauf', coverage: 'Abdeckung',
            thinWindow: 'Fenster zu kurz — Karte zeigt nur einen Bruchteil der Positionen',
        }
    }

    setLabels(labels) { if (labels) Object.assign(this.labels, labels) }

    /** Zonen unterhalb dieses Anteils der Skala werden nicht gezeichnet. */
    setThreshold(v) { this.threshold = Math.max(0, Math.min(0.95, Number(v) || 0)) }

    /** Breite der Profilspur im Verlauf, in CSS-Pixeln. */
    setProfileWidth(px) { this.profileW = Math.max(0, Math.min(320, Math.round(Number(px)) || 0)) }

    /**
     * Verlaufsansicht: Zeit nach rechts, Preis nach oben, Farbe = Zonenmasse.
     *
     * Hier lohnt der Offscreen-Trick wie in der Heatmap — ein Pixel je Zelle in
     * ein ImageData schreiben und einmal hochskaliert blitten, statt zehntausende
     * fillRect abzusetzen. Die Verteilungsansicht (`draw`) braucht das nicht,
     * dort sind es höchstens ein paar hundert Balken.
     *
     * @param {object} opts
     * @param {ReturnType<import('../../shared/leverageMap.js').buildLeverageHistory>} opts.hist
     * @param {number} opts.viewPct   gezeigte Spanne um den letzten Preis
     * @param {Function} opts.formatTime
     */
    drawHistory({ hist, viewPct, formatTime, hinweis }) {
        const ctx = this.ctx
        ctx.clearRect(0, 0, this.cssW, this.cssH)
        if (!hist || !hist.cols) {
            ctx.fillStyle = COLORS.axisText
            ctx.font = '12px system-ui, sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(hinweis || this.labels.noData, this.cssW / 2, this.cssH / 2)
            return
        }

        const y0 = LEGEND_H
        // Unten Platz für die Zeitachse reservieren: sie stand bisher bei
        // y0 + plotH + 3 mit Baseline 'top' — also AUSSERHALB des Canvas und
        // war schlicht unsichtbar.
        const plotH = Math.max(30, this.plotH - 16)
        const mid = hist.mid[hist.cols - 1]
        const wunschHi = mid * (1 + viewPct / 100)
        const wunschLo = mid * (1 - viewPct / 100)
        const rHi = Math.min(hist.rows - 1, Math.round(wunschHi / hist.bucketSize) - hist.base)
        const rLo = Math.max(0, Math.round(wunschLo / hist.bucketSize) - hist.base)
        const sichtbar = rHi - rLo + 1
        if (sichtbar < 2) return
        // Das Offscreen-Bild füllt die Zeilen rLo..rHi kantengenau auf
        // [y0, y0+plotH]. yFor muss über dieselben Bucket-KANTEN laufen —
        // über die Mitten lag bis zu einer halben Zelle Versatz zwischen
        // Heatmap und Kerzen/Achse/Fadenkreuz.
        const hi = (hist.base + rHi + 0.5) * hist.bucketSize
        const lo = (hist.base + rLo - 0.5) * hist.bucketSize

        // Das Verteilungsprofil bekommt einen eigenen Streifen rechts, damit
        // Momentaufnahme und Verlauf in EINEM Bild stehen — wie bei Coinglass.
        // Luft zwischen Heatmap und Profil, sonst liest man das Profil als
        // Fortsetzung der letzten Spalte statt als eigene Darstellung.
        const LUECKE = 8
        const profilW = this.profileW
        const heatW = Math.max(40, this.plotW - profilW - LUECKE)

        // Normierung auf das p98 der sichtbaren Werte statt auf das Maximum:
        // eine einzelne Spitze würde sonst alles andere schwarz färben.
        const proben = []
        for (let c = 0; c < hist.cols; c += Math.max(1, Math.floor(hist.cols / 60))) {
            const off = c * hist.rows
            for (let r = rLo; r <= rHi; r += 2) {
                const v = Math.max(hist.long[off + r], hist.short[off + r])
                if (v > 0) proben.push(v)
            }
        }
        proben.sort((a, b) => a - b)
        const ref = proben.length ? (proben[Math.floor(proben.length * 0.98)] || proben[proben.length - 1]) : 1

        // ── Offscreen: ein Pixel je Zelle ───────────────────────
        if (!this._off) { this._off = document.createElement('canvas'); this._offCtx = this._off.getContext('2d') }
        if (this._off.width !== hist.cols || this._off.height !== sichtbar) {
            this._off.width = hist.cols
            this._off.height = sichtbar
            this._img = this._offCtx.createImageData(hist.cols, sichtbar)
            this._buf = new Uint32Array(this._img.data.buffer)
        }
        const buf = this._buf
        buf.fill(0)
        const [sr, sg, sb] = COLORS.sweptHeat
        for (let c = 0; c < hist.cols; c++) {
            const off = c * hist.rows
            for (let r = rLo; r <= rHi; r++) {
                const l = hist.long[off + r]
                const sh = hist.short[off + r]
                const v = l > sh ? l : sh
                if (v <= 0) continue

                // RÜCKWIRKEND grau: wurde diese Zeile später abgeräumt, ist die
                // ganze Vorgeschichte bis dahin Vergangenheit — sie wird nie
                // mehr auslösen. Farbig bleibt nur, was bis heute übrig ist.
                // Sonst bleibt jede je entstandene Zone für immer bunt und die
                // Karte wird mit der Zeit unlesbar.
                const spaeterGefressen = hist.sweptUntil && c <= hist.sweptUntil[r]
                let t = Math.min(1, Math.sqrt(v / ref))
                let cr, cg, cb
                if (spaeterGefressen) {
                    t *= 0.7
                    ;[cr, cg, cb] = [sr, sg, sb]
                } else {
                    ;[cr, cg, cb] = l > sh ? [255, 95, 86] : [38, 190, 150]
                }

                if (t < this.threshold) continue      // schwache Zonen ausblenden
                const a = Math.round(20 + 235 * t)
                // ABGR für direktes Schreiben in Uint32
                buf[(rHi - r) * hist.cols + c] = (a << 24) | (cb << 16) | (cg << 8) | cr
            }
        }
        this._offCtx.putImageData(this._img, 0, 0)

        ctx.imageSmoothingEnabled = false
        ctx.drawImage(this._off, 0, 0, hist.cols, sichtbar, PAD_L, y0, heatW, plotH)
        ctx.imageSmoothingEnabled = true

        // ── Kurs als Kerzen ─────────────────────────────────────
        // Dochte sind hier der eigentliche Gewinn gegenüber einer Linie: sie
        // zeigen die Berührungen, die eine Zone abräumen — genau das, was man
        // an dieser Karte ablesen will.
        const yFor = (price) => y0 + ((hi - price) / (hi - lo)) * plotH
        const xFor = (c) => PAD_L + (c / Math.max(1, hist.cols - 1)) * heatW
        if (hist.o && hist.h && hist.l) {
            const breite = Math.max(1, Math.min(6, (heatW / hist.cols) * 0.7))
            for (let c = 0; c < hist.cols; c++) {
                const x = xFor(c)
                const auf = hist.mid[c] >= hist.o[c]
                ctx.strokeStyle = auf ? 'rgba(200,255,235,0.85)' : 'rgba(255,215,210,0.85)'
                ctx.fillStyle = ctx.strokeStyle
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.moveTo(x + 0.5, yFor(hist.h[c]))
                ctx.lineTo(x + 0.5, yFor(hist.l[c]))
                ctx.stroke()
                const yO = yFor(hist.o[c]), yC = yFor(hist.mid[c])
                const oben = Math.min(yO, yC)
                ctx.fillRect(x - breite / 2, oben, breite, Math.max(1, Math.abs(yC - yO)))
            }
        } else {
            ctx.beginPath()
            ctx.strokeStyle = COLORS.midLine
            ctx.lineWidth = 1.2
            for (let c = 0; c < hist.cols; c++) {
                const y = yFor(hist.mid[c])
                if (c === 0) ctx.moveTo(xFor(c), y); else ctx.lineTo(xFor(c), y)
            }
            ctx.stroke()
        }

        // ── Verteilungsprofil am rechten Rand (letzte Spalte) ───
        this._drawHistoryProfile(ctx, { hist, rLo, rHi, yFor, y0, plotH, x0: PAD_L + heatW + LUECKE, w: profilW })

        this._drawAxis(ctx, { mid, lo, hi, yFor, y0 })

        // ── Zeitachse ───────────────────────────────────────────
        // x über heatW, nicht plotW: die Heatmap endet vor der Profilspur —
        // mit plotW sassen die Marken bis ~80 px neben ihrer Spalte.
        ctx.font = '12px system-ui, sans-serif'
        ctx.fillStyle = COLORS.axisText
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        const marken = 5
        for (let i = 0; i <= marken; i++) {
            const c = Math.round((hist.cols - 1) * (i / marken))
            const x = PAD_L + (c / Math.max(1, hist.cols - 1)) * heatW
            ctx.fillText(formatTime ? formatTime(hist.ts[c]) : '', x, y0 + plotH + 3)
        }

        // ── Kopfzeile ───────────────────────────────────────────
        ctx.textAlign = 'left'
        ctx.font = '12px system-ui, sans-serif'
        ctx.fillStyle = 'rgba(255,255,255,0.87)'
        ctx.fillText(`${this.labels.title} — ${this.labels.history}`, PAD_L, 8)
        ctx.font = '12px system-ui, sans-serif'
        ctx.fillStyle = COLORS.axisText
        const stunden = ((hist.ts[hist.cols - 1] - hist.ts[0]) / 3600000).toFixed(1)
        let lebend = 0
        const letzte = (hist.cols - 1) * hist.rows
        for (let r = 0; r < hist.rows; r++) lebend += hist.long[letzte + r] + hist.short[letzte + r]
        const abdeckung = hist.oi > 0 ? lebend / hist.oi : 0
        ctx.fillText(
            `${this.labels.coverage} ${(abdeckung * 100).toFixed(1)} %  ·  ` +
            `${this.labels.window} ${stunden} h / ${hist.cols} P`, PAD_L, 26)
        if (abdeckung < 0.2) {
            ctx.fillStyle = COLORS.warn
            ctx.fillText(`⚠ ${this.labels.thinWindow}`, PAD_L, 42)
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.35)'
            ctx.fillText(`${this.labels.long} ■  ${this.labels.short} ■  ${this.labels.swept} ■`, PAD_L, 42)
        }

        this._drawHistoryCursor(ctx, { hist, lo, hi, y0, plotH, yFor, formatTime, heatW })
    }

    /**
     * Fadenkreuz + Werte für die Verlaufsansicht.
     *
     * Zeigt bewusst BEIDE Seiten der Zelle, nicht nur die stärkere: die Farbe
     * im Bild gibt nur das Übergewicht wieder, und wer auf eine Zone zeigt,
     * will wissen, ob dort auch Gegenmasse liegt.
     */
    _drawHistoryProfile(ctx, { hist, rLo, rHi, yFor, y0, plotH, x0, w }) {
        const off = (hist.cols - 1) * hist.rows
        let max = 0
        for (let r = rLo; r <= rHi; r++) {
            const v = Math.max(hist.long[off + r], hist.short[off + r])
            if (v > max) max = v
        }
        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.fillRect(x0, y0, w, plotH)
        ctx.strokeStyle = COLORS.grid
        ctx.beginPath(); ctx.moveTo(x0 + 0.5, y0); ctx.lineTo(x0 + 0.5, y0 + plotH); ctx.stroke()
        if (!max) return
        const hoehe = plotH / Math.max(1, rHi - rLo + 1)
        for (let r = rLo; r <= rHi; r++) {
            const y = yFor((hist.base + r) * hist.bucketSize)
            const l = hist.long[off + r], sh = hist.short[off + r]
            if (l > 0) {
                ctx.fillStyle = COLORS.long
                ctx.fillRect(x0 + 2, y - hoehe / 2, Math.max(1, (l / max) * (w - 6)), Math.max(1, hoehe))
            }
            if (sh > 0) {
                ctx.fillStyle = COLORS.short
                ctx.fillRect(x0 + 2, y - hoehe / 2, Math.max(1, (sh / max) * (w - 6)), Math.max(1, hoehe))
            }
        }
    }

    _drawHistoryCursor(ctx, { hist, lo, hi, y0, plotH, yFor, formatTime, heatW }) {
        const c = this.cursor
        if (!c || c.y < y0 || c.y > y0 + plotH) return
        if (c.x < PAD_L || c.x > PAD_L + heatW) return

        const spalte = Math.max(0, Math.min(hist.cols - 1,
            Math.round(((c.x - PAD_L) / heatW) * (hist.cols - 1))))
        const preis = hi - ((c.y - y0) / plotH) * (hi - lo)
        const r = Math.round(preis / hist.bucketSize) - hist.base
        if (r < 0 || r >= hist.rows) return

        const off = spalte * hist.rows
        const l = hist.long[off + r]
        const sh = hist.short[off + r]
        const ab = hist.swept ? hist.swept[off + r] : 0
        const marktpreis = hist.mid[spalte]
        const x = PAD_L + (spalte / Math.max(1, hist.cols - 1)) * heatW

        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.setLineDash([3, 3])
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(PAD_L, c.y + 0.5); ctx.lineTo(PAD_L + this.plotW, c.y + 0.5)
        ctx.moveTo(x + 0.5, y0); ctx.lineTo(x + 0.5, y0 + plotH)
        ctx.stroke()
        ctx.restore()

        const dez = marktpreis > 1000 ? 0 : marktpreis > 10 ? 2 : 5
        const usd = (v) => {
            const w = v * preis
            if (w <= 0) return '—'
            if (w >= 1e6) return (w / 1e6).toFixed(2) + ' Mio $'
            if (w >= 1e3) return Math.round(w / 1e3) + 'k $'
            return Math.round(w) + ' $'
        }
        const abstand = ((preis - marktpreis) / marktpreis) * 100
        const zeilen = [
            `${formatTime ? formatTime(hist.ts[spalte]) : ''}   ${this.labels.price ?? 'Kurs'} ${marktpreis.toFixed(dez)}`,
            `${preis.toFixed(dez)}   ${abstand >= 0 ? '+' : ''}${abstand.toFixed(2)} ${this.labels.toMid}`,
            `${this.labels.long}  ${usd(l)}`,
            `${this.labels.short} ${usd(sh)}`,
        ]
        if (ab > 0) zeilen.push(`${this.labels.swept} ${usd(ab)}`)

        ctx.font = '12px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        const w = Math.max(...zeilen.map(z => ctx.measureText(z).width)) + 14
        const h = zeilen.length * 13 + 8
        // Zur Mausseite hin aufklappen, damit das Kästchen nie die Zelle verdeckt,
        // auf die man gerade zeigt
        const linksVomZeiger = c.x > PAD_L + heatW / 2
        const bx = linksVomZeiger ? Math.max(PAD_L, c.x - w - 12) : Math.min(c.x + 12, PAD_L + heatW - w)
        const by = Math.min(Math.max(y0, c.y - h - 10), y0 + plotH - h)
        ctx.fillStyle = COLORS.tooltipBg
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect(bx, by, w, h)
        ctx.strokeRect(bx + 0.5, by + 0.5, w, h)
        ctx.fillStyle = 'rgba(255,255,255,0.87)'
        zeilen.forEach((z, i) => {
            if (i === 2) ctx.fillStyle = COLORS.long
            if (i === 3) ctx.fillStyle = COLORS.short
            if (i === 4) ctx.fillStyle = 'rgba(190,190,200,0.75)'
            ctx.fillText(z, bx + 7, by + 15 + i * 13)
        })
    }

    resize(cssW, cssH) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        this.cssW = cssW
        this.cssH = cssH
        this.plotW = Math.max(50, Math.floor(cssW - AXIS_W - PAD_L))
        this.plotH = Math.max(50, Math.floor(cssH - LEGEND_H))
        this.el.width = Math.floor(cssW * dpr)
        this.el.height = Math.floor(cssH * dpr)
        this.el.style.width = cssW + 'px'
        this.el.style.height = cssH + 'px'
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    /**
     * @param {object} opts
     * @param {import('../../shared/leverageMap.js').LeverageMap|null} opts.map
     * @param {number} opts.mid          aktueller Preis (Mittellinie)
     * @param {number} opts.viewPct      gezeigte Spanne um den Mid, einseitig
     * @param {number[]|'all'} opts.tier gewählte Hebelwerte (z.B. [50,100]) oder
     *                                   'all' — nur noch für die Beschriftung
     * @param {number[]} opts.weights    Gewichte je Stufe in map.tiers, Summe 1;
     *                                   0 = Stufe abgewählt
     * @param {string} [opts.hinweis]
     */
    draw({ map, mid, viewPct, tier, weights, hinweis }) {
        const ctx = this.ctx
        ctx.clearRect(0, 0, this.cssW, this.cssH)

        if (!map || !mid) {
            ctx.fillStyle = COLORS.axisText
            ctx.font = '12px system-ui, sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(hinweis || this.labels.noData, this.cssW / 2, this.cssH / 2)
            return
        }

        const y0 = LEGEND_H
        const hi = mid * (1 + viewPct / 100)
        const lo = mid * (1 - viewPct / 100)
        const yFor = (price) => y0 + ((hi - price) / (hi - lo)) * this.plotH

        // ── Werte je Pixelzeile aufsummieren ────────────────────
        // Unabhängig von der Bucket-Wahl: mehrere Bucket-Zeilen können auf
        // dieselbe Pixelzeile fallen (oder keine). Summieren statt abtasten
        // vermeidet Moiré-Lücken bei feinem Raster.
        const long = new Float64Array(this.plotH)
        const short = new Float64Array(this.plotH)
        const longSwept = new Float64Array(this.plotH)
        const shortSwept = new Float64Array(this.plotH)
        // Die Auswahl steckt vollständig in den Gewichten (0 = abgewählt) —
        // Einzelstufe, Kombination und „Alle" sind derselbe Rechenweg.
        const gewicht = (k) => (weights?.[k] ?? 1)

        for (let r = 0; r < map.rows; r++) {
            const price = map.priceAt(r)
            if (price > hi || price < lo) continue
            const py = Math.floor(yFor(price) - y0)
            if (py < 0 || py >= this.plotH) continue
            for (let k = 0; k < map.tiers.length; k++) {
                const w = gewicht(k)
                if (!w) continue
                const l = map.long[k][r] * w
                const s = map.short[k][r] * w
                if (l > 0) (map.isSwept(r, 'long') ? longSwept : long)[py] += l
                if (s > 0) (map.isSwept(r, 'short') ? shortSwept : short)[py] += s
            }
        }

        // Längennormierung LINEAR auf das p98: bei Notional soll doppelt so
        // lang auch doppelt so viel heissen. Log wäre hier irreführend.
        const alle = []
        for (let i = 0; i < this.plotH; i++) {
            if (long[i] > 0) alle.push(long[i])
            if (short[i] > 0) alle.push(short[i])
        }
        alle.sort((a, b) => a - b)
        const ref = alle.length ? (alle[Math.floor(alle.length * 0.98)] || alle[alle.length - 1]) : 1
        const maxLen = this.plotW / 2 - 6
        const mitte = PAD_L + this.plotW / 2

        // ── Gitter + Mittellinie ────────────────────────────────
        ctx.strokeStyle = COLORS.grid
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(mitte + 0.5, y0)
        ctx.lineTo(mitte + 0.5, y0 + this.plotH)
        ctx.stroke()

        // ── Balken ──────────────────────────────────────────────
        // Long links (fallende Preise), Short rechts — so liegt die Seite,
        // in die der Preis laufen müsste, auch optisch dort.
        const zeichne = (arr, farbe, nachLinks) => {
            ctx.fillStyle = farbe
            for (let i = 0; i < this.plotH; i++) {
                const v = arr[i]
                if (v <= 0) continue
                const len = Math.max(1, Math.min(maxLen, (v / ref) * maxLen))
                if (nachLinks) ctx.fillRect(mitte - len, y0 + i, len, 1)
                else ctx.fillRect(mitte, y0 + i, len, 1)
            }
        }
        zeichne(longSwept, COLORS.longSwept, true)
        zeichne(shortSwept, COLORS.shortSwept, false)
        zeichne(long, COLORS.long, true)
        zeichne(short, COLORS.short, false)

        // ── Mid-Linie ───────────────────────────────────────────
        const yMid = yFor(mid)
        ctx.strokeStyle = COLORS.midLine
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(PAD_L, yMid + 0.5)
        ctx.lineTo(PAD_L + this.plotW, yMid + 0.5)
        ctx.stroke()
        ctx.setLineDash([])

        this._drawAxis(ctx, { mid, lo, hi, yFor, y0 })
        this._drawLegend(ctx, { map, tier, weights })
        this._drawCursor(ctx, { map, mid, lo, hi, yFor, y0, tier, weights, ref, maxLen, mitte })
    }

    _drawAxis(ctx, { mid, lo, hi, yFor, y0 }) {
        const x = PAD_L + this.plotW + 6
        ctx.font = '12px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        const dez = mid > 1000 ? 0 : mid > 10 ? 2 : 5
        const schritte = 9
        for (let i = 0; i <= schritte; i++) {
            const price = lo + ((hi - lo) * i) / schritte
            const y = yFor(price)
            ctx.strokeStyle = COLORS.grid
            ctx.beginPath()
            ctx.moveTo(PAD_L, y + 0.5)
            ctx.lineTo(PAD_L + this.plotW, y + 0.5)
            ctx.stroke()
            ctx.fillStyle = COLORS.axisText
            ctx.fillText(price.toFixed(dez), x, y)
            const pct = ((price - mid) / mid) * 100
            // Abstand 50 statt 44: bei 12 px ist „9.99999" rund 44 px breit und
            // lief sonst in die Prozentangabe hinein.
            ctx.fillStyle = 'rgba(255,255,255,0.5)'
            ctx.fillText(`${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, x + 50, y)
        }
        // Mid hervorheben
        ctx.fillStyle = COLORS.midLine
        ctx.fillText(mid.toFixed(dez), x, yFor(mid))
    }

    _drawLegend(ctx, { map, tier, weights }) {
        ctx.font = '12px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'

        // Auswahl adressiert NOMINALE Hebelwerte, angezeigt werden die
        // EFFEKTIVEN (der Max-Hebel des Symbols kann Stufen klemmen).
        const nominale = map.tiersNominal || map.tiers
        const gewaehlt = tier === 'all'
            ? map.tiers
            : map.tiers.filter((L, k) => tier.includes(nominale[k]))
        // Leere Schnittmenge = die Auswahl wurde beim Symbol weggeklemmt;
        // gezeichnet werden dann alle Stufen (siehe gewichteFuer), also
        // stehen sie auch so in der Überschrift.
        const liste = gewaehlt.length ? gewaehlt : map.tiers
        const stufen = liste.length ? liste.map(t => `${t}x`).join(' · ') : '—'
        ctx.fillStyle = 'rgba(255,255,255,0.87)'
        ctx.fillText(`${this.labels.title} — ${stufen}`, PAD_L, 8)

        // ABDECKUNG statt Halte-Anteil: entscheidend ist, welcher Teil des
        // tatsächlichen offenen Interesses überhaupt in der Karte steht. Bei
        // kurzen Fenstern ist das wenig — was vor dem Fenster eröffnet wurde,
        // kennt das Modell nicht. Der frühere Wert (gehalten/(gehalten+
        // abgeräumt)) sah dabei gut aus, obwohl die Karte fast leer war.
        // Gewichteter MITTELWERT der Stufen-Szenarien (Gewichte sind auf
        // Summe 1 normiert; abgewählte Stufen tragen 0). Die Szenarien schlicht
        // zu ADDIEREN zählte dieselbe Position bis zu viermal — die Abdeckung
        // stand dann systematisch zu hoch und die „Fenster zu kurz"-Warnung
        // griff nie.
        const gehalten = map.mass.reduce(
            (a, m, k) => a + m * (weights?.[k] ?? 1 / (map.mass.length || 1)), 0)
        const abdeckung = map.oi > 0 ? gehalten / map.oi : 0

        ctx.font = '12px system-ui, sans-serif'
        ctx.fillStyle = COLORS.axisText
        const stunden = (map.spanMs / 3600000).toFixed(1)
        ctx.fillText(
            `${this.labels.coverage} ${(abdeckung * 100).toFixed(1)} %  ·  ` +
            `${this.labels.window} ${stunden} h / ${map.periods} P  ·  ` +
            `${this.labels.mmr} ${(map.mmr * 100).toFixed(2)} %`,
            PAD_L, 26)

        if (abdeckung < 0.2) {
            ctx.fillStyle = COLORS.warn
            ctx.fillText(`⚠ ${this.labels.thinWindow}`, PAD_L, 42)
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.35)'
            ctx.fillText(`← ${this.labels.long}     ${this.labels.short} →`, PAD_L, 42)
        }
    }

    setCursor(cursor) { this.cursor = cursor }

    _drawCursor(ctx, { map, mid, lo, hi, yFor, y0, weights }) {
        const c = this.cursor
        if (!c || c.y < y0 || c.y > y0 + this.plotH) return
        const price = hi - ((c.y - y0) / this.plotH) * (hi - lo)
        if (map.rowFor(price) < 0 || map.rowFor(price) >= map.rows) return

        // Der Balken einer Pixelzeile ist die SUMME mehrerer Buckets (draw()
        // summiert gegen Moiré-Lücken) — der Tooltip muss über dieselben
        // Buckets summieren, sonst zeigt er bis Faktor 2–3 weniger als der
        // Balken daneben suggeriert. Abgeräumtes läuft getrennt mit.
        const gewicht = (k) => (weights?.[k] ?? 1)
        const py = Math.floor(c.y - y0)
        let l = 0, s = 0, lAb = 0, sAb = 0
        for (let r = 0; r < map.rows; r++) {
            const pr = map.priceAt(r)
            if (pr > hi || pr < lo) continue
            if (Math.floor(yFor(pr) - y0) !== py) continue
            let vl = 0, vs = 0
            for (let k = 0; k < map.tiers.length; k++) {
                vl += map.long[k][r] * gewicht(k)
                vs += map.short[k][r] * gewicht(k)
            }
            if (map.isSwept(r, 'long')) lAb += vl; else l += vl
            if (map.isSwept(r, 'short')) sAb += vs; else s += vs
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(PAD_L, c.y + 0.5)
        ctx.lineTo(PAD_L + this.plotW, c.y + 0.5)
        ctx.stroke()
        ctx.setLineDash([])

        const dez = mid > 1000 ? 0 : mid > 10 ? 2 : 5
        // Gleiche Staffelung wie im Verlaufs-Tooltip — ohne die <1000-$-Stufe
        // wurde jeder kleine Betrag zu „0k $" gerundet.
        const usd = (v) => {
            const w = v * price
            if (w <= 0) return '—'
            if (w >= 1e6) return (w / 1e6).toFixed(2) + ' Mio $'
            if (w >= 1e3) return Math.round(w / 1e3) + 'k $'
            return Math.round(w) + ' $'
        }
        const seite = (aktiv, ab) => (aktiv > 0
            ? usd(aktiv)
            : (ab > 0 ? `${usd(ab)}  (${this.labels.swept})` : '—'))
        const zeilen = [
            `${price.toFixed(dez)}   ${(((price - mid) / mid) * 100).toFixed(2)} ${this.labels.toMid}`,
            `${this.labels.long}  ${seite(l, lAb)}`,
            `${this.labels.short} ${seite(s, sAb)}`,
        ]
        ctx.font = '12px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        const w = Math.max(...zeilen.map(z => ctx.measureText(z).width)) + 14
        const h = zeilen.length * 13 + 8
        const bx = Math.min(Math.max(PAD_L, c.x + 12), PAD_L + this.plotW - w)
        const by = Math.min(Math.max(y0, c.y - h - 8), y0 + this.plotH - h)
        ctx.fillStyle = COLORS.tooltipBg
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect(bx, by, w, h)
        ctx.strokeRect(bx + 0.5, by + 0.5, w, h)
        ctx.fillStyle = 'rgba(255,255,255,0.87)'
        zeilen.forEach((z, i) => ctx.fillText(z, bx + 7, by + 15 + i * 13))
    }
}
