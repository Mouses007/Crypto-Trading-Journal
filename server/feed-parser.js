/**
 * Schlanker Leser für RSS, Atom und öffentliche Telegram-Kanäle.
 *
 * Warum keine Bibliothek: Es sind wenige, enge Formate — YouTube liefert Atom,
 * Cointelegraph und trumpstruth.org RSS 2.0, Telegram gar kein XML, sondern
 * die HTML-Vorschauseite (eigener Leser weiter unten) — und gebraucht werden
 * sechs Felder. Ein allgemeiner XML-Leser brächte dafür mehr Angriffsfläche als
 * Nutzen — Entity-Expansion („Billion Laughs") und externe Entities (XXE) sind
 * genau die Sorte Loch, die man sich mit einer Abhängigkeit einkauft, die viel
 * mehr kann als man braucht. Hier werden ausschliesslich die fünf
 * Standard-Entities und numerische Verweise aufgelöst; DTDs werden ignoriert.
 *
 * Der Preis: bei einem exotischen Feed bricht er. Deshalb wird der Fehler je
 * Quelle festgehalten und angezeigt, statt den ganzen Lauf scheitern zu lassen.
 */

const MAX_EINTRAEGE = 50
const MAX_TEXT = 4000

/** Nur die fünf Standard-Entities und numerische Verweise — keine DTD. */
function entschluessle(text) {
    return String(text || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        // Benannte Entities jenseits der fünf Standardfälle: Telegram und
        // manche Redaktionssysteme streuen sie ein, und stehen bleiben sie
        // sonst als sichtbarer Müll mitten im Text
        .replace(/&nbsp;/g, ' ')
        .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
        .replace(/&hellip;/g, '…').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        // &amp; zuletzt, sonst würde „&amp;lt;" zu „<" statt zu „&lt;"
        .replace(/&amp;/g, '&')
}

const cdataWeg = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')

function textVon(block, tag) {
    const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
    return m ? entschluessle(cdataWeg(m[1])).trim() : ''
}

function attributVon(block, tag, attr) {
    const m = block.match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, 'i'))
    return m ? entschluessle(m[1]) : ''
}

/** HTML aus Beschreibungen entfernen — wir wollen Text, keine Auszeichnung. */
function nurText(html) {
    return String(html || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, MAX_TEXT)
}

/**
 * Öffentliche Telegram-Kanalseite lesen (`https://t.me/s/<kanal>`).
 *
 * Telegram bietet für Kanäle kein RSS, aber diese Vorschauseite ist ohne
 * Konto, ohne Schlüssel und ohne JavaScript abrufbar und enthält die letzten
 * rund zwanzig Beiträge samt Zeitstempel. Für Konten, die X verlassen haben
 * oder dort ohnehin unerreichbar sind, ist das der einzige freie Weg.
 *
 * Gelesen wird bewusst nur, was strukturell eindeutig ist: `data-post` als
 * Kennung (daraus auch der Verweis), `<time datetime>` und der Textblock.
 * Bilder, Umfragen und Weiterleitungen bleiben aussen vor — was keinen Text
 * hat, ist für einen Lagebericht ohnehin wertlos.
 */
export function leseTelegram(html) {
    const roh = String(html || '')
    if (!roh.includes('tgme_widget_message')) return []

    return roh.split('tgme_widget_message_wrap').slice(1).map((block) => {
        const post = (block.match(/data-post="([^"]+)"/) || [])[1]
        if (!post) return null

        const zeitText = (block.match(/<time[^>]+datetime="([^"]+)"/) || [])[1]
        const zeit = zeitText ? Date.parse(zeitText) : null
        const rohText = (block.match(/message_text[^>]*>([\s\S]*?)<\/div>/) || [])[1] || ''
        // Telegram legt Fotos als Hintergrundbild an, nicht als <img>
        const bild = (block.match(/background-image:url\(['"]?([^)'"]+)/) || [])[1] || ''
        const text = entschluessle(nurText(rohText))
        if (!text) return null

        // Telegram-Beiträge haben keine Überschrift — der erste Satz muss sie
        // ersetzen, sonst steht in der Liste überall dasselbe
        const titel = text.split(/\n|(?<=[.!?])\s/)[0].slice(0, 200)

        return {
            titel,
            link: `https://t.me/${post}`,
            id: post,
            zeit: Number.isFinite(zeit) ? zeit : null,
            inhalt: text.slice(0, MAX_TEXT),
            bild,
            videoId: '',
        }
    }).filter(Boolean).slice(-MAX_EINTRAEGE)
}

/**
 * Kanalnamen, Profil- oder Vorschauadresse auf die Vorschauseite bringen.
 * Der Nutzer soll nicht wissen müssen, dass es das `/s/` braucht.
 */
export function telegramUrl(eingabe) {
    const s = String(eingabe || '').trim()
    const name = s.replace(/^https?:\/\/(t\.me|telegram\.me)\/(s\/)?/i, '').replace(/^@/, '').split(/[/?#]/)[0]
    return name ? `https://t.me/s/${name}` : ''
}

/**
 * @returns {{titel:string, link:string, id:string, zeit:number|null,
 *            inhalt:string, videoId:string}[]}
 */
export function leseFeed(xml) {
    const roh = String(xml || '')
    if (!roh.trim()) return []

    // Atom nutzt <entry>, RSS <item> — sonst ist der Aufbau nah genug beieinander
    const istAtom = /<feed[\s>]/i.test(roh)
    const tag = istAtom ? 'entry' : 'item'
    const bloecke = roh.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'gi')) || []

    return bloecke.slice(0, MAX_EINTRAEGE).map((b) => {
        const titel = textVon(b, 'title')
        // Atom hat den Verweis im Attribut, RSS im Elementtext
        const link = textVon(b, 'link') || attributVon(b, 'link', 'href')
        const videoId = textVon(b, 'yt:videoId')
        const zeitText = textVon(b, 'pubDate') || textVon(b, 'published') || textVon(b, 'updated')
        const zeit = zeitText ? Date.parse(zeitText) : null
        /*
         * Bild: drei Schreibweisen sind üblich, und keine ist verbindlich —
         * YouTube nutzt media:thumbnail, Cointelegraph media:content,
         * ältere Feeds enclosure. Der erste Treffer gewinnt.
         */
        const bild = attributVon(b, 'media:thumbnail', 'url')
            || attributVon(b, 'media:content', 'url')
            || attributVon(b, 'enclosure', 'url')
            || ''

        const inhalt = nurText(
            textVon(b, 'media:description') || textVon(b, 'content:encoded')
            || textVon(b, 'description') || textVon(b, 'content') || textVon(b, 'summary'))

        return {
            titel,
            link,
            // Ohne stabile Kennung nehmen wir den Verweis — er ist bei allen
            // drei Formaten eindeutig genug für die Doppelerkennung
            id: textVon(b, 'guid') || textVon(b, 'id') || videoId || link,
            zeit: Number.isFinite(zeit) ? zeit : null,
            inhalt,
            bild,
            videoId,
        }
    }).filter(e => e.titel && e.id)
}
