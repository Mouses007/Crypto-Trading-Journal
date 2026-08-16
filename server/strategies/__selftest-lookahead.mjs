/**
 * Selbsttest gegen den Blick in die Zukunft.
 *
 *   node server/strategies/__selftest-lookahead.mjs
 *
 * Ein Pivot ist kein Ereignis, das man in dem Moment sieht, in dem es
 * geschieht. `pivotHighs(candles, left, right)` gibt den INDEX der Hochkerze
 * zurück, aber diese Kerze ist erst dann als Pivot erkennbar, wenn `right`
 * weitere Kerzen geschlossen haben und keine davon höher lief. Wer auf der
 * Hochkerze oder auf den Bestätigungskerzen einsteigt, handelt auf Wissen, das
 * es zu diesem Zeitpunkt nicht gab — der Backtest sieht dann besser aus, als
 * die Strategie ist.
 *
 * Auffallen kann das nur in einem KERZE-FÜR-KERZE-Durchlauf: ruft man detect()
 * einmal auf der ganzen Serie auf, legt Phase A nur Setups an und Phase B sieht
 * sie im selben Aufruf gar nicht. Deshalb bildet `replay()` hier nach, was der
 * Backtest tut — wachsendes Fenster, offene Setups weiterreichen, Ereignisse
 * anwenden.
 *
 * Geprüft wird für JEDEN ausgelösten Trade: der Einstieg liegt nach der
 * Bestätigung des Signals. Für LSOB gilt das seit jeher (`earliestSweep`),
 * Regel-Interpreter und EMA Touch mussten dafür nachgezogen werden.
 */

import { detectMitRegeln } from './rule-engine.js'
import emaTouch from './ema_touch.js'
import lsob from './lsob.js'

const TF_MS = 900000
const T0 = 1700000000000
let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const series = (rows, t0 = T0) => rows.map((r, i) => ({
    t: t0 + i * TF_MS, o: r[0], h: r[1], l: r[2], c: r[3], v: 100,
    closeTime: t0 + (i + 1) * TF_MS - 1,
}))

/**
 * Bildet die Buchführung des Backtests nach: wachsendes Sichtfenster, offene
 * Setups werden weitergereicht, Ereignisse schliessen sie.
 * Liefert alle je erzeugten Setups mit ihrem Endzustand.
 */
function replay(detect, candles, params, ab = 5) {
    let offene = []
    const alle = []
    const bekannt = new Set()
    let id = 1

    for (let n = ab; n <= candles.length; n++) {
        const sicht = candles.slice(0, n)
        const { setups = [], events = [] } = detect({
            candles: sicht, params, openSetups: offene,
            knownSetupKeys: [...bekannt],
        })

        for (const s of setups) {
            const setup = { ...s, id: id++ }
            offene.push(setup)
            alle.push(setup)
            bekannt.add(`${s.direction}|${s.obCandleTime}`)
        }

        for (const ev of events) {
            const s = alle.find((x) => x.id === ev.id)
            if (!s) continue
            Object.assign(s, ev)
            if (ev.status !== 'waiting_retest' && ev.status !== 'armed') {
                offene = offene.filter((x) => x.id !== ev.id)
            }
        }
    }
    return alle
}

/**
 * Die eigentliche Behauptung: kein Einstieg vor der Bestätigung.
 * `rechts` ist die Zahl der Kerzen, die der Pivot zur Bestätigung braucht;
 * der früheste ehrliche Einstieg liegt eine Kerze DANACH.
 */
function keinLookahead(name, setups, rechts) {
    const ausgeloest = setups.filter((s) => s.status === 'triggered')
    const zuFrueh = ausgeloest.filter((s) => {
        const signal = Number(s.sweepCandleTime || s.obCandleTime)
        const einstieg = Number(s.triggeredAt || s.candleTime)
        return einstieg <= signal + rechts * TF_MS
    })
    check(`${name} — ${ausgeloest.length} Einstiege, keiner vor der Bestätigung`,
        ausgeloest.length > 0 && zuFrueh.length === 0,
        zuFrueh.length
            ? `${zuFrueh.length} zu früh (z. B. Signal ${new Date(Number(zuFrueh[0].sweepCandleTime)).toISOString()} → Einstieg ${new Date(Number(zuFrueh[0].triggeredAt)).toISOString()})`
            : 'gar kein Einstieg — Testdaten prüfen')
    return ausgeloest
}

