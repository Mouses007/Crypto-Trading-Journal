/**
 * Abgleich zwischen Datenbank und Börse für Live-Positionen.
 *
 * ── Die Lücke, die das hier schliesst ───────────────────────────────────────
 * `pflegeOffenePositionen` in der Engine filtert auf `paper`/`shadow`, und
 * `stepPaperPositions` verweigert Live-Zeilen ausdrücklich. Eine Live-Position
 * blieb deshalb für immer `open`: sie wurde nie als Trade gebucht, tauchte in
 * keiner Auswertung auf, und über `maxConcurrentPositions` blockierte sie ihre
 * Instanz dauerhaft. Dasselbe galt für `status: 'unknown'` — geschrieben,
 * wenn ein Transportfehler nach dem Senden auftrat, und danach von niemandem
 * je wieder angefasst.
 *
 * ── Warum nicht im Engine-Takt ─────────────────────────────────────────────
 * Der arbeitet nur bei neuem Kerzenschluss. Eine Position bis zum nächsten
 * 4h-Schluss unversöhnt zu lassen, ist keine Option — in der Zeit rechnet die
 * Risikoprüfung mit falschen Zahlen.
 *
 * ── Die Trennung, die hier gilt ────────────────────────────────────────────
 * `entscheideAbgleich` ist rein und entscheidet; geschrieben wird nur im
 * Aufrufer. So ist die Fallunterscheidung testbar, ohne eine Datenbank und
 * ohne eine Börse — und sie ist der Teil, bei dem ein Denkfehler teuer wird.
 *
 * ── Der Schlüssel zu allem ─────────────────────────────────────────────────
 * Die `clientOrderId` ist deterministisch (`ctj-<instanz>-<setup>`). Zusammen
 * mit einem Endpunkt, der danach sucht, lässt sich für JEDE Reservierung
 * feststellen, was aus ihr geworden ist — statt zu raten, ob eine Order
 * angekommen ist.
 */

import { getKnex } from '../database.js'
import { closePositionMitFills } from '../fill-simulator.js'
import { holeAdapter } from './index.js'
import { logError, logWarn } from '../logger.js'

/** So lange darf eine Reservierung jung sein, bevor sie hinterfragt wird. */
export const PENDING_GNADE_MS = 60000
/** So lange darf ein Schliessvorgang laufen, bevor er als hängend gilt. */
export const CLOSING_GNADE_MS = 60000

/**
 * Was ist mit dieser Zeile zu tun? Rein.
 *
 * @param {object} o
 * @param {object} o.zeile            Zeile aus `strategy_positions`
 * @param {object|null} o.boersenPosition  offene Position der Börse (oder null)
 * @param {object|null} o.order       Ergebnis der clientOrderId-Abfrage (oder null)
 * @param {number} o.jetzt
 * @returns {{fall, grund, menge?}}
 *   fall: 'warten' | 'oeffnen' | 'verwerfen' | 'buchen' | 'angleichen'
 *       | 'erneut_schliessen' | 'unklar'
 */
