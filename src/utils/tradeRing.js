/**
 * Ringpuffer für ausgeführte Trades (aggTrade) — die Punkte im Bookmap.
 *
 * Parallele TypedArrays statt Objekt-Array: kein GC-Druck, kein Pointer-Chasing
 * beim Zeichnen. Wie HeatmapRing gilt: nicht in ref()/reactive() legen.
 */

export class TradeRing {
    constructor(cap = 20000) {
        this.cap = cap
        this.ts = new Float64Array(cap)
        this.price = new Float64Array(cap)
        this.qty = new Float32Array(cap)
        this.buy = new Uint8Array(cap)
        this.head = 0
        this.count = 0
    }

    clear() {
        this.head = 0
        this.count = 0
    }

    push(ts, price, qty, isBuy) {
        const i = this.head
        this.ts[i] = ts
        this.price[i] = price
        this.qty[i] = qty
        this.buy[i] = isBuy ? 1 : 0
        this.head = (i + 1) % this.cap
        if (this.count < this.cap) this.count++
    }

    /**
     * Binance `trade`/`aggTrade`: `m` = "buyer is market maker". War der Käufer
     * Maker, kam die Aggression von der Verkäuferseite → Sell-Trade (rot).
     */
    pushBinanceTrade(event) {
        this.push(event.T, +event.p, +event.q, !event.m)
    }

    /** Index der i-ten Eintragung von hinten (0 = neueste). */
    idxFromEnd(i) {
        return (this.head - 1 - i + this.cap * 2) % this.cap
    }

    /**
     * Referenzgrösse für die Punktradien (Perzentil der letzten Trades).
     * Wird selten aufgerufen (≈1×/s), deshalb ist das Kopieren+Sortieren ok.
     */
    quantile(p = 0.99, sampleSize = 2000) {
        const n = Math.min(this.count, sampleSize)
        if (!n) return 0
        const sample = new Float32Array(n)
        for (let i = 0; i < n; i++) sample[i] = this.qty[this.idxFromEnd(i)]
        sample.sort()
        return sample[Math.min(n - 1, Math.floor(n * p))] || 0
    }
}
