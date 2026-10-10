/**
 * Taugt die Rangfolge etwas? — die reine Rechnung.
 *
 * Ohne Netz, ohne Datenbank: Ergebniszeilen hinein, Kennzahlen heraus. Genau
 * deshalb prüfbar, und das ist bei einer Zahl, die über Vertrauen in die ganze
 * Seite entscheidet, nicht verhandelbar.
 *
 * Vier Fragen, in dieser Reihenfolge:
 *
 *   1. Trifft die Spitze? — Precision@10: Anteil der obersten zehn, bei denen
 *      der Coin hinterher überhaupt beweglich war. „Beweglich" statt „im
 *      Plus", denn der Radar sagt ausdrücklich nichts über die Richtung.
 *   2. Ist die Spitze besser als der Rest? — Abstand zur KONTROLLGRUPPE, einer
 *      Stichprobe aus der unteren Hälfte desselben Laufs.
 *   3. Ist die Rangfolge besser als Zufall? — Rangkorrelation zwischen dem
 *      vergebenen Rang und dem tatsächlichen Ergebnis.
 *   4. Ist sie besser als das Einfachste, was man stattdessen tun könnte? —
 *      dieselbe Korrelation für eine Rangfolge NUR nach ATR%.
 *
 * Seit dem 07.10.2026 wird JE LAUF gerechnet und erst danach über die Läufe
 * zusammengefasst. Vorher wurden alle Messungen einer Woche in einen Topf
 * geworfen: „die obersten zehn" waren dann die Platz-1-Zeilen von zehn
 * beliebigen Läufen, und die Rangkorrelation vermischte Unterschiede zwischen
 * Stunden mit Unterschieden zwischen Coins. Ein Lauf ist die Einheit, über
 * die die Seite eine Aussage macht — also ist er auch die Einheit der Prüfung.
 */

/*
 * Rangkorrelation und Median kommen aus `shared/statistik.js` -- beide
 * Formeln standen im Projekt mehrfach, die Rangkorrelation zweimal ohne
 * Bindungskorrektur (Audit 28.08.2026, FIN-08).
 */
import { spearman, median } from '../shared/statistik.js'

/**
 * Ab welcher Bewegung ein Coin im Nachhinein als „beweglich" gilt — JE HORIZONT.
 *
 * Bis zum 07.10.2026 galt 1 % für alle drei. Über vier Stunden schafft das
 * fast jeder Perp, Precision@10 stand damit bei 1 und sagte nichts. Die
 * Schwelle wächst hier mit der Wurzel der Zeit, wie eine Spanne es im Mittel
 * auch tut: 1 % für eine Stunde, halb so viel für ein Viertel, doppelt so
 * viel für das Vierfache.
 */
export const BEWEGT_PCT = { '15m': 0.5, '1h': 1.0, '4h': 2.0 }
const BEWEGT_STANDARD = 1.0
export const schwelleFuer = (horizont) => BEWEGT_PCT[horizont] ?? BEWEGT_STANDARD

/** Unter so vielen Messungen je Gruppe wird ein Lauf nicht verglichen. */
const MIN_JE_GRUPPE = 5

/** Unter so vielen vergleichbaren Läufen gibt es kein Urteil. */
export const MIN_LAEUFE = 5

const zahl = (w) => (w === null || w === undefined ? null : (Number.isFinite(Number(w)) ? Number(w) : null))

/** Spannweite zwischen bestem und schlechtestem Punkt, in Prozent. */
export function spanne(z) {
    const hoch = zahl(z?.mfePct)
    const tief = zahl(z?.maePct)
    if (hoch === null || tief === null) return null
    return hoch - tief
}

const gemessen = (zeilen) => zeilen.filter((z) => z.status === 'gemessen' && spanne(z) !== null)

/** Gehört die Zeile zur Kontrollgruppe? Altbestand kennt keine — er hat `spitze`. */
const istKontrolle = (z) => z.gruppe === 'kontrolle'

/**
 * Precision@N — wie oft die Spitze der Liste hielt, was sie versprach.
 *
 * Das Versprechen lautet „dieser Coin lässt sich handeln", nicht „er steigt".
 * Gemessen wird deshalb die SPANNE: Wer sich um weniger als die Schwelle bewegt
 * hat, war nicht handelbar, ganz gleich in welche Richtung. Für EINEN Lauf
 * gedacht — über mehrere Läufe hinweg siehe `werteAus`.
 */