export function entscheideAbgleich({ zeile, boersenPosition = null, order = null, jetzt = Date.now() }) {
    const status = String(zeile?.status || '')
    const alter = jetzt - (Number(zeile?.updatedAtMs) || Number(zeile?.entryTime) || 0)

    // ── Reservierungen ────────────────────────────────────────────────────
    if (status === 'pending' || status === 'unknown') {
        // Eine junge Reservierung gehört der Engine, die gerade sendet. Sie
        // anzufassen hiesse, ihr die Order unter den Händen wegzuziehen.
        if (status === 'pending' && alter < PENDING_GNADE_MS) {
            return { fall: 'warten', grund: 'pending_jung' }
        }

        // Die Börse führt eine passende Position: die Order ist durch, nur die
        // Bestätigung ging verloren.
        if (boersenPosition?.qty > 0) {
            return { fall: 'oeffnen', grund: 'position_existiert' }
        }

        if (order?.gefuellt) {
            // Gefüllt, aber keine Position mehr — sie wurde also gefüllt UND
            // wieder geschlossen (Ziel-Limit, Liquidation). Nicht öffnen,
            // sondern buchen, was wirklich passiert ist.
            return { fall: 'buchen', grund: 'gefuellt_und_schon_zu' }
        }
        if (order) {
            // Order existiert, ist aber nicht gefüllt: stornieren und die
            // Reservierung wegräumen. Stehen lassen hiesse, dass sie irgendwann
            // doch noch füllt — ohne dass jemand darauf wartet.
            return { fall: 'verwerfen', grund: 'order_offen', storno: true }
        }
        // Keine Order, keine Position: nie angekommen.
        return { fall: 'verwerfen', grund: 'keine_order' }
    }

    // ── Offene Positionen ─────────────────────────────────────────────────
    if (status === 'open') {
        if (!boersenPosition || !(boersenPosition.qty > 0)) {
            return { fall: 'buchen', grund: 'extern_geschlossen' }
        }
        // Die Mengen laufen auseinander. Die BÖRSE gewinnt — sie ist die
        // Wahrheit über das, was im Markt steht. Eine DB-Zeile, die eine
        // grössere Menge behauptet, würde beim Schliessen zu viel verkaufen.
        const dbMenge = Math.abs(Number(zeile.qty) || 0)
        if (dbMenge > 0 && Math.abs(boersenPosition.qty - dbMenge) / dbMenge > 0.01) {
            return { fall: 'angleichen', grund: 'menge_abweichend', menge: boersenPosition.qty }
        }
        return { fall: 'warten', grund: 'stimmt_ueberein' }
    }

    // ── Hängende Schliessvorgänge ─────────────────────────────────────────
    if (status === 'closing') {
        if (!boersenPosition || !(boersenPosition.qty > 0)) {
            return { fall: 'buchen', grund: 'schliessung_durch' }
        }
        if (alter > CLOSING_GNADE_MS) {
            return { fall: 'erneut_schliessen', grund: 'closing_haengt' }
        }
        return { fall: 'warten', grund: 'closing_laeuft' }
    }

    return { fall: 'warten', grund: 'kein_fall' }
}

/**
 * Ein Abgleichlauf über alle Live-Zeilen, die nicht abgeschlossen sind.
 *
 * Läuft unter der Führung des Stop-Wächters; er ruft sie auf. Eine eigene
 * Führung wäre eine zweite, die mit der ersten kollidieren könnte.
 */
export async function gleicheAb({ ladeInstanz, schliesseBuchung }) {
    const knex = getKnex()
    const zeilen = await knex('strategy_positions')
        .where('mode', 'live')
        .whereIn('status', ['pending', 'open', 'closing', 'unknown'])

    if (!zeilen.length) return { geprueft: 0, aktionen: 0 }

    const jetzt = Date.now()
    let aktionen = 0

    const nachInstanz = new Map()
    for (const z of zeilen) {
        if (!nachInstanz.has(z.instanceId)) nachInstanz.set(z.instanceId, [])
        nachInstanz.get(z.instanceId).push(z)
    }

    for (const [instanceId, liste] of nachInstanz) {
        const row = await knex('strategy_instances').where('id', instanceId).first()
        const instance = row ? ladeInstanz(row) : null
        if (!instance) {
            logError('abgleich', `Instanz ${instanceId} nicht ladbar — ${liste.length} Live-Zeile(n) bleiben unversöhnt`)
            continue
        }

        let adapter
        try { adapter = holeAdapter(instance.broker) } catch (e) {
            logError('abgleich', `Broker "${instance.broker}" unbekannt`, e)
            continue
        }

        let boerse
        try {
            boerse = typeof adapter.holeOffenePositionen === 'function'
                ? await adapter.holeOffenePositionen()
                : []
        } catch (e) {
            // Ohne Börsenbild darf NICHTS entschieden werden: „keine Position
            // gefunden" hiesse sonst „extern geschlossen", und der Abgleich
            // würde eine laufende Position wegbuchen.
            logError('abgleich', `Positionen von ${instance.broker} nicht abrufbar — Abgleich ausgesetzt`, e)
            continue
        }

        for (const zeile of liste) {
            const boersenPosition = boerse.find(
                (p) => p.symbol === zeile.symbol && p.direction === zeile.direction && p.qty > 0) || null

            // Die Order nur nachschlagen, wenn die Antwort den Fall auch
            // ändern kann — das spart bei jedem Takt Abrufe für Zeilen, die
            // ohnehin nur warten.
            let order = null
            const brauchtOrder = (zeile.status === 'pending' || zeile.status === 'unknown') && !boersenPosition
            if (brauchtOrder && typeof adapter.holeOrderPerClientId === 'function' && zeile.clientOrderId) {
                order = await adapter.holeOrderPerClientId({
                    symbol: zeile.symbol, clientOrderId: zeile.clientOrderId,
                }).catch(() => null)
            }

            const u = entscheideAbgleich({
                zeile: { ...zeile, updatedAtMs: new Date(zeile.updatedAt || 0).getTime() || 0 },
                boersenPosition, order, jetzt,
            })

            const getan = await fuehreAus({
                knex, instance, adapter, zeile, urteil: u, boersenPosition, order, jetzt, schliesseBuchung,
            })
            if (getan) aktionen++
        }
    }

    return { geprueft: zeilen.length, aktionen }
}

