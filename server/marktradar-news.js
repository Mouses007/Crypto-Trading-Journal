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
import { ladeLlmConfig, ladeLlmConfigFuerAufgabe, callLLMJson, istGuthabenFehler, merkeKiGuthaben, schaetzeKosten } from './llm.js'
import { entdoppleBericht, protokollText } from './news-doppler.js'
import { gruppiereBeitraege, themenRegel, haltEinsProThema } from './news-themen.js'
import { merkeVerbrauch } from './ai-usage.js'
import { samplingFelder, GEMINI_STANDARDMODELL } from './ai-models.js'
import {
    sucheXPosts, rechercheThema, istGefiltert, istFokusTreffer, zerlegeWoerter, baueRechercheZitate, THEMEN_NAMEN,
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
 * Ist das nur ein Bruchstück statt einer Zusammenfassung?
 *
 * Der Wächter in `fasseVideoZusammen` prüft `finishReason` — er merkt einen
 * Abbruch also nur im Augenblick des Abrufs. Was einmal in der Datenbank
 * steht, wird von da an ungeprüft weiterverwendet: `erzeugeLagebericht` hebt
 * jede vorhandene `zusammenfassung` als `ergebnis: 'übernommen'` in JEDEN
 * neuen Bericht. So standen am 21.08.2026 fünfzehn halbe Stichpunkte über
 * fünf Kanäle in der Videoliste und sahen aus wie gelungene Analysen —
 * `"- Bitcoin stieg durch Short-Squeeze über 70.00"`, mitten in der Zahl
 * abgeschnitten.
 *
 * Deshalb wird hier bei der VERWENDUNG geprüft, nicht nur beim Abruf. Ein
 * Wächter, der nur die Entstehung bewacht, lässt jeden Altbestand durch —
 * und der Grund für den Abbruch muss dafür nicht einmal derselbe sein.
 *
 * Die Grenze ist gemessen, nicht geschätzt: die kaputten Bruchstücke lagen
 * bei 33–77 Zeichen, die brauchbaren Zusammenfassungen begannen bei 304.
 * 120 liegt in dieser Lücke. Wer drei Stichpunkte zustande bringt, hat
 * geliefert, auch wenn sie kurz ausfallen — deshalb die zweite Bedingung.
 *
 * Rein und ohne Netz, damit der Selbsttest sie prüfen kann.
 */
export function istBruchstueck(text) {
    const t = String(text || '').trim()
    if (!t) return true
    const punkte = t.split('\n').filter(z => /^[\s]*[-–—*•]/.test(z)).length
    return t.length < 120 && punkte < 3
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

        /*
         * Berichte haben ihre EIGENE Frist — und normalerweise gar keine.
         *
         * Die 30 Tage oben gelten für Rohbeiträge, die nichts gekostet haben.
         * Ein Bericht ist bezahlte Arbeit; ihn nach derselben Regel zu löschen
         * wäre eine stille Enteignung. Deshalb Vorgabe „manuell" und eine
         * eigene Einstellung für alle, die den Bestand kurz halten wollen.
         */
        const frist = aufbewahrungMs((await knex('settings').where('id', 1).first())?.radarNewsBerichtAufbewahrung)
        if (frist) {
            const weit = await knex('news_digests').where('erstelltAm', '<', Date.now() - frist).del()
            if (weit) console.log(` -> News: ${weit} alte Bericht(e) entfernt (Frist ${frist / TAG} Tage)`)
        }
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

/**
 * Der Auftrag an Gemini für ein Video.
 *
 * `mitChart` kommt vom Kapitel „Chartanalyse": Ist es aktiv, sollen die im
 * Video GENANNTEN Marken erhalten bleiben — Unterstützungen, Widerstände,
 * Muster, Zeiteinheit. Ohne diesen Satz gehen sie in der Zusammenfassung
 * verloren: „Nur was für die Marktlage relevant ist" liest ein Modell als
 * Nachrichtenlage, und ein Chartvideo besteht aus fast nichts anderem als
 * Marken.
 *
 * Wichtig ist die Grenze: WIEDERGEBEN, was das Video sagt, nicht bewerten. Die
 * Regel „keine Kursziele" bleibt stehen — eine genannte Unterstützung ist eine
 * Aussage des Videos, ein Kursziel wäre eine Empfehlung daraus.
 *
 * Rein und ohne Netz, damit der Selbsttest sie prüfen kann.
 */
export function bauVideoAuftrag({ tiefe = 'normal', deckel = 0, mitChart = false } = {}) {
    const stufe = videoTiefeAus(tiefe, deckel)
    const chart = mitChart
        ? 'Bespricht das Video Charts, gib die GENANNTEN Marken wörtlich wieder: '
          + 'Unterstützungen, Widerstände, Chartmuster, Indikatoren und die Zeiteinheit, '
          + 'jeweils mit dem Coin dazu. Nur wiedergeben, nicht selbst deuten. '
        : ''
    return {
        tokens: stufe.tokens,
        text: `${stufe.auftrag} `
            + 'Nur was für die Marktlage relevant ist: Thesen, Zahlen, genannte Ereignisse. '
            + chart
            + 'Lass Eigenwerbung, Sponsoren und Aufrufe zum Abonnieren weg. '
            + 'Keine Handelsempfehlung, keine Kursziele, keine Spekulation. '
            + 'Wenn das Video nichts Marktrelevantes enthält, schreibe genau: OHNE INHALT',
    }
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

/**
 * Denk-Reserve für Modelle, die vor der Antwort nachdenken.
 *
 * `maxOutputTokens` deckelt bei Gemini nicht die Antwort, sondern Antwort UND
 * internes Nachdenken. Gemessen am 20.08.2026 mit `gemini-3.1-pro-preview`:
 * Bei 400 Token gingen 380 ins Nachdenken, 16 blieben für die Antwort — Ende
 * mitten im ersten Stichpunkt (`finishReason: MAX_TOKENS`). In der Datenbank
 * standen daraufhin Zusammenfassungen von 33 bis 77 Zeichen, während für das
 * Video selbst 96.000 Eingabe-Token bezahlt waren.
 *
 * `thinkingBudget: 0` ist keine Lösung: Das Modell lehnt es mit
 * „This model only works in thinking mode" ab. Also Luft schaffen — mit 2500
 * kam derselbe Auftrag vollständig zurück (1699 gedacht, 93 geantwortet) —
 * die Reserve liegt darüber, weil ein langes Video mehr Nachdenken braucht als
 * ein Kurzvideo. Ein höherer Deckel kostet nichts: Bezahlt wird, was das
 * Modell tatsächlich verbraucht. Ein abgeschnittener Stichpunkt dagegen macht
 * die ganze bezahlte Videoanalyse wertlos.
 */
const DENKRESERVE = 3000

async function fasseVideoZusammen(videoUrl, cfg, { aufloesung = 'niedrig', tiefe = 'normal', deckel = 0,
    mitChart = false } = {}) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`
    const stufe = bauVideoAuftrag({ tiefe, deckel, mitChart })
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
                        { text: stufe.text },
                        { fileData: { fileUri: videoUrl } },
                    ],
                }],
                // `samplingFelder` statt fest verdrahtetem temperature: Gemini
                // nimmt das Feld zwar an, aber der Helfer ist die eine Stelle,
                // an der modellabhängige Eigenheiten gepflegt werden — hier
                // mitzulaufen kostet nichts und spart die nächste Überraschung.
                generationConfig: {
                    ...samplingFelder(cfg.model, 0.2),
                    maxOutputTokens: stufe.tokens + DENKRESERVE,
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
        /*
         * Abgeschnitten heisst abgeschnitten — auch wenn Text zurückkommt.
         *
         * Ein halber Stichpunkt sah in der Datenbank aus wie eine gelungene
         * Analyse und wurde in jeden folgenden Bericht übernommen. Sichtbar
         * machen statt still speichern; bei einem Bruchstück lieber gar nichts.
         */
        if (j?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
            const gedacht = Number(j?.usageMetadata?.thoughtsTokenCount) || 0
            logWarn('news', `Videozusammenfassung abgeschnitten (${gedacht} Token gedacht, `
                + `Deckel ${stufe.tokens + DENKRESERVE}): ${videoUrl}`)
            // Dieselbe Messlatte wie bei der Verwendung: eine Grenze, nicht zwei.
            // Die alte Zahl (60 Zeichen) liess `"- Krypto-Gipfel im Weissen Haus
            // mit Coinbase."` durch — 44 Zeichen, sieht vollständig aus, ist
            // aber ein einziger von fünf bis acht verlangten Stichpunkten.
            if (!istOhneInhalt(text) && istBruchstueck(text)) throw new Error('Antwort abgeschnitten — Token-Deckel zu klein')
        }
        return { text, tokens: Number(j?.usageMetadata?.totalTokenCount) || 0 }
    } finally {
        clearTimeout(timer)
    }
}

