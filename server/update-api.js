/**
 * Update API — checks GitHub for new releases, performs one-click updates.
 *
 * GET  /api/update/check   → compare local version with latest GitHub release
 * POST /api/update/install  → git fetch + reset + npm install + signal restart
 */
import { execSync, spawn } from 'child_process'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import http from 'http'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const GITHUB_REPO = 'Mouses007/Crypto-Trading-Journal'
const PROJECT_ROOT = path.resolve(__dirname, '..')
const IS_WINDOWS = os.platform() === 'win32'
const IS_DOCKER = existsSync('/.dockerenv')
const DOCKER_SOCK = '/var/run/docker.sock'
const HAS_DOCKER_SOCK = IS_DOCKER && existsSync(DOCKER_SOCK)

/**
 * Minimal Docker Engine API client via Unix socket.
 * No dependency — just http over the docker socket.
 */
function dockerApi(method, apiPath, body) {
    return new Promise((resolve, reject) => {
        const opts = {
            socketPath: DOCKER_SOCK,
            method,
            path: apiPath,
            headers: { 'Host': 'docker' }
        }
        if (body !== undefined) {
            const payload = typeof body === 'string' ? body : JSON.stringify(body)
            opts.headers['Content-Type'] = 'application/json'
            opts.headers['Content-Length'] = Buffer.byteLength(payload)
            const req = http.request(opts, (res) => {
                let data = ''
                res.on('data', c => data += c)
                res.on('end', () => {
                    if (res.statusCode >= 400) return reject(new Error(`Docker API ${method} ${apiPath} -> ${res.statusCode}: ${data}`))
                    try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({ raw: data }) }
                })
            })
            req.on('error', reject)
            req.write(payload)
            req.end()
            return
        }
        const req = http.request(opts, (res) => {
            let data = ''
            res.on('data', c => data += c)
            res.on('end', () => {
                if (res.statusCode >= 400) return reject(new Error(`Docker API ${method} ${apiPath} -> ${res.statusCode}: ${data}`))
                try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({ raw: data }) }
            })
        })
        req.on('error', reject)
        req.end()
    })
}

/**
 * Treat localhost-access as "non-Docker" even when the server runs in a container.
 * This restores direct git-based updates for developers who run the stack
 * locally (docker-compose on their own machine) while keeping the Watchtower
 * UI for remote access (e.g. NAS at 192.168.x.x).
 */
function isLocalRequest(req) {
    const host = String(req.hostname || '').toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
    const ip = String(req.ip || '').replace('::ffff:', '')
    return ip === '127.0.0.1' || ip === '::1'
}
function effectiveIsDocker(req) {
    return IS_DOCKER && !isLocalRequest(req)
}

/**
 * Docker-Mode Install:
 * 1. Lese eigene Container-Config via Docker-Socket (hostname = Container-ID im Docker-Netzwerk)
 * 2. Extrahiere compose-Projekt-Label (working_dir auf dem Host) + Image-Name
 * 3. Pull neues Image via Docker API (blocking, damit wir erst danach antworten)
 * 4. Erstelle einen Helfer-Container (Image: docker:cli) der nach kurzer Wartezeit
 *    `docker compose -f <compose> up -d --force-recreate --no-deps journal` ausfuehrt
 * 5. Antworte dem Client, sterbe kurz danach — der Helfer ersetzt uns
 */
