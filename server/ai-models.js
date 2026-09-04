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
import { isAllowedOllamaUrl } from './ollama-url.js'
import { decrypt } from './crypto.js'
import { logError, logWarn } from './logger.js'
import { beobachteAbbruch } from './sse.js'

/**
 * Anbieter-Verzeichnis — die einzige Wahrheit über KI-Anbieter.
 *
 * Vorher standen Anbietername, Adresse, Schlüsselspalte und Fähigkeiten an rund
 * einem Dutzend Stellen verteilt, jede für sich gepflegt. Wer einen Anbieter
 * ergänzte, musste sechs `else if`-Ketten und ebenso viele Spaltenlisten
 * treffen — und übersah zuverlässig eine davon.
 *
 * Felder:
 *   art        'openai' = spricht die OpenAI-Schnittstelle (ein gemeinsamer
 *              Code-Pfad), sonst eigener Zweig
 *   basisUrl   feste Adresse ODER
 *   urlSpalte  Einstellungsfeld, aus dem die Adresse kommt (Betreiber-abhängig)
 *   anhang     was der Anbieter an Anhängen versteht (Bilder/PDF)
 *   jsonModus  ob `response_format: json_object` akzeptiert wird
 *   katalog    ob sich die Modellliste beim Anbieter abrufen lässt
 *   abgekuendigt  nicht mehr wählbar, aber zur Laufzeit weiter bedient
 *
 * Modell-Listen bewusst kurz: was fehlt, trägt man in den Einstellungen nach.
 * Stand 16.08.2026, gegen die Anbieter-Seiten geprüft.
 */
