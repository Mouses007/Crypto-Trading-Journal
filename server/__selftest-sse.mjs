/**
 * Regressionstest der SSE-Abbrucherkennung (`server/sse.js`).
 *
 *   node server/__selftest-sse.mjs
 *
 * Dieser Test existiert wegen eines Fehlers, der den KI-Agenten komplett
 * stummgeschaltet hat: die Abbrucherkennung hing am REQUEST (`req.on('close')`),
 * und bei einem POST feuert das, sobald der Anfrage-Body gelesen ist — also
 * sofort. Jedes Ereignis wurde daraufhin unterdrückt. Kein Stacktrace, keine
 * Fehlermeldung, nur Schweigen; genau deshalb blieb es tagelang unentdeckt.
 *
 * Geprüft wird gegen einen echten Express-Server auf Port 0 (Muster aus
 * `__selftest-crud.mjs`) — eine Attrappe würde den Fehler nicht zeigen, weil
 * er genau im Zusammenspiel von POST-Body, Antwortstrom und Node-Ereignissen
 * steckt. Kein Netz nach draussen, keine Datenbank.
 *
 * Gegenprobe gemacht: hängt man die Erkennung testweise wieder an `req`,
 * kommt genau ein Ereignis statt drei an und der Test schlägt fehl. Ein Test,
 * der den Fehler nicht sieht, wäre keiner.
 */

import express from 'express'
import http from 'node:http'
import { beobachteAbbruch, sseSender } from './sse.js'

let bestanden = 0
let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { bestanden++; console.log(`  ✓ ${name}`) }
    else { fehler++; console.log(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

const schlaf = (ms) => new Promise(r => setTimeout(r, ms))

const app = express()
app.use(express.json())

/** Der typische Agent-Fall: POST mit Body, Antwort als Ereignisstrom. */
app.post('/strom', async (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    })
    const istAbgebrochen = beobachteAbbruch(res)
    const sende = sseSender(res, istAbgebrochen)

    // Genau hier lag der Fehler: nach dem Lesen des Bodys galt der Lauf als
    // abgebrochen. Der Zustand wird deshalb mitgesendet.
    sende({ schritt: 1, abgebrochenNachBody: istAbgebrochen() })
    await schlaf(30)
    sende({ schritt: 2 })
    await schlaf(30)
    sende({ schritt: 3, fertig: true })
    res.end()
})

/** Zweiter Fall: der Client legt mitten im Strom auf. */
const abbruchLauf = { gesendetNachAbbruch: 0, erkannt: false, fertig: false }
app.post('/abbruch', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const istAbgebrochen = beobachteAbbruch(res)
    const sende = sseSender(res, istAbgebrochen)

    sende({ schritt: 1 })
    // Warten, bis der Client aufgelegt hat
    for (let i = 0; i < 50 && !istAbgebrochen(); i++) await schlaf(20)
    abbruchLauf.erkannt = istAbgebrochen()
    // Nach dem Abbruch darf nichts mehr geschrieben werden
    const vorher = res.writableLength ?? 0
    sende({ schritt: 2 })
    abbruchLauf.gesendetNachAbbruch = (res.writableLength ?? 0) - vorher
    abbruchLauf.fertig = true
    try { res.end() } catch { /* Verbindung ist ohnehin weg */ }
})

const server = http.createServer(app)
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port

/** POST absetzen und den Ereignisstrom bis zum Ende einsammeln. */
function holeStrom(pfad) {
    return new Promise((fertig, schiefgegangen) => {
        const anfrage = http.request(
            { host: '127.0.0.1', port, path: pfad, method: 'POST', headers: { 'content-type': 'application/json' } },
            (antwort) => {
                let text = ''
                antwort.on('data', (d) => { text += d })
                antwort.on('end', () => fertig({ text }))
            })
        anfrage.on('error', schiefgegangen)
        // Ein Body, der wirklich gelesen werden muss — sonst prüft der Test nichts
        anfrage.end(JSON.stringify({ message: 'x'.repeat(2048) }))
    })
}

console.log('SSE: Ereignisse kommen an, bevor die Verbindung endet')

{
    const { text } = await holeStrom('/strom')
    const zeilen = text.split('\n').filter(z => z.startsWith('data: ')).map(z => JSON.parse(z.slice(6)))

    pruefe('alle drei Ereignisse kommen an', zeilen.length === 3, `${zeilen.length} Ereignisse: ${text}`)
    pruefe('das erste Ereignis kommt an (der Agent schwieg genau hier)',
        zeilen[0]?.schritt === 1, JSON.stringify(zeilen[0]))
    pruefe('nach dem Lesen des POST-Bodys gilt der Lauf NICHT als abgebrochen',
        zeilen[0]?.abgebrochenNachBody === false, JSON.stringify(zeilen[0]))
    pruefe('das Abschluss-Ereignis trägt fertig: true',
        zeilen[2]?.fertig === true, JSON.stringify(zeilen[2]))
}

console.log('\nSSE: echter Client-Abbruch wird erkannt')

{
    await new Promise((fertig) => {
        const anfrage = http.request(
            { host: '127.0.0.1', port, path: '/abbruch', method: 'POST', headers: { 'content-type': 'application/json' } },
            (antwort) => {
                // Sobald das erste Ereignis da ist: auflegen
                antwort.once('data', () => { anfrage.destroy(); fertig() })
            })
        anfrage.on('error', () => fertig())
        anfrage.end(JSON.stringify({ message: 'x'.repeat(2048) }))
    })

    for (let i = 0; i < 100 && !abbruchLauf.fertig; i++) await schlaf(20)
    pruefe('der Abbruch wird erkannt', abbruchLauf.erkannt === true)
    pruefe('nach dem Abbruch wird nichts mehr geschrieben',
        abbruchLauf.gesendetNachAbbruch === 0, String(abbruchLauf.gesendetNachAbbruch))
}

server.close()
console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
