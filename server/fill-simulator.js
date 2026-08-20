/**
 * Ausführungs-Simulation auf Kerzenbasis.
 *
 * Wird von ZWEI Stellen benutzt: vom Backtest und vom Paper-Trading. Genau
 * deshalb steht sie hier und nicht in einem der beiden — ein Backtest, der
 * anders rechnet als der Paper-Betrieb, ist wertlos.
 *
 * Grundhaltung: im Zweifel pessimistisch.
 *   - Liegen Stop und Ziel in derselben Kerze, zählt der STOP. Innerhalb einer
 *     Kerze ist die Reihenfolge unbekannt; die optimistische Annahme würde
 *     Ergebnisse systematisch schönrechnen.
 *   - MARKTORDERS bekommen Slippage in die jeweils ungünstige Richtung. Eine
 *     Limit-Order füllt zum Limitpreis oder gar nicht und rutscht deshalb
 *     nicht — dafür trägt sie das Risiko, überhaupt nicht gefüllt zu werden,
 *     was auf Kerzenbasis nicht abbildbar ist.
 *   - Gebühren nach Ordersorte: Ziel und Einstieg liegen als Limit im Buch
 *     (Maker), Stop, Liquidation und Zeitausstieg reissen ab (Taker).
 *   - Break-Even wird erst am Kerzenschluss nachgezogen, nie rückwirkend.
 *
 * Alle Funktionen sind rein: Kerze rein, Ergebnis raus, kein Zustand aussen.
 */

import { liqPreis } from '../shared/liquidation.js'

const BPS = 10000

/** Ein- bzw. Ausstiegspreis nach Slippage — immer zu unseren Ungunsten. */
export function applySlippage(price, direction, side, slippageBps) {
    const f = slippageBps / BPS
    // Kaufen (Long-Einstieg, Short-Ausstieg) wird teurer, Verkaufen billiger.
    const kauft = (direction === 'long' && side === 'entry') || (direction === 'short' && side === 'exit')
    return kauft ? price * (1 + f) : price * (1 - f)
}

export function feeFor(price, qty, feeBps) {
    return Math.abs(price * qty) * (feeBps / BPS)
}

/**
 * Ordersorte einer Füllung. `limit` liegt im Buch und wird zum Maker-Satz
 * abgerechnet, `market` nimmt Liquidität und zahlt Taker.
 */
export const LIMIT = 'limit'
export const MARKT = 'market'

/**
 * Welche Ausstiegsgründe sind Marktorders?
 *
 * Das Ziel liegt als Limit im Buch, alles andere reisst ab: der Stop ist eine
 * Stop-Market, die Liquidation macht die Börse, Zeit- und Handausstieg gehen
 * zum Marktpreis. Der Unterschied ist nicht kosmetisch — bei einem Stopabstand
 * von 0,34 % (5m-Instanz) entscheidet die Differenz Maker/Taker über rund ein
 * Sechstel des eingegangenen Risikos JE TRADE.
 */
const MARKT_AUSSTIEG = new Set(['sl', 'be', 'liquidation', 'timeout', 'manual', 'reverse'])

export function ordersorte(reason) {
    return MARKT_AUSSTIEG.has(reason) ? MARKT : LIMIT
}

/**
 * Zahl oder `undefined` — NICHT `Number(x) || 0`.
 *
 * `Number(null)` ist 0, und eine fehlende Gebühr als 0 zu lesen ist genau der
 * Fehler, den dieser Umbau beheben soll: er fällt nirgends auf, die Zahl ist
 * bloss zu gut.
 */
function zahl(v) {
    if (v === undefined || v === null || v === '') return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
}

/**
 * Kostensätze für EINE Füllung, je nach Ordersorte.
 *
 * Slippage gibt es nur bei Marktorders. Eine Limit-Order füllt zum Limitpreis
 * oder gar nicht — sie kann nicht „ungünstig rutschen".
 *
 * (Die andere Seite derselben Medaille wird hier NICHT modelliert: eine
 * Limit-Order an der Zone füllt bevorzugt dann, wenn der Kurs durchmarschiert.
 * Diese Vorauswahl ist real und macht das Limit-Modell optimistisch — sie
 * lässt sich auf Kerzenbasis aber nicht ehrlich abbilden, und eine erfundene
 * Zahl wäre schlimmer als eine offen genannte Lücke.)
 *
 * `feeBps` bleibt als Rückfall lesbar: alte Instanzen und alte gespeicherte
 * Läufe tragen nur diesen einen Satz.
 */
