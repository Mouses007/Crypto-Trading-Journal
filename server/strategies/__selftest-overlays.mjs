/**
 * Selbsttest der Strategie-Overlays für den Chart.
 *
 *   node server/strategies/__selftest-overlays.mjs
 *
 * Die eine Eigenschaft, auf die es ankommt: die Zonen im Chart sind DIESELBEN,
 * mit denen `detect()` entscheidet — gleiche Anzahl, gleiche Grenzen, gleiche
 * Güte. Dazu: Zeiten statt Indizes (der Chart kennt keine Indizes der
 * Strategie), fehlende höhere Zeiteinheit als Hinweis statt stiller
 * Ersatzrechnung, und andere Strategien liefern nichts statt Unsinn.
 */
import strategie, { zonenLage } from './set_and_forget.js'
import { defaultsFromSchema } from './index.js'
import { overlaysFuer } from './overlays.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const P = { ...defaultsFromSchema(strategie.params), htfTrendFilter: false, zweiteEbene: false }
const TF = 3_600_000
const T0 = 1_700_000_000_000

// Schwingung zwischen ~100 und ~110 mit leichtem Aufwärtstrend: mehrfach
// berührte Hoch- und Tiefpunkte ergeben Zonen.
const kerzen = Array.from({ length: 400 }, (_, i) => {
    const mitte = 105 + i * 0.01 + 5 * Math.sin(i / 6)
    const o = mitte - 0.3 * Math.cos(i)
    const c = mitte + 0.3 * Math.cos(i)
    return { t: T0 + i * TF, o, h: Math.max(o, c) + 0.4, l: Math.min(o, c) - 0.4, c, v: 100 }
})

console.log('\nStrategie-Overlays — Selbsttest\n')
{
    const lage = zonenLage({ candles: kerzen, params: P })
    const ov = overlaysFuer('set_and_forget', { candles: kerzen, params: P })
    check('es entstehen Zonen (sonst prüft der Rest nichts)', lage.zonen.length > 0, String(lage.zonen.length))
    check('Overlay zeigt genau die Zonen der Strategie', ov.zonen.length === lage.zonen.length)
    check('gleiche Grenzen und Güte', ov.zonen.every((z, i) =>
        z.tief === lage.zonen[i].tief && z.hoch === lage.zonen[i].hoch && z.guete === (lage.zonen[i].guete ?? null)))
    const zeiten = new Set(kerzen.map((k) => k.t))
    check('Zeiten sind Kerzenzeiten (keine Indizes)', ov.zonen.every((z) => zeiten.has(z.vonT) && zeiten.has(z.letzteT)))
    check('Zone beginnt nicht nach ihrer letzten Berührung', ov.zonen.every((z) => z.vonT <= z.letzteT))
    check('Wendepunkte liegen innerhalb der (verbreiterten) Zone oder knapp daneben',
        ov.zonen.every((z) => z.stellen.every((s) => s.p >= z.tief - (z.hoch - z.tief) && s.p <= z.hoch + (z.hoch - z.tief))))
    check('Trend beider Ebenen mitgeliefert', ov.trend && [1, 0, -1].includes(ov.trend.ebene1) && [1, 0, -1].includes(ov.trend.ebene2))
}
{
    const mitHtf = { ...P, htfTrendFilter: true }
    const ov = overlaysFuer('set_and_forget', { candles: kerzen, params: mitHtf, htfCandles: null })
    check('HTF-Filter an, HTF-Kerzen fehlen → Hinweis statt Ersatzrechnung', ov.hinweis === 'htfFehlt' && !ov.zonen)
    const htf = kerzen.filter((_, i) => i % 4 === 0).map((k) => ({ ...k }))
    const mitDaten = overlaysFuer('set_and_forget', { candles: kerzen, params: mitHtf, htfCandles: htf })
    const lage = zonenLage({ candles: kerzen, params: mitHtf, htfCandles: htf })
    check('mit HTF-Kerzen: Zonen aus der höheren Ebene, wie detect()', !mitDaten.hinweis && mitDaten.zonen.length === lage.zonen.length)
}
check('Andere Strategie → leeres Overlay', Object.keys(overlaysFuer('lsob', { candles: kerzen, params: {} })).length === 0)
check('Keine Kerzen → leeres Overlay', Object.keys(overlaysFuer('set_and_forget', { candles: [], params: P })).length === 0)

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
