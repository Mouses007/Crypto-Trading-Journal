/**
 * Doppelungen im Lagebericht finden und entfernen.
 *
 * Ein Bericht entsteht in einem Zug aus einer Modellantwort, wird aber in
 * STÜCKEN angezeigt: Marktdaten-Tabelle, Gesamtlage, Abwägung, je Kapitel eine
 * Lage, darunter die Meldungen mit ihren Kennzahlen-Chips. Das Modell sieht
 * diese Anordnung nicht und schreibt denselben Messwert bereitwillig dreimal —
 * einmal in die Gesamtlage, einmal in die Kapitel-Lage, einmal in eine Meldung.
 * Auf der Seite steht er dann viermal, weil die Tabelle ihn ohnehin zeigt.
 * Genau das war die Beschwerde vom 21.08.2026: „Fear & Greed 63" dreimal.
 *
 * Deshalb dieser Durchgang. Er ist rein — kein Netz, keine Datenbank, kein
 * zweiter (bezahlter) Modellaufruf —, damit der Selbsttest ihn prüfen kann und
 * damit ein Bericht nicht daran scheitern kann.
 *
 * ZWEI SIGNALE müssen zusammenkommen, bevor ein Satz fliegt: dieselbe ZAHL und
 * mindestens zwei gemeinsame Inhaltswörter. Die Zahl allein reicht nicht —
 * „58,2 % Dominanz" und „58,2 % der Konten sind long" sind zwei Aussagen, die
 * zufällig dieselbe Zahl tragen. Die Wörter allein reichen auch nicht, sonst
 * fiele jeder zweite Satz über Bitcoin weg.
 *
 * Was ausdrücklich NICHT als Doppelung gilt: die Marktdaten-Tabelle gegen den
 * Fliesstext. Die Tabelle ist der Messwert, der Satz ist die Deutung — eine
 * Erwähnung darf der Text haben. Erst die ZWEITE Erwähnung im Text fliegt.
 * Bei den Kennzahlen-Chips ist es umgekehrt: Ein Chip, der nur wiederholt, was
 * zwei Zentimeter darüber in der Tabelle steht, ist reine Wiederholung.
 */

/** Wörter, die nichts über den Inhalt sagen — sie dürfen nicht als Beleg für eine Doppelung zählen. */
const STOPP = new Set([
    'aber', 'auch', 'aufs', 'beim', 'bereits', 'damit', 'dabei', 'dann', 'dass', 'dazu', 'dem', 'den',
    'denen', 'denn', 'der', 'des', 'diese', 'diesem', 'diesen', 'dieser', 'dieses', 'doch', 'dort',
    'durch', 'eine', 'einem', 'einen', 'einer', 'eines', 'etwa', 'fuer', 'gegen', 'haben', 'hatte',
    'hier', 'ihre', 'ihrem', 'ihren', 'ihrer', 'immer', 'jedoch', 'kann', 'koennen', 'liegt', 'mehr',
    'nach', 'nicht', 'noch', 'nur', 'oder', 'ohne', 'sein', 'seine', 'seinen', 'seiner', 'sich',
    'sind', 'somit', 'sowie', 'steht', 'stehen', 'ueber', 'und', 'unter', 'viel', 'vom', 'von', 'vor',
    'waehrend', 'war', 'waren', 'weil', 'weiter', 'werden', 'wird', 'wurde', 'wurden', 'zeigt', 'zum',
    'zur', 'zwar', 'zwischen',
])

/** Abkürzungen, nach deren Punkt KEIN neuer Satz beginnt. */
const ABKUERZUNG = new Set([
    'mrd', 'mio', 'bzw', 'ca', 'evtl', 'ggf', 'inkl', 'max', 'min', 'nr', 'rd', 'sog', 'usw', 'vgl',
    'abs', 'prof', 'dr', 'z', 'b', 'u', 'a', 'd', 'h', 'etc', 'bspw', 'tsd', 'bio', 'bill',
    // „USD." und „EUR." stehen absichtlich NICHT hier: Ein Satz endet weit
    // öfter auf einen Währungsnamen, als einer mitten in ihm weitergeht.
])

