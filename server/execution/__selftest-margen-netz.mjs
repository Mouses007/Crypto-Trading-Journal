/**
 * Selbsttest des Margen-Netzes — ohne Netz, ohne Datenbank.
 *
 *   node server/execution/__selftest-margen-netz.mjs
 *
 * Das Netz ist die einzige Sicherung, die auf Pionex noch greift, wenn der
 * Stop-Waechter nicht laeuft. Es gibt dabei genau einen Fehler, der wirklich
 * teuer ist: eine Liquidation, die VOR dem Stop liegt. Dann wird die Position
 * zwangsgeschlossen, bevor der geplante Ausstieg greift — mit vollem
 * Margenverlust statt 1 R, und in der Statistik sieht es aus wie ein
 * katastrophaler Trade statt wie ein Konfigurationsfehler.
 *
 * Deshalb ist die erste Pruefung hier ein RASTER ueber realistische
 * Stopabstaende und Wartungsmargen, nicht eine Handvoll Einzelfaelle.
 */

import { plantHebel, netzVerlustInR, PUFFER_VORGABE } from './margen-netz.js'
import { liqPreis } from '../../shared/liquidation.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nRaster: die Liquidation liegt NIE vor dem Stop\n')
{
    const abstaende = [0.002, 0.005, 0.01, 0.02, 0.03, 0.05]
    const margen = [0.004, 0.01, 0.02, 0.05]
    let geprueft = 0
    let verletzt = 0
    let schlimmster = ''

    for (const richtung of ['long', 'short']) {
        for (const a of abstaende) {
            for (const m of margen) {
                const entry = 100000
                const stop = richtung === 'long' ? entry * (1 - a) : entry * (1 + a)
                // Deckel absichtlich hoch, damit der volle Modus greifen kann.
                const r = plantHebel({
                    entry, stopLoss: stop, direction: richtung, mmr: m,
                    maxLeverage: 125, netzModus: 'voll',
                })
                if (!(r.hebel > 0)) continue
                geprueft++
                const lp = liqPreis(entry, r.hebel, m, richtung)
                // Long: Liquidation muss UNTER dem Stop liegen, Short darueber.
                const okSeite = richtung === 'long' ? lp < stop : lp > stop
                if (!okSeite) {
                    verletzt++
                    schlimmster = `${richtung} a=${a} m=${m} liq=${lp.toFixed(2)} stop=${stop.toFixed(2)}`
                }
            }
        }
    }
    check(`Raster durchlaufen (${geprueft} Faelle)`, geprueft >= 40, String(geprueft))
    check('keine einzige Liquidation vor dem Stop', verletzt === 0, schlimmster)
}

console.log('\nGegenprobe: greift die Abrundungsregel ueberhaupt?\n')
{
    /*
     * Zwei Verteidigungslinien schuetzen davor, dass die Liquidation vor dem
     * Stop landet: der Puffer (15 % des Stopabstands) und das Abrunden des
     * Hebels. Solange der Puffer steht, faengt er das Aufrunden mit ab — das
     * Raster oben bliebe also auch mit falscher Rundung gruen.
     *
     * Deshalb wird die Rundungsregel hier OHNE Puffer geprueft, also im
     * Grenzfall „Liquidation genau auf dem Stop". Dann und nur dann ist
     * Abrunden die einzige Sicherung, und die Gegenprobe zeigt, dass sie
     * etwas tut. Faende sie nichts, waere die Regel im Modul beliebig.
     */
    let verletzungen = 0
    let geprueft = 0
    for (const a of [0.002, 0.005, 0.01, 0.02, 0.03]) {
        for (const m of [0.004, 0.01, 0.02]) {
            const entry = 100000
            const stop = entry * (1 - a)
            const r = plantHebel({
                entry, stopLoss: stop, direction: 'long', mmr: m,
                maxLeverage: 125, netzModus: 'voll', puffer: 0,
            })
            if (!(r.hebel > 0)) continue
            geprueft++
            // Der ABgerundete Hebel (das Modul) haelt die Liquidation unter dem Stop.
            if (liqPreis(entry, r.hebel, m, 'long') >= stop) {
                throw new Error(`Modul verletzt den Stop bei a=${a} m=${m}`)
            }
            // Der AUFgerundete haette sie darueber geschoben.
            const auf = Math.ceil(r.noetigerHebel)
            if (auf > r.hebel && liqPreis(entry, auf, m, 'long') >= stop) verletzungen++
        }
    }
    check(`ohne Puffer haelt das Modul den Stop in allen ${geprueft} Faellen`, geprueft >= 10, String(geprueft))
    check('ohne Puffer wuerde Aufrunden die Liquidation vor den Stop schieben (Regel ist wirksam)',
        verletzungen > 0, `${verletzungen} von ${geprueft}`)
}

console.log('\nPuffer und Sicherung\n')
{
    const r = plantHebel({
        entry: 100000, stopLoss: 98000, direction: 'long', mmr: 0.004,
        maxLeverage: 125, netzModus: 'voll',
    })
    check('gesichert, wenn der noetige Hebel unter dem Deckel liegt', r.gesichert === true && r.hebel > 0)
    check('Hebel ist ganzzahlig und abgerundet',
        Number.isInteger(r.hebel) && r.hebel <= r.noetigerHebel, `${r.hebel} / ${r.noetigerHebel}`)
    // Puffer 0,15 heisst: Netz greift bei rund 1,15 R, nicht exakt bei 1,0.
    check('Netz greift knapp HINTER dem Stop, nicht darauf',
        r.netzVerlustR > 1 && r.netzVerlustR < 1 + PUFFER_VORGABE + 0.25, String(r.netzVerlustR))
}

