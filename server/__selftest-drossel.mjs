/**
 * Selbsttest des Mindestabstands für bezahlte Endpunkte.
 *
 *   node server/__selftest-drossel.mjs
 *
 * Der wichtigste Fall ist der dritte Test: ein abgewiesener Versuch darf die
 * Sperre NICHT verlängern. Sonst käme, wer zweimal zu früh klickt, nie mehr
 * durch — und der Schutz vor versehentlichen Kosten würde zum Ausfall der
 * Funktion.
 */
import { darfLaufen, _zuruecksetzen } from './drossel.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nMindestabstand\n')

_zuruecksetzen()
const T = 1_000_000

check('der erste Aufruf geht immer durch', darfLaufen('a', 5000, T).ok)
check('sofort danach nicht mehr', darfLaufen('a', 5000, T + 10).ok === false)
check('Wartezeit wird gemeldet', darfLaufen('a', 5000, T + 1000).wartenMs === 4000,
    String(darfLaufen('a', 5000, T + 1000).wartenMs))

/*
 * DER Fall: die abgewiesenen Versuche oben liegen bei T+10 und T+1000. Würde
 * jeder davon den Zeitstempel setzen, wäre erst ab T+6000 wieder frei. Richtig
 * ist T+5000, gerechnet ab dem letzten DURCHGELASSENEN Aufruf.
 */
check('abgewiesene Versuche verlaengern die Sperre nicht',
    darfLaufen('a', 5000, T + 5001).ok)

_zuruecksetzen()
check('nach Ablauf wieder frei',
    darfLaufen('b', 1000, T).ok && darfLaufen('b', 1000, T + 1001).ok)
check('genau auf der Grenze ist frei',
    (() => { _zuruecksetzen(); darfLaufen('c', 1000, T); return darfLaufen('c', 1000, T + 1000).ok })())

console.log('\nSchluessel sind getrennt\n')
_zuruecksetzen()
darfLaufen('flux:generate', 5000, T)
check('anderer Schluessel ist nicht mitgesperrt', darfLaufen('news:anweisung-pruefen', 5000, T).ok)
check('derselbe Schluessel bleibt gesperrt', darfLaufen('flux:generate', 5000, T + 1).ok === false)

console.log('\nRandfaelle\n')
_zuruecksetzen()
check('Abstand 0 laesst alles durch',
    darfLaufen('d', 0, T).ok && darfLaufen('d', 0, T).ok)
check('unbrauchbarer Abstand sperrt nicht',
    darfLaufen('e', undefined, T).ok && darfLaufen('e', 'x', T).ok)
check('wartenMs ist nie negativ',
    darfLaufen('f', 5000, T).wartenMs === 0 && darfLaufen('f', 5000, T + 4999).wartenMs > 0)

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler: ' + fehler.join(', ')); process.exit(1) }
