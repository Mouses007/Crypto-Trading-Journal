/**
 * Selbsttest des Strategie-Baukastens.
 *
 *   node server/__selftest-builder.mjs
 *
 * Die zentrale Frage ist nicht, ob der Generator hübschen Code schreibt,
 * sondern ob er sicher bleibt, wenn das Sprachmodell sich danebenbenimmt.
 * Deshalb wird hier bewusst feindseliger Text durchgeschickt — mit
 * Anführungszeichen, Backslashes, Zeilenumbrüchen und Kommentar-Enden — und
 * die erzeugte Datei anschliessend WIRKLICH importiert.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { pruefeSpec, baueModulQuelltext } from './strategy-builder.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const MARKER = path.join(os.tmpdir(), 'ctj-baukasten-darf-nicht-existieren')
try { fs.unlinkSync(MARKER) } catch { /* war nicht da */ }

console.log('\nStrategie-Baukasten — Selbsttest\n')

// ── 1. Prüfung weist Unsinn ab ───────────────────────────────────────────
console.log('Prüfung der Beschreibung')

const boesartig = {
    slug: '../../etc/passwd',
    name: `Ausbruch'); require("child_process").execSync("touch ${MARKER}"); ('`,
    description: 'Zeile1\nZeile2 \\ Backslash */ Kommentarende',
    supportedTimeframes: ['1h', '7m', 'DROP TABLE'],
    warmupCandles: 99999,
    params: [
        { key: 'a; rm -rf /', type: 'number', default: 1, min: 0, max: 2 },
        { key: 'kaputt', type: 'zauberei', default: 1 },
        { key: 'ohneGrenzen', type: 'number', default: 'abc' },
        { key: 'gut', type: 'number', default: 25, min: 5, max: 60, group: 'entry' },
        { key: 'gut', type: 'number', default: 1, min: 0, max: 2 },
        { key: 'wahl', type: 'select', options: ['a', 'b'], default: 'z' },
    ],
    rules: { context: 'x */ evil() /*', entryLong: ['Schritt eins'], entryShort: [],
             invalidations: [{ code: 'Zu Tief!!', description: 'y' }], stopLoss: 's', takeProfit: 't' },
    detectPseudocode: ['Prüfe X'],
}

const g = pruefeSpec(boesartig)
check('feindselige Beschreibung wird abgelehnt', g.ok === false, `ok=${g.ok}`)
check('Pfadausbruch im Kurznamen erkannt', g.fehler.some((f) => f.includes('Kurzname')))
check('Parametername mit Befehl abgelehnt', g.fehler.some((f) => f.includes('rm -rf')))
check('unbekannter Parametertyp abgelehnt', g.fehler.some((f) => f.includes('zauberei')))
check('doppelter Parameter abgelehnt', g.fehler.some((f) => f.includes('Doppelter')))
check('ungültige Zeiteinheiten gefiltert', JSON.stringify(g.spec.supportedTimeframes) === '["1h"]')
check('warmupCandles geklemmt', g.spec.warmupCandles === 2000)
check('ungültiger select-Standard korrigiert', g.spec.params.find((p) => p.key === 'wahl')?.default === 'a')
check('Invalidierungs-Code normalisiert', /^[a-z0-9_]+$/.test(g.spec.rules.invalidations[0].code))

// ── 2. Erzeugter Code bleibt gültig und harmlos ──────────────────────────
console.log('\nErzeugte Moduldatei')

// Bewusst mit der bereinigten, aber immer noch feindseligen Textmenge bauen
const spec = { ...g.spec, slug: 'boesartig_test' }
const quelltext = baueModulQuelltext(spec)

const tmp = path.join(os.tmpdir(), `ctj-entwurf-${Date.now()}.mjs`)
fs.writeFileSync(tmp, quelltext, 'utf8')

let modul = null
let importFehler = null
try {
    modul = (await import('file://' + tmp)).default
} catch (e) {
    importFehler = e.message
}

check('Datei ist gültiges JavaScript', !!modul, importFehler)
check('Import führt keinen fremden Code aus', !fs.existsSync(MARKER),
    'Marker-Datei wurde angelegt — Code aus dem Modelltext lief!')

if (modul) {
    check('Parameter-Schema übernommen', Array.isArray(modul.params) && modul.params.length === 2,
        `params=${modul.params?.length}`)
    check('Kurzname trägt Entwurfs-Präfix', modul.id === 'entwurf_boesartig_test', modul.id)
    check('Name als Entwurf gekennzeichnet', String(modul.name).includes('(Entwurf)'))

    let warf = false
    let meldung = ''
    try { modul.detect({ candles: [], params: {}, openSetups: [] }) }
    catch (e) { warf = true; meldung = e.message }
    check('detect() wirft statt zu handeln', warf, meldung.slice(0, 60))
    check('Fehlermeldung nennt den Entwurfsstatus', meldung.includes('Entwurf'))
}

// ── 3. Gutmütiger Fall funktioniert weiterhin ────────────────────────────
console.log('\nNormalfall')

const brav = pruefeSpec({
    slug: 'ema_kreuzung',
    name: 'EMA-Kreuzung',
    description: 'Schneller EMA kreuzt langsamen EMA.',
    supportedTimeframes: ['15m', '1h', '4h'],
    warmupCandles: 300,
    paramGroups: [{ id: 'signal', label: 'Signal' }],
    params: [
        { key: 'schnell', type: 'integer', default: 9, min: 2, max: 100, group: 'signal', label: 'Schneller EMA' },
        { key: 'langsam', type: 'integer', default: 21, min: 3, max: 400, group: 'signal', label: 'Langsamer EMA' },
        { key: 'nurLong', type: 'boolean', default: false, group: 'signal', label: 'Nur Long' },
    ],
    rules: { context: 'Trendfolge', entryLong: ['Schnell kreuzt langsam nach oben'], entryShort: ['Umgekehrt'],
             invalidations: [{ code: 'gegenkreuzung', description: 'Kreuzt zurück' }],
             stopLoss: 'Unter dem letzten Swing-Tief', takeProfit: '2R' },
    detectPseudocode: ['EMAs berechnen', 'Kreuzung suchen'],
})
check('gültige Beschreibung wird angenommen', brav.ok, brav.fehler.join(', '))

const tmp2 = path.join(os.tmpdir(), `ctj-entwurf2-${Date.now()}.mjs`)
fs.writeFileSync(tmp2, baueModulQuelltext(brav.spec), 'utf8')
const m2 = (await import('file://' + tmp2)).default
check('drei Parameter erhalten', m2.params.length === 3)
check('Wertebereiche erhalten', m2.params[0].min === 2 && m2.params[0].max === 100)
check('boolescher Standard erhalten', m2.params[2].default === false)
check('Zeiteinheiten erhalten', JSON.stringify(m2.supportedTimeframes) === '["15m","1h","4h"]')
check('Invalidierungs-Codes exportiert', quelltext.includes('INVALID_REASONS'))

// ── 4. Registry lädt Entwürfe nicht ──────────────────────────────────────
console.log('\nAbschottung')
const registry = fs.readFileSync(new URL('./strategies/index.js', import.meta.url), 'utf8')
check('Registry importiert nur ausdrücklich benannte Strategien',
    !/readdir|glob|import\s*\(/.test(registry) && registry.includes("import lsob from './lsob.js'"))
check('Registry importiert keine Entwürfe', !registry.includes('_entwurf'))

fs.unlinkSync(tmp); fs.unlinkSync(tmp2)

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log(`\nFehlgeschlagen:\n  ${fehler.join('\n  ')}\n`); process.exit(1) }
console.log('')
