/**
 * Ausführungsgüte: was eine Order WIRKLICH kostet.
 *
 * Rein — Orderbuch hinein, Zahlen heraus, kein Netz, keine Datenbank.
 *
 * Warum es das braucht: Der Coin-Radar mass Handelbarkeit bisher über den
 * Spread der besten Quote und die Menge, die dort liegt. Beides ist zu wenig.
 * Ein enger Spread über fünf Dollar sagt nichts darüber, was eine Order über
 * fünftausend kostet — und genau das ist die Frage. Der Beleg steht in
 * `bewertung.js`: Eine Hürde auf die Spitzenmenge erschlug ACEUSDT mit 559 Mio
 * Tagesumsatz, weil dort fünf Dollar lagen.
 *
 * Slippage ist die ehrliche Antwort. Sie wird gegen die MITTE gemessen, nicht
 * gegen die beste Quote: Wer gegen die beste Quote misst, versteckt den halben
 * Spread und rechnet sich die Ausführung schön.
 */

/** Beträge, für die gerechnet wird. Deckt Konto-nahe Ordergrössen ab. */
export const BETRAEGE_USD = [1000, 5000, 10000]

/**
 * Was eine Market-Order über `betragUsd` kostet.
 *
 * @param {Array<[number,number]>} seite  Ebenen [Preis, Menge], beste zuerst
 * @param {number} betragUsd
 * @param {number} mitte   Mittelkurs als Bezugspunkt
 * @param {number} richtung  +1 = Kauf (teurer ist schlechter), -1 = Verkauf
 * @returns {{slippageBp:number|null, gefuellt:number, vollstaendig:boolean}}
 */
export function slippage(seite, betragUsd, mitte, richtung = 1) {
    if (!Array.isArray(seite) || !seite.length || !(mitte > 0) || !(betragUsd > 0)) {
        return { slippageBp: null, gefuellt: 0, vollstaendig: false }
    }

    let offen = betragUsd
    let kosten = 0
    let menge = 0
    for (const [preis, verfuegbar] of seite) {
        if (!(preis > 0) || !(verfuegbar > 0)) continue
        const wert = preis * verfuegbar
        const nehmen = Math.min(offen, wert)
        kosten += nehmen
        menge += nehmen / preis
        offen -= nehmen
        if (offen <= 0) break
    }

    /*
     * Reicht das Buch nicht, wird NICHT hochgerechnet.
     *
     * Eine Slippage aus einem halb gefüllten Buch wäre zu gut — der teuerste
     * Teil der Order fehlte gerade. `vollstaendig: false` sagt „diese
     * Ordergrösse passt hier nicht ins Buch", und das ist die eigentliche
     * Aussage, nicht eine geschönte Zahl.
     */
    if (!menge) return { slippageBp: null, gefuellt: 0, vollstaendig: false }
    const schnitt = kosten / menge
    const bp = ((schnitt - mitte) / mitte) * 10000 * richtung
    return {
        slippageBp: bp,
        gefuellt: betragUsd - Math.max(0, offen),
        vollstaendig: offen <= 0,
    }
}

/**
 * Wie viel Kapital innerhalb einer Preisspanne im Buch liegt.
 *
 * Die Antwort auf „wie dick ist das Buch da, wo es zählt". Anders als die
 * Spitzenmenge lässt sich das nicht durch eine feine Tickgrösse verzerren.
 *
 * @returns {number} USD innerhalb ±bp um die Mitte
 */
export function tiefeInBp(seite, mitte, bp) {
    if (!Array.isArray(seite) || !(mitte > 0)) return 0
    const grenze = mitte * (bp / 10000)
    let summe = 0
    for (const [preis, menge] of seite) {
        if (Math.abs(preis - mitte) > grenze) break   // Ebenen sind sortiert
        summe += preis * menge
    }
    return summe
}

/**
 * Das ganze Bild eines Orderbuchs.
 *
 * Kauf und Verkauf getrennt, weil sie sich unterscheiden können — und der
 * Unterschied ist die interessante Information: Ein Buch, das den Einstieg
 * billig und den Ausstieg teuer macht, ist eine Falle, die kein
 * Durchschnittswert zeigt.
 *
 * @returns {object|null}
 */
