/**
 * Selbsttest des Trendlinien-Ausbruchs.
 *
 *   node server/strategies/__selftest-trendlinien.mjs
 *
 * Die beiden teuren Fehler dieser Strategie sind Vorzeichen-Fehler, und beide
 * lesen sich im Code völlig plausibel:
 *
 *   1. Die LINIE. Long wird an einer FALLENDEN Linie gekauft (vom Higher High
 *      herab zum Signalschluss); wer sie andersherum zieht, bekommt eine
 *      Strategie, die im Aufwärtstrend verkauft und trotzdem Trades liefert.
 *   2. Die ORDER. Ein Kauf-Stop liegt ÜBER dem Markt, ein Kauf-Limit darunter.
 *      Die Ausführungsschicht prüfte bis hierher nur den Limit-Fall — eine
 *      Stop-Order hätte lautlos genau die Ausbrüche verworfen, die laufen.
 *
 * Deshalb prüft jeder Fang auch die Gegenrichtung: nicht nur „löst aus", auch
 * „löst NICHT aus, wenn die Bedingung fehlt".
 */

import strategie, { INVALID_REASONS, linienPreis, obvAmpel, balkenReihe, tagGesperrt } from './trendlinien_breakout.js'
import { obv, stochRsi } from './indicators.js'
import { entryIsValid, einstiegsPreis, einstiegsSorte, istStopEinstieg } from '../fill-simulator.js'

const TF_MS = 3600000
const T0 = 1700000000000

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const zeit = (i) => T0 + i * TF_MS

function series(rows) {
    return rows.map((r, i) => ({
        t: zeit(i), o: r[0], h: r[1], l: r[2], c: r[3], v: r[4] ?? 100,
        closeTime: zeit(i + 1) - 1,
    }))
}

function params(over = {}) {
    const p = {}
    for (const d of strategie.params) p[d.key] = d.default
    // Kurze Perioden, damit ein Fall mit ~90 Kerzen auskommt
    return {
        ...p, obvLaenge: 20, emaFast: 5, emaSlow: 10,
        pivotLinks: 3, pivotRechts: 3, verlangeBalken: false, ...over,
    }
}

/** Gleichmässige Kerzen entlang einer Kursreihe. */
function ausKursen(kurse, vol = 100) {
    return series(kurse.map((k, i) => {
        const vor = i === 0 ? k : kurse[i - 1]
        return [vor, Math.max(vor, k) + 0.3, Math.min(vor, k) - 0.3, k, vol]
    }))
}

console.log('\n\x1b[1mTrendlinien-Ausbruch\x1b[0m\n')

// ── 1. Geometrie der Linie ───────────────────────────────────────────────
console.log('  Linie')
{
    // Anker 110 bei t0, Signalschluss 104 bei t6 → Gefälle 1 je Kerze
    const preis = (i) => linienPreis(zeit(0), 110, zeit(6), 104, zeit(i))
    check('fallende Linie extrapoliert weiter nach unten', Math.abs(preis(9) - 101) < 1e-9, `${preis(9)}`)
    check('auf dem zweiten Punkt liegt sie auf dem Schlusskurs', Math.abs(preis(6) - 104) < 1e-9)
    check('rückwärts trifft sie den Anker', Math.abs(preis(0) - 110) < 1e-9)
    // Ohne Zeitabstand (beide Punkte auf derselben Kerze) bleibt sie waagerecht
    check('ohne Zeitabstand keine Division durch null',
        linienPreis(zeit(4), 110, zeit(4), 104, zeit(9)) === 104)
}

// ── 2. OBV-Ampel ─────────────────────────────────────────────────────────
console.log('\n  OBV')
{
    const rauf = ausKursen(Array.from({ length: 60 }, (_, i) => 100 + i * 0.5))
    const runter = ausKursen(Array.from({ length: 60 }, (_, i) => 130 - i * 0.5))
    const a = obvAmpel(rauf, { laenge: 20, art: 'ema' })
    const b = obvAmpel(runter, { laenge: 20, art: 'ema' })
    check('steigende Kurse → Ampel grün', a[a.length - 1] === 1)
    check('fallende Kurse → Ampel rot', b[b.length - 1] === -1)
    check('ohne Vergleichslinie keine Aussage (0 statt Rat)', a[3] === 0)

    // Eine unveränderte Kerze zählt nach Granville nicht
    const gleich = series([[100, 101, 99, 100, 50], [100, 101, 99, 100, 50], [100, 101, 99, 101, 50]])
    const reihe = obv(gleich)
    check('unveränderter Schlusskurs bewegt den OBV nicht', reihe[1] === 0 && reihe[2] === 50)
}

