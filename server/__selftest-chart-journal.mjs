/**
 * Selbsttest der Journal-Auswertung für den Chart.
 *
 *   node server/__selftest-chart-journal.mjs
 *
 * Fallen, die hier abgesichert sind: Symbolschreibweisen der Börsen, die
 * 1000er-Vorsilbe (darf NICHT gleichgesetzt werden), Sekunden vs.
 * Millisekunden, Trades über die Tagesgrenze, doppelte Trades in zwei
 * Zeilen, und R gegen den ANFANGS-Stop statt gegen den nachgezogenen.
 */
import { normSymbol, tradesAusZeilen, anfangsStop, rMultiple, mitNotizen } from './chart-journal.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nahe = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

console.log('\nSymbole\n')
check('Bitget _UMCBL', normSymbol('BTCUSDT_UMCBL') === 'BTCUSDT')
check('Pionex _PERP mit Unterstrichen', normSymbol('BTC_USDT_PERP') === 'BTCUSDT')
check('Bindestrich', normSymbol('eth-usdt') === 'ETHUSDT')
check('1000er-Vorsilbe bleibt (anderer Preis!)', normSymbol('1000PEPEUSDT') !== normSymbol('PEPEUSDT'))

const T = 1_760_000_000          // Sekunden
const tag = (s) => Math.floor(s / 86400) * 86400
const zeilen = [
    {
        dateUnix: tag(T), broker: 'bitunix',
        trades: JSON.stringify([
            { id: 'a', symbol: 'SOLUSDT', strategy: 'long', entryTime: T, exitTime: T + 3600, entryPrice: 100, exitPrice: 106, netProceeds: 5.5, broker: 'bitunix' },
            { id: 'b', symbol: 'BTCUSDT', strategy: 'short', entryTime: T, exitTime: T + 60, entryPrice: 60000, exitPrice: 59900 },
            { id: 'c', symbol: 'SOLUSDT_UMCBL', strategy: 'short', side: 'SS', entryTime: (T + 7200) * 1000, exitTime: (T + 9000) * 1000, entryPrice: 107, exitPrice: 108 },
        ]),
    },
    // Derselbe Trade 'a' noch einmal in einer zweiten Zeile (anderer Broker-Import)
    { dateUnix: tag(T), broker: 'bitunix', trades: [{ id: 'a', symbol: 'SOLUSDT', strategy: 'long', entryTime: T, exitTime: T + 3600, entryPrice: 100, exitPrice: 106 }] },
    // Swing-Trade: Einstieg vor dem Fenster, Ausstieg darin
    { dateUnix: tag(T) + 86400, broker: 'bitunix', trades: JSON.stringify([{ id: 'd', symbol: 'SOLUSDT', strategy: 'long', entryTime: T - 5 * 86400, exitTime: T + 600, entryPrice: 90, exitPrice: 101 }]) },
    { dateUnix: tag(T), broker: 'bitunix', trades: 'kaputt{' },
]

console.log('\nTrades aus Tageszeilen\n')
{
    const von = T * 1000
    const bis = (T + 86400) * 1000
    const tr = tradesAusZeilen(zeilen, 'SOLUSDT', von, bis)
    const ids = tr.map((t) => t.id)
    check('nur SOLUSDT, auch Bitget-Schreibweise', ids.includes('a') && ids.includes('c') && !ids.includes('b'), ids.join(','))
    check('doppelter Trade nur einmal', ids.filter((x) => x === 'a').length === 1)
    check('Swing-Trade mit Ausstieg im Fenster erscheint', ids.includes('d'))
    check('kaputtes JSON bricht nichts', tr.length === 3)
    const a = tr.find((t) => t.id === 'a')
    check('Sekunden → Millisekunden', a.einstieg.t === T * 1000 && a.ausstieg.t === (T + 3600) * 1000)
    const c = tr.find((t) => t.id === 'c')
    check('schon Millisekunden bleiben Millisekunden', c.einstieg.t === (T + 7200) * 1000)
    check('Short erkannt', c.richtung === 'short')
    check('nach Einstieg sortiert', tr[0].id === 'd')
    const spaeter = tradesAusZeilen(zeilen, 'SOLUSDT', (T + 4000) * 1000, bis)
    check('Trade, der vor dem Fenster endete, fehlt', !spaeter.some((t) => t.id === 'a'))
}

console.log('\nAnfangs-Stop und R\n')
{
    const verlauf = {
        sl: 100.5, // zuletzt auf Break-even nachgezogen
        tpslHistory: [
            { time: T * 1000 + 5000, type: 'SL', oldVal: 97, newVal: 100.5, action: 'changed' },
            { time: T * 1000 + 1000, type: 'SL', oldVal: null, newVal: 97, action: 'set' },
            { time: T * 1000 + 2000, type: 'TP', oldVal: null, newVal: 110, action: 'set' },
        ],
    }
    check('Anfangs-Stop aus dem frühesten SL-Eintrag (unsortiert geliefert)', anfangsStop(verlauf) === 97)
    check('Verlauf beginnt mit einer Änderung: alter Wert ist der Anfang', anfangsStop({ tpslHistory: [{ time: 1, type: 'SL', oldVal: 95, newVal: 99 }] }) === 95)
    check('Ohne Verlauf: Stop beim Schliessen', anfangsStop({ sl: 96 }) === 96)
    check('Ohne alles: null', anfangsStop(null) === null)
    const long = { richtung: 'long', einstieg: { p: 100 }, ausstieg: { p: 106 } }
    check('Long 100→106 bei Stop 97 = +2 R', nahe(rMultiple(long, 97), 2))
    check('Gegen den Break-even-Stop gäbe es kein R (Risiko 0 → null)', rMultiple(long, 100) === null)
    const short = { richtung: 'short', einstieg: { p: 107 }, ausstieg: { p: 108 } }
    check('Short 107→108 bei Stop 109 = −0.5 R', nahe(rMultiple(short, 109), -0.5))
    check('Stop auf der falschen Seite → null statt negativem Risiko', rMultiple(short, 105) === null)
}

console.log('\nNotizen anhängen\n')
{
    const tr = tradesAusZeilen(zeilen, 'SOLUSDT', T * 1000, (T + 86400) * 1000)
    const notizen = [{
        tradeId: 'a', entryNote: 'Retest der Zone', playbook: 'Breakout', strategyFollowed: 1, screenshotId: 's1',
        tradingMetadata: JSON.stringify({ sl: 97, tp: 110, fills: [{ time: T * 1000, price: 100, qty: 2 }, { time: T, price: 'x', qty: 1 }] }),
    }]
    const tags = [{ tradeId: 'a', tags: JSON.stringify(['A+']), closingTags: ['geduldig'] }]
    const voll = mitNotizen(tr, notizen, tags)
    const a = voll.find((t) => t.id === 'a')
    check('SL/TP und R am Trade', a.sl === 97 && a.tp === 110 && nahe(a.r, 2))
    check('Fill mit kaputtem Preis fällt weg', a.fills.length === 1)
    check('Notiz, Playbook, Regeltreue, Screenshot', a.notiz.einstieg === 'Retest der Zone' && a.notiz.playbook === 'Breakout' && a.notiz.regelTreu === 1 && a.notiz.screenshots[0] === 's1')
    check('Tags aus beiden Spalten', a.tags.join() === 'A+,geduldig')
    const ohne = voll.find((t) => t.id === 'c')
    check('Trade ohne Notiz: notiz null, R null', ohne.notiz === null && ohne.r === null)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
