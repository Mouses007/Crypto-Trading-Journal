/**
 * Selbsttest der Zugangsschicht — ohne Datenbank und ohne laufenden Server.
 *
 *   node server/__selftest-auth.mjs
 *
 * Geprüft wird genau der Teil, der ohne DB entscheidbar ist: wann der Server
 * das Session-Cookie überhaupt verteilt. Das ist die Stelle, an der ein Fehler
 * am teuersten wäre — ohne Passwort-Gate bekommt JEDER Besucher beim ersten
 * Seitenaufruf ein gültiges Cookie und damit Broker-Schlüssel, Handel und
 * Backup. Solange der Dienst nur auf 127.0.0.1 lauscht, ist das in Ordnung;
 * netzwerkweit ist es eine offene Tür.
 *
 * `authConfig` steht ohne `loadAuthConfig()` auf { enabled: false } — also
 * genau der Fall, den diese Prüfungen brauchen.
 */

import { istLoopbackHost, setzeBindungsModus, offenerBetriebErlaubt, sessionCookieMiddleware, istErlaubterHost } from './auth.js'
import { pruefeKiEndpunkt } from './ollama-url.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Minimal-Attrappe für res: merkt sich nur die gesetzten Kopfzeilen. */
function laufe(url) {
    const kopf = {}
    let weiter = false
    sessionCookieMiddleware(
        { url },
        { setHeader: (k, v) => { kopf[k] = v } },
        () => { weiter = true },
    )
    return { cookie: kopf['Set-Cookie'] || '', weiter }
}

console.log('\nBind-Adresse\n')

for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]']) {
    check(`„${h}" gilt als lokal`, istLoopbackHost(h) === true)
}
for (const h of ['0.0.0.0', '192.168.178.100', '::', 'example.com', '', undefined, null]) {
    check(`„${h}" gilt NICHT als lokal`, istLoopbackHost(h) === false)
}

console.log('\nCookie-Vergabe ohne Passwortschutz\n')

{
    const alt = process.env.CTJ_ALLOW_INSECURE
    delete process.env.CTJ_ALLOW_INSECURE

    setzeBindungsModus(true)
    check('lokal gebunden: Betrieb ohne Gate ist erlaubt', offenerBetriebErlaubt() === true)
    const lokal = laufe('/dashboard')
    check('lokal gebunden: Seitenaufruf bekommt ein Cookie', lokal.cookie.includes('tn_session='), lokal.cookie)
    check('Cookie ist httpOnly und SameSite=Strict',
        lokal.cookie.includes('HttpOnly') && lokal.cookie.includes('SameSite=Strict'), lokal.cookie)
    check('API-Aufrufe bekommen nie ein Cookie zugeteilt', laufe('/api/db/trades').cookie === '')

    setzeBindungsModus(false)
    check('netzwerkweit gebunden: offener Betrieb ist nicht erlaubt', offenerBetriebErlaubt() === false)
    const netz = laufe('/dashboard')
    check('netzwerkweit ohne Gate: KEIN Cookie mehr', netz.cookie === '', netz.cookie)
    check('die Middleware ruft trotzdem next()', netz.weiter === true)

    // Der ausdrückliche Übersteuerungs-Schalter muss weiterhin greifen, sonst
    // stünde jemand, der es bewusst so will, plötzlich vor verschlossener Tür.
    process.env.CTJ_ALLOW_INSECURE = '1'
    check('CTJ_ALLOW_INSECURE=1 erlaubt den offenen Betrieb wieder', offenerBetriebErlaubt() === true)
    check('und verteilt dann auch wieder Cookies', laufe('/dashboard').cookie.includes('tn_session='))

    process.env.CTJ_ALLOW_INSECURE = '0'
    check('jeder andere Wert zählt nicht als Freigabe', offenerBetriebErlaubt() === false)

    if (alt === undefined) delete process.env.CTJ_ALLOW_INSECURE
    else process.env.CTJ_ALLOW_INSECURE = alt
    setzeBindungsModus(true)
}

console.log('\nHost-Header (DNS-Rebinding)\n')

{
    const altHosts = process.env.CTJ_ALLOWED_HOSTS
    delete process.env.CTJ_ALLOWED_HOSTS

    // Das, worüber der Dienst wirklich aufgerufen wird, muss durch:
    for (const h of ['localhost:8080', '127.0.0.1:8080', '127.0.0.1', '[::1]:8080',
        '192.168.178.100:8080', '10.0.0.5', '172.20.1.2:8080', '100.100.1.1']) {
        check(`„${h}" ist erlaubt`, istErlaubterHost(h) === true)
    }
    // Kein Host-Header = HTTP/1.0-Klient (ESP-Display) — kein Browser, kein Rebinding.
    check('fehlender Host-Header ist erlaubt (ESP32, curl)', istErlaubterHost(undefined) === true)

    // Und das ist der Angriff: eine registrierbare Domain, die auf 127.0.0.1 zeigt.
    for (const h of ['evil.example:8080', 'rebind.attacker.io', '8.8.8.8', '203.0.113.7:8080']) {
        check(`„${h}" wird abgewiesen`, istErlaubterHost(h) === false)
    }

    process.env.CTJ_ALLOWED_HOSTS = 'mein-nas.beispiel.de, journal.local'
    check('CTJ_ALLOWED_HOSTS ergänzt eigene Namen', istErlaubterHost('mein-nas.beispiel.de:8080') === true)
    check('andere Domains bleiben trotzdem draussen', istErlaubterHost('evil.example') === false)

    if (altHosts === undefined) delete process.env.CTJ_ALLOWED_HOSTS
    else process.env.CTJ_ALLOWED_HOSTS = altHosts
}

console.log('\nFrei eingetragene KI-Endpunkte\n')

{
    const abgelehnt = async (url) => {
        try { await pruefeKiEndpunkt(url); return false } catch { return true }
    }
    const angenommen = async (url) => {
        try { await pruefeKiEndpunkt(url); return true } catch { return false }
    }

    check('file:// wird abgelehnt', await abgelehnt('file:///etc/passwd'))
    check('Zugangsdaten in der Adresse werden abgelehnt', await abgelehnt('http://nutzer:geheim@example.com/v1'))
    check('Metadaten-Name wird abgelehnt', await abgelehnt('http://metadata.google.internal/v1'))
    check('.internal-Namen werden abgelehnt', await abgelehnt('http://irgendwas.internal/v1'))
    // Literale Adressen lösen ohne Netz auf — deshalb hier prüfbar.
    check('Cloud-Metadaten-Adresse wird abgelehnt', await abgelehnt('http://169.254.169.254/latest/meta-data/'))
    check('Multicast-Bereich wird abgelehnt', await abgelehnt('http://239.1.2.3/v1'))

    // Und das, was diese Felder gerade ermöglichen sollen, bleibt erlaubt:
    // ein selbst gehostetes Modell im eigenen Netz.
    check('eigener Rechner bleibt erlaubt', await angenommen('http://127.0.0.1:8000/v1'))
    check('eigenes Netz bleibt erlaubt', await angenommen('http://192.168.178.50:8000/v1'))
    check('öffentlicher Anbieter bleibt erlaubt', await angenommen('https://8.8.8.8/v1'))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
