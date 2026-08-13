/**
 * Backtest.
 *
 * Läuft Kerze für Kerze durch die Historie und sieht dabei immer nur das, was
 * zu diesem Zeitpunkt schon geschlossen war — kein Blick nach vorn. Benutzt
 * exakt dieselben Bausteine wie der Live-Betrieb: denselben Detector, dieselbe
 * Risk-Engine, denselben Fill-Simulator. Ein Backtest, der eigene Regeln
 * anwendet, misst nur sich selbst.
 *
 * Der Backtest ist kein Beiwerk: ohne ihn sind Werte wie »Retest-Tiefe 25 %«
 * geraten. Er ist ausserdem das Werkzeug, mit dem der Optimizer-Agent seine
 * Vorschläge belegen muss, statt zu behaupten.
 */

import { getStrategy, validateParams, validateRisk } from './strategies/index.js'
import { getHistoricalCandles, timeframeMs } from './market-data.js'
import { evaluateRisk, startOfDayUtc } from './risk-engine.js'
import { createPosition, stepCandle, closePosition, entryIsValid } from './fill-simulator.js'

/** Obergrenze, damit ein versehentlicher 5-Jahres-Lauf den Server nicht blockiert. */
export const MAX_BACKTEST_CANDLES = 20000

function leeresErgebnis(grund) {
    return {
        stats: { trades: 0, hinweis: grund },
        trades: [], equityCurve: [], funnel: emptyFunnel(),
    }
}

function emptyFunnel() {
    return {
        sweepsFound: 0,
        setupsDetected: 0,
        triggered: 0,
        executed: 0,
        invalidated: {},     // warum ein Setup vor dem Einstieg starb
        riskRejected: {},    // warum die Risk-Engine den Einstieg verweigerte
        entrySkipped: {},    // warum der Fill nicht zustande kam
    }
}

const bump = (obj, key) => { obj[key] = (obj[key] || 0) + 1 }

/**
 * @param {object} opts
 * @param {string} opts.strategyId
 * @param {object} opts.params      Roh-Parameter (werden validiert)
 * @param {object} opts.risk        Roh-Risikoparameter (werden validiert)
 * @param {string} opts.symbol
 * @param {string} opts.timeframe
 * @param {number} opts.fromTs / opts.toTs
 * @param {number} [opts.startEquity=1000]
 * @param {Array}  [opts.candles]   vorgeladene Kerzen (spart den Abruf)
 */
