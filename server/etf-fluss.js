/**
 * ETF-Fluss — der reine Rechenteil.
 *
 * Kein Netz, keine Datenbank, kein Vue: Bestände rein, Flüsse raus. Das
 * Gegenstück mit Schlüssel, Abruf und Einlagerung ist `cryptoquant-api.js`.
 *
 * Zwei Dinge, die hier absichtlich anders laufen, als man es zuerst schreiben
 * würde:
 *
 * 1. **Der erste Tag einer Reihe hat KEINEN Fluss.** Er bekommt `null`, nicht
 *    0. Ein Fonds, dessen Bestand wir erst seit gestern kennen, hat nicht
 *    „null Bitcoin bewegt" — wir wissen es schlicht nicht. Mit 0 wäre der
 *    erste Balken jeder frisch eingerichteten Installation eine Lüge, und die
 *    Summe über 7 Tage wäre systematisch zu klein.
 * 2. **Die Gesamtsumme wird nie aus den Einzelfonds addiert.** CryptoQuant
 *    liefert unter `all_symbol` alle Fonds, wir holen aber nur die grossen.
 *    Addiert man die geholten, fehlen die übrigen — und zwar unsichtbar. Die
 *    Kachel zeigt deshalb die fremde Summe und die Einzelnen daneben, mit dem
 *    Rest als ausgewiesener Differenz.
 */

const TAG_MS = 24 * 60 * 60 * 1000

/** UTC-Mitternacht des Tages, in den `ms` fällt. */
export const tagesBeginn = (ms) => Math.floor(ms / TAG_MS) * TAG_MS

/**
 * Antwort von `fund-data/digital-asset-holdings` in eine Tagesreihe wandeln.
 *
 * CryptoQuant liefert neueste zuerst und mischt Datumsformate (`date` als
 * `YYYY-MM-DD`, bei anderen Endpunkten `datetime`). Sortiert wird deshalb
 * selbst, statt sich auf die Reihenfolge zu verlassen.
 *
 * @param {Array} zeilen  `result.data` der Antwort
 * @returns {Array<[number, number]>}  [Tag in ms, Bestand], aufsteigend
 */
export function reiheAusAntwort(zeilen) {
    if (!Array.isArray(zeilen)) return []
    const proTag = new Map()
    for (const z of zeilen) {
        const roh = z?.date || z?.datetime
        if (!roh) continue
        // 'YYYY-MM-DD' ohne Zeitzone liest JavaScript als UTC — genau richtig,
        // weil CryptoQuant in UTC-Tagen rechnet.
        const t = Date.parse(String(roh).length === 10 ? `${roh}T00:00:00Z` : roh)
        // `Number(null)` ist 0 und `Number('')` auch — ein Fonds, für den die
        // Quelle nichts liefert, wäre damit ein Fonds mit null Bitcoin. Der
        // Fluss zum Vortag betrüge dann den gesamten Bestand als Abfluss.
        const rohWert = z?.digital_asset_holdings
        if (rohWert === null || rohWert === undefined || rohWert === '') continue
        const wert = Number(rohWert)
        if (!Number.isFinite(t) || !Number.isFinite(wert)) continue
        // Doppelte Tage: der spätere Eintrag gewinnt (Nachkorrektur der Quelle)
        proTag.set(tagesBeginn(t), wert)
    }
    return [...proTag.entries()].sort((a, b) => a[0] - b[0])
}

/**
 * Bestände zu Flüssen: der Fluss eines Tages ist die Veränderung zum Vortag.
 *
 * Lücken werden NICHT überbrückt. Fehlt ein Tag, weil die Quelle ausfiel,
 * würde der nächste Fluss zwei Tage Bewegung in einen Balken packen und wie
 * ein Grossereignis aussehen. Solche Punkte bekommen `fluss: null` und eine
 * Marke `luecke: true`.
 *
 * @param {Array<[number, number]>} reihe  aufsteigende [Tag, Bestand]
 * @returns {Array<{t: number, bestand: number, fluss: number|null, luecke: boolean}>}
 */
export function flussAusBestand(reihe) {
    const aus = []
    for (let i = 0; i < reihe.length; i++) {
        const [t, bestand] = reihe[i]
        const vor = i > 0 ? reihe[i - 1] : null
        const luecke = !!vor && t - vor[0] > TAG_MS
        aus.push({
            t,
            bestand,
            fluss: vor && !luecke ? bestand - vor[1] : null,
            luecke,
        })
    }
    return aus
}