console.log('\nLookahead — Selbsttest\n')

// ── 1. Regel-Interpreter: gebauter Fall ──────────────────────────────────
// Pivot-Hoch bei Index 10 (left 3, right 2), Einstieg beim Rücklauf auf das
// Tief der Signalkerze. Der Unterschied zwischen den beiden Serien ist nur,
// WANN die Berührung stattfindet: einmal in der Bestätigungslücke, einmal
// danach.
console.log('Regel-Interpreter — gebauter Pivot')

const regeln = {
    id: 'lookahead_probe',
    timeframes: ['15m'],
    params: [],
    indicators: [],
    direction: 'short',
    signal: { type: 'pivotHigh', left: 3, right: 2 },
    signalFilters: [],
    entry: { type: 'touch', anchor: 'signalLow', from: 'above' },
    invalidations: [{ type: 'timeout', candles: 30, code: 'timeout' }],
    stopLoss: { anchor: 'signalHigh', offsetPct: 0.1 },
    takeProfit: { mode: 'rr', rr: 2 },
}

// Der Interpreter braucht einen Mindestvorlauf, sonst kehrt detect() sofort um.
// Streng steigend, damit der Vorlauf selbst kein Pivot-Hoch enthält.
const vorlauf = []
for (let i = 0; i < 60; i++) vorlauf.push([40 + i, 41 + i, 39.5 + i, 40.8 + i])
const anlauf = [
    [100, 102, 99, 101], [101, 104, 100, 103], [103, 106, 102, 105],
    [105, 108, 104, 107], [107, 111, 106, 110], [110, 113, 109, 112],
    [112, 115, 111, 114], [114, 117, 113, 116], [116, 118, 115, 117],
    [117, 119, 116, 118],
]
// Signalkerze: Hoch 122, Tief 115.
const signalKerze = [118, 122, 115, 116]
const I_SIG = vorlauf.length + anlauf.length   // Index der Signalkerze
const I_BEST = I_SIG + 2                       // Bestätigungskerze (right = 2)

// (a) Berührung von 115 schon auf Kerze 11 — mitten in der Bestätigung.
const zuFruehSerie = series([
    ...vorlauf, ...anlauf, signalKerze,
    [116, 117, 114, 115],   // 11: berührt 115 → unter altem Code Einstieg
    [115, 116, 113, 114],   // 12: Bestätigungskerze
    [114, 115, 112, 113], [113, 114, 111, 112], [112, 113, 110, 111],
    [111, 112, 109, 110], [110, 111, 108, 109], [109, 110, 107, 108],
])

const a = replay((ctx) => detectMitRegeln(regeln, ctx), zuFruehSerie, {}, 55)
const setupA = a.find((s) => s.sweepCandleTime === zuFruehSerie[I_SIG].t)
check('Berührung in der Bestätigungslücke wird nicht gehandelt',
    !!setupA && setupA.status === 'invalidated' && setupA.invalidReason === 'entry_before_confirm',
    setupA ? `${setupA.status}/${setupA.invalidReason || '-'}` : 'kein Setup erzeugt')
check('… und taucht als eigener Grund im Trichter auf, statt still zu verschwinden',
    !!setupA && setupA.invalidReason === 'entry_before_confirm')

// (b) Dieselbe Regel, Berührung erst auf Kerze 13 — das ist handelbar.
const spaeterSerie = series([
    ...vorlauf, ...anlauf, signalKerze,
    [116, 121, 116, 120],   // 11: bleibt über 115, Hoch unter 122
    [120, 121, 117, 118],   // 12: Bestätigungskerze
    [118, 119, 114, 115],   // 13: berührt 115 → ehrlicher Einstieg
    [115, 116, 112, 113], [113, 114, 110, 111], [111, 112, 108, 109],
    [109, 110, 106, 107], [107, 108, 104, 105],
])

const b = replay((ctx) => detectMitRegeln(regeln, ctx), spaeterSerie, {}, 55)
const setupB = b.find((s) => s.sweepCandleTime === spaeterSerie[I_SIG].t)
check('Berührung nach der Bestätigung wird gehandelt',
    !!setupB && setupB.status === 'triggered',
    setupB ? `${setupB.status}/${setupB.invalidReason || '-'}` : 'kein Setup erzeugt')
check('Einstieg liegt hinter der Bestätigungskerze',
    !!setupB && Number(setupB.triggeredAt) > spaeterSerie[I_BEST].t,
    setupB ? `triggeredAt=${setupB.triggeredAt}, Bestätigung=${spaeterSerie[I_BEST].t}` : '')
