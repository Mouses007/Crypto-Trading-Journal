/**
 * Selbsttest der Liquidationskarte (Hebelkarte).
 *
 *   node src/utils/__selftest-leverage-map.mjs
 *
 * Der Kopfkommentar von leverageMap.js versprach jahrelang ein Prüfskript,
 * das es nicht gab — nur die reinen Formeln waren über
 * shared/__selftest-liquidation.mjs abgedeckt. Attribution, Sweep-Konvention
 * und die Auswahl-Deutung liefen ungetestet. Der Audit vom 31.08.2026 fand
 * darin die Sweep/decay-Doppelzählung im Kaskadenfall; dieser Test hält den
 * Fix und die übrigen Invarianten fest.
 */

import {
    LEVERAGE_TIERS, parseTierAuswahl, attributeOpenInterest,
    buildLeverageMap, buildLeverageHistory, noetigeSpannePct,
    liqPriceLong, liqPriceShort,
    effektiveStufen, richtungsAnteilLong,
} from './leverageMap.js'

let bestanden = 0
let fehlgeschlagen = 0

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const nahe = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

/** Flache Kerze als Baustein: alles bei einem Preis, Volumen hälftig. */
const kerze = (t, oi, preis, extra = {}) => ({
    t, oi, o: preis, h: preis, l: preis, c: preis, v: 1000, tb: 500, ...extra,
})

console.log('\nHebelkarten-Modell\n')

// ── parseTierAuswahl ─────────────────────────────────────────
{
    check('Hebelwerte werden gelesen und sortiert',
        JSON.stringify(parseTierAuswahl('100,50')) === '[50,100]')
    check('Altbestand: Index 2 heisst 50x',
        JSON.stringify(parseTierAuswahl('2')) === '[50]')
    check('Altbestand: Index 0 (Zahl, nicht Text) heisst 10x',
        JSON.stringify(parseTierAuswahl(0)) === '[10]')
    check('all, leer und null heissen alle',
        parseTierAuswahl('all') === null && parseTierAuswahl('') === null && parseTierAuswahl(null) === null)
    check('Doppelte fallen weg', JSON.stringify(parseTierAuswahl('50,50,100')) === '[50,100]')
    check('Müll ergibt alle statt nichts', parseTierAuswahl('abc') === null)
}

// ── attributeOpenInterest: postScale-Identität ───────────────
{
    // Schrittweises Skalieren von Hand gegen add·postScale — die Behauptung
    // "mathematisch identisch" aus dem Code, hier unabhängig nachgerechnet.
    const ois = [100, 130, 110, 150]
    const punkte = ois.map((oi, i) => kerze(i * 60000, oi, 100))
    const { add, postScale, decay } = attributeOpenInterest(punkte, { seed: true })

    const beitraege = []
    for (let i = 0; i < ois.length; i++) {
        for (let j = 0; j < beitraege.length; j++) beitraege[j] *= decay[i]
        beitraege.push(add[i])
    }
    // decay wirkt in buildLeverageMap VOR der Einzahlung derselben Periode —
    // der eigene Beitrag wird erst ab der Folgeperiode ausgedünnt.
    const okAlle = beitraege.every((b, i) => nahe(b, add[i] * postScale[i], 1e-9))
    check('postScale entspricht dem schrittweisen Ausdünnen', okAlle,
        JSON.stringify(beitraege.map((b, i) => [b, add[i] * postScale[i]])))

    const summe = beitraege.reduce((a, b) => a + b, 0)
    check('Summe der Beiträge teleskopiert auf das End-OI', nahe(summe, 150, 1e-9), String(summe))
}

// ── buildLeverageMap: Massenerhaltung je Stufe ───────────────
{
    const punkte = [
        kerze(0, 1000, 100),
        kerze(60000, 1100, 101, { h: 101.5, l: 100.5 }),
        kerze(120000, 1050, 100, { h: 101, l: 99.5 }),
    ]
    const map = buildLeverageMap(punkte, { mid: 100, bucketSize: 0.1, mmr: 0.004 })
    let ok = true
    const details = []
    for (let k = 0; k < map.tiers.length; k++) {
        const total = map.mass[k] + map.swept[k] + map.outOfRange[k]
        if (!nahe(total, map.attributed, 1e-6)) { ok = false; details.push(`${map.tiers[k]}x: ${total} != ${map.attributed}`) }
    }
    check('gehalten + abgeräumt + ausserhalb = attribuiert, je Stufe', ok, details.join('; '))
    check('alle vier Stufen sind bei 0,4 % Marge haltbar', map.tiers.length === 4)
}

