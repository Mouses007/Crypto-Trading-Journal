/**
 * Volumenprofil über einen festen Kerzenbereich (Fixed Range Volume Profile).
 *
 * Gemeinsam für das Zeichenwerkzeug im Chart und die KI-Analyse — beide sollen
 * dasselbe Profil lesen.
 *
 * Aus Kerzen geschätzt, nicht aus Trades: das Volumen jeder Kerze wird
 * gleichmässig auf ihre Spanne Tief–Hoch verteilt (TradingView nimmt dafür
 * Kerzen einer kleineren Zeiteinheit). Bei wenigen, breiten Kerzen ist das
 * Profil daher grob; der Point of Control (POC, die Zeile mit dem meisten
 * Volumen) und die Value Area (70 % des Volumens um den POC) sind trotzdem
 * die Marken, an denen ein Trader handelt. Kauf/Verkauf ist nach der
 * Kerzenfarbe getrennt (Schluss ≥ Eröffnung = Kauf) — eine Näherung.
 */

/**
 * @param {Array<{o,h,l,c,v}>} kerzen
 * @param {{ zeilen?: number, va?: number }} opt
 * @returns {null | { unten, oben, schritt, zeilen: Array<{von,bis,auf,ab,summe}>, poc, pocIndex, vah, val, summe }}
 */
export function volumenprofil(kerzen, { zeilen = 24, va = 0.7 } = {}) {
    const k = (kerzen || []).filter((x) => Number.isFinite(x?.h) && Number.isFinite(x?.l) && x.h >= x.l && Number(x.v) > 0)
    if (!k.length) return null
    const n = Math.max(2, Math.min(200, Math.round(Number(zeilen) || 24)))
    const unten = Math.min(...k.map((x) => x.l))
    const oben = Math.max(...k.map((x) => x.h))
    if (!(oben > unten)) return null
    const schritt = (oben - unten) / n
    const reihe = Array.from({ length: n }, (_, i) => ({ von: unten + i * schritt, bis: unten + (i + 1) * schritt, auf: 0, ab: 0, summe: 0 }))
    for (const x of k) {
        const v = Number(x.v)
        const kauf = x.c >= x.o
        const spanne = x.h - x.l
        if (spanne <= 0) {
            // Kerze ohne Spanne: alles in die eine Zeile
            const i = Math.min(n - 1, Math.floor((x.c - unten) / schritt))
            reihe[i][kauf ? 'auf' : 'ab'] += v
            continue
        }
        const i0 = Math.max(0, Math.floor((x.l - unten) / schritt))
        const i1 = Math.min(n - 1, Math.floor((x.h - unten) / schritt))
        for (let i = i0; i <= i1; i++) {
            const anteil = (Math.min(x.h, reihe[i].bis) - Math.max(x.l, reihe[i].von)) / spanne
            if (anteil > 0) reihe[i][kauf ? 'auf' : 'ab'] += v * anteil
        }
    }
    let summe = 0
    let pocIndex = 0
    for (let i = 0; i < n; i++) {
        reihe[i].summe = reihe[i].auf + reihe[i].ab
        summe += reihe[i].summe
        if (reihe[i].summe > reihe[pocIndex].summe) pocIndex = i
    }
    if (!(summe > 0)) return null

    // Value Area: vom POC aus jeweils die volumenstärkere Nachbarzeile dazunehmen, bis `va` erreicht ist.
    let lo = pocIndex, hi = pocIndex, drin = reihe[pocIndex].summe
    while (drin < va * summe && (lo > 0 || hi < n - 1)) {
        const unterhalb = lo > 0 ? reihe[lo - 1].summe : -1
        const oberhalb = hi < n - 1 ? reihe[hi + 1].summe : -1
        if (oberhalb >= unterhalb) drin += reihe[++hi].summe
        else drin += reihe[--lo].summe
    }
    const mitte = (i) => (reihe[i].von + reihe[i].bis) / 2
    return {
        unten, oben, schritt, zeilen: reihe, summe,
        pocIndex, poc: mitte(pocIndex),
        vah: reihe[hi].bis, val: reihe[lo].von, vaVon: lo, vaBis: hi,
    }
}
