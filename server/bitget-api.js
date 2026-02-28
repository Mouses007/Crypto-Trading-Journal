import crypto from 'crypto'
import { getKnex } from './database.js'
import { encrypt, decrypt } from './crypto.js'

const BASE_URL = 'https://api.bitget.com'

/**
 * Bitget API authentication (HMAC-SHA256 + Base64).
 * Prehash: timestamp + method + requestPath [+ "?" + queryString] [+ body]
 * Signature: HMAC-SHA256(prehash, secretKey) → Base64
 */
function createSignature(secretKey, timestamp, method, requestPath, queryString, body) {
    let prehash = timestamp + method.toUpperCase() + requestPath
    if (queryString) prehash += '?' + queryString
    if (body) prehash += body

    const hmac = crypto.createHmac('sha256', secretKey)
        .update(prehash)
        .digest('base64')
    return hmac
}

/**
 * Make an authenticated request to Bitget API.
 * IMPORTANT: Bitget requires the signature prehash to use UNESCAPED query string values,
 * matching their official SDK's unescapedStringify() approach.
 */
async function bitgetRequest(method, path, apiKey, secretKey, passphrase, params = {}, body = null) {
    const timestamp = String(Date.now())

    // Sort keys alphabetically (required by Bitget)
    const sortedKeys = Object.keys(params).sort()

    // For signature: use UNESCAPED query string (key=value without encodeURIComponent)
    // This matches the official Bitget SDK's unescapedStringify() function
    const signQueryString = sortedKeys.map(k => `${k}=${params[k]}`).join('&')

    // For URL: also use unescaped (Bitget values like "USDT-FUTURES" don't need encoding)
    const urlQueryString = signQueryString

    const bodyString = (body && method !== 'GET') ? JSON.stringify(body) : ''

    const sign = createSignature(secretKey, timestamp, method, path, signQueryString, bodyString)

    const url = urlQueryString
        ? `${BASE_URL}${path}?${urlQueryString}`
        : `${BASE_URL}${path}`

    const headers = {
        'Content-Type': 'application/json',
        'ACCESS-KEY': apiKey,
        'ACCESS-SIGN': sign,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': passphrase,
        'locale': 'en-US'
    }

    const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? bodyString || undefined : undefined
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
        const msg = data ? `[${data.code}] ${data.msg}` : `${response.status} ${response.statusText}`
        throw new Error(`Bitget API: ${msg}`)
    }

    // Bitget success code: "00000"
    if (data && data.code && data.code !== '00000') {
        throw new Error(`Bitget API: [${data.code}] ${data.msg || 'Unknown error'}`)
    }

    return data
}

/**
 * Get historical positions from Bitget (USDT-M Futures).
 * Endpoint: GET /api/v2/mix/position/history-position
 * Returns: positionId, symbol, holdSide, openAvgPrice, closeAvgPrice,
 *          openTotalPos, closeTotalPos, pnl, netProfit, openFee, closeFee,
 *          totalFunding, marginMode, ctime, utime
 */
export async function getHistoryPositions(apiKey, secretKey, passphrase, options = {}) {
    const params = { productType: 'USDT-FUTURES' }
    if (options.symbol) params.symbol = options.symbol
    if (options.startTime) params.startTime = options.startTime
    if (options.endTime) params.endTime = options.endTime
    if (options.limit) params.limit = options.limit
    if (options.idLessThan) params.idLessThan = options.idLessThan

    return bitgetRequest('GET', '/api/v2/mix/position/history-position', apiKey, secretKey, passphrase, params)
}

/**
 * Get currently open positions from Bitget (USDT-M Futures).
 * Endpoint: GET /api/v2/mix/position/all-position
 * Returns: positionId, symbol, holdSide, openAvgPrice, total, available,
 *          unrealizedPL, leverage, liquidationPrice, marginMode, ctime, utime
 */
export async function getCurrentPositions(apiKey, secretKey, passphrase, options = {}) {
    const params = { productType: 'USDT-FUTURES' }
    if (options.marginCoin) params.marginCoin = options.marginCoin

    return bitgetRequest('GET', '/api/v2/mix/position/all-position', apiKey, secretKey, passphrase, params)
}

