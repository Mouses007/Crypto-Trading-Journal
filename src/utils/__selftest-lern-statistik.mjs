/**
 * Selbsttest der Lernkarteikasten-Auswertung.
 *
 *   node src/utils/__selftest-lern-statistik.mjs
 */

import { werteAus, uebersicht, proTag, lernserie, proKategorie, MIN_GRUPPE } from './lernStatistik.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const TAG_MS = 24 * 60 * 60 * 1000
/** Fester Bezugszeitpunkt: ein Dienstag, 10:00 Uhr lokal — deterministisch für den Test. */
const JETZT = new Date(2026, 7, 25, 10, 0, 0).getTime()

const historie = (...eintraege) => JSON.stringify(eintraege.map(([t, grad]) => ({ t, grad })))

const karte = (id, kategorie, aktiv = 1) => ({ id, kategorie, aktiv })
const eintrag = (karte, fortschritt) => ({ karte, fortschritt })

console.log('\nLernkarteikasten-Auswertung — Selbsttest\n')

// ── Überblick ─────────────────────────────────────────────────────────────
console.log('Überblick')
{
    check('Leeres Deck: erfolgsquote null, keine Karte gemeistert', (() => {
        const u = uebersicht([])
        return u.gesamt === 0 && u.erfolgsquote === null && u.gemeistert === 0
    })())

    const eintraege = [
        eintrag(karte(1, 'indikatoren'), { box: 4, gesamtRichtig: 5, gesamtFalsch: 1 }),
        eintrag(karte(2, 'indikatoren'), { box: 1, gesamtRichtig: 0, gesamtFalsch: 0 }),
        eintrag(karte(3, 'derivate'), null),
        eintrag(karte(4, 'derivate', 0), { box: 4, gesamtRichtig: 9, gesamtFalsch: 0 }), // inaktiv — zählt nicht
    ]
    const u = uebersicht(eintraege)
    check('Nur aktive Karten zählen zu „gesamt"', u.gesamt === 3, `gesamt=${u.gesamt}`)
    check('Nur aktive, gemeisterte Karten (Box 4) zählen', u.gemeistert === 1, `gemeistert=${u.gemeistert}`)
    check('„begonnen" zählt Karten mit mindestens einer Bewertung', u.begonnen === 1, `begonnen=${u.begonnen}`)
    check('Altbestand ohne gesamtSchwer rechnet unverändert weiter', Math.abs(u.erfolgsquote - 5 / 6) < 1e-9)
}

/*
 * „Schwer" senkt die Quote (05.09.2026).
 *
 * Die wichtigere der beiden Prüfungen ist die zweite: sie zeigt, dass „Schwer"
 * NICHT einfach als Fehler verbucht wird. Beide Fassungen — vorher als Treffer,
 * jetzt als Fehler — wären falsch, nur in verschiedene Richtungen.
 */
console.log('\n„Schwer" im Nenner')
{
    const eintraege = [eintrag(karte(1, 'indikatoren'), { gesamtRichtig: 6, gesamtSchwer: 2, gesamtFalsch: 2 })]
    const u = uebersicht(eintraege)
    check('Erfolgsquote = richtig / (richtig+schwer+falsch)', Math.abs(u.erfolgsquote - 6 / 10) < 1e-9, `quote=${u.erfolgsquote}`)
    check('bewertungenGesamt zählt „Schwer" mit', u.bewertungenGesamt === 10, `n=${u.bewertungenGesamt}`)
    check('„Schwer" ist kein Fehler — sonst käme 6/8 heraus', Math.abs(u.erfolgsquote - 6 / 8) > 1e-9)

    const nurSchwer = uebersicht([eintrag(karte(1, 'indikatoren'), { gesamtRichtig: 0, gesamtSchwer: 3, gesamtFalsch: 0 })])
    check('Eine Karte, die nur mit Mühe ging, ergibt 0 % statt „noch nie bewertet"',
        nurSchwer.erfolgsquote === 0 && nurSchwer.begonnen === 1)
}

// ── Wiederholungen pro Tag ───────────────────────────────────────────────
console.log('\nWiederholungen pro Tag')
{
    const gestern = JETZT - TAG_MS
    const vorgestern = JETZT - 2 * TAG_MS
    const eintraege = [
        eintrag(karte(1, 'indikatoren'), { historie: historie([JETZT, 'gut'], [JETZT, 'vergessen'], [gestern, 'leicht']) }),
        eintrag(karte(2, 'indikatoren'), { historie: historie([vorgestern, 'schwer']) }),
    ]
    const tage = proTag(eintraege, JETZT, 5)
    check('proTag liefert die angeforderte Anzahl Tage', tage.length === 5)
    check('Letzter Eintrag ist heute mit 2 Bewertungen', tage[tage.length - 1].anzahl === 2, JSON.stringify(tage[tage.length - 1]))
    check('Vorletzter Eintrag ist gestern mit 1 Bewertung', tage[tage.length - 2].anzahl === 1)
    check('Tage ohne Bewertung stehen mit 0 da', tage[0].anzahl === 0)
    check('Tage sind älteste-zuerst sortiert', tage[tage.length - 1].tag > tage[0].tag)
}

