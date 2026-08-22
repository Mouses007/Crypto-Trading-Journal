/**
 * Selbsttest der Sitzungsrechnung.
 *
 *   node server/__selftest-sitzung-pnl.mjs
 *
 * Die beiden Entscheidungen, die hier festgenagelt werden:
 *
 *  1. **Realisiert und unrealisiert bleiben getrennt.** Ein schwebender
 *     Buchgewinn ist kein Ergebnis.
 *  2. **Der Plan zählt am realisierten Teil.** Würde eine offene Position
 *     mitzählen, riss die Verlustgrenze bei jedem Rücksetzer.
 */

import { berechneSitzung } from './sitzung-rechnung.js'
import { schnappschussAusPositionen } from './livetrading-api.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const zu = (pnl, extra = {}) => ({ realizedPNL: pnl, fee: 0, funding: 0, ...extra })
const auf = (u) => ({ unrealizedPNL: u })

console.log('\nSitzungsrechnung — Selbsttest\n')

// ── Summen ───────────────────────────────────────────────────────────────
console.log('Summen')
{
    const a = berechneSitzung({
        geschlossen: [zu(30), zu(-10), zu(5)],
        offen: [auf(12), auf(-4)],
    })
    check('realisiert summiert', a.realisiertUsd === 25, String(a.realisiertUsd))
    check('unrealisiert summiert', a.unrealisiertUsd === 8, String(a.unrealisiertUsd))
    check('Gesamt ist die Summe beider', a.gesamtUsd === 33, String(a.gesamtUsd))
    check('… bleibt aber ein DRITTER Wert, die beiden stehen einzeln',
        a.realisiertUsd === 25 && a.unrealisiertUsd === 8)
    check('Trades gezählt', a.tradeAnzahl === 3, String(a.tradeAnzahl))
    check('Gewinner gezählt', a.gewinner === 2, String(a.gewinner))
    check('Verlierer gezählt', a.verlierer === 1, String(a.verlierer))
    check('offene Positionen gezählt', a.offeneAnzahl === 2)
    check('offenes Risiko nur der negative Teil', a.offenesRisikoUsd === -4, String(a.offenesRisikoUsd))
}

console.log('\nGebühren und Funding')
{
    const a = berechneSitzung({
        geschlossen: [zu(30, { fee: -1.5, funding: 0.2 }), zu(-10, { fee: -1.2, funding: -0.4 })],
    })
    check('Gebühren summiert', Math.abs(a.gebuehrenUsd - (-2.7)) < 1e-9, String(a.gebuehrenUsd))
    check('Funding summiert', Math.abs(a.fundingUsd - (-0.2)) < 1e-9, String(a.fundingUsd))
    check('… und NICHT von realisiert abgezogen (Bitunix rechnet sie schon ein)',
        a.realisiertUsd === 20, String(a.realisiertUsd))
}

// ── Der Plan ─────────────────────────────────────────────────────────────
console.log('\nPlan: Verlustgrenze')
{
    const knapp = berechneSitzung({ geschlossen: [zu(-199)], planMaxVerlustUsd: 200 })
    check('199 von 200 verloren: nicht verletzt', knapp.plan.verletzt === false)
    check('… Anteil knapp unter 1', Math.abs(knapp.plan.verlustAnteil - 0.995) < 1e-9,
        String(knapp.plan.verlustAnteil))

    const genau = berechneSitzung({ geschlossen: [zu(-200)], planMaxVerlustUsd: 200 })
    check('genau 200 verloren: noch NICHT verletzt (Grenze ist erlaubt)',
        genau.plan.verletzt === false)
    check('… Anteil genau 1', genau.plan.verlustAnteil === 1)

    const drueber = berechneSitzung({ geschlossen: [zu(-200.01)], planMaxVerlustUsd: 200 })
    check('200.01 verloren: verletzt', drueber.plan.verletzt === true)
    check('… mit Grund „verlust"', drueber.plan.gruende.includes('verlust'))

    const gewinn = berechneSitzung({ geschlossen: [zu(500)], planMaxVerlustUsd: 200 })
    check('im Gewinn ist der Verlust-Anteil 0, nicht negativ',
        gewinn.plan.verlustAnteil === 0, String(gewinn.plan.verlustAnteil))

    // Der Kern: eine offene Position darf die Grenze NICHT reissen
    const schwebend = berechneSitzung({
        geschlossen: [zu(-50)], offen: [auf(-400)], planMaxVerlustUsd: 200,
    })
    check('offener Buchverlust von 400 reisst die 200er-Grenze NICHT',
        schwebend.plan.verletzt === false)
    check('… der Anteil zählt nur den realisierten Teil',
        Math.abs(schwebend.plan.verlustAnteil - 0.25) < 1e-9, String(schwebend.plan.verlustAnteil))
    check('… er ist aber als offenes Risiko sichtbar',
        schwebend.offenesRisikoUsd === -400)
}

