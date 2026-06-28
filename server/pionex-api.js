import crypto from 'crypto'
import { getKnex } from './database.js'
import { encrypt, decrypt } from './crypto.js'

const BASE_URL = 'https://api.pionex.com'

/**
 * Pionex API authentication (HMAC-SHA256 → hex).
 *
 * Signatur-String:  METHOD + PATH + "?" + sortedQuery   (GET)
 *                   METHOD + PATH + "?" + sortedQuery + body   (POST/DELETE)
 * Query-Parameter:  aufsteigend nach ASCII-Key sortiert, mit & verbunden,
 *                   inkl. `timestamp` (ms). Werte NICHT url-encoden.
 * Header:           PIONEX-KEY, PIONEX-SIGNATURE
 *
 * Quelle: https://pionex-doc.gitbook.io/apidocs/restful/general/authentication
 */
function createSignature(secretKey, method, path, sortedQuery, body) {
    let str = method.toUpperCase() + path
    if (sortedQuery) str += '?' + sortedQuery
    if (body) str += body
    return crypto.createHmac('sha256', secretKey).update(str).digest('hex')
}

/**
 * Authentifizierter Request gegen die Pionex REST API.
 * @returns {object} data-Envelope: { result:true, data, timestamp }
 */
async function pionexRequest(method, path, apiKey, secretKey, params = {}, body = null) {
    const timestamp = String(Date.now())
    const allParams = { ...params, timestamp }

    // Keys aufsteigend nach ASCII sortieren (Pionex-Vorgabe), unescaped joinen.
    const sortedKeys = Object.keys(allParams).sort()
    const sortedQuery = sortedKeys.map(k => `${k}=${allParams[k]}`).join('&')

    const bodyString = (body && method !== 'GET') ? JSON.stringify(body) : ''
    const sign = createSignature(secretKey, method, path, sortedQuery, bodyString)

    const url = `${BASE_URL}${path}?${sortedQuery}`
    const headers = {
        'Content-Type': 'application/json',
        'PIONEX-KEY': apiKey,
        'PIONEX-SIGNATURE': sign,
    }

    const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? (bodyString || undefined) : undefined
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
        const msg = data ? `[${data.code}] ${data.message}` : `${response.status} ${response.statusText}`
        throw new Error(`Pionex API: ${msg}`)
    }
    // Erfolgs-Envelope: result === true
    if (data && data.result === false) {
        throw new Error(`Pionex API: [${data.code}] ${data.message || 'Unbekannter Fehler'}`)
    }
    return data
}

/**
 * Account-Balances (Spot). GET /api/v1/account/balances
 * Response: data.balances[] = { coin, free, frozen }
 * Hinweis: /uapi/v1/account/balances ist NUR Futures-Account (oft leer wenn
 * der Nutzer nur Spot/Bots verwendet).
 */
export async function getBalances(apiKey, secretKey) {
    return pionexRequest('GET', '/api/v1/account/balances', apiKey, secretKey)
}

/**
 * Aktueller Marktpreis fuer ein Symbol (z.B. SOL_USDT). Public, keine Auth.
 * Liefert die letzte Close-Notierung in USDT.
 */
async function fetchTickerPrice(symbol) {
    try {
        const r = await fetch(`${BASE_URL}/api/v1/market/tickers?symbol=${encodeURIComponent(symbol)}`)
        const d = await r.json()
        const t = d?.data?.tickers?.[0]
        const p = parseFloat(t?.close ?? t?.last ?? 0)
        return Number.isFinite(p) ? p : 0
    } catch (_) { return 0 }
}

/**
 * Offene Positionen (Futures). GET /uapi/v1/account/positions
 * Response: data.positions[] = { positionId, symbol, positionSide (LONG/SHORT),
 *           netSize, avgPrice, unrealizedPnL, markPrice, leverage,
 *           liquidationPrice, createTime, updateTime }
 */
export async function getOpenPositions(apiKey, secretKey, options = {}) {
    const params = {}
    if (options.symbol) params.symbol = options.symbol
    return pionexRequest('GET', '/uapi/v1/account/positions', apiKey, secretKey, params)
}

/**
 * Geschlossene Positionen (Futures). GET /uapi/v1/account/historyPositions
 * Optionale Params: symbol, positionFlag (CLOSED/TAKEOVER), startTime, endTime, limit
 * Response: data.positions[] sortiert absteigend nach Schlusszeit.
 * HINWEIS: Genaue PnL-/Fee-/Funding-Feldnamen werden an Live-Daten verifiziert.
 */
export async function getHistoryPositions(apiKey, secretKey, options = {}) {
    const params = {}
    if (options.symbol) params.symbol = options.symbol
    if (options.positionFlag) params.positionFlag = options.positionFlag
    if (options.startTime) params.startTime = options.startTime
    if (options.endTime) params.endTime = options.endTime
    if (options.limit) params.limit = options.limit
    return pionexRequest('GET', '/uapi/v1/account/historyPositions', apiKey, secretKey, params)
}

