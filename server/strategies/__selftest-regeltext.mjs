/**
 * Selbsttest der Regel-in-Sätze-Übersetzung.
 *
 *   node server/strategies/__selftest-regeltext.mjs
 *
 * Diese Sätze sind das, was jemand liest, bevor er eine Strategie übernimmt.
 * Ein Satz, der etwas anderes behauptet als die Regel tut, ist schlimmer als
 * gar kein Satz — deshalb wird hier vor allem auf Treue geprüft.
 */

import { regelnAlsSaetze } from './rule-text.js'
import { pruefeRegeln } from './rule-validate.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const text = (saetze, titel) => saetze.find((s) => s.titel === titel)?.text || ''

console.log('\nRegeln als Sätze — Selbsttest\n')

{
    const g = pruefeRegeln({
        id: 'satz_test', name: 'Test', timeframes: ['1h', '4h'], direction: 'long', warmupCandles: 300,
        params: [{ key: 'ziel', type: 'number', default: 2, min: 1, max: 5 }],
        indicators: [{ id: 'ema20', type: 'ema', period: 20 }],
        signal: { type: 'pivotLow', left: 5, right: 2 },
        signalFilters: [{ left: 'close', op: 'gt', right: 'ema20' }],
        entry: { type: 'touch', anchor: 'ema20', from: 'above' },
        invalidations: [{ type: 'timeout', code: 'zu_lang', candles: 20 }],
        stopLoss: { anchor: 'correctionLow', offsetPct: 0.3 },
        takeProfit: { mode: 'rr', rr: { param: 'ziel' } },
        breakEvenAtR: 1, minRR: 1.5,
    })
    check('Testregeln sind gültig', g.ok, JSON.stringify(g.fehler))
    const s = regelnAlsSaetze(g.regeln)

    check('Richtung und Zeiteinheiten stehen drin',
        /Long/.test(text(s, 'Richtung')) && /1h, 4h/.test(text(s, 'Richtung')), text(s, 'Richtung'))
    check('Auslöser wird benannt',
        /Swing-Tief/.test(text(s, 'Auslöser')) && /5 Kerzen links, 2 rechts/.test(text(s, 'Auslöser')), text(s, 'Auslöser'))
    check('Bedingung wird lesbar',
        /Schlusskurs über ema20/.test(text(s, 'Bedingungen')), text(s, 'Bedingungen'))
    check('Einstieg nennt Anker und Richtung',
        /ema20 berührt/.test(text(s, 'Einstieg')) && /von oben/.test(text(s, 'Einstieg')), text(s, 'Einstieg'))
    check('Stop nennt Prozent und Anker — bei Long UNTER, im Dativ',
        /0\.3 % unter dem Korrekturtief/.test(text(s, 'Stop')), text(s, 'Stop'))
    check('Ziel zeigt den Parameterbezug', /«ziel»/.test(text(s, 'Ziel')), text(s, 'Ziel'))
    check('Abbruch nennt die Frist', /20 Kerzen/.test(text(s, 'Abbruch')), text(s, 'Abbruch'))
    check('Break-Even und Mindest-CRV stehen unter „Unterwegs"',
        /1 R/.test(text(s, 'Unterwegs')) && /1\.5/.test(text(s, 'Unterwegs')), text(s, 'Unterwegs'))
}

{
    // Short muss die Stop-Seite drehen — sonst behauptet der Satz das Gegenteil.
    const g = pruefeRegeln({
        id: 'satz_short', name: 'S', timeframes: ['1h'], direction: 'short', warmupCandles: 300,
        params: [], indicators: [], signal: { type: 'pivotHigh', left: 5, right: 2 },
        signalFilters: [], entry: { type: 'immediate' },
        invalidations: [{ type: 'timeout', code: 'x', candles: 10 }],
        stopLoss: { anchor: 'signalHigh', offsetPct: 0.2 },
        takeProfit: { mode: 'none' }, breakEvenAtR: 0,
    })
    const s = regelnAlsSaetze(g.regeln)
    check('bei Short liegt der Stop ÜBER dem Anker', /% über /.test(text(s, 'Stop')), text(s, 'Stop'))
    check('sofortiger Einstieg wird als solcher benannt',
        /sofort/.test(text(s, 'Einstieg')), text(s, 'Einstieg'))
    check('„kein Ziel" wird ausgesprochen', /kein festes Ziel/.test(text(s, 'Ziel')), text(s, 'Ziel'))
    check('ohne Bedingungen wird das ausdrücklich gesagt',
        /Ohne weitere Bedingungen/.test(text(s, 'Bedingungen')), text(s, 'Bedingungen'))
    check('ohne Break-Even fehlt der Abschnitt „Unterwegs"',
        !s.some((x) => x.titel === 'Unterwegs'))
}

{
    // Die drei Fehler, die beim ersten Blick in die echte Oberfläche auffielen.
    const g = pruefeRegeln({
        id: 'satz_kreuz', name: 'K', timeframes: ['1h'], direction: 'long', warmupCandles: 300,
        params: [], indicators: [{ id: 'e20', type: 'ema', period: 20 }, { id: 'e50', type: 'ema', period: 50 }],
        signal: { type: 'crossUp', a: 'e20', b: 'e50' },
        signalFilters: [], entry: { type: 'immediate' },
        invalidations: [{ type: 'condition', code: 'weg', when: { left: 'close', op: 'lt', right: 'e50' } }],
        stopLoss: { anchor: 'lastSwingLow', offsetPct: 0.3 },
        takeProfit: { mode: 'rr', rr: 2 }, breakEvenAtR: 0,
    })
    const s = regelnAlsSaetze(g.regeln)
    check('Kreuzung nennt beide Linien statt „? über ?"',
        /e20 kreuzt über e50/.test(text(s, 'Auslöser')), text(s, 'Auslöser'))
    check('Stop steht im Dativ („unter dem letzten Swing-Tief")',
        /unter dem letzten Swing-Tief/.test(text(s, 'Stop')), text(s, 'Stop'))
    check('Bedingungs-Abbruch bekommt ein „wenn"',
        /verworfen wenn /.test(text(s, 'Abbruch')), text(s, 'Abbruch'))
}

{
    check('leere Eingabe liefert nichts statt zu werfen', regelnAlsSaetze(null).length === 0)
    check('unbekannte Bausteine kippen nicht um',
        regelnAlsSaetze({ signal: { type: 'quatsch' }, entry: {}, stopLoss: {}, takeProfit: {} }).length > 0)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