/** Ein Bild laden und für einen multimodalen Modellaufruf kodieren. */
async function ladeBildAlsAnhang(url, timeoutMs = 15000) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
        const r = await fetch(url, { signal: ctrl.signal })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const mediaType = String(r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim()
        const buf = Buffer.from(await r.arrayBuffer())
        return { kind: 'image', base64: buf.toString('base64'), mediaType }
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Chartbilder vom Modell selbst einordnen lassen: echter Preis-Chart mit
 * sichtbarer Analyse, oder blosse Dekoration?
 *
 * Perplexitys Bildersuche liefert nur URL und Herkunftsseite, keine
 * Bildunterschrift — geprüft am Bestand vom 23.08.2026 hatte jedes Bild eine
 * Herkunft, aber die Herkunfts-Domains einer Recherche und ihre zitierten
 * Text-Quellen überschneiden sich fast nie (Bild von TradingView, Zitat von
 * einem Newsportal). Ein Domain-Filter hätte deshalb nichts zum Anschlagen:
 * jede beobachtete Herkunft sah seriös aus, auch die eines reinen
 * Symbolbilds. Nur das Bild selbst verrät, ob es eine Analyse zeigt — und
 * DIESE Beschreibung ist zugleich die "Erklärung", die ein Chart ohne
 * Autoren-Bildunterschrift sonst nie bekäme.
 *
 * Ein Bild ohne verwertbares Urteil (Download schlägt fehl, Modellantwort
 * unbrauchbar) fällt raus statt unbeschriftet durchzurutschen — keine
 * Erklärung heisst keine Verwendung.
 *
 * @param {Array<{url:string, quelle:string}>} bilder
 * @param {object} cfg  von `ladeLlmConfig({provider:'gemini', ...})`
 * @returns {Promise<{bilder: Array<{url:string, quelle:string, beschreibung:string}>, tokens:number, kostenUsd:number}>}
 */
async function pruefeChartBilder(bilder, cfg) {
    if (!bilder?.length) return { bilder: [], tokens: 0, kostenUsd: 0 }

    // Parallel statt nacheinander: bei bis zu zehn Bildern à 15 s Zeitlimit
    // summierte ein sequenzieller Download sich sonst auf über zwei Minuten,
    // nur um am Ende festzustellen, dass die Hälfte gar nicht erreichbar war.
    const geladenOderNicht = await Promise.all(bilder.map(async (b) => {
        try {
            return { b, anhang: await ladeBildAlsAnhang(b.url) }
        } catch (e) {
            logWarn('news', `Chartbild nicht ladbar, übersprungen: ${b.url} (${e.message})`)
            return null
        }
    }))
    const treffer = geladenOderNicht.filter(Boolean)
    const anhaenge = treffer.map((t) => t.anhang)
    const geladen = treffer.map((t) => t.b)   // dieselbe Reihenfolge wie `anhaenge`
    if (!anhaenge.length) return { bilder: [], tokens: 0, kostenUsd: 0 }

    const antwort = await callLLMJson(cfg, {
        system: `Du bekommst ${anhaenge.length} Bild(er), in der Reihenfolge nummeriert, wie sie kommen (erstes Bild = Index 0).
Für JEDES Bild: Ist es ein echter Preis-Chart mit sichtbarer technischer Analyse — eingezeichnete Linien, Kursmarken,
Indikatoren, Trendlinien, Unterstützungs- oder Widerstandszonen? Symbolbilder, Werbegrafiken, Logos oder reine
Stimmungs-Illustrationen zählen NICHT, auch wenn Kurspfeile, Münzen oder Zahlen abgebildet sind.
Antworte NUR mit JSON: {"bilder":[{"istChart":true|false,"beschreibung":"ein Satz auf Deutsch, was zu sehen ist"}]}
Genau ${anhaenge.length} Einträge, in derselben Reihenfolge wie die Bilder. "beschreibung" bei istChart=false kurz
begründen, wieso es kein Chart ist.`,
        user: 'Bewerte die Bilder.',
        anhaenge,
        timeoutMs: 60000,
        zweck: 'chartbild-pruefung',
        ausloeser: 'auto',
    })

    const roh = Array.isArray(antwort.json?.bilder) ? antwort.json.bilder : []
    const raus = []
    geladen.forEach((b, i) => {
        const urteil = roh[i]
        const beschreibung = String(urteil?.beschreibung || '').trim()
        if (urteil?.istChart === true && beschreibung) {
            raus.push({ ...b, beschreibung: beschreibung.slice(0, 300) })
        }
    })
    return { bilder: raus, tokens: antwort.usage?.totalTokens || 0, kostenUsd: antwort.costUsd || 0 }
}

/** Gültige Themen des Berichts — Reihenfolge ist die Kapitelreihenfolge. */
const THEMEN = ['crypto', 'finanzen', 'tech', 'chartanalyse']

/** Themen-Einstellung (CSV) in eine gültige, geordnete Liste übersetzen. */
export function leseThemen(text) {
    const gewaehlt = String(text || '').split(',').map(t => t.trim()).filter(t => THEMEN.includes(t))
    return gewaehlt.length ? THEMEN.filter(t => gewaehlt.includes(t)) : ['crypto']
}

/** Umfang je Länge: Sätze der Kapitel-Lage und Punkte je Kapitel. */
/*
 * Die Erststufen kommen aus Messungen, nicht aus Gefühl.
 *
 * Vier Messungen am 20.08.2026, „mittel" mit zwei Kapiteln (crypto +
 * chartanalyse) und Opus 5: 5000 abgebrochen, 5000 abgebrochen, 11000
 * abgebrochen — gebraucht wurden 12114 Ausgabe-Token für zehn Punkte. Jeder
 * dieser Abbrüche ist voll bezahlt und komplett wertlos; der teuerste kostete
 * 0,38 USD für Text, den niemand je gesehen hat.
 *
 * Die alten Werte stammten aus der Zeit, als ein Punkt eine Zeile war. Seit
 * Punkte ausgeschriebene Absätze mit Kennzahlen und Belegen sind, liegt der
 * Bedarf beim Zwei- bis Dreifachen. Die Stufen hier haben deshalb bewusst
 * Luft nach oben: Der Deckel ist eine Obergrenze, keine Bestellung — wie lang
 * die Antwort wird, sagt der Prompt (Lage, Punkte je Kapitel), nicht diese
 * Zahl. Zu hoch kostet nichts, zu tief kostet den ganzen Lauf.
 */
const LAENGEN = {
    kurz: { lage: 'zwei bis drei Sätze', punkte: 'zwei bis drei Punkte', budgets: [8000, 16000] },
    mittel: { lage: 'vier bis sechs Sätze', punkte: 'vier bis fünf Punkte', budgets: [16000, 32000] },
    lang: { lage: 'acht bis zehn Sätze', punkte: 'sechs bis acht Punkte', budgets: [26000, 52000] },
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
export function budgetsAus(laenge, budget, { aktualisierung = false } = {}) {
    const eigen = Math.max(0, Number(budget) || 0)
    const stufen = eigen
        ? [Math.min(60000, Math.max(1000, eigen)), Math.min(120000, Math.min(60000, Math.max(1000, eigen)) * 2)]
        : (LAENGEN[laenge] || LAENGEN.mittel).budgets
    if (!aktualisierung) return stufen
    /*
     * Die Aktualisierung bekommt eine Stufe mehr Luft, als ihre Länge vorgibt.
     *
     * Gemessen am 20.08.2026 am ersten echten Lauf: Der Erstversuch mit 5000
     * Ausgabe-Token brach bei genau 5000 ab — 0,19 USD für nichts, und der
     * Nachschlag musste alles noch einmal schreiben. Ein abgebrochener Lauf
     * ist der einzige wirklich teure Fehler an dieser Stelle.
     *
     * Der Deckel ist eine Obergrenze, keine Bestellung: Bezahlt werden die
     * tatsächlich geschriebenen Token, und wie lang die Antwort wird, sagt die
     * Länge im Prompt (bei der Zwischenmeldung ohnehin eine Stufe kürzer).
     * Höher anzusetzen kostet also nichts — zu tief anzusetzen kostet den Lauf.
     */
    // Erststufe wie überall bei 60000 gedeckelt, sonst wären beide Anläufe
    // gleich gross und der zweite bloss eine Wiederholung des Abbruchs.
    return [Math.min(60000, stufen[1]), Math.min(120000, stufen[1] * 2)]
}

/**
 * Wie lang eine Aktualisierung ausfällt: eine Stufe unter der Einstellung.
 *
 * Die Aktualisierung ist eine Zwischenmeldung, kein zweiter Morgenbericht. Sie
 * beantwortet „was ist seither passiert", und darauf gibt es um 15:00 selten
 * acht Absätze Antwort — wer dann trotzdem acht bekommt, liest Füllmaterial.
 * „kurz" ist die Untergrenze: darunter bliebe nichts als eine Schlagzeile.
 *
 * Rein und ohne Datenbank, damit der Selbsttest sie prüfen kann.
 */
export function laengeFuerUpdate(laenge) {
    return { lang: 'mittel', mittel: 'kurz', kurz: 'kurz' }[laenge] || 'kurz'
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
    return `EIGENE ANWEISUNGEN DES LESERS — sie haben VORRANG:
<<<
${text}
>>>
Sie gehen den Vorgaben aus den Einstellungen VOR. Umfang, Anzahl der Punkte,
Reihenfolge, Schwerpunkt und Auswahl richten sich nach ihnen, auch wenn oben
unter UMFANG etwas anderes steht — dort steht die Vorgabe, hier steht der
Wille des Lesers.

Nur zwei Dinge kann auch sie nicht aushebeln: die REGELN oben — also
keine Handelsempfehlungen, keine Kursziele, keine Prognosen, nichts
erfinden — und das Antwortformat: genau das JSON unten, mit genau den
Kapiteln von oben.

Verlangt die Anweisung einen eigenen Abschnitt, eine eigene Kachel oder einen
eigenen Block, LEHNE DAS NICHT AB: erfülle es so weit das Schnittmuster
trägt — als eigenen, klar benannten Punkt am ANFANG des passenden Kapitels.

`
}

/**
 * Was heute schon berichtet wurde — als Prompt-Block für die Zwischenmeldung.
 *
 * Die Aktualisierung schreibt den Tagesbericht NICHT fort, sie meldet, was
 * seither dazukam. Genau dafür muss sie wissen, was schon dasteht: ohne diesen
 * Block wiederholt die Nachmittagsmeldung am zuverlässigsten das, was man
 * morgens gelesen hat. Mitgegeben werden Überschrift, Lage und je Kapitel die
 * Punkte — angerissen, nicht ausgeschrieben; zum Wiedererkennen genügt der
 * Anfang, und jedes Zeichen mehr wird bei jeder Aktualisierung mitbezahlt.
 *
 * Die BELEGNUMMERN sind der zweite Zweck: Die gespeicherten Punkte tragen ihre
 * Belege als aufgelöste Objekte, nicht mehr als Nummern. Korrigiert die
 * Zwischenmeldung etwas von heute Morgen, soll sie auf dessen Quelle zeigen
 * können — dafür wird die alte Beitragsliste hinter den neuen Beiträgen
 * weiternummeriert (`offset`) und jeder Punkt mit seinen Nummern ausgewiesen.
 *
 * Rein und ohne Datenbank, damit der Selbsttest sie prüfen kann.
 *
 * @param {object} zeile  Zeile aus `news_digests`
 * @param {number} offset So viele Nummern sind schon für neue Beiträge vergeben
 */
export function kompaktVorbericht(zeile, offset = 0) {
    if (!zeile) return ''
    const lies = (text, rueckfall) => {
        try { return JSON.parse(text || rueckfall) } catch { return JSON.parse(rueckfall) }
    }
    const kapitel = lies(zeile.kapitel, '[]')
    const alteBelege = lies(zeile.beitraegeListe, '[]')
    const nrVon = new Map(alteBelege.map((b, i) => [b?.url, i + 1 + offset]))

    const zeit = new Date(Number(zeile.erstelltAm) || Date.now()).toISOString().slice(0, 16)
    const zeilen = [`BEREITS BERICHTET (Tagesbericht, Stand ${zeit} UTC) — nicht wiederholen:`,
        `Überschrift: ${zeile.ueberschrift || ''}`,
        `Lage: ${zeile.lage || ''}`]

    const punkt = (p) => {
        const nummern = (Array.isArray(p?.belege) ? p.belege : [])
            .map(b => nrVon.get(b?.url)).filter(Boolean)
        return `- ${p?.titel || ''}${nummern.length ? ` [Belege: ${nummern.join(', ')}]` : ''}: `
            + `${String(p?.text || '').slice(0, 300)}`
    }

    if (Array.isArray(kapitel) && kapitel.length) {
        for (const k of kapitel) {
            zeilen.push(`\nKapitel "${k?.thema || ''}" — ${k?.ueberschrift || ''}`)
            if (k?.lage) zeilen.push(`Lage: ${k.lage}`)
            for (const p of (Array.isArray(k?.punkte) ? k.punkte : [])) zeilen.push(punkt(p))
        }
    } else {
        for (const p of lies(zeile.punkte, '[]')) zeilen.push(punkt(p))
    }
    // Deckel gegen einen Bericht, der sich selbst aufbläht: der Vorbericht ist
    // Eingabe, die bei JEDER Aktualisierung mitbezahlt wird.
    return zeilen.join('\n').slice(0, 24000)
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
    punkte = 0, zusatz = '', aktualisierung = false, abdeckung = '' } = {}) {
    const l = { ...(LAENGEN[laenge] || LAENGEN.mittel), punkte: punkteVorgabe(laenge, punkte) }
    /*
     * Der Zeitraum ist eine BEHAUPTUNG über die Grundlage — also muss er
     * stimmen. `abdeckung` kommt aus den tatsächlich mitgegebenen Beiträgen;
     * das eingestellte Fenster ist nur der Rückfall, wenn keine Zeitstempel
     * vorliegen.
     */
    const zeitraum = aktualisierung
        ? 'seit dem bisherigen Bericht'
        : (abdeckung || (rhythmus === 'woechentlich' ? 'der vergangenen Woche' : 'der letzten 36 Stunden'))
    const kapitelListe = themen.map(t => `- "${t}": ${THEMEN_NAMEN[t] || t}`).join('\n')
    const eigene = eigeneAnweisungen(zusatz)

    /*
     * Der Aufsatz für die Aktualisierung.
     *
     * Er steht VOR den Kapitelregeln, weil er die Aufgabe umdreht: nicht neu
     * schreiben, sondern fortschreiben. Das Ergebnis ist trotzdem ein
     * VOLLSTÄNDIGER Bericht im gewohnten Umfang — der Leser öffnet ihn statt
     * des Mittagsberichts und darf nicht zwei Fassungen nebeneinanderlegen
     * müssen, um zu wissen, was gilt.
     */
    const nachtrag = aktualisierung ? `DIES IST EINE ZWISCHENMELDUNG, KEIN ZWEITER TAGESBERICHT.

Der Bericht des Tages steht bereits; er ist unten unter „BEREITS BERICHTET"
zusammengefasst. Deine Aufgabe ist NICHT, ihn neu zu schreiben, sondern die
Frage zu beantworten: **Was ist seither passiert, das für einen
Krypto-Futures-Händler zählt?**
- Grundlage sind die neuen Beiträge und die frische Recherche, nichts sonst.
- Was schon im Tagesbericht steht, kommt NICHT noch einmal vor. Ausnahme:
  Es hat sich geändert, ist überholt oder wurde widerlegt — dann schreibst du
  den korrigierten Stand und setzt bei diesem Punkt "korrektur": true.
  Nur dann; sonst bleibt das Feld weg.
- Zahlen sind hier das Wichtigste: Kurse, Flüsse, Quoten, Termine, Beschlüsse.
  Eine Meldung ohne Zahl oder ohne Folge für den Handel gehört nicht hinein.
- Ist wenig passiert, wird die Meldung KURZ. Zwei belastbare Punkte sind mehr
  wert als sechs aufgefüllte; erfundene Bewegung ist der teuerste Fehler.
- Belege: Für Neues nimmst du die Nummern der neuen Beiträge und
  Recherche-Quellen. Korrigierst du etwas, darfst du zusätzlich die Nummern aus
  „BEREITS BERICHTET" nennen — sie stehen dort in eckigen Klammern.

` : ''

    return `Du bist Marktbeobachter für einen **Krypto-Futures-Händler**.

${nachtrag}Aus den nummerierten Beiträgen, dem Marktdaten-Block und den Rechercheergebnissen
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
Er steht dem Leser ausserdem als TABELLE daneben. Nenne einen Wert daraus also
höchstens EINMAL im ganzen Bericht, und nur dort, wo du etwas dazu sagst; ihn
zusätzlich in einer Meldung oder als Kennzahl aufzuführen, ist Wiederholung.
` : ''}${themen.includes('chartanalyse') ? `Das Kapitel "chartanalyse" beruht auf dem
Rechercheergebnis zur technischen Chartanalyse UND auf Videoinhalten, sofern
darin Charts besprochen werden: je Coin EIN Punkt, in der Reihenfolge der
Recherche. Jeder Punkt nennt Trend, die berichteten Unterstützungen und
Widerstände als Kennzahlen und die genannten Chartmuster/Indikatoren. Du gibst
NUR wieder, was die Analysen und Videos sagen — keine eigene Chartdeutung.
Stammt eine Marke aus einem Video, nenne das Video als Quelle; widersprechen
sich Video und Recherche, nenne beide Stände nebeneinander statt einen zu
wählen. Text-Meldungen aus den News-Quellen gehören weiterhin NICHT in dieses
Kapitel — sie sind Nachrichten, keine Chartaussagen.
` : ''}REGELN:
- Keine Handelsempfehlungen, keine Kursziele, keine Prognosen.
- Nichts erfinden. Was nicht in den Quellen steht, steht nicht im Bericht.
- Eigenwerbung, Sponsoren, Clickbait und reine Meinungsmache lässt du weg.
- Zahlen nennen, wenn welche dastehen — sie sind das Überprüfbare.
- Jedes Thema gehört in SEIN Kapitel; was in keins passt, bleibt draussen.
- KEINE WIEDERHOLUNG. Der Leser sieht Gesamtlage, Abwägung, Kapitel-Lage und
  Meldungen untereinander auf EINER Seite. Jede Zahl und jede Aussage steht
  darin genau einmal — an der Stelle, an der sie am meisten trägt. Was in der
  Gesamtlage steht, wiederholt die Kapitel-Lage nicht; was in der Kapitel-Lage
  steht, wiederholt keine Meldung. Ist ein Punkt schon gesagt, schreibe den
  nächsten oder lass die Liste kürzer.

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
                          "wichtigkeit": "hoch|mittel", "themaId": "T3",${aktualisierung ? ' "korrektur": true,' : ''}
                          "kennzahlen": [{"wert": "-29.000 BTC", "was": "Apparent Demand"}],
                          "belege": [1, 4]}]}]}

