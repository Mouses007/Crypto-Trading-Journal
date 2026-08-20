/**
 * Regressionstest der Kostenweitergabe an den Fill-Simulator.
 *
 *   node server/__selftest-kostenweitergabe.mjs
 *
 * `fill-simulator.js` schreibt sich ausdrücklich auf die Fahne, dass Backtest
 * und Papierbetrieb DASSELBE rechnen. Genau das war zweimal verletzt:
 *
 *   1. Der Backtest übergab `fundingBpsPer8h`, der Nachlauf offener
 *      Paper-Positionen und der Not-Aus nicht. `fundingFor` sieht dann
 *      `undefined`, `Number(undefined) || 0` ergibt 0 — und jede über einen
 *      Abrechnungstermin gehaltene Position wurde ohne Finanzierungskosten
 *      geschlossen.
 *   2. Beim Umbau auf Maker/Taker (20.08.2026) hätte dasselbe erneut passieren
 *      können: fünf Aufrufer, fünf handgebaute `costs`-Objekte, und jedes neue
 *      Feld muss in alle fünf.
 *
 * Der Fehler ist unsichtbar, weil nichts fehlschlägt: die Zahl ist bloss zu
 * gut. Netto-PnL, Equity, Profit Factor und Erwartungswert erben sie, und auf
 * diesen Grössen beruhen die Optimizer-Vorschläge.
 *
 * Deshalb prüft dieser Test nicht mehr, ob jedes Objekt alle Felder trägt,
 * sondern dass es die Objekte GAR NICHT MEHR GIBT: `costs` kommt ausnahmslos
 * aus `kostenAus()`. Gegenprobe gemacht — ein Literal an einer der Stellen
 * lässt den Test fehlschlagen.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fundingFor, kostenAus } from './fill-simulator.js'

const hier = path.dirname(fileURLToPath(import.meta.url))

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; console.log(`  ✓ ${name}`) }
    else { fehler++; console.log(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

console.log('\nKostenweitergabe an den Fill-Simulator')

// --- 1. Quelltext: kommt jedes costs aus kostenAus()? ---------------------
// `execution/paper.js` steht bewusst mit in der Liste, obwohl es heute nur
// durchreicht: baut dort jemand später eins zusammen, fällt der Test.
const DATEIEN = ['strategy-engine.js', 'strategy-api.js', 'strategy-backtest.js', 'execution/paper.js']
let gebaut = 0
for (const datei of DATEIEN) {
    const quelle = fs.readFileSync(path.join(hier, datei), 'utf8')
    // `const costs = …` und `costs: …` bis zum Zeilenende.
    const treffer = [...quelle.matchAll(/(?:^|[\s,{])costs\s*[:=]\s*([^\n]*)/gm)]
    for (const m of treffer) {
        const wert = m[1].trim()
        const zeile = quelle.slice(0, m.index).split('\n').length
        // Durchreichen (`costs,` / `costs`) ist in Ordnung — nur das
        // Zusammenbauen an Ort und Stelle nicht.
        if (/^costs\b/.test(wert)) continue
        gebaut++
        pruefe(
            `${datei}:${zeile} costs kommt aus kostenAus()`,
            wert.startsWith('kostenAus('),
            `steht dort: ${wert.slice(0, 60)}`,
        )
    }
}
// Gegenprobe zur Gegenprobe: findet die Suche gar nichts mehr, prüft der Test
// nichts und wäre trotzdem grün.
pruefe('es wurden überhaupt costs-Zuweisungen gefunden', gebaut >= 4, `gefunden: ${gebaut}`)

// --- 2. kostenAus trägt jede Kostenart -------------------------------------
const risk = {
    feeMakerBps: 1.4, feeTakerBps: 4.2, slippageBps: 2,
    fundingBpsPer8h: 1, entryOrder: 'limit', breakEvenCoversCosts: true,
    // Fremdfelder haben im Kostenobjekt nichts verloren
    leverage: 3, riskPerTradePct: 1,
}
const k = kostenAus(risk)
for (const feld of ['feeMakerBps', 'feeTakerBps', 'slippageBps', 'fundingBpsPer8h', 'entryOrder', 'breakEvenCoversCosts']) {
    pruefe(`kostenAus trägt ${feld}`, k[feld] === risk[feld], `bekommen: ${k[feld]}`)
}
pruefe('kostenAus schleppt keine Fremdfelder mit', k.leverage === undefined && k.riskPerTradePct === undefined)
pruefe('kostenAus verträgt undefined', typeof kostenAus(undefined) === 'object')

// --- 3. Rechnung: kostet ein gehaltener Termin wirklich etwas? -------------
// 1000 USDT Nominal, 1 bp je 8 h, Haltedauer über genau einen Termin.
const ACHT_H = 8 * 60 * 60 * 1000
const einstieg = ACHT_H * 3 - 60_000          // eine Minute vor einem Termin
const ausstieg = ACHT_H * 3 + 60_000          // eine Minute danach
pruefe(
    'ein überschrittener Termin kostet 0,10 USDT bei 1000 USDT und 1 bp',
    Math.abs(fundingFor(1000, einstieg, ausstieg, 1) - -0.10) < 1e-9,
    `bekommen: ${fundingFor(1000, einstieg, ausstieg, 1)}`,
)
pruefe(
    'ohne überschrittenen Termin kostet nichts',
    fundingFor(1000, einstieg, einstieg + 1000, 1) === 0,
)
pruefe(
    'fehlender Satz ergibt 0 — genau das machte den Fehler unsichtbar',
    fundingFor(1000, einstieg, ausstieg, undefined) === 0,
)

console.log(`\n${fehler === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler === 0 ? 0 : 1)
