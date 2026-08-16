/**
 * Selbsttest der Robustheitsprüfungen.
 *
 *   node server/strategies/__selftest-robustheit.mjs
 *
 * Geprüft werden die rechnenden Teile — Zufall, Perzentile, Monte Carlo und das
 * Plateau-Urteil. Diese Zahlen sollen später eine Freigabe stützen; sind sie
 * falsch, ist eine falsche Entscheidung teurer als ein fehlender Test.
 */

import { monteCarlo, beurteilePlateau, beurteileMatrix, perzentil, zufall, walkForward } from '../robustness.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const trade = (netPnl) => ({ netPnl, rMultiple: netPnl / 100, exitReason: netPnl > 0 ? 'tp' : 'sl' })

console.log('\nRobustheit — Selbsttest\n')

// ── Zufall und Perzentile ────────────────────────────────────────────────
console.log('Grundlagen')
{
    const a = zufall(42); const b = zufall(42); const c = zufall(43)
    const reiheA = [a(), a(), a()]
    const reiheB = [b(), b(), b()]
    check('gleiche Aussaat ergibt gleiche Folge', JSON.stringify(reiheA) === JSON.stringify(reiheB))
    check('andere Aussaat ergibt andere Folge', reiheA[0] !== c())
    check('Werte liegen in [0,1)', reiheA.every((x) => x >= 0 && x < 1), JSON.stringify(reiheA))

    check('Perzentil 0 ist das Minimum', perzentil([5, 1, 9, 3], 0) === 1)
    check('Perzentil 1 ist das Maximum', perzentil([5, 1, 9, 3], 1) === 9)
    check('Median bei gerader Anzahl interpoliert', perzentil([1, 2, 3, 4], 0.5) === 2.5)
    check('leere Reihe kippt nicht um', perzentil([], 0.5) === 0)
}

// ── Monte Carlo ──────────────────────────────────────────────────────────
console.log('\nMonte Carlo')
{
    const trades = [100, -50, 200, -50, 150, -100, 80, -40, 120, -60].map(trade)
    const r = monteCarlo(trades, { startEquity: 1000, laeufe: 300, aussaat: 7 })

    check('Trades werden gezählt', r.trades === 10, String(r.trades))
    // Mischen ändert die Reihenfolge, nicht die Summe — der Endstand MUSS
    // deshalb bei jedem Durchgang identisch sein. Wäre er es nicht, würde die
    // Mischung Beträge verlieren oder doppeln.
    check('Mischen lässt den Endstand unverändert',
        r.reihenfolge.endEquity.p5 === r.reihenfolge.endEquity.p95
        && Math.abs(r.reihenfolge.endEquity.p50 - r.original.endEquity) < 1e-9,
        `p5=${r.reihenfolge.endEquity.p5} p95=${r.reihenfolge.endEquity.p95} orig=${r.original.endEquity}`)
    check('Mischen verändert dagegen den Rückgang',
        r.reihenfolge.maxDrawdownPct.p95 > r.reihenfolge.maxDrawdownPct.p50,
        `p50=${r.reihenfolge.maxDrawdownPct.p50} p95=${r.reihenfolge.maxDrawdownPct.p95}`)
    check('Ziehen lässt auch den Endstand schwanken',
        r.ziehen.endEquity.p95 > r.ziehen.endEquity.p5,
        `p5=${r.ziehen.endEquity.p5} p95=${r.ziehen.endEquity.p95}`)
    check('Perzentile sind geordnet',
        r.ziehen.endEquity.p5 <= r.ziehen.endEquity.p50 && r.ziehen.endEquity.p50 <= r.ziehen.endEquity.p95)
    check('der schlimmste Rückgang ist mindestens das 95er-Perzentil',
        r.ziehen.maxDrawdownPct.schlimmster >= r.ziehen.maxDrawdownPct.p95)
    check('mit 10 Trades gilt es als nicht belastbar', r.belastbar === false)

    const wieder = monteCarlo(trades, { startEquity: 1000, laeufe: 300, aussaat: 7 })
    check('gleiche Aussaat ergibt dasselbe Ergebnis',
        JSON.stringify(r.ziehen) === JSON.stringify(wieder.ziehen))
}
{
    // Eine reine Verlustserie darf sich nicht schönrechnen lassen.
    const r = monteCarlo([-50, -50, -50, -50, -50].map(trade), { startEquity: 1000, laeufe: 100, aussaat: 3 })
    check('Verlustserie endet in JEDEM Durchgang im Minus', r.ziehen.anteilVerlust === 1, String(r.ziehen.anteilVerlust))
}
{
    const r = monteCarlo([trade(100)], { startEquity: 1000 })
    check('ein einzelner Trade liefert einen Hinweis statt Zahlen', r.laeufe === 0 && Boolean(r.hinweis))
    check('leere Liste kippt nicht um', monteCarlo([], {}).laeufe === 0)
    // Am Ende offene Positionen sind keine abgeschlossenen Trades.
    const gemischt = monteCarlo([trade(100), trade(-50), { netPnl: 999, exitReason: 'open_at_end' }], { startEquity: 1000, laeufe: 50 })
    check('offene Positionen am Testende zählen nicht mit', gemischt.trades === 2, String(gemischt.trades))
}

