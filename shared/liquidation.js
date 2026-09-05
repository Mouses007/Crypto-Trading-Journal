/**
 * liquidation.js — eine Liquidationsformel, ein Ort.
 *
 * Bis zum Audit vom 19.08.2026 rechneten zwei Stellen unabhängig voneinander:
 * der Fill-Simulator (`server/fill-simulator.js`) legte die Wartungsmarge auf
 * das EINSTIEGS-Nominal, die Hebelkarte (`leverageMap.js`, seit 05.09.2026 daneben) auf das
 * MARK-Nominal — letzteres ist die Formel der Börsen (Binance USDⓈ-M, Stufe 1).
 *
 * Die Differenz der beiden Formeln ist wirtschaftlich vernachlässigbar
 * (ΔP = E·m·(1/L − m)/(1 ∓ m), also ≤ 0,5 % der Pufferdistanz). Was real
 * auseinanderlief, waren die VORGABEWERTE: 0,5 % im Simulator gegen 0,4 % in
 * der Karte, und beide gegen die echten Alt-Coin-Sätze von 1–5 % um Faktor
 * 2–10 daneben. Deshalb gilt hier die Börsenformel, und die Wartungsmarge
 * kommt je Symbol aus `server/margin-rates.js` statt aus einer Pauschale.
 *
 * EINHEITEN-KANON: `mmr` ist überall ein BRUCH (0.004 = 0,4 %). Prozentwerte
 * gibt es nur in der Parameter- und Oberflächenschicht; umgerechnet wird genau
 * einmal, an der jeweiligen Schnittstelle. Wer 0.004 in einen Prozent-Parameter
 * steckt, schaltet die Wartungsmarge faktisch ab (0,004 %).
 *
 * Bewusst ohne Abhängigkeiten: Browser (Hebelkarte) und Server (Backtest)
 * importieren dieselbe Datei.
 *
 * Was hier NICHT abgebildet ist, bewusst:
 *  - Stufen über 1 (`cum`-Abzug der Klammern) — Stufe 1 hat cum = 0.
 *  - Liquidationsgebühr der Börse. Der Simulator nähert sie über Ausstiegs-
 *    Slippage und Taker-Gebühr an.
 *  - Cross Margin: dort verschiebt freies Guthaben den Preis beliebig.
 */

/**
 * Liquidationspreis einer Long-Position (isoliert, linear, USDⓈ-M).
 *
 * Herleitung: liquidiert wird, wenn die Marge bis auf die Wartungsmarge
 * aufgebraucht ist, und die Wartungsmarge hängt am Nominal zum MARK-Preis:
 *   E/L + P − E = m·P  ⇒  P = E·(1 − 1/L)/(1 − m)
 *
 * @param {number} einstieg Einstiegspreis
 * @param {number} hebel    Hebel (L)
 * @param {number} mmr      Wartungsmarge als BRUCH (0.004 = 0,4 %)
 */
export function liqPreisLong(einstieg, hebel, mmr) {
    return einstieg * (1 - 1 / hebel) / (1 - mmr)
}

/** Liquidationspreis einer Short-Position. @see liqPreisLong */
export function liqPreisShort(einstieg, hebel, mmr) {
    return einstieg * (1 + 1 / hebel) / (1 + mmr)
}

/**
 * Ist die Position bei diesem Hebel überhaupt haltbar?
 *
 * Bei `1/Hebel <= mmr` deckt die Marge die Wartungsmarge nicht einmal im
 * Moment der Eröffnung — die Börse liesse sie gar nicht erst zu, und ein
 * Backtest, der so eine Position laufen lässt, rechnet sich reich.
 */
export function hebelHaltbar(hebel, mmr) {
    return 1 / hebel > mmr
}

/**
 * Bequemer Aufruf mit Richtung. `richtung` ist 'long' oder 'short'.
 * Gibt den Einstiegspreis zurück, wenn der Hebel nicht haltbar ist — der
 * Aufrufer soll das als „sofort liquidiert" behandeln.
 */
export function liqPreis(einstieg, hebel, mmr, richtung) {
    const e = Number(einstieg) || 0
    const l = Number(hebel) || 0
    const m = Math.max(0, Number(mmr) || 0)
    if (!(e > 0) || !(l > 0)) return 0
    if (!hebelHaltbar(l, m)) return e
    return richtung === 'long' ? liqPreisLong(e, l, m) : liqPreisShort(e, l, m)
}
