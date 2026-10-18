/**
 * Selbsttest: Signalverlauf für die Chart-Indikatoren LSOB / GUSS.
 *
 *   node server/__selftest-chart-signale.mjs
 *
 * Mit einer Attrappen-Strategie, deren Verhalten bekannt ist — geprüft wird
 * die Schleife: kein Blick in die Zukunft, Ereignisse am richtigen Setup,
 * Ausgang Ziel/Stop ab der Kerze NACH der Auslösung.
 */
import { signalVerlauf } from './chart-signale.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const H = 3600e3
const T0 = 1_760_000_000_000
// 60 Kerzen um 100; ab Kerze 40 steigt der Kurs (Ziel 106 erreicht bei 46)
const kerzen = Array.from({ length: 60 }, (_, i) => {
    const m = i < 40 ? 100 : 100 + (i - 40)
    return { t: T0 + i * H, o: m, h: m + 0.5, l: m - 0.5, c: m, v: 1 }
})

/*
 * Attrappe: meldet bei Kerze 30 ein Long-Setup (Zone 99–100), löst es aus,
 * sobald eine Kerze unter 99,6 kommt ODER — für den Zukunftstest — merkt sich,
 * welche letzte Kerze sie je gesehen hat.
 */
let gesehen = []
const attrappe = {
    warmupCandles: 10,
    detect({ candles, openSetups }) {
        const letzte = candles[candles.length - 1]
        gesehen.push(letzte.t)
        const setups = [], events = []
        if (letzte.t === T0 + 30 * H) setups.push({ direction: 'long', status: 'waiting_retest', obLow: 99, obHigh: 100, obCandleTime: letzte.t, entry: 100, stopLoss: 98, takeProfit: 106 })
        for (const s of openSetups) {
            if (letzte.t === T0 + 35 * H) events.push({ id: s.id, status: 'triggered', triggeredAt: letzte.t, entry: 100, stopLoss: 98, takeProfit: 106 })
        }
        return { setups, events, diagnostics: {} }
    },
}

console.log('\nSchleife\n')
{
    gesehen = []
    const r = signalVerlauf({ strategie: attrappe, candles: kerzen, params: { scanWindowCandles: 5, retestMaxCandles: 5 }, ltfMs: H, anzeigen: 50 })
    check('detect sieht nie eine Kerze nach der aktuellen (aufsteigend, je Kerze genau eine neue)', gesehen.every((t, i) => i === 0 || t === gesehen[i - 1] + H))
    check('beginnt nach dem Vorlauf (warmup bzw. anzeigen)', gesehen[0] === T0 + 10 * H, String((gesehen[0] - T0) / H))
    check('ein Setup erkannt', r.setups.length === 1)
    const s = r.setups[0]
    check('Auslösung am Setup vermerkt', s.status === 'triggered' && s.triggeredAt === T0 + 35 * H)
    check('Ausgang: Ziel 106 bei Kerze 46 (Hoch 106,5)', s.ausgang === 'ziel' && s.exitT === T0 + 46 * H, JSON.stringify(s))
    check('Zone und Kurse übernommen', s.obLow === 99 && s.obHigh === 100 && s.takeProfit === 106)
}
{
    // Stop und Ziel in derselben Kerze → Stop (vorsichtige Lesart)
    const k = kerzen.map((x, i) => (i === 37 ? { ...x, h: 107, l: 97 } : x))
    const r = signalVerlauf({ strategie: attrappe, candles: k, params: {}, ltfMs: H, anzeigen: 50 })
    check('Stop und Ziel in einer Kerze → Stop', r.setups[0].ausgang === 'stop' && r.setups[0].exitT === T0 + 37 * H)
    // Ausgang erst ab der Kerze NACH der Auslösung — ein Docht in der Auslösekerze zählt nicht
    const k2 = kerzen.map((x, i) => (i === 35 ? { ...x, l: 97 } : x))
    const r2 = signalVerlauf({ strategie: attrappe, candles: k2, params: {}, ltfMs: H, anzeigen: 50 })
    check('Docht in der Auslösekerze löst keinen Stop aus', r2.setups[0].ausgang === 'ziel')
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
