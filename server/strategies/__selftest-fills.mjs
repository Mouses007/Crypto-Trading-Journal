/**
 * Selbsttest des Fill-Simulators — Schwerpunkt Teilausstieg.
 *
 * Der Simulator ist die gemeinsame Grundlage von Backtest UND Papierbetrieb.
 * Eine falsche R-Verrechnung fällt hier nicht auf, sondern erst Wochen später
 * in einer Auswertung, die man dann glaubt. Deshalb dieser Harness.
 *
 *   node server/strategies/__selftest-fills.mjs
 *
 * Alle Fälle laufen ohne Gebühren und Slippage, damit die erwarteten Beträge
 * exakt aufgehen; die Kostenrechnung ist an anderer Stelle abgedeckt.
 */

import { createPosition, stepCandle, closePosition, riskPerUnit, fundingFor, liquidationPrice } from '../fill-simulator.js'

let passed = 0
let failed = 0

function check(name, ok, detail) {
    if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const costs = { feeBps: 0, slippageBps: 0 }
const k = (o, h, l, c, t) => ({ o, h, l, c, t })

/** Long: Einstieg 100, Stopp 90, Ziel 130 → Risiko 10/Einheit, 10 Stück = 1R à 100 USD. */
function long() {
    return createPosition({
        setup: { direction: 'long', symbol: 'X', timeframe: '1h', stopLoss: 90, takeProfit: 130 },
        qty: 10, entryPrice: 100, entryTime: 0, leverage: 1, costs,
    })
}

/** Short gespiegelt: Einstieg 100, Stopp 110, Ziel 70. */
function short() {
    return createPosition({
        setup: { direction: 'short', symbol: 'X', timeframe: '1h', stopLoss: 110, takeProfit: 70 },
        qty: 10, entryPrice: 100, entryTime: 0, leverage: 1, costs,
    })
}

console.log('\nTeilausstieg')

for (const [name, pos, teilKerze, zielKerze] of [
    ['long', long(), k(100, 112, 99, 111, 1), k(111, 131, 110, 130, 2)],
    ['short', short(), k(100, 101, 88, 89, 1), k(89, 90, 69, 70, 2)],
]) {
    const opts = { partialTpR: 1, partialTpPct: 50, costs }

    const e1 = stepCandle(pos, teilKerze, opts)
    check(`${name}: 1R nimmt die Hälfte, Position bleibt offen`,
        e1.exit === null && pos.qty === 5 && pos.partialDone === true && Math.abs(pos.partialGross - 50) < 1e-9,
        `qty=${pos.qty} partialGross=${pos.partialGross} exit=${JSON.stringify(e1.exit)}`)

    const e2 = stepCandle(pos, zielKerze, opts)
    const t = closePosition(pos, e2.exit, costs)
    check(`${name}: beide Teile ergeben EINEN Trade mit 2R`,
        Math.abs(t.grossPnl - 200) < 1e-9 && Math.abs(t.rMultiple - 2) < 1e-9 && t.qty === 10,
        `gross=${t.grossPnl} r=${t.rMultiple} qty=${t.qty}`)
}

console.log('\nZusammenspiel mit Break-Even')

{
    const pos = long()
    const opts = { partialTpR: 1, partialTpPct: 50, breakEvenAtR: 1, costs }
    stepCandle(pos, k(100, 112, 99, 111, 1), opts)
    check('Break-Even zieht den Stopp auf den Einstieg',
        pos.breakEvenDone === true && pos.stopLoss === 100, `stopLoss=${pos.stopLoss}`)

    const e = stepCandle(pos, k(111, 112, 99, 100, 2), opts)
    const t = closePosition(pos, e.exit, costs)
    check('Rest im Break-Even → nur der Teilgewinn zählt (0,5R)',
        Math.abs(t.rMultiple - 0.5) < 1e-9 && t.exitReason === 'be',
        `r=${t.rMultiple} grund=${t.exitReason}`)
}

console.log('\nGrenzfälle')

{
    // Kerze erreicht Teilziel UND volles Ziel: erst der Teil, dann der Rest.
    const pos = long()
    const e = stepCandle(pos, k(100, 135, 99, 134, 1), { partialTpR: 1, partialTpPct: 50, costs })
    const t = closePosition(pos, e.exit, costs)
    check('Teilziel und Ziel in derselben Kerze → beides gebucht',
        pos.partialDone === true && Math.abs(t.grossPnl - 200) < 1e-9,
        `gross=${t.grossPnl} partial=${pos.partialGross}`)
}

{
    // Stopp hat Vorrang: wird er in derselben Kerze berührt, gibt es keinen Teil.
    const pos = long()
    const e = stepCandle(pos, k(100, 112, 89, 91, 1), { partialTpR: 1, partialTpPct: 50, costs })
    check('Stopp in derselben Kerze schlägt den Teilausstieg',
        e.exit?.reason === 'sl' && !pos.partialDone, JSON.stringify(e.exit))
}

{
    // Abgeschaltet (0) muss sich exakt wie vorher verhalten.
    const pos = long()
    stepCandle(pos, k(100, 112, 99, 111, 1), { partialTpR: 0, partialTpPct: 50, costs })
    check('partialTpR=0 lässt die Position unangetastet',
        pos.qty === 10 && !pos.partialDone, `qty=${pos.qty}`)
}

{
    const pos = long()
    check('riskPerUnit bleibt am Einstiegs-Stopp verankert',
        riskPerUnit(pos) === 10, String(riskPerUnit(pos)))
}

// ── Kurslücken und Absturzkerzen ─────────────────────────────────────────
//
// Audit-Befund A4-4: der Simulator behandelt Kurslücken (Eröffnung jenseits der
// Marke) zwar, aber es gab keinen einzigen Fall dafür. Genau hier entsteht der
// Unterschied zwischen einem Backtest und einem Konto: wer annimmt, der Stop
// fülle immer zum Stop-Preis, rechnet sich das Risiko klein.
console.log('\nKurslücken')
{
    const T = 1700000000000

    // Long 100, Stop 90 — die nächste Kerze eröffnet bei 80.
    {
        const pos = long()
        const r = stepCandle(pos, k(80, 82, 78, 79, T))
        check('Lücke unter den Stop füllt zur ERÖFFNUNG, nicht zum Stop-Preis',
            r.exit && r.exit.price === 80, JSON.stringify(r.exit))
        const t = closePosition(pos, r.exit, costs)
        check('der Verlust ist dadurch grösser als 1R',
            t.rMultiple < -1, String(t.rMultiple))
    }

    // Short: Spiegelbild, Lücke nach oben.
    {
        const pos = createPosition({
            setup: { direction: 'short', symbol: 'X', timeframe: '1h', stopLoss: 110, takeProfit: 70 },
            qty: 10, entryPrice: 100, entryTime: T, leverage: 1, costs,
        })
        const r = stepCandle(pos, k(125, 128, 122, 124, T))
        check('Lücke über den Stop füllt ebenfalls zur Eröffnung',
            r.exit && r.exit.price === 125, JSON.stringify(r.exit))
        check('und wird als Stop verbucht, nicht als etwas anderes',
            r.exit.reason === 'sl', r.exit?.reason)
    }

    // Eine Kerze, die BEIDE Marken überspringt: erst runter, dann rauf.
    {
        const pos = long()
        const r = stepCandle(pos, k(95, 140, 85, 138, T))
        check('erwischt eine Kerze Stop UND Ziel, zählt der Stop',
            r.exit && r.exit.reason === 'sl' && r.exit.price === 90, JSON.stringify(r.exit))
    }

    // Lücke zu unseren Gunsten über das Ziel hinweg — auch das ist die
    // Eröffnung, nicht das Ziel. Sonst würde der Gewinn kleingerechnet.
    {
        const pos = long()
        const r = stepCandle(pos, k(150, 155, 148, 152, T))
        check('Lücke über das Ziel füllt zur Eröffnung, also besser',
            r.exit && r.exit.reason === 'tp' && r.exit.price === 150, JSON.stringify(r.exit))
        const t = closePosition(pos, r.exit, costs)
        check('der Gewinn ist dadurch grösser als geplant', t.rMultiple > 3, String(t.rMultiple))
    }

    // Absturzkerze, die genau auf dem Stop eröffnet: keine Lücke, der Stop hält.
    {
        const pos = long()
        const r = stepCandle(pos, k(90, 91, 60, 65, T))
        check('eine Eröffnung genau auf dem Stop ist keine Lücke',
            r.exit && r.exit.price === 90, JSON.stringify(r.exit))
    }

    // Eine fehlende Kerze (Datenlücke) sieht für den Simulator aus wie ein
    // grosser Sprung — der Stop muss trotzdem greifen, nicht durchgereicht werden.
    {
        const pos = long()
        const nachLuecke = stepCandle(pos, k(70, 72, 68, 69, T + 6 * 3600000))
        check('nach einer Datenlücke schliesst die erste Kerze die Position',
            nachLuecke.exit && nachLuecke.exit.price === 70, JSON.stringify(nachLuecke.exit))
    }
}

// ── Finanzierungskosten ──────────────────────────────────────────────────
//
// Audit-Befund A2-4: Funding war im Backtest immer 0. Jetzt ist es eine offen
// genannte Annahme — und die muss diskret abrechnen, nicht anteilig. Sonst
// zahlt ein Scalp über sieben Stunden Kosten, die es nie gegeben hätte.
console.log('\nFinanzierungskosten')
{
    const STUNDE = 3600000
    // 2026-01-01 00:00 UTC liegt genau auf einer Abrechnung
    const T0 = Date.UTC(2026, 0, 1)

    check('ohne Satz kostet Halten nichts',
        fundingFor(10000, T0 + STUNDE, T0 + 100 * STUNDE, 0) === 0)

    check('sieben Stunden zwischen zwei Abrechnungen kosten nichts',
        fundingFor(10000, T0 + STUNDE / 2, T0 + 7 * STUNDE, 1) === 0,
        String(fundingFor(10000, T0 + STUNDE / 2, T0 + 7 * STUNDE, 1)))

    // Einstieg 07:00, Ausstieg 09:00 → die Abrechnung um 08:00 liegt dazwischen
    const eine = fundingFor(10000, T0 + 7 * STUNDE, T0 + 9 * STUNDE, 1)
    check('eine Abrechnung dazwischen kostet genau eine Periode',
        Math.abs(eine - (-10000 * 0.0001)) < 1e-9, String(eine))

    // Zwei Tage → 00, 08, 16, 00, 08, 16 = 6 Abrechnungen
    const zweiTage = fundingFor(10000, T0 - STUNDE, T0 + 47 * STUNDE, 1)
    check('zwei Tage ergeben sechs Abrechnungen',
        Math.abs(zweiTage - (-10000 * 0.0001 * 6)) < 1e-9, String(zweiTage))

    check('Finanzierung ist immer eine Belastung, nie ein Gewinn', eine < 0 && zweiTage < 0)
    check('ein Ausstieg vor dem Einstieg kippt nicht um',
        fundingFor(10000, T0 + 9 * STUNDE, T0 + 7 * STUNDE, 1) === 0)

    // Und der Weg über closePosition: derselbe Trade einmal mit, einmal ohne
    const bauen = () => createPosition({
        setup: { direction: 'long', symbol: 'X', timeframe: '1h', stopLoss: 90, takeProfit: 130 },
        qty: 10, entryPrice: 100, entryTime: T0 + 7 * STUNDE, leverage: 1, costs,
    })
    const ohne = closePosition(bauen(), { price: 110, reason: 'tp', time: T0 + 9 * STUNDE }, costs)
    const mit = closePosition(bauen(), { price: 110, reason: 'tp', time: T0 + 9 * STUNDE },
        { ...costs, fundingBpsPer8h: 1 })
    check('ohne Annahme bleibt das Ergebnis wie bisher', ohne.funding === 0 && ohne.netPnl === 100,
        `${ohne.funding} / ${ohne.netPnl}`)
    check('mit Annahme sinkt der Netto-Gewinn um genau die Finanzierung',
        Math.abs(mit.netPnl - (ohne.netPnl + mit.funding)) < 1e-9,
        `netPnl=${mit.netPnl} funding=${mit.funding}`)
    check('Nominalwert ist die Grundlage, nicht die Marge',
        Math.abs(mit.funding - (-1000 * 0.0001)) < 1e-9, String(mit.funding))

    // Ein echter Betrag von der Börse muss die Annahme schlagen
    const echt = closePosition(bauen(), { price: 110, reason: 'tp', time: T0 + 9 * STUNDE },
        { ...costs, fundingBpsPer8h: 1 }, { funding: -7 })
    check('ein echter Börsenbetrag schlägt die Annahme', echt.funding === -7, String(echt.funding))
}

// ── Zwangsliquidation ────────────────────────────────────────────────────
//
// Audit-Befund: der Simulator kannte nur Stop, Ziel und Zeit. Bei hohem Hebel
// ist die Marge aber weg, bevor der Stop erreicht ist — die Börse schliesst
// dann zu IHREM Preis. Ohne diese Rechnung sehen Hochhebel-Läufe zu gut aus.
console.log('\nZwangsliquidation')

{
    // Einstieg 100, Stopp 90, Hebel 20, Wartungsmarge 0,5 %
    //   Puffer = 1/20 − 0,005 = 0,045 → Liquidation bei 95,50
    const hebelLong = () => createPosition({
        setup: { direction: 'long', symbol: 'X', timeframe: '1h', stopLoss: 90, takeProfit: 130 },
        qty: 10, entryPrice: 100, entryTime: 0, leverage: 20, costs,
    })
    const hebelShort = () => createPosition({
        setup: { direction: 'short', symbol: 'X', timeframe: '1h', stopLoss: 110, takeProfit: 70 },
        qty: 10, entryPrice: 100, entryTime: 0, leverage: 20, costs,
    })

    check('Liquidationspreis Long = Einstieg · (1 − (1/Hebel − Wartungssatz))',
        Math.abs(liquidationPrice(hebelLong()) - 95.5) < 1e-9,
        String(liquidationPrice(hebelLong())))
    check('Liquidationspreis Short spiegelt den Long',
        Math.abs(liquidationPrice(hebelShort()) - 104.5) < 1e-9,
        String(liquidationPrice(hebelShort())))

    // Kerze fällt bis 95, also unter 95,50 — aber NICHT bis zum Stopp bei 90.
    const posL = hebelLong()
    const eL = stepCandle(posL, k(100, 101, 95, 96, 1), { costs })
    check('Long: Marge weg vor dem Stopp → liquidation statt sl',
        eL.exit?.reason === 'liquidation' && Math.abs(eL.exit.price - 95.5) < 1e-9,
        JSON.stringify(eL.exit))

    const posS = hebelShort()
    const eS = stepCandle(posS, k(100, 105, 99, 104, 1), { costs })
    check('Short: gespiegelt',
        eS.exit?.reason === 'liquidation' && Math.abs(eS.exit.price - 104.5) < 1e-9,
        JSON.stringify(eS.exit))

    // Der Verlust ist die Marge abzüglich der stehen gebliebenen Wartungsmarge:
    // Nominal 1000, Hebel 20 → Marge 50; 0,5 % von 1000 = 5 → −45.
    const tL = closePosition(posL, eL.exit, costs)
    check('Liquidation kostet praktisch die ganze Marge',
        Math.abs(tL.grossPnl + 45) < 1e-9 && tL.exitReason === 'liquidation',
        `gross=${tL.grossPnl} grund=${tL.exitReason}`)

    // Absturzkerze: eröffnet bereits unter dem Liquidationspreis → Fill zur
    // Eröffnung, nicht zum rechnerischen Liquidationspreis.
    const posGap = hebelLong()
    const eGap = stepCandle(posGap, k(94, 94, 88, 89, 1), { costs })
    check('Kurslücke unter die Liquidation füllt zur Eröffnung',
        eGap.exit?.reason === 'liquidation' && eGap.exit.price === 94, JSON.stringify(eGap.exit))

    // Wartungsmarge 0 → reiner Margen-Aufbrauch bei 95.
    const pos0 = hebelLong()
    check('Wartungsmarge 0 setzt die Liquidation auf den Margen-Aufbrauch',
        Math.abs(liquidationPrice(pos0, 0) - 95) < 1e-9, String(liquidationPrice(pos0, 0)))

    // Hebel so hoch, dass die Marge die Wartungsmarge nicht deckt (1/300 < 0,5 %).
    const irr = createPosition({
        setup: { direction: 'long', symbol: 'X', timeframe: '1h', stopLoss: 90, takeProfit: 130 },
        qty: 10, entryPrice: 100, entryTime: 0, leverage: 300, costs,
    })
    check('unhaltbarer Hebel liquidiert sofort am Einstieg',
        liquidationPrice(irr) === 100, String(liquidationPrice(irr)))
}

{
    // Regression: bei moderatem Hebel darf sich NICHTS ändern.
    const pos = createPosition({
        setup: { direction: 'long', symbol: 'X', timeframe: '1h', stopLoss: 90, takeProfit: 130 },
        qty: 10, entryPrice: 100, entryTime: 0, leverage: 3, costs,
    })
    const e = stepCandle(pos, k(100, 101, 89, 91, 1), { costs })
    check('Hebel 3: der Stopp greift weiterhin zuerst',
        e.exit?.reason === 'sl' && e.exit.price === 90, JSON.stringify(e.exit))

    const posEins = long()
    const eEins = stepCandle(posEins, k(100, 101, 89, 91, 1), { costs })
    check('Hebel 1: unverändert sl', eEins.exit?.reason === 'sl', JSON.stringify(eEins.exit))
}

{
    // Nach dem Break-Even liegt der Stopp über der Liquidation → er gewinnt.
    const pos = createPosition({
        setup: { direction: 'long', symbol: 'X', timeframe: '1h', stopLoss: 90, takeProfit: 130 },
        qty: 10, entryPrice: 100, entryTime: 0, leverage: 20, costs,
    })
    stepCandle(pos, k(100, 112, 99, 111, 1), { breakEvenAtR: 1, costs })
    const e = stepCandle(pos, k(111, 112, 94, 95, 2), { breakEvenAtR: 1, costs })
    check('nachgezogener Stopp schlägt die Liquidation',
        e.exit?.reason === 'be' && e.exit.price === 100, JSON.stringify(e.exit))
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen\n`)
process.exit(failed ? 1 : 0)
