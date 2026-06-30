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
import { getPendingPositions } from './bitunix-api.js'
import { getCurrentPositions as getBitgetCurrentPositions } from './bitget-api.js'
import { getRunningBotPositions } from './pionex-api.js'
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

            // Load all needed settings in one query
            const settings = await knex('settings').where('id', 1).select('timeZone', 'startBalance', 'balances', 'esp32Filter').first()
            const tz = settings?.timeZone || 'Europe/Berlin'

            // Per-broker start balances from settings.balances; primary = default
            let balances = {}
            try { balances = typeof settings?.balances === 'string' ? JSON.parse(settings.balances) : (settings?.balances || {}) } catch {}
            let startBalance = parseFloat(settings?.startBalance || 0)
            let primaryBroker = 'bitunix'
            if (balances.bitunix?.start) { startBalance = balances.bitunix.start; primaryBroker = 'bitunix' }
            else if (balances.bitget?.start) { startBalance = balances.bitget.start; primaryBroker = 'bitget' }

            const todayStart = dayjs().tz(tz).startOf('day').unix()
            const todayEnd   = dayjs().tz(tz).endOf('day').unix()

            // Server-side filter (settings.esp32Filter) normally takes priority over the
            // query param — so the journal admin controls which period the ESP32 displays.
            // A client can opt out with ?force=1 and pick its own period (the Android
            // widget sends force=1 + its configured filter).
            const forced = req.query.force === '1' || req.query.force === 'true'
            const filter = forced
                ? (req.query.filter || 'all')
                : (settings?.esp32Filter || req.query.filter || 'month')
            let periodStart = 0
            if      (filter === 'month') periodStart = dayjs().tz(tz).startOf('month').unix()
            else if (filter === 'week')  periodStart = dayjs().tz(tz).startOf('week').unix()
            else if (filter === 'year')  periodStart = dayjs().tz(tz).startOf('year').unix()

            const cutoff30d = dayjs().tz(tz).subtract(30, 'day').unix()

            // KPIs für die Trade-Zeilen eines Brokers (Periode via periodStart aus dem Closure)
            const statsForTrades = (rows, startBal) => {
                let todayPnL = 0, totalPnL = 0, allTimePnL = 0
                let totalGrossWins = 0, totalTradeCount = 0
                let totalNetWins = 0, totalNetLoss = 0, totalNetWinsCount = 0, totalNetLossCount = 0
                let volume30d = 0, volumeTotal = 0
                let todayTradeCount = 0, todayWins = 0, todayLosses = 0
                for (const row of rows) {
                    const ts = parseInt(row.dateUnix || 0)
                    const inPeriod = periodStart === 0 || ts >= periodStart
                    const isToday = ts >= todayStart && ts <= todayEnd
                    let pl = {}
                    try { pl = typeof row.pAndL === 'string' ? JSON.parse(row.pAndL) : (row.pAndL || {}) } catch {}
                    allTimePnL += parseFloat(pl.netProceeds || 0)
                    let tradesArr = []
                    try { tradesArr = typeof row.trades === 'string' ? JSON.parse(row.trades) : (row.trades || []) } catch {}
                    for (const t of tradesArr) {
                        const qty = Math.max(parseFloat(t.buyQuantity || 0), parseFloat(t.sellQuantity || 0))
                        const vol = qty * parseFloat(t.entryPrice || 0)
                        volumeTotal += vol
                        if (ts >= cutoff30d) volume30d += vol
                    }
                    if (!inPeriod) continue
                    const net = parseFloat(pl.netProceeds || 0)
                    totalPnL += net
                    if (isToday) {
                        todayPnL += net
                        const tw = parseInt(pl.grossWinsCount || 0)
                        const tc = parseInt(pl.trades || 0)
                        todayWins += tw; todayLosses += Math.max(0, tc - tw); todayTradeCount += tc
                    }
                    totalGrossWins  += parseInt(pl.grossWinsCount || 0)
                    totalTradeCount += parseInt(pl.trades || 0)
                    for (const t of tradesArr) {
                        const tGross = parseFloat(t.grossProceeds || 0)
                        if (tGross > 0) { totalNetWins += tGross; totalNetWinsCount++ }
                        else if (tGross < 0) { totalNetLoss += Math.abs(tGross); totalNetLossCount++ }
                    }
                }
                const winRate = totalTradeCount > 0 ? (totalGrossWins / totalTradeCount) * 100 : 0
                const avgWin = totalNetWinsCount > 0 ? totalNetWins / totalNetWinsCount : 0
                const avgLoss = totalNetLossCount > 0 ? totalNetLoss / totalNetLossCount : 0
                const rrr = avgLoss > 0 ? avgWin / avgLoss : 0
                const balance = startBal > 0 ? startBal + allTimePnL : null
                const balancePerf = startBal > 0 ? ((balance / startBal) - 1) * 100 : null
                const r2 = (x) => x == null ? null : Math.round(x * 100) / 100
                const r1 = (x) => x == null ? null : Math.round(x * 10) / 10
                return {
                    balance: r2(balance), balancePerf: r1(balancePerf),
                    todayPnL: r2(todayPnL), todayTrades: todayTradeCount, todayWins, todayLosses,
                    totalPnL: r2(totalPnL), winRate: r1(winRate), rrr: r2(rrr),
                    volume30d: Math.round(volume30d), volumeTotal: Math.round(volumeTotal)
                }
            }

            // Pro Broker rechnen (nur die mit Trades oder Startsaldo aufnehmen)
            const brokers = {}
            for (const b of ['bitunix', 'bitget', 'pionex']) {
                const startB = parseFloat(balances[b]?.start || 0)
                const rows = await knex('trades').where('broker', b).select('dateUnix', 'pAndL', 'trades')
                if (rows.length === 0 && !(startB > 0)) continue
                brokers[b] = statsForTrades(rows, startB)
            }

            // Top-Level-KPIs = Primär-Broker (Backward-Compat für ältere Clients)
            const primaryStats = brokers[primaryBroker] || statsForTrades([], startBalance)
            const { balance, balancePerf, todayPnL, todayTrades: todayTradeCount, todayWins, todayLosses,
                    totalPnL, winRate, rrr, volume30d, volumeTotal } = primaryStats

            // Satisfaction — global, gefiltert nach Zeitraum (wie Journal)
            const satsQuery = knex('satisfactions').select('satisfaction')
            if (periodStart > 0) satsQuery.where('dateUnix', '>=', periodStart)
            const sats = await satsQuery
            const satisfied = sats.filter(s => s.satisfaction == 1 || s.satisfaction == true).length
            const satisfaction = sats.length > 0 ? (satisfied / sats.length) * 100 : 0

            // Offene Futures-Positionen ALLER konfigurierten Broker — je mit broker-Tag,
            // damit Clients (Widget/Desklet) nach Börse gruppieren können. Pro Broker
            // eigenes try/catch, damit ein Ausfall die anderen nicht blockiert.
            let openPositions = []
            // --- Bitunix ---
            try {
                const c = await knex('bitunix_config').where('id', 1).first()
                if (c?.apiKey && c?.secretKey) {
                    const result = await getPendingPositions(decrypt(c.apiKey), decrypt(c.secretKey), {})
                    if (result.code === 0) {
                        const raw = Array.isArray(result.data) ? result.data : (result.data?.positionList || [])
                        for (const p of raw) openPositions.push({
                            broker:        'bitunix',
                            symbol:        p.symbol || '',
                            side:          p.side   || '',
                            leverage:      parseFloat(p.leverage     || 0),
                            entryPrice:    parseFloat(p.entryPrice   ?? p.avgOpenPrice ?? p.avg_open_price ?? 0),
                            markPrice:     parseFloat(p.markPrice    ?? p.mark_price ?? 0),
                            qty:           parseFloat(p.qty ?? p.maxQty ?? 0),
                            unrealizedPNL: parseFloat(p.unrealizedPNL ?? p.unrealized_pnl ?? 0),
                            realizedPNL:   parseFloat(p.realizedPNL  ?? p.realized_pnl ?? 0)
                        })
                    }
                }
            } catch (e) { console.warn('ESP32 bitunix positions:', e.message) }
            // --- Bitget ---
            try {
                const c = await knex('bitget_config').where('id', 1).first()
                if (c?.apiKey && c?.secretKey && c?.passphrase) {
                    const result = await getBitgetCurrentPositions(decrypt(c.apiKey), decrypt(c.secretKey), decrypt(c.passphrase), {})
                    if (String(result.code) === '00000') {
                        const raw = Array.isArray(result.data) ? result.data : []
                        for (const p of raw) {
                            if (parseFloat(p.total ?? p.available ?? 0) <= 0) continue
                            openPositions.push({
                                broker:        'bitget',
                                symbol:        p.symbol || '',
                                side:          (p.holdSide || p.posSide || '').toLowerCase() === 'long' ? 'BUY' : 'SELL',
                                leverage:      parseFloat(p.leverage      || 0),
                                entryPrice:    parseFloat(p.openPriceAvg  ?? p.averageOpenPrice ?? 0),
                                markPrice:     parseFloat(p.markPrice     ?? 0),
                                qty:           parseFloat(p.total ?? p.available ?? 0),
                                unrealizedPNL: parseFloat(p.unrealizedPL  ?? 0),
                                realizedPNL:   parseFloat(p.achievedProfits ?? 0)
                            })
                        }
                    }
                }
            } catch (e) { console.warn('ESP32 bitget positions:', e.message) }

            // Laufende Pionex-Bots — eigenes Array (NICHT in openPositions mischen, damit
            // ältere Clients ohne Bot-Support unverändert weiterlaufen). PnL/Marge in der
            // jeweiligen marginCoin (z.B. SOL bei Coin-M), nicht zwingend USDT.
            let bots = []
            try {
                bots = (await getRunningBotPositions()).map(b => ({
                    broker:        'pionex',
                    symbol:        b.symbol || '',
                    side:          b.side   || '',
                    leverage:      parseFloat(b.leverage      || 0),
                    entryPrice:    parseFloat(b.entryPrice    || 0),
                    markPrice:     parseFloat(b.markPrice     || 0),
                    qty:           parseFloat(b.qty           || 0),
                    unrealizedPNL: parseFloat(b.unrealizedPNL || 0),
                    marginCoin:    b.marginCoin || 'USDT',
                    liqPrice:      parseFloat(b.liqPrice      || 0),
                    coinM:         !!b.coinM,
                    botType:       b.botType || '',
                    isBot:         true
                }))
            } catch (botErr) {
                console.warn('ESP32 bots live fetch failed:', botErr.message)
            }

            const filterLabels = { month: 'Monat', week: 'Woche', year: 'Jahr', all: 'Gesamt' }
            res.json({
                filter:       filter,
                filterLabel:  filterLabels[filter] || 'Gesamt',
                todayPnL:      Math.round(todayPnL * 100) / 100,
                todayTrades:   todayTradeCount,
                todayWins:     todayWins,
                todayLosses:   todayLosses,
                totalPnL:      Math.round(totalPnL * 100) / 100,
                winRate:       Math.round(winRate * 10) / 10,
                satisfaction:  Math.round(satisfaction * 10) / 10,
                rrr:           Math.round(rrr * 100) / 100,
                balance:       balance !== null ? Math.round(balance * 100) / 100 : null,
                balancePerf:   balancePerf !== null ? Math.round(balancePerf * 10) / 10 : null,
                volume30d:     Math.round(volume30d),
                volumeTotal:   Math.round(volumeTotal),
                openPositions: openPositions,
                bots:          bots,
                // KPIs je Börse (für Clients, die pro Börse umschalten — z.B. Android-Widget).
                // Top-Level-Felder oben = primaryBroker (Backward-Compat für ältere Clients).
                primaryBroker: primaryBroker,
                brokers:       brokers
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
            res.status(500).json({ error: 'Interner Serverfehler' })
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
            res.status(500).json({ error: 'Interner Serverfehler' })
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
            res.status(500).json({ error: 'Interner Serverfehler' })
        }
    })
}
