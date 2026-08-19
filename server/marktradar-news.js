/**
 * Nachrichten-Sektion des Marktradars.
 *
 * Zwei getrennte Schritte, bewusst mit zwei Anbietern:
 *
 * 1. **Holen und speichern** — kostet nichts. Titel, Verweis und Zeitpunkt
 *    sind für sich schon nützlich; ohne KI zeigt die Kachel genau das.
 * 2. **Lagebericht** — der Bericht entsteht beim EINGESTELLTEN Anbieter des
 *    Journals (dort steht Claude). Nur YouTube-Videos gehen vorher an Gemini,
 *    weil kein anderer der eingebundenen Anbieter eine Video-URL selbst öffnet.
 *    Fällt Gemini aus, entsteht der Bericht trotzdem — nur ohne Videoinhalte.
 *
 * Ausgelöst wird Schritt 2 nur vom Zeitplan (Vorgabe 12:00) oder per Knopf.
 *
 * Was gespeichert wird: Titel, Verweis, Zeitpunkt und ein gekürzter Auszug für
 * die spätere Zusammenfassung — keine Volltextkopien. Angezeigt wird immer mit
 * Quelle und Verweis auf das Original.
 */

import { getKnex } from './database.js'
import { logWarn } from './logger.js'
import { melde } from './benachrichtigungen.js'
import {
    beansprucheAufgabe, beansprucheTagesaufgabe, gibAufgabeFrei,
    merkeAufgabenFehler, stempleAufgabe, leseAufgabenStand,
} from './db-claim.js'
import { holeText, pruefeOeffentlicheUrl } from './net-guard.js'
import { leseFeed, leseTelegram, telegramUrl } from './feed-parser.js'
import {
    sendRadarError, holeFearGreed, holeGlobal, holeFunding, holeLsOi, holeAltseason,
    holeMarkt,
} from './marktradar-api.js'
import { ladeLlmConfig, callLLMJson, istGuthabenFehler, merkeKiGuthaben, schaetzeKosten } from './llm.js'
import { merkeVerbrauch } from './ai-usage.js'
import { samplingFelder, GEMINI_STANDARDMODELL } from './ai-models.js'
import {
    sucheXPosts, rechercheThema, istGefiltert, zerlegeWoerter, THEMEN_NAMEN,
} from './news-recherche.js'

const TAG = 24 * 60 * 60 * 1000
const MAX_ALTER = 3 * TAG          // ältere Beiträge sind keine Nachricht mehr
const AUFBEWAHRUNG = 30 * TAG
const ARTEN = ['youtube', 'rss', 'truth', 'telegram', 'x']

// Kosten der letzten X-Suche. Der Abruf läuft unmittelbar vor dem Bericht
// (gleicher Takt bzw. gleicher Knopfdruck); der Bericht holt sich die Zahl ab
// und weist sie in `kostenUsd` mit aus, statt sie im Serverlog zu begraben.
let letzteXKostenUsd = 0

/**
 * Die X-Suche läuft EINMAL JE KALENDERTAG, nicht in einem rollenden Fenster.
 *
 * Jede Suche kostet — Tool-Gebühr plus Token. Der Lagebericht entsteht einmal
 * am Tag, also reicht auch ein Abruf am Tag; mit vier Stunden Abstand liefen
 * bis zu sechs bezahlte Suchen täglich, von denen fünf niemand las.
 *
 * Warum Kalendertag und nicht schlicht 24 Stunden: Ein rollendes Fenster
 * wandert. Wird heute um 13:00 gesucht, ist morgen um 12:10 — zur Berichtszeit
 * — noch keine Stunde Luft, die Suche fällt aus und der Bericht sieht die
 * X-Posts des Tages nicht. Am Kalendertag aufgehängt fällt die Suche
 * zuverlässig in die erste Abrufrunde nach Mitternacht, also lange vor den
 * Bericht. Bei einem Fehlschlag darf nach zwei Stunden neu versucht werden.
 */
const X_WIEDERHOLUNG_MS = 2 * 60 * 60 * 1000

/**
 * Hat Gemini „nichts Marktrelevantes" gemeldet?
 *
 * Ein blosses `startsWith('OHNE INHALT')` reichte nicht mehr, seit die
 * Zusammenfassung als Stichpunktliste angefordert wird: Das Modell hält sich
 * an die Form und antwortet `- OHNE INHALT`. Die Erkennung schlug damit fehl,
 * und der Sentinel landete als angebliche Videozusammenfassung in der
 * Datenbank — sichtbar als Kachel und als Futter für den Bericht.
 */
export function istOhneInhalt(text) {
    return /^[\s\-–—*•]*ohne\s+inhalt/i.test(String(text || ''))
}

/**
 * Vorschläge beim ersten Öffnen — nichts davon ist aktiv, und nichts wird
 * ungefragt abgerufen. Truth Social und X stehen als „Lärm" markiert da,
 * womit der Sammelschalter sie in seiner Vorgabestellung ausblendet.
 */
