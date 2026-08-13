/**
 * Gemeinsamer LLM-Zugang für strukturierte Antworten.
 *
 * Der bestehende KI-Agent (`ai-agent.js`) braucht Tool-Calling und eine
 * Nachrichten-Historie. Die Veto-Agenten brauchen etwas ganz anderes: eine
 * einzelne Frage, eine JSON-Antwort, ein Timeout. Dieses Modul deckt genau
 * diesen zweiten Fall ab und teilt sich mit `ai-agent.js` das, was wirklich
 * gemeinsam ist — das Laden und Entschlüsseln der Provider-Zugangsdaten.
 *
 * Die Tool-Calling-Maschinerie bleibt bewusst in `ai-agent.js`: sie hierher zu
 * verschieben würde ein funktionierendes Feature anfassen, ohne dass die
 * Veto-Agenten davon etwas hätten.
 *
 * Zwei Dinge, die `ai-agent.js` fehlen und die im automatischen Handel nicht
 * fehlen dürfen: ein **Timeout** auf jedem Aufruf und eine **Kostenschätzung**.
 * Ein hängender LLM-Aufruf darf keinen Handelstakt blockieren.
 */

import { getKnex } from './database.js'
import { samplingFelder, basisUrl } from './ai-models.js'
import { decrypt } from './crypto.js'
import { assertAllowedOllamaUrl } from './ollama-api.js'
import { logWarn } from './logger.js'

const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

/** Preise in USD je Million Token (Eingabe, Ausgabe). Nur zur Budgetschätzung. */
const PREISE = {
    'claude-opus': [15, 75],
    'claude-sonnet': [3, 15],
    'claude-haiku': [0.8, 4],
    'gpt-4o-mini': [0.15, 0.6],
    'gpt-4o': [2.5, 10],
    'gemini-2.0-flash': [0.1, 0.4],
    'gemini-1.5-pro': [1.25, 5],
    'gemini-1.5-flash': [0.075, 0.3],
    'deepseek-chat': [0.27, 1.1],
    'deepseek-reasoner': [0.55, 2.19],
}

/** Grobe Kosten eines Aufrufs. Unbekannte Modelle (z. B. Ollama) kosten 0. */
export function schaetzeKosten(model, promptTokens, completionTokens) {
    const treffer = Object.keys(PREISE).find((k) => String(model || '').includes(k))
    if (!treffer) return 0
    const [ein, aus] = PREISE[treffer]
    return (promptTokens / 1e6) * ein + (completionTokens / 1e6) * aus
}

/**
 * Zugangsdaten des gewünschten Providers. Ohne Angabe wird der global
 * eingestellte Provider genommen — die Rollen-Konfiguration einer Instanz darf
 * ihn je Rolle überschreiben.
 */
export async function ladeLlmConfig({ provider, model } = {}) {
    const knex = getKnex()
    const s = await knex('settings')
        .select('aiProvider', 'aiModel', 'aiApiKey', 'aiTemperature', 'aiMaxTokens', 'aiOllamaUrl',
            'aiKeyOpenai', 'aiKeyAnthropic', 'aiKeyGemini', 'aiKeyDeepseek',
            'aiCustomUrl', 'aiKeyCustom')
        .where('id', 1).first()
    if (!s) throw new Error('Keine KI-Einstellungen gefunden')

    const gewaehlt = provider || s.aiProvider || 'ollama'
    const keyMap = { openai: 'aiKeyOpenai', anthropic: 'aiKeyAnthropic', gemini: 'aiKeyGemini',
        deepseek: 'aiKeyDeepseek', custom: 'aiKeyCustom' }
    const spalte = keyMap[gewaehlt]

    let apiKey = ''
    if (spalte && s[spalte]) apiKey = decrypt(s[spalte])
    else if (s.aiApiKey) apiKey = decrypt(s.aiApiKey)

    return {
        provider: gewaehlt,
        model: model || s.aiModel || '',
        apiKey,
        temperature: 0,                 // Entscheidungen sollen reproduzierbar sein
        maxTokens: 800,                 // eine JSON-Antwort braucht nicht mehr
        ollamaUrl: s.aiOllamaUrl || DEFAULT_OLLAMA_URL,
        baseUrl: basisUrl(s.aiCustomUrl),
    }
}

