/**
 * Beiträge zu Themen bündeln, BEVOR sie ins Modell gehen.
 *
 * Der Nachbesser-Durchgang (`news-doppler.js`) schneidet Wiederholungen aus
 * einem fertigen Bericht. Das ist die zweitbeste Lösung: Geschrieben — und
 * damit bezahlt — wurde der doppelte Absatz trotzdem, und was er verdrängt
 * hat, erfährt niemand. Ein Bericht mit acht Meldungen, von denen zwei
 * denselben Vorgang behandeln, hatte in Wahrheit nur sieben Themen; die achte
 * Meldung ist nicht bloss überflüssig, sie steht an der Stelle einer, die
 * nicht geschrieben wurde.
 *
 * Deshalb hier der frühere Eingriff: Die Beiträge werden vor dem Prompt
 * gruppiert, jede Gruppe bekommt eine Kennung, und der Auftrag lautet
 * "höchstens EINE Meldung je Thema". Das Modell kann ein Thema dann nicht
 * zweimal ausgeben, ohne die Kennung zweimal zu vergeben — und das ist
 * nachprüfbar, ohne raten zu müssen, ob zwei Absätze dasselbe meinen.
 *
 * REIN gehalten: kein Netz, keine Datenbank, kein Modellaufruf. Der Selbsttest
 * daneben prüft beide Richtungen — dass Gleiches zusammenkommt UND dass
 * Verschiedenes getrennt bleibt. Die zweite Richtung ist die wichtigere: Ein
 * Bündler, der zu viel zusammenwirft, verschweigt Meldungen, und das fällt
 * niemandem auf, weil das Fehlende nun einmal nicht dasteht.
 *
 * WARUM SELTENHEIT ZÄHLT: In einem Krypto-Nachrichtenlauf steht "bitcoin" in
 * jedem dritten Beitrag. Zwei Beiträge, die sich nur dieses Wort teilen, haben
 * nichts miteinander zu tun. "fomc" oder "blackrock" dagegen stehen in zweien
 * von sechzig — teilen sich zwei Beiträge so ein Wort, ist es fast immer
 * derselbe Vorgang. Ein Wort wiegt deshalb umso mehr, je seltener es im
 * LAUFENDEN Lauf ist. Eine feste Wortliste wäre hier falsch: Was häufig ist,
 * hängt vom Tag ab.
 */

import { woerterAus } from './news-doppler.js'

/**
 * Ab wann zwei Beiträge dasselbe Thema behandeln.
 *
 * Die Punktzahl ist eine Summe von Wortgewichten, jedes zwischen 0 und 1
 * (siehe `gewichte`) — sie haengt damit NICHT an der Laenge des Laufs. Zwei
 * geteilte, seltene Titelwoerter ergeben knapp zwei Punkte; ein geteiltes Wort
 * im Fliesstext ein Drittel davon. Gemessen an den Testfaellen trennt 0,45
 * sauber zwischen "dieselbe Meldung aus drei Quellen" und "beide erwaehnen
 * Bitcoin".
 */
const SCHWELLE = 0.45

/**
 * Zwei geteilte Inhaltswoerter — und zwar IN BEIDEN TITELN.
 *
 * Das ist die Regel, an der alles haengt. Am echten Bestand vom 21.08.2026
 * entschied sie jeden der acht gefundenen Faelle richtig, waehrend "irgendwo
 * im Text geteilt" die Haelfte falsch zusammenlegte: "SEC charges former banker
 * with insider trading" und "Onchain, in court: crypto legal news this week"
 * teilen sich "former" und "trading" im Fliesstext und handeln von
 * Verschiedenem; "Jim Cramer says go buy Bitcoin" und "Spot Bitcoin ETFs
 * recorded $685 million inflows" teilen sich "bitcoin" und den Namen der
 * Quelle.
 *
 * Der Grund ist einfach: Eine Schlagzeile IST die Themenansage, der Fliesstext
 * wandert. Zwei lange Artikel beruehren einander irgendwo immer.
 *
 * Der Fliesstext zaehlt weiterhin zur Punktzahl — er darf bestaetigen, aber
 * nicht allein tragen. ZAHLEN und EINHEITEN zaehlen hier ebenfalls nicht mit:
 * "58,2 Prozent Dominanz" und "58,2 Prozent der Konten sind long" teilen sich
 * die Zahl und das Wort "Prozent" und haben nichts miteinander zu tun.
 */
const MIN_GETEILT = 2