// ── Plateau-Urteil ───────────────────────────────────────────────────────
console.log('\nParameterstabilität')
{
    const p = (wert, expectancyR) => ({ wert, expectancyR, trades: 40 })

    const plateau = beurteilePlateau([p(5, 0.2), p(10, 0.4), p(15, 0.5), p(20, 0.35), p(25, 0.1)])
    check('zusammenhängende positive Zone ergibt „plateau"', plateau.urteil === 'plateau', plateau.urteil)
    check('bester Wert wird erkannt', plateau.besterWert === 15, String(plateau.besterWert))
    check('Plateau umfasst die ganze positive Zone',
        JSON.stringify(plateau.plateau) === JSON.stringify([5, 10, 15, 20, 25]), JSON.stringify(plateau.plateau))

    // Der teure Fall: ein Gipfel zwischen Abstürzen. Genau daran ist damals
    // `swingLookback: 10` gescheitert.
    const nadel = beurteilePlateau([p(5, -0.3), p(10, -0.2), p(15, 0.9), p(20, -0.25), p(25, -0.4)])
    check('einzelner Gipfel ergibt „nadel"', nadel.urteil === 'nadel', nadel.urteil)
    check('Nadel-Plateau umfasst nur sich selbst',
        JSON.stringify(nadel.plateau) === JSON.stringify([15]), JSON.stringify(nadel.plateau))

    const nichts = beurteilePlateau([p(5, -0.3), p(10, -0.2), p(15, -0.1)])
    check('durchweg negativ ergibt „nichts_positiv"', nichts.urteil === 'nichts_positiv', nichts.urteil)
    check('ohne Plateau bleibt die Zone leer', nichts.plateau.length === 0)

    const leer = beurteilePlateau([{ wert: 5, expectancyR: 1, trades: 0 }, { wert: 10, expectancyR: 1, trades: 0 }])
    check('Punkte ohne Trades gelten als zu wenig Daten', leer.urteil === 'zu_wenig_daten', leer.urteil)
    check('leere Eingabe kippt nicht um', beurteilePlateau([]).urteil === 'zu_wenig_daten')
}

// ── Urteil über mehrere Symbole und Fenster ─────────────────────────────
// Der Fall, der diese Funktion erzwungen hat: am 16.08.2026 sah
// `swingLookback: 25` im MITTEL am besten aus (+0,211) — getragen von einer
// einzigen von acht Zellen (+1,12). Ein Mittelwert hätte das durchgewinkt.
console.log('\nStabilität über mehrere Zellen')
{
    const zelle = (werte) => ({ punkte: werte.map(([wert, expectancyR]) => ({ wert, expectancyR, trades: 40 })) })

    // Ein Wert, der überall trägt — und einer, der nur einmal explodiert.
    const zellen = [
        zelle([[5, 0.10], [10, 0.12], [25, 1.12]]),
        zelle([[5, 0.08], [10, 0.11], [25, -0.29]]),
        zelle([[5, 0.09], [10, 0.10], [25, -0.26]]),
        zelle([[5, 0.07], [10, 0.09], [25, -0.43]]),
    ]
    const u = beurteileMatrix([5, 10, 25], zellen)
    const p25 = u.proWert.find((p) => p.wert === 25)
    const p5 = u.proWert.find((p) => p.wert === 5)

    check('der Ausreisser-Wert trägt NICHT', p25.traegt === false,
        `median=${p25.median} anteil=${p25.anteilPositiv}`)
    check('sein Median ist negativ, obwohl sein Mittel gut wäre', p25.median < 0, String(p25.median))
    check('Bandbreite wird sichtbar gemacht', p25.beste > 1 && p25.schlechteste < -0.4,
        `${p25.schlechteste} … ${p25.beste}`)
    check('der überall positive Wert trägt', p5.traegt === true && p5.anteilPositiv === 1)
    check('Zone enthält nur die tragenden Werte',
        JSON.stringify(u.zone) === JSON.stringify([5, 10]), JSON.stringify(u.zone))
    check('zwei tragende Nachbarn ergeben „schmal", nicht „plateau"', u.urteil === 'schmal', u.urteil)

    // Drei zusammenhängende tragende Werte sind ein Plateau.
    const breit = beurteileMatrix([5, 10, 15], [
        zelle([[5, 0.2], [10, 0.3], [15, 0.25]]),
        zelle([[5, 0.1], [10, 0.2], [15, 0.15]]),
    ])
    check('drei zusammenhängende tragende Werte ergeben „plateau"', breit.urteil === 'plateau', breit.urteil)

    // Uneinigkeit: die Hälfte positiv, die Hälfte negativ → kein Wert trägt.
    const uneinig = beurteileMatrix([5, 10], [
        zelle([[5, 0.5], [10, 0.5]]),
        zelle([[5, -0.5], [10, -0.6]]),
    ])
    check('genau geteilte Zellen tragen nicht', uneinig.zone.length === 0, JSON.stringify(uneinig.zone))

    // Datenlücken dürfen ein Urteil nicht nach unten ziehen: eine Zelle, in der
    // das Symbol damals noch nicht handelbar war, ist KEIN Gegenbeweis.
    const mitLuecke = beurteileMatrix([5, 10], [
        zelle([[5, 0.3], [10, 0.25]]),
        zelle([[5, 0.2], [10, 0.2]]),
        { punkte: [
            { wert: 5, expectancyR: -0.9, trades: 40, datenOk: false },
            { wert: 10, expectancyR: -0.9, trades: 40, datenOk: false },
        ] },
    ])
    check('Zellen ohne Datengrundlage zählen nicht gegen den Wert',
        mitLuecke.urteil === 'plateau' || mitLuecke.zone.length === 2,
        `${mitLuecke.urteil} ${JSON.stringify(mitLuecke.zone)}`)
    check('sie werden auch nicht mitgezählt',
        mitLuecke.proWert.find((p) => p.wert === 5).zellen === 2,
        String(mitLuecke.proWert.find((p) => p.wert === 5).zellen))

    const nichts = beurteileMatrix([5, 10], [zelle([[5, -0.2], [10, -0.3]]), zelle([[5, -0.1], [10, -0.4]])])
    check('durchweg negativ ergibt „nichts_positiv"', nichts.urteil === 'nichts_positiv', nichts.urteil)
    check('leere Matrix kippt nicht um', beurteileMatrix([], []).urteil === 'nichts_positiv')
}

