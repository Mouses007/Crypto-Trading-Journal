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

    /*
     * Reddit: die Position in „hot", nicht die Stimmenzahl.
     *
     * Der RSS-Feed nennt keine Stimmen — nur die Reihenfolge, und die ist
     * bereits nach Zustimmung sortiert. Platz 1 wiegt am schwersten, Platz 50
     * kaum noch.
     *
     * GEDECKELT bei 60 und nicht bei 100: r/CryptoMoonShots ist ein Ort, an
     * dem Leute ihre eigenen Token bewerben. Ein Auftritt dort ist ein
     * Hinweis, keine Bestätigung — er soll einen Fund nicht allein an die
     * Spitze tragen.
     */
    const rang = Number(s.redditRang)
    if (Number.isFinite(rang) && rang > 0) {
        punkte = Math.max(punkte, klemme(Math.min(REDDIT_DECKEL, 61 - rang)))
    }

    /*
     * Die gekauften Sozialsignale sind am 21.08.2026 entfallen.
     *
     * `galaxyScore`/`altRank` kamen von LunarCrush, `stimmen` von Reddit,
     * `panicScore` von CryptoPanic — alle drei Quellen sind entfernt, weil
     * keine davon nutzbar war (Reddit sperrt mit 403, die anderen beiden haben
     * keinen Gratis-Tarif mehr). Die Zweige standen danach als toter Code da:
     * geprüft trug KEINER der 2337 gespeicherten Kandidaten eines dieser
     * Felder. Sie zu behalten hiesse, eine Bewertung zu beschreiben, die nicht
     * stattfinden kann.
     *
     * Übrig bleibt die gekaufte Aufmerksamkeit unten — kein Sozialsignal im
     * eigentlichen Sinn, aber messbar und gedeckelt.
     */
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

/** Und höchstens so viel trägt ein Auftritt in einem Werbe-Unterforum. */
export const REDDIT_DECKEL = 60

/**
 * Zieht der Handel an.
 *
 * Verglichen wird das Volumen der letzten Stunde mit dem Stundenmittel der
 * Stunden DAVOR. Ein Wert von 1 heisst „läuft wie gehabt", 3 heisst „dreimal
 * so viel wie üblich". Fehlt die Stundenangabe, wird auf sechs Stunden
 * ausgewichen.
 *
 * Zwei Korrekturen vom 07.10.2026:
 *
 *   Das Paar existiert erst seit `paarAlterStunden`. Für ein drei Stunden
 *   altes Paar ist `volumen24h` sein GESAMTES Volumen aus drei Stunden — durch
 *   24 geteilt, sah jeder gleichmässige Handel nach achtfachem Schub aus und
 *   bekam die volle Teilnote. Zusammen mit Neuheit 100 war die Note für
 *   frische Funde damit im Kern eine Alters-Note. Geteilt wird jetzt durch
 *   die Stunden, die es das Paar tatsächlich gibt.
 *
 *   Die Vergleichsbasis enthält die gemessene Stunde nicht mehr. Sonst zieht
 *   ein Ausbruch seinen eigenen Vergleichswert hoch und dämpft sich selbst —
 *   dieselbe Regel, nach der der Coin-Radar sein RVOL rechnet.
 *
 * Ein Paar, das jünger als zwei Stunden ist, hat keine Vorstunde zum
 * Vergleichen: dann das schwache Ja wie ohne Stundenauflösung.
 */
