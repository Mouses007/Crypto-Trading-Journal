/**
 * ESP32 Display API
 *
 * Provides a read-only endpoint for the ESP32-2432S028 (CYD) to display
 * trading journal data on its TFT screen.
 *
 * Auth: Static API key stored encrypted in settings.esp32ApiKey
 * Header: X-ESP32-Key: <plaintext-key>
 *
 * Public endpoint (no session required):
 *   GET /api/esp32/display
 *
 * Admin endpoints (behind session auth, via setupEsp32AdminRoutes):
 *   GET    /api/esp32/settings  — key presence flag
 *   POST   /api/esp32/settings  — generate or set key
 *   DELETE /api/esp32/key       — clear key
 */
import crypto from 'crypto'
import { getKnex } from './database.js'
import { encrypt, decrypt } from './crypto.js'
import dayjs from 'dayjs'
import dayjsUtc from 'dayjs/plugin/utc.js'
import dayjsTimezone from 'dayjs/plugin/timezone.js'

dayjs.extend(dayjsUtc)
dayjs.extend(dayjsTimezone)

// ============================================================
// Auth helper
// ============================================================

function timingSafeCompare(a, b) {
    try {
        const bufA = Buffer.from(a)
        const bufB = Buffer.from(b)
        if (bufA.length !== bufB.length) return false
        return crypto.timingSafeEqual(bufA, bufB)
    } catch {
        return false
    }
}

async function verifyEsp32Key(req) {
    const provided = req.headers['x-esp32-key']
    if (!provided) return false

    const knex = getKnex()
    const row = await knex('settings').where('id', 1).select('esp32ApiKey').first()
    if (!row?.esp32ApiKey) return false

    let stored
    try {
        stored = decrypt(row.esp32ApiKey)
    } catch {
        return false
    }
    if (!stored) return false

    return timingSafeCompare(provided, stored)
}

// ============================================================
// Public routes — registered BEFORE apiAuthMiddleware
// ============================================================

export function setupEsp32Routes(app) {

    app.get('/api/esp32/display', async (req, res) => {
        try {
            const ok = await verifyEsp32Key(req)
            if (!ok) {
                return res.status(401).json({ error: 'Unauthorized' })
            }

            const knex = getKnex()

            // Load timezone from settings
            const settings = await knex('settings').where('id', 1).select('timeZone').first()
            const tz = settings?.timeZone || 'Europe/Berlin'

            // Today's range in unix seconds
            const todayStart = dayjs().tz(tz).startOf('day').unix()
            const todayEnd = dayjs().tz(tz).endOf('day').unix()

            // Load all trades for PnL calculation
            const trades = await knex('trades').select('dateUnix', 'pAndL')

            let todayPnL = 0
            let totalPnL = 0
            let totalWins = 0
            let totalLoss = 0

            for (const row of trades) {
                let pl = {}
                try {
                    pl = typeof row.pAndL === 'string' ? JSON.parse(row.pAndL) : (row.pAndL || {})
                } catch {
                    continue
                }

                const net = parseFloat(pl.netProceeds || 0)
                totalPnL += net
                totalWins += parseInt(pl.netWinsCount || 0)
                totalLoss += parseInt(pl.netLossCount || 0)

                const ts = parseInt(row.dateUnix || 0)
                if (ts >= todayStart && ts <= todayEnd) {
                    todayPnL += net
                }
            }

            const winRate = (totalWins + totalLoss) > 0
                ? (totalWins / (totalWins + totalLoss)) * 100
                : 0

            // Open positions
            const openPositions = await knex('incoming_positions')
                .where('status', 'open')
                .select('symbol', 'side', 'unrealizedPNL', 'broker')

            res.json({
                todayPnL: Math.round(todayPnL * 100) / 100,
                totalPnL: Math.round(totalPnL * 100) / 100,
                winRate: Math.round(winRate * 10) / 10,
                openPositions: openPositions.map(p => ({
                    symbol: p.symbol,
                    side: p.side,
                    unrealizedPNL: parseFloat(p.unrealizedPNL || 0)
                }))
            })
        } catch (e) {
            console.error('ESP32 display error:', e)
            res.status(500).json({ error: 'Internal server error' })
        }
    })

    console.log(' -> ESP32 display route initialized (GET /api/esp32/display)')
}

// ============================================================
// Admin routes — registered AFTER apiAuthMiddleware (session required)
// ============================================================

export function setupEsp32AdminRoutes(app) {

    // GET /api/esp32/settings — key presence only
    app.get('/api/esp32/settings', async (req, res) => {
        try {
            const knex = getKnex()
            const row = await knex('settings').where('id', 1).select('esp32ApiKey').first()
            res.json({ esp32ApiKeySet: !!(row?.esp32ApiKey) })
        } catch (e) {
            console.error('ESP32 settings GET error:', e)
            res.status(500).json({ error: e.message })
        }
    })

    // POST /api/esp32/settings — generate new key or save custom key
    app.post('/api/esp32/settings', async (req, res) => {
        try {
            const knex = getKnex()

            if (req.body.regenerate) {
                // Generate a new random 32-byte hex key
                const plainKey = crypto.randomBytes(32).toString('hex')
                const encrypted = encrypt(plainKey)
                await knex('settings').where('id', 1).update({ esp32ApiKey: encrypted })
                // Return plaintext ONCE so user can copy it to ESP32 firmware
                return res.json({ esp32ApiKeySet: true, plainKey })
            }

            // Save a manually entered key (if not masked)
            if (req.body.esp32ApiKey && !req.body.esp32ApiKey.includes('•')) {
                const encrypted = encrypt(req.body.esp32ApiKey)
                await knex('settings').where('id', 1).update({ esp32ApiKey: encrypted })
            }

            res.json({ esp32ApiKeySet: true })
        } catch (e) {
            console.error('ESP32 settings POST error:', e)
            res.status(500).json({ error: e.message })
        }
    })

    // DELETE /api/esp32/key — remove key
    app.delete('/api/esp32/key', async (req, res) => {
        try {
            const knex = getKnex()
            await knex('settings').where('id', 1).update({ esp32ApiKey: '' })
            res.json({ ok: true })
        } catch (e) {
            console.error('ESP32 key DELETE error:', e)
            res.status(500).json({ error: e.message })
        }
    })
}
