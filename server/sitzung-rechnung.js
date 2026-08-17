/**
 * Zahlen einer laufenden Handelssitzung.
 *
 * Bewusst aus dem Endpunkt herausgezogen: hier wird gerechnet, was während
 * einer Sitzung auf dem Bildschirm steht und worüber man Entscheidungen trifft.
 * Als eigenes Modul ohne Netz und ohne Datenbank ist es testbar — Muster wie
 * `marktmechanik.js`. Selbsttest: `server/__selftest-sitzung-pnl.mjs`.
 *
 * ## Realisiert und unrealisiert bleiben getrennt
 *
 * Sie zu addieren wäre die naheliegende Vereinfachung und genau die falsche:
 * der realisierte Teil ist Vergangenheit und steht fest, der unrealisierte ist
 * eine Momentaufnahme, die sich beim nächsten Tick ändert. Wer beides in eine
 * Zahl wirft, hält einen schwebenden Buchgewinn für Ergebnis — und genau daran
 * scheitern Handelstage. Die Summe wird trotzdem ausgewiesen (`gesamtUsd`),
 * aber als *dritter* Wert neben den beiden, nicht an ihrer Stelle.
 *
 * ## Der Plan zählt am realisierten Teil
 *
 * Ein Höchstverlust ist eine Grenze für das, was man wirklich verloren hat.
 * Würde eine offene Position mitzählen, riss die Grenze bei jedem Rücksetzer
 * und man würde aus einer Position geworfen, die sich noch dreht.
 */

/** Zahl aus einem Feld ziehen, das die Börse als String liefern kann. */
function z(v) {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}

/**
 * @param {object} eingabe
 * @param {Array}  eingabe.offen        offene Positionen von Bitunix
 * @param {Array}  eingabe.geschlossen  im Fenster geschlossene Positionen
 * @param {number} [eingabe.planMaxVerlustUsd]
 * @param {number} [eingabe.planMaxTrades]
 * @returns {{
 *   realisiertUsd:number, unrealisiertUsd:number, gesamtUsd:number,
 *   gebuehrenUsd:number, fundingUsd:number,
 *   tradeAnzahl:number, gewinner:number, verlierer:number,
 *   offeneAnzahl:number, offenesRisikoUsd:number,
 *   plan:{ verlustAnteil:number|null, tradeAnteil:number|null, verletzt:boolean, gruende:string[] }
 * }}
 */
export function berechneSitzung({ offen = [], geschlossen = [], planMaxVerlustUsd = 0, planMaxTrades = 0 } = {}) {
    const zu = Array.isArray(geschlossen) ? geschlossen : []
    const auf = Array.isArray(offen) ? offen : []

    let realisiert = 0
    let gebuehren = 0
    let funding = 0
    let gewinner = 0
    let verlierer = 0

    for (const p of zu) {
        // Fremddaten: eine Lücke in der Liste darf die ganze Rechnung nicht
        // abreissen lassen — der Wert steht während des Handels auf dem Schirm.
        if (!p) continue
        const pnl = z(p.realizedPNL ?? p.realizedPnl ?? p.realized_pnl)
        realisiert += pnl
        gebuehren += z(p.fee)
        funding += z(p.funding)
        if (pnl > 0) gewinner++
        else if (pnl < 0) verlierer++
    }

    let unrealisiert = 0
    for (const p of auf) {
        if (!p) continue
        unrealisiert += z(p.unrealizedPNL ?? p.unrealizedPnl ?? p.unrealized_pnl)
    }

    const maxVerlust = z(planMaxVerlustUsd)
    const maxTrades = z(planMaxTrades)

    // Anteil am Plan, 0..1+ — die Kachel macht daraus einen Balken. `null`
    // heisst „keine Grenze gesetzt", nicht „Grenze bei null".
    const verlustAnteil = maxVerlust > 0
        ? Math.max(0, -realisiert) / maxVerlust
        : null
    const tradeAnteil = maxTrades > 0 ? zu.length / maxTrades : null

    const gruende = []
    if (maxVerlust > 0 && -realisiert > maxVerlust) gruende.push('verlust')
    if (maxTrades > 0 && zu.length > maxTrades) gruende.push('trades')

    return {
        realisiertUsd: realisiert,
        unrealisiertUsd: unrealisiert,
        gesamtUsd: realisiert + unrealisiert,
        gebuehrenUsd: gebuehren,
        fundingUsd: funding,
        tradeAnzahl: zu.length,
        gewinner,
        verlierer,
        offeneAnzahl: auf.length,
        // Was gerade auf dem Spiel steht, falls die offenen Positionen ins Minus
        // laufen — nur der bereits negative Teil, nicht die Positionsgrösse
        offenesRisikoUsd: auf.reduce((n, p) => {
            if (!p) return n
            const u = z(p.unrealizedPNL ?? p.unrealizedPnl ?? p.unrealized_pnl)
            return n + (u < 0 ? u : 0)
        }, 0),
        plan: {
            verlustAnteil,
            tradeAnteil,
            verletzt: gruende.length > 0,
            gruende,
        },
    }
}
