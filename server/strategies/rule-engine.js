/**
 * Regel-Interpreter — Strategien als Daten statt als Code.
 *
 * Eine Regelstrategie ist eine JSON-Beschreibung aus Bausteinen. Dieser
 * Interpreter wendet sie auf Kerzen an und liefert dasselbe Ergebnis wie eine
 * handgeschriebene Strategie: `{ setups, events, diagnostics }`. Dadurch laufen
 * Backtest, Papierbetrieb, Auswertung und Optimizer unverändert weiter — sie
 * merken nicht, ob dahinter Code oder eine Beschreibung steckt.
 *
 * Ausdrücklich NICHT: es wird kein Code erzeugt und nichts ausgewertet, was von
 * aussen kommt. Die Beschreibung wählt nur aus fest eingebauten Bausteinen aus.
 * Ein unbekannter Baustein ist ein Validierungsfehler, keine Ausführung.
 *
 * ── Aufbau einer Regelstrategie ──
 *   indicators      Welche Linien berechnet werden (ema, sma, rsi, atr)
 *   signal          Was ein Setup auslöst (Pivot-Hoch/-Tief, Kreuzung)
 *   signalFilters   Bedingungen, die beim Signal erfüllt sein müssen
 *   entry           Wann eingestiegen wird (Berührung eines Ankers)
 *   invalidations   Was das wartende Setup abbricht (Bedingungen, Timeout)
 *   stopLoss        Anker + Abstand
 *   takeProfit      Festes Chance/Risiko oder ein Anker
 *
 * Jede Zahl darf statt eines festen Werts auf einen Parameter zeigen
 * (`{ param: 'name' }`). Nur so kann der Backtest sie variieren und der
 * Optimizer sie vorschlagen.
 *
 * detect() ist eine REINE Funktion: keine DB, kein Netz, kein Date.now().
 */

import {
    ema, sma, rsi, atr, vwap, vwapBand, macd, mfi, bollinger, adx, stochastic, pivotHighs, pivotLows,
    isBull, isBear, bodySize, range,
    isHammer, isShootingStar, isBullishEngulfing, isBearishEngulfing, isAdvancingWick,
} from './indicators.js'

export const RULE_ENGINE_VERSION = 1

/** Was die Beschreibung überhaupt anbieten darf. Erweiterung nur hier. */
export const BAUSTEINE = {
    indikatoren: ['ema', 'sma', 'rsi', 'atr', 'mfi', 'vwap', 'vwapBand',
        'macd', 'macdSignal', 'macdHist',
        'bollUpper', 'bollMiddle', 'bollLower', 'adx', 'plusDI', 'minusDI',
        'stochK', 'stochD'],
    bollBasis: ['sma', 'ema'],
    vwapAnker: ['session', 'rolling'],
    signale: ['pivotHigh', 'pivotLow', 'crossUp', 'crossDown', 'pattern'],
    muster: ['bullishEngulfing', 'bearishEngulfing', 'hammer', 'shootingStar'],
    einstieg: ['touch', 'immediate'],
    vergleiche: [
        'gt', 'lt', 'gte', 'lte',
        'distancePctGt', 'distancePctLt',
        'crossesAbove', 'crossesBelow',
        'isBullish', 'isBearish',
        // Kerzenmuster — brauchen keine Seiten, nur die Kerze (und teils ihre
        // Vorgängerin). `value` ist bei Hammer/Star das Verhältnis Docht zu
        // Körper (Vorgabe 2).
        'isHammer', 'isShootingStar', 'isBullishEngulfing', 'isBearishEngulfing',
        'isAdvancingWick',
        'higherThanPrevSignal', 'lowerThanPrevSignal',
    ],
    anker: ['close', 'open', 'high', 'low', 'signalPrice', 'signalHigh', 'signalLow',
        'correctionLow', 'correctionHigh', 'entryPrice',
        // Letztes bestätigtes Swing-Hoch/-Tief VOR der aktuellen Kerze — der
        // übliche Ort für einen Stop. Nicht dasselbe wie `signalLow`: das ist
        // die Kerze des Auslösers, hier ist es der letzte Wendepunkt davor.
        'lastSwingLow', 'lastSwingHigh'],
    ziele: ['rr', 'anchor', 'none'],
}

