import { getDb } from './database.js'

const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

function getOllamaUrl() {
    try {
        const db = getDb()
        const settings = db.prepare('SELECT aiOllamaUrl FROM settings WHERE id = 1').get()
        return settings?.aiOllamaUrl || DEFAULT_OLLAMA_URL
    } catch (e) {
        return DEFAULT_OLLAMA_URL
    }
}

export function setupOllamaRoutes(app) {
    // KI Status prüfen (basierend auf gespeichertem Provider)
    app.get('/api/ai/status', async (req, res) => {
        try {
            const db = getDb()
            const settings = db.prepare('SELECT aiProvider, aiModel, aiApiKey, aiOllamaUrl FROM settings WHERE id = 1').get()
            const provider = settings?.aiProvider || 'ollama'

            if (provider === 'ollama') {
                return await checkOllamaStatus(res, settings?.aiOllamaUrl)
            } else if (provider === 'openai') {
                return await checkOpenAIStatus(settings.aiApiKey, res)
            } else if (provider === 'anthropic') {
                return await checkAnthropicStatus(settings.aiApiKey, res)
            }
            res.json({ online: false, provider, model: '' })
        } catch (e) {
            res.json({ online: false, provider: 'ollama', model: '' })
        }
    })

    // Legacy Ollama status endpoint (für Abwärtskompatibilität + Modelle laden)
    app.get('/api/ollama/status', async (req, res) => {
        const url = req.query.url || getOllamaUrl()
        await checkOllamaStatus(res, url)
    })

    // KI Verbindung testen
    app.post('/api/ai/test', async (req, res) => {
        const { provider, apiKey, model, ollamaUrl } = req.body
        try {
            if (provider === 'ollama') {
                const url = ollamaUrl || getOllamaUrl()
                const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) })
                if (response.ok) {
                    return res.json({ success: true, message: 'Ollama ist erreichbar' })
                }
                return res.json({ success: false, message: 'Ollama nicht erreichbar unter ' + url })
            } else if (provider === 'openai') {
                if (!apiKey) return res.json({ success: false, message: 'API-Key fehlt' })
                const response = await fetch('https://api.openai.com/v1/models', {
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                    signal: AbortSignal.timeout(10000)
                })
                if (response.ok) {
                    return res.json({ success: true, message: 'OpenAI Verbindung erfolgreich' })
                }
                const err = await response.json().catch(() => ({}))
                return res.json({ success: false, message: err.error?.message || 'OpenAI Fehler' })
            } else if (provider === 'anthropic') {
                if (!apiKey) return res.json({ success: false, message: 'API-Key fehlt' })
                const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model || 'claude-sonnet-4-5-20250929',
                        max_tokens: 10,
                        messages: [{ role: 'user', content: 'Hi' }]
                    }),
                    signal: AbortSignal.timeout(10000)
                })
                if (response.ok) {
                    return res.json({ success: true, message: 'Anthropic Verbindung erfolgreich' })
                }
                const err = await response.json().catch(() => ({}))
                return res.json({ success: false, message: err.error?.message || 'Anthropic Fehler' })
            }
            res.json({ success: false, message: 'Unbekannter Anbieter' })
        } catch (e) {
            res.json({ success: false, message: e.message || 'Verbindungstest fehlgeschlagen' })
        }
    })

    // Bericht generieren (alle Provider)
    app.post('/api/ai/report', async (req, res) => {
        const { startDate, endDate } = req.body
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate und endDate erforderlich' })
        }

        try {
            const db = getDb()
            const settings = db.prepare('SELECT aiProvider, aiModel, aiApiKey, aiTemperature, aiMaxTokens, aiOllamaUrl FROM settings WHERE id = 1').get()
            const provider = settings?.aiProvider || 'ollama'
            const model = settings?.aiModel || ''
            const temperature = settings?.aiTemperature ?? 0.7
            const maxTokens = settings?.aiMaxTokens || 1500
            const ollamaUrl = settings?.aiOllamaUrl || DEFAULT_OLLAMA_URL

            const reportData = collectReportData(db, startDate, endDate)

            if (reportData.tradeCount === 0) {
                return res.json({ report: 'Keine Trades im gewählten Zeitraum gefunden.', provider })
            }

            const prompt = buildPrompt(reportData)
            let report = ''

            if (provider === 'ollama') {
                report = await generateOllama(prompt, model || 'llama3.2:latest', temperature, maxTokens, ollamaUrl)
            } else if (provider === 'openai') {
                report = await generateOpenAI(prompt, settings.aiApiKey, model || 'gpt-4o-mini', temperature, maxTokens)
            } else if (provider === 'anthropic') {
                report = await generateAnthropic(prompt, settings.aiApiKey, model || 'claude-sonnet-4-5-20250929', temperature, maxTokens)
            } else {
                return res.status(400).json({ error: 'Unbekannter KI-Anbieter: ' + provider })
            }

            res.json({ report, provider, model: model || provider, data: reportData })
        } catch (e) {
            console.error('AI report error:', e)
            res.status(500).json({ error: e.message || 'Bericht-Generierung fehlgeschlagen' })
        }
    })

    // Legacy report endpoint
    app.post('/api/ollama/report', async (req, res) => {
        const { startDate, endDate, model } = req.body
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate und endDate erforderlich' })
        }

        try {
            const db = getDb()
            const reportData = collectReportData(db, startDate, endDate)

            if (reportData.tradeCount === 0) {
                return res.json({ report: 'Keine Trades im gewählten Zeitraum gefunden.' })
            }

            const prompt = buildPrompt(reportData)
            const ollamaModel = model || 'llama3.2:latest'
            const report = await generateOllama(prompt, ollamaModel, 0.7, 1500, getOllamaUrl())
            res.json({ report, model: ollamaModel, data: reportData })
        } catch (e) {
            console.error('Ollama report error:', e)
            res.status(500).json({ error: e.message || 'Bericht-Generierung fehlgeschlagen' })
        }
    })

    // --- Gespeicherte Berichte ---

    // Bericht speichern
    app.post('/api/ai/reports/save', (req, res) => {
        const { label, startDate, endDate, provider, model, report, reportData } = req.body
        if (!report) return res.status(400).json({ error: 'Kein Bericht zum Speichern' })
        try {
            const db = getDb()
            const stmt = db.prepare(`INSERT INTO ai_reports (label, startDate, endDate, provider, model, report, reportData) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            const result = stmt.run(label || '', startDate || 0, endDate || 0, provider || '', model || '', report, JSON.stringify(reportData || {}))
            res.json({ success: true, id: result.lastInsertRowid })
        } catch (e) {
            console.error('Save report error:', e)
            res.status(500).json({ error: e.message })
        }
    })

    // Alle Berichte laden (neueste zuerst)
    app.get('/api/ai/reports', (req, res) => {
        try {
            const db = getDb()
            const reports = db.prepare('SELECT * FROM ai_reports ORDER BY id DESC').all()
            // reportData JSON parsen
            for (const r of reports) {
                try { r.reportData = JSON.parse(r.reportData || '{}') } catch (e) { r.reportData = {} }
            }
            res.json(reports)
        } catch (e) {
            console.error('Load reports error:', e)
            res.json([])
        }
    })

    // Bericht löschen
    app.delete('/api/ai/reports/:id', (req, res) => {
        try {
            const db = getDb()
            db.prepare('DELETE FROM ai_reports WHERE id = ?').run(req.params.id)
            res.json({ success: true })
        } catch (e) {
            console.error('Delete report error:', e)
            res.status(500).json({ error: e.message })
        }
    })
}

// --- Provider-spezifische Generate-Funktionen ---

async function generateOllama(prompt, model, temperature, maxTokens, ollamaUrl) {
    const url = ollamaUrl || getOllamaUrl()
    const response = await fetch(`${url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            prompt,
            stream: false,
            options: { temperature, num_predict: maxTokens }
        })
    })

    if (!response.ok) {
        const errText = await response.text()
        throw new Error('Ollama-Fehler: ' + errText)
    }

    const data = await response.json()
    return data.response
}