/**
 * Einzel-Fills (Ausführungen) eines Futures-Symbols. GET /uapi/v1/trade/fills
 * `symbol` ist PFLICHT (sonst TRADE_PARAMETER_ERROR). Optional: startTime, endTime, limit.
 * Response: data.fills[] = { id, orderId, symbol, side, role, price, size, fee, feeCoin, feeType, timestamp }.
 */
export async function getFills(apiKey, secretKey, options = {}) {
    const params = {}
    if (options.symbol) params.symbol = options.symbol
    if (options.startTime) params.startTime = options.startTime
    if (options.endTime) params.endTime = options.endTime
    params.limit = options.limit || 100
    return pionexRequest('GET', '/uapi/v1/trade/fills', apiKey, secretKey, params)
}

/**
 * Bot-Orders (Grid-Bots etc.). GET /api/v1/bot/orders
 * Params: status (running|finished), base, quote, pageToken, buOrderTypes[]
 * Response: data.results[] = { buOrderId, buOrderType, base, quote, createTime,
 *           closeTime, buOrderData{ ...status, totalRealizedProfit, gridProfit,
 *           totalFee, totalFundingFee, totalVolume, setLeverage,
 *           initQuoteInvestment, positionOpenPrice, closedPrice, reasonBy } }
 */
export async function getBotOrders(apiKey, secretKey, options = {}) {
    const params = {}
    if (options.status) params.status = options.status
    if (options.limit) params.limit = options.limit
    if (options.pageToken) params.pageToken = options.pageToken
    return pionexRequest('GET', '/api/v1/bot/orders', apiKey, secretKey, params)
}

/**
 * Instrument eines Bots aus base/quote + buOrderData ableiten.
 *  - Linear (USDT-margined): base = Coin (BTC.PERP), quote = USDT → margined in USDT.
 *  - Coin-M (coin-margined, invers): base = USDT.PERP, quote = Coin (SOL) →
 *    margined/abgerechnet in der Coin (SOL). Erkennung via cateType / uiExtraData /
 *    investCoin. Die gehandelte Münze ist immer die Nicht-USDT-Seite.
 */
function botInstrument(o) {
    const d = o.buOrderData || {}
    const coinM = d.cateType === 'FUTURE_GRID_COIN_MARGINED'
        || /coin_margin/i.test(d.uiExtraData || '')
        || (!!d.investCoin && d.investCoin !== 'USDT')
    const strip = s => String(s || '').replace(/\.(PERP|SPOT)$/i, '').toUpperCase()
    const b = strip(o.base), q = strip(o.quote)
    const coin = (b === 'USDT' || b === '') ? q : b   // gehandelte Münze = Nicht-USDT-Seite
    return {
        coinM,
        coin,
        marginCoin: coinM ? (d.investCoin || coin) : 'USDT',
        symbol: `${coin}USDT`,
        tickerSymbol: `${coin}_USDT_PERP`,
    }
}

/**
 * Flacht eine Bot-Order auf ein einheitliches Objekt ab, das das Frontend-Mapping
 * (createPionexTradeObj) konsumiert. positionId = buOrderId (stabil, eindeutig).
 */
