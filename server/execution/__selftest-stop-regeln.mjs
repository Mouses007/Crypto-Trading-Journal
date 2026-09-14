/**
 * Selbsttest der Live-Stop-Regeln — ohne Netz, ohne Datenbank.
 *
 *   node server/execution/__selftest-stop-regeln.mjs
 *
 * Auf Pionex gibt es keine Stop-Order an der Boerse. Was dieses Modul
 * entscheidet, IST der Stop. Ein Fehler hier ist kein falscher Messwert,
 * sondern eine Position, die nicht geschlossen wird.
 *
 * Zwei Dinge stehen deshalb im Mittelpunkt: die REIHENFOLGE (sie muss der von
 * `stepCandle` entsprechen, sonst rechnet Live guenstiger als der Backtest, auf
 * dem die Freigabe beruht) und die WIEDERVERWENDUNG des Break-Even-Aufschlags
 * (zwei Kostenannahmen laufen frueher oder spaeter auseinander).
 */

import { bewerteLiveSchutz, breakEvenStop, istVeraltet } from './stop-regeln.js'
import { breakEvenAufschlag } from '../fill-simulator.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

// Einstieg 100, Stop 98 (= 1 R sind 2), Ziel 106 (= 3 R)
const long = () => ({
    direction: 'long', entryPrice: 100, initialStopLoss: 98, stopLoss: 98,
    takeProfit: 106, qty: 1, initialQty: 1, feeOpen: 0.06, entryTime: 1000,
    breakEvenDone: false, partialDone: false,
})
const short = () => ({
    direction: 'short', entryPrice: 100, initialStopLoss: 102, stopLoss: 102,
    takeProfit: 94, qty: 1, initialQty: 1, feeOpen: 0.06, entryTime: 1000,
    breakEvenDone: false, partialDone: false,
})

console.log('\nStop\n')
{
    check('Long: Preis unter dem Stop loest aus',
        bewerteLiveSchutz(long(), 97.5, {}).aktion === 'stop')
    check('Short: Preis ueber dem Stop loest aus',
        bewerteLiveSchutz(short(), 102.5, {}).aktion === 'stop')
    check('Long haelt oberhalb des Stops',
        bewerteLiveSchutz(long(), 98.01, {}).aktion === 'halten')

    /*
     * Der Tick EXAKT auf dem Stop. Mit `<` statt `<=` liefe die Position
     * weiter, obwohl der Kurs die Marke erreicht hat — und runde Marken werden
     * haeufig exakt gehandelt, nicht durchschritten.
     */
    check('Long: Tick EXAKT auf dem Stop loest aus',
        bewerteLiveSchutz(long(), 98, {}).aktion === 'stop')
    check('Short: Tick EXAKT auf dem Stop loest aus',
        bewerteLiveSchutz(short(), 102, {}).aktion === 'stop')

    check('unangetasteter Stop meldet sich als sl',
        bewerteLiveSchutz(long(), 98, {}).grund === 'sl')
    const nachgezogen = { ...long(), breakEvenDone: true, stopLoss: 100.1 }
    check('nachgezogener Stop meldet sich als be, nicht als sl',
        bewerteLiveSchutz(nachgezogen, 100, {}).grund === 'be')
}

console.log('\nZiel und Zeitausstieg\n')
{
    check('Long: Preis am Ziel schliesst', bewerteLiveSchutz(long(), 106, {}).aktion === 'ziel')
    check('Short: Preis am Ziel schliesst', bewerteLiveSchutz(short(), 94, {}).aktion === 'ziel')
    check('ohne Ziel passiert nichts',
        bewerteLiveSchutz({ ...long(), takeProfit: 0 }, 200, {}).aktion === 'halten')

    check('Zeitausstieg nach Ablauf',
        bewerteLiveSchutz(long(), 101, { maxHoldMs: 5000, jetzt: 6000 }).aktion === 'timeout')
    check('Zeitausstieg vorher nicht',
        bewerteLiveSchutz(long(), 101, { maxHoldMs: 5000, jetzt: 5999 }).aktion === 'halten')
    check('ohne maxHoldMs laeuft die Position weiter',
        bewerteLiveSchutz(long(), 101, { jetzt: 9e12 }).aktion === 'halten')
}

