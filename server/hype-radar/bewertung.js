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
    meme: ['dog', 'inu', 'shib', 'pepe', 'cat', 'wojak', 'moon', 'elon', 'trump', 'frog'],
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
    // Bezahlte Hervorhebung ist Aufmerksamkeit, aber gekaufte — sie zählt
    // ausdrücklich schwächer als organische Zustimmung.
    if (Number(s.boostGesamt) > 0) {
        punkte = Math.max(punkte, klemme(Math.log10(Number(s.boostGesamt) + 1) * 20))
    }
    return klemme(punkte)
}

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
    for (const n of narrative) {
        const woerter = NARRATIV_WOERTER[n] || [n]
        const zahl = woerter.filter((w) => text.includes(w)).length
        if (zahl > treffer) { treffer = zahl; bestes = n }
    }
    if (!treffer) return { note: 0, narrativ: '' }
    // Ein Treffer reicht für die Zuordnung; mehrere machen sie sicherer.
    return { note: klemme(60 + treffer * 20), narrativ: bestes }
}

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
 * Gesamtnote eines Kandidaten.
 *
 * @returns {{hypeScore:number, teilnoten:object, narrativ:string}}
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

    return {
        hypeScore: Math.round(klemme(gewichtet / summe)),
        teilnoten,
        narrativ: narr.narrativ,
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
