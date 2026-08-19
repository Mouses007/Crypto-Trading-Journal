/**
 * Hebelkarte — Modell, keine Messung.
 *
 * Schätzt aus der Open-Interest-Historie, wo gehebelte Positionen liquidiert
 * würden. Steigt das offene Interesse in einer Periode, wurden dort Positionen
 * eröffnet; die Kerze sagt zu welchem Preis, das Taker-Volumen in welche
 * Richtung. Daraus ergibt sich je Hebelstufe ein Liquidationspreis.
 *
 * Bewusst DOM-, axios- und Vue-frei: das Prüfskript unter node importiert
 * genau dieses Modul, damit die Verifikation dasselbe Modell prüft, das auch
 * gezeichnet wird.
 *
 * Was das Modell NICHT kann, in der Reihenfolge der Schwere:
 *  1. ΔOI ist ein Saldo. Innerhalb einer Periode öffnen und schliessen viele
 *     Positionen; der Umschlag bleibt unsichtbar.
 *  2. Jeder Kontrakt hat zwei Seiten. Das Modell unterstellt, dass je Paar nur
 *     eine Seite gehebelt ist — das ist die grösste Fiktion darin.
 *  3. Der Einstiegspreis innerhalb einer Kerze ist unbekannt.
 *  4. Die Hebelverteilung ist unbekannt; einzelne Stufen sind ein Was-wäre-wenn.
 *  5. Cross Margin und Nachschuss verschieben echte Liquidationspreise beliebig.
 */

import { liqPreisLong, liqPreisShort, hebelHaltbar } from '../../shared/liquidation.js'

export const LEVERAGE_TIERS = [10, 25, 50, 100]

/*
 * Die Formeln stehen seit dem Audit vom 19.08.2026 in `shared/liquidation.js`
 * — dieselbe Datei, die auch der Backtest benutzt. Hier bleiben nur die
 * bisherigen Namen als Durchreiche, damit die Karte und ihr Prüfskript
 * unverändert weiterlaufen. `mmr` ist ein BRUCH.
 */
export const liqPriceLong = liqPreisLong
export const liqPriceShort = liqPreisShort

/**
 * Bei `1/Hebel <= Margin-Rate` bleibt kein Puffer — die Position wäre im
 * Moment der Eröffnung liquidiert. Solche Stufen existieren bei dieser
 * Margin-Rate schlicht nicht und dürfen kein Band erzeugen.
 */
export const tierPossible = hebelHaltbar

export class LeverageMap {
    constructor({ bucketSize, rows, base, tiers }) {
        this.bucketSize = bucketSize
        this.rows = rows
        this.base = base                 // absoluter Bucket-Index von Zeile 0
        this.tiers = tiers               // tatsächlich verwendete Stufen
        this.long = tiers.map(() => new Float64Array(rows))    // Coins
        this.short = tiers.map(() => new Float64Array(rows))
        this.oi = 0                      // offenes Interesse am Ende
        // Buchhaltung JE STUFE. Ein Mittelwert wäre irreführend: 100x-Level
        // liegen dicht am Einstieg und werden ständig abgeräumt, 10x-Level
        // liegen weit weg und fast nie.
        this.mass = tiers.map(() => 0)          // gehalten (nach Sweep)
        this.swept = tiers.map(() => 0)         // vom Preis bereits abgeräumt
        this.outOfRange = tiers.map(() => 0)    // ausserhalb der gezeigten Spanne
        this.attributed = 0              // insgesamt attribuiert (= oi am Ende)
        this.mmr = 0
        this.kind = 'leverage'           // 'leverage' | 'entry'
        this.capturePct = 0              // tatsächlich erfasste Spanne
        this.ts = 0
        this.spanMs = 0
        this.periods = 0
        this.droppedTiers = []           // wegen tierPossible verworfen
        // Live-Nachführung zwischen zwei Rebuilds
        this.sweepLo = Infinity
        this.sweepHi = -Infinity
    }

