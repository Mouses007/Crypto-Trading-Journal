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
 * Das Token wird bei jedem Server-Neustart neu erzeugt (keine persistente Session).
 */
import crypto from 'crypto'
import { getKnex } from './database.js'
import { isLocalRequest } from './update-api.js'

// Generate a random session token at startup
const SESSION_TOKEN = crypto.randomBytes(32).toString('hex')
const COOKIE_NAME = 'tn_session'
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 Tage in Sekunden

// In-memory Auth-Konfiguration (aus settings geladen)
let authConfig = { enabled: false, passwordHash: '' }

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

/**
 * Middleware: set session cookie on any non-API request.
 * Im Passwort-Gate-Modus wird KEIN Cookie automatisch gesetzt — nur nach Login.
 */
export function sessionCookieMiddleware(req, res, next) {
    if (!req.url.startsWith('/api/') && !authConfig.enabled) {
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
