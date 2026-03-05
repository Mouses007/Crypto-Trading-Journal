/**
 * ai-agent.js — Autonomous KI-Agent with Tool Use / Function Calling.
 * Supports: Anthropic (native), OpenAI/DeepSeek (native), Gemini (native), Ollama (prompt-based fallback).
 * Agent loop: LLM calls tools → server executes → results fed back → LLM decides next step.
 * Communication: SSE streaming for live tool-step updates to frontend.
 */

import { getKnex } from './database.js'
import { decrypt } from './crypto.js'
import { logWarn, logError } from './logger.js'
import { AGENT_TOOLS, executeTool } from './ai-agent-tools.js'

const MAX_ITERATIONS = 10
const MAX_TOKENS = 80000
const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

// Concurrency guard — only one agent run at a time
let agentRunning = false

// ==================== HELPER: Load AI settings ====================

async function loadAiSettings() {
    const knex = getKnex()
    const settings = await knex('settings')
        .select('aiProvider', 'aiModel', 'aiApiKey', 'aiTemperature', 'aiMaxTokens', 'aiOllamaUrl',
            'aiKeyOpenai', 'aiKeyAnthropic', 'aiKeyGemini', 'aiKeyDeepseek')
        .where('id', 1).first()
    if (!settings) throw new Error('No AI settings found')

    const provider = settings.aiProvider || 'ollama'
    const keyMap = { openai: 'aiKeyOpenai', anthropic: 'aiKeyAnthropic', gemini: 'aiKeyGemini', deepseek: 'aiKeyDeepseek' }
    const col = keyMap[provider]
    let apiKey = ''
    if (col && settings[col]) {
        apiKey = decrypt(settings[col])
    } else if (settings.aiApiKey) {
        apiKey = decrypt(settings.aiApiKey)
    }

    return {
        provider,
        model: settings.aiModel || '',
        apiKey,
        temperature: settings.aiTemperature ?? 0.7,
        maxTokens: settings.aiMaxTokens || 4000,
        ollamaUrl: settings.aiOllamaUrl || DEFAULT_OLLAMA_URL
    }
}

// ==================== SYSTEM PROMPT ====================

function buildSystemPrompt() {
    const now = new Date()
    const dateStr = now.toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const day = now.getDate()
    // Unix-Timestamps als Referenz für das LLM
    const todayStart = Math.floor(new Date(year, month - 1, day, 0, 0, 0).getTime() / 1000)
    const monthStart = Math.floor(new Date(year, month - 1, 1, 0, 0, 0).getTime() / 1000)
    const yearStart = Math.floor(new Date(year, 0, 1, 0, 0, 0).getTime() / 1000)

    return `Du bist ein autonomer Trading-Analyse-Agent. Du hast Zugriff auf Tools, die das Trading-Journal des Users abfragen können.

AKTUELLES DATUM: ${dateStr}
Jahr: ${year}, Monat: ${month}, Tag: ${day}
Referenz-Timestamps (Unix, Sekunden):
- Heute 00:00 Uhr: ${todayStart}
- Erster des aktuellen Monats: ${monthStart}
- Jahresanfang ${year}: ${yearStart}

Deine Aufgabe:
- Beantworte Trading-Fragen durch eigenständige Datenabfrage
- Analysiere Muster, Risiken und Performance
- Gib konkrete, datenbasierte Empfehlungen
- Zeige Stärken und Schwächen auf

Regeln:
- Nutze immer zuerst die passenden Tools, bevor du antwortest
- Beziehe dich NUR auf tatsächliche Daten aus den Tool-Ergebnissen
- Erfinde keine Zahlen oder Trades
- Schreibe auf Deutsch, verwende Markdown-Formatierung
- Sei direkt und konstruktiv — wie ein guter Trading-Coach
- Wenn Daten fehlen oder der Zeitraum keine Trades enthält, sage das klar
- Wenn der User "diesen Monat" oder "März" sagt, nutze das aktuelle Jahr ${year}!

Tipps für Tool-Nutzung:
- Für Gesamtübersicht: compute_statistics (enthält Win-Rate, PnL, Profit Factor etc.)
- Für einzelne Trades: query_trades + query_notes
- Für SL/TP-Analyse: analyze_sl_tp_patterns
- Für Strategie-Analyse: query_tags + query_playbooks + compute_statistics
- Für Risiko-Analyse: query_excursions + compute_statistics`
}

// ==================== TOOL FORMAT CONVERTERS ====================

