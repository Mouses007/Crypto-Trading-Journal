/**
 * API authentication for single-user local app.
 *
 * Standardmodus (authEnabled=false): Wie bisher — der Server setzt beim Laden
 * der Seite ein httpOnly-Cookie mit einem Session-Token. Alle /api/*-Requests
 * brauchen dieses Cookie. Das schützt vor Zugriff anderer Geräte/Skripte, ist
 * aber KEIN Passwortschutz (für reinen Localhost-Betrieb gedacht).
 *
 * Optionales Passwort-Gate (authEnabled=true): Der Server stellt das Cookie
 * NICHT mehr automatisch aus. Der Nutzer muss sich per POST /api/login mit
 * Passwort anmelden. Gedacht für Betrieb hinter öffentlicher Bindung
 * (CTJ_HOST=0.0.0.0). Zusätzlich wird HTTPS via Reverse-Proxy empfohlen.
 *
 * Das Token überlebt einen Neustart, WENN `CTJ_SECRET` gesetzt ist — siehe unten.
 */
import crypto from 'crypto'
import { getKnex } from './database.js'
import { isLocalRequest } from './update-api.js'

/**
 * Sitzungs-Token.
 *
 * Es lebt im Prozess, nicht in der Datenbank. Wurde es bei jedem Start neu
 * gewürfelt, meldete JEDER Neustart alle Geräte ab, die auf diesen Server
 * zeigen — beim NAS also nach jedem Container-Update Desktop, Handy und Tablet
 * gleichzeitig. Ein Update ist kein Sicherheitsereignis, das rechtfertigt das
 * nicht.
 *
 * Ist `CTJ_SECRET` gesetzt, wird das Token daraus ABGELEITET statt gewürfelt.
 * Damit überlebt die Anmeldung einen Neustart. Die Angriffsfläche wächst
 * dadurch nicht: `CTJ_SECRET` ist ohnehin das Hauptgeheimnis der Installation,
 * aus ihm werden bereits die API-Schlüssel entschlüsselt.
 *
 * Der Preis, bewusst in Kauf genommen: ein einmal abgegriffenes Cookie bleibt
 * gültig, bis `CTJ_SECRET` gewechselt wird — vorher half ein Neustart. Wer ein
 * Token für verbrannt hält, ändert `CTJ_SECRET` (oder setzt es ab, dann wird
 * wieder gewürfelt).
 *
 * Ohne `CTJ_SECRET` bleibt es beim alten Verhalten: zufällig je Start. Ein aus
 * dem Maschinennamen abgeleiteter Ersatz wäre erratbar und damit schlechter als
 * eine lästige Neuanmeldung.
 */
const SESSION_TOKEN = process.env.CTJ_SECRET
    ? crypto.createHmac('sha256', String(process.env.CTJ_SECRET)).update('tn_session_v1').digest('hex')
    : crypto.randomBytes(32).toString('hex')
const COOKIE_NAME = 'tn_session'
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 Tage in Sekunden

// In-memory Auth-Konfiguration (aus settings geladen)
let authConfig = { enabled: false, passwordHash: '' }

// Auf welcher Adresse der Server lauscht. Ohne Passwort-Gate wird das Cookie
// jedem Besucher zugeteilt — das ist nur vertretbar, solange ausschliesslich
// der eigene Rechner den Dienst erreicht. Standard `true`, damit Werkzeuge, die
// dieses Modul ohne laufenden Server laden, ihr Verhalten nicht ändern.
let bindNurLokal = true

/** Lauscht der Server ausschliesslich auf der Loopback-Adresse? */
export function istLoopbackHost(host) {
    const h = String(host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '')
    return h === 'localhost' || h === '::1' || h.startsWith('127.')
}

/** Beim Start aufrufen, sobald die Bind-Adresse feststeht. */
export function setzeBindungsModus(nurLokal) {
    bindNurLokal = !!nurLokal
}

/**
 * Darf der Dienst ohne Passwort-Gate betrieben werden? Nur lokal — oder wenn
 * der Betreiber es mit CTJ_ALLOW_INSECURE=1 ausdrücklich in Kauf nimmt.
 */
