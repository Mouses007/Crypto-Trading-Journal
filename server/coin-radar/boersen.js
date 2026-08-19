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

/**
 * Ausführungsgüte vieler Symbole auf allen Börsen — gebremst.
 *
 * Das ist der teure Teil: ein Orderbuch je Symbol UND Börse. Bei achtzig
 * Überlebenden und zwei Börsen sind das hundertsechzig Abrufe, und genau
 * deshalb passiert er erst NACH den Hürden — dieselbe Trichter-Logik, die den
 * Kerzenabruf billig hält.
 *
 * In Häppchen mit kurzer Pause statt alles parallel: Die öffentlichen
 * Orderbuch-Endpunkte nennen keine harte Grenze, und hundertsechzig Anfragen
 * in einer Sekunde sind der zuverlässigste Weg, eine kennenzulernen.
 *
 * @param {string[]} symbole
 * @param {function} melde  Fortschritt
 * @returns {Promise<Map<string, object>>} Symbol → { jeBoerse, beste }
 */
export async function holeAusfuehrungGebremst(symbole, melde = () => {}) {
    const { ausfuehrungsGuete, noteAusfuehrung } = await import('./ausfuehrung.js')
    const raus = new Map()
    const HAEPPCHEN = 4
    const PAUSE_MS = 120

    for (let i = 0; i < symbole.length; i += HAEPPCHEN) {
        const teil = symbole.slice(i, i + HAEPPCHEN)
        await Promise.all(teil.map(async (symbol) => {
            const jeBoerse = {}
            for (const [name, b] of Object.entries(BOERSEN)) {
                try {
                    const g = ausfuehrungsGuete(await b.holeTiefe(symbol))
                    if (!g) continue
                    jeBoerse[name] = {
                        spreadBp: g.spreadBp,
                        rundlaufBp: g.rundlaufBp,
                        slippageKaufBp: g.kauf[5000]?.slippageBp ?? null,
                        slippageVerkaufBp: g.verkauf[5000]?.slippageBp ?? null,
                        passt5k: Boolean(g.kauf[5000]?.vollstaendig && g.verkauf[5000]?.vollstaendig),
                        tiefe25Bp: g.tiefe[25],
                        note: noteAusfuehrung(g),
                    }
                } catch (e) {
                    // Ein Symbol, das eine Börse nicht führt, ist kein Fehler —
                    // es ist die Antwort „hier nicht handelbar".
                    logWarn('coin-radar', `Buch ${name}/${symbol}: ${e.message}`)
                }
            }
            if (Object.keys(jeBoerse).length) raus.set(symbol, { jeBoerse, beste: besteBoerse(jeBoerse) })
        }))
        melde({ fertig: Math.min(i + HAEPPCHEN, symbole.length), gesamt: symbole.length })
        if (i + HAEPPCHEN < symbole.length) await new Promise((r) => setTimeout(r, PAUSE_MS))
    }
    return raus
}

/**
 * Wo eine Order über 5 000 USD am günstigsten ausgeführt wird.
 *
 * Entscheidend ist der RUNDLAUF, nicht der Spread: Ein Buch, das den Einstieg
 * billig und den Ausstieg teuer macht, sieht am Spread gut aus und ist es
 * nicht. Börsen, in deren Buch der Betrag gar nicht passt, kommen nicht in
 * Frage — dort gibt es keine Ausführung, nicht bloss eine teure.
 */
export function besteBoerse(jeBoerse = {}) {
    const kandidaten = Object.entries(jeBoerse)
        .filter(([, v]) => v.passt5k && Number.isFinite(v.rundlaufBp))
    if (!kandidaten.length) return null
    const [name, wert] = kandidaten.reduce((a, b) => (b[1].rundlaufBp < a[1].rundlaufBp ? b : a))
    return { boerse: name, rundlaufBp: wert.rundlaufBp, note: wert.note }
}
