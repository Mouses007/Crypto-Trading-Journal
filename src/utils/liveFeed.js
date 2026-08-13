/**
 * Orchestriert die Live-Datenschicht der Heatmap:
 * WebSocket + Orderbuch-Sync + Frame-Takt + Ringpuffer.
 *
 * Bewusst frei von Vue: der Hot Path fasst nur TypedArrays und Maps an. Die
 * View bekommt Zustandswechsel über `onStatus` und neue Spalten über `onFrame`.
 */

import axios from 'axios'
import { OrderBook } from '../../shared/orderbook.js'
import { BinanceStream, buildStreamUrl, buildLiquidationUrl } from './binanceStream.js'
import { HeatmapRing } from './heatmapRing.js'
import { TradeRing } from './tradeRing.js'
import { pickBucketSize, inferTickSize } from '../../shared/priceBins.js'
import { tickSizeFor } from './liveSymbols.js'
import { loadReplay } from './replaySource.js'

const PRUNE_INTERVAL_MS = 30000
const MAX_SNAPSHOT_RETRIES = 5

export class LiveFeed {
    /**
     * @param {object} opts
     * @param {string} opts.symbol       z.B. 'BTCUSDT'
     * @param {'futures'|'spot'} opts.market
     * @param {number} [opts.frameMs]    Spaltentakt (Default 500 ms)
     * @param {number} [opts.rows]       erfasste Preis-Buckets
     * @param {number} [opts.rangePct]   erfasstes Band um den Mid, einseitig in %
     * @param {number} [opts.historyMin] Historienlänge in Minuten
     * @param {boolean} [opts.pauseInBackground]
     * @param {function} [opts.onStatus] (state, detail) => void
     * @param {function} [opts.onFrame]  (ts) => void
     */
    constructor(opts) {
        this.symbol = opts.symbol
        this.market = opts.market || 'futures'
        this.frameMs = opts.frameMs || 500
        this.rows = opts.rows || 600
        this.rangePct = opts.rangePct ?? 1.5
        this.historyMin = opts.historyMin || 30
        this.pauseInBackground = opts.pauseInBackground !== false
        // Vorlauf aus der eigenen Aufzeichnung, 0 = aus
        this.prefillMs = Math.max(0, (opts.prefillMin || 0) * 60000)
        this.onStatus = opts.onStatus
        this.onFrame = opts.onFrame

        this.book = new OrderBook()
        this.ring = null           // erst nach dem ersten Snapshot (bucketSize!)
        this.trades = new TradeRing(20000)
        // Liquidationen sind selten (einzelne pro Symbol und Stunde) — ein
        // kleiner Ring reicht, und er lebt getrennt vom Orderbuch.
        this.liquidations = new TradeRing(2000)
        this.stream = null
        this.liqStream = null

        this.tickSize = null
        this.bucketSize = null
        this.state = 'idle'
        this.pending = []          // gepufferte Diffs bis der Snapshot da ist
        this.buffering = true
        this.snapshotTries = 0
        this.gapPending = false

        this.frameTimer = null
        this.pruneTimer = null
        this.snapshotTimer = null
        this.syncWatchdog = null
        this.nextSlot = 0
        this.stopped = false
        this._onVisibility = this._onVisibility.bind(this)
    }

    get isFutures() { return this.market === 'futures' }

    async start() {
        this.stopped = false
        this._setState('connecting')
        document.addEventListener('visibilitychange', this._onVisibility)
        await this._loadTickSize()
        this._openStream()
        this._startFrameTicker()
        this.pruneTimer = setInterval(() => {
            const { mid } = this.book.bestPrices()
            this.book.prune(mid)
        }, PRUNE_INTERVAL_MS)
    }

    stop() {
        this.stopped = true
        document.removeEventListener('visibilitychange', this._onVisibility)
        this.stream?.stop()
        this.stream = null
        this.liqStream?.stop()
        this.liqStream = null
        clearInterval(this.frameTimer)
        clearInterval(this.pruneTimer)
        clearTimeout(this.snapshotTimer)
        clearTimeout(this.syncWatchdog)
        this.frameTimer = this.pruneTimer = this.snapshotTimer = this.syncWatchdog = null
        this._setState('idle')
    }