console.log('\nBetriebsarten\n')
{
    const basis = { entry: 100000, stopLoss: 98000, direction: 'long', mmr: 0.004 }

    // 2 % Stopabstand verlangt Hebel ~41. Bei Deckel 10 ist das unerreichbar.
    const voll = plantHebel({ ...basis, maxLeverage: 10, netzModus: 'voll' })
    check("'voll' lehnt ab, wenn der Deckel das Netz verhindert",
        voll.hebel === 0 && voll.grund === 'margin_net_unreachable')
    check("'voll' nennt trotzdem den noetigen Hebel", voll.noetigerHebel > 30, String(voll.noetigerHebel))

    const ged = plantHebel({ ...basis, maxLeverage: 10, netzModus: 'gedeckelt' })
    check("'gedeckelt' handelt mit dem Deckel-Hebel", ged.hebel === 10 && ged.grund === 'gedeckelt')
    check("'gedeckelt' meldet sich ehrlich als NICHT gesichert", ged.gesichert === false)
    check("'gedeckelt' sagt, bei wie vielen R das Netz greift",
        ged.netzVerlustR > 4 && ged.netzVerlustR < 6, String(ged.netzVerlustR))

    // Genau dafuer ist netzMaxR da: ein Netz bei 4,8 R ist bei Grenze 3 zu weit.
    const zuWeit = plantHebel({ ...basis, maxLeverage: 10, netzModus: 'gedeckelt', netzMaxR: 3 })
    check('netzMaxR haelt ein zu weites Netz auf',
        zuWeit.hebel === 0 && zuWeit.grund === 'netz_zu_weit')
    const knapp = plantHebel({ ...basis, maxLeverage: 10, netzModus: 'gedeckelt', netzMaxR: 6 })
    check('netzMaxX oberhalb des Werts laesst durch', knapp.hebel === 10)

    const aus = plantHebel({ ...basis, maxLeverage: 10, netzModus: 'aus' })
    check("'aus' handelt, meldet aber gesichert=false", aus.hebel === 10 && aus.gesichert === false)
    check("'aus' nennt den Grund", aus.grund === 'netz_aus')
}

console.log('\nDeckel und Wunschhebel\n')
{
    const basis = { entry: 100000, stopLoss: 98000, direction: 'long', mmr: 0.004, netzModus: 'gedeckelt' }
    check('der KLEINERE der beiden Deckel gewinnt',
        plantHebel({ ...basis, maxLeverage: 20, wunschHebel: 5 }).hebel === 5)
    check('auch andersherum',
        plantHebel({ ...basis, maxLeverage: 5, wunschHebel: 20 }).hebel === 5)
    check('ohne jeden Deckel wird der noetige Hebel gefahren',
        plantHebel({ ...basis, maxLeverage: 0, wunschHebel: 0 }).gesichert === true)
}

console.log('\nUnsinnige Eingaben werden abgewiesen, nicht gerechnet\n')
{
    const basis = { entry: 100000, direction: 'long', mmr: 0.004, maxLeverage: 50 }
    check('Long-Stop UEBER dem Einstieg',
        plantHebel({ ...basis, stopLoss: 102000 }).grund === 'stop_falsche_seite')
    check('Short-Stop UNTER dem Einstieg',
        plantHebel({ ...basis, direction: 'short', stopLoss: 98000 }).grund === 'stop_falsche_seite')
    check('Stop gleich Einstieg', plantHebel({ ...basis, stopLoss: 100000 }).grund === 'bad_levels')
    check('Einstieg 0', plantHebel({ ...basis, entry: 0, stopLoss: 98000 }).grund === 'bad_levels')
    check('unbekannte Richtung',
        plantHebel({ ...basis, direction: 'seitwaerts', stopLoss: 98000 }).grund === 'bad_direction')
    check('kaputte Zahlen ergeben kein NaN',
        plantHebel({ ...basis, entry: 'quatsch', stopLoss: 98000 }).hebel === 0)
}

console.log('\nnetzVerlustInR\n')
{
    // Bei Hebel 10 und mmr 0,4 % liegt die Liquidation rund 9,64 % unter dem
    // Einstieg. Bei 2 % Stopabstand sind das rund 4,8 R.
    const r = netzVerlustInR({ entry: 100000, hebel: 10, mmr: 0.004, direction: 'long', abstand: 2000 })
    check('Hebel 10, Stop 2 % → Netz bei rund 4,8 R', Math.abs(r - 4.82) < 0.05, String(r))
    // Halber Stopabstand, gleicher Hebel → doppelt so viele R.
    const r2 = netzVerlustInR({ entry: 100000, hebel: 10, mmr: 0.004, direction: 'long', abstand: 1000 })
    check('halber Stopabstand verdoppelt die R-Zahl', Math.abs(r2 - 2 * r) < 0.01, `${r} / ${r2}`)
    check('kaputte Eingabe → 0',
        netzVerlustInR({ entry: 0, hebel: 10, mmr: 0.004, direction: 'long', abstand: 1000 }) === 0
        && netzVerlustInR({ entry: 100000, hebel: 10, mmr: 0.004, direction: 'long', abstand: 0 }) === 0)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