// ── 3. Balken aus dem Stoch-RSI ──────────────────────────────────────────
console.log('\n  Balken')
{
    // Abverkauf, dann Erholung: der Stoch-RSI muss die untere Schwelle von
    // unten nach oben kreuzen.
    const kurse = [
        ...Array.from({ length: 20 }, () => 100),
        ...Array.from({ length: 25 }, (_, i) => 100 + (i + 1) * 0.8),   // Anstieg: %K nach oben
        ...Array.from({ length: 20 }, (_, i) => 120 - (i + 1) * 1.0),   // Abverkauf: %K fällt unter 80 und 20
        ...Array.from({ length: 15 }, (_, i) => 100 + (i + 1) * 0.7),   // Erholung: %K wieder über 20
        ...Array.from({ length: 12 }, (_, i) => 110 - (i + 1) * 0.9),   // zweiter Abverkauf: %K wieder unter 80
    ]
    const c = ausKursen(kurse)
    const p = params()
    const b = balkenReihe(c, p)
    const gruen = b.filter((x) => x === 1).length
    const rot = b.filter((x) => x === -1).length
    check('Erholung erzeugt grüne Balken', gruen > 0, `grün ${gruen}`)
    check('Abverkauf erzeugt rote Balken', rot > 0, `rot ${rot}`)
    const { k } = stochRsi(c, { rsiPeriod: p.stochRsiLaenge, stochPeriod: p.stochLaenge, smoothK: p.stochSmoothK, smoothD: p.stochSmoothD })
    check('Stoch-RSI bleibt im Bereich 0–100',
        k.every((v) => v === null || (v >= -1e-9 && v <= 100 + 1e-9)))

    // Die andere Lesart dreht die Farben um: grün entsteht beim EINTRITT in die
    // überverkaufte Zone, also im Abverkauf statt in der Erholung. Ein
    // Vorzeichenfehler hier bliebe sonst unsichtbar — beide Varianten liefern
    // Signale, nur eben an gegensätzlichen Stellen.
    const ein = balkenReihe(c, { ...p, balkenArt: 'eintritt' })
    const gruenEin = ein.map((x, i) => (x === 1 ? i : -1)).filter((i) => i >= 0)
    const gruenAus = b.map((x, i) => (x === 1 ? i : -1)).filter((i) => i >= 0)
    check('Eintritts-Lesart färbt grün an anderen Kerzen als die Austritts-Lesart',
        gruenEin.length > 0 && gruenAus.length > 0
        && gruenEin.every((i) => !gruenAus.includes(i)),
        `eintritt ${gruenEin.slice(0, 4)} / austritt ${gruenAus.slice(0, 4)}`)

    // Vorgabe ist 0: der Balken gilt nur auf seiner eigenen Kerze, so wie im
    // Referenz-Skript. Die Toleranz ist eine Lockerung, also müssen MEHR Kerzen
    // gefärbt sein, sobald sie eingeschaltet wird — und die Ereigniskerzen
    // selbst bleiben dabei erhalten.
    const mitToleranz = balkenReihe(c, { ...p, balkenGueltigKerzen: 3 })
    const streng = b.map((x, i) => (x !== 0 ? i : -1)).filter((i) => i >= 0)
    check('Vorgabe färbt nur die Ereigniskerze',
        p.balkenGueltigKerzen === 0 && streng.length > 0, `${p.balkenGueltigKerzen}`)
    check('Toleranz färbt zusätzliche Kerzen, ohne die Ereigniskerzen zu verlieren',
        mitToleranz.filter((x) => x !== 0).length > streng.length
        && streng.every((i) => mitToleranz[i] === b[i]))
}

// ── 4. Phase A: Signal und Ankerwahl ─────────────────────────────────────
console.log('\n  Signal und Anker')

/**
 * Aufwärtsfall: Vorlauf abwärts (damit OBV und EMAs erst kreuzen müssen),
 * ein erstes Hoch, ein HÖHERES Hoch, dann eine Korrektur.
 */
