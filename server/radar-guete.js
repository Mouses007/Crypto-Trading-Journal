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
        return {
            n: g.length,
            ueberlebt: lebend.length ? lebend.filter((z) => Number(z.nochHandelbar) === 1).length / lebend.length : null,
            medianRendite: median(renditen),
            imPlusAnteil: renditen.length ? renditen.filter((r) => r > 0).length / renditen.length : null,
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
 */
function urteileHype(spitze, verworfen, feld) {
    if (spitze.n < 10) return ['zuWenig']
    const teile = []
    if (verworfen.n >= 10 && spitze.ueberlebt !== null && verworfen.ueberlebt !== null) {
        teile.push(spitze.ueberlebt > verworfen.ueberlebt ? 'filterWirkt' : 'filterWirktNicht')
    }
    if (feld.n >= 10 && spitze.medianRendite !== null && feld.medianRendite !== null) {
        teile.push(spitze.medianRendite > feld.medianRendite ? 'noteWirkt' : 'noteWirktNicht')
    }
    return teile.length ? teile : ['zuWenigVergleich']
}

export { median }
