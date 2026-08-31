/**
 * Selbsttest: Hebel-Kalibrierung aus aufgezeichneten Liquidationen
 * (`liq-kalibrierung.js`, pure Kernfunktion).
 *
 *   node server/__selftest-liq-kalibrierung.mjs
 *
 * Die zwei gefährlichen Stellen: die SEITEN-Konvention (isBuy true = SHORT
 * liquidiert — einmal vertauscht, und die Verteilung ist plausibler Unsinn)
 * und die Inversion der Liquidationsformel (Vorzeichenfehler verschieben den
 * implizierten Einstieg systematisch, jede Verteilung sähe trotzdem nach
 * einer Verteilung aus).
 */

import { schaetzeHebelVerteilung } from './liq-kalibrierung.js'
import { liqPreisLong, liqPreisShort } from '../shared/liquidation.js'

let bestanden = 0
let fehlgeschlagen = 0
const pruefe = (name, ok, detail = '') => {
    if (ok) { bestanden++; return }
    fehlgeschlagen++
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
}
const nahe = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

console.log('Hebel-Kalibrierung')

const MMR = 0.004
const M5 = 5 * 60 * 1000
const t0 = 1_000_000_000_000

/** Kerze, deren Spanne genau die übergebenen Preise umfasst. */
const kerze = (i, lo, hi, add = 0) => ({ t: t0 + i * M5, l: lo, h: hi, add })

// ── Konzentration: Events exakt auf dem 25x-Liq-Preis ──────────────────
{
    // Einstieg 100 wurde in Kerze 0 gehandelt (und NUR dort). Ein Long mit
    // 25x liquidiert bei liqPreisLong(100, 25, mmr) — Events genau dort
    // müssen auf 25x konzentrieren, weil die implizierten Einstiege der
    // anderen Stufen ausserhalb jeder Kerzenspanne liegen.
    const liq25 = liqPreisLong(100, 25, MMR)
    const kerzen = [kerze(0, 99.9, 100.1, 500)]
    const events = [
        { t: t0 + 10 * M5, price: liq25, qty: 1, isBuy: false },
        { t: t0 + 11 * M5, price: liq25, qty: 2, isBuy: false },
    ]
    const erg = schaetzeHebelVerteilung(events, kerzen, { mmr: MMR })
    pruefe('Events auf dem 25x-Liq-Preis konzentrieren auf 25x',
        erg.gewichte && nahe(erg.gewichte[25], 1),
        JSON.stringify(erg.gewichte))
    pruefe('nichts landet im Unerklärt-Topf', erg.unerklaertPct === 0)
}

// ── Seiten-Konvention: isBuy=true ist ein liquidierter SHORT ───────────
{
    // Ein Short mit 50x, Einstieg 100, liquidiert OBERHALB bei
    // liqPreisShort(100, 50, mmr). Nur wenn die Inversion die Short-Formel
    // nimmt, landet der implizierte Einstieg in der 100er-Kerze.
    const liqS50 = liqPreisShort(100, 50, MMR)
    const kerzen = [kerze(0, 99.9, 100.1, 500)]
    const events = [{ t: t0 + 10 * M5, price: liqS50, qty: 1, isBuy: true }]
    const erg = schaetzeHebelVerteilung(events, kerzen, { mmr: MMR })
    pruefe('isBuy=true wird als liquidierter Short invertiert',
        erg.gewichte && nahe(erg.gewichte[50], 1),
        JSON.stringify(erg.gewichte))
}

// ── Unerklärbare Events verzerren die Gewichte nicht ───────────────────
{
    const liq25 = liqPreisLong(100, 25, MMR)
    const kerzen = [kerze(0, 99.9, 100.1, 500)]
    const events = [
        { t: t0 + 10 * M5, price: liq25, qty: 1, isBuy: false },
        // Preis weit weg von allem, was je gehandelt wurde (Cross-Margin-Fall)
        { t: t0 + 11 * M5, price: 55, qty: 1, isBuy: false },
    ]
    const erg = schaetzeHebelVerteilung(events, kerzen, { mmr: MMR })
    pruefe('unerklärbares Event landet im Topf, nicht in den Gewichten',
        erg.gewichte && nahe(erg.gewichte[25], 1) && erg.unerklaertPct > 0,
        JSON.stringify(erg))
}