/** Der Titel ist die Themenansage; im Fliesstext steht Beiwerk. */
const GEWICHT = { titelTitel: 1.0, gemischt: 0.6, textText: 0.35 }

/** Wie viel Fliesstext ueberhaupt gelesen wird — dahinter steht meist Beiwerk. */
const TEXT_ZEICHEN = 400

/**
 * Was noch als Schlagzeile durchgeht.
 *
 * Truth Social und X liefern den ganzen Beitrag als "titel". Ohne Deckel ist
 * so ein Beitrag ein Magnet: Er teilt mit jedem zweiten Text zwei Woerter.
 */
const TITEL_ZEICHEN = 140
const TITEL_WOERTER = 12

/**
 * Masswoerter tragen nichts zur Frage bei, WORUM es geht.
 *
 * Sie stehen in jedem zweiten Wirtschaftssatz. Ohne diese Liste haengt eine
 * Buendelung schnell an "Prozent" und "Dollar" statt an der Sache.
 */
const EINHEIT = new Set([
    'prozent', 'dollar', 'euro', 'franken', 'millionen', 'million', 'milliarden',
    'milliarde', 'billionen', 'billion', 'punkte', 'punkt', 'basispunkte',
    'prozentpunkte', 'stunden', 'tagen', 'tage', 'wochen', 'monate', 'monaten',
    'jahre', 'jahren', 'anteil', 'wert', 'werte', 'zahlen', 'markt', 'maerkte',
])

/*
 * Englische Fuellwoerter und Feed-Beiwerk.
 *
 * Die Liste aus `news-doppler.js` ist deutsch — die Quellen sind es nicht. Am
 * echten Bestand vom 21.08.2026 hing das groesste Fehlbuendel an "with",
 * "that" und "https": Ein Wort, das in jeder zweiten Schlagzeile steht, sieht
 * fuer die Haeufigkeitsrechnung selten genug aus, wenn die Haelfte der
 * Beitraege deutsch ist. Deshalb hier ausdruecklich benannt statt errechnet.
 */
const FUELLWORT = new Set([
    'about', 'after', 'again', 'against', 'also', 'amid', 'another', 'been', 'before',
    'being', 'both', 'could', 'does', 'down', 'during', 'each', 'even', 'ever', 'every',
    'from', 'have', 'here', 'into', 'just', 'like', 'more', 'most', 'much', 'must',
    'near', 'need', 'next', 'over', 'said', 'says', 'same', 'seen', 'since', 'some',
    'still', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they',
    'this', 'those', 'through', 'under', 'until', 'very', 'well', 'were', 'what', 'when',
    'where', 'which', 'while', 'will', 'with', 'would', 'your',
    // Feed-Beiwerk: Adressen, Retweet-Marken, Rubrikwoerter
    'http', 'https', 'www', 'com', 'news', 'report', 'reports', 'update', 'updates',
    'today', 'yesterday', 'week', 'watch', 'read', 'more', 'video', 'live',
])

/**
 * Grober Wortstamm: ein angehaengtes s faellt weg.
 *
 * "BlackRocks Bitcoin-ETF" und "ETF von BlackRock" sind dieselbe Firma, und an
 * genau diesem s scheiterte die Buendelung im ersten Anlauf. Weiter zu gehen
 * (en, er, ung) waere gefaehrlich: Damit trifft "Anleger" auf "Anlage".
 */
const stamm = (w) => (w.length >= 6 && w.endsWith('s') ? w.slice(0, -1) : w)

/** Ist das ueberhaupt ein Wort ueber die Sache? */
const traegt = (w) => !EINHEIT.has(w) && !FUELLWORT.has(w) && !w.startsWith('z#')

/**
 * Ein Wort, das in mehr als jedem VIERTEN Beitrag steht, wiegt nichts.
 *
 * Die Haeufigkeitsrechnung allein genuegt nicht. Bei 60 Beitraegen wiegt ein
 * Wort aus 15 von ihnen immer noch 0,34 — drei solche Woerter reissen jede
 * Schwelle. Am echten Bestand war das "trump": In einem Lauf mit vielen
 * Truth-Social-Quellen steht er ueberall und sagt deshalb nichts darueber, ob
 * zwei Beitraege denselben VORGANG behandeln.
 */
const ZU_HAEUFIG = 0.25

/**
 * Wortmenge eines Beitrags, getrennt nach Titel und Text.
 *
 * Zahlen kommen als eigene Marke `z#951` mit — dieselbe Meldung traegt bei
 * jeder Quelle dieselbe Zahl. Dass sie allein nichts entscheidet, regelt
 * MIN_GETEILT.
 */
