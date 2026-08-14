/**
 * Selbsttest der Indikatoren, die der Regel-Interpreter anbietet.
 *
 * Ein falsch gerechneter Indikator fällt in keinem Backtest auf — das Ergebnis
 * sieht plausibel aus, ist aber eine andere Strategie als die beschriebene.
 * Deshalb hier synthetische Reihen mit von Hand nachrechenbaren Erwartungen.
 *
 *   node server/strategies/__selftest-indicators.mjs
 */

import { bollinger, adx, stochastic } from './indicators.js'

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

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen\n`)
process.exit(failed ? 1 : 0)