/**
 * Get order fills (individual trades) for a position from Bitget.
 * Endpoint: GET /api/v2/mix/order/fills
 * Returns: fillList with tradeId, orderId, symbol, side, price, size, fee, ctime etc.
 */
export async function getOrderFills(apiKey, secretKey, passphrase, options = {}) {
    const params = { productType: 'USDT-FUTURES' }
    if (options.symbol) params.symbol = options.symbol
    if (options.orderId) params.orderId = options.orderId
    if (options.startTime) params.startTime = options.startTime
    if (options.endTime) params.endTime = options.endTime
    if (options.limit) params.limit = String(options.limit)
    if (options.idLessThan) params.idLessThan = options.idLessThan

    return bitgetRequest('GET', '/api/v2/mix/order/fills', apiKey, secretKey, passphrase, params)
}

/**
 * Get pending TP/SL plan orders from Bitget.
 * Endpoint: GET /api/v2/mix/order/orders-plan-pending
 * Returns: entrustedList with orderId, symbol, planType (profit_plan, loss_plan),
 *          triggerPrice, triggerType, size, side, etc.
 */
export async function getPlanOrders(apiKey, secretKey, passphrase, options = {}) {
    const params = { productType: 'USDT-FUTURES' }
    if (options.symbol) params.symbol = options.symbol
    if (options.planType) params.planType = options.planType
    if (options.limit) params.limit = String(options.limit)

    return bitgetRequest('GET', '/api/v2/mix/order/orders-plan-pending', apiKey, secretKey, passphrase, params)
}

/**
 * Test API connection with diagnostics.
 * Tests multiple scenarios to give the user a clear error message.
 */
export async function testConnection(apiKey, secretKey, passphrase) {
    // First: try a simple authenticated request
    try {
        const result = await getHistoryPositions(apiKey, secretKey, passphrase, { limit: 1 })
        return result
    } catch (error) {
        const errMsg = error.message || ''

        // If 40012: could be IP restriction, wrong credentials, or permissions
        // Do a diagnostic: try with paptrading header to see if signature is accepted
        if (errMsg.includes('40012')) {
            try {
                const timestamp = String(Date.now())
                const method = 'GET'
                const path = '/api/v2/mix/position/history-position'
                const params = { limit: '1', productType: 'USDT-FUTURES' }
                const sortedKeys = Object.keys(params).sort()
                const queryString = sortedKeys.map(k => `${k}=${params[k]}`).join('&')
                const prehash = timestamp + method + path + '?' + queryString
                const sign = crypto.createHmac('sha256', secretKey).update(prehash).digest('base64')
                const url = `${BASE_URL}${path}?${queryString}`

                const diagResponse = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'ACCESS-KEY': apiKey,
                        'ACCESS-SIGN': sign,
                        'ACCESS-TIMESTAMP': timestamp,
                        'ACCESS-PASSPHRASE': passphrase,
                        'locale': 'en-US',
                        'paptrading': '1'
                    }
                })
                const diagData = await diagResponse.json().catch(() => null)

                // If we get 40099 instead of 40012, signature IS valid but environment wrong
                // This means credentials are correct but there's an IP/permission issue
                if (diagData && diagData.code === '40099') {
                    throw new Error('Signatur ist korrekt, aber der API-Key wird abgelehnt. ' +
                        'Wahrscheinlich ist deine IP-Adresse nicht in der API-Key-Whitelist auf Bitget eingetragen. ' +
                        'Gehe zu Bitget → API Management → bearbeite den Key → entferne die IP-Beschränkung oder füge deine Server-IP hinzu.')
                }
            } catch (diagError) {
                // If diag error is our custom message, throw it
                if (diagError.message.includes('Signatur ist korrekt')) {
                    throw diagError
                }
            }
            // If diagnostic didn't help, throw original error with hint
            throw new Error('API Key, Secret oder Passphrase sind falsch, oder IP-Whitelist blockiert den Zugriff. ' +
                'Prüfe: 1) Credentials korrekt kopiert? 2) HMAC als Verschlüsselung gewählt? 3) IP-Whitelist deaktiviert oder Server-IP eingetragen?')
        }
        throw error
    }
}

