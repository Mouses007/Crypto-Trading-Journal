/**
 * Set and Forget — Umkehrkerze an einer mehrfach bestätigten Zone, im Trend
 * der höheren Zeiteinheiten, mit festem Stop und Ziel und ohne Nachfassen.
 *
 * Regelwerk aus zwei Videos:
 *   • Alex Gonzalez („fxalexg", Swing Trading Lab), „How I Turned $100 into
 *     $1 Million In 90 Days", https://www.youtube.com/watch?v=xAJT6cmJ5gs —
 *     die Quelle der Strategie selbst.
 *   • Trading Strategie Analyse, „Ich habe die Strategie von fxalexg 100x
 *     getestet", https://www.youtube.com/watch?v=mijMPRgwOdY — dieselbe
 *     Strategie in mechanisch nachvollziehbaren Regeln, weil sie für einen
 *     Backtest formuliert werden musste. Wo die beiden Videos auseinander-
 *     gehen, folgt dieser Code dem zweiten: das erste zeigt Chartanalyse per
 *     Augenmass, das zweite nennt Zahlen.
 *
 *   1. Trend über die HÖHEREN Zeiteinheiten: zwei aufeinanderfolgende Ebenen
 *      müssen in dieselbe Richtung zeigen (Weekly+Daily oder Daily+4h).
 *      Gelesen wird der Trend im Linienchart — höheres Hoch UND höheres Tief
 *      aus Kerzenkörpern, nicht aus Dochten.
 *   2. Zonen („Area of Interest") ebenfalls nur auf den höheren Ebenen: ein
 *      Preisbereich, an dem der Kurs mindestens dreimal mit dem Körper
 *      gedreht hat. Breite im Video 5 bis 60 Pips.
 *   3. Einstieg, wenn eine der erlaubten Umkehrformationen IN der Zone
 *      schliesst — Engulfing, Hammer, Shooting Star, Inverted Hammer,
 *      Dragonfly/Gravestone Doji, Morning/Evening Star. Ausdrücklich NICHT
 *      erlaubt: Spinning Top, gewöhnlicher Doji, Piercing Line, Dark Cloud
 *      Cover, Three White Soldiers, Three Black Crows.
 *   4. Gekauft wird zur ERÖFFNUNG der nächsten Kerze, per Marktorder.
 *   5. Stop hinter den Docht der Signalkerze bzw. hinter die Zone.
 *   6. Ziel an der nächsten Zone. Trägt sie kein Chance/Risiko von 1:2,
 *      wird der Trade nicht genommen.
 *   7. Set and Forget: kein Break-Even, kein Trailing, keine Teilverkäufe.
 *      Stop und Ziel bleiben stehen, bis eines von beiden fällt.
 *   8. Gegen den Trend wird nicht gehandelt.
 *
 * ── Was die Videos NICHT festlegen ──
 * Der ganze subjektive Teil, und er ist gross: ab wann ein Hoch ein Hoch ist
 * (keine Kerzenzahl links/rechts genannt), wo genau die Kanten einer Zone
 * liegen, wie viel Puffer der Stop bekommt. Hier sind das Parameter mit weitem
 * Bereich. Die Pip-Angaben der Zonenbreite (5 bis 60, Richtwert 30) sind in
 * Prozent umgerechnet, weil das Journal Krypto handelt: 30 Pips auf GBP/NZD
 * sind rund 0,15 % — in dieser Grössenordnung liegen die Vorgaben.
 *
 * ── Was das Regelwerk NICHT hergibt ──
 * Das erste Video handelt mit 25 bis 100 % Risiko je Trade und schliesst
 * Positionen nach Gefühl. Beides ist hier nicht abbildbar und auch nicht
 * gewollt: das Risiko kommt aus der Risikoschicht, und „nach Gefühl" ist
 * keine Regel. Die Sonntagsanalyse und die Beschränkung auf London/New York
 * sind für einen durchgehend handelbaren Markt ohne Bedeutung; wer sie
 * braucht, sperrt Wochentage über die drei Schalter unten.
 *
 * ── Was die Videos über die Erwartung sagen ──
 * Der Urheber behauptet 60 bis 65 % Trefferquote bei 1:2 bis 1:4. Gemessen
 * wurde das in beiden Tests des zweiten Videos NICHT:
 *   • 100 Trades von Hand auf GBP/NZD (30m, 2023–2026): 28 % Treffer,
 *     Ø Gewinn zu Ø Verlust 1:3,6, Profitfaktor 1,39, +71 % in gut drei Jahren.
 *   • 3626 Trades automatisch über 16 Paare und 10 Jahre (Revelio Trading):
 *     21 % Treffer, Endstand −99,8 %.
 * Der Unterschied zwischen beiden IST das Thema dieser Datei: was ein Mensch
 * „valide Zone" nennt, entscheidet über das Ergebnis, und genau diese
 * Entscheidung muss ein Detector fest verdrahten. Wer hier Parameter dreht,
 * bis es passt, hat die Lücke nicht geschlossen, sondern sie an drei Kurven
 * angepasst.
 *
 * ── Was die Vorgaben messbar bringen ──
 * Gemessen am 14.09.2026, drei Jahre bis 14.09.2026, Zeiteinheit 4h mit Zonen
 * und Trend aus Tages- und Wochenkerzen, 2 % Risiko je Trade, Hebel 5, Taker
 * 6 bp + 2 bp Slippage (der Einstieg IST eine Marktorder):
 *
 *          Trades  Treffer  ØGewinn:ØVerlust  Profitfaktor  SummeR  maxDD  Kaufen&Halten
 *   BTC        52    28,8 %             2,72          1,10    +3,8  25,1 %        +121 %
 *   ETH        32    31,3 %             2,55          1,16    +5,6  17,9 %         +35 %
 *   SOL        69    30,4 %             2,70          1,18   +12,5  32,9 %        +151 %
 *   BNB        66    27,3 %             2,44          0,91    −2,1  23,9 %        +211 %
 *   XRP        96    27,1 %             2,23          0,83   −10,4  27,3 %        +119 %
 *   ADA        71    43,7 %             3,07          2,38   +54,8  22,5 %         −38 %
 *
 * Drei Dinge stehen da, und keines davon ist „funktioniert":
 *
 * ERSTENS trifft die Umsetzung das Profil des manuellen Tests aus dem zweiten
 * Video fast auf den Punkt — 28 bis 31 % Treffer bei 2,2 bis 2,7 Ø-Verhältnis
 * gegen dessen 28 % bei 1:3,6. Die behaupteten 60 bis 65 % kommen in keinem
 * einzigen Lauf vor. Das ist der belastbarste Befund dieser Datei.
 *
 * ZWEITENS liegt das Ergebnis ohne ADA bei +9,4 R über 315 Trades, also bei
 * null — ADA allein trägt +54,8 R. Und ADA ist das einzige der sechs, das im
 * Zeitraum GEFALLEN ist (−38 %). Das ist kein Zufall, sondern der deutlichste
 * Befund der ganzen Messung: über alle sechs Symbole sind
 *
 *   251 von 386 Trades SHORT (65 %) und bringen  +79,8 R,
 *   135                 LONG  (35 %) und bringen  −15,5 R.
 *
 * Das gesamte Ergebnis hängt an den Shorts; die Longs verlieren Geld. Über
 * einen einzigen Marktzyklus gemessen ist das keine Eigenschaft der Regel,
 * sondern möglicherweise eine des Zeitraums — genau deshalb steht es hier und
 * nicht in einer Fussnote. Gegen Kaufen und Halten verliert die Strategie auf
 * fünf von sechs Symbolen deutlich.
 *
 * DRITTENS sind die Kosten die halbe Miete, und zwar gegen uns (4h, SummeR):
 *
 *            mit Kosten   ohne Gebühr/Slippage
 *   BTC            +3,8                  +13,1
 *   ETH            +5,6                  +10,8
 *   SOL           +12,5                  +19,0
 *
 * Brutto ist das Regelwerk klar positiv, netto grenzwertig. Jeder Durchgang
 * kostet 0,1 bis 0,2 R — wer die Zeiteinheit verfeinert,
 * bezahlt das mehrfach, und genau das zeigt der 1h-Lauf (dieselbe Vorgabe,
 * Zonen weiterhin aus Tages- und Wochenkerzen):
 *
 *          Trades  Treffer  Profitfaktor  SummeR  maxDD
 *   BTC        77    16,9 %          0,45   −36,5  59,5 %
 *   ETH        37     8,1 %          0,20   −31,2  44,5 %
 *   SOL        96    15,6 %          0,47   −48,6  64,6 %
 *
 * Das ist die Richtung, in die der automatische Test des zweiten Videos mit
 * seinen −99,8 % zeigt: je feiner die Ausführungs-Zeiteinheit, desto klarer
 * der Verlust. 30m in Forex und 1h in Krypto sind nicht dasselbe, aber die
 * Tendenz über drei Symbole ist eindeutig.
 *
 * ── Was die Schalter bringen ──
 * Summe der R-Vielfachen über BTC/ETH/SOL, 4h, jeweils EIN Schalter gegenüber
 * der Vorgabe verändert (Trades in Klammern):
 *
 *                              BTC     ETH     SOL    Summe
 *   Vorgabe                   +3,8    +5,6   +12,5   +21,9 (153)
 *   Zonentoleranz 0,4 ATR     −2,0    +0,8   +30,7   +29,5 (118)
 *   Zonentoleranz 0,8 ATR     −3,4   +15,8   +30,4   +42,8 (138)
 *   Zonentoleranz 1,2 ATR    +19,8   +14,3   +10,9   +45,0 (214)
 *   Pivot 2 statt 3          −11,4   +32,7   +69,6   +90,9 (307)
 *   Pivot 5 statt 3           −5,6   −13,9   −17,6   −37,1  (92)
 *   4 Berührungen je Zone     −2,7    +5,2    +7,7   +10,2  (89)
 *   ohne zweite Ebene        −10,0   −14,9   −11,7   −36,5 (795)
 *   Ziel: festes 1:4         −25,0   −36,2    +5,0   −56,1 (390)
 *
 * Die ersten fünf Zeilen kippen das Vorzeichen zwischen den Symbolen; bei 30
 * bis 100 Trades je Zelle ist das Streuung und keine Erkenntnis. Wer hier die
 * Summenspalte optimiert, passt Parameter an drei Kurven an — dieselbe Falle,
 * die in `trendlinien_breakout.js` schon einmal beschrieben ist.
 *
 * Belastbar sind nur die beiden letzten Zeilen, weil sie auf ALLEN Symbolen in
 * dieselbe Richtung zeigen und beide eine Regel betreffen:
 *   • Ohne die zweite Ebene handelt die Strategie fünfmal so oft und verliert
 *     überall. Die Forderung „zwei aufeinanderfolgende Zeiteinheiten" ist der
 *     Kern des Regelwerks, nicht seine Verzierung.
 *   • Das feste 1:4 aus dem ersten Video ist deutlich schlechter als das Ziel
 *     an der nächsten Zone — obwohl es dreimal so viele Trades zulässt. Ein
 *     Ziel, das der Markt nicht kennt, wird eben nicht erreicht.
 *
 * ── Bekannte Schönung ──
 * Reisst die Einstiegskerze den Stop schon selbst, verwirft die
 * Ausführungsschicht den Einstieg (`entryIsValid`, `stop_in_entry_candle`),
 * statt Einstieg und Stop zu buchen. In Wirklichkeit wäre das ein Verlust.
 * Das gilt für jede Strategie des Projekts gleichermassen und ist hier nur
 * vermerkt, weil eine Marktorder zur Eröffnung diesen Fall häufiger trifft
 * als ein Limit an einer Zonenkante.
 *
 * detect() ist eine REINE Funktion: keine DB, kein Netz, kein Date.now().
 */

