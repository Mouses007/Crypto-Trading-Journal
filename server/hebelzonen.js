/**
 * Liquidations-Cluster für die Handelslage — wo liegt der Treibstoff.
 *
 * Die Hebelkarte (`shared/leverageMap.js`) modelliert aus der
 * Open-Interest-Historie, bei welchen Preisen gehebelte Positionen
 * zwangsliquidiert würden. Dichte Zonen sind Orte, an denen eine kleine
 * Bewegung eine Kettenreaktion auslöst: Ein Ausbruch auf ein dichtes Band
 * nährt sich selbst, einer ins Leere versandet.
 *
 * Diese Datei macht aus dem Raster zwei, drei Sätze, die eine KI lesen kann.
 * Die Karte selbst hat zwölftausend Zeilen mal vier Stufen — das ist ein Bild,
 * kein Befund.
 *
 * ── Zwei Funktionen, nach Reinheit getrennt ───────────────────────────────
 *
 *   `verdichteHebelkarte` — rein: Karte rein, flaches Objekt raus. Der Teil,
 *      den der Selbsttest anfassen kann.
 *   `holeHebelzonen` — unrein: beschafft Punkte und Margin-Werte, baut die
 *      Karte, gibt das Verdichtete zurück.
 *
 * ── Die Falle, um die es hier geht ────────────────────────────────────────
 *
 * Die SEITEN-SEMANTIK. Unterhalb des Kurses liegen Long-Liquidationen, ihr
 * Auslösen erzeugt erzwungene VERKÄUFE; oberhalb liegen Short-Liquidationen,
 * also KÄUFE. Vertauscht liest sich die fertige Zeile vollkommen plausibel und
 * dreht die halbe Einordnung um — dagegen hilft nur der Selbsttest, nicht die
 * Sorgfalt beim Lesen.
 *
 * Die zweite Falle sind die EINHEITEN: `map.long[k][r]` ist eine COIN-Menge.
 * Ohne Multiplikation mit dem Zeilenpreis stünde bei BTC „84 USD" statt „84
 * Mio USD" in der Grundlage, und das Modell zöge daraus wörtlich den Schluss,
 * es sei nichts los.
 *
 * ── Was hier bewusst NICHT passiert ───────────────────────────────────────
 *
 *  • Keine Gewichtung der Stufen. Die kalibrierten `levMapWeights` sind eine
 *    Einstellung des Nutzers im Frontend; in einer Servergrundlage, die eine
 *    KI liest, hätte eine unsichtbare Gewichtung nichts verloren.
 *  • Kein `seed: true`. Das schöbe rund 90 % der Masse an einen erfundenen
 *    Preis und liesse die Abdeckung gut aussehen. Die Versuchung, für
 *    hübschere Zahlen umzuschalten, ist der eigentliche Fehler.
 *  • Keine Richtungsaussage. Ein Cluster sagt, was passiert, WENN der Kurs
 *    dort ankommt — nicht, dass er hingeht.
 *
 * Bekannte Schwäche, geerbt: `buildLeverageMap` zählt im Kaskadenfall den
 * Abbau doppelt (siehe Punkt 6 im Kopf von `shared/leverageMap.js`),
 * konservativ in Richtung zu wenig gehaltener Masse — also genau dann aktiv,
 * wenn die Zeile am interessantesten wäre.
 */

import { buildLeverageMap, LEVERAGE_TIERS } from '../shared/leverageMap.js'
import { pickBucketSize, grobeTickgroesse } from '../shared/priceBins.js'
import { holeLeverageMapPunkte } from './binance-api.js'
import { holeMarginRate } from './margin-rates.js'
import { logWarn } from './logger.js'

/**
 * Preisband um den Kurs, in dem eine Zone noch zählt.
 *
 * Drei Prozent, nicht die zwei der Kachel: Die sind eine ANZEIGEspanne (was
 * aufs Bild passt). Hier geht es darum, was ein Intraday-Ausbruch noch
 * erreicht, und das ist etwas weiter.
 */
const SPANNE_PCT = 3

/** Zielzahl Rasterzeilen. Der Renderer nimmt 1200 — der braucht Pixel, wir Sätze. */
const ZIELZEILEN = 400

