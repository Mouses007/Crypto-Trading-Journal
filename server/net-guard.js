/**
 * Schutzwall für Abrufe an URLs, die der NUTZER einträgt.
 *
 * Das Projekt hat bereits `isAllowedOllamaUrl` und `isAllowedDbHost` — beide
 * lassen NUR lokale und private Ziele zu. Hier ist es genau umgekehrt: Feeds
 * liegen im Internet, und alles Interne ist verboten. Ohne diese Prüfung wäre
 * das Eintragen einer Feed-Adresse ein bequemer Weg, den Server als Sonde ins
 * eigene Netz zu schicken — inklusive der Metadaten-Adresse von Cloud-Anbietern
 * (169.254.169.254), die dort Zugangsdaten herausgibt.
 *
 * Bewusst nicht gelöst: DNS-Rebinding. Zwischen Prüfung und Abruf könnte sich
 * die Auflösung ändern. Dagegen hülfe nur ein eigener Agent mit `lookup`-Haken.
 * Bei einer lokalen Einzelnutzer-Anwendung, in der derselbe Mensch die URL
 * einträgt und den Server betreibt, ist das vertretbar — es hier zu
 * verschweigen wäre es nicht.
 */

import dns from 'dns'
import { logWarn } from './logger.js'

const HTTP_TIMEOUT = 10000
const MAX_BYTES = 2 * 1024 * 1024
const MAX_UMLEITUNGEN = 3

/** Eigene Quellen — fest verdrahtet, brauchen keine Namensauflösung. */
export const FESTE_HOSTS = new Set([
    'api.alternative.me',
    'api.coingecko.com',
    'api.blockchain.info',
    'nfs.faireconomy.media',
    'fapi.binance.com',
    'api.binance.com',
    'www.youtube.com',
])

