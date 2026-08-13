/**
 * Lokales L2-Orderbuch nach dem offiziellen Binance-Sync-Verfahren.
 *
 * Ablauf (die Reihenfolge ist entscheidend):
 *   1. WebSocket öffnen und ALLE depthUpdate-Events puffern
 *   2. erst danach den REST-Snapshot holen
 *   3. Snapshot anwenden, dann den Puffer durchschicken
 * Ein Snapshot VOR dem Öffnen der Verbindung erzeugt garantiert eine Lücke.
 *
 * Bids/Asks liegen als Map price->qty vor: Einfügen/Löschen ist O(1), sortiert
 * wird nie — die einzige Ordnungs-Operation ist das Binning, und das läuft nur
 * zweimal pro Sekunde.
 */

export class OrderBook {
    constructor() {
        this.bids = new Map()   // price (Number) -> qty (Number)
        this.asks = new Map()
        this.lastUpdateId = 0
        this.prevU = null       // 'u' des zuletzt angewandten Events
        this.synced = false
        // Preisspanne, die der letzte Snapshot abgedeckt hat. Binance liefert
        // maximal 1000 Stufen je Seite — bei einem dichten Buch sind das nur
        // wenige Zehntel Prozent um den Mittelkurs. Ausserhalb davon kennt das
        // Buch nur, was sich seither geändert hat, ist also unvollständig.
        this.coverLo = 0
        this.coverHi = 0
    }

    reset() {
        this.bids.clear()
        this.asks.clear()
        this.lastUpdateId = 0
        this.prevU = null
        this.synced = false
        this.coverLo = 0
        this.coverHi = 0
    }

    /** Snapshot aus /api/binance/depth */
    applySnapshot(snapshot) {
        this.bids.clear()
        this.asks.clear()
        let lo = Infinity
        let hi = -Infinity
        for (const [price, qty] of snapshot.bids || []) {
            const q = +qty
            const p = +price
            if (p < lo) lo = p
            if (q > 0) this.bids.set(p, q)
        }
        for (const [price, qty] of snapshot.asks || []) {
            const q = +qty
            const p = +price
            if (p > hi) hi = p
            if (q > 0) this.asks.set(p, q)
        }
        this.coverLo = Number.isFinite(lo) ? lo : 0
        this.coverHi = Number.isFinite(hi) ? hi : 0
        this.lastUpdateId = snapshot.lastUpdateId
        this.prevU = null
        this.synced = false     // wird beim ersten passenden Diff true
    }

    /**
     * Wendet ein depthUpdate an.
     * @param {object} event   Rohes Binance-Event (U, u, pu, b, a)
     * @param {boolean} isFutures  Futures nutzt `pu` für die Lückenprüfung
     * @returns {'ok'|'skip'|'resync'}
     */
    applyDiff(event, isFutures) {
        // Veraltete Events (vor dem Snapshot) verwerfen
        if (isFutures ? event.u < this.lastUpdateId : event.u <= this.lastUpdateId) return 'skip'

        if (!this.synced) {
            // Erstes Event suchen, das den Snapshot überlappt
            const fits = isFutures
                ? (event.U <= this.lastUpdateId && event.u >= this.lastUpdateId)
                : (event.U <= this.lastUpdateId + 1 && event.u >= this.lastUpdateId + 1)
            if (!fits) return 'skip'
            this.synced = true
        } else {
            // Lückenprüfung: Futures liefert mit `pu` die ID des Vorgängers
            const contiguous = isFutures ? (event.pu === this.prevU) : (event.U === this.prevU + 1)
            if (!contiguous) return 'resync'
        }

        applySide(this.bids, event.b)
        applySide(this.asks, event.a)
        this.lastUpdateId = event.u
        this.prevU = event.u
        return 'ok'
    }

    /** Bestes Gebot / bester Brief. Einmaliger Durchlauf über beide Maps. */
    bestPrices() {
        let bestBid = -Infinity
        let bestAsk = Infinity
        for (const price of this.bids.keys()) if (price > bestBid) bestBid = price
        for (const price of this.asks.keys()) if (price < bestAsk) bestAsk = price
        const valid = bestBid > -Infinity && bestAsk < Infinity
        return { bestBid, bestAsk, mid: valid ? (bestBid + bestAsk) / 2 : 0 }
    }

    /**
     * Entfernt Level weit ausserhalb des Marktes. Diffs können Preise ausserhalb
     * des Snapshot-Bandes anlegen, die nie wieder ein Delete sehen — ohne Prune
     * wachsen die Maps unbegrenzt.
     */
    prune(mid, pct = 0.03) {
        if (!mid) return
        const lo = mid * (1 - pct)
        const hi = mid * (1 + pct)
        for (const price of this.bids.keys()) if (price < lo) this.bids.delete(price)
        for (const price of this.asks.keys()) if (price > hi) this.asks.delete(price)
    }
}

function applySide(map, levels) {
    if (!levels) return
    for (let i = 0; i < levels.length; i++) {
        const price = +levels[i][0]
        const qty = +levels[i][1]
        if (qty === 0) map.delete(price)   // Menge 0 = Level entfernen
        else map.set(price, qty)
    }
}
