/**
 * Coin-Radar, dritte Achse: Hängt der Coin an Bitcoin?
 *
 * Die Frage dahinter ist eine praktische. Wer eine Chartanalyse auf BTC macht
 * und daraus eine Richtung ableitet, will wissen, welche Coins diese These
 * mitmachen — und wie kräftig. Drei Zahlen beantworten das, und sie
 * beantworten es unterschiedlich gut:
 *
 *   KORRELATION  Läuft er überhaupt mit? −1 bis +1, hier in Prozent gezeigt.
 *   BETA         Wie kräftig? Bei +1 % BTC bewegt sich der Coin um β %.
 *   ZERFALL      Gilt das noch? Erste gegen zweite Hälfte des Zeitraums.
 *
 * Gerechnet wird auf 4h-Kerzen über rund einen Monat (200 Kerzen sind 33
 * Tage). Die Zeiteinheit ist bewusst NICHT die des Laufs: der Anwender darf
 * `zeiteinheiten` umstellen, und ein Kopplungsmass, das dabei stillschweigend
 * seinen Zeitraum wechselt, wäre zwischen zwei Läufen nicht vergleichbar.
 *
 * ── Was hier mit Absicht FEHLT ──────────────────────────────────────────
 *
 * Ein Vorlauf-/Nachlaufmass. Die naheliegende Idee — „Coin folgt BTC mit
 * Verzögerung, also nach dem BTC-Signal noch einsteigen" — wurde am 21.08.2026
 * an 18 Coins über 179 Renditepunkte gemessen: bei ALLEN 18 lag die stärkste
 * Kreuzkorrelation bei Verschiebung null. Auf vier Stunden bewegt sich der
 * Markt in derselben Kerze. Die Spalte hätte also immer dieselbe Null gezeigt
 * und dabei so ausgesehen, als sei sie gemessen worden.
 *
 * Ebenso fehlt R². Es ist exakt r² und damit keine zusätzliche Information —
 * als Fliesstext („BTC erklärt 34 % der Bewegung") ist es verständlicher als
 * die blanke Korrelation, als eigene Spalte wäre es eine Wiederholung.
 *
 * NICHTS davon geht in die Note ein. „Bewegt sich viel", „lässt sich günstig
 * handeln" und „hängt an BTC" sind drei Fragen; in eine Zahl gepresst
 * verschwindet genau die Unterscheidung, wegen der man hinsieht.
 */

import { pearson, KORR_MIN_PUNKTE } from '../makro.js'

/** Die Referenz. Perpetual, damit Kerzengitter und Handelszeiten passen. */
export const BTC_REFERENZ = 'BTCUSDT'

/** 200 Kerzen à 4h sind 33 Tage — der Monat, den die Frage meint. */
export const BTC_ZEITEINHEIT = '4h'

/**
 * Ab wann gilt ein Coin als BTC-Mitläufer, ab wann als eigenständig.
 *
 * Zwei Schwellen statt einer, weil das Feld dazwischen der Normalfall ist:
 * gemessen lag der Median bei r = 0,58. Ein einzelner Schnitt bei 0,5 hätte
 * die halbe Liste in „läuft mit" gekippt und die andere in „eigenständig",
 * obwohl beide Gruppen dasselbe tun.
 */
export const KOPPLUNG_FEST = 0.7
export const KOPPLUNG_LOSE = 0.3

/**
 * Ab welchem z der Zerfall gemeldet wird (zweiseitig, 5 %).
 *
 * Eine ROHE Schwelle auf |r1 − r2| wäre hier falsch, und zwar messbar: Bei
 * r = 0,7 ist bereits eine Differenz von 0,19 signifikant, bei r = 0,3 erst
 * eine von 0,29 — die Streuung von r hängt von r selbst ab. Der Fisher-z-Test
 * rechnet das heraus. Gemessen am 21.08.2026: LINK 0,82 → 0,38 ergab z = 4,99
 * (echt), PEPE 0,55 → 0,64 ergab z = 0,92 (Rauschen). Mit einer festen
 * Schwelle von 0,2 wäre PEPE durchgerutscht und hätte gewarnt, wo nichts war.
 */
