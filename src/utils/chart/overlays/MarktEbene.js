/**
 * Eigene Marktdaten im Kursbild: aufgezeichnete Liquidationen, modellierte
 * Hebelzonen, aktuelle Orderbuch-Wände.
 *
 *   Liquidationen  Blasen an Zeit und Preis, Fläche ∝ USD. Rot = Long
 *                  liquidiert (Zwangsverkauf), grün = Short liquidiert
 *                  (Zwangskauf). Nur für Symbole, die der Rekorder aufzeichnet,
 *                  und dort eine STICHPROBE: Binance sendet höchstens eine
 *                  Liquidation je Sekunde und Symbol.
 *   Hebelzonen     Balken am rechten Rand, Länge ∝ geschätztem Volumen. Ein
 *                  MODELL aus OI-Verlauf und Kerzen, keine Messung — unter der
 *                  Preis Long-Liquidationen (Zwangsverkäufe), darüber Shorts.
 *   Orderbuch      die grössten ruhenden Wände je Seite (Binance-Snapshot),
 *                  ebenfalls als Balken am rechten Rand.
 */
import { zeitZuLogisch, logischZuX } from '../zeichnungen/geometrie.js'

const ROT = '255,105,96'
const GRUEN = '38,166,154'
const SCHRIFT = '10px -apple-system, "Segoe UI", Roboto, sans-serif'

export function usdKurz(v) {
    const a = Math.abs(v)
    if (a >= 1e9) return (v / 1e9).toFixed(1) + ' Mrd'
    if (a >= 1e6) return (v / 1e6).toFixed(1) + ' Mio'
    if (a >= 1e3) return (v / 1e3).toFixed(0) + 'k'
    return v.toFixed(0)
}

/**
 * Wände aus einem Orderbuch: Stufen in Preisbereiche fassen (sonst ist jede
 * Wand über zehn Ticks verteilt und keine fällt auf), dann die grössten je
 * Seite innerhalb ±`spannePct` um die Mitte.
 */
export function waendeAusBuch(buch, { bereichPct = 0.1, spannePct = 5, anzahl = 5 } = {}) {
    const bids = (buch?.bids || []).map(([p, q]) => [Number(p), Number(q)]).filter(([p, q]) => p > 0 && q > 0)
    const asks = (buch?.asks || []).map(([p, q]) => [Number(p), Number(q)]).filter(([p, q]) => p > 0 && q > 0)
    if (!bids.length || !asks.length) return { kaeufe: [], verkaeufe: [], mitte: null }
    const mitte = (Math.max(...bids.map((b) => b[0])) + Math.min(...asks.map((a) => a[0]))) / 2
    const schritt = mitte * (bereichPct / 100)
    const fasse = (stufen) => {
        const karte = new Map()
        for (const [p, q] of stufen) {
            if (Math.abs(p - mitte) / mitte * 100 > spannePct) continue
            const k = Math.round(p / schritt)
            const alt = karte.get(k) || { preis: 0, usd: 0, menge: 0 }
            alt.usd += p * q
            alt.menge += q
            alt.preis += p * q          // usd-gewichteter Preis, unten geteilt
            karte.set(k, alt)
        }
        return [...karte.values()]
            .map((b) => ({ preis: b.preis / b.usd, usd: b.usd }))
            .sort((a, b) => b.usd - a.usd)
            .slice(0, anzahl)
    }
    return { kaeufe: fasse(bids), verkaeufe: fasse(asks), mitte }
}

export class MarktEbene {
    constructor({ chart, serie }) {
        this.chart = chart
        this.serie = serie
        this.zeiten = []
        this.iv = 3_600_000
        this.liq = []            // [{t, price, qty, isBuy}]
        this.zonen = null        // { oben: [{preis, usd, anteil}], unten: [...] }
        this.waende = null       // { kaeufe, verkaeufe }
        this.requestUpdate = () => {}
        this._ansichten = [{
            zOrder: () => 'bottom',
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
    abbauen() { try { this.serie.detachPrimitive(this) } catch { /* weg */ } }

    setzeKerzen(kerzen, iv) { this.zeiten = kerzen.map((k) => k.t); this.iv = iv; this.requestUpdate() }
    setzeLiquidationen(l) { this.liq = l || []; this.requestUpdate() }
    setzeZonen(z) { this.zonen = z; this.requestUpdate() }
    setzeWaende(w) { this.waende = w; this.requestUpdate() }

    zuX(t) { return logischZuX(this.chart.timeScale(), zeitZuLogisch(t, this.zeiten, this.iv)) }
    zuY(p) { return p == null ? null : this.serie.priceToCoordinate(p) }

    zeichne(ctx, groesse) {
        const breite = groesse.width
        ctx.save()
        ctx.font = SCHRIFT
        if (this.liq.length && this.zeiten.length) this.zeichneLiq(ctx, breite)
        if (this.zonen) this.zeichneBalken(ctx, breite, [
            ...(this.zonen.unten || []).map((z) => ({ ...z, rgb: ROT })),
            ...(this.zonen.oben || []).map((z) => ({ ...z, rgb: GRUEN })),
        ], 0.28, 6, '~')
        if (this.waende) this.zeichneBalken(ctx, breite, [
            ...this.waende.kaeufe.map((w) => ({ ...w, rgb: GRUEN })),
            ...this.waende.verkaeufe.map((w) => ({ ...w, rgb: ROT })),
        ], 0.6, 2, '')
        ctx.restore()
    }

    zeichneLiq(ctx, breite) {
        const max = Math.max(...this.liq.map((l) => l.price * l.qty), 1)
        for (const l of this.liq) {
            const x = this.zuX(l.t), y = this.zuY(l.price)
            if (x == null || y == null || x < -10 || x > breite + 10) continue
            const usd = l.price * l.qty
            const r = Math.max(1.5, Math.min(14, Math.sqrt(usd / max) * 14))
            ctx.beginPath()
            ctx.arc(x, y, r, 0, Math.PI * 2)
            ctx.fillStyle = `rgba(${l.isBuy ? GRUEN : ROT},0.45)`
            ctx.fill()
        }
    }

    /** Balken vom rechten Rand nach links, Länge ∝ USD; Beschriftung bei den grössten. */
    zeichneBalken(ctx, breite, eintraege, alpha, dicke, vorsilbe) {
        if (!eintraege.length) return
        const max = Math.max(...eintraege.map((e) => e.usd || 0), 1)
        const laengsteBreite = Math.min(160, breite * 0.25)
        const sortiert = [...eintraege].sort((a, b) => b.usd - a.usd)
        const beschriften = new Set(sortiert.slice(0, 6))
        for (const e of eintraege) {
            const y = this.zuY(e.preis)
            if (y == null) continue
            const l = Math.max(4, (e.usd / max) * laengsteBreite)
            ctx.fillStyle = `rgba(${e.rgb},${alpha})`
            ctx.fillRect(breite - l, y - dicke / 2, l, dicke)
            if (beschriften.has(e)) {
                const text = `${vorsilbe}${usdKurz(e.usd)}`
                const b = ctx.measureText(text).width
                ctx.fillStyle = `rgba(${e.rgb},0.95)`
                ctx.fillText(text, breite - l - b - 4, y + 3)
            }
        }
    }
}
