/**
 * Selbsttest des Rechenkerns je Coin.
 *
 *   node server/__selftest-rangliste-lauf.mjs
 *
 * Geprüft wird vor allem die Ausschnitt-Rechnung — der Kunstgriff, auf dem der
 * ganze Lauf steht: EIN Abruf je Coin, und beide Hälften bekommen ihren eigenen
 * Vorlauf. Geht dabei etwas schief, merkt es niemand: die Zahlen sehen weiter
 * plausibel aus, messen aber einen anderen Zeitraum als bestellt.
 *
 * Kerzenabruf und Backtest werden eingespeist — kein Netz, keine Datenbank.
 */

import { bearbeiteCoin, schaetzeAufwand } from './rangliste-lauf.js'
import { getStrategy } from './strategies/index.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const STUNDE = 3600000
const WARMUP = getStrategy('lsob').warmupCandles      // 300
const VON = Date.UTC(2026, 0, 1)
const TAGE = 180
const BIS = VON + TAGE * 24 * STUNDE
const MITTE = Math.floor((VON + BIS) / 2)

const lauf = {
    strategyId: 'lsob', timeframe: '1h', market: 'futures',
    fromTs: VON, mitteTs: MITTE, toTs: BIS,
    params: {}, risk: {}, startEquity: 1000, maxLeverage: 10,
}

/** Lückenlose Kerzenreihe ab `ab`, `n` Stück. */
const reihe = (ab, n) => Array.from({ length: n }, (_, i) => {
    const b = 60000 + Math.sin(i / 11) * 500
    return { t: ab + i * STUNDE, o: b, h: b + 30, l: b - 30, c: b + 5, v: 10,
             closeTime: ab + (i + 1) * STUNDE - 1 }
})

/** Merkt sich, womit `runBacktest` gerufen wurde. */
function protokoll() {
    const rufe = []
    const backtest = async (opts) => {
        rufe.push(opts)
        // Ein Ergebnis, dessen Trade-Zahl von der Kerzenzahl abhängt — so lässt
        // sich prüfen, WELCHER Ausschnitt gemessen wurde.
        const n = opts.candles.length
        const trades = Array.from({ length: Math.floor(n / 40) }, (_, i) => ({
            rMultiple: (i % 3) - 0.5, exitReason: 'tp', netPnl: 10,
        }))
        return {
            trades,
            stats: {
                trades: trades.length, winRate: 55, expectancyR: 0.4,
                expectancyROhneTop: 0.3, profitFactor: 1.4,
                returnPct: 12, maxDrawdownPct: 8,
            },
        }
    }
    return { rufe, backtest }
}

console.log('\nRechenkern je Coin — Selbsttest\n')

// ── Der Kunstgriff ───────────────────────────────────────────────────────
console.log('Ein Abruf, zwei Hälften')
{
    let abrufe = 0
    let abrufArgs = null
    const alle = reihe(VON - (WARMUP + 20) * STUNDE, (WARMUP + 20) + TAGE * 24)
    const holeKerzen = async (...args) => { abrufe++; abrufArgs = args; return alle }
    const { rufe, backtest } = protokoll()

    const z = await bearbeiteCoin(lauf, 'BTCUSDT', { backtest, holeKerzen })

    check('genau EIN Abruf je Coin, nicht zwei', abrufe === 1, String(abrufe))
    check('der Abruf beginnt vor dem Zeitraum (Vorlauf)',
        abrufArgs[2] <= VON - WARMUP * STUNDE,
        `abgerufen ab ${new Date(abrufArgs[2]).toISOString()}, Zeitraum ab ${new Date(VON).toISOString()}`)
    check('zwei Backtests', rufe.length === 2, String(rufe.length))

    const [a, b] = rufe
    check('Hälfte A trägt genau den Vorlauf vor sich',
        a.candles[WARMUP].t === VON,
        `Kerze ${WARMUP} ist ${new Date(a.candles[WARMUP].t).toISOString()}, erwartet ${new Date(VON).toISOString()}`)
    check('Hälfte A endet an der Mitte',
        a.candles[a.candles.length - 1].t < MITTE && a.candles[a.candles.length - 1].t >= MITTE - STUNDE,
        new Date(a.candles[a.candles.length - 1].t).toISOString())
    check('Hälfte B trägt EBENFALLS den vollen Vorlauf',
        b.candles[WARMUP].t === MITTE,
        `Kerze ${WARMUP} ist ${new Date(b.candles[WARMUP].t).toISOString()}, erwartet ${new Date(MITTE).toISOString()}`)
    check('Hälfte B reicht bis ans Ende',
        b.candles[b.candles.length - 1].t >= BIS - 2 * STUNDE,
        new Date(b.candles[b.candles.length - 1].t).toISOString())

    // Der Vorlauf von B liegt IN der Messstrecke von A — das ist gewollt und
    // erzeugt keine doppelten Trades, weil runBacktest erst ab `warmup` misst.
    check('die Vorlaufkerzen von B stammen aus A', b.candles[0].t < MITTE)
    check('gemessen wird trotzdem ohne Überschneidung',
        a.candles[a.candles.length - 1].t < b.candles[WARMUP].t)

    check('die Zeitgrenzen passen zur jeweiligen Hälfte',
        a.fromTs === VON && a.toTs === MITTE && b.fromTs === MITTE && b.toTs === BIS)
    check('beide Hälften erben Parameter und Hebeldeckel',
        a.maxLeverage === 10 && b.maxLeverage === 10 && a.strategyId === 'lsob')

    check('die Zeile ist belastbar', z.klasse === 'belastbar', `${z.klasse} (aTrades=${z.aTrades})`)
    check('beide Hälften stehen in der Zeile', z.aTrades > 0 && z.bTrades > 0,
        `${z.aTrades} / ${z.bTrades}`)
    check('die R-Reihe für die Nullverteilung ist da', Array.isArray(z.rReiheA) && z.rReiheA.length > 0,
        String(z.rReiheA?.length))
}

