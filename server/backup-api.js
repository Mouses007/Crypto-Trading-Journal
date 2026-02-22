import fs from 'fs'
import { getKnex } from './database.js'
import { loadDbConfig, getConfigPath } from './db-config.js'

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
]

// Beim Import: abhängige Tabellen zuerst löschen
const DELETE_ORDER = [
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

            // db-config.json mitlesen (Datenbankverbindung)
            let dbConfigFile = null
            try {
                const configPath = getConfigPath()
                if (fs.existsSync(configPath)) {
                    dbConfigFile = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
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
        const { tables, dbConfig: backupDbConfig } = req.body
        if (!tables || typeof tables !== 'object') {
            return res.status(400).json({ ok: false, error: 'Ungültiges Backup-Format: "tables" Objekt fehlt' })
        }

        try {
            const knex = getKnex()
            const dbConfig = loadDbConfig()
            const isPg = dbConfig?.type === 'postgresql'
            const imported = {}

            // Alle Tabellen in einer Transaktion leeren und neu befüllen
            await knex.transaction(async (trx) => {

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

                        // Rows filtern: nur gültige Spalten behalten
                        const cleanRows = rows.map(row => {
                            const clean = {}
                            for (const col of validColumns) {
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
            })

            // 3. PostgreSQL: Sequenzen reparieren
            if (isPg) {
                await fixSequencesAfterImport(knex)
            }

            // 4. db-config.json wiederherstellen falls im Backup vorhanden
            if (backupDbConfig && typeof backupDbConfig === 'object') {
                try {
                    const configPath = getConfigPath()
                    fs.writeFileSync(configPath, JSON.stringify(backupDbConfig, null, 2), 'utf-8')
                    imported['db-config.json'] = 1
                } catch (e) {
                    console.warn('Backup import: db-config.json konnte nicht wiederhergestellt werden:', e.message)
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
