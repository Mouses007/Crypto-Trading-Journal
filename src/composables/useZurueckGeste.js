/**
 * „Zurück" schliesst die oberste Ebene, statt die Seite zu verlassen.
 *
 * Am Handy ist die Zurück-Geste der erste Griff, mit dem man etwas
 * Aufgeklapptes wieder loswird — beim Android-Knopf ebenso wie beim Wischen
 * vom Bildschirmrand. Ohne diese Behandlung verlässt sie stattdessen die
 * ganze Seite: Man wollte nur die Gross-Ansicht zumachen und steht plötzlich
 * wieder im Dashboard, mit neu geladenen Daten.
 *
 * Verfahren: Beim Öffnen wird ein Verlaufseintrag auf denselben Pfad gelegt
 * (die Adresse ändert sich also nicht, der Router merkt nichts davon). Ein
 * „Zurück" nimmt genau diesen Eintrag weg — das melden wir als Schliessen.
 * Wird stattdessen über den Knopf geschlossen, räumen wir den Eintrag selbst
 * ab, damit kein toter Schritt im Verlauf zurückbleibt.
 *
 * Mehrere Ebenen liegen als Stapel übereinander (Menü, darüber eine
 * Gross-Ansicht) — „Zurück" nimmt immer nur die oberste.
 */

/** Schliessfunktionen, die oberste zuletzt. */
const ebenen = []
/** Ein von uns selbst ausgelöstes `history.back()` darf nicht als Geste zählen. */
let eigenerSchritt = false
let hoertZu = false

function beiPopstate() {
    if (eigenerSchritt) { eigenerSchritt = false; return }
    // Erst vom Stapel nehmen, DANN schliessen: sonst räumt das folgende
    // Aufräumen (siehe ebeneZu) den Verlaufseintrag ein zweites Mal ab und
    // springt eine echte Seite zurück.
    const schliessen = ebenen.pop()
    if (schliessen) schliessen()
}

function sorgeFuerZuhoerer() {
    if (hoertZu) return
    window.addEventListener('popstate', beiPopstate)
    hoertZu = true
}

/** Ebene öffnen: einen eigenen Verlaufseintrag hinterlegen. */
export function ebeneAuf(schliessen) {
    if (typeof window === 'undefined' || ebenen.includes(schliessen)) return
    sorgeFuerZuhoerer()
    ebenen.push(schliessen)
    history.pushState({ ctjEbene: ebenen.length }, '')
}

/** Ebene auf anderem Weg geschlossen (Knopf, Hintergrund): Eintrag abräumen. */
export function ebeneZu(schliessen) {
    const i = ebenen.lastIndexOf(schliessen)
    if (i === -1) return   // schon per Geste abgeräumt — nichts zu tun
    ebenen.splice(i, 1)
    eigenerSchritt = true
    history.back()
}