import {
    pivotHighs, pivotLows, koerperKerzen, aggregiereKerzen, tagGesperrt, atr,
    isBullishEngulfing, isBearishEngulfing, isHammer, isShootingStar,
    isDragonflyDoji, isGravestoneDoji, isMorningStar, isEveningStar,
} from './indicators.js'

export const DETECTOR_VERSION = 1

/** Abbruchgründe. Die Auswertung gruppiert danach — Codes stabil halten. */
export const INVALID_REASONS = {
    HTF_FEHLT: 'htf_data_missing',
    KEIN_TREND: 'no_trend_alignment',
    GEGEN_TREND: 'counter_trend',
    KEINE_ZONE: 'no_zone_at_price',
    KEINE_ZIELZONE: 'no_target_zone',
    UNTER_MIN_RR: 'below_min_rr',
    STOP_UNGUELTIG: 'invalid_stop',
    WOCHENTAG_GESPERRT: 'weekday_blocked',
}

const params = [
    // ── Höhere Zeiteinheiten ──────────────────────────────────────
    // Die Namen sind Konvention: Backtest und Engine laden nur dann Kerzen
    // der höheren Zeiteinheit, wenn `htfTrendFilter` an ist und
    // `htfTimeframe` sich von der gehandelten unterscheidet. Anders als bei
    // LSOB ist das hier kein Zusatzfilter, sondern die halbe Strategie —
    // deshalb an.
    { key: 'htfTrendFilter', type: 'boolean', default: true, group: 'trend' },
    {
        key: 'htfTimeframe', type: 'select', default: '1d', group: 'trend',
        options: ['1h', '4h', '1d', '1w'],
    },
    // Die zweite, höhere Ebene wird aus der ersten zusammengefasst statt
    // getrennt geladen: die Schnittstelle reicht genau EINE höhere
    // Zeiteinheit durch, und ein zweiter Datenpfad wäre eine zweite Stelle,
    // an der Backtest und Live-Betrieb auseinanderlaufen können.
    // 7 macht aus Tageskerzen Wochenkerzen, 6 aus 4h-Kerzen Tageskerzen.
    { key: 'zweiteEbene', type: 'boolean', default: true, group: 'trend' },
    { key: 'zweiteEbeneFaktor', type: 'integer', default: 7, min: 2, max: 30, step: 1, group: 'trend' },

    // ── Struktur (Linienchart) ────────────────────────────────────
    { key: 'pivotLinks', type: 'integer', default: 3, min: 1, max: 20, step: 1, group: 'structure' },
    { key: 'pivotRechts', type: 'integer', default: 3, min: 1, max: 20, step: 1, group: 'structure' },
    // Video: „Der Linienchart blendet die Dochte aus." Abschaltbar, weil die
    // Gegenprobe billig ist und der Unterschied in Krypto grösser sein kann
    // als in Forex — Dochte sind hier ein gutes Stück länger.
    { key: 'nurKoerper', type: 'boolean', default: true, group: 'structure' },

    // ── Zonen ─────────────────────────────────────────────────────
    { key: 'zonenBeruehrungen', type: 'integer', default: 3, min: 2, max: 8, step: 1, group: 'zones' },
    // ── In welcher Einheit wird eine Zone gemessen? ───────────────
    //
    // Das Video misst in Pips: Zonenbreite 5 bis 60, Richtwert 30. Auf
    // GBP/NZD sind das rund 0,15 % — gemessen an einer Tagesspanne von knapp
    // einem Prozent. Dieselben 0,15 % auf BTC (Tagesspanne 2 bis 3 %) oder
    // SOL (5 %) sind kein Preisbereich mehr, sondern ein Strich: über drei
    // Jahre BTC/ETH/SOL in 4h-Kerzen entstand damit genau EIN Trade. Eine
    // andere feste Prozentzahl wäre nur die nächste geratene Konstante und
    // gölte für den nächsten Coin wieder nicht.
    //
    // Deshalb ist die Vorgabe die ATR der Zonen-Zeiteinheit: „eine Zone ist
    // etwa eine halbe Tagesspanne breit" ist dieselbe Aussage für jeden
    // Markt, und genau das meint das Video mit seinem Pip-Richtwert.
    // Gerechnet wird mit dem MEDIAN der ATR über das Zonenfenster, nicht mit
    // ihrem letzten Wert: sonst schnitte jeder Volatilitätsschub sämtliche
    // Zonen neu, und eine Zone, die sich unter dem Kurs bewegt, ist keine.
    {
        key: 'zonenMassstab', type: 'select', default: 'atr', group: 'zones',
        options: [{ value: 'atr', labelKey: 'strategies.set_and_forget.massstabAtr' },
                  { value: 'prozent', labelKey: 'strategies.set_and_forget.massstabProzent' }],
    },
    { key: 'zonenAtrLaenge', type: 'integer', default: 14, min: 2, max: 100, step: 1, group: 'zones' },
    // Vielfache der ATR — gelten im Massstab 'atr'.
    { key: 'zonenToleranzAtr', type: 'number', default: 0.6, min: 0.05, max: 5, step: 0.05, group: 'zones' },
    { key: 'zonenMinBreiteAtr', type: 'number', default: 0.1, min: 0.01, max: 3, step: 0.01, group: 'zones' },
    // Die Kappung greift erst UNTERHALB der Toleranz: weiter als diese kann
    // ein Cluster gar nicht streuen, weil jeder Punkt innerhalb der Toleranz
    // zum ERSTEN der Gruppe liegen muss. Gemessen ändert 3,0 gegenüber 1,5
    // exakt nichts (52/32/69 Trades auf BTC/ETH/SOL, identisch) — wer hier
    // etwas bewirken will, muss unter die Toleranz gehen.
    { key: 'zonenMaxBreiteAtr', type: 'number', default: 1.5, min: 0.05, max: 6, step: 0.05, group: 'zones' },
    { key: 'zoneNaeheAtr', type: 'number', default: 0.2, min: 0, max: 3, step: 0.05, group: 'zones' },
    // Prozent des Kurses — gelten im Massstab 'prozent'.
    { key: 'zonenToleranzPct', type: 'number', default: 0.35, min: 0.02, max: 10, step: 0.01, group: 'zones' },
    { key: 'zonenMinBreitePct', type: 'number', default: 0.05, min: 0.01, max: 2, step: 0.01, group: 'zones' },
    { key: 'zonenMaxBreitePct', type: 'number', default: 0.8, min: 0.05, max: 10, step: 0.05, group: 'zones' },
    { key: 'zoneNaehePct', type: 'number', default: 0.1, min: 0, max: 3, step: 0.01, group: 'zones' },
    { key: 'zonenFensterHtf', type: 'integer', default: 250, min: 40, max: 1500, step: 10, group: 'zones' },

    // ── Umkehrformationen ─────────────────────────────────────────
    { key: 'musterEngulfing', type: 'boolean', default: true, group: 'confirm' },
    { key: 'musterDocht', type: 'boolean', default: true, group: 'confirm' },
    { key: 'musterDoji', type: 'boolean', default: true, group: 'confirm' },
    { key: 'musterStern', type: 'boolean', default: true, group: 'confirm' },
    { key: 'dochtVerhaeltnis', type: 'number', default: 2, min: 1, max: 6, step: 0.1, group: 'confirm' },
    {
        key: 'direction', type: 'select', default: 'both', group: 'direction',
        options: [{ value: 'both', labelKey: 'strategies.directionBoth' },
                  { value: 'long', labelKey: 'strategies.set_and_forget.dirLong' },
                  { value: 'short', labelKey: 'strategies.set_and_forget.dirShort' }],
    },

    // ── Einstieg ──────────────────────────────────────────────────
    { key: 'scanWindowCandles', type: 'integer', default: 200, min: 30, max: 1000, step: 10, group: 'entry' },
    { key: 'sperreSamstag', type: 'boolean', default: false, group: 'entry' },
    { key: 'sperreSonntag', type: 'boolean', default: false, group: 'entry' },
    { key: 'sperreMontag', type: 'boolean', default: false, group: 'entry' },

    // ── Ausstieg ──────────────────────────────────────────────────
    {
        key: 'slQuelle', type: 'select', default: 'signalkerze', group: 'exit',
        options: [{ value: 'signalkerze', labelKey: 'strategies.set_and_forget.slSignal' },
                  { value: 'zone', labelKey: 'strategies.set_and_forget.slZone' }],
    },
    { key: 'slPufferPct', type: 'number', default: 0.1, min: 0, max: 3, step: 0.01, group: 'exit' },
    {
        key: 'tpQuelle', type: 'select', default: 'zone', group: 'exit',
        options: [{ value: 'zone', labelKey: 'strategies.set_and_forget.tpQuelleZone' },
                  { value: 'rr', labelKey: 'strategies.set_and_forget.tpQuelleRR' }],
    },
    // Gilt als festes Ziel bei `tpQuelle = rr` und als Deckel für das
    // Zonenziel: eine Zone zehn Prozent entfernt ist kein Ziel, sondern eine
    // Hoffnung, und sie würde die Auswertung mit einem Ausreisser verzerren.
    { key: 'tpRR', type: 'number', default: 4, min: 0.5, max: 20, step: 0.5, group: 'exit' },
    { key: 'minRR', type: 'number', default: 2, min: 0, max: 10, step: 0.1, group: 'exit' },
    // Set and Forget heisst 0. Beide Schalter stehen hier, damit die Frage
    // „was kostet die Regel eigentlich" messbar ist, nicht als Empfehlung.
    { key: 'breakEvenAtR', type: 'number', default: 0, min: 0, max: 10, step: 0.1, group: 'exit' },
    { key: 'maxHoldCandles', type: 'integer', default: 0, min: 0, max: 2000, step: 1, group: 'exit' },
]

