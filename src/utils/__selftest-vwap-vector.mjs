/**
 * Selbsttest „Mo's VWAP Vector" (Rechnung, ohne Chart).
 *
 *   node src/utils/__selftest-vwap-vector.mjs
 *
 * Die Fallen dieses Indikators liegen in der Zeit: eine MTF-EMA, die die
 * laufende höhere Kerze schon als fertig behandelt, sieht in die Zukunft; ein
 * naked POC, den die Kerze seiner Entstehung gleich wieder „abholt", wäre nie
 * sichtbar; eine Zone, die auf der laufenden Kerze entsteht, flackert. Zu
 * jeder Regel steht die Gegenprobe daneben.
 */
import {
    pvsra, emaHoehereTf, periodenPoc, vektorZonen, swingFaecher, dochtLevel, dailyOpen, engulfing, zigzag,
    candlePocs, periodeVon, rechneVwapVector,
} from './chart/vwapVector.js'
import { swingAnker, ema, atr } from '../../shared/indicators.js'
import { vorgaben, rechneIndikator, ausgabenVon, vwapVectorQuellen, saubereParams } from './chart/indikatorRegister.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const H = 3_600_000
const T0 = Date.UTC(2026, 9, 5)     // Montag, 00:00 UTC
const k = (i, o, h, l, c, v = 100) => ({ t: T0 + i * H, o, h, l, c, v })

console.log('\nPVSRA\n')
{
    const reihe = Array.from({ length: 12 }, (_, i) => k(i, 100, 101, 99, 100.5, 100))
    reihe.push(k(12, 100, 101, 99, 100.5, 250))     // 2,5× → climax
    reihe.push(k(13, 100.5, 101, 99, 100, 200))     // 200 / Ø 125 = 1,6× → rising, fallend (Ø enthält die Climax-Kerze)
    const s = pvsra(reihe, { len: 10, climaxMult: 2, risingMult: 1.5 })
    check('2,5-faches Volumen ist Climax', s[12].stufe === 'climax' && s[12].bull)
    check('~1,5-faches Volumen ist Rising, fallend', s[13].stufe === 'rising' && !s[13].bull, JSON.stringify(s[13]))
    check('vor dem ersten Durchschnitt: neutral statt Climax', s[3].stufe === 'neutral')
    const weit = [...Array.from({ length: 12 }, (_, i) => k(i, 100, 101, 99, 100, 100)), k(12, 100, 110, 90, 105, 120)]
    check('weite Kerze mit wenig Mehrvolumen: Climax über Volumen × Spanne', pvsra(weit)[12].stufe === 'climax')
}

console.log('\nMTF-EMA (kein Blick in die Zukunft)\n')
{
    const D = 24 * H
    // 30 Tageskerzen, Schluss = Index
    const tage = Array.from({ length: 30 }, (_, i) => ({ t: T0 - 30 * D + i * D, o: i, h: i, l: i, c: i, v: 1 }))
    const e = ema(tage, 5)
    // Chartkerzen (1h) über die letzten zwei Tage: Tag 28 und der laufende Tag 29
    const chart = Array.from({ length: 48 }, (_, i) => ({ t: T0 - 2 * D + i * H, o: 50, h: 50, l: 50, c: 50, v: 1 }))
    const m = emaHoehereTf(chart, tage, 5, D, H)
    // Kerze 0 liegt in Tag 28, der erst mit Kerze 23 schliesst → laufend, Basis = Tag 27
    const a = 2 / 6
    check('historische Kerze im laufenden Tag: EMA von gestern (Treppe wie im Pine)', Math.abs(m[0] - e[27]) < 1e-9, `${m[0]} vs ${e[27]}`)
    check('Treppe: alle Stunden von Tag 28 vor seinem Schluss tragen denselben Wert', m.slice(0, 23).every((x) => Math.abs(x - e[27]) < 1e-9))
    // Chart endet eine Stunde vor Schluss von Tag 29: die letzte Kerze ist Echtzeit
    const live = emaHoehereTf(chart.slice(0, 47), tage, 5, D, H)
    check('letzte Chartkerze (Echtzeit) im laufenden Tag 29: vorläufiger Schluss eingerechnet',
        Math.abs(live[46] - (e[28] + a * (50 - e[28]))) < 1e-9, `${live[46]} vs ${e[28]}`)
    check('Gegenprobe: dieselbe Kerze historisch (Chart geht weiter) bleibt auf der Stufe', Math.abs(m[46] - e[28]) < 1e-9)
    check('Gegenprobe: vorletzte Kerze im Echtzeit-Fall bleibt auf der Stufe', Math.abs(live[45] - e[28]) < 1e-9)
    check('letzte Stunde des Tages: der Tag ist fertig → EMA genau dieses Tages', Math.abs(m[23] - e[28]) < 1e-9, `${m[23]} vs ${e[28]}`)
    check('Gegenprobe: NICHT schon die EMA des laufenden Tages vor seinem Schluss', Math.abs(m[0] - e[28]) > 1e-6)
    check('zu wenig höhere Kerzen → null statt Fantasiewert', emaHoehereTf(chart, tage.slice(0, 3), 5, D, H).every((x) => x === null))
}

