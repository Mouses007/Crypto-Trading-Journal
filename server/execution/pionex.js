/**
 * Live-Ausführung auf Pionex-Futures.
 *
 * ⚠ ZWEI DINGE, DIE VOR DER ERSTEN SCHARFSCHALTUNG BEKANNT SEIN MÜSSEN
 *
 * 1. **Pionex kennt keine Stop-Order über die API.** Die Futures-Schnittstelle
 *    hat genau fünf Ordersorten — LIMIT, MARKET_QTY, IOC, FOK, POSTONLY — und
 *    kein Feld für Stop oder Ziel. Auf Bitunix geht der Stop mit der Order ins
 *    Buch und liegt dort auch, wenn das Journal ausfällt; hier hält ihn ein
 *    Wächter im Journal (`stop-waechter.js`), und die zweite Sicherung ist die
 *    isolierte Marge (`margen-netz.js`). Wer diese Datei liest und den Stop im
 *    Order-Body sucht: er steht nicht drin und gehört nicht hinein.
 *
 * 2. **Es gibt keinen „Position schliessen"-Endpunkt.** Geschlossen wird mit
 *    einer `reduceOnly`-Marktorder in Gegenrichtung über die Menge, die die
 *    BÖRSE als offen meldet.
 *
 * Signatur und Transport sind die aus `pionex-transport.js`, die seit Monaten
 * im Lesebetrieb laufen. Die Feldnamen des Order-Aufrufs stammen aus der
 * Pionex-Dokumentation und sind im Betrieb noch nicht bestätigt — deshalb
 * gilt hier dasselbe wie bei Bitunix: **zuerst `shadow` fahren**, den
 * protokollierten Body prüfen, dann die Probeorder, dann erst eine Instanz.
 *
 * Schutzmechanismen, die unabhängig davon greifen:
 *   - `clientOrderId` ist deterministisch (Instanz + Setup) → ein
 *     Wiederholungsversuch kann keine zweite Position öffnen.
 *   - Ohne Stop wird gar nicht erst gesendet — auch wenn der Stop nicht in den
 *     Body geht, ist eine Position ohne geplanten Ausstieg nichts, was diese
 *     Datei eröffnet.
 *   - Marge und Hebel werden VOR der Order gesetzt. Schlägt das fehl, gibt es
 *     keine Order: eine Position ohne isolierte Marge hat kein Netz.
 */

import { pionexRequest } from '../pionex-transport.js'
import { getDecryptedPionexConfig } from '../pionex-api.js'
import { pionexSymbol, journalSymbol } from '../pionex-symbole.js'
import { holeSymbolTabelle, holeSymbolMeta, holeMmr } from './pionex-meta.js'
import { logError, logWarn } from '../logger.js'

const PFAD_ORDER = '/uapi/v1/trade/order'
const PFAD_ORDER_PER_CLIENT = '/uapi/v1/trade/orderByClientOrderId'
const PFAD_FILLS_PER_ORDER = '/uapi/v1/trade/fillsByOrderId'
const PFAD_POSITIONEN = '/uapi/v1/account/positions'
const PFAD_BALANCES = '/uapi/v1/account/balances'
const PFAD_LEVERAGE = '/uapi/v1/account/leverage'
const PFAD_POSITIONSMODUS = '/uapi/v1/account/positionMode'
const PFAD_MARGENMODUS = '/uapi/v1/trade/isolatedMode'

/** Wie lange der Kontomodus im Prozess gilt. Er ändert sich von Hand, nicht im Betrieb. */
const MODUS_TTL_MS = 10 * 60 * 1000
let modusCache = null

export const id = 'pionex'
export const label = 'Pionex'

/**
 * Was dieser Adapter kann — und vor allem, was nicht. Die Engine und die
 * Oberfläche fragen hier nach, statt den Broker-Namen abzufragen.
 */
