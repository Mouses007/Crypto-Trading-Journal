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

// „Label (N4)" — die ID verbindet die Linie im Chart mit dem Eintrag im Reiter.
const mitId = (label, id) => (id && !String(label || '').includes(id) ? `${label || ''} (${id})`.trim() : label)

export function linieAlsZeichnung(l) {
    const stil = { farbe: farbeVon(l.art), breite: l.gewicht === 'stark' ? 2 : 1, strich: 'gestrichelt', text: mitId(l.label, l.id) }
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
    // Ab der ersten Berührung (neuere Analysen tragen `vonT`), sonst über den ganzen Bereich.
    const von = Number.isFinite(z.vonT) ? z.vonT : ab
    return {
        typ: 'rechteck',
        punkte: [{ t: von, p: z.tief }, { t: Math.max(bis, von), p: z.hoch }],
        stil: { farbe: farbeVon(z.art), breite: z.gewicht === 'stark' ? 2 : 1, strich: 'gestrichelt', fuellung: true, rechts: true, text: mitId(z.label, (z.ids || []).join('+')) },
    }
}

/**
 * Was zur Wahl stand, aber nicht gewählt wurde — grau gepunktet, nur auf
 * Wunsch („Alle Kandidaten zeigen"). So sieht man, ob die Auswahl der KI
 * etwas Wichtiges ausgelassen hat.
 */
export function kandidatenVorschau(analyse) {
    const k = analyse?.auswahl?.kandidaten
    if (!Array.isArray(k)) return []
    const gewaehlt = new Set([...(analyse.linien || []).map((l) => l.id), ...(analyse.zonen || []).flatMap((z) => z.ids || [])])
    const stil = (text) => ({ farbe: '#8a9199', breite: 1, strich: 'gepunktet', text })
    // V-Kandidaten gehören zum Profil, nicht als einzelne graue Linien
    return k.filter((x) => !gewaehlt.has(x.id) && x.quelle !== 'volumenprofil').map((x, i) => {
        if (x.quelle === 'trend') return { id: -300 - i, typ: 'trendlinie', punkte: [{ t: x.t1, p: x.p1 }, { t: x.t2, p: x.p2 }], stil: { ...stil(x.id), rechts: true } }
        return { id: -300 - i, typ: 'strahlH', punkte: [{ t: x.t1 ?? analyse.kerzenVon, p: x.preis }], stil: stil(x.name ? `${x.id} ${x.name}` : x.id) }
    })
}

/*
 * Volumenprofil: Wählt die KI eine V-Marke (POC/VAH/VAL, als Linie oder Zone),
 * erscheint EIN Profil über den analysierten Bereich — einfarbig blau, ohne
 * die drei Marken als Linien (die las man vorher als rote/grüne Niveaus, und
 * das Profil selbst, auf das sie sich beziehen, fehlte).
 */
const istV = (id) => /^V\d+$/.test(String(id || ''))
export const istProfilLinie = (l) => l?.quelle === 'volumenprofil' || istV(l?.id)
export const istProfilZone = (z) => (z?.ids || []).some(istV)
export function hatProfil(analyse) {
    return (analyse?.linien || []).some(istProfilLinie) || (analyse?.zonen || []).some(istProfilZone)
}
export function profilAlsZeichnung(analyse) {
    return {
        typ: 'volprofil',
        punkte: [{ t: analyse.kerzenVon, p: 0 }, { t: analyse.kerzenBis, p: 0 }],
        stil: { farbe: '#2962ff', zeilen: 48, rechts: false, einfarbig: true, marken: false },
    }
}

/** Alles aus einer Analyse als Vorschau (negative ids: nie verwechselbar mit gespeicherten). */
export function kiVorschau(analyse) {
    if (!analyse) return []
    const ab = analyse.kerzenVon
    const bis = analyse.kerzenBis
    return [
        ...(analyse.linien || []).map((l, i) => (istProfilLinie(l) ? null : { id: -100 - i, ...linieAlsZeichnung(l) })).filter(Boolean),
        ...(analyse.zonen || []).map((z, i) => (istProfilZone(z) ? null : { id: -200 - i, ...zoneAlsZeichnung(z, ab, bis) })).filter(Boolean),
        ...(hatProfil(analyse) ? [{ id: -150, ...profilAlsZeichnung(analyse) }] : []),
        ...(analyse._alle ? kandidatenVorschau(analyse) : []),
    ]
}
