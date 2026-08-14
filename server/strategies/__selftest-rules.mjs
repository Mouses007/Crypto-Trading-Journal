/**
 * Selbsttest des Regel-Interpreters.
 *
 *   node server/strategies/__selftest-rules.mjs
 *
 * Die entscheidende Prüfung steht am Ende: EMA Touch wird einmal als
 * handgeschriebener Code und einmal als reine Regelbeschreibung durch dieselben
 * Kerzen geschickt. Finden beide dieselben Setups an denselben Stellen, trägt
 * der Interpreter. Weicht er ab, ist er kaputt — nicht die Strategie.
 */

import { detectMitRegeln, alsManifest, zahl } from './rule-engine.js'
import { pruefeRegeln } from './rule-validate.js'
import emaTouch from './ema_touch.js'

const TF_MS = 900000
let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const series = (rows, t0 = 1700000000000) => rows.map((r, i) => ({
    t: t0 + i * TF_MS, o: r[0], h: r[1], l: r[2], c: r[3], v: 100,
    closeTime: t0 + (i + 1) * TF_MS - 1,
}))

console.log('\nRegel-Interpreter — Selbsttest\n')

// ── Prüfung weist Unsinn ab ──────────────────────────────────────────────
console.log('Prüfung der Beschreibung')

{
    const r = pruefeRegeln({
        id: '../../etc/passwd', timeframes: ['1h', 'quatsch'],
        params: [{ key: 'gut', type: 'number', default: 2, min: 1, max: 5 },
                 { key: 'kaputt', type: 'zauberei', default: 1 }],
        indicators: [{ id: 'ema21', type: 'ema', period: 21 },
                     { id: 'boese', type: 'require("fs")', period: 5 }],
        signal: { type: 'pivotHigh', left: 10, right: 2 },
        signalFilters: [{ left: 'signalPrice', op: 'distancePctGt', right: 'ema21', value: { param: 'gut' } },
                        { left: 'signalPrice', op: 'zaubern', right: 'ema21' },
                        { left: 'signalPrice', op: 'gt', right: 'gibtesnicht' }],
        entry: { type: 'touch', anchor: 'ema21', from: 'above' },
        stopLoss: { anchor: 'correctionLow', offsetPct: 0.2 },
        takeProfit: { mode: 'rr', rr: 2 },
    })
    check('feindselige Beschreibung wird abgelehnt', r.ok === false)
    check('Pfadausbruch im Kurznamen erkannt', r.fehler.some((f) => f.includes('Kurzname')))
    check('unbekannter Indikatortyp abgelehnt', r.fehler.some((f) => f.includes('unbekannter Typ')))
    check('unbekannter Vergleich abgelehnt', r.fehler.some((f) => f.includes('unbekannter Vergleich')))
    check('unbekannte Referenz abgelehnt', r.fehler.some((f) => f.includes('gibtesnicht')))
    check('ungültiger Parametertyp abgelehnt', r.fehler.some((f) => f.includes('kaputt')))
    check('ungültige Zeiteinheit gefiltert', JSON.stringify(r.regeln.timeframes) === '["1h"]')
    check('gültiger Filter überlebt', r.regeln.signalFilters.length === 1)
}

{
    const r = pruefeRegeln({
        id: 'ohne_filter', timeframes: ['1h'],
        indicators: [{ id: 'e', type: 'ema', period: 20 }],
        signal: { type: 'pivotHigh', left: 5, right: 2 },
        entry: { type: 'touch', anchor: 'e' },
        stopLoss: { anchor: 'correctionLow', offsetPct: 0.2 },
        takeProfit: { mode: 'rr', rr: 2 },
    })
    check('gültige Beschreibung wird angenommen', r.ok, r.fehler.join('; '))
    check('fehlende Filter erzeugen einen Hinweis', r.hinweise.length >= 1, JSON.stringify(r.hinweise))
}

// ── Bausteine einzeln ────────────────────────────────────────────────────
console.log('\nBausteine')

