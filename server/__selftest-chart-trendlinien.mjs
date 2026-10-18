/**
 * Selbsttest: Trendlinien an den Kerzen prüfen.
 *
 *   node server/__selftest-chart-trendlinien.mjs
 *
 * Anlass (18.10.2026): die KI zog die BTC-Abwärtslinie vom absoluten Hoch,
 * und die Hochs danach lagen 476 USD darüber — eine Linie, durch die die
 * Kerzen wachsen, ist kein Widerstand.
 */
import { wendepunkte, pruefeTrend, besteTrendlinie, richteTrendAus } from './chart-trendlinien.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const H = 3600e3
const T0 = 1_760_000_000_000

/*
 * Wie BTC 4h am 18.10.2026: ein Top bei i = 8 (132), danach eine echte
 * Abwärtslinie y = 125 − 0,85·(i − 20) mit Hochs genau darauf bei 20, 40, 60;
 * alle übrigen Hochs 6 darunter. Die Linie der KI vom Top (8) durch das Hoch
 * bei 40 läuft bei 20 durch 123 — das Hoch dort (125) wächst hindurch.
 */
const linie = (i) => 125 - 0.85 * (i - 20)
function reihe() {
    const k = []
    for (let i = 0; i < 75; i++) {
        let h = linie(i) - 6
        if (i === 20 || i === 40 || i === 60) h = linie(i)
        if (i === 8) h = 132
        k.push({ t: T0 + i * H, o: h - 2, h, l: h - 3, c: h - 1 })
    }
    return k
}
const k = reihe()

console.log('\nWendepunkte\n')
{
    const pv = wendepunkte(k, 'hoch')
    check('die drei Linien-Hochs und das Top sind die Wendepunkte', JSON.stringify(pv) === '[8,20,40,60]', JSON.stringify(pv))
}

console.log('\nPrüfen\n')
{
    const pv = wendepunkte(k, 'hoch')
    const gut = pruefeTrend(k, 20, k[20].h, 60, k[60].h, 'hoch', 0.5, pv)
    check('Linie an den Hochs 20–60 hält, drei Berührungen', gut.ok && gut.beruehrungen === 3, JSON.stringify(gut))
    const vomTop = pruefeTrend(k, 8, 132, 40, k[40].h, 'hoch', 0.5, pv)
    check('Gegenprobe: Linie vom Top durch 40 bricht (Hoch 20 liegt 2 darüber)', !vomTop.ok)
}

console.log('\nAusrichten\n')
{
    const ki = { t1: T0 + 8 * H, p1: 132, t2: T0 + 40 * H, p2: k[40].h }
    const r = richteTrendAus(k, ki, H)
    check('KI-Linie vom Top wird ersetzt', r && r.ersetzt, JSON.stringify(r))
    check('… durch die Linie an den echten Hochs (Anker 20 und 60)', r && r.t1 === T0 + 20 * H && r.t2 === T0 + 60 * H && r.beruehrungen === 3, JSON.stringify(r))
    const fast = richteTrendAus(k, { t1: T0 + 21 * H, p1: k[20].h + 0.2, t2: T0 + 58 * H, p2: k[60].h - 0.1 }, H)
    check('fast richtige KI-Linie: Anker auf die Wendepunkte gesetzt, nicht ersetzt', fast && !fast.ersetzt && fast.t1 === T0 + 20 * H && fast.t2 === T0 + 60 * H, JSON.stringify(fast))
    check('Aufwärts-Unterstützung im reinen Abwärtstrend → null statt Fantasie',
        richteTrendAus(k, { t1: T0 + 10 * H, p1: k[10].l, t2: T0 + 50 * H, p2: k[10].l + 5 }, H) === null)
}

console.log('\nBeste Linie\n')
{
    const b = besteTrendlinie(k, 'hoch', { tol: 0.5, richtung: 'ab' })
    check('beste fallende Linie an den Hochs: 20 → 60', b && b.i1 === 20 && b.i2 === 60, JSON.stringify(b))
    check('steigende Linie an Hochs gibt es hier nicht', besteTrendlinie(k, 'hoch', { tol: 0.5, richtung: 'auf' }) === null)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