export const ANBIETER_REG = {
    ollama: {
        name: 'Ollama (lokal)', art: 'ollama', keySpalte: '',
        anhang: { image: true, pdf: false }, jsonModus: false, katalog: false,
        modelle: [],   // kommen vom Ollama-Server selbst
    },
    anthropic: {
        name: 'Anthropic (Claude)', art: 'anthropic', keySpalte: 'aiKeyAnthropic',
        keyUrl: 'console.anthropic.com/settings/keys',
        anhang: { image: true, pdf: true }, jsonModus: false, katalog: true,
        modelle: ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-haiku-4-5'],
    },
    openai: {
        name: 'OpenAI', art: 'openai', keySpalte: 'aiKeyOpenai',
        basisUrl: 'https://api.openai.com/v1', keyUrl: 'platform.openai.com/api-keys',
        anhang: { image: true, pdf: false }, jsonModus: true, katalog: true,
        modelle: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    },
    gemini: {
        name: 'Google Gemini', art: 'gemini', keySpalte: 'aiKeyGemini',
        keyUrl: 'aistudio.google.com/apikey',
        anhang: { image: true, pdf: true }, jsonModus: false, katalog: true,
        // `gemini-2.x` fehlt bewusst: Google antwortet darauf mit 404
        // („no longer available to new users").
        modelle: [
            'gemini-3.8-flash',        // neuestes Flash (04.09.2026), gleicher Preis wie 3.7
            'gemini-3.7-flash',        // im Gratis-Kontingent oft 503
            'gemini-3.6-flash',
            'gemini-3.5-flash',
            'gemini-3.5-flash-lite',
            'gemini-3.1-flash-lite',
            'gemini-3.1-pro-preview',  // Pro-Modelle brauchen ein Abrechnungskonto
        ],
    },
    mistral: {
        name: 'Mistral', art: 'openai', keySpalte: 'aiKeyMistral',
        basisUrl: 'https://api.mistral.ai/v1', keyUrl: 'console.mistral.ai/api-keys',
        anhang: { image: false, pdf: false },   // ungetestet, siehe unten
        jsonModus: true, katalog: true,
        modelle: ['mistral-medium-2508', 'mistral-large-2411', 'mistral-small-2506'],
    },
    xai: {
        name: 'xAI (Grok)', art: 'openai', keySpalte: 'aiKeyXai',
        basisUrl: 'https://api.x.ai/v1', keyUrl: 'console.x.ai',
        anhang: { image: false, pdf: false },   // ungetestet, siehe unten
        jsonModus: true, katalog: true,
        modelle: ['grok-4.6', 'grok-4.5', 'grok-4.3'],
    },
    qwen: {
        name: 'Qwen (Alibaba)', art: 'openai', keySpalte: 'aiKeyQwen',
        // Alibaba vergibt internationalen Konten arbeitsbereichs-eigene Hosts,
        // deshalb überschreibbar. `basisUrl` ist nur die Vorbelegung.
        basisUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        urlSpalte: 'aiQwenUrl', keyUrl: 'bailian.console.alibabacloud.com',
        anhang: { image: false, pdf: false },
        // DashScope nimmt `response_format` nicht durchgängig an — ein 400
        // legt sonst die Strategie-Agenten lahm.
        jsonModus: false, katalog: false,
        modelle: ['qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-flash'],
    },
    perplexity: {
        name: 'Perplexity (Sonar)', art: 'openai', keySpalte: 'aiKeyPerplexity',
        basisUrl: 'https://api.perplexity.ai', keyUrl: 'perplexity.ai/settings/api',
        // Sonar ist eine Such-KI: jede Antwort kommt mit Web-Zitaten. Primär
        // für die Themen-Recherche des Lageberichts gedacht; als Chat-Anbieter
        // wählbar, aber ohne Anhänge und ohne festen JSON-Modus.
        anhang: { image: false, pdf: false }, jsonModus: false, katalog: false,
        modelle: ['sonar', 'sonar-pro'],
    },
    custom: {
        name: 'Eigener Anbieter (OpenAI-kompatibel)', art: 'openai', keySpalte: 'aiKeyCustom',
        urlSpalte: 'aiCustomUrl', pflichtUrl: true,
        // Was ein eigener Endpunkt kann, weiss nur der Betreiber. Bilder gehen
        // im OpenAI-Format mit; PDFs bleiben aussen vor, weil es dafür kein
        // einheitliches Format gibt.
        anhang: { image: true, pdf: false }, jsonModus: false, katalog: true,
        modelle: [],
    },
    /*
     * DeepSeek war abgekündigt und ist wieder wählbar.
     *
     * Grund für die Rückkehr: Der Hype-Radar braucht ein billiges Modell für
     * seine Hilfsarbeiten (Entdopplung, Einordnung unklarer Kandidaten), und
     * DeepSeek ist mit Abstand das günstigste — bei Aufgaben, für die
     * Urteilskraft zweitrangig ist, zählt genau das.
     */
    deepseek: {
        name: 'DeepSeek', art: 'openai', keySpalte: 'aiKeyDeepseek',
        basisUrl: 'https://api.deepseek.com/v1', keyUrl: 'platform.deepseek.com/api_keys',
        anhang: { image: false, pdf: false }, jsonModus: true, katalog: true,
        modelle: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    },
    /*
     * Die drei Neuen sind alle OpenAI-kompatibel und teilen sich damit den
     * bestehenden Code-Pfad — es braucht je nur diesen Eintrag und eine
     * Schlüsselspalte. Anhänge sind überall aus: ungetestet, und ein still
     * verworfener Screenshot wäre schlimmer als eine klare Absage.
     */
    moonshot: {
        name: 'Moonshot (Kimi)', art: 'openai', keySpalte: 'aiKeyMoonshot',
        basisUrl: 'https://api.moonshot.ai/v1', keyUrl: 'platform.moonshot.ai/console/api-keys',
        anhang: { image: false, pdf: false }, jsonModus: true, katalog: true,
        modelle: ['kimi-k2.6', 'kimi-k2.7'],
    },
    zai: {
        name: 'Z.ai (GLM)', art: 'openai', keySpalte: 'aiKeyZai',
        basisUrl: 'https://api.z.ai/api/paas/v4', keyUrl: 'z.ai/manage-apikey/apikey-list',
        anhang: { image: false, pdf: false }, jsonModus: true, katalog: true,
        modelle: ['glm-5.2', 'glm-5.1'],
    },
    minimax: {
        name: 'MiniMax', art: 'openai', keySpalte: 'aiKeyMinimax',
        basisUrl: 'https://api.minimax.io/v1', keyUrl: 'platform.minimax.io/user-center/basic-information',
        anhang: { image: false, pdf: false }, jsonModus: true, katalog: true,
        modelle: ['minimax-m3', 'minimax-m2.7'],
    },
    openrouter: {
        name: 'OpenRouter', art: 'openai', keySpalte: 'aiKeyOpenrouter',
        basisUrl: 'https://openrouter.ai/api/v1', keyUrl: 'openrouter.ai/keys',
        anhang: { image: true, pdf: false }, jsonModus: false, katalog: true,
        modelle: [
            'anthropic/claude-opus-5',
            'openai/gpt-4o',
            'meta-llama/llama-3.1-70b',
            'deepseek/deepseek-chat',
        ],
    },
}