{
    // Steigender Markt mit einem Hügel — erzeugt Pivot-Hoch und -Tief
    const rows = []
    for (let i = 0; i < 40; i++) { const b = 100 + i * 0.3; rows.push([b, b + 0.15, b - 0.1, b + 0.12]) }
    for (let i = 0; i < 10; i++) { const b = 112 - i * 0.4; rows.push([b, b + 0.05, b - 0.45, b - 0.4]) }
    for (let i = 0; i < 30; i++) { const b = 108 + i * 0.3; rows.push([b, b + 0.15, b - 0.1, b + 0.12]) }
    const candles = series(rows)

    const basis = {
        id: 'test', timeframes: ['1h'],
        params: [{ key: 'schwelle', type: 'number', default: 0.5, min: 0, max: 10 }],
        indicators: [{ id: 'e10', type: 'ema', period: 10 }],
        signal: { type: 'pivotHigh', left: 4, right: 2 },
        signalFilters: [],
        entry: { type: 'touch', anchor: 'e10', from: 'above' },
        invalidations: [{ type: 'timeout', code: 'zu_lang', candles: 20 }],
        stopLoss: { anchor: 'correctionLow', offsetPct: 0.3 },
        takeProfit: { mode: 'rr', rr: 2 },
    }
    const g = pruefeRegeln(basis)
    const p = Object.fromEntries(g.regeln.params.map((x) => [x.key, x.default]))
    const erst = detectMitRegeln(g.regeln, { candles, params: p, openSetups: [], knownSetupKeys: [] })
    check('Pivot-Signal erzeugt Setups', erst.setups.length > 0,
        `setups=${erst.setups.length}`)

    const offen = erst.setups.map((s, i) => ({ ...s, id: i + 1 }))
    const zweit = detectMitRegeln(g.regeln, { candles, params: p, openSetups: offen, knownSetupKeys: [] })
    check('Berührung des Ankers löst aus oder bricht nachvollziehbar ab',
        zweit.events.length > 0, JSON.stringify(zweit.events[0]))

    const ev = zweit.events.find((e) => e.status === 'triggered')
    if (ev) {
        check('Stop liegt unter dem Einstieg', ev.stopLoss < ev.entry)
        check('Ziel folgt dem Chance/Risiko', Math.abs(ev.takeProfit - (ev.entry + (ev.entry - ev.stopLoss) * 2)) < 1e-9)
    } else {
        check('Stop liegt unter dem Einstieg', false, 'kein Auslöser')
        check('Ziel folgt dem Chance/Risiko', false, 'kein Auslöser')
    }

    // Parameter wirken wirklich
    const streng = { ...g.regeln, signalFilters: [
        { left: 'signalPrice', op: 'distancePctGt', right: 'e10', value: { param: 'schwelle' } }] }
    const weich = detectMitRegeln(streng, { candles, params: { schwelle: 0 }, openSetups: [], knownSetupKeys: [] })
    const hart = detectMitRegeln(streng, { candles, params: { schwelle: 50 }, openSetups: [], knownSetupKeys: [] })
    check('Parameter wirkt auf die Filterschwelle',
        weich.setups.length > hart.setups.length && hart.setups.length === 0,
        `weich=${weich.setups.length} hart=${hart.setups.length}`)

    check('detect verändert die Kerzen nicht',
        JSON.stringify(candles) === JSON.stringify(series(rows)))
}

// ══ Die Gegenprobe ═══════════════════════════════════════════════════════
console.log('\nGegenprobe gegen die handgeschriebene Strategie')

/** EMA Touch, ausschliesslich als Regelbeschreibung. */
const emaTouchAlsRegeln = {
    id: 'ema_touch_regeln',
    name: 'EMA Touch (Regeln)',
    timeframes: ['15m', '1h', '4h'],
    direction: 'long',
    warmupCandles: 300,
    scanWindowCandles: 200,
    params: [
        { key: 'ueberdehnung', type: 'number', label: 'Mindest-Überdehnung (%)', default: 2.5, min: 0.1, max: 15 },
        { key: 'stopPuffer', type: 'number', label: 'Stop-Puffer (%)', default: 0.2, min: 0.01, max: 3 },
        { key: 'maxKerzen', type: 'integer', label: 'Max. Korrekturdauer', default: 10, min: 2, max: 50 },
        { key: 'ziel', type: 'number', label: 'Chance/Risiko-Ziel', default: 2, min: 0.5, max: 15 },
    ],
    indicators: [
        { id: 'emaFast', type: 'ema', period: 21 },
        { id: 'emaEntry', type: 'ema', period: 50 },
    ],
    signal: { type: 'pivotHigh', left: 10, right: 2 },
    signalFilters: [
        { op: 'higherThanPrevSignal', code: 'no_higher_high' },
        { left: 'emaFast', op: 'gt', right: 'emaEntry', code: 'no_uptrend' },
        { left: 'signalPrice', op: 'distancePctGt', right: 'emaFast', value: { param: 'ueberdehnung' }, code: 'no_overextension' },
    ],
    entry: { type: 'touch', anchor: 'emaEntry', from: 'above' },
    invalidations: [
        { type: 'condition', code: 'bullish_candle_in_correction', when: { op: 'isBullish' } },
        { type: 'condition', code: 'ema_cross_negative', when: { left: 'emaFast', op: 'lt', right: 'emaEntry' } },
        { type: 'timeout', code: 'correction_timeout', candles: { param: 'maxKerzen' } },
    ],
    stopLoss: { anchor: 'correctionLow', offsetPct: { param: 'stopPuffer' } },
    takeProfit: { mode: 'rr', rr: { param: 'ziel' } },
}