async function fuehreAus({ knex, instance, adapter, zeile, urteil, boersenPosition, order, jetzt, schliesseBuchung }) {
    switch (urteil.fall) {
        case 'warten':
            return false

        case 'oeffnen': {
            // Die Order war durch, nur die Bestätigung ging verloren. Echte
            // Zahlen der Börse übernehmen — nicht die geschätzten aus der
            // Reservierung.
            const werte = {
                status: 'open',
                externalOrderId: order?.orderId || zeile.externalOrderId || '',
                externalPositionId: boersenPosition?.positionId || '',
                updatedAt: knex.fn.now(),
            }
            if (boersenPosition?.entryPrice > 0) werte.entryPrice = boersenPosition.entryPrice
            if (boersenPosition?.qty > 0) werte.qty = boersenPosition.qty
            await knex('strategy_positions').where('id', zeile.id).update(werte)
            logWarn('abgleich', `${zeile.symbol}: Reservierung nachträglich als offen bestätigt (${urteil.grund})`)
            return true
        }

        case 'verwerfen': {
            if (urteil.storno && order?.orderId && typeof adapter.storniereOrder === 'function') {
                await adapter.storniereOrder({ symbol: zeile.symbol, orderId: order.orderId, mode: 'live' })
                    .catch((e) => logWarn('abgleich', `Storno ${zeile.symbol}: ${e.message}`))
            }
            await knex('strategy_positions').where('id', zeile.id)
                .whereIn('status', ['pending', 'unknown']).del()
            logWarn('abgleich', `${zeile.symbol}: Reservierung verworfen (${urteil.grund})`)
            return true
        }

        case 'angleichen':
            await knex('strategy_positions').where('id', zeile.id)
                .update({ qty: urteil.menge, updatedAt: knex.fn.now() })
            logWarn('abgleich',
                `${zeile.symbol}: Menge an die Börse angeglichen (${zeile.qty} → ${urteil.menge}) — die Börse ist die Wahrheit`)
            return true

        case 'erneut_schliessen': {
            const r = await adapter.closeLivePosition({
                symbol: zeile.symbol, direction: zeile.direction,
                positionId: zeile.externalPositionId || null,
                qty: Number(zeile.qty) || 0, mode: 'live',
            }).catch((e) => ({ ok: false, reason: e.message }))
            if (!r.ok) {
                logError('abgleich', `${zeile.symbol}: hängende Schliessung liess sich nicht nachholen (${r.reason})`)
                return false
            }
            logWarn('abgleich', `${zeile.symbol}: hängende Schliessung nachgeholt`)
            return true
        }

        case 'buchen':
            return schliesseBuchung({ knex, instance, adapter, zeile, urteil, jetzt })

        default:
            return false
    }
}