export const faehigkeiten = {
    boersenStop: false,          // ← der Grund für den ganzen Wächter
    boersenZiel: true,           // reduceOnly-Limit geht
    positionsEndpunkt: true,
    hebelSetzbar: true,
    margenmodusSetzbar: true,
    echterFillPreis: true,
    orderMeta: true,
    orderPerClientId: true,
}

async function keys() {
    const cfg = await getDecryptedPionexConfig()
    if (!cfg?.apiKey || !cfg?.secretKey) {
        throw new Error('Keine Pionex-Zugangsdaten hinterlegt')
    }
    return cfg
}

// ── Konto ────────────────────────────────────────────────────────────────

/**
 * Verfügbares Kapital in USDT — Basis für die Positionsgrösse im Live-Betrieb.
 *
 * Gelesen wird das FUTURES-Wallet. Das Spot-Guthaben und die in Bots
 * gebundenen Beträge zählen bewusst nicht mit, obwohl `/api/pionex/balance`
 * sie anzeigt: mit ihnen kann diese Position nicht besichert werden.
 */
export async function getLiveEquity() {
    const cfg = await keys()
    const r = await pionexRequest('GET', PFAD_BALANCES, cfg.apiKey, cfg.secretKey)
    const liste = r?.data?.balances || []
    const usdt = liste.find((b) => String(b?.coin || '').toUpperCase() === 'USDT')
    const frei = Number(usdt?.free ?? 0)
    if (!Number.isFinite(frei)) throw new Error('Kontostand nicht lesbar')
    return Math.max(0, frei)
}

/** Kontomodus: 'BUYSELL' (one-way) oder 'OPENCLOSE' (hedge). */
export async function holeKontomodus() {
    if (modusCache && (Date.now() - modusCache.ts) < MODUS_TTL_MS) return modusCache.modus
    const cfg = await keys()
    const r = await pionexRequest('GET', PFAD_POSITIONSMODUS, cfg.apiKey, cfg.secretKey)
    const modus = String(r?.data?.positionMode || 'BUYSELL').toUpperCase()
    modusCache = { ts: Date.now(), modus }
    return modus
}

/** Offene Positionen, auf Journal-Symbole normalisiert. */
export async function holeOffenePositionen(symbol = '') {
    const cfg = await keys()
    const params = {}
    if (symbol) params.symbol = await pionexSymbolFuer(symbol)
    const r = await pionexRequest('GET', PFAD_POSITIONEN, cfg.apiKey, cfg.secretKey, params)
    return (r?.data?.positions || []).map(zuPosition).filter(Boolean)
}

/** Reiner Teil: Pionex-Position → die Felder, die Wächter und Abgleich lesen. */
export function zuPosition(p) {
    if (!p?.symbol) return null
    const netSize = Number(p.netSize ?? p.size ?? 0)
    const seite = String(p.positionSide || '').toUpperCase()
    return {
        symbol: journalSymbol(p.symbol),
        pionexSymbol: String(p.symbol),
        positionId: String(p.positionId ?? p.id ?? ''),
        // Im One-Way-Modus sagt das Vorzeichen die Richtung, im Hedge-Modus das Feld.
        direction: seite === 'LONG' ? 'long' : seite === 'SHORT' ? 'short' : (netSize < 0 ? 'short' : 'long'),
        netSize,
        qty: Math.abs(netSize),
        entryPrice: Number(p.avgPrice ?? p.entryPrice ?? 0),
        markPrice: Number(p.markPrice ?? 0),
        liquidationPrice: Number(p.liquidationPrice ?? 0),
        leverage: Number(p.leverage ?? 0),
        unrealizedPnl: Number(p.unrealizedPnL ?? p.unrealizedPnl ?? 0),
    }
}

/**
 * Positions-Kennung zu einem Symbol — Symbol UND Seite müssen stimmen.
 * Kein Rückfall auf „es gibt ja nur eine": das könnte eine handgehaltene
 * Gegenposition sein. Gleiche Regel wie bei Bitunix.
 */
