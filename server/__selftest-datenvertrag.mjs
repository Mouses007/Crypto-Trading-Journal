/**
 * Selbsttest: der DATENVERTRAG mit den Fremdquellen.
 *
 * Alle anderen Selbsttests prüfen Mathematik. Genau deshalb blieb die
 * GoPlus-Lücke monatelang unentdeckt: `lp_holders` fehlt in der Solana-Antwort
 * schlicht, und kein Test hat je nachgesehen, ob das Feld überhaupt existiert.
 * Die Rechnung war korrekt — sie rechnete nur mit nichts.
 *
 * Dieser Test hält die andere Hälfte fest: WELCHE FELDER der Code voraussetzt.
 * Er läuft gegen eingefangene echte Antworten in `server/fixtures/`, also ohne
 * Netz und reproduzierbar. Ändert ein Anbieter sein Schema, fällt es beim
 * nächsten Auffrischen der Fixtures auf (`node scripts/fixtures-auffrischen.mjs`)
 * — nicht erst, wenn eine Rangliste still falsch wird.
 *
 * Aufruf: node server/__selftest-datenvertrag.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ausRugCheck, summeTop10 } from './hype-radar/sicherheit.js'
import { ausfuehrungsGuete } from './coin-radar/ausfuehrung.js'
import { normSymbol, normChain } from './hype-radar/quellen.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Datenvertrag mit den Fremdquellen')

const hier = path.dirname(fileURLToPath(import.meta.url))
const lade = (name) => {
    const datei = path.join(hier, 'fixtures', `${name}.json`)
    if (!existsSync(datei)) return null
    return JSON.parse(readFileSync(datei, 'utf8'))
}

/** Ein Feld muss da sein — und zwar mit brauchbarem Inhalt, nicht nur als Schlüssel. */
function verlange(quelle, objekt, pfad, pruef = (w) => w !== undefined && w !== null) {
    const teile = pfad.split('.')
    let w = objekt
    for (const t of teile) w = w?.[t]
    p(`${quelle}: ${pfad}`, pruef(w), `war ${JSON.stringify(w)?.slice(0, 60)}`)
}

const zahl = (w) => Number.isFinite(Number(w))
const liste = (w) => Array.isArray(w)

// ── DexScreener ─────────────────────────────────────────────────────────
{
    const j = lade('dexscreener-tokens')
    p('Fixture dexscreener-tokens vorhanden', Boolean(j))
    if (j) {
        const pa = j.pairs?.[0]
        for (const f of ['chainId', 'dexId', 'pairAddress', 'priceUsd',
            'baseToken.address', 'baseToken.symbol', 'quoteToken.address',
            'liquidity.usd', 'volume.h24', 'volume.h1', 'txns.h24.buys',
            'priceChange.h24', 'priceChange.h1', 'fdv', 'pairCreatedAt']) {
            verlange('dexscreener', pa, f)
        }
        // `boosts` und `info` sind optional — nicht jedes Paar hat sie, und
        // ein Test, der sie erzwingt, wäre beim nächsten Token rot.
        p('dexscreener: boosts ist Zahl oder fehlt',
            pa?.boosts === undefined || zahl(pa.boosts?.active))
    }
}
{
    const j = lade('dexscreener-boosts')
    if (j) {
        verlange('dexscreener-boosts', j[0], 'tokenAddress')
        verlange('dexscreener-boosts', j[0], 'chainId')
        verlange('dexscreener-boosts', j[0], 'totalAmount', zahl)
    }
}

