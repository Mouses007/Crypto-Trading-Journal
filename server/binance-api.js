/**
 * Binance Public API Proxy
 * Proxied die kostenlosen, öffentlichen Binance-Endpoints (Klines, Orderbuch-
 * Snapshot, Symbol-Metadaten) um CORS zu vermeiden. Kein API-Key nötig.
 *
 * Die Live-Analyse (Heatmap/Bookmap) holt sich den Depth-Snapshot hierüber und
 * abonniert den Diff-Stream danach direkt per WebSocket aus dem Browser.
 */

import axios from 'axios'
// Gemeinsame Gewichtsbremse: dieser Proxy und die Kerzen-Abrufe teilen
// sich EINE Binance-IP. Zählte der Proxy nicht mit, träfe ein 429 als
// Erstes den Live-Stream — also genau das, was am wenigsten warten kann.
import { notiereGewicht, melde429 } from './binance-takt.js'

const BASES = {
    spot: 'https://api.binance.com',
    futures: 'https://fapi.binance.com',
}

const PATHS = {
    spot: { depth: '/api/v3/depth', info: '/api/v3/exchangeInfo', klines: '/api/v3/klines' },
    futures: { depth: '/fapi/v1/depth', info: '/fapi/v1/exchangeInfo', klines: '/fapi/v1/klines' },
}

// Spot erlaubt max. 1000 Kerzen pro Abruf, Futures 1500.
const KLINE_LIMITS = { spot: 1000, futures: 1500 }

const HTTP_TIMEOUT = 10000
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/

// Von Binance akzeptierte depth-Limits (Futures kennt kein 5000)
const DEPTH_LIMITS = {
    spot: [5, 10, 20, 50, 100, 500, 1000, 5000],
    futures: [5, 10, 20, 50, 100, 500, 1000],
}

/** 'spot' | 'futures' | null (= ungültig) */
function pickMarket(query) {
    const market = String(query.market || 'futures').toLowerCase()
    return (market === 'spot' || market === 'futures') ? market : null
}

function sendBinanceError(res, error, what) {
    console.error(` -> Binance API Fehler (${what}):`, error.response?.data || error.message)
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return res.status(504).json({ error: `Binance antwortet nicht (${what}). Bitte später erneut versuchen.` })
    }
    const status = error.response?.status || 500
    if (status === 429 || status === 418) {
        // Die Strafe gilt der IP, nicht diesem Endpunkt. Ohne diese Meldung
        // liefen die Kerzen-Abrufe munter weiter und holten sich die nächste —
        // die gemeinsame Bremse erfährt es sonst nie.
        melde429(status, error.response?.headers)
        return res.status(429).json({ error: 'Binance-Rate-Limit erreicht. Bitte kurz warten.' })
    }
    res.status(status).json({ error: error.response?.data?.msg || `${what} fehlgeschlagen: ${error.message}` })
}

// exchangeInfo ist roh 3-5 MB und ändert sich selten → geslimmt cachen.
const infoCache = new Map()   // market -> { ts, payload }
const INFO_CACHE_MS = 6 * 60 * 60 * 1000

