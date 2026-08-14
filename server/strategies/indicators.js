/**
 * Kleine, abhängigkeitsfreie Indikator-Helfer für Strategie-Detektoren.
 *
 * Bewusst keine TA-Bibliothek: gebraucht werden Pivots, RSI, ATR, EMA, ein paar
 * Fibonacci-Level und drei Kerzenmuster. Eine Dependency dafür wäre mehr Risiko
 * als Nutzen — und alles hier muss ohnehin deterministisch und testbar sein.
 *
 * Alle Funktionen erwarten Kerzen im Format { t, o, h, l, c, v }.
 */

export const isBull = (k) => k.c > k.o
export const isBear = (k) => k.c < k.o
export const bodyHigh = (k) => Math.max(k.o, k.c)
export const bodyLow = (k) => Math.min(k.o, k.c)
export const bodySize = (k) => Math.abs(k.c - k.o)
export const range = (k) => k.h - k.l
export const upperWick = (k) => k.h - bodyHigh(k)
export const lowerWick = (k) => bodyLow(k) - k.l

/**
 * Pivot-Hochs: Kerze i hat das höchste High im Fenster [i-left, i+right].
 * `right` Kerzen Bestätigung bedeuten, dass ein Pivot erst `right` Kerzen
 * später feststeht — genau so, wie man es im Chart auch erst später sieht.
 *
 * @returns {Array<{index: number, t: number, price: number}>}
 */
export function pivotHighs(candles, left, right) {
    const out = []
    for (let i = left; i < candles.length - right; i++) {
        const p = candles[i].h
        let ok = true
        for (let j = i - left; j <= i + right; j++) {
            if (j === i) continue
            // >= nach links, > nach rechts: bei exakt gleichen Hochs gewinnt das
            // frühere. Sonst würde eine Doppelspitze zwei Pivots erzeugen.
            if (j < i ? candles[j].h >= p : candles[j].h > p) { ok = false; break }
        }
        if (ok) out.push({ index: i, t: candles[i].t, price: p })
    }
    return out
}

export function pivotLows(candles, left, right) {
    const out = []
    for (let i = left; i < candles.length - right; i++) {
        const p = candles[i].l
        let ok = true
        for (let j = i - left; j <= i + right; j++) {
            if (j === i) continue
            if (j < i ? candles[j].l <= p : candles[j].l < p) { ok = false; break }
        }
        if (ok) out.push({ index: i, t: candles[i].t, price: p })
    }
    return out
}

/**
 * Wilder-RSI. Gibt ein Array gleicher Länge wie `candles` zurück; die ersten
 * `period` Werte sind null (noch keine Aussage möglich).
 */
export function rsi(candles, period = 14) {
    const out = new Array(candles.length).fill(null)
    if (candles.length <= period) return out

    let gain = 0
    let loss = 0
    for (let i = 1; i <= period; i++) {
        const d = candles[i].c - candles[i - 1].c
        if (d >= 0) gain += d
        else loss -= d
    }
    let avgGain = gain / period
    let avgLoss = loss / period
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

    for (let i = period + 1; i < candles.length; i++) {
        const d = candles[i].c - candles[i - 1].c
        const g = d > 0 ? d : 0
        const l = d < 0 ? -d : 0
        avgGain = (avgGain * (period - 1) + g) / period
        avgLoss = (avgLoss * (period - 1) + l) / period
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    }
    return out
}

/** Average True Range (Wilder). Array-Länge wie `candles`, führende null. */
export function atr(candles, period = 14) {
    const out = new Array(candles.length).fill(null)
    if (candles.length <= period) return out

    const tr = new Array(candles.length).fill(0)
    tr[0] = range(candles[0])
    for (let i = 1; i < candles.length; i++) {
        const prevClose = candles[i - 1].c
        tr[i] = Math.max(
            candles[i].h - candles[i].l,
            Math.abs(candles[i].h - prevClose),
            Math.abs(candles[i].l - prevClose),
        )
    }

    let sum = 0
    for (let i = 1; i <= period; i++) sum += tr[i]
    let value = sum / period
    out[period] = value
    for (let i = period + 1; i < candles.length; i++) {
        value = (value * (period - 1) + tr[i]) / period
        out[i] = value
    }
    return out
}

/** Exponentieller gleitender Durchschnitt über Schlusskurse. */
export function ema(candles, period) {
    const out = new Array(candles.length).fill(null)
    if (candles.length < period) return out
    const k = 2 / (period + 1)
    let sum = 0
    for (let i = 0; i < period; i++) sum += candles[i].c
    let value = sum / period
    out[period - 1] = value
    for (let i = period; i < candles.length; i++) {
        value = candles[i].c * k + value * (1 - k)
        out[i] = value
    }
    return out
}

