/**
 * Selbsttest der Liquidations-Cluster (`server/hebelzonen.js`).
 *
 *   node server/__selftest-hebelzonen.mjs
 *
 * Geprüft wird `verdichteHebelkarte` — der reine Teil. `holeHebelzonen` holt
 * Punkte und Margin-Werte aus dem Netz und ist hier bewusst aussen vor.
 *
 * Drei Dinge müssen stimmen, weil sie im Betrieb still danebengehen und die
 * fertige Zeile trotzdem vernünftig klingt:
 *
 *   1. Die SEITEN-SEMANTIK. Unterhalb des Kurses liegen Long-Liquidationen
 *      (erzwungene Verkäufe), oberhalb Short-Liquidationen (Käufe).
 *      Vertauscht dreht sich die halbe Einordnung um — und niemand sieht es
 *      der Zeile an. Das ist der teuerste denkbare Fehler in dieser Datei.
 *   2. Die EINHEITEN. `map.long[k][r]` ist eine COIN-Menge. Ohne
 *      Multiplikation mit dem Zeilenpreis stünde bei BTC „84 USD" statt „84
 *      Mio USD" in der Grundlage, und das Modell schlösse daraus, es sei
 *      nichts los.
 *   3. ENTARTUNGEN ERGEBEN `null`, NICHT NULL. Eine Zone „0 Mio USD" liest
 *      sich als „kein Widerstand" — die schlechteste mögliche Ausgabe.
 */

import { buildLeverageMap, LEVERAGE_TIERS } from '../shared/leverageMap.js'
import { verdichteHebelkarte } from './hebelzonen.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const MMR = 0.004

/**
 * Punktreihe bauen.
 *
 * `takerAnteil` steuert `richtungsAnteilLong`: 0,9 heisst „Käufer waren
 * aggressiv", also überwiegend LONG eröffnet — deren Liquidationslevel liegen
 * UNTER dem Einstieg.
 */
function reihe({ n = 120, preis = 100, oiStart = 1000, oiWachstum = 10, takerAnteil = 0.5, spanne = 0.2 } = {}) {
    const punkte = []
    for (let i = 0; i < n; i++) {
        const o = preis
        const c = preis
        punkte.push({
            t: i * 300000,
            oi: oiStart + i * oiWachstum,
            o, c,
            h: preis + spanne / 2,
            l: preis - spanne / 2,
            v: 100,
            tb: 100 * takerAnteil,
        })
    }
    return punkte
}

const karte = (punkte, opt = {}) => buildLeverageMap(punkte, {
    mid: punkte[punkte.length - 1].c,
    bucketSize: 0.01,
    spanPct: 3,
    mmr: MMR,
    tiers: LEVERAGE_TIERS,
    seed: false,
    ...opt,
})

console.log('\nSeiten-Semantik — der teuerste denkbare Fehler')
{
    // Käufer aggressiv → überwiegend Longs → Liquidationslevel UNTERHALB
    const longLastig = karte(reihe({ takerAnteil: 0.9 }))
    const b = verdichteHebelkarte(longLastig, { mid: 100 })
    check('Long-Übergewicht legt die Masse nach unten',
        b && b.masseUnten > b.masseOben, `unten ${b?.masseUnten?.toFixed(0)} vs oben ${b?.masseOben?.toFixed(0)}`)
    check('die untere Zone erzwingt VERKÄUFE',
        b?.unten?.[0]?.wirkung === 'verkaeufe', b?.unten?.[0]?.wirkung)
    check('untere Zonen haben negativen Abstand',
        b?.unten?.every(z => z.abstandPct < 0) === true)

    // Spiegelbild: Verkäufer aggressiv → Shorts → Level OBERHALB
    const shortLastig = karte(reihe({ takerAnteil: 0.1 }))
    const s = verdichteHebelkarte(shortLastig, { mid: 100 })
    check('Short-Übergewicht legt die Masse nach oben',
        s && s.masseOben > s.masseUnten, `oben ${s?.masseOben?.toFixed(0)} vs unten ${s?.masseUnten?.toFixed(0)}`)
    check('die obere Zone erzwingt KÄUFE',
        s?.oben?.[0]?.wirkung === 'kaeufe', s?.oben?.[0]?.wirkung)
    check('obere Zonen haben positiven Abstand',
        s?.oben?.every(z => z.abstandPct > 0) === true)

    check('die beiden Fälle sind wirklich spiegelbildlich',
        b.masseUnten > b.masseOben && s.masseOben > s.masseUnten)
}

