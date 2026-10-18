/**
 * Mo's Momentum Radar als Datenfenster im Chart — gezeichnet wie der Pine-
 * Indikator (und wie die Kachel `KachelMomentum.vue`), nicht als zwei nackte
 * Linien.
 *
 * Die Rechnung kommt fertig vom Server (`server/momentum-radar.js`, Konstanten
 * 1:1 aus dem Pine); hier wird nur gezeichnet, in der Reihenfolge des Pine:
 *   unten   Marken ±100/±50/0, Schienen ±115, Schatten (Signallinie als Fläche),
 *           helle Wellenfläche, Geldfluss je Kerze (violett = Futures treiben),
 *           weisse Spot-Linie, 4h-Farbleiste am unteren Rand
 *   (dazwischen zeichnet die Bibliothek Welle und Signallinie als Serien)
 *   oben    Punkte (gross = höhere Zeitebenen stützen), Rauten, Schienen-Punkte
 *           der höheren Zeitebenen, Divergenz-Linien mit „DIV"
 *
 * Flächen laufen bis zur NULLLINIE, nicht bis zum Panelboden — eine
 * Flächenserie der Bibliothek füllt nach unten, deshalb zeichnet sie dieses
 * Primitive selbst.
 */
import { zeitZuLogisch, logischZuX } from './zeichnungen/geometrie.js'

/** Farben aus dem Pine (Gruppe 7) — dieselben wie in der Kachel. */
export const MOMENTUM_FARBEN = {
    welle: '#6fa8ff',
    schatten: '#1f3a8a',
    signal: '#3d63d6',
    rein: '#4caf50',
    raus: '#c62828',
    futures: '#8e6cef',
    long: '#4caf50',
    short: '#ef5350',
    longStark: '#00e676',
    shortStark: '#ff1744',
    extrem: '#ffa726',
}
const TF_FARBE = { '1h': '#ffa726', '4h': '#ba68c8', '1d': '#ffffff', '1w': '#ffd54f' }
const TF_RADIUS = { '1h': 2.5, '4h': 3.5, '1d': 4.5, '1w': 5.5 }
const F = MOMENTUM_FARBEN

/** Wertebereich des Fensters: Schienen bei ±115, Farbleiste darunter — wie im Pine. */
export const MOMENTUM_BEREICH = [-140, 128]
const SCHIENE = 115

