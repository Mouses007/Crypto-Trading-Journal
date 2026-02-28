import express from 'express';
import path from 'path'
import * as Vite from 'vite'
import { initDb } from './server/database.js'
import { setupApiRoutes } from './server/api-routes.js'
import { setupBitunixRoutes } from './server/bitunix-api.js'
import { setupBitgetRoutes } from './server/bitget-api.js'
import { setupBinanceRoutes } from './server/binance-api.js'
import { setupPolygonRoutes } from './server/polygon-api.js'
import { setupOllamaRoutes } from './server/ollama-api.js'
import { setupUpdateRoutes } from './server/update-api.js'
import { setupBackupRoutes } from './server/backup-api.js'
import { setupFluxRoutes } from './server/flux-api.js'
import { sessionCookieMiddleware, apiAuthMiddleware, getSessionCookieString } from './server/auth.js'

const app = express();
app.use(express.json({ limit: '50mb' }));

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

    // Setup API routes
    console.log("\nRUNNING SERVER")
    setupApiRoutes(app);
    setupBitunixRoutes(app);
    setupBitgetRoutes(app);
    setupBinanceRoutes(app);
    setupPolygonRoutes(app);
    setupOllamaRoutes(app);
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

        // Inject session cookie into ALL proxied responses (Vite dev server)
        proxy.on('proxyRes', (proxyRes) => {
            const existing = proxyRes.headers['set-cookie'] || []
            const arr = Array.isArray(existing) ? existing : [existing].filter(Boolean)
            arr.push(getSessionCookieString())
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
            res.status(err.status || 500).json({ error: err.message || 'Interner Serverfehler' })
        }
    })

    // Start listening
    console.log("\nSTARTING NODEJS SERVER")
    await new Promise((resolve, reject) => {
        const server = app.listen(port, host, () => {
            console.log(` -> Crypto Trading Journal started on http://${host}:${port}`)
            if (host === '127.0.0.1' || host === 'localhost') {
                console.log(' -> Server is only accessible locally (set CTJ_HOST=0.0.0.0 to allow network access)')
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