function normalizeBotOrder(o) {
    if (!o) return null
    const d = o.buOrderData || {}
    const buOrderId = String(o.buOrderId ?? d.buOrderId ?? '')
    if (!buOrderId) return null
    const inst = botInstrument(o)
    // Echter Hebel: d.leverage (z.B. 5) — NICHT d.setLeverage (z.B. 75); beide
    // weichen bei Coin-M ab, Pionex-UI zeigt d.leverage.
    const leverage = parseFloat(d.leverage ?? d.setLeverage ?? 0)
    // Spot-Grid (inkl. us_token_grid) hat ein anderes Feld-Layout: Profit in
    // gridProfit/realizedProfit, Gebühren in totalFeeInQuote, Investment in USDT,
    // KEIN Funding/Position/totalRealizedProfit. Eigenes Symbol (quote=USDT).
    const isSpot = /spot/i.test(o.buOrderType || '') || /spot|token_grid/i.test(d.cateType || '')

    // Richtung: Coin-M ist invers (base=USDT.PERP) — short auf der USDT-Seite
    // (trend='short' bzw. initBaseAmount<0) = LONG der Coin. Linear: trend direkt.
    const baseShort = (d.trend === 'short') ||
        (parseFloat(d.initBaseAmount ?? d.baseAmount ?? d.position ?? 0) < 0)
    const side = inst.coinM ? (baseShort ? 'LONG' : 'SHORT') : (baseShort ? 'SHORT' : 'LONG')

    // USDT-Sekundärwerte. Coin-M ist invers → echter USD-PnL ist die Differenz
    // der USDT-Werte (Endwert − Einsatz), NICHT SOL-PnL × Kurs. Gegen Pionex
    // verifiziert (SOL Coin-M Bot: +18.63 USDT).
    const closeQuoteP = parseFloat(d.closedQuotePrice ?? d.initQuotePrice ?? 0)   // Coin-Preis (USDT) bei Schliessung
    const entryQuoteP = parseFloat(d.initQuotePrice ?? d.openQuotePrice ?? 0)     // Coin-Preis (USDT) bei Start
    const investSol = parseFloat(d.quoteInvestment ?? d.initQuoteInvestment ?? 0)
    const marginBal = parseFloat(d.marginBalance ?? 0)
    let pnlUsdt, investUsdt
    if (inst.coinM) {
        investUsdt = investSol * entryQuoteP
        pnlUsdt = (marginBal && closeQuoteP) ? (marginBal * closeQuoteP - investSol * entryQuoteP) : 0
    } else {
        investUsdt = parseFloat(d.usdtInvestment ?? d.initUsdtInvestment ?? 0)
        pnlUsdt = parseFloat(d.totalRealizedProfit ?? d.realizedProfit ?? 0)   // linear: bereits USDT
    }

    return {
        positionId: buOrderId,
        buOrderId,
        botType: o.buOrderType ?? d.buOrderType ?? 'grid',
        spotGrid: isSpot,
        symbol: inst.symbol,
        coinM: inst.coinM,
        marginCoin: inst.marginCoin,
        side,
        status: d.status ?? o.status ?? '',
        reasonBy: d.reasonBy ?? null,
        createTime: o.createTime ?? d.createTime ?? '',
        closeTime: o.closeTime ?? d.closeTime ?? '',
        totalRealizedProfit: d.totalRealizedProfit,
        gridProfit: d.gridProfit,
        realizedProfit: d.realizedProfit,          // Spot: Positions-PnL beim Schliessen
        totalFee: d.totalFee,
        totalFeeInQuote: d.totalFeeInQuote,         // Spot: Gebühren in Quote (USDT)
        totalFundingFee: d.totalFundingFee,
        totalVolume: d.totalVolume,
        usdtInvestment: d.usdtInvestment ?? d.initUsdtInvestment,  // Spot/allg. USDT-Investment
        setLeverage: leverage,   // Feldname beibehalten (createPionexTradeObj liest pos.setLeverage)
        leverage,
        initQuoteInvestment: d.initQuoteInvestment,
        // USDT-Sekundärwerte (Coin-M: invers gerechnet; sonst nativ)
        pnlUsdt,
        investUsdt,
        // Schlusskurs der Coin (USDT) — Frontend rechnet damit SOL-Komponenten
        // (Grid/Gebühren/Funding) in USD um. Linear: 1 (Werte schon in USDT).
        quoteCloseP: inst.coinM ? closeQuoteP : 1,
        // Spot: Einstieg/Ausstieg aus openPrice/gridAverageOpenPrice bzw. closedPrice
        positionOpenPrice: d.positionOpenPrice ?? d.gridAverageOpenPrice ?? d.openPrice,
        closedPrice: d.closedPrice
    }
}

/**
 * Laufenden Bot auf das Open-Position-Format des Frontends abbilden — inkl.
 * LIVE Mark-to-Market (Pionex liefert keinen Floating-PnL als Feld).
 *
 *   Gesamt-PnL (in Margin-Münze) = realisiert + floating
 *     realisiert = marginBalance − Start-Investment
 *     floating   = position × (mark − entry)          [linear, USDT]
 *                = position × (1/mark − entryInvers)   [coin-M, invers]
 *
 * Beide Formeln gegen die Pionex-UI verifiziert (BTC linear, SOL coin-M).
 */
/**
 * Liquidationspreis (in USDT) eines laufenden Bots ermitteln.
 * Linear: liquidationPrice direkt. Coin-M (invers): liquidationPrice ist oft 0 →
 * estimateLiquidationPrice(Up|Down) verwenden (invers, Coin/USDT) und invertieren.
 */
function liqPriceFor(coinM, d) {
    const direct = parseFloat(d.liquidationPrice || 0)
    if (!coinM) return direct
    const est = parseFloat(d.estimateLiquidationPriceUp || 0) || parseFloat(d.estimateLiquidationPriceDown || 0)
    if (est) return 1 / est
    if (direct) return 1 / direct   // falls liquidationPrice doch (invers) gesetzt ist
    return 0
}