export const Z_SIGNIFIKANT = 1.96

/**
 * Mindestpunkte je Hälfte für den Zerfallstest.
 *
 * Der Fisher-z-Test teilt durch √(n−3); unter etwa fünfzehn Punkten je Hälfte
 * wird der Nenner so klein, dass jede Schwankung signifikant aussieht.
 */
export const MIN_PUNKTE_HAELFTE = 15

/**
 * Renditen zweier Kerzenreihen über GEMEINSAME Zeitstempel.
 *
 * Erst schneiden, dann Renditen bilden — dieselbe Reihenfolge und derselbe
 * Grund wie in `korrelationAusReihen` (makro.js): Fehlt einem Coin eine Kerze
 * (Wartung, spätes Listing, Lücke im Feed), vergliche man sonst dessen
 * Zweistundensprung mit einem Vierstundensprung von BTC.
 *
 * Über den INDEX zu paaren wäre der bequeme Fehler: Zwei Reihen gleicher Länge
 * sehen ausgerichtet aus, sind es bei einem später gelisteten Coin aber nicht —
 * dann liegt dessen Kerze 40 gegen die von BTC an ganz anderem Datum.
 *
 * @param {Array<{t:number,c:number}>} kerzenA
 * @param {Array<{t:number,c:number}>} kerzenB
 * @returns {{ra: number[], rb: number[]}}
 */
export function paareRenditen(kerzenA, kerzenB) {
    const nachZeit = new Map()
    for (const k of kerzenB || []) {
        const c = Number(k?.c)
        if (Number.isFinite(c) && c > 0) nachZeit.set(Number(k.t), c)
    }

    const gemeinsam = []
    for (const k of kerzenA || []) {
        const c = Number(k?.c)
        const b = nachZeit.get(Number(k?.t))
        if (Number.isFinite(c) && c > 0 && Number.isFinite(b) && b > 0) {
            gemeinsam.push({ t: Number(k.t), a: c, b })
        }
    }
    gemeinsam.sort((x, y) => x.t - y.t)

    const ra = []
    const rb = []
    for (let i = 1; i < gemeinsam.length; i++) {
        const va = gemeinsam[i - 1].a
        const vb = gemeinsam[i - 1].b
        if (!(va > 0) || !(vb > 0)) continue
        ra.push((gemeinsam[i].a - va) / va)
        rb.push((gemeinsam[i].b - vb) / vb)
    }
    return { ra, rb }
}

/**
 * Beta: die Wucht, nicht die Richtung.
 *
 * β = Kovarianz(Coin, BTC) / Varianz(BTC). Die Korrelation sagt, OB er
 * mitläuft; β sagt, wie weit. Gemessen reicht die Spanne von 0,16 (TRX — die
 * BTC-These dort mitzuhandeln lohnt nicht) bis 1,53 (ENA — anderthalbfacher
 * Ausschlag, entsprechend kleinere Position).
 *
 * Ohne Streuung in BTC ist β nicht definiert; dann `null` statt einer Null,
 * die wie ein gemessener Stillstand aussähe.
 */
export function beta(rendCoin, rendBtc) {
    const n = Math.min(rendCoin?.length || 0, rendBtc?.length || 0)
    if (n < 2) return null
    let mc = 0
    let mb = 0
    for (let i = 0; i < n; i++) { mc += rendCoin[i]; mb += rendBtc[i] }
    mc /= n
    mb /= n
    let kov = 0
    let varB = 0
    for (let i = 0; i < n; i++) {
        const dc = rendCoin[i] - mc
        const db = rendBtc[i] - mb
        kov += dc * db
        varB += db * db
    }
    if (!(varB > 0)) return null
    return kov / varB
}

/**
 * Fisher-Transformation. Macht aus r eine Grösse mit stabiler Streuung,
 * sodass zwei Korrelationen überhaupt vergleichbar werden.
 *
 * Bei |r| = 1 divergiert sie — dann `null`, nicht Infinity: ein Unendlich
 * würde jeden nachfolgenden Vergleich stumm auf `false` setzen.
 */
