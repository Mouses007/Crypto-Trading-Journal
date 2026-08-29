/**
 * Wal-Transaktionen aus Rohtext erkennen — pur, kein Netz, keine DB.
 *
 * Zwei Vorlagen, unterschiedlich zuverlässig:
 *  - Whale Alert postet bot-generiert nach immer demselben Muster
 *    ("<Menge> #<SYMBOL> (<Betrag> USD) transferred from X to Y") — hohe
 *    Zuversicht.
 *  - Lookonchain schreibt freier ("A whale withdrew <Menge> $<SYMBOL>
 *    ($<Betrag>) from <Börse>") — tolerantere Regel, geringere Zuversicht.
 *
 * Kein Treffer heisst KEIN Rateversuch: ein nicht erkannter Beitrag liefert
 * `erkannt: false`, nie eine geratene Zahl — dieselbe Regel wie in
 * `coin-radar/bewertung.js`: unbekannte Daten werden nie als gut gewertet.
 *
 * Richtung: eine Bewegung AUF eine bekannte Börse zu gilt als potenzieller
 * Verkaufsdruck (der Coin wird handelbar gemacht), eine Bewegung VON einer
 * Börse WEG als potenzielle Verwahrung/Akkumulation. Bewegt sich keine Seite
 * auf eine bekannte Börse zu (Wallet-zu-Wallet, Mint, Burn), bleibt die
 * Richtung unbekannt statt geraten.
 */

const BOERSEN = [
    'binance', 'coinbase', 'kraken', 'bitfinex', 'okx', 'bybit', 'upbit',
    'huobi', 'htx', 'bitget', 'kucoin', 'gate.io', 'gateio', 'deribit',
    'gemini', 'bitstamp', 'bitmex', 'crypto.com', 'bitunix',
]

function nachBoerse(text) {
    const t = String(text || '').toLowerCase()
    return BOERSEN.some(b => t.includes(b))
}

/** "1,234.5", "12.3M", "$500K" → Zahl. Unlesbares wird null, nie 0. */
function parseZahl(s) {
    if (s === undefined || s === null) return null
    const m = String(s).trim().match(/^\$?([\d.,]+)\s*([kKmMbB])?$/)
    if (!m) return null
    const basis = Number(m[1].replace(/,/g, ''))
    if (!Number.isFinite(basis)) return null
    const einheit = { k: 1e3, m: 1e6, b: 1e9 }[m[2]?.toLowerCase()] || 1
    return basis * einheit
}

function richtungAus(von, nach) {
    const vonBoerse = nachBoerse(von)
    const nachBoerseWert = nachBoerse(nach)
    if (nachBoerseWert && !vonBoerse) return 'ein'
    if (vonBoerse && !nachBoerseWert) return 'aus'
    return 'unbekannt'
}

// Die "von"-Gruppe stoppt bewusst VOR " to " statt lazy zu enden: ein lazy
// Quantifier gefolgt von einer optionalen Gruppe nimmt sonst die kürzestmögliche
// Ausdehnung (oft ein einzelnes Zeichen) und lässt "to <Ziel>" unbenutzt liegen,
// weil der Regex-Motor die optionale Gruppe nie erzwingt.
const WHALE_ALERT_RE = /([\d.,]+)\s*#([A-Za-z0-9]{2,15})\s*\(\s*([\d.,]+)\s*USD\s*\)\s*(transferred|minted|burned)\b(?:\s+(?:at|from)\s+((?:(?!\sto\b)[^\n.])+))?(?:\s+to\s+([^\n.]+))?/i

// Betrag/Symbol/USD, Richtungsverb und Gegenpartei getrennt statt in einem
// Regex: Lookonchain schreibt "A whale withdrew <Menge> $<SYMBOL> (<USD>) from
// <Börse>" — das Verb steht VOR dem Betrag, anders als bei Whale Alert. Ein
// einzelner Regex, der eine feste Reihenfolge annimmt, würde genau diesen
// (häufigsten) Satzbau verfehlen.
const BETRAG_SYMBOL_RE = /([\d.,]+)\s*\$([A-Za-z0-9]{2,15})\s*\(\s*\$?([\d.,]+\s*[kKmMbB]?)\s*\)/
const VERB_RE = /\b(withdrew|deposited|bought|sold|transferred)\b/i
const GEGENPARTEI_RE = /\b(?:from|to)\s+([^\n.,]+)/i

/**
 * @param {string} text  Roher Beitragstext (`news_items.inhalt`)
 * @returns {{erkannt:false}|{erkannt:true,betrag:number,symbol:string,usdWert:number,richtung:'ein'|'aus'|'unbekannt',gegenpartei:string|null,zuversicht:'hoch'|'mittel'}}
 */
export function parseWalBeitrag(text) {
    const t = String(text || '')

    const wa = t.match(WHALE_ALERT_RE)
    if (wa) {
        const betrag = parseZahl(wa[1])
        const usdWert = parseZahl(wa[3])
        if (betrag && usdWert) {
            const von = wa[5] || ''
            const nach = wa[6] || ''
            return {
                erkannt: true,
                betrag,
                symbol: wa[2].toUpperCase(),
                usdWert,
                richtung: wa[4].toLowerCase() === 'transferred' ? richtungAus(von, nach) : 'unbekannt',
                gegenpartei: [von, nach].filter(Boolean).join(' → ') || null,
                zuversicht: 'hoch',
            }
        }
    }

    const bs = t.match(BETRAG_SYMBOL_RE)
    if (bs) {
        const betrag = parseZahl(bs[1])
        const usdWert = parseZahl(bs[3])
        if (betrag && usdWert) {
            const verb = t.match(VERB_RE)?.[1]?.toLowerCase() || null
            const gegenpartei = t.match(GEGENPARTEI_RE)?.[1]?.trim() || null
            let richtung = 'unbekannt'
            if (verb === 'withdrew') richtung = nachBoerse(gegenpartei) ? 'aus' : 'unbekannt'
            else if (verb === 'deposited') richtung = nachBoerse(gegenpartei) ? 'ein' : 'unbekannt'
            return {
                erkannt: true,
                betrag,
                symbol: bs[2].toUpperCase(),
                usdWert,
                richtung,
                gegenpartei,
                zuversicht: 'mittel',
            }
        }
    }

    return { erkannt: false }
}