async function generateOpenAI(prompt, apiKey, model, temperature, maxTokens) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: 'Du bist ein erfahrener Trading-Analyst und Coach. Antworte auf Deutsch. Verwende Markdown-Formatierung.' },
                { role: 'user', content: prompt }
            ],
            temperature,
            max_tokens: maxTokens
        })
    })

    if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error('OpenAI-Fehler: ' + (err.error?.message || response.statusText))
    }

    const data = await response.json()
    return data.choices?.[0]?.message?.content || ''
}

async function generateAnthropic(prompt, apiKey, model, temperature, maxTokens) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system: 'Du bist ein erfahrener Trading-Analyst und Coach. Antworte auf Deutsch. Verwende Markdown-Formatierung.',
            messages: [{ role: 'user', content: prompt }],
            temperature
        })
    })

    if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error('Anthropic-Fehler: ' + (err.error?.message || response.statusText))
    }

    const data = await response.json()
    return data.content?.[0]?.text || ''
}

// --- Ollama Status Check ---

async function checkOllamaStatus(res, ollamaUrl) {
    const url = ollamaUrl || getOllamaUrl()
    try {
        const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) })
        if (response.ok) {
            const data = await response.json()
            const models = data.models || []
            return res.json({ online: true, provider: 'ollama', models: models.map(m => m.name) })
        }
        return res.json({ online: false, provider: 'ollama', models: [] })
    } catch (e) {
        return res.json({ online: false, provider: 'ollama', models: [] })
    }
}

