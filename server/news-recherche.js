/**
 * Recherche-Quellen für den Nachrichtenbereich, die keine Feeds sind.
 *
 * Zwei bezahlte Zugänge und eine Filterregel:
 *  - `sucheXPosts`     X/Twitter über die xAI Responses API (`x_search`-Tool).
 *                      Der einzige gangbare Weg: die X-API selbst kostet ein
 *                      Vielfaches und hat keinen Gratis-Zugang.
 *  - `rechercheThema`  Perplexity Sonar — eine Suchfrage je Berichtsthema,
 *                      Antwort kommt mit Web-Zitaten.
 *  - `istGefiltert`    der Kern des Ruhe-Filters, als reine Funktion,
 *                      damit der Selbsttest sie ohne Netz prüfen kann.
 *
 * Beide Netzfunktionen bekommen den entschlüsselten Schlüssel übergeben —
 * dieses Modul liest selbst keine Einstellungen und keine Datenbank.
 */

import { schaetzeKosten } from './llm.js'
import { merkeVerbrauch } from './ai-usage.js'
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

    const { text } = leseXAntwort(j)
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

    const { tokens, kostenUsd } = xKosten(j, modell, 'x-suche')

    if (!posts.length && text) logWarn('news-recherche', `X-Suche ohne verwertbare Posts (${text.slice(0, 120)})`)
    return { posts, tokens, kostenUsd }
}

/**
 * Text und zitierte Post-IDs aus einer xAI-Responses-Antwort.
 *
 * `output` ist eine Liste aus Tool-Aufrufen und Nachrichten; der Text steckt
 * in den `output_text`-Teilen der Nachricht (`output_text` auf oberster Ebene
 * gibt es je nach SDK-Stand auch — beides abklappern). Die Quellen, die die
 * Suche wirklich gesehen hat, stehen als `citations` auf oberster Ebene und
 * als `url_citation`-Anmerkungen am Text.
 */
export function leseXAntwort(j) {
    const teile = []
    const zitiert = new Set()
    const merke = (u) => { const id = tweetId(typeof u === 'string' ? u : u?.url); if (id) zitiert.add(id) }
    for (const item of (Array.isArray(j?.output) ? j.output : [])) {
        for (const c of (Array.isArray(item?.content) ? item.content : [])) {
            if (c?.type === 'output_text' && c.text) teile.push(c.text)
            for (const a of (Array.isArray(c?.annotations) ? c.annotations : [])) merke(a)
        }
    }
    for (const u of (Array.isArray(j?.citations) ? j.citations : [])) merke(u)
    return { text: teile.join('\n') || j?.output_text || '', zitierteIds: zitiert }
}

/**
 * Kosten einer X-Suche: Suchpauschale je tatsächlich abgesetzter Suche plus
 * Tokens. Wie viele Suchen das Modell abgesetzt hat, steht — je nach
 * API-Stand — als eigene Ausgabezeile drin; sonst konservativ eine. Die
 * Pauschale ist der grössere Posten — deshalb der fertige Preis statt einer
 * Tokenrechnung, die ihn unterschlagen würde.
 */
function xKosten(j, modell, funktion) {
    const m = modell || X_STANDARDMODELL
    const suchen = Math.max(1, (Array.isArray(j?.output) ? j.output : [])
        .filter((o) => String(o?.type || '').includes('x_search')).length)
    const ein = Number(j?.usage?.input_tokens) || 0
    const aus = Number(j?.usage?.output_tokens) || 0
    const tokens = Number(j?.usage?.total_tokens) || ein + aus
    const kostenUsd = suchen * X_SUCHE_USD + schaetzeKosten(m, ein, aus)
    merkeVerbrauch({
        funktion,
        provider: 'xai',
        modell: m,
        usage: { promptTokens: ein, completionTokens: aus, totalTokens: tokens },
        kostenUsd,
    })
    return { tokens, kostenUsd, suchen }
}

