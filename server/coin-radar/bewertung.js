/**
 * Coin-Radar, Bewertung: aus Kennzahlen wird eine Rangfolge.
 *
 * Rein — keine Netz-, keine Datenbankzugriffe. Zwei Sätze aus der Praxis
 * bestimmen den Aufbau, und beide sind wichtiger als jede Feinjustierung der
 * Gewichte:
 *
 *   „Hohe Volatilität ohne Liquidität führt zu schlechter Ausführung."
 *     → Liquidität ist eine HÜRDE, keine Teilnote. Ein illiquider Zappelcoin
 *       darf nicht nach oben ranken, egal wie wild er aussieht. Eine Teilnote
 *       liesse sich durch die anderen überstimmen; eine Hürde nicht.
 *
 *   „Ein Parameter allein liefert selten ein brauchbares Signal."
 *     → gewichtete Gesamtnote aus mehreren Teilnoten, jede einzeln
 *       gespeichert. Eine Zahl ohne Herkunft ist nicht überprüfbar.
 *
 * Was die Seite ausdrücklich NICHT behauptet: wohin der Kurs geht.
 * Volatilität ist beharrlich — sie kommt in Phasen, die Monate anhalten
 * können, und deshalb trägt eine Rangfolge nach Bewegung überhaupt in die
 * Gegenwart. Die Richtung ist es nicht.
 */

/** Vorgabe-Gewichte. Summe 100; die Oberfläche prüft das beim Speichern. */
export const STANDARD_GEWICHTE = {
    bewegung: 30,   // ATR% — lohnt sich der Einstieg überhaupt
    imSpiel: 30,    // RVOL — ist gerade etwas los
    trend: 25,      // ADX — läuft es sauber oder sägt es
    kosten: 15,     // Funding — was kostet das Halten
}

/** Vorgabe-Hürden. Wer sie reisst, kommt nicht in die Rangliste. */
export const STANDARD_HUERDEN = {
    minUmsatz24hUsd: 10_000_000,   // Praxisschwelle gegen Rutschverluste
    maxSpreadBp: 5,                // 5 Basispunkte = 0,05 %
    minTiefeUsd: 5_000,            // was an der Spitze wirklich liegt
    minKerzen: 30,                 // ohne Historie keine belastbare Kennzahl
}

/**
 * Kennwerte, ab denen eine Teilnote voll ausschlägt.
 *
 * Bewusst als Konstanten mit Begründung statt als magische Zahlen im Code:
 * Wer sie später verschiebt, soll sehen, woher sie kamen.
 */
export const ANKER = {
    // 3 % ATR auf Stundenbasis ist für einen Perp schon lebhaft; darüber
    // steigt vor allem das Risiko, nicht die Gelegenheit.
    atrPctVoll: 3,
    // 2,0 gilt in der Praxis als „im Spiel"; 4 ist ein deutlicher Ausbruch.
    rvolVoll: 4,
    rvolSchwelle: 2,
    // Unter 20 ist Seitwärts, ab 25 trendet es, 40 ist ein starker Trend.
    adxUnten: 20,
    adxVoll: 40,
    // Ab 50 % Jahresrate ist Funding ein ernsthafter Kostenfaktor.
    fundingTeuer: 50,
}

const klemme = (n) => {
    const z = Number(n)
    if (!Number.isFinite(z)) return 0
    return Math.max(0, Math.min(100, z))
}

/** Lineare Abbildung von [von,bis] auf [0,100], ausserhalb gedeckelt. */
function skala(wert, von, bis) {
    const w = Number(wert)
    if (!Number.isFinite(w)) return 0
    if (bis === von) return 0
    return klemme(((w - von) / (bis - von)) * 100)
}

/**
 * Hürden prüfen — VOR jeder Bewertung.
 *
 * @returns {{ok:boolean, grund:string}}
 */