async function installDockerUpdate(res) {
    if (!HAS_DOCKER_SOCK) {
        return res.status(400).json({
            ok: false,
            error: 'Docker-Socket nicht verfuegbar (/var/run/docker.sock nicht gemountet). Fuege in docker-compose.yml im journal-Service hinzu:\n\n' +
                '  volumes:\n    - /var/run/docker.sock:/var/run/docker.sock\n\n' +
                'Oder update manuell: docker compose pull && docker compose up -d'
        })
    }

    const steps = []
    let selfName = process.env.HOSTNAME || 'crypto-trading-journal'

    // 1. Eigene Config lesen (hostname inside docker == container short-id)
    let self
    try {
        self = await dockerApi('GET', `/containers/${selfName}/json`)
    } catch (e) {
        // Fallback: try by known container_name from compose
        try {
            self = await dockerApi('GET', `/containers/crypto-trading-journal/json`)
            selfName = 'crypto-trading-journal'
        } catch (e2) {
            return res.status(500).json({ ok: false, error: 'Kann eigenen Container nicht identifizieren: ' + e.message })
        }
    }
    const imageName = self.Config?.Image || 'mouses007/trading-journal:latest'
    const labels = self.Config?.Labels || {}
    // HOST-Pfad bevorzugt aus CTJ_HOST_COMPOSE_DIR (.env) — der ist stabil.
    // Der compose-Label 'working_dir' wird von compose bei jedem Recreate
    // auf den CWD gesetzt und damit pollutet, wenn compose aus einem
    // Helfer-Container heraus laeuft. Env-Var aus .env bleibt unveraendert.
    const composeWorkingDir = process.env.CTJ_HOST_COMPOSE_DIR || labels['com.docker.compose.project.working_dir']
    const composeService = labels['com.docker.compose.service']
    const composeProject = labels['com.docker.compose.project']

    if (!composeWorkingDir || !composeService) {
        return res.status(400).json({
            ok: false,
            error: 'Container wurde nicht mit docker-compose gestartet oder CTJ_HOST_COMPOSE_DIR fehlt in .env. Update manuell: docker pull ' + imageName + ' && docker compose up -d'
        })
    }
    steps.push({ step: 'self config', output: `image=${imageName} service=${composeService} project=${composeProject} cwd=${composeWorkingDir}` })

    // 2. Neues Image pullen (streaming response — wir lesen bis Ende)
    try {
        await new Promise((resolve, reject) => {
            const opts = {
                socketPath: DOCKER_SOCK,
                method: 'POST',
                path: `/images/create?fromImage=${encodeURIComponent(imageName)}`,
                headers: { 'Host': 'docker' }
            }
            const req = http.request(opts, (pullRes) => {
                pullRes.on('data', () => {}) // verbrauchen
                pullRes.on('end', () => pullRes.statusCode < 400 ? resolve() : reject(new Error('Pull fehlgeschlagen: HTTP ' + pullRes.statusCode)))
            })
            req.on('error', reject)
            req.end()
        })
        steps.push({ step: 'docker pull', output: 'OK: ' + imageName })
    } catch (e) {
        return res.status(500).json({ ok: false, error: 'docker pull fehlgeschlagen: ' + e.message })
    }

    // 3. Helfer-Container erstellen + starten
    // - docker:cli Image enthaelt `docker` CLI + compose-Plugin
    // - Socket gemountet; Host-Projekt-Dir wird an den IDENTISCHEN Pfad im
    //   Helfer gemountet. Damit sieht compose denselben Pfad wie auf dem
    //   Host und setzt die compose-Labels korrekt — verhindert die
    //   "/compose"-Label-Pollution die beim Pfad-Remapping auftritt.
    // - AutoRemove loescht den Helfer nach Abschluss
    // - Das Skript wartet 3s, damit unsere Response den Client erreicht
    const helperName = `ctj-updater-${Date.now()}`
    const helperConfig = {
        Image: 'docker:cli',
        Cmd: ['sh', '-c',
            `sleep 3 && cd "${composeWorkingDir}" && docker compose up -d --force-recreate --no-deps ${composeService}`
        ],
        Env: [
            `COMPOSE_PROJECT_NAME=${composeProject || ''}`
        ],
        HostConfig: {
            Binds: [
                `${DOCKER_SOCK}:${DOCKER_SOCK}`,
                `${composeWorkingDir}:${composeWorkingDir}`
            ],
            AutoRemove: true,
            NetworkMode: 'bridge'
        }
    }

    try {
        const created = await dockerApi('POST', `/containers/create?name=${helperName}`, helperConfig)
        await dockerApi('POST', `/containers/${created.Id}/start`)
        steps.push({ step: 'helper container', output: helperName + ' gestartet' })
    } catch (e) {
        return res.status(500).json({ ok: false, error: 'Helfer-Container konnte nicht gestartet werden: ' + e.message })
    }

    // 4. Antworten — danach wird uns der Helfer in ~3s beenden und neu erstellen
    res.json({ ok: true, dockerMode: true, steps, newVersion: null, message: 'Update laeuft (Docker-Modus). Container wird in ~10 Sekunden neu erstellt.' })

    // Defensive: Cache leeren, damit naechster Check nicht wartet
    lastCheck = null
    lastCheckTime = 0
}

