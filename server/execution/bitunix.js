/**
 * Live-Ausführung auf Bitunix-Futures.
 *
 * ⚠ WICHTIG VOR DER ERSTEN SCHARFSCHALTUNG
 * Das Journal hatte bisher ausschliesslich LESENDEN Zugriff auf Bitunix — es
 * gab keinen einzigen Order-Aufruf, an dem man sich hätte orientieren können.
 * Signatur, Transport und Authentifizierung sind hier deshalb die bewährten aus
 * `bitunix-api.js`, die Feldnamen des Order-Aufrufs stammen aber aus der
 * Bitunix-Dokumentation und sind im Betrieb noch nicht bestätigt.
 *
 * Deshalb: **zuerst im `shadow`-Modus fahren.** Dort läuft der komplette Pfad
 * bis zum fertig gebauten Order-Body durch, der Aufruf wird aber nur
 * protokolliert statt gesendet. Erst wenn dieser Body gegen die aktuelle
 * Bitunix-Doku geprüft ist, sollte eine Instanz auf `live` gestellt werden.
 *
 * Schutzmechanismen, die unabhängig davon greifen:
 *   - `clientId` ist deterministisch (Instanz + Setup) → ein Wiederholungs-
 *     versuch kann keine zweite Position öffnen.
 *   - Stop und Ziel gehen MIT der Order raus. Scheitert das, wird die Position
 *     sofort geschlossen, statt ungesichert im Markt zu bleiben.
 */

import { bitunixRequest, getDecryptedConfig } from '../bitunix-api.js'
import { logError, logWarn } from '../logger.js'

const PFAD_ORDER = '/api/v1/futures/trade/place_order'
const PFAD_POSITIONEN = '/api/v1/futures/position/get_pending_positions'
const PFAD_FLASH_CLOSE = '/api/v1/futures/trade/flash_close_position'
const PFAD_ACCOUNT = '/api/v1/futures/account'

/** Handelsrichtung → Bitunix-Felder für das ÖFFNEN einer Position. */
function orderSeite(direction) {
    return direction === 'long'
        ? { side: 'BUY', tradeSide: 'OPEN' }
        : { side: 'SELL', tradeSide: 'OPEN' }
}

async function keys() {
    const cfg = await getDecryptedConfig()
    if (!cfg?.apiKey || !cfg?.secretKey) {
        throw new Error('Keine Bitunix-Zugangsdaten hinterlegt')
    }
    return cfg
}

/** Verfügbares Kapital in USDT — Basis für die Positionsgrösse im Live-Betrieb. */
export async function getLiveEquity() {
    const cfg = await keys()
    const r = await bitunixRequest('GET', PFAD_ACCOUNT, cfg.apiKey, cfg.secretKey, { marginCoin: 'USDT' })
    const d = r?.data || {}
    // Bonus zählt nicht als handelbares Kapital (gleiche Regel wie im Journal)
    const saldo = Number(d.available ?? d.balance ?? 0) - Number(d.bonus || 0)
    if (!Number.isFinite(saldo)) throw new Error('Kontostand nicht lesbar')
    return Math.max(0, saldo)
}

/**
 * Baut den Order-Body. Bewusst als eigene, reine Funktion: genau dieses Objekt
 * wird im Schattenbetrieb protokolliert und ist damit vor dem Scharfschalten
 * prüfbar, ohne dass etwas gesendet wird.
 */
export function baueOrder({ setup, size, leverage, clientOrderId }) {
    const { side, tradeSide } = orderSeite(setup.direction)
    return {
        symbol: setup.symbol,
        marginCoin: 'USDT',
        qty: String(size.qty),
        side,
        tradeSide,
        orderType: 'MARKET',
        effect: 'GTC',
        clientId: clientOrderId,
        leverage: String(leverage),
        // Absicherung geht MIT der Order raus, nicht danach
        tpPrice: setup.takeProfit ? String(setup.takeProfit) : undefined,
        tpStopType: setup.takeProfit ? 'LAST_PRICE' : undefined,
        tpOrderType: setup.takeProfit ? 'MARKET' : undefined,
        slPrice: String(setup.stopLoss),
        slStopType: 'LAST_PRICE',
        slOrderType: 'MARKET',
    }
}