    // ── Verbindung ──────────────────────────────────────────

    _openStream() {
        this.stream?.stop()
        this.snapshotTries = 0
        this.stream = new BinanceStream({
            url: buildStreamUrl(this.symbol, this.market),
            onMessage: (msg) => this._onMessage(msg),
            // Reihenfolge ist entscheidend: erst puffern, dann Snapshot holen.
            onOpen: () => this._beginSync(),
            onStatus: (s) => {
                if (s === 'closed' || s === 'connecting') {
                    this.buffering = true
                    this.gapPending = true
                    if (s === 'closed') this._setState('reconnecting')
                }
            },
        })
        this.stream.connect()
        this._openLiquidationStream()
    }

    /**
     * Zweiter, entkoppelter Socket für Zwangsliquidationen (`/market`-Route).
     * Fällt er aus, läuft die Heatmap unverändert weiter — deshalb kein
     * gemeinsamer Status und kein Resync.
     */
    _openLiquidationStream() {
        this.liqStream?.stop()
        this.liqStream = null
        const url = buildLiquidationUrl(this.symbol, this.market)
        if (!url) return
        this.liqStream = new BinanceStream({
            url,
            silenceLimitMs: 0,   // Stille ist hier normal, siehe BinanceStream
            onMessage: (msg) => {
                const data = msg.data || msg
                if (data.e !== 'forceOrder' || !data.o) return
                const order = data.o
                // S = Seite der Liquidations-ORDER: 'SELL' schliesst eine Long-
                // Position, 'BUY' eine Short-Position.
                this.liquidations.push(
                    order.T,
                    +(order.ap || order.p),
                    +(order.l || order.q),
                    order.S === 'BUY'
                )
            },
        })
        this.liqStream.connect()
    }

    _beginSync() {
        this.book.reset()
        this.pending.length = 0
        this.buffering = true
        this._setState('syncing')
        // Kurz warten, damit garantiert Diffs im Puffer liegen, die den
        // Snapshot überlappen.
        clearTimeout(this.snapshotTimer)
        clearTimeout(this.syncWatchdog)
        this.snapshotTimer = setTimeout(() => this._fetchSnapshot(), 200)
    }

    async _fetchSnapshot() {
        if (this.stopped) return
        try {
            const { data } = await axios.get('/api/binance/depth', {
                params: { symbol: this.symbol, market: this.market, limit: 1000 }
            })
            if (this.stopped) return

            this.book.applySnapshot(data)
            if (!this.tickSize) {
                const { mid } = this.book.bestPrices()
                this.tickSize = inferTickSize(data) || (mid ? mid * 1e-5 : 0.01)
            }
            console.log(`[live] Snapshot lastUpdateId=${data.lastUpdateId}, Puffer=${this.pending.length} Events`)

            let applied = 0
            for (const event of this.pending) {
                const result = this.book.applyDiff(event, this.isFutures)
                if (result === 'ok') applied++
                else if (result === 'resync') { this._resync('Lücke im Puffer'); return }
            }
            this.pending.length = 0

            this._ensureRing()
            // Ab hier laufen Diffs direkt ins Buch. Der Snapshot wird IMMER nach
            // den gepufferten Events geholt, deshalb überlappt ihn meist erst
            // das nächste eintreffende Event — darauf warten statt einen neuen
            // Snapshot zu ziehen (das erzeugte sonst eine Endlosschleife).
            this.buffering = false

            if (this.book.synced) {
                this.snapshotTries = 0
                console.log(`[live] synchronisiert nach ${applied} Events`)
                this._setState('live')
            } else {
                this._armSyncWatchdog()
            }

        } catch (error) {
            if (this.stopped) return
            const message = error.response?.data?.error || error.message
            if (++this.snapshotTries >= MAX_SNAPSHOT_RETRIES) {
                this._setState('error', message)
                return
            }
            this.snapshotTimer = setTimeout(() => this._fetchSnapshot(), 1000)
        }
    }

