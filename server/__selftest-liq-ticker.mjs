/**
 * Selbsttest des Liquidations-Ringpuffers.
 *
 *   node server/__selftest-liq-ticker.mjs
 *
 * Drei Dinge müssen stehen: die Verdrängung (nach Zeit UND nach Obergrenze),
 * die Minuteneinteilung an ihren Grenzen, und die Seiten-Konvention. Letztere
 * ist im Projekt viermal relevant und schon einmal falsch gewesen — hier wird
 * sie festgenagelt: `1 = SHORT liquidiert`, `0 = LONG liquidiert`.
 */

import { merkeLiq, lies, _leere, _grenzen } from './liq-ticker.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Fester Bezugszeitpunkt, damit nichts von der echten Uhr abhängt. */
const T0 = 1_700_000_000_000

console.log('\nLiquidations-Ticker — Selbsttest\n')

// ── Grundrechnung ────────────────────────────────────────────────────────
console.log('Summen und Seiten')
{
    _leere()
    // 1 = Short liquidiert, 0 = Long liquidiert
    merkeLiq('binance', 'BTCUSDT', T0 - 60_000, 100, 2, 0)   // 200 $ Long
    merkeLiq('binance', 'BTCUSDT', T0 - 30_000, 100, 3, 1)   // 300 $ Short
    const a = lies({ minuten: 15, jetzt: T0 })

    check('Long-Summe stimmt', a.gesamt.longUsd === 200, String(a.gesamt.longUsd))
    check('Short-Summe stimmt', a.gesamt.shortUsd === 300, String(a.gesamt.shortUsd))
    check('Anzahl stimmt', a.gesamt.anzahl === 2, String(a.gesamt.anzahl))
    check('Seite 1 zählt als SHORT liquidiert', a.gesamt.shortUsd === 300)
    check('Seite 0 zählt als LONG liquidiert', a.gesamt.longUsd === 200)
    check('Betrag ist Preis × Menge', a.letzte[0].usd === 300, String(a.letzte[0].usd))
    check('Quellen melden Binance', a.quellen.binance === true)
    check('Quellen melden Bybit noch nicht', a.quellen.bybit === false)
}

// ── Verdrängung nach Zeit ────────────────────────────────────────────────
console.log('\nVerdrängung nach Zeit')
{
    _leere()
    merkeLiq('binance', 'BTCUSDT', T0 - 20 * 60_000, 100, 1, 0)   // 20 min alt
    merkeLiq('binance', 'BTCUSDT', T0 - 5 * 60_000, 100, 1, 0)    // 5 min alt

    const kurz = lies({ minuten: 15, jetzt: T0 })
    check('20 Minuten altes Ereignis fällt aus dem 15-Minuten-Fenster',
        kurz.gesamt.anzahl === 1, String(kurz.gesamt.anzahl))

    const lang = lies({ minuten: 30, jetzt: T0 })
    check('… ist im 30-Minuten-Fenster aber noch da',
        lang.gesamt.anzahl === 2, String(lang.gesamt.anzahl))

    // Jetzt ein frisches Ereignis: das schiebt die Zeitgrenze und wirft das alte raus
    merkeLiq('binance', 'BTCUSDT', T0 + 11 * 60_000, 100, 1, 0)
    const nach = lies({ minuten: 30, jetzt: T0 + 11 * 60_000 })
    check('ein neues Ereignis verdrängt das über 30 Minuten alte',
        nach.gesamt.anzahl === 2, String(nach.gesamt.anzahl))

    check('Fenster wird auf 30 Minuten gedeckelt',
        lies({ minuten: 999, jetzt: T0 }).fensterMinuten === 30)
    check('Fenster hat eine Untergrenze von 1 Minute',
        lies({ minuten: 0, jetzt: T0 }).fensterMinuten === 15,
        'bei 0 greift die Vorgabe 15')
}

// ── Verdrängung nach Obergrenze ──────────────────────────────────────────
console.log('\nVerdrängung nach Obergrenze')
{
    _leere()
    const n = _grenzen.MAX_EREIGNISSE + 500
    for (let i = 0; i < n; i++) {
        // Alle innerhalb einer Minute, damit die Zeitgrenze NICHT greift
        merkeLiq('binance', 'BTCUSDT', T0 - 30_000 + i, 100, 1, 0)
    }
    const a = lies({ minuten: 15, jetzt: T0 })
    check(`mehr als ${_grenzen.MAX_EREIGNISSE} Ereignisse werden gekappt`,
        a.gesamt.anzahl <= _grenzen.MAX_EREIGNISSE, String(a.gesamt.anzahl))
    check('… und zwar die ÄLTESTEN (das jüngste ist noch da)',
        a.letzte[0].t === T0 - 30_000 + n - 1, String(a.letzte[0].t))
}

