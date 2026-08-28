/**
 * Taugt die Rangfolge etwas? — die reine Rechnung.
 *
 * Ohne Netz, ohne Datenbank: Ergebniszeilen hinein, Kennzahlen heraus. Genau
 * deshalb prüfbar, und das ist bei einer Zahl, die über Vertrauen in die ganze
 * Seite entscheidet, nicht verhandelbar.
 *
 * Drei Fragen, in dieser Reihenfolge:
 *
 *   1. Trifft die Spitze? — Precision@10: Anteil der obersten zehn, bei denen
 *      der Coin hinterher überhaupt beweglich war. „Beweglich" statt „im
 *      Plus", denn der Radar sagt ausdrücklich nichts über die Richtung.
 *   2. Ist die Rangfolge besser als Zufall? — Rangkorrelation zwischen dem
 *      vergebenen Rang und dem tatsächlichen Ergebnis.
 *   3. Wie teuer war der Weg dahin? — MAE, also der schlechteste Punkt
 *      zwischendurch. Eine Rendite ohne MAE verschweigt, ob man sie
 *      ausgehalten hätte.
 */

/*
 * Rangkorrelation und Median kommen aus `shared/statistik.js` -- beide
 * Formeln standen im Projekt mehrfach, die Rangkorrelation zweimal ohne
 * Bindungskorrektur (Audit 28.08.2026, FIN-08).
 */
import { spearman, median } from '../shared/statistik.js'

/** Ab welcher Bewegung ein Coin im Nachhinein als „beweglich" gilt. */
export const BEWEGT_PCT = 1.0

const zahl = (w) => (w === null || w === undefined ? null : (Number.isFinite(Number(w)) ? Number(w) : null))

/** Spannweite zwischen bestem und schlechtestem Punkt, in Prozent. */
export function spanne(z) {
    const hoch = zahl(z?.mfePct)
    const tief = zahl(z?.maePct)
    if (hoch === null || tief === null) return null
    return hoch - tief
}

/**
 * Precision@N — wie oft die Spitze der Liste hielt, was sie versprach.
 *
 * Das Versprechen lautet „dieser Coin lässt sich handeln", nicht „er steigt".
 * Gemessen wird deshalb die SPANNE: Wer sich um weniger als ein Prozent bewegt
 * hat, war nicht handelbar, ganz gleich in welche Richtung.
 */
export function precisionAt(zeilen = [], n = 10, schwelle = BEWEGT_PCT) {
    const gemessen = zeilen
        .filter((z) => z.status === 'gemessen' && spanne(z) !== null)
        .sort((a, b) => (a.rang || 9999) - (b.rang || 9999))
        .slice(0, n)
    if (!gemessen.length) return { wert: null, n: 0 }
    const treffer = gemessen.filter((z) => spanne(z) >= schwelle).length
    return { wert: treffer / gemessen.length, n: gemessen.length, treffer }
}

/**
 * Sagt der Rang das Ergebnis voraus? (Spearman)
 *
 * Nahe +1: Wer oben stand, bewegte sich am meisten — die Liste taugt.
 * Nahe 0: Der Rang sagt nichts. Nahe −1 wäre am aufschlussreichsten, denn
 * dann wäre die Rangfolge systematisch verkehrt herum.
 *
 * Unter zehn gemeinsamen Punkten wird nicht gerechnet: Jede Korrelation aus
 * fünf Werten ist Zufall, und eine Zahl mit dem Anschein von Genauigkeit ist
 * schlimmer als keine.
 */
export function rangGegenErgebnis(zeilen = []) {
    const paare = zeilen
        .filter((z) => z.status === 'gemessen' && z.rang > 0 && spanne(z) !== null)
        .map((z) => ({ rang: Number(z.rang), wert: spanne(z) }))
    if (paare.length < 10) return { wert: null, n: paare.length }

    /*
     * Hier stand die Kurzformel `1 - 6*Sd2/(n(n2-1))`. Die gilt nur ohne
     * Bindungen -- und `wert` ist eine gemessene Preisspanne, wo Bindungen
     * realistisch sind: mehrere Coins ohne Bewegung ergeben exakt dieselbe
     * Spanne. Dann hing das Ergebnis davon ab, in welcher Reihenfolge `sort`
     * gleiche Werte zufaellig stehen liess.
     *
     * Gemessen wird Rang gegen NEGATIVE Spanne: Rang 1 soll die groesste
     * Bewegung sein, und ein positives Rho soll "die Liste taugt" heissen.
     */
    const rho = spearman(paare.map((p) => p.rang), paare.map((p) => -p.wert), 10)
    return { wert: rho, n: paare.length }
}

export { median }

/**
 * Die Auswertung eines Horizonts.
 *
 * Zusätzlich die KONTROLLGRUPPE: dieselben Kennzahlen für die untere Hälfte
 * der Liste. Ohne sie ist Precision@10 bedeutungslos — wenn sich an einem
 * wilden Tag ohnehin alles bewegt, sieht auch eine gewürfelte Rangfolge gut
 * aus. Erst der Abstand zwischen oben und unten ist die Aussage.
 */
export function werteAus(zeilen = [], horizont = '') {
    const gemessen = zeilen.filter((z) => z.status === 'gemessen')
    const oben = gemessen.filter((z) => z.rang > 0 && z.rang <= 10)
    const unten = gemessen.filter((z) => z.rang > 10)

    return {
        horizont,
        anzahl: gemessen.length,
        offen: zeilen.filter((z) => z.status === 'offen').length,
        fehlgeschlagen: zeilen.filter((z) => z.status === 'fehlgeschlagen').length,
        precision10: precisionAt(gemessen, 10),
        rangKorrelation: rangGegenErgebnis(gemessen),
        medianSpanneOben: median(oben.map(spanne)),
        medianSpanneUnten: median(unten.map(spanne)),
        medianMaeOben: median(oben.map((z) => zahl(z.maePct))),
        // Das Urteil in Worten — eine Zahl ohne Deutung wird zu gern
        // wohlwollend gelesen.
        urteil: urteile(rangGegenErgebnis(gemessen), median(oben.map(spanne)), median(unten.map(spanne))),
    }
}

function urteile(korrelation, obenMedian, untenMedian) {
    if (korrelation.wert === null) return 'zu wenige Messungen'
    const abstand = obenMedian !== null && untenMedian !== null ? obenMedian - untenMedian : null
    if (korrelation.wert >= 0.3 && abstand > 0) return 'die Rangfolge trägt'
    if (korrelation.wert <= -0.3) return 'die Rangfolge ist verkehrt herum'
    if (abstand !== null && abstand <= 0) return 'oben bewegt sich nicht mehr als unten'
    return 'kein erkennbarer Zusammenhang'
}
