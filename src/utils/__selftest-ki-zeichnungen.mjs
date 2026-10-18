/**
 * Selbsttest: KI-Analyse → Zeichnungen (kiZeichnungen.js).
 *
 *   node src/utils/__selftest-ki-zeichnungen.mjs
 *
 * Ältere Analysen (vor dem Umbau auf IDs, 18.10.2026) liegen bis zu 30 min im
 * Cache und müssen genauso gezeichnet werden wie bisher.
 */
import { linieAlsZeichnung, zoneAlsZeichnung, kiVorschau, kandidatenVorschau, KI_FARBEN } from './chart/kiZeichnungen.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nAltes Format\n')
{
    const l = linieAlsZeichnung({ art: 'widerstand', t1: 10, p1: 100, t2: 20, p2: 101, label: 'W' })
    check('Widerstand mit zwei Preisen → waagerecht am höheren, rot', l.typ === 'strahlH' && l.punkte[0].p === 101 && l.stil.farbe === KI_FARBEN.widerstand)
    check('ohne ID: Beschriftung unverändert, Breite 1', l.stil.text === 'W' && l.stil.breite === 1)
    const z = zoneAlsZeichnung({ art: 'unterstuetzung', tief: 90, hoch: 91, label: 'Z' }, 5, 50)
    check('Zone ohne vonT über den ganzen Bereich', z.punkte[0].t === 5 && z.punkte[1].t === 50 && z.stil.text === 'Z')
}

console.log('\nNeues Format\n')
{
    const l = linieAlsZeichnung({ id: 'N4', art: 'unterstuetzung', t1: 10, p1: 98, t2: 20, p2: 98, label: 'Boden', gewicht: 'stark' })
    check('Beschriftung trägt die ID', l.stil.text === 'Boden (N4)', l.stil.text)
    check('„stark" → Breite 2', l.stil.breite === 2)
    const t = linieAlsZeichnung({ id: 'T1', art: 'trend', t1: 10, p1: 110, t2: 40, p2: 105, label: 'Abwärtslinie' })
    check('Trendlinie bleibt schräg, nach rechts verlängert, lila', t.typ === 'trendlinie' && t.stil.rechts === true && t.stil.farbe === KI_FARBEN.trend)
    const z = zoneAlsZeichnung({ art: 'widerstand', tief: 104, hoch: 105, ids: ['N2', 'N3'], vonT: 30, label: 'Deckel' }, 5, 50)
    check('Zone beginnt bei vonT, Beschriftung mit IDs', z.punkte[0].t === 30 && z.stil.text === 'Deckel (N2+N3)', JSON.stringify(z))
    const ohne = linieAlsZeichnung({ id: null, art: 'unterstuetzung', t1: 1, p1: 98, t2: 2, p2: 98, label: 'Boden' })
    check('übernommen (id: null) ohne ID im Text', ohne.stil.text === 'Boden')
}

console.log('\nKandidaten\n')
{
    const analyse = {
        kerzenVon: 1, kerzenBis: 99,
        linien: [{ id: 'N1', art: 'widerstand', t1: 1, p1: 110, t2: 99, p2: 110, label: 'a' }],
        zonen: [{ ids: ['N2'], art: 'widerstand', tief: 104, hoch: 105, label: 'b' }],
        auswahl: { kandidaten: [
            { id: 'N1', quelle: 'niveau', preis: 110, t1: 1 }, { id: 'N2', quelle: 'niveau', preis: 104.5, t1: 5 },
            { id: 'N3', quelle: 'niveau', preis: 98, t1: 7 }, { id: 'V1', quelle: 'volumenprofil', name: 'POC', preis: 101, t1: 1 },
            { id: 'T1', quelle: 'trend', t1: 2, p1: 112, t2: 40, p2: 106 },
        ] },
    }
    const k = kandidatenVorschau(analyse)
    check('nur nicht gewählte Kandidaten (N3, V1, T1)', k.map((x) => x.stil.text).join() === 'N3,V1 POC,T1', k.map((x) => x.stil.text).join())
    check('grau gepunktet, eigene negative IDs', k.every((x) => x.stil.strich === 'gepunktet' && x.id <= -300))
    check('ohne Schalter nicht in der Vorschau', kiVorschau(analyse).length === 2)
    check('mit Schalter dazu', kiVorschau({ ...analyse, _alle: true }).length === 5)
    check('alte Analyse ohne auswahl → keine Kandidaten, kein Fehler', kandidatenVorschau({ linien: [] }).length === 0)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
