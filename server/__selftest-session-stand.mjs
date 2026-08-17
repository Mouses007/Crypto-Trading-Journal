/**
 * Selbsttest des Sitzungsstand-Zusammenschnitts — ohne Netz, ohne Datenbank.
 *
 *   node server/__selftest-session-stand.mjs
 *
 * `/api/livetrading/session-stand` las bisher nur die erste Bitunix-Seite
 * (limit 100, kein skip): ab der 101. geschlossenen Position zählten
 * Plan-Grenzen und Verlustbalken still zu wenig. Hier wird die
 * Paginierschleife mit einer eingespeisten Seitenquelle gefüttert und das
 * Ergebnis durch `berechneSitzung` gezogen — 101 Positionen müssen als 101
 * ankommen, nicht als 100.
 */

import { alleHistoryPositions } from './livetrading-api.js'
import { berechneSitzung } from './sitzung-rechnung.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Seitenquelle über einem festen Bestand, im Antwortformat von Bitunix. */
function quelleUeber(bestand) {
    const aufrufe = []
    const holeSeite = async (skip, limit) => {
        aufrufe.push({ skip, limit })
        return { data: { positionList: bestand.slice(skip, skip + limit) } }
    }
    return { holeSeite, aufrufe }
}

function position(i) {
    return { positionId: String(i), symbol: 'BTCUSDT', realizedPNL: i % 2 === 0 ? 10 : -4, fee: 0.5, mtime: 1000 + i }
}

console.log('\nPaginierung (alleHistoryPositions)\n')

{
    const kurz = Array.from({ length: 42 }, (_, i) => position(i))
    const q1 = quelleUeber(kurz)
    const r1 = await alleHistoryPositions({}, { startTime: 0, endTime: 9999 }, q1.holeSeite)
    check('42 Positionen: eine Seite reicht', r1.length === 42 && q1.aufrufe.length === 1)

    const grenze = Array.from({ length: 100 }, (_, i) => position(i))
    const q2 = quelleUeber(grenze)
    const r2 = await alleHistoryPositions({}, { startTime: 0, endTime: 9999 }, q2.holeSeite)
    check('genau 100: zweite Seite wird geprüft und ist leer', r2.length === 100 && q2.aufrufe.length === 2)

    const scalper = Array.from({ length: 101 }, (_, i) => position(i))
    const q3 = quelleUeber(scalper)
    const r3 = await alleHistoryPositions({}, { startTime: 0, endTime: 9999 }, q3.holeSeite)
    check('101 Positionen kommen als 101 an, nicht als 100', r3.length === 101, String(r3.length))
    check('Seiten wurden mit fortlaufendem skip geholt',
        q3.aufrufe[0].skip === 0 && q3.aufrufe[1].skip === 100)

    // Kaputte API, die immer volle Seiten liefert → harte Kappe statt Endlosschleife
    const immerVoll = async (skip, limit) => ({ data: { positionList: Array.from({ length: limit }, (_, i) => position(skip + i)) } })
    const r4 = await alleHistoryPositions({}, { startTime: 0, endTime: 9999 }, immerVoll)
    check('harte Kappe stoppt eine nie endende Seitenfolge', r4.length <= 2100, String(r4.length))

    const leer = quelleUeber([])
    const r5 = await alleHistoryPositions({}, { startTime: 0, endTime: 9999 }, leer.holeSeite)
    check('leeres Fenster liefert leere Liste', r5.length === 0)
}

console.log('\nDurchstich zur Sitzungsrechnung\n')

{
    const scalper = Array.from({ length: 101 }, (_, i) => position(i))
    const q = quelleUeber(scalper)
    const geschlossen = await alleHistoryPositions({}, { startTime: 0, endTime: 9999 }, q.holeSeite)
    const stand = berechneSitzung({ offen: [], geschlossen, planMaxVerlustUsd: 0, planMaxTrades: 100 })
    check('berechneSitzung sieht alle 101 Trades', stand.tradeAnzahl === 101, String(stand.tradeAnzahl))
    check('Plan-Grenze 100 ist mit 101 Trades verletzt',
        stand.plan.verletzt === true && stand.plan.gruende.includes('trades'),
        JSON.stringify(stand.plan))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