/** Breite eines Bandes, zu dem Zeilen zusammengefasst werden (Anteil des Mid). */
const BAND_PCT = 0.1

/** Ab diesem Anteil an der Seitenmasse wird eine zweite, nähere Zone genannt. */
const ZWEITE_ZONE_MIN = 0.05

/**
 * Mindestabstand der zweiten Zone vom stärksten Band, in Prozent des Mid.
 *
 * Ohne ihn nennt die Zeile das direkte Nachbarband: gemessen am 05.09.2026
 * kamen „78427 USD (−1,60 %)" und „78350 USD (−1,70 %)" heraus — 77 USD
 * auseinander, also dieselbe Zone zweimal. Das täuscht Information vor, wo
 * keine ist. Ein halbes Prozent ist die Grössenordnung, ab der zwei Bänder
 * für einen Intraday-Händler getrennte Ereignisse sind.
 */
const ZWEITE_ZONE_ABSTAND_PCT = 0.5

/**
 * Fenster: die volle Tiefe, die der Endpunkt liefert (500 × 5 min ≈ 41,6 h).
 *
 * Geplant waren 24 h wie `DAYTRADING_STUNDEN` in der Kachel. Gemessen am
 * 05.09.2026 an BTCUSDT trägt das nicht — die Abdeckung hängt fast linear am
 * Fenster, weil das Modell nur den ZUWACHS des offenen Interesses sieht:
 *
 *     11,9 h →  1,2 %      33,3 h →  7,5 %
 *     23,9 h →  4,5 %      41,6 h → 11,0 %
 *
 * Bei 24 h wären rund fünf Prozent des offenen Interesses erfasst, und die
 * Zeile hätte sich selbst als unbrauchbar abgewiesen. Die volle Tiefe liegt
 * ausserdem näher an der Kachel-Vorgabe (48 h) als die 24 aus dem Entwurf.
 */
const FENSTER_PUNKTE = 500

/** Unter so vielen Punkten (5 h) ist die Abdeckung ein Rundungsartefakt. */
const MIN_PUNKTE = 60

/**
 * Schwellen der Abdeckung — gegen die Messung gesetzt, nicht geschätzt.
 *
 * Bei voller Tiefe erreichen die grossen Märkte 7–16 % (BTC 11,0, ETH 7,3,
 * SOL 8,2, 1000PEPE 15,5). Die 20 % des Renderers als Warnschwelle zu
 * übernehmen hiesse, dass „zu dünn" IMMER dabeisteht — und eine Warnung, die
 * immer leuchtet, liest niemand mehr. Deshalb markiert `duenn` erst unter
 * 5 %, und unter 2 % entfällt die Zeile ganz.
 *
 * Der Wert selbst steht so oder so in der Zeile: Nicht die Warnung ist die
 * Aussage, sondern die Zahl.
 */
const ABDECKUNG_DUENN = 0.05
const ABDECKUNG_MIN = 0.02

const nz = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Karte zu einem flachen Befund verdichten.
 *
 * @param {object} map     Ergebnis von `buildLeverageMap`
 * @param {object} opt
 * @param {number} opt.mid           Bezugskurs
 * @param {number} [opt.bandPct]     Bandbreite in Prozent des Mid
 * @param {number} [opt.spannePct]   Suchband um den Kurs
 * @returns {object|null} `null`, wenn die Karte nichts hergibt — nie ein
 *   Nullbefund. „0 Mio USD" liest sich als „kein Widerstand" und wäre die
 *   schlechteste mögliche Ausgabe.
 */
