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
 * `niveau` unterscheidet zwei Tiefen: 1 sind Grundbegriffe, die die App an
 * ihren eigenen Kacheln bereits erklärt (InfoTipp-Texte). 2 sind vertiefte
 * Konzepte, die im Journal selbst nicht vorkommen (On-Chain-Kennzahlen,
 * Derivate-Feinheiten, Risiko-Kennzahlen, Netzwerk-Mechanik) — recherchiert
 * und faktengeprüft, keine App-eigene Quelle.
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
    { schluessel: 'fearGreed', kategorie: 'sentiment', frage: 'Was misst der Fear & Greed Index?', antwort: 'Wie ängstlich oder gierig der Markt insgesamt ist — Stimmung, nicht Kurs. Extreme sind interessant, aber kein direktes Kauf-/Verkaufssignal: der Zustand kann wochenlang extrem bleiben.' },
    { schluessel: 'dominance', kategorie: 'sentiment', frage: 'Was zeigt die BTC-Dominanz?', antwort: 'Welcher Anteil des Kryptomarkts auf Bitcoin entfällt. Steigende Dominanz bei fallenden Kursen heisst: Geld flüchtet aus Altcoins in BTC, es kommt kein neues Geld herein.' },
    { schluessel: 'altseason', kategorie: 'sentiment', frage: 'Ab welchem Wert spricht man von Altcoin-Saison?', antwort: 'Über 75 gilt als Altcoin-Saison (Alt-Longs haben Rückenwind), unter 25 als Bitcoin-Saison (Alts laufen oft schwächer als BTC). Die Schwellen sind gesetzt, nicht mathematisch hergeleitet.' },
    { schluessel: 'makroKopplung', kategorie: 'sentiment', frage: 'Was zeigt die Kopplung BTC↔Nasdaq?', antwort: 'Wie stark sich Bitcoin gerade wie ein Tech-Aktien-Future verhält. Ein steigender Dollar-Index gilt dabei als Gegenwind für Krypto, unabhängig davon, ob der Dollar selbst „gut" oder „schlecht" performt.' },
    { schluessel: 'stablecoinFluss', kategorie: 'sentiment', frage: 'Was sagt ein Zufluss von Stablecoins auf Börsen?', antwort: 'Kapital, das bereit steht, in den Markt zu gehen — meist als leicht bullisches Vorzeichen gelesen, ohne selbst schon eine Kursbewegung zu sein.' },
    { schluessel: 'etfFluss', kategorie: 'sentiment', frage: 'Was zeigt der ETF-Fluss bei Bitcoin?', antwort: 'Wie viel BTC institutionell über Spot-ETFs gehalten wird und ob täglich mehr hinein- oder herausfliesst. Ein anhaltender Abfluss über mehrere Tage wiegt schwerer als ein einzelner roter Tag.' },

    // ── Chartanalyse ────────────────────────────────────────
    { schluessel: 'piCycleTop', kategorie: 'chartAnalyse', frage: 'Was ist das Pi-Cycle-Top-Signal?', antwort: 'Ein historisches Muster (Kreuzung zweier gleitender Durchschnitte), das in der Vergangenheit nahe an einem Bitcoin-Zyklushoch auftrat. Drei Treffer bei drei Gelegenheiten sind eine Beobachtung, keine verlässliche Regel.' },
    { schluessel: 'rainbowChart', kategorie: 'chartAnalyse', frage: 'Was zeigt der Bitcoin-Rainbow-Chart?', antwort: 'Wo der Kurs langfristig innerhalb seiner historischen Bandbreite steht, von „Ausverkauf" bis „Blase". Die Bänder verschieben sich mit jedem neuen Kurs — für eine einzelne Handelsentscheidung zu grob.' },
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
    { schluessel: 'spotFutures', kategorie: 'risiko', frage: 'Was ist der Kernunterschied zwischen Spot- und Futures-Handel?', antwort: 'Beim Spot-Handel wird der Basiswert tatsächlich besitzt gekauft/verkauft. Futures sind ein Vertrag auf den zukünftigen Preis, meist gehebelt und ohne den Coin selbst zu halten.' },
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
]

/**
 * Idempotentes Seeding — nach dem exakten Muster von
 * `seedDefaultTemplates` in default-templates.js: fehlende Karten anhand
 * ihres `schluessel` finden und nur diese einfügen. Bestehende Karten
 * (auch wenn der User sie inzwischen editiert oder deaktiviert hat) bleiben
 * unangetastet, damit ein späteres Deck-Update den Lernfortschritt nie
 * zurücksetzt.
 */
export async function seedDefaultLernkarten(knex) {
    const existing = await knex('quiz_karten')
        .select('schluessel')
        .whereIn('schluessel', LERNKARTEN_DEFS.map(k => k.schluessel))
    const existingKeys = new Set(existing.map(r => r.schluessel))

    const missing = LERNKARTEN_DEFS.filter(k => !existingKeys.has(k.schluessel))
    if (missing.length === 0) return

    console.log(` -> Seeding ${missing.length} default Lernkarten...`)

    for (const def of missing) {
        const [eingefuegt] = await knex('quiz_karten').insert({
            schluessel: def.schluessel,
            frage: def.frage,
            antwort: def.antwort,
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
