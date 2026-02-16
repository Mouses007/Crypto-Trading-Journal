import express from 'express';
import path from 'path'
import * as Vite from 'vite'
import { getDb } from './server/database.js'
import { setupApiRoutes } from './server/api-routes.js'
import { setupBitunixRoutes } from './server/bitunix-api.js'
import { setupBinanceRoutes } from './server/binance-api.js'
import { setupOllamaRoutes } from './server/ollama-api.js'

const app = express();
app.use(express.json({ limit: '50mb' }));

const port = process.env.TRADENOTE_PORT || 8080;
const PROXY_PORT = 39482;

const startIndex = async () => {

    // Initialize SQLite database
    console.log("\nINITIALIZING DATABASE")
    getDb()

    const startServer = async () => {
        console.log("\nSTARTING NODEJS SERVER")
        return new Promise(async (resolve) => {
            app.listen(port, function () {
                console.log(' -> TradeNote server started on http://localhost:' + port)
            });
            resolve()
        })
    }

    const runServer = async () => {
        console.log("\nRUNNING SERVER");

        return new Promise(async (resolve) => {
            if (process.env.NODE_ENV == 'dev') {
                // Set up API routes first
                app.use('/api/*', (req, res, next) => {
                    next();
                });
                setupApiRoutes(app);
                setupBitunixRoutes(app, getDb);
                setupBinanceRoutes(app);
                setupOllamaRoutes(app);

                // Proxy non-API routes to Vite dev server
                const { default: Proxy } = await import('http-proxy')
                const proxy = new Proxy.createProxyServer({
                    target: { host: 'localhost', port: PROXY_PORT },
                });

                app.use((req, res, next) => {
                    if (req.url.startsWith('/api/')) {
                        return next();
                    }
                    proxy.web(req, res);
                });

                const vite = await Vite.createServer({ server: { port: PROXY_PORT } });
                vite.listen();
                console.log(" -> Running vite dev server");
                resolve();
            } else {
                // Production: API routes + static files
                app.use('/api/*', express.json(), (req, res, next) => {
                    next();
                });
                setupApiRoutes(app);
                setupBitunixRoutes(app, getDb);
                setupBinanceRoutes(app);
                setupOllamaRoutes(app);

                app.use(express.static('dist'));
                app.get('*', (req, res) => {
                    res.sendFile(path.resolve('dist', 'index.html'));
                });
                console.log(" -> Running prod server");
                resolve();
            }
        });
    };

    await startServer()
    await runServer()

    console.log("\n TradeNote ready!")
}
startIndex()
