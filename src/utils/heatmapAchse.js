/**
 * Zeitachse der Heatmap: welche Ringspalten liegen hinter welchem Pixel.
 *
 * Bis zum 07.09.2026 gab es diese Frage nicht — eine Ringspalte war immer
 * genau ein Pixel, und die sichtbare Zeitspanne ergab sich aus Plotbreite mal
 * Takt (bei 800 px und 500 ms sechseinhalb Minuten). Wer eine Stunde sehen
 * wollte, konnte das schlicht nicht einstellen.
 *
 * Eigenes Modul, weil hier die Indexrechnung sitzt und sonst nichts: der
 * Renderer braucht ein Canvas und ist damit in Node nicht prüfbar, diese
 * Rechnung schon. Und sie ist die riskante Hälfte — eine Lücke von einer
 * Spalte verschluckt Daten, ohne dass im Bild etwas fehlt.
 */

/** Grenzen der Faltung: darunter wird das Bild eine Treppe, darüber Brei. */
export const K_MIN = 1 / 16
export const K_MAX = 64

/**
 * Ringspalten je Pixel für eine gewünschte Zeitspanne.
 *
 * @param {number} spanneMs  gewünschte sichtbare Zeitspanne (0 = nativ)
 * @param {number} frameMs   Takt einer Ringspalte
 * @param {number} n         Pixelbreite der Historie
 * @returns {number} < 1 = gestreckt, 1 = nativ, > 1 = gefaltet
 */
export function spaltenProPixel(spanneMs, frameMs, n) {
    if (!(spanneMs > 0) || !(frameMs > 0) || !(n > 0)) return 1
    return Math.max(K_MIN, Math.min(K_MAX, (spanneMs / frameMs) / n))
}

/**
 * Spaltenfenster hinter Pixel `px`, als Abstand von `head` (0 = neueste).
 *
 * `jung` ist der jüngste Beitrag, `alt` der älteste — beide inklusive. Bei
 * k = 1 gilt jung === alt === n-1-px, also exakt die alte 1:1-Zuordnung.
 *
 * Zwei Eigenschaften tragen alles und stehen deshalb im Selbsttest:
 *   – LÜCKENFREI: zwischen `alt` eines Pixels und `jung` des linken Nachbarn
 *     bleibt nie eine Spalte übrig. Eine Lücke würde Spalten verschlucken,
 *     ohne dass im Bild etwas fehlte.
 *   – MONOTON: nach rechts wird es jünger. Darauf beruht die binäre Suche,
 *     mit der Handelspunkte ihre Pixelspalte finden.
 * Überlappung bei krummem k ist dagegen erlaubt und richtig: das hier ist ein
 * Neuabtasten, keine Aufteilung.
 */
export function spaltenFenster(px, n, k) {
    const jung = Math.floor((n - 1 - px) * k)
    let alt = Math.ceil((n - px) * k) - 1
    if (alt < jung) alt = jung
    return { jung, alt }
}