async function normalizeRunningBot(o) {
    const n = normalizeBotOrder(o)
    if (!n) return null
    const d = o.buOrderData || {}
    const inst = botInstrument(o)

    const entry = parseFloat(d.positionOpenPrice || 0)   // bei coin-M invers (Coin/USDT)
    const position = parseFloat(d.position ?? d.baseAmount ?? 0)   // signiert
    // Richtung: linear folgt dem trend/Positionsvorzeichen. Coin-M ist invers
    // (base=USDT) → trend/position beziehen sich auf die USDT-Seite: short USDT
    // = LONG der Coin. Daher bei Coin-M invertieren (Pionex-UI bestätigt).
    const baseShort = (d.trend === 'short' || position < 0)
    const side = inst.coinM ? (baseShort ? 'LONG' : 'SHORT') : (baseShort ? 'SHORT' : 'LONG')

    const markPrice = await fetchTickerPrice(inst.tickerSymbol)   // USDT/Coin

    // AKTUELLES Investment (Margin-Münze) — Pionex aktualisiert quoteInvestment/
    // usdtInvestment bei Einsatz-Aufstockung, NICHT init*. init* nur als Fallback,
    // sonst würde zugefügte Margin als „Gewinn" verbucht (marginBalance − init zu groß)
    // und die Marge-Anzeige bliebe auf dem Startbetrag stehen.
    const startInv = inst.coinM
        ? parseFloat(d.quoteInvestment ?? d.initQuoteInvestment ?? 0)   // SOL
        : parseFloat(d.usdtInvestment ?? d.initUsdtInvestment ?? 0)     // USDT
    const realized = parseFloat(d.marginBalance ?? 0) - startInv

    let floating = 0
    if (markPrice && entry) {
        floating = inst.coinM
            ? position * ((1 / markPrice) - entry)
            : position * (markPrice - entry)
    }
    const profit = realized + floating   // in Margin-Münze (USDT bzw. SOL)

    return {
        positionId: n.buOrderId,
        symbol: inst.symbol,
        coinM: inst.coinM,
        marginCoin: inst.marginCoin,
        side,
        // Anzeige-Einstieg = Durchschn. Haltepreis (driftet); coin-M entry ist invers → 1/entry
        entryPrice: inst.coinM ? (entry ? 1 / entry : 0) : entry,
        avgOpenPrice: inst.coinM ? (entry ? 1 / entry : 0) : entry,
        // Startpreis = Preis bei Bot-Start (Pionex „Startpreis", aus initPrice; coin-M invers)
        startPrice: (() => {
            const s = parseFloat(d.initPrice || 0)
            return inst.coinM ? (s ? 1 / s : 0) : s
        })(),
        leverage: n.leverage,
        qty: parseFloat(d.totalVolume || 0),
        maxQty: parseFloat(d.totalVolume || 0),
        unrealizedPNL: profit,
        realizedPart: realized,
        floatingPart: floating,
        // Investment in der Margin-Münze (coin-M: SOL, linear: USDT) — analog
        // Pionex „Tatsächliche Investition". Frontend zeigt es als „Marge".
        margin: startInv,
        // Liquidationspreis: linear direkt aus liquidationPrice. Coin-M ist invers —
        // liquidationPrice ist dort oft "0"; der echte Schätzwert liegt (invers) in
        // estimateLiquidationPrice(Up|Down). 1/est = Liq in USDT (gegen Pionex-UI verifiziert).
        liqPrice: liqPriceFor(inst.coinM, d),
        markPrice,
        ctime: n.createTime,
        mtime: n.closeTime,
        botType: n.botType,
        isBot: true
    }
}

/** Holt alle finished Bot-Orders (paginiert) bis `sinceMs` (Close-/Create-Zeit). */
async function fetchAllFinishedBots(apiKey, secretKey, sinceMs = 0) {
    let all = []
    let token = null
    for (let i = 0; i < 30; i++) {
        const opts = { status: 'finished', limit: 50 }
        if (token) opts.pageToken = token
        const r = await getBotOrders(apiKey, secretKey, opts)
        const res = r.data?.results || []
        all = all.concat(res)
        token = r.data?.nextPageToken
        if (sinceMs && res.length) {
            const oldest = Math.min(...res.map(o => parseInt(o.closeTime || o.createTime || 0) || 0))
            if (oldest < sinceMs) break
        }
        if (!token || !res.length) break
    }
    // Nur Bots ab sinceMs zurückgeben
    if (sinceMs) {
        all = all.filter(o => (parseInt(o.closeTime || o.createTime || 0) || 0) >= sinceMs)
    }
    return all
}

/**
 * Test der Verbindung — einfacher authentifizierter Read-Call.
 */
export async function testConnection(apiKey, secretKey) {
    return getBalances(apiKey, secretKey)
}

/**
 * Normalisiert eine offene Pionex-Position auf das Frontend-Format
 * (positionId, symbol, side, entryPrice, qty, unrealizedPNL, markPrice, leverage).
 */
/**
 * Pionex-Futures-Symbol normalisieren: "MYX_USDT_PERP" → "MYXUSDT".
 */
function cleanPionexSymbol(s) {
    const str = String(s || '')
    if (!str) return ''
    return str.replace(/_PERP$/i, '').replace(/_/g, '')
}