/**
 * EMA über eine beliebige Zahlenreihe (nicht nur Schlusskurse).
 *
 * Wird für die Signallinie des MACD gebraucht: die glättet die MACD-Linie,
 * nicht den Kurs. Führende `null` werden übersprungen — der Durchschnitt
 * beginnt erst, wenn genug echte Werte da sind.
 */
export function emaSerie(werte, period) {
    const out = new Array(werte.length).fill(null)
    if (period < 1) return out
    const k = 2 / (period + 1)
    let summe = 0
    let gezaehlt = 0
    let wert = null
    for (let i = 0; i < werte.length; i++) {
        const v = werte[i]
        if (v === null || v === undefined || !Number.isFinite(v)) continue
        if (wert === null) {
            summe += v
            gezaehlt++
            if (gezaehlt < period) continue
            wert = summe / period
        } else {
            wert = v * k + wert * (1 - k)
        }
        out[i] = wert
    }
    return out
}

/**
 * MACD — Abstand zweier EMAs, geglättet.
 *
 * Drei Linien, die getrennt abgefragt werden:
 *   'macd'   schnelle EMA minus langsame EMA
 *   'signal' EMA über die MACD-Linie
 *   'hist'   MACD minus Signal (das Histogramm)
 *
 * @param {Array}  candles
 * @param {object} opts { fast, slow, signal, line }
 * @returns {Array<number|null>}
 */
export function macd(candles, { fast = 12, slow = 26, signal = 9, line = 'macd' } = {}) {
    const schnell = ema(candles, Math.max(1, Math.round(fast)))
    const langsam = ema(candles, Math.max(1, Math.round(slow)))
    const linie = candles.map((_, i) =>
        (schnell[i] === null || langsam[i] === null) ? null : schnell[i] - langsam[i])
    if (line === 'macd') return linie
    const signalLinie = emaSerie(linie, Math.max(1, Math.round(signal)))
    if (line === 'signal') return signalLinie
    return linie.map((v, i) => (v === null || signalLinie[i] === null) ? null : v - signalLinie[i])
}

/**
 * Money Flow Index — RSI mit Volumengewicht.
 *
 * Steigt der typische Preis gegenüber der Vorkerze, zählt der Umsatz als
 * Zufluss, sonst als Abfluss. Ohne Volumen (v = 0) fällt die Gewichtung auf 1
 * zurück; sonst wäre der Wert auf umsatzlosen Abschnitten undefiniert.
 */
export function mfi(candles, period = 14) {
    const out = new Array(candles.length).fill(null)
    if (candles.length <= period) return out
    const tp = candles.map((k) => (k.h + k.l + k.c) / 3)
    const zu = new Array(candles.length).fill(0)
    const ab = new Array(candles.length).fill(0)
    for (let i = 1; i < candles.length; i++) {
        const fluss = tp[i] * (candles[i].v > 0 ? candles[i].v : 1)
        if (tp[i] > tp[i - 1]) zu[i] = fluss
        else if (tp[i] < tp[i - 1]) ab[i] = fluss
        // Bei exakt gleichem typischem Preis zählt weder zu noch ab.
    }
    let sZu = 0
    let sAb = 0
    for (let i = 1; i <= period; i++) { sZu += zu[i]; sAb += ab[i] }

    const setze = (i) => {
        if (sAb === 0) { out[i] = sZu === 0 ? 50 : 100; return }
        // Auf 0–100 begrenzen: rechnerisch kann der Wert den Bereich nicht
        // verlassen, durch Rundung im Gleitkomma aber schon (gemessen bis
        // ±3e-14). Eine Regel wie „MFI > 80" darf nicht an einem 100,000…1
        // hängen.
        const v = 100 - 100 / (1 + sZu / sAb)
        out[i] = v < 0 ? 0 : v > 100 ? 100 : v
    }
    setze(period)

    for (let i = period + 1; i < candles.length; i++) {
        // Das gleitende Fenster addiert und subtrahiert dieselben Beträge in
        // unterschiedlicher Reihenfolge; dabei sammelt sich Rundungsfehler an.
        // Beide Summen sind Summen nicht-negativer Werte — was darunter
        // liegt, ist reine Drift und wird gekappt.
        sZu += zu[i] - zu[i - period]
        sAb += ab[i] - ab[i - period]
        if (sZu < 0) sZu = 0
        if (sAb < 0) sAb = 0
        setze(i)
    }
    return out
}