// ── buildLeverageHistory: Kaskadenfall ohne Doppelzählung ────
{
    // OI 100 → 50, alles bei 100 eröffnet, das Tief fegt NUR die 100x-Longs
    // (Liq ≈ 99,4). Der komplette OI-Abbau steckt damit in der gefegten Masse;
    // die überlebenden Shorts müssen bei 50 stehen. Vor dem Fix halbierte das
    // globale decay sie zusätzlich auf 25.
    const punkte = [
        kerze(0, 100, 100),
        kerze(60000, 50, 100, { l: 99.2, h: 100.0 }),
    ]
    const hist = buildLeverageHistory(punkte, {
        mid: 100, bucketSize: 0.05, spanPct: 12, mmr: 0.004,
        tiers: [100], weights: [1], seed: true,
    })
    const off = (hist.cols - 1) * hist.rows
    let longRest = 0, shortRest = 0, abgeraeumt = 0
    for (let r = 0; r < hist.rows; r++) {
        longRest += hist.long[off + r]
        shortRest += hist.short[off + r]
        abgeraeumt += hist.swept[off + r]
    }
    check('gefegte Longs sind vollständig abgeräumt', nahe(longRest, 0, 1e-6), String(longRest))
    check('überlebende Shorts werden nicht doppelt ausgedünnt (50, nicht 25)',
        nahe(shortRest, 50, 1e-6), String(shortRest))
    check('die abgeräumte Masse ist die gefegte (50)', nahe(abgeraeumt, 50, 1e-6), String(abgeraeumt))
}

// ── buildLeverageHistory: freiwilliger Abbau dünnt weiter aus ─
{
    // Gegenprobe: OI fällt OHNE dass ein Level berührt wird — dann ist der
    // Abbau freiwillig und muss proportional auf beide Seiten wirken.
    const punkte = [
        kerze(0, 100, 100),
        kerze(60000, 80, 100),   // flache Kerze, nichts gefegt
    ]
    const hist = buildLeverageHistory(punkte, {
        mid: 100, bucketSize: 0.05, spanPct: 12, mmr: 0.004,
        tiers: [10], weights: [1], seed: true,
    })
    const off = (hist.cols - 1) * hist.rows
    let masse = 0
    for (let r = 0; r < hist.rows; r++) masse += hist.long[off + r] + hist.short[off + r]
    check('ohne Sweep bleibt der proportionale Abbau (100 → 80)', nahe(masse, 80, 1e-6), String(masse))
}

// ── Sweep-Rundung: Zeilenmitte muss wirklich berührt sein ────
{
    // Entry 200, L=2, mmr 0 → Long-Liq exakt 100,0. Das Tief 100,04 erreicht
    // die Zeile 100,0 (Bucket 0,1) NICHT — Math.round fegte sie trotzdem.
    const punkte = [
        kerze(0, 100, 200),
        kerze(60000, 100, 200, { l: 100.04, h: 200 }),
    ]
    const hist = buildLeverageHistory(punkte, {
        mid: 200, bucketSize: 0.1, spanPct: 60, mmr: 0,
        tiers: [2], weights: [1], seed: true,
    })
    const off = (hist.cols - 1) * hist.rows
    const zeile100 = Math.round(100.0 / 0.1) - hist.base
    check('ein Level knapp unter dem Tief überlebt den Sweep',
        zeile100 >= 0 && zeile100 < hist.rows && hist.long[off + zeile100] > 0,
        `Zeile ${zeile100}, Wert ${hist.long[off + zeile100]}`)
}

// ── noetigeSpannePct: Extreme statt Mid ──────────────────────
{
    const usable = LEVERAGE_TIERS.filter(L => L === 10)
    const punkte = [kerze(0, 100, 108, { h: 108, l: 108 }), kerze(60000, 100, 100)]
    const spanne = noetigeSpannePct(punkte, usable, 100, 0.004)
    const shortLiqVomHoch = (liqPriceShort(108, 10, 0.004) / 100 - 1) * 100
    check('die Spanne deckt den Short-Liq des Fensterhochs',
        spanne >= shortLiqVomHoch, `${spanne} < ${shortLiqVomHoch}`)
    const nurMid = (liqPriceShort(100, 10, 0.004) / 100 - 1) * 100
    check('… und liegt über der reinen Mid-Rechnung', spanne > nurMid, `${spanne} <= ${nurMid}`)
    check('Long-Seite symmetrisch abgedeckt',
        noetigeSpannePct([kerze(0, 1, 92, { l: 92 })], usable, 100, 0.004)
        >= (1 - liqPriceLong(92, 10, 0.004) / 100) * 100)
}

