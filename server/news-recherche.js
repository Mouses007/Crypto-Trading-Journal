/**
 * Recherche-Quellen für den Nachrichtenbereich, die keine Feeds sind.
 *
 * Zwei bezahlte Zugänge und eine Filterregel:
 *  - `sucheXPosts`     X/Twitter über die xAI Responses API (`x_search`-Tool).
 *                      Der einzige gangbare Weg: die X-API selbst kostet ein
 *                      Vielfaches und hat keinen Gratis-Zugang.
 *  - `rechercheThema`  Perplexity Sonar — eine Suchfrage je Berichtsthema,
 *                      Antwort kommt mit Web-Zitaten.
 *  - `istGefiltert`    der Kern des Arschlochfilters, als reine Funktion,
 *                      damit der Selbsttest sie ohne Netz prüfen kann.
 *
 * Beide Netzfunktionen bekommen den entschlüsselten Schlüssel übergeben —
 * dieses Modul liest selbst keine Einstellungen und keine Datenbank.
 */

import { schaetzeKosten } from './llm.js'
import { logWarn } from './logger.js'

// Pauschale je Suchaufruf laut Anbieter-Preisliste (5 $ je 1000). Die Token
// kommen über `schaetzeKosten` dazu; zusammen ist das die ehrliche Zahl für
// `kostenUsd` im Bericht.
const X_SUCHE_USD = 0.005
const SONAR_ANFRAGE_USD = 0.005

/**
 * Rückfall-Modell der X-Suche. Bewusst nicht das teuerste: Grok holt hier nur
 * die Posts ab, zusammengefasst wird im Journal selbst — dafür reicht das
 * kleinere Modell zum halben Eingabepreis.
 */
const X_STANDARDMODELL = 'grok-4.3'

/** fetch mit hartem Timeout — die Kopie in llm.js ist modulintern. */
async function fetchMitTimeout(url, options, timeoutMs) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
        return await fetch(url, { ...options, signal: ctrl.signal })
    } finally {
        clearTimeout(timer)
    }
}

/** Erstes JSON-Array aus einer Antwort ziehen (Modelle plaudern gern drumherum). */
function parseJsonListe(text) {
    if (!text) return null
    const roh = String(text).trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/, '')
    try { const j = JSON.parse(roh); return Array.isArray(j) ? j : null } catch { /* unten */ }
    const von = roh.indexOf('[')
    const bis = roh.lastIndexOf(']')
    if (von === -1 || bis <= von) return null
    try { const j = JSON.parse(roh.slice(von, bis + 1)); return Array.isArray(j) ? j : null } catch { return null }
}

/** Tweet-ID aus einer Status-URL — sie ist der stabile Dedupe-Schlüssel. */
function tweetId(url) {
    const m = String(url || '').match(/status(?:es)?\/(\d+)/)
    return m ? m[1] : ''
}

/**
 * X-Posts der angegebenen Accounts über Grok holen.
 *
 * EIN Aufruf je Lauf für ALLE Handles (das Tool nimmt bis 20) — nicht einer je
 * Quelle: bezahlt wird je Suche. Grok wird angewiesen, die Posts wörtlich als
 * JSON-Liste zurückzugeben; die Zitat-URLs der Antwort dienen als Kontrolle.
 *
 * @returns {{posts: Array<{handle,extId,titel,inhalt,url,publishedAt}>, tokens: number, kostenUsd: number}}
 */
/**
 * Zeitgrenze der X-Suche.
 *
 * 90 Sekunden waren zu knapp und der Abruf brach mit „operation was aborted"
 * ab — bezahlt wird die Suche bei xAI trotzdem. Grok setzt je Lauf mehrere
 * interne Suchen ab (bei vier Accounts gut ein halbes Dutzend), das dauert.
 * Der Aufruf läuft im Hintergrundtakt, ihn grosszügig zu bemessen kostet also
 * niemanden Wartezeit.
 */
