/**
 * KI-Übersicht: was läuft, wo, wann — und was es kostet.
 *
 * Die KI-Einstellungen sind über sechs Reiter verteilt, und was davon von
 * selbst losläuft, stand nirgends zusammen. Wer wissen wollte, ob der
 * Lagebericht heute Nacht lief und was er gekostet hat, musste drei Seiten
 * öffnen und eine davon gab es nicht.
 *
 * Diese Datei beantwortet vier Fragen an einer Stelle:
 *   1. Welche KI-Funktionen gibt es und welches Modell bedient sie gerade?
 *   2. Was läuft automatisch, in welchem Takt, und wann lief es zuletzt?
 *   3. Was wurde verbraucht — heute, diesen Monat, im Verlauf?
 *   4. Läuft gerade etwas?
 *
 * Gelesen wird nur. Nichts hier stösst einen Lauf an oder kostet Geld.
 */

import { getKnex } from './database.js'
import { waehleAnbieter } from './ollama-api.js'
import { standardModell } from './ai-models.js'
import { istAgentAktiv } from './ai-agent.js'
import { engineStatus } from './strategy-engine.js'
import { leseUpdateStunden, leseRhythmus } from './marktradar-news.js'
import { logWarn } from './logger.js'

const TAG_MS = 24 * 60 * 60 * 1000

/**
 * Die KI-Funktionen des Hauses.
 *
 * `bereich` ist der Unter-Reiter der Einstellungen, in dem die Funktion
 * eingestellt wird — die Oberfläche macht daraus den Sprung dorthin. `rolle`
 * benennt den `waehleAnbieter`-Bereich; leer heisst „nimmt den globalen
 * Anbieter". `funktionen` sind die Schlüssel, unter denen der Verbrauch
 * gebucht wird (mehrere, wo ein Vorgang aus Teilschritten besteht).
 */