export function noteVolumen(k) {
    const m = k?.markt || {}
    const tag = Number(m.volumen24h) || 0
    if (tag <= 0) return 0

    const alter = Number(m.paarAlterStunden)
    const stunden = m.paarAlterStunden !== null && m.paarAlterStunden !== undefined && Number.isFinite(alter)
        ? Math.min(24, alter)
        : 24
    if (stunden < 2) return SCHWACHES_JA

    const faktorFuer = (fenster, fensterStunden) => {
        if (!(fenster > 0) || stunden <= fensterStunden) return null
        const basisJeStunde = (tag - fenster) / (stunden - fensterStunden)
        // Alles Volumen im letzten Fenster: der stärkste Schub, den es gibt.
        if (!(basisJeStunde > 0)) return Infinity
        return (fenster / fensterStunden) / basisJeStunde
    }
    const faktor = faktorFuer(Number(m.volumen1h), 1) ?? faktorFuer(Number(m.volumen6h), 6)
    if (faktor === null) return SCHWACHES_JA   // Handel ja, aber keine Auflösung

    // Faktor 1 → 25, Faktor 4 → 100. Darüber gedeckelt: was zehnmal über dem
    // Schnitt liegt, ist nicht doppelt so interessant wie fünfmal darüber.
    return klemme(Math.min(faktor, 4) * 25)
}

/** Handel ist da, aber er lässt sich mit nichts vergleichen. */
const SCHWACHES_JA = 20

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
    // Binnengrossbuchstaben und Ziffern trennen Wörter: „AirDAO" ist „Air DAO",
    // „AI16Z" ist „AI 16 Z" — sonst entscheidet die Schreibweise über das Thema.
    const name = String(k?.name || '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    const text = `${k?.symbol || ''} ${name}`.toLowerCase()
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
    const escaped = wort.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (GANZE_WOERTER.has(wort)) return new RegExp(`(^|[^a-z0-9])${escaped}s?(?![a-z0-9])`, 'i').test(text)
    if (ANFANG_WOERTER.has(wort)) return new RegExp(`(^|[^a-z0-9])${escaped}`, 'i').test(text)
    return text.includes(wort)
}

/*
 * Am Wortanfang, aber nicht als ganzes Wort verlangt: „ElonDoge" und
 * „WifHat" sollen treffen, „Melon" und „Swift" nicht.
 */
const ANFANG_WOERTER = new Set(['elon', 'wif'])

/*
 * Nur DIESE Stichwörter müssen als ganzes Wort stehen (ein angehängtes
 * Plural-s ist erlaubt).
 *
 * Der Anker pauschal für alle war zu scharf: „SOLCAT" und „RobinhoodCat"
 * verloren dadurch ihre Meme-Einordnung, weil `cat` mitten im Wort steht —
 * und zusammengesetzte Namen sind in dieser Ecke die Regel, nicht die
 * Ausnahme. Gebraucht wird er dort, wo ein Treffer im Wort nichts bedeutet:
 * `ai` in „Again", `bot` in „robot", `stake` in „mistake", `ape` in „escape",
 * `play` in „display".
 *
 * Bis zum 07.10.2026 genügte hier der WORTANFANG — und damit trafen „AirDAO"
 * und „Aim" (ai), „Botanix" (bot), „Marketing" (market) und, ganz ohne Anker,
 * „Alphabet" (bet). Jeder dieser Treffer war 16 Punkte der Gesamtnote wert.
 */
const GANZE_WOERTER = new Set([
    'ai', 'zk', 'rwa', 'bot', 'usd', 'pay', 'stake', 'node', 'play', 'ape', 'bet', 'market',
])

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
 * Meme-Marken: Hier ist der exakte Name das Original und kein Aufguss —
 * „DOGE" ist DOGE, erst „DOGEZILLA" fährt mit. Angeklebt wird vorn wie hinten
 * („BASEDOGE", „DOGEZILLA"), deshalb zählen Wortanfang UND Wortende.
 */
const MEME_MARKEN = ['pepe', 'doge', 'shib', 'inu', 'bonk', 'wif', 'floki', 'safemoon', 'wojak']

/*
 * Grundwerte. Als Wortteil wären sie wertlos: „ETHFI", „Ethena", „Tether",
 * „WBTC" und „mETH" enthalten sie alle und sind eigene Projekte oder
 * Wertpapier-Hüllen. Ein Aufguss nennt den Grundwert als eigenes Wort neben
 * einem anderen („Ethereum Max", „BTC Bull") — oder hängt bei den langen
 * Namen etwas direkt an („BITCOINHYPER").
 */
const GRUND_MARKEN = ['bitcoin', 'ethereum', 'solana', 'btc', 'eth']

