/**
 * Eigene Marktdaten im Kursbild: aufgezeichnete Liquidationen, modellierte
 * Hebelzonen, aktuelle Orderbuch-Wände.
 *
 *   Liquidationen  JE KERZE UND SEITE zu einer Blase gebündelt (Fläche ∝ USD,
 *                  Höhe = volumengewichteter Preis). Rot = Long liquidiert
 *                  (Zwangsverkauf), grün = Short liquidiert (Zwangskauf). Die
 *                  grössten tragen ihren Betrag. Einzelblasen je Ereignis gingen
 *                  unter: tausende Punkte, fast alle 1,5 px, gemessen an der
 *                  einen grössten. Nur für Symbole, die der Rekorder aufzeichnet,
 *                  und dort eine STICHPROBE: Binance sendet höchstens eine
 *                  Liquidation je Sekunde und Symbol.
 *   Hebelzonen     Balken am rechten Rand, Länge ∝ geschätztem Volumen. Ein
 *                  MODELL aus OI-Verlauf und Kerzen, keine Messung — unter dem
 *                  Preis Long-Liquidationen (Zwangsverkäufe), darüber Shorts.
 *   Orderbuch      ruhende Wände (Binance-Snapshot): gestrichelte Linie über die
 *                  ganze Breite und ein beschrifteter Balken rechts. Eine Wand
 *                  ist eine Preiszone, die DEUTLICH über dem Median der Zonen
 *                  ihrer Seite liegt — die grössten Zonen allein wären fast immer
 *                  nur das dichte Buch direkt am Kurs.
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

function median(werte) {
    if (!werte.length) return 0
    const s = [...werte].sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Wände aus einem Orderbuch: Stufen in Preiszonen fassen (sonst ist jede Wand
 * über zehn Ticks verteilt und keine fällt auf) — ~`zonenJeSeite` Zonen über die
 * Reichweite des Buchs —, dann je Seite die Zonen, die
 * mindestens `faktor` × Median der Zonen dieser Seite tragen — höchstens
 * `anzahl`. Der Preis einer Zone ist USD-gewichtet: Σ p·usd / Σ usd.
 *
 * `spanne` sagt, wie weit das Buch reicht: 500 Stufen sind bei SOL ±4,8 %,
 * bei BTC nur ±0,07 % — weiter weg kann der Snapshot keine Wand zeigen.
 */
export function waendeAusBuch(buch, { zonenJeSeite = 40, spannePct = 5, anzahl = 4, faktor = 2.5 } = {}) {
    const bids = (buch?.bids || []).map(([p, q]) => [Number(p), Number(q)]).filter(([p, q]) => p > 0 && q > 0)
    const asks = (buch?.asks || []).map(([p, q]) => [Number(p), Number(q)]).filter(([p, q]) => p > 0 && q > 0)
    if (!bids.length || !asks.length) return { kaeufe: [], verkaeufe: [], mitte: null, spanne: null }
    const bestBid = Math.max(...bids.map((b) => b[0]))
    const bestAsk = Math.min(...asks.map((a) => a[0]))
    const mitte = (bestBid + bestAsk) / 2
    const tiefst = Math.min(...bids.map((b) => b[0]))
    const hoechst = Math.max(...asks.map((a) => a[0]))
    // Zonenbreite nach der Reichweite des Buchs: 500 Stufen sind bei SOL ±4,8 %,
    // bei ETH ±0,1 % — eine feste Breite gäbe dort drei Zonen und keine Aussage.
    const reicht = Math.min(mitte - tiefst, hoechst - mitte, mitte * spannePct / 100)
    const schritt = Math.max(reicht / zonenJeSeite, mitte * 1e-7)
    const fasse = (stufen) => {
        const karte = new Map()
        for (const [p, q] of stufen) {
            if (Math.abs(p - mitte) / mitte * 100 > spannePct) continue
            const k = Math.round(p / schritt)
            const alt = karte.get(k) || { pUsd: 0, usd: 0 }
            const usd = p * q
            alt.usd += usd
            alt.pUsd += p * usd
            karte.set(k, alt)
        }
        const zonen = [...karte.values()].map((b) => ({ preis: b.pUsd / b.usd, usd: b.usd }))
        const m = median(zonen.map((z) => z.usd))
        return zonen
            .filter((z) => zonen.length < 4 || z.usd >= m * faktor)
            .sort((a, b) => b.usd - a.usd)
            .slice(0, anzahl)
            .map((z) => ({ ...z, vielfaches: m > 0 ? z.usd / m : null }))
    }
    return {
        kaeufe: fasse(bids),
        verkaeufe: fasse(asks),
        mitte,
        spanne: { unten: (mitte - tiefst) / mitte * 100, oben: (hoechst - mitte) / mitte * 100 },
    }
}

