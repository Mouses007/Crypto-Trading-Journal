/**
 * Regressionstest der Kostenweitergabe an den Fill-Simulator.
 *
 *   node server/__selftest-kostenweitergabe.mjs
 *
 * `fill-simulator.js` schreibt sich ausdrücklich auf die Fahne, dass Backtest
 * und Papierbetrieb DASSELBE rechnen. Genau das war verletzt: der Backtest
 * übergab `fundingBpsPer8h`, der Nachlauf offener Paper-Positionen und der
 * Not-Aus nicht. `fundingFor` sieht dann `undefined`, `Number(undefined) || 0`
 * ergibt 0 — und jede über einen Abrechnungstermin gehaltene Paper-Position
 * wurde ohne Finanzierungskosten geschlossen.
 *
 * Der Fehler ist unsichtbar, weil nichts fehlschlägt: die Zahl ist bloss zu
 * gut. Netto-PnL, Equity, Profit Factor und Erwartungswert erben sie, und auf
 * diesen Grössen beruhen die Optimizer-Vorschläge.
 *
 * `fundingFor` selbst ist in `strategies/__selftest-fills.mjs` geprüft — die
 * Mathematik war nie falsch, nur die Verkabelung. Deshalb prüft dieser Test
 * den Quelltext: jedes `costs`-Objekt, das an den Simulator geht, muss alle
 * drei Kostenarten tragen. Gegenprobe gemacht: entfernt man `fundingBpsPer8h`
 * an einer der Stellen, schlägt der Test fehl.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fundingFor } from './fill-simulator.js'

const hier = path.dirname(fileURLToPath(import.meta.url))

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; console.log(`  ✓ ${name}`) }
    else { fehler++; console.log(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

console.log('\nKostenweitergabe an den Fill-Simulator')

// --- 1. Quelltext: trägt jedes costs-Objekt alle drei Kostenarten? ---------
const DATEIEN = ['strategy-engine.js', 'strategy-api.js', 'strategy-backtest.js']
for (const datei of DATEIEN) {
    const quelle = fs.readFileSync(path.join(hier, datei), 'utf8')
    // Erfasst `const costs = { … }` ebenso wie `costs: { … }`.
    const treffer = [...quelle.matchAll(/costs\s*[:=]\s*\{([^}]*)\}/g)]
    pruefe(`${datei}: costs-Objekte gefunden`, treffer.length > 0)
    for (const [i, m] of treffer.entries()) {
        const rumpf = m[1]
        const zeile = quelle.slice(0, m.index).split('\n').length
        for (const feld of ['feeBps', 'slippageBps', 'fundingBpsPer8h']) {
            pruefe(`${datei}:${zeile} costs-Objekt ${i + 1} trägt ${feld}`, rumpf.includes(feld))
        }
    }
}

// --- 2. Rechnung: kostet ein gehaltener Termin wirklich etwas? -------------
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