// ── Die Abdeckung wird OHNE Vorlauf gerechnet ────────────────────────────
console.log('\nAbdeckung ohne Vorlauf')
{
    // Der Coin wurde erst nach 60 Tagen gelistet: vorne fehlen Daten.
    const spaeterStart = VON + 60 * 24 * STUNDE
    const alle = reihe(spaeterStart, (TAGE - 60) * 24)
    const { backtest } = protokoll()
    const z = await bearbeiteCoin(lauf, 'SPAETUSDT', { backtest, holeKerzen: async () => alle })

    check('ein spätes Listing wird als Datenlücke erkannt', z.klasse === 'datenluecke',
        `${z.klasse}, Abdeckung ${z.abdeckungPct?.toFixed(1)} %`)
    check('die Abdeckung liegt deutlich unter 100 % (Vorlauf zählt NICHT mit)',
        z.abdeckungPct < 80, `${z.abdeckungPct?.toFixed(1)} %`)
    check('am Anfang fehlt etwas', (z.fehlend || []).includes('Anfang'), JSON.stringify(z.fehlend))
    check('der Beginn der Historie steht in der Zeile',
        z.historieAb === spaeterStart, new Date(z.historieAb).toISOString())
    check('die Zahlen werden trotzdem gerechnet, nicht verworfen', z.aTrades > 0, String(z.aTrades))
}

// ── Einordnen statt filtern ──────────────────────────────────────────────
console.log('\nKlassen')
{
    const alle = reihe(VON - (WARMUP + 20) * STUNDE, (WARMUP + 20) + TAGE * 24)
    const holeKerzen = async () => alle

    const wenige = async (opts) => ({
        trades: [{ rMultiple: 2.1, exitReason: 'tp', netPnl: 10 }],
        stats: { trades: 4, expectancyR: 2.1, expectancyROhneTop: 0, winRate: 100 },
    })
    const z = await bearbeiteCoin(lauf, 'DUENNUSDT', { backtest: wenige, holeKerzen })
    check('vier Trades mit 2,1 R sind NICHT belastbar', z.klasse === 'zu_wenig_trades', z.klasse)
    check('… die Zahlen bleiben trotzdem sichtbar', z.aExpectancyR === 2.1, String(z.aExpectancyR))
    check('… und die Zeile verschwindet nicht', z.symbol === 'DUENNUSDT')

    const kurz = await bearbeiteCoin(lauf, 'KURZUSDT', {
        backtest: (await protokoll()).backtest, holeKerzen: async () => reihe(VON, 5),
    })
    check('eine Handvoll Kerzen ergibt „ohne Daten"', kurz.klasse === 'ohne_daten', kurz.klasse)

    const leer = await bearbeiteCoin(lauf, 'LEERUSDT', {
        backtest: (await protokoll()).backtest, holeKerzen: async () => [],
    })
    check('gar keine Kerzen ergeben ebenfalls „ohne Daten"', leer.klasse === 'ohne_daten', leer.klasse)
}

