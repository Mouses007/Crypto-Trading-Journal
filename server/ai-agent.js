/**
 * ai-agent.js — Autonomous KI-Agent with Tool Use / Function Calling.
 * Supports: Anthropic (native), Gemini (native), Ollama (prompt-based fallback)
 * and every OpenAI-compatible provider from ANBIETER_REG (OpenAI, Mistral, xAI, Qwen, custom).
 * Agent loop: LLM calls tools → server executes → results fed back → LLM decides next step.
 * Communication: SSE streaming for live tool-step updates to frontend.
 */

import { getKnex } from './database.js'
import { decrypt } from './crypto.js'
import { logWarn, logError } from './logger.js'
import { AGENT_TOOLS, executeTool } from './ai-agent-tools.js'
import { resetBacktestKontingent } from './strategy-tools.js'
import { assertAllowedOllamaUrl, waehleAnbieter } from './ollama-api.js'
import {
    samplingFelder, KEY_SPALTEN, KI_URL_SPALTEN,
    keySpalte, istOpenAiKompatibel, chatEndpunkt,
} from './ai-models.js'
import { beobachteAbbruch, sseSender } from './sse.js'

const MAX_ITERATIONS = 10
// Voreinstellung des Token-Budgets je Lauf — überschreibbar in den
// Einstellungen (KI → Agent), gespeichert in `settings.aiAgentTokenBudget`.
const DEFAULT_TOKEN_BUDGET = 80000
// Untergrenze: darunter schafft der Agent nicht einmal eine Runde mit
// Tool-Ergebnis + Antwort und würde nur noch Abschluss-Zusammenfassungen liefern.
const MIN_TOKEN_BUDGET = 10000
const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

// Concurrency guard — only one agent run at a time
let agentRunning = false

/**
 * Läuft gerade ein Agentendurchgang?
 *
 * Prozesslokal wie der Wächter selbst — die Antwort gilt für DIESEN Server,
 * nicht für den NAS-Container nebenan. Für die KI-Übersicht reicht das: sie
 * fragt denselben Prozess, der die Anfrage beantwortet.
 */
export function istAgentAktiv() {
    return agentRunning
}

// ==================== HELPER: Load AI settings ====================