// ── GeckoTerminal ───────────────────────────────────────────────────────
{
    const j = lade('geckoterminal-pools')
    p('Fixture geckoterminal vorhanden', Boolean(j))
    if (j) {
        const pool = j.data?.[0]
        verlange('geckoterminal', pool, 'attributes.name')
        verlange('geckoterminal', pool, 'attributes.address')
        verlange('geckoterminal', pool, 'attributes.reserve_in_usd')
        verlange('geckoterminal', pool, 'attributes.volume_usd.h24')
        verlange('geckoterminal', pool, 'attributes.pool_created_at')
        /*
         * DIE Beziehung, ohne die es keine Vertragsadresse gibt — und damit
         * weder Detailabruf noch Sicherheitsprüfung. Vor dem Audit entstand
         * das Symbol aus `poolName.split('/')[0]`, und jeder GeckoTerminal-Fund
         * landete zwangsläufig bei „ungeprüft".
         */
        verlange('geckoterminal', pool, 'relationships.base_token.data.id')
        const token = j.included?.find((t) => t.type === 'token')
        p('geckoterminal: included enthält Token', Boolean(token))
        verlange('geckoterminal', token, 'attributes.address')
        verlange('geckoterminal', token, 'attributes.symbol')
    }
}

// ── CoinGecko ───────────────────────────────────────────────────────────
{
    const j = lade('coingecko-trending')
    if (j) {
        verlange('coingecko', j.coins?.[0], 'item.symbol')
        verlange('coingecko', j.coins?.[0], 'item.name')
    }
}

// ── GoPlus ──────────────────────────────────────────────────────────────
{
    const j = lade('goplus-evm')
    p('Fixture goplus-evm vorhanden', Boolean(j))
    if (j) {
        const d = Object.values(j.result || {})[0]
        for (const f of ['is_honeypot', 'is_mintable', 'transfer_pausable',
            'owner_address', 'holder_count', 'cannot_buy', 'is_proxy']) {
            verlange('goplus-evm', d, f)
        }
        /*
         * `sell_tax` existiert, ist aber regelmässig LEER — und `Number('')`
         * ist 0. Genau daran hing der Fehler vom 20.08.2026: unbekannte
         * Verkaufssteuer galt als steuerfrei.
         */
        p('goplus-evm: sell_tax existiert (auch wenn leer)', 'sell_tax' in (d || {}))
        /*
         * `cannot_sell_all` gibt es in v1 NICHT — der Code las jahrelang ins
         * Leere. Festgehalten, damit ein Wiederauftauchen auffällt.
         */
        p('goplus-evm: cannot_sell_all fehlt weiterhin', d?.cannot_sell_all === undefined,
            `war ${JSON.stringify(d?.cannot_sell_all)}`)
        verlange('goplus-evm', d, 'holders', liste)
        verlange('goplus-evm', d, 'lp_holders', liste)
        /*
         * Die Merkmale je Halter — sie zu verlieren war R-09: Ohne `tag` und
         * `is_locked` zählten verbrannte und gesperrte Anteile als Ballung.
         */
        for (const f of ['percent', 'address', 'tag', 'is_locked', 'is_contract']) {
            verlange('goplus-evm', d?.holders?.[0], f, (w) => w !== undefined)
        }
    }
}
{
    const j = lade('goplus-solana')
    p('Fixture goplus-solana vorhanden', Boolean(j))
    if (j) {
        const d = Object.values(j.result || {})[0]
        verlange('goplus-solana', d, 'holders', liste)
        verlange('goplus-solana', d, 'mintable.status')
        /*
         * DER Befund, den kein Test je gesehen hat: Die Solana-Antwort kennt
         * `lp_holders` NICHT — das Feld ist EVM-Sprache. Deshalb wird die
         * Liquiditätssperre dort bei RugCheck nachgeschlagen. Diese Prüfung
         * hält den Zustand fest: Taucht das Feld eines Tages auf, ist der
         * Umweg überflüssig und soll auffallen.
         */
        p('goplus-solana: lp_holders fehlt weiterhin (deshalb RugCheck)',
            d?.lp_holders === undefined,
            `war ${JSON.stringify(d?.lp_holders)?.slice(0, 40)}`)
    }
}