export const VORSCHLAEGE = [
    // Alle fünf Kanäle am 16.08.2026 geprüft: jeder Feed liefert 15 Videos
    { art: "youtube", name: "RobynHD", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UChWftKUs7F8Au7fyZUHrnzA", laerm: 0 },
    { art: "youtube", name: "Bitbull", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCh8EqZyAUunyl1ryHeZAaSw", laerm: 0 },
    { art: "youtube", name: "Coin Bureau", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCqK_GSMbpiV8spgD3ZGloSw", laerm: 0 },
    { art: "youtube", name: "Bankless", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCAl9Ld79qaZxp9JzEOwd3aA", laerm: 0 },
    { art: "youtube", name: "Real Vision (Makro)", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCGXWKlq1Oxr3ddEtmKhAkPg", laerm: 0 },
    // Der deutsche Cointelegraph-Feed ist abgeschaltet (HTTP 410), der englische läuft
    { art: 'rss', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', laerm: 0 },
    // Finanz- und Tech-Feeds für die gleichnamigen Kapitel des Berichts.
    // Sie ersetzen den Umweg über Perplexity Discover: dessen Seiten sind
    // hinter einer Cloudflare-Prüfung und haben keinen Feed (geprüft
    // 17.08.2026, HTTP 403 mit `cf-mitigated: challenge`) — und sie wären
    // ohnehin die schlechtere Quelle, weil sie schon eine fremde
    // KI-Zusammenfassung SIND. Hier stehen die Blätter selbst, die Discover
    // zusammenfasst; damit bleiben Zahlen und Verweise erhalten.
    // Alle am 17.08.2026 geprüft (Einträge je Abruf in Klammern).
    { art: 'rss', name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', laerm: 0 },          // 50
    { art: 'rss', name: 'CNBC Finance', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', laerm: 0 }, // 30
    { art: 'rss', name: 'Investing.com', url: 'https://www.investing.com/rss/news_25.rss', laerm: 0 },        // 10
    { art: 'rss', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', laerm: 0 }, // 20
    { art: 'rss', name: 'TechCrunch', url: 'https://techcrunch.com/feed/', laerm: 0 },                        // 20
    { art: 'rss', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', laerm: 0 },               // 10
    { art: 'rss', name: 'Hacker News', url: 'https://news.ycombinator.com/rss', laerm: 0 },                   // 30
    { art: 'telegram', name: 'Watcher Guru', url: 'https://t.me/s/watcherguru', laerm: 0 },
    { art: "truth", name: "Truth Social (Spiegel)", url: "https://trumpstruth.org/feed", laerm: 1 },
]

async function quellen(nurAktive = true) {
    const q = getKnex()('news_sources').orderBy('id')
    return nurAktive ? q.where('enabled', 1) : q
}

/**
 * Ein Durchlauf über alle aktiven Quellen.
 *
 * Der Sammelschalter wirkt schon HIER, nicht erst in der Anzeige: was
 * ausgeblendet ist, wird gar nicht erst geholt. Das spart nicht nur Abrufe,
 * es ist auch ehrlicher als Verstecken.
 */
export async function laufeNewsAbruf({ manuell = false } = {}) {
    const ttl = manuell ? 5 * 60 * 1000 : 60 * 60 * 1000
    if (!(await beansprucheAufgabe('news_abruf', ttl))) return { uebersprungen: true }

    const knex = getKnex()
    const s = await knex('settings').where('id', 1).first().catch(() => null)
    const filterAn = Number(s?.radarArschlochfilter ?? 1) === 1

    const liste = await quellen(true)
    let neu = 0, gesehen = 0, fehler = 0
    const grenze = Date.now() - MAX_ALTER

    /** Einen Eintrag einfügen oder — falls schon da — nur das Bild nachtragen.
     *  Liefert 1 für neu, 0 für bekannt. Ersetzt die frühere Zählweise über
     *  zwei `count(*)` je Eintrag, die bei 200 Beiträgen 400 Vollzählungen
     *  kostete; der Blick auf die Unique-Spalten selbst ist billiger. */
    /**
     * URL aus einer Fremdquelle säubern.
     *
     * Feeds werden vom Nutzer eingetragen, ihr Inhalt kommt aber von fremden
     * Servern und wird in der Nachrichtenseite als `href` und `src` gerendert.
     * Ein kompromittierter Feed könnte `javascript:…` liefern; der Klick liefe
     * dann im Ursprung der App, mit ihrem Sitzungs-Cookie.
     * `target="_blank" rel="noopener"` entschärft das weitgehend, ist aber
     * kein Sicherheitsmechanismus. Erlaubt sind nur http und https.
     */
    function sichereUrl(roh) {
        const text = String(roh || '').slice(0, 500)
        if (!text) return ''
        try {
            const u = new URL(text)
            return (u.protocol === 'http:' || u.protocol === 'https:') ? text : ''
        } catch {
            return ''
        }
    }

    async function speichereEintrag(zeile) {
        // Eine Stelle für alle Quellen (RSS, Telegram, X, Truth, YouTube):
        // Liste, Belege und Videolinks hängen alle an diesen beiden Feldern.
        zeile = { ...zeile, url: sichereUrl(zeile.url), bild: sichereUrl(zeile.bild) }
        const da = await knex('news_items')
            .where({ sourceId: zeile.sourceId, extId: zeile.extId }).select('id').first()
        if (da) {
            /*
             * Beim Konflikt wird NUR das Bild nachgetragen.
             *
             * Ein vollständiges Update wäre falsch: Status, Zusammenfassung
             * und Versuchszähler würden zurückgesetzt, ein bereits von der
             * KI angesehenes Video fiele auf „neu" zurück und würde erneut
             * bezahlt. Gar nichts anzufassen liesse Felder, die es früher
             * noch nicht gab, für immer leer — genau das ist beim Bild
             * passiert. Also gezielt: nur das Bild.
             */
            if (zeile.bild) await knex('news_items').where('id', da.id).update({ bild: zeile.bild })
            return 0
        }
        await knex('news_items').insert(zeile)
            .onConflict(['sourceId', 'extId']).merge(['bild'])   // Rennen zweier Instanzen
        return 1
    }

    // ── X/Twitter: EINE Grok-Suche für alle Handles ──────────────────────
    // Bezahlt wird je Suche, nicht je Quelle — deshalb ein Sammelaufruf statt
    // einer Schleife. Der eigene Anspruch (4 h) schützt davor, dass der
    // „Jetzt holen"-Knopf jedes Mal eine bezahlte Suche auslöst.
    const xQuellen = liste.filter(q => q.art === 'x' && !(filterAn && Number(q.laerm) === 1))
    if (xQuellen.length && (await beansprucheTagesaufgabe('news_x_suche', {
        tagesbeginn: tagesbeginn(Date.now(), s?.timeZone),
        wiederholungMs: X_WIEDERHOLUNG_MS,
    }))) {
        try {
            const xCfg = await ladeLlmConfig({ provider: 'xai' })
            if (!xCfg.apiKey) throw new Error('Kein xAI-Schlüssel hinterlegt (Einstellungen → KI)')

            const { posts, kostenUsd } = await sucheXPosts({
                handles: xQuellen.map(q => q.url),
                vonIso: new Date(Date.now() - MAX_ALTER).toISOString().slice(0, 10),
                bisIso: new Date().toISOString().slice(0, 10),
                modell: s?.radarNewsXModell || 'grok-4.3',
                apiKey: xCfg.apiKey,
            })
            letzteXKostenUsd = kostenUsd
            merkeKiGuthaben('xai').catch(() => { })
            await merkeAufgabenFehler('news_x_suche', '')   // gelungen: Tag erledigt
            gesehen += posts.length

            // Posts ihrer Quelle zuordnen — über den Handle; was keinem
            // bekannten Handle zuzuordnen ist, landet bei der ersten X-Quelle.
            const nachHandle = new Map(xQuellen.map(q =>
                [String(q.url).trim().replace(/^@/, '').toLowerCase(), q]))
            for (const p of posts) {
                const q = nachHandle.get(String(p.handle || '').toLowerCase()) || xQuellen[0]
                if (!p.publishedAt || p.publishedAt >= grenze) {
                    neu += await speichereEintrag({
                        sourceId: q.id,
                        extId: String(p.extId).slice(0, 200),
                        titel: p.titel.slice(0, 500),
                        url: p.url.slice(0, 500),
                        inhalt: p.inhalt,
                        bild: '',
                        publishedAt: p.publishedAt,
                        status: 'neu',
                        createdAt: Date.now(),
                    })
                }
            }
            for (const q of xQuellen) {
                await knex('news_sources').where('id', q.id).update({
                    letzterAbruf: Date.now(), letzterFehler: '', fehlerZaehler: 0, updatedAt: Date.now(),
                })
            }
        } catch (e) {
            fehler++
            if (istGuthabenFehler(e.message)) await merkeKiGuthaben('xai', e.message)
            // Vermerk am Anspruch: erlaubt den Wiederholungsversuch nach zwei
            // Stunden, statt den Tag mit einem Fehlschlag zu verbrennen.
            await merkeAufgabenFehler('news_x_suche', e.message)
            for (const q of xQuellen) {
                await knex('news_sources').where('id', q.id).update({
                    letzterFehler: String(e.message).slice(0, 300),
                    fehlerZaehler: Number(q.fehlerZaehler || 0) + 1,
                    updatedAt: Date.now(),
                })
            }
            logWarn('news', `X-Suche: ${e.message}`)
        }
    }

    for (const q of liste) {
        if (filterAn && Number(q.laerm) === 1) continue
        if (q.art === 'x') continue   // oben gesammelt behandelt

        try {
            // Telegram-Kanäle liefern HTML statt XML — gleicher Abrufweg
            // (inklusive SSRF-Prüfung), nur ein anderer Leser
            const istTelegram = q.art === 'telegram'
            const roh = await holeText(istTelegram ? telegramUrl(q.url) : q.url)
            const eintraege = (istTelegram ? leseTelegram(roh) : leseFeed(roh)).filter(e => !e.zeit || e.zeit >= grenze)
            gesehen += eintraege.length

            for (const e of eintraege) {
                const zeile = {
                    sourceId: q.id,
                    extId: String(e.id).slice(0, 200),
                    titel: e.titel.slice(0, 500),
                    url: e.link.slice(0, 500),
                    inhalt: e.inhalt,
                    bild: String(e.bild || '').slice(0, 500),
                    publishedAt: e.zeit || Date.now(),
                    status: 'neu',
                    createdAt: Date.now(),
                }
                neu += await speichereEintrag(zeile)
            }

            await knex('news_sources').where('id', q.id).update({
                letzterAbruf: Date.now(), letzterFehler: '', fehlerZaehler: 0, updatedAt: Date.now(),
            })
        } catch (e) {
            fehler++
            // Fehler bleiben AN DER QUELLE hängen, der Lauf geht weiter — eine
            // tote Adresse darf die übrigen nicht mitreissen
            await knex('news_sources').where('id', q.id).update({
                letzterFehler: String(e.message).slice(0, 300),
                fehlerZaehler: Number(q.fehlerZaehler || 0) + 1,
                updatedAt: Date.now(),
            })
            logWarn('news', `${q.name || q.url}: ${e.message}`)
        }
    }

    // Aufräumen: alles jenseits der Aufbewahrung fliegt raus
    if (await beansprucheAufgabe('news_retention', TAG)) {
        const weg = await knex('news_items').where('publishedAt', '<', Date.now() - AUFBEWAHRUNG).del()
        if (weg) console.log(` -> News: ${weg} alte Beiträge entfernt`)
    }

    console.log(` -> News: ${gesehen} Beiträge gesehen, ${neu} neu, ${fehler} Quelle(n) mit Fehler`)
    return { gesehen, neu, fehler }
}

// ── Lagebericht ──────────────────────────────────────────────────────────

/**
 * Ein YouTube-Video von Gemini ansehen lassen.
 *
 * Gemini ist der einzige der eingebundenen Anbieter, der eine YouTube-Adresse
 * selbst öffnet — es wird nichts heruntergeladen, die URL geht direkt an das
 * Modell. Deshalb läuft dieser Schritt IMMER über Gemini und seinen eigenen
 * Schlüssel, unabhängig davon, welcher Anbieter im Journal als Standard
 * eingestellt ist (dort steht Claude). Fehlt der Gemini-Schlüssel, entfällt
 * nur dieser Schritt; der Bericht entsteht trotzdem, dann aus Titel und
 * Videobeschreibung.
 *
 * Video ist der teuerste Eingabetyp überhaupt — abgerechnet nach Videolänge.
 * Darum die harte Obergrenze je Lauf und die Beschränkung auf frische Beiträge.
 */
/**
 * Wie ausführlich ein Video beschrieben wird.
 *
 * Bisher gab es nur eine Stufe — fünf bis acht Zeilen à zwölf Wörter. Das
 * reicht, um ein Video in den Bericht einfliessen zu lassen, aber nicht, um
 * eines zu LESEN statt anzusehen. Wer 40 Minuten Livestream nicht schaut, will
 * mehr als acht Schlagworte; wer nur Belegmaterial braucht, will nicht dafür
 * zahlen. Deshalb drei Stufen mit eigenem Auftrag und eigenem Token-Deckel.
 *
 * Der Deckel begrenzt nur die AUSGABE. Der Preis eines Videos entsteht fast
 * vollständig auf der Eingabeseite (Länge × Auflösung) — „ausführlich" kostet
 * also spürbar weniger extra, als die Zahlen vermuten lassen.
 */
export const VIDEO_TIEFEN = {
    knapp: {
        tokens: 250,
        auftrag: 'Fasse dieses Video in drei bis fünf Stichpunkten auf Deutsch zusammen. '
            + 'Jede Zeile beginnt mit "- " und hat höchstens zwölf Wörter.',
    },
    normal: {
        tokens: 400,
        auftrag: 'Fasse dieses Video in fünf bis acht Stichpunkten auf Deutsch zusammen. '
            + 'Jede Zeile beginnt mit "- " und hat höchstens zwölf Wörter.',
    },
    ausfuehrlich: {
        tokens: 1200,
        auftrag: 'Beschreibe dieses Video ausführlich auf Deutsch, so dass man es nicht '
            + 'ansehen muss. Beginne mit zwei bis drei Sätzen: worum es geht und welche '
            + 'These vertreten wird. Danach acht bis zwölf Zeilen, jede mit "- " beginnend '
            + '— die genannten Zahlen, Kursniveaus, Fristen und Ereignisse, jeweils MIT '
            + 'ihrem Zusammenhang und nicht als Stichwort. Zahlen wörtlich so nennen, wie '
            + 'sie im Video fallen. Wird eine Aussage begründet, nenne die Begründung mit.',
    },
}

/** Stufe samt Token-Deckel auflösen; `deckel > 0` schlägt die Stufe. */
export function videoTiefeAus(tiefe, deckel) {
    const stufe = VIDEO_TIEFEN[tiefe] || VIDEO_TIEFEN.normal
    const eigen = Math.max(0, Number(deckel) || 0)
    return { ...stufe, tokens: eigen ? Math.min(4000, Math.max(80, eigen)) : stufe.tokens }
}

/**
 * Ist das ein Livestream (laufend oder als Aufzeichnung)?
 *
 * Gemini kann eine laufende Übertragung nicht als Datei öffnen und antwortet
 * mit `403 PERMISSION_DENIED` — genau der Fehler, an dem der Videoschritt am
 * 18.08. hängenblieb. Die AUFZEICHNUNG eines Streams nimmt es zwar an, aber die
 * läuft oft mehrere Stunden, und abgerechnet wird nach Videolänge: ein einziger
 * Vier-Stunden-Stream kostet mehr als ein ganzer Monat normaler Videos.
 *
 * Deshalb fliegen beide raus. `isLiveContent` steht im eingebetteten JSON der
 * Videoseite und ist bei Stream und Aufzeichnung gesetzt — der Abruf braucht
 * keinen Schlüssel und kostet nichts.
 *
 * Rein und ohne Netz prüfbar: `istLiveSeite` bekommt den fertigen HTML-Text.
 */
export function istLiveSeite(html) {
    const t = String(html || '')
    return /"isLiveContent"\s*:\s*true/.test(t)
        || /"isLiveNow"\s*:\s*true/.test(t)
        || /"liveBroadcastDetails"\s*:\s*\{/.test(t)
}

async function istLivestream(videoUrl) {
    try {
        const html = await holeText(videoUrl, { timeout: 15000 })
        return istLiveSeite(html)
    } catch (e) {
        // Nicht erreichbar heisst nicht „Livestream" — im Zweifel weitermachen
        // und Gemini entscheiden lassen. Ein 403 kostet nichts.
        logWarn('news', `Live-Prüfung ${videoUrl}: ${e.message}`)
        return false
    }
}

/** Ein 403 ist endgültig, kein Fehlversuch — erneutes Probieren ändert nichts. */
export function istEndgueltig(fehlertext) {
    return /HTTP 403|PERMISSION_DENIED/i.test(String(fehlertext || ''))
}

async function fasseVideoZusammen(videoUrl, cfg, { aufloesung = 'niedrig', tiefe = 'normal', deckel = 0 } = {}) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`
    const stufe = videoTiefeAus(tiefe, deckel)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 120000)   // Video braucht länger als Text
    try {
        // Schlüssel im Kopf, nicht in der Query: URLs landen leichter in Logs,
        // Fehlermeldungen und Proxy-Aufzeichnungen als Kopfzeilen.
        const r = await fetch(url, {
            method: 'POST',
            signal: ctrl.signal,
            headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        {
                            text: stufe.auftrag + ' '
                                + 'Nur was für die Marktlage relevant ist: Thesen, Zahlen, genannte Ereignisse. '
                                + 'Lass Eigenwerbung, Sponsoren und Aufrufe zum Abonnieren weg. '
                                + 'Keine Handelsempfehlung, keine Kursziele, keine Spekulation. '
                                + 'Wenn das Video nichts Marktrelevantes enthält, schreibe genau: OHNE INHALT',
                        },
                        { fileData: { fileUri: videoUrl } },
                    ],
                }],
                // `samplingFelder` statt fest verdrahtetem temperature: Gemini
                // nimmt das Feld zwar an, aber der Helfer ist die eine Stelle,
                // an der modellabhängige Eigenheiten gepflegt werden — hier
                // mitzulaufen kostet nichts und spart die nächste Überraschung.
                generationConfig: {
                    ...samplingFelder(cfg.model, 0.2),
                    maxOutputTokens: stufe.tokens,
                    // Der teuerste Regler im ganzen Aufbau: Standard kostet
                    // rund 300 Token je Videosekunde, niedrig rund 100.
                    mediaResolution: aufloesung === 'standard'
                        ? 'MEDIA_RESOLUTION_HIGH' : 'MEDIA_RESOLUTION_LOW',
                },
            }),
        })
        if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`)
        const j = await r.json()
        const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n').trim()
        if (!text) throw new Error('Gemini-Antwort ohne Text')
        return { text, tokens: Number(j?.usageMetadata?.totalTokenCount) || 0 }
    } finally {
        clearTimeout(timer)
    }
}

/** Gültige Themen des Berichts — Reihenfolge ist die Kapitelreihenfolge. */
const THEMEN = ['crypto', 'finanzen', 'tech', 'chartanalyse']

/** Themen-Einstellung (CSV) in eine gültige, geordnete Liste übersetzen. */
export function leseThemen(text) {
    const gewaehlt = String(text || '').split(',').map(t => t.trim()).filter(t => THEMEN.includes(t))
    return gewaehlt.length ? THEMEN.filter(t => gewaehlt.includes(t)) : ['crypto']
}

/** Umfang je Länge: Sätze der Kapitel-Lage und Punkte je Kapitel. */
const LAENGEN = {
    kurz: { lage: 'zwei bis drei Sätze', punkte: 'zwei bis drei Punkte', budgets: [2500, 5000] },
    mittel: { lage: 'vier bis sechs Sätze', punkte: 'vier bis fünf Punkte', budgets: [5000, 10000] },
    lang: { lage: 'acht bis zehn Sätze', punkte: 'sechs bis acht Punkte', budgets: [9000, 18000] },
}

/**
 * Token-Budget der Berichtsantwort — Erstversuch und Nachschlag.
 *
 * Die Werte oben sind Erfahrungswerte für ein Kapitel; bei drei Kapiteln und
 * ausgeschriebenen Absätzen liegt der Bedarf schnell woanders. Wer sparen will,
 * setzt den Deckel tiefer und nimmt kürzere Punkte in Kauf; wer alle drei
 * Themen ausführlich will, setzt ihn höher, statt am Abbruch „Antwort war
 * abgeschnitten" hängen zu bleiben.
 *
 * `budget = 0` heisst weiterhin: die Vorgabe der gewählten Länge. Der zweite
 * Versuch ist immer das Doppelte — er kostet nur Text, und ein abgebrochener
 * Lauf wirft die bereits bezahlte Videoanalyse weg.
 *
 * Rein und ohne Datenbank, damit der Selbsttest sie prüfen kann.
 */
export function budgetsAus(laenge, budget) {
    const eigen = Math.max(0, Number(budget) || 0)
    if (!eigen) return (LAENGEN[laenge] || LAENGEN.mittel).budgets
    const erst = Math.min(60000, Math.max(1000, eigen))
    return [erst, Math.min(120000, erst * 2)]
}

/** Punkte je Kapitel: eigene Zahl schlägt die Vorgabe der Länge. */
export function punkteVorgabe(laenge, anzahl) {
    const n = Math.max(0, Number(anzahl) || 0)
    if (!n) return (LAENGEN[laenge] || LAENGEN.mittel).punkte
    const k = Math.min(12, Math.max(1, n))
    return k === 1 ? 'genau einen Punkt' : `genau ${k} Punkte`
}

/**
 * Wie lang eigene Anweisungen sein dürfen.
 *
 * 2000 Zeichen sind rund 500 Token — die zahlt man bei JEDEM Lauf mit, und
 * jenseits davon fängt ein zweiter Prompt an, der mit dem ersten streitet.
 */
export const ZUSATZ_MAX = 2000

/**
 * Eigene Anweisungen des Lesers als Prompt-Block.
 *
 * Der Kasten in den Einstellungen darf den Bericht in Ton, Schwerpunkt und
 * Auswahl steuern — aber nicht die drei Dinge aushebeln, an denen seine
 * Brauchbarkeit hängt: keine Empfehlungen, nichts Erfundenes, und das
 * Antwortformat. Deshalb steht der Block VOR dem JSON-Schnittmuster und sagt
 * ausdrücklich, was er nicht kann; sonst genügt ein hingeworfenes „schreib
 * mir, was ich kaufen soll", um den Bericht in etwas zu verwandeln, das er
 * nicht sein darf.
 *
 * Die Anweisungen stehen in Klammern `<<< >>>`, damit das Modell sie als
 * Zitat erkennt und nicht als Teil der Aufgabenbeschreibung liest.
 *
 * Leer heisst leer: kein Block, kein Token, kein Verhalten geändert.
 *
 * Rein und ohne Netz, damit der Selbsttest sie prüfen kann.
 */
export function eigeneAnweisungen(zusatz) {
    const text = String(zusatz || '').trim().slice(0, ZUSATZ_MAX)
    if (!text) return ''
    return `EIGENE ANWEISUNGEN DES LESERS — sie gehen bei Ton, Schwerpunkt und Auswahl
vor, hebeln die REGELN oben aber NICHT aus:
<<<
${text}
>>>
Auch damit gilt weiter: keine Handelsempfehlungen, keine Kursziele, keine
Prognosen, nichts erfinden — und die Antwort bleibt genau das JSON unten.

`
}

/**
 * System-Prompt des Lageberichts.
 *
 * Aus der früheren Konstante wurde ein Builder: Themen, Länge und Rhythmus
 * sind jetzt einstellbar, und der Prompt muss dem Modell genau das Schnittmuster
 * vorgeben, das der Leser gewählt hat — ein Kapitel je Thema, nicht mehr.
 * Exportiert, damit der Selbsttest die Varianten ohne Netz prüfen kann.
 */
export function bauLagePrompt({ themen = ['crypto'], laenge = 'mittel', rhythmus = 'taeglich',
    punkte = 0, zusatz = '' } = {}) {
    const l = { ...(LAENGEN[laenge] || LAENGEN.mittel), punkte: punkteVorgabe(laenge, punkte) }
    const zeitraum = rhythmus === 'woechentlich' ? 'der vergangenen Woche' : 'der letzten 36 Stunden'
    const kapitelListe = themen.map(t => `- "${t}": ${THEMEN_NAMEN[t] || t}`).join('\n')
    const eigene = eigeneAnweisungen(zusatz)

    return `Du bist Marktbeobachter für einen **Krypto-Futures-Händler**.

Aus den nummerierten Beiträgen, dem Marktdaten-Block und den Rechercheergebnissen
schreibst du EINEN Lagebericht ${zeitraum} auf Deutsch — auch wenn die Quellen
englisch sind. Nicht je Beitrag eine Zusammenfassung, sondern das Gesamtbild.

Der Bericht hat GENAU diese Kapitel, in dieser Reihenfolge, mit diesen Kennungen:
${kapitelListe}
Liegt zu einem Kapitel nichts Wesentliches vor, sage das in einem Satz und lass
seine Punkteliste leer — statt etwas zu konstruieren.

${themen.includes('crypto') ? `Im Krypto-Kapitel zählt, in dieser Reihenfolge:
1. Bitcoin und Ether: Kursbewegung, Positionierung, Liquidität, ETF-Flüsse
2. Der übrige Kryptomarkt: Altcoins, DeFi, Stablecoins, Börsen, Hacks
3. Regulierung, soweit sie den Handel betrifft
Der Marktdaten-Block (Fear & Greed, Dominanz, Funding …) gehört in die Lage
dieses Kapitels — als gemessener Ist-Zustand, gegen den die Meldungen laufen.
` : ''}${themen.includes('chartanalyse') ? `Das Kapitel "chartanalyse" beruht AUSSCHLIESSLICH
auf dem Rechercheergebnis zur technischen Chartanalyse: je Coin EIN Punkt, in der
Reihenfolge der Recherche. Jeder Punkt nennt Trend, die berichteten Unterstützungen
und Widerstände als Kennzahlen und die genannten Chartmuster/Indikatoren. Du gibst
NUR wieder, was die recherchierten Analysen schreiben — keine eigene Chartdeutung,
und Beiträge aus den News-Quellen gehören nicht in dieses Kapitel.
` : ''}REGELN:
- Keine Handelsempfehlungen, keine Kursziele, keine Prognosen.
- Nichts erfinden. Was nicht in den Quellen steht, steht nicht im Bericht.
- Eigenwerbung, Sponsoren, Clickbait und reine Meinungsmache lässt du weg.
- Zahlen nennen, wenn welche dastehen — sie sind das Überprüfbare.
- Jedes Thema gehört in SEIN Kapitel; was in keins passt, bleibt draussen.

UMFANG je Kapitel: eine Lage von ${l.lage} und ${l.punkte}. Jeder Punkt ist ein
ausgeschriebener Absatz von drei bis fünf Sätzen — was geschehen ist, welche
Zahlen dazu genannt werden und wie es zusammenhängt. Sagen zwei Quellen
dasselbe, schreibe EINEN Punkt und nenne beide Belege.

LAGEBILD: Zusätzlich wägst du ab, was die Lage STÜTZT ("dafuer"), was sie
BELASTET ("dagegen") und WORAN SIE SICH ENTSCHEIDET ("offen"). Je zwei bis vier
Einträge, jeder ein Satz. "offen" nennt beobachtbare Bedingungen — was man in
den nächsten Stunden oder Tagen sehen wird, das die Frage beantwortet. KEINE
Richtung, kein Kursziel, kein Einstieg, keine Empfehlung; „ob die ETF-Abflüsse
enden" ist erlaubt, „über 66.000 kaufen" nicht.
Jeder Eintrag trägt "art": "fakt" NUR, wenn der Satz eine gemessene oder in den
Quellen genannte Tatsache wiedergibt — alles Gedeutete, Verknüpfte, Gewichtete
ist "einschaetzung". Im Zweifel "einschaetzung": eine als Fakt ausgegebene
Meinung ist der teuerste Fehler in diesem Bericht.

${eigene}Antworte NUR mit JSON:
{"ueberschrift": "Schlagzeile über alles",
 "lage": "zwei bis vier Sätze Gesamtbild über alle Kapitel",
 "lagebild": {"dafuer": [{"art": "fakt", "text": "ein Satz"}],
              "dagegen": [{"art": "einschaetzung", "text": "ein Satz"}],
              "offen": [{"art": "einschaetzung", "text": "ein Satz"}]},
 "kapitel": [{"thema": "crypto",
              "ueberschrift": "Kapitel-Schlagzeile",
              "lage": "${l.lage}",
              "punkte": [{"titel": "...", "text": "drei bis fünf Sätze", "quelle": "...",
                          "wichtigkeit": "hoch|mittel",
                          "kennzahlen": [{"wert": "-29.000 BTC", "was": "Apparent Demand"}],
                          "belege": [1, 4]}]}]}

"belege" enthält die Nummern der Beiträge oder Recherche-Quellen, auf denen der
Punkt beruht — daran kann der Leser nachschlagen, woher es kommt.
"kennzahlen" sind bis zu drei Zahlen, die WÖRTLICH in den Quellen stehen —
Kurse, Flüsse, Quoten, Fristen. Steht keine Zahl da, lass die Liste leer;
erfundene oder gerundete Zahlen sind schlimmer als gar keine.`
}

/**
 * Das Lagebild des Modells in eine verlässliche Form bringen.
 *
 * Drei Listen — was stützt, was belastet, woran es sich entscheidet — mit je
 * einer Marke „Fakt" oder „Einschätzung". Die Marke ist der Punkt der ganzen
 * Übung: Ein Bericht, der Gemessenes und Gedeutetes im selben Absatz mischt,
 * lässt sich nicht prüfen. Deshalb ist der Rückfall hier immer
 * `einschaetzung` — eine als Fakt ausgegebene Meinung wäre der teuerste
 * Fehler, den dieser Bericht machen kann, und ein vergessenes Feld darf ihn
 * nicht herbeiführen.
 *
 * Gibt `null` zurück, wenn nichts Brauchbares dabei war (auch der Normalfall
 * für Berichte aus der Zeit vor dem Lagebild) — dann zeigt die Oberfläche den
 * Kasten gar nicht erst.
 *
 * Rein und ohne Netz, damit der Selbsttest sie prüfen kann.
 */
export function leseLagebild(roh) {
    const teil = (liste) => (Array.isArray(liste) ? liste : [])
        // Manche Modelle liefern statt {art,text} nur den nackten Satz
        .map(e => (typeof e === 'string' ? { art: '', text: e } : e))
        .filter(e => e && typeof e === 'object' && String(e.text || '').trim())
        .slice(0, 5)
        .map(e => ({
            art: /^fakt/i.test(String(e.art || '').trim()) ? 'fakt' : 'einschaetzung',
            text: String(e.text).trim().slice(0, 400),
        }))
    const lb = roh && typeof roh === 'object' ? roh : {}
    const gebaut = { dafuer: teil(lb.dafuer), dagegen: teil(lb.dagegen), offen: teil(lb.offen) }
    return (gebaut.dafuer.length || gebaut.dagegen.length || gebaut.offen.length) ? gebaut : null
}

/**
 * Ist-Zustand des Markts — als Zeilen für den Prompt UND als Tabelle für die Anzeige.
 *
 * Alles aus den eigenen Radar-Funktionen — die laufen über `ausCache`, ein
 * Berichtslauf löst also keine zusätzlichen Fremdabrufe aus. Jeder Wert in
 * seinem eigenen try/catch: ein ausgefallener Feed darf höchstens eine Zeile
 * kosten, nie den Bericht.
 *
 * Die Werte werden zusätzlich strukturiert zurückgegeben und mit dem Bericht
 * gespeichert. Grund: Die Dossier-Ansicht zeigt sie als Tabelle, und ein
 * gespeicherter Bericht muss den Marktstand von DAMALS zeigen — die Kacheln
 * des Marktradars zeigen den von jetzt, und beides nebeneinander wäre eine
 * stille Lüge.
 *
 * `skala` (0–100) tragen nur die Werte, die tatsächlich eine feste Spanne
 * haben; daraus zeichnet die Anzeige einen Balken. Erfunden wird keine.
 */
async function holeMarktdatenBlock() {
    const werte = []
    try {
        const f = await holeFearGreed(35)
        werte.push({
            was: 'Fear & Greed', wert: `${f.aktuell.wert} (${f.aktuell.klasse})`,
            zusatz: `30-Tage-Mittel ${f.mittel30}`, skala: Number(f.aktuell.wert),
        })
    } catch (e) { logWarn('news', `Marktdaten Fear&Greed: ${e.message}`) }
    try {
        const g = await holeGlobal()
        werte.push({
            was: 'BTC-Dominanz', wert: `${g.pct} %`,
            zusatz: g.mcapUsd ? `Gesamtmarkt ${(g.mcapUsd / 1e12).toFixed(2)} Bio. USD` : '',
            skala: Number(g.pct),
        })
    } catch (e) { logWarn('news', `Marktdaten Dominanz: ${e.message}`) }
    try {
        const fu = await holeFunding(30)
        const fmt = r => `${r.symbol} ${(r.rate * 100).toFixed(3)} %`
        if (fu.oben?.length || fu.unten?.length) {
            werte.push({
                was: 'Funding-Extreme (8h)',
                wert: `oben ${fu.oben.slice(0, 3).map(fmt).join(', ') || '—'}`,
                zusatz: `unten ${fu.unten.slice(0, 3).map(fmt).join(', ') || '—'}`,
            })
        }
    } catch (e) { logWarn('news', `Marktdaten Funding: ${e.message}`) }
    try {
        const ls = await holeLsOi('BTCUSDT', 48)
        const p = ls.punkte?.[ls.punkte.length - 1]
        if (p) {
            werte.push({
                was: 'BTC Long/Short-Konten', wert: `${p.longPct} % long / ${p.shortPct} % short`,
                zusatz: [
                    ls.oiDelta !== null && ls.oiDelta !== undefined
                        ? `Open Interest 24h ${ls.oiDelta > 0 ? '+' : ''}${Number(ls.oiDelta).toFixed(1)} %` : '',
                    ls.deutung && ls.deutung !== 'neutral' ? ls.deutung : '',
                ].filter(Boolean).join(', '),
                skala: Number(p.longPct),
            })
        }
    } catch (e) { logWarn('news', `Marktdaten Long/Short: ${e.message}`) }
    try {
        const a = await holeAltseason(90)
        if (a.index !== null) {
            werte.push({
                was: 'Altcoin-Season-Index (90 T)', wert: String(a.index),
                zusatz: a.lage === 'altcoin' ? 'Altcoin-Saison'
                    : a.lage === 'bitcoin' ? 'Bitcoin-Saison' : 'gemischt',
                skala: Number(a.index),
            })
        }
    } catch (e) { logWarn('news', `Marktdaten Altseason: ${e.message}`) }

    const text = werte.length
        ? 'MARKTDATEN (eigene Messung, Stand jetzt):\n'
        + werte.map(w => `- ${w.was}: ${w.wert}${w.zusatz ? ' — ' + w.zusatz : ''}`).join('\n')
        : ''
    return { text, werte }
}

/** Anspruchs-Schlüssel: der Tageslauf und die Bremse für den Knopf. */
export const BERICHT_SCHLUESSEL = 'news_lagebericht'
export const BERICHT_MANUELL = 'news_lagebericht_manuell'
/** Nach einem echten Fehlschlag frühestens so bald wieder versuchen. */
const WIEDERHOLUNG_MS = 60 * 60 * 1000

/**
 * Beginn des laufenden Tages in der Zeitzone des Journals, als Zeitstempel.
 *
 * Gerechnet wird über den Abstand zu Mitternacht, weil sich `Date` sonst nicht
 * ohne Bibliothek in eine fremde Zeitzone versetzen lässt. An Tagen mit
 * Zeitumstellung liegt die Grenze deshalb um eine Stunde daneben — für die
 * Frage „lief heute schon einer" ist das folgenlos.
 */
export function tagesbeginn(jetzt = Date.now(), zeitzone = '') {
    const lokal = zeitzone
        ? new Date(new Date(jetzt).toLocaleString('en-US', { timeZone: zeitzone }))
        : new Date(jetzt)
    const seitMitternacht = lokal.getHours() * 3600000 + lokal.getMinutes() * 60000
        + lokal.getSeconds() * 1000
    return jetzt - seitMitternacht
}

/**
 * Ist die Zeit für den Bericht gekommen?
 *
 * Bewusst „Stunde erreicht ODER überschritten" statt exakter Treffer: Der Takt
 * schaut nur alle zehn Minuten nach, und ein Neustart um 12:55 hat die Stunde
 * früher komplett verschluckt — der Bericht fiel dann still aus. Zusammen mit
 * dem Tages-Anspruch heisst „überschritten" nicht „mehrfach", sondern
 * „notfalls später nachgeholt".
 *
 * Rein und ohne Datenbank, damit der Selbsttest sie prüfen kann.
 *
 * @param {{jetztLokal: Date, stunde: number, rhythmus?: string, wochentag?: number}} opt
 */
export function sollBerichtLaufen({ jetztLokal, stunde, rhythmus = 'taeglich', wochentag = 1 }) {
    const soll = Math.max(0, Math.min(23, Number(stunde) || 0))
    if (jetztLokal.getHours() < soll) return false
    if (rhythmus !== 'woechentlich') return true
    // 1 = Montag … 7 = Sonntag, wie die Auswahl in den Einstellungen
    const heute = ((jetztLokal.getDay() + 6) % 7) + 1
    return heute === Math.max(1, Math.min(7, Number(wochentag) || 1))
}

/**
 * Lagebericht erzeugen — Anspruch, Ergebnisvermerk und Wiederholung.
 *
 * Die eigentliche Arbeit steckt in `baueLagebericht`; hier steht nur, wer
 * laufen darf und was ein Ergebnis für den nächsten Lauf bedeutet:
 *
 *   gelungen            → der Tag ist erledigt
 *   nichts zu berichten → Anspruch sofort zurück (kein verbrannter Tag)
 *   echter Fehler       → vermerkt, Wiederholung nach einer Stunde
 *
 * Vorher wurde der Anspruch vor der Arbeit gestempelt und nie zurückgegeben:
 * ein gescheiterter Lauf sperrte volle 20 Stunden, und niemand erfuhr davon.
 */
export async function erzeugeLagebericht({ manuell = false } = {}) {
    const knex = getKnex()
    const s = await knex('settings').where('id', 1).first()

    if (manuell) {
        // Nur eine Bremse gegen Doppelklicks — ein Bericht von Hand darf den
        // automatischen NICHT blockieren, deshalb ein eigener Schlüssel.
        if (!(await beansprucheAufgabe(BERICHT_MANUELL, 5 * 60 * 1000))) return { uebersprungen: true }
    } else if (!(await beansprucheTagesaufgabe(BERICHT_SCHLUESSEL, {
        tagesbeginn: tagesbeginn(Date.now(), s?.timeZone),
        wiederholungMs: WIEDERHOLUNG_MS,
    }))) {
        return { uebersprungen: true }
    }

    try {
        const ergebnis = await baueLagebericht(s, { manuell })
        const nach = anspruchsNachlauf({ manuell, ohneInhalt: !!ergebnis?.fehler })
        if (nach.freigeben) await gibAufgabeFrei(nach.freigeben)
        if (nach.stempeln) await stempleAufgabe(nach.stempeln)
        return ergebnis
    } catch (e) {
        const nach = anspruchsNachlauf({ manuell, geworfen: true })
        await merkeAufgabenFehler(nach.fehlerAn, e.message)
        logWarn('news', `Lagebericht gescheitert: ${e.message}`)
        throw e
    }
}

/**
 * Was ein beendeter Lauf am Anspruch hinterlässt.
 *
 * Der Grundsatz steht eine Ebene höher schon als Kommentar — „ein Bericht von
 * Hand darf den automatischen NICHT blockieren" —, wurde hier aber gebrochen:
 * der Stempel ging bei JEDEM gelungenen Lauf auf den Tages-Schlüssel, also
 * auch beim Knopfdruck. Wer morgens von Hand einen Bericht erzeugte, bekam am
 * Mittag keinen mehr, ohne Meldung und ohne erkennbaren Grund (gesehen am
 * 19.08.2026: Lauf von Hand um 06:18, Mittagslauf still übersprungen).
 * Dasselbe galt für den Fehlervermerk — ein gescheiterter Handlauf schrieb
 * ihn auf den Tages-Schlüssel und erlaubte damit sogar einen Lauf zu viel.
 *
 * Die Regel als reine Funktion, damit sie ohne Datenbank prüfbar ist:
 *
 *   gelungen, automatisch → Tag erledigt (stempeln)
 *   gelungen, von Hand    → nichts; der Mittagslauf ist davon unberührt
 *   nichts zu berichten   → eigenen Anspruch zurück, kein verbrannter Tag
 *   echter Fehler         → Vermerk am EIGENEN Schlüssel
 *
 * @returns {{freigeben: string|null, stempeln: string|null, fehlerAn: string|null}}
 */
export function anspruchsNachlauf({ manuell = false, ohneInhalt = false, geworfen = false } = {}) {
    const eigener = manuell ? BERICHT_MANUELL : BERICHT_SCHLUESSEL
    if (geworfen) return { freigeben: null, stempeln: null, fehlerAn: eigener }
    if (ohneInhalt) return { freigeben: eigener, stempeln: null, fehlerAn: null }
    return { freigeben: null, stempeln: manuell ? null : BERICHT_SCHLUESSEL, fehlerAn: null }
}

/**
 * Der Bericht selbst.
 *
 * Zwei Anbieter, bewusst getrennt: der Bericht entsteht beim EINGESTELLTEN
 * Anbieter (Claude), die Videos gehen vorher an Gemini. Fällt Gemini aus,
 * entsteht der Bericht trotzdem — nur eben ohne Videoinhalte.
 */
async function baueLagebericht(s, { manuell = false } = {}) {
    const knex = getKnex()
    const filterAn = Number(s?.radarArschlochfilter ?? 1) === 1

    const quellenListe = await knex('news_sources').select('id', 'name', 'art', 'laerm')
    const erlaubt = quellenListe.filter(q => !filterAn || Number(q.laerm) !== 1)
    const nachId = new Map(quellenListe.map(q => [q.id, q]))
    if (!erlaubt.length) return { fehler: 'Keine Quellen freigegeben' }

    // Zuschnitt des Berichts: Rhythmus bestimmt Fenster und Beitragsmenge,
    // Themen die Kapitel, Länge den Umfang je Kapitel.
    const rhythmus = s?.radarNewsRhythmus === 'woechentlich' ? 'woechentlich' : 'taeglich'
    const laenge = ['kurz', 'mittel', 'lang'].includes(s?.radarNewsLaenge) ? s.radarNewsLaenge : 'mittel'
    const themen = leseThemen(s?.radarNewsThemen)
    const fensterMs = rhythmus === 'woechentlich' ? 7 * TAG : 36 * 60 * 60 * 1000
    const zeitraumText = rhythmus === 'woechentlich' ? '7 Tage' : '36 Stunden'

    const seit = Date.now() - fensterMs
    let beitraege = await knex('news_items')
        .whereIn('sourceId', erlaubt.map(q => q.id))
        .where('publishedAt', '>=', seit)
        .orderBy('publishedAt', 'desc')
        /*
         * 60 statt 30 für den Tagesbericht.
         *
         * Die 30 stammen aus der Zeit vor den grossen Nachrichtenfeeds (CNBC,
         * Investing, Ars Technica, TechCrunch, The Verge, Hacker News). Mit
         * denen reichten 30 Beiträge nur noch rund DREI Stunden zurück — der
         * „Tagesbericht" war faktisch ein Drei-Stunden-Bericht und bestand
         * überwiegend aus dem, was gerade am lautesten getickert hat.
         */
        .limit(rhythmus === 'woechentlich' ? 80 : 60)

    // Arschlochfilter: wirkt auf die Berichtsgrundlage, nicht auf den Bestand —
    // die Beiträge bleiben gespeichert, eine geänderte Wörterliste greift
    // rückwirkend.
    if (Number(s?.radarArschlochAn ?? 1) === 1) {
        const woerter = zerlegeWoerter(s?.radarArschlochWoerter)
        const vorher = beitraege.length
        beitraege = beitraege.filter(b => !istGefiltert(b, woerter, nachId.get(b.sourceId)))
        if (vorher !== beitraege.length) {
            console.log(` -> Lagebericht: Arschlochfilter hat ${vorher - beitraege.length} Beitrag/Beiträge aussortiert`)
        }
    }
    if (!beitraege.length) return { fehler: `Keine Beiträge der letzten ${zeitraumText}` }

    // ── Schritt 1: Videos ansehen (Gemini, eigener Schlüssel) ────────────
    let videosGesehen = 0
    let geminiFehler = ''
    /** Was mit jedem angefassten Video geschah — inklusive Token und Kosten. */
    const videoLog = []
    /** Die in DIESEM Lauf analysierten Videobeiträge — kommen unten in `beitraege`. */
    const videoAnalysiert = []
    const maxVideos = Math.max(0, Math.min(10, Number(s?.radarNewsVideos ?? 3)))
    if (maxVideos > 0) {
        try {
            const geminiCfg = await ladeLlmConfig({
                provider: 'gemini',
                model: s?.radarNewsModel || 'gemini-3.5-flash-lite',
            })
            if (!geminiCfg.apiKey) throw new Error('Kein Gemini-Schlüssel hinterlegt')

            /*
             * Auch Fehlversuche kommen wieder dran — bis zu dreimal.
             *
             * Vorher galt nur `status === 'neu'`, und das hat sich gerächt:
             * ein einziger Ausfall (ein abgekündigtes Modell, eine
             * Zeitüberschreitung) hat das Video dauerhaft aussortiert. Es kam
             * nie wieder, auch nachdem die Ursache behoben war — der Bericht
             * meldete stumm „0 Videos angesehen".
             */
            /*
             * Videos werden EIGENS geholt, nicht aus `beitraege` gefischt.
             *
             * Vorher standen sie unter denselben 30 neuesten Beiträgen wie der
             * Text — und seit die grossen Nachrichtenfeeds dazukamen, reichen
             * 30 Beiträge nur noch rund drei Stunden zurück. Videos sind fast
             * immer älter als das. Folge: NIE wieder ein Video im Bericht, ohne
             * jede Fehlermeldung, weil gar nichts erst versucht wurde.
             *
             * Jetzt zählt für Videos allein das Zeitfenster. Was analysiert
             * wird, kommt unten zusätzlich in die Berichtsgrundlage — sonst
             * hätte man den Inhalt bezahlt und nicht verwendet.
             */
            const videoKandidaten = (await knex('news_items')
                .whereIn('sourceId', erlaubt.filter(q => q.art === 'youtube'
                    && Number(q.videoAnalyse ?? 1) === 1).map(q => q.id))
                .where('publishedAt', '>=', seit)
                .orderBy('publishedAt', 'desc')
                .limit(maxVideos * 4))     // Luft für Livestreams, die wir überspringen
                .filter(b => (b.status === 'neu' || (b.status === 'fehler' && Number(b.versuche || 0) < 3))
                    && /youtube\.com|youtu\.be/.test(b.url))

            const videos = []
            for (const v of videoKandidaten) {
                if (videos.length >= maxVideos) break
                // Livestreams gar nicht erst anfassen: laufende lehnt Gemini ab,
                // Aufzeichnungen kosten nach Länge ein Vermögen. Bewusst OHNE
                // videoLog-Eintrag — sie sollen in der Videoliste des Berichts
                // gar nicht erst auftauchen (Nutzerwunsch), nur die DB merkt
                // sich das Überspringen gegen erneute Prüfungen.
                if (await istLivestream(v.url)) {
                    await knex('news_items').where('id', v.id).update({
                        status: 'uebersprungen', fehler: 'Livestream — nicht analysiert',
                    })
                    continue
                }
                videos.push(v)
            }

            for (const v of videos) {
                try {
                    const { text, tokens } = await fasseVideoZusammen(v.url, geminiCfg, {
                        aufloesung: s?.radarNewsAufloesung || 'niedrig',
                        tiefe: s?.radarNewsVideoTiefe || 'normal',
                        deckel: s?.radarNewsVideoTokens,
                    })
                    await knex('news_items').where('id', v.id).update({
                        zusammenfassung: istOhneInhalt(text) ? '' : text,
                        aiModel: geminiCfg.model, aiStand: Date.now(), tokens,
                        status: 'zusammengefasst', fehler: '',
                    })
                    v.zusammenfassung = istOhneInhalt(text) ? '' : text
                    if (v.zusammenfassung) videoAnalysiert.push(v)
                    videosGesehen++
                    /*
                     * Video ist fast nur Eingabe: die Bildspur zählt als
                     * Eingabe-Token, die Antwort sind ein paar Stichpunkte.
                     * Deshalb alles als Eingabe rechnen und die Ausgabe mit 0
                     * ansetzen. Der Preis kommt aus der zentralen Liste statt
                     * als feste Zahl — hier stand `0.30`, was zufällig dem
                     * Eingabepreis von `gemini-3.5-flash-lite` entspricht und
                     * bei jedem anderen eingestellten Modell falsch war.
                     */
                    const videoKosten = Math.round(schaetzeKosten(geminiCfg.model, tokens, 0) * 10000) / 10000
                    merkeVerbrauch({
                        funktion: 'video',
                        ausloeser: manuell ? 'manuell' : 'auto',
                        provider: geminiCfg.provider,
                        modell: geminiCfg.model,
                        usage: { promptTokens: tokens, completionTokens: 0, totalTokens: tokens },
                        kostenUsd: videoKosten,
                        bezug: { typ: 'video', id: v.id },
                    })
                    videoLog.push({
                        titel: v.titel, url: v.url,
                        quelle: nachId.get(v.sourceId)?.name || '',
                        tokens,
                        kostenUsd: videoKosten,
                        ergebnis: istOhneInhalt(text) ? 'ohne Inhalt' : 'ok',
                        // Die Beschreibung SELBST — bisher wurde sie nur in
                        // `news_items` abgelegt und war im Bericht nirgends zu
                        // sehen: Titel, Preis und ein Haken, aber nicht das,
                        // wofür bezahlt wurde. Ohne dieses Feld hat die
                        // Videokachel nichts anzuzeigen.
                        text: istOhneInhalt(text) ? '' : text,
                    })
                } catch (e) {
                    // Ein 403 ist keine Panne, sondern ein Nein: dieses Video
                    // wird das Modell nie ansehen. Als Fehlversuch gezählt käme
                    // es zweimal wieder und verbrennte jedes Mal einen der drei
                    // Plätze — vor einem Video, das funktioniert hätte.
                    const endgueltig = istEndgueltig(e.message)
                    await knex('news_items').where('id', v.id).update({
                        status: endgueltig ? 'uebersprungen' : 'fehler',
                        fehler: String(e.message).slice(0, 300),
                        versuche: Number(v.versuche || 0) + 1,
                    })
                    if (istGuthabenFehler(e.message)) await merkeKiGuthaben('gemini', e.message)
                    logWarn('news', `Video ${v.url}: ${e.message}`)
                    geminiFehler = e.message
                    videoLog.push({
                        titel: v.titel, url: v.url,
                        quelle: nachId.get(v.sourceId)?.name || '',
                        tokens: 0, kostenUsd: 0,
                        ergebnis: 'Fehler', fehler: String(e.message).slice(0, 200),
                    })
                }
            }
        } catch (e) {
            // Ohne Gemini geht es weiter — nur ohne Videoinhalte
            geminiFehler = e.message
            logWarn('news', `Videoschritt übersprungen: ${e.message}`)
        }
    }

    /*
     * Vor dem Schreiben: festhalten, welche Videoinhalte tatsächlich in den
     * Bericht eingehen — nicht nur die, die in DIESEM Lauf analysiert wurden.
     *
     * Der Unterschied ist wichtig und war vorher unsichtbar: Eine gestern
     * bezahlte Zusammenfassung fliesst heute weiter ein, kostet aber nichts
     * mehr. Der Bericht meldete trotzdem „0 Videos angesehen" — und liess so
     * aussehen, als sei der Videoinhalt gar nicht drin. Jetzt steht beides da:
     * neu analysiert (mit Preis) und übernommen (gratis).
     */
    /*
     * Die eben analysierten Videos gehören in die Berichtsgrundlage.
     *
     * Sie wurden ausserhalb des Beitragsdeckels geholt, stehen also nicht
     * automatisch in `beitraege` — ohne diesen Schritt hätte man die
     * Videoanalyse bezahlt und dem Modell dann vorenthalten.
     */
    for (const v of videoAnalysiert) {
        if (!v.zusammenfassung) continue
        if (beitraege.some(b => b.id === v.id)) continue
        beitraege.push(v)
    }

    for (const b of beitraege) {
        if (!b.zusammenfassung) continue
        if (videoLog.some(v => v.url === b.url)) continue
        videoLog.push({
            titel: b.titel, url: b.url,
            quelle: nachId.get(b.sourceId)?.name || '',
            tokens: 0, kostenUsd: 0, ergebnis: 'übernommen',
            text: b.zusammenfassung,
        })
    }
    const videosVerwendet = videoLog.filter(v => v.ergebnis === 'ok' || v.ergebnis === 'übernommen').length

    // ── Schritt 1b: Themen-Recherche (Perplexity, eigener Schlüssel) ─────
    // Eine Suchfrage je gewähltem Thema. Ohne Schlüssel entfällt der Schritt
    // still — der Bericht entsteht dann allein aus den eigenen Quellen.
    const recherchen = []          // {thema, text}
    let rechercheKostenUsd = 0
    let rechercheTokens = 0
    const rechercheZitate = []     // werden hinter den Beiträgen durchnummeriert
    let taBilder = []              // Chart-Grafiken aus den Analyse-Artikeln (Perplexity-Bilder)
    try {
        const pCfg = await ladeLlmConfig({ provider: 'perplexity' })
        if (pCfg.apiKey) {
            for (const thema of themen) {
                try {
                    // Chartanalyse: eigene Frage mit den ECHTEN Top 5 nach
                    // Marktkapitalisierung (holeMarkt filtert Stablecoins und
                    // tokenisierte Realwerte bereits raus) und der Bitte um die
                    // Bilder der gefundenen Analysen. Wir tragen zusammen, was
                    // Analysten publizieren — gerechnet wird hier nichts.
                    let extra = {}
                    if (thema === 'chartanalyse') {
                        let coins = ['Bitcoin', 'Ethereum', 'XRP', 'BNB', 'Solana']  // Rückfall
                        try {
                            const m = await holeMarkt(5)
                            if (m?.muenzen?.length >= 3) coins = m.muenzen.map(c => `${c.name} (${c.symbol})`)
                        } catch (e) { logWarn('news', `Top-5 für Chartanalyse nicht abrufbar: ${e.message}`) }
                        extra = {
                            mitBildern: true,
                            frage: `Wie lautet die aktuelle technische Chartanalyse für ${coins.join(', ')} `
                                + 'laut Analysten und Fachmedien? Je Coin: Trend, wichtige Unterstützungen und '
                                + 'Widerstände mit konkreten Kursmarken, auffällige Chartmuster und Indikatoren — '
                                + 'so, wie sie in aktuellen veröffentlichten Analysen genannt werden, mit Quellenbezug. '
                                + 'Nüchtern und faktisch. Keine eigene Analyse, keine Anlageberatung, keine Kursziele '
                                + 'ohne Quelle.',
                        }
                    }
                    const r = await rechercheThema({
                        thema, zeitraumText, apiKey: pCfg.apiKey,
                        modell: s?.radarNewsRechercheModell || undefined,
                        ...extra,
                    })
                    if (thema === 'chartanalyse' && r.bilder?.length) taBilder = r.bilder
                    if (r.text) {
                        recherchen.push({ thema, text: r.text })
                        for (const url of r.citations.slice(0, 8)) {
                            rechercheZitate.push({
                                titel: url.replace(/^https?:\/\//, '').slice(0, 200),
                                url, quelle: 'Perplexity-Recherche', art: 'rss', bild: '',
                            })
                        }
                    }
                    rechercheKostenUsd += r.kostenUsd
                    rechercheTokens += r.tokens
                    merkeKiGuthaben('perplexity').catch(() => { })
                } catch (e) {
                    if (istGuthabenFehler(e.message)) await merkeKiGuthaben('perplexity', e.message)
                    logWarn('news', `Recherche ${thema}: ${e.message}`)
                }
            }
        }
    } catch (e) {
        logWarn('news', `Recherche übersprungen: ${e.message}`)
    }

    // ── Schritt 1c: Marktdaten aus dem eigenen Radar ─────────────────────
    const marktdaten = await holeMarktdatenBlock().catch(() => ({ text: '', werte: [] }))

    // ── Schritt 2: Bericht schreiben (eingestellter Anbieter = Claude) ───
    // Durchnummeriert, damit das Modell seine Belege benennen kann. Die
    // Recherche-Zitate hängen hinter den Beiträgen in derselben Nummernreihe —
    // ein Beleg ist ein Beleg, egal woher er stammt.
    const zeilen = beitraege.map((b, i) => {
        const q = nachId.get(b.sourceId)
        const inhalt = b.zusammenfassung || (b.inhalt || '').slice(0, 600)
        return `[${i + 1}] [${new Date(Number(b.publishedAt)).toISOString().slice(0, 16)}] ${b.titel}\n`
            + `Quelle: ${q?.name || '?'} (${q?.art || 'rss'})${b.zusammenfassung ? ' — Videoinhalt, von Gemini angesehen' : ''}\n`
            + `${inhalt}\n`
    })
    for (const [j, z] of rechercheZitate.entries()) {
        zeilen.push(`[${beitraege.length + j + 1}] Recherche-Quelle: ${z.url}\n`)
    }
    const teile = []
    if (marktdaten.text) teile.push(marktdaten.text)
    for (const r of recherchen) {
        teile.push(`RECHERCHE zum Thema ${THEMEN_NAMEN[r.thema] || r.thema} `
            + `(Perplexity, Belege siehe nummerierte Recherche-Quellen):\n${r.text}`)
    }
    teile.push('BEITRÄGE:\n' + zeilen.join('\n---\n'))

    // Eigene Modellwahl für den Bericht; leer heisst: der allgemein
    // eingestellte Anbieter des Journals
    const cfg = await ladeLlmConfig({
        provider: s?.radarNewsBerichtProvider || undefined,
        model: s?.radarNewsBerichtModell || undefined,
    })
    /*
     * Token-Budget für die Antwort.
     *
     * Der Standardwert aus `ladeLlmConfig` ist auf kurze JSON-Antworten
     * ausgelegt und war hier zu knapp: Ein Bericht mit acht Punkten, Belegen
     * und Begründungen läuft darüber, das JSON bricht mitten im Satz ab — und
     * dann ist der ganze Lauf verloren, obwohl die teure Videoanalyse längst
     * bezahlt ist. Deshalb grosszügig ansetzen und bei einem Abbruch EINMAL
     * mit doppeltem Budget nachlegen. Der zweite Versuch kostet nur Text.
     *
     * Seit die Punkte ausgeschriebene Absätze sind (drei bis fünf Sätze statt
     * einer Zeile), braucht schon der erste Anlauf mehr Luft: neun solche
     * Punkte mit Kennzahlen und Belegen sind rund das Dreifache des alten
     * Umfangs. Ausgabe-Token kosten hier wenige Rappen — ein abgebrochener
     * Lauf kostet den ganzen Bericht.
     */
    const budgets = budgetsAus(laenge, s?.radarNewsTokenBudget)
    const system = bauLagePrompt({
        themen, laenge, rhythmus,
        punkte: s?.radarNewsPunkte,
        zusatz: s?.radarNewsPromptZusatz,
    })
    let antwort = null
    for (const budget of budgets) {
        cfg.maxTokens = budget
        antwort = await callLLMJson(cfg, {
            system,
            user: teile.join('\n\n'),
            timeoutMs: 180000,
            // Jeder Anlauf wird verbucht: ein abgeschnittener Bericht ist
            // wertlos, bezahlt ist er trotzdem.
            zweck: 'lagebericht',
            ausloeser: manuell ? 'manuell' : 'auto',
        })
        if (!antwort.abgeschnitten && antwort.json) break
        logWarn('news', `Bericht mit ${budget} Token abgeschnitten — `
            + `${budget === budgets[budgets.length - 1] ? 'gebe auf' : 'wiederhole mit mehr Budget'}`)
    }
    const daten = antwort.json
    if (!daten || (!Array.isArray(daten.kapitel) && !Array.isArray(daten.punkte))) {
        // Lieber ehrlich scheitern als einen leeren Bericht speichern, der
        // aussieht, als hätte es heute nichts gegeben
        throw new Error(antwort.abgeschnitten
            ? 'Antwort war abgeschnitten (Token-Budget zu klein)'
            : 'Modell lieferte kein verwertbares JSON')
    }
    const tokens = (antwort.usage?.totalTokens || 0) + rechercheTokens

    // Belegnummern in echte Verweise auflösen: erst die Beiträge, dahinter die
    // Recherche-Zitate — dieselbe Nummernreihe wie im Prompt. Erst dadurch ist
    // der Bericht nachprüfbar statt nur behauptet.
    const belegBasis = [
        ...beitraege.map(b => ({
            titel: b.titel,
            url: b.url,
            quelle: nachId.get(b.sourceId)?.name || '',
            art: nachId.get(b.sourceId)?.art || 'rss',
            // Das Vorschaubild des Belegs — daraus nimmt die Karte ihr
            // Bild. Geteilte Charts und Börsen-Screenshots kommen so
            // in den Bericht, ohne dass etwas erzeugt werden müsste.
            bild: b.bild || '',
        })),
        ...rechercheZitate,
    ]
    const loesePunkte = (punkte, thema) => (Array.isArray(punkte) ? punkte : []).map(p => ({
        ...p,
        ...(thema ? { thema } : {}),
        belege: (Array.isArray(p.belege) ? p.belege : [])
            .map(nr => belegBasis[Number(nr) - 1])
            .filter(Boolean),
    }))

    // Kapitel wie geliefert übernehmen; `punkte` bleibt zusätzlich als flache
    // Liste bestehen — Kacheln, Overlay und ältere Leser kennen nur sie.
    const kapitel = (Array.isArray(daten?.kapitel) ? daten.kapitel : [])
        .filter(k => k && typeof k === 'object')
        .slice(0, THEMEN.length)
        .map(k => ({
            thema: THEMEN.includes(k.thema) ? k.thema : String(k.thema || '').slice(0, 30),
            ueberschrift: String(k.ueberschrift || '').slice(0, 300),
            lage: String(k.lage || '').slice(0, 4000),
            punkte: loesePunkte(k.punkte, THEMEN.includes(k.thema) ? k.thema : ''),
        }))
    // Chart-Grafiken der recherchierten Analysen ans Chartanalyse-Kapitel
    // hängen — sie wandern mit dem Kapitel-JSON in die Datenbank und werden
    // in der Zeitungsansicht als Bilderleiste gezeigt.
    if (taBilder.length) {
        const kTa = kapitel.find(k => k.thema === 'chartanalyse')
        if (kTa) kTa.bilder = taBilder.slice(0, 8)
    }
    const flachePunkte = kapitel.length
        ? kapitel.flatMap(k => k.punkte).slice(0, 24)
        : loesePunkte(daten?.punkte).slice(0, 12)   // Rückfall: Modell ohne Kapitel

    // Abwägung „dafür/dagegen/offen" — null, wenn das Modell nichts lieferte
    const abwaegung = leseLagebild(daten?.lagebild)

    const kostenUsd = (Number(antwort.costUsd) || 0) + rechercheKostenUsd + letzteXKostenUsd
    letzteXKostenUsd = 0   // abgeholt — nicht doppelt verbuchen

    const zeile = {
        erstelltAm: Date.now(),
        provider: cfg.provider,
        modell: cfg.model,
        ueberschrift: String(daten?.ueberschrift || '').slice(0, 300),
        lage: String(daten?.lage || '').slice(0, 4000),
        punkte: JSON.stringify(flachePunkte),
        kapitel: JSON.stringify(kapitel),
        themen: themen.join(','),
        laenge,
        beitraege: beitraege.length,
        videos: videosVerwendet,
        videosNeu: videosGesehen,
        tokens,
        // schaetzeKosten() aus llm.js kennt die Preistabelle je Modell;
        // dazu kommen Perplexity-Recherche und die letzte X-Suche.
        kostenUsd,
        ausloeser: manuell ? 'manuell' : 'auto',
        videosListe: JSON.stringify(videoLog),
        hinweis: geminiFehler ? `Videoanalyse: ${String(geminiFehler).slice(0, 200)}` : '',
        beitraegeListe: JSON.stringify(belegBasis),
        // Marktstand zum Zeitpunkt des Berichts — die Dossier-Ansicht zeigt
        // ihn als Tabelle. Mitgespeichert und nicht live nachgeladen, sonst
        // stünden neben einem Bericht von gestern die Zahlen von heute.
        marktBlock: JSON.stringify(marktdaten.werte || []),
        // Abwägung über alle Kapitel, mit Fakt/Einschätzung je Zeile. Leer,
        // wenn das Modell nichts Brauchbares lieferte — dann fehlt der Kasten.
        lagebild: abwaegung ? JSON.stringify(abwaegung) : '',
    }
    const [id] = await knex('news_digests').insert(zeile).returning('id')
    const digestId = typeof id === 'object' ? id.id : id

    // Nur der automatische Lauf meldet sich. Wer den Bericht selbst angestossen
    // hat, sitzt davor und braucht keine Post darüber.
    if (!manuell) {
        melde('lageberichtFertig', {
            betreff: `Lagebericht: ${zeile.ueberschrift || 'neuer Bericht'}`,
            text: `${zeile.lage || ''}\n\n`
                + `Grundlage: ${beitraege.length} Beiträge, ${videosVerwendet} Video(s), `
                + `${themen.join(' + ')}.\n`
                + 'Den vollständigen Bericht findest du im Journal unter „Nachrichten".',
            schluessel: String(digestId),
            ttlMs: 365 * 24 * 60 * 60 * 1000,
        }).catch(() => { })
    }

    console.log(` -> Lagebericht (${rhythmus}, ${laenge}, ${themen.join('+')}): ${beitraege.length} Beiträge, `
        + `${recherchen.length} Recherche(n), ${videosVerwendet} Video(s) verwendet `
        + `(davon ${videosGesehen} neu analysiert), `
        + `${tokens} Token via ${cfg.provider}/${cfg.model} (${kostenUsd.toFixed(4)} USD)`)
    return {
        id: digestId,
        beitraege: beitraege.length, videos: videosVerwendet, videosNeu: videosGesehen, tokens,
        kostenUsd,
        provider: cfg.provider, modell: cfg.model,
        geminiFehler,
    }
}

export function setupNewsRoutes(app) {
    // ── Quellen verwalten ────────────────────────────────────────────
    app.get('/api/marktradar/news/sources', async (req, res) => {
        try {
            const liste = await getKnex()('news_sources').orderBy('id')
            res.json({ quellen: liste, vorschlaege: VORSCHLAEGE })
        } catch (e) {
            sendRadarError(res, e, 'News-Quellen')
        }
    })

    app.post('/api/marktradar/news/sources', async (req, res) => {
        try {
            const { art, name, url, laerm } = req.body || {}
            if (!ARTEN.includes(String(art))) return res.status(400).json({ error: 'Unbekannte Art' })
            // X-Quellen tragen keinen Abruf-Link, sondern einen Handle — der
            // Server ruft nie eine von ihnen abgeleitete Adresse auf, die
            // Suche läuft über die xAI-API. Alle anderen Arten: die URL kommt
            // vom Nutzer, und hier ist der einzige Ort, an dem sie geprüft
            // werden kann, bevor der Server sie jemals abruft.
            if (String(art) === 'x') {
                if (!/^@?[A-Za-z0-9_]{1,30}$/.test(String(url || '').trim())) {
                    return res.status(400).json({ error: 'X-Quelle braucht einen Handle wie @beispiel' })
                }
            } else {
                await pruefeOeffentlicheUrl(url)
            }

            const [id] = await getKnex()('news_sources').insert({
                art, name: String(name || '').slice(0, 120), url: String(url).slice(0, 500),
                enabled: 1, laerm: Number(laerm) ? 1 : 0,
                createdAt: Date.now(), updatedAt: Date.now(),
            }).returning('id')
            res.json({ ok: true, id: typeof id === 'object' ? id.id : id })
        } catch (e) {
            res.status(400).json({ error: e.message })
        }
    })

    app.put('/api/marktradar/news/sources/:id', async (req, res) => {
        try {
            const id = Number(req.params.id)
            const felder = {}
            for (const k of ['name', 'enabled', 'laerm', 'videoAnalyse']) {
                if (req.body[k] !== undefined) felder[k] = k === 'name' ? String(req.body[k]).slice(0, 120) : (Number(req.body[k]) ? 1 : 0)
            }
            if (req.body.url !== undefined) {
                const zeileAlt = await getKnex()('news_sources').where('id', id).first()
                if (zeileAlt?.art === 'x') {
                    if (!/^@?[A-Za-z0-9_]{1,30}$/.test(String(req.body.url || '').trim())) {
                        return res.status(400).json({ error: 'X-Quelle braucht einen Handle wie @beispiel' })
                    }
                } else {
                    await pruefeOeffentlicheUrl(req.body.url)
                }
                felder.url = String(req.body.url).slice(0, 500)
                // Adresse geändert heisst: alter Fehler ist hinfällig
                felder.letzterFehler = ''
                felder.fehlerZaehler = 0
            }
            felder.updatedAt = Date.now()
            await getKnex()('news_sources').where('id', id).update(felder)
            res.json({ ok: true })
        } catch (e) {
            res.status(400).json({ error: e.message })
        }
    })

    app.delete('/api/marktradar/news/sources/:id', async (req, res) => {
        try {
            const id = Number(req.params.id)
            const knex = getKnex()
            await knex('news_items').where('sourceId', id).del()
            await knex('news_sources').where('id', id).del()
            res.json({ ok: true })
        } catch (e) {
            sendRadarError(res, e, 'News-Quelle löschen')
        }
    })

    /**
     * Eine Adresse ausprobieren, ohne sie zu speichern.
     *
     * Wichtig ist die Sperr-Erkennung: manche Dienste antworten mit gültigem
     * RSS, in dem statt Beiträgen eine Absage steht („RSS reader not yet
     * whitelisted"). Ohne diese Prüfung meldete der Test „1 Eintrag gefunden"
     * und der Nutzer trüge eine Quelle ein, die nie etwas liefert.
     */
    app.post('/api/marktradar/news/test', async (req, res) => {
        try {
            // X lässt sich nicht gratis probeabrufen — jede Suche kostet.
            // Geprüft wird nur die Handle-Form; ob der Account liefert, zeigt
            // der erste bezahlte Lauf.
            if (req.body?.art === 'x') {
                if (!/^@?[A-Za-z0-9_]{1,30}$/.test(String(req.body?.url || '').trim())) {
                    return res.status(400).json({ error: 'X-Quelle braucht einen Handle wie @beispiel' })
                }
                return res.json({ ok: true, anzahl: 0, beispiel: [], hinweis: 'Handle gültig — Abruf erfolgt über die bezahlte X-Suche' })
            }
            const roh = await holeText(req.body?.art === 'telegram'
                ? telegramUrl(req.body?.url) : req.body?.url)
            const e = req.body?.art === 'telegram' ? leseTelegram(roh) : leseFeed(roh)
            const SPERRE = /whitelist|not authorized|rate.?limit|blocked|captcha|sign in|login required|forbidden/i
            const verdaechtig = e.length <= 1 && e.some(x => SPERRE.test(x.titel))
            if (verdaechtig) {
                return res.status(400).json({
                    error: `Die Quelle antwortet, liefert aber keine Beiträge: „${e[0].titel.slice(0, 80)}"`,
                })
            }
            res.json({ ok: true, anzahl: e.length, beispiel: e.slice(0, 3).map(x => x.titel) })
        } catch (e) {
            res.status(400).json({ error: e.message })
        }
    })

    // ── Beiträge ─────────────────────────────────────────────────────
    app.get('/api/marktradar/news', async (req, res) => {
        try {
            const knex = getKnex()
            const s = await knex('settings').where('id', 1).first().catch(() => null)
            const filterAn = Number(s?.radarArschlochfilter ?? 1) === 1

            const qs = await knex('news_sources').select('id', 'name', 'art', 'laerm', 'letzterFehler')
            const nachId = new Map(qs.map(q => [q.id, q]))
            /**
             * Videos stehen MIT in der Liste — seit die Zusammenfassung
             * stichwortartig ist, trägt die Zeile auch ohne Zuschauen etwas.
             * Wer die alte Ansicht will, hängt ?ohneVideos=1 an.
             */
            const ohneVideos = String(req.query.ohneVideos || '') === '1'
            const erlaubt = qs
                .filter(q => !filterAn || Number(q.laerm) !== 1)
                .filter(q => !ohneVideos || q.art !== 'youtube')
                .map(q => q.id)

            let zeilen = erlaubt.length
                ? await knex('news_items').whereIn('sourceId', erlaubt)
                    // Obergrenze bewusst bei 200: darüber wird die Seite zäh,
                    // und wer 200 Meldungen durchsieht, sucht ohnehin eher im
                    // Archiv als in einer Nachrichtenübersicht.
                    .orderBy('publishedAt', 'desc')
                    .limit(Math.max(10, Math.min(200, Number(req.query.limit) || 40)))
                : []

            // Arschlochfilter: Stichwörter + Truth Social automatisch. Wirkt
            // nur auf die Auslieferung — gespeichert bleibt alles, damit eine
            // geänderte Wörterliste rückwirkend greift.
            let stichwortGefiltert = 0
            if (Number(s?.radarArschlochAn ?? 1) === 1) {
                const woerter = zerlegeWoerter(s?.radarArschlochWoerter)
                const vorher = zeilen.length
                zeilen = zeilen.filter(z => !istGefiltert(z, woerter, nachId.get(z.sourceId)))
                stichwortGefiltert = vorher - zeilen.length
            }

            res.set('Cache-Control', 'no-store')
            res.json({
                stand: Date.now(),
                veraltet: false,
                filterAn,
                stichwortGefiltert,
                beitraege: zeilen.map(z => ({
                    id: z.id, titel: z.titel, url: z.url,
                    publishedAt: Number(z.publishedAt),
                    zusammenfassung: z.zusammenfassung || '',
                    // Auszug für die Vorschau. 400 Zeichen reichen für drei
                    // Zeilen; alles Weitere steht beim Original.
                    auszug: (z.inhalt || '').slice(0, 400),
                    bild: z.bild || '',
                    status: z.status,
                    quelle: nachId.get(z.sourceId)?.name || '',
                    art: nachId.get(z.sourceId)?.art || 'rss',
                })),
                quellenAnzahl: qs.length,
                ausgeblendet: qs.filter(q => Number(q.laerm) === 1).length,
                // Ohne KI-Schritt ist das hier die ehrliche Ansage
                kiAktiv: false,
            })
        } catch (e) {
            sendRadarError(res, e, 'News')
        }
    })

    app.post('/api/marktradar/news/holen', async (req, res) => {
        try {
            res.json(await laufeNewsAbruf({ manuell: true }))
        } catch (e) {
            sendRadarError(res, e, 'News-Abruf')
        }
    })

    // ── Lagebericht ──────────────────────────────────────────────────

    /** Datenbankzeile in die Antwortform bringen — geteilt mit /:id. */
    function berichtAntwort(zeile) {
        if (!zeile) return null
        let kapitel = []
        try { kapitel = JSON.parse(zeile.kapitel || '[]') } catch { /* Altbestand */ }
        // Marktstand als Liste; ältere Berichte haben keinen — dann bleibt die
        // Tabelle im Dossier weg, statt den Stand von heute vorzutäuschen.
        let markt = []
        try { markt = JSON.parse(zeile.marktBlock || '[]') } catch { /* Altbestand */ }
        let lagebild = null
        try { lagebild = leseLagebild(JSON.parse(zeile.lagebild || 'null')) } catch { /* Altbestand */ }
        const { marktBlock, ...rest } = zeile
        return {
            ...rest,
            erstelltAm: Number(zeile.erstelltAm),
            punkte: JSON.parse(zeile.punkte || '[]'),
            kapitel,
            markt,
            lagebild,
            beitraege_liste: JSON.parse(zeile.beitraegeListe || '[]'),
            videos_liste: JSON.parse(zeile.videosListe || '[]'),
        }
    }

    app.get('/api/marktradar/lagebericht', async (req, res) => {
        try {
            const knex = getKnex()
            const letzter = await knex('news_digests').orderBy('erstelltAm', 'desc').first()
            // 30 Zeilen Metadaten — das Archiv auf der Nachrichten-Seite.
            // Volltext je Bericht kommt einzeln über /lagebericht/:id.
            const verlauf = await knex('news_digests')
                .orderBy('erstelltAm', 'desc').limit(30)
                .select('id', 'erstelltAm', 'ueberschrift', 'beitraege', 'videos', 'tokens',
                    'ausloeser', 'kostenUsd', 'themen', 'laenge')
            // Ein gescheiterter Lauf war bisher nur im Serverlog zu sehen — genau
            // deshalb fiel ein ausgefallener Tagesbericht tagelang nicht auf.
            const stand = await leseAufgabenStand(BERICHT_SCHLUESSEL)
            res.set('Cache-Control', 'no-store')
            res.json({
                stand: Number(letzter?.erstelltAm) || null,
                veraltet: false,
                bericht: berichtAntwort(letzter),
                verlauf: verlauf.map(v => ({ ...v, erstelltAm: Number(v.erstelltAm) })),
                letzterFehlschlag: stand?.fehler
                    ? { text: stand.fehler, zeit: stand.zeit }
                    : null,
            })
        } catch (e) {
            sendRadarError(res, e, 'Lagebericht')
        }
    })

    // Einen bestimmten Bericht aus dem Archiv öffnen.
    app.get('/api/marktradar/lagebericht/:id', async (req, res) => {
        try {
            const id = Number(req.params.id)
            if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Ungültige Kennung' })
            const zeile = await getKnex()('news_digests').where('id', id).first()
            if (!zeile) return res.status(404).json({ error: 'Bericht nicht gefunden' })
            res.set('Cache-Control', 'no-store')
            res.json({ bericht: berichtAntwort(zeile) })
        } catch (e) {
            sendRadarError(res, e, 'Lagebericht laden')
        }
    })

    /**
     * Bericht löschen. Der jüngste, oder ein bestimmter über die Kennung.
     *
     * Nötig, weil ein Bericht Geld gekostet hat und trotzdem unbrauchbar sein
     * kann — falscher Schwerpunkt, ausgefallene Videoanalyse, misslungener
     * Lauf. Ihn stehen zu lassen, bis der nächste ihn verdrängt, wäre die
     * schlechtere Lösung: die Seite zeigt dann bis morgen etwas, das niemand
     * will. Gelöscht wird nur der Bericht; die Beiträge und die bezahlten
     * Videozusammenfassungen bleiben, damit ein neuer Lauf sie nicht erneut
     * bezahlen muss.
     */
    app.delete('/api/marktradar/lagebericht/:id?', async (req, res) => {
        try {
            const knex = getKnex()
            const id = Number(req.params.id)
            const ziel = Number.isFinite(id) && id > 0
                ? await knex('news_digests').where('id', id).first()
                : await knex('news_digests').orderBy('erstelltAm', 'desc').first()
            if (!ziel) return res.status(404).json({ error: 'Kein Bericht vorhanden' })

            await knex('news_digests').where('id', ziel.id).del()
            const rest = Number((await knex('news_digests').count('* as c').first())?.c || 0)
            console.log(` -> Lagebericht ${ziel.id} gelöscht (${rest} verbleiben)`)
            res.json({ ok: true, geloescht: ziel.id, verbleibend: rest })
        } catch (e) {
            sendRadarError(res, e, 'Lagebericht löschen')
        }
    })

    app.post('/api/marktradar/lagebericht/erzeugen', async (req, res) => {
        try {
            // Erst frische Beiträge holen, dann urteilen — sonst schreibt der
            // Bericht über den Stand von gestern
            await laufeNewsAbruf({ manuell: true }).catch(() => { })
            res.json(await erzeugeLagebericht({ manuell: true }))
        } catch (e) {
            sendRadarError(res, e, 'Lagebericht erzeugen')
        }
    })

    console.log(' -> News routes initialized')
}

let newsTakt = null

/**
 * Takt: alle zehn Minuten nachsehen, ob der Bericht dran ist.
 *
 * Ob wirklich einer entsteht, entscheidet der Tages-Anspruch in der Datenbank —
 * auch wenn NAS und Entwicklungsrechner gleichzeitig laufen und beide die
 * Stunde sehen. Beiträge werden IMMER täglich gesammelt, auch wenn der Bericht
 * wöchentlich läuft: sonst fehlt dem Wochenbericht alles, was aus dem
 * Drei-Tage-Fenster der Feeds herausgefallen ist.
 */
export function startNewsTakt() {
    if (newsTakt) return
    newsTakt = setInterval(async () => {
        try {
            const s = await getKnex()('settings').where('id', 1).first()
            if (Number(s?.radarNewsAuto ?? 1) !== 1) return

            const jetzt = new Date()
            // Zeitzone des Journals, nicht die des Servers
            const lokal = s?.timeZone
                ? new Date(jetzt.toLocaleString('en-US', { timeZone: s.timeZone }))
                : jetzt

            await laufeNewsAbruf().catch(() => { })

            if (!sollBerichtLaufen({
                jetztLokal: lokal,
                stunde: Number(s?.radarNewsStunde ?? 12),
                rhythmus: s?.radarNewsRhythmus,
                wochentag: Number(s?.radarNewsWochentag ?? 1),
            })) return

            await erzeugeLagebericht().catch(() => { })   // Fehler steht im Vermerk
        } catch (e) {
            logWarn('news', `Takt: ${e.message}`)
        }
    }, 10 * 60 * 1000)
    newsTakt.unref?.()
}

export function stopNews() {
    if (newsTakt) clearInterval(newsTakt)
    newsTakt = null
}
