/**
 * Eigene Trades im Chart — das, was TradingView nicht hat.
 *
 * Je geschlossenem Trade: Pfeil am Einstieg, Punkt am Ausstieg, eine
 * Verbindungslinie in der Farbe des Ergebnisses, Anfangs-Stop und Ziel als
 * kurze Stufen über die Laufzeit, Teil-Fills als kleine Punkte und am Ausstieg
 * das Ergebnis in R (wenn ein Stop bekannt ist) und in USDT.
 *
 * Offene Positionen zeichnet diese Ebene NICHT selbst: dafür nimmt das Panel
 * Preislinien der Bibliothek, die bringen die Achsenbeschriftung mit — und
 * Einstieg, Stop, Ziel und Liquidation einer offenen Position will man an der
 * Achse ablesen.
 *
 * Zeiten in ms; Umrechnung über dieselbe Geometrie wie die Zeichnungen.
 */
import { zeitZuLogisch, logischZuX, abstandZuStrecke } from '../zeichnungen/geometrie.js'

const GRUEN = '#26a69a'
const ROT = '#ff6960'
const SCHRIFT = '11px -apple-system, "Segoe UI", Roboto, sans-serif'

export class JournalEbene {
    constructor({ chart, serie, formatPreis }) {
        this.chart = chart
        this.serie = serie
        this.formatPreis = formatPreis
        this.trades = []
        this.zeiten = []
        this.iv = 3_600_000
        this.hervor = null           // id des hervorgehobenen Trades
        this.requestUpdate = () => {}
        this._ansichten = [{
            zOrder: () => 'normal',
            renderer: () => ({
                draw: (ziel) => ziel.useMediaCoordinateSpace(({ context, mediaSize }) => this.zeichne(context, mediaSize)),
            }),
        }]
        serie.attachPrimitive(this)
    }

    attached({ requestUpdate }) { this.requestUpdate = requestUpdate }
    detached() { this.requestUpdate = () => {} }
    paneViews() { return this._ansichten }
    updateAllViews() {}

    hitTest(x, y) {
        const t = this.trefferTest(x, y)
        return t ? { cursorStyle: 'pointer', externalId: 'trade:' + t.id, zOrder: 'normal' } : null
    }

    abbauen() {
        try { this.serie.detachPrimitive(this) } catch { /* Chart schon weg */ }
    }

    setzeKerzen(kerzen, iv) {
        this.zeiten = kerzen.map((k) => k.t)
        this.iv = iv
        this.requestUpdate()
    }

    setzeTrades(trades) {
        this.trades = trades || []
        this.requestUpdate()
    }

    hebeHervor(id) {
        this.hervor = id
        this.requestUpdate()
    }

    zuX(t) { return logischZuX(this.chart.timeScale(), zeitZuLogisch(t, this.zeiten, this.iv)) }
    zuY(p) { return p == null ? null : this.serie.priceToCoordinate(p) }

    /** Trade unter (x, y): Einstieg, Ausstieg oder Verbindungslinie. */
    trefferTest(x, y) {
        for (let i = this.trades.length - 1; i >= 0; i--) {
            const tr = this.trades[i]
            const ex = this.zuX(tr.einstieg.t), ey = this.zuY(tr.einstieg.p)
            if (ex == null || ey == null) continue
            if (Math.hypot(x - ex, y - ey) <= 9) return tr
            if (tr.ausstieg) {
                const ax = this.zuX(tr.ausstieg.t), ay = this.zuY(tr.ausstieg.p)
                if (ax == null || ay == null) continue
                if (Math.hypot(x - ax, y - ay) <= 9) return tr
                if (abstandZuStrecke(x, y, ex, ey, ax, ay) <= 4) return tr
            }
        }
        return null
    }

    zeichne(ctx, groesse) {
        if (!this.trades.length || !this.zeiten.length) return
        ctx.save()
        ctx.font = SCHRIFT
        for (const tr of this.trades) this.zeichneTrade(ctx, tr, groesse.width)
        ctx.restore()
    }

