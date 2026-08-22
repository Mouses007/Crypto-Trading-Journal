/**
 * Selbsttest der Zustandsabbildung eigener Datenströme.
 *
 *   node src/utils/__selftest-kachel-zustand.mjs
 *
 * Klein, aber nicht überflüssig: Die Tabelle entscheidet, ob ein abgerissener
 * Orderbuch-Socket im Handelsfenster als Störung sichtbar wird oder als grüner
 * Punkt über einer eingefrorenen Karte. Ein Tippfehler in einem Schlüssel wäre
 * genau der alte Fehler in neuer Verkleidung — und ohne Test fällt er erst
 * auf, wenn die Verbindung wirklich abreisst.
 */

import { rasterZustand, BEKANNTE_ZUSTAENDE } from './kachelZustand.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nZustandsabbildung\n')

check('live ist bereit', rasterZustand('live') === 'ready')
check('replay ist bereit', rasterZustand('replay') === 'ready')
check('connecting lädt', rasterZustand('connecting') === 'loading')
check('syncing lädt', rasterZustand('syncing') === 'loading')
check('error ist Fehler', rasterZustand('error') === 'error')

console.log('\nEin stehendes Bild ist nicht „bereit"\n')

// Der Kern der Sache: bei diesen drei steht etwas auf dem Schirm, das nicht
// mehr wächst. Wären sie 'ready', wäre der alte Fehler zurück.
for (const z of ['reconnecting', 'paused', 'empty']) {
    check(`${z} ist veraltet`, rasterZustand(z) === 'veraltet', rasterZustand(z))
}

console.log('\nUnbekanntes wird nicht schöngerechnet\n')

check('unbekannter Zustand ergibt idle', rasterZustand('irgendwas') === 'idle', rasterZustand('irgendwas'))
check('leere Zeichenkette ergibt idle', rasterZustand('') === 'idle')
check('undefined ergibt idle', rasterZustand(undefined) === 'idle')
check('null ergibt idle', rasterZustand(null) === 'idle')
// Ohne diese Prüfung könnte ein Zustand namens 'toString' oder 'constructor'
// über die Prototypenkette einen Treffer liefern.
check('Prototyp-Schlüssel ergibt idle', rasterZustand('constructor') === 'idle', rasterZustand('constructor'))

console.log('\nVollständigkeit gegen liveFeed.js\n')

/*
 * Die Liste stammt aus `_setState(...)`-Aufrufen in `src/utils/liveFeed.js`
 * plus 'ready'/'replay' aus der Hebelkarte und der Wiedergabe. Kommt dort ein
 * Zustand dazu, fällt hier auf, dass er hier fehlt — und nicht erst im Handel.
 */
const GEMELDET = ['idle', 'connecting', 'syncing', 'live', 'reconnecting', 'paused', 'error', 'empty', 'loading', 'ready', 'replay']
const fehlend = GEMELDET.filter(z => z !== 'idle' && !BEKANNTE_ZUSTAENDE.includes(z))
check('alle gemeldeten Zustände sind abgebildet', fehlend.length === 0, fehlend.join(', '))
// 'idle' steht bewusst NICHT in der Tabelle: es ist schon der Rückfallwert.
check('idle bleibt idle', rasterZustand('idle') === 'idle')

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log(fehler.map(f => `  - ${f}`).join('\n')); process.exit(1) }