    rowFor(price) { return Math.round(price / this.bucketSize) - this.base }
    priceAt(row) { return (this.base + row) * this.bucketSize }

    /** Anteil der Stufe, der noch im Modell steht — unter ~30 % sagt die Karte wenig. */
    massShare(tierIndex) {
        return this.attributed > 0 ? this.mass[tierIndex] / this.attributed : 0
    }

    /** Summe über alle Stufen einer Zeile, optional gewichtet. */
    valueAt(row, side, weights) {
        const arrays = side === 'long' ? this.long : this.short
        let sum = 0
        for (let k = 0; k < arrays.length; k++) {
            sum += arrays[k][row] * (weights ? weights[k] : 1)
        }
        return sum
    }

    /**
     * Zeile bereits vom Preis durchlaufen? Long-Level liegen unter dem
     * Einstieg, werden also von einem Tief abgeräumt; Short-Level umgekehrt.
     */
    isSwept(row, side) {
        const price = this.priceAt(row)
        return side === 'long' ? price >= this.sweepLo : price <= this.sweepHi
    }
}

/**
 * Baut die Karte aus den Punkten des Endpoints.
 *
 * @param {Array} points  [{t, oi, o, h, l, c, v, tb}], aufsteigend nach t
 * @param {object} opts
 * @param {number} opts.mid         aktueller Mittelkurs (Mitte der Karte)
 * @param {number} opts.bucketSize  Preisbreite einer Zeile
 * @param {number} [opts.spanPct]   Spanne um den Mid, einseitig in %
 * @param {number} [opts.mmr]       Maintenance-Margin-Rate
 * @param {number[]} [opts.tiers]   Hebelstufen
 * @param {number} [opts.maxSubSteps] Auflösung der Verteilung je Kerze
 * @returns {LeverageMap}
 */
