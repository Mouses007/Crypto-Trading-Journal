/**
 * Ausführungs-Simulation auf Kerzenbasis.
 *
 * Wird von ZWEI Stellen benutzt: vom Backtest und vom Paper-Trading. Genau
 * deshalb steht sie hier und nicht in einem der beiden — ein Backtest, der
 * anders rechnet als der Paper-Betrieb, ist wertlos.
 *
 * Grundhaltung: im Zweifel pessimistisch.
 *   - Liegen Stop und Ziel in derselben Kerze, zählt der STOP. Innerhalb einer
 *     Kerze ist die Reihenfolge unbekannt; die optimistische Annahme würde
 *     Ergebnisse systematisch schönrechnen.
 *   - Ein- und Ausstieg bekommen Slippage in die jeweils ungünstige Richtung.
 *   - Break-Even wird erst am Kerzenschluss nachgezogen, nie rückwirkend.
 *
 * Alle Funktionen sind rein: Kerze rein, Ergebnis raus, kein Zustand aussen.
 */

const BPS = 10000

/** Ein- bzw. Ausstiegspreis nach Slippage — immer zu unseren Ungunsten. */
export function applySlippage(price, direction, side, slippageBps) {
    const f = slippageBps / BPS
    // Kaufen (Long-Einstieg, Short-Ausstieg) wird teurer, Verkaufen billiger.
    const kauft = (direction === 'long' && side === 'entry') || (direction === 'short' && side === 'exit')
    return kauft ? price * (1 + f) : price * (1 - f)
}

export function feeFor(price, qty, feeBps) {
    return Math.abs(price * qty) * (feeBps / BPS)
}

/**
 * Legt eine simulierte Position an.
 * `costs` = { feeBps, slippageBps }
 */
export function createPosition({ setup, qty, entryPrice, entryTime, leverage = 1, costs }) {
    const fill = applySlippage(entryPrice, setup.direction, 'entry', costs.slippageBps)
    return {
        setupId: setup.id ?? 0,
        symbol: setup.symbol || '',
        timeframe: setup.timeframe || '',
        direction: setup.direction,
        qty,
        initialQty: qty,          // Bezugsgrösse für R, überlebt Teilausstiege
        entryPrice: fill,
        entryTime,
        stopLoss: setup.stopLoss,
        initialStopLoss: setup.stopLoss,
        takeProfit: setup.takeProfit || 0,
        leverage,
        notionalUsdt: fill * qty,
        marginUsdt: (fill * qty) / (leverage || 1),
        feeOpen: feeFor(fill, qty, costs.feeBps),
        maePrice: fill,
        mfePrice: fill,
        breakEvenDone: false,
        status: 'open',
    }
}

/** Risiko in Preis-Einheiten (Basis für R). */
export function riskPerUnit(pos) {
    return Math.abs(pos.entryPrice - pos.initialStopLoss)
}

/**
 * Teilausstieg buchen: einen Anteil der Position zum erreichten Ziel schliessen,
 * den Rest weiterlaufen lassen.
 *
 * Das Ergebnis wird auf der Position gespeichert statt sofort als Trade
 * geschrieben — ein Setup soll EINE Zeile in `strategy_trades` ergeben, sonst
 * zählt die Auswertung jeden Trade doppelt und die Trefferquote wird Unsinn.
 * `initialQty` bleibt die Bezugsgrösse für R, damit ein Teilausstieg das
 * eingegangene Risiko nicht nachträglich kleinrechnet.
 */
function bucheTeilausstieg(pos, price, anteilPct, costs, time) {
    const anteil = Math.min(Math.max(anteilPct, 0), 100) / 100
    const menge = pos.qty * anteil
    if (menge <= 0) return

    const fill = applySlippage(price, pos.direction, 'exit', costs?.slippageBps || 0)
    const gebuehr = feeFor(fill, menge, costs?.feeBps || 0)
    const brutto = pos.direction === 'long'
        ? (fill - pos.entryPrice) * menge
        : (pos.entryPrice - fill) * menge

    pos.partialQty = menge
    pos.partialPrice = fill
    pos.partialTime = time
    pos.partialGross = brutto
    pos.partialFee = gebuehr
    pos.partialDone = true
    pos.qty = pos.qty - menge
}

