/**
 * Wartungsmargen (Maintenance Margin Rate) je Symbol.
 *
 * Die Liquidationskarte rechnet ihre Zonen aus dieser Rate. Bisher war sie eine
 * einzige, von Hand gepflegte Zahl für ALLE Coins — voreingestellt auf 0,004,
 * die Stufe 1 von BTCUSDT. Das stimmt für acht von rund tausend Binance-
 * Symbolen; der Rest liegt bei 0,01 bis 0,05. Mit der Vorgabe lagen dort alle
 * Zonen um ein Vielfaches zu nah am Kurs.
 *
 * Zwei Quellen, bewusst nicht vermischt:
 *
 *  - Binance liefert die echte Tabelle über sein Web-Backend, ohne Schlüssel.
 *    Der dokumentierte `/fapi/v1/leverageBracket` ist signiert, dieser hier
 *    nicht. Dafür ist er auch nicht zugesichert — er kann sich ohne Ankündigung
 *    ändern. Gleiche Wette wie beim Dominanz-Import aus dem CMC-Web-Endpunkt,
 *    und dieselbe Absicherung: cachen, und bei einem Ausfall lieber den alten
 *    Stand ausliefern als gar keinen.
 *  - Bybit veröffentlicht dasselbe als reguläre, dokumentierte v5-API.
 *
 * Die Werte sind NICHT austauschbar: BTCUSDT steht bei Binance auf 0,004 und
 * bei Bybit auf 0,005, 1000PEPEUSDT auf 0,0065 gegen 0,01. Auch die Stufen-
 * grenzen unterscheiden sich (BTC-Stufe 1 endet bei 300k bzw. 2 Mio). Deshalb
 * wird hier nichts gemittelt — ein Mittelwert wäre eine Rate, die an keiner der
 * beiden Börsen gilt. Gewählt wird eine Quelle; die andere ist nur der Ersatz,
 * wenn die erste schweigt, und das steht dann auch in der Antwort.
 */

import axios from 'axios'
import { logWarn } from './logger.js'

const HTTP_TIMEOUT = 12000
/** Klammern ändern sich in Wochen, nicht in Stunden. */
const CACHE_MS = 24 * 60 * 60 * 1000
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/

const BINANCE_URL = 'https://www.binance.com/bapi/futures/v1/friendly/future/common/brackets'
const BYBIT_URL = 'https://api.bybit.com/v5/market/risk-limit'

/** Was gilt, wenn beide Börsen schweigen — die alte, feste Vorgabe. */
export const MMR_VORGABE = 0.004

/**
 * Stufe 1 aus einer Binance-Klammertabelle ziehen.
 *
 * Genommen wird die Klammer mit Untergrenze 0, nicht `bracketSeq === 1`: die
 * Nummer ist eine Anzeigereihenfolge, die Untergrenze ist die Aussage.
 */
export function parseBinanceKlammern(rohdaten) {
    const tabelle = new Map()
    for (const eintrag of rohdaten?.data?.brackets || []) {
        const stufen = eintrag.riskBrackets || []
        const erste = stufen.find(s => Number(s.bracketNotionalFloor) === 0)
        const mmr = Number(erste?.bracketMaintenanceMarginRate)
        if (!(mmr > 0)) continue
        tabelle.set(String(eintrag.symbol).toUpperCase(), {
            mmr,
            obergrenze: Number(erste.bracketNotionalCap) || 0,
            maxHebel: Number(erste.maxOpenPosLeverage) || 0,
            stufen: stufen.length,
        })
    }
    return tabelle
}

/**
 * Stufe 1 aus einer Bybit-Risikolimit-Liste ziehen.
 *
 * `isLowestRisk` markiert sie; fehlt die Markierung, gilt die kleinste
 * Obergrenze. Bybit sortiert zwar aufsteigend, aber darauf verlässt sich diese
 * Funktion nicht — ein stillschweigend anders sortierter Tag wäre sonst eine
 * viel zu hohe Rate und damit Zonen weit weg vom Kurs.
 */
export function parseBybitRisikolimit(rohdaten) {
    const liste = rohdaten?.result?.list || []
    if (!liste.length) return null
    const erste = liste.find(s => Number(s.isLowestRisk) === 1)
        || [...liste].sort((a, b) => Number(a.riskLimitValue) - Number(b.riskLimitValue))[0]
    const mmr = Number(erste?.maintenanceMargin)
    if (!(mmr > 0)) return null
    return {
        mmr,
        obergrenze: Number(erste.riskLimitValue) || 0,
        maxHebel: Number(erste.maxLeverage) || 0,
        stufen: liste.length,
    }
}

// ── Binance: eine Tabelle für alle Symbole ──────────────────────────────
// 1,6 MB je Abruf, deshalb genau einer pro Tag und nicht einer pro Symbol.
let binanceCache = null       // { ts, tabelle }
let binanceLaeuft = null      // laufender Abruf, gegen den Ansturm beim Start

async function holeBinanceTabelle() {
    const frisch = binanceCache && (Date.now() - binanceCache.ts) < CACHE_MS
    if (frisch) return binanceCache
    if (binanceLaeuft) return binanceLaeuft

    binanceLaeuft = (async () => {
        try {
            const { data } = await axios.get(BINANCE_URL, { timeout: HTTP_TIMEOUT })
            const tabelle = parseBinanceKlammern(data)
            if (!tabelle.size) throw new Error('leere Klammertabelle')
            binanceCache = { ts: Date.now(), tabelle }
            console.log(` -> Binance Hebelklammern: ${tabelle.size} Symbole gecacht`)
            return binanceCache
        } catch (fehler) {
            logWarn('margin-rates', `Binance-Klammern nicht abrufbar: ${fehler.message}`)
            // Alter Stand ist besser als keiner: die Klammern stehen wochenlang
            // still, ein Tag Verspätung ändert an der Karte nichts.
            if (binanceCache) return { ...binanceCache, veraltet: true }
            return null
        } finally {
            binanceLaeuft = null
        }
    })()
    return binanceLaeuft
}