export function verdichteHebelkarte(map, { mid, bandPct = BAND_PCT, spannePct = SPANNE_PCT } = {}) {
    if (!map || !nz(mid) || mid <= 0) return null
    if (!map.tiers?.length || !map.rows) return null

    /*
     * Abdeckung exakt wie der Renderer (`leverageMapRenderer.js`): gewichteter
     * MITTELWERT der Stufen-Szenarien, nicht ihre Summe — sonst zählte
     * dieselbe Position bis zu viermal. Bei Gleichgewichtung ist das der
     * einfache Mittelwert.
     *
     * Die Formel muss dieselbe bleiben: Wenn die Kachel „14 %" zeigt und die
     * KI-Grundlage „41 %", ist das ein Vertrauensschaden, den niemand mehr
     * repariert.
     */
    const stufen = map.mass.length || 1
    const gehalten = map.mass.reduce((a, m) => a + m / stufen, 0)
    const abdeckung = map.oi > 0 ? gehalten / map.oi : 0
    if (!(abdeckung >= ABDECKUNG_MIN)) return null

    // Bereits durchlaufene Masse — die Zonen sind weg und stehen nicht mehr
    // in den Zahlen unten. Ohne diese Angabe wirkt eine leergefegte Seite wie
    // eine, auf der nie etwas lag.
    const gefegt = map.swept.reduce((a, m) => a + m / stufen, 0)
    const gefegtAnteil = map.oi > 0 ? gefegt / map.oi : 0

    const bandBreite = mid * (bandPct / 100)
    const grenzeOben = mid * (1 + spannePct / 100)
    const grenzeUnten = mid * (1 - spannePct / 100)

    /*
     * Zeilen zu Bändern verdichten, getrennt nach Seite.
     *
     * SEITEN-SEMANTIK — die Stelle, an der ein Vorzeichenfehler die halbe
     * Einordnung dreht: `map.long` sind Long-Liquidationen. Sie liegen UNTER
     * dem Einstieg, ihr Auslösen ist ein erzwungener VERKAUF. `map.short`
     * liegt oben und erzwingt KÄUFE. Zeilen auf der falschen Seite des Kurses
     * sind nach dem Sweep praktisch leer und werden übersprungen.
     */
    const baender = { oben: new Map(), unten: new Map() }
    let masseOben = 0
    let masseUnten = 0

    for (let r = 0; r < map.rows; r++) {
        const preis = map.priceAt(r)
        if (!nz(preis) || preis <= 0) continue
        if (preis > grenzeOben || preis < grenzeUnten) continue

        const seite = preis >= mid ? 'oben' : 'unten'
        // Oben zählen Short-Level, unten Long-Level — die jeweils andere
        // Kombination ist bereits durchlaufen und wäre Doppelzählung.
        const arrays = seite === 'oben' ? map.short : map.long

        let menge = 0
        for (let k = 0; k < arrays.length; k++) menge += arrays[k][r]
        if (!(menge > 0)) continue

        // COINS × ZEILENPREIS. Nicht mit dem Mid rechnen: eine Zeile drei
        // Prozent entfernt ist drei Prozent mehr wert, und bei einem Coin
        // unter einem Cent macht der Unterschied die Zahl.
        const usd = menge * preis
        if (seite === 'oben') masseOben += usd; else masseUnten += usd

        const schluessel = Math.round((preis - mid) / bandBreite)
        const topf = baender[seite]
        const vorhanden = topf.get(schluessel)
        if (vorhanden) {
            vorhanden.usd += usd
            vorhanden.gewicht += usd * preis
        } else {
            topf.set(schluessel, { usd, gewicht: usd * preis })
        }
    }

    /** Stärkstes Band einer Seite, plus ein näheres, falls es genug hält. */
    const zonenAus = (topf, gesamt, seite) => {
        if (!topf.size || !(gesamt > 0)) return []
        const liste = [...topf.values()]
            .map(b => ({
                preis: b.gewicht / b.usd,          // usd-gewichteter Bandpreis
                usd: b.usd,
                anteil: b.usd / gesamt,
            }))
            .filter(z => nz(z.preis) && z.usd > 0)
        if (!liste.length) return []

        const staerkstes = liste.reduce((a, b) => (b.usd > a.usd ? b : a))
        const mindestAbstand = mid * (ZWEITE_ZONE_ABSTAND_PCT / 100)
        const naeher = liste
            .filter(z => z !== staerkstes
                && z.anteil >= ZWEITE_ZONE_MIN
                && Math.abs(z.preis - mid) < Math.abs(staerkstes.preis - mid)
                // Nicht das Nachbarband des stärksten — das wäre dieselbe Zone
                && Math.abs(z.preis - staerkstes.preis) >= mindestAbstand)
            .reduce((a, b) => (!a || b.usd > a.usd ? b : a), null)

        return [staerkstes, naeher].filter(Boolean).map(z => ({
            preis: z.preis,
            usd: z.usd,
            anteil: z.anteil,
            abstandPct: ((z.preis - mid) / mid) * 100,
            seite,
            // Was das Auslösen erzwingt — die Aussage, um die es geht
            wirkung: seite === 'oben' ? 'kaeufe' : 'verkaeufe',
        })).sort((a, b) => Math.abs(a.abstandPct) - Math.abs(b.abstandPct))
    }

    const oben = zonenAus(baender.oben, masseOben, 'oben')
    const unten = zonenAus(baender.unten, masseUnten, 'unten')
    if (!oben.length && !unten.length) return null

    // Verhältnis nur, wenn beide Seiten etwas tragen. Eine Division durch die
    // leere Seite ergäbe Unendlich, und „unendlich mal mehr oben" ist keine
    // Aussage, sondern eine fehlende.
    const verhaeltnis = masseOben > 0 && masseUnten > 0
        ? Math.max(masseOben, masseUnten) / Math.min(masseOben, masseUnten)
        : null
    const schwerer = masseOben === masseUnten ? null : (masseOben > masseUnten ? 'oben' : 'unten')

    return {
        mid,
        spannePct,
        oben,
        unten,
        masseOben,
        masseUnten,
        verhaeltnis,
        schwerer,
        abdeckung,
        gefegtAnteil,
        duenn: abdeckung < ABDECKUNG_DUENN,
        stufen: map.tiers,
        mmr: map.mmr,
        spanneStunden: map.spanMs ? map.spanMs / 3600000 : null,
        punkte: map.periods || null,
    }
}