function wortmengeAus(b) {
    const zahlen = (t) => (String(t || '').match(/\d[\d.,]*/g) || [])
        .map(z => 'z#' + z.replace(/[.,]/g, ''))
        .filter(z => z.length > 3)
    // Adressen ganz entfernen: In "https://t.co/ab12" steckt kein Thema, wohl
    // aber ein halbes Dutzend Wortfetzen, die zwei fremde Beitraege verbinden.
    const ohneUrl = (t) => String(t || '').replace(/https?:\/\/\S+/gi, ' ')
    const menge = (t) => new Set([
        ...[...woerterAus(ohneUrl(t))].map(stamm).filter(traegt),
        ...zahlen(ohneUrl(t)),
    ])

    /*
     * Eine Schlagzeile ist kurz — bei Truth Social und X ist "titel" aber der
     * ganze Beitrag. Am echten Bestand hing daran das letzte Fehlbuendel: Ein
     * langer Truth-Post als Anker zog vier fremde Meldungen an sich, weil sein
     * "Titel" genug Woerter enthielt, um mit allem zwei zu teilen. Deshalb
     * gilt nur der ANFANG als Titel; der Rest ist Fliesstext und wiegt
     * entsprechend weniger.
     */
    const rohTitel = String(b?.titel || '')
    const titel = new Set([...menge(rohTitel.slice(0, TITEL_ZEICHEN))].slice(0, TITEL_WOERTER))
    const text = menge(rohTitel.slice(TITEL_ZEICHEN)
        + ' ' + String(b?.zusammenfassung || b?.inhalt || '').slice(0, TEXT_ZEICHEN))
    // Was schon im Titel steht, muss im Text nicht doppelt wiegen.
    for (const w of titel) text.delete(w)
    return { titel, text }
}

/**
 * Gewicht je Wort: selten = schwer, und auf 0 bis 1 normiert.
 *
 * `log(n/d) / log(n)` — ein Wort, das nur einmal vorkommt, wiegt 1; eines, das
 * ueberall steht, wiegt 0. Die Normierung ist der Punkt: Ohne sie haette
 * dieselbe Schwelle bei 6 Beitraegen eine voellig andere Bedeutung als bei 60,
 * und genau daran ist der erste Anlauf gescheitert.
 *
 * Unter drei Beitraegen ist jede Haeufigkeitsrechnung Zufall — dann wiegt
 * nichts, und es wird nicht gebuendelt. Das ist die richtige Antwort: Bei zwei
 * Beitraegen gibt es kein "selten".
 */
function gewichte(mengen) {
    const n = mengen.length
    const g = new Map()
    const df = new Map()
    if (n < 3) return { g, df }
    for (const m of mengen) {
        for (const w of new Set([...m.titel, ...m.text])) df.set(w, (df.get(w) || 0) + 1)
    }
    for (const [w, d] of df) {
        // Der Deckel greift erst ab vier Vorkommen: Ein Wort, das in ZWEI
        // Beitraegen steht, ist nie der Hintergrund eines Laufs — bei sechs
        // Beitraegen ueberschreitet es die Quote trotzdem, und genau daran
        // waere die Buendelung kleiner Laeufe gestorben.
        const zuHaeufig = d >= 4 && d / n > ZU_HAEUFIG
        g.set(w, zuHaeufig ? 0 : Math.max(0, Math.log(n / d) / Math.log(n)))
    }
    return { g, df }
}

/**
 * Ein einzelnes Wort, das eine Buendelung allein tragen darf.
 *
 * Die Zwei-Woerter-Regel hat eine Luecke, und sie ist keine theoretische:
 * "Why is Nuvation Bio stock rallying today?" und "Nuvation Bio stock rises
 * after Cantor starts at Overweight" handeln unuebersehbar von derselben
 * Firma, teilen sich aber nur "nuvation" — "stock" faellt unter den
 * Haeufigkeitsdeckel, sobald ein paar Boersenmeldungen im Lauf sind.
 *
 * Erlaubt ist das nur unter drei Bedingungen zugleich: Das Wort kommt im
 * ganzen Lauf in HOECHSTENS ZWEI Beitraegen vor (also genau in diesen beiden),
 * es ist lang genug, um ein Name und keine Abkuerzung zu sein, und die
 * Punktzahl liegt doppelt ueber der Schwelle — der Fliesstext muss also
 * bestaetigen. "Bitcoin" faellt durch die erste Bedingung, und genau darum
 * geht es.
 */
const NAME_MIN_ZEICHEN = 6
const NAME_MAX_VORKOMMEN = 2

