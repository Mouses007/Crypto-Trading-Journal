/**
 * Was die Modelle kosten — die einzige Preisquelle des Hauses.
 *
 * Stand vorher in `llm.js`. Herausgelöst aus zwei Gründen:
 *
 * 1. Import-Zyklus. Die Verbrauchserfassung (`ai-usage.js`) muss rechnen können,
 *    und `llm.js` möchte seinerseits Verbrauch verbuchen. Beide über die Preise
 *    zu verbinden hiesse, sie im Kreis zu verbinden. Preise sind reine Daten und
 *    hängen von nichts ab — hier unten haben sie keinen Kreis mehr.
 *
 * 2. Es gab zwei Preislisten. Neben dieser lebte eine zweite im Frontend
 *    (`MODEL_PRICES` in `KiAgent.vue`), die für DeepSeek und Grok andere Zahlen
 *    nannte — zwei Antworten auf dieselbe Frage, je nachdem, wo man hinsah. Das
 *    Frontend holt die Preise jetzt von hier.
 *
 * Die Zahlen sind Listenpreise, keine Abrechnung: sie dienen der Einordnung
 * („kostet mich der Lauf Cent oder Franken"), nicht der Buchhaltung gegenüber
 * dem Anbieter.
 */

/** Preise in USD je Million Token (Eingabe, Ausgabe). */
export const PREISE = {
    // Claude 5.5 (Stand 18.10.2026, platform.claude.com) — längere Namen
    // zuerst, sonst fängt `claude-opus` die 5.5 zum alten Preis ein.
    // Haiku 5.5: 0,10/0,50 bis 100k Prompt-Token, darüber 0,50/2,50 — die
    // Journal-Aufrufe bleiben weit darunter.
    'claude-opus-5-5': [4, 20],
    'claude-sonnet-5': [2, 10],
    'claude-haiku-5-5': [0.1, 0.5],
    'claude-fable': [10, 50],
    'claude-opus': [5, 25],
    'claude-sonnet': [3, 15],
    'claude-haiku': [1, 5],
    'gpt-6.1-sol': [2, 10],
    'gpt-6-astra': [10, 50],
    'gpt-6-sol': [2, 10],
    'gpt-6-luna': [0.1, 0.5],
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
    // Einführungspreis bis 30.11.2026, danach 4/20.
    'gemini-4-argon': [2, 10],
    'gemini-3.8-flash': [0.75, 3.75],
    'gemini-3.7-flash': [0.75, 3.75],
    'gemini-3.6-flash': [0.75, 3.75],
    'gemini-3.5-flash': [1.5, 9],
    'gemini-3-flash': [0.5, 3],
    'gemini-2.5-pro': [1.25, 10],
    'gemini-2.5-flash': [0.3, 2.5],
    'mistral-medium': [1.5, 7.5],   // medium-2604 = Medium 3.5
    'mistral-large': [0.5, 1.5],
    'mistral-small': [0.15, 0.6],
    // Längere Namen zuerst (Treffer über `includes`). Stand 17.08.2026 laut
    // docs.x.ai/developers/pricing; vorher stand hier pauschal `grok-4: [4,12]`
    // und rechnete damit rund das Doppelte des tatsächlichen Preises.
    'grok-4.20': [1.25, 2.5],
    'grok-4.7': [2, 6],
    'grok-4.6': [2, 6],
    'grok-4.5': [2, 6],
    'grok-4.3': [1.25, 2.5],
    'grok-build': [1, 2],
    'grok-4': [2, 6],
    // Längerer Name zuerst, sonst fängt `sonar` auch `sonar-pro` ein.
    'sonar-deep-research': [2, 8],
    'sonar-reasoning-pro': [2, 8],
    'sonar-pro': [3, 15],
    'sonar': [1, 1],
    'qwen3.8-max': [2, 6],
    'qwen3.8-flash': [0.15, 0.47],
    'qwen3.7-max': [2.5, 7.5],          // Alibaba nennt keinen öffentlichen Listenpreis
    'qwen3.7-plus': [0.4, 1.6],       // — Schätzwerte, nur für die Budget-Anzeige
    'qwen3.6-flash': [0.15, 0.6],
    // DeepSeek rechnet zur Hauptzeit das Doppelte — hier der Hauptzeitpreis,
    // damit die Anzeige eher zu hoch als zu niedrig liegt.
    'deepseek-v4-flash': [0.3, 1.2],
    'deepseek-v4-pro': [1.32, 3.96],
    'deepseek-flash': [0.3, 1.2],
    'deepseek-chat': [0.27, 1.1],
    'deepseek-reasoner': [0.55, 2.19],
    // Kimi, GLM und MiniMax — Listenpreise Stand August 2026. Ohne Eintrag
    // würde ihr Verbrauch mit 0 verbucht, und die Übersicht zeigte einen
    // Anbieter, der angeblich nichts kostet.
    'kimi-k3': [3, 15],
    'kimi-k2.7': [0.95, 4],
    'kimi-k2.6': [0.95, 4],
    'glm-5.3': [1.4, 4.4],
    'glm-5.2': [0.6, 2.2],
    'glm-5.1': [0.6, 2],
    // MiniMax schreibt die Kennung gross (`MiniMax-M3`); Treffer über
    // `includes` ist case-sensitiv, darum beide Schreibweisen. Nicht live geprüft.
    'MiniMax-M3': [0.3, 1.2],
    'minimax-m3': [0.3, 1.2],
    'minimax-m2.7': [1, 3],

    // OpenRouter: alle Modelle sind Proxy-Aufrufe, Preise sind gleich wie
    // bei direktem Anbieter. Format: 'provider/model'.
    // Längere Namen ZUERST wegen `includes`-Matching:
    'anthropic/claude-opus-5.5': [4, 20],
    'anthropic/claude-sonnet-5.5': [2, 10],
    'anthropic/claude-haiku-5.5': [0.1, 0.5],
    'anthropic/claude-opus-5': [5, 25],
    'anthropic/claude-sonnet-5': [2, 10],
    'anthropic/claude-fable-5': [10, 50],
    'anthropic/claude-haiku': [1, 5],
    'openai/gpt-4o-mini': [0.15, 0.6],
    'openai/gpt-4o': [2.5, 10],
    'openai/gpt-4-turbo': [3, 12],
    'openai/gpt-5': [1.25, 10],
    'meta-llama/llama-3.1-405b': [0.54, 2.16],
    'meta-llama/llama-3.1-70b': [0.1, 0.4],
    'meta-llama/llama-3.1-8b': [0.05, 0.15],
    'meta-llama/llama-3.2-90b-vision': [0.3, 0.6],
    'deepseek/deepseek-chat': [0.27, 1.1],
    'moonshotai/kimi-k2.5': [0.45, 2.25],
    'mistral/mistral-large': [0.5, 1.5],
    'mistral/mistral-small': [0.15, 0.6],
    'xai/grok-4.6': [2, 6],
    'xai/grok-4.5': [2, 6],
    'google/gemini-4-argon': [2, 10],
    'google/gemini-3.5-flash': [1.5, 9],
    'perplexity/sonar-pro': [3, 15],
    'perplexity/sonar': [1, 1],
}

