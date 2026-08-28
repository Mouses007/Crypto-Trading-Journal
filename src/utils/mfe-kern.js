/**
 * MFE in R — die reine Rechnung, ohne Vue und ohne Netz.
 *
 * Herausgelöst wie `totals-kern.js`, und aus demselben Grund: die Rechnung
 * sass in `useCalculateProfitAnalysis` zwischen Stores und Axios-Aufrufen und
 * war damit von keinem Selbsttest erreichbar. Sie trägt die
 * Take-Profit-Empfehlung des Journals — die Kennzahl, die monatelang konstant
 * 20,00 anzeigte, weil ein Stückwert durch einen Tradebetrag geteilt wurde.
 *
 * Selbsttest: `src/utils/__selftest-mfe.mjs`.
 */

/**
 * Die für die R-Rechnung brauchbare Menge eines Trades.
 *
 * Null bedeutet „nicht rechenbar" und führt beim Aufrufer zu R = 0, nicht zu
 * einer Division durch null.
 *
 * BOT-TRADES SIND AUSGENOMMEN. Bei Grid-Bots steht in `buyQuantity` bereits
 * ein USDT-Volumen (`createPionexTradeObj`: `totalVolume` bzw. bei Spot-Grid
 * `usdtInvestment`) und keine Coin-Menge. Eine Kursdifferenz damit zu
 * multiplizieren ergäbe denselben Einheitenfehler noch einmal, nur in die
 * andere Richtung.
 *
 * @param {object} trade
 * @returns {number} Menge in Basiswährung, oder 0
 */
export function mengeFuerR(trade) {
    if (!trade) return 0
    if (trade.botType || trade.category === 'bot') return 0
    const menge = Number(trade.buyQuantity) || 0
    return menge > 0 ? menge : 0
}

/**
 * Kursdifferenz vom Einstieg bis zum besten Punkt, richtungsabhängig.
 *
 * @param {object} trade      braucht `entryPrice` und `strategy` ('long'/'short')
 * @param {number} mfePreis
 * @returns {number} Differenz je Stück; negativ, wenn der Kurs nie in die
 *                   gewünschte Richtung lief
 */
export function mfeDifferenz(trade, mfePreis) {
    const einstieg = Number(trade?.entryPrice) || 0
    const mfe = Number(mfePreis) || 0
    return trade?.strategy === 'long' ? (mfe - einstieg) : (einstieg - mfe)
}

/**
 * Wurde für diesen Eintrag überhaupt ein bester Kurs gemessen?
 *
 * `mfePrice` ist in der Datenbank mit 0 vorbelegt (`excursions.mfePrice
 * defaultTo(0)`), und 0 heisst „nicht gemessen", nicht „der Kurs fiel auf
 * null". Der Unterschied ist nicht akademisch: bei einem SHORT wird aus
 * `entryPrice − 0` der volle Positionswert als angebliches Gewinnpotenzial.
 *
 * An den echten Daten gemessen (28.08.2026): 13 der 26 Einträge hatten
 * `mfePrice = 0`, alle zu Short-Trades, mit R-Werten zwischen 25 und 57. Sie
 * allein liessen in der Zielsuche jede Stufe bis zur obersten „gewinnen" —
 * die zweite Hälfte der Ursache für die konstante 20,00. Die erste war die
 * Einheit, siehe `mfeR`.
 *
 * @param {number} mfePreis
 * @returns {boolean}
 */
export function hatMfeMessung(mfePreis) {
    const p = Number(mfePreis)
    return Number.isFinite(p) && p > 0
}

/**
 * MFE eines Trades in R.
 *
 * Zähler und Nenner sind beide ein Betrag JE TRADE:
 *   Zähler = Kursdifferenz × Menge  (USD)
 *   Nenner = durchschnittlicher Verlust je Verlusttrade (USD)
 *
 * `avLossJeTrade` heisst im Aufrufer historisch `grossAvLossPerShare` bzw.
 * `netAvLossPerShare`. Der Name lügt: seit dem Wegfall des Aktien-Importpfades
 * setzen alle lebenden Pfade `grossSharePL = grossProceeds` ohne Division, und
 * das Dashboard beschriftet dieselbe Zahl korrekt als „avgLossPerTrade".
 *
 * GIBT `null` ZURÜCK, wenn nicht gerechnet werden kann — und nicht 0. Null R
 * hiesse „der Kurs lief nie in die richtige Richtung", und das ist eine
 * Messung. Ein fehlender Preis, eine fehlende Menge oder ein Bot-Trade sind
 * keine Messung, und sie dürfen die Trefferquote der Zielsuche weder heben
 * noch senken. Der Aufrufer verwirft `null`, statt es einzurechnen.
 *
 * @param {object} trade
 * @param {number} mfePreis
 * @param {number} avLossJeTrade  positiver Durchschnittsverlust
 * @returns {number|null} R, oder null wenn nicht rechenbar
 */
export function mfeR(trade, mfePreis, avLossJeTrade) {
    if (!hatMfeMessung(mfePreis)) return null
    const menge = mengeFuerR(trade)
    const nenner = Number(avLossJeTrade) || 0
    if (!(menge > 0) || !nenner) return null
    return (mfeDifferenz(trade, mfePreis) * menge) / nenner
}
