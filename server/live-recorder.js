/**
 * Live-Recorder: schneidet das Binance-Orderbuch dauerhaft mit, damit man die
 * Heatmap später zu einem abgeschlossenen Trade nochmal ansehen kann.
 *
 * Läuft im Server, weil der Browser nicht aufzeichnen kann, wenn er zu ist.
 * Standardmässig AUS — ein Dauer-Stream darf nicht ungefragt laufen.
 *
 * Speicherformat: eine Zeile je Symbol und Stunde mit einem gzip-Blob.
 * Roh wären das ~414 MB pro Symbol und Tag; durch 1-Sekunden-Takt, ein
 * schmaleres Preisband, Uint8-Quantisierung und gzip landet man bei ~5 MB.
 * Der Preis dafür ist Auflösungsverlust — für eine Heatmap unkritisch, für
 * exakte Mengenanalysen nicht geeignet.
 */

import zlib from 'zlib'
import { promisify } from 'util'
import axios from 'axios'
import WebSocket from 'ws'
import { getKnex } from './database.js'
import { OrderBook } from '../shared/orderbook.js'
import { pickBucketSize, inferTickSize } from '../shared/priceBins.js'
import { logWarn, logError } from './logger.js'

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

const REST_BASE = { futures: 'https://fapi.binance.com', spot: 'https://api.binance.com' }
const REST_PATH = { futures: '/fapi/v1/depth', spot: '/api/v3/depth' }
const WS_BASE = {
    // Seit dem Binance-Umbau (23.04.2026) liegen Orderbuch-Streams auf /public
    futures: 'wss://fstream.binance.com/public/stream?streams=',
    spot: 'wss://stream.binance.com:9443/stream?streams=',
}
// forceOrder liegt auf der /market-Route, nicht auf /public
const LIQ_WS_BASE = 'wss://fstream.binance.com/market/ws/'

// Sammelstrom: nur diese Symbole werden gespeichert (deckungsgleich mit den
// Favoriten der Live-Analyse). Symbole mit eigenem Orderbuch-Recorder werden
// unabhängig davon immer mitgeschnitten.
const COLLECT_LIQ_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT'])

const MAGIC = 'CTJ1'
const HOUR_MS = 3600000
const RECONCILE_MS = 60000
// Zwischenspeichern der laufenden Stunde: kürzer = weniger Verlust bei einem
// Absturz und frischerer Vorlauf, länger = weniger Schreiblast.
const FLUSH_INTERVAL_MS = 30000
const RETENTION_MS = 6 * HOUR_MS
// Liquidationen werden viel länger aufgehoben als Orderbücher — sie sind winzig
// und nicht nachbestellbar (siehe runRetention).
const LIQ_RETENTION_DAYS = 365
const MAX_BACKOFF_MS = 60000
// Halbtote Sockets (Standby, Netzwechsel) feuern kein close. depth@100ms
// liefert praktisch pausenlos — längere Stille heisst toter Socket, der sonst
// ein eingefrorenes Buch stundenlang als „aktuelle" Liquidität aufzeichnet.
// Der Liquidations-Stream ist ausgenommen: dort ist Stille der Normalfall.
const SILENCE_LIMIT_MS = 10000
const WATCHDOG_INTERVAL_MS = 5000
// Farbskala sättigt bei 4× dem Bezugswert — dieselbe Kennlinie wie im Renderer,
// damit Aufzeichnung und Live-Ansicht gleich aussehen.
const QUANT_SATURATION = 4

/** Ein Recorder je Symbol. Hält Verbindung, Buch und den Stundenpuffer. */
class SymbolRecorder {
    constructor({ symbol, market, frameMs, rows, rangePct }) {
        this.symbol = symbol.toUpperCase()
        this.market = market
        this.frameMs = frameMs
        this.rows = rows
        this.rangePct = rangePct

        this.book = new OrderBook()
        this.ws = null
        // Zwangsliquidationen: eigene Verbindung, eigener Puffer, eigene Zeile
        this.liqWs = null
        this.liqEvents = []
        this.liqUnsaved = 0
        this.liqTotal = 0
        this.liqReconnect = null
        this.pending = []
        this.buffering = true
        this.tickSize = null
        this.bucketSize = null
        this.stopped = false
        this.attempt = 0
        this.applied = 0
        this.skipped = 0
        this.resyncs = 0

        this.hourStart = null
        this.cols = Math.max(1, Math.round(HOUR_MS / frameMs))
        this.data = null
        this.base = null
        this.mid = null
        this.quantRef = 0
        this.written = 0        // seit dem letzten Schreiben in die DB
        this.frames = 0         // insgesamt in dieser Stunde
        this.lastFrameTs = 0
        this.frameTimer = null
        this.flushTimer = null
        this.reconnectTimer = null
        this.snapshotTimer = null
        this.watchdogTimer = null
        this.lastMsgTs = 0
        // Fehlgeschlagene Upserts — beim nächsten Flush erneut versuchen
        this.pendingRows = []
        // Persistenz läuft seriell: Stundenwechsel-, Intervall- und Stop-Flush
        // dürfen sich nicht überlappen (siehe _flush)
        this._flushChain = Promise.resolve()
    }

    get isFutures() { return this.market === 'futures' }

    start() {
        this.stopped = false
        this._connect()
        this._connectLiquidations()
        this.frameTimer = setInterval(() => this._tick(), Math.max(100, this.frameMs / 2))
        // Nicht erst zur vollen Stunde schreiben: sonst ist die laufende Stunde
        // für die Wiedergabe und den Vorlauf unsichtbar, und ein Absturz würde
        // bis zu einer Stunde Aufzeichnung verlieren. Der Upsert schreibt die
        // Stunde jedes Mal komplett neu — idempotent und billig genug.
        this.flushTimer = setInterval(() => this._flush(), FLUSH_INTERVAL_MS)
        this.watchdogTimer = setInterval(() => this._checkSilence(), WATCHDOG_INTERVAL_MS)
    }