export function ausfuehrungsGuete(buch, betraege = BETRAEGE_USD) {
    const bids = buch?.bids || []
    const asks = buch?.asks || []
    if (!bids.length || !asks.length) return null

    const bestBid = bids[0][0]
    const bestAsk = asks[0][0]
    if (!(bestBid > 0) || !(bestAsk > 0) || bestAsk < bestBid) return null
    const mitte = (bestBid + bestAsk) / 2

    const kauf = {}
    const verkauf = {}
    for (const b of betraege) {
        kauf[b] = slippage(asks, b, mitte, 1)
        verkauf[b] = slippage(bids, b, mitte, -1)
    }

    return {
        mitte,
        spreadBp: ((bestAsk - bestBid) / mitte) * 10000,
        kauf,
        verkauf,
        tiefe: {
            10: tiefeInBp(bids, mitte, 10) + tiefeInBp(asks, mitte, 10),
            25: tiefeInBp(bids, mitte, 25) + tiefeInBp(asks, mitte, 25),
            50: tiefeInBp(bids, mitte, 50) + tiefeInBp(asks, mitte, 50),
        },
        /*
         * Der Rundlauf über den mittleren Betrag: hinein und wieder heraus.
         * Das ist die Zahl, die ein Trade tatsächlich zahlt, und damit die
         * einzige, die sich mit einem Kursziel vergleichen lässt.
         */
        rundlaufBp: rundlauf(kauf, verkauf, betraege[Math.floor(betraege.length / 2)]),
    }
}

function rundlauf(kauf, verkauf, betrag) {
    const k = kauf[betrag]
    const v = verkauf[betrag]
    if (!Number.isFinite(k?.slippageBp) || !Number.isFinite(v?.slippageBp)) return null
    /*
     * Passt der Betrag nicht ins Buch, ist der Slippage-Wert die Kostenrate für
     * den TEIL, der noch gefüllt wurde — nicht für den Auftrag. Als Rundlauf
     * gedruckt sähe ein zu dünnes Buch damit billig aus, und zwar umso
     * billiger, je weniger davon ausführbar war.
     *
     * Die Note ist in dem Fall schon 0. Die Detailzahl muss dieselbe Sprache
     * sprechen: lieber „—" als eine Zahl, die nach Messung aussieht.
     */
    if (!k.vollstaendig || !v.vollstaendig) return null
    // Beide Richtungen sind als Kosten positiv gemessen.
    return k.slippageBp + v.slippageBp
}

/**
 * Eine Note von 0 bis 100 für die Ausführungsgüte.
 *
 * Getrennt von der Gelegenheits-Note (ATR/RVOL/ADX) und ausdrücklich NICHT mit
 * ihr verrechnet: „gut ausführbar" und „interessante Marktphase" sind zwei
 * Fragen. Sie in eine Zahl zu pressen hiesse, dass ein wilder Coin mit teurem
 * Buch so aussieht wie ein ruhiger mit billigem.
 *
 * Ein Buch, in das der Betrag nicht passt, bekommt NULL — nicht einen Abzug.
 * Wer nicht herauskommt, hat kein Ausführungsproblem, sondern gar keine
 * Ausführung.
 */
export function noteAusfuehrung(g, betragUsd = 5000) {
    if (!g) return null
    const k = g.kauf?.[betragUsd]
    const v = g.verkauf?.[betragUsd]
    if (!k?.vollstaendig || !v?.vollstaendig) return 0

    const rund = Number(g.rundlaufBp)
    if (!Number.isFinite(rund)) return null
    /*
     * Anker: 5 bp Rundlauf ist ausgezeichnet (BTC-Niveau), 60 bp sind so
     * teuer, dass ein Scalp nicht mehr aufgeht. Dazwischen linear.
     */
    const roh = 100 * (1 - (rund - 5) / (60 - 5))
    return Math.max(0, Math.min(100, roh))
}