export function satzFuer(costs, sorte) {
    const c = costs || {}
    const alt = zahl(c.feeBps)
    const maker = zahl(c.feeMakerBps) ?? alt ?? 0
    const taker = zahl(c.feeTakerBps) ?? alt ?? 0
    return {
        feeBps: sorte === LIMIT ? maker : taker,
        slippageBps: sorte === LIMIT ? 0 : (zahl(c.slippageBps) ?? 0),
    }
}

/**
 * Kostenobjekt aus den Risiko-Parametern einer Instanz.
 *
 * EINE Stelle statt fünf. Vorher baute jeder Aufrufer (Engine, Backtest, API,
 * Nachlauf, Not-Aus) sein `costs` von Hand, und beim Nachrüsten von
 * `fundingBpsPer8h` wurden drei davon vergessen — der Fehler fiel nie auf,
 * weil `Number(undefined) || 0` sauber 0 ergibt und die Zahlen bloss zu gut
 * waren. `__selftest-kostenweitergabe.mjs` bewacht, dass es bei einer Stelle
 * bleibt.
 */
export function kostenAus(risk) {
    const r = risk || {}
    return {
        feeMakerBps: r.feeMakerBps,
        feeTakerBps: r.feeTakerBps,
        // Rückfall für alte gespeicherte Läufe, die nur einen Satz kennen.
        feeBps: r.feeBps,
        slippageBps: r.slippageBps,
        fundingBpsPer8h: r.fundingBpsPer8h,
        entryOrder: r.entryOrder,
        // Reist im Kostenobjekt mit, statt durch drei weitere Signaturen
        // gefädelt zu werden: es IST eine Kostenentscheidung, und jede
        // zusätzliche Weitergabe ist eine Stelle, an der sie fehlen kann.
        breakEvenCoversCosts: r.breakEvenCoversCosts,
    }
}

/** Ordersorte des Einstiegs. Vorgabe Limit — siehe `entryOrder` in RISK_PARAMS. */
export function einstiegsSorte(costs) {
    return (costs || {}).entryOrder === MARKT ? MARKT : LIMIT
}

/**
 * Was ein Ausstieg zum Einstiegspreis KOSTET, in Preis-Einheiten je Stück.
 *
 * Ein Stop auf dem Einstiegskurs ist kein Break-Even: Ein- und Ausstiegsgebühr
 * sind bezahlt, der Stop rutscht als Marktorder. Gemessen an den 62 Papier-
 * Trades vom 20.08.2026 endete deshalb JEDER der zwölf „Break-Even"-Ausstiege
 * im Minus, im Schnitt bei −0,45 R.
 *
 * Der bezahlte Einstiegssatz wird aus `feeOpen` zurückgerechnet statt neu
 * angenommen — so stimmt der Aufschlag auch dann noch, wenn die Gebührenstufe
 * sich geändert hat, seit die Position eröffnet wurde.
 */
export function breakEvenAufschlag(pos, costs) {
    const bezug = Math.abs(Number(pos.entryPrice) * (Number(pos.initialQty) || Number(pos.qty)))
    const gezahlt = bezug > 0 ? (Number(pos.feeOpen) || 0) / bezug * BPS : NaN
    const einBps = Number.isFinite(gezahlt) && gezahlt >= 0
        ? gezahlt
        : satzFuer(costs, einstiegsSorte(costs)).feeBps
    const aus = satzFuer(costs, MARKT)
    return Number(pos.entryPrice) * (einBps + aus.feeBps + aus.slippageBps) / BPS
}

/** Abrechnungszeitpunkte für Finanzierungskosten: 00:00, 08:00, 16:00 UTC. */
const FUNDING_MS = 8 * 3600000