// ── Fraktionale Zuordnung summiert auf 1 ───────────────────────────────
{
    // Zwei Kerzen so gelegt, dass der 25x- UND der 50x-implizierte Einstieg
    // desselben Events gehandelt wurden — das Event teilt sich auf.
    const x = 96
    const e25 = x * (1 - MMR) / (1 - 1 / 25)
    const e50 = x * (1 - MMR) / (1 - 1 / 50)
    const kerzen = [
        kerze(0, e25 - 0.01, e25 + 0.01, 300),
        kerze(1, e50 - 0.01, e50 + 0.01, 100),
    ]
    const events = [{ t: t0 + 10 * M5, price: x, qty: 1, isBuy: false }]
    const erg = schaetzeHebelVerteilung(events, kerzen, { mmr: MMR })
    const summe = Object.values(erg.gewichte || {}).reduce((a, b) => a + b, 0)
    pruefe('fraktionale Zuordnung summiert auf 1', nahe(summe, 1), String(summe))
    pruefe('ΔOI gewichtet die Aufteilung (300 zu 100 → 3:1)',
        nahe(erg.gewichte[25], 0.75) && nahe(erg.gewichte[50], 0.25),
        JSON.stringify(erg.gewichte))
}

// ── Notional-Klipp am p99 ──────────────────────────────────────────────
{
    // 200 kleine Events auf 25x, EIN Wal (10'000-faches Notional) auf 50x.
    // Ohne Klipp bestimmte der Wal die Verteilung fast allein.
    const liq25 = liqPreisLong(100, 25, MMR)
    const liq50 = liqPreisLong(100, 50, MMR)
    const e25 = liq25 * (1 - MMR) / (1 - 1 / 25)   // = 100
    void e25
    const kerzen = [
        kerze(0, 99.99, 100.01, 500),               // Einstieg 100 (für 25x-Events)
        kerze(1, liq50 * (1 - MMR) / (1 - 1 / 50) - 0.001,
            liq50 * (1 - MMR) / (1 - 1 / 50) + 0.001, 500),  // Einstieg des Wals
    ]
    const events = []
    for (let i = 0; i < 200; i++) events.push({ t: t0 + (10 + i) * M5, price: liq25, qty: 1, isBuy: false })
    events.push({ t: t0 + 300 * M5, price: liq50, qty: 10000, isBuy: false })
    const erg = schaetzeHebelVerteilung(events, kerzen, { mmr: MMR })
    pruefe('p99-Klipp hält den Wal klein (25x bleibt dominant)',
        erg.gewichte && erg.gewichte[25] > 0.5,
        JSON.stringify(erg.gewichte))
}

// ── Max-Hebel klemmt die Hypothesen ────────────────────────────────────
{
    const kerzen = [kerze(0, 99.9, 100.1, 500)]
    const events = [{ t: t0 + 10 * M5, price: liqPreisLong(100, 25, MMR), qty: 1, isBuy: false }]
    const erg = schaetzeHebelVerteilung(events, kerzen, { mmr: MMR, maxHebel: 50 })
    pruefe('bei Max-Hebel 50 verschwindet die 100x-Hypothese',
        erg.stufen.join(',') === '10,25,50', erg.stufen.join(','))
}

// ── Leere Eingaben ─────────────────────────────────────────────────────
{
    const leer = schaetzeHebelVerteilung([], [], { mmr: MMR })
    pruefe('ohne Events gibt es keine Gewichte', leer.gewichte === null)
}

console.log(`  ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) process.exit(1)
