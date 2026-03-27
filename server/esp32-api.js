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
            const todayEnd   = dayjs().tz(tz).endOf('day').unix()

            // filter=month/week/year/all  (default: all)
            const filter = req.query.filter || 'all'
            let periodStart = 0
            if      (filter === 'month') periodStart = dayjs().tz(tz).startOf('month').unix()
            else if (filter === 'week')  periodStart = dayjs().tz(tz).startOf('week').unix()
            else if (filter === 'year')  periodStart = dayjs().tz(tz).startOf('year').unix()

            // Load trades (with optional period filter)
            let tradesQuery = knex('trades').select('dateUnix', 'pAndL', 'trades')
            if (periodStart > 0) tradesQuery = tradesQuery.where('dateUnix', '>=', periodStart)
            const trades = await tradesQuery

            const cutoff30d = dayjs().tz(tz).subtract(30, 'day').unix()
            let todayPnL = 0, totalPnL = 0
            let totalWins = 0, totalLoss = 0
            let totalNetWins = 0, totalNetLoss = 0
            let totalNetWinsCount = 0, totalNetLossCount = 0
            let volume30d = 0, volumeTotal = 0

            for (const row of trades) {
                const ts = parseInt(row.dateUnix || 0)

                // All metrics computed from individual trades for consistency with journal
                let tradesArr = []
                try { tradesArr = typeof row.trades === 'string' ? JSON.parse(row.trades) : (row.trades || []) } catch { continue }

                for (const t of tradesArr) {
                    const tNet = parseFloat(t.netProceeds || 0)

                    totalPnL += tNet
                    if (ts >= todayStart && ts <= todayEnd) todayPnL += tNet

                    // Win rate (trade-level, matches journal)
                    if (tNet > 0) totalWins++
                    else if (tNet < 0) totalLoss++

                    // RRR (trade-level avg win / avg loss, matches journal netR)
                    if (tNet > 0) { totalNetWins += tNet; totalNetWinsCount++ }
                    else if (tNet < 0) { totalNetLoss += Math.abs(tNet); totalNetLossCount++ }

                    // Volume
                    const qty = Math.max(parseFloat(t.buyQuantity || 0), parseFloat(t.sellQuantity || 0))
                    const vol = qty * parseFloat(t.entryPrice || 0)
                    volumeTotal += vol
                    if (ts >= cutoff30d) volume30d += vol
                }
            }

            const winRate = (totalWins + totalLoss) > 0
                ? (totalWins / (totalWins + totalLoss)) * 100 : 0

            const avgWin = totalNetWinsCount > 0 ? totalNetWins / totalNetWinsCount : 0
            const avgLoss = totalNetLossCount > 0 ? totalNetLoss / totalNetLossCount : 0
            const rrr = avgLoss > 0 ? avgWin / avgLoss : 0

            // Satisfaction
            const sats = await knex('satisfactions').select('satisfaction')
            const satisfied = sats.filter(s => s.satisfaction == 1 || s.satisfaction == true).length
            const satisfaction = sats.length > 0 ? (satisfied / sats.length) * 100 : 0

            // Balance
            const settingsRow = await knex('settings').where('id', 1).select('startBalance', 'balances').first()
            let startBalance = parseFloat(settingsRow?.startBalance || 0)
            try {
                const balances = typeof settingsRow?.balances === 'string'
                    ? JSON.parse(settingsRow.balances) : (settingsRow?.balances || {})
                if (balances.bitunix?.start) startBalance = balances.bitunix.start
            } catch {}
            const balance = startBalance > 0 ? startBalance + totalPnL : null
            const balancePerf = startBalance > 0 ? ((balance / startBalance) - 1) * 100 : null

            // Open positions
            const openPositions = await knex('incoming_positions')
                .where('status', 'open')
                .select('symbol', 'side', 'unrealizedPNL', 'leverage', 'entryPrice', 'markPrice', 'qty')

            const filterLabels = { month: 'Monat', week: 'Woche', year: 'Jahr', all: 'Gesamt' }
            res.json({
                filter:       filter,
                filterLabel:  filterLabels[filter] || 'Gesamt',
                todayPnL:     Math.round(todayPnL * 100) / 100,
                totalPnL:     Math.round(totalPnL * 100) / 100,
                winRate:      Math.round(winRate * 10) / 10,
                satisfaction: Math.round(satisfaction * 10) / 10,
                rrr:          Math.round(rrr * 100) / 100,
                balance:      balance !== null ? Math.round(balance * 100) / 100 : null,
                balancePerf:  balancePerf !== null ? Math.round(balancePerf * 10) / 10 : null,
                volume30d:    Math.round(volume30d),
                volumeTotal:  Math.round(volumeTotal),
                openPositions: openPositions.map(p => ({
                    symbol:       p.symbol,
                    side:         p.side,
                    leverage:     parseFloat(p.leverage   || 0),
                    entryPrice:   parseFloat(p.entryPrice || 0),
                    markPrice:    parseFloat(p.markPrice  || 0),
                    qty:          parseFloat(p.qty        || 0),
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
