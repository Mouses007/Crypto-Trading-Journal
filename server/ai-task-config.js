/**
 * ai-task-config.js — KI-Aufgaben-Definitionen.
 *
 * Jede Aufgabe (News, Trade-Analyse, Agent, etc.) hat ihre eigenen
 * Anforderungen an Modell-Qualität, Kosten, Geschwindigkeit und Features.
 * Diese Datei ist das Registry: welche Aufgabe gibt es, was braucht sie,
 * welche Modelle sind empfohlen.
 *
 * Der Agent nutzt das, um Modell-Empfehlungen zu geben.
 * Das Frontend zeigt pro Aufgabe einen Dropdown mit Modellen.
 */

/**
 * Registry aller KI-Aufgaben.
 *
 * Felder:
 *   id – technischer Name (Schlüssel in aiTaskProviders)
 *   name – Anzeigename für Oberfläche
 *   description – Was diese Aufgabe tut
 *   importance – 'high' | 'medium' | 'low' = Gewicht bei Empfehlungen
 *   maxTokens – Budget für Output (nicht Input)
 *   recommendedModels – Empfehlung als `anbieter/modell`, erste = Vorgabe
 *                    (dasselbe Format wie `settings.aiTaskProviders`)
 *   requiresToolCalling – Braucht das Modell native Tool-Unterstützung?
 *   supportedProviders – Whitelist von Anbietern, die diese Aufgabe können (optional)
 *   rueckfallFeld – das ältere Einzelfeld, das gilt, wenn die Aufgaben-Zeile leer ist
 *
 * Stand 18.10.2026. Faustregel der Zuordnung: Claude Haiku 5.5 für alles, was
 * automatisch und oft läuft (0,10/0,50 USD je Mio. Token — billiger als jedes
 * Gemini-Flash), Sonnet 5.5 zum Schreiben, Opus 5.5 für Agent, Code und Urteil;
 * fremde Anbieter nur dort, wo sie etwas können, das Claude nicht kann (Video,
 * X-Suche, Websuche mit Belegen).
 */

import { ANBIETER_REG, standardModell } from './ai-models.js'