function normalizeOpenPosition(p) {
    if (!p) return null
    const positionId = String(p.positionId ?? p.id ?? '')
    if (!positionId) return null

    const side = String(p.positionSide || p.side || '').toUpperCase()  // LONG / SHORT
    const entry = p.avgPrice ?? p.entryPrice ?? p.openPrice ?? 0
    const qty = Math.abs(parseFloat(p.netSize ?? p.size ?? p.amount ?? 0))

    return {
        ...p,
        positionId,
        symbol: cleanPionexSymbol(p.symbol),
        side,
        entryPrice: entry,
        avgOpenPrice: entry,
        leverage: p.leverage ?? 0,
        qty,
        maxQty: qty,
        unrealizedPNL: p.unrealizedPnL ?? p.unrealizedPnl ?? 0,
        liqPrice: p.liquidationPrice ?? 0,
        markPrice: p.markPrice ?? p.liquidationPrice ?? 0,
        // Marge: Pionex liefert sie als initialMargin (nicht `margin`) → für die
        // Incoming-Karte (liest bitunixData.margin) explizit bereitstellen.
        margin: parseFloat(p.initialMargin ?? p.margin ?? 0),
        // Pionex nutzt createdTime/updatedTime (mit "d"); Frontend liest ctime/mtime.
        ctime: p.createdTime ?? p.createTime ?? p.cTime ?? '',
        mtime: p.updatedTime ?? p.updateTime ?? p.uTime ?? ''
    }
}

/**
 * Geschlossene reguläre Futures-Position aufbereiten.
 * historyPositions liefert KEINEN fertigen PnL/Fee — nur amountShort (Open-Cashflow,
 * +), amountLong (Close-Cashflow, −) und size. PnL/Preise werden daraus abgeleitet,
 * Gebühren aus den passenden Fills summiert (live verifiziert gegen Wallet-Delta):
 *   brutto = amountShort + amountLong   (vorzeichenrichtig für long & short)
 *   fee    = Σ |fills.fee| (feeType TRADING) im Positions-Zeitfenster
 *   netto  = brutto − fee
 * Setzt die Feldnamen, die createTradeFromClosedPosition (Pionex-Zweig) konsumiert
 * (totalRealizedProfit/totalFee/totalFundingFee, entryPrice/closePrice, createTime/updateTime).
 */
function normalizeFuturesHistoryPosition(p, fills = []) {
    if (!p) return null
    const positionId = String(p.positionId ?? p.id ?? '')
    if (!positionId) return null

    const side = String(p.positionSide || p.side || '').toUpperCase()  // LONG / SHORT
    const size = Math.abs(parseFloat(p.sizeShort ?? p.sizeLong ?? p.netSize ?? 0)) || 0
    const amtShort = parseFloat(p.amountShort ?? 0)
    const amtLong = parseFloat(p.amountLong ?? 0)
    const gross = amtShort + amtLong   // vorzeichenrichtig: Erlös + (−Kosten)

    let entryPrice, closePrice
    if (side === 'SHORT') {
        entryPrice = size ? Math.abs(amtShort) / size : 0   // bei Eröffnung verkauft
        closePrice = size ? Math.abs(amtLong) / size : 0    // zum Schließen gekauft
    } else {
        entryPrice = size ? Math.abs(amtLong) / size : 0    // bei Eröffnung gekauft
        closePrice = size ? Math.abs(amtShort) / size : 0   // zum Schließen verkauft
    }

    const openMs = parseInt(p.createdTime ?? p.createTime ?? 0) || 0
    const closeMs = parseInt(p.updatedTime ?? p.updateTime ?? 0) || 0
    let tradingFee = 0
    for (const f of (fills || [])) {
        if (cleanPionexSymbol(f.symbol) !== cleanPionexSymbol(p.symbol)) continue
        const ts = parseInt(f.timestamp ?? 0) || 0
        if (openMs && closeMs && (ts < openMs - 3000 || ts > closeMs + 3000)) continue
        if ((f.feeType || 'TRADING') === 'TRADING') tradingFee += Math.abs(parseFloat(f.fee ?? 0))
    }
    const fundingFee = 0   // in historyPositions/fills nicht enthalten; ggf. später ergänzen
    const net = gross - tradingFee + fundingFee

    return {
        ...p,
        positionId,
        symbol: cleanPionexSymbol(p.symbol),
        side,
        positionSide: side,
        entryPrice,
        avgPrice: entryPrice,
        closePrice,
        leverage: parseFloat(p.leverage ?? 0),
        maxQty: size,
        // Felder für createTradeFromClosedPosition (Pionex-Zweig):
        totalRealizedProfit: net,
        totalFee: tradingFee,
        totalFundingFee: fundingFee,
        // Zeitstempel in den vom Frontend gelesenen Namen:
        createTime: openMs,
        updateTime: closeMs,
        ctime: openMs,
        mtime: closeMs,
    }
}

/**
 * Lädt und entschlüsselt die Pionex-Config aus der DB.
 */
async function getDecryptedPionexConfig() {
    const knex = getKnex()
    const config = await knex('pionex_config').where('id', 1).first()
    if (!config) return null
    return {
        ...config,
        apiKey: config.apiKey ? decrypt(config.apiKey) : '',
        secretKey: config.secretKey ? decrypt(config.secretKey) : ''
    }
}

/**
 * Aggregierter Pionex-Kontostand: Spot (alle Coins in USDT) + laufende Bots
 * (marginBalance) + unrealisierter Futures-PnL. Von /balance und
 * /account-overview gemeinsam genutzt.
 */