/** Convert our tool definitions to Anthropic's format */
function toolsToAnthropic() {
    return AGENT_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
    }))
}

/** Convert our tool definitions to OpenAI's format */
function toolsToOpenAI() {
    return AGENT_TOOLS.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters
        }
    }))
}

/** Convert our tool definitions to Gemini's format */
function toolsToGemini() {
    return [{
        functionDeclarations: AGENT_TOOLS.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
        }))
    }]
}

/** Build a text-based tool description for Ollama (prompt injection) */
function toolsToPromptText() {
    let text = 'Du hast folgende Tools zur Verfügung. Rufe sie auf im Format:\n'
    text += '<tool_call>{"name": "tool_name", "arguments": {"param": "value"}}</tool_call>\n\n'
    text += 'Verfügbare Tools:\n'
    for (const t of AGENT_TOOLS) {
        text += `- ${t.name}: ${t.description}\n`
        const props = t.parameters.properties || {}
        const required = t.parameters.required || []
        const paramList = Object.entries(props).map(([k, v]) =>
            `  ${k} (${v.type}${required.includes(k) ? ', required' : ''}): ${v.description || ''}`
        ).join('\n')
        if (paramList) text += paramList + '\n'
    }
    text += '\nWenn du keine weiteren Tools brauchst, antworte direkt OHNE <tool_call> Tags.'
    return text
}

// ==================== PROVIDER-SPECIFIC LLM CALLS WITH TOOLS ====================

async function callAnthropicWithTools(messages, config) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: config.model,
            max_tokens: config.maxTokens,
            system: buildSystemPrompt(),
            messages,
            tools: toolsToAnthropic(),
            temperature: config.temperature
        })
    })

    if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error('Anthropic Agent Error: ' + (err.error?.message || response.statusText))
    }

    const data = await response.json()
    const textBlocks = data.content?.filter(b => b.type === 'text') || []
    const toolBlocks = data.content?.filter(b => b.type === 'tool_use') || []

    return {
        text: textBlocks.map(b => b.text).join('\n'),
        toolCalls: toolBlocks.map(b => ({
            id: b.id,
            name: b.name,
            params: b.input || {}
        })),
        stopReason: data.stop_reason,
        usage: {
            promptTokens: data.usage?.input_tokens || 0,
            completionTokens: data.usage?.output_tokens || 0,
            totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
        },
        // Keep raw content for message history
        rawContent: data.content
    }
}

async function callOpenAIWithTools(messages, config, endpoint = 'https://api.openai.com/v1/chat/completions') {
    const apiMessages = [
        { role: 'system', content: buildSystemPrompt() },
        ...messages
    ]

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: config.model,
            messages: apiMessages,
            tools: toolsToOpenAI(),
            temperature: config.temperature,
            max_tokens: config.maxTokens
        })
    })

    if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error('OpenAI Agent Error: ' + (err.error?.message || response.statusText))
    }

    const data = await response.json()
    const choice = data.choices?.[0] || {}
    const msg = choice.message || {}

    return {
        text: msg.content || '',
        toolCalls: (msg.tool_calls || []).map(tc => ({
            id: tc.id,
            name: tc.function?.name,
            params: JSON.parse(tc.function?.arguments || '{}')
        })),
        stopReason: choice.finish_reason,
        usage: {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0,
            totalTokens: data.usage?.total_tokens || 0
        },
        rawMessage: msg
    }
}

