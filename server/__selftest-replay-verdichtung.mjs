/**
 * Selbsttest der Wiedergabe-Verdichtung (sliceRange).
 *
 *   node server/__selftest-replay-verdichtung.mjs
 *
 * Die Anzeige kann nur so viele Spalten zeigen, wie sie Pixel hat. Damit ein
 * mehrstündiger Trade trotzdem aufs Bild passt, faltet der Server k
 * Quellspalten zu einer. Zwei Dinge können dabei still schiefgehen und würden
 * im Betrieb nicht auffallen — sie sähen nur „irgendwie anders" aus:
 *
 *  1. Die gespeicherten Bytes sind LOG-quantisiert. Wer sie direkt mittelt,
 *     rechnet Unsinn. Richtig ist dequantisieren → mitteln → requantisieren.
 *  2. Der Preis-Anker `base` wandert von Spalte zu Spalte mit dem Kurs. Wer
 *     stur dieselbe ZEILE mittelt statt denselben PREIS, verschmiert Wände
 *     über das halbe Band.
 *
 * Ausserdem festgenagelt: k = 1 lässt die Daten unangetastet (der Normalfall
 * darf sich durch den Umbau nicht verändert haben).
 */

import zlib from 'zlib'
import { promisify } from 'util'
import { serializeHour, sliceRange } from './live-recorder.js'

const gzip = promisify(zlib.gzip)

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const HOUR_MS = 3600000
const QUANT_SATURATION = 4
const FRAME_MS = 1000
const ROWS = 20

/** Dieselbe Kennlinie wie im Recorder — hier ist sie die Spezifikation. */
function quantisiere(qty, ref = 1) {
    if (qty <= 0) return 0
    const t = Math.log1p(qty / ref) / Math.log1p(QUANT_SATURATION)
    return t >= 1 ? 255 : Math.max(1, (t * 255) | 0)
}

/**
 * Baut eine Stunde. `fuelle(col)` liefert je Spalte `{ mid, base, zellen }`,
 * wobei `zellen` eine Liste `[zeile, menge]` ist. `mid: 0` erzeugt eine Lücke.
 */
async function baueStunde({ hourStart, cols, fuelle, quantRef = 1 }) {
    const data = new Uint8Array(cols * ROWS)
    const base = new Int32Array(cols)
    const mid = new Float64Array(cols)
    for (let c = 0; c < cols; c++) {
        const spalte = fuelle(c)
        mid[c] = spalte.mid
        base[c] = spalte.base
        for (const [zeile, menge] of spalte.zellen || []) {
            data[c * ROWS + zeile] = quantisiere(menge, quantRef)
        }
    }
    const payload = await gzip(serializeHour({
        symbol: 'BTCUSDT', market: 'futures', hourStart, frameMs: FRAME_MS,
        rows: ROWS, cols, bucketSize: 1, quantRef, base, mid, data,
    }))
    return { hourStart, payload, _roh: { data, base, mid, cols } }
}

/** Standardspalte: Kurs steht still, eine Wand auf Zeile 5. */
const stillstand = (menge = 2) => (() => ({ mid: 100.5, base: 100, zellen: [[5, menge]] }))

console.log('\nWiedergabe-Verdichtung — Selbsttest\n')

// ── k = 1: der Normalfall bleibt unberührt ───────────────────────────────
console.log('k = 1 lässt die Daten unangetastet')
{
    const stunde = await baueStunde({
        hourStart: 0, cols: 600,
        fuelle: (c) => ({ mid: 100 + c * 0.01, base: 100, zellen: [[c % ROWS, 1 + (c % 3)]] }),
    })
    const block = await sliceRange([stunde], 0, 600 * FRAME_MS, 1500)

    check('keine Verdichtung angefordert → k = 1', block.verdichtet === 1, `k=${block.verdichtet}`)
    check('frameMs unverändert', block.frameMs === FRAME_MS, String(block.frameMs))
    check('quellFrameMs mitgeliefert', block.quellFrameMs === FRAME_MS, String(block.quellFrameMs))
    check('Spaltenzahl unverändert', block.cols === 600, String(block.cols))

    let gleich = true
    for (let i = 0; i < 600 * ROWS; i++) {
        if (block.data[i] !== stunde._roh.data[i]) { gleich = false; break }
    }
    check('Matrix ist byte-identisch zur Quelle', gleich)
    check('Mid-Kurve unverändert', block.mid[123] === stunde._roh.mid[123],
        `${block.mid[123]} vs ${stunde._roh.mid[123]}`)
}