export function buildLeverageMap(points, opts) {
    const {
        mid, bucketSize, spanPct = 8, mmr = 0.004,
        tiers = LEVERAGE_TIERS, maxSubSteps = 64, sweep = true, seed = true,
    } = opts

    const usable = tiers.filter(L => tierPossible(L, mmr))
    const dropped = tiers.filter(L => !tierPossible(L, mmr))

    // Die erfasste Spanne muss die weiteste Stufe abdecken, sonst fällt sie
    // komplett aus dem Raster: 10x liquidiert erst bei −9,6 %, bei einer
    // Spanne von ±8 % wäre diese Stufe restlos leer. Angezeigt wird davon
    // später nur ein Ausschnitt — dasselbe Prinzip wie bei der Heatmap
    // (erfassen ±1,5 %, zeigen ±0,5 %).
    const spanNeeded = usable.length
        ? Math.max(...usable.map(L => Math.max(
            1 - liqPriceLong(1, L, mmr),
            liqPriceShort(1, L, mmr) - 1))) * 100 * 1.1
        : spanPct
    const capturePct = Math.max(spanPct, spanNeeded)

    const rows = Math.max(8, Math.ceil((mid * (capturePct / 100) * 2) / bucketSize))
    const base = Math.round(mid / bucketSize) - (rows >> 1)
    const map = new LeverageMap({ bucketSize, rows, base, tiers: usable })
    map.mmr = mmr
    map.droppedTiers = dropped
    map.capturePct = capturePct

    const n = points.length
    if (!n || !usable.length) return map

    map.oi = points[n - 1].oi
    map.ts = points[n - 1].t
    map.spanMs = points[n - 1].t - points[0].t
    map.periods = n

    // Zuwachs je Periode und der Anteil, der bis zum Ende überlebt hat.
    // Statt den ganzen Puffer je Periode zu skalieren, bekommt jede Einzahlung
    // einmal das Produkt aller späteren Ausdünnungen mit — mathematisch
    // identisch, aber O(n) statt O(n·rows). Siehe attributeOpenInterest.
    const { add, postScale } = attributeOpenInterest(points, { seed })

    // ── Laufende Extrema NACH (einschliesslich) Periode i ───
    // Die eigene Kerze wird einbezogen: die Reihenfolge innerhalb ist
    // unbekannt, "schon abgeräumt" ist die konservative Annahme.
    const minLowAfter = new Float64Array(n)
    const maxHighAfter = new Float64Array(n)
    let lo = Infinity
    let hi = -Infinity
    for (let i = n - 1; i >= 0; i--) {
        lo = Math.min(lo, points[i].l)
        hi = Math.max(hi, points[i].h)
        minLowAfter[i] = lo
        maxHighAfter[i] = hi
    }

    // ── Einzahlen ───────────────────────────────────────────
    for (let i = 0; i < n; i++) {
        const menge = add[i] * postScale[i]
        if (menge <= 0) continue
        const p = points[i]

        // Richtung aus dem aggressiven Volumen; geklemmt, damit eine einzelne
        // extreme Kerze keine Seite komplett leerräumt.
        const anteilLong = p.v > 0 ? clamp(p.tb / p.v, 0.15, 0.85) : 0.5

        // Einstieg gleichverteilt über die Kerzenspanne — innerhalb der Kerze
        // existiert keine Information über die Reihenfolge.
        const spanne = Math.max(0, p.h - p.l)
        const schritte = Math.max(1, Math.min(maxSubSteps, Math.ceil(spanne / bucketSize)))
        const jeSchritt = menge / schritte

        for (let s = 0; s < schritte; s++) {
            const entry = schritte === 1 ? p.c : p.l + (spanne * (s + 0.5)) / schritte

            for (let k = 0; k < usable.length; k++) {
                const L = usable[k]
                const mengeLong = jeSchritt * anteilLong
                const mengeShort = jeSchritt * (1 - anteilLong)

                const xLong = liqPriceLong(entry, L, mmr)
                if (!sweep || xLong < minLowAfter[i]) deposit(map, map.long[k], k, xLong, mengeLong)
                else map.swept[k] += mengeLong

                const xShort = liqPriceShort(entry, L, mmr)
                if (!sweep || xShort > maxHighAfter[i]) deposit(map, map.short[k], k, xShort, mengeShort)
                else map.swept[k] += mengeShort
            }
        }
        map.attributed += menge
    }

    for (let k = 0; k < usable.length; k++) {
        let mass = 0
        for (let r = 0; r < rows; r++) mass += map.long[k][r] + map.short[k][r]
        map.mass[k] = mass
    }

    return map
}

function deposit(map, arr, tierIndex, price, menge) {
    const row = map.rowFor(price)
    if (row < 0 || row >= map.rows) { map.outOfRange[tierIndex] += menge; return }
    arr[row] += menge
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v) }

/**
 * Einstands-Karte: wo hängt offenes Interesse, gemessen am Eröffnungspreis.
 *
 * Dieselbe Attribution wie oben, aber die Menge wird am **Einstiegspreis**
 * abgelegt statt an einem daraus projizierten Liquidationspreis. Damit fallen
 * die drei grössten erfundenen Annahmen weg: Hebelverteilung, Margin-Rate und
 * Sweep-Logik.
 *
 * Der entscheidende Unterschied zur Hebelkarte: das hier ist eine
 * **beschreibende** Grösse, keine Vorhersage. Sie behauptet nicht, wo etwas
 * passieren wird, sondern wo etwas liegt — und braucht deshalb auch keinen
 * Trefferquoten-Nachweis.
 *
 * Was weiterhin angenommen wird: ΔOI ist ein Saldo (Umschlag innerhalb einer
 * Periode bleibt unsichtbar), der Einstieg innerhalb einer Kerze ist unbekannt
 * (gleichverteilt), und die Richtung stammt aus dem aggressiven Volumen.
 */