/** fetch mit hartem Timeout — ein hängender Anbieter darf den Takt nicht blockieren. */
async function fetchMitTimeout(url, options, timeoutMs) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
        return await fetch(url, { ...options, signal: ctrl.signal })
    } finally {
        clearTimeout(timer)
    }
}

/** Holt das erste JSON-Objekt aus einer Antwort (manche Modelle plaudern davor). */
export function parseJsonAntwort(text) {
    if (!text) return null
    const roh = String(text).trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/, '')
    try { return JSON.parse(roh) } catch { /* weiter unten versuchen */ }
    const von = roh.indexOf('{')
    const bis = roh.lastIndexOf('}')
    if (von === -1 || bis <= von) return null
    try { return JSON.parse(roh.slice(von, bis + 1)) } catch { return null }
}

// ── Anhänge ──────────────────────────────────────────────────────────────

/**
 * Welcher Anbieter kann was? Bilder gehen fast überall, PDFs nur dort, wo der
 * Anbieter sie nativ versteht — das Projekt hat bewusst keine PDF-Bibliothek.
 */
export const ANHANG_UNTERSTUETZUNG = {
    anthropic: { image: true, pdf: true },
    gemini: { image: true, pdf: true },
    openai: { image: true, pdf: false },
    deepseek: { image: false, pdf: false },
    ollama: { image: true, pdf: false },
    // Was ein eigener Endpunkt kann, weiss nur der Betreiber. Bilder werden
    // im OpenAI-Format mitgeschickt; PDFs bleiben aussen vor, weil es dafür
    // kein einheitliches Format gibt.
    custom: { image: true, pdf: false },
}

/**
 * Prüft Anhänge gegen den Anbieter.
 * @returns {{ ok: boolean, nichtUnterstuetzt: string[] }}
 */
export function pruefeAnhaenge(provider, anhaenge = []) {
    const kann = ANHANG_UNTERSTUETZUNG[provider] || { image: false, pdf: false }
    const nichtUnterstuetzt = []
    for (const a of anhaenge) {
        if (a.kind === 'image' && !kann.image) nichtUnterstuetzt.push(a.name || 'Bild')
        if (a.kind === 'pdf' && !kann.pdf) nichtUnterstuetzt.push(a.name || 'PDF')
    }
    return { ok: nichtUnterstuetzt.length === 0, nichtUnterstuetzt }
}

/** Anhänge → Anthropic-Inhaltsblöcke. */
function anhaengeAnthropic(anhaenge) {
    return anhaenge.map((a) => (a.kind === 'pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 } }
        : { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.base64 } }))
}

/** Anhänge → Gemini-Parts (Bilder UND PDFs laufen über inlineData). */
function anhaengeGemini(anhaenge) {
    return anhaenge.map((a) => ({
        inlineData: { mimeType: a.kind === 'pdf' ? 'application/pdf' : a.mediaType, data: a.base64 },
    }))
}

/** Anhänge → OpenAI-Inhaltsblöcke (nur Bilder). */
function anhaengeOpenAI(anhaenge) {
    return anhaenge
        .filter((a) => a.kind === 'image')
        .map((a) => ({ type: 'image_url', image_url: { url: `data:${a.mediaType};base64,${a.base64}` } }))
}

// ── Provider ─────────────────────────────────────────────────────────────

