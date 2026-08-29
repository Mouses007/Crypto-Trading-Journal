/**
 * Marktdaten für die Strategie-Engine.
 *
 * Zentrale Zusage dieses Moduls: **es gibt nur geschlossene Kerzen zurück.**
 * Die laufende Kerze wird immer verworfen. Ohne diese Regel würde ein Detector
 * auf einer Kerze anschlagen, die sich danach noch ändert (Repainting) — die
 * Signale wären weder reproduzierbar noch backtestbar.
 *
 * Zweite Zusage: Provider-Abstraktion. Der Detector kennt nur `getClosedCandles`;
 * ob die Kerzen von Binance-Futures oder später von Bitunix kommen, ist ihm egal.
 *
 * Kerzenformat (Zahlen, nicht Strings wie bei Binance):
 *   { t, o, h, l, c, v, closeTime }
 */

import axios from 'axios'
import { logWarn } from './logger.js'
import { notiereGewicht, melde429, warteAufGewicht, istWiederholbar, WIEDERHOLUNGEN } from './binance-takt.js'

const BASES = {
    spot: 'https://api.binance.com',
    futures: 'https://fapi.binance.com',
}
const KLINE_PATHS = {
    spot: '/api/v3/klines',
    futures: '/fapi/v1/klines',
}
const KLINE_LIMITS = { spot: 1000, futures: 1500 }

const HTTP_TIMEOUT = 10000

/** Von Binance unterstützte Intervalle → Länge in Millisekunden. */
export const TIMEFRAME_MS = {
    '1m': 60000,
    '3m': 180000,
    '5m': 300000,
    '15m': 900000,
    '30m': 1800000,
    '1h': 3600000,
    '2h': 7200000,
    '4h': 14400000,
    '6h': 21600000,
    '8h': 28800000,
    '12h': 43200000,
    '1d': 86400000,
    '3d': 259200000,
    '1w': 604800000,
}

export function timeframeMs(tf) {
    return TIMEFRAME_MS[tf] || 0
}

export function isValidTimeframe(tf) {
    return Boolean(TIMEFRAME_MS[tf])
}

/**
 * Beginn der aktuell laufenden Kerze. Alles davor ist abgeschlossen.
 * (Gilt für alle Intervalle bis 1d, weil Binance-Buckets auf UTC-Epoch rasten.)
 */
export function currentCandleOpen(tf, now = Date.now()) {
    const ms = timeframeMs(tf)
    if (!ms) return 0
    // Binance-Wochenkerzen beginnen Montag 00:00 UTC. Der Unix-Epoch war ein
    // DONNERSTAG — ohne Versatz gälte die laufende Wochenkerze ab Donnerstag
    // als geschlossen, und Wochenregeln handelten auf einem repaintenden Wert.
    if (tf === '1w') {
        const MONTAG = 345600000   // Mo, 5. Jan 1970 00:00 UTC
        return Math.floor((now - MONTAG) / ms) * ms + MONTAG
    }
    return Math.floor(now / ms) * ms
}

// ── Cache ────────────────────────────────────────────────────────────────
// Ein Eintrag je symbol|market|interval. Die TTL ist bewusst an die
// Kerzenlänge gekoppelt: innerhalb einer laufenden Kerze kann sich am Satz
// geschlossener Kerzen nichts ändern, also ist ein erneuter Abruf sinnlos.
const cache = new Map()      // key -> { candles, fetchedAt, lastOpen }
const inFlight = new Map()   // key -> Promise (Dedup paralleler Abrufe)

const cacheKey = (symbol, interval, market) => `${symbol}|${market}|${interval}`


/** Rohe Binance-Zeilen → Zahlen-Kerzen. */
function normalizeKlines(rows) {
    const out = []
    for (const k of rows) {
        const t = Number(k[0])
        const o = Number(k[1])
        const h = Number(k[2])
        const l = Number(k[3])
        const c = Number(k[4])
        // Defekte Zeilen lieber überspringen als NaN in den Detector lassen
        if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) ||
            !Number.isFinite(l) || !Number.isFinite(c)) continue
        out.push({ t, o, h, l, c, v: Number(k[5]) || 0, closeTime: Number(k[6]) || 0 })
    }
    return out
}

async function fetchKlines({ symbol, interval, market, limit, startTime, endTime }) {
    const params = { symbol, interval, limit: Math.min(limit, KLINE_LIMITS[market]) }
    if (startTime !== undefined && endTime !== undefined) {
        params.startTime = startTime
        params.endTime = endTime
    }
    try {
        const antwort = await axios.get(`${BASES[market]}${KLINE_PATHS[market]}`, {
            params, timeout: HTTP_TIMEOUT,
        })
        // Binance meldet den Verbrauch der GANZEN IP im Antwortkopf. Auch die
        // Abrufe des Livebetriebs zahlen darauf ein — deshalb wird hier
        // notiert, nicht erst im gebremsten Historienpfad. Ohne diese Zeile
        // kennt die Bremse nur ihren eigenen Anteil und lässt zu viel durch.
        notiereGewicht(antwort.headers)
        return normalizeKlines(Array.isArray(antwort.data) ? antwort.data : [])
    } catch (e) {
        const status = e?.response?.status
        // 429 (zu schnell) und 418 (gesperrt) betreffen die ganze IP, nicht nur
        // diesen Abruf. Die Bremse muss davon erfahren, sonst rennt der nächste
        // Historienlauf ungebremst in dieselbe Wand.
        if (status === 429 || status === 418) melde429(status, e.response.headers)
        throw e
    }
}

