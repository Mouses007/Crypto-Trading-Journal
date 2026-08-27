/**
 * Selbsttest des Leitner-Karteikastens.
 *
 *   node shared/__selftest-leitner.mjs
 */

import {
    BOX_MIN, BOX_MAX, INTERVALL_TAGE,
    GRADE_VERGESSEN, GRADE_SCHWER, GRADE_GUT, GRADE_LEICHT,
    naechsteBox, naechsteFaelligkeit, istFaellig, kartenFaellig, boxVerteilung, auswerten, parseHistorie,
} from './leitner.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const TAG_MS = 24 * 60 * 60 * 1000
const JETZT = 1_800_000_000_000 // fester Zeitpunkt, damit der Test deterministisch bleibt

console.log('\nLeitner-Karteikasten — Selbsttest\n')

// ── Box-Übergänge je Bewertungsstufe ──────────────────────────────────────
console.log('Box-Übergänge')
{
    check('Gut: Box 1 → Box 2', naechsteBox(1, GRADE_GUT) === 2)
    check('Gut: Box 2 → Box 3', naechsteBox(2, GRADE_GUT) === 3)
    check('Gut: Box 3 → Box 4', naechsteBox(3, GRADE_GUT) === 4)
    check('Gut: Box 4 bleibt bei Box 4 (Deckel)', naechsteBox(4, GRADE_GUT) === BOX_MAX)

    check('Leicht: Box 1 → Box 3 (Doppelsprung)', naechsteBox(1, GRADE_LEICHT) === 3)
    check('Leicht: Box 3 → Box 4 (Deckel greift auch bei Doppelsprung)', naechsteBox(3, GRADE_LEICHT) === BOX_MAX)
    check('Leicht: Box 4 bleibt bei Box 4', naechsteBox(4, GRADE_LEICHT) === BOX_MAX)

    check('Schwer: Box 2 bleibt bei Box 2 (kein Sprung, kein Reset)', naechsteBox(2, GRADE_SCHWER) === 2)
    check('Schwer: Box 1 bleibt bei Box 1', naechsteBox(1, GRADE_SCHWER) === 1)

    check('Vergessen: Box 4 → zurück auf Box 1', naechsteBox(4, GRADE_VERGESSEN) === BOX_MIN)
    check('Vergessen: Box 1 bleibt auf Box 1', naechsteBox(1, GRADE_VERGESSEN) === BOX_MIN)

    check('Fehlende/ungültige Box wird als Box 1 behandelt', naechsteBox(undefined, GRADE_GUT) === 2)
    check('Box ausserhalb des Bereichs (0) wird als Box 1 behandelt', naechsteBox(0, GRADE_GUT) === 2)
    check('Unbekannte Bewertung verhält sich wie „Schwer" (kein Sprung, kein Reset)', naechsteBox(2, 'irgendwas') === 2)
}

// ── Intervall-Mathematik ──────────────────────────────────────────────────
console.log('\nIntervalle je Box')
{
    check('Box 1: sofort fällig (0 Tage)', naechsteFaelligkeit(JETZT, 1) === JETZT)
    check('Box 2: 1 Tag', naechsteFaelligkeit(JETZT, 2) === JETZT + 1 * TAG_MS)
    check('Box 3: 3 Tage', naechsteFaelligkeit(JETZT, 3) === JETZT + 3 * TAG_MS)
    check('Box 4: 7 Tage', naechsteFaelligkeit(JETZT, 4) === JETZT + 7 * TAG_MS)
    check('INTERVALL_TAGE deckt alle Boxen ab', Object.keys(INTERVALL_TAGE).length === BOX_MAX - BOX_MIN + 1)
}

// ── Fälligkeit ────────────────────────────────────────────────────────────
console.log('\nFälligkeit')
{
    check('Ohne faelligAm ist eine Karte sofort fällig', istFaellig(JETZT, {}))
    check('faelligAm === jetzt gilt als fällig (Grenzfall)', istFaellig(JETZT, { faelligAm: JETZT }))
    check('faelligAm in der Zukunft ist nicht fällig', !istFaellig(JETZT, { faelligAm: JETZT + TAG_MS }))
    check('faelligAm in der Vergangenheit ist fällig', istFaellig(JETZT, { faelligAm: JETZT - TAG_MS }))

    const liste = [
        { id: 1, faelligAm: JETZT - TAG_MS },   // überfällig
        { id: 2, faelligAm: JETZT },            // genau jetzt
        { id: 3, faelligAm: JETZT + TAG_MS },   // erst morgen
    ]
    const faellig = kartenFaellig(JETZT, liste)
    check('kartenFaellig nimmt Überfällige und Grenzfall, lässt Zukünftige weg',
        faellig.length === 2 && faellig.map(f => f.id).sort().join(',') === '1,2')
}