export function pruefeHuerden(roh = {}, huerden = STANDARD_HUERDEN) {
    const h = { ...STANDARD_HUERDEN, ...(huerden || {}) }

    const umsatz = Number(roh.umsatz24h) || 0
    if (umsatz < h.minUmsatz24hUsd) return { ok: false, grund: 'umsatz_zu_klein' }

    /*
     * Fehlender Spread ist kein Freibrief. Ein Symbol, für das keine
     * Orderbuch-Spitze kam, ist ungeprüft — und ungeprüft gehört nicht in
     * eine Liste, die „hier kannst du gut rein und raus" behauptet.
     */
    const spread = Number(roh.spreadBp)
    if (!Number.isFinite(spread)) return { ok: false, grund: 'spread_unbekannt' }
    if (spread > h.maxSpreadBp) return { ok: false, grund: 'spread_zu_weit' }

    const tiefe = Number(roh.tiefeUsd)
    if (Number.isFinite(tiefe) && tiefe < h.minTiefeUsd) return { ok: false, grund: 'zu_wenig_tiefe' }

    return { ok: true, grund: '' }
}

/**
 * Teilnoten und Gesamtnote.
 *
 * @param {object} roh    {umsatz24h, spreadBp, tiefeUsd, fundingJahresRate}
 * @param {object} ze     Kennzahlen je Zeiteinheit, z. B. {'1h':{atrPct,rvol,adx}, '15m':{…}}
 * @param {object} gewichte
 * @param {string} haupt  welche Zeiteinheit die Note trägt
 * @returns {{note:number, teilnoten:object, bestaetigt:boolean|null, hinweise:string[]}}
 */
export function bewerte(roh = {}, ze = {}, gewichte = STANDARD_GEWICHTE, haupt = '1h') {
    const g = { ...STANDARD_GEWICHTE, ...(gewichte || {}) }
    const hinweise = []
    const H = ze[haupt] || {}

    /*
     * Funding invertiert: teuer heisst wenige Punkte. Ein Coin, dessen
     * Haltekosten den Vorteil auffressen, ist kein guter Kandidat — auch
     * wenn er sich prächtig bewegt.
     *
     * UNBEKANNT ist dabei nicht dasselbe wie NULL. Mit `Number(x) || 0` hätte
     * ein Coin ohne Funding-Daten die volle Punktzahl für „günstig" bekommen
     * und damit besser dagestanden als einer mit gemessen niedrigen Kosten.
     * Unbekanntes bekommt deshalb die Mitte und einen Hinweis.
     */
    const fundingRoh = roh.fundingJahresRate
    const fundingBekannt = fundingRoh !== null && fundingRoh !== undefined
        && Number.isFinite(Number(fundingRoh))
    if (!fundingBekannt) hinweise.push('Funding unbekannt')

    const teilnoten = {
        bewegung: skala(H.atrPct, 0, ANKER.atrPctVoll),
        imSpiel: skala(H.rvol, 1, ANKER.rvolVoll),
        trend: skala(H.adx, ANKER.adxUnten, ANKER.adxVoll),
        kosten: fundingBekannt
            ? 100 - skala(Math.abs(Number(fundingRoh)), 0, ANKER.fundingTeuer)
            : 50,
    }

    const summe = Object.values(g).reduce((a, b) => a + (Number(b) || 0), 0) || 1
    const gewichtet = Object.entries(teilnoten)
        .reduce((acc, [feld, note]) => acc + note * (Number(g[feld]) || 0), 0)
    let note = klemme(gewichtet / summe)

    /*
     * Die zweite Zeiteinheit bestätigt oder widerspricht — sie bekommt keine
     * eigene Note. Läuft es auf beiden Ebenen, ist das ein anderer Befund als
     * ein Ausschlag, den nur die kurze Ebene sieht; und wenn sie sich
     * widersprechen, ist das eine Information und kein Mittelwert.
     */
    let bestaetigt = null
    const zweite = Object.keys(ze).find((k) => k !== haupt)
    if (zweite && Number.isFinite(ze[zweite]?.rvol)) {
        const kurzImSpiel = ze[zweite].rvol >= ANKER.rvolSchwelle
        const hauptImSpiel = Number(H.rvol) >= ANKER.rvolSchwelle
        bestaetigt = kurzImSpiel && hauptImSpiel
        if (bestaetigt) {
            note = klemme(note * 1.1)
            hinweise.push(`auf ${haupt} und ${zweite} im Spiel`)
        } else if (kurzImSpiel && !hauptImSpiel) {
            hinweise.push(`nur auf ${zweite} im Spiel — kurzfristiger Ausschlag`)
        } else if (!kurzImSpiel && hauptImSpiel) {
            hinweise.push(`auf ${zweite} bereits abgeflaut`)
        }
    }

    if (Number.isFinite(H.adx) && H.adx < ANKER.adxUnten) hinweise.push('sägt seitwärts')
    if (Math.abs(Number(roh.fundingJahresRate) || 0) >= ANKER.fundingTeuer) {
        hinweise.push(`Funding ${Math.round(roh.fundingJahresRate)} % p. a.`)
    }

    return { note: Math.round(note), teilnoten, bestaetigt, hinweise }
}