async function computePionexBalance(apiKey, secretKey) {
    // 1) Spot-Account
    const balResult = await getBalances(apiKey, secretKey)
    const balances = balResult.data?.balances || []
    let spotUsdt = 0, usdtFree = 0
    const breakdown = []
    for (const b of balances) {
        const coin = String(b.coin || '').toUpperCase()
        const free = parseFloat(b.free || 0)
        const frozen = parseFloat(b.frozen || 0)
        const qty = free + frozen
        if (!Number.isFinite(qty) || qty <= 0) continue
        if (coin === 'USDT') {
            spotUsdt += qty; usdtFree = free
            breakdown.push({ coin, qty, price: 1, usdt: qty })
        } else {
            const price = await fetchTickerPrice(`${coin}_USDT`)
            const usdt = qty * price
            spotUsdt += usdt
            breakdown.push({ coin, qty, price, usdt })
        }
    }
    // 2) Laufende Bots: marginBalance = locked "Bot-Wallet"-Wert
    let botEquity = 0
    const runningBots = []
    try {
        const botRes = await getBotOrders(apiKey, secretKey, { status: 'running' })
        for (const o of (botRes.data?.results || [])) {
            const d = o.buOrderData || {}
            const mb = parseFloat(d.marginBalance || 0)
            const inv = parseFloat(d.initQuoteInvestment || 0)
            const gp = parseFloat(d.gridProfit || 0)
            const value = mb > 0 ? mb : (inv + gp)
            botEquity += value
            runningBots.push({ id: o.buOrderId, type: o.buOrderType, value })
        }
    } catch (e) { console.warn(' -> Pionex running bots fail:', e.message) }
    // 3) Futures-Perp unrealisiert
    let futUnrealized = 0
    try {
        const fr = await pionexRequest('GET', '/uapi/v1/account/positions', apiKey, secretKey)
        for (const p of (fr.data?.positions || [])) futUnrealized += parseFloat(p.unrealizedPnL ?? p.unrealizedPnl ?? 0) || 0
    } catch (_) { /* leer ist ok */ }

    const balance = spotUsdt + botEquity + futUnrealized
    return { balance, spotUsdt, botEquity, unrealizedPL: futUnrealized, available: usdtFree, breakdown, runningBots }
}

/**
 * Registriert die Pionex-API-Routen auf der Express-App.
 */