async function anthropic(cfg, system, user, timeoutMs, anhaenge = []) {
    const r = await fetchMitTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': cfg.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: cfg.model,
            max_tokens: cfg.maxTokens,
            // Neuere Modelle (Opus 5, Sonnet 5, Fable 5 …) lehnen Sampling-
            // Parameter mit 400 ab — dann muss das Feld ganz fehlen.
            ...samplingFelder(cfg.model, cfg.temperature),
            system,
            // Bewusst OHNE vorbelegte Assistant-Nachricht: der Prefill-Trick
            // ("{" vorgeben, damit die Antwort mit JSON beginnt) wird von
            // neueren Modellen abgelehnt ("does not support assistant message
            // prefill"). Das JSON wird stattdessen aus der Antwort geschnitten
            // — `parseJsonAntwort` kommt mit Code-Zäunen und Vorgeplänkel klar.
            messages: [
                { role: 'user', content: [...anhaengeAnthropic(anhaenge), { type: 'text', text: user }] },
            ],
        }),
    }, timeoutMs)
    if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error('Anthropic: ' + (e.error?.message || r.statusText))
    }
    const d = await r.json()
    const text = d.content?.filter((b) => b.type === 'text').map((b) => b.text).join('') || ''
    return {
        text,
        stopReason: d.stop_reason || '',
        promptTokens: d.usage?.input_tokens || 0,
        completionTokens: d.usage?.output_tokens || 0,
    }
}

async function openaiKompatibel(cfg, system, user, timeoutMs, endpoint, anhaenge = []) {
    const bilder = anhaengeOpenAI(anhaenge)
    const userInhalt = bilder.length ? [...bilder, { type: 'text', text: user }] : user
    const r = await fetchMitTimeout(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: cfg.model,
            ...samplingFelder(cfg.model, cfg.temperature),
            max_tokens: cfg.maxTokens,
            response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: system }, { role: 'user', content: userInhalt }],
        }),
    }, timeoutMs)
    if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error('OpenAI-kompatibel: ' + (e.error?.message || r.statusText))
    }
    const d = await r.json()
    return {
        text: d.choices?.[0]?.message?.content || '',
        stopReason: d.choices?.[0]?.finish_reason || '',
        promptTokens: d.usage?.prompt_tokens || 0,
        completionTokens: d.usage?.completion_tokens || 0,
    }
}

