import express from 'express';
import path from 'path'
import { existsSync } from 'fs'
import { initDb } from './server/database.js'
import { setupApiRoutes } from './server/api-routes.js'
import { setupBitunixRoutes } from './server/bitunix-api.js'
import { setupBitgetRoutes } from './server/bitget-api.js'
import { setupPionexRoutes } from './server/pionex-api.js'
import { setupBinanceRoutes } from './server/binance-api.js'
import { setupMarginRateRoutes } from './server/margin-rates.js'
import { setupPolygonRoutes } from './server/polygon-api.js'
import { setupMarktradarRoutes, stopMarktradar } from './server/marktradar-api.js'
import { setupKalenderRoutes, stopKalender } from './server/marktradar-kalender.js'
import { setupLivetradingRoutes } from './server/livetrading-api.js'
import { setupLageRoutes } from './server/marktradar-lage.js'
import { setupNewsRoutes, startNewsTakt, stopNews } from './server/marktradar-news.js'
import { setupNewsProfilRoutes } from './server/news-profil-api.js'
import { setupCryptoquantRoutes, stopCryptoquant } from './server/cryptoquant-api.js'
import { setupBenachrichtigungsRoutes, startBenachrichtigungsTakt, stopBenachrichtigungen } from './server/benachrichtigungen.js'
import { setupOllamaRoutes } from './server/ollama-api.js'
import { setupAiModelRoutes } from './server/ai-models.js'
import { setupAgentRoutes } from './server/ai-agent.js'
import { setupAiUebersichtRoutes } from './server/ai-uebersicht.js'
import { setupHypeRadarRoutes, startHypeTakt, startWachhundTakt } from './server/hype-radar-api.js'
import { setupCoinRadarRoutes, startCoinRadarTakt } from './server/coin-radar-api.js'
import { startErgebnisTakt } from './server/radar-ergebnisse.js'
import { setupUpdateRoutes } from './server/update-api.js'
import { setupBackupRoutes } from './server/backup-api.js'
import { setupFluxRoutes } from './server/flux-api.js'
import { setupEsp32Routes } from './server/esp32-api.js'
import { setupLiveRecorder, stopLiveRecorder } from './server/live-recorder.js'
import { setupStrategyRoutes, ladeAlleRegelStrategien } from './server/strategy-api.js'
import { setupStrategyBuilderRoutes } from './server/strategy-builder.js'
import { setupRuleBuilderRoutes } from './server/rule-builder.js'
import { startStrategyEngine, stopStrategyEngine } from './server/strategy-engine.js'
import { setupRanglisteRoutes, startRanglisteTakt, stopRanglisteTakt } from './server/rangliste-api.js'
import { sessionCookieMiddleware, apiAuthMiddleware, getSessionCookieString, setupAuthRoutes, loadAuthConfig, isAuthEnabled, maybeResetAuthFromEnv, istLoopbackHost, setzeBindungsModus, hostGuardMiddleware, hatGueltigeSession } from './server/auth.js'

const app = express();
app.disable('x-powered-by')

// Body-Limit nach Vertrauensstufe: die 50 MB braucht es nur für Screenshots
// und Backup-Import — beides Routen HINTER der Session. Für alles ohne
// gültiges Cookie (Login, Fremde im Netz) reichen 100 kB; vorher konnte jeder
// Unangemeldete 50-MB-Bodies schicken, die Express brav parste, bevor die
// Auth-Prüfung überhaupt lief.
const kleinerBody = express.json({ limit: '100kb' })
const grosserBody = express.json({ limit: '50mb' })
app.use((req, res, next) => (hatGueltigeSession(req) ? grosserBody : kleinerBody)(req, res, next))

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

// DNS-Rebinding-Schutz: eine fremde Domain, die auf 127.0.0.1 zeigt, kommt mit
// lokaler Peer-IP an — erkennbar ist sie nur am Host-Header. Vor ALLEN Routen,
// auch vor dem ESP32-Endpunkt (der Guard lässt Anfragen ohne Host-Header durch).
app.use(hostGuardMiddleware)

