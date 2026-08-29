/**
 * Selbsttest von Rangfolge und Nullverteilung.
 *
 *   node server/__selftest-rangliste-rang.mjs
 *
 * Die Nullverteilung ist der einzige Teil der Coin-Rangliste, der dem Nutzer
 * widerspricht: sie sagt ihm, wann seine schöne Rangliste nichts wert ist.
 * Genau deshalb muss sie stimmen — eine Beurteilung, die zu selten warnt, ist
 * schlimmer als gar keine, weil sie Vertrauen schafft, wo keines hingehört.
 */

import { vergibRaenge, umtopfen, beurteileRangliste, ranglisteSatz } from './rangliste-rang.js'
// Spearman liegt seit dem Audit vom 28.08.2026 in `shared/statistik.js` —
// die Formel stand dreimal im Projekt, zweimal ohne Bindungskorrektur.
import { spearman } from '../shared/statistik.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Eine Ergebniszeile, wie `bearbeiteCoin` sie liefert. */
const zeile = (symbol, klasse, aOhneTopR, bOhneTopR = 0, aTrades = 40, bTrades = 40, rReiheA = null) => ({
    symbol, klasse, aOhneTopR, bOhneTopR, aTrades, bTrades,
    rReiheA: rReiheA || Array.from({ length: aTrades }, (_, i) => aOhneTopR + ((i % 5) - 2) * 0.4),
})

console.log('\nRangfolge und Nullverteilung — Selbsttest\n')

// ── Rangfolge ────────────────────────────────────────────────────────────
console.log('Rangfolge')
{
    const zeilen = [
        zeile('CUSDT', 'belastbar', 0.2),
        zeile('AUSDT', 'belastbar', 0.9),
        zeile('BUSDT', 'belastbar', 0.5),
        zeile('DUENNUSDT', 'zu_wenig_trades', 2.1, 0, 4, 3),
        zeile('LUECKEUSDT', 'datenluecke', 1.5),
    ]
    vergibRaenge(zeilen)
    const nachRang = zeilen.filter((z) => z.rangA > 0).sort((a, b) => a.rangA - b.rangA).map((z) => z.symbol)
    check('gerangt wird nach expectancyROhneTop, absteigend',
        nachRang.join(',') === 'AUSDT,BUSDT,CUSDT', nachRang.join(','))
    check('ein Coin mit 4 Trades und 2,1 R bekommt KEINEN Rang',
        zeilen.find((z) => z.symbol === 'DUENNUSDT').rangA === 0)
    check('… und verschwindet trotzdem nicht aus der Liste',
        zeilen.some((z) => z.symbol === 'DUENNUSDT'))
    check('eine Datenlücke bekommt ebenfalls keinen Rang',
        zeilen.find((z) => z.symbol === 'LUECKEUSDT').rangA === 0)

    // Gleichstand muss reproduzierbar sein, sonst wechselt die Anzeige grundlos
    const gleich = [zeile('ZUSDT', 'belastbar', 0.5), zeile('AUSDT', 'belastbar', 0.5)]
    vergibRaenge(gleich)
    check('bei Gleichstand entscheidet das Symbol (stabil über Läufe hinweg)',
        gleich.find((z) => z.symbol === 'AUSDT').rangA === 1)

    check('eine leere Liste kippt nicht um', vergibRaenge([]).length === 0)
}

// ── Spearman gegen Handrechnung ──────────────────────────────────────────
console.log('\nRangkorrelation')
{
    check('gleiche Reihenfolge ergibt 1',
        Math.abs(spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-9,
        String(spearman([1, 2, 3, 4], [10, 20, 30, 40])))
    check('umgekehrte Reihenfolge ergibt −1',
        Math.abs(spearman([1, 2, 3, 4], [40, 30, 20, 10]) + 1) < 1e-9,
        String(spearman([1, 2, 3, 4], [40, 30, 20, 10])))

    // Handrechnung mit Bindungen: x = [1,2,2,3] → Ränge [1, 2.5, 2.5, 4]
    const mitBindung = spearman([1, 2, 2, 3], [1, 2, 2, 3])
    check('Bindungen bekommen den mittleren Rang', Math.abs(mitBindung - 1) < 1e-9, String(mitBindung))

    check('weniger als drei Paare sind nicht messbar', spearman([1, 2], [1, 2]) === null)
    check('eine konstante Reihe ist nicht messbar — null statt 0',
        spearman([1, 1, 1, 1], [1, 2, 3, 4]) === null)
    check('unterschiedlich lange Reihen kippen nicht um',
        typeof spearman([1, 2, 3, 4, 5], [1, 2, 3]) === 'number' || spearman([1, 2, 3, 4, 5], [1, 2, 3]) === null)
}

// ── Umtopfen ─────────────────────────────────────────────────────────────
console.log('\nUmtopfen (Nullverteilung)')
{
    // 20 Coins, alle aus DERSELBEN Verteilung gezogen — es gibt in Wahrheit
    // keinen besseren. Der beste sieht trotzdem gut aus; genau das soll die
    // Nullverteilung entlarven.
    const wuerfel = (() => { let a = 7; return () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648 } })()
    const gleichGut = Array.from({ length: 20 }, (_, i) => {
        const rs = Array.from({ length: 40 }, () => (wuerfel() - 0.5) * 4)
        const mittel = rs.reduce((s, v) => s + v, 0) / rs.length
        return { symbol: `C${i}USDT`, klasse: 'belastbar', aOhneTopR: mittel, bOhneTopR: 0,
                 aTrades: 40, bTrades: 40, rReiheA: rs }
    })
    const u = umtopfen(gleichGut)
    check('20 gleich gute Coins ergeben eine Nullverteilung', !!u)
    check('… und der beste ist NICHT auffällig',
        u.anteilUeberBeobachtet > 0.05,
        `Anteil ${(u.anteilUeberBeobachtet * 100).toFixed(0)} %, beobachtet ${u.beobachtet.toFixed(2)}, p50 ${u.p50.toFixed(2)}`)
    check('die Perzentile stehen in der richtigen Reihenfolge',
        u.p50 <= u.p90 && u.p90 <= u.p95, `${u.p50} / ${u.p90} / ${u.p95}`)

    // Ein Coin, der WIRKLICH besser ist, muss auffallen.
    const einerBesser = [...gleichGut.slice(0, 19), {
        symbol: 'GUTUSDT', klasse: 'belastbar', aOhneTopR: 6, bOhneTopR: 5,
        aTrades: 40, bTrades: 40, rReiheA: Array.from({ length: 40 }, () => 6),
    }]
    const u2 = umtopfen(einerBesser)
    check('ein echter Ausreisser wird als auffällig erkannt',
        u2.anteilUeberBeobachtet < 0.05,
        `Anteil ${(u2.anteilUeberBeobachtet * 100).toFixed(0)} %`)

    // Reproduzierbarkeit: feste Aussaat
    check('zweimal gerechnet ergibt exakt dasselbe',
        JSON.stringify(umtopfen(gleichGut)) === JSON.stringify(umtopfen(gleichGut)))

    check('unter zwei belastbaren Coins gibt es nichts zu vergleichen',
        umtopfen([zeile('AUSDT', 'belastbar', 1)]) === null)
    check('ohne belastbare Coins ebenfalls null',
        umtopfen([zeile('AUSDT', 'zu_wenig_trades', 1, 0, 4, 4)]) === null)
    check('leere R-Reihen kippen nicht um',
        umtopfen([{ symbol: 'A', klasse: 'belastbar', aOhneTopR: 1, rReiheA: [] },
                  { symbol: 'B', klasse: 'belastbar', aOhneTopR: 1, rReiheA: [] }]) === null)
}

