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
import { beansprucheAufgabe } from './db-claim.js'
import { holeText, pruefeOeffentlicheUrl } from './net-guard.js'
import { leseFeed, leseTelegram, telegramUrl } from './feed-parser.js'
import { sendRadarError } from './marktradar-api.js'
import { ladeLlmConfig, callLLMJson } from './llm.js'
import { samplingFelder, GEMINI_STANDARDMODELL } from './ai-models.js'

const TAG = 24 * 60 * 60 * 1000
const MAX_ALTER = 3 * TAG          // ältere Beiträge sind keine Nachricht mehr
const AUFBEWAHRUNG = 30 * TAG
const ARTEN = ['youtube', 'rss', 'truth', 'telegram', 'x']

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

    for (const q of liste) {
        if (filterAn && Number(q.laerm) === 1) continue

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
                /*
                 * Beim Konflikt wird NUR das Bild nachgetragen.
                 *
                 * Ein vollständiges `merge` wäre falsch: Status, Zusammenfassung
                 * und Versuchszähler würden zurückgesetzt, ein bereits von der
                 * KI angesehenes Video fiele auf „neu" zurück und würde erneut
                 * bezahlt. Ein `ignore` wiederum liesse Felder, die es früher
                 * noch nicht gab, für immer leer — genau das ist beim Bild
                 * passiert. Also gezielt: nur das Bild.
                 */
                const vorher = Number((await knex('news_items').count('* as c').first())?.c || 0)
                await knex('news_items').insert(zeile)
                    .onConflict(['sourceId', 'extId']).merge(['bild'])
                const nachher = Number((await knex('news_items').count('* as c').first())?.c || 0)
                neu += nachher - vorher
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
async function fasseVideoZusammen(videoUrl, cfg, aufloesung = 'niedrig') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 120000)   // Video braucht länger als Text
    try {
        const r = await fetch(`${url}?key=${encodeURIComponent(cfg.apiKey)}`, {
            method: 'POST',
            signal: ctrl.signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        {
                            text: 'Fasse dieses Video in höchstens fünf Sätzen auf Deutsch zusammen. '
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
                    maxOutputTokens: 400,
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

const SYSTEM_LAGE = `Du bist Marktbeobachter für einen **Krypto-Futures-Händler**.

Aus den nummerierten Beiträgen schreibst du EINEN Lagebericht auf Deutsch —
auch wenn die Beiträge englisch sind. Nicht je Beitrag eine Zusammenfassung,
sondern das Gesamtbild.

WAS ZÄHLT, in dieser Reihenfolge:
1. Bitcoin und Ether: Kursbewegung, Positionierung, Liquidität, ETF-Flüsse
2. Der übrige Kryptomarkt: Altcoins, DeFi, Stablecoins, Börsen, Hacks
3. Regulierung, soweit sie den Handel betrifft
4. Makro NUR, wenn der Beitrag den Bezug zu Krypto selbst herstellt

Ein Makro-Thema ohne Krypto-Bezug gehört NICHT in den Bericht, egal wie
prominent es in den Quellen steht. Zinsen, Yen und Anleihen interessieren hier
nur, wenn jemand erklärt, was sie mit Bitcoin machen.

REGELN:
- Keine Handelsempfehlungen, keine Kursziele, keine Prognosen.
- Nichts erfinden. Was nicht in den Beiträgen steht, steht nicht im Bericht.
- Eigenwerbung, Sponsoren, Clickbait und reine Meinungsmache lässt du weg.
- Zahlen nennen, wenn welche dastehen — sie sind das Überprüfbare.
- Ist nichts Wesentliches dabei, sage das offen, statt etwas zu konstruieren.

UMFANG: sechs bis neun Punkte. Jeder Punkt ist ein ausgeschriebener Absatz von
DREI BIS FÜNF Sätzen — was geschehen ist, welche Zahlen dazu genannt werden und
wie es mit dem übrigen Geschehen zusammenhängt. Eine Zeile Schlagzeile reicht
nicht; der Leser soll den Punkt verstanden haben, ohne die Quelle zu öffnen.
Sagen zwei Quellen dasselbe, schreibe EINEN Punkt und nenne beide Belege.

Antworte NUR mit JSON:
{"ueberschrift": "...",
 "lage": "drei bis fünf Sätze Gesamtbild",
 "punkte": [{"titel": "...", "text": "drei bis fünf Sätze", "quelle": "...",
             "wichtigkeit": "hoch|mittel",
             "kennzahlen": [{"wert": "-29.000 BTC", "was": "Apparent Demand"}],
             "belege": [1, 4]}]}

"belege" enthält die Nummern der Beiträge, auf denen der Punkt beruht — daran
kann der Leser nachschlagen, woher es kommt.
"kennzahlen" sind bis zu drei Zahlen, die WÖRTLICH in den Beiträgen stehen —
Kurse, Flüsse, Quoten, Fristen. Steht keine Zahl da, lass die Liste leer;
erfundene oder gerundete Zahlen sind schlimmer als gar keine.`

/**
 * Lagebericht erzeugen.
 *
 * Zwei Anbieter, bewusst getrennt: der Bericht entsteht beim EINGESTELLTEN
 * Anbieter (Claude), die Videos gehen vorher an Gemini. Fällt Gemini aus,
 * entsteht der Bericht trotzdem — nur eben ohne Videoinhalte.
 */
export async function erzeugeLagebericht({ manuell = false } = {}) {
    const ttl = manuell ? 5 * 60 * 1000 : 20 * 60 * 60 * 1000
    if (!(await beansprucheAufgabe('news_lagebericht', ttl))) return { uebersprungen: true }

    const knex = getKnex()
    const s = await knex('settings').where('id', 1).first()
    const filterAn = Number(s?.radarArschlochfilter ?? 1) === 1

    const quellenListe = await knex('news_sources').select('id', 'name', 'art', 'laerm')
    const erlaubt = quellenListe.filter(q => !filterAn || Number(q.laerm) !== 1)
    const nachId = new Map(quellenListe.map(q => [q.id, q]))
    if (!erlaubt.length) return { fehler: 'Keine Quellen freigegeben' }

    const seit = Date.now() - 36 * 60 * 60 * 1000
    const beitraege = await knex('news_items')
        .whereIn('sourceId', erlaubt.map(q => q.id))
        .where('publishedAt', '>=', seit)
        .orderBy('publishedAt', 'desc')
        .limit(30)
    if (!beitraege.length) return { fehler: 'Keine Beiträge der letzten 36 Stunden' }

    // ── Schritt 1: Videos ansehen (Gemini, eigener Schlüssel) ────────────
    let videosGesehen = 0
    let geminiFehler = ''
    /** Was mit jedem angefassten Video geschah — inklusive Token und Kosten. */
    const videoLog = []
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
            const videos = beitraege.filter(b =>
                nachId.get(b.sourceId)?.art === 'youtube'
                && Number(nachId.get(b.sourceId)?.videoAnalyse ?? 1) === 1
                && (b.status === 'neu' || (b.status === 'fehler' && Number(b.versuche || 0) < 3))
                && /youtube\.com|youtu\.be/.test(b.url))
            for (const v of videos.slice(0, maxVideos)) {
                try {
                    const { text, tokens } = await fasseVideoZusammen(
                        v.url, geminiCfg, s?.radarNewsAufloesung || 'niedrig')
                    await knex('news_items').where('id', v.id).update({
                        zusammenfassung: text.startsWith('OHNE INHALT') ? '' : text,
                        aiModel: geminiCfg.model, aiStand: Date.now(), tokens,
                        status: 'zusammengefasst', fehler: '',
                    })
                    v.zusammenfassung = text.startsWith('OHNE INHALT') ? '' : text
                    videosGesehen++
                    videoLog.push({
                        titel: v.titel, url: v.url,
                        quelle: nachId.get(v.sourceId)?.name || '',
                        tokens,
                        // Gemini 2.5/3.x Flash: 0,30 $ je Million Eingabe-Token
                        kostenUsd: Math.round((tokens / 1e6) * 0.30 * 10000) / 10000,
                        ergebnis: text.startsWith('OHNE INHALT') ? 'ohne Inhalt' : 'ok',
                    })
                } catch (e) {
                    await knex('news_items').where('id', v.id).update({
                        status: 'fehler',
                        fehler: String(e.message).slice(0, 300),
                        versuche: Number(v.versuche || 0) + 1,
                    })
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
    for (const b of beitraege) {
        if (!b.zusammenfassung) continue
        if (videoLog.some(v => v.url === b.url)) continue
        videoLog.push({
            titel: b.titel, url: b.url,
            quelle: nachId.get(b.sourceId)?.name || '',
            tokens: 0, kostenUsd: 0, ergebnis: 'übernommen',
        })
    }
    const videosVerwendet = videoLog.filter(v => v.ergebnis === 'ok' || v.ergebnis === 'übernommen').length

    // ── Schritt 2: Bericht schreiben (eingestellter Anbieter = Claude) ───
    // Durchnummeriert, damit das Modell seine Belege benennen kann
    const zeilen = beitraege.map((b, i) => {
        const q = nachId.get(b.sourceId)
        const inhalt = b.zusammenfassung || (b.inhalt || '').slice(0, 600)
        return `[${i + 1}] [${new Date(Number(b.publishedAt)).toISOString().slice(0, 16)}] ${b.titel}\n`
            + `Quelle: ${q?.name || '?'} (${q?.art || 'rss'})${b.zusammenfassung ? ' — Videoinhalt, von Gemini angesehen' : ''}\n`
            + `${inhalt}\n`
    })

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
    const budgets = [8000, 16000]
    let antwort = null
    for (const budget of budgets) {
        cfg.maxTokens = budget
        antwort = await callLLMJson(cfg, {
            system: SYSTEM_LAGE,
            user: zeilen.join('\n---\n'),
            timeoutMs: 180000,
        })
        if (!antwort.abgeschnitten && antwort.json) break
        logWarn('news', `Bericht mit ${budget} Token abgeschnitten — `
            + `${budget === budgets[budgets.length - 1] ? 'gebe auf' : 'wiederhole mit mehr Budget'}`)
    }
    const daten = antwort.json
    if (!daten || !Array.isArray(daten.punkte)) {
        // Lieber ehrlich scheitern als einen leeren Bericht speichern, der
        // aussieht, als hätte es heute nichts gegeben
        throw new Error(antwort.abgeschnitten
            ? 'Antwort war abgeschnitten (Token-Budget zu klein)'
            : 'Modell lieferte kein verwertbares JSON')
    }
    const tokens = antwort.usage?.totalTokens || 0

    const zeile = {
        erstelltAm: Date.now(),
        provider: cfg.provider,
        modell: cfg.model,
        ueberschrift: String(daten?.ueberschrift || '').slice(0, 300),
        lage: String(daten?.lage || '').slice(0, 4000),
        // Belegnummern in echte Beiträge auflösen: Titel, Verweis, Quelle.
        // Erst dadurch ist der Bericht nachprüfbar statt nur behauptet.
        punkte: JSON.stringify((Array.isArray(daten?.punkte) ? daten.punkte : []).slice(0, 12).map(p => ({
            ...p,
            belege: (Array.isArray(p.belege) ? p.belege : [])
                .map(nr => beitraege[Number(nr) - 1])
                .filter(Boolean)
                .map(b => ({
                    titel: b.titel,
                    url: b.url,
                    quelle: nachId.get(b.sourceId)?.name || '',
                    art: nachId.get(b.sourceId)?.art || 'rss',
                    // Das Vorschaubild des Belegs — daraus nimmt die Karte ihr
                    // Bild. Geteilte Charts und Börsen-Screenshots kommen so
                    // in den Bericht, ohne dass etwas erzeugt werden müsste.
                    bild: b.bild || '',
                })),
        }))),
        beitraege: beitraege.length,
        videos: videosVerwendet,
        videosNeu: videosGesehen,
        tokens,
        // schaetzeKosten() aus llm.js kennt die Preistabelle je Modell
        kostenUsd: Number(antwort.costUsd) || 0,
        ausloeser: manuell ? 'manuell' : 'auto',
        videosListe: JSON.stringify(videoLog),
        hinweis: geminiFehler ? `Videoanalyse: ${String(geminiFehler).slice(0, 200)}` : '',
        beitraegeListe: JSON.stringify(beitraege.map(b => ({
            titel: b.titel,
            url: b.url,
            quelle: nachId.get(b.sourceId)?.name || '',
            art: nachId.get(b.sourceId)?.art || 'rss',
            bild: b.bild || '',
        }))),
    }
    const [id] = await knex('news_digests').insert(zeile).returning('id')

    console.log(` -> Lagebericht: ${beitraege.length} Beiträge, ${videosVerwendet} Video(s) verwendet `
        + `(davon ${videosGesehen} neu analysiert), `
        + `${tokens} Token via ${cfg.provider}/${cfg.model} (${(Number(antwort.costUsd) || 0).toFixed(4)} USD)`)
    return {
        id: typeof id === 'object' ? id.id : id,
        beitraege: beitraege.length, videos: videosVerwendet, videosNeu: videosGesehen, tokens,
        kostenUsd: Number(antwort.costUsd) || 0,
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
            // Die URL kommt vom Nutzer — hier ist der einzige Ort, an dem sie
            // geprüft werden kann, bevor der Server sie jemals abruft
            await pruefeOeffentlicheUrl(url)

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
                await pruefeOeffentlicheUrl(req.body.url)
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
             * YouTube bleibt aus der Liste draussen.
             *
             * Ein Videotitel ist als Meldung wertlos — „Haben wir das
             * Schlimmste überstanden?" sagt nichts, und den Inhalt sieht man
             * erst nach zwanzig Minuten Zuschauen. Für den Lagebericht sind
             * die Videos dagegen die gehaltvollste Quelle, weil Gemini sie
             * tatsächlich ansieht. Also: für den Bericht ja, für die Liste
             * nein. Mit ?mitVideos=1 lässt sich das aufheben.
             */
            const mitVideos = String(req.query.mitVideos || '') === '1'
            const erlaubt = qs
                .filter(q => !filterAn || Number(q.laerm) !== 1)
                .filter(q => mitVideos || q.art !== 'youtube')
                .map(q => q.id)

            const zeilen = erlaubt.length
                ? await knex('news_items').whereIn('sourceId', erlaubt)
                    // Obergrenze bewusst bei 200: darüber wird die Seite zäh,
                    // und wer 200 Meldungen durchsieht, sucht ohnehin eher im
                    // Archiv als in einer Nachrichtenübersicht.
                    .orderBy('publishedAt', 'desc')
                    .limit(Math.max(10, Math.min(200, Number(req.query.limit) || 40)))
                : []

            res.set('Cache-Control', 'no-store')
            res.json({
                stand: Date.now(),
                veraltet: false,
                filterAn,
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
    app.get('/api/marktradar/lagebericht', async (req, res) => {
        try {
            const knex = getKnex()
            const letzter = await knex('news_digests').orderBy('erstelltAm', 'desc').first()
            const verlauf = await knex('news_digests')
                .orderBy('erstelltAm', 'desc').limit(14)
                .select('id', 'erstelltAm', 'ueberschrift', 'beitraege', 'videos', 'tokens', 'ausloeser')
            res.set('Cache-Control', 'no-store')
            res.json({
                stand: Number(letzter?.erstelltAm) || null,
                veraltet: false,
                bericht: letzter ? {
                    ...letzter,
                    erstelltAm: Number(letzter.erstelltAm),
                    punkte: JSON.parse(letzter.punkte || '[]'),
                    beitraege_liste: JSON.parse(letzter.beitraegeListe || '[]'),
                    videos_liste: JSON.parse(letzter.videosListe || '[]'),
                } : null,
                verlauf: verlauf.map(v => ({ ...v, erstelltAm: Number(v.erstelltAm) })),
            })
        } catch (e) {
            sendRadarError(res, e, 'Lagebericht')
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
 * Takt: alle zehn Minuten nachsehen, ob die eingestellte Stunde erreicht ist.
 * Die Sperre in der Datenbank (20 h) sorgt dafür, dass es trotzdem bei einem
 * Bericht je Tag bleibt — auch wenn NAS und Entwicklungsrechner gleichzeitig
 * laufen und beide die Stunde sehen.
 */
export function startNewsTakt() {
    if (newsTakt) return
    newsTakt = setInterval(async () => {
        try {
            const s = await getKnex()('settings').where('id', 1).first()
            if (Number(s?.radarNewsAuto ?? 1) !== 1) return

            const stunde = Math.max(0, Math.min(23, Number(s?.radarNewsStunde ?? 12)))
            const jetzt = new Date()
            // Zeitzone des Journals, nicht die des Servers
            const lokal = s?.timeZone
                ? new Date(jetzt.toLocaleString('en-US', { timeZone: s.timeZone }))
                : jetzt
            if (lokal.getHours() !== stunde) return

            await laufeNewsAbruf().catch(() => { })
            await erzeugeLagebericht()
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
