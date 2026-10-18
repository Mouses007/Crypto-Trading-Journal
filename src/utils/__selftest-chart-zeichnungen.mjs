/**
 * Selbsttest der Zeichen-Geometrie — ohne Browser.
 *
 *   node src/utils/__selftest-chart-zeichnungen.mjs
 *
 * Die heikle Stelle ist die Umrechnung Zeit ↔ logischer Index JENSEITS der
 * Kerzen: eine Trendlinie, deren zweiter Punkt in der Zukunft liegt, muss
 * beim Hin- und Zurückrechnen an derselben Zeit landen, sonst wandert sie bei
 * jedem Verschieben ein Stück. Dazu Fibonacci in TradingView-Richtung,
 * Positions-R mit falsch gesetztem Stop, Magnet und Trefferabstand.
 */
import {
    zeitZuLogisch, logischZuZeit, logischZuX, abstandZuStrecke, verlaengere, preisAufGerade,
    fibPreise, positionWerte, magnet, imRechteck, messung, dauerText,
} from './chart/zeichnungen/geometrie.js'
import { WERKZEUGE, stilFuer, STANDARD_STIL } from './chart/zeichnungen/werkzeuge.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const nahe = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

const H = 3_600_000
const t0 = 1_760_000_000_000
const zeiten = Array.from({ length: 10 }, (_, i) => t0 + i * H)

console.log('\nZeit ↔ logischer Index\n')
check('Kerzenzeit → ganzzahliger Index', zeitZuLogisch(t0 + 3 * H, zeiten, H) === 3)
check('Zwischen zwei Kerzen anteilig', nahe(zeitZuLogisch(t0 + 3.5 * H, zeiten, H), 3.5))
check('Zukunft: mit Kerzenlänge weitergezählt', nahe(zeitZuLogisch(t0 + 15 * H, zeiten, H), 15))
check('Vergangenheit vor der ersten Kerze: negativ', nahe(zeitZuLogisch(t0 - 2 * H, zeiten, H), -2))
for (const L of [-3.25, 0, 2.5, 9, 12.75]) {
    check(`Hin und zurück ohne Wanderung (L=${L})`, nahe(zeitZuLogisch(logischZuZeit(L, zeiten, H), zeiten, H), L))
}
{
    // Lücke in den Kerzen (z. B. Börsenausfall): Index bleibt monoton.
    const mitLuecke = [t0, t0 + H, t0 + 5 * H, t0 + 6 * H]
    const L = zeitZuLogisch(t0 + 3 * H, mitLuecke, H)
    check('Lücke: Zeit in der Lücke liegt zwischen den Nachbarn', L > 1 && L < 2, String(L))
    check('Lücke: Rückweg stimmt', nahe(logischZuZeit(L, mitLuecke, H), t0 + 3 * H))
}
check('Ohne Kerzen → null statt Absturz', zeitZuLogisch(t0, [], H) === null && logischZuZeit(1, [], H) === null)

{
    // Attrappe der Zeitachse, die sich wie Lightweight Charts verhält: ganze
    // Indizes ergeben x = 50 + 10·i, gebrochene 0 (so gemessen in v5.2.1).
    const achse = { logicalToCoordinate: (L) => (Number.isInteger(L) ? 50 + 10 * L : 0) }
    check('Gebrochener Index wird zwischen den Nachbarn geteilt (nicht 0)', nahe(logischZuX(achse, 3.5), 85))
    check('Ganzer Index unverändert', logischZuX(achse, 3) === 80)
    check('Negativer gebrochener Index (vor den Daten)', nahe(logischZuX(achse, -1.25), 37.5))
    check('null bleibt null', logischZuX(achse, null) === null)
}