// ── effektiveStufen: Max-Hebel klemmt ────────────────────────
{
    const alle = effektiveStufen([10, 25, 50, 100], 0)
    check('ohne Max-Hebel bleibt alles nominal',
        alle.length === 4 && alle.every(s => s.nominal === s.effektiv))

    const bei75 = effektiveStufen([10, 25, 50, 100], 75)
    check('Max-Hebel 75 klemmt nur die 100x-Stufe (auf 75)',
        bei75.length === 4 && bei75[3].nominal === 100 && bei75[3].effektiv === 75
        && bei75[2].effektiv === 50)

    const bei50 = effektiveStufen([10, 25, 50, 100], 50)
    check('Max-Hebel 50: 100x kollabiert auf 50x, die niedrigere Nominale überlebt',
        bei50.length === 3 && bei50.map(s => s.nominal).join(',') === '10,25,50')

    const bei20 = effektiveStufen([10, 25, 50, 100], 20)
    check('Max-Hebel 20: nur 10x und 20x (geklemmte 25x) bleiben',
        bei20.length === 2 && bei20[1].nominal === 25 && bei20[1].effektiv === 20)
}

// ── Klemmen wirkt bis in die Karte ───────────────────────────
{
    const punkte = [kerze(0, 100, 100), kerze(60000, 200, 100)]
    const map = buildLeverageMap(punkte, { mid: 100, bucketSize: 0.05, mmr: 0.004, maxHebel: 75 })
    check('Karte rechnet mit effektiven Stufen, adressiert nominal',
        map.tiers.join(',') === '10,25,50,75' && map.tiersNominal.join(',') === '10,25,50,100')
    // Die 100x-Klasse muss am 75x-Liquidationspreis liegen, nicht am 100x-Preis
    const liq75 = liqPriceLong(100, 75, 0.004)
    const zeile = Math.round(liq75 / 0.05) - map.base
    check('geklemmte Klasse legt ihre Masse an den 75x-Liq-Preis',
        map.long[3][zeile] > 0, `Zeile ${zeile}: ${map.long[3][zeile]}`)
}

// ── richtungsAnteilLong: Taker × Kerzenrichtung ──────────────
{
    const doji = { o: 100, h: 100, l: 100, c: 100, v: 1000, tb: 500 }
    check('Doji mit ausgeglichenem Taker-Volumen bleibt exakt 0,5',
        richtungsAnteilLong(doji) === 0.5)

    const nurTaker = { o: 100, h: 101, l: 99, c: 100, v: 1000, tb: 700 }
    const gruenDazu = { o: 99.2, h: 101, l: 99, c: 100.9, v: 1000, tb: 700 }
    check('grüne Kerze verstärkt den Taker-Buy-Überhang',
        richtungsAnteilLong(gruenDazu) > richtungsAnteilLong(nurTaker),
        `${richtungsAnteilLong(gruenDazu)} <= ${richtungsAnteilLong(nurTaker)}`)

    const rotDagegen = { o: 100.9, h: 101, l: 99, c: 99.2, v: 1000, tb: 700 }
    check('rote Kerze dämpft den Taker-Buy-Überhang',
        richtungsAnteilLong(rotDagegen) < richtungsAnteilLong(nurTaker),
        `${richtungsAnteilLong(rotDagegen)} >= ${richtungsAnteilLong(nurTaker)}`)

    check('ohne Volumen gilt 0,5', richtungsAnteilLong({ o: 1, h: 1, l: 1, c: 1, v: 0, tb: 0 }) === 0.5)

    const extremLong = { o: 99, h: 101, l: 99, c: 101, v: 1000, tb: 1000 }
    const extremShort = { o: 101, h: 101, l: 99, c: 99, v: 1000, tb: 0 }
    check('Klemmen halten bei 0,10 und 0,90',
        richtungsAnteilLong(extremLong) === 0.9 && richtungsAnteilLong(extremShort) === 0.1,
        `${richtungsAnteilLong(extremLong)} / ${richtungsAnteilLong(extremShort)}`)
}

console.log(`\n  ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\n`)
process.exit(fehlgeschlagen ? 1 : 0)