const paramGroups = [
    { id: 'trend', labelKey: 'strategies.groups.trend' },
    { id: 'structure', labelKey: 'strategies.groups.structure' },
    { id: 'zones', labelKey: 'strategies.set_and_forget.groupZones' },
    { id: 'confirm', labelKey: 'strategies.groups.confirm' },
    { id: 'direction', labelKey: 'strategies.groups.direction' },
    { id: 'entry', labelKey: 'strategies.groups.entry' },
    { id: 'exit', labelKey: 'strategies.groups.exit' },
]

// ── Hilfsfunktionen (rein, deshalb exportiert und einzeln testbar) ────────

/**
 * Trendrichtung aus der Marktstruktur: +1 bei höherem Hoch UND höherem Tief,
 * −1 bei tieferem Hoch UND tieferem Tief, sonst 0.
 *
 * Die Null ist kein Formfehler, sondern die dritte Antwort: Hoch und Tief
 * zeigen unterschiedliche Richtungen — eine Spanne. Das Regelwerk verlangt
 * zwei GLEICHGERICHTETE Ebenen, und eine Spanne ist keine Richtung.
 *
 * Verglichen werden die beiden jeweils letzten BESTÄTIGTEN Pivots; ein Pivot
 * mit `rechts` Kerzen Bestätigung steht erst so viele Kerzen später fest, und
 * `pivotHighs` liefert deshalb von sich aus keine jüngeren.
 */
