/**
 * Finanzierungsgebühren (Funding) — eine einzige Vorzeichen-Konvention.
 *
 * Kanon: `fundingFee` ist SIGNIERT.
 *   +  = erhalten (erhöht das Nettoergebnis)
 *   −  = bezahlt  (senkt das Nettoergebnis)
 *
 * So schreiben es alle Import-Pfade (quickImport.js, incoming.js, brokers.js,
 * journal-bridge.js), und so rechnet die Netto-Formel:
 *   netto = brutto − tradingFee + fundingFee
 *
 * An einem echten Trade nachgeprüft (BTCUSDT, Bitunix):
 *   17,59703 − 1,17257 + 0,13627 = 16,56073 = netProceeds ✓
 *
 * Diese Datei existiert, weil die Aufteilung in „bezahlt/erhalten" an drei
 * Stellen unabhängig ausgeschrieben war — und an zweien vertauscht. Wer die
 * Aufteilung braucht, nimmt `splitFunding()`, niemand schreibt sie neu.
 */

/**
 * Zerlegt einen signierten Funding-Betrag in zwei POSITIVE Beträge.
 *
 * @param {number} fee signierter Funding-Betrag (+ erhalten, − bezahlt)
 * @returns {{ received: number, paid: number }} beide ≥ 0
 */
export function splitFunding(fee) {
    const v = Number(fee) || 0
    return {
        received: v > 0 ? v : 0,
        paid: v < 0 ? -v : 0,
    }
}

/**
 * Addiert einen signierten Funding-Betrag auf einen Sammler
 * `{ paid, received }` (beide positiv geführt).
 */
export function addFunding(sammler, fee) {
    const { received, paid } = splitFunding(fee)
    sammler.received += received
    sammler.paid += paid
    return sammler
}