/**
 * Prüft, ob die Kerzenreihe lückenlos ist. Lücken entstehen bei Börsen-
 * Ausfällen oder illiquiden Symbolen und würden Swing-/Sweep-Erkennung
 * verfälschen (zwei Kerzen wären dann nicht mehr benachbart).
 *
 * @returns {{ ok: boolean, gaps: Array<{after: number, missing: number}> }}
 */
export function checkGaps(candles, interval) {
    const step = timeframeMs(interval)
    const gaps = []
    if (!step || candles.length < 2) return { ok: true, gaps }
    for (let i = 1; i < candles.length; i++) {
        const delta = candles[i].t - candles[i - 1].t
        if (delta > step) {
            gaps.push({ after: candles[i - 1].t, missing: Math.round(delta / step) - 1 })
        }
    }
    return { ok: gaps.length === 0, gaps }
}

/**
 * Geschlossene Kerzen, jüngste zuletzt.
 *
 * @param {string} symbol    z.B. 'BTCUSDT'
 * @param {string} interval  z.B. '15m'
 * @param {number} limit     gewünschte Anzahl geschlossener Kerzen
 * @param {object} [opts]    { market='futures', force=false, now=Date.now() }
 * @returns {Promise<Array<{t,o,h,l,c,v,closeTime}>>}
 */
export async function getClosedCandles(symbol, interval, limit = 300, opts = {}) {
    const market = opts.market === 'spot' ? 'spot' : 'futures'
    const sym = String(symbol || '').toUpperCase()
    if (!sym) throw new Error('getClosedCandles: symbol fehlt')
    if (!isValidTimeframe(interval)) throw new Error(`getClosedCandles: unbekanntes Intervall ${interval}`)

    const now = opts.now || Date.now()
    const openOfRunning = currentCandleOpen(interval, now)
    const key = cacheKey(sym, interval, market)

    const cached = cache.get(key)
    if (!opts.force && cached && cached.lastOpen === openOfRunning && cached.candles.length >= limit) {
        return cached.candles.slice(-limit)
    }

    // Paralleler Abruf desselben Schlüssels wird zusammengelegt — bei mehreren
    // Instanzen auf demselben Symbol sonst n identische Requests pro Takt.
    if (inFlight.has(key)) {
        const shared = await inFlight.get(key)
        return shared.slice(-limit)
    }

    // +1, weil die laufende Kerze mitkommt und gleich wieder wegfällt
    const promise = (async () => {
        const rows = await fetchKlines({
            symbol: sym, interval, market,
            limit: Math.min(limit + 1, KLINE_LIMITS[market]),
        })
        const closed = rows.filter((k) => k.t < openOfRunning)
        cache.set(key, { candles: closed, fetchedAt: now, lastOpen: openOfRunning })

        const { ok, gaps } = checkGaps(closed, interval)
        if (!ok) {
            logWarn('market-data', `${sym} ${interval}: ${gaps.length} Lücke(n) in den Kerzen`)
        }
        return closed
    })()

    inFlight.set(key, promise)
    try {
        const closed = await promise
        return closed.slice(-limit)
    } finally {
        inFlight.delete(key)
    }
}

/**
 * Historische geschlossene Kerzen über ein Zeitfenster — für den Backtest.
 * Paginiert automatisch über das Binance-Limit hinaus.
 *
 * @returns {Promise<Array>} lückenlos aufsteigend sortiert, ohne laufende Kerze
 */
/**
 * Einen Historienabruf wiederholen, wenn es sich lohnt.
 *
 * Ein Zeitüberschritt oder ein 5xx ist vorübergehend — beim nächsten Versuch
 * klappt es meistens. Ein 400 („Invalid symbol") dagegen ist endgültig, und ihn
 * dreimal zu erfragen hält nur die 99 anderen Coins auf.
 *
 * Ohne diese Schleife schrieb ein einziger 10-Sekunden-Zeitüberschritt einen
 * Coin als Fehlerzeile ab (gesehen bei ONDOUSDT am 16.08.2026) — obwohl der
 * Abruf eine Sekunde später fehlerfrei durchlief.
 */
async function mitWiederholung(abruf, was) {
    let letzter
    for (let versuch = 0; versuch <= WIEDERHOLUNGEN.length; versuch++) {
        try {
            return await abruf()
        } catch (e) {
            letzter = e
            const status = e?.response?.status
            if (!istWiederholbar(status) || versuch === WIEDERHOLUNGEN.length) throw e
            const pause = WIEDERHOLUNGEN[versuch]
            logWarn('market-data', `${was}: ${e.message} — Versuch ${versuch + 2} in ${pause / 1000}s`)
            await new Promise((f) => setTimeout(f, pause))
            // Nach der Pause erneut anstehen: die Bremse könnte inzwischen
            // wegen einer Strafe zugemacht haben.
            await warteAufGewicht()
        }
    }
    throw letzter
}

