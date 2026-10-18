/**
 * Selbsttest: Zuordnungen für das automatische Chartbild (tradeBild.js).
 *
 *   node src/utils/__selftest-trade-bild.mjs
 *
 * Die Bewertung kennt andere Zeiteinheiten als der Chart (1D, 1W, 2m, 45m …),
 * und die Strategie kommt aus einem freien Tag — beides muss stimmen, sonst
 * zeigt das Bild eine andere Zeiteinheit oder keine Setups.
 */
import { chartZeiteinheit, strategieAusTags } from './chart/tradeBild.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nZeiteinheit\n')
check('1D → 1d, 1W → 1w', chartZeiteinheit('1D') === '1d' && chartZeiteinheit('1W') === '1w')
check('4h, 15m bleiben', chartZeiteinheit('4h') === '4h' && chartZeiteinheit('15m') === '15m')
check('Zwischenstufen auf die nächste Chart-Zeiteinheit (2m→3m, 45m→1h, 3h→4h)', chartZeiteinheit('2m') === '3m' && chartZeiteinheit('45m') === '1h' && chartZeiteinheit('3h') === '4h')
check('unbekannt / leer → null', chartZeiteinheit('12M') === null && chartZeiteinheit('') === null)

console.log('\nStrategie aus Tags\n')
check('Tag „LSOB" → lsob', strategieAusTags([{ name: 'LSOB' }]) === 'lsob')
check('Tag „LSOB Long 4h" → lsob (enthält)', strategieAusTags([{ name: 'LSOB Long 4h' }]) === 'lsob')
check('Tag „GUSS" → ema_touch', strategieAusTags([{ name: 'Guss' }]) === 'ema_touch')
check('Tag „EMA Touch" → ema_touch', strategieAusTags([{ name: 'EMA Touch' }]) === 'ema_touch')
check('kein Strategie-Tag → null', strategieAusTags([{ name: 'FOMO' }, { name: 'Breakout' }]) === null && strategieAusTags(null) === null)

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
