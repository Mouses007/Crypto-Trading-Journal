/**
 * Indikatoren „LSOB" und „GUSS": die Setups, die die Strategie über die
 * geladene Historie gefunden hätte (`server/chart-signale.js`), als Primitive
 * im Kerzen-Pane.
 *
 *   Zone (Order Block bzw. EMA-Band)  von ihrer Kerze bis zum Ende des Setups
 *   Sweep-Marke                       kurze gestrichelte Linie am überbotenen Niveau
 *   Auslösung                         Dreieck am Einstieg
 *   Einstieg / Stop / Ziel            ab der Auslösung bis zum Ausgang
 *   Ausgang                           „Ziel" grün, „Stop" rot, „offen" grau
 *
 * Verworfene und abgelaufene Setups bleiben blass sichtbar — sie zeigen, wo
 * die Strategie hinsah und warum nichts kam.
 */
import { ereignisZuLogisch, logischZuX } from './zeichnungen/geometrie.js'

const SCHRIFT = '11px -apple-system, "Segoe UI", Roboto, sans-serif'
const GRUEN = '#26a69a'
const ROT = '#ef5350'

function rgba(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '')
    if (!m) return hex
    const n = parseInt(m[1], 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export class SignalZeichnung {
    constructor({ chart, serie }) {
        this.chart = chart
        this.serie = serie
        this.daten = null
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

    setze(daten, zeiten, iv) {
        this.daten = daten || null
        this.zeiten = zeiten || []
        this.iv = iv || this.iv
        this.requestUpdate()
    }

    X(t) {
        if (t == null || !this.zeiten.length) return null
        const L = ereignisZuLogisch(t, this.zeiten, this.iv)
        return L == null ? null : logischZuX(this.chart.timeScale(), L)
    }
    Y(p) { return p == null || !Number.isFinite(p) ? null : this.serie.priceToCoordinate(p) }

    zeichne(ctx, groesse) {
        const setups = this.daten?.setups
        if (!Array.isArray(setups) || !setups.length) return
        ctx.save()
        ctx.font = SCHRIFT
        const rechts = groesse.width
        const bisT = this.zeiten[this.zeiten.length - 1]
        for (const s of setups) {
            const long = s.direction === 'long'
            const farbe = long ? GRUEN : ROT
            const aktiv = s.status === 'triggered' || s.status === 'waiting_retest' || s.status === 'pending'
            const blass = !aktiv
            // Zone: von ihrer Kerze bis zum Ende (Auslösung, Verwerfen) — offen bis jetzt
            const x1 = this.X(s.obCandleTime ?? s.sweepCandleTime)
            const x2 = this.X(s.endeT ?? bisT) ?? rechts
            const yo = this.Y(s.obHigh), yu = this.Y(s.obLow)
            if (x1 != null && yo != null && yu != null) {
                ctx.fillStyle = rgba(farbe, blass ? 0.06 : 0.16)
                ctx.fillRect(x1, Math.min(yo, yu), Math.max(1, x2 - x1), Math.abs(yu - yo))
                ctx.strokeStyle = rgba(farbe, blass ? 0.25 : 0.6)
                ctx.lineWidth = 1
                ctx.strokeRect(x1, Math.min(yo, yu), Math.max(1, x2 - x1), Math.abs(yu - yo))
            }
            // Sweep-Marke
            const xs = this.X(s.sweepCandleTime), ys = this.Y(s.sweepLevel)
            if (xs != null && ys != null) {
                ctx.strokeStyle = rgba('#f5c542', blass ? 0.35 : 0.85)
                ctx.setLineDash([3, 3])
                ctx.beginPath(); ctx.moveTo(xs - 30, ys); ctx.lineTo(xs + 10, ys); ctx.stroke()
                ctx.setLineDash([])
            }
            if (s.status !== 'triggered') continue
            // Auslösung: Dreieck unter (long) bzw. über (short) dem Einstieg
            const xe = this.X(s.triggeredAt), ye = this.Y(s.entry)
            if (xe == null || ye == null) continue
            ctx.fillStyle = farbe
            ctx.beginPath()
            if (long) { ctx.moveTo(xe, ye + 2); ctx.lineTo(xe - 6, ye + 12); ctx.lineTo(xe + 6, ye + 12) }
            else { ctx.moveTo(xe, ye - 2); ctx.lineTo(xe - 6, ye - 12); ctx.lineTo(xe + 6, ye - 12) }
            ctx.closePath(); ctx.fill()
            // Einstieg, Stop, Ziel bis zum Ausgang
            const xa = s.exitT ? (this.X(s.exitT) ?? rechts) : rechts
            const linie = (p, f, strich) => {
                const y = this.Y(p)
                if (y == null || !(p > 0)) return
                ctx.strokeStyle = f
                ctx.setLineDash(strich)
                ctx.beginPath(); ctx.moveTo(xe, y); ctx.lineTo(xa, y); ctx.stroke()
                ctx.setLineDash([])
            }
            linie(s.entry, 'rgba(224,224,224,0.7)', [])
            linie(s.stopLoss, rgba(ROT, 0.8), [4, 3])
            linie(s.takeProfit, rgba(GRUEN, 0.8), [4, 3])
            if (s.ausgang && s.ausgang !== 'offen') {
                const text = s.ausgang === 'ziel' ? '✓ Ziel' : '✗ Stop'
                const yt = this.Y(s.exitP)
                if (yt != null) {
                    const b = ctx.measureText(text).width
                    ctx.fillStyle = 'rgba(0,0,0,0.55)'
                    ctx.fillRect(xa + 3, yt - 9, b + 6, 13)
                    ctx.fillStyle = s.ausgang === 'ziel' ? GRUEN : ROT
                    ctx.fillText(text, xa + 6, yt + 1)
                }
            }
        }
        ctx.restore()
    }
}
