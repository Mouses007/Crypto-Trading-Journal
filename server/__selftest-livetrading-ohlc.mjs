/**
 * Selbsttest des Intraday-Kerzen-Parsers.
 *
 *   node server/__selftest-livetrading-ohlc.mjs
 *
 * `ohlcAusChart` steht neben `reiheAusChart` und liest dieselbe Yahoo-Antwort,
 * behält aber OHLC. Zwei Dinge sind hier wichtig:
 *
 *  1. **Lücken.** Bei `interval=5m` schickt Yahoo für jede Zeitmarke einen
 *     Eintrag, auch für Minuten ohne Handel — dort stehen `null`. Eine solche
 *     Zeile darf nicht als Nullkerze in den Chart rutschen.
 *  2. **Die alte Funktion bleibt gleich.** `reiheAusChart` versorgt die
 *     Makro-Kachel und die Korrelationsrechnung. Der Regressionsblock unten
 *     hält fest, dass sie bei derselben Eingabe unverändert antwortet.
 */

import { ohlcAusChart, reiheAusChart } from './makro.js'
import { altereIndizes } from './livetrading-api.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Antwort im Format des Yahoo-v8-Chart-Endpunkts nachbauen. */
function antwort({ ts, open, high, low, close, volume, meta = {} }) {
    return {
        chart: {
            result: [{
                meta: {
                    symbol: 'NQ=F', shortName: 'Nasdaq 100 Sep 26',
                    exchangeTimezoneName: 'America/New_York',
                    regularMarketPrice: 30275, regularMarketTime: 1786968714,
                    chartPreviousClose: 30141.75,
                    ...meta,
                },
                timestamp: ts,
                indicators: { quote: [{ open, high, low, close, volume }] },
            }],
        },
    }
}

console.log('\nIntraday-Kerzen — Selbsttest\n')

// ── Grundfall ────────────────────────────────────────────────────────────
console.log('Grundfall')
{
    const a = ohlcAusChart(antwort({
        ts: [1786968000, 1786968300, 1786968600],
        open: [100, 101, 102], high: [105, 106, 107],
        low: [99, 100, 101], close: [101, 102, 103],
        volume: [10, 20, 30],
    }))
    check('drei Kerzen', a.kerzen.length === 3, String(a.kerzen.length))
    check('OHLC bleibt erhalten',
        a.kerzen[0].o === 100 && a.kerzen[0].h === 105 && a.kerzen[0].l === 99 && a.kerzen[0].c === 101)
    check('Volumen bleibt erhalten', a.kerzen[2].v === 30)
    check('Zeit wird auf Millisekunden gebracht',
        a.kerzen[0].t === 1786968000 * 1000, String(a.kerzen[0].t))
    check('Preis kommt aus meta.regularMarketPrice', a.preis === 30275, String(a.preis))
    check('Zeitstempel in Millisekunden', a.zeit === 1786968714 * 1000)
    check('Vortagesschluss übernommen', a.vorherClose === 30141.75, String(a.vorherClose))
    check('Name übernommen', a.name === 'Nasdaq 100 Sep 26')
    check('Börsenzone übernommen', a.zone === 'America/New_York')
}

// ── Lücken ───────────────────────────────────────────────────────────────
console.log('\nLücken (der Normalfall bei 5m)')
{
    const a = ohlcAusChart(antwort({
        ts: [1, 2, 3, 4, 5],
        open: [100, null, 102, 103, 104],
        high: [105, 106, null, 108, 109],
        low: [99, 100, 101, null, 103],
        close: [101, 102, 103, 104, null],
        volume: [1, 2, 3, 4, 5],
    }))
    check('jede Zeile mit einem fehlenden Wert fällt heraus',
        a.kerzen.length === 1, String(a.kerzen.length))
    check('… und zwar bleibt genau die vollständige übrig',
        a.kerzen[0].t === 1000, String(a.kerzen[0].t))

    const b = ohlcAusChart(antwort({
        ts: [1, 2],
        open: [0, 100], high: [105, 106], low: [99, 100], close: [101, 102], volume: [1, 2],
    }))
    check('Nullpreise fallen heraus', b.kerzen.length === 1 && b.kerzen[0].o === 100)

    const c = ohlcAusChart(antwort({
        ts: [1], open: [100], high: [105], low: [99], close: [101], volume: [null],
    }))
    check('fehlendes Volumen macht die Kerze nicht ungültig', c.kerzen.length === 1)
    check('… es wird als 0 geführt', c.kerzen[0].v === 0)
}

