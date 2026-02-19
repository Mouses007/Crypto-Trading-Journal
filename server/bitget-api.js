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
 *          totalFunding, marginMode, cTime, uTime
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
                if (apiImportStartDate !== undefined) updates.apiImportStartDate = apiImportStartDate
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
}
