import { getKnex } from './database.js'
import { encrypt, decrypt } from './crypto.js'
import { logWarn, logError } from './logger.js'

const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

/** Parse and validate a numeric ID from request params. Returns the integer or sends 400 and returns null. */
function parseId(param, res, paramName = 'id') {
    const id = parseInt(param, 10)
    if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: `Ungültige ${paramName}` })
        return null
    }
    return id
}

// Prompt-Presets (muss mit Settings.vue synchron sein)
const PROMPT_PRESETS = {
    'Halte den Bericht kurz und prägnant. Maximal 3-4 Sätze pro Abschnitt. Fokussiere dich auf die wichtigsten Erkenntnisse.': 'Kurz & knapp',
    'Sei sehr direkt und kritisch. Beschönige nichts. Sprich Schwächen und Fehler klar an. Gib konkrete Verbesserungsvorschläge wie ein strenger Trading-Coach.': 'Strenger Coach',
    'Erkläre alle Kennzahlen und Begriffe einfach und verständlich. Gib grundlegende Trading-Tipps. Verwende eine ermutigende Sprache.': 'Anfänger-freundlich',
    'Lege besonderen Fokus auf die psychologischen Aspekte: Stress, Emotionen, Disziplin, Overtrading. Analysiere Verhaltensmuster und emotionale Trigger.': 'Psychologie-Fokus',
    'Fokussiere dich auf Risikomanagement: Positionsgrößen, Risk/Reward, Drawdowns, maximale Verlustserien. Bewerte die Risikokontrolle kritisch.': 'Risiko-Analyse',
}

// Hilfsfunktion: API-Key für den aktuellen Provider lesen (entschlüsselt)
function getApiKeyForProvider(settings, provider) {
    const keyMap = { openai: 'aiKeyOpenai', anthropic: 'aiKeyAnthropic', gemini: 'aiKeyGemini', deepseek: 'aiKeyDeepseek' }
    const col = keyMap[provider]
    if (col && settings[col]) {
        return decrypt(settings[col])
    }
    // Fallback: altes aiApiKey-Feld
    return settings.aiApiKey ? decrypt(settings.aiApiKey) : ''
}

async function getOllamaUrl() {
    try {
        const knex = getKnex()
        const settings = await knex('settings').select('aiOllamaUrl').where('id', 1).first()
        return settings?.aiOllamaUrl || DEFAULT_OLLAMA_URL
    } catch (e) {
        logWarn('ollama-api', 'Could not load Ollama URL from settings, using default URL', e)
        return DEFAULT_OLLAMA_URL
    }
}