export async function runBacktest(opts) {
    const strategie = getStrategy(opts.strategyId)
    if (!strategie) return leeresErgebnis(`Unbekannte Strategie: ${opts.strategyId}`)

    const { values: params } = validateParams(opts.strategyId, opts.params)
    const { values: risk } = validateRisk(opts.risk)

    const symbol = String(opts.symbol || '').toUpperCase()
    const timeframe = opts.timeframe
    const market = opts.market === 'spot' ? 'spot' : 'futures'
    const startEquity = Number(opts.startEquity) > 0 ? Number(opts.startEquity) : 1000

    const candles = opts.candles || await getHistoricalCandles(
        symbol, timeframe, opts.fromTs, opts.toTs,
        { market, maxCandles: MAX_BACKTEST_CANDLES },
    )

    const warmup = strategie.warmupCandles || 200
    if (candles.length <= warmup + 10) {
        return leeresErgebnis(`Zu wenige Kerzen (${candles.length}, mindestens ${warmup + 11} nötig)`)
    }

    // Gleitendes Fenster statt der kompletten Historie: der Detector schaut
    // ohnehin nur `scanWindowCandles` zurück, und ein volles Slice je Kerze
    // wäre bei Jahresläufen quadratisch.
    const fenster = warmup + (params.scanWindowCandles || 200) + (params.retestMaxCandles || 40) + 10

    const costs = { feeBps: risk.feeBps, slippageBps: risk.slippageBps }
    // Zeitausstieg in Millisekunden — der Detector zählt in Kerzen
    const maxHoldMs = (params.maxHoldCandles || 0) * timeframeMs(timeframe)
    const schrittOpts = { breakEvenAtR: params.breakEvenAtR, maxHoldMs }
    const funnel = emptyFunnel()

    let equity = startEquity
    let nextSetupId = 1
    let offeneSetups = []
    const bekannteSchluessel = new Set()
    const gezaehlteAblehnungen = new Set()
    const setupsGesamt = []
    let offenePositionen = []
    const trades = []
    const equityCurve = []
    const lastExitBySymbol = {}

    const abschliessen = (pos, exit) => {
        const trade = closePosition(pos, exit, costs, { symbol, timeframe })
        trades.push(trade)
        equity += trade.netPnl
        lastExitBySymbol[symbol] = exit.time
        equityCurve.push({ t: exit.time, equity })
    }

    for (let i = warmup; i < candles.length; i++) {
        const kerze = candles[i]

        // 1. Offene Positionen mit dieser Kerze fortschreiben.
        //    Bewusst VOR der Erkennung: eine Position, die in dieser Kerze
        //    eröffnet wird, darf frühestens in der nächsten bewertet werden.
        if (offenePositionen.length) {
            const bleiben = []
            for (const pos of offenePositionen) {
                const { exit } = stepCandle(pos, kerze, schrittOpts)
                if (exit) abschliessen(pos, exit)
                else bleiben.push(pos)
            }
            offenePositionen = bleiben
        }

        // 2. Erkennung auf allem, was bis einschliesslich dieser Kerze geschlossen ist
        const von = Math.max(0, i + 1 - fenster)
        const sicht = candles.slice(von, i + 1)
        const { setups, events, diagnostics } = strategie.detect({
            candles: sicht,
            params,
            openSetups: offeneSetups,
            knownSetupKeys: [...bekannteSchluessel],
        })

        // Ablehnungen nur EINMAL zählen: der Detector sieht denselben Sweep in
        // jedem Takt erneut, deshalb wird über den Schlüssel entduplifiziert.
        for (const { reason, key } of diagnostics.rejections || []) {
            if (gezaehlteAblehnungen.has(key)) continue
            gezaehlteAblehnungen.add(key)
            funnel.sweepsFound++
            bump(funnel.invalidated, reason)
        }

        for (const s of setups) {
            const setup = { ...s, id: nextSetupId++, symbol, timeframe, strategyId: opts.strategyId }
            offeneSetups.push(setup)
            setupsGesamt.push(setup)
            bekannteSchluessel.add(`${s.direction}|${s.obCandleTime}`)
            funnel.setupsDetected++
        }

        // 3. Ereignisse auswerten
        for (const ev of events) {
            const setup = offeneSetups.find((s) => s.id === ev.id)
            if (!setup) continue
            offeneSetups = offeneSetups.filter((s) => s.id !== ev.id)

            setup.status = ev.status
            if (ev.invalidReason) setup.invalidReason = ev.invalidReason

            if (ev.status !== 'triggered') {
                bump(funnel.invalidated, ev.invalidReason || ev.status)
                continue
            }

            funnel.triggered++
            setup.confirmations = ev.confirmations || {}
            setup.triggeredAt = ev.triggeredAt

            // Dieselbe Übernahme wie in der Engine: Strategien mit wandernden
            // Kursmarken (z. B. Einstieg an einer EMA) liefern Einstieg, Stop
            // und Ziel erst mit dem Auslöser.
            if (Number.isFinite(ev.entry) && ev.entry > 0) setup.entry = ev.entry
            if (Number.isFinite(ev.stopLoss) && ev.stopLoss > 0) setup.stopLoss = ev.stopLoss
            if (Number.isFinite(ev.takeProfit)) setup.takeProfit = ev.takeProfit
            const risiko = Math.abs(setup.entry - setup.stopLoss)
            setup.rr = setup.takeProfit > 0 && risiko > 0
                ? Math.abs(setup.takeProfit - setup.entry) / risiko
                : 0

            // Der Retest muss nicht in der aktuellen Kerze liegen: ein frisch
            // erkanntes Setup wird ab seinem Impuls geprüft, und der Rücklauf
            // kann schon ein paar Kerzen zurückliegen. Fill und Einstiegszeit
            // gehören deshalb an die Kerze des Ereignisses, nicht an die
            // Schleifenkerze — sonst schlägt der Fill grundlos fehl.
            const triggerVersatz = sicht.findIndex((c) => c.t === ev.candleTime)
            const triggerIdx = triggerVersatz >= 0 ? von + triggerVersatz : i
            const triggerKerze = candles[triggerIdx]

            // 3a. Fill überhaupt möglich?
            const fill = entryIsValid(setup, triggerKerze)
            if (!fill.ok) { bump(funnel.entrySkipped, fill.reason); continue }

            // 3b. Risiko-Gates — dieselben wie im Live-Betrieb
            const heuteBeginn = startOfDayUtc(triggerKerze.t)
            const heutePnl = trades
                .filter((t) => t.exitTime >= heuteBeginn)
                .reduce((sum, t) => sum + t.netPnl, 0)

            const pruefung = evaluateRisk({
                setup, risk, equity,
                openPositions: offenePositionen,
                todayNetPnl: heutePnl,
                lastExitBySymbol,
                now: triggerKerze.t,
            })
            if (!pruefung.ok) {
                bump(funnel.riskRejected, pruefung.reason)
                setup.rejectReason = pruefung.reason
                continue
            }

            const position = createPosition({
                setup,
                qty: pruefung.size.qty,
                entryPrice: setup.entry,
                entryTime: triggerKerze.t,
                leverage: risk.leverage,
                costs,
            })
            funnel.executed++

            // Liegt der Einstieg vor der aktuellen Kerze, müssen die Kerzen
            // dazwischen SOFORT nachgeholt werden. Ohne das würde die Position
            // genau die Bars überspringen, in denen sie hätte ausgestoppt
            // werden können — ein Lookahead, der die Statistik schönrechnet.
            // Liegt der Einstieg auf der ERÖFFNUNG der Trigger-Kerze, muss
            // diese Kerze selbst mitgeprüft werden — ihr Hoch und Tief können
            // Stop oder Ziel bereits berühren. Bei einem Einstieg mitten in
            // der Kerze (z. B. Limit an einer Zone) beginnt der Nachlauf
            // dagegen erst mit der Folgekerze.
            let ueberlebt = true
            const abKerze = ev.entryAtOpen ? triggerIdx : triggerIdx + 1
            for (let j = abKerze; j <= i && ueberlebt; j++) {
                const { exit } = stepCandle(position, candles[j], schrittOpts)
                if (exit) { abschliessen(position, exit); ueberlebt = false }
            }
            if (ueberlebt) offenePositionen.push(position)
        }
    }

    // Am Ende noch offene Positionen werden zum letzten Kurs bewertet, aber als
    // `open_at_end` gekennzeichnet: sie sind KEINE abgeschlossenen Trades und
    // gehen deshalb nicht in Trefferquote und Erwartungswert ein. Ohne diese
    // Trennung schlug ein einzelner, 200 Tage laufender Trade als +85R in der
    // Statistik durch.
    const letzte = candles[candles.length - 1]
    for (const pos of offenePositionen) {
        abschliessen(pos, { price: letzte.c, reason: 'open_at_end', time: letzte.t })
    }

    return {
        stats: berechneStatistik(trades, startEquity, equity, equityCurve),
        trades,
        equityCurve,
        funnel,
        meta: {
            strategyId: opts.strategyId,
            symbol, timeframe, market,
            candles: candles.length,
            von: candles[0].t,
            bis: letzte.t,
            params, risk,
        },
    }
}

