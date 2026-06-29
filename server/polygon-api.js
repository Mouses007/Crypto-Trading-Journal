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

            // Pfad-Parameter validieren (verhindert Pfad-Manipulation innerhalb der Polygon-API)
            const SPANS = ['second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year']
            const isDateOrTs = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d+$/.test(v)
            if (!/^\d+$/.test(interval)) {
                return res.status(400).json({ error: 'Ungültiges interval' })
            }
            if (!SPANS.includes(span)) {
                return res.status(400).json({ error: 'Ungültige span' })
            }
            if (!isDateOrTs(from) || !isDateOrTs(to)) {
                return res.status(400).json({ error: 'Ungültiges from/to (YYYY-MM-DD oder ms-Timestamp)' })
            }

            const url = `${POLYGON_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${encodeURIComponent(interval)}/${encodeURIComponent(span)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}`
            const response = await axios.get(url, {
                params: { adjusted, sort, limit },
                headers: { Authorization: `Bearer ${apiKey}` },
                timeout: 30000
            })

            return res.json(response.data)
        } catch (error) {
            const status = error.response?.status || 500
            // Polygons eigene Fehlermeldung (hilft dem Nutzer) durchreichen, aber keinen
            // internen error.message-Fallback nach außen geben.
            const message = error.response?.data?.error || error.response?.data?.message
                || (status >= 500 ? 'Interner Serverfehler' : 'Anfrage fehlgeschlagen')
            return res.status(status).json({ error: message })
        }
    })
}