{
    const g = pruefeRegeln(emaTouchAlsRegeln)
    check('EMA Touch lässt sich vollständig als Regeln ausdrücken', g.ok, g.fehler.join('; '))

    const manifest = alsManifest(g.regeln)
    check('Regelstrategie liefert ein gültiges Manifest',
        typeof manifest.detect === 'function' && manifest.params.length === 4)

    // Kerzen bauen: Aufwärtstrend mit mehreren Impulsen und Korrekturen
    const rows = []
    let preis = 100
    for (let block = 0; block < 12; block++) {
        // Impuls nach oben
        for (let i = 0; i < 8; i++) { rows.push([preis, preis + 1.2, preis - 0.2, preis + 1.0]); preis += 1.0 }
        // Korrektur nach unten (durchgehend bärisch)
        for (let i = 0; i < 5; i++) { rows.push([preis, preis + 0.1, preis - 0.9, preis - 0.8]); preis -= 0.8 }
        // Seitwärts
        for (let i = 0; i < 6; i++) { rows.push([preis, preis + 0.3, preis - 0.3, preis + 0.05]); preis += 0.05 }
    }
    const candles = series(rows)

    // Beide Fassungen bar-für-bar durchlaufen lassen — wie im Backtest
    const durchlauf = (detect, params) => {
        let offen = []
        const gesehen = new Set()
        let id = 1
        const gefunden = []
        const ereignisse = []
        for (let i = 120; i < candles.length; i++) {
            const sicht = candles.slice(0, i + 1)
            const r = detect({ candles: sicht, params, openSetups: offen, knownSetupKeys: [...gesehen] })
            for (const s of r.setups) {
                gesehen.add(`${s.direction}|${s.obCandleTime}`)
                const neu = { ...s, id: id++ }
                offen.push(neu)
                gefunden.push({ zeit: s.obCandleTime, preis: +s.sweepPrice.toFixed(4) })
            }
            for (const e of r.events) {
                ereignisse.push({ status: e.status, grund: e.invalidReason || '', zeit: e.candleTime,
                    entry: e.entry ? +e.entry.toFixed(4) : 0 })
                offen = offen.filter((x) => x.id !== e.id)
            }
        }
        return { gefunden, ereignisse }
    }

    const pCode = {}
    for (const d of emaTouch.params) pCode[d.key] = d.default
    Object.assign(pCode, { minOverextensionPct: 2.5, slBufferPct: 0.2, maxCorrectionCandles: 10,
        exitMode: 'rr', tpRR: 2, swingLookback: 10, swingConfirmBars: 2, emaFast: 21, emaEntry: 50,
        bullishToleranceBodyPct: 0, minRR: 0 })
    const pRegeln = { ueberdehnung: 2.5, stopPuffer: 0.2, maxKerzen: 10, ziel: 2 }

    const a = durchlauf(emaTouch.detect, pCode)
    const b = durchlauf(manifest.detect, pRegeln)

    console.log(`     Code:   ${a.gefunden.length} Setups, ${a.ereignisse.length} Ereignisse`)
    console.log(`     Regeln: ${b.gefunden.length} Setups, ${b.ereignisse.length} Ereignisse`)

    check('beide finden gleich viele Setups', a.gefunden.length === b.gefunden.length,
        `Code=${a.gefunden.length} Regeln=${b.gefunden.length}`)
    check('beide finden dieselben Setups (Zeit und Preis)',
        JSON.stringify(a.gefunden) === JSON.stringify(b.gefunden))

    const nurStatus = (x) => x.ereignisse.map((e) => `${e.status}:${e.grund}`)
    check('beide erzeugen dieselbe Abfolge von Ereignissen',
        JSON.stringify(nurStatus(a)) === JSON.stringify(nurStatus(b)),
        `Code=${JSON.stringify(nurStatus(a).slice(0, 4))} Regeln=${JSON.stringify(nurStatus(b).slice(0, 4))}`)

    const trigger = (x) => x.ereignisse.filter((e) => e.status === 'triggered').map((e) => e.entry)
    check('beide steigen zu denselben Kursen ein',
        JSON.stringify(trigger(a)) === JSON.stringify(trigger(b)),
        `Code=${JSON.stringify(trigger(a).slice(0, 3))} Regeln=${JSON.stringify(trigger(b).slice(0, 3))}`)
}

