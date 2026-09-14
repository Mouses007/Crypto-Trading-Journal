/**
 * Was mit einer Live-Position beim aktuellen Preis geschehen soll — rein.
 *
 * ── Warum es das überhaupt gibt ─────────────────────────────────────────────
 * `stepPaperPositions` ist für Live gesperrt (`execution/paper.js`), und das
 * zu Recht: der Kerzensimulator würde eine Position in der Datenbank schliessen,
 * während sie an der Börse weiterläuft. Damit existierten für eine Live-Position
 * bisher weder Stop noch Ziel, weder Break-Even noch Teilausstieg oder
 * Zeitausstieg. Auf Bitunix fiel das nicht auf, weil dort wenigstens Stop und
 * Ziel im Buch der Börse liegen. Auf Pionex liegt dort gar nichts.
 *
 * Dieses Modul ist deshalb nicht bloss ein Stop-Wächter, sondern der komplette
 * Ausstiegs-Lebenszyklus für Live — nur auf Ticks statt auf Kerzen.
 *
 * ── Wo es bewusst von `stepCandle` abweicht ────────────────────────────────
 * Die Reihenfolge ist DIESELBE (Liquidation → Stop → Teilausstieg → Ziel →
 * Zeitausstieg → Break-Even-Nachzug), damit der Pessimismus-Kanon des
 * Simulators erhalten bleibt und Live nicht besser rechnet als der Backtest,
 * auf dem die Freigabe beruht. Drei Unterschiede sind Absicht:
 *
 *   1. **Kein Gap-Zweig.** `stepCandle` muss aus Eröffnung, Hoch und Tief
 *      schliessen, wo gefüllt worden wäre. Hier ist der Tick der Preis, und
 *      gefüllt wird zu dem, was die Börse tatsächlich gibt.
 *   2. **Break-Even zieht auf dem Tick nach, nicht am Kerzenschluss.**
 *      Nachziehen ist immer eine Verbesserung; darauf zu warten, dass eine
 *      15m-Kerze schliesst, hiesse den Schutz eine Viertelstunde liegen zu
 *      lassen. Schwelle und Aufschlag kommen aus derselben Funktion wie im
 *      Simulator (`breakEvenAufschlag`) — nachgebaut wären sie ein zweiter
 *      Ort, an dem die Kostenannahme driften kann.
 *   3. **`<=` und `>=`, nicht `<` und `>`.** Ein Tick exakt auf dem Stop löst
 *      aus. Im Simulator ist das dieselbe Regel; hier ist sie wichtiger, weil
 *      ein Tick genau auf einer runden Marke alles andere als selten ist.
 *
 * Rein: kein Netz, keine DB, keine Uhr ausser der übergebenen Zeit.
 */

import { riskPerUnit, breakEvenAufschlag } from '../fill-simulator.js'

/**
 * @param {object} pos   Position (Felder wie in `strategy_positions`)
 * @param {number} preis aktueller Markpreis
 * @param {object} opts  { costs, breakEvenAtR, maxHoldMs, partialTpR,
 *                         partialTpPct, liqPreis, jetzt }
 * @returns {{aktion, grund, menge?, neuerStop?, preis}}
 *   aktion: 'halten' | 'stop' | 'ziel' | 'teilausstieg' | 'timeout' | 'liquidation'
 */