    async stop() {
        this.stopped = true
        clearInterval(this.frameTimer)
        clearInterval(this.flushTimer)
        clearInterval(this.watchdogTimer)
        clearTimeout(this.reconnectTimer)
        clearTimeout(this.snapshotTimer)
        this.frameTimer = this.flushTimer = this.watchdogTimer = this.reconnectTimer = this.snapshotTimer = null
        clearTimeout(this.liqReconnect)
        this.liqReconnect = null
        for (const sock of [this.ws, this.liqWs]) {
            if (!sock) continue
            sock.removeAllListeners()
            try { sock.close() } catch (e) { /* egal */ }
        }
        this.ws = this.liqWs = null
        await this._flush()   // angefangene Stunde nicht verlieren
    }

    // ── Verbindung + Buch ───────────────────────────────────

    /**
     * Zweite, entkoppelte Verbindung für Zwangsliquidationen.
     *
     * Der Grund, warum das mitgeschnitten wird: Binance gibt Liquidationen
     * nicht rückwirkend heraus (das Archiv hatte sie nur für Coin-M und hat
     * im Oktober 2024 aufgehört). Wer ein Modell gegen echte Liquidationen
     * prüfen will, muss sie selbst sammeln — und das kostet fast nichts,
     * ein paar Ereignisse je Minute und Symbol.
     *
     * Stille ist hier der Normalfall, deshalb kein Watchdog: eine Verbindung,
     * die minutenlang nichts sendet, ist gesund und darf nicht neu aufgebaut
     * werden.
     */
    _connectLiquidations() {
        if (this.stopped || !this.isFutures) return   // Spot kennt keine Liquidationen
        this.liqWs = new WebSocket(`${LIQ_WS_BASE}${this.symbol.toLowerCase()}@forceOrder`)

        this.liqWs.on('open', () => {
            console.log(` -> [recorder] ${this.symbol}: Liquidations-Stream verbunden`)
        })
        this.liqWs.on('message', (raw) => {
            let msg
            try { msg = JSON.parse(raw) } catch (e) { return }
            const o = (msg.data || msg).o
            if (!o) return
            // Kompakt als Array: Zeit, Preis, Menge, Seite (1 = Short liquidiert)
            this.liqEvents.push([
                Number(o.T),
                +(o.ap || o.p),
                +(o.l || o.q),
                o.S === 'BUY' ? 1 : 0,
            ])
            this.liqUnsaved++
        })
        this.liqWs.on('close', () => {
            if (this.stopped) return
            this.liqReconnect = setTimeout(() => this._connectLiquidations(), 5000 + Math.random() * 5000)
        })
        this.liqWs.on('error', () => { try { this.liqWs?.close() } catch (e) { /* egal */ } })
    }

    _connect() {
        if (this.stopped) return
        const stream = `${this.symbol.toLowerCase()}@depth@100ms`
        this.ws = new WebSocket(WS_BASE[this.market] + stream)

        this.ws.on('open', () => {
            this.attempt = 0
            this.lastMsgTs = Date.now()
            this._beginSync()
        })
        this.ws.on('message', (raw) => {
            this.lastMsgTs = Date.now()
            let msg
            try { msg = JSON.parse(raw) } catch (e) { return }
            const data = msg.data || msg
            if (data.e !== 'depthUpdate') return
            if (this.buffering) {
                this.pending.push(data)
                if (this.pending.length > 5000) this.pending.splice(0, this.pending.length - 5000)
                return
            }
            const result = this.book.applyDiff(data, this.isFutures)
            if (result === 'ok') this.applied++
            else if (result === 'skip') this.skipped++
            else { this.resyncs++; this._beginSync() }
        })
        this.ws.on('close', () => {
            if (this.stopped) return
            this.buffering = true
            const delay = Math.min(1000 * 2 ** this.attempt++, MAX_BACKOFF_MS) * (0.5 + Math.random())
            this.reconnectTimer = setTimeout(() => this._connect(), Math.round(delay))
        })
        this.ws.on('error', () => { try { this.ws?.close() } catch (e) { /* egal */ } })
    }

    /**
     * Erkennt eingefrorene Verbindungen: kommt auf dem Depth-Stream zu lange
     * nichts, wird der Socket hart beendet — das close löst Reconnect und
     * Resync aus. Ohne das schriebe der Recorder ein eingefrorenes Buch
     * beliebig lange als „aktuelle" Liquidität mit.
     */
    _checkSilence() {
        if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return
        const stille = Date.now() - this.lastMsgTs
        if (stille < SILENCE_LIMIT_MS) return
        logWarn('live-recorder', `${this.symbol}: ${Math.round(stille / 1000)} s Stille auf dem Depth-Stream — Verbindung wird neu aufgebaut`)
        try { this.ws.terminate() } catch (e) { /* egal */ }
    }

    _beginSync() {
        this.book.reset()
        this.pending.length = 0
        this.buffering = true
        clearTimeout(this.snapshotTimer)
        // Erst puffern, dann Snapshot — andersherum entsteht garantiert eine Lücke
        this.snapshotTimer = setTimeout(() => this._fetchSnapshot(), 250)
    }

