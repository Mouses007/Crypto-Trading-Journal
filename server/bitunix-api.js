import crypto from 'crypto'
import { getKnex } from './database.js'
import { encrypt, decrypt } from './crypto.js'

const BASE_URL = 'https://fapi.bitunix.com'

/**
 * Bitunix API authentication.
 * Sign = SHA256(SHA256(nonce + timestamp + apiKey + queryString + body) + secretKey)
 */
function createSignature(apiKey, secretKey, timestamp, nonce, queryString, body) {
    const digest = crypto.createHash('sha256')
        .update(nonce + timestamp + apiKey + queryString + body)
        .digest('hex')
    const sign = crypto.createHash('sha256')
        .update(digest + secretKey)
        .digest('hex')
    return sign
}

function generateNonce(length = 32) {
    return crypto.randomBytes(length).toString('hex').slice(0, length)
}

/**
 * Make an authenticated request to Bitunix API.
 */
async function bitunixRequest(method, path, apiKey, secretKey, params = {}, body = '') {
    const timestamp = String(Date.now())
    const nonce = generateNonce()

    // Sort params by key (ASCII ascending) per Bitunix docs
    const sortedKeys = Object.keys(params).sort()

    // For signature: keys+values concatenated without separators (e.g. "endTime5678limit100")
    const queryParamsForSign = sortedKeys.map(k => `${k}${params[k]}`).join('')

    // For URL: standard query string format (e.g. "endTime=5678&limit=100")
    const queryStringForUrl = sortedKeys.map(k => `${k}=${params[k]}`).join('&')

    const bodyString = body ? JSON.stringify(body) : ''

    const sign = createSignature(apiKey, secretKey, timestamp, nonce, queryParamsForSign, bodyString)

    const url = queryStringForUrl
        ? `${BASE_URL}${path}?${queryStringForUrl}`
        : `${BASE_URL}${path}`

    const headers = {
        'Content-Type': 'application/json',
        'api-key': apiKey,
        'timestamp': timestamp,
        'nonce': nonce,
        'sign': sign,
        'language': 'en-US'
    }

    const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? bodyString : undefined
    })

    if (!response.ok) {
        throw new Error(`Bitunix API error: ${response.status} ${response.statusText}`)
    }

    return response.json()
}

/**
 * Get historical positions from Bitunix.
 * Returns: symbol, entryPrice, closePrice, maxQty, side (LONG/SHORT), fee, funding, realizedPNL, leverage, ctime, mtime
 */
export async function getHistoryPositions(apiKey, secretKey, options = {}) {
    const params = {}
    if (options.positionId) params.positionId = options.positionId
    if (options.symbol) params.symbol = options.symbol
    if (options.startTime) params.startTime = options.startTime
    if (options.endTime) params.endTime = options.endTime
    params.skip = options.skip || 0
    params.limit = options.limit || 100

    return bitunixRequest('GET', '/api/v1/futures/position/get_history_positions', apiKey, secretKey, params)
}

/**
 * Get currently open (pending) positions from Bitunix.
 * Returns: positionId, symbol, entryPrice, unrealizedPNL, maxQty, side, leverage, markPrice, etc.
 */
export async function getPendingPositions(apiKey, secretKey, options = {}) {
    const params = {}
    if (options.symbol) params.symbol = options.symbol
    if (options.positionId) params.positionId = options.positionId

    return bitunixRequest('GET', '/api/v1/futures/position/get_pending_positions', apiKey, secretKey, params)
}

/**
 * Test API connection by fetching first page of positions.
 */
export async function testConnection(apiKey, secretKey) {
    const result = await getHistoryPositions(apiKey, secretKey, { limit: 1 })
    return result
}

/**
 * Get trade/fill history for a specific position from Bitunix.
 * Returns individual executions: tradeId, orderId, qty, price, fee, side, ctime, roleType
 */