export async function getLivePositionId(symbol, direction) {
    const liste = await holeOffenePositionen(symbol).catch(() => [])
    const treffer = liste.find((p) => p.symbol === String(symbol).toUpperCase() && p.direction === direction)
    return treffer?.positionId || ''
}

// ── Vorbereitung ─────────────────────────────────────────────────────────

/** Journal-Symbol → Pionex-Symbol, über die geladene Perp-Liste. */
async function pionexSymbolFuer(symbol) {
    const tabelle = await holeSymbolTabelle().catch(() => null)
    return pionexSymbol(symbol, tabelle)
}

/**
 * Setzt Margenmodus und Hebel für ein Symbol — VOR der Order.
 *
 * Beide Einstellungen sind bei Pionex symbolweit, nicht positionsweit. Deshalb
 * wird zuerst geprüft, ob im Symbol schon etwas offen ist: eine fremde (von
 * Hand gehaltene) Position würde sonst mit umgestellt, und ihr Besitzer merkte
 * es erst an der veränderten Liquidationsschwelle.
 *
 * Die Vorher-Werte kommen zurück und gehören ins Lauf-Protokoll. Zurückgesetzt
 * wird NICHT: das wäre ein weiterer symbolweiter Schreibzugriff mit genau
 * demselben Problem.
 */
export async function bereiteSymbolVor({ symbol, leverage, isoliert = true, mode }) {
    const psym = await pionexSymbolFuer(symbol)

    if (mode !== 'live') {
        return { ok: true, geschickt: false, vorher: null, psym }
    }

    const cfg = await keys()

    const offen = await holeOffenePositionen(symbol).catch(() => [])
    if (offen.some((p) => p.qty > 0)) {
        return { ok: false, reason: 'symbol_belegt', detail: `${symbol} hat bereits eine offene Position`, psym }
    }

    const vorher = {}
    try {
        const m = await pionexRequest('GET', PFAD_MARGENMODUS, cfg.apiKey, cfg.secretKey, { symbol: psym })
        vorher.isolatedMode = String(m?.data?.isolatedMode || '').toUpperCase()
        const gewuenscht = isoliert ? 'ISOLATED' : 'CROSS'
        if (vorher.isolatedMode !== gewuenscht) {
            await pionexRequest('POST', PFAD_MARGENMODUS, cfg.apiKey, cfg.secretKey, {},
                { symbol: psym, isolatedMode: gewuenscht })
        }

        const l = await pionexRequest('GET', PFAD_LEVERAGE, cfg.apiKey, cfg.secretKey, { symbol: psym })
        vorher.leverage = Number(l?.data?.leverage) || 0
        if (Math.round(vorher.leverage) !== Math.round(leverage)) {
            await pionexRequest('POST', PFAD_LEVERAGE, cfg.apiKey, cfg.secretKey, {},
                { symbol: psym, leverage: String(Math.round(leverage)) })
        }
    } catch (e) {
        logError('execution/pionex', `Margen-/Hebel-Vorbereitung ${symbol} fehlgeschlagen`, e)
        return { ok: false, reason: 'margin_setup_failed', detail: e.message, vorher, psym }
    }

    return { ok: true, geschickt: true, vorher, psym }
}

// ── Order-Bodies (rein) ──────────────────────────────────────────────────

/**
 * Baut den Order-Body fürs ÖFFNEN.
 *
 * Bewusst als reine Funktion und bewusst OHNE Stop-/Zielfelder: genau dieses
 * Objekt wird im Schattenbetrieb protokolliert und ist damit vor dem
 * Scharfschalten prüfbar, ohne dass etwas gesendet wird. Wer hier `slPrice`
 * oder `tpPrice` ergänzt (etwa aus `bitunix.js` kopiert), baut Felder ein, die
 * Pionex stillschweigend ignoriert — und der Betreiber hielte den Stop für
 * gesetzt. Der Selbsttest wacht darüber.
 *
 * @param {object} o
 * @param {string} o.kontomodus 'BUYSELL' (one-way) | 'OPENCLOSE' (hedge)
 * @param {string} o.psym       bereits übersetztes Pionex-Symbol
 */
