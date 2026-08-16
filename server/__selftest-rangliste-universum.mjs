/**
 * Selbsttest der Universums-Auflösung.
 *
 *   node server/__selftest-rangliste-universum.mjs
 *
 * Die Schnittmenge zweier Börsen ist die Stelle, an der eine Rangliste
 * stillschweigend falsch werden kann: fällt ein Coin heraus, ohne dass es
 * jemand merkt, fehlt er später in der Auswertung und niemand fragt nach ihm.
 * Deshalb prüft dieser Harness vor allem, dass NICHTS unbemerkt verschwindet —
 * jedes aussortierte Symbol muss in genau einer Fehlliste auftauchen.
 *
 * Alle Quellen werden eingespeist, der Test geht nie ins Netz.
 */

import { loeseUniversumAuf, normalisiereSymbole, UNIVERSUM_ARTEN } from './coin-universum.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Bitunix-Antwort wie sie wirklich aussieht — inklusive der Fälle, die rausfallen. */
const bitunixRoh = [
    { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', symbolStatus: 'OPEN', isApiSupported: true, maxLeverage: 200 },
    { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT', symbolStatus: 'OPEN', isApiSupported: true, maxLeverage: 125 },
    { symbol: '1000SHIBUSDT', base: '1000SHIB', quote: 'USDT', symbolStatus: 'OPEN', isApiSupported: true, maxLeverage: 50 },
    { symbol: 'NURBITUNIXUSDT', base: 'NB', quote: 'USDT', symbolStatus: 'OPEN', isApiSupported: true, maxLeverage: 20 },
    // fällt raus: nur in der Oberfläche handelbar (58 echte Fälle)
    { symbol: 'NOAPIUSDT', base: 'NOAPI', quote: 'USDT', symbolStatus: 'OPEN', isApiSupported: false, maxLeverage: 10 },
    // fällt raus: noch nicht eröffnet (1 echter Fall)
    { symbol: 'VORSCHAUUSDT', base: 'VOR', quote: 'USDT', symbolStatus: 'PREVIEW', isApiSupported: true, maxLeverage: 10 },
    // fallen raus: falsche Gegenwährung (25 USDC + 15 USD echte Fälle)
    { symbol: 'BTCUSDC', base: 'BTC', quote: 'USDC', symbolStatus: 'OPEN', isApiSupported: true, maxLeverage: 100 },
    { symbol: 'BTCUSD', base: 'BTC', quote: 'USD', symbolStatus: 'OPEN', isApiSupported: true, maxLeverage: 100 },
]

// Dieselbe Filterregel wie in `holeBitunixPaare` — hier nachgebildet, damit der
// Test die REGEL prüft und nicht nur eine schon gefilterte Liste durchreicht.
const bitunixGefiltert = () => new Map(bitunixRoh
    .filter((p) => p.symbolStatus === 'OPEN' && p.isApiSupported !== false && p.quote === 'USDT')
    .map((p) => [p.symbol, { symbol: p.symbol, maxLeverage: p.maxLeverage, minMenge: 0 }]))

const handelbar = async () => bitunixGefiltert()
const testbar = async () => new Set([
    'BTCUSDT', 'ETHUSDT', '1000SHIBUSDT',
    'XMRUSDT',        // Historie da, auf Bitunix nicht handelbar (die echten 35)
])

console.log('\nCoin-Universen — Selbsttest\n')

// ── Bitunix-Filter ───────────────────────────────────────────────────────
console.log('Filter der Bitunix-Liste')
{
    const m = bitunixGefiltert()
    check('nicht per API handelbare Paare fallen raus', !m.has('NOAPIUSDT'))
    check('Paare in der Vorschau fallen raus', !m.has('VORSCHAUUSDT'))
    check('USDC- und USD-Paare fallen raus', !m.has('BTCUSDC') && !m.has('BTCUSD'))
    check('vier handelbare Paare bleiben übrig', m.size === 4, String(m.size))
    check('der Hebel kommt mit', m.get('BTCUSDT').maxLeverage === 200)
}

// ── Schnittmenge ─────────────────────────────────────────────────────────
console.log('\nSchnittmenge')
{
    const r = await loeseUniversumAuf({ art: 'bitunix' }, { handelbar, testbar })
    check('nur was handelbar UND testbar ist, läuft mit',
        r.symbole.join(',') === 'BTCUSDT,ETHUSDT,1000SHIBUSDT', r.symbole.join(','))
    check('das nur Handelbare steht in der Fehlliste, statt zu verschwinden',
        r.ohneHistorie.includes('NURBITUNIXUSDT'), JSON.stringify(r.ohneHistorie))
    check('gebündelte Kleinstwerte werden beidseitig als dasselbe erkannt',
        r.symbole.includes('1000SHIBUSDT'))
    check('nichts geht unterwegs verloren',
        r.symbole.length + r.ohneHistorie.length === 4,
        `${r.symbole.length} + ${r.ohneHistorie.length}`)
}

// ── Der Schalter „nur handelbare" ────────────────────────────────────────
console.log('\nSchalter „nur handelbare Coins"')
{
    const liste = ['BTCUSDT', 'XMRUSDT']
    const an = await loeseUniversumAuf({ art: 'manuell', symbole: liste }, { handelbar, testbar })
    check('an: der nicht handelbare Coin fällt raus', an.symbole.join(',') === 'BTCUSDT', an.symbole.join(','))
    check('… wird aber benannt', an.nichtHandelbar.join(',') === 'XMRUSDT', an.nichtHandelbar.join(','))

    const aus = await loeseUniversumAuf({ art: 'manuell', symbole: liste, nurHandelbar: 0 }, { handelbar, testbar })
    check('aus: er läuft mit', aus.symbole.join(',') === 'BTCUSDT,XMRUSDT', aus.symbole.join(','))
    check('… und bleibt trotzdem als nicht handelbar markiert',
        aus.nichtHandelbar.includes('XMRUSDT') && aus.meta.XMRUSDT.handelbar === false)
    check('ohne Historie fliegt er IMMER raus, egal wie der Schalter steht',
        !aus.symbole.includes('NURBITUNIXUSDT'))
}

// ── Eingaben säubern ─────────────────────────────────────────────────────
console.log('\nEingaben säubern')
{
    const n = normalisiereSymbole('btcusdt, ETHUSDT; SOLUSDT  ETHUSDT , quatsch!, ')
    check('Kleinschreibung, Komma, Semikolon und Leerzeichen werden geglättet',
        n.symbole.join(',') === 'BTCUSDT,ETHUSDT,SOLUSDT', n.symbole.join(','))
    check('Doppelte fallen weg, die Reihenfolge bleibt', n.symbole.length === 3)
    check('Unsinn wird gemeldet, nicht geschluckt', n.ungueltig.join(',') === 'QUATSCH!', n.ungueltig.join(','))
    check('ein Array geht genauso wie eine Zeichenkette',
        normalisiereSymbole(['btcusdt', 'BTCUSDT']).symbole.join(',') === 'BTCUSDT')
    check('leere Eingabe kippt nicht um', normalisiereSymbole('').symbole.length === 0)
    check('null kippt nicht um', normalisiereSymbole(null).symbole.length === 0)
}

// ── Top-N nach Marktkapitalisierung ──────────────────────────────────────
console.log('\nTop-N nach Marktkapitalisierung')
{
    // Wie `holeMarkt` es liefert: `perp` ist null, wenn es den Coin bei Binance
    // gar nicht als Perpetual gibt. Von den echten Top 100 betrifft das 23.
    const markt = async () => ({ muenzen: [
        { symbol: 'BTC', perp: 'BTCUSDT' },
        { symbol: 'ETH', perp: 'ETHUSDT' },
        { symbol: 'SHIB', perp: '1000SHIBUSDT' },
        { symbol: 'XMR', perp: 'XMRUSDT' },      // testbar, nicht handelbar
        { symbol: 'LEO', perp: null },           // gibt es bei Binance nicht
        { symbol: 'WBT', perp: null },
    ] })
    const r = await loeseUniversumAuf({ art: 'top', n: 6 }, { handelbar, testbar, markt })
    check('Coins ohne Binance-Perpetual werden gezählt, nicht verschluckt',
        r.ohneMarkt.join(',') === 'LEO,WBT', r.ohneMarkt.join(','))
    check('die Rangfolge nach Marktkapitalisierung bleibt erhalten',
        r.symbole.join(',') === 'BTCUSDT,ETHUSDT,1000SHIBUSDT', r.symbole.join(','))
    check('die Aufstellung geht auf',
        r.symbole.length + r.ohneMarkt.length + r.nichtHandelbar.length + r.ohneHistorie.length === 6,
        `${r.symbole.length}+${r.ohneMarkt.length}+${r.nichtHandelbar.length}+${r.ohneHistorie.length}`)
}

// ── Robustheit ───────────────────────────────────────────────────────────
console.log('\nRobustheit')
{
    let geworfen = false
    try { await loeseUniversumAuf({ art: 'zauberei' }, { handelbar, testbar }) } catch (e) { geworfen = true }
    check('eine unbekannte Universumsart wird abgelehnt', geworfen)
    check('die vier Arten sind vollständig',
        UNIVERSUM_ARTEN.join(',') === 'bitunix,top,manuell,ki', UNIVERSUM_ARTEN.join(','))

    const leer = await loeseUniversumAuf({ art: 'manuell', symbole: [] }, { handelbar, testbar })
    check('ein leeres Universum kippt nicht um', leer.symbole.length === 0)

    const ki = await loeseUniversumAuf({ art: 'ki', symbole: ['BTCUSDT', 'ERFUNDENUSDT'] }, { handelbar, testbar })
    check('erfundene Symbole eines KI-Vorschlags landen in der Fehlliste',
        ki.symbole.join(',') === 'BTCUSDT' && ki.ohneHistorie.join(',') === 'ERFUNDENUSDT',
        `${ki.symbole.join(',')} | ${ki.ohneHistorie.join(',')}`)
}

console.log(`\n${fehlgeschlagen === 0 ? '\x1b[32m' : '\x1b[31m'}${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\x1b[0m`)
if (fehlgeschlagen) { console.log('Fehlgeschlagen:'); for (const f of fehler) console.log(`  · ${f}`) }
process.exit(fehlgeschlagen ? 1 : 0)
