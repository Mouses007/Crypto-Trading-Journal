/**
 * Hype-Radar, Stufe 2: bewerten.
 *
 * Reine Rechnung, kein Netz, keine Datenbank, kein Sprachmodell. Das ist
 * Absicht und der Kern des ganzen Aufbaus: fünfhundert rohe Funde von einem
 * Modell einschätzen zu lassen wäre langsam, teuer und bei jedem Lauf ein
 * bisschen anders. Hier entsteht eine Rangfolge, die sich nachrechnen lässt;
 * das Modell bekommt später nur die besten zehn zu sehen.
 *
 * Alle Teilnoten laufen von 0 bis 100 und werden mit den eingestellten
 * Gewichten verrechnet. Jede Note wird mitgespeichert, damit die Oberfläche
 * zeigen kann, WARUM ein Kandidat oben steht — eine Zahl ohne Herkunft ist
 * nicht überprüfbar.
 */

/** Vorgabe-Gewichte. Summe 100; die Oberfläche prüft das beim Speichern. */
export const STANDARD_GEWICHTE = {
    sozial: 30,      // wie stark wird darüber gesprochen
    volumen: 25,     // zieht der Handel an
    quellen: 15,     // bestätigen mehrere Quellen einander
    narrativ: 20,    // passt es in ein laufendes Thema
    neuheit: 10,     // wie jung ist das Paar
}

/** Themen, in die Kapital rotiert. Frei erweiterbar in den Einstellungen. */
export const STANDARD_NARRATIVE = [
    'ai-agents', 'rwa', 'depin', 'stablecoin-payments',
    'prediction-markets', 'restaking', 'zk', 'meme', 'gaming', 'defi',
]

/**
 * Stichwörter je Thema. Bewusst schlicht gehalten: das ist eine Zuordnung,
 * keine Bedeutungsanalyse — und ein Sprachmodell dafür zu bezahlen wäre für
 * das Ergebnis („welcher Topf") deutlich zu viel Aufwand.
 */
const NARRATIV_WOERTER = {
    'ai-agents': ['ai', 'agent', 'gpt', 'llm', 'neural', 'brain', 'intelligence', 'bot'],
    rwa: ['rwa', 'real world', 'treasury', 'bond', 'estate', 'commodity', 'tokenized'],
    depin: ['depin', 'infra', 'network', 'node', 'wireless', 'compute', 'storage', 'sensor'],
    'stablecoin-payments': ['stable', 'usd', 'pay', 'payment', 'remit', 'settle'],
    'prediction-markets': ['predict', 'forecast', 'bet', 'odds', 'market'],
    restaking: ['restake', 'stake', 'validator', 'yield', 'liquid'],
    zk: ['zk', 'zero knowledge', 'privacy', 'private', 'anon', 'proof'],
    meme: ['dog', 'inu', 'shib', 'pepe', 'cat', 'wojak', 'moon', 'elon', 'trump', 'frog',
        'meme', 'bonk', 'wif', 'floki', 'chad', 'baby', 'zilla', 'ape'],
    gaming: ['game', 'play', 'metaverse', 'nft', 'quest', 'guild'],
    defi: ['swap', 'dex', 'lend', 'borrow', 'vault', 'farm', 'liquidity'],
}

/** Auf 0..100 begrenzen; NaN wird zu 0 statt zu einer kaputten Gesamtnote. */
const klemme = (n) => {
    const z = Number(n)
    if (!Number.isFinite(z)) return 0
    return Math.max(0, Math.min(100, z))
}

/**
 * Wie stark wird gesprochen.
 *
 * Ohne eigene Historie lässt sich keine echte Beschleunigung messen — der
 * erste Lauf hat keinen Vergleichswert. Gemessen wird deshalb die Stärke der
 * vorhandenen Sozialsignale. Sobald mehrere Läufe gespeichert sind, kann hier
 * die Veränderung gegenüber dem Vorlauf einziehen (siehe `sozialVeraenderung`).
 */
