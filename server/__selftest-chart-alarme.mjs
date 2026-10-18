/**
 * Selbsttest der Chart-Alarm-Regeln.
 *
 *   node server/__selftest-chart-alarme.mjs
 *
 * Für jede Auslösung steht ein Gegenbeispiel daneben, das NICHT auslösen darf
 * — ein Alarm, der zu oft meldet, wird abgeschaltet, und dann meldet er auch
 * den einen Fall nicht mehr, auf den es ankam.
 */
import { geradePreis, linienPreis, kanalBei, zoneBei, pruefeAlarm, sperreAbgelaufen, geometrieVorbei, ordnePunkte, MAX_LUECKE_MS } from './chart-alarm-regeln.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nahe = (a, b) => Math.abs(a - b) < 1e-9
const M = 60_000
const T = 1_760_000_000_000
const m = (p, min) => ({ p, t: T + min * M })

console.log('\nPreis-Alarm\n')
{
    const ueber = { art: 'preis', bedingung: { preis: 100, richtung: 'ueber' } }
    check('kreuzt nach oben → löst aus', pruefeAlarm(ueber, null, m(99, 0), m(100.5, 1)).ausloesen)
    check('genau auf die Linie zählt als erreicht', pruefeAlarm(ueber, null, m(99, 0), m(100, 1)).ausloesen)
    check('bleibt darüber → löst NICHT aus', !pruefeAlarm(ueber, null, m(101, 0), m(102, 1)).ausloesen)
    check('kreuzt nach unten → „über" löst NICHT aus', !pruefeAlarm(ueber, null, m(101, 0), m(99, 1)).ausloesen)
    const kreuzt = { art: 'preis', bedingung: { preis: 100 } }
    check('„kreuzt" (Vorgabe) fängt beide Richtungen', pruefeAlarm(kreuzt, null, m(101, 0), m(99, 1)).ausloesen && pruefeAlarm(kreuzt, null, m(99, 0), m(101, 1)).ausloesen)
    check('erste Messung setzt nur an', pruefeAlarm(kreuzt, null, null, m(101, 1)).grund === 'ersteMessung')
    check('Lücke über der Grenze → kein Alarm, sondern Neuansatz',
        pruefeAlarm(kreuzt, null, m(99, 0), { p: 101, t: T + MAX_LUECKE_MS + 1 }).grund === 'luecke')
    check('Lücke knapp unter der Grenze → normaler Vergleich', pruefeAlarm(kreuzt, null, m(99, 0), { p: 101, t: T + MAX_LUECKE_MS }).ausloesen)
}

console.log('\nLinien\n')
{
    const a = { t: T, p: 100 }
    const b = { t: T + 100 * M, p: 110 }
    check('Gerade: halbe Strecke = halber Preisweg', nahe(geradePreis(a, b, T + 50 * M), 105))
    const tl = { typ: 'trendlinie', punkte: [a, b], stil: {} }
    check('Trendlinie hinter ihrem Ende existiert nicht', linienPreis(tl, T + 150 * M) === null)
    const tlR = { ...tl, stil: { rechts: true } }
    check('nach rechts verlängert: Preis in der Zukunft', nahe(linienPreis(tlR, T + 150 * M), 115))
    check('Strahl vor seinem Anfang existiert nicht', linienPreis({ typ: 'strahl', punkte: [a, b] }, T - M) === null)
    check('horizontaler Strahl erst ab seinem Punkt', linienPreis({ typ: 'strahlH', punkte: [a] }, T - M) === null && linienPreis({ typ: 'strahlH', punkte: [a] }, T + M) === 100)

    // Fallende Linie, Kurs bleibt flach bei 104: die Linie läuft unter dem Kurs durch.
    const fallend = { typ: 'trendlinie', punkte: [{ t: T, p: 110 }, { t: T + 10 * M, p: 100 }], stil: {} }
    const alarm = { art: 'linie', bedingung: { richtung: 'ueber' } }
    check('flacher Kurs, Linie sinkt unter ihn → „über" löst aus',
        pruefeAlarm(alarm, fallend, m(104, 5), m(104, 7)).ausloesen, JSON.stringify(pruefeAlarm(alarm, fallend, m(104, 5), m(104, 7))))
    check('Gegenprobe: Kurs und Linie sinken parallel → kein Alarm',
        !pruefeAlarm(alarm, fallend, m(104.5, 5), m(102.5, 7)).ausloesen)
    check('Messung nach dem Linienende → kein Alarm', !pruefeAlarm(alarm, fallend, m(99, 9), m(101, 11)).ausloesen)
}