    /**
     * Fällt der erste passende Diff aus (dürfte nicht vorkommen), wird nach 5 s
     * doch ein frischer Snapshot gezogen — so bleibt kein toter Zustand stehen.
     */
    _armSyncWatchdog() {
        clearTimeout(this.syncWatchdog)
        this.syncWatchdog = setTimeout(() => {
            if (this.stopped || this.book.synced) return
            if (++this.snapshotTries >= MAX_SNAPSHOT_RETRIES) {
                this._setState('error', 'Orderbuch konnte nicht synchronisiert werden')
                return
            }
            this._resync('kein überlappendes Event nach 5 s')
        }, 5000)
    }

    _resync(reason) {
        console.log(`[live] RESYNC: ${reason}`)
        this.gapPending = true
        this._beginSync()
    }

    _onMessage(msg) {
        const stream = msg.stream || ''
        const data = msg.data || msg
        if (data.e === 'trade' || data.e === 'aggTrade') {
            this.trades.pushBinanceTrade(data)
            return
        }
        if (!(stream.includes('@depth') || data.e === 'depthUpdate')) return

        if (this.buffering) {
            this.pending.push(data)
            // Schutz gegen unbegrenztes Wachstum, falls der Snapshot nie kommt
            if (this.pending.length > 5000) this.pending.splice(0, this.pending.length - 5000)
            return
        }
        const result = this.book.applyDiff(data, this.isFutures)
        if (result === 'resync') {
            this._resync(`Lücke erkannt (pu=${data.pu}, erwartet ${this.book.prevU})`)
        } else if (result === 'ok' && this.state !== 'live') {
            clearTimeout(this.syncWatchdog)
            this.snapshotTries = 0
            console.log('[live] synchronisiert')
            this._setState('live')
        }
    }

    // ── Frames ──────────────────────────────────────────────

    _ensureRing() {
        const { mid } = this.book.bestPrices()
        if (!mid) return
        const bucketSize = pickBucketSize(this.tickSize, mid, this.rangePct, this.rows)
        if (this.ring && this.bucketSize === bucketSize) return
        this.bucketSize = bucketSize
        const cap = Math.ceil((this.historyMin * 60 * 1000) / this.frameMs)
        this.ring = new HeatmapRing({ cap, rows: this.rows, bucketSize })
        console.log(`[live] Ring: ${cap} Spalten × ${this.rows} Zeilen, Bucket ${bucketSize}`)
        // Historie gibt es nur aus der eigenen Aufzeichnung — Binance liefert
        // keine vergangene Orderbuch-Tiefe. Läuft der Recorder für dieses
        // Symbol, wird der Ring damit vorbelegt und der Live-Betrieb schliesst
        // nahtlos an.
        if (this.prefillMs > 0) this._prefill().catch(() => { /* ohne Vorlauf weiter */ })
    }