async function checkOpenAIStatus(apiKey, res) {
    if (!apiKey) return res.json({ online: false, provider: 'openai', message: 'Kein API-Key konfiguriert' })
    try {
        const response = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5000)
        })
        return res.json({ online: response.ok, provider: 'openai' })
    } catch (e) {
        return res.json({ online: false, provider: 'openai' })
    }
}

async function checkAnthropicStatus(apiKey, res) {
    if (!apiKey) return res.json({ online: false, provider: 'anthropic', message: 'Kein API-Key konfiguriert' })
    // Anthropic hat keinen /models Endpoint, wir prüfen einfach ob der Key gesetzt ist
    return res.json({ online: true, provider: 'anthropic' })
}

// --- Daten-Sammlung und Prompt-Bau (unverändert) ---

function collectReportData(db, startDate, endDate) {
    const trades = db.prepare(
        'SELECT * FROM trades WHERE dateUnix >= ? AND dateUnix <= ?'
    ).all(startDate, endDate)

    let allTrades = []
    let totalGrossProceeds = 0
    let totalNetProceeds = 0
    let totalFees = 0
    let totalGrossWins = 0
    let totalGrossLoss = 0
    let wins = 0
    let losses = 0
    let bestTradePnl = -Infinity
    let worstTradePnl = Infinity
    let bestDay = { dateUnix: 0, pnl: -Infinity }
    let worstDay = { dateUnix: 0, pnl: Infinity }

    for (const row of trades) {
        let tradesArr = []
        try { tradesArr = JSON.parse(row.trades || '[]') } catch (e) {}

        let pAndL = {}
        try { pAndL = JSON.parse(row.pAndL || '{}') } catch (e) {}

        const dayPnl = pAndL.grossProceeds || 0
        if (dayPnl > bestDay.pnl) bestDay = { dateUnix: row.dateUnix, pnl: dayPnl }
        if (dayPnl < worstDay.pnl) worstDay = { dateUnix: row.dateUnix, pnl: dayPnl }

        for (const t of tradesArr) {
            allTrades.push(t)
            const gp = t.grossProceeds || 0
            const np = t.netProceeds || 0
            const fee = (t.commission || 0) + (t.fees || 0)

            totalGrossProceeds += gp
            totalNetProceeds += np
            totalFees += fee

            if (gp > 0) {
                wins++
                totalGrossWins += gp
            } else {
                losses++
                totalGrossLoss += Math.abs(gp)
            }

            if (gp > bestTradePnl) bestTradePnl = gp
            if (gp < worstTradePnl) worstTradePnl = gp
        }
    }

    const tradeCount = allTrades.length
    const winRate = tradeCount > 0 ? ((wins / tradeCount) * 100).toFixed(1) : 0
    const profitFactor = totalGrossLoss > 0 ? (totalGrossWins / totalGrossLoss).toFixed(2) : 'N/A'
    const appt = tradeCount > 0 ? (totalGrossProceeds / tradeCount).toFixed(2) : 0
    const tradingDays = trades.length

    const longTrades = allTrades.filter(t => t.strategy === 'long')
    const shortTrades = allTrades.filter(t => t.strategy === 'short')

    const symbolMap = {}
    for (const t of allTrades) {
        const sym = t.symbol || 'Unknown'
        if (!symbolMap[sym]) symbolMap[sym] = { count: 0, pnl: 0 }
        symbolMap[sym].count++
        symbolMap[sym].pnl += (t.grossProceeds || 0)
    }
    const topSymbols = Object.entries(symbolMap)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)

    const notes = db.prepare(
        'SELECT * FROM notes WHERE dateUnix >= ? AND dateUnix <= ?'
    ).all(startDate, endDate)

    let stressSum = 0, stressCount = 0
    let emotionSum = 0, emotionCount = 0
    let notesCount = 0

    for (const n of notes) {
        if (n.entryStressLevel > 0) { stressSum += n.entryStressLevel; stressCount++ }
        if (n.emotionLevel > 0) { emotionSum += n.emotionLevel; emotionCount++ }
        if (n.entryNote || n.note || n.playbook) notesCount++
    }

    const avgStress = stressCount > 0 ? (stressSum / stressCount).toFixed(1) : 'N/A'
    const avgEmotion = emotionCount > 0 ? (emotionSum / emotionCount).toFixed(1) : 'N/A'

    const satisfactions = db.prepare(
        'SELECT * FROM satisfactions WHERE dateUnix >= ? AND dateUnix <= ?'
    ).all(startDate, endDate)
    const satisfiedCount = satisfactions.filter(s => s.satisfaction === 1).length
    const satisfactionRate = satisfactions.length > 0
        ? ((satisfiedCount / satisfactions.length) * 100).toFixed(0) : 'N/A'

    const tagsRows = db.prepare(
        'SELECT * FROM tags WHERE dateUnix >= ? AND dateUnix <= ?'
    ).all(startDate, endDate)

    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get()
    let availableTags = []
    try { availableTags = JSON.parse(settings.tags || '[]') } catch (e) {}

    const tagIdToName = {}
    for (const group of availableTags) {
        if (group.tags) {
            for (const tag of group.tags) {
                tagIdToName[tag.id] = tag.name
            }
        }
    }

    const tagUsage = {}
    for (const row of tagsRows) {
        let tagIds = []
        try { tagIds = JSON.parse(row.tags || '[]') } catch (e) {}
        for (const id of tagIds) {
            const name = tagIdToName[id] || id
            if (!tagUsage[name]) tagUsage[name] = 0
            tagUsage[name]++
        }
    }

    const journalCompleteness = tradeCount > 0
        ? ((notesCount / tradeCount) * 100).toFixed(0) : 'N/A'

    return {
        startDate, endDate, tradeCount, tradingDays,
        wins, losses, winRate,
        totalGrossProceeds: totalGrossProceeds.toFixed(2),
        totalNetProceeds: totalNetProceeds.toFixed(2),
        totalFees: totalFees.toFixed(2),
        profitFactor, appt,
        bestTradePnl: bestTradePnl === -Infinity ? 'N/A' : bestTradePnl.toFixed(2),
        worstTradePnl: worstTradePnl === Infinity ? 'N/A' : worstTradePnl.toFixed(2),
        bestDay, worstDay,
        longCount: longTrades.length,
        shortCount: shortTrades.length,
        topSymbols,
        avgStress, avgEmotion,
        satisfactionRate, journalCompleteness,
        tagUsage
    }
}

