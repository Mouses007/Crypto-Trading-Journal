/**
 * Das Live-Trading-Fenster in einem EIGENEN Browserfenster öffnen.
 *
 * Warum überhaupt ein zweites Fenster: während einer Handelssitzung will man
 * nichts anderes sehen. Im Journal-Tab liegen Dashboard, Kalender und
 * Auswertung eine Mausbewegung entfernt — genau die Ablenkung, gegen die eine
 * Sitzung mit festem Plan gedacht ist. Das eigene Fenster kann man auf einen
 * zweiten Bildschirm legen und stehen lassen.
 *
 * ## Warum das Vollbild nicht einfach erzwungen wird
 *
 * Die Fullscreen-API verlangt eine Nutzergeste **im Dokument, das ins Vollbild
 * geht**. Ein frisch geöffnetes Fenster hat keine — der Klick fand im Öffner
 * statt, und über Fenstergrenzen hinweg zählt er nicht. Jeder Versuch, das zu
 * umgehen, endet in einer stillen Ausnahme.
 *
 * Deshalb zwei Stufen:
 *   1. Das Fenster wird so gross wie der verfügbare Bildschirm geöffnet und
 *      läuft ohne Seitenmenü und ohne Navigation (`?cockpit=1`). Das ist optisch
 *      schon Vollbild bis auf die Fensterleiste des Systems.
 *   2. Darin liegt ein Knopf, der auf Klick echtes Vollbild schaltet — dann mit
 *      Geste und damit erlaubt.
 *
 * Wird der Popup blockiert, geht es im aktuellen Tab weiter, statt dass gar
 * nichts passiert.
 */

const ZIEL = '/livetrading?cockpit=1'

/** Fenstername: ein zweiter Klick holt dasselbe Fenster nach vorn statt ein drittes zu öffnen. */
const FENSTER_NAME = 'ctjLivetrading'

export function oeffneLivetradingFenster() {
    // `availWidth/Height` statt `width/height`: die Taskleiste soll nicht
    // überdeckt werden, sonst liegt der untere Rand des Fensters darunter.
    const b = window.screen?.availWidth || 1600
    const h = window.screen?.availHeight || 900
    const merkmale = [
        'popup=yes',
        `width=${b}`, `height=${h}`,
        'left=0', 'top=0',
        // Ohne diese drei behandeln manche Browser den Aufruf als normalen Tab
        // und ignorieren Grösse und Position vollständig.
        'menubar=no', 'toolbar=no', 'location=no',
        'noopener=no',
    ].join(',')

    let fenster = null
    try {
        fenster = window.open(ZIEL, FENSTER_NAME, merkmale)
    } catch {
        fenster = null
    }

    if (!fenster) {
        // Popup-Blocker: dann eben hier. Voller Seitenwechsel, damit die Timer
        // und der Sortable der aufrufenden Seite sicher beendet werden.
        window.location.href = ZIEL
        return null
    }

    /*
     * Ein BENANNTES Fenster wird beim zweiten Aufruf wiederverwendet — und dann
     * gelten die Merkmale oben nicht mehr: der Browser holt das bestehende
     * Fenster bloss nach vorn, in seiner alten Grösse und mit seinem alten
     * Inhalt. Genau das sah aus, als sei nichts passiert.
     *
     * Deshalb hinterher ausdrücklich:
     *   - Ziel setzen, damit ein wiederverwendetes Fenster auch wirklich neu
     *     lädt (und den aktuellen Programmstand bekommt)
     *   - auf Bildschirmgrösse ziehen und in die Ecke setzen
     *
     * `resizeTo`/`moveTo` wirken nur auf Fenster, die ein Skript geöffnet hat —
     * unseres ist so eines. Schlägt es fehl, bleibt das Fenster eben kleiner;
     * ein Grund zum Abbrechen ist das nicht.
     */
    try { fenster.location.href = ZIEL } catch { /* fremder Ursprung — egal */ }
    try {
        fenster.moveTo(0, 0)
        fenster.resizeTo(b, h)
    } catch { /* vom Browser abgelehnt */ }
    try { fenster.focus() } catch { /* egal */ }
    return fenster
}
