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
 *   defaultProvider – Standard, wenn nichts überschrieben
 *   recommendedModels – Empfohlene Modelle für diese Aufgabe (Fallback-Liste)
 *   requiresToolCalling – Braucht das Modell native Tool-Unterstützung?
 *   supportedProviders – Whitelist von Anbietern, die diese Aufgabe können (optional)
 */
export const AI_TASKS = {
    lagebericht: {
        id: 'lagebericht',
        name: 'Nachrichten-Lagebericht',
        description: 'Zusammenfassung von Marktdaten in strukturierter Prosa — die tägliche Übersicht',
        importance: 'high',
        maxTokens: 3000,
        defaultProvider: 'anthropic',
        recommendedModels: ['claude-opus-5', 'claude-sonnet-5', 'gpt-4o'],
        requiresToolCalling: false,
    },
    lagebericht_update: {
        id: 'lagebericht-update',
        name: 'Lagebericht-Aktualisierung',
        description: 'Kurze Aktualisierung des Lageberichts während des Tages',
        importance: 'medium',
        maxTokens: 1500,
        defaultProvider: 'anthropic',
        recommendedModels: ['claude-sonnet-5', 'claude-fable-5'],
        requiresToolCalling: false,
    },
    lagebericht_pruefung: {
        id: 'lagebericht-pruefung',
        name: 'Lagebericht-Prompt-Vorprüfung',
        description: 'Valide eigene Anweisungen, bevor sie an den Reporter gehen',
        importance: 'low',
        maxTokens: 400,
        defaultProvider: 'deepseek',
        recommendedModels: ['deepseek-chat', 'mistral-small'],
        requiresToolCalling: false,
    },
    marktradar_lage: {
        id: 'marktradar-lage',
        name: 'Marktradar-Gesamtlage',
        description: 'Einordnung aller Marktradar-Tiles in einen Gesamtkontext',
        importance: 'high',
        maxTokens: 800,
        defaultProvider: 'anthropic',
        recommendedModels: ['claude-sonnet-5', 'gpt-4o'],
        requiresToolCalling: false,
    },
    trade_analyse: {
        id: 'trade-analyse',
        name: 'Trade-Analyse',
        description: 'Schnelle Erstbewertung eines abgeschlossenen Trades — lokal, keine externen Abfragen',
        importance: 'medium',
        maxTokens: 800,
        defaultProvider: 'deepseek',
        recommendedModels: ['deepseek-chat', 'mistral-small', 'claude-fable-5'],
        requiresToolCalling: false,
        // Faustregel: schnell + billig ist hier wichtiger als perfekt
    },
    video_summary: {
        id: 'video',
        name: 'Video-Zusammenfassung',
        description: 'YouTube-Videos als Bullet-Points — Gemini kann Video-URLs öffnen',
        importance: 'medium',
        maxTokens: 600,
        defaultProvider: 'gemini',
        recommendedModels: ['gemini-3.5-flash', 'gemini-3.6-flash'],
        requiresToolCalling: false,
        supportedProviders: ['gemini'],  // nur Gemini kann Video-URLs
    },
    x_search: {
        id: 'x-suche',
        name: 'X (Twitter) Suche',
        description: 'Durchsuche X/Twitter — nur xAI (Grok) hat dieses Feature',
        importance: 'low',
        maxTokens: 1000,
        defaultProvider: 'xai',
        recommendedModels: ['grok-4.6', 'grok-4.5'],
        requiresToolCalling: false,
        supportedProviders: ['xai'],  // nur xAI
    },
    recherche: {
        id: 'recherche',
        name: 'Web-Recherche (Perplexity)',
        description: 'Recherche mit Zitaten — Perplexity Sonar gibt Quellen an',
        importance: 'medium',
        maxTokens: 2000,
        defaultProvider: 'perplexity',
        recommendedModels: ['sonar-pro', 'sonar'],
        requiresToolCalling: false,
        supportedProviders: ['perplexity'],
    },
    agent: {
        id: 'agent',
        name: 'KI-Agent (Tool-Calling Loop)',
        description: 'Autonome Analyse mit Werkzeugen — braucht native Tool-Calling-Unterstützung',
        importance: 'high',
        maxTokens: 4000,
        defaultProvider: 'anthropic',
        recommendedModels: ['claude-opus-5', 'gpt-4o'],
        requiresToolCalling: true,
        // Whitelist: nur Provider mit native Tool-Unterstützung
        supportedProviders: ['anthropic', 'openai', 'openrouter'],
    },
    mechenik: {
        id: 'mechanik',
        name: 'Markt-Mechanik-Einordnung',
        description: 'Analyse der Marktmechaniken — wen betrifft was, warum',
        importance: 'high',
        maxTokens: 1200,
        defaultProvider: 'anthropic',
        recommendedModels: ['claude-opus-5', 'claude-sonnet-5'],
        requiresToolCalling: false,
    },
    strategie_veto: {
        id: 'strategie-veto',
        name: 'Strategie-Sentiment (Veto-Agent)',
        description: 'Schnelle Sentiment-Analyse für Strategie-Vetos — muss schnell sein',
        importance: 'medium',
        maxTokens: 500,
        defaultProvider: 'deepseek',
        recommendedModels: ['deepseek-chat', 'mistral-small'],
        requiresToolCalling: false,
    },
    regel_baukasten: {
        id: 'regel-baukasten',
        name: 'Regel-Baukasten',
        description: 'Code-Vorschläge für Trading-Regeln — muss Code gut können',
        importance: 'high',
        maxTokens: 2000,
        defaultProvider: 'anthropic',
        recommendedModels: ['claude-opus-5', 'claude-sonnet-5'],
        requiresToolCalling: false,
    },
    strategie_baukasten: {
        id: 'strategie-baukasten',
        name: 'Strategie-Baukasten',
        description: 'Code-Vorschläge für Strategien — hohe Anforderungen an Qualität',
        importance: 'high',
        maxTokens: 3000,
        defaultProvider: 'anthropic',
        recommendedModels: ['claude-opus-5'],
        requiresToolCalling: false,
    },
    rangliste: {
        id: 'rangliste',
        name: 'Universum-Rangliste (Hype-Radar)',
        description: 'Vorschläge für Trading-Universum — muss zuverlässig sein',
        importance: 'high',
        maxTokens: 1000,
        defaultProvider: 'deepseek',
        recommendedModels: ['deepseek-chat'],
        requiresToolCalling: false,
    },
    bild: {
        id: 'bild',
        name: 'Bild-Generierung',
        description: 'FLUX-Bilder für Share Cards — über Flux API',
        importance: 'low',
        maxTokens: 0,
        defaultProvider: 'custom',
        recommendedModels: [],
        requiresToolCalling: false,
    },
}