async function loadAiSettings() {
    const knex = getKnex()
    const settings = await knex('settings')
        .select('aiProvider', 'aiModel', 'aiApiKey', 'aiTemperature', 'aiMaxTokens', 'aiOllamaUrl',
            'aiAgentProvider', 'aiAgentModell', 'aiAgentTokenBudget',
            ...KEY_SPALTEN, ...KI_URL_SPALTEN)
        .where('id', 1).first()
    if (!settings) throw new Error('No AI settings found')

    // Eigener Anbieter für den Agenten; leer = der global eingestellte.
    // Der Agent ist der teuerste Verbraucher (Werkzeugschleife über mehrere
    // Runden), deshalb lohnt hier eine eigene Wahl besonders.
    const { provider, model } = waehleAnbieter(settings, 'Agent')
    const col = keySpalte(provider)
    let apiKey = ''
    if (col && settings[col]) {
        apiKey = decrypt(settings[col])
    } else if (provider === 'openai' && settings.aiApiKey) {
        // Sammelschlüssel nur dort, wo er herkam — sonst ginge ein
        // OpenAI-Schlüssel an einen fremden Host.
        apiKey = decrypt(settings.aiApiKey)
    }

    return {
        provider,
        model,
        apiKey,
        temperature: settings.aiTemperature ?? 0.7,
        maxTokens: settings.aiMaxTokens || 4000,
        tokenBudget: Math.max(MIN_TOKEN_BUDGET, Number(settings.aiAgentTokenBudget) || DEFAULT_TOKEN_BUDGET),
        ollamaUrl: settings.aiOllamaUrl || DEFAULT_OLLAMA_URL,
        endpunkt: chatEndpunkt(provider, settings)
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
- Beantworte auch Fragen zur Bedienung dieser Software (Seiten, Einstellungen,
  Import, Live-Analyse, Live-Trading, Strategien-Modus) — dafür gibt es
  query_app_help mit der eingebauten Doku. Antworte zur Software NUR aus
  dieser Doku, nie aus Allgemeinwissen; steht etwas nicht darin, sage das.
- Fragen zur aktuellen Marktlage (Fear & Greed, Dominanz, Funding, Long/Short,
  Liquidationen, Makro …) beantwortest du mit query_marktradar — nur die
  gelieferten Zahlen nennen, keine Handelsempfehlung daraus machen.

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
- Für Risiko-Analyse: query_excursions + compute_statistics

AUTOMATISCH GEHANDELTE STRATEGIEN (Agent-Modus):
Neben dem manuellen Journal gibt es Strategie-Instanzen, die eigenständig
handeln (Papier, Schatten oder Live). Ihre Trades stehen NICHT in query_trades,
sondern in eigenen Tabellen — dafür gibt es eigene Tools.

Wenn du eine solche Strategie verbessern sollst, halte diese Reihenfolge ein:
1. get_strategy_config — aktuelle Parameter UND die erlaubten Wertebereiche.
   Ein Vorschlag ausserhalb dieser Grenzen wird verworfen.
2. get_strategy_performance — Kennzahlen und vor allem den Setup-Trichter.
   Der grösste Posten unter "byInvalidReason" ist meist der beste Ansatzpunkt.
3. run_backtest — deine Vermutung MESSEN, nicht behaupten. Erst den aktuellen
   Parametersatz als Vergleichsbasis, dann die Änderung. Nur EINEN Parameter
   je Lauf ändern, sonst weisst du nicht, was gewirkt hat.
4. propose_param_change — mit backtestId als Beleg.

Harte Regeln dabei:
- Schlage NIE eine Änderung ohne Backtest-Beleg vor.
- Unter etwa 30 Trades ist ein Backtest-Ergebnis nicht belastbar. Sage das,
  statt einen Zufallstreffer als Verbesserung zu verkaufen.
- Die wichtigste Kennzahl ist expectancyR (erwarteter Gewinn je Trade in R),
  nicht die Trefferquote. Eine hohe Trefferquote mit negativem Erwartungswert
  ist eine Verlust-Strategie.
- Ein auffällig hoher Erwartungswert bei wenigen Trades ist ein Warnsignal,
  kein Erfolg — prüfe dann die Einzeltrades auf Ausreisser.
- Dein Vorschlag ändert nichts. Der User übernimmt ihn im Labor oder nicht.`
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
            // Werkzeuge bleiben im Request (die Historie enthält tool_use-Blöcke,
            // ohne `tools` lehnt Anthropic sie ab), aber der Aufruf wird gesperrt.
            ...(config.ohneTools ? { tool_choice: { type: 'none' } } : {}),
            // Neuere Modelle lehnen Sampling-Parameter mit 400 ab
            ...samplingFelder(config.model, config.temperature)
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
            ...(config.ohneTools ? { tool_choice: 'none' } : {}),
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
            ...(config.ohneTools ? { toolConfig: { functionCallingConfig: { mode: 'NONE' } } } : {}),
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

    // SSRF-Schutz
    assertAllowedOllamaUrl(url)

    // Ollama: inject tools into system prompt
    const enrichedSystem = config.ohneTools ? buildSystemPrompt() : buildSystemPrompt() + '\n\n' + toolsToPromptText()
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
    if (config.provider === 'anthropic') return callAnthropicWithTools(messages, config)
    if (config.provider === 'gemini') return callGeminiWithTools(messages, config)
    if (config.provider === 'ollama') return callOllamaWithTools(messages, config)
    if (istOpenAiKompatibel(config.provider)) {
        // openai, mistral, xai, qwen, custom — und deepseek aus dem Altbestand
        if (!config.endpunkt) throw new Error(`Für ${config.provider} ist keine Basis-URL hinterlegt`)
        return callOpenAIWithTools(messages, config, config.endpunkt)
    }
    throw new Error(`Unsupported provider: ${config.provider}`)
}

// ==================== MESSAGE FORMAT HELPERS ====================

/** Build the message history in provider-specific format */
function buildProviderMessages(history, provider) {
    if (provider === 'anthropic') {
        return buildAnthropicMessages(history)
    }
    if (istOpenAiKompatibel(provider)) {
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
async function runAgentLoop(userMessage, conversationHistory, config, sendSSE, istAbgebrochen = () => false) {
    const knex = getKnex()
    const history = [...conversationHistory]
    history.push({ role: 'user', content: userMessage })

    let totalTokens = 0
    let promptTokens = 0
    let completionTokens = 0
    let totalToolCalls = 0
    let finalAnswer = ''
    // Antwort kam leer zurück, weil das Antwortbudget schon im Denkschritt
    // aufgebraucht war — das ist etwas anderes als „Rechenbudget erschöpft".
    let budgetZuKlein = false

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        // Hat der Browser die Verbindung gekappt (Seitenwechsel, Reload), hört
        // niemand mehr zu — jede weitere Runde wäre bezahlte Rechenzeit für
        // eine Antwort, die nirgends ankommt.
        if (istAbgebrochen()) break
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
            // Leerer Text ist keine Antwort: die Claude-5-Modelle denken
            // standardmässig, und `max_tokens` deckelt Denken UND Antwort
            // zusammen. Reicht das Budget nur fürs Denken, kommt ein Block
            // ohne Text zurück (derselbe Fehler wie beim leeren KI-Bericht).
            // Früher wurde der leere String als Antwort gesendet und der
            // Nutzer bekam anschliessend die irreführende Meldung, sein
            // Rechenbudget sei aufgebraucht.
            if (!response.text) {
                budgetZuKlein = true
                break
            }
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
            if (istAbgebrochen()) break
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
        if (totalTokens > config.tokenBudget) {
            sendSSE({ type: 'warning', content: `Token-Budget erreicht (${config.tokenBudget.toLocaleString('de-CH')}), beende Agent-Loop.` })
            break
        }
    }

    // Loop ohne fertige Antwort verlassen — Budget erreicht oder alle
    // Iterationen mit Tool-Aufrufen verbraucht. Früher stand hier nur der
    // statische Satz „Hier ist eine Zusammenfassung der bisherigen
    // Ergebnisse" — ohne Zusammenfassung dahinter: die Tool-Ergebnisse waren
    // bezahlt, der Nutzer bekam trotzdem nichts. Jetzt baut ein letzter
    // Aufruf aus dem, was bereits vorliegt, eine echte Antwort. Die Bitte
    // wandert NICHT in die gespeicherte Historie, nur die Antwort.
    if (budgetZuKlein && !istAbgebrochen()) {
        finalAnswer = `Das Modell hat sein Antwortbudget (Max Tokens: ${config.maxTokens}) bereits im Denkschritt aufgebraucht — es kam kein Text zurück. `
            + 'Erhöhe „Max Tokens" in den KI-Einstellungen (für die denkenden Modelle mindestens 8000).'
        history.push({ role: 'assistant', content: finalAnswer })
        sendSSE({ type: 'answer', content: finalAnswer })
    } else if (!finalAnswer && !istAbgebrochen()) {
        const bitte = {
            role: 'user',
            content: 'Das Rechenbudget für diese Frage ist aufgebraucht. Rufe KEINE weiteren Tools auf. '
                + 'Fasse aus den bereits vorliegenden Tool-Ergebnissen zusammen, was du herausgefunden hast, '
                + 'beantworte die ursprüngliche Frage damit so gut wie möglich und nenne am Ende kurz, '
                + 'was offen bleiben musste.'
        }
        try {
            // `ohneTools`: die Bitte allein hält das Modell nicht davon ab, noch
            // eine Runde Werkzeuge zu rufen — dann käme wieder keine Antwort.
            const abschluss = await callLLMWithTools(buildProviderMessages([...history, bitte], config.provider), { ...config, ohneTools: true })
            totalTokens += abschluss.usage.totalTokens
            promptTokens += abschluss.usage.promptTokens || 0
            completionTokens += abschluss.usage.completionTokens || 0
            finalAnswer = abschluss.text
                || 'Das Token-Budget ist erreicht, bevor eine Antwort fertig wurde. Bitte stelle die Frage enger (kürzerer Zeitraum, ein Symbol), dann reicht das Budget.'
        } catch (e) {
            logWarn('ai-agent', 'Abschluss-Zusammenfassung nach Budget/Iterationsende fehlgeschlagen: ' + e.message)
            finalAnswer = 'Das Token-Budget ist erreicht und die Abschluss-Zusammenfassung schlug fehl (' + e.message + '). Bitte stelle die Frage enger.'
        }
        history.push({ role: 'assistant', content: finalAnswer })
        sendSSE({ type: 'answer', content: finalAnswer })
    }

    /*
     * Eine Zeile je Lauf, nicht je Runde.
     *
     * Der Agent dreht bis zu zehn Schleifen mit Werkzeugaufrufen; einzeln
     * verbucht stünden zehn Posten in der Auswertung, wo der Nutzer eine Frage
     * gestellt hat. Gebucht wird auch nach Abbruch — die Runden bis dahin sind
     * gerechnet und bezahlt.
     */
    merkeVerbrauch({
        funktion: 'agent',
        ausloeser: 'manuell',
        provider: config.provider,
        modell: config.model,
        usage: { promptTokens, completionTokens, totalTokens },
    })

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

        // Bricht der Client ab, läuft der Lauf sonst bis zum Ende weiter und
        // schreibt in eine tote Verbindung — bezahlt wird er trotzdem. Warum
        // die Erkennung an der ANTWORT hängen muss und nicht an der Anfrage,
        // steht in `server/sse.js`; der Fehler hat den Agenten einmal komplett
        // stummgeschaltet.
        const istAbgebrochen = beobachteAbbruch(res)
        const sendSSE = sseSender(res, istAbgebrochen)

        agentRunning = true
        // Backtests sind teuer und deshalb je Lauf gedeckelt. Ohne diesen
        // Reset gälte das Kontingent für die gesamte Server-Laufzeit — nach
        // fünf Backtests hätte der Agent nie wieder einen ausführen können.
        resetBacktestKontingent()
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
            const result = await runAgentLoop(message, conversationHistory, config, sendSSE, istAbgebrochen)

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
            // Nach Archiv-Zustand filtern, BEVOR das 50er-Limit greift:
            // ohne Filter teilen sich Archiv und Standardansicht dieselben
            // 50 Zeilen — wer 50 Chats archiviert, sieht in der Standardliste
            // nichts mehr, obwohl dort welche liegen.
            const archiv = req.query.archiviert === '1'
            const sessions = await knex('ai_agent_sessions')
                .where(function () {
                    if (archiv) this.where('archiviert', 1)
                    // Zeilen von vor der Migration können NULL tragen
                    else this.where('archiviert', 0).orWhereNull('archiviert')
                })
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

    // POST /api/ai/agent/sessions/:id/archiv — Session archivieren/wiederherstellen
    app.post('/api/ai/agent/sessions/:id/archiv', async (req, res) => {
        try {
            const knex = getKnex()
            const id = parseInt(req.params.id, 10)
            if (!id) return res.status(400).json({ error: 'Invalid session ID' })
            const archiviert = req.body?.archiviert ? 1 : 0
            const n = await knex('ai_agent_sessions').where('id', id).update({ archiviert })
            if (!n) return res.status(404).json({ error: 'Session not found' })
            res.json({ success: true, archiviert })
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
