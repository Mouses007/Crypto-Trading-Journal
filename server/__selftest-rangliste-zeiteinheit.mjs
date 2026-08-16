/**
 * Selbsttest der Zeiteinheit-Ableitung.
 *
 *   node server/__selftest-rangliste-zeiteinheit.mjs
 *
 * Diese Funktion trifft eine Vorauswahl, die der Nutzer meistens einfach
 * übernimmt — sie muss also entweder richtig liegen oder ehrlich sagen, dass sie
 * nichts weiss. Die gefährlichste Sorte Fehler wäre ein Vorschlag, der plausibel
 * aussieht und aus einer leeren Datenlage stammt.
 *
 * Backtests und Instanzen werden eingespeist; der Test braucht keine Datenbank.
 */

import { leiteZeiteinheitAb } from './rangliste-zeiteinheit.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const TAG = 86400000
const toTs = Date.UTC(2026, 7, 16)
const tage = (n) => ({ fromTs: toTs - n * TAG, toTs })

/** Ein gespeicherter Lauf, wie er in `strategy_backtests` steht (stats als JSON-TEXT). */
const lauf = (timeframe, trades, expectancyR, entscheidung = 'offen') => ({
    timeframe, entscheidung,
    stats: JSON.stringify({ trades, expectancyR, winRate: 50 }),
})

console.log('\nZeiteinheit-Ableitung — Selbsttest\n')

// ── Stufe 0: was gesperrt wird und was nicht ─────────────────────────────
console.log('Stufe 0 — Sperren')
{
    const r = leiteZeiteinheitAb('lsob', { ...tage(180), backtests: [], instanzen: [] })
    const gesperrt = r.gesperrt.map((g) => g.timeframe)

    // 180 Tage auf 5m sind 51 840 Kerzen — der Abruf würde hinten abschneiden
    // und still einen kürzeren Zeitraum messen als bestellt.
    check('5m über 180 Tage ist gesperrt', gesperrt.includes('5m'), JSON.stringify(gesperrt))
    check('… mit nachvollziehbarem Grund',
        r.gesperrt.find((g) => g.timeframe === '5m')?.grund === 'zu_viele_kerzen')

    // 1d wäre OHNE den Vorlauf-Kunstgriff unmöglich (90 Kerzen je Hälfte gegen
    // 300 Vorlauf). Weil jede Hälfte ihren eigenen Vorlauf bekommt, läuft sie —
    // sie wird nur nie belastbar. Das ist ein Hinweis, keine Sperre.
    check('1d über 180 Tage ist NICHT gesperrt', !gesperrt.includes('1d'), JSON.stringify(gesperrt))
    check('… sondern als knapp gekennzeichnet',
        r.knapp.some((k) => k.timeframe === '1d'), JSON.stringify(r.knapp.map((k) => k.timeframe)))
    check('… und der Hinweis nennt die Kerzenzahl',
        /90 Kerzen/.test(r.knapp.find((k) => k.timeframe === '1d')?.text || ''),
        r.knapp.find((k) => k.timeframe === '1d')?.text)

    // Bei einem sehr kurzen Zeitraum hat eine Hälfte zu wenige Kerzen für
    // überhaupt ein Ergebnis.
    const kurz = leiteZeiteinheitAb('lsob', { ...tage(10), backtests: [], instanzen: [] })
    check('bei 10 Tagen ist 1d gesperrt (eine Hälfte hätte 5 Kerzen)',
        kurz.gesperrt.some((g) => g.timeframe === '1d' && g.grund === 'haelfte_zu_kurz'),
        JSON.stringify(kurz.gesperrt.map((g) => `${g.timeframe}:${g.grund}`)))

    check('gesperrte Zeiteinheiten stehen nicht unter den Kandidaten',
        !r.kandidaten.includes('5m'), r.kandidaten.join(','))
    check('die Sperre steht auch im Begründungssatz', /5m ist gesperrt/.test(r.begruendung))
}

