/**
 * Regressionstest der Backup-Tabellenlisten (`server/backup-api.js`).
 *
 *   node server/__selftest-backup.mjs
 *
 * Dieser Test existiert wegen eines Fehlers, den erst ein externes Audit fand:
 * Acht neue Radar-Tabellen wurden in `BACKUP_TABLES` ergänzt, aber nicht in
 * `DELETE_ORDER`. Der Export war danach vollständig — die RÜCKSICHERUNG nicht:
 * die Tabellen wurden vor dem Import nicht geleert, gleiche IDs kollidierten
 * mit dem Primärschlüssel, und weil alles in EINER Transaktion läuft, rollte
 * der Konflikt die komplette Wiederherstellung zurück. Aus einer Lücke in der
 * Sicherung wurde damit ein Totalausfall der Sicherung.
 *
 * Das fiel niemandem auf, weil ein Import in eine LEERE Datenbank fehlerfrei
 * durchläuft — und genau so wird von Hand getestet.
 *
 * Geprüft wird der Quelltext, nicht die Laufzeit: die Listen sind Konstanten,
 * und ein Test, der eine Datenbank braucht, liefe im `npm run test:self` nicht
 * mit (kein Netz, keine DB). Gegenprobe gemacht: entfernt man eine Tabelle aus
 * `DELETE_ORDER`, schlägt der Test fehl.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const hier = path.dirname(fileURLToPath(import.meta.url))
const quelle = fs.readFileSync(path.join(hier, 'backup-api.js'), 'utf8')

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; console.log(`  ✓ ${name}`) }
    else { fehler++; console.log(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

/** Liest ein `const NAME = [ ... ]` als Liste von Zeichenketten aus dem Quelltext. */
function liste(name) {
    const treffer = quelle.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\n\\]`))
    if (!treffer) return null
    return [...treffer[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

console.log('\nBackup-Tabellenlisten')

const gesichert = liste('BACKUP_TABLES')
const geloescht = liste('DELETE_ORDER')

pruefe('BACKUP_TABLES gefunden', Array.isArray(gesichert) && gesichert.length > 10)
pruefe('DELETE_ORDER gefunden', Array.isArray(geloescht) && geloescht.length > 10)

if (gesichert && geloescht) {
    const ohneLoeschung = gesichert.filter((t) => !geloescht.includes(t))
    pruefe(
        'jede gesicherte Tabelle wird vor dem Import geleert',
        ohneLoeschung.length === 0,
        `fehlt in DELETE_ORDER: ${ohneLoeschung.join(', ')}`,
    )

    const ohneSicherung = geloescht.filter((t) => !gesichert.includes(t))
    pruefe(
        'keine Tabelle wird geleert, die gar nicht gesichert wurde',
        ohneSicherung.length === 0,
        `nur in DELETE_ORDER: ${ohneSicherung.join(', ')}`,
    )

    pruefe('keine doppelten Einträge in DELETE_ORDER', new Set(geloescht).size === geloescht.length)
    pruefe('keine doppelten Einträge in BACKUP_TABLES', new Set(gesichert).size === gesichert.length)

    // Reihenfolge: Abhängiges muss VOR seinem Ziel gelöscht werden.
    const vorRang = (a, b) => geloescht.indexOf(a) < geloescht.indexOf(b)
    const paare = [
        ['coinradar_zeilen', 'coinradar_laeufe'],
        ['hype_alarme', 'hype_favoriten'],
        ['ai_report_messages', 'ai_reports'],
        ['strategy_trades', 'strategy_instances'],
    ]
    for (const [abhaengig, ziel] of paare) {
        if (geloescht.includes(abhaengig) && geloescht.includes(ziel)) {
            pruefe(`${abhaengig} wird vor ${ziel} geleert`, vorRang(abhaengig, ziel))
        }
    }

    // `settings` trägt die Geheimnisse und muss zuletzt fallen.
    pruefe('settings steht am Ende der Löschreihenfolge', geloescht[geloescht.length - 1] === 'settings')
}

console.log(`\n${fehler === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler === 0 ? 0 : 1)
