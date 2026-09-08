/**
 * Selbsttest der Spalten-Flags im Heatmap-Ring.
 *
 *   node src/utils/__selftest-heatmap-ring.mjs
 *
 * Hintergrund: `flags[col]` trug lange nur ein Bit („Lücke"), und zwei
 * grundverschiedene Zustände teilten es sich.
 *
 *   – Tab war im Hintergrund: Zeit fehlt, das BUCH ist vollständig.
 *   – Buch gekreuzt oder leer: die Zeit stimmt, die ZELLEN sind alle 0.
 *
 * Das freie Feld rechts der Bookmap zeigt genau eine Spalte, über ein Drittel
 * der Fläche wiederholt. Nimmt es die zweite Sorte, wird das ganze Feld für
 * einen Takt schwarz; verwirft es die erste Sorte, wirft es nach jeder
 * Hintergrundpause ein gültiges Buch weg. Beide Richtungen stehen hier.
 */

import { HeatmapRing, FLAG_LUECKE, FLAG_OHNE_BUCH } from './heatmapRing.js'
import { OrderBook } from '../../shared/orderbook.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Buch mit einer Wand je Seite. */
function buch({ bid = 100, ask = 101, menge = 5 } = {}) {
    const b = new OrderBook()
    b.bids.set(bid, menge)
    b.asks.set(ask, menge)
    return b
}

/** Summe aller Zellen einer Spalte. */
function summe(ring, col) {
    let s = 0
    for (let r = 0; r < ring.rows; r++) s += ring.data[col * ring.rows + r]
    return s
}

console.log('\nSpalten-Flags des Heatmap-Rings\n')

{
    const ring = new HeatmapRing({ cap: 8, rows: 40, bucketSize: 1 })
    const mid = ring.commit(buch(), 1000, false)
    const col = ring.colFromRight(0)
    check('normale Spalte: Mid kommt zurück', mid === 100.5)
    check('normale Spalte: keine Flags', ring.flags[col] === 0)
    check('normale Spalte: hatBuch', ring.hatBuch(col) === true)
    check('normale Spalte: Mengen liegen drin', summe(ring, col) === 10)
}

{
    /*
     * Der wichtigere der beiden Fälle — die Gegenprobe. Eine Hintergrundpause
     * markiert eine Lücke in der ZEIT, das mitgeschriebene Buch ist aber
     * einwandfrei. Wer hier `flags !== 0` prüft, wirft es weg.
     */
    const ring = new HeatmapRing({ cap: 8, rows: 40, bucketSize: 1 })
    ring.commit(buch(), 1000, true)
    const col = ring.colFromRight(0)
    check('Zeitlücke: Bit LUECKE gesetzt', (ring.flags[col] & FLAG_LUECKE) !== 0)
    check('Zeitlücke: Bit OHNE_BUCH NICHT gesetzt', (ring.flags[col] & FLAG_OHNE_BUCH) === 0)
    check('Zeitlücke: hatBuch bleibt wahr', ring.hatBuch(col) === true)
    check('Zeitlücke: Mengen liegen trotzdem drin', summe(ring, col) === 10)
}

{
    const ring = new HeatmapRing({ cap: 8, rows: 40, bucketSize: 1 })
    ring.commit(buch(), 1000, false)
    // Gebot über Brief — kein Marktzustand, sondern auseinandergelaufene Daten
    const gekreuzt = buch({ bid: 102, ask: 101 })
    const mid = ring.commit(gekreuzt, 1500, false)
    const col = ring.colFromRight(0)
    check('gekreuzt: kein Mid', mid === 0)
    check('gekreuzt: Bit OHNE_BUCH gesetzt', (ring.flags[col] & FLAG_OHNE_BUCH) !== 0)
    check('gekreuzt: hatBuch ist falsch', ring.hatBuch(col) === false)
    check('gekreuzt: Spalte ist leer', summe(ring, col) === 0)
    // Die Achse darf NICHT auf 0 springen, sonst kippt das ganze Preisraster
    check('gekreuzt: Achse behält den letzten gültigen Mid', ring.mid[col] === 100.5)
}

{
    /*
     * So sucht das freie Feld rückwärts: Spalten ohne Buch überspringen, bis
     * genug beisammen sind. Hier steht die Suche selbst, damit der Vertrag
     * fest ist, auf den sich der Renderer stützt.
     */
    const ring = new HeatmapRing({ cap: 16, rows: 40, bucketSize: 1 })
    ring.commit(buch({ menge: 5 }), 1000, false)
    ring.commit(buch({ menge: 7 }), 1500, false)
    ring.commit(buch({ bid: 102, ask: 101 }), 2000, false)   // gekreuzt, leer

    const genommen = []
    for (let i = 0; i < ring.count && genommen.length < 2; i++) {
        const col = ring.colFrom(ring.head, i)
        if (ring.hatBuch(col)) genommen.push(summe(ring, col))
    }
    check('Rückwärtssuche überspringt die leere Spalte', genommen.length === 2)
    check('Rückwärtssuche nimmt die jüngsten gültigen, in dieser Reihenfolge',
        genommen[0] === 14 && genommen[1] === 10, JSON.stringify(genommen))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler: ' + fehler.join(', ')); process.exit(1) }
