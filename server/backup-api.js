import fs from 'fs'
import { getKnex } from './database.js'
import { loadDbConfig, getConfigPath, saveDbConfig } from './db-config.js'
import { SETTINGS_SENSITIVE_FIELDS } from './api-routes.js'

/*
 * Sensible Felder, die im Export unkenntlich gemacht werden.
 *
 * IMPORTIERT statt abgeschrieben: die Kopie hier hinkte der Liste in
 * `api-routes.js` hinterher, `aiKeyPerplexity` fehlte und ging im Klartext ins
 * Backup. Genau diese Fehlerklasse soll ein Import ausschliessen — ein neuer
 * Schlüssel wird an einer Stelle eingetragen und ist hier automatisch dabei.
 */
const REDACTED_SETTINGS_KEYS = [...SETTINGS_SENSITIVE_FIELDS]

// Settings-Felder, die beim Import NIE aus dem Backup übernommen werden:
// - die redigierten Secrets (Export enthält nur '[REDACTED]' → würde echte Keys
//   zerstören bzw. via authPasswordHash den Eigentümer aussperren)
// - die Auth-Schalter selbst (Schutz vor Manipulation per fremdem Backup)
// Die bestehenden Werte bleiben stattdessen erhalten.
const PRESERVE_SETTINGS_FIELDS = [...REDACTED_SETTINGS_KEYS, 'authEnabled']

// Alle Tabellen die gesichert werden (Reihenfolge wichtig für Import: abhängige zuletzt)
const BACKUP_TABLES = [
    'settings',
    'trades',
    'diaries',
    'screenshots',
    'playbooks',
    'satisfactions',
    'tags',
    'notes',
    'excursions',
    'incoming_positions',
    'bitunix_config',
    'bitget_config',
    'ai_reports',
    'ai_report_messages',
    // Tagesschnappschüsse des Marktradars (BTC-Dominanz, Gesamtmarkt). Winzig,
    // aber NICHT nachbestellbar: für die Dominanz gibt es keine kostenlose
    // Historie. Einmal verloren ist der Bestand endgültig weg — deshalb steht
    // sie im Backup, während die viel grösseren live_recordings draussen
    // bleiben (die sind ein Mitschnitt, kein Original).
    'market_snapshots',
    // Vergangene Wochen liefert der Feed nicht mehr — einmal verloren, weg
    'calendar_events',
    // Handelssitzungen aus dem Live-Trading-Fenster: Plan, Notizen und Fazit
    // sind Handarbeit und stehen nirgendwo sonst. Der eingefrorene Trade-Stand
    // darin liesse sich zwar aus dem Journal neu rechnen — aber nicht mehr so,
    // wie er am Ende der Sitzung aussah.
    'live_sessions',
    // ── Strategie-Sektion ───────────────────────────────────────────────
    // Selbst gebaute Regelstrategien existieren NIRGENDWO sonst — sie sind
    // Handarbeit des Nutzers, kein Mitschnitt. Ohne sie wäre der
    // Versionsverlauf darunter sinnlos: Fassungen von Strategien, die es nach
    // dem Rückspielen nicht mehr gibt.
    'rule_strategies',
    'rule_strategy_history',
    // Instanzen sind Konfiguration (winzig), die Parameter-Historie erklärt
    // alte Trades, und die Trades selbst sind das Ergebnis eines Laufs, der
    // sich nicht wiederholen lässt — er hing an echten Kursen zu echten Zeiten.
    'strategy_instances',
    'strategy_param_history',
    'strategy_trades',
    // ── Marktradar-Nachrichten ──────────────────────────────────────────
    // Die Kanalliste ist Handarbeit des Nutzers. Die Lageberichte sind der
    // eigentliche Grund: sie haben KI-Kontingent gekostet und lassen sich nicht
    // nachbestellen — die Beiträge, aus denen sie entstanden, werden nach 30
    // Tagen gelöscht, ein zweiter Lauf ergäbe nie denselben Bericht.
    // `news_items` bleibt bewusst draussen: wächst schnell, jederzeit neu
    // holbar, und es sind fremde Inhalte, die nicht in eine Datei gehören, die
    // der Nutzer womöglich weitergibt. Dieselbe Linie wie bei live_recordings.
    'news_sources',
    'news_digests',
    // ── Coin-Rangliste ──────────────────────────────────────────────────
    // Von Hand gepflegte Listen sind Handarbeit, KI-Vorschläge haben Kontingent
    // gekostet — beides existiert nirgendwo sonst. Die LÄUFE bleiben draussen:
    // sie sind jederzeit neu rechenbar und tragen je Coin eine R-Reihe im JSON,
    // die die Sicherungsdatei dominieren würde (dieselbe Begründung wie bei
    // `strategy_backtests` weiter unten).
    'coin_universen',
]

