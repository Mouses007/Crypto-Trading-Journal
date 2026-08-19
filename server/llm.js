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
import {
    samplingFelder, ANBIETER_REG, KEY_SPALTEN, KI_URL_SPALTEN,
    keySpalte, istOpenAiKompatibel, chatEndpunkt,
} from './ai-models.js'
import { decrypt } from './crypto.js'
// Direkt aus `ollama-url.js`, nicht über `ollama-api.js`: dort wird die
// Funktion nur durchgereicht, und der Umweg war der einzige Import-Zyklus im
// Server (`ollama-api.js` holt sich seinerseits Guthaben-Helfer von hier).
import { assertAllowedOllamaUrl } from './ollama-url.js'
import { logWarn } from './logger.js'

const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

/** Preise in USD je Million Token (Eingabe, Ausgabe). Nur zur Budgetschätzung. */
const PREISE = {
    'claude-fable': [10, 50],
    'claude-opus': [5, 25],
    'claude-sonnet': [3, 15],
    'claude-haiku': [1, 5],
    'gpt-5.6-sol': [5, 30],
    'gpt-5.6-terra': [2, 12],
    'gpt-5.6-luna': [0.2, 1.2],
    'gpt-4o-mini': [0.15, 0.6],
    'gpt-4o': [2.5, 10],
    // Längere Namen zuerst: der Treffer geht über `includes`, sonst würde
    // `gemini-3.5-flash` auch `gemini-3.5-flash-lite` einfangen.
    'gemini-3.5-flash-lite': [0.3, 2.5],
    'gemini-3.1-flash-lite': [0.25, 1.5],
    'gemini-2.5-flash-lite': [0.1, 0.4],
    'gemini-3.1-pro': [2, 12],
    'gemini-3.7-flash': [0.75, 3.75],
    'gemini-3.6-flash': [0.75, 3.75],
    'gemini-3.5-flash': [1.5, 9],
    'gemini-3-flash': [0.5, 3],
    'gemini-2.5-pro': [1.25, 10],
    'gemini-2.5-flash': [0.3, 2.5],
    'mistral-medium': [1.5, 7.5],
    'mistral-large': [0.5, 1.5],
    'mistral-small': [0.15, 0.6],
    // Längere Namen zuerst (Treffer über `includes`). Stand 17.08.2026 laut
    // docs.x.ai/developers/pricing; vorher stand hier pauschal `grok-4: [4,12]`
    // und rechnete damit rund das Doppelte des tatsächlichen Preises.
    'grok-4.6': [2, 6],
    'grok-4.5': [2, 6],
    'grok-4.3': [1.25, 2.5],
    'grok-build': [1, 2],
    'grok-4': [2, 6],
    // Längerer Name zuerst, sonst fängt `sonar` auch `sonar-pro` ein.
    'sonar-pro': [3, 15],
    'sonar': [1, 1],
    'qwen3.7-max': [2, 6],          // Alibaba nennt keinen öffentlichen Listenpreis
    'qwen3.7-plus': [0.5, 2],       // — Schätzwerte, nur für die Budget-Anzeige
    'qwen3.6-flash': [0.15, 0.6],
    'deepseek-v4-flash': [0.44, 1.32],
    'deepseek-v4-pro': [1.32, 3.96],
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

// ── Guthaben-Status ──────────────────────────────────────────────────────
//
// Kein grosser Anbieter verrät sein Restguthaben über den normalen API-Key
// (xAI nur per separatem Management-Key, der Rest gar nicht). Was sich ehrlich
// sagen lässt, ist deshalb: „der letzte Aufruf scheiterte an fehlendem
// Guthaben" — die Anbieter melden das mit eindeutigen Fehlertexten. Das wird
// je Anbieter in `settings.aiQuotaStatus` festgehalten und beim nächsten
// erfolgreichen Aufruf wieder gelöscht.

/** Sieht diese Fehlermeldung nach aufgebrauchtem Guthaben/Kontingent aus? */
export function istGuthabenFehler(text) {
    return /insufficient[_ ]quota|insufficient[_ ]credits?|credit balance|balance is too low|out of credits|no credits|payment required|billing hard limit|purchase (more )?credits|HTTP 402|\b402\b|exceeded your current quota/i
        .test(String(text || ''))
}

/**
 * Guthaben-Status eines Anbieters festhalten.
 * `fehler` gesetzt → als leer markieren (mit Meldung und Zeitpunkt);
 * ohne `fehler` → Erfolg: Leer-Flag löschen, „zuletzt ok" höchstens stündlich
 * schreiben, damit nicht jeder Aufruf einen Schreibzugriff kostet.
 */
export async function merkeKiGuthaben(provider, fehler = null) {
    try {
        const knex = getKnex()
        const s = await knex('settings').where('id', 1).select('aiQuotaStatus').first()
        let status = {}
        try { status = JSON.parse(s?.aiQuotaStatus || '{}') } catch { /* Altbestand */ }

        const alt = status[provider] || {}
        if (fehler) {
            status[provider] = {
                leer: true,
                meldung: String(fehler).slice(0, 200),
                seit: alt.leer ? (alt.seit || Date.now()) : Date.now(),
            }
            // Nur beim Kippen melden, nicht bei jedem weiteren Fehlschlag:
            // sonst schickt eine Fehlersalve eine Mail je Aufruf.
            if (!alt.leer) {
                const { melde } = await import('./benachrichtigungen.js')
                melde('kiGuthabenLeer', {
                    betreff: `KI-Guthaben aufgebraucht: ${provider}`,
                    text: `Der Anbieter ${provider} nimmt keine Anfragen mehr an — `
                        + 'das deutet auf ein leeres Guthaben oder ein erreichtes Limit hin.\n\n'
                        + `Meldung: ${String(fehler).slice(0, 300)}\n\n`
                        + 'Solange das anhält, fallen Lagebericht, KI-Berichte und Agentenläufe '
                        + 'aus, die auf diesen Anbieter eingestellt sind.',
                    schluessel: String(provider),
                }).catch(() => { })
            }
        } else {
            if (!alt.leer && alt.okSeit && Date.now() - alt.okSeit < 60 * 60 * 1000) return
            status[provider] = { leer: false, okSeit: Date.now() }
        }
        await knex('settings').where('id', 1).update({ aiQuotaStatus: JSON.stringify(status) })
    } catch (e) {
        logWarn('llm', `Guthaben-Status nicht gespeichert: ${e.message}`)
    }
}

/**
 * Zugangsdaten für die Strategie- und Regel-Baukästen.
 *
 * Eigener Einstieg statt `ladeLlmConfig()` ohne Argumente: Die Baukästen
 * schreiben Code-nahe Strukturen und profitieren von einem starken Modell,
 * während die Routine-Arbeit anderswo billiger laufen darf. Leer eingestellt
 * heisst weiterhin: der globale Anbieter.
 */
export async function ladeStrategieLlmConfig() {
    const s = await getKnex()('settings')
        .select('aiStrategieProvider', 'aiStrategieModell').where('id', 1).first()
    const provider = String(s?.aiStrategieProvider || '').trim()
    // Modell nur zusammen mit eigenem Anbieter — ein Modellname aus einem
    // anderen Haus wäre bei jedem Aufruf ein 404.
    return ladeLlmConfig(provider
        ? { provider, model: String(s?.aiStrategieModell || '').trim() || undefined }
        : {})
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
            ...KEY_SPALTEN, ...KI_URL_SPALTEN)
        .where('id', 1).first()
    if (!s) throw new Error('Keine KI-Einstellungen gefunden')

    const gewaehlt = provider || s.aiProvider || 'ollama'
    const spalte = keySpalte(gewaehlt)

    let apiKey = ''
    if (spalte && s[spalte]) apiKey = decrypt(s[spalte])
    // Der alte Sammelschlüssel `aiApiKey` stammt aus der Zeit vor den
    // Anbieter-Spalten und enthielt einen OpenAI-Schlüssel. Er darf NUR dort
    // einspringen — sonst schickt das Journal einen OpenAI-Schlüssel an
    // fremde Hosts.
    else if (gewaehlt === 'openai' && s.aiApiKey) apiKey = decrypt(s.aiApiKey)

    return {
        provider: gewaehlt,
        model: model || s.aiModel || '',
        apiKey,
        temperature: 0,                 // Entscheidungen sollen reproduzierbar sein
        maxTokens: 800,                 // eine JSON-Antwort braucht nicht mehr
        ollamaUrl: s.aiOllamaUrl || DEFAULT_OLLAMA_URL,
        endpunkt: chatEndpunkt(gewaehlt, s),
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
 *
 * Die Angaben stehen im Anbieter-Verzeichnis (`ANBIETER_REG`); hier bleibt nur
 * die abgeleitete Sicht, weil `rule-builder` und `strategy-builder` sie unter
 * diesem Namen importieren.
 */
export const ANHANG_UNTERSTUETZUNG = Object.fromEntries(
    Object.entries(ANBIETER_REG).map(([id, reg]) => [id, reg.anhang]),
)

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
            // Nicht jeder OpenAI-kompatible Anbieter nimmt `response_format` an
            // (DashScope/Qwen etwa nicht) — und eine Ablehnung ist ein harter
            // 400. `parseJsonAntwort` schneidet JSON notfalls aus Prosa.
            ...(ANBIETER_REG[cfg.provider]?.jsonModus ? { response_format: { type: 'json_object' } } : {}),
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
    try {
        if (cfg.provider === 'anthropic') antwort = await anthropic(cfg, system, user, timeoutMs, anhaenge)
        else if (cfg.provider === 'gemini') antwort = await gemini(cfg, system, user, timeoutMs, anhaenge)
        else if (cfg.provider === 'ollama') antwort = await ollama(cfg, system, user, timeoutMs, anhaenge)
        else if (istOpenAiKompatibel(cfg.provider)) {
            // openai, mistral, xai, qwen, custom — und deepseek aus dem Altbestand
            if (!cfg.endpunkt) throw new Error(`Für ${cfg.provider} ist keine Basis-URL hinterlegt`)
            antwort = await openaiKompatibel(cfg, system, user, timeoutMs, cfg.endpunkt, anhaenge)
        } else throw new Error(`Unbekannter Provider: ${cfg.provider}`)
    } catch (e) {
        if (istGuthabenFehler(e.message)) await merkeKiGuthaben(cfg.provider, e.message)
        throw e
    }
    // Erfolg vermerken — bewusst ohne await, der Status ist kein Blocker
    merkeKiGuthaben(cfg.provider).catch(() => { })

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
