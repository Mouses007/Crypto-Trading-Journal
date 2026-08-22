/**
 * Selbsttest der Empfängerliste.
 *
 * Die Liste entscheidet, wer Post bekommt — und wer nicht. Beide Richtungen
 * sind hier geprüft: dass eine gültige Adresse ankommt UND dass eine kaputte
 * sichtbar liegen bleibt, statt still zu verschwinden.
 *
 * Aufruf: node shared/__selftest-empfaenger.mjs
 */

import { empfaengerListe, empfaengerPruefung, EMPFAENGER_MAX } from './empfaenger.js'

let bestanden = 0, fehlgeschlagen = 0
const gruppe = (name) => console.log(`\n${name}`)
const pruefe = (was, bedingung) => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${was}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${was}`) }
}

gruppe('Trennzeichen')
{
    pruefe('Komma', empfaengerListe('a@x.de,b@y.de').length === 2)
    pruefe('Semikolon', empfaengerListe('a@x.de;b@y.de').length === 2)
    pruefe('Zeilenumbruch', empfaengerListe('a@x.de\nb@y.de').length === 2)
    pruefe('Leerzeichen', empfaengerListe('a@x.de b@y.de').length === 2)
    pruefe('gemischt und mit Leerraum', empfaengerListe(' a@x.de ,; \n b@y.de  ').length === 2)
    pruefe('Reihenfolge bleibt', empfaengerListe('z@x.de,a@y.de').join('|') === 'z@x.de|a@y.de')
}

gruppe('Was durchfällt — und sichtbar bleibt')
{
    const r = empfaengerPruefung('a@x.de, kaputt, @nix.de, b@y.de, c@')
    pruefe('gültige kommen durch', r.gueltig.join('|') === 'a@x.de|b@y.de')
    pruefe('kaputte werden GENANNT, nicht verschluckt', r.verworfen.length === 3)
    pruefe('die verworfenen sind die richtigen',
        r.verworfen.join('|') === 'kaputt|@nix.de|c@')
    pruefe('leeres Feld ergibt nichts und beschwert sich nicht',
        empfaengerPruefung('').gueltig.length === 0 && empfaengerPruefung('').verworfen.length === 0)
    pruefe('null stürzt nicht ab', empfaengerPruefung(null).gueltig.length === 0)
    pruefe('undefined stürzt nicht ab', empfaengerPruefung(undefined).gueltig.length === 0)
    pruefe('nur Trennzeichen ergibt nichts', empfaengerPruefung(' , ; \n ').gueltig.length === 0)
}

gruppe('Doppelte')
{
    pruefe('gleiche Adresse zweimal zählt einmal',
        empfaengerListe('a@x.de, a@x.de').length === 1)
    pruefe('Gross- und Kleinschreibung ist dieselbe Adresse',
        empfaengerListe('a@x.de, A@X.DE').length === 1)
    pruefe('die erste Schreibweise überlebt',
        empfaengerListe('Anna@X.de, anna@x.de')[0] === 'Anna@X.de')
    pruefe('eine Dublette gilt nicht als Fehler',
        empfaengerPruefung('a@x.de, a@x.de').verworfen.length === 0)
}

gruppe('Deckel')
{
    const viele = Array.from({ length: EMPFAENGER_MAX + 5 }, (_, i) => `n${i}@x.de`).join(',')
    const r = empfaengerPruefung(viele)
    pruefe(`höchstens ${EMPFAENGER_MAX} Empfänger`, r.gueltig.length === EMPFAENGER_MAX)
    // Über dem Deckel wird nicht still abgeschnitten: Sonst fehlte genau die
    // Adresse, die zuletzt eingetragen wurde, und niemand wüsste warum.
    pruefe('was über dem Deckel liegt, wird gemeldet', r.verworfen.length === 5)
    pruefe('der eigene Deckel gilt auch',
        empfaengerPruefung('a@x.de,b@y.de,c@z.de', { max: 2 }).gueltig.length === 2)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
process.exit(fehlgeschlagen ? 1 : 0)