export function strukturTrend(kerzen, links, rechts) {
    const hochs = pivotHighs(kerzen, links, rechts)
    const tiefs = pivotLows(kerzen, links, rechts)
    if (hochs.length < 2 || tiefs.length < 2) return 0
    const hh = hochs[hochs.length - 1].price > hochs[hochs.length - 2].price
    const lh = hochs[hochs.length - 1].price < hochs[hochs.length - 2].price
    const hl = tiefs[tiefs.length - 1].price > tiefs[tiefs.length - 2].price
    const ll = tiefs[tiefs.length - 1].price < tiefs[tiefs.length - 2].price
    if (hh && hl) return 1
    if (lh && ll) return -1
    return 0
}

/**
 * Die drei Zonenmasse in Prozent des Kurses — aufgelöst nach Massstab.
 *
 * Im ATR-Modus ist die Bezugsgrösse der MEDIAN der ATR über dasselbe Fenster,
 * aus dem auch die Zonen kommen, geteilt durch den Median-Schlusskurs. Der
 * Median und nicht der letzte Wert: ein einzelner Ausschlag würde sonst die
 * Zonen des ganzen Charts umschneiden.
 *
 * Fehlt die ATR (zu kurze Reihe), fallen die Prozentwerte ein. Das ist die
 * ehrlichere Vorgabe als eine ATR von null, die jede Zone auf einen Strich
 * zusammenzöge und die Strategie stillschweigend stilllegte.
 */
