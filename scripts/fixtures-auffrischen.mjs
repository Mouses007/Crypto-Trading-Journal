/**
 * Fixtures auffrischen — und melden, was sich geändert hat.
 *
 *   node scripts/fixtures-auffrischen.mjs          nur vergleichen
 *   node scripts/fixtures-auffrischen.mjs --schreiben   auch überschreiben
 *
 * Der Datenvertrags-Test läuft gegen gespeicherte Antworten und ist damit
 * schnell und reproduzierbar — aber er merkt naturgemäss nichts davon, wenn
 * ein Anbieter sein Schema ändert. Diese Datei schliesst die Lücke: Sie holt
 * die Antworten frisch und nennt Felder, die VERSCHWUNDEN oder NEU sind.
 *
 * Verschwundene Felder sind der eigentliche Zweck. Genau so ist die
 * GoPlus-Lücke entstanden — `lp_holders` fehlt in der Solana-Antwort, und
 * niemand hat es gemerkt, weil die Rechnung darüber nie geklagt hat.
 *
 * Bewusst KEIN Teil von `npm run test:self`: Der Testlauf muss ohne Netz
 * funktionieren, und ein Anbieter, der gerade klemmt, darf nicht die Suite rot
 * färben.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ordner = path.join(wurzel, 'server', 'fixtures')
const schreiben = process.argv.includes('--schreiben')

/** Dieselben Antworten wie beim ersten Einfangen — Reihenfolge egal. */
const QUELLEN = [
    ['dexscreener-tokens', 'https://api.dexscreener.com/latest/dex/tokens/0x6982508145454ce325ddbe47a25d4ec3d2311933',
        (j) => ({ pairs: (j.pairs || []).slice(0, 3) })],
    ['dexscreener-boosts', 'https://api.dexscreener.com/token-boosts/top/v1',
        (j) => (Array.isArray(j) ? j.slice(0, 3) : j)],
    ['geckoterminal-pools', 'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?include=base_token',
        (j) => ({ data: (j.data || []).slice(0, 3), included: (j.included || []).slice(0, 3) })],
    ['coingecko-trending', 'https://api.coingecko.com/api/v3/search/trending',
        (j) => ({ coins: (j.coins || []).slice(0, 3) })],
    ['goplus-evm', 'https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=0x6982508145454ce325ddbe47a25d4ec3d2311933', null],
    ['goplus-solana', 'https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=LFEJTxJ9yi6ojGDFpjbGfABLbH55Fc3oEK8syJJpump', null],
    ['rugcheck', 'https://api.rugcheck.xyz/v1/tokens/LFEJTxJ9yi6ojGDFpjbGfABLbH55Fc3oEK8syJJpump/report',
        (j) => ({ rugged: j.rugged, token: j.token, totalHolders: j.totalHolders, topHolders: (j.topHolders || []).slice(0, 3), markets: (j.markets || []).slice(0, 1) })],
    ['binance-24hr', 'https://fapi.binance.com/fapi/v1/ticker/24hr', (j) => j.slice(0, 2)],
    ['binance-bookticker', 'https://fapi.binance.com/fapi/v1/ticker/bookTicker', (j) => j.slice(0, 2)],
    ['binance-premiumindex', 'https://fapi.binance.com/fapi/v1/premiumIndex', (j) => j.slice(0, 2)],
    ['binance-fundinginfo', 'https://fapi.binance.com/fapi/v1/fundingInfo', (j) => j.slice(0, 2)],
    ['bitunix-tickers', 'https://fapi.bitunix.com/api/v1/futures/market/tickers', (j) => ({ data: (j.data || []).slice(0, 2) })],
    ['bitunix-depth', 'https://fapi.bitunix.com/api/v1/futures/market/depth?symbol=BTCUSDT&limit=5', null],
    ['bitget-tickers', 'https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES', (j) => ({ data: (j.data || []).slice(0, 2) })],
    ['bitget-depth', 'https://api.bitget.com/api/v2/mix/market/merge-depth?symbol=BTCUSDT&productType=USDT-FUTURES&limit=5', null],
]

/**
 * Alle Feldpfade eines Objekts, Listen auf das erste Element reduziert.
 * Es geht um die FORM, nicht um die Werte — ein anderer Preis ist keine
 * Schemaänderung.
 */
function pfade(o, praefix = '', raus = new Set(), tiefe = 0) {
    if (tiefe > 6 || o === null || typeof o !== 'object') return raus
    if (Array.isArray(o)) {
        if (o.length) pfade(o[0], `${praefix}[]`, raus, tiefe + 1)
        return raus
    }
    for (const [k, v] of Object.entries(o)) {
        const pfad = praefix ? `${praefix}.${k}` : k
        raus.add(pfad)
        pfade(v, pfad, raus, tiefe + 1)
    }
    return raus
}

const gruen = (s) => `\x1b[32m${s}\x1b[0m`
const rot = (s) => `\x1b[31m${s}\x1b[0m`
const gelb = (s) => `\x1b[33m${s}\x1b[0m`

let verschwunden = 0
console.log(`\nFixtures ${schreiben ? 'auffrischen' : 'vergleichen'} — ${QUELLEN.length} Quellen\n`)

for (const [name, url, kuerzen] of QUELLEN) {
    const datei = path.join(ordner, `${name}.json`)
    let frisch
    try {
        const antwort = await fetch(url)
        const j = await antwort.json()
        frisch = kuerzen ? kuerzen(j) : j
    } catch (e) {
        console.log(`  ${gelb('?')} ${name} — nicht erreichbar: ${e.message}`)
        continue
    }

    if (!existsSync(datei)) {
        if (schreiben) writeFileSync(datei, JSON.stringify(frisch, null, 1))
        console.log(`  ${gelb('+')} ${name} — neu${schreiben ? ' angelegt' : ''}`)
        continue
    }

    const alt = pfade(JSON.parse(readFileSync(datei, 'utf8')))
    const neu = pfade(frisch)
    const weg = [...alt].filter((f) => !neu.has(f))
    const dazu = [...neu].filter((f) => !alt.has(f))

    if (!weg.length && !dazu.length) {
        console.log(`  ${gruen('✓')} ${name}`)
    } else {
        if (weg.length) {
            verschwunden += weg.length
            console.log(`  ${rot('✗')} ${name} — ${weg.length} Feld(er) VERSCHWUNDEN: ${weg.slice(0, 8).join(', ')}`)
        }
        if (dazu.length) {
            console.log(`  ${gelb('+')} ${name} — ${dazu.length} neu: ${dazu.slice(0, 8).join(', ')}`)
        }
    }
    if (schreiben) writeFileSync(datei, JSON.stringify(frisch, null, 1))
}

console.log()
if (verschwunden) {
    console.log(rot(`${verschwunden} Feld(er) sind verschwunden — bitte prüfen, ob der Code sie liest.`))
    console.log('Danach `node server/__selftest-datenvertrag.mjs` laufen lassen.\n')
    process.exit(1)
}
console.log(gruen('Kein Feld verschwunden.\n'))