// ── Fehlende Felder ──────────────────────────────────────────────────────
console.log('\nUnvollständige Antworten')
{
    check('leeres Objekt liefert leere Kerzenliste statt zu werfen',
        (() => { const a = ohlcAusChart({}); return Array.isArray(a.kerzen) && a.kerzen.length === 0 })())
    check('null liefert leere Kerzenliste',
        (() => { const a = ohlcAusChart(null); return a.kerzen.length === 0 })())
    check('Antwort ohne timestamp liefert leere Liste',
        ohlcAusChart(antwort({ ts: null, open: [1], high: [1], low: [1], close: [1], volume: [1] })).kerzen.length === 0)
    check('Antwort ohne quote liefert leere Liste',
        (() => {
            const j = antwort({ ts: [1], open: [1], high: [1], low: [1], close: [1], volume: [1] })
            j.chart.result[0].indicators = {}
            return ohlcAusChart(j).kerzen.length === 0
        })())

    const ohnePreis = ohlcAusChart(antwort({
        ts: [1, 2], open: [100, 101], high: [105, 106], low: [99, 100], close: [101, 102], volume: [1, 2],
        meta: { regularMarketPrice: null },
    }))
    check('ohne meta-Preis gilt der letzte Schlusskurs',
        ohnePreis.preis === 102, String(ohnePreis.preis))

    const ohneVorher = ohlcAusChart(antwort({
        ts: [1], open: [100], high: [105], low: [99], close: [101], volume: [1],
        meta: { chartPreviousClose: null },
    }))
    check('fehlender Vortagesschluss wird null, nicht 0',
        ohneVorher.vorherClose === null, String(ohneVorher.vorherClose))

    const vorherNull = ohlcAusChart(antwort({
        ts: [1], open: [100], high: [105], low: [99], close: [101], volume: [1],
        meta: { chartPreviousClose: 0 },
    }))
    check('ein Vortagesschluss von 0 gilt als fehlend',
        vorherNull.vorherClose === null)
}

// ── Regressionsschutz für die alte Funktion ──────────────────────────────
console.log('\nreiheAusChart bleibt unverändert')
{
    const j = antwort({
        ts: [1786968000, 1786968300, 1786968600],
        open: [100, 101, 102], high: [105, 106, 107],
        low: [99, 100, 101], close: [101, null, 103], volume: [10, 20, 30],
    })
    const r = reiheAusChart(j)
    check('zwei Punkte (die Lücke fällt raus)', r.reihe.length === 2, String(r.reihe.length))
    check('nur Schlusskurse, kein OHLC',
        Object.keys(r.reihe[0]).sort().join(',') === 'close,tag',
        Object.keys(r.reihe[0]).join(','))
    check('Tag als ISO-Datum', /^\d{4}-\d{2}-\d{2}$/.test(r.reihe[0].tag), r.reihe[0].tag)
    check('Preis wie gehabt aus meta', r.preis === 30275)

    // Beide Parser müssen bei derselben Eingabe dieselben Zeilen behalten,
    // wenn nur der Schlusskurs fehlt
    const o = ohlcAusChart(j)
    check('beide Parser verwerfen dieselbe Zeile',
        o.kerzen.length === r.reihe.length, `${o.kerzen.length} vs ${r.reihe.length}`)
}