export async function getHistoryTrades(apiKey, secretKey, options = {}) {
    const params = {}
    if (options.positionId) params.positionId = options.positionId
    if (options.symbol) params.symbol = options.symbol
    if (options.orderId) params.orderId = options.orderId
    if (options.startTime) params.startTime = options.startTime
    if (options.endTime) params.endTime = options.endTime
    params.skip = options.skip || 0
    params.limit = options.limit || 100

    return bitunixRequest('GET', '/api/v1/futures/trade/get_history_trades', apiKey, secretKey, params)
}

/**
 * Get pending TP/SL orders for a specific position from Bitunix.
 * Returns: id, positionId, symbol, tpPrice, slPrice, tpQty, slQty, tpStopType, slStopType, etc.
 */
export async function getTpSlOrders(apiKey, secretKey, options = {}) {
    const params = {}
    if (options.positionId) params.positionId = options.positionId
    if (options.symbol) params.symbol = options.symbol
    params.skip = options.skip || 0
    params.limit = options.limit || 100

    return bitunixRequest('GET', '/api/v1/futures/tpsl/get_pending_orders', apiKey, secretKey, params)
}

/**
 * Normalize a single open/pending position from Bitunix API.
 * API may return camelCase or snake_case; we always return camelCase with positionId as string.
 */
function normalizeOpenPosition(p) {
    if (!p) return null
    const positionId = String(p.positionId ?? p.position_id ?? p.id ?? '')
    if (!positionId) return null
    return {
        positionId,
        symbol: p.symbol ?? p.symbolName ?? '',
        side: p.side ?? p.positionSide ?? '',
        entryPrice: p.entryPrice ?? p.avgOpenPrice ?? p.avg_open_price ?? 0,
        avgOpenPrice: p.avgOpenPrice ?? p.avg_open_price ?? p.entryPrice ?? 0,
        leverage: p.leverage ?? 0,
        qty: p.qty ?? p.quantity ?? p.maxQty ?? p.max_qty ?? 0,
        maxQty: p.maxQty ?? p.max_qty ?? p.qty ?? p.quantity ?? 0,
        unrealizedPNL: p.unrealizedPNL ?? p.unrealized_pnl ?? p.unrealizedPnl ?? 0,
        liqPrice: p.liqPrice ?? p.liq_price ?? p.markPrice ?? p.mark_price ?? 0,
        markPrice: p.markPrice ?? p.mark_price ?? p.liqPrice ?? p.liq_price ?? 0,
        ...p
    }
}

/**
 * Load and decrypt Bitunix config from DB.
 */
async function getDecryptedConfig() {
    const knex = getKnex()
    const config = await knex('bitunix_config').where('id', 1).first()
    if (!config) return null
    return {
        ...config,
        apiKey: config.apiKey ? decrypt(config.apiKey) : '',
        secretKey: config.secretKey ? decrypt(config.secretKey) : ''
    }
}

/**
 * Setup Bitunix API routes on Express app.
 */
