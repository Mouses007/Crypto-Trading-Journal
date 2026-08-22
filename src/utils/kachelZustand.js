/**
 * Zustand eines eigenen Datenstroms → Zustandspunkt der Kachel.
 *
 * Reines Datenmodul: Zeichenkette rein, Zeichenkette raus, kein Vue, kein Netz.
 * Selbsttest: `src/utils/__selftest-kachel-zustand.mjs`.
 *
 * ## Warum es das braucht
 *
 * Das Kachelraster kennt fünf Zustände (`idle`, `loading`, `ready`, `veraltet`,
 * `error`) und leitet daraus den Punkt der ganzen Seite ab. Kacheln, die ihre
 * Daten über einen eigenen Strom holen — Bookmap und Hebelkarte —, kennen aber
 * ihre eigene, feinere Sprache: `syncing` ist etwas anderes als `connecting`,
 * `paused` etwas anderes als `reconnecting`. Bisher erreichte davon **nichts**
 * den Rahmen: `useKachelRaster.js` setzte solche Kacheln beim Mount einmal auf
 * `ready` und fasste sie nie wieder an. Ein toter Socket blieb grün — die
 * gefährlichste Anzeige, die ein Handelsfenster haben kann, weil man einer
 * eingefrorenen Karte genauso vertraut wie einer laufenden.
 *
 * ## Warum `paused` und `empty` „veraltet" sind und nicht „bereit"
 *
 * Beide bedeuten: auf dem Schirm steht etwas, aber es wächst nicht mehr.
 * `paused` ist gewollt (Tab im Hintergrund), `empty` ist Datenmangel — für die
 * Frage „darf ich dieser Fläche gerade glauben?" ist das dasselbe Nein. Grün
 * wäre gelogen, rot wäre Panik; gelb ist die ehrliche Antwort.
 */

/**
 * Zustände, die `LiveFeed` (`liveFeed.js:_setState`) und
 * `HebelkartenCanvas`/`LeverageMapSource` melden können, auf die fünf
 * Rasterzustände abgebildet.
 */
/*
 * `Object.create(null)` statt eines Literals: sonst erbt die Tabelle die
 * Prototypenkette, und `rasterZustand('constructor')` läge plötzlich als
 * Funktion vor statt als `undefined` — der Rückfall auf `idle` griffe nicht.
 * Vom Selbsttest gefunden, nicht ausgedacht.
 */
const ABBILDUNG = Object.assign(Object.create(null), {
    // Es läuft
    live: 'ready',
    replay: 'ready',
    ready: 'ready',

    // Es kommt gleich
    connecting: 'loading',
    syncing: 'loading',
    loading: 'loading',

    // Es steht etwas da, aber es wächst nicht mehr
    reconnecting: 'veraltet',
    paused: 'veraltet',
    empty: 'veraltet',

    // Es ist kaputt
    error: 'error',
})

/**
 * @param {string} stromZustand Zustand des eigenen Datenstroms
 * @returns {'idle'|'loading'|'ready'|'veraltet'|'error'}
 *
 * Ein unbekannter Zustand ergibt `idle`, nicht `ready`: Ein neuer Zustand, den
 * hier niemand eingetragen hat, ist keine Zusicherung, dass alles in Ordnung
 * ist. Unbekannt heisst unbekannt.
 */
export function rasterZustand(stromZustand) {
    return ABBILDUNG[stromZustand] || 'idle'
}

/** Nur für den Selbsttest: welche Zustände überhaupt abgebildet sind. */
export const BEKANNTE_ZUSTAENDE = Object.keys(ABBILDUNG)