export function precisionAt(zeilen = [], n = 10, schwelle = BEWEGT_STANDARD) {
    const oben = gemessen(zeilen)
        .filter((z) => !istKontrolle(z))
        .sort((a, b) => (a.rang || 9999) - (b.rang || 9999))
        .slice(0, n)
    if (!oben.length) return { wert: null, n: 0 }
    const treffer = oben.filter((z) => spanne(z) >= schwelle).length
    return { wert: treffer / oben.length, n: oben.length, treffer }
}

/**
 * Sagt eine Rangfolge das Ergebnis voraus? (Spearman, EIN Lauf)
 *
 * Nahe +1: Wer oben stand, bewegte sich am meisten — die Liste taugt.
 * Nahe 0: Der Rang sagt nichts. Nahe −1 wäre am aufschlussreichsten, denn
 * dann wäre die Rangfolge systematisch verkehrt herum.
 *
 * Gemessen wird Rang gegen NEGATIVE Spanne: Rang 1 soll die grösste Bewegung
 * sein, und ein positives Rho soll „die Liste taugt" heissen. Die Fassung mit
 * Bindungskorrektur (`spearman`) ist hier Pflicht — mehrere Coins ohne
 * Bewegung ergeben exakt dieselbe Spanne.
 *
 * @param {function} rangVon  welche Rangfolge geprüft wird (Vorgabe: der Rang)
 */
export function rangGegenErgebnis(zeilen = [], rangVon = (z) => z.rang) {
    const paare = gemessen(zeilen)
        .map((z) => ({ rang: zahl(rangVon(z)), wert: spanne(z) }))
        .filter((p) => p.rang !== null && p.rang > 0)
    if (paare.length < 10) return { wert: null, n: paare.length }
    const rho = spearman(paare.map((p) => p.rang), paare.map((p) => -p.wert), 10)
    return { wert: rho, n: paare.length }
}

/**
 * Die Gegenprobe gegen das Einfachste: nur nach ATR% sortiert.
 *
 * ATR% trägt 30 % der Note, und Volatilität hält an — dass eine Liste mit
 * viel ATR% hinterher viel Spanne zeigt, ist fast garantiert und kein
 * Verdienst der übrigen drei Teilnoten. Erst wenn die Note die reine
 * ATR-Rangfolge SCHLÄGT, tragen RVOL, ADX und Funding etwas bei.
 */
function atrRangfolge(zeilen) {
    const mitAtr = gemessen(zeilen).filter((z) => zahl(z.atrPct) !== null)
    const sortiert = [...mitAtr].sort((a, b) => zahl(b.atrPct) - zahl(a.atrPct))
    const rang = new Map(sortiert.map((z, i) => [z, i + 1]))
    return (z) => rang.get(z) ?? null
}

/**
 * Ein Lauf, ein Horizont.
 */
export function werteLaufAus(zeilen = [], horizont = '') {
    const schwelle = schwelleFuer(horizont)
    const alle = gemessen(zeilen)
    const oben = alle.filter((z) => !istKontrolle(z) && z.rang > 0 && z.rang <= 10)
    const kontrolle = alle.filter(istKontrolle)

    const medianOben = median(oben.map(spanne))
    const medianKontrolle = median(kontrolle.map(spanne))
    const vergleichbar = oben.length >= MIN_JE_GRUPPE && kontrolle.length >= MIN_JE_GRUPPE

    return {
        laufId: zeilen[0]?.laufId ?? null,
        precision10: precisionAt(zeilen, 10, schwelle),
        medianSpanneOben: medianOben,
        medianSpanneKontrolle: medianKontrolle,
        abstand: vergleichbar ? medianOben - medianKontrolle : null,
        rangKorrelation: rangGegenErgebnis(zeilen),
        atrKorrelation: rangGegenErgebnis(zeilen, atrRangfolge(zeilen)),
        medianMaeOben: median(oben.map((z) => zahl(z.maePct))),
    }
}

/**
 * Zweiseitiger Vorzeichentest: Wie wahrscheinlich ist ein so einseitiges
 * Ergebnis, wenn oben und Kontrolle in Wahrheit gleich wären?
 *
 * Der einfachste Test, der hier ehrlich ist. Die Läufe sind NICHT unabhängig
 * (dieselben Coins tauchen Stunde um Stunde wieder auf), ein Test auf
 * Mittelwerte würde das noch stärker überschätzen — der p-Wert ist deshalb
 * eher zu optimistisch und als Untergrenze zu lesen.
 */
