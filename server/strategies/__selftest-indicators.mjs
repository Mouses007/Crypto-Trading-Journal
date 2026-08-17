/**
 * Selbsttest der Indikatoren, die der Regel-Interpreter anbietet.
 *
 * Ein falsch gerechneter Indikator fällt in keinem Backtest auf — das Ergebnis
 * sieht plausibel aus, ist aber eine andere Strategie als die beschriebene.
 * Deshalb hier synthetische Reihen mit von Hand nachrechenbaren Erwartungen.
 *
 *   node server/strategies/__selftest-indicators.mjs
 */

import {
    bollinger, adx, stochastic,
    vwap, vwapBand, ankerStarts, ankerSichtKerzen, swingAnker, volumeSma, dayOpen,
} from './indicators.js'

let passed = 0
let failed = 0
const nah = (a, b, eps = 1e-6) => a !== null && a !== undefined && Math.abs(a - b) < eps

function check(name, ok, detail) {
    if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const flach = (c, n) => Array.from({ length: n }, () => ({ o: c, h: c, l: c, c, t: 0 }))
const rampe = (n) => Array.from({ length: n }, (_, i) => ({ o: i + 1, h: i + 1, l: i + 1, c: i + 1, t: 0 }))

console.log('\nBollinger')

{
    const b = bollinger(flach(100, 30), { period: 20, mult: 2 })
    check('konstante Reihe → Bänder liegen auf der Basis',
        nah(b.middle[25], 100) && nah(b.upper[25], 100) && nah(b.lower[25], 100),
        `${b.middle[25]}/${b.upper[25]}/${b.lower[25]}`)
}

{
    // 1..20: Mittel 10,5; Standardabweichung der Grundgesamtheit √33,25
    const b = bollinger(rampe(20), { period: 20, mult: 2 })
    const sd = Math.sqrt(33.25)
    check('1..20 → Mittel 10,5 und Bänder bei ±2σ',
        nah(b.middle[19], 10.5, 1e-9) && nah(b.upper[19], 10.5 + 2 * sd, 1e-9) && nah(b.lower[19], 10.5 - 2 * sd, 1e-9),
        `mid=${b.middle[19]} up=${b.upper[19]}`)
}

{
    // Nach einem Sprung muss die EMA-Basis näher am neuen Kurs liegen als die SMA-Basis.
    // Bei einer LINEAREN Reihe wäre das kein Test: dort haben beide dieselbe
    // Verzögerung von (n−1)/2 und liefern identische Werte.
    const sprung = [...flach(100, 30), ...flach(200, 10)]
    const s = bollinger(sprung, { period: 20, mult: 2, basis: 'sma' })
    const e = bollinger(sprung, { period: 20, mult: 2, basis: 'ema' })
    check('EMA-Basis reagiert schneller als SMA-Basis',
        e.middle[39] > s.middle[39] && nah(s.middle[39], 150, 1e-9),
        `sma=${s.middle[39]} ema=${e.middle[39]}`)
}

{
    const b = bollinger(flach(100, 10), { period: 20 })
    check('zu wenige Kerzen → durchgehend null', b.middle.every((v) => v === null))
}

console.log('\nStochastik')

{
    // Schluss jeweils am Hoch der Kerze und der Reihe → %K = 100
    const auf = Array.from({ length: 20 }, (_, i) => ({ o: i, h: i + 2, l: i, c: i + 2, t: 0 }))
    const s = stochastic(auf, { period: 14, smoothK: 1, smoothD: 3 })
    check('Schluss am Hoch → %K = 100', nah(s.k[19], 100, 1e-9), String(s.k[19]))
}

{
    const ab = Array.from({ length: 20 }, (_, i) => ({ o: 30 - i, h: 30 - i + 2, l: 30 - i, c: 30 - i, t: 0 }))
    const s = stochastic(ab, { period: 14, smoothK: 1, smoothD: 3 })
    check('Schluss am Tief → %K = 0', nah(s.k[19], 0, 1e-9), String(s.k[19]))
}

{
    const s = stochastic(flach(100, 30), { period: 14, smoothK: 1, smoothD: 3 })
    check('ohne Spanne → neutrale 50 statt Division durch null', nah(s.k[20], 50), String(s.k[20]))
}

{
    const auf = Array.from({ length: 40 }, (_, i) => ({ o: i, h: i + 2, l: i, c: i + 2, t: 0 }))
    const schnell = stochastic(auf, { period: 14, smoothK: 1, smoothD: 3 })
    const langsam = stochastic(auf, { period: 14, smoothK: 3, smoothD: 3 })
    check('%D ist geglättetes %K und startet später',
        schnell.d[39] !== null && langsam.k[39] !== null && langsam.k.findIndex((v) => v !== null) > schnell.k.findIndex((v) => v !== null))
}

console.log('\nADX')

{
    const trend = Array.from({ length: 80 }, (_, i) => ({ o: 100 + i * 2, h: 100 + i * 2 + 1, l: 100 + i * 2 - 1, c: 100 + i * 2, t: 0 }))
    const a = adx(trend, 14)
    check('sauberer Aufwärtstrend → +DI dominiert, ADX hoch',
        a.plusDI[70] > a.minusDI[70] && a.adx[70] > 50,
        `+DI=${a.plusDI[70]?.toFixed(1)} −DI=${a.minusDI[70]?.toFixed(1)} ADX=${a.adx[70]?.toFixed(1)}`)
}

{
    const ab = Array.from({ length: 80 }, (_, i) => ({ o: 300 - i * 2, h: 300 - i * 2 + 1, l: 300 - i * 2 - 1, c: 300 - i * 2, t: 0 }))
    const a = adx(ab, 14)
    check('Abwärtstrend → −DI dominiert',
        a.minusDI[70] > a.plusDI[70] && a.adx[70] > 50,
        `+DI=${a.plusDI[70]?.toFixed(1)} −DI=${a.minusDI[70]?.toFixed(1)}`)
}

{
    const seit = Array.from({ length: 80 }, (_, i) => ({
        o: 100, h: 101 + (i % 2), l: 99 - (i % 2), c: 100 + (i % 2 ? 0.5 : -0.5), t: 0,
    }))
    const a = adx(seit, 14)
    check('Seitwärtsmarkt → ADX klein', a.adx[70] !== null && a.adx[70] < 30, String(a.adx[70]?.toFixed(1)))
}

{
    const a = adx(flach(100, 20), 14)
    check('zu wenige Kerzen → durchgehend null', a.adx.every((v) => v === null))
}

console.log('\nVWAP-Anker')

// 2024-01-01 war ein Montag — Basis für die Wochen-/Monatsprüfungen.
const MONTAG = Date.UTC(2024, 0, 1)
const TAG = 86400000

/** Kerzen mit echten Zeitstempeln; `preise` je Kerze, Volumen wahlweise. */
const zeitreihe = (preise, schrittMs, t0 = MONTAG, vol = null) => preise.map((p, i) => ({
    t: t0 + i * schrittMs,
    o: p, h: p, l: p, c: p,
    v: vol ? vol[i] : 100,
}))

{
    // Vier Kerzen je Tag (6h), zwei Tage: der Abschnitt muss an Kerze 4 neu beginnen
    const c = zeitreihe([1, 2, 3, 4, 5, 6, 7, 8], TAG / 4)
    const s = ankerStarts(c, { anchor: 'session' })
    check('Tagesanker setzt zum UTC-Tageswechsel zurück',
        JSON.stringify(s) === JSON.stringify([0, 0, 0, 0, 4, 4, 4, 4]), JSON.stringify(s))
}

{
    // Tageskerzen ab Montag: die zweite Woche beginnt an Kerze 7
    const c = zeitreihe(Array.from({ length: 10 }, (_, i) => i + 1), TAG)
    const s = ankerStarts(c, { anchor: 'week' })
    check('Wochenanker beginnt am Montag',
        JSON.stringify(s) === JSON.stringify([0, 0, 0, 0, 0, 0, 0, 7, 7, 7]), JSON.stringify(s))
}

{
    // 28.01. bis 06.02.: der Februar beginnt an Kerze 4. Der Januar-Teil davor
    // ist angeschnitten (die Reihe beginnt am 28.) und bleibt deshalb leer.
    const c = zeitreihe(Array.from({ length: 10 }, (_, i) => i + 1), TAG, Date.UTC(2024, 0, 28))
    const s = ankerStarts(c, { anchor: 'month' })
    check('Monatsanker beginnt am Monatsersten, der angeschnittene Vormonat bleibt leer',
        JSON.stringify(s) === JSON.stringify([null, null, null, null, 4, 4, 4, 4, 4, 4]), JSON.stringify(s))
}

{
    // Steigend bis Kerze 4, danach tiefer: der Anker bleibt auf dem Hoch stehen
    const c = zeitreihe([1, 2, 3, 4, 5, 4, 3, 2], TAG)
    const hoch = ankerStarts(c, { anchor: 'ath' })
    const tief = ankerStarts(c, { anchor: 'atl' })
    check('ATH-Anker springt auf jedes neue Hoch und bleibt dann stehen',
        JSON.stringify(hoch) === JSON.stringify([0, 1, 2, 3, 4, 4, 4, 4]), JSON.stringify(hoch))
    // Das Tief der ersten Kerze (1) wird nie unterboten — der Anker bleibt dort
    check('ATL-Anker bleibt stehen, solange kein neues Tief kommt',
        tief.every((v) => v === 0), JSON.stringify(tief))
    const fallend = ankerStarts(zeitreihe([5, 4, 3, 3, 3], TAG), { anchor: 'atl' })
    check('ATL-Anker springt auf jedes neue Tief',
        JSON.stringify(fallend) === JSON.stringify([0, 1, 2, 2, 2]), JSON.stringify(fallend))
}

{
    const c = zeitreihe([100, 100, 100, 100, 100, 100, 100, 100], TAG)
    const w = vwap(c, { anchor: 'week' })
    const b = vwapBand(c, { anchor: 'week', mult: 2 })
    check('konstante Reihe → Wochen-VWAP ist der Preis', w.every((v) => nah(v, 100)))
    check('konstante Reihe → Band liegt auf der Linie', b.every((v) => nah(v, 100)))
}

{
    // Am Ankerbar selbst ist der VWAP der typische Preis dieser Kerze
    const c = [
        { t: MONTAG, o: 100, h: 100, l: 100, c: 100, v: 10 },
        { t: MONTAG + TAG, o: 100, h: 130, l: 100, c: 130, v: 10 },
    ]
    const a = vwap(c, { anchor: 'ath' })
    check('ATH-VWAP startet am neuen Hoch beim typischen Preis dieser Kerze',
        nah(a[1], (130 + 100 + 130) / 3), String(a[1]))
}

{
    // Gewichtung nachrechenbar: zwei Kerzen, Volumen 1 und 3, im gleichen Tag
    const c = [
        { t: MONTAG, o: 10, h: 10, l: 10, c: 10, v: 1 },
        { t: MONTAG + 3600000, o: 20, h: 20, l: 20, c: 20, v: 3 },
    ]
    const s = vwap(c, { anchor: 'session' })
    check('Tages-VWAP gewichtet mit Volumen (10·1+20·3)/4 = 17,5', nah(s[1], 17.5), String(s[1]))
}

{
    // Pivot-Hoch bei Index 20 (Stärke 5): vorher kein Anker, ab Index 25 der Pivot
    const preise = Array.from({ length: 40 }, (_, i) => (i === 20 ? 200 : 100 - Math.abs(20 - i)))
    const c = zeitreihe(preise, TAG)
    const a = swingAnker(c, { seite: 'high', staerke: 5, nth: 1, minSepAtr: 0 })
    check('Swing-Anker ist vor der Bestätigung leer',
        a.slice(0, 25).every((v) => v === null), JSON.stringify(a.slice(18, 26)))
    check('Swing-Anker zeigt ab der Bestätigungskerze auf den Pivot',
        a[25] === 20 && a[30] === 20, `${a[25]}/${a[30]}`)
    check('nth = 2 bleibt leer, solange nur ein Anker existiert',
        swingAnker(c, { seite: 'high', staerke: 5, nth: 2, minSepAtr: 0 })[30] === null)
}

{
    // Zwei Pivot-Hochs, das zweite TIEFER: der ältere, höhere bleibt als
    // zweite Fächerlinie stehen (Leiter-Logik des Pine-Indikators)
    const preise = Array.from({ length: 60 }, (_, i) => {
        if (i === 15) return 300
        if (i === 40) return 200
        return 100
    })
    const c = zeitreihe(preise, TAG)
    const eins = swingAnker(c, { seite: 'high', staerke: 5, nth: 1, minSepAtr: 0 })
    const zwei = swingAnker(c, { seite: 'high', staerke: 5, nth: 2, minSepAtr: 0 })
    check('jüngster Anker ist das jüngere Hoch', eins[50] === 40, String(eins[50]))
    check('älterer, höherer Anker bleibt als zweite Fächerlinie', zwei[50] === 15, String(zwei[50]))
}

{
    // Dasselbe, aber das zweite Hoch ist HÖHER: der alte Anker wird verworfen
    const preise = Array.from({ length: 60 }, (_, i) => {
        if (i === 15) return 200
        if (i === 40) return 300
        return 100
    })
    const c = zeitreihe(preise, TAG)
    check('ein höheres Hoch verwirft den alten Anker',
        swingAnker(c, { seite: 'high', staerke: 5, nth: 2, minSepAtr: 0 })[50] === null)
}

{
    // Wachsendes Sichtfenster darf den Wert einer bereits geschlossenen Kerze
    // nicht ändern — sonst hätte der Backtest Wissen aus der Zukunft.
    const preise = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 10 + (i === 30 ? 40 : 0))
    const c = zeitreihe(preise, TAG)
    const voll = vwap(c, { anchor: 'swingHigh', pivot: 5, nth: 1, minSepAtr: 0 })
    let stabil = true
    for (let n = 40; n <= 80; n++) {
        const teil = vwap(c.slice(0, n), { anchor: 'swingHigh', pivot: 5, nth: 1, minSepAtr: 0 })
        const a = teil[n - 1]
        const b = voll[n - 1]
        if (a === null ? b !== null : !nah(a, b, 1e-9)) { stabil = false; break }
    }
    check('Swing-VWAP ist unter wachsendem Fenster stabil (kein Blick nach vorn)', stabil)
}