function aufwaerts() {
    const kurse = []
    for (let i = 0; i < 40; i++) kurse.push(110 - i * 0.5)            //  0–39  Abwärtsvorlauf
    for (let i = 0; i < 8; i++) kurse.push(90 + i * 0.8)              // 40–47  erstes Hoch (Pivot bei 47)
    for (let i = 0; i < 6; i++) kurse.push(95.6 - (i + 1) * 0.7)      // 48–53  Rücklauf
    for (let i = 0; i < 10; i++) kurse.push(91.4 + (i + 1) * 1.2)     // 54–63  HÖHERES Hoch (Pivot bei 63)
    for (let i = 0; i < 6; i++) kurse.push(103.4 - (i + 1) * 1.1)     // 64–69  Korrektur, EMAs kreuzen abwärts
    for (let i = 0; i < 14; i++) kurse.push(96.8 + (i + 1) * 1.0)     // 70–83  Anstieg, EMAs kreuzen aufwärts
    return kurse
}

{
    const c = ausKursen(aufwaerts())
    const p = params({ signalTrend: false, signalKreuzung: true, direction: 'long' })
    const { setups } = strategie.detect({ candles: c, params: p, openSetups: [], knownSetupKeys: [] })
    check('Kreuzung im Aufwärtstrend erzeugt ein Setup', setups.length > 0, `${setups.length}`)
    const s = setups[0]
    if (s) {
        const ankerIdx = Math.round((s.sweepCandleTime - T0) / TF_MS)
        const signalIdx = Math.round((s.obCandleTime - T0) / TF_MS)
        check('Anker ist ein Pivot-Hoch VOR dem Signal', ankerIdx < signalIdx, `${ankerIdx} / ${signalIdx}`)
        check('Anker ist zum Signalzeitpunkt schon bestätigt',
            ankerIdx + p.pivotRechts <= signalIdx, `${ankerIdx} + ${p.pivotRechts} > ${signalIdx}`)
        check('Richtung ist long', s.direction === 'long')
        check('Einstiegsart ist als Stop-Order vermerkt',
            s.entryTrigger === 'stop' && s.confirmations.entryTrigger === 'stop')
        check('Setup trägt noch keine Kursmarken (die entstehen erst am Ausbruch)',
            s.entry === 0 && s.stopLoss === 0)
    }
}

{
    // Dasselbe Signal, aber jedes Pivot-Hoch tiefer als das vorherige: mit
    // `nurHigherHigh` gibt es dann keinen Anker — und kein Setup.
    const kurse = []
    for (let i = 0; i < 40; i++) kurse.push(110 - i * 0.5)
    for (let i = 0; i < 8; i++) kurse.push(90 + i * 0.8)              // erstes Hoch 95,6
    for (let i = 0; i < 6; i++) kurse.push(95.6 - (i + 1) * 0.7)
    for (let i = 0; i < 10; i++) kurse.push(91.4 + (i + 1) * 0.3)     // zweites Hoch 94,4 — TIEFER
    for (let i = 0; i < 6; i++) kurse.push(94.4 - (i + 1) * 0.8)
    for (let i = 0; i < 14; i++) kurse.push(89.6 + (i + 1) * 0.9)
    const c = ausKursen(kurse)
    const p = params({ signalTrend: false, signalKreuzung: true, direction: 'long', nurHigherHigh: true })
    const { setups, diagnostics } = strategie.detect({ candles: c, params: p, openSetups: [], knownSetupKeys: [] })
    const ohneAnker = (diagnostics.rejected[INVALID_REASONS.KEIN_ANKER] || 0)
    check('ohne Higher High entsteht kein Setup', setups.length === 0 || ohneAnker > 0,
        `${setups.length} Setups, ${ohneAnker} Ablehnungen`)
}

// ── 5. Phase B: Ausbruch, Order, Verfall ─────────────────────────────────
console.log('\n  Ausbruch und Order')

/**
 * Baut einen Fall für Phase B: 70 ruhige Kerzen, danach die vom Aufrufer
 * gelieferten. Das Setup wird von Hand gesetzt — so ist die Linie exakt
 * bekannt (110 bei Kerze 60, 104 bei Kerze 66, Gefälle 1 je Kerze).
 */