/** Typischer Preis einer Kerze — die übliche Grundlage für VWAP. */
const typischerPreis = (k) => (k.h + k.l + k.c) / 3

/**
 * Volumengewichteter Durchschnittspreis (VWAP).
 *
 * Zwei Betriebsarten, die sich grundlegend unterscheiden:
 *
 *   'session'  Setzt zu jedem UTC-Tageswechsel zurück. Das ist der VWAP, den
 *              Trader meinen, wenn sie „die VWAP" sagen — eine Linie, die am
 *              Tagesanfang beim Preis startet und im Tagesverlauf träger wird.
 *   'rolling'  Gleitendes Fenster über `period` Kerzen, verhält sich wie ein
 *              gleitender Durchschnitt mit Volumengewicht.
 *
 * Ohne Volumen (v = 0) fällt die Gewichtung auf 1 je Kerze zurück; sonst wären
 * ganze Abschnitte NaN, statt wenigstens den Durchschnittspreis zu liefern.
 *
 * @param {Array}  candles
 * @param {object} opts { anchor: 'session'|'rolling', period }
 * @returns {Array<number|null>}
 */
export function vwap(candles, { anchor = 'session', period = 20 } = {}) {
    const out = new Array(candles.length).fill(null)
    if (!candles.length) return out

    if (anchor === 'rolling') {
        const n = Math.max(1, Math.round(period))
        let summePV = 0
        let summeV = 0
        for (let i = 0; i < candles.length; i++) {
            const v = candles[i].v > 0 ? candles[i].v : 1
            summePV += typischerPreis(candles[i]) * v
            summeV += v
            if (i >= n) {
                const alt = candles[i - n]
                const av = alt.v > 0 ? alt.v : 1
                summePV -= typischerPreis(alt) * av
                summeV -= av
            }
            out[i] = summeV > 0 ? summePV / summeV : null
        }
        return out
    }

    // 'session': Rücksetzen beim UTC-Tageswechsel
    let summePV = 0
    let summeV = 0
    let tag = null
    for (let i = 0; i < candles.length; i++) {
        const k = candles[i]
        const heute = Math.floor(k.t / 86400000)
        if (tag === null || heute !== tag) { summePV = 0; summeV = 0; tag = heute }
        const v = k.v > 0 ? k.v : 1
        summePV += typischerPreis(k) * v
        summeV += v
        out[i] = summeV > 0 ? summePV / summeV : null
    }
    return out
}

/**
 * VWAP-Band: VWAP plus `mult` volumengewichtete Standardabweichungen.
 * Negatives `mult` ergibt das untere Band. Bänder sind bei VWAP-Strategien
 * meist wichtiger als die Linie selbst — dort liegen Überdehnung und Umkehr.
 */
export function vwapBand(candles, { anchor = 'session', period = 20, mult = 2 } = {}) {
    const linie = vwap(candles, { anchor, period })
    const out = new Array(candles.length).fill(null)
    if (!candles.length) return out

    if (anchor === 'rolling') {
        const n = Math.max(1, Math.round(period))
        for (let i = 0; i < candles.length; i++) {
            if (linie[i] === null) continue
            let sw = 0
            let sv = 0
            for (let j = Math.max(0, i - n + 1); j <= i; j++) {
                const v = candles[j].v > 0 ? candles[j].v : 1
                const d = typischerPreis(candles[j]) - linie[i]
                sw += v * d * d
                sv += v
            }
            out[i] = sv > 0 ? linie[i] + mult * Math.sqrt(sw / sv) : null
        }
        return out
    }

    // Session: gewichtete Momente führen. Abweichungsquadrate gegen den
    // jeweils WANDERNDEN Zwischen-VWAP aufzusummieren unterschätzt die
    // Varianz systematisch (für 1,2,3 käme σ≈0,645 statt korrekt 0,816) —
    // korrekt ist Var = Σwx²/Σw − VWAP², mit dem aktuellen Gesamt-VWAP.
    let sv = 0
    let sx2 = 0
    let tag = null
    for (let i = 0; i < candles.length; i++) {
        const k = candles[i]
        const heute = Math.floor(k.t / 86400000)
        if (tag === null || heute !== tag) { sv = 0; sx2 = 0; tag = heute }
        const v = k.v > 0 ? k.v : 1
        const x = typischerPreis(k)
        sv += v
        sx2 += v * x * x
        if (linie[i] === null || sv <= 0) { out[i] = null; continue }
        const varianz = Math.max(0, sx2 / sv - linie[i] * linie[i])
        out[i] = linie[i] + mult * Math.sqrt(varianz)
    }
    return out
}

