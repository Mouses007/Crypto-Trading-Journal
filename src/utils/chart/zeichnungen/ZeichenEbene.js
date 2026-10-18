/**
 * Zeichenebene eines Chart-Panels: zeichnet alle Zeichnungen und bedient sie.
 *
 * Technisch ein „Series Primitive" von Lightweight Charts, an der Kerzenserie
 * befestigt — so liegt es im Kerzen-Pane, bekommt Achsenbeschriftungen und
 * wird bei jedem Neuzeichnen der Bibliothek mitgezeichnet. Die Bedienung
 * (zeichnen, auswählen, ziehen) läuft über Zeigerereignisse auf dem
 * Chart-Behälter in der CAPTURE-Phase: nur dort lässt sich verhindern, dass
 * die Bibliothek denselben Mausdruck als Verschieben des Charts versteht.
 *
 * Gespeichert wird hier nichts. Alles, was bleibt, geht über Rückrufe an die
 * Vue-Seite (`neu`, `aendern`, `auswahl`, `werkzeugFertig`, `textBearbeiten`).
 */
import {
    zeitZuLogisch, logischZuZeit, logischZuX, abstandZuStrecke, verlaengere, preisAufGerade,
    fibPreise, positionWerte, magnet, imRechteck, messung, dauerText,
} from './geometrie.js'
import { werkzeug, stilFuer } from './werkzeuge.js'

const ANKER = 5
const TREFFER = 6
const SCHRIFT = '11px -apple-system, "Segoe UI", Roboto, sans-serif'