/** Auswählbare Anbieter — ohne die abgekündigten. */
export const ANBIETER = Object.keys(ANBIETER_REG).filter((p) => !ANBIETER_REG[p].abgekuendigt)

/** Ausgangslisten je auswählbarem Anbieter (Rückfallebene für `ladeModelle`). */
export const STANDARD_MODELLE = Object.fromEntries(
    ANBIETER.map((p) => [p, [...ANBIETER_REG[p].modelle]]),
)

/**
 * Bild-Anbieter der Share-Karten (FLUX.2, Gemini-Bild) — bewusst NICHT Teil
 * von `ANBIETER_REG`: sie sprechen keine Chat-Completions-API, brauchen kein
 * Sampling/JSON-Modus und dürfen in der allgemeinen KI-Anbieter-Auswahl
 * (Berichte/Agent/Strategie) gar nicht erst auftauchen. Sie teilen sich aber
 * dieselbe Modell-Listen-Pflege (`ladeModelle`, `ModelManager.vue`) wie die
 * Chat-Anbieter — sonst bräuchte ein neues FLUX-Modell einen Code-Release.
 */
export const BILD_MODELL_REG = {
    flux: {
        name: 'FLUX.2 (Bild)',
        modelle: ['flux-2-pro', 'flux-2-flex', 'flux-2-max'],
        // BFL führt keinen abrufbaren Katalog (kein `GET /models` — geprüft
        // gegen docs.bfl.ml, Stand 29.08.2026: 404). „Vom Anbieter holen"
        // zeigt deshalb diese von Hand gepflegte Liste der offiziell
        // dokumentierten Endpunkt-Namen statt eines Live-Aufrufs.
        katalog: [
            'flux-2-max', 'flux-2-pro-preview', 'flux-2-pro', 'flux-2-flex',
            'flux-2-klein-4b', 'flux-2-klein-9b-preview', 'flux-2-klein-9b',
        ],
    },
    geminiBild: {
        name: 'Google Gemini (Bild)',
        modelle: ['gemini-2.5-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3.1-flash-image', 'gemini-3-pro-image'],
        // Gemini führt sehr wohl einen Katalog — derselbe `/models`-Endpunkt,
        // den `/api/flux/test-gemini` schon zum Schlüssel-Test nutzt, nur mit
        // dem Bild-Schlüssel statt des Chat-Schlüssels.
        keySpalte: 'geminiImageApiKey',
    },
}

/** Schlüssel der Bild-Anbieter — für Übersicht-Loops ohne zweite Liste. */
export const BILD_SCHLUESSEL = Object.keys(BILD_MODELL_REG)

/** Ausgangslisten je Bild-Anbieter (Rückfallebene für `ladeModelle`). */
export const BILD_STANDARD_MODELLE = Object.fromEntries(
    BILD_SCHLUESSEL.map((p) => [p, [...BILD_MODELL_REG[p].modelle]]),
)

/** Schlüsselspalte eines Anbieters, '' wenn er keine hat (Ollama). */
export function keySpalte(provider) {
    return ANBIETER_REG[provider]?.keySpalte || ''
}

/** Alle Schlüsselspalten — für die `select`-Listen, damit keine vergessen wird. */
export const KEY_SPALTEN = [...new Set(
    Object.values(ANBIETER_REG).map((r) => r.keySpalte).filter(Boolean),
)]

/** Alle Adress-Spalten (`aiCustomUrl`, `aiQwenUrl` …). */
export const KI_URL_SPALTEN = [...new Set(
    Object.values(ANBIETER_REG).map((r) => r.urlSpalte).filter(Boolean),
)]

/** Spricht der Anbieter die OpenAI-Schnittstelle? */
export function istOpenAiKompatibel(provider) {
    return ANBIETER_REG[provider]?.art === 'openai'
}