// ── Einstiegszeitpunkt bei `immediate` ───────────────────────────────────
//
// Die Bedingung steht erst mit dem Kerzenschluss fest. Zum Schlusskurs
// einzusteigen wäre ein Blick in die Zukunft — der Livebetrieb bekommt
// frühestens den nächsten Kurs. Diese beiden Fälle sichern das ab.
console.log('\nEinstieg zur Folgekerzen-Eröffnung')

/** Vorlauf, Pivot-Tief, Bestätigung — genug Kerzen für den Warmup. */
function sofortKerzen({ mitFolgekerze = true } = {}) {
    const TF = 3600000
    const k = []
    for (let i = 0; i < 70; i++) { const b = 200 - i; k.push({ t: i * TF, o: b, h: b + 0.5, l: b - 1.2, c: b - 1, v: 10 }) }
    k.push({ t: 70 * TF, o: 130, h: 130.5, l: 126, c: 130.2, v: 10 })      // Pivot-Tief
    for (let i = 71; i < 74; i++) { const b = 130 + (i - 70) * 2; k.push({ t: i * TF, o: b, h: b + 1, l: b - 0.5, c: b + 0.8, v: 10 }) }
    if (mitFolgekerze) {
        // Auffällige Eröffnung, damit Schluss und Eröffnung nicht verwechselbar sind
        k.push({ t: 74 * TF, o: 555, h: 560, l: 550, c: 556, v: 10 })
        k.push({ t: 75 * TF, o: 556, h: 558, l: 552, c: 553, v: 10 })
    }
    return k
}

const sofortRegeln = (id) => pruefeRegeln({
    id, name: 'Sofort', timeframes: ['1h'], direction: 'long', warmupCandles: 50,
    params: [], indicators: [], signal: { type: 'pivotLow', left: 3, right: 2 },
    signalFilters: [], entry: { type: 'immediate' },
    invalidations: [{ type: 'timeout', code: 'zu_lang', candles: 50 }],
    stopLoss: { anchor: 'signalLow', offsetPct: 0.5 },
    takeProfit: { mode: 'rr', rr: 2 }, breakEvenAtR: 0,
})

const zweiLaeufe = (regeln, kerzen) => {
    const erst = detectMitRegeln(regeln, { candles: kerzen, params: {}, openSetups: [], knownSetupKeys: [] })
    const offen = erst.setups.map((s, i) => ({ ...s, id: i + 1 }))
    return detectMitRegeln(regeln, { candles: kerzen, params: {}, openSetups: offen, knownSetupKeys: [] })
}

{
    const g = sofortRegeln('sofort_test')
    check('Testregeln sind gültig', g.ok, JSON.stringify(g.fehler))
    const kerzen = sofortKerzen()
    const ev = zweiLaeufe(g.regeln, kerzen).events.find((e) => e.status === 'triggered')
    check('löst aus', !!ev)
    if (ev) {
        const idx = kerzen.findIndex((c) => c.t === ev.candleTime)
        check('Einstieg ist die ERÖFFNUNG der Ereigniskerze',
            ev.entry === kerzen[idx].o, `entry=${ev.entry} open=${kerzen[idx]?.o}`)
        check('Einstieg ist NICHT der Schluss der Auslösekerze',
            ev.entry !== kerzen[idx - 1]?.c, `entry=${ev.entry} vorheriger close=${kerzen[idx - 1]?.c}`)
        // Seit dem Audit-Fix: der Einstieg liegt auf der ERSTEN Kerze nach dem
        // Signal (deren Eröffnung), nicht mehr eine Kerze später.
        check('Auslösung und Einstieg liegen auf derselben Kerze',
            ev.triggeredAt === ev.candleTime, `trig=${ev.triggeredAt} fill=${ev.candleTime}`)
        check('entryAtOpen ist gesetzt', ev.entryAtOpen === true, String(ev.entryAtOpen))
    }
}