export function vorzeichenTest(positiv, negativ) {
    const n = positiv + negativ
    if (n <= 0) return null
    const k = Math.max(positiv, negativ)
    // P(X >= k) für X ~ Bin(n, 1/2), in Logarithmen gegen Überlauf.
    const logFak = [0]
    for (let i = 1; i <= n; i++) logFak[i] = logFak[i - 1] + Math.log(i)
    let summe = 0
    for (let i = k; i <= n; i++) {
        summe += Math.exp(logFak[n] - logFak[i] - logFak[n - i] - n * Math.LN2)
    }
    return Math.min(1, 2 * summe)
}

const mittel = (werte) => {
    const w = werte.filter((x) => Number.isFinite(x))
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null
}

/**
 * Exakter Test nach Fisher für eine Vierfeldertafel, zweiseitig.
 *
 *              ja   nein
 *   Gruppe A    a     b
 *   Gruppe B    c     d
 *
 * Für ungepaarte Anteile („lebt" bei Spitze gegen Verworfene). Exakt statt
 * Chi-Quadrat, weil die Gruppen hier zehn bis fünfzig Token gross sind und die
 * Näherung dort nicht trägt. Zweiseitig: alle Tafeln mit denselben Rändern, die
 * höchstens so wahrscheinlich sind wie die beobachtete.
 *
 * @returns {number|null} p-Wert
 */
export function fisherExakt(a, b, c, d) {
    const [x, y, z, w] = [a, b, c, d].map((v) => Math.max(0, Math.round(Number(v) || 0)))
    const n = x + y + z + w
    if (!(n > 0)) return null
    const zeile = x + y
    const spalte = x + z
    const logFak = [0]
    for (let i = 1; i <= n; i++) logFak[i] = logFak[i - 1] + Math.log(i)
    const logP = (k) => logFak[zeile] + logFak[n - zeile] + logFak[spalte] + logFak[n - spalte]
        - logFak[n] - logFak[k] - logFak[zeile - k] - logFak[spalte - k] - logFak[n - zeile - spalte + k]
    const beobachtet = logP(x)
    let summe = 0
    for (let k = Math.max(0, zeile + spalte - n); k <= Math.min(zeile, spalte); k++) {
        const lp = logP(k)
        if (lp <= beobachtet + 1e-9) summe += Math.exp(lp)
    }
    return Math.min(1, summe)
}

/** Unterhalb dieses p-Werts gilt ein Unterschied als gesichert. */
export const P_GRENZE = 0.05

/** Ein Anteil mit Zähler und Nenner — die Oberfläche zeigt beides, nicht nur Prozent. */
const anteilVon = (liste, ja) => {
    const n = liste.length
    const k = liste.filter(ja).length
    return { k, n, wert: n ? k / n : null }
}

/**
 * Die Auswertung eines Horizonts über alle Läufe.
 *
 * Erst je Lauf, dann zusammengefasst — siehe Dateikopf. Die Kontrollgruppe
 * ist eine Zufallsstichprobe aus der UNTEREN HÄLFTE desselben Laufs (seit dem
 * 07.10.2026; vorher waren es die Plätze 11 bis 20, also Nachbarn aus
 * demselben beweglichen Zehntel). Läufe ohne Kontrollgruppe — der Altbestand
 * — gehen in Precision und Korrelation ein, aber nicht in den Vergleich.
 */
