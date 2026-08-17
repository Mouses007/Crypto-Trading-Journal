/**
 * Selbsttest des Marktmechanik-Regelwerks.
 *
 *   node server/__selftest-marktmechanik.mjs
 *
 * Das Regelwerk ist der Kern der Kachel: dieselben Zahlen müssen immer
 * denselben Zustand ergeben, die Prioritätsordnung muss stehen (laufender
 * Zwangsabbau überstimmt Risiko, Risiko überstimmt Aufbau), und fehlende
 * Faktoren dürfen degradieren, aber nie werfen.
 */

import { bewerteMechanik, FENSTER, FUNDING_HOCH, LIQ_SPIKE } from './marktmechanik.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Ruhiger Markt als Basis; Tests überschreiben gezielt einzelne Faktoren. */
const ruhig = (extra = {}) => ({
    preisDeltaPct: 0.05, oiDeltaPct: 0.1, fundingRate: 0.01, fundingTrend: 0,
    liqLongUsd: 100000, liqShortUsd: 100000, liqSpikeFaktor: 0.8, liqVerfuegbar: true,
    ...extra,
})

console.log('\nMarktmechanik — Selbsttest\n')

// ── Die sechs Zustände ───────────────────────────────────────────────────
console.log('Zustände (Fenster 1h)')
{
    check('ruhiger Markt ist NEUTRAL',
        bewerteMechanik(ruhig(), '1h').state === 'NEUTRAL')

    const delev = bewerteMechanik(ruhig({ oiDeltaPct: -2.0, liqSpikeFaktor: 3 }), '1h')
    check('OI bricht weg + Liq-Spike = DELEVERAGING', delev.state === 'DELEVERAGING', delev.state)
    check('… mit den tragenden Gründen', delev.gruende.includes('oiAbbauStark') && delev.gruende.includes('liqSpike'))

    const longSq = bewerteMechanik(ruhig({ fundingRate: 0.05, oiDeltaPct: 0.8, preisDeltaPct: 0.1 }), '1h')
    check('Funding hoch + OI rauf + Preis träge = LONG_SQUEEZE_RISK', longSq.state === 'LONG_SQUEEZE_RISK', longSq.state)

    const longSqLiq = bewerteMechanik(ruhig({ liqLongUsd: 900000, liqShortUsd: 100000, liqSpikeFaktor: 3, preisDeltaPct: -0.2 }), '1h')
    check('Long-Liq-Dominanz + Spike bei fallendem Preis = LONG_SQUEEZE_RISK',
        longSqLiq.state === 'LONG_SQUEEZE_RISK', longSqLiq.state)

    const shortSq = bewerteMechanik(ruhig({ fundingRate: -0.02, oiDeltaPct: 0.8, preisDeltaPct: -0.1 }), '1h')
    check('Funding negativ + OI rauf + Preis hält = SHORT_SQUEEZE_RISK', shortSq.state === 'SHORT_SQUEEZE_RISK', shortSq.state)

    const shortSqLiq = bewerteMechanik(ruhig({ liqLongUsd: 50000, liqShortUsd: 800000, liqSpikeFaktor: 2.5, preisDeltaPct: 0.4 }), '1h')
    check('Short-Liq-Dominanz + Spike bei steigendem Preis = SHORT_SQUEEZE_RISK',
        shortSqLiq.state === 'SHORT_SQUEEZE_RISK', shortSqLiq.state)

    check('OI rauf + Preis rauf = LONG_AUFBAU',
        bewerteMechanik(ruhig({ oiDeltaPct: 0.8, preisDeltaPct: 0.5 }), '1h').state === 'LONG_AUFBAU')
    check('OI rauf + Preis runter = SHORT_AUFBAU',
        bewerteMechanik(ruhig({ oiDeltaPct: 0.8, preisDeltaPct: -0.5 }), '1h').state === 'SHORT_AUFBAU')
}