    /**
     * Füllt den Ring mit den letzten `prefillMs` aus der Aufzeichnung.
     *
     * Aufzeichnung und Live-Ansicht laufen auf unterschiedlichen Rastern
     * (Recorder z.B. 1 s / 200 Zeilen, live 500 ms / 600 Zeilen), deshalb wird
     * in Zeit UND Preis umgerechnet — massenerhaltend, damit die Farbskala
     * über die Nahtstelle hinweg dieselbe Bedeutung behält.
     */
    async _prefill() {
        const ring = this.ring
        if (!ring || ring.count) return

        const frameMs = this.frameMs
        const letzterSlot = Math.floor(Date.now() / frameMs) * frameMs
        const spalten = Math.min(Math.floor(this.prefillMs / frameMs), ring.cap - 2)
        if (spalten < 2) return
        const ersterSlot = letzterSlot - spalten * frameMs

        const rec = await loadReplay({
            symbol: this.symbol, market: this.market,
            from: ersterSlot, to: letzterSlot,
        })
        if (this.stopped || !rec?.ring || !rec.cols) return

        const src = rec.ring
        const verhaeltnis = ring.bucketSize / src.bucketSize
        let gefuellt = 0

        for (let i = 0; i < spalten; i++) {
            const ts = ersterSlot + i * frameMs
            const srcCol = Math.floor((ts - rec.startTs) / rec.frameMs)
            if (srcCol < 0 || srcCol >= src.cap || !src.mid[srcCol]) {
                // Keine Aufzeichnung für diesen Moment → Lücke, nicht erfinden
                ring.ts[i] = ts
                ring.flags[i] = 1
                continue
            }

            const mid = src.mid[srcCol]
            const base = Math.round(mid / ring.bucketSize) - (ring.rows >> 1)
            const ziel = i * ring.rows
            const quelle = srcCol * src.rows

            if (verhaeltnis >= 1) {
                // Live-Raster gröber: mehrere Quellzeilen fallen in eine Zielzeile
                for (let sr = 0; sr < src.rows; sr++) {
                    const wert = src.data[quelle + sr]
                    if (!wert) continue
                    const preis = (src.base[srcCol] + sr) * src.bucketSize
                    const r = Math.round(preis / ring.bucketSize) - base
                    if (r >= 0 && r < ring.rows) ring.data[ziel + r] += wert
                }
            } else {
                // Live-Raster feiner: eine Quellzeile verteilt sich anteilig
                for (let r = 0; r < ring.rows; r++) {
                    const preis = (base + r) * ring.bucketSize
                    const sr = Math.round(preis / src.bucketSize) - src.base[srcCol]
                    if (sr < 0 || sr >= src.rows) continue
                    const wert = src.data[quelle + sr]
                    if (wert) ring.data[ziel + r] = wert * verhaeltnis
                }
            }

            ring.base[i] = base
            ring.mid[i] = mid
            ring.ts[i] = ts
            ring.flags[i] = 0
            gefuellt++
        }

        if (!gefuellt) return

        ring.head = spalten % ring.cap
        ring.count = spalten
        // Der Live-Betrieb setzt genau hinter dem Vorlauf an
        this.nextSlot = letzterSlot
        console.log(`[live] Vorlauf: ${gefuellt}/${spalten} Spalten aus der Aufzeichnung (${(spalten * frameMs / 60000).toFixed(1)} min)`)
        this.onFrame?.(letzterSlot)
    }

    _startFrameTicker() {
        clearInterval(this.frameTimer)
        this.nextSlot = Math.ceil(Date.now() / this.frameMs) * this.frameMs
        // Oversampling (halber Takt) macht den Slot-Abgleich robust gegen Drift
        this.frameTimer = setInterval(() => this._tick(), Math.max(50, this.frameMs / 2))
    }

    _tick() {
        // Erst schreiben, wenn das Buch nachweislich am Stream hängt — ein noch
        // nicht synchronisiertes Buch würde eine falsche Spalte hinterlassen.
        if (this.stopped || !this.ring || this.buffering || !this.book.synced) {
            // Slots weiterschieben, damit nach dem Sync keine Nachhol-Lawine kommt
            const now = Date.now()
            if (this.nextSlot < now - this.frameMs) {
                this.nextSlot = Math.ceil(now / this.frameMs) * this.frameMs
                this.gapPending = true
            }
            return
        }
        const now = Date.now()
        let written = 0
        while (this.nextSlot <= now && written < 40) {
            this.ring.commit(this.book, this.nextSlot, this.gapPending)
            this.gapPending = false
            this.nextSlot += this.frameMs
            written++
        }
        if (this.nextSlot <= now) {
            // Mehr als 40 Slots verpasst (Tab lange im Hintergrund) → Lücke markieren
            this.nextSlot = Math.ceil(now / this.frameMs) * this.frameMs
            this.gapPending = true
        }
        if (written) this.onFrame?.(now)
    }

    // ── Sonstiges ───────────────────────────────────────────

    async _loadTickSize() {
        // Fällt das aus, leitet der erste Snapshot die tickSize selbst ab
        this.tickSize = await tickSizeFor(this.symbol, this.market)
    }

    _onVisibility() {
        if (!this.pauseInBackground || this.stopped) return
        if (document.hidden) {
            // Im Hintergrund drosselt der Browser die Timer — statt eine verzerrte
            // Zeitachse zu schreiben, wird die Verbindung getrennt.
            this.stream?.stop()
            this.stream = null
            this.liqStream?.stop()
            this.liqStream = null
            this.buffering = true
            this.gapPending = true
            this._setState('paused')
        } else if (!this.stream) {
            this._openStream()
        }
    }

    _setState(state, detail) {
        if (this.state === state) return
        this.state = state
        this.onStatus?.(state, detail)
    }
}