// ── Box-Verteilung ────────────────────────────────────────────────────────
console.log('\nBox-Verteilung')
{
    const liste = [{ box: 1 }, { box: 1 }, { box: 2 }, { box: 4 }, { box: undefined }]
    const v = boxVerteilung(liste)
    const summe = Object.values(v).reduce((a, b) => a + b, 0)
    check('Summe der Verteilung entspricht der Kartenzahl', summe === liste.length, `Summe=${summe}`)
    check('Fehlende Box zählt als Box 1', v[1] === 3, `Box1=${v[1]}`)
    check('Box 4 korrekt gezählt', v[4] === 1)
    check('Box 3 ist 0, wenn keine Karte dort liegt', v[3] === 0)
}

// ── auswerten() — der zentrale Zustandsübergang ──────────────────────────
console.log('\nauswerten()')
{
    const start = null
    const r1 = auswerten(start, GRADE_GUT, JETZT)
    check('Erste Bewertung ohne Vorzustand: Box 2, Streak 1', r1.box === 2 && r1.richtigStreak === 1)
    check('gesamtRichtig/gesamtFalsch starten bei 1/0', r1.gesamtRichtig === 1 && r1.gesamtFalsch === 0)

    const r2 = auswerten(r1, GRADE_LEICHT, JETZT + TAG_MS)
    check('„Leicht" nach Box 2 springt auf Box 4 (Deckel), Streak wächst weiter', r2.box === 4 && r2.richtigStreak === 2)

    const r3 = auswerten(r2, GRADE_VERGESSEN, JETZT + 2 * TAG_MS)
    check('„Vergessen" wirft von Box 4 zurück auf Box 1 und killt den Streak', r3.box === 1 && r3.richtigStreak === 0)
    check('gesamtFalsch zählt nur „Vergessen"', r3.gesamtFalsch === 1 && r3.gesamtRichtig === 2)

    const r4 = auswerten(r3, GRADE_SCHWER, JETZT + 3 * TAG_MS)
    check('„Schwer" nach Reset bleibt auf Box 1 (kein weiterer Rückfall möglich)', r4.box === 1)
    check('„Schwer" zählt als gewusst (Streak läuft weiter)', r4.richtigStreak === 1 && r4.gesamtFalsch === 1)

    let historie = JSON.parse(r4.historie)
    check('Historie sammelt alle vier Einträge samt Bewertung', historie.length === 4 && historie[0].grad === GRADE_GUT)

    let letzter = r4
    for (let i = 0; i < 30; i++) letzter = auswerten(letzter, GRADE_GUT, JETZT + i * TAG_MS)
    historie = JSON.parse(letzter.historie)
    check('Historie bleibt auf 20 Einträge gedeckelt', historie.length === 20, `len=${historie.length}`)

    const kaputt = { box: 4, historie: 'nicht-json' }
    const r5 = auswerten(kaputt, GRADE_GUT, JETZT)
    check('Kaputte Historie wird stillschweigend zurückgesetzt statt zu werfen', JSON.parse(r5.historie).length === 1)

    /*
     * Regressionsfall: die generische DB-Route parst deklarierte JSON-Spalten
     * beim Lesen automatisch (siehe JSON_COLUMNS in server/api-routes.js) —
     * `fortschritt.historie` kommt im Browser deshalb als Array an, nicht als
     * Text. Ohne parseHistorie() würde JSON.parse() daran scheitern und jede
     * bisherige Historie bei jedem Seiten-Reload auf einen Eintrag zurückfallen.
     */
    const alsArrayLoaded = { box: 2, historie: [{ t: JETZT - TAG_MS, grad: GRADE_GUT }] }
    const r6 = auswerten(alsArrayLoaded, GRADE_GUT, JETZT)
    check('Bereits als Array geladene Historie wird erkannt statt verworfen', JSON.parse(r6.historie).length === 2, JSON.parse(r6.historie).length)
}

console.log('\nparseHistorie()')
{
    check('Array bleibt Array', parseHistorie([{ t: 1, grad: 'gut' }]).length === 1)
    check('JSON-Text wird geparst', parseHistorie('[{"t":1,"grad":"gut"}]').length === 1)
    check('Leerer/undefined Wert ergibt leeres Array', parseHistorie(undefined).length === 0)
    check('Kaputter Text ergibt leeres Array statt zu werfen', parseHistorie('nicht-json').length === 0)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\n`)
if (fehlgeschlagen > 0) {
    console.log('Fehlgeschlagen:', fehler.join(', '))
    process.exit(1)
}