function phaseB(nachher, over = {}, dir = 'long') {
    const basis = Array.from({ length: 67 }, (_, i) => {
        const k = 100 + (i % 5) * 0.2
        return [k, k + 0.3, k - 0.3, k, 100]
    })
    const c = series([...basis, ...nachher])
    const long = dir === 'long'
    const setup = {
        id: 1, direction: dir, status: 'waiting_retest',
        sweepLevel: long ? 110 : 90,
        sweepPrice: long ? 104 : 96,
        sweepCandleTime: zeit(60),
        obCandleTime: zeit(66),
        watchFrom: zeit(66),
        tradeableFrom: zeit(66),
        obHigh: 0, obLow: 0, impulseExtreme: long ? 110 : 90,
        entry: 0, stopLoss: 0, takeProfit: 0, rr: 0,
        confirmations: { entryTrigger: 'stop' },
        entryTrigger: 'stop',
    }
    const p = params({ abbruchBeiTrendwechsel: false, slQuelle: 'swing', ...over })
    const { events } = strategie.detect({ candles: c, params: p, openSetups: [setup], knownSetupKeys: [] })
    return { events, candles: c, p }
}

{
    // Linie bei Kerze 67 = 103, bei 68 = 102. Kerze 67 schliesst darunter,
    // Kerze 68 bricht sie (Schluss 103 > 102), Kerze 69 nimmt das Hoch.
    const { events, candles } = phaseB([
        [100, 100.5, 99.5, 100],    // 67  unter der Linie (103)
        [100, 103.4, 99.8, 103],    // 68  Ausbruch: Schluss 103 > Linie 102
        [103, 105.0, 102.5, 104.5], // 69  nimmt das Hoch der Ausbruchskerze
    ])
    const ev = events[0]
    check('Ausbruch mit Schluss über der Linie löst aus', ev?.status === 'triggered', ev?.status + '/' + ev?.invalidReason)
    if (ev?.status === 'triggered') {
        const hoch = candles[68].h
        check('Einstieg liegt ÜBER dem Hoch der Ausbruchskerze', ev.entry > hoch, `${ev.entry} vs ${hoch}`)
        check('ausgelöst wird erst auf der FOLGEKERZE', ev.triggeredAt === zeit(69), `${(ev.triggeredAt - T0) / TF_MS}`)
        check('Stop liegt unter dem Einstieg', ev.stopLoss < ev.entry)
        const risiko = ev.entry - ev.stopLoss
        check('Ziel sitzt auf dem eingestellten Chance/Risiko',
            Math.abs((ev.takeProfit - ev.entry) / risiko - 2) < 1e-6, `${(ev.takeProfit - ev.entry) / risiko}`)
        check('Stop-Charakter reist im Ereignis mit', ev.confirmations.entryTrigger === 'stop')
    }
}

{
    // Gegenprobe: die Folgekerze bleibt unter dem Einstieg — die Order verfällt.
    const { events } = phaseB([
        [100, 100.5, 99.5, 100],
        [100, 103.4, 99.8, 103],
        [103, 103.3, 101.0, 101.5],   // erreicht die Stop-Order nicht
        [101, 106.0, 100.5, 105.5],   // zu spät: die Order war schon gestrichen
    ])
    const ev = events[0]
    check('nicht ausgelöste Order verfällt', ev?.status === 'expired' && ev?.invalidReason === INVALID_REASONS.ORDER_VERFALLEN,
        `${ev?.status}/${ev?.invalidReason}`)
}

{
    // Solange die Folgekerze noch fehlt, darf die Order NICHT als verfallen
    // gelten — sonst stirbt sie im selben Takt, in dem sie entsteht.
    const { events } = phaseB([
        [100, 100.5, 99.5, 100],
        [100, 103.4, 99.8, 103],
    ])
    check('frische Order überlebt den Takt ihrer Entstehung', events.length === 0, JSON.stringify(events[0] || {}))
}

{
    // Kein Ausbruch innerhalb der Wartezeit
    // Deutlich unter der fallenden Linie, damit sie in der Wartezeit nicht
    // doch noch von unten erreicht wird.
    const ruhig = Array.from({ length: 14 }, () => [90, 90.4, 89.6, 90])
    const { events } = phaseB(ruhig, { maxWarteKerzen: 5 })
    const ev = events[0]
    check('ohne Ausbruch läuft das Setup ab',
        ev?.status === 'expired' && ev?.invalidReason === INVALID_REASONS.KEIN_AUSBRUCH, `${ev?.status}/${ev?.invalidReason}`)
}