const KI_FUNKTIONEN = [
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
        // Nur Gemini öffnet eine YouTube-Adresse selbst.
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
 * Was von selbst läuft.
 *
 * `anspruch` ist der Schlüssel in `radar_fetch_state` — daraus kommen letzter
 * Lauf, haltende Instanz und letzter Fehler. `kostet` trennt die Takte, die
 * Geld ausgeben, von denen, die nur Daten holen: für die Frage „warum wird
 * abgerechnet" zählen nur die ersten.
 */
const AUTOMATIKEN = [
    {
        id: 'newsAbruf', titelKey: 'kiUebersicht.auto.newsAbruf',
        anspruch: 'news_abruf', taktKey: 'kiUebersicht.takt.stunde', kostet: false,
        schalter: 'radarNewsAuto', bereich: 'nachrichten',
    },
    {
        id: 'lagebericht', titelKey: 'kiUebersicht.auto.lagebericht',
        anspruch: 'news_lagebericht', taktKey: 'kiUebersicht.takt.taeglich', kostet: true,
        schalter: 'radarNewsAuto', bereich: 'nachrichten',
        zeitFelder: { stunde: 'radarNewsStunde', rhythmus: 'radarNewsRhythmus', wochentag: 'radarNewsWochentag' },
    },
    /*
     * Die beiden Aktualisierungs-Plätze des Lageberichts.
     *
     * Sie stehen einzeln da, weil sie einzeln laufen: eigener Tages-Anspruch,
     * eigene Stunde, eigener Fehlervermerk. Ihr „an" hängt nicht an einer
     * 0/1-Spalte, sondern an einer Anzahl — deshalb `aktiv` statt `schalter`.
     */
    ...[1, 2].map((platz) => ({
        id: `lageberichtUpdate${platz}`, titelKey: `kiUebersicht.auto.lageberichtUpdate${platz}`,
        anspruch: `news_lagebericht_update${platz}`, taktKey: 'kiUebersicht.takt.taeglich',
        kostet: true, bereich: 'nachrichten',
        aktiv: (s) => Number(s?.radarNewsAuto ?? 1) === 1
            && leseRhythmus(s?.radarNewsRhythmus) !== 'manuell'
            && Number(s?.radarNewsUpdates || 0) >= platz,
        updatePlatz: platz,
    })),
    {
        id: 'xSuche', titelKey: 'kiUebersicht.auto.xSuche',
        anspruch: 'news_x_suche', taktKey: 'kiUebersicht.takt.zweiStunden', kostet: true,
        schalter: 'radarNewsAuto', bereich: 'nachrichten',
    },
    {
        id: 'strategie', titelKey: 'kiUebersicht.auto.strategie',
        anspruch: 'strategy_engine', taktKey: 'kiUebersicht.takt.sekunden15', kostet: true,
        bereich: 'strategie',
    },
    {
        id: 'schnappschuss', titelKey: 'kiUebersicht.auto.schnappschuss',
        anspruch: 'snap_global', taktKey: 'kiUebersicht.takt.zwoelfStunden', kostet: false,
    },
    {
        id: 'kalender', titelKey: 'kiUebersicht.auto.kalender',
        anspruch: 'kalender_ff', taktKey: 'kiUebersicht.takt.sechsStunden', kostet: false,
    },
    {
        id: 'newsAufbewahrung', titelKey: 'kiUebersicht.auto.newsAufbewahrung',
        anspruch: 'news_retention', taktKey: 'kiUebersicht.takt.taeglich', kostet: false,
    },
    {
        id: 'aufzeichner', titelKey: 'kiUebersicht.auto.aufzeichner',
        anspruch: 'live_recorder', taktKey: 'kiUebersicht.takt.laufend', kostet: false,
        schalter: 'liveRecordEnabled', bereich: null,
    },
]

/**
 * Der Zeitplan einer Automatik, so wie die Oberfläche ihn schreibt.
 *
 * Zwei Quellen: die benannten Einstellungsfelder (Bericht) oder — für die
 * Aktualisierungen — die Stundenliste. Ein Platz ohne eingestellte Stunde
 * bekommt `null` statt einer erfundenen 0, sonst stünde „täglich ab 00 Uhr"
 * an einer Zeile, die gar nicht läuft.
 */
function zeitplanVon(a, s) {
    if (a.updatePlatz) {
        const stunde = leseUpdateStunden(s?.radarNewsUpdateStunden, 2)[a.updatePlatz - 1]
        return Number.isFinite(stunde) ? { stunde, rhythmus: 'taeglich', wochentag: 1 } : null
    }
    if (!a.zeitFelder) return null
    return {
        stunde: Number(s?.[a.zeitFelder.stunde] ?? 12),
        rhythmus: String(s?.[a.zeitFelder.rhythmus] || 'taeglich'),
        wochentag: Number(s?.[a.zeitFelder.wochentag] ?? 1),
    }
}

/** Anbieter und Modell einer Funktion auflösen — inklusive „folgt dem globalen". */
function loeseAnbieter(eintrag, s) {
    const global = { provider: s?.aiProvider || 'ollama', model: s?.aiModel || '' }

    if (eintrag.fest) {
        const provider = eintrag.fest.provider || String(s?.[eintrag.fest.feldProvider] || '') || ''
        const modell = String(s?.[eintrag.fest.feld] || '') || eintrag.fest.standard
        return { provider, modell, folgtGlobal: false }
    }

    if (eintrag.felder) {
        const eigen = String(s?.[eintrag.felder.provider] || '').trim()
        if (!eigen) return { ...global, modell: global.model, folgtGlobal: true }
        return {
            provider: eigen,
            modell: String(s?.[eintrag.felder.modell] || '').trim() || standardModell(eigen),
            folgtGlobal: false,
        }
    }

    const gewaehlt = waehleAnbieter(s || {}, eintrag.rolle || '')
    const eigen = eintrag.rolle ? String(s?.[`ai${eintrag.rolle}Provider`] || '').trim() : ''
    return { provider: gewaehlt.provider, modell: gewaehlt.model, folgtGlobal: !eigen }
}

/**
 * Verbrauch je Funktionsschlüssel in einem Zeitraum.
 * @returns {Map<string, {kostenUsd:number, totalTokens:number, laeufe:number, letzter:number}>}
 */
async function verbrauchKarte(knex, vonMs) {
    const karte = new Map()
    try {
        const zeilen = await knex('ai_usage')
            .select('funktion')
            .sum({ kostenUsd: 'kostenUsd' })
            .sum({ totalTokens: 'totalTokens' })
            .count({ laeufe: 'id' })
            .max({ letzter: 'erstelltAm' })
            .where('erstelltAm', '>=', vonMs)
            .groupBy('funktion')
        for (const z of zeilen) {
            karte.set(z.funktion, {
                kostenUsd: Number(z.kostenUsd) || 0,
                totalTokens: Number(z.totalTokens) || 0,
                laeufe: Number(z.laeufe) || 0,
                letzter: Number(z.letzter) || 0,
            })
        }
    } catch (e) {
        // Die Tabelle kann fehlen, wenn ein älterer Codestand die Datenbank
        // angelegt hat. Dann steht die Übersicht eben ohne Zahlen da.
        logWarn('ai-uebersicht', `Verbrauch nicht lesbar: ${e.message}`)
    }
    return karte
}

/** Tagesweiser Verlauf für das Balkendiagramm. */
async function verlauf(knex, tage) {
    const von = Date.now() - tage * TAG_MS
    try {
        const zeilen = await knex('ai_usage')
            .select('erstelltAm', 'funktion', 'kostenUsd')
            .where('erstelltAm', '>=', von)
        /*
         * Die Tagesgrenze wird hier in JavaScript gezogen, nicht in SQL.
         * SQLite und PostgreSQL schreiben Datumsfunktionen verschieden, und
         * beide würden nach UTC gruppieren — der Nutzer denkt aber in seinen
         * Tagen. Die Datenmenge ist klein genug (ein Datensatz je KI-Aufruf).
         */
        const proTag = new Map()
        for (const z of zeilen) {
            const tag = new Date(Number(z.erstelltAm)).toISOString().slice(0, 10)
            if (!proTag.has(tag)) proTag.set(tag, { tag, kostenUsd: 0, jeFunktion: {} })
            const e = proTag.get(tag)
            const k = Number(z.kostenUsd) || 0
            e.kostenUsd += k
            e.jeFunktion[z.funktion] = (e.jeFunktion[z.funktion] || 0) + k
        }
        return [...proTag.values()].sort((a, b) => a.tag.localeCompare(b.tag))
    } catch {
        return []
    }
}

/** Beginn des heutigen Tages in der eingestellten Zeitzone, als ms. */
function tagesBeginn(zeitzone) {
    try {
        const jetzt = new Date()
        const lokal = new Date(jetzt.toLocaleString('en-US', { timeZone: zeitzone || 'UTC' }))
        const versatz = jetzt.getTime() - lokal.getTime()
        lokal.setHours(0, 0, 0, 0)
        return lokal.getTime() + versatz
    } catch {
        // Unbekannte Zeitzone: lieber der lokale Tag des Servers als ein Absturz
        const d = new Date()
        d.setHours(0, 0, 0, 0)
        return d.getTime()
    }
}

export function setupAiUebersichtRoutes(app) {
    app.get('/api/ai/uebersicht', async (req, res) => {
        try {
            const knex = getKnex()
            const s = await knex('settings').where('id', 1).first() || {}

            const heuteVon = tagesBeginn(s.timeZone)
            const monatVon = (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime() })()

            const [heute, monat, dreissig, zustaende] = await Promise.all([
                verbrauchKarte(knex, heuteVon),
                verbrauchKarte(knex, monatVon),
                verbrauchKarte(knex, Date.now() - 30 * TAG_MS),
                knex('radar_fetch_state').select('*').catch(() => []),
            ])

            const standNach = new Map(zustaende.map((z) => [z.key, z]))
            const summe = (karte, schluessel) => schluessel.reduce((acc, k) => {
                const e = karte.get(k)
                if (!e) return acc
                return {
                    kostenUsd: acc.kostenUsd + e.kostenUsd,
                    totalTokens: acc.totalTokens + e.totalTokens,
                    laeufe: acc.laeufe + e.laeufe,
                    letzter: Math.max(acc.letzter, e.letzter),
                }
            }, { kostenUsd: 0, totalTokens: 0, laeufe: 0, letzter: 0 })

            const funktionen = KI_FUNKTIONEN.map((f) => ({
                id: f.id,
                titelKey: f.titelKey,
                bereich: f.bereich,
                ...loeseAnbieter(f, s),
                verbrauch30: summe(dreissig, f.funktionen),
            }))

            /*
             * Sammelzeile für alles, was die Registry oben nicht kennt.
             *
             * Ohne sie zählten die Zeilen nicht auf die Summe darüber: am
             * 19.08.2026 buchten `coin-radar` und `hype-bericht` zusammen
             * 0,169 der 0,341 USD des Tages — die Hälfte, sichtbar nur in der
             * Gesamtzahl. Eine Sammelzeile statt zweier neuer Einträge, weil
             * der nächste neue Verbraucher sonst wieder durchs Raster fällt:
             * hier taucht er von selbst auf, benannt mit seinem Schlüssel.
             */
            const bekannt = new Set(KI_FUNKTIONEN.flatMap((f) => f.funktionen))
            const uebrig = [...dreissig.keys()].filter((k) => !bekannt.has(k))
            if (uebrig.length) {
                funktionen.push({
                    id: 'uebrige',
                    titelKey: 'kiUebersicht.fn.uebrige',
                    bereich: null,
                    schluessel: uebrig.sort(),
                    provider: '',
                    modell: '',
                    folgtGlobal: false,
                    verbrauch30: summe(dreissig, uebrig),
                })
            }

            let engine = null
            try { engine = engineStatus() } catch { /* Engine nicht geladen */ }

            const automatiken = AUTOMATIKEN.map((a) => {
                const z = standNach.get(a.anspruch)
                // Ein Schalter, den es nicht gibt, gilt als eingeschaltet —
                // sonst stünde ein Takt ohne eigenen Schalter fälschlich als aus.
                const an = a.aktiv
                    ? a.aktiv(s)
                    : (a.schalter === undefined ? true : Number(s?.[a.schalter] ?? 1) === 1)
                return {
                    id: a.id,
                    titelKey: a.titelKey,
                    taktKey: a.taktKey,
                    kostet: a.kostet,
                    bereich: a.bereich ?? null,
                    an,
                    letzterLauf: Number(z?.fetchedAt) || 0,
                    haelt: z?.claimedBy || '',
                    fehler: z?.lastError || '',
                    zeitplan: zeitplanVon(a, s),
                }
            })

            const gesamt = (karte) => [...karte.values()].reduce((a, e) => ({
                kostenUsd: a.kostenUsd + e.kostenUsd,
                totalTokens: a.totalTokens + e.totalTokens,
                laeufe: a.laeufe + e.laeufe,
            }), { kostenUsd: 0, totalTokens: 0, laeufe: 0 })

            res.json({
                funktionen,
                automatiken,
                verbrauch: {
                    heute: gesamt(heute),
                    monat: gesamt(monat),
                    dreissigTage: gesamt(dreissig),
                    jeFunktion: [...dreissig.entries()].map(([funktion, w]) => ({ funktion, ...w })),
                    verlauf: await verlauf(knex, 30),
                },
                laeuft: {
                    agent: istAgentAktiv(),
                    engine: engine ? { ...engine, aktiveLaeufe: engine.aktiveLaeufe?.length || 0 } : null,
                },
                waehrung: {
                    code: s.waehrungCode || 'CHF',
                    faktor: Number(s.waehrungFaktor) > 0 ? Number(s.waehrungFaktor) : 0,
                },
            })
        } catch (e) {
            logWarn('ai-uebersicht', `Übersicht fehlgeschlagen: ${e.message}`)
            res.status(500).json({ error: 'Übersicht konnte nicht geladen werden' })
        }
    })
}