async function gemini(cfg, system, user, timeoutMs, anhaenge = []) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`
    const r = await fetchMitTimeout(url, {
        method: 'POST',
        headers: { 'x-goog-api-key': cfg.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [...anhaengeGemini(anhaenge), { text: user }] }],
            generationConfig: {
                temperature: cfg.temperature,
                maxOutputTokens: cfg.maxTokens,
                responseMimeType: 'application/json',
            },
        }),
    }, timeoutMs)
    if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error('Gemini: ' + (e.error?.message || r.statusText))
    }
    const d = await r.json()
    return {
        text: d.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '',
        stopReason: d.candidates?.[0]?.finishReason || '',
        promptTokens: d.usageMetadata?.promptTokenCount || 0,
        completionTokens: d.usageMetadata?.candidatesTokenCount || 0,
    }
}

async function ollama(cfg, system, user, timeoutMs, anhaenge = []) {
    const bilder = anhaenge.filter((a) => a.kind === 'image').map((a) => a.base64)
    const url = cfg.ollamaUrl.replace(/\/$/, '')
    assertAllowedOllamaUrl(url)          // SSRF-Schutz wie im übrigen Projekt
    const r = await fetchMitTimeout(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: cfg.model,
            stream: false,
            format: 'json',
            options: { temperature: cfg.temperature, num_predict: cfg.maxTokens },
            messages: [
                { role: 'system', content: system },
                bilder.length ? { role: 'user', content: user, images: bilder } : { role: 'user', content: user },
            ],
        }),
    }, timeoutMs)
    if (!r.ok) throw new Error('Ollama: ' + r.statusText)
    const d = await r.json()
    return {
        text: d.message?.content || '',
        stopReason: d.done_reason || '',
        promptTokens: d.prompt_eval_count || 0,
        completionTokens: d.eval_count || 0,
    }
}

/**
 * Eine Frage, eine JSON-Antwort.
 *
 * @returns {Promise<{ json: object|null, text: string, usage: object, costUsd: number }>}
 *   `json` ist null, wenn das Modell kein verwertbares JSON geliefert hat. Der
 *   Aufrufer muss diesen Fall behandeln — im Handel ist eine unverständliche
 *   Antwort ein Grund zum Aussetzen, nicht zum Raten.
 */
export async function callLLMJson(cfg, { system, user, timeoutMs = DEFAULT_TIMEOUT_MS, anhaenge = [] }) {
    if (!cfg.model) throw new Error('Kein Modell konfiguriert')
    if (cfg.provider !== 'ollama' && !cfg.apiKey) {
        throw new Error(`Kein API-Schlüssel für ${cfg.provider} hinterlegt`)
    }

    // Anhänge früh prüfen: eine stillschweigend verworfene Datei wäre schlimmer
    // als ein klarer Fehler, weil das Modell dann über nichts urteilt.
    if (anhaenge.length) {
        const { ok, nichtUnterstuetzt } = pruefeAnhaenge(cfg.provider, anhaenge)
        if (!ok) {
            throw new Error(`${cfg.provider} kann diese Anhänge nicht verarbeiten: `
                + `${nichtUnterstuetzt.join(', ')}. Anthropic und Gemini verstehen PDFs direkt; `
                + 'sonst bitte Bilder oder Text verwenden.')
        }
    }

    let antwort
    switch (cfg.provider) {
        case 'anthropic': antwort = await anthropic(cfg, system, user, timeoutMs, anhaenge); break
        case 'openai': antwort = await openaiKompatibel(cfg, system, user, timeoutMs, 'https://api.openai.com/v1/chat/completions', anhaenge); break
        case 'deepseek': antwort = await openaiKompatibel(cfg, system, user, timeoutMs, 'https://api.deepseek.com/v1/chat/completions', anhaenge); break
        case 'gemini': antwort = await gemini(cfg, system, user, timeoutMs, anhaenge); break
        case 'custom': {
            if (!cfg.baseUrl) throw new Error('Für den eigenen Anbieter ist keine Basis-URL hinterlegt')
            antwort = await openaiKompatibel(cfg, system, user, timeoutMs, `${cfg.baseUrl}/chat/completions`, anhaenge)
            break
        }
        case 'ollama': antwort = await ollama(cfg, system, user, timeoutMs, anhaenge); break
        default: throw new Error(`Unbekannter Provider: ${cfg.provider}`)
    }

    const json = parseJsonAntwort(antwort.text)

    // Bei Fehlschlag muss erkennbar sein WARUM. Der mit Abstand häufigste Grund
    // ist eine abgeschnittene Antwort (`max_tokens` erreicht) — dann fehlt dem
    // JSON schlicht das Ende. Ohne diese Unterscheidung sucht man den Fehler
    // im Prompt, obwohl nur das Token-Budget zu klein war.
    const abgeschnitten = ['max_tokens', 'length', 'MAX_TOKENS'].includes(antwort.stopReason)
    if (!json) {
        logWarn('llm', `${cfg.provider}/${cfg.model}: kein verwertbares JSON `
            + `(stopReason=${antwort.stopReason || 'unbekannt'}, `
            + `${antwort.completionTokens} Token) — Anfang: ${String(antwort.text).slice(0, 300)}`)
    }

    const usage = {
        promptTokens: antwort.promptTokens,
        completionTokens: antwort.completionTokens,
        totalTokens: antwort.promptTokens + antwort.completionTokens,
    }
    return {
        json,
        text: antwort.text,
        stopReason: antwort.stopReason,
        abgeschnitten,
        usage,
        costUsd: schaetzeKosten(cfg.model, usage.promptTokens, usage.completionTokens),
    }
}
