/**
 * Starter-Deck des Lern-Karteikastens — Fachbegriffe, die im Journal selbst
 * laufend vorkommen (Marktradar-Kacheln, Coin-Radar-Kennzahlen, Kennzahlen
 * der eigenen Trades). Antworten bewusst kurz und praxisnah gehalten, im
 * selben Ton wie die InfoTipp-Texte der App — kein Lehrbuch.
 *
 * `schluessel` ist der stabile Anker fürs Reseeding: eine spätere App-Version
 * kann neue Karten anhängen, ohne bestehenden Lernfortschritt oder eigene
 * Karten anzufassen (siehe seedDefaultLernkarten unten).
 *
 * `niveau` unterscheidet drei Tiefen: 1 sind Grundbegriffe, ohne die sich
 * nichts anderes lesen lässt (ein Teil davon steht auch in den InfoTipp-Texten
 * der App, längst nicht alle — MACD, Fibonacci oder Orderarten erklärt keine
 * Kachel). 2 sind vertiefte Konzepte, die im Journal selbst nicht vorkommen
 * (On-Chain-Kennzahlen, Derivate-Feinheiten, Risiko-Kennzahlen,
 * Netzwerk-Mechanik). 3 ist Spezialwissen, das zum Handeln nicht nötig ist,
 * aber fremde Analysen lesbar macht (Orderfluss, Optionen,
 * Börsen-Innenmechanik, Backtest-Fallen, On-Chain-Zyklusmodelle). Die Stufen
 * sind in `Lernen.vue` filterbar; eine neue Stufe braucht dort nur einen
 * Eintrag in `NIVEAUS`.
 *
 * `erklaerung` ist der Ausklappbereich unter der Antwort — das WARUM hinter
 * der Aussage: woher eine Schwelle kommt, wie eine Kennzahl gerechnet wird,
 * wo sie versagt. Die Antwort muss ohne sie stehen können; die Erklärung
 * ergänzt, sie wiederholt nicht (der Selbsttest prüft beides).
 */