export function werteAus(zeilen = [], horizont = '') {
    const jeLauf = new Map()
    for (const z of zeilen) {
        const id = z.laufId ?? 0
        if (!jeLauf.has(id)) jeLauf.set(id, [])
        jeLauf.get(id).push(z)
    }
    const laeufe = [...jeLauf.values()]
        .map((l) => werteLaufAus(l, horizont))
        .filter((l) => l.precision10.n > 0 || l.abstand !== null)

    const abstaende = laeufe.map((l) => l.abstand).filter((a) => a !== null)
    const positiv = abstaende.filter((a) => a > 0).length
    const negativ = abstaende.filter((a) => a < 0).length
    const rhos = laeufe.map((l) => l.rangKorrelation.wert).filter((w) => w !== null)
    const mehrwert = laeufe
        .filter((l) => l.rangKorrelation.wert !== null && l.atrKorrelation.wert !== null)
        .map((l) => l.rangKorrelation.wert - l.atrKorrelation.wert)

    const auswertung = {
        horizont,
        schwellePct: schwelleFuer(horizont),
        anzahl: gemessen(zeilen).length,
        offen: zeilen.filter((z) => z.status === 'offen').length,
        fehlgeschlagen: zeilen.filter((z) => z.status === 'fehlgeschlagen').length,
        laeufe: laeufe.length,
        laeufeMitKontrolle: abstaende.length,
        precision10: mittel(laeufe.map((l) => l.precision10.wert)),
        medianSpanneOben: median(laeufe.map((l) => l.medianSpanneOben)),
        medianSpanneKontrolle: median(laeufe.map((l) => l.medianSpanneKontrolle)),
        abstandMedian: median(abstaende),
        obenVorneAnteil: abstaende.length ? positiv / abstaende.length : null,
        vorzeichenP: vorzeichenTest(positiv, negativ),
        rangKorrelation: mittel(rhos),
        atrKorrelation: mittel(laeufe.map((l) => l.atrKorrelation.wert)),
        mehrwertGegenAtr: mittel(mehrwert),
        medianMaeOben: median(laeufe.map((l) => l.medianMaeOben)),
    }
    auswertung.urteil = urteile(auswertung)
    return auswertung
}

/**
 * Das Urteil — eine Zahl ohne Deutung wird zu gern wohlwollend gelesen. Die
 * Reihenfolge ist Absicht: Jede Stufe setzt die vorige voraus. Geliefert wird
 * ein Kürzel; die Worte dazu stehen in den Sprachdateien (`coinradar.guete_*`).
 */
export const URTEILE = {
    zuWenig: 'zuWenig',                       // zu wenige Läufe mit Kontrollgruppe
    verkehrt: 'verkehrt',                     // die Rangfolge ist verkehrt herum
    nichtVorne: 'nichtVorne',                 // oben bewegt sich nicht mehr als die Kontrolle
    nichtGesichert: 'nichtGesichert',         // Vorsprung nicht gesichert
    nichtBesserAlsAtr: 'nichtBesserAlsAtr',   // trägt, aber nicht besser als ATR% allein
    traegt: 'traegt',                         // die Rangfolge trägt
}

function urteile(a) {
    if (a.laeufeMitKontrolle < MIN_LAEUFE) return URTEILE.zuWenig
    if (a.rangKorrelation !== null && a.rangKorrelation <= -0.3) return URTEILE.verkehrt
    if (!(a.abstandMedian > 0)) return URTEILE.nichtVorne
    if (!(a.vorzeichenP < 0.05)) return URTEILE.nichtGesichert
    if (a.mehrwertGegenAtr !== null && a.mehrwertGegenAtr <= 0) return URTEILE.nichtBesserAlsAtr
    return URTEILE.traegt
}

/**
 * Hype-Radar: andere Frage, andere Zahlen.
 *
 * Der Hype-Radar verspricht keine Bewegung in Stunden, sondern Substanz über
 * Wochen. Die härteste Messung ist deshalb, ob es das Paar überhaupt noch
 * gibt; danach Rendite und Liquidität. Verglichen werden drei Gruppen:
 *
 *   spitze     die besten bestandenen Funde — worüber der Radar spricht
 *   verworfen  von der Sicherheitsprüfung aussortiert — taugt der Filter?
 *   feld       unter der Hype-Schwelle geblieben — taugt die Note?
 */
export function werteAusHype(zeilen = [], horizont = '') {
    const gruppe = (name) => {
        const g = zeilen.filter((z) => (z.gruppe || 'spitze') === name && z.status === 'gemessen')
        const lebend = g.filter((z) => zahl(z.nochHandelbar) !== null)
        const renditen = g.map((z) => zahl(z.renditePct)).filter((w) => w !== null)
        const liq = g.map((z) => {
            const a = zahl(z.liquiditaetStart)
            const b = zahl(z.liquiditaetEnde)
            return a > 0 && b !== null ? ((b - a) / a) * 100 : null
        })
        const ueberlebtAnteil = anteilVon(lebend, (z) => Number(z.nochHandelbar) === 1)
        const imPlus = anteilVon(renditen, (r) => r > 0)
        return {
            n: g.length,
            ueberlebt: ueberlebtAnteil.wert,
            ueberlebtAnteil,
            medianRendite: median(renditen),
            nRendite: renditen.length,
            imPlusAnteil: imPlus.wert,
            imPlus,
            medianLiquiditaetAenderung: median(liq),
        }
    }
    const spitze = gruppe('spitze')
    const verworfen = gruppe('verworfen')
    const feld = gruppe('feld')
    return {
        horizont,
        anzahl: zeilen.filter((z) => z.status === 'gemessen').length,
        offen: zeilen.filter((z) => z.status === 'offen').length,
        fehlgeschlagen: zeilen.filter((z) => z.status === 'fehlgeschlagen').length,
        spitze, verworfen, feld,
        urteil: urteileHype(spitze, verworfen, feld),
    }
}