/** Einheiten auf eine Schreibweise bringen — „Prozent" und „%" sind dieselbe Aussage. */
const EINHEIT = {
    prozent: '%', pct: '%', '%': '%',
    dollar: 'usd', usd: 'usd', 'us-dollar': 'usd', euro: 'eur', eur: 'eur',
    mrd: 'mrd', milliarden: 'mrd', milliarde: 'mrd',
    mio: 'mio', millionen: 'mio', million: 'mio',
    bio: 'bio', billionen: 'bio', billion: 'bio', bill: 'bio',
    punkte: 'pkt', punkt: 'pkt', bp: 'bp', basispunkte: 'bp',
}

/** Umlaute und Zeichensetzung weg — „Fear-&-Greed-Index" und „Fear & Greed Index" sind dasselbe. */
export function normWort(w) {
    return String(w).toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
}

/**
 * Inhaltswörter eines Textes.
 *
 * Ab vier Zeichen, ohne Füllwörter. Kürzere fliegen raus, weil „BTC" und „ETH"
 * in jedem zweiten Satz stehen und als Beleg für „dasselbe gesagt" nichts wert
 * sind.
 */
export function woerterAus(text) {
    const w = new Set()
    for (const roh of String(text || '').split(/[^\p{L}]+/u)) {
        const n = normWort(roh)
        if (n.length >= 4 && !STOPP.has(n)) w.add(n)
    }
    return w
}

/**
 * Was hinter einer Zahl stehen kann, ohne dass sie ein Messwert wäre.
 *
 * Zeitspannen, Daten — und Indikator-Perioden: „EMAs 20/50/100/200" und
 * „20-Tage-EMA" sind Einstellungen, keine Messwerte. Ohne diese Zeile hat der
 * Durchgang zwei Chartabsätze über verschiedene Coins zusammengeworfen, weil
 * beide eine 20er- und eine 50er-EMA erwähnen. Der Bindestrich gehört
 * ausdrücklich dazu: geschrieben wird „20-Tage-EMA", nicht „20 Tage EMA".
 */