// ── Werte auflösen ───────────────────────────────────────────────────────

/** Zahl oder Parameter-Referenz → Zahl. */
export function zahl(wert, params, fallback = 0) {
    if (wert === null || wert === undefined) return fallback
    if (typeof wert === 'number') return Number.isFinite(wert) ? wert : fallback
    if (typeof wert === 'object' && wert.param !== undefined) {
        const v = Number(params?.[wert.param])
        return Number.isFinite(v) ? v : fallback
    }
    const v = Number(wert)
    return Number.isFinite(v) ? v : fallback
}

/**
 * Letztes bestätigtes Swing-Hoch/-Tief vor Kerze `i`.
 *
 * „Bestätigt" heisst: der Pivot liegt weit genug zurück, dass seine rechten
 * Bestätigungskerzen bereits geschlossen sind. Ohne diese Bedingung wäre der
 * Wert ein Blick in die Zukunft.
 *
 * Die Pivots werden einmal je Durchlauf berechnet und im Kontext behalten —
 * sie bei jeder Kerze neu zu suchen wäre quadratisch.
 */
function letzterSwing(ctx, i, art) {
    const links = ctx.swingLinks ?? 5
    const rechts = ctx.swingRechts ?? 2
    if (!ctx._swings) ctx._swings = {}
    if (!ctx._swings[art]) {
        ctx._swings[art] = art === 'low'
            ? pivotLows(ctx.candles, links, rechts)
            : pivotHighs(ctx.candles, links, rechts)
    }
    const liste = ctx._swings[art]
    let treffer = null
    for (const p of liste) {
        if (p.index + rechts > i) break     // noch nicht bestätigt
        if (p.index >= i) break             // nicht die aktuelle Kerze selbst
        treffer = p.price
    }
    return treffer
}

/**
 * Eine Referenz zu einem Zahlenwert an Kerze `i` auflösen.
 * Referenzen sind Zeichenketten (Anker oder Indikator-Id) oder `{value}`/`{param}`.
 */
function loese(ref, ctx, i) {
    if (ref === null || ref === undefined) return null
    if (typeof ref === 'number') return ref
    if (typeof ref === 'object') {
        if (ref.value !== undefined) return zahl(ref.value, ctx.params, null)
        if (ref.param !== undefined) return zahl(ref, ctx.params, null)
        return null
    }

    const k = ctx.candles[i]
    switch (ref) {
        case 'close': return k.c
        case 'open': return k.o
        case 'high': return k.h
        case 'low': return k.l
        case 'signalPrice': return ctx.setup?.signalPrice ?? null
        case 'signalHigh': return ctx.setup?.signalHigh ?? null
        case 'signalLow': return ctx.setup?.signalLow ?? null
        case 'correctionLow': return ctx.laufend?.tief ?? null
        case 'correctionHigh': return ctx.laufend?.hoch ?? null
        case 'entryPrice': return ctx.setup?.entry ?? null
        case 'lastSwingLow': return letzterSwing(ctx, i, 'low')
        case 'lastSwingHigh': return letzterSwing(ctx, i, 'high')
        default: {
            const serie = ctx.indikatoren[ref]
            if (!serie) return null
            const v = serie[i]
            return v === null || v === undefined ? null : v
        }
    }
}

// ── Bedingungen ──────────────────────────────────────────────────────────

/**
 * Wertet eine einzelne Bedingung an Kerze `i` aus.
 * Fehlt ein Wert (z. B. Indikator noch nicht eingeschwungen), gilt die
 * Bedingung als NICHT erfüllt — geraten wird nicht.
 */
