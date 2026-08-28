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

console.log('\nBitunix-Netto-Kanon\n')

/*
 * `realizedPNL` ist bei Bitunix bereits der FERTIGE Wallet-Delta — Gebühr und
 * Funding sind darin verrechnet. Wer davon noch einmal Gebühren abzieht,
 * verliert bei jedem Trade den Gebührenbetrag ein zweites Mal.
 *
 * Genau das tat bis zum Audit vom 28.08.2026 der API-Import auf der
 * AddTrades-Seite: eine vierte Kopie der Rechnung, die den sechszeiligen
 * Kommentar der anderen drei nie bekommen hatte. Am echten Bitunix-Trade
 * (BTCUSDT) hätte das 1,30884 USDT je Trade unterschlagen — 7,9 % des
 * Ergebnisses.
 *
 * Die Rechnung steht heute nur noch in `quickImport.js`. Dieser Test hält sie
 * fest, damit die nächste Kopie auffällt.
 */
{
    const realizedPNL = 16.560725359903   // Wallet-Delta laut Börse
    const tradingFee = 1.1725739403
    const fundingFee = 0.136269300203     // SIGNIERT: positiv = erhalten

    const netto = realizedPNL
    const brutto = realizedPNL + tradingFee - fundingFee

    check('netto ist realizedPNL, unverändert',
        Math.abs(netto - 16.560725359903) < 1e-9, String(netto))
    check('brutto rekonstruiert die reine Trade-PnL',
        Math.abs(brutto - 17.59703) < 1e-9, String(brutto))
    check('die Netto-Formel schliesst den Kreis',
        Math.abs((brutto - tradingFee + fundingFee) - netto) < 1e-9)

    // Der alte, falsche Weg — als ausdrücklicher Gegenbeleg.
    const falsch = realizedPNL - (tradingFee + Math.abs(fundingFee))
    check('der doppelte Abzug fehlt um Gebühr plus Funding',
        Math.abs((netto - falsch) - (tradingFee + Math.abs(fundingFee))) < 1e-9,
        `Fehlbetrag ${(netto - falsch).toFixed(5)}`)
}

{
    // Bezahltes Funding: das Vorzeichen muss die Bruttorechnung ANHEBEN,
    // nicht senken. Mit Math.abs kippt genau das um.
    const realizedPNL = 10
    const tradingFee = 1
    const bezahlt = -0.5
    const brutto = realizedPNL + tradingFee - bezahlt
    check('bezahltes Funding erhöht das Brutto', Math.abs(brutto - 11.5) < 1e-9, String(brutto))
    const mitAbs = realizedPNL + tradingFee - Math.abs(bezahlt)
    check('mit Math.abs käme 10,5 statt 11,5 heraus', Math.abs(mitAbs - 10.5) < 1e-9)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