export function baueOrder({ setup, size, clientOrderId, kontomodus = 'BUYSELL', psym }) {
    return {
        symbol: psym || setup.symbol,
        side: setup.direction === 'long' ? 'BUY' : 'SELL',
        type: 'MARKET_QTY',
        size: String(size.qty),
        clientOrderId,
        // One-way: alles läuft auf BOTH, Schliessen über reduceOnly.
        // Hedge: die Seite ist Pflicht und reduceOnly verboten.
        positionSide: kontomodus === 'OPENCLOSE'
            ? (setup.direction === 'long' ? 'LONG' : 'SHORT')
            : 'BOTH',
        reduceOnly: false,
    }
}

/**
 * Baut den Body fürs SCHLIESSEN: Gegenrichtung, `reduceOnly`.
 *
 * `netSize` kommt aus der Börsenantwort, nicht aus der Datenbank — die Börse
 * ist die Wahrheit über die Menge, und ein Teilfill hätte die DB-Zeile längst
 * überholt. Die Menge wird auch NICHT auf die Schrittweite abgerundet: ein
 * Rest wäre eine offene, ungesicherte Position, und genau die soll hier weg.
 */
export function baueCloseOrder({ psym, direction, netSize, kontomodus = 'BUYSELL' }) {
    return {
        symbol: psym,
        side: direction === 'long' ? 'SELL' : 'BUY',
        type: 'MARKET_QTY',
        size: String(Math.abs(Number(netSize) || 0)),
        positionSide: kontomodus === 'OPENCLOSE'
            ? (direction === 'long' ? 'LONG' : 'SHORT')
            : 'BOTH',
        // Im Hedge-Modus verbietet Pionex reduceOnly; dort schliesst die
        // positionSide-Angabe zusammen mit der Gegenrichtung.
        reduceOnly: kontomodus !== 'OPENCLOSE',
    }
}

/** Ziel als reduceOnly-Limit — überlebt einen Prozessausfall und füllt als Maker. */
export function baueZielOrder({ psym, direction, qty, preis, kontomodus = 'BUYSELL' }) {
    return {
        symbol: psym,
        side: direction === 'long' ? 'SELL' : 'BUY',
        type: 'LIMIT',
        size: String(qty),
        price: String(preis),
        positionSide: kontomodus === 'OPENCLOSE'
            ? (direction === 'long' ? 'LONG' : 'SHORT')
            : 'BOTH',
        reduceOnly: kontomodus !== 'OPENCLOSE',
    }
}

/** Preis auf die Schrittweite der Börse legen. Ohne Schrittweite unverändert. */
export function rundePreis(preis, tickSize) {
    const t = Number(tickSize) || 0
    const p = Number(preis) || 0
    if (!(t > 0) || !(p > 0)) return p
    const dec = Math.max(0, Math.round(-Math.log10(t)))
    return Number((Math.round(p / t) * t).toFixed(dec))
}

// ── Orders senden ────────────────────────────────────────────────────────

function envelopeOk(antwort) {
    // Pionex meldet Fehler im Envelope (`result`), nicht nur per HTTP-Status.
    return antwort?.result !== false
}

/**
 * Öffnet eine Position.
 *
 * @param {string} opts.mode  'live' sendet, 'shadow' protokolliert nur
 * @returns {Promise<{ok, externalOrderId, request, response, geschickt, fill?}>}
 */
