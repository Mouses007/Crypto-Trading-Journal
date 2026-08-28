/**
 * Selbsttest des Break-even-Kanons.
 *
 *   node shared/__selftest-gewinn.mjs
 *
 * Die Schwelle stand an dreizehn Stellen unabhängig ausgeschrieben — und nur
 * an zwei richtig. Ein Kommentar an der reparierten Kopie hilft dabei nicht:
 * wer an der kaputten Stelle arbeitet, sieht ihn nie. Dieser Test hält den
 * Kanon fest, damit die nächste Kopie auffällt.
 */

import { istGewinn } from './gewinn.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nBreak-even-Kanon\n')

check('Null zählt als Gewinn', istGewinn(0) === true)
check('Null als Text zählt als Gewinn', istGewinn('0') === true)
check('minus Null zählt als Gewinn', istGewinn(-0) === true)
check('positiver Betrag ist Gewinn', istGewinn(12.5) === true)
check('negativer Betrag ist Verlust', istGewinn(-0.01) === false)
check('kleinster Verlust bleibt Verlust', istGewinn(-1e-9) === false)
check('Zahl als Text wird gelesen', istGewinn('-2.5') === false && istGewinn('2.5') === true)

/*
 * Unlesbare Werte: bewusst Gewinn. Ein fehlendes Feld darf keinen Verlust
 * erfinden — genau das war der Fehler, den `Number(null) === 0` an fünf
 * Stellen des Research-Audits vom 20.08.2026 verursacht hat.
 */
check('undefined erfindet keinen Verlust', istGewinn(undefined) === true)
check('null erfindet keinen Verlust', istGewinn(null) === true)
check('Text ohne Zahl erfindet keinen Verlust', istGewinn('abc') === true)
check('NaN erfindet keinen Verlust', istGewinn(NaN) === true)

check('Rückgabe ist immer ein Boolean',
    [0, -1, 1, null, undefined, 'x'].every((w) => typeof istGewinn(w) === 'boolean'))

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler: ' + fehler.join(', ')); process.exit(1) }