console.log('\nAnker im Ausschnitt (kein erfundener Anker)')

{
    // Reihe beginnt MITTEN im Tag (06:00) — der erste Tagesabschnitt ist
    // unvollständig und darf keine Linie liefern.
    const c = zeitreihe([1, 2, 3, 4, 5, 6], TAG / 4, MONTAG + TAG / 4)
    const s = ankerStarts(c, { anchor: 'session' })
    check('angeschnittener erster Tag → keine Linie',
        s[0] === null && s[1] === null && s[2] === null && s[3] === 3,
        JSON.stringify(s))
    check('… und der VWAP schweigt genauso',
        vwap(c, { anchor: 'session' }).slice(0, 3).every((v) => v === null))
}

{
    // Dieselbe Reihe, aber genau auf dem Tagesanfang: dann ist alles bekannt
    const c = zeitreihe([1, 2, 3, 4], TAG / 4, MONTAG)
    check('exakt am Tagesanfang beginnende Reihe ist vollständig',
        ankerStarts(c, { anchor: 'session' }).every((v) => v === 0))
}

{
    // Monat: eine Reihe, die am 15. beginnt, kann keinen Monats-VWAP liefern
    const c = zeitreihe(Array.from({ length: 10 }, (_, i) => 100 + i), TAG, Date.UTC(2024, 0, 15))
    const m = vwap(c, { anchor: 'month' })
    check('Monats-VWAP ohne Monatsanfang im Fenster bleibt leer',
        m.every((v) => v === null), JSON.stringify(m.slice(0, 3)))
    // Ab dem 1. Februar steht der Anker wieder — dort beginnt die Linie
    const lang = zeitreihe(Array.from({ length: 25 }, (_, i) => 100 + i), TAG, Date.UTC(2024, 0, 15))
    const m2 = vwap(lang, { anchor: 'month' })
    check('… und beginnt am nächsten Monatsersten',
        m2[16] === null && m2[17] !== null,
        `Index 17 = ${new Date(lang[17].t).toISOString().slice(0, 10)} → ${m2[17]}`)
}