export function noteSozial(k) {
    const s = k?.sozial || {}
    let punkte = 0

    // LunarCrush ist das belastbarste Signal, wenn vorhanden.
    if (Number.isFinite(s.galaxyScore)) punkte = Math.max(punkte, Number(s.galaxyScore))
    if (Number.isFinite(s.altRank) && s.altRank > 0) {
        // Rang 1 ist am besten; ab Rang 500 zählt es nicht mehr.
        punkte = Math.max(punkte, klemme(100 - (Number(s.altRank) / 5)))
    }
    // Reddit: Zustimmung, logarithmisch — der Sprung von 10 auf 100 Stimmen
    // sagt mehr als der von 1000 auf 1090.
    if (Number(s.stimmen) > 0) {
        punkte = Math.max(punkte, klemme(Math.log10(Number(s.stimmen) + 1) * 33))
    }
    if (Number(s.panicScore) > 0) {
        punkte = Math.max(punkte, klemme(Math.log10(Number(s.panicScore) + 1) * 40))
    }
    /*
     * Bezahlte Hervorhebung ist Aufmerksamkeit, aber gekaufte.
     *
     * Zwei Quellen desselben Signals: `boostGesamt` stammt aus der Bestenliste
     * der Boosts und erreicht nur die obersten; `markt.boosts` steht am
     * einzelnen Paar und deckt jeden Fund ab, den wir im Detail nachschlagen.
     * Der grössere Wert gewinnt — es ist derselbe Sachverhalt, nur
     * unterschiedlich vollständig erfasst.
     *
     * GEDECKELT bei 30: Wer sich Reichweite kauft, soll dafür nicht in die
     * obere Hälfte kommen. Ohne diesen Deckel liessen sich mit einem
     * Hunderter-Boost rund vierzig Punkte kaufen — und genau das ist das
     * Muster, gegen das der ganze Radar gebaut ist.
     */
    const gekauft = Math.max(Number(s.boostGesamt) || 0, Number(k?.markt?.boosts) || 0)
    if (gekauft > 0) {
        punkte = Math.max(punkte, Math.min(BOOST_DECKEL, klemme(Math.log10(gekauft + 1) * 20)))
    }
    return klemme(punkte)
}

/** Höchstens so viel Aufmerksamkeit lässt sich kaufen. */
export const BOOST_DECKEL = 30

/**
 * Zieht der Handel an.
 *
 * Verglichen wird das Volumen der letzten Stunde mit dem Stundenmittel des
 * Tages. Ein Wert von 1 heisst „läuft wie gehabt", 3 heisst „dreimal so viel
 * wie üblich". Fehlt die Stundenangabe, wird auf sechs Stunden ausgewichen.
 */
export function noteVolumen(k) {
    const m = k?.markt || {}
    const tag = Number(m.volumen24h) || 0
    if (tag <= 0) return 0
    const mittelJeStunde = tag / 24

    let faktor = null
    if (Number(m.volumen1h) > 0) faktor = Number(m.volumen1h) / mittelJeStunde
    else if (Number(m.volumen6h) > 0) faktor = (Number(m.volumen6h) / 6) / mittelJeStunde
    if (faktor === null) return 20   // Handel ja, aber keine Auflösung: schwaches Ja

    // Faktor 1 → 25, Faktor 4 → 100. Darüber gedeckelt: was zehnmal über dem
    // Schnitt liegt, ist nicht doppelt so interessant wie fünfmal darüber.
    return klemme(faktor * 25)
}

/**
 * Wie viele unabhängige Quellen.
 *
 * Der wichtigste Einzelfaktor gegen gekauften Lärm: eine bezahlte Kampagne
 * füllt eine Quelle, selten drei voneinander unabhängige.
 */
export function noteQuellen(k) {
    const n = Number(k?.quellenAnzahl) || 0
    if (n <= 0) return 0
    if (n === 1) return 20
    if (n === 2) return 50
    if (n === 3) return 75
    return 100
}

/**
 * Passt der Fund in ein laufendes Thema.
 *
 * @returns {{note:number, narrativ:string}}
 */
export function noteNarrativ(k, narrative = STANDARD_NARRATIVE) {
    const text = `${k?.symbol || ''} ${k?.name || ''}`.toLowerCase()
    if (!text.trim()) return { note: 0, narrativ: '' }

    let bestes = ''
    let treffer = 0
    let laengster = 0
    for (const n of narrative) {
        const woerter = NARRATIV_WOERTER[n] || [n]
        const passende = woerter.filter((w) => passt(text, w))
        if (!passende.length) continue
        const laenge = Math.max(...passende.map((w) => w.length))
        /*
         * Gleichstand wird über die LÄNGE des Treffers entschieden, nicht über
         * die Reihenfolge der Themenliste.
         *
         * Vorher gewann bei Gleichstand schlicht das erste Thema — und das ist
         * `ai-agents`. PEPECOIN („Make Memes Great Again") traf `pepe` und
         * gleichzeitig `ai`, und landete deshalb unter KI-Agenten. Ein
         * Vier-Zeichen-Treffer ist ein stärkerer Beleg als ein Zwei-Zeichen-
         * Treffer, und danach wird jetzt entschieden.
         */
        if (passende.length > treffer || (passende.length === treffer && laenge > laengster)) {
            treffer = passende.length
            laengster = laenge
            bestes = n
        }
    }
    if (!treffer) return { note: 0, narrativ: '' }
    // Ein Treffer reicht für die Zuordnung; mehrere machen sie sicherer.
    return { note: klemme((60 + treffer * 20) * (NARRATIV_FAKTOR[bestes] ?? 1)), narrativ: bestes }
}

