/**
 * Ringpuffer für die Heatmap-Historie.
 *
 * Eine Spalte = ein Zeitfenster (Frame), eine Zeile = ein Preis-Bucket.
 *
 * Der Trick gegen Preisdrift: jede Spalte merkt sich in `base[c]` den absoluten
 * Bucket-Index ihrer Zeile 0. Zelle (c, r) bedeutet damit immer den absoluten
 * Bucket `base[c] + r` — läuft der Preis weg, wird nichts umindiziert oder
 * verschoben, der Renderer rechnet beim Zeichnen einfach `r = abs - base[c]`.
 *
 * Alles vorab allokiert (TypedArrays): kein GC-Druck im laufenden Betrieb.
 * Diese Objekte dürfen NIE in ref()/reactive() landen — Vue würde Proxies um
 * die TypedArrays legen und der Hot Path bräche zusammen.
 */

export class HeatmapRing {
    /**
     * @param {number} cap    Anzahl Spalten (Frames) — 3600 @ 500 ms = 30 min
     * @param {number} rows   Zeilen pro Spalte (erfasstes Preisband)
     * @param {number} bucketSize  Preisbreite eines Buckets
     */
    constructor({ cap = 3600, rows = 600, bucketSize = 1 }) {
        this.cap = cap
        this.rows = rows
        this.bucketSize = bucketSize
        this.data = new Float32Array(cap * rows)   // Mengen je Zelle
        this.base = new Int32Array(cap)            // absoluter Bucket-Index von Zeile 0
        this.mid = new Float64Array(cap)
        this.ts = new Float64Array(cap)
        this.flags = new Uint8Array(cap)           // Bit 0 = Lücke (Tab war im Hintergrund)
        this.head = 0                              // nächste zu schreibende Spalte
        this.count = 0
    }

    clear() {
        this.data.fill(0)
        this.base.fill(0)
        this.mid.fill(0)
        this.ts.fill(0)
        this.flags.fill(0)
        this.head = 0
        this.count = 0
    }

    /**
     * Schreibt den aktuellen Buchzustand als neue Spalte.
     * @param {OrderBook} book
     * @param {number} ts    Zeitstempel des Frames (ms)
     * @param {boolean} isGap
     * @returns {number} mid
     */
    commit(book, ts, isGap = false) {
        const col = this.head
        const offset = col * this.rows
        const bs = this.bucketSize
        this.data.fill(0, offset, offset + this.rows)

        const { mid } = book.bestPrices()
        const midBucket = Math.round(mid / bs)
        const base = midBucket - (this.rows >> 1)   // Zeile 0 = unterster erfasster Bucket

        if (mid > 0) {
            for (const [price, qty] of book.bids) {
                const r = Math.round(price / bs) - base
                if (r >= 0 && r < this.rows) this.data[offset + r] += qty
            }
            for (const [price, qty] of book.asks) {
                const r = Math.round(price / bs) - base
                if (r >= 0 && r < this.rows) this.data[offset + r] += qty
            }
        }

        this.base[col] = base
        this.mid[col] = mid
        this.ts[col] = ts
        this.flags[col] = isGap ? 1 : 0
        this.head = (col + 1) % this.cap
        if (this.count < this.cap) this.count++
        return mid
    }

    /**
     * Spaltenindex der i-ten Spalte links von `head` (0 = die zuletzt vor head
     * geschriebene). Ein eigener Anker erlaubt es, die Ansicht einzufrieren,
     * während der Ring im Hintergrund weiterläuft.
     */
    colFrom(head, i) {
        return (head - 1 - i + this.cap * 2) % this.cap
    }

    /** Spaltenindex der i-ten Spalte von rechts (0 = neueste). */
    colFromRight(i) {
        return this.colFrom(this.head, i)
    }

    /** Menge in Spalte `col` beim absoluten Bucket `absBucket` (0, wenn ausserhalb). */
    valueAt(col, absBucket) {
        const r = absBucket - this.base[col]
        if (r < 0 || r >= this.rows) return 0
        return this.data[col * this.rows + r]
    }
}