async function ausBinance(symbol) {
    const stand = await holeBinanceTabelle()
    const treffer = stand?.tabelle.get(symbol)
    if (!treffer) return null
    return { ...treffer, quelle: 'binance', veraltet: !!stand.veraltet }
}

// ── Bybit: je Symbol ein Abruf ──────────────────────────────────────────
// Die Sammelabfrage blättert in Seiten zu 15 Symbolen — für ein einzelnes
// Symbol wären das bis zu siebzig Anfragen statt einer.
const bybitCache = new Map()  // symbol -> { ts, wert }

async function ausBybit(symbol) {
    const gecacht = bybitCache.get(symbol)
    if (gecacht && (Date.now() - gecacht.ts) < CACHE_MS) {
        return gecacht.wert ? { ...gecacht.wert, quelle: 'bybit', veraltet: false } : null
    }
    try {
        const { data } = await axios.get(BYBIT_URL, {
            params: { category: 'linear', symbol },
            timeout: HTTP_TIMEOUT,
        })
        const wert = parseBybitRisikolimit(data)
        bybitCache.set(symbol, { ts: Date.now(), wert })
        return wert ? { ...wert, quelle: 'bybit', veraltet: false } : null
    } catch (fehler) {
        logWarn('margin-rates', `Bybit-Risikolimit ${symbol} nicht abrufbar: ${fehler.message}`)
        if (gecacht?.wert) return { ...gecacht.wert, quelle: 'bybit', veraltet: true }
        return null
    }
}

/**
 * Rate für ein Symbol besorgen. `quelle` ist der Wunsch, nicht das Ergebnis:
 * antwortet die gewünschte Börse nicht oder kennt sie das Symbol nicht, wird
 * die andere gefragt und das Ergebnis als `ersatz` gekennzeichnet. Die Karte
 * soll nicht stehenbleiben, aber sie soll auch nicht so tun, als käme die Zahl
 * von der Börse, auf die man gerade schaut.
 */
export async function holeMarginRate(symbol, quelle = 'binance') {
    const gross = String(symbol || '').toUpperCase()
    if (!SYMBOL_RE.test(gross)) return null

    const reihenfolge = quelle === 'bybit' ? ['bybit', 'binance'] : ['binance', 'bybit']
    for (const [index, q] of reihenfolge.entries()) {
        const treffer = q === 'bybit' ? await ausBybit(gross) : await ausBinance(gross)
        if (treffer) return { symbol: gross, gewuenscht: quelle, ersatz: index > 0, ...treffer }
    }
    return null
}

/**
 * Wartungsmarge in PROZENT für Backtest und Paper-Handel.
 *
 * `override` (aus `risk.maintenanceMarginPct`) schlägt alles: wer bewusst eine
 * Zahl einträgt, bekommt sie. Sonst die echte Stufe-1-Rate der Börse, und erst
 * wenn beide Börsen schweigen, die Vorgabe. Vor dem Audit vom 19.08.2026 stand
 * hier pauschal 0,5 % für jedes Symbol — bei einem Alt-Coin mit 1 % liess der
 * Backtest die Position rund 50 % weiter laufen als die Börse.
 *
 * Prozent, nicht Bruch: die Schnittstelle zum Simulator rechnet in Prozent
 * (siehe Einheiten-Kanon in `shared/liquidation.js`).
 */
export async function wartungsmargePctFuer(symbol, override = 0) {
    const eigen = Number(override)
    if (Number.isFinite(eigen) && eigen > 0) return eigen
    try {
        const treffer = await holeMarginRate(symbol)
        if (treffer?.mmr > 0) return treffer.mmr * 100
    } catch (fehler) {
        logWarn('margin-rates', `Wartungsmarge ${symbol} nicht abrufbar: ${fehler.message}`)
    }
    return MMR_VORGABE * 100
}

export function setupMarginRateRoutes(app) {
    /**
     * GET /api/margin-rate
     * Query: symbol (required), quelle ('binance' | 'bybit', default binance)
     *
     * Antwort: { symbol, mmr, quelle, gewuenscht, ersatz, veraltet,
     *            obergrenze, maxHebel, stufen }
     * `obergrenze` ist das Nominalvolumen, bis zu dem Stufe 1 gilt — darüber
     * steigt die Rate. Die Karte kennt keine Positionsgrössen und rechnet
     * deshalb durchgängig mit Stufe 1; der Wert steht in der Antwort, damit die
     * Oberfläche sagen kann, ab wann die Annahme nicht mehr trägt.
     */
    app.get('/api/margin-rate', async (req, res) => {
        const symbol = String(req.query.symbol || '').toUpperCase()
        if (!SYMBOL_RE.test(symbol)) {
            return res.status(400).json({ error: 'symbol fehlt oder ist ungültig' })
        }
        const quelle = req.query.quelle === 'bybit' ? 'bybit' : 'binance'

        const treffer = await holeMarginRate(symbol, quelle)
        if (!treffer) {
            return res.status(404).json({ error: `Keine Wartungsmarge für ${symbol} gefunden`, vorgabe: MMR_VORGABE })
        }
        res.setHeader('Cache-Control', 'private, max-age=3600')
        res.json(treffer)
    })
}
