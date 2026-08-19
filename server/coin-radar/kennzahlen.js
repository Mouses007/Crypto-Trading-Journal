/**
 * Coin-Radar, Kennzahlen: aus Kerzen werden vergleichbare Zahlen.
 *
 * Rein — Kerzen hinein, Zahlen heraus, kein Netz, keine Datenbank. Das ist
 * kein Selbstzweck: Die drei Grössen hier entscheiden die Rangfolge, und eine
 * Rangfolge, die sich nicht mit festen Beispieldaten nachrechnen lässt, ist
 * nicht überprüfbar.
 *
 * Die Auswahl folgt dem, was Trader übereinstimmend prüfen — in der
 * Aktienwelt wie in Krypto:
 *
 *   ATR%   Bewegt sich der Coin überhaupt genug, dass sich ein Einstieg
 *          lohnt? Absolute Werte wären wertlos: zwei Dollar Schwankung sind
 *          bei Bitcoin nichts und bei einem Cent-Coin alles. Deshalb im
 *          Verhältnis zum Preis.
 *   RVOL   Ist gerade etwas los — verglichen mit dem eigenen Normalmass,
 *          nicht mit anderen Coins. Über 2 gilt branchenübergreifend als
 *          „im Spiel".
 *   ADX    Läuft es sauber oder sägt es? Über 25 trendet, unter 20 ist
 *          Seitwärts.
 *
 * Alle drei kommen aus `strategies/indicators.js` — dieselben Funktionen, mit
 * denen auch die Strategien rechnen. Eine zweite Implementierung würde genau
 * dort abweichen, wo es zählt.
 */

import { atr, adx, volumeSma } from '../strategies/indicators.js'

/** Letzter nicht-null-Wert einer Indikatorreihe. */
function letzter(reihe) {
    if (!Array.isArray(reihe)) return null
    for (let i = reihe.length - 1; i >= 0; i--) {
        const w = reihe[i]
        if (Number.isFinite(w)) return w
    }
    return null
}

/**
 * Kennzahlen einer Zeiteinheit.
 *
 * @param {Array<{t,o,h,l,c,v}>} kerzen  geschlossene Kerzen, älteste zuerst
 * @returns {{atrPct:number|null, rvol:number|null, adx:number|null, preis:number|null, kerzen:number}}
 */
export function rechneZeiteinheit(kerzen) {
    const leer = { atrPct: null, rvol: null, adx: null, preis: null, kerzen: 0 }
    if (!Array.isArray(kerzen) || kerzen.length < 30) return { ...leer, kerzen: kerzen?.length || 0 }

    const schluss = Number(kerzen[kerzen.length - 1]?.c)
    if (!Number.isFinite(schluss) || schluss <= 0) return { ...leer, kerzen: kerzen.length }

    const atrWert = letzter(atr(kerzen, 14))
    const adxWert = letzter(adx(kerzen, 14)?.adx)

    /*
     * RVOL gegen den Schnitt der VORIGEN Kerzen, nicht gegen einen Schnitt,
     * der die aktuelle Kerze enthält. Sonst zieht ein Ausreisser seinen
     * eigenen Vergleichswert mit hoch und dämpft sich selbst — bei einem
     * zwanzigfachen Ausbruch wäre das der Unterschied zwischen 20 und 2.
     */
    const volReihe = volumeSma(kerzen.slice(0, -1), 20)
    const schnitt = letzter(volReihe)
    const aktuell = Number(kerzen[kerzen.length - 1]?.v)
    const rvol = Number.isFinite(schnitt) && schnitt > 0 && Number.isFinite(aktuell)
        ? aktuell / schnitt
        : null

    return {
        atrPct: Number.isFinite(atrWert) ? (atrWert / schluss) * 100 : null,
        rvol,
        adx: Number.isFinite(adxWert) ? adxWert : null,
        preis: schluss,
        kerzen: kerzen.length,
    }
}

/**
 * Kennzahlen über mehrere Zeiteinheiten.
 *
 * @param {Object<string, Array>} kerzenJeZeiteinheit  z. B. {'1h': [...], '15m': [...]}
 * @returns {Object<string, object>}
 */
export function rechneAlle(kerzenJeZeiteinheit = {}) {
    const raus = {}
    for (const [ze, kerzen] of Object.entries(kerzenJeZeiteinheit)) {
        raus[ze] = rechneZeiteinheit(kerzen)
    }
    return raus
}

/**
 * Funding als Jahresrate in Prozent.
 *
 * Eine Rate von 0,01 % je acht Stunden klingt nach nichts und ist knapp
 * 11 % im Jahr — das ist der Grund, warum sie hier hochgerechnet wird und
 * nicht als Rohwert stehen bleibt. Wer eine Position über Tage hält, zahlt
 * das, und es gehört neben die Bewegungszahlen.
 *
 * @param {number} ratePct        Rate in Prozent (Binance liefert Dezimalbruch!)
 * @param {number} intervallStunden
 */
export function fundingJahresRate(ratePct, intervallStunden = 8) {
    /*
     * Ausdrücklich auf null/undefined prüfen, BEVOR `Number` daraus eine 0
     * macht. Sonst gilt eine fehlende Rate als „kostenlos" und bekommt in der
     * Bewertung die volle Punktzahl für günstiges Funding — ein Coin ohne
     * Daten stünde damit besser da als einer mit gemessen niedrigen Kosten.
     */
    if (ratePct === null || ratePct === undefined || ratePct === '') return null
    const r = Number(ratePct)
    const h = Number(intervallStunden) || 8
    if (!Number.isFinite(r)) return null
    return r * (24 / h) * 365
}