/**
 * Normalize a single open position from Bitget API to the format expected by the frontend.
 * Bitget uses: holdSide, openAvgPrice, total, unrealizedPL, liquidationPrice, etc.
 * We normalize to: positionId, symbol, side, entryPrice, qty, unrealizedPNL, markPrice, leverage
 */
function normalizeOpenPosition(p) {
    if (!p) return null
    const positionId = String(p.positionId ?? p.id ?? '')
    if (!positionId) return null

    // Bitget holdSide: 'long' or 'short' → normalize to 'LONG'/'SHORT'
    const side = (p.holdSide || '').toUpperCase()

    return {
        positionId,
        symbol: p.symbol ?? '',
        side: side,
        entryPrice: p.openAvgPrice ?? p.averageOpenPrice ?? 0,
        avgOpenPrice: p.openAvgPrice ?? p.averageOpenPrice ?? 0,
        leverage: p.leverage ?? 0,
        qty: p.total ?? p.available ?? 0,
        maxQty: p.total ?? p.available ?? 0,
        unrealizedPNL: p.unrealizedPL ?? 0,
        liqPrice: p.liquidationPrice ?? 0,
        markPrice: p.markPrice ?? p.liquidationPrice ?? 0,
        ctime: p.ctime ?? p.cTime ?? '',
        mtime: p.utime ?? p.uTime ?? '',
        ...p
    }
}

/**
 * Load and decrypt Bitget config from DB.
 */
async function getDecryptedBitgetConfig() {
    const knex = getKnex()
    const config = await knex('bitget_config').where('id', 1).first()
    if (!config) return null
    return {
        ...config,
        apiKey: config.apiKey ? decrypt(config.apiKey) : '',
        secretKey: config.secretKey ? decrypt(config.secretKey) : '',
        passphrase: config.passphrase ? decrypt(config.passphrase) : ''
    }
}

/**
 * Setup Bitget API routes on Express app.
 */