export const LERNKARTEN_DEFS = [
    // ── Indikatoren ─────────────────────────────────────────
    {
        schluessel: 'atr', kategorie: 'indikatoren',
        frage: 'Wofür steht ATR und was zeigt er?',
        antwort: 'Average True Range — die durchschnittliche Kerzenspanne. Zeigt, ob sich ein Einstieg mit Stopp überhaupt lohnt: unter rund 0,2 % je Kerze fressen die Kosten die Spanne auf.',
        erklaerung: 'Die Schwelle ist keine Konvention, sondern eine Kostenrechnung. Ein Rundlauf aus Gebühren und Spread kostet auf einer Futures-Börse leicht 10 bis 15 Basispunkte, also 0,10–0,15 %. Bewegt sich eine Kerze im Schnitt nur 0,2 %, bleibt nach Ein- und Ausstieg fast nichts übrig — der Vorteil müsste die Kosten erst wieder einspielen. Deshalb ist ATR in Prozent die erste Frage vor jedem Setup: Passt das Ziel überhaupt in die übliche Bewegung des Coins hinein?',
    },
    {
        schluessel: 'rvol', kategorie: 'indikatoren',
        frage: 'Was misst das relative Volumen (RVOL)?',
        antwort: 'Ob gerade ungewöhnlich viel los ist, verglichen mit dem eigenen Normalzustand des Coins. Ab etwa 2,0 gilt ein Coin als „im Spiel".',
        erklaerung: 'RVOL vergleicht das aktuelle Volumen mit dem Durchschnitt derselben Zeitspanne desselben Coins — nicht mit anderen Coins. Genau darin liegt der Nutzen: ein kleiner Coin mit 2,0 ist auffällig, obwohl sein Umsatz absolut winzig bleibt. Die 2,0 ist eine Faustregel, keine Konstante; entscheidend ist, dass die Basislinie den laufenden Balken ausschliesst, sonst dämpft ein Ausreisser seinen eigenen Massstab.',
    },
    {
        schluessel: 'adx', kategorie: 'indikatoren',
        frage: 'Wofür steht ADX und wie liest man ihn?',
        antwort: 'Average Directional Index — zeigt, ob eine Bewegung durchläuft oder nur seitwärts sägt. Über 25 lohnt Trendfolge eher, unter 20 eher nicht.',
        erklaerung: 'Der ADX misst nur die STÄRKE einer Bewegung, nicht ihre Richtung — er steigt im Aufwärts- wie im Abwärtstrend. Die Werte 20 und 25 stammen von Welles Wilder selbst und sind gesetzt, nicht hergeleitet. Zwischen 20 und 25 liegt bewusst eine Grauzone: dort ist weder Trendfolge noch Rangehandel klar im Vorteil. Ein fallender ADX über 25 heisst nicht Trendwende, sondern nachlassendes Tempo.',
    },
    {
        schluessel: 'rsi', kategorie: 'indikatoren',
        frage: 'Was zeigt der RSI?',
        antwort: 'Wie überkauft oder überverkauft ein Markt gerade ist. Aussagekräftig erst im Vergleich zum Marktdurchschnitt — ein überverkaufter Coin bei ebenfalls tiefem Gesamtmarkt ist nichts Eigenes.',
        erklaerung: 'Der RSI setzt die durchschnittlichen Aufwärts- gegen die Abwärtsbewegungen der letzten Perioden (üblich 14) ins Verhältnis. Der häufigste Fehler ist, „überkauft" als Verkaufssignal zu lesen: in einem starken Trend bleibt der RSI wochenlang über 70, und wer dagegen handelt, steht die ganze Bewegung auf der falschen Seite. Aussagekräftig wird er erst relativ — gegen den eigenen Verlauf des Coins oder gegen den Gesamtmarkt.',
    },
    {
        schluessel: 'vwapAnker', kategorie: 'indikatoren',
        frage: 'Was ist ein VWAP-Anker?',
        antwort: 'Ein volumengewichteter Durchschnittspreis, gerechnet ab einem bestimmten Startpunkt (Session-Start, Swing-Hoch/-Tief). Zeigt das durchschnittliche Einstiegsniveau seit diesem Punkt — oft ein Magnet, an dem der Kurs zurücktestet.',
        erklaerung: 'Volumengewichtet heisst: ein Preis, an dem viel gehandelt wurde, zählt mehr als einer, an dem fast nichts lief. Der VWAP zeigt damit näherungsweise, was die Masse der seit dem Anker eingestiegenen Positionen im Schnitt bezahlt hat. Darum wirkt er wie ein Magnet — oberhalb sitzt diese Masse im Gewinn, unterhalb im Verlust. Der Anker entscheidet alles: ab Sitzungsbeginn beantwortet er eine andere Frage als ab dem letzten Swing-Hoch.',
    },
    {
        schluessel: 'rrr', kategorie: 'indikatoren',
        frage: 'Was bedeutet RRR (Risk-Reward-Ratio)?',
        antwort: 'Das Verhältnis von möglichem Gewinn zu eingegangenem Risiko je Trade. Ein RRR von 2 heisst: doppelt so viel Gewinnpotenzial wie Risiko bei gleichem Positionsrisiko.',
        erklaerung: 'Das RRR allein sagt nichts über Rentabilität — es wird erst zusammen mit der Trefferquote zu einer Aussage. Ein RRR von 3 bei 20 % Treffern verliert, ein RRR von 1 bei 60 % gewinnt. Wichtig ist ausserdem, dass man das RRR VOR dem Einstieg festlegt, aus Stopp und Ziel: nachträglich am Chart gemessen lässt sich jede Zahl schönrechnen, indem man das Ziel dorthin legt, wo der Kurs zufällig war.',
    },
    {
        schluessel: 'mfeMae', kategorie: 'indikatoren',
        frage: 'Was sind MFE und MAE?',
        antwort: 'Maximum Favorable / Adverse Excursion — wie weit ein Trade während seiner Laufzeit maximal in die richtige bzw. falsche Richtung lief. Zeigt, ob Stopps und Ziele zur tatsächlichen Kursbewegung passen.',
        erklaerung: 'Der praktische Nutzen liegt im Vergleich der beiden über viele Trades. Liegt die MFE regelmässig weit über dem tatsächlichen Gewinn, wird zu früh geschlossen. Bleibt die MAE bei Gewinnern immer klein und nur bei Verlierern gross, war der Stopp zu weit — er hätte enger gekonnt, ohne gute Trades zu töten. Eine einzelne MFE ist dagegen nur eine Anekdote.',
    },
    {
        schluessel: 'breakEven', kategorie: 'indikatoren',
        frage: 'Was heisst Break-even-Stop?',
        antwort: 'Der Stop-Loss wird nach einer gewissen Bewegung zum Einstiegspreis nachgezogen, damit der Trade im schlimmsten Fall bei ±0 endet statt im Verlust.',
        erklaerung: 'Die Falle steckt im Wort „bei ±0": ein Stopp exakt auf dem Einstiegspreis endet in Wirklichkeit im Minus, weil Gebühren für Ein- UND Ausstieg anfallen und der Spread dazukommt. Wer wirklich kostenneutral aussteigen will, muss den Stopp um den Rundlauf über den Einstieg legen. Zweite Falle: zu früh nachgezogen, wird man von jedem normalen Rücksetzer ausgestoppt — die Absicherung kostet dann mehr Trades, als sie rettet.',
    },

    // ── Derivate ────────────────────────────────────────────
    {
        schluessel: 'fundingRate', kategorie: 'derivate',
        frage: 'Was ist die Funding-Rate bei Perpetual Futures?',
        antwort: 'Was das Halten einer Long- oder Short-Position kostet oder einbringt. Positiv heisst: Longs zahlen an Shorts — ein Hinweis auf eine überfüllte Long-Seite.',
        erklaerung: 'Die Rate besteht aus zwei Teilen: einem festen Zinsanteil und einem Aufschlag, der misst, wie weit der Perpetual-Preis über oder unter dem Spot-Index liegt. Gezahlt wird nicht an die Börse, sondern direkt zwischen den Marktteilnehmern. Deshalb ist eine hoch positive Rate zugleich eine Aussage über Positionierung: die Long-Seite zahlt dafür, dass sie überfüllt ist. Und die Rate ist ohne ihren Takt nicht lesbar — 0,01 % alle 4 Stunden sind doppelt so teuer wie alle 8.',
    },
    {
        schluessel: 'openInterest', kategorie: 'derivate',
        frage: 'Was zeigt Open Interest (OI)?',
        antwort: 'Die Summe aller offenen Futures-Positionen. Steigendes OI bei steigendem Preis heisst: neues Geld kommt long rein; steigendes OI bei fallendem Preis: neues Geld geht short.',
        erklaerung: 'Es gibt vier Kombinationen, und erst sie machen OI nützlich. Preis hoch + OI hoch: neues Geld geht long, gesunder Trend. Preis hoch + OI runter: Shorts decken sich ein, die Bewegung wird von Schliessungen getragen und läuft oft aus. Preis runter + OI hoch: neues Geld geht short. Preis runter + OI runter: Longs geben auf, die Abwärtsbewegung erschöpft sich. OI ist immer eine Nettozahl — jeder Kontrakt hat eine Long- und eine Short-Seite.',
    },
    {
        schluessel: 'longShortRatio', kategorie: 'derivate',
        frage: 'Was sagt die Long/Short-Ratio?',
        antwort: 'Wie viele Konten long gegenüber short positioniert sind. Gezählt werden Konten, nicht Kapital — bildet eher Kleinanleger ab. Eine schiefe Quote plus wachsendes OI heisst: eine Seite lädt sich auf.',
        erklaerung: 'Die Zahl zählt KONTEN, und ein Konto mit 100 USD wiegt darin genauso viel wie eines mit einer Million. Sie bildet damit vor allem Kleinanleger ab, weshalb sie oft als Kontraindikator gelesen wird. Das ist keine Regel: eine schiefe Quote kann tagelang schiefer werden. Aussagekraft entsteht erst in Kombination — schiefe Quote plus steigendes OI plus teures Funding heisst, dass sich eine Seite hörbar auflädt.',
    },
    {
        schluessel: 'liquidation', kategorie: 'derivate',
        frage: 'Was passiert bei einer Liquidation?',
        antwort: 'Eine gehebelte Position wird zwangsweise glattgestellt, weil die Margin das Verlustrisiko nicht mehr deckt. Ein Überhang an Liquidationen auf einer Seite zeigt, wo Druck aus dem Markt genommen wurde.',
        erklaerung: 'Ablauf: unterschreitet die Sicherheit die Wartungsmarge, übernimmt die Liquidations-Engine die Position und stellt sie über eine Marktorder glatt. Diese Zwangsorder ist echtes Angebot bzw. echte Nachfrage — deshalb bewegen Liquidationen den Kurs weiter in dieselbe Richtung und lösen mitunter die nächsten aus. Wichtig für die eigene Position: gerechnet wird gegen den Mark-Preis, nicht gegen den letzten gehandelten Kurs.',
    },
    {
        schluessel: 'rundlauf', kategorie: 'derivate',
        frage: 'Was misst der „Rundlauf" eines Coins?',
        antwort: 'Was Ein- und Ausstieg zusammen kosten, in Basispunkten (Spread + Slippage). Bei einem Scalp mit kleinem Ziel kann ein hoher Rundlauf den Trade schon vor dem Start unrentabel machen.',
        erklaerung: 'Vorgerechnet: 5 Basispunkte Gebühr je Seite plus 4 bp Spread ergeben rund 14 bp, also 0,14 % vom Positionswert. Bei einem Scalp mit 0,3 % Ziel ist knapp die Hälfte des Gewinns weg, bevor der Trade läuft — und das bei JEDEM Trade, auch bei jedem Verlierer. Genau deshalb steht der Rundlauf im Coin-Radar neben der Gelegenheits-Note: eine gute Chance auf einem teuren Coin ist keine gute Chance.',
    },
    {
        schluessel: 'margin', kategorie: 'derivate',
        frage: 'Was unterscheidet isolierte von Cross-Margin?',
        antwort: 'Isoliert: nur die für die Position hinterlegte Margin steht auf dem Spiel. Cross: das gesamte Kontoguthaben haftet für alle offenen Positionen zusammen.',
        erklaerung: 'Der Unterschied entscheidet, was ein einzelner Fehler kostet. Isoliert liquidiert genau die eine Position, der Rest des Kontos bleibt unangetastet — dafür ist sie schneller weg, weil kein weiteres Guthaben sie stützt. Cross nutzt das gesamte Guthaben als Puffer und hält länger durch, kann im Ernstfall aber das ganze Konto mitnehmen, inklusive der Positionen, die richtig lagen.',
    },
    {
        schluessel: 'liquidationspreis', kategorie: 'derivate',
        frage: 'Wovon hängt der Liquidationspreis einer Position ab?',
        antwort: 'Vom Hebel, der Positionsgrösse und der Wartungsmarge-Anforderung der Börse. Höherer Hebel bedeutet: der Liquidationspreis liegt näher am Einstieg.',
        erklaerung: 'Die Näherung: Der Abstand zum Einstieg beträgt grob 1/Hebel minus Wartungsmargensatz. Bei 10× Hebel sind das rund 10 % Kursbewegung, bei 50× nur noch etwa 2 %. Zwei Feinheiten, die oft überraschen: der Wartungsmargensatz hängt vom Symbol UND von der Positionsgrösse ab (grössere Positionen fordern mehr), und zusätzlich eingezahlte Margin verschiebt den Preis, ohne dass sich der angezeigte Hebel ändert.',
    },
    {
        schluessel: 'basis', kategorie: 'derivate',
        frage: 'Was ist die „Basis" bei Futures?',
        antwort: 'Die Preisdifferenz zwischen Futures und Spot-Markt. Ein Future über Spot (Contango) ist der Normalfall; eine negative Basis (Backwardation) signalisiert Stress oder starke Short-Nachfrage.',
        erklaerung: 'Vergleichbar wird die Basis erst annualisiert. Ein Quartals-Future 2 % über Spot bei drei Monaten Restlaufzeit entspricht rund 8 % im Jahr — das ist die Rendite, die ein Cash-and-Carry-Trade abwirft, und zugleich ein Mass für die Bereitschaft, für Hebel zu zahlen. Contango ist der Normalzustand. Backwardation ist selten und bedeutet fast immer Stress: jemand zahlt einen Aufpreis dafür, JETZT abgesichert zu sein.',
    },

    // ── Sentiment / Marktlage ───────────────────────────────
    {
        schluessel: 'fearGreed', kategorie: 'sentiment',
        frage: 'Was misst der Fear & Greed Index?',
        antwort: 'Wie ängstlich oder gierig der Markt insgesamt ist, auf einer Skala von 0 bis 100. Nur ein Teil davon ist echte Stimmung (soziale Medien, Suchanfragen) — rund die Hälfte kommt aus Volatilität und Volumen, ist also aus dem Kurs abgeleitet. Extreme können wochenlang stehen bleiben.',
        erklaerung: 'Die Zusammensetzung erklärt, warum der Index oft nur bestätigt, was der Chart schon zeigt: Volatilität und Marktmomentum machen zusammen die Hälfte aus und sind aus dem Kurs abgeleitet. Nur ein kleinerer Teil misst echte Stimmung. Als Kontraindikator taugt er deshalb allenfalls an den Extremen — und auch dort gilt: ein Markt kann wochenlang in „extremer Gier" bleiben und dabei weiter steigen.',
    },
    {
        schluessel: 'dominance', kategorie: 'sentiment',
        frage: 'Was zeigt die BTC-Dominanz?',
        antwort: 'Welcher Anteil des Kryptomarkts auf Bitcoin entfällt. Steigende Dominanz bei fallenden Kursen heisst: Geld flüchtet aus Altcoins in BTC, es kommt kein neues Geld herein.',
        erklaerung: 'Wichtig ist, dass die Dominanz ein VERHÄLTNIS ist: sie steigt, wenn BTC stärker ist als der Rest — auch wenn beide fallen. Deshalb reicht die Zahl allein nie, man braucht die Richtung des Gesamtmarkts dazu. Vier Fälle: Dominanz und Markt steigen — BTC führt eine Rally an. Dominanz steigt, Markt fällt — Flucht in BTC. Dominanz fällt, Markt steigt — Altcoin-Rally. Beide fallen — BTC fällt schneller, selten und meist kurz.',
    },
    {
        schluessel: 'altseason', kategorie: 'sentiment',
        frage: 'Ab welchem Wert spricht man von Altcoin-Saison?',
        antwort: 'Über 75 gilt als Altcoin-Saison (Alt-Longs haben Rückenwind), unter 25 als Bitcoin-Saison (Alts laufen oft schwächer als BTC). Die Schwellen sind gesetzt, nicht mathematisch hergeleitet.',
        erklaerung: 'Gemessen wird üblicherweise, wie viele der 50 grössten Coins Bitcoin über 90 Tage geschlagen haben. Die Schwellen 75 und 25 sind gesetzt, nicht hergeleitet. Zwei Einschränkungen: die Kennzahl blickt 90 Tage zurück und ist damit träge — wenn sie Altcoin-Saison meldet, läuft die Bewegung meist schon. Und sie sagt nichts über die Richtung: eine Altcoin-Saison kann auch bedeuten, dass Alts weniger stark fallen als BTC.',
    },
    {
        schluessel: 'makroKopplung', kategorie: 'sentiment',
        frage: 'Was zeigt die Kopplung BTC↔Nasdaq?',
        antwort: 'Wie stark sich Bitcoin gerade wie ein Tech-Aktien-Future verhält. Ein steigender Dollar-Index gilt dabei als Gegenwind für Krypto, unabhängig davon, ob der Dollar selbst „gut" oder „schlecht" performt.',
        erklaerung: 'Die Kopplung ist kein Naturgesetz, sondern ein Regime: sie ist hoch, wenn Zinserwartung und Risikoappetit alles dominieren, und bricht bei krypto-eigenen Nachrichten. Praktisch heisst das: in Phasen hoher Korrelation ist eine BTC-Position teilweise eine Wette auf US-Tech, und die Termine, die zählen, sind FOMC und CPI. Der Dollar-Index wirkt gegenläufig, weil ein starker Dollar globale Liquidität verknappt.',
    },
    {
        schluessel: 'stablecoinFluss', kategorie: 'sentiment',
        frage: 'Was sagt ein Zufluss von Stablecoins auf Börsen?',
        antwort: 'Kapital, das bereit steht, in den Markt zu gehen — meist als leicht bullisches Vorzeichen gelesen, ohne selbst schon eine Kursbewegung zu sein.',
        erklaerung: 'Das Signal ist schwächer, als es oft dargestellt wird. Zuflüsse können ebenso gut aus Umschichtung zwischen Börsen oder von Market Makern stammen, die ihr Inventar auffüllen. Aussagekräftiger als der Tagesfluss ist das Verhältnis zur Marktgrösse und die Richtung über mehrere Wochen. Und es bleibt bei Bereitschaft: Kapital, das bereitsteht, kann auch wochenlang bereitstehen.',
    },
    {
        schluessel: 'etfFluss', kategorie: 'sentiment',
        frage: 'Was zeigt der ETF-Fluss bei Bitcoin?',
        antwort: 'Wie viel BTC institutionell über Spot-ETFs gehalten wird und ob täglich mehr hinein- oder herausfliesst. Ein anhaltender Abfluss über mehrere Tage wiegt schwerer als ein einzelner roter Tag.',
        erklaerung: 'Zwei Feinheiten sind wichtig. Erstens ist ein Teil der Zuflüsse gar keine Richtungswette, sondern die Long-Seite eines Basis-Trades gegen Short-Futures — das Geld ist damit weniger überzeugt, als es aussieht. Zweitens meldet sich der Fluss erst nach Handelsschluss und deckt nur US-Handelstage ab, während Krypto durchläuft. Deshalb wiegt ein mehrtägiger Trend mehr als jeder einzelne Tag.',
    },

    // ── Chartanalyse ────────────────────────────────────────
    {
        schluessel: 'piCycleTop', kategorie: 'chartAnalyse',
        frage: 'Was ist das Pi-Cycle-Top-Signal?',
        antwort: 'Kreuzt der 111-Tage-Durchschnitt über den doppelten 350-Tage-Durchschnitt, lag in der Vergangenheit ein Zyklushoch nahe — 2013, 2017 und 2021 jeweils auf wenige Tage genau. Beim Hoch von Oktober 2025 kreuzte er gar nicht: drei Treffer und ein Aussetzer sind eine Beobachtung, keine Regel.',
        erklaerung: 'Warum ausgerechnet 111 und 350: die 350 Tage sind grob ein Jahr, verdoppelt ergibt das eine Obergrenze, die historisch nur in Euphoriephasen erreicht wurde. Der Indikator hat genau vier Gelegenheiten gehabt und drei getroffen — das ist zu wenig, um von einer Trefferquote zu sprechen. Der Aussetzer von Oktober 2025 zeigt zudem das grundsätzliche Problem: ein Indikator, der auf drei Zyklen kalibriert wurde, hat nichts, woran er sich prüfen liesse.',
    },
    {
        schluessel: 'rainbowChart', kategorie: 'chartAnalyse',
        frage: 'Was zeigt der Bitcoin-Rainbow-Chart?',
        antwort: 'Wo der Kurs langfristig innerhalb einer logarithmischen Regression über seine eigene Geschichte steht, von „Ausverkauf" bis „Blase". Die Bänder sind kein Naturgesetz: sie wurden nachträglich neu angepasst, als der Kurs 2022 unten herausfiel. Für eine einzelne Handelsentscheidung zu grob.',
        erklaerung: 'Die Bänder sind eine logarithmische Regression durch den bisherigen Kursverlauf, mit festen Abständen darüber und darunter. Der Haken liegt in der Konstruktion: die Kurve wird mit jedem neuen Datenpunkt neu gefittet, und als der Kurs 2022 unten herausfiel, wurden die Bänder nachjustiert. Ein Modell, das sich an die Daten anpasst, kann von den Daten nicht widerlegt werden — es ordnet ein, es prognostiziert nicht.',
    },
    {
        schluessel: 'marktregime', kategorie: 'chartAnalyse',
        frage: 'Was fasst eine Marktmechanik-/Regime-Kachel zusammen?',
        antwort: 'Preis, Open Interest, Funding und liquidiertes Volumen zu einem einzigen Marktzustand, z.B. „Long-Squeeze-Gefahr". Regelbasiert, keine Prognose.',
        erklaerung: 'Der Nutzen liegt darin, vier Grössen gleichzeitig zu lesen, die einzeln mehrdeutig sind. Steigender Preis allein sagt wenig; steigender Preis mit steigendem OI und teurem Funding sagt, dass die Bewegung gehebelt getragen wird und damit anfällig für eine Kaskade ist. Weil die Zustände regelbasiert vergeben werden, sind sie nachvollziehbar und wiederholbar — aber sie beschreiben die Gegenwart, sie sagen nichts voraus.',
    },
    {
        schluessel: 'stopHunt', kategorie: 'chartAnalyse',
        frage: 'Was ist ein Stop-Hunt?',
        antwort: 'Ein kurzer Ausbruch über ein offensichtliches Hoch/Tief, der gehäufte Stop-Loss-Orders auslöst, bevor der Kurs in die ursprüngliche Richtung zurückdreht.',
        erklaerung: 'Es braucht keine Absicht dahinter — die Mechanik reicht. Über einem sichtbaren Hoch liegen die Stopps der Shorts, und ein Stopp ist eine Kauforder: wer dort hinein verkaufen will, findet genau dort Gegenpartei. Der Ausbruch löst die Orders aus, die Nachfrage ist danach verbraucht, und der Kurs fällt zurück. Erkennbar im Nachhinein an einem langen Docht mit hohem Volumen und einem Schlusskurs zurück im alten Bereich.',
    },

    // ── Risiko & Handwerk ───────────────────────────────────
    {
        schluessel: 'beta', kategorie: 'risiko',
        frage: 'Was sagt ein hoher Beta-Wert zu Bitcoin aus?',
        antwort: 'Bewegt sich Bitcoin um 1 %, bewegt sich der Coin im Schnitt um β %. Über 1 verstärkt er eine BTC-Bewegung (Position kann kleiner ausfallen), unter 1 dämpft er sie.',
        erklaerung: 'Beta wird aus der Regression der Coin-Renditen auf die BTC-Renditen geschätzt — es ist ein Durchschnitt der Vergangenheit, keine Eigenschaft des Coins. In ruhigen Phasen unterschätzt es das Risiko, weil Beta in Stressphasen für fast alle Altcoins gegen 1 und darüber steigt: genau dann, wenn Streuung helfen sollte, verschwindet sie. Praktischer Nutzen: bei Beta 1,5 entspricht eine Position von 100 dem BTC-Risiko von 150.',
    },
    {
        schluessel: 'ausfuehrungsguete', kategorie: 'risiko',
        frage: 'Was zeigt die Ausführungsnote eines Coins?',
        antwort: 'Wie teuer eine Order über eine bestimmte Grösse wirklich ist, gemessen am echten Orderbuch. Eine hohe Gelegenheits-Note nützt wenig, wenn die Ausführung sie auffrisst.',
        erklaerung: 'Gemessen wird gegen die Mitte zwischen Bid und Ask, nicht gegen die beste Quote — sonst bliebe der halbe Spread unsichtbar. Kauf und Verkauf werden getrennt bewertet, weil ein Buch, in das man billig hineinkommt und teuer wieder heraus, eine Falle ist, die kein Durchschnitt zeigt. Und passt die gewünschte Grösse nicht ins Buch, wird nichts hochgerechnet: die Note ist dann 0, kein Abzug.',
    },
    {
        schluessel: 'slippage', kategorie: 'risiko',
        frage: 'Was ist Slippage?',
        antwort: 'Die Differenz zwischen dem erwarteten und dem tatsächlich ausgeführten Preis einer Order — meist, weil das Orderbuch bei der georderten Grösse nicht tief genug ist.',
        erklaerung: 'Slippage entsteht, weil eine Marktorder das Buch von der besten Quote aus abarbeitet — je grösser die Order, desto tiefer frisst sie sich hinein. Sie ist damit keine Eigenschaft der Börse, sondern des Verhältnisses von Ordergrösse zu Buchtiefe. Zwei Verstärker: dünne Zeiten (Wochenende, frühe Morgenstunden) und Nachrichtenmomente, in denen Market Maker ihre Orders zurückziehen — genau dann, wenn viele gleichzeitig handeln wollen.',
    },
    {
        schluessel: 'positionSizing', kategorie: 'risiko',
        frage: 'Was regelt Position Sizing?',
        antwort: 'Wie gross eine Position gemessen am Konto sein darf, damit ein einzelner Verlust das Konto nicht ernsthaft beschädigt — unabhängig davon, wie überzeugt man vom Trade ist.',
        erklaerung: 'Die übliche Rechnung: Risiko je Trade in Prozent des Kontos, geteilt durch den Stopp-Abstand in Prozent, ergibt die Positionsgrösse. Bei 1 % Risiko und 2 % Stopp-Abstand entspricht das einer Position von 50 % des Kontos — mit Hebel machbar, ohne nicht. Der eigentliche Punkt ist, dass die Grösse aus dem Stopp folgt und nicht aus der Überzeugung: der Markt weiss nicht, wie sicher man sich war.',
    },
    {
        schluessel: 'hebel', kategorie: 'risiko',
        frage: 'Was macht ein höherer Hebel mit dem Risiko einer Position?',
        antwort: 'Er vergrössert Gewinn und Verlust gleichermassen bei gleicher Kapitalbindung — und rückt den Liquidationspreis näher an den Einstieg heran.',
        erklaerung: 'Der oft übersehene Teil: Hebel ändert nichts am Risiko, solange die Positionsgrösse gleich bleibt — er ändert nur, wie viel Kapital gebunden ist. Gefährlich wird er, weil er dazu verleitet, die Position zu vergrössern, und weil er den Liquidationspreis heranzieht. Bei 50× liegt er rund 2 % entfernt, also innerhalb der normalen Tagesschwankung vieler Coins: dann entscheidet nicht mehr die Analyse, sondern Rauschen.',
    },
    {
        schluessel: 'drawdown', kategorie: 'risiko',
        frage: 'Was ist ein Drawdown?',
        antwort: 'Der Rückgang des Kontostands vom letzten Hoch bis zum aktuellen Tiefpunkt, meist in Prozent. Zeigt, wie schmerzhaft eine schlechte Phase tatsächlich war.',
        erklaerung: 'Zwei Dinge macht der Drawdown sichtbar, die eine Renditezahl verschweigt. Erstens die nötige Gegenbewegung: −50 % brauchen +100 %, um wieder bei null zu sein — die Erholung ist immer schwerer als der Verlust. Zweitens die Dauer: ein Konto kann monatelang unter seinem Hoch liegen, und das ist der Zeitraum, in dem Strategien aus Ungeduld geändert werden. Deshalb misst man neben der Tiefe auch, wie lange sie anhielt.',
    },
    {
        schluessel: 'profitFactor', kategorie: 'risiko',
        frage: 'Was sagt der Profit Factor aus?',
        antwort: 'Das Verhältnis von Bruttogewinn zu Bruttoverlust über alle Trades. Über 1 heisst profitabel; ein Wert von 2 heisst: doppelt so viel gewonnen wie verloren.',
        erklaerung: 'Der Profit Factor ist empfindlich gegenüber einzelnen Ausreissern: ein einziger sehr grosser Gewinn kann ihn über 2 heben, ohne dass die Strategie gut ist. Deshalb prüft man ihn immer zusammen mit der Anzahl Trades und dem grössten Einzelgewinn — fällt der Wert nach Herausnahme des besten Trades deutlich, trägt die Strategie sich nicht selbst. Werte knapp über 1 sind zudem meist unter Berücksichtigung der Gebühren schon nicht mehr profitabel.',
    },
    {
        schluessel: 'winRate', kategorie: 'risiko',
        frage: 'Warum reicht eine hohe Win-Rate allein nicht als Erfolgsmass?',
        antwort: 'Weil sie nichts über die Grösse der Gewinne und Verluste aussagt. Eine Win-Rate von 80 % kann trotzdem verlustreich sein, wenn die wenigen Verlierer jeweils riesig sind.',
        erklaerung: 'Die Win-Rate lässt sich beliebig hochtreiben, indem man Gewinne früh mitnimmt und Verluste laufen lässt — genau das Verhalten, das Konten zerstört. Ein Beispiel: 80 % Treffer mit je 1 Gewinn gegen 20 % Verluste mit je 5 ergibt exakt null, vor Kosten. Aussagekräftig wird sie erst neben dem durchschnittlichen Gewinn-Verlust-Verhältnis, und beide zusammen ergeben den Erwartungswert.',
    },
    {
        schluessel: 'expectancy', kategorie: 'risiko',
        frage: 'Was ist der Erwartungswert (Expectancy) einer Strategie?',
        antwort: 'Der durchschnittliche Gewinn oder Verlust pro Trade, wenn man Win-Rate und durchschnittliche Gewinn-/Verlustgrösse zusammenrechnet. Positiv heisst: die Strategie trägt sich auf lange Sicht.',
        erklaerung: 'Formel: Trefferquote × Durchschnittsgewinn − Verlustquote × Durchschnittsverlust. Beispiel: 40 % × 3R − 60 % × 1R = 0,6R je Trade. Nur diese Zahl entscheidet, ob eine Strategie trägt — Trefferquote und RRR allein sagen nichts. Zwei Einschränkungen: der Erwartungswert gilt erst über viele Trades, und er muss NACH Gebühren gerechnet werden, sonst verschwindet ein knapp positiver Wert in den Kosten.',
    },
    {
        schluessel: 'scalpSwing', kategorie: 'risiko',
        frage: 'Was unterscheidet Scalp, Daytrade und Swing grob?',
        antwort: 'Die Haltedauer: ein Scalp dauert Minuten, ein Daytrade wird innerhalb eines Tages geschlossen, ein Swing-Trade läuft über mehrere Tage bis Wochen.',
        erklaerung: 'Die Haltedauer bestimmt, was die Ergebnisse dominiert. Beim Scalp sind Gebühren und Spread der grösste Einzelposten, beim Swing dagegen Funding und Übernachtrisiko durch Nachrichten. Auch die nötige Trefferquote unterscheidet sich: kurze Ziele werden häufiger erreicht, tragen aber weniger, weshalb Scalping eine hohe Quote braucht, um die Kosten zu decken.',
    },
    {
        schluessel: 'spotFutures', kategorie: 'risiko',
        frage: 'Was ist der Kernunterschied zwischen Spot- und Futures-Handel?',
        antwort: 'Beim Spot-Handel wird der Coin tatsächlich gekauft und besessen. Futures sind ein Vertrag auf den zukünftigen Preis, meist gehebelt und ohne den Coin selbst zu halten.',
        erklaerung: 'Drei praktische Unterschiede folgen daraus. Erstens kann eine Spot-Position nicht liquidiert werden — sie kann nur an Wert verlieren. Zweitens kostet ein Future laufend Funding, Spot nicht. Drittens lässt sich mit Futures auch fallen setzen, ohne den Coin zu besitzen. Für das Journal heisst das vor allem: eine Futures-Position hat immer einen Preis, an dem sie zwangsweise endet.',
    },
    {
        schluessel: 'makerTaker', kategorie: 'risiko',
        frage: 'Was unterscheidet Maker- von Taker-Gebühren?',
        antwort: 'Maker stellt dem Orderbuch Liquidität bereit (Limit-Order, die nicht sofort ausgeführt wird) und zahlt meist weniger. Taker nimmt bestehende Liquidität sofort weg (Market-Order) und zahlt mehr.',
        erklaerung: 'Der Unterschied ist kein Rabatt, sondern eine Bezahlung für eine Leistung: der Maker stellt Liquidität in das Buch, der Taker entnimmt sie. Typisch sind 2 bp Maker gegen 5 bp Taker; bei 200 Trades im Monat sind das rund 0,6 % des umgesetzten Volumens Unterschied. Der Haken: Maker sein bedeutet warten, und eine Limit-Order wird ausgerechnet dann nicht ausgeführt, wenn der Markt in die richtige Richtung wegläuft.',
    },

    // ── Markt allgemein ─────────────────────────────────────
    {
        schluessel: 'marktkapitalisierung', kategorie: 'markt',
        frage: 'Warum sagt der Preis eines Coins allein nichts über seine Grösse aus?',
        antwort: 'Marktkapitalisierung = Preis × zirkulierendes Angebot. Ein Coin bei 0,01 $ kann grösser sein als einer bei 1000 $, je nach Anzahl der Token im Umlauf.',
        erklaerung: 'Der praktische Nutzen ist die Frage „was müsste passieren": ein Coin bei 1 Mrd. Marktkapitalisierung müsste 10 Mrd. erreichen, um sich zu verzehnfachen — bei 100 Mrd. wäre dieselbe Bewegung eine Billion. Der Preis je Token sagt darüber nichts. Vorsicht bei der Zahl selbst: sie unterstellt, dass jeder Token zum aktuellen Preis verkäuflich wäre, was bei dünnen Büchern nicht zutrifft.',
    },
    {
        schluessel: 'circulatingSupply', kategorie: 'markt',
        frage: 'Was ist der Unterschied zwischen zirkulierendem und maximalem Angebot?',
        antwort: 'Zirkulierend: was aktuell tatsächlich am Markt handelbar ist. Maximal: die absolute Obergrenze, die je existieren wird — ein grosser Abstand dazwischen bedeutet künftigen Verwässerungsdruck.',
        erklaerung: 'Die Lücke zwischen zirkulierend und maximal ist künftiges Angebot mit bekanntem Zeitplan. Ein Coin mit 20 % im Umlauf hat noch das Vierfache vor sich, das nach und nach freigeschaltet wird — meist an Team und frühe Investoren, die zu deutlich niedrigeren Preisen eingestiegen sind. Deshalb gehört zur Marktkapitalisierung immer die FDV und der Freischalt-Kalender.',
    },
    {
        schluessel: 'perpetual', kategorie: 'markt',
        frage: 'Was macht einen Perpetual Future „perpetual"?',
        antwort: 'Er hat kein Verfallsdatum wie klassische Futures — dafür sorgt die Funding-Rate laufend dafür, dass sein Preis nah am Spot-Preis bleibt.',
        erklaerung: 'Ohne Verfallsdatum fehlt der Mechanismus, der einen normalen Future zum Spot zurückzwingt — die Konvergenz beim Verfall. Die Funding-Rate ersetzt ihn: läuft der Perpetual über den Spot, wird das Halten für Longs teuer, was Verkäufer anzieht und den Abstand schliesst. Der Preis wird also nicht durch eine Regel angebunden, sondern durch einen laufenden Kostenanreiz.',
    },

    // ══════════════════════════════════════════════════════════
    // Niveau 2 — vertiefte Konzepte, im Journal selbst nicht erklärt.
    // ══════════════════════════════════════════════════════════

    // ── On-Chain-Daten ──────────────────────────────────────
    {
        schluessel: 'mvrv', kategorie: 'onchain', niveau: 2,
        frage: 'Was zeigt der MVRV-Ratio (Market Value to Realized Value)?',
        antwort: 'Verhältnis von Marktkapitalisierung zu Realized Cap (Wert aller Coins zum Preis ihrer letzten On-Chain-Bewegung). Über 1 heisst: der durchschnittliche Halter sitzt im Gewinn — hohe Werte fielen historisch mit Marktzyklus-Hochs zusammen.',
        erklaerung: 'Realized Cap bewertet jeden Coin zu dem Preis, zu dem er zuletzt bewegt wurde — sie ist damit näherungsweise der Einstandspreis des Marktes. MVRV ist das Verhältnis beider und beantwortet: um welchen Faktor liegt der Markt über seinen eigenen Kosten? Werte über 3 fielen historisch mit Zyklushochs zusammen, unter 1 mit Böden. Die Einschränkung: das sind vier Zyklen, und die Extremwerte sind über die Jahre gesunken.',
    },
    {
        schluessel: 'sopr', kategorie: 'onchain', niveau: 2,
        frage: 'Was misst der SOPR (Spent Output Profit Ratio)?',
        antwort: 'Ob gerade bewegte Coins im Schnitt mit Gewinn oder Verlust verkauft werden. Über 1: Verkäufer realisieren Gewinn. Unter 1: Verkäufer geben mit Verlust ab — oft ein Zeichen von Kapitulation.',
        erklaerung: 'Gerechnet wird der Verkaufspreis geteilt durch den Preis, zu dem dieselben Coins zuletzt bewegt wurden. Der interessanteste Punkt ist die 1: in Aufwärtsphasen prallt der SOPR dort ab, weil niemand freiwillig mit Verlust verkauft und Rücksetzer bei Kostendeckung enden. Bricht er in einem Aufwärtstrend deutlich unter 1, ist das ein Regimewechsel. Die Kennzahl unterscheidet nicht zwischen echten Verkäufen und blossen Umschichtungen zwischen eigenen Wallets.',
    },
    {
        schluessel: 'nupl', kategorie: 'onchain', niveau: 2,
        frage: 'Was zeigt NUPL (Net Unrealized Profit/Loss) und welche Zonen gibt es?',
        antwort: 'Wie weit der Markt im Schnitt über oder unter dem Einstandspreis aller Halter notiert. Über 0,75 gilt als Euphorie (historisch nahe Zyklushochs), negativ als Kapitulation (historisch nahe Böden).',
        erklaerung: 'NUPL ist der unrealisierte Gewinn aller Halter geteilt durch die Marktkapitalisierung, also im Kern eine skalierte Fassung des MVRV. Die Zonen sind benannte Bereiche — Euphorie über 0,75, Kapitulation unter 0. Ihr Wert liegt in der Grobeinordnung über Monate, nicht in Handelsentscheidungen: die Zone kann monatelang gehalten werden, und wie beim MVRV sind die historischen Extreme über die Zyklen niedriger geworden.',
    },
    {
        schluessel: 'ssr', kategorie: 'onchain', niveau: 2,
        frage: 'Was sagt die Stablecoin Supply Ratio (SSR) aus?',
        antwort: 'Verhältnis von Bitcoin-Marktkapitalisierung zu Stablecoin-Marktkapitalisierung — ein Näherungswert für die potenzielle Kaufkraft am Markt. Eine fallende SSR kann echte neue Kaufkraft bedeuten ODER einfach einen fallenden BTC-Preis — beides sieht in der Kennzahl gleich aus.',
        erklaerung: 'Die Kennzahl klingt nach Kaufkraft, ist aber ein Bruch mit zwei beweglichen Teilen. Sie fällt, wenn Stablecoins zunehmen — echte neue Kaufkraft — ODER wenn der Bitcoin-Preis fällt, was das Gegenteil bedeutet. Beides sieht in der Zahl gleich aus. Brauchbar wird sie erst, wenn man Zähler und Nenner getrennt betrachtet: wächst die Stablecoin-Menge absolut, oder schrumpft nur der Markt?',
    },
    {
        schluessel: 'exchangeNetflow', kategorie: 'onchain', niveau: 2,
        frage: 'Was bedeutet ein positiver Exchange-Netflow bei Bitcoin?',
        antwort: 'Mehr Coins fliessen auf Börsen als davon abfliessen — historisch oft ein Vorzeichen für erhöhten Verkaufsdruck, weil Coins auf Börsen leichter liquide gemacht werden können als in privater Verwahrung.',
        erklaerung: 'Der Zusammenhang ist plausibel, aber schwächer als er wirkt. Coins auf Börsen sind leichter verkäuflich — sie werden aber auch für Derivate-Margin, Verwahrwechsel und interne Umbuchungen bewegt, und die Zuordnung von Adressen zu Börsen ist eine Schätzung des Datenanbieters. Aussagekräftig sind deshalb nur grosse, anhaltende Abweichungen vom Normalniveau, nicht der einzelne Tag.',
    },
    {
        schluessel: 'realizedCap', kategorie: 'onchain', niveau: 2,
        frage: 'Was unterscheidet Realized Cap von der normalen Marktkapitalisierung?',
        antwort: 'Die normale Marktkapitalisierung bewertet jeden Coin zum aktuellen Preis. Realized Cap bewertet jeden Coin zu dem Preis, zu dem er zuletzt on-chain bewegt wurde — sie reagiert also nicht auf jede Kursbewegung, sondern nur auf tatsächlich verschobene Coins.',
        erklaerung: 'Der Unterschied ist der Bewertungszeitpunkt. Die Marktkapitalisierung bewertet alles zum aktuellen Preis und schwankt deshalb mit jeder Kursbewegung; die Realized Cap ändert sich nur, wenn Coins tatsächlich on-chain bewegt werden. Sie steigt also, wenn zu höheren Preisen umverteilt wird — sie misst Kapitalzufluss statt Bewertung. Verlorene Coins bleiben zu ihrem alten Preis darin stehen und ziehen sie nach unten.',
    },
    {
        schluessel: 'dormancy', kategorie: 'onchain', niveau: 2,
        frage: 'Was misst „Coin Days Destroyed" (CDD) — und was unterscheidet es von Dormancy?',
        antwort: 'Wie lange bewegte Coins zuvor stillgelegen haben, gewichtet nach Menge. Ein Anstieg zeigt: alte, lange gehaltene Coins werden bewegt — oft ein Signal, dass langfristige Halter beginnen zu verkaufen.',
        erklaerung: 'Der Kern ist die Gewichtung nach Alter: 1 Coin, der 1000 Tage lag, zählt genauso viel wie 1000 Coins von gestern. Deshalb zeigt ein CDD-Anstieg, dass ALTE Hände sich bewegen — die Gruppe, die den Zyklus über gehalten hat. Nicht zu verwechseln mit Dormancy im engeren Sinn: das ist CDD geteilt durch das Transfervolumen, also das Durchschnittsalter je bewegtem Coin, und damit unabhängig davon, wie viel insgesamt läuft.',
    },

    // ── Derivate (vertieft) ──────────────────────────────────
    {
        schluessel: 'basisTrade', kategorie: 'derivate', niveau: 2,
        frage: 'Was ist ein Basis-Trade (Cash-and-Carry-Arbitrage)?',
        antwort: 'Spot kaufen und im selben Umfang Futures leerverkaufen, um die Preisdifferenz (Basis) risikoarm zu vereinnahmen — die Richtung des Marktes ist dabei egal, weil beide Positionen sich gegenseitig absichern.',
        erklaerung: 'Die Rendite kommt nicht aus der Kursrichtung, sondern daraus, dass die Basis zum Verfall auf null zusammenläuft — der Future muss beim Verfall dem Spot entsprechen. Risikolos ist der Trade trotzdem nicht: die Short-Seite braucht laufend Margin, ein starker Kursanstieg kann sie liquidieren, bevor der Verfall kommt. Bei Perpetuals gibt es keinen Verfall, dort verdient man stattdessen das Funding — und das kann drehen.',
    },
    {
        schluessel: 'deltaNeutral', kategorie: 'derivate', niveau: 2,
        frage: 'Was bedeutet eine delta-neutrale Position?',
        antwort: 'Long- und Short-Engagement sind so kombiniert, dass die Position auf kleine Kursbewegungen kaum reagiert. Verdient wird stattdessen an Funding, Zeitwertverfall oder der Spot-Futures-Spanne — nicht an der Kursrichtung.',
        erklaerung: 'Delta ist die Empfindlichkeit gegenüber dem Kurs. Delta null bedeutet: Long- und Short-Seite heben sich für kleine Bewegungen auf. Was bleibt, sind die anderen Risiken — Funding kann drehen, die Basis kann sich ausweiten statt zusammenzulaufen, und bei Optionen sorgt Gamma dafür, dass die Neutralität mit jedem Kursschritt verloren geht und nachjustiert werden muss. Neutral heisst also nicht risikolos, sondern nur: nicht am Kurs.',
    },
    {
        schluessel: 'gex', kategorie: 'derivate', niveau: 2,
        frage: 'Was zeigt Gamma Exposure (GEX)?',
        antwort: 'Wie stark Options-Händler ihre Absicherung bei Kursbewegungen nachjustieren müssen. Positives GEX dämpft Volatilität (Händler kaufen Rücksetzer, verkaufen Anstiege), negatives GEX verstärkt sie.',
        erklaerung: 'Der Grund liegt in der Absicherung der Händler, die Optionen verkauft haben. Bei positivem Gamma müssen sie in Anstiege hinein verkaufen und in Rücksetzer hinein kaufen — das dämpft die Bewegung. Bei negativem Gamma dreht sich das Vorzeichen: sie kaufen in Anstiege und verkaufen in Rücksetzer, was jede Bewegung verstärkt. Im Kryptomarkt ist der Effekt schwächer als im Aktienmarkt, weil der Optionsmarkt kleiner ist als der Perpetual-Markt.',
    },
    {
        schluessel: 'impliedVol', kategorie: 'derivate', niveau: 2,
        frage: 'Was ist implizite Volatilität (IV)?',
        antwort: 'Die vom Optionsmarkt erwartete künftige Schwankungsbreite, abgeleitet aus aktuellen Optionspreisen — nicht die tatsächlich beobachtete (historische) Volatilität der Vergangenheit.',
        erklaerung: 'IV ist eine Erwartung, historische Volatilität eine Messung. Der Abstand zwischen beiden ist die eigentliche Information: liegt IV deutlich über der tatsächlich eingetretenen Schwankung, ist Absicherung teuer — für Optionsverkäufer attraktiv, für Käufer ein Nachteil. Nach einem Ereignis fällt IV oft schlagartig („IV Crush"), weshalb eine Option selbst bei richtiger Richtung Geld verlieren kann.',
    },
    {
        schluessel: 'cmeGap', kategorie: 'derivate', niveau: 2,
        frage: 'Was war ein „CME-Gap" bei Bitcoin-Futures?',
        antwort: 'Eine Kurslücke, weil die CME am Wochenende schloss, während der Kryptomarkt weiterlief — die Lücke füllte sich meist innerhalb weniger Tage. Seit dem 29. Mai 2026 handelt die CME ihre Krypto-Futures durchgehend, das Phänomen ist damit weitgehend Geschichte.',
        erklaerung: 'Das Muster funktionierte nur, weil zwei Märkte zu verschiedenen Zeiten liefen: die CME schloss, Krypto lief weiter, und beim Wiederöffnen klaffte eine Lücke. Übrig bleibt ein wöchentliches Wartungsfenster von rund zwei Stunden — theoretisch also weiter eine Lücke, praktisch zu kurz für eine nennenswerte. Und die Beobachtung, dass sich solche Lücken „schliessen", war ohnehin harmloser als sie klang: der Kurs kehrt in einem schwankenden Markt oft in einen kürzlich durchlaufenen Bereich zurück, ganz ohne besondere Anziehung.',
    },
    {
        schluessel: 'quarterlyVsPerp', kategorie: 'derivate', niveau: 2,
        frage: 'Was unterscheidet quartalsweise Futures von Perpetuals?',
        antwort: 'Quartals-Futures haben ein festes Verfallsdatum, ihr Preis konvergiert zum Spot-Preis hin zum Verfall. Perpetuals haben kein Verfallsdatum — die Funding-Rate übernimmt stattdessen laufend die Angleichung an den Spot-Preis.',
        erklaerung: 'Praktisch heisst das zwei verschiedene Kostenarten. Beim Quartals-Future zahlt man die Basis einmal beim Einstieg — sie ist im Preis enthalten und läuft bis zum Verfall ab. Beim Perpetual zahlt man laufend Funding, das sich jederzeit ändern und drehen kann. Für kurze Haltedauern ist der Perpetual meist günstiger, für lange Positionen kann der Quartals-Future planbarer sein, weil die Kosten von vornherein feststehen.',
    },
    {
        schluessel: 'liquidationCascade', kategorie: 'derivate', niveau: 2,
        frage: 'Wie entsteht eine Liquidationskaskade?',
        antwort: 'Eine erste Liquidation drückt den Preis, was weitere gehebelte Positionen in ihre Liquidationszone treibt — deren Zwangsverkäufe drücken den Preis weiter. Der Effekt verstärkt sich selbst, bis die überhebelte Seite des Marktes abgebaut ist.',
        erklaerung: 'Die Kaskade endet nicht durch Vernunft, sondern wenn keine gehebelten Positionen mehr im betroffenen Kursbereich liegen — deshalb fällt das Ende oft mit einem Docht und einer schnellen Erholung zusammen. Sichtbar ist sie im Zusammenspiel: Preis stürzt, Open Interest bricht ein (Positionen verschwinden), liquidiertes Volumen springt. Bricht der Preis, ohne dass das OI fällt, war es keine Kaskade, sondern Verkaufsdruck.',
    },
    {
        schluessel: 'putCallRatio', kategorie: 'derivate', niveau: 2,
        frage: 'Was zeigt das Put-Call-Verhältnis bei Krypto-Optionen?',
        antwort: 'Das Volumen gehandelter Verkaufsoptionen (Put) im Verhältnis zu Kaufoptionen (Call). Ein hoher Wert deutet auf verstärkte Absicherung oder Bärenerwartung hin, ein niedriger auf überwiegend bullische Positionierung.',
        erklaerung: 'Die Zahl ist ohne Kontext schwer zu lesen: Puts werden auch von Haltern gekauft, die ihre Position absichern, nicht nur von Bären. Ein steigendes Verhältnis heisst also zunächst nur, dass Absicherung stärker nachgefragt wird. Aussagekräftiger ist es zusammen mit dem Skew — wenn Puts sowohl mehr gehandelt als auch relativ teurer werden, ist die Sorge echt und nicht bloss Umschichtung.',
    },

    // ── Risiko (vertieft) ────────────────────────────────────
    {
        schluessel: 'sharpe', kategorie: 'risiko', niveau: 2,
        frage: 'Was misst die Sharpe Ratio?',
        antwort: 'Überrendite gegenüber dem risikofreien Zins, geteilt durch die Schwankungsbreite (Standardabweichung) der Rendite. Höher heisst: mehr Rendite je Einheit eingegangenes Risiko.',
        erklaerung: 'Zwei Einschränkungen, die bei Krypto besonders wiegen. Erstens bestraft die Standardabweichung Aufwärts- wie Abwärtsschwankung gleich — eine Strategie mit gelegentlichen grossen Gewinnen wird abgewertet. Zweitens setzt die Kennzahl normalverteilte Renditen voraus, und Kryptorenditen haben ausgeprägt dicke Ränder: seltene Extremtage sind häufiger, als die Formel unterstellt. Eine hohe Sharpe Ratio kann daher ein verstecktes Ausfallrisiko kaschieren.',
    },
    {
        schluessel: 'sortino', kategorie: 'risiko', niveau: 2,
        frage: 'Wie unterscheidet sich die Sortino- von der Sharpe-Ratio?',
        antwort: 'Die Sortino Ratio bestraft nur die Abwärts-Schwankung (Verluste), nicht die gesamte Schwankungsbreite — eine Strategie mit heftigen Aufwärtsausschlägen wird dadurch nicht künstlich abgewertet.',
        erklaerung: 'Die Sortino Ratio ersetzt die Standardabweichung durch die Abwärtsabweichung — nur Renditen unter einer Zielschwelle gehen ein. Für Strategien mit schiefer Verteilung ist das die ehrlichere Zahl, etwa bei Trendfolge, die viele kleine Verluste und wenige grosse Gewinne produziert und unter Sharpe unnötig schlecht aussieht. Umgekehrt schmeichelt sie Strategien, die Prämien einsammeln: wenige, aber tiefe Einbrüche fallen darin weniger auf, als sie sollten.',
    },
    {
        schluessel: 'calmar', kategorie: 'risiko', niveau: 2,
        frage: 'Was misst die Calmar Ratio?',
        antwort: 'Rendite im Verhältnis zum grössten erlittenen Drawdown im Betrachtungszeitraum — sie fragt direkt: wie viel Ertrag für wie viel maximal ausgehaltenen Schmerz.',
        erklaerung: 'Üblich ist Jahresrendite geteilt durch maximalen Drawdown, meist über drei Jahre. Der Vorteil gegenüber Sharpe: der maximale Drawdown ist die Zahl, die man tatsächlich aushalten muss, während eine Standardabweichung niemand erlebt. Der Nachteil: sie hängt an EINEM Ereignis — dem schlimmsten — und ist deshalb vom Betrachtungszeitraum stark abhängig und statistisch instabil.',
    },
    {
        schluessel: 'kelly', kategorie: 'risiko', niveau: 2,
        frage: 'Was besagt das Kelly-Kriterium?',
        antwort: 'Eine Formel für die mathematisch optimale Positionsgrösse aus Trefferquote und Chance-Risiko-Verhältnis. In der Praxis wird meist nur ein Bruchteil (z.B. halbes Kelly) gehandelt, weil volles Kelly extreme Schwankungen im Kapital erzeugt.',
        erklaerung: 'Die Formel für binäre Wetten lautet f = p − (1−p)/b, mit p als Trefferquote und b als Gewinn-Verlust-Verhältnis. Bei 55 % und b = 1 ergibt das 10 % des Kontos je Trade — in der Praxis viel zu viel. Zwei Gründe: die Eingangsgrössen sind geschätzt, und schon eine leichte Überschätzung führt zu Übereinsatz; ausserdem erzeugt volles Kelly Drawdowns von 50 % und mehr. Halbes oder Viertel-Kelly ist der übliche Kompromiss.',
    },
    {
        schluessel: 'var', kategorie: 'risiko', niveau: 2,
        frage: 'Was gibt der Value at Risk (VaR) an?',
        antwort: 'Den geschätzten maximalen Verlust einer Position über einen Zeitraum mit einer bestimmten Wahrscheinlichkeit — z.B. „5 % Chance, an einem Tag mehr als 1000 $ zu verlieren". Er zeigt keine absolute Obergrenze, nur eine Wahrscheinlichkeit.',
        erklaerung: 'Der entscheidende Satz steht in der Antwort und wird trotzdem meist überlesen: der VaR sagt nichts darüber, wie schlimm es in den restlichen 5 % wird. Genau dort liegt bei Krypto das Risiko. Zusätzlich wird er meist aus historischen Daten geschätzt und unterschätzt damit systematisch Ereignisse, die im Betrachtungszeitraum nicht vorkamen. Der Expected Shortfall — der Durchschnitt der schlimmsten Fälle — ist die ehrlichere Kennzahl.',
    },
    {
        schluessel: 'custodyRisk', kategorie: 'risiko', niveau: 2,
        frage: 'Was ist der Unterschied zwischen Verwahrung auf einer Börse und Self-Custody?',
        antwort: 'Auf einer Börse liegen die Coins technisch im Besitz der Börse, man hält nur eine Forderung dagegen (Gegenparteirisiko). Self-Custody heisst: die privaten Schlüssel liegen bei einem selbst — kein Börsenausfall kann die Coins wegnehmen, aber ein verlorener Schlüssel auch niemand ersetzen.',
        erklaerung: 'Die Abwägung ist nicht Sicherheit gegen Bequemlichkeit, sondern zwei verschiedene Risiken. Auf der Börse trägt man das Ausfallrisiko eines Unternehmens; bei Self-Custody das Risiko der eigenen Fehler, und das ist die häufigere Verlustursache. Für Futures-Handel ist Guthaben auf der Börse unvermeidlich — die praktische Konsequenz ist, dort nur die benötigte Margin zu halten und nicht das ganze Vermögen.',
    },

    // ── Chartanalyse (vertieft) ──────────────────────────────
    {
        schluessel: 'orderflow', kategorie: 'chartAnalyse', niveau: 2,
        frage: 'Was verrät ein Orderbuch-Ungleichgewicht (Order Flow Imbalance)?',
        antwort: 'Ob auf der Kauf- oder Verkaufsseite des Orderbuchs gerade deutlich mehr Volumen liegt. Ein starkes Ungleichgewicht kann kurzfristig den Kurs in die entsprechende Richtung drücken — kann aber genauso gut eine Spoofing-Wand sein, die vor Ausführung wieder verschwindet.',
        erklaerung: 'Das Ungleichgewicht ist die am leichtesten zu fälschende Grösse im Markt. Eine grosse sichtbare Wand kostet nichts, solange sie nicht ausgeführt wird, und lässt sich in Millisekunden zurückziehen — Spoofing ist verbreitet. Aussagekräftig ist deshalb nicht, was im Buch LIEGT, sondern was tatsächlich gehandelt wurde: eine Wand, gegen die anhaltend gehandelt wird und die trotzdem hält, ist echt.',
    },
    {
        schluessel: 'vwapExecution', kategorie: 'chartAnalyse', niveau: 2,
        frage: 'Warum handeln grosse Orders oft über VWAP-Algorithmen statt in einem Schlag?',
        antwort: 'Eine einzelne Grossorder würde das Orderbuch leerfegen und den eigenen Einstiegspreis verschlechtern (Slippage). VWAP-Ausführung verteilt die Order über die Zeit, um sich dem durchschnittlichen Marktpreis anzunähern.',
        erklaerung: 'Der Grund ist die eigene Marktwirkung: eine Order, die das Buch mehrere Prozent leerfegt, verschlechtert den eigenen Einstieg und verrät zugleich die Absicht. Ein Ausführungsalgorithmus zerlegt sie deshalb in viele kleine Teile über die Zeit. Für den kleinen Händler ist die relevante Erkenntnis eine andere: ruhige, gleichmässige Bewegungen mit konstantem Volumen können eine laufende Grossausführung sein und enden abrupt, wenn sie fertig ist.',
    },
    {
        schluessel: 'correlationRegime', kategorie: 'chartAnalyse', niveau: 2,
        frage: 'Warum kann eine gemessene Korrelation zwischen zwei Coins in der nächsten Woche wertlos sein?',
        antwort: 'Korrelationen sind kein Naturgesetz, sondern ein Marktzustand (Regime) — sie brechen bei Nachrichten, die nur einen der beiden Coins betreffen, oder wenn sich das übergeordnete Risikoregime ändert. Eine Korrelation aus der Vergangenheit ist eine Beobachtung, keine Garantie.',
        erklaerung: 'Korrelation misst den Gleichlauf über ein Fenster, und schon die Fensterlänge verändert das Ergebnis. Wichtiger ist die Ursache: Coins laufen gleich, solange dieselbe übergeordnete Kraft wirkt — Zinserwartung, Risikoappetit. Kommt eine coin-spezifische Nachricht, bricht der Gleichlauf sofort. Für das Portfolio heisst das: eine hohe gemessene Korrelation ist verlässlicher als eine niedrige, denn im Stress steigen alle Korrelationen.',
    },

    // ── Sentiment (vertieft) ─────────────────────────────────
    {
        schluessel: 'coinbasePremium', kategorie: 'sentiment', niveau: 2,
        frage: 'Was zeigt der Coinbase-Premium-Index?',
        antwort: 'Die Preisdifferenz von Bitcoin auf Coinbase gegenüber Binance. Ein positiver Aufschlag gilt als Zeichen für US-Kaufinteresse (institutionell/retail), ein negativer für Verkaufsdruck aus dem US-Markt.',
        erklaerung: 'Der Aufschlag entsteht, weil Coinbase überwiegend US-Kundschaft bedient und Arbitrage zwischen den Börsen Zeit und Kapital braucht. Ein anhaltender Aufschlag zeigt daher Nachfrage, die schneller kommt, als die Arbitrage sie ausgleicht. Die Zahl ist klein — meist Bruchteile eines Prozents — und für sich genommen kein Handelssignal; interessant ist ihr Vorzeichenwechsel und wie lange er hält.',
    },
    {
        schluessel: 'takerRatio', kategorie: 'sentiment', niveau: 2,
        frage: 'Was sagt das Taker-Buy/Sell-Verhältnis aus?',
        antwort: 'Ob aggressive Marktorders gerade eher kaufen oder verkaufen — also wer bereit ist, den Spread zu zahlen, um sofort ausgeführt zu werden. Ein Wert über 1 heisst: aggressive Käufer dominieren gerade.',
        erklaerung: 'Der Kern ist die Bereitschaft, den Spread zu zahlen: wer sofort ausgeführt werden will, hat es eilig, und Eile ist ein Stimmungssignal. Wie beim CVD ist die Zahl nur im Vergleich zum Preis aussagekräftig — steigende Taker-Käufe bei stagnierendem Preis heissen, dass jemand auf der anderen Seite alles aufnimmt. Die Zuordnung zu Käufer oder Verkäufer ist dabei eine Heuristik aus dem Trade-Strom.',
    },

    // ── Markt (vertieft) ─────────────────────────────────────
    {
        schluessel: 'fdv', kategorie: 'markt', niveau: 2,
        frage: 'Was zeigt die Fully Diluted Valuation (FDV) im Unterschied zur Marktkapitalisierung?',
        antwort: 'Marktkapitalisierung bewertet nur die aktuell zirkulierende Menge, FDV den kompletten maximalen Token-Vorrat zum aktuellen Preis. Eine FDV, die ein Vielfaches der Marktkapitalisierung beträgt, warnt vor künftigem Verkaufsdruck durch noch nicht freigeschaltete Token.',
        erklaerung: 'Die FDV bewertet Token, die es noch gar nicht gibt, zum heutigen Preis — sie ist damit eher eine Warnung als eine Bewertung. Ein Verhältnis von FDV zu Marktkapitalisierung über 5 heisst: der Grossteil des Angebots kommt erst noch. Vorsicht auch nach unten: bei Coins ohne Obergrenze ist die FDV gar nicht definiert, und manche Projekte weisen sie mit willkürlichen Annahmen aus.',
    },
    {
        schluessel: 'tokenUnlock', kategorie: 'markt', niveau: 2,
        frage: 'Warum belasten Token-Unlocks oft den Kurs?',
        antwort: 'Team- und Investoren-Anteile sind meist gesperrt und werden nach Zeitplan freigegeben. Sobald sie handelbar werden, kann zusätzliches Angebot auf den Markt treffen, ohne dass sich an der Nachfrage etwas geändert hat.',
        erklaerung: 'Entscheidend ist die Grösse im Verhältnis zum täglichen Handelsvolumen, nicht die absolute Menge. Ein Unlock über 5 % des Umlaufs bei dünnem Volumen wirkt stärker als 20 % bei tiefem Markt. Zweite Feinheit: der Markt weiss den Termin, und ein Teil wird vorab eingepreist — häufig fällt der Kurs vor dem Unlock und erholt sich danach. Die Termine sind öffentlich und gehören in den Kalender.',
    },
    {
        schluessel: 'halving', kategorie: 'markt', niveau: 2,
        frage: 'Was passiert beim Bitcoin-Halving?',
        antwort: 'Die Belohnung pro geminten Block halbiert sich (etwa alle vier Jahre) — das Angebot an neuen Coins verlangsamt sich, die Nachfrage bleibt davon unberührt. Historisch folgten grosse Kursbewegungen erst mit deutlicher Verzögerung, nicht am Halving-Tag selbst.',
        erklaerung: 'Grössenordnung: die tägliche neue Menge ist heute klein gegenüber dem täglichen Handelsvolumen — der unmittelbare Angebotseffekt am Tag selbst ist damit gering. Historisch kamen die grossen Bewegungen mit Monaten Verzögerung, was die Zuordnung schwierig macht: in denselben Zeiträumen änderten sich auch Zinsen und Liquidität. Drei Beobachtungen sind zudem keine Statistik.',
    },
    {
        schluessel: 'powVsPos', kategorie: 'markt', niveau: 2,
        frage: 'Was unterscheidet Proof-of-Work von Proof-of-Stake grundlegend?',
        antwort: 'PoW sichert das Netzwerk über Rechenleistung (Mining), PoS über hinterlegtes Kapital (Staking). Ein 51%-Angriff kostet bei PoW den Aufbau von Mehrheits-Rechenleistung, bei PoS den Kauf der Mehrheit der gestakten Coins — was die eigene Position sofort entwertet.',
        erklaerung: 'Der Unterschied wirkt auch auf den Markt. PoW-Miner haben laufende Stromkosten und müssen einen Teil ihrer Coins verkaufen — es gibt strukturellen Verkaufsdruck. PoS hat den nicht, dafür sind gestakte Coins zeitweise gebunden und stehen dem Markt nicht zur Verfügung, was das handelbare Angebot verknappt. Für die Sicherheit heisst es: PoW kostet laufend Energie, PoS bindet Kapital.',
    },
    {
        schluessel: 'attack51', kategorie: 'markt', niveau: 2,
        frage: 'Was ist ein 51%-Angriff?',
        antwort: 'Kontrolle über die Mehrheit der Netzwerk-Rechenleistung (PoW) oder der gestakten Coins (PoS), um Transaktionen umzuschreiben und Coins doppelt auszugeben. Bei grossen Netzwerken wie Bitcoin wirtschaftlich praktisch unmöglich, bei kleinen Chains real vorgekommen.',
        erklaerung: 'Der Schutz ist wirtschaftlich, nicht technisch: der Angriff wäre möglich, lohnt sich nur nicht. Bei Bitcoin müsste man Hardware und Strom in einer Grössenordnung aufbringen, die den möglichen Gewinn übersteigt. Bei PoS kommt hinzu, dass ein Angreifer die Mehrheit der gestakten Coins kaufen müsste und damit sein eigenes Vermögen entwertet. Bei kleinen Chains sind beide Schranken niedrig — dort ist es real vorgekommen.',
    },
    // ══════════════════════════════════════════════════════════
    // Ergänzungen über ALLE drei Stufen — die Abschnitte darunter sind nach
    // Kategorie sortiert, nicht nach Niveau. Hier stehen 18 Grundbegriffe
    // (Niveau 1), 41 vertiefte (2) und 22 Spezialkarten (3) nebeneinander;
    // wer eine Stufe sucht, filtert in `Lernen.vue`, statt sich auf die
    // Reihenfolge in dieser Datei zu verlassen.
    //
    // Der Kopf hier kündigte bis zum 05.09.2026 „Niveau 3 — Spezialwissen"
    // an und war damit für 59 der 81 Karten darunter schlicht falsch.
    // ══════════════════════════════════════════════════════════

    // ── Indikatoren (Ergänzung) ──────────────────────────────
    {
        schluessel: 'emaSma', kategorie: 'indikatoren',
        frage: 'Was unterscheidet einen EMA von einem SMA?',
        antwort: 'Der SMA gewichtet alle Kerzen des Zeitraums gleich, der EMA die jüngsten stärker. Der EMA dreht deshalb früher — und in einem Seitwärtsmarkt entsprechend öfter falsch.',
        erklaerung: 'Der EMA gewichtet mit dem Faktor 2/(n+1) je Kerze, die jüngste also am stärksten; alles Ältere verblasst, verschwindet aber nie ganz. Der SMA dagegen springt, wenn ein alter Ausreisser aus dem Fenster fällt. Schneller ist nicht besser: dieselbe Empfindlichkeit, die im Trend früher einsteigen lässt, erzeugt im Seitwärtsmarkt mehr Fehlsignale. Die Wahl ist ein Tausch, kein Fortschritt.',
    },
    {
        schluessel: 'macd', kategorie: 'indikatoren',
        frage: 'Was zeigt der MACD?',
        antwort: 'Den Abstand zweier gleitender Durchschnitte (meist 12 und 26) samt Signallinie (9). Er misst Momentum, nicht Richtung: ohne Trend kreuzt er laufend hin und her.',
        erklaerung: 'Die drei Zahlen sind zwei EMAs (12, 26) und ein EMA über deren Differenz (9). Das Histogramm zeigt den Abstand zwischen MACD-Linie und Signallinie — es dreht also, bevor sich die Linien kreuzen. Weil alles auf Durchschnitten beruht, ist der MACD grundsätzlich nachlaufend: er bestätigt eine Bewegung, er sagt sie nicht an. In einer Range kreuzt er um die Nulllinie herum ständig, ohne dass etwas passiert.',
    },
    {
        schluessel: 'bollinger', kategorie: 'indikatoren',
        frage: 'Was sagen Bollinger-Bänder aus?',
        antwort: 'Ein gleitender Durchschnitt (meist 20) plus/minus zwei Standardabweichungen. Die Aussage ist die BREITE der Bänder — eng heisst ruhig, weit heisst bewegt. Eine blosse Berührung des Bandes ist kein Signal.',
        erklaerung: 'Zwei Standardabweichungen bedeuten, dass rund 95 % der Kerzen innerhalb der Bänder liegen — eine Berührung ist damit der Normalfall und für sich genommen kein Signal. Die Aussage steckt in der Breite: ein Squeeze (sehr enge Bänder) zeigt gestaute Volatilität, die sich irgendwann entlädt, sagt aber nichts über die Richtung. In einem starken Trend läuft der Kurs am äusseren Band entlang, ohne umzukehren.',
    },
    {
        schluessel: 'divergenz', kategorie: 'indikatoren',
        frage: 'Was ist eine Divergenz zwischen Kurs und Indikator?',
        antwort: 'Der Kurs macht ein neues Hoch, der Indikator (z.B. RSI) nicht mehr — das Momentum lässt nach. Divergenzen können sich mehrfach hintereinander auflösen, bevor der Kurs tatsächlich dreht.',
        erklaerung: 'Man unterscheidet zwei Sorten. Regulär: der Kurs macht ein höheres Hoch, der Indikator nicht — das Momentum lässt nach, eine Umkehr wird wahrscheinlicher. Versteckt: der Kurs macht ein tieferes Hoch, der Indikator ein höheres — das gilt als Fortsetzungshinweis im bestehenden Trend. Beide sind Hinweise, keine Auslöser: in einem starken Trend lösen sich Divergenzen mehrfach hintereinander auf, weshalb sie eine Bestätigung im Kurs brauchen.',
    },
    {
        schluessel: 'volumenprofil', kategorie: 'indikatoren',
        frage: 'Was zeigt ein Volumenprofil (POC, Value Area)?',
        antwort: 'Wie viel Volumen auf welchem PREIS gehandelt wurde statt zu welcher Zeit. Der POC ist der meistgehandelte Preis, die Value Area der Bereich, in dem rund 70 % des Volumens lagen.',
        erklaerung: 'Der Unterschied zum normalen Volumenbalken ist die Achse: hier zählt WO gehandelt wurde, nicht WANN. Ein Preis mit viel Volumen ist ein akzeptierter Preis — dort finden Orders Gegenpartei, der Kurs hält sich gern auf. Ein Bereich mit wenig Volumen ist das Gegenteil: er wurde schnell durchlaufen und wird oft ebenso schnell wieder durchlaufen. Deshalb sucht man Ziele in Lücken und Widerstand an Volumenknoten.',
    },
    {
        schluessel: 'fibonacci', kategorie: 'indikatoren',
        frage: 'Was sind Fibonacci-Retracements?',
        antwort: 'Prozentmarken einer vorangegangenen Bewegung (38,2 / 50 / 61,8 %), an denen viele einen Rücksetzer erwarten. Sie wirken, weil viele sie beobachten — nicht weil den Zahlen selbst etwas innewohnt.',
        erklaerung: 'Ehrlicherweise: 50 % ist gar keine Fibonacci-Zahl, sie ist aus Gewohnheit dabei. 61,8 % ist der Kehrwert des goldenen Schnitts, 38,2 % dessen Quadrat. Dass die Marken wirken, liegt nicht an der Mathematik, sondern daran, dass sie in jeder Charting-Software voreingestellt sind und deshalb viele dort dieselben Orders platzieren — eine sich selbst erfüllende Erwartung. Entsprechend hilft eine Marke nur, wenn dort auch sonst etwas liegt.',
    },
    {
        schluessel: 'atrStopp', kategorie: 'indikatoren',
        frage: 'Warum bemisst man den Stopp oft in ATR statt in Prozent?',
        antwort: 'Weil derselbe Prozentabstand in einem ruhigen und in einem heftigen Markt etwas völlig anderes bedeutet. Ein Stopp von z.B. 1,5 ATR passt sich der aktuellen Schwankungsbreite an, statt sie zu ignorieren.',
        erklaerung: 'Konkret: bei einem Kurs von 100 und einer ATR von 2 liegt ein Stopp von 1,5 ATR 3 Punkte entfernt, also bei 97. Beruhigt sich der Markt und die ATR fällt auf 1, wären es nur noch 1,5 Punkte. Ein fixer Prozentstopp würde in der ruhigen Phase unnötig weit und in der heftigen viel zu eng stehen. Der ATR-Stopp koppelt damit auch die Positionsgrösse an die Marktlage: gleiches Risiko in Franken bedeutet in einem wilden Markt automatisch eine kleinere Position.',
    },

    // ── Chartanalyse (Ergänzung) ─────────────────────────────
    {
        schluessel: 'unterstuetzung', kategorie: 'chartAnalyse',
        frage: 'Wann ist eine Marke wirklich Unterstützung oder Widerstand?',
        antwort: 'Wenn der Kurs dort schon sichtbar reagiert hat — gedreht, gestockt, auffällig viel Volumen gehandelt. Eine Linie, an der noch nie etwas passiert ist, ist eine gezeichnete Linie, keine Marke.',
        erklaerung: 'Eine Marke ist nur so gut wie die Spur, die sie hinterlassen hat. Was zählt: hat der Kurs dort schon gedreht, wurde dort auffällig viel gehandelt, liegt dort ein Volumenknoten. Nach einem Bruch tauschen Unterstützung und Widerstand oft die Rolle, weil die dort Eingestiegenen ihre Position beim Rücktest ausgleichen. Und je öfter eine Marke getestet wird, desto schwächer wird sie — jeder Test verbraucht die dort liegenden Orders.',
    },
    {
        schluessel: 'kerzenmuster', kategorie: 'chartAnalyse',
        frage: 'Was sagt ein einzelnes Kerzenmuster wie Hammer oder Engulfing aus?',
        antwort: 'Für sich genommen sehr wenig. Erst der Ort zählt: dasselbe Muster an einer bedeutenden Marke nach einer klaren Bewegung ist etwas anderes als mitten in einer Range.',
        erklaerung: 'Statistisch untersucht liefern einzelne Kerzenmuster kaum einen Vorteil; was wirkt, ist der Kontext. Ein Hammer an einer bedeutenden Marke nach einer ausgedehnten Abwärtsbewegung ist etwas anderes als derselbe Hammer mitten in einer Range. Das Muster beschreibt zudem nur, was in der Kerze passiert ist — ein langer unterer Docht heisst, dass tiefere Preise abgelehnt wurden. Diese Information ist der eigentliche Inhalt, nicht der Name.',
    },
    {
        schluessel: 'range', kategorie: 'chartAnalyse',
        frage: 'Was ist eine Range und was macht sie gefährlich?',
        antwort: 'Ein Seitwärtsbereich zwischen zwei Marken. Gefährlich, weil jede Trendfolge darin systematisch verliert — deshalb prüft man vorher, ob überhaupt ein Trend läuft (z.B. über den ADX).',
        erklaerung: 'Eine Range ist der Normalzustand: Märkte verbringen den Grossteil der Zeit seitwärts. Gefährlich ist sie, weil jedes Trendfolge-Werkzeug darin systematisch das Falsche tut — gleitende Durchschnitte kreuzen ständig, Ausbrüche scheitern. Deshalb steht vor der Strategiewahl die Frage nach dem Zustand, etwa über den ADX. Innerhalb einer Range dreht sich die Logik um: man handelt an den Rändern gegen die Bewegung statt mit ihr.',
    },
    {
        schluessel: 'zeiteinheiten', kategorie: 'chartAnalyse',
        frage: 'Warum schaut man auf mehr als eine Zeiteinheit?',
        antwort: 'Die grosse Zeiteinheit sagt, in welche Richtung man überhaupt handeln will, die kleine, wann man einsteigt. Ein perfekter 5-Minuten-Einstieg gegen die Tagesrichtung bleibt ein Gegentrend-Trade.',
        erklaerung: 'Die übliche Aufteilung ist Richtung aus der grossen, Zeitpunkt aus der kleinen Zeiteinheit — meist im Verhältnis von etwa 1:4 bis 1:6, also Tages- und Vierstundenchart. Zwei Fallen: mehr Zeiteinheiten führen nicht zu mehr Klarheit, sondern dazu, dass sich für jede Meinung eine passende findet. Und ein Signal in der kleinen Zeiteinheit gegen die grosse ist kein Einstieg, sondern ein Gegentrend-Trade mit entsprechend kleinerem Ziel.',
    },
    {
        schluessel: 'liquiditaetszone', kategorie: 'chartAnalyse', niveau: 2,
        frage: 'Warum liegt „Liquidität" ausgerechnet über Hochs und unter Tiefs?',
        antwort: 'Weil dort die Stopps stehen: über einem Hoch die der Shorts, unter einem Tief die der Longs. Ein Ausbruch dorthin findet also automatisch Gegenpartei — deshalb laufen Kurse so auffällig oft genau dahin.',
        erklaerung: 'Der Mechanismus ist rein rechnerisch. Wer long ist, legt seinen Stopp unter das letzte Tief; wer short ist, über das letzte Hoch. Dort sammeln sich damit Orders, die beim Auslösen in die Gegenrichtung des Haltenden wirken. Ein grosser Marktteilnehmer, der eine Position aufbauen will, braucht genau solche Gegenpartei — deshalb laufen Kurse auffällig oft dorthin, ohne dass jemand etwas manipulieren müsste.',
    },
    {
        schluessel: 'fairValueGap', kategorie: 'chartAnalyse', niveau: 3,
        frage: 'Was ist eine Fair Value Gap (Imbalance)?',
        antwort: 'Ein Preisbereich, den der Kurs in einer heftigen Bewegung praktisch ohne Gegenhandel übersprungen hat — sichtbar als Lücke zwischen den Dochten dreier aufeinanderfolgender Kerzen. Die Erwartung, dass er zurückkommt, ist eine Beobachtung, kein Gesetz.',
        erklaerung: 'Die Definition ist mechanisch: zwischen dem Docht der ersten und dem Docht der dritten Kerze bleibt eine Lücke, die zweite Kerze hat sie übersprungen. Interpretiert wird das als Bereich ohne echte Preisfindung. Die Erwartung, dass der Kurs zurückkommt, ist allerdings schwach belegt — in einem schwankenden Markt kehrt er ohnehin oft in kürzlich durchlaufene Bereiche zurück, ganz ohne besondere Eigenschaft dieser Zone.',
    },
    {
        schluessel: 'orderBlock', kategorie: 'chartAnalyse', niveau: 3,
        frage: 'Was meint ein „Order Block"?',
        antwort: 'Die letzte gegenläufige Kerze vor einer starken Bewegung — dort soll grosses Kapital eingestiegen sein. Im Wyckoff-Vokabular ist das derselbe Ort, der dort „Last Point of Support" heisst.',
        erklaerung: 'Der Gedanke: eine starke Bewegung braucht einen Auslöser, und der soll dort liegen, wo grosses Kapital eingestiegen ist — in der letzten Kerze vor dem Ausbruch. Belegbar ist das nicht; man sieht die Kerze, nicht die Order dahinter. Der praktische Wert liegt woanders: der Bereich ist meist zugleich das letzte lokale Hoch oder Tief und damit eine Marke, an der ohnehin Orders liegen. Der Ort funktioniert, die Begründung ist Erzählung.',
    },
    {
        schluessel: 'bosChoch', kategorie: 'chartAnalyse', niveau: 3,
        frage: 'Was unterscheidet einen Bruch der Marktstruktur (BOS) von einem Change of Character (CHoCH)?',
        antwort: 'BOS: der Trend bestätigt sich, das nächste Hoch bzw. Tief in Trendrichtung wird genommen. CHoCH: erstmals wird ein Punkt GEGEN die Trendrichtung gebrochen — der erste Hinweis, dass die Struktur kippt.',
        erklaerung: 'Beides sind Beschreibungen der Struktur aus höheren Hochs und höheren Tiefs. BOS bestätigt sie, CHoCH bricht sie zum ersten Mal. Der wunde Punkt ist die Definition von Hoch und Tief: je nachdem welche Zwischenbewegungen man zählt, ergibt sich eine andere Struktur — dasselbe Chart lässt sich als BOS oder als CHoCH lesen. Nützlich wird es erst mit einer festen, vorher aufgeschriebenen Regel, welche Punkte zählen.',
    },
    {
        schluessel: 'wyckoff', kategorie: 'chartAnalyse', niveau: 3,
        frage: 'Was beschreibt das Wyckoff-Schema?',
        antwort: 'Einen wiederkehrenden Vierklang: Akkumulation (leises Einsammeln in einer Range), Markup (Aufwärtstrend), Distribution (Abgeben in die Stärke), Markdown (Abwärtstrend). Ein Deutungsrahmen, kein Signalgeber.',
        erklaerung: 'Der Wert des Schemas liegt nicht in der Vorhersage, sondern in der Frage, die es stellt: Wer verkauft an wen, und wer hat Zeit? Akkumulation ist eine Phase, in der Angebot bei fallendem oder stagnierendem Preis aufgenommen wird — sichtbar an hohem Volumen ohne Kursfortschritt. Das Problem ist die Rückschau: die Phasen sind im Nachhinein immer klar erkennbar und im laufenden Chart selten eindeutig.',
    },
    {
        schluessel: 'spring', kategorie: 'chartAnalyse', niveau: 3,
        frage: 'Was ist ein Spring bzw. ein Upthrust?',
        antwort: 'Der Fehlausbruch am Ende einer Range: der Kurs fällt kurz unter die Unterstützung (Spring) oder steigt über den Widerstand (Upthrust) und kehrt sofort zurück. Zweck ist das Einsammeln der dort ausgelösten Stopps.',
        erklaerung: 'Der Zweck ist derselbe wie beim Stop-Hunt, nur am Ende einer längeren Range: die Stopps ausserhalb der Range werden abgeholt, und danach fehlt das Angebot bzw. die Nachfrage für einen echten Ausbruch in diese Richtung. Was ihn vom gescheiterten Ausbruch unterscheidet, ist die Rückkehr — der Kurs muss zügig in die Range zurück, meist mit deutlichem Volumen. Bleibt er draussen, war es kein Spring, sondern der Ausbruch.',
    },
    {
        schluessel: 'cvd', kategorie: 'chartAnalyse', niveau: 3,
        frage: 'Was zeigt der Cumulative Volume Delta (CVD)?',
        antwort: 'Die laufende Summe aus aggressiven Käufen minus aggressiven Verkäufen. Er beantwortet nicht, wohin der Kurs lief, sondern welche Seite dafür bereit war, den Spread zu zahlen.',
        erklaerung: 'Gerechnet wird aus den einzelnen Trades: alles, was gegen den Ask geht, zählt positiv, alles gegen den Bid negativ. Der Erkenntniswert entsteht im VERGLEICH zum Preis. Laufen beide zusammen, ist die Bewegung getragen. Steigt der Preis, während der CVD fällt, treibt ihn nicht Kaufaggression, sondern fehlendes Angebot — solche Bewegungen kippen schneller. Wichtig: der CVD ist immer börsenspezifisch, es gibt keinen Gesamt-CVD.',
    },
    {
        schluessel: 'absorption', kategorie: 'chartAnalyse', niveau: 3,
        frage: 'Was heisst Absorption im Orderfluss?',
        antwort: 'Aggressive Marktorders laufen in eine Wand ruhender Limit-Orders, die immer wieder nachgelegt wird — der Kurs bewegt sich trotz hohem Volumen kaum. Fällt der CVD, während der Preis hält, absorbiert dort jemand.',
        erklaerung: 'Die verräterische Kombination ist hohes Volumen bei stehendem Preis. Normalerweise bewegt Volumen den Kurs; tut es das nicht, liegt auf der Gegenseite jemand, der laufend nachlegt. Für den Handel ist die Richtung entscheidend: wird auf der Verkaufsseite absorbiert (viele Marktverkäufe, Preis hält), sammelt dort jemand ein. Löst sich die Absorption auf, folgt die Bewegung meist schnell, weil die aufgestaute Seite dann nichts mehr aufhält.',
    },
    {
        schluessel: 'footprint', kategorie: 'chartAnalyse', niveau: 3,
        frage: 'Was zeigt eine Footprint-Kerze?',
        antwort: 'Innerhalb einer einzelnen Kerze, wie viel auf jedem Preis gegen Bid und gegen Ask gehandelt wurde. Statt „diese Kerze war grün" sieht man, wo in ihr tatsächlich gehandelt wurde.',
        erklaerung: 'Die Darstellung zeigt je Preisstufe zwei Zahlen: was gegen den Bid und was gegen den Ask gehandelt wurde. Daraus wird sichtbar, was eine normale Kerze verbirgt — etwa dass eine grüne Kerze überwiegend von Verkäufen getragen wurde und der Anstieg nur aus fehlendem Angebot entstand. Die Grenze der Methode: die Zuordnung zu Käufer oder Verkäufer ist eine Heuristik aus dem Trade-Strom, keine Angabe der Börse.',
    },

    // ── Derivate (Ergänzung) ─────────────────────────────────
    {
        schluessel: 'orderarten', kategorie: 'derivate',
        frage: 'Was unterscheidet Market-, Limit- und Stop-Order?',
        antwort: 'Market: sofort zum nächstbesten Preis — Ausführung sicher, Preis nicht. Limit: nur zu meinem Preis oder besser — Preis sicher, Ausführung nicht. Stop: wird erst bei einem Auslösekurs überhaupt zu einer Order.',
        erklaerung: 'Der praktische Kern ist der Tausch zwischen Ausführungs- und Preissicherheit. Eine Market-Order in einem dünnen Buch kann mehrere Prozent Slippage kosten — bei kleinen Coins der häufigste unerwartete Verlust. Eine Limit-Order kostet weniger Gebühr, kann aber genau in dem Moment nicht ausgeführt werden, in dem man sie am dringendsten braucht. Und eine Stopp-Order ist bis zum Auslösen nicht im Buch: sie schützt nicht vor einer Lücke.',
    },
    {
        schluessel: 'trailingStopp', kategorie: 'derivate',
        frage: 'Was ist ein Trailing Stop?',
        antwort: 'Ein Stopp, der dem Kurs in festem Abstand folgt, solange dieser in die richtige Richtung läuft, und stehen bleibt, sobald er dreht. Er sichert Gewinn, kostet aber bei jedem grösseren Rücksetzer die Position.',
        erklaerung: 'Der Abstand ist die ganze Entscheidung. Zu eng, und jeder normale Rücksetzer beendet den Trade mitten in einem intakten Trend; zu weit, und ein grosser Teil des Buchgewinns geht zurück, bevor er auslöst. Deshalb bemisst man ihn sinnvollerweise in ATR statt in Prozent. Wichtig auch: viele Börsen führen den Trailing Stop intern, ohne dass sich der aktuelle Auslösepreis abfragen liesse — man sieht nicht, wo er gerade steht.',
    },
    {
        schluessel: 'markPreis', kategorie: 'derivate', niveau: 2,
        frage: 'Warum liquidiert die Börse über den Mark-Preis statt über den letzten Kurs?',
        antwort: 'Der Mark-Preis wird aus einem Index mehrerer Börsen gebildet und ist gegen kurze Manipulationsdochte robuster. Ein Docht auf dem eigenen Chart löst deshalb nicht zwingend eine Liquidation aus — und umgekehrt.',
        erklaerung: 'Der Mark-Preis stammt aus einem Index mehrerer Börsen plus einer geglätteten Basis, der letzte Kurs dagegen aus genau einem Orderbuch. Praktische Folge: ein Docht auf dem eigenen Chart, der die eigene Liquidationsmarke berührt, löst nicht zwingend etwas aus — und umgekehrt kann liquidiert werden, ohne dass der sichtbare Kurs dort war. Wer seine Marke beobachtet, muss den Mark-Preis anzeigen, nicht den letzten Trade.',
    },
    {
        schluessel: 'initialWartung', kategorie: 'derivate', niveau: 2,
        frage: 'Was unterscheidet Initialmarge von Wartungsmarge?',
        antwort: 'Die Initialmarge ist, was das Eröffnen kostet (Positionsgrösse geteilt durch Hebel). Die Wartungsmarge ist das Minimum, das die Position offen hält — wird es unterschritten, liquidiert die Börse.',
        erklaerung: 'Zahlenbeispiel: 10.000 USD Position bei 10× Hebel kostet 1.000 USD Initialmarge. Beträgt die Wartungsmarge 0,5 %, also 50 USD, darf der Verlust bis auf 950 USD anwachsen, bevor liquidiert wird. Der Wartungssatz ist dabei nicht fix, sondern steigt mit der Positionsgrösse. Wichtig: die Initialmarge ist eine Anforderung beim Eröffnen, die Wartungsmarge eine dauerhafte — sie kann durch Nachschiessen wieder erfüllt werden.',
    },
    {
        schluessel: 'bankrottpreis', kategorie: 'derivate', niveau: 2,
        frage: 'Was unterscheidet Liquidationspreis und Bankrottpreis?',
        antwort: 'Beim Liquidationspreis greift die Börse ein, solange die Wartungsmarge noch da ist. Beim Bankrottpreis wäre die Marge exakt aufgebraucht. Die Spanne dazwischen ist der Puffer, aus dem sich der Versicherungsfonds speist.',
        erklaerung: 'Die Börse greift bewusst FRÜHER ein, als das Konto rechnerisch leer wäre. Der Abstand zwischen Liquidations- und Bankrottpreis ist ihr Sicherheitspuffer: schliesst sie die Position besser als zum Bankrottpreis, fliesst der Rest in den Versicherungsfonds. Schliesst sie schlechter — bei einem Lücken-Sturz —, zahlt der Fonds drauf. Für einen selbst heisst das: bei einer Liquidation ist meist die gesamte Positionsmargin weg, nicht nur der rechnerische Verlust.',
    },
    {
        schluessel: 'versicherungsfonds', kategorie: 'derivate', niveau: 2,
        frage: 'Wozu dient der Versicherungsfonds einer Börse?',
        antwort: 'Er deckt Liquidationen, die schlechter als zum Bankrottpreis geschlossen wurden. Gespeist wird er aus Liquidationen, die besser liefen als nötig. Ist er leer, greift Auto-Deleveraging.',
        erklaerung: 'Der Fonds ist der Grund, warum ein Konto normalerweise nicht ins Minus rutschen kann. Sein Stand ist öffentlich einsehbar und ein Frühwarnzeichen: schrumpft er in einer turbulenten Phase schnell, steigt die Wahrscheinlichkeit von Auto-Deleveraging. Ein sehr grosser Fonds ist umgekehrt kein reines Gütesiegel — er wächst aus Liquidationen, wurde also von liquidierten Konten bezahlt.',
    },
    {
        schluessel: 'adl', kategorie: 'derivate', niveau: 2,
        frage: 'Was ist Auto-Deleveraging (ADL)?',
        antwort: 'Reicht der Versicherungsfonds für eine gescheiterte Liquidation nicht, schliesst die Börse zwangsweise GEWINNENDE Gegenpositionen. Zuerst trifft es hohe Rendite bei hohem Hebel — man kann also aus einem laufenden Gewinntrade geworfen werden.',
        erklaerung: 'Die Reihenfolge ist der unangenehme Teil: sortiert wird nach Rendite mal Hebel, es trifft also zuerst die erfolgreichsten gehebelten Gegenpositionen. Man kann aus einem laufenden Gewinntrade geworfen werden, ohne etwas falsch gemacht zu haben — ausgerechnet in dem Moment, in dem er am besten läuft. Börsen zeigen die eigene ADL-Position meist als Ampel an; wer weit oben steht, sollte in extremen Phasen Hebel oder Grösse zurücknehmen.',
    },
    {
        schluessel: 'hebelstufen', kategorie: 'derivate', niveau: 2,
        frage: 'Warum sinkt der maximal mögliche Hebel mit wachsender Position?',
        antwort: 'Börsen staffeln die Wartungsmarge nach Positionsgrösse (Risk Limits): je grösser die Position, desto höher die geforderte Marge und desto kleiner der erlaubte Hebel. Eine grosse Position ist im Notfall schlechter glattzustellen.',
        erklaerung: 'Börsen staffeln das in Risk-Limit-Stufen: bis Positionsgrösse X gilt Wartungssatz A und Hebel bis 100×, darüber Satz B und weniger Hebel, und so weiter. Der Grund ist Marktrisiko — eine grosse Position lässt sich im Notfall nicht ohne Slippage glattstellen. Zwei Folgen für die Praxis: der Liquidationspreis rückt beim Aufstocken näher, obwohl sich am Einstieg nichts geändert hat, und der maximale Hebel der Werbung gilt nur für kleine Positionen.',
    },
    {
        schluessel: 'linearInvers', kategorie: 'derivate', niveau: 2,
        frage: 'Was unterscheidet lineare (USDT-besicherte) von inversen (Coin-besicherten) Kontrakten?',
        antwort: 'Linear: Sicherheit und Ergebnis in USDT, die Rechnung ist geradlinig. Invers: beides im Coin selbst — die Sicherheit verliert also mit fallendem Kurs zusätzlich an Wert, was einen Long doppelt trifft.',
        erklaerung: 'Beim inversen Kontrakt ist die Sicherheit der Coin selbst. Fällt der Kurs, verliert die Position — und gleichzeitig verliert die hinterlegte Sicherheit an Wert. Ein Long trifft es also doppelt, seine Verlustkurve ist gekrümmt statt gerade. Umgekehrt ist ein inverser Short für jemanden, der den Coin ohnehin hält, ein natürliches Gegengewicht. Lineare Kontrakte sind heute der Normalfall, gerade weil die Rechnung geradlinig bleibt.',
    },
    {
        schluessel: 'fundingTakt', kategorie: 'derivate', niveau: 2,
        frage: 'Warum ist eine Funding-Rate ohne ihren Takt nicht vergleichbar?',
        antwort: '0,01 % alle 8 Stunden sind rund 11 % im Jahr, dieselben 0,01 % alle 4 Stunden gut 22 %. Erst auf eine Jahresrate umgerechnet lassen sich zwei Coins nebeneinanderlegen.',
        erklaerung: 'Nachgerechnet: 0,01 % alle 8 Stunden sind dreimal täglich, also 0,01 × 3 × 365 ≈ 11 % im Jahr. Derselbe Wert alle 4 Stunden sind sechsmal täglich, also rund 22 %. Ohne Takt ist eine Funding-Zahl damit schlicht nicht vergleichbar — und die Takte sind uneinheitlich, viele grosse Perpetuals zahlen vierstündlich. Deshalb sortiert das Journal Funding grundsätzlich nach der Jahresrate und schreibt die Einheit an jede Zahl.',
    },
    {
        schluessel: 'oiVsVolumen', kategorie: 'derivate', niveau: 2,
        frage: 'Was unterscheidet Open Interest von Handelsvolumen?',
        antwort: 'Volumen zählt, wie viel in einem Zeitraum umgeschlagen wurde — auch wenn dieselbe Position zehnmal die Hände wechselt. Open Interest zählt, wie viele Kontrakte am Ende offen STEHEN. Viel Volumen bei gleichem OI heisst: nur umverteilt.',
        erklaerung: 'Ein Beispiel macht den Unterschied klar: Wechseln 1000 Kontrakte zehnmal den Besitzer, ist das Volumen 10.000, das Open Interest bleibt 1000. Volumen misst Aktivität, OI misst Engagement. Deshalb ist ein Ausbruch mit viel Volumen UND steigendem OI etwas anderes als einer mit viel Volumen bei fallendem OI — im ersten Fall kommt neues Geld, im zweiten wird eine alte Position abgebaut.',
    },
    {
        schluessel: 'postReduceOnly', kategorie: 'derivate', niveau: 2,
        frage: 'Was bewirken Post-Only und Reduce-Only?',
        antwort: 'Post-Only storniert die Order, falls sie sofort ausgeführt würde — sie erzwingt den Maker-Status und damit die niedrigere Gebühr. Reduce-Only kann eine Position nur verkleinern und niemals versehentlich eine Gegenposition eröffnen.',
        erklaerung: 'Beide sind Schutzschalter, keine Orderarten. Post-Only lohnt sich, weil die Maker-Gebühr oft nur ein Bruchteil der Taker-Gebühr ist — bei vielen Trades ist das der Unterschied zwischen rentabel und nicht. Reduce-Only verhindert den teuersten Bedienfehler überhaupt: eine zu grosse Schliessorder, die die Position nicht nur schliesst, sondern in die Gegenrichtung dreht. Jede Stopp- und Zielorder gehört deshalb auf Reduce-Only.',
    },
    {
        schluessel: 'callPut', kategorie: 'derivate', niveau: 2,
        frage: 'Was ist eine Call- und was eine Put-Option?',
        antwort: 'Ein Call ist das Recht, zu einem festgelegten Preis zu kaufen, ein Put das Recht zu verkaufen — jeweils ohne Pflicht. Der Käufer zahlt dafür eine Prämie und kann nur diese verlieren; der Verkäufer theoretisch weit mehr.',
        erklaerung: 'Das Ungleichgewicht ist der Kern: der Käufer riskiert nur die Prämie, der Verkäufer haftet bei einem Call theoretisch unbegrenzt. Wer Optionen verkauft, sammelt daher viele kleine Prämien und riskiert seltene grosse Verluste — ein Profil, das lange gut aussieht und dann auf einen Schlag nicht mehr. Zusätzlich verliert eine Option mit jedem Tag an Zeitwert: der Käufer braucht die richtige Richtung UND das richtige Tempo.',
    },
    {
        schluessel: 'iocFok', kategorie: 'derivate', niveau: 3,
        frage: 'Was heissen IOC und FOK bei einer Order?',
        antwort: 'IOC (Immediate or Cancel): sofort ausführen, was geht, der Rest wird gestrichen. FOK (Fill or Kill): entweder sofort vollständig oder gar nicht. Beides begrenzt, wie lange eine Order im Buch sichtbar liegt.',
        erklaerung: 'Beide begrenzen die Lebensdauer einer Order auf einen Augenblick. Der Zweck ist meist nicht Eile, sondern Verdeckung: eine grosse Limit-Order, die sichtbar im Buch liegt, verrät die eigene Absicht und lädt dazu ein, davor zu handeln. FOK ist zusätzlich ein Test — geht die Order nicht vollständig durch, war die Liquidität nicht da, und man erfährt das, ohne eine Teilposition zu halten.',
    },
    {
        schluessel: 'greeks', kategorie: 'derivate', niveau: 3,
        frage: 'Was messen Delta, Gamma, Theta und Vega bei Optionen?',
        antwort: 'Delta: Preisänderung je Einheit Kursbewegung. Gamma: wie schnell sich Delta dabei selbst ändert. Theta: täglicher Zeitwertverlust. Vega: Reaktion auf einen Prozentpunkt mehr implizite Volatilität.',
        erklaerung: 'In der Praxis hängen sie zusammen. Gamma ist der Grund, warum Delta nicht stabil bleibt und eine neutrale Position laufend nachjustiert werden muss. Theta ist der Preis dafür, dass man auf etwas wartet — er beschleunigt zum Verfall hin. Vega erklärt, warum eine Option bei richtiger Richtung trotzdem verlieren kann: fällt die implizite Volatilität nach einem Ereignis, frisst das den Richtungsgewinn auf.',
    },
    {
        schluessel: 'maxPain', kategorie: 'derivate', niveau: 3,
        frage: 'Was ist der Max-Pain-Preis vor einem Optionsverfall?',
        antwort: 'Der Kurs, bei dem in Summe die meisten Optionen wertlos verfallen — der grösste Schaden für die Käuferseite. Rund um grosse Verfallstermine wirkt er wie ein schwacher Magnet, mehr nicht.',
        erklaerung: 'Die Theorie unterstellt, dass Optionsverkäufer den Kurs gezielt in diese Zone steuern — beweisen lässt sich das nicht. Was messbar wirkt, ist die Absicherung: rund um grosse Verfallstermine halten die Delta-Anpassungen der Verkäufer den Kurs eher in dem Bereich, wo die meisten offenen Kontrakte liegen. Der Effekt ist schwach, gilt nur nahe am Verfall, und ausserhalb dieses Fensters ist Max Pain schlicht ohne Bedeutung.',
    },
    {
        schluessel: 'skew', kategorie: 'derivate', niveau: 3,
        frage: 'Was zeigt der 25-Delta-Skew?',
        antwort: 'Wie viel teurer Absicherung nach unten (Puts) gerade ist als Spekulation nach oben (Calls), gemessen an der impliziten Volatilität. Positiver Skew heisst: der Markt zahlt einen Aufpreis für Schutz.',
        erklaerung: 'Verglichen wird die implizite Volatilität von Puts und Calls, die gleich weit aus dem Geld liegen (25 Delta). Positiver Skew heisst, der Markt zahlt einen Aufpreis für Absicherung nach unten — typisch in nervösen Phasen. Bei Krypto kommt es vor, dass der Skew ins Negative dreht: dann ist die Spekulation nach oben teurer als der Schutz nach unten, ein Zeichen von Euphorie. Der Skew misst Stimmung im Preis, nicht im Text.',
    },

    // ── Sentiment / Makro (Ergänzung) ────────────────────────
    {
        schluessel: 'risikoregime', kategorie: 'sentiment', niveau: 2,
        frage: 'Was heisst Risk-on und Risk-off?',
        antwort: 'Zwei Marktzustände: Risk-on — Kapital fliesst in Riskantes (Tech-Aktien, Krypto). Risk-off — es flieht in Anleihen, Dollar, Gold. In Risk-off-Phasen fallen Coins gemeinsam, unabhängig von ihrer Qualität.',
        erklaerung: 'Der Nutzen liegt darin, zu erkennen, wann die eigene Coin-Auswahl gar nicht zählt. In Risk-off-Phasen fallen Coins gemeinsam, unabhängig von Qualität, Nachrichtenlage oder Chart — die Streuung über mehrere Positionen ist dann eine Illusion. Ablesbar ist das Regime an den klassischen Märkten: Anleiherenditen, Dollar-Index, VIX. Krypto ist darin das Ende der Risikokette und reagiert entsprechend heftig.',
    },
    {
        schluessel: 'realzins', kategorie: 'sentiment', niveau: 2,
        frage: 'Warum drücken steigende Realzinsen auf Krypto?',
        antwort: 'Weil risikofreie Anlagen dann echten Ertrag abwerfen und ein Vermögenswert ohne Zins oder Dividende im Vergleich unattraktiver wird. Zusätzlich verteuert sich Fremdkapital, was den Hebel im ganzen Markt zurückdrängt.',
        erklaerung: 'Realzins ist Nominalzins minus erwartete Inflation. Steigt er, wird die Alternative attraktiv: risikofreie Anleihen werfen echten Ertrag ab, während ein Vermögenswert ohne Zins oder Cashflow nur über Kurssteigerung verdienen kann. Dazu kommt der Hebel-Kanal — teureres Fremdkapital drückt die Bereitschaft, gehebelt zu spekulieren. Der Zusammenhang ist gut belegt, aber nicht taggenau: er wirkt über Wochen, nicht über Stunden.',
    },
    {
        schluessel: 'fomc', kategorie: 'sentiment', niveau: 2,
        frage: 'Warum bewegt eine FOMC-Sitzung den Kryptomarkt?',
        antwort: 'Sie legt den US-Leitzins fest und damit Risikoappetit, Dollarstärke und Liquidität. Bewegung entsteht dabei meist nicht aus dem Beschluss selbst, sondern aus der Abweichung von dem, was schon eingepreist war.',
        erklaerung: 'Der entscheidende Satz ist der zweite: gehandelt wird die Abweichung von der Erwartung, nicht der Beschluss. Ein Zinsschritt, den der Markt zu 95 % eingepreist hat, bewegt kaum; die Bewegung kommt aus dem Ausblick und der Pressekonferenz. Für die Praxis heisst das vor allem, das Zeitfenster zu kennen: in den Minuten danach reissen Spreads auf, Stopps werden zu schlechten Preisen ausgeführt, und Positionsgrösse ist wichtiger als Richtung.',
    },
    {
        schluessel: 'cpi', kategorie: 'sentiment', niveau: 2,
        frage: 'Warum ist der CPI-Termin für einen Krypto-Trader relevant?',
        antwort: 'Die Inflationszahl entscheidet mit, ob die Notenbank lockert oder strafft. Der Markt handelt die Erwartung vorab; in den Minuten nach der Zahl wird die Abweichung gehandelt — Spreads gehen dabei kurz weit auf.',
        erklaerung: 'Die Zahl wirkt indirekt: sie verändert die Zinserwartung, und die verändert den Risikoappetit. Wie beim FOMC zählt nur die Überraschung gegenüber der Konsensschätzung. Der Termin ist immer 14:30 Uhr Schweizer Zeit und damit planbar — man kann die Position vorher verkleinern. Der Kernindex ohne Energie und Nahrungsmittel bewegt die Märkte dabei meist stärker als die Gesamtzahl, weil er als aussagekräftiger für den Trend gilt.',
    },
    {
        schluessel: 'vix', kategorie: 'sentiment', niveau: 2,
        frage: 'Was ist der VIX und was hat er mit Krypto zu tun?',
        antwort: 'Die vom Optionsmarkt erwartete Schwankung des S&P 500, oft „Angstbarometer" genannt. Springt er, ziehen sich Anleger meist aus allem Riskanten zurück — Krypto eingeschlossen, ganz ohne Krypto-Nachricht.',
        erklaerung: 'Der VIX misst die aus S&P-500-Optionen abgeleitete erwartete Schwankung der nächsten 30 Tage. Für Krypto ist er nicht ursächlich, sondern ein Anzeiger des Risikoregimes: springt er, ziehen sich Anleger breit aus Riskantem zurück, und Krypto gehört dazu. Werte unter 15 gelten als ruhig, über 30 als angespannt. Der Zusammenhang gilt für Sprünge, nicht für das absolute Niveau.',
    },
    {
        schluessel: 'etfStruktur', kategorie: 'sentiment', niveau: 2,
        frage: 'Was unterscheidet einen Spot-ETF von einem Futures-ETF?',
        antwort: 'Der Spot-ETF hält die Coins selbst, seine Zuflüsse sind echte Käufe am Markt. Ein Futures-ETF hält Terminkontrakte und muss sie laufend rollen — das kostet in Contango Rendite, ohne dass je ein Coin gekauft wird.',
        erklaerung: 'Der Unterschied ist für die Kursdeutung entscheidend. Ein Spot-ETF muss für jeden Zufluss tatsächlich Coins kaufen — die Zuflusszahl ist echte Nachfrage. Ein Futures-ETF kauft nie einen Coin; er hält Kontrakte und muss sie vor Verfall in den nächsten Monat rollen. Steht der spätere Kontrakt höher (Contango), kostet jedes Rollen Rendite, weshalb solche ETFs den Kurs über Jahre spürbar unterlaufen.',
    },

    // ── Risiko & Handwerk (Ergänzung) ────────────────────────
    {
        schluessel: 'rMultiple', kategorie: 'risiko',
        frage: 'Was ist ein R-Multiple?',
        antwort: 'Das Ergebnis eines Trades gemessen in seinem eigenen Anfangsrisiko: 1R ist genau der Betrag, den der Stopp gekostet hätte. So werden Trades unterschiedlicher Grösse vergleichbar, ohne über Beträge zu reden.',
        erklaerung: 'Der Nutzen liegt im Vergleichbarmachen. 200 Franken Gewinn sagen nichts, solange man nicht weiss, ob 100 oder 1000 riskiert waren; 2R sagt alles. In R zu denken entkoppelt zudem die Bewertung eines Trades vom Kontostand — ein guter Trade bleibt ein guter Trade, ob man mit 1000 oder 100.000 handelt. Voraussetzung ist ein VOR dem Einstieg definierter Stopp, sonst gibt es kein R.',
    },
    {
        schluessel: 'overtrading', kategorie: 'risiko',
        frage: 'Was ist Overtrading und Revenge-Trading?',
        antwort: 'Overtrading: mehr Trades, als der Plan hergibt — meist aus Langeweile oder Angst, etwas zu verpassen. Revenge-Trading: nach einem Verlust sofort grösser wieder rein. Beides erhöht Frequenz und Grösse genau dann, wenn das Urteil am schlechtesten ist.',
        erklaerung: 'Beides ist dasselbe Muster: die Positionsgrösse oder die Frequenz steigt genau dann, wenn das Urteilsvermögen sinkt. Der Schaden ist doppelt — mehr Trades bedeuten mehr Gebühren, und die zusätzlichen Trades sind im Schnitt die schlechteren. Deshalb wirken mechanische Grenzen besser als Vorsätze: eine maximale Trade-Zahl und ein maximaler Tagesverlust, beide VOR der Sitzung festgelegt, wenn man noch ruhig ist.',
    },
    {
        schluessel: 'prozessErgebnis', kategorie: 'risiko',
        frage: 'Warum bewertet man den Prozess und nicht das Ergebnis eines einzelnen Trades?',
        antwort: 'Weil ein guter Trade verlieren und ein schlechter gewinnen kann. Aus einem einzelnen Ausgang zu lernen heisst, Zufall zur Regel zu machen — erst über viele Trades trennt sich Vorteil von Glück.',
        erklaerung: 'Der Kern ist die Rolle des Zufalls. Bei 50 % Trefferquote ist eine Serie von fünf Verlierern nichts Ungewöhnliches — sie tritt regelmässig auf, ohne dass sich an der Strategie etwas geändert hätte. Wer daraus lernt, lernt Rauschen. Praktisch heisst das, den Trade danach zu bewerten, ob er dem Plan entsprach, und die Ergebnisstatistik getrennt über viele Trades zu führen.',
    },
    {
        schluessel: 'gebuehrenlast', kategorie: 'risiko',
        frage: 'Warum frisst häufiges Handeln den Vorteil auf?',
        antwort: 'Kosten fallen je Trade an, nicht je Gewinn: Gebühr mal Frequenz. Bei einem Scalp mit kleinem Ziel kann der Rundlauf einen statistisch gültigen Vorteil vollständig aufzehren, ohne dass an der Strategie etwas falsch wäre.',
        erklaerung: 'Nachgerechnet: 0,1 % Rundlauf bei einem Trade pro Tag sind rund 25 % im Jahr, die die Strategie erst einspielen muss. Bei fünf Trades pro Tag über 100 %. Das trifft besonders kurzfristige Ansätze mit kleinen Zielen, denn die Kosten sind unabhängig von der Zielgrösse. Zwei Hebel dagegen: Maker statt Taker handeln, und die Zahl der Trades senken statt die Trefferquote zu jagen.',
    },
    {
        schluessel: 'breakEvenQuote', kategorie: 'risiko', niveau: 2,
        frage: 'Welche Trefferquote braucht ein CRV von 2, um bei null herauszukommen?',
        antwort: 'Rund 33,3 % — allgemein 1 geteilt durch (1 + CRV), vor Kosten. Bei einem CRV von 1 sind es 50 %, bei 3 nur noch 25 %. Gebühren und Slippage verschieben die Schwelle nach oben.',
        erklaerung: 'Die Formel 1/(1+CRV) leitet sich direkt aus dem Erwartungswert her: bei Gewinn b und Verlust 1 ist p × b = (1−p) × 1 genau bei p = 1/(1+b). Praktisch wichtig ist die Gegenrichtung: ein hohes CRV senkt die nötige Trefferquote, aber weiter entfernte Ziele werden auch seltener erreicht. Beides gemeinsam zu verbessern ist selten möglich — die Frage ist, welche Kombination zur eigenen Strategie passt.',
    },
    {
        schluessel: 'riskOfRuin', kategorie: 'risiko', niveau: 2,
        frage: 'Was ist das Risk of Ruin?',
        antwort: 'Die Wahrscheinlichkeit, das Konto zu sprengen, bevor sich der statistische Vorteil auszahlen kann. Sie hängt weniger vom Vorteil ab als vom Einsatz je Trade — bei genug Versuchen kommt jede Verlustserie irgendwann.',
        erklaerung: 'Der Kern ist unintuitiv: selbst eine profitable Strategie sprengt das Konto sicher, wenn der Einsatz je Trade zu gross ist. Bei 50 % Trefferquote kommt eine Serie von zehn Verlierern in einigen hundert Trades verlässlich vor — bei 10 % Einsatz je Trade ist das Konto dann praktisch weg, bei 1 % ein normaler Drawdown. Deshalb ist der Einsatz je Trade der wichtigere Hebel als die Trefferquote.',
    },
    {
        schluessel: 'stichprobe', kategorie: 'risiko', niveau: 2,
        frage: 'Ab wie vielen Trades ist ein Vorteil belegt?',
        antwort: 'Deutlich mehr als die zwanzig, nach denen die meisten schon urteilen — je nach Trefferquote und Streuung eher im dreistelligen Bereich. Eine Serie von zehn Gewinnern ist bei 50 % Trefferquote nichts Aussergewöhnliches.',
        erklaerung: 'Grössenordnung: um einen Vorteil von wenigen Prozentpunkten von Zufall zu unterscheiden, braucht es je nach Streuung hunderte Trades. Anschaulich: bei 50 % Trefferquote tritt eine Serie von zehn Gewinnern in 1000 Trades mehrfach auf — sie ist erwartbar, nicht bemerkenswert. Daraus folgt für das Journal: eine Strategie nach zwanzig Trades zu ändern, ist fast immer eine Reaktion auf Rauschen.',
    },
    {
        schluessel: 'korrelationsrisiko', kategorie: 'risiko', niveau: 2,
        frage: 'Warum sind fünf Altcoin-Longs oft nur eine einzige Position?',
        antwort: 'Weil Altcoins in Stressphasen nahezu im Gleichschritt fallen. Fünf Positionen zu je 1 % Risiko verhalten sich dann wie eine mit 5 % — die Streuung existierte nur auf dem Papier.',
        erklaerung: 'Rechnerisch: bei perfekter Korrelation addieren sich die Risiken einfach, fünf Positionen zu 1 % ergeben 5 %. Nur bei völlig unabhängigen Positionen wüchse das Risiko mit der Wurzel, also auf rund 2,2 %. Altcoins liegen in ruhigen Phasen dazwischen und in Stressphasen nahe an der ersten Zahl — die Streuung verschwindet genau dann, wenn man sie bräuchte. Deshalb zählt man korrelierte Positionen sinnvollerweise als eine.',
    },
    {
        schluessel: 'portfolioHitze', kategorie: 'risiko', niveau: 2,
        frage: 'Was ist Portfolio-Heat?',
        antwort: 'Die Summe des Risikos aller gleichzeitig offenen Positionen — also was passiert, wenn heute JEDER Stopp ausgelöst wird. Das ist die Zahl, die begrenzt gehört, nicht das Risiko des einzelnen Trades.',
        erklaerung: 'Die Frage lautet: wenn heute jeder Stopp ausgelöst wird, wie viel Prozent des Kontos sind weg? Diese Zahl gehört gedeckelt, üblich sind Werte um 5 %. Zwei Feinheiten: Positionen, deren Stopp bereits im Gewinn steht, tragen nichts mehr zur Hitze bei und schaffen Platz für neue; und korrelierte Positionen zählen nur dann ehrlich, wenn man sie als eine behandelt.',
    },
    {
        schluessel: 'ueberanpassung', kategorie: 'risiko', niveau: 2,
        frage: 'Was ist Überanpassung (Overfitting) beim Backtest?',
        antwort: 'Die Strategie hat das Rauschen der Testdaten gelernt statt eines Musters. Verdächtig sind viele feinjustierte Parameter und eine Kurve, die genau an einem Zeitraum glänzt — Rauschen wiederholt sich definitionsgemäss nicht.',
        erklaerung: 'Warnzeichen, die sich prüfen lassen: viele Parameter im Verhältnis zur Zahl der Trades, eine Ergebniskurve, die bei minimaler Parameteränderung einbricht, und Regeln, die auf einzelne Ereignisse zugeschnitten sind. Ein robuster Parameter zeigt ein breites Plateau guter Werte, kein einzelnes Maximum. Die härteste Gegenprobe bleibt ein Zeitraum, den die Strategie beim Entwickeln nie gesehen hat.',
    },
    {
        schluessel: 'lookAhead', kategorie: 'risiko', niveau: 2,
        frage: 'Was ist Look-ahead-Bias?',
        antwort: 'Der Backtest benutzt eine Information, die zum Entscheidungszeitpunkt noch nicht vorlag — etwa den Schlusskurs jener Kerze, in der eingestiegen wird. Das Ergebnis sieht hervorragend aus und ist nicht handelbar.',
        erklaerung: 'Die häufigsten Quellen sind subtil: der Schlusskurs der Einstiegskerze, ein Indikator, der die ganze Kerze braucht, aber schon zu Beginn gelesen wird, oder nachträglich korrigierte Daten. Erkennbar ist der Fehler an unrealistisch glatten Ergebniskurven und sehr hohen Trefferquoten. Die Faustregel: eine Entscheidung darf nur Daten benutzen, die zum Zeitpunkt der Entscheidung ABGESCHLOSSEN vorlagen.',
    },
    {
        schluessel: 'survivorship', kategorie: 'risiko', niveau: 2,
        frage: 'Was ist Survivorship-Bias?',
        antwort: 'Getestet wird nur gegen das, was heute noch existiert. Delistete Coins und tote Projekte fehlen — die Strategie sieht besser aus, weil ihre schlimmsten Fälle aus den Daten verschwunden sind.',
        erklaerung: 'Bei Krypto wiegt das besonders schwer, weil die Sterblichkeit hoch ist: ein grosser Teil der vor Jahren handelbaren Coins existiert nicht mehr oder ist delistet. Eine Strategie, die nur gegen die heutige Coin-Liste getestet wird, hat die Totalausfälle nie gesehen. Abhilfe ist eine Datenquelle mit historischer Zusammensetzung — und wo die fehlt, gehört das Ergebnis als Obergrenze gelesen, nicht als Erwartung.',
    },
    {
        schluessel: 'outOfSample', kategorie: 'risiko', niveau: 2,
        frage: 'Wozu dient ein Out-of-Sample- bzw. Walk-Forward-Test?',
        antwort: 'Optimiert wird auf einem Zeitraum, gemessen auf dem nächsten, den die Strategie nie gesehen hat — und das rollierend weiter. Bricht die Leistung dabei ein, war der schöne Backtest blosse Anpassung an die Vergangenheit.',
        erklaerung: 'Walk-Forward heisst konkret: auf Zeitraum 1 optimieren, auf Zeitraum 2 messen, dann das Fenster weiterschieben und wiederholen. Das ahmt nach, was man real täte — man kennt die Zukunft nie. Die entscheidende Disziplin liegt darin, den Testzeitraum nur EINMAL zu benutzen: wer nach einem schlechten Ergebnis nachjustiert und erneut testet, hat ihn zum Optimierungszeitraum gemacht und misst wieder sich selbst.',
    },
    {
        schluessel: 'monteCarlo', kategorie: 'risiko', niveau: 3,
        frage: 'Was bringt eine Monte-Carlo-Simulation der eigenen Trades?',
        antwort: 'Die vorhandenen Trades werden tausendfach in zufälliger Reihenfolge neu durchgespielt. So sieht man, welche Verlustserie und welcher Drawdown bei derselben Strategie ebenfalls möglich gewesen wären — die tatsächliche Reihenfolge war nur eine von vielen.',
        erklaerung: 'Konkret entsteht daraus eine Verteilung statt einer Zahl: nicht „der Drawdown war 18 %", sondern „in 95 % der Reihenfolgen lag er unter 31 %". Genau diese zweite Zahl entscheidet, ob die Strategie tragbar ist. Eine Einschränkung: das Verfahren mischt nur die vorhandenen Trades neu und kann keine schlechteren Marktphasen erfinden, als bereits in den Daten stecken.',
    },
    {
        schluessel: 'ulcer', kategorie: 'risiko', niveau: 3,
        frage: 'Was misst der Ulcer Index?',
        antwort: 'Tiefe UND Dauer der Rückschläge zusammen — er quadriert die prozentualen Abstände zum letzten Hoch über die ganze Zeitreihe. Anders als der maximale Drawdown, der nur den schlimmsten Punkt kennt, zählt hier jeder Tag unter dem Hoch mit.',
        erklaerung: 'Gerechnet wird die Wurzel aus dem Mittel der quadrierten prozentualen Abstände zum bisherigen Hoch. Das Quadrieren gewichtet TIEFE stärker: 20 % über einen Monat ergeben 400, 5 % über zwölf Monate nur 300 — der kurze tiefe Einbruch wiegt hier also mehr. Der eigentliche Unterschied zum Max-Drawdown ist deshalb nicht die Betonung der Dauer, sondern dass Dauer überhaupt eingeht, statt nur den einen schlimmsten Punkt zu messen.',
    },

    // ── Markt (Ergänzung) ────────────────────────────────────
    {
        schluessel: 'cexDex', kategorie: 'markt',
        frage: 'Was unterscheidet eine zentrale von einer dezentralen Börse?',
        antwort: 'Auf einer CEX verwahrt die Börse die Coins und führt ein klassisches Orderbuch. Auf einer DEX handelt man direkt aus der eigenen Wallet gegen einen Liquiditätspool — ohne Gegenparteirisiko der Börse, dafür mit Vertrags- und Netzwerkrisiko.',
        erklaerung: 'Der Kernunterschied ist, wer die Schlüssel hält. Auf der CEX hält die Börse sie, man hat eine Forderung — dafür gibt es tiefe Bücher, Hebel und schnelle Ausführung. Auf der DEX handelt man aus der eigenen Wallet, dafür gegen einen Pool statt gegen ein Buch: der Preis entsteht aus einer Formel, jede Transaktion ist öffentlich sichtbar, bevor sie ausgeführt wird, und der Vertrag selbst kann Fehler haben.',
    },
    {
        schluessel: 'amm', kategorie: 'markt', niveau: 2,
        frage: 'Wie bildet ein Automated Market Maker (AMM) seinen Preis?',
        antwort: 'Nicht über Angebote im Buch, sondern über eine Formel auf den Beständen eines Liquiditätspools. Je grösser ein Handel im Verhältnis zum Pool, desto stärker verschiebt er den Preis selbst — genau das ist dort die Slippage.',
        erklaerung: 'Die verbreitetste Formel ist x × y = k: das Produkt der beiden Poolbestände bleibt konstant. Daraus folgt, dass der Preis sich mit jedem Handel verschiebt, und zwar überproportional zur Handelsgrösse relativ zum Pool. Ein Handel über 1 % des Pools kostet grob 1 % Slippage, über 10 % schon deutlich mehr. Die Poolgrösse ist deshalb bei einer DEX die wichtigere Zahl als das Handelsvolumen.',
    },
    {
        schluessel: 'impermanentLoss', kategorie: 'markt', niveau: 2,
        frage: 'Was ist Impermanent Loss?',
        antwort: 'Wer Liquidität bereitstellt, hält am Ende mehr vom gefallenen und weniger vom gestiegenen Token — das Ergebnis liegt unter dem blossen Halten. „Impermanent" heisst nur: solange nicht abgezogen wird, kann es sich bei zurückkehrenden Kursen wieder auflösen.',
        erklaerung: 'Der Grund ist die Formel: Arbitrageure gleichen den Poolpreis an den Markt an, indem sie den steigenden Token entnehmen und den fallenden hineingeben. Der Anbieter hält am Ende automatisch mehr vom schlechteren Vermögenswert. Grössenordnung: bei einer Kursverdopplung eines der beiden Token beträgt der Nachteil gegenüber blossem Halten rund 5,7 %. Die Gebühreneinnahmen müssen das erst wieder ausgleichen.',
    },
    {
        schluessel: 'tvl', kategorie: 'markt', niveau: 2,
        frage: 'Was sagt Total Value Locked (TVL) aus — und was nicht?',
        antwort: 'Wie viel Kapital gerade in einem Protokoll liegt. Gemessen wird in Dollar, also steigt der Wert auch dann, wenn nur die hinterlegten Token teurer werden — ohne einen einzigen neuen Nutzer.',
        erklaerung: 'Die Falle ist die Einheit. Steigt der Kurs der hinterlegten Token um 50 %, steigt der TVL um 50 % — ohne einen einzigen neuen Nutzer. Aussagekräftiger ist der TVL in Token gerechnet oder das Verhältnis von TVL zu Protokolleinnahmen. Zweitens wird derselbe Wert bei verschachtelten Protokollen mehrfach gezählt, wenn ein Beleg-Token erneut hinterlegt wird.',
    },
    {
        schluessel: 'depeg', kategorie: 'markt', niveau: 2,
        frage: 'Was ist ein Stablecoin-Depeg?',
        antwort: 'Der Stablecoin verliert seine Bindung und handelt spürbar unter (oder über) einem Dollar. Für einen Futures-Händler doppelt heikel: die Sicherheit auf dem Konto verliert selbst an Wert, während die Kurse verrücktspielen.',
        erklaerung: 'Für einen Futures-Händler ist das ein doppeltes Problem: die Sicherheit auf dem Konto ist meist in genau diesem Stablecoin, verliert also selbst an Wert, während die Positionen bewegt werden. Zusätzlich verzerren sich die Kurse — ein Coin kann in USDT steigen und in Dollar gerechnet fallen. Wichtig ist die Unterscheidung: ein besicherter Stablecoin kann kurzzeitig abweichen und zurückkehren, ein algorithmischer kann in einer Spirale enden.',
    },
    {
        schluessel: 'gas', kategorie: 'markt', niveau: 2,
        frage: 'Was sind Gas-Gebühren?',
        antwort: 'Der Preis für Rechenzeit im Netzwerk, fällig unabhängig vom Erfolg der Transaktion. Bei Andrang steigt er, weil um Blockplatz geboten wird — eine fehlgeschlagene Transaktion kostet trotzdem.',
        erklaerung: 'Die Gebühr bezahlt Rechenaufwand, nicht Erfolg — eine fehlgeschlagene Transaktion kostet trotzdem, weil die Rechenarbeit geleistet wurde. Der Preis entsteht aus einer Auktion um begrenzten Blockplatz und springt bei Andrang um Grössenordnungen. Für kleine Beträge kann die Gebühr den Handel unwirtschaftlich machen: 30 USD Gas auf einen Tausch über 100 USD sind 30 % Kosten.',
    },
    {
        schluessel: 'layer2', kategorie: 'markt', niveau: 2,
        frage: 'Was ist ein Layer 2?',
        antwort: 'Ein Netzwerk, das Transaktionen abseits der Hauptkette bündelt und nur das Ergebnis dort verankert. Das senkt Gebühren, verlagert aber Vertrauen auf die Brücke und den Betreiber des Sequencers.',
        erklaerung: 'Das Verfahren: Transaktionen werden ausserhalb der Hauptkette gebündelt und nur ein zusammengefasster Nachweis dort verankert. Die Ersparnis ist real, das Vertrauen verschiebt sich aber: die Brücke hält die Mittel, und der Sequencer entscheidet über die Reihenfolge — bei den meisten L2 ist er zentral betrieben und kann anhalten. Optimistische Rollups haben zusätzlich eine mehrtägige Auszahlungsfrist.',
    },
    {
        schluessel: 'staking', kategorie: 'markt', niveau: 2,
        frage: 'Was ist Staking und was ist Liquid Staking?',
        antwort: 'Staking: Coins werden zur Netzwerksicherung hinterlegt und verzinsen sich, sind dabei aber gebunden. Liquid Staking gibt dafür einen handelbaren Beleg-Token aus — der seinerseits vom Basiswert abweichen kann.',
        erklaerung: 'Die Rendite ist keine Zinszahlung, sondern überwiegend neu ausgegebene Token — sie verwässert also alle anderen Halter. In Coin gerechnet wächst der Bestand, in Dollar nicht zwingend. Beim Liquid Staking kommt ein zweites Risiko dazu: der Beleg-Token wird gehandelt und kann vom Basiswert abweichen, was in Stressphasen zu Abschlägen führt, gerade wenn man verkaufen möchte.',
    },
    {
        schluessel: 'airdrop', kategorie: 'markt', niveau: 2,
        frage: 'Was ist ein Airdrop und warum drückt er oft den Kurs?',
        antwort: 'Kostenlose Tokenverteilung an frühere Nutzer. Ein grosser Teil der Empfänger verkauft sofort — der Handelsstart trifft deshalb häufig auf massives Angebot ohne entsprechende Nachfrage.',
        erklaerung: 'Der Mechanismus ist einfach: die Empfänger haben nichts bezahlt, jeder Preis über null ist für sie Gewinn. Am Handelsstart trifft deshalb konzentriertes Angebot auf einen Markt ohne gewachsene Nachfrage, und die ersten Stunden zeigen oft extreme Ausschläge bei dünnem Buch. Zweiter Punkt: die Startbewertung wird meist über FDV kommuniziert, während nur ein Bruchteil handelbar ist.',
    },
    {
        schluessel: 'waschhandel', kategorie: 'markt', niveau: 2,
        frage: 'Was ist Wash Trading bei Börsenvolumen?',
        antwort: 'Handel mit sich selbst, um Umsatz vorzutäuschen. Für die Coin-Auswahl heisst das: ein hoher Umsatz in einer Rangliste ist erst dann ein Liquiditätsbeleg, wenn Spread und Orderbuchtiefe dazu passen.',
        erklaerung: 'Für die Coin-Auswahl ist das der Grund, warum Umsatz allein nichts belegt. Waschhandel erzeugt Volumen, aber keine Tiefe — er kann nicht vortäuschen, dass eine grosse Order ohne Slippage ausgeführt wird. Deshalb prüft man Umsatz immer gegen Spread und Orderbuchtiefe. Auffällig sind zudem Muster: gleichmässige Volumina ohne Tagesrhythmus und ein Umsatz, der nicht zur Marktkapitalisierung passt.',
    },
    {
        schluessel: 'honeypot', kategorie: 'markt', niveau: 2,
        frage: 'Was ist ein Honeypot-Token?',
        antwort: 'Ein Token, den man kaufen, aber nicht wieder verkaufen kann — der Vertrag verbietet den Verkauf oder erhebt eine erdrückende Verkaufssteuer. Deshalb prüft man vor dem Kauf den Vertrag, nicht nur den Chart.',
        erklaerung: 'Die Sperre steckt im Vertrag: eine Verkaufsbedingung, die nur für bestimmte Adressen gilt, eine Steuer von 99 % oder eine Funktion, die der Betreiber nachträglich umschalten kann. Automatische Prüfdienste simulieren deshalb einen Verkauf, statt nur den Code zu lesen. Ihr blinder Fleck sind Verträge, die sich später ändern lassen — eine Prüfung von gestern gilt für den Vertrag von gestern.',
    },
    {
        schluessel: 'tokenBurn', kategorie: 'markt', niveau: 2,
        frage: 'Was bewirkt ein Token-Burn?',
        antwort: 'Token werden nachweislich unbrauchbar gemacht, das Angebot sinkt. Kursrelevant ist das nur, wenn die verbrannte Menge im Verhältnis zum Umlauf ins Gewicht fällt — symbolische Burns ändern nichts.',
        erklaerung: 'Massstab ist das Verhältnis zum Umlauf und zur Neuausgabe. Ein Burn von 0,1 % pro Jahr gegen 5 % neue Token ist netto Inflation, wird aber als Verknappung vermarktet. Aussagekräftig sind nur laufende, an die Nutzung gekoppelte Burns — dann ist die Menge ein Mass für die tatsächliche Verwendung des Protokolls. Einmalige Burns aus der Projektkasse ändern am handelbaren Angebot wenig.',
    },
    {
        schluessel: 'mev', kategorie: 'markt', niveau: 3,
        frage: 'Was ist MEV und was ist ein Sandwich-Angriff?',
        antwort: 'MEV ist der Wert, der sich aus der Anordnung von Transaktionen in einem Block ziehen lässt. Beim Sandwich sieht ein Bot einen anstehenden Tausch im offenen Mempool, kauft davor und verkauft danach — der schlechtere Kurs des Opfers ist sein Gewinn.',
        erklaerung: 'Der Ablauf beim Sandwich: die geplante Transaktion liegt öffentlich im Mempool, bevor sie ausgeführt wird. Ein Bot kauft davor, wodurch der Preis für das Opfer steigt, und verkauft unmittelbar danach in dessen Nachfrage hinein. Der Verlust erscheint dem Opfer als schlechte Slippage. Schutz bietet vor allem eine enge Slippage-Toleranz — dann scheitert die Transaktion lieber, als teuer ausgeführt zu werden — sowie private Transaktionswege.',
    },
    {
        schluessel: 'bridgeRisiko', kategorie: 'markt', niveau: 3,
        frage: 'Warum gelten Bridges als besonders anfällig?',
        antwort: 'Eine Bridge sperrt Coins auf der einen Kette und gibt Abbilder auf der anderen aus. Damit liegt ein einzelner grosser Topf an einem einzigen Vertrag — die grössten Diebstähle der Kryptogeschichte betrafen genau diese Konstruktion.',
        erklaerung: 'Die Konstruktion konzentriert Risiko: der gesperrte Bestand beider Ketten liegt an einem Punkt, während die Sicherheit von der schwächeren der beiden Ketten und dem Brückenvertrag abhängt. Dazu kommt, dass Brücken oft von wenigen Signaturen abhängen. Für den Handel heisst das praktisch: Mittel nicht länger als nötig in einer Brücke oder als Brücken-Abbild halten.',
    },

    // ── On-Chain (Ergänzung) ─────────────────────────────────
    {
        schluessel: 'hashrate', kategorie: 'onchain', niveau: 2,
        frage: 'Was ist die Hashrate und was sagt sie aus?',
        antwort: 'Die gesamte Rechenleistung im Bitcoin-Netzwerk. Sie misst Sicherheit und Miner-Engagement, ist aber kein Kurssignal — sie folgt dem Preis eher, als dass sie ihn führt.',
        erklaerung: 'Die Richtung des Zusammenhangs ist der Punkt: ein hoher Preis macht Mining rentabel, also wird mehr Hardware angeschlossen — die Hashrate folgt dem Preis, nicht umgekehrt. Sie ist zudem gar nicht direkt messbar, sondern wird aus der Blockfrequenz geschätzt und schwankt entsprechend stark. Als Sicherheitsmass ist sie aussagekräftig, als Kurssignal nicht.',
    },
    {
        schluessel: 'lthSth', kategorie: 'onchain', niveau: 2,
        frage: 'Was unterscheidet Langfrist- von Kurzfristhaltern (LTH/STH)?',
        antwort: 'Die übliche Grenze liegt bei 155 Tagen Haltedauer. Verkäufe von Langfristhaltern in eine Stärke hinein gelten als Verteilung; Verluste von Kurzfristhaltern eher als Kapitulation der zuletzt Eingestiegenen.',
        erklaerung: 'Die 155 Tage sind kein Naturgesetz, sondern der Punkt, ab dem Coins statistisch kaum noch bewegt werden. Der Nutzen liegt in der Rollenverteilung: Langfristhalter kaufen in Schwäche und geben in Stärke ab, Kurzfristhalter tun das Gegenteil. Deshalb ist der Anteil der von Kurzfristhaltern gehaltenen Menge ein Mass dafür, wie viel Angebot in schwachen Händen liegt — genau die Menge, die bei einem Rücksetzer auf den Markt kommt.',
    },
    {
        schluessel: 'realizedPrice', kategorie: 'onchain', niveau: 2,
        frage: 'Was ist der Realized Price?',
        antwort: 'Die Realized Cap geteilt durch die Coin-Anzahl — der durchschnittliche Einstandspreis aller Halter. Fällt der Kurs darunter, sitzt der Markt im Schnitt im Verlust; historisch ein Bodenbereich, kein Kaufknopf.',
        erklaerung: 'Weil er der Durchschnitt aller Einstandspreise ist, liegt unter ihm eine Zone, in der der Markt im Mittel im Verlust sitzt — historisch war das Bärenmarkt-Boden-Territorium. Die Betonung liegt auf „im Mittel": ein Durchschnitt sagt nichts darüber, wie viele wirklich verkaufen. Aussagekräftiger wird er getrennt nach Halterklassen, etwa als Einstandspreis der Kurzfristhalter, der oft als Unterstützung wirkt.',
    },
    {
        schluessel: 'mvrvZ', kategorie: 'onchain', niveau: 3,
        frage: 'Was unterscheidet den MVRV-Z-Score vom einfachen MVRV?',
        antwort: 'Er misst den Abstand zwischen Markt- und Realized Cap in Standardabweichungen statt als blosses Verhältnis. Dadurch bleiben die Extreme über Jahre vergleichbar: sehr hohe Werte fielen mit Zyklushochs zusammen, negative mit Böden.',
        erklaerung: 'Der Z-Score misst den Abstand zwischen Markt- und Realized Cap in Standardabweichungen der bisherigen Geschichte. Das macht ihn über Jahrzehnte vergleichbar, in denen die absoluten Zahlen um Grössenordnungen wuchsen. Der Haken steckt im Nenner: die Standardabweichung wird über die gesamte Historie gerechnet und wächst mit jedem Zyklus, weshalb spätere Hochs systematisch niedrigere Werte ergeben als frühere.',
    },
    {
        schluessel: 'puell', kategorie: 'onchain', niveau: 3,
        frage: 'Was misst das Puell Multiple?',
        antwort: 'Die täglichen Miner-Einnahmen im Verhältnis zu ihrem eigenen 365-Tage-Durchschnitt. Unter etwa 0,5 stehen Miner unter Druck (historisch nahe Böden), über etwa 4 verdienen sie ungewöhnlich gut (historisch nahe Hochs).',
        erklaerung: 'Die Kennzahl setzt die täglichen Miner-Einnahmen ins Verhältnis zu ihrem eigenen Jahresdurchschnitt und misst damit den wirtschaftlichen Druck auf die Verkäufer letzter Instanz: Miner müssen verkaufen, um Strom zu bezahlen. Bei niedrigen Werten kapitulieren die teuersten von ihnen. Ein Bruch in der Reihe sind die Halvings — die Einnahmen halbieren sich schlagartig, was den Wert ohne echte Marktbewegung nach unten zieht.',
    },
    {
        schluessel: 'mayer', kategorie: 'onchain', niveau: 3,
        frage: 'Was ist das Mayer Multiple?',
        antwort: 'Der aktuelle Kurs geteilt durch den 200-Tage-Durchschnitt. Werte ab etwa 2,4 galten Trace Mayer als Blasenbereich — eine grobe Einordnung über Jahre, nichts für eine einzelne Handelsentscheidung.',
        erklaerung: 'Der Massstab ist der 200-Tage-Durchschnitt, also der übliche Langfrist-Trendfilter. Werte um 1 heissen: der Kurs liegt auf seinem Trend. Der Schwellenwert 2,4 stammt aus einer Auswertung der frühen Bitcoin-Historie und wurde nie neu hergeleitet — spätere Zyklen erreichten deutlich niedrigere Spitzen. Als grobe Einordnung über Jahre taugt die Kennzahl, als Signal nicht.',
    },
    {
        schluessel: 'hashRibbons', kategorie: 'onchain', niveau: 3,
        frage: 'Was zeigen die Hash Ribbons?',
        antwort: 'Zwei gleitende Durchschnitte der Hashrate (30 und 60 Tage). Fällt der kurze unter den langen, kapitulieren Miner; kreuzt er zurück darüber, galt das historisch als Bodenbildungssignal.',
        erklaerung: 'Die Logik: fällt die 30-Tage- unter die 60-Tage-Hashrate, schalten Miner ab — die unrentabelsten zuerst, was Verkaufsdruck erzeugt und historisch mit Kapitulationsphasen zusammenfiel. Das Kaufsignal ist die Rückkehr, also das Ende des Verkaufsdrucks. Zwei Vorbehalte: die Zahl der Signale ist einstellig, und die Hashrate wird geschätzt, weshalb kurze Kreuzungen auch Messrauschen sein können.',
    },
    {
        schluessel: 'hodlWaves', kategorie: 'onchain', niveau: 3,
        frage: 'Was zeigen HODL Waves?',
        antwort: 'Wie sich das Angebot nach Haltedauer aufteilt. Wachsende Bänder alter Coins heissen: es wird gehortet. Schwellen die jungen Bänder an, wechselt Angebot gerade den Besitzer — meist von alten zu neuen Händen.',
        erklaerung: 'Die Darstellung teilt das gesamte Angebot nach Alter in Bänder und zeigt sie als Flächen über die Zeit. Der Erkenntniswert liegt in der Verschiebung: schwellen die jungen Bänder an, wechselt Angebot von alten zu neuen Händen — typisch für späte Zyklusphasen. Wachsen die alten Bänder, wird gehortet. Eine Verzerrung bleibt: Coins, die zwischen eigenen Wallets bewegt werden, wandern ins jüngste Band, ohne dass jemand verkauft hat.',
    },
    {
        schluessel: 'stockToFlow', kategorie: 'onchain', niveau: 3,
        frage: 'Was war das Stock-to-Flow-Modell und warum gilt es als gescheitert?',
        antwort: 'Es leitete einen Bitcoin-Preis allein aus dem Verhältnis von Bestand zu jährlichem Neuzugang ab. Ab 2021/22 lag es um Grössenordnungen daneben — ein Modell mit einer einzigen Eingangsgrösse kann Nachfrage nicht abbilden.',
        erklaerung: 'Das Modell setzte den Bestand ins Verhältnis zur jährlichen Neuproduktion und leitete daraus einen Preis ab. Der grundsätzliche Fehler steckt in der Konstruktion: eine Gleichung, die nur das Angebot kennt, kann keinen Preis bestimmen — dazu bräuchte es Nachfrage. Dass die Kurve bis 2021 passte, lag daran, dass beide über die Zeit stiegen. Ab 2022 lag sie um Grössenordnungen daneben. Ein lehrreicher Fall dafür, wie überzeugend eine Kurve wirkt, die nur die Vergangenheit erklärt.',
    },
]

