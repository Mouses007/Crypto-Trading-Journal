/**
 * Preis-Binning für die Liquiditäts-Heatmap.
 *
 * Ein Orderbuch hat zu viele Preisstufen, um jede als eigene Zeile zu zeichnen
 * (BTCUSDT: tickSize 0.1 → 30.000 Stufen über ein 3-%-Band). Stattdessen werden
 * benachbarte Ticks zu Buckets zusammengefasst; die Bucket-Grösse ist immer ein
 * ganzzahliges Vielfaches der tickSize, damit Kanten auf echten Preisen liegen.
 */

// „Runde" Vielfache — vermeidet krumme Bucket-Grössen wie 3.7 × tickSize
const NICE_MULTIPLES = [1, 2, 2.5, 4, 5, 8, 10, 20, 25, 40, 50, 80, 100, 200, 250, 400, 500, 1000, 2000, 2500, 5000, 10000]

/**
 * @param {number} tickSize   kleinste Preisänderung des Symbols
 * @param {number} mid        aktueller Mittelkurs
 * @param {number} rangePct   erfasstes Band um den Mid, in Prozent (einseitig)
 * @param {number} targetRows gewünschte Zeilenzahl über das gesamte Band
 */
export function pickBucketSize(tickSize, mid, rangePct, targetRows) {
    if (!tickSize || !mid || !targetRows) return tickSize || 0.01
    const span = mid * (rangePct / 100) * 2
    const ideal = span / targetRows
    const multiple = NICE_MULTIPLES.find(k => tickSize * k >= ideal) || NICE_MULTIPLES[NICE_MULTIPLES.length - 1]
    return tickSize * multiple
}

/**
 * Fallback, wenn exchangeInfo keine tickSize liefert: kleinste Differenz
 * benachbarter Preise im Snapshot.
 */
export function inferTickSize(snapshot) {
    const prices = []
    for (const [p] of (snapshot.asks || []).slice(0, 50)) prices.push(+p)
    for (const [p] of (snapshot.bids || []).slice(0, 50)) prices.push(+p)
    prices.sort((a, b) => a - b)
    let min = Infinity
    for (let i = 1; i < prices.length; i++) {
        const d = prices[i] - prices[i - 1]
        if (d > 0 && d < min) min = d
    }
    if (!Number.isFinite(min)) return null
    // Gleitkomma-Rauschen glätten (0.09999999 → 0.1)
    return Number(min.toPrecision(8))
}

/** Nachkommastellen für die Preisachse aus der tickSize ableiten. */
export function decimalsFor(tickSize) {
    if (!tickSize || tickSize >= 1) return 0
    const str = tickSize.toPrecision(12).replace(/0+$/, '')
    const dot = str.indexOf('.')
    if (dot < 0) return 0
    return Math.min(str.length - dot - 1, 10)
}

/**
 * Sichtfenster in absoluten Bucket-Indizes, mit Dead-Zone: das Fenster wird
 * nicht jeden Frame nachgezogen (das lässt die Heatmap zittern), sondern erst,
 * wenn der Mid mehr als `deadZone` der halben Höhe aus der Mitte gelaufen ist.
 *
 * @returns {{lo:number, hi:number, shifted:boolean}}
 */
export function followMid(view, midBucket, rows, deadZone = 0.35) {
    if (!view || view.hi <= view.lo) {
        const half = rows >> 1
        return { lo: midBucket - half, hi: midBucket + (rows - half), shifted: true }
    }
    const center = (view.lo + view.hi) / 2
    const half = (view.hi - view.lo) / 2
    if (Math.abs(midBucket - center) <= half * deadZone) {
        return { lo: view.lo, hi: view.hi, shifted: false }
    }
    const shift = Math.round(midBucket - center)
    return { lo: view.lo + shift, hi: view.hi + shift, shifted: true }
}

/**
 * Grobe Tickgrösse aus der Preishöhe ableiten.
 *
 * `inferTickSize` braucht einen Orderbuch-Schnappschuss. Wer nur Kerzen hat
 * (die Hebelkarte im Browser, `server/hebelzonen.js` auf dem Server), kennt
 * den nicht — für die Zeilenbreite reicht die Grössenordnung völlig, ein
 * Bucket umfasst ohnehin viele Ticks.
 *
 * Stand bis zum 05.09.2026 in `src/utils/leverageMapSource.js`; hierher
 * gezogen, als der Server dieselbe Ableitung brauchte. Zweimal im Baum wäre
 * genau die Art Duplikat, gegen die es dieses Modul gibt.
 */
export function grobeTickgroesse(mid) {
    if (mid > 1000) return 0.1
    if (mid > 10) return 0.001
    if (mid > 0.1) return 0.00001
    return 0.0000001
}
