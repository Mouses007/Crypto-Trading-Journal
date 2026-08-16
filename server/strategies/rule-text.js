/**
 * Regelbeschreibung → lesbare Sätze.
 *
 * Der Editor zeigt heute Formularzeilen: `signalFilters[0] = { left: 'close',
 * op: 'gt', right: 'ema20' }`. Wer die Bausteine kennt, liest das. Wer eine
 * Strategie beurteilen will, liest es nicht.
 *
 * Diese Datei macht daraus „Nur wenn der Schlusskurs über EMA 20 liegt." Damit
 * lässt sich ein Regelwerk prüfen, ohne es zu entziffern — und ein Vorschlag
 * der KI lässt sich lesen, bevor man ihn übernimmt.
 *
 * Bewusst serverseitig: dieselbe Übersetzung braucht später der Chat-Baukasten
 * („so habe ich dich verstanden") und die Auswertung. Zwei Fassungen davon
 * würden auseinanderlaufen.
 */

const ANKER = {
    close: 'der Schlusskurs',
    open: 'die Eröffnung',
    high: 'das Hoch',
    low: 'das Tief',
    signalPrice: 'der Auslöserpreis',
    signalHigh: 'das Hoch der Auslöserkerze',
    signalLow: 'das Tief der Auslöserkerze',
    correctionLow: 'das Korrekturtief',
    correctionHigh: 'das Korrekturhoch',
    entryPrice: 'der Einstiegskurs',
    lastSwingLow: 'das letzte Swing-Tief',
    lastSwingHigh: 'das letzte Swing-Hoch',
}

/**
 * Dieselben Anker im Dativ. Deutsch verlangt nach „unter/über" den Dativ, und
 * ein Satz wie „0,3 % unter das Korrekturtief" liest sich falsch genug, um
 * Zweifel an der ganzen Beschreibung zu wecken.
 */
const ANKER_DATIV = {
    close: 'dem Schlusskurs',
    open: 'der Eröffnung',
    high: 'dem Hoch',
    low: 'dem Tief',
    signalPrice: 'dem Auslöserpreis',
    signalHigh: 'dem Hoch der Auslöserkerze',
    signalLow: 'dem Tief der Auslöserkerze',
    correctionLow: 'dem Korrekturtief',
    correctionHigh: 'dem Korrekturhoch',
    entryPrice: 'dem Einstiegskurs',
    lastSwingLow: 'dem letzten Swing-Tief',
    lastSwingHigh: 'dem letzten Swing-Hoch',
}

const SIGNAL = {
    pivotHigh: 'ein Swing-Hoch',
    pivotLow: 'ein Swing-Tief',
    crossUp: 'eine Kreuzung nach oben',
    crossDown: 'eine Kreuzung nach unten',
    pattern: 'ein Kerzenmuster',
}

const MUSTER = {
    bullishEngulfing: 'eine bullische Umkehrkerze',
    bearishEngulfing: 'eine bärische Umkehrkerze',
    hammer: 'ein Hammer',
    shootingStar: 'ein Shooting Star',
}

/** Vergleiche mit zwei Seiten. */
const OP2 = {
    gt: 'über', lt: 'unter', gte: 'nicht unter', lte: 'nicht über',
    crossesAbove: 'von unten kreuzt', crossesBelow: 'von oben kreuzt',
    distancePctGt: 'weiter entfernt ist als', distancePctLt: 'näher liegt als',
}

/** Vergleiche, die nur die Kerze selbst betreffen. */
const OP1 = {
    isBullish: 'die Kerze steigt',
    isBearish: 'die Kerze fällt',
    isHammer: 'die Kerze ein Hammer ist',
    isShootingStar: 'die Kerze ein Shooting Star ist',
    isBullishEngulfing: 'die Kerze die vorige bullisch umschliesst',
    isBearishEngulfing: 'die Kerze die vorige bärisch umschliesst',
    isAdvancingWick: 'der Docht in Handelsrichtung zeigt',
    higherThanPrevSignal: 'das Signal höher liegt als das vorige',
    lowerThanPrevSignal: 'das Signal tiefer liegt als das vorige',
}

/** Zahl, Parameterbezug oder Indikatorname als Text. */
function wert(v, dativ = false) {
    if (v === null || v === undefined || v === '') return '?'
    if (typeof v === 'object') {
        if (v.param !== undefined) return `«${v.param}»`
        if (v.value !== undefined) return String(v.value)
        return '?'
    }
    return (dativ ? ANKER_DATIV[v] : ANKER[v]) || String(v)
}