/**
 * Urteile als Kürzel (Worte in `hype.guete_*`). Zwei getrennte Aussagen, weil
 * zwei verschiedene Teile des Radars geprüft werden: der Sicherheitsfilter
 * (Spitze gegen Verworfene) und die Hype-Note (Spitze gegen Feld).
 *
 * Bis 10.10.2026 genügte „grösser" — bei zehn Funden je Gruppe hiess
 * 3 von 10 gegen 2 von 10 „Filter wirkt". Jetzt entscheidet der exakte Test
 * nach Fisher; was nicht gesichert ist, heisst so. Die Note wird am Anteil im
 * Plus geprüft (ja/nein je Fund), nicht am Median — für einen Median gibt es
 * bei so kleinen Gruppen keinen ehrlichen Test, der hier passt.
 */
function urteileHype(spitze, verworfen, feld) {
    if (spitze.n < 10) return ['zuWenig']
    const teile = []
    const vergleiche = (a, b, wirkt, wirktNicht, offen) => {
        const p = fisherExakt(a.k, a.n - a.k, b.k, b.n - b.k)
        if (!(p < P_GRENZE)) return offen
        return a.wert > b.wert ? wirkt : wirktNicht
    }
    if (verworfen.n >= 10 && spitze.ueberlebtAnteil.n && verworfen.ueberlebtAnteil.n) {
        teile.push(vergleiche(spitze.ueberlebtAnteil, verworfen.ueberlebtAnteil, 'filterWirkt', 'filterWirktNicht', 'filterNichtGesichert'))
    }
    if (feld.n >= 10 && spitze.imPlus.n && feld.imPlus.n) {
        teile.push(vergleiche(spitze.imPlus, feld.imPlus, 'noteWirkt', 'noteWirktNicht', 'noteNichtGesichert'))
    }
    return teile.length ? teile : ['zuWenigVergleich']
}

/** Regelstand der Frühphasen-Aufträge, die ausgewertet werden (siehe `FRUEH_REGEL` in radar-ergebnisse.js). */
export const FRUEH_REGEL_AUSWERTUNG = 2

/** Unter so vielen vollständigen Paaren je Frage gibt es kein Urteil. */
export const MIN_PAARE = 10

/** Was in der Frühphase als Treffer, Leben und Kurvenabschluss zählt — je Auftrag, oder null. */
const verdoppelt = (z) => (zahl(z.mfePct) === null ? null : zahl(z.mfePct) >= 100)
const lebt = (z) => (zahl(z.nochHandelbar) === null ? null : Number(z.nochHandelbar) === 1)
// Kurvenabschluss heisst nur etwas für einen pump.fun-Token, der beim Start noch auf der Kurve war.
const kurveGeschafft = (z) => (Number(z.pumpFun) === 1 && Number(z.graduiertStart) === 0 && zahl(z.graduiert) !== null
    ? Number(z.graduiert) === 1 : null)

/** Kennzahlen einer Gruppe — jede mit ihrem eigenen Nenner. */
function frueheGruppe(g) {
    const mit = (f) => g.filter((z) => f(z) !== null)
    const renditen = g.map((z) => zahl(z.renditePct)).filter((w) => w !== null)
    return {
        n: g.length,
        lebt: anteilVon(mit(lebt), lebt),
        kurve: anteilVon(mit(kurveGeschafft), kurveGeschafft),
        verdoppelt: anteilVon(mit(verdoppelt), verdoppelt),
        medianRendite: median(renditen),
        nRendite: renditen.length,
        medianMfe: median(g.map((z) => zahl(z.mfePct)).filter((w) => w !== null)),
    }
}

