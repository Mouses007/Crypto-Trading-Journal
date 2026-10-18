/**
 * Offene Positionen eines Symbols für den Chart: Einstieg, Stop, Ziel,
 * Liquidation, Mark-Preis.
 *
 * Quelle ist die Tabelle `incoming_positions`, die das globale Polling der App
 * aktuell hält (`useStartGlobalPolling`). SL/TP stehen dort nicht verlässlich
 * — sie kommen live von der Börse über dieselbe Hilfe, die auch die Seite
 * „Pendente Trades" benutzt.
 */
import { dbFind } from '../../db.js'
import { normSymbol } from '../../../../shared/symbol.js'
import { holeTpSlOrders, aggregiereTpSl } from '../../positionTpsl.js'

const zahl = (v) => {
    const n = parseFloat(v)
    return Number.isFinite(n) && n !== 0 ? n : null
}

const tpslZwischenspeicher = new Map()     // positionId → { ts, sl, tp }
const TPSL_ALTER_MS = 30_000

async function tpslVon(pos) {
    const alt = tpslZwischenspeicher.get(pos.positionId)
    if (alt && Date.now() - alt.ts < TPSL_ALTER_MS) return alt
    try {
        const orders = await holeTpSlOrders(pos.broker || 'bitunix', pos.positionId, pos.symbol)
        const { sl, tp } = aggregiereTpSl(orders, pos.positionId)
        const neu = { ts: Date.now(), sl, tp }
        tpslZwischenspeicher.set(pos.positionId, neu)
        return neu
    } catch {
        // Kein Schlüssel oder Börse weg: ohne SL/TP zeichnen, nicht ohne
        // Position. Auch der Fehlschlag wird gemerkt — sonst fragte jedes
        // Panel alle 15 s erneut eine Börse, die gerade Nein gesagt hat.
        const leer = { ts: Date.now(), sl: null, tp: null }
        tpslZwischenspeicher.set(pos.positionId, leer)
        return leer
    }
}

/*
 * Mehrere Panels zeigen oft dasselbe Symbol — sie teilen sich eine Abfrage
 * der offenen Positionen, statt jede für sich die Datenbank zu fragen.
 */
let offenAbruf = null
let offenStand = 0
function offenePositionenRoh() {
    if (!offenAbruf || Date.now() - offenStand > 5000) {
        offenStand = Date.now()
        offenAbruf = dbFind('incoming_positions', { equalTo: { status: 'open' } }).catch(() => [])
    }
    return offenAbruf
}

export async function ladeOffenePositionen(symbol) {
    const ziel = normSymbol(symbol)
    const zeilen = await offenePositionenRoh()
    const passende = zeilen.filter((p) => normSymbol(p.symbol) === ziel)
    return Promise.all(passende.map(async (p) => {
        const roh = p.bitunixData || {}
        const { sl, tp } = await tpslVon(p)
        return {
            id: p.positionId,
            broker: p.broker || 'bitunix',
            richtung: String(p.side).toUpperCase() === 'SHORT' ? 'short' : 'long',
            einstieg: zahl(p.entryPrice),
            menge: zahl(p.quantity),
            hebel: zahl(p.leverage),
            liq: zahl(roh.liqPrice ?? roh.liq_price ?? roh.liquidationPrice),
            upnl: Number(p.unrealizedPNL) || 0,
            sl,
            tp,
        }
    }))
}
