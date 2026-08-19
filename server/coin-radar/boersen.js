/**
 * Coin-Radar: die Börsen, auf denen wirklich gehandelt wird.
 *
 * Bis zum Audit vom 19.08.2026 mass der Coin-Radar ausschliesslich Binance und
 * filterte das Ergebnis auf das, was Bitunix führt. Das beantwortete „auf
 * Binance aktiv und auf Bitunix gelistet" — nicht „hier gut ausführbar". Für
 * eine Seite, die „welchen Coin nehme ich heute" heissen soll, ist das die
 * falsche Frage.
 *
 * Jede Börse bekommt denselben Zuschnitt:
 *
 *   `holeTicker()`        ein Sammelabruf für ALLE Symbole — Preis, Umsatz und,
 *                         wo vorhanden, Spread und Funding
 *   `holeTiefe(symbol)`   das Orderbuch EINES Symbols, nur für Überlebende
 *
 * Die Trennung ist der ganze Entwurf: Der Sammelabruf kostet einen Aufruf für
 * fünfhundert Coins, das Orderbuch einen je Coin. Genau diese Reihenfolge hält
 * den Lauf bei einer halben Minute statt bei zwanzig.
 *
 * ⚠ PIONEX FEHLT — und das ist kein Versäumnis, sondern ein Messergebnis.
 * `/api/v1/common/symbols` liefert 405 Märkte, davon 405 SPOT und NULL
 * Perpetuals (geprüft am 19.08.2026). Der Coin-Radar rankt Perpetuals; auf
 * Pionex gibt es dafür nichts zu messen. Die Börse bleibt deshalb das, was sie
 * im Hype-Radar schon ist: ein Listungs-Hinweis. Sollte Pionex Perps einführen,
 * ist hier ein Adapter nach demselben Muster zu ergänzen.
 */

import { holeJson as radarJson } from '../marktradar-api.js'
import { logWarn } from '../logger.js'

const BITUNIX = 'https://fapi.bitunix.com'
const BITGET = 'https://api.bitget.com'

/**
 * Wie viele Orderbuch-Ebenen geholt werden.
 *
 * Bitunix nimmt ausdrücklich nur 1, 5, 15, 50 oder `max` — 100 wird mit einer
 * Fehlermeldung abgewiesen (gemessen). `max` liefert knapp fünfzehntausend
 * Ebenen und ist für unsere Frage masslos; fünfzig reichen weit über jede
 * Ordergrösse hinaus, die dieses Journal handelt.
 */
const EBENEN = 50

/** Zahl aus einem Feld, das auch als Zeichenkette kommt. */
const z = (w) => {
    const n = Number(w)
    return Number.isFinite(n) ? n : null
}

/**
 * Ein Orderbuch in einheitlicher Form.
 * @returns {{bids: Array<[number,number]>, asks: Array<[number,number]>}}
 */
function buch(bids, asks) {
    const seite = (arr) => (Array.isArray(arr) ? arr : [])
        .map((e) => [Number(e?.[0] ?? e?.price), Number(e?.[1] ?? e?.size)])
        .filter(([p, m]) => Number.isFinite(p) && Number.isFinite(m) && p > 0 && m > 0)
    return { bids: seite(bids), asks: seite(asks) }
}

// ── Bitunix ─────────────────────────────────────────────────────────────
/*
 * Die Ausführungsbörse dieses Journals — und ausgerechnet sie liefert am
 * wenigsten: Der Ticker nennt Preis, Hoch, Tief und Umsatz, aber KEINE Bid/Ask.
 * Spread und Tiefe müssen deshalb aus dem Orderbuch kommen, eines je Symbol.
 * Das ist der Grund, warum der Trichter hier wichtiger ist als anderswo.
 */
