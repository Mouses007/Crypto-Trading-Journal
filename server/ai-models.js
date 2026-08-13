/**
 * Modell-Listen verwalten.
 *
 * Bis hierher standen die Modellnamen fest im Frontend. Das altert schlecht:
 * Anbieter veröffentlichen laufend neue Modelle, und wer eines davon nutzen
 * wollte, musste warten, bis jemand die Liste im Quelltext nachzieht. Ab jetzt
 * liegen die Listen in der Datenbank und sind bearbeitbar.
 *
 * Die eingebauten Listen bleiben als Ausgangspunkt bestehen — „zurücksetzen"
 * stellt sie wieder her.
 */

import { getKnex } from './database.js'
import { isAllowedOllamaUrl } from './ollama-api.js'
import { decrypt } from './crypto.js'
import { logError, logWarn } from './logger.js'

/**
 * Ausgangslisten. Bewusst kurz gehalten: was fehlt, trägt man selbst nach —
 * eine lange Liste zu pflegen, die trotzdem immer hinterherhinkt, hilft
 * niemandem.
 */
export const STANDARD_MODELLE = {
    anthropic: [
        'claude-opus-5',
        'claude-sonnet-5',
        'claude-fable-5',
        'claude-haiku-4-5',
    ],
    openai: ['gpt-4o', 'gpt-4o-mini'],
    gemini: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
    // Eigener Endpunkt: welche Modelle es gibt, weiss nur der Betreiber.
    custom: [],
    // Ollama-Modelle kommen vom Server selbst, nicht aus einer Liste.
    ollama: [],
}

export const ANBIETER = Object.keys(STANDARD_MODELLE)

/**
 * Modelle, die Sampling-Parameter (`temperature`, `top_p`, `top_k`) mit einem
 * 400 ablehnen.
 *
 * Das ist kein Schönheitsfehler, sondern ein harter Fehlschlag: die Anfrage
 * kommt gar nicht durch. Geprüft wird per Präfix, damit datierte Varianten
 * (`claude-opus-5-20260101`) mitgefangen werden.
 */
const OHNE_SAMPLING = [
    'claude-opus-5', 'claude-fable-5', 'claude-mythos-5', 'claude-sonnet-5',
    'claude-opus-4-8', 'claude-opus-4-7',
]

/** @returns {boolean} true, wenn `temperature` weggelassen werden MUSS. */
export function lehntSamplingAb(model) {
    const m = String(model || '')
    return OHNE_SAMPLING.some((p) => m.startsWith(p))
}

/**
 * Baut den Sampling-Teil eines Anfrage-Bodys.
 * Für Modelle ohne Sampling-Unterstützung bleibt er leer — nicht `null`,
 * denn auch ein ausdrückliches `temperature: null` wird abgelehnt.
 */
export function samplingFelder(model, temperature) {
    return lehntSamplingAb(model) ? {} : { temperature }
}

const parse = (v, f) => {
    if (v === null || v === undefined) return f
    if (typeof v === 'object') return v
    try { return JSON.parse(v) } catch { return f }
}

/**
 * Ein Modellname ist eine Kennung, kein Pfad.
 *
 * `/` ist erlaubt, weil Ollama-Namen ihn führen (`library/llama3`), aber
 * `..` und ein führender `/` sind es nicht: derselbe Name geht an einen
 * fremden Dienst, und was dort als Pfad gelesen wird, ist nicht unsere
 * Entscheidung. Also gar nicht erst durchlassen.
 */
/**
 * Basis-URL eines eigenen, OpenAI-kompatiblen Endpunkts normalisieren.
 *
 * Erwartet wird das, was der Betreiber als „Base URL" angibt — also der Teil
 * VOR `/chat/completions`, meist mit `/v1` am Ende. Endende Schrägstriche und
 * ein versehentlich mitkopiertes `/chat/completions` werden abgeschnitten,
 * weil beides sonst zu einer 404 führt, die niemand sich erklären kann.
 *
 * @returns {string} normalisierte URL, oder '' wenn unbrauchbar
 */
export function basisUrl(roh) {
    const s = String(roh || '').trim()
    if (!s) return ''
    let u
    try { u = new URL(s) } catch { return '' }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    let pfad = u.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
    return `${u.origin}${pfad}`
}

export function istGueltigerModellname(m) {
    const s = String(m || '')
    if (!s || s.length > 120) return false
    if (!/^[A-Za-z0-9._:\/-]+$/.test(s)) return false
    if (s.includes('..') || s.startsWith('/') || s.startsWith('-')) return false
    return true
}

const saeubere = (liste) => [...new Set(
    (Array.isArray(liste) ? liste : [])
        .map((m) => String(m || '').trim().slice(0, 120))
        .filter(istGueltigerModellname),
)].slice(0, 60)