export function offenerBetriebErlaubt() {
    return bindNurLokal || process.env.CTJ_ALLOW_INSECURE === '1'
}

// Routen, die ohne gültige Session erreichbar sein müssen (Login-Flow +
// unkritischer Setup-Status, den der Router-Guard vor dem Login abfragt).
const PUBLIC_API_PATHS = new Set(['/api/login', '/api/logout', '/api/auth/status', '/api/setup/status', '/api/auth/reset'])

/**
 * Lädt die Auth-Konfiguration aus der settings-Tabelle. Nach DB-Init und nach
 * Änderungen (Login-Aktivierung/Passwortwechsel) aufrufen.
 */
export async function loadAuthConfig() {
    try {
        const knex = getKnex()
        const row = await knex('settings').select('authEnabled', 'authPasswordHash').where('id', 1).first()
        authConfig = {
            enabled: !!(row && row.authEnabled) && !!(row && row.authPasswordHash),
            passwordHash: (row && row.authPasswordHash) || ''
        }
    } catch (e) {
        authConfig = { enabled: false, passwordHash: '' }
    }
    return authConfig
}

export function isAuthEnabled() {
    return authConfig.enabled
}

/**
 * Notfall-Reset per Umgebungsvariable: Wird der Server mit CTJ_RESET_AUTH=1
 * gestartet, wird der Passwortschutz einmalig deaktiviert (für den Fall, dass
 * das Passwort verloren ging und kein localhost-Zugriff möglich ist).
 * Beim Start VOR loadAuthConfig aufrufen. Danach Env-Variable wieder entfernen.
 */
export async function maybeResetAuthFromEnv() {
    if (process.env.CTJ_RESET_AUTH !== '1') return
    try {
        const knex = getKnex()
        await knex('settings').where('id', 1).update({ authEnabled: 0, authPasswordHash: '', updatedAt: knex.fn.now() })
        console.warn('[AUTH] Passwortschutz via CTJ_RESET_AUTH zurückgesetzt. Bitte CTJ_RESET_AUTH wieder entfernen.')
    } catch (e) {
        console.error('[AUTH] CTJ_RESET_AUTH Reset fehlgeschlagen:', e.message)
    }
}

/** True, wenn der Request über HTTPS kommt (auch hinter Reverse-Proxy). */
function isHttps(req) {
    if (!req) return false
    if (req.secure) return true
    const xfp = req.headers && req.headers['x-forwarded-proto']
    return typeof xfp === 'string' && xfp.split(',')[0].trim() === 'https'
}

/**
 * Returns the Set-Cookie header string for the session token.
 * `Secure` wird nur über HTTPS gesetzt (sonst würde der Browser das Cookie bei
 * Plain-HTTP-Betrieb im LAN verwerfen).
 */
export function getSessionCookieString(req, remember = true) {
    const secure = isHttps(req) ? ' Secure;' : ''
    // remember=true → persistentes Cookie (30 Tage). false → Session-Cookie ohne
    // Max-Age (läuft ab, wenn der Browser geschlossen wird).
    const maxAge = remember ? ` Max-Age=${COOKIE_MAX_AGE};` : ''
    return `${COOKIE_NAME}=${SESSION_TOKEN}; HttpOnly; SameSite=Strict;${maxAge} Path=/;${secure}`
}

