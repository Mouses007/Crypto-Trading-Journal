/**
 * Selbsttest der Backtest-Kennzahlen und der Datenabdeckung.
 *
 *   node server/strategies/__selftest-statistik.mjs
 *
 * Beide Prüfungen entstanden aus echten Fehlmessungen vom 16.08.2026: ein
 * Erwartungswert von 1,467 R, hinter dem ein einziger Trade stand, und ein
 * Backtest, der still ein halbes Jahr weniger gemessen hat als eingestellt.
 */

import {
    berechneStatistik, berechneSharpe, pruefeAbdeckung, runBacktest, MIN_TRADES_BELASTBAR,
    berechneBuyHoldBaseline, floatingEquitySchritt, schaetzeFloatingDrawdownAusTrades,
} from '../strategy-backtest.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const STUNDE = 3600000
const reihe = (von, n, schritt = STUNDE) =>
    Array.from({ length: n }, (_, i) => ({ t: von + i * schritt, o: 1, h: 1, l: 1, c: 1, v: 1 }))

const trade = (r) => ({
    rMultiple: r, netPnl: r * 10, grossPnl: r * 10, fees: 0,
    exitReason: r > 0 ? 'tp' : 'sl', holdingMinutes: 60, maeR: -0.2, mfeR: Math.max(r, 0.2),
})

console.log('\nKennzahlen und Datenabdeckung — Selbsttest\n')

// ── Erwartungswert ohne den grössten Gewinner ────────────────────────────
console.log('Ausreisser-Test')
{
    // Der Fall aus der 4h-Messung: ein Riesengewinner trägt das ganze Ergebnis.
    const trades = [trade(14), trade(-1), trade(-1), trade(-1), trade(-1)]
    const s = berechneStatistik(trades, 1000, 1100, [])
    check('Erwartungswert zählt alle Trades', Math.abs(s.expectancyR - 2) < 1e-9, String(s.expectancyR))
    check('ohne den grössten Gewinner bleibt der Rest',
        Math.abs(s.expectancyROhneTop - (-1)) < 1e-9, String(s.expectancyROhneTop))
    check('der Unterschied entlarvt den Einzeltrade', s.expectancyR > 0 && s.expectancyROhneTop < 0)
}
{
    const s = berechneStatistik([trade(2)], 1000, 1020, [])
    check('ein einziger Trade ergibt keine Division durch null', s.expectancyROhneTop === 0, String(s.expectancyROhneTop))
}
{
    const s = berechneStatistik([], 1000, 1000, [])
    check('ohne Trades bleiben die neuen Felder gesetzt',
        s.expectancyROhneTop === 0 && s.belastbar === false && s.mindestTrades === MIN_TRADES_BELASTBAR)
}

// ── Belastbarkeit ────────────────────────────────────────────────────────
console.log('\nMindest-Stichprobe')
{
    const wenig = berechneStatistik(Array.from({ length: MIN_TRADES_BELASTBAR - 1 }, () => trade(1)), 1000, 1290, [])
    const genug = berechneStatistik(Array.from({ length: MIN_TRADES_BELASTBAR }, () => trade(1)), 1000, 1300, [])
    check(`unter ${MIN_TRADES_BELASTBAR} Trades nicht belastbar`, wenig.belastbar === false, String(wenig.trades))
    check(`ab ${MIN_TRADES_BELASTBAR} Trades belastbar`, genug.belastbar === true, String(genug.trades))
    // Am Ende zwangsweise geschlossene Positionen sind keine echten Trades und
    // dürfen die Grenze nicht künstlich erreichen.
    const mitOffenen = berechneStatistik(
        [...Array.from({ length: 5 }, () => trade(1)),
         ...Array.from({ length: 40 }, () => ({ ...trade(1), exitReason: 'open_at_end' }))],
        1000, 1050, [],
    )
    check('offene Positionen am Testende zählen nicht mit',
        mitOffenen.trades === 5 && mitOffenen.belastbar === false, `${mitOffenen.trades}`)
}

