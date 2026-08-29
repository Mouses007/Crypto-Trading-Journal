/**
 * Selbsttest des Wal-Parsers.
 *
 *   node server/__selftest-wal-parser.mjs
 *
 * Prüft echte Post-Formate (Whale Alert bot-generiert, Lookonchain freier
 * formuliert) sowie die Richtungslogik (auf eine Börse zu = 'ein', von einer
 * Börse weg = 'aus', Wallet-zu-Wallet/Mint/Burn = 'unbekannt') und dass ein
 * nicht erkannter Beitrag niemals eine geratene Zahl liefert.
 */

import { parseWalBeitrag } from './wal-parser.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nWhale Alert (hohe Zuversicht)')
{
    const r = parseWalBeitrag('🚨🚨🚨 500,000,000 #USDT (500,004,825 USD) transferred from unknown wallet to #Binance https://whale-alert.io/tx/1')
    check('erkannt', r.erkannt === true, JSON.stringify(r))
    check('Betrag', r.betrag === 500000000, r.betrag)
    check('Symbol', r.symbol === 'USDT', r.symbol)
    check('USD-Wert', r.usdWert === 500004825, r.usdWert)
    check('Richtung: auf Binance zu = ein (Verkaufsdruck)', r.richtung === 'ein', r.richtung)
    check('Zuversicht hoch', r.zuversicht === 'hoch', r.zuversicht)
}
{
    const r = parseWalBeitrag('1,000 #BTC (109,876,543 USD) transferred from #Binance to unknown wallet')
    check('Richtung: von Binance weg = aus (Verwahrung)', r.richtung === 'aus', r.richtung)
    check('Betrag mit Komma korrekt geparst', r.betrag === 1000, r.betrag)
}
{
    const r = parseWalBeitrag('5,000 #ETH (12,345,678 USD) transferred from unknown wallet to unknown wallet')
    check('Wallet-zu-Wallet: Richtung unbekannt statt geraten', r.richtung === 'unbekannt', r.richtung)
}
{
    const r = parseWalBeitrag('500,000,000 #USDC (500,000,000 USD) minted at Circle Treasury')
    check('Mint hat keine Kauf/Verkaufs-Richtung', r.richtung === 'unbekannt', r.richtung)
    check('Mint trotzdem erkannt mit Betrag/USD', r.erkannt && r.betrag === 500000000 && r.usdWert === 500000000)
}

console.log('\nLookonchain (mittlere Zuversicht)')
{
    const r = parseWalBeitrag('A whale withdrew 5,000 $ETH ($12,345,678) from Binance 4 hours ago')
    check('erkannt', r.erkannt === true, JSON.stringify(r))
    check('Symbol', r.symbol === 'ETH', r.symbol)
    check('Richtung: withdrew from Börse = aus', r.richtung === 'aus', r.richtung)
    check('Zuversicht mittel', r.zuversicht === 'mittel', r.zuversicht)
    check('Gegenpartei ohne Zeitrauschen ("4 hours ago" abgeschnitten)', r.gegenpartei === 'Binance', r.gegenpartei)
}
{
    const r = parseWalBeitrag('Whale deposited 2,000 $BTC ($218,000,000) to Coinbase')
    check('Richtung: deposited to Börse = ein', r.richtung === 'ein', r.richtung)
}
{
    // Realer Lookonchain-Fund: "into" statt "to" — ohne die Erweiterung blieb
    // das eine 237-Mio-$-Meldung mit Richtung "unbekannt" und Gegenpartei "—".
    const r = parseWalBeitrag('Bitcoin mining company #MetaPlanet has deposited 3,000 $BTC($237M) into #CoinbasePrime in the past 24 hours.')
    check('"into" wird wie "to" erkannt', r.richtung === 'ein', r.richtung)
    check('Gegenpartei ohne "in the past 24 hours"', r.gegenpartei === '#CoinbasePrime', r.gegenpartei)
}
{
    // Realer Lookonchain-Fund mit "9 hours ago" direkt an die Gegenpartei angehängt
    const r = parseWalBeitrag('5p6zPz withdrew 281,446 $SOL ($29.68M) from #Binance 9 hours ago.')
    check('Gegenpartei ohne "9 hours ago"', r.gegenpartei === '#Binance', r.gegenpartei)
    check('Richtung weiterhin aus', r.richtung === 'aus', r.richtung)
}
{
    // Abgekürzter USD-Betrag (K/M/B) — häufig bei Lookonchain
    const r = parseWalBeitrag('A whale bought 10,000,000 $PEPE ($500K) 30 minutes ago')
    check('Abkürzung K wird aufgelöst', r.erkannt && r.usdWert === 500000, r.usdWert)
}

console.log('\nKein Rateversuch bei unklarem Text')
{
    const r = parseWalBeitrag('Bitcoin crossed $70,000 today amid renewed institutional interest.')
    check('kein Treffer, kein erfundener Betrag', r.erkannt === false)
}
{
    const r = parseWalBeitrag('')
    check('leerer Text bricht nicht', r.erkannt === false)
}
{
    const r = parseWalBeitrag(undefined)
    check('undefined bricht nicht', r.erkannt === false)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log('Fehlgeschlagen:')
    for (const f of fehler) console.log(`  - ${f}`)
    process.exit(1)
}