"belege" enthält die Nummern der Beiträge oder Recherche-Quellen, auf denen der
Punkt beruht — daran kann der Leser nachschlagen, woher es kommt.
"kennzahlen" sind bis zu drei Zahlen, die WÖRTLICH in den Quellen stehen —
Kurse, Flüsse, Quoten, Fristen. Steht keine Zahl da, lass die Liste leer;
erfundene oder gerundete Zahlen sind schlimmer als gar keine.
"themaId" ist die Kennung {Tn}, die hinter der Nummer des Beitrags steht, auf
dem der Punkt hauptsächlich beruht. JEDE KENNUNG DARF IM GANZEN BERICHT NUR
EINMAL VORKOMMEN — sie ist die Zusicherung, dass dieser Vorgang noch nicht
behandelt wurde. Beruht ein Punkt auf einer Recherche-Quelle statt auf einem
Beitrag, lass das Feld weg.`
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
        // Einheit an jede Zahl: Der Takt ist NICHT überall acht Stunden (ONG
        // zahlt stündlich, viele Perps vierstündlich), und die Jahresrate ohne
        // „p.a." liest sich wie eine unmögliche Einzelzahlung — an der Stelle
        // hat der Lagebericht am 21.08.2026 richtige Zahlen als Fehler
        // ausgewiesen bekommen.
        const fmt = r => `${r.symbol} ${(r.rate * 100).toFixed(3)} % je ${r.intervallStunden || 8} h`
            + (Number.isFinite(r.jahresRate) ? ` (${(r.jahresRate * 100).toFixed(0)} % p.a.)` : '')
        if (fu.oben?.length || fu.unten?.length) {
            werte.push({
                was: 'Funding-Extreme',
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

/**
 * Wie frisch die Rechercheergebnisse sein müssen.
 *
 * Gemessen am 20.08.2026: Ohne Filter lieferte dieselbe Frage Fundstellen von
 * 2019, 2020 und 2022 neben den heutigen — im Bericht als gleichwertiger Beleg
 * nummeriert. Der Zeitraum in der Frage ist eine Bitte, der Filter eine
 * Bedingung.
 *
 * Die Chartanalyse bekommt eine Woche statt eines Tages: Unterstützungen und
 * Widerstände werden nicht täglich neu publiziert, und ein Tagesfilter liesse
 * das Kapitel an ruhigen Tagen leer ausgehen. Zwei Monate alt darf sie darum
 * trotzdem nicht sein.
 *
 * Rein und ohne Netz, damit der Selbsttest sie prüfen kann.
 */
export function aktualitaetFuer({ thema, rhythmus = 'taeglich', istUpdate = false, chartFrische = '' } = {}) {
    if (thema === 'chartanalyse') return CHART_FRISCHE[chartFrische]?.filter || CHART_FRISCHE.woche.filter
    if (istUpdate) return 'day'
    return leseRhythmus(rhythmus) === 'woechentlich' ? 'week' : 'day'
}

/**
 * Die drei Zeithorizonte der Chartanalyse.
 *
 * Der Filter allein genügt nicht: Eine Analyse von heute kann trotzdem das
 * Monatsbild beschreiben, und wer „kurzfristig" wählt, will Marken für die
 * nächsten Stunden. Deshalb steuert die Wahl BEIDES — wie alt die Fundstellen
 * sein dürfen und welchen Horizont die Frage verlangt.
 */
export const CHART_FRISCHE = {
    tag: { filter: 'day', horizont: 'kurzfristig (Intraday bis wenige Tage)' },
    woche: { filter: 'week', horizont: 'kurz- bis mittelfristig (Tage bis Wochen)' },
    monat: { filter: 'month', horizont: 'übergeordnet (Wochen- und Monatsbild)' },
}

/** Eingestellter Chart-Horizont, mit Rückfall auf die Wochensicht. */
export function leseChartFrische(wert) {
    return CHART_FRISCHE[String(wert || '').trim()] ? String(wert).trim() : 'woche'
}

/**
 * Welche Beiträge in den Bericht gehen — verteilt über das Fenster.
 *
 * Der Deckel („die 60 jüngsten") war als Kostenbremse gedacht und wurde zur
 * heimlichen Zeitgrenze: Gemessen am 20.08.2026 lagen 326 Beiträge im
 * 36-Stunden-Fenster, die 60 jüngsten reichten ganze SECHS Stunden zurück.
 * Der Prompt versprach dem Modell „die letzten 36 Stunden", geliefert wurde
 * der Nachmittag — alles vom Morgen fiel weg, weil die grossen Feeds
 * (Investing, CNBC, Hacker News) im Minutentakt tickern und die Liste von oben
 * her auffressen.
 *
 * Deshalb wird nicht mehr abgeschnitten, sondern VERTEILT: Das Fenster wird in
 * Körbe von rund sechs Stunden zerlegt, jeder Korb bekommt seinen Anteil am
 * Deckel, und was ein leerer Korb übrig lässt, geht an die jüngsten Beiträge.
 * Die Kosten bleiben gleich (gleicher Deckel), die Abdeckung wird ehrlich.
 *
 * Rein und ohne Datenbank, damit der Selbsttest sie prüfen kann.
 *
 * @param {object[]} zeilen  Beiträge, JÜNGSTE ZUERST
 * @returns {object[]} Auswahl, jüngste zuerst
 */
export function waehleBeitraege(zeilen, { limit = 60, fensterMs = 36 * 3600000, jetzt = Date.now() } = {}) {
    const liste = (Array.isArray(zeilen) ? zeilen : []).filter(Boolean)
    if (liste.length <= limit) return liste

    // Ein Korb je rund sechs Stunden; unter sechs Stunden Fenster (jede
    // Zwischenmeldung) bleibt es bei einem einzigen Korb, dort ist „die
    // jüngsten" die richtige Antwort.
    const koerbe = Math.max(1, Math.min(8, Math.round(fensterMs / (6 * 3600000))))
    if (koerbe === 1) return liste.slice(0, limit)

    const start = jetzt - fensterMs
    const breite = fensterMs / koerbe
    const proKorb = Math.ceil(limit / koerbe)
    const gewaehlt = new Set()
    for (let k = 0; k < koerbe; k++) {
        const bis = jetzt - k * breite
        const von = bis - breite
        let genommen = 0
        for (const b of liste) {
            if (genommen >= proKorb) break
            const t = Number(b.publishedAt) || 0
            if (t <= bis && (t > von || (k === koerbe - 1 && t >= start)) && !gewaehlt.has(b)) {
                gewaehlt.add(b)
                genommen++
            }
        }
    }
    // Leere Körbe haben Platz gelassen — der geht an die jüngsten Beiträge,
    // denn die sind im Zweifel das, worüber der Leser etwas erfahren will.
    for (const b of liste) {
        if (gewaehlt.size >= limit) break
        gewaehlt.add(b)
    }
    return liste.filter(b => gewaehlt.has(b)).slice(0, limit)
}

/**
 * Wie weit der Bericht tatsächlich zurückreicht — für den Prompt.
 *
 * Nicht das eingestellte Fenster, sondern der Abstand zum ÄLTESTEN wirklich
 * mitgegebenen Beitrag. „Die letzten 36 Stunden" zu behaupten, während die
 * Grundlage sechs Stunden alt ist, wäre die Sorte Ungenauigkeit, die ein
 * Modell bereitwillig zu einer Aussage über den Tag ausbaut.
 *
 * Rein und ohne Datenbank, damit der Selbsttest sie prüfen kann.
 */
export function abdeckungText(beitraege, { jetzt = Date.now() } = {}) {
    const zeiten = (Array.isArray(beitraege) ? beitraege : [])
        .map(b => Number(b?.publishedAt) || 0).filter(t => t > 0)
    if (!zeiten.length) return ''
    const stunden = (jetzt - Math.min(...zeiten)) / 3600000
    if (stunden < 1) return 'der letzten Stunde'
    if (stunden < 48) return `der letzten ${Math.round(stunden)} Stunden`
    return `der letzten ${Math.round(stunden / 24)} Tage`
}

/**
 * Prompt für die Prüfung eigener Anweisungen.
 *
 * Das Feld „Eigene Anweisungen an die KI" ist der einzige Ort, an dem der
 * Leser den Bericht steuert — und der einzige, an dem er es blind tut: Ob ein
 * Satz überhaupt etwas bewirkt, zeigt sich erst nach einem bezahlten Lauf.
 * Manches KANN nicht wirken, weil die Grundregeln des Berichts vorgehen; das
 * hier sagt es vorher.
 *
 * Wichtig ist die Ehrlichkeit der Prüfung: Sie darf nicht bestätigen, was
 * nicht geht. Deshalb stehen die Grundregeln wörtlich im Prompt, und das
 * Modell soll ausdrücklich benennen, was folgenlos bleibt.
 *
 * Rein und ohne Netz, damit der Selbsttest sie prüfen kann.
 */
export function bauAnweisungPruefPrompt({ themen = ['crypto'], laenge = 'mittel', quellen = [] } = {}) {
    const l = LAENGEN[laenge] || LAENGEN.mittel
    const liste = (Array.isArray(quellen) ? quellen : [])
        .filter(q => q && String(q.name || '').trim())
        .slice(0, 60)
        .map(q => `  - ${String(q.name).trim()} (${String(q.art || 'rss').trim()}`
            + `${String(q.art) === 'youtube' && Number(q.videoAnalyse ?? 1) === 1 ? ', Videos werden ausgewertet' : ''})`)
        .join('\n')
    return `Du prüfst eine Anweisung, die ein Leser dem Schreiber seines