    async _fetchSnapshot() {
        if (this.stopped) return
        try {
            const { data } = await axios.get(`${REST_BASE[this.market]}${REST_PATH[this.market]}`, {
                params: { symbol: this.symbol, limit: 1000 },
                timeout: 10000,
            })
            if (this.stopped) return
            this.book.applySnapshot(data)
            if (!this.tickSize) {
                const { mid } = this.book.bestPrices()
                this.tickSize = inferTickSize(data) || (mid ? mid * 1e-5 : 0.01)
            }
            for (const event of this.pending) {
                if (this.book.applyDiff(event, this.isFutures) === 'resync') { this._beginSync(); return }
            }
            this.pending.length = 0
            this.buffering = false
        } catch (error) {
            if (this.stopped) return
            logWarn('live-recorder', `Snapshot ${this.symbol} fehlgeschlagen`, error.message)
            this.snapshotTimer = setTimeout(() => this._fetchSnapshot(), 3000)
        }
    }

    // ── Aufzeichnung ────────────────────────────────────────

    _tick() {
        if (this.stopped || this.buffering || !this.book.synced) return
        const now = Date.now()
        const slot = Math.floor(now / this.frameMs) * this.frameMs
        if (slot === this.lastFrameTs) return
        this.lastFrameTs = slot

        const hour = Math.floor(slot / HOUR_MS) * HOUR_MS
        if (this.hourStart !== hour) {
            // Stundengrenze: _flush() fängt den fertigen Zustand SYNCHRON ein
            // (Kopie der Referenzen, bevor irgendein await läuft) — erst danach
            // öffnet _openHour den neuen Puffer. Früher lief der asynchrone
            // Flush-Teil NACH _openHour, sah written=0 und den frischen leeren
            // Puffer, und die letzten Sekunden jeder Stunde gingen dauerhaft
            // verloren.
            this._flush()
            this._openHour(hour)
        }
        this._writeFrame(slot)
    }

    _openHour(hour) {
        this.hourStart = hour
        this.data = new Uint8Array(this.cols * this.rows)
        this.base = new Int32Array(this.cols)
        this.mid = new Float64Array(this.cols)
        this.quantRef = 0
        this.written = 0
        this.frames = 0
        // Ereignisse der abgeschlossenen Stunden sind geschrieben — der Puffer
        // darf nicht unbegrenzt wachsen.
        this.liqTotal += this.liqEvents.filter(e => e[0] < hour).length
        this.liqEvents = this.liqEvents.filter(e => e[0] >= hour)
    }

    _writeFrame(slot) {
        const { mid } = this.book.bestPrices()
        if (!mid) return
        if (!this.bucketSize) {
            this.bucketSize = pickBucketSize(this.tickSize, mid, this.rangePct, this.rows)
        }
        const col = Math.min(this.cols - 1, Math.floor((slot - this.hourStart) / this.frameMs))
        const offset = col * this.rows
        const bs = this.bucketSize
        const base = Math.round(mid / bs) - (this.rows >> 1)

        // Erst roh einsammeln — der Quantisierungs-Bezug steht evtl. noch nicht fest
        const raw = new Float64Array(this.rows)
        for (const [price, qty] of this.book.bids) {
            const r = Math.round(price / bs) - base
            if (r >= 0 && r < this.rows) raw[r] += qty
        }
        for (const [price, qty] of this.book.asks) {
            const r = Math.round(price / bs) - base
            if (r >= 0 && r < this.rows) raw[r] += qty
        }

        if (!this.quantRef) this.quantRef = percentile95(raw)

        const ref = this.quantRef || 1
        const invLog = 1 / Math.log1p(QUANT_SATURATION)
        for (let r = 0; r < this.rows; r++) {
            const v = raw[r]
            if (v <= 0) continue
            const t = Math.log1p(v / ref) * invLog
            this.data[offset + r] = t >= 1 ? 255 : Math.max(1, (t * 255) | 0)
        }
        this.base[col] = base
        this.mid[col] = mid
        this.written++
        this.frames++
    }

    /**
     * Schreibt Heatmap- und Liquidations-Puffer weg (per Upsert).
     *
     * Der Zustand wird SYNCHRON eingefangen, bevor der erste await läuft —
     * der Stundenwechsel in _tick() öffnet unmittelbar nach diesem Aufruf den
     * neuen Puffer, und ohne Kopie schriebe der asynchrone Teil die frische,
     * leere Stunde statt der fertigen. Persistiert wird seriell über eine
     * Kette, damit sich Stundenwechsel-, Intervall- und Stop-Flush nicht
     * überlappen. Fehlgeschlagene Upserts landen in pendingRows und werden
     * beim nächsten Flush erneut versucht statt verworfen.
     */
    _flush() {
        const heat = this._captureHeat()
        const liq = this._captureLiquidations()
        if (!heat && !liq && !this.pendingRows.length) return this._flushChain
        this._flushChain = this._flushChain
            .then(() => this._persist(heat, liq))
            .catch(e => logError('live-recorder', `Flush ${this.symbol} fehlgeschlagen`, e))
        return this._flushChain
    }

    _captureHeat() {
        if (!this.data || !this.written) return null
        // Referenzen genügen: _openHour ersetzt die Arrays, statt sie zu
        // leeren — die eingefangene Stunde bleibt damit unangetastet.
        const heat = {
            hourStart: this.hourStart, bucketSize: this.bucketSize,
            quantRef: this.quantRef, base: this.base, mid: this.mid,
            data: this.data, written: this.written,
        }
        this.written = 0
        return heat
    }

    _captureLiquidations() {
        if (!this.liqUnsaved || !this.hourStart) return null
        this.liqUnsaved = 0
        // Kompletten Bestand mitnehmen — _persist gruppiert nach Stunde. So
        // gehen Ereignisse der Vorstunde nicht verloren, wenn der Stunden-
        // wechsel zwischen zwei Flushes lag (der Upsert ist dedupliziert und
        // damit idempotent).
        return this.liqEvents.slice()
    }