// ── Datenalter ───────────────────────────────────────────────────────────
/*
 * Die Kachel zeigte bisher die ABRUFZEIT und sah damit immer frisch aus: der
 * Endpunkt lieferte kein `stand`, das Kachelraster setzte deshalb `Date.now()`.
 * Über einer zehn Minuten alten CME-Kerze stand die aktuelle Uhrzeit. Yahoo
 * verzögert CME rund 10 und ICE rund 30 Minuten — gemessen wird das Alter
 * trotzdem, nicht behauptet.
 */
console.log('\nDatenalter der Indizes')
{
    const JETZT = 1786970000 * 1000
    const min = (m) => JETZT - m * 60000

    const a = altereIndizes({
        maerkte: {
            sp500: { quellenStand: min(9), erwartetMin: 10 },
            dxy: { quellenStand: min(28), erwartetMin: 30 },
        },
    }, JETZT)

    check('Alter wird in Minuten gerechnet', a.maerkte.sp500.alterMinuten === 9, String(a.maerkte.sp500.alterMinuten))
    check('jeder Markt bekommt sein eigenes Alter', a.maerkte.dxy.alterMinuten === 28, String(a.maerkte.dxy.alterMinuten))
    check('innerhalb der erwarteten Verzögerung ist nichts veraltet', a.veraltet === false)
    // Der Kopf zeigt EINE Zahl — sie muss vom ältesten Markt kommen, sonst
    // verdeckt ein munterer ES einen DXY, der seit einer halben Stunde steht.
    check('stand ist der ÄLTESTE Quellenstand', a.stand === min(28), String(a.stand))
}
{
    const JETZT = 1786970000 * 1000
    const a = altereIndizes({
        maerkte: {
            sp500: { quellenStand: JETZT - 16 * 60000, erwartetMin: 10 },
            dxy: { quellenStand: JETZT - 20 * 60000, erwartetMin: 30 },
        },
    }, JETZT)
    // 16 min > 10 erwartet + 5 Reserve → der eine reisst die Kachel auf gelb,
    // obwohl der andere mit 20 von 30 Minuten im Rahmen liegt.
    check('ein Markt über der Grenze macht die Kachel veraltet', a.veraltet === true)
    check('… der andere bleibt trotzdem mit seinem Alter sichtbar',
        a.maerkte.dxy.alterMinuten === 20, String(a.maerkte.dxy.alterMinuten))
}
{
    const JETZT = 1786970000 * 1000
    const a = altereIndizes({
        maerkte: {
            sp500: { quellenStand: null, erwartetMin: 10 },
            nasdaq: null,
            dxy: { quellenStand: JETZT - 60000, erwartetMin: 30 },
        },
    }, JETZT)
    // `Number(null)` ist 0 und damit endlich — ohne Schranke wäre ein fehlender
    // Zeitstempel die frischestmögliche Angabe statt einer unbekannten.
    check('fehlender Quellenstand ergibt null, nicht 0',
        a.maerkte.sp500.alterMinuten === null, String(a.maerkte.sp500.alterMinuten))
    check('ein nicht erreichbarer Markt bleibt null', a.maerkte.nasdaq === null)
    check('… und zieht den Kopfstand nicht auf 1970', a.stand === JETZT - 60000, String(a.stand))
}
{
    const a = altereIndizes({ maerkte: {} }, 1786970000 * 1000)
    check('ohne jeden Markt bleibt stand null', a.stand === null, String(a.stand))
    check('… und veraltet false', a.veraltet === false)
    const b = altereIndizes(null, 1786970000 * 1000)
    check('null-Nutzlast wirft nicht', b.stand === null && b.veraltet === false)
}
{
    // Zeitstempel aus der Zukunft (Uhrdrift) darf kein negatives Alter geben
    const JETZT = 1786970000 * 1000
    const a = altereIndizes({ maerkte: { sp500: { quellenStand: JETZT + 30000, erwartetMin: 10 } } }, JETZT)
    check('Zeitstempel aus der Zukunft ergibt 0, nicht negativ',
        a.maerkte.sp500.alterMinuten === 0, String(a.maerkte.sp500.alterMinuten))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log(`\x1b[31mFehler: ${fehler.join(', ')}\x1b[0m\n`)
    process.exit(1)
}
console.log('')