console.log('\nZonen liegen am Liquidationspreis, nicht am Einstieg')
{
    /*
     * Alle Eröffnungen bei 100. Die Zonen dürfen NICHT bei 100 liegen, sondern
     * beim Liquidationspreis der jeweiligen Stufe. Bei 100x und mmr 0,004
     * sind das rund −0,6 %; bei 10x rund −9,6 % und damit ausserhalb der
     * Suchspanne von 3 %.
     *
     * Fiele jemand versehentlich auf `buildEntryMap` zurück, läge alles bei
     * 100 — dieser Test fängt das.
     */
    const b = verdichteHebelkarte(karte(reihe({ takerAnteil: 0.9 })), { mid: 100 })
    const naechste = b.unten[0]
    check('Zone liegt unter dem Einstieg', naechste.preis < 99.9, String(naechste.preis))
    check('Zone liegt nicht weiter als die Suchspanne', naechste.preis > 97, String(naechste.preis))
    check('Abstand entspricht grob einer hohen Hebelstufe',
        naechste.abstandPct < -0.2 && naechste.abstandPct > -3, naechste.abstandPct.toFixed(2))
}

console.log('\nEinheiten: USD über den Zeilenpreis')
{
    /*
     * Zwei Karten mit identischer Coin-Masse, aber verschiedenem Preisniveau.
     * Wird mit dem Zeilenpreis multipliziert, trägt die teurere proportional
     * mehr USD. Würde jemand die Coin-Menge ungerechnet durchreichen, wären
     * beide gleich.
     */
    const billig = verdichteHebelkarte(
        karte(reihe({ preis: 100, takerAnteil: 0.9 })), { mid: 100 })
    const teuer = verdichteHebelkarte(
        karte(reihe({ preis: 1000, spanne: 2, takerAnteil: 0.9 }), { bucketSize: 0.1 }), { mid: 1000 })
    const faktor = teuer.masseUnten / billig.masseUnten
    check('zehnfacher Preis ergibt rund zehnfache USD-Masse',
        faktor > 8 && faktor < 12, `Faktor ${faktor.toFixed(2)}`)
    check('die Coin-Masse selbst ist in beiden gleich geblieben',
        Math.abs(billig.masseUnten * 10 - teuer.masseUnten) / teuer.masseUnten < 0.25)
}

console.log('\nBeträge mitteln über die Stufen, nicht summieren')
{
    /*
     * Die Lücke, durch die der Fehler bis zum 05.09.2026 kam: ALLE Massefälle
     * hier nutzten genau EINE Stufe (`tiers: [100]`), und bei einer Stufe sind
     * Summe und Mittelwert dasselbe. Erst mit mehreren Stufen trennt sich das.
     *
     * Die Stufen sind einander ausschliessende Was-wäre-wenn-Rechnungen für
     * DIESELBE Position. Summiert man sie, zählt man sie viermal.
     */
    const vierStufen = {
        rows: 5, tiers: [10, 25, 50, 100], mass: [10, 10, 10, 10], swept: [0, 0, 0, 0],
        oi: 100, mmr: MMR,
        long: [1, 2, 3, 4].map(() => Float64Array.from([0, 10, 0, 0, 0])),
        short: [1, 2, 3, 4].map(() => Float64Array.from([0, 0, 0, 0, 0])),
        priceAt: (r) => 100 + (r - 2) * 0.5,
        spanMs: 3600000, periods: 12,
    }
    const v = verdichteHebelkarte(vierStufen, { mid: 100 })
    // Zeile 1 -> Preis 99,50; 10 Coins (nicht 40) x 99,50 = 995
    check('vier Stufen mit derselben Position ergeben EINE Menge, nicht vier',
        Math.abs(v.masseUnten - 995) < 1, `${v.masseUnten?.toFixed(1)} statt 995`)
    check('die Zone selbst traegt denselben Betrag',
        Math.abs(v.unten[0].usd - 995) < 1, v.unten[0]?.usd?.toFixed(1))

    // Gegenprobe: eine Stufe mit derselben Coin-Menge ergibt dasselbe
    const eineStufe = {
        ...vierStufen, tiers: [100], mass: [10], swept: [0],
        long: [Float64Array.from([0, 10, 0, 0, 0])],
        short: [Float64Array.from([0, 0, 0, 0, 0])],
    }
    const e = verdichteHebelkarte(eineStufe, { mid: 100 })
    check('eine Stufe ergibt denselben Betrag wie vier gleiche',
        Math.abs(e.masseUnten - v.masseUnten) < 0.01,
        `${e.masseUnten?.toFixed(1)} vs ${v.masseUnten?.toFixed(1)}`)

    /*
     * Der eigentliche Punkt: Beträge und Abdeckung müssen DIESELBE Rechnung
     * benutzen. Standen sie auseinander, widersprach die Grundlage der KI dem
     * Tooltip der Kachel — und niemand konnte sagen, welche der beiden Zahlen
     * stimmt.
     */
    check('Abdeckung rechnet wie die Betraege (Mittel, nicht Summe)',
        Math.abs(v.abdeckung - 0.10) < 0.001, String(v.abdeckung))

    // Ungleiche Stufen: der Mittelwert zaehlt, nicht die groesste
    const ungleich = {
        ...vierStufen,
        long: [Float64Array.from([0, 4, 0, 0, 0]), Float64Array.from([0, 8, 0, 0, 0]),
               Float64Array.from([0, 12, 0, 0, 0]), Float64Array.from([0, 16, 0, 0, 0])],
    }
    const u = verdichteHebelkarte(ungleich, { mid: 100 })
    // (4+8+12+16)/4 = 10 Coins x 99,50
    check('ungleiche Stufen ergeben ihren Mittelwert',
        Math.abs(u.masseUnten - 995) < 1, u.masseUnten?.toFixed(1))
}