{
    // Ein Schluss ÜBER der Linie ist nötig — ein Docht darüber reicht nicht.
    const { events } = phaseB([
        [100, 100.5, 99.5, 100],
        [100, 104.5, 99.8, 101.0],   // Hoch über der Linie, Schluss darunter
        [101, 105.0, 100.5, 104.5],
    ])
    const ev = events[0]
    check('Docht über der Linie ist kein Ausbruch', !ev || ev.status !== 'triggered' || ev.triggeredAt !== zeit(69),
        `${ev?.status} @ ${ev ? (ev.triggeredAt - T0) / TF_MS : '-'}`)
}

{
    // Stop-Quelle „zwischen den Durchschnitten": die Mitte der beiden, nicht
    // einer von beiden — und niemals auf der falschen Seite des Einstiegs.
    const { events } = phaseB([
        [100, 100.5, 99.5, 100],
        [100, 103.4, 99.8, 103],
        [103, 105.0, 102.5, 104.5],
    ], { slQuelle: 'mas' })
    const ev = events[0]
    check('MA-Stop löst ebenfalls aus', ev?.status === 'triggered', `${ev?.status}/${ev?.invalidReason}`)
    check('MA-Stop liegt unter dem Einstieg', ev?.status === 'triggered' && ev.stopLoss < ev.entry)

    // Ohne brauchbaren Swing UND ohne Durchschnitte bleibt nur die Ablehnung —
    // geraten wird nichts.
    const eng = phaseB([
        [100, 100.5, 99.5, 100],
        [100, 103.4, 99.8, 103],
        [103, 105.0, 102.5, 104.5],
    ], { slQuelle: 'mas', slPufferPct: 0 }).events[0]
    check('auch ohne Puffer bleibt der Stop unter dem Einstieg',
        !eng || eng.status !== 'triggered' || eng.stopLoss < eng.entry)
}

{
    // Der Trendwechsel-Abbruch ist NICHT aus dem Video und deshalb aus. Wer ihn
    // einschaltet, muss ihn auch greifen sehen — sonst ist der Schalter Zierde.
    const { events } = phaseB([
        [100, 100.2, 96.0, 96.2],
        [96, 96.2, 92.0, 92.2],
        [92, 92.2, 88.0, 88.2],
        [88, 88.2, 84.0, 84.2],
        [84, 84.2, 80.0, 80.2],
    ], { abbruchBeiTrendwechsel: true })
    const ev = events[0]
    check('eingeschalteter Trendwechsel beendet das Setup',
        ev?.status === 'invalidated' && ev?.invalidReason === INVALID_REASONS.TREND_GEDREHT,
        `${ev?.status}/${ev?.invalidReason}`)

    // Und ausgeschaltet (die Vorgabe) darf derselbe Verlauf nicht daran sterben.
    const ohne = phaseB([
        [100, 100.2, 96.0, 96.2],
        [96, 96.2, 92.0, 92.2],
        [92, 92.2, 88.0, 88.2],
        [88, 88.2, 84.0, 84.2],
        [84, 84.2, 80.0, 80.2],
    ], { abbruchBeiTrendwechsel: false }).events[0]
    check('ausgeschaltet stirbt es nicht am Farbwechsel',
        !ohne || ohne.invalidReason !== INVALID_REASONS.TREND_GEDREHT, `${ohne?.invalidReason}`)
}

// ── 6. Short ist das Spiegelbild ─────────────────────────────────────────
console.log('\n  Short')
{
    // Linie steigt von 90 (Kerze 60) auf 96 (Kerze 66): bei 68 steht sie bei 98.
    const { events, candles } = phaseB([
        [100, 100.5, 99.5, 100],      // 67  über der Linie (97)
        [100, 100.2, 96.6, 97],       // 68  Schluss 97 < Linie 98 → Ausbruch
        [97, 97.5, 95.0, 95.5],       // 69  nimmt das Tief
    ], {}, 'short')
    const ev = events[0]
    check('Short bricht die steigende Linie nach unten', ev?.status === 'triggered', `${ev?.status}/${ev?.invalidReason}`)
    if (ev?.status === 'triggered') {
        check('Short-Einstieg liegt UNTER dem Tief der Ausbruchskerze', ev.entry < candles[68].l, `${ev.entry} vs ${candles[68].l}`)
        check('Short-Stop liegt über dem Einstieg', ev.stopLoss > ev.entry)
        check('Short-Ziel liegt unter dem Einstieg', ev.takeProfit < ev.entry)
    }
}