async function callGeminiWithTools(messages, config) {
    // Convert messages to Gemini format
    const contents = []
    for (const msg of messages) {
        if (msg.role === 'user') {
            contents.push({ role: 'user', parts: [{ text: msg.content }] })
        } else if (msg.role === 'assistant') {
            if (msg.content) {
                contents.push({ role: 'model', parts: [{ text: msg.content }] })
            }
            // If there were function calls, add them
            if (msg.functionCalls) {
                contents.push({ role: 'model', parts: msg.functionCalls.map(fc => ({
                    functionCall: { name: fc.name, args: fc.params }
                })) })
            }
        } else if (msg.role === 'tool') {
            const parts = [{ functionResponse: {
                name: msg.toolName,
                response: { result: JSON.parse(msg.content || '{}') }
            } }]
            // Add image if present
            if (msg.imageContent) {
                parts.push({
                    inlineData: {
                        mimeType: msg.imageContent.mediaType,
                        data: msg.imageContent.base64
                    }
                })
            }
            contents.push({ role: 'user', parts })
        }
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': config.apiKey
        },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
            contents,
            tools: toolsToGemini(),
            generationConfig: {
                temperature: config.temperature,
                maxOutputTokens: config.maxTokens
            }
        })
    })

    if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error('Gemini Agent Error: ' + (err.error?.message || response.statusText))
    }

    const data = await response.json()
    const candidate = data.candidates?.[0]?.content || {}
    const parts = candidate.parts || []

    const textParts = parts.filter(p => p.text)
    const fcParts = parts.filter(p => p.functionCall)

    return {
        text: textParts.map(p => p.text).join('\n'),
        toolCalls: fcParts.map((p, i) => ({
            id: `gemini_${Date.now()}_${i}`,
            name: p.functionCall.name,
            params: p.functionCall.args || {}
        })),
        stopReason: data.candidates?.[0]?.finishReason,
        usage: {
            promptTokens: data.usageMetadata?.promptTokenCount || 0,
            completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
            totalTokens: data.usageMetadata?.totalTokenCount || 0
        }
    }
}

async function callOllamaWithTools(messages, config) {
    const url = config.ollamaUrl || DEFAULT_OLLAMA_URL

    // Ollama: inject tools into system prompt
    const enrichedSystem = buildSystemPrompt() + '\n\n' + toolsToPromptText()
    const ollamaMessages = [
        { role: 'system', content: enrichedSystem },
        ...messages.map(m => {
            if (m.role === 'tool') {
                let text = `Tool-Ergebnis für ${m.toolName}:\n${m.content}`
                // Ollama: add image as base64 if model supports vision (llava, etc.)
                if (m.imageContent) {
                    return {
                        role: 'user',
                        content: text + '\n[Screenshot-Bild wurde geladen]',
                        images: [m.imageContent.base64]
                    }
                }
                return { role: 'user', content: text }
            }
            return { role: m.role, content: m.content || '' }
        })
    ]

    const postData = JSON.stringify({
        model: config.model,
        messages: ollamaMessages,
        stream: false,
        options: { temperature: config.temperature, num_predict: config.maxTokens }
    })

    const { URL } = await import('url')
    const parsedUrl = new URL(`${url}/api/chat`)
    const httpModule = parsedUrl.protocol === 'https:' ? await import('https') : await import('http')

    const data = await new Promise((resolve, reject) => {
        const req = httpModule.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
            timeout: 600000
        }, (res) => {
            let body = ''
            res.on('data', chunk => body += chunk)
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error('Ollama Error: ' + body))
                try { resolve(JSON.parse(body)) } catch (e) { reject(new Error('Invalid Ollama response')) }
            })
        })
        req.on('timeout', () => { req.destroy(); reject(new Error('Ollama Timeout')) })
        req.on('error', (e) => reject(new Error('Ollama nicht erreichbar: ' + e.message)))
        req.write(postData)
        req.end()
    })

    const text = data.message?.content || ''

    // Parse tool calls from text (prompt-based)
    const toolCalls = []
    const regex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g
    let match
    while ((match = regex.exec(text)) !== null) {
        try {
            const parsed = JSON.parse(match[1])
            toolCalls.push({
                id: `ollama_${Date.now()}_${toolCalls.length}`,
                name: parsed.name,
                params: parsed.arguments || parsed.params || {}
            })
        } catch { /* ignore malformed */ }
    }

    // Remove tool_call tags from visible text
    const cleanText = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim()

    return {
        text: cleanText,
        toolCalls,
        stopReason: 'stop',
        usage: {
            promptTokens: data.prompt_eval_count || 0,
            completionTokens: data.eval_count || 0,
            totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
        }
    }
}

// ==================== UNIFIED LLM CALL ====================

async function callLLMWithTools(messages, config) {
    switch (config.provider) {
        case 'anthropic':
            return callAnthropicWithTools(messages, config)
        case 'openai':
            return callOpenAIWithTools(messages, config)
        case 'deepseek':
            return callOpenAIWithTools(messages, config, 'https://api.deepseek.com/v1/chat/completions')
        case 'gemini':
            return callGeminiWithTools(messages, config)
        case 'ollama':
            return callOllamaWithTools(messages, config)
        default:
            throw new Error(`Unsupported provider: ${config.provider}`)
    }
}

// ==================== MESSAGE FORMAT HELPERS ====================

