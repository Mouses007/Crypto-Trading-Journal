/**
 * Ergebnis der KI-Analyse → Zeichnungen. Einmal für die gestrichelte Vorschau,
 * einmal für das Übernehmen in die eigenen Zeichnungen — dieselbe Umrechnung,
 * damit die übernommene Linie genau dort liegt, wo die Vorschau sie zeigte.
 */
// Unterstützung grün, Widerstand rot, Trend im KI-Lila — gestrichelt bleibt alles,
// das sagt „Vorschlag der KI". Gleiche Töne wie Kauf/Verkauf im übrigen Chart.
export const KI_FARBEN = { unterstuetzung: '#26a69a', widerstand: '#ef5350', trend: '#ab47bc' }
const FARBE = KI_FARBEN.trend
const farbeVon = (art) => KI_FARBEN[art] || FARBE

export function linieAlsZeichnung(l) {
    const stil = { farbe: farbeVon(l.art), breite: 1, strich: 'gestrichelt', text: l.label }
    // Waagerechte Marke: als Strahl ab ihrem ersten Punkt — sie gilt ab dort. Unterstützung und
    // Widerstand sind IMMER waagerecht, auch wenn eine ältere Analyse (vor 18.10.2026) zwei
    // Preise trägt: dann der äussere, so wie der Server es heute ablegt.
    if (l.p1 === l.p2 || l.art === 'unterstuetzung' || l.art === 'widerstand') {
        const p = l.art === 'widerstand' ? Math.max(l.p1, l.p2) : l.art === 'unterstuetzung' ? Math.min(l.p1, l.p2) : l.p1
        return { typ: 'strahlH', punkte: [{ t: Math.min(l.t1, l.t2 ?? l.t1), p }], stil }
    }
    return { typ: 'trendlinie', punkte: [{ t: l.t1, p: l.p1 }, { t: l.t2, p: l.p2 }], stil: { ...stil, rechts: true } }
}

export function zoneAlsZeichnung(z, ab, bis) {
    return {
        typ: 'rechteck',
        punkte: [{ t: ab, p: z.tief }, { t: bis, p: z.hoch }],
        stil: { farbe: farbeVon(z.art), breite: 1, strich: 'gestrichelt', fuellung: true, rechts: true, text: z.label },
    }
}

/** Alles aus einer Analyse als Vorschau (negative ids: nie verwechselbar mit gespeicherten). */
export function kiVorschau(analyse) {
    if (!analyse) return []
    const ab = analyse.kerzenVon
    const bis = analyse.kerzenBis
    return [
        ...(analyse.linien || []).map((l, i) => ({ id: -100 - i, ...linieAlsZeichnung(l) })),
        ...(analyse.zonen || []).map((z, i) => ({ id: -200 - i, ...zoneAlsZeichnung(z, ab, bis) })),
    ]
}
