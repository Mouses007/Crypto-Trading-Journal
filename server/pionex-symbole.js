/**
 * Symbolschreibweisen zwischen Journal und Pionex.
 *
 * Das Journal führt Symbole als `BTCUSDT`, Pionex als `BTC_USDT_PERP`. Die
 * Rückrichtung (Pionex → Journal) ist trivial — Trennstriche und `_PERP` weg.
 * Die HINrichtung ist es nicht: sie müsste wissen, wo die Basis aufhört und
 * die Quote anfängt, und das ist eine Rateaufgabe, sobald ein Symbol
 * `1000PEPEUSDT` heisst oder die Quote nicht USDT ist.
 *
 * Deshalb zwei Wege, in dieser Reihenfolge:
 *
 *   1. **Die Tabelle.** Wer `/api/v1/common/symbols?type=PERP` geladen hat,
 *      übergibt die Liste; gesucht wird der Eintrag, dessen Rückübersetzung
 *      dem Journal-Symbol entspricht. Das ist die einzige Antwort, die nicht
 *      rät — die Börse sagt selbst, wie ihre Paare heissen.
 *   2. **Die Regel**, nur als Rückfall, wenn die Tabelle nicht da ist
 *      (Netzfehler beim Start). Sie trennt ein bekanntes Quote-Suffix ab.
 *
 * Nicht auflösbare Fälle werfen. Ein falsch geratenes Symbol ist die
 * teuerste Sorte Fehler, die dieses Modul erzeugen kann: die Order ginge auf
 * ein anderes Paar.
 *
 * Rein — kein Netz, keine DB, kein Zustand ausser einem gesetzten Verzeichnis.
 */

/** Quote-Währungen, die Pionex führt. Längere zuerst, sonst frisst USDT die USDC-Fälle nicht auf. */
const QUOTES = ['USDT', 'USDC', 'USD', 'BTC', 'ETH']

/** Pionex → Journal: `BTC_USDT_PERP` → `BTCUSDT`. */
export function journalSymbol(s) {
    const str = String(s || '')
    if (!str) return ''
    return str.replace(/_PERP$/i, '').replace(/_/g, '').toUpperCase()
}

/**
 * Journal → Pionex.
 *
 * @param {string} journal   z.B. 'BTCUSDT'
 * @param {Array}  tabelle   Einträge aus /common/symbols?type=PERP (optional)
 * @returns {string}         z.B. 'BTC_USDT_PERP'
 * @throws wenn weder Tabelle noch Regel eine eindeutige Antwort geben
 */
export function pionexSymbol(journal, tabelle = null) {
    const j = String(journal || '').toUpperCase().trim()
    if (!j) throw new Error('Leeres Symbol')

    // Weg 1: die Börse hat es selbst gesagt.
    if (Array.isArray(tabelle) && tabelle.length) {
        const treffer = tabelle.filter((e) => journalSymbol(e?.symbol) === j)
        if (treffer.length === 1) return String(treffer[0].symbol)
        if (treffer.length > 1) {
            throw new Error(`Symbol ${j} ist auf Pionex mehrdeutig (${treffer.map((t) => t.symbol).join(', ')})`)
        }
        // Kein Treffer in einer vorhandenen Tabelle heisst: das Paar gibt es
        // dort nicht. Die Regel darf das nicht überstimmen — sie würde ein
        // Symbol bauen, das die Börse ablehnt, und der Fehler käme erst beim
        // Senden.
        throw new Error(`Symbol ${j} ist auf Pionex nicht handelbar (nicht in der Perp-Liste)`)
    }

    // Weg 2: Rückfall ohne Tabelle.
    const quote = QUOTES.find((q) => j.endsWith(q) && j.length > q.length)
    if (!quote) throw new Error(`Quote-Währung von ${j} nicht erkannt`)
    return `${j.slice(0, -quote.length)}_${quote}_PERP`
}

/** Baut das Verzeichnis einmal, damit `pionexSymbol` nicht jedes Mal filtert. */
export function baueVerzeichnis(tabelle) {
    const map = new Map()
    for (const e of Array.isArray(tabelle) ? tabelle : []) {
        const j = journalSymbol(e?.symbol)
        if (!j) continue
        // Doppelte Journal-Namen sind ein Mehrdeutigkeitsfall — dann lieber
        // gar keinen Eintrag als den zuletzt gesehenen.
        if (map.has(j)) map.set(j, null)
        else map.set(j, e)
    }
    return map
}