export function setupOllamaRoutes(app) {
    // KI Status prüfen (basierend auf gespeichertem Provider)
    app.get('/api/ai/status', async (req, res) => {
        try {
            const knex = getKnex()
            const settings = await knex('settings')
                .select('aiProvider', 'aiModel', 'aiApiKey', 'aiOllamaUrl', 'aiKeyOpenai', 'aiKeyAnthropic', 'aiKeyGemini', 'aiKeyDeepseek')
                .where('id', 1).first()
            const provider = settings?.aiProvider || 'ollama'
            const model = settings?.aiModel || ''
            const apiKey = getApiKeyForProvider(settings, provider)

            if (provider === 'ollama') {
                return await checkOllamaStatus(res, settings?.aiOllamaUrl, model)
            } else if (provider === 'openai') {
                return await checkOpenAIStatus(apiKey, res, model)
            } else if (provider === 'anthropic') {
                return await checkAnthropicStatus(apiKey, res, model)
            } else if (provider === 'gemini') {
                return await checkGeminiStatus(apiKey, res, model)
            } else if (provider === 'deepseek') {
                return await checkDeepseekStatus(apiKey, res, model)
            }
            res.json({ online: false, provider, model })
        } catch (e) {
            res.json({ online: false, provider: 'ollama', model: '' })
        }
    })

    // Legacy Ollama status endpoint (für Abwärtskompatibilität + Modelle laden)
    app.get('/api/ollama/status', async (req, res) => {
        let url = req.query.url || await getOllamaUrl()
        // SSRF-Schutz: Nur localhost/private Hosts erlauben
        try {
            const parsed = new URL(url)
            const host = parsed.hostname
            const isLocal = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)
            const isPrivate = host.startsWith('192.168.') || host.startsWith('10.') || host.match(/^172\.(1[6-9]|2\d|3[01])\./)
            if (!isLocal && !isPrivate) {
                return res.status(400).json({ error: 'Nur lokale/private Hosts erlaubt' })
            }
        } catch (e) {
            return res.status(400).json({ error: 'Ungültige URL' })
        }
        await checkOllamaStatus(res, url)
    })

    // KI Verbindung testen
    app.post('/api/ai/test', async (req, res) => {
        let { provider, apiKey, model, ollamaUrl } = req.body

        // Wenn Key maskiert ist (·), den gespeicherten Key aus DB verwenden
        if (apiKey && apiKey.includes('•')) {
            try {
                const knex = getKnex()
                const settings = await knex('settings')
                    .select('aiKeyOpenai', 'aiKeyAnthropic', 'aiKeyGemini', 'aiKeyDeepseek', 'aiApiKey')
                    .where('id', 1).first()
                apiKey = getApiKeyForProvider(settings, provider)
            } catch (e) {
                apiKey = ''
            }
        }

        try {
            if (provider === 'ollama') {
                const url = ollamaUrl || await getOllamaUrl()
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
            } else if (provider === 'gemini') {
                if (!apiKey) return res.json({ success: false, message: 'API-Key fehlt' })
                const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
                    headers: { 'x-goog-api-key': apiKey },
                    signal: AbortSignal.timeout(10000)
                })
                if (response.ok) {
                    return res.json({ success: true, message: 'Google Gemini Verbindung erfolgreich' })
                }
                const err = await response.json().catch(() => ({}))
                return res.json({ success: false, message: err.error?.message || 'Gemini Fehler' })
            } else if (provider === 'deepseek') {
                if (!apiKey) return res.json({ success: false, message: 'API-Key fehlt' })
                const response = await fetch('https://api.deepseek.com/v1/models', {
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                    signal: AbortSignal.timeout(10000)
                })
                if (response.ok) {
                    return res.json({ success: true, message: 'DeepSeek Verbindung erfolgreich' })
                }
                const err = await response.json().catch(() => ({}))
                return res.json({ success: false, message: err.error?.message || 'DeepSeek Fehler' })
            }
            res.json({ success: false, message: 'Unbekannter Anbieter' })
        } catch (e) {
            res.json({ success: false, message: e.message || 'Verbindungstest fehlgeschlagen' })
        }
    })

    // Bericht generieren (alle Provider)
    app.post('/api/ai/report', async (req, res) => {
        const { startDate, endDate, broker } = req.body
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate und endDate erforderlich' })
        }

        try {
            const knex = getKnex()
            const settings = await knex('settings')
                .select('aiProvider', 'aiModel', 'aiApiKey', 'aiTemperature', 'aiMaxTokens', 'aiOllamaUrl', 'aiScreenshots', 'aiReportPrompt', 'aiKeyOpenai', 'aiKeyAnthropic', 'aiKeyGemini', 'aiKeyDeepseek')
                .where('id', 1).first()
            const provider = settings?.aiProvider || 'ollama'
            const model = settings?.aiModel || ''
            const temperature = settings?.aiTemperature ?? 0.7
            const maxTokens = settings?.aiMaxTokens || 1500
            const ollamaUrl = settings?.aiOllamaUrl || DEFAULT_OLLAMA_URL
            const screenshotsEnabled = settings?.aiScreenshots === 1
            const customPrompt = settings?.aiReportPrompt || ''
            const apiKey = getApiKeyForProvider(settings, provider)

            const reportData = await collectReportData(knex, startDate, endDate, broker || null)

            if (reportData.tradeCount === 0) {
                return res.json({ report: 'Keine Trades im gewählten Zeitraum gefunden.', provider })
            }

            // Screenshots sammeln (nur für Online-Provider wenn aktiviert)
            let screenshots = []
            if (screenshotsEnabled && provider !== 'ollama' && provider !== 'deepseek') {
                screenshots = await collectScreenshots(knex, startDate, endDate, 4)
                reportData.screenshots = screenshots // Für Prompt-Hinweis
            }

            const prompt = buildPrompt(reportData, customPrompt)
            let report = ''
            let tokenUsage = null

            if (provider === 'ollama') {
                const result = await generateOllama(prompt, model || 'llama3.2:latest', temperature, maxTokens, ollamaUrl)
                report = result.text
                tokenUsage = result.usage
            } else if (provider === 'openai') {
                const result = await generateOpenAI(prompt, apiKey, model || 'gpt-4o-mini', temperature, maxTokens, screenshots)
                report = result.text
                tokenUsage = result.usage
            } else if (provider === 'anthropic') {
                const result = await generateAnthropic(prompt, apiKey, model || 'claude-sonnet-4-5-20250929', temperature, maxTokens, screenshots)
                report = result.text
                tokenUsage = result.usage
            } else if (provider === 'gemini') {
                const result = await generateGemini(prompt, apiKey, model || 'gemini-2.0-flash', temperature, maxTokens, screenshots)
                report = result.text
                tokenUsage = result.usage
            } else if (provider === 'deepseek') {
                const result = await generateDeepSeek(prompt, apiKey, model || 'deepseek-chat', temperature, maxTokens)
                report = result.text
                tokenUsage = result.usage
            } else {
                return res.status(400).json({ error: 'Unbekannter KI-Anbieter: ' + provider })
            }

            // Auto-save: Bericht direkt serverseitig speichern (damit Tab-Wechsel kein Problem ist)
            const label = req.body.label || ''
            const promptPreset = PROMPT_PRESETS[customPrompt] || (customPrompt ? 'Eigener Prompt' : 'Standard')
            let savedId = null
            try {
                const [inserted] = await knex('ai_reports').insert({
                    label,
                    startDate: startDate || 0,
                    endDate: endDate || 0,
                    provider: provider || '',
                    model: model || provider,
                    report,
                    reportData: JSON.stringify(reportData || {}),
                    promptTokens: tokenUsage?.promptTokens || 0,
                    completionTokens: tokenUsage?.completionTokens || 0,
                    totalTokens: tokenUsage?.totalTokens || 0,
                    promptPreset,
                    broker: broker || ''
                }).returning('id')
                savedId = typeof inserted === 'object' ? inserted.id : inserted
            } catch (saveErr) {
                console.error('Auto-save report error:', saveErr)
            }

            res.json({ report, provider, model: model || provider, data: reportData, tokenUsage, savedId })
        } catch (e) {
            console.error('AI report error:', e)
            res.status(500).json({ error: e.message || 'Bericht-Generierung fehlgeschlagen' })
        }
    })

    // Legacy report endpoint
    app.post('/api/ollama/report', async (req, res) => {
        const { startDate, endDate, model, broker } = req.body
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate und endDate erforderlich' })
        }

        try {
            const knex = getKnex()
            const reportData = await collectReportData(knex, startDate, endDate, broker || null)

            if (reportData.tradeCount === 0) {
                return res.json({ report: 'Keine Trades im gewählten Zeitraum gefunden.' })
            }

            const prompt = buildPrompt(reportData)
            const ollamaModel = model || 'llama3.2:latest'
            const result = await generateOllama(prompt, ollamaModel, 0.7, 1500, await getOllamaUrl())
            res.json({ report: result.text, model: ollamaModel, data: reportData })
        } catch (e) {
            console.error('Ollama report error:', e)
            res.status(500).json({ error: e.message || 'Bericht-Generierung fehlgeschlagen' })
        }
    })

    // --- Per-Trade KI-Bewertung ---
    app.post('/api/ai/trade-review', async (req, res) => {
        const { tradeId, dateUnix, tradeData } = req.body
        if (!tradeId || !tradeData) {
            return res.status(400).json({ error: 'tradeId und tradeData erforderlich' })
        }

        try {
            const knex = getKnex()

            // KI-Settings laden
            const settings = await knex('settings')
                .select('aiProvider', 'aiModel', 'aiTemperature', 'aiMaxTokens', 'aiOllamaUrl', 'aiKeyOpenai', 'aiKeyAnthropic', 'aiKeyGemini', 'aiKeyDeepseek')
                .where('id', 1).first()
            const provider = settings?.aiProvider || 'ollama'
            const model = settings?.aiModel || ''
            const temperature = settings?.aiTemperature ?? 0.7
            const maxTokens = settings?.aiMaxTokens || 1500
            const ollamaUrl = settings?.aiOllamaUrl || DEFAULT_OLLAMA_URL
            const apiKey = getApiKeyForProvider(settings, provider)

            // Notiz des Users laden (falls vorhanden)
            const noteRecord = await knex('notes').where('tradeId', tradeId).first()
            const userNote = noteRecord?.note || ''
            const entryNote = noteRecord?.entryNote || ''
            const closingNote = noteRecord?.closingNote || ''
            const feelings = noteRecord?.feelings || ''
            const playbook = noteRecord?.playbook || ''

            // Satisfaction laden
            const satRecord = await knex('satisfactions').where('tradeId', tradeId).first()
            const satisfaction = satRecord ? (satRecord.satisfaction === 1 ? 'Zufrieden' : satRecord.satisfaction === 0 ? 'Unzufrieden' : 'Neutral') : 'Nicht bewertet'

            // Tags laden
            const tagRecord = await knex('tags').where('tradeId', tradeId).first()
            let tradeTags = ''
            if (tagRecord?.tags) {
                try {
                    const parsed = JSON.parse(tagRecord.tags)
                    tradeTags = parsed.map(t => t.name || t).join(', ')
                } catch (e) { /* ignore */ }
            }

            // Screenshot laden (falls vorhanden) — mehrere Suchstrategien
            let screenshotData = []
            const symbol = tradeData.symbol || ''
            const tradeSide = tradeData.side === 'B' ? 'Long' : 'Short'
            const tradeSideShort = tradeData.side === 'B' ? 'B' : 'S'

            // Strategie 1: Direkt per name = tradeId
            let screenshotRecord = await knex('screenshots').where('name', tradeId).first()

            // Strategie 2: Per dateUnixDay (gleicher Tag)
            if (!screenshotRecord && dateUnix) {
                screenshotRecord = await knex('screenshots')
                    .where('dateUnixDay', dateUnix)
                    .andWhere('symbol', symbol)
                    .first()
            }

            // Strategie 3: Per name-Pattern "t{dateUnix}_{symbol}_{side}"
            if (!screenshotRecord && dateUnix && symbol) {
                const namePattern = 't' + dateUnix + '_' + symbol + '_' + tradeSideShort
                screenshotRecord = await knex('screenshots').where('name', namePattern).first()
            }

            // Strategie 4: Nur per dateUnixDay (irgendein Screenshot vom gleichen Tag)
            if (!screenshotRecord && dateUnix) {
                screenshotRecord = await knex('screenshots').where('dateUnixDay', dateUnix).first()
            }
            if (screenshotRecord) {
                const base64 = screenshotRecord.annotatedBase64 || screenshotRecord.originalBase64
                if (base64 && base64.length > 100) {
                    const cleanBase64 = base64.replace(/^data:image\/[^;]+;base64,/, '')
                    const mimeMatch = base64.match(/^data:(image\/[^;]+);base64,/)
                    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png'
                    screenshotData.push({
                        symbol: screenshotRecord.symbol || '',
                        side: screenshotRecord.side || '',
                        timeframe: '',
                        base64: cleanBase64,
                        mimeType
                    })
                }
            }

            const hasScreenshot = screenshotData.length > 0 && provider !== 'ollama' && provider !== 'deepseek'

            // Trading-Metadaten laden (SL/TP, Fills, BE etc.)
            let tradingMeta = null
            if (noteRecord?.tradingMetadata) {
                try {
                    tradingMeta = typeof noteRecord.tradingMetadata === 'string'
                        ? JSON.parse(noteRecord.tradingMetadata)
                        : noteRecord.tradingMetadata
                } catch (e) { /* ignore parse errors */ }
            }

            // Trade-Daten aufbereiten
            const t = tradeData
            const side = t.side === 'B' ? 'Long' : 'Short'
            const pnl = t.netProceeds || 0
            const pnlFormatted = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`
            const volume = (t.buyQuantity || 0) + (t.sellQuantity || 0)
            const tradeType = noteRecord?.tradeType || ''
            const entryStress = noteRecord?.entryStressLevel || 0
            const closingStress = noteRecord?.closingStressLevel || 0

            // Prompt zusammenbauen
            let reviewPrompt = `Du bist ein erfahrener Crypto-Trading-Coach. Analysiere diesen Trade und gib eine detaillierte, aber kompakte Bewertung.

TRADE-DATEN:
- Symbol: ${t.symbol || 'Unknown'}
- Position: ${side}
- Volumen: ${volume}
- Einstiegspreis: ${t.entryPrice ? '$' + t.entryPrice.toFixed(4) : 'N/A'}
- Ausstiegspreis: ${t.exitPrice ? '$' + t.exitPrice.toFixed(4) : 'N/A'}
- PnL: ${pnlFormatted}
- PnL/Vol: ${t.grossSharePL ? '$' + t.grossSharePL.toFixed(4) : 'N/A'}
- Ergebnis: ${pnl >= 0 ? 'Gewinn' : 'Verlust'}
- Selbstbewertung: ${satisfaction}`

            // Trade-Typ
            if (tradeType) {
                reviewPrompt += `\n- Trade-Typ: ${tradeType}`
            }

            // Stress-Level
            if (entryStress > 0 || closingStress > 0) {
                reviewPrompt += `\n- Stress bei Eröffnung: ${entryStress}/10${closingStress > 0 ? `, bei Schließung: ${closingStress}/10` : ''}`
            }

            // Trading-Metadaten (SL/TP, Fills, Positionsgröße, BE)
            if (tradingMeta) {
                reviewPrompt += `\n\nRISIKOMANAGEMENT & POSITIONSDATEN:`

                if (tradingMeta.margin && tradingMeta.leverage) {
                    reviewPrompt += `\n- Marge: $${tradingMeta.margin.toFixed(2)} × ${tradingMeta.leverage}x Hebel = Positionsgröße $${tradingMeta.positionSize?.toFixed(2) || 'N/A'}`
                }

                if (tradingMeta.sl) {
                    reviewPrompt += `\n- Stop-Loss: $${tradingMeta.sl}`
                }
                if (tradingMeta.tp) {
                    reviewPrompt += `\n- Take-Profit: $${tradingMeta.tp}`
                }
                if (tradingMeta.breakeven) {
                    reviewPrompt += `\n- Breakeven: $${tradingMeta.breakeven}`
                }
                if (tradingMeta.slAboveBreakeven !== undefined) {
                    reviewPrompt += `\n- SL über Breakeven: ${tradingMeta.slAboveBreakeven ? 'Ja (abgesichert)' : 'Nein (in Verlustzone)'}`
                }

                // RRR berechnen
                if (tradingMeta.sl && tradingMeta.tp && t.entryPrice) {
                    const entry = t.entryPrice
                    const sl = parseFloat(tradingMeta.sl)
                    const tp = parseFloat(tradingMeta.tp)
                    const riskDist = Math.abs(entry - sl)
                    const rewardDist = Math.abs(entry - tp)
                    if (riskDist > 0) {
                        const rrr = (rewardDist / riskDist).toFixed(2)
                        reviewPrompt += `\n- Risk/Reward Ratio (RRR): 1:${rrr}`
                    }
                }

                // Fills (Nachkäufe, Teilschließungen)
                if (tradingMeta.fills && tradingMeta.fills.length > 1) {
                    const entries = tradingMeta.fills.filter(f => !f.reduceOnly)
                    const closes = tradingMeta.fills.filter(f => f.reduceOnly)

                    if (entries.length > 1) {
                        reviewPrompt += `\n- Positionsaufbau: ${entries.length} Einstiege (Nachkäufe)`
                        entries.forEach((f, i) => {
                            reviewPrompt += `\n  ${i + 1}. ${f.qty} × $${f.price}`
                        })
                    }
                    if (closes.length > 0) {
                        reviewPrompt += `\n- Teilschließungen: ${closes.length}`
                        closes.forEach((f, i) => {
                            reviewPrompt += `\n  ${i + 1}. ${f.qty} × $${f.price}`
                        })
                    }
                }

                // SL/TP Verschiebungen
                if (tradingMeta.tpslHistory && tradingMeta.tpslHistory.length > 0) {
                    reviewPrompt += `\n\nSL/TP PROTOKOLL (Verschiebungen):`
                    tradingMeta.tpslHistory.forEach(h => {
                        const timeStr = new Date(h.time).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                        if (h.action === 'set') {
                            reviewPrompt += `\n- ${timeStr}: ${h.type} gesetzt auf $${h.newVal}`
                        } else if (h.action === 'moved') {
                            reviewPrompt += `\n- ${timeStr}: ${h.type} verschoben $${h.oldVal} → $${h.newVal}`
                        } else if (h.action === 'triggered') {
                            reviewPrompt += `\n- ${timeStr}: ${h.type} ausgelöst bei $${h.oldVal}`
                        } else if (h.action === 'removed') {
                            reviewPrompt += `\n- ${timeStr}: ${h.type} entfernt (war $${h.oldVal})`
                        }
                    })
                }
            }

            if (tradeTags) {
                reviewPrompt += `\n- Tags/Strategie: ${tradeTags}`
            }
            if (playbook) {
                reviewPrompt += `\n- Playbook: ${playbook}`
            }

            // User-Notizen und Überlegungen einbeziehen
            const userContext = [userNote, entryNote, closingNote].filter(Boolean).join('\n')
            if (userContext) {
                reviewPrompt += `\n\nNOTIZEN DES TRADERS (seine Überlegungen und Einschätzung):\n${userContext}`
            }
            if (feelings) {
                reviewPrompt += `\n\nEmotionaler Zustand: ${feelings}`
            }

            if (hasScreenshot) {
                reviewPrompt += `\n\nCHART-SCREENSHOT ANALYSE:
Der beigefügte Screenshot zeigt den TradingView-Chart dieses Trades. DER SCREENSHOT IST DIE PRIMAERE QUELLE FUER SL/TP-INFORMATIONEN.

**WICHTIG — SL und TP aus dem Chart ABLESEN:**
Die farbigen Rechtecke im Chart SIND die dokumentierten Stop-Loss- und Take-Profit-Zonen des Traders.
Der Trader HAT SL und TP gesetzt — sie sind als Rechtecke im Chart eingezeichnet UND die Preise werden als Zahlen an der Y-Achse (rechte Seite) angezeigt!

**So liest du die Preise ab:**
1. Schau auf die Y-ACHSE (rechte Seite des Charts) — dort stehen die Preisniveaus als ZAHLEN
2. Die OBERKANTE und UNTERKANTE jedes Rechtecks entspricht einem ablesbaren Preis auf der Y-Achse
3. Farbige Preis-Labels mit farbigem Hintergrund an der Y-Achse markieren die exakten Niveaus:
   - ROT hinterlegtes Preis-Label = SL-Niveau oder aktueller Kurs
   - GRUEN/TUERKIS hinterlegtes Preis-Label = TP-Niveau
   - GRAU/WEISS hinterlegte Labels = andere Niveaus (z.B. MA-Werte)
4. Lies die ZAHLEN direkt von der Y-Achse ab und nenne sie in deiner Bewertung

- ROTES Rechteck = Stop-Loss-Zone (SL)
- GRUENES/TUERKISES Rechteck = Take-Profit-Zone (TP)
- SHORT-Position: Rotes Rechteck OBEN (SL) + Gruenes Rechteck UNTEN (TP)
- LONG-Position: Gruenes Rechteck OBEN (TP) + Rotes Rechteck UNTEN (SL)
- Die Grenze/Kante zwischen den beiden Rechtecken = ungefaehrer Entry-Bereich
- BERECHNE das RRR: Abstand Entry-zu-TP geteilt durch Abstand Entry-zu-SL

SAGE NIEMALS "kein SL dokumentiert" oder "kein TP dokumentiert" — die Rechtecke IM CHART sind die SL/TP-Dokumentation!
Nenne IMMER die konkreten Preisniveaus die du von der Y-Achse abliest.

**Chart-Elemente erkennen:**
- Kerzenmuster (Doji, Hammer, Engulfing etc.) am Entry/Exit
- Trendlinien, Support/Resistance (horizontale Linien)
- Gleitende Durchschnitte (gelbe/orange/weisse Linien = MAs)
- Indikatoren: GUSS, LSOB, VRVP falls im Chart-Header sichtbar
- Marktstruktur: Higher Highs/Lows, Lower Highs/Lows, Konsolidierung
- Labels im Chart wie "GUSS Start", "GUSS Entry" = Indikator-Signale

**Bewerte im Screenshot:**
- War der Entry an einer sinnvollen Stelle (Support/Resistance, Trendwende, Indikator-Signal)?
- BERECHNE das RRR aus den Rechtecken und nenne es explizit (z.B. "RRR = 1:1.8")
- War der SL sinnvoll platziert (ueber/unter Struktur, nicht zu eng/weit)?
- War der TP realistisch (an naechster Support/Resistance-Zone)?
- Gab es Warnsignale im Chart die gegen den Trade sprachen?`
            }

            reviewPrompt += `\n\nBewerte folgende Punkte:
1. **Trade-Analyse**: ${hasScreenshot ? 'Lies zuerst SL, TP und Entry aus den farbigen Rechtecken im Chart ab (Y-Achse rechts). Nenne die konkreten Preise und berechne das RRR. Dann bewerte ob die Platzierung gut war.' : 'War der Einstieg/Ausstieg gut gewaehlt?'} Passte die Positionsgroesse?
2. **Risikomanagement**: ${tradingMeta ? 'Bewerte SL/TP-Platzierung, RRR, Positionsgroesse relativ zur Marge, und ob der SL ueber Breakeven gezogen wurde. Waren die SL/TP-Verschiebungen sinnvoll?' : 'Wurde ein SL/TP gesetzt? War das Risiko kontrolliert?'}
3. **Positionsaufbau**: ${tradingMeta?.fills?.length > 1 ? 'Bewerte die Nachkaeufe und Teilschliessungen. War der Positionsaufbau sinnvoll? Wurde richtig skaliert?' : 'War der Einstieg in einem Schritt oder gestaffelt?'}
4. **Ueberlegungen des Traders**: Waren die Gedanken/Ueberlegungen nachvollziehbar?${hasScreenshot ? ' SL/TP sind im Chart als Rechtecke eingezeichnet und werden rechts an der Y-Achse als Zahlen angezeigt — das ZAEHLT als dokumentiert, bewerte sie NICHT als fehlend!' : ''}
5. **Fehler & Verbesserungen**: Was haette besser sein koennen?${hasScreenshot ? ' Bewerte die QUALITAET der SL/TP-Platzierung im Chart, nicht ob sie fehlen.' : ''}
6. **Konkrete Tipps**: 1-2 spezifische Verbesserungsvorschlaege.
7. **Gesamtnote**: Note von 1-10 (10 = perfekt).

Antworte auf Deutsch. Kompakt (max 500 Woerter). Markdown.`

            const screenshots = hasScreenshot ? screenshotData : []

            let result
            if (provider === 'ollama') {
                result = await generateOllama(reviewPrompt, model || 'llama3.2:latest', temperature, maxTokens, ollamaUrl)
            } else if (provider === 'openai') {
                result = await generateOpenAI(reviewPrompt, apiKey, model || 'gpt-4o-mini', temperature, maxTokens, screenshots)
            } else if (provider === 'anthropic') {
                result = await generateAnthropic(reviewPrompt, apiKey, model || 'claude-sonnet-4-5-20250929', temperature, maxTokens, screenshots)
            } else if (provider === 'gemini') {
                result = await generateGemini(reviewPrompt, apiKey, model || 'gemini-2.0-flash', temperature, maxTokens, screenshots)
            } else if (provider === 'deepseek') {
                result = await generateDeepSeek(reviewPrompt, apiKey, model || 'deepseek-chat', temperature, maxTokens)
            } else {
                return res.status(400).json({ error: 'Unbekannter KI-Anbieter: ' + provider })
            }

            // Bewertung in notes speichern (upsert)
            if (noteRecord) {
                await knex('notes').where('tradeId', tradeId).update({
                    aiReview: result.text,
                    aiReviewProvider: provider,
                    aiReviewModel: model || provider,
                    updatedAt: knex.fn.now()
                })
            } else {
                await knex('notes').insert({
                    tradeId,
                    dateUnix: dateUnix || 0,
                    note: '',
                    aiReview: result.text,
                    aiReviewProvider: provider,
                    aiReviewModel: model || provider
                })
            }

            res.json({
                review: result.text,
                provider,
                model: model || provider,
                tokenUsage: result.usage
            })
        } catch (e) {
            console.error('Trade review error:', e)
            res.status(500).json({ error: e.message || 'Trade-Bewertung fehlgeschlagen' })
        }
    })

    // --- Trade-Review laden ---
    app.get('/api/ai/trade-review/:tradeId', async (req, res) => {
        try {
            const knex = getKnex()
            const note = await knex('notes').where('tradeId', req.params.tradeId).first()
            if (note?.aiReview) {
                res.json({
                    review: note.aiReview,
                    provider: note.aiReviewProvider || '',
                    model: note.aiReviewModel || ''
                })
            } else {
                res.json({ review: '', provider: '', model: '' })
            }
        } catch (e) {
            console.error('Load trade review error:', e)
            res.status(500).json({ error: e.message })
        }
    })

    // --- KI-Einstellungen mit Verschlüsselung ---

    // KI-Settings speichern (verschlüsselt die API-Keys)
    app.post('/api/ai/settings', async (req, res) => {
        try {
            const knex = getKnex()
            const { aiProvider, aiModel, aiOllamaUrl, aiTemperature, aiMaxTokens, aiScreenshots, aiReportPrompt, aiChatEnabled, keys } = req.body

            // Basis-Settings
            await knex('settings').where('id', 1).update({
                aiProvider: aiProvider || 'ollama',
                aiModel: aiModel || '',
                aiOllamaUrl: aiOllamaUrl || 'http://localhost:11434',
                aiTemperature: aiTemperature ?? 0.7,
                aiMaxTokens: aiMaxTokens || 1500,
                aiScreenshots: aiScreenshots ? 1 : 0,
                aiReportPrompt: aiReportPrompt || '',
                aiChatEnabled: aiChatEnabled !== undefined ? (aiChatEnabled ? 1 : 0) : 1
            })

            // API-Keys verschlüsselt speichern (nur wenn nicht maskiert)
            if (keys) {
                if (keys.openai !== undefined && !keys.openai.includes('•')) {
                    await knex('settings').where('id', 1).update({ aiKeyOpenai: keys.openai ? encrypt(keys.openai) : '' })
                }
                if (keys.anthropic !== undefined && !keys.anthropic.includes('•')) {
                    await knex('settings').where('id', 1).update({ aiKeyAnthropic: keys.anthropic ? encrypt(keys.anthropic) : '' })
                }
                if (keys.gemini !== undefined && !keys.gemini.includes('•')) {
                    await knex('settings').where('id', 1).update({ aiKeyGemini: keys.gemini ? encrypt(keys.gemini) : '' })
                }
                if (keys.deepseek !== undefined && !keys.deepseek.includes('•')) {
                    await knex('settings').where('id', 1).update({ aiKeyDeepseek: keys.deepseek ? encrypt(keys.deepseek) : '' })
                }
            }

            res.json({ success: true })
        } catch (e) {
            console.error('Save AI settings error:', e)
            res.status(500).json({ error: e.message })
        }
    })

    // KI-Settings laden (Keys maskiert zurückgeben)
    app.get('/api/ai/settings', async (req, res) => {
        try {
            const knex = getKnex()
            const settings = await knex('settings')
                .select('aiProvider', 'aiModel', 'aiOllamaUrl', 'aiTemperature', 'aiMaxTokens', 'aiScreenshots', 'aiReportPrompt', 'aiChatEnabled', 'aiKeyOpenai', 'aiKeyAnthropic', 'aiKeyGemini', 'aiKeyDeepseek')
                .where('id', 1).first()

            // Keys maskieren: "sk-abc...xyz" → "sk-a•••xyz"
            function maskKey(encryptedKey) {
                if (!encryptedKey) return ''
                const key = decrypt(encryptedKey)
                if (!key) return ''
                if (key.length <= 8) return '•'.repeat(key.length)
                return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 20)) + key.slice(-4)
            }

            res.json({
                aiProvider: settings?.aiProvider || 'ollama',
                aiModel: settings?.aiModel || '',
                aiOllamaUrl: settings?.aiOllamaUrl || 'http://localhost:11434',
                aiTemperature: settings?.aiTemperature ?? 0.7,
                aiMaxTokens: settings?.aiMaxTokens || 1500,
                aiScreenshots: settings?.aiScreenshots === 1,
                aiReportPrompt: settings?.aiReportPrompt || '',
                aiChatEnabled: settings?.aiChatEnabled !== 0,
                keys: {
                    openai: maskKey(settings?.aiKeyOpenai),
                    anthropic: maskKey(settings?.aiKeyAnthropic),
                    gemini: maskKey(settings?.aiKeyGemini),
                    deepseek: maskKey(settings?.aiKeyDeepseek)
                }
            })
        } catch (e) {
            console.error('Load AI settings error:', e)
            res.status(500).json({ error: e.message })
        }
    })

    // --- Gespeicherte Berichte ---

    // Bericht speichern
    app.post('/api/ai/reports/save', async (req, res) => {
        const { label, startDate, endDate, provider, model, report, reportData, tokenUsage } = req.body
        if (!report) return res.status(400).json({ error: 'Kein Bericht zum Speichern' })
        try {
            const knex = getKnex()
            const tokens = tokenUsage || {}
            const [inserted] = await knex('ai_reports').insert({
                label: label || '',
                startDate: startDate || 0,
                endDate: endDate || 0,
                provider: provider || '',
                model: model || '',
                report,
                reportData: JSON.stringify(reportData || {}),
                promptTokens: tokens.promptTokens || 0,
                completionTokens: tokens.completionTokens || 0,
                totalTokens: tokens.totalTokens || 0
            }).returning('id')
            const id = typeof inserted === 'object' ? inserted.id : inserted
            res.json({ success: true, id })
        } catch (e) {
            console.error('Save report error:', e)
            res.status(500).json({ error: e.message })
        }
    })

    // Alle Berichte laden (neueste zuerst, optional nach Broker gefiltert)
    app.get('/api/ai/reports', async (req, res) => {
        try {
            const knex = getKnex()
            const broker = req.query.broker || ''
            let query = knex('ai_reports')
            if (broker) {
                query = query.where('broker', broker)
            }
            const reports = await query.orderBy('id', 'desc')
            // reportData JSON parsen
            for (const r of reports) {
                try {
                    r.reportData = JSON.parse(r.reportData || '{}')
                } catch (e) {
                    logWarn('ollama-api', `Invalid reportData JSON for ai_reports.id=${r.id}, using fallback object`, e)
                    r.reportData = {}
                }
            }
            res.json(reports)
        } catch (e) {
            logError('ollama-api', 'Load reports error', e)
            res.json([])
        }
    })

    // Bericht löschen
    app.delete('/api/ai/reports/:id', async (req, res) => {
        const id = parseId(req.params.id, res)
        if (id === null) return
        try {
            const knex = getKnex()
            await knex('ai_reports').where('id', id).del()
            // Chat-Nachrichten mitlöschen
            await knex('ai_report_messages').where('reportId', id).del()
            res.json({ success: true })
        } catch (e) {
            console.error('Delete report error:', e)
            res.status(500).json({ error: e.message })
        }
    })

    // --- Chat/Rückfragen zu Berichten ---

    // Chat-Verlauf laden
    app.get('/api/ai/reports/:reportId/messages', async (req, res) => {
        const reportId = parseId(req.params.reportId, res, 'reportId')
        if (reportId === null) return
        try {
            const knex = getKnex()
            const messages = await knex('ai_report_messages')
                .where('reportId', reportId)
                .orderBy('id', 'asc')
            res.json(messages)
        } catch (e) {
            console.error('Load chat messages error:', e)
            res.json([])
        }
    })

    // Chat-Verlauf löschen
    app.delete('/api/ai/reports/:reportId/messages', async (req, res) => {
        const reportId = parseId(req.params.reportId, res, 'reportId')
        if (reportId === null) return
        try {
            const knex = getKnex()
            await knex('ai_report_messages').where('reportId', reportId).del()
            res.json({ success: true })
        } catch (e) {
            console.error('Delete chat messages error:', e)
            res.status(500).json({ error: e.message })
        }
    })

    // Rückfrage an KI senden
    app.post('/api/ai/reports/:reportId/chat', async (req, res) => {
        const reportId = parseId(req.params.reportId, res, 'reportId')
        if (reportId === null) return
        const { message } = req.body
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Nachricht darf nicht leer sein' })
        }

        try {
            const knex = getKnex()

            // Report laden
            const report = await knex('ai_reports').where('id', reportId).first()
            if (!report) {
                return res.status(404).json({ error: 'Bericht nicht gefunden' })
            }

            // KI-Settings laden
            const settings = await knex('settings')
                .select('aiProvider', 'aiModel', 'aiTemperature', 'aiMaxTokens', 'aiOllamaUrl', 'aiKeyOpenai', 'aiKeyAnthropic', 'aiKeyGemini', 'aiKeyDeepseek')
                .where('id', 1).first()
            const provider = settings?.aiProvider || 'ollama'
            const model = settings?.aiModel || ''
            const temperature = settings?.aiTemperature ?? 0.7
            const maxTokens = settings?.aiMaxTokens || 1500
            const ollamaUrl = settings?.aiOllamaUrl || DEFAULT_OLLAMA_URL
            const apiKey = getApiKeyForProvider(settings, provider)

            // Bisherige Chat-Nachrichten laden
            const chatHistory = await knex('ai_report_messages')
                .where('reportId', reportId)
                .orderBy('id', 'asc')

            // Konversation aufbauen
            const systemMsg = 'Du bist ein erfahrener Trading-Analyst und Coach. Du hast den folgenden Bericht erstellt. Beantworte Rückfragen des Nutzers basierend auf diesem Bericht und den zugrunde liegenden Daten. Antworte auf Deutsch. Verwende Markdown-Formatierung.'
            const messages = [
                { role: 'assistant', content: report.report }
            ]
            for (const msg of chatHistory) {
                messages.push({ role: msg.role, content: msg.content })
            }
            messages.push({ role: 'user', content: message.trim() })

            // An Provider senden
            let result
            if (provider === 'ollama') {
                result = await chatOllama(systemMsg, messages, model || 'llama3.2:latest', temperature, maxTokens, ollamaUrl)
            } else if (provider === 'openai') {
                result = await chatOpenAI(systemMsg, messages, apiKey, model || 'gpt-4o-mini', temperature, maxTokens)
            } else if (provider === 'anthropic') {
                result = await chatAnthropic(systemMsg, messages, apiKey, model || 'claude-sonnet-4-5-20250929', temperature, maxTokens)
            } else if (provider === 'gemini') {
                result = await chatGemini(systemMsg, messages, apiKey, model || 'gemini-2.0-flash', temperature, maxTokens)
            } else if (provider === 'deepseek') {
                result = await chatOpenAI(systemMsg, messages, apiKey, model || 'deepseek-chat', temperature, maxTokens, 'https://api.deepseek.com/v1/chat/completions')
            } else {
                return res.status(400).json({ error: 'Unbekannter KI-Anbieter: ' + provider })
            }

            // User-Frage speichern
            await knex('ai_report_messages').insert({
                reportId: reportId,
                role: 'user',
                content: message.trim(),
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0
            })

            // KI-Antwort speichern
            await knex('ai_report_messages').insert({
                reportId: reportId,
                role: 'assistant',
                content: result.text,
                promptTokens: result.usage?.promptTokens || 0,
                completionTokens: result.usage?.completionTokens || 0,
                totalTokens: result.usage?.totalTokens || 0
            })

            res.json({
                reply: result.text,
                tokenUsage: result.usage
            })
        } catch (e) {
            console.error('Chat error:', e)
            res.status(500).json({ error: e.message || 'Chat-Anfrage fehlgeschlagen' })
        }
    })
}

// --- Provider-spezifische Generate-Funktionen ---

async function generateOllama(prompt, model, temperature, maxTokens, ollamaUrl) {
    const url = ollamaUrl || await getOllamaUrl()

    // Verwende http/https direkt statt fetch(), da Node.js fetch (undici)
    // einen headersTimeout von 300s hat, der bei großen Modellen (7B+) nicht reicht.
    const { URL } = await import('url')
    const parsedUrl = new URL(`${url}/api/generate`)
    const httpModule = parsedUrl.protocol === 'https:' ? await import('https') : await import('http')

    const postData = JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature, num_predict: maxTokens }
    })

    return new Promise((resolve, reject) => {
        const req = httpModule.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 600000 // 10 Min Timeout für große Modelle (14B+)
        }, (res) => {
            let body = ''
            res.on('data', chunk => body += chunk)
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    return reject(new Error('Ollama-Fehler: ' + body))
                }
                try {
                    const data = JSON.parse(body)
                    resolve({
                        text: data.response,
                        usage: {
                            promptTokens: data.prompt_eval_count || 0,
                            completionTokens: data.eval_count || 0,
                            totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
                        }
                    })
                } catch (e) {
                    reject(new Error('Ollama-Antwort ungültig: ' + e.message))
                }
            })
        })

        req.on('timeout', () => {
            req.destroy()
            reject(new Error('Ollama Timeout: Modell braucht zu lange (>10 Min)'))
        })
        req.on('error', (e) => reject(new Error('Ollama nicht erreichbar: ' + e.message)))

        req.write(postData)
        req.end()
    })
}

async function generateOpenAI(prompt, apiKey, model, temperature, maxTokens, screenshots = []) {
    // Multimodal content aufbauen
    const userContent = []

    // Screenshots als Bilder hinzufügen
    for (const s of screenshots) {
        userContent.push({
            type: 'image_url',
            image_url: {
                url: `data:${s.mimeType};base64,${s.base64}`,
                detail: 'low'  // Kosten sparen
            }
        })
        userContent.push({
            type: 'text',
            text: `[Chart: ${s.symbol} ${s.side}${s.timeframe ? ' TF:' + s.timeframe : ''}]`
        })
    }

    // Prompt als Text
    userContent.push({ type: 'text', text: prompt })

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
                { role: 'user', content: screenshots.length > 0 ? userContent : prompt }
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
    return {
        text: data.choices?.[0]?.message?.content || '',
        usage: {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0,
            totalTokens: data.usage?.total_tokens || 0
        }
    }
}

async function generateAnthropic(prompt, apiKey, model, temperature, maxTokens, screenshots = []) {
    // Multimodal content aufbauen
    const userContent = []

    // Screenshots als Bilder hinzufügen
    for (const s of screenshots) {
        userContent.push({
            type: 'image',
            source: {
                type: 'base64',
                media_type: s.mimeType,
                data: s.base64
            }
        })
        userContent.push({
            type: 'text',
            text: `[Chart: ${s.symbol} ${s.side}${s.timeframe ? ' TF:' + s.timeframe : ''}]`
        })
    }

    // Prompt als Text
    userContent.push({ type: 'text', text: prompt })

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
            messages: [{ role: 'user', content: screenshots.length > 0 ? userContent : prompt }],
            temperature
        })
    })

    if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error('Anthropic-Fehler: ' + (err.error?.message || response.statusText))
    }

    const data = await response.json()
    return {
        text: data.content?.[0]?.text || '',
        usage: {
            promptTokens: data.usage?.input_tokens || 0,
            completionTokens: data.usage?.output_tokens || 0,
            totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
        }
    }
}

async function generateGemini(prompt, apiKey, model, temperature, maxTokens, screenshots = []) {
    // Gemini API: multimodal content aufbauen
    const parts = []

    // System-Instruktion als ersten Text-Part
    parts.push({ text: 'Du bist ein erfahrener Trading-Analyst und Coach. Antworte auf Deutsch. Verwende Markdown-Formatierung.' })

    // Screenshots als inline_data hinzufügen
    for (const s of screenshots) {
        parts.push({
            inline_data: {
                mime_type: s.mimeType,
                data: s.base64
            }
        })
        parts.push({ text: `[Chart: ${s.symbol} ${s.side}${s.timeframe ? ' TF:' + s.timeframe : ''}]` })
    }

    // Prompt als Text
    parts.push({ text: prompt })

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
                temperature,
                maxOutputTokens: maxTokens
            }
        })
    })

    if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error('Gemini-Fehler: ' + (err.error?.message || response.statusText))
    }

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const usageMeta = data.usageMetadata || {}
    return {
        text,
        usage: {
            promptTokens: usageMeta.promptTokenCount || 0,
            completionTokens: usageMeta.candidatesTokenCount || 0,
            totalTokens: usageMeta.totalTokenCount || 0
        }
    }
}

async function generateDeepSeek(prompt, apiKey, model, temperature, maxTokens) {
    // DeepSeek API ist OpenAI-kompatibel, aber KEIN Multimodal-Support
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
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
        throw new Error('DeepSeek-Fehler: ' + (err.error?.message || response.statusText))
    }

    const data = await response.json()
    return {
        text: data.choices?.[0]?.message?.content || '',
        usage: {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0,
            totalTokens: data.usage?.total_tokens || 0
        }
    }
}

// --- Chat-Funktionen (Multi-Turn Konversation) ---

async function chatOllama(systemMsg, messages, model, temperature, maxTokens, ollamaUrl) {
    const url = ollamaUrl || await getOllamaUrl()

    // Ollama /api/chat Format: messages array mit role/content
    const ollamaMessages = [
        { role: 'system', content: systemMsg },
        ...messages
    ]

    const { URL } = await import('url')
    const parsedUrl = new URL(`${url}/api/chat`)
    const httpModule = parsedUrl.protocol === 'https:' ? await import('https') : await import('http')

    const postData = JSON.stringify({
        model,
        messages: ollamaMessages,
        stream: false,
        options: { temperature, num_predict: maxTokens }
    })

    return new Promise((resolve, reject) => {
        const req = httpModule.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 600000
        }, (res) => {
            let body = ''
            res.on('data', chunk => body += chunk)
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    return reject(new Error('Ollama-Chat-Fehler: ' + body))
                }
                try {
                    const data = JSON.parse(body)
                    resolve({
                        text: data.message?.content || '',
                        usage: {
                            promptTokens: data.prompt_eval_count || 0,
                            completionTokens: data.eval_count || 0,
                            totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
                        }
                    })
                } catch (e) {
                    reject(new Error('Ollama-Chat-Antwort ungültig: ' + e.message))
                }
            })
        })

        req.on('timeout', () => {
            req.destroy()
            reject(new Error('Ollama Chat Timeout (>10 Min)'))
        })
        req.on('error', (e) => reject(new Error('Ollama nicht erreichbar: ' + e.message)))

        req.write(postData)
        req.end()
    })
}

async function chatOpenAI(systemMsg, messages, apiKey, model, temperature, maxTokens, endpoint = 'https://api.openai.com/v1/chat/completions') {
    // OpenAI/DeepSeek Chat: messages array
    const apiMessages = [
        { role: 'system', content: systemMsg },
        ...messages
    ]

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            messages: apiMessages,
            temperature,
            max_tokens: maxTokens
        })
    })

    if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error('Chat-Fehler: ' + (err.error?.message || response.statusText))
    }

    const data = await response.json()
    return {
        text: data.choices?.[0]?.message?.content || '',
        usage: {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0,
            totalTokens: data.usage?.total_tokens || 0
        }
    }
}

async function chatAnthropic(systemMsg, messages, apiKey, model, temperature, maxTokens) {
    // Anthropic: system als separater Parameter, messages array
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
            system: systemMsg,
            messages,
            temperature
        })
    })

    if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error('Chat-Fehler: ' + (err.error?.message || response.statusText))
    }

    const data = await response.json()
    return {
        text: data.content?.[0]?.text || '',
        usage: {
            promptTokens: data.usage?.input_tokens || 0,
            completionTokens: data.usage?.output_tokens || 0,
            totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
        }
    }
}

async function chatGemini(systemMsg, messages, apiKey, model, temperature, maxTokens) {
    // Gemini: contents array mit parts
    const contents = []

    for (const msg of messages) {
        contents.push({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        })
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemMsg }] },
            contents,
            generationConfig: {
                temperature,
                maxOutputTokens: maxTokens
            }
        })
    })

    if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error('Chat-Fehler: ' + (err.error?.message || response.statusText))
    }

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const usageMeta = data.usageMetadata || {}
    return {
        text,
        usage: {
            promptTokens: usageMeta.promptTokenCount || 0,
            completionTokens: usageMeta.candidatesTokenCount || 0,
            totalTokens: usageMeta.totalTokenCount || 0
        }
    }
}

// --- Ollama Status Check ---

async function checkOllamaStatus(res, ollamaUrl, model = '') {
    const url = ollamaUrl || await getOllamaUrl()
    try {
        const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) })
        if (response.ok) {
            const data = await response.json()
            const models = data.models || []
            return res.json({ online: true, provider: 'ollama', model, models: models.map(m => m.name) })
        }
        return res.json({ online: false, provider: 'ollama', model, models: [] })
    } catch (e) {
        return res.json({ online: false, provider: 'ollama', model, models: [] })
    }
}

async function checkOpenAIStatus(apiKey, res, model = '') {
    if (!apiKey) return res.json({ online: false, provider: 'openai', model, message: 'Kein API-Key konfiguriert' })
    try {
        const response = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5000)
        })
        return res.json({ online: response.ok, provider: 'openai', model })
    } catch (e) {
        return res.json({ online: false, provider: 'openai', model })
    }
}

async function checkAnthropicStatus(apiKey, res, model = '') {
    if (!apiKey) return res.json({ online: false, provider: 'anthropic', model, message: 'Kein API-Key konfiguriert' })
    return res.json({ online: true, provider: 'anthropic', model })
}

async function checkGeminiStatus(apiKey, res, model = '') {
    if (!apiKey) return res.json({ online: false, provider: 'gemini', model, message: 'Kein API-Key konfiguriert' })
    try {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
            headers: { 'x-goog-api-key': apiKey },
            signal: AbortSignal.timeout(5000)
        })
        return res.json({ online: response.ok, provider: 'gemini', model })
    } catch (e) {
        return res.json({ online: false, provider: 'gemini', model })
    }
}

async function checkDeepseekStatus(apiKey, res, model = '') {
    if (!apiKey) return res.json({ online: false, provider: 'deepseek', model, message: 'Kein API-Key konfiguriert' })
    try {
        const response = await fetch('https://api.deepseek.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5000)
        })
        return res.json({ online: response.ok, provider: 'deepseek', model })
    } catch (e) {
        return res.json({ online: false, provider: 'deepseek', model })
    }
}

// --- Screenshot-Sammlung für Chart-Analyse ---

async function collectScreenshots(knex, startDate, endDate, maxCount = 4) {
    // Sammle Screenshots aus dem Zeitraum — priorisiere die mit den größten Trades
    try {
        const screenshots = await knex('screenshots as s')
            .leftJoin('notes as n', function () {
                this.on('n.screenshotId', '=', knex.raw('CAST(s.id AS TEXT)'))
            })
            .select('s.id', 's.symbol', 's.side', 's.annotatedBase64', 's.originalBase64', 's.dateUnix', 'n.tradeId', 'n.timeframe')
            .where('s.dateUnix', '>=', startDate)
            .where('s.dateUnix', '<=', endDate)
            .where(function () {
                this.where('s.annotatedBase64', '!=', '').orWhere('s.originalBase64', '!=', '')
            })
            .orderBy('s.dateUnix', 'desc')
            .limit(maxCount)

        return screenshots.map(s => {
            // Bevorzuge annotated (mit Markierungen), dann original
            const base64 = s.annotatedBase64 || s.originalBase64
            // Entferne data:image/...;base64, prefix falls vorhanden
            const cleanBase64 = base64.replace(/^data:image\/[^;]+;base64,/, '')
            // Bestimme den MIME type
            const mimeMatch = base64.match(/^data:(image\/[^;]+);base64,/)
            const mimeType = mimeMatch ? mimeMatch[1] : 'image/png'
            return {
                symbol: s.symbol || 'Unknown',
                side: s.side === 'B' ? 'Long' : s.side === 'SS' ? 'Short' : s.side,
                timeframe: s.timeframe || '',
                base64: cleanBase64,
                mimeType,
                dateUnix: s.dateUnix
            }
        }).filter(s => s.base64.length > 100) // Filter leere/kaputte
    } catch (e) {
        console.error('Screenshot collection error:', e)
        return []
    }
}

// --- Daten-Sammlung und Prompt-Bau ---

async function collectReportData(knex, startDate, endDate, broker) {
    const trades = await knex('trades')
        .where('dateUnix', '>=', startDate)
        .where('dateUnix', '<=', endDate)

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
        try {
            tradesArr = JSON.parse(row.trades || '[]')
        } catch (e) {
            logWarn('ollama-api', `collectReportData: invalid trades JSON for dateUnix=${row.dateUnix}, using []`, e)
            tradesArr = []
        }

        // Filter trades by broker if specified
        if (broker) {
            tradesArr = tradesArr.filter(t => t.broker === broker)
            if (tradesArr.length === 0) continue
        }

        let pAndL = {}
        try {
            pAndL = JSON.parse(row.pAndL || '{}')
        } catch (e) {
            logWarn('ollama-api', `collectReportData: invalid pAndL JSON for dateUnix=${row.dateUnix}, using {}`, e)
            pAndL = {}
        }

        // Recalculate day PnL from filtered trades (broker-specific)
        let dayPnl = 0
        if (broker) {
            dayPnl = tradesArr.reduce((sum, t) => sum + (t.grossProceeds || 0), 0)
        } else {
            dayPnl = pAndL.grossProceeds || 0
        }
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

    // Long/Short detaillierte Stats
    let longWins = 0, longLosses = 0, longPnl = 0
    for (const t of longTrades) {
        const gp = t.grossProceeds || 0
        if (gp > 0) longWins++; else longLosses++
        longPnl += gp
    }
    let shortWins = 0, shortLosses = 0, shortPnl = 0
    for (const t of shortTrades) {
        const gp = t.grossProceeds || 0
        if (gp > 0) shortWins++; else shortLosses++
        shortPnl += gp
    }

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

    const notes = await knex('notes')
        .where('dateUnix', '>=', startDate)
        .where('dateUnix', '<=', endDate)

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

    const satisfactions = await knex('satisfactions')
        .where('dateUnix', '>=', startDate)
        .where('dateUnix', '<=', endDate)
    const satisfiedCount = satisfactions.filter(s => s.satisfaction === 1).length
    const satisfactionRate = satisfactions.length > 0
        ? ((satisfiedCount / satisfactions.length) * 100).toFixed(0) : 'N/A'

    const tagsRows = await knex('tags')
        .where('dateUnix', '>=', startDate)
        .where('dateUnix', '<=', endDate)

    const settings = await knex('settings').where('id', 1).first()
    let availableTags = []
    try {
        availableTags = JSON.parse(settings?.tags || '[]')
    } catch (e) {
        logWarn('ollama-api', 'collectReportData: invalid settings.tags JSON, using []', e)
        availableTags = []
    }

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
        try {
            tagIds = JSON.parse(row.tags || '[]')
        } catch (e) {
            logWarn('ollama-api', `collectReportData: invalid tags row JSON for tags.id=${row.id || 'unknown'}, using []`, e)
            tagIds = []
        }
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
        longWins, longLosses, longPnl,
        shortWins, shortLosses, shortPnl,
        topSymbols,
        avgStress, avgEmotion,
        satisfactionRate, journalCompleteness,
        tagUsage
    }
}

function buildPrompt(data, customPrompt = '') {
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

    // Long/Short Performance berechnen
    const longWins = data.longWins || 0
    const longLosses = data.longLosses || 0
    const shortWins = data.shortWins || 0
    const shortLosses = data.shortLosses || 0
    const longPnl = data.longPnl || 0
    const shortPnl = data.shortPnl || 0

    // Screenshot-Hinweis
    const screenshotHint = data.screenshots && data.screenshots.length > 0
        ? `\n\nCHART-SCREENSHOTS:\nEs wurden ${data.screenshots.length} Chart-Screenshots beigefügt. Analysiere die Charts und beziehe deine Beobachtungen in die Analyse ein (z.B. Einstiegspunkte, Trendrichtung, Unterstützungs-/Widerstandslinien, Kerzenmuster). Beachte den angegebenen Timeframe (TF) — der Screenshot kann auf einem anderen Timeframe aufgenommen worden sein als der tatsächliche Trade-Timeframe.`
        : ''

    return `Du bist ein erfahrener Trading-Analyst und Coach. Analysiere AUSSCHLIESSLICH die folgenden Daten aus dem Zeitraum ${zeitraum}.
Beziehe dich NUR auf diesen Zeitraum. Erfinde keine Daten.
Verwende Markdown-Formatierung (##, **, Listen).
Schreibe auf Deutsch.

ZEITRAUM: ${zeitraum}
HANDELSTAGE: ${data.tradingDays}

PERFORMANCE-DATEN:
- Trades gesamt: ${data.tradeCount} (Wins: ${data.wins}, Losses: ${data.losses})
- Win Rate: ${data.winRate}%
- Brutto PnL: ${data.totalGrossProceeds} USDT
- Netto PnL: ${data.totalNetProceeds} USDT
- Gebühren: ${data.totalFees} USDT
- Profit Factor: ${data.profitFactor}
- APPT (Durchschnittlicher Gewinn pro Trade): ${data.appt} USDT
- Bester Trade: ${data.bestTradePnl} USDT
- Schlechtester Trade: ${data.worstTradePnl} USDT
- Bester Tag: ${bestDayDt} (${data.bestDay.pnl !== -Infinity ? data.bestDay.pnl.toFixed(2) : 'N/A'} USDT)
- Schlechtester Tag: ${worstDayDt} (${data.worstDay.pnl !== Infinity ? data.worstDay.pnl.toFixed(2) : 'N/A'} USDT)

LONG vs. SHORT:
- Long: ${data.longCount} Trades (Wins: ${longWins}, Losses: ${longLosses}, PnL: ${longPnl.toFixed(2)} USDT)
- Short: ${data.shortCount} Trades (Wins: ${shortWins}, Losses: ${shortLosses}, PnL: ${shortPnl.toFixed(2)} USDT)

TOP SYMBOLE:
${symbolLines}

PSYCHOLOGIE-DATEN:
- Ø Stresslevel: ${data.avgStress}/5
- Ø Emotionslevel: ${data.avgEmotion}/10
- Zufriedenheitsrate: ${data.satisfactionRate}%
- Journal-Vollständigkeit: ${data.journalCompleteness}%

TAG-ANALYSE:
${tagLines}${screenshotHint}

Erstelle den Bericht mit diesen Abschnitten. Jeder Abschnitt MUSS konkrete Zahlen und Interpretationen enthalten — nicht nur die Daten wiederholen:

## Zusammenfassung
Fasse den Zeitraum ${zeitraum} in 3–4 Sätzen zusammen: Gesamtergebnis, wichtigste Kennzahl, größte Auffälligkeit.

## Performance-Analyse
Interpretiere die Zahlen: Ist die Win Rate gut genug für den Profit Factor? Wie hoch ist der Anteil der Gebühren am Brutto-PnL? Vergleiche Long vs. Short Performance. Welche Seite war profitabler und warum?

## Psychologische Auswertung
Was sagen Stress- und Emotionslevel über das Trading-Verhalten? Korreliert hoher Stress mit Verlusten? Wie ist die Zufriedenheit im Verhältnis zur Win Rate? Was bedeutet die Journal-Vollständigkeit für die Selbstreflexion?

## Top Symbole & Strategien
Welche Symbole waren am profitabelsten, welche haben Verluste verursacht? Gibt es eine Überkonzentration auf bestimmte Assets? Empfehlung zur Diversifikation.

## Stärken
Was hat der Trader gut gemacht? Sei spezifisch — nenne konkrete Zahlen als Beleg.

## Schwächen & Risiken
Was muss verbessert werden? Sei direkt und ehrlich. Nenne konkrete Probleme mit Zahlen.

## Empfehlungen für den nächsten Zeitraum
Gib 3–5 konkrete, umsetzbare Empfehlungen. Keine allgemeinen Floskeln — beziehe dich auf die spezifischen Schwächen aus den Daten.

WICHTIG: Dieser Bericht bezieht sich ausschließlich auf den Zeitraum ${zeitraum} (${data.tradeCount} Trades, ${data.tradingDays} Handelstage). Beschreibe nur die oben genannten Daten.${customPrompt ? `

ZUSÄTZLICHE ANWEISUNGEN DES NUTZERS:
${customPrompt}` : ''}`
}