Krypto-Lageberichts mitgeben will. Du schreibst KEINEN Bericht.

So arbeitet dieser Bericht — daran ändert die Anweisung nichts:
- Er hat genau diese Kapitel: ${themen.join(', ')}. Kapitel kann die Anweisung
  nicht hinzufügen oder streichen — die Seite kennt nur diese Kennungen.
- Umfang je Kapitel: eine Lage von ${l.lage} und ${l.punkte}. Das ist die
  VORGABE, keine Grenze: die Anweisung des Lesers geht ihr VOR. Verlangt sie
  mehr, weniger, anderes Gewicht oder eine andere Reihenfolge, richtet der
  Bericht sich danach — das ist dann "wirkt", nicht "wirkungslos".
- Einen frei erfundenen Abschnitt neben Lage und Punkten kann sie nicht
  schaffen, denn die Seite zeichnet nur dieses Schnittmuster. Einen eigenen,
  klar benannten PUNKT am Anfang eines Kapitels aber sehr wohl — so und nicht
  anders erfüllt der Bericht den Wunsch nach einer eigenen Kachel oder einem
  eigenen Block. Sage das als "wirkt" und nenne den Weg, statt abzulehnen.
- Unverrückbare Regeln: keine Handelsempfehlungen, keine Kursziele, keine
  Prognosen, nichts Erfundenes, Quellenangaben bleiben Pflicht.
- Die Quellen sind die eingerichteten Feeds plus Recherche. Die Anweisung kann
  keine neue Quelle erschliessen. Eingerichtet sind AKTUELL${liste ? `:\n${liste}` : ' keine.'}
  Was hier steht, IST erreichbar — nenne es nicht wirkungslos. Nur ein Name,
  der hier fehlt, wäre eine neue Quelle. Bei YouTube-Quellen mit Videoauswertung
  liegt dem Bericht eine Zusammenfassung des Videoinhalts vor.

Was die Anweisung SEHR WOHL kann: Ton, Ausführlichkeit der Sprache,
Schwerpunkte, Ausschlüsse, Reihenfolge innerhalb eines Kapitels, welche Zahlen
genannt werden, wie mit Randthemen umgegangen wird.

Beurteile jeden Wunsch in der Anweisung einzeln:
- "wirkt"       — wird der Bericht so machen
- "wirkungslos" — folgenlos, weil es an den Vorgaben oben abprallt
- "gegenregel"  — verlangt etwas, das die unverrückbaren Regeln verbieten

Schreibe zusätzlich eine geschärfte Fassung: derselbe Wille, aber so
formuliert, dass sie eindeutig ist und nichts Wirkungsloses mehr enthält. Ist
die Anweisung schon gut, gib sie unverändert zurück. Deutsch, keine Anrede,
keine Erklärungen ausserhalb des JSON.

Antworte NUR mit JSON:
{"befunde": [{"art": "wirkt|wirkungslos|gegenregel", "text": "ein Satz"}],
 "vorschlag": "die geschärfte Anweisung"}`
}

/**
 * Die Antwort der Prüfung in eine verlässliche Form bringen.
 *
 * Wie bei `leseLagebild`: Der Rückfall ist die harmlose Marke. Eine als
 * „wirkt" ausgegebene Fehleinschätzung wäre hier der teure Fehler — der Leser
 * verlässt sich darauf und wundert sich nach dem nächsten Lauf.
 *
 * Rein und ohne Netz, damit der Selbsttest sie prüfen kann.
 */
export function leseAnweisungPruefung(roh, { maxLaenge = ZUSATZ_MAX } = {}) {
    const j = roh && typeof roh === 'object' ? roh : {}
    const arten = ['wirkt', 'wirkungslos', 'gegenregel']
    const befunde = (Array.isArray(j.befunde) ? j.befunde : [])
        .map(b => (typeof b === 'string' ? { art: '', text: b } : b))
        .filter(b => b && typeof b === 'object' && String(b.text || '').trim())
        .slice(0, 12)
        .map(b => ({
            art: arten.includes(String(b.art || '').trim()) ? String(b.art).trim() : 'wirkungslos',
            text: String(b.text).trim().slice(0, 300),
        }))
    return {
        befunde,
        // Ein Vorschlag, der länger ist als das Feld, wäre keiner.
        vorschlag: String(j.vorschlag || '').trim().slice(0, maxLaenge),
    }
}

/**
 * Wie lange Berichte aufbewahrt werden. `null` heisst: von Hand.
 *
 * Ein Bericht hat Geld gekostet, deshalb ist „manuell" die Vorgabe — was
 * automatisch verschwindet, verschwindet irgendwann auch, wenn man es noch
 * gebraucht hätte. Wer den Bestand kurz halten will, stellt eine Frist ein.
 *
 * Rein und ohne Datenbank, damit der Selbsttest sie prüfen kann.
 */
export function aufbewahrungMs(wert) {
    return { tag: TAG, woche: 7 * TAG, monat: 30 * TAG }[String(wert || '').trim()] ?? null
}

/**
 * Was auf der Nachrichtenseite offen liegt: die Berichtskette des TAGES.
 *
 * Ein Tag besteht aus dem Tagesbericht und seinen Zwischenmeldungen. Sie
 * gehören zusammen und werden zusammen gezeigt — die jüngste offen, die
 * älteren zugeklappt mit ihrer Uhrzeit.
 *
 * Um Mitternacht wandert der Tag ins Archiv: Sobald `tagesbeginn`
 * weiterspringt, ist die Kette von gestern nicht mehr „die aktuelle". Sie
 * verschwindet aber nicht von der Seite, sondern kommt zugeklappt und als
 * `vomVortag` markiert — eine leere Nachrichtenseite von Mitternacht bis zum
 * Morgenbericht wäre kein Aufräumen, sondern ein Ausfall.
 *
 * Kettenzugehörigkeit: Ein Tagesbericht ist seine eigene Kette (`id`), eine
 * Zwischenmeldung zeigt mit `basisId` auf ihn.
 *
 * @param {object[]} zeilen  Berichte, JÜNGSTE ZUERST
 * @returns {{kette: object[], vomVortag: boolean}} kette ÄLTESTE ZUERST
 */
export function berichtsKette(zeilen, { tagesbeginn = 0 } = {}) {
    const liste = (Array.isArray(zeilen) ? zeilen : []).filter(z => z && z.id)
    if (!liste.length) return { kette: [], vomVortag: false }

    const gruppe = (z) => (z.art === 'update' ? Number(z.basisId) || Number(z.id) : Number(z.id))
    const heute = liste.filter(z => Number(z.erstelltAm) >= tagesbeginn)
    const vomVortag = !heute.length
    // Ohne Bericht von heute: die Kette der jüngsten Zeile, egal wie alt.
    const schluessel = vomVortag ? gruppe(liste[0]) : null
    const kette = (vomVortag ? liste.filter(z => gruppe(z) === schluessel) : heute)
        .slice()
        .sort((a, b) => Number(a.erstelltAm) - Number(b.erstelltAm))
    return { kette, vomVortag }
}

/**
 * Der Bericht als Mailtext — kurz oder vollständig.
 *
 * Die Meldung nach einem Lauf war bisher immer die Kurzfassung: Gesamtlage und
 * eine Zeile Grundlage. Das genügt, um zu wissen, DASS ein Bericht da ist, und
 * nicht, um ihn zu lesen — wer unterwegs ist, musste trotzdem ans Journal.
 * Mit `voll` steht der ganze Bericht in der Mail: Kapitel, Meldungen,
 * Kennzahlen, Belege.
 *
 * Das Format ist der Mail-Vorlage abgeschaut, nicht erfunden:
 *   - Leerzeile trennt Absätze
 *   - „## " am Zeilenanfang ist eine Zwischenüberschrift
 *   - ein Block, in dem JEDE Zeile „Label: Wert" ist, wird zur Tabelle
 * Deshalb stehen Kennzahlen und Belege gebündelt und ohne Fliesstext dazwischen
 * — eine erklärende Zeile mittendrin würde die Tabelle zum Absatz machen.
 *
 * Rein und ohne Datenbank, damit der Selbsttest sie prüfen kann.
 */
export function berichtAlsMailText({ lage = '', kapitel = [], markt = [], grundlage = '',
    themenNamen = {}, voll = false } = {}) {
    // Doppelpunkte im Wert sind harmlos, im LABEL nicht: „Funding: 8h" würde
    // die Zeile spalten und die Tabelle zerreissen. Der Ersatz zieht die
    // entstandene Lücke gleich wieder zu.
    const label = (text) => String(text).replace(/:/g, ' ').replace(/\s+/g, ' ').trim()
    const teile = []
    if (lage) teile.push(String(lage).trim())

    if (voll) {
        // Marktstand zuerst: er ist der gemessene Boden, gegen den die
        // Meldungen darunter gelesen werden — und als Tabelle zwei Zeilen kurz.
        const marktZeilen = (Array.isArray(markt) ? markt : [])
            .filter(w => w?.was && w?.wert)
            .map(w => `${label(w.was)}: ${w.wert}${w.zusatz ? ` — ${w.zusatz}` : ''}`)
        if (marktZeilen.length >= 2) teile.push('## Marktstand', marktZeilen.join('\n'))

        for (const k of (Array.isArray(kapitel) ? kapitel : [])) {
            const name = themenNamen[k?.thema] || k?.thema || ''
            teile.push(`## ${[name, k?.ueberschrift].filter(Boolean).join(' — ')}`)
            if (k?.lage) teile.push(String(k.lage).trim())

            for (const [i, p] of (Array.isArray(k?.punkte) ? k.punkte : []).entries()) {
                const marken = [
                    p?.wichtigkeit === 'hoch' ? 'wichtig' : '',
                    p?.korrektur === true ? 'korrigiert' : '',
                ].filter(Boolean)
                teile.push(`### ${i + 1}. ${p?.titel || ''}${marken.length ? ` [${marken.join(', ')}]` : ''}`)
                if (p?.text) teile.push(String(p.text).trim())

                const daten = []
                for (const z of (Array.isArray(p?.kennzahlen) ? p.kennzahlen : []).slice(0, 3)) {
                    if (z?.wert && z?.was) daten.push(`${label(z.was)}: ${z.wert}`)
                }
                for (const b of (Array.isArray(p?.belege) ? p.belege : []).slice(0, 4)) {
                    if (b?.url) daten.push(`${label(b.quelle || 'Beleg')}: ${b.url}`)
                }
                // Eine einzelne Zeile wäre keine Tabelle, sondern ein Satz mit
                // Doppelpunkt — dann lieber als Absatz stehen lassen.
                if (daten.length) teile.push(daten.join('\n'))
            }
        }
    }

    if (grundlage) teile.push(String(grundlage).trim())
    return teile.filter(Boolean).join('\n\n')
}