function mitAlpha(farbe, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(farbe || '')
    if (!m) return farbe
    const n = parseInt(m[1], 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

function strichMuster(strich, breite) {
    if (strich === 'gestrichelt') return [6 * breite, 4 * breite]
    if (strich === 'gepunktet') return [breite, 3 * breite]
    return []
}

export class ZeichenEbene {
    /**
     * @param {object} o
     * @param {HTMLElement} o.huelle   Behälter des Charts (für Zeigerereignisse)
     * @param {object} o.chart         Lightweight-Charts-Instanz
     * @param {object} o.serie         Kerzenserie (Primitive hängt daran)
     * @param {object} o.rueckruf      { neu, aendern, auswahl, werkzeugFertig, textBearbeiten }
     * @param {function} o.formatPreis
     */
    constructor({ huelle, chart, serie, rueckruf, formatPreis }) {
        this.huelle = huelle
        this.chart = chart
        this.serie = serie
        this.rueckruf = rueckruf
        this.formatPreis = formatPreis || ((p) => String(p))
        this.zeiten = []
        this.kerzen = []
        this.iv = 3_600_000
        this.zeichnungen = []
        this.auswahlId = null
        this.hoverId = null
        this.werkzeugTyp = null
        this.entwurf = null           // { typ, punkte }
        this.messErgebnis = null      // [a, b] nach einer Messung
        this.magnetAn = false
        this.ziehen = null            // { id, anker, x0, y0, L0, p0, orig }
        this.vorschau = new Map()     // id → punkte während des Ziehens
        this.temporaer = []           // Vorschau (KI-Analyse): gezeichnet, nicht bedienbar
        this.verschlucke = false
        this.preisAchsen = []
        this.requestUpdate = () => {}

        const ansicht = {
            zOrder: () => 'top',
            renderer: () => ({
                draw: (ziel) => ziel.useMediaCoordinateSpace(({ context, mediaSize }) => this.zeichne(context, mediaSize)),
            }),
        }
        this._ansichten = [ansicht]

        this._unten = (e) => this.zeigerUnten(e)
        this._bewegt = (e) => this.zeigerBewegt(e)
        this._oben = (e) => this.zeigerOben(e)
        this._schlucken = (e) => { if (this.verschlucke) { e.stopPropagation(); e.preventDefault() } }
        this._doppel = (e) => this.doppelklick(e)
        huelle.addEventListener('pointerdown', this._unten, true)
        huelle.addEventListener('pointermove', this._bewegt, true)
        huelle.addEventListener('pointerup', this._oben, true)
        huelle.addEventListener('pointercancel', this._oben, true)
        huelle.addEventListener('mousedown', this._schlucken, true)
        huelle.addEventListener('touchstart', this._schlucken, { capture: true, passive: false })
        huelle.addEventListener('dblclick', this._doppel, true)
        serie.attachPrimitive(this)
    }

    // ── Primitive-Schnittstelle ──────────────────────────────────────────
    attached({ requestUpdate }) { this.requestUpdate = requestUpdate }
    detached() { this.requestUpdate = () => {} }
    paneViews() { return this._ansichten }
    updateAllViews() { this.preisAchsen = this.baueAchsen() }
    priceAxisViews() { return this.preisAchsen }

    /** Zeiger-Symbol: die Bibliothek setzt es, wenn hier etwas getroffen wird. */
    hitTest(x, y) {
        if (this.werkzeugTyp) return { cursorStyle: 'crosshair', externalId: 'zeichnen', zOrder: 'top' }
        const t = this.trefferTest(x, y)
        if (!t) return null
        const z = t.z
        return { cursorStyle: z.gesperrt ? 'default' : t.anker != null ? 'grab' : 'move', externalId: String(z.id), zOrder: 'top' }
    }

    abbauen() {
        const h = this.huelle
        h.removeEventListener('pointerdown', this._unten, true)
        h.removeEventListener('pointermove', this._bewegt, true)
        h.removeEventListener('pointerup', this._oben, true)
        h.removeEventListener('pointercancel', this._oben, true)
        h.removeEventListener('mousedown', this._schlucken, true)
        h.removeEventListener('touchstart', this._schlucken, true)
        h.removeEventListener('dblclick', this._doppel, true)
        try { this.serie.detachPrimitive(this) } catch { /* Chart schon weg */ }
    }

    // ── Zustand von aussen ───────────────────────────────────────────────
    setzeKerzen(kerzen, iv) {
        this.kerzen = kerzen
        this.zeiten = kerzen.map((k) => k.t)
        this.iv = iv
        this.requestUpdate()
    }

    setzeZeichnungen(liste) {
        this.zeichnungen = liste
        // Eine Vorschau gilt nur, bis der gespeicherte Stand zurückkommt.
        for (const id of [...this.vorschau.keys()]) {
            if (!this.ziehen || this.ziehen.id !== id) this.vorschau.delete(id)
        }
        if (this.auswahlId != null && !liste.some((z) => z.id === this.auswahlId)) this.auswahlId = null
        this.requestUpdate()
    }

    setzeWerkzeug(typ) {
        this.werkzeugTyp = typ || null
        this.entwurf = null
        if (typ) this.auswahlId = null
        this.requestUpdate()
    }

    setzeAuswahl(id) {
        this.auswahlId = id
        this.requestUpdate()
    }

    setzeMagnet(an) { this.magnetAn = !!an }

    setzeTemporaer(liste) {
        this.temporaer = liste || []
        this.requestUpdate()
    }

    abbrechen() {
        const etwas = !!(this.entwurf || this.messErgebnis || this.werkzeugTyp)
        this.entwurf = null
        this.messErgebnis = null
        this.requestUpdate()
        return etwas
    }

    // ── Koordinaten ──────────────────────────────────────────────────────
    zuL(t) { return zeitZuLogisch(t, this.zeiten, this.iv) }
    zuX(t) { return logischZuX(this.chart.timeScale(), this.zuL(t)) }
    zuY(p) { return this.serie.priceToCoordinate(p) }
    vonX(x) {
        const L = this.chart.timeScale().coordinateToLogical(x)
        return L == null ? null : logischZuZeit(L, this.zeiten, this.iv)
    }
    vonY(y) { return this.serie.coordinateToPrice(y) }

    /** Punkt aus Bildschirmkoordinaten; Zeit rastet auf Kerzen, Preis optional per Magnet. */
    punktAus(x, y) {
        let L = this.chart.timeScale().coordinateToLogical(x)
        if (L == null) return null
        L = Math.round(L)
        const t = logischZuZeit(L, this.zeiten, this.iv)
        let p = this.vonY(y)
        if (p == null) return null
        if (this.magnetAn && L >= 0 && L < this.kerzen.length) {
            const toleranz = Math.abs(this.vonY(y + 14) - p)
            p = magnet(p, this.kerzen[L], toleranz)
        }
        return { t, p }
    }

    lokal(e) {
        const r = this.huelle.getBoundingClientRect()
        const x = e.clientX - r.left
        const y = e.clientY - r.top
        const breite = this.chart.timeScale().width()
        const hoehe = this.chart.panes()[0]?.getHeight() ?? r.height
        return { x, y, innen: x >= 0 && x < breite && y >= 0 && y < hoehe }
    }

    punkteVon(z) { return this.vorschau.get(z.id) || z.punkte }

    // ── Anker und Treffer ────────────────────────────────────────────────
    /** Anfasspunkte einer Zeichnung in Pixeln. */
    ankerVon(z, breite) {
        const pk = this.punkteVon(z)
        const X = (t) => this.zuX(t)
        const Y = (p) => this.zuY(p)
        const mitte = (x) => (x == null || x < 0 || x > breite ? breite / 2 : x)
        switch (z.typ) {
            case 'horizontale': return [{ x: mitte(X(pk[0].t)), y: Y(pk[0].p) }]
            case 'strahlH': return [{ x: X(pk[0].t), y: Y(pk[0].p) }]
            case 'vertikale': return [{ x: X(pk[0].t), y: 40 }]
            case 'position': {
                const x0 = X(pk[0].t)
                const x1 = X(pk[1].t)
                return [
                    { x: x0, y: Y(pk[0].p) },
                    { x: x0, y: Y(pk[1].p) },
                    { x: x0, y: Y(pk[2].p) },
                    { x: x1, y: Y(pk[0].p) },
                ]
            }
            default: return pk.map((q) => ({ x: X(q.t), y: Y(q.p) }))
        }
    }

    /** Was liegt unter (x, y)? Anker der Auswahl zuerst, dann jüngste Zeichnung zuerst. */
    trefferTest(x, y) {
        const breite = this.chart.timeScale().width()
        const reihe = [...this.zeichnungen].reverse()
        const ausgewaehlt = reihe.find((z) => z.id === this.auswahlId)
        if (ausgewaehlt && !ausgewaehlt.gesperrt) {
            const a = this.ankerVon(ausgewaehlt, breite).findIndex((q) => q.x != null && q.y != null && Math.hypot(q.x - x, q.y - y) <= ANKER + 3)
            if (a >= 0) return { z: ausgewaehlt, anker: a }
        }
        for (const z of reihe) if (this.trifft(z, x, y, breite)) return { z, anker: null }
        return null
    }

    trifft(z, x, y, breite) {
        const pk = this.punkteVon(z)
        const s = stilFuer(z)
        const X = (t) => this.zuX(t)
        const Y = (p) => this.zuY(p)
        switch (z.typ) {
            case 'horizontale': { const yy = Y(pk[0].p); return yy != null && Math.abs(y - yy) <= TREFFER }
            case 'strahlH': { const yy = Y(pk[0].p); const xx = X(pk[0].t); return yy != null && xx != null && x >= xx - TREFFER && Math.abs(y - yy) <= TREFFER }
            case 'vertikale': { const xx = X(pk[0].t); return xx != null && Math.abs(x - xx) <= TREFFER }
            case 'trendlinie':
            case 'strahl': {
                const [a, b] = pk.map((q) => ({ x: X(q.t), y: Y(q.p) }))
                if ([a.x, a.y, b.x, b.y].some((v) => v == null)) return false
                return abstandZuStrecke(x, y, a.x, a.y, b.x, b.y, { links: !!s.links, rechts: z.typ === 'strahl' || !!s.rechts }) <= TREFFER
            }
            case 'kanal': {
                const g = this.kanalGeraden(pk)
                if (!g) return false
                return g.some(([a, b]) => abstandZuStrecke(x, y, a.x, a.y, b.x, b.y) <= TREFFER) ||
                    (s.fuellung && this.imKanal(x, y, g))
            }
            case 'rechteck': {
                const x1 = X(pk[0].t), y1 = Y(pk[0].p), y2 = Y(pk[1].p)
                const x2 = s.rechts ? breite : X(pk[1].t)
                return [x1, y1, x2, y2].every((v) => v != null) && imRechteck(x, y, x1, y1, x2, y2, TREFFER)
            }
            case 'fib': {
                const x1 = X(pk[0].t), x2 = s.rechts ? breite : X(pk[1].t)
                if (x1 == null || x2 == null) return false
                if (x < Math.min(x1, x2) - TREFFER || x > Math.max(x1, x2) + TREFFER) return false
                return fibPreise(pk[0].p, pk[1].p).some((f) => Math.abs(Y(f.preis) - y) <= TREFFER)
            }
            case 'position': {
                const x1 = X(pk[0].t), x2 = X(pk[1].t)
                const ys = [Y(pk[0].p), Y(pk[1].p), Y(pk[2].p)]
                if ([x1, x2, ...ys].some((v) => v == null)) return false
                return imRechteck(x, y, x1, Math.min(...ys), x2, Math.max(...ys), 2)
            }
            case 'text': {
                const xx = X(pk[0].t), yy = Y(pk[0].p)
                if (xx == null || yy == null) return false
                const breiteText = Math.max(30, (s.text || '').length * (s.groesse || 13) * 0.6)
                return imRechteck(x, y, xx - 4, yy - (s.groesse || 13), xx + breiteText, yy + 6)
            }
            default: return false
        }
    }

    kanalGeraden(pk) {
        const [a, b, c] = pk
        const La = this.zuL(a.t), Lb = this.zuL(b.t), Lc = this.zuL(c?.t ?? b.t)
        if (La == null || Lb == null) return null
        const versatz = c ? c.p - preisAufGerade(Lc, La, a.p, Lb, b.p) : 0
        const P = (t, p) => ({ x: this.zuX(t), y: this.zuY(p) })
        const g1 = [P(a.t, a.p), P(b.t, b.p)]
        const g2 = [P(a.t, a.p + versatz), P(b.t, b.p + versatz)]
        if ([...g1, ...g2].some((q) => q.x == null || q.y == null)) return null
        return [g1, g2]
    }

    imKanal(x, y, [g1, g2]) {
        const [a, b] = g1
        if (x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x) || b.x === a.x) return false
        const u = (x - a.x) / (b.x - a.x)
        const y1 = a.y + u * (b.y - a.y)
        const y2 = g2[0].y + u * (g2[1].y - g2[0].y)
        return y >= Math.min(y1, y2) && y <= Math.max(y1, y2)
    }

    // ── Bedienung ────────────────────────────────────────────────────────
    zeigerUnten(e) {
        if (e.button !== undefined && e.button !== 0) return
        const { x, y, innen } = this.lokal(e)
        if (!innen) return
        if (this.werkzeugTyp) {
            this.verschlucke = true
            e.stopPropagation()
            e.preventDefault()
            this.klick(x, y)
            return
        }
        if (this.messErgebnis) { this.messErgebnis = null; this.requestUpdate() }
        const t = this.trefferTest(x, y)
        if (!t) {
            if (this.auswahlId != null) { this.auswahlId = null; this.rueckruf.auswahl?.(null); this.requestUpdate() }
            return
        }
        if (this.auswahlId !== t.z.id) { this.auswahlId = t.z.id; this.rueckruf.auswahl?.(t.z.id); this.requestUpdate() }
        if (t.z.gesperrt) return
        this.verschlucke = true
        e.stopPropagation()
        e.preventDefault()
        try { this.huelle.setPointerCapture(e.pointerId) } catch { /* egal */ }
        this.ziehen = {
            id: t.z.id, anker: t.anker, typ: t.z.typ,
            L0: this.chart.timeScale().coordinateToLogical(x), p0: this.vonY(y),
            orig: this.punkteVon(t.z).map((q) => ({ ...q })), bewegt: false,
        }
    }

    zeigerBewegt(e) {
        const { x, y } = this.lokal(e)
        if (this.ziehen) {
            e.stopPropagation()
            const neu = this.gezogen(x, y, e.shiftKey)
            if (neu) {
                this.ziehen.bewegt = true
                this.vorschau.set(this.ziehen.id, neu)
                this.requestUpdate()
            }
            return
        }
        if (this.entwurf) {
            const pt = this.punktAus(x, y)
            if (!pt) return
            const pk = this.entwurf.punkte
            if (e.shiftKey && pk.length > 1) pt.p = pk[pk.length - 2].p
            pk[pk.length - 1] = pt
            this.requestUpdate()
        }
    }

    zeigerOben(e) {
        this.verschlucke = false
        if (!this.ziehen) return
        const z = this.ziehen
        this.ziehen = null
        try { this.huelle.releasePointerCapture(e.pointerId) } catch { /* egal */ }
        const neu = this.vorschau.get(z.id)
        if (z.bewegt && neu) this.rueckruf.aendern?.(z.id, { punkte: neu })
        else this.vorschau.delete(z.id)
        this.requestUpdate()
    }

    doppelklick(e) {
        const { x, y, innen } = this.lokal(e)
        if (!innen || this.werkzeugTyp) return
        const t = this.trefferTest(x, y)
        if (t && (t.z.typ === 'text' || t.z.typ === 'horizontale' || t.z.typ === 'strahlH' || t.z.typ === 'rechteck')) {
            e.stopPropagation()
            this.rueckruf.textBearbeiten?.(t.z.id)
        }
    }

    /** Neue Punkte beim Ziehen: ganzer Körper oder ein Anker. */
    gezogen(x, y, shift) {
        const z = this.ziehen
        const orig = z.orig
        if (z.anker == null) {
            const L = this.chart.timeScale().coordinateToLogical(x)
            const p = this.vonY(y)
            if (L == null || p == null || z.L0 == null || z.p0 == null) return null
            const dL = Math.round(L - z.L0)
            const dp = p - z.p0
            return orig.map((q) => ({
                t: z.typ === 'horizontale' ? q.t : logischZuZeit(this.zuL(q.t) + dL, this.zeiten, this.iv),
                p: z.typ === 'vertikale' ? q.p : q.p + dp,
            }))
        }
        const pt = this.punktAus(x, y)
        if (!pt) return null
        const neu = orig.map((q) => ({ ...q }))
        if (z.typ === 'position') {
            if (z.anker === 0) { neu[0] = pt }
            else if (z.anker === 1) neu[1] = { t: orig[1].t, p: pt.p }
            else if (z.anker === 2) neu[2] = { t: orig[2].t, p: pt.p }
            else if (pt.t > orig[0].t) { neu[1] = { t: pt.t, p: orig[1].p }; neu[2] = { t: pt.t, p: orig[2].p } }
            return neu
        }
        if (z.typ === 'horizontale') return [{ t: orig[0].t, p: pt.p }]
        if (z.typ === 'vertikale') return [{ t: pt.t, p: orig[0].p }]
        if (shift && (z.typ === 'trendlinie' || z.typ === 'strahl')) pt.p = orig[1 - z.anker].p
        neu[z.anker] = pt
        return neu
    }

    klick(x, y) {
        const pt = this.punktAus(x, y)
        if (!pt) return
        const def = werkzeug(this.werkzeugTyp)
        if (!def) return
        if (!this.entwurf) {
            if (def.klicks === 1) { this.fertig([pt]); return }
            this.entwurf = { typ: def.typ, punkte: [pt, { ...pt }] }
            this.requestUpdate()
            return
        }
        const pk = this.entwurf.punkte
        pk[pk.length - 1] = pt
        if (pk.length < def.klicks) { pk.push({ ...pt }); this.requestUpdate(); return }
        this.fertig(pk)
    }

    fertig(punkte) {
        const typ = this.werkzeugTyp
        this.entwurf = null
        if (typ === 'messen') {
            this.messErgebnis = punkte
        } else {
            let pk = punkte
            if (typ === 'position') {
                const [e, z] = pk
                const ende = z.t > e.t ? z.t : e.t + 20 * this.iv
                // Ziel = zweiter Klick; Stop gespiegelt bei 1R — wird danach gezogen.
                pk = [e, { t: ende, p: z.p }, { t: ende, p: e.p - (z.p - e.p) }]
            }
            if (typ === 'rechteck' || typ === 'fib' || typ === 'trendlinie' || typ === 'strahl') {
                if (pk[0].t === pk[1].t && pk[0].p === pk[1].p) { this.rueckruf.werkzeugFertig?.(); this.requestUpdate(); return }
            }
            this.rueckruf.neu?.({ typ, punkte: pk })
        }
        this.rueckruf.werkzeugFertig?.()
        this.requestUpdate()
    }

    // ── Zeichnen ─────────────────────────────────────────────────────────
    zeichne(ctx, groesse) {
        const breite = groesse.width
        const hoehe = groesse.height
        ctx.save()
        ctx.font = SCHRIFT
        for (const z of this.temporaer) this.zeichneEine(ctx, z, z.punkte, breite, hoehe, false)
        for (const z of this.zeichnungen) {
            this.zeichneEine(ctx, z, this.punkteVon(z), breite, hoehe, z.id === this.auswahlId)
        }
        if (this.entwurf) this.zeichneEine(ctx, { id: -1, typ: this.entwurf.typ, stil: {} }, this.entwurfPunkte(), breite, hoehe, true)
        if (this.messErgebnis) this.zeichneEine(ctx, { id: -2, typ: 'messen', stil: {} }, this.messErgebnis, breite, hoehe, false)
        ctx.restore()
    }

    entwurfPunkte() {
        const pk = this.entwurf.punkte
        if (this.entwurf.typ === 'position' && pk.length === 2) {
            const [e, z] = pk
            const ende = z.t > e.t ? z.t : e.t + 20 * this.iv
            return [e, { t: ende, p: z.p }, { t: ende, p: e.p - (z.p - e.p) }]
        }
        if (this.entwurf.typ === 'kanal' && pk.length === 2) return [...pk, pk[1]]
        return pk
    }

    linie(ctx, ax, ay, bx, by, s) {
        ctx.beginPath()
        ctx.strokeStyle = s.farbe
        ctx.lineWidth = s.breite || 1
        ctx.setLineDash(strichMuster(s.strich, s.breite || 1))
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
        ctx.setLineDash([])
    }

    beschriftung(ctx, text, x, y, farbe, { hinten = null, rechtsbuendig = false } = {}) {
        if (!text) return
        const b = ctx.measureText(text).width
        const xx = rechtsbuendig ? x - b - 6 : x
        if (hinten) {
            ctx.fillStyle = hinten
            ctx.fillRect(xx - 3, y - 11, b + 6, 15)
        }
        ctx.fillStyle = farbe
        ctx.fillText(text, xx, y)
    }

    zeichneEine(ctx, z, pk, breite, hoehe, ausgewaehlt) {
        const s = stilFuer(z)
        const X = (t) => this.zuX(t)
        const Y = (p) => this.zuY(p)
        const fehlt = (...v) => v.some((w) => w == null || !Number.isFinite(w))
        switch (z.typ) {
            case 'horizontale': {
                const y = Y(pk[0].p)
                if (fehlt(y)) return
                this.linie(ctx, 0, y, breite, y, s)
                if (s.text) this.beschriftung(ctx, s.text, 8, y - 4, s.farbe)
                break
            }
            case 'strahlH': {
                const x = X(pk[0].t), y = Y(pk[0].p)
                if (fehlt(x, y)) return
                this.linie(ctx, x, y, breite, y, s)
                if (s.text) this.beschriftung(ctx, s.text, x + 6, y - 4, s.farbe)
                break
            }
            case 'vertikale': {
                const x = X(pk[0].t)
                if (fehlt(x)) return
                this.linie(ctx, x, 0, x, hoehe, s)
                break
            }
            case 'trendlinie':
            case 'strahl': {
                const ax = X(pk[0].t), ay = Y(pk[0].p), bx = X(pk[1].t), by = Y(pk[1].p)
                if (fehlt(ax, ay, bx, by)) return
                const v = verlaengere(ax, ay, bx, by, breite, { links: !!s.links, rechts: z.typ === 'strahl' || !!s.rechts })
                this.linie(ctx, v.ax, v.ay, v.bx, v.by, s)
                if (s.text) this.beschriftung(ctx, s.text, bx + 6, by - 4, s.farbe, { hinten: 'rgba(0,0,0,0.45)' })
                break
            }
            case 'kanal': {
                const g = this.kanalGeraden(pk)
                if (!g) return
                const [[a1, b1], [a2, b2]] = g
                if (s.fuellung) {
                    ctx.fillStyle = mitAlpha(s.farbe, 0.12)
                    ctx.beginPath()
                    ctx.moveTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(a2.x, a2.y)
                    ctx.closePath(); ctx.fill()
                }
                this.linie(ctx, a1.x, a1.y, b1.x, b1.y, s)
                this.linie(ctx, a2.x, a2.y, b2.x, b2.y, s)
                this.linie(ctx, a1.x, (a1.y + a2.y) / 2, b1.x, (b1.y + b2.y) / 2, { ...s, strich: 'gestrichelt', breite: 1 })
                break
            }
            case 'rechteck': {
                const x1 = X(pk[0].t), y1 = Y(pk[0].p), y2 = Y(pk[1].p)
                const x2 = s.rechts ? breite : X(pk[1].t)
                if (fehlt(x1, y1, x2, y2)) return
                if (s.fuellung) {
                    ctx.fillStyle = mitAlpha(s.farbe, 0.15)
                    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
                }
                ctx.strokeStyle = s.farbe
                ctx.lineWidth = s.breite || 1
                ctx.setLineDash(strichMuster(s.strich, s.breite || 1))
                ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
                ctx.setLineDash([])
                if (s.text) this.beschriftung(ctx, s.text, Math.min(x1, x2) + 6, Math.min(y1, y2) + 14, s.farbe)
                break
            }
            case 'fib': {
                const x1 = X(pk[0].t), x2 = s.rechts ? breite : X(pk[1].t)
                if (fehlt(x1, x2)) return
                const links = Math.min(x1, x2), rechts = Math.max(x1, x2)
                const stufen = fibPreise(pk[0].p, pk[1].p)
                const FARBEN = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#787b86', '#2962ff']
                for (let i = 0; i < stufen.length; i++) {
                    const y = Y(stufen[i].preis)
                    if (fehlt(y)) continue
                    const farbe = FARBEN[i % FARBEN.length]
                    if (i > 0) {
                        const yv = Y(stufen[i - 1].preis)
                        if (!fehlt(yv)) { ctx.fillStyle = mitAlpha(farbe, 0.08); ctx.fillRect(links, Math.min(y, yv), rechts - links, Math.abs(y - yv)) }
                    }
                    this.linie(ctx, links, y, rechts, y, { farbe, breite: 1, strich: 'voll' })
                    this.beschriftung(ctx, `${stufen[i].stufe} (${this.formatPreis(stufen[i].preis)})`, links + 4, y - 3, farbe)
                }
                const ay = Y(pk[0].p), by = Y(pk[1].p)
                if (!fehlt(ay, by)) this.linie(ctx, X(pk[0].t), ay, X(pk[1].t), by, { farbe: 'rgba(255,255,255,0.3)', breite: 1, strich: 'gestrichelt' })
                break
            }
            case 'position': {
                const x1 = X(pk[0].t), x2 = X(pk[1].t)
                const ye = Y(pk[0].p), yz = Y(pk[1].p), ys = Y(pk[2].p)
                if (fehlt(x1, x2, ye, yz, ys)) return
                const w = positionWerte(pk[0].p, pk[1].p, pk[2].p)
                const l = Math.min(x1, x2), b = Math.abs(x2 - x1)
                ctx.fillStyle = 'rgba(38,166,154,0.22)'
                ctx.fillRect(l, Math.min(ye, yz), b, Math.abs(yz - ye))
                ctx.fillStyle = 'rgba(255,105,96,0.22)'
                ctx.fillRect(l, Math.min(ye, ys), b, Math.abs(ys - ye))
                this.linie(ctx, l, ye, l + b, ye, { farbe: '#e0e0e0', breite: 1, strich: 'voll' })
                const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} %`
                this.beschriftung(ctx, `${w.long ? 'Long' : 'Short'} · ${w.rr != null ? w.rr.toFixed(2) : '—'} R${w.stimmig ? '' : ' ⚠'}`, l + 4, ye - 4, '#e0e0e0', { hinten: 'rgba(0,0,0,0.55)' })
                this.beschriftung(ctx, `Ziel ${this.formatPreis(pk[1].p)} (${pct(w.zielPct)})`, l + 4, yz + (yz < ye ? 13 : -4), '#26a69a', { hinten: 'rgba(0,0,0,0.55)' })
                this.beschriftung(ctx, `Stop ${this.formatPreis(pk[2].p)} (${pct(w.stopPct)})`, l + 4, ys + (ys < ye ? 13 : -4), '#ff6960', { hinten: 'rgba(0,0,0,0.55)' })
                break
            }
            case 'text': {
                const x = X(pk[0].t), y = Y(pk[0].p)
                if (fehlt(x, y)) return
                ctx.font = `${s.groesse || 13}px -apple-system, "Segoe UI", Roboto, sans-serif`
                this.beschriftung(ctx, s.text || '…', x, y, s.farbe, { hinten: 'rgba(0,0,0,0.45)' })
                ctx.font = SCHRIFT
                break
            }
            case 'messen': {
                const [a, b] = pk
                const x1 = X(a.t), y1 = Y(a.p), x2 = X(b.t), y2 = Y(b.p)
                if (fehlt(x1, y1, x2, y2)) return
                const m = messung(a, b, this.iv)
                const farbe = m.dp >= 0 ? '#26a69a' : '#ff6960'
                ctx.fillStyle = mitAlpha(farbe, 0.15)
                ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
                this.linie(ctx, x1, y1, x2, y2, { farbe, breite: 1, strich: 'gestrichelt' })
                const text = `${m.dp >= 0 ? '+' : ''}${this.formatPreis(m.dp)} (${m.pct >= 0 ? '+' : ''}${m.pct.toFixed(2)} %) · ${m.kerzen} Kerzen · ${dauerText(m.dauerMs)}`
                this.beschriftung(ctx, text, (x1 + x2) / 2 - ctx.measureText(text).width / 2, Math.max(y1, y2) + 16, '#fff', { hinten: mitAlpha(farbe, 0.85) })
                break
            }
        }
        if (ausgewaehlt) this.zeichneAnker(ctx, z, breite)
    }

    zeichneAnker(ctx, z, breite) {
        const anker = z.id === -1 ? (this.entwurf?.punkte || []).map((q) => ({ x: this.zuX(q.t), y: this.zuY(q.p) })) : this.ankerVon(z, breite)
        for (const a of anker) {
            if (a.x == null || a.y == null) continue
            ctx.beginPath()
            ctx.arc(a.x, a.y, ANKER, 0, Math.PI * 2)
            ctx.fillStyle = '#131722'
            ctx.fill()
            ctx.lineWidth = 1.5
            ctx.strokeStyle = '#29b6f6'
            ctx.stroke()
        }
    }

    /** Preisbeschriftung an der Achse: Horizontalen immer, Auswahl an ihren Punkten. */
    baueAchsen() {
        const aus = []
        const etikett = (p, farbe) => ({
            coordinate: () => this.zuY(p) ?? -100,
            text: () => this.formatPreis(p),
            textColor: () => '#ffffff',
            backColor: () => farbe,
            visible: () => true,
            tickVisible: () => true,
        })
        for (const z of this.zeichnungen) {
            const s = stilFuer(z)
            const pk = this.punkteVon(z)
            if (z.typ === 'horizontale' || z.typ === 'strahlH') aus.push(etikett(pk[0].p, s.farbe))
            else if (z.id === this.auswahlId) {
                if (z.typ === 'position') { aus.push(etikett(pk[1].p, '#26a69a')); aus.push(etikett(pk[2].p, '#ff6960')); aus.push(etikett(pk[0].p, '#787b86')) }
                else if (z.typ !== 'vertikale') for (const q of pk) aus.push(etikett(q.p, '#29b6f6'))
            }
        }
        return aus
    }
}