/**
 * Windows: Erstellt ein .bat-Script und startet es in einem neuen Fenster.
 * Nötig weil Windows native .node-Dateien sperrt solange der Server läuft.
 * Das Script wartet bis der Server beendet ist, dann: npm install + build + Neustart.
 */
function spawnWindowsUpdateScript(commands, label) {
    const scriptPath = path.join(PROJECT_ROOT, '_ctj_update.bat')
    const script = `@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   Crypto Trading Journal - ${label}
echo ========================================
echo.
echo Warte auf Server-Beendigung...
timeout /t 4 /nobreak >nul
cd /d "${PROJECT_ROOT}"
${commands.map(cmd => `echo ^> ${cmd}\ncall ${cmd}\nif %errorlevel% neq 0 (\n    echo.\n    echo FEHLER bei: ${cmd}\n    echo Druecke eine Taste zum Schliessen...\n    pause >nul\n    exit /b 1\n)`).join('\n')}
echo.
echo ========================================
echo   ${label} erfolgreich!
echo   Server wird neu gestartet...
echo ========================================
echo.
node index.mjs
`
    writeFileSync(scriptPath, script, 'utf8')

    spawn('cmd.exe', ['/c', 'start', `"CTJ ${label}"`, 'cmd.exe', '/k', scriptPath], {
        detached: true,
        stdio: 'ignore',
        cwd: PROJECT_ROOT
    }).unref()
}

// Simple HTTPS GET returning JSON
function httpsGetJson(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: { 'User-Agent': 'CryptoTradingJournal' }
        }
        https.get(url, options, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpsGetJson(res.headers.location).then(resolve).catch(reject)
            }
            let data = ''
            res.on('data', chunk => data += chunk)
            res.on('end', () => {
                try { resolve(JSON.parse(data)) }
                catch (e) { reject(new Error('Invalid JSON: ' + data.substring(0, 200))) }
            })
        }).on('error', reject)
    })
}

// Get local version from package.json
function getLocalVersion() {
    const pkg = JSON.parse(readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'))
    return pkg.version
}

// Compare semver: returns 1 if a > b, -1 if a < b, 0 if equal
function compareSemver(a, b) {
    const pa = a.replace(/^v/, '').split('.').map(Number)
    const pb = b.replace(/^v/, '').split('.').map(Number)
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) > (pb[i] || 0)) return 1
        if ((pa[i] || 0) < (pb[i] || 0)) return -1
    }
    return 0
}

// Cache: last check result (avoid hammering GitHub)
let lastCheck = null
let lastCheckTime = 0
const CHECK_CACHE_MS = 5 * 60 * 1000 // 5 min cache

// Rollback: Commit-Hash vor dem Update
let preUpdateCommit = null

