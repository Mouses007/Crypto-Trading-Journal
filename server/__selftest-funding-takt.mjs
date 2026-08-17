/**
 * Selbsttest: Funding-Zahlungstakt (`marktradar-api.js`).
 *
 *   node server/__selftest-funding-takt.mjs
 *
 * Anlass ist ein Fehler, der sich im Betrieb nicht verrät: Binance-Raten
 * wurden pauschal mit dreimal täglich aufs Jahr hochgerechnet, obwohl 445
 * Perps (Stand 17.08.2026) alle vier Stunden zahlen. Herausgekommen ist
 * jeweils genau die HALBE Jahresrate — eine Zahl, die plausibel aussieht und
 * durch jede Prüfung rutscht. Bemerkt wurde es erst, weil die Divergenz-Mail
 * LAB mit 15,7 Punkten als Grenzfall meldete, während der echte Abstand zur
 * Bybit-Rate bei 42,2 Punkten lag.
 *
 * Zwei Dinge hält dieser Test deshalb fest:
 * die Umrechnung selbst, und dass die auf 8 h geeichten Schwellen der
 * Marktmechanik bei kürzerem Takt nicht stillschweigend höher liegen.
 */

import { jahresRateAus, FUNDING_STANDARD_H } from './marktradar-api.js'
import { FUNDING_HOCH } from './marktmechanik.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const nahe = (a, b, eps = 1e-9) => a !== null && Math.abs(a - b) < eps

console.log('\nFunding-Zahlungstakt\n')

// ── 1) Umrechnung je Takt ────────────────────────────────────────────────
check('Standardtakt sind 8 Stunden', FUNDING_STANDARD_H === 8, String(FUNDING_STANDARD_H))
check('8 h = dreimal täglich', nahe(jahresRateAus(0.0001, 8), 0.0001 * 3 * 365))
check('4 h = sechsmal täglich', nahe(jahresRateAus(0.0001, 4), 0.0001 * 6 * 365))
check('1 h = 24-mal täglich', nahe(jahresRateAus(0.0001, 1), 0.0001 * 24 * 365))
check('halber Takt = doppelte Jahresrate',
    nahe(jahresRateAus(0.0001, 4), jahresRateAus(0.0001, 8) * 2))
check('Vorzeichen bleibt erhalten', jahresRateAus(-0.0001, 4) < 0)

// ── 2) Notfälle ──────────────────────────────────────────────────────────
// Ein fehlender Takt darf nicht NaN und nicht 0 ergeben, sonst verschwindet
// der Markt still aus jeder Divergenz-Prüfung.
check('ohne Angabe gilt der Standardtakt', nahe(jahresRateAus(0.0001), jahresRateAus(0.0001, 8)))
check('Takt 0 fällt auf den Standard zurück', nahe(jahresRateAus(0.0001, 0), jahresRateAus(0.0001, 8)))
check('unsinniger Takt fällt auf den Standard zurück',
    nahe(jahresRateAus(0.0001, -4), jahresRateAus(0.0001, 8))
    && nahe(jahresRateAus(0.0001, 'acht'), jahresRateAus(0.0001, 8)))
check('fehlende Rate ergibt null, nicht NaN',
    jahresRateAus(null, 4) === null && jahresRateAus(undefined, 4) === null
    && jahresRateAus(NaN, 4) === null)
check('Rate 0 bleibt 0 und wird nicht zu null', jahresRateAus(0, 4) === 0)

// ── 3) Der Fall, der es aufgedeckt hat ───────────────────────────────────
// LAB zahlt bei Binance alle vier Stunden. Gemeldet wurden 26,6 % p.a.,
// richtig sind 53,2 % — und erst damit stimmt der Abstand zur Bybit-Rate
// von 11,0 %, der die 15-Punkte-Schwelle deutlich reisst statt sie zu
// streifen.
{
    const rateLab = 0.00024305   // Einzelrate, die zu den 26,6 % der Mail führte
    const falsch = rateLab * 3 * 365 * 100
    const richtig = jahresRateAus(rateLab, 4) * 100
    check('LAB: alter Weg ergibt die gemeldeten ~26,6 %', Math.abs(falsch - 26.6) < 0.1, falsch.toFixed(2))
    check('LAB: mit 4h-Takt sind es ~53,2 %', Math.abs(richtig - 53.2) < 0.2, richtig.toFixed(2))
    check('LAB: Abstand zu Bybit (11,0 %) reisst die 15-Punkte-Schwelle',
        richtig - 11.0 > 15 && falsch - 11.0 < 16,
        `echt ${(richtig - 11.0).toFixed(1)}, alt ${(falsch - 11.0).toFixed(1)}`)
}

// ── 4) Schwellen der Marktmechanik ───────────────────────────────────────
// Die Schwellen dort sind auf „% je 8 h" geeicht. Ohne Normierung müsste ein
// 4h-Markt die doppelten Jahreskosten erreichen, bevor „Funding hoch"
// anspringt — die Kachel wäre bei genau den heissesten Märkten am trägsten.
const auf8h = (ratePct, takt) => ratePct * (FUNDING_STANDARD_H / takt)
{
    const roh = 0.02   // % je 4 h — entspricht 0,04 % je 8 h ≈ 44 % p.a.
    check('4h-Rate unter der Schwelle liegt normiert darüber',
        roh < FUNDING_HOCH && auf8h(roh, 4) >= FUNDING_HOCH,
        `roh ${roh}, normiert ${auf8h(roh, 4)}, Schwelle ${FUNDING_HOCH}`)
    check('8h-Markt wird durch die Normierung nicht verändert',
        nahe(auf8h(0.02, 8), 0.02))
    check('Normierung und Jahresrate sind derselbe Massstab',
        nahe(jahresRateAus(auf8h(roh, 4), 8), jahresRateAus(roh, 4)))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log('\nFehlgeschlagen:')
    for (const f of fehler) console.log(`  - ${f}`)
    process.exit(1)
}