    async _persist(heat, liq) {
        const knex = getKnex()
        const rows = []

        if (liq?.length) {
            // Nach Stunde gruppieren und mit dem DB-Bestand zusammenführen
            // (Fingerprint-Dedup in buildLiqRow): ein Voll-Rewrite würde sonst
            // Ereignisse überschreiben, die der Sammelstrom vor der Übernahme
            // dieses Symbols bereits für dieselbe Stunde gespeichert hat.
            const gruppen = new Map()
            for (const e of liq) {
                const stunde = hourFloor(e[0])
                let g = gruppen.get(stunde)
                if (!g) gruppen.set(stunde, g = [])
                g.push(e)
            }
            for (const [stunde, events] of gruppen) {
                try {
                    rows.push(await buildLiqRow(knex, this.symbol, this.market, stunde, events))
                } catch (error) {
                    logWarn('live-recorder', `Liquidationen ${this.symbol} vorbereiten fehlgeschlagen`, error.message)
                }
            }
        }

        if (heat) {
            try {
                const payload = await gzip(serializeHour({
                    symbol: this.symbol, market: this.market, hourStart: heat.hourStart,
                    frameMs: this.frameMs, rows: this.rows, cols: this.cols,
                    bucketSize: heat.bucketSize, quantRef: heat.quantRef,
                    base: heat.base, mid: heat.mid, data: heat.data,
                }))
                rows.push({
                    symbol: this.symbol, market: this.market, kind: 'heat',
                    hourStart: heat.hourStart, frameMs: this.frameMs, rows: this.rows,
                    cols: this.cols, bucketSize: heat.bucketSize, quantRef: heat.quantRef,
                    bytes: payload.length, payload, createdAt: Date.now(),
                })
                console.log(` -> [recorder] ${this.symbol} ${new Date(heat.hourStart).toISOString().slice(0, 13)}h: ${heat.written} Frames, ${(payload.length / 1024).toFixed(0)} kB`)
            } catch (error) {
                logError('live-recorder', `Serialisieren ${this.symbol} fehlgeschlagen`, error)
            }
        }

        // Fehlgeschlagene Zeilen vom letzten Mal zuerst — neue Zeilen derselben
        // Stunde folgen danach und tragen den volleren Stand.
        const anstehend = [...this.pendingRows, ...rows]
        this.pendingRows = []
        for (const row of anstehend) {
            try {
                await knex('live_recordings')
                    .insert(row)
                    .onConflict(['symbol', 'market', 'kind', 'hourStart'])
                    .merge()
            } catch (error) {
                this.pendingRows.push(row)
                logError('live-recorder', `Speichern ${this.symbol} fehlgeschlagen — nächster Flush versucht es erneut`, error)
            }
        }
        // Deckel gegen dauerhaft kaputte DB — die neuesten Zeilen behalten
        if (this.pendingRows.length > 6) this.pendingRows = this.pendingRows.slice(-6)
    }
}


/**
 * Sammelstrom für Zwangsliquidationen über eine einzige Verbindung
 * (`!forceOrder@arr`) — gespeichert werden davon nur die Top-Symbole.
 *
 * Der Stream selbst lässt sich nicht filtern (Binance liefert immer alle
 * Symbole), aber der Vollmitschnitt sammelte hunderte Kleinst-Symbole an,
 * die niemand je ansieht — deshalb wird vor dem Puffern auf die Top-Liste
 * gefiltert (Entscheid 14.08.2026).
 *
 * Warum getrennt vom SymbolRecorder: Liquidationen sind winzig (wenige Byte je
 * Ereignis), das Orderbuch dagegen kostet ~7 MB je Symbol und Tag. An den
 * Heatmap-Recorder gekoppelt müsste man also fünf Orderbücher mitschreiben,
 * um fünf Symbole Liquidationen zu bekommen.
 *
 * Der Zweck ist Vergleichsmaterial: Binance gibt Liquidationen nicht
 * rückwirkend heraus, wer ein Modell dagegen prüfen will, muss selbst sammeln.
 *
 * Geschrieben wird in dieselbe Tabelle und Sorte (`kind: 'liq'`) wie beim
 * SymbolRecorder, damit `/api/live/liquidations` unverändert funktioniert.
 * Damit sich beide nicht gegenseitig überschreiben, überlässt der Kollektor
 * jedes Symbol, für das gerade ein SymbolRecorder läuft, diesem.
 */
class MarketLiquidationCollector {
    constructor() {
        this.ws = null
        this.stopped = false
        this.reconnect = null
        this.flushTimer = null
        this.buffers = new Map()   // SYMBOL -> [[t, preis, menge, seite], …]
        this.gesamt = 0
        this.seitStart = Date.now()
        this.letztes = 0
    }

    start() {
        this.stopped = false
        this._connect()
        this.flushTimer = setInterval(() => this._flush().catch(() => {}), FLUSH_INTERVAL_MS)
    }

    /**
     * Stille ist auch hier der Normalfall (nachts kann es marktweit ruhig sein),
     * deshalb kein Watchdog — nur Neuverbinden nach einem echten `close`.
     */
    _connect() {
        if (this.stopped) return
        this.ws = new WebSocket(`${LIQ_WS_BASE}!forceOrder@arr`)

        this.ws.on('open', () => {
            console.log(' -> [recorder] Sammelstrom Liquidationen (alle Symbole) verbunden')
        })
        this.ws.on('message', (raw) => {
            let msg
            try { msg = JSON.parse(raw) } catch (e) { return }
            // Der Sammelstrom liefert je nach Route ein Einzelobjekt oder ein Array
            const liste = Array.isArray(msg) ? msg : [msg.data || msg]
            for (const eintrag of liste) {
                const o = eintrag?.o
                if (!o?.s) continue
                const symbol = String(o.s).toUpperCase()
                // Nur Top-Symbole speichern — der Rest ist Tabellen-Müll
                if (!COLLECT_LIQ_SYMBOLS.has(symbol)) continue
                // Symbole mit eigenem Recorder gehören diesem — der schneidet
                // denselben Stream ohnehin mit.
                if (active.has(`${symbol}|futures`)) continue

                const t = Number(o.T)
                const preis = +(o.ap || o.p)
                const menge = +(o.l || o.q)
                if (!Number.isFinite(t) || !Number.isFinite(preis) || !Number.isFinite(menge)) continue

                let puffer = this.buffers.get(symbol)
                if (!puffer) this.buffers.set(symbol, puffer = [])
                puffer.push([t, preis, menge, o.S === 'BUY' ? 1 : 0])
                this.gesamt++
                this.letztes = t
            }
        })
        this.ws.on('close', () => {
            if (this.stopped) return
            this.reconnect = setTimeout(() => this._connect(), 5000 + Math.random() * 5000)
        })
        this.ws.on('error', () => { try { this.ws?.close() } catch (e) { /* egal */ } })
    }

