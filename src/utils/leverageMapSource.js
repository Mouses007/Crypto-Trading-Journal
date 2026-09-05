/**
 * Datenschicht der Liquidationskarte.
 *
 * Bewusst NICHT Teil von LiveFeed: die Karte hat mit dem Orderbuch nichts zu
 * tun, braucht keinen Sekundentakt und soll auch dann weiterlaufen, wenn die
 * Bookmap eingefroren ist. Der Server liefert nur Rohpunkte, gerechnet wird
 * hier — so kostet ein Klick auf eine andere Hebelstufe keinen Rundlauf.
 *
 * Kein `ref()` / `reactive()` auf die Karte: sie enthält TypedArrays, um die
 * Vue Proxies legen würde. Nach aussen gehen nur Skalare über `onStatus`.
 */
import axios from 'axios'
import { buildLeverageMap, buildEntryMap, LEVERAGE_TIERS } from '../../shared/leverageMap.js'
import { pickBucketSize } from '../../shared/priceBins.js'

/**
 * Grobe Tickgrösse aus der Preishöhe ableiten.
 *
 * `inferTickSize` aus priceBins braucht einen Orderbuch-Snapshot — den hat
 * diese Ansicht nicht, sie kennt nur Kerzen. Für die Zeilenbreite reicht die
 * Grössenordnung völlig; ein Bucket umfasst ohnehin viele Ticks.
 */
function grobeTickgroesse(mid) {
    if (mid > 1000) return 0.1
    if (mid > 10) return 0.001
    if (mid > 0.1) return 0.00001
    return 0.0000001
}

/** Perioden des Endpoints und ihre Länge in Minuten. */
export const LEVMAP_PERIODS = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 }

/**
 * Passende Periode für ein gewünschtes Zeitfenster wählen.
 *
 * Der Endpoint gibt höchstens 500 Punkte. Passt das Fenster nicht hinein, wird
 * hochgestuft — und die TATSÄCHLICH erreichte Spanne zurückgemeldet. Still ein
 * kürzeres Fenster zu zeigen als angefordert wäre die schlechteste Variante:
 * man liest dann Stunden als Tage.
 *
 * '1m' steht zuerst und greift damit nur bei kleinen Fenstern (500 Punkte =
 * 8,3 h). Die Minutenreihe kommt aus dem EIGENEN Archiv des Servers; reicht
 * dessen Abdeckung nicht, stuft der Server auf 5m herab — sichtbar am
 * `period`-Feld der Antwort, das `_schneiden` deshalb benutzt.
 */
export function pickPeriod(wunschStunden) {
    const reihe = ['1m', '5m', '15m', '1h', '4h', '1d']
    for (const p of reihe) {
        const noetig = Math.ceil((wunschStunden * 60) / LEVMAP_PERIODS[p])
        if (noetig <= 500) return { period: p, limit: Math.max(20, noetig) }
    }
    return { period: '1d', limit: 500 }
}

export class LeverageMapSource {
    /**
     * @param {object} opts
     * @param {string} opts.symbol
     * @param {number} [opts.hours]    gewünschtes Zeitfenster
     * @param {number} [opts.spanPct]  Preisspanne um den Mid, einseitig in %
     * @param {number} [opts.mmr]      Maintenance-Margin-Rate
     * @param {Function} [opts.onStatus]  (state, detail) => void
     * @param {Function} [opts.onMap]     () => void  — neue Karte steht bereit
     */
    constructor(opts) {
        this.symbol = opts.symbol
        this.hours = opts.hours || 24
        this.spanPct = opts.spanPct || 8
        this.mmr = opts.mmr ?? 0.004
        this.maxHebel = opts.maxHebel || 0   // echter Max-Hebel des Symbols, 0 = unbekannt
        this.kind = opts.kind || 'leverage'   // 'leverage' | 'entry'
        this.onStatus = opts.onStatus
        this.onMap = opts.onMap

        this.map = null
        this.points = []
        this.rohPunkte = []       // volle Tiefe der Periode, ungeschnitten
        this.rohPeriode = null    // welche Periode dort drin liegt
        this.rohSymbol = null     // zu welchem Symbol der Rohbestand gehört
        this.laufendeKerze = null // die noch offene Periode — nur für den Sweep
        this.meta = { period: '5m', spanneMs: 0, unvollstaendig: false, accountRatio: null, hinweis: '' }
        this.stopped = false
        this.timer = null
        this.backoff = 60000
        // Generationszähler wie `laufendeAnfrage` in OpenInterest.vue: eine
        // späte Antwort des vorigen Symbols/Fensters darf den Zustand einer
        // neueren Anfrage nicht überschreiben.
        this.anfrage = 0
    }

    async start() {
        this.stopped = false
        await this._fetch()
        this._schedule()
    }

    stop() {
        this.stopped = true
        this.anfrage++   // laufende Antworten verfallen
        clearTimeout(this.timer)
        this.timer = null
    }

    _schedule() {
        clearTimeout(this.timer)
        if (this.stopped) return
        this.timer = setTimeout(() => this._fetch().finally(() => this._schedule()), this.backoff)
    }

