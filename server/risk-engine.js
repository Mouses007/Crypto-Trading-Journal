/**
 * Risiko-Gates.
 *
 * Diese Prüfungen sind CODE, keine Prompt-Anweisung an ein Sprachmodell. Ein
 * LLM kann sie damit weder überreden noch übersehen. Sie laufen vor JEDER
 * Ausführung — im Backtest, im Paper-Betrieb und live — und zwar identisch.
 *
 * Rein: alle Zustände (Kontostand, offene Positionen, Tages-PnL) kommen als
 * Argumente rein. Die Engine holt sie aus der DB, der Backtest aus seiner
 * Simulation. Nur so rechnen beide gleich.
 */

/** Warum eine Ausführung abgelehnt wurde — landet in `strategy_runs.reason`. */
export const RISK_REASONS = {
    KILL_SWITCH: 'kill_switch',
    DAILY_LOSS: 'daily_loss_limit',
    MAX_POSITIONS: 'max_concurrent_positions',
    COOLDOWN: 'symbol_cooldown',
    DUPLICATE: 'symbol_already_open',
    BELOW_MIN_RR: 'below_min_rr',
    SIZE_TOO_SMALL: 'size_too_small',
    NO_EQUITY: 'no_equity',
    BAD_LEVELS: 'invalid_levels',
    PRICE_DEVIATION: 'price_deviation',
    NOTIONAL_CAP: 'notional_cap',
}

/**
 * Positionsgrösse aus dem Risiko je Trade.
 *
 *   qty = (Kontostand × riskPerTradePct/100) / |Einstieg − Stop|
 *
 * Der Hebel bestimmt NICHT die Grösse, sondern nur, wie viel Marge sie bindet.
 * Das ist der Unterschied zwischen Risikosteuerung und Zockerei.
 *
 * @returns {{ qty, notionalUsdt, marginUsdt, riskUsd, capped, reason? }}
 */
export function computePositionSize({
    equity, riskPerTradePct, entry, stopLoss, leverage = 1,
    maxNotionalUsdt = Infinity, stepSize = 0, minQty = 0, minNotional = 0,
    feeBps = 0, slippageBps = 0,
}) {
    const abstand = Math.abs(entry - stopLoss)
    if (!(equity > 0)) return { qty: 0, reason: RISK_REASONS.NO_EQUITY }
    if (!(abstand > 0) || !(entry > 0)) return { qty: 0, reason: RISK_REASONS.BAD_LEVELS }

    const riskUsd = equity * (riskPerTradePct / 100)
    // Der Verlust am Stop ist nicht nur der Kursabstand: Ein- und Ausstieg
    // rutschen je einmal, und beide Seiten kosten Gebühr. Ohne diesen Anteil
    // liegt das echte Risiko über dem eingestellten Prozentsatz — bei engen
    // Stops um ein Vielfaches.
    const kostenJeEinheit = entry * (2 * (Number(feeBps) + Number(slippageBps))) / 10000
    let qty = riskUsd / (abstand + kostenJeEinheit)
    let capped = false

    // Notional-Deckel in USDT — wirkt unabhängig vom Prozent-Risiko und ist
    // der eigentliche Schutz gegen einen zu engen Stop.
    if (maxNotionalUsdt > 0 && qty * entry > maxNotionalUsdt) {
        qty = maxNotionalUsdt / entry
        capped = true
    }

    // Marge darf den Kontostand nicht übersteigen
    const maxQtyByMargin = (equity * (leverage || 1)) / entry
    if (qty > maxQtyByMargin) {
        qty = maxQtyByMargin
        capped = true
    }

    if (stepSize > 0) {
        const dec = Math.max(0, Math.round(-Math.log10(stepSize)))
        qty = Number((Math.floor(qty / stepSize) * stepSize).toFixed(dec))
    }

    const notionalUsdt = qty * entry
    if (qty <= 0 || (minQty > 0 && qty < minQty) || (minNotional > 0 && notionalUsdt < minNotional)) {
        return { qty: 0, notionalUsdt, marginUsdt: 0, riskUsd, capped, reason: RISK_REASONS.SIZE_TOO_SMALL }
    }

    return {
        qty,
        notionalUsdt,
        marginUsdt: notionalUsdt / (leverage || 1),
        riskUsd: abstand * qty,
        capped,
    }
}

/**
 * Alle Gates in einem Durchlauf.
 *
 * @param {object} ctx
 * @param {object} ctx.setup            getriggertes Setup (entry, stopLoss, takeProfit, rr, symbol)
 * @param {object} ctx.risk             validierte Risiko-Parameter der Instanz
 * @param {number} ctx.equity           aktueller Kontostand in USDT
 * @param {Array}  ctx.openPositions    offene Positionen der Instanz
 * @param {number} ctx.todayNetPnl      heute realisierter Netto-PnL (negativ = Verlust)
 * @param {object} ctx.lastExitBySymbol { symbol: exitTime } für den Cooldown
 * @param {number} ctx.now              Zeitstempel des Auslösers
 * @param {object} [ctx.marketMeta]     { stepSize, minQty, minNotional }
 * @param {number} [ctx.referencePrice] Preis der Handelsbörse (Abweichungs-Check)
 * @param {boolean}[ctx.killSwitch]
 *
 * @returns {{ ok: boolean, reason?: string, detail?: string, size?: object }}
 */