/**
 * Wie stark zwei Beitraege dasselbe Thema behandeln — und woran man es sieht.
 *
 * `geteilt` sind NUR die Woerter, die in beiden TITELN stehen; sie sind der
 * Nachweis. `punkte` zaehlt auch den Fliesstext, aber nur als Bestaetigung.
 */
function naehe(a, b, g) {
    let punkte = 0
    const geteilt = []
    const zaehle = (w, faktor) => {
        const gew = (g.get(w) || 0) * faktor
        if (gew > 0) punkte += gew
    }
    for (const w of a.titel) {
        if (b.titel.has(w)) {
            zaehle(w, GEWICHT.titelTitel)
            if (traegt(w) && (g.get(w) || 0) > 0) geteilt.push(w)
        } else if (b.text.has(w)) zaehle(w, GEWICHT.gemischt)
    }
    for (const w of a.text) {
        if (b.titel.has(w)) zaehle(w, GEWICHT.gemischt)
        else if (b.text.has(w)) zaehle(w, GEWICHT.textText)
    }
    return { punkte, geteilt }
}

/**
 * Beiträge in Themen bündeln.
 *
 * Jeder Beitrag landet in genau einer Gruppe, auch wenn er allein bleibt —
 * sonst gäbe es Beiträge ohne Kennung, und der Auftrag "eine Meldung je Thema"
 * hätte für sie keine Bedeutung.
 *
 * Ein Beitrag tritt einer Gruppe nur bei, wenn er ihrem ERSTEN Mitglied nahe
 * genug ist — nicht irgendeinem.
 *
 * Der erste Anlauf legte über einen Verbund zusammen: nah bei irgendwem heisst
 * dabei, dazuzugehören. Am echten Bestand vom 21.08.2026 verschlang ein
 * einziges Bündel dadurch 35 von 60 Beiträgen — eine Kette von Nvidia-Zahlen
 * über einen Supreme-Court-Beschluss bis zu einer Meldung über Drohnen, jedes
 * Glied für sich knapp über der Schwelle, das Ganze offensichtlicher Unsinn.
 * Ketten sind bei Nachrichten kein Randfall: Quellen schreiben lang, und lange
 * Texte berühren einander irgendwo immer.
 *
 * Der Anker macht die Gruppe prüfbar: Jedes Mitglied ist mit DEM Beitrag
 * verwandt, der das Thema aufgemacht hat. Das kostet gelegentlich eine
 * Zusammenlegung — zwei Fassungen desselben Vorgangs, die nur über eine dritte
 * verbunden sind, bleiben getrennt. Diesen Preis zahlt man gern: Eine Meldung
 * zu viel ist ein Schönheitsfehler, eine verschluckte ist ein Loch im Bericht.
 *
 * @param {object[]} beitraege  in der Reihenfolge, in der sie im Prompt stehen
 * @returns {{ themaJeIndex: string[], gruppen: object[] }}
 *   `themaJeIndex[i]` ist die Kennung des i-ten Beitrags ("T3").
 *   `gruppen` sind NUR die mehrköpfigen, für Protokoll und Prompt-Legende.
 */