function buildPrompt(data) {
    const startDt = new Date(data.startDate * 1000)
    const endDt = new Date(data.endDate * 1000)
    const zeitraum = `${startDt.toLocaleDateString('de-DE')} – ${endDt.toLocaleDateString('de-DE')}`

    const bestDayDt = data.bestDay.dateUnix ? new Date(data.bestDay.dateUnix * 1000).toLocaleDateString('de-DE') : 'N/A'
    const worstDayDt = data.worstDay.dateUnix ? new Date(data.worstDay.dateUnix * 1000).toLocaleDateString('de-DE') : 'N/A'

    const tagLines = Object.entries(data.tagUsage)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `- ${name}: ${count} Trades`)
        .join('\n') || '- Keine Tags vergeben'

    const symbolLines = data.topSymbols
        .map(([sym, d]) => `- ${sym}: ${d.count} Trades, PnL: ${d.pnl.toFixed(2)} USDT`)
        .join('\n') || '- Keine Symbole'

    return `Erstelle einen detaillierten Trading-Bericht auf Deutsch.
Verwende Markdown-Formatierung (##, **, Listen etc.).

ZEITRAUM: ${zeitraum}

PERFORMANCE-DATEN:
- Handelstage: ${data.tradingDays}
- Trades gesamt: ${data.tradeCount} | Wins: ${data.wins} | Losses: ${data.losses}
- Win Rate: ${data.winRate}%
- Brutto PnL: ${data.totalGrossProceeds} USDT | Netto PnL: ${data.totalNetProceeds} USDT
- Gebühren: ${data.totalFees} USDT
- Profit Factor: ${data.profitFactor}
- APPT (Avg Profit Per Trade): ${data.appt} USDT
- Bester Trade: ${data.bestTradePnl} USDT | Schlechtester Trade: ${data.worstTradePnl} USDT
- Bester Tag: ${bestDayDt} (${data.bestDay.pnl !== -Infinity ? data.bestDay.pnl.toFixed(2) : 'N/A'} USDT)
- Schlechtester Tag: ${worstDayDt} (${data.worstDay.pnl !== Infinity ? data.worstDay.pnl.toFixed(2) : 'N/A'} USDT)

POSITION-VERTEILUNG:
- Long: ${data.longCount} Trades | Short: ${data.shortCount} Trades

TOP SYMBOLE:
${symbolLines}

PSYCHOLOGIE-DATEN:
- Ø Stresslevel: ${data.avgStress}/5
- Ø Emotionslevel: ${data.avgEmotion}/10
- Zufriedenheitsrate: ${data.satisfactionRate}%
- Journal-Vollständigkeit: ${data.journalCompleteness}%

TAG-ANALYSE:
${tagLines}

Erstelle einen professionellen Bericht mit folgenden Abschnitten:
## Zusammenfassung
## Performance-Analyse
## Psychologische Auswertung
## Top Symbole & Strategien
## Stärken
## Schwächen & Risiken
## Empfehlungen für den nächsten Zeitraum

Sei konkret, beziehe dich auf die Zahlen, und gib actionable Tipps.`
}
