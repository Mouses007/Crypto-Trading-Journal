/**
 * Dünner WebSocket-Wrapper für die öffentlichen Binance-Marktdaten-Streams.
 *
 * Verbindet direkt aus dem Browser (kein Server-Proxy nötig, Marktdaten sind
 * öffentlich). Ping/Pong beantwortet der Browser selbst — hier ist nichts zu tun.
 *
 * Wichtig: Backoff mit Jitter ist Pflicht, nicht Kür. Binance erlaubt ~300
 * Verbindungsversuche pro 5 Minuten und IP; eine ungebremste Reconnect-Schleife
 * handelt sich binnen Minuten eine Sperre ein.
 */

const MAX_BACKOFF_MS = 30000
const WATCHDOG_INTERVAL_MS = 2000
const SILENCE_LIMIT_MS = 10000
// Binance trennt hart nach 24 h — vorher selbst kontrolliert neu verbinden.
const PROACTIVE_RECONNECT_MS = 23 * 60 * 60 * 1000

export class BinanceStream {
    /**
     * @param {object} opts
     * @param {string} opts.url        vollständige wss-URL (kombinierter Stream)
     * @param {function} opts.onMessage  (parsedMessage) => void
     * @param {function} [opts.onOpen]   () => void  — hier gehört der Resync hin
     * @param {function} [opts.onStatus] ('connecting'|'open'|'closed'|'error', detail) => void
     * @param {number} [opts.silenceLimitMs] Stille bis zum erzwungenen Reconnect.
     *   0 schaltet den Watchdog ab — nötig für Streams, bei denen Stille der
     *   Normalfall ist (Liquidationen kommen pro Symbol nur alle paar Minuten;
     *   mit Watchdog würde sich die Verbindung dauernd selbst neu aufbauen).
     */
    constructor({ url, onMessage, onOpen, onStatus, silenceLimitMs = SILENCE_LIMIT_MS }) {
        this.url = url
        this.onMessage = onMessage
        this.onOpen = onOpen
        this.onStatus = onStatus
        this.silenceLimitMs = silenceLimitMs
        this.ws = null
        this.attempt = 0
        this.stopped = false
        this.lastMsgTs = 0
        this.reconnectTimer = null
        this.watchdogTimer = null
        this.lifetimeTimer = null
    }

    connect() {
        if (this.stopped) return
        this.onStatus?.('connecting')

        /*
         * Den alten Socket abhängen, BEVOR ein neuer entsteht.
         *
         * Ohne das kann eine zweite Verbindung neben einer noch schliessenden
         * laufen — etwa wenn der Watchdog einen Reconnect erzwingt, das
         * `close()` aber noch im Zustand CLOSING hängt. Beide Sockets zeigen
         * dann auf dasselbe `onmessage`, und dieselben Diffs kommen doppelt an.
         * Das fällt nicht als Fehler auf: das Buch verarbeitet sie klaglos, nur
         * die Mengen stimmen nicht mehr. Handler lösen, dann schliessen.
         */
        if (this.ws) {
            this.ws.onopen = null
            this.ws.onmessage = null
            this.ws.onerror = null
            this.ws.onclose = null
            try { this.ws.close() } catch (e) { /* war schon zu */ }
            this.ws = null
        }

        this.ws = new WebSocket(this.url)

        this.ws.onopen = () => {
            this.attempt = 0
            this.lastMsgTs = Date.now()
            this.onStatus?.('open')
            this.onOpen?.()
            this._startWatchdog()
            clearTimeout(this.lifetimeTimer)
            this.lifetimeTimer = setTimeout(() => this._forceReconnect('lifetime'), PROACTIVE_RECONNECT_MS)
        }

        this.ws.onmessage = (event) => {
            this.lastMsgTs = Date.now()
            let parsed
            try {
                parsed = JSON.parse(event.data)
            } catch (e) {
                return
            }
            this.onMessage(parsed)
        }

        this.ws.onerror = () => {
            // onerror liefert im Browser keine Details; das folgende onclose regelt den Rest
            try { this.ws?.close() } catch (e) { /* schon zu */ }
        }

        this.ws.onclose = () => {
            this._clearTimers()
            if (this.stopped) return
            this.onStatus?.('closed')
            this._scheduleReconnect()
        }
    }

    /** Verbindung beenden und alle Timer abräumen (onBeforeUnmount!). */
    stop() {
        this.stopped = true
        this._clearTimers()
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
        if (this.ws) {
            // Alle VIER lösen, wie es `connect()` beim Ersetzen schon tut.
            // `onopen` fehlte hier: liegt der Socket beim Beenden noch in
            // CONNECTING, feuert er danach trotzdem und ruft `onOpen` auf einem
            // längst für tot erklärten Feed — `stopped` schützt `connect()`,
            // nicht einen bereits gesetzten Handler.
            this.ws.onopen = null
            this.ws.onclose = null
            this.ws.onerror = null
            this.ws.onmessage = null
            try { this.ws.close() } catch (e) { /* egal */ }
            this.ws = null
        }
    }