check('Einstieg zum Tief der Signalkerze, nicht zum Schlusskurs',
    !!setupB && Math.abs(Number(setupB.entry) - 115) < 1e-9,
    setupB ? `entry=${setupB.entry}` : '')

// „immediate" darf nicht verworfen werden — es wartet nur bis zur Bestätigung.
console.log('\nRegel-Interpreter — sofortiger Einstieg')
const sofort = { ...regeln, entry: { type: 'immediate' }, stopLoss: { anchor: 'signalHigh', offsetPct: 0.1 } }
const c = replay((ctx) => detectMitRegeln(sofort, ctx), spaeterSerie, {}, 55)
const setupC = c.find((s) => s.sweepCandleTime === spaeterSerie[I_SIG].t)
check('„sofort" wartet die Bestätigung ab, statt zu verwerfen',
    !!setupC && setupC.status === 'triggered',
    setupC ? `${setupC.status}/${setupC.invalidReason || '-'}` : 'kein Setup')
check('„sofort" steigt zur Eröffnung der ersten Kerze nach der Bestätigung ein',
    !!setupC && Number(setupC.candleTime) === spaeterSerie[I_BEST + 1].t
        && Math.abs(Number(setupC.entry) - spaeterSerie[I_BEST + 1].o) < 1e-9,
    setupC ? `candleTime=${setupC.candleTime} (erwartet ${spaeterSerie[I_BEST + 1].t}), entry=${setupC.entry}` : '')

// Kreuzungssignale brauchen keine Bestätigung — sie dürfen sich nicht ändern.
console.log('\nKreuzung braucht keine Bestätigungskerzen')
{
    const kreuz = {
        ...regeln,
        indicators: [{ id: 'ema5', type: 'ema', period: 5 }, { id: 'ema20', type: 'ema', period: 20 }],
        signal: { type: 'crossDown', a: 'ema5', b: 'ema20' },
        entry: { type: 'immediate' },
        stopLoss: { anchor: 'signalHigh', offsetPct: 1 },
    }
    // Erst lange steigen, dann kippen — irgendwo kreuzt die schnelle EMA nach unten.
    const rows = []
    for (let i = 0; i < 40; i++) rows.push([100 + i, 101 + i, 99 + i, 100.5 + i])
    for (let i = 0; i < 40; i++) rows.push([140 - i * 1.5, 141 - i * 1.5, 138 - i * 1.5, 139 - i * 1.5])
    const serie = series(rows)
    const r = replay((ctx) => detectMitRegeln(kreuz, ctx), serie, 25)
    const trig = r.filter((s) => s.status === 'triggered')
    check('Kreuzung löst weiterhin aus (keine künstliche Verzögerung)', trig.length > 0,
        `${r.length} Setups, ${trig.length} ausgelöst`)
    check('Kreuzung steigt auf der Kerze direkt nach dem Signal ein',
        trig.every((s) => Number(s.candleTime) === Number(s.sweepCandleTime) + TF_MS),
        trig.length ? `erstes: Signal ${trig[0].sweepCandleTime} → Einstieg ${trig[0].candleTime}` : '')
}

// ── 2. Zufallsserien: die allgemeine Behauptung ──────────────────────────
// Ein gebauter Fall beweist einen Fall. Interessant ist, ob die Grenze über
// viele Verläufe hält — deshalb ein deterministischer Zufallslauf.
console.log('\nZufallsserien (deterministisch, Seed 42)')