/**
 * Verarbeitet eine Kerze für eine offene Position.
 *
 * @returns {{ exit: null | { price, reason, time } }}
 *   Die Position wird dabei in place fortgeschrieben (SL-Nachzug, MAE/MFE).
 */
export function stepCandle(pos, candle, opts = {}) {
    const long = pos.direction === 'long'
    const breakEvenAtR = Number(opts.breakEvenAtR) || 0

    // MAE/MFE mitschreiben, bevor irgendetwas schliesst
    if (long) {
        if (candle.l < pos.maePrice) pos.maePrice = candle.l
        if (candle.h > pos.mfePrice) pos.mfePrice = candle.h
    } else {
        if (candle.h > pos.maePrice) pos.maePrice = candle.h
        if (candle.l < pos.mfePrice) pos.mfePrice = candle.l
    }

    // Stop zuerst — die pessimistische Annahme.
    const stopHit = long ? candle.l <= pos.stopLoss : candle.h >= pos.stopLoss
    if (stopHit) {
        // Eröffnet die Kerze bereits jenseits des Stops, gibt es keinen Fill
        // zum Stop-Preis, sondern zur Eröffnung (Gap).
        const gap = long ? candle.o < pos.stopLoss : candle.o > pos.stopLoss
        const price = gap ? candle.o : pos.stopLoss
        return { exit: { price, reason: pos.breakEvenDone ? 'be' : 'sl', time: candle.t } }
    }

    // Teilausstieg VOR dem vollen Ziel prüfen: er liegt näher am Einstieg, wird
    // also zwangsläufig zuerst erreicht. Erwischt eine Kerze beide Marken, wird
    // erst der Teil gebucht und der Rest anschliessend am Ziel geschlossen.
    const teilR = Number(opts.partialTpR) || 0
    const teilPct = Number(opts.partialTpPct) || 0
    if (teilR > 0 && teilPct > 0 && !pos.partialDone) {
        const r = riskPerUnit(pos)
        if (r > 0) {
            const ziel = long ? pos.entryPrice + r * teilR : pos.entryPrice - r * teilR
            const erreicht = long ? candle.h >= ziel : candle.l <= ziel
            if (erreicht) {
                const gap = long ? candle.o > ziel : candle.o < ziel
                bucheTeilausstieg(pos, gap ? candle.o : ziel, teilPct, opts.costs || {}, candle.t)
            }
        }
    }

    if (pos.takeProfit > 0) {
        const tpHit = long ? candle.h >= pos.takeProfit : candle.l <= pos.takeProfit
        if (tpHit) {
            const gap = long ? candle.o > pos.takeProfit : candle.o < pos.takeProfit
            return { exit: { price: gap ? candle.o : pos.takeProfit, reason: 'tp', time: candle.t } }
        }
    }

    // Zeitausstieg: eine Position ohne festes Ziel darf nicht ewig laufen.
    // Wird zuletzt geprüft, damit Stop und Ziel Vorrang behalten.
    const maxHoldMs = Number(opts.maxHoldMs) || 0
    if (maxHoldMs > 0 && candle.t - pos.entryTime >= maxHoldMs) {
        return { exit: { price: candle.c, reason: 'timeout', time: candle.t } }
    }

    // Break-Even erst nach der Ausstiegsprüfung und nur auf Schlusskursbasis
    if (breakEvenAtR > 0 && !pos.breakEvenDone) {
        const r = riskPerUnit(pos)
        if (r > 0) {
            const erreicht = long
                ? candle.c >= pos.entryPrice + r * breakEvenAtR
                : candle.c <= pos.entryPrice - r * breakEvenAtR
            if (erreicht) {
                pos.stopLoss = pos.entryPrice
                pos.breakEvenDone = true
            }
        }
    }

    return { exit: null }
}