/*
 * Nicht jedes erkannte Thema ist gleich viel wert.
 *
 * Der Radar sucht Neues MIT SUBSTANZ. „Gehört zu den Memes" ist eine
 * Einordnung, aber kein Beleg für eine Idee — anders als RWA, DePIN oder
 * Restaking, wo das Thema eine Aussage über das Vorhaben macht. Ohne diesen
 * Faktor stand ein Meme-Klon trotz Trittbrett-Abzug HÖHER als ein neutraler
 * Fund ohne Thema, weil die Themen-Teilnote den Abzug überwog.
 */
const NARRATIV_FAKTOR = { meme: 0.5 }

/**
 * Stichwort-Treffer mit Wortanfang statt blosser Teilzeichenkette.
 *
 * `text.includes('ai')` traf „Ag-ai-n", „N-ai" und „S-ai-lor" — und weil `ai`
 * zum ersten Thema der Liste gehört, wurden daraus reihenweise KI-Projekte,
 * die Meme-Münzen waren. Dasselbe drohte bei `bot` in „robot", `usd` in
 * beliebigen Bezeichnern und `stake` in „mistake".
 *
 * Der Anker sitzt am Wortanfang und nicht auch am Ende: „dogezilla" soll über
 * `dog` gefunden werden und „pepecoin" über `pepe`. Mehrwortbegriffe („real
 * world") werden unverändert als Zeichenkette gesucht.
 */