console.log('\nKanal und Zone\n')
{
    const kanal = { typ: 'kanal', punkte: [{ t: T, p: 100 }, { t: T + 10 * M, p: 110 }, { t: T + 5 * M, p: 100 }] }
    const g = kanalBei(kanal, T + 5 * M)
    check('Kanal: Ober- und Unterkante (Versatz −5)', nahe(g.oben, 105) && nahe(g.unten, 100))
    check('Kanal-Mitte für den Linienalarm', nahe(linienPreis(kanal, T + 5 * M, 'mitte'), 102.5))
    const rechteck = { typ: 'rechteck', punkte: [{ t: T, p: 110 }, { t: T + 30 * M, p: 100 }], stil: {} }
    check('Rechteck: Bereich unabhängig von der Eckenreihenfolge', zoneBei(rechteck, T + M).unten === 100 && zoneBei(rechteck, T + M).oben === 110)
    check('Rechteck endet an seiner rechten Kante', zoneBei(rechteck, T + 31 * M) === null)
    check('Rechteck nach rechts verlängert gilt weiter', zoneBei({ ...rechteck, stil: { rechts: true } }, T + 500 * M) !== null)
    const betreten = { art: 'zone', bedingung: { richtung: 'betreten' } }
    check('Zone betreten → löst aus', pruefeAlarm(betreten, rechteck, m(112, 1), m(108, 2)).ausloesen)
    check('in der Zone bleiben → kein Alarm', !pruefeAlarm(betreten, rechteck, m(105, 1), m(106, 2)).ausloesen)
    check('Zone übersprungen (112 → 98) → kein „betreten"', !pruefeAlarm(betreten, rechteck, m(112, 1), m(98, 2)).ausloesen)
    const verlassen = { art: 'zone', bedingung: { richtung: 'verlassen' } }
    check('Zone verlassen → löst aus', pruefeAlarm(verlassen, rechteck, m(105, 1), m(99, 2)).ausloesen)
}

console.log('\nSperrfrist\n')
{
    check('nie ausgelöst → darf', sperreAbgelaufen({ ausgeloestAm: 0, bedingung: {} }, T))
    check('vor 10 min ausgelöst, Vorgabe 15 → darf nicht', !sperreAbgelaufen({ ausgeloestAm: T, bedingung: {} }, T + 10 * M))
    check('nach 15 min → darf wieder', sperreAbgelaufen({ ausgeloestAm: T, bedingung: {} }, T + 15 * M))
    check('eigene Sperre 60 min', !sperreAbgelaufen({ ausgeloestAm: T, bedingung: { sperreMin: 60 } }, T + 30 * M))
}

console.log('\nSperrfrist: Untergrenze und einmalige Alarme\n')
{
    check('sperreMin 0 → trotzdem 1 min (kein Dauerfeuer)', !sperreAbgelaufen({ ausgeloestAm: T, bedingung: { sperreMin: 0 } }, T + 30_000))
    check('sperreMin 0 → nach 1 min wieder', sperreAbgelaufen({ ausgeloestAm: T, bedingung: { sperreMin: 0 } }, T + M))
    check('einmaliger Alarm, wieder eingeschaltet → keine Sperre', sperreAbgelaufen({ einmalig: 1, ausgeloestAm: T, bedingung: {} }, T + M))
    check('Gegenprobe: wiederholender Alarm nach 1 min → gesperrt', !sperreAbgelaufen({ einmalig: 0, ausgeloestAm: T, bedingung: {} }, T + M))
}