/**
 * Finanzierungskosten einer Haltedauer — als NEGATIVE Zahl (Kosten).
 *
 * Abgerechnet wird an festen Zeitpunkten, nicht anteilig: wer eine Minute vor
 * der Abrechnung einsteigt und eine Minute danach aussteigt, zahlt eine volle
 * Periode, und wer 7 Stunden dazwischen hält, zahlt gar nichts. Eine anteilige
 * Rechnung wäre glatter, aber falsch — und gerade bei kurzen Haltedauern
 * systematisch zu hoch.
 *
 * Gezählt werden die Abrechnungen ECHT ZWISCHEN Ein- und Ausstieg.
 *
 * BEWUSSTE EINSEITIGKEIT: Funding ist hier immer eine Belastung, nie eine
 * Gutschrift — auch wenn real die Gegenseite kassiert (Short in Contango).
 * Welche Seite zahlt, hängt vom Vorzeichen des echten Satzes ab, und das ist
 * ohne historische Daten unbekannt. Im Zweifel pessimistisch: Shorts werden
 * dadurch systematisch etwas zu SCHLECHT gerechnet, nie zu gut.
 */
export function fundingFor(notional, entryTime, exitTime, fundingBpsPer8h) {
    const satz = Number(fundingBpsPer8h) || 0
    if (!(satz > 0) || !(notional > 0)) return 0
    const von = Number(entryTime)
    const bis = Number(exitTime)
    if (!(bis > von)) return 0

    // Erste Abrechnung nach dem Einstieg
    const erste = Math.floor(von / FUNDING_MS) * FUNDING_MS + FUNDING_MS
    if (erste > bis) return 0
    const anzahl = Math.floor((bis - erste) / FUNDING_MS) + 1
    return -Math.abs(notional) * (satz / BPS) * anzahl
}

/**
 * Legt eine simulierte Position an.
 * `costs` = { feeMakerBps, feeTakerBps, slippageBps, entryOrder, fundingBpsPer8h }
 */
export function createPosition({ setup, qty, entryPrice, entryTime, leverage = 1, costs }) {
    const ein = satzFuer(costs, einstiegsSorte(costs))
    const fill = applySlippage(entryPrice, setup.direction, 'entry', ein.slippageBps)
    return {
        setupId: setup.id ?? 0,
        symbol: setup.symbol || '',
        timeframe: setup.timeframe || '',
        direction: setup.direction,
        qty,
        initialQty: qty,          // Bezugsgrösse für R, überlebt Teilausstiege
        entryPrice: fill,
        entryTime,
        stopLoss: setup.stopLoss,
        initialStopLoss: setup.stopLoss,
        takeProfit: setup.takeProfit || 0,
        leverage,
        notionalUsdt: fill * qty,
        marginUsdt: (fill * qty) / (leverage || 1),
        feeOpen: feeFor(fill, qty, ein.feeBps),
        maePrice: fill,
        mfePrice: fill,
        breakEvenDone: false,
        status: 'open',
    }
}

/** Risiko in Preis-Einheiten (Basis für R). */
export function riskPerUnit(pos) {
    return Math.abs(pos.entryPrice - pos.initialStopLoss)
}

/**
 * Standard-Wartungsmarge in PROZENT des Nominalwerts (Stufe 1 der Börsen).
 *
 * 0,4 % ist der Binance-Satz für BTCUSDT und gilt nur für eine Handvoll
 * Symbole; Alt-Coins liegen bei 1–5 %. Deshalb ist das nur der Rückfall:
 * Backtest und Paper-Handel holen die Rate je Symbol über
 * `server/margin-rates.js` (`holeMarginRate`). Der bisherige Wert 0,5 war eine
 * gerundete Pauschale ohne Quelle und wich zusätzlich von der Hebelkarte ab.
 */
export const WARTUNGSMARGE_PCT = 0.4