console.log('\nTeilausstieg\n')
{
    const opts = { partialTpR: 2, partialTpPct: 20 }
    // 2 R sind hier 104.
    const r = bewerteLiveSchutz(long(), 104, opts)
    check('Teilausstieg bei 2 R', r.aktion === 'teilausstieg', JSON.stringify(r))
    check('Menge ist der eingestellte Anteil', r.menge === 0.2, String(r.menge))
    check('davor passiert nichts', bewerteLiveSchutz(long(), 103.9, opts).aktion === 'halten')

    /*
     * Genau einmal. `partialDone` ist der einzige Schutz — ohne ihn nimmt
     * jeder 3-Sekunden-Takt einen weiteren Anteil, und die Position waere nach
     * einer Minute aufgeloest.
     */
    check('nur einmal: partialDone sperrt',
        bewerteLiveSchutz({ ...long(), partialDone: true }, 104, opts).aktion !== 'teilausstieg')

    check('Short: Teilausstieg bei 96',
        bewerteLiveSchutz(short(), 96, opts).aktion === 'teilausstieg')
}

console.log('\nReihenfolge — dieselbe wie in stepCandle\n')
{
    /*
     * Wird eine Marke gleichzeitig mit einer spaeteren erreicht, gewinnt immer
     * die frueher gepruefte. Genau so rechnet der Simulator, und nur deshalb
     * ist Live mit dem Backtest vergleichbar.
     */
    const opts = { partialTpR: 2, partialTpPct: 20, breakEvenAtR: 1, maxHoldMs: 1, jetzt: 9e12 }

    // Stop schlaegt alles — auch einen faelligen Zeitausstieg.
    check('Stop vor Zeitausstieg', bewerteLiveSchutz(long(), 97, opts).aktion === 'stop')
    // Teilausstieg vor Ziel: er liegt naeher am Einstieg.
    check('Teilausstieg vor Ziel', bewerteLiveSchutz(long(), 106, opts).aktion === 'teilausstieg')
    // Ist der Teil schon raus, greift das Ziel.
    check('danach greift das Ziel',
        bewerteLiveSchutz({ ...long(), partialDone: true }, 106, opts).aktion === 'ziel')
    // Ziel vor Zeitausstieg.
    check('Ziel vor Zeitausstieg',
        bewerteLiveSchutz({ ...long(), partialDone: true }, 106, opts).aktion === 'ziel')
    // Break-Even ist KEIN Ausstieg und darf einen faelligen Ausstieg nicht verdraengen.
    check('Zeitausstieg schlaegt Break-Even-Nachzug',
        bewerteLiveSchutz({ ...long(), partialDone: true, takeProfit: 0 }, 103, opts).aktion === 'timeout')
}

console.log('\nLiquidationsnaehe\n')
{
    /*
     * Hier wird NICHT geschlossen — die Boerse tut das selbst, zu ihrem Preis.
     * Gemeldet werden muss es trotzdem: es heisst, dass der Stop versagt hat
     * und gleich das Margen-Netz greift.
     */
    const r = bewerteLiveSchutz({ ...long(), stopLoss: 0 }, 90, { liqPreis: 91 })
    check('Liquidationsnaehe wird gemeldet', r.aktion === 'liquidation')
    check('darueber nicht', bewerteLiveSchutz({ ...long(), stopLoss: 0 }, 92, { liqPreis: 91 }).aktion === 'halten')
    check('Short: Liquidation oberhalb',
        bewerteLiveSchutz({ ...short(), stopLoss: 0 }, 110, { liqPreis: 109 }).aktion === 'liquidation')
}