/**
 * Liquidationen je Kerze und Seite bündeln: Summe USD, volumengewichteter
 * Preis, Anzahl. Ereignisse vor der ersten Kerze fallen weg.
 * @returns [{ i, t, long: bool, usd, preis, anzahl }]
 */
export function liqJeKerze(liq, zeiten) {
    if (!liq?.length || !zeiten?.length) return []
    const sortiert = [...liq].sort((a, b) => a.t - b.t)
    const aus = new Map()
    let i = 0
    for (const l of sortiert) {
        if (l.t < zeiten[0]) continue
        while (i + 1 < zeiten.length && zeiten[i + 1] <= l.t) i++
        // isBuy = Zwangskauf = Short liquidiert; sonst Long liquidiert
        const long = !l.isBuy
        const k = `${i}|${long}`
        const usd = l.price * l.qty
        const alt = aus.get(k) || { i, t: zeiten[i], long, usd: 0, pUsd: 0, anzahl: 0 }
        alt.usd += usd
        alt.pUsd += l.price * usd
        alt.anzahl++
        aus.set(k, alt)
    }
    return [...aus.values()].map(({ pUsd, ...b }) => ({ ...b, preis: pUsd / b.usd }))
}

/**
 * Wände auf dem Bildschirm entzerren. Bei BTC reicht das Buch nur ±0,07 %:
 * alle Wände liegen in wenigen Pixeln um den Kurs, und ihre Schilder standen
 * übereinander („Bid … Bid 1.2 B…"). Darum:
 *   1. Wände DERSELBEN Seite, die näher als `zusammen` px liegen, werden eine
 *      (USD addiert, Höhe der grösseren) — auf diesem Zoom sind sie eine.
 *   2. Schilder nach Grösse vergeben; liegt ein Schild näher als `abstand` px
 *      an einem schon vergebenen, bleibt es weg — Linie und Balken nicht.
 * @param {Array<{y, usd, seite}>} wände
 * @returns dieselben (zusammengefasst) mit `schild: bool`
 */
export function platziereSchilder(waende, { zusammen = 4, abstand = 13 } = {}) {
    const sortiert = [...waende].sort((a, b) => b.usd - a.usd)
    const eins = []
    for (const w of sortiert) {
        const nah = eins.find((e) => e.seite === w.seite && Math.abs(e.y - w.y) < zusammen)
        if (nah) nah.usd += w.usd
        else eins.push({ ...w })
    }
    const belegt = []
    for (const w of eins) {
        w.schild = !belegt.some((y) => Math.abs(y - w.y) < abstand)
        if (w.schild) belegt.push(w.y)
    }
    return eins
}