console.log('\nVerhältnis und schwerere Seite')
{
    // Karte von Hand: oben exakt doppelte Masse
    const map = {
        rows: 5, tiers: [100], mass: [100], swept: [0], oi: 100, mmr: MMR,
        long: [Float64Array.from([0, 1, 0, 0, 0])],
        short: [Float64Array.from([0, 0, 0, 2, 0])],
        priceAt: (r) => 100 + (r - 2) * 0.5,   // Zeile 2 = 100
        spanMs: 3600000, periods: 12,
    }
    const b = verdichteHebelkarte(map, { mid: 100 })
    // unten: Zeile 1 → Preis 99,5 → 1 × 99,5 = 99,5
    // oben:  Zeile 3 → Preis 100,5 → 2 × 100,5 = 201
    check('Verhältnis rund 2 zu 1', Math.abs(b.verhaeltnis - 2) < 0.05, b.verhaeltnis?.toFixed(3))
    check('die schwerere Seite ist oben', b.schwerer === 'oben')
    check('Anteil je Seite ist auf die Seite bezogen',
        Math.abs(b.oben[0].anteil - 1) < 0.001 && Math.abs(b.unten[0].anteil - 1) < 0.001)

    // Gleichstand ergibt keine schwerere Seite — nicht willkürlich eine
    const gleich = { ...map, short: [Float64Array.from([0, 0, 0, 0, 0])], long: [Float64Array.from([0, 0, 0, 0, 0])] }
    check('leere Karte ergibt null statt eines Nullbefunds',
        verdichteHebelkarte(gleich, { mid: 100 }) === null)
}

console.log('\nEntartungen ergeben null, nicht Null')
{
    const leer = { rows: 0, tiers: [], mass: [], swept: [], oi: 0, long: [], short: [], priceAt: () => 0 }
    check('keine Zeilen → null', verdichteHebelkarte(leer, { mid: 100 }) === null)
    check('kein mid → null', verdichteHebelkarte(karte(reihe()), {}) === null)
    check('mid 0 → null', verdichteHebelkarte(karte(reihe()), { mid: 0 }) === null)
    check('negatives mid → null', verdichteHebelkarte(karte(reihe()), { mid: -5 }) === null)
    check('keine Karte → null', verdichteHebelkarte(null, { mid: 100 }) === null)

    // Abdeckung unter 2 %: die Beträge sind bedeutungslos
    const duenn = {
        rows: 3, tiers: [100], mass: [1], swept: [0], oi: 1000, mmr: MMR,
        long: [Float64Array.from([0, 5, 0])], short: [Float64Array.from([0, 0, 0])],
        priceAt: (r) => 100 + (r - 1) * 0.5, spanMs: 3600000, periods: 12,
    }
    check('Abdeckung unter 2 % → null', verdichteHebelkarte(duenn, { mid: 100 }) === null)
}

