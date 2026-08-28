/**
 * Welche KI-Funktion das Haus kennt — und welcher Anbieter sie gerade bedient.
 *
 * Die Liste stand in `ai-uebersicht.js`, wo sie für die Übersichtsseite
 * gebraucht wird. Inzwischen braucht sie auch `ollama-api.js`: Der
 * Guthaben-Endpunkt muss sagen können, WEN ein leeres Guthaben trifft — sonst
 * warnt die Nachrichten-Seite vor einem Anbieter, den die Nachrichten nie
 * anfassen (live beobachtet: Anthropic stand dort tagelang im Warnbanner,
 * während es in Wahrheit den Strategie-Baukasten betraf).
 *
 * `ai-uebersicht.js` importiert aber seinerseits aus `ollama-api.js`, ein
 * Import zurück wäre also ein Modul-Kreis. Deshalb liegt die Liste hier: ein
 * Blatt ohne eigene Importe, dadurch auch ohne Datenbank selbsttestbar —
 * dasselbe Muster wie `news-profil-felder.js`.
 */

/**
 * Die KI-Funktionen des Hauses.
 *
 * `bereich` ist der Unter-Reiter der Einstellungen, in dem die Funktion
 * eingestellt wird — die Oberfläche macht daraus den Sprung dorthin. `rolle`
 * benennt den `waehleAnbieter`-Bereich; leer heisst „nimmt den globalen
 * Anbieter". `funktionen` sind die Schlüssel, unter denen der Verbrauch
 * gebucht wird (mehrere, wo ein Vorgang aus Teilschritten besteht).
 */
export const KI_FUNKTIONEN = [
    {
        id: 'bericht', titelKey: 'kiUebersicht.fn.bericht', bereich: 'berichte',
        rolle: 'Bericht', funktionen: ['bericht', 'coach-chat'],
    },
    {
        id: 'tradeAnalyse', titelKey: 'kiUebersicht.fn.tradeAnalyse', bereich: 'berichte',
        rolle: 'Bericht', funktionen: ['trade-analyse', 'trade-chat'],
    },
    {
        id: 'agent', titelKey: 'kiUebersicht.fn.agent', bereich: 'agent',
        rolle: 'Agent', funktionen: ['agent'],
    },
    {
        id: 'lagebericht', titelKey: 'kiUebersicht.fn.lagebericht', bereich: 'nachrichten',
        // Die Nachrichten wählen ihren Anbieter über eigene Felder statt über
        // `waehleAnbieter` — deshalb hier ausdrücklich benannt.
        felder: { provider: 'radarNewsBerichtProvider', modell: 'radarNewsBerichtModell' },
        // Die Aktualisierung ist derselbe Vorgang mit anderem Zuschnitt — sie
        // gehört in dieselbe Kostenzeile, sonst sucht man den Nachmittag im
        // Verbrauch vergeblich.
        funktionen: ['lagebericht', 'lagebericht-update', 'lagebericht-pruefung'],
    },
    {
        id: 'recherche', titelKey: 'kiUebersicht.fn.recherche', bereich: 'nachrichten',
        fest: { provider: 'perplexity', feld: 'radarNewsRechercheModell', standard: 'sonar' },
        funktionen: ['recherche'],
    },
    {
        id: 'xSuche', titelKey: 'kiUebersicht.fn.xSuche', bereich: 'nachrichten',
        fest: { provider: 'xai', feld: 'radarNewsXModell', standard: 'grok-4.6' },
        funktionen: ['x-suche'],
    },
    {
        id: 'video', titelKey: 'kiUebersicht.fn.video', bereich: 'nachrichten',
        // Nur Gemini öffnet eine YouTube-Adresse selbst. Deckt auch die
        // Chartbild-Prüfung ab, die denselben Anbieter benutzt.
        fest: { provider: 'gemini', feld: 'radarNewsModel', standard: 'gemini-3.5-flash-lite' },
        funktionen: ['video'],
    },
    {
        id: 'strategie', titelKey: 'kiUebersicht.fn.strategie', bereich: 'strategie',
        rolle: 'Strategie', funktionen: ['strategie-veto', 'regel-baukasten', 'strategie-baukasten'],
    },
    {
        id: 'radar', titelKey: 'kiUebersicht.fn.radar', bereich: 'allgemein',
        rolle: '', funktionen: ['lage', 'mechanik', 'rangliste'],
    },
    {
        id: 'bild', titelKey: 'kiUebersicht.fn.bild', bereich: 'bilder',
        fest: { feldProvider: 'shareCardProvider', feld: 'fluxModel', standard: 'flux-2-pro' },
        funktionen: ['bild'],
    },
]

/**
 * Welcher Anbieter bedient diese Funktion gerade?
 *
 * Die drei Fälle der Registry, nur für den Anbieter — das Modell kommt
 * anderswo dazu. Entscheidend ist der RÜCKFALL: Ein leeres eigenes Feld heisst
 * nicht „keiner", sondern „der globale Anbieter" (`llm.js:ladeLlmConfig` und
 * `ollama-api.js:waehleAnbieter` machen es beide so). Genau daran läge eine
 * handgeschriebene Liste falsch, sobald jemand das Feld leert.
 *
 * Rein und ohne Datenbank, damit der Selbsttest sie prüfen kann.
 */
export function anbieterVon(eintrag, settings) {
    const s = settings || {}
    const global = String(s.aiProvider || '').trim() || 'ollama'
    if (eintrag.fest) {
        return eintrag.fest.provider || String(s[eintrag.fest.feldProvider] || '').trim() || ''
    }
    if (eintrag.felder) {
        return String(s[eintrag.felder.provider] || '').trim() || global
    }
    return (eintrag.rolle ? String(s[`ai${eintrag.rolle}Provider`] || '').trim() : '') || global
}

/**
 * Anbieter → in welchen Einstellungsbereichen er gerade arbeitet.
 *
 * Damit kann eine Guthaben-Warnung sagen, was sie lahmlegt, statt nur einen
 * Namen zu nennen. „Anthropic — betrifft: Strategie" ist die Auskunft, für die
 * es vorher eine Datenbankabfrage brauchte.
 *
 * @returns {Map<string, Set<string>>}
 */
export function anbieterBereiche(settings) {
    const karte = new Map()
    for (const f of KI_FUNKTIONEN) {
        const id = anbieterVon(f, settings)
        if (!id || !f.bereich) continue
        if (!karte.has(id)) karte.set(id, new Set())
        karte.get(id).add(f.bereich)
    }
    return karte
}

/** Die Anbieter, die an einem Nachrichtenlauf beteiligt sind. */
export function nachrichtenAnbieter(settings) {
    const treffer = new Set()
    for (const f of KI_FUNKTIONEN) {
        if (f.bereich !== 'nachrichten') continue
        const id = anbieterVon(f, settings)
        if (id) treffer.add(id)
    }
    return treffer
}