/**
 * Öffnet eine Position.
 *
 * @param {object} opts
 * @param {string} opts.mode  'live' sendet, 'shadow' protokolliert nur
 * @returns {Promise<{ok, externalOrderId, request, response, geschickt}>}
 */
export async function openLivePosition({ setup, size, leverage, clientOrderId, mode }) {
    const body = baueOrder({ setup, size, leverage, clientOrderId })

    if (mode !== 'live') {
        // Schattenbetrieb: alles gerechnet, nichts gesendet.
        return { ok: true, externalOrderId: '', request: body, response: null, geschickt: false }
    }

    const cfg = await keys()
    let antwort
    try {
        antwort = await bitunixRequest('POST', PFAD_ORDER, cfg.apiKey, cfg.secretKey, {}, body)
    } catch (e) {
        logError('execution/bitunix', `Order fehlgeschlagen (${setup.symbol})`, e)
        return { ok: false, reason: 'order_failed', detail: e.message, request: body, geschickt: true }
    }

    // Bitunix meldet Fehler im Envelope, nicht per HTTP-Status
    const erfolg = antwort?.code === 0 || antwort?.code === '0'
    if (!erfolg) {
        return {
            ok: false, reason: 'order_rejected',
            detail: antwort?.msg || 'Unbekannte Ablehnung',
            request: body, response: antwort, geschickt: true,
        }
    }

    const orderId = antwort?.data?.orderId || antwort?.data?.clientId || ''

    // Ohne Stop darf keine Position stehen bleiben. Hat die Börse den Stop
    // nicht übernommen, wird sofort wieder geschlossen.
    if (!body.slPrice) {
        logWarn('execution/bitunix', 'Order ohne Stop — wird sofort geschlossen')
        await closeLivePosition({ symbol: setup.symbol, direction: setup.direction, mode })
            .catch((e) => logError('execution/bitunix', 'Notfall-Schliessung fehlgeschlagen', e))
        return { ok: false, reason: 'no_stop_loss', request: body, response: antwort, geschickt: true }
    }

    return { ok: true, externalOrderId: String(orderId), request: body, response: antwort, geschickt: true }
}

/**
 * Positions-Kennung der offenen Position zu einem Symbol — best effort.
 *
 * Die Order-Antwort liefert nur die ORDER-Kennung; Flash-Close verlangt die
 * POSITIONS-Kennung. Ohne sie bliebe nur das symbolweite Schliessen, und das
 * träfe auch Positionen, die der Nutzer von Hand hält.
 */
export async function getLivePositionId(symbol, direction) {
    const cfg = await keys()
    const r = await bitunixRequest('GET', PFAD_POSITIONEN, cfg.apiKey, cfg.secretKey, { symbol })
    const liste = Array.isArray(r?.data) ? r.data : []
    const seite = direction === 'long' ? 'BUY' : 'SELL'
    const treffer = liste.find((x) => x.symbol === symbol && (x.side === seite || liste.length === 1))
    return treffer?.positionId ? String(treffer.positionId) : ''
}

/** Schliesst eine offene Position zum Marktpreis. */
export async function closeLivePosition({ symbol, positionId, direction, mode }) {
    const body = positionId
        ? { positionId: String(positionId) }
        : { symbol, marginCoin: 'USDT' }

    if (mode !== 'live') {
        return { ok: true, request: body, response: null, geschickt: false }
    }

    const cfg = await keys()
    const antwort = await bitunixRequest('POST', PFAD_FLASH_CLOSE, cfg.apiKey, cfg.secretKey, {}, body)
    const erfolg = antwort?.code === 0 || antwort?.code === '0'
    return {
        ok: erfolg,
        reason: erfolg ? '' : (antwort?.msg || 'close_failed'),
        request: body, response: antwort, geschickt: true,
    }
}