export class MarktEbene {
    /**
     * @param {object} [o.texte]  Beschriftungen (aus der Übersetzung):
     *   { kauf, verkauf, liqLong, liqShort } — „Bid/Ask" und ein nacktes „~18 Mio"
     *   musste man erst nachfragen.
     */
    constructor({ chart, serie, texte = {} }) {
        this.chart = chart
        this.serie = serie
        this.texte = { kauf: 'Kaufwand', verkauf: 'Verkaufswand', liqLong: 'Liq. Longs', liqShort: 'Liq. Shorts', ...texte }
        this.zeiten = []
        this.iv = 3_600_000
        this.liq = []            // [{t, price, qty, isBuy}]
        this.liqKerzen = []      // gebündelt, siehe liqJeKerze
        this.zonen = null        // { oben: [{preis, usd, anteil}], unten: [...] }
        this.waende = null       // { kaeufe, verkaeufe }
        this.requestUpdate = () => {}
        const ansicht = (z, fn) => ({
            zOrder: () => z,
            renderer: () => ({ draw: (ziel) => ziel.useMediaCoordinateSpace(({ context, mediaSize }) => fn(context, mediaSize)) }),
        })
        // Hebelzonen hinter den Kerzen (Hintergrund-Modell); Wände und
        // Liquidationen davor — sonst verschwinden sie unter Kerzen und Dochten.
        this._ansichten = [ansicht('bottom', (c, g) => this.unten(c, g)), ansicht('top', (c, g) => this.oben(c, g))]
        serie.attachPrimitive(this)
    }

    attached({ requestUpdate }) { this.requestUpdate = requestUpdate }
    detached() { this.requestUpdate = () => {} }
    paneViews() { return this._ansichten }
    updateAllViews() {}
    abbauen() { try { this.serie.detachPrimitive(this) } catch { /* weg */ } }

    setzeKerzen(kerzen, iv) {
        this.zeiten = kerzen.map((k) => k.t)
        this.iv = iv
        this.liqKerzen = liqJeKerze(this.liq, this.zeiten)
        this.requestUpdate()
    }
    setzeLiquidationen(l) { this.liq = l || []; this.liqKerzen = liqJeKerze(this.liq, this.zeiten); this.requestUpdate() }
    setzeZonen(z) { this.zonen = z; this.requestUpdate() }
    setzeWaende(w) { this.waende = w; this.requestUpdate() }

    zuX(t) { return logischZuX(this.chart.timeScale(), zeitZuLogisch(t, this.zeiten, this.iv)) }
    zuY(p) { return p == null ? null : this.serie.priceToCoordinate(p) }

    unten(ctx, groesse) {
        if (!this.zonen) return
        ctx.save()
        ctx.font = SCHRIFT
        // Unter dem Kurs würden Longs liquidiert (Zwangsverkäufe), darüber Shorts (Zwangskäufe).
        this.zeichneBalken(ctx, groesse.width, [
            ...(this.zonen.unten || []).map((z) => ({ ...z, rgb: ROT, vorsilbe: `${this.texte.liqLong} ~` })),
            ...(this.zonen.oben || []).map((z) => ({ ...z, rgb: GRUEN, vorsilbe: `${this.texte.liqShort} ~` })),
        ], 0.28, 6, '~', 160)
        ctx.restore()
    }

    oben(ctx, groesse) {
        ctx.save()
        ctx.font = SCHRIFT
        if (this.waende) this.zeichneWaende(ctx, groesse.width)
        if (this.liqKerzen.length && this.zeiten.length) this.zeichneLiq(ctx, groesse.width)
        ctx.restore()
    }