/**
 * Idempotentes Seeding — nach dem Muster von `seedDefaultTemplates` in
 * default-templates.js: fehlende Karten anhand ihres `schluessel` finden und
 * nur diese einfügen. `quiz_fortschritt` wird dabei NIE angefasst, damit ein
 * späteres Deck-Update den Lernfortschritt nicht zurücksetzt.
 *
 * Zusätzlich werden bestehende **built-in** Karten im Text nachgeführt, wenn
 * sich Frage, Antwort, Kategorie oder Niveau im Code geändert haben. Das ist
 * hier — anders als bei den Vorlagen — gefahrlos, weil mitgelieferte Karten
 * in der Oberfläche gar nicht editierbar sind (`Lernen.vue` bietet den
 * Bearbeiten-Knopf nur für eigene Karten an): der Code ist ihre einzige
 * Quelle. Ohne diesen Abgleich bliebe eine sachlich falsche Antwort in jeder
 * bestehenden Installation für immer stehen — genau das war der Fall, als
 * die Pi-Cycle-Karte noch „drei Treffer bei drei Gelegenheiten" behauptete,
 * obwohl der Indikator das Hoch von Oktober 2025 ausgelassen hat.
 *
 * Nicht angefasst werden `aktiv` (Ausblenden ist eine Nutzerentscheidung),
 * `herkunft` und alles in `quiz_fortschritt`.
 */