// ── Stufe 2: der Altbestand ohne `belastbar` ─────────────────────────────
console.log('\nStufe 2 — was bestanden hätte')
{
    // Genau die echte Lage vom 16.08.2026: 21 Läufe auf 1h (17 davon mit >= 30
    // Trades und positivem Erwartungswert), 4 auf 4h (keiner davon). KEINE
    // Zeile trägt ein `belastbar`-Feld — im Altbestand gibt es das nicht.
    const backtests = [
        ...Array.from({ length: 17 }, () => lauf('1h', 45, 0.43)),
        ...Array.from({ length: 4 }, () => lauf('1h', 12, 0.8)),
        ...Array.from({ length: 4 }, () => lauf('4h', 8, 1.2)),
    ]
    const r = leiteZeiteinheitAb('lsob', { ...tage(180), backtests, instanzen: [] })

    check('1h gewinnt', r.timeframe === '1h', `${r.timeframe} [${r.quelle}]`)
    check('die Quelle ist „bestanden"', r.quelle === 'bestanden', r.quelle)
    check('die Begründung nennt beide Zahlen', /17 von 21/.test(r.begruendung), r.begruendung)
    check('sie nennt auch die unterlegene Zeiteinheit', /4h hatte 4 Läufe/.test(r.begruendung), r.begruendung)
    check('ein hoher Erwartungswert bei 8 Trades gewinnt NICHT',
        r.timeframe !== '4h', r.timeframe)

    // Der Kern: kein einziger Lauf hat `stats.belastbar`. Würde die Ableitung
    // darauf filtern, käme hier nichts heraus.
    check('die Belastbarkeit wird selbst gerechnet, nicht aus dem Feld gelesen',
        !backtests.some((b) => JSON.parse(b.stats).belastbar !== undefined) && r.quelle === 'bestanden')

    // Gleichstand bei der Anzahl → höherer Median entscheidet
    const gleich = leiteZeiteinheitAb('lsob', {
        ...tage(180),
        backtests: [lauf('1h', 40, 0.2), lauf('4h', 40, 0.9)],
        instanzen: [],
    })
    check('bei Gleichstand entscheidet der höhere Median', gleich.timeframe === '4h', gleich.timeframe)
}

// ── Stufe 1 schlägt Stufe 2 ──────────────────────────────────────────────
console.log('\nStufe 1 — übernommen schlägt alles')
{
    const backtests = [
        ...Array.from({ length: 17 }, () => lauf('1h', 45, 0.43)),
        lauf('4h', 31, 0.05, 'uebernommen'),
    ]
    const r = leiteZeiteinheitAb('lsob', { ...tage(180), backtests, instanzen: [] })
    check('eine getroffene Entscheidung schlägt die Statistik',
        r.timeframe === '4h' && r.quelle === 'uebernommen', `${r.timeframe} [${r.quelle}]`)

    // Ohne ein einziges `uebernommen` — der echte Zustand — fällt es durch.
    const ohne = leiteZeiteinheitAb('lsob', {
        ...tage(180), backtests: backtests.map((b) => ({ ...b, entscheidung: 'offen' })), instanzen: [],
    })
    check('ohne Übernahme fällt es sauber auf Stufe 2 durch', ohne.quelle === 'bestanden', ohne.quelle)

    // Eine übernommene, aber gesperrte Zeiteinheit darf nicht gewinnen.
    const gesperrtUebernommen = leiteZeiteinheitAb('lsob', {
        ...tage(180), backtests: [lauf('5m', 900, 0.3, 'uebernommen'), lauf('1h', 45, 0.4)], instanzen: [],
    })
    check('eine gesperrte Zeiteinheit gewinnt auch als übernommene nicht',
        gesperrtUebernommen.timeframe === '1h', gesperrtUebernommen.timeframe)
}