/**
 * Rangfolge vergeben. Nur bewertete Zeilen bekommen einen Rang.
 */
export function vergibRaenge(zeilen = []) {
    const bewertet = zeilen.filter((z) => z.status === 'bewertet')
    bewertet
        // Gleichstand nach Symbol, damit zwei Läufe dieselbe Reihenfolge
        // ergeben und die Anzeige nicht ohne Grund springt.
        .sort((a, b) => (b.note - a.note) || String(a.symbol).localeCompare(String(b.symbol)))
        .forEach((z, i) => { z.rang = i + 1 })
    for (const z of zeilen) if (z.status !== 'bewertet') z.rang = 0
    return zeilen
}

/**
 * Rangkorrelation zweier Läufe (Spearman) — die ehrliche Gegenprobe.
 *
 * Sagt die Rangfolge von vorhin die von jetzt voraus? Nahe 1 heisst: die
 * Liste ist stabil und damit brauchbar. Nahe 0 heisst: sie ist Rauschen, und
 * dann soll die Seite das sagen, statt eine überzeugend aussehende Tabelle
 * unkommentiert zu zeigen.
 *
 * Gerechnet wird nur über Symbole, die in BEIDEN Läufen bewertet wurden —
 * sonst misst man Zu- und Abgänge statt Beharrlichkeit.
 *
 * @returns {{wert:number|null, gemeinsam:number}}
 */
export function rangkorrelation(alt = [], neu = []) {
    const altRang = new Map(alt.filter((z) => z.rang > 0).map((z) => [z.symbol, z.rang]))
    const neuRang = new Map(neu.filter((z) => z.rang > 0).map((z) => [z.symbol, z.rang]))

    const gemeinsam = [...altRang.keys()].filter((s) => neuRang.has(s))
    // Unter zehn gemeinsamen Symbolen ist jede Korrelation Zufall.
    if (gemeinsam.length < 10) return { wert: null, gemeinsam: gemeinsam.length }

    /*
     * Über den GEMEINSAMEN Symbolen neu durchnummerieren. Die
     * ursprünglichen Ränge stammen aus unterschiedlich grossen Listen —
     * sie direkt zu vergleichen verzerrte das Ergebnis systematisch.
     */
    const ordne = (karte) => {
        const paare = gemeinsam.map((s) => [s, karte.get(s)]).sort((a, b) => a[1] - b[1])
        return new Map(paare.map(([s], i) => [s, i + 1]))
    }
    const a = ordne(altRang)
    const b = ordne(neuRang)

    const n = gemeinsam.length
    const summeD2 = gemeinsam.reduce((s, sym) => {
        const d = a.get(sym) - b.get(sym)
        return s + d * d
    }, 0)
    const rho = 1 - (6 * summeD2) / (n * (n * n - 1))
    return { wert: Math.max(-1, Math.min(1, rho)), gemeinsam: n }
}