    zeichneTrade(ctx, tr, breite) {
        const ex = this.zuX(tr.einstieg.t), ey = this.zuY(tr.einstieg.p)
        if (ex == null || ey == null) return
        const ax = tr.ausstieg ? this.zuX(tr.ausstieg.t) : null
        const ay = tr.ausstieg ? this.zuY(tr.ausstieg.p) : null
        // Ausserhalb des Bildes nichts zeichnen (aber Linien, die hineinragen, schon).
        const rechts = ax ?? ex
        if (rechts < -40 || ex > breite + 40) return

        const gewinn = (tr.netto ?? 0) >= 0
        const farbe = gewinn ? GRUEN : ROT
        const hervor = this.hervor === tr.id
        const xEnde = ax ?? ex + 30

        // Anfangs-Stop und Ziel als Stufen über die Laufzeit.
        const stufe = (preis, f) => {
            const y = this.zuY(preis)
            if (y == null) return
            ctx.strokeStyle = f
            ctx.lineWidth = 1
            ctx.setLineDash([4, 3])
            ctx.beginPath(); ctx.moveTo(ex, y); ctx.lineTo(xEnde, y); ctx.stroke()
            ctx.setLineDash([])
        }
        if (tr.anfangsStop) stufe(tr.anfangsStop, 'rgba(255,105,96,0.7)')
        if (tr.tp) stufe(tr.tp, 'rgba(38,166,154,0.7)')

        // Verbindungslinie Einstieg → Ausstieg.
        if (ax != null && ay != null) {
            ctx.strokeStyle = farbe
            ctx.lineWidth = hervor ? 2.5 : 1.5
            ctx.setLineDash([5, 3])
            ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ax, ay); ctx.stroke()
            ctx.setLineDash([])
        }

        // Teil-Fills: kleine Punkte (Zukauf hohl, Teilschluss gefüllt).
        for (const f of tr.fills || []) {
            const fx = this.zuX(f.t), fy = this.zuY(f.p)
            if (fx == null || fy == null) continue
            ctx.beginPath()
            ctx.arc(fx, fy, 2.5, 0, Math.PI * 2)
            ctx.fillStyle = f.reduzierend ? '#e0e0e0' : 'transparent'
            ctx.strokeStyle = '#e0e0e0'
            ctx.lineWidth = 1
            ctx.fill(); ctx.stroke()
        }

        // Einstieg: Dreieck in Handelsrichtung.
        const long = tr.richtung === 'long'
        const g = hervor ? 8 : 6
        ctx.fillStyle = long ? GRUEN : ROT
        ctx.beginPath()
        if (long) { ctx.moveTo(ex, ey - g); ctx.lineTo(ex - g, ey + g * 0.6); ctx.lineTo(ex + g, ey + g * 0.6) }
        else { ctx.moveTo(ex, ey + g); ctx.lineTo(ex - g, ey - g * 0.6); ctx.lineTo(ex + g, ey - g * 0.6) }
        ctx.closePath(); ctx.fill()
        ctx.strokeStyle = '#131722'; ctx.lineWidth = 1; ctx.stroke()

        // Ausstieg: Kreis in der Ergebnisfarbe, daneben das Ergebnis.
        if (ax != null && ay != null) {
            ctx.beginPath()
            ctx.arc(ax, ay, hervor ? 6 : 4.5, 0, Math.PI * 2)
            ctx.fillStyle = farbe
            ctx.fill()
            ctx.strokeStyle = '#131722'; ctx.stroke()
            const teile = []
            if (tr.r != null) teile.push(`${tr.r >= 0 ? '+' : ''}${tr.r.toFixed(2)}R`)
            if (tr.netto != null) teile.push(`${tr.netto >= 0 ? '+' : ''}${tr.netto.toFixed(2)}`)
            const text = teile.join(' · ')
            if (text) {
                const b = ctx.measureText(text).width
                const tx = ax + 8
                const ty = ay + (long === gewinn ? -8 : 14)
                ctx.fillStyle = 'rgba(19,23,34,0.8)'
                ctx.fillRect(tx - 3, ty - 11, b + 6, 15)
                ctx.fillStyle = farbe
                ctx.fillText(text, tx, ty)
            }
        }
    }
}