export function setupUpdateRoutes(app) {

    // ── Check for updates ──────────────────────────────────────────
    app.get('/api/update/check', async (req, res) => {
        try {
            const now = Date.now()
            const forceRefresh = req.query.force === '1'

            // Return cached result if fresh (isDocker is computed per-request)
            if (!forceRefresh && lastCheck && (now - lastCheckTime) < CHECK_CACHE_MS) {
                return res.json({ ...lastCheck, isDocker: effectiveIsDocker(req) })
            }

            const localVersion = getLocalVersion()

            // Fetch latest release from GitHub
            const release = await httpsGetJson(
                `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
            )

            const remoteVersion = (release.tag_name || '').replace(/^v/, '')
            const updateAvailable = compareSemver(remoteVersion, localVersion) > 0

            lastCheck = {
                ok: true,
                localVersion,
                remoteVersion,
                updateAvailable,
                releaseName: release.name || '',
                releaseNotes: release.body || '',
                releaseUrl: release.html_url || '',
                publishedAt: release.published_at || ''
            }
            lastCheckTime = now

            res.json({ ...lastCheck, isDocker: effectiveIsDocker(req) })
        } catch (err) {
            // If no releases exist yet, that's OK
            if (err.message && err.message.includes('Not Found')) {
                const localVersion = getLocalVersion()
                lastCheck = {
                    ok: true,
                    localVersion,
                    remoteVersion: localVersion,
                    updateAvailable: false,
                    releaseName: '',
                    releaseNotes: '',
                    releaseUrl: '',
                    publishedAt: ''
                }
                lastCheckTime = Date.now()
                return res.json({ ...lastCheck, isDocker: effectiveIsDocker(req) })
            }
            console.error('Update check failed:', err.message)
            res.status(500).json({ ok: false, error: err.message })
        }
    })

    // ── Install update ─────────────────────────────────────────────
    app.post('/api/update/install', async (req, res) => {
        try {
            // Docker-Modus: neues Image pullen und Container via Helfer neu erstellen
            if (IS_DOCKER) {
                return await installDockerUpdate(res)
            }

            // Pruefen ob Git-Repository vorhanden ist
            if (!existsSync(path.join(PROJECT_ROOT, '.git'))) {
                return res.status(400).json({
                    ok: false,
                    error: 'Git-Repository nicht gefunden. Bitte fuehre im Installationsordner aus:\n' +
                        'git init && git remote add origin https://github.com/Mouses007/Crypto-Trading-Journal.git && git fetch origin master\n' +
                        'Oder installiere neu mit: git clone https://github.com/Mouses007/Crypto-Trading-Journal.git'
                })
            }

            const steps = []

            // 0. Aktuellen Commit-Hash speichern (für Rollback)
            // HEAD kann fehlen wenn git init ohne Commits (frische Installation)
            try {
                preUpdateCommit = execSync('git rev-parse HEAD', {
                    cwd: PROJECT_ROOT,
                    encoding: 'utf8',
                    timeout: 5000
                }).trim()
                steps.push({ step: 'save rollback point', output: preUpdateCommit })
            } catch (e) {
                // Kein HEAD vorhanden — frische Installation ohne Commits
                preUpdateCommit = null
                steps.push({ step: 'save rollback point', output: 'Kein bisheriger Commit (frische Installation) — Rollback nicht verfügbar' })
            }

            // 1. git fetch + reset statt pull (funktioniert auch ohne HEAD/Commits)
            const fetchOutput = execSync('git fetch origin master', {
                cwd: PROJECT_ROOT,
                encoding: 'utf8',
                timeout: 60000
            }).trim()
            steps.push({ step: 'git fetch', output: fetchOutput || 'OK' })

            const pullOutput = execSync('git reset --hard origin/master', {
                cwd: PROJECT_ROOT,
                encoding: 'utf8',
                timeout: 60000
            }).trim()
            steps.push({ step: 'git reset', output: pullOutput })

            // Read new version (from git reset — package.json ist schon aktuell)
            const newVersion = getLocalVersion()

            // Clear cache
            lastCheck = null
            lastCheckTime = 0

            if (IS_WINDOWS) {
                // Windows: native .node-Dateien sind gesperrt → externes Script
                steps.push({ step: 'npm install + build', output: 'Wird in neuem Fenster ausgeführt...' })
                spawnWindowsUpdateScript(['npm install', 'npm run build'], 'Update')
                res.json({ ok: true, steps, newVersion })
                setTimeout(() => {
                    console.log('\n🔄 Update — Server wird beendet, externes Script übernimmt...')
                    process.exit(0)
                }, 1500)
            } else {
                // Linux/macOS: npm install + build inline (keine Dateisperren)
                const npmOutput = execSync('npm install', {
                    cwd: PROJECT_ROOT,
                    encoding: 'utf8',
                    timeout: 120000
                }).trim()
                steps.push({ step: 'npm install', output: npmOutput })

                const buildOutput = execSync('npm run build', {
                    cwd: PROJECT_ROOT,
                    encoding: 'utf8',
                    timeout: 120000
                }).trim()
                steps.push({ step: 'npm run build', output: buildOutput })

                res.json({ ok: true, steps, newVersion })

                setTimeout(() => {
                    console.log('\n🔄 Update installed — restarting server...')
                    process.exit(0)
                }, 1500)
            }

        } catch (err) {
            console.error('Update install failed:', err.message)
            res.status(500).json({ ok: false, error: err.message })
        }
    })

    // ── Rollback to previous version ────────────────────────────────
    app.post('/api/update/rollback', async (req, res) => {
        // Pruefen ob Git-Repository vorhanden ist
        if (!existsSync(path.join(PROJECT_ROOT, '.git'))) {
            return res.status(400).json({
                ok: false,
                error: 'Git-Repository nicht gefunden. Rollback nicht moeglich.'
            })
        }
        if (!preUpdateCommit) {
            return res.status(400).json({ ok: false, error: 'Kein Rollback-Punkt vorhanden. Rollback ist nur nach einem Update möglich.' })
        }

        try {
            const steps = []

            // 1. Zurück zum gespeicherten Commit
            const checkoutOutput = execSync(`git checkout ${preUpdateCommit} -- .`, {
                cwd: PROJECT_ROOT,
                encoding: 'utf8',
                timeout: 30000
            }).trim()
            steps.push({ step: 'git checkout', output: checkoutOutput || 'OK' })

            const restoredVersion = getLocalVersion()
            preUpdateCommit = null // Rollback-Punkt verbraucht
            lastCheck = null
            lastCheckTime = 0

            if (IS_WINDOWS) {
                steps.push({ step: 'npm install + build', output: 'Wird in neuem Fenster ausgeführt...' })
                spawnWindowsUpdateScript(['npm install', 'npm run build'], 'Rollback')
                res.json({ ok: true, steps, restoredVersion })
                setTimeout(() => {
                    console.log('\n🔄 Rollback — Server wird beendet, externes Script übernimmt...')
                    process.exit(0)
                }, 1500)
            } else {
                const npmOutput = execSync('npm install', {
                    cwd: PROJECT_ROOT,
                    encoding: 'utf8',
                    timeout: 120000
                }).trim()
                steps.push({ step: 'npm install', output: npmOutput })

                const buildOutput = execSync('npm run build', {
                    cwd: PROJECT_ROOT,
                    encoding: 'utf8',
                    timeout: 120000
                }).trim()
                steps.push({ step: 'npm run build', output: buildOutput })

                res.json({ ok: true, steps, restoredVersion })

                setTimeout(() => {
                    console.log('\n🔄 Rollback durchgeführt — Server wird neu gestartet...')
                    process.exit(0)
                }, 1500)
            }

        } catch (err) {
            console.error('Rollback failed:', err.message)
            res.status(500).json({ ok: false, error: err.message })
        }
    })

    // ── Rollback status ─────────────────────────────────────────────
    app.get('/api/update/rollback-status', (req, res) => {
        res.json({ available: !!preUpdateCommit, commit: preUpdateCommit || null })
    })

    // ── Startup check (non-blocking) ───────────────────────────────
    setTimeout(async () => {
        // Pruefen ob Git-Repository vorhanden ist
        if (!existsSync(path.join(PROJECT_ROOT, '.git'))) {
            console.log(' -> Kein Git-Repository gefunden — Auto-Updates nicht verfuegbar')
            console.log('    Tipp: git init && git remote add origin https://github.com/Mouses007/Crypto-Trading-Journal.git && git fetch origin master')
            return
        }

        try {
            const localVersion = getLocalVersion()
            const release = await httpsGetJson(
                `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
            )
            const remoteVersion = (release.tag_name || '').replace(/^v/, '')
            const updateAvailable = compareSemver(remoteVersion, localVersion) > 0

            lastCheck = {
                ok: true,
                localVersion,
                remoteVersion,
                updateAvailable,
                releaseName: release.name || '',
                releaseNotes: release.body || '',
                releaseUrl: release.html_url || '',
                publishedAt: release.published_at || ''
            }
            lastCheckTime = Date.now()

            if (updateAvailable) {
                console.log(`\n🆕 Update verfügbar: v${localVersion} → v${remoteVersion}`)
            } else {
                console.log(` -> Version v${localVersion} ist aktuell`)
            }
        } catch (err) {
            // Silent fail on startup — no release yet is fine
            if (!err.message?.includes('Not Found')) {
                console.log(' -> Update-Check fehlgeschlagen:', err.message)
            }
        }
    }, 3000)
}
