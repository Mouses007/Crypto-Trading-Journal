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

/**
 * Umkehrung: welcher Hebel legt die Liquidation auf einen GEWÜNSCHTEN Preis?
 *
 * Gebraucht für das Margen-Netz auf Börsen ohne Stop-Order (Pionex): dort hält
 * ein Wächter im Journal den Stop, und die isolierte Marge ist die einzige
 * Sicherung, die auch dann noch greift, wenn der Prozess nicht läuft. Damit
 * sie etwas taugt, muss die Liquidation knapp HINTER dem Stop liegen — und
 * dafür braucht es die Formel rückwärts.
 *
 * Aus `liqPreisLong` aufgelöst:
 *   Z = E(1 − 1/L)/(1 − m)  ⇒  L = 1 / (1 − Z(1 − m)/E)
 *   Z = E(1 + 1/L)/(1 + m)  ⇒  L = 1 / (Z(1 + m)/E − 1)
 *
 * Daraus folgt die Faustregel, die an jeder Aufrufstelle bekannt sein muss:
 * mit a = |E − S|/E ist L ≈ 1/(a + m). NICHT 1/a — die Wartungsmarge addiert
 * sich zum Stopabstand, und bei engen Stops dominiert sie ihn sogar. Ein Stop
 * 1 % unter dem Einstieg verlangt Hebel ~72 (nicht 100), ein Stop von 0,1 %
 * ~200 (nicht 1000). Wer den nötigen Hebel nicht fahren will, bekommt ein
 * weiteres Netz — kein anderes.
 *
 * @param {number} einstieg
 * @param {number} zielLiq  gewünschter Liquidationspreis
 * @param {number} mmr      Wartungsmarge als BRUCH
 * @param {string} richtung 'long' | 'short'
 * @returns {number} Hebel, oder 0 wenn das Ziel unerreichbar ist (Ziel auf der
 *                   falschen Seite des Einstiegs, oder Nenner ≤ 0)
 */
export function hebelFuerLiqPreis(einstieg, zielLiq, mmr, richtung) {
    const e = Number(einstieg) || 0
    const z = Number(zielLiq) || 0
    const m = Math.max(0, Number(mmr) || 0)
    if (!(e > 0) || !(z > 0)) return 0

    // Ein Long wird UNTER dem Einstieg liquidiert, ein Short darüber. Ein Ziel
    // auf der falschen Seite ist kein Grenzfall, sondern ein Denkfehler beim
    // Aufrufer — 0 zurück, damit er es merkt, statt einen Hebel zu bekommen,
    // der rechnerisch stimmt und fachlich Unsinn ist.
    const nenner = richtung === 'long'
        ? 1 - (z * (1 - m)) / e
        : (z * (1 + m)) / e - 1
    if (!(nenner > 0)) return 0

    const hebel = 1 / nenner
    if (!Number.isFinite(hebel) || !(hebel > 0)) return 0

    // Der Grenzfall Z = E ergibt rechnerisch L = 1/m — den Hebel, bei dem die
    // Liquidation exakt auf dem Einstieg liegt. Fachlich ist das eine Position,
    // die im Moment der Eröffnung schon liquidiert wäre. `hebelHaltbar` würde
    // ihn wegen Gleitkomma-Rest (1/250 kommt als 0.004000000000000004 zurück)
    // knapp durchlassen; deshalb hier mit Toleranz prüfen statt auf
    // Rundungsglück zu bauen. Dieselbe Falle hat im Projekt schon einmal einen
    // Sharpe von 3·10¹⁵ erzeugt.
    if (1 / hebel <= m * (1 + 1e-9)) return 0
    return hebel
}
