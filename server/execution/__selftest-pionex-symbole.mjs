/**
 * Selbsttest der Pionex-Symbolübersetzung — ohne Netz, ohne Datenbank.
 *
 *   node server/execution/__selftest-pionex-symbole.mjs
 *
 * Die Hinrichtung (Journal → Pionex) ist die einzige Stelle im Order-Pfad, an
 * der ein Fehler auf ein FALSCHES PAAR ordern würde statt schlicht zu
 * scheitern. Deshalb prüft dieser Test vor allem, dass geraten NICHT passiert:
 * die Tabelle schlägt die Regel, und ein Symbol, das die Börse nicht führt,
 * wirft — statt eine plausibel aussehende Zeichenkette zu bauen.
 */

import { journalSymbol, pionexSymbol, baueVerzeichnis } from '../pionex-symbole.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
function wirft(fn) { try { fn(); return false } catch { return true } }

console.log('\nPionex → Journal (journalSymbol)\n')
{
    check('Standardfall', journalSymbol('BTC_USDT_PERP') === 'BTCUSDT')
    check('Zahlenpräfix bleibt erhalten', journalSymbol('1000PEPE_USDT_PERP') === '1000PEPEUSDT')
    check('ohne _PERP', journalSymbol('SOL_USDT') === 'SOLUSDT')
    check('Kleinschreibung wird normalisiert', journalSymbol('btc_usdt_perp') === 'BTCUSDT')
    check('leer bleibt leer', journalSymbol('') === '' && journalSymbol(null) === '')
}

console.log('\nJournal → Pionex, Rückfallregel ohne Tabelle\n')
{
    check('Standardfall', pionexSymbol('BTCUSDT') === 'BTC_USDT_PERP')
    check('Zahlenpräfix', pionexSymbol('1000PEPEUSDT') === '1000PEPE_USDT_PERP')
    check('USDC wird nicht von USDT verschluckt', pionexSymbol('BTCUSDC') === 'BTC_USDC_PERP')
    check('unbekannte Quote wirft, statt zu raten', wirft(() => pionexSymbol('BTCFOO')))
    check('leeres Symbol wirft', wirft(() => pionexSymbol('')))
    // Ohne die Längenprüfung wäre 'USDT' selbst ein gültiges Paar mit leerer Basis.
    check('Symbol, das NUR aus der Quote besteht, wirft', wirft(() => pionexSymbol('USDT')))
}

console.log('\nJournal → Pionex, Tabelle schlägt Regel\n')
{
    const tabelle = [
        { symbol: 'BTC_USDT_PERP' },
        { symbol: '1000PEPE_USDT_PERP' },
        { symbol: 'SOL_USDT_PERP' },
    ]
    check('Treffer aus der Tabelle', pionexSymbol('BTCUSDT', tabelle) === 'BTC_USDT_PERP')
    check('Zahlenpräfix über die Tabelle', pionexSymbol('1000PEPEUSDT', tabelle) === '1000PEPE_USDT_PERP')

    // Der wichtigste Fall: die Regel WÜRDE hier 'XYZ_USDT_PERP' bauen, und die
    // Order ginge an ein Paar, das es nicht gibt. Mit Tabelle scheitert es hier
    // — vor dem Senden, mit lesbarem Grund.
    check('nicht gelistetes Paar wirft, obwohl die Regel etwas bauen könnte',
        wirft(() => pionexSymbol('XYZUSDT', tabelle)))

    // Zwei Pionex-Namen, die sich auf denselben Journal-Namen zurückbilden.
    const mehrdeutig = [{ symbol: 'BTC_USDT_PERP' }, { symbol: 'BTCUSDT_PERP' }]
    check('Mehrdeutigkeit wirft, statt die erste zu nehmen',
        wirft(() => pionexSymbol('BTCUSDT', mehrdeutig)))

    // Leere Tabelle ist „keine Tabelle", nicht „nichts handelbar" — sonst
    // stünde der Betrieb still, sobald ein Abruf einmal leer zurückkommt.
    check('leere Tabelle fällt auf die Regel zurück', pionexSymbol('BTCUSDT', []) === 'BTC_USDT_PERP')
}

console.log('\nVerzeichnis (baueVerzeichnis)\n')
{
    const v = baueVerzeichnis([{ symbol: 'BTC_USDT_PERP' }, { symbol: 'SOL_USDT_PERP' }])
    check('Journal-Name als Schlüssel', v.get('BTCUSDT')?.symbol === 'BTC_USDT_PERP')
    check('Grösse stimmt', v.size === 2)

    const doppelt = baueVerzeichnis([{ symbol: 'BTC_USDT_PERP' }, { symbol: 'BTCUSDT_PERP' }])
    check('doppelter Journal-Name wird auf null gesetzt, nicht überschrieben',
        doppelt.get('BTCUSDT') === null)
    check('kaputte Einträge fliegen raus', baueVerzeichnis([null, {}, { symbol: '' }]).size === 0)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
