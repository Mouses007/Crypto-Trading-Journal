/**
 * Prüfung einer Regelbeschreibung.
 *
 * Der Interpreter führt nur fest eingebaute Bausteine aus — trotzdem wird hier
 * streng geprüft, und zwar aus zwei Gründen:
 *
 *   1. Eine Beschreibung mit Tippfehlern würde sonst still nichts tun. Eine
 *      Strategie, die schweigend keine Signale findet, ist schlimmer als eine,
 *      die sich beim Speichern beschwert.
 *   2. Die Beschreibung kommt aus der Oberfläche und später womöglich von einem
 *      Agenten. Beides sind Eingaben, denen man nicht traut.
 *
 * Rückgabe ist immer eine bereinigte Beschreibung plus die Liste der Fehler.
 */

import { BAUSTEINE } from './rule-engine.js'

const ID_RE = /^[a-z][a-z0-9_]{1,40}$/
const PARAM_RE = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/
const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w']
const MAX_INDIKATOREN = 12
const MAX_BEDINGUNGEN = 20

/** Erlaubte Referenzen: Anker, bekannte Indikator-Id, Zahl, Parameter. */
function pruefeRef(ref, indikatorIds, paramKeys, wo, fehler) {
    if (typeof ref === 'number') return ref
    if (ref && typeof ref === 'object') {
        if (ref.value !== undefined) return { value: Number(ref.value) || 0 }
        if (ref.param !== undefined) {
            if (!paramKeys.has(ref.param)) fehler.push(`${wo}: unbekannter Parameter "${ref.param}"`)
            return { param: String(ref.param) }
        }
        fehler.push(`${wo}: unbrauchbare Referenz`)
        return null
    }
    const s = String(ref || '')
    if (BAUSTEINE.anker.includes(s) || indikatorIds.has(s)) return s
    // Leer heisst: noch nicht ausgefüllt — das ist eine Aufforderung, kein
    // Rätsel. „unbekannte Referenz ‹›" hilft niemandem weiter.
    if (!s) fehler.push(`${wo}: bitte einen Anker oder Indikator wählen`)
    else fehler.push(`${wo}: unbekannte Referenz "${s}"`)
    return null
}

function pruefeBedingung(b, indikatorIds, paramKeys, wo, fehler) {
    if (!b || typeof b !== 'object') { fehler.push(`${wo}: keine Bedingung`); return null }
    if (!BAUSTEINE.vergleiche.includes(b.op)) {
        fehler.push(`${wo}: unbekannter Vergleich "${b.op}"`)
        return null
    }

    const raus = { op: b.op }
    if (b.code) raus.code = String(b.code).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40)

    // Diese Vergleiche brauchen keine Seiten
    const ohneSeiten = ['isBullish', 'isBearish', 'higherThanPrevSignal', 'lowerThanPrevSignal',
        'isHammer', 'isShootingStar', 'isBullishEngulfing', 'isBearishEngulfing', 'isAdvancingWick']
    // Der Berührungszähler braucht nur die LINIE — eine rechte Seite hätte hier
    // keine Bedeutung, und ein leeres Feld dürfte die Bedingung nicht kippen.
    if (b.op === 'priorTouchesGte') {
        raus.left = pruefeRef(b.left, indikatorIds, paramKeys, `${wo}.left`, fehler)
        if (raus.left === null) return null
        for (const [feld, vorgabe] of [['window', 200], ['separation', 3]]) {
            raus[feld] = (b[feld] && typeof b[feld] === 'object' && b[feld].param !== undefined)
                ? pruefeRef(b[feld], indikatorIds, paramKeys, `${wo}.${feld}`, fehler)
                : Math.max(1, Math.round(Number(b[feld]) || vorgabe))
        }
        // 0 ist hier ein gültiger Wert („jede Berührung zählt") — deshalb keine
        // ||-Vorgabe, die die Null verschluckt.
        raus.value = (b.value && typeof b.value === 'object' && b.value.param !== undefined)
            ? pruefeRef(b.value, indikatorIds, paramKeys, `${wo}.value`, fehler)
            : Math.max(0, Math.round(Number.isFinite(Number(b.value)) ? Number(b.value) : 2))
        return raus
    }
    if (!ohneSeiten.includes(b.op)) {
        raus.left = pruefeRef(b.left, indikatorIds, paramKeys, `${wo}.left`, fehler)
        raus.right = pruefeRef(b.right, indikatorIds, paramKeys, `${wo}.right`, fehler)
        // Eine Bedingung mit unauflösbarer Seite wird VERWORFEN, nicht behalten.
        // Behielte man sie, wäre sie zur Laufzeit immer unerfüllt — die Strategie
        // fände stillschweigend nie ein Signal, und man suchte den Fehler in den
        // Regeln statt im Tippfehler.
        if (raus.left === null || raus.right === null) return null
    }
    if (b.value !== undefined) {
        raus.value = (b.value && typeof b.value === 'object' && b.value.param !== undefined)
            ? pruefeRef(b.value, indikatorIds, paramKeys, `${wo}.value`, fehler)
            : Number(b.value) || 0
    }
    // Abstandsvergleiche ohne Schwelle sind fast sicher ein Versehen
    if ((b.op === 'distancePctGt' || b.op === 'distancePctLt') && raus.value === undefined) {
        fehler.push(`${wo}: ${b.op} braucht einen Prozentwert`)
    }
    return raus
}