    /**
     * Symbol/Fenster ändern. Bleibt die Periode dieselbe, wird NICHT neu
     * geladen — der Rohbestand deckt die volle Tiefe ab, das Fenster ist nur
     * ein Ausschnitt daraus. Das Umschalten von 24 h auf 6 h ist damit sofort
     * da statt netzgebunden.
     */
    async update(patch) {
        const altesSymbol = this.symbol
        const alteRohPeriode = this.rohPeriode
        Object.assign(this, patch)
        const { period } = pickPeriod(this.hours)
        // `rohSymbol` zusätzlich prüfen: läuft gerade ein Symbolwechsel-Abruf,
        // gehört der Rohbestand noch zum ALTEN Symbol — der Schnellpfad würde
        // sonst dessen Karte unter dem neuen Namen rechnen.
        if (this.symbol === altesSymbol && this.symbol === this.rohSymbol
            && period === alteRohPeriode && this.rohPunkte.length) {
            this._schneiden()
            this.rebuild()
            this.onStatus?.('ready')
            return
        }
        await this._fetch()
        this._schedule()
    }

    /** Fenster aus dem Rohbestand herausschneiden. */
    _schneiden() {
        // Geschnitten wird nach der Periode, die WIRKLICH im Rohbestand liegt:
        // bei einer 1m-Anfrage kann der Server auf 5m herabgestuft haben, und
        // pickPeriod(hours) schnitte dann fünfmal zu wenige Punkte.
        const period = this.rohPeriode || pickPeriod(this.hours).period
        const periodeMs = LEVMAP_PERIODS[period] * 60000
        const noetig = Math.max(20, Math.ceil((this.hours * 60) / LEVMAP_PERIODS[period]))
        this.points = this.rohPunkte.slice(-noetig)
        this.meta.spanneMs = this.points.length
            ? this.points[this.points.length - 1].t - this.points[0].t
            : 0
        this.meta.period = period
        void periodeMs
    }

    /** Nur die Karte neu rechnen (Stufe, Margin-Rate, Spanne) — ohne Netzverkehr. */
    rebuild() {
        if (!this.points.length) return
        const letzte = this.points[this.points.length - 1]
        const mid = letzte.c
        if (!(mid > 0)) return
        const tick = grobeTickgroesse(mid)
        const bucketSize = pickBucketSize(tick, mid, this.spanPct, 1200)
        const opts = {
            mid, bucketSize, spanPct: this.spanPct, mmr: this.mmr,
            maxHebel: this.maxHebel, tiers: LEVERAGE_TIERS, seed: false,
        }
        this.map = this.kind === 'entry'
            ? buildEntryMap(this.points, opts)
            : buildLeverageMap(this.points, opts)
        this.map.ts = letzte.t
        this.map.spanMs = this.meta.spanneMs
        this.map.periods = this.points.length
        // Die Karte endet mit der letzten VOLLEN Periode — die laufende Kerze
        // wurde bewusst weggelassen. Wo der Preis seither war, weiss aber genau
        // sie: ihr Hoch und Tief markieren die bereits durchlaufenen Zeilen,
        // ohne dass ein eigener Preisstrom nötig wäre.
        if (this.laufendeKerze) {
            this.noteMid(this.laufendeKerze.l)
            this.noteMid(this.laufendeKerze.h)
        }
        this.onMap?.()
    }

    /** Live-Mid nachführen: zwischen zwei Abrufen läuft der Preis weiter. */
    noteMid(mid) {
        if (!this.map || !(mid > 0)) return
        if (mid < this.map.sweepLo) this.map.sweepLo = mid
        if (mid > this.map.sweepHi) this.map.sweepHi = mid
    }

    async _fetch() {
        if (this.stopped) return
        const meine = ++this.anfrage
        const { period } = pickPeriod(this.hours)
        try {
            this.onStatus?.('loading')
            const { data } = await axios.get('/api/binance/leverage-map', {
                params: { symbol: this.symbol, period },
            })
            if (this.stopped || meine !== this.anfrage) return
            // Die laufende Periode weglassen: ihr ΔOI ändert sich noch, sie
            // würde die jüngste — und damit sichtbarste — Schicht verfälschen.
            const punkte = Array.isArray(data.points) ? data.points.slice() : []
            this.laufendeKerze = (data.unvollstaendig && punkte.length)
                ? punkte[punkte.length - 1]
                : null
            if (data.unvollstaendig && punkte.length) punkte.pop()

            this.rohPunkte = punkte
            this.rohPeriode = data.period || period
            this.rohSymbol = this.symbol
            this.meta = {
                period: this.rohPeriode,
                spanneMs: data.spanneMs || 0,
                unvollstaendig: !!data.unvollstaendig,
                accountRatio: data.accountRatio || null,
                hinweis: data.hinweis || '',
            }
            this._schneiden()
            this.backoff = 60000
            if (!punkte.length) {
                this.map = null
                this.onStatus?.('empty', data.hinweis || 'keine Open-Interest-Historie')
                this.onMap?.()
                return
            }
            this.rebuild()
            this.onStatus?.('ready')
        } catch (error) {
            if (this.stopped || meine !== this.anfrage) return
            // /futures/data ist eigenständig gedrosselt — bei Fehlern langsamer
            // nachfragen statt stur weiterzuhämmern.
            this.backoff = Math.min(this.backoff * 2, 300000)
            this.onStatus?.('error', error.response?.data?.error || error.message)
        }
    }
}
