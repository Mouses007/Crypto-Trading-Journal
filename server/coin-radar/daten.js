/**
 * Coin-Radar, Datenbeschaffung.
 *
 * Zwei Wege, und der Unterschied zwischen ihnen bestimmt den ganzen Aufbau:
 *
 *   MARKTWEIT   Drei Abrufe liefern Umsatz, Spread und Funding für ALLE
 *               Perpetuals auf einen Schlag — zusammen 66 Gewichtseinheiten.
 *               Damit lässt sich das Feld vorfiltern, bevor irgendetwas
 *               Teures passiert.
 *
 *   JE SYMBOL   Kerzen kosten je Abruf. Sie werden deshalb erst geholt,
 *               wenn ein Coin die Hürden überstanden hat.
 *
 * Diese Reihenfolge ist keine Sparmassnahme, sondern die Arbeitsweise, die
 * auch Trader beschreiben: erst grob sieben, dann die Übriggebliebenen genau
 * ansehen. Ein Lauf über das ganze Universum bleibt so unter einer Minute.
 */

import { holeJson } from '../marktradar-api.js'
import { getClosedCandles } from '../market-data.js'
import { warteAufGewicht } from '../binance-takt.js'
import { logWarn } from '../logger.js'

const FAPI = 'https://fapi.binance.com'

/**
 * Gewicht eines Kline-Abrufs mit ≤ 500 Kerzen.
 *
 * Binance staffelt nach Anzahl: unter 100 kostet 1, bis 500 kostet 2, darüber
 * 5 bzw. 10. `GEWICHT_KLINES` in `binance-takt.js` steht auf 10 und meint den
 * Historienpfad mit 1500er-Seiten — für 200 Kerzen wäre das die fünffache
 * Reservierung und damit unnötige Bremserei.
 */
const GEWICHT_KLEINE_KLINES = 2

/** Wie viele Kerzen je Zeiteinheit. 200 reichen für ATR(14), ADX(14), Volumen-Schnitt(20). */
export const KERZEN_ANZAHL = 200

/**
 * Die drei marktweiten Abrufe.
 *
 * Jeder einzeln aufgefangen: fällt der Spread aus, sollen Umsatz und Funding
 * trotzdem stehen — ein Lauf ohne Spread ist brauchbar, ein Lauf ohne alles
 * nicht. Was fehlt, steht in `quellenStand` und ist später nachvollziehbar.
 *
 * @returns {Promise<{jeSymbol: Map<string, object>, quellenStand: object}>}
 */