console.log('\nPerioden-POC (naked)\n')
{
    // Tag 1: Volumen bei 100; Tag 2 bleibt darüber, Tag 3 läuft durch 100
    const r = []
    for (let i = 0; i < 24; i++) r.push(k(i, 100, 100.5, 99.5, 100, i === 12 ? 5000 : 100))
    for (let i = 24; i < 48; i++) r.push(k(i, 105, 106, 104, 105))
    const offen = periodenPoc(r, { tf: '1d', bins: 20, max: 20 })
    check('POC von Tag 1 bei ~100 steht, solange Tag 2 ihn nicht berührt', offen.length >= 1 && Math.abs(offen[0].preis - 100) < 0.5, JSON.stringify(offen))
    const r3 = [...r]
    for (let i = 48; i < 52; i++) r3.push(k(i, 101, 101, 99, 100))
    check('eine spätere Kerze durch das Level holt es ab', !periodenPoc(r3, { tf: '1d', bins: 20 }).some((l) => Math.abs(l.preis - 100) < 0.5))
    const beruehrt = []
    for (let i = 0; i < 24; i++) beruehrt.push(k(i, 100, 100.5, 99.5, 100))
    beruehrt.push(k(24, 100, 101, 99, 100))
    check('berührt schon die erste Kerze der neuen Periode → gar nicht erst „naked"', periodenPoc(beruehrt, { tf: '1d' }).length === 0)
    check('Woche beginnt Montag (UTC)', periodeVon(T0, '1w') !== periodeVon(T0 - 1, '1w') && periodeVon(T0, '1w') === periodeVon(T0 + 6 * 24 * H, '1w'))
}

console.log('\nVektorkerzen-Zonen\n')
{
    const r = Array.from({ length: 12 }, (_, i) => k(i, 100, 101, 99, 100.2, 100))
    r.push(k(12, 100, 106, 100, 105, 1000))        // Climax bull, Körper 100–105
    r.push(k(13, 107, 108, 103, 107.5, 100))       // taucht bis 103 ein
    r.push(k(14, 107, 109, 106.5, 108, 100))       // laufend
    const z = vektorZonen(r, pvsra(r), { nurClimax: true, nurKoerper: true })
    check('Demand-Zone wird von oben angefressen (Oberkante → Tief der Folgekerze)', z.length === 1 && z[0].oben === 103 && z[0].unten === 100, JSON.stringify(z))
    r.push(k(15, 101, 102, 99.5, 100, 100))
    check('komplett durchlaufen → abgeholt', vektorZonen(r, pvsra(r), {}).every((x) => x.von !== 12))
    const lauf = [...Array.from({ length: 12 }, (_, i) => k(i, 100, 101, 99, 100.2, 100)), k(12, 100, 106, 100, 105, 1000)]
    check('Gegenprobe: auf der LAUFENDEN Kerze entsteht keine Zone', vektorZonen(lauf, pvsra(lauf), {}).length === 0)
}

console.log('\nSwing-Fächer\n')
{
    const r = []
    for (let i = 0; i < 120; i++) {
        const x = 100 + 10 * Math.sin(i / 8)
        r.push(k(i, x, x + 1, x - 1, x + 0.2, 100 + (i % 5) * 10))
    }
    const f = swingFaecher(r, { seite: 'high', staerke: 5, anzahl: 2, minSepAtr: 0 })
    const anker = swingAnker(r, { seite: 'high', staerke: 5, nth: 1, minSepAtr: 0 })[119]
    check('jüngste Linie beginnt genau am Anker aus shared/indicators', f[0]?.anker === anker, `${f[0]?.anker} vs ${anker}`)
    check('vor dem Anker keine Werte, am Anker der typische Preis', f[0].werte[anker - 1] === null && Math.abs(f[0].werte[anker] - (r[anker].h + r[anker].l + r[anker].c) / 3) < 1e-9)
}