// ── Maximaler Rückgang ───────────────────────────────────────────────────
//
// Bis zum 16.08.2026 gab es dafür keine einzige Prüfung (Audit-Befund A4-3) —
// und genau deshalb fiel nicht auf, dass der Walk-forward die Kurve leer
// übergab und der Rückgang dort immer 0 war.
console.log('\nMaximaler Rückgang')
{
    const kurve = (werte, von = 0) => werte.map((e, i) => ({ t: von + i * STUNDE, equity: e }))

    const s = berechneStatistik([trade(1), trade(-1)], 1000, 1000, kurve([1200, 900, 1000]))
    // Hoch 1200 → Tief 900 = 25 %
    check('Rückgang wird vom Hoch aus gemessen, nicht vom Start',
        Math.abs(s.maxDrawdownPct - 25) < 1e-9, String(s.maxDrawdownPct))

    const steigend = berechneStatistik([trade(1)], 1000, 1300, kurve([1100, 1200, 1300]))
    check('eine nur steigende Kurve hat keinen Rückgang',
        steigend.maxDrawdownPct === 0, String(steigend.maxDrawdownPct))

    const leer = berechneStatistik([trade(1), trade(-1)], 1000, 1000, [])
    check('ohne Kurve ist der Rückgang 0 — das ist eine Aussage über die EINGABE',
        leer.maxDrawdownPct === 0, String(leer.maxDrawdownPct))

    // Der Rückgang darf nicht am letzten Punkt hängen: das Tief liegt in der Mitte.
    const mitte = berechneStatistik([trade(1)], 1000, 1150, kurve([1000, 1400, 700, 1150]))
    check('das tiefste Tal zählt, nicht der Endstand',
        Math.abs(mitte.maxDrawdownPct - 50) < 1e-9, String(mitte.maxDrawdownPct))
}

// ── Offene Positionen trennen ────────────────────────────────────────────
console.log('\nOffene und geschlossene Positionen')
{
    const abgeschlossen = [trade(1), trade(1), trade(-1)]
    const offen = { ...trade(20), exitReason: 'open_at_end' }
    const s = berechneStatistik([...abgeschlossen, offen], 1000, 1010, [])

    check('nur abgeschlossene Trades zählen', s.trades === 3, String(s.trades))
    check('die offene Position wird ausgewiesen, nicht verschwiegen', s.nochOffen === 1, String(s.nochOffen))
    check('ihr Gewinn taucht NICHT im Erwartungswert auf',
        Math.abs(s.expectancyR - (1 / 3)) < 1e-9, String(s.expectancyR))
    check('und nicht in der Trefferquote',
        Math.abs(s.winRate - (2 / 3) * 100) < 1e-9, String(s.winRate))
    check('und nicht im netPnl', Math.abs(s.netPnl - 10) < 1e-9, String(s.netPnl))
}