/**
 * Bewusst NICHT im Backup: `strategy_setups`, `strategy_positions`,
 * `strategy_runs`, `strategy_backtests`, `rangliste_laeufe` und
 * `rangliste_zeilen`. Die ersten drei sind Zwischenstände
 * in grosser Zahl — aus Instanzen und Kerzen jederzeit neu erzeugbar. Backtests
 * sind zwar die Experiment-Registry, tragen aber je Lauf bis zu 500 Trades im
 * JSON; sie würden die Sicherungsdatei dominieren. Wer sie braucht, exportiert
 * die Strategie einzeln (`/api/strategies/rules/:id/export`).
 */

// Beim Import: abhängige Tabellen zuerst löschen
const DELETE_ORDER = [
    'coin_universen',
    'news_digests',
    'news_sources',
    // Abhängige zuerst: die Historie zeigt (fachlich, nicht per Fremdschlüssel)
    // auf `rule_strategies`, die Trades auf `strategy_instances`.
    'rule_strategy_history',
    'strategy_trades',
    'strategy_param_history',
    'strategy_instances',
    'rule_strategies',
    'live_sessions',
    'calendar_events',
    'market_snapshots',
    'ai_report_messages',
    'ai_reports',
    'excursions',
    'notes',
    'tags',
    'satisfactions',
    'incoming_positions',
    'screenshots',
    'playbooks',
    'diaries',
    'trades',
    'bitunix_config',
    'bitget_config',
    'settings',
]