export async function openLivePosition({ setup, size, leverage, clientOrderId, mode }) {
    const kontomodus = mode === 'live' ? await holeKontomodus().catch(() => 'BUYSELL') : 'BUYSELL'
    let psym
    try {
        psym = await pionexSymbolFuer(setup.symbol)
    } catch (e) {
        // Ein nicht übersetzbares Symbol ist kein Grenzfall, sondern heisst:
        // Pionex handelt dieses Paar nicht. Lieber hier scheitern als eine
        // Order auf einen geratenen Namen zu schicken.
        return { ok: false, reason: 'symbol_unbekannt', detail: e.message, request: null, geschickt: false }
    }

    const body = baueOrder({ setup, size, clientOrderId, kontomodus, psym })

    if (mode !== 'live') {
        // Schattenbetrieb: alles gerechnet, nichts gesendet.
        return { ok: true, externalOrderId: '', request: body, response: null, geschickt: false }
    }

    // Ohne Stop wird nicht gesendet. Er geht zwar nicht in den Body — aber eine
    // Position ohne geplanten Ausstieg eröffnet dieser Adapter nicht, und der
    // Wächter bräuchte ihn ohnehin.
    if (!(Number(setup.stopLoss) > 0)) {
        return { ok: false, reason: 'no_stop_loss', request: body, response: null, geschickt: false }
    }

    const cfg = await keys()
    let antwort
    try {
        antwort = await pionexRequest('POST', PFAD_ORDER, cfg.apiKey, cfg.secretKey, {}, body)
    } catch (e) {
        logError('execution/pionex', `Order fehlgeschlagen (${setup.symbol})`, e)
        // Abgelehnt oder nicht angekommen? Der Aufrufer muss das unterscheiden
        // können, deshalb `geschickt: true` — er stellt die Zeile auf 'unknown'
        // und der Abgleich löst sie über die clientOrderId auf.
        return { ok: false, reason: 'order_failed', detail: e.message, request: body, geschickt: true }
    }

    if (!envelopeOk(antwort)) {
        return {
            ok: false, reason: 'order_rejected',
            detail: antwort?.message || 'Unbekannte Ablehnung',
            request: body, response: antwort, geschickt: true,
        }
    }

    const orderId = String(antwort?.data?.orderId || '')
    const fill = orderId
        ? await holeFill({ symbol: setup.symbol, orderId }).catch(() => null)
        : null

    return { ok: true, externalOrderId: orderId, request: body, response: antwort, geschickt: true, fill }
}

/**
 * Schliesst eine offene Position zum Marktpreis.
 *
 * Erfolg gilt erst als Erfolg, wenn die Börse die Position anschliessend nicht
 * mehr führt. Ohne diese Gegenprobe könnte eine angenommene, aber nicht
 * ausgeführte Order dazu führen, dass das Journal den Trade bucht, während die
 * Position weiterläuft — der teuerste Zustand, den dieser Code erzeugen kann.
 */
export async function closeLivePosition({ symbol, direction, mode }) {
    const kontomodus = mode === 'live' ? await holeKontomodus().catch(() => 'BUYSELL') : 'BUYSELL'
    const psym = await pionexSymbolFuer(symbol)

    if (mode !== 'live') {
        return {
            ok: true, geschickt: false,
            request: baueCloseOrder({ psym, direction, netSize: 0, kontomodus }),
            response: null,
        }
    }

    const offen = await holeOffenePositionen(symbol)
    const pos = offen.find((p) => p.direction === direction && p.qty > 0)
    if (!pos) {
        // Nichts da heisst: schon zu. Kein Fehler — der Aufrufer darf buchen.
        return { ok: true, geschickt: false, request: null, response: null, schonZu: true }
    }

    const body = baueCloseOrder({ psym, direction, netSize: pos.netSize, kontomodus })
    const cfg = await keys()

    let antwort
    try {
        antwort = await pionexRequest('POST', PFAD_ORDER, cfg.apiKey, cfg.secretKey, {}, body)
    } catch (e) {
        return { ok: false, reason: `close_failed: ${e.message}`, request: body, geschickt: true }
    }
    if (!envelopeOk(antwort)) {
        return { ok: false, reason: antwort?.message || 'close_rejected', request: body, response: antwort, geschickt: true }
    }

    const weg = await warteBisZu(symbol, direction)
    if (!weg) {
        return {
            ok: false, reason: 'close_unbestaetigt',
            detail: 'Order angenommen, Position wird von der Börse weiter geführt',
            request: body, response: antwort, geschickt: true,
        }
    }

    const orderId = String(antwort?.data?.orderId || '')
    const fill = orderId ? await holeFill({ symbol, orderId }).catch(() => null) : null
    return { ok: true, request: body, response: antwort, geschickt: true, fill }
}

