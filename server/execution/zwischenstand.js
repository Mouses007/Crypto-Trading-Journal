/**
 * Zwischenstand einer offenen Position: was käme heraus, wenn sie JETZT zum
 * Marktpreis geschlossen würde.
 *
 * Gerechnet wird mit `closePosition()` aus dem Fill-Simulator — derselben
 * Funktion, die den Trade später bucht. Eine zweite, „einfachere" Rechnung
 * hier würde früher oder später von der Buchung abweichen, und dann zeigt die
 * Seite eine Zahl, die beim Schliessen nicht herauskommt.
 *
 * Schliessen „jetzt" heisst Marktorder: Taker-Gebühr plus Slippage. Endet die
 * Position später am Ziel (Limit, Maker), fällt die Ausstiegsgebühr kleiner
 * aus — die Anzeige ist also bewusst die vorsichtige Seite.
 *
 * Funding kommt aus dem ECHTEN Verlauf der Börse, nicht aus der Annahme
 * `fundingBpsPer8h` der Instanz: die steht bei allen Instanzen auf 0, und
 * eine Spalte, die immer 0 zeigt, sagt nichts. Vorzeichen wie in der
 * Trade-Tabelle: negativ = bezahlt, positiv = erhalten.
 *
 * Rein: keine DB, kein Netz. Verlauf und Preis kommen von aussen.
 */

import { closePosition } from '../fill-simulator.js'

/**
 * Summe der Funding-Zahlungen zwischen Einstieg und `bis`.
 * Long zahlt bei positivem Satz, Short erhält ihn — und umgekehrt.
 * Bemessen wird am Mark-Preis der Abrechnung (so rechnet die Börse); fehlt er,
 * dient `ersatzPreis` als Näherung.
 */
export function fundingAusVerlauf(verlauf, { qty, direction, entryTime, bis, ersatzPreis = 0 }) {
    const menge = Math.abs(Number(qty) || 0)
    if (!Array.isArray(verlauf) || !(menge > 0)) return 0
    const von = Number(entryTime) || 0
    const ende = Number(bis) || Infinity
    const vorzeichen = direction === 'short' ? 1 : -1
    let summe = 0
    for (const e of verlauf) {
        const t = Number(e?.t)
        if (!(t > von) || t > ende) continue
        const satz = Number(e.rate)
        if (!Number.isFinite(satz)) continue
        const preis = Number(e.markPrice) > 0 ? Number(e.markPrice) : Number(ersatzPreis) || 0
        summe += vorzeichen * menge * preis * satz
    }
    return summe
}

/**
 * @param {object} pos       Position im Simulator-Format (`zuPosition`)
 * @param {object} p
 * @param {number} p.preis   aktueller Kurs
 * @param {number} p.jetzt   Zeitpunkt der Bewertung
 * @param {object} p.costs   `kostenAus(instance.risk)`
 * @param {number|null} p.funding  echte Funding-Summe; null = unbekannt
 */
export function zwischenstandPosition(pos, { preis, jetzt, costs, funding = null }) {
    const extra = funding === null ? {} : { funding }
    const t = closePosition(pos, { price: preis, reason: 'manual', time: jetzt }, costs, extra)
    const feeOpen = Number(pos.feeOpen) || 0
    const feePartial = Number(pos.partialFee) || 0
    return {
        markPrice: preis,
        exitPrice: t.exitPrice,
        grossPnl: t.grossPnl,
        feeOpen,
        feePartial,
        feeClose: t.fees - feeOpen - feePartial,
        fees: t.fees,
        // null = Verlauf nicht abrufbar; dann ist auch das Netto ohne Funding
        funding: funding === null ? null : t.funding,
        netPnl: t.netPnl,
        rMultiple: t.rMultiple,
        heldMs: Math.max(0, Number(jetzt) - Number(pos.entryTime)),
    }
}

/** Summen je Instanz — nur Positionen mit bekanntem Stand zählen mit. */
export function summiereJeInstanz(eintraege) {
    const out = {}
    for (const e of eintraege) {
        if (!e?.stand) continue
        const g = out[e.instanceId] ||= { n: 0, grossPnl: 0, fees: 0, funding: 0, fundingUnbekannt: 0, netPnl: 0 }
        g.n++
        g.grossPnl += e.stand.grossPnl
        g.fees += e.stand.fees
        if (e.stand.funding === null) g.fundingUnbekannt++
        else g.funding += e.stand.funding
        g.netPnl += e.stand.netPnl
    }
    return out
}