/**
 * Schliesst eine Position und erzeugt den Trade-Datensatz
 * (Feldnamen wie in der Tabelle `strategy_trades`).
 */
export function closePosition(pos, { price, reason, time }, costs, extra = {}) {
    const fill = applySlippage(price, pos.direction, 'exit', costs.slippageBps)
    const feeClose = feeFor(fill, pos.qty, costs.feeBps)
    // Die Eröffnungsgebühr wurde auf die volle Menge gezahlt und bleibt deshalb
    // ungeteilt; dazu kommen die Gebühren beider Ausstiege.
    const fees = pos.feeOpen + feeClose + (Number(pos.partialFee) || 0)

    const grossPnl = (pos.direction === 'long'
        ? (fill - pos.entryPrice) * pos.qty
        : (pos.entryPrice - fill) * pos.qty)
        + (Number(pos.partialGross) || 0)
    const funding = Number(extra.funding) || 0
    const netPnl = grossPnl - fees + funding

    const r = riskPerUnit(pos)
    // Bezug ist die Menge BEIM EINSTIEG. Nach einem Teilausstieg ist `qty` nur
    // noch der Rest — damit gerechnet käme ein zu grosses R heraus, weil das
    // Ergebnis beider Teile durch das Risiko eines Teils geteilt würde.
    const mengeAmEinstieg = Number(pos.initialQty) || (pos.qty + (Number(pos.partialQty) || 0))
    const riskUsd = r * mengeAmEinstieg
    const rMultiple = riskUsd > 0 ? netPnl / riskUsd : 0

    // MAE/MFE in R — genau die Zahlen, aus denen die Auswertung später
    // Vorschläge wie »TP bei 2R statt letztem Hoch« ableitet.
    const maeR = r > 0 ? Math.abs(pos.maePrice - pos.entryPrice) / r : 0
    const mfeR = r > 0 ? Math.abs(pos.mfePrice - pos.entryPrice) / r : 0

    return {
        setupId: pos.setupId,
        symbol: pos.symbol,
        timeframe: pos.timeframe,
        direction: pos.direction,
        qty: mengeAmEinstieg,     // die gehandelte Menge, nicht der Rest nach dem Teilausstieg
        notionalUsdt: pos.notionalUsdt,
        leverage: pos.leverage,
        entryPrice: pos.entryPrice,
        entryTime: pos.entryTime,
        exitPrice: fill,
        exitTime: time,
        stopLoss: pos.initialStopLoss,
        takeProfit: pos.takeProfit,
        grossPnl,
        fees,
        funding,
        netPnl,
        rMultiple,
        exitReason: reason,
        maeR,
        mfeR,
        holdingMinutes: (time - pos.entryTime) / 60000,
        ...extra,
    }
}

/**
 * Prüft, ob die Trigger-Kerze den Einstieg überhaupt hergibt.
 * Ein Setup, dessen Stop in derselben Kerze schon gerissen wird, darf nicht
 * als sauberer Einstieg durchgehen — sonst entstehen Phantom-Gewinne.
 */
export function entryIsValid(setup, candle) {
    const long = setup.direction === 'long'
    // Der Einstieg liegt an der Zonenkante; die Kerze muss sie berührt haben.
    const beruehrt = long ? candle.l <= setup.entry : candle.h >= setup.entry
    if (!beruehrt) return { ok: false, reason: 'entry_not_touched' }
    const stopSofort = long ? candle.l <= setup.stopLoss : candle.h >= setup.stopLoss
    if (stopSofort) return { ok: false, reason: 'stop_in_entry_candle' }
    return { ok: true }
}
