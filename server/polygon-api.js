import axios from 'axios'

const POLYGON_BASE_URL = 'https://api.polygon.io'

function getApiKey(req) {
    const headerKey = req.get('x-polygon-api-key')
    if (headerKey) return headerKey.trim()

    const auth = req.get('authorization') || ''
    if (auth.toLowerCase().startsWith('bearer ')) {
        return auth.slice(7).trim()
    }
    return ''
}

export function setupPolygonRoutes(app) {
    app.get('/api/polygon/aggs', async (req, res) => {
        try {
            const apiKey = getApiKey(req)
            if (!apiKey) {
                return res.status(400).json({ error: 'Polygon API-Key fehlt' })
            }

            const ticker = String(req.query.ticker || '').trim()
            const from = String(req.query.from || '').trim()
            const to = String(req.query.to || '').trim()
            const interval = String(req.query.interval || '1').trim()
            const span = String(req.query.span || 'minute').trim()
            const adjusted = String(req.query.adjusted || 'true').trim()
            const sort = String(req.query.sort || 'asc').trim()
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50000, 1), 50000)

            if (!ticker || !from || !to) {
                return res.status(400).json({ error: 'ticker, from und to sind erforderlich' })
            }

            const url = `${POLYGON_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${interval}/${span}/${from}/${to}`
            const response = await axios.get(url, {
                params: { adjusted, sort, limit },
                headers: { Authorization: `Bearer ${apiKey}` },
                timeout: 30000
            })

            return res.json(response.data)
        } catch (error) {
            const status = error.response?.status || 500
            const message = error.response?.data?.error || error.response?.data?.message || error.message
            return res.status(status).json({ error: message })
        }
    })
}