/** Einfacher gleitender Durchschnitt über Schlusskurse. */
export function sma(candles, period) {
    const out = new Array(candles.length).fill(null)
    if (candles.length < period || period < 1) return out
    let summe = 0
    for (let i = 0; i < candles.length; i++) {
        summe += candles[i].c
        if (i >= period) summe -= candles[i - period].c
        if (i >= period - 1) out[i] = summe / period
    }
    return out
}

/**
 * Fibonacci-Retracement-Preis zwischen Bewegungsstart und -ende.
 * `level` 0.786 heisst: 78,6 % der Bewegung wieder abgegeben.
 */
export function fibLevel(from, to, level) {
    return to - (to - from) * level
}

// ── Kerzenmuster für die Ablehnungs-Bestätigung ──────────────────────────

/** Bullishes Engulfing: Körper umschliesst den Körper der Vorkerze. */
export function isBullishEngulfing(prev, cur) {
    return isBear(prev) && isBull(cur) &&
        cur.c >= bodyHigh(prev) && cur.o <= bodyLow(prev)
}

export function isBearishEngulfing(prev, cur) {
    return isBull(prev) && isBear(cur) &&
        cur.c <= bodyLow(prev) && cur.o >= bodyHigh(prev)
}

/**
 * Hammer: langer unterer Docht, kleiner Körper oben.
 * `wickRatio` = wie viel länger der Docht mindestens sein muss als der Körper.
 */
export function isHammer(k, wickRatio = 2) {
    const b = bodySize(k)
    if (b <= 0) return lowerWick(k) > upperWick(k) * 2
    return lowerWick(k) >= b * wickRatio && upperWick(k) <= b
}

/** Shooting Star — das Spiegelbild des Hammers. */
export function isShootingStar(k, wickRatio = 2) {
    const b = bodySize(k)
    if (b <= 0) return upperWick(k) > lowerWick(k) * 2
    return upperWick(k) >= b * wickRatio && lowerWick(k) <= b
}

/**
 * Advancing Wick: der Docht in Gegenrichtung ist deutlich länger als beim
 * Vorgänger — der Markt lehnt das Niveau zunehmend ab.
 */
export function isAdvancingWick(prev, cur, direction) {
    return direction === 'long'
        ? lowerWick(cur) > lowerWick(prev) && lowerWick(cur) > bodySize(cur)
        : upperWick(cur) > upperWick(prev) && upperWick(cur) > bodySize(cur)
}

/**
 * Prüft, ob eine Kerze das Setup in Richtung `direction` bestätigt
 * (Engulfing ODER Hammer/Star ODER Advancing Wick).
 */
export function hasRejectionCandle(prev, cur, direction) {
    if (!prev || !cur) return false
    if (direction === 'long') {
        return isBullishEngulfing(prev, cur) || isHammer(cur) || isAdvancingWick(prev, cur, 'long')
    }
    return isBearishEngulfing(prev, cur) || isShootingStar(cur) || isAdvancingWick(prev, cur, 'short')
}

/**
 * Bollinger-Bänder.
 *
 * Basis wahlweise SMA (Standard) oder EMA — Rang 21 der Kandidatenliste
 * verlangt ausdrücklich eine EMA-Basis, und mit SMA käme eine andere Strategie
 * heraus als beschrieben.
 *
 * Die Standardabweichung wird über dasselbe Fenster wie die Basis gerechnet und
 * ist die der Grundgesamtheit (Nenner n), so wie es Handelsplattformen tun.
 *
 * @returns {{ middle: Array, upper: Array, lower: Array }} Arrays wie `candles`
 */
export function bollinger(candles, { period = 20, mult = 2, basis = 'sma' } = {}) {
    const n = candles.length
    const middle = basis === 'ema' ? ema(candles, period) : sma(candles, period)
    const upper = new Array(n).fill(null)
    const lower = new Array(n).fill(null)

    for (let i = period - 1; i < n; i++) {
        const m = middle[i]
        if (m === null || m === undefined) continue
        let quadrate = 0
        for (let j = i - period + 1; j <= i; j++) {
            const d = candles[j].c - m
            quadrate += d * d
        }
        const sd = Math.sqrt(quadrate / period)
        upper[i] = m + mult * sd
        lower[i] = m - mult * sd
    }
    return { middle, upper, lower }
}

