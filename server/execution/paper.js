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
export async function openPaperPosition({ instance, setup, size, entryPrice, entryTime, costs, clientOrderId, status = 'open' }) {
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
        initialQty: pos.initialQty,
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
        // 'pending' = Reservierung VOR der Live-Order (Idempotenz zuerst),
        // 'open' erst nach bestätigter Ausführung. Papier bucht direkt 'open'.
        status,
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
        // Teilausstieg aus der Zeile zurückholen. `initialQty` fällt bei alten
        // Zeilen auf die aktuelle Menge zurück — dort gab es keinen Teilausstieg,
        // also stimmt der Bezug für R weiterhin.
        partialDone: Boolean(row.partialDone),
        partialQty: Number(row.partialQty) || 0,
        partialPrice: Number(row.partialPrice) || 0,
        partialGross: Number(row.partialGross) || 0,
        partialFee: Number(row.partialFee) || 0,
        initialQty: Number(row.initialQty) || Number(row.qty),
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
export async function stepPaperPositions({ instance, symbol, candles, costs, breakEvenAtR, maxHoldMs = 0, partialTpR = 0, partialTpPct = 0 }) {
    const knex = getKnex()
    // NUR Papier und Schatten. Eine Live-Position hier fortzuschreiben würde
    // sie in der DB schliessen, während sie an der Börse weiterläuft — der
    // Simulator darf Live-Bestand niemals finalisieren. Live-Positionen werden
    // erst wieder verwaltet, wenn eine echte Broker-Abstimmung existiert.
    const offen = await knex('strategy_positions')
        .where({ instanceId: instance.id, symbol, status: 'open' })
        .whereIn('mode', ['paper', 'shadow'])

    const geschlossen = []

    for (const row of offen) {
        const pos = zuPosition(row)
        const ab = Number(row.lastCandleTime) || Number(row.entryTime) || 0
        const neue = candles.filter((k) => k.t > ab)
        if (!neue.length) continue

        let exit = null
        for (const k of neue) {
            const r = stepCandle(pos, k, { breakEvenAtR, maxHoldMs, partialTpR, partialTpPct, costs })
            if (r.exit) { exit = r.exit; break }
        }

        if (!exit) {
            await knex('strategy_positions').where('id', row.id).update({
                stopLoss: pos.stopLoss,
                maePrice: pos.maePrice,
                mfePrice: pos.mfePrice,
                breakEvenDone: pos.breakEvenDone ? 1 : 0,
                // Teilausstieg muss einen Neustart überleben, sonst wird er doppelt genommen
                qty: pos.qty,
                partialDone: pos.partialDone ? 1 : 0,
                partialQty: Number(pos.partialQty) || 0,
                partialPrice: Number(pos.partialPrice) || 0,
                partialGross: Number(pos.partialGross) || 0,
                partialFee: Number(pos.partialFee) || 0,
                lastCandleTime: neue[neue.length - 1].t,
                updatedAt: knex.fn.now(),
            })
            continue
        }

        const trade = closePosition(pos, exit, costs)
        let doppelt = false
        await knex.transaction(async (trx) => {
            const beansprucht = await trx('strategy_positions')
                .where({ id: row.id, status: 'open' })
                .update({ status: 'closed', updatedAt: trx.fn.now() })
            if (!beansprucht) { doppelt = true; return }
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

        if (!doppelt) geschlossen.push({ ...trade, positionId: row.id })
    }

    return geschlossen
}

/** Schliesst eine offene Position von Hand (Kill-Switch, Nutzer-Eingriff). */
export async function closePaperPositionManually({ instance, positionRow, price, time, costs, reason = 'manual', liveCloseBestaetigt = false }) {
    // Eine Live-Position hier zu buchen wäre die gefährlichste Art von Fehler:
    // im Journal stünde ein geschlossener Trade, während die Position an der
    // Börse WEITERLÄUFT — ohne dass jemand sie noch beobachtet. Der Aufrufer
    // muss zuerst die Börse schliessen (schliessePositionManuell) und das mit
    // `liveCloseBestaetigt` bezeugen — sonst bliebe die Zeile für immer offen.
    if (positionRow.mode === 'live' && !liveCloseBestaetigt) {
        throw new Error('Live-Position kann nicht als Papier-Position geschlossen werden')
    }
    const knex = getKnex()
    const pos = zuPosition(positionRow)
    const trade = closePosition(pos, { price, reason, time }, costs)

    await knex.transaction(async (trx) => {
        // Atomarer Claim: nur wer die Zeile von 'open' wegbewegt, darf den
        // Trade schreiben. HTTP-Route, Takt und Not-Aus können dieselbe
        // Position parallel lesen — ohne den Claim buchte jeder von ihnen.
        const beansprucht = await trx('strategy_positions')
            .where({ id: positionRow.id, status: 'open' })
            .update({ status: 'closed', updatedAt: trx.fn.now() })
        if (!beansprucht) throw new Error('Position ist bereits geschlossen')

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
        await trx('strategy_setups').where('id', positionRow.setupId).update({
            status: 'closed', updatedAt: knex.fn.now(),
        })
    })

    return trade
}