/**
 * Legt das Ziel als reduceOnly-Limit ins Buch.
 *
 * Das ist der einzige Ausstieg, den Pionex selbst hält — es gibt keine
 * Stop-Order, aber eine Limit-Order gibt es. Sie überlebt damit als Einzige
 * einen Ausfall des Journals, und sie füllt als Maker statt als Taker.
 *
 * Scheitert sie, ist das kein Abbruchgrund: der Wächter nimmt das Ziel dann
 * als Marktorder. Nur teurer, nicht gefährlich.
 */
export async function setzeZiel({ symbol, direction, qty, preis, mode }) {
    const kontomodus = mode === 'live' ? await holeKontomodus().catch(() => 'BUYSELL') : 'BUYSELL'
    const psym = await pionexSymbolFuer(symbol)
    const meta = await holeSymbolMeta(symbol).catch(() => null)

    const menge = rundeMenge(qty, meta?.stepSize)
    const kurs = rundePreis(preis, meta?.tickSize)
    if (!(menge > 0) || !(kurs > 0)) {
        return { ok: false, reason: 'ziel_unbrauchbar' }
    }

    const body = baueZielOrder({ psym, direction, qty: menge, preis: kurs, kontomodus })
    if (mode !== 'live') return { ok: true, orderId: '', request: body, geschickt: false }

    const cfg = await keys()
    try {
        const a = await pionexRequest('POST', PFAD_ORDER, cfg.apiKey, cfg.secretKey, {}, body)
        if (!envelopeOk(a)) return { ok: false, reason: a?.message || 'ziel_abgelehnt', request: body, response: a }
        return { ok: true, orderId: String(a?.data?.orderId || ''), request: body, response: a, geschickt: true }
    } catch (e) {
        return { ok: false, reason: e.message, request: body, geschickt: true }
    }
}

/**
 * Reduziert eine offene Position um eine Teilmenge (Teilausstieg).
 *
 * Getrennt von `closeLivePosition`, weil die Gegenprobe eine andere ist: hier
 * darf die Position hinterher NICHT weg sein, sondern nur kleiner. Geprüft
 * wird deshalb die verbliebene Menge, nicht ihr Verschwinden.
 *
 * Die Menge wird auf die Schrittweite der Börse abgerundet — anders als beim
 * vollen Schliessen. Dort wäre ein Rest eine ungesicherte Position; hier ist
 * der Rest genau das Gewollte, und eine Menge mit zu vielen Nachkommastellen
 * lehnt die Börse ab.
 */
export async function reduziere({ symbol, direction, menge, mode }) {
    const kontomodus = mode === 'live' ? await holeKontomodus().catch(() => 'BUYSELL') : 'BUYSELL'
    const psym = await pionexSymbolFuer(symbol)
    const meta = await holeSymbolMeta(symbol).catch(() => null)
    const gerundet = rundeMenge(menge, meta?.stepSize)

    if (!(gerundet > 0)) {
        return { ok: false, reason: 'menge_zu_klein', request: null, geschickt: false }
    }
    if (meta?.minQty > 0 && gerundet < meta.minQty) {
        // Unter der Mindestmenge gibt es keinen Teilausstieg — lieber gar
        // keinen als einen, den die Börse ablehnt und den der nächste Takt
        // erneut versucht.
        return { ok: false, reason: 'unter_mindestmenge', request: null, geschickt: false }
    }

    const body = baueCloseOrder({ psym, direction, netSize: gerundet, kontomodus })

    if (mode !== 'live') {
        return { ok: true, request: body, response: null, geschickt: false, menge: gerundet }
    }

    const cfg = await keys()
    let antwort
    try {
        antwort = await pionexRequest('POST', PFAD_ORDER, cfg.apiKey, cfg.secretKey, {}, body)
    } catch (e) {
        return { ok: false, reason: `reduce_failed: ${e.message}`, request: body, geschickt: true }
    }
    if (!envelopeOk(antwort)) {
        return { ok: false, reason: antwort?.message || 'reduce_rejected', request: body, response: antwort, geschickt: true }
    }

    const orderId = String(antwort?.data?.orderId || '')
    const fill = orderId ? await holeFill({ symbol, orderId }).catch(() => null) : null
    return { ok: true, request: body, response: antwort, geschickt: true, menge: gerundet, fill }
}