// ── RugCheck ────────────────────────────────────────────────────────────
{
    const j = lade('rugcheck')
    p('Fixture rugcheck vorhanden', Boolean(j))
    if (j) {
        verlange('rugcheck', j, 'markets.0.lp.lpLockedPct', zahl)
        verlange('rugcheck', j, 'topHolders', liste)
        verlange('rugcheck', j, 'totalHolders', zahl)

        // Und die Übersetzung muss daraus GoPlus-Sprache machen.
        const u = ausRugCheck(j)
        p('rugcheck-Übersetzung liefert lp_holders', liste(u?.lp_holders) && u.lp_holders.length > 0)
        p('rugcheck-Übersetzung liefert Halter mit Anteil',
            liste(u?.holders) && u.holders.every((h) => zahl(h.percent)))
        p('und die Konzentration lässt sich daraus rechnen',
            summeTop10(u.holders) === null || zahl(summeTop10(u.holders)))
    }
}

// ── Binance ─────────────────────────────────────────────────────────────
{
    const t = lade('binance-24hr')
    if (t) {
        verlange('binance-24hr', t[0], 'symbol')
        verlange('binance-24hr', t[0], 'quoteVolume', zahl)
        verlange('binance-24hr', t[0], 'priceChangePercent', zahl)
    }
    const b = lade('binance-bookticker')
    if (b) {
        for (const f of ['symbol', 'bidPrice', 'askPrice', 'bidQty', 'askQty']) verlange('binance-book', b[0], f)
    }
    const pi = lade('binance-premiumindex')
    if (pi) {
        verlange('binance-premium', pi[0], 'lastFundingRate', zahl)
        verlange('binance-premium', pi[0], 'markPrice', zahl)
    }
    /*
     * Der Funding-TAKT. Ihn nicht zu lesen war R-13: 445 von 875 Symbolen
     * zahlen vierstündlich, und pauschal 8 h halbierte deren Jahresrate.
     */
    const fi = lade('binance-fundinginfo')
    if (fi) {
        verlange('binance-fundinginfo', fi[0], 'symbol')
        verlange('binance-fundinginfo', fi[0], 'fundingIntervalHours', zahl)
    }
}

// ── Bitunix und Bitget ──────────────────────────────────────────────────
{
    const t = lade('bitunix-tickers')
    if (t) {
        verlange('bitunix', t.data?.[0], 'symbol')
        verlange('bitunix', t.data?.[0], 'quoteVol', zahl)
        verlange('bitunix', t.data?.[0], 'lastPrice', zahl)
        // Festgehalten, weil daraus der ganze Aufbau folgt: Bitunix nennt im
        // Ticker KEINE Quotes — Spread und Tiefe kommen aus dem Orderbuch.
        p('bitunix: Ticker führt weiterhin keine Bid/Ask',
            t.data?.[0]?.bidPrice === undefined && t.data?.[0]?.askPrice === undefined)
    }
    const d = lade('bitunix-depth')
    if (d) {
        verlange('bitunix-depth', d, 'data.bids', liste)
        verlange('bitunix-depth', d, 'data.asks', liste)
        const g = ausfuehrungsGuete({ bids: d.data.bids, asks: d.data.asks })
        p('bitunix-Buch lässt sich auswerten', g !== null && zahl(g.spreadBp))
    }
    const bt = lade('bitget-tickers')
    if (bt) {
        for (const f of ['symbol', 'lastPr', 'askPr', 'bidPr', 'bidSz', 'askSz',
            'usdtVolume', 'fundingRate', 'holdingAmount']) {
            verlange('bitget', bt.data?.[0], f)
        }
    }
    const bd = lade('bitget-depth')
    if (bd) {
        const g = ausfuehrungsGuete({ bids: bd.data.bids, asks: bd.data.asks })
        p('bitget-Buch lässt sich auswerten', g !== null && zahl(g.spreadBp))
    }
}

// ── Vereinheitlichung ───────────────────────────────────────────────────
p('Kettennamen der Quellen sind bekannt',
    ['solana', 'eth', 'base', 'bsc', 'ethereum'].every((c) => normChain(c).length > 0))
p('Symbole werden vereinheitlicht', normSymbol('$pepe') === 'PEPE')

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