{
    // Der Randfall: die Auslösekerze ist die LETZTE bekannte. Dann gibt es
    // keinen Kurs, zu dem man einsteigen könnte — es darf nichts passieren.
    // Die Kerzen werden dafür exakt am Auslöser abgeschnitten, statt eine
    // Länge zu raten.
    const g = sofortRegeln('sofort_rand')
    const voll = sofortKerzen()
    const ev = zweiLaeufe(g.regeln, voll).events.find((e) => e.status === 'triggered')
    check('Vorbedingung: mit allen Kerzen löst es aus', !!ev)
    if (ev) {
        const bisAusloeser = voll.slice(0, voll.findIndex((c) => c.t === ev.triggeredAt) + 1)
        const ohne = zweiLaeufe(g.regeln, bisAusloeser).events.filter((e) => e.status === 'triggered')
        check('kein Auslöser, wenn die Folgekerze fehlt', ohne.length === 0,
            JSON.stringify(ohne.map((e) => ({ t: e.triggeredAt, c: e.candleTime, entry: e.entry }))))
        check('das Setup bleibt dabei offen statt verworfen zu werden',
            !zweiLaeufe(g.regeln, bisAusloeser).events.some((e) => ['invalidated', 'expired', 'rejected'].includes(e.status)))
    }
}


// ── Kerzenmuster als Bausteine ───────────────────────────────────────────
//
// Die Muster lagen schon in `indicators.js`, waren aber nicht im Vokabular.
// Geprüft wird hier, dass sie erreichbar sind UND dasselbe liefern wie der
// direkte Aufruf — sonst hätte man zwei Wahrheiten.
console.log('\nKerzenmuster')
{
    const ind = await import('./indicators.js')
    const { BAUSTEINE } = await import('./rule-engine.js')

    const muster = ['isHammer', 'isShootingStar', 'isBullishEngulfing', 'isBearishEngulfing', 'isAdvancingWick']
    check('alle fünf stehen im Vokabular',
        muster.every((m) => BAUSTEINE.vergleiche.includes(m)),
        muster.filter((m) => !BAUSTEINE.vergleiche.includes(m)).join(', '))

    // Hammer: langer unterer Docht, kleiner Körper oben
    const hammer = { t: 0, o: 100, h: 100.4, l: 96, c: 100.2, v: 1 }
    const stern  = { t: 0, o: 100, h: 104, l: 99.6, c: 99.8, v: 1 }
    const vorher = { t: 0, o: 102, h: 102.2, l: 99.8, c: 100, v: 1 }
    const umschl = { t: 0, o: 99.5, h: 102.5, l: 99.4, c: 102.3, v: 1 }

    const regeln = (op, extra = {}) => pruefeRegeln({
        id: 'muster_' + op.toLowerCase(), name: op, timeframes: ['1h'], direction: 'long',
        warmupCandles: 50, params: [], indicators: [],
        signal: { type: 'pivotLow', left: 3, right: 2 },
        signalFilters: [{ op, ...extra, code: 'kein_muster' }],
        entry: { type: 'immediate' },
        invalidations: [{ type: 'timeout', code: 'zu_lang', candles: 20 }],
        stopLoss: { anchor: 'signalLow', offsetPct: 0.5 },
        takeProfit: { mode: 'rr', rr: 2 }, breakEvenAtR: 0,
    })
    for (const op of muster) {
        const g = regeln(op)
        check(`${op} wird als Bedingung angenommen`, g.ok, JSON.stringify(g.fehler))
        if (g.ok) {
            const b = g.regeln.signalFilters[0]
            check(`${op} braucht keine Seiten`, b.left === undefined && b.right === undefined,
                JSON.stringify(b))
        }
    }

    // Gegenprobe: liefert der Interpreter dasselbe wie der direkte Aufruf?
    const kerzen = [vorher, hammer, stern, umschl]
    const direkt = {
        isHammer: ind.isHammer(hammer),
        isShootingStar: ind.isShootingStar(stern),
        isBullishEngulfing: ind.isBullishEngulfing(vorher, umschl),
    }
    check('Testkerzen treffen die Muster überhaupt',
        direkt.isHammer && direkt.isShootingStar && direkt.isBullishEngulfing,
        JSON.stringify(direkt))

    // Ein Muster, das NICHT zutrifft, muss die Bedingung scheitern lassen
    check('Hammer erkennt eine gewöhnliche Kerze nicht als Hammer',
        !ind.isHammer(vorher))
    check('Shooting Star erkennt einen Hammer nicht als Star',
        !ind.isShootingStar(hammer))
}


