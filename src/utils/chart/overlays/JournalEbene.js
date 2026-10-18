/**
 * Eigene Trades im Chart — das, was TradingView nicht hat.
 *
 * Je geschlossenem Trade: Pfeil am Einstieg, Punkt am Ausstieg, eine
 * Verbindungslinie in der Farbe des Ergebnisses, Stop und Ziel als Stufen
 * über die Laufzeit — mit jedem Setzen, Verschieben und Entfernen aus dem
 * Bitunix-Verlauf (`tpslStufen`), ausgelöste als ✕ —, Teil-Fills als kleine Punkte und am Ausstieg
 * das Ergebnis in R (wenn ein Stop bekannt ist) und in USDT.
 *
 * Offene Positionen: die Preislinien (Achsenbeschriftung für Einstieg, Stop,
 * Ziel, Liquidation) setzt das Panel; diese Ebene zeichnet dazu den Trade
 * selbst — Dreieck an der Einstiegskerze und die Flächen wie beim
 * Positionswerkzeug von dort bis jetzt (aktueller Stop/Ziel von der Börse),
 * dazu frühere Stufen aus dem Bitunix-Verlauf, falls verschoben wurde.
 *
 * Zeiten in ms; Umrechnung über dieselbe Geometrie wie die Zeichnungen.
 */
import { ereignisZuLogisch, logischZuX, abstandZuStrecke } from '../zeichnungen/geometrie.js'
import { tpslStufen } from '../tpslStufen.js'

const GRUEN = '#26a69a'
const ROT = '#ff6960'
const SCHRIFT = '11px -apple-system, "Segoe UI", Roboto, sans-serif'

export class JournalEbene {
    constructor({ chart, serie, formatPreis }) {
        this.chart = chart
        this.serie = serie
        this.formatPreis = formatPreis
        this.trades = []
        this.offene = []
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

    /** Offene Position: Stop und Ziel gehören ins Bild, auch wenn „Auto" nur die Kerzen einpassen würde. */
    autoscaleInfo() {
        const preise = this.offene.flatMap((p) => [p.einstieg, p.sl, p.tp]).filter((p) => p > 0)
        if (!preise.length) return null
        return { priceRange: { minValue: Math.min(...preise), maxValue: Math.max(...preise) } }
    }

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

    setzeOffene(liste) {
        this.offene = (liste || []).filter((p) => p.einstiegT && p.einstieg)
        this.requestUpdate()
    }

    hebeHervor(id) {
        this.hervor = id
        this.requestUpdate()
    }

    // Ereignisse sitzen IN ihrer Kerze (siehe ereignisZuLogisch), nicht auf der Teilung zwischen zwei Öffnungen.
    zuX(t) { return logischZuX(this.chart.timeScale(), ereignisZuLogisch(t, this.zeiten, this.iv)) }
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
        if ((!this.trades.length && !this.offene.length) || !this.zeiten.length) return
        ctx.save()
        ctx.font = SCHRIFT
        for (const tr of this.trades) this.zeichneTrade(ctx, tr, groesse.width)
        for (const pos of this.offene) this.zeichneOffen(ctx, pos, groesse.width)
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

        // Stop und Ziel als Stufen über die Laufzeit: jede Änderung aus dem
        // Bitunix-Verlauf eine eigene Stufe, senkrecht verbunden. Ohne Verlauf
        // nur Anfangs-Stop und Ziel.
        const SL_F = 'rgba(255,105,96,0.75)', TP_F = 'rgba(38,166,154,0.75)'
        const strich = (x1, y1, x2, y2, f, muster) => {
            ctx.strokeStyle = f
            ctx.lineWidth = hervor ? 1.5 : 1
            ctx.setLineDash(muster)
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
            ctx.setLineDash([])
        }
        const ende = tr.ausstieg?.t ?? Date.now()
        const { stufen, ausgeloest } = tpslStufen(tr.tpslVerlauf, tr.einstieg.t, ende)
        if (stufen.length) {
            const letzte = {}
            for (const s of stufen) {
                const x1 = this.zuX(s.von), x2 = this.zuX(s.bis) ?? xEnde, y = this.zuY(s.preis)
                if (x1 == null || y == null) continue
                const f = s.art === 'SL' ? SL_F : TP_F
                strich(x1, y, x2, y, f, [4, 3])
                const v = letzte[s.art]
                if (v && v.bis === s.von) strich(x1, v.y, x1, y, f, [1, 2])
                if (s.anteil != null && (hervor || x2 - x1 > 40)) {
                    ctx.fillStyle = f
                    ctx.fillText(`${Math.round(s.anteil * 100)} %`, x1 + 3, y - 3)
                }
                letzte[s.art] = { bis: s.bis, y }
            }
            for (const a of ausgeloest) {
                const x = this.zuX(a.t), y = this.zuY(a.preis)
                if (x == null || y == null) continue
                const f = a.art === 'SL' ? ROT : GRUEN
                strich(x - 4, y - 4, x + 4, y + 4, f, [])
                strich(x - 4, y + 4, x + 4, y - 4, f, [])
            }
        } else {
            if (tr.anfangsStop) strich(ex, this.zuY(tr.anfangsStop), xEnde, this.zuY(tr.anfangsStop), SL_F, [4, 3])
            if (tr.tp) strich(ex, this.zuY(tr.tp), xEnde, this.zuY(tr.tp), TP_F, [4, 3])
        }

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

    /** Offene Position wie das Positionswerkzeug: Flächen ab Einstieg bis 20 Kerzen nach jetzt. */
    zeichneOffen(ctx, pos, breite) {
        const jetzt = Date.now()
        const ex = this.zuX(pos.einstiegT), ey = this.zuY(pos.einstieg), xj = this.zuX(jetzt + 20 * this.iv)
        if (ex == null || ey == null || xj == null) return
        const long = pos.richtung === 'long'
        // Rechts endet die Box am Bildrand — sonst stünden Fläche und Schilder halb ausserhalb.
        const b = Math.max(Math.min(xj, breite - 2) - ex, 12)
        const yz = this.zuY(pos.tp), ys = this.zuY(pos.sl)
        if (yz != null) { ctx.fillStyle = 'rgba(38,166,154,0.18)'; ctx.fillRect(ex, Math.min(ey, yz), b, Math.abs(yz - ey)) }
        if (ys != null) { ctx.fillStyle = 'rgba(255,105,96,0.18)'; ctx.fillRect(ex, Math.min(ey, ys), b, Math.abs(ys - ey)) }
        ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + b, ey); ctx.stroke()

        // Frühere Stufen (verschoben): nur die, die schon geendet haben — die aktuelle ist die Fläche.
        const { stufen, ausgeloest } = tpslStufen(pos.tpslVerlauf, pos.einstiegT, jetzt)
        const letzteTp = [...(pos.tpslVerlauf || [])].filter((h) => h.art === 'TP' && (h.aktion === 'set' || h.aktion === 'moved')).sort((a, c) => a.t - c.t).pop()
        for (const s of stufen) {
            if (s.bis >= jetzt - 1000) continue
            const x1 = this.zuX(s.von), x2 = this.zuX(s.bis), y = this.zuY(s.preis)
            if (x1 == null || x2 == null || y == null) continue
            ctx.strokeStyle = s.art === 'SL' ? 'rgba(255,105,96,0.75)' : 'rgba(38,166,154,0.75)'
            ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.setLineDash([])
        }
        for (const a of ausgeloest) {
            const x = this.zuX(a.t), y = this.zuY(a.preis)
            if (x == null || y == null) continue
            ctx.strokeStyle = a.art === 'SL' ? ROT : GRUEN
            ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x - 4, y + 4); ctx.lineTo(x + 4, y - 4); ctx.stroke()
        }