/** Gespeicherte Listen, mit den Standards als Rückfallebene je Anbieter. */
export async function ladeModelle() {
    let gespeichert = {}
    try {
        const row = await getKnex()('settings').select('aiModels').where('id', 1).first()
        gespeichert = parse(row?.aiModels, {}) || {}
    } catch (e) {
        logWarn('ai-models', 'Modell-Listen nicht lesbar, nutze Standards')
    }
    const out = {}
    for (const anbieter of ANBIETER) {
        const eigene = saeubere(gespeichert[anbieter])
        out[anbieter] = eigene.length ? eigene : [...STANDARD_MODELLE[anbieter]]
    }
    return out
}

export function setupAiModelRoutes(app) {
    /** Listen + welche davon vom Standard abweichen. */
    app.get('/api/ai/models', async (req, res) => {
        try {
            const modelle = await ladeModelle()
            res.json({
                modelle,
                standard: STANDARD_MODELLE,
                ohneSampling: OHNE_SAMPLING,
            })
        } catch (e) {
            logError('ai-models', 'Laden fehlgeschlagen', e)
            res.status(500).json({ error: 'Interner Serverfehler' })
        }
    })

    /** Liste eines Anbieters ersetzen. Leere Liste = zurück auf Standard. */
    app.put('/api/ai/models/:provider', async (req, res) => {
        try {
            const anbieter = String(req.params.provider)
            if (!ANBIETER.includes(anbieter)) {
                return res.status(400).json({ error: 'Unbekannter Anbieter' })
            }
            if (anbieter === 'ollama') {
                return res.status(400).json({
                    error: 'Ollama-Modelle werden nicht hier gepflegt — sie kommen vom Ollama-Server.',
                })
            }
            const knex = getKnex()
            const row = await knex('settings').select('aiModels').where('id', 1).first()
            const alle = parse(row?.aiModels, {}) || {}
            alle[anbieter] = saeubere(req.body?.modelle)
            await knex('settings').where('id', 1).update({ aiModels: JSON.stringify(alle) })
            res.json({ ok: true, modelle: await ladeModelle() })
        } catch (e) {
            logError('ai-models', 'Speichern fehlgeschlagen', e)
            res.status(500).json({ error: 'Interner Serverfehler' })
        }
    })

    /**
     * Modelle beim Anbieter erfragen.
     *
     * Einen Modellnamen exakt abzutippen ist eine unnötige Fehlerquelle — ein
     * Tippfehler fällt erst beim ersten Aufruf auf, und dann als kryptischer
     * 404. Die Anbieter führen alle einen Katalog; der wird hier geholt.
     */
    app.get('/api/ai/models/available', async (req, res) => {
        const anbieter = String(req.query.provider || '')
        if (!ANBIETER.includes(anbieter) || anbieter === 'ollama') {
            return res.status(400).json({ error: 'Unbekannter oder nicht abfragbarer Anbieter' })
        }
        try {
            const knex = getKnex()
            const spalte = {
                openai: 'aiKeyOpenai', anthropic: 'aiKeyAnthropic',
                gemini: 'aiKeyGemini', deepseek: 'aiKeyDeepseek', custom: 'aiKeyCustom',
            }[anbieter]
            const s = await knex('settings').select(spalte, 'aiApiKey', 'aiCustomUrl').where('id', 1).first()
            const apiKey = decrypt(s?.[spalte] || '') || decrypt(s?.aiApiKey || '')
            if (!apiKey) {
                return res.status(400).json({ error: 'Für diesen Anbieter ist kein API-Key hinterlegt.' })
            }

            const abfrage = {
                anthropic: {
                    url: 'https://api.anthropic.com/v1/models?limit=100',
                    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
                    lies: (d) => (d.data || []).map((m) => m.id),
                },
                openai: {
                    url: 'https://api.openai.com/v1/models',
                    headers: { Authorization: `Bearer ${apiKey}` },
                    lies: (d) => (d.data || []).map((m) => m.id),
                },
                deepseek: {
                    url: 'https://api.deepseek.com/models',
                    headers: { Authorization: `Bearer ${apiKey}` },
                    lies: (d) => (d.data || []).map((m) => m.id),
                },
                gemini: {
                    // Google nimmt den Schlüssel als Header, nicht in der URL —
                    // sonst stünde er in jedem Proxy-Log.
                    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
                    headers: { 'x-goog-api-key': apiKey },
                    lies: (d) => (d.models || []).map((m) => String(m.name).replace(/^models\//, '')),
                },
                custom: {
                    url: `${basisUrl(s?.aiCustomUrl)}/models`,
                    headers: { Authorization: `Bearer ${apiKey}` },
                    lies: (d) => (d.data || []).map((m) => m.id),
                },
            }[anbieter]

            if (anbieter === 'custom' && !basisUrl(s?.aiCustomUrl)) {
                return res.status(400).json({ error: 'Für den eigenen Anbieter ist keine gültige Basis-URL hinterlegt.' })
            }

            const r = await fetch(abfrage.url, {
                headers: abfrage.headers,
                signal: AbortSignal.timeout(20000),
            })
            if (!r.ok) {
                const t = await r.text().catch(() => '')
                return res.status(502).json({
                    error: `${anbieter} antwortet mit ${r.status}${t ? ': ' + t.slice(0, 200) : ''}`,
                })
            }
            const daten = await r.json()
            const alle = abfrage.lies(daten).filter(istGueltigerModellname)

            // Nur Modelle, die Text erzeugen können. Einbettungs-, Bild- und
            // Sprachmodelle gehören nicht in eine Chat-Auswahl.
            const untauglich = /embed|whisper|tts|dall-e|moderation|image-generation|aqa|imagen|veo/i
            const modelle = [...new Set(alle.filter((m) => !untauglich.test(m)))].sort()

            res.json({ modelle, gesamt: alle.length })
        } catch (e) {
            logError('ai-models', 'Anbieter-Abfrage fehlgeschlagen', e)
            res.status(502).json({ error: e.message })
        }
    })

    // ── Ollama: installierte Modelle holen, laden, löschen ───────────────

    async function ollamaUrl(req) {
        const knex = getKnex()
        const row = await knex('settings').select('aiOllamaUrl').where('id', 1).first()
        const url = req.body?.url || req.query?.url || row?.aiOllamaUrl || 'http://localhost:11434'
        if (!isAllowedOllamaUrl(url)) throw new Error('Nur lokale/private Hosts erlaubt')
        return String(url).replace(/\/+$/, '')
    }

    /** Was auf dem Ollama-Server bereits liegt, mit Grösse. */
    app.get('/api/ollama/models', async (req, res) => {
        try {
            const url = await ollamaUrl(req)
            const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(10000) })
            if (!r.ok) return res.status(502).json({ error: `Ollama antwortet mit ${r.status}` })
            const d = await r.json()
            res.json({
                models: (d.models || []).map((m) => ({
                    name: m.name,
                    groesseBytes: m.size || 0,
                    geaendert: m.modified_at || '',
                    parameter: m.details?.parameter_size || '',
                    quantisierung: m.details?.quantization_level || '',
                })),
            })
        } catch (e) {
            res.status(502).json({ error: e.message })
        }
    })

    /**
     * Modell herunterladen. Ollama streamt den Fortschritt als NDJSON; das
     * wird hier zu SSE umgesetzt, damit die Oberfläche einen Balken zeigen
     * kann statt minutenlang stillzustehen.
     */
    app.post('/api/ollama/pull', async (req, res) => {
        const name = String(req.body?.name || '').trim()
        if (!istGueltigerModellname(name)) {
            return res.status(400).json({ error: 'Ungültiger Modellname' })
        }
        let url
        try { url = await ollamaUrl(req) }
        catch (e) { return res.status(400).json({ error: e.message }) }

        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        const sende = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`)

        try {
            // Kein Timeout: ein 20-GB-Modell zu laden dauert.
            const r = await fetch(`${url}/api/pull`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, stream: true }),
            })
            if (!r.ok || !r.body) {
                sende({ fehler: `Ollama antwortet mit ${r.status}` })
                return res.end()
            }

            // Der Client kann abbrechen — dann den Download nicht weiterlesen.
            let abgebrochen = false
            req.on('close', () => { abgebrochen = true })

            const leser = r.body.getReader()
            const decoder = new TextDecoder()
            let rest = ''
            while (!abgebrochen) {
                const { done, value } = await leser.read()
                if (done) break
                rest += decoder.decode(value, { stream: true })
                const zeilen = rest.split('\n')
                rest = zeilen.pop() || ''
                for (const zeile of zeilen) {
                    if (!zeile.trim()) continue
                    let o
                    try { o = JSON.parse(zeile) } catch { continue }
                    if (o.error) { sende({ fehler: o.error }); return res.end() }
                    sende({
                        status: o.status || '',
                        gesamt: o.total || 0,
                        fertig: o.completed || 0,
                    })
                }
            }
            if (!abgebrochen) sende({ fertigGesamt: true })
            res.end()
        } catch (e) {
            logError('ai-models', 'Ollama-Pull fehlgeschlagen', e)
            sende({ fehler: e.message })
            res.end()
        }
    })

    /** Modell vom Ollama-Server löschen (gibt Plattenplatz frei). */
    app.delete('/api/ollama/models', async (req, res) => {
        try {
            const name = String(req.body?.name || req.query?.name || '').trim()
            if (!istGueltigerModellname(name)) {
                return res.status(400).json({ error: 'Ungültiger Modellname' })
            }
            const url = await ollamaUrl(req)
            const r = await fetch(`${url}/api/delete`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
                signal: AbortSignal.timeout(20000),
            })
            if (!r.ok) return res.status(502).json({ error: `Ollama antwortet mit ${r.status}` })
            res.json({ ok: true })
        } catch (e) {
            res.status(502).json({ error: e.message })
        }
    })
}
