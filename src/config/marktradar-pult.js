/**
 * Aufbau des Marktradar-Pults.
 *
 * Gleiche Form wie im Live-Fenster (`config/pult.js`), andere Frage. Das
 * Live-Pult beantwortet „wie steht es um meine Sitzung"; hier lautet sie „in
 * welchem Markt bin ich überhaupt". Deshalb dieselben fünf Zonen, aber andere
 * Bänder und eine andere Bühne.
 *
 * Die Kachel-Ids sind dieselben wie in `src/config/marktradar.js` — das Pult
 * zeichnet dieselben Daten neu und holt nichts Eigenes.
 */

/**
 * Die Bühne. Vier Kacheln vertragen wirklich Fläche, und zwar aus zwei
 * Gründen: `markt` und `rsi` sind Übersichten über hunderte Coins (im Raster
 * stehen sie deshalb schon auf `spalten: 2`), `dom` und `rainbow` sind
 * mehrjährige Verläufe, bei denen die Kurvenform die Aussage ist.
 *
 * Der Reihe nach beantworten sie: was bewegt sich gerade (markt), wo ist es
 * überdehnt (rsi), wohin fliesst das Geld (dom), und wo im Zyklus stehen wir
 * (rainbow).
 */
export const BUEHNEN = [
    { id: 'markt', titleKey: 'marktradar.markt.title', icon: 'uil uil-web-grid' },
    { id: 'rsi', titleKey: 'marktradar.rsi.title', icon: 'uil uil-temperature-half' },
    { id: 'dom', titleKey: 'marktradar.dom.title', icon: 'uil uil-chart-pie' },
    { id: 'rainbow', titleKey: 'marktradar.rainbow.title', icon: 'uil uil-rainbow' },
]

/**
 * Die Instrumentenleiste, von oben nach unten in der Reihenfolge, in der man
 * sie beim Einschätzen braucht: erst der Zustand des gewählten Marktes, dann
 * die Positionierung aller anderen, dann die Aussenwelt.
 *
 * Fear & Greed, Altseason, Dominanz, Regenbogen, Pi-Cycle und die ETF-Flüsse
 * fehlen hier NICHT: sie stehen in den beiden Bändern oben. Eine Kachel, deren
 * ganzer Inhalt eine Zahl auf einer Skala ist, gehört auf die Skala und nicht
 * in einen eigenen Kasten.
 */
export const LEISTE = [
    { id: 'mechanik', titleKey: 'marktradar.mechanik.title' },
    { id: 'lsoi', titleKey: 'marktradar.lsoi.title' },
    { id: 'funding', titleKey: 'marktradar.funding.title', eigen: 'funding' },
    { id: 'liq24', titleKey: 'marktradar.liq.title' },
    { id: 'makro', titleKey: 'marktradar.makro.title' },
]

/*
 * `regime` („Deine Trades × Marktregime") stand hier und ist wieder raus.
 *
 * Es ist eine Rückschau auf die eigenen Trades, sortiert nach der damaligen
 * Marktstimmung — eine Auswertung, keine Messung. Auf die Frage, die das Pult
 * beantwortet („in welchem Markt bin ich gerade"), sagt sie nichts, und als
 * höchstes Instrument der Leiste hat sie die übrigen aus dem Bild geschoben.
 * Im Raster bleibt sie, dort ist sie am richtigen Platz.
 */

/**
 * Alle Kacheln, die das Pult braucht — unabhängig davon, was im Raster
 * ausgeblendet ist. Geht als `immerLaden` an `useKachelRaster`.
 *
 * `lage` steht drin, obwohl es nur den Fuss speist: der Endpunkt LIEST bloss,
 * was schon erzeugt wurde (erzeugt wird per Knopf und kostet Geld), ein Abruf
 * ist also harmlos.
 */
export const PULT_KACHELN = [
    ...LEISTE.map(l => l.id),
    ...BUEHNEN.map(b => b.id),
    'fng', 'altseason', 'picycle', 'etf', 'lage',
]