/**
 * Kennzahlen. `expectancyR` ist die wichtigste Zahl: der erwartete Gewinn je
 * Trade in R. Alles darunter oder gleich 0 heisst, dass die Strategie in dieser
 * Konfiguration nichts verdient — egal wie gut die Trefferquote aussieht.
 */
export function berechneStatistik(alleTrades, startEquity, endEquity, equityCurve) {
    // Am Testende zwangsweise bewertete Positionen sind keine abgeschlossenen
    // Trades — sie würden Trefferquote und Erwartungswert verzerren.
    const trades = alleTrades.filter((t) => t.exitReason !== 'open_at_end')
    const nochOffen = alleTrades.length - trades.length
    const n = trades.length
    if (!n) {
        return {
            trades: 0, winRate: 0, netPnl: 0, expectancyR: 0, profitFactor: null,
            maxDrawdownPct: 0, startEquity, endEquity, nochOffen,
        }
    }

    const gewinner = trades.filter((t) => t.netPnl > 0)
    const verlierer = trades.filter((t) => t.netPnl <= 0)
    const summe = (arr, f) => arr.reduce((s, t) => s + f(t), 0)

    const bruttoGewinn = summe(gewinner, (t) => t.netPnl)
    const bruttoVerlust = Math.abs(summe(verlierer, (t) => t.netPnl))

    // Maximaler Rückgang der Kapitalkurve, in Prozent vom jeweiligen Hoch
    let hoch = startEquity
    let maxDd = 0
    for (const punkt of equityCurve) {
        if (punkt.equity > hoch) hoch = punkt.equity
        const dd = hoch > 0 ? ((hoch - punkt.equity) / hoch) * 100 : 0
        if (dd > maxDd) maxDd = dd
    }

    const exitGruende = {}
    for (const t of trades) bump(exitGruende, t.exitReason)

    // Wie weit lief der Kurs zu unseren Gunsten, bevor der Trade endete?
    // Aus dieser Verteilung folgt direkt, ob das Take-Profit-Ziel passt.
    const mfeStufen = { '1R': 0, '2R': 0, '3R': 0, '5R': 0 }
    for (const t of trades) {
        if (t.mfeR >= 1) mfeStufen['1R']++
        if (t.mfeR >= 2) mfeStufen['2R']++
        if (t.mfeR >= 3) mfeStufen['3R']++
        if (t.mfeR >= 5) mfeStufen['5R']++
    }

    return {
        trades: n,
        wins: gewinner.length,
        losses: verlierer.length,
        winRate: (gewinner.length / n) * 100,
        netPnl: summe(trades, (t) => t.netPnl),
        grossPnl: summe(trades, (t) => t.grossPnl),
        fees: summe(trades, (t) => t.fees),
        avgR: summe(trades, (t) => t.rMultiple) / n,
        expectancyR: summe(trades, (t) => t.rMultiple) / n,
        // Ohne Verlust-Trades ist der Profit-Faktor nicht definiert. Bewusst
        // `null` statt Infinity: JSON macht aus Infinity ein `null`, und das
        // wurde in der Anzeige zu "0.00" — also genau das Gegenteil der Wahrheit.
        profitFactor: bruttoVerlust > 0 ? bruttoGewinn / bruttoVerlust : null,
        avgWinR: gewinner.length ? summe(gewinner, (t) => t.rMultiple) / gewinner.length : 0,
        avgLossR: verlierer.length ? summe(verlierer, (t) => t.rMultiple) / verlierer.length : 0,
        maxDrawdownPct: maxDd,
        avgHoldingMinutes: summe(trades, (t) => t.holdingMinutes) / n,
        avgMaeR: summe(trades, (t) => t.maeR) / n,
        avgMfeR: summe(trades, (t) => t.mfeR) / n,
        mfeReached: mfeStufen,
        exitReasons: exitGruende,
        nochOffen,
        startEquity,
        endEquity,
        returnPct: startEquity > 0 ? ((endEquity - startEquity) / startEquity) * 100 : 0,
    }
}

/** Grobe Abschätzung, wie viele Kerzen ein Zeitraum umfasst (für Limits in der UI). */
export function schaetzeKerzen(fromTs, toTs, timeframe) {
    const ms = timeframeMs(timeframe)
    return ms > 0 ? Math.ceil((toTs - fromTs) / ms) : 0
}