export function setupBitgetRoutes(app) {
    // Get Bitget config (sans secret)
    app.get('/api/bitget/config', async (req, res) => {
        try {
            const knex = getKnex()
            const config = await knex('bitget_config').where('id', 1).first()
            if (config) {
                const decryptedApiKey = config.apiKey ? decrypt(config.apiKey) : ''
                res.json({
                    apiKey: decryptedApiKey,
                    hasSecret: !!config.secretKey,
                    hasPassphrase: !!config.passphrase,
                    apiImportStartDate: config.apiImportStartDate || ''
                })
            } else {
                res.json({ apiKey: '', hasSecret: false, hasPassphrase: false, apiImportStartDate: '' })
            }
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Save Bitget config
    app.post('/api/bitget/config', async (req, res) => {
        try {
            const knex = getKnex()
            const { apiKey, secretKey, passphrase, apiImportStartDate } = req.body

            const existing = await knex('bitget_config').where('id', 1).first()
            if (existing) {
                const updates = {}
                if (apiKey !== undefined) updates.apiKey = encrypt(apiKey.trim())
                if (secretKey !== undefined) updates.secretKey = encrypt(secretKey.trim())
                if (passphrase !== undefined) updates.passphrase = encrypt(passphrase.trim())
                if (apiImportStartDate !== undefined) {
                    updates.apiImportStartDate = apiImportStartDate
                    // Reset lastApiImport so next quick-import fetches from the new start date
                    if (apiImportStartDate !== existing.apiImportStartDate) {
                        updates.lastApiImport = 0
                    }
                }
                if (Object.keys(updates).length > 0) {
                    await knex('bitget_config').where('id', 1).update(updates)
                }
            } else {
                await knex('bitget_config').insert({
                    id: 1,
                    apiKey: apiKey ? encrypt(apiKey.trim()) : '',
                    secretKey: secretKey ? encrypt(secretKey.trim()) : '',
                    passphrase: passphrase ? encrypt(passphrase.trim()) : '',
                    apiImportStartDate: apiImportStartDate || ''
                })
            }

            res.json({ ok: true })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Test Bitget connection
    app.post('/api/bitget/test', async (req, res) => {
        try {
            const config = await getDecryptedBitgetConfig()

            if (!config || !config.apiKey || !config.secretKey || !config.passphrase) {
                return res.status(400).json({ error: 'API Key, Secret und Passphrase müssen konfiguriert sein' })
            }

            const result = await testConnection(config.apiKey, config.secretKey, config.passphrase)
            res.json({ ok: true, result })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // ==================== NEW ENDPOINTS (analog to bitunix) ====================

    // Fetch history positions with date range (for manual API import)
    app.get('/api/bitget/positions', async (req, res) => {
        try {
            const config = await getDecryptedBitgetConfig()

            if (!config || !config.apiKey || !config.secretKey || !config.passphrase) {
                return res.status(400).json({ code: -1, msg: 'API-Schlüssel nicht konfiguriert.' })
            }

            const options = {}
            if (req.query.startTime) options.startTime = req.query.startTime
            if (req.query.endTime) options.endTime = req.query.endTime
            if (req.query.limit) options.limit = parseInt(req.query.limit)
            if (req.query.idLessThan) options.idLessThan = req.query.idLessThan

            // Paginate through all results using cursor-based pagination
            let allPositions = []
            let hasMore = true
            let cursor = null

            while (hasMore) {
                const opts = { ...options, limit: 100 }
                if (cursor) opts.idLessThan = cursor

                const result = await getHistoryPositions(config.apiKey, config.secretKey, config.passphrase, opts)
                const positions = result.data?.list || []
                allPositions = allPositions.concat(positions)

                if (positions.length < 100) {
                    hasMore = false
                } else {
                    // Use last position's ID as cursor for next page
                    cursor = positions[positions.length - 1].positionId
                }
            }

            // Return in same format as Bitunix for compatibility
            res.json({ code: 0, data: { positionList: allPositions } })
        } catch (error) {
            console.error(' -> Bitget positions error:', error.message)
            res.status(500).json({ code: -1, msg: error.message })
        }
    })

    // Fetch open/current positions
    app.get('/api/bitget/open-positions', async (req, res) => {
        try {
            const config = await getDecryptedBitgetConfig()

            if (!config || !config.apiKey || !config.secretKey || !config.passphrase) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }

            const result = await getCurrentPositions(config.apiKey, config.secretKey, config.passphrase)

            console.log(' -> Bitget open positions raw response:', JSON.stringify(result).substring(0, 500))

            // Bitget all-position: data is an array of position objects
            const raw = Array.isArray(result.data) ? result.data : []
            const positions = raw.map(normalizeOpenPosition).filter(Boolean)

            console.log(` -> Bitget open positions fetched: ${positions.length}`)
            res.json({ ok: true, positions })
        } catch (error) {
            console.error(' -> Bitget open positions error:', error.message)
            res.status(500).json({ error: error.message })
        }
    })

    // Get last API import timestamp
    app.get('/api/bitget/last-import', async (req, res) => {
        try {
            const knex = getKnex()
            const config = await knex('bitget_config').select('lastApiImport').where('id', 1).first()
            res.json({ lastApiImport: config?.lastApiImport || 0 })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Set last API import timestamp
    app.post('/api/bitget/last-import', async (req, res) => {
        try {
            const knex = getKnex()
            const { timestamp } = req.body
            await knex('bitget_config').where('id', 1).update({ lastApiImport: timestamp })
            res.json({ ok: true })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Fetch recently closed positions (for Pendente Trades history scan)
    app.get('/api/bitget/recent-closed', async (req, res) => {
        try {
            const knex = getKnex()
            const config = await getDecryptedBitgetConfig()

            if (!config || !config.apiKey || !config.secretKey || !config.passphrase) {
                return res.status(400).json({ ok: false, error: 'Bitget API nicht konfiguriert', positions: [], count: 0 })
            }

            // Read lastHistoryScan timestamp
            const row = await knex('bitget_config').select('lastHistoryScan').where('id', 1).first()
            let startTime = parseInt(row?.lastHistoryScan) || 0

            // Default: look back 24 hours on first run
            if (!startTime || startTime < 1000000000000) {
                startTime = Date.now() - (24 * 60 * 60 * 1000)
            }
            const endTime = Date.now()

            console.log(` -> Bitget History-Scan: startTime=${startTime} (${new Date(startTime).toISOString()}), endTime=${endTime}`)

            // Fetch all pages using idLessThan pagination (Bitget uses cursor-based pagination)
            let allPositions = []
            let idLessThan = null
            let hasMore = true

            while (hasMore) {
                const opts = { startTime, endTime, limit: 100 }
                if (idLessThan) opts.idLessThan = idLessThan

                const result = await getHistoryPositions(config.apiKey, config.secretKey, config.passphrase, opts)

                const positions = result.data?.list || []
                allPositions = allPositions.concat(positions)

                if (positions.length < 100) {
                    hasMore = false
                } else {
                    // Use last position's positionId for cursor pagination
                    idLessThan = positions[positions.length - 1]?.positionId
                    if (!idLessThan) hasMore = false
                }
            }

            // Update lastHistoryScan
            await knex('bitget_config').where('id', 1).update({ lastHistoryScan: endTime })

            console.log(` -> Bitget History-Scan: ${allPositions.length} geschlossene Positionen seit ${new Date(startTime).toISOString()}`)
            res.json({ ok: true, positions: allPositions, count: allPositions.length })
        } catch (error) {
            console.error(' -> Bitget recent closed positions error:', error.message)
            res.status(500).json({ ok: false, error: error.message || 'Bitget History-Scan fehlgeschlagen', positions: [], count: 0 })
        }
    })

    // Quick API import: fetch history, return positions for frontend processing
    app.post('/api/bitget/quick-import', async (req, res) => {
        try {
            const knex = getKnex()
            const config = await getDecryptedBitgetConfig()

            if (!config || !config.apiKey || !config.secretKey || !config.passphrase) {
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

            // Fetch all pages of historical positions (cursor-based pagination)
            let allPositions = []
            let idLessThan = null
            let hasMore = true

            while (hasMore) {
                const opts = { startTime, endTime, limit: 100 }
                if (idLessThan) opts.idLessThan = idLessThan

                const result = await getHistoryPositions(config.apiKey, config.secretKey, config.passphrase, opts)

                const positions = result.data?.list || []
                allPositions = allPositions.concat(positions)

                if (positions.length < 100) {
                    hasMore = false
                } else {
                    idLessThan = positions[positions.length - 1]?.positionId
                    if (!idLessThan) hasMore = false
                }
            }

            // Update last import timestamp
            await knex('bitget_config').where('id', 1).update({ lastApiImport: endTime })

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

    // Get specific historical position by positionId (for close detection)
    app.get('/api/bitget/position-history/:positionId', async (req, res) => {
        try {
            const config = await getDecryptedBitgetConfig()

            if (!config || !config.apiKey || !config.secretKey || !config.passphrase) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }

            // Bitget history-position doesn't support positionId filter directly,
            // so we fetch recent history and filter client-side (paginated)
            let pos = null
            let endTime = ''
            for (let page = 0; page < 10 && !pos; page++) {
                const params = { limit: 100 }
                if (endTime) params.endTime = endTime
                const result = await getHistoryPositions(config.apiKey, config.secretKey, config.passphrase, params)
                const list = result.data?.list || []
                if (!list.length) break
                pos = list.find(p => String(p.positionId) === String(req.params.positionId)) || null
                endTime = list[list.length - 1].cTime || list[list.length - 1].ctime || ''
                if (!endTime) break
            }

            if (pos) {
                console.log(` -> Bitget history position ${pos.symbol}: side=${pos.holdSide}, openAvgPrice=${pos.openAvgPrice}, closeAvgPrice=${pos.closeAvgPrice}, pnl=${pos.pnl}`)
            }
            res.json({ ok: true, position: pos })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Get order fills (individual trades) for a position
    app.get('/api/bitget/position-trades/:symbol', async (req, res) => {
        try {
            const config = await getDecryptedBitgetConfig()
            if (!config || !config.apiKey || !config.secretKey || !config.passphrase) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }

            const symbol = req.params.symbol
            // Fetch fills for this symbol (last 7 days by default)
            const startTime = req.query.startTime || String(Date.now() - 7 * 24 * 60 * 60 * 1000)
            const result = await getOrderFills(config.apiKey, config.secretKey, config.passphrase, {
                symbol,
                startTime,
                limit: 100
            })

            const fills = result.data?.fillList || []
            console.log(` -> Bitget fills for ${symbol}: ${fills.length} fills`)
            res.json({ ok: true, trades: fills })
        } catch (error) {
            console.error(' -> Bitget fills error:', error.message)
            res.status(500).json({ error: error.message })
        }
    })

    // Get pending TP/SL plan orders for a symbol
    app.get('/api/bitget/position-tpsl/:symbol', async (req, res) => {
        try {
            const config = await getDecryptedBitgetConfig()
            if (!config || !config.apiKey || !config.secretKey || !config.passphrase) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }

            const symbol = req.params.symbol
            const result = await getPlanOrders(config.apiKey, config.secretKey, config.passphrase, {
                symbol,
                limit: 100
            })

            const orders = result.data?.entrustedList || []
            console.log(` -> Bitget TP/SL for ${symbol}: ${orders.length} orders`)

            // Map to unified format (similar to Bitunix response)
            const mapped = orders.map(o => ({
                orderId: o.orderId,
                symbol: o.symbol,
                planType: o.planType, // profit_plan, loss_plan, pos_profit, pos_loss
                triggerPrice: o.triggerPrice,
                size: o.size,
                side: o.side,
                // Map to tpPrice/slPrice for frontend compatibility
                tpPrice: (o.planType === 'profit_plan' || o.planType === 'pos_profit') ? o.triggerPrice : null,
                slPrice: (o.planType === 'loss_plan' || o.planType === 'pos_loss') ? o.triggerPrice : null,
                tpQty: (o.planType === 'profit_plan' || o.planType === 'pos_profit') ? o.size : null,
                slQty: (o.planType === 'loss_plan' || o.planType === 'pos_loss') ? o.size : null,
            }))

            res.json({ ok: true, orders: mapped })
        } catch (error) {
            console.error(' -> Bitget TP/SL error:', error.message)
            res.status(500).json({ error: error.message })
        }
    })

    // Get account balance from Bitget API
    app.get('/api/bitget/balance', async (req, res) => {
        try {
            const config = await getDecryptedBitgetConfig()
            if (!config || !config.apiKey || !config.secretKey || !config.passphrase) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }

            const result = await bitgetRequest('GET', '/api/v2/mix/account/accounts', config.apiKey, config.secretKey, config.passphrase, { productType: 'USDT-FUTURES' })

            if (String(result.code) !== '00000') {
                return res.status(400).json({ error: result.msg || 'Bitget API Fehler' })
            }

            const accounts = result.data || []
            if (!Array.isArray(accounts) || accounts.length === 0) {
                return res.json({ ok: true, balance: 0 })
            }

            // Find USDT account
            const usdtAccount = accounts.find(a => a.marginCoin === 'USDT') || accounts[0]
            const available = parseFloat(usdtAccount.available || 0)
            const locked = parseFloat(usdtAccount.locked || 0)
            const unrealizedPL = parseFloat(usdtAccount.unrealizedPL || usdtAccount.crossedUnrealizedPL || 0)
            const usdtEquity = parseFloat(usdtAccount.usdtEquity || usdtAccount.accountEquity || 0)
            const balance = usdtEquity || (available + locked + unrealizedPL)

            res.json({ ok: true, balance, available, locked, unrealizedPL, usdtEquity })
        } catch (error) {
            console.error(' -> Bitget balance error:', error.message)
            res.status(500).json({ error: error.message })
        }
    })
}