// ── 6b. Wochentagssperre ─────────────────────────────────────────────────
console.log('\n  Wochentage')
{
    // 04.01.2026 ist ein Sonntag — von dort aus sind alle sieben Tage bekannt.
    const SONNTAG = Date.UTC(2026, 0, 4)
    const tagName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
    const alle = { sperreSamstag: true, sperreSonntag: true, sperreMontag: true }
    const gesperrt = []
    for (let i = 0; i < 7; i++) {
        const t = SONNTAG + i * 86400000
        if (tagGesperrt(t, alle)) gesperrt.push(tagName[new Date(t).getUTCDay()])
    }
    check('mit allen drei Schaltern sind genau Sa, So und Mo gesperrt',
        JSON.stringify(gesperrt.sort()) === JSON.stringify(['Mo', 'Sa', 'So']), gesperrt.join(','))

    check('einzeln greift jeder Schalter nur auf seinen Tag',
        tagGesperrt(SONNTAG, { sperreSonntag: true })
        && !tagGesperrt(SONNTAG + 86400000, { sperreSonntag: true })
        && tagGesperrt(SONNTAG + 86400000, { sperreMontag: true })
        && tagGesperrt(SONNTAG + 6 * 86400000, { sperreSamstag: true }))

    check('ohne Schalter ist kein Tag gesperrt',
        [0, 1, 2, 3, 4, 5, 6].every((i) => !tagGesperrt(SONNTAG + i * 86400000, {})))

    // Die Sperre gilt in UTC, nicht in der Zone des Rechners: eine Kerze kurz
    // vor Mitternacht UTC am Sonntag ist Sonntag — auch wenn es in Zürich schon
    // Montag ist. Andernfalls träfe dieselbe Regel im Backtest und auf einem
    // Server in einer anderen Zone verschiedene Kerzen.
    check('Sonntag 23:30 UTC zählt als Sonntag, nicht als Montag',
        tagGesperrt(SONNTAG + 23.5 * 3600000, { sperreSonntag: true })
        && !tagGesperrt(SONNTAG + 23.5 * 3600000, { sperreMontag: true }))

    // Und der Weg durch detect(): Tageskerzen, deren Auslösekerze ein Samstag
    // ist. Ohne Sperre entsteht ein Trade, mit Sperre nicht.
    const TAG = 86400000
    const start = Date.UTC(2025, 11, 1)          // Montag
    const tage = (rows) => rows.map((r, i) => ({
        t: start + i * TAG, o: r[0], h: r[1], l: r[2], c: r[3], v: 100,
        closeTime: start + (i + 1) * TAG - 1,
    }))
    const basis = Array.from({ length: 67 }, (_, i) => {
        const k = 100 + (i % 5) * 0.2
        return [k, k + 0.3, k - 0.3, k, 100]
    })
    // Kerze 67 = 06.02.2026 (Freitag), 68 = Samstag, 69 = Sonntag
    const c = tage([...basis,
        [100, 100.5, 99.5, 100],
        [100, 103.4, 99.8, 103],
        [103, 105.0, 102.5, 104.5],
    ])
    const setup = {
        id: 1, direction: 'long', status: 'waiting_retest',
        sweepLevel: 110, sweepPrice: 104,
        sweepCandleTime: c[60].t, obCandleTime: c[66].t,
        watchFrom: c[66].t, tradeableFrom: c[66].t,
        obHigh: 0, obLow: 0, impulseExtreme: 110,
        entry: 0, stopLoss: 0, takeProfit: 0, rr: 0,
        confirmations: { entryTrigger: 'stop' }, entryTrigger: 'stop',
    }
    const p2 = params({ abbruchBeiTrendwechsel: false })
    const fuellTag = new Date(c[69].t).getUTCDay()
    check('Testaufbau: die Auslösekerze ist wirklich ein Sonntag', fuellTag === 0, tagName[fuellTag])

    const ohne = strategie.detect({ candles: c, params: p2, openSetups: [{ ...setup }], knownSetupKeys: [] }).events[0]
    const mit = strategie.detect({ candles: c, params: { ...p2, sperreSonntag: true }, openSetups: [{ ...setup }], knownSetupKeys: [] }).events[0]
    check('ohne Sperre wird am Sonntag eingestiegen', ohne?.status === 'triggered', `${ohne?.status}`)
    check('mit Sperre entsteht kein Einstieg',
        mit?.status !== 'triggered', `${mit?.status}/${mit?.invalidReason}`)
    check('der Grund unterscheidet „gesperrt" von „Markt kam nicht"',
        mit?.invalidReason === INVALID_REASONS.WOCHENTAG_GESPERRT, `${mit?.invalidReason}`)
}