const X_TIMEOUT_MS = 240000

export async function sucheXPosts({ handles, vonIso, bisIso, modell, apiKey, timeoutMs = X_TIMEOUT_MS }) {
    const sauber = [...new Set((handles || []).map((h) => String(h).trim().replace(/^@/, '')).filter(Boolean))].slice(0, 20)
    if (!sauber.length) return { posts: [], tokens: 0, kostenUsd: 0 }
    if (!apiKey) throw new Error('Kein xAI-Schlüssel hinterlegt')

    const anweisung = 'Suche die X-Posts der angegebenen Accounts im Zeitraum und gib sie WÖRTLICH wieder. '
        + 'Antworte NUR mit einer JSON-Liste, ohne Kommentar davor oder danach:\n'
        + '[{"handle": "name_ohne_at", "url": "https://x.com/…/status/…", '
        + '"datum": "ISO-Zeitpunkt", "text": "voller Wortlaut des Posts"}]\n'
        + 'Reine Antworten auf fremde Posts und Retweets ohne eigenen Text lässt du weg. '
        + 'Findest du nichts, antworte mit [].'

    const r = await fetchMitTimeout('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: modell || X_STANDARDMODELL,
            input: `${anweisung}\n\nAccounts: ${sauber.map((h) => '@' + h).join(', ')}`,
            tools: [{
                type: 'x_search',
                allowed_x_handles: sauber,
                from_date: vonIso,
                to_date: bisIso,
            }],
        }),
    }, timeoutMs)
    if (!r.ok) throw new Error(`xAI HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const j = await r.json()

    // Responses API: `output` ist eine Liste aus Tool-Aufrufen und Nachrichten;
    // der Text steckt in den `output_text`-Teilen der Nachricht. `output_text`
    // auf oberster Ebene gibt es je nach SDK-Stand auch — beides abklappern.
    const teile = []
    for (const item of (Array.isArray(j?.output) ? j.output : [])) {
        for (const c of (Array.isArray(item?.content) ? item.content : [])) {
            if (c?.type === 'output_text' && c.text) teile.push(c.text)
        }
    }
    const text = teile.join('\n') || j?.output_text || ''
    const roh = parseJsonListe(text) || []

    const posts = []
    for (const p of roh) {
        const url = String(p?.url || '').trim()
        const inhalt = String(p?.text || '').trim()
        if (!inhalt) continue
        const id = tweetId(url)
        const handle = String(p?.handle || '').replace(/^@/, '').trim()
        const publishedAt = Date.parse(p?.datum || '') || Date.now()
        posts.push({
            handle,
            // Ohne Status-URL bleibt der Wortlaut selbst der Schlüssel — besser
            // ein stabiler Ersatz als ein Duplikat je Lauf.
            extId: id || `x-${handle}-${publishedAt}`,
            titel: inhalt.slice(0, 200),
            inhalt,
            url: url || (handle ? `https://x.com/${handle}` : ''),
            publishedAt,
        })
    }

    // Wie viele Suchen das Modell tatsächlich abgesetzt hat, steht — je nach
    // API-Stand — als eigene Ausgabezeile drin; sonst konservativ eine.
    const suchen = Math.max(1, (Array.isArray(j?.output) ? j.output : [])
        .filter((o) => String(o?.type || '').includes('x_search')).length)
    const tokens = Number(j?.usage?.total_tokens)
        || (Number(j?.usage?.input_tokens) || 0) + (Number(j?.usage?.output_tokens) || 0)
    const kostenUsd = suchen * X_SUCHE_USD
        + schaetzeKosten(modell || X_STANDARDMODELL, Number(j?.usage?.input_tokens) || 0, Number(j?.usage?.output_tokens) || 0)

    if (!posts.length && text) logWarn('news-recherche', `X-Suche ohne verwertbare Posts (${text.slice(0, 120)})`)
    return { posts, tokens, kostenUsd }
}