// ── Der Backtest blockiert den Prozess nicht ─────────────────────────────
//
// Audit-Befund top3-3: die Kerzenschleife lief ohne ein einziges `await` durch,
// und Node hat nur einen Thread. Solange sie rechnete, kam nichts anderes dran
// — im NAS-Container also weder der Engine-Takt noch der Not-Aus. Gemessen:
// 20 000 Kerzen ≈ 520 ms am Stück, ein Mehrfach-Test ein Vielfaches davon.
//
// Diese Prüfung ist ein Wächter: nimmt jemand die Atempausen wieder heraus,
// fällt sie um. Sie misst nicht die Geschwindigkeit (die schwankt je nach
// Maschine), sondern nur, DASS die Ereignisschleife zwischendurch drankommt.
console.log('\nEreignisschleife während des Backtests')
{
    const kerzen = Array.from({ length: 6000 }, (_, i) => {
        const b = 60000 + Math.sin(i / 13) * 900 + Math.sin(i / 97) * 2500
        return { t: Date.UTC(2026, 0, 1) + i * STUNDE, o: b, h: b * 1.004, l: b * 0.996,
                 c: b * 1.0005, v: 100, closeTime: Date.UTC(2026, 0, 1) + (i + 1) * STUNDE - 1 }
    })

    let takte = 0
    let laengstePause = 0
    let letzter = Date.now()
    const timer = setInterval(() => {
        const jetzt = Date.now()
        laengstePause = Math.max(laengstePause, jetzt - letzter)
        letzter = jetzt
        takte++
    }, 10)
    // Den Timer wirklich anlaufen lassen, sonst misst man den Start mit
    await new Promise((r) => setTimeout(r, 50))
    takte = 0
    laengstePause = 0
    letzter = Date.now()

    const t0 = Date.now()
    const r = await runBacktest({
        strategyId: 'lsob', symbol: 'BTCUSDT', timeframe: '1h',
        fromTs: kerzen[0].t, toTs: kerzen[kerzen.length - 1].t,
        candles: kerzen, startEquity: 1000,
    })
    const dauer = Date.now() - t0
    // Die Lücke bis zum ENDE zählt mit. Ohne sie stand hier im kaputten Zustand
    // (gar kein Takt kam dran) eine längste Pause von 0 — die Prüfung hätte
    // also ausgerechnet den Fall bestanden, den sie fangen soll.
    laengstePause = Math.max(laengstePause, Date.now() - letzter)
    clearInterval(timer)

    check('der Lauf dauert lang genug, dass die Prüfung etwas aussagt', dauer > 60,
        `${dauer} ms — sonst ist der Rechner zu schnell für diesen Test`)
    check('ein nebenherlaufender Takt kommt während des Backtests dran', takte > 1,
        `${takte} Takte in ${dauer} ms`)
    // Grosszügig: auf einer ausgelasteten Maschine darf es ruckeln. Vor dem Fix
    // lag die Pause bei der vollen Laufzeit, also weit jenseits davon.
    check('und wird dabei nie für die ganze Laufzeit ausgesperrt',
        laengstePause < Math.max(150, dauer * 0.7),
        `längste Pause ${laengstePause} ms bei ${dauer} ms Laufzeit`)
    check('das Ergebnis bleibt davon unberührt', r.stats.trades > 0, String(r.stats.trades))
}

// ── Sharpe ───────────────────────────────────────────────────────────────
console.log('\nSharpe')
{
    const TAG = 86400000
    const t0 = Date.UTC(2026, 0, 1)
    const tage = (werte) => werte.map((e, i) => ({ t: t0 + i * TAG, equity: e }))

    check('ohne Kurve nicht messbar', berechneSharpe([], 1000) === null)
    check('ein einzelner Punkt ist keine Streuung', berechneSharpe(tage([1010]), 1000) === null)

    // Jeden Tag exakt +1 % — Streuung null, also KEIN unendlicher Sharpe.
    const gleichmaessig = berechneSharpe(tage([1010, 1020.1, 1030.301]), 1000)
    check('eine Kurve ohne Schwankung ergibt keine Zahl statt „unendlich"',
        gleichmaessig === null, String(gleichmaessig))

    // Von Hand nachgerechnet: Renditen +10 %, −5 %, +10 %, −5 %
    const werte = [1100, 1045, 1149.5, 1092.025]
    const s = berechneSharpe(tage(werte), 1000)
    const r = [0.1, -0.05, 0.1, -0.05]
    const m = r.reduce((a, b) => a + b, 0) / r.length
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1))
    check('stimmt mit der Handrechnung überein',
        Math.abs(s - (m / sd) * Math.sqrt(365)) < 1e-9, String(s))
    check('und ist bei mehr Gewinn als Verlust positiv', s > 0, String(s))

    // Ruhige Tage ohne Abschluss zählen mit: dieselbe Kurve, aber die zwei
    // Gewinntage liegen weit auseinander. Der Sharpe MUSS dadurch sinken.
    const eng = berechneSharpe(tage([1100, 1045]), 1000)
    const weit = berechneSharpe([
        { t: t0, equity: 1100 },
        { t: t0 + 20 * TAG, equity: 1045 },
    ], 1000)
    check('Tage ohne Abschluss werden aufgefüllt, nicht übersprungen',
        weit !== null && Math.abs(weit) < Math.abs(eng),
        `eng=${eng} weit=${weit}`)

    check('eine fallende Kurve ergibt einen negativen Sharpe',
        berechneSharpe(tage([980, 1000, 950, 970]), 1000) < 0)

    // Und der Weg über berechneStatistik — dort darf das Feld nie fehlen
    const ohne = berechneStatistik([trade(1)], 1000, 1010, [])
    check('berechneStatistik setzt das Feld auch ohne Kurve', ohne.sharpe === null, String(ohne.sharpe))
    const leer = berechneStatistik([], 1000, 1000, [])
    check('… und auch ganz ohne Trades', leer.sharpe === null, String(leer.sharpe))
}