function bedingung(b) {
    if (!b || !b.op) return null
    if (OP1[b.op]) return OP1[b.op]
    const links = wert(b.left)
    const rechts = wert(b.right)
    const wie = OP2[b.op] || b.op
    if (b.op === 'distancePctGt' || b.op === 'distancePctLt') {
        return `${links} ${wie} ${wert(b.value)} % von ${rechts}`
    }
    return `${links} ${wie} ${rechts} liegt`
}

/**
 * @param {object} regeln  geprüfte Regelbeschreibung
 * @returns {Array<{ titel: string, text: string }>}
 */
export function regelnAlsSaetze(regeln) {
    if (!regeln || typeof regeln !== 'object') return []
    const r = regeln
    const saetze = []
    const richtung = r.direction === 'short' ? 'Short' : 'Long'

    saetze.push({
        titel: 'Richtung',
        text: `Gehandelt wird ausschliesslich ${richtung}`
            + (Array.isArray(r.timeframes) && r.timeframes.length ? ` auf ${r.timeframes.join(', ')}.` : '.'),
    })

    // Auslöser
    const sig = r.signal || {}
    let ausloeser = SIGNAL[sig.type] || sig.type || '—'
    if (sig.type === 'pivotHigh' || sig.type === 'pivotLow') {
        ausloeser += ` (${wert(sig.left)} Kerzen links, ${wert(sig.right)} rechts)`
    } else if (sig.type === 'pattern') {
        ausloeser = MUSTER[sig.pattern] || ausloeser
    } else if (sig.type === 'crossUp' || sig.type === 'crossDown') {
        // Die Prüfung legt die beiden Linien als `a`/`b` ab, nicht als
        // left/right — mit den falschen Feldern stand hier „? über ?".
        ausloeser += `: ${wert(sig.a)} kreuzt ${sig.type === 'crossUp' ? 'über' : 'unter'} ${wert(sig.b)}`
    }
    saetze.push({ titel: 'Auslöser', text: `Es beginnt mit: ${ausloeser}.` })

    // Filter
    const filter = (r.signalFilters || []).map(bedingung).filter(Boolean)
    saetze.push({
        titel: 'Bedingungen',
        text: filter.length
            ? `Nur wenn ${filter.join(' UND ')}.`
            : 'Ohne weitere Bedingungen — jeder Auslöser erzeugt ein Setup.',
    })

    // Einstieg
    const e = r.entry || {}
    saetze.push({
        titel: 'Einstieg',
        text: e.type === 'immediate'
            ? 'Eingestiegen wird sofort zur Eröffnung der nächsten Kerze.'
            : `Eingestiegen wird, sobald der Kurs ${wert(e.anchor)} berührt`
                + (e.from === 'below' ? ' (von unten kommend).' : ' (von oben kommend).'),
    })

    // Stop
    const sl = r.stopLoss || {}
    saetze.push({
        titel: 'Stop',
        text: `Der Stop liegt ${wert(sl.offsetPct)} % ${r.direction === 'short' ? 'über' : 'unter'} ${wert(sl.anchor, true)}.`,
    })

    // Ziel
    const tp = r.takeProfit || {}
    saetze.push({
        titel: 'Ziel',
        text: tp.mode === 'rr' ? `Das Ziel liegt bei ${wert(tp.rr)}-fachem Risiko.`
            : tp.mode === 'anchor' ? `Das Ziel ist ${wert(tp.anchor)}.`
                : 'Es gibt kein festes Ziel — der Ausstieg erfolgt über Stop, Break-Even oder Zeit.',
    })

    // Abbruch
    const ab = (r.invalidations || []).map((i) => {
        if (i.type === 'timeout') return `nach ${wert(i.candles)} Kerzen ohne Einstieg`
        const b = bedingung(i.when)
        return b ? `wenn ${b}` : null
    }).filter(Boolean)
    saetze.push({
        titel: 'Abbruch',
        text: ab.length
            ? `Das Setup wird verworfen ${ab.join(' oder ')}.`
            : 'Kein Abbruch — das Setup wartet unbegrenzt auf den Einstieg.',
    })

    // Schutz unterwegs
    const schutz = []
    if (Number(r.breakEvenAtR) > 0) schutz.push(`ab ${r.breakEvenAtR} R wird der Stop auf den Einstieg gezogen`)
    if (Number(r.maxHoldCandles) > 0) schutz.push(`nach ${r.maxHoldCandles} Kerzen wird die Position geschlossen`)
    if (Number(r.minRR) > 0) schutz.push(`unter ${r.minRR} Chance/Risiko wird gar nicht erst eingestiegen`)
    if (schutz.length) saetze.push({ titel: 'Unterwegs', text: `${schutz.join('; ')}.` })

    return saetze
}