/**
 * Alle Task-IDs als Array (für Dropdowns, Validierung).
 */
export const ALLE_TASK_IDS = Object.keys(AI_TASKS)

/**
 * Task nach ID holen, mit Fallback.
 */
export function holeAufgabe(taskId) {
    return AI_TASKS[taskId] || AI_TASKS[Object.keys(AI_TASKS)[0]] || {}
}

/**
 * Nur Tasks mit bestimmter Importance.
 */
export function filterAufgabenNachWichtigkeit(importance) {
    return Object.values(AI_TASKS).filter((t) => t.importance === importance)
}

/**
 * Tasks filtern, die Tool-Calling brauchen.
 */
export function aufgabenMitToolCalling() {
    return Object.values(AI_TASKS).filter((t) => t.requiresToolCalling)
}

/**
 * Tasks, für die nur bestimmte Provider infrage kommen.
 */
export function aufgabenFuerProvider(provider) {
    return Object.values(AI_TASKS).filter((t) => {
        if (!t.supportedProviders) return true  // keine Einschränkung
        return t.supportedProviders.includes(provider)
    })
}

/**
 * Empfohlene Modelle für eine Aufgabe — filtert nach verfügbarem Provider.
 * Wenn der aktuelle Provider das Modell nicht hat, nimmt der fallback.
 */
export function empfohleneModelleForAufgabe(taskId, allAvailableModels = {}) {
    const task = AI_TASKS[taskId]
    if (!task) return []
    
    return task.recommendedModels
        .map((model) => ({
            model,
            verfuegbar: Object.values(allAvailableModels).flat().includes(model),
        }))
        .filter((m) => m.verfuegbar)
        .map((m) => m.model)
}