export async function getHistoricalCandles(symbol, interval, fromTs, toTs, opts = {}) {
    const market = opts.market === 'spot' ? 'spot' : 'futures'
    const sym = String(symbol || '').toUpperCase()
    if (!isValidTimeframe(interval)) throw new Error(`getHistoricalCandles: unbekanntes Intervall ${interval}`)

    const step = timeframeMs(interval)
    const now = opts.now || Date.now()
    const end = Math.min(Number(toTs) || now, currentCandleOpen(interval, now))
    let cursor = Number(fromTs) || 0
    if (!cursor || cursor >= end) return []

    const pageSize = KLINE_LIMITS[market]
    const maxCandles = Math.min(opts.maxCandles || 20000, 200000)
    const out = []
    let guard = 0

    while (cursor < end && out.length < maxCandles) {
        if (++guard > 500) break   // Sicherheitsnetz gegen Endlosschleifen
        // NUR hier wird gewartet: Historie ist Laborarbeit und darf sich
        // gedulden. `getClosedCandles` — der Weg des Livebetriebs — bleibt
        // ungebremst und überholt jederzeit.
        await warteAufGewicht()
        const rows = await mitWiederholung(() => fetchKlines({
            symbol: sym, interval, market,
            limit: pageSize, startTime: cursor, endTime: end,
        }), `${sym} ${interval}`)
        if (!rows.length) break

        for (const k of rows) {
            if (k.t >= end) break                       // laufende Kerze raus
            if (out.length && k.t <= out[out.length - 1].t) continue  // Überlappung
            out.push(k)
        }

        const last = rows[rows.length - 1].t
        if (last <= cursor) break
        cursor = last + step
    }

    return out
}

/**
 * Letzter gehandelter Preis. Für Paper-Trading und für den Abgleich zwischen
 * Signalquelle und Handelsbörse.
 */
export async function getLastPrice(symbol, opts = {}) {
    const market = opts.market === 'spot' ? 'spot' : 'futures'
    const sym = String(symbol || '').toUpperCase()
    const path = market === 'spot' ? '/api/v3/ticker/price' : '/fapi/v1/ticker/price'
    const { data } = await axios.get(`${BASES[market]}${path}`, {
        params: { symbol: sym }, timeout: HTTP_TIMEOUT,
    })
    const price = Number(data?.price)
    if (!Number.isFinite(price)) throw new Error(`Kein Preis für ${sym}`)
    return price
}

/**
 * Aktuelle Funding-Rate (nur Futures) — Eingabe für den Sentiment-Agenten.
 * Gibt null zurück statt zu werfen: fehlendes Sentiment darf keinen Lauf killen.
 */
export async function getFundingRate(symbol) {
    try {
        const { data } = await axios.get(`${BASES.futures}/fapi/v1/premiumIndex`, {
            params: { symbol: String(symbol || '').toUpperCase() }, timeout: HTTP_TIMEOUT,
        })
        const rate = Number(data?.lastFundingRate)
        return Number.isFinite(rate) ? { rate, nextFundingTime: Number(data?.nextFundingTime) || 0 } : null
    } catch (e) {
        logWarn('market-data', `Funding-Rate für ${symbol} nicht abrufbar: ${e.message}`)
        return null
    }
}

// ── Symbol-Metadaten (tickSize/stepSize) für korrektes Runden von Orders ──
const metaCache = new Map()   // market -> { ts, map }
const META_TTL = 6 * 60 * 60 * 1000

export async function getSymbolMeta(symbol, opts = {}) {
    const market = opts.market === 'spot' ? 'spot' : 'futures'
    const sym = String(symbol || '').toUpperCase()

    const cached = metaCache.get(market)
    if (!cached || (Date.now() - cached.ts) > META_TTL) {
        const path = market === 'spot' ? '/api/v3/exchangeInfo' : '/fapi/v1/exchangeInfo'
        const { data } = await axios.get(`${BASES[market]}${path}`, { timeout: HTTP_TIMEOUT })
        const map = new Map()
        for (const s of data?.symbols || []) {
            if (s.status !== 'TRADING') continue
            const pf = (s.filters || []).find((f) => f.filterType === 'PRICE_FILTER')
            const lf = (s.filters || []).find((f) => f.filterType === 'LOT_SIZE')
            const mn = (s.filters || []).find((f) => f.filterType === 'MIN_NOTIONAL')
            map.set(s.symbol, {
                symbol: s.symbol,
                tickSize: pf ? Number(pf.tickSize) : 0,
                stepSize: lf ? Number(lf.stepSize) : 0,
                minQty: lf ? Number(lf.minQty) : 0,
                minNotional: mn ? Number(mn.notional ?? mn.minNotional) : 0,
            })
        }
        metaCache.set(market, { ts: Date.now(), map })
    }

    return metaCache.get(market).map.get(sym) || null
}