export function zonenMasse(kerzen, p) {
    if (p.zonenMassstab !== 'atr') {
        return {
            toleranz: p.zonenToleranzPct, minBreite: p.zonenMinBreitePct,
            maxBreite: p.zonenMaxBreitePct, naehe: p.zoneNaehePct, atrPct: null,
        }
    }
    const reihe = atr(kerzen, p.zonenAtrLaenge).filter((v) => v !== null && v > 0)
    const preise = kerzen.map((k) => k.c).filter((v) => v > 0).sort((a, b) => a - b)
    if (reihe.length < 5 || !preise.length) {
        return {
            toleranz: p.zonenToleranzPct, minBreite: p.zonenMinBreitePct,
            maxBreite: p.zonenMaxBreitePct, naehe: p.zoneNaehePct, atrPct: null,
        }
    }
    const sortiert = [...reihe].sort((a, b) => a - b)
    const atrMedian = sortiert[Math.floor(sortiert.length / 2)]
    const preisMedian = preise[Math.floor(preise.length / 2)]
    const atrPct = (atrMedian / preisMedian) * 100
    return {
        toleranz: atrPct * p.zonenToleranzAtr,
        minBreite: atrPct * p.zonenMinBreiteAtr,
        maxBreite: atrPct * p.zonenMaxBreiteAtr,
        naehe: atrPct * p.zoneNaeheAtr,
        atrPct,
    }
}

/**
 * Zonen aus den Wendepunkten einer Kerzenreihe.
 *
 * Eine Zone entsteht, wo sich mehrere Wendepunkte auf ähnlicher Höhe drängen.
 * Geclustert wird von unten nach oben und gierig: der erste Punkt eröffnet die
 * Zone, jeder weitere innerhalb der Toleranz gehört dazu. Das ist bewusst die
 * einfachste Regel, die die Anforderung erfüllt — jede klügere (k-Means,
 * Dichteschätzung) hätte Startwerte oder Bandbreiten, und die wären genau der
 * Ermessensspielraum, den die Videos offen lassen und der ihre beiden Tests um
 * den Faktor zwei auseinandergebracht hat.
 *
 * HOCH- UND TIEFPUNKTE ZÄHLEN GEMEINSAM: eine Zone, die dreimal als
 * Widerstand und einmal als Unterstützung gedreht hat, ist dieselbe Zone —
 * das ist der ganze Sinn des Begriffs. Getrennt gezählt würde sie zweimal
 * knapp an der Schwelle scheitern.
 *
 * @returns {Array<{tief:number, hoch:number, mitte:number, punkte:number, letzterIndex:number}>}
 *          aufsteigend nach Preis
 */