export function bewerteLiveSchutz(pos, preis, opts = {}) {
    const p = Number(preis) || 0
    const long = pos?.direction === 'long'
    const jetzt = Number(opts.jetzt) || Date.now()

    const halten = (grund = '') => ({ aktion: 'halten', grund, preis: p })
    if (!pos || !(p > 0)) return halten('kein_preis')
    if (!(Number(pos.entryPrice) > 0)) return halten('kein_einstieg')

    // 1. Liquidationsnähe. Hier wird NICHT geschlossen — die Börse tut das
    //    selbst, und zwar zu ihrem Preis. Gemeldet wird es trotzdem, weil es
    //    heisst: das Margen-Netz greift gleich, und der Stop hat versagt.
    const liq = Number(opts.liqPreis) || 0
    if (liq > 0) {
        const erreicht = long ? p <= liq : p >= liq
        if (erreicht) return { aktion: 'liquidation', grund: 'liq_erreicht', preis: p }
    }

    // 2. Stop. Vor allem anderen — die pessimistische Annahme des Simulators.
    const stop = Number(pos.stopLoss) || 0
    if (stop > 0) {
        const erreicht = long ? p <= stop : p >= stop
        if (erreicht) {
            return {
                aktion: 'stop',
                // Ein bereits nachgezogener Stop ist ein Break-Even-Ausstieg,
                // kein Verlust-Stop. Die Auswertung unterscheidet das.
                grund: pos.breakEvenDone ? 'be' : 'sl',
                preis: p,
            }
        }
    }

    // 3. Teilausstieg VOR dem vollen Ziel: er liegt näher am Einstieg, wird
    //    also zwangsläufig zuerst erreicht.
    const teilR = Number(opts.partialTpR) || 0
    const teilPct = Number(opts.partialTpPct) || 0
    if (teilR > 0 && teilPct > 0 && !pos.partialDone) {
        const r = riskPerUnit(pos)
        if (r > 0) {
            const marke = long ? pos.entryPrice + r * teilR : pos.entryPrice - r * teilR
            const erreicht = long ? p >= marke : p <= marke
            if (erreicht) {
                const menge = Math.abs(Number(pos.qty) || 0) * (teilPct / 100)
                if (menge > 0) {
                    return { aktion: 'teilausstieg', grund: 'partial_tp', menge, preis: p }
                }
            }
        }
    }

    // 4. Ziel. Auf Börsen mit `boersenZiel` liegt es als reduceOnly-Limit im
    //    Buch und füllt dort als Maker; dann kommt dieser Zweig gar nicht zum
    //    Zug. Er ist der Rückfall, wenn die Limit-Order nicht gesetzt werden
    //    konnte — und dann eben als Marktorder, also teurer.
    const ziel = Number(pos.takeProfit) || 0
    if (ziel > 0) {
        const erreicht = long ? p >= ziel : p <= ziel
        if (erreicht) return { aktion: 'ziel', grund: 'tp', preis: p }
    }

    // 5. Zeitausstieg. Zuletzt, damit Stop und Ziel Vorrang behalten.
    const maxHoldMs = Number(opts.maxHoldMs) || 0
    const entryTime = Number(pos.entryTime) || 0
    if (maxHoldMs > 0 && entryTime > 0 && jetzt - entryTime >= maxHoldMs) {
        return { aktion: 'timeout', grund: 'timeout', preis: p }
    }

    // 6. Break-Even nachziehen. Kein Ausstieg, sondern eine Verbesserung des
    //    Stops — deshalb als `neuerStop` an einer 'halten'-Antwort.
    const beAtR = Number(opts.breakEvenAtR) || 0
    if (beAtR > 0 && !pos.breakEvenDone) {
        const r = riskPerUnit(pos)
        if (r > 0) {
            const marke = long ? pos.entryPrice + r * beAtR : pos.entryPrice - r * beAtR
            const erreicht = long ? p >= marke : p <= marke
            if (erreicht) {
                const neu = breakEvenStop(pos, p, opts.costs || {})
                // Nur nachziehen, wenn es den Stop wirklich verbessert. Bei
                // einem bereits nachgezogenen oder handverschobenen Stop wäre
                // ein Rücksetzen auf den Einstieg eine VERSCHLECHTERUNG.
                const besser = stop <= 0 || (long ? neu > stop : neu < stop)
                if (besser) {
                    return { aktion: 'halten', grund: 'break_even', neuerStop: neu, preis: p }
                }
            }
        }
    }

    return halten()
}

/**
 * Wohin der Break-Even-Stop gezogen wird.
 *
 * Der Aufschlag deckt die Kosten beider Seiten — ohne ihn ist ein Stop auf dem
 * Einstiegskurs ein garantierter kleiner Verlust. `breakEvenAufschlag` ist
 * dieselbe Funktion, die der Simulator benutzt; sie hier nachzubauen hiesse,
 * zwei Kostenannahmen zu pflegen, die irgendwann auseinanderlaufen.
 *
 * Die Sicherung gegen „Stop schon jenseits des Kurses" bleibt: sonst löst der
 * gerade gesetzte Stop im selben Atemzug aus.
 */
export function breakEvenStop(pos, preis, costs) {
    const long = pos.direction === 'long'
    const aufschlag = costs?.breakEvenCoversCosts ? breakEvenAufschlag(pos, costs) : 0
    const neu = long ? pos.entryPrice + aufschlag : pos.entryPrice - aufschlag
    const zuNah = long ? neu >= preis : neu <= preis
    return zuNah ? Number(pos.entryPrice) : neu
}

/**
 * Ist die letzte Sichtung dieser Position zu lange her?
 *
 * Auf einer Börse ohne Stop-Order ist ein schweigender Wächter derselbe
 * Zustand wie „kein Stop" — nur dass ihn niemand sieht. Deshalb hat die Frage
 * eine eigene Funktion und einen eigenen Test.
 */
export function istVeraltet(guardAt, jetzt = Date.now(), grenzeMs = 30000) {
    const g = Number(guardAt) || 0
    if (!g) return true              // noch nie gesehen ist der schlimmere Fall, nicht der harmlose
    return (jetzt - g) > grenzeMs
}