export function setupBackupRoutes(app) {

    // ==================== EXPORT ====================
    app.get('/api/db-export', async (req, res) => {
        try {
            const knex = getKnex()
            const dbConfig = loadDbConfig()
            const tables = {}

            for (const table of BACKUP_TABLES) {
                try {
                    const hasTable = await knex.schema.hasTable(table)
                    if (hasTable) {
                        tables[table] = await knex(table).select('*')
                    }
                } catch (e) {
                    console.warn(`Backup: Tabelle "${table}" übersprungen:`, e.message)
                }
            }

            // Sensitive Felder redaktieren
            if (tables.settings && tables.settings.length > 0) {
                for (const key of REDACTED_SETTINGS_KEYS) {
                    if (tables.settings[0][key]) tables.settings[0][key] = '[REDACTED]'
                }
            }
            for (const configTable of ['bitunix_config', 'bitget_config']) {
                if (tables[configTable]) {
                    for (const row of tables[configTable]) {
                        if (row.apiKey) row.apiKey = '[REDACTED]'
                        if (row.secretKey) row.secretKey = '[REDACTED]'
                        if (row.passphrase) row.passphrase = '[REDACTED]'
                    }
                }
            }

            // db-config.json mitlesen (Datenbankverbindung)
            let dbConfigFile = null
            try {
                const configPath = getConfigPath()
                if (fs.existsSync(configPath)) {
                    dbConfigFile = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
                    // DB-Passwort redaktieren
                    if (dbConfigFile && dbConfigFile.password) {
                        dbConfigFile = { ...dbConfigFile, password: '[REDACTED]' }
                    }
                }
            } catch (e) {
                // Kein db-config.json vorhanden (SQLite default)
            }

            res.json({
                exportedAt: new Date().toISOString(),
                version: '2.2.0',
                dbType: dbConfig?.type || 'sqlite',
                dbConfig: dbConfigFile,
                tables
            })
        } catch (e) {
            console.error('Backup export error:', e)
            res.status(500).json({ error: e.message || 'Export fehlgeschlagen' })
        }
    })

    // ==================== IMPORT ====================
    app.post('/api/db-import', async (req, res) => {
        const { tables, dbConfig: backupDbConfig, confirmDbConfigOverwrite } = req.body
        if (!tables || typeof tables !== 'object') {
            return res.status(400).json({ ok: false, error: 'Ungültiges Backup-Format: "tables" Objekt fehlt' })
        }

        try {
            const knex = getKnex()
            const dbConfig = loadDbConfig()
            const isPg = dbConfig?.client === 'pg' || dbConfig?.client === 'postgresql' || dbConfig?.type === 'postgresql'
            const imported = {}

            // Alle Tabellen in einer Transaktion leeren und neu befüllen
            await knex.transaction(async (trx) => {

                // 0. Sensible/Auth-Settings vor dem Leeren sichern → werden NICHT
                //    aus dem Backup überschrieben (verhindert Lockout/Manipulation)
                let preservedSettings = null
                try {
                    if (await trx.schema.hasTable('settings')) {
                        preservedSettings = await trx('settings').where('id', 1).first()
                    }
                } catch (e) { /* ignore */ }

                // 1. Tabellen in Abhängigkeitsreihenfolge leeren
                for (const table of DELETE_ORDER) {
                    if (tables[table]) {
                        try {
                            const hasTable = await trx.schema.hasTable(table)
                            if (hasTable) {
                                await trx(table).del()
                            }
                        } catch (e) {
                            console.warn(`Backup import: Löschen von "${table}" fehlgeschlagen:`, e.message)
                        }
                    }
                }

                // 2. Daten einfügen (in Batches für SQLite-Kompatibilität)
                for (const table of BACKUP_TABLES) {
                    const rows = tables[table]
                    if (!rows || !Array.isArray(rows) || rows.length === 0) continue

                    try {
                        const hasTable = await trx.schema.hasTable(table)
                        if (!hasTable) {
                            console.warn(`Backup import: Tabelle "${table}" existiert nicht, übersprungen`)
                            continue
                        }

                        // Spalten der Zieltabelle ermitteln (nur bekannte Spalten einfügen)
                        const columnInfo = await trx(table).columnInfo()
                        const validColumns = Object.keys(columnInfo)

                        // Rows filtern: nur gültige Spalten behalten.
                        // Bei settings: sensible/Auth-Felder NICHT aus dem Backup übernehmen.
                        const skipCols = table === 'settings' ? new Set(PRESERVE_SETTINGS_FIELDS) : null
                        const cleanRows = rows.map(row => {
                            const clean = {}
                            for (const col of validColumns) {
                                if (skipCols && skipCols.has(col)) continue
                                if (row[col] !== undefined) {
                                    clean[col] = row[col]
                                }
                            }
                            return clean
                        })

                        // In 100er-Batches einfügen (SQLite-Limit)
                        const batchSize = 100
                        for (let i = 0; i < cleanRows.length; i += batchSize) {
                            const batch = cleanRows.slice(i, i + batchSize)
                            await trx(table).insert(batch)
                        }

                        imported[table] = cleanRows.length
                    } catch (e) {
                        console.error(`Backup import: Fehler bei "${table}":`, e.message)
                        throw e // Transaktion abbrechen
                    }
                }

                // 3. Gesicherte sensible/Auth-Settings wiederherstellen (nicht aus Backup)
                if (preservedSettings) {
                    const restore = {}
                    for (const field of PRESERVE_SETTINGS_FIELDS) {
                        if (preservedSettings[field] !== undefined) restore[field] = preservedSettings[field]
                    }
                    if (Object.keys(restore).length > 0) {
                        await trx('settings').where('id', 1).update(restore)
                    }
                }
            })

            // 3. PostgreSQL: Sequenzen reparieren
            if (isPg) {
                await fixSequencesAfterImport(knex)
            }

            // 4. db-config.json wiederherstellen — NUR mit ausdrücklicher Bestätigung
            //    und gültiger Struktur. Das Überschreiben der DB-Verbindung ist
            //    sicherheitskritisch (kann die App auf eine fremde DB umleiten).
            if (backupDbConfig && typeof backupDbConfig === 'object') {
                if (confirmDbConfigOverwrite !== true) {
                    imported['db-config.json'] = 'übersprungen (Bestätigung fehlt: confirmDbConfigOverwrite)'
                } else if (!isValidDbConfig(backupDbConfig)) {
                    imported['db-config.json'] = 'übersprungen (ungültige Struktur)'
                } else {
                    try {
                        saveDbConfig(backupDbConfig)
                        imported['db-config.json'] = 1
                    } catch (e) {
                        console.warn('Backup import: db-config.json konnte nicht wiederhergestellt werden:', e.message)
                    }
                }
            }

            console.log('Backup import erfolgreich:', imported)
            res.json({ ok: true, imported })
        } catch (e) {
            console.error('Backup import error:', e)
            res.status(500).json({ ok: false, error: e.message || 'Import fehlgeschlagen' })
        }
    })
}

/**
 * Validiert die Struktur einer wiederhergestellten DB-Konfiguration, bevor sie
 * db-config.json überschreibt. Erwartet die Kern-Verbindungsfelder.
 */
function isValidDbConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return false
    const host = cfg.host
    const database = cfg.database
    const user = cfg.user
    const port = cfg.port
    return typeof host === 'string' && host.length > 0
        && typeof database === 'string' && database.length > 0
        && typeof user === 'string' && user.length > 0
        && (typeof port === 'number' || (typeof port === 'string' && port.length > 0))
}

/**
 * PostgreSQL-Sequenzen nach Import mit expliziten IDs reparieren.
 * Setzt jede Sequenz auf MAX(id) + 1.
 */
async function fixSequencesAfterImport(knex) {
    const tables = BACKUP_TABLES.filter(t => t !== 'settings') // settings hat feste id=1
    let fixed = 0

    for (const table of tables) {
        try {
            const hasTable = await knex.schema.hasTable(table)
            if (!hasTable) continue

            await knex.raw(
                `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`
            )
            fixed++
        } catch (e) {
            // Tabelle hat evtl. keine Sequenz
        }
    }

    if (fixed > 0) {
        console.log(` -> ${fixed} PostgreSQL-Sequenzen nach Import repariert`)
    }
}