function pruefe(bed, ctx, i) {
    const k = ctx.candles[i]

    switch (bed.op) {
        case 'isBullish': {
            if (k.c <= k.o) return false
            const tol = zahl(bed.value, ctx.params, 0)
            if (tol <= 0) return true
            const spanne = range(k)
            return spanne <= 0 ? true : (bodySize(k) / spanne) * 100 > tol
        }
        case 'isBearish': {
            if (k.c >= k.o) return false
            const tol = zahl(bed.value, ctx.params, 0)
            if (tol <= 0) return true
            const spanne = range(k)
            return spanne <= 0 ? true : (bodySize(k) / spanne) * 100 > tol
        }
        case 'isHammer': return isHammer(k, zahl(bed.value, ctx.params, 2))
        case 'isShootingStar': return isShootingStar(k, zahl(bed.value, ctx.params, 2))
        case 'isBullishEngulfing': return i > 0 && isBullishEngulfing(ctx.candles[i - 1], k)
        case 'isBearishEngulfing': return i > 0 && isBearishEngulfing(ctx.candles[i - 1], k)
        case 'isAdvancingWick':
            // Der Gegendocht wächst — der Markt lehnt das Niveau zunehmend ab.
            // Die Richtung ist die der Strategie, nicht die der Kerze.
            return i > 0 && isAdvancingWick(ctx.candles[i - 1], k, ctx.richtung || 'long')

        case 'higherThanPrevSignal':
            return ctx.setup?.prevSignalPrice != null
                && ctx.setup.signalPrice > ctx.setup.prevSignalPrice
        case 'lowerThanPrevSignal':
            return ctx.setup?.prevSignalPrice != null
                && ctx.setup.signalPrice < ctx.setup.prevSignalPrice
    }

    const a = loese(bed.left, ctx, i)
    const b = loese(bed.right, ctx, i)
    if (a === null || b === null) return false

    switch (bed.op) {
        case 'gt': return a > b
        case 'lt': return a < b
        case 'gte': return a >= b
        case 'lte': return a <= b
        // Abstand in Prozent, bezogen auf den Vergleichswert — so lässt sich
        // „mindestens 2,5 % über der EMA" ausdrücken, ohne absolute Kurse.
        case 'distancePctGt': {
            if (b === 0) return false
            return ((a - b) / Math.abs(b)) * 100 > zahl(bed.value, ctx.params, 0)
        }
        case 'distancePctLt': {
            if (b === 0) return false
            return ((a - b) / Math.abs(b)) * 100 < zahl(bed.value, ctx.params, 0)
        }
        case 'crossesAbove': {
            if (i === 0) return false
            const av = loese(bed.left, ctx, i - 1)
            const bv = loese(bed.right, ctx, i - 1)
            return av !== null && bv !== null && av <= bv && a > b
        }
        case 'crossesBelow': {
            if (i === 0) return false
            const av = loese(bed.left, ctx, i - 1)
            const bv = loese(bed.right, ctx, i - 1)
            return av !== null && bv !== null && av >= bv && a < b
        }
        default: return false
    }
}

const alleErfuellt = (liste, ctx, i) => (liste || []).every((b) => pruefe(b, ctx, i))

// ── Indikatoren ──────────────────────────────────────────────────────────