{
    // ATH/ATL im Ausschnitt: nicht bestimmbar, also leer
    const c = zeitreihe([1, 2, 3, 4, 5], TAG)
    check('ATH-Anker im Ausschnitt liefert nichts',
        ankerStarts(c, { anchor: 'ath', verkuerzt: true }).every((v) => v === null))
    check('ATH-VWAP im Ausschnitt liefert nichts',
        vwap(c, { anchor: 'ath', verkuerzt: true }).every((v) => v === null))
    check('mit voller Historie rechnet derselbe Anker wieder',
        vwap(c, { anchor: 'ath' }).every((v) => v !== null))
}

{
    // Wie weit muss der Aufrufer zurücksehen?
    const ms15 = 900000
    check('Monatsanker verlangt auf 15m mehr als 3000 Kerzen',
        ankerSichtKerzen('month', ms15) > 3000, String(ankerSichtKerzen('month', ms15)))
    check('Wochenanker verlangt auf 15m gut 770 Kerzen',
        ankerSichtKerzen('week', ms15) === Math.ceil((8 * 86400000) / ms15))
    check('ATH verlangt die ganze Historie', ankerSichtKerzen('ath', ms15) === Infinity)
    check('gleitender Anker verlangt nichts Besonderes', ankerSichtKerzen('rolling', ms15) === 0)
}

console.log('\nVolumen und Tageseröffnung')

{
    const c = zeitreihe([1, 2, 3, 4, 5], TAG, MONTAG, [10, 20, 30, 40, 50])
    const v = volumeSma(c, 3)
    check('Volumen-SMA rechnet über die letzten n Kerzen',
        v[0] === null && v[1] === null && nah(v[2], 20) && nah(v[4], 40), JSON.stringify(v))
}

{
    const c = [
        { t: MONTAG, o: 100, h: 110, l: 90, c: 105, v: 1 },
        { t: MONTAG + 3600000, o: 105, h: 115, l: 95, c: 110, v: 1 },
        { t: MONTAG + TAG, o: 200, h: 210, l: 190, c: 205, v: 1 },
    ]
    const d = dayOpen(c)
    check('Tageseröffnung bleibt über den Tag konstant und wechselt am Tageswechsel',
        nah(d[0], 100) && nah(d[1], 100) && nah(d[2], 200), JSON.stringify(d))
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen\n`)
process.exit(failed ? 1 : 0)