// ── Minuteneinteilung ────────────────────────────────────────────────────
console.log('\nMinuteneinteilung')
{
    _leere()
    const minute = Math.floor(T0 / 60_000) * 60_000
    merkeLiq('binance', 'BTCUSDT', minute, 100, 1, 0)           // erste ms der Minute
    merkeLiq('binance', 'BTCUSDT', minute + 59_999, 100, 1, 0)  // letzte ms derselben Minute
    merkeLiq('binance', 'BTCUSDT', minute + 60_000, 100, 1, 0)  // erste ms der nächsten

    const a = lies({ minuten: 15, jetzt: minute + 120_000 })
    check('zwei Eimer bei drei Ereignissen über eine Minutengrenze',
        a.jeMinute.length === 2, String(a.jeMinute.length))
    check('erster Eimer enthält zwei Ereignisse',
        a.jeMinute[0].anzahl === 2, String(a.jeMinute[0].anzahl))
    check('Eimer sind aufsteigend sortiert',
        a.jeMinute[0].t < a.jeMinute[1].t)
    check('Eimergrenze liegt auf einer glatten Minute',
        a.jeMinute[0].t % 60_000 === 0)
}

// ── Symbolfilter und Börsentrennung ──────────────────────────────────────
console.log('\nSymbolfilter und Börsen')
{
    _leere()
    merkeLiq('binance', 'BTCUSDT', T0 - 1000, 100, 1, 0)
    merkeLiq('bybit', 'ETHUSDT', T0 - 1000, 50, 2, 1)

    const alle = lies({ minuten: 15, jetzt: T0 })
    check('ohne Filter kommen beide Symbole', alle.gesamt.anzahl === 2)
    check('je Symbol aufgeschlüsselt', alle.jeSymbol.length === 2, String(alle.jeSymbol.length))
    check('beide Börsen als Quelle gemeldet',
        alle.quellen.binance === true && alle.quellen.bybit === true)

    const nurBtc = lies({ minuten: 15, symbol: 'BTCUSDT', jetzt: T0 })
    check('Symbolfilter greift', nurBtc.gesamt.anzahl === 1, String(nurBtc.gesamt.anzahl))
    check('… und filtert die richtige Seite heraus',
        nurBtc.gesamt.longUsd === 100 && nurBtc.gesamt.shortUsd === 0)

    check('Symbol wird gross geschrieben verglichen',
        lies({ minuten: 15, symbol: 'btcusdt', jetzt: T0 }).gesamt.anzahl === 1)
    check('unbekanntes Symbol liefert Nullen statt NaN',
        (() => {
            const a = lies({ minuten: 15, symbol: 'DOGEUSDT', jetzt: T0 })
            return a.gesamt.anzahl === 0 && a.gesamt.longUsd === 0 && a.gesamt.shortUsd === 0
        })())
    check('die Börse steht am einzelnen Ereignis',
        alle.letzte.some(e => e.boerse === 'bybit'))
}

// ── Grösste Ereignisse ───────────────────────────────────────────────────
console.log('\nGrösste Ereignisse')
{
    _leere()
    merkeLiq('binance', 'BTCUSDT', T0 - 3000, 100, 1, 0)    //  100 $
    merkeLiq('binance', 'BTCUSDT', T0 - 2000, 100, 50, 1)   // 5000 $
    merkeLiq('binance', 'BTCUSDT', T0 - 1000, 100, 5, 0)    //  500 $

    const a = lies({ minuten: 15, jetzt: T0 })
    check('grösstes Ereignis steht vorn', a.groesste[0].usd === 5000, String(a.groesste[0].usd))
    check('absteigend nach Betrag sortiert',
        a.groesste.every((e, i) => i === 0 || e.usd <= a.groesste[i - 1].usd))
    check('das Band ist NEUESTES zuerst',
        a.letzte[0].t === T0 - 1000, String(a.letzte[0].t))
}

// ── Robustheit ───────────────────────────────────────────────────────────
console.log('\nRobustheit')
{
    _leere()
    merkeLiq('binance', 'BTCUSDT', NaN, 100, 1, 0)
    merkeLiq('binance', 'BTCUSDT', T0, NaN, 1, 0)
    merkeLiq('binance', 'BTCUSDT', T0, 100, NaN, 0)
    merkeLiq('binance', 'BTCUSDT', T0, 0, 1, 0)        // Preis 0
    merkeLiq('binance', 'BTCUSDT', T0, 100, 0, 0)      // Menge 0
    merkeLiq('binance', 'BTCUSDT', T0, -5, 1, 0)       // negativer Preis
    merkeLiq('binance', '', T0, 100, 1, 0)             // ohne Symbol
    check('unbrauchbare Ereignisse werden verworfen, nicht gespeichert',
        lies({ minuten: 15, jetzt: T0 }).gesamt.anzahl === 0,
        String(lies({ minuten: 15, jetzt: T0 }).gesamt.anzahl))

    merkeLiq('binance', 'BTCUSDT', T0, 100, 1, 7)      // unsinnige Seite
    check('eine Seite ausserhalb {0,1} gilt als LONG (0)',
        lies({ minuten: 15, jetzt: T0 }).gesamt.longUsd === 100)

    _leere()
    const leer = lies({ minuten: 15, jetzt: T0 })
    check('leerer Ring liefert Nullen statt NaN',
        leer.gesamt.longUsd === 0 && leer.gesamt.shortUsd === 0 && leer.gesamt.anzahl === 0)
    check('… und leere Listen statt undefined',
        Array.isArray(leer.jeMinute) && Array.isArray(leer.jeSymbol)
        && Array.isArray(leer.groesste) && Array.isArray(leer.letzte))
    check('… und keine Quelle gemeldet',
        leer.quellen.binance === false && leer.quellen.bybit === false)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log(`\x1b[31mFehler: ${fehler.join(', ')}\x1b[0m\n`)
    process.exit(1)
}
console.log('')