/** Deutsche Themennamen — auch der Prompt-Baustein für die Sonar-Frage. */
export const THEMEN_NAMEN = {
    crypto: 'Kryptomarkt (Bitcoin, Ether, Altcoins, ETFs, Regulierung)',
    finanzen: 'Finanzmärkte (Aktien, Zinsen, Notenbanken, Rohstoffe, Devisen)',
    tech: 'Tech-Branche (KI, Chips, Grosskonzerne, Start-ups)',
}

/**
 * Eine Suchfrage je Berichtsthema an Perplexity Sonar.
 * @returns {{text: string, citations: string[], tokens: number, kostenUsd: number}}
 */
export async function rechercheThema({ thema, zeitraumText, apiKey, modell = 'sonar', timeoutMs = 60000 }) {
    if (!apiKey) throw new Error('Kein Perplexity-Schlüssel hinterlegt')
    const was = THEMEN_NAMEN[thema] || thema

    const r = await fetchMitTimeout('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: modell,
            messages: [{
                role: 'user',
                content: `Was sind die wichtigsten Nachrichten der letzten ${zeitraumText} zum Thema ${was}? `
                    + 'Nüchtern und faktisch, für einen Krypto-Futures-Händler. Nenne Zahlen, wo welche '
                    + 'berichtet werden. Keine Anlageberatung, keine Prognosen, keine Aufzählung von Meinungen.',
            }],
        }),
    }, timeoutMs)
    if (!r.ok) throw new Error(`Perplexity HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const j = await r.json()

    const text = String(j?.choices?.[0]?.message?.content || '').trim()
    // Zitate liegen top-level; neuere API-Stände nennen sie `search_results`.
    const citations = Array.isArray(j?.citations) ? j.citations.filter((u) => typeof u === 'string')
        : (Array.isArray(j?.search_results) ? j.search_results.map((s) => s?.url).filter(Boolean) : [])
    const promptTokens = Number(j?.usage?.prompt_tokens) || 0
    const completionTokens = Number(j?.usage?.completion_tokens) || 0
    return {
        text,
        citations,
        tokens: promptTokens + completionTokens,
        kostenUsd: SONAR_ANFRAGE_USD + schaetzeKosten(modell, promptTokens, completionTokens),
    }
}

/**
 * Arschlochfilter-Kern. Gefiltert wird ein Beitrag, wenn
 *  (a) seine Quelle Truth Social ist — das ist der automatische Teil — oder
 *  (b) eines der Stichwörter (ohne Beachtung der Schreibung) in Titel, Inhalt
 *      oder Quellennamen vorkommt.
 *
 * Reine Funktion ohne Datenbank, damit der Selbsttest sie direkt prüfen kann.
 *
 * @param {{titel?: string, inhalt?: string}} item
 * @param {string[]} woerter  bereits zerlegte, getrimmte Stichwörter
 * @param {{art?: string, name?: string}} quelle
 */
export function istGefiltert(item, woerter, quelle) {
    if (quelle?.art === 'truth') return true
    if (!woerter?.length) return false
    const heuhaufen = `${item?.titel || ''}\n${item?.inhalt || ''}\n${quelle?.name || ''}`.toLowerCase()
    return woerter.some((w) => w && heuhaufen.includes(String(w).toLowerCase()))
}

/**
 * Einstellungs-Text in die Wörterliste zerlegen. Getrennt wird an
 * Zeilenumbrüchen UND Kommas — die Eingabemaske sagt zwar „ein Begriff je
 * Zeile", aber getippt wird trotzdem „Donald Trump, Michael Saylor", und ein
 * Filter, der deswegen still nichts filtert, ist schlimmer als keiner.
 */
export function zerlegeWoerter(text) {
    return String(text || '')
        .split(/[\r\n,]+/)
        .map((z) => z.trim())
        .filter(Boolean)
}
