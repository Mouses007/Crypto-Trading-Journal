/**
 * Läufer für alle Selbsttests des Projekts.
 *
 *   npm run test:self
 *
 * Es gibt kein Test-Framework und keine CI — dafür rund zwei Dutzend
 * eigenständige Selbsttest-Dateien, die man bisher einzeln von Hand starten
 * musste. Genau deshalb liefen sie selten alle. Dieser Läufer sammelt jede
 * `__selftest*.mjs` ein, startet sie NACHEINANDER in einem eigenen Prozess und
 * fasst am Ende zusammen.
 *
 * Eigener Prozess je Datei, weil die Tests `process.exit(1)` benutzen und
 * Zählerstände im Modulzustand halten — im selben Prozess würde der erste
 * Fehlschlag den Rest verschlucken.
 *
 * Keine DB, kein Netz: sollte je eine Datei eine laufende Datenbank brauchen,
 * gehört sie in AUSGENOMMEN (derzeit leer).
 */

import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Verzeichnisse, in denen Selbsttests liegen (nicht rekursiv gesucht). */
const ORTE = ['server', 'server/execution', 'server/strategies', 'src/utils', 'shared']

/** Dateien, die hier nicht hingehören (z.B. weil sie eine DB brauchen — derzeit keine). */
const AUSGENOMMEN = new Set([])

const gruen = (s) => `\x1b[32m${s}\x1b[0m`
const rot = (s) => `\x1b[31m${s}\x1b[0m`
const grau = (s) => `\x1b[90m${s}\x1b[0m`

async function sammle() {
    const treffer = []
    for (const ort of ORTE) {
        let eintraege
        try {
            eintraege = await readdir(path.join(wurzel, ort))
        } catch {
            continue
        }
        for (const name of eintraege) {
            if (!name.startsWith('__selftest') || !name.endsWith('.mjs')) continue
            const rel = `${ort}/${name}`
            if (AUSGENOMMEN.has(rel)) continue
            treffer.push(rel)
        }
    }
    return treffer.sort()
}

function starte(rel) {
    return new Promise((fertig) => {
        const kind = spawn(process.execPath, [rel], { cwd: wurzel })
        let ausgabe = ''
        kind.stdout.on('data', (d) => { ausgabe += d })
        kind.stderr.on('data', (d) => { ausgabe += d })
        kind.on('close', (code) => fertig({ rel, code, ausgabe }))
        kind.on('error', (e) => fertig({ rel, code: 1, ausgabe: String(e.message) }))
    })
}

/**
 * „40 bestanden, 0 fehlgeschlagen" bzw. „40 passed" aus der Ausgabe ziehen.
 * Wo keine Zahlen stehen, werden ersatzweise die Häkchen gezählt — die
 * Gesamtsumme soll nicht davon abhängen, wie eine Datei ihre Bilanz formuliert.
 */
function zaehle(ausgabe) {
    const m = ausgabe.match(/(\d+)\s+(?:bestanden|passed)[^\d]+(\d+)\s+(?:fehlgeschlagen|failed)/i)
    if (m) return { ok: Number(m[1]), fehler: Number(m[2]) }
    const haken = (ausgabe.match(/✓/g) || []).length
    const kreuze = (ausgabe.match(/✗/g) || []).length
    if (haken + kreuze === 0) return null
    return { ok: haken, fehler: kreuze }
}

const dateien = await sammle()
if (!dateien.length) {
    console.error('Keine Selbsttests gefunden.')
    process.exit(1)
}

console.log(`\nSelbsttests — ${dateien.length} Dateien\n`)

let dateienFehler = 0
let pruefungen = 0
let pruefungenFehler = 0
const gescheitert = []

for (const rel of dateien) {
    const { code, ausgabe } = await starte(rel)
    const zahlen = zaehle(ausgabe)
    if (zahlen) {
        pruefungen += zahlen.ok + zahlen.fehler
        pruefungenFehler += zahlen.fehler
    }
    const zusatz = zahlen ? grau(` ${zahlen.ok} Prüfungen`) : grau(' (keine Zählung gefunden)')
    if (code === 0) {
        console.log(`  ${gruen('✓')} ${rel}${zusatz}`)
    } else {
        dateienFehler++
        gescheitert.push(rel)
        console.log(`  ${rot('✗')} ${rel}${zusatz}`)
        // Nur die fehlgeschlagene Ausgabe zeigen — sonst ertrinkt der Befund.
        console.log(ausgabe.split('\n').map((z) => `      ${z}`).join('\n'))
    }
}

console.log(`\n${dateien.length - dateienFehler}/${dateien.length} Dateien grün, ${pruefungen - pruefungenFehler}/${pruefungen} Prüfungen bestanden`)
if (gescheitert.length) {
    console.log(rot(`Fehlgeschlagen: ${gescheitert.join(', ')}\n`))
    process.exit(1)
}
console.log('')