/** Cookie löschen (Logout). */
function getClearCookieString(req) {
    const secure = isHttps(req) ? ' Secure;' : ''
    return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/;${secure}`
}

// ==================== DNS-Rebinding ====================
//
// Der ganze localhost-Vertrauensbau hängt an der Peer-IP: „kommt von 127.0.0.1,
// also ist es der Nutzer selbst". Eine Rebinding-Seite bricht genau das. Sie
// lässt ihren eigenen Namen (evil.tld) kurz auf 127.0.0.1 zeigen; der Browser
// des Nutzers schickt die Anfrage dann brav an den eigenen Rechner — mit
// lokaler Peer-IP, aber mit `Host: evil.tld`. Damit stünde `/api/auth/reset`
// offen (schaltet das Passwort-Gate ab), und der nächste Seitenaufruf liefert
// das Session-Cookie an die fremde Domain.
//
// Der Host-Header ist die einzige Stelle, an der man das sieht — deshalb wird
// er hier geprüft. Kein Ersatz für die Peer-IP-Prüfung, sondern ihr Gegenstück.

/** Private IPv4-Bereiche, unter denen der Dienst im eigenen Netz erreichbar ist. */
const PRIVATE_V4 = [
    /^192\.168\.\d{1,3}\.\d{1,3}$/,
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/,   // CGNAT (Tailscale)
]

/** Zusätzlich erlaubte Namen aus der Umgebung (Komma-getrennt). */
function zusatzHosts() {
    return String(process.env.CTJ_ALLOWED_HOSTS || '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
}

/**
 * Darf unter diesem Host-Header zugegriffen werden?
 *
 * Erlaubt sind Loopback, private IP-Adressen und was in CTJ_ALLOWED_HOSTS
 * steht. Registrierbare Domains sind es nicht — genau die braucht ein
 * Rebinding-Angriff.
 *
 * @param {string} rawHost Inhalt des Host-Headers (mit oder ohne Port)
 */
export function istErlaubterHost(rawHost) {
    // Kein Host-Header: HTTP/1.0-Klienten wie das ESP-Display oder curl. Ein
    // Rebinding-Angriff läuft immer über einen Browser, und der schickt den
    // Header immer — hier gibt es also nichts zu erkennen und nichts zu sperren.
    if (rawHost === undefined || rawHost === null || rawHost === '') return true

    let host = String(rawHost).trim().toLowerCase().replace(/\.$/, '')
    // IPv6 steht in eckigen Klammern und enthält selbst Doppelpunkte — erst die
    // Klammer abtrennen, sonst zerlegt die Port-Abtrennung die Adresse.
    if (host.startsWith('[')) host = host.slice(1, host.indexOf(']') > 0 ? host.indexOf(']') : undefined)
    else host = host.split(':')[0]

    if (istLoopbackHost(host)) return true
    if (PRIVATE_V4.some((r) => r.test(host))) return true
    // IPv6: eindeutig lokale (fc00::/7) und verbindungslokale (fe80::/10) Adressen
    if (host.includes(':')) {
        const kopf = parseInt(host.split(':')[0] || '0', 16)
        if ((kopf & 0xfe00) === 0xfc00 || (kopf & 0xffc0) === 0xfe80) return true
    }
    return zusatzHosts().includes(host)
}

/** Middleware-Fassung: weist unbekannte Hosts mit 421 ab. */
export function hostGuardMiddleware(req, res, next) {
    if (istErlaubterHost(req.headers?.host)) return next()
    res.status(421).type('text/plain').send(
        'Unbekannter Host. Der Dienst ist nur über localhost oder eine private '
        + 'Netzadresse erreichbar (sonst CTJ_ALLOWED_HOSTS setzen).'
    )
}

/**
 * Middleware: set session cookie on any non-API request.
 * Im Passwort-Gate-Modus wird KEIN Cookie automatisch gesetzt — nur nach Login.
 *
 * Und: im Netzbetrieb ohne Gate ebenfalls nicht. Der Startcheck in index.mjs
 * fängt diesen Zustand normalerweise ab; er kann aber im Betrieb entstehen,
 * wenn jemand den Passwortschutz nachträglich abschaltet. Dann lieber
 * verschlossen als jedem im LAN das Cookie in die Hand drücken.
 */
export function sessionCookieMiddleware(req, res, next) {
    if (!req.url.startsWith('/api/') && !authConfig.enabled && offenerBetriebErlaubt()) {
        res.setHeader('Set-Cookie', getSessionCookieString(req))
    }
    next()
}

/**
 * Middleware: verify session cookie on all /api/* requests.
 * Login-Routen sind ausgenommen, damit man sich überhaupt anmelden kann.
 */
export function apiAuthMiddleware(req, res, next) {
    // Login-Flow-Routen immer durchlassen.
    // Hinweis: bei `app.use('/api', ...)` ist req.path ohne /api-Präfix, daher
    // originalUrl verwenden, damit die Allowlist mit /api/... matcht.
    const basePath = (req.originalUrl || req.url).split('?')[0]
    if (PUBLIC_API_PATHS.has(basePath)) return next()

    const token = parseCookieToken(req)
    if (isValidSessionToken(token)) {
        return next()
    }

    res.status(401).json({ error: 'Nicht autorisiert. Bitte lade die Seite im Browser neu.' })
}

/** Konstantzeitiger Vergleich des Session-Tokens (verhindert Timing-Leaks). */
/** Trägt die Anfrage ein gültiges Session-Cookie? (Für das Body-Limit in index.mjs.) */
export function hatGueltigeSession(req) {
    return isValidSessionToken(parseCookieToken(req))
}

function isValidSessionToken(token) {
    if (typeof token !== 'string') return false
    const a = Buffer.from(token)
    const b = Buffer.from(SESSION_TOKEN)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Parse the session token from the Cookie header.
 */
function parseCookieToken(req) {
    const cookieHeader = req.headers.cookie
    if (!cookieHeader) return null

    const cookies = cookieHeader.split(';')
    for (const cookie of cookies) {
        const [name, ...valueParts] = cookie.trim().split('=')
        if (name === COOKIE_NAME) {
            return valueParts.join('=')
        }
    }
    return null
}

// ==================== Passwort-Hashing (scrypt) ====================

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex')
    const derived = crypto.scryptSync(password, salt, 64).toString('hex')
    return `${salt}:${derived}`
}

function verifyPassword(password, stored) {
    if (!stored || !stored.includes(':')) return false
    const [salt, derivedHex] = stored.split(':')
    try {
        const derived = crypto.scryptSync(password, salt, 64)
        const expected = Buffer.from(derivedHex, 'hex')
        return derived.length === expected.length && crypto.timingSafeEqual(derived, expected)
    } catch {
        return false
    }
}

// ==================== Rate-Limiting (in-memory, pro IP) ====================

const LOGIN_MAX_ATTEMPTS = 5
const LOGIN_LOCK_MS = 5 * 60 * 1000 // 5 min Sperre nach zu vielen Versuchen
const loginAttempts = new Map() // ip -> { count, lockUntil }

function clientIp(req) {
    return String(req.ip || req.socket?.remoteAddress || 'unknown').replace('::ffff:', '')
}

function isRateLimited(ip) {
    const rec = loginAttempts.get(ip)
    if (!rec) return false
    if (rec.lockUntil && Date.now() < rec.lockUntil) return true
    return false
}

function registerFailure(ip) {
    // Abgelaufene Einträge gleich mit auskehren — die Map wüchse sonst um eine
    // Zeile je jemals gesehener IP und würde nie wieder kleiner.
    const verfallen = Date.now() - 60 * 60 * 1000
    for (const [altIp, altRec] of loginAttempts) {
        if (altRec.lockUntil && altRec.lockUntil < verfallen) loginAttempts.delete(altIp)
    }
    const rec = loginAttempts.get(ip) || { count: 0, lockUntil: 0 }
    rec.count += 1
    if (rec.count >= LOGIN_MAX_ATTEMPTS) {
        rec.lockUntil = Date.now() + LOGIN_LOCK_MS
        rec.count = 0
    }
    loginAttempts.set(ip, rec)
}

function clearFailures(ip) {
    loginAttempts.delete(ip)
}

// ==================== Auth-Routen ====================

export function setupAuthRoutes(app) {
    // Status (öffentlich): zeigt ob Gate aktiv ist und ob man eingeloggt ist
    app.get('/api/auth/status', (req, res) => {
        const loggedIn = !authConfig.enabled || isValidSessionToken(parseCookieToken(req))
        res.json({ authEnabled: authConfig.enabled, loggedIn })
    })

    // Login (öffentlich): Passwort prüfen, bei Erfolg Session-Cookie setzen
    app.post('/api/login', async (req, res) => {
        const ip = clientIp(req)
        if (isRateLimited(ip)) {
            return res.status(429).json({ error: 'Zu viele Fehlversuche. Bitte später erneut versuchen.' })
        }
        if (!authConfig.enabled) {
            // Gate nicht aktiv — Login nicht nötig
            return res.json({ ok: true, authEnabled: false })
        }
        const password = req.body && req.body.password
        if (!password || !verifyPassword(password, authConfig.passwordHash)) {
            registerFailure(ip)
            return res.status(401).json({ error: 'Falsches Passwort.' })
        }
        clearFailures(ip)
        // „30 Tage angemeldet bleiben": Frontend kann { remember:false } senden für ein
        // reines Session-Cookie. Fehlt das Feld → true → 30 Tage (bisheriges Verhalten).
        const remember = req.body?.remember !== false
        res.setHeader('Set-Cookie', getSessionCookieString(req, remember))
        res.json({ ok: true })
    })

    // Logout (öffentlich): Cookie löschen
    app.post('/api/logout', (req, res) => {
        res.setHeader('Set-Cookie', getClearCookieString(req))
        res.json({ ok: true })
    })

    // Passwort setzen/ändern (geschützt — erfordert gültige Session).
    // Aktiviert das Gate. Beim Ändern eines bestehenden Passworts ist das
    // aktuelle Passwort erforderlich.
    app.post('/api/auth/set-password', async (req, res) => {
        try {
            const { newPassword, currentPassword } = req.body || {}
            if (!newPassword || String(newPassword).length < 6) {
                return res.status(400).json({ error: 'Neues Passwort muss mindestens 6 Zeichen haben.' })
            }
            if (authConfig.enabled) {
                if (!verifyPassword(currentPassword || '', authConfig.passwordHash)) {
                    return res.status(401).json({ error: 'Aktuelles Passwort ist falsch.' })
                }
            }
            const knex = getKnex()
            await knex('settings').where('id', 1).update({
                authEnabled: 1,
                authPasswordHash: hashPassword(newPassword),
                updatedAt: knex.fn.now()
            })
            await loadAuthConfig()
            // Aktuelle Session bleibt gültig (Token unverändert)
            res.json({ ok: true, authEnabled: true })
        } catch (e) {
            res.status(500).json({ error: e.message || 'Fehler beim Setzen des Passworts.' })
        }
    })

    // Passwort vergessen / Reset (öffentlich, aber NUR von localhost).
    // Kein aktuelles Passwort nötig — wer lokal am Server sitzt, gilt als
    // Eigentümer (gleiches Vertrauensmodell wie Update/Restart).
    app.post('/api/auth/reset', async (req, res) => {
        if (!isLocalRequest(req)) {
            return res.status(403).json({ error: 'Zurücksetzen nur direkt am Server (localhost) möglich.' })
        }
        try {
            const knex = getKnex()
            await knex('settings').where('id', 1).update({
                authEnabled: 0,
                authPasswordHash: '',
                updatedAt: knex.fn.now()
            })
            await loadAuthConfig()
            res.json({ ok: true, authEnabled: false })
        } catch (e) {
            res.status(500).json({ error: 'Zurücksetzen fehlgeschlagen.' })
        }
    })

    // Gate deaktivieren (geschützt) — aktuelles Passwort erforderlich
    app.post('/api/auth/disable', async (req, res) => {
        try {
            // Im Netzbetrieb wäre das Abschalten gleichbedeutend mit „Tür auf
            // für alle im LAN". Wer das wirklich will, startet mit
            // CTJ_ALLOW_INSECURE=1 — dann greift diese Sperre nicht.
            if (!offenerBetriebErlaubt()) {
                return res.status(403).json({
                    error: 'Der Dienst ist im Netzwerk erreichbar. Ohne Passwortschutz hätte dann jeder im Netz vollen Zugriff. Zum Abschalten den Dienst nur lokal binden (CTJ_HOST=127.0.0.1) oder mit CTJ_ALLOW_INSECURE=1 starten.'
                })
            }
            if (authConfig.enabled) {
                const { currentPassword } = req.body || {}
                if (!verifyPassword(currentPassword || '', authConfig.passwordHash)) {
                    return res.status(401).json({ error: 'Aktuelles Passwort ist falsch.' })
                }
            }
            const knex = getKnex()
            await knex('settings').where('id', 1).update({
                authEnabled: 0,
                authPasswordHash: '',
                updatedAt: knex.fn.now()
            })
            await loadAuthConfig()
            res.json({ ok: true, authEnabled: false })
        } catch (e) {
            res.status(500).json({ error: e.message || 'Fehler beim Deaktivieren.' })
        }
    })
}