/** Build the message history in provider-specific format */
function buildProviderMessages(history, provider) {
    if (provider === 'anthropic') {
        return buildAnthropicMessages(history)
    }
    if (provider === 'openai' || provider === 'deepseek') {
        return buildOpenAIMessages(history)
    }
    if (provider === 'gemini') {
        return buildGeminiMessages(history)
    }
    // Ollama: simple format
    return history
}

function buildAnthropicMessages(history) {
    const messages = []
    for (const msg of history) {
        if (msg.role === 'user') {
            messages.push({ role: 'user', content: msg.content })
        } else if (msg.role === 'assistant') {
            // Anthropic expects raw content blocks for tool_use responses
            if (msg.rawContent) {
                messages.push({ role: 'assistant', content: msg.rawContent })
            } else {
                messages.push({ role: 'assistant', content: msg.content || '' })
            }
        } else if (msg.role === 'tool') {
            // Build tool_result content — may include image
            const contentBlocks = []
            if (msg.imageContent) {
                contentBlocks.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: msg.imageContent.mediaType,
                        data: msg.imageContent.base64
                    }
                })
            }
            contentBlocks.push({ type: 'text', text: msg.content || '{}' })

            messages.push({
                role: 'user',
                content: [{
                    type: 'tool_result',
                    tool_use_id: msg.toolCallId,
                    content: contentBlocks
                }]
            })
        }
    }
    return messages
}

