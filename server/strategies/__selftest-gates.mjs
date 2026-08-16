/**
 * Selbsttest der Freigabe-Tore.
 *
 *   node server/strategies/__selftest-gates.mjs
 *
 * Diese Tore stehen zwischen einer Strategie und echtem Geld. Ein Tor, das zu
 * früh aufgeht, ist teurer als jeder andere Fehler in diesem Projekt — deshalb
 * wird hier vor allem geprüft, dass sie ZU bleiben.
 */

import { bewerteGates } from '../live-gates.js'
import { MIN_TRADES_BELASTBAR } from '../strategy-backtest.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Ein Lauf, der alle Tore erfüllt — Ausgangspunkt für die Gegenproben. */
const guterLauf = (ueber = {}) => ({
    risk: { feeBps: 6, slippageBps: 2 },
    entscheidung: 'uebernommen',
    ...ueber,
    // `stats` ZULETZT und gemischt: stünde die Streuung von `ueber` danach,
    // ersetzte eine Teilangabe den ganzen Block — dann fehlten Trades und
    // Abdeckung, und der Test prüfte etwas anderes als er behauptet.
    stats: {
        trades: MIN_TRADES_BELASTBAR + 10,
        expectancyR: 0.3,
        expectancyROhneTop: 0.2,
        abdeckung: { vollstaendig: true },
        ...(ueber.stats || {}),
    },
})

const offen = (r, id) => r.offen.includes(id)

console.log('\nFreigabe-Tore — Selbsttest\n')

console.log('Der vollständige Fall')
{
    const r = bewerteGates({ laeufe: [guterLauf()], paperTrades: 50, minPaperTrades: 20 })
    check('alle Tore offen → bereit', r.bereit === true, JSON.stringify(r.offen))
    check('sieben Tore werden geprüft', r.tore.length === 7, String(r.tore.length))
}

console.log('\nJedes Tor hält für sich')
{
    // Ohne Gebühren gerechnet: kein optimistischer Test, sondern ein anderer.
    const ohneKosten = bewerteGates({ laeufe: [guterLauf({ risk: { feeBps: 0 } })], paperTrades: 50, minPaperTrades: 20 })
    check('Lauf ohne Gebühren zählt nicht', !ohneKosten.bereit && offen(ohneKosten, 'lauf_mit_kosten'))
    // Fehlt das Kostenmodell ganz (alte Läufe), gilt dasselbe.
    const ohneRisk = bewerteGates({ laeufe: [guterLauf({ risk: undefined })], paperTrades: 50, minPaperTrades: 20 })
    check('Lauf ohne gespeichertes Kostenmodell zählt nicht', offen(ohneRisk, 'lauf_mit_kosten'))

    const zuWenig = bewerteGates({
        laeufe: [guterLauf({ stats: { trades: MIN_TRADES_BELASTBAR - 1 } })],
        paperTrades: 50, minPaperTrades: 20,
    })
    check(`unter ${MIN_TRADES_BELASTBAR} Trades hält das Stichproben-Tor`, offen(zuWenig, 'stichprobe'))

    const luecke = bewerteGates({
        laeufe: [guterLauf({ stats: { abdeckung: { vollstaendig: false } } })],
        paperTrades: 50, minPaperTrades: 20,
    })
    check('unvollständige Daten halten das Abdeckungs-Tor', offen(luecke, 'daten_vollstaendig'))

    const negativ = bewerteGates({
        laeufe: [guterLauf({ stats: { expectancyR: -0.1 } })], paperTrades: 50, minPaperTrades: 20,
    })
    check('negativer Erwartungswert hält das Tor', offen(negativ, 'erwartung_positiv'))

    // Der teure Fall: gut nur wegen eines einzigen Trades.
    const ausreisser = bewerteGates({
        laeufe: [guterLauf({ stats: { expectancyR: 0.5, expectancyROhneTop: -0.1 } })],
        paperTrades: 50, minPaperTrades: 20,
    })
    check('positiv nur mit dem grössten Gewinner → Tor hält', offen(ausreisser, 'ohne_ausreisser'))
    check('dabei bleibt „Erwartung positiv" erfüllt', !offen(ausreisser, 'erwartung_positiv'))

    const unentschieden = bewerteGates({
        laeufe: [guterLauf({ entscheidung: 'offen' })], paperTrades: 50, minPaperTrades: 20,
    })
    check('ohne dokumentierte Entscheidung hält das Tor', offen(unentschieden, 'entscheidung_dokumentiert'))

    const wenigPapier = bewerteGates({ laeufe: [guterLauf()], paperTrades: 5, minPaperTrades: 20 })
    check('zu wenige Papier-Trades halten das Tor', offen(wenigPapier, 'papier_erfahrung'))
    const ohneMindest = bewerteGates({ laeufe: [guterLauf()], paperTrades: 0, minPaperTrades: 0 })
    check('ohne Mindestzahl ist das Papier-Tor erfüllt', !offen(ohneMindest, 'papier_erfahrung'))
}

console.log('\nZusammengesetzte Fälle')
{
    // Die Tore dürfen NICHT über verschiedene Läufe hinweg zusammengestückelt
    // werden, wenn es um denselben Nachweis geht: ein Lauf ohne Gebühren mit
    // schönem Ergebnis plus ein Lauf mit Gebühren ohne Trades ergibt keinen
    // belastbaren Nachweis. Geprüft wird deshalb die Kette auf DEMSELBEN Lauf.
    const gestueckelt = bewerteGates({
        laeufe: [
            guterLauf({ risk: { feeBps: 0 }, stats: { trades: 100, expectancyR: 1, expectancyROhneTop: 0.9 } }),
            guterLauf({ stats: { trades: 3, expectancyR: -1, expectancyROhneTop: -1 } }),
        ],
        paperTrades: 50, minPaperTrades: 20,
    })
    check('gute Zahlen aus verschiedenen Läufen ergeben keine Freigabe',
        gestueckelt.bereit === false, JSON.stringify(gestueckelt.offen))

    // Der Fall, den das Tor „entscheidung_dokumentiert" bisher durchliess:
    // Lauf A trägt die ganze Beweislast, ist aber nicht übernommen — Lauf B ist
    // wertlos, trägt aber den Haken „übernommen". Zusammen sah das nach
    // Freigabe aus.
    const falscheDeckung = bewerteGates({
        laeufe: [
            guterLauf({ entscheidung: 'offen' }),
            guterLauf({ stats: { trades: 3, expectancyR: -1, expectancyROhneTop: -1 } }),
        ],
        paperTrades: 50, minPaperTrades: 20,
    })
    check('Entscheidung auf einem schwachen Lauf deckt den starken nicht',
        falscheDeckung.bereit === false && offen(falscheDeckung, 'entscheidung_dokumentiert'),
        JSON.stringify(falscheDeckung.offen))

    // Gegenprobe: derselbe starke Lauf, diesmal selbst übernommen → frei.
    const echteDeckung = bewerteGates({
        laeufe: [
            guterLauf(),
            guterLauf({ stats: { trades: 3, expectancyR: -1, expectancyROhneTop: -1 } }),
        ],
        paperTrades: 50, minPaperTrades: 20,
    })
    check('ein einzelner vollständiger Lauf genügt weiterhin',
        echteDeckung.bereit === true, JSON.stringify(echteDeckung.offen))

    check('leere Eingabe ist nie bereit', bewerteGates({}).bereit === false)
    check('ohne Läufe sind alle Nachweis-Tore offen',
        bewerteGates({ paperTrades: 99, minPaperTrades: 1 }).offen.length === 6)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
