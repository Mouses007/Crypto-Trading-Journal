/**
 * Break-even — eine einzige Schwelle für „ist das ein Gewinner?".
 *
 * Kanon: NULL ZÄHLT ALS GEWINN.
 *   >= 0  → Gewinner
 *   <  0  → Verlierer
 *
 * Begründung: ein Trade, der bei null herauskommt, hat kein Geld verloren.
 * Ihn als Verlust zu zählen senkt die Trefferquote und verzerrt das
 * P/L-Verhältnis, ohne dass ein Verlust stattgefunden hat.
 *
 * Diese Datei existiert, weil die Schwelle an DREIZEHN Stellen unabhängig
 * ausgeschrieben war — und nur an zwei richtig. Der Kanon war dreifach
 * dokumentiert und trotzdem die Minderheit im Code: dieselbe Null wurde beim
 * Import als Verlust gezählt und im Dashboard grün gefärbt
 * (`src/views/Daily.vue`). Wer die Schwelle braucht, nimmt `istGewinn()`,
 * niemand schreibt sie neu.
 *
 * Gleiche Bauart und gleicher Grund wie `src/utils/funding.js` für das
 * Funding-Vorzeichen.
 */

/**
 * Zählt ein Ergebnis als Gewinn?
 *
 * Nicht lesbare Werte (`null`, `undefined`, Text ohne Zahl) ergeben 0 und
 * damit `true` — das ist die konservative Richtung: ein unbekannter Betrag
 * wird nicht zum Verlust erklärt.
 *
 * @param {number|string} betrag Brutto- oder Nettoergebnis
 * @returns {boolean}
 */
export function istGewinn(betrag) {
    return (Number(betrag) || 0) >= 0
}