// ── Hebelkarte: Open Interest + Kerzen ──────────────────────
// Rohdaten für das clientseitige Modell. Bewusst NICHT serverseitig gerechnet:
// die Karte hängt an interaktiven Parametern (Hebelstufe, Gewichte, Margin,
// Spanne). Ein Cache-Eintrag je symbol|period bedient damit jede Kombination.
const LEVMAP_PERIODS = { '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 }
const levMapCache = new Map()      // `${symbol}|${period}` -> { ts, payload }
const levMapForce = new Map()      // symbol -> letzter erzwungener Abruf

/**
 * Führt OI-Historie und Kerzen zusammen. Fehlende Kerzen werden übersprungen
 * statt schief verknüpft — ein verschobener Join würde die Sweep-Logik und die
 * Long/Short-Aufteilung stillschweigend verfälschen.
 *
 * Zuordnung (empirisch verifiziert 14.08.2026): der OI-Wert ist ein
 * Schnappschuss ZUM Zeitpunkt t. Die Veränderung gegenüber dem Vorpunkt
 * entstand also in der Kerze, die bei t ENDET — openTime = t − period.
 * Der frühere Join auf die bei t BEGINNENDE Kerze verschob Preisspanne und
 * Taker-Volumen um eine ganze Periode in die Zukunft des ΔOI.
 */
function mergeLeverageMapPoints(hist, klines, periodMs) {
    const byTime = new Map(klines.map(k => [Number(k[0]), k]))
    const points = []
    for (const h of hist) {
        const t = Number(h.timestamp)
        const k = byTime.get(t - periodMs)
        if (!k) continue
        points.push({
            t,
            oi: Number(h.sumOpenInterest),
            oiUsd: Number(h.sumOpenInterestValue),
            o: +k[1], h: +k[2], l: +k[3], c: +k[4],
            v: +k[5],
            tb: +k[9],     // takerBuyBaseVolume — die aggressive Kaufseite
        })
    }
    return points
}

function slimExchangeInfo(raw, market) {
    const symbols = []
    for (const s of raw.symbols || []) {
        if (s.status !== 'TRADING') continue
        // Futures: nur Perpetuals (Quartals-Kontrakte haben eigene Symbole)
        if (market === 'futures' && s.contractType !== 'PERPETUAL') continue
        const priceFilter = (s.filters || []).find(f => f.filterType === 'PRICE_FILTER')
        const lotFilter = (s.filters || []).find(f => f.filterType === 'LOT_SIZE')
        symbols.push({
            symbol: s.symbol,
            base: s.baseAsset,
            quote: s.quoteAsset,
            tickSize: priceFilter ? Number(priceFilter.tickSize) : null,
            stepSize: lotFilter ? Number(lotFilter.stepSize) : null,
        })
    }
    symbols.sort((a, b) => a.symbol.localeCompare(b.symbol))
    return { market, serverTime: raw.serverTime, symbols }
}

export function setupBinanceRoutes(app) {

    /**
     * GET /api/binance/klines
     * Query-Parameter:
     *   symbol    - z.B. BNBUSDT (required)
     *   market    - 'spot' | 'futures' (default: spot — Journal-Charts hängen daran)
     *   interval  - z.B. 1m, 5m, 15m, 1h (default: 1m)
     *   startTime - Unix Millisekunden (optional, nur zusammen mit endTime)
     *   endTime   - Unix Millisekunden (optional)
     *   limit     - max Anzahl Kerzen (default 1000; spot max 1000, futures max 1500)
     *
     * Ohne Zeitfenster liefert Binance die letzten `limit` Kerzen — das braucht
     * die Strategie-Engine, die immer nur den jüngsten Ausschnitt sehen will.
     *
     * Response: Array von Arrays
     *   [openTime, open, high, low, close, volume, closeTime, ...]
     */
    app.get('/api/binance/klines', async (req, res) => {
        try {
            const { symbol, interval, startTime, endTime, limit } = req.query

            if (!symbol) {
                return res.status(400).json({ error: 'symbol ist erforderlich' })
            }
            // Default 'spot': der bestehende Journal-Kerzenchart ruft ohne market auf.
            const market = String(req.query.market || 'spot').toLowerCase()
            if (market !== 'spot' && market !== 'futures') {
                return res.status(400).json({ error: 'market muss "spot" oder "futures" sein' })
            }

            const params = {
                symbol: String(symbol).toUpperCase().slice(0, 20),
                interval: interval || '1m',
                limit: Math.min(Math.max(1, parseInt(limit, 10) || 1000), KLINE_LIMITS[market]),
            }

            // Zeitfenster ist optional — aber entweder beide Grenzen oder keine.
            if (startTime !== undefined || endTime !== undefined) {
                const start = Number(startTime)
                const end = Number(endTime)
                if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) {
                    return res.status(400).json({ error: 'startTime und endTime müssen gültige positive Zahlen (Unix ms) sein' })
                }
                if (start >= end) {
                    return res.status(400).json({ error: 'startTime muss vor endTime liegen' })
                }
                params.startTime = start
                params.endTime = end
            }

            const fenster = params.startTime
                ? `von ${new Date(params.startTime).toISOString()} bis ${new Date(params.endTime).toISOString()}`
                : `letzte ${params.limit}`
            console.log(` -> Binance klines (${market}): ${params.symbol} ${params.interval} ${fenster}`)

            const response = await axios.get(`${BASES[market]}${PATHS[market].klines}`, { params, timeout: HTTP_TIMEOUT })
            notiereGewicht(response.headers)
            res.json(response.data)

        } catch (error) {
            sendBinanceError(res, error, 'Klines')
        }
    })

    /**
     * GET /api/binance/depth
     * Orderbuch-Snapshot als Startpunkt für den lokalen Diff-Sync.
     * Query: symbol (required), market ('futures'|'spot', default futures), limit
     *
     * `lastUpdateId` wird unverändert durchgereicht — der Client braucht es,
     * um die gepufferten WebSocket-Diffs korrekt anzusetzen.
     */
    app.get('/api/binance/depth', async (req, res) => {
        try {
            const market = pickMarket(req.query)
            if (!market) {
                return res.status(400).json({ error: 'market muss "spot" oder "futures" sein' })
            }

            const symbol = String(req.query.symbol || '').toUpperCase()
            if (!SYMBOL_RE.test(symbol)) {
                return res.status(400).json({ error: 'symbol ist erforderlich und darf nur Buchstaben und Ziffern enthalten' })
            }

            // Binance akzeptiert nur diskrete Limits → auf den nächsten gültigen Wert runden
            const allowed = DEPTH_LIMITS[market]
            const wanted = parseInt(req.query.limit, 10) || allowed[allowed.length - 1]
            const limit = allowed.reduce((best, v) => Math.abs(v - wanted) < Math.abs(best - wanted) ? v : best, allowed[0])

            const antwort = await axios.get(`${BASES[market]}${PATHS[market].depth}`, {
                params: { symbol, limit },
                timeout: HTTP_TIMEOUT
            })
            notiereGewicht(antwort.headers)
            const { data } = antwort

            // Snapshots sind sekundengenau relevant — nichts zwischenspeichern
            res.setHeader('Cache-Control', 'no-store')
            res.json(data)

        } catch (error) {
            sendBinanceError(res, error, 'Orderbuch-Snapshot')
        }
    })

    /**
     * GET /api/binance/exchange-info
     * Handelbare Symbole mit tickSize/stepSize. Serverseitig auf das Nötige
     * reduziert (~45 kB statt ~4 MB) und 6 h gecacht.
     * Query: market ('futures'|'spot'), force=1 umgeht den Cache.
     */
    app.get('/api/binance/exchange-info', async (req, res) => {
        try {
            const market = pickMarket(req.query)
            if (!market) {
                return res.status(400).json({ error: 'market muss "spot" oder "futures" sein' })
            }

            const cached = infoCache.get(market)
            if (cached && (Date.now() - cached.ts) < INFO_CACHE_MS && req.query.force !== '1') {
                res.setHeader('X-Cache', 'HIT')
                return res.json(cached.payload)
            }

            const { data } = await axios.get(`${BASES[market]}${PATHS[market].info}`, { timeout: HTTP_TIMEOUT })
            const payload = slimExchangeInfo(data, market)
            infoCache.set(market, { ts: Date.now(), payload })
            console.log(` -> Binance exchangeInfo (${market}): ${payload.symbols.length} Symbole gecacht`)
            res.setHeader('X-Cache', 'MISS')
            res.json(payload)

        } catch (error) {
            sendBinanceError(res, error, 'Exchange-Info')
        }
    })

    /**
     * GET /api/binance/leverage-map
     * Rohdaten für die berechnete Hebelkarte: Open-Interest-Historie, Kerzen
     * und die Kontenquote, auf denselben Zeitraster zusammengeführt.
     * Query: symbol (required), period (5m|15m|1h|4h|1d), limit (≤500), force=1
     *
     * Achtung: Die Kerzen kommen von `fapi`, NICHT über /api/binance/klines —
     * der liefert Spot-Kerzen, deren Hochs/Tiefs und Volumen für die
     * Sweep-Logik und die Long/Short-Aufteilung unbrauchbar wären.
     */
    app.get('/api/binance/leverage-map', async (req, res) => {
        try {
            if (pickMarket(req.query) !== 'futures') {
                return res.status(400).json({ error: 'Open Interest gibt es nur für Futures' })
            }

            const symbol = String(req.query.symbol || '').toUpperCase()
            if (!SYMBOL_RE.test(symbol)) {
                return res.status(400).json({ error: 'symbol ist erforderlich und darf nur Buchstaben und Ziffern enthalten' })
            }

            const period = LEVMAP_PERIODS[req.query.period] ? req.query.period : '5m'
            // Der Cache-Schlüssel ist `symbol|period` OHNE limit. Würde hier
            // die Wunschmenge des Aufrufers durchgereicht, bekäme der nächste
            // Aufruf mit grösserem Fenster stillschweigend die kürzere
            // gecachte Antwort. Deshalb wird immer die volle Tiefe geholt und
            // der Aufrufer schneidet sich sein Fenster selbst heraus.
            const limit = 500
            const periodMs = LEVMAP_PERIODS[period] * 60000

            // Ein fehlerhafter Client darf mit force=1 nicht die Server-IP verbrennen
            const wantsForce = req.query.force === '1'
                && (Date.now() - (levMapForce.get(symbol) || 0)) > 30000

            const key = `${symbol}|${period}`
            const ttl = Math.min(Math.max(periodMs / 2, 60000), 300000)
            const cached = levMapCache.get(key)
            if (cached && (Date.now() - cached.ts) < ttl && !wantsForce) {
                res.setHeader('X-Cache', 'HIT')
                return res.json(cached.payload)
            }
            if (wantsForce) levMapForce.set(symbol, Date.now())

            // /futures/data/… liegt NICHT unter /fapi/v1
            const [histRes, nowRes, ratioRes] = await Promise.all([
                axios.get(`${BASES.futures}/futures/data/openInterestHist`,
                    { params: { symbol, period, limit }, timeout: HTTP_TIMEOUT }),
                axios.get(`${BASES.futures}/fapi/v1/openInterest`,
                    { params: { symbol }, timeout: HTTP_TIMEOUT }),
                axios.get(`${BASES.futures}/futures/data/globalLongShortAccountRatio`,
                    { params: { symbol, period, limit: 1 }, timeout: HTTP_TIMEOUT }).catch(() => null),
            ])

            const hist = Array.isArray(histRes.data) ? histRes.data : []
            if (!hist.length) {
                const leer = {
                    symbol, period, points: [],
                    hinweis: `Binance liefert für ${symbol} keine Open-Interest-Historie`,
                }
                levMapCache.set(key, { ts: Date.now(), payload: leer })
                return res.json(leer)
            }

            // startTime eine Periode früher: jeder OI-Punkt braucht die bei
            // seinem Zeitstempel ENDENDE Kerze (siehe mergeLeverageMapPoints)
            const { data: klines } = await axios.get(`${BASES.futures}/fapi/v1/klines`, {
                params: { symbol, interval: period, startTime: Number(hist[0].timestamp) - periodMs, limit: hist.length + 2 },
                timeout: HTTP_TIMEOUT,
            })

            const points = mergeLeverageMapPoints(hist, klines, periodMs)
            const letzte = points[points.length - 1]
            // Seit dem End-Join ist jede zugeordnete Kerze abgeschlossen (sie
            // endet am OI-Zeitpunkt) — eine „laufende Periode" gibt es im
            // Datensatz nicht mehr. Feld bleibt für die Client-Kompatibilität.
            const unvollstaendig = false

            const payload = {
                symbol, period,
                openInterest: Number(nowRes.data?.openInterest) || 0,
                spanneMs: points.length ? letzte.t - points[0].t : 0,
                unvollstaendig,
                accountRatio: ratioRes?.data?.[0]
                    ? { long: +ratioRes.data[0].longAccount, short: +ratioRes.data[0].shortAccount }
                    : null,
                points,
            }

            levMapCache.set(key, { ts: Date.now(), payload })
            console.log(` -> Binance Hebelkarte ${symbol} ${period}: ${points.length}/${hist.length} Punkte, ${(payload.spanneMs / 3600000).toFixed(1)} h`)
            res.setHeader('X-Cache', 'MISS')
            res.setHeader('Cache-Control', 'private, max-age=60')
            res.json(payload)

        } catch (error) {
            sendBinanceError(res, error, 'Hebelkarte')
        }
    })
}