/**
 * Summe der Flüsse über die letzten `tage` Tage.
 *
 * Unbekannte Tage (`null`) werden übersprungen, aber gezählt: das Ergebnis
 * sagt mit, auf wie vielen Tagen es beruht. Eine 7-Tage-Summe aus zwei
 * bekannten Tagen ist keine 7-Tage-Summe, und die Kachel soll das zeigen
 * können, statt eine runde Zahl zu behaupten.
 */
export function summeUeber(punkte, tage) {
    const ab = punkte.length ? punkte[punkte.length - 1].t - (tage - 1) * TAG_MS : 0
    let summe = 0
    let bekannt = 0
    let moeglich = 0
    for (const p of punkte) {
        if (p.t < ab) continue
        moeglich++
        if (p.fluss === null) continue
        summe += p.fluss
        bekannt++
    }
    return { summe: bekannt ? summe : null, bekannt, moeglich }
}

/**
 * Eine Fondsreihe zu den Zahlen verdichten, die die Kachel zeigt.
 *
 * @param {string} id     Kürzel bei CryptoQuant (`ibit`, `gbtc`, …)
 * @param {string} name   Anzeigename
 * @param {Array<[number, number]>} reihe
 */
export function verdichteFonds(id, name, reihe) {
    const punkte = flussAusBestand(reihe)
    const letzter = punkte[punkte.length - 1] || null
    return {
        id,
        name,
        tag: letzter?.t ?? null,
        bestand: letzter?.bestand ?? null,
        fluss1: letzter?.fluss ?? null,
        fluss7: summeUeber(punkte, 7),
        fluss30: summeUeber(punkte, 30),
        tage: punkte.length,
    }
}

/**
 * Nutzlast der Kachel aus den Reihen aller Fonds bauen.
 *
 * @param {Map<string, Array<[number,number]>>} reihen  Fonds-Id → Bestandsreihe
 * @param {Array<{id: string, name: string}>} fondsliste  Reihenfolge und Namen
 * @param {string} gesamtId  Id der Summenreihe (bei CryptoQuant `all_symbol`)
 */
export function baueNutzlast(reihen, fondsliste, gesamtId = 'all_symbol') {
    const gesamtReihe = reihen.get(gesamtId) || []
    const gesamtPunkte = flussAusBestand(gesamtReihe)
    const gesamt = verdichteFonds(gesamtId, 'Alle Fonds', gesamtReihe)

    const einzeln = fondsliste
        .filter(f => f.id !== gesamtId)
        .map(f => verdichteFonds(f.id, f.name, reihen.get(f.id) || []))
        .filter(f => f.bestand !== null)
        .sort((a, b) => b.bestand - a.bestand)

    // Anteil am Gesamtbestand — und was auf die nicht abgefragten Fonds
    // entfällt. Diese Differenz ist Absicht: sie macht sichtbar, dass die
    // Liste unten unvollständig ist, statt es zu verschweigen.
    const summeEinzeln = einzeln.reduce((s, f) => s + f.bestand, 0)
    const rest = gesamt.bestand !== null ? gesamt.bestand - summeEinzeln : null
    for (const f of einzeln) {
        f.anteilPct = gesamt.bestand ? Math.round((f.bestand / gesamt.bestand) * 1000) / 10 : null
    }

    return {
        gesamt,
        fonds: einzeln,
        rest: rest !== null && rest > 0 ? Math.round(rest) : null,
        // [Tag, Bestand, Fluss] — die Kachel zeichnet Balken (Fluss) auf Linie
        // (Bestand). `null` bleibt `null`, ECharts lässt die Lücke dann offen.
        reihe: gesamtPunkte.map(p => [p.t, Math.round(p.bestand), p.fluss === null ? null : Math.round(p.fluss)]),
    }
}

/**
 * Wie viele Tage darf der neueste Stand alt sein, bevor es ein Hinweis wert
 * ist? Die Quelle aktualisiert werktags gegen 12:00 UTC und über das
 * Wochenende gar nicht — zwei Tage sind normal, drei nicht mehr.
 */
export const ALT_AB_TAGEN = 3

/** Text für „Bestand ist alt", oder null wenn alles frisch ist. */
export function frischeHinweis(tagMs, jetzt = Date.now()) {
    if (!tagMs) return null
    const tage = Math.floor((tagesBeginn(jetzt) - tagesBeginn(tagMs)) / TAG_MS)
    return tage >= ALT_AB_TAGEN ? `Letzter Stand ist ${tage} Tage alt` : null
}