// ── Stufe 3: Instanzen ───────────────────────────────────────────────────
console.log('\nStufe 3 — laufende Instanzen')
{
    const eine = leiteZeiteinheitAb('lsob', {
        ...tage(180), backtests: [], instanzen: [{ timeframe: '15m', timeframes: [] }],
    })
    check('genau eine Zeiteinheit im Betrieb → die', eine.timeframe === '15m' && eine.quelle === 'instanz',
        `${eine.timeframe} [${eine.quelle}]`)

    // Die echte LSOB-Lage: fünf Instanzen auf fünf Zeiteinheiten. Dass alle
    // fünf laufen, sagt über die beste GAR NICHTS — hier darf nicht entschieden
    // werden, sonst gewinnt der Zufall der Sortierreihenfolge.
    const fuenf = leiteZeiteinheitAb('lsob', {
        ...tage(180), backtests: [],
        instanzen: ['1d', '5m', '1h', '15m', '4h'].map((t) => ({ timeframe: t, timeframes: [] })),
    })
    check('fünf Instanzen auf fünf Zeiteinheiten → keine Entscheidung',
        fuenf.timeframe === '' && fuenf.quelle === 'nichts', `${fuenf.timeframe} [${fuenf.quelle}]`)
    check('… aber alle als Kandidaten angeboten', fuenf.kandidaten.length === 4,
        fuenf.kandidaten.join(','))
    check('… und die gesperrte 5m ist nicht dabei', !fuenf.kandidaten.includes('5m'),
        fuenf.kandidaten.join(','))
    check('… mit Begründung, warum nicht entschieden wird',
        /laufen 4 Zeiteinheiten nebeneinander/.test(fuenf.begruendung), fuenf.begruendung)

    check('mehrere Zeiteinheiten EINER Instanz zählen genauso',
        leiteZeiteinheitAb('lsob', {
            ...tage(180), backtests: [], instanzen: [{ timeframe: '1h', timeframes: ['1h', '4h'] }],
        }).quelle === 'nichts')

    // Backtests schlagen Instanzen
    const beides = leiteZeiteinheitAb('lsob', {
        ...tage(180), backtests: [lauf('1h', 45, 0.4)],
        instanzen: [{ timeframe: '15m', timeframes: [] }],
    })
    check('ein aussagekräftiger Backtest schlägt die Instanz', beides.timeframe === '1h', beides.timeframe)
}

// ── Stufe 4 und Randfälle ────────────────────────────────────────────────
console.log('\nStufe 4 und Randfälle')
{
    const nichts = leiteZeiteinheitAb('lsob', { ...tage(180), backtests: [], instanzen: [] })
    check('ohne jede Datenlage kein Vorschlag', nichts.timeframe === '' && nichts.quelle === 'nichts',
        `${nichts.timeframe} [${nichts.quelle}]`)
    check('… aber Kandidaten zur Auswahl', nichts.kandidaten.length > 0, nichts.kandidaten.join(','))
    check('… und ein Satz, der das erklärt', /weder einen übernommenen/.test(nichts.begruendung))

    const unbekannt = leiteZeiteinheitAb('gibtesnicht', tage(180))
    check('eine unbekannte Strategie kippt nicht um',
        unbekannt.quelle === 'unbekannt' && unbekannt.timeframe === '', unbekannt.quelle)

    check('ohne Zeitraum kippt es nicht um',
        leiteZeiteinheitAb('lsob', {}).timeframe === '')

    // Läufe mit kaputtem stats-JSON dürfen nicht durchschlagen
    const kaputt = leiteZeiteinheitAb('lsob', {
        ...tage(180), backtests: [{ timeframe: '1h', entscheidung: 'offen', stats: '{kaputt' }], instanzen: [],
    })
    check('unlesbares stats-JSON zählt als nicht bestanden statt zu werfen',
        kaputt.quelle === 'nichts', kaputt.quelle)
}

console.log(`\n${fehlgeschlagen === 0 ? '\x1b[32m' : '\x1b[31m'}${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\x1b[0m`)
if (fehlgeschlagen) { console.log('Fehlgeschlagen:'); for (const f of fehler) console.log(`  · ${f}`) }
process.exit(fehlgeschlagen ? 1 : 0)