/** Menge auf die Schrittweite der Börse abrunden. Ohne Schrittweite unverändert. */
export function rundeMenge(menge, stepSize) {
    const m = Math.abs(Number(menge) || 0)
    const st = Number(stepSize) || 0
    if (!(m > 0)) return 0
    if (!(st > 0)) return m
    const dec = Math.max(0, Math.round(-Math.log10(st)))
    return Number((Math.floor(m / st) * st).toFixed(dec))
}

/** Bis zu ~2 s nachschlagen, ob die Position wirklich weg ist. */
async function warteBisZu(symbol, direction, versuche = 3) {
    for (let i = 0; i < versuche; i++) {
        await new Promise((r) => setTimeout(r, 400 + i * 300))
        const liste = await holeOffenePositionen(symbol).catch(() => null)
        if (liste === null) continue           // Abruffehler ist kein Beweis für „zu"
        if (!liste.some((p) => p.direction === direction && p.qty > 0)) return true
    }
    return false
}

/** Storniert eine Order (z.B. die stehengebliebene Ziel-Limit-Order). */
export async function storniereOrder({ symbol, orderId, mode }) {
    if (mode !== 'live' || !orderId) return { ok: true, geschickt: false }
    const cfg = await keys()
    const psym = await pionexSymbolFuer(symbol)
    try {
        const a = await pionexRequest('DELETE', PFAD_ORDER, cfg.apiKey, cfg.secretKey, {},
            { symbol: psym, orderId: String(orderId) })
        return { ok: envelopeOk(a), response: a, geschickt: true }
    } catch (e) {
        // Eine Order, die es nicht mehr gibt, ist kein Fehler — sie ist weg.
        logWarn('execution/pionex', `Storno ${symbol}/${orderId}: ${e.message}`)
        return { ok: false, reason: e.message, geschickt: true }
    }
}

// ── Nachschlagen ─────────────────────────────────────────────────────────

/**
 * Echter Ausführungspreis und echte Gebühr einer Order.
 *
 * Das ist der Punkt, an dem Live besser ist als Papier: der Simulator trägt
 * einen geschätzten Einstieg ein, hier steht der Betrag, der wirklich bezahlt
 * wurde. Fills können der Order nachlaufen, deshalb mehrere Versuche.
 */
export async function holeFill({ symbol, orderId, versuche = 5 }) {
    const cfg = await keys()
    const psym = await pionexSymbolFuer(symbol)

    for (let i = 0; i < versuche; i++) {
        const r = await pionexRequest('GET', PFAD_FILLS_PER_ORDER, cfg.apiKey, cfg.secretKey,
            { symbol: psym, orderId: String(orderId) }).catch(() => null)
        const fills = r?.data?.fills || []
        if (fills.length) return fassFillsZusammen(fills)
        await new Promise((r2) => setTimeout(r2, 300))
    }
    return null
}

/**
 * Reiner Teil: Einzelausführungen → ein mengengewichteter Preis plus Kosten.
 *
 * Gebühren kommen als Betrag, nicht als Satz, und das Vorzeichen ist je nach
 * Rabattlage unterschiedlich — deshalb wird der Betrag genommen. Funding wird
 * getrennt geführt, weil `closePosition` es als eigenes Feld erwartet.
 */