export function evaluateRisk(ctx) {
    const {
        setup, risk, equity, openPositions = [], todayNetPnl = 0,
        lastExitBySymbol = {}, now = 0, marketMeta = {}, referencePrice = 0,
        killSwitch = false,
    } = ctx

    if (killSwitch) return { ok: false, reason: RISK_REASONS.KILL_SWITCH }

    if (!(setup?.entry > 0) || !(setup?.stopLoss > 0)) {
        return { ok: false, reason: RISK_REASONS.BAD_LEVELS }
    }
    // Stop muss auf der richtigen Seite liegen — sonst ist die Rechnung Unsinn
    const seiteOk = setup.direction === 'long'
        ? setup.stopLoss < setup.entry
        : setup.stopLoss > setup.entry
    if (!seiteOk) return { ok: false, reason: RISK_REASONS.BAD_LEVELS }
    // Auch das Ziel muss auf der richtigen Seite liegen. Ein Long mit Ziel
    // UNTER dem Einstieg würde fast sofort als 'tp' schliessen — mit Verlust,
    // der in der Statistik als Treffer zählt.
    if (setup.takeProfit > 0) {
        const zielOk = setup.direction === 'long'
            ? setup.takeProfit > setup.entry
            : setup.takeProfit < setup.entry
        if (!zielOk) return { ok: false, reason: RISK_REASONS.BAD_LEVELS }
    }

    // Tagesverlust-Limit: gilt VOR jeder neuen Order, nicht erst danach
    const limit = equity * (risk.maxDailyLossPct / 100)
    if (limit > 0 && todayNetPnl <= -limit) {
        return {
            ok: false, reason: RISK_REASONS.DAILY_LOSS,
            detail: `heute ${todayNetPnl.toFixed(2)} USDT, Limit −${limit.toFixed(2)}`,
        }
    }

    if (openPositions.length >= risk.maxConcurrentPositions) {
        return { ok: false, reason: RISK_REASONS.MAX_POSITIONS, detail: `${openPositions.length} offen` }
    }

    // Nicht zweimal dasselbe Symbol — sonst wird aus 1 % Risiko unbemerkt 2 %.
    // Fährt die Instanz mehrere Zeiteinheiten, darf jede eine eigene Position
    // halten, WENN das ausdrücklich eingestellt ist (`symbol_tf`): sonst
    // verdrängt die schnellste Zeiteinheit dauerhaft die langsameren und der
    // Vergleich zwischen ihnen misst nur noch, wer zuerst da war.
    const jeZeiteinheit = risk.duplicateScope === 'symbol_tf'
    const belegt = openPositions.some((p) => p.symbol === setup.symbol
        && (!jeZeiteinheit || p.timeframe === setup.timeframe))
    if (belegt) {
        return {
            ok: false, reason: RISK_REASONS.DUPLICATE,
            detail: jeZeiteinheit ? `${setup.symbol} ${setup.timeframe}` : setup.symbol,
        }
    }

    if (risk.cooldownMinutes > 0) {
        // Die Sperrfrist folgt derselben Aufteilung: bei `symbol_tf` blockiert
        // ein 15m-Ausstieg nicht mehr den 1h-Einstieg.
        const letzter = (jeZeiteinheit
            ? lastExitBySymbol[`${setup.symbol}|${setup.timeframe}`]
            : lastExitBySymbol[setup.symbol]) || 0
        const wartet = (now - letzter) / 60000
        if (letzter && wartet < risk.cooldownMinutes) {
            return {
                ok: false, reason: RISK_REASONS.COOLDOWN,
                detail: `noch ${Math.ceil(risk.cooldownMinutes - wartet)} min`,
            }
        }
    }

    // Chancen/Risiko-Filter. Setups ohne festes Ziel (Swing-Runner, tp=0)
    // können kein RR haben und werden deshalb nicht daran gemessen.
    if (setup.takeProfit > 0 && risk.minRR > 0 && setup.rr > 0 && setup.rr < risk.minRR) {
        return {
            ok: false, reason: RISK_REASONS.BELOW_MIN_RR,
            detail: `${setup.rr.toFixed(2)} < ${risk.minRR}`,
        }
    }

    // Signalquelle und Handelsbörse dürfen nicht auseinanderlaufen
    if (referencePrice > 0 && risk.maxPriceDeviationPct > 0) {
        const abw = Math.abs(referencePrice - setup.entry) / setup.entry * 100
        if (abw > risk.maxPriceDeviationPct) {
            return {
                ok: false, reason: RISK_REASONS.PRICE_DEVIATION,
                detail: `${abw.toFixed(2)} % Abweichung`,
            }
        }
    }

    const size = computePositionSize({
        equity,
        riskPerTradePct: risk.riskPerTradePct,
        entry: setup.entry,
        stopLoss: setup.stopLoss,
        leverage: risk.leverage,
        maxNotionalUsdt: risk.maxNotionalUsdt,
        stepSize: marketMeta.stepSize || 0,
        minQty: marketMeta.minQty || 0,
        minNotional: marketMeta.minNotional || 0,
        feeBps: risk.feeBps,
        slippageBps: risk.slippageBps,
    })
    if (!size.qty) return { ok: false, reason: size.reason || RISK_REASONS.SIZE_TOO_SMALL }

    return { ok: true, size }
}

/** Beginn des Handelstages in der gewünschten Zeitzone (für das Tageslimit). */
export function startOfDayUtc(ts) {
    const d = new Date(ts)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
