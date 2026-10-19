/**
 * Stop- und Zielverlauf eines Trades als Stufen — aus `tpslHistory` der
 * Bitunix-Metadaten (Aktionen `set`, `moved`, `removed`, `triggered`).
 *
 * Jede Stufe gilt von ihrem Setzen bis zur nächsten Änderung, längstens bis
 * zum Ausstieg (offen: bis `jetzt`). Was VOR dem Einstieg gesetzt wurde (beim
 * Platzieren der Order), beginnt am Einstieg. Ein `moved` als erster Eintrag
 * verrät den Wert davor (`alt`) — der galt dann ab dem Einstieg.
 * Ein Teil-Ziel (`menge` < `posMenge`) trägt seinen Anteil, damit man ein
 * TP über die halbe Position von einem über die ganze unterscheidet.
 * Ein `removed`, bei dem die Position seit dem Setzen um die Menge der Marke
 * geschrumpft ist, war in Wahrheit ein Auslösen — so standen über Nacht
 * ausgelöste Ziele bis 19.10.2026 im Verlauf.
 *
 * Rein, ohne DOM. Zeiten in ms.
 */

/** Position seit `letzte` um deren Menge geschrumpft (bzw. bei voller Menge überhaupt)? */
function istAusgeloest(letzte, posJetzt) {
    const vorher = letzte?.posMenge, menge = letzte?.menge
    if (!(vorher > 0) || !(posJetzt >= 0) || !(posJetzt < vorher * 0.999)) return false
    const weg = vorher - posJetzt
    return menge > 0 && menge < vorher * 0.999 ? Math.abs(weg - menge) <= menge * 0.02 : true
}

/**
 * @param {{ t:number, art:'SL'|'TP', aktion:string, wert:number|null, alt?:number|null, menge?:number|null, posMenge?:number|null }[]} verlauf
 * @param {number} von  Einstieg
 * @param {number} bis  Ausstieg bzw. jetzt
 * @returns {{ stufen: {art, von, bis, preis, anteil:number|null}[], ausgeloest: {art, t, preis}[] }}
 */
export function tpslStufen(verlauf, von, bis) {
    const stufen = []
    const ausgeloest = []
    if (!(bis > von)) return { stufen, ausgeloest }
    for (const art of ['SL', 'TP']) {
        const ev = (verlauf || []).filter((h) => h.art === art && Number.isFinite(h.t)).sort((a, b) => a.t - b.t)
        if (!ev.length) continue
        let wert = null, anteil = null, ab = von, letzte = null
        // Erster Eintrag ist ein Verschieben: der alte Wert stand schon beim Einstieg.
        if (ev[0].aktion === 'moved' && ev[0].alt > 0) wert = ev[0].alt
        const schliesse = (t) => {
            const ende = Math.min(Math.max(t, von), bis)
            if (wert > 0 && ende > ab) stufen.push({ art, von: ab, bis: ende, preis: wert, anteil })
            ab = Math.max(ende, von)
        }
        for (const h of ev) {
            if (h.t > bis) break
            schliesse(h.t)
            if (h.aktion === 'set' || h.aktion === 'moved') {
                wert = h.wert > 0 ? h.wert : null
                anteil = h.menge > 0 && h.posMenge > 0 && h.menge < h.posMenge * 0.999 ? h.menge / h.posMenge : null
                letzte = h
            } else {
                const geschrumpft = h.aktion === 'removed' && istAusgeloest(letzte, h.posMenge)
                if ((h.aktion === 'triggered' || geschrumpft) && (h.alt > 0 || wert > 0)) ausgeloest.push({ art, t: Math.max(h.t, von), preis: h.alt > 0 ? h.alt : wert, anteil })
                wert = null
                anteil = null
            }
        }
        schliesse(bis)
    }
    return { stufen, ausgeloest }
}