console.log('\nBreak-Even-Nachzug\n')
{
    const costs = { breakEvenCoversCosts: true, feeMakerBps: 2, feeTakerBps: 6, slippageBps: 2 }
    const opts = { breakEvenAtR: 1, costs }

    const r = bewerteLiveSchutz(long(), 102, opts)
    check('bei 1 R wird nachgezogen, ohne zu schliessen',
        r.aktion === 'halten' && r.grund === 'break_even' && r.neuerStop > 0, JSON.stringify(r))
    check('davor nicht', bewerteLiveSchutz(long(), 101.9, opts).grund !== 'break_even')

    /*
     * DIE Pruefung auf Wiederverwendung: der neue Stop muss exakt
     * `entryPrice + breakEvenAufschlag(pos, costs)` sein. Waere der Aufschlag
     * hier nachgebaut, stuende eine zweite Kostenannahme im Projekt — und die
     * driftet, sobald jemand die Gebuehrenlogik anfasst.
     */
    const pos = long()
    const erwartet = pos.entryPrice + breakEvenAufschlag(pos, costs)
    check('neuer Stop == entryPrice + breakEvenAufschlag (dieselbe Funktion)',
        Math.abs(bewerteLiveSchutz(pos, 102, opts).neuerStop - erwartet) < 1e-12,
        `${bewerteLiveSchutz(pos, 102, opts).neuerStop} vs ${erwartet}`)

    check('ohne breakEvenCoversCosts liegt der Stop auf dem Einstieg',
        bewerteLiveSchutz(long(), 102, { breakEvenAtR: 1, costs: {} }).neuerStop === 100)

    check('nach breakEvenDone wird nicht nochmal gezogen',
        bewerteLiveSchutz({ ...long(), breakEvenDone: true }, 105, opts).grund !== 'break_even')

    /*
     * Ein bereits besser stehender Stop darf NICHT auf den Einstieg
     * zurueckgesetzt werden — das waere eine Verschlechterung, und zwar eine,
     * die der Waechter bei jedem Takt aufs Neue vornaehme.
     */
    check('ein besserer Stop wird nicht verschlechtert',
        bewerteLiveSchutz({ ...long(), stopLoss: 103 }, 104, opts).grund !== 'break_even')

    check('Short zieht nach unten',
        bewerteLiveSchutz(short(), 98, opts).neuerStop < 100)
}

console.log('\nbreakEvenStop einzeln\n')
{
    const costs = { breakEvenCoversCosts: true, feeMakerBps: 2, feeTakerBps: 6, slippageBps: 2 }
    // Sicherung: der neue Stop darf nicht schon jenseits des aktuellen Kurses
    // liegen — sonst loest er in dem Moment aus, in dem er gesetzt wird.
    check('Stop jenseits des Kurses faellt auf den Einstieg zurueck',
        breakEvenStop(long(), 100.001, costs) === 100)
    check('Short ebenso', breakEvenStop(short(), 99.999, costs) === 100)
}

console.log('\nVeraltete Sichtung (istVeraltet)\n')
{
    check('frisch gesehen ist nicht veraltet', istVeraltet(10000, 10000 + 5000) === false)
    check('ueber der Grenze ist veraltet', istVeraltet(10000, 10000 + 31000) === true)
    /*
     * NIE gesehen ist der schlimmere Fall, nicht der harmlose: so sieht eine
     * Position aus, an die der Waechter seit dem Start nicht herangekommen ist.
     */
    check('nie gesehen gilt als veraltet', istVeraltet(0, 10000) === true)
    check('eigene Grenze wird beachtet', istVeraltet(10000, 15000, 3000) === true)
}

console.log('\nKaputte Eingaben\n')
{
    check('ohne Preis: halten', bewerteLiveSchutz(long(), 0, {}).aktion === 'halten')
    check('ohne Position: halten', bewerteLiveSchutz(null, 100, {}).aktion === 'halten')
    check('ohne Einstiegspreis: halten',
        bewerteLiveSchutz({ ...long(), entryPrice: 0 }, 100, {}).aktion === 'halten')
    check('Position ohne Stop und ohne Ziel laeuft weiter',
        bewerteLiveSchutz({ ...long(), stopLoss: 0, takeProfit: 0 }, 100, {}).aktion === 'halten')
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