/**
 * Zonen für ein Symbol beschaffen und verdichten.
 *
 * Beide Fremdabrufe parallel: Die Frist des Aufrufers liegt bei zwölf
 * Sekunden, und nacheinander wären es zwei volle Rundläufe.
 *
 * @returns {Promise<object|null>} `null` bei jeder Unsicherheit
 */
export async function holeHebelzonen(symbol) {
    const sym = String(symbol || '').toUpperCase()
    if (!sym) return null

    const [punkteAntwort, rate] = await Promise.all([
        holeLeverageMapPunkte(sym, '5m').catch((e) => {
            logWarn('hebelzonen', `Punkte für ${sym}: ${e.message}`)
            return null
        }),
        holeMarginRate(sym).catch((e) => {
            logWarn('hebelzonen', `Margin-Rate für ${sym}: ${e.message}`)
            return null
        }),
    ])

    const alle = punkteAntwort?.payload?.points
    if (!Array.isArray(alle) || !alle.length) return null

    /*
     * MMR fehlt → keine Zeile. Ausdrücklich NICHT auf `MMR_VORGABE` (0,004)
     * ausweichen: Das ist BTC-Stufe 1; bei einem Altcoin mit ein bis fünf
     * Prozent lägen alle Zonen um den Faktor zwei bis zehn zu nah am Kurs.
     * Falsch, und dabei vollkommen plausibel aussehend.
     */
    if (!rate || !nz(rate.mmr) || rate.mmr <= 0) {
        logWarn('hebelzonen', `${sym}: keine Wartungsmarge — Zonen entfallen`)
        return null
    }

    const punkte = alle.slice(-FENSTER_PUNKTE)
    if (punkte.length < MIN_PUNKTE) return null

    const letzte = punkte[punkte.length - 1]
    const mid = Number(letzte?.c)
    if (!nz(mid) || mid <= 0) return null

    const bucketSize = pickBucketSize(grobeTickgroesse(mid), mid, SPANNE_PCT, ZIELZEILEN)
    const map = buildLeverageMap(punkte, {
        mid,
        bucketSize,
        spanPct: SPANNE_PCT,
        mmr: rate.mmr,
        maxHebel: Number(rate.maxHebel) || 0,
        tiers: LEVERAGE_TIERS,
        seed: false,
    })

    const befund = verdichteHebelkarte(map, { mid })
    if (!befund) return null

    return {
        ...befund,
        symbol: sym,
        // Woher die Wartungsmarge kam. Bybit statt Binance ist ein anderer
        // Wert (BTC 0,5 % gegen 0,4 %), und das verschiebt jede Zone.
        mmrQuelle: rate.quelle || null,
        mmrErsatz: rate.ersatz === true,
        mmrVeraltet: rate.veraltet === true,
        maxHebel: Number(rate.maxHebel) || null,
    }
}