function baueIndikatoren(regeln, candles, params) {
    const out = {}
    for (const def of regeln.indicators || []) {
        const periode = Math.max(1, Math.round(zahl(def.period, params, 14)))
        switch (def.type) {
            case 'ema': out[def.id] = ema(candles, periode); break
            case 'sma': out[def.id] = sma(candles, periode); break
            case 'rsi': out[def.id] = rsi(candles, periode); break
            case 'atr': out[def.id] = atr(candles, periode); break
            // VWAP kennt zusätzlich einen Anker (Tagesreset oder gleitend) und
            // beim Band einen Faktor für die Standardabweichung.
            case 'vwap':
                out[def.id] = vwap(candles, { anchor: def.anchor || 'session', period: periode })
                break
            case 'vwapBand':
                out[def.id] = vwapBand(candles, {
                    anchor: def.anchor || 'session', period: periode,
                    mult: zahl(def.mult, params, 2),
                })
                break
            case 'mfi': out[def.id] = mfi(candles, periode); break
            // MACD besteht aus drei Linien. Statt eines Indikators mit drei
            // Ausgängen gibt es drei Typen — so bleibt die Regel bei einer
            // Referenz pro Id und die Auswahl im Formular eindeutig.
            case 'macd':
            case 'macdSignal':
            case 'macdHist': {
                const linie = def.type === 'macd' ? 'macd' : def.type === 'macdSignal' ? 'signal' : 'hist'
                out[def.id] = macd(candles, {
                    fast: zahl(def.fast, params, 12),
                    slow: zahl(def.slow, params, 26),
                    signal: zahl(def.signal, params, 9),
                    line: linie,
                })
                break
            }
            // Bollinger, ADX und Stochastik liefern jeweils mehrere Linien.
            // Nach demselben Muster wie MACD bekommt jede Linie einen eigenen
            // Typ, damit eine Regel immer genau eine Id referenziert.
            case 'bollUpper':
            case 'bollMiddle':
            case 'bollLower': {
                const b = bollinger(candles, {
                    period: periode,
                    mult: zahl(def.mult, params, 2),
                    basis: def.basis === 'ema' ? 'ema' : 'sma',
                })
                out[def.id] = def.type === 'bollUpper' ? b.upper : def.type === 'bollLower' ? b.lower : b.middle
                break
            }
            case 'adx':
            case 'plusDI':
            case 'minusDI': {
                const a = adx(candles, periode)
                out[def.id] = def.type === 'plusDI' ? a.plusDI : def.type === 'minusDI' ? a.minusDI : a.adx
                break
            }
            case 'stochK':
            case 'stochD': {
                const s = stochastic(candles, {
                    period: periode,
                    smoothK: Math.max(1, Math.round(zahl(def.smoothK, params, 3))),
                    smoothD: Math.max(1, Math.round(zahl(def.smoothD, params, 3))),
                })
                out[def.id] = def.type === 'stochK' ? s.k : s.d
                break
            }
            default: out[def.id] = new Array(candles.length).fill(null)
        }
    }
    return out
}

// ── Signale ──────────────────────────────────────────────────────────────

/**
 * Findet die Auslösepunkte. Ein Signal ist noch kein Setup — erst die
 * Signalfilter entscheiden darüber.
 *
 * @returns {Array<{index, price, high, low, prevPrice}>}
 */
function findeSignale(regeln, ctx) {
    const s = regeln.signal || {}
    const candles = ctx.candles
    const links = Math.max(1, Math.round(zahl(s.left, ctx.params, 5)))
    const rechts = Math.max(1, Math.round(zahl(s.right, ctx.params, 2)))

    if (s.type === 'pivotHigh' || s.type === 'pivotLow') {
        const roh = s.type === 'pivotHigh'
            ? pivotHighs(candles, links, rechts)
            : pivotLows(candles, links, rechts)
        return roh.map((p, n) => ({
            index: p.index,
            price: p.price,
            high: candles[p.index].h,
            low: candles[p.index].l,
            prevPrice: n > 0 ? roh[n - 1].price : null,
        }))
    }

    // Kerzenmuster als Auslöser. `prevOpposite` verlangt zusätzlich N Kerzen der
    // Gegenfarbe unmittelbar davor — das ist der Qualitätsfilter aus Rang 5
    // („mindestens drei Gegenkerzen vor der Engulfing-Kerze"), ohne den das
    // Muster in jeder Seitwärtsphase feuert.
    if (s.type === 'pattern') {
        const muster = String(s.pattern || '')
        const davor = Math.max(0, Math.round(zahl(s.prevOpposite, ctx.params, 0)))
        const bullisch = muster === 'bullishEngulfing' || muster === 'hammer'
        const treffer = []
        for (let i = 1; i < candles.length; i++) {
            if (!pruefe({ op: `is${muster.charAt(0).toUpperCase()}${muster.slice(1)}`, value: s.value }, ctx, i)) continue
            if (davor > 0) {
                if (i - davor < 0) continue
                let alleGegen = true
                for (let j = i - davor; j < i; j++) {
                    const g = candles[j]
                    // Gegenfarbe zum Muster: vor einem Kaufsignal fallende Kerzen
                    if (bullisch ? g.c >= g.o : g.c <= g.o) { alleGegen = false; break }
                }
                if (!alleGegen) continue
            }
            treffer.push({
                index: i, price: candles[i].c,
                high: candles[i].h, low: candles[i].l,
                prevPrice: treffer.length ? treffer[treffer.length - 1].price : null,
            })
        }
        return treffer
    }

    if (s.type === 'crossUp' || s.type === 'crossDown') {
        const op = s.type === 'crossUp' ? 'crossesAbove' : 'crossesBelow'
        const treffer = []
        let vorher = null
        for (let i = 1; i < candles.length; i++) {
            if (pruefe({ op, left: s.a, right: s.b }, ctx, i)) {
                const preis = loese(s.a, ctx, i)
                treffer.push({ index: i, price: preis, high: candles[i].h, low: candles[i].l, prevPrice: vorher })
                vorher = preis
            }
        }
        return treffer
    }

    return []
}