/*
 * Fremde Marken und Figuren. Hier ist SCHON der exakte Name geborgt — es gibt
 * keinen legitimen „Charizard-Coin", von dem sich ein anderer abheben müsste.
 * Genau daran ist der erste Entwurf gescheitert: „CHARIZARD" entkam dem
 * Abzug, weil der Schutz fürs Original auch für geliehene Namen galt.
 *
 * Die kurzen nur am Wortanfang: am Ende trafen sie „Melon" (elon) und
 * „Gemini" (mini). Die langen auch am Ende („CYBERTRUMP" ohne Binnen-
 * grossschreibung).
 */
const FREMD_KURZ = ['elon', 'moon', 'baby', 'mini', 'chad', 'grok']
const FREMD_LANG = ['trump', 'pikachu', 'charizard', 'pokemon', 'mario', 'sonic', 'garfield']

/*
 * Eigenständige Projekte, deren Name zufällig eine Marke enthält. Verglichen
 * wird der ganze Name ohne Leer- und Sonderzeichen.
 */
const ORIGINALE = new Set([
    'dogecoin', 'dogwifhat', 'shibainu', 'moonbeam', 'babylon', 'minima', 'sonic', 'flokiinu',
])

/** Hüllen um einen Grundwert sind kein Aufguss („Wrapped Bitcoin"). */
const HUELLEN = new Set(['wrapped', 'staked', 'bridged', 'liquid', 'restaked'])

/**
 * Name in Wörter zerlegen — auch an Binnengrossbuchstaben („CyberTrump").
 */
function woerterVon(k) {
    const name = String(k?.name || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
    const woerter = name.split(/[^a-z0-9]+/).filter(Boolean)
    const symbol = String(k?.symbol || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    return { symbol, woerter, kompakt: woerter.join('') }
}

/**
 * Steht die Marke als eigenes Wort neben einem anderen („Baby Doge")?
 * Ein einzelner Buchstabe davor ist kein Wort, sondern ein Kürzel („mETH").
 */
function nebenAnderem(woerter, marke) {
    return woerter.includes(marke) && woerter.some((w) => w !== marke && w.length >= 2)
}

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
 * Bis zum 07.10.2026 genügte eine Teilzeichenkette irgendwo im Namen. Das traf
 * „Melon" (elon), „Swift" (wif), „Tether", „Ethena" und „ETHFI" (eth),
 * „WBTC" (btc), „Gemini" (mini) — und sogar die Originale „Dogecoin",
 * „dogwifhat" und „Shiba Inu" — mit 35 % Abzug. Jetzt zählt die Lage im Wort.
 *
 * @returns {{ja:boolean, vorbild:string}}
 */
export function istTrittbrettfahrer(k) {
    const { symbol, woerter, kompakt } = woerterVon(k)
    if (ORIGINALE.has(kompakt)) return { ja: false, vorbild: '' }
    const alle = [symbol, ...woerter].filter(Boolean)

    for (const v of FREMD_KURZ) {
        if (alle.some((w) => w.startsWith(v))) return { ja: true, vorbild: v }
    }
    for (const v of FREMD_LANG) {
        if (alle.some((w) => w.startsWith(v) || w.endsWith(v))) return { ja: true, vorbild: v }
    }
    for (const v of MEME_MARKEN) {
        // Das Kürzel IST die Marke: dann ist es das Original, nicht ein Klon.
        if (symbol === v) continue
        const angeklebt = alle.some((w) => w !== v && (w.startsWith(v) || w.endsWith(v)))
        const daneben = nebenAnderem(woerter, v)
        if (angeklebt || daneben) return { ja: true, vorbild: v }
    }
    if (!HUELLEN.has(woerter[0])) {
        for (const v of GRUND_MARKEN) {
            if (symbol === v) continue
            const daneben = nebenAnderem(woerter, v)
            const angehaengt = v.length >= 6 && alle.some((w) => w !== v && w.startsWith(v))
            if (daneben || angehaengt) return { ja: true, vorbild: v }
        }
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
