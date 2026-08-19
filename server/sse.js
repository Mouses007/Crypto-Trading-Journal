/**
 * sse.js — Abbrucherkennung für Server-Sent-Events-Antworten.
 *
 * Klein, aber teuer erkauft: Der KI-Agent schwieg tagelang komplett, weil die
 * Abbrucherkennung am REQUEST hing (`req.on('close')`). Bei einem POST feuert
 * dieses Ereignis, sobald der Anfrage-Body zu Ende gelesen ist — also
 * praktisch sofort, lange vor jedem Abbruch. Der Lauf hielt sich damit selbst
 * für abgebrochen und unterdrückte jedes Ereignis; im Log stand nichts, weil
 * technisch nichts schieflief.
 *
 * Richtig ist die ANTWORT: `res.on('close')` feuert, wenn die Antwort­verbindung
 * endet — beim normalen Abschluss ebenso wie beim vorzeitigen Abbruch.
 * `writableFinished` trennt die beiden Fälle.
 *
 * Der Fix musste an zwei Stellen gemacht werden (Agent-Lauf und Modell-
 * Download); deshalb steht er jetzt hier und nicht mehr zweimal im Code.
 */

/**
 * Abbruch der Antwortverbindung beobachten.
 *
 * @param {import('http').ServerResponse} res
 * @returns {() => boolean} true, sobald der Client vorzeitig abgebrochen hat
 */
export function beobachteAbbruch(res) {
    let abgebrochen = false
    res.on('close', () => { if (!res.writableFinished) abgebrochen = true })
    return () => abgebrochen
}

/**
 * Sende-Funktion für eine SSE-Antwort. Schreibt nichts mehr, sobald der Client
 * weg ist oder die Antwort beendet wurde — ein `write` auf eine tote
 * Verbindung wirft sonst und reisst den laufenden Vorgang mit.
 *
 * @param {import('http').ServerResponse} res
 * @param {() => boolean} istAbgebrochen aus `beobachteAbbruch`
 */
export function sseSender(res, istAbgebrochen) {
    return (daten) => {
        if (istAbgebrochen() || res.writableEnded) return
        res.write(`data: ${JSON.stringify(daten)}\n\n`)
    }
}