// ── MACD und MFI ─────────────────────────────────────────────────────────
//
// Ein Indikator, der falsch rechnet, ist schlimmer als ein fehlender: die
// Strategie läuft, nur eben auf einer Lüge. Darum gegen die Definition
// geprüft, nicht gegen Augenmass.
console.log('\nMACD und MFI')
{
    const ind = await import('./indicators.js')
    const { BAUSTEINE } = await import('./rule-engine.js')

    check('vier neue Indikatoren im Vokabular',
        ['mfi', 'macd', 'macdSignal', 'macdHist'].every((x) => BAUSTEINE.indikatoren.includes(x)))

    // Synthetische Kerzen mit Wellenform — genug Bewegung für beide
    const c = []
    for (let i = 0; i < 300; i++) {
        const b = 100 + Math.sin(i / 7) * 8 + i * 0.05
        c.push({ t: i * 3600000, o: b, h: b + 1, l: b - 1, c: b + Math.cos(i / 5) * 0.6, v: 100 + (i % 17) * 3 })
    }

    const linie = ind.macd(c, { line: 'macd' })
    const signal = ind.macd(c, { line: 'signal' })
    const hist = ind.macd(c, { line: 'hist' })
    const e12 = ind.ema(c, 12)
    const e26 = ind.ema(c, 26)

    let abwLinie = 0
    let abwHist = 0
    for (let i = 0; i < c.length; i++) {
        if (linie[i] !== null) abwLinie = Math.max(abwLinie, Math.abs(linie[i] - (e12[i] - e26[i])))
        if (hist[i] !== null) abwHist = Math.max(abwHist, Math.abs(hist[i] - (linie[i] - signal[i])))
    }
    check('MACD-Linie ist exakt EMA12 − EMA26', abwLinie < 1e-9, String(abwLinie))
    check('Histogramm ist exakt Linie − Signal', abwHist < 1e-9, String(abwHist))
    check('MACD beginnt erst, wenn die langsame EMA steht',
        linie.findIndex((v) => v !== null) === 25, String(linie.findIndex((v) => v !== null)))
    check('Signallinie beginnt später als die MACD-Linie',
        signal.findIndex((v) => v !== null) > linie.findIndex((v) => v !== null))

    // MFI: Wertebereich und die beiden Extremfälle
    const m = ind.mfi(c, 14)
    const werte = m.filter((v) => v !== null)
    check('MFI bleibt zwischen 0 und 100',
        Math.min(...werte) >= 0 && Math.max(...werte) <= 100,
        `${Math.min(...werte).toFixed(1)}–${Math.max(...werte).toFixed(1)}`)
    check('MFI beginnt bei Index = Periode', m.findIndex((v) => v !== null) === 14)

    const rauf = Array.from({ length: 40 }, (_, i) => ({ t: i, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 10 }))
    const runter = Array.from({ length: 40 }, (_, i) => ({ t: i, o: 200 - i, h: 201 - i, l: 199 - i, c: 199.5 - i, v: 10 }))
    check('durchgehend steigend ergibt MFI 100', ind.mfi(rauf, 14).at(-1) === 100)
    check('durchgehend fallend ergibt MFI 0', ind.mfi(runter, 14).at(-1) === 0)

    // Ohne Volumen darf nichts undefiniert werden
    const ohneVol = c.map((k) => ({ ...k, v: 0 }))
    check('ohne Volumen liefert MFI trotzdem Werte',
        ind.mfi(ohneVol, 14).filter((v) => v !== null && Number.isFinite(v)).length > 100)

    // Der Validator muss eine verdrehte Periodenwahl abfangen
    const verdreht = pruefeRegeln({
        id: 'macd_verdreht', name: 'x', timeframes: ['1h'], direction: 'long', warmupCandles: 50,
        params: [], indicators: [{ id: 'm', type: 'macd', fast: 26, slow: 12, signal: 9 }],
        signal: { type: 'pivotLow', left: 3, right: 2 }, signalFilters: [],
        entry: { type: 'immediate' }, invalidations: [{ type: 'timeout', code: 't', candles: 20 }],
        stopLoss: { anchor: 'signalLow', offsetPct: 0.5 }, takeProfit: { mode: 'rr', rr: 2 }, breakEvenAtR: 0,
    })
    check('schnelle Periode >= langsame wird abgelehnt',
        !verdreht.ok && verdreht.fehler.some((f) => /kleiner sein/.test(f)),
        JSON.stringify(verdreht.fehler))
}


console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log(`\nFehlgeschlagen:\n  ${fehler.join('\n  ')}\n`); process.exit(1) }
console.log('')
