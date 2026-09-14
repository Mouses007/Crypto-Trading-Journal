/**
 * Selbsttest: Zugangs-Status der Börsen (`boersen-status.js`).
 *
 * Läuft ohne Netz und ohne Datenbank — geprüft wird nur die Einordnung einer
 * Fehlermeldung, und die entscheidet, ob eine Mail rausgeht.
 *
 * Die zweite Richtung ist die wichtigere: Ein Muster, das auch
 * Zeitüberschreitungen und Ratenlimits einsammelt, schickt bei jeder
 * Netzdelle eine Mail „Zugang abgelaufen" — und nach der dritten falschen
 * liest niemand mehr die vierte, die stimmt. Deshalb steht zu jedem Treffer
 * ein Gegenbeispiel.
 *
 * Aufruf: node server/__selftest-boersen-status.mjs
 */
import { istZugangsFehler, istVoruebergehend } from './boersen-status.js'

let fehler = 0
let bestanden = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Börsen-Zugangsstatus')

// ── 1) Echte Wortlaute der angebundenen Börsen ───────────────────────────
// Der Pionex-Fall ist der gemessene vom 14.09.2026, wörtlich aus dem Protokoll.
const ZUGANG = [
    'Pionex API: [APIKEY_EXPIRED] Apikey has expired',
    'Bitunix API Fehler: apiKey invalid',
    'Bitget: 40037 Apikey does not exist',
    'Bitget: 40006 Invalid ACCESS_KEY',
    'Request failed with status code 401',
    'HTTP 403 Forbidden',
    'error: invalid signature',
    'Signature verification failed',
    'permission denied: read-only key',
    'Your IP is not in the whitelist',
    'API key has been revoked',
    'passphrase is incorrect',
]
for (const m of ZUGANG) {
    pruefe(`Zugangsfehler erkannt: "${m.slice(0, 40)}"`, istZugangsFehler(m) === true)
}

// ── 2) Gegenprobe: vorübergehende Störungen sind KEIN Zugangsfehler ──────
const VORUEBERGEHEND = [
    'timeout of 15000ms exceeded',
    'connect ETIMEDOUT 104.18.0.1:443',
    'read ECONNRESET',
    'getaddrinfo EAI_AGAIN api.bitunix.com',
    'Request failed with status code 502',
    'Request failed with status code 503',
    'Request failed with status code 429',
    'Too Many Requests, rate limit exceeded',
    'Service temporarily unavailable, try again later',
    'socket hang up',
    // Zeitdrift meldet die Börse als abgelaufene SIGNATUR. Das ist keine
    // abgelaufene Erlaubnis, sondern eine falsch gehende Uhr — ein neuer
    // Schlüssel würde daran nichts ändern.
    'Signature expired, timestamp out of recvWindow',
    'Invalid timestamp, request outside of 20s window',
]
for (const m of VORUEBERGEHEND) {
    pruefe(`kein Zugangsfehler: "${m.slice(0, 40)}"`, istZugangsFehler(m) === false)
    pruefe(`als vorübergehend erkannt: "${m.slice(0, 40)}"`, istVoruebergehend(m) === true)
}

// ── 3) Gegenprobe: fachliche Fehler dürfen nicht als Zugang gelten ───────
// Diese Meldungen tauchen im Normalbetrieb auf. Würde eine davon als
// „Zugang weg" gelten, stünde dauerhaft ein falscher Vermerk auf der Seite.
const HARMLOS = [
    'Invalid symbol BTCUSDTX',
    'order does not exist',
    'insufficient balance',
    'Bitget: 41103 no position to close',
    'startTime is more than 90 days ago',
    '',
    null,
    undefined,
]
for (const m of HARMLOS) {
    pruefe(`harmlos bleibt harmlos: "${String(m).slice(0, 40)}"`, istZugangsFehler(m) === false)
}

// Ein „invalid symbol" enthält das Wort invalid und darf trotzdem nicht
// greifen — das ist der Grund für die enge Fassung des zweiten Musters.
pruefe('„invalid symbol" ist kein Schlüsselproblem', istZugangsFehler('invalid symbol') === false)
pruefe('„invalid parameter" ist kein Schlüsselproblem', istZugangsFehler('invalid parameter side') === false)

// Zählbare Schlussmeldung: `scripts/run-selftests.mjs` liest genau dieses
// Format. Ohne sie zählt der Sammellauf die ganze Datei als EINE Prüfung.
console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
