/**
 * Simple API authentication for single-user local app.
 *
 * On first page load, the server sets an httpOnly cookie with a session token.
 * All /api/* requests must include this cookie — prevents access from
 * other devices/scripts even if the server is accidentally exposed to the network.
 *
 * The token is regenerated on each server restart (no persistent sessions).
 */
import crypto from 'crypto'

// Generate a random session token at startup
const SESSION_TOKEN = crypto.randomBytes(32).toString('hex')
const COOKIE_NAME = 'tn_session'
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 // 1 year in seconds

/**
 * Returns the Set-Cookie header string for the session token.
 */
export function getSessionCookieString() {
    return `${COOKIE_NAME}=${SESSION_TOKEN}; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}; Path=/`
}

/**
 * Middleware: set session cookie on any non-API request.
 * Works for both production (static files) and dev (before proxy).
 */
export function sessionCookieMiddleware(req, res, next) {
    if (!req.url.startsWith('/api/')) {
        res.setHeader('Set-Cookie', getSessionCookieString())
    }
    next()
}

/**
 * Middleware: verify session cookie on all /api/* requests.
 * Rejects requests without a valid session token.
 */
export function apiAuthMiddleware(req, res, next) {
    const token = parseCookieToken(req)

    if (token === SESSION_TOKEN) {
        return next()
    }

    // No valid token — reject
    res.status(401).json({ error: 'Nicht autorisiert. Bitte lade die Seite im Browser neu.' })
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