/**
 * Bucht eine extern geschlossene Position als Trade — mit den echten Zahlen.
 *
 * Getrennt vom Rest, damit ein Test den Entscheidungsteil ohne Buchhaltung
 * prüfen kann und umgekehrt.
 */
export async function bucheExternGeschlossen({ knex, instance, adapter, zeile, urteil, jetzt }) {
    // Erst beanspruchen, dann buchen. Ohne den Claim könnten Wächter und
    // Abgleich denselben Trade schreiben.
    const beansprucht = await knex('strategy_positions')
        .where('id', zeile.id).whereIn('status', ['open', 'closing', 'pending', 'unknown'])
        .update({ status: 'closed', exitGrund: urteil.grund, updatedAt: knex.fn.now() })
    if (!beansprucht) return false

    // Den Ausstieg rekonstruieren, wenn der Adapter es kann. Ohne ihn bleibt
    // nur eine Schätzung — siehe unten.
    const fill = typeof adapter.holeAusstieg === 'function'
        ? await adapter.holeAusstieg({
            symbol: zeile.symbol,
            direction: zeile.direction,
            vonMs: Number(zeile.entryTime) || 0,
            bisMs: jetzt,
            menge: Number(zeile.qty) || 0,
        }).catch(() => null)
        : null

    const pos = {
        setupId: zeile.setupId,
        symbol: zeile.symbol,
        timeframe: zeile.timeframe,
        direction: zeile.direction,
        entryPrice: Number(zeile.entryPrice),
        entryTime: Number(zeile.entryTime),
        qty: Number(zeile.qty),
        initialQty: Number(zeile.initialQty) || Number(zeile.qty),
        initialStopLoss: Number(zeile.initialStopLoss) || Number(zeile.stopLoss),
        takeProfit: Number(zeile.takeProfit),
        leverage: Number(zeile.leverage),
        notionalUsdt: Number(zeile.notionalUsdt),
        feeOpen: Number(zeile.feeOpen),
        partialQty: Number(zeile.partialQty) || 0,
        partialGross: Number(zeile.partialGross) || 0,
        partialFee: Number(zeile.partialFee) || 0,
        maePrice: Number(zeile.maePrice) || Number(zeile.entryPrice),
        mfePrice: Number(zeile.mfePrice) || Number(zeile.entryPrice),
    }

    // Ohne echten Fill bleibt nur der letzte bekannte Preis. Das ist eine
    // Notlösung und wird als solche vermerkt — die Zahl ist dann eine
    // Schätzung, und die Auswertung soll das wissen.
    const preis = Number(fill?.price) || Number(zeile.takeProfit) || Number(zeile.stopLoss) || Number(zeile.entryPrice)
    const geschaetzt = !(Number(fill?.price) > 0)

    // Der Grund ist 'extern': geschlossen hat jemand anderes — die
    // Ziel-Limit-Order, die Boerse per Liquidation, oder ein Handgriff im
    // Pionex-Fenster. Welcher davon, ist aus der Positionshistorie nicht
    // zuverlaessig abzulesen; ein geratener Grund waere in der Auswertung
    // schlimmer als ein ehrlich unbestimmter.
    const trade = closePositionMitFills(pos, {
        price: preis,
        reason: 'extern',
        time: Number(fill?.zeit) || jetzt,
        fee: fill?.fee || 0,
        funding: fill?.funding || 0,
    }, {
        instanceId: instance.id,
        strategyId: instance.strategyId,
        positionId: zeile.id,
        mode: 'live',
        broker: instance.broker,
        paramsVersion: instance.paramsVersion,
    })

    await knex('strategy_trades').insert(trade)
    if (geschaetzt) {
        logWarn('abgleich',
            `${zeile.symbol}: extern geschlossen, aber kein Fill abrufbar — Ausstiegspreis GESCHÄTZT (${preis})`)
    } else {
        logWarn('abgleich', `${zeile.symbol}: extern geschlossen zu ${preis} gebucht`)
    }
    return true
}
