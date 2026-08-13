/**
 * Paper-Ausführung.
 *
 * Simuliert Orders gegen geschlossene Kerzen — mit denselben Bausteinen wie der
 * Backtest (`fill-simulator.js`), damit beide bitgleich rechnen. Der Unterschied
 * zum Backtest ist nur, dass der Zustand in der DB liegt statt im Speicher.
 *
 * Der `shadow`-Modus benutzt denselben Code: der komplette Live-Pfad läuft
 * durch, die Order wird protokolliert statt gesendet. Das ist der letzte Test
 * vor dem Scharfschalten.
 */

import { getKnex } from '../database.js'
import { createPosition, stepCandle, closePosition } from '../fill-simulator.js'

/**
 * Kontostand einer Instanz im Papierbetrieb:
 * Startkapital plus alles, was sie seither verdient oder verloren hat.
 */
export async function getPaperEquity(instance) {
    const knex = getKnex()
    const row = await knex('strategy_trades')
        .where({ instanceId: instance.id })
        .whereIn('mode', ['paper', 'shadow'])
        .sum({ pnl: 'netPnl' })
        .first()
    const start = Number(instance.risk?.startEquityUsdt) || 1000
    return start + (Number(row?.pnl) || 0)
}

/**
 * Öffnet eine simulierte Position und schreibt sie in `strategy_positions`.
 *
 * `clientOrderId` ist eindeutig indiziert — ein zweiter Aufruf mit demselben
 * Setup läuft in den Unique-Konflikt und öffnet keine zweite Position. Das ist
 * dieselbe Idempotenz-Zusage wie später im Live-Pfad.
 */
export async function openPaperPosition({ instance, setup, size, entryPrice, entryTime, costs, clientOrderId }) {
    const knex = getKnex()

    const pos = createPosition({
        setup, qty: size.qty, entryPrice, entryTime,
        leverage: instance.risk.leverage, costs,
    })

    const datensatz = {
        instanceId: instance.id,
        setupId: setup.id,
        mode: instance.mode,
        broker: instance.broker,
        symbol: setup.symbol,
        timeframe: setup.timeframe,
        direction: pos.direction,
        qty: pos.qty,
        entryPrice: pos.entryPrice,
        entryTime: pos.entryTime,
        stopLoss: pos.stopLoss,
        initialStopLoss: pos.initialStopLoss,
        takeProfit: pos.takeProfit,
        leverage: pos.leverage,
        notionalUsdt: pos.notionalUsdt,
        marginUsdt: pos.marginUsdt,
        feeOpen: pos.feeOpen,
        clientOrderId,
        externalOrderId: '',
        maePrice: pos.maePrice,
        mfePrice: pos.mfePrice,
        lastCandleTime: entryTime,
        breakEvenDone: 0,
        status: 'open',
    }

    const isPg = knex.client.config.client === 'pg'
    try {
        const id = isPg
            ? (await knex('strategy_positions').insert(datensatz).returning('id'))[0]?.id
            : (await knex('strategy_positions').insert(datensatz))[0]
        return { ok: true, positionId: id, position: { ...datensatz, id } }
    } catch (e) {
        // Unique-Konflikt auf clientOrderId = der Trade läuft bereits
        if (/unique|constraint/i.test(e.message)) {
            return { ok: false, reason: 'duplicate_order', detail: clientOrderId }
        }
        throw e
    }
}

/** DB-Zeile → Objekt, wie es der Fill-Simulator erwartet. */
function zuPosition(row) {
    return {
        setupId: row.setupId,
        symbol: row.symbol,
        timeframe: row.timeframe,
        direction: row.direction,
        qty: Number(row.qty),
        entryPrice: Number(row.entryPrice),
        entryTime: Number(row.entryTime),
        stopLoss: Number(row.stopLoss),
        initialStopLoss: Number(row.initialStopLoss),
        takeProfit: Number(row.takeProfit),
        leverage: Number(row.leverage),
        notionalUsdt: Number(row.notionalUsdt),
        marginUsdt: Number(row.marginUsdt),
        feeOpen: Number(row.feeOpen),
        maePrice: Number(row.maePrice),
        mfePrice: Number(row.mfePrice),
        breakEvenDone: Boolean(row.breakEvenDone),
        status: row.status,
    }
}

/**
 * Schreibt alle offenen Positionen eines Symbols bis zur jüngsten Kerze fort.
 *
 * Es werden nur Kerzen NACH `lastCandleTime` ausgewertet — so wird keine Kerze
 * doppelt gezählt, und ein Neustart des Servers holt verpasste Kerzen sauber
 * nach, statt sie zu überspringen.
 *
 * @returns {Promise<Array>} die dabei geschlossenen Trades
 */
