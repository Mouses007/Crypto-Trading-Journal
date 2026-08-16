/**
 * Reifegrad einer Instanz — die Belege, die vor dem scharfen Betrieb vorliegen
 * müssen.
 *
 * Bisher kannte die Freigabekette drei Bedingungen: den globalen Schalter, die
 * Freigabe der Instanz und eine Mindestzahl an Papier-Trades. Alle drei fragen
 * nach ERLAUBNIS, keine nach BELEGEN. Man konnte also eine Strategie scharf
 * schalten, deren einziger Backtest über ein halbes Jahr mit sieben Trades lief,
 * ohne Gebühren gerechnet war und deren Ergebnis an einem einzigen Ausreisser
 * hing — genau die drei Fehler, die an einem einzigen Vormittag im August 2026
 * alle drei real aufgetreten sind.
 *
 * Die Prüfung ist bewusst hart und bewusst schlicht: jedes Tor ist eine Frage,
 * die mit den vorhandenen Daten beantwortbar ist. Kein Tor beruht auf einem
 * Urteil, das jemand später anders fällen könnte.
 */

import { MIN_TRADES_BELASTBAR } from './strategy-backtest.js'

/**
 * Bewertet die Tore aus fertigen Daten.
 *
 * @param {object} eingabe
 * @param {Array}  eingabe.laeufe        gespeicherte Backtests dieser Instanz
 *                                       ({ stats, risk, entscheidung })
 * @param {number} eingabe.paperTrades   abgeschlossene Papier-/Schatten-Trades
 * @param {number} eingabe.minPaperTrades
 * @returns {{ tore: Array, offen: Array, bereit: boolean }}
 */
export function bewerteGates({ laeufe = [], paperTrades = 0, minPaperTrades = 0 } = {}) {
    const mitStats = laeufe.filter((l) => l && l.stats)

    // Ein Lauf zählt nur, wenn er mit Kosten gerechnet wurde. Ein Backtest ohne
    // Gebühren ist kein optimistischer Test, sondern ein anderer Test.
    const mitKosten = mitStats.filter((l) => Number(l.risk?.feeBps) > 0)
    const belastbar = mitKosten.filter((l) => Number(l.stats.trades) >= MIN_TRADES_BELASTBAR)
    const vollstaendig = belastbar.filter((l) => l.stats.abdeckung?.vollstaendig !== false)
    const positiv = vollstaendig.filter((l) => Number(l.stats.expectancyR) > 0)
    const ohneAusreisser = positiv.filter((l) => Number(l.stats.expectancyROhneTop) > 0)
    // Die Entscheidung muss sich auf einen Lauf beziehen, der die ganze Kette
    // bestanden hat. Zählte hier jeder beliebige Lauf, liesse sich die Freigabe
    // stückeln: ein schwacher Lauf wird „übernommen", die Beweislast trägt ein
    // ganz anderer — und am Ende steht ein grünes Tor ohne Deckung.
    const entschieden = ohneAusreisser.filter((l) => l.entscheidung === 'uebernommen')

    const tore = [
        {
            id: 'lauf_mit_kosten',
            erfuellt: mitKosten.length > 0,
            detail: `${mitKosten.length} von ${mitStats.length} Läufen mit Gebühren gerechnet`,
        },
        {
            id: 'stichprobe',
            erfuellt: belastbar.length > 0,
            detail: `${belastbar.length} Lauf/Läufe mit mindestens ${MIN_TRADES_BELASTBAR} Trades`,
        },
        {
            id: 'daten_vollstaendig',
            erfuellt: vollstaendig.length > 0,
            detail: 'Lauf über einen lückenlos abgedeckten Zeitraum',
        },
        {
            id: 'erwartung_positiv',
            erfuellt: positiv.length > 0,
            detail: 'Erwartungswert grösser null',
        },
        {
            // Der Test, an dem die Optimizer-Vorschläge #1 und #2 gescheitert
            // sind: hängt das Ergebnis an einem einzigen Trade?
            id: 'ohne_ausreisser',
            erfuellt: ohneAusreisser.length > 0,
            detail: 'auch ohne den grössten Gewinner positiv',
        },
        {
            id: 'entscheidung_dokumentiert',
            erfuellt: entschieden.length > 0,
            detail: 'mindestens ein Lauf ausdrücklich übernommen',
        },
        {
            id: 'papier_erfahrung',
            erfuellt: minPaperTrades <= 0 || paperTrades >= minPaperTrades,
            detail: `${paperTrades} von ${minPaperTrades} Papier-Trades`,
        },
    ]

    const offen = tore.filter((t) => !t.erfuellt).map((t) => t.id)
    return { tore, offen, bereit: offen.length === 0 }
}