function passt(text, wort) {
    if (wort.includes(' ')) return text.includes(wort)
    if (!ANKER_WOERTER.has(wort)) return text.includes(wort)
    const escaped = wort.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^a-z0-9])${escaped}`, 'i').test(text)
}

/*
 * Nur DIESE Stichwörter müssen am Wortanfang stehen.
 *
 * Der Anker pauschal für alle war zu scharf: „SOLCAT" und „RobinhoodCat"
 * verloren dadurch ihre Meme-Einordnung, weil `cat` mitten im Wort steht —
 * und zusammengesetzte Namen sind in dieser Ecke die Regel, nicht die
 * Ausnahme. Gebraucht wird der Anker dort, wo ein Treffer in der Wortmitte
 * nichts bedeutet: `ai` in „Again", `bot` in „robot", `stake` in „mistake",
 * `ape` in „escape", `play` in „display".
 */
const ANKER_WOERTER = new Set(['ai', 'zk', 'rwa', 'bot', 'usd', 'pay', 'stake', 'node', 'play', 'ape'])

/**
 * Wie jung ist das Paar.
 *
 * Der Radar sucht Neues. Bis zwei Wochen volle Punktzahl, danach linear
 * fallend bis drei Monate — was älter ist, ist kein Fund mehr, sondern ein
 * Bestand.
 */
export function noteNeuheit(k) {
    const stunden = Number(k?.markt?.paarAlterStunden)
    if (!Number.isFinite(stunden)) return 0    // unbekannt heisst nicht „neu"
    const tage = stunden / 24
    if (tage <= 14) return 100
    if (tage >= 90) return 0
    return klemme(100 * (1 - (tage - 14) / (90 - 14)))
}

/**
 * Namen, von denen sich Trittbrettfahrer bedienen.
 *
 * Bewusst nur etablierte Meme-Marken und keine Fachbegriffe: „DOGEZILLA",
 * „PEPECOIN", „SOLCAT", „CYBERTRUMP" und „CHARIZARD" leihen sich einen
 * bekannten Namen und hoffen auf die Verwechslung. Das ist kein neues
 * Projekt, sondern ein Aufguss.
 */
/*
 * Namen bestehender KRYPTO-Marken. Hier ist der exakte Name das Original und
 * kein Aufguss: „DOGE" ist DOGE, erst „DOGEZILLA" fährt mit.
 */
const KRYPTO_MARKEN = [
    'pepe', 'doge', 'shib', 'inu', 'bonk', 'wif', 'floki',
    'safemoon', 'wojak', 'bitcoin', 'ethereum', 'solana', 'btc', 'eth',
]

/*
 * Fremde Marken und Figuren. Hier ist SCHON der exakte Name geborgt — es gibt
 * keinen legitimen „Charizard-Coin", von dem sich ein anderer abheben müsste.
 * Genau daran ist der erste Entwurf gescheitert: „CHARIZARD" entkam dem
 * Abzug, weil der Schutz fürs Original auch für geliehene Namen galt.
 */
const FREMD_MARKEN = [
    'elon', 'trump', 'moon', 'baby', 'mini', 'chad',
    'pikachu', 'charizard', 'pokemon', 'mario', 'sonic', 'garfield', 'grok',
]

/**
 * Fährt der Fund auf einem fremden Namen mit?
 *
 * Der Radar soll neue Projekte MIT SUBSTANZ finden. Ein Name, der einen
 * etablierten enthält und noch etwas anhängt, ist das Gegenteil davon: Er
 * bringt keine eigene Idee mit, sondern die Hoffnung auf eine Verwechslung.
 * Diese Funde bekommen einen Abzug und ein sichtbares Kennzeichen — sie
 * verschwinden nicht, denn manchmal läuft so ein Aufguss trotzdem, und das
 * still zu verschweigen wäre eine andere Art zu lügen.
 *
 * Der Name muss LÄNGER sein als das Vorbild: „DOGE" selbst ist kein
 * Trittbrettfahrer, „DOGEZILLA" schon.
 *
 * @returns {{ja:boolean, vorbild:string}}
 */
export function istTrittbrettfahrer(k) {
    const symbol = String(k?.symbol || '').toLowerCase()
    const name = String(k?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const felder = [symbol, name].filter(Boolean)

    // Fremde Marken: schon die blosse Verwendung ist geliehen.
    for (const v of FREMD_MARKEN) {
        if (felder.some((f) => f.includes(v))) return { ja: true, vorbild: v }
    }
    // Krypto-Marken: nur, wenn noch etwas drangehängt wurde.
    for (const v of KRYPTO_MARKEN) {
        if (felder.some((f) => f !== v && f.includes(v))) return { ja: true, vorbild: v }
    }
    return { ja: false, vorbild: '' }
}

/** Wie stark ein Aufguss abgewertet wird (Prozent der Gesamtnote). */
export const TRITTBRETT_ABZUG = 35

/**
 * Gesamtnote eines Kandidaten.
 *
 * @returns {{hypeScore:number, teilnoten:object, narrativ:string, trittbrett:object}}
 */
export function bewerte(kandidat, gewichte = STANDARD_GEWICHTE, narrative = STANDARD_NARRATIVE) {
    const g = { ...STANDARD_GEWICHTE, ...(gewichte || {}) }
    const narr = noteNarrativ(kandidat, narrative)

    const teilnoten = {
        sozial: noteSozial(kandidat),
        volumen: noteVolumen(kandidat),
        quellen: noteQuellen(kandidat),
        narrativ: narr.note,
        neuheit: noteNeuheit(kandidat),
    }

    // Durch die Gewichtssumme teilen statt fest durch 100: wer die Gewichte
    // von Hand verstellt und dabei nicht auf 100 kommt, soll trotzdem eine
    // Note zwischen 0 und 100 bekommen und keine krumme Zahl.
    const summe = Object.values(g).reduce((a, b) => a + (Number(b) || 0), 0) || 1
    const gewichtet = Object.entries(teilnoten)
        .reduce((acc, [feld, note]) => acc + note * (Number(g[feld]) || 0), 0)

    /*
     * Der Abzug greift NACH der Gewichtung und nicht als sechste Teilnote:
     * „fährt auf einem fremden Namen mit" ist kein Merkmal, das sich gegen
     * die anderen aufrechnen liesse — es entwertet den ganzen Fund.
     */
    const tritt = istTrittbrettfahrer(kandidat)
    const roh = klemme(gewichtet / summe)
    const note = tritt.ja ? roh * (1 - TRITTBRETT_ABZUG / 100) : roh

    return {
        hypeScore: Math.round(klemme(note)),
        teilnoten,
        narrativ: narr.narrativ,
        trittbrett: tritt,
    }
}

/**
 * Veränderung gegenüber dem letzten Lauf.
 *
 * Erst mit Historie messbar und deshalb getrennt: ein Sprung von 40 auf 70
 * sagt mehr über beginnenden Hype als der Stand 70 allein. Wird vom Bericht
 * genutzt, nicht von der Note — sonst hinge die Rangfolge davon ab, ob es
 * zufällig einen Vorlauf gab.
 */
export function sozialVeraenderung(jetzt, vorher) {
    const a = Number(vorher?.hypeScore)
    const b = Number(jetzt?.hypeScore)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null
    return b - a
}