/** Netzbereiche, die niemals Ziel eines Abrufs sein dürfen. */
export function istPrivatV4(ip) {
    const t = ip.split('.').map(Number)
    if (t.length !== 4 || t.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
    const [a, b, c] = t
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true          // Cloud-Metadaten
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    // 192.0.0.0/24 sind die IETF-Protokollzuweisungen, 192.0.2.0/24 ist
    // TEST-NET-1 — beide je ein /24, NICHT das ganze 192.0.0.0/16. Vorher stand
    // hier `b === 0` ohne dritten Block und sperrte damit 254 reguläre
    // öffentliche Netze mit: `192.0.66.0/24` gehört Automattic und beherbergt
    // TechCrunch samt allem, was auf WordPress.com VIP liegt. Der Abruf schlug
    // mit „zeigt auf eine interne Adresse" fehl, was die Fehlersuche in die
    // völlig falsche Richtung schickte.
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT / Tailscale
    if (a === 198 && (b === 18 || b === 19)) return true
    if (a >= 224) return true                         // Multicast und reserviert
    return false
}

export function istPrivatV6(ip) {
    const s = ip.toLowerCase()
    if (s === '::' || s === '::1') return true
    // In IPv6 eingebettete IPv4-Adresse mitprüfen
    const v4 = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (v4) return istPrivatV4(v4[1])
    const kopf = parseInt(s.split(':')[0] || '0', 16)
    if ((kopf & 0xfe00) === 0xfc00) return true       // fc00::/7 eindeutig lokal
    if ((kopf & 0xffc0) === 0xfe80) return true       // fe80::/10 verbindungslokal
    return false
}

const VERBOTENE_ENDUNGEN = ['.local', '.internal', '.home.arpa', '.lan', '.localdomain']

/**
 * Prüft eine vom Nutzer eingetragene URL. Wirft mit klartextlicher Begründung —
 * die Meldung landet in der Oberfläche, also soll sie erklären statt abweisen.
 */
export async function pruefeOeffentlicheUrl(rawUrl) {
    let url
    try {
        url = new URL(String(rawUrl || '').trim())
    } catch {
        throw new Error('Keine gültige Adresse')
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error(`Nur http und https sind erlaubt (nicht ${url.protocol.replace(':', '')})`)
    }
    if (url.username || url.password) {
        throw new Error('Zugangsdaten in der Adresse sind nicht erlaubt')
    }
    if (url.port && !['80', '443'].includes(url.port)) {
        // Ein freier Port machte den Server zum Portscanner im eigenen Netz
        throw new Error(`Nur Port 80 und 443 sind erlaubt (nicht ${url.port})`)
    }

    // IPv6 steht in der URL in eckigen Klammern — die muss der Namensauflöser
    // nicht sehen, sonst scheitert er mit „nicht auflösbar" statt die Adresse
    // als intern zu erkennen.
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
    if (host === 'localhost' || VERBOTENE_ENDUNGEN.some(e => host.endsWith(e))) {
        throw new Error(`„${host}" zeigt ins eigene Netz`)
    }

    if (FESTE_HOSTS.has(host)) return { ok: true, host, adressen: [] }

    let adressen
    try {
        adressen = await dns.promises.lookup(host, { all: true })
    } catch (e) {
        throw new Error(`Name „${host}" nicht auflösbar`)
    }
    if (!adressen.length) throw new Error(`Name „${host}" liefert keine Adresse`)

    // JEDE Adresse prüfen: ein Name kann auf mehrere zeigen, und es genügt
    // eine interne, um den Abruf zum Einfallstor zu machen.
    for (const { address, family } of adressen) {
        const privat = family === 6 ? istPrivatV6(address) : istPrivatV4(address)
        if (privat) throw new Error(`„${host}" zeigt auf eine interne Adresse (${address})`)
    }

    return { ok: true, host, adressen: adressen.map(a => a.address) }
}

/**
 * Text abrufen — mit Prüfung, eigener Umleitungsverfolgung und Grössengrenze.
 *
 * Die Umleitungen werden selbst verfolgt, weil `fetch` sonst still einer
 * Weiterleitung auf 127.0.0.1 folgen würde und die Prüfung damit umgangen wäre.
 */
export async function holeText(rawUrl, { timeout = HTTP_TIMEOUT } = {}) {
    let ziel = String(rawUrl || '').trim()

    for (let sprung = 0; sprung <= MAX_UMLEITUNGEN; sprung++) {
        await pruefeOeffentlicheUrl(ziel)

        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), timeout)
        let antwort
        try {
            antwort = await fetch(ziel, {
                signal: ctrl.signal,
                redirect: 'manual',
                headers: {
                    'User-Agent': 'CryptoTradingJournal (Marktradar)',
                    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
                },
            })
        } finally {
            clearTimeout(timer)
        }

        if ([301, 302, 303, 307, 308].includes(antwort.status)) {
            const ort = antwort.headers.get('location')
            if (!ort) throw new Error(`Umleitung ohne Ziel (HTTP ${antwort.status})`)
            ziel = new URL(ort, ziel).toString()
            continue
        }

        if (!antwort.ok) {
            const e = new Error(`HTTP ${antwort.status}`)
            e.status = antwort.status
            throw e
        }

        const laenge = Number(antwort.headers.get('content-length') || 0)
        if (laenge > MAX_BYTES) throw new Error(`Antwort zu gross (${Math.round(laenge / 1024)} kB)`)

        const text = await antwort.text()
        if (text.length > MAX_BYTES) throw new Error('Antwort zu gross')
        return text
    }

    throw new Error(`Mehr als ${MAX_UMLEITUNGEN} Umleitungen`)
}

/** Für die Oberfläche: prüfen ohne zu holen. */
export async function pruefeUndMelde(url) {
    try {
        const r = await pruefeOeffentlicheUrl(url)
        return { ok: true, host: r.host }
    } catch (e) {
        logWarn('net-guard', `abgelehnt: ${url} — ${e.message}`)
        return { ok: false, grund: e.message }
    }
}