console.log('\nZeichenrichtung\n')
{
    const vor = [{ t: T, p: 100 }, { t: T + 10 * M, p: 110 }]
    const rueck = [vor[1], vor[0]]
    check('ordnePunkte: Trendlinie rückwärts → nach Zeit', ordnePunkte('trendlinie', rueck)[0].t === T)
    check('ordnePunkte: Strahl bleibt, wie gezeichnet', ordnePunkte('strahl', rueck)[0].t === T + 10 * M)
    check('ordnePunkte: Kanal tauscht nur a/b, c bleibt dritter',
        ordnePunkte('kanal', [rueck[0], rueck[1], { t: T + 5 * M, p: 90 }])[2].p === 90)
    const tl = (pk) => ({ typ: 'trendlinie', punkte: pk, stil: { rechts: true } })
    check('Trendlinie rückwärts gezeichnet, „rechts" → gilt in der Zukunft', nahe(linienPreis(tl(rueck), T + 20 * M), 120))
    check('Gegenprobe: dieselbe Linie links vom Anfang → null', linienPreis(tl(rueck), T - M) === null)
    const sr = { typ: 'strahl', punkte: rueck }
    check('Strahl nach LINKS gezeichnet → links vom Start gültig', nahe(linienPreis(sr, T - 10 * M), 90))
    check('Gegenprobe: Strahl nach links → rechts vom Start null', linienPreis(sr, T + 20 * M) === null)
}

console.log('\nLog-Skala\n')
{
    const a = { t: T, p: 100 }, b = { t: T + 10 * M, p: 200 }
    check('linear: Mitte 100→200 = 150', nahe(geradePreis(a, b, T + 5 * M), 150))
    check('log: Mitte 100→200 = 141,42', Math.abs(geradePreis(a, b, T + 5 * M, true) - Math.SQRT2 * 100) < 1e-9)
    const z = { typ: 'trendlinie', punkte: [a, b], stil: { skala: 'log' } }
    check('Trendlinie mit stil.skala log rechnet log', Math.abs(linienPreis(z, T + 5 * M) - 141.4213562) < 1e-6)
    const k = { typ: 'kanal', punkte: [a, b, { t: T, p: 50 }], stil: { skala: 'log' } }
    const g = kanalBei(k, T + 5 * M)
    check('Log-Kanal: Parallele mit Faktor ½ → 70,71', Math.abs(g.unten - 70.710678) < 1e-5 && Math.abs(g.oben - 141.421356) < 1e-5)
}

console.log('\nGeometrie zu Ende\n')
{
    const linie = { art: 'linie', bedingung: {} }
    const strecke = { typ: 'trendlinie', punkte: [{ t: T, p: 100 }, { t: T + 10 * M, p: 110 }], stil: {} }
    check('Strecke ohne Verlängerung, Ende vorbei → vorbei', geometrieVorbei(linie, strecke, T + 11 * M))
    check('Gegenprobe: innerhalb der Strecke → nicht vorbei', !geometrieVorbei(linie, strecke, T + 5 * M))
    check('Gegenprobe: vor dem Start → nicht vorbei (beginnt noch)', !geometrieVorbei(linie, strecke, T - M))
    check('Gegenprobe: mit „rechts" → nie vorbei', !geometrieVorbei(linie, { ...strecke, stil: { rechts: true } }, T + 999 * M))
    check('Horizontale → nie vorbei', !geometrieVorbei(linie, { typ: 'horizontale', punkte: [{ t: T, p: 1 }] }, T + 999 * M))
    const zone = { art: 'zone', bedingung: {} }
    const re = { typ: 'rechteck', punkte: [{ t: T, p: 100 }, { t: T + 10 * M, p: 110 }], stil: {} }
    check('Rechteck zu Ende → vorbei', geometrieVorbei(zone, re, T + 11 * M))
    check('Gegenprobe: Rechteck mit „rechts" → nicht vorbei', !geometrieVorbei(zone, { ...re, stil: { rechts: true } }, T + 11 * M))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