// ESP32 display endpoint — registered BEFORE auth middleware (uses own key-based auth)
setupEsp32Routes(app)

// Security: Session cookie + API auth
app.use(sessionCookieMiddleware)
app.use('/api', apiAuthMiddleware)

const port = process.env.CTJ_PORT || process.env.PORT || 8080;
const host = process.env.CTJ_HOST || '127.0.0.1'; // Default: nur lokal erreichbar
const PROXY_PORT = 39482;

// Wird im Entwicklungsbetrieb gesetzt; der Server unten hängt die
// WebSocket-Weiterleitung daran, sobald er lauscht.
let viteProxy = null

const startIndex = async () => {
    // Initialize database (Knex — SQLite or PostgreSQL)
    console.log("\nINITIALIZING DATABASE")
    await initDb()

    // Notfall-Reset per CTJ_RESET_AUTH=1 (vor dem Laden), dann Auth-Konfig laden
    await maybeResetAuthFromEnv()
    await loadAuthConfig()

    // Netzbetrieb ohne Passwort-Gate heisst: jeder im Netz bekommt beim ersten
    // Seitenaufruf das Session-Cookie und damit Broker-Schlüssel, Live-Handel,
    // Backup und Update-Knopf. Das war bisher nur eine Warnung im Log, die man
    // im Container-Betrieb nie sieht — deshalb jetzt Abbruch.
    //
    // Der Container zählt dabei NICHT als „lokal": CTJ_HOST=0.0.0.0 ist dort
    // zwar Voraussetzung fürs Port-Mapping, aber das Compose-Default published
    // den Port auf allen Host-Interfaces — jeder im LAN wäre drin. Abbrechen
    // darf der Container trotzdem nicht (eine frische Installation könnte das
    // Passwort sonst nie setzen). Er startet stattdessen GESPERRT: ohne
    // Passwort werden keine Session-Cookies mehr verteilt
    // (sessionCookieMiddleware prüft offenerBetriebErlaubt), die API antwortet
    // 401, und das Frontend verlangt zuerst „Passwort festlegen"
    // (setupRequired in /api/auth/status; das erste Passwort darf ohne Session
    // gesetzt werden). Bestehende Geräte bleiben angemeldet, weil das Token
    // aus CTJ_SECRET abgeleitet ist. Wer bewusst offen fahren will:
    // CTJ_ALLOW_INSECURE=1.
    const inDocker = existsSync('/.dockerenv')
    setzeBindungsModus(istLoopbackHost(host))
    if (!istLoopbackHost(host) && !isAuthEnabled() && process.env.CTJ_ALLOW_INSECURE !== '1') {
        if (inDocker) {
            console.warn('\n  ⚠️  Netzbindung ohne Passwortschutz (Container).')
            console.warn('      Der Dienst startet GESPERRT: erst nach „Passwort festlegen" im')
            console.warn('      Browser ist die API nutzbar. Bewusst offen: CTJ_ALLOW_INSECURE=1\n')
        } else {
            console.error('\n  ⛔  ABBRUCH: Der Dienst soll im Netzwerk lauschen (CTJ_HOST=' + host + '),')
            console.error('      aber der Passwortschutz ist nicht aktiv. Dann hätte jeder im Netz')
            console.error('      vollen Zugriff auf API-Schlüssel, Handel und Backup.')
            console.error('      → Passwortschutz in den Einstellungen aktivieren (dazu einmal lokal')
            console.error('        starten: CTJ_HOST=127.0.0.1), oder')
            console.error('      → bewusst offen betreiben: CTJ_ALLOW_INSECURE=1\n')
            process.exit(1)
        }
    }

    // Setup API routes
    console.log("\nRUNNING SERVER")
    setupAuthRoutes(app);
    setupApiRoutes(app);
    setupBitunixRoutes(app);
    setupBitgetRoutes(app);
    setupPionexRoutes(app);
    setupBinanceRoutes(app);
    setupMarginRateRoutes(app);
    setupPolygonRoutes(app);
    setupMarktradarRoutes(app);
    // Eigene Datei statt in setupMarktradarRoutes: das Lagebild greift auf die
    // Kachel-Funktionen zu — die umgekehrte Richtung wäre ein Ringschluss
    setupLageRoutes(app);
    setupKalenderRoutes(app);
    // Nach dem Kalender: die Termin-Kachel des Live-Fensters liest über
    // `leseKalender` mit, statt eine zweite Abfrage aufzubauen.
    setupLivetradingRoutes(app);
    setupNewsRoutes(app);
    setupNewsProfilRoutes(app);
    startNewsTakt();
    // ETF-Bestände: eigene Datei, weil sie als einzige Radar-Quelle einen
    // Schlüssel braucht — und nach dem Marktradar, dessen Cache sie mitbenutzt.
    setupCryptoquantRoutes(app);
    startHypeTakt();
    startWachhundTakt();
    startCoinRadarTakt();
    startErgebnisTakt();
    setupBenachrichtigungsRoutes(app);
    startBenachrichtigungsTakt();
    setupOllamaRoutes(app);
    setupAiModelRoutes(app);
    setupAgentRoutes(app);
    setupAiUebersichtRoutes(app);
    setupHypeRadarRoutes(app);
    setupCoinRadarRoutes(app);
    setupUpdateRoutes(app);
    setupBackupRoutes(app);
    await setupFluxRoutes(app);
    setupLiveRecorder(app);
    setupStrategyRoutes(app);
    setupStrategyBuilderRoutes(app);
    setupRuleBuilderRoutes(app);
    setupRanglisteRoutes(app);
    // Eigene Regelstrategien aus der DB in die Registry holen — sie sind ab
    // jetzt von eingebauten nicht mehr zu unterscheiden.
    await ladeAlleRegelStrategien();
    console.log(" -> API routes initialized")

    // Strategie-Engine: der Takt läuft immer, gearbeitet wird nur für Instanzen,
    // die in der DB als aktiv markiert sind. Ein Neustart nimmt den Betrieb
    // damit genau dort wieder auf, wo er unterbrochen wurde.
    //
    // ABSCHALTBAR mit CTJ_NO_ENGINE=1. Nötig, weil der Guard gegen doppelte
    // Läufe prozesslokal ist: zeigen zwei Prozesse auf dieselbe Datenbank —
    // etwa ein Entwicklungsserver neben dem Produktivcontainer — takten BEIDE
    // dieselben Instanzen und können dasselbe Setup gleichzeitig ausführen.
    // Für Oberflächenarbeit an einer laufenden Papier-Datenbank ist das der
    // sichere Weg. (Die dauerhafte Lösung wäre eine Sperre in der Datenbank.)
    if (process.env.CTJ_NO_ENGINE === '1') {
        console.log(" -> Strategie-Engine deaktiviert (CTJ_NO_ENGINE=1)")
    } else {
        startStrategyEngine();
    }

    // Der Takt der Coin-Rangliste läuft AUCH mit CTJ_NO_ENGINE=1: er handelt
    // nicht, sondern rechnet nur — und der Entwicklungsrechner ist genau die
    // Maschine, an der jemand sitzt und einen Lauf startet. Dass trotzdem nur
    // einer arbeitet, sichert die Führungssperre in der Datenbank.
    startRanglisteTakt();

    if (process.env.NODE_ENV == 'dev') {
        // Vite ZUERST starten, dann den Proxy auf den Port richten, den es
        // wirklich bekommen hat.
        //
        // Vorher stand hier eine feste Zahl auf beiden Seiten. Läuft schon ein
        // zweiter Entwicklungsserver auf derselben Maschine, weicht Vite auf
        // einen freien Port aus — der Proxy zeigte aber weiter auf den festen.
        // Ergebnis: der eigene Server lieferte die Oberfläche der FREMDEN
        // Vite-Instanz aus, samt totem WebSocket und leerem Inhalt. Der Fehler
        // sieht wie ein kaputtes Frontend aus und ist keiner.
        const Vite = await import('vite')
        const gewuenscht = Number(process.env.CTJ_VITE_PORT) || PROXY_PORT
        const vite = await Vite.createServer({ server: { port: gewuenscht } });
        await vite.listen();
        const vitePort = vite.httpServer?.address()?.port || gewuenscht
        if (vitePort !== gewuenscht) {
            console.log(` -> Vite weicht auf Port ${vitePort} aus (${gewuenscht} belegt)`)
        }
        console.log(` -> Running vite dev server (Port ${vitePort})`);

        const { default: Proxy } = await import('http-proxy')
        const proxy = new Proxy.createProxyServer({
            target: { host: 'localhost', port: vitePort },
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

        // Vites heisses Neuladen läuft über einen WebSocket. Ohne diese
        // Weiterleitung endet er am Express-Server, der Browser meldet
        // „WebSocket connection failed" und man muss jede Änderung von Hand
        // neu laden — im Entwicklungsbetrieb genau das, was HMR abnehmen soll.
        viteProxy = proxy
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
            if (istLoopbackHost(host)) {
                console.log(' -> Server is only accessible locally (set CTJ_HOST=0.0.0.0 to allow network access)')
            } else if (!isAuthEnabled()) {
                // Hierher kommt man nur im Container (Erreichbarkeit regelt
                // dort das Port-Mapping) oder mit CTJ_ALLOW_INSECURE=1 — der
                // Startcheck oben bricht sonst ab.
                console.warn('\n  ⚠️  WARNUNG: Server ist im Netzwerk erreichbar (CTJ_HOST=' + host + '),')
                console.warn('      aber das Passwort-Gate ist NICHT aktiv. Jeder, der den Port erreicht,')
                console.warn('      hat vollen Zugriff auf Schlüssel, Handel und Backup.')
                console.warn('      → Passwortschutz in den Einstellungen aktivieren.\n')
            }
            resolve()
        });
        // Vites heisses Neuladen braucht den WebSocket-Upgrade — ohne diese
        // Zeile endet er hier statt bei Vite, und jede Änderung müsste von Hand
        // neu geladen werden.
        server.on('upgrade', (req, socket, head) => {
            if (viteProxy) viteProxy.ws(req, socket, head)
            else socket.destroy()
        })

        server.on('error', reject)
    })

    // Beim Beenden die angefangene Aufzeichnungs-Stunde noch wegschreiben,
    // sonst geht sie beim Container-Neustart verloren.
    let shuttingDown = false
    for (const signal of ['SIGTERM', 'SIGINT']) {
        process.on(signal, async () => {
            if (shuttingDown) return
            shuttingDown = true
            console.log(`\n${signal} — fahre herunter…`)
            try { await stopLiveRecorder() } catch (e) { /* trotzdem beenden */ }
            // Laufende Strategie-Durchgänge auslaufen lassen, damit keine
            // halb ausgeführte Order zurückbleibt.
            try { await stopStrategyEngine() } catch (e) { /* trotzdem beenden */ }
            // Ein laufender Rangliste-Lauf braucht kein Auslaufen: jeder Coin
            // ist einzeln gesichert, der nächste Start nimmt ihn wieder auf.
            try { stopRanglisteTakt() } catch (e) { /* trotzdem beenden */ }
            try { stopMarktradar() } catch (e) { /* trotzdem beenden */ }
            try { stopKalender(); stopNews(); stopBenachrichtigungen(); stopCryptoquant() } catch (e) { /* trotzdem beenden */ }
            process.exit(0)
        })
    }

    console.log("\n Crypto Trading Journal ready!")
}

startIndex().catch(err => {
    console.error('\n STARTUP FAILED:', err.message || err)
    process.exit(1)
})