export function fassFillsZusammen(fills) {
    let menge = 0
    let wert = 0
    let gebuehr = 0
    let funding = 0

    for (const f of Array.isArray(fills) ? fills : []) {
        const p = Number(f?.price) || 0
        const s = Math.abs(Number(f?.size) || 0)
        const art = String(f?.feeType || '').toUpperCase()
        const betrag = Math.abs(Number(f?.fee) || 0)
        if (art === 'FUNDING') { funding += betrag; continue }
        gebuehr += betrag
        if (p > 0 && s > 0) { menge += s; wert += p * s }
    }

    if (!(menge > 0)) return null
    return { price: wert / menge, qty: menge, fee: gebuehr, funding }
}

/**
 * Rekonstruiert den Ausstieg einer Position, die die Börse nicht mehr führt.
 *
 * Pionex liefert in `historyPositions` keinen fertigen Ausstiegspreis — nur
 * die Zahlungsströme. Der belastbare Weg führt deshalb über die Einzelfills im
 * Zeitfenster der Position, gefiltert auf die SCHLIESSENDE Seite: bei einem
 * Long ist das die Verkaufsseite.
 *
 * ⚠ Das Zeitfenster ist die schwache Stelle. Handelt der Nutzer im selben
 * Symbol von Hand, landen dessen Fills mit im Fenster. Deshalb wird nur bis zu
 * der Menge aufgesammelt, die unsere Position hatte, und ältere Fills zuerst —
 * mehr lässt sich ohne eine Order-Kennung nicht sauber trennen. Wo eine
 * Kennung vorliegt, ist `holeFill` der genauere Weg.
 */
export async function holeAusstieg({ symbol, direction, vonMs, bisMs, menge = 0 }) {
    const cfg = await keys()
    const psym = await pionexSymbolFuer(symbol)
    const gesucht = direction === 'long' ? 'SELL' : 'BUY'

    const r = await pionexRequest('GET', '/uapi/v1/trade/fills', cfg.apiKey, cfg.secretKey, {
        symbol: psym,
        startTime: Math.max(0, Number(vonMs) || 0),
        // `endTime` darf nicht in der Zukunft liegen, sonst lehnt Pionex ab.
        endTime: Math.min(Number(bisMs) || Date.now(), Date.now()),
        limit: 100,
    }).catch(() => null)

    const alle = (r?.data?.fills || [])
        .filter((f) => String(f?.side || '').toUpperCase() === gesucht)
        .sort((a, b) => (Number(a?.timestamp) || 0) - (Number(b?.timestamp) || 0))
    if (!alle.length) return null

    // Nur bis zur erwarteten Menge aufsammeln, damit fremde Handgriffe im
    // selben Symbol nicht in unsere Abrechnung rutschen.
    const genommen = []
    let summe = 0
    for (const f of alle) {
        genommen.push(f)
        summe += Math.abs(Number(f?.size) || 0)
        if (menge > 0 && summe >= menge * 0.999) break
    }

    const z = fassFillsZusammen(genommen)
    if (!z) return null
    return { ...z, zeit: Number(genommen[genommen.length - 1]?.timestamp) || 0 }
}

/** Eine Order über die deterministische clientOrderId nachschlagen. */
export async function holeOrderPerClientId({ symbol, clientOrderId }) {
    const cfg = await keys()
    const psym = await pionexSymbolFuer(symbol)
    const r = await pionexRequest('GET', PFAD_ORDER_PER_CLIENT, cfg.apiKey, cfg.secretKey,
        { symbol: psym, clientOrderId: String(clientOrderId) }).catch(() => null)
    const o = r?.data?.order || r?.data
    if (!o?.orderId) return null
    return {
        orderId: String(o.orderId),
        status: String(o.status || '').toUpperCase(),
        gefuellt: Math.abs(Number(o.filledSize ?? o.filledAmount ?? 0)) > 0,
        roh: o,
    }
}

export { holeSymbolMeta, holeMmr }