// ── Walk-forward ─────────────────────────────────────────────────────────
//
// Der teuerste und bis zum 16.08.2026 ungeprüfte Pfad. Er rief `runBacktest`
// direkt auf und war damit nur online testbar — deshalb fiel jahrelang nicht
// auf, dass er die Kapitalkurve leer an die Statistik gab und der maximale
// Rückgang dort IMMER 0 war. Der eingespeiste Backtest macht ihn prüfbar.
console.log('\nWalk-forward')
{
    const STUNDE = 3600000
    const von = Date.UTC(2026, 0, 1)
    const bis = von + 400 * STUNDE

    // Ein erfundener Backtest: Wert 5 gewinnt auf jedem Auswahlabschnitt, und
    // die Prüfabschnitte liefern eine Kurve, die zwischendurch klar einbricht.
    const machTrade = (netPnl, t) => ({
        netPnl, rMultiple: netPnl / 100, exitReason: netPnl > 0 ? 'tp' : 'sl',
        exitTime: t, grossPnl: netPnl, fees: 0, holdingMinutes: 60, maeR: -0.2, mfeR: 1,
    })
    let ruf = 0
    const gefaelscht = async ({ params, fromTs }) => {
        ruf++
        const wert = params.stufe
        // Auswahl: 5 ist immer der beste Wert
        const gut = wert === 5
        const trades = gut
            ? [machTrade(300, fromTs + STUNDE), machTrade(-250, fromTs + 2 * STUNDE), machTrade(100, fromTs + 3 * STUNDE)]
            : [machTrade(-100, fromTs + STUNDE)]
        return { trades, stats: { expectancyR: gut ? 0.5 : -1, trades: trades.length, returnPct: gut ? 1.5 : -1 } }
    }

    const r = await walkForward(
        { fromTs: von, toTs: bis, params: {}, startEquity: 1000 },
        'stufe', [5, 9], { fenster: 3, backtest: gefaelscht },
    )

    check('Walk-forward läuft ohne echten Backtest', !r.fehler && r.abschnitte.length === 2,
        JSON.stringify(r.fehler || r.abschnitte?.length))
    check('gewählt wird der Wert mit dem besseren Erwartungswert',
        r.gewaehlteWerte.every((w) => w === 5), JSON.stringify(r.gewaehlteWerte))
    check('immer derselbe Wert gilt als stabile Auswahl', r.auswahlStabil === true)
    check('die Gesamtstatistik zählt nur die Prüfabschnitte',
        r.gesamt.trades === 6, String(r.gesamt.trades))

    // Kurve je Abschnitt: 1000 → 1300 → 1050 → 1150. Hoch 1300, Tief 1050 →
    // 19,23 %. Genau diese Zahl war vorher strukturell 0.
    check('der maximale Rückgang ist nicht mehr strukturell 0',
        r.gesamt.maxDrawdownPct > 0, String(r.gesamt.maxDrawdownPct))
    check('und er stimmt rechnerisch',
        Math.abs(r.gesamt.maxDrawdownPct - ((1300 - 1050) / 1300) * 100) < 1e-9,
        String(r.gesamt.maxDrawdownPct))
    check('der Backtest wurde wirklich eingespeist (kein Netzzugriff)', ruf > 0, String(ruf))

    const zuKurz = await walkForward({ fromTs: von, toTs: bis, params: {} }, 'stufe', [5], { backtest: gefaelscht })
    check('unter zwei Stufen gibt es nichts auszuwählen', !!zuKurz.fehler, JSON.stringify(zuKurz))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