    get isOpen() {
        return this.ws?.readyState === WebSocket.OPEN
    }

    _scheduleReconnect() {
        const base = Math.min(1000 * 2 ** this.attempt++, MAX_BACKOFF_MS)
        const delay = Math.round(base * (0.5 + Math.random()))   // Jitter gegen Thundering Herd
        console.log(`[live] Reconnect in ${delay} ms (Versuch ${this.attempt})`)
        this.reconnectTimer = setTimeout(() => this.connect(), delay)
    }

    /**
     * Fängt halbtote Sockets ab, die nach Standby oder Netzwechsel kein onclose
     * mehr feuern: kommt zu lange nichts, wird der Close erzwungen.
     */
    _startWatchdog() {
        clearInterval(this.watchdogTimer)
        if (!this.silenceLimitMs) return
        this.watchdogTimer = setInterval(() => {
            if (Date.now() - this.lastMsgTs > this.silenceLimitMs) this._forceReconnect('watchdog')
        }, WATCHDOG_INTERVAL_MS)
    }

    _forceReconnect(reason) {
        console.log(`[live] Erzwungener Reconnect (${reason})`)
        this._clearTimers()
        try { this.ws?.close() } catch (e) { /* egal */ }
    }

    /**
     * Alle Timer abräumen — auch den Reconnect-Timer.
     *
     * Er fehlte hier, und das war gefährlicher als es klingt: `_forceReconnect`
     * räumt auf und schliesst den Socket, worauf `onclose` einen neuen Versuch
     * plant. Lief zu diesem Zeitpunkt bereits ein geplanter Versuch, blieb er
     * bestehen — zwei Timer, zwei `connect()`, zwei Sockets. Alle Aufrufer
     * räumen VOR dem Planen auf, das Abräumen kann also nichts Gewolltes
     * zerstören.
     */
    _clearTimers() {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
        clearInterval(this.watchdogTimer)
        this.watchdogTimer = null
        clearTimeout(this.lifetimeTimer)
        this.lifetimeTimer = null
    }
}

/**
 * Binance hat die Futures-WebSockets zum 23.04.2026 auf geroutete Pfade
 * umgestellt: `/public` (Orderbuch, Trades, bookTicker), `/market` (aggTrade,
 * markPrice, kline, ticker, forceOrder) und `/private`. Wer die alte URL
 * weiterbenutzt, bekommt ausschliesslich `/public` — die Verbindung bleibt
 * dabei offen und meldet keinen Fehler, sie sendet einfach nichts.
 * Spot ist davon nicht betroffen und behält den bisherigen Pfad.
 */
const FUTURES_HOST = 'wss://fstream.binance.com'
const SPOT_HOST = 'wss://stream.binance.com:9443'

/**
 * Kombinierter Stream: Diff-Tiefe + Trades in EINER Verbindung.
 * Ein Socket statt zwei bedeutet: ein Backoff-Zustand, gemeinsamer Abriss (nie
 * Trades ohne Buch) und ein einziger Teardown beim Symbolwechsel. Beide gehören
 * zu `/public`, passen also in dieselbe Route.
 *
 * `@trade` statt `@aggTrade`: aggTrade liegt auf `/market` und bräuchte eine
 * zweite Verbindung — die für den Bookmap nötigen Felder (p, q, T, m) sind in
 * beiden identisch, und da wir ohnehin pro Zelle aggregieren, bringt der
 * aggregierte Stream keinen Vorteil.
 */
export function buildStreamUrl(symbol, market, depthInterval = '100ms') {
    const s = symbol.toLowerCase()
    const streams = `${s}@depth@${depthInterval}/${s}@trade`
    return market === 'spot'
        ? `${SPOT_HOST}/stream?streams=${streams}`
        : `${FUTURES_HOST}/public/stream?streams=${streams}`
}

/**
 * Zwangsliquidationen. Eigene Verbindung, weil `forceOrder` auf der
 * `/market`-Route liegt. Reisst sie ab, bleibt das Orderbuch davon unberührt —
 * die beiden Feeds sind bewusst entkoppelt. Spot kennt keine Liquidationen.
 */
export function buildLiquidationUrl(symbol, market) {
    if (market === 'spot') return null
    return `${FUTURES_HOST}/market/ws/${symbol.toLowerCase()}@forceOrder`
}