/**
 * X nach Nennungen von Token durchsuchen — für die Frühphase des Hype-Radars.
 *
 * Anders als `sucheXPosts` ohne Handle-Beschränkung: gefragt wird nach Posts
 * der letzten Stunden, die einen der genannten Token per Vertragsadresse oder
 * $KÜRZEL nennen, und nach neu beworbenen Vertragsadressen. EIN Aufruf.
 *
 * Grok gibt die Posts wörtlich zurück; ZÄHLEN tut der Aufrufer selbst
 * (`xNennungen` in `hype-radar/fruehphase-bewertung.js`) — nur Posts, die die
 * Suche zitiert hat und deren Text die Adresse wirklich enthält. Eine vom
 * Modell genannte Zahl wäre eine Behauptung, keine Messung.
 *
 * @param {object} p
 * @param {Array<{symbol:string, contract:string}>} p.token  höchstens 15
 * @param {number} p.stunden  Zeitfenster
 * @returns {{posts:Array<{handle,id,url,text,zeit}>, zitierteIds:Set<string>, kostenUsd:number}}
 */
export async function sucheXErwaehnungen({ token = [], stunden = 6, modell, apiKey, timeoutMs = X_TIMEOUT_MS }) {
    if (!apiKey) throw new Error('Kein xAI-Schlüssel hinterlegt')
    const liste = token.filter((t) => t?.contract).slice(0, 15)
        .map((t) => `${t.symbol ? '$' + t.symbol + ' ' : ''}${t.contract}`)
    const anweisung = `Suche auf X nach Posts der letzten ${stunden} Stunden zu jungen Krypto-Token (Memecoins auf Solana, Base, BSC, Ethereum):\n`
        + (liste.length ? `1. Posts, die einen dieser Token per Vertragsadresse oder $KÜRZEL nennen:\n${liste.join('\n')}\n` : '')
        + `${liste.length ? '2' : '1'}. Posts, die einen NEUEN Token mit vollständiger Vertragsadresse nennen.\n`
        + 'Gib die Posts WÖRTLICH wieder, höchstens 60. Antworte NUR mit einer JSON-Liste, ohne Kommentar:\n'
        + '[{"handle": "name_ohne_at", "url": "https://x.com/…/status/…", "datum": "ISO-Zeitpunkt", "text": "voller Wortlaut"}]\n'
        + 'Retweets ohne eigenen Text lässt du weg. Erfinde nichts; findest du nichts, antworte mit [].'

    const heute = new Date()
    const von = new Date(heute.getTime() - Math.max(stunden, 24) * 3600e3)
    const r = await fetchMitTimeout('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: modell || X_STANDARDMODELL,
            input: anweisung,
            // Das Werkzeug kennt nur Kalendertage; die Stunden stehen in der Frage.
            tools: [{ type: 'x_search', from_date: von.toISOString().slice(0, 10), to_date: heute.toISOString().slice(0, 10) }],
        }),
    }, timeoutMs)
    if (!r.ok) throw new Error(`xAI HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const j = await r.json()

    const { text, zitierteIds } = leseXAntwort(j)
    const posts = []
    for (const p of (parseJsonListe(text) || [])) {
        const url = String(p?.url || '').trim()
        const inhalt = String(p?.text || '').trim()
        const id = tweetId(url)
        if (!inhalt || !id) continue
        posts.push({
            handle: String(p?.handle || '').replace(/^@/, '').trim().toLowerCase()
                || (url.match(/x\.com\/([^/]+)\/status/i) || [])[1]?.toLowerCase() || '',
            id, url, text: inhalt.slice(0, 2000),
            zeit: Date.parse(p?.datum || '') || null,
        })
    }
    const { kostenUsd } = xKosten(j, modell, 'hype-x')
    if (!posts.length && text && text.trim() !== '[]') logWarn('news-recherche', `X-Nennungen ohne verwertbare Posts (${text.slice(0, 120)})`)
    return { posts, zitierteIds, kostenUsd }
}

/** Deutsche Themennamen — auch der Prompt-Baustein für die Sonar-Frage. */
export const THEMEN_NAMEN = {
    crypto: 'Kryptomarkt (Bitcoin, Ether, Altcoins, ETFs, Regulierung)',
    finanzen: 'Finanzmärkte (Aktien, Zinsen, Notenbanken, Rohstoffe, Devisen)',
    tech: 'Tech-Branche (KI, Chips, Grosskonzerne, Start-ups)',
    chartanalyse: 'Technische Chartanalyse der fünf grössten Coins nach Marktkapitalisierung',
}

/**
 * Eine Suchfrage je Berichtsthema an Perplexity Sonar.
 *
 * `frage` ersetzt die Standardfrage (die Chartanalyse nennt ihre Coins zur
 * Laufzeit), `mitBildern` bittet Perplexity um die Bilder der gefundenen
 * Seiten — dort stecken die Chart-Grafiken der Analysten, die wir bewusst
 * nicht selbst zeichnen. Kommen keine (Funktion ist an die Nutzungsstufe des
 * Schlüssels gebunden), bleibt die Liste einfach leer.
 *
 * @returns {{text: string, citations: string[], bilder: Array<{url: string, quelle: string}>, tokens: number, kostenUsd: number}}
 */
export async function rechercheThema({ thema, zeitraumText, apiKey, modell = 'sonar', timeoutMs = 60000,
    frage = '', mitBildern = false, aktualitaet = 'day' }) {
    if (!apiKey) throw new Error('Kein Perplexity-Schlüssel hinterlegt')
    const was = THEMEN_NAMEN[thema] || thema

    const r = await fetchMitTimeout('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: modell,
            messages: [{
                role: 'user',
                content: frage
                    || (`Was sind die wichtigsten Nachrichten der letzten ${zeitraumText} zum Thema ${was}? `
                        + 'Nüchtern und faktisch, für einen Krypto-Futures-Händler. Nenne Zahlen, wo welche '
                        + 'berichtet werden. Keine Anlageberatung, keine Prognosen, keine Aufzählung von Meinungen.'),
            }],
            /*
             * Der Aktualitätsfilter ist keine Feinheit, sondern die Grenze
             * zwischen Nachricht und Archiv.
             *
             * Gemessen am 20.08.2026 mit derselben Frage: OHNE Filter kamen
             * unter zwanzig Fundstellen Artikel von 2019, 2020, 2022 und
             * November 2025 — direkt neben den heutigen, und im Bericht als
             * gleichwertiger Beleg nummeriert. MIT `search_recency_filter`
             * waren alle zwanzig vom selben Tag.
             *
             * Die Frage nach dem Zeitraum im Text genügt dafür nicht: Sie ist
             * eine Bitte an das Modell, der Filter eine Bedingung an die Suche.
             */
            ...(aktualitaet ? { search_recency_filter: aktualitaet } : {}),
            ...(mitBildern ? { return_images: true } : {}),
        }),
    }, timeoutMs)
    if (!r.ok) throw new Error(`Perplexity HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const j = await r.json()

    const text = String(j?.choices?.[0]?.message?.content || '').trim()
    // Zitate liegen top-level; neuere API-Stände nennen sie `search_results`.
    const citations = Array.isArray(j?.citations) ? j.citations.filter((u) => typeof u === 'string')
        : (Array.isArray(j?.search_results) ? j.search_results.map((s) => s?.url).filter(Boolean) : [])
    /*
     * Das Datum je Fundstelle, soweit die API es nennt.
     *
     * Es steht nur in `search_results`, nicht in `citations` — und es ist die
     * einzige Handhabe, mit der ein Leser einen Beleg einordnen kann. Ein
     * Verweis ohne Datum sieht neben einem tagesaktuellen genauso aus.
     */
    const daten = new Map((Array.isArray(j?.search_results) ? j.search_results : [])
        .filter((x) => x?.url).map((x) => [x.url, String(x.date || x.last_updated || '').slice(0, 10)]))
    // Bilder je nach API-Stand als Objekt {image_url, origin_url} oder blanke URL.
    const bilder = !mitBildern ? [] : (Array.isArray(j?.images) ? j.images : [])
        .map((b) => (typeof b === 'string'
            ? { url: b, quelle: '' }
            : { url: b?.image_url || b?.url || '', quelle: b?.origin_url || '' }))
        .filter((b) => /^https:\/\//.test(b.url))
        .slice(0, 10)
    const promptTokens = Number(j?.usage?.prompt_tokens) || 0
    const completionTokens = Number(j?.usage?.completion_tokens) || 0
    // Anfragepauschale plus Token — die Pauschale fällt je Frage an, unabhängig
    // davon, wie kurz die Antwort ausfällt.
    const kostenUsd = SONAR_ANFRAGE_USD + schaetzeKosten(modell, promptTokens, completionTokens)

    merkeVerbrauch({
        funktion: 'recherche',
        provider: 'perplexity',
        modell,
        usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
        kostenUsd,
    })

    return {
        text,
        citations,
        quellenDaten: daten,
        bilder,
        tokens: promptTokens + completionTokens,
        kostenUsd,
    }
}

/**
 * Ruhe-Filter-Kern. Gefiltert wird ein Beitrag, wenn
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
 * Fokus-Filter — das Gegenstück zum Ruhe-Filter. Der schliesst aus, der
 * hier lässt nur durch, was mindestens eines der Stichwörter trifft. Leere
 * Liste heisst „kein Fokus eingestellt", also lässt alles durch — nicht
 * „nichts passt". Gleicher `heuhaufen`-Aufbau wie `istGefiltert`, damit
 * dieselbe Eingabe an beiden Filtern gleich behandelt wird.
 *
 * @param {{titel?: string, inhalt?: string}} item
 * @param {string[]} woerter  bereits zerlegte, getrimmte Stichwörter
 * @param {{name?: string}} quelle
 */
export function istFokusTreffer(item, woerter, quelle) {
    if (!woerter?.length) return true
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

/**
 * Zitate einer Recherche in Beleg-Zeilen umbauen — mit Bild, wo eines passt.
 *
 * `citations` und `bilder` kommen aus DERSELBEN Perplexity-Antwort: eine
 * Bild-Herkunft (`quelle`, eigentlich `origin_url`) ist dieselbe URL wie ein
 * Zitat, wenn beide von derselben Seite stammen. Passt eine zusammen, trägt
 * der Beleg das Bild — `punktBild()` im Frontend zeigt es dann direkt am
 * Punkt, der sich auf diese Quelle stützt, statt dass eine Chartgrafik
 * beziehungslos neben dem Text herumliegt, ohne zu sagen, wozu sie gehört.
 *
 * Reine Funktion, damit der Selbsttest die Zuordnung ohne Netz prüfen kann.
 *
 * @param {string[]} citations
 * @param {Array<{url: string, quelle: string}>} bilder
 * @param {Map<string,string>} [quellenDaten]  URL -> Datum, soweit bekannt
 */
export function baueRechercheZitate(citations, bilder = [], quellenDaten = new Map()) {
    const bildJeUrl = new Map((bilder || [])
        .filter((b) => b?.quelle).map((b) => [String(b.quelle).replace(/\/$/, ''), b.url]))
    return (Array.isArray(citations) ? citations : []).map((url) => {
        const datum = quellenDaten?.get(url) || ''
        return {
            titel: `${url.replace(/^https?:\/\//, '').slice(0, 180)}${datum ? ` (${datum})` : ''}`,
            url, quelle: 'Perplexity-Recherche', art: 'rss',
            bild: bildJeUrl.get(url.replace(/\/$/, '')) || '', datum,
        }
    })
}