export function buildEntryMap(points, opts) {
    const { mid, bucketSize, spanPct = 8, maxSubSteps = 64, seed = true } = opts

    const rows = Math.max(8, Math.ceil((mid * (spanPct / 100) * 2) / bucketSize))
    const base = Math.round(mid / bucketSize) - (rows >> 1)
    const map = new LeverageMap({ bucketSize, rows, base, tiers: [0] })  // 0 = kein Hebel
    map.kind = 'entry'
    map.capturePct = spanPct

    const n = points.length
    if (!n) return map

    map.oi = points[n - 1].oi
    map.ts = points[n - 1].t
    map.spanMs = points[n - 1].t - points[0].t
    map.periods = n

    const { add, postScale } = attributeOpenInterest(points, { seed })

    for (let i = 0; i < n; i++) {
        const menge = add[i] * postScale[i]
        if (menge <= 0) continue
        const p = points[i]
        const anteilLong = p.v > 0 ? clamp(p.tb / p.v, 0.15, 0.85) : 0.5
        const spanne = Math.max(0, p.h - p.l)
        const schritte = Math.max(1, Math.min(maxSubSteps, Math.ceil(spanne / bucketSize)))
        const jeSchritt = menge / schritte

        for (let s = 0; s < schritte; s++) {
            const entry = schritte === 1 ? p.c : p.l + (spanne * (s + 0.5)) / schritte
            deposit(map, map.long[0], 0, entry, jeSchritt * anteilLong)
            deposit(map, map.short[0], 0, entry, jeSchritt * (1 - anteilLong))
        }
        map.attributed += menge
    }

    let mass = 0
    for (let r = 0; r < rows; r++) mass += map.long[0][r] + map.short[0][r]
    map.mass[0] = mass
    return map
}

/**
 * Gemeinsame Attribution für beide Karten: wie viel wurde je Periode eröffnet
 * (`add`) und welcher Anteil davon hat bis zum Ende überlebt (`postScale`).
 */
export function attributeOpenInterest(points, { seed = true } = {}) {
    const n = points.length
    const add = new Float64Array(n)
    const decay = new Float64Array(n)
    if (!n) return { add, postScale: decay }

    // Der Startbestand ist NICHT beobachtet — er wurde irgendwann vor dem
    // Fenster eröffnet, zu unbekannten Preisen. Ihn in die erste Kerze zu
    // legen, verlegt bei einem 42-Stunden-Fenster rund 90 % der Kartenmasse
    // an einen frei erfundenen Preis. Mit `seed: false` zählt nur, was im
    // Fenster tatsächlich dazugekommen ist — weniger Abdeckung, dafür
    // gemessen statt geraten.
    add[0] = seed ? points[0].oi : 0
    decay[0] = 1
    for (let i = 1; i < n; i++) {
        const prev = points[i - 1].oi
        const cur = points[i].oi
        decay[i] = prev > 0 ? Math.min(1, cur / prev) : 1
        add[i] = Math.max(0, cur - prev)
    }

    const postScale = new Float64Array(n)
    let acc = 1
    for (let i = n - 1; i >= 0; i--) {
        postScale[i] = acc
        acc *= decay[i]
    }
    // `decay` kommt mit heraus: der Verlaufsaufbau (buildLeverageHistory)
    // dünnt schrittweise aus und kann postScale nicht gebrauchen — das ist ein
    // Rückwärtsprodukt und würde die Zukunft in eine Momentaufnahme tragen.
    return { add, postScale, decay }
}

/**
 * Zeitlicher Verlauf der Liquidationszonen — die Heatmap-Ansicht.
 *
 * Statt einer Momentaufnahme wird EINMAL vorwärts durch die Kerzen gelaufen und
 * nach jeder Kerze der Zustand als Spalte weggeschrieben. Das ist O(n·rows)
 * statt n-mal die ganze Karte neu zu bauen (O(n²·rows)) — und vor allem ist es
 * ehrlich: Spalte j kennt nur Kerzen ≤ j, sieht also nie in die Zukunft.
 *
 * Reihenfolge je Kerze bewusst „einzahlen, dann abräumen": innerhalb einer
 * Kerze ist die Reihenfolge unbekannt, und „schon abgeräumt" ist die
 * konservative Annahme — dieselbe Konvention wie in buildLeverageMap.
 *
 * @returns {{rows:number, cols:number, base:number, bucketSize:number,
 *            ts:Float64Array, mid:Float64Array, long:Float32Array,
 *            short:Float32Array, max:number, tiers:number[]}}
 */