    /**
     * Schreibt je Symbol und Stunde eine Zeile. Ein Flush kann Ereignisse aus
     * zwei Stunden enthalten (wenn die Stundengrenze dazwischen lag), deshalb
     * wird nach `hourFloor` gruppiert statt eine „aktuelle Stunde" anzunehmen.
     */
    async _flush() {
        if (!this.buffers.size) return
        const puffer = this.buffers
        this.buffers = new Map()

        // (symbol, stunde) -> Ereignisse. Bewusst KEIN Verwerfen für Symbole,
        // die inzwischen ein eigener Recorder übernommen hat: die gepufferten
        // Ereignisse stammen von VOR der Übernahme, und der Recorder merged
        // seinerseits per buildLiqRow gegen den DB-Bestand — nichts geht
        // verloren, nichts wird doppelt (Fingerprint-Dedup).
        const gruppen = new Map()
        for (const [symbol, events] of puffer) {
            for (const e of events) {
                const stunde = hourFloor(e[0])
                const key = `${symbol}|${stunde}`
                let g = gruppen.get(key)
                if (!g) gruppen.set(key, g = { symbol, stunde, events: [] })
                g.events.push(e)
            }
        }
        if (!gruppen.size) return

        const knex = getKnex()
        let zeilen = 0
        let bytes = 0
        for (const { symbol, stunde, events } of gruppen.values()) {
            try {
                const row = await buildLiqRow(knex, symbol, 'futures', stunde, events)
                await knex('live_recordings')
                    .insert(row)
                    .onConflict(['symbol', 'market', 'kind', 'hourStart'])
                    .merge()
                zeilen++
                bytes += row.bytes
            } catch (error) {
                // Nicht verwerfen: zurück in den Puffer, der nächste Flush
                // versucht es erneut (Dedup macht das idempotent).
                let zurueck = this.buffers.get(symbol)
                if (!zurueck) this.buffers.set(symbol, zurueck = [])
                zurueck.push(...events)
                if (zurueck.length > 5000) zurueck.splice(0, zurueck.length - 5000)
                logWarn('live-recorder', `Sammelstrom ${symbol} speichern fehlgeschlagen — wird erneut versucht`, error.message)
            }
        }
        if (zeilen) {
            console.log(` -> [recorder] Sammelstrom: ${zeilen} Symbol-Stunden aktualisiert, ${(bytes / 1024).toFixed(0)} kB`)
        }
    }

    async stop() {
        this.stopped = true
        clearInterval(this.flushTimer)
        clearTimeout(this.reconnect)
        try { this.ws?.close() } catch (e) { /* egal */ }
        await this._flush().catch(() => {})
    }
}

/**
 * Fingerprint-Dedup für Liquidations-Ereignisse. Binance vergibt für
 * forceOrder keine eigene ID — Zeit|Preis|Menge|Seite ist das engste
 * verfügbare Kennzeichen. Zwei ECHTE identische Ereignisse in derselben
 * Millisekunde fielen damit zusammen; praktisch ausgeschlossen, da der
 * Stream ohnehin auf 1 Ereignis/s/Symbol gedrosselt ist.
 */