export function fisherZ(r) {
    if (!Number.isFinite(r) || Math.abs(r) >= 1) return null
    return 0.5 * Math.log((1 + r) / (1 - r))
}

/**
 * Hält der Gleichlauf über den Zeitraum, oder ist er gerade zerbrochen?
 *
 * Der Monat wird halbiert und beide Hälften einzeln korreliert. Der Fall, um
 * den es geht, ist LINK am 21.08.2026: über den ganzen Monat r = 0,53 — eine
 * unauffällige Zahl. In der ersten Hälfte war es 0,82, in der zweiten 0,38.
 * Wer auf die 0,53 hin handelt, handelt auf einen Zusammenhang, den es seit
 * zwei Wochen nicht mehr gibt.
 *
 * @returns {{r1: number|null, r2: number|null, z: number|null, zerfallen: boolean}}
 */
export function zerfallstest(rendCoin, rendBtc) {
    const leer = { r1: null, r2: null, z: null, zerfallen: false }
    const n = Math.min(rendCoin?.length || 0, rendBtc?.length || 0)
    const haelfte = Math.floor(n / 2)
    if (haelfte < MIN_PUNKTE_HAELFTE) return leer

    const r1 = pearson(rendCoin.slice(0, haelfte), rendBtc.slice(0, haelfte))
    const r2 = pearson(rendCoin.slice(haelfte, n), rendBtc.slice(haelfte, n))
    const z1 = fisherZ(r1)
    const z2 = fisherZ(r2)
    if (z1 === null || z2 === null) return { ...leer, r1, r2 }

    // Standardfehler der Differenz zweier unabhängiger Fisher-z.
    const se = Math.sqrt(1 / (haelfte - 3) + 1 / (n - haelfte - 3))
    if (!(se > 0) || !Number.isFinite(se)) return { ...leer, r1, r2 }

    const z = Math.abs(z1 - z2) / se
    return { r1, r2, z, zerfallen: z > Z_SIGNIFIKANT }
}

/**
 * Der ganze Vergleich für einen Coin.
 *
 * Reicht die Stichprobe nicht, kommt `null` zurück — NICHT ein Objekt voller
 * Nullen. Der Unterschied ist der zwischen „bewegt sich unabhängig von BTC"
 * und „wir wissen es nicht", und genau er entscheidet, ob ein Coin im Filter
 * „eigenständig" auftauchen darf.
 *
 * @param {Array<{t:number,c:number}>} kerzenCoin
 * @param {Array<{t:number,c:number}>} kerzenBtc
 * @returns {null|{korrelation:number, beta:number|null, punkte:number,
 *                 korrelationH1:number|null, korrelationH2:number|null,
 *                 zerfallZ:number|null, zerfallen:boolean}}
 */
export function vergleicheMitBtc(kerzenCoin, kerzenBtc) {
    const { ra, rb } = paareRenditen(kerzenCoin, kerzenBtc)
    if (ra.length < KORR_MIN_PUNKTE) return null

    const korrelation = pearson(ra, rb)
    if (korrelation === null) return null

    const zerfall = zerfallstest(ra, rb)
    return {
        korrelation,
        beta: beta(ra, rb),
        punkte: ra.length,
        korrelationH1: zerfall.r1,
        korrelationH2: zerfall.r2,
        zerfallZ: zerfall.z,
        zerfallen: zerfall.zerfallen,
    }
}

/**
 * Einordnung als Schlüssel, nicht als Text — übersetzt wird in der Oberfläche.
 *
 * `unbekannt` ist ein eigener Zustand und nicht etwa „entkoppelt": Ein Coin
 * ohne Messung darf nicht als eigenständig durchgehen.
 */
export function deuteKopplung(r) {
    if (r === null || r === undefined || !Number.isFinite(r)) return 'unbekannt'
    if (r >= KOPPLUNG_FEST) return 'laeuftMit'
    if (r <= -KOPPLUNG_FEST) return 'laeuftGegen'
    if (Math.abs(r) <= KOPPLUNG_LOSE) return 'eigenstaendig'
    return 'teilweise'
}