/**
 * Gepaarter Vergleich für eine Ja/Nein-Frage: McNemar, exakt — gezählt werden
 * nur die Paare, in denen genau EINER ja sagt; der Vorzeichentest darüber ist
 * der exakte McNemar-Test.
 */
function paarVergleich(paare, frage) {
    let nurSpitze = 0
    let nurKontrolle = 0
    let gleich = 0
    for (const [s, k] of paare) {
        const a = frage(s)
        const b = frage(k)
        if (a === null || b === null) continue
        if (a && !b) nurSpitze++
        else if (!a && b) nurKontrolle++
        else gleich++
    }
    const n = nurSpitze + nurKontrolle + gleich
    const p = nurSpitze + nurKontrolle ? vorzeichenTest(nurSpitze, nurKontrolle) : null
    let urteil = 'zuWenig'
    if (n >= MIN_PAARE) urteil = p !== null && p < P_GRENZE ? (nurSpitze > nurKontrolle ? 'besser' : 'schlechter') : 'nichtGesichert'
    return { paare: n, nurSpitze, nurKontrolle, gleich, p, urteil }
}

/**
 * Frühphase: Findet die Note unter gleich gut geprüften Token die besseren?
 *
 * Jeder Spitzen-Token (Schwelle überschritten, meldefähig) hat einen Partner
 * aus demselben Durchgang: ebenfalls meldefähig, unter der Note, gleicher
 * Zustand, ähnliches Alter (`waehleFrueh`). Verglichen wird PAARWEISE — Treffer
 * (zwischendurch mindestens verdoppelt), Leben (wird noch gehandelt),
 * Kurvenabschluss (nur wer am Start noch darauf war) — mit dem exakten
 * McNemar-Test. Ein Urteil gibt es erst ab zehn vollständigen Paaren und nur
 * bei p < 0,05; davor heisst es „zu wenig" oder „nicht gesichert".
 *
 * Das Feld (Zufallsauswahl aller neu gesehenen Token) ist die Grundrate, kein
 * Vergleich: Von pump.fun-Starts schafft rund jeder hundertste die Kurve.
 *
 * Aufträge vor dem Regelstand `FRUEH_REGEL_AUSWERTUNG` (ohne `regel`) werden
 * gezählt, aber nicht ausgewertet — ihre Spitze und ihre Kontrolle waren
 * anders bestimmt.
 */
export function werteAusFrueh(zeilen = [], horizont = '') {
    const aktuell = zeilen.filter((z) => Number(z.regel) === FRUEH_REGEL_AUSWERTUNG)
    const gemessenAktuell = aktuell.filter((z) => z.status === 'gemessen')
    const nach = (name) => gemessenAktuell.filter((z) => z.gruppe === name)
    const spitzeZeilen = nach('spitze')
    const kontrolleZeilen = nach('kontrolle')

    // Ein Paar: Spitze mit laufId X, Kontrolle mit laufId −X (gleicher Horizont — der Aufrufer filtert ihn).
    const spitzeNach = new Map(spitzeZeilen.map((z) => [Number(z.laufId), z]))
    const paare = kontrolleZeilen.map((k) => [spitzeNach.get(-Number(k.laufId)), k]).filter(([s]) => s)

    const vergleich = {
        verdoppelt: paarVergleich(paare, verdoppelt),
        lebt: paarVergleich(paare, lebt),
        kurve: paarVergleich(paare, kurveGeschafft),
    }
    return {
        horizont,
        anzahl: gemessenAktuell.length,
        offen: aktuell.filter((z) => z.status === 'offen').length,
        fehlgeschlagen: aktuell.filter((z) => z.status === 'fehlgeschlagen').length,
        altbestand: zeilen.length - aktuell.length,
        paare: paare.length,
        spitze: frueheGruppe(spitzeZeilen),
        kontrolle: frueheGruppe(kontrolleZeilen),
        feld: frueheGruppe(nach('feld')),
        vergleich,
        urteil: urteileFrueh(vergleich),
    }
}

/** Kürzel, Worte in `hypeFrueh.guete_*`. */
function urteileFrueh(v) {
    const teile = []
    const wort = { verdoppelt: 'treffer', lebt: 'lebt', kurve: 'kurve' }
    for (const [frage, ergebnis] of Object.entries(v)) {
        if (ergebnis.urteil === 'zuWenig') continue
        teile.push(`${wort[frage]}_${ergebnis.urteil}`)
    }
    return teile.length ? teile : ['zuWenig']
}

export { median }