console.log('\nCandle-POC und Docht-Level\n')
{
    // Eine Stunde aus 60 Minutenkerzen; Volumen sitzt bei 104
    const kerze = k(0, 100, 105, 99, 101)
    const intra = Array.from({ length: 60 }, (_, m) => ({ t: T0 + m * 60_000, h: m === 30 ? 104.1 : 100.1, l: m === 30 ? 103.9 : 99.9, v: m === 30 ? 900 : 1 }))
    const poc = candlePocs([kerze], intra, H, 25)[0]
    check('POC liegt beim Intrabar-Volumen (~104)', Math.abs(poc - 104) < 0.3, String(poc))
    check('ohne Intrabar-Daten kein POC (statt eines erfundenen)', candlePocs([kerze], [], H)[0] === null)
    // Pivot-Hoch mit POC im oberen Docht
    const r = [k(0, 100, 101, 99, 100), k(1, 100, 102, 99, 101), k(2, 101, 110, 100, 102), k(3, 102, 103, 100, 101), k(4, 101, 102, 99, 100), k(5, 100, 101, 99, 100)]
    const pocs = [null, null, 107, null, null, null]
    const d = dochtLevel(r, pocs, { staerke: 2 })
    check('Pivot-Hoch mit POC im oberen Docht → Docht-Level', d.length === 1 && d[0].preis === 107)
    check('Gegenprobe: POC im Körper → kein Level', dochtLevel(r, [null, null, 101.5, null, null, null], { staerke: 2 }).length === 0)
}

console.log('\nEngulfing, Daily Open, ZigZag\n')
{
    const a = new Array(4).fill(1)
    const r = [k(0, 101, 101.5, 99.5, 100), k(1, 99.8, 103, 99.5, 102.5), k(2, 102, 102, 100, 100.5), k(3, 100, 104, 100, 103.5)]
    const st = pvsra(r)
    const e = engulfing(r, { minKoerperAtr: 1, stufen: st, a })
    check('bullisches Engulfing erkannt', e.some((x) => x.i === 1 && x.seite === 'bull'), JSON.stringify(e))
    check('Gegenprobe: die laufende letzte Kerze meldet nichts', !e.some((x) => x.i === 3))
    check('Daily Open = Eröffnung der ersten Kerze des Tages', dailyOpen([k(0, 100, 101, 99, 100), k(1, 100.5, 101, 99, 100)])?.preis === 100)
    check('Reihe beginnt mitten im Tag → kein Daily Open', dailyOpen([{ ...k(0, 100, 101, 99, 100), t: T0 + 5 * H }]) === null)
    const zz = []
    for (let i = 0; i < 40; i++) zz.push(k(i, 100 + i, 101 + i, 99 + i, 100 + i))
    for (let i = 40; i < 80; i++) zz.push(k(i, 140 - (i - 40), 141 - (i - 40), 139 - (i - 40), 140 - (i - 40)))
    check('ZigZag findet das Hoch des Beins', zigzag(zz, 3).piv1 === 141 - 1 || zigzag(zz, 3).piv1 >= 139, JSON.stringify(zigzag(zz, 3)))
}

console.log('\nRegister\n')
{
    const p = vorgaben('vwapVector')
    check('Vorgaben wie im Pine: Swing-VWAPs, EMA 21/50/200, MTF 1+2 an; Daily/ATH aus', p.showSwingHi && p.showEma21 && p.showMtfE2 && !p.showDaily && !p.showATH && !p.showFib)
    check('Ausgaben nur für eingeschaltete Linien', ausgabenVon('vwapVector', p).map((x) => x.key).join() === 'ema21,ema50,ema200,mtf1,mtf2')
    check('Schalter und Farben werden gesäubert', saubereParams('vwapVector', { showDaily: 'ja', cDaily: 'rot' }).showDaily === false && saubereParams('vwapVector', { cDaily: 'rot' }).cDaily === '#70ccbd')
    const q = vwapVectorQuellen(p, H, { '1m': 60_000, '1h': H, '1d': 24 * H, '4h': 4 * H })
    check('Nachladen: 1d für MTF, 1m für Candle-POC', q.htf.join() === '1d' && q.intra === '1m')
    check('auf dem Tageschart keine „höhere" Zeiteinheit 1d', vwapVectorQuellen(p, 24 * H, { '1m': 60_000, '1d': 24 * H }).htf.length === 0)
    const r = Array.from({ length: 300 }, (_, i) => k(i, 100 + Math.sin(i / 7) * 3, 101 + Math.sin(i / 7) * 3, 99 + Math.sin(i / 7) * 3, 100 + Math.sin((i + 1) / 7) * 3, 100 + (i % 9) * 40))
    const w = rechneIndikator('vwapVector', r, p, {})
    check('ohne nachgeladene Kerzen: MTF-Linien leer, Rest gerechnet', w.mtf1.every((x) => x === null) && w.ema21[299] != null && w._vv.stufen.length === 300)
    check('ATR für den POC-Abstandsfilter vorhanden', Number.isFinite(w._vv.atrLetzte) && w._vv.atrLetzte === atr(r, 14)[299])
    check('rechneVwapVector ohne Kerzen bricht nicht', rechneVwapVector([], p, {}).n === 0)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
