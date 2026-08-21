/**
 * Selbsttest: BTC-Vergleich.
 *
 * Ohne Netz. Geprüft wird vor allem die Gegenprobe — dass die Paarung über
 * ZEITSTEMPEL läuft und nicht über den Index. Der Unterschied ist unsichtbar,
 * solange beide Reihen vollständig sind, und genau deshalb gefährlich: Ein
 * später gelisteter Coin bekäme sonst eine Korrelation, die aus verschobenen
 * Tagen entsteht und trotzdem plausibel aussieht.
 *
 * Aufruf: node server/coin-radar/__selftest-btc-vergleich.mjs
 */
import {
    paareRenditen, beta, fisherZ, zerfallstest, vergleicheMitBtc, deuteKopplung,
    KOPPLUNG_FEST, KOPPLUNG_LOSE, Z_SIGNIFIKANT, MIN_PUNKTE_HAELFTE,
} from './btc-vergleich.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}
const nahe = (a, b, eps = 1e-9) => a !== null && Number.isFinite(a) && Math.abs(a - b) < eps

const H = 4 * 60 * 60 * 1000
/** Kerzenreihe aus Schlusskursen, 4h-Gitter ab einem festen Startpunkt. */
const reihe = (kurse, start = 1_700_000_000_000, schritt = H) =>
    kurse.map((c, i) => ({ t: start + i * schritt, c }))

console.log('Coin-Radar: BTC-Vergleich')

// ── Paarung über Zeitstempel ────────────────────────────────────────────
{
    /*
     * BTC bewusst mit UNGLEICHEN Schritten. Eine saubere 10-%-Folge hätte in
     * jeder Kerze dieselbe Rendite — dann liefern Index- und Zeitstempel-
     * Paarung zufällig dasselbe, und die Gegenprobe unten prüfte nichts.
     */
    const btc = reihe([100, 110, 115, 140])
    const coin = reihe([10, 11, 12.1, 13.31])
    const { ra, rb } = paareRenditen(coin, btc)
    p('gleiche Zeitgitter ergeben n−1 Renditen', ra.length === 3 && rb.length === 3,
        `${ra.length}/${rb.length}`)
    p('Renditen sind Anteile, keine Kurse', nahe(ra[0], 0.1, 1e-12), String(ra[0]))

    // Der eigentliche Fall: der Coin startet zwei Kerzen später.
    const spaet = reihe([12.1, 13.31], 1_700_000_000_000 + 2 * H)
    const g = paareRenditen(spaet, btc)
    p('später gelisteter Coin paart nur die gemeinsamen Kerzen', g.ra.length === 1,
        String(g.ra.length))

    /*
     * Gegenprobe, und sie muss auf die WERTE zielen, nicht auf die Anzahl:
     * Über den Index gepaart hätte die erste Coin-Kerze (12,10) neben der
     * ersten BTC-Kerze (100) gestanden — zwei verschiedene Tage. Die Zahl der
     * Punkte ist dabei zufällig dieselbe, das Ergebnis aber ein anderes.
     */
    const ueberIndex = spaet.map((k, i) => ({ ...k, t: btc[i].t }))
    const falsch = paareRenditen(ueberIndex, btc)
    p('Index-Paarung vergleicht andere BTC-Renditen',
        !nahe(falsch.rb[0], g.rb[0], 1e-12),
        `${falsch.rb[0]} statt ${g.rb[0]}`)

    // Lücken auf einer Seite dürfen die andere nicht verschieben.
    const mitLuecke = [btc[0], btc[2], btc[3]]
    const l = paareRenditen(coin, mitLuecke)
    p('Lücke reduziert die Punktzahl, statt Kerzen zu verschieben', l.ra.length === 2,
        String(l.ra.length))
}

// ── Beta ────────────────────────────────────────────────────────────────
{
    const rb = [0.01, -0.02, 0.03, -0.01, 0.02]
    p('doppelte Ausschläge ergeben β = 2', nahe(beta(rb.map((x) => x * 2), rb), 2, 1e-12))
    p('gleiche Reihe ergibt β = 1', nahe(beta(rb, rb), 1, 1e-12))
    p('gegenläufig ergibt β = −1', nahe(beta(rb.map((x) => -x), rb), -1, 1e-12))
    /*
     * Ein BTC ohne Streuung hat keine Varianz — β wäre eine Division durch
     * null. `null` und nicht 0: eine Null hiesse „bewegt sich nicht mit", und
     * das wäre eine Aussage über einen Zeitraum, in dem BTC stillstand.
     */
    p('ohne Streuung in BTC gibt es kein β', beta([0.01, 0.02], [0.05, 0.05]) === null)
    p('zu wenige Punkte ergeben kein β', beta([0.01], [0.02]) === null)
}

// ── Fisher-z ────────────────────────────────────────────────────────────
{
    p('z(0) ist 0', nahe(fisherZ(0), 0, 1e-12))
    p('z ist ungerade', nahe(fisherZ(0.5) + fisherZ(-0.5), 0, 1e-12))
    p('|r| = 1 divergiert und ergibt null', fisherZ(1) === null && fisherZ(-1) === null)
    p('Unsinn ergibt null', fisherZ(NaN) === null && fisherZ(null) === null)
}