export function setupPionexRoutes(app) {
    // Config lesen (ohne Secret)
    app.get('/api/pionex/config', async (req, res) => {
        try {
            const knex = getKnex()
            const config = await knex('pionex_config').where('id', 1).first()
            if (config) {
                const decryptedApiKey = config.apiKey ? decrypt(config.apiKey) : ''
                res.json({
                    apiKey: decryptedApiKey,
                    hasSecret: !!config.secretKey,
                    apiImportStartDate: config.apiImportStartDate || ''
                })
            } else {
                res.json({ apiKey: '', hasSecret: false, apiImportStartDate: '' })
            }
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Config speichern
    app.post('/api/pionex/config', async (req, res) => {
        try {
            const knex = getKnex()
            const { apiKey, secretKey, apiImportStartDate } = req.body

            const existing = await knex('pionex_config').where('id', 1).first()
            if (existing) {
                const updates = {}
                if (apiKey !== undefined) updates.apiKey = encrypt(apiKey.trim())
                if (secretKey !== undefined) updates.secretKey = encrypt(secretKey.trim())
                if (apiImportStartDate !== undefined) {
                    updates.apiImportStartDate = apiImportStartDate
                    if (apiImportStartDate !== existing.apiImportStartDate) {
                        updates.lastApiImport = 0
                    }
                }
                if (Object.keys(updates).length > 0) {
                    await knex('pionex_config').where('id', 1).update(updates)
                }
            } else {
                await knex('pionex_config').insert({
                    id: 1,
                    apiKey: apiKey ? encrypt(apiKey.trim()) : '',
                    secretKey: secretKey ? encrypt(secretKey.trim()) : '',
                    apiImportStartDate: apiImportStartDate || ''
                })
            }
            res.json({ ok: true })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Verbindung testen
    app.post('/api/pionex/test', async (req, res) => {
        try {
            const config = await getDecryptedPionexConfig()
            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API Key und Secret müssen konfiguriert sein' })
            }
            const result = await testConnection(config.apiKey, config.secretKey)
            res.json({ ok: true, result })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Kontostand = echte Gesamt-Equity in USDT:
    //   Σ Spot-Coins (in USDT umgerechnet via Ticker)
    // + Σ Bot-Margins (marginBalance laufender Bots)
    // + Σ Futures-unrealized (offene Perp-Positionen, falls vorhanden)
    app.get('/api/pionex/balance', async (req, res) => {
        try {
            const config = await getDecryptedPionexConfig()
            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }
            const snap = await computePionexBalance(config.apiKey, config.secretKey)
            res.json({ ok: true, ...snap })
        } catch (error) {
            console.error(' -> Pionex balance error:', error.message)
            res.status(500).json({ error: error.message })
        }
    })

    // Aggregierte Kontoübersicht (Spot + Bots + Futures) für die Konten-Seite.
    // Pionex-API bietet keine Ein-/Auszahlungs-History → Moneyflow nicht verfügbar.
    app.get('/api/pionex/account-overview', async (req, res) => {
        try {
            const config = await getDecryptedPionexConfig()
            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }
            const snap = await computePionexBalance(config.apiKey, config.secretKey)

            // Futures-Wallet-Cash (USDT in Haupt- + isolierten Konten) — getrennt
            // vom Spot-Wallet. computePionexBalance erfasst nur Spot+Bots+uPnL.
            let futCash = 0
            try {
                const fb = await pionexRequest('GET', '/uapi/v1/account/balances', config.apiKey, config.secretKey)
                const acct = fb.data || {}
                const sumUsdt = (arr) => (arr || []).reduce((s, x) => String(x.coin).toUpperCase() === 'USDT' ? s + parseFloat(x.free || 0) + parseFloat(x.frozen || 0) : s, 0)
                futCash = sumUsdt(acct.balances)
                for (const iso of (acct.isolates || [])) futCash += sumUsdt(iso.balances)
            } catch (_) { /* leeres Futures-Wallet ist ok */ }
            const futuresUsd = futCash + snap.unrealizedPL

            const wallets = []
            wallets.push({
                key: 'spot', label: 'Spot', usd: snap.spotUsdt,
                assets: snap.breakdown.map(b => ({ coin: b.coin, amount: b.qty, usd: b.usdt })).sort((a, b) => b.usd - a.usd)
            })
            wallets.push({ key: 'bots', label: 'Trading Bots', usd: snap.botEquity, count: snap.runningBots.length })
            if (futuresUsd) {
                wallets.push({ key: 'futures', label: 'Futures (USDT-M)', usd: futuresUsd, fields: { available: futCash, unrealizedPL: snap.unrealizedPL } })
            }
            const totalUsd = snap.spotUsdt + snap.botEquity + futuresUsd
            res.json({
                ok: true, broker: 'pionex', currency: 'USDT', totalUsd, wallets,
                moneyFlow: { supported: false, reason: 'Pionex-API bietet keine Ein-/Auszahlungs-History.', deposits: [], withdrawals: [] }
            })
        } catch (error) {
            console.error(' -> Pionex account-overview error:', error.message)
            res.status(500).json({ error: error.message })
        }
    })

    // Offene Positionen = laufende Bots + (falls vorhanden) echte Futures-Positionen
    app.get('/api/pionex/open-positions', async (req, res) => {
        try {
            const config = await getDecryptedPionexConfig()
            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }

            // Laufende Bots
            let botPositions = []
            try {
                const botRes = await getBotOrders(config.apiKey, config.secretKey, { status: 'running' })
                const bots = botRes.data?.results || []
                // normalizeRunningBot ist async (holt Live-Marktpreis je Bot)
                botPositions = (await Promise.all(bots.map(normalizeRunningBot))).filter(Boolean)
            } catch (e) { console.warn(' -> Pionex running bots error:', e.message) }

            // Echte Futures-Positionen (für manuelles Futures-Trading)
            let futPositions = []
            try {
                const result = await getOpenPositions(config.apiKey, config.secretKey)
                const raw = result.data?.positions || []
                futPositions = raw.map(normalizeOpenPosition).filter(Boolean)
            } catch (e) { console.warn(' -> Pionex futures positions error:', e.message) }

            const positions = [...botPositions, ...futPositions]
            console.log(` -> Pionex open: ${botPositions.length} Bots + ${futPositions.length} Futures`)
            res.json({ ok: true, positions })
        } catch (error) {
            console.error(' -> Pionex open positions error:', error.message)
            res.status(500).json({ error: error.message })
        }
    })

    // Letzter API-Import-Timestamp
    app.get('/api/pionex/last-import', async (req, res) => {
        try {
            const knex = getKnex()
            const config = await knex('pionex_config').select('lastApiImport').where('id', 1).first()
            res.json({ lastApiImport: config?.lastApiImport || 0 })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    app.post('/api/pionex/last-import', async (req, res) => {
        try {
            const knex = getKnex()
            const { timestamp } = req.body
            await knex('pionex_config').where('id', 1).update({ lastApiImport: timestamp })
            res.json({ ok: true })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Kürzlich geschlossene Positionen (History-Scan für Pendente Trades)
    app.get('/api/pionex/recent-closed', async (req, res) => {
        try {
            const knex = getKnex()
            const config = await getDecryptedPionexConfig()
            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ ok: false, error: 'Pionex API nicht konfiguriert', positions: [], count: 0 })
            }

            const row = await knex('pionex_config').select('lastHistoryScan').where('id', 1).first()
            let startTime = parseInt(row?.lastHistoryScan) || 0
            if (!startTime || startTime < 1000000000000) {
                startTime = Date.now() - (24 * 60 * 60 * 1000)
            }
            const endTime = Date.now()

            // Geschlossene Bots seit letztem Scan → als Positionen normalisieren
            const bots = await fetchAllFinishedBots(config.apiKey, config.secretKey, startTime)
            const positions = bots.map(normalizeBotOrder).filter(Boolean)

            // Geschlossene reguläre Futures-Positionen seit letztem Scan.
            // historyPositions liefert keine Gebühren → Fills je Symbol einmal holen.
            let futCount = 0
            try {
                const hres = await getHistoryPositions(config.apiKey, config.secretKey, { startTime, endTime, limit: 100 })
                const hlist = hres.data?.positions || []
                const futPositions = []
                for (const hp of hlist) {
                    // Fills im Positions-Zeitfenster holen (Pionex lehnt zukünftige
                    // endTime ab → auf "jetzt" deckeln). symbol ist Pflicht.
                    let fills = []
                    try {
                        const fres = await getFills(config.apiKey, config.secretKey, {
                            symbol: hp.symbol,
                            startTime: (parseInt(hp.createdTime) || startTime) - 5000,
                            endTime: Math.min((parseInt(hp.updatedTime) || endTime) + 5000, Date.now()),
                            limit: 100
                        })
                        fills = fres.data?.fills || []
                    } catch (e) { console.warn(` -> Pionex fills error (${hp.symbol}):`, e.message) }
                    const np = normalizeFuturesHistoryPosition(hp, fills)
                    if (np) futPositions.push(np)
                }
                positions.push(...futPositions)
                futCount = futPositions.length
            } catch (e) { console.warn(' -> Pionex futures history error:', e.message) }

            await knex('pionex_config').where('id', 1).update({ lastHistoryScan: endTime })
            console.log(` -> Pionex History-Scan: ${bots.length} geschlossene Bots + ${futCount} Futures`)
            res.json({ ok: true, positions, count: positions.length })
        } catch (error) {
            console.error(' -> Pionex recent closed error:', error.message)
            res.status(500).json({ ok: false, error: error.message, positions: [], count: 0 })
        }
    })

    // Quick-Import: History holen, an Frontend zurückgeben
    app.post('/api/pionex/quick-import', async (req, res) => {
        try {
            const knex = getKnex()
            const config = await getDecryptedPionexConfig()
            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }

            let startTime = config.lastApiImport || 0
            if (!startTime) startTime = Date.now() - (30 * 24 * 60 * 60 * 1000)
            if (config.apiImportStartDate) {
                const minStart = new Date(config.apiImportStartDate).getTime()
                if (minStart > startTime) startTime = minStart
            }
            const endTime = Date.now()

            // Geschlossene Bots ab startTime → als Positionen normalisieren
            const bots = await fetchAllFinishedBots(config.apiKey, config.secretKey, startTime)
            const positions = bots.map(normalizeBotOrder).filter(Boolean)

            await knex('pionex_config').where('id', 1).update({ lastApiImport: endTime })
            res.json({ ok: true, positions, startTime, endTime, count: positions.length })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Einzelne History-Position per positionId (für Close-Erkennung)
    app.get('/api/pionex/position-history/:positionId', async (req, res) => {
        try {
            const config = await getDecryptedPionexConfig()
            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }
            const reqId = String(req.params.positionId)
            // positionId = buOrderId eines Bots → in der finished-Liste suchen.
            let pos = null
            let token = null
            for (let page = 0; page < 30 && !pos; page++) {
                const opts = { status: 'finished', limit: 50 }
                if (token) opts.pageToken = token
                const result = await getBotOrders(config.apiKey, config.secretKey, opts)
                const list = result.data?.results || []
                if (!list.length) break
                const match = list.find(o => String(o.buOrderId) === reqId)
                if (match) { pos = normalizeBotOrder(match); break }
                token = result.data?.nextPageToken
                if (!token) break
            }

            // Nicht in Bots gefunden → reguläre Futures-History durchsuchen
            // (positionId = langer Composite-String). Fills für Gebühren nachladen.
            if (!pos) {
                const lookback = Date.now() - 30 * 24 * 60 * 60 * 1000
                const hres = await getHistoryPositions(config.apiKey, config.secretKey, { startTime: lookback, limit: 100 })
                const match = (hres.data?.positions || []).find(p => String(p.positionId) === reqId)
                if (match) {
                    let fills = []
                    try {
                        const fres = await getFills(config.apiKey, config.secretKey, {
                            symbol: match.symbol,
                            startTime: (parseInt(match.createdTime) || lookback) - 5000,
                            endTime: Math.min((parseInt(match.updatedTime) || Date.now()) + 5000, Date.now()),
                            limit: 100
                        })
                        fills = fres.data?.fills || []
                    } catch (e) { console.warn(' -> Pionex fills error:', e.message) }
                    pos = normalizeFuturesHistoryPosition(match, fills)
                }
            }

            res.json({ ok: true, position: pos })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    console.log(' -> Pionex API routes initialized')
}
