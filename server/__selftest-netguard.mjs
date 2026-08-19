/**
 * Selbsttest: SSRF-Schutzwall (`net-guard.js`).
 *
 * Läuft ohne Netz und ohne Datenbank — geprüft wird die reine Bereichslogik,
 * nicht die Namensauflösung. Anlass war ein Fehlalarm: die Prüfung sperrte
 * `192.0.0.0/16` statt der beiden tatsächlich reservierten /24-Blöcke und
 * hielt damit TechCrunch (Automattic, 192.0.66.0/24) für eine interne Adresse.
 *
 * Der Test steht bewusst in beide Richtungen: was intern ist, MUSS gesperrt
 * bleiben — ein zu weit geöffneter Schutzwall wäre schlimmer als der Fehlalarm.
 *
 * Aufruf: node server/__selftest-netguard.mjs
 */
import { istPrivatV4, istPrivatV6, holeText } from './net-guard.js'

let fehler = 0
// Auch die bestandenen zählen: `scripts/run-selftests.mjs` liest das Zahlenpaar
// aus der Schlussmeldung. Ohne es zählte die ganze Datei als EINE Prüfung —
// die Gesamtsumme des Sammellaufs war dadurch deutlich zu niedrig.
let bestanden = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('SSRF-Schutzwall')

// 1) Internes bleibt gesperrt — das ist der Zweck des Ganzen.
for (const ip of [
    '10.0.0.1', '10.255.255.254',
    '127.0.0.1', '127.1.2.3',
    '192.168.0.1', '192.168.178.100',      // das eigene Heimnetz
    '172.16.0.1', '172.31.255.254',
    '169.254.169.254',                      // Cloud-Metadaten, der teuerste Treffer
    '100.64.0.1', '100.127.0.1',            // CGNAT / Tailscale
    '198.18.0.1', '198.19.255.254',         // Messbereich
    '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '192.0.0.1', '192.0.0.171',             // IETF-Protokollzuweisungen
    '192.0.2.1', '192.0.2.255',             // TEST-NET-1
]) pruefe(`${ip} bleibt gesperrt`, istPrivatV4(ip) === true)

// 2) Öffentliches muss durchkommen — sonst fallen echte Quellen aus.
for (const ip of [
    '192.0.66.220',                         // Automattic: TechCrunch
    '192.0.1.1', '192.0.3.1', '192.0.255.1', // übriges 192.0/16, regulär vergeben
    '1.1.1.1', '8.8.8.8',
    '172.15.0.1', '172.32.0.1',             // knapp neben dem privaten Block
    '192.167.0.1', '192.169.0.1',           // knapp neben 192.168/16
    '169.253.0.1', '169.255.0.1',           // knapp neben der Metadaten-Adresse
    '100.63.0.1', '100.128.0.1',            // knapp neben CGNAT
    '198.17.0.1', '198.20.0.1',             // knapp neben dem Messbereich
    '223.255.255.255',                      // letzte Adresse vor Multicast
]) pruefe(`${ip} kommt durch`, istPrivatV4(ip) === false)

// 3) Unsinn gilt als gesperrt — im Zweifel zu, nicht auf.
for (const murks of ['', 'abc', '1.2.3', '1.2.3.4.5', '999.1.1.1', '-1.0.0.1', '1.2.3.x']) {
    pruefe(`„${murks}" gilt als gesperrt`, istPrivatV4(murks) === true)
}

// 4) IPv6, inklusive der eingebetteten IPv4-Form.
for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:192.168.0.1']) {
    pruefe(`${ip} bleibt gesperrt`, istPrivatV6(ip) === true)
}
for (const ip of ['2001:4860:4860::8888', '2606:4700:4700::1111', '::ffff:1.1.1.1', '::ffff:192.0.66.220']) {
    pruefe(`${ip} kommt durch`, istPrivatV6(ip) === false)
}

/*
 * 5) Wiederholung bei vorübergehenden Fehlern.
 *
 * Anlass: YouTube beantwortete `feeds/videos.xml` am 19.08.2026 in rund der
 * Hälfte der Fälle mit 404 (Rumpf: Googles „Error 500"-Seite). Ein einziger
 * Anlauf liess dadurch reihum gültige Quellen als kaputt erscheinen.
 *
 * Weiterhin ohne Netz: `www.youtube.com` steht in `FESTE_HOSTS` und wird
 * deshalb nicht aufgelöst, und `fetch` ist hier ein Platzhalter.
 */
const FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCtest'
const echterFetch = globalThis.fetch

/** Ersetzt `fetch` durch eine Liste vorgegebener Antworten; zählt die Aufrufe. */
function stelleFetch(antworten) {
    const zaehler = { n: 0 }
    globalThis.fetch = async () => {
        const naechste = antworten[Math.min(zaehler.n, antworten.length - 1)]
        zaehler.n++
        if (naechste instanceof Error) throw naechste
        return naechste()
    }
    return zaehler
}

const text = (t, status = 200) => () => new Response(t, { status })
const leer = (status, kopf = {}) => () => new Response(null, { status, headers: kopf })

{   // Zwei Fehlschläge, dann Erfolg — der Abruf gelingt trotzdem
    const z = stelleFetch([text('', 404), text('', 404), text('<feed>ja</feed>')])
    let ergebnis = ''
    try { ergebnis = await holeText(FEED) } catch (e) { ergebnis = `FEHLER ${e.message}` }
    pruefe('404, 404, 200 → Feed kommt an', ergebnis === '<feed>ja</feed>', ergebnis)
    pruefe('dafür drei Anläufe', z.n === 3, `${z.n} Abrufe`)
}

{   // Dauerhaft 404 — der Fehler kommt durch, aber erst nach allen Anläufen
    const z = stelleFetch([text('', 404)])
    let meldung = ''
    try { await holeText(FEED) } catch (e) { meldung = e.message }
    pruefe('dauerhaft 404 → HTTP 404', meldung === 'HTTP 404', meldung)
    pruefe('dafür drei Anläufe', z.n === 3, `${z.n} Abrufe`)
}

{   // 403 ist endgültig: kein zweiter Anlauf, das kostet nur Zeit
    const z = stelleFetch([text('', 403)])
    let meldung = ''
    try { await holeText(FEED) } catch (e) { meldung = e.message }
    pruefe('403 meldet HTTP 403', meldung === 'HTTP 403', meldung)
    pruefe('403 wird NICHT wiederholt', z.n === 1, `${z.n} Abrufe`)
}

{   // Netzfehler zählt als vorübergehend
    const z = stelleFetch([new Error('socket hang up'), text('ok')])
    let ergebnis = ''
    try { ergebnis = await holeText(FEED) } catch (e) { ergebnis = `FEHLER ${e.message}` }
    pruefe('Netzfehler, dann Erfolg', ergebnis === 'ok', ergebnis)
    pruefe('dafür zwei Anläufe', z.n === 2, `${z.n} Abrufe`)
}

{   // Wer nur einen Anlauf will, bekommt auch nur einen
    const z = stelleFetch([text('', 500)])
    try { await holeText(FEED, { versuche: 1 }) } catch { /* erwartet */ }
    pruefe('versuche: 1 hält sich daran', z.n === 1, `${z.n} Abrufe`)
}

{   // Umleitungen werden weiterhin verfolgt — der Umbau darf das nicht brechen
    const z = stelleFetch([
        leer(302, { location: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCneu' }),
        text('<feed>umgeleitet</feed>'),
    ])
    let ergebnis = ''
    try { ergebnis = await holeText(FEED) } catch (e) { ergebnis = `FEHLER ${e.message}` }
    pruefe('302 wird verfolgt', ergebnis === '<feed>umgeleitet</feed>', ergebnis)
    pruefe('Umleitung ist kein Fehlversuch', z.n === 2, `${z.n} Abrufe`)
}

{   // Eine Umleitung ins eigene Netz bleibt gesperrt — und zwar sofort
    const z = stelleFetch([leer(302, { location: 'http://127.0.0.1/geheim' })])
    let meldung = ''
    try { await holeText(FEED) } catch (e) { meldung = e.message }
    pruefe('Umleitung auf 127.0.0.1 wird abgewiesen', /eigene|interne/i.test(meldung), meldung)
    pruefe('und nicht wiederholt', z.n === 1, `${z.n} Abrufe`)
}

globalThis.fetch = echterFetch

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