// ── Bestätigung ──────────────────────────────────────────────────────────
console.log('\nBestätigung durch die zweite Hälfte')
{
    const alle = reihe(VON - (WARMUP + 20) * STUNDE, (WARMUP + 20) + TAGE * 24)
    const holeKerzen = async () => alle
    const mit = (aT, bT, bOhneTop) => {
        let ruf = 0
        return async () => {
            const erste = ruf++ === 0
            const n = erste ? aT : bT
            return {
                trades: Array.from({ length: n }, () => ({ rMultiple: 0.5, exitReason: 'tp', netPnl: 1 })),
                stats: { trades: n, expectancyR: 0.5, expectancyROhneTop: erste ? 0.4 : bOhneTop, winRate: 50 },
            }
        }
    }

    const gut = await bearbeiteCoin(lauf, 'AUSDT', { backtest: mit(40, 40, 0.3), holeKerzen })
    check('positive Prüfhälfte mit genug Trades bestätigt', gut.bestaetigt === 1, String(gut.bestaetigt))

    const duenn = await bearbeiteCoin(lauf, 'BUSDT', { backtest: mit(40, 5, 3.0), holeKerzen })
    check('ein Traumergebnis aus 5 Trades bestätigt NICHT', duenn.bestaetigt === 0,
        `bestaetigt=${duenn.bestaetigt}, bTrades=${duenn.bTrades}`)

    const gekippt = await bearbeiteCoin(lauf, 'CUSDT', { backtest: mit(40, 40, -0.2), holeKerzen })
    check('eine negative Prüfhälfte bestätigt nicht', gekippt.bestaetigt === 0, String(gekippt.bestaetigt))
}

// ── Fehler reissen nicht den Lauf mit ────────────────────────────────────
console.log('\nFehler')
{
    const kaputt = await bearbeiteCoin(lauf, 'FEHLUSDT', {
        backtest: async () => { throw new Error('Backtest geplatzt') },
        holeKerzen: async () => reihe(VON - (WARMUP + 20) * STUNDE, (WARMUP + 20) + TAGE * 24),
    })
    check('ein geplatzter Backtest wird zur Fehlerzeile', kaputt.klasse === 'fehler', kaputt.klasse)
    check('… mit lesbarer Meldung', /geplatzt/.test(kaputt.fehler || ''), kaputt.fehler)

    const netz = await bearbeiteCoin(lauf, 'NETZUSDT', {
        backtest: (await protokoll()).backtest,
        holeKerzen: async () => { throw new Error('Invalid symbol') },
    })
    check('ein gescheiterter Abruf ebenso', netz.klasse === 'fehler' && /Invalid symbol/.test(netz.fehler))

    const falsch = await bearbeiteCoin({ ...lauf, timeframe: 'quatsch' }, 'XUSDT', {
        backtest: (await protokoll()).backtest, holeKerzen: async () => [],
    })
    check('eine unbekannte Zeiteinheit kippt nicht um', falsch.klasse === 'fehler', falsch.klasse)
}

// ── Aufwandsschätzung ────────────────────────────────────────────────────
console.log('\nAufwandsschätzung vor dem Start')
{
    const s1h = schaetzeAufwand({ strategyId: 'lsob', timeframe: '1h', fromTs: VON, toTs: BIS, anzahlCoins: 100 })
    check('1h/180 Tage/100 Coins: rund 400 Abrufe',
        s1h.abrufe >= 300 && s1h.abrufe <= 500, String(s1h.abrufe))
    check('… der Vorlauf ist eingerechnet', s1h.kerzenJeCoin > TAGE * 24, String(s1h.kerzenJeCoin))

    const s15m = schaetzeAufwand({ strategyId: 'lsob', timeframe: '15m', fromTs: VON, toTs: BIS, anzahlCoins: 100 })
    check('15m kostet ein Vielfaches von 1h', s15m.abrufe > s1h.abrufe * 2,
        `${s15m.abrufe} gegen ${s1h.abrufe}`)
    check('das Gewicht ist zehnmal die Abrufzahl', s15m.gewicht === s15m.abrufe * 10)
    check('eine Zeitschätzung kommt heraus', s15m.sekunden > 0, String(s15m.sekunden))
    check('eine unbekannte Strategie kippt nicht um',
        schaetzeAufwand({ strategyId: 'gibtesnicht', timeframe: '1h', fromTs: VON, toTs: BIS, anzahlCoins: 10 }).abrufe === 0)
}

console.log(`\n${fehlgeschlagen === 0 ? '\x1b[32m' : '\x1b[31m'}${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\x1b[0m`)
if (fehlgeschlagen) { console.log('Fehlgeschlagen:'); for (const f of fehler) console.log(`  · ${f}`) }
process.exit(fehlgeschlagen ? 1 : 0)
