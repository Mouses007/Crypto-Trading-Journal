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
 * `niveau` unterscheidet drei Tiefen: 1 sind Grundbegriffe, die die App an
 * ihren eigenen Kacheln bereits erklärt (InfoTipp-Texte). 2 sind vertiefte
 * Konzepte, die im Journal selbst nicht vorkommen (On-Chain-Kennzahlen,
 * Derivate-Feinheiten, Risiko-Kennzahlen, Netzwerk-Mechanik). 3 ist
 * Spezialwissen, das zum Handeln nicht nötig ist, aber fremde Analysen
 * lesbar macht (Orderfluss, Optionen, Börsen-Innenmechanik,
 * Backtest-Fallen, On-Chain-Zyklusmodelle) — alles recherchiert und
 * faktengeprüft, keine App-eigene Quelle. Die Stufen sind in `Lernen.vue`
 * filterbar; eine neue Stufe braucht dort nur einen Eintrag in `NIVEAUS`.
 */

export const LERNKARTEN_DEFS = [
    // ── Indikatoren ─────────────────────────────────────────
    { schluessel: 'atr', kategorie: 'indikatoren', frage: 'Wofür steht ATR und was zeigt er?', antwort: 'Average True Range — die durchschnittliche Kerzenspanne. Zeigt, ob sich ein Einstieg mit Stopp überhaupt lohnt: unter rund 0,2 % je Kerze fressen die Kosten die Spanne auf.' },
    { schluessel: 'rvol', kategorie: 'indikatoren', frage: 'Was misst das relative Volumen (RVOL)?', antwort: 'Ob gerade ungewöhnlich viel los ist, verglichen mit dem eigenen Normalzustand des Coins. Ab etwa 2,0 gilt ein Coin als „im Spiel".' },
    { schluessel: 'adx', kategorie: 'indikatoren', frage: 'Wofür steht ADX und wie liest man ihn?', antwort: 'Average Directional Index — zeigt, ob eine Bewegung durchläuft oder nur seitwärts sägt. Über 25 lohnt Trendfolge eher, unter 20 eher nicht.' },
    { schluessel: 'rsi', kategorie: 'indikatoren', frage: 'Was zeigt der RSI?', antwort: 'Wie überkauft oder überverkauft ein Markt gerade ist. Aussagekräftig erst im Vergleich zum Marktdurchschnitt — ein überverkaufter Coin bei ebenfalls tiefem Gesamtmarkt ist nichts Eigenes.' },
    { schluessel: 'vwapAnker', kategorie: 'indikatoren', frage: 'Was ist ein VWAP-Anker?', antwort: 'Ein volumengewichteter Durchschnittspreis, gerechnet ab einem bestimmten Startpunkt (Session-Start, Swing-Hoch/-Tief). Zeigt das durchschnittliche Einstiegsniveau seit diesem Punkt — oft ein Magnet, an dem der Kurs zurücktestet.' },
    { schluessel: 'rrr', kategorie: 'indikatoren', frage: 'Was bedeutet RRR (Risk-Reward-Ratio)?', antwort: 'Das Verhältnis von möglichem Gewinn zu eingegangenem Risiko je Trade. Ein RRR von 2 heisst: doppelt so viel Gewinnpotenzial wie Risiko bei gleichem Positionsrisiko.' },
    { schluessel: 'mfeMae', kategorie: 'indikatoren', frage: 'Was sind MFE und MAE?', antwort: 'Maximum Favorable / Adverse Excursion — wie weit ein Trade während seiner Laufzeit maximal in die richtige bzw. falsche Richtung lief. Zeigt, ob Stopps und Ziele zur tatsächlichen Kursbewegung passen.' },
    { schluessel: 'breakEven', kategorie: 'indikatoren', frage: 'Was heisst Break-even-Stop?', antwort: 'Der Stop-Loss wird nach einer gewissen Bewegung zum Einstiegspreis nachgezogen, damit der Trade im schlimmsten Fall bei ±0 endet statt im Verlust.' },

    // ── Derivate ────────────────────────────────────────────
    { schluessel: 'fundingRate', kategorie: 'derivate', frage: 'Was ist die Funding-Rate bei Perpetual Futures?', antwort: 'Was das Halten einer Long- oder Short-Position kostet oder einbringt. Positiv heisst: Longs zahlen an Shorts — ein Hinweis auf eine überfüllte Long-Seite.' },
    { schluessel: 'openInterest', kategorie: 'derivate', frage: 'Was zeigt Open Interest (OI)?', antwort: 'Die Summe aller offenen Futures-Positionen. Steigendes OI bei steigendem Preis heisst: neues Geld kommt long rein; steigendes OI bei fallendem Preis: neues Geld geht short.' },
    { schluessel: 'longShortRatio', kategorie: 'derivate', frage: 'Was sagt die Long/Short-Ratio?', antwort: 'Wie viele Konten long gegenüber short positioniert sind. Gezählt werden Konten, nicht Kapital — bildet eher Kleinanleger ab. Eine schiefe Quote plus wachsendes OI heisst: eine Seite lädt sich auf.' },
    { schluessel: 'liquidation', kategorie: 'derivate', frage: 'Was passiert bei einer Liquidation?', antwort: 'Eine gehebelte Position wird zwangsweise glattgestellt, weil die Margin das Verlustrisiko nicht mehr deckt. Ein Überhang an Liquidationen auf einer Seite zeigt, wo Druck aus dem Markt genommen wurde.' },
    { schluessel: 'rundlauf', kategorie: 'derivate', frage: 'Was misst der „Rundlauf" eines Coins?', antwort: 'Was Ein- und Ausstieg zusammen kosten, in Basispunkten (Spread + Slippage). Bei einem Scalp mit kleinem Ziel kann ein hoher Rundlauf den Trade schon vor dem Start unrentabel machen.' },
    { schluessel: 'margin', kategorie: 'derivate', frage: 'Was unterscheidet isolierte von Cross-Margin?', antwort: 'Isoliert: nur die für die Position hinterlegte Margin steht auf dem Spiel. Cross: das gesamte Kontoguthaben haftet für alle offenen Positionen zusammen.' },
    { schluessel: 'liquidationspreis', kategorie: 'derivate', frage: 'Wovon hängt der Liquidationspreis einer Position ab?', antwort: 'Vom Hebel, der Positionsgrösse und der Wartungsmarge-Anforderung der Börse. Höherer Hebel bedeutet: der Liquidationspreis liegt näher am Einstieg.' },
    { schluessel: 'basis', kategorie: 'derivate', frage: 'Was ist die „Basis" bei Futures?', antwort: 'Die Preisdifferenz zwischen Futures und Spot-Markt. Ein Future über Spot (Contango) ist der Normalfall; eine negative Basis (Backwardation) signalisiert Stress oder starke Short-Nachfrage.' },

    // ── Sentiment / Marktlage ───────────────────────────────
    { schluessel: 'fearGreed', kategorie: 'sentiment', frage: 'Was misst der Fear & Greed Index?', antwort: 'Wie ängstlich oder gierig der Markt insgesamt ist, auf einer Skala von 0 bis 100. Nur ein Teil davon ist echte Stimmung (soziale Medien, Suchanfragen) — rund die Hälfte kommt aus Volatilität und Volumen, ist also aus dem Kurs abgeleitet. Extreme können wochenlang stehen bleiben.' },
    { schluessel: 'dominance', kategorie: 'sentiment', frage: 'Was zeigt die BTC-Dominanz?', antwort: 'Welcher Anteil des Kryptomarkts auf Bitcoin entfällt. Steigende Dominanz bei fallenden Kursen heisst: Geld flüchtet aus Altcoins in BTC, es kommt kein neues Geld herein.' },
    { schluessel: 'altseason', kategorie: 'sentiment', frage: 'Ab welchem Wert spricht man von Altcoin-Saison?', antwort: 'Über 75 gilt als Altcoin-Saison (Alt-Longs haben Rückenwind), unter 25 als Bitcoin-Saison (Alts laufen oft schwächer als BTC). Die Schwellen sind gesetzt, nicht mathematisch hergeleitet.' },
    { schluessel: 'makroKopplung', kategorie: 'sentiment', frage: 'Was zeigt die Kopplung BTC↔Nasdaq?', antwort: 'Wie stark sich Bitcoin gerade wie ein Tech-Aktien-Future verhält. Ein steigender Dollar-Index gilt dabei als Gegenwind für Krypto, unabhängig davon, ob der Dollar selbst „gut" oder „schlecht" performt.' },
    { schluessel: 'stablecoinFluss', kategorie: 'sentiment', frage: 'Was sagt ein Zufluss von Stablecoins auf Börsen?', antwort: 'Kapital, das bereit steht, in den Markt zu gehen — meist als leicht bullisches Vorzeichen gelesen, ohne selbst schon eine Kursbewegung zu sein.' },
    { schluessel: 'etfFluss', kategorie: 'sentiment', frage: 'Was zeigt der ETF-Fluss bei Bitcoin?', antwort: 'Wie viel BTC institutionell über Spot-ETFs gehalten wird und ob täglich mehr hinein- oder herausfliesst. Ein anhaltender Abfluss über mehrere Tage wiegt schwerer als ein einzelner roter Tag.' },

    // ── Chartanalyse ────────────────────────────────────────
    { schluessel: 'piCycleTop', kategorie: 'chartAnalyse', frage: 'Was ist das Pi-Cycle-Top-Signal?', antwort: 'Kreuzt der 111-Tage-Durchschnitt über den doppelten 350-Tage-Durchschnitt, lag in der Vergangenheit ein Zyklushoch nahe — 2013, 2017 und 2021 jeweils auf wenige Tage genau. Beim Hoch von Oktober 2025 kreuzte er gar nicht: drei Treffer und ein Aussetzer sind eine Beobachtung, keine Regel.' },
    { schluessel: 'rainbowChart', kategorie: 'chartAnalyse', frage: 'Was zeigt der Bitcoin-Rainbow-Chart?', antwort: 'Wo der Kurs langfristig innerhalb einer logarithmischen Regression über seine eigene Geschichte steht, von „Ausverkauf" bis „Blase". Die Bänder sind kein Naturgesetz: sie wurden nachträglich neu angepasst, als der Kurs 2022 unten herausfiel. Für eine einzelne Handelsentscheidung zu grob.' },
    { schluessel: 'marktregime', kategorie: 'chartAnalyse', frage: 'Was fasst eine Marktmechanik-/Regime-Kachel zusammen?', antwort: 'Preis, Open Interest, Funding und liquidiertes Volumen zu einem einzigen Marktzustand, z.B. „Long-Squeeze-Gefahr". Regelbasiert, keine Prognose.' },
    { schluessel: 'stopHunt', kategorie: 'chartAnalyse', frage: 'Was ist ein Stop-Hunt?', antwort: 'Ein kurzer Ausbruch über ein offensichtliches Hoch/Tief, der gehäufte Stop-Loss-Orders auslöst, bevor der Kurs in die ursprüngliche Richtung zurückdreht.' },

    // ── Risiko & Handwerk ───────────────────────────────────
    { schluessel: 'beta', kategorie: 'risiko', frage: 'Was sagt ein hoher Beta-Wert zu Bitcoin aus?', antwort: 'Bewegt sich Bitcoin um 1 %, bewegt sich der Coin im Schnitt um β %. Über 1 verstärkt er eine BTC-Bewegung (Position kann kleiner ausfallen), unter 1 dämpft er sie.' },
    { schluessel: 'ausfuehrungsguete', kategorie: 'risiko', frage: 'Was zeigt die Ausführungsnote eines Coins?', antwort: 'Wie teuer eine Order über eine bestimmte Grösse wirklich ist, gemessen am echten Orderbuch. Eine hohe Gelegenheits-Note nützt wenig, wenn die Ausführung sie auffrisst.' },
    { schluessel: 'slippage', kategorie: 'risiko', frage: 'Was ist Slippage?', antwort: 'Die Differenz zwischen dem erwarteten und dem tatsächlich ausgeführten Preis einer Order — meist, weil das Orderbuch bei der georderten Grösse nicht tief genug ist.' },
    { schluessel: 'positionSizing', kategorie: 'risiko', frage: 'Was regelt Position Sizing?', antwort: 'Wie gross eine Position gemessen am Konto sein darf, damit ein einzelner Verlust das Konto nicht ernsthaft beschädigt — unabhängig davon, wie überzeugt man vom Trade ist.' },
    { schluessel: 'hebel', kategorie: 'risiko', frage: 'Was macht ein höherer Hebel mit dem Risiko einer Position?', antwort: 'Er vergrössert Gewinn und Verlust gleichermassen bei gleicher Kapitalbindung — und rückt den Liquidationspreis näher an den Einstieg heran.' },
    { schluessel: 'drawdown', kategorie: 'risiko', frage: 'Was ist ein Drawdown?', antwort: 'Der Rückgang des Kontostands vom letzten Hoch bis zum aktuellen Tiefpunkt, meist in Prozent. Zeigt, wie schmerzhaft eine schlechte Phase tatsächlich war.' },
    { schluessel: 'profitFactor', kategorie: 'risiko', frage: 'Was sagt der Profit Factor aus?', antwort: 'Das Verhältnis von Bruttogewinn zu Bruttoverlust über alle Trades. Über 1 heisst profitabel; ein Wert von 2 heisst: doppelt so viel gewonnen wie verloren.' },
    { schluessel: 'winRate', kategorie: 'risiko', frage: 'Warum reicht eine hohe Win-Rate allein nicht als Erfolgsmass?', antwort: 'Weil sie nichts über die Grösse der Gewinne und Verluste aussagt. Eine Win-Rate von 80 % kann trotzdem verlustreich sein, wenn die wenigen Verlierer jeweils riesig sind.' },
    { schluessel: 'expectancy', kategorie: 'risiko', frage: 'Was ist der Erwartungswert (Expectancy) einer Strategie?', antwort: 'Der durchschnittliche Gewinn oder Verlust pro Trade, wenn man Win-Rate und durchschnittliche Gewinn-/Verlustgrösse zusammenrechnet. Positiv heisst: die Strategie trägt sich auf lange Sicht.' },
    { schluessel: 'scalpSwing', kategorie: 'risiko', frage: 'Was unterscheidet Scalp, Daytrade und Swing grob?', antwort: 'Die Haltedauer: ein Scalp dauert Minuten, ein Daytrade wird innerhalb eines Tages geschlossen, ein Swing-Trade läuft über mehrere Tage bis Wochen.' },
    { schluessel: 'spotFutures', kategorie: 'risiko', frage: 'Was ist der Kernunterschied zwischen Spot- und Futures-Handel?', antwort: 'Beim Spot-Handel wird der Coin tatsächlich gekauft und besessen. Futures sind ein Vertrag auf den zukünftigen Preis, meist gehebelt und ohne den Coin selbst zu halten.' },
    { schluessel: 'makerTaker', kategorie: 'risiko', frage: 'Was unterscheidet Maker- von Taker-Gebühren?', antwort: 'Maker stellt dem Orderbuch Liquidität bereit (Limit-Order, die nicht sofort ausgeführt wird) und zahlt meist weniger. Taker nimmt bestehende Liquidität sofort weg (Market-Order) und zahlt mehr.' },

    // ── Markt allgemein ─────────────────────────────────────
    { schluessel: 'marktkapitalisierung', kategorie: 'markt', frage: 'Warum sagt der Preis eines Coins allein nichts über seine Grösse aus?', antwort: 'Marktkapitalisierung = Preis × zirkulierendes Angebot. Ein Coin bei 0,01 $ kann grösser sein als einer bei 1000 $, je nach Anzahl der Token im Umlauf.' },
    { schluessel: 'circulatingSupply', kategorie: 'markt', frage: 'Was ist der Unterschied zwischen zirkulierendem und maximalem Angebot?', antwort: 'Zirkulierend: was aktuell tatsächlich am Markt handelbar ist. Maximal: die absolute Obergrenze, die je existieren wird — ein grosser Abstand dazwischen bedeutet künftigen Verwässerungsdruck.' },
    { schluessel: 'perpetual', kategorie: 'markt', frage: 'Was macht einen Perpetual Future „perpetual"?', antwort: 'Er hat kein Verfallsdatum wie klassische Futures — dafür sorgt die Funding-Rate laufend dafür, dass sein Preis nah am Spot-Preis bleibt.' },

    // ══════════════════════════════════════════════════════════
    // Niveau 2 — vertiefte Konzepte, im Journal selbst nicht erklärt.
    // ══════════════════════════════════════════════════════════

    // ── On-Chain-Daten ──────────────────────────────────────
    { schluessel: 'mvrv', kategorie: 'onchain', niveau: 2, frage: 'Was zeigt der MVRV-Ratio (Market Value to Realized Value)?', antwort: 'Verhältnis von Marktkapitalisierung zu Realized Cap (Wert aller Coins zum Preis ihrer letzten On-Chain-Bewegung). Über 1 heisst: der durchschnittliche Halter sitzt im Gewinn — hohe Werte fielen historisch mit Marktzyklus-Hochs zusammen.' },
    { schluessel: 'sopr', kategorie: 'onchain', niveau: 2, frage: 'Was misst der SOPR (Spent Output Profit Ratio)?', antwort: 'Ob gerade bewegte Coins im Schnitt mit Gewinn oder Verlust verkauft werden. Über 1: Verkäufer realisieren Gewinn. Unter 1: Verkäufer geben mit Verlust ab — oft ein Zeichen von Kapitulation.' },
    { schluessel: 'nupl', kategorie: 'onchain', niveau: 2, frage: 'Was zeigt NUPL (Net Unrealized Profit/Loss) und welche Zonen gibt es?', antwort: 'Wie weit der Markt im Schnitt über oder unter dem Einstandspreis aller Halter notiert. Über 0,75 gilt als Euphorie (historisch nahe Zyklushochs), negativ als Kapitulation (historisch nahe Böden).' },
    { schluessel: 'ssr', kategorie: 'onchain', niveau: 2, frage: 'Was sagt die Stablecoin Supply Ratio (SSR) aus?', antwort: 'Verhältnis von Bitcoin-Marktkapitalisierung zu Stablecoin-Marktkapitalisierung — ein Näherungswert für die potenzielle Kaufkraft am Markt. Eine fallende SSR kann echte neue Kaufkraft bedeuten ODER einfach einen fallenden BTC-Preis — beides sieht in der Kennzahl gleich aus.' },
    { schluessel: 'exchangeNetflow', kategorie: 'onchain', niveau: 2, frage: 'Was bedeutet ein positiver Exchange-Netflow bei Bitcoin?', antwort: 'Mehr Coins fliessen auf Börsen als davon abfliessen — historisch oft ein Vorzeichen für erhöhten Verkaufsdruck, weil Coins auf Börsen leichter liquide gemacht werden können als in privater Verwahrung.' },
    { schluessel: 'realizedCap', kategorie: 'onchain', niveau: 2, frage: 'Was unterscheidet Realized Cap von der normalen Marktkapitalisierung?', antwort: 'Die normale Marktkapitalisierung bewertet jeden Coin zum aktuellen Preis. Realized Cap bewertet jeden Coin zu dem Preis, zu dem er zuletzt on-chain bewegt wurde — sie reagiert also nicht auf jede Kursbewegung, sondern nur auf tatsächlich verschobene Coins.' },
    { schluessel: 'dormancy', kategorie: 'onchain', niveau: 2, frage: 'Was misst „Coin Days Destroyed" (CDD)?', antwort: 'Wie lange bewegte Coins zuvor stillgelegen haben, gewichtet nach Menge. Ein Anstieg zeigt: alte, lange gehaltene Coins werden bewegt — oft ein Signal, dass langfristige Halter beginnen zu verkaufen.' },

    // ── Derivate (vertieft) ──────────────────────────────────
    { schluessel: 'basisTrade', kategorie: 'derivate', niveau: 2, frage: 'Was ist ein Basis-Trade (Cash-and-Carry-Arbitrage)?', antwort: 'Spot kaufen und im selben Umfang Futures leerverkaufen, um die Preisdifferenz (Basis) risikoarm zu vereinnahmen — die Richtung des Marktes ist dabei egal, weil beide Positionen sich gegenseitig absichern.' },
    { schluessel: 'deltaNeutral', kategorie: 'derivate', niveau: 2, frage: 'Was bedeutet eine delta-neutrale Position?', antwort: 'Long- und Short-Engagement sind so kombiniert, dass die Position auf kleine Kursbewegungen kaum reagiert. Verdient wird stattdessen an Funding, Zeitwertverfall oder der Spot-Futures-Spanne — nicht an der Kursrichtung.' },
    { schluessel: 'gex', kategorie: 'derivate', niveau: 2, frage: 'Was zeigt Gamma Exposure (GEX)?', antwort: 'Wie stark Options-Händler ihre Absicherung bei Kursbewegungen nachjustieren müssen. Positives GEX dämpft Volatilität (Händler kaufen Rücksetzer, verkaufen Anstiege), negatives GEX verstärkt sie.' },
    { schluessel: 'impliedVol', kategorie: 'derivate', niveau: 2, frage: 'Was ist implizite Volatilität (IV)?', antwort: 'Die vom Optionsmarkt erwartete künftige Schwankungsbreite, abgeleitet aus aktuellen Optionspreisen — nicht die tatsächlich beobachtete (historische) Volatilität der Vergangenheit.' },
    { schluessel: 'cmeGap', kategorie: 'derivate', niveau: 2, frage: 'Was war ein „CME-Gap" bei Bitcoin-Futures?', antwort: 'Eine Kurslücke, weil die CME am Wochenende schloss, während der Kryptomarkt weiterlief — die Lücke füllte sich meist innerhalb weniger Tage. Seit Mai 2026 handelt die CME rund um die Uhr, das Phänomen ist damit weitgehend Geschichte.' },
    { schluessel: 'quarterlyVsPerp', kategorie: 'derivate', niveau: 2, frage: 'Was unterscheidet quartalsweise Futures von Perpetuals?', antwort: 'Quartals-Futures haben ein festes Verfallsdatum, ihr Preis konvergiert zum Spot-Preis hin zum Verfall. Perpetuals haben kein Verfallsdatum — die Funding-Rate übernimmt stattdessen laufend die Angleichung an den Spot-Preis.' },
    { schluessel: 'liquidationCascade', kategorie: 'derivate', niveau: 2, frage: 'Wie entsteht eine Liquidationskaskade?', antwort: 'Eine erste Liquidation drückt den Preis, was weitere gehebelte Positionen in ihre Liquidationszone treibt — deren Zwangsverkäufe drücken den Preis weiter. Der Effekt verstärkt sich selbst, bis die überhebelte Seite des Marktes abgebaut ist.' },
    { schluessel: 'putCallRatio', kategorie: 'derivate', niveau: 2, frage: 'Was zeigt das Put-Call-Verhältnis bei Krypto-Optionen?', antwort: 'Das Volumen gehandelter Verkaufsoptionen (Put) im Verhältnis zu Kaufoptionen (Call). Ein hoher Wert deutet auf verstärkte Absicherung oder Bärenerwartung hin, ein niedriger auf überwiegend bullische Positionierung.' },

    // ── Risiko (vertieft) ────────────────────────────────────
    { schluessel: 'sharpe', kategorie: 'risiko', niveau: 2, frage: 'Was misst die Sharpe Ratio?', antwort: 'Überrendite gegenüber dem risikofreien Zins, geteilt durch die Schwankungsbreite (Standardabweichung) der Rendite. Höher heisst: mehr Rendite je Einheit eingegangenes Risiko.' },
    { schluessel: 'sortino', kategorie: 'risiko', niveau: 2, frage: 'Wie unterscheidet sich die Sortino- von der Sharpe-Ratio?', antwort: 'Die Sortino Ratio bestraft nur die Abwärts-Schwankung (Verluste), nicht die gesamte Schwankungsbreite — eine Strategie mit heftigen Aufwärtsausschlägen wird dadurch nicht künstlich abgewertet.' },
    { schluessel: 'calmar', kategorie: 'risiko', niveau: 2, frage: 'Was misst die Calmar Ratio?', antwort: 'Rendite im Verhältnis zum grössten erlittenen Drawdown im Betrachtungszeitraum — sie fragt direkt: wie viel Ertrag für wie viel maximal ausgehaltenen Schmerz.' },
    { schluessel: 'kelly', kategorie: 'risiko', niveau: 2, frage: 'Was besagt das Kelly-Kriterium?', antwort: 'Eine Formel für die mathematisch optimale Positionsgrösse aus Trefferquote und Chance-Risiko-Verhältnis. In der Praxis wird meist nur ein Bruchteil (z.B. halbes Kelly) gehandelt, weil volles Kelly extreme Schwankungen im Kapital erzeugt.' },
    { schluessel: 'var', kategorie: 'risiko', niveau: 2, frage: 'Was gibt der Value at Risk (VaR) an?', antwort: 'Den geschätzten maximalen Verlust einer Position über einen Zeitraum mit einer bestimmten Wahrscheinlichkeit — z.B. „5 % Chance, an einem Tag mehr als 1000 $ zu verlieren". Er zeigt keine absolute Obergrenze, nur eine Wahrscheinlichkeit.' },
    { schluessel: 'custodyRisk', kategorie: 'risiko', niveau: 2, frage: 'Was ist der Unterschied zwischen Verwahrung auf einer Börse und Self-Custody?', antwort: 'Auf einer Börse liegen die Coins technisch im Besitz der Börse, man hält nur eine Forderung dagegen (Gegenparteirisiko). Self-Custody heisst: die privaten Schlüssel liegen bei einem selbst — kein Börsenausfall kann die Coins wegnehmen, aber ein verlorener Schlüssel auch niemand ersetzen.' },

    // ── Chartanalyse (vertieft) ──────────────────────────────
    { schluessel: 'orderflow', kategorie: 'chartAnalyse', niveau: 2, frage: 'Was verrät ein Orderbuch-Ungleichgewicht (Order Flow Imbalance)?', antwort: 'Ob auf der Kauf- oder Verkaufsseite des Orderbuchs gerade deutlich mehr Volumen liegt. Ein starkes Ungleichgewicht kann kurzfristig den Kurs in die entsprechende Richtung drücken — kann aber genauso gut eine Spoofing-Wand sein, die vor Ausführung wieder verschwindet.' },
    { schluessel: 'vwapExecution', kategorie: 'chartAnalyse', niveau: 2, frage: 'Warum handeln grosse Orders oft über VWAP-Algorithmen statt in einem Schlag?', antwort: 'Eine einzelne Grossorder würde das Orderbuch leerfegen und den eigenen Einstiegspreis verschlechtern (Slippage). VWAP-Ausführung verteilt die Order über die Zeit, um sich dem durchschnittlichen Marktpreis anzunähern.' },
    { schluessel: 'correlationRegime', kategorie: 'chartAnalyse', niveau: 2, frage: 'Warum kann eine gemessene Korrelation zwischen zwei Coins in der nächsten Woche wertlos sein?', antwort: 'Korrelationen sind kein Naturgesetz, sondern ein Marktzustand (Regime) — sie brechen bei Nachrichten, die nur einen der beiden Coins betreffen, oder wenn sich das übergeordnete Risikoregime ändert. Eine Korrelation aus der Vergangenheit ist eine Beobachtung, keine Garantie.' },

    // ── Sentiment (vertieft) ─────────────────────────────────
    { schluessel: 'coinbasePremium', kategorie: 'sentiment', niveau: 2, frage: 'Was zeigt der Coinbase-Premium-Index?', antwort: 'Die Preisdifferenz von Bitcoin auf Coinbase gegenüber Binance. Ein positiver Aufschlag gilt als Zeichen für US-Kaufinteresse (institutionell/retail), ein negativer für Verkaufsdruck aus dem US-Markt.' },
    { schluessel: 'takerRatio', kategorie: 'sentiment', niveau: 2, frage: 'Was sagt das Taker-Buy/Sell-Verhältnis aus?', antwort: 'Ob aggressive Marktorders gerade eher kaufen oder verkaufen — also wer bereit ist, den Spread zu zahlen, um sofort ausgeführt zu werden. Ein Wert über 1 heisst: aggressive Käufer dominieren gerade.' },

    // ── Markt (vertieft) ─────────────────────────────────────
    { schluessel: 'fdv', kategorie: 'markt', niveau: 2, frage: 'Was zeigt die Fully Diluted Valuation (FDV) im Unterschied zur Marktkapitalisierung?', antwort: 'Marktkapitalisierung bewertet nur die aktuell zirkulierende Menge, FDV den kompletten maximalen Token-Vorrat zum aktuellen Preis. Eine FDV, die ein Vielfaches der Marktkapitalisierung beträgt, warnt vor künftigem Verkaufsdruck durch noch nicht freigeschaltete Token.' },
    { schluessel: 'tokenUnlock', kategorie: 'markt', niveau: 2, frage: 'Warum belasten Token-Unlocks oft den Kurs?', antwort: 'Team- und Investoren-Anteile sind meist gesperrt und werden nach Zeitplan freigegeben. Sobald sie handelbar werden, kann zusätzliches Angebot auf den Markt treffen, ohne dass sich an der Nachfrage etwas geändert hat.' },
    { schluessel: 'halving', kategorie: 'markt', niveau: 2, frage: 'Was passiert beim Bitcoin-Halving?', antwort: 'Die Belohnung pro geminten Block halbiert sich (etwa alle vier Jahre) — das Angebot an neuen Coins verlangsamt sich, die Nachfrage bleibt davon unberührt. Historisch folgten grosse Kursbewegungen erst mit deutlicher Verzögerung, nicht am Halving-Tag selbst.' },
    { schluessel: 'powVsPos', kategorie: 'markt', niveau: 2, frage: 'Was unterscheidet Proof-of-Work von Proof-of-Stake grundlegend?', antwort: 'PoW sichert das Netzwerk über Rechenleistung (Mining), PoS über hinterlegtes Kapital (Staking). Ein 51%-Angriff kostet bei PoW den Aufbau von Mehrheits-Rechenleistung, bei PoS den Kauf der Mehrheit der gestakten Coins — was die eigene Position sofort entwertet.' },
    { schluessel: 'attack51', kategorie: 'markt', niveau: 2, frage: 'Was ist ein 51%-Angriff?', antwort: 'Kontrolle über die Mehrheit der Netzwerk-Rechenleistung (PoW) oder der gestakten Coins (PoS), um Transaktionen umzuschreiben und Coins doppelt auszugeben. Bei grossen Netzwerken wie Bitcoin wirtschaftlich praktisch unmöglich, bei kleinen Chains real vorgekommen.' },
    // ══════════════════════════════════════════════════════════
    // Niveau 3 — Spezialwissen: Orderfluss, Optionen, Börsenmechanik,
    // Backtest-Fallen, On-Chain-Zyklusmodelle. Kommt im Journal nirgends
    // vor und ist auch zum Handeln nicht nötig — wer es kennt, liest
    // fremde Analysen aber ohne Lücken.
    // ══════════════════════════════════════════════════════════

    // ── Indikatoren (Ergänzung) ──────────────────────────────
    { schluessel: 'emaSma', kategorie: 'indikatoren', frage: 'Was unterscheidet einen EMA von einem SMA?', antwort: 'Der SMA gewichtet alle Kerzen des Zeitraums gleich, der EMA die jüngsten stärker. Der EMA dreht deshalb früher — und in einem Seitwärtsmarkt entsprechend öfter falsch.' },
    { schluessel: 'macd', kategorie: 'indikatoren', frage: 'Was zeigt der MACD?', antwort: 'Den Abstand zweier gleitender Durchschnitte (meist 12 und 26) samt Signallinie (9). Er misst Momentum, nicht Richtung: ohne Trend kreuzt er laufend hin und her.' },
    { schluessel: 'bollinger', kategorie: 'indikatoren', frage: 'Was sagen Bollinger-Bänder aus?', antwort: 'Ein gleitender Durchschnitt (meist 20) plus/minus zwei Standardabweichungen. Die Aussage ist die BREITE der Bänder — eng heisst ruhig, weit heisst bewegt. Eine blosse Berührung des Bandes ist kein Signal.' },
    { schluessel: 'divergenz', kategorie: 'indikatoren', frage: 'Was ist eine Divergenz zwischen Kurs und Indikator?', antwort: 'Der Kurs macht ein neues Hoch, der Indikator (z.B. RSI) nicht mehr — das Momentum lässt nach. Divergenzen können sich mehrfach hintereinander auflösen, bevor der Kurs tatsächlich dreht.' },
    { schluessel: 'volumenprofil', kategorie: 'indikatoren', frage: 'Was zeigt ein Volumenprofil (POC, Value Area)?', antwort: 'Wie viel Volumen auf welchem PREIS gehandelt wurde statt zu welcher Zeit. Der POC ist der meistgehandelte Preis, die Value Area der Bereich, in dem rund 70 % des Volumens lagen.' },
    { schluessel: 'fibonacci', kategorie: 'indikatoren', frage: 'Was sind Fibonacci-Retracements?', antwort: 'Prozentmarken einer vorangegangenen Bewegung (38,2 / 50 / 61,8 %), an denen viele einen Rücksetzer erwarten. Sie wirken, weil viele sie beobachten — nicht weil den Zahlen selbst etwas innewohnt.' },
    { schluessel: 'atrStopp', kategorie: 'indikatoren', frage: 'Warum bemisst man den Stopp oft in ATR statt in Prozent?', antwort: 'Weil derselbe Prozentabstand in einem ruhigen und in einem heftigen Markt etwas völlig anderes bedeutet. Ein Stopp von z.B. 1,5 ATR passt sich der aktuellen Schwankungsbreite an, statt sie zu ignorieren.' },

    // ── Chartanalyse (Ergänzung) ─────────────────────────────
    { schluessel: 'unterstuetzung', kategorie: 'chartAnalyse', frage: 'Wann ist eine Marke wirklich Unterstützung oder Widerstand?', antwort: 'Wenn der Kurs dort schon sichtbar reagiert hat — gedreht, gestockt, auffällig viel Volumen gehandelt. Eine Linie, an der noch nie etwas passiert ist, ist eine gezeichnete Linie, keine Marke.' },
    { schluessel: 'kerzenmuster', kategorie: 'chartAnalyse', frage: 'Was sagt ein einzelnes Kerzenmuster wie Hammer oder Engulfing aus?', antwort: 'Für sich genommen sehr wenig. Erst der Ort zählt: dasselbe Muster an einer bedeutenden Marke nach einer klaren Bewegung ist etwas anderes als mitten in einer Range.' },
    { schluessel: 'range', kategorie: 'chartAnalyse', frage: 'Was ist eine Range und was macht sie gefährlich?', antwort: 'Ein Seitwärtsbereich zwischen zwei Marken. Gefährlich, weil jede Trendfolge darin systematisch verliert — deshalb prüft man vorher, ob überhaupt ein Trend läuft (z.B. über den ADX).' },
    { schluessel: 'zeiteinheiten', kategorie: 'chartAnalyse', frage: 'Warum schaut man auf mehr als eine Zeiteinheit?', antwort: 'Die grosse Zeiteinheit sagt, in welche Richtung man überhaupt handeln will, die kleine, wann man einsteigt. Ein perfekter 5-Minuten-Einstieg gegen die Tagesrichtung bleibt ein Gegentrend-Trade.' },
    { schluessel: 'liquiditaetszone', kategorie: 'chartAnalyse', niveau: 2, frage: 'Warum liegt „Liquidität" ausgerechnet über Hochs und unter Tiefs?', antwort: 'Weil dort die Stopps stehen: über einem Hoch die der Shorts, unter einem Tief die der Longs. Ein Ausbruch dorthin findet also automatisch Gegenpartei — deshalb laufen Kurse so auffällig oft genau dahin.' },
    { schluessel: 'fairValueGap', kategorie: 'chartAnalyse', niveau: 3, frage: 'Was ist eine Fair Value Gap (Imbalance)?', antwort: 'Ein Preisbereich, den der Kurs in einer heftigen Bewegung praktisch ohne Gegenhandel übersprungen hat — sichtbar als Lücke zwischen den Dochten dreier aufeinanderfolgender Kerzen. Die Erwartung, dass er zurückkommt, ist eine Beobachtung, kein Gesetz.' },
    { schluessel: 'orderBlock', kategorie: 'chartAnalyse', niveau: 3, frage: 'Was meint ein „Order Block"?', antwort: 'Die letzte gegenläufige Kerze vor einer starken Bewegung — dort soll grosses Kapital eingestiegen sein. Im Wyckoff-Vokabular ist das derselbe Ort, der dort „Last Point of Support" heisst.' },
    { schluessel: 'bosChoch', kategorie: 'chartAnalyse', niveau: 3, frage: 'Was unterscheidet einen Bruch der Marktstruktur (BOS) von einem Change of Character (CHoCH)?', antwort: 'BOS: der Trend bestätigt sich, das nächste Hoch bzw. Tief in Trendrichtung wird genommen. CHoCH: erstmals wird ein Punkt GEGEN die Trendrichtung gebrochen — der erste Hinweis, dass die Struktur kippt.' },
    { schluessel: 'wyckoff', kategorie: 'chartAnalyse', niveau: 3, frage: 'Was beschreibt das Wyckoff-Schema?', antwort: 'Einen wiederkehrenden Vierklang: Akkumulation (leises Einsammeln in einer Range), Markup (Aufwärtstrend), Distribution (Abgeben in die Stärke), Markdown (Abwärtstrend). Ein Deutungsrahmen, kein Signalgeber.' },
    { schluessel: 'spring', kategorie: 'chartAnalyse', niveau: 3, frage: 'Was ist ein Spring bzw. ein Upthrust?', antwort: 'Der Fehlausbruch am Ende einer Range: der Kurs fällt kurz unter die Unterstützung (Spring) oder steigt über den Widerstand (Upthrust) und kehrt sofort zurück. Zweck ist das Einsammeln der dort ausgelösten Stopps.' },
    { schluessel: 'cvd', kategorie: 'chartAnalyse', niveau: 3, frage: 'Was zeigt der Cumulative Volume Delta (CVD)?', antwort: 'Die laufende Summe aus aggressiven Käufen minus aggressiven Verkäufen. Er beantwortet nicht, wohin der Kurs lief, sondern welche Seite dafür bereit war, den Spread zu zahlen.' },
    { schluessel: 'absorption', kategorie: 'chartAnalyse', niveau: 3, frage: 'Was heisst Absorption im Orderfluss?', antwort: 'Aggressive Marktorders laufen in eine Wand ruhender Limit-Orders, die immer wieder nachgelegt wird — der Kurs bewegt sich trotz hohem Volumen kaum. Fällt der CVD, während der Preis hält, absorbiert dort jemand.' },
    { schluessel: 'footprint', kategorie: 'chartAnalyse', niveau: 3, frage: 'Was zeigt eine Footprint-Kerze?', antwort: 'Innerhalb einer einzelnen Kerze, wie viel auf jedem Preis gegen Bid und gegen Ask gehandelt wurde. Statt „diese Kerze war grün" sieht man, wo in ihr tatsächlich gehandelt wurde.' },

    // ── Derivate (Ergänzung) ─────────────────────────────────
    { schluessel: 'orderarten', kategorie: 'derivate', frage: 'Was unterscheidet Market-, Limit- und Stop-Order?', antwort: 'Market: sofort zum nächstbesten Preis — Ausführung sicher, Preis nicht. Limit: nur zu meinem Preis oder besser — Preis sicher, Ausführung nicht. Stop: wird erst bei einem Auslösekurs überhaupt zu einer Order.' },
    { schluessel: 'trailingStopp', kategorie: 'derivate', frage: 'Was ist ein Trailing Stop?', antwort: 'Ein Stopp, der dem Kurs in festem Abstand folgt, solange dieser in die richtige Richtung läuft, und stehen bleibt, sobald er dreht. Er sichert Gewinn, kostet aber bei jedem grösseren Rücksetzer die Position.' },
    { schluessel: 'markPreis', kategorie: 'derivate', niveau: 2, frage: 'Warum liquidiert die Börse über den Mark-Preis statt über den letzten Kurs?', antwort: 'Der Mark-Preis wird aus einem Index mehrerer Börsen gebildet und ist gegen kurze Manipulationsdochte robuster. Ein Docht auf dem eigenen Chart löst deshalb nicht zwingend eine Liquidation aus — und umgekehrt.' },
    { schluessel: 'initialWartung', kategorie: 'derivate', niveau: 2, frage: 'Was unterscheidet Initialmarge von Wartungsmarge?', antwort: 'Die Initialmarge ist, was das Eröffnen kostet (Positionsgrösse geteilt durch Hebel). Die Wartungsmarge ist das Minimum, das die Position offen hält — wird es unterschritten, liquidiert die Börse.' },
    { schluessel: 'bankrottpreis', kategorie: 'derivate', niveau: 2, frage: 'Was unterscheidet Liquidationspreis und Bankrottpreis?', antwort: 'Beim Liquidationspreis greift die Börse ein, solange die Wartungsmarge noch da ist. Beim Bankrottpreis wäre die Marge exakt aufgebraucht. Die Spanne dazwischen ist der Puffer, aus dem sich der Versicherungsfonds speist.' },
    { schluessel: 'versicherungsfonds', kategorie: 'derivate', niveau: 2, frage: 'Wozu dient der Versicherungsfonds einer Börse?', antwort: 'Er deckt Liquidationen, die schlechter als zum Bankrottpreis geschlossen wurden. Gespeist wird er aus Liquidationen, die besser liefen als nötig. Ist er leer, greift Auto-Deleveraging.' },
    { schluessel: 'adl', kategorie: 'derivate', niveau: 2, frage: 'Was ist Auto-Deleveraging (ADL)?', antwort: 'Reicht der Versicherungsfonds für eine gescheiterte Liquidation nicht, schliesst die Börse zwangsweise GEWINNENDE Gegenpositionen. Zuerst trifft es hohe Rendite bei hohem Hebel — man kann also aus einem laufenden Gewinntrade geworfen werden.' },
    { schluessel: 'hebelstufen', kategorie: 'derivate', niveau: 2, frage: 'Warum sinkt der maximal mögliche Hebel mit wachsender Position?', antwort: 'Börsen staffeln die Wartungsmarge nach Positionsgrösse (Risk Limits): je grösser die Position, desto höher die geforderte Marge und desto kleiner der erlaubte Hebel. Eine grosse Position ist im Notfall schlechter glattzustellen.' },
    { schluessel: 'linearInvers', kategorie: 'derivate', niveau: 2, frage: 'Was unterscheidet lineare (USDT-besicherte) von inversen (Coin-besicherten) Kontrakten?', antwort: 'Linear: Sicherheit und Ergebnis in USDT, die Rechnung ist geradlinig. Invers: beides im Coin selbst — die Sicherheit verliert also mit fallendem Kurs zusätzlich an Wert, was einen Long doppelt trifft.' },
    { schluessel: 'fundingTakt', kategorie: 'derivate', niveau: 2, frage: 'Warum ist eine Funding-Rate ohne ihren Takt nicht vergleichbar?', antwort: '0,01 % alle 8 Stunden sind rund 11 % im Jahr, dieselben 0,01 % alle 4 Stunden gut 22 %. Erst auf eine Jahresrate umgerechnet lassen sich zwei Coins nebeneinanderlegen.' },
    { schluessel: 'oiVsVolumen', kategorie: 'derivate', niveau: 2, frage: 'Was unterscheidet Open Interest von Handelsvolumen?', antwort: 'Volumen zählt, wie viel in einem Zeitraum umgeschlagen wurde — auch wenn dieselbe Position zehnmal die Hände wechselt. Open Interest zählt, wie viele Kontrakte am Ende offen STEHEN. Viel Volumen bei gleichem OI heisst: nur umverteilt.' },
    { schluessel: 'postReduceOnly', kategorie: 'derivate', niveau: 2, frage: 'Was bewirken Post-Only und Reduce-Only?', antwort: 'Post-Only storniert die Order, falls sie sofort ausgeführt würde — sie erzwingt den Maker-Status und damit die niedrigere Gebühr. Reduce-Only kann eine Position nur verkleinern und niemals versehentlich eine Gegenposition eröffnen.' },
    { schluessel: 'callPut', kategorie: 'derivate', niveau: 2, frage: 'Was ist eine Call- und was eine Put-Option?', antwort: 'Ein Call ist das Recht, zu einem festgelegten Preis zu kaufen, ein Put das Recht zu verkaufen — jeweils ohne Pflicht. Der Käufer zahlt dafür eine Prämie und kann nur diese verlieren; der Verkäufer theoretisch weit mehr.' },
    { schluessel: 'iocFok', kategorie: 'derivate', niveau: 3, frage: 'Was heissen IOC und FOK bei einer Order?', antwort: 'IOC (Immediate or Cancel): sofort ausführen, was geht, der Rest wird gestrichen. FOK (Fill or Kill): entweder sofort vollständig oder gar nicht. Beides begrenzt, wie lange eine Order im Buch sichtbar liegt.' },
    { schluessel: 'greeks', kategorie: 'derivate', niveau: 3, frage: 'Was messen Delta, Gamma, Theta und Vega bei Optionen?', antwort: 'Delta: Preisänderung je Einheit Kursbewegung. Gamma: wie schnell sich Delta dabei selbst ändert. Theta: täglicher Zeitwertverlust. Vega: Reaktion auf einen Prozentpunkt mehr implizite Volatilität.' },
    { schluessel: 'maxPain', kategorie: 'derivate', niveau: 3, frage: 'Was ist der Max-Pain-Preis vor einem Optionsverfall?', antwort: 'Der Kurs, bei dem in Summe die meisten Optionen wertlos verfallen — der grösste Schaden für die Käuferseite. Rund um grosse Verfallstermine wirkt er wie ein schwacher Magnet, mehr nicht.' },
    { schluessel: 'skew', kategorie: 'derivate', niveau: 3, frage: 'Was zeigt der 25-Delta-Skew?', antwort: 'Wie viel teurer Absicherung nach unten (Puts) gerade ist als Spekulation nach oben (Calls), gemessen an der impliziten Volatilität. Positiver Skew heisst: der Markt zahlt einen Aufpreis für Schutz.' },

    // ── Sentiment / Makro (Ergänzung) ────────────────────────
    { schluessel: 'risikoregime', kategorie: 'sentiment', niveau: 2, frage: 'Was heisst Risk-on und Risk-off?', antwort: 'Zwei Marktzustände: Risk-on — Kapital fliesst in Riskantes (Tech-Aktien, Krypto). Risk-off — es flieht in Anleihen, Dollar, Gold. In Risk-off-Phasen fallen Coins gemeinsam, unabhängig von ihrer Qualität.' },
    { schluessel: 'realzins', kategorie: 'sentiment', niveau: 2, frage: 'Warum drücken steigende Realzinsen auf Krypto?', antwort: 'Weil risikofreie Anlagen dann echten Ertrag abwerfen und ein Vermögenswert ohne Zins oder Dividende im Vergleich unattraktiver wird. Zusätzlich verteuert sich Fremdkapital, was den Hebel im ganzen Markt zurückdrängt.' },
    { schluessel: 'fomc', kategorie: 'sentiment', niveau: 2, frage: 'Warum bewegt eine FOMC-Sitzung den Kryptomarkt?', antwort: 'Sie legt den US-Leitzins fest und damit Risikoappetit, Dollarstärke und Liquidität. Bewegung entsteht dabei meist nicht aus dem Beschluss selbst, sondern aus der Abweichung von dem, was schon eingepreist war.' },
    { schluessel: 'cpi', kategorie: 'sentiment', niveau: 2, frage: 'Warum ist der CPI-Termin für einen Krypto-Trader relevant?', antwort: 'Die Inflationszahl entscheidet mit, ob die Notenbank lockert oder strafft. Der Markt handelt die Erwartung vorab; in den Minuten nach der Zahl wird die Abweichung gehandelt — Spreads gehen dabei kurz weit auf.' },
    { schluessel: 'vix', kategorie: 'sentiment', niveau: 2, frage: 'Was ist der VIX und was hat er mit Krypto zu tun?', antwort: 'Die vom Optionsmarkt erwartete Schwankung des S&P 500, oft „Angstbarometer" genannt. Springt er, ziehen sich Anleger meist aus allem Riskanten zurück — Krypto eingeschlossen, ganz ohne Krypto-Nachricht.' },
    { schluessel: 'etfStruktur', kategorie: 'sentiment', niveau: 2, frage: 'Was unterscheidet einen Spot-ETF von einem Futures-ETF?', antwort: 'Der Spot-ETF hält die Coins selbst, seine Zuflüsse sind echte Käufe am Markt. Ein Futures-ETF hält Terminkontrakte und muss sie laufend rollen — das kostet in Contango Rendite, ohne dass je ein Coin gekauft wird.' },

    // ── Risiko & Handwerk (Ergänzung) ────────────────────────
    { schluessel: 'rMultiple', kategorie: 'risiko', frage: 'Was ist ein R-Multiple?', antwort: 'Das Ergebnis eines Trades gemessen in seinem eigenen Anfangsrisiko: 1R ist genau der Betrag, den der Stopp gekostet hätte. So werden Trades unterschiedlicher Grösse vergleichbar, ohne über Beträge zu reden.' },
    { schluessel: 'overtrading', kategorie: 'risiko', frage: 'Was ist Overtrading und Revenge-Trading?', antwort: 'Overtrading: mehr Trades, als der Plan hergibt — meist aus Langeweile oder Angst, etwas zu verpassen. Revenge-Trading: nach einem Verlust sofort grösser wieder rein. Beides erhöht Frequenz und Grösse genau dann, wenn das Urteil am schlechtesten ist.' },
    { schluessel: 'prozessErgebnis', kategorie: 'risiko', frage: 'Warum bewertet man den Prozess und nicht das Ergebnis eines einzelnen Trades?', antwort: 'Weil ein guter Trade verlieren und ein schlechter gewinnen kann. Aus einem einzelnen Ausgang zu lernen heisst, Zufall zur Regel zu machen — erst über viele Trades trennt sich Vorteil von Glück.' },
    { schluessel: 'gebuehrenlast', kategorie: 'risiko', frage: 'Warum frisst häufiges Handeln den Vorteil auf?', antwort: 'Kosten fallen je Trade an, nicht je Gewinn: Gebühr mal Frequenz. Bei einem Scalp mit kleinem Ziel kann der Rundlauf einen statistisch gültigen Vorteil vollständig aufzehren, ohne dass an der Strategie etwas falsch wäre.' },
    { schluessel: 'breakEvenQuote', kategorie: 'risiko', niveau: 2, frage: 'Welche Trefferquote braucht ein CRV von 2, um bei null herauszukommen?', antwort: 'Rund 33,3 % — allgemein 1 geteilt durch (1 + CRV), vor Kosten. Bei einem CRV von 1 sind es 50 %, bei 3 nur noch 25 %. Gebühren und Slippage verschieben die Schwelle nach oben.' },
    { schluessel: 'riskOfRuin', kategorie: 'risiko', niveau: 2, frage: 'Was ist das Risk of Ruin?', antwort: 'Die Wahrscheinlichkeit, das Konto zu sprengen, bevor sich der statistische Vorteil auszahlen kann. Sie hängt weniger vom Vorteil ab als vom Einsatz je Trade — bei genug Versuchen kommt jede Verlustserie irgendwann.' },
    { schluessel: 'stichprobe', kategorie: 'risiko', niveau: 2, frage: 'Ab wie vielen Trades ist ein Vorteil belegt?', antwort: 'Deutlich mehr als die zwanzig, nach denen die meisten schon urteilen — je nach Trefferquote und Streuung eher im dreistelligen Bereich. Eine Serie von zehn Gewinnern ist bei 50 % Trefferquote nichts Aussergewöhnliches.' },
    { schluessel: 'korrelationsrisiko', kategorie: 'risiko', niveau: 2, frage: 'Warum sind fünf Altcoin-Longs oft nur eine einzige Position?', antwort: 'Weil Altcoins in Stressphasen nahezu im Gleichschritt fallen. Fünf Positionen zu je 1 % Risiko verhalten sich dann wie eine mit 5 % — die Streuung existierte nur auf dem Papier.' },
    { schluessel: 'portfolioHitze', kategorie: 'risiko', niveau: 2, frage: 'Was ist Portfolio-Heat?', antwort: 'Die Summe des Risikos aller gleichzeitig offenen Positionen — also was passiert, wenn heute JEDER Stopp ausgelöst wird. Das ist die Zahl, die begrenzt gehört, nicht das Risiko des einzelnen Trades.' },
    { schluessel: 'ueberanpassung', kategorie: 'risiko', niveau: 2, frage: 'Was ist Überanpassung (Overfitting) beim Backtest?', antwort: 'Die Strategie hat das Rauschen der Testdaten gelernt statt eines Musters. Verdächtig sind viele feinjustierte Parameter und eine Kurve, die genau an einem Zeitraum glänzt — Rauschen wiederholt sich definitionsgemäss nicht.' },
    { schluessel: 'lookAhead', kategorie: 'risiko', niveau: 2, frage: 'Was ist Look-ahead-Bias?', antwort: 'Der Backtest benutzt eine Information, die zum Entscheidungszeitpunkt noch nicht vorlag — etwa den Schlusskurs jener Kerze, in der eingestiegen wird. Das Ergebnis sieht hervorragend aus und ist nicht handelbar.' },
    { schluessel: 'survivorship', kategorie: 'risiko', niveau: 2, frage: 'Was ist Survivorship-Bias?', antwort: 'Getestet wird nur gegen das, was heute noch existiert. Delistete Coins und tote Projekte fehlen — die Strategie sieht besser aus, weil ihre schlimmsten Fälle aus den Daten verschwunden sind.' },
    { schluessel: 'outOfSample', kategorie: 'risiko', niveau: 2, frage: 'Wozu dient ein Out-of-Sample- bzw. Walk-Forward-Test?', antwort: 'Optimiert wird auf einem Zeitraum, gemessen auf dem nächsten, den die Strategie nie gesehen hat — und das rollierend weiter. Bricht die Leistung dabei ein, war der schöne Backtest blosse Anpassung an die Vergangenheit.' },
    { schluessel: 'monteCarlo', kategorie: 'risiko', niveau: 3, frage: 'Was bringt eine Monte-Carlo-Simulation der eigenen Trades?', antwort: 'Die vorhandenen Trades werden tausendfach in zufälliger Reihenfolge neu durchgespielt. So sieht man, welche Verlustserie und welcher Drawdown bei derselben Strategie ebenfalls möglich gewesen wären — die tatsächliche Reihenfolge war nur eine von vielen.' },
    { schluessel: 'ulcer', kategorie: 'risiko', niveau: 3, frage: 'Was misst der Ulcer Index?', antwort: 'Tiefe UND Dauer der Rückschläge zusammen — er quadriert die prozentualen Abstände zum letzten Hoch über die Zeit. Ein kurzer tiefer Einbruch wiegt darin weniger als ein langes Dahinsiechen unter dem Hoch.' },

    // ── Markt (Ergänzung) ────────────────────────────────────
    { schluessel: 'cexDex', kategorie: 'markt', frage: 'Was unterscheidet eine zentrale von einer dezentralen Börse?', antwort: 'Auf einer CEX verwahrt die Börse die Coins und führt ein klassisches Orderbuch. Auf einer DEX handelt man direkt aus der eigenen Wallet gegen einen Liquiditätspool — ohne Gegenparteirisiko der Börse, dafür mit Vertrags- und Netzwerkrisiko.' },
    { schluessel: 'amm', kategorie: 'markt', niveau: 2, frage: 'Wie bildet ein Automated Market Maker (AMM) seinen Preis?', antwort: 'Nicht über Angebote im Buch, sondern über eine Formel auf den Beständen eines Liquiditätspools. Je grösser ein Handel im Verhältnis zum Pool, desto stärker verschiebt er den Preis selbst — genau das ist dort die Slippage.' },
    { schluessel: 'impermanentLoss', kategorie: 'markt', niveau: 2, frage: 'Was ist Impermanent Loss?', antwort: 'Wer Liquidität bereitstellt, hält am Ende mehr vom gefallenen und weniger vom gestiegenen Token — das Ergebnis liegt unter dem blossen Halten. „Impermanent" heisst nur: solange nicht abgezogen wird, kann es sich bei zurückkehrenden Kursen wieder auflösen.' },
    { schluessel: 'tvl', kategorie: 'markt', niveau: 2, frage: 'Was sagt Total Value Locked (TVL) aus — und was nicht?', antwort: 'Wie viel Kapital gerade in einem Protokoll liegt. Gemessen wird in Dollar, also steigt der Wert auch dann, wenn nur die hinterlegten Token teurer werden — ohne einen einzigen neuen Nutzer.' },
    { schluessel: 'depeg', kategorie: 'markt', niveau: 2, frage: 'Was ist ein Stablecoin-Depeg?', antwort: 'Der Stablecoin verliert seine Bindung und handelt spürbar unter (oder über) einem Dollar. Für einen Futures-Händler doppelt heikel: die Sicherheit auf dem Konto verliert selbst an Wert, während die Kurse verrücktspielen.' },
    { schluessel: 'gas', kategorie: 'markt', niveau: 2, frage: 'Was sind Gas-Gebühren?', antwort: 'Der Preis für Rechenzeit im Netzwerk, fällig unabhängig vom Erfolg der Transaktion. Bei Andrang steigt er, weil um Blockplatz geboten wird — eine fehlgeschlagene Transaktion kostet trotzdem.' },
    { schluessel: 'layer2', kategorie: 'markt', niveau: 2, frage: 'Was ist ein Layer 2?', antwort: 'Ein Netzwerk, das Transaktionen abseits der Hauptkette bündelt und nur das Ergebnis dort verankert. Das senkt Gebühren, verlagert aber Vertrauen auf die Brücke und den Betreiber des Sequencers.' },
    { schluessel: 'staking', kategorie: 'markt', niveau: 2, frage: 'Was ist Staking und was ist Liquid Staking?', antwort: 'Staking: Coins werden zur Netzwerksicherung hinterlegt und verzinsen sich, sind dabei aber gebunden. Liquid Staking gibt dafür einen handelbaren Beleg-Token aus — der seinerseits vom Basiswert abweichen kann.' },
    { schluessel: 'airdrop', kategorie: 'markt', niveau: 2, frage: 'Was ist ein Airdrop und warum drückt er oft den Kurs?', antwort: 'Kostenlose Tokenverteilung an frühere Nutzer. Ein grosser Teil der Empfänger verkauft sofort — der Handelsstart trifft deshalb häufig auf massives Angebot ohne entsprechende Nachfrage.' },
    { schluessel: 'waschhandel', kategorie: 'markt', niveau: 2, frage: 'Was ist Wash Trading bei Börsenvolumen?', antwort: 'Handel mit sich selbst, um Umsatz vorzutäuschen. Für die Coin-Auswahl heisst das: ein hoher Umsatz in einer Rangliste ist erst dann ein Liquiditätsbeleg, wenn Spread und Orderbuchtiefe dazu passen.' },
    { schluessel: 'honeypot', kategorie: 'markt', niveau: 2, frage: 'Was ist ein Honeypot-Token?', antwort: 'Ein Token, den man kaufen, aber nicht wieder verkaufen kann — der Vertrag verbietet den Verkauf oder erhebt eine erdrückende Verkaufssteuer. Deshalb prüft man vor dem Kauf den Vertrag, nicht nur den Chart.' },
    { schluessel: 'tokenBurn', kategorie: 'markt', niveau: 2, frage: 'Was bewirkt ein Token-Burn?', antwort: 'Token werden nachweislich unbrauchbar gemacht, das Angebot sinkt. Kursrelevant ist das nur, wenn die verbrannte Menge im Verhältnis zum Umlauf ins Gewicht fällt — symbolische Burns ändern nichts.' },
    { schluessel: 'mev', kategorie: 'markt', niveau: 3, frage: 'Was ist MEV und was ist ein Sandwich-Angriff?', antwort: 'MEV ist der Wert, der sich aus der Anordnung von Transaktionen in einem Block ziehen lässt. Beim Sandwich sieht ein Bot einen anstehenden Tausch im offenen Mempool, kauft davor und verkauft danach — der schlechtere Kurs des Opfers ist sein Gewinn.' },
    { schluessel: 'bridgeRisiko', kategorie: 'markt', niveau: 3, frage: 'Warum gelten Bridges als besonders anfällig?', antwort: 'Eine Bridge sperrt Coins auf der einen Kette und gibt Abbilder auf der anderen aus. Damit liegt ein einzelner grosser Topf an einem einzigen Vertrag — die grössten Diebstähle der Kryptogeschichte betrafen genau diese Konstruktion.' },

    // ── On-Chain (Ergänzung) ─────────────────────────────────
    { schluessel: 'hashrate', kategorie: 'onchain', niveau: 2, frage: 'Was ist die Hashrate und was sagt sie aus?', antwort: 'Die gesamte Rechenleistung im Bitcoin-Netzwerk. Sie misst Sicherheit und Miner-Engagement, ist aber kein Kurssignal — sie folgt dem Preis eher, als dass sie ihn führt.' },
    { schluessel: 'lthSth', kategorie: 'onchain', niveau: 2, frage: 'Was unterscheidet Langfrist- von Kurzfristhaltern (LTH/STH)?', antwort: 'Die übliche Grenze liegt bei 155 Tagen Haltedauer. Verkäufe von Langfristhaltern in eine Stärke hinein gelten als Verteilung; Verluste von Kurzfristhaltern eher als Kapitulation der zuletzt Eingestiegenen.' },
    { schluessel: 'realizedPrice', kategorie: 'onchain', niveau: 2, frage: 'Was ist der Realized Price?', antwort: 'Die Realized Cap geteilt durch die Coin-Anzahl — der durchschnittliche Einstandspreis aller Halter. Fällt der Kurs darunter, sitzt der Markt im Schnitt im Verlust; historisch ein Bodenbereich, kein Kaufknopf.' },
    { schluessel: 'mvrvZ', kategorie: 'onchain', niveau: 3, frage: 'Was unterscheidet den MVRV-Z-Score vom einfachen MVRV?', antwort: 'Er misst den Abstand zwischen Markt- und Realized Cap in Standardabweichungen statt als blosses Verhältnis. Dadurch bleiben die Extreme über Jahre vergleichbar: sehr hohe Werte fielen mit Zyklushochs zusammen, negative mit Böden.' },
    { schluessel: 'puell', kategorie: 'onchain', niveau: 3, frage: 'Was misst das Puell Multiple?', antwort: 'Die täglichen Miner-Einnahmen im Verhältnis zu ihrem eigenen 365-Tage-Durchschnitt. Unter etwa 0,5 stehen Miner unter Druck (historisch nahe Böden), über etwa 4 verdienen sie ungewöhnlich gut (historisch nahe Hochs).' },
    { schluessel: 'mayer', kategorie: 'onchain', niveau: 3, frage: 'Was ist das Mayer Multiple?', antwort: 'Der aktuelle Kurs geteilt durch den 200-Tage-Durchschnitt. Werte ab etwa 2,4 galten Trace Mayer als Blasenbereich — eine grobe Einordnung über Jahre, nichts für eine einzelne Handelsentscheidung.' },
    { schluessel: 'hashRibbons', kategorie: 'onchain', niveau: 3, frage: 'Was zeigen die Hash Ribbons?', antwort: 'Zwei gleitende Durchschnitte der Hashrate (30 und 60 Tage). Fällt der kurze unter den langen, kapitulieren Miner; kreuzt er zurück darüber, galt das historisch als Bodenbildungssignal.' },
    { schluessel: 'hodlWaves', kategorie: 'onchain', niveau: 3, frage: 'Was zeigen HODL Waves?', antwort: 'Wie sich das Angebot nach Haltedauer aufteilt. Wachsende Bänder alter Coins heissen: es wird gehortet. Schwellen die jungen Bänder an, wechselt Angebot gerade den Besitzer — meist von alten zu neuen Händen.' },
    { schluessel: 'stockToFlow', kategorie: 'onchain', niveau: 3, frage: 'Was war das Stock-to-Flow-Modell und warum gilt es als gescheitert?', antwort: 'Es leitete einen Bitcoin-Preis allein aus dem Verhältnis von Bestand zu jährlichem Neuzugang ab. Ab 2021/22 lag es um Grössenordnungen daneben — ein Modell mit einer einzigen Eingangsgrösse kann Nachfrage nicht abbilden.' },
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
    const existing = await knex('quiz_karten')
        .select('id', 'schluessel', 'frage', 'antwort', 'kategorie', 'niveau', 'herkunft')
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