export function setupBitunixRoutes(app) {

    // Get Bitunix API config
    app.get('/api/bitunix/config', async (req, res) => {
        try {
            const knex = getKnex()
            const config = await knex('bitunix_config').where('id', 1).first()
            if (config) {
                // Decrypt apiKey for display, never expose secretKey
                const decryptedApiKey = config.apiKey ? decrypt(config.apiKey) : ''
                res.json({ apiKey: decryptedApiKey, hasSecret: !!config.secretKey, apiImportStartDate: config.apiImportStartDate || '' })
            } else {
                res.json({ apiKey: '', hasSecret: false, apiImportStartDate: '' })
            }
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Save Bitunix API config
    app.post('/api/bitunix/config', async (req, res) => {
        try {
            const knex = getKnex()
            const { apiKey, secretKey, apiImportStartDate } = req.body

            const existing = await knex('bitunix_config').where('id', 1).first()
            if (existing) {
                const updates = {}
                if (apiKey !== undefined) updates.apiKey = encrypt(apiKey)
                if (secretKey !== undefined) updates.secretKey = encrypt(secretKey)
                if (apiImportStartDate !== undefined) updates.apiImportStartDate = apiImportStartDate
                if (Object.keys(updates).length > 0) {
                    await knex('bitunix_config').where('id', 1).update(updates)
                }
            } else {
                await knex('bitunix_config').insert({
                    id: 1,
                    apiKey: apiKey ? encrypt(apiKey) : '',
                    secretKey: secretKey ? encrypt(secretKey) : '',
                    apiImportStartDate: apiImportStartDate || ''
                })
            }

            res.json({ ok: true })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // ============================================================
    // Backfill: Fix double-counted trading fees on existing Bitunix trades
    //
    // Hintergrund: Vor v2.9.7 hat createTradeFromClosedPosition (Live-Scan)
    // realizedPNL faelschlich als gross interpretiert und tradingFee nochmal
    // abgezogen. Dieser Endpoint laedt die echte Bitunix-History und korrigiert
    // jeden DB-Trade per positionId, sodass:
    //   gross = realizedPNL + |fee|
    //   net   = realizedPNL - funding   (= gross - (|fee| + funding))
    // Tagesaggregate (pAndL) werden aus den korrigierten Einzeltrades neu berechnet.
    // ============================================================
    app.post('/api/bitunix/fix-double-fees', async (req, res) => {
        try {
            const config = await getDecryptedConfig()
            if (!config?.apiKey || !config?.secretKey) {
                return res.status(400).json({ error: 'API-Schluessel nicht konfiguriert.' })
            }
            const knex = getKnex()

            // 1) Komplette Bitunix-History laden (paginiert)
            const bitMap = new Map()
            let skip = 0
            for (let page = 0; page < 60; page++) { // safety cap = 6000 positions
                const r = await getHistoryPositions(config.apiKey, config.secretKey, { skip, limit: 100 })
                if (r.code !== 0) {
                    return res.status(502).json({ error: 'Bitunix API: ' + (r.msg || 'unknown') })
                }
                const list = r.data?.positionList || []
                for (const p of list) bitMap.set(String(p.positionId), p)
                if (list.length < 100) break
                skip += 100
            }
            console.log(` -> Fee-Fix v2.9.7: ${bitMap.size} Bitunix history positions geladen`)

            // 2) DB-Trades durchgehen, matchen, korrigieren
            const dayRows = await knex('trades').where('broker', 'bitunix')
            let daysFixed = 0
            let tradesFixed = 0
            let totalNetDelta = 0
            let unmatched = 0

            for (const row of dayRows) {
                let tradesArr = []
                let pAndLObj = {}
                try { tradesArr = typeof row.trades === 'string' ? JSON.parse(row.trades || '[]') : (row.trades || []) } catch (e) { continue }
                try { pAndLObj = typeof row.pAndL === 'string' ? JSON.parse(row.pAndL || '{}') : (row.pAndL || {}) } catch (e) { pAndLObj = {} }

                let dayChanged = false
                for (const t of tradesArr) {
                    const idStr = String(t.id || '')
                    const parts = idStr.split('_')
                    const posId = parts[parts.length - 1]
                    const b = bitMap.get(posId)
                    if (!b) { unmatched++; continue }

                    const realizedPNL = parseFloat(b.realizedPNL || 0)
                    const tradingFee = Math.abs(parseFloat(b.fee || 0))
                    const fundingFee = parseFloat(b.funding || 0)
                    const fee = tradingFee + fundingFee
                    const newGross = realizedPNL + tradingFee
                    const newNet = newGross - fee  // = realizedPNL - funding
                    const oldNet = parseFloat(t.netProceeds || 0)
                    const delta = newNet - oldNet
                    if (Math.abs(delta) < 0.0001) continue

                    const isGrossWin = newGross > 0
                    const isNetWin = newNet > 0
                    t.grossProceeds = newGross
                    t.netProceeds = newNet
                    t.commission = fee
                    t.tradingFee = tradingFee
                    t.fundingFee = fundingFee
                    t.grossSharePL = newGross
                    t.netSharePL = newNet
                    t.grossWins = isGrossWin ? newGross : 0
                    t.grossLoss = isGrossWin ? 0 : newGross
                    t.netWins = isNetWin ? newNet : 0
                    t.netLoss = isNetWin ? 0 : newNet
                    t.grossWinsCount = isGrossWin ? 1 : 0
                    t.grossLossCount = isGrossWin ? 0 : 1
                    t.netWinsCount = isNetWin ? 1 : 0
                    t.netLossCount = isNetWin ? 0 : 1
                    t.grossSharePLWins = isGrossWin ? newGross : 0
                    t.grossSharePLLoss = isGrossWin ? 0 : newGross
                    t.netSharePLWins = isNetWin ? newNet : 0
                    t.netSharePLLoss = isNetWin ? 0 : newNet
                    t.highGrossSharePLWin = isGrossWin ? newGross : 0
                    t.highGrossSharePLLoss = isGrossWin ? 0 : newGross
                    t.highNetSharePLWin = isNetWin ? newNet : 0
                    t.highNetSharePLLoss = isNetWin ? 0 : newNet

                    totalNetDelta += delta
                    tradesFixed++
                    dayChanged = true
                }

                if (dayChanged) {
                    // pAndL Tagesaggregate aus korrigierten Trades neu berechnen
                    let gp = 0, np = 0, gw = 0, gl = 0, nw = 0, nl = 0
                    let gwc = 0, glc = 0, nwc = 0, nlc = 0, fees = 0, tFee = 0, fFee = 0
                    for (const t of tradesArr) {
                        gp += t.grossProceeds || 0
                        np += t.netProceeds || 0
                        fees += t.commission || 0
                        tFee += t.tradingFee || 0
                        fFee += t.fundingFee || 0
                        if ((t.grossProceeds || 0) > 0) { gw += t.grossProceeds; gwc++ }
                        else if ((t.grossProceeds || 0) < 0) { gl += t.grossProceeds; glc++ }
                        if ((t.netProceeds || 0) > 0) { nw += t.netProceeds; nwc++ }
                        else if ((t.netProceeds || 0) < 0) { nl += t.netProceeds; nlc++ }
                    }
                    pAndLObj.grossProceeds = gp
                    pAndLObj.netProceeds = np
                    pAndLObj.fees = fees
                    pAndLObj.commission = fees
                    pAndLObj.tradingFees = tFee
                    pAndLObj.fundingFees = fFee
                    pAndLObj.grossWins = gw
                    pAndLObj.grossLoss = gl
                    pAndLObj.netWins = nw
                    pAndLObj.netLoss = nl
                    pAndLObj.grossWinsCount = gwc
                    pAndLObj.grossLossCount = glc
                    pAndLObj.netWinsCount = nwc
                    pAndLObj.netLossCount = nlc
                    if (pAndLObj.grossSharePL !== undefined) pAndLObj.grossSharePL = gp
                    if (pAndLObj.netSharePL !== undefined) pAndLObj.netSharePL = np

                    await knex('trades').where('id', row.id).update({
                        trades: JSON.stringify(tradesArr),
                        pAndL: JSON.stringify(pAndLObj)
                    })
                    daysFixed++
                }
            }

            // 3) Settings-Flag setzen
            await knex('settings').where('id', 1).update({ feeFixV297Migrated: 1 }).catch(() => {})

            res.json({
                ok: true,
                bitunixHistoryCount: bitMap.size,
                daysFixed,
                tradesFixed,
                totalNetDelta: Math.round(totalNetDelta * 10000) / 10000,
                unmatched
            })
        } catch (error) {
            console.error(' -> Fee-Fix v2.9.7 error:', error)
            res.status(500).json({ error: error.message })
        }
    })

    // Test Bitunix API connection
    app.post('/api/bitunix/test', async (req, res) => {
        try {
            const config = await getDecryptedConfig()

            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API key and secret not configured' })
            }

            const result = await testConnection(config.apiKey, config.secretKey)
            res.json({ ok: true, result })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Fetch history positions (proxy)
    app.get('/api/bitunix/positions', async (req, res) => {
        try {
            const config = await getDecryptedConfig()

            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API key and secret not configured' })
            }

            const options = {}
            if (req.query.startTime) options.startTime = req.query.startTime
            if (req.query.endTime) options.endTime = req.query.endTime
            if (req.query.symbol) options.symbol = req.query.symbol
            if (req.query.skip) options.skip = parseInt(req.query.skip)
            if (req.query.limit) options.limit = parseInt(req.query.limit)

            const result = await getHistoryPositions(config.apiKey, config.secretKey, options)
            res.json(result)
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Get last API import timestamp
    app.get('/api/bitunix/last-import', async (req, res) => {
        try {
            const knex = getKnex()
            const config = await knex('bitunix_config').select('lastApiImport').where('id', 1).first()
            res.json({ lastApiImport: config?.lastApiImport || 0 })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Set last API import timestamp
    app.post('/api/bitunix/last-import', async (req, res) => {
        try {
            const knex = getKnex()
            const { timestamp } = req.body
            await knex('bitunix_config').where('id', 1).update({ lastApiImport: timestamp })
            res.json({ ok: true })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Fetch recently closed positions (for Pendente Trades history scan)
    app.get('/api/bitunix/recent-closed', async (req, res) => {
        try {
            const knex = getKnex()
            const config = await getDecryptedConfig()

            if (!config || !config.apiKey || !config.secretKey) {
                return res.json({ ok: true, positions: [], count: 0 })
            }

            // Read lastHistoryScan timestamp (PostgreSQL returns bigint as string)
            const row = await knex('bitunix_config').select('lastHistoryScan').where('id', 1).first()
            let startTime = parseInt(row?.lastHistoryScan) || 0

            // Default: look back 24 hours on first run
            if (!startTime || startTime < 1000000000000) {
                startTime = Date.now() - (24 * 60 * 60 * 1000)
            }
            const endTime = Date.now()

            console.log(` -> History-Scan: startTime=${startTime} (${new Date(startTime).toISOString()}), endTime=${endTime}`)

            // Fetch all pages
            let allPositions = []
            let skip = 0
            let hasMore = true

            while (hasMore) {
                const result = await getHistoryPositions(config.apiKey, config.secretKey, {
                    startTime, endTime, skip, limit: 100
                })

                if (result.code !== 0) {
                    throw new Error(result.msg || 'Bitunix API Fehler')
                }

                const positions = result.data?.positionList || []
                allPositions = allPositions.concat(positions)

                if (positions.length < 100) {
                    hasMore = false
                } else {
                    skip += 100
                }
            }

            // Update lastHistoryScan
            await knex('bitunix_config').where('id', 1).update({ lastHistoryScan: endTime })

            console.log(` -> History-Scan: ${allPositions.length} geschlossene Positionen seit ${new Date(startTime).toISOString()}`)
            res.json({ ok: true, positions: allPositions, count: allPositions.length })
        } catch (error) {
            console.error(' -> Recent closed positions error:', error.message)
            res.json({ ok: false, error: error.message, positions: [], count: 0 })
        }
    })

    // Quick API import: fetch, process, and save trades in one call
    app.post('/api/bitunix/quick-import', async (req, res) => {
        try {
            const knex = getKnex()
            const config = await getDecryptedConfig()

            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert. Bitte zuerst in den Einstellungen hinterlegen.' })
            }

            // Determine start time
            let startTime = config.lastApiImport || 0
            if (!startTime) {
                // Default: 30 days ago
                startTime = Date.now() - (30 * 24 * 60 * 60 * 1000)
            }

            // Enforce minimum start date if configured
            if (config.apiImportStartDate) {
                const minStart = new Date(config.apiImportStartDate).getTime()
                if (minStart > startTime) {
                    startTime = minStart
                }
            }
            const endTime = Date.now()

            // Fetch all pages of positions
            let allPositions = []
            let skip = 0
            let hasMore = true

            while (hasMore) {
                const result = await getHistoryPositions(config.apiKey, config.secretKey, {
                    startTime, endTime, skip, limit: 100
                })

                if (result.code !== 0) {
                    throw new Error(result.msg || 'Bitunix API Fehler')
                }

                const positions = result.data?.positionList || []
                allPositions = allPositions.concat(positions)

                if (positions.length < 100) {
                    hasMore = false
                } else {
                    skip += 100
                }
            }

            // Update last import timestamp
            await knex('bitunix_config').where('id', 1).update({ lastApiImport: endTime })

            res.json({
                ok: true,
                positions: allPositions,
                startTime,
                endTime,
                count: allPositions.length
            })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Fetch open/pending positions (proxy)
    app.get('/api/bitunix/open-positions', async (req, res) => {
        try {
            const config = await getDecryptedConfig()

            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }

            const result = await getPendingPositions(config.apiKey, config.secretKey, {})

            console.log(' -> Bitunix pending positions raw response:', JSON.stringify(result).substring(0, 500))

            if (result.code !== 0) {
                throw new Error(result.msg || 'Bitunix API Fehler')
            }

            // Pending positions API: data is directly an array (unlike history where it's data.positionList)
            const raw = Array.isArray(result.data) ? result.data : (result.data?.positionList || [])
            const positions = raw.map(normalizeOpenPosition).filter(Boolean)

            console.log(` -> Bitunix open positions fetched: ${positions.length}`)
            res.json({ ok: true, positions })
        } catch (error) {
            console.error(' -> Bitunix open positions error:', error.message)
            res.status(500).json({ error: error.message })
        }
    })

    // Get specific historical position by positionId (for close detection)
    app.get('/api/bitunix/position-history/:positionId', async (req, res) => {
        try {
            const config = await getDecryptedConfig()

            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }

            const result = await getHistoryPositions(config.apiKey, config.secretKey, {
                positionId: req.params.positionId, limit: 1
            })

            if (result.code !== 0) {
                throw new Error(result.msg || 'Bitunix API Fehler')
            }

            const positions = result.data?.positionList || []
            const pos = positions[0] || null
            if (pos) {
                console.log(` -> History position ${pos.symbol}: side=${pos.side}, entryPrice=${pos.entryPrice}, closePrice=${pos.closePrice}, realizedPNL=${pos.realizedPNL}`)
            }
            res.json({ ok: true, position: pos })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Get individual trade fills for a position (for compound tracking)
    app.get('/api/bitunix/position-trades/:positionId', async (req, res) => {
        try {
            const config = await getDecryptedConfig()

            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }

            const result = await getHistoryTrades(config.apiKey, config.secretKey, {
                positionId: req.params.positionId, limit: 100
            })

            if (result.code !== 0) {
                throw new Error(result.msg || 'Bitunix API Fehler')
            }

            const trades = result.data?.tradeList || []
            console.log(` -> Position trades for ${req.params.positionId}: ${trades.length} fills`)
            res.json({ ok: true, trades })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Fetch TP/SL orders for a specific position
    app.get('/api/bitunix/position-tpsl/:positionId', async (req, res) => {
        try {
            const config = await getDecryptedConfig()

            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }

            const result = await getTpSlOrders(config.apiKey, config.secretKey, {
                positionId: req.params.positionId, limit: 100
            })

            if (result.code !== 0) {
                throw new Error(result.msg || 'Bitunix API Fehler')
            }

            // Response structure may vary — try common patterns
            const allOrders = result.data?.orderList || result.data || []
            const ordersArr = Array.isArray(allOrders) ? allOrders : []
            // Bitunix API may return ALL pending orders — filter by positionId
            const posId = String(req.params.positionId)
            const orders = ordersArr.filter(o =>
                String(o.positionId || o.position_id || '') === posId
            )
            console.log(` -> TP/SL orders for ${posId}: ${orders.length} matched (${ordersArr.length} total)`)
            res.json({ ok: true, orders })
        } catch (error) {
            console.error(' -> TP/SL orders error:', error.message)
            res.status(500).json({ error: error.message })
        }
    })

    // Get account balance from Bitunix API
    app.get('/api/bitunix/balance', async (req, res) => {
        try {
            const config = await getDecryptedConfig()
            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }

            const result = await bitunixRequest('GET', '/api/v1/futures/account', config.apiKey, config.secretKey, { marginCoin: 'USDT' })
            console.log(' -> Bitunix account raw:', JSON.stringify(result).substring(0, 500))

            if (result.code !== 0) {
                return res.status(400).json({ error: result.msg || 'Bitunix API Fehler' })
            }

            const accountData = result.data
            if (!accountData) {
                return res.json({ ok: true, balance: 0 })
            }
            // Handle both array and single object response
            const account = Array.isArray(accountData) ? accountData[0] : accountData
            if (!account) {
                return res.json({ ok: true, balance: 0 })
            }

            const available = parseFloat(account.available || 0)
            const margin = parseFloat(account.margin || 0)
            const crossUnrealizedPNL = parseFloat(account.crossUnrealizedPNL || 0)
            const isolationUnrealizedPNL = parseFloat(account.isolationUnrealizedPNL || 0)
            // Bitunix vergibt Futures-Boni (Promo/Referral), die in `available`
            // mitgezaehlt werden, aber KEINE Trading-PnL sind. Wuerde der Bonus
            // mit in die Start-Einzahlungs-Kalibrierung wandern, waere das
            // Dashboard um den Bonusbetrag dauerhaft zu niedrig vs. Wallet.
            // → Bonus separat ausweisen, balance-Feld zaehlt nur echtes Equity.
            const bonus = parseFloat(account.bonus || 0)
            const balance = available + margin + crossUnrealizedPNL + isolationUnrealizedPNL - bonus

            res.json({ ok: true, balance, available, margin, crossUnrealizedPNL, isolationUnrealizedPNL, bonus })
        } catch (error) {
            console.error(' -> Bitunix balance error:', error.message)
            res.status(500).json({ error: error.message })
        }
    })

    // Aggregierte Kontoübersicht für die Konten-Seite. Bitunix bietet nur die
    // Futures-API (fapi) — kein Spot, keine Ein-/Auszahlungs-History.
    app.get('/api/bitunix/account-overview', async (req, res) => {
        try {
            const config = await getDecryptedConfig()
            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }
            const wallets = []
            try {
                const result = await bitunixRequest('GET', '/api/v1/futures/account', config.apiKey, config.secretKey, { marginCoin: 'USDT' })
                const account = Array.isArray(result.data) ? result.data[0] : result.data
                if (account) {
                    const available = parseFloat(account.available || 0)
                    const margin = parseFloat(account.margin || 0)
                    const unrealizedPL = parseFloat(account.crossUnrealizedPNL || 0) + parseFloat(account.isolationUnrealizedPNL || 0)
                    const bonus = parseFloat(account.bonus || 0)
                    const usd = available + margin + unrealizedPL - bonus
                    wallets.push({ key: 'futures', label: 'Futures (USDT-M)', usd, fields: { available, margin, unrealizedPL, bonus } })
                }
            } catch (e) { console.warn(' -> Bitunix overview futures:', e.message) }

            const totalUsd = wallets.reduce((s, w) => s + (w.usd || 0), 0)
            res.json({
                ok: true, broker: 'bitunix', currency: 'USDT', totalUsd, wallets,
                moneyFlow: { supported: false, reason: 'Bitunix Futures-API liefert keine Spot-/Ein-/Auszahlungsdaten.', deposits: [], withdrawals: [] }
            })
        } catch (error) {
            console.error(' -> Bitunix account-overview error:', error.message)
            res.status(500).json({ error: error.message })
        }
    })

    console.log(' -> Bitunix API routes initialized')
}