/** Anspruchs-Schlüssel: der Tageslauf und die Bremse für den Knopf. */
export const BERICHT_SCHLUESSEL = 'news_lagebericht'
export const BERICHT_MANUELL = 'news_lagebericht_manuell'
/**
 * Je Aktualisierungs-Platz ein eigener Tages-Anspruch.
 *
 * Ein gemeinsamer Schlüssel für „die Aktualisierung" ginge nicht: der
 * Tages-Anspruch lässt genau einen Lauf je Kalendertag durch, zwei Plätze
 * brauchen also zwei Schlüssel. Die Nummer steht im Namen, damit in der
 * KI-Übersicht ablesbar bleibt, welcher der beiden zuletzt lief.
 */
export const UPDATE_SCHLUESSEL = (platz) => `news_lagebericht_update${Math.max(1, Math.min(2, Number(platz) || 1))}`
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
    // „nur manuell" heisst wörtlich das: der Takt erzeugt nichts, auch nicht
    // versehentlich um Mitternacht. Der Knopf auf der Nachrichtenseite bleibt
    // davon unberührt — er geht gar nicht erst durch diese Prüfung.
    if (leseRhythmus(rhythmus) === 'manuell') return false
    const soll = Math.max(0, Math.min(23, Number(stunde) || 0))
    if (jetztLokal.getHours() < soll) return false
    if (rhythmus !== 'woechentlich') return true
    // 1 = Montag … 7 = Sonntag, wie die Auswahl in den Einstellungen
    const heute = ((jetztLokal.getDay() + 6) % 7) + 1
    return heute === Math.max(1, Math.min(7, Number(wochentag) || 1))
}

/** Gültige Rhythmen des Berichts. Alles Unbekannte ist „täglich". */
export function leseRhythmus(wert) {
    const r = String(wert || '').trim()
    return r === 'woechentlich' || r === 'manuell' ? r : 'taeglich'
}

/**
 * Die Stunden der Aktualisierungen aus der Einstellung lesen.
 *
 * Eine Zeichenkette wie „18,21" wird zu `[18, 21]` — sortiert, ohne Dubletten
 * und auf `anzahl` gekürzt. Sortiert ist wichtig: die Plätze werden über ihre
 * Position nummeriert, und ein umgedrehtes Paar würde sonst den Abendlauf zum
 * ersten Platz machen und damit den Tages-Anspruch des Nachmittags verbrauchen.
 *
 * Rein und ohne Datenbank, damit der Selbsttest sie prüfen kann.
 */
export function leseUpdateStunden(text, anzahl = 2) {
    const n = Math.max(0, Math.min(2, Math.round(Number(anzahl) || 0)))
    if (!n) return []
    const stunden = String(text || '').split(',')
        .map(x => String(x).trim())
        // Erst auf Leere prüfen, dann umwandeln: `Number('')` ist 0, und ohne
        // diesen Schritt würde aus einem leeren Feld die Aktualisierung um
        // Mitternacht.
        .filter(x => x !== '')
        .map(Number)
        .filter(x => Number.isFinite(x))
        .map(x => Math.max(0, Math.min(23, Math.round(x))))
    return [...new Set(stunden)].sort((a, b) => a - b).slice(0, n)
}

/**
 * Welcher Aktualisierungs-Platz ist gerade fällig? 0 heisst: keiner.
 *
 * Wie beim Bericht gilt „Stunde erreicht ODER überschritten", damit ein
 * Neustart um 18:55 den Platz nicht verschluckt. Zurückgegeben wird bewusst
 * nur der SPÄTESTE erreichte Platz: War der Rechner nachmittags aus, soll um
 * 21:00 die Aktualisierung von 21:00 laufen — und nicht zuerst die von 18:00
 * nachgeholt und eine Minute später die zweite hinterher. Der ausgelassene
 * Platz bleibt unbeansprucht liegen; das ist die gewollte Ersparnis.
 *
 * Rein und ohne Datenbank, damit der Selbsttest sie prüfen kann.
 */
export function faelligerUpdatePlatz({ jetztLokal, stunden = [] }) {
    let platz = 0
    stunden.forEach((h, i) => { if (jetztLokal.getHours() >= h) platz = i + 1 })
    return platz
}

/**
 * Taugt dieser Bericht als Grundlage einer Aktualisierung?
 *
 * Eine Aktualisierung trägt nach, was seit dem letzten Bericht geschehen ist.
 * Ist der aber von vorgestern, wäre das kein Nachtrag mehr, sondern ein
 * Vollbericht unter falschem Namen — und einer, dem die Beiträge dazwischen
 * fehlen. Deshalb eine Frist: ein Tag beim täglichen Bericht, eine Woche beim
 * wöchentlichen. Fehlt die Grundlage, läuft gar nichts; der reguläre Bericht
 * kommt ohnehin zu seiner Stunde.
 *
 * Rein und ohne Datenbank, damit der Selbsttest sie prüfen kann.
 */