/**
 * Bilderzeugung: Preis je Bild in USD.
 *
 * Bilder haben keine Token — sie kosten pro Stück. Die Zahlen sind Listenpreise
 * für ein Bild in Standardgrösse und dienen wie die Tabelle oben nur der
 * Einordnung; wer es genau braucht, sieht in der Abrechnung des Anbieters nach.
 * Treffer über `includes`, damit datierte Modellnamen mitgefangen werden.
 */
export const BILD_PREISE = {
    'flux-2-pro': 0.04,
    'flux-2': 0.03,
    'flux': 0.03,
    // Google-Listenpreise je Bild in 1K-Auflösung, Stand 18.10.2026.
    'gemini-3-pro-image': 0.134,
    'gemini-3.1-flash-image': 0.067,
    'gemini-nano-banana': 0.034,
    'gemini-2.5-flash-image': 0.039,
    'gemini': 0.039,
}

/** Preis eines erzeugten Bildes. Unbekannte Modelle kosten 0. */
export function schaetzeBildKosten(model) {
    const treffer = Object.keys(BILD_PREISE).find((k) => String(model || '').includes(k))
    return treffer ? BILD_PREISE[treffer] : 0
}

/**
 * Grobe Kosten eines Aufrufs. Unbekannte Modelle (z. B. Ollama) kosten 0.
 *
 * Die 0 ist bewusst keine Fehlermeldung: ein lokal gerechnetes Modell kostet
 * tatsächlich nichts, und ein unbekannter Name soll die Anzeige nicht mit einer
 * erfundenen Zahl füllen.
 */
export function schaetzeKosten(model, promptTokens, completionTokens) {
    const treffer = Object.keys(PREISE).find((k) => String(model || '').includes(k))
    if (!treffer) return 0
    const [ein, aus] = PREISE[treffer]
    return (promptTokens / 1e6) * ein + (completionTokens / 1e6) * aus
}