console.log('\nPlan: Trade-Grenze')
{
    const fuenf = berechneSitzung({
        geschlossen: [zu(1), zu(1), zu(1), zu(1), zu(1)], planMaxTrades: 5,
    })
    check('genau 5 von 5 Trades: nicht verletzt', fuenf.plan.verletzt === false)
    check('… Anteil genau 1', fuenf.plan.tradeAnteil === 1)

    const sechs = berechneSitzung({
        geschlossen: [zu(1), zu(1), zu(1), zu(1), zu(1), zu(1)], planMaxTrades: 5,
    })
    check('6 von 5 Trades: verletzt', sechs.plan.verletzt === true)
    check('… mit Grund „trades"', sechs.plan.gruende.includes('trades'))
    check('offene Positionen zählen nicht als Trades',
        berechneSitzung({ offen: [auf(1), auf(1)], planMaxTrades: 1 }).plan.verletzt === false)
}

console.log('\nPlan: keine Grenze gesetzt')
{
    const ohne = berechneSitzung({ geschlossen: [zu(-9999)] })
    check('ohne Grenze ist verlustAnteil null, nicht 0',
        ohne.plan.verlustAnteil === null, String(ohne.plan.verlustAnteil))
    check('ohne Grenze ist tradeAnteil null', ohne.plan.tradeAnteil === null)
    check('ohne Grenze kann nichts verletzt sein', ohne.plan.verletzt === false)
    check('beide Grenzen können gleichzeitig reissen',
        (() => {
            const a = berechneSitzung({
                geschlossen: [zu(-500), zu(-1), zu(-1)],
                planMaxVerlustUsd: 100, planMaxTrades: 2,
            })
            return a.plan.gruende.length === 2
        })())
}

// ── Robustheit ───────────────────────────────────────────────────────────
console.log('\nRobustheit')
{
    const leer = berechneSitzung()
    check('ohne Argumente kommen Nullen, kein NaN',
        leer.realisiertUsd === 0 && leer.unrealisiertUsd === 0 && leer.gesamtUsd === 0)
    check('… und Zählungen auf 0', leer.tradeAnzahl === 0 && leer.offeneAnzahl === 0)

    const muell = berechneSitzung({
        geschlossen: [{ realizedPNL: 'abc' }, {}, null && {}],
        offen: [{ unrealizedPNL: undefined }],
    })
    check('unlesbare Beträge gelten als 0, nicht als NaN',
        muell.realisiertUsd === 0 && !Number.isNaN(muell.realisiertUsd))
    check('… und werden trotzdem als Trade gezählt', muell.tradeAnzahl === 3)

    const strings = berechneSitzung({ geschlossen: [zu('12.5'), zu('-2.5')] })
    check('Beträge als String werden gelesen (die Börse liefert so)',
        strings.realisiertUsd === 10, String(strings.realisiertUsd))

    const schreib = berechneSitzung({
        geschlossen: [{ realized_pnl: 5 }, { realizedPnl: 3 }],
        offen: [{ unrealized_pnl: 2 }, { unrealizedPnl: 1 }],
    })
    check('snake_case und camelCase werden beide gelesen',
        schreib.realisiertUsd === 8 && schreib.unrealisiertUsd === 3,
        `${schreib.realisiertUsd}/${schreib.unrealisiertUsd}`)

    /*
     * Break-even zählt als GEWINNER — derselbe Kanon wie im Journal
     * (`totals-kern.js`). Vorher fiel ein 0-Trade durch beide Raster: die
     * Sitzung zeigte eine andere Trefferquote als das Journal desselben Tages,
     * ohne dass irgendwo ein Trade gefehlt hätte.
     */
    const be = berechneSitzung({ geschlossen: [zu('0'), zu('5'), zu('-3')] })
    check('Break-even zählt als Gewinner, nicht als drittes Ergebnis',
        be.gewinner === 2 && be.verlierer === 1,
        `gewinner=${be.gewinner} verlierer=${be.verlierer}`)
    check('Break-even zählt trotzdem als Trade',
        be.tradeAnzahl === 3, String(be.tradeAnzahl))

    check('keine Listen übergeben wirft nicht',
        (() => {
            try { berechneSitzung({ offen: null, geschlossen: 'nein' }); return true }
            catch { return false }
        })())
}

// ── Live-Stand und Abschluss ─────────────────────────────────────────────
/*
 * Der eigentliche Grund für diesen Block: Bis zum 22.08.2026 rechnete die
 * Kachel „Positionen & Plan" aus Bitunix-Positionen, das Beenden der Sitzung
 * dagegen im Browser aus bereits importierten Journal-Trades. Ein verzögerter
 * Import genügte, damit Live-Anzeige, Planurteil und Archiv verschiedene
 * Zahlen zeigten — ohne Hinweis, welche stimmt. Beide Wege gehen jetzt durch
 * `holeSitzungsRohdaten` und `berechneSitzung`; hier wird festgehalten, dass
 * dieselben Rohdaten auch dasselbe Ergebnis geben.
 */