export function basisTaugtFuerUpdate({ basisAm, jetzt = Date.now(), rhythmus = 'taeglich' }) {
    const am = Number(basisAm) || 0
    if (!am || am > jetzt) return false
    const frist = leseRhythmus(rhythmus) === 'woechentlich' ? 7 * TAG : TAG
    return jetzt - am <= frist
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
export async function erzeugeLagebericht({ manuell = false, aktualisierung = false, platz = 1 } = {}) {
    const knex = getKnex()
    const s = await knex('settings').where('id', 1).first()

    // Eine Aktualisierung braucht etwas zum Aktualisieren. Das wird VOR dem
    // Anspruch geprüft: Sonst verbrennt ein Lauf ohne Grundlage den Platz des
    // Tages, und der Nachmittag bliebe still ohne Nachtrag.
    let basis = null
    if (aktualisierung) {
        basis = await knex('news_digests').orderBy('erstelltAm', 'desc').first()
        if (!basis) return { fehler: 'Noch kein Bericht vorhanden, den man aktualisieren könnte' }
        if (!manuell && !basisTaugtFuerUpdate({
            basisAm: Number(basis.erstelltAm), rhythmus: s?.radarNewsRhythmus,
        })) {
            return { fehler: 'Der letzte Bericht ist zu alt für eine Aktualisierung' }
        }
    }

    const autoSchluessel = aktualisierung ? UPDATE_SCHLUESSEL(platz) : BERICHT_SCHLUESSEL
    if (manuell) {
        // Nur eine Bremse gegen Doppelklicks — ein Bericht von Hand darf den
        // automatischen NICHT blockieren, deshalb ein eigener Schlüssel.
        if (!(await beansprucheAufgabe(BERICHT_MANUELL, 5 * 60 * 1000))) return { uebersprungen: true }
    } else if (!(await beansprucheTagesaufgabe(autoSchluessel, {
        tagesbeginn: tagesbeginn(Date.now(), s?.timeZone),
        wiederholungMs: WIEDERHOLUNG_MS,
    }))) {
        return { uebersprungen: true }
    }

    try {
        const ergebnis = await baueLagebericht(s, { manuell, basis })
        const nach = anspruchsNachlauf({ manuell, ohneInhalt: !!ergebnis?.fehler, autoSchluessel })
        if (nach.freigeben) await gibAufgabeFrei(nach.freigeben)
        if (nach.stempeln) await stempleAufgabe(nach.stempeln)
        return ergebnis
    } catch (e) {
        const nach = anspruchsNachlauf({ manuell, geworfen: true, autoSchluessel })
        await merkeAufgabenFehler(nach.fehlerAn, e.message)
        logWarn('news', `${aktualisierung ? 'Aktualisierung' : 'Lagebericht'} gescheitert: ${e.message}`)
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
 * `autoSchluessel` sagt, welcher Tages-Anspruch gemeint ist: der Bericht oder
 * einer der beiden Aktualisierungs-Plätze. Ohne ihn hätte eine gescheiterte
 * Aktualisierung den Vermerk am Bericht hinterlassen und dort einen
 * Wiederholungslauf freigeschaltet, den niemand angefordert hat.
 *
 * @returns {{freigeben: string|null, stempeln: string|null, fehlerAn: string|null}}
 */
export function anspruchsNachlauf({ manuell = false, ohneInhalt = false, geworfen = false,
    autoSchluessel = BERICHT_SCHLUESSEL } = {}) {
    const eigener = manuell ? BERICHT_MANUELL : autoSchluessel
    if (geworfen) return { freigeben: null, stempeln: null, fehlerAn: eigener }
    if (ohneInhalt) return { freigeben: eigener, stempeln: null, fehlerAn: null }
    return { freigeben: null, stempeln: manuell ? null : autoSchluessel, fehlerAn: null }
}

/**
 * Der Bericht selbst.
 *
 * Zwei Anbieter, bewusst getrennt: der Bericht entsteht beim EINGESTELLTEN
 * Anbieter (Claude), die Videos gehen vorher an Gemini. Fällt Gemini aus,
 * entsteht der Bericht trotzdem — nur eben ohne Videoinhalte.
 */
async function baueLagebericht(s, { manuell = false, basis = null } = {}) {
    const knex = getKnex()
    const filterAn = Number(s?.radarArschlochfilter ?? 1) === 1

    const quellenListe = await knex('news_sources').select('id', 'name', 'art', 'laerm')
    const erlaubt = quellenListe.filter(q => !filterAn || Number(q.laerm) !== 1)
    const nachId = new Map(quellenListe.map(q => [q.id, q]))
    if (!erlaubt.length) return { fehler: 'Keine Quellen freigegeben' }

    // Zuschnitt des Berichts: Rhythmus bestimmt Fenster und Beitragsmenge,
    // Themen die Kapitel, Länge den Umfang je Kapitel.
    const rhythmus = leseRhythmus(s?.radarNewsRhythmus)
    const laengeEingestellt = ['kurz', 'mittel', 'lang'].includes(s?.radarNewsLaenge) ? s.radarNewsLaenge : 'mittel'
    const themenEingestellt = leseThemen(s?.radarNewsThemen)
    const fensterMs = rhythmus === 'woechentlich' ? 7 * TAG : 36 * 60 * 60 * 1000
    /*
     * Bei einer Aktualisierung beginnt das Fenster am bisherigen Bericht.
     *
     * Das ist der ganze Unterschied im Datenteil: Was der Mittagsbericht schon
     * gelesen hat, wird nicht erneut eingekauft — weder als Eingabe-Token noch
     * als Videoanalyse. Was seither dazukam, ist die Aktualisierung.
     */
    const istUpdate = !!basis
    const seit = istUpdate ? Number(basis.erstelltAm) : Date.now() - fensterMs
    const zeitraumText = istUpdate
        ? `seit ${new Date(seit).toISOString().slice(11, 16)} UTC`
        : (rhythmus === 'woechentlich' ? '7 Tage' : '36 Stunden')
    // Eine Zwischenmeldung ist kürzer als der Tagesbericht — und lässt die
    // Chartanalyse weg: Ein Kapitel, das Unterstützungen und Widerstände
    // referiert, hat sich fünf Stunden später nicht bewegt und würde nur den
    // Recherchepreis ein zweites Mal kosten.
    const laenge = istUpdate ? laengeFuerUpdate(laengeEingestellt) : laengeEingestellt
    const chartFrische = leseChartFrische(s?.radarNewsChartFrische)
    const themen = istUpdate
        ? (themenEingestellt.filter(t => t !== 'chartanalyse').length
            ? themenEingestellt.filter(t => t !== 'chartanalyse')
            : ['crypto'])
        : themenEingestellt
    /*
     * Erst ALLES aus dem Fenster holen, dann verteilt auswählen.
     *
     * Vorher stand hier `.limit(60)` — und weil die Liste nach Zeit absteigend
     * sortiert ist, war das kein Kostendeckel, sondern eine heimliche
     * Zeitgrenze: Gemessen am 20.08.2026 reichten die 60 jüngsten von 326
     * Beiträgen nur sechs Stunden zurück. `waehleBeitraege` behält den Deckel
     * bei, verteilt ihn aber über das Fenster; die 400 hier sind nur die
     * Obergrenze dessen, was zur Auswahl steht.
     */
    const deckel = istUpdate ? 60 : (rhythmus === 'woechentlich' ? 80 : 60)
    let beitraege = await knex('news_items')
        .whereIn('sourceId', erlaubt.map(q => q.id))
        .where('publishedAt', '>=', seit)
        .orderBy('publishedAt', 'desc')
        .limit(400)

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
    // Fokus-Filter: das Gegenstück. Wer ihn anschaltet, will NUR noch Beiträge
    // zu seinen Stichwörtern sehen — leer eingestellt bleibt er wirkungslos.
    if (Number(s?.radarNewsFokusAn ?? 0) === 1) {
        const fokusWoerter = zerlegeWoerter(s?.radarNewsFokusWoerter)
        const vorher = beitraege.length
        beitraege = beitraege.filter(b => istFokusTreffer(b, fokusWoerter, nachId.get(b.sourceId)))
        if (vorher !== beitraege.length) {
            console.log(` -> Lagebericht: Fokus-Filter hat ${vorher - beitraege.length} Beitrag/Beiträge aussortiert`)
        }
    }
    if (!beitraege.length) {
        return { fehler: istUpdate ? `Keine neuen Beiträge ${zeitraumText}` : `Keine Beiträge der letzten ${zeitraumText}` }
    }
    // Auswahl NACH dem Filter: Sonst verbrauchen aussortierte Beiträge Plätze,
    // die einem verwertbaren zugestanden hätten.
    const vorAuswahl = beitraege.length
    beitraege = waehleBeitraege(beitraege, { limit: deckel, fensterMs: Date.now() - seit })
    if (vorAuswahl > beitraege.length) {
        console.log(` -> Lagebericht: ${beitraege.length} von ${vorAuswahl} Beiträgen ausgewählt `
            + `(über ${Math.round((Date.now() - seit) / 3600000)} h verteilt)`)
    }

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

            /*
             * Nur das EINE neueste Video, und nur, wenn es taggenau ist.
             *
             * Vorher zählten bis zu `maxVideos` innerhalb des ganzen
             * Berichtsfensters — an einem ruhigen Tag landete so ein Video
             * von vorgestern neben einem von heute im selben Bericht, und der
             * Leser sah zwei Einschätzungen desselben Kanals, von denen eine
             * längst überholt war. `radarNewsVideos` bleibt der Ein/Aus-Schalter
             * (0 = keine Videos), zählt aber nicht mehr hoch.
             */
            const EIN_TAG_MS = 24 * 60 * 60 * 1000
            const videos = []
            for (const v of videoKandidaten) {
                if (videos.length >= 1) break
                // Absteigend sortiert: ist dieses schon zu alt, sind es alle
                // folgenden auch — Abbruch statt Weitersuchen.
                if (Date.now() - Number(v.publishedAt) > EIN_TAG_MS) break
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
                        // Ist das Chartkapitel gewählt, sollen die im Video
                        // genannten Marken die Zusammenfassung überleben.
                        mitChart: themen.includes('chartanalyse'),
                    })
                    // Bruchstücke gar nicht erst speichern: ein halber
                    // Stichpunkt ist keine Analyse, sähe in der Datenbank aber
                    // wie eine aus und würde von da an weitergereicht.
                    const brauchbar = istOhneInhalt(text) || istBruchstueck(text) ? '' : text
                    await knex('news_items').where('id', v.id).update({
                        zusammenfassung: brauchbar,
                        aiModel: geminiCfg.model, aiStand: Date.now(), tokens,
                        status: 'zusammengefasst', fehler: '',
                    })
                    v.zusammenfassung = brauchbar
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
        if (istBruchstueck(v.zusammenfassung)) continue
        if (beitraege.some(b => b.id === v.id)) continue
        beitraege.push(v)
    }

    for (const b of beitraege) {
        // Hier landet der ALTBESTAND — früher zusammengefasste Videos, die
        // heute gratis wiederverwendet werden. Genau hier sickerten die
        // Bruchstücke Tag für Tag in neue Berichte.
        if (istBruchstueck(b.zusammenfassung)) continue
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
                    /*
                     * Die Zwischenmeldung stellt eine ANDERE Frage.
                     *
                     * Die Standardfrage („was waren die wichtigsten
                     * Nachrichten der letzten 36 Stunden") liefert am
                     * Nachmittag zum grossen Teil dasselbe wie am Morgen —
                     * bezahlt, gelesen, schon bekannt. Hier wird deshalb
                     * ausdrücklich nach dem Zeitraum SEIT dem Tagesbericht
                     * gefragt, und nach Zählbarem statt nach Stimmung.
                     */
                    if (istUpdate) {
                        extra = {
                            frage: `Was ist seit ${new Date(seit).toISOString().slice(0, 16).replace('T', ' ')} UTC `
                                + `zum Thema ${THEMEN_NAMEN[thema] || thema} geschehen, das für einen `
                                + 'Krypto-Futures-Händler zählt? Nur Neues aus diesem Zeitraum: Meldungen, '
                                + 'Beschlüsse, veröffentlichte Zahlen, Marktdaten, angekündigte Termine — '
                                + 'jeweils mit den genannten Zahlen und der Quelle. Nüchtern und faktisch, '
                                + 'ohne Prognosen, ohne Anlageberatung, ohne Meinungssammlung. Ist in diesem '
                                + 'Zeitraum nichts Wesentliches passiert, sage das ausdrücklich.',
                        }
                    }
                    if (thema === 'chartanalyse') {
                        let coins = ['Bitcoin', 'Ethereum', 'XRP', 'BNB', 'Solana']  // Rückfall
                        try {
                            const m = await holeMarkt(5)
                            if (m?.muenzen?.length >= 3) coins = m.muenzen.map(c => `${c.name} (${c.symbol})`)
                        } catch (e) { logWarn('news', `Top-5 für Chartanalyse nicht abrufbar: ${e.message}`) }
                        const horizont = CHART_FRISCHE[chartFrische].horizont
                        extra = {
                            mitBildern: true,
                            frage: `Wie lautet die aktuelle technische Chartanalyse für ${coins.join(', ')} `
                                + `laut Analysten und Fachmedien, mit Blick ${horizont}? `
                                + 'Je Coin: Trend, wichtige Unterstützungen und '
                                + 'Widerstände mit konkreten Kursmarken, auffällige Chartmuster und Indikatoren — '
                                + 'so, wie sie in aktuellen veröffentlichten Analysen genannt werden, mit Quellenbezug. '
                                + 'Nüchtern und faktisch. Keine eigene Analyse, keine Anlageberatung, keine Kursziele '
                                + 'ohne Quelle.',
                        }
                    }
                    const r = await rechercheThema({
                        thema, zeitraumText, apiKey: pCfg.apiKey,
                        modell: s?.radarNewsRechercheModell || undefined,
                        aktualitaet: aktualitaetFuer({ thema, rhythmus, istUpdate, chartFrische }),
                        ...extra,
                    })
                    /*
                     * Vor jeder Verwendung durchs Modell selbst prüfen lassen —
                     * siehe Kommentar bei `pruefeChartBilder`. Ein Fehlschlag
                     * (kein Gemini-Schlüssel, Guthaben leer) lässt die Bilder
                     * einfach weg statt den Lauf abzubrechen: die Textanalyse
                     * ist unabhängig davon fertig und für sich brauchbar.
                     */
                    let gepruefteBilder = []
                    if (thema === 'chartanalyse' && r.bilder?.length) {
                        try {
                            const visionCfg = await ladeLlmConfig({
                                provider: 'gemini', model: s?.radarNewsModel || 'gemini-3.5-flash-lite',
                            })
                            // Gleiche Falle wie bei `fasseVideoZusammen`: ein
                            // "Denk"-Modell (hier live beobachtet mit
                            // `gemini-3.1-pro-preview`) verbraucht einen
                            // Grossteil des Budgets für unsichtbares Reasoning,
                            // BEVOR die sichtbare Antwort beginnt — ohne
                            // `DENKRESERVE` brach die JSON-Antwort nach dem
                            // zweiten von acht Bildern mitten im Satz ab
                            // (stopReason=MAX_TOKENS bei 131 Token).
                            visionCfg.maxTokens = 1200 + DENKRESERVE
                            if (visionCfg.apiKey) {
                                const p = await pruefeChartBilder(r.bilder, visionCfg)
                                gepruefteBilder = p.bilder
                                rechercheKostenUsd += p.kostenUsd
                                rechercheTokens += p.tokens
                            }
                        } catch (e) {
                            logWarn('news', `Chartbild-Prüfung fehlgeschlagen: ${e.message}`)
                        }
                        taBilder = gepruefteBilder
                    }
                    if (r.text) {
                        recherchen.push({ thema, text: r.text })
                        // Bilder wandern hier an ihren Beleg, wo die Herkunft
                        // zum Zitat passt — siehe Kommentar in `baueRechercheZitate`.
                        // Nur die geprüften: ein Bild ohne Modell-Erklärung soll
                        // auch als Beleg-Bild nicht auftauchen.
                        rechercheZitate.push(...baueRechercheZitate(
                            r.citations.slice(0, 8), gepruefteBilder, r.quellenDaten))
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
    /*
     * Beitraege buendeln, BEVOR das Modell sie sieht.
     *
     * Ohne diesen Schritt ist die Liste flach, und ueber denselben Vorgang
     * schreiben acht Quellen acht Eintraege — das Modell macht daraus
     * bereitwillig zwei Meldungen, weil es die Verwandtschaft nirgends
     * vermerkt sieht. Die Kennung {Tn} hinter jeder Nummer macht sie sichtbar,
     * und `haltEinsProThema` weiter unten prueft, ob sich das Modell daran
     * gehalten hat. Kostet nichts ausser rund drei Token je Beitrag.
     */
    const { themaJeIndex, gruppen: themenGruppen } = gruppiereBeitraege(beitraege)
    if (themenGruppen.length) {
        console.log(`[NEWS] Themen gebündelt: ${themenGruppen.length} Bündel aus `
            + `${themenGruppen.reduce((a, g) => a + g.indizes.length, 0)} Beiträgen `
            + `(${themenGruppen.map(g => `${g.id}×${g.indizes.length}`).join(', ')})`)
    }

    const zeilen = beitraege.map((b, i) => {
        const q = nachId.get(b.sourceId)
        const inhalt = b.zusammenfassung || (b.inhalt || '').slice(0, 600)
        return `[${i + 1}] {${themaJeIndex[i]}} [${new Date(Number(b.publishedAt)).toISOString().slice(0, 16)}] ${b.titel}\n`
            + `Quelle: ${q?.name || '?'} (${q?.art || 'rss'})${b.zusammenfassung ? ' — Videoinhalt, von Gemini angesehen' : ''}\n`
            + `${inhalt}\n`
    })
    for (const [j, z] of rechercheZitate.entries()) {
        zeilen.push(`[${beitraege.length + j + 1}] Recherche-Quelle: ${z.url}\n`)
    }
    /*
     * Die Belege des bisherigen Berichts laufen in DERSELBEN Nummernreihe
     * weiter — hinter den neuen Beiträgen und den Recherche-Zitaten.
     *
     * Ohne das verlöre jeder übernommene Punkt seine Quellen: Die gespeicherten
     * Belege sind aufgelöste Objekte, das Modell sieht sie nur als Nummern.
     * `kompaktVorbericht` schreibt die Nummern in den Vorbericht, hier hängen
     * die zugehörigen Einträge hinten an die Belegliste.
     */
    let alteBelege = []
    if (istUpdate) {
        try { alteBelege = JSON.parse(basis.beitraegeListe || '[]') } catch { alteBelege = [] }
    }

    const teile = []
    if (istUpdate) {
        teile.push(kompaktVorbericht(basis, beitraege.length + rechercheZitate.length))
    }
    if (marktdaten.text) teile.push(marktdaten.text)
    for (const r of recherchen) {
        teile.push(`RECHERCHE zum Thema ${THEMEN_NAMEN[r.thema] || r.thema} `
            + `(Perplexity, Belege siehe nummerierte Recherche-Quellen):\n${r.text}`)
    }
    const regel = themenRegel(themenGruppen)
    if (regel) teile.push(regel)
    teile.push(`${istUpdate ? 'NEUE BEITRÄGE (seit dem bisherigen Bericht)' : 'BEITRÄGE'}:\n`
        + zeilen.join('\n---\n'))

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
    const budgets = budgetsAus(laenge, s?.radarNewsTokenBudget, { aktualisierung: istUpdate })
    const system = bauLagePrompt({
        themen, laenge, rhythmus,
        // Nicht das eingestellte Fenster, sondern was wirklich drinsteht.
        abdeckung: istUpdate ? '' : abdeckungText(beitraege),
        punkte: s?.radarNewsPunkte,
        zusatz: s?.radarNewsPromptZusatz,
        aktualisierung: istUpdate,
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
            zweck: istUpdate ? 'lagebericht-update' : 'lagebericht',
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
        // Die Belege des bisherigen Berichts, in unveränderter Reihenfolge —
        // sie tragen die Nummern, die der Vorbericht ausweist.
        ...alteBelege,
    ]
    const loesePunkte = (punkte, thema) => (Array.isArray(punkte) ? punkte : []).map(p => ({
        ...p,
        ...(thema ? { thema } : {}),
        // Die Kennung des Beitragsbündels, auf dem der Punkt beruht — sie
        // entscheidet gleich, ob dieser Vorgang schon einmal dasteht.
        themaId: String(p?.themaId || '').trim().slice(0, 8),
        // In der Zwischenmeldung ist jeder Punkt neu — deshalb wird nicht „neu"
        // markiert, sondern der Sonderfall: Dieser Punkt korrigiert etwas, das
        // heute Morgen anders dastand. Ein fehlendes Feld heisst „einfach neu".
        ...(istUpdate ? { korrektur: p.korrektur === true } : {}),
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
    /*
     * Die Prüfung zur Regel: ein Thema, eine Meldung.
     *
     * Sie liest, was das Modell SELBST über die Herkunft seines Punktes gesagt
     * hat, statt aus dem Wortlaut zu raten — anders als der Durchgang gleich
     * darunter, der Sätze vergleicht. Deshalb steht sie zuerst: Fliegt ein
     * ganzer Punkt, muss der Satzvergleich ihn gar nicht erst ansehen.
     *
     * Kapitelübergreifend, weil derselbe Vorgang sonst einmal unter "crypto"
     * und einmal unter "finanzen" stehen könnte — die häufigste Form der
     * Doppelung, die eine Prüfung je Kapitel nicht sieht.
     */
    // Rückfall: ein Modell ohne Kapitel liefert die Punkte flach.
    let flachOhneKapitel = kapitel.length ? [] : loesePunkte(daten?.punkte)
    {
        const alle = kapitel.length ? kapitel.flatMap(k => k.punkte) : flachOhneKapitel
        const { punkte: behalten, entfernt } = haltEinsProThema(alle)
        if (entfernt.length) {
            console.log(`[NEWS] Themen doppelt vergeben: ${entfernt.length} `
                + `(${entfernt.map(e => `${e.thema} „${e.titel.slice(0, 40)}" statt „${e.statt.slice(0, 40)}"`).join('; ')})`)
            const bleibt = new Set(behalten)
            if (kapitel.length) for (const k of kapitel) k.punkte = k.punkte.filter(p => bleibt.has(p))
            else flachOhneKapitel = behalten
        }
    }

    const flachePunkte = kapitel.length
        ? kapitel.flatMap(k => k.punkte).slice(0, 24)
        : flachOhneKapitel.slice(0, 12)

    // Abwägung „dafür/dagegen/offen" — null, wenn das Modell nichts lieferte
    const abwaegung = leseLagebild(daten?.lagebild)

    /*
     * Doppelungen raus, BEVOR der Bericht in die Datenbank geht.
     *
     * Das Modell schreibt einen Text, die Seite zeigt sechs Bausteine
     * (Marktdaten-Tabelle, Gesamtlage, Abwägung, Kapitel-Lage, Meldungen,
     * Kennzahlen-Chips). Dass derselbe Messwert dabei mehrfach auftaucht, ist
     * der Normalfall und nicht die Ausnahme — „Fear & Greed 63" stand am
     * 21.08.2026 dreimal auf einer Seite. Die Prompt-Regel allein hat das nicht
     * verhindert; sie ist eine Bitte, dieser Durchgang ist eine Bedingung.
     *
     * Bei einer Zwischenmeldung zählt zusätzlich, was der Tagesbericht schon
     * gesagt hat. Hat sich eine Zahl GEÄNDERT, ist sie eine andere Marke und
     * bleibt stehen — genau das soll eine Korrektur ja zeigen.
     */
    const vorherige = istUpdate
        ? [String(basis?.lage || ''), ...(() => {
            try {
                const kap = JSON.parse(basis?.kapitel || '[]')
                return kap.flatMap(k => [String(k?.lage || ''),
                    ...(k?.punkte || []).map(p => String(p?.text || ''))])
            } catch { return [] }
        })()].filter(Boolean)
        : []
    const entdoppelt = entdoppleBericht(
        { lage: String(daten?.lage || ''), lagebild: abwaegung, kapitel, punkte: flachePunkte },
        { markt: marktdaten.werte || [], vorherige },
    )
    if (entdoppelt.protokoll.length) {
        console.log(`[NEWS] Doppelungen entfernt: ${protokollText(entdoppelt.protokoll)}`)
    }

    const kostenUsd = (Number(antwort.costUsd) || 0) + rechercheKostenUsd + letzteXKostenUsd
    letzteXKostenUsd = 0   // abgeholt — nicht doppelt verbuchen

    const zeile = {
        erstelltAm: Date.now(),
        provider: cfg.provider,
        modell: cfg.model,
        ueberschrift: String(daten?.ueberschrift || '').slice(0, 300),
        lage: entdoppelt.bericht.lage.slice(0, 4000),
        punkte: JSON.stringify(entdoppelt.bericht.punkte),
        kapitel: JSON.stringify(entdoppelt.bericht.kapitel),
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
        lagebild: entdoppelt.bericht.lagebild ? JSON.stringify(entdoppelt.bericht.lagebild) : '',
        /*
         * Art, Grundlage und Zählnummer der Kette.
         *
         * `basisId` zeigt immer auf den ERSTEN Bericht des Tages, auch wenn
         * diese Aktualisierung auf der vorherigen aufsetzt — sonst müsste man
         * sich zum Ursprung durchhangeln. `updateNr` zählt fortlaufend, damit
         * „Aktualisierung 2" im Archiv ohne Rechnerei dasteht.
         */
        art: istUpdate ? 'update' : 'bericht',
        basisId: istUpdate ? (Number(basis.basisId) || Number(basis.id) || 0) : 0,
        updateNr: istUpdate ? (Number(basis.updateNr) || 0) + 1 : 0,
    }
    const [id] = await knex('news_digests').insert(zeile).returning('id')
    const digestId = typeof id === 'object' ? id.id : id

    // Nur der automatische Lauf meldet sich. Wer den Bericht selbst angestossen
    // hat, sitzt davor und braucht keine Post darüber.
    const korrekturen = flachePunkte.filter(p => p.korrektur === true).length
    if (!manuell) {
        /*
         * Kurz oder ganz — der Leser entscheidet.
         *
         * Die Kurzfassung sagt, DASS es einen Bericht gibt; wer unterwegs ist,
         * musste trotzdem ans Journal. Mit `radarNewsMailVoll` steht der ganze
         * Bericht in der Mail. Vorgabe bleibt kurz: eine Mail, die man nicht
         * bestellt hat, sollte nicht zwanzig Absätze lang sein.
         */
        const mailVoll = Number(s?.radarNewsMailVoll ?? 0) === 1
        const grundlage = `Grundlage: ${beitraege.length} ${istUpdate ? 'neue ' : ''}Beiträge, `
            + `${recherchen.length} Recherche(n), ${videosVerwendet} Video(s), ${themen.join(' + ')}.\n`
            + `${flachePunkte.length} Meldung(en)${korrekturen ? `, davon ${korrekturen} als Korrektur` : ''}.\n`
            + (mailVoll
                ? 'Im Journal unter „Nachrichten" steht er mit Bildern und Belegen.'
                : 'Den vollständigen Bericht findest du im Journal unter „Nachrichten".')
        melde('lageberichtFertig', {
            betreff: `${istUpdate ? `Zwischenmeldung ${zeile.updateNr}` : 'Lagebericht'}: `
                + `${zeile.ueberschrift || 'neuer Bericht'}`,
            text: berichtAlsMailText({
                lage: zeile.lage,
                kapitel,
                markt: marktdaten.werte || [],
                grundlage,
                themenNamen: THEMEN_NAMEN,
                voll: mailVoll,
            }),
            // Eigener Schlüssel je Bericht: eine Aktualisierung ist eine eigene
            // Nachricht und darf nicht als Dublette des Mittags gelten.
            schluessel: String(digestId),
            ttlMs: 365 * 24 * 60 * 60 * 1000,
        }).catch(() => { })
    }

    console.log(` -> ${istUpdate ? `Zwischenmeldung ${zeile.updateNr} (Basis ${basis.id})` : 'Lagebericht'}`
        + ` (${rhythmus}, ${laenge}, ${themen.join('+')}): ${beitraege.length} Beiträge, `
        + `${recherchen.length} Recherche(n), ${videosVerwendet} Video(s) verwendet `
        + `(davon ${videosGesehen} neu analysiert), `
        + `${tokens} Token via ${cfg.provider}/${cfg.model} (${kostenUsd.toFixed(4)} USD)`)
    return {
        id: digestId,
        art: zeile.art, updateNr: zeile.updateNr, basisId: zeile.basisId,
        punkte: flachePunkte.length, korrekturen, recherchen: recherchen.length,
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
            // Fokus-Filter: dasselbe Prinzip wie im Lagebericht, hier auf die
            // Auslieferung an die Nachrichtenübersicht angewendet.
            if (Number(s?.radarNewsFokusAn ?? 0) === 1) {
                const fokusWoerter = zerlegeWoerter(s?.radarNewsFokusWoerter)
                zeilen = zeilen.filter(z => istFokusTreffer(z, fokusWoerter, nachId.get(z.sourceId)))
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
            /*
             * Die Seite zeigt einen TAG, nicht einen Bericht.
             *
             * Tagesbericht und Zwischenmeldungen gehören zusammen; die jüngste
             * liegt offen, die älteren zugeklappt darüber. Geholt werden die
             * jüngsten fünf Zeilen — mehr kann eine Kette nicht haben (ein
             * Bericht plus zwei Zwischenmeldungen), der Rest ist Luft für den
             * Fall, dass jemand von Hand nachlegt.
             */
            const s = await knex('settings').where('id', 1).first()
            const jung = await knex('news_digests').orderBy('erstelltAm', 'desc').limit(5)
                .select('id', 'erstelltAm', 'ueberschrift', 'art', 'updateNr', 'basisId', 'beitraege')
            const { kette, vomVortag } = berichtsKette(jung, {
                tagesbeginn: tagesbeginn(Date.now(), s?.timeZone),
            })
            // Offen ist die jüngste der Kette — und nach Mitternacht keine:
            // der Vortag ist archiviert, nicht gelöscht.
            const offen = kette.length ? kette[kette.length - 1] : null
            const letzter = offen && !vomVortag
                ? await knex('news_digests').where('id', offen.id).first()
                : null
            // 30 Zeilen Metadaten — das Archiv auf der Nachrichten-Seite.
            // Volltext je Bericht kommt einzeln über /lagebericht/:id.
            const verlauf = await knex('news_digests')
                .orderBy('erstelltAm', 'desc').limit(30)
                .select('id', 'erstelltAm', 'ueberschrift', 'beitraege', 'videos', 'tokens',
                    'ausloeser', 'kostenUsd', 'themen', 'laenge', 'art', 'updateNr', 'basisId')
            // Ein gescheiterter Lauf war bisher nur im Serverlog zu sehen — genau
            // deshalb fiel ein ausgefallener Tagesbericht tagelang nicht auf.
            // Die Aktualisierungen zählen mit: ein Nachtrag, der still ausfällt,
            // ist genauso unsichtbar wie ein ausgefallener Bericht. Gezeigt wird
            // der JÜNGSTE Fehlschlag — mehrere Zeilen übereinander erklären
            // nichts, was die neueste nicht schon sagt.
            const staende = await Promise.all([BERICHT_SCHLUESSEL, UPDATE_SCHLUESSEL(1), UPDATE_SCHLUESSEL(2)]
                .map(k => leseAufgabenStand(k)))
            const stand = staende.filter(z => z?.fehler)
                .sort((a, b) => b.zeit - a.zeit)[0] || null
            res.set('Cache-Control', 'no-store')
            res.json({
                stand: Number(offen?.erstelltAm) || null,
                veraltet: false,
                bericht: berichtAntwort(letzter),
                // Die Köpfe der Kette — daraus baut die Seite die zugeklappten
                // Zeilen. Der Volltext kommt je Bericht über /lagebericht/:id.
                kette: kette.map(z => ({ ...z, erstelltAm: Number(z.erstelltAm) })),
                vomVortag,
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

    /**
     * Eigene Anweisungen prüfen — bevor sie einen bezahlten Lauf kosten.
     *
     * Der Text kommt aus dem Formular und wird NICHT gespeichert: Wer prüft,
     * hat sich noch nicht entschieden. Gespeichert wird erst, wenn der Leser
     * den Vorschlag übernimmt — über den normalen Weg der Einstellungen.
     */
    app.post('/api/marktradar/lagebericht/anweisung-pruefen', async (req, res) => {
        try {
            const text = String(req.body?.text || '').trim().slice(0, ZUSATZ_MAX)
            if (!text) return res.status(400).json({ error: 'Keine Anweisung übergeben' })

            const s = await getKnex()('settings').where('id', 1).first()
            const cfg = await ladeLlmConfig({
                provider: s?.radarNewsBerichtProvider || undefined,
                model: s?.radarNewsBerichtModell || undefined,
            })
            // Geprüft wird von dem Modell, das die Anweisung später auch
            // befolgen muss — ein anderes könnte etwas zusagen, woran sich der
            // Schreiber nicht hält.
            cfg.maxTokens = 1500
            const antwort = await callLLMJson(cfg, {
                system: bauAnweisungPruefPrompt({
                    themen: leseThemen(s?.radarNewsThemen),
                    laenge: ['kurz', 'mittel', 'lang'].includes(s?.radarNewsLaenge) ? s.radarNewsLaenge : 'mittel',
                    // Ohne die Liste rät das Modell, ob ein genannter Kanal
                    // erreichbar ist — und riet „nein" bei einer Quelle, die
                    // seit Monaten eingerichtet ist. Nur die AKTIVEN: eine
                    // abgeschaltete Quelle liefert nichts, ein Wunsch nach ihr
                    // ist tatsächlich wirkungslos.
                    quellen: await getKnex()('news_sources').where('enabled', 1)
                        .select('name', 'art', 'videoAnalyse').orderBy('id'),
                }),
                user: `ANWEISUNG DES LESERS:\n<<<\n${text}\n>>>`,
                timeoutMs: 90000,
                zweck: 'lagebericht-pruefung',
                ausloeser: 'manuell',
            })
            if (!antwort.json) return res.status(502).json({ error: 'Das Modell lieferte kein verwertbares JSON' })
            res.json({
                ...leseAnweisungPruefung(antwort.json),
                kostenUsd: Number(antwort.costUsd) || 0,
                provider: cfg.provider, modell: cfg.model,
            })
        } catch (e) {
            sendRadarError(res, e, 'Anweisung prüfen')
        }
    })

    /**
     * Den bestehenden Bericht auf den Stand bringen.
     *
     * Von Hand ohne Fristprüfung: Wer den Knopf drückt, hat den Bericht vor
     * sich und weiss, wie alt er ist. Die Frist aus `basisTaugtFuerUpdate`
     * gilt nur dem Takt, der niemanden fragt.
     */
    app.post('/api/marktradar/lagebericht/aktualisieren', async (req, res) => {
        try {
            await laufeNewsAbruf({ manuell: true }).catch(() => { })
            res.json(await erzeugeLagebericht({ manuell: true, aktualisierung: true }))
        } catch (e) {
            sendRadarError(res, e, 'Lagebericht aktualisieren')
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
 * wöchentlich läuft oder gar nicht („nur manuell"): sonst fehlt dem nächsten
 * Bericht alles, was aus dem Drei-Tage-Fenster der Feeds herausgefallen ist.
 *
 * Nach dem Bericht kommen die Aktualisierungen: bis zu zwei am Tag, jede mit
 * eigenem Tages-Anspruch, jede nur dann, wenn der Bericht des Tages schon
 * steht.
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

            if (sollBerichtLaufen({
                jetztLokal: lokal,
                stunde: Number(s?.radarNewsStunde ?? 12),
                rhythmus: s?.radarNewsRhythmus,
                wochentag: Number(s?.radarNewsWochentag ?? 1),
            })) {
                const lauf = await erzeugeLagebericht().catch(() => null)   // Fehler steht im Vermerk
                /*
                 * Nur weiter zu den Aktualisierungen, wenn der Bericht
                 * ÜBERSPRUNGEN wurde — also heute schon lief.
                 *
                 * Die Prüfung ist der eigentliche Knackpunkt dieses Blocks:
                 * `sollBerichtLaufen` bleibt ab der Berichtsstunde den ganzen
                 * Tag wahr, ein blosses `return` an dieser Stelle hätte die
                 * Nachträge also nie erreicht. Umgekehrt darf nach einem
                 * frischen oder gescheiterten Bericht keiner laufen: im ersten
                 * Fall gäbe es nichts nachzutragen, im zweiten keine Grundlage.
                 */
                if (!lauf?.uebersprungen) return
            }

            /*
             * Aktualisierungen — höchstens zwei am Tag, und nie ohne Bericht.
             *
             * Sie laufen NUR, wenn der Rhythmus nicht „nur manuell" ist: Wer
             * die Automatik abgeschaltet hat, will keine bezahlten Läufe durch
             * die Hintertür. Und sie laufen nach demselben Tages-Anspruch wie
             * der Bericht, je Platz einer — ein Neustart um 21:30 holt den
             * Abendnachtrag nach, verdoppelt ihn aber nicht.
             */
            if (leseRhythmus(s?.radarNewsRhythmus) === 'manuell') return
            const stunden = leseUpdateStunden(s?.radarNewsUpdateStunden, s?.radarNewsUpdates)
            const platz = faelligerUpdatePlatz({ jetztLokal: lokal, stunden })
            if (platz) await erzeugeLagebericht({ aktualisierung: true, platz }).catch(() => { })
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