// ── Kursmarken ───────────────────────────────────────────────────────────

function berechneStop(regeln, ctx, i, richtung) {
    const def = regeln.stopLoss || {}
    const anker = loese(def.anchor, ctx, i)
    if (anker === null) return null
    const versatz = zahl(def.offsetPct, ctx.params, 0)
    // Der Versatz zeigt immer VOM Einstieg weg
    return richtung === 'long'
        ? anker * (1 - versatz / 100)
        : anker * (1 + versatz / 100)
}

function berechneZiel(regeln, ctx, i, richtung, entry, stopLoss) {
    const def = regeln.takeProfit || { mode: 'none' }
    if (def.mode === 'none') return 0
    if (def.mode === 'rr') {
        const r = zahl(def.rr, ctx.params, 2)
        const risiko = Math.abs(entry - stopLoss)
        return richtung === 'long' ? entry + risiko * r : entry - risiko * r
    }
    const anker = loese(def.anchor, ctx, i)
    if (anker === null) return 0
    // Ein Ziel auf der falschen Seite ist kein Ziel
    if (richtung === 'long' && anker <= entry) return 0
    if (richtung === 'short' && anker >= entry) return 0
    return anker
}

// ── detect ───────────────────────────────────────────────────────────────

/**
 * Wendet eine Regelbeschreibung auf Kerzen an.
 *
 * @param {object} regeln   validierte Regelbeschreibung
 * @param {object} input    { candles, params, openSetups, knownSetupKeys }
 * @returns {{ setups, events, diagnostics }}
 */