console.log('\nAbdeckung und Warnschwelle')
{
    // mass 15 von oi 100, eine Stufe → 15 % → duenn, aber noch verwertbar
    const map = {
        rows: 3, tiers: [100], mass: [4], swept: [5], oi: 100, mmr: MMR,
        long: [Float64Array.from([0, 3, 0])], short: [Float64Array.from([0, 0, 1])],
        priceAt: (r) => 100 + (r - 1) * 0.5, spanMs: 7200000, periods: 24,
    }
    const b = verdichteHebelkarte(map, { mid: 100 })
    check('Abdeckung ist der Mittelwert der Stufen durch das OI',
        Math.abs(b.abdeckung - 0.04) < 0.001, String(b.abdeckung))
    check('unter 5 % wird als dünn markiert', b.duenn === true)
    check('bereits durchlaufene Masse wird ausgewiesen',
        Math.abs(b.gefegtAnteil - 0.05) < 0.001, String(b.gefegtAnteil))

    // Zwei Stufen: der MITTELWERT zählt, nicht die Summe — sonst stünde die
    // Abdeckung systematisch zu hoch und die Warnung griffe nie.
    const zwei = { ...map, tiers: [50, 100], mass: [4, 16], swept: [0, 0], long: [map.long[0], map.long[0]], short: [map.short[0], map.short[0]] }
    const b2 = verdichteHebelkarte(zwei, { mid: 100 })
    check('bei zwei Stufen zählt der Mittelwert, nicht die Summe',
        Math.abs(b2.abdeckung - 0.10) < 0.001, String(b2.abdeckung))
    check('10 % gilt nicht mehr als dünn', b2.duenn === false)
}

console.log('\nEine Seite ohne Cluster')
{
    const nurOben = {
        rows: 3, tiers: [100], mass: [50], swept: [0], oi: 100, mmr: MMR,
        long: [Float64Array.from([0, 0, 0])], short: [Float64Array.from([0, 0, 4])],
        priceAt: (r) => 100 + (r - 1) * 0.5, spanMs: 3600000, periods: 12,
    }
    const b = verdichteHebelkarte(nurOben, { mid: 100 })
    check('eine Seite ohne Masse liefert eine leere Liste, nicht null',
        b !== null && b.unten.length === 0 && b.oben.length === 1)
    check('ohne zweite Seite gibt es kein Verhältnis', b.verhaeltnis === null)
    check('die schwerere Seite ist trotzdem benannt', b.schwerer === 'oben')
    check('die leere Seite hat Masse 0 (die Zeile muss das aussprechen)', b.masseUnten === 0)
}

console.log('\nZweite, nähere Zone')
{
    // Stärkstes Band weit weg, ein kleineres näher dran, das die 5 % hält
    const map = {
        rows: 7, tiers: [100], mass: [100], swept: [0], oi: 100, mmr: MMR,
        long: [Float64Array.from([10, 0, 0, 2, 0, 0, 0])],
        short: [Float64Array.from([0, 0, 0, 0, 0, 0, 0])],
        // Zeile 4 = mid; Zeile 3 nah darunter, Zeile 0 weit darunter
        priceAt: (r) => 100 + (r - 4) * 0.2,
        spanMs: 3600000, periods: 12,
    }
    const b = verdichteHebelkarte(map, { mid: 100, bandPct: 0.05 })
    check('beide Zonen kommen mit', b.unten.length === 2, String(b.unten.length))
    check('die nähere steht zuerst',
        Math.abs(b.unten[0].abstandPct) < Math.abs(b.unten[1].abstandPct))
    check('die stärkere trägt den grösseren Anteil',
        b.unten[1].anteil > b.unten[0].anteil)

    /*
     * Das NACHBARBAND des stärksten ist keine zweite Zone. Gemessen am
     * 05.09.2026 kamen sonst „78427 (−1,60 %)" und „78350 (−1,70 %)" heraus —
     * 77 USD auseinander, dieselbe Zone zweimal. Das täuscht Information vor.
     */
    const dicht = {
        rows: 7, tiers: [100], mass: [100], swept: [0], oi: 100, mmr: MMR,
        long: [Float64Array.from([0, 0, 10, 8, 0, 0, 0])],
        short: [Float64Array.from([0, 0, 0, 0, 0, 0, 0])],
        priceAt: (r) => 100 + (r - 4) * 0.05,   // 5 Cent Abstand = 0,05 %
        spanMs: 3600000, periods: 12,
    }
    const d = verdichteHebelkarte(dicht, { mid: 100, bandPct: 0.04 })
    check('direkt benachbarte Bänder ergeben nur EINE Zone',
        d.unten.length === 1, `${d.unten.length} Zonen: ${d.unten.map(z => z.preis.toFixed(2)).join(', ')}`)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log('Fehlgeschlagen:')
    for (const f of fehler) console.log(`  - ${f}`)
    process.exit(1)
}
