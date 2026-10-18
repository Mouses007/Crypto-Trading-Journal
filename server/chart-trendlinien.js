/**
 * Trendlinien an den Kerzen prüfen — rein, ohne Netz.
 *
 * Ein Sprachmodell liest Zahlenreihen, keine Geometrie: am 18.10.2026 zog es
 * die BTC-Abwärtslinie vom absoluten Hoch aus, und die Hochs drei Kerzen
 * später lagen 800 USD darüber. Als Widerstand ist eine Linie, durch die die
 * Kerzen hindurchwachsen, wertlos — ein Trader zeichnet sie an die Hochs, die
 * sie BERÜHREN, nicht durchstossen.
 *
 * Deshalb wird jede Trendlinie der KI hier gegen die Kerzen geprüft:
 *   - Seite: Widerstand (an Hochs, Kurs darunter) oder Unterstützung (an Tiefs).
 *   - Bruch: ab dem ersten Ankerpunkt bis jetzt schliesst keine Kerze jenseits
 *     der Linie, und kein Docht reicht weiter als `TOL_ATR` × ATR darüber.
 *   - Berührung: ein Wendepunkt (Hoch/Tief mit `PIVOT_K` Kerzen Abstand zu
 *     beiden Seiten) innerhalb der Toleranz.
 * Hält die Linie der KI nicht, wird sie durch die beste echte Linie derselben
 * Seite ersetzt (meiste Berührungen, dann jüngster Anker, dann längste
 * Spanne); gibt es keine, wird sie verworfen.
 */
import { atr } from '../shared/indicators.js'

export const PIVOT_K = 3
export const TOL_ATR = 0.3
export const MIN_ABSTAND = 10

/** Wendepunkte: Index i, dessen Hoch (Tief) über (unter) den K Nachbarn auf jeder Seite liegt. */
export function wendepunkte(kerzen, seite, k = PIVOT_K) {
    const aus = []
    const wert = (i) => (seite === 'hoch' ? kerzen[i].h : kerzen[i].l)
    for (let i = k; i < kerzen.length - k; i++) {
        let ok = true
        for (let j = i - k; j <= i + k && ok; j++) {
            if (j === i) continue
            ok = seite === 'hoch' ? wert(j) <= wert(i) : wert(j) >= wert(i)
        }
        if (ok) aus.push(i)
    }
    return aus
}

const linie = (i1, p1, i2, p2) => (i) => p1 + (p2 - p1) * (i - i1) / (i2 - i1)

/**
 * Hält die Gerade durch (i1,p1)–(i2,p2) als `seite`-Linie von i1 bis zur letzten Kerze?
 * @returns {{ ok: boolean, beruehrungen: number }}
 */
export function pruefeTrend(kerzen, i1, p1, i2, p2, seite, tol, pivots) {
    const L = linie(i1, p1, i2, p2)
    for (let i = i1; i < kerzen.length; i++) {
        const k = kerzen[i], y = L(i)
        if (seite === 'hoch' ? (k.c > y + tol * 0.25 || k.h > y + tol) : (k.c < y - tol * 0.25 || k.l < y - tol)) {
            return { ok: false, beruehrungen: 0 }
        }
    }
    const beruehrungen = pivots.filter((i) => i >= i1 && Math.abs((seite === 'hoch' ? kerzen[i].h : kerzen[i].l) - L(i)) <= tol).length
    return { ok: true, beruehrungen }
}

/** Beste haltende Linie einer Seite, oder null. Anker sind immer echte Hochs/Tiefs. */
export function besteTrendlinie(kerzen, seite, { tol, richtung = null, minAbstand = MIN_ABSTAND } = {}) {
    const pv = wendepunkte(kerzen, seite)
    const wert = (i) => (seite === 'hoch' ? kerzen[i].h : kerzen[i].l)
    let beste = null
    for (let a = 0; a < pv.length; a++) {
        for (let b = a + 1; b < pv.length; b++) {
            const i1 = pv[a], i2 = pv[b]
            if (i2 - i1 < minAbstand) continue
            const p1 = wert(i1), p2 = wert(i2)
            if (richtung === 'ab' && !(p2 < p1)) continue
            if (richtung === 'auf' && !(p2 > p1)) continue
            const r = pruefeTrend(kerzen, i1, p1, i2, p2, seite, tol, pv)
            if (!r.ok || r.beruehrungen < 2) continue
            const kandidat = { i1, p1, i2, p2, beruehrungen: r.beruehrungen }
            if (!beste || r.beruehrungen > beste.beruehrungen
                || (r.beruehrungen === beste.beruehrungen && (i2 > beste.i2 || (i2 === beste.i2 && i1 < beste.i1)))) beste = kandidat
        }
    }
    return beste
}

/**
 * Trendlinie der KI an den Kerzen ausrichten.
 * @param {Array<{t,h,l,c}>} kerzen  aufsteigend, gleichmässig
 * @param {{t1,p1,t2,p2}} l
 * @returns {{ t1, p1, t2, p2, ersetzt: boolean, beruehrungen: number } | null}
 */
export function richteTrendAus(kerzen, l, iv) {
    if (!Array.isArray(kerzen) || kerzen.length < 2 * PIVOT_K + MIN_ABSTAND || !(iv > 0)) return l ? { ...l, ersetzt: false, beruehrungen: null } : null
    const a = atr(kerzen, 14)
    const atrJetzt = a[a.length - 1]
    if (!(atrJetzt > 0)) return { ...l, ersetzt: false, beruehrungen: null }
    const tol = TOL_ATR * atrJetzt
    const idx = (t) => Math.max(0, Math.min(kerzen.length - 1, Math.round((t - kerzen[0].t) / iv)))
    const i1 = idx(l.t1)
    // Seite: liegt der erste Anker näher am Hoch oder am Tief seiner Kerze?
    const seite = Math.abs(l.p1 - kerzen[i1].h) <= Math.abs(l.p1 - kerzen[i1].l) ? 'hoch' : 'tief'
    const richtung = l.p2 < l.p1 ? 'ab' : l.p2 > l.p1 ? 'auf' : null
    const zeit = (i) => kerzen[i].t

    // 1) Die Anker der KI auf den nächsten Wendepunkt (±PIVOT_K) setzen und prüfen.
    const pv = wendepunkte(kerzen, seite)
    const naechster = (i) => pv.reduce((best, j) => (Math.abs(j - i) <= PIVOT_K && (best == null || Math.abs(j - i) < Math.abs(best - i)) ? j : best), null)
    const j1 = naechster(i1), j2 = naechster(idx(l.t2))
    const wert = (i) => (seite === 'hoch' ? kerzen[i].h : kerzen[i].l)
    if (j1 != null && j2 != null && j2 - j1 >= MIN_ABSTAND) {
        const r = pruefeTrend(kerzen, j1, wert(j1), j2, wert(j2), seite, tol, pv)
        if (r.ok && r.beruehrungen >= 2) return { t1: zeit(j1), p1: wert(j1), t2: zeit(j2), p2: wert(j2), ersetzt: false, beruehrungen: r.beruehrungen }
    }
    // 2) Sonst die beste echte Linie derselben Seite und Richtung.
    const b = besteTrendlinie(kerzen, seite, { tol, richtung })
    if (!b) return null
    return { t1: zeit(b.i1), p1: b.p1, t2: zeit(b.i2), p2: b.p2, ersetzt: true, beruehrungen: b.beruehrungen }
}
