/**
 * Selbsttest der Indikator-Vorlagen (Prüfregel, ohne DB).
 *
 *   node server/__selftest-chart-vorlagen.mjs
 */
import { saubereVorlage, MAX_VORLAGE_INDIKATOREN } from './chart-vorlagen.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nVorlagen\n')
{
    const r = saubereVorlage([
        { id: 'ema-abc', typ: 'ema', params: { laenge: 21, quelle: 'c' }, farben: { wert: '#ff0000' }, sichtbar: true },
        { id: 'vv-1', typ: 'vwapVector', params: { showDaily: true, tfMtfE1: '1d', cDaily: '#70ccbd' }, sichtbar: false },
    ])
    check('gültige Liste kommt durch', r.ok && r.indikatoren.length === 2, JSON.stringify(r))
    check('IDs werden nicht gespeichert (beim Anwenden neu)', r.ok && r.indikatoren.every((i) => !('id' in i)))
    check('Schalter, Zeiteinheit und Farbe bleiben erhalten', r.indikatoren[1].params.showDaily === true && r.indikatoren[1].params.tfMtfE1 === '1d' && r.indikatoren[1].params.cDaily === '#70ccbd')
    check('ausgeblendet bleibt ausgeblendet', r.indikatoren[1].sichtbar === false && r.indikatoren[0].sichtbar === true)

    const schmutz = saubereVorlage([{ typ: 'rsi', params: { laenge: 14, kaputt: { tief: 1 }, nan: NaN, lang: 'x'.repeat(200), '__proto__x': 1 } }])
    check('verschachtelte, NaN- und überlange Werte fallen weg', schmutz.ok && Object.keys(schmutz.indikatoren[0].params).join() === 'laenge', JSON.stringify(schmutz))
    check('ungültiger Typ wird übersprungen, gültige bleiben', saubereVorlage([{ typ: '<script>' }, { typ: 'sma' }]).indikatoren.length === 1)
    check('leere Liste wird abgelehnt', !saubereVorlage([]).ok)
    check('keine Liste wird abgelehnt', !saubereVorlage({ typ: 'ema' }).ok)
    check('nur ungültige Typen → abgelehnt statt leere Vorlage', !saubereVorlage([{ typ: '1abc' }]).ok)
    check(`mehr als ${MAX_VORLAGE_INDIKATOREN} Indikatoren → abgelehnt`, !saubereVorlage(Array.from({ length: MAX_VORLAGE_INDIKATOREN + 1 }, () => ({ typ: 'ema' }))).ok)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
