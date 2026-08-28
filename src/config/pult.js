/**
 * Aufbau des Pults — der zweiten Darstellung des Live-Trading-Fensters.
 *
 * Das Kachelraster hat eine Registry, weil dort JEDE Kachel gleichrangig ist
 * und der Nutzer die Anordnung bestimmt. Hier ist es umgekehrt: die Anordnung
 * IST die Aussage, und deshalb steht sie fest. Was hier als Liste steht, ist
 * also keine Auswahl, sondern ein Bauplan.
 *
 * Die Kachel-Ids sind dieselben wie in `src/config/livetrading.js` — das Pult
 * zeichnet dieselben Daten neu, es holt nichts Eigenes. Genau das ist der Sinn:
 * ein Wechsel der Ansicht kostet keinen einzigen Abruf.
 */

/**
 * Die Bühne — eine grosse Arbeitsfläche, umschaltbar.
 *
 * Nebeneinander gingen sie nicht: Bookmap und Hebelkarte hängen je an einer
 * eigenen Verbindung und wollen beide die volle Höhe. Sie konkurrieren also
 * ohnehin, und in einer Sitzung schaut man tatsächlich nur auf eine davon.
 *
 * ## Die Indizes sind hier, aber sie waren es fast nicht
 *
 * Sie flogen kurz raus, weil sie auf der grossen Fläche nichts hergaben: fünf
 * riesige Kerzen ohne Bezug. Das lag nicht an der Bühne, sondern am Abruf —
 * Yahoos `range=1d` meint bei einem Future die laufende reguläre Sitzung, und
 * die hatte morgens kaum begonnen (`NQ=F` am 27.08.2026 um 06:30 MESZ: zehn
 * Kerzen bei 5m, fünf bei 15m). Der Endpunkt holt jetzt immer fünf Tage und
 * schneidet auf ein wählbares Fenster zu, die Auflösung wandert mit. Damit
 * stehen rund 100 bis 150 Kerzen im Bild, gleich welches Fenster gewählt ist.
 *
 * Was bleibt, ist die Verzögerung: CME rund 10, ICE rund 30 Minuten. Die
 * Kachel schreibt sie an, gemessen und nicht behauptet — auf der Bühne muss
 * man das sehen können, sonst liest man einen alten Kurs als aktuellen.
 */
export const BUEHNEN = [
    { id: 'bookmap', titleKey: 'nav.liquidity', icon: 'uil uil-chart-line' },
    { id: 'hebelkarte', titleKey: 'nav.liquidations', icon: 'uil uil-fire' },
    { id: 'indizes', titleKey: 'livetrading.indizes.title', icon: 'uil uil-chart-line' },
]

/**
 * Die Instrumentenleiste rechts, von oben nach unten in der Reihenfolge, in
 * der man sie während einer Sitzung braucht: erst die eigene Lage, dann der
 * Marktzustand, dann die Positionierung, zuletzt die Aussenwelt.
 *
 * `eigen` benennt eine verdichtete Fassung. Nur Funding braucht eine — die
 * Kachel ist eine sortierbare Liste über bis zu hundert Märkte und lässt sich
 * nicht auf Leistenhöhe stauchen. Die übrigen Kacheln kommen unverändert zum
 * Einsatz, nur ohne Kachelrahmen.
 */
export const LEISTE = [
    { id: 'positionen', titleKey: 'livetrading.positionen.title' },
    { id: 'mechanik', titleKey: 'marktradar.mechanik.title' },
    { id: 'lsoi', titleKey: 'marktradar.lsoi.title' },
    { id: 'funding', titleKey: 'marktradar.funding.title', eigen: 'funding' },
    { id: 'makro', titleKey: 'marktradar.makro.title' },
]

/**
 * Alle Kacheln, die das Pult braucht — unabhängig davon, was im Raster
 * ausgeblendet ist.
 *
 * Geht als `immerLaden` an `useKachelRaster`. Ohne diese Liste entschiede das
 * Raster mit, was das Pult sehen darf: wer dort die Makro-Kachel ausblendet,
 * bekäme hier ein leeres Instrument ohne jeden Hinweis auf den Grund.
 *
 * Bookmap und Hebelkarte fehlen bewusst nicht aus Versehen — sie haben keinen
 * Endpunkt und holen selbst; `ladeKachel` liesse sie ohnehin liegen.
 * `handelszeiten` fehlt aus demselben Grund (rechnet lokal), `kalender` und
 * `liqticker` stehen drin, weil Zeitband und Laufband daran hängen.
 */
export const PULT_KACHELN = [
    ...LEISTE.map(l => l.id),
    'kalender',
    'liqticker',
    'indizes',
]
