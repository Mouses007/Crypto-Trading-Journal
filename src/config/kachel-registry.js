/**
 * Bausteine für Kachel-Registries.
 *
 * Reines Datenmodul ohne Vue-Abhängigkeit. Die Mechanik „Definitionen +
 * Wunschreihenfolge → fertige Liste" und „gespeicherte Reihenfolge auf die
 * bekannten Kacheln abbilden" stand nur im Marktradar; mit dem Live-Trading-
 * Fenster gäbe es sie zweimal. Herausgezogen ist ausdrücklich nur die Mechanik
 * — die Kacheln selbst und ihre Wunschanordnung bleiben je Seite in ihrer
 * eigenen Registry.
 *
 * Leitsatz beider Funktionen: **eine Kachel darf nie verschwinden.** Wer eine
 * Id in der Wunschreihenfolge vergisst, verliert die Position, nicht die
 * Kachel; und eine Kachel aus einer neueren Version, die im gespeicherten
 * Layout des Nutzers noch nicht vorkommt, hängt hinten an, statt unsichtbar zu
 * bleiben.
 */

/**
 * Definitionen in die Standardanordnung bringen.
 *
 * @param {Array<{id:string}>} definitionen
 * @param {string[]} standardReihenfolge Ids in Wunschreihenfolge
 */
export function baueKachelListe(definitionen, standardReihenfolge = []) {
    return [
        ...standardReihenfolge.map(id => definitionen.find(k => k.id === id)).filter(Boolean),
        ...definitionen.filter(k => !standardReihenfolge.includes(k.id)),
    ]
}

/**
 * Sortierer für eine fertige Kachelliste.
 *
 * Gibt zwei Funktionen zurück, weil sie zusammengehören: der Sortierer braucht
 * das Nachschlagen, und beide sollen dieselbe Liste sehen.
 *
 * @param {Array<{id:string}>} kacheln
 * @returns {{ kachelById:(id:string)=>object|null, sortiereKacheln:(reihenfolge:string[])=>object[] }}
 */
export function macheSortierer(kacheln) {
    const kachelById = (id) => kacheln.find(k => k.id === id) || null

    /** Reihenfolge aus dem localStorage auf die bekannten Kacheln abbilden. */
    function sortiereKacheln(reihenfolge) {
        if (!Array.isArray(reihenfolge) || !reihenfolge.length) return [...kacheln]
        const rest = kacheln.filter(k => !reihenfolge.includes(k.id))
        const bekannt = reihenfolge.map(id => kachelById(id)).filter(Boolean)
        return [...bekannt, ...rest]
    }

    return { kachelById, sortiereKacheln }
}
