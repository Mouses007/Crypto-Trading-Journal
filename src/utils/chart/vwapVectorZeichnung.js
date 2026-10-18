/**
 * Mo's VWAP Vector — was nicht als Serie geht, zeichnet dieses Primitive im
 * Kerzen-Pane: Swing-VWAP-Fächer, Vektorkerzen-Zonen, naked POCs (Periode und
 * Docht), Candle-POC-Punkte, Fibonacci, Engulfing-Dreiecke, Daily Open und die
 * Schilder rechts an den Linien. Gerechnet ist alles in `vwapVector.js`.
 *
 * Schilder, die weiter rechts lägen als der sichtbare Bereich, werden an den
 * rechten Rand geklemmt — im Pine stehen sie 12–22 Kerzen rechts vom Kurs,
 * und so viel Leerraum zeigt der Chart nicht immer.
 */
import { logischZuX } from './zeichnungen/geometrie.js'
import { VV_LINIEN } from './indikatorRegister.js'

function rgba(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '')
    if (!m) return hex
    const n = parseInt(m[1], 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

const SCHRIFT = '11px -apple-system, "Segoe UI", Roboto, sans-serif'

export class VwapVectorZeichnung {
    constructor({ chart, serie }) {
        this.chart = chart
        this.serie = serie
        this.r = null
        this.p = {}
        this.kerzen = []
        this.requestUpdate = () => {}
        const ansicht = (z, fn) => ({
            zOrder: () => z,
            renderer: () => ({ draw: (ziel) => ziel.useMediaCoordinateSpace(({ context, mediaSize }) => fn(context, mediaSize)) }),
        })
        this._ansichten = [ansicht('bottom', (c, g) => this.unten(c, g)), ansicht('top', (c, g) => this.oben(c, g))]
        serie.attachPrimitive(this)
    }

    attached({ requestUpdate }) { this.requestUpdate = requestUpdate }
    detached() { this.requestUpdate = () => {} }
    paneViews() { return this._ansichten }
    updateAllViews() {}
    abbauen() { try { this.serie.detachPrimitive(this) } catch { /* weg */ } }

    setze(ergebnis, kerzen, params) {
        this.r = ergebnis || null
        this.kerzen = kerzen || []
        this.p = params || {}
        this.requestUpdate()
    }

    X(i) { return logischZuX(this.chart.timeScale(), i) }
    /**
     * Sichtbare Kerzen [von, bis] mit einer Kerze Rand — Schleifen über alle Kerzen
     * (Fächer, Candle-POC) rechneten bei 3000 geladenen Kerzen je Bild 3000 × 6
     * Koordinaten, von denen meist 150 zu sehen sind.
     */
    sichtbar(n) {
        const r = this.chart.timeScale().getVisibleLogicalRange()
        if (!r) return [0, n - 1]
        return [Math.max(0, Math.floor(r.from) - 1), Math.min(n - 1, Math.ceil(r.to) + 1)]
    }
    Y(p) { return p == null ? null : this.serie.priceToCoordinate(p) }
    schritt() {
        const a = this.X(0), b = this.X(1)
        return a != null && b != null ? Math.abs(b - a) : 6
    }

    waagerecht(ctx, x1, x2, y, farbe, breite, strich = []) {
        if (x1 == null || x2 == null || y == null) return
        ctx.strokeStyle = farbe
        ctx.lineWidth = breite
        ctx.setLineDash(strich)
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke()
        ctx.setLineDash([])
    }

    /** Schild am rechten Ende: an den Rand geklemmt, wenn es dahinter läge. */
    schild(ctx, text, x, y, farbe, breiteGesamt) {
        if (x == null || y == null || !text) return
        ctx.font = SCHRIFT
        const b = ctx.measureText(text).width
        const xx = Math.min(x + 4, breiteGesamt - b - 4)
        ctx.fillStyle = farbe
        ctx.textBaseline = 'middle'
        ctx.fillText(text, xx, y)
    }

    strich(stil, breite) {
        if (stil === 'durchgezogen') return []
        if (stil === 'gepunktet') return [breite, breite * 2]
        return [breite * 3, breite * 2]
    }

    unten(ctx, groesse) {
        const r = this.r, p = this.p
        if (!r || !this.kerzen.length) return
        const n = this.kerzen.length
        const letzte = n - 1
        const breite = groesse.width

        // 8 Vektorkerzen-Zonen
        for (const z of r.zonen || []) {
            const x1 = this.X(z.von), x2 = this.X(letzte + 3)
            const y1 = this.Y(z.oben), y2 = this.Y(z.unten)
            if ([x1, x2, y1, y2].some((v) => v == null)) continue
            const farbe = z.bull ? p.cVliqBull : p.cVliqBear
            ctx.fillStyle = rgba(farbe, (100 - p.vliqTransp) / 100)
            ctx.fillRect(x1, Math.min(y1, y2), x2 - x1, Math.max(1, Math.abs(y2 - y1)))
            if (p.vliqBorder) {
                ctx.strokeStyle = farbe
                ctx.lineWidth = 1
                ctx.strokeRect(x1, Math.min(y1, y2), x2 - x1, Math.abs(y2 - y1))
            }
        }

        // 4 Fibonacci
        const fibFarbe = { 0: p.cL0, 0.236: p.cL236, 0.382: p.cL382, 0.5: p.cL5, 0.618: p.cL618, 0.786: p.cL786, 1: p.cL1 }
        for (const f of r.fib || []) {
            const y = this.Y(f.preis)
            const x1 = this.X(f.von), x2 = this.X(letzte)
            this.waagerecht(ctx, x1, x2, y, fibFarbe[f.stufe], 1)
            this.schild(ctx, String(f.stufe), x2, y, fibFarbe[f.stufe], breite)
        }
    }

    oben(ctx, groesse) {
        const r = this.r, p = this.p
        if (!r || !this.kerzen.length) return
        const n = this.kerzen.length
        const letzte = n - 1
        const breite = groesse.width
        const schritt = this.schritt()
        const kurs = this.kerzen[letzte].c
        const atr = r.atrLetzte
        const [von, bis] = this.sichtbar(n)

        // 2 Swing-VWAP-Fächer: jüngster voll, ältere blasser (wie color.new(col, 35/60))
        const deck = [1, 0.65, 0.4]
        for (const [seite, farbe, an] of [['hoch', p.cSwingHi, p.showSwingHi], ['tief', p.cSwingLo, p.showSwingLo]]) {
            if (!an) continue
            for (const l of r.faecher?.[seite] || []) {
                ctx.strokeStyle = rgba(farbe, deck[l.nth - 1] ?? 0.4)
                ctx.lineWidth = p.swingWidth
                ctx.setLineDash(this.strich(p.swingStyle, p.swingWidth))
                ctx.beginPath()
                let offen = false
                for (let i = Math.max(l.anker, von); i <= bis; i++) {
                    const x = this.X(i), y = this.Y(l.werte[i])
                    if (x == null || y == null) { offen = false; continue }
                    if (offen) ctx.lineTo(x, y); else ctx.moveTo(x, y)
                    offen = true
                }
                ctx.stroke()
                ctx.setLineDash([])
            }
        }

        // 6 Perioden-POC: nur Level in der Nähe (pocPerDist × ATR), fernere bleiben bestehen
        const pocTf = { '4h': '4h', '12h': '12h', '1d': 'D', '1w': 'W', '1M': 'M' }[p.pocPerTf] || p.pocPerTf
        for (const l of r.periodenPoc || []) {
            if (p.pocPerDist > 0 && atr != null && Math.abs(l.preis - kurs) > p.pocPerDist * atr) continue
            const y = this.Y(l.preis)
            const x1 = this.X(l.von)
            const x2 = this.X(p.pocPerExt ? letzte + p.lblOffPocPer : l.ab)
            this.waagerecht(ctx, x1, x2, y, p.cPocPer, p.pocPerWid)
            if (p.pocPerLbl) this.schild(ctx, `POC ${pocTf}`, x2, y, p.cPocPer, breite)
        }

        // 7 Candle-POC: Docht-Level (gestrichelt) und Punkte je Kerze
        for (const l of r.dochtLevel || []) {
            const y = this.Y(l.preis)
            const x2 = this.X(letzte + p.lblOffPocC)
            this.waagerecht(ctx, this.X(l.von), x2, y, p.cPocC, p.pocCWidth, [5, 4])
            if (p.pocCLabel) this.schild(ctx, 'Candle POC', x2, y, p.cPocC, breite)
        }
        if (r.candlePoc) {
            ctx.fillStyle = rgba(p.cPocCAll, 0.75)
            const rad = Math.max(1, Math.min(schritt * 0.35, 1 + p.pocCAllW))
            for (let i = von; i <= bis; i++) {
                const y = this.Y(r.candlePoc[i])
                const x = this.X(i)
                if (x == null || y == null || x < -5 || x > breite + 5) continue
                ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill()
            }
        }

        // 9 Daily Open
        if (r.dailyOpen) {
            const y = this.Y(r.dailyOpen.preis)
            const x2 = this.X(letzte + p.lblOffDO)
            this.waagerecht(ctx, this.X(r.dailyOpen.von), x2, y, p.cDOpen, 1, [4, 4])
            if (p.dOpenLbl) this.schild(ctx, 'D-Open', x2, y, p.cDOpen, breite)
        }

        // 5 Engulfing: Dreieck unter (bull) bzw. über (bear) der Kerze
        const g = Math.max(3, Math.min(6, schritt * 0.45))
        for (const e of r.engulfing || []) {
            const k = this.kerzen[e.i]
            const x = this.X(e.i)
            if (!k || x == null || x < -10 || x > breite + 10) continue
            const bull = e.seite === 'bull'
            const y = this.Y(bull ? k.l : k.h)
            if (y == null) continue
            const y0 = bull ? y + 6 : y - 6
            ctx.fillStyle = bull ? p.cEngBull : p.cEngBear
            ctx.beginPath()
            if (bull) { ctx.moveTo(x, y0); ctx.lineTo(x - g, y0 + g * 1.6); ctx.lineTo(x + g, y0 + g * 1.6) }
            else { ctx.moveTo(x, y0); ctx.lineTo(x - g, y0 - g * 1.6); ctx.lineTo(x + g, y0 - g * 1.6) }
            ctx.closePath(); ctx.fill()
        }

        // Schilder an den Linien (VWAP-D … EMA 50 1d) und am jüngsten Swing-VWAP
        for (const [key, an, farbe, text, art] of VV_LINIEN) {
            if (!p[an]) continue
            if (art === 'vwap' ? !p.labelVWAPS : !p.labelEMAS) continue
            const reihe = r.linien?.[key]
            const w = reihe?.[letzte]
            if (w == null) continue
            const off = art === 'vwap' ? p.lblOffVwap : p.lblOffEma
            this.schild(ctx, typeof text === 'function' ? text(p) : text, this.X(letzte + off), this.Y(w), p[farbe], breite)
        }
        if (p.labelVWAPS) {
            for (const [seite, text, farbe] of [['hoch', 'VWAP-SH', p.cSwingHi], ['tief', 'VWAP-SL', p.cSwingLo]]) {
                const l = (r.faecher?.[seite] || [])[0]
                if (l) this.schild(ctx, text, this.X(letzte + p.lblOffVwap), this.Y(l.werte[letzte]), farbe, breite)
            }
        }
    }
}

/** PVSRA-Farbe je Kerze (oder null = Standardfarben). */
export function vektorFarben(stufen, p) {
    if (!stufen) return null
    const a = (p.vecDeckkraft ?? 80) / 100
    return stufen.map((s) => {
        const hex = s.stufe === 'climax' ? (s.bull ? p.cClimaxBull : p.cClimaxBear)
            : s.stufe === 'rising' ? (s.bull ? p.cRisingBull : p.cRisingBear)
                : (s.bull ? p.cNeutBull : p.cNeutBear)
        return rgba(hex, a)
    })
}