/** Darf der Anbieter Bilder (Screenshots) mitgeschickt bekommen? */
export function kannBilder(provider) {
    return !!ANBIETER_REG[provider]?.anhang?.image
}

/** Erstes Standardmodell eines Anbieters — Rückfall, wenn keines gewählt ist. */
export function standardModell(provider) {
    return ANBIETER_REG[provider]?.modelle?.[0] || ''
}

/**
 * Basis-URL eines Anbieters: Einstellungsfeld schlägt feste Adresse.
 * @param {string} provider
 * @param {object} settings  gelesene settings-Zeile
 */
export function anbieterBasis(provider, settings = {}) {
    const reg = ANBIETER_REG[provider]
    if (!reg) return ''
    const ausFeld = reg.urlSpalte ? basisUrl(settings[reg.urlSpalte]) : ''
    return ausFeld || (reg.pflichtUrl ? '' : (reg.basisUrl || ''))
}

/** Vollständiger Chat-Endpunkt oder '' wenn keine Adresse ermittelbar ist. */
export function chatEndpunkt(provider, settings = {}) {
    const basis = anbieterBasis(provider, settings)
    return basis ? `${basis}/chat/completions` : ''
}

/**
 * Rückfall-Modell, wenn ein Aufruf kein Gemini-Modell mitgibt.
 *
 * Bewusst günstig, allgemein verfügbar und auch im Gratis-Kontingent
 * erreichbar — ein Rückfall, der am Kontingent scheitert, ist keiner.
 * Hier stand lange `gemini-2.0-flash`; das kennt Google nicht mehr.
 */
export const GEMINI_STANDARDMODELL = 'gemini-3.5-flash-lite'

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

/** Die gespeicherten Roh-Listen (beide Welten), nur einmal aus der DB gelesen. */
async function ladeGespeicherteListen() {
    try {
        const row = await getKnex()('settings').select('aiModels').where('id', 1).first()
        return parse(row?.aiModels, {}) || {}
    } catch (e) {
        logWarn('ai-models', 'Modell-Listen nicht lesbar, nutze Standards')
        return {}
    }
}

/**
 * Gespeicherte Listen, mit den Standards als Rückfallebene je Anbieter.
 *
 * Bewusst NUR die Chat-Anbieter (`ANBIETER`): `AnbieterWahl.vue` leitet ihre
 * Anbieter-Auswahl per `Object.keys(modellListen)` her — ein Bild-Anbieter
 * hier drin tauchte prompt in der Anbieter-Wahl für Berichte/Agent/Strategie
 * auf, obwohl er dort nie etwas beitragen kann. Bild-Listen kommen über
 * `ladeBildModelle()`, eigens und getrennt gehalten.
 */
export async function ladeModelle(gespeichert) {
    gespeichert ??= await ladeGespeicherteListen()
    const out = {}
    for (const anbieter of ANBIETER) {
        const eigene = saeubere(gespeichert[anbieter])
        out[anbieter] = eigene.length ? eigene : [...STANDARD_MODELLE[anbieter]]
    }
    return out
}

/** Dasselbe für die Bild-Anbieter (FLUX.2, Gemini-Bild) — siehe `ladeModelle`. */
export async function ladeBildModelle(gespeichert) {
    gespeichert ??= await ladeGespeicherteListen()
    const out = {}
    for (const bildAnbieter of BILD_SCHLUESSEL) {
        const eigene = saeubere(gespeichert[bildAnbieter])
        out[bildAnbieter] = eigene.length ? eigene : [...BILD_STANDARD_MODELLE[bildAnbieter]]
    }
    return out
}