// ── Gesamtbeurteilung ────────────────────────────────────────────────────
console.log('\nGesamtbeurteilung')
{
    const zeilen = [
        zeile('AUSDT', 'belastbar', 0.9, 0.7),
        zeile('BUSDT', 'belastbar', 0.5, 0.3),
        zeile('CUSDT', 'belastbar', 0.2, -0.1),
        zeile('DUSDT', 'belastbar', -0.3, -0.4),
        // Prüfhälfte zu dünn: zählt nicht als Gegenbeweis
        zeile('EUSDT', 'belastbar', 0.6, 2.0, 40, 5),
        zeile('FUSDT', 'zu_wenig_trades', 3.0, 3.0, 4, 4),
    ]
    const b = beurteileRangliste(zeilen)
    check('nur belastbare Coins zählen', b.coins === 5, String(b.coins))
    check('die Grundquote der Rang-Hälfte stimmt',
        b.grundquote.positivA === 4 && b.grundquote.gesamtA === 5,
        `${b.grundquote.positivA}/${b.grundquote.gesamtA}`)
    check('die Prüfhälfte zählt nur Coins mit genug Trades',
        b.grundquote.gesamtB === 4, String(b.grundquote.gesamtB))
    check('eine dünne Prüfhälfte wird NICHT als Bestätigung mitgezählt',
        b.grundquote.positivB === 2, String(b.grundquote.positivB))
    check('die Rangkorrelation wird gerechnet', typeof b.spearman === 'number', String(b.spearman))
    check('… und ist hier positiv (die Reihenfolge hält)', b.spearman > 0.5, String(b.spearman))
    check('„halten die Besten" bezieht sich auf die geprüften',
        b.top10Haelt.geprueft === 4 && b.top10Haelt.positiv === 2,
        JSON.stringify(b.top10Haelt))

    const leer = beurteileRangliste([zeile('AUSDT', 'ohne_daten', 0)])
    check('ohne belastbare Coins kippt nichts um', leer.coins === 0 && leer.umtopfen === null)
}

// ── Der Satz ─────────────────────────────────────────────────────────────
console.log('\nDer Satz über der Tabelle')
{
    const wuerfel = (() => { let a = 99; return () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648 } })()
    const zeilen = Array.from({ length: 12 }, (_, i) => {
        const rs = Array.from({ length: 40 }, () => (wuerfel() - 0.5) * 4)
        const mittel = rs.reduce((s, v) => s + v, 0) / rs.length
        return { symbol: `C${i}USDT`, klasse: 'belastbar', aOhneTopR: mittel,
                 bOhneTopR: mittel * 0.5, aTrades: 40, bTrades: 40, rReiheA: rs }
    })
    const satz = ranglisteSatz(beurteileRangliste(zeilen))
    check('der Satz nennt den Besten und den Zufallsvergleich',
        /R\. Wären alle 12/.test(satz) && /Ziehungen/.test(satz), satz)
    check('er zieht ein Fazit', /Zufall/.test(satz), satz)
    check('er nennt beide Grundquoten', /Rang-Hälfte/.test(satz) && /Prüfhälfte/.test(satz), satz)
    check('ohne belastbare Coins sagt er das klar',
        /Kein einziger Coin/.test(ranglisteSatz(beurteileRangliste([]))))
    check('er kippt auch bei null nicht um', typeof ranglisteSatz(null) === 'string')
}

console.log(`\n${fehlgeschlagen === 0 ? '\x1b[32m' : '\x1b[31m'}${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\x1b[0m`)
if (fehlgeschlagen) { console.log('Fehlgeschlagen:'); for (const f of fehler) console.log(`  · ${f}`) }
process.exit(fehlgeschlagen ? 1 : 0)
