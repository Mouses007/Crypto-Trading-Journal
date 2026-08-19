/**
 * Selbsttest: Auswertung der Erfolgskontrolle.
 *
 * Ohne Netz. Diese Zahlen entscheiden, ob man der Rangfolge glaubt — eine
 * geschönte Auswertung wäre schlimmer als gar keine, weil sie Vertrauen
 * erzeugt, das nicht gedeckt ist.
 *
 * Aufruf: node server/__selftest-radar-guete.mjs
 */
import { precisionAt, rangGegenErgebnis, werteAus, spanne, median, BEWEGT_PCT } from './radar-guete.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Radar: Erfolgskontrolle')

const z = (rang, mfe, mae, status = 'gemessen') => ({ rang, mfePct: mfe, maePct: mae, status })

// ── Spanne ──────────────────────────────────────────────────────────────
p('Spanne ist hoch minus tief', spanne(z(1, 5, -3)) === 8)
p('fehlende Werte ergeben null', spanne(z(1, null, -3)) === null)
p('leere Zeile ergibt null', spanne(undefined) === null)

// ── Precision ───────────────────────────────────────────────────────────
{
    const zeilen = [z(1, 5, -1), z(2, 3, -1), z(3, 0.2, -0.1), z(4, 6, -2)]
    const r = precisionAt(zeilen, 4)
    p('drei von vier bewegten sich genug', r.treffer === 3 && r.n === 4, JSON.stringify(r))
    p('Anteil stimmt', Math.abs(r.wert - 0.75) < 1e-9)
}
p('ohne Messungen kein Wert', precisionAt([]).wert === null)
p('offene Zeilen zählen nicht mit',
    precisionAt([z(1, 9, -1, 'offen')]).n === 0)
p('die Schwelle ist einstellbar',
    precisionAt([z(1, 2, -0.5)], 10, 10).treffer === 0)

/*
 * Die Richtung ist ausdrücklich egal. Ein Coin, der 8 % GEFALLEN ist, war
 * genauso handelbar wie einer, der 8 % gestiegen ist — die Seite verspricht
 * Bewegung, nicht Richtung. Würde hier nur das Plus zählen, misse die
 * Auswertung etwas anderes als das, was die Seite behauptet.
 */
p('Bewegung nach unten zählt genauso',
    precisionAt([z(1, 0.1, -8)], 10).treffer === 1)

// ── Rang gegen Ergebnis ─────────────────────────────────────────────────
{
    // Perfekt: Rang 1 bewegte sich am meisten, Rang 12 am wenigsten.
    const perfekt = Array.from({ length: 12 }, (_, i) => z(i + 1, 20 - i, 0))
    const r = rangGegenErgebnis(perfekt)
    p('perfekte Übereinstimmung ergibt +1', Math.abs(r.wert - 1) < 1e-9, String(r.wert))

    const verkehrt = Array.from({ length: 12 }, (_, i) => z(i + 1, i, 0))
    p('umgekehrte Rangfolge ergibt −1', Math.abs(rangGegenErgebnis(verkehrt).wert + 1) < 1e-9)
}
p('unter zehn Paaren wird nicht gerechnet',
    rangGegenErgebnis(Array.from({ length: 9 }, (_, i) => z(i + 1, i, 0))).wert === null)

// ── Median ──────────────────────────────────────────────────────────────
p('Median bei ungerader Anzahl', median([3, 1, 2]) === 2)
p('Median bei gerader Anzahl', median([1, 2, 3, 4]) === 2.5)
p('leere Reihe ergibt null', median([]) === null)
p('Fehlwerte fallen heraus', median([1, null, 3]) === 2)

// ── Gesamtauswertung ────────────────────────────────────────────────────
{
    // Oben viel Bewegung, unten wenig — die Liste trägt.
    const gut = [
        ...Array.from({ length: 10 }, (_, i) => z(i + 1, 15 - i * 0.5, -1)),
        ...Array.from({ length: 10 }, (_, i) => z(i + 11, 2 - i * 0.1, -0.5)),
    ]
    const a = werteAus(gut, '1h')
    p('Horizont wird durchgereicht', a.horizont === '1h')
    p('oben bewegt sich mehr als unten', a.medianSpanneOben > a.medianSpanneUnten)
    p('das Urteil sagt es auch', a.urteil === 'die Rangfolge trägt', a.urteil)

    /*
     * Der Fall, für den die Kontrollgruppe existiert: An einem wilden Tag
     * bewegt sich ALLES. Precision@10 sähe glänzend aus, obwohl die Rangfolge
     * nichts leistet — erst der Vergleich mit der unteren Hälfte entlarvt das.
     */
    const wildertag = Array.from({ length: 20 }, (_, i) => z(i + 1, 10, -5))
    const b = werteAus(wildertag)
    p('bei gleicher Bewegung überall ist Precision hoch', b.precision10.wert === 1)
    p('aber das Urteil fällt trotzdem nüchtern aus',
        b.urteil !== 'die Rangfolge trägt', b.urteil)

    const leer = werteAus([])
    p('ohne Daten kein Urteil', leer.urteil === 'zu wenige Messungen')
    p('offene und fehlgeschlagene werden gezählt',
        werteAus([z(1, 1, 0, 'offen'), z(2, 1, 0, 'fehlgeschlagen')]).offen === 1)
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