// ── Trendfilter der höheren Zeiteinheit ──────────────────────────────────
//
// Audit-Befund A2-5: fehlten die Kerzen der höheren Zeiteinheit, lief der
// Backtest ungefiltert weiter und sah dabei aus wie ein gefilterter Lauf. Der
// gefährlichste Fall ist nicht der Fehler, sondern der Vergleich danach.
console.log('\nTrendfilter der höheren Zeiteinheit')
{
    // Kerzen werden vorgeladen übergeben — der Test darf nicht ins Netz.
    const kerzen = (n, ms, von = Date.UTC(2026, 0, 1)) =>
        Array.from({ length: n }, (_, i) => {
            const b = 100 + Math.sin(i / 7) * 5
            return { t: von + i * ms, o: b, h: b + 1, l: b - 1, c: b + 0.2, v: 10,
                     closeTime: von + (i + 1) * ms - 1 }
        })

    const basis = {
        strategyId: 'lsob', symbol: 'BTCUSDT', timeframe: '1h',
        fromTs: Date.UTC(2026, 0, 1), toTs: Date.UTC(2026, 0, 1) + 500 * STUNDE,
        candles: kerzen(500, STUNDE), startEquity: 1000,
    }

    const aus = await runBacktest({ ...basis, params: { htfTrendFilter: false } })
    check('ohne Filter ist „verlangt" falsch',
        aus.stats.htfFilter?.verlangt === false && aus.stats.htfFilter.grund === 'aus',
        JSON.stringify(aus.stats.htfFilter))

    const ohneDaten = await runBacktest({
        ...basis,
        params: { htfTrendFilter: true, htfTimeframe: '4h', htfEmaPeriod: 50 },
        htfCandles: [],
    })
    check('eingeschaltet, aber ohne Kerzen → verlangt ja, aktiv nein',
        ohneDaten.stats.htfFilter.verlangt === true && ohneDaten.stats.htfFilter.aktiv === false,
        JSON.stringify(ohneDaten.stats.htfFilter))
    check('und der Grund steht dabei, statt nur „irgendwas war"',
        ohneDaten.stats.htfFilter.grund === 'keine_daten', ohneDaten.stats.htfFilter.grund)

    const zuWenig = await runBacktest({
        ...basis,
        params: { htfTrendFilter: true, htfTimeframe: '4h', htfEmaPeriod: 50 },
        htfCandles: kerzen(20, 4 * STUNDE),
    })
    check('eine Handvoll Kerzen reicht der EMA nicht — das gilt als inaktiv',
        zuWenig.stats.htfFilter.aktiv === false && zuWenig.stats.htfFilter.grund === 'zu_wenige_kerzen',
        JSON.stringify(zuWenig.stats.htfFilter))
    check('die vorhandene Kerzenzahl wird genannt', zuWenig.stats.htfFilter.kerzen === 20,
        String(zuWenig.stats.htfFilter.kerzen))

    const genug = await runBacktest({
        ...basis,
        params: { htfTrendFilter: true, htfTimeframe: '4h', htfEmaPeriod: 50 },
        htfCandles: kerzen(200, 4 * STUNDE),
    })
    check('mit genug Kerzen greift der Filter wirklich',
        genug.stats.htfFilter.aktiv === true && genug.stats.htfFilter.grund === 'aktiv',
        JSON.stringify(genug.stats.htfFilter))
}

