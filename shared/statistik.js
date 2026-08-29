/**
 * Statistische Grundrechnungen — je eine Fassung für das ganze Projekt.
 *
 * Diese Datei existiert, weil dieselben zwei Formeln mehrfach unabhängig
 * ausgeschrieben waren und dabei auseinandergelaufen sind:
 *
 *   Spearman stand DREIMAL. Einmal richtig, mit Mittelrängen bei Bindungen
 *   (`rangliste-rang.js`), zweimal mit der Kurzformel `1 − 6Σd²/(n(n²−1))`,
 *   die Bindungen nicht kennt und deren Ergebnis damit von der zufälligen
 *   Sortierreihenfolge gleicher Werte abhängt.
 *
 *   Der Median stand einmal (`radar-guete.js`), während das Schwestermodul
 *   `sitzungStatistik.js` für dieselbe Frage — „ist die eine Gruppe besser als
 *   die andere?" — Mittelwerte verglich. Bei stark schiefen PnL-Verteilungen
 *   entscheidet ein einzelner Ausreisser das Ergebnis.
 *
 * Von hier importieren Browser und Server gleichermassen, wie bei
 * `shared/liquidation.js` und `shared/gewinn.js`.
 *
 * Selbsttest: `shared/__selftest-statistik.mjs`.
 */

/**
 * Median einer Zahlenreihe.
 *
 * @param {number[]} werte
 * @returns {number|null} null bei leerer Reihe — 0 wäre eine Aussage, die die
 *          Daten nicht hergeben.
 */
export function median(werte = []) {
    const z = werte.filter((w) => Number.isFinite(w)).sort((a, b) => a - b)
    if (!z.length) return null
    const m = Math.floor(z.length / 2)
    return z.length % 2 ? z[m] : (z[m - 1] + z[m]) / 2
}

/**
 * Ränge einer Reihe, Bindungen bekommen den mittleren Rang.
 *
 * Das ist der ganze Unterschied zur Kurzformel: ohne Mittelränge hängt das
 * Ergebnis davon ab, in welcher Reihenfolge gleiche Werte zufällig standen.
 *
 * @param {number[]} werte
 * @returns {number[]} Ränge in der Reihenfolge der Eingabe, 1-basiert
 */
export function raenge(werte) {
    const idx = werte.map((w, i) => ({ w, i })).sort((a, b) => a.w - b.w)
    const r = new Array(werte.length)
    let i = 0
    while (i < idx.length) {
        let j = i
        while (j + 1 < idx.length && idx[j + 1].w === idx[i].w) j++
        const mittel = (i + j) / 2 + 1
        for (let k = i; k <= j; k++) r[idx[k].i] = mittel
        i = j + 1
    }
    return r
}

/**
 * Spearman-Rangkorrelation zwischen zwei gleich langen Reihen.
 *
 * Gerechnet als Pearson-Korrelation ÜBER DEN RÄNGEN, nicht mit der
 * `6Σd²`-Kurzformel: die gilt nur ohne Bindungen und liefert sonst still einen
 * zu hohen Betrag.
 *
 * @param {number[]} xs
 * @param {number[]} ys
 * @param {number} [minPaare=3] Untergrenze; darunter ist jede Korrelation Zufall
 * @returns {number|null} −1…+1, oder null wenn nicht messbar (zu wenige Paare
 *          oder eine Reihe konstant — dann wäre 0 eine Aussage, die die Daten
 *          nicht hergeben)
 */
export function spearman(xs, ys, minPaare = 3) {
    const n = Math.min(xs.length, ys.length)
    if (n < Math.max(2, minPaare)) return null

    const rx = raenge(xs.slice(0, n))
    const ry = raenge(ys.slice(0, n))
    const mx = rx.reduce((s, v) => s + v, 0) / n
    const my = ry.reduce((s, v) => s + v, 0) / n
    let oben = 0
    let sx = 0
    let sy = 0
    for (let i = 0; i < n; i++) {
        oben += (rx[i] - mx) * (ry[i] - my)
        sx += (rx[i] - mx) ** 2
        sy += (ry[i] - my) ** 2
    }
    if (!(sx > 0) || !(sy > 0)) return null
    return Math.max(-1, Math.min(1, oben / Math.sqrt(sx * sy)))
}
