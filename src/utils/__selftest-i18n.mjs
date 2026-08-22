/**
 * Selbsttest: de.json und en.json haben denselben Schlüsselbestand.
 *
 *   node src/utils/__selftest-i18n.mjs
 *
 * Heute stimmen beide Dateien exakt überein — genau deshalb lohnt der Test:
 * er hält den Zustand fest. Eine fehlende Übersetzung fällt sonst erst auf,
 * wenn jemand die Oberfläche auf Englisch stellt und dort einen rohen
 * Schlüssel wie `liveSessions.planMaxTrades` liest.
 *
 * Geprüft wird der Bestand, nicht der Inhalt: dass ein englischer Text
 * tatsächlich englisch ist, kann keine Maschine entscheiden. Zusätzlich
 * geprüft werden die Platzhalter ({name}), denn ein fehlender Platzhalter ist
 * ein echter Fehler — die Zahl fehlt dann in der Ausgabe.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const hier = path.dirname(fileURLToPath(import.meta.url))
const ordner = path.resolve(hier, '../i18n/locales')

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

/** Alle Blattpfade eines Objekts, Arrays inklusive Index. */
function pfade(wert, praefix = '', raus = new Map()) {
    if (Array.isArray(wert)) {
        wert.forEach((v, i) => pfade(v, `${praefix}[${i}]`, raus))
    } else if (wert && typeof wert === 'object') {
        for (const [k, v] of Object.entries(wert)) {
            pfade(v, praefix ? `${praefix}.${k}` : k, raus)
        }
    } else {
        raus.set(praefix, wert)
    }
    return raus
}

/** Platzhalter der Form {name} — die Reihenfolge ist egal, der Bestand nicht. */
function platzhalter(text) {
    if (typeof text !== 'string') return []
    return [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
}

console.log('i18n-Parität')

const de = JSON.parse(fs.readFileSync(path.join(ordner, 'de.json'), 'utf8'))
const en = JSON.parse(fs.readFileSync(path.join(ordner, 'en.json'), 'utf8'))

const dePfade = pfade(de)
const enPfade = pfade(en)

const nurDe = [...dePfade.keys()].filter(k => !enPfade.has(k))
const nurEn = [...enPfade.keys()].filter(k => !dePfade.has(k))

pruefe('kein Schlüssel fehlt im Englischen',
    nurDe.length === 0, nurDe.slice(0, 8).join(', '))
pruefe('kein Schlüssel fehlt im Deutschen',
    nurEn.length === 0, nurEn.slice(0, 8).join(', '))
pruefe('gleiche Anzahl Schlüssel',
    dePfade.size === enPfade.size, `${dePfade.size} vs ${enPfade.size}`)

// Leere Übersetzungen sind schlimmer als fehlende: vue-i18n zeigt bei einem
// fehlenden Schlüssel den Schlüsselnamen, bei einem leeren Text gar nichts.
const leerDe = [...dePfade].filter(([, v]) => v === '').map(([k]) => k)
const leerEn = [...enPfade].filter(([, v]) => v === '').map(([k]) => k)
pruefe('keine leeren Texte im Deutschen', leerDe.length === 0, leerDe.slice(0, 5).join(', '))
pruefe('keine leeren Texte im Englischen', leerEn.length === 0, leerEn.slice(0, 5).join(', '))

const platzhalterAbweichung = []
for (const [pfad, deText] of dePfade) {
    if (!enPfade.has(pfad)) continue
    const a = platzhalter(deText).join(',')
    const b = platzhalter(enPfade.get(pfad)).join(',')
    if (a !== b) platzhalterAbweichung.push(`${pfad} (de: ${a || '—'} / en: ${b || '—'})`)
}
pruefe('gleiche Platzhalter in beiden Sprachen',
    platzhalterAbweichung.length === 0, platzhalterAbweichung.slice(0, 5).join(' | '))

/*
 * Nacktes @ — der Fehler, der die ganze Seite abschiesst.
 *
 * vue-i18n liest `@` als Beginn einer VERKNÜPFTEN Meldung (`@:anderer.key`).
 * Steht in einem Text eine E-Mail-Adresse, wirft der Tokenizer
 * „Invalid linked format", und dann rendert nicht etwa nur dieser Text falsch,
 * sondern die ganze Komponente gar nicht mehr — am 22.08.2026 war die
 * komplette Einstellungsseite deswegen leer. Geschrieben werden muss `{'@'}`.
 *
 * Der Test läuft über ALLE Texte, nicht nur über neue: Ein solcher Fehler
 * kommt beim nächsten Beispiel mit Adresse sofort wieder.
 */
const nacktesAt = []
for (const [dateiName, karte] of [['de', dePfade], ['en', enPfade]]) {
    for (const [pfad, text] of karte) {
        if (typeof text !== 'string') continue
        // Erlaubt ist nur die geschützte Form {'@'}; alles andere ist der Fehler.
        if (/(?<!\{')@/.test(text)) nacktesAt.push(`${dateiName}:${pfad}`)
    }
}
pruefe("kein ungeschütztes @ in den Texten (muss {'@'} heissen)",
    nacktesAt.length === 0, nacktesAt.slice(0, 5).join(', '))

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