function alpha(hex, a) {
    const n = parseInt(hex.slice(1), 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export class MomentumZeichnung {
    constructor({ chart, serie }) {
        this.chart = chart
        this.serie = serie
        this.v = null
        this.zeiten = []
        this.iv = 3_600_000
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

    setze(verlauf, zeiten, iv) {
        this.v = verlauf || null
        this.zeiten = zeiten || []
        this.iv = iv || this.iv
        this.requestUpdate()
    }

    X(i) {
        const t = this.v?.t?.[i]
        if (t == null) return null
        return logischZuX(this.chart.timeScale(), zeitZuLogisch(t, this.zeiten, this.iv))
    }
    Y(w) { return w == null ? null : this.serie.priceToCoordinate(w) }

    /** Abstand zweier Kerzen in Pixeln — für Balken- und Punktgrössen. */
    schritt() {
        const a = this.chart.timeScale().logicalToCoordinate(0)
        const b = this.chart.timeScale().logicalToCoordinate(1)
        return a != null && b != null ? Math.abs(b - a) : 6
    }

    waagerecht(ctx, w, breite, farbe, dicke, strich = []) {
        const y = this.Y(w)
        if (y == null) return
        ctx.strokeStyle = farbe
        ctx.lineWidth = dicke
        ctx.setLineDash(strich)
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(breite, y); ctx.stroke()
        ctx.setLineDash([])
    }

    /** Fläche zwischen Reihe und Nulllinie, je zusammenhängendem Stück. */
    flaeche(ctx, werte, farbe) {
        if (!Array.isArray(werte)) return
        const y0 = this.Y(0)
        if (y0 == null) return
        let stueck = []
        const schliesse = () => {
            if (stueck.length > 1) {
                ctx.beginPath()
                ctx.moveTo(stueck[0][0], y0)
                for (const [x, y] of stueck) ctx.lineTo(x, y)
                ctx.lineTo(stueck[stueck.length - 1][0], y0)
                ctx.closePath()
                ctx.fillStyle = farbe
                ctx.fill()
            }
            stueck = []
        }
        for (let i = 0; i < werte.length; i++) {
            const x = this.X(i), y = this.Y(werte[i])
            if (x == null || y == null || werte[i] == null) { schliesse(); continue }
            stueck.push([x, y])
        }
        schliesse()
    }

    linie(ctx, werte, farbe, dicke) {
        if (!Array.isArray(werte)) return
        ctx.strokeStyle = farbe
        ctx.lineWidth = dicke
        ctx.beginPath()
        let offen = false
        for (let i = 0; i < werte.length; i++) {
            const x = this.X(i), y = this.Y(werte[i])
            if (x == null || y == null || werte[i] == null) { offen = false; continue }
            if (offen) ctx.lineTo(x, y); else ctx.moveTo(x, y)
            offen = true
        }
        ctx.stroke()
    }

    unten(ctx, groesse) {
        const v = this.v
        const breite = groesse.width
        // Marken wie im Pine: ±100 Extrem, ±50 überkauft/-verkauft (kräftig), 0 gestrichelt.
        this.waagerecht(ctx, 100, breite, alpha('#e0e0e0', 0.65), 1)
        this.waagerecht(ctx, -100, breite, alpha('#e0e0e0', 0.65), 1)
        this.waagerecht(ctx, 50, breite, 'rgba(255,255,255,0.75)', 2)
        this.waagerecht(ctx, -50, breite, 'rgba(255,255,255,0.75)', 2)
        this.waagerecht(ctx, 0, breite, alpha('#787b86', 0.55), 1, [4, 4])
        this.waagerecht(ctx, SCHIENE, breite, alpha(F.short, 0.45), 1)
        this.waagerecht(ctx, -SCHIENE, breite, alpha(F.long, 0.45), 1)
        if (!v || !this.zeiten.length) return

        this.flaeche(ctx, v.w2, alpha(F.schatten, 0.85))
        this.flaeche(ctx, v.w1, alpha(F.welle, 0.45))

        // Geldfluss als Balken je Kerze: nur so kann jede Kerze ihre Farbe haben (violett).
        const s = this.schritt()
        const b = Math.max(1, s * 0.92)
        const y0 = this.Y(0)
        if (Array.isArray(v.mf) && y0 != null) {
            for (let i = 0; i < v.mf.length; i++) {
                const w = v.mf[i]
                const x = this.X(i), y = this.Y(w)
                if (w == null || x == null || y == null) continue
                const tr = v.treiber?.[i]
                ctx.fillStyle = alpha(tr === 'f' ? F.futures : w >= 0 ? F.rein : F.raus, 0.95)
                ctx.fillRect(x - b / 2, Math.min(y, y0), b, Math.max(0.5, Math.abs(y - y0)))
            }
        }
        // Weisse Linie = Spotmarkt (läuft sie unter der Fläche, sind die Futures voraus).
        if (Array.isArray(v.mfSpot)) this.linie(ctx, v.mfSpot, 'rgba(255,255,255,0.85)', 1)

        // Farbleiste: 4h-Geldfluss, ganz unten.
        const ya = this.Y(-SCHIENE - 8), yb = this.Y(-SCHIENE - 18)
        if (Array.isArray(v.mf4) && ya != null && yb != null) {
            const bl = Math.max(1, s)
            for (let i = 0; i < v.mf4.length; i++) {
                const x = this.X(i)
                if (x == null) continue
                const w = v.mf4[i]
                ctx.fillStyle = w == null ? 'rgba(120,123,134,0.4)' : alpha(w >= 0 ? F.rein : F.raus, 0.75)
                ctx.fillRect(x - bl / 2, Math.min(ya, yb), bl, Math.abs(yb - ya))
            }
        }
    }

    oben(ctx) {
        const v = this.v
        if (!v || !this.zeiten.length) return
        const s = this.schritt()
        const faktor = Math.max(0.7, Math.min(1.6, s / 6))

        for (const d of v.divergenzen || []) {
            const x1 = this.X(d.i1), y1 = this.Y(d.w1), x2 = this.X(d.i2), y2 = this.Y(d.w2)
            if ([x1, y1, x2, y2].some((q) => q == null)) continue
            const farbe = d.seite === 'long' ? F.long : F.short
            ctx.strokeStyle = farbe
            ctx.lineWidth = 2
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
            for (const [x, y] of [[x1, y1], [x2, y2]]) {
                ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = farbe; ctx.fill()
            }
            ctx.font = '9px -apple-system, "Segoe UI", Roboto, sans-serif'
            ctx.fillStyle = farbe
            ctx.fillText('DIV', (x1 + x2) / 2 - 8, (y1 + y2) / 2 - 4)
        }

        for (const p of v.punkte || []) {
            const x = this.X(p.i), y = this.Y(v.w1?.[p.i] ?? 0)
            if (x == null || y == null) continue
            const r = (p.stark ? 4.5 : 2.6) * faktor
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
            ctx.fillStyle = p.seite === 'long' ? (p.stark ? F.longStark : F.long) : (p.stark ? F.shortStark : F.short)
            ctx.fill()
        }

        for (const r of v.rauten || []) {
            const x = this.X(r.i), y = this.Y(v.w1?.[r.i] ?? 0)
            if (x == null || y == null) continue
            const g = 3.5 * faktor
            ctx.beginPath()
            ctx.moveTo(x, y - g); ctx.lineTo(x + g, y); ctx.lineTo(x, y + g); ctx.lineTo(x - g, y)
            ctx.closePath()
            ctx.fillStyle = F.extrem
            ctx.fill()
        }

        for (const sp of v.schienen || []) {
            const x = this.X(sp.i), y = this.Y(sp.seite === 'long' ? -SCHIENE : SCHIENE)
            if (x == null || y == null) continue
            ctx.beginPath(); ctx.arc(x, y, (TF_RADIUS[sp.tf] || 3) * faktor, 0, Math.PI * 2)
            ctx.fillStyle = TF_FARBE[sp.tf] || '#ffffff'
            ctx.fill()
        }
    }
}
