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
            // Gleiche Prüfung wie im Diff-Pfad: ein NaN-Preis mit gültiger
            // Menge käme sonst durch — `q > 0` fängt nur kaputte MENGEN ab
            if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0) continue
            if (p < lo) lo = p
            if (q > 0) this.bids.set(p, q)
        }
        for (const [price, qty] of snapshot.asks || []) {
            const q = +qty
            const p = +price
            if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0) continue
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
        /*
         * Ein gekreuztes Buch (Gebot über Brief) ist kein Marktzustand, sondern
         * ein Zeichen dafür, dass Snapshot und Diffs auseinandergelaufen sind.
         * Der Mittelwert daraus sähe plausibel aus und wäre falsch — das ist
         * schlimmer als gar kein Wert, weil sich das ganze Preisraster daran
         * ausrichtet. Also: kein Mid, und die Lage nach aussen melden, damit
         * der Aufrufer neu abgleichen kann.
         */
        const beideDa = bestBid > -Infinity && bestAsk < Infinity
        const gekreuzt = beideDa && bestBid >= bestAsk
        return {
            bestBid,
            bestAsk,
            gekreuzt,
            mid: beideDa && !gekreuzt ? (bestBid + bestAsk) / 2 : 0,
        }
    }

    /**
     * Kauf- zu Verkaufsvolumen innerhalb eines Preisbands um den Mid — ein
     * schneller Blick auf den Druck nahe am Geschehen, statt auf das ganze
     * (teils sehr breite) Buch. Bei gekreuztem oder fehlendem Buch gibt es
     * absichtlich keinen Wert, aus demselben Grund wie in `bestPrices()`.
     */
    topImbalance(bandPct = 0.5) {
        const { mid } = this.bestPrices()
        if (!mid) return null
        const lo = mid * (1 - bandPct / 100)
        const hi = mid * (1 + bandPct / 100)
        let bidQty = 0, askQty = 0
        for (const [price, qty] of this.bids) if (price >= lo) bidQty += qty
        for (const [price, qty] of this.asks) if (price <= hi) askQty += qty
        const total = bidQty + askQty
        return { bidQty, askQty, buyShare: total ? bidQty / total : 0.5 }
    }

    /**
     * Ergänzt ruhende Level aus einem FRISCHEN Snapshot, ohne den Sync-Zustand
     * anzufassen (Re-Anker des Recorders).
     *
     * Warum kein applySnapshot: das setzte lastUpdateId/prevU neu und
     * erzwänge den kompletten Sync-Tanz — dabei ist das laufende Buch für
     * jedes je berührte Level NEUER als der Snapshot. Der Snapshot kann nur
     * eines beitragen: ruhende Level, die seit dem letzten Anker nie ein Diff
     * gesehen haben und dem Buch deshalb fehlen. Genau die (und nur die)
     * werden übernommen; bekannte Level behalten ihren aktuelleren Stand.
     *
     * Restrisiko, bewusst getragen: ein Level, das zwischen Snapshot-Aufnahme
     * und jetzt per Diff gelöscht wurde, kehrt kurz als Geist zurück. Das
     * Fenster ist unter einer Sekunde, und nahe am Mid wird jedes Level
     * laufend berührt — der nächste Diff räumt auf.
     *
     * @returns {number} Anzahl ergänzter Level
     */
    mergeSnapshot(snapshot) {
        if (!this.synced) return 0
        let neu = 0
        let lo = this.coverLo > 0 ? this.coverLo : Infinity
        let hi = this.coverHi > 0 ? this.coverHi : -Infinity
        // Crossing-Guard: der Snapshot ist um die REST-Laufzeit ÄLTER als das
        // Buch. In einem schnellen Move (genau dann feuert der Re-Anker) kann
        // er ein Bid tragen, das inzwischen durchgehandelt und per Diff
        // gelöscht ist — als Geist über dem eigenen bestAsk kreuzte es das
        // Buch, bestPrices() lieferte mid=0 und die Aufzeichnung stünde still,
        // bis zufällig ein Diff das Geist-Level berührt. Deshalb: nichts
        // einfügen, was das eigene Top-of-Book kreuzen würde.
        const { bestBid, bestAsk } = this.bestPrices()
        for (const [price, qty] of snapshot.bids || []) {
            const p = +price
            const q = +qty
            if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q <= 0) continue
            if (p >= bestAsk) continue
            if (p < lo) lo = p
            if (!this.bids.has(p)) { this.bids.set(p, q); neu++ }
        }
        for (const [price, qty] of snapshot.asks || []) {
            const p = +price
            const q = +qty
            if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q <= 0) continue
            if (p <= bestBid) continue
            if (p > hi) hi = p
            if (!this.asks.has(p)) { this.asks.set(p, q); neu++ }
        }
        // Abdeckung als Vereinigung: der alte Bereich bleibt so aktuell, wie
        // die Diffs ihn halten, der neue kommt dazu.
        if (Number.isFinite(lo)) this.coverLo = lo
        if (Number.isFinite(hi)) this.coverHi = hi
        return neu
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

        /*
         * Kaputte Level überspringen statt einzutragen.
         *
         * Zwei verschiedene Schäden drohen, und der harmlosere ist der
         * auffälligere: Ein NaN-PREIS kann nie „bester Preis" werden, weil
         * jeder Vergleich mit NaN falsch ist — er bliebe aber für immer in der
         * Map liegen, denn auch `prune()` vergleicht ihn nur weg, wenn er
         * kleiner oder grösser als eine Grenze ist, und das ist er nie.
         * Eine NaN-MENGE dagegen wandert ungehindert in die Volumensummen und
         * macht aus einer Heatmap-Spalte still einen leeren Fleck.
         *
         * Negative Preise oder Mengen gibt es an keiner Börse; wenn sie
         * ankommen, ist die Nachricht defekt.
         */
        if (!Number.isFinite(price) || !Number.isFinite(qty)) continue
        if (price <= 0 || qty < 0) continue

        if (qty === 0) map.delete(price)   // Menge 0 = Level entfernen
        else map.set(price, qty)
    }
}
