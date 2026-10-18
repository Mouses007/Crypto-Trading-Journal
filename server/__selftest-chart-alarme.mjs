/**
 * Selbsttest der Chart-Alarm-Regeln.
 *
 *   node server/__selftest-chart-alarme.mjs
 *
 * Für jede Auslösung steht ein Gegenbeispiel daneben, das NICHT auslösen darf
 * — ein Alarm, der zu oft meldet, wird abgeschaltet, und dann meldet er auch
 * den einen Fall nicht mehr, auf den es ankam.
 */
import { geradePreis, linienPreis, kanalBei, zoneBei, pruefeAlarm, sperreAbgelaufen, MAX_LUECKE_MS } from './chart-alarm-regeln.js'

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

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