export function gruppiereBeitraege(beitraege, { schwelle = SCHWELLE } = {}) {
    const liste = Array.isArray(beitraege) ? beitraege : []
    if (!liste.length) return { themaJeIndex: [], gruppen: [] }

    const mengen = liste.map(wortmengeAus)
    const { g, df } = gewichte(mengen)

    /** Reicht dieser Fund als Nachweis? */
    const genug = (geteilt, punkte) => {
        if (geteilt.length >= MIN_GETEILT && punkte >= schwelle) return true
        const w = geteilt.length === 1 ? geteilt[0] : ''
        return Boolean(w) && w.length >= NAME_MIN_ZEICHEN
            && (df.get(w) || 0) <= NAME_MAX_VORKOMMEN
            && punkte >= schwelle * 2
    }

    /*
     * Anker-Bindung: Jeder Beitrag geht die Anker in Lesereihenfolge durch und
     * schliesst sich dem ersten an, der nahe genug ist. Findet er keinen, wird
     * er selbst Anker. Damit gehört jede Gruppe zu genau einem Vorgang, und
     * die Reihenfolge ist die des Berichts — T1 ist das Thema des ersten
     * Beitrags.
     */
    const anker = []           // Indizes der Themen-Erstlinge
    const zuAnker = new Array(liste.length).fill(-1)
    const belege = new Map()   // "anker|mitglied" → geteilte Wörter, fürs Protokoll

    for (let i = 0; i < liste.length; i++) {
        let bester = -1, bestePunkte = 0, besteWorte = []
        for (const a of anker) {
            const { punkte, geteilt } = naehe(mengen[a], mengen[i], g)
            if (!genug(geteilt, punkte)) continue
            if (punkte > bestePunkte) { bester = a; bestePunkte = punkte; besteWorte = geteilt }
        }
        if (bester < 0) { anker.push(i); zuAnker[i] = i; continue }
        zuAnker[i] = bester
        belege.set(`${bester}|${i}`, besteWorte)
    }

    const nummer = new Map()
    const themaJeIndex = liste.map((_, i) => {
        const w = zuAnker[i]
        if (!nummer.has(w)) nummer.set(w, `T${nummer.size + 1}`)
        return nummer.get(w)
    })

    const nachThema = new Map()
    themaJeIndex.forEach((id, i) => {
        if (!nachThema.has(id)) nachThema.set(id, [])
        nachThema.get(id).push(i)
    })

    const gruppen = [...nachThema.entries()]
        .filter(([, idx]) => idx.length > 1)
        .map(([id, indizes]) => ({
            id,
            indizes,
            titel: liste[indizes[0]]?.titel || '',
            // Die geteilten Wörter der Gruppe, häufigste zuerst — damit im Log
            // steht, WORAN die Bündelung hing, und ein Fehlgriff sichtbar wird.
            stichworte: stichworteAus(indizes, belege),
        }))

    return { themaJeIndex, gruppen }
}

function stichworteAus(indizes, belege) {
    const zaehl = new Map()
    const anker = indizes[0]
    for (const b of indizes) {
        for (const w of belege.get(`${anker}|${b}`) || []) zaehl.set(w, (zaehl.get(w) || 0) + 1)
    }
    return [...zaehl.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([w]) => w)
}

/**
 * Die Regel für den Prompt — nur, wenn es überhaupt etwas zu bündeln gibt.
 *
 * Ohne mehrköpfige Gruppe ist jeder Beitrag sein eigenes Thema; die Kennungen
 * stünden dann als Zierrat im Prompt und kosteten Token für nichts.
 */
export function themenRegel(gruppen) {
    if (!gruppen?.length) return ''
    const zeilen = gruppen.map(gr => `  ${gr.id}: ${gr.indizes.map(i => i + 1).join(', ')}`
        + (gr.stichworte.length ? `  (${gr.stichworte.join(', ')})` : ''))
    return `THEMEN-BÜNDEL — mehrere Beiträge über denselben Vorgang:
${zeilen.join('\n')}

Die Kennung {Tn} hinter jeder Beitragsnummer sagt, zu welchem Vorgang der
Beitrag gehört. JEDES THEMA ERGIBT HÖCHSTENS EINE MELDUNG. Behandeln mehrere
Beiträge denselben Vorgang, schreibst du EINEN Punkt und nennst alle als
Belege — nicht zwei Punkte, die sich gegenseitig wiederholen.

Jeder Punkt trägt dafür "themaId" mit der Kennung des Beitrags, auf dem er
hauptsächlich beruht. Beruht er auf einer Recherche-Quelle statt auf einem
Beitrag, lässt du das Feld weg.`
}

/**
 * Punkte, die dasselbe Thema ein zweites Mal aufmachen, entfernen.
 *
 * Das ist die Prüfung zur Regel oben — und sie muss sein: Eine Bitte im Prompt
 * ist keine Bedingung. Anders als der Wortvergleich in `news-doppler.js` rät
 * sie nicht, ob zwei Absätze dasselbe meinen; sie liest, was das Modell selbst
 * über die Herkunft seines Punktes gesagt hat.
 *
 * Der ERSTE Punkt eines Themas bleibt. Punkte ohne `themaId` bleiben immer —
 * die Chartanalyse beruht auf der Recherche und hat keine.
 *
 * @returns {{ punkte: object[], entfernt: object[] }}
 */
export function haltEinsProThema(punkte) {
    const behalten = []
    const entfernt = []
    const gesehen = new Map()
    for (const p of Array.isArray(punkte) ? punkte : []) {
        const id = String(p?.themaId || '').trim()
        if (!id) { behalten.push(p); continue }
        if (gesehen.has(id)) {
            entfernt.push({ titel: p?.titel || '', thema: id, statt: gesehen.get(id) })
            continue
        }
        gesehen.set(id, p?.titel || '')
        behalten.push(p)
    }
    return { punkte: behalten, entfernt }
}