console.log('\nLive-Stand und Abschluss rechnen gleich')
{
    const rohdaten = {
        offen: [auf(12.5)],
        geschlossen: [
            { realizedPNL: 30, fee: -1.5, funding: 0.2, symbol: 'BTCUSDT', side: 'BUY', ctime: 1000, mtime: 5000, entryPrice: '100', closePrice: '103', maxQty: '0.5' },
            { realizedPNL: -10, fee: -1.2, funding: -0.4, symbol: 'ETHUSDT', side: 'SELL', ctime: 2000, mtime: 9000, entryPrice: '50', closePrice: '51', maxQty: '2' },
        ],
    }
    const plan = { planMaxVerlustUsd: 100, planMaxTrades: 5 }

    const stand = berechneSitzung({ ...rohdaten, ...plan })
    const abschluss = berechneSitzung({ ...rohdaten, ...plan })

    check('realisiert identisch', stand.realisiertUsd === abschluss.realisiertUsd, String(stand.realisiertUsd))
    check('Tradeanzahl identisch', stand.tradeAnzahl === abschluss.tradeAnzahl)
    check('Planurteil identisch', stand.plan.verletzt === abschluss.plan.verletzt)

    // Die Zahl, die im Archiv als `pnlUsd` landet, ist genau die, die die
    // Kachel als „realisiert" zeigt — nicht eine um Funding verschobene.
    check('gespeicherte pnlUsd ist die realisierte P&L der Kachel',
        Math.abs(abschluss.realisiertUsd - 20) < 1e-9, String(abschluss.realisiertUsd))
    check('unrealisiert geht NICHT ins Ergebnis ein',
        Math.abs(abschluss.realisiertUsd - 20) < 1e-9 && abschluss.unrealisiertUsd === 12.5)

    const schnapp = schnappschussAusPositionen(rohdaten.geschlossen)
    check('Schnappschuss hat eine Zeile je geschlossener Position', schnapp.length === 2)
    check('… nach Ausstiegszeit sortiert', schnapp[0].symbol === 'BTCUSDT' && schnapp[1].symbol === 'ETHUSDT')
    check('… Zeiten in Sekunden', schnapp[0].entryTime === 1 && schnapp[0].exitTime === 5,
        `${schnapp[0].entryTime}/${schnapp[0].exitTime}`)
    // Summe der Einzelzeilen muss die Sitzungssumme ergeben, sonst zeigt die
    // Archivzeile etwas anderes als die aufgeklappte Liste darunter.
    const summe = schnapp.reduce((n, x) => n + x.netProceeds, 0)
    check('Summe der Zeilen == pnlUsd der Sitzung',
        Math.abs(summe - abschluss.realisiertUsd) < 1e-9, `${summe} vs ${abschluss.realisiertUsd}`)
    check('Gebühr ohne Vorzeichenspiel', schnapp[0].commission === 1.5, String(schnapp[0].commission))
    check('brutto = realizedPNL + |Gebühr|', schnapp[0].grossProceeds === 31.5, String(schnapp[0].grossProceeds))
    check('Funding steht als eigenes Feld daneben', schnapp[1].funding === -0.4, String(schnapp[1].funding))
    check('Menge aus maxQty, nicht aus qty', schnapp[1].qty === 2, String(schnapp[1].qty))
}
{
    // Der Fall, der den alten Weg zur Falschaussage machte: Die Börse kennt
    // Trades, das Journal hat sie noch nicht importiert. Früher stand dann eine
    // makellose Nullsitzung im Archiv, weil im Browser aus dem leeren Journal
    // gerechnet wurde. Heute ist die Bitunix-Antwort die einzige Grundlage.
    const a = berechneSitzung({
        offen: [],
        geschlossen: [zu(-250)],
        planMaxVerlustUsd: 100,
    })
    check('ein Verlust über der Grenze wird als Verletzung erkannt', a.plan.verletzt === true)
    check('… mit Grund „verlust"', a.plan.gruende.includes('verlust'))
    check('… und nicht als Nullsitzung', a.realisiertUsd === -250 && a.tradeAnzahl === 1)
}
{
    const leer = schnappschussAusPositionen([])
    check('leere Liste ergibt leeren Schnappschuss', Array.isArray(leer) && leer.length === 0)
    check('null ergibt leeren Schnappschuss', schnappschussAusPositionen(null).length === 0)
    const kaputt = schnappschussAusPositionen([null, {}, { realizedPNL: 'abc' }])
    check('unbrauchbare Zeilen werfen nicht', kaputt.length === 2)
    check('… und werden zu 0, nicht zu NaN',
        kaputt.every(x => Number.isFinite(x.netProceeds)), JSON.stringify(kaputt.map(x => x.netProceeds)))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log(`\x1b[31mFehler: ${fehler.join(', ')}\x1b[0m\n`)
    process.exit(1)
}
console.log('')