/**
 * Preis, bei dem die Börse die Position zwangsweise schliesst (isolierte Marge).
 *
 * Die Formel selbst steht seit dem Audit vom 19.08.2026 in
 * `shared/liquidation.js` — dieselbe, die auch die Hebelkarte zeichnet.
 * Hier bleibt nur die Umrechnung Prozent → Bruch, und zwar GENAU EINMAL:
 * `wartungsmargePct` ist ein Prozentwert (0,4 = 0,4 %). Wer hier 0.004
 * hineinsteckt, schaltet die Wartungsmarge faktisch ab.
 *
 * Ohne diese Rechnung endete jeder Hochhebel-Backtest brav am Stop, auch wenn
 * das Konto längst weg gewesen wäre — die Erwartung war dadurch zu gut.
 *
 * @param {object} pos              Position aus createPosition()
 * @param {number} wartungsmargePct Wartungsmarge in PROZENT (Rückfall 0,4 %)
 * @returns {number} Liquidationspreis (Long < Einstieg, Short > Einstieg)
 */
export function liquidationPrice(pos, wartungsmargePct = WARTUNGSMARGE_PCT) {
    const hebel = Number(pos.leverage) || 1
    const wartung = Math.max(0, Number(wartungsmargePct) || 0) / 100
    const einstieg = Number(pos.entryPrice) || 0
    if (!(einstieg > 0) || !(hebel > 0)) return 0
    return liqPreis(einstieg, hebel, wartung, pos.direction)
}

/**
 * Teilausstieg buchen: einen Anteil der Position zum erreichten Ziel schliessen,
 * den Rest weiterlaufen lassen.
 *
 * Das Ergebnis wird auf der Position gespeichert statt sofort als Trade
 * geschrieben — ein Setup soll EINE Zeile in `strategy_trades` ergeben, sonst
 * zählt die Auswertung jeden Trade doppelt und die Trefferquote wird Unsinn.
 * `initialQty` bleibt die Bezugsgrösse für R, damit ein Teilausstieg das
 * eingegangene Risiko nicht nachträglich kleinrechnet.
 */
function bucheTeilausstieg(pos, price, anteilPct, costs, time) {
    const anteil = Math.min(Math.max(anteilPct, 0), 100) / 100
    const menge = pos.qty * anteil
    if (menge <= 0) return

    // Das Teilziel liegt als Limit im Buch — wie das volle Ziel.
    const satz = satzFuer(costs, LIMIT)
    const fill = applySlippage(price, pos.direction, 'exit', satz.slippageBps)
    const gebuehr = feeFor(fill, menge, satz.feeBps)
    const brutto = pos.direction === 'long'
        ? (fill - pos.entryPrice) * menge
        : (pos.entryPrice - fill) * menge

    pos.partialQty = menge
    pos.partialPrice = fill
    pos.partialTime = time
    pos.partialGross = brutto
    pos.partialFee = gebuehr
    pos.partialDone = true
    pos.qty = pos.qty - menge
}

/**
 * Verarbeitet eine Kerze für eine offene Position.
 *
 * @returns {{ exit: null | { price, reason, time } }}
 *   Die Position wird dabei in place fortgeschrieben (SL-Nachzug, MAE/MFE).
 */