// ── 7. Die Stop-Order in der Ausführungsschicht ──────────────────────────
console.log('\n  Ausführung')
{
    const stopSetup = { direction: 'long', entry: 105, stopLoss: 100, entryTrigger: 'stop' }
    const limitSetup = { direction: 'long', entry: 105, stopLoss: 100 }

    check('Stop-Setup wird als solches erkannt', istStopEinstieg(stopSetup))
    check('Marker überlebt als JSON-Text aus der Datenbank',
        istStopEinstieg({ direction: 'long', confirmations: '{"entryTrigger":"stop"}' }))
    check('Limit-Setup bleibt Limit', !istStopEinstieg(limitSetup))

    const drueber = { t: 0, o: 103, h: 106, l: 102, c: 105.5 }
    const drunter = { t: 0, o: 103, h: 104, l: 102, c: 103.5 }
    check('Stop-Order füllt, wenn die Kerze darüber läuft', entryIsValid(stopSetup, drueber).ok)
    check('Stop-Order füllt NICHT, wenn das Niveau unberührt bleibt',
        entryIsValid(stopSetup, drunter).reason === 'entry_not_touched')
    check('Limit-Order verhält sich unverändert (füllt von oben)',
        entryIsValid(limitSetup, { t: 0, o: 106, h: 107, l: 104, c: 106 }).ok)

    check('ohne Lücke füllt die Stop-Order zum Stop-Preis', einstiegsPreis(stopSetup, drueber) === 105)
    check('mit Eröffnungslücke füllt sie schlechter, nicht besser',
        einstiegsPreis(stopSetup, { t: 0, o: 107, h: 108, l: 106.5, c: 107.5 }) === 107)
    check('Short-Stop füllt bei Lücke nach unten ebenfalls schlechter',
        einstiegsPreis({ direction: 'short', entry: 95, entryTrigger: 'stop' }, { t: 0, o: 93, h: 94, l: 92, c: 92.5 }) === 93)
    check('Limit-Einstieg rechnet weiter mit dem Limitpreis',
        einstiegsPreis(limitSetup, { t: 0, o: 99, h: 106, l: 98, c: 105 }) === 105)

    check('Stop-Order zahlt Taker, auch wenn Limit eingestellt ist',
        einstiegsSorte({ entryOrder: 'limit' }, stopSetup) === 'market')
    check('ohne Setup bleibt die Einstellung massgeblich',
        einstiegsSorte({ entryOrder: 'limit' }) === 'limit')

    // Ein Stop, der in derselben Kerze schon reisst, bleibt ein Verlust und
    // darf nicht als sauberer Einstieg durchgehen.
    check('Stop in der Einstiegskerze wird gemeldet',
        entryIsValid(stopSetup, { t: 0, o: 103, h: 106, l: 99, c: 101 }).reason === 'stop_in_entry_candle')
}

// ── 8. Manifest ──────────────────────────────────────────────────────────
console.log('\n  Manifest')
{
    check('id und detect vorhanden', strategie.id === 'trendlinien_breakout' && typeof strategie.detect === 'function')
    const schluessel = strategie.params.map((p) => p.key)
    check('keine doppelten Parameter', new Set(schluessel).size === schluessel.length)
    const gruppen = new Set(strategie.paramGroups.map((g) => g.id))
    check('jeder Parameter sitzt in einer bekannten Gruppe',
        strategie.params.every((p) => gruppen.has(p.group)),
        strategie.params.filter((p) => !gruppen.has(p.group)).map((p) => p.key).join(','))
    check('Tageskerzen werden unterstützt', strategie.supportedTimeframes.includes('1d'))
}

console.log(`\n\x1b[1m${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\x1b[0m`)
if (fehler.length) console.log('Fehlgeschlagen:\n  - ' + fehler.join('\n  - '))
process.exit(fehlgeschlagen ? 1 : 0)
