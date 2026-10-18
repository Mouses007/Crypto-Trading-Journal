/**
 * Selbsttest der KI-Analyse im Chart — Eingabe und Antwortprüfung, ohne Modell.
 *
 *   node server/__selftest-chart-ki.mjs
 *
 * Eine bezahlte Antwort wird hier gesiebt, bevor sie als Linie im Chart
 * landet. Zu streng frisst das Sieb gute Linien (bezahlt, weggeworfen), zu
 * locker zeichnet es Linien an Orte, wo der Kurs nie war, oder lässt eine
 * Prognose durch. Für jede Ablehnung steht deshalb eine Gegenprobe daneben,
 * die durchgehen MUSS.
 */
import { baueChartEingabe, pruefeChartAntwort, systemText } from './chart-ki.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const H = 3_600_000
const T0 = Date.UTC(2026, 9, 10, 0, 0)
const kerzen = Array.from({ length: 50 }, (_, i) => ({ t: T0 + i * H, o: 100 + i * 0.1, h: 101 + i * 0.1, l: 99 + i * 0.1, c: 100.5 + i * 0.1, v: 1000 }))
const rahmen = { vonT: kerzen[0].t, bisT: kerzen[49].t, iv: H, preisMin: 99, preisMax: 105.9 }
const iso = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z'

console.log('\nEingabe\n')
{
    const e = baueChartEingabe({
        symbol: 'SOLUSDT', interval: '1h', kerzen,
        zeichnungen: [{ typ: 'horizontale', punkte: [{ t: T0, p: 102 }], stil: { text: 'Wochenhoch' } }, { typ: 'fib', punkte: [] }],
        hebelzonen: { oben: [{ preis: 110, usd: 12e6 }], unten: [{ preis: 95, usd: 8e6 }] },
        trades: [{ richtung: 'long', einstieg: { t: T0 + 5 * H, p: 100.4 }, ausstieg: null }],
    })
    check('alle Kerzen in der Eingabe', e.split('\n').filter((z) => /^\d{4}-\d\d-\d\dT/.test(z)).length === 50)
    check('eigene Linie mit Beschriftung, Fibonacci weggelassen', e.includes('horizontale bei 102 „Wochenhoch"') && !e.includes('fib'))
    check('Hebelzonen als Modell gekennzeichnet', e.includes('Modell') && e.includes('~12 Mio USD Shorts'))
    check('offener eigener Trade als offen', e.includes('(offen)'))
    check('System ohne Empfehlungen verbietet Prognosen', systemText(false, false).includes('KEINE Prognose'))
    check('System mit Empfehlungen lässt die Sperre weg', !systemText(false, true).includes('KEINE Prognose'))
}

console.log('\nAntwortprüfung\n')
{
    const gut = pruefeChartAntwort({
        text: 'Seit dem 10. steigt die Struktur mit höheren Tiefs; die Spanne liegt zwischen 99 und 106.',
        linien: [
            { art: 'unterstuetzung', t1: iso(T0 + 3 * H), p1: 99.3, t2: iso(T0 + 40 * H), p2: 99.3, label: 'Tiefs 10./11.', grund: 'drei Tiefs bei 99,3' },
            { art: 'trend', t1: iso(T0 + 40 * H), p1: 103, t2: iso(T0 + 10 * H), p2: 100, label: 'Aufwärtslinie', grund: 'höhere Tiefs' },
        ],
        zonen: [{ tief: 104, hoch: 103, label: 'Widerstand', grund: 'mehrfach abgeprallt' }],
        bedingungen: [{ wenn: 'Schluss unter 99,3', dann: 'ist die Struktur höherer Tiefs gebrochen' }],
    }, rahmen)
    check('sachliche Antwort kommt vollständig durch', gut.linien.length === 2 && gut.zonen.length === 1 && gut.bedingungen.length === 1 && gut.text, JSON.stringify(gut.verworfen))
    check('vertauschte Zeitpunkte werden umgedreht (t1 < t2)', gut.linien[1].t1 < gut.linien[1].t2 && gut.linien[1].p1 === 100)
    check('vertauschte Zonengrenzen werden umgedreht', gut.zonen[0].tief === 103 && gut.zonen[0].hoch === 104)
    check('nichts verworfen', gut.verworfen.length === 0)

    const schlecht = pruefeChartAntwort({
        text: 'SOL dürfte in den nächsten Stunden auf 120 steigen.',
        linien: [
            { t1: iso(T0 - 30 * H), p1: 100, t2: iso(T0 + 5 * H), p2: 101, label: 'zu früh' },
            { t1: iso(T0 + 2 * H), p1: 300, t2: iso(T0 + 5 * H), p2: 301, label: 'falscher Preis' },
            { t1: iso(T0 + 2 * H), p1: 100, t2: iso(T0 + 5 * H), p2: 101, label: 'Kursziel 120', grund: 'Kursziel nach Ausbruch' },
            { t1: 'kaputt', p1: 100, t2: iso(T0 + 5 * H), p2: 101, label: 'keine Zeit' },
        ],
        zonen: [{ tief: 100, hoch: 100, label: 'null breit' }],
        bedingungen: [{ wenn: 'über 106', dann: 'jetzt kaufen' }],
    }, rahmen)
    check('Prognose im Text verworfen', schlecht.text === '')
    check('Linie vor dem Kerzenbereich verworfen', schlecht.verworfen.some((v) => v.inhalt === 'zu früh' && v.grund === 'zeit'))
    check('Linie fern jedes Preises verworfen', schlecht.verworfen.some((v) => v.inhalt === 'falscher Preis' && v.grund === 'preis'))
    check('Kursziel in Beschriftung verworfen', schlecht.verworfen.some((v) => v.inhalt === 'Kursziel 120' && v.grund === 'prognose'))
    check('Linie ohne lesbare Zeit verworfen', schlecht.linien.length === 0)
    check('Zone ohne Breite verworfen', schlecht.zonen.length === 0)
    check('Empfehlung in Bedingung verworfen', schlecht.bedingungen.length === 0)
    check('ganz leer → leer = true (Lauf gilt als gescheitert)', schlecht.leer === true)

    const zukunft = pruefeChartAntwort({ linien: [{ art: 'trend', t1: iso(T0 + 30 * H), p1: 102, t2: iso(T0 + 70 * H), p2: 106, label: 'verlängert' }] }, rahmen)
    check('Gegenprobe: Trendpunkt etwas in der Zukunft ist erlaubt', zukunft.linien.length === 1)
    const nurT1 = pruefeChartAntwort({ linien: [{ art: 'unterstuetzung', t1: iso(T0 + 3 * H), p1: 100, label: 'Boden' }] }, rahmen)
    check('Linie nur mit t1 wird waagerecht bis zur letzten Kerze', nurT1.linien.length === 1 && nurT1.linien[0].p2 === 100 && nurT1.linien[0].t2 === rahmen.bisT)
    const negiert = pruefeChartAntwort({ text: 'Eine Prognose lässt sich daraus nicht ableiten; die Spanne ist eng.' }, rahmen)
    check('Gegenprobe: verneinte „Prognose" geht durch (gleicher Wächter wie Coin-Radar)', negiert.text !== '')
    const erlaubt = pruefeChartAntwort({ text: 'SOL dürfte steigen.' }, { ...rahmen, empfehlungen: true })
    check('mit freigeschalteten Empfehlungen keine Sperre', erlaubt.text !== '')
    check('fehlende Antwort bricht nichts', pruefeChartAntwort(null, rahmen).leer === true)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
