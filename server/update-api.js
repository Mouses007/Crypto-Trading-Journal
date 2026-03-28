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
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const GITHUB_REPO = 'Mouses007/Crypto-Trading-Journal'
const PROJECT_ROOT = path.resolve(__dirname, '..')
const IS_WINDOWS = os.platform() === 'win32'
const IS_DOCKER = existsSync('/.dockerenv')

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

            // Return cached result if fresh
            if (!forceRefresh && lastCheck && (now - lastCheckTime) < CHECK_CACHE_MS) {
                return res.json(lastCheck)
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
                isDocker: IS_DOCKER,
                releaseName: release.name || '',
                releaseNotes: release.body || '',
                releaseUrl: release.html_url || '',
                publishedAt: release.published_at || ''
            }
            lastCheckTime = now

            res.json(lastCheck)
        } catch (err) {
            // If no releases exist yet, that's OK
            if (err.message && err.message.includes('Not Found')) {
                const localVersion = getLocalVersion()
                lastCheck = {
                    ok: true,
                    localVersion,
                    remoteVersion: localVersion,
                    updateAvailable: false,
                    isDocker: IS_DOCKER,
                    releaseName: '',
                    releaseNotes: '',
                    releaseUrl: '',
                    publishedAt: ''
                }
                lastCheckTime = Date.now()
                return res.json(lastCheck)
            }
            console.error('Update check failed:', err.message)
            res.status(500).json({ ok: false, error: err.message })
        }
    })

    // ── Install update ─────────────────────────────────────────────
    app.post('/api/update/install', async (req, res) => {
        try {
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
                isDocker: IS_DOCKER,
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