export async function seedDefaultLernkarten(knex) {
    /*
     * Jedes Feld aus `soll` MUSS hier im `select` stehen, sonst ist `row[feld]`
     * undefined, der Vergleich unten schlägt immer fehl und jede built-in Karte
     * bekommt bei JEDEM Serverstart ein UPDATE. Genau das passierte mit
     * `erklaerung` zwischen 5dc4b4d und diesem Commit: die Spalte kam ins
     * `soll`, aber nicht in die Auswahl — 153 sinnlose Schreibvorgänge pro
     * Start, und die Logzeile „N Lernkarten inhaltlich aktualisiert" meldete
     * eine Änderung, wo keine war. Der Selbsttest hält die beiden Listen
     * ab jetzt zusammen.
     */
    const existing = await knex('quiz_karten')
        .select('id', 'schluessel', 'frage', 'antwort', 'erklaerung', 'kategorie', 'niveau', 'herkunft')
        .whereIn('schluessel', LERNKARTEN_DEFS.map(k => k.schluessel))
    const existingKeys = new Set(existing.map(r => r.schluessel))

    // 1. Texte bestehender built-in Karten nachführen.
    let aktualisiert = 0
    for (const row of existing) {
        if (row.herkunft !== 'built-in') continue
        const def = LERNKARTEN_DEFS.find(k => k.schluessel === row.schluessel)
        if (!def) continue
        const soll = {
            frage: def.frage,
            antwort: def.antwort,
            kategorie: def.kategorie,
            niveau: def.niveau || 1,
            /*
             * `erklaerung` MUSS hier stehen, nicht nur im Insert weiter unten.
             * Die Spalte gibt es seit v14, aber bis zum 05.09.2026 war sie an
             * drei Stellen zugleich nicht verdrahtet — keine Kartendefinition
             * setzte sie, der Insert listete sie nicht, und dieses `soll` auch
             * nicht. Fehlt sie ausgerechnet hier, bekommen NEUE Installationen
             * die Erklärungen und alle bestehenden Decks nie: Schritt 2 legt nur
             * fehlende Karten an, und vorhandene Karten fehlen definitionsgemäss
             * nicht. Ein Fehler, der still bleibt.
             */
            erklaerung: def.erklaerung || '',
        }
        if (Object.keys(soll).every(f => row[f] === soll[f])) continue
        await knex('quiz_karten').where({ id: row.id }).update(soll)
        aktualisiert++
    }
    if (aktualisiert) console.log(` -> ${aktualisiert} Lernkarten inhaltlich aktualisiert`)

    // 2. Fehlende Karten anlegen.
    const missing = LERNKARTEN_DEFS.filter(k => !existingKeys.has(k.schluessel))
    if (missing.length === 0) return

    console.log(` -> Seeding ${missing.length} default Lernkarten...`)

    for (const def of missing) {
        const [eingefuegt] = await knex('quiz_karten').insert({
            schluessel: def.schluessel,
            frage: def.frage,
            antwort: def.antwort,
            erklaerung: def.erklaerung || '',
            kategorie: def.kategorie,
            herkunft: 'built-in',
            aktiv: 1,
            niveau: def.niveau || 1,
        }).returning('id')
        const kartenId = typeof eingefuegt === 'object' ? eingefuegt.id : eingefuegt

        await knex('quiz_fortschritt').insert({
            kartenId,
            box: 1,
            faelligAm: 0,
            zuletztGesehenAm: 0,
            richtigStreak: 0,
            gesamtRichtig: 0,
            gesamtFalsch: 0,
            historie: '[]',
        })
    }

    console.log(` -> ${missing.length} default Lernkarten seeded`)
}
