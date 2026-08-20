/**
 * Selbsttest: welche Anfragen länger dauern dürfen.
 *
 * Anlass war zweimal derselbe Fehler an verschiedenen Stellen: Der Browser gab
 * nach dem Hausstandard von 20 Sekunden auf, während der Server weiterrechnete
 * — beim Lagebericht (gemessen 5 min 49 s) und bei der Gesamtlage-Kachel. Die
 * Oberfläche meldete einen Fehler für Arbeit, die gelang und bezahlt wurde.
 *
 * Geprüft wird die reine Zuordnung Pfad → Frist, ohne Axios und ohne Netz.
 *
 * Aufruf: node src/utils/__selftest-timeouts.mjs
 */
import { langsameFrist, LANGSAME_PFADE } from './db.js'

let fehler = 0
let bestanden = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Fristen langsamer Anfragen')

const MIN = 60 * 1000

// ── 1) Die bekannten Langläufer ──────────────────────────────────────────
pruefe('Lagebericht erzeugen: 10 Minuten',
    langsameFrist('/api/marktradar/lagebericht/erzeugen') === 10 * MIN)
pruefe('Lagebericht aktualisieren ebenso',
    langsameFrist('/api/marktradar/lagebericht/aktualisieren') === 10 * MIN)
pruefe('Gesamtlage-Kachel: 5 Minuten', langsameFrist('/api/marktradar/lage') === 5 * MIN)
pruefe('Anweisung prüfen: 2 Minuten',
    langsameFrist('/api/marktradar/lagebericht/anweisung-pruefen') === 2 * MIN)
pruefe('Beiträge holen: 3 Minuten', langsameFrist('/api/marktradar/news/holen') === 3 * MIN)
pruefe('Agent-Chat fällt unter /api/ai/', langsameFrist('/api/ai/agent/chat') === 10 * MIN)
pruefe('Backtest: 15 Minuten', langsameFrist('/api/strategies/backtest') === 15 * MIN)
pruefe('Hype-Radar-Scan: 15 Minuten', langsameFrist('/api/hype-radar/scan') === 15 * MIN)

// ── 2) Gewöhnliche Abrufe bleiben beim Hausstandard ──────────────────────
// Das ist der Sinn der Liste: Ein hängender Datenabruf soll weiterhin nach 20
// Sekunden als Fehler sichtbar werden statt als Stillstand.
for (const pfad of ['/api/db/trades', '/api/marktradar/fear-greed', '/api/settings',
    '/api/bitunix/positions', '/api/marktradar/lagebericht', '/api/marktradar/kalender']) {
    pruefe(`${pfad} bleibt beim Standard`, langsameFrist(pfad) === null, String(langsameFrist(pfad)))
}

// Der Lesepfad des Berichts (GET ohne Zusatz) darf NICHT mitgefangen werden —
// er liest nur die Datenbank und muss schnell fehlschlagen.
pruefe('Bericht lesen ist kein Langläufer', langsameFrist('/api/marktradar/lagebericht') === null)
pruefe('Bericht aus dem Archiv lesen ebenso', langsameFrist('/api/marktradar/lagebericht/12') === null)

// ── 3) Robustheit ────────────────────────────────────────────────────────
pruefe('leere Adresse: Standard', langsameFrist('') === null && langsameFrist(undefined) === null)
pruefe('jede Regel hat Muster und Frist',
    LANGSAME_PFADE.every(p => p.muster instanceof RegExp && Number.isFinite(p.ms) && p.ms > 0))
pruefe('keine Frist unter einer Minute — darunter wäre es kein Langläufer',
    LANGSAME_PFADE.every(p => p.ms >= MIN))

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