/**
 * @returns {{ ok: boolean, fehler: string[], regeln?: object }}
 */
/**
 * Unterscheiden sich zwei Regelwerke im HANDELN?
 *
 * Name und Beschreibung liegen mit in der Regelbeschreibung, ein roher
 * Textvergleich würde also jedes Umbenennen als inhaltliche Änderung lesen.
 * Das ist teuer: an dieser Frage hängen die Version der Strategie, die
 * `paramsVersion` aller Instanzen darauf und das Erlöschen der Live-Freigabe.
 * Ein Tippfehler im Titel darf das nicht auslösen.
 */
export function regelnUnterscheidenSich(a, b) {
    const kern = (r) => {
        const { name, description, ...rest } = r || {}
        return JSON.stringify(rest)
    }
    return kern(a) !== kern(b)
}

export function pruefeRegeln(roh) {
    const fehler = []
    if (!roh || typeof roh !== 'object') return { ok: false, fehler: ['Keine Regelbeschreibung'] }

    const id = String(roh.id || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40)
    if (!ID_RE.test(id)) fehler.push(`Ungültiger Kurzname: "${roh.id}"`)

    const timeframes = (Array.isArray(roh.timeframes) ? roh.timeframes : []).filter((t) => TIMEFRAMES.includes(t))
    if (!timeframes.length) fehler.push('Keine gültige Zeiteinheit')

    // ── Parameter ────────────────────────────────────────────────────
    const params = []
    const paramKeys = new Set()
    for (const p of (Array.isArray(roh.params) ? roh.params : []).slice(0, 40)) {
        const key = String(p?.key || '')
        if (!PARAM_RE.test(key)) { fehler.push(`Ungültiger Parametername "${key}"`); continue }
        if (paramKeys.has(key)) { fehler.push(`Doppelter Parameter "${key}"`); continue }
        if (!['number', 'integer', 'boolean'].includes(p.type)) {
            fehler.push(`Parameter "${key}": Typ muss number, integer oder boolean sein`); continue
        }
        paramKeys.add(key)
        const eintrag = { key, type: p.type, group: 'rules', label: String(p.label || key).slice(0, 120) }
        if (p.hint) eintrag.hint = String(p.hint).slice(0, 300)
        if (p.type === 'boolean') {
            eintrag.default = Boolean(p.default)
        } else {
            const d = Number(p.default); const min = Number(p.min); const max = Number(p.max)
            if (![d, min, max].every(Number.isFinite)) { fehler.push(`Parameter "${key}": default, min, max müssen Zahlen sein`); continue }
            if (min > max) { fehler.push(`Parameter "${key}": min > max`); continue }
            eintrag.default = Math.min(Math.max(d, min), max)
            eintrag.min = min; eintrag.max = max
            eintrag.step = Number.isFinite(Number(p.step)) ? Number(p.step) : (p.type === 'integer' ? 1 : 0.1)
        }
        params.push(eintrag)
    }

    // ── Indikatoren ──────────────────────────────────────────────────
    const indicators = []
    const indikatorIds = new Set()
    for (const ind of (Array.isArray(roh.indicators) ? roh.indicators : []).slice(0, MAX_INDIKATOREN)) {
        const iid = String(ind?.id || '')
        if (!PARAM_RE.test(iid)) { fehler.push(`Ungültige Indikator-Id "${iid}"`); continue }
        if (indikatorIds.has(iid)) { fehler.push(`Doppelter Indikator "${iid}"`); continue }
        if (!BAUSTEINE.indikatoren.includes(ind.type)) {
            fehler.push(`Indikator "${iid}": unbekannter Typ "${ind.type}"`); continue
        }
        indikatorIds.add(iid)
        const eintrag = {
            id: iid, type: ind.type,
            period: (ind.period && typeof ind.period === 'object' && ind.period.param !== undefined)
                ? pruefeRef(ind.period, indikatorIds, paramKeys, `Indikator ${iid}.period`, fehler)
                : Math.max(1, Math.round(Number(ind.period) || 14)),
        }
        // VWAP braucht einen Anker; das Band zusätzlich den Faktor.
        if (ind.type === 'vwap' || ind.type === 'vwapBand') {
            eintrag.anchor = BAUSTEINE.vwapAnker.includes(ind.anchor) ? ind.anchor : 'session'
            // Die Swing-Anker hängen an einem Pivot: Stärke, Fächerlinie und
            // Mindestabstand gehören zur Definition der Linie.
            if (eintrag.anchor === 'swingHigh' || eintrag.anchor === 'swingLow') {
                for (const [feld, vorgabe, min, max] of [['pivot', 20, 1, 200], ['nth', 1, 1, 3]]) {
                    eintrag[feld] = (ind[feld] && typeof ind[feld] === 'object' && ind[feld].param !== undefined)
                        ? pruefeRef(ind[feld], indikatorIds, paramKeys, `Indikator ${iid}.${feld}`, fehler)
                        : Math.min(max, Math.max(min, Math.round(Number(ind[feld]) || vorgabe)))
                }
                eintrag.minSepAtr = (ind.minSepAtr && typeof ind.minSepAtr === 'object' && ind.minSepAtr.param !== undefined)
                    ? pruefeRef(ind.minSepAtr, indikatorIds, paramKeys, `Indikator ${iid}.minSepAtr`, fehler)
                    : (Number.isFinite(Number(ind.minSepAtr)) ? Math.max(0, Number(ind.minSepAtr)) : 1)
            }
        }
        // MACD braucht drei Perioden statt einer
        if (ind.type === 'macd' || ind.type === 'macdSignal' || ind.type === 'macdHist') {
            for (const [feld, vorgabe] of [['fast', 12], ['slow', 26], ['signal', 9]]) {
                eintrag[feld] = (ind[feld] && typeof ind[feld] === 'object' && ind[feld].param !== undefined)
                    ? pruefeRef(ind[feld], indikatorIds, paramKeys, `Indikator ${iid}.${feld}`, fehler)
                    : Math.max(1, Math.round(Number(ind[feld]) || vorgabe))
            }
            // Eine schnelle Linie, die langsamer ist als die langsame, ergibt
            // ein umgekehrtes Vorzeichen — fast sicher ein Versehen.
            if (typeof eintrag.fast === 'number' && typeof eintrag.slow === 'number'
                && eintrag.fast >= eintrag.slow) {
                fehler.push(`Indikator ${iid}: die schnelle Periode (${eintrag.fast}) muss kleiner sein als die langsame (${eintrag.slow})`)
            }
        }
        // Bollinger: Faktor und Basis (SMA/EMA) gehören zur Definition
        if (ind.type === 'bollUpper' || ind.type === 'bollMiddle' || ind.type === 'bollLower') {
            eintrag.mult = (ind.mult && typeof ind.mult === 'object' && ind.mult.param !== undefined)
                ? pruefeRef(ind.mult, indikatorIds, paramKeys, `Indikator ${iid}.mult`, fehler)
                : (Number.isFinite(Number(ind.mult)) ? Number(ind.mult) : 2)
            eintrag.basis = BAUSTEINE.bollBasis.includes(ind.basis) ? ind.basis : 'sma'
        }
        // Stochastik: zwei Glättungen zusätzlich zur Periode
        if (ind.type === 'stochK' || ind.type === 'stochD') {
            for (const [feld, vorgabe] of [['smoothK', 3], ['smoothD', 3]]) {
                eintrag[feld] = (ind[feld] && typeof ind[feld] === 'object' && ind[feld].param !== undefined)
                    ? pruefeRef(ind[feld], indikatorIds, paramKeys, `Indikator ${iid}.${feld}`, fehler)
                    : Math.max(1, Math.round(Number(ind[feld]) || vorgabe))
            }
        }
        if (ind.type === 'vwapBand') {
            eintrag.mult = (ind.mult && typeof ind.mult === 'object' && ind.mult.param !== undefined)
                ? pruefeRef(ind.mult, indikatorIds, paramKeys, `Indikator ${iid}.mult`, fehler)
                : (Number.isFinite(Number(ind.mult)) ? Number(ind.mult) : 2)
        }
        indicators.push(eintrag)
    }

    // ── Signal ───────────────────────────────────────────────────────
    const sig = roh.signal || {}
    if (!BAUSTEINE.signale.includes(sig.type)) fehler.push(`Unbekannter Signaltyp "${sig.type}"`)
    const signal = { type: sig.type }
    if (sig.type === 'pivotHigh' || sig.type === 'pivotLow') {
        signal.left = (sig.left && typeof sig.left === 'object')
            ? pruefeRef(sig.left, indikatorIds, paramKeys, 'signal.left', fehler)
            : Math.max(1, Math.round(Number(sig.left) || 5))
        signal.right = (sig.right && typeof sig.right === 'object')
            ? pruefeRef(sig.right, indikatorIds, paramKeys, 'signal.right', fehler)
            : Math.max(1, Math.round(Number(sig.right) || 2))
    } else if (sig.type === 'levelTouch') {
        // Die Linie, die halten soll — plus die drei Zahlen, die entscheiden,
        // was als Berührung zählt.
        signal.line = pruefeRef(sig.line, indikatorIds, paramKeys, 'signal.line', fehler)
        for (const [feld, vorgabe] of [['minPrevTouches', 2], ['window', 200], ['separation', 3]]) {
            const roh = Number(sig[feld])
            signal[feld] = (sig[feld] && typeof sig[feld] === 'object' && sig[feld].param !== undefined)
                ? pruefeRef(sig[feld], indikatorIds, paramKeys, `signal.${feld}`, fehler)
                : Math.max(feld === 'minPrevTouches' ? 0 : 1,
                    Math.round(Number.isFinite(roh) ? roh : vorgabe))
        }
    } else if (sig.type === 'crossUp' || sig.type === 'crossDown') {
        signal.a = pruefeRef(sig.a, indikatorIds, paramKeys, 'signal.a', fehler)
        signal.b = pruefeRef(sig.b, indikatorIds, paramKeys, 'signal.b', fehler)
    } else if (sig.type === 'pattern') {
        if (!BAUSTEINE.muster.includes(sig.pattern)) {
            fehler.push(`Unbekanntes Kerzenmuster "${sig.pattern}"`)
        }
        signal.pattern = sig.pattern
        // Wie viele Kerzen der Gegenfarbe unmittelbar vor dem Muster liegen
        // müssen. 0 = kein Zusatzfilter.
        signal.prevOpposite = (sig.prevOpposite && typeof sig.prevOpposite === 'object' && sig.prevOpposite.param !== undefined)
            ? pruefeRef(sig.prevOpposite, indikatorIds, paramKeys, 'signal.prevOpposite', fehler)
            : Math.max(0, Math.round(Number(sig.prevOpposite) || 0))
        if (sig.value !== undefined) {
            signal.value = (sig.value && typeof sig.value === 'object' && sig.value.param !== undefined)
                ? pruefeRef(sig.value, indikatorIds, paramKeys, 'signal.value', fehler)
                : Number(sig.value)
        }
    }

    // ── Filter, Einstieg, Abbrüche ───────────────────────────────────
    const signalFilters = (Array.isArray(roh.signalFilters) ? roh.signalFilters : [])
        .slice(0, MAX_BEDINGUNGEN)
        .map((b, n) => pruefeBedingung(b, indikatorIds, paramKeys, `signalFilters[${n}]`, fehler))
        .filter(Boolean)

    const entryFilters = (Array.isArray(roh.entryFilters) ? roh.entryFilters : [])
        .slice(0, MAX_BEDINGUNGEN)
        .map((b, n) => pruefeBedingung(b, indikatorIds, paramKeys, `entryFilters[${n}]`, fehler))
        .filter(Boolean)

    const e = roh.entry || {}
    if (!BAUSTEINE.einstieg.includes(e.type)) fehler.push(`Unbekannte Einstiegsart "${e.type}"`)
    const entry = { type: e.type }
    if (e.type === 'touch') {
        entry.anchor = pruefeRef(e.anchor, indikatorIds, paramKeys, 'entry.anchor', fehler)
        entry.from = e.from === 'below' ? 'below' : 'above'
    }

    const invalidations = []
    for (const [n, v] of (Array.isArray(roh.invalidations) ? roh.invalidations : []).slice(0, MAX_BEDINGUNGEN).entries()) {
        const code = String(v?.code || `invalid_${n}`).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40)
        if (v?.type === 'timeout') {
            invalidations.push({
                type: 'timeout', code,
                candles: (v.candles && typeof v.candles === 'object')
                    ? pruefeRef(v.candles, indikatorIds, paramKeys, `invalidations[${n}].candles`, fehler)
                    : Math.max(1, Math.round(Number(v.candles) || 20)),
            })
        } else {
            const b = pruefeBedingung(v.when || v, indikatorIds, paramKeys, `invalidations[${n}]`, fehler)
            if (b) invalidations.push({ type: 'condition', code, when: b })
        }
    }

    const direction = ['short', 'both'].includes(roh.direction) ? roh.direction : 'long'

    // ── Kursmarken ───────────────────────────────────────────────────
    const sl = roh.stopLoss || {}
    const stopLoss = {
        anchor: pruefeRef(sl.anchor, indikatorIds, paramKeys, 'stopLoss.anchor', fehler),
        offsetPct: (sl.offsetPct && typeof sl.offsetPct === 'object')
            ? pruefeRef(sl.offsetPct, indikatorIds, paramKeys, 'stopLoss.offsetPct', fehler)
            : Number(sl.offsetPct) || 0,
    }

    const tp = roh.takeProfit || { mode: 'none' }
    if (!BAUSTEINE.ziele.includes(tp.mode)) fehler.push(`Unbekannter Zielmodus "${tp.mode}"`)
    const takeProfit = { mode: tp.mode }
    if (tp.mode === 'rr') {
        takeProfit.rr = (tp.rr && typeof tp.rr === 'object')
            ? pruefeRef(tp.rr, indikatorIds, paramKeys, 'takeProfit.rr', fehler)
            : Number(tp.rr) || 2
    } else if (tp.mode === 'anchor') {
        takeProfit.anchor = pruefeRef(tp.anchor, indikatorIds, paramKeys, 'takeProfit.anchor', fehler)
    }

    // Ohne Signalfilter feuert die Strategie auf JEDEM Signal. Das ist selten
    // gewollt und im Backtest teuer — deshalb ein Hinweis, kein Fehler.
    const hinweise = []
    if (!signalFilters.length) hinweise.push('Ohne Signalfilter entsteht bei jedem Signal ein Setup.')
    if (!invalidations.length) hinweise.push('Ohne Abbruchbedingung wartet ein Setup unbegrenzt auf den Einstieg.')
    // Lange Anker brauchen ein Sichtfenster, das die Engine im Live-Betrieb
    // nicht immer aufbringt. Das gehört gesagt, BEVOR jemand sich über eine
    // Strategie wundert, die im Backtest handelt und live schweigt.
    const anker = indicators.filter((i) => i.type === 'vwap' || i.type === 'vwapBand').map((i) => i.anchor)
    if (anker.some((a) => a === 'ath' || a === 'atl')) {
        hinweise.push('ATH/ATL-Anker: im Backtest über die geladene Historie; im Live-Betrieb hält die '
            + 'Engine nur ein begrenztes Kerzenfenster, dort bleibt die Linie leer und es entstehen keine Signale.')
    }
    if (anker.includes('month') && timeframes.some((tf) => ['1m', '3m', '5m'].includes(tf))) {
        hinweise.push('Monats-Anker auf kleinen Zeiteinheiten: ein Monat sind dort mehrere Tausend Kerzen. '
            + 'Der Backtest lädt sie, der Live-Betrieb kann sie nicht halten — dort bleibt die Linie leer.')
    }
    if (direction === 'both') {
        hinweise.push('Beide Richtungen: die Erkennung läuft zweimal (long und short) und braucht '
            + 'entsprechend doppelt so lange. Pro Symbol bleibt trotzdem nur eine Position offen. '
            + 'Stop- und Zielanker werden für Short automatisch gespiegelt (Swing-Tief ↔ Swing-Hoch).')
        // Ein einseitiger Auslöser macht aus „beide Richtungen" eine Attrappe:
        // die Short-Seite prüft dann dieselbe Bedingung wie die Long-Seite.
        const einseitig = { pivotHigh: 'ein Pivot-HOCH', pivotLow: 'ein Pivot-TIEF',
            crossUp: 'eine Kreuzung nach OBEN', crossDown: 'eine Kreuzung nach UNTEN',
            pattern: 'ein bestimmtes Kerzenmuster' }[signal.type]
        if (einseitig) {
            hinweise.push(`Achtung: der Auslöser ist ${einseitig} — er benennt eine Seite und wird `
                + 'NICHT gespiegelt. Beide Durchläufe suchen dasselbe Signal. Symmetrisch ist nur '
                + '"Berührung einer Linie"; für gespiegelte Auslöser oder Filter bitte zwei Strategien.')
        }
        if (signalFilters.length || entryFilters.length) {
            hinweise.push('Signal- und Einstiegsfilter werden ebenfalls nicht gespiegelt: '
                + '"Schlusskurs über EMA" bleibt auch im Short-Durchlauf "über".')
        }
    }

    const regeln = {
        id,
        name: String(roh.name || id).slice(0, 120),
        description: String(roh.description || '').slice(0, 500),
        timeframes,
        direction,
        warmupCandles: Math.min(Math.max(Number(roh.warmupCandles) || 300, 50), 2000),
        scanWindowCandles: Math.min(Math.max(Number(roh.scanWindowCandles) || 200, 30), 1000),
        params, indicators, signal, signalFilters, entryFilters, entry, invalidations,
        stopLoss, takeProfit,
        minRR: Number(roh.minRR) || 0,
        breakEvenAtR: Number(roh.breakEvenAtR) || 0,
        maxHoldCandles: Math.max(0, Math.round(Number(roh.maxHoldCandles) || 0)),
        paramGroups: [{ id: 'rules', labelKey: 'strategies.groups.rules' }],
    }

    return { ok: fehler.length === 0, fehler, hinweise, regeln }
}