export function detectMitRegeln(regeln, { candles, params, openSetups = [], knownSetupKeys = [] }) {
    const setups = []
    const events = []
    const diagnostics = { sweepsFound: 0, setupsCreated: 0, rejected: {}, rejections: [] }
    const reject = (grund, key) => {
        diagnostics.rejected[grund] = (diagnostics.rejected[grund] || 0) + 1
        diagnostics.rejections.push({ reason: grund, key })
    }

    const richtung = regeln.direction === 'short' ? 'short' : 'long'
    const mindestens = (regeln.warmupCandles || 200) / 4
    if (!Array.isArray(candles) || candles.length < Math.max(30, mindestens)) {
        return { setups, events, diagnostics }
    }

    const indikatoren = baueIndikatoren(regeln, candles, params)
    const ctx = { candles, params, indikatoren, setup: null, laufend: null,
        richtung: regeln.direction || 'long',
        // Für `lastSwingLow`/`lastSwingHigh`: dieselbe Pivot-Definition wie
        // beim Auslöser, sofern dieser einer ist.
        swingLinks: Math.round(zahl(regeln.signal?.left, params, 5)),
        swingRechts: Math.round(zahl(regeln.signal?.right, params, 2)) }

    const bekannt = new Set(knownSetupKeys)
    for (const s of openSetups) bekannt.add(`${s.direction}|${s.obCandleTime}`)

    // ══ Phase A: Signale prüfen und Setups anlegen ════════════════════════
    const scanFenster = Math.round(zahl(regeln.scanWindowCandles, params, 200))
    const scanAb = Math.max(0, candles.length - scanFenster)

    // Wie viele Kerzen braucht das Signal zur Bestätigung? Nur Pivots brauchen
    // welche — eine Kreuzung oder ein Kerzenmuster steht mit ihrer Kerze fest.
    const istPivot = regeln.signal?.type === 'pivotHigh' || regeln.signal?.type === 'pivotLow'
    const bestaetigungsKerzen = istPivot
        ? Math.max(1, Math.round(zahl(regeln.signal?.right, params, 2)))
        : 0

    for (const sig of findeSignale(regeln, ctx)) {
        if (sig.index < scanAb) continue
        const key = `${richtung}|${candles[sig.index].t}`
        if (bekannt.has(key)) continue

        diagnostics.sweepsFound++
        ctx.setup = {
            signalPrice: sig.price, signalHigh: sig.high, signalLow: sig.low,
            prevSignalPrice: sig.prevPrice,
        }
        ctx.laufend = null

        // Signalfilter der Reihe nach — der erste Fehlschlag nennt den Grund
        let abgelehnt = null
        for (const f of regeln.signalFilters || []) {
            if (!pruefe(f, ctx, sig.index)) { abgelehnt = f.code || 'filter_failed'; break }
        }
        if (abgelehnt) { reject(abgelehnt, key); ctx.setup = null; continue }

        bekannt.add(key)
        setups.push({
            direction: richtung,
            status: 'waiting_retest',
            sweepLevel: sig.prevPrice ?? sig.price,
            sweepPrice: sig.price,
            sweepCandleTime: candles[sig.index].t,
            obHigh: Math.max(sig.high, sig.price),
            obLow: Math.min(sig.low, sig.price),
            obCandleTime: candles[sig.index].t,
            impulseExtreme: sig.price,
            entry: 0, stopLoss: 0, takeProfit: 0, rr: 0,
            confirmations: {},
            detectorVersion: RULE_ENGINE_VERSION,
            // BEOBACHTET wird ab der Signalkerze — die Abbruchbedingungen
            // sollen lückenlos greifen, auch während der Bestätigung.
            watchFrom: candles[sig.index].t,
            // GEHANDELT wird erst NACH der Bestätigungskerze.
            //
            // Ein Pivot mit `right: 2` ist erst zwei Kerzen später überhaupt als
            // Pivot erkennbar — vorher weiss niemand, dass das Hoch hält. Ohne
            // diese Grenze stieg Phase B auf genau den Kerzen ein, die das
            // Signal erst bestätigen: ein Blick in die Zukunft, der jeden
            // Backtest zu optimistisch macht. Auch die Bestätigungskerze
            // selbst ist erst mit ihrem Schluss bekannt — der erste ehrliche
            // Einstieg liegt eine Kerze später. Das ist dieselbe Grenze, die
            // LSOB seit jeher zieht (`pivot.index + swingConfirmBars + 1`).
            tradeableFrom: candles[Math.min(sig.index + bestaetigungsKerzen, candles.length - 1)].t,
            // Für Phase B mitgeben — das Setup wird in der DB abgelegt und
            // später ohne den ursprünglichen Kontext wieder geladen.
            signalPrice: sig.price, signalHigh: sig.high, signalLow: sig.low,
        })
        diagnostics.setupsCreated++
        ctx.setup = null
    }

    // ══ Phase B: wartende Setups fortschreiben ════════════════════════════
    const timeoutRegel = (regeln.invalidations || []).find((v) => v.type === 'timeout')
    const bedingungen = (regeln.invalidations || []).filter((v) => v.type !== 'timeout')

    for (const s of openSetups) {
        if (s.status !== 'waiting_retest' && s.status !== 'armed') continue

        const ab = Number(s.watchFrom || s.obCandleTime) || 0
        const start = candles.findIndex((c) => c.t > ab)
        if (start === -1) continue
        // Bis einschliesslich dieser Kerze war das Signal noch nicht bestätigt —
        // beobachten ja, handeln nein.
        const handelbarAb = Number(s.tradeableFrom || 0) || 0

        ctx.setup = {
            signalPrice: Number(s.signalPrice ?? s.sweepPrice),
            signalHigh: Number(s.signalHigh ?? s.obHigh),
            signalLow: Number(s.signalLow ?? s.obLow),
            prevSignalPrice: Number(s.sweepLevel),
            entry: 0,
        }
        const laufend = { tief: Infinity, hoch: -Infinity }
        ctx.laufend = laufend

        let gewartet = 0
        let fertig = false
        const maxKerzen = timeoutRegel ? Math.round(zahl(timeoutRegel.candles, params, 20)) : 0

        for (let i = start; i < candles.length && !fertig; i++) {
            const k = candles[i]
            gewartet++
            if (k.l < laufend.tief) laufend.tief = k.l
            if (k.h > laufend.hoch) laufend.hoch = k.h

            // (1) Abbruchbedingungen
            let gebrochen = null
            for (const v of bedingungen) {
                if (pruefe(v.when || v, ctx, i)) { gebrochen = v.code || 'invalidated'; break }
            }
            if (gebrochen) {
                events.push({ id: s.id, status: 'invalidated', invalidReason: gebrochen, candleTime: k.t })
                fertig = true; break
            }

            // (2) Einstieg
            const e = regeln.entry || {}
            let ausgeloest = false
            let entryPreis = null
            let fillAmOpen = false

            // Der Index der Kerze, an der tatsächlich eingestiegen wird —
            // bei `immediate` ist das nicht die Auslösekerze (siehe unten).
            let einstiegIdx = i

            if (e.type === 'immediate') {
                // Das Signal steht mit dem Schluss seiner Kerze fest; diese
                // Schleife beginnt bei der ERSTEN Kerze danach. Deren Eröffnung
                // ist der früheste ehrliche Einstieg — sie war der erste Kurs
                // nach dem Signal. Vorher wurde stattdessen die Eröffnung der
                // ÜBERnächsten Kerze genommen: eine Kerze zu spät, und
                // Ordergültigkeiten von einer Kerze konnten nie greifen.
                ausgeloest = true
                entryPreis = k.o
                einstiegIdx = i
                fillAmOpen = true
            } else {
                const anker = loese(e.anchor, ctx, i)
                if (anker !== null) {
                    // Von oben kommend berührt der Kurs den Anker mit dem Tief,
                    // von unten mit dem Hoch.
                    const vonOben = e.from !== 'below'
                    const beruehrt = vonOben ? k.l <= anker : k.h >= anker
                    // Liegt die ganze Kerze jenseits des Ankers, war ein Fill
                    // dort nie möglich — der Kurs ist vorbeigesprungen.
                    const vorbei = vonOben ? k.h < anker : k.l > anker
                    if (vorbei) {
                        events.push({ id: s.id, status: 'invalidated', invalidReason: 'anchor_missed', candleTime: k.t })
                        fertig = true; break
                    }
                    if (beruehrt) { ausgeloest = true; entryPreis = anker }
                }
            }

            if (ausgeloest && k.t <= handelbarAb) {
                if (e.type === 'immediate') {
                    // „Sofort" heisst: sobald das Signal feststeht. Bei einem
                    // Pivot steht es erst mit der Bestätigung fest — also hier
                    // noch warten, nicht verwerfen.
                    ausgeloest = false
                    entryPreis = null
                } else {
                    // Eine Berührung vor der Bestätigung lag in der
                    // Vergangenheit des Signals und war nie handelbar. Sie zu
                    // überspringen und auf eine zweite Berührung zu hoffen wäre
                    // geschönt — das Setup wird verworfen und taucht im
                    // Trichter auf.
                    events.push({ id: s.id, status: 'invalidated', invalidReason: 'entry_before_confirm', candleTime: k.t })
                    fertig = true; break
                }
            }

            if (ausgeloest && entryPreis !== null) {
                ctx.setup.entry = entryPreis
                if (!alleErfuellt(regeln.entryFilters, ctx, i)) {
                    // Bedingung am Einstieg nicht erfüllt — weiter warten,
                    // das Setup bleibt gültig.
                    if (maxKerzen > 0 && gewartet > maxKerzen) {
                        events.push({ id: s.id, status: 'expired', invalidReason: timeoutRegel.code || 'timeout', candleTime: k.t })
                        fertig = true
                    }
                    continue
                }

                const stopLoss = berechneStop(regeln, ctx, i, richtung)
                if (stopLoss === null
                    || (richtung === 'long' && stopLoss >= entryPreis)
                    || (richtung === 'short' && stopLoss <= entryPreis)) {
                    events.push({ id: s.id, status: 'invalidated', invalidReason: 'invalid_stop', candleTime: k.t })
                    fertig = true; break
                }

                const takeProfit = berechneZiel(regeln, ctx, i, richtung, entryPreis, stopLoss)
                // Nur wenn die Regel überhaupt ein Ziel vorsieht, muss eines
                // herauskommen. `mode: 'none'` ist bewusst zielfrei.
                const zielGewollt = (regeln.takeProfit?.mode || 'none') !== 'none'
                if (zielGewollt && !(takeProfit > 0)) {
                    // Ein Anker auf der falschen Seite des Einstiegs liefert 0.
                    // Das ist KEIN Freifahrtschein: gehandelt wäre die Position
                    // ohne Ausgang nach oben — der Fill-Simulator prüft ein Ziel
                    // nur bei `takeProfit > 0`, also bliebe allein der Stop.
                    events.push({ id: s.id, status: 'rejected', invalidReason: 'no_target', candleTime: k.t })
                    fertig = true; break
                }
                const risiko = Math.abs(entryPreis - stopLoss)
                const rr = takeProfit > 0 && risiko > 0 ? Math.abs(takeProfit - entryPreis) / risiko : 0
                const minRR = zahl(regeln.minRR, params, 0)
                if (minRR > 0 && zielGewollt && rr < minRR) {
                    events.push({ id: s.id, status: 'rejected', invalidReason: 'below_min_rr', candleTime: k.t })
                    fertig = true; break
                }

                const einstiegKerze = ctx.candles[einstiegIdx]
                events.push({
                    id: s.id, status: 'triggered', triggeredAt: k.t,
                    // Fill, Risiko-Gates und Einstiegszeit gehören an die
                    // Kerze, in der wirklich gehandelt wird.
                    candleTime: einstiegKerze.t,
                    entry: entryPreis, stopLoss, takeProfit, rr,
                    // Sagt dem Backtest, dass der Einstieg auf der ERÖFFNUNG
                    // dieser Kerze liegt — ihr Verlauf muss deshalb noch
                    // gegen Stop und Ziel geprüft werden.
                    entryAtOpen: fillAmOpen,
                    confirmations: { waitedCandles: gewartet },
                })
                fertig = true; break
            }

            // (3) Zeitablauf
            if (maxKerzen > 0 && gewartet > maxKerzen) {
                events.push({ id: s.id, status: 'expired', invalidReason: timeoutRegel.code || 'timeout', candleTime: k.t })
                fertig = true; break
            }
        }

        ctx.setup = null
        ctx.laufend = null
    }

    return { setups, events, diagnostics }
}

/**
 * Macht aus einer Regelbeschreibung ein vollwertiges Strategie-Manifest —
 * genau das Format, das die Registry und das Frontend erwarten.
 */
export function alsManifest(regeln) {
    return {
        id: regeln.id,
        name: regeln.name || regeln.id,
        description: regeln.description || '',
        version: RULE_ENGINE_VERSION,
        supportedTimeframes: regeln.timeframes,
        warmupCandles: regeln.warmupCandles || 300,
        params: regeln.params || [],
        paramGroups: regeln.paramGroups || [],
        istRegelStrategie: true,
        regeln,
        detect: (input) => detectMitRegeln(regeln, input),
    }
}