export function setupAiModelRoutes(app) {
    /** Listen + welche davon vom Standard abweichen. */
    app.get('/api/ai/models', async (req, res) => {
        try {
            // Beide Welten teilen sich dieselbe `settings.aiModels`-Zeile — sie
            // hier einmal laden und beiden reichen, statt sie zweimal separat
            // aus der DB zu holen (das widerspräche `ladeGespeicherteListen`s
            // eigenem "nur einmal aus der DB gelesen").
            const gespeichert = await ladeGespeicherteListen()
            const [modelle, bildModelle] = await Promise.all([ladeModelle(gespeichert), ladeBildModelle(gespeichert)])
            res.json({
                modelle,
                standard: STANDARD_MODELLE,
                bildModelle,
                bildStandard: BILD_STANDARD_MODELLE,
                ohneSampling: OHNE_SAMPLING,
                // Damit die Oberfläche Auswahl, Schlüssel-Hinweis und Adressfeld
                // nicht ein zweites Mal fest verdrahten muss.
                anbieter: ANBIETER.map((id) => ({
                    id,
                    name: ANBIETER_REG[id].name,
                    keyUrl: ANBIETER_REG[id].keyUrl || '',
                    brauchtKey: !!ANBIETER_REG[id].keySpalte,
                    urlSpalte: ANBIETER_REG[id].urlSpalte || '',
                    katalog: !!ANBIETER_REG[id].katalog,
                })),
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
            const istBild = BILD_SCHLUESSEL.includes(anbieter)
            if (!ANBIETER.includes(anbieter) && !istBild) {
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
            // Bild-Anbieter kommen nicht aus `ladeModelle()` (siehe dort) — sonst
            // bekäme ModelManager.vue für `flux`/`geminiBild` eine leere Antwort.
            res.json({ ok: true, modelle: istBild ? await ladeBildModelle() : await ladeModelle() })
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

        // Bild-Anbieter: eigener, kleiner Zweig statt der Chat-Anbieter-Logik
        // unten — die verlangt eine Chat-`/models`-Antwort und filtert
        // Bildmodelle sogar ausdrücklich HERAUS (`untauglich`-Regex).
        if (anbieter === 'flux') {
            // Kein Katalog-Endpunkt bei BFL (siehe `BILD_MODELL_REG`) — von
            // Hand gepflegte Liste der dokumentierten Modellnamen.
            return res.json({ modelle: [...BILD_MODELL_REG.flux.katalog], gesamt: BILD_MODELL_REG.flux.katalog.length })
        }
        if (anbieter === 'geminiBild') {
            try {
                const knex = getKnex()
                const s = await knex('settings').select('geminiImageApiKey').where('id', 1).first()
                const apiKey = decrypt(s?.geminiImageApiKey || '')
                if (!apiKey) {
                    return res.status(400).json({ error: 'Für Gemini-Bild ist kein API-Key hinterlegt.' })
                }
                const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
                    headers: { 'x-goog-api-key': apiKey },
                    signal: AbortSignal.timeout(20000),
                })
                if (!r.ok) {
                    const t = await r.text().catch(() => '')
                    return res.status(502).json({ error: `Gemini antwortet mit ${r.status}${t ? ': ' + t.slice(0, 200) : ''}` })
                }
                const daten = await r.json()
                // Nur Modelle, die Bilder erzeugen — das Gegenteil des Chat-Zweigs
                // unten, der Bildmodelle ausdrücklich verwirft.
                const modelle = [...new Set(
                    (daten.models || [])
                        .map((m) => String(m.name).replace(/^models\//, ''))
                        .filter((m) => m.includes('image'))
                        .filter(istGueltigerModellname),
                )].sort()
                return res.json({ modelle, gesamt: modelle.length })
            } catch (e) {
                logError('ai-models', 'Gemini-Bild-Katalog fehlgeschlagen', e)
                return res.status(502).json({ error: e.message })
            }
        }

        const reg = ANBIETER_REG[anbieter]
        if (!reg) {
            return res.status(400).json({ error: `Unbekannter Anbieter: ${anbieter}` })
        }
        if (reg.abgekuendigt) {
            return res.status(400).json({ error: `${reg.name} wird nicht mehr angeboten.` })
        }
        if (!reg.katalog) {
            return res.status(400).json({
                error: `${reg.name} führt keinen abrufbaren Modell-Katalog — Modelle bitte von Hand eintragen.`,
            })
        }
        try {
            const knex = getKnex()
            const spalte = reg.keySpalte
            const s = await knex('settings').select(spalte, 'aiApiKey', ...KI_URL_SPALTEN).where('id', 1).first()
            // Der alte Sammelschlüssel greift nur noch dort, wo er herkam.
            const apiKey = decrypt(s?.[spalte] || '') || (anbieter === 'openai' ? decrypt(s?.aiApiKey || '') : '')
            if (!apiKey) {
                return res.status(400).json({ error: 'Für diesen Anbieter ist kein API-Key hinterlegt.' })
            }

            const basis = anbieterBasis(anbieter, s)
            if (reg.art === 'openai' && !basis) {
                return res.status(400).json({ error: `Für ${reg.name} ist keine gültige Basis-URL hinterlegt.` })
            }

            const abfrage = {
                anthropic: {
                    url: 'https://api.anthropic.com/v1/models?limit=100',
                    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
                    lies: (d) => (d.data || []).map((m) => m.id),
                },
                gemini: {
                    // Google nimmt den Schlüssel als Header, nicht in der URL —
                    // sonst stünde er in jedem Proxy-Log.
                    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
                    headers: { 'x-goog-api-key': apiKey },
                    lies: (d) => (d.models || []).map((m) => String(m.name).replace(/^models\//, '')),
                },
            }[anbieter] || {
                // Alle OpenAI-kompatiblen Anbieter teilen sich eine Abfrage.
                url: `${basis}/models`,
                headers: { Authorization: `Bearer ${apiKey}` },
                lies: (d) => (d.data || []).map((m) => m.id),
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

    // ── OpenRouter: Modellkatalog abrufen und cachen ─────────────────────

    /**
     * OpenRouter-Modelle mit Benchmarks abrufen und in Settings cachen.
     * Cache-TTL: 24 Stunden.
     */
    app.get('/api/ai/openrouter/models', async (req, res) => {
        try {
            const knex = getKnex()
            const settings = await knex('settings')
                .select('aiKeyOpenrouter', 'aiOpenrouterCatalog')
                .where('id', 1).first()

            if (!settings?.aiKeyOpenrouter) {
                return res.status(400).json({ error: 'OpenRouter API-Key nicht konfiguriert' })
            }

            const apiKey = decrypt(settings.aiKeyOpenrouter)
            if (!apiKey) {
                return res.status(400).json({ error: 'OpenRouter API-Key nicht lesbar' })
            }

            // Cache prüfen (24h)
            let cached = {}
            try { cached = JSON.parse(settings.aiOpenrouterCatalog || '{}') } catch { /* */ }
            if (cached.models && cached.cachedAt && (Date.now() - cached.cachedAt < 24 * 60 * 60 * 1000)) {
                return res.json({ modelle: cached.models, fromCache: true })
            }

            // OpenRouter API aufrufen
            const r = await fetch('https://openrouter.ai/api/v1/models', {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: AbortSignal.timeout(15000),
            })

            if (!r.ok) {
                const text = await r.text().catch(() => '')
                return res.status(502).json({
                    error: `OpenRouter antwortet mit ${r.status}${text ? ': ' + text.slice(0, 200) : ''}`,
                })
            }

            const daten = await r.json()
            /*
             * `architecture.modality` ist ein zusammengesetzter String wie
             * "text+image+file->text", nie das blanke "text" — der alte
             * Vergleich `=== 'text'` traf deshalb nie, der Endpunkt lieferte
             * seit Einführung 0 Modelle. Massgeblich ist, ob Text unter den
             * AUSGABE-Modalitäten steht — Eingabe darf mehr können.
             */
            const allModelle = (daten.data || [])
                .filter((m) => (m.architecture?.output_modalities || []).includes('text'))
                .map((m) => ({
                    id: m.id,
                    name: m.name || m.id,
                    provider: m.id.split('/')[0],
                    pricing: m.pricing || { prompt: 0, completion: 0 },
                    contextLength: m.context_length,
                    topProvider: m.top_provider,
                }))
                .filter((m) => m.id)

            // Cache speichern
            await knex('settings')
                .where('id', 1)
                .update({
                    aiOpenrouterCatalog: JSON.stringify({
                        models: allModelle,
                        cachedAt: Date.now(),
                    }),
                })
                .catch(() => { /* Fehler beim Cachen ignorieren */ })

            res.json({ modelle: allModelle, fromCache: false })
        } catch (e) {
            logError('ai-models', 'OpenRouter-Abfrage fehlgeschlagen', e)
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
            // Warum die Erkennung an der ANTWORT hängt: siehe `server/sse.js`.
            const istAbgebrochen = beobachteAbbruch(res)

            const leser = r.body.getReader()
            const decoder = new TextDecoder()
            let rest = ''
            while (!istAbgebrochen()) {
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
            if (!istAbgebrochen()) sende({ fertigGesamt: true })
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