// ── Mittelwert statt Maximum ─────────────────────────────────────────────
console.log('\nBeständige Wand schlägt kurzes Aufblitzen')
{
    // 60 Spalten: Zeile 5 durchgehend belegt (Wand), Zeile 10 nur in einer
    // einzigen Sekunde (Aufblitzen) — beide mit derselben Menge.
    const stunde = await baueStunde({
        hourStart: 0, cols: 60,
        fuelle: (c) => ({
            mid: 100.5, base: 100,
            zellen: c === 30 ? [[5, 2], [10, 2]] : [[5, 2]],
        }),
    })
    const block = await sliceRange([stunde], 0, 60 * FRAME_MS, 1)

    check('60 Quellspalten → 1 Ausgabespalte', block.cols === 1 && block.verdichtet === 60,
        `cols=${block.cols} k=${block.verdichtet}`)
    check('frameMs skaliert mit k', block.frameMs === 60 * FRAME_MS, String(block.frameMs))

    const wand = block.data[5]
    const blitz = block.data[10]
    check('Wand deutlich heller als Aufblitzen', wand > blitz, `Wand=${wand} Blitz=${blitz}`)
    check('Wand behält ihren Wert (Mittel = Einzelwert)', wand === quantisiere(2),
        `${wand} vs ${quantisiere(2)}`)
    check('Aufblitzen verschwindet nicht ganz', blitz > 0, String(blitz))
    check('Aufblitzen auf 1/60 verdünnt', blitz === quantisiere(2 / 60),
        `${blitz} vs ${quantisiere(2 / 60)}`)

    // Gegenprobe zur Log-Falle: der rohe Byte-Mittelwert wäre ein anderer.
    const byteMittel = Math.round(quantisiere(2) / 60)
    check('nicht der (falsche) Byte-Mittelwert', blitz !== byteMittel,
        `beide ${blitz}`)
}

// ── Lücken dürfen nicht abdunkeln ────────────────────────────────────────
console.log('\nAufzeichnungslücken verdünnen den Mittelwert nicht')
{
    // Eimer 0: 60 echte Spalten. Eimer 1: 30 echte + 30 Lücken (mid = 0).
    const stunde = await baueStunde({
        hourStart: 0, cols: 120,
        fuelle: (c) => (c >= 90
            ? { mid: 0, base: 0, zellen: [] }
            : { mid: 100.5, base: 100, zellen: [[5, 2]] }),
    })
    const block = await sliceRange([stunde], 0, 120 * FRAME_MS, 2)

    check('zwei Eimer à 60 Spalten', block.cols === 2 && block.verdichtet === 60,
        `cols=${block.cols} k=${block.verdichtet}`)
    check('halb leerer Eimer ist genauso hell wie der volle',
        block.data[ROWS + 5] === block.data[5],
        `${block.data[ROWS + 5]} vs ${block.data[5]}`)
}

// ── Zeilenverschiebung: über den Preis mitteln, nicht über die Zeile ─────
console.log('\nVerdichtung mittelt über den Preis, nicht über die Zeile')
{
    // Beide Spalten tragen dieselbe Wand auf Preis-Bucket 105, liegen aber auf
    // unterschiedlichen Basen — in der Matrix also auf verschiedenen Zeilen.
    const stunde = await baueStunde({
        hourStart: 0, cols: 2,
        fuelle: (c) => (c === 0
            ? { mid: 105.5, base: 100, zellen: [[5, 2]] }   // 100 + 5 = 105
            : { mid: 105.5, base: 102, zellen: [[3, 2]] }), // 102 + 3 = 105
    })
    const block = await sliceRange([stunde], 0, 2 * FRAME_MS, 1)

    check('Anker ist die Basis der ersten Spalte', block.base[0] === 100, String(block.base[0]))
    check('beide Beiträge landen auf derselben Preiszeile',
        block.data[5] === quantisiere(2), `Zeile5=${block.data[5]} erwartet ${quantisiere(2)}`)
    check('die unverschobene Zeile bleibt leer', block.data[3] === 0, String(block.data[3]))
    check('Mid gehört zur Ankerspalte', block.mid[0] === 105.5, String(block.mid[0]))
}

// ── Deckel greift über alle Spannen ──────────────────────────────────────
console.log('\nAusgabe bleibt unter der Spaltengrenze')
{
    const stunden = []
    for (let h = 0; h < 24; h++) {
        stunden.push(await baueStunde({
            hourStart: h * HOUR_MS, cols: 3600, fuelle: stillstand(),
        }))
    }
    for (const [name, spanneMs, maxCols] of [
        ['10 min', 10 * 60000, 1390],
        ['2 h', 2 * HOUR_MS, 1390],
        ['6 h', 6 * HOUR_MS, 1390],
        ['24 h', 24 * HOUR_MS, 1390],
        ['24 h auf schmalem Fenster', 24 * HOUR_MS, 400],
    ]) {
        const noetig = Math.ceil(spanneMs / HOUR_MS)
        const block = await sliceRange(stunden.slice(0, noetig), 0, spanneMs, maxCols)
        check(`${name}: ${block.cols} Spalten ≤ ${maxCols} (k = ${block.verdichtet})`,
            block.cols <= maxCols && block.cols > 0)
    }

    // Eine Spanne über 6 h war früher gar nicht abrufbar — jetzt schon, und
    // die Wand muss über die ganze Länge sichtbar bleiben.
    const lang = await sliceRange(stunden, 0, 24 * HOUR_MS, 1390)
    let leereSpalten = 0
    for (let c = 0; c < lang.cols; c++) if (!lang.data[c * ROWS + 5]) leereSpalten++
    check('24-h-Wiedergabe zeigt die Wand lückenlos', leereSpalten === 0,
        `${leereSpalten} leere von ${lang.cols}`)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log('Fehlgeschlagen:')
    for (const f of fehler) console.log(`  - ${f}`)
    process.exit(1)
}