export async function stepPaperPositions({ instance, symbol, candles, costs, breakEvenAtR, maxHoldMs = 0 }) {
    const knex = getKnex()
    const offen = await knex('strategy_positions')
        .where({ instanceId: instance.id, symbol, status: 'open' })

    const geschlossen = []

    for (const row of offen) {
        const pos = zuPosition(row)
        const ab = Number(row.lastCandleTime) || Number(row.entryTime) || 0
        const neue = candles.filter((k) => k.t > ab)
        if (!neue.length) continue

        let exit = null
        for (const k of neue) {
            const r = stepCandle(pos, k, { breakEvenAtR, maxHoldMs })
            if (r.exit) { exit = r.exit; break }
        }

        if (!exit) {
            await knex('strategy_positions').where('id', row.id).update({
                stopLoss: pos.stopLoss,
                maePrice: pos.maePrice,
                mfePrice: pos.mfePrice,
                breakEvenDone: pos.breakEvenDone ? 1 : 0,
                lastCandleTime: neue[neue.length - 1].t,
                updatedAt: knex.fn.now(),
            })
            continue
        }

        const trade = closePosition(pos, exit, costs)
        await knex.transaction(async (trx) => {
            await trx('strategy_trades').insert({
                instanceId: instance.id,
                setupId: row.setupId,
                positionId: row.id,
                strategyId: instance.strategyId,
                mode: row.mode,
                broker: row.broker,
                symbol: row.symbol,
                timeframe: row.timeframe,
                direction: trade.direction,
                qty: trade.qty,
                notionalUsdt: trade.notionalUsdt,
                leverage: trade.leverage,
                entryPrice: trade.entryPrice,
                entryTime: trade.entryTime,
                exitPrice: trade.exitPrice,
                exitTime: trade.exitTime,
                stopLoss: trade.stopLoss,
                takeProfit: trade.takeProfit,
                grossPnl: trade.grossPnl,
                fees: trade.fees,
                funding: trade.funding,
                netPnl: trade.netPnl,
                rMultiple: trade.rMultiple,
                exitReason: trade.exitReason,
                maeR: trade.maeR,
                mfeR: trade.mfeR,
                holdingMinutes: trade.holdingMinutes,
                paramsVersion: instance.paramsVersion,
            })
            await trx('strategy_positions').where('id', row.id).update({
                status: 'closed',
                stopLoss: pos.stopLoss,
                maePrice: pos.maePrice,
                mfePrice: pos.mfePrice,
                lastCandleTime: exit.time,
                updatedAt: knex.fn.now(),
            })
            await trx('strategy_setups').where('id', row.setupId).update({
                status: 'closed', updatedAt: knex.fn.now(),
            })
        })

        geschlossen.push({ ...trade, positionId: row.id })
    }

    return geschlossen
}

/** Schliesst eine offene Position von Hand (Kill-Switch, Nutzer-Eingriff). */
export async function closePaperPositionManually({ instance, positionRow, price, time, costs, reason = 'manual' }) {
    const knex = getKnex()
    const pos = zuPosition(positionRow)
    const trade = closePosition(pos, { price, reason, time }, costs)

    await knex.transaction(async (trx) => {
        await trx('strategy_trades').insert({
            instanceId: instance.id,
            setupId: positionRow.setupId,
            positionId: positionRow.id,
            strategyId: instance.strategyId,
            mode: positionRow.mode,
            broker: positionRow.broker,
            symbol: positionRow.symbol,
            timeframe: positionRow.timeframe,
            direction: trade.direction,
            qty: trade.qty,
            notionalUsdt: trade.notionalUsdt,
            leverage: trade.leverage,
            entryPrice: trade.entryPrice,
            entryTime: trade.entryTime,
            exitPrice: trade.exitPrice,
            exitTime: trade.exitTime,
            stopLoss: trade.stopLoss,
            takeProfit: trade.takeProfit,
            grossPnl: trade.grossPnl,
            fees: trade.fees,
            funding: trade.funding,
            netPnl: trade.netPnl,
            rMultiple: trade.rMultiple,
            exitReason: reason,
            maeR: trade.maeR,
            mfeR: trade.mfeR,
            holdingMinutes: trade.holdingMinutes,
            paramsVersion: instance.paramsVersion,
        })
        await trx('strategy_positions').where('id', positionRow.id).update({
            status: 'closed', updatedAt: knex.fn.now(),
        })
        await trx('strategy_setups').where('id', positionRow.setupId).update({
            status: 'closed', updatedAt: knex.fn.now(),
        })
    })

    return trade
}