export const bitunix = {
    id: 'bitunix',
    async holeTicker() {
        const j = await radarJson(`${BITUNIX}/api/v1/futures/market/tickers`)
        const raus = new Map()
        for (const t of (j?.data || [])) {
            if (!t?.symbol) continue
            raus.set(t.symbol, {
                symbol: t.symbol,
                preis: z(t.lastPrice) ?? z(t.markPrice),
                umsatz24h: z(t.quoteVol) ?? 0,
                // Bitunix nennt keine Quotes im Ticker — der Spread entsteht
                // erst aus dem Orderbuch. `null` heisst hier „noch nicht
                // gemessen", nicht „null".
                spreadBp: null, tiefeUsd: null,
                fundingRate: null, fundingIntervallH: null,
            })
        }
        return raus
    },
    async holeTiefe(symbol) {
        const j = await radarJson(`${BITUNIX}/api/v1/futures/market/depth?symbol=${encodeURIComponent(symbol)}&limit=${EBENEN}`)
        return buch(j?.data?.bids, j?.data?.asks)
    },
}

// ── Bitget ──────────────────────────────────────────────────────────────
/*
 * Der Gegenpol: Ein einziger Abruf liefert Bid, Ask, deren Mengen, das Funding
 * und das offene Interesse für alle 756 Perps. Damit lässt sich fast alles
 * ohne Orderbuch entscheiden — das Buch braucht es nur noch für die Slippage.
 */
export const bitget = {
    id: 'bitget',
    async holeTicker() {
        const j = await radarJson(`${BITGET}/api/v2/mix/market/tickers?productType=USDT-FUTURES`)
        const raus = new Map()
        for (const t of (j?.data || [])) {
            if (!t?.symbol) continue
            const bid = z(t.bidPr)
            const ask = z(t.askPr)
            const mitte = bid > 0 && ask > 0 ? (bid + ask) / 2 : null
            raus.set(t.symbol, {
                symbol: t.symbol,
                preis: z(t.lastPr) ?? mitte,
                umsatz24h: z(t.usdtVolume) ?? z(t.quoteVolume) ?? 0,
                spreadBp: mitte ? ((ask - bid) / mitte) * 10000 : null,
                tiefeUsd: mitte ? Math.min(z(t.bidSz) || 0, z(t.askSz) || 0) * mitte : null,
                // Bitget meldet die Rate als Dezimalbruch wie Binance.
                fundingRate: z(t.fundingRate) !== null ? z(t.fundingRate) * 100 : null,
                fundingIntervallH: null,     // nicht im Ticker; siehe Hinweis unten
                offenesInteresse: z(t.holdingAmount),
            })
        }
        return raus
    },
    async holeTiefe(symbol) {
        const j = await radarJson(
            `${BITGET}/api/v2/mix/market/merge-depth?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&limit=${EBENEN}`)
        return buch(j?.data?.bids, j?.data?.asks)
    },
}

export const BOERSEN = { bitunix, bitget }

/**
 * Ticker aller Börsen, jede einzeln aufgefangen.
 *
 * Eine Börse, die klemmt, darf die anderen nicht mitnehmen — dieselbe Linie
 * wie bei den Quellen des Hype-Radars. Was fehlt, steht in `stand` und ist
 * später nachvollziehbar, statt still zu einer kürzeren Liste zu führen.
 *
 * @returns {Promise<{jeBoerse: Object<string, Map>, stand: object}>}
 */
export async function holeAlleTicker(namen = Object.keys(BOERSEN)) {
    const ergebnisse = await Promise.allSettled(
        namen.map((n) => BOERSEN[n].holeTicker()))

    const jeBoerse = {}
    const stand = {}
    ergebnisse.forEach((e, i) => {
        const name = namen[i]
        if (e.status === 'fulfilled') {
            jeBoerse[name] = e.value
            stand[name] = { ok: true, anzahl: e.value.size }
        } else {
            jeBoerse[name] = new Map()
            stand[name] = { ok: false, fehler: String(e.reason?.message || e.reason).slice(0, 200) }
            logWarn('coin-radar', `Börse ${name} ausgefallen: ${stand[name].fehler}`)
        }
    })
    return { jeBoerse, stand }
}