export function findeZonen(kerzen, p, masse = null) {
    const m = masse || zonenMasse(kerzen, p)
    const basis = p.nurKoerper ? koerperKerzen(kerzen) : kerzen
    const punkte = [
        ...pivotHighs(basis, p.pivotLinks, p.pivotRechts),
        ...pivotLows(basis, p.pivotLinks, p.pivotRechts),
    ].sort((a, b) => a.price - b.price)
    if (!punkte.length) return []

    const zonen = []
    let gruppe = [punkte[0]]
    const abstandOk = (preis, ab) => ab > 0 && ((preis - ab) / ab) * 100 <= m.toleranz

    const abschluss = () => {
        if (gruppe.length < p.zonenBeruehrungen) return
        let tief = gruppe[0].price
        let hoch = gruppe[gruppe.length - 1].price
        const mitte = (tief + hoch) / 2
        const min = mitte * (m.minBreite / 100)
        const max = mitte * (m.maxBreite / 100)
        let breite = hoch - tief
        if (breite < min) breite = min
        if (breite > max) breite = max
        tief = mitte - breite / 2
        hoch = mitte + breite / 2
        zonen.push({
            tief, hoch, mitte,
            punkte: gruppe.length,
            letzterIndex: Math.max(...gruppe.map((g) => g.index)),
        })
    }

    for (let i = 1; i < punkte.length; i++) {
        if (abstandOk(punkte[i].price, gruppe[0].price)) { gruppe.push(punkte[i]); continue }
        abschluss()
        gruppe = [punkte[i]]
    }
    abschluss()
    return zonen
}

/**
 * Hat die Kerze die Zone angetestet und auf der richtigen Seite geschlossen?
 *
 * Long heisst: von oben an eine Unterstützung heran. Das Tief muss die Zone
 * erreicht haben (mit Toleranz), der SCHLUSS muss über deren Unterkante
 * liegen. Ein Schluss unterhalb ist kein Test, sondern ein Durchbruch — und
 * genau der Unterschied entscheidet, ob eine Hammerkerze ein Einstieg ist
 * oder der Anfang des nächsten Abwärtsschubs.
 */
export function zonenTreffer(zone, kerze, long, naehePct) {
    const t = (naehePct / 100) * kerze.c
    if (long) {
        return kerze.l <= zone.hoch + t && kerze.c >= zone.tief - t && kerze.c <= zone.hoch + t * 3
    }
    return kerze.h >= zone.tief - t && kerze.c <= zone.hoch + t && kerze.c >= zone.tief - t * 3
}

/**
 * Welche der erlaubten Umkehrformationen liegt auf Kerze `i`?
 *
 * Die Liste ist abschliessend: was das Video durchstreicht (Spinning Top,
 * gewöhnlicher Doji, Piercing Line, Dark Cloud Cover, Three Soldiers/Crows),
 * fehlt hier auch. Der gewöhnliche Doji ist der wichtigste Ausschluss — er ist
 * Unentschlossenheit, und die Dragonfly-/Gravestone-Varianten unterscheiden
 * sich von ihm genau darin, dass der Docht eine Seite ablehnt.
 *
 * @returns {string|null} Name der Formation
 */
export function musterTreffer(candles, i, long, p) {
    const k = candles[i]
    const vor = candles[i - 1]
    const vorvor = candles[i - 2]
    if (!k || !vor) return null

    if (p.musterEngulfing) {
        if (long && isBullishEngulfing(vor, k)) return 'bullish_engulfing'
        if (!long && isBearishEngulfing(vor, k)) return 'bearish_engulfing'
    }
    if (p.musterDocht) {
        // Hammer und Inverted Hammer sind beide Long-Formationen; welche von
        // beiden vorliegt, unterscheidet nur die Docht-Seite.
        if (long && isHammer(k, p.dochtVerhaeltnis)) return 'hammer'
        if (long && isShootingStar(k, p.dochtVerhaeltnis) && k.c > k.o) return 'inverted_hammer'
        if (!long && isShootingStar(k, p.dochtVerhaeltnis)) return 'shooting_star'
        if (!long && isHammer(k, p.dochtVerhaeltnis) && k.c < k.o) return 'hanging_man'
    }
    if (p.musterDoji) {
        if (long && isDragonflyDoji(k, 0.1, p.dochtVerhaeltnis)) return 'dragonfly_doji'
        if (!long && isGravestoneDoji(k, 0.1, p.dochtVerhaeltnis)) return 'gravestone_doji'
    }
    if (p.musterStern && vorvor) {
        if (long && isMorningStar(vorvor, vor, k)) return 'morning_star'
        if (!long && isEveningStar(vorvor, vor, k)) return 'evening_star'
    }
    return null
}

/**
 * Nächste Zone in Handelsrichtung — das Ziel.
 *
 * Gezielt wird auf die NAHE Kante: bis zur Mitte einer Widerstandszone kommt
 * der Kurs oft nicht mehr. Zonen, die den Einstieg noch einschliessen, zählen
 * nicht — sonst wäre das Ziel im eigenen Einstiegsbereich.
 */
export function zielZone(zonen, entry, long) {
    let beste = null
    for (const z of zonen) {
        if (long) {
            if (!(z.tief > entry)) continue
            if (!beste || z.tief < beste.tief) beste = z
        } else {
            if (!(z.hoch < entry)) continue
            if (!beste || z.hoch > beste.hoch) beste = z
        }
    }
    return beste
}