export const AI_TASKS = {
    lagebericht: {
        id: 'lagebericht',
        name: 'Nachrichten-Lagebericht',
        description: 'Der tägliche Zeitungsbericht aus Beiträgen, Videos und Recherche',
        importance: 'high',
        maxTokens: 3000,
        recommendedModels: ['anthropic/claude-sonnet-5-5', 'anthropic/claude-opus-5-5'],
        requiresToolCalling: false,
        rueckfallFeld: 'radarNewsBerichtProvider/radarNewsBerichtModell',
    },
    lagebericht_update: {
        id: 'lagebericht-update',
        name: 'Lagebericht-Zwischenmeldung',
        description: 'Kurze Zwischenmeldung zum Lagebericht während des Tages',
        importance: 'medium',
        maxTokens: 1500,
        recommendedModels: ['anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
        rueckfallFeld: 'radarNewsBerichtProvider/radarNewsBerichtModell',
    },
    lagebericht_pruefung: {
        id: 'lagebericht-pruefung',
        name: 'Lagebericht-Anweisung prüfen',
        description: 'Prüft eine eigene Anweisung, bevor sie an den Bericht geht. Leer = dasselbe Modell wie der Bericht (bewusst: wer prüft, soll später auch befolgen)',
        importance: 'low',
        maxTokens: 1500,
        recommendedModels: [],
        requiresToolCalling: false,
        rueckfallFeld: 'lagebericht',
    },
    marktradar_lage: {
        id: 'marktradar-lage',
        name: 'Marktradar-Gesamtlage',
        description: 'Einordnung aller Marktradar-Kacheln in einen Gesamtkontext',
        importance: 'high',
        maxTokens: 3000,
        recommendedModels: ['anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
    },
    livetrading_handelslage: {
        id: 'livetrading-handelslage',
        name: 'Live-Trading-Handelslage',
        description: 'Was die nächsten Stunden bringen — Bedingungen statt Prognose; läuft automatisch, solange die Kachel sichtbar ist',
        importance: 'high',
        maxTokens: 3000,
        recommendedModels: ['anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
    },
    chart_analyse: {
        id: 'chart-analyse',
        name: 'Chart-KI-Analyse',
        description: 'Linien, Zonen und Wenn-dann-Bedingungen für einen Chart — von Hand ausgelöst',
        importance: 'high',
        maxTokens: 3000,
        recommendedModels: ['anthropic/claude-opus-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
    },
    coin_radar: {
        id: 'coin-radar',
        name: 'Coin-Radar-Einordnung',
        description: 'Ein Absatz je Rangliste — läuft mehrere hundert Mal am Tag, darum das billigste taugliche Modell',
        importance: 'medium',
        maxTokens: 3000,
        recommendedModels: ['anthropic/claude-haiku-5-5', 'gemini/gemini-3.5-flash-lite'],
        requiresToolCalling: false,
        rueckfallFeld: 'llmRollen.editor (Hype-Radar)',
    },
    trade_analyse: {
        id: 'trade-analyse',
        name: 'Trade-Analyse',
        description: 'Schnelle Erstbewertung eines abgeschlossenen Trades',
        importance: 'medium',
        maxTokens: 800,
        recommendedModels: ['anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
        rueckfallFeld: 'aiBerichtProvider/aiBerichtModell',
    },
    video_summary: {
        id: 'video',
        name: 'Video-Zusammenfassung',
        description: 'YouTube-Videos als Stichpunkte, dazu die Bildprüfung der Chartanalyse — nur Gemini öffnet Video-URLs',
        importance: 'medium',
        maxTokens: 600,
        recommendedModels: ['gemini/gemini-3.5-flash-lite', 'gemini/gemini-3.8-flash'],
        requiresToolCalling: false,
        supportedProviders: ['gemini'],
        rueckfallFeld: 'radarNewsModel',
    },
    x_search: {
        id: 'x-suche',
        name: 'X (Twitter) Suche',
        description: 'Durchsucht X — nur xAI (Grok) kann das',
        importance: 'low',
        maxTokens: 1000,
        recommendedModels: ['xai/grok-4.20-0309-non-reasoning', 'xai/grok-4.7'],
        requiresToolCalling: false,
        supportedProviders: ['xai'],
        rueckfallFeld: 'radarNewsXModell',
    },
    recherche: {
        id: 'recherche',
        name: 'Web-Recherche',
        description: 'Recherche mit Belegen. Perplexity Sonar (Vorgabe, frischer, mit Bildern) oder `deepseek/deepseek-suche` — DeepSeek-Suche + Schreibmodell, rund 4× billiger, Treffer weniger tagesaktuell; die Chartanalyse bleibt bei Perplexity',
        importance: 'medium',
        maxTokens: 2000,
        recommendedModels: ['perplexity/sonar-pro', 'perplexity/sonar', 'deepseek/deepseek-suche'],
        requiresToolCalling: false,
        supportedProviders: ['perplexity', 'deepseek'],
        rueckfallFeld: 'radarNewsRechercheModell',
    },
    recherche_schreiber: {
        id: 'recherche-schreiber',
        name: 'Recherche-Schreiber (DeepSeek-Suche)',
        description: 'Fasst die Treffer der DeepSeek-Suche mit Belegnummern zusammen — nur aktiv, wenn die Recherche über DeepSeek läuft',
        importance: 'low',
        maxTokens: 8000,
        recommendedModels: ['anthropic/claude-haiku-5-5', 'deepseek/deepseek-flash'],
        requiresToolCalling: false,
    },
    agent: {
        id: 'agent',
        name: 'KI-Agent (Tool-Calling Loop)',
        description: 'Autonome Analyse mit Werkzeugen',
        importance: 'high',
        maxTokens: 4000,
        recommendedModels: ['anthropic/claude-opus-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: true,
        // Alles, wofür `ai-agent.js` einen Werkzeug-Pfad hat: Anthropic und
        // Gemini nativ, Ollama per Prompt, der Rest über die OpenAI-Schnittstelle.
        // Perplexity fehlt — Sonar ruft keine fremden Werkzeuge auf.
        supportedProviders: Object.keys(ANBIETER_REG).filter((p) => p !== 'perplexity'),
        rueckfallFeld: 'aiAgentProvider/aiAgentModell',
    },
    mechanik: {
        id: 'mechanik',
        name: 'Markt-Mechanik-Einordnung',
        description: 'Analyse der Marktmechaniken — wen betrifft was, warum',
        importance: 'high',
        maxTokens: 1200,
        recommendedModels: ['anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
    },
    strategie_veto: {
        id: 'strategie-veto',
        name: 'Strategie-Sentiment (Veto-Agent)',
        description: 'Schnelle Sentiment-Prüfung vor einem Strategie-Trade — die Rollen-Einstellung der Instanz hat Vorrang',
        importance: 'medium',
        maxTokens: 500,
        recommendedModels: ['anthropic/claude-haiku-5-5'],
        requiresToolCalling: false,
    },
    regel_baukasten: {
        id: 'regel-baukasten',
        name: 'Regel-Baukasten',
        description: 'Code-nahe Vorschläge für Trading-Regeln',
        importance: 'high',
        maxTokens: 2000,
        recommendedModels: ['anthropic/claude-opus-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
        rueckfallFeld: 'aiStrategieProvider/aiStrategieModell',
    },
    strategie_baukasten: {
        id: 'strategie-baukasten',
        name: 'Strategie-Baukasten',
        description: 'Code-Vorschläge für Strategien — hohe Anforderungen an Qualität',
        importance: 'high',
        maxTokens: 3000,
        recommendedModels: ['anthropic/claude-opus-5-5', 'anthropic/claude-fable-5-1'],
        requiresToolCalling: false,
        rueckfallFeld: 'aiStrategieProvider/aiStrategieModell',
    },
    rangliste: {
        id: 'rangliste',
        name: 'Universum-Rangliste',
        description: 'Vorschläge für das Handelsuniversum — muss zuverlässig sein',
        importance: 'high',
        maxTokens: 1000,
        recommendedModels: ['anthropic/claude-opus-5-5', 'anthropic/claude-sonnet-5-5'],
        requiresToolCalling: false,
    },
}

/** Aufgabe nach ihrer `id` (Schlüssel in `aiTaskProviders`), nicht nach dem Objekt-Schlüssel. */
export function aufgabeNachId(id) {
    return Object.values(AI_TASKS).find((t) => t.id === id) || null
}

/**
 * Die eine Stelle, die eine Zeile der Aufgaben-Tabelle liest.
 *
 * Bis 18.10.2026 lasen nur fünf der fünfzehn Zeilen irgendetwas — die übrigen
 * zehn konnte man ausfüllen, gespeichert wurde es, gewirkt hat es nie. Jetzt
 * fragt jede Funktion zuerst hier und erst dann ihr altes Einzelfeld.
 *
 * Rein, ohne DB: bekommt den Rohwert von `settings.aiTaskProviders`.
 *
 * - Format `anbieter/modell` oder nur `anbieter`; getrennt wird am ERSTEN `/`,
 *   damit `openrouter/anthropic/claude-…` sein Modell behält.
 * - Nur `anbieter` → dessen Standardmodell, NICHT das globale Modell: das
 *   gehört meist einem anderen Haus und ergäbe bei jedem Aufruf einen 404.
 * - Ein unbekannter Anbieter oder einer, der die Aufgabe nicht kann (Video
 *   nur Gemini, X nur xAI …), zählt als leer — dann greift das Einzelfeld,
 *   statt dass ein Lauf mit einer Fehlkonfiguration scheitert.
 *
 * @param {string|object} roh  `settings.aiTaskProviders`
 * @param {string} aufgabenId
 * @returns {{provider: string, model: string}|null}
 */
export function aufgabenWahl(roh, aufgabenId) {
    if (!aufgabenId) return null
    let karte = roh
    if (typeof roh === 'string') {
        try { karte = JSON.parse(roh || '{}') } catch { return null }
    }
    const wert = String(karte?.[aufgabenId] || '').trim()
    if (!wert) return null
    const i = wert.indexOf('/')
    const provider = (i < 0 ? wert : wert.slice(0, i)).trim()
    const model = (i < 0 ? '' : wert.slice(i + 1)).trim()
    if (!ANBIETER_REG[provider]) return null
    const nur = aufgabeNachId(aufgabenId)?.supportedProviders
    if (nur && !nur.includes(provider)) return null
    return { provider, model: model || standardModell(provider) }
}