function dedupLiquidations(events) {
    const seen = new Set()
    const out = []
    for (const e of events) {
        const key = `${e[0]}|${e[1]}|${e[2]}|${e[3]}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(e)
    }
    return out
}

/**
 * Liquidations-Zeile für (symbol, stunde) bauen: DB-Bestand lesen, neue
 * Ereignisse dazulegen, deduplizieren, sortieren. Beide Schreiber
 * (SymbolRecorder und Sammelstrom) gehen über diesen Weg — ein blinder
 * Voll-Rewrite würde sonst die Ereignisse des jeweils anderen überschreiben.
 */
async function buildLiqRow(knex, symbol, market, stunde, events) {
    const vorhanden = await knex('live_recordings')
        .where({ symbol, market, kind: 'liq', hourStart: stunde })
        .first()
    let alle = events
    if (vorhanden?.payload) {
        const alt = JSON.parse((await gunzip(vorhanden.payload)).toString('utf8'))
        alle = alt.concat(events)
    }
    alle = dedupLiquidations(alle)
    alle.sort((a, b) => a[0] - b[0])
    const payload = await gzip(Buffer.from(JSON.stringify(alle), 'utf8'))
    return {
        symbol, market, kind: 'liq', hourStart: stunde,
        frameMs: 0, rows: 0, cols: alle.length, bucketSize: 0, quantRef: 0,
        bytes: payload.length, payload, createdAt: Date.now(),
    }
}

function percentile95(values) {
    const nonZero = []
    for (let i = 0; i < values.length; i++) if (values[i] > 0) nonZero.push(values[i])
    if (!nonZero.length) return 0
    nonZero.sort((a, b) => a - b)
    return nonZero[Math.floor(nonZero.length * 0.95)] || nonZero[nonZero.length - 1]
}

/** Kopf (JSON) + Basis-Buckets + Mid-Kurve + quantisierte Matrix. */
export function serializeHour(h) {
    const header = Buffer.from(JSON.stringify({
        symbol: h.symbol, market: h.market, hourStart: h.hourStart, frameMs: h.frameMs,
        rows: h.rows, cols: h.cols, bucketSize: h.bucketSize, quantRef: h.quantRef,
        saturation: QUANT_SATURATION,
    }), 'utf8')
    const out = Buffer.alloc(4 + 4 + header.length + h.cols * 4 + h.cols * 8 + h.cols * h.rows)
    let p = 0
    out.write(MAGIC, p, 'ascii'); p += 4
    out.writeUInt32LE(header.length, p); p += 4
    header.copy(out, p); p += header.length
    for (let i = 0; i < h.cols; i++) { out.writeInt32LE(h.base[i], p); p += 4 }
    for (let i = 0; i < h.cols; i++) { out.writeDoubleLE(h.mid[i], p); p += 8 }
    Buffer.from(h.data.buffer, h.data.byteOffset, h.data.length).copy(out, p)
    return out
}

export function deserializeHour(buf) {
    if (buf.toString('ascii', 0, 4) !== MAGIC) throw new Error('Unbekanntes Aufzeichnungsformat')
    const headerLen = buf.readUInt32LE(4)
    const header = JSON.parse(buf.toString('utf8', 8, 8 + headerLen))
    let p = 8 + headerLen
    const base = new Int32Array(header.cols)
    for (let i = 0; i < header.cols; i++) { base[i] = buf.readInt32LE(p); p += 4 }
    const mid = new Float64Array(header.cols)
    for (let i = 0; i < header.cols; i++) { mid[i] = buf.readDoubleLE(p); p += 8 }
    const data = new Uint8Array(buf.subarray(p, p + header.cols * header.rows))
    return { ...header, base, mid, data }
}

export async function decodeRecording(payload) {
    return deserializeHour(await gunzip(payload))
}

const hourFloor = (ts) => Math.floor(ts / HOUR_MS) * HOUR_MS

/**
 * Schneidet mehrere Stundenblöcke auf [from, to] zu und hängt sie aneinander.
 *
 * Die Quantisierung ist pro Stunde auf einen eigenen Bezugswert normiert.
 * Damit der Client eine einheitliche Skala bekommt, werden spätere Blöcke auf
 * den Bezug des ersten umgerechnet. Unterschiedliche Bucket-Grössen lassen sich
 * dagegen nicht zusammenführen — dort bricht die Ausgabe ab und meldet das.
 */
async function sliceRange(rows, from, to) {
    const first = await decodeRecording(rows[0].payload)
    const frameMs = first.frameMs
    const rowCount = first.rows
    const bucketSize = first.bucketSize
    const quantRef = first.quantRef
    const startTs = Math.floor(from / frameMs) * frameMs
    const cols = Math.min(Math.ceil((to - startTs) / frameMs), 6 * HOUR_MS / frameMs)

    const data = new Uint8Array(cols * rowCount)
    const base = new Int32Array(cols)
    const mid = new Float64Array(cols)
    let truncated = false

    for (const row of rows) {
        const hour = row.hourStart === rows[0].hourStart ? first : await decodeRecording(row.payload)
        if (hour.rows !== rowCount || hour.bucketSize !== bucketSize || hour.frameMs !== frameMs) {
            truncated = 'Auflösung wurde während des Zeitraums geändert'
            break
        }
        // Wenn der Bezugswert abweicht, auf den ersten umrechnen
        const scale = hour.quantRef / quantRef
        for (let c = 0; c < hour.cols; c++) {
            const ts = Number(row.hourStart) + c * frameMs
            const target = Math.round((ts - startTs) / frameMs)
            if (target < 0 || target >= cols) continue
            if (!hour.mid[c]) continue
            base[target] = hour.base[c]
            mid[target] = hour.mid[c]
            const src = c * rowCount
            const dst = target * rowCount
            if (scale === 1) {
                data.set(hour.data.subarray(src, src + rowCount), dst)
            } else {
                for (let r = 0; r < rowCount; r++) {
                    const v = hour.data[src + r]
                    data[dst + r] = v ? requantize(v, scale) : 0
                }
            }
        }
    }
    return { startTs, frameMs, rows: rowCount, cols, bucketSize, quantRef, base, mid, data, truncated }
}

/** Uint8 mit fremdem Bezugswert auf den Zielbezug umrechnen. */
function requantize(value, scale) {
    const logMax = Math.log1p(QUANT_SATURATION)
    const qty = Math.expm1((value / 255) * logMax) * scale
    const t = Math.log1p(qty) / logMax
    return t >= 1 ? 255 : Math.max(1, (t * 255) | 0)
}

// ── Verwaltung ──────────────────────────────────────────────

const active = new Map()   // "SYMBOL|market" -> SymbolRecorder
let collector = null       // MarketLiquidationCollector, wenn eingeschaltet
let reconcileTimer = null
let retentionTimer = null

async function readConfig() {
    const knex = getKnex()
    const row = await knex('settings').where({ id: 1 }).first()
    const symbols = String(row?.liveRecordSymbols || '')
        .split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    return {
        enabled: !!Number(row?.liveRecordEnabled),
        // bewusst unabhängig von `enabled`: der Sammelstrom kostet kaum Speicher
        // und ist auch ohne Orderbuch-Aufzeichnung sinnvoll
        allLiq: !!Number(row?.liveRecordAllLiq),
        // FEST auf Futures — bewusst NICHT an `liveMarket` gekoppelt. Diese
        // Einstellung steuert, was man gerade anschaut; ein kurzer Blick auf
        // Spot hatte sonst die laufende Futures-Aufzeichnung beendet und ein
        // Loch in die Historie gerissen. Spot ist für dieses Journal ohnehin
        // nicht relevant.
        market: 'futures',
        symbols: [...new Set(symbols)].slice(0, 10),   // Deckel gegen Versehen
        days: Number(row?.liveRecordDays) || 14,
        frameMs: Number(row?.liveRecordFrameMs) || 1000,
        rows: Number(row?.liveRecordRows) || 200,
        rangePct: Number(row?.liveRecordRangePct) || 1,
    }
}

/**
 * Gleicht die laufenden Recorder mit den Einstellungen ab. Läuft periodisch,
 * damit eine Änderung in den Einstellungen ohne Neustart greift.
 */
async function reconcile() {
    let config
    try { config = await readConfig() } catch (e) { return }

    const wanted = new Map()
    if (config.enabled) {
        for (const symbol of config.symbols) {
            wanted.set(`${symbol}|${config.market}`, { symbol, market: config.market, ...config })
        }
    }

    for (const [key, recorder] of active) {
        const target = wanted.get(key)
        const unchanged = target && recorder.frameMs === target.frameMs
            && recorder.rows === target.rows && recorder.rangePct === target.rangePct
        if (unchanged) continue
        active.delete(key)
        await recorder.stop()
        console.log(` -> [recorder] gestoppt: ${recorder.symbol}`)
    }

    for (const [key, target] of wanted) {
        if (active.has(key)) continue
        const recorder = new SymbolRecorder(target)
        active.set(key, recorder)
        recorder.start()
        console.log(` -> [recorder] gestartet: ${target.symbol} (${target.frameMs} ms, ${target.rows} Zeilen)`)
    }

    if (config.allLiq && !collector) {
        collector = new MarketLiquidationCollector()
        collector.start()
    } else if (!config.allLiq && collector) {
        const alt = collector
        collector = null
        await alt.stop()
        console.log(' -> [recorder] Sammelstrom Liquidationen gestoppt')
    }
}

async function runRetention() {
    try {
        const { days } = await readConfig()
        const knex = getKnex()

        // Orderbuch-Aufzeichnungen sind gross (~7 MB je Symbol und Tag) und
        // folgen der eingestellten Aufbewahrung.
        const cutoff = Date.now() - days * 24 * HOUR_MS
        const deleted = await knex('live_recordings')
            .where('hourStart', '<', cutoff).andWhere('kind', 'heat').del()
        if (deleted) console.log(` -> [recorder] ${deleted} alte Aufzeichnungen gelöscht (älter als ${days} Tage)`)

        // Liquidationen sind winzig und der eigentliche Wert der Sammlung:
        // Binance gibt sie nicht rückwirkend heraus, einmal weggeworfen sind
        // sie endgültig weg. Deshalb eine eigene, viel längere Aufbewahrung.
        const liqCutoff = Date.now() - LIQ_RETENTION_DAYS * 24 * HOUR_MS
        const liqDeleted = await knex('live_recordings')
            .where('hourStart', '<', liqCutoff).andWhere('kind', 'liq').del()
        if (liqDeleted) console.log(` -> [recorder] ${liqDeleted} alte Liquidations-Stunden gelöscht (älter als ${LIQ_RETENTION_DAYS} Tage)`)
    } catch (error) {
        logWarn('live-recorder', 'Aufräumen fehlgeschlagen', error.message)
    }
}

export function setupLiveRecorder(app) {
    /** Status + Speicherverbrauch je Symbol. */
    app.get('/api/live/recorder/status', async (req, res) => {
        try {
            const knex = getKnex()
            const rows = await knex('live_recordings')
                .select('symbol', 'market')
                .count({ hours: 'id' })
                .sum({ bytes: 'bytes' })
                .min({ von: 'hourStart' })
                .max({ bis: 'hourStart' })
                .groupBy('symbol', 'market')
            res.json({
                laufend: [...active.values()].map(r => ({
                    symbol: r.symbol, market: r.market, frameMs: r.frameMs, rows: r.rows,
                    verbunden: r.ws?.readyState === WebSocket.OPEN,
                    synchron: r.book.synced,
                    framesInStunde: r.frames,
                    ungespeichert: r.written,
                    liquidationen: { inStunde: r.liqEvents.length, gesamt: r.liqTotal + r.liqEvents.length,
                        verbunden: r.liqWs?.readyState === WebSocket.OPEN },
                    mid: r.book.bestPrices().mid,
                    diffs: { angewandt: r.applied, verworfen: r.skipped, resyncs: r.resyncs },
                })),
                sammelstrom: collector ? {
                    verbunden: collector.ws?.readyState === WebSocket.OPEN,
                    ereignisse: collector.gesamt,
                    symbole: collector.buffers.size,
                    seit: collector.seitStart,
                    letztes: collector.letztes || null,
                } : null,
                gespeichert: rows.map(r => ({
                    symbol: r.symbol, market: r.market,
                    stunden: Number(r.hours), bytes: Number(r.bytes || 0),
                    von: Number(r.von), bis: Number(r.bis),
                })),
            })
        } catch (error) {
            logError('live-recorder', 'Status fehlgeschlagen', error)
            res.status(500).json({ error: 'Status konnte nicht gelesen werden' })
        }
    })

    /**
     * Welche Zeiträume liegen für ein Symbol vor? Das Journal braucht das, um
     * den Knopf „Orderbuch zum Trade" nur dann anzubieten, wenn es auch Daten
     * gibt — sonst klickt man ins Leere.
     */
    app.get('/api/live/recorder/available', async (req, res) => {
        try {
            const symbol = String(req.query.symbol || '').toUpperCase()
            const market = req.query.market === 'spot' ? 'spot' : 'futures'
            if (!symbol) return res.status(400).json({ error: 'symbol ist erforderlich' })

            const query = getKnex()('live_recordings')
                .select('hourStart', 'cols', 'frameMs', 'bytes')
                .where({ symbol, market, kind: 'heat' })
                .orderBy('hourStart')
            if (req.query.from) query.where('hourStart', '>=', hourFloor(Number(req.query.from)))
            if (req.query.to) query.where('hourStart', '<=', hourFloor(Number(req.query.to)))

            const rows = await query
            res.json({
                symbol, market,
                stunden: rows.map(r => ({
                    von: Number(r.hourStart), bis: Number(r.hourStart) + HOUR_MS,
                    frameMs: r.frameMs, bytes: r.bytes,
                })),
            })
        } catch (error) {
            logError('live-recorder', 'Verfügbarkeit fehlgeschlagen', error)
            res.status(500).json({ error: 'Verfügbare Zeiträume konnten nicht gelesen werden' })
        }
    })

    /**
     * Aufzeichnung für ein Zeitfenster. Der Server schneidet auf den
     * angefragten Bereich zu und fügt Stundenblöcke zusammen — der Client
     * bekommt einen zusammenhängenden Block statt roher Stunden.
     */
    app.get('/api/live/replay', async (req, res) => {
        try {
            const symbol = String(req.query.symbol || '').toUpperCase()
            const market = req.query.market === 'spot' ? 'spot' : 'futures'
            const from = Number(req.query.from)
            const to = Number(req.query.to)
            if (!symbol) return res.status(400).json({ error: 'symbol ist erforderlich' })
            if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
                return res.status(400).json({ error: 'from und to müssen gültige Zeitstempel (ms) sein, from < to' })
            }
            if (to - from > 6 * HOUR_MS) {
                return res.status(400).json({ error: 'Zeitfenster zu gross (max. 6 Stunden)' })
            }

            const rows = await getKnex()('live_recordings')
                .where({ symbol, market, kind: 'heat' })
                .andWhere('hourStart', '>=', hourFloor(from))
                .andWhere('hourStart', '<=', hourFloor(to))
                .orderBy('hourStart')

            if (!rows.length) return res.json({ symbol, market, cols: 0, hinweis: 'Für diesen Zeitraum wurde nichts aufgezeichnet' })

            const block = await sliceRange(rows, from, to)
            // Die Matrix ist zum grössten Teil leer und damit extrem gut
            // komprimierbar — roh wären es cols × rows Bytes plus ein Drittel
            // Base64-Aufschlag. Der Browser packt sie per DecompressionStream aus.
            const packed = await gzip(Buffer.from(block.data.buffer, block.data.byteOffset, block.data.length))
            res.setHeader('Cache-Control', 'private, max-age=60')
            res.json({
                symbol, market,
                startTs: block.startTs, frameMs: block.frameMs, rows: block.rows, cols: block.cols,
                bucketSize: block.bucketSize, quantRef: block.quantRef, saturation: QUANT_SATURATION,
                base: Array.from(block.base),
                mid: Array.from(block.mid),
                encoding: 'gzip+base64',
                data: packed.toString('base64'),
                abgeschnitten: block.truncated || undefined,
            })
        } catch (error) {
            logError('live-recorder', 'Wiedergabe fehlgeschlagen', error)
            res.status(500).json({ error: 'Aufzeichnung konnte nicht geladen werden' })
        }
    })

    /**
     * Aufgezeichnete Zwangsliquidationen für ein Zeitfenster.
     * Wahrheitsquelle für die Modellprüfung — Binance gibt sie nicht
     * rückwirkend heraus, deshalb sammeln wir selbst.
     */
    app.get('/api/live/liquidations', async (req, res) => {
        try {
            const symbol = String(req.query.symbol || '').toUpperCase()
            const market = req.query.market === 'spot' ? 'spot' : 'futures'
            const from = Number(req.query.from)
            const to = Number(req.query.to)
            if (!symbol) return res.status(400).json({ error: 'symbol ist erforderlich' })
            if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
                return res.status(400).json({ error: 'from und to müssen gültige Zeitstempel (ms) sein, from < to' })
            }

            const rows = await getKnex()('live_recordings')
                .where({ symbol, market, kind: 'liq' })
                .andWhere('hourStart', '>=', hourFloor(from))
                .andWhere('hourStart', '<=', hourFloor(to))
                .orderBy('hourStart')

            const events = []
            for (const row of rows) {
                const roh = JSON.parse((await gunzip(row.payload)).toString('utf8'))
                for (const e of roh) {
                    if (e[0] >= from && e[0] <= to) {
                        events.push({ t: e[0], price: e[1], qty: e[2], isBuy: !!e[3] })
                    }
                }
            }
            events.sort((a, b) => a.t - b.t)
            res.json({ symbol, market, anzahl: events.length, events })
        } catch (error) {
            logError('live-recorder', 'Liquidationen lesen fehlgeschlagen', error)
            res.status(500).json({ error: 'Liquidationen konnten nicht gelesen werden' })
        }
    })

    /** Einstellungen sofort übernehmen, ohne auf den Abgleich zu warten. */
    app.post('/api/live/recorder/reload', async (req, res) => {
        await reconcile()
        res.json({ ok: true, laufend: active.size })
    })

    reconcile().catch(e => logError('live-recorder', 'Start fehlgeschlagen', e))
    reconcileTimer = setInterval(() => reconcile().catch(() => {}), RECONCILE_MS)
    runRetention()
    retentionTimer = setInterval(runRetention, RETENTION_MS)
    console.log(' -> Live-Recorder bereit')
}

/** Für sauberes Herunterfahren (angefangene Stunde sichern). */
export async function stopLiveRecorder() {
    clearInterval(reconcileTimer)
    clearInterval(retentionTimer)
    for (const recorder of active.values()) await recorder.stop()
    active.clear()
    if (collector) { const alt = collector; collector = null; await alt.stop() }
}