const KEIN_MESSWERT = /^\s*[-–]?\s*\.?\s*(stunden?|std|tagen?|tage|wochen?|monaten?|monate|jahren?|jahre|minuten?|uhr|ema|sma|gd|fibonacci|januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/i

/** Dasselbe von vorn: „EMAs 50/100/200" — die Periode steht hinter dem Wort. */
const KEIN_MESSWERT_DAVOR = /(emas?|smas?|gd|gleitende[rn]? durchschnitte?|fibonacci|bollinger|periode[n]?|\/)\s*[-–]?\s*$/i

/**
 * Zahlen eines Textes als vergleichbare Marken.
 *
 * `1.234,50 %` und `1234.5 Prozent` ergeben beide `1234.5%`.
 *
 * Ausgenommen sind Zahlen, die gar keine Messung sind, sondern Zeit: „in 24
 * Stunden", „am 19. August", „das 30-Tage-Mittel", Jahreszahlen. Sie stehen in
 * fast jedem Satz, und wenn sie als Marke zählen, hängt der Durchgang zwei
 * Aussagen zusammen, die nur zufällig beide von 24 Stunden sprechen — gemessen
 * an den Berichten vom 20./21.08.2026 war genau das der häufigste Fehlgriff.
 */
export function zahlenAus(text) {
    const roh = String(text || '')
    const marken = new Set()
    const re = /([+-]?\d{1,3}(?:[.\s]\d{3})+|[+-]?\d+)(?:[.,](\d+))?\s*(%|prozent|pct|mrd|mio|bio|milliarden?|millionen?|million|billionen?|billion|usd|us-dollar|dollar|eur|euro|punkte?|bp|basispunkte)?/gi
    let m
    while ((m = re.exec(roh))) {
        const ganz = m[1].replace(/[.\s]/g, '')
        const bruch = m[2] ? m[2].replace(/0+$/, '') : ''
        const einheit = m[3] ? (EINHEIT[normWort(m[3])] || normWort(m[3])) : ''
        const zahl = bruch ? `${ganz}.${bruch}` : ganz
        if (!einheit) {
            // Jahreszahl, Datum, Zeitspanne, Indikator-Periode — Kontext, kein Messwert
            if (/^(19|20)\d\d$/.test(ganz) && !bruch) continue
            if (KEIN_MESSWERT.test(roh.slice(re.lastIndex))) continue
            if (KEIN_MESSWERT_DAVOR.test(roh.slice(Math.max(0, m.index - 30), m.index))) continue
        }
        marken.add(zahl + einheit)
    }
    return marken
}

/** Text in Sätze zerlegen — Abkürzungen beenden keinen Satz. */
export function saetzeAus(text) {
    const roh = String(text || '').trim()
    if (!roh) return []
    const teile = []
    let start = 0
    const re = /([.!?])\s+/g
    let m
    while ((m = re.exec(roh))) {
        const davor = roh.slice(start, m.index)
        const letztes = normWort((davor.match(/([\p{L}]+)$/u) || [])[1] || '')
        // „Mrd. USD" ist kein Satzende, „1.000" auch nicht
        if (m[1] === '.' && (ABKUERZUNG.has(letztes) || /\d$/.test(davor))) continue
        teile.push(roh.slice(start, m.index + 1).trim())
        start = re.lastIndex
    }
    const rest = roh.slice(start).trim()
    if (rest) teile.push(rest)
    return teile.filter(Boolean)
}

const schnitt = (a, b) => [...a].filter(x => b.has(x)).length

/** „73pkt" → { wert: '73', einheit: 'pkt' } */
const zerlegeMarke = (m) => {
    const t = String(m).match(/^([+-]?\d+(?:\.\d+)?)(.*)$/)
    return t ? { wert: t[1], einheit: t[2] } : { wert: String(m), einheit: '' }
}

/**
 * Gemeinsame ZAHLEN zweier Sätze — mit einer Ausnahme für die nackte Zahl.
 *
 * `zahlenAus` hängt die Einheit an die Marke, und das ist richtig: „58,2 %
 * Dominanz" und „58,2 Mrd. USD Zufluss" sind zwei Messungen, die zufällig
 * dieselbe Ziffernfolge tragen. Eine Zahl OHNE Einheit ist aber nicht eine
 * dritte Messung, sondern dieselbe unbestimmt geschrieben: „Fear & Greed von
 * 73" und „73 Punkte" sind derselbe Wert. Ohne diese Ausnahme blieb genau
 * dieser Satz am 05.09.2026 stehen — die Karte sagte „von 73", die Kapitel-Lage
 * „mit 73 Punkten", und der Durchgang sah zwei verschiedene Marken.
 *
 * Zwei Sätze mit VERSCHIEDENEN Einheiten bleiben getrennt; nur die leere
 * Einheit passt auf jede. Das zweite Signal (gemeinsame Wörter) gilt
 * unverändert daneben.
 */
const zahlSchnitt = (a, b) => {
    const bTeile = [...b].map(zerlegeMarke)
    let treffer = 0
    for (const x of [...a].map(zerlegeMarke)) {
        if (bTeile.some(y => y.wert === x.wert && (!x.einheit || !y.einheit || x.einheit === y.einheit))) {
            treffer++
        }
    }
    return treffer
}

/**
 * Sagt dieser Satz dasselbe wie ein früherer?
 *
 * Entweder gemeinsame Zahl UND zwei gemeinsame Inhaltswörter, oder — für Sätze
 * ganz ohne Zahl — weitgehend dieselben Wörter (Jaccard ab 0,7). Die zweite
 * Regel greift nur bei mindestens vier Inhaltswörtern; bei „Der Markt ist
 * ruhig." wäre jede Ähnlichkeitsrechnung Zufall.
 */
export function istWiederholung(neu, frueher) {
    for (const alt of frueher) {
        if (neu.zahlen.size && alt.zahlen.size) {
            /*
             * Auch bei den ZAHLEN zählt der Anteil, nicht der Treffer.
             *
             * Das Chartanalyse-Kapitel hat es gezeigt: Sätze mit acht
             * Kursmarken je Coin teilen fast immer eine davon, und die Wörter
             * (Widerstand, Support, Pivot, EMA) sind dort Gerüst, nicht
             * Inhalt. Eine von acht gemeinsamen Zahlen ist Zufall; eine von
             * einer, zwei von drei sind dieselbe Aussage.
             */
            const zahlGleich = zahlSchnitt(neu.zahlen, alt.zahlen)
            const zahlKleiner = Math.min(neu.zahlen.size, alt.zahlen.size)
            const gemeinsam = schnitt(neu.woerter, alt.woerter)
            const kleiner = Math.min(neu.woerter.size, alt.woerter.size) || 1
            // Zwei Wörter reichen bei kurzen Sätzen, bei langen nicht: zwei
            // lange Absätze über Bitcoin teilen immer ein paar Wörter.
            if (zahlGleich / zahlKleiner >= 1 / 3 && gemeinsam >= 2 && gemeinsam / kleiner >= 0.3) return alt
        }
        if (!neu.zahlen.size && !alt.zahlen.size && neu.woerter.size >= 4 && alt.woerter.size >= 4) {
            const gemeinsam = schnitt(neu.woerter, alt.woerter)
            const vereint = new Set([...neu.woerter, ...alt.woerter]).size
            if (gemeinsam / vereint >= 0.7) return alt
        }
    }
    return null
}

/**
 * Ein Satz, vorbereitet zum Vergleichen.
 *
 * `fremd` heisst: Dieser Satz steht in einem Block, den dieser Durchgang NICHT
 * ändern kann — Einordnungskarte, Marktstand-Tabelle, Vorbericht. Der
 * Unterschied entscheidet, ob der Ankersatz-Schutz greifen darf: Gegen einen
 * Block, der ohnehin auf der Seite stehen bleibt, ist „den ersten Satz retten"
 * keine Rettung, sondern die Konservierung der Wiederholung.
 */
const marke = (text, fremd = false) => ({ text, fremd, zahlen: zahlenAus(text), woerter: woerterAus(text) })

/**
 * Die Einordnungskarten als Sätze — genau der Text, den der Leser sieht.
 *
 * Bewusst NICHT der Prompt-Block aus `holeLagenBlock`: Der trägt Beschriftungen
 * („Gesamtlage (Zyklus, Stimmung …)"), die auf der Seite nicht stehen und den
 * Wortvergleich verfälschen würden.
 */
export function einordnungTexte(lagen) {
    const l = lagen && typeof lagen === 'object' ? lagen : {}
    const raus = []
    for (const feld of [l.gesamt?.text, l.gesamt?.widerspruch]) if (feld) raus.push(String(feld))
    for (const feld of [l.handel?.text, l.handel?.spielraum, l.handel?.zeitfenster]) {
        if (feld) raus.push(String(feld))
    }
    for (const b of Array.isArray(l.handel?.bedingungen) ? l.handel.bedingungen : []) {
        if (b?.wenn && b?.dann) raus.push(`Wenn ${b.wenn}, dann ${b.dann}.`)
    }
    return raus
}

/**
 * Einen Absatz auf die Sätze kürzen, die noch nichts gesagt haben.
 *
 * Zwei Betriebsarten, und der Unterschied ist der Punkt der Übung:
 *
 *   `ankerSatz: true` — für die Gesamtlage und die Kapitel-Lage. Der ERSTE
 *   Satz bleibt stehen, auch wenn er doppelt ist: Ein Absatz, der mit dem
 *   zweiten Gedanken anfängt, liest sich kaputt, und eine leere Kapitel-Lage
 *   sieht aus wie ein Fehler.
 *
 *   `ankerSatz: false` — für den Text einer Meldung. Hier darf alles wegfallen,
 *   denn eine Meldung, die nur Bekanntes enthält, ist keine Meldung; sie wird
 *   danach als Ganzes verworfen.
 */
function kuerzeAbsatz(text, gesehen, protokoll, wo,
    { ankerSatz = true, ankerAuchFremd = false, zusaetzlich = [] } = {}) {
    const saetze = saetzeAus(text)
    const marken = saetze.map(t => marke(t))
    // `zusaetzlich` wandert NICHT in `gesehen`: Die Marktdaten-Tabelle gilt nur
    // gegen die Kapitel-Lage, und derselbe Speicher trägt gleich die Meldungen.
    const vergleich = zusaetzlich.length ? [...gesehen, ...zusaetzlich] : gesehen
    const treffer = marken.map(m => istWiederholung(m, vergleich))

    /*
     * Ein Absatz, in dem JEDER Satz schon dastand, ist als Ganzes alt — bei
     * einer Meldung heisst das: sie fliegt. Steht dagegen auch nur ein neuer
     * Gedanke darin, bleibt der erste Satz stehen, selbst wenn er wiederholt.
     * Ein Absatz, der mit „Auf 24-Stunden-Sicht dagegen …" beginnt, weil ihm
     * die Einleitung fehlt, ist kein aufgeräumter Text, sondern ein zerhackter.
     *
     * ABER: Der Anker darf nicht ausgerechnet die Wiederholung schützen. Steht
     * der erste Satz schon in einem Block, den dieser Durchgang NICHT ändern
     * kann (Einordnungskarte, Marktstand-Tabelle, Vorbericht), ist „stehen
     * lassen" genau der Fehler vom 05.09.2026: eine Kapitel-Lage aus Fear &
     * Greed 73, Dominanz 59,1 % und Funding 0 % p.a. — und keiner einzigen
     * Nachricht. Dann wird der Absatz leer, und das Kapitel fällt weg.
     */
    const ankerTaugt = ankerAuchFremd || !treffer[0]?.fremd
    const allesAlt = saetze.length > 0 && treffer.every(Boolean)
    const geschuetzt = (allesAlt || !ankerTaugt) ? -1 : 0

    const behalten = []
    saetze.forEach((s, i) => {
        if (treffer[i] && i !== geschuetzt) {
            protokoll.push({ wo, art: 'satz', text: s, wie: treffer[i].text })
            return
        }
        behalten.push(s)
        gesehen.push(marken[i])
    })
    // Die Lage eines Kapitels darf nie leer werden — dort steht sonst ein Loch.
    // Ausser der Absatz stand vollständig in einem fremden Block: Dann ist das
    // Loch die ehrlichere Anzeige, und der Aufrufer lässt das Kapitel weg.
    if (!behalten.length && ankerSatz && ankerTaugt && saetze.length) {
        gesehen.push(marken[0])
        return saetze[0]
    }
    if (!behalten.length && saetze.length) {
        protokoll.push({ wo, art: 'absatz', text: saetze[0], wie: 'stand schon fest daneben' })
    }
    return behalten.join(' ')
}

/**
 * Der ganze Durchgang über einen fertig gelesenen Bericht.
 *
 * Reihenfolge = Lesereihenfolge der Seite. Was zuerst dasteht, bleibt; was
 * später dasselbe sagt, fliegt. Anders herum wäre es falsch: Der Leser stösst
 * zuerst auf die Gesamtlage, und dort darf die Zahl stehen.
 *
 * `markt` sind die Zeilen der Marktdaten-Tabelle, `vorherige` die Texte eines
 * bereits veröffentlichten Berichts (für Zwischenmeldungen — was heute Morgen
 * schon dastand, ist mittags keine Meldung mehr; hat sich die Zahl geändert,
 * ist es eine andere Marke und bleibt).
 *
 * Gibt den bereinigten Bericht und ein Protokoll zurück. Das Protokoll ist
 * nicht Zierde: Ohne es weiss niemand, ob dieser Durchgang nützt oder frisst.
 */
export function entdoppleBericht(bericht, { markt = [], vorherige = [], einordnung = [] } = {}) {
    const b = bericht && typeof bericht === 'object' ? bericht : {}
    const protokoll = []
    /*
     * Beide Vorbelegungen sind `fremd`: Sie stehen fest, während der Bericht
     * geschrieben wird. Die Einordnungskarten stehen auf der Seite ZWISCHEN
     * Gesamtlage und Kapiteln — sie belegen `gesehen` trotzdem von Anfang an,
     * weil von zwei Blöcken, die dasselbe sagen, nur einer geändert werden
     * kann. Der muss weichen.
     */
    const gesehen = [
        ...(Array.isArray(einordnung) ? einordnung : []).flatMap(t => saetzeAus(t)).map(t => marke(t, true)),
        ...(Array.isArray(vorherige) ? vorherige : []).flatMap(t => saetzeAus(t)).map(t => marke(t, true)),
    ]

    // Die Tabelle zählt für die Kennzahlen-Chips …
    const tabelle = new Set()
    for (const w of Array.isArray(markt) ? markt : []) {
        for (const z of zahlenAus(`${w?.wert || ''} ${w?.zusatz || ''}`)) tabelle.add(z)
    }
    /*
     * … und seit dem 05.09.2026 zusätzlich gegen die KAPITEL-LAGE, aber nur
     * dort. Die alte Ausnahme („die Tabelle ist der Messwert, der Satz die
     * Deutung — eine Erwähnung darf der Text haben") war richtig, solange es
     * zwei Ebenen gab. Mit der Einordnung sind es drei, und die Deutung hat
     * einen eigenen, besseren Platz bekommen; die Kapitel-Lage ist die Ebene,
     * die dadurch überflüssig wurde.
     *
     * NICHT gegen die Gesamtlage: Sie steht auf der Seite über der Tabelle und
     * ist bei abgeschalteter Einordnung der einzige erlaubte Deutungsort.
     * NICHT gegen die Meldungen: Dort ist der Messwert Beleg einer Nachricht,
     * nicht Wiederholung — und ein fälschlich gelöschter Meldungssatz fällt
     * niemandem auf. Das ist die gefährlichere Fehlerrichtung.
     *
     * Die Beschriftung gehört in den Satz: „Fear & Greed 73 (Gier) 30-Tage-
     * Mittel 55" hat genug Inhaltswörter, dass die Zwei-Signal-Regel überhaupt
     * greifen kann — „73 (Gier)" allein hätte keine zwei.
     */
    const tabelleMarken = (Array.isArray(markt) ? markt : [])
        .map(w => `${w?.was || ''} ${w?.wert || ''} ${w?.zusatz || ''}`.trim())
        .filter(Boolean)
        .flatMap(t => saetzeAus(t))
        .map(t => marke(t, true))

    // Die Gesamtlage behält ihren Ankersatz auch gegen fremde Blöcke: Für sie
    // gibt es kein Auffangnetz — eine leere `lage` ist ein Loch oben auf der
    // Seite und die erste Zeile jeder Mail. Ein Kapitel darf verschwinden,
    // die Gesamtlage nicht.
    const lage = kuerzeAbsatz(b.lage || '', gesehen, protokoll, 'lage', { ankerAuchFremd: true })

    /*
     * Die Abwägung wird NUR gegen sich selbst geprüft, nicht gegen den Text.
     *
     * Erster Anlauf tat das und löschte sie fast vollständig — bei den
     * Berichten vom 20./21.08.2026 sechs von acht Einträgen. Zu Recht im
     * Wortlaut, falsch in der Sache: Die Waage IST die Wiederholung, in einem
     * anderen Rahmen. Sie nimmt dieselben Zahlen und sagt, was sie stützen und
     * was sie belasten, mit einer Marke „Fakt" oder „Einschätzung" daran. Ein
     * leerer Kasten wäre kein aufgeräumter Bericht, sondern ein kaputter.
     * Doppelt ist hier nur, was ZWEIMAL IN DER WAAGE steht.
     */
    let lagebild = b.lagebild || null
    if (lagebild && typeof lagebild === 'object') {
        const neu = {}
        for (const spalte of ['dafuer', 'dagegen', 'offen']) {
            // Und jede SPALTE für sich: „offen" ist die Frage zu dem, was in
            // „dafuer" als Fakt steht — „951 Mio. USD sind zugeflossen" und
            // „ob die Zuflüsse anhalten" sind nicht dieselbe Zeile, sondern
            // die beiden Hälften der Übung.
            const gesehenWaage = []
            neu[spalte] = (lagebild[spalte] || []).filter(e => {
                const m = marke(e?.text || '')
                const treffer = istWiederholung(m, gesehenWaage)
                if (treffer) {
                    protokoll.push({ wo: `lagebild.${spalte}`, art: 'abwaegung', text: e?.text || '', wie: treffer.text })
                    return false
                }
                gesehenWaage.push(m)
                return true
            })
        }
        lagebild = (neu.dafuer.length || neu.dagegen.length || neu.offen.length) ? neu : null
    }

    // Kennzahlen-Chips: eine Zahl gehört EINEM Punkt. Steht sie schon in der
    // Marktdaten-Tabelle, gehört sie keinem.
    const zahlenVergeben = new Set(tabelle)
    const putzeKennzahlen = (p, wo) => {
        const behalten = []
        for (const z of Array.isArray(p.kennzahlen) ? p.kennzahlen : []) {
            const marken = [...zahlenAus(String(z?.wert ?? ''))]
            if (marken.length && marken.every(m => zahlenVergeben.has(m))) {
                protokoll.push({ wo, art: 'kennzahl', text: `${z?.wert ?? ''} (${z?.was ?? ''})`, wie: 'schon genannt' })
                continue
            }
            for (const m of marken) zahlenVergeben.add(m)
            behalten.push(z)
        }
        return behalten
    }

    const titelGesehen = new Set()
    const putzePunkte = (punkte, wo) => {
        const behalten = []
        for (const p of Array.isArray(punkte) ? punkte : []) {
            const titel = normWort(String(p?.titel || '')).replace(/[^a-z0-9]+/g, ' ').trim()
            if (titel && titelGesehen.has(titel)) {
                protokoll.push({ wo, art: 'punkt', text: p?.titel || '', wie: 'gleicher Titel' })
                continue
            }
            // Erst den Text kürzen — bleibt nichts übrig, war die ganze Meldung alt.
            const gekuerzt = kuerzeAbsatz(String(p?.text || ''), gesehen, protokoll, wo, { ankerSatz: false })
            if (!gekuerzt.trim() && String(p?.text || '').trim()) {
                protokoll.push({ wo, art: 'punkt', text: p?.titel || '', wie: 'nichts Neues' })
                continue
            }
            if (titel) titelGesehen.add(titel)
            // Nicht am Original schrauben: Der Aufrufer hält dieselbe Liste
            // noch in der Hand, und eine reine Funktion, die heimlich schreibt,
            // ist im Selbsttest grün und im Betrieb ein Rätsel.
            behalten.push({ ...p, text: gekuerzt, kennzahlen: putzeKennzahlen(p, wo) })
        }
        return behalten
    }

    const kapitel = (Array.isArray(b.kapitel) ? b.kapitel : []).map((k, i) => ({
        ...k,
        lage: kuerzeAbsatz(k?.lage || '', gesehen, protokoll, `kapitel[${i}].lage`,
            { zusaetzlich: tabelleMarken }),
        punkte: putzePunkte(k?.punkte, `kapitel[${i}]`),
    }))

    // Ohne Kapitel (älteres Modellformat) trägt die flache Liste den Bericht.
    const punkte = kapitel.length
        ? kapitel.flatMap(k => k.punkte)
        : putzePunkte(b.punkte, 'punkte')

    return { bericht: { ...b, lage, lagebild, kapitel, punkte }, protokoll }
}

/** Eine Zeile fürs Log — mehr braucht es nicht, aber weniger auch nicht. */
export function protokollText(protokoll) {
    if (!protokoll?.length) return ''
    const zaehl = protokoll.reduce((a, e) => ({ ...a, [e.art]: (a[e.art] || 0) + 1 }), {})
    return Object.entries(zaehl).map(([k, n]) => `${n} ${k}`).join(', ')
}
