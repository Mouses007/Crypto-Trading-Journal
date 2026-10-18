/**
 * Ergebnis der KI-Analyse → Zeichnungen. Einmal für die gestrichelte Vorschau,
 * einmal für das Übernehmen in die eigenen Zeichnungen — dieselbe Umrechnung,
 * damit die übernommene Linie genau dort liegt, wo die Vorschau sie zeigte.
 */
const FARBE = '#ab47bc'

export function linieAlsZeichnung(l) {
    const stil = { farbe: FARBE, breite: 1, strich: 'gestrichelt', text: l.label }
    // Waagerechte Marke: als Strahl ab ihrem ersten Punkt — sie gilt ab dort.
    if (l.p1 === l.p2) return { typ: 'strahlH', punkte: [{ t: l.t1, p: l.p1 }], stil }
    return { typ: 'trendlinie', punkte: [{ t: l.t1, p: l.p1 }, { t: l.t2, p: l.p2 }], stil: { ...stil, rechts: true } }
}

export function zoneAlsZeichnung(z, ab, bis) {
    return {
        typ: 'rechteck',
        punkte: [{ t: ab, p: z.tief }, { t: bis, p: z.hoch }],
        stil: { farbe: FARBE, breite: 1, strich: 'gestrichelt', fuellung: true, rechts: true, text: z.label },
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