// ── Zerfallstest ────────────────────────────────────────────────────────
{
    /*
     * Erste Hälfte im Gleichlauf, zweite Hälfte gewürfelt. Ein fester
     * Zufallsgenerator, damit der Test nicht mal grün und mal rot ist.
     */
    let saat = 42
    const wurf = () => {
        saat = (saat * 1103515245 + 12345) % 2147483648
        return saat / 2147483648 - 0.5
    }
    const n = 60
    const rb = Array.from({ length: n }, () => wurf() * 0.02)
    /*
     * Mit Rauschen, nicht exakt linear: `x * 1.2` ergäbe r = 1,000, und dort
     * divergiert die Fisher-Transformation. Echte Kursreihen erreichen das
     * nie — eine Testreihe, die es tut, prüft einen Fall, den es nicht gibt.
     */
    const rcStabil = rb.map((x) => x * 1.2 + wurf() * 0.004)
    const rcBruch = rb.map((x, i) => (i < n / 2 ? x * 1.2 + wurf() * 0.004 : wurf() * 0.02))

    const stabil = zerfallstest(rcStabil, rb)
    p('durchgehender Gleichlauf gilt nicht als zerfallen', stabil.zerfallen === false,
        `z=${stabil.z?.toFixed(2)}`)
    p('beide Hälften werden ausgewiesen', stabil.r1 !== null && stabil.r2 !== null)

    const bruch = zerfallstest(rcBruch, rb)
    p('abgerissener Gleichlauf wird erkannt', bruch.zerfallen === true,
        `z=${bruch.z?.toFixed(2)} r1=${bruch.r1?.toFixed(2)} r2=${bruch.r2?.toFixed(2)}`)

    /*
     * Der Grund für den Fisher-z-Test statt einer rohen Schwelle: Dieselbe
     * Differenz ist bei hohem r bedeutsam und bei niedrigem r Rauschen.
     */
    const kurz = zerfallstest(rb.slice(0, 20), rcStabil.slice(0, 20))
    p('zu kurze Hälften ergeben kein Urteil',
        kurz.z === null && kurz.zerfallen === false, `Hälfte < ${MIN_PUNKTE_HAELFTE}`)
    p('Schwelle ist der zweiseitige 5-%-Wert', Z_SIGNIFIKANT === 1.96)

    /*
     * Grenzfall: Ist eine Hälfte exakt gleichlaufend (r = 1), lässt sich der
     * Unterschied nicht beziffern — Fisher-z divergiert. Dann KEIN Urteil
     * fällen. „Nicht zerfallen" wäre hier ebenso erfunden wie „zerfallen".
     */
    const perfekt = zerfallstest(rb.map((x) => x * 2), rb)
    p('perfekter Gleichlauf ergibt kein Zerfallsurteil',
        perfekt.z === null && perfekt.zerfallen === false)
    p('die Hälften werden trotzdem ausgewiesen',
        perfekt.r1 !== null && perfekt.r2 !== null)
}

// ── Gesamtvergleich ─────────────────────────────────────────────────────
{
    const kurse = (n, f) => Array.from({ length: n }, (_, i) => f(i))
    const btc = reihe(kurse(50, (i) => 100 * (1 + 0.01 * Math.sin(i))))
    const mit = reihe(kurse(50, (i) => 50 * (1 + 0.01 * Math.sin(i))))

    const v = vergleicheMitBtc(mit, btc)
    p('gleichlaufender Coin bekommt hohe Korrelation', v && v.korrelation > 0.99,
        String(v?.korrelation))
    p('Punkte zählen die tatsächlichen Renditen', v?.punkte === 49, String(v?.punkte))
    p('β liegt bei 1, wenn die Ausschläge gleich sind', nahe(v?.beta, 1, 0.05), String(v?.beta))

    /*
     * Die wichtigste Zusicherung der ganzen Datei: zu wenig Historie ergibt
     * `null` und NICHT eine Korrelation von 0. Eine Null würde den Coin im
     * Filter „eigenständig" auftauchen lassen — als gemessenes Ergebnis, wo
     * nie gemessen wurde.
     */
    p('zu kurze Historie ergibt null, nicht 0',
        vergleicheMitBtc(reihe([1, 2, 3]), reihe([1, 2, 3])) === null)
    p('ohne Überschneidung gibt es kein Ergebnis',
        vergleicheMitBtc(reihe([1, 2, 3, 4], 0), reihe([1, 2, 3, 4], 9e12)) === null)
    p('leere Eingabe stürzt nicht ab', vergleicheMitBtc(null, null) === null)

    // Ein flacher Coin hat keine Streuung — Korrelation ist dann nicht definiert.
    p('Coin ohne Bewegung ergibt null',
        vergleicheMitBtc(reihe(kurse(50, () => 7)), btc) === null)
}

// ── Einordnung ──────────────────────────────────────────────────────────
{
    p('fester Gleichlauf', deuteKopplung(KOPPLUNG_FEST) === 'laeuftMit')
    p('Gegenlauf wird eigens benannt', deuteKopplung(-KOPPLUNG_FEST) === 'laeuftGegen')
    p('nahe null heisst eigenständig', deuteKopplung(KOPPLUNG_LOSE) === 'eigenstaendig')
    p('das Feld dazwischen heisst teilweise', deuteKopplung(0.5) === 'teilweise')
    /*
     * `unbekannt` ist ein eigener Zustand. Fiele er mit `eigenstaendig`
     * zusammen, würde ein Coin ohne Messung als unabhängig ausgewiesen.
     */
    p('ohne Messung ist es unbekannt, nicht eigenständig',
        deuteKopplung(null) === 'unbekannt' && deuteKopplung(undefined) === 'unbekannt'
        && deuteKopplung(NaN) === 'unbekannt')
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