        // Beschriftung wie beim Werkzeug: Richtung · R (Ziel gegen Stop), Teil-Ziel mit Anteil.
        const rr = pos.tp && pos.sl && Math.abs(pos.einstieg - pos.sl) > 0 ? Math.abs(pos.tp - pos.einstieg) / Math.abs(pos.einstieg - pos.sl) : null
        // Schilder in die Box; ist rechts zu wenig Platz, links davor (rechtsbündig).
        const schild = (text, x, y, farbe) => {
            const w = ctx.measureText(text).width
            if (x + w + 6 > breite - 2) x = Math.max(2, ex - w - 10)
            ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - 2, y - 11, w + 6, 15)
            ctx.fillStyle = farbe; ctx.fillText(text, x + 1, y)
        }
        const pct = (p) => { const v = ((p - pos.einstieg) / pos.einstieg) * 100; return `${v >= 0 ? '+' : ''}${v.toFixed(2)} %` }
        schild(`${long ? 'Long' : 'Short'}${rr != null ? ` · ${rr.toFixed(2)} R` : ''}`, ex + 4, ey - 4, '#e0e0e0')
        if (yz != null) {
            const anteil = letzteTp && letzteTp.menge > 0 && letzteTp.posMenge > 0 && letzteTp.menge < letzteTp.posMenge * 0.999 ? ` · ${Math.round((letzteTp.menge / letzteTp.posMenge) * 100)} % der Position` : ''
            schild(`Ziel ${this.formatPreis(pos.tp)} (${pct(pos.tp)})${anteil}`, ex + 4, yz + (yz < ey ? 13 : -4), GRUEN)
        }
        if (ys != null) schild(`Stop ${this.formatPreis(pos.sl)} (${pct(pos.sl)})`, ex + 4, ys + (ys < ey ? 13 : -4), ROT)

        // Einstieg: Dreieck in Handelsrichtung.
        const g = 6
        ctx.fillStyle = long ? GRUEN : ROT
        ctx.beginPath()
        if (long) { ctx.moveTo(ex, ey - g); ctx.lineTo(ex - g, ey + g * 0.6); ctx.lineTo(ex + g, ey + g * 0.6) }
        else { ctx.moveTo(ex, ey + g); ctx.lineTo(ex - g, ey - g * 0.6); ctx.lineTo(ex + g, ey - g * 0.6) }
        ctx.closePath(); ctx.fill()
        ctx.strokeStyle = '#131722'; ctx.stroke()
    }
}