    zeichneWaende(ctx, breite) {
        const alle = [
            ...this.waende.kaeufe.map((w) => ({ ...w, rgb: GRUEN, seite: 'Bid', name: this.texte.kauf })),
            ...this.waende.verkaeufe.map((w) => ({ ...w, rgb: ROT, seite: 'Ask', name: this.texte.verkauf })),
        ].map((w) => ({ ...w, y: this.zuY(w.preis) })).filter((w) => w.y != null)
        if (!alle.length) return
        const platz = platziereSchilder(alle)
        const max = Math.max(...platz.map((e) => e.usd), 1)
        const lang = Math.min(120, breite * 0.18)
        for (const w of platz) {
            const y = w.y
            ctx.strokeStyle = `rgba(${w.rgb},0.35)`
            ctx.lineWidth = 1
            ctx.setLineDash([2, 4])
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(breite, y); ctx.stroke()
            ctx.setLineDash([])
            const l = Math.max(10, (w.usd / max) * lang)
            ctx.fillStyle = `rgba(${w.rgb},0.75)`
            ctx.fillRect(breite - l, y - 2, l, 4)
            if (!w.schild) continue
            const text = `${w.name} ${usdKurz(w.usd)}`
            const b = ctx.measureText(text).width
            ctx.fillStyle = 'rgba(10,14,22,0.75)'
            ctx.fillRect(breite - l - b - 10, y - 7, b + 6, 13)
            ctx.fillStyle = `rgba(${w.rgb},1)`
            ctx.fillText(text, breite - l - b - 7, y + 3.5)
        }
    }

    zeichneLiq(ctx, breite) {
        const sichtbar = this.liqKerzen
            .map((b) => ({ ...b, x: logischZuX(this.chart.timeScale(), b.i), y: this.zuY(b.preis) }))
            .filter((b) => b.x != null && b.y != null && b.x > -20 && b.x < breite + 20)
        if (!sichtbar.length) return
        // Massstab aus dem SICHTBAREN Bereich: sonst macht ein Crash von vor
        // sechs Tagen alle Blasen von heute winzig.
        const max = Math.max(...sichtbar.map((b) => b.usd), 1)
        const schritt = Math.abs((logischZuX(this.chart.timeScale(), 1) ?? 6) - (logischZuX(this.chart.timeScale(), 0) ?? 0)) || 6
        const rMax = Math.max(8, Math.min(22, schritt * 1.6))
        const beschriften = new Set([...sichtbar].sort((a, b) => b.usd - a.usd).slice(0, 6).filter((b) => b.usd >= max * 0.15))
        for (const b of sichtbar.sort((a, c) => c.usd - a.usd)) {
            const r = Math.max(2.5, Math.sqrt(b.usd / max) * rMax)
            const rgb = b.long ? ROT : GRUEN
            ctx.beginPath()
            ctx.arc(b.x, b.y, r, 0, Math.PI * 2)
            ctx.fillStyle = `rgba(${rgb},0.38)`
            ctx.fill()
            ctx.lineWidth = 1
            ctx.strokeStyle = `rgba(${rgb},0.9)`
            ctx.stroke()
            if (beschriften.has(b)) {
                const text = usdKurz(b.usd)
                const w = ctx.measureText(text).width
                ctx.fillStyle = `rgba(${rgb},1)`
                ctx.fillText(text, b.x - w / 2, b.long ? b.y + r + 10 : b.y - r - 4)
            }
        }
    }

    /** Balken vom rechten Rand nach links, Länge ∝ USD; Beschriftung bei den grössten. */
    zeichneBalken(ctx, breite, eintraege, alpha, dicke, vorsilbe, maxLaenge) {
        if (!eintraege.length) return
        const max = Math.max(...eintraege.map((e) => e.usd || 0), 1)
        const laengsteBreite = Math.min(maxLaenge, breite * 0.25)
        const sortiert = [...eintraege].sort((a, b) => b.usd - a.usd)
        const beschriften = new Set(sortiert.slice(0, 6))
        for (const e of eintraege) {
            const y = this.zuY(e.preis)
            if (y == null) continue
            const l = Math.max(4, (e.usd / max) * laengsteBreite)
            ctx.fillStyle = `rgba(${e.rgb},${alpha})`
            ctx.fillRect(breite - l, y - dicke / 2, l, dicke)
            if (beschriften.has(e)) {
                const text = `${e.vorsilbe ?? vorsilbe}${usdKurz(e.usd)}`
                const b = ctx.measureText(text).width
                ctx.fillStyle = `rgba(${e.rgb},0.95)`
                ctx.fillText(text, breite - l - b - 4, y + 3)
            }
        }
    }
}
