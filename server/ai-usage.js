/**
 * KI-Verbrauch mitschreiben — eine Zeile je Aufruf.
 *
 * Warum es das braucht: Token und Kosten lagen über acht Tabellen verstreut, in
 * drei Namensfassungen, und nur sechs der siebzehn KI-Verbraucher schrieben
 * überhaupt Kosten mit. Alles, was nicht über `callLLMJson` lief — der Coach,
 * der Berichte-Chat, die Trade-Analyse, der Agent, die Bilder —, kannte nur
 * Token. „Was kostet mich die KI diesen Monat" war damit nicht bloss mühsam,
 * sondern unbeantwortbar.
 *
 * Diese Datei ist die Buchhaltung daneben, nicht der Ersatz der bestehenden
 * Spalten: ein Bericht kennt weiterhin seine eigenen Token. Hier steht, was
 * insgesamt lief.
 *
 * GRUNDREGEL: Buchhaltung darf niemals den Betrieb anhalten. Jeder Fehler wird
 * geschluckt und geloggt. Wer einen Bericht erzeugt hat, soll ihn behalten,
 * auch wenn die Verbrauchszeile daneben nicht geschrieben werden konnte.
 */

import { getKnex } from './database.js'
import { schaetzeKosten } from './llm.js'
import { logWarn } from './logger.js'

/**
 * Bekannte Vorgänge. Keine Pflichtliste — `funktion` ist eine freie
 * Zeichenkette, damit ein neuer Verbraucher schreiben kann, ohne dass vorher
 * ein Schema wächst. Die Sammlung hier hält die Schreibweisen zusammen, weil
 * sonst „lagebericht" und „Lagebericht" als zwei Posten in der Auswertung
 * stünden.
 */
export const FUNKTIONEN = {
    BERICHT: 'bericht',                    // KI-Coach: Auswertungsbericht
    COACH_CHAT: 'coach-chat',              // Rückfragen zu einem Bericht
    TRADE_ANALYSE: 'trade-analyse',        // Erstbewertung eines Trades
    TRADE_CHAT: 'trade-chat',              // Rückfragen zu einem Trade
    AGENT: 'agent',                        // KI-Agent mit Werkzeugen
    LAGEBERICHT: 'lagebericht',            // Nachrichten-Zeitungsbericht
    VIDEO: 'video',                        // Gemini liest ein YouTube-Video
    X_SUCHE: 'x-suche',                    // Grok durchsucht X
    RECHERCHE: 'recherche',                // Perplexity Sonar
    LAGE: 'lage',                          // Marktradar-Gesamtlage
    MECHANIK: 'mechanik',                  // Marktmechanik-Einordnung
    STRATEGIE_VETO: 'strategie-veto',      // Sentiment-/Portfolio-Agent
    REGEL_BAUKASTEN: 'regel-baukasten',
    STRATEGIE_BAUKASTEN: 'strategie-baukasten',
    RANGLISTE: 'rangliste',                // Universum-Vorschlag
    BILD: 'bild',                          // FLUX / Gemini-Bild
}

/**
 * Die fertige Zeile bauen — der rechnende Kern, ohne Datenbank.
 *
 * Getrennt vom Schreiben, damit die Rechnung prüfbar ist: welcher Preis gilt,
 * was passiert bei fehlenden Feldern, wie wird die Tokensumme gebildet. Ein
 * Selbsttest kann das durchspielen, ohne eine Datenbank hochzufahren.
 *
 * @returns {object|null} Zeile für `ai_usage`, oder null wenn unbrauchbar
 */
export function baueVerbrauchZeile({
    funktion,
    ausloeser = 'auto',
    provider = '',
    modell = '',
    usage = null,
    kostenUsd = null,
    bezug = null,
    jetzt = Date.now(),
} = {}) {
    if (!funktion) return null

    const ein = Number(usage?.promptTokens) || 0
    const aus = Number(usage?.completionTokens) || 0
    // `totalTokens` kann fehlen (manche Anbieter liefern nur die Hälften) oder
    // abweichen (Anthropic zählt zwischengespeicherte Eingaben gesondert). Ist
    // es da, gilt es; sonst die Summe.
    const gesamt = Number(usage?.totalTokens) || ein + aus

    // Ein mitgegebener Preis gilt — auch die 0. Deshalb die ausdrückliche
    // Prüfung auf null/undefined: mit `||` würde eine echte 0 (Ollama, lokal
    // und gratis) fälschlich zur Schätzung führen.
    const preis = kostenUsd === null || kostenUsd === undefined
        ? schaetzeKosten(modell, ein, aus)
        : Number(kostenUsd) || 0

    return {
        erstelltAm: jetzt,
        funktion: String(funktion),
        ausloeser: String(ausloeser || 'auto'),
        provider: String(provider || ''),
        modell: String(modell || ''),
        promptTokens: ein,
        completionTokens: aus,
        totalTokens: gesamt,
        kostenUsd: preis,
        bezugTyp: String(bezug?.typ || ''),
        bezugId: String(bezug?.id ?? ''),
    }
}

/**
 * Einen KI-Aufruf verbuchen.
 *
 * `kostenUsd` darf fehlen — dann wird aus Modell und Token gerechnet. Wer einen
 * Stückpreis kennt (Bilder, Pauschalen für X-Suche und Sonar), gibt ihn mit;
 * für die gibt es keine Tokenrechnung.
 *
 * @param {object}  a
 * @param {string}  a.funktion   Vorgang, siehe FUNKTIONEN
 * @param {string} [a.ausloeser] 'auto' (Zeitplan) | 'manuell' (Knopfdruck)
 * @param {string} [a.provider]
 * @param {string} [a.modell]
 * @param {object} [a.usage]     {promptTokens, completionTokens, totalTokens}
 * @param {number} [a.kostenUsd] fester Preis statt Schätzung aus Token
 * @param {object} [a.bezug]     {typ, id} — Rückverweis auf das Fachobjekt
 * @returns {Promise<boolean>}   true, wenn die Zeile stand
 */
export async function merkeVerbrauch(angaben = {}) {
    try {
        const zeile = baueVerbrauchZeile(angaben)
        if (!zeile) {
            logWarn('ai-usage', 'Verbrauch ohne Funktionsnamen — nicht verbucht')
            return false
        }
        await getKnex()('ai_usage').insert(zeile)
        return true
    } catch (e) {
        // Bewusst nur eine Warnung: siehe Grundregel oben.
        logWarn('ai-usage', `Verbrauch (${angaben?.funktion}) nicht verbucht: ${e.message}`)
        return false
    }
}

/**
 * Verbrauch eines Zeitraums, nach Funktion aufgeteilt.
 *
 * @param {number} vonMs  Beginn (einschliesslich)
 * @param {number} [bisMs]
 */
export async function verbrauchJeFunktion(vonMs, bisMs = Date.now()) {
    const zeilen = await getKnex()('ai_usage')
        .select('funktion')
        .sum({ kostenUsd: 'kostenUsd' })
        .sum({ totalTokens: 'totalTokens' })
        .count({ laeufe: 'id' })
        .where('erstelltAm', '>=', vonMs)
        .andWhere('erstelltAm', '<=', bisMs)
        .groupBy('funktion')
    // Beide Backends geben Summen je nach Treiber als Zeichenkette zurück.
    return zeilen.map((z) => ({
        funktion: z.funktion,
        kostenUsd: Number(z.kostenUsd) || 0,
        totalTokens: Number(z.totalTokens) || 0,
        laeufe: Number(z.laeufe) || 0,
    }))
}
