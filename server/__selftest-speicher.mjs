/**
 * Selbsttest der Speicher-Gruppierung (Einstellungen → Allgemein).
 *
 *   node server/__selftest-speicher.mjs
 *
 * Die wichtigste Zusicherung: eine Tabelle OHNE Modulzuordnung verschwindet
 * nicht, sondern landet in 'system' — neues Wachstum darf nie unsichtbar
 * sein, nur weil die Liste in speicher-api.js nicht nachgezogen wurde.
 */
import { gruppiereSpeicher, SPEICHER_MODULE, AUFRAEUM_AKTIONEN } from './speicher-api.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nSpeicher-Gruppierung — Selbsttest\n')

const module = gruppiereSpeicher([
    { name: 'trades', bytes: 500, zeilen: 10 },
    { name: 'notes', bytes: 300, zeilen: 5 },
    { name: 'screenshots', bytes: 9000, zeilen: 3 },
    { name: 'voellig_neu', bytes: 42, zeilen: 1 },
    { name: 'settings', bytes: 8, zeilen: 1 },
])

const je = (id) => module.find((m) => m.id === id)

check('bekannte Tabellen landen in ihrem Modul',
    je('journal')?.bytes === 800 && je('journal')?.zeilen === 15,
    JSON.stringify(je('journal')))
check('unbekannte Tabelle landet in system, nicht im Nichts',
    je('system')?.tabellen.some((t) => t.name === 'voellig_neu') && je('system')?.bytes === 50,
    JSON.stringify(je('system')))
check('leere Module werden weggelassen', !je('lernen') && !je('ki'))
check('Module nach Grösse sortiert, grösstes zuerst',
    module[0]?.id === 'screenshots', module.map((m) => m.id).join(','))
check('Tabellen im Modul nach Grösse sortiert',
    je('journal')?.tabellen[0]?.name === 'trades')

// Unbekannte Grösse (SQLite ohne dbstat) darf nicht als 0 verkauft werden
const ohneBytes = gruppiereSpeicher([
    { name: 'trades', bytes: null, zeilen: 7 },
    { name: 'notes', bytes: 100, zeilen: 2 },
])
check('eine unbekannte Tabellengrösse macht die Modulgrösse unbekannt',
    ohneBytes.find((m) => m.id === 'journal')?.bytes === null,
    JSON.stringify(ohneBytes))
check('Zeilen zählen auch ohne Grössen weiter',
    ohneBytes.find((m) => m.id === 'journal')?.zeilen === 9)

// Die Zuordnung selbst: keine Tabelle darf in zwei Modulen stehen
const alle = Object.values(SPEICHER_MODULE).flat()
check('keine Tabelle doppelt zugeordnet', new Set(alle).size === alle.length)

// Aufräum-Katalog: jede Aktion zeigt auf ein existierendes Modul und dessen
// Tabelle, und die Mindestalter-Sperre existiert — sie ist der Schutz davor,
// dass ein Tippfehler („0 Tage") den ganzen Bestand löscht.
for (const [id, a] of Object.entries(AUFRAEUM_AKTIONEN)) {
    check(`Aktion ${id}: Modul bekannt und Tabelle zugeordnet`,
        SPEICHER_MODULE[a.modul]?.includes(a.tabelle), JSON.stringify(a.tabelle))
    check(`Aktion ${id}: Mindestalter >= 14 Tage, Vorgabe darüber`,
        a.minTage >= 14 && a.vorgabeTage >= a.minTage, `min=${a.minTage} vorgabe=${a.vorgabeTage}`)
    check(`Aktion ${id}: rührt keine Benutzerinhalte an`,
        !['trades', 'notes', 'screenshots', 'playbooks', 'diaries', 'ai_reports'].includes(a.tabelle))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