export function stepCandle(pos, candle, opts = {}) {
    const long = pos.direction === 'long'
    const breakEvenAtR = Number(opts.breakEvenAtR) || 0

    // MAE/MFE mitschreiben, bevor irgendetwas schliesst
    if (long) {
        if (candle.l < pos.maePrice) pos.maePrice = candle.l
        if (candle.h > pos.mfePrice) pos.mfePrice = candle.h
    } else {
        if (candle.h > pos.maePrice) pos.maePrice = candle.h
        if (candle.l < pos.mfePrice) pos.mfePrice = candle.l
    }

    // Zwangsliquidation vor dem Stop — aber nur, wenn sie überhaupt zuerst
    // erreicht werden kann. Liegt der Stop näher am Einstieg (der Normalfall
    // bei moderatem Hebel), greift er zuerst und hier passiert nichts. Erst
    // wenn der Hebel so hoch ist, dass die Marge vor dem Stop aufgebraucht ist,
    // schliesst die Börse — und dann zu IHREM Preis, nicht zu unserem.
    const liqPreis = liquidationPrice(pos, opts.maintenanceMarginPct)
    const liqZuerst = liqPreis > 0 && (long ? liqPreis >= pos.stopLoss : liqPreis <= pos.stopLoss)
    if (liqZuerst) {
        const liqHit = long ? candle.l <= liqPreis : candle.h >= liqPreis
        if (liqHit) {
            // Eröffnet die Kerze schon jenseits: Fill zur Eröffnung (Gap).
            const gap = long ? candle.o < liqPreis : candle.o > liqPreis
            return { exit: { price: gap ? candle.o : liqPreis, reason: 'liquidation', time: candle.t } }
        }
    }

    // Stop zuerst — die pessimistische Annahme.
    const stopHit = long ? candle.l <= pos.stopLoss : candle.h >= pos.stopLoss
    if (stopHit) {
        // Eröffnet die Kerze bereits jenseits des Stops, gibt es keinen Fill
        // zum Stop-Preis, sondern zur Eröffnung (Gap).
        const gap = long ? candle.o < pos.stopLoss : candle.o > pos.stopLoss
        const price = gap ? candle.o : pos.stopLoss
        return { exit: { price, reason: pos.breakEvenDone ? 'be' : 'sl', time: candle.t } }
    }

    // Teilausstieg VOR dem vollen Ziel prüfen: er liegt näher am Einstieg, wird
    // also zwangsläufig zuerst erreicht. Erwischt eine Kerze beide Marken, wird
    // erst der Teil gebucht und der Rest anschliessend am Ziel geschlossen.
    const teilR = Number(opts.partialTpR) || 0
    const teilPct = Number(opts.partialTpPct) || 0
    if (teilR > 0 && teilPct > 0 && !pos.partialDone) {
        const r = riskPerUnit(pos)
        if (r > 0) {
            const ziel = long ? pos.entryPrice + r * teilR : pos.entryPrice - r * teilR
            const erreicht = long ? candle.h >= ziel : candle.l <= ziel
            if (erreicht) {
                const gap = long ? candle.o > ziel : candle.o < ziel
                bucheTeilausstieg(pos, gap ? candle.o : ziel, teilPct, opts.costs || {}, candle.t)
            }
        }
    }

    if (pos.takeProfit > 0) {
        const tpHit = long ? candle.h >= pos.takeProfit : candle.l <= pos.takeProfit
        if (tpHit) {
            const gap = long ? candle.o > pos.takeProfit : candle.o < pos.takeProfit
            return { exit: { price: gap ? candle.o : pos.takeProfit, reason: 'tp', time: candle.t } }
        }
    }

    // Zeitausstieg: eine Position ohne festes Ziel darf nicht ewig laufen.
    // Wird zuletzt geprüft, damit Stop und Ziel Vorrang behalten.
    const maxHoldMs = Number(opts.maxHoldMs) || 0
    if (maxHoldMs > 0 && candle.t - pos.entryTime >= maxHoldMs) {
        return { exit: { price: candle.c, reason: 'timeout', time: candle.t } }
    }

    // Break-Even erst nach der Ausstiegsprüfung und nur auf Schlusskursbasis
    if (breakEvenAtR > 0 && !pos.breakEvenDone) {
        const r = riskPerUnit(pos)
        if (r > 0) {
            const erreicht = long
                ? candle.c >= pos.entryPrice + r * breakEvenAtR
                : candle.c <= pos.entryPrice - r * breakEvenAtR
            if (erreicht) {
                // Ohne Aufschlag ist der Stop auf dem Einstiegskurs ein
                // garantierter kleiner Verlust (Gebühren beider Seiten).
                const aufschlag = opts.costs?.breakEvenCoversCosts
                    ? breakEvenAufschlag(pos, opts.costs)
                    : 0
                const neu = long ? pos.entryPrice + aufschlag : pos.entryPrice - aufschlag
                // Sicherung: der nachgezogene Stop darf nicht schon jenseits
                // des aktuellen Schlusskurses liegen, sonst löst er in
                // derselben Kerze aus, in der er gesetzt wird. Bei einem
                // Auslöser ab 1 R und einem Aufschlag im Bereich 0,03–0,2 R
                // kann das praktisch nicht passieren — wenn doch, gilt der
                // Einstiegskurs, der gegenüber dem Ursprungsstop immer noch
                // die Verbesserung ist.
                const zuNah = long ? neu >= candle.c : neu <= candle.c
                pos.stopLoss = zuNah ? pos.entryPrice : neu
                pos.breakEvenDone = true
            }
        }
    }

    return { exit: null }
}