/**
 * Average Directional Index nach Wilder, mit den Richtungsindikatoren.
 *
 * ADX misst die STÄRKE eines Trends, nicht seine Richtung — die steht in
 * +DI/−DI. Beides wird gebraucht: Rang 6 filtert mit ADX und handelt in
 * Richtung des dominanten DI.
 *
 * @returns {{ adx: Array, plusDI: Array, minusDI: Array }}
 */
export function adx(candles, period = 14) {
    const n = candles.length
    const out = { adx: new Array(n).fill(null), plusDI: new Array(n).fill(null), minusDI: new Array(n).fill(null) }
    if (n <= period * 2) return out

    const tr = new Array(n).fill(0)
    const plusDM = new Array(n).fill(0)
    const minusDM = new Array(n).fill(0)

    for (let i = 1; i < n; i++) {
        const hoch = candles[i].h - candles[i - 1].h
        const tief = candles[i - 1].l - candles[i].l
        plusDM[i] = hoch > tief && hoch > 0 ? hoch : 0
        minusDM[i] = tief > hoch && tief > 0 ? tief : 0
        const prevClose = candles[i - 1].c
        tr[i] = Math.max(
            candles[i].h - candles[i].l,
            Math.abs(candles[i].h - prevClose),
            Math.abs(candles[i].l - prevClose),
        )
    }

    // Wilder-Glättung: erste Summe roh, danach fortlaufend
    let trS = 0
    let plusS = 0
    let minusS = 0
    for (let i = 1; i <= period; i++) { trS += tr[i]; plusS += plusDM[i]; minusS += minusDM[i] }

    const dx = new Array(n).fill(null)
    for (let i = period; i < n; i++) {
        if (i > period) {
            trS = trS - trS / period + tr[i]
            plusS = plusS - plusS / period + plusDM[i]
            minusS = minusS - minusS / period + minusDM[i]
        }
        if (trS === 0) continue
        const pDI = (plusS / trS) * 100
        const mDI = (minusS / trS) * 100
        out.plusDI[i] = pDI
        out.minusDI[i] = mDI
        const summe = pDI + mDI
        dx[i] = summe === 0 ? 0 : (Math.abs(pDI - mDI) / summe) * 100
    }

    // ADX = geglättetes DX, erster Wert als Mittel der ersten `period` DX-Werte
    const ersterDx = period
    const startAdx = ersterDx + period - 1
    if (startAdx >= n) return out
    let summe = 0
    for (let i = ersterDx; i < ersterDx + period; i++) summe += dx[i] ?? 0
    let wert = summe / period
    out.adx[startAdx] = wert
    for (let i = startAdx + 1; i < n; i++) {
        wert = (wert * (period - 1) + (dx[i] ?? 0)) / period
        out.adx[i] = wert
    }
    return out
}

/**
 * Stochastik-Oszillator (%K/%D).
 *
 * `smoothK = 1` ergibt die schnelle Variante, `smoothK = 3` die übliche
 * langsame. %D ist der gleitende Durchschnitt von %K.
 *
 * @returns {{ k: Array, d: Array }}
 */
export function stochastic(candles, { period = 14, smoothK = 3, smoothD = 3 } = {}) {
    const n = candles.length
    const rohK = new Array(n).fill(null)

    for (let i = period - 1; i < n; i++) {
        let hoch = -Infinity
        let tief = Infinity
        for (let j = i - period + 1; j <= i; j++) {
            if (candles[j].h > hoch) hoch = candles[j].h
            if (candles[j].l < tief) tief = candles[j].l
        }
        const spanne = hoch - tief
        // Ohne Spanne gibt es keine Position im Bereich — 50 ist die neutrale
        // Antwort und verhindert eine Division durch null.
        rohK[i] = spanne === 0 ? 50 : ((candles[i].c - tief) / spanne) * 100
    }

    const glaetten = (reihe, laenge) => {
        if (laenge <= 1) return reihe.slice()
        const res = new Array(n).fill(null)
        for (let i = 0; i < n; i++) {
            if (i < laenge - 1) continue
            let summe = 0
            let zaehler = 0
            for (let j = i - laenge + 1; j <= i; j++) {
                if (reihe[j] === null) { zaehler = 0; break }
                summe += reihe[j]; zaehler++
            }
            if (zaehler === laenge) res[i] = summe / laenge
        }
        return res
    }

    const k = glaetten(rohK, smoothK)
    const d = glaetten(k, smoothD)
    return { k, d }
}
