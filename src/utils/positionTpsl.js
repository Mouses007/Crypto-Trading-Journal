/**
 * SL/TP einer offenen Position bei der Börse abfragen und zusammenfassen.
 *
 * Bis 18.10.2026 lebte das nur in `Incoming.vue`. Der Chart braucht dieselbe
 * Antwort, um Stop und Ziel einer offenen Position einzuzeichnen — zwei Kopien
 * würden auseinanderlaufen (die Positionsfilterung unten ist genau so eine
 * Stelle, die man in der zweiten Kopie vergisst).
 */
import axios from 'axios'

/** Rohe TP/SL-Orders je Börse. Bitget fragt je Symbol, Bitunix je Position. */
export async function holeTpSlOrders(broker, positionId, symbol) {
    const { data } = broker === 'bitget'
        ? await axios.get(`/api/bitget/position-tpsl/${encodeURIComponent(symbol)}`)
        : await axios.get(`/api/bitunix/position-tpsl/${positionId}`)
    return data?.ok && Array.isArray(data.orders) ? data.orders : []
}

/**
 * Orders zu einem SL und einem TP verdichten. Bitunix liefert unter Umständen
 * ALLE offenen Orders des Kontos — deshalb nach Position filtern; Orders ohne
 * Positionsbezug (Bitget) gelten als zur Position gehörig.
 */
export function aggregiereTpSl(orders, positionId) {
    if (!orders || !orders.length) return { sl: null, tp: null, slQty: 0, tpQty: 0, orders: [] }
    const posId = String(positionId)
    const gefiltert = orders.filter((o) =>
        (!o.positionId && !o.position_id) || String(o.positionId || o.position_id || '') === posId)
    let sl = null, tp = null, slQty = 0, tpQty = 0
    for (const o of gefiltert) {
        if (o.slPrice && parseFloat(o.slPrice) > 0) {
            sl = parseFloat(o.slPrice)
            slQty += parseFloat(o.slQty || 0)
        }
        if (o.tpPrice && parseFloat(o.tpPrice) > 0) {
            tp = parseFloat(o.tpPrice)
            tpQty += parseFloat(o.tpQty || 0)
        }
    }
    return { sl, tp, slQty, tpQty, orders: gefiltert }
}
