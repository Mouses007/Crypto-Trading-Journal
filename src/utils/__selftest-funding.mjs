/**
 * Selbsttest der Funding-Konvention.
 *
 *   node src/utils/__selftest-funding.mjs
 *
 * Die Aufteilung „bezahlt/erhalten" stand an drei Stellen unabhängig
 * ausgeschrieben — und an zweien vertauscht. Im Dashboard sah das monatelang
 * plausibel aus, weil beide Zahlen positiv sind und niemand nachrechnet.
 * Dieser Test hält die Konvention fest, damit die nächste Kopie auffällt.
 */

import { splitFunding, addFunding } from './funding.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nFunding-Vorzeichen\n')

{
    const p = splitFunding(5)
    check('+5 ist erhalten, nicht bezahlt', p.received === 5 && p.paid === 0, JSON.stringify(p))

    const n = splitFunding(-5)
    check('−5 ist bezahlt, als positiver Betrag', n.paid === 5 && n.received === 0, JSON.stringify(n))

    const z = splitFunding(0)
    check('0 zählt weder als bezahlt noch als erhalten', z.paid === 0 && z.received === 0)

    check('undefined kippt nicht um', splitFunding(undefined).paid === 0 && splitFunding(undefined).received === 0)
    check('Text ohne Zahl ergibt 0', splitFunding('abc').paid === 0 && splitFunding('abc').received === 0)
    check('Zahl als Text wird gelesen', splitFunding('-2.5').paid === 2.5)
    check('beide Seiten sind nie negativ',
        splitFunding(-7).paid >= 0 && splitFunding(-7).received >= 0 && splitFunding(7).paid >= 0)
}

{
    // Die Konvention muss zur Netto-Formel passen, mit der importiert wird:
    //   netto = brutto − tradingFee + fundingFee
    // Am echten Bitunix-Trade nachgerechnet.
    const brutto = 17.59703
    const tradingFee = 1.1725739403
    const fundingFee = 0.136269300203
    const netto = brutto - tradingFee + fundingFee
    const { received, paid } = splitFunding(fundingFee)
    check('positives Funding hebt das Netto über brutto − Gebühr',
        Math.abs(netto - 16.560725359903) < 1e-9 && received > 0 && paid === 0,
        `netto=${netto} received=${received}`)
}

{
    // Ein Sammler über mehrere Trades — der Weg, wie Totals gerechnet werden.
    const s = { paid: 0, received: 0 }
    for (const f of [5, -3, 0, -1.5, 2]) addFunding(s, f)
    check('Sammler addiert getrennt und positiv',
        Math.abs(s.received - 7) < 1e-9 && Math.abs(s.paid - 4.5) < 1e-9,
        JSON.stringify(s))
    check('erhalten minus bezahlt ergibt die Summe der Vorzeichen',
        Math.abs((s.received - s.paid) - 2.5) < 1e-9, String(s.received - s.paid))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