// ── Prioritätsordnung ────────────────────────────────────────────────────
console.log('\nPrioritätsordnung')
{
    // Alles gleichzeitig: OI-Absturz + Spike + hohes Funding — der laufende
    // Zwangsabbau ist die Tatsache, das Squeeze-Risiko nur die Warnung davor.
    const alles = bewerteMechanik(ruhig({
        oiDeltaPct: -2.5, liqSpikeFaktor: 4, fundingRate: 0.06, preisDeltaPct: -1.5,
        liqLongUsd: 900000, liqShortUsd: 50000,
    }), '1h')
    check('Zwangsabbau schlägt Squeeze-Warnung', alles.state === 'DELEVERAGING', alles.state)

    // Squeeze-Risiko schlägt die neutrale Aufbau-Beschreibung: Funding hoch,
    // OI rauf, Preis unter der Schwelle → Risiko, nicht „Aufbau".
    const risiko = bewerteMechanik(ruhig({ fundingRate: 0.04, oiDeltaPct: 1.2, preisDeltaPct: 0.2 }), '1h')
    check('Squeeze-Risiko schlägt Aufbau', risiko.state === 'LONG_SQUEEZE_RISK', risiko.state)

    // Preis ÜBER der Schwelle: der Markt bestätigt den Aufbau → kein Risiko-Urteil
    const gesund = bewerteMechanik(ruhig({ fundingRate: 0.04, oiDeltaPct: 1.2, preisDeltaPct: 0.8 }), '1h')
    check('steigt der Preis mit, ist es LONG_AUFBAU trotz hohem Funding', gesund.state === 'LONG_AUFBAU', gesund.state)
}

// ── Grenzwerte ───────────────────────────────────────────────────────────
console.log('\nGrenzwerte (exakt auf der Schwelle)')
{
    const s = FENSTER['1h']
    check('OI exakt auf der Schwelle zählt als Aufbau',
        bewerteMechanik(ruhig({ oiDeltaPct: s.oiSchwelle, preisDeltaPct: s.preisSchwelle }), '1h').state === 'LONG_AUFBAU')
    check('OI knapp darunter bleibt NEUTRAL',
        bewerteMechanik(ruhig({ oiDeltaPct: s.oiSchwelle - 0.01, preisDeltaPct: s.preisSchwelle }), '1h').state === 'NEUTRAL')
    check('Funding exakt auf FUNDING_HOCH zählt',
        bewerteMechanik(ruhig({ fundingRate: FUNDING_HOCH, oiDeltaPct: s.oiSchwelle, preisDeltaPct: 0 }), '1h').state === 'LONG_SQUEEZE_RISK')
    check('Spike exakt auf LIQ_SPIKE zählt',
        bewerteMechanik(ruhig({ oiDeltaPct: -s.oiStark, liqSpikeFaktor: LIQ_SPIKE }), '1h').state === 'DELEVERAGING')
}

// ── Fehlende Faktoren ────────────────────────────────────────────────────
console.log('\nFehlende Faktoren')
{
    const ohneLiq = bewerteMechanik(ruhig({
        liqVerfuegbar: false, liqLongUsd: null, liqShortUsd: null, liqSpikeFaktor: null,
        fundingRate: 0.05, oiDeltaPct: 0.8, preisDeltaPct: 0.1,
    }), '1h')
    check('ohne Liq-Daten urteilen Funding/OI weiter', ohneLiq.state === 'LONG_SQUEEZE_RISK', ohneLiq.state)
    check('… und fehlend meldet liq', ohneLiq.fehlend.includes('liq'))

    const ohneAlles = bewerteMechanik({}, '1h')
    check('ganz ohne Daten: NEUTRAL statt Wurf', ohneAlles.state === 'NEUTRAL')
    check('… und alle vier Faktoren als fehlend gemeldet', ohneAlles.fehlend.length === 4)

    const nanRein = bewerteMechanik(ruhig({ preisDeltaPct: NaN }), '1h')
    check('NaN gilt als fehlend, nicht als 0', nanRein.fehlend.includes('preis'))

    let geworfen = false
    try { bewerteMechanik(ruhig(), '2h') } catch (e) { geworfen = true }
    check('unbekanntes Fenster wirft (Programmierfehler, kein Datenfehler)', geworfen)
}

// ── Fensterskalierung ────────────────────────────────────────────────────
console.log('\nFensterskalierung')
{
    // +0,3 % OI: im 15m-Fenster ein klarer Aufbau, im 4h-Fenster Rauschen
    const f = { oiDeltaPct: 0.3, preisDeltaPct: 0.2, fundingRate: 0.01, liqVerfuegbar: false }
    check('gleiche Zahlen, 15m: LONG_AUFBAU', bewerteMechanik(f, '15m').state === 'LONG_AUFBAU')
    check('gleiche Zahlen, 4h: NEUTRAL', bewerteMechanik(f, '4h').state === 'NEUTRAL')
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log('Fehlgeschlagen:')
    for (const f of fehler) console.log(`  - ${f}`)
    process.exit(1)
}
