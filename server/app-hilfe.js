/**
 * app-hilfe.js — Funktionsübersicht der Software für den KI-Agenten.
 *
 * Der Agent kennt von Haus aus nur die Trading-Daten. Fragen wie „wo stelle
 * ich den API-Schlüssel ein?" oder „was zeigt die Marktmechanik-Kachel?"
 * beantwortet ein LLM sonst aus Allgemeinwissen — bei einer selbstgebauten
 * Software ist das fast immer falsch. Dieses Modul ist die einzige Quelle,
 * aus der der Agent über die App selbst sprechen darf.
 *
 * Reines Datenmodul ohne Abhängigkeiten. Die Texte beschreiben die BEDIENUNG
 * (was findet man wo, wie funktioniert es), nicht die Implementierung —
 * Dateinamen und Tabellen gehören hier nicht hinein, die interessieren den
 * Nutzer der Oberfläche nicht.
 */

export const HILFE_THEMEN = {
    ueberblick: {
        titel: 'Überblick & Navigation',
        text: `Das Crypto Trading Journal ist eine lokale Einzelnutzer-App für Bitunix-Futures-Trading (zusätzlich werden Bitget und Pionex unterstützt). Es läuft auf dem eigenen Rechner oder NAS — keine Cloud, kein fremder Server; die Daten liegen in einer lokalen Datenbank.

Oben in der Leiste wird zwischen den Modi umgeschaltet:
- **Übersicht** — Landing-Page mit frei konfigurierbarem Kachelraster (Kontostand, Marktlage, News-Zusammenfassung); links steht dort dasselbe Seitenmenü wie im Journal.
- **Journal** — das eigentliche Trading-Journal: Dashboard, Tages-Ansicht, Kalender, Playbook, Auswertung, KI-Coach, Screenshots, Import.
- **Live-Analyse** — Marktradar (Kachelraster mit Marktdaten), Nachrichten, Open Interest, Liquidität (Bookmap), Liquidationen sowie das Live-Trading-Fenster mit Session-Archiv und -Auswertung.
- **Strategien (Beta)** — automatisch handelnde Strategie-Instanzen: Strategien, Setups, Editor, Baukasten, Performance, Labor, Coin-Rangliste. Über „Beta-Funktionen ausblenden" (Einstellungen → Layout & Stil) abschaltbar.
- **Entdecken (Research)** — zwei Radare mit gegensätzlichen Fragen: Hype-Radar („was ist neu draussen") und Coin-Radar („was lässt sich heute handeln"). Siehe Thema "entdecken".

Links im Seitenmenü: Börsen-Umschalter (Bitunix/Bitget/Pionex), Pille „Kontoübersicht", darunter die Seiten des aktiven Modus. Die Einstellungen sind modusübergreifend immer erreichbar. Oben rechts sitzt der Augen-Button (Zensur-Modus: verbirgt Kontostände und Beträge, z.B. für Screenshots) und daneben der Roboter-Button als Schnellzugriff auf den KI-Agenten.`,
    },
    journal: {
        titel: 'Journal: Dashboard, Tages-Ansicht, Kalender, Playbook, Auswertung, Screenshots',
        text: `- **Dashboard** — Kennzahlen und Charts über den gewählten Zeitraum: P&L, Win-Rate, Profit Factor, Verteilungen, Symbole. Oben rechts ein Export-Knopf (JSON/CSV der gefilterten Trades). Der Filter (Zeitraum, Tags, Long/Short, Brutto/Netto) sitzt in der Seitenleiste und wirkt auf Dashboard, Tages-Ansicht, Kalender, Screenshots und Auswertung. Achtung: ein vergessener Filter ist die häufigste Ursache für „es fehlen Trades".
- **Tages-Ansicht** — alle Trades eines Tages mit Notizen, Tags, Stress-/Emotionswerten, Screenshots und Trade-Bewertung (SL/TP-Verlauf, RRR). Hier wird das eigentliche Journal geführt.
- **Kalender** — Monatsraster mit Tages-P&L auf einen Blick.
- **Playbook** — eigene Setups/Strategien als Playbook-Einträge definieren; Trades lassen sich ihnen zuordnen, die Auswertung rechnet je Playbook.
- **Auswertung** — tiefere Analysen über den gewählten Zeitraum (Zeiten, Symbole, Verhalten).
- **Screenshots** — Chart-Screenshots ablegen, mit Markierungen versehen und Trades zuordnen; auf Wunsch bewertet die KI ein Bild.
- **Pendente Trades** — offene Positionen live von der Börse, inklusive SL/TP-Änderungsprotokoll.
- **Kontoübersicht** — Kontostände und Verlauf je Börse.
- **Manueller Import** — einzelne Trades von Hand erfassen (z.B. Börse ohne API).
- **KI-Coach** — siehe Thema "ki".`,
    },
    import: {
        titel: 'Trades importieren (CSV & API)',
        text: `Zwei Wege, Trades ins Journal zu bekommen:

1. **CSV-Import** (Seite „Imports" bzw. über die Import-Funktion): CSV-Export der Börse hochladen. Bitunix ist der Hauptweg („Futures Profit"/„Futures Loss"-Zeilen), Bitget wird ebenfalls unterstützt. Die Beträge aus der Bitunix-CSV sind bereits netto; Gebühren werden getrennt ausgewiesen.
2. **API-Import**: In den Einstellungen API-Schlüssel der Börse hinterlegen (Bitunix: Key + Secret; Bitget: Key + Secret + Passphrase; Pionex analog). Die Schlüssel werden verschlüsselt gespeichert und nie im Klartext angezeigt. Danach holt die App geschlossene Trades und offene Positionen direkt von der Börse; „Pendente Trades" zeigt offene Positionen live.

Nach dem Import lassen sich Trades in der Tages-Ansicht mit Notizen, Tags, Playbooks, Zufriedenheits-Bewertung und Screenshots anreichern. Bot-Trades (Grid u.ä.) können als eigene Kategorie geführt werden.`,
    },
    live_analyse: {
        titel: 'Live-Analyse: Marktradar, Nachrichten, Open Interest, Liquidität, Liquidationen',
        text: `- **Marktradar** — die Startseite des Modus: ein Kachelraster mit aktuellen Marktdaten. Kacheln: Fear & Greed, BTC-Dominanz, Funding-Raten, Long/Short + Open Interest, RSI-Streudiagramm, Marktübersicht, Rainbow-Chart, 24h-Liquidationen, Trades × Marktregime (die eigene Handelsbilanz je Marktlage), Altcoin-Saison, Pi Cycle Top, Marktmechanik (Regelwerk mit sechs Marktzuständen), Makro (ES/NQ-Futures, DXY, BTC↔Nasdaq-Korrelation, Stablecoin-Fluss) und „Gesamtlage". Kacheln lassen sich ein-/ausblenden, umsortieren und in der Grösse ändern (Zahnrad auf der Seite); ausgeblendete Kacheln werden gar nicht erst geladen. Jede Kachel hat einen Info-Knopf mit Erklärung und Quellenangabe.
- **Gesamtlage** — eine KI fasst per Knopfdruck zusammen, was alle Kacheln gerade zeigen (inkl. Widersprüche). Nur der Knopf erzeugt eine neue Einordnung und kostet einen KI-Aufruf (~30 s); das blosse Anzeigen ist gratis und liefert die letzte Einordnung.
- **Nachrichten** — KI-Zeitungsbericht (täglich oder wöchentlich, Kapitel Krypto/Finanzen/Tech/Chartanalyse wählbar, Länge kurz/mittel/lang, mit Archiv), Wirtschaftskalender (Zeitraum/Impact/Länder einstellbar) und die Roh-Meldungen der eingerichteten Quellen (RSS, YouTube mit KI-Zusammenfassung, Telegram, X, Truth Social). Das Kapitel „Chartanalyse" trägt per Recherche zusammen, was Analysten aktuell zur technischen Lage der fünf grössten Coins (nach Marktkapitalisierung, ohne Stablecoins) schreiben — inklusive Chart-Bildern aus den Artikeln; es wird nichts selbst gerechnet. Jeder Bericht beginnt mit einer Abwägung „Was dafür spricht / Was dagegen spricht / Woran es sich entscheidet"; jede Zeile ist als **Fakt** (steht so in den Quellen) oder **Einschätzung** (gedeutet) markiert, und „Woran es sich entscheidet" nennt beobachtbare Bedingungen — keine Empfehlungen, keine Kursziele. Die Darstellung des fertigen Berichts ist umschaltbar (Dossier ist die Vorgabe · Kombiniert · Zeitung · Kacheln); „Dossier" zeigt zuerst Tabellen — gemessener Marktstand zum Berichtszeitpunkt, die Termine der nächsten 36 Stunden und die wörtlichen Kennzahlen je Kapitel — und darunter die Meldungen mit Bild. Das Umschalten ändert nur die Anzeige, nicht den Bericht, und kostet nichts. Unter KI → Nachrichten gibt es ausserdem ein Feld „Eigene Anweisungen an die KI" (max. 2000 Zeichen): Ton, Schwerpunkte und Ausschlüsse für den Lagebericht, wirksam ab dem nächsten Lauf. Es steuert Stil und Auswahl, hebelt die Grundregeln aber nicht aus — keine Handelsempfehlungen, keine Kursziele, keine Prognosen, nichts Erfundenes. Bewusst nur in den Einstellungen und nicht auf der Nachrichten-Seite. Quellen und Filter (u.a. Schlagwort-Filter) werden in den Einstellungen unter KI → Nachrichten gepflegt.
- **Open Interest** — OI-Verlauf und -Analyse je Symbol.
- **Liquidität** — Bookmap/Heatmap des Orderbuchs.
- **Liquidationen** — Liquidationskarte mit Hebel-Clustern; die App zeichnet Liquidationen selbst auf (Binance + Bybit als Quellen).
- **Live-Trading** — siehe Thema "livetrading".

Für aktuelle Werte der Kacheln kann der KI-Agent das Werkzeug query_marktradar nutzen.`,
    },
    entdecken: {
        titel: 'Entdecken: Hype-Radar und Coin-Radar',
        text: `Der Modus „Entdecken" enthält zwei Radare. Sie stellen gegensätzliche Fragen und teilen sich eine Favoritenliste.

**Hype-Radar** — „was ist neu draussen, und was davon hat Substanz?" Er durchsucht CoinGecko, DexScreener und GeckoTerminal nach jungen Coin-Projekten, rechnet eine Hype-Note aus fünf Teilnoten (wie stark geredet wird, ob der Handel mitzieht, aus wie vielen unabhängigen Quellen der Fund stammt, ob er in ein laufendes Thema passt, wie jung das Handelspaar ist), prüft jeden Kandidaten hart auf Betrugsmuster (GoPlus, bei Solana RugCheck: Honeypot, Mint-Rechte, Halterkonzentration) und lässt erst danach ein Sprachmodell einen Bericht über die wenigen Übriggebliebenen schreiben.
- „Nur suchen" kostet nichts; „Suchen & Bericht" hängt die KI dran (wenige Cent bis etwa ein Franken je Lauf, je nach gewählter Stufe).
- Die Zahl der unabhängigen Quellen wiegt am schwersten: eine bezahlte Kampagne füllt eine Quelle, selten drei.
- Der Divergenz-Quadrant zeigt Aufmerksamkeit gegen Marktbestätigung — oben links sitzt gekaufter Lärm, den eine sortierte Liste nicht sichtbar macht.
- Zu jedem Fund steht, ob und wo er handelbar ist (Bitunix/Bitget/Pionex, getrennt nach Spot und Futures).

**Coin-Radar** — „welcher der handelbaren Coins lässt sich gerade am besten handeln?" Er geht die Coins durch, die auf Bitunix handelbar und bei Binance messbar sind (rund 500 Paare), und ordnet sie nach vier gemessenen Grössen:
- **ATR %** — wie stark sich der Coin bewegt, im Verhältnis zum Preis. Bewegt er sich zu wenig, frisst die Ausführung die Spanne.
- **RVOL** — Volumen der letzten Kerze gegen den Schnitt der zwanzig davor. Verglichen wird der Coin mit SICH SELBST; über 2,0 gilt als „im Spiel".
- **ADX** — trendet es (über 25) oder sägt es seitwärts (unter 20).
- **Funding** — auf ein Jahr hochgerechnet, INVERTIERT: teures Halten kostet Punkte.
Liquidität ist dabei eine HÜRDE und keine Teilnote: Umsatz unter 10 Mio USD oder Spread über 5 Basispunkte fliegt raus, bevor überhaupt gerechnet wird. Von rund 500 Paaren bleiben typisch siebzig bis neunzig übrig; wer woran gescheitert ist, zeigt „An den Hürden gescheitert".

Dazu eine ZWEITE, getrennte Note: die **Ausführungsgüte**. Für jeden übriggebliebenen Coin wird das echte Orderbuch von Bitunix UND Bitget geholt und ausgerechnet, was eine Order über 5 000 USD kostet — Kauf und Verkauf getrennt, denn ein Buch, das den Einstieg billig und den Ausstieg teuer macht, ist eine Falle, die kein Durchschnitt zeigt. Angezeigt wird auch, auf welcher der beiden Börsen es günstiger ist; die Unterschiede sind gross (im Testlauf: TREE 5 Basispunkte auf Bitunix, 54 auf Bitget). Beide Noten stehen NEBENEINANDER und werden nicht verrechnet — „bewegt sich viel" und „lässt sich günstig handeln" sind zwei Fragen. Pionex fehlt in dieser Messung, weil es 405 Spot-Märkte und keine Perpetuals führt.

**Erfolgskontrolle:** Zu den zwanzig Spitzenplätzen jedes Laufs wird festgehalten, was danach wirklich geschah (nach 15 Minuten, 1 Stunde, 4 Stunden), beim Hype-Radar nach 1, 7 und 30 Tagen. Gemessen wird die Spanne zwischen bestem und schlechtestem Punkt — die Seite verspricht Bewegung, nicht Richtung — und verglichen mit der unteren Hälfte der Liste. Ohne diesen Vergleich sähe an einem bewegten Tag auch eine gewürfelte Rangfolge glänzend aus.

Wichtig: Der Coin-Radar sagt NICHTS über die Richtung. Er trägt in die Gegenwart, weil Volatilität beharrlich ist (sie kommt in Phasen über Wochen bis Monate) — die Richtung ist es nicht. Eine hohe Note heisst „dieser Coin lässt sich derzeit handeln", nicht „er steigt".
- Ein Lauf dauert rund eine halbe Minute und kostet kein Geld; nur die kurze KI-Einordnung über der Tabelle kostet etwa einen Rappen und ist abschaltbar. Die Automatik ist ab Werk aus.
- Der Menüpunkt „Verlauf" zeigt die Rangkorrelation zum vorigen Lauf: nahe 1 hält die Liste, nahe 0 ist sie Rauschen — und dann sagt sie über die nächsten Stunden nichts.
- Jede Note lässt sich aufklappen: vier Teilnoten als Balken plus die Rohwerte je Zeiteinheit (Vorgabe 1h trägt die Note, 15m bestätigt oder widerspricht).

**Gemeinsame Favoriten und Wachhund** — der Stern in beiden Listen führt in dieselbe Beobachtungsliste. Ein Wachhund prüft sie im eigenen Takt (Vorgabe alle 15 Minuten) und meldet über die Alarm-Liste sowie optional ntfy, Telegram oder einen Webhook. Die Regeln unterscheiden sich nach Herkunft: bei Hype-Funden Preissprung, Tagesbewegung, Liquiditätsabfluss und eine erneut fehlschlagende Sicherheitsprüfung; bei Coin-Radar-Favoriten Preissprung, Tagesbewegung, Umsatzeinbruch, aufgehender Spread und extremes Funding — ein Bitunix-Perp hat keinen Liquiditätspool, der abfliessen könnte. Alle Schwellen stehen in den Einstellungen des Hype-Radars — Zahnrad oben links auf der Seite. Die Alarm-Liste lässt sich aufräumen: „alle gelesen" nimmt nur die Markierung weg, das Papierkorb-Zeichen rechts an einer Zeile löscht diesen Alarm und „alle löschen" die ganze Liste — beides braucht zwei Klicks, der erste schärft nur.`,
    },
    livetrading: {
        titel: 'Live-Trading: Sessions, Cockpit, Archiv, Auswertung',
        text: `Das Live-Trading-Fenster (Live-Analyse → Live-Trading) ist der Arbeitsplatz für die Stunden, in denen tatsächlich gehandelt wird. Nur am Desktop verfügbar (am Telefon per Einstellung freischaltbar) und über die Einstellung „Live-Trading" komplett abschaltbar.

- **Sessionplan zuerst**: Vor dem Start werden Max-Verlust, Max-Trades und die Absicht der Session festgelegt — danach ist der Plan nicht mehr änderbar. Die Session-Leiste zeigt laufend, wie viel vom Plan verbraucht ist; dabei zählt nur realisierter P&L gegen die Limits, Buchgewinne/-verluste offener Positionen nicht.
- **Cockpit**: Der Start öffnet ein eigenes Browserfenster ohne Menü und Navigation, damit während der Session nichts anderes in Reichweite ist. Vollbild gibt es als Knopf. Elf Kacheln, u.a. Kerzenchart, Orderbuch/Bookmap, Liquidations-Ticker, Index-Futures, Kalender-Countdown, Session-Stand.
- **Session-Archiv** (Live-Sessions): eine Zeile pro Session; die Kopfzahl ist nicht der P&L, sondern ob der Plan gehalten wurde. Sessions lassen sich archivieren statt löschen — die Disziplin-Statistik zählt archivierte bewusst mit. Gibt es eine Orderbuch-Aufzeichnung zum Zeitraum, wird ein Replay anklickbar (inkl. Sprungknöpfe zu Ein-/Ausstieg und Liquidationen).
- **Live-Auswertung**: vier Fragen — halte ich meinen Plan und werde ich besser, hilft der Plan überhaupt, zu welchen Zeiten handle ich gut, kippt es mit Dauer oder Trade-Zahl. Dünn besetzte Gruppen werden ausgegraut, damit drei Sessions an einem Dienstag nicht wie ein Befund aussehen.`,
    },
    strategien: {
        titel: 'Strategien-Modus (Beta): automatisches Handeln',
        text: `Der Strategien-Modus enthält Strategie-Instanzen, die eigenständig handeln — in drei Stufen: **Papier** (nur simuliert), **Schatten** (rechnet live mit, handelt nicht) und **Live**. Scharfes Handeln hängt an einer dreifachen Freigabekette: globaler Schalter, Freigabe je Instanz und eine Mindestzahl an Papier-Trades.

Seiten: **Strategien** (Instanzen anlegen/starten, immer benannt mit Strategie + Symbol + Zeiteinheit), **Setups** (erkannte Einstiege), **Editor** und **Baukasten** (eigene Regel-Strategien ohne Programmierung, auch per Chat), **Performance** (Auswertung der automatischen Trades), **Labor** (Backtests, Parameter-Läufe, Robustheit) und **Coin-Rangliste** (eine fertige Strategie über 100+ Coins ranken).

Trades der Strategie-Instanzen stehen NICHT im normalen Journal — der KI-Agent hat dafür eigene Abfrage-Werkzeuge. Der ganze Modus lässt sich über „Beta-Funktionen ausblenden" verstecken.`,
    },
    ki: {
        titel: 'KI-Funktionen: Coach, Agent, Berichte, Nachrichten, Bilder',
        text: `Alle KI-Funktionen laufen über die in den Einstellungen hinterlegten Anbieter (Ollama lokal, OpenAI, Anthropic, Gemini, DeepSeek). Unter Einstellungen → KI gibt es Unter-Reiter: **Zugang** (Schlüssel je Anbieter, Modellverwaltung), **Berichte**, **Nachrichten**, **Agent**, **Strategie** und **Bilder** — Anbieter und Modell sind je Funktion getrennt wählbar. Jeder Aufruf gegen einen Bezahl-Anbieter kostet Geld; die Token-Verbräuche werden mitgezählt und angezeigt.

- **KI-Coach → Berichte**: Trading-Berichte über einen Zeitraum (Monat/Woche/frei) in wählbarem Stil (kurz, standard, strenger Coach, Psychologie), als PDF exportierbar, mit Rückfrage-Chat je Bericht.
- **KI-Coach → Agent**: der Chat-Agent, der selbstständig die Journal-Daten abfragt (Trades, Notizen, Statistiken, SL/TP-Muster, Screenshots, Strategie-Instanzen), die aktuellen Marktradar-Werte lesen kann und Fragen zur Bedienung der Software beantwortet. Gespräche werden als Sessions gespeichert. Jeder Lauf hat ein Token-Budget (einstellbar unter Einstellungen → KI → Agent, Voreinstellung 80'000); ist es erreicht, fasst der Agent die bis dahin gesammelten Ergebnisse zusammen — bei knappem Budget hilft es, die Frage enger zu stellen (kürzerer Zeitraum, ein Symbol).
- **Nachrichten-Bericht**: der KI-Zeitungsbericht auf der Nachrichten-Seite (siehe Thema "live_analyse").
- **Gesamtlage-Kachel**: KI-Zusammenfassung des Marktradars per Knopfdruck.
- **Share Cards**: stilisierte Trade-Bilder zum Teilen, KI-generierter Hintergrund (FLUX) plus Trade-Daten als Overlay.
- **Screenshot-Analyse**: die KI bewertet Chart-Screenshots (nur mit bildfähigen Modellen).`,
    },
    einstellungen: {
        titel: 'Einstellungen, Sicherheit, Backup, Update, Extras',
        text: `Die Einstellungen (Zahnrad im Seitenmenü) sind in Reiter gegliedert; das Wichtigste:

- **Börsen/API-Schlüssel**: Bitunix, Bitget, Pionex — Schlüssel werden verschlüsselt gespeichert.
- **KI**: Anbieter, Schlüssel, Modelle und Optionen je Funktion (siehe Thema "ki").
- **Layout & Stil**: dunkles Design, Beta-Funktionen ausblenden, Live-Trading auf dem Handy freischalten, Sprache (Deutsch/Englisch).
- **Sicherheit**: optionales Passwort-Login (Auth-Gate) für den Zugriff übers Netz; Update-PIN.
- **Backup**: JSON-Export/-Import aller Daten. Sensible Schlüssel werden beim Export ausgelassen.
- **Update**: Prüfung auf neue Versionen (GitHub) und Ein-Klick-Update.
- **ESP32-Display**: Anbindung eines kleinen Hardware-Displays (CYD), das Kennzahlen anzeigt; eigener API-Schlüssel in den Einstellungen.
- **Zensur-Modus**: der Augen-Button oben rechts verbirgt Kontostände und Beträge — für Screenshots und Streams; die Einstellung überlebt den Neustart.

Die App läuft standardmässig nur lokal (127.0.0.1). Für Zugriff aus dem Netzwerk muss der Server entsprechend gestartet werden — dann ist das Passwort-Login dringend zu empfehlen.`,
    },
}

/** Kurzliste aller Themen — die Antwort, wenn kein (oder ein unbekanntes) Thema gefragt ist. */
export function hilfeUebersicht() {
    return Object.entries(HILFE_THEMEN).map(([id, t]) => ({ thema: id, titel: t.titel }))
}

/** Text zu einem Thema oder `null`, wenn es das Thema nicht gibt. */
export function hilfeThema(thema) {
    // `Object.hasOwn`, nicht bloss ein Zugriff: `HILFE_THEMEN['constructor']`
    // wäre sonst wahr und lieferte ein Thema mit `titel: undefined`, statt die
    // Themenliste zurückzugeben. Das Modell darf beliebige Strings schicken.
    const schluessel = String(thema || '').toLowerCase().trim()
    if (!Object.hasOwn(HILFE_THEMEN, schluessel)) return null
    const t = HILFE_THEMEN[schluessel]
    return { titel: t.titel, text: t.text }
}
