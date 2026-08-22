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
    const geordnet = [
        ...standardReihenfolge.map(id => definitionen.find(k => k.id === id)).filter(Boolean),
        ...definitionen.filter(k => !standardReihenfolge.includes(k.id)),
    ]
    return geordnet.map(k => ({ ...k, infoKey: infoSchluessel(k) }))
}

/**
 * Schlüssel des Erklärtexts einer Kachel (das kleine „i" im Kachelkopf).
 *
 * Regel: `marktradar.fng.title` → `marktradar.fng.info`. Das trägt, weil der
 * Titel eines Kachel-Namensraums immer unter `<raum>.title` liegt — der Raum
 * ist also schon ein Objekt und verträgt einen zweiten Schlüssel.
 *
 * Zwei Kacheln im Live-Trading-Fenster hängen aber an `nav.liquidity` und
 * `nav.liquidations`; dort endet der Schlüssel nicht auf `.title`, und die
 * Ableitung ergäbe zweimal dasselbe `nav.info`. Deshalb darf eine Definition
 * ihr `infoKey` selbst setzen, und die Ableitung ist nur der Normalfall.
 *
 * Wichtig: hier wird eine KOPIE gebaut, nie die Definition beschrieben. Die
 * Startseite hängt sich den Marktradar-Katalog per Referenz ein — ein
 * Schreibzugriff auf ein Definitionsobjekt liefe quer über beide Seiten.
 */
function infoSchluessel(kachel) {
    if (kachel.infoKey) return kachel.infoKey
    const titel = kachel.titleKey || ''
    return titel.endsWith('.title') ? titel.slice(0, -'.title'.length) + '.info' : ''
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