/**
 * Schliesst eine Position und erzeugt den Trade-Datensatz
 * (Feldnamen wie in der Tabelle `strategy_trades`).
 */
export function closePosition(pos, { price, reason, time }, costs, extra = {}) {
    const satz = satzFuer(costs, ordersorte(reason))
    const fill = applySlippage(price, pos.direction, 'exit', satz.slippageBps)
    const feeClose = feeFor(fill, pos.qty, satz.feeBps)
    // Die Eröffnungsgebühr wurde auf die volle Menge gezahlt und bleibt deshalb
    // ungeteilt; dazu kommen die Gebühren beider Ausstiege.
    const fees = pos.feeOpen + feeClose + (Number(pos.partialFee) || 0)

    const grossPnl = (pos.direction === 'long'
        ? (fill - pos.entryPrice) * pos.qty
        : (pos.entryPrice - fill) * pos.qty)
        + (Number(pos.partialGross) || 0)
    // Echte Finanzierungskosten schlagen `extra.funding` durch (Live-Betrieb,
    // wo die Börse den tatsächlichen Betrag liefert). Fehlt der, wird die
    // Annahme aus den Kosten gerechnet — so rechnen Backtest und Papierbetrieb
    // dasselbe, was der ganze Zweck dieser Datei ist.
    const funding = extra.funding !== undefined
        ? Number(extra.funding) || 0
        : fundingFor(pos.notionalUsdt, pos.entryTime, time, costs.fundingBpsPer8h)
    const netPnl = grossPnl - fees + funding

    const r = riskPerUnit(pos)
    // Bezug ist die Menge BEIM EINSTIEG. Nach einem Teilausstieg ist `qty` nur
    // noch der Rest — damit gerechnet käme ein zu grosses R heraus, weil das
    // Ergebnis beider Teile durch das Risiko eines Teils geteilt würde.
    const mengeAmEinstieg = Number(pos.initialQty) || (pos.qty + (Number(pos.partialQty) || 0))
    const riskUsd = r * mengeAmEinstieg
    const rMultiple = riskUsd > 0 ? netPnl / riskUsd : 0

    // MAE/MFE in R — genau die Zahlen, aus denen die Auswertung später
    // Vorschläge wie »TP bei 2R statt letztem Hoch« ableitet.
    const maeR = r > 0 ? Math.abs(pos.maePrice - pos.entryPrice) / r : 0
    const mfeR = r > 0 ? Math.abs(pos.mfePrice - pos.entryPrice) / r : 0

    return {
        setupId: pos.setupId,
        symbol: pos.symbol,
        timeframe: pos.timeframe,
        direction: pos.direction,
        qty: mengeAmEinstieg,     // die gehandelte Menge, nicht der Rest nach dem Teilausstieg
        notionalUsdt: pos.notionalUsdt,
        leverage: pos.leverage,
        entryPrice: pos.entryPrice,
        entryTime: pos.entryTime,
        exitPrice: fill,
        exitTime: time,
        stopLoss: pos.initialStopLoss,
        takeProfit: pos.takeProfit,
        grossPnl,
        fees,
        funding,
        netPnl,
        rMultiple,
        exitReason: reason,
        maeR,
        mfeR,
        holdingMinutes: (time - pos.entryTime) / 60000,
        ...extra,
    }
}

/**
 * Prüft, ob die Trigger-Kerze den Einstieg überhaupt hergibt.
 * Ein Setup, dessen Stop in derselben Kerze schon gerissen wird, darf nicht
 * als sauberer Einstieg durchgehen — sonst entstehen Phantom-Gewinne.
 */
export function entryIsValid(setup, candle) {
    const long = setup.direction === 'long'
    // Der Einstieg liegt an der Zonenkante; die Kerze muss sie berührt haben.
    const beruehrt = long ? candle.l <= setup.entry : candle.h >= setup.entry
    if (!beruehrt) return { ok: false, reason: 'entry_not_touched' }
    const stopSofort = long ? candle.l <= setup.stopLoss : candle.h >= setup.stopLoss
    if (stopSofort) return { ok: false, reason: 'stop_in_entry_candle' }
    return { ok: true }
}
