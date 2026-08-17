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
import { istPrivatV4, istPrivatV6 } from './net-guard.js'

let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) return
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

console.log(fehler === 0 ? '  ✓ alle Prüfungen bestanden' : `  ${fehler} Fehler`)
process.exit(fehler === 0 ? 0 : 1)
