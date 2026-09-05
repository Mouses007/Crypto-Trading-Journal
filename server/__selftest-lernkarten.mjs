/**
 * Selbsttest des Starter-Decks (server/default-lernkarten.js).
 *
 * Prüft die STRUKTUR, nicht den Inhalt — Fachaussagen lassen sich nicht per
 * Test verifizieren, ein doppelter `schluessel` oder eine Kategorie, die die
 * Oberfläche nicht kennt, dagegen schon. Beides fällt sonst erst auf, wenn
 * eine Karte in `Lernen.vue` als leeres Label erscheint oder das Seeding an
 * der Unique-Bedingung `uq_quiz_karten_schluessel` scheitert.
 *
 *   node server/__selftest-lernkarten.mjs
 */
import { readFile } from 'node:fs/promises'
import { LERNKARTEN_DEFS } from './default-lernkarten.js'

// Muss deckungsgleich zu KATEGORIEN in src/views/Lernen.vue sein — eine
// Kategorie ohne dortigen Eintrag hat auch keinen i18n-Schlüssel.
const KATEGORIEN = ['indikatoren', 'derivate', 'sentiment', 'chartAnalyse', 'risiko', 'markt', 'onchain']
// Muss deckungsgleich zu NIVEAUS in src/views/Lernen.vue sein — eine Karte
// mit unbekanntem Niveau ist über keinen Filter mehr erreichbar.
const NIVEAUS = [1, 2, 3]

let ok = 0, fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

console.log('\nStarter-Deck der Lernkarten')

const schluessel = LERNKARTEN_DEFS.map(k => k.schluessel)
const doppelt = [...new Set(schluessel.filter((s, i) => schluessel.indexOf(s) !== i))]
pruefe('Jeder schluessel kommt genau einmal vor', doppelt.length === 0, doppelt.join(', '))

const ohneSchluessel = LERNKARTEN_DEFS.filter(k => !k.schluessel || !/^[a-zA-Z0-9]+$/.test(k.schluessel))
pruefe('Jeder schluessel ist gesetzt und alphanumerisch', ohneSchluessel.length === 0,
    ohneSchluessel.map(k => k.frage?.slice(0, 40)).join(' | '))

const leer = LERNKARTEN_DEFS.filter(k => !k.frage?.trim() || !k.antwort?.trim())
pruefe('Keine Karte ohne Frage oder Antwort', leer.length === 0, leer.map(k => k.schluessel).join(', '))

const falscheKat = LERNKARTEN_DEFS.filter(k => !KATEGORIEN.includes(k.kategorie))
pruefe('Jede Kategorie ist der Oberfläche bekannt', falscheKat.length === 0,
    falscheKat.map(k => `${k.schluessel}:${k.kategorie}`).join(', '))

const falschesNiveau = LERNKARTEN_DEFS.filter(k => k.niveau !== undefined && !NIVEAUS.includes(k.niveau))
pruefe('Jedes gesetzte Niveau ist filterbar', falschesNiveau.length === 0,
    falschesNiveau.map(k => `${k.schluessel}:${k.niveau}`).join(', '))

// Eine Frage ohne Fragezeichen ist meist eine versehentlich vertauschte
// Frage/Antwort-Zuordnung — beim Lernen fällt das erst spät auf.
const ohneFrage = LERNKARTEN_DEFS.filter(k => !k.frage.includes('?'))
pruefe('Jede Frage ist als Frage formuliert', ohneFrage.length === 0, ohneFrage.map(k => k.schluessel).join(', '))

// Die Antwort steht auf einer Karteikarte mit fester Höhe (lernen-card-box):
// alles jenseits von rund 300 Zeichen läuft dort aus dem Rahmen.
const zuLang = LERNKARTEN_DEFS.filter(k => k.antwort.length > 300)
pruefe('Keine Antwort sprengt die Karteikarte (max. 300 Zeichen)', zuLang.length === 0,
    zuLang.map(k => `${k.schluessel}:${k.antwort.length}`).join(', '))

// Jedes angebotene Niveau soll Karten haben, sonst zeigt der Filter eine leere
// Seite. Absichtlich NICHT je Kategorie geprüft: `indikatoren` hat kein Niveau
// 2/3 und `onchain` kein Niveau 1, und das ist in Ordnung — gefiltert wird nur
// nach Niveau, nicht nach Niveau × Kategorie.
const besetzt = new Set(LERNKARTEN_DEFS.map(k => k.niveau || 1))
pruefe('Jedes Niveau ist mit Karten belegt', NIVEAUS.every(n => besetzt.has(n)),
    NIVEAUS.filter(n => !besetzt.has(n)).join(', '))

/*
 * Erklärungen — das Feld, das von v14 bis zum 05.09.2026 an drei Stellen
 * zugleich nicht verdrahtet war. Die letzte Prüfung ist die wichtigste: sie
 * liest den Quelltext von `seedDefaultLernkarten`, weil ein fehlendes
 * `erklaerung` dort keinen Fehler wirft, sondern einfach nichts tut — und
 * zwar nur bei bestehenden Installationen, also nirgends, wo man hinschaut.
 */
const mitErklaerung = LERNKARTEN_DEFS.filter(k => String(k.erklaerung || '').trim())

// Der Ausklappbereich verträgt mehr als die Karteikarte, aber keine Aufsätze.
const erklaerungZuLang = mitErklaerung.filter(k => k.erklaerung.length > 600)
pruefe('Keine Erklärung länger als 600 Zeichen', erklaerungZuLang.length === 0,
    erklaerungZuLang.map(k => `${k.schluessel}:${k.erklaerung.length}`).join(', '))

// Eine Erklärung, die mit der Antwort beginnt, erklärt nichts — sie wiederholt.
const nurWiederholung = mitErklaerung.filter(k => {
    const a = k.antwort.slice(0, 60).toLowerCase()
    return k.erklaerung.toLowerCase().startsWith(a)
})
pruefe('Keine Erklärung wiederholt bloss die Antwort', nurWiederholung.length === 0,
    nurWiederholung.map(k => k.schluessel).join(', '))

const seedQuelle = await readFile(new URL('./default-lernkarten.js', import.meta.url), 'utf8')
const seedKoerper = seedQuelle.slice(seedQuelle.indexOf('export async function seedDefaultLernkarten'))
pruefe('seedDefaultLernkarten schreibt erklaerung beim Anlegen UND beim Nachführen',
    (seedKoerper.match(/erklaerung/g) || []).length >= 2,
    'ohne beide Stellen erreichen Erklärungen nur Neuinstallationen')

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler ? 1 : 0)
