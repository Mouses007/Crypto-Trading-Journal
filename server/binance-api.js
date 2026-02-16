/**
 * Binance Public API Proxy
 * Proxied die kostenlose Binance Klines API um CORS zu vermeiden.
 * Kein API-Key nötig.
 */

import axios from 'axios'

const BINANCE_BASE = 'https://api.binance.com'

export function setupBinanceRoutes(app) {

    /**
     * GET /api/binance/klines
     * Query-Parameter:
     *   symbol    - z.B. BNBUSDT (required)
     *   interval  - z.B. 1m, 5m, 15m, 1h (default: 1m)
     *   startTime - Unix Millisekunden (required)
     *   endTime   - Unix Millisekunden (required)
     *   limit     - max Anzahl Kerzen (default: 1000, max: 1500)
     *
     * Response: Array von Arrays
     *   [openTime, open, high, low, close, volume, closeTime, ...]
     */
    app.get('/api/binance/klines', async (req, res) => {
        try {
            const { symbol, interval, startTime, endTime, limit } = req.query

            if (!symbol || !startTime || !endTime) {
                return res.status(400).json({ error: 'symbol, startTime und endTime sind erforderlich' })
            }

            const start = Number(startTime)
            const end = Number(endTime)
            if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) {
                return res.status(400).json({ error: 'startTime und endTime müssen gültige positive Zahlen (Unix ms) sein' })
            }
            if (start >= end) {
                return res.status(400).json({ error: 'startTime muss vor endTime liegen' })
            }

            const params = {
                symbol: String(symbol).toUpperCase().slice(0, 20),
                interval: interval || '1m',
                startTime: start,
                endTime: end,
                limit: Math.min(Math.max(0, parseInt(limit, 10) || 1000), 1500)
            }

            console.log(` -> Binance klines: ${params.symbol} ${params.interval} von ${new Date(params.startTime).toISOString()} bis ${new Date(params.endTime).toISOString()}`)

            const response = await axios.get(`${BINANCE_BASE}/api/v3/klines`, { params })
            res.json(response.data)

        } catch (error) {
            console.error(' -> Binance API Fehler:', error.response?.data || error.message)
            const status = error.response?.status || 500
            const message = error.response?.data?.msg || error.message
            res.status(status).json({ error: message })
        }
    })
}
