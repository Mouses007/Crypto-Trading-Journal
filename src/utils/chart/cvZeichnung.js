/**
 * Zeichnung der Indikatoren „LSOB-Boxen" und „GUSS-Rücklauf" (shared/lsobCv.js,
 * shared/gussCv.js) im Kerzen-Pane — so nah am gewohnten TradingView-Bild, dass man beide
 * nebeneinander lesen kann:
 *
 *   LSOB   gültige Boxen von der Pivot-Kerze bis zum rechten Rand, Label
 *          „LSOB" über (Short) bzw. unter (Long) der Box, Signal-Pins am
 *          Retest, optionale Vorwarnlinie.
 *   GUSS   „GUSS Start" / „R-GUSS Start" an der Start-Kerze (Initial blass,
 *          nach dem Einstieg kräftig = bestätigt), „GUSS Entry (EMA 50)" am
 *          Einstieg an der EMA. Die EMAs selbst sind Serien des Indikators.
 */
import { ereignisZuLogisch, logischZuX } from './zeichnungen/geometrie.js'

const SCHRIFT = '11px -apple-system, "Segoe UI", Roboto, sans-serif'

function rgba(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '')
    if (!m) return hex
    const n = parseInt(m[1], 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export class CvZeichnung {
    constructor({ chart, serie }) {
        this.chart = chart
        this.serie = serie
        this.daten = null
        this.p = {}
        this.zeiten = []
        this.iv = 3_600_000
        this.requestUpdate = () => {}
        this._ansicht = {
            zOrder: () => 'top',
            renderer: () => ({ draw: (ziel) => ziel.useMediaCoordinateSpace(({ context, mediaSize }) => this.zeichne(context, mediaSize)) }),
        }
        serie.attachPrimitive(this)
    }

    attached({ requestUpdate }) { this.requestUpdate = requestUpdate }
    detached() { this.requestUpdate = () => {} }
    paneViews() { return [this._ansicht] }
    updateAllViews() {}
    abbauen() { try { this.serie.detachPrimitive(this) } catch { /* weg */ } }

    setze(daten, zeiten, iv, p = {}) {
        this.daten = daten || null
        this.zeiten = zeiten || []
        this.iv = iv || this.iv
        this.p = p || {}
        this.requestUpdate()
    }

    X(t) {
        if (t == null || !this.zeiten.length) return null
        const L = ereignisZuLogisch(t, this.zeiten, this.iv)
        return L == null ? null : logischZuX(this.chart.timeScale(), L)
    }
    Y(p) { return p == null || !Number.isFinite(p) ? null : this.serie.priceToCoordinate(p) }

    label(ctx, text, x, y, hinten, vorne, oben) {
        ctx.font = SCHRIFT
        const w = ctx.measureText(text).width + 10, h = 16
        const x0 = x - w / 2, y0 = oben ? y - h - 6 : y + 6
        ctx.fillStyle = hinten
        ctx.beginPath()
        ctx.roundRect?.(x0, y0, w, h, 3) ?? ctx.rect(x0, y0, w, h)
        ctx.fill()
        // kleiner Zeiger zur Kerze
        ctx.beginPath()
        if (oben) { ctx.moveTo(x - 4, y0 + h); ctx.lineTo(x + 4, y0 + h); ctx.lineTo(x, y0 + h + 5) } else { ctx.moveTo(x - 4, y0); ctx.lineTo(x + 4, y0); ctx.lineTo(x, y0 - 5) }
        ctx.fill()
        ctx.fillStyle = vorne
        ctx.fillText(text, x0 + 5, y0 + 12)
    }

    zeichne(ctx, groesse) {
        const d = this.daten
        if (!d) return
        ctx.save()
        if (d.art === 'lsob') this.lsob(ctx, groesse, d)
        else if (d.art === 'guss') this.guss(ctx, d)
        ctx.restore()
    }

    lsob(ctx, groesse, d) {
        const p = this.p
        const rechts = groesse.width
        for (const b of d.boxen || []) {
            if (!b.gueltig) continue
            const short = b.seite === 'short'
            if (short ? p.cvShort === false : p.cvLong === false) continue
            const farbe = short ? (p.cvFarbeShort || '#ef5350') : (p.cvFarbeLong || '#4caf50')
            const x1 = this.X(b.t), yo = this.Y(b.hoch), yu = this.Y(b.tief)
            if (x1 == null || yo == null || yu == null) continue
            ctx.fillStyle = rgba(farbe, 0.22)
            ctx.fillRect(x1, yo, rechts - x1, yu - yo)
            ctx.strokeStyle = rgba(farbe, 0.9)
            ctx.lineWidth = 1
            ctx.beginPath(); ctx.moveTo(x1, short ? yu : yo); ctx.lineTo(rechts, short ? yu : yo); ctx.stroke()
            ctx.strokeStyle = rgba(farbe, 0.45)
            ctx.strokeRect(x1, yo, rechts - x1, yu - yo)
            if (p.cvLabels !== false) this.label(ctx, 'LSOB', x1 + 18, short ? yo : yu, rgba(farbe, 0.55), '#fff', short)
        }
        if (p.cvVorwarn) {
            ctx.strokeStyle = p.cvVorwarnFarbe || '#2962ff'
            ctx.setLineDash([2, 3])
            for (const v of d.vorwarnungen || []) {
                if (!v.gueltig) continue
                const x1 = this.X(v.vonT), x2 = this.X(v.bisT), y = this.Y(v.preis)
                if (x1 == null || x2 == null || y == null) continue
                ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke()
            }
            ctx.setLineDash([])
        }
        if (p.cvSignale !== false) {
            for (const s of d.signale || []) {
                const short = s.seite === 'short'
                if (short ? p.cvShort === false : p.cvLong === false) continue
                const x = this.X(s.t), y = this.Y(s.preis)
                if (x == null || y == null) continue
                ctx.fillStyle = short ? (p.cvFarbeShort || '#ef5350') : (p.cvFarbeLong || '#4caf50')
                // Pin: Tropfen über (Short) bzw. unter (Long) der Kerze
                const yy = short ? y - 14 : y + 14
                ctx.beginPath(); ctx.arc(x, yy, 5, 0, Math.PI * 2); ctx.fill()
                ctx.beginPath()
                if (short) { ctx.moveTo(x - 4, yy + 2); ctx.lineTo(x + 4, yy + 2); ctx.lineTo(x, yy + 9) } else { ctx.moveTo(x - 4, yy - 2); ctx.lineTo(x + 4, yy - 2); ctx.lineTo(x, yy - 9) }
                ctx.fill()
            }
        }
    }

    guss(ctx, d) {
        for (const e of d.ereignisse || []) {
            // Verfallene Starts werden nicht gezeichnet — nur die mit Einstieg und den offenen.
            if (e.status === 'verfallen') continue
            const lang = e.seite === 'long'
            const name = lang ? 'GUSS' : 'R-GUSS'
            const kraeftig = lang ? '#2e7d32' : '#c62828'
            const blass = lang ? 'rgba(46,125,50,0.55)' : 'rgba(198,40,40,0.55)'
            const xs = this.X(e.startT), ys = this.Y(e.startP)
            if (xs != null && ys != null) this.label(ctx, `${name} Start`, xs, ys, e.status === 'entry' ? kraeftig : blass, 'rgba(255,255,255,0.9)', lang)
            if (e.status !== 'entry') continue
            const xe = this.X(e.entryT), ye = this.Y(e.entryP)
            if (xe != null && ye != null) this.label(ctx, `${name} Entry (${e.ziel})`, xe, ye, lang ? '#4caf50' : '#e53935', lang ? '#000' : '#fff', !lang)
        }
    }
}