function zufallsSerie(n, seed) {
    let s = seed >>> 0
    const next = () => {
        s = (s + 0x6D2B79F5) >>> 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const rows = []
    let kurs = 100
    for (let i = 0; i < n; i++) {
        const schritt = (next() - 0.48) * 2.5
        const o = kurs
        const c = Math.max(1, o + schritt)
        const h = Math.max(o, c) + next() * 1.2
        const l = Math.min(o, c) - next() * 1.2
        rows.push([o, h, l, c])
        kurs = c
    }
    return series(rows)
}

// Die Detektoren lesen ihre Parameter ohne Vorgabewerte — ein leeres Objekt
// liefert lautlos NULL Setups und der Test wäre eine Attrappe.
const standard = (strategie, ueber = {}) => {
    const p = {}
    for (const d of strategie.params) p[d.key] = d.default
    return { ...p, ...ueber }
}
// Etwas kürzere EMAs und ein milderer Überdehnungsfilter: sonst feuert EMA
// Touch auf 400 Zufallskerzen zu selten, um überhaupt etwas zu beweisen.
const emaParams = standard(emaTouch, {
    emaFast: 5, emaEntry: 10, minOverextensionPct: 0.8,
    swingLookback: 5, maxCorrectionCandles: 20,
})
const lsobParams = standard(lsob)

let emaEinstiege = 0
let lsobEinstiege = 0

for (const seed of [42, 1337, 20260816]) {
    const serie = zufallsSerie(400, seed)

    const r = replay((ctx) => detectMitRegeln(regeln, ctx), serie, {}, 10)
    keinLookahead(`Regel-Interpreter (Seed ${seed})`, r, 2)

    const e = replay((ctx) => emaTouch.detect(ctx), serie, emaParams, 60)
    const eTrig = e.filter((s) => s.status === 'triggered')
    emaEinstiege += eTrig.length
    const eFrueh = eTrig.filter((s) => Number(s.triggeredAt)
        <= Number(s.sweepCandleTime) + emaParams.swingConfirmBars * TF_MS)
    check(`EMA Touch (Seed ${seed}) — ${eTrig.length} Einstiege, keiner vor der Bestätigung`,
        eFrueh.length === 0,
        eFrueh.length ? `${eFrueh.length} zu früh` : '')

    const l = replay((ctx) => lsob.detect(ctx), serie, lsobParams, 60)
    const lTrig = l.filter((s) => s.status === 'triggered')
    lsobEinstiege += lTrig.length
    const lFrueh = lTrig.filter((s) => Number(s.triggeredAt) <= Number(s.sweepCandleTime))
    check(`LSOB (Seed ${seed}) — ${lTrig.length} Einstiege, Referenzverhalten unverändert`,
        lFrueh.length === 0,
        lFrueh.length ? `${lFrueh.length} zu früh` : '')
}

// Eine Prüfung, die nie etwas zu prüfen hatte, beweist nichts.
check(`EMA Touch hat überhaupt gehandelt (${emaEinstiege} Einstiege)`, emaEinstiege > 0)
check(`LSOB hat überhaupt gehandelt (${lsobEinstiege} Einstiege)`, lsobEinstiege > 0)

// ── 3. EMA Touch: gebauter Fall ──────────────────────────────────────────
// Die Guss-Bedingung muss weiter über die Bestätigungslücke hinweg gelten —
// eine bullische Kerze DORT darf das Setup weiterhin töten. Sonst hätte der
// Fix den Filter heimlich gelockert.
console.log('\nEMA Touch — Guss-Bedingung gilt auch in der Bestätigungslücke')
{
    const rows = []
    for (let i = 0; i < 80; i++) rows.push([100 + i * 0.8, 101 + i * 0.8, 99.5 + i * 0.8, 100.6 + i * 0.8])
    // Impuls nach oben, dann Korrektur mit einer klar bullischen Kerze direkt
    // nach dem Hoch (Index 81) — die liegt in der Bestätigungslücke.
    rows.push([164, 178, 163, 177])          // 80: Hoch
    rows.push([176, 177.5, 174, 177.2])      // 81: bullisch, mitten in der Lücke
    rows.push([177, 177.4, 172, 173])        // 82
    for (let i = 0; i < 12; i++) rows.push([173 - i, 173.5 - i, 171 - i, 171.5 - i])
    const serie = series(rows)
    const r = replay((ctx) => emaTouch.detect(ctx), serie, standard(emaTouch, { emaFast: 5, emaEntry: 10, minOverextensionPct: 0.8, swingLookback: 5 }), 60)
    const s = r.find((x) => Number(x.sweepCandleTime) === serie[80].t)
    check('bullische Kerze in der Lücke macht das Setup weiterhin ungültig',
        !s || s.status !== 'triggered',
        s ? `${s.status}/${s.invalidReason || '-'}` : 'kein Setup erzeugt')
}

// ── Ergebnis ─────────────────────────────────────────────────────────────
console.log(`\n${fehlgeschlagen === 0 ? '\x1b[32m' : '\x1b[31m'}${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\x1b[0m`)
if (fehlgeschlagen) { console.log('Fehlgeschlagen:'); for (const f of fehler) console.log(`  · ${f}`) }
process.exit(fehlgeschlagen ? 1 : 0)