// ── Datenabdeckung ───────────────────────────────────────────────────────
console.log('\nDatenabdeckung')
{
    const von = Date.UTC(2026, 0, 1)
    const bis = von + 100 * STUNDE

    const voll = pruefeAbdeckung(reihe(von, 100), von, bis, '1h')
    check('lückenlose Reihe gilt als vollständig', voll.vollstaendig === true,
        `${voll.prozent.toFixed(0)} % ${JSON.stringify(voll.fehlend)}`)

    // Der teure Fall: der Kerzen-Deckel schneidet HINTEN ab. Die Kennzahlen
    // beschreiben dann einen früheren Zeitraum, ohne dass es auffällt.
    const hinten = pruefeAbdeckung(reihe(von, 50), von, bis, '1h')
    check('fehlendes Ende wird erkannt',
        !hinten.vollstaendig && hinten.fehlend.includes('Ende'), JSON.stringify(hinten.fehlend))
    check('Abdeckung in Prozent stimmt', Math.round(hinten.prozent) === 50, String(hinten.prozent))

    // Spätes Listing eines Symbols: die Reihe beginnt erst mitten im Zeitraum.
    const vorne = pruefeAbdeckung(reihe(von + 50 * STUNDE, 50), von, bis, '1h')
    check('fehlender Anfang wird erkannt',
        !vorne.vollstaendig && vorne.fehlend.includes('Anfang'), JSON.stringify(vorne.fehlend))

    check('leere Reihe kippt nicht um', pruefeAbdeckung([], von, bis, '1h').vollstaendig === false)
    check('unbekannte Zeiteinheit kippt nicht um', pruefeAbdeckung(reihe(von, 10), von, bis, 'quatsch').vollstaendig === false)
}
{
    // `toTs` in der Zukunft darf nicht dazu führen, dass jeder Lauf als
    // unvollständig gilt — die laufende Kerze ist noch gar nicht geschlossen.
    const jetzt = Date.now()
    const von = jetzt - 100 * STUNDE
    const k = reihe(Math.floor(von / STUNDE) * STUNDE, 100)
    const a = pruefeAbdeckung(k, von, jetzt + 10 * STUNDE, '1h')
    check('Zukunft wird auf die letzte geschlossene Kerze geklemmt', a.vollstaendig === true,
        `${a.prozent.toFixed(0)} % ${JSON.stringify(a.fehlend)}`)
}

// ── Buy&Hold-Baseline ─────────────────────────────────────────────────────
console.log('\nBuy&Hold-Baseline')
{
    check('zu wenige Kerzen ergeben keine Baseline', berechneBuyHoldBaseline([{ o: 100, c: 100 }], 1000) === null)
    check('kein Open bei null ergibt keine Baseline',
        berechneBuyHoldBaseline([{ o: 0, c: 100 }, { o: 100, c: 110 }], 1000) === null)

    const b = berechneBuyHoldBaseline([{ o: 100, c: 101 }, { o: 101, c: 120 }], 1000)
    check('Rendite ist erster Open zu letztem Close, nicht Close zu Close',
        Math.abs(b.buyHoldReturnPct - 20) < 1e-9, String(b.buyHoldReturnPct))
    check('Endkapital folgt derselben Rendite',
        Math.abs(b.buyHoldEndEquity - 1200) < 1e-9, String(b.buyHoldEndEquity))

    const fallend = berechneBuyHoldBaseline([{ o: 100, c: 100 }, { o: 100, c: 90 }], 1000)
    check('ein fallender Kurs ergibt eine negative Baseline',
        fallend.buyHoldReturnPct < 0, String(fallend.buyHoldReturnPct))
}