// ── Lernserie ─────────────────────────────────────────────────────────────
console.log('\nLernserie')
{
    check('Ohne jede Bewertung ist die Serie 0', lernserie([], JETZT) === 0)

    const dreiTageInFolge = [
        eintrag(karte(1, 'x'), { historie: historie([JETZT, 'gut'], [JETZT - TAG_MS, 'gut'], [JETZT - 2 * TAG_MS, 'gut']) }),
    ]
    check('Drei Tage in Folge inkl. heute ergeben Serie 3', lernserie(dreiTageInFolge, JETZT) === 3)

    const luecke = [
        eintrag(karte(1, 'x'), { historie: historie([JETZT, 'gut'], [JETZT - 2 * TAG_MS, 'gut']) }),
    ]
    check('Eine ausgelassene Bewertung bricht die Serie am Vortag ab', lernserie(luecke, JETZT) === 1)

    const nurGestern = [
        eintrag(karte(1, 'x'), { historie: historie([JETZT - TAG_MS, 'gut'], [JETZT - 2 * TAG_MS, 'gut']) }),
    ]
    check('Heute noch nichts gelernt, aber gestern+vorgestern: Serie zählt trotzdem 2 (der Tag ist ja noch nicht vorbei)',
        lernserie(nurGestern, JETZT) === 2)
}

// ── Erfolg nach Kategorie ─────────────────────────────────────────────────
console.log('\nErfolg nach Kategorie')
{
    const eintraege = [
        eintrag(karte(1, 'indikatoren'), { gesamtRichtig: 8, gesamtFalsch: 2 }),   // 80%, n=10
        eintrag(karte(2, 'indikatoren'), { gesamtRichtig: 0, gesamtFalsch: 0 }),   // keine Bewertung
        eintrag(karte(3, 'derivate'), { gesamtRichtig: 1, gesamtFalsch: 1 }),      // 50%, n=2 → duenn
        eintrag(karte(4, 'markt'), null),
    ]
    const kats = proKategorie(eintraege)
    check('Kategorien ohne jede Bewertung fehlen ganz (markt taucht nicht auf)', !kats.some(k => k.kategorie === 'markt'))
    check('Schwächste Kategorie steht zuerst', kats[0].kategorie === 'derivate')
    check('Kategorie unter MIN_GRUPPE trägt duenn:true', kats.find(k => k.kategorie === 'derivate').duenn === true, `MIN_GRUPPE=${MIN_GRUPPE}`)
    check('Kategorie mit genug Bewertungen trägt duenn:false', kats.find(k => k.kategorie === 'indikatoren').duenn === false)
    check('Quote je Kategorie korrekt berechnet', Math.abs(kats.find(k => k.kategorie === 'indikatoren').quote - 0.8) < 1e-9)

    /*
     * „Schwer" zählt auch je Kategorie in den Nenner. Ohne diese Prüfung liesse
     * sich `proKategorie` versehentlich auf die alte Zweiteilung zurückbauen,
     * während `uebersicht` bereits richtig rechnet — die beiden Zahlen stehen
     * auf derselben Seite untereinander und dürfen sich nicht widersprechen.
     */
    const mitSchwer = proKategorie([
        eintrag(karte(1, 'risiko'), { gesamtRichtig: 2, gesamtSchwer: 1, gesamtFalsch: 1 }),
    ])
    check('Kategorie-Quote nimmt „Schwer" in den Nenner', Math.abs(mitSchwer[0].quote - 0.5) < 1e-9, `quote=${mitSchwer[0].quote}`)
    check('Kategorie-Anzahl zählt „Schwer" mit (steuert duenn)', mitSchwer[0].anzahl === 4, `n=${mitSchwer[0].anzahl}`)
}

// ── werteAus() — Gesamtpaket ──────────────────────────────────────────────
console.log('\nwerteAus()')
{
    const eintraege = [eintrag(karte(1, 'indikatoren'), { box: 2, gesamtRichtig: 1, gesamtFalsch: 0, historie: historie([JETZT, 'gut']) })]
    const w = werteAus(eintraege, JETZT)
    check('werteAus liefert alle vier Bausteine', 'uebersicht' in w && 'proTag' in w && 'serie' in w && 'kategorien' in w)
    check('werteAus.serie stimmt mit lernserie() überein', w.serie === lernserie(eintraege, JETZT))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\n`)
if (fehlgeschlagen > 0) {
    console.log('Fehlgeschlagen:', fehler.join(', '))
    process.exit(1)
}