/** Abstand zweier Kerzen in ms — Median, damit eine Lücke nichts verschiebt. */
export function kerzenAbstand(kerzen) {
    if (!Array.isArray(kerzen) || kerzen.length < 2) return 0
    const d = []
    for (let i = 1; i < kerzen.length; i++) d.push(kerzen[i].t - kerzen[i - 1].t)
    d.sort((a, b) => a - b)
    return d[Math.floor(d.length / 2)] || 0
}

// ── detect ───────────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {Array}  input.candles          geschlossene Kerzen, aufsteigend
 * @param {object} input.params           validierte Parameter
 * @param {Array}  input.openSetups       laufende Setups mit id
 * @param {Array}  [input.knownSetupKeys] ALLE bekannten `${direction}|${obCandleTime}`
 * @param {Array}  [input.htfCandles]     geschlossene Kerzen der höheren Zeiteinheit
 *
 * @returns {{ setups: Array, events: Array, diagnostics: object }}
 */
function detect({ candles, params: p, openSetups = [], knownSetupKeys = [], htfCandles = null }) {
    const setups = []
    const events = []
    const diagnostics = { sweepsFound: 0, setupsCreated: 0, rejected: {}, rejections: [] }

    const reject = (reason, key) => {
        diagnostics.rejected[reason] = (diagnostics.rejected[reason] || 0) + 1
        diagnostics.rejections.push({ reason, key })
    }

    const mindestens = p.pivotLinks + p.pivotRechts + 10
    if (!Array.isArray(candles) || candles.length < mindestens) {
        return { setups, events, diagnostics }
    }

    // ── Trend und Zonen: welche Reihe liefert sie? ────────────────────────
    // Mit eingeschaltetem HTF-Filter kommen beide aus der höheren
    // Zeiteinheit. Fehlen deren Kerzen, wird NICHT gehandelt: ein Filter, der
    // sich bei fehlenden Daten selbst abschaltet, macht aus einem gefilterten
    // Lauf stillschweigend einen ungefilterten — und der sieht im Ergebnis
    // genauso aus.
    let basis = candles
    let zweite = null
    if (p.htfTrendFilter) {
        const noetigHtf = Math.max(p.pivotLinks + p.pivotRechts + 10,
            p.zweiteEbene ? (p.pivotLinks + p.pivotRechts + 4) * p.zweiteEbeneFaktor : 0)
        if (!Array.isArray(htfCandles) || htfCandles.length < noetigHtf) {
            // Gezählt, aber NICHT in `rejections` gelegt: der Backtest macht
            // aus jedem Eintrag dort einen gefundenen Kandidaten, und am
            // Anfang eines Laufs fehlt der Vorlauf der höheren Zeiteinheit
            // schlicht — das sind keine abgelehnten Setups, sondern Takte
            // ohne Datenlage. Vermischt sähe der Trichter aus, als hätte die
            // Strategie hunderte Signale verworfen.
            diagnostics.rejected[INVALID_REASONS.HTF_FEHLT] =
                (diagnostics.rejected[INVALID_REASONS.HTF_FEHLT] || 0) + 1
            return { setups, events, diagnostics }
        }
        basis = htfCandles.slice(-p.zonenFensterHtf)
        if (p.zweiteEbene) {
            const ms = kerzenAbstand(htfCandles)
            zweite = aggregiereKerzen(htfCandles, ms, p.zweiteEbeneFaktor)
        }
    } else if (p.zweiteEbene) {
        const ms = kerzenAbstand(candles)
        zweite = aggregiereKerzen(candles, ms, p.zweiteEbeneFaktor)
        basis = candles.slice(-p.zonenFensterHtf)
    }

    const trendKerzen = p.nurKoerper ? koerperKerzen(basis) : basis
    const trend1 = strukturTrend(trendKerzen, p.pivotLinks, p.pivotRechts)
    const trend2 = zweite
        ? strukturTrend(p.nurKoerper ? koerperKerzen(zweite) : zweite, p.pivotLinks, p.pivotRechts)
        : trend1
    const masse = zonenMasse(basis, p)
    const zonen = findeZonen(basis, p, masse)

    const bekannt = new Set(knownSetupKeys)
    for (const s of openSetups) bekannt.add(`${s.direction}|${s.obCandleTime}`)

    // ══ Phase A: neue Setups ══════════════════════════════════════════════
    const richtungen = p.direction === 'both' ? ['long', 'short'] : [p.direction]
    const scanAb = Math.max(2, candles.length - p.scanWindowCandles)

    for (const dir of richtungen) {
        const long = dir === 'long'
        for (let i = scanAb; i < candles.length; i++) {
            const k = candles[i]
            const key = `${dir}|${k.t}`
            if (bekannt.has(key)) continue

            // (1) Formation — der billigste Filter zuerst, und zugleich der,
            //     der einen Kandidaten überhaupt erst zu einem macht.
            const muster = musterTreffer(candles, i, long, p)
            if (!muster) continue

            // (2) Zone: die Kerze muss an einer liegen und richtig schliessen.
            const zone = zonen.find((z) => zonenTreffer(z, k, long, masse.naehe))
            if (!zone) continue

            // Ab hier ist es ein Kandidat — was jetzt noch scheitert, gehört
            // in den Trichter. Formation ohne Zone dagegen ist kein
            // abgelehntes Setup, sondern schlicht kein Setup; sie mitzuzählen
            // würde den Trichter mit jeder Hammerkerze des Charts fluten.
            diagnostics.sweepsFound++

            // (3) Trend beider Ebenen in Handelsrichtung.
            const soll = long ? 1 : -1
            if (trend1 !== soll || trend2 !== soll) {
                reject(trend1 === -soll || trend2 === -soll
                    ? INVALID_REASONS.GEGEN_TREND : INVALID_REASONS.KEIN_TREND, key)
                continue
            }

            bekannt.add(key)
            setups.push({
                direction: dir,
                status: 'waiting_retest',
                sweepLevel: zone.mitte,
                sweepPrice: long ? zone.tief : zone.hoch,
                sweepCandleTime: k.t,
                obHigh: zone.hoch,
                obLow: zone.tief,
                obCandleTime: k.t,
                impulseExtreme: long ? k.l : k.h,
                entry: 0,
                stopLoss: 0,
                takeProfit: 0,
                rr: 0,
                confirmations: { muster, zonenPunkte: zone.punkte, entryTrigger: 'market' },
                detectorVersion: DETECTOR_VERSION,
                entryTrigger: 'market',
                // Gehandelt wird die ERÖFFNUNG der nächsten Kerze; die
                // Signalkerze selbst ist erst mit ihrem Schluss bekannt.
                watchFrom: k.t,
                tradeableFrom: k.t,
            })
            diagnostics.setupsCreated++
        }
    }

    // ══ Phase B: laufende Setups ══════════════════════════════════════════
    for (const s of openSetups) {
        if (s.status !== 'waiting_retest' && s.status !== 'armed') continue
        const long = s.direction === 'long'

        const ab = Number(s.watchFrom || s.obCandleTime) || 0
        const i = candles.findIndex((c) => c.t > ab)
        if (i === -1) continue          // die nächste Kerze fehlt noch

        const k = candles[i]
        const signal = candles[i - 1]
        const key = `${s.direction}|${s.obCandleTime}`

        if (tagGesperrt(k.t, p)) {
            events.push({ id: s.id, status: 'expired', invalidReason: INVALID_REASONS.WOCHENTAG_GESPERRT, candleTime: k.t })
            continue
        }

        // Marktorder zur Eröffnung — kein Wunschpreis, kein Warten.
        const entry = k.o

        // Stop hinter den Docht der Signalkerze oder hinter die Zone. Ist das
        // Setup älter als das Sichtfenster (Kaltstart), fehlt die Signalkerze;
        // dann trägt die Zone den Stop, statt zu raten.
        const zoneTief = Number(s.obLow) || 0
        const zoneHoch = Number(s.obHigh) || 0
        let roh = 0
        if (p.slQuelle === 'zone' || !signal) roh = long ? zoneTief : zoneHoch
        else roh = long ? Math.min(signal.l, zoneTief) : Math.max(signal.h, zoneHoch)
        const puffer = p.slPufferPct / 100
        const stopLoss = long ? roh * (1 - puffer) : roh * (1 + puffer)

        if (!(stopLoss > 0) || (long ? stopLoss >= entry : stopLoss <= entry)) {
            events.push({ id: s.id, status: 'rejected', invalidReason: INVALID_REASONS.STOP_UNGUELTIG, candleTime: k.t })
            reject(INVALID_REASONS.STOP_UNGUELTIG, key)
            continue
        }

        const risiko = Math.abs(entry - stopLoss)
        let takeProfit = long ? entry + risiko * p.tpRR : entry - risiko * p.tpRR
        if (p.tpQuelle === 'zone') {
            const ziel = zielZone(zonen, entry, long)
            if (!ziel) {
                events.push({ id: s.id, status: 'rejected', invalidReason: INVALID_REASONS.KEINE_ZIELZONE, candleTime: k.t })
                reject(INVALID_REASONS.KEINE_ZIELZONE, key)
                continue
            }
            // Die nahe Kante, gedeckelt auf `tpRR`: eine Zone weit jenseits
            // davon ist kein Ziel mehr, sondern ein Lottoschein.
            const kante = long ? ziel.tief : ziel.hoch
            takeProfit = long
                ? Math.min(kante, entry + risiko * p.tpRR)
                : Math.max(kante, entry - risiko * p.tpRR)
        }

        const rr = Math.abs(takeProfit - entry) / risiko
        if (p.minRR > 0 && rr < p.minRR) {
            events.push({ id: s.id, status: 'rejected', invalidReason: INVALID_REASONS.UNTER_MIN_RR, candleTime: k.t })
            reject(INVALID_REASONS.UNTER_MIN_RR, key)
            continue
        }

        events.push({
            id: s.id, status: 'triggered', triggeredAt: k.t, candleTime: k.t,
            entry, stopLoss, takeProfit, rr,
            entryTrigger: 'market',
            confirmations: { ...(s.confirmations || {}), entryTrigger: 'market', rr: Number(rr.toFixed(2)) },
        })
    }

    return { setups, events, diagnostics }
}

export default {
    id: 'set_and_forget',
    name: 'Set and Forget',
    description: 'Umkehrkerze an einer mehrfach bestätigten Zone der höheren Zeiteinheit, im Trend zweier Ebenen; Marktorder zur nächsten Eröffnung, Stop und Ziel bleiben stehen.',
    version: DETECTOR_VERSION,
    supportedTimeframes: ['15m', '30m', '1h', '4h', '1d'],
    warmupCandles: 300,
    params,
    paramGroups,
    detect,
}