// ── Floating-Drawdown ─────────────────────────────────────────────────────
//
// `maxDrawdownPct` misst nur an Trade-Abschlüssen — eine Position, die
// zwischenzeitlich tief im Minus steht, bevor sie sich am Stop gerade noch mit
// einem kleinen Verlust rettet, taucht dort NICHT auf. Genau das soll der
// Floating-Drawdown fangen.
console.log('\nFloating-Drawdown')
{
    const long = { direction: 'long', entryPrice: 100, qty: 1 }
    const zustand = { hoch: 1000, maxDd: 0 }

    // Kerze 1: Kurs fällt bis 70 (−30 vom Einstieg), schliesst aber bei 95.
    floatingEquitySchritt(zustand, 1000, [long], { l: 70, h: 100 })
    check('der Tiefstpunkt INNERHALB der Kerze zählt, nicht nur der Schluss',
        Math.abs(zustand.maxDd - 3.0) < 1e-9, String(zustand.maxDd))

    // Kerze 2: Position schliesst bei 98 mit kleinem Verlust — realisiert
    // wäre der Drawdown winzig, aber der Floating-Wert bleibt stehen.
    const zustandNachher = { hoch: zustand.hoch, maxDd: zustand.maxDd }
    floatingEquitySchritt(zustandNachher, 998, [], { l: 98, h: 98 })
    check('der Floating-Drawdown bleibt bestehen, auch wenn der Trade glimpflich endet',
        Math.abs(zustandNachher.maxDd - 3.0) < 1e-9, String(zustandNachher.maxDd))
    check('das ist grösser als der reale Verlust dieses Trades (0,2 %)',
        zustandNachher.maxDd > 0.2)

    // Ohne offene Position ist Floating-Equity identisch mit der Equity.
    const flach = { hoch: 1000, maxDd: 0 }
    const fe = floatingEquitySchritt(flach, 1000, [], { l: 900, h: 1100 })
    check('ohne offene Position bewegt sich nichts', fe === 1000 && flach.maxDd === 0, String(fe))

    // Short: der ungünstigste Preis ist das HOCH der Kerze, nicht das Tief.
    const short = { direction: 'short', entryPrice: 100, qty: 1 }
    const zustandShort = { hoch: 1000, maxDd: 0 }
    floatingEquitySchritt(zustandShort, 1000, [short], { l: 100, h: 130 })
    check('bei Short zieht das Hoch der Kerze den Drawdown, nicht das Tief',
        Math.abs(zustandShort.maxDd - 3.0) < 1e-9, String(zustandShort.maxDd))
}

// ── Floating-Drawdown aus gespeicherten Trades (Papier-/Live-Betrieb) ────
//
// `ladePerformance` hat keine Kerzen, nur abgeschlossene Trades mit ihrem MAE
// in R — diese Näherung rechnet das eingegangene Risiko aus netPnl/rMultiple
// zurück und nimmt an, der Tiefpunkt lag vor dem Ergebnis.
console.log('\nFloating-Drawdown aus Trades (Näherung)')
{
    check('ein Verlust-Trade mit MAE über dem Ergebnis zieht den Floating-Wert tiefer',
        Math.abs(schaetzeFloatingDrawdownAusTrades([{ netPnl: -10, rMultiple: -1, maeR: 3 }], 1000) - 3) < 1e-9)

    check('ein Break-Even-Trade (rMultiple 0) trägt mangels Risiko nichts bei',
        schaetzeFloatingDrawdownAusTrades([{ netPnl: 0, rMultiple: 0, maeR: 5 }], 1000) === 0)

    const gemischt = schaetzeFloatingDrawdownAusTrades([
        { netPnl: 200, rMultiple: 2, maeR: 0 },
        { netPnl: -10, rMultiple: -1, maeR: 5 },
    ], 1000)
    check('der Drawdown misst gegen den zuvor erreichten Höchststand, nicht gegen den Start',
        Math.abs(gemischt - (50 / 12)) < 1e-6, String(gemischt))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