export function buildLeverageHistory(points, opts) {
    const {
        mid, bucketSize, spanPct = 8, mmr = 0.004,
        tiers = LEVERAGE_TIERS, weights = null, maxSubSteps = 32, seed = false,
    } = opts

    const usable = tiers.filter(L => tierPossible(L, mmr))
    const spanNeeded = usable.length
        ? Math.max(...usable.map(L => Math.max(
            1 - liqPriceLong(1, L, mmr),
            liqPriceShort(1, L, mmr) - 1))) * 100 * 1.1
        : spanPct
    const capturePct = Math.max(spanPct, spanNeeded)
    const rows = Math.max(8, Math.ceil((mid * (capturePct / 100) * 2) / bucketSize))
    const base = Math.round(mid / bucketSize) - (rows >> 1)
    const n = points.length

    const leer = {
        rows, cols: 0, base, bucketSize,
        ts: new Float64Array(0), mid: new Float64Array(0),
        o: new Float64Array(0), h: new Float64Array(0), l: new Float64Array(0),
        long: new Float32Array(0), short: new Float32Array(0),
        swept: new Float32Array(0), sweptUntil: new Int32Array(0), max: 0, oi: 0, tiers: usable,
    }
    if (!n || !usable.length) return leer

    const { add, decay } = attributeOpenInterest(points, { seed })
    const gewicht = (k) => (weights ? (weights[k] ?? 0) : 1)

    // Laufender Zustand über alle Stufen zusammengefasst — für die Ansicht
    // reicht die Summe, und rows×cols×tiers wäre um Grössenordnungen mehr
    // Speicher, ohne dass man die Stufen im Bild auseinanderhalten könnte.
    const aktLong = new Float64Array(rows)
    const aktShort = new Float64Array(rows)
    // Abgeräumte Masse wird NICHT verworfen, sondern getrennt weitergeführt.
    // „Hier lag eine Zone und der Preis hat sie gefressen" ist eine andere
    // Aussage als „hier war nie etwas" — und für das Lesen der Karte die
    // interessantere. Die Ansicht zeichnet sie grau.
    const abLong = new Float64Array(rows)
    const abShort = new Float64Array(rows)
    // Spalte des LETZTEN Abräumens je Zeile, −1 = nie abgeräumt.
    // Damit lässt sich die Zone rückwirkend umfärben: alles bis dorthin wurde
    // im Nachhinein gefressen, nur was danach kam, steht heute noch. Ohne das
    // bliebe die ganze Vorgeschichte bunt und das Bild würde mit der Zeit
    // unlesbar.
    const sweptUntil = new Int32Array(rows).fill(-1)

    const long = new Float32Array(rows * n)
    const short = new Float32Array(rows * n)
    const swept = new Float32Array(rows * n)
    const ts = new Float64Array(n)
    const midArr = new Float64Array(n)
    // OHLC mitführen: die Ansicht zeichnet Kerzen, und Dochte zeigen genau die
    // Berührungen, die eine Zone abräumen.
    const oArr = new Float64Array(n)
    const hArr = new Float64Array(n)
    const lArr = new Float64Array(n)
    let max = 0

    const rowFor = (price) => Math.round(price / bucketSize) - base

    for (let i = 0; i < n; i++) {
        const p = points[i]

        // 1) Ausdünnen: geschlossene Positionen treffen den Altbestand anteilig
        const d = decay[i]
        if (d < 1) {
            for (let r = 0; r < rows; r++) { aktLong[r] *= d; aktShort[r] *= d }
        }

        // 2) Einzahlen
        const menge = add[i]
        if (menge > 0) {
            const anteilLong = p.v > 0 ? clamp(p.tb / p.v, 0.15, 0.85) : 0.5
            const spanne = Math.max(0, p.h - p.l)
            const schritte = Math.max(1, Math.min(maxSubSteps, Math.ceil(spanne / bucketSize)))
            const jeSchritt = menge / schritte
            for (let s = 0; s < schritte; s++) {
                const entry = schritte === 1 ? p.c : p.l + (spanne * (s + 0.5)) / schritte
                for (let k = 0; k < usable.length; k++) {
                    const w = gewicht(k)
                    if (!w) continue
                    const L = usable[k]
                    const rL = rowFor(liqPriceLong(entry, L, mmr))
                    if (rL >= 0 && rL < rows) aktLong[rL] += jeSchritt * anteilLong * w
                    const rS = rowFor(liqPriceShort(entry, L, mmr))
                    if (rS >= 0 && rS < rows) aktShort[rS] += jeSchritt * (1 - anteilLong) * w
                }
            }
        }

        // 3) Abräumen: Long-Level unterhalb werden vom Tief geholt, Short
        //    oberhalb vom Hoch. Was der Preis erreicht hat, existiert nicht mehr.
        const rTief = rowFor(p.l)
        for (let r = Math.max(0, rTief); r < rows; r++) {
            if (aktLong[r] > 0) { abLong[r] += aktLong[r]; aktLong[r] = 0; sweptUntil[r] = i }
        }
        const rHoch = rowFor(p.h)
        for (let r = Math.min(rows - 1, rHoch); r >= 0; r--) {
            if (aktShort[r] > 0) { abShort[r] += aktShort[r]; aktShort[r] = 0; sweptUntil[r] = i }
        }

        // 4) Spalte festhalten
        const off = i * rows
        for (let r = 0; r < rows; r++) {
            const a = aktLong[r], b = aktShort[r]
            long[off + r] = a
            short[off + r] = b
            swept[off + r] = abLong[r] + abShort[r]
            if (a > max) max = a
            if (b > max) max = b
        }
        ts[i] = p.t
        midArr[i] = p.c
        oArr[i] = p.o
        hArr[i] = p.h
        lArr[i] = p.l
    }

    return {
        rows, cols: n, base, bucketSize, ts, mid: midArr,
        o: oArr, h: hArr, l: lArr,
        long, short, swept, sweptUntil, max,
        // Offenes Interesse am Ende — Bezug für die Abdeckung in der Legende
        oi: points[n - 1].oi,
        tiers: usable,
    }
}

/**
 * Nullmodell zum Vergleich: reine Hebelgeometrie um den aktuellen Preis, ohne
 * jede Open-Interest-Attribution. Wenn die echte Karte hiergegen nicht besser
 * abschneidet, trägt die ganze ΔOI-Rechnung nichts bei.
 */
export function buildGeometryOnlyMap(mid, opts) {
    const { bucketSize, spanPct = 8, mmr = 0.004, tiers = LEVERAGE_TIERS } = opts
    const usable = tiers.filter(L => tierPossible(L, mmr))
    const rows = Math.max(8, Math.ceil((mid * (spanPct / 100) * 2) / bucketSize))
    const base = Math.round(mid / bucketSize) - (rows >> 1)
    const map = new LeverageMap({ bucketSize, rows, base, tiers: usable })
    map.mmr = mmr
    map.oi = 1
    map.attributed = 2
    for (let k = 0; k < usable.length; k++) {
        deposit(map, map.long[k], k, liqPriceLong(mid, usable[k], mmr), 1)
        deposit(map, map.short[k], k, liqPriceShort(mid, usable[k], mmr), 1)
        map.mass[k] = 2
    }
    return map
}