console.log('\nTreffer und Verlängerung\n')
check('Abstand zur Strecke (senkrecht)', nahe(abstandZuStrecke(5, 3, 0, 0, 10, 0), 3))
check('Hinter dem Ende zählt der Endpunkt', nahe(abstandZuStrecke(14, 3, 0, 0, 10, 0), 5))
check('Verlängert nach rechts: hinter dem Ende auf der Linie', nahe(abstandZuStrecke(50, 0, 0, 0, 10, 0, { rechts: true }), 0))
check('Nicht nach links verlängert, wenn nur rechts', abstandZuStrecke(-50, 0, 0, 0, 10, 0, { rechts: true }) > 40)
{
    const v = verlaengere(0, 0, 10, 10, 800, { rechts: true })
    check('Verlängerung bleibt auf derselben Geraden', nahe(v.by / v.bx, 1, 1e-6) && v.bx > 800)
    check('Verlängerung ändert den Startpunkt nicht', v.ax === 0 && v.ay === 0)
}
check('Preis auf Gerade in der Zukunft', nahe(preisAufGerade(20, 0, 100, 10, 110), 120))
check('Senkrechte Gerade (gleicher Index) liefert Startpreis', preisAufGerade(5, 3, 100, 3, 200) === 100)
check('Im Rechteck mit vertauschten Ecken', imRechteck(5, 5, 10, 10, 0, 0) && !imRechteck(11, 5, 10, 10, 0, 0))

console.log('\nFibonacci, Position, Magnet, Messen\n')
{
    const f = fibPreise(100, 200)
    check('Fib 0 am Endpunkt, 1 am Startpunkt', f.find((x) => x.stufe === 0).preis === 200 && f.find((x) => x.stufe === 1).preis === 100)
    check('Fib 0.618 einer Aufwärtsbewegung 100→200 = 138.2', nahe(f.find((x) => x.stufe === 0.618).preis, 138.2, 1e-9))
}
{
    const w = positionWerte(100, 110, 95)
    check('Long: 10 Chance / 5 Risiko = 2 R', w.long && nahe(w.rr, 2) && w.stimmig)
    const s = positionWerte(100, 90, 105)
    check('Short erkannt, 2 R', !s.long && nahe(s.rr, 2) && s.stimmig)
    const falsch = positionWerte(100, 110, 104)
    check('Stop auf der falschen Seite: stimmig = false (nicht still korrigiert)', falsch.stimmig === false)
    check('Stop = Einstieg → R unbekannt statt Unendlich', positionWerte(100, 110, 100).rr === null)
}
{
    const k = { o: 100, h: 105, l: 98, c: 103 }
    check('Magnet rastet aufs Hoch ein', magnet(104.6, k, 1) === 105)
    check('Magnet ausserhalb der Toleranz lässt den Preis', magnet(101.5, k, 1) === 101.5)
    check('Magnet ohne Kerze lässt den Preis', magnet(50, null, 10) === 50)
    check('Starker Magnet (Toleranz ∞) rastet immer auf das nächste OHLC', magnet(101.5, k, Infinity) !== 101.5 && [k.o, k.h, k.l, k.c].includes(magnet(101.5, k, Infinity)))
}
{
    const m = messung({ t: t0, p: 100 }, { t: t0 + 5 * H, p: 110 }, H)
    check('Messung: +10, +10 %, 5 Kerzen', m.dp === 10 && nahe(m.pct, 10) && m.kerzen === 5)
    check('Dauertext', dauerText(5 * H) === '5h 0m' && dauerText(26 * H) === '1d 2h' && dauerText(90_000) === '2m')
}

console.log('\nWerkzeuge\n')
{
    const gespeichert = ['horizontale', 'strahlH', 'vertikale', 'trendlinie', 'strahl', 'kanal', 'rechteck', 'fib', 'position', 'text']
    const fluechtig = WERKZEUGE.filter((w) => w.fluechtig).map((w) => w.typ)
    const alle = WERKZEUGE.map((w) => w.typ)
    check('Jedes speicherbare Werkzeug hat eine Vorgabe-Gestaltung', gespeichert.every((t) => STANDARD_STIL[t]))
    check('Werkzeugleiste und Server-Liste decken sich (ohne flüchtige)', alle.filter((t) => !fluechtig.includes(t)).sort().join() === [...gespeichert].sort().join())
    check('Eigener Stil überschreibt die Vorgabe, Rest bleibt', stilFuer({ typ: 'trendlinie', stil: { farbe: '#fff' } }).farbe === '#fff' && stilFuer({ typ: 'trendlinie', stil: { farbe: '#fff' } }).breite === 2)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
