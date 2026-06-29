import express from 'express';
import path from 'path'
import { initDb } from './server/database.js'
import { setupApiRoutes } from './server/api-routes.js'
import { setupBitunixRoutes } from './server/bitunix-api.js'
import { setupBitgetRoutes } from './server/bitget-api.js'
import { setupPionexRoutes } from './server/pionex-api.js'
import { setupBinanceRoutes } from './server/binance-api.js'
import { setupPolygonRoutes } from './server/polygon-api.js'
import { setupOllamaRoutes } from './server/ollama-api.js'
import { setupAgentRoutes } from './server/ai-agent.js'
import { setupUpdateRoutes } from './server/update-api.js'
import { setupBackupRoutes } from './server/backup-api.js'
import { setupFluxRoutes } from './server/flux-api.js'
import { setupEsp32Routes } from './server/esp32-api.js'
import { sessionCookieMiddleware, apiAuthMiddleware, getSessionCookieString, setupAuthRoutes, loadAuthConfig, isAuthEnabled } from './server/auth.js'

const app = express();
app.disable('x-powered-by')
app.use(express.json({ limit: '50mb' }));

// Security-Header (ohne zusätzliche Dependency). CSP bleibt bewusst aus, da
// CDN-Ressourcen + inline-Styles/Skripte genutzt werden; SRI sichert die CDNs ab.
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    // HSTS nur über HTTPS sinnvoll (sonst ignoriert / kontraproduktiv im LAN)
    const xfp = req.headers['x-forwarded-proto']
    if (req.secure || (typeof xfp === 'string' && xfp.split(',')[0].trim() === 'https')) {
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
    }
    next()
})

// ESP32 display endpoint — registered BEFORE auth middleware (uses own key-based auth)
setupEsp32Routes(app)

// Security: Session cookie + API auth
app.use(sessionCookieMiddleware)
app.use('/api', apiAuthMiddleware)

const port = process.env.CTJ_PORT || process.env.PORT || 8080;
const host = process.env.CTJ_HOST || '127.0.0.1'; // Default: nur lokal erreichbar
const PROXY_PORT = 39482;

const startIndex = async () => {
    // Initialize database (Knex — SQLite or PostgreSQL)
    console.log("\nINITIALIZING DATABASE")
    await initDb()

    // Auth-Konfiguration (optionales Passwort-Gate) aus settings laden
    await loadAuthConfig()

    // Setup API routes
    console.log("\nRUNNING SERVER")
    setupAuthRoutes(app);
    setupApiRoutes(app);
    setupBitunixRoutes(app);
    setupBitgetRoutes(app);
    setupPionexRoutes(app);
    setupBinanceRoutes(app);
    setupPolygonRoutes(app);
    setupOllamaRoutes(app);
    setupAgentRoutes(app);
    setupUpdateRoutes(app);
    setupBackupRoutes(app);
    await setupFluxRoutes(app);
    console.log(" -> API routes initialized")

    if (process.env.NODE_ENV == 'dev') {
        // Proxy non-API routes to Vite dev server
        const { default: Proxy } = await import('http-proxy')
        const proxy = new Proxy.createProxyServer({
            target: { host: 'localhost', port: PROXY_PORT },
        });

        // Inject session cookie into proxied responses (Vite dev server) —
        // außer wenn das Passwort-Gate aktiv ist (dann nur nach Login).
        proxy.on('proxyRes', (proxyRes, req) => {
            if (isAuthEnabled()) return
            const existing = proxyRes.headers['set-cookie'] || []
            const arr = Array.isArray(existing) ? existing : [existing].filter(Boolean)
            arr.push(getSessionCookieString(req))
            proxyRes.headers['set-cookie'] = arr
        })

        proxy.on('error', (err, req, res) => {
            console.error('Vite proxy error:', err.message)
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain' })
            }
            res.end('Vite dev server nicht erreichbar. Läuft "npm run dev"?')
        })

        app.use((req, res, next) => {
            if (req.url.startsWith('/api/')) return next();
            proxy.web(req, res);
        });

        const Vite = await import('vite')
        const vite = await Vite.createServer({ server: { port: PROXY_PORT } });
        vite.listen();
        console.log(" -> Running vite dev server");
    } else {
        // Production: static files
        app.use(express.static('dist'));
        app.get('*', (req, res) => {
            res.sendFile(path.resolve('dist', 'index.html'));
        });
        console.log(" -> Running prod server");
    }

    // Central error handler — catches unhandled errors from async route handlers
    app.use((err, req, res, _next) => {
        console.error(`[ERROR] ${req.method} ${req.url}:`, err.message || err)
        if (!res.headersSent) {
            const status = err.status || 500
            // 500er nicht mit internen Details nach außen geben; 4xx-Meldungen sind gewollt
            res.status(status).json({ error: status >= 500 ? 'Interner Serverfehler' : (err.message || 'Fehler') })
        }
    })

    // Start listening
    console.log("\nSTARTING NODEJS SERVER")
    await new Promise((resolve, reject) => {
        const server = app.listen(port, host, () => {
            console.log(` -> Crypto Trading Journal started on http://${host}:${port}`)
            const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
            if (isLoopback) {
                console.log(' -> Server is only accessible locally (set CTJ_HOST=0.0.0.0 to allow network access)')
            } else if (!isAuthEnabled()) {
                console.warn('\n  ⚠️  WARNUNG: Server ist im Netzwerk erreichbar (CTJ_HOST=' + host + '),')
                console.warn('      aber das Passwort-Gate ist NICHT aktiv. Jeder im Netzwerk hat vollen Zugriff.')
                console.warn('      → Aktiviere den Passwortschutz in den Einstellungen ODER betreibe den')
                console.warn('        Dienst hinter einem Reverse-Proxy mit HTTPS + Authentifizierung / VPN.\n')
            }
            resolve()
        });
        server.on('error', reject)
    })

    console.log("\n Crypto Trading Journal ready!")
}

startIndex().catch(err => {
    console.error('\n STARTUP FAILED:', err.message || err)
    process.exit(1)
})
