import crypto from 'crypto'

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
 * Setup Bitunix API routes on Express app.
 */
export function setupBitunixRoutes(app, getDb) {

    // Get Bitunix API config
    app.get('/api/bitunix/config', (req, res) => {
        try {
            const db = getDb()
            const config = db.prepare('SELECT * FROM bitunix_config WHERE id = 1').get()
            if (config) {
                res.json({ apiKey: config.apiKey || '', hasSecret: !!config.secretKey })
            } else {
                res.json({ apiKey: '', hasSecret: false })
            }
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Save Bitunix API config
    app.post('/api/bitunix/config', (req, res) => {
        try {
            const db = getDb()
            const { apiKey, secretKey } = req.body

            const existing = db.prepare('SELECT id FROM bitunix_config WHERE id = 1').get()
            if (existing) {
                const updates = []
                const params = {}
                if (apiKey !== undefined) {
                    updates.push('apiKey = @apiKey')
                    params.apiKey = apiKey
                }
                if (secretKey !== undefined) {
                    updates.push('secretKey = @secretKey')
                    params.secretKey = secretKey
                }
                if (updates.length > 0) {
                    db.prepare(`UPDATE bitunix_config SET ${updates.join(', ')} WHERE id = 1`).run(params)
                }
            } else {
                db.prepare('INSERT INTO bitunix_config (id, apiKey, secretKey) VALUES (1, @apiKey, @secretKey)')
                    .run({ apiKey: apiKey || '', secretKey: secretKey || '' })
            }

            res.json({ ok: true })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Test Bitunix API connection
    app.post('/api/bitunix/test', async (req, res) => {
        try {
            const db = getDb()
            const config = db.prepare('SELECT * FROM bitunix_config WHERE id = 1').get()

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
            const db = getDb()
            const config = db.prepare('SELECT * FROM bitunix_config WHERE id = 1').get()

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
    app.get('/api/bitunix/last-import', (req, res) => {
        try {
            const db = getDb()
            const config = db.prepare('SELECT lastApiImport FROM bitunix_config WHERE id = 1').get()
            res.json({ lastApiImport: config?.lastApiImport || 0 })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Set last API import timestamp
    app.post('/api/bitunix/last-import', (req, res) => {
        try {
            const db = getDb()
            const { timestamp } = req.body
            db.prepare('UPDATE bitunix_config SET lastApiImport = @timestamp WHERE id = 1').run({ timestamp })
            res.json({ ok: true })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // Quick API import: fetch, process, and save trades in one call
    app.post('/api/bitunix/quick-import', async (req, res) => {
        try {
            const db = getDb()
            const config = db.prepare('SELECT * FROM bitunix_config WHERE id = 1').get()

            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert. Bitte zuerst in den Einstellungen hinterlegen.' })
            }

            // Determine start time
            let startTime = config.lastApiImport || 0
            if (!startTime) {
                // Default: 30 days ago
                startTime = Date.now() - (30 * 24 * 60 * 60 * 1000)
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
            db.prepare('UPDATE bitunix_config SET lastApiImport = @timestamp WHERE id = 1').run({ timestamp: endTime })

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
            const db = getDb()
            const config = db.prepare('SELECT * FROM bitunix_config WHERE id = 1').get()

            if (!config || !config.apiKey || !config.secretKey) {
                return res.status(400).json({ error: 'API-Schlüssel nicht konfiguriert.' })
            }

            const result = await getPendingPositions(config.apiKey, config.secretKey, {})

            console.log(' -> Bitunix pending positions raw response:', JSON.stringify(result).substring(0, 500))

            if (result.code !== 0) {
                throw new Error(result.msg || 'Bitunix API Fehler')
            }

            // Pending positions API: data is directly an array (unlike history where it's data.positionList)
            const positions = Array.isArray(result.data) ? result.data : (result.data?.positionList || [])

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
            const db = getDb()
            const config = db.prepare('SELECT * FROM bitunix_config WHERE id = 1').get()

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

    // Fix trade sides: repair all existing trades based on entry/exit price vs P&L direction
    app.post('/api/fix-trade-sides', (req, res) => {
        try {
            const db = getDb()
            const allRows = db.prepare('SELECT id, trades FROM trades').all()
            let fixedCount = 0
            let skippedCount = 0

            for (const row of allRows) {
                let trades
                try {
                    trades = JSON.parse(row.trades)
                } catch (e) {
                    continue
                }

                let changed = false
                for (const t of trades) {
                    const entry = parseFloat(t.entryPrice || 0)
                    const exit = parseFloat(t.exitPrice || 0)
                    const grossPL = parseFloat(t.grossProceeds || 0)

                    // Skip trades without price data (e.g. CSV imports)
                    if (entry === 0 || exit === 0 || grossPL === 0) {
                        skippedCount++
                        continue
                    }

                    const priceDiff = exit - entry
                    // Same sign = Long (price up + profit, or price down + loss)
                    // Different sign = Short (price up + loss, or price down + profit)
                    const isLong = (priceDiff > 0 && grossPL > 0) || (priceDiff < 0 && grossPL < 0)
                    const newSide = isLong ? 'B' : 'SS'
                    const newStrategy = isLong ? 'long' : 'short'

                    if (t.side !== newSide || t.strategy !== newStrategy) {
                        t.side = newSide
                        t.strategy = newStrategy
                        changed = true
                        fixedCount++
                    }
                }

                if (changed) {
                    db.prepare('UPDATE trades SET trades = ? WHERE id = ?').run(JSON.stringify(trades), row.id)
                }
            }

            // Also reset all MFE prices so they get recalculated with correct side
            const mfeResult = db.prepare('UPDATE excursions SET mfePrice = NULL WHERE mfePrice IS NOT NULL').run()
            const mfeReset = mfeResult.changes || 0

            console.log(` -> Fixed ${fixedCount} trades, skipped ${skippedCount}, reset ${mfeReset} MFE values`)
            res.json({ ok: true, fixed: fixedCount, skipped: skippedCount, mfeReset })
        } catch (error) {
            console.error(' -> Fix trade sides error:', error.message)
            res.status(500).json({ error: error.message })
        }
    })

    console.log(' -> Bitunix API routes initialized')
}
