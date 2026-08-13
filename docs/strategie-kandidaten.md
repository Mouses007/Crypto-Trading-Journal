# Strategie-Kandidaten für den Regel-Interpreter

Quelle: Rangliste „Trading Strategie Analyse" (89 Einträge, Stand der übergebenen
`ranking.json`). Geprüft gegen `server/strategies/rule-engine.js` (`BAUSTEINE`),
`rule-validate.js` und `indicators.js`.

Alle Zahlen des Kanals sind **vor Gebühren**. Der Kanal riskiert **2 % pro Trade** —
das lässt sich aus den Daten rückrechnen (`profit100 = EV_in_R × 100 × 2 %`, stimmt
bei allen fünf Kandidaten auf zwei Stellen). Diese 2 % nutze ich unten für die
Gebührenrechnung.

---

## Kurzfazit

Fünf Kandidaten, in dieser Reihenfolge umsetzen:

1. **Rang 19 – Optimierte MACD-Strategie** (1 h, 1095 Tage, PF 2,17, MaxDD 8 %).
   Bestes Verhältnis aus Testlänge, Kennzahlen und Umsetzbarkeit. Es fehlt genau
   ein Indikator (MACD, zwei EMAs + Signal-EMA). Alles andere — EMA-Wolke,
   Cross-Signal, festes 1:3-…-Verhältnis, Break-Even ab 1 R — kann die Engine heute.
2. **Rang 6 – „Holy Grail" 2.0** (Tageskerzen, 35 Jahre, PF 2,26, MaxDD 10 %).
   Mit Abstand der belastbarste Test der ganzen Liste und praktisch gebührenimmun.
   Preis: ADX + Bollinger fehlen, und der Price-Action-Filter lässt sich nur
   angenähert nachbauen. Dafür passt die Einstiegsmechanik (Stop-Order am
   Signalkerzen-Hoch, 5-Kerzen-Frist) exakt auf vorhandene Bausteine.
3. **Rang 5 – ChatGPT-Strategie 2.0** (1 h, 733 Tage, PF 2,26, MaxDD 24 %).
   Starke Kennzahlen über zwei Jahre, saubere mechanische Regeln, aber der höchste
   Drawdown im Feld (12 Verluste in Folge) und ein enger Stop → gebührenempfindlich.
4. **Rang 21 – Bollinger + RSI 2.0** (1 h, 284 Tage, PF 1,88, MaxDD 14 %).
   Die technisch sauberste Abbildung von allen: das Signal ist wörtlich ein
   `crossUp(rsi, 20)`. Nur die Bollinger-Bänder fehlen. Schwachpunkt ist der mit
   284 Tagen kürzeste Testzeitraum der fünf.
5. **Rang 49 – ChatGPT-Daytrading-Strategie** (1 h, 486 Tage, PF 1,83, MaxDD 10 %).
   SMA + RSI hat die Engine schon, es fehlt nur die Stochastik. Nachteil: mit
   1:1,5 reagiert die Strategie von allen fünf am empfindlichsten auf Gebühren
   (rund ein Drittel der Kante).

Bewusst **nicht** dabei: die Ränge 1–4, 7, 11, 14 usw. (Premium-Indikatoren ohne
offene Berechnung), Rang 8/33 (Multi-Timeframe), Rang 12 (Ichimoku — gute Zahlen,
aber der entscheidende Filter ist ein undokumentierter Fremd-Indikator), Rang 13
(VuManChu Cipher B + ATR-Stop + wanderndes Ziel). Details unten unter „Verworfen".

---

## Was der Engine grundsätzlich fehlt

Diese Lücken treffen mehrere Kandidaten gleichzeitig. Wer sie einmal schliesst,
verbilligt alle folgenden Umsetzungen:

| Lücke | Betrifft | Aufwand |
| --- | --- | --- |
| **Anker „letztes Swing-Tief/-Hoch"** für den Stop. `pivotLow`/`pivotHigh` gibt es nur als *Signal*, nicht als *Anker*. Heute nur `signalLow` / `correctionLow` verfügbar. | 19, 21, 49, (33, 60) | klein |
| **Einstieg zum Open der Folgekerze.** `entry: immediate` steigt beim **Close** der ersten Kerze nach dem Signal ein (Phase B startet bei `t > Signalzeit`). Der Kanal steigt praktisch immer beim *Open* der Folgekerze ein. | 19, 21, 49 | klein (`entry.price: 'open'`) |
| **Kerzenmuster als Vergleich.** `indicators.js` hat `isBullishEngulfing`, `isBearishEngulfing`, `isHammer`, `isShootingStar` bereits implementiert — sie sind nur in `BAUSTEINE.vergleiche` nicht freigeschaltet. | 5, 6 | klein |
| **Tageszeit-Filter.** Der Kanal handelt in fast allen Tests nur 09:00–23:00 (London/NY, „Sessions-Indikator"). Die Engine kann das nicht. Bei 24/7-Krypto entstehen dadurch zusätzliche Nacht-Signale, die im Video nie getestet wurden. | alle 1 h/15 min | mittel |
| **ATR-basierter Stop** (`entry − k × ATR`). `stopLoss.anchor` erwartet einen *Preis*; ein ATR-Wert ist eine *Distanz*. | 13 (verworfen), nice-to-have | klein |
| **Multi-Timeframe-Bedingungen** (Trend auf 4 h, Einstieg auf 1 h). | 8, 33 (verworfen) | gross |
| **Teilausstiege / wanderndes Ziel.** Break-Even ab X R gibt es (`breakEvenAtR`, wird von `fill-simulator.js` sauber umgesetzt); Teilverkäufe nicht. | 13 (verworfen) | gross |

**Methodische Warnung zu allen fünf:** Der Kanal zählt Trades, die nach dem
Break-Even-Nachzug mit 0 R ausgestoppt werden, **nicht** in die 100 Trades
(steht so in der Fussnote der Rangliste). Unser Backtest zählt sie. Bei jeder
Strategie mit `breakEvenAtR = 1` — also 5, 19, 21 — wird unser Ergebnis deshalb
systematisch schlechter aussehen als das Video, ohne dass ein Fehler vorliegt.
Das ist kein Grund, die Strategie zu verwerfen, aber ein Grund, die Zahlen nicht
direkt zu vergleichen.

---

## 1. Rang 19 — Optimierte MACD-Strategie

**Video:** <https://youtu.be/ZQnmmZFA7I0>
**Rang 19 · 1 h · RR 1:2 · 1095 Tage · 52 % WR · Profit100 112 % · MaxDD 8 % · PF 2,17 · AAR 25 %**
Getestet auf EUR/USD, laut Video in jedem Markt anwendbar.

### Regeln (aus dem Transkript)

Indikatoren:
- **EMA-Wolke**: EMA 20 (fast) und EMA 200 (slow). Er nutzt einen fertigen
  „EMA Cloud"-Indikator, sagt aber ausdrücklich: „wenn es diese nicht gibt,
  könnt ihr auch zwei normale EMAs verwenden."
- **MACD** (Standard 12/26/9, Histogramm ausgeblendet, nur die Kreuzungspunkte).

Kaufsignal:
1. Der Preis befindet sich **oberhalb der EMA-Wolke**.
2. Die Kerze darf **den unteren Rand der Wolke nicht berühren** — „wenn er doch
   bis hierhin verlaufen würde, nehmen wir die Kerze nicht mit".
3. **Grüner Punkt im MACD**: die MACD-Linie kreuzt die Signallinie von unten nach
   oben, **und das passiert unterhalb der Nulllinie**.
4. Einstieg mit der Signalkerze (Long).
5. **Stop Loss** beim letzten Swing-Tief.
6. **Take Profit** bei RR 1:2.

Verkaufssignal spiegelbildlich: Preis unter der Wolke, Kerze berührt den oberen
Rand nicht, roter MACD-Punkt **oberhalb** der Nulllinie, Stop über dem letzten
Swing-Hoch.

Verbesserung (die 112 % beziehen sich darauf): **Sobald 1 R erreicht ist, Stop auf
Break-Even ziehen**, Ziel bleibt 2 R. Von 100 Trades erreichten 21 vorher 1 R,
davon liefen 18 danach gegen ihn — genau diese 18 rettet die Anpassung.

### Umsetzbarkeit

Reicht heute schon:
- `ema` (20 und 200), `crossUp` als Signaltyp, `signalFilters` mit `gt`/`lt`,
  `takeProfit: { mode: 'rr', rr: 2 }`, `breakEvenAtR: 1`.
- Das Signal ist wörtlich `signal: { type: 'crossUp', a: 'macdLine', b: 'macdSignal' }`,
  der Nulllinien-Filter ein `signalFilter: { op: 'lt', left: 'macdLine', right: { value: 0 } }`.
- Punkt 1 + 2 modelliere ich als `close > ema20` **und** `low > ema200`
  (Wolkenunterkante im Aufwärtstrend = EMA 200). **Das ist meine Auslegung** —
  der Sprecher sagt „oberhalb der Wolke" und „unteren Teil nicht berühren", was
  sich streng genommen überschneidet.

Fehlt:
- **MACD** als Indikatortyp — braucht zwei Serien (`macdLine`, `macdSignal`).
  Beides sind EMAs, die `ema()`-Funktion existiert. Umsetzung: neuer Typ mit
  `fast`/`slow`/`signal`, der zwei Ids belegt, analog zu `vwapBand`.
- **Stop-Anker „letztes Swing-Tief"**. Ersatzweise `signalLow` mit Puffer —
  das ist enger als im Video und verschiebt die Statistik.
- **Einstieg zum Open der Folgekerze** (s. o.).

**Aufwand: klein.** Mit dem Swing-Anker aus der gemeinsamen Liste: klein–mittel.

### Belastbarkeit und Gebühren

1095 Tage / 100 Trades ≈ 33 Trades pro Jahr — kein Overfitting an eine
Marktphase, drei Jahre decken Trend und Range ab. MaxDD 8 % ist der niedrigste
Wert unter allen ernsthaften Kandidaten. PF 2,17 bei 52 % WR ist plausibel und
nicht „zu schön".

Roh-Erwartungswert: 0,52 × 2 − 0,48 = **0,56 R** pro Trade.

Gebühren, plausibler Stopabstand auf 1 h Krypto (Swing-Tief) **0,8 %**, Round-Trip
0,10 %:

> (2 % Risiko ÷ 0,8 % Stop) × 0,10 % = **0,25 % vom Konto** pro Trade = 0,125 R

Netto 0,435 R → aus 112 % werden ca. **87 %** über 100 Trades. Bei Bitunix-Taker
(0,06 %/Seite = 0,12 % Round-Trip) sind es ca. 82 %. Bei einem engeren Stop von
0,5 % fällt es auf ca. 72 %. Die Strategie verträgt die Kosten, verliert aber
rund ein Fünftel ihrer Kante — akzeptabel für 1 h.

---

## 2. Rang 6 — „Holy Grail" 2.0

**Video:** <https://youtu.be/TOxkaO8g4Eg>
**Rang 6 · Tageskerzen · RR 1:3 · 12 784 Tage (~35 Jahre) · 43 % WR · Profit100 144 % · MaxDD 10 % · PF 2,26 · AAR 4,1 %**
Getestet auf dem S&P 500.

### Regeln (aus dem Transkript)

**Grundversion** (vollständig mechanisch):
- Indikatoren: **ADX** (Standardperiode, DI-Linien ausgeblendet, Level auf 30)
  und **SMA 20**.
- Kaufsignal: ADX **über 30**; Preis über dem SMA 20; dann ein **Pullback zurück
  zum SMA 20**. „Die erste Kerze, die die Linie berührt, ist unsere Signalkerze."
- Einstieg: **Buy-Stop-Order direkt am Hochpunkt der Signalkerze**.
- Stop Loss: an der Signalkerze bzw. der letzten Preisstruktur.
- Take Profit: **RR 1:3**.
- **Ordergültigkeit: maximal fünf Kerzen.** Wird der Einstieg nicht ausgelöst,
  wird die Order gelöscht.
- Verkaufssignal spiegelbildlich (Preis unter dem SMA, Pullback von unten,
  Sell-Stop am Tiefpunkt der Signalkerze).

**Verbesserte Version** — darauf beziehen sich die 144 % / PF 2,26 / MaxDD 10 %:
1. ADX-Schwelle **von 30 auf 25** gesenkt (bei 30 vergingen teils Monate ohne Signal).
2. Die starre SMA-Linie wird durch eine **Zone** ersetzt: Bollinger Bänder,
   Standardlänge 20, **Standardabweichung 0,25**. Eine Berührung dieser Zone gilt
   ab jetzt als gültiger Pullback.
3. Zusätzlicher Filter: die Signalkerze muss von einer **Price-Action-Formation**
   begleitet sein (im Beispiel eine Hammerkerze). Er nutzt den Indikator
   „Candlestick Patterns 0.3" von JustUncleL mit **allen** aktivierten Formationen
   und sagt ausdrücklich: „Für unsere Strategie ist es dabei irrelevant, welche
   Formation genau eintritt. Sie soll uns lediglich als finaler Filter dienen,
   der den Druck in die gewünschte Handelsrichtung bestätigt."
4. Einstieg, Stop, Ziel 1:3 und die 5-Kerzen-Frist bleiben unverändert.

### Umsetzbarkeit

Reicht heute schon — und zwar erstaunlich genau:
- **Buy-Stop am Signalkerzen-Hoch** = `entry: { type: 'touch', anchor: 'signalHigh', from: 'below' }`.
  Die Engine prüft dabei sogar korrekt, ob der Kurs den Anker übersprungen hat
  (`anchor_missed`).
- **5-Kerzen-Frist** = `invalidations: [{ type: 'timeout', candles: 5 }]`.
- **Stop an der Signalkerze** = `stopLoss: { anchor: 'signalLow', offsetPct: … }`.
- **Ziel 1:3** = `takeProfit: { mode: 'rr', rr: 3 }`.
- Pullback an eine Linie = `signal: { type: 'crossDown', a: 'low', b: 'sma20' }`
  („erste Kerze, deren Tief die Linie durchsticht") — trifft die Formulierung
  „erste Kerze, die die Linie berührt" gut.

Fehlt:
- **ADX** — der einzige harte Blocker der Grundversion. Wilder-DMI, keine
  Fremdbibliothek nötig, aber mehr Code als ein gleitender Durchschnitt.
- **Bollinger Bänder** (SMA ± k·σ). Klein, `vwapBand` ist die Vorlage.
- **Price-Action-Formation.** `indicators.js` kennt bereits `isHammer`,
  `isShootingStar`, `isBullishEngulfing`, `isBearishEngulfing` — die als
  Vergleichsoperatoren freizuschalten ist trivial. Aber: JustUncleL's Indikator
  kennt rund 30 Formationen. **Eine originalgetreue Nachbildung ist nicht
  möglich**, ohne den Indikatorcode Formation für Formation zu übertragen. Mit
  vier Mustern ist der Filter strenger als im Video → weniger Trades, andere
  Statistik. Das muss man beim Vergleich der Ergebnisse wissen.

**Aufwand: mittel** (ADX + BB + Mustervergleiche).
Die **Grundversion** wäre **klein** — dort fehlt nur der ADX.

### Belastbarkeit und Gebühren

Das mit Abstand robusteste Ergebnis der Liste: 100 Trades über 35 Jahre, auf dem
S&P. Es hat alles gesehen — Dotcom, 2008, 2020, 2022. MaxDD 10 % bei RR 1:3 und
43 % WR ist konsistent.

Die Kehrseite ist die Frequenz: **~3 Trades pro Jahr** auf einem Symbol. AAR 4,1 %
ist damit die niedrigste Jahresrendite der Kandidaten. Sinnvoll nur, wenn man sie
über viele Symbole parallel laufen lässt — was für einen Auto-Trading-Agenten
aber genau das richtige Muster ist.

Roh-Erwartungswert: 0,43 × 3 − 0,57 = **0,72 R**.

Gebühren, Tageskerzen, Stopabstand realistisch **2,5 %** (Krypto eher 3–4 %),
Round-Trip 0,10 %:

> (2 % ÷ 2,5 %) × 0,10 % = **0,08 % vom Konto** pro Trade = 0,04 R

Netto 0,68 R → aus 144 % werden ca. **136 %**. Praktisch gebührenimmun. Genau
deshalb gehört sie auf die Liste, obwohl der Umsetzungsaufwand höher ist als bei
Rang 19: sie ist die einzige, deren Kante nicht von den Handelskosten abhängt.

---

## 3. Rang 5 — Optimierte ChatGPT-Strategie 2.0

**Video:** <https://youtu.be/bGczdJ3qy6o>
**Rang 5 · 1 h · RR 1:3 · 733 Tage · 43 % WR · Profit100 144 % · MaxDD 24 % · PF 2,26 · AAR 72 %**
Getestet auf EUR/USD, gegengeprüft auf BTCUSDT.

### Regeln (aus dem Transkript)

**Grundversion:** Preis über/unter EMA 200, Money Flow Index schliesst unter 20
(bzw. über 80), dazu eine Engulfing-Formation; Einstieg beim Open der Folgekerze,
Stop unter der Formation oder dem letzten Swing-Tief, Ziel 1:2. Ergebnis war
mager und brauchte sehr lange für 100 Trades.

**Verbesserte Version** — darauf beziehen sich 144 % / PF 2,26 / MaxDD 24 %:
1. Der **MFI liefert keine Signale mehr, sondern nur noch Bestätigung.** Er stellt
   Overbought auf 100 und Oversold auf 0, wodurch der Indikator „zwei farblich
   abgetrennte Bereiche mit einer Transition-Zone" hat.
   → **Hier bleibt das Transkript unscharf.** Was genau der „rote Bereich" nach
   dieser Umstellung numerisch ist, sagt er nicht. Die naheliegende Lesart ist
   „MFI unterhalb der Mittellinie (50)". Das müsste man vor der Umsetzung am
   Chart verifizieren; raten will ich hier nicht.
2. Der **EMA 200 fliegt raus** („diesmal bin ich mutig").
3. **Signal ist die Engulfing-Kerze**, aber nur mit Qualitätsfilter: es müssen
   **mindestens drei Kerzen der Gegenfarbe in Folge** vor der Engulfing-Kerze
   liegen. Dafür nutzt er den Indikator „Engulfing Signal considering three
   previous" von Amri.
4. **Bestätigung:** der MFI muss bei der **aktuellen oder der letzten Kerze**
   innerhalb des roten Bereichs geschlossen haben (für Kaufsignale).
5. **Einstieg:** Buy-Stop-Order **leicht oberhalb der Signalkerze**.
6. **Stop Loss:** so knapp wie möglich, idealerweise leicht **unter der
   Signalkerze**.
7. **Take Profit: RR 1:3.**
8. **Ordergültigkeit: eine Kerze.** „Die nächste Kerze löst die Order aus — hätte
   sie das nicht getan, hätten wir die Order wieder geschlossen."
9. **Break-Even ab 1 R.**

Verkaufssignale spiegelbildlich.

### Umsetzbarkeit

Reicht heute schon:
- Buy-Stop = `entry: { type: 'touch', anchor: 'signalHigh', from: 'below' }`.
- Stop = `stopLoss: { anchor: 'signalLow', offsetPct: 0.05 }`.
- Ziel = `takeProfit: { mode: 'rr', rr: 3 }`, `breakEvenAtR: 1`.
- Ordergültigkeit = `invalidations: [{ type: 'timeout', candles: 1 }]`.

Fehlt:
- **Money Flow Index.** Braucht Volumen — das haben die Kerzen (`k.v`, wird von
  `vwap()` bereits benutzt). Reine Rechenarbeit, keine Architekturfrage.
- **Engulfing als Signaltyp.** `isBullishEngulfing`/`isBearishEngulfing` sind
  vorhanden, aber `BAUSTEINE.signale` kennt nur Pivots und Crosses. Es braucht
  einen neuen Signaltyp `pattern` (Muster + optional „N Gegenkerzen davor").
- Die MFI-Zonen-Definition (s. o.) ist **unklar** und muss am Chart geklärt werden.

**Aufwand: mittel.**

### Belastbarkeit und Gebühren

733 Tage / 100 Trades ≈ 50 Trades pro Jahr, zwei Jahre Testfenster — solide. Er
hat das Ergebnis zusätzlich auf BTCUSDT gegengeprüft, weil es ihm selbst zu gut
vorkam. Er nennt auch selbst Gebühren: „144 %, nach Gebühren immer noch 134 %"
(seine Annahme, CFD-Spreads).

Der Haken ist der **MaxDD von 24 %** — der höchste unter den fünf, verursacht
durch eine Serie von 12 Verlusten in Folge. Bei 43 % WR und 1:3 ist das
statistisch normal, aber es ist eine Serie, die man live aushalten muss.

Roh-Erwartungswert: 0,43 × 3 − 0,57 = **0,72 R**.

Gebühren: der Stop sitzt bewusst **eng** („möglichst knapp, leicht unter der
Signalkerze"). Auf 1 h Krypto heisst das eher **0,5 %** als 0,8 %:

> (2 % ÷ 0,5 %) × 0,10 % = **0,40 % vom Konto** pro Trade = 0,20 R

Netto 0,52 R → aus 144 % werden ca. **104 %**. Bei einem noch engeren Stop von
0,3 % nur noch ca. 78 %. Der enge Stop, der die Strategie stark macht, macht sie
auch am teuersten im Betrieb. Sie bleibt profitabel, aber der Abschlag ist mit
~28 % der grösste im Feld.

---

## 4. Rang 21 — Bollinger Bänder + RSI 2.0

**Video:** <https://youtu.be/5EP3EBy7AGo>
**Rang 21 · 1 h · RR 1:3 · 284 Tage · 38 % WR · Profit100 108,6 % · MaxDD 14 % · PF 1,88 · AAR 164 %**
Getestet auf NASDAQ-Futures.

### Regeln (aus dem Transkript)

Das Video testet drei Varianten. Die Rangliste bezieht sich auf die **dritte**
(„Verbesserung der Strategie" ab 7:03):

Indikatoren:
- **Bollinger Bänder**: Länge **200**, MA-Typ **EMA**, Standardabweichung **0,2**.
  Die Bänder sind hier ausdrücklich **kein** Extrem-Indikator mehr, sondern eine
  Trendbestimmung — „die Bänder stellen unsere Nicht-Trading-Zone dar".
- **RSI**: Länge **3**, Level auf **80 / 20** gesetzt.

Kaufsignal:
1. Der Preis muss **über den Bollinger Bändern schliessen** (übergeordneter
   Aufwärtstrend).
2. Der **RSI kreuzt das 20er-Level von unten nach oben**.
3. Einstieg beim **Open der nächsten Kerze**.
4. **Stop Loss** unter dem letzten sinnvollen Tiefpunkt / Swing Low.
5. **Take Profit RR 1:3**.
6. **Break-Even, sobald 1 R erreicht ist.**

Verkaufssignal: Preis unter den Bändern, RSI kreuzt das **80er-Level von oben
nach unten**, Rest spiegelbildlich.

### Umsetzbarkeit

Das ist die sauberste Abbildung im ganzen Feld:
- Signal wörtlich: `signal: { type: 'crossUp', a: 'rsi3', b: { value: 20 } }`.
  `pruefeRef` akzeptiert Konstanten als `{ value: 20 }` — das ist heute gültig.
- `rsi` mit Periode 3: vorhanden.
- `takeProfit: { mode: 'rr', rr: 3 }`, `breakEvenAtR: 1`: vorhanden.
- Trendfilter: `signalFilters: [{ op: 'gt', left: 'close', right: 'bbUpper' }]`.

Fehlt:
- **Bollinger Bänder mit EMA-Basis** (`ema200 ± 0,2 σ`). Klein — `vwapBand` zeigt
  bereits, wie ein Band-Indikator gebaut wird; hier ist die Basis eine EMA statt
  eines VWAP.
  *Behelfsweise ohne neuen Indikator*: `distancePctGt(close, ema200)` mit einer
  festen Prozentschwelle. Das ist **nicht dasselbe** — 0,2 σ atmet mit der
  Volatilität, ein fester Prozentsatz nicht. Als erster Testlauf brauchbar, für
  eine ernsthafte Bewertung nicht.
- **Stop-Anker „letztes Swing-Tief"** (s. gemeinsame Liste).
- **Einstieg zum Open der Folgekerze** (s. gemeinsame Liste).

**Aufwand: klein.**

### Belastbarkeit und Gebühren

Die schwächste Stelle: **284 Tage** ist der kürzeste Testzeitraum der fünf. Das
sind knapp 10 Monate — genug, um mehr als eine Marktphase zu sehen, aber
deutlich weniger belastbar als Rang 19 (3 Jahre) oder Rang 6 (35 Jahre). Der
AAR von 164 % ist entsprechend mit Vorsicht zu geniessen; er entsteht rechnerisch
aus dem kurzen Fenster, nicht aus einer besonders guten Strategie.

Der RSI mit Länge 3 ist ausserdem eine **bewusst aggressive Optimierung**, die er
im Video vornimmt, um mehr Signale zu bekommen. Kurze RSI-Perioden sind
notorisch parameterempfindlich — hier lohnt ein Parameter-Sweep über 2–6, um zu
sehen, ob 3 ein Plateau oder eine Spitze ist.

Roh-Erwartungswert: 0,38 × 3 − 0,62 = **0,52 R** (Rangliste: 0,543 R).

Gebühren, 1 h, Swing-Tief-Stop **0,8 %**, Round-Trip 0,10 %:

> (2 % ÷ 0,8 %) × 0,10 % = **0,25 % vom Konto** pro Trade = 0,125 R

Netto ca. 0,42 R → aus 108,6 % werden ca. **83 %**. Verträglich.

---

## 5. Rang 49 — Profitable ChatGPT-Daytrading-Strategie

**Video:** <https://youtu.be/ap5Xo19zWoQ>
**Rang 49 · 1 h · RR 1:1,5 · 486 Tage · 55 % WR · Profit100 75 % · MaxDD 10 % · PF 1,83 · AAR 51 %**

### Regeln (aus dem Transkript)

Indikatoren:
- **SMA 50** — reiner Trendindikator: Preis darüber = Aufwärtstrend, darunter =
  Abwärtstrend.
- **RSI** (Standardlänge 14), betrachtet wird nur das **50er-Level**: RSI über 50
  = mehr Käufer/stärkerer Aufwärtstrend, unter 50 umgekehrt.
- **Stochastik**, %K-Glättung von 1 auf **3** gestellt, %D-Linie ausgeblendet.
  Über 80 = überkauft, unter 20 = überverkauft.

Kaufsignal (drei Kriterien):
1. Preis **über dem SMA 50**.
2. **RSI über 50**.
3. Die **Stochastik kommt aus dem überverkauften Bereich und durchbricht das
   20er-Level wieder nach oben**.
4. Einstieg long.
5. **Stop Loss** unterhalb des letzten Swing-Tiefs.
6. **Take Profit: RR 1:1,5.**

Verkaufssignal spiegelbildlich: Preis unter dem SMA 50, RSI unter 50, Stochastik
fällt aus dem überkauften Bereich unter das 80er-Level, Stop über dem letzten
Swing-Hoch, Ziel 1:1,5.

Kein Break-Even-Nachzug, keine Verbesserungsrunde — das Video testet nur diese
eine Variante.

### Umsetzbarkeit

Reicht heute schon:
- `sma` 50, `rsi` 14 — beide vorhanden.
- Signal: `crossUp(stochK, 20)` — sobald die Stochastik da ist, ist das die
  gleiche Konstruktion wie bei Rang 21.
- `signalFilters: [{ op:'gt', left:'close', right:'sma50' }, { op:'gt', left:'rsi14', right:{value:50} }]`.
- `takeProfit: { mode:'rr', rr: 1.5 }`.

Fehlt:
- **Stochastik** (%K = 100 · (close − tiefstes Tief_n) / (höchstes Hoch_n −
  tiefstes Tief_n), geglättet mit SMA 3). Rein rechnerisch, klein.
- **Stop-Anker „letztes Swing-Tief"** (gemeinsame Liste).
- **Einstieg zum Open der Folgekerze** (gemeinsame Liste).

**Aufwand: klein.**

### Belastbarkeit und Gebühren

486 Tage, 55 % WR, MaxDD nur 10 % — die ruhigste Equity-Kurve der fünf. 1,3 Jahre
Testfenster ist mittelmässig, aber deutlich mehr als die 26 Einträge der Liste
unter 60 Tagen.

Der eigentliche Schwachpunkt ist das **RR von 1:1,5**. Roh-Erwartungswert:
0,55 × 1,5 − 0,45 = **0,375 R** — der kleinste der fünf. Und genau das macht sie
gebührenempfindlich, weil die Kosten pro Trade unabhängig vom RR anfallen:

> (2 % ÷ 0,8 %) × 0,10 % = **0,25 % vom Konto** pro Trade = 0,125 R

Netto 0,25 R → aus 75 % werden ca. **50 %**. Das ist ein Abschlag von **einem
Drittel** — der höchste relative Verlust im Feld, obwohl der absolute Stopabstand
derselbe ist wie bei Rang 19 und 21. Bei Taker-Gebühren (0,12 % RT) sinkt es auf
ca. 45 %.

Sie bleibt profitabel und ist billig zu bauen, gehört aber deshalb auf Platz 5:
sie ist die einzige der fünf, bei der die Gebühren die Rangfolge gegenüber der
Rohliste spürbar verschieben.

---

## Vergleichstabelle

| # | Rang | Strategie | TF | Testzeitraum | WR | RR | PF | MaxDD | Profit100 roh | Profit100 nach Gebühren¹ | Fehlende Bausteine | Aufwand |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 19 | Optimierte MACD | 1 h | 1095 T | 52 % | 1:2 | 2,17 | 8 % | 112 % | ~87 % | MACD; Swing-Anker; Open-Einstieg | klein |
| 2 | 6 | „Holy Grail" 2.0 | D | 12 784 T | 43 % | 1:3 | 2,26 | 10 % | 144 % | ~136 % | ADX; Bollinger; Kerzenmuster | mittel |
| 3 | 5 | ChatGPT 2.0 | 1 h | 733 T | 43 % | 1:3 | 2,26 | 24 % | 144 % | ~104 % | MFI; Engulfing-Signal | mittel |
| 4 | 21 | Bollinger + RSI 2.0 | 1 h | 284 T | 38 % | 1:3 | 1,88 | 14 % | 108,6 % | ~83 % | Bollinger (EMA-Basis); Swing-Anker; Open-Einstieg | klein |
| 5 | 49 | ChatGPT Daytrading | 1 h | 486 T | 55 % | 1:1,5 | 1,83 | 10 % | 75 % | ~50 % | Stochastik; Swing-Anker; Open-Einstieg | klein |

¹ Annahme: 2 % Risiko pro Trade, Round-Trip 0,10 %, Stopabstand 0,8 % (1 h) bzw.
0,5 % (Rang 5, enger Stop) bzw. 2,5 % (Tageskerzen). Formel:
`Kosten% = (Risiko% ÷ Stopabstand%) × Round-Trip%`. Alle Werte fallen um weitere
~5–15 %, wenn statt 0,10 % mit Bitunix-Taker (0,12 %) gerechnet wird.

---

## Was verworfen wurde — und warum

**Premium-Indikatoren ohne offene Berechnung** (nicht nachbaubar, unabhängig von
den Kennzahlen): Rang 1 + 3 (Flux Charts Price Action Toolkit / SFX Algo),
Rang 2 (ChartPrime), Rang 4 (Triple Momentum), Rang 7 (Fibo Cross), Rang 11
(Swing Catcher), Rang 50 („Beast"), Rang 57 (Polyfactor Supertrend), Rang 73
(Bullpower Algo). Bei Rang 1 und 2 stehen die besten Zahlen der ganzen Liste —
sie nützen nur nichts, wenn die Signallogik nicht öffentlich ist.

**Multi-Timeframe** (die Engine bekommt genau eine Kerzenreihe):
- **Rang 8** (Kaspareit Trendfolge, 2 h, 3949 Tage, PF 2,47): zweimal „Trend
  Magic" (CCI + ATR) auf 4 h und höher, plus MACD-Punkt unterhalb der Nulllinie.
  Drei fehlende Indikatoren plus MTF. Kennzahlen wären erstklassig gewesen.
- **Rang 33** (EMA + BB + MACD, 1 h, 803 Tage, PF 1,85): die verbesserte Version
  wirft den 4-h-EMA zwar raus, verlangt aber ein **Volumendelta** als Filter.
  Echtes Volumendelta braucht Tick- oder Sub-Timeframe-Daten, die wir nicht
  haben; eine Näherung („bullische Kerze mit ≥50 % Körper" — das kann
  `isBullish` mit `value: 50` sogar) wäre nicht dieselbe Strategie.

**Rang 12 — Ichimoku Cloud Retest** (1 h, 760 Tage, PF 2,44, MaxDD 10 %,
55 % WR). Die besten Kennzahlen unter allen offen beschriebenen Strategien; ich
habe sie ernsthaft geprüft und trotzdem verworfen:
1. Ichimoku selbst wäre machbar (Tenkan/Kijun/Senkou A+B/Chikou sind exakt
   definiert, inklusive Vorwärts- und Rückwärtsversatz).
2. Aber der **Stop Loss ist ausdrücklich diskretionär**: „beim Platzieren des
   Stop Loss müsst ihr flexibel sein, dieser richtet sich entweder an der roten
   Baseline oder der Wolke aus … es hilft, sich an der vorherigen Preisstruktur
   zu orientieren". Ohne festen Anker ist kein reproduzierbarer Backtest möglich.
3. Der entscheidende Zusatzfilter der verbesserten Version ist ein
   **„Ichimoku-Score"-Indikator mit angepassten Perioden, der Werte eines höheren
   Timeframes einbindet** — er nennt weder Name noch Parameter genau genug, um
   ihn nachzubauen. Ohne diesen Filter ist es nicht die Strategie, deren Zahlen
   in der Rangliste stehen.

**Rang 13 — Swing Trading, Tageskerzen** (8030 Tage, PF 2,34, MaxDD 10 %):
EMA 200 + **VuManChu Cipher B** (WaveTrend + MFI + Stochastik in einem, sehr
umfangreich) + **ATR-basierter Stop (1,5 × ATR)** + **wanderndes Ziel** (erst
1,5 R, dann auf 2 R nachziehen). Drei Lücken auf einmal, davon zwei
architektonisch (ATR-Stop, wanderndes Ziel). Guter Kandidat, sobald diese Lücken
aus anderen Gründen geschlossen sind.

**Rang 9 (Trendlinien) und Rang 47 (Trendlinien-Breakout)**: beruhen auf
gezeichneten Trendlinien. Die Engine hat kein Konzept dafür, und die Konstruktion
ist im Video visuell, nicht numerisch definiert.

**Rang 17 (ORB) und Rang 16 (ICT Silver Bullet)**: definieren sich über
**Tageszeiten** (Opening Range, 10:00–11:00 New York). Ohne Tageszeit-Filter
nicht abbildbar — und für 24/7-Krypto ohnehin fragwürdig.

**Rang 10, 24, 34, 41, 61, 64, 70, 75, 76** (1-Minuten-Charts): teils sehr kurze
Testzeiträume (3–51 Tage), vor allem aber Gebührentod. Beispiel Rang 10
(130 % Profit, 29 Tage): bei einem für 1 m realistischen Stop von 0,15 % kostet
jeder Trade `(2 ÷ 0,15) × 0,10 % = 1,33 %` vom Konto = 0,67 R — bei einem
Roh-Erwartungswert von 0,65 R (55 % WR, 1:2) ist die gesamte Kante weg. Keine
einzige 1-m-Strategie der Liste überlebt diese Rechnung.

**Rang 60 — 3-EMA-Pullback** (15 min, 503 Tage, PF 1,56, MaxDD 12 %): knapp
verpasst, aber erwähnenswert, weil die **Grundversion ohne jede Erweiterung
läuft** — EMAs 50/100/150 gestapelt, Rücksetzer unter die EMA 50 (darf die
EMA 150 nicht berühren), Schlusskurs wieder über der EMA 50, Stop am
Korrekturtief, Ziel als festes RR. Das ist Signal `crossDown(close, ema50)` +
`invalidation: low ≤ ema150` + `entry: immediate` mit `entryFilter: close > ema50`
+ `stopLoss.anchor: 'correctionLow'` — alles vorhanden. Sie eignet sich damit
hervorragend als **kostenloser Testfall**, um den Interpreter gegen echte Daten
zu validieren. Als Handelsstrategie ist sie zu schwach: die Kennzahlen der
Rangliste gehören zur verbesserten Version (die zusätzlich Stochastik-RSI und
Engulfing braucht), und der Autor rechnet selbst vor, dass von 55 % Profit nach
Gebühren nur 45 % bleiben — auf 15 min, bei seinen CFD-Konditionen. Auf
Krypto-Futures mit 0,10 % Round-Trip und ~0,4 % Stopabstand kostet jeder Trade
0,5 % vom Konto = 0,25 R; bei einem Roh-Erwartungswert von 0,275 R bleibt
praktisch nichts übrig.