function buildOpenAIMessages(history) {
    const messages = []
    for (const msg of history) {
        if (msg.role === 'user') {
            messages.push({ role: 'user', content: msg.content })
        } else if (msg.role === 'assistant') {
            const entry = { role: 'assistant', content: msg.content || null }
            if (msg.toolCallsRaw) {
                entry.tool_calls = msg.toolCallsRaw
            }
            messages.push(entry)
        } else if (msg.role === 'tool') {
            // OpenAI tool messages are text-only — but we can add image via a follow-up user message
            messages.push({
                role: 'tool',
                tool_call_id: msg.toolCallId,
                content: msg.content
            })
            // If there's image content, add it as a user message with the image
            if (msg.imageContent) {
                messages.push({
                    role: 'user',
                    content: [
                        { type: 'text', text: `[Screenshot für Analyse — ${msg.toolName || 'analyze_screenshot'}]` },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:${msg.imageContent.mediaType};base64,${msg.imageContent.base64}`,
                                detail: 'high'
                            }
                        }
                    ]
                })
            }
        }
    }
    return messages
}

function buildGeminiMessages(history) {
    // Gemini messages are built inside callGeminiWithTools
    return history
}

// ==================== AGENT LOOP ====================

/**
 * Run the agent loop with SSE streaming.
 * @param {string} userMessage - The user's question
 * @param {Array} conversationHistory - Previous messages (from DB)
 * @param {object} config - AI settings
 * @param {Function} sendSSE - Function to send SSE events
 * @returns {Promise<object>} { answer, totalTokens, promptTokens, completionTokens, totalToolCalls, messages }
 */
async function runAgentLoop(userMessage, conversationHistory, config, sendSSE) {
    const knex = getKnex()
    const history = [...conversationHistory]
    history.push({ role: 'user', content: userMessage })

    let totalTokens = 0
    let promptTokens = 0
    let completionTokens = 0
    let totalToolCalls = 0
    let finalAnswer = ''

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        sendSSE({ type: 'thinking', iteration: i + 1 })

        // Build provider-specific messages
        const providerMessages = buildProviderMessages(history, config.provider)

        // Call LLM with tools
        const response = await callLLMWithTools(providerMessages, config)
        totalTokens += response.usage.totalTokens
        promptTokens += response.usage.promptTokens || 0
        completionTokens += response.usage.completionTokens || 0

        // If no tool calls — this is the final answer
        if (!response.toolCalls || response.toolCalls.length === 0) {
            finalAnswer = response.text
            history.push({ role: 'assistant', content: response.text })
            sendSSE({ type: 'answer', content: response.text })
            break
        }

        // There are tool calls — process them
        // Add assistant message with tool calls to history
        const assistantMsg = {
            role: 'assistant',
            content: response.text || '',
            rawContent: response.rawContent, // For Anthropic
            toolCallsRaw: response.rawMessage?.tool_calls, // For OpenAI
            functionCalls: response.toolCalls // For Gemini
        }
        history.push(assistantMsg)

        // Execute each tool call
        for (const call of response.toolCalls) {
            totalToolCalls++
            sendSSE({ type: 'tool_call', name: call.name, params: call.params })

            const result = await executeTool(call.name, call.params, knex)

            // Special handling for image tool results
            if (result.__imageContent) {
                sendSSE({ type: 'tool_result', name: call.name, resultPreview: `Screenshot ${result.metadata?.symbol || ''} ${result.metadata?.date || ''} geladen` })

                history.push({
                    role: 'tool',
                    toolCallId: call.id,
                    toolName: call.name,
                    content: JSON.stringify({ metadata: result.metadata }),
                    imageContent: {
                        mediaType: result.mediaType,
                        base64: result.base64
                    }
                })
            } else {
                const resultStr = JSON.stringify(result)
                // Truncate very large results to save tokens
                const truncated = resultStr.length > 15000
                    ? resultStr.substring(0, 15000) + '... [truncated]'
                    : resultStr

                sendSSE({ type: 'tool_result', name: call.name, resultPreview: summarizeResult(result) })

                history.push({
                    role: 'tool',
                    toolCallId: call.id,
                    toolName: call.name,
                    content: truncated
                })
            }
        }

        // Token budget check
        if (totalTokens > MAX_TOKENS) {
            sendSSE({ type: 'warning', content: 'Token-Budget erreicht, beende Agent-Loop.' })
            // One more call without tools to get a summary
            finalAnswer = 'Token-Budget erreicht. Hier ist eine Zusammenfassung der bisherigen Ergebnisse.'
            break
        }
    }

    return { answer: finalAnswer, totalTokens, promptTokens, completionTokens, totalToolCalls, messages: history }
}

/** Create a short summary of a tool result for the SSE stream */
function summarizeResult(result) {
    if (result.error) return `Fehler: ${result.error}`
    if (result.count !== undefined) return `${result.count} Ergebnisse`
    if (result.tradeCount !== undefined) return `${result.tradeCount} Trades, Win-Rate: ${result.winRate}`
    if (result.tradesAnalyzed !== undefined) return `${result.tradesAnalyzed} Trades analysiert, ${result.totalModifications} SL/TP-Änderungen`
    return 'OK'
}

// ==================== EXPRESS ROUTES ====================

export function setupAgentRoutes(app) {

    // POST /api/ai/agent/chat — Start agent loop (SSE stream)
    app.post('/api/ai/agent/chat', async (req, res) => {
        if (agentRunning) {
            return res.status(429).json({ error: 'Ein Agent-Lauf läuft bereits. Bitte warten.' })
        }

        const { sessionId, message } = req.body
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Nachricht darf nicht leer sein.' })
        }

        // SSE setup
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        })

        const sendSSE = (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`)
        }

        agentRunning = true
        const knex = getKnex()

        try {
            // Load AI config
            const config = await loadAiSettings()
            sendSSE({ type: 'status', provider: config.provider, model: config.model })

            // Load or create session
            let session
            let conversationHistory = []

            if (sessionId) {
                session = await knex('ai_agent_sessions').where('id', sessionId).first()
                if (session) {
                    // Load previous messages
                    const prevMessages = await knex('ai_agent_messages')
                        .where('sessionId', sessionId)
                        .orderBy('createdAt', 'asc')
                    // Reconstruct conversation: collapse tool messages into assistant context
                    // (Provider-specific tool_use/tool_result pairs can't be reliably
                    //  reconstructed from DB, so we summarize tool calls as text)
                    let pendingToolSummaries = []
                    for (const msg of prevMessages) {
                        if (msg.role === 'user') {
                            conversationHistory.push({ role: 'user', content: msg.content || '' })
                        } else if (msg.role === 'tool') {
                            // Collect tool results as text summaries
                            const preview = (msg.content || '').substring(0, 500)
                            pendingToolSummaries.push(`[Tool: ${msg.toolName}] ${preview}`)
                        } else if (msg.role === 'assistant') {
                            // If there are pending tool summaries, prepend them as context
                            let content = msg.content || ''
                            if (pendingToolSummaries.length > 0) {
                                const toolContext = pendingToolSummaries.join('\n')
                                content = `(Vorherige Tool-Ergebnisse:\n${toolContext})\n\n${content}`
                                pendingToolSummaries = []
                            }
                            conversationHistory.push({ role: 'assistant', content })
                        }
                    }
                    // Flush any remaining tool summaries
                    if (pendingToolSummaries.length > 0) {
                        const toolContext = pendingToolSummaries.join('\n')
                        conversationHistory.push({ role: 'assistant', content: `(Tool-Ergebnisse: ${toolContext})` })
                        pendingToolSummaries = []
                    }
                }
            }

            if (!session) {
                // Create new session
                const [id] = await knex('ai_agent_sessions').insert({
                    title: message.substring(0, 100),
                    provider: config.provider,
                    model: config.model,
                    totalTokens: 0,
                    totalToolCalls: 0
                }).returning('id')
                const newSessionId = typeof id === 'object' ? id.id : id
                session = { id: newSessionId, totalTokens: 0, totalToolCalls: 0 }
                sendSSE({ type: 'session', sessionId: newSessionId })
            } else {
                sendSSE({ type: 'session', sessionId: session.id })
            }

            // Save user message
            await knex('ai_agent_messages').insert({
                sessionId: session.id,
                role: 'user',
                content: message
            })

            // Run agent loop
            const result = await runAgentLoop(message, conversationHistory, config, sendSSE)

            // Save assistant answer
            if (result.answer) {
                await knex('ai_agent_messages').insert({
                    sessionId: session.id,
                    role: 'assistant',
                    content: result.answer,
                    promptTokens: result.promptTokens || 0,
                    completionTokens: result.completionTokens || 0
                })
            }

            // Save tool call messages (both assistant tool-calls and tool results)
            for (const msg of result.messages) {
                if (msg.role === 'tool') {
                    await knex('ai_agent_messages').insert({
                        sessionId: session.id,
                        role: 'tool',
                        content: msg.content,
                        toolName: msg.toolName || '',
                        toolCallId: msg.toolCallId || '',
                        toolParams: '',
                        toolResult: msg.content?.substring(0, 5000) || ''
                    })
                }
            }

            // Update session totals
            await knex('ai_agent_sessions').where('id', session.id).update({
                totalTokens: (session.totalTokens || 0) + result.totalTokens,
                totalToolCalls: (session.totalToolCalls || 0) + result.totalToolCalls,
                updatedAt: knex.fn.now()
            })

            sendSSE({
                type: 'done',
                usage: {
                    totalTokens: result.totalTokens,
                    promptTokens: result.promptTokens || 0,
                    completionTokens: result.completionTokens || 0,
                    toolCalls: result.totalToolCalls,
                    sessionId: session.id
                }
            })

        } catch (err) {
            logError('ai-agent', `Agent error: ${err.message}`)
            sendSSE({ type: 'error', content: err.message })
        } finally {
            agentRunning = false
            res.end()
        }
    })

    // GET /api/ai/agent/sessions — List all sessions
    app.get('/api/ai/agent/sessions', async (req, res) => {
        try {
            const knex = getKnex()
            const sessions = await knex('ai_agent_sessions')
                .orderBy('updatedAt', 'desc')
                .limit(50)
            res.json(sessions.map(s => ({ ...s, objectId: String(s.id) })))
        } catch (err) {
            res.status(500).json({ error: err.message })
        }
    })

    // GET /api/ai/agent/sessions/:id — Load session with messages
    app.get('/api/ai/agent/sessions/:id', async (req, res) => {
        try {
            const knex = getKnex()
            const id = parseInt(req.params.id, 10)
            if (!id) return res.status(400).json({ error: 'Invalid session ID' })

            const session = await knex('ai_agent_sessions').where('id', id).first()
            if (!session) return res.status(404).json({ error: 'Session not found' })

            const messages = await knex('ai_agent_messages')
                .where('sessionId', id)
                .orderBy('createdAt', 'asc')

            res.json({
                ...session,
                objectId: String(session.id),
                messages: messages.map(m => ({ ...m, objectId: String(m.id) }))
            })
        } catch (err) {
            res.status(500).json({ error: err.message })
        }
    })

    // DELETE /api/ai/agent/sessions/:id — Delete session
    app.delete('/api/ai/agent/sessions/:id', async (req, res) => {
        try {
            const knex = getKnex()
            const id = parseInt(req.params.id, 10)
            if (!id) return res.status(400).json({ error: 'Invalid session ID' })

            await knex('ai_agent_messages').where('sessionId', id).del()
            await knex('ai_agent_sessions').where('id', id).del()
            res.json({ success: true })
        } catch (err) {
            res.status(500).json({ error: err.message })
        }
    })

    // GET /api/ai/agent/tools — List available tools
    app.get('/api/ai/agent/tools', (req, res) => {
        res.json(AGENT_TOOLS.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
        })))
    })
}
