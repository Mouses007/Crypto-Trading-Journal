/**
 * Leitner-Karteikasten: Boxen, Intervalle, Fälligkeit.
 *
 * Klassisches Prinzip: eine Karte beginnt in Box 1. Je höher die Box, desto
 * seltener kommt die Karte wieder dran. Bewertet wird nicht nur richtig/falsch,
 * sondern in vier Stufen — wie gut man die Antwort wusste entscheidet, wie
 * weit die Karte springt:
 *   Vergessen → zurück auf Box 1, egal wie weit sie schon war.
 *   Schwer    → bleibt in der aktuellen Box (kommt bald wieder, aber ohne Reset).
 *   Gut       → eine Box weiter.
 *   Leicht    → zwei Boxen weiter — eine sicher gewusste Karte muss nicht die
 *               ganze Leiter einzeln hochsteigen.
 *
 * Reines Modul: kein Netz, keine Datenbank, kein Vue. Selbsttest:
 * `shared/__selftest-leitner.mjs`.
 */

export const BOX_MIN = 1
export const BOX_MAX = 4

// Je höher die Box, desto seltener die Wiederholung. Box 1 ist sofort wieder
// fällig (0 Tage) — eine frisch vergessene Karte soll in derselben Sitzung
// nochmal drankommen können.
export const INTERVALL_TAGE = { 1: 0, 2: 1, 3: 3, 4: 7 }

export const GRADE_VERGESSEN = 'vergessen'
export const GRADE_SCHWER = 'schwer'
export const GRADE_GUT = 'gut'
export const GRADE_LEICHT = 'leicht'
export const GRADES = [GRADE_VERGESSEN, GRADE_SCHWER, GRADE_GUT, GRADE_LEICHT]

// Boxsprung je Bewertung. `null` heisst: Reset auf BOX_MIN statt eines Deltas.
const BOX_DELTA = { [GRADE_VERGESSEN]: null, [GRADE_SCHWER]: 0, [GRADE_GUT]: 1, [GRADE_LEICHT]: 2 }

const TAG_MS = 24 * 60 * 60 * 1000

function normalisierteBox(box) {
    const b = Number(box)
    return Number.isFinite(b) && b >= BOX_MIN && b <= BOX_MAX ? b : BOX_MIN
}

/** Box nach einer Bewertung — siehe BOX_DELTA. Unbekannte Bewertung zählt wie „Schwer" (kein Sprung, kein Reset). */
export function naechsteBox(box, grad) {
    const aktuelleBox = normalisierteBox(box)
    const delta = BOX_DELTA[grad]
    if (delta === null) return BOX_MIN
    return Math.min(BOX_MAX, aktuelleBox + (delta ?? 0))
}

/** Nächster Fälligkeitszeitpunkt (unix ms) für eine Box, ausgehend von `jetztMs`. */
export function naechsteFaelligkeit(jetztMs, box) {
    const tage = INTERVALL_TAGE[box] ?? 0
    return jetztMs + tage * TAG_MS
}

/** Ist eine Fortschrittszeile jetzt fällig? `faelligAm` fehlt/0 heisst: sofort fällig. */
export function istFaellig(jetztMs, fortschritt) {
    return jetztMs >= Number(fortschritt?.faelligAm ?? 0)
}

/** Alle fälligen Fortschrittszeilen aus einer Liste. */
export function kartenFaellig(jetztMs, alleFortschritt) {
    return (alleFortschritt || []).filter(f => istFaellig(jetztMs, f))
}

/** Verteilung über die Boxen, z.B. für eine kleine Balkenanzeige. */
export function boxVerteilung(alleFortschritt) {
    const verteilung = {}
    for (let b = BOX_MIN; b <= BOX_MAX; b++) verteilung[b] = 0
    for (const f of (alleFortschritt || [])) {
        verteilung[normalisierteBox(f?.box)]++
    }
    return verteilung
}

const HISTORIE_MAX = 20

/**
 * `historie` kommt in zwei Formen an: als JSON-Text (frisch von hier
 * geschrieben) oder als bereits geparstes Array (die generische DB-Route
 * parst deklarierte JSON-Spalten beim Lesen automatisch, siehe
 * `JSON_COLUMNS` in `server/api-routes.js`). Ohne diese Unterscheidung würde
 * `JSON.parse()` an einem Array scheitern und die Historie bei jedem Reload
 * still auf einen Eintrag zurückfallen.
 */
export function parseHistorie(historie) {
    if (Array.isArray(historie)) return historie
    if (typeof historie === 'string') {
        try { return JSON.parse(historie || '[]') } catch (_) { return [] }
    }
    return []
}

/**
 * Zentrale Regel: aus dem bisherigen Fortschritt + Bewertung den neuen
 * Zustand bauen. `fortschritt` darf unvollständig oder null sein (z.B. beim
 * allerersten Review einer eigenen Karte). `grad` ist eine der GRADES.
 */
export function auswerten(fortschritt, grad, jetztMs) {
    const box = naechsteBox(fortschritt?.box, grad)
    let historie = parseHistorie(fortschritt?.historie).concat({ t: jetztMs, grad }).slice(-HISTORIE_MAX)

    /*
     * DREI Zähler, nicht zwei.
     *
     * Bis zum 05.09.2026 lief hier `gewusst = grad !== VERGESSEN` in
     * `gesamtRichtig` — „Schwer" zählte also dauerhaft als Treffer. Die
     * Sitzungsbilanz hatte das seit dem Audit vom 28.08.2026 getrennt, die
     * Zähler in der Datenbank nicht, und genau aus ihnen rechnet
     * `src/utils/lernStatistik.js` die Erfolgsquote. Die Statistik-Seite war
     * damit systematisch zu gut — bei genau den Karten, die noch nicht sitzen.
     *
     * `richtigStreak` bleibt bewusst an `gewusst` hängen: die Serie fragt nach
     * dem Wiedersehen (kam die Karte zurück auf Box 1?), nicht nach dem
     * Können. Dasselbe gilt für den Boxsprung — beides ist Leitner-Kanon und
     * steht so im Modulkopf.
     *
     * Eine unbekannte Bewertung wird wie „Schwer" verbucht, passend zu
     * `naechsteBox()`, das sie ebenfalls dorthin fallen lässt.
     */
    const vergessen = grad === GRADE_VERGESSEN
    const sicher = grad === GRADE_GUT || grad === GRADE_LEICHT
    const schwer = !vergessen && !sicher
    const gewusst = !vergessen

    return {
        box,
        faelligAm: naechsteFaelligkeit(jetztMs, box),
        zuletztGesehenAm: jetztMs,
        richtigStreak: gewusst ? (Number(fortschritt?.richtigStreak) || 0) + 1 : 0,
        gesamtRichtig: (Number(fortschritt?.gesamtRichtig) || 0) + (sicher ? 1 : 0),
        gesamtSchwer: (Number(fortschritt?.gesamtSchwer) || 0) + (schwer ? 1 : 0),
        gesamtFalsch: (Number(fortschritt?.gesamtFalsch) || 0) + (vergessen ? 1 : 0),
        historie: JSON.stringify(historie),
    }
}