export async function holeMarktweit() {
    const [umsatz, buch, funding] = await Promise.allSettled([
        holeJson(`${FAPI}/fapi/v1/ticker/24hr`),
        holeJson(`${FAPI}/fapi/v1/ticker/bookTicker`),
        holeJson(`${FAPI}/fapi/v1/premiumIndex`),
    ])

    const quellenStand = {}
    const jeSymbol = new Map()
    const hole = (symbol) => {
        if (!jeSymbol.has(symbol)) jeSymbol.set(symbol, { symbol })
        return jeSymbol.get(symbol)
    }

    if (umsatz.status === 'fulfilled' && Array.isArray(umsatz.value)) {
        for (const t of umsatz.value) {
            const e = hole(t.symbol)
            e.umsatz24h = Number(t.quoteVolume) || 0
            /*
             * `??` fängt nur null und undefined — `Number(undefined)` ist aber
             * NaN und rutscht durch. Ein NaN wäre hier nicht harmlos: der
             * Wachhund vergleicht diesen Wert gegen eine Schwelle, und jeder
             * Vergleich mit NaN ist falsch, also stumm.
             */
            const aend = Number(t.priceChangePercent)
            e.preisAenderung24h = Number.isFinite(aend) ? aend : null
            e.trades24h = Number(t.count) || 0
        }
        quellenStand.umsatz = { ok: true, anzahl: umsatz.value.length }
    } else {
        quellenStand.umsatz = { ok: false, fehler: fehlertext(umsatz.reason) }
        logWarn('coin-radar', `Umsatz nicht abrufbar: ${quellenStand.umsatz.fehler}`)
    }

    if (buch.status === 'fulfilled' && Array.isArray(buch.value)) {
        for (const b of buch.value) {
            const bid = Number(b.bidPrice)
            const ask = Number(b.askPrice)
            const e = hole(b.symbol)
            /*
             * Spread in Basispunkten, bezogen auf die Mitte. In Prozent wären
             * die Zahlen dreistellig hinter dem Komma und nicht vergleichbar;
             * Basispunkte sind das Mass, in dem Ausführungskosten üblicherweise
             * besprochen werden.
             */
            if (bid > 0 && ask > 0 && ask >= bid) {
                const mitte = (ask + bid) / 2
                e.spreadBp = ((ask - bid) / mitte) * 10000
                // Was an der Spitze wirklich liegt — ein enger Spread über drei
                // Dollar Tiefe ist keine Liquidität.
                e.tiefeUsd = Math.min(Number(b.bidQty) || 0, Number(b.askQty) || 0) * mitte
                e.preis = mitte
            }
        }
        quellenStand.buch = { ok: true, anzahl: buch.value.length }
    } else {
        quellenStand.buch = { ok: false, fehler: fehlertext(buch.reason) }
        logWarn('coin-radar', `Orderbuch-Spitze nicht abrufbar: ${quellenStand.buch.fehler}`)
    }

    if (funding.status === 'fulfilled' && Array.isArray(funding.value)) {
        for (const f of funding.value) {
            const e = hole(f.symbol)
            // Binance liefert den Dezimalbruch (0.0001 = 0,01 %) — der
            // Prozentwert entsteht erst hier. Bitunix meldet dagegen Prozent;
            // wer die beiden verwechselt, rechnet um den Faktor hundert falsch.
            const rate = Number(f.lastFundingRate)
            e.fundingRate = Number.isFinite(rate) ? rate * 100 : null
            e.naechsteZahlung = Number(f.nextFundingTime) || null
            if (!e.preis) e.preis = Number(f.markPrice) || null
        }
        quellenStand.funding = { ok: true, anzahl: funding.value.length }
    } else {
        quellenStand.funding = { ok: false, fehler: fehlertext(funding.reason) }
        logWarn('coin-radar', `Funding nicht abrufbar: ${quellenStand.funding.fehler}`)
    }

    return { jeSymbol, quellenStand }
}

/**
 * Kerzen für viele Symbole — gebremst.
 *
 * `getClosedCandles` ist der Livepfad und ruft mit Absicht KEINE Bremse: eine
 * laufende Handels-Engine soll nicht hinter einem Reihenabruf warten müssen.
 * Genau deshalb darf ein Lauf über hundert Symbole nicht direkt hindurch —
 * er verbrennt sonst das Budget, das für die Engine reserviert ist.
 *
 * Hier wird vor jedem Abruf Gewicht angemeldet. Ist die Kerze noch im Cache,
 * war die Anmeldung umsonst — das ist der Preis dafür, dass die Bremse nicht
 * in den Livepfad greifen muss, und er ist gering: eine Reservierung kostet
 * Wartezeit, kein Kontingent.
 *
 * @param {string[]} symbole
 * @param {string} zeiteinheit  z. B. '1h'
 * @param {function} melde      Fortschritt (fertig, gesamt)
 * @returns {Promise<Map<string, Array>>} Symbol → Kerzen (leer bei Ausfall)
 */
export async function holeKerzenGebremst(symbole, zeiteinheit, melde = () => {}) {
    const raus = new Map()
    const HAEPPCHEN = 5

    for (let i = 0; i < symbole.length; i += HAEPPCHEN) {
        const teil = symbole.slice(i, i + HAEPPCHEN)
        await Promise.all(teil.map(async (symbol) => {
            try {
                await warteAufGewicht(GEWICHT_KLEINE_KLINES)
                const kerzen = await getClosedCandles(symbol, zeiteinheit, KERZEN_ANZAHL)
                if (Array.isArray(kerzen) && kerzen.length) raus.set(symbol, kerzen)
            } catch (e) {
                // Ein Symbol ohne Kerzen fällt später durch die Bewertung —
                // den Lauf abzubrechen wäre die falsche Antwort auf ein
                // einzelnes delistetes Paar.
                logWarn('coin-radar', `Kerzen ${symbol} ${zeiteinheit}: ${e.message}`)
            }
        }))
        melde({ fertig: Math.min(i + HAEPPCHEN, symbole.length), gesamt: symbole.length })
    }
    return raus
}

function fehlertext(grund) {
    return String(grund?.message || grund || 'unbekannt').slice(0, 200)
}
