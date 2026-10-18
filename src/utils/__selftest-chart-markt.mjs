/**
 * Selbsttest der Marktdaten im Chart: Orderbuch-Wände und gebündelte
 * Liquidationen.
 *
 *   node src/utils/__selftest-chart-markt.mjs
 *
 * Anlass (18.10.2026): der Preis einer Wand war Σ(p·q) / Σ(p·q) — also immer
 * 1.00. Jede Wand lag weit unter dem Bild, das Overlay zeigte nichts, und
 * niemand merkte es, weil „nichts" bei einem Orderbuch plausibel aussieht.
 */
import { waendeAusBuch, liqJeKerze } from './chart/overlays/MarktEbene.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nOrderbuch-Wände\n')
{
    // Gleichmässiges Buch 99.00–100.99 mit je 10 Stück, dazu eine Wand bei 99.50 und 100.70
    const bids = [], asks = []
    for (let i = 1; i <= 100; i++) bids.push([(100 - i * 0.01).toFixed(2), i === 50 ? '400' : '10'])
    for (let i = 1; i <= 100; i++) asks.push([(100 + i * 0.01).toFixed(2), i === 70 ? '400' : '10'])
    const w = waendeAusBuch({ bids, asks })
    check('Wand-Preis liegt bei der Wand, nicht bei 1.00', w.kaeufe[0] && Math.abs(w.kaeufe[0].preis - 99.5) < 0.03, JSON.stringify(w.kaeufe[0]))
    check('Ask-Wand bei ~100.70', w.verkaeufe[0] && Math.abs(w.verkaeufe[0].preis - 100.7) < 0.03, JSON.stringify(w.verkaeufe[0]))
    check('nur die Wand, nicht das gleichmässige Buch', w.kaeufe.length === 1 && w.verkaeufe.length === 1, `${w.kaeufe.length}/${w.verkaeufe.length}`)
    check('Vielfaches des Medians wird mitgeliefert', w.kaeufe[0].vielfaches > 2.5)
    check('Reichweite des Buchs in Prozent', Math.abs(w.spanne.unten - 1) < 0.05 && Math.abs(w.spanne.oben - 1) < 0.05, JSON.stringify(w.spanne))
    const glatt = waendeAusBuch({ bids: bids.map(([p]) => [p, '10']), asks: asks.map(([p]) => [p, '10']) })
    check('Gegenprobe: gleichmässiges Buch → keine Wand', glatt.kaeufe.length === 0 && glatt.verkaeufe.length === 0)
    check('leeres Buch bricht nicht', waendeAusBuch({ bids: [], asks: [] }).kaeufe.length === 0)
}

console.log('\nLiquidationen je Kerze\n')
{
    const H = 3_600_000
    const zeiten = [0, H, 2 * H].map((x) => x + 1_000_000)
    const liq = [
        { t: zeiten[0] + 10, price: 100, qty: 1, isBuy: false },     // Long liquidiert
        { t: zeiten[0] + 20, price: 98, qty: 3, isBuy: false },      // Long liquidiert
        { t: zeiten[0] + 30, price: 105, qty: 2, isBuy: true },      // Short liquidiert
        { t: zeiten[2] + 5, price: 110, qty: 1, isBuy: true },
        { t: zeiten[0] - 5, price: 90, qty: 9, isBuy: false },       // vor der ersten Kerze
    ]
    const b = liqJeKerze(liq, zeiten)
    const long0 = b.find((x) => x.i === 0 && x.long)
    check('je Kerze und Seite gebündelt', b.length === 3, JSON.stringify(b))
    check('Summe USD der Longs in Kerze 0', long0.usd === 100 + 294 && long0.anzahl === 2)
    check('Preis USD-gewichtet', Math.abs(long0.preis - (100 * 100 + 98 * 294) / 394) < 1e-9)
    check('isBuy = Short liquidiert (grün), nicht Long', b.some((x) => x.i === 0 && !x.long && x.usd === 210))
    check('Ereignis vor der ersten Kerze fällt weg', !b.some((x) => x.preis === 90))
    check('ohne Kerzen leer statt Absturz', liqJeKerze(liq, []).length === 0)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
