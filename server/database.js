/**
 * Database initialization with Knex.
 * Supports SQLite (default) and PostgreSQL (optional).
 */
import Knex from 'knex'
import { loadDbConfig } from './db-config.js'
import { seedDefaultTemplates } from './default-templates.js'
import { seedDefaultLernkarten } from './default-lernkarten.js'

let knex = null

/**
 * Initialize and return the Knex instance.
 * Call once at startup — subsequent calls return the cached instance.
 */
export async function initDb() {
    if (knex) return knex

    const config = loadDbConfig()
    console.log(` -> Database client: ${config.client}`)

    knex = Knex.default(config)

    // SQLite-specific pragmas
    if (config.client === 'better-sqlite3') {
        await knex.raw('PRAGMA journal_mode = WAL')
        await knex.raw('PRAGMA foreign_keys = ON')
    }

    await runMigrations(knex, config.client)

    // Fix PostgreSQL sequences after migration/import
    if (config.client === 'pg') {
        await fixPostgresSequences(knex)
    }

    const clientLabel = config.client === 'pg' ? 'PostgreSQL' : 'SQLite'
    console.log(` -> ${clientLabel} database initialized`)

    return knex
}

/**
 * Get the Knex instance (must call initDb first).
 */
export function getKnex() {
    if (!knex) throw new Error('Database not initialized — call initDb() first')
    return knex
}

/**
 * Close the database connection.
 */
export async function closeDb() {
    if (knex) {
        await knex.destroy()
        knex = null
    }
}

// ============================================================
// Schema Migrations
// ============================================================

/**
 * Fix PostgreSQL auto-increment sequences after data import.
 * When rows are inserted with explicit IDs (e.g., from SQLite migration),
 * the sequence doesn't advance, causing "duplicate key" errors on next insert.
 */
async function fixPostgresSequences(knex) {
    const tables = ['notes', 'trades', 'screenshots', 'satisfactions', 'tags', 'excursions', 'incoming_positions', 'diaries', 'playbooks', 'ai_reports', 'ai_report_messages', 'ai_trade_messages', 'live_recordings', 'market_snapshots', 'calendar_events', 'live_sessions', 'ai_usage', 'hype_candidates', 'hype_reports', 'hype_settings', 'hype_favoriten', 'hype_alarme', 'coinradar_laeufe', 'coinradar_zeilen', 'coinradar_settings', 'radar_ergebnisse']
    let fixed = 0

    for (const table of tables) {
        try {
            const hasTable = await knex.schema.hasTable(table)
            if (!hasTable) continue

            const result = await knex.raw(
                `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`
            )
            const newVal = result.rows?.[0]?.setval
            if (newVal && newVal > 1) fixed++
        } catch (e) {
            // Table might not have a sequence (e.g., settings with fixed id=1)
        }
    }

    if (fixed > 0) {
        console.log(` -> ${fixed} PostgreSQL-Sequenzen repariert`)
    }
}

/**
 * Schema-Stand dieses CODES. Bei jeder Strukturänderung um 1 erhöhen.
 *
 * Hintergrund: NAS-Container und Dev-Rechner laufen mit verschiedenen
 * Codeständen gegen DIESELBE Postgres. Startet ein älterer Codestand gegen ein
 * neueres Schema, fehlen ihm Spaltenkenntnisse — das fällt sonst erst als
 * stiller Folgefehler auf. Der Anker macht es beim Start sichtbar.
 *
 * Bewusst nur eine WARNUNG, kein Abbruch: ein harter Stopp würde den
 * NAS-Container lahmlegen, sobald der Dev-Rechner die Version gehoben hat.
 */
// v2: Tabelle `live_sessions` für das Live-Trading-Fenster. Rein additiv —
// ein älterer Codestand ignoriert die Tabelle und läuft weiter; er meldet nur,
// dass die Datenbank ihm voraus ist.
// v3: Tabelle `ai_usage` — der KI-Verbrauch an einer Stelle. Ebenfalls rein
// additiv: ein älterer Codestand schreibt sie nicht, liest sie nicht und läuft
// unverändert weiter; ihm fehlen nur die Zeilen seiner eigenen Läufe.
// v4: Tabellen des Hype-Radars. Wieder rein additiv.
// v5: `hype_favoriten` — angeheftete Funde. Rein additiv.
// v6: `hype_alarme` + Wachhund-Spalten an den Favoriten. Rein additiv.
// v7: Coin-Radar — Läufe, Zeilen, Einstellungen; `quelle` an den Favoriten.
// v8: Ausführungsgüte am Coin-Radar (Slippage, Tiefe, beste Börse). Additiv;
//     ein älterer Codestand ignoriert die Spalten und läuft weiter.
// v9: `radar_ergebnisse` — Erfolgskontrolle beider Radare. Rein additiv.
// v10: BTC-Vergleich und Börsenlistung am Coin-Radar. Rein additiv — ein
// älterer Codestand schreibt die Spalten nicht und zeigt sie nicht an.
// v11: Gebühren und Funding an `live_sessions` — der Sitzungsabschluss rechnet
// jetzt serverseitig aus Bitunix statt im Browser aus Journal-Importen. Rein
// additiv; ein älterer Codestand schreibt die Spalten nicht und zeigt sie
// nicht an, sein Abschlussweg rechnet aber weiter aus dem Journal.
// v12: `quiz_karten` + `quiz_fortschritt` — Leitner-Karteikasten für
// Fachbegriffe. Rein additiv; ein älterer Codestand kennt die Tabellen nicht
// und läuft unverändert weiter.
// v13: `niveau` an `quiz_karten` — Schwierigkeitsstufe der Lernkarten (1 =
// App-eigene Grundbegriffe, 2 = vertiefte Konzepte). Rein additiv, Default 1.
const SCHEMA_VERSION = 13

async function runMigrations(knex, client) {
    const isPg = client === 'pg'

    // Helper: add column if it doesn't exist
    async function addColumnIfNotExists(table, column, buildCol) {
        const hasCol = await knex.schema.hasColumn(table, column)
        if (!hasCol) {
            await knex.schema.alterTable(table, (t) => {
                buildCol(t)
            })
        }
    }

    /**
     * Bestehende Alarm-Schalter in die neue Kanalwahl übernehmen.
     *
     * Vor der Zusammenführung steuerten drei einzelne Spalten, ob überhaupt
     * gemeldet wird. Wer die abgeschaltet hatte, soll nach dem Umbau nicht
     * plötzlich wieder Meldungen bekommen — deshalb wird der alte Stand einmal
     * in die JSON-Spalte gespiegelt. Läuft nur, solange dort nichts steht;
     * eine spätere Änderung des Nutzers wird nie überschrieben.
     */
    async function uebernehmeAlteAlarmSchalter() {
        try {
            const s = await knex('settings').where('id', 1).first()
            if (!s) return
            const roh = String(s.benachrichtigungen || '').trim()
            if (roh && roh !== '{}') return

            /*
             * NUR die ereignis-eigenen Schalter übernehmen.
             *
             * Der Hauptschalter `browserNotifications` bleibt bewusst aussen
             * vor: er wird in `src/utils/notify.js` weiterhin zuerst geprüft.
             * Ihn zusätzlich in jedes Ereignis zu schreiben wäre nicht nur
             * doppelt gemoppelt — es wäre eine Falle: wer den Hauptschalter
             * später wieder einschaltet, bekäme trotzdem nichts, weil jedes
             * Ereignis einzeln auf „aus" stünde, ohne erkennbaren Grund.
             */
            const wahl = {}
            if (Number(s.radarPicycleAlarm ?? 1) !== 1) {
                wahl.picycleKreuzung = { browser: false, email: false }
                wahl.picycleVorwarnung = { browser: false, email: false }
            }
            if (Number(s.radarFundingDivergenz ?? 15) === 0) {
                wahl.fundingDivergenz = { browser: false, email: false }
            }
            if (!Object.keys(wahl).length) return
            await knex('settings').where('id', 1).update({ benachrichtigungen: JSON.stringify(wahl) })
            console.log(' -> Alarm-Schalter in die Benachrichtigungs-Kanalwahl übernommen')
        } catch (e) {
            console.warn(`[DB] Übernahme der Alarm-Schalter fehlgeschlagen: ${e.message}`)
        }
    }

    /**
     * Index nachrüsten. Indizes in createTable() greifen nur bei NEUEN
     * Datenbanken — bestehende Installationen brauchen diesen Weg.
     * `CREATE INDEX IF NOT EXISTS` können SQLite und PostgreSQL beide.
     */
    async function addIndexIfNotExists(table, column, name) {
        if (!(await knex.schema.hasTable(table))) return
        try {
            await knex.raw(`CREATE INDEX IF NOT EXISTS ${name} ON ${isPg ? `"${table}"` : `\`${table}\``} (${isPg ? `"${column}"` : `\`${column}\``})`)
        } catch (e) {
            console.warn(`[DB] Index ${name} konnte nicht angelegt werden: ${e.message}`)
        }
    }

    // ==================== SETTINGS ====================
    if (!(await knex.schema.hasTable('settings'))) {
        await knex.schema.createTable('settings', (t) => {
            t.integer('id').primary().defaultTo(1)
            t.text('timeZone').defaultTo('Europe/Brussels')
            t.text('accounts').defaultTo('[]')
            t.text('tags').defaultTo('[]')
            t.text('apis').defaultTo('[]')
            t.text('layoutStyle').defaultTo('[]')
            t.text('avatar').defaultTo('')
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
        })
        // Seed the single settings row
        const existing = await knex('settings').where('id', 1).first()
        if (!existing) {
            await knex('settings').insert({ id: 1 })
        }
    }

    // ==================== TRADES ====================
    if (!(await knex.schema.hasTable('trades'))) {
        await knex.schema.createTable('trades', (t) => {
            t.increments('id').primary()
            t.bigInteger('dateUnix').notNullable()
            t.text('date')
            t.text('executions').defaultTo('[]')
            t.text('trades').defaultTo('[]')
            t.text('blotter').defaultTo('{}')
            t.text('pAndL').defaultTo('{}')
            t.text('cashJournal').defaultTo('{}')
            t.integer('openPositions').defaultTo(0)
            t.text('video').defaultTo('')
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.index('dateUnix', 'idx_trades_dateUnix')
        })
    }

    // ==================== DIARIES ====================
    if (!(await knex.schema.hasTable('diaries'))) {
        await knex.schema.createTable('diaries', (t) => {
            t.increments('id').primary()
            t.bigInteger('dateUnix').notNullable()
            t.text('date')
            t.text('diary').defaultTo('')
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.index('dateUnix', 'idx_diaries_dateUnix')
        })
    }

    // ==================== SCREENSHOTS ====================
    if (!(await knex.schema.hasTable('screenshots'))) {
        await knex.schema.createTable('screenshots', (t) => {
            t.increments('id').primary()
            t.text('name').defaultTo('')
            t.text('symbol').defaultTo('')
            t.text('side').defaultTo('')
            t.text('originalBase64').defaultTo('')
            t.text('annotatedBase64').defaultTo('')
            t.text('original').defaultTo('')
            t.text('annotated').defaultTo('')
            t.integer('markersOnly').defaultTo(1)
            t.text('maState').defaultTo('{}')
            t.text('date')
            t.bigInteger('dateUnix')
            t.bigInteger('dateUnixDay')
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.index('dateUnix', 'idx_screenshots_dateUnix')
            t.index('dateUnixDay', 'idx_screenshots_dateUnixDay')
        })
    }

    // ==================== PLAYBOOKS ====================
    if (!(await knex.schema.hasTable('playbooks'))) {
        await knex.schema.createTable('playbooks', (t) => {
            t.increments('id').primary()
            t.bigInteger('dateUnix')
            t.text('date')
            t.text('playbook').defaultTo('')
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.index('dateUnix', 'idx_playbooks_dateUnix')
        })
    }

    // ==================== SATISFACTIONS ====================
    if (!(await knex.schema.hasTable('satisfactions'))) {
        await knex.schema.createTable('satisfactions', (t) => {
            t.increments('id').primary()
            t.bigInteger('dateUnix').notNullable()
            t.text('tradeId').defaultTo('')
            t.integer('satisfaction').defaultTo(0)
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.index('dateUnix', 'idx_satisfactions_dateUnix')
            t.index('tradeId', 'idx_satisfactions_tradeId')
        })
    }

    // ==================== TAGS ====================
    if (!(await knex.schema.hasTable('tags'))) {
        await knex.schema.createTable('tags', (t) => {
            t.increments('id').primary()
            t.bigInteger('dateUnix')
            t.text('tradeId').defaultTo('')
            t.text('tags').defaultTo('[]')
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.index('dateUnix', 'idx_tags_dateUnix')
            t.index('tradeId', 'idx_tags_tradeId')
        })
    }

    // ==================== NOTES ====================
    if (!(await knex.schema.hasTable('notes'))) {
        await knex.schema.createTable('notes', (t) => {
            t.increments('id').primary()
            t.bigInteger('dateUnix')
            t.text('tradeId').defaultTo('')
            t.text('note').defaultTo('')
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.index('tradeId', 'idx_notes_tradeId')
            t.index('dateUnix', 'idx_notes_dateUnix')
        })
    }

    // ==================== EXCURSIONS ====================
    if (!(await knex.schema.hasTable('excursions'))) {
        await knex.schema.createTable('excursions', (t) => {
            t.increments('id').primary()
            t.bigInteger('dateUnix')
            t.text('tradeId').defaultTo('')
            t.float('stopLoss').defaultTo(0)
            t.float('maePrice').defaultTo(0)
            t.float('mfePrice').defaultTo(0)
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.index('tradeId', 'idx_excursions_tradeId')
            t.index('dateUnix', 'idx_excursions_dateUnix')
        })
    }

    // ==================== BITUNIX CONFIG ====================
    if (!(await knex.schema.hasTable('bitunix_config'))) {
        await knex.schema.createTable('bitunix_config', (t) => {
            t.integer('id').primary().defaultTo(1)
            t.text('apiKey').defaultTo('')
            t.text('secretKey').defaultTo('')
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
        })
        const existing = await knex('bitunix_config').where('id', 1).first()
        if (!existing) {
            await knex('bitunix_config').insert({ id: 1 })
        }
    }

    // ==================== BITGET CONFIG ====================
    if (!(await knex.schema.hasTable('bitget_config'))) {
        await knex.schema.createTable('bitget_config', (t) => {
            t.integer('id').primary().defaultTo(1)
            t.text('apiKey').defaultTo('')
            t.text('secretKey').defaultTo('')
            t.text('passphrase').defaultTo('')
            t.text('apiImportStartDate').defaultTo('')
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
        })
        const existing = await knex('bitget_config').where('id', 1).first()
        if (!existing) {
            await knex('bitget_config').insert({ id: 1 })
        }
    }

    // ==================== PIONEX CONFIG ====================
    if (!(await knex.schema.hasTable('pionex_config'))) {
        await knex.schema.createTable('pionex_config', (t) => {
            t.integer('id').primary().defaultTo(1)
            t.text('apiKey').defaultTo('')
            t.text('secretKey').defaultTo('')
            t.text('apiImportStartDate').defaultTo('')
            t.bigInteger('lastApiImport').defaultTo(0)
            t.bigInteger('lastHistoryScan').defaultTo(0)
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
        })
        const existing = await knex('pionex_config').where('id', 1).first()
        if (!existing) {
            await knex('pionex_config').insert({ id: 1 })
        }
    }

    // ==================== INCOMING POSITIONS ====================
    if (!(await knex.schema.hasTable('incoming_positions'))) {
        await knex.schema.createTable('incoming_positions', (t) => {
            t.increments('id').primary()
            t.text('positionId').notNullable().unique()
            t.text('symbol').defaultTo('')
            t.text('side').defaultTo('')
            t.float('entryPrice').defaultTo(0)
            t.float('leverage').defaultTo(0)
            t.float('quantity').defaultTo(0)
            t.float('unrealizedPNL').defaultTo(0)
            t.float('markPrice').defaultTo(0)
            t.text('playbook').defaultTo('')
            t.integer('stressLevel').defaultTo(0)
            t.text('feelings').defaultTo('')
            t.text('screenshotId').defaultTo('')
            t.text('status').defaultTo('open')
            t.text('bitunixData').defaultTo('{}')
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.index('positionId', 'idx_incoming_positionId')
            t.index('status', 'idx_incoming_status')
        })
    }

    // ==================== AI REPORTS ====================
    if (!(await knex.schema.hasTable('ai_reports'))) {
        await knex.schema.createTable('ai_reports', (t) => {
            t.increments('id').primary()
            t.text('label').defaultTo('')
            t.bigInteger('startDate').notNullable()
            t.bigInteger('endDate').notNullable()
            t.text('provider').defaultTo('')
            t.text('model').defaultTo('')
            t.text('report').defaultTo('')
            t.text('reportData').defaultTo('{}')
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.index('createdAt', 'idx_ai_reports_created')
        })
    }

    // ==================== AI REPORT MESSAGES (Chat) ====================
    if (!(await knex.schema.hasTable('ai_report_messages'))) {
        await knex.schema.createTable('ai_report_messages', (t) => {
            t.increments('id').primary()
            t.integer('reportId').notNullable()
            t.text('role').notNullable() // 'user' or 'assistant'
            t.text('content').defaultTo('')
            t.integer('promptTokens').defaultTo(0)
            t.integer('completionTokens').defaultTo(0)
            t.integer('totalTokens').defaultTo(0)
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.index('reportId', 'idx_report_messages_reportId')
        })
    }

    // ==================== AI TRADE REVIEW MESSAGES (Chat) ====================
    if (!(await knex.schema.hasTable('ai_trade_messages'))) {
        await knex.schema.createTable('ai_trade_messages', (t) => {
            t.increments('id').primary()
            t.text('tradeId').notNullable()
            t.text('role').notNullable() // 'user' or 'assistant'
            t.text('content').defaultTo('')
            t.text('provider').defaultTo('')
            t.text('model').defaultTo('')
            t.integer('promptTokens').defaultTo(0)
            t.integer('completionTokens').defaultTo(0)
            t.integer('totalTokens').defaultTo(0)
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.index('tradeId', 'idx_trade_messages_tradeId')
        })
    }

    // ==================== AI AGENT SESSIONS ====================
    if (!(await knex.schema.hasTable('ai_agent_sessions'))) {
        await knex.schema.createTable('ai_agent_sessions', (t) => {
            t.increments('id').primary()
            t.text('title').defaultTo('')
            t.text('provider').defaultTo('')
            t.text('model').defaultTo('')
            t.integer('totalTokens').defaultTo(0)
            t.integer('totalToolCalls').defaultTo(0)
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
        })
        console.log(' -> Created table: ai_agent_sessions')
    }

    // ==================== AI AGENT MESSAGES ====================
    if (!(await knex.schema.hasTable('ai_agent_messages'))) {
        await knex.schema.createTable('ai_agent_messages', (t) => {
            t.increments('id').primary()
            t.integer('sessionId').notNullable()
            t.text('role').notNullable()        // 'user' | 'assistant' | 'tool'
            t.text('content').defaultTo('')
            t.text('toolName').defaultTo('')     // Only for role='tool'
            t.text('toolCallId').defaultTo('')
            t.text('toolParams').defaultTo('')   // JSON
            t.text('toolResult').defaultTo('')   // JSON
            t.integer('promptTokens').defaultTo(0)
            t.integer('completionTokens').defaultTo(0)
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.index('sessionId', 'idx_agent_messages_sessionId')
        })
        console.log(' -> Created table: ai_agent_messages')
    }

    // ==================== COLUMN MIGRATIONS ====================
    // bitunix_config additions
    await addColumnIfNotExists('bitunix_config', 'lastApiImport', (t) => t.bigInteger('lastApiImport').defaultTo(0))
    await addColumnIfNotExists('bitunix_config', 'apiImportStartDate', (t) => t.text('apiImportStartDate').defaultTo(''))
    await addColumnIfNotExists('bitunix_config', 'lastHistoryScan', (t) => t.bigInteger('lastHistoryScan').defaultTo(0))

    // incoming_positions additions
    await addColumnIfNotExists('incoming_positions', 'tags', (t) => t.text('tags').defaultTo('[]'))
    await addColumnIfNotExists('incoming_positions', 'entryNote', (t) => t.text('entryNote').defaultTo(''))
    await addColumnIfNotExists('incoming_positions', 'historyData', (t) => t.text('historyData').defaultTo('{}'))
    await addColumnIfNotExists('incoming_positions', 'openingEvalDone', (t) => t.integer('openingEvalDone').defaultTo(0))
    await addColumnIfNotExists('incoming_positions', 'entryTimeframe', (t) => t.text('entryTimeframe').defaultTo(''))
    await addColumnIfNotExists('incoming_positions', 'emotionLevel', (t) => t.integer('emotionLevel').defaultTo(0))
    await addColumnIfNotExists('incoming_positions', 'closingNote', (t) => t.text('closingNote').defaultTo(''))
    await addColumnIfNotExists('incoming_positions', 'satisfaction', (t) => t.integer('satisfaction').defaultTo(-1))
    await addColumnIfNotExists('incoming_positions', 'skipEvaluation', (t) => t.integer('skipEvaluation').defaultTo(0))

    // Closing evaluation fields (einheitliche Maske)
    await addColumnIfNotExists('incoming_positions', 'closingStressLevel', (t) => t.integer('closingStressLevel').defaultTo(0))
    await addColumnIfNotExists('incoming_positions', 'closingEmotionLevel', (t) => t.integer('closingEmotionLevel').defaultTo(0))
    await addColumnIfNotExists('incoming_positions', 'closingFeelings', (t) => t.text('closingFeelings').defaultTo(''))
    await addColumnIfNotExists('incoming_positions', 'closingTimeframe', (t) => t.text('closingTimeframe').defaultTo(''))
    await addColumnIfNotExists('incoming_positions', 'closingTags', (t) => t.text('closingTags').defaultTo('[]'))
    await addColumnIfNotExists('incoming_positions', 'closingScreenshotId', (t) => t.text('closingScreenshotId').defaultTo(''))
    await addColumnIfNotExists('incoming_positions', 'closingPlaybook', (t) => t.text('closingPlaybook').defaultTo(''))

    // Entry screenshot (migrate from screenshotId)
    await addColumnIfNotExists('incoming_positions', 'entryScreenshotId', (t) => t.text('entryScreenshotId').defaultTo(''))
    // Trend screenshot (übergeordneter TF)
    await addColumnIfNotExists('incoming_positions', 'trendScreenshotId', (t) => t.text('trendScreenshotId').defaultTo(''))

    // Trade type (scalp, day, swing) — opening + closing separate
    await addColumnIfNotExists('incoming_positions', 'tradeType', (t) => t.text('tradeType').defaultTo(''))
    await addColumnIfNotExists('incoming_positions', 'closingTradeType', (t) => t.text('closingTradeType').defaultTo(''))

    // SL/TP History (persistent — replaces localStorage-only storage)
    await addColumnIfNotExists('incoming_positions', 'tpslHistory', (t) => t.text('tpslHistory').defaultTo('[]'))

    // Strategy followed (closing eval)
    await addColumnIfNotExists('incoming_positions', 'strategyFollowed', (t) => t.integer('strategyFollowed').defaultTo(-1))

    // tags: closingTags for separate opening/closing tag storage
    await addColumnIfNotExists('tags', 'closingTags', (t) => t.text('closingTags').defaultTo('[]'))

    // settings additions
    await addColumnIfNotExists('settings', 'showTradePopups', (t) => t.integer('showTradePopups').defaultTo(1))
    await addColumnIfNotExists('settings', 'username', (t) => t.text('username').defaultTo(''))
    await addColumnIfNotExists('settings', 'startBalance', (t) => t.float('startBalance').defaultTo(0))
    await addColumnIfNotExists('settings', 'startBalanceDate', (t) => t.bigInteger('startBalanceDate').defaultTo(0))
    await addColumnIfNotExists('settings', 'currentBalance', (t) => t.float('currentBalance').defaultTo(0))
    await addColumnIfNotExists('settings', 'tradeTimeframes', (t) => t.text('tradeTimeframes').defaultTo('[]'))
    await addColumnIfNotExists('settings', 'customTimeframes', (t) => t.text('customTimeframes').defaultTo('[]'))
    await addColumnIfNotExists('settings', 'enableBinanceChart', (t) => t.integer('enableBinanceChart').defaultTo(0))

    // AI settings
    await addColumnIfNotExists('settings', 'aiProvider', (t) => t.text('aiProvider').defaultTo('ollama'))
    await addColumnIfNotExists('settings', 'aiModel', (t) => t.text('aiModel').defaultTo(''))
    await addColumnIfNotExists('settings', 'aiApiKey', (t) => t.text('aiApiKey').defaultTo(''))
    await addColumnIfNotExists('settings', 'aiTemperature', (t) => t.float('aiTemperature').defaultTo(0.7))
    await addColumnIfNotExists('settings', 'aiMaxTokens', (t) => t.integer('aiMaxTokens').defaultTo(1500))
    await addColumnIfNotExists('settings', 'aiOllamaUrl', (t) => t.text('aiOllamaUrl').defaultTo('http://localhost:11434'))
    await addColumnIfNotExists('settings', 'aiScreenshots', (t) => t.integer('aiScreenshots').defaultTo(0))
    await addColumnIfNotExists('settings', 'aiKeyOpenai', (t) => t.text('aiKeyOpenai').defaultTo(''))
    await addColumnIfNotExists('settings', 'aiKeyAnthropic', (t) => t.text('aiKeyAnthropic').defaultTo(''))
    await addColumnIfNotExists('settings', 'aiKeyGemini', (t) => t.text('aiKeyGemini').defaultTo(''))
    // `aiKeyDeepseek` bleibt bestehen, obwohl DeepSeek nicht mehr auswählbar ist:
    // die Spalte wird weiter aus dem Backup-Export redigiert, und alte Berichte
    // tragen `provider='deepseek'`.
    await addColumnIfNotExists('settings', 'aiKeyDeepseek', (t) => t.text('aiKeyDeepseek').defaultTo(''))
    // Weitere OpenAI-kompatible Anbieter
    await addColumnIfNotExists('settings', 'aiKeyMistral', (t) => t.text('aiKeyMistral').defaultTo(''))
    await addColumnIfNotExists('settings', 'aiKeyXai', (t) => t.text('aiKeyXai').defaultTo(''))
    await addColumnIfNotExists('settings', 'aiKeyQwen', (t) => t.text('aiKeyQwen').defaultTo(''))
    // Qwen/DashScope: der Endpunkt hängt bei internationalen Konten am Arbeitsbereich,
    // deshalb überschreibbar statt fest im Code.
    await addColumnIfNotExists('settings', 'aiQwenUrl', (t) => t.text('aiQwenUrl').defaultTo('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'))

    // notes additions
    await addColumnIfNotExists('notes', 'title', (t) => t.text('title').defaultTo(''))
    await addColumnIfNotExists('notes', 'entryStressLevel', (t) => t.integer('entryStressLevel').defaultTo(0))
    await addColumnIfNotExists('notes', 'exitStressLevel', (t) => t.integer('exitStressLevel').defaultTo(0))
    await addColumnIfNotExists('notes', 'entryNote', (t) => t.text('entryNote').defaultTo(''))
    await addColumnIfNotExists('notes', 'feelings', (t) => t.text('feelings').defaultTo(''))
    await addColumnIfNotExists('notes', 'playbook', (t) => t.text('playbook').defaultTo(''))
    await addColumnIfNotExists('notes', 'timeframe', (t) => t.text('timeframe').defaultTo(''))
    await addColumnIfNotExists('notes', 'screenshotId', (t) => t.text('screenshotId').defaultTo(''))
    await addColumnIfNotExists('notes', 'trendScreenshotId', (t) => t.text('trendScreenshotId').defaultTo(''))
    await addColumnIfNotExists('notes', 'emotionLevel', (t) => t.integer('emotionLevel').defaultTo(0))
    await addColumnIfNotExists('notes', 'closingNote', (t) => t.text('closingNote').defaultTo(''))

    // Closing evaluation fields for notes
    await addColumnIfNotExists('notes', 'closingScreenshotId', (t) => t.text('closingScreenshotId').defaultTo(''))
    await addColumnIfNotExists('notes', 'closingStressLevel', (t) => t.integer('closingStressLevel').defaultTo(0))
    await addColumnIfNotExists('notes', 'closingEmotionLevel', (t) => t.integer('closingEmotionLevel').defaultTo(0))
    await addColumnIfNotExists('notes', 'closingFeelings', (t) => t.text('closingFeelings').defaultTo(''))
    await addColumnIfNotExists('notes', 'closingTimeframe', (t) => t.text('closingTimeframe').defaultTo(''))
    await addColumnIfNotExists('notes', 'closingPlaybook', (t) => t.text('closingPlaybook').defaultTo(''))

    // Beide Tabellen werden nach Tag abgefragt (Notizen/Excursions zu den
    // geladenen Trades), hatten aber nur einen Index auf tradeId.
    await addIndexIfNotExists('notes', 'dateUnix', 'idx_notes_dateUnix')
    await addIndexIfNotExists('excursions', 'dateUnix', 'idx_excursions_dateUnix')

    // Trade type (scalp, day, swing) — opening + closing separate
    await addColumnIfNotExists('notes', 'tradeType', (t) => t.text('tradeType').defaultTo(''))
    await addColumnIfNotExists('notes', 'closingTradeType', (t) => t.text('closingTradeType').defaultTo(''))

    // Strategy followed
    await addColumnIfNotExists('notes', 'strategyFollowed', (t) => t.integer('strategyFollowed').defaultTo(-1))

    // Trading metadata (SL/TP, BE, fills, position size — JSON)
    await addColumnIfNotExists('notes', 'tradingMetadata', (t) => t.text('tradingMetadata').defaultTo(''))

    // AI trade review columns for notes
    await addColumnIfNotExists('notes', 'aiReview', (t) => t.text('aiReview').defaultTo(''))
    await addColumnIfNotExists('notes', 'aiReviewProvider', (t) => t.text('aiReviewProvider').defaultTo(''))
    await addColumnIfNotExists('notes', 'aiReviewModel', (t) => t.text('aiReviewModel').defaultTo(''))
    await addColumnIfNotExists('notes', 'aiReviewPromptTokens', (t) => t.integer('aiReviewPromptTokens').defaultTo(0))
    await addColumnIfNotExists('notes', 'aiReviewCompletionTokens', (t) => t.integer('aiReviewCompletionTokens').defaultTo(0))
    await addColumnIfNotExists('notes', 'aiReviewTotalTokens', (t) => t.integer('aiReviewTotalTokens').defaultTo(0))

    // Einmalige Backfill: Token-Schätzung für alte Trade-Reviews (vor Token-Tracking)
    // ~1 Token ≈ 4 Zeichen, Prompt ≈ 2× Output-Länge
    try {
        const untracked = await knex('notes')
            .whereNot('aiReview', '').andWhere('aiReviewTotalTokens', 0)
        if (untracked.length > 0) {
            for (const n of untracked) {
                const outputTokens = Math.ceil((n.aiReview || '').length / 4)
                const promptTokens = Math.ceil(outputTokens * 2)
                const totalTokens = promptTokens + outputTokens
                await knex('notes').where('id', n.id).update({
                    aiReviewPromptTokens: promptTokens,
                    aiReviewCompletionTokens: outputTokens,
                    aiReviewTotalTokens: totalTokens
                })
            }
            console.log(` -> Backfilled token estimates for ${untracked.length} trade reviews`)
        }
    } catch (e) { /* ignore if columns don't exist yet */ }

    // AI report prompt + chat
    await addColumnIfNotExists('settings', 'aiReportPrompt', (t) => t.text('aiReportPrompt').defaultTo(''))
    await addColumnIfNotExists('settings', 'aiChatEnabled', (t) => t.integer('aiChatEnabled').defaultTo(1))
    await addColumnIfNotExists('settings', 'aiEnabled', (t) => t.integer('aiEnabled').defaultTo(1))
    await addColumnIfNotExists('settings', 'browserNotifications', (t) => t.integer('browserNotifications').defaultTo(1))

    // First-Run Setup
    const hadSetupCol = await knex.schema.hasColumn('settings', 'setupComplete')
    await addColumnIfNotExists('settings', 'setupComplete', (t) => t.integer('setupComplete').defaultTo(0))
    // Auto-detect existing installations: if setupComplete column is new AND trades exist, mark as complete
    if (!hadSetupCol) {
        try {
            const tradeCount = await knex('trades').count('* as cnt').first()
            if (tradeCount && tradeCount.cnt > 0) {
                await knex('settings').where('id', 1).update({ setupComplete: 1 })
                console.log(' -> Existing installation detected, setup marked as complete')
            }
        } catch (e) { /* ignore */ }
    }

    // ai_reports additions
    await addColumnIfNotExists('ai_reports', 'promptTokens', (t) => t.integer('promptTokens').defaultTo(0))
    await addColumnIfNotExists('ai_reports', 'completionTokens', (t) => t.integer('completionTokens').defaultTo(0))
    await addColumnIfNotExists('ai_reports', 'totalTokens', (t) => t.integer('totalTokens').defaultTo(0))
    await addColumnIfNotExists('ai_reports', 'promptPreset', (t) => t.text('promptPreset').defaultTo(''))
    await addColumnIfNotExists('ai_reports', 'broker', (t) => t.text('broker').defaultTo(''))

    // ai_report_messages additions (provider/model für Token-Statistiken)
    await addColumnIfNotExists('ai_report_messages', 'provider', (t) => t.text('provider').defaultTo(''))
    await addColumnIfNotExists('ai_report_messages', 'model', (t) => t.text('model').defaultTo(''))
    // Bestehende Berichte ohne Broker auf 'bitunix' setzen (einmalige Migration)
    await knex('ai_reports').where('broker', '').update({ broker: 'bitunix' })

    // ==================== SCREENSHOT BROKER ====================
    await addColumnIfNotExists('screenshots', 'broker', (t) => t.text('broker').defaultTo(''))

    // ==================== SCREENSHOT AI REVIEW ====================
    await addColumnIfNotExists('screenshots', 'aiReview', (t) => t.text('aiReview').defaultTo(''))
    await addColumnIfNotExists('screenshots', 'aiReviewProvider', (t) => t.text('aiReviewProvider').defaultTo(''))
    await addColumnIfNotExists('screenshots', 'aiReviewModel', (t) => t.text('aiReviewModel').defaultTo(''))
    await addColumnIfNotExists('screenshots', 'aiReviewPromptTokens', (t) => t.integer('aiReviewPromptTokens').defaultTo(0))
    await addColumnIfNotExists('screenshots', 'aiReviewCompletionTokens', (t) => t.integer('aiReviewCompletionTokens').defaultTo(0))
    await addColumnIfNotExists('screenshots', 'aiReviewTotalTokens', (t) => t.integer('aiReviewTotalTokens').defaultTo(0))

    // ==================== BITGET CONFIG COLUMNS ====================
    await addColumnIfNotExists('bitget_config', 'lastApiImport', (t) => t.bigInteger('lastApiImport').defaultTo(0))
    await addColumnIfNotExists('bitget_config', 'lastHistoryScan', (t) => t.bigInteger('lastHistoryScan').defaultTo(0))

    // ==================== INCOMING POSITIONS: BROKER COLUMN ====================
    await addColumnIfNotExists('incoming_positions', 'broker', (t) => t.text('broker').defaultTo('bitunix'))

    // ==================== TRADES: BROKER COLUMN ====================
    await addColumnIfNotExists('trades', 'broker', (t) => t.text('broker').defaultTo('bitunix'))

    // ==================== SETTINGS: BALANCES (per broker) ====================
    await addColumnIfNotExists('settings', 'balances', (t) => t.text('balances').defaultTo('{}'))

    // ==================== SETTINGS: LANGUAGE ====================
    await addColumnIfNotExists('settings', 'language', (t) => t.text('language').defaultTo('de'))

    // ==================== SETTINGS: TRADE TYPE AUTO-DETECTION ====================
    await addColumnIfNotExists('settings', 'scalpMaxMinutes', (t) => t.integer('scalpMaxMinutes').defaultTo(15))
    await addColumnIfNotExists('settings', 'daytradeMaxHours', (t) => t.integer('daytradeMaxHours').defaultTo(24))

    // ==================== SETTINGS: FLUX.2 SHARE CARDS ====================
    await addColumnIfNotExists('settings', 'fluxApiKey', (t) => t.text('fluxApiKey').defaultTo(''))
    await addColumnIfNotExists('settings', 'fluxModel', (t) => t.text('fluxModel').defaultTo('flux-2-klein-9b'))
    await addColumnIfNotExists('settings', 'fluxDisplayName', (t) => t.text('fluxDisplayName').defaultTo(''))
    await addColumnIfNotExists('settings', 'fluxAvatar', (t) => t.text('fluxAvatar').defaultTo(''))
    await addColumnIfNotExists('settings', 'fluxUseCustomAvatar', (t) => t.boolean('fluxUseCustomAvatar').defaultTo(false))

    // ==================== SETTINGS: GEMINI IMAGE GENERATION ====================
    await addColumnIfNotExists('settings', 'shareCardProvider', (t) => t.text('shareCardProvider').defaultTo('flux'))
    await addColumnIfNotExists('settings', 'geminiImageApiKey', (t) => t.text('geminiImageApiKey').defaultTo(''))
    await addColumnIfNotExists('settings', 'geminiImageModel', (t) => t.text('geminiImageModel').defaultTo('gemini-2.5-flash-image'))

    // ==================== SETTINGS: ESP32 DISPLAY ====================
    await addColumnIfNotExists('settings', 'esp32ApiKey', (t) => t.text('esp32ApiKey').defaultTo(''))
    await addColumnIfNotExists('settings', 'esp32Filter', (t) => t.text('esp32Filter').defaultTo('month'))

    // ==================== SETTINGS: LIVE-ANALYSE (Heatmap / Bookmap) ====================
    await addColumnIfNotExists('settings', 'liveSymbol', (t) => t.text('liveSymbol').defaultTo(''))
    await addColumnIfNotExists('settings', 'liveMarket', (t) => t.text('liveMarket').defaultTo('futures'))
    await addColumnIfNotExists('settings', 'liveViewPct', (t) => t.float('liveViewPct').defaultTo(0.5))
    await addColumnIfNotExists('settings', 'liveFrameMs', (t) => t.integer('liveFrameMs').defaultTo(500))
    await addColumnIfNotExists('settings', 'liveHistoryMin', (t) => t.integer('liveHistoryMin').defaultTo(30))
    await addColumnIfNotExists('settings', 'liveRamp', (t) => t.text('liveRamp').defaultTo('bookmap'))
    await addColumnIfNotExists('settings', 'liveShowProfile', (t) => t.integer('liveShowProfile').defaultTo(0))
    await addColumnIfNotExists('settings', 'livePauseInBackground', (t) => t.integer('livePauseInBackground').defaultTo(1))
    // Farbskala: 'auto' normiert rollend aufs 95. Perzentil, 'fixed' nutzt liveColorRef
    await addColumnIfNotExists('settings', 'liveColorMode', (t) => t.text('liveColorMode').defaultTo('auto'))
    await addColumnIfNotExists('settings', 'liveColorRef', (t) => t.float('liveColorRef').defaultTo(0))
    // Preisachse: 1 = folgt dem Mittelkurs, 0 = bleibt stehen (manuell zoom/pan)
    await addColumnIfNotExists('settings', 'liveAutoFollow', (t) => t.integer('liveAutoFollow').defaultTo(1))
    // Blendet Zellen unterhalb dieses Anteils der Farbskala aus (0 = alles zeigen)
    await addColumnIfNotExists('settings', 'liveThreshold', (t) => t.float('liveThreshold').defaultTo(0))
    await addColumnIfNotExists('settings', 'liveShowLiquidations', (t) => t.integer('liveShowLiquidations').defaultTo(1))
    // Vorlauf aus der eigenen Aufzeichnung beim Öffnen (Minuten, 0 = aus)
    await addColumnIfNotExists('settings', 'livePrefillMin', (t) => t.integer('livePrefillMin').defaultTo(15))

    // ==================== SETTINGS: LIVE-RECORDER ====================
    // Standardmässig AUS — ein Dauer-Stream darf nicht ungefragt laufen.
    await addColumnIfNotExists('settings', 'liveRecordEnabled', (t) => t.integer('liveRecordEnabled').defaultTo(0))
    await addColumnIfNotExists('settings', 'liveRecordSymbols', (t) => t.text('liveRecordSymbols').defaultTo(''))
    await addColumnIfNotExists('settings', 'liveRecordDays', (t) => t.integer('liveRecordDays').defaultTo(14))
    await addColumnIfNotExists('settings', 'liveRecordFrameMs', (t) => t.integer('liveRecordFrameMs').defaultTo(1000))
    await addColumnIfNotExists('settings', 'liveRecordRows', (t) => t.integer('liveRecordRows').defaultTo(200))
    await addColumnIfNotExists('settings', 'liveRecordRangePct', (t) => t.float('liveRecordRangePct').defaultTo(1))
    await addColumnIfNotExists('settings', 'liveRecordAllLiq', (t) => t.integer('liveRecordAllLiq').defaultTo(0))
    await addColumnIfNotExists('settings', 'liveDotStep', (t) => t.integer('liveDotStep').defaultTo(11))
    await addColumnIfNotExists('settings', 'liveProfileW', (t) => t.integer('liveProfileW').defaultTo(74))
    await addColumnIfNotExists('settings', 'liveShowVolumeBars', (t) => t.integer('liveShowVolumeBars').defaultTo(0))
    await addColumnIfNotExists('settings', 'levMapTier', (t) => t.string('levMapTier').defaultTo('all'))
    await addColumnIfNotExists('settings', 'levMapHours', (t) => t.integer('levMapHours').defaultTo(48))
    await addColumnIfNotExists('settings', 'levMapSpanPct', (t) => t.float('levMapSpanPct').defaultTo(8))
    await addColumnIfNotExists('settings', 'levMapMmr', (t) => t.float('levMapMmr').defaultTo(0.004))
    // Woher die Wartungsmarge kommt: 'binance' | 'bybit' | 'manuell'. Vorgabe
    // ist die Börse, auf der die Karte rechnet — die alte feste 0,004 stimmte
    // nur für BTC/ETH und lag bei allen anderen Coins deutlich zu tief.
    await addColumnIfNotExists('settings', 'levMapMmrQuelle', (t) => t.string('levMapMmrQuelle').defaultTo('binance'))
    await addColumnIfNotExists('settings', 'levMapWeights', (t) => t.string('levMapWeights').defaultTo('40,30,20,10'))
    await addColumnIfNotExists('settings', 'levMapView', (t) => t.string('levMapView').defaultTo('dist'))
    await addColumnIfNotExists('settings', 'levMapThreshold', (t) => t.float('levMapThreshold').defaultTo(0))
    await addColumnIfNotExists('settings', 'levMapProfileW', (t) => t.integer('levMapProfileW').defaultTo(74))

    // ==================== LIVE-AUFZEICHNUNGEN ====================
    // Eine Zeile pro Symbol und Stunde. Der Blob ist gzip-komprimiert und
    // enthält Kopfdaten + Basis-Buckets + die quantisierte Mengenmatrix.
    // Postgres/SQLite statt Dateien, weil der Container bei jedem Update neu
    // erstellt wird und Dateien ausserhalb eines Volumes verloren gingen.
    if (!(await knex.schema.hasTable('live_recordings'))) {
        await knex.schema.createTable('live_recordings', (t) => {
            t.increments('id').primary()
            t.string('symbol').notNullable()
            t.string('market').notNullable()
            t.string('kind').notNullable().defaultTo('heat')
            t.bigInteger('hourStart').notNullable()
            t.integer('frameMs').notNullable()
            t.integer('rows').notNullable()
            t.integer('cols').notNullable()
            t.float('bucketSize').notNullable()
            t.float('quantRef').notNullable()
            t.integer('bytes').notNullable().defaultTo(0)
            t.binary('payload')
            t.bigInteger('createdAt')
            t.unique(['symbol', 'market', 'kind', 'hourStart'])
            t.index(['symbol', 'hourStart'])
        })
        console.log(' -> Created table: live_recordings')
    }

    // ==================== SETTINGS: OPTIONALES PASSWORT-GATE ====================
    // Optionaler Login-Schutz (Standard aus) für Betrieb hinter öffentlicher Bindung.
    await addColumnIfNotExists('settings', 'authEnabled', (t) => t.integer('authEnabled').defaultTo(0))
    await addColumnIfNotExists('settings', 'authPasswordHash', (t) => t.text('authPasswordHash').defaultTo(''))

    // ==================== SHARE CARD TEMPLATES ====================
    if (!(await knex.schema.hasTable('share_card_templates'))) {
        await knex.schema.createTable('share_card_templates', (t) => {
            t.increments('id').primary()
            t.text('name').notNullable()           // "Cyberpunk Bull"
            t.text('prompt').defaultTo('')          // Der verwendete Prompt
            t.text('imageBase64').defaultTo('')     // Hintergrundbild OHNE Overlay (base64)
            t.text('category').defaultTo('')        // 'win' oder 'loss'
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
        })
        console.log(' -> Created table: share_card_templates')
    }

    // Seed default templates from server/templates/ (only if table is empty)
    await seedDefaultTemplates(knex)

    // ==================== SEED: Default Tag Groups ====================
    // Ensure the mandatory "Strategie" tag group exists (required by charts/dashboard).
    // On fresh install: create with example tags. On update: preserve existing tags.
    try {
        const settingsRow = await knex('settings').select('tags').where('id', 1).first()
        let existingTags = []
        if (settingsRow && settingsRow.tags) {
            try { existingTags = JSON.parse(settingsRow.tags) } catch (e) { existingTags = [] }
        }
        if (!Array.isArray(existingTags) || existingTags.length === 0) {
            // Fresh install: create Strategie group with example tags (green)
            const defaultTags = [
                {
                    id: 'group_0',
                    name: 'Strategie',
                    color: '#198754',
                    tags: [
                        { id: 'tag_strat_1', name: 'LSOB', color: '#198754' },
                        { id: 'tag_strat_2', name: 'Guss', color: '#198754' },
                        { id: 'tag_strat_3', name: 'Breakout', color: '#198754' }
                    ]
                }
            ]
            await knex('settings').where('id', 1).update({ tags: JSON.stringify(defaultTags) })
            console.log(' -> Default tag group "Strategie" created with example tags')
        } else {
            // Update: ensure Strategie group exists, but never overwrite existing tags
            const hasStrategie = existingTags.some(g => g.id === 'group_0')
            if (!hasStrategie) {
                existingTags.unshift({
                    id: 'group_0',
                    name: 'Strategie',
                    color: '#198754',
                    tags: []
                })
                await knex('settings').where('id', 1).update({ tags: JSON.stringify(existingTags) })
                console.log(' -> Mandatory "Strategie" tag group restored (no tags overwritten)')
            }
        }
    } catch (e) { /* ignore */ }

    // ==================== SEED: Default Timeframes ====================
    // On fresh install: activate all timeframes. On update: preserve existing selection.
    try {
        const tfRow = await knex('settings').select('tradeTimeframes').where('id', 1).first()
        let existingTf = []
        if (tfRow && tfRow.tradeTimeframes) {
            try { existingTf = JSON.parse(tfRow.tradeTimeframes) } catch (e) { existingTf = [] }
        }
        if (!Array.isArray(existingTf) || existingTf.length === 0) {
            const allTimeframes = [
                '1m','2m','3m','5m','6m','10m','15m','30m','45m',
                '1h','2h','3h','4h',
                '1D','1W','1M','3M','6M','12M'
            ]
            await knex('settings').where('id', 1).update({ tradeTimeframes: JSON.stringify(allTimeframes) })
            console.log(' -> Default timeframes activated (all)')
        }
    } catch (e) { /* ignore */ }

    // ==================== DATA MIGRATION ====================
    // Migrate old aiApiKey to provider-specific column
    try {
        const row = await knex('settings').select('aiApiKey', 'aiProvider').where('id', 1).first()
        if (row && row.aiApiKey) {
            const colMap = { openai: 'aiKeyOpenai', anthropic: 'aiKeyAnthropic', gemini: 'aiKeyGemini' }
            const col = colMap[row.aiProvider]
            if (col) {
                const current = await knex('settings').select(col).where('id', 1).first()
                if (!current[col]) {
                    await knex('settings').where('id', 1).update({ [col]: row.aiApiKey })
                    console.log(` -> Migrated API key to ${col}`)
                }
            }
        }
    } catch (e) { /* ignore */ }

    // ==================== FIX: Double Fee Counting (Bitunix) ====================
    // Bitunix CSV "Incoming/Outgoing Amount" is already NET (after fees), but was
    // stored as grossProceeds, then fees were subtracted again for netProceeds.
    // Fix: grossProceeds = old_grossProceeds + commission, netProceeds = old_grossProceeds
    await addColumnIfNotExists('settings', 'feeFixMigrated', (t) => t.integer('feeFixMigrated').defaultTo(0))
    await addColumnIfNotExists('settings', 'feeFixV297Migrated', (t) => t.integer('feeFixV297Migrated').defaultTo(0))
    try {
        const feeFixRow = await knex('settings').select('feeFixMigrated').where('id', 1).first()
        if (feeFixRow && !feeFixRow.feeFixMigrated) {
            const allTradeRows = await knex('trades').where('broker', 'bitunix').orWhere('broker', '').orWhereNull('broker')
            let fixedCount = 0
            for (const row of allTradeRows) {
                let tradesArr = []
                let pAndLObj = {}
                try { tradesArr = JSON.parse(row.trades || '[]') } catch (e) { continue }
                try { pAndLObj = JSON.parse(row.pAndL || '{}') } catch (e) { pAndLObj = {} }

                let changed = false
                for (const t of tradesArr) {
                    const fee = t.commission || 0
                    if (fee === 0) continue // no fee = nothing to fix

                    const oldGross = t.grossProceeds || 0
                    // oldGross was actually NET, reconstruct:
                    const realNet = oldGross                // what Bitunix showed as PnL
                    const realGross = oldGross + fee        // true gross = net + fee

                    const isGrossWin = realGross > 0
                    const isNetWin = realNet > 0

                    t.grossProceeds = realGross
                    t.netProceeds = realNet
                    t.grossSharePL = realGross
                    t.netSharePL = realNet
                    t.grossWins = isGrossWin ? realGross : 0
                    t.grossLoss = isGrossWin ? 0 : realGross
                    t.netWins = isNetWin ? realNet : 0
                    t.netLoss = isNetWin ? 0 : realNet
                    t.grossWinsCount = isGrossWin ? 1 : 0
                    t.grossLossCount = isGrossWin ? 0 : 1
                    t.netWinsCount = isNetWin ? 1 : 0
                    t.netLossCount = isNetWin ? 0 : 1
                    t.grossSharePLWins = isGrossWin ? realGross : 0
                    t.grossSharePLLoss = isGrossWin ? 0 : realGross
                    t.netSharePLWins = isNetWin ? realNet : 0
                    t.netSharePLLoss = isNetWin ? 0 : realNet
                    t.highGrossSharePLWin = isGrossWin ? realGross : 0
                    t.highGrossSharePLLoss = isGrossWin ? 0 : realGross
                    t.highNetSharePLWin = isNetWin ? realNet : 0
                    t.highNetSharePLLoss = isNetWin ? 0 : realNet
                    changed = true
                }

                if (changed) {
                    // Recalculate pAndL aggregates from fixed trades
                    let gp = 0, np = 0, gw = 0, gl = 0, nw = 0, nl = 0
                    let gwc = 0, glc = 0, nwc = 0, nlc = 0
                    for (const t of tradesArr) {
                        gp += t.grossProceeds || 0
                        np += t.netProceeds || 0
                        if ((t.grossProceeds || 0) > 0) { gw += t.grossProceeds; gwc++ }
                        else { gl += t.grossProceeds || 0; glc++ }
                        if ((t.netProceeds || 0) > 0) { nw += t.netProceeds; nwc++ }
                        else { nl += t.netProceeds || 0; nlc++ }
                    }
                    pAndLObj.grossProceeds = gp
                    pAndLObj.netProceeds = np
                    pAndLObj.grossWins = gw
                    pAndLObj.grossLoss = gl
                    pAndLObj.netWins = nw
                    pAndLObj.netLoss = nl
                    pAndLObj.grossWinsCount = gwc
                    pAndLObj.grossLossCount = glc
                    pAndLObj.netWinsCount = nwc
                    pAndLObj.netLossCount = nlc
                    if (pAndLObj.grossSharePL !== undefined) pAndLObj.grossSharePL = gp
                    if (pAndLObj.netSharePL !== undefined) pAndLObj.netSharePL = np

                    await knex('trades').where('id', row.id).update({
                        trades: JSON.stringify(tradesArr),
                        pAndL: JSON.stringify(pAndLObj),
                    })
                    fixedCount++
                }
            }
            await knex('settings').where('id', 1).update({ feeFixMigrated: 1 })
            if (fixedCount > 0) {
                console.log(` -> Fee-Fix: ${fixedCount} Tageszeilen korrigiert (doppelte Gebühren entfernt)`)
            }
        }
    } catch (e) {
        console.error(' -> Fee-Fix migration error:', e.message)
    }

    // ==================== FIX: Duplicate Trades (Race in incoming.js) ====================
    // createTradeFromClosedPosition wurde durch Race zwischen syncPositionsWithDb und
    // fetchRecentlyClosed teils zweimal pro positionId ausgeführt → Duplikat im trades[]
    // eines Tages. Idempotenz-Guard ist in v2.9.8 ergänzt; bestehende Duplikate werden
    // hier einmalig dedupliziert (nach trade.id). pAndL/blotter werden neu berechnet.
    await addColumnIfNotExists('settings', 'dupTradeFixV298Migrated', (t) => t.integer('dupTradeFixV298Migrated').defaultTo(0))
    try {
        const dupRow = await knex('settings').select('dupTradeFixV298Migrated').where('id', 1).first()
        if (dupRow && !dupRow.dupTradeFixV298Migrated) {
            const allRows = await knex('trades')
            let dedupedDays = 0
            let removedTrades = 0
            for (const row of allRows) {
                let tradesArr = []
                let execsArr = []
                let pAndLObj = {}
                let blotterArr = []
                try { tradesArr = JSON.parse(row.trades || '[]') } catch (e) { continue }
                try { execsArr = JSON.parse(row.executions || '[]') } catch (e) { execsArr = [] }
                try { pAndLObj = JSON.parse(row.pAndL || '{}') } catch (e) { pAndLObj = {} }
                try { blotterArr = JSON.parse(row.blotter || '[]') } catch (e) { blotterArr = [] }

                if (!Array.isArray(tradesArr) || tradesArr.length < 2) continue

                const seen = new Set()
                const dedupTrades = []
                for (const t of tradesArr) {
                    const key = t && t.id ? String(t.id) : JSON.stringify(t)
                    if (seen.has(key)) { removedTrades++; continue }
                    seen.add(key)
                    dedupTrades.push(t)
                }
                if (dedupTrades.length === tradesArr.length) continue

                const seenExec = new Set()
                const dedupExecs = []
                for (const e of (Array.isArray(execsArr) ? execsArr : [])) {
                    const key = e && e.id ? String(e.id) : JSON.stringify(e)
                    if (seenExec.has(key)) continue
                    seenExec.add(key)
                    dedupExecs.push(e)
                }

                // Rebuild blotter
                const blotterMap = {}
                for (const t of dedupTrades) {
                    if (!blotterMap[t.symbol]) {
                        blotterMap[t.symbol] = { symbol: t.symbol, grossProceeds: 0, netProceeds: 0, fees: 0, grossWinsCount: 0, grossLossCount: 0, trades: 0 }
                    }
                    const b = blotterMap[t.symbol]
                    b.grossProceeds += t.grossProceeds || 0
                    b.netProceeds += t.netProceeds || 0
                    b.fees += t.commission || 0
                    b.grossWinsCount += t.grossWinsCount || 0
                    b.grossLossCount += t.grossLossCount || 0
                    b.trades += 1
                }

                // Rebuild pAndL
                let gp = 0, np = 0, totalFees = 0, gwc = 0, glc = 0, nwc = 0, nlc = 0, tc = 0
                for (const t of dedupTrades) {
                    gp += t.grossProceeds || 0
                    np += t.netProceeds || 0
                    totalFees += t.commission || 0
                    gwc += t.grossWinsCount || 0
                    glc += t.grossLossCount || 0
                    nwc += t.netWinsCount || 0
                    nlc += t.netLossCount || 0
                    tc += 1
                }
                pAndLObj.grossProceeds = gp
                pAndLObj.netProceeds = np
                pAndLObj.fees = totalFees
                pAndLObj.grossWinsCount = gwc
                pAndLObj.grossLossCount = glc
                if (pAndLObj.netWinsCount !== undefined) pAndLObj.netWinsCount = nwc
                if (pAndLObj.netLossCount !== undefined) pAndLObj.netLossCount = nlc
                pAndLObj.trades = tc

                await knex('trades').where('id', row.id).update({
                    trades: JSON.stringify(dedupTrades),
                    executions: JSON.stringify(dedupExecs),
                    blotter: JSON.stringify(Object.values(blotterMap)),
                    pAndL: JSON.stringify(pAndLObj),
                })
                dedupedDays++
            }
            await knex('settings').where('id', 1).update({ dupTradeFixV298Migrated: 1 })
            if (removedTrades > 0) {
                console.log(` -> Duplicate-Trade-Fix: ${removedTrades} Duplikate aus ${dedupedDays} Tagen entfernt`)
            }
        }
    } catch (e) {
        console.error(' -> Duplicate-Trade-Fix migration error:', e.message)
    }

    // ==================== FIX: Bitunix Funding-Vorzeichen (v2.9.9) ====================
    // v2.9.7 nahm an, Bitunix `realizedPNL` sei brutto-vor-Funding und zog
    // Funding nochmal ab. Korrektur (verifiziert gegen Bitunix-UI
    // "Realisierter Gewinn/Verlust"): `realizedPNL` ist BEREITS der Wallet-Delta
    // inkl. Trading-Fee UND Funding.
    //   oldNet  = realizedPNL − fundingFee          (falsch)
    //   newNet  = realizedPNL = oldNet + fundingFee (korrekt)
    //   oldGross = realizedPNL + tradingFee
    //   newGross = realizedPNL + tradingFee − fundingFee = oldGross − fundingFee
    //   commission alt = tradingFee + fundingFee  → neu = tradingFee
    // Betrifft nur live-/API-importierte Bitunix-Trades (haben `tradingFee` und
    // `fundingFee` Felder); CSV-Pfad nicht betroffen (keine Funding-Daten).
    await addColumnIfNotExists('settings', 'fundingFixV299Migrated', (t) => t.integer('fundingFixV299Migrated').defaultTo(0))
    try {
        const fundRow = await knex('settings').select('fundingFixV299Migrated').where('id', 1).first()
        if (fundRow && !fundRow.fundingFixV299Migrated) {
            const rows = await knex('trades').where('broker', 'bitunix')
            let fixedDays = 0
            let fixedTrades = 0
            for (const row of rows) {
                let tradesArr = []
                let pAndLObj = {}
                let blotterArr = []
                try { tradesArr = JSON.parse(row.trades || '[]') } catch (e) { continue }
                try { pAndLObj = JSON.parse(row.pAndL || '{}') } catch (e) { pAndLObj = {} }
                try { blotterArr = JSON.parse(row.blotter || '[]') } catch (e) { blotterArr = [] }
                if (!Array.isArray(tradesArr) || tradesArr.length === 0) continue

                let dayChanged = false
                for (const t of tradesArr) {
                    const fund = Number(t.fundingFee)
                    const trFee = Number(t.tradingFee)
                    // Nur live/API-Trades (haben tradingFee+fundingFee).
                    // Falls fundingFee = 0, ist net schon korrekt → skippen.
                    if (!Number.isFinite(fund) || fund === 0) continue
                    if (!Number.isFinite(trFee)) continue

                    const oldNet = Number(t.netProceeds) || 0
                    const oldGross = Number(t.grossProceeds) || 0
                    const newNet = oldNet + fund        // realizedPNL
                    const newGross = oldGross - fund    // gross − fundingFee

                    const isGrossWin = newGross > 0
                    const isNetWin = newNet > 0

                    t.netProceeds = newNet
                    t.grossProceeds = newGross
                    t.commission = trFee                // commission ohne Funding
                    t.netSharePL = newNet
                    t.grossSharePL = newGross
                    t.grossWins = isGrossWin ? newGross : 0
                    t.grossLoss = isGrossWin ? 0 : newGross
                    t.netWins = isNetWin ? newNet : 0
                    t.netLoss = isNetWin ? 0 : newNet
                    t.grossWinsCount = isGrossWin ? 1 : 0
                    t.grossLossCount = isGrossWin ? 0 : 1
                    t.netWinsCount = isNetWin ? 1 : 0
                    t.netLossCount = isNetWin ? 0 : 1
                    t.grossSharePLWins = isGrossWin ? newGross : 0
                    t.grossSharePLLoss = isGrossWin ? 0 : newGross
                    t.netSharePLWins = isNetWin ? newNet : 0
                    t.netSharePLLoss = isNetWin ? 0 : newNet
                    t.highGrossSharePLWin = isGrossWin ? newGross : 0
                    t.highGrossSharePLLoss = isGrossWin ? 0 : newGross
                    t.highNetSharePLWin = isNetWin ? newNet : 0
                    t.highNetSharePLLoss = isNetWin ? 0 : newNet
                    dayChanged = true
                    fixedTrades++
                }

                if (!dayChanged) continue

                // Tages-pAndL und blotter aus korrigierten Trades neu aggregieren
                const blotterMap = {}
                let gp = 0, np = 0, totalFees = 0, gwc = 0, glc = 0, nwc = 0, nlc = 0, tc = 0
                for (const t of tradesArr) {
                    gp += Number(t.grossProceeds) || 0
                    np += Number(t.netProceeds) || 0
                    totalFees += Number(t.commission) || 0
                    gwc += Number(t.grossWinsCount) || 0
                    glc += Number(t.grossLossCount) || 0
                    nwc += Number(t.netWinsCount) || 0
                    nlc += Number(t.netLossCount) || 0
                    tc += 1
                    if (!blotterMap[t.symbol]) {
                        blotterMap[t.symbol] = { symbol: t.symbol, grossProceeds: 0, netProceeds: 0, fees: 0, grossWinsCount: 0, grossLossCount: 0, trades: 0 }
                    }
                    const b = blotterMap[t.symbol]
                    b.grossProceeds += Number(t.grossProceeds) || 0
                    b.netProceeds += Number(t.netProceeds) || 0
                    b.fees += Number(t.commission) || 0
                    b.grossWinsCount += Number(t.grossWinsCount) || 0
                    b.grossLossCount += Number(t.grossLossCount) || 0
                    b.trades += 1
                }
                pAndLObj.grossProceeds = gp
                pAndLObj.netProceeds = np
                pAndLObj.fees = totalFees
                pAndLObj.grossWinsCount = gwc
                pAndLObj.grossLossCount = glc
                if (pAndLObj.netWinsCount !== undefined) pAndLObj.netWinsCount = nwc
                if (pAndLObj.netLossCount !== undefined) pAndLObj.netLossCount = nlc
                if (pAndLObj.grossSharePL !== undefined) pAndLObj.grossSharePL = gp
                if (pAndLObj.netSharePL !== undefined) pAndLObj.netSharePL = np

                await knex('trades').where('id', row.id).update({
                    trades: JSON.stringify(tradesArr),
                    pAndL: JSON.stringify(pAndLObj),
                    blotter: JSON.stringify(Object.values(blotterMap)),
                })
                fixedDays++
            }
            await knex('settings').where('id', 1).update({ fundingFixV299Migrated: 1 })
            if (fixedTrades > 0) {
                console.log(` -> Funding-Fix v2.9.9: ${fixedTrades} Trades in ${fixedDays} Tagen korrigiert`)
            }
        }
    } catch (e) {
        console.error(' -> Funding-Fix v2.9.9 migration error:', e.message)
    }

    // ==================== STRATEGIE-AGENTEN ====================
    // Modularer Auto-Trading-Unterbau. Bewusst strategie-agnostisch: die
    // Strategie selbst steckt in server/strategies/<id>.js, hier stehen nur
    // Instanzen (Parametersätze), erkannte Setups und die Ergebnisse.
    // `double` statt `float`, weil float in Postgres nur 4 Byte (~7 Stellen)
    // hat — zu wenig für Kurse wie 104532.75.

    // Eine Instanz = eine Strategie mit einem Parametersatz auf n Symbolen.
    // Kein Singleton: dieselbe Strategie kann mehrfach parallel laufen.
    if (!(await knex.schema.hasTable('strategy_instances'))) {
        await knex.schema.createTable('strategy_instances', (t) => {
            t.increments('id').primary()
            t.text('strategyId').notNullable()          // 'lsob'
            t.text('name').defaultTo('')
            t.integer('enabled').defaultTo(0)
            t.text('mode').defaultTo('paper')           // paper | shadow | live
            t.text('broker').defaultTo('bitunix')       // Ausführungsziel
            t.text('market').defaultTo('futures')       // Kline-Markt
            t.text('symbols').defaultTo('[]')           // JSON-Array
            t.text('timeframe').defaultTo('15m')
            t.text('params').defaultTo('{}')            // JSON, strategiespezifisch
            t.text('risk').defaultTo('{}')              // JSON, strategie-unabhängig
            t.text('agents').defaultTo('{}')            // JSON, LLM-Veto-Rollen
            t.integer('paramsVersion').defaultTo(1)     // ++ bei jeder Param-Änderung
            t.bigInteger('liveApprovedAt').defaultTo(0) // Live-Freigabe des Nutzers
            t.bigInteger('lastRunAt').defaultTo(0)
            t.text('lastError').defaultTo('')
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.index('strategyId', 'idx_strategy_instances_strategyId')
        })
        console.log(' -> Created table: strategy_instances')
    }

    // Lebenszyklus eines Setups über viele Kerzen hinweg:
    // armed → waiting_retest → triggered → open → closed
    //                        ↘ invalidated | expired | rejected
    if (!(await knex.schema.hasTable('strategy_setups'))) {
        await knex.schema.createTable('strategy_setups', (t) => {
            t.increments('id').primary()
            t.integer('instanceId').notNullable()
            t.text('strategyId').defaultTo('')
            t.text('symbol').notNullable()
            t.text('timeframe').defaultTo('')
            t.text('direction').defaultTo('')           // long | short
            t.text('status').defaultTo('armed')
            t.double('sweepLevel').defaultTo(0)         // gesweeptes Swing-Level
            t.double('sweepPrice').defaultTo(0)         // Docht-Extrem des Sweeps
            t.bigInteger('sweepCandleTime').defaultTo(0)
            t.double('obHigh').defaultTo(0)
            t.double('obLow').defaultTo(0)
            t.bigInteger('obCandleTime').defaultTo(0)
            t.bigInteger('watchFrom').defaultTo(0)      // ab hier wird auf den Retest gewartet
            t.bigInteger('tradeableFrom').defaultTo(0)  // ab hier ist ein Einstieg ehrlich (Signal bestätigt)
            t.double('impulseExtreme').defaultTo(0)
            t.double('entry').defaultTo(0)
            t.double('stopLoss').defaultTo(0)
            t.double('takeProfit').defaultTo(0)
            t.double('rr').defaultTo(0)
            t.text('confirmations').defaultTo('{}')     // JSON: fib786, rsi, rejection, htf
            t.text('invalidReason').defaultTo('')
            t.text('rejectReason').defaultTo('')
            t.bigInteger('triggeredAt').defaultTo(0)
            t.integer('paramsVersion').defaultTo(1)
            t.integer('detectorVersion').defaultTo(1)
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            // Verhindert, dass derselbe Order Block bei jedem Scan neu angelegt wird
            t.unique(['instanceId', 'symbol', 'timeframe', 'direction', 'obCandleTime'], 'uq_strategy_setups_ob')
            t.index(['instanceId', 'status'], 'idx_strategy_setups_instance_status')
        })
        console.log(' -> Created table: strategy_setups')
    }

    // Ein Eintrag je Entscheidungslauf — nur wenn ein Setup wirklich triggert.
    if (!(await knex.schema.hasTable('strategy_runs'))) {
        await knex.schema.createTable('strategy_runs', (t) => {
            t.increments('id').primary()
            t.integer('instanceId').notNullable()
            t.integer('setupId').defaultTo(0)
            t.text('sentimentOutput').defaultTo('{}')
            t.text('portfolioOutput').defaultTo('{}')
            t.text('riskOutput').defaultTo('{}')
            t.text('executionOutput').defaultTo('{}')   // Order-Request/Response (Live-Protokoll)
            t.text('finalAction').defaultTo('')         // execute | reject_agent | reject_risk | error
            t.text('reason').defaultTo('')
            t.text('provider').defaultTo('')
            t.text('model').defaultTo('')
            t.integer('totalTokens').defaultTo(0)
            t.double('costUsd').defaultTo(0)
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.index('instanceId', 'idx_strategy_runs_instanceId')
            t.index('setupId', 'idx_strategy_runs_setupId')
        })
        console.log(' -> Created table: strategy_runs')
    }

    // Offene Positionen (Paper wie Live). `clientOrderId` ist unique und dient
    // als Idempotenz-Schlüssel — ein Retry kann keine zweite Position öffnen.
    if (!(await knex.schema.hasTable('strategy_positions'))) {
        await knex.schema.createTable('strategy_positions', (t) => {
            t.increments('id').primary()
            t.integer('instanceId').notNullable()
            t.integer('setupId').defaultTo(0)
            t.text('mode').defaultTo('paper')
            t.text('broker').defaultTo('')
            t.text('symbol').notNullable()
            t.text('timeframe').defaultTo('')
            t.text('direction').defaultTo('')
            t.double('qty').defaultTo(0)
            t.double('entryPrice').defaultTo(0)
            t.bigInteger('entryTime').defaultTo(0)
            t.double('stopLoss').defaultTo(0)
            t.double('initialStopLoss').defaultTo(0)    // Basis für R, überlebt Break-Even
            t.double('takeProfit').defaultTo(0)
            t.double('leverage').defaultTo(1)
            t.double('notionalUsdt').defaultTo(0)
            t.double('marginUsdt').defaultTo(0)
            t.double('feeOpen').defaultTo(0)
            t.text('clientOrderId').defaultTo('')
            t.text('externalOrderId').defaultTo('')
            t.double('maePrice').defaultTo(0)
            t.double('mfePrice').defaultTo(0)
            t.bigInteger('lastCandleTime').defaultTo(0) // bis hierher ausgewertet
            t.integer('breakEvenDone').defaultTo(0)
            t.text('status').defaultTo('open')          // open | closed
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.unique('clientOrderId', 'uq_strategy_positions_clientOrderId')
            t.index(['instanceId', 'status'], 'idx_strategy_positions_instance_status')
        })
        console.log(' -> Created table: strategy_positions')
    }

    // Geschlossene Trades = Basis der Auswertungs-Rubrik und der Optimizer-Tools.
    if (!(await knex.schema.hasTable('strategy_trades'))) {
        await knex.schema.createTable('strategy_trades', (t) => {
            t.increments('id').primary()
            t.integer('instanceId').notNullable()
            t.integer('setupId').defaultTo(0)
            t.integer('positionId').defaultTo(0)
            t.text('strategyId').defaultTo('')
            t.text('mode').defaultTo('paper')
            t.text('broker').defaultTo('')
            t.text('symbol').notNullable()
            t.text('timeframe').defaultTo('')
            t.text('direction').defaultTo('')
            t.double('qty').defaultTo(0)
            t.double('notionalUsdt').defaultTo(0)
            t.double('leverage').defaultTo(1)
            t.double('entryPrice').defaultTo(0)
            t.bigInteger('entryTime').defaultTo(0)
            t.double('exitPrice').defaultTo(0)
            t.bigInteger('exitTime').defaultTo(0)
            t.double('stopLoss').defaultTo(0)           // initialer SL (R-Basis)
            t.double('takeProfit').defaultTo(0)
            t.double('grossPnl').defaultTo(0)
            t.double('fees').defaultTo(0)
            t.double('funding').defaultTo(0)
            t.double('netPnl').defaultTo(0)
            t.double('rMultiple').defaultTo(0)
            t.text('exitReason').defaultTo('')          // tp | sl | be | liquidation | manual | timeout | reverse
            t.double('maeR').defaultTo(0)               // in R, für die MAE/MFE-Analyse
            t.double('mfeR').defaultTo(0)
            t.double('holdingMinutes').defaultTo(0)
            t.integer('paramsVersion').defaultTo(1)
            t.integer('journalTradeId').defaultTo(0)    // >0 = ins Journal übernommen
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.index(['instanceId', 'exitTime'], 'idx_strategy_trades_instance_exit')
            t.index('exitTime', 'idx_strategy_trades_exitTime')
        })
        console.log(' -> Created table: strategy_trades')
    }

    // Gespeicherte Backtest-Läufe — die Agenten vergleichen dagegen, statt zu raten.
    if (!(await knex.schema.hasTable('strategy_backtests'))) {
        await knex.schema.createTable('strategy_backtests', (t) => {
            t.increments('id').primary()
            t.text('strategyId').notNullable()
            t.integer('instanceId').defaultTo(0)
            t.text('label').defaultTo('')
            t.text('symbol').defaultTo('')
            t.text('timeframe').defaultTo('')
            t.text('market').defaultTo('futures')
            t.bigInteger('fromTs').defaultTo(0)
            t.bigInteger('toTs').defaultTo(0)
            t.text('params').defaultTo('{}')
            t.text('stats').defaultTo('{}')
            t.text('trades').defaultTo('[]')
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.index('strategyId', 'idx_strategy_backtests_strategyId')
        })
        console.log(' -> Created table: strategy_backtests')
    }

    // Verbesserungsvorschläge der Agenten. Werden NIE automatisch angewendet —
    // erst nach Freigabe durch den Nutzer, dann paramsVersion++.
    if (!(await knex.schema.hasTable('strategy_suggestions'))) {
        await knex.schema.createTable('strategy_suggestions', (t) => {
            t.increments('id').primary()
            t.integer('instanceId').notNullable()
            t.text('source').defaultTo('agent')          // agent | user
            t.text('title').defaultTo('')
            t.text('rationale').defaultTo('')
            t.text('proposedParams').defaultTo('{}')
            t.integer('backtestId').defaultTo(0)         // Beleg für den Vorschlag
            t.text('status').defaultTo('pending')        // pending | accepted | rejected
            t.bigInteger('decidedAt').defaultTo(0)
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.index(['instanceId', 'status'], 'idx_strategy_suggestions_instance_status')
        })
        console.log(' -> Created table: strategy_suggestions')
    }

    // Strategie-Entwürfe aus dem Baukasten. Ein Entwurf ist NUR Beschreibung —
    // er wird nie automatisch ausgeführt. Erst wenn daraus eine Moduldatei
    // erzeugt und nach Prüfung registriert wird, kann er handeln.
    if (!(await knex.schema.hasTable('strategy_drafts'))) {
        await knex.schema.createTable('strategy_drafts', (t) => {
            t.increments('id').primary()
            t.text('title').defaultTo('')
            t.text('slug').defaultTo('')            // Dateiname des erzeugten Entwurfs
            t.text('sourceName').defaultTo('')      // hochgeladene Datei
            t.text('status').defaultTo('draft')     // draft | generated
            t.text('spec').defaultTo('{}')          // strukturierte Strategie-Beschreibung
            t.text('messages').defaultTo('[]')      // Gesprächsverlauf
            t.text('generatedPath').defaultTo('')
            t.text('provider').defaultTo('')
            t.text('model').defaultTo('')
            t.double('costUsd').defaultTo(0)
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
        })
        console.log(' -> Created table: strategy_drafts')
    }

    // Selbst gebaute Strategien: reine Regelbeschreibungen, die der Interpreter
    // ausführt. Kein Code — deshalb können sie gefahrlos aus der Oberfläche
    // kommen und zur Laufzeit geladen werden.
    if (!(await knex.schema.hasTable('rule_strategies'))) {
        await knex.schema.createTable('rule_strategies', (t) => {
            t.increments('id').primary()
            t.text('strategyId').notNullable()      // Kurzname, in der Registry sichtbar
            t.text('name').defaultTo('')
            t.text('description').defaultTo('')
            t.integer('enabled').defaultTo(1)
            t.text('rules').defaultTo('{}')         // die geprüfte Beschreibung
            t.text('source').defaultTo('user')      // user | draft | agent
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.unique('strategyId')
        })
        console.log(' -> Created table: rule_strategies')
    }

    // Nachträge für Installationen, bei denen die Tabellen schon existieren
    await addColumnIfNotExists('strategy_positions', 'lastCandleTime', (t) => t.bigInteger('lastCandleTime').defaultTo(0))
    await addColumnIfNotExists('strategy_positions', 'breakEvenDone', (t) => t.integer('breakEvenDone').defaultTo(0))
    await addColumnIfNotExists('strategy_setups', 'watchFrom', (t) => t.bigInteger('watchFrom').defaultTo(0))
    await addColumnIfNotExists('strategy_setups', 'tradeableFrom', (t) => t.bigInteger('tradeableFrom').defaultTo(0))
    // Teilausstieg: muss auf der Position liegen, sonst nimmt ein Neustart ihn
    // ein zweites Mal — die Fortschreibung erkennt sonst nicht, dass schon ein
    // Anteil geschlossen wurde.
    await addColumnIfNotExists('strategy_positions', 'partialDone', (t) => t.integer('partialDone').defaultTo(0))
    await addColumnIfNotExists('strategy_positions', 'partialQty', (t) => t.double('partialQty').defaultTo(0))
    await addColumnIfNotExists('strategy_positions', 'partialPrice', (t) => t.double('partialPrice').defaultTo(0))
    await addColumnIfNotExists('strategy_positions', 'partialGross', (t) => t.double('partialGross').defaultTo(0))
    await addColumnIfNotExists('strategy_positions', 'partialFee', (t) => t.double('partialFee').defaultTo(0))
    await addColumnIfNotExists('strategy_positions', 'initialQty', (t) => t.double('initialQty').defaultTo(0))
    // Positions-Kennung der Börse (≠ Order-Kennung) — nötig für gezieltes Close
    await addColumnIfNotExists('strategy_positions', 'externalPositionId', (t) => t.text('externalPositionId').defaultTo(''))

    // Spiegelt diese Instanz ihre geschlossenen Trades ins Journal? Bewusst je
    // Instanz und standardmässig AUS: es sind Papier-Trades, und ob sie im
    // Journal auftauchen sollen, ist eine Entscheidung des Nutzers.
    await addColumnIfNotExists('strategy_instances', 'journalSpiegeln', (t) => t.integer('journalSpiegeln').defaultTo(0))

    // Experiment-Registry: ein gespeicherter Backtest muss REPRODUZIERBAR und
    // ENTSCHEIDBAR sein. Bisher fehlte beides — das Kostenmodell (Gebühren,
    // Slippage, Hebel) wurde gar nicht mitgeschrieben, also liess sich ein Lauf
    // nachträglich nicht nachstellen; und was aus ihm folgte, stand nirgends.
    await addColumnIfNotExists('strategy_backtests', 'risk', (t) => t.text('risk').defaultTo('{}'))
    // Fassung der Regelstrategie zum Zeitpunkt des Laufs (0 = eingebaute Strategie)
    await addColumnIfNotExists('strategy_backtests', 'ruleVersion', (t) => t.integer('ruleVersion').defaultTo(0))
    // offen | uebernommen | verworfen — und warum
    await addColumnIfNotExists('strategy_backtests', 'entscheidung', (t) => t.text('entscheidung').defaultTo('offen'))
    await addColumnIfNotExists('strategy_backtests', 'entschiedenAm', (t) => t.bigInteger('entschiedenAm').defaultTo(0))
    await addColumnIfNotExists('strategy_backtests', 'notiz', (t) => t.text('notiz').defaultTo(''))
    // Wie viele Varianten wurden für DIESES Ergebnis durchprobiert? Ein Treffer
    // aus 30 Versuchen ist etwas anderes als ein Treffer aus einem — ohne diese
    // Zahl liest sich beides gleich gut.
    await addColumnIfNotExists('strategy_backtests', 'variantenGeprueft', (t) => t.integer('variantenGeprueft').defaultTo(1))

    // Regelstrategien versionieren. Ohne das überschreibt jede Änderung die
    // Regeln an Ort und Stelle: die Trades von gestern zeigen weiter auf die
    // Strategie, aber die Logik, die sie erzeugt hat, ist unwiederbringlich weg.
    // Bei den Instanzen ist das über `paramsVersion` längst gelöst — hier fehlte
    // es. `version` beginnt bei 1, damit Bestand als Version 1 gilt.
    await addColumnIfNotExists('rule_strategies', 'version', (t) => t.integer('version').defaultTo(1))

    if (!(await knex.schema.hasTable('rule_strategy_history'))) {
        await knex.schema.createTable('rule_strategy_history', (t) => {
            t.increments('id').primary()
            t.text('strategyId').notNullable()
            t.integer('version').notNullable()
            t.text('name').defaultTo('')
            t.text('description').defaultTo('')
            t.text('rules').defaultTo('{}')       // vollständige Fassung DIESER Version
            t.text('source').defaultTo('manuell')
            t.bigInteger('createdAt').defaultTo(0)
            t.unique(['strategyId', 'version'], 'uniq_rule_history_version')
            t.index('strategyId', 'idx_rule_history_strategyId')
        })
        console.log(' -> Created table: rule_strategy_history')
    }

    // Bestand nachtragen: der aktuelle Stand jeder Regelstrategie wird als ihre
    // Version 1 hinterlegt. Idempotent — ein zweiter Start ändert nichts.
    if (await knex.schema.hasTable('rule_strategies')) {
        const vorhandene = await knex('rule_strategies').select('strategyId', 'name', 'description', 'rules', 'version')
        for (const r of vorhandene) {
            const da = await knex('rule_strategy_history')
                .where({ strategyId: r.strategyId, version: r.version || 1 }).first()
            if (da) continue
            await knex('rule_strategy_history').insert({
                strategyId: r.strategyId, version: r.version || 1,
                name: r.name, description: r.description, rules: r.rules,
                source: 'bestand', createdAt: Date.now(),
            }).catch(() => {})
        }
    }

    // Mehrere Zeiteinheiten je Instanz: dieselbe Strategie läuft gleichzeitig
    // auf 15m, 1h, 4h … — jede für sich, aber unter EINEM Risikobudget.
    // `timeframe` bleibt die Haupt-Zeiteinheit; leer/`[]` = nur diese, also
    // genau das bisherige Verhalten für alle bestehenden Instanzen.
    await addColumnIfNotExists('strategy_instances', 'timeframes', (t) => t.text('timeframes').defaultTo('[]'))

    // Parameter-Historie: OHNE sie ist `paramsVersion` nur eine Zahl — jede
    // Änderung überschreibt die Werte, und niemand kann später nachsehen, WAS
    // v2 eigentlich war. Erst mit der Historie lassen sich Versionen fachlich
    // vergleichen (was wurde geändert, was hat es gebracht).
    if (!(await knex.schema.hasTable('strategy_param_history'))) {
        await knex.schema.createTable('strategy_param_history', (t) => {
            t.increments('id').primary()
            t.integer('instanceId').notNullable()
            t.integer('paramsVersion').notNullable()
            t.text('params').defaultTo('{}')
            t.text('risk').defaultTo('{}')
            t.text('source').defaultTo('manuell')      // angelegt | manuell | vorschlag | bestand
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.unique(['instanceId', 'paramsVersion'], 'uq_param_history_instance_version')
        })
        console.log(' -> Created table: strategy_param_history')
    }
    // Bestand nachtragen: für jede Instanz mindestens die AKTUELLE Version —
    // idempotent, damit die Migration auf mehreren Containern laufen darf.
    {
        const instanzen = await knex('strategy_instances').select('id', 'paramsVersion', 'params', 'risk')
        for (const i of instanzen) {
            const da = await knex('strategy_param_history')
                .where({ instanceId: i.id, paramsVersion: i.paramsVersion }).first()
            if (!da) {
                await knex('strategy_param_history').insert({
                    instanceId: i.id, paramsVersion: i.paramsVersion,
                    params: i.params, risk: i.risk, source: 'bestand',
                })
            }
        }
    }

    // Gebühren nach Ordersorte statt eines Satzes für alles. Der alte `feeBps`
    // galt für JEDE Füllung, war aber als Taker-Satz gedacht — er wandert
    // deshalb auf `feeTakerBps`. Für den Maker-Satz gibt es keine Altangabe;
    // er bekommt den Schemawert, nie mehr als den Taker-Satz. Wer eine eigene
    // Gebührenstufe fährt, muss ihn einmal nachtragen (Konto → Gebühren).
    //
    // Idempotent: eine Instanz, die die neuen Schlüssel schon trägt, wird nicht
    // angefasst — die Migration darf auf mehreren Containern laufen.
    {
        const instanzen = await knex('strategy_instances').select('id', 'risk')
        for (const i of instanzen) {
            let risk
            try { risk = JSON.parse(i.risk || '{}') } catch { continue }
            if (!risk || typeof risk !== 'object') continue
            if (risk.feeTakerBps !== undefined || risk.feeMakerBps !== undefined) continue
            const alt = Number(risk.feeBps)
            if (!Number.isFinite(alt)) continue
            risk.feeTakerBps = alt
            risk.feeMakerBps = Math.min(2, alt)
            delete risk.feeBps
            await knex('strategy_instances').where('id', i.id)
                .update({ risk: JSON.stringify(risk) })
                .catch(() => {})
        }
    }

    // Globale Schalter der Strategie-Agenten (Live-Freigabe und Not-Aus)
    await addColumnIfNotExists('settings', 'strategyLiveEnabled', (t) => t.integer('strategyLiveEnabled').defaultTo(0))
    await addColumnIfNotExists('settings', 'strategyKillSwitch', (t) => t.integer('strategyKillSwitch').defaultTo(0))
    // Ausgeblendete Startvorlagen. Die Vorlagen selbst stehen im Code und sind
    // nicht löschbar — wer eine nie benutzt, soll sie aber aus der Auswahl
    // nehmen können, ohne dass sie jemand anderem fehlt. Rein kosmetisch,
    // deshalb eine Liste von Schlüsseln statt gelöschter Daten.
    await addColumnIfNotExists('settings', 'strategyHiddenTemplates', (t) => t.text('strategyHiddenTemplates').defaultTo('[]'))
    await addColumnIfNotExists('settings', 'strategyMaxLeverage', (t) => t.integer('strategyMaxLeverage').defaultTo(10))
    await addColumnIfNotExists('settings', 'strategyMinPaperTrades', (t) => t.integer('strategyMinPaperTrades').defaultTo(20))
    await addColumnIfNotExists('settings', 'strategyLlmBudgetUsd', (t) => t.float('strategyLlmBudgetUsd').defaultTo(1))
    // Modell-Listen je Anbieter (JSON) — bearbeitbar statt fest im Frontend
    await addColumnIfNotExists('settings', 'aiModels', (t) => t.text('aiModels'))
    // Eigener, OpenAI-kompatibler Anbieter (Groq, OpenRouter, vLLM, LM Studio …)
    await addColumnIfNotExists('settings', 'aiCustomUrl', (t) => t.text('aiCustomUrl'))
    await addColumnIfNotExists('settings', 'aiKeyCustom', (t) => t.text('aiKeyCustom'))

    // OpenRouter-spezifische Spalten
    await addColumnIfNotExists('settings', 'aiKeyOpenrouter', (t) => t.text('aiKeyOpenrouter'))
    await addColumnIfNotExists('settings', 'aiOpenrouterCatalog', (t) => t.text('aiOpenrouterCatalog'))
    await addColumnIfNotExists('settings', 'aiTaskProviders', (t) => t.text('aiTaskProviders').defaultTo('{}'))

    // ==================== MARKTRADAR ====================

    // Tagesschnappschüsse von Kennzahlen, für die es keine kostenlose Historie
    // gibt (BTC-Dominanz, Gesamtmarktkapitalisierung). Einmal verpasst ist ein
    // Tag endgültig weg — deshalb schreibt der Takt lieber öfter als zu selten,
    // `unique(kind, dayUnix)` hält die Zeilen trotzdem eindeutig.
    if (!(await knex.schema.hasTable('market_snapshots'))) {
        await knex.schema.createTable('market_snapshots', (t) => {
            t.increments('id').primary()
            t.string('kind').notNullable()
            t.bigInteger('dayUnix').notNullable()   // UTC-Mitternacht in ms
            t.float('value').notNullable()
            t.text('extra').defaultTo('{}')
            t.bigInteger('createdAt').defaultTo(0)
            t.unique(['kind', 'dayUnix'])
            t.index(['kind', 'dayUnix'], 'idx_msnap_kind_day')
        })
        console.log(' -> Created table: market_snapshots')
    }

    // Leer = die Symbole der RSI-Heatmap werden aus den eigenen Trades der
    // letzten 90 Tage abgeleitet. Eine eingetragene Liste sticht die Ableitung.
    await addColumnIfNotExists('settings', 'radarRsiSymbols', (t) => t.text('radarRsiSymbols').defaultTo(''))
    await addColumnIfNotExists('settings', 'radarRsiTfs', (t) => t.text('radarRsiTfs').defaultTo(''))

    // Wirtschaftstermine. Der Feed führt immer nur die LAUFENDE Woche — was
    // einmal hier steht, bleibt deshalb erhalten, sonst gäbe es weder Rückblick
    // noch Vorschau. `extId` ist ein Fingerabdruck aus Land, Titel und Zeit;
    // Prognose- und Ist-Werte werden im Wochenverlauf nachgetragen.
    if (!(await knex.schema.hasTable('calendar_events'))) {
        await knex.schema.createTable('calendar_events', (t) => {
            t.increments('id').primary()
            t.string('extId').notNullable()
            t.text('titel').defaultTo('')
            t.string('land').defaultTo('')
            t.string('impact').defaultTo('')
            t.bigInteger('dateUnix').notNullable()
            t.text('forecast').defaultTo('')
            t.text('previous').defaultTo('')
            t.text('actual').defaultTo('')
            t.string('quelle').defaultTo('')
            t.bigInteger('fetchedAt').defaultTo(0)
            t.bigInteger('updatedAt').defaultTo(0)
            t.unique(['extId'])
            t.index(['dateUnix'], 'idx_calendar_date')
        })
        console.log(' -> Created table: calendar_events')
    }

    await addColumnIfNotExists('settings', 'radarKalenderLaender', (t) => t.text('radarKalenderLaender').defaultTo('USD,JPY'))
    await addColumnIfNotExists('settings', 'radarKalenderImpact', (t) => t.text('radarKalenderImpact').defaultTo('medium'))

    /*
     * CryptoQuant-Schlüssel für die ETF-Kachel. Verschlüsselt wie alle
     * Zugangsdaten, geschrieben nur über /api/cryptoquant/settings.
     * Ohne Schlüssel bleibt die Kachel leer und sagt das auch — der
     * Gratis-Tarif der Quelle reicht für die Fondsbestände.
     */
    await addColumnIfNotExists('settings', 'cryptoquantApiKey', (t) => t.text('cryptoquantApiKey').defaultTo(''))

    /*
     * Live-Trading-Fenster. Wer nur beobachtet und nicht handelt, braucht die
     * Seite nicht — dann sollen auch der Startknopf auf dem Marktradar und der
     * Menüeintrag verschwinden, statt als toter Weg herumzustehen. Vorgabe an:
     * die Seite kostet nichts, solange man sie nicht öffnet (unsichtbare
     * Kacheln werden gar nicht erst geladen).
     */
    await addColumnIfNotExists('settings', 'livetradingAn', (t) => t.integer('livetradingAn').defaultTo(1))
    // Layout & Stil: Beta-Modi (Strategien/Research) im Umschalter ausblenden,
    // und das Live-Trading-Fenster auch auf dem Telefon zeigen (sonst nur Desktop).
    await addColumnIfNotExists('settings', 'betaAusblenden', (t) => t.integer('betaAusblenden').defaultTo(0))
    await addColumnIfNotExists('settings', 'livetradingMobil', (t) => t.integer('livetradingMobil').defaultTo(0))
    // Startseite (konfigurierbares Kachelraster) als Landing-Page + Modus-Tab.
    // Standard an; aus = die App startet wie früher direkt im Journal.
    await addColumnIfNotExists('settings', 'startseiteAn', (t) => t.integer('startseiteAn').defaultTo(1))

    /*
     * Erweiterte Infos: das kleine „i" an Werten und Bedienelementen
     * (`InfoTipp.vue`). Vorgabe AN — die Erklärungen sind für den da, der die
     * App noch nicht kennt, und genau der sucht keinen Schalter, um sie
     * einzuschalten. Wer sie nicht braucht, schaltet sie ab.
     */
    await addColumnIfNotExists('settings', 'erweiterteInfos', (t) => t.integer('erweiterteInfos').defaultTo(1))

    /*
     * Modi einzeln ab- und anschaltbar. Journal hat bewusst KEINEN Schalter:
     * es ist der Kern der App, ohne ihn bliebe nichts übrig. Die Startseite
     * hängt weiterhin an `startseiteAn` (oben), gehört aber in der Oberfläche
     * in dieselbe Gruppe.
     *
     * Vorgabe an: ein Bestandsnutzer soll nach dem Update dieselbe App
     * vorfinden wie davor.
     */
    await addColumnIfNotExists('settings', 'modusLiveAn', (t) => t.integer('modusLiveAn').defaultTo(1))
    await addColumnIfNotExists('settings', 'modusResearchAn', (t) => t.integer('modusResearchAn').defaultTo(1))
    await addColumnIfNotExists('settings', 'modusStrategieAn', (t) => t.integer('modusStrategieAn').defaultTo(1))

    /*
     * Einmalige Übernahme von „Beta-Funktionen ausblenden".
     *
     * Der alte Schalter versteckte Research und Strategien nur im Umschalter;
     * die Routen blieben erreichbar. Die drei Schalter oben ersetzen ihn und
     * schalten wirklich ab. Ohne diese Übernahme bekäme jeder, der die beiden
     * Modi ausgeblendet hatte, sie beim nächsten Start zurück.
     *
     * Läuft genau einmal: nur wenn die neuen Spalten noch auf ihrer Vorgabe
     * stehen. Wer Research später bewusst wieder einschaltet, behält das —
     * sonst würde die Übernahme bei jedem Start seine Entscheidung überfahren.
     */
    const betaZeile = await knex('settings').where('id', 1)
        .select('betaAusblenden', 'modusResearchAn', 'modusStrategieAn').first()
    if (betaZeile && Number(betaZeile.betaAusblenden) === 1
        && Number(betaZeile.modusResearchAn ?? 1) === 1
        && Number(betaZeile.modusStrategieAn ?? 1) === 1) {
        await knex('settings').where('id', 1).update({ modusResearchAn: 0, modusStrategieAn: 0 })
        console.log(' -> Einstellungen: „Beta ausblenden" übernommen — Research und Strategien stehen jetzt auf aus')
    }

    // Nachrichtenquellen. `laerm` markiert, was der Nutzer als Lärm einstuft —
    // der Sammelschalter („Temporär ausschliessen") blendet genau diese
    // Quellen aus und holt sie erst gar nicht ab.
    if (!(await knex.schema.hasTable('news_sources'))) {
        await knex.schema.createTable('news_sources', (t) => {
            t.increments('id').primary()
            t.string('art').defaultTo('rss')        // youtube | rss | truth | x
            t.text('name').defaultTo('')
            t.text('url').defaultTo('')
            t.integer('enabled').defaultTo(1)
            t.integer('laerm').defaultTo(0)
            t.bigInteger('letzterAbruf').defaultTo(0)
            t.text('letzterFehler').defaultTo('')
            t.integer('fehlerZaehler').defaultTo(0)
            t.bigInteger('createdAt').defaultTo(0)
            t.bigInteger('updatedAt').defaultTo(0)
        })
        console.log(' -> Created table: news_sources')
    }

    // Beiträge. Gespeichert werden Titel, Verweis und Zeitpunkt — plus später
    // eine SELBST erzeugte Zusammenfassung. Keine Volltextkopien fremder
    // Inhalte; deshalb steht diese Tabelle auch nicht im Backup.
    if (!(await knex.schema.hasTable('news_items'))) {
        await knex.schema.createTable('news_items', (t) => {
            t.increments('id').primary()
            t.integer('sourceId').notNullable()
            t.string('extId').notNullable()
            t.text('titel').defaultTo('')
            t.text('url').defaultTo('')
            t.text('inhalt').defaultTo('')
            t.text('bild').defaultTo('')
            t.text('zusammenfassung').defaultTo('')
            t.bigInteger('publishedAt').defaultTo(0)
            t.integer('tokens').defaultTo(0)
            t.string('aiModel').defaultTo('')
            t.bigInteger('aiStand').defaultTo(0)
            t.string('status').defaultTo('neu')     // neu | zusammengefasst | fehler
            t.text('fehler').defaultTo('')
            t.integer('versuche').defaultTo(0)
            t.bigInteger('createdAt').defaultTo(0)
            t.unique(['sourceId', 'extId'])
            t.index(['publishedAt'], 'idx_news_published')
        })
        console.log(' -> Created table: news_items')
    }

    // Vorgabe AN: wer den Schalter nicht kennt, soll den Lärm nicht sehen
    await addColumnIfNotExists('settings', 'radarNewsQuellenAusschluss', (t) => t.integer('radarNewsQuellenAusschluss').defaultTo(1))

    // Lageberichte. Ein Bericht je Lauf — nicht je Beitrag: die Frage ist
    // „was ist heute wichtig", nicht „was stand in Beitrag 7".
    if (!(await knex.schema.hasTable('news_digests'))) {
        await knex.schema.createTable('news_digests', (t) => {
            t.increments('id').primary()
            t.bigInteger('erstelltAm').notNullable()
            t.string('provider').defaultTo('')
            t.string('modell').defaultTo('')
            t.text('ueberschrift').defaultTo('')
            t.text('lage').defaultTo('')
            t.text('punkte').defaultTo('[]')     // JSON: [{titel,text,quelle,url,wichtigkeit}]
            t.integer('beitraege').defaultTo(0)
            t.integer('videos').defaultTo(0)
            t.integer('tokens').defaultTo(0)
            t.float('kostenUsd').defaultTo(0)
            t.string('ausloeser').defaultTo('auto')   // auto | manuell
            // Alle Beiträge, aus denen der Bericht entstand — als JSON.
            // Nötig, damit auch ein Punkt ohne Einzelbeleg auf echte Verweise
            // zeigen kann statt nur einen Quellennamen zu behaupten.
            t.text('beitraegeListe').defaultTo('[]')
            t.index(['erstelltAm'], 'idx_digest_zeit')
        })
        console.log(' -> Created table: news_digests')
    }

    // Zeitplan des Lageberichts. 12:00 in der eingestellten Zeitzone; 0 = aus.
    await addColumnIfNotExists('settings', 'radarNewsAuto', (t) => t.integer('radarNewsAuto').defaultTo(1))
    await addColumnIfNotExists('settings', 'radarNewsStunde', (t) => t.integer('radarNewsStunde').defaultTo(12))
    // Wie viele Videos je Lauf an Gemini gehen dürfen — Video ist der teuerste
    // Eingabetyp, deshalb eine harte Obergrenze statt eines guten Vorsatzes.
    await addColumnIfNotExists('settings', 'radarNewsVideos', (t) => t.integer('radarNewsVideos').defaultTo(3))
    // Nur Gemini liest YouTube-Adressen direkt — daher eigenes Modellfeld,
    // unabhängig vom Standard-Anbieter des Journals
    await addColumnIfNotExists('settings', 'radarNewsModel', (t) => t.text('radarNewsModel').defaultTo(''))
    // Auflösung der Videoanalyse. 'niedrig' kostet rund 100 Token je
    // Videosekunde, 'standard' rund 300 — der teuerste Regler im Aufbau.
    // Für gesprochene Marktkommentare reicht niedrig, weil die Tonspur den
    // Inhalt trägt; Standard lohnt nur, wenn Zahlen im Bild abgelesen werden.
    await addColumnIfNotExists('settings', 'radarNewsAufloesung', (t) => t.text('radarNewsAufloesung').defaultTo('niedrig'))
    // Wer den Lagebericht schreibt. Leer = der allgemein eingestellte Anbieter.
    await addColumnIfNotExists('settings', 'radarNewsBerichtProvider', (t) => t.text('radarNewsBerichtProvider').defaultTo(''))
    await addColumnIfNotExists('settings', 'radarNewsBerichtModell', (t) => t.text('radarNewsBerichtModell').defaultTo(''))
    // Pi-Cycle-Alarm. Die Kreuzung selbst zu melden kommt per Definition zu
    // spät — sie IST das Signal. Die Schwelle gibt Vorlauf: 0 = nur bei der
    // Kreuzung, 5 = auch schon, wenn die kurze Linie bis auf 5 % heran ist.
    await addColumnIfNotExists('settings', 'radarPicycleAlarm', (t) => t.integer('radarPicycleAlarm').defaultTo(1))
    await addColumnIfNotExists('settings', 'radarPicycleSchwelle', (t) => t.integer('radarPicycleSchwelle').defaultTo(0))
    // Funding-Divergenz zwischen Börsen, in Prozentpunkten der Jahresrate.
    // 0 = kein Alarm. Arbitrage hält die Raten normalerweise auf wenige Punkte
    // zusammen; 15 lässt das Grundrauschen (beobachtet 2–4 Punkte) durch und
    // meldet nur echtes Auseinanderlaufen.
    await addColumnIfNotExists('settings', 'radarFundingDivergenz', (t) => t.integer('radarFundingDivergenz').defaultTo(15))
    // Welche Märkte der Divergenz-Alarm beobachtet, als Liste von Symbolen.
    // Leer = die eigenen Märkte (radarRsiSymbols bzw. die selbst gehandelten
    // Coins), wie vor der Auswahl. Getrennt von radarRsiSymbols, weil eine
    // Divergenz ein Grund ist, sich einen Markt ANZUSEHEN — man muss ihn dafür
    // nicht schon handeln, und umgekehrt will nicht jeder eigene Markt melden.
    await addColumnIfNotExists('settings', 'radarDivergenzSymbole', (t) => t.text('radarDivergenzSymbole').defaultTo(''))

    /*
     * Benachrichtigungen: welcher Kanal für welches Ereignis.
     *
     * EINE JSON-Spalte statt zwei Spalten je Meldungstyp — sonst wächst das
     * Schema mit jedem neuen Ereignis um zwei Spalten und drei Whitelist-
     * Einträge. Form: { [id]: { browser: bool, email: bool } }. Fehlt ein
     * Eintrag, gilt „Browser an, E-Mail aus"; die Vorgabe steht im Register
     * (server/benachrichtigungen.js), nicht hier.
     *
     * Die Schwellen bleiben bewusst eigene Spalten (radarPicycleSchwelle,
     * radarFundingDivergenz): das sind Parameter des Ereignisses, keine
     * Kanalwahl.
     */
    await addColumnIfNotExists('settings', 'benachrichtigungen', (t) => t.text('benachrichtigungen').defaultTo('{}'))
    await uebernehmeAlteAlarmSchalter()

    /*
     * SMTP-Zugang für den E-Mail-Versand.
     *
     * Browser-Benachrichtigungen erreichen nur, wer die Seite offen hat. E-Mail
     * ist der Weg zu allem anderen — deshalb serverseitig und mit eigenem
     * Zugang. `mailPasswort` wird verschlüsselt abgelegt (server/crypto.js) und
     * ist in api-routes.js als sensibel eingetragen: es verlässt den Server nie
     * wieder, weder über die Settings-Antwort noch über den Backup-Export.
     */
    await addColumnIfNotExists('settings', 'mailAktiv', (t) => t.integer('mailAktiv').defaultTo(0))
    await addColumnIfNotExists('settings', 'mailHost', (t) => t.text('mailHost').defaultTo(''))
    await addColumnIfNotExists('settings', 'mailPort', (t) => t.integer('mailPort').defaultTo(587))
    await addColumnIfNotExists('settings', 'mailSicherheit', (t) => t.text('mailSicherheit').defaultTo('starttls'))
    await addColumnIfNotExists('settings', 'mailUser', (t) => t.text('mailUser').defaultTo(''))
    await addColumnIfNotExists('settings', 'mailPasswort', (t) => t.text('mailPasswort').defaultTo(''))
    await addColumnIfNotExists('settings', 'mailVon', (t) => t.text('mailVon').defaultTo(''))
    await addColumnIfNotExists('settings', 'mailAn', (t) => t.text('mailAn').defaultTo(''))
    // Schriftgrösse der Mails. Vorgabe „gross": ein Postfach kennt keinen Zoom,
    // die Meldungen werden meist auf dem Telefon gelesen.
    await addColumnIfNotExists('settings', 'mailSchriftGroesse', (t) => t.text('mailSchriftGroesse').defaultTo('gross'))

    // Vorschaubild je Beitrag. Nachträglich, weil news_items zuerst ohne
    // gebaut wurde — die Spalte muss also auch bestehenden Tabellen wachsen.
    await addColumnIfNotExists('news_items', 'bild', (t) => t.text('bild').defaultTo(''))
    await addColumnIfNotExists('news_digests', 'beitraegeListe', (t) => t.text('beitraegeListe').defaultTo('[]'))
    // Was mit den Videos passiert ist — sichtbar, nicht nur als Zahl.
    // Ein Video kostet bis zu zehn Rappen; blieb es ungenutzt oder scheiterte
    // es, muss der Grund im Bericht stehen und nicht nur im Serverlog.
    await addColumnIfNotExists('news_digests', 'videosListe', (t) => t.text('videosListe').defaultTo('[]'))
    await addColumnIfNotExists('news_digests', 'hinweis', (t) => t.text('hinweis').defaultTo(''))
    // `videos` zählt, was in den Bericht einfloss, `videosNeu` nur das in DIESEM
    // Lauf bezahlte. Ohne die Trennung meldete der Bericht „0 Videos", obwohl
    // vier bezahlte Zusammenfassungen darin steckten — nur eben aus einem
    // früheren Lauf.
    await addColumnIfNotExists('news_digests', 'videosNeu', (t) => t.integer('videosNeu').defaultTo(0))
    /*
     * Bericht oder Aktualisierung — und worauf sie aufsetzt.
     *
     * Eine Aktualisierung ist eine EIGENE Zeile, keine Überschreibung des
     * Mittagsberichts: Sie hat andere Kosten, andere Beiträge und einen
     * anderen Stand, und wer wissen will, was um 12:00 dastand, muss das
     * nachlesen können. `basisId` zeigt immer auf den ERSTEN Bericht der
     * Kette, `updateNr` zählt innerhalb der Kette — so bleibt „Aktualisierung
     * 2 von heute Mittag" ohne Rekursion lesbar.
     */
    await addColumnIfNotExists('news_digests', 'art', (t) => t.text('art').defaultTo('bericht'))   // bericht|update
    await addColumnIfNotExists('news_digests', 'basisId', (t) => t.integer('basisId').defaultTo(0))
    await addColumnIfNotExists('news_digests', 'updateNr', (t) => t.integer('updateNr').defaultTo(0))
    // Je Quelle steuerbar, ob ihre Videos analysiert werden. Ohne das ginge das
    // Videobudget an den erstbesten Kanal — und der ist nicht zwingend der,
    // dessen Inhalt im Bericht gebraucht wird.
    await addColumnIfNotExists('news_sources', 'videoAnalyse', (t) => t.integer('videoAnalyse').defaultTo(1))

    // Berichts-Rhythmus und -Zuschnitt. Der Lagebericht ist konfigurierbar:
    // täglich oder wöchentlich (mit Wochentag), Themen als Kapitel, Länge.
    await addColumnIfNotExists('settings', 'radarNewsRhythmus', (t) => t.text('radarNewsRhythmus').defaultTo('taeglich'))
    await addColumnIfNotExists('settings', 'radarNewsWochentag', (t) => t.integer('radarNewsWochentag').defaultTo(1))   // 1=Mo … 7=So
    await addColumnIfNotExists('settings', 'radarNewsThemen', (t) => t.text('radarNewsThemen').defaultTo('crypto'))     // CSV: crypto,finanzen,tech
    await addColumnIfNotExists('settings', 'radarNewsLaenge', (t) => t.text('radarNewsLaenge').defaultTo('mittel'))     // kurz|mittel|lang
    /*
     * Aktualisierungen des Tagesberichts: keine, eine oder zwei.
     *
     * Ein Bericht um 12:00 ist um 20:00 nicht falsch, aber alt — und ein
     * zweiter Vollbericht wäre die teure Antwort darauf (er zahlt alles noch
     * einmal, was sich seit dem Mittag nicht geändert hat). Die Aktualisierung
     * bekommt stattdessen den bisherigen Bericht vorgelegt und arbeitet nur
     * ein, was seither dazugekommen ist.
     *
     * Zwei ist die Obergrenze, und zwar bewusst als Zahl und nicht als
     * Vorsatz: jeder Lauf kostet Geld, und ab dem dritten liest sie ohnehin
     * niemand mehr. Die Stunden stehen als CSV, weil sie immer gemeinsam
     * gelesen und geprüft werden — `leseUpdateStunden` in
     * `server/marktradar-news.js` ist die eine Stelle, die sie auslegt.
     */
    await addColumnIfNotExists('settings', 'radarNewsUpdates', (t) => t.integer('radarNewsUpdates').defaultTo(0))
    await addColumnIfNotExists('settings', 'radarNewsUpdateStunden', (t) => t.text('radarNewsUpdateStunden').defaultTo('18,21'))
    // Ganzer Bericht in der Benachrichtigungs-Mail statt nur der Gesamtlage.
    // Vorgabe aus: eine Mail, die man nicht angefordert hat, soll nicht
    // zwanzig Absätze lang sein — wer sie lesen will, schaltet sie ein.
    await addColumnIfNotExists('settings', 'radarNewsMailVoll', (t) => t.integer('radarNewsMailVoll').defaultTo(0))
    /*
     * Dieselbe Frage als dreistufige Wahl statt Schalter: Kurz (nur Gesamtlage),
     * Mittel (dazu Marktstand und Kapitel-Lage, ohne einzelne Meldungen) und
     * Ganz (alles, wie bisher). `radarNewsMailVoll` bleibt als Spalte stehen,
     * die einmalige Übernahme unten trägt ihren Wert in die neue Spalte über.
     */
    await addColumnIfNotExists('settings', 'radarNewsMailInhalt', (t) => t.text('radarNewsMailInhalt').defaultTo('kurz'))
    {
        const mailZeile = await knex('settings').where('id', 1)
            .select('radarNewsMailVoll', 'radarNewsMailInhalt').first()
        if (mailZeile && Number(mailZeile.radarNewsMailVoll) === 1 && mailZeile.radarNewsMailInhalt === 'kurz') {
            await knex('settings').where('id', 1).update({ radarNewsMailInhalt: 'voll' })
        }
    }
    // Versand des Lageberichts: eigener Schalter und eigene Empfängerliste,
    // damit die Nachrichten-Post nicht am allgemeinen Benachrichtigungs-Empfänger
    // hängt — mehrere Leser sind hier der Normalfall, sonst nirgends.
    await addColumnIfNotExists('settings', 'radarNewsMailAktiv', (t) => t.integer('radarNewsMailAktiv').defaultTo(0))
    await addColumnIfNotExists('settings', 'radarNewsMailAn', (t) => t.text('radarNewsMailAn').defaultTo(''))

    /*
     * Einmalige Übernahme: Wer den Lagebericht bisher per Mail bekam, bekommt
     * ihn weiter.
     *
     * Die Entscheidung stand bis jetzt in `settings.benachrichtigungen` unter
     * `lageberichtFertig.email`; ab jetzt steht sie in `radarNewsMailAktiv`.
     * Ohne diesen Schritt fiele der Versand beim Umstieg still aus — und ein
     * ausbleibender Bericht ist genau die Art Fehler, die man erst nach Tagen
     * bemerkt und dann am SMTP-Zugang sucht.
     *
     * Läuft nur, solange der neue Schalter noch auf der Vorgabe steht: Wer ihn
     * bewusst ausgeschaltet hat, soll das behalten.
     */
    const mailZeile = await knex('settings').where('id', 1)
        .select('benachrichtigungen', 'radarNewsMailAktiv').first()
    if (mailZeile && Number(mailZeile.radarNewsMailAktiv ?? 0) === 0) {
        let alteWahl = {}
        try {
            const roh = mailZeile.benachrichtigungen
            alteWahl = typeof roh === 'string' ? JSON.parse(roh || '{}') : (roh || {})
        } catch { alteWahl = {} }
        if (alteWahl?.lageberichtFertig?.email === true) {
            await knex('settings').where('id', 1).update({ radarNewsMailAktiv: 1 })
            console.log(' -> Einstellungen: Mail-Versand des Lageberichts übernommen (jetzt unter KI → Nachrichten)')
        }
    }
    // Aufbewahrung der BERICHTE (nicht der Rohbeiträge, die haben ihre eigenen
    // 30 Tage). Vorgabe „manuell": ein Bericht ist bezahlte Arbeit, und was
    // automatisch verschwindet, verschwindet irgendwann auch ungelegen.
    await addColumnIfNotExists('settings', 'radarNewsBerichtAufbewahrung',
        (t) => t.text('radarNewsBerichtAufbewahrung').defaultTo('manuell'))   // manuell|tag|woche|monat
    // Zeithorizont des Chartanalyse-Kapitels: steuert, wie alt die Fundstellen
    // sein dürfen UND welchen Horizont die Frage verlangt.
    await addColumnIfNotExists('settings', 'radarNewsChartFrische',
        (t) => t.text('radarNewsChartFrische').defaultTo('woche'))            // tag|woche|monat
    // Der Ruhe-Filter (bis 24.08.2026 „Arschlochfilter"): Truth Social
    // automatisch plus frei wählbare Stichwörter (eines je Zeile). Er wirkt
    // auf Liste UND Berichtsgrundlage, aber nicht beim Abruf — die Beiträge
    // bleiben gespeichert, damit eine geänderte Wörterliste rückwirkend
    // greift. Der Sammelschalter `radarNewsQuellenAusschluss` („Temporär
    // ausschliessen") ist davon getrennt und wirkt schon beim Abruf.
    await addColumnIfNotExists('settings', 'radarNewsRuheAn', (t) => t.integer('radarNewsRuheAn').defaultTo(1))
    await addColumnIfNotExists('settings', 'radarNewsRuheWoerter', (t) => t.text('radarNewsRuheWoerter').defaultTo('Donald Trump\nMichael Saylor'))
    // X-Suche läuft über die xAI Responses API — Modellname drifted, daher Feld.
    // Grok holt die X-Posts nur ab, zusammengefasst wird hier — dafür reicht das
    // günstigere Modell (1,25 statt 2 USD je Mio. Eingabe-Token).
    await addColumnIfNotExists('settings', 'radarNewsXModell', (t) => t.text('radarNewsXModell').defaultTo('grok-4.3'))
    // Guthaben-Status je KI-Anbieter (JSON, nur der Server schreibt hier):
    // „letzter Aufruf scheiterte an fehlendem Guthaben" — mehr geben die
    // Anbieter über den normalen API-Key nicht her.
    await addColumnIfNotExists('settings', 'aiQuotaStatus', (t) => t.text('aiQuotaStatus').defaultTo('{}'))
    // Anbieter und Modell je KI-Funktion. Leer = der global eingestellte
    // Anbieter. Vorher hatte nur der Lagebericht diese Wahl, alles andere hing
    // am globalen Feld — wer den Agenten auf ein günstiges Modell stellen
    // wollte, musste damit auch die Trade-Berichte umstellen.
    await addColumnIfNotExists('settings', 'aiBerichtProvider', (t) => t.text('aiBerichtProvider').defaultTo(''))
    await addColumnIfNotExists('settings', 'aiBerichtModell', (t) => t.text('aiBerichtModell').defaultTo(''))
    await addColumnIfNotExists('settings', 'aiAgentProvider', (t) => t.text('aiAgentProvider').defaultTo(''))
    await addColumnIfNotExists('settings', 'aiAgentModell', (t) => t.text('aiAgentModell').defaultTo(''))
    // Token-Budget je Agent-Lauf (Summe über alle Runden). Stand vorher hart
    // auf 80000 im Quelltext — wer tiefere Analysen will, zahlt bewusst mehr.
    await addColumnIfNotExists('settings', 'aiAgentTokenBudget', (t) => t.integer('aiAgentTokenBudget').defaultTo(80000))
    // Agent-Chats archivieren statt löschen — wie bei den Live-Sessions.
    await addColumnIfNotExists('ai_agent_sessions', 'archiviert', (t) => t.integer('archiviert').defaultTo(0))
    await addColumnIfNotExists('settings', 'aiStrategieProvider', (t) => t.text('aiStrategieProvider').defaultTo(''))
    await addColumnIfNotExists('settings', 'aiStrategieModell', (t) => t.text('aiStrategieModell').defaultTo(''))
    // Perplexity-Modell der Themen-Recherche; stand vorher hart im Quelltext.
    await addColumnIfNotExists('settings', 'radarNewsRechercheModell', (t) => t.text('radarNewsRechercheModell').defaultTo('sonar'))
    await addColumnIfNotExists('settings', 'aiKeyPerplexity', (t) => t.text('aiKeyPerplexity').defaultTo(''))
    /*
     * Stellschrauben des Lageberichts, die vorher fest im Quelltext standen.
     * Überall bedeutet 0 bzw. leer: „wie bisher" — die Vorgabe der gewählten
     * Länge gilt weiter, niemand muss etwas einstellen, damit es läuft.
     */
    await addColumnIfNotExists('settings', 'radarNewsTokenBudget', (t) => t.integer('radarNewsTokenBudget').defaultTo(0))
    await addColumnIfNotExists('settings', 'radarNewsPunkte', (t) => t.integer('radarNewsPunkte').defaultTo(0))
    // Wie ausführlich eine EINZELNE Meldung ausfällt — die Länge regelt nur,
    // wie viele es sind. Vorgabe `normal` ist wörtlich der Text, der vorher
    // fest im Prompt stand: Bestandsberichte ändern sich um kein Zeichen.
    await addColumnIfNotExists('settings', 'radarNewsMeldungsTiefe', (t) => t.text('radarNewsMeldungsTiefe').defaultTo('normal'))   // knapp|normal|ausfuehrlich
    await addColumnIfNotExists('settings', 'radarNewsVideoTiefe', (t) => t.text('radarNewsVideoTiefe').defaultTo('normal'))   // knapp|normal|ausfuehrlich
    await addColumnIfNotExists('settings', 'radarNewsVideoTokens', (t) => t.integer('radarNewsVideoTokens').defaultTo(0))
    // dossier = Tabellen, Kennzahlen und Bilder (Vorgabe) · kombiniert =
    // Aufmacher als Kachel + Rest als Artikel · artikel = reine Zeitung ohne
    // Kacheln · kacheln = alles als Karte, wie vor dem Umbau
    await addColumnIfNotExists('settings', 'radarNewsLayout', (t) => t.text('radarNewsLayout').defaultTo('dossier'))
    // Eigene Anweisungen an die Berichts-KI (Ton, Schwerpunkte, Ausschlüsse).
    // Leer = Bericht wie gehabt; der Server deckelt bei ZUSATZ_MAX Zeichen.
    await addColumnIfNotExists('settings', 'radarNewsPromptZusatz', (t) => t.text('radarNewsPromptZusatz').defaultTo(''))

    /*
     * Fokus-Filter: das Gegenstück zum Ruhe-Filter. Der schliesst aus, der
     * hier lässt nur durch, was mindestens eines der Stichwörter trifft — leer
     * heisst „kein Fokus", nicht „nichts durchlassen".
     */
    await addColumnIfNotExists('settings', 'radarNewsFokusAn', (t) => t.integer('radarNewsFokusAn').defaultTo(0))
    await addColumnIfNotExists('settings', 'radarNewsFokusWoerter', (t) => t.text('radarNewsFokusWoerter').defaultTo(''))
    // Id des zuletzt angewendeten News-Profils — nur für die Anzeige im
    // Dropdown, keine Spalte, von der Erzeugungslogik selbst abhängt.
    await addColumnIfNotExists('settings', 'radarNewsAktivesProfil', (t) => t.integer('radarNewsAktivesProfil').defaultTo(0))

    /*
     * Umbenennung 24.08.2026: „Arschlochfilter" heisst jetzt „Ruhe-Filter",
     * und alle drei Spalten rücken unter das radarNews-Präfix, damit die
     * Profil-Feldliste (`news-profil-felder.js`) sie ohne Sonderfall erfasst.
     * Werte einmalig übernehmen, alte Spalten entfernen. Gespeicherte
     * News-Profile tragen dieselben Schlüssel in ihrem JSON — die ziehen mit
     * um, sonst griffe ein angewendetes Altprofil für diese Felder ins Leere.
     */
    const RUHE_UMZUG = [
        ['radarArschlochfilter', 'radarNewsQuellenAusschluss'],
        ['radarArschlochAn', 'radarNewsRuheAn'],
        ['radarArschlochWoerter', 'radarNewsRuheWoerter'],
    ]
    for (const [alt, neu] of RUHE_UMZUG) {
        if (!(await knex.schema.hasColumn('settings', alt))) continue
        const zeile = await knex('settings').select(alt).where('id', 1).first()
        if (zeile && zeile[alt] !== null && zeile[alt] !== undefined) {
            await knex('settings').where('id', 1).update({ [neu]: zeile[alt] })
        }
        await knex.schema.alterTable('settings', (t) => t.dropColumn(alt))
        console.log(` -> Einstellungen: ${alt} → ${neu} übernommen`)
    }
    if (await knex.schema.hasTable('news_profile')) {
        const profile = await knex('news_profile').select('id', 'einstellungen')
        for (const p of profile) {
            let e
            try { e = JSON.parse(p.einstellungen || '{}') } catch { continue }
            let geaendert = false
            for (const [alt, neu] of RUHE_UMZUG) {
                if (!(alt in e)) continue
                if (!(neu in e)) e[neu] = e[alt]
                delete e[alt]
                geaendert = true
            }
            if (geaendert) {
                await knex('news_profile').where('id', p.id)
                    .update({ einstellungen: JSON.stringify(e) })
            }
        }
    }


    /*
     * Benannte Sammlungen aller Nachrichten-Einstellungen (siehe
     * `news-profil-felder.js` für die Feldliste). `einstellungen` und
     * `quellen` sind bewusst JSON-Blobs statt eigener Spalten je Feld — bei
     * ~30 Feldern wäre jede künftige Erweiterung sonst eine Spalte an ZWEI
     * Stellen (settings UND news_profile). Gleiches Muster wie
     * `strategy_instances.params`.
     */
    if (!(await knex.schema.hasTable('news_profile'))) {
        await knex.schema.createTable('news_profile', (t) => {
            t.increments('id').primary()
            t.text('name').notNullable()
            t.text('einstellungen').defaultTo('{}')
            t.text('quellen').defaultTo('{}')
            t.bigInteger('erstelltAm').defaultTo(0)
            t.bigInteger('aktualisiertAm').defaultTo(0)
        })
        console.log(' -> Created table: news_profile')

        // Startprofil aus dem, was gerade live steht — sonst ist das Dropdown
        // nach einem Update leer, obwohl der Nutzer längst etwas eingestellt hat.
        try {
            const { NEWS_PROFIL_FELDER } = await import('./news-profil-felder.js')
            const zeile = await knex('settings').where('id', 1).first()
            if (zeile) {
                const einstellungen = {}
                for (const feld of NEWS_PROFIL_FELDER) einstellungen[feld] = zeile[feld] ?? null
                const quellenZeilen = await knex('news_sources').select('id', 'name', 'enabled', 'laerm')
                const quellen = {}
                for (const q of quellenZeilen) quellen[q.id] = { name: q.name, enabled: q.enabled, laerm: q.laerm }
                const jetzt = Date.now()
                await knex('news_profile').insert({
                    name: 'Standard',
                    einstellungen: JSON.stringify(einstellungen),
                    quellen: JSON.stringify(quellen),
                    erstelltAm: jetzt,
                    aktualisiertAm: jetzt,
                })
                console.log(' -> Startprofil "Standard" aus aktuellen Einstellungen angelegt')
            }
        } catch (e) {
            console.log(` -> Startprofil konnte nicht angelegt werden: ${e.message}`)
        }
    }

    // Kapitel je Thema; `punkte` bleibt als flache Liste für Altleser bestehen.
    await addColumnIfNotExists('news_digests', 'kapitel', (t) => t.text('kapitel').defaultTo('[]'))
    // Marktstand zum Zeitpunkt des Berichts (Fear&Greed, Dominanz, Funding …)
    // als JSON-Zeilen. Der Bericht bekam diese Zahlen schon immer in den
    // Prompt; gespeichert werden sie, damit die Dossier-Ansicht sie als
    // Tabelle zeigen kann — und zwar den Stand von damals, nicht den von jetzt.
    await addColumnIfNotExists('news_digests', 'marktBlock', (t) => t.text('marktBlock').defaultTo('[]'))
    // Abwägung des Berichts: was stützt, was belastet, woran es sich
    // entscheidet — je Zeile mit der Marke Fakt/Einschätzung. Leer bei
    // Berichten aus der Zeit davor.
    await addColumnIfNotExists('news_digests', 'lagebild', (t) => t.text('lagebild').defaultTo(''))
    await addColumnIfNotExists('news_digests', 'themen', (t) => t.text('themen').defaultTo(''))
    await addColumnIfNotExists('news_digests', 'laenge', (t) => t.text('laenge').defaultTo(''))

    // Anspruch auf periodische Aufgaben. Alle übrigen Sperren im Projekt sind
    // prozesslokal; NAS-Container und Entwicklungsserver teilen sich aber
    // dieselbe Datenbank. Hierüber schreibt nur einer von beiden.
    if (!(await knex.schema.hasTable('radar_fetch_state'))) {
        await knex.schema.createTable('radar_fetch_state', (t) => {
            t.string('key').primary()
            t.bigInteger('fetchedAt').defaultTo(0)
            t.text('claimedBy').defaultTo('')
            t.text('lastError').defaultTo('')
            t.bigInteger('updatedAt').defaultTo(0)
        })
        console.log(' -> Created table: radar_fetch_state')
    }

    // ── Coin-Rangliste ───────────────────────────────────────────────────

    // Welche Münzen kommen für einen Rangliste-Lauf in Frage.
    //
    // `bitunix` und `top` speichern BEWUSST keine Symbolliste: sie wird bei
    // jedem Laufstart neu aufgelöst. Eine gespeicherte Liste würde still
    // veralten, und niemand merkte, dass die „Top 100" von vor drei Monaten
    // gemeint sind. Nur von Hand gepflegte und von der KI vorgeschlagene Listen
    // sind echte Inhalte — sie stehen deshalb auch als einzige im Backup.
    if (!(await knex.schema.hasTable('coin_universen'))) {
        await knex.schema.createTable('coin_universen', (t) => {
            t.increments('id').primary()
            t.text('name').notNullable()
            t.text('art').defaultTo('manuell')       // bitunix | top | manuell | ki
            t.integer('n').defaultTo(0)              // nur art='top': wie viele nach Marktkapitalisierung
            t.text('symbole').defaultTo('[]')        // JSON, nur manuell/ki
            t.text('thema').defaultTo('')            // nur ki: „RWA", „Meme"
            t.text('begruendung').defaultTo('')      // nur ki: warum diese Auswahl
            t.text('provider').defaultTo('')
            t.text('modell').defaultTo('')
            t.double('kostenUsd').defaultTo(0)
            // 1 = nur Coins, die auf Bitunix auch handelbar sind (Vorgabe).
            // 0 = auch reine Vergleichswerte mit Historie, aber ohne Markt.
            t.integer('nurHandelbar').defaultTo(1)
            t.bigInteger('createdAt').defaultTo(0)
            t.bigInteger('updatedAt').defaultTo(0)
        })
        console.log(' -> Created table: coin_universen')
    }

    // Ein Rangliste-Lauf: eine Strategie über viele Coins.
    //
    // Der Lauf dauert Minuten und überlebt Neustarts — deshalb liegt sein
    // gesamter Zustand hier und nicht im Speicher. `symbole` ist die zum
    // STARTZEITPUNKT aufgelöste Liste: ohne diese Kopie wäre ein alter Lauf
    // nicht mehr erklärbar, sobald sich das Universum ändert. Aus demselben
    // Grund werden Parameter, Hebeldeckel und die Begründung der Zeiteinheit
    // mitgeschrieben statt später nachgeschlagen.
    if (!(await knex.schema.hasTable('rangliste_laeufe'))) {
        await knex.schema.createTable('rangliste_laeufe', (t) => {
            t.increments('id').primary()
            t.text('strategyId').notNullable()
            t.integer('instanceId').defaultTo(0)
            t.integer('ruleVersion').defaultTo(0)
            t.integer('universumId').defaultTo(0)
            t.text('universumName').defaultTo('')
            t.text('symbole').defaultTo('[]')          // JSON, aufgelöst beim Start
            t.text('timeframe').defaultTo('')
            t.text('timeframeQuelle').defaultTo('')    // uebernommen | bestanden | instanz | hand
            t.text('timeframeBegruendung').defaultTo('')
            t.text('market').defaultTo('futures')
            t.bigInteger('fromTs').defaultTo(0)
            t.bigInteger('mitteTs').defaultTo(0)       // Grenze zwischen Rang- und Prüfhälfte
            t.bigInteger('toTs').defaultTo(0)
            t.text('params').defaultTo('{}')
            t.text('risk').defaultTo('{}')
            t.double('maxLeverage').defaultTo(0)
            t.double('startEquity').defaultTo(1000)
            // wartet | laeuft | pausiert | fertig | abgebrochen | fehler
            t.text('status').defaultTo('wartet')
            t.integer('fortschritt').defaultTo(0)
            t.integer('gesamt').defaultTo(0)
            // Der Nutzer setzt es, die Schleife liest es nach jedem Coin.
            t.integer('abbruchGewuenscht').defaultTo(0)
            t.text('gehaltenVon').defaultTo('')        // INSTANZ_ID des Bearbeiters
            t.text('letzterFehler').defaultTo('')
            t.integer('abrufeGesamt').defaultTo(0)
            t.integer('gewichtGesamt').defaultTo(0)
            t.text('nullverteilung').defaultTo('')     // JSON, einmal am Ende
            t.bigInteger('gestartetAm').defaultTo(0)
            t.bigInteger('beendetAm').defaultTo(0)
            t.bigInteger('createdAt').defaultTo(0)
            t.index('status', 'idx_rangliste_status')
            t.index('strategyId', 'idx_rangliste_strategyId')
        })
        console.log(' -> Created table: rangliste_laeufe')
    }

    // Ein Coin innerhalb eines Laufs — beide Hälften nebeneinander.
    //
    // `unique(laufId, symbol)` ist der WIEDERAUFNAHME-Schlüssel: geschrieben
    // wird mit `onConflict(...).merge()`, und „was fehlt noch?" ist damit
    // schlicht „welche Symbole haben keine Zeile". Stirbt der Prozess mitten im
    // Lauf, nimmt der nächste Takt genau dort wieder auf, ohne eine einzige
    // Sonderbehandlung.
    //
    // `rReiheA` trägt die R-Werte der Rang-Hälfte. Sie sind die Grundlage der
    // Nullverteilung — der Frage, wie gut die Rangliste allein durch Zufall
    // ausgesehen hätte. Ohne sie müsste man dafür alles neu rechnen.
    if (!(await knex.schema.hasTable('rangliste_zeilen'))) {
        await knex.schema.createTable('rangliste_zeilen', (t) => {
            t.increments('id').primary()
            t.integer('laufId').notNullable()
            t.text('symbol').notNullable()
            // belastbar | zu_wenig_trades | datenluecke | ohne_daten | fehler
            t.text('klasse').defaultTo('')
            t.integer('rangA').defaultTo(0)

            t.integer('aTrades').defaultTo(0)
            t.double('aWinRate').defaultTo(0)
            t.double('aExpectancyR').defaultTo(0)
            t.double('aOhneTopR').defaultTo(0)
            t.double('aProfitFactor').nullable()
            t.double('aReturnPct').defaultTo(0)
            t.double('aMaxDdPct').defaultTo(0)

            t.integer('bTrades').defaultTo(0)
            t.double('bWinRate').defaultTo(0)
            t.double('bExpectancyR').defaultTo(0)
            t.double('bOhneTopR').defaultTo(0)
            t.double('bProfitFactor').nullable()
            t.double('bReturnPct').defaultTo(0)
            t.double('bMaxDdPct').defaultTo(0)

            t.integer('bestaetigt').defaultTo(0)
            t.integer('kerzen').defaultTo(0)
            t.double('abdeckungPct').defaultTo(0)
            t.text('fehlend').defaultTo('[]')          // JSON: ['Anfang'] = spätes Listing
            t.bigInteger('historieAb').defaultTo(0)
            t.integer('handelbar').defaultTo(1)
            t.integer('bitunixMaxLeverage').defaultTo(0)
            t.text('rReiheA').defaultTo('[]')          // JSON, auf 300 Werte gekappt
            t.text('fehler').defaultTo('')
            t.integer('dauerMs').defaultTo(0)
            t.bigInteger('createdAt').defaultTo(0)
            t.unique(['laufId', 'symbol'])
            t.index('laufId', 'idx_rangliste_zeilen_lauf')
        })
        console.log(' -> Created table: rangliste_zeilen')
    }

    /*
     * ==================== LIVE-SITZUNGEN ====================
     *
     * Eine Zeile je Handelssitzung im Live-Trading-Fenster: wann, welcher
     * Markt, welcher Plan — und hinterher, was daraus geworden ist.
     *
     * `trades` wird beim Beenden EINGEFROREN statt zur Lesezeit aus dem
     * Journal geholt. Journal-Trades liegen als Tageszeilen mit JSON-Array;
     * ein Zeitfenster dagegen zu schneiden ist brüchig, und ein erneuter
     * Import aus Bitunix verschiebt die Zahlen nachträglich. Der Schnappschuss
     * bewahrt, WAS MAN DAMALS SAH. `startUnix`/`endUnix` bleiben trotzdem
     * stehen — daraus lässt sich jederzeit neu rechnen und der Link in die
     * Wiedergabe der Bookmap bauen.
     */
    if (!(await knex.schema.hasTable('live_sessions'))) {
        await knex.schema.createTable('live_sessions', (t) => {
            t.increments('id').primary()
            t.bigInteger('startUnix').notNullable()
            t.bigInteger('endUnix').defaultTo(0)          // 0 = läuft noch
            t.string('symbol').defaultTo('')
            t.string('market').defaultTo('futures')
            t.string('status').defaultTo('laufend')       // laufend | beendet | abgebrochen
            // Der Plan wird VOR der Sitzung gefasst — das ist der ganze Sinn
            t.float('planMaxVerlustUsd').defaultTo(0)
            t.integer('planMaxTrades').defaultTo(0)
            t.text('planNotiz').defaultTo('')
            t.text('notizen').defaultTo('')
            t.text('fazit').defaultTo('')
            t.text('protokoll').defaultTo('[]')           // JSON [{t, art, text, daten}]
            t.text('kacheln').defaultTo('{}')             // JSON: Layout-Schnappschuss
            t.text('trades').defaultTo('[]')              // JSON, beim Beenden eingefroren
            t.float('pnlUsd').defaultTo(0)
            t.integer('tradeAnzahl').defaultTo(0)
            t.integer('planVerletzt').defaultTo(0)
            // ZWINGEND `timestamp`, nicht bigInteger: die generische CRUD-Route
            // setzt `updatedAt` beim Schreiben auf CURRENT_TIMESTAMP. Gegen eine
            // bigint-Spalte lehnt PostgreSQL das ab (42804) — jedes Speichern
            // schlägt fehl. Alle anderen Tabellen an dieser Route halten es so.
            // Die fachlichen Zeitpunkte stehen weiter in startUnix/endUnix.
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.index(['startUnix'], 'idx_livesession_start')
            t.index(['status'], 'idx_livesession_status')
        })
        console.log(' -> Created table: live_sessions')
    }

    /*
     * Archiv. Nach ein paar Wochen sind es zu viele Sitzungen, um die letzten
     * fünf noch zu finden — aber löschen will man sie nicht: die Bilanz über die
     * Disziplin lebt davon, dass alle drinstehen. Deshalb ein Schalter statt
     * eines Papierkorbs. Archivierte Sitzungen zählen weiter in die Bilanz, sie
     * sind nur aus der Liste geräumt.
     */
    await addColumnIfNotExists('live_sessions', 'archiviert', (t) => t.integer('archiviert').defaultTo(0))

    /*
     * Gebühren und Funding der Sitzung, beim Abschluss eingefroren.
     *
     * `pnlUsd` ist die realisierte P&L, wie sie die laufende Kachel zeigt —
     * bei Bitunix ist das `realizedPNL`, also bereits ohne Handelsgebühr, aber
     * OHNE Funding. Ohne diese beiden Spalten liesse sich im Archiv nicht mehr
     * nachvollziehen, was an einem Ergebnis Handel und was Kosten war; und die
     * Frage, ob eine Sitzung an der Richtung oder an der Gebühr gescheitert
     * ist, stellt sich bei Skalpsitzungen regelmässig.
     */
    await addColumnIfNotExists('live_sessions', 'gebuehrenUsd', (t) => t.float('gebuehrenUsd').defaultTo(0))
    await addColumnIfNotExists('live_sessions', 'fundingUsd', (t) => t.float('fundingUsd').defaultTo(0))

    /*
     * Nachzug für Datenbanken, die die erste Fassung dieser Tabelle bekommen
     * haben: dort waren createdAt/updatedAt als bigInteger angelegt, wodurch
     * jedes Speichern am Typkonflikt scheiterte (siehe oben). Nur die beiden
     * Spalten werden getauscht — die Sitzungsdaten selbst bleiben stehen.
     */
    if (await knex.schema.hasTable('live_sessions')) {
        const spalten = await knex('live_sessions').columnInfo()
        if (spalten.updatedAt && /int/i.test(String(spalten.updatedAt.type))) {
            await knex.schema.alterTable('live_sessions', (t) => {
                t.dropColumn('createdAt')
                t.dropColumn('updatedAt')
            })
            await knex.schema.alterTable('live_sessions', (t) => {
                t.timestamp('createdAt').defaultTo(knex.fn.now())
                t.timestamp('updatedAt').defaultTo(knex.fn.now())
            })
            console.log(' -> live_sessions: createdAt/updatedAt auf timestamp umgestellt')
        }
    }

    /*
     * Anzeigewährung für KI-Kosten. Die Anbieter rechnen in USD; angezeigt
     * wurde CHF mit einem Faktor, der an sechs Stellen im Quelltext stand.
     * Bewusst ein fester Faktor und kein Kursdienst: die Beträge sind ohnehin
     * Schätzungen aus Listenpreisen, ein tagesaktueller Kurs wäre
     * Scheingenauigkeit. Faktor 0 oder leer heisst „in USD anzeigen".
     */
    await addColumnIfNotExists('settings', 'waehrungCode', (t) => t.text('waehrungCode').defaultTo('CHF'))
    await addColumnIfNotExists('settings', 'waehrungFaktor', (t) => t.double('waehrungFaktor').defaultTo(0.8))

    // ── Coin-Radar ───────────────────────────────────────────────────────

    /*
     * Ein Lauf: das ganze handelbare Universum einmal durchgesehen.
     *
     * Der Zustand steht in der Datenbank und nicht im Speicher — ein Lauf
     * dauert Minuten und muss einen Neustart überleben. Dasselbe Muster wie
     * bei der Coin-Rangliste, aus demselben Grund.
     */
    if (!(await knex.schema.hasTable('coinradar_laeufe'))) {
        await knex.schema.createTable('coinradar_laeufe', (t) => {
            t.increments('id').primary()
            t.bigInteger('erstelltAm').notNullable()
            t.bigInteger('beendetAm').defaultTo(0)
            t.string('status').defaultTo('wartet')   // wartet|laeuft|fertig|abgebrochen|fehler
            t.string('ausloeser').defaultTo('auto')  // auto | manuell
            t.text('zeiteinheiten').defaultTo('[]')  // JSON, z.B. ["1h","15m"]
            t.integer('gesamt').defaultTo(0)         // Symbole nach den Hürden
            t.integer('fortschritt').defaultTo(0)
            t.integer('geprueft').defaultTo(0)       // Symbole im Universum
            t.integer('verworfenHuerde').defaultTo(0)
            /*
             * Die ehrliche Gegenprobe: Wie gut sagte der vorige Lauf diesen
             * voraus? Nahe null heisst, die Rangfolge ist Rauschen — und dann
             * soll die Seite das sagen, statt eine Liste zu zeigen, die
             * überzeugend aussieht.
             */
            t.double('rangkorrelation').defaultTo(0)
            t.integer('vergleichslauf').defaultTo(0)
            t.text('einordnung').defaultTo('')       // kurzer KI-Text
            t.double('kostenUsd').defaultTo(0)
            t.text('quellenStand').defaultTo('{}')   // JSON
            t.text('fehler').defaultTo('')
            t.index(['erstelltAm'], 'idx_coinradar_zeit')
        })
        console.log(' -> Created table: coinradar_laeufe')
    }

    /*
     * Ein Coin je Lauf. `unique(laufId, symbol)` ist nicht bloss Hygiene,
     * sondern die Wiederaufnahme: „was fehlt noch" heisst „welches Symbol hat
     * keine Zeile". Ein abgebrochener Lauf setzt damit dort fort, wo er stand.
     */
    if (!(await knex.schema.hasTable('coinradar_zeilen'))) {
        await knex.schema.createTable('coinradar_zeilen', (t) => {
            t.increments('id').primary()
            t.integer('laufId').notNullable()
            t.string('symbol').notNullable()
            t.integer('note').defaultTo(0)           // 0–100
            t.integer('rang').defaultTo(0)
            t.string('status').defaultTo('bewertet') // bewertet | huerde
            t.text('huerdeGrund').defaultTo('')      // umsatz_zu_klein | spread_zu_weit …
            // Rohwerte — damit die Note nachrechenbar bleibt
            t.double('umsatz24h').defaultTo(0)
            t.double('spreadBp').defaultTo(0)
            t.double('tiefeUsd').defaultTo(0)
            t.double('fundingJahresRate').defaultTo(0)
            t.double('atrPct').defaultTo(0)
            t.double('rvol').defaultTo(0)
            t.double('adx').defaultTo(0)
            t.text('jeZeiteinheit').defaultTo('{}')  // JSON: Kennzahlen je Zeiteinheit
            t.text('teilnoten').defaultTo('{}')      // JSON: bewegung/imSpiel/trend/kosten
            /*
             * Zwei Achsen statt einer Note (Audit R-07).
             *
             * „Gut ausführbar" und „interessante Marktphase" sind zwei Fragen.
             * In eine Zahl gepresst sieht ein wilder Coin mit teurem Buch aus
             * wie ein ruhiger mit billigem — und genau die Verwechslung kostet
             * Geld. `note` bleibt die Gelegenheit; die Ausführung steht daneben.
             */
            t.integer('noteAusfuehrung')            // 0–100, null = nicht gemessen
            t.string('besteBoerse').defaultTo('')   // wo die Ausführung am besten ist
            t.double('rundlaufBp')                  // Ein- und Ausstieg zusammen
            t.double('slippageKaufBp')
            t.double('slippageVerkaufBp')
            t.double('tiefe25Bp')                   // USD im Buch innerhalb ±25 bp
            t.text('jeBoerse').defaultTo('{}')      // JSON: Messwerte je Börse
            /*
             * Dritte Achse: hängt der Coin an Bitcoin? (4h-Kerzen, ~33 Tage)
             *
             * Wieder OHNE `defaultTo` — aus demselben Grund wie oben, aber mit
             * schärferer Folge: Eine Korrelation von 0 hiesse „bewegt sich
             * unabhängig von BTC" und liesse den Coin im Filter „eigenständig"
             * auftauchen. Für einen Coin ohne genug Historie wäre das eine
             * erfundene Messung an genau der Stelle, an der jemand eine
             * Handelsentscheidung darauf stützt.
             */
            t.double('btcKorrelation')              // −1 … +1, null = nicht gemessen
            t.double('btcBeta')                     // Ausschlag je 1 % BTC
            t.integer('btcPunkte')                  // wie viele Renditen dahinterstehen
            t.double('btcKorrelationH1')            // erste Hälfte des Zeitraums
            t.double('btcKorrelationH2')            // zweite Hälfte
            t.double('btcZerfallZ')                 // Fisher-z der Differenz
            t.text('boersen').defaultTo('{}')       // JSON: wo handelbar (+ unbekannt)
            t.bigInteger('erstelltAm').defaultTo(0)
            t.unique(['laufId', 'symbol'], 'uq_coinradar_zeile')
            t.index(['laufId'], 'idx_coinradar_lauf')
        })
        console.log(' -> Created table: coinradar_zeilen')
    }

    /* Einstellungen als Schlüssel-Wert, wie beim Hype-Radar und aus demselben
     * Grund: Gewichte, Hürden und Zeiteinheiten sind Listen und Objekte. */
    if (!(await knex.schema.hasTable('coinradar_settings'))) {
        await knex.schema.createTable('coinradar_settings', (t) => {
            t.increments('id').primary()
            t.string('schluessel').notNullable().unique()
            t.text('wert').defaultTo('')
            t.bigInteger('aktualisiertAm').defaultTo(0)
        })
        console.log(' -> Created table: coinradar_settings')
    }

    /*
     * Ausführungsgüte — nachgereicht für Datenbanken, die vor dem Audit vom
     * 19.08.2026 angelegt wurden. Bewusst OHNE Vorgabewert: `null` heisst hier
     * „nicht gemessen", und eine 0 wäre die Behauptung, die Ausführung sei
     * denkbar schlecht (siehe R-10).
     */
    await addColumnIfNotExists('coinradar_zeilen', 'noteAusfuehrung', (t) => t.integer('noteAusfuehrung'))
    await addColumnIfNotExists('coinradar_zeilen', 'besteBoerse', (t) => t.string('besteBoerse').defaultTo(''))
    await addColumnIfNotExists('coinradar_zeilen', 'rundlaufBp', (t) => t.double('rundlaufBp'))
    await addColumnIfNotExists('coinradar_zeilen', 'slippageKaufBp', (t) => t.double('slippageKaufBp'))
    await addColumnIfNotExists('coinradar_zeilen', 'slippageVerkaufBp', (t) => t.double('slippageVerkaufBp'))
    await addColumnIfNotExists('coinradar_zeilen', 'tiefe25Bp', (t) => t.double('tiefe25Bp'))
    await addColumnIfNotExists('coinradar_zeilen', 'jeBoerse', (t) => t.text('jeBoerse').defaultTo('{}'))

    /*
     * BTC-Vergleich und Börsenlistung (v10). Rein additiv.
     *
     * Altbestand bleibt `null` und wird in der Oberfläche als „—" gezeigt.
     * Nachrechnen liesse sich das zwar — die Kerzen sind abrufbar —, aber
     * nicht für den Zeitraum, in dem der alte Lauf stattfand; die Zahl gehörte
     * dann zu einem anderen Monat als die Zeile, in der sie steht.
     */
    await addColumnIfNotExists('coinradar_zeilen', 'btcKorrelation', (t) => t.double('btcKorrelation'))
    await addColumnIfNotExists('coinradar_zeilen', 'btcBeta', (t) => t.double('btcBeta'))
    await addColumnIfNotExists('coinradar_zeilen', 'btcPunkte', (t) => t.integer('btcPunkte'))
    await addColumnIfNotExists('coinradar_zeilen', 'btcKorrelationH1', (t) => t.double('btcKorrelationH1'))
    await addColumnIfNotExists('coinradar_zeilen', 'btcKorrelationH2', (t) => t.double('btcKorrelationH2'))
    await addColumnIfNotExists('coinradar_zeilen', 'btcZerfallZ', (t) => t.double('btcZerfallZ'))
    await addColumnIfNotExists('coinradar_zeilen', 'boersen', (t) => t.text('boersen').defaultTo('{}'))

    /*
     * Erfolgskontrolle beider Radare (Audit R-06).
     *
     * Der bisher ehrlichste Wert des Coin-Radars ist die Rangkorrelation zum
     * Vorlauf — nur misst die BEHARRLICHKEIT, nicht Nutzen. Eine stabile
     * Rangfolge kann stabil falsch sein, und alle Gewichte und Schwellen
     * beruhen bis heute auf plausiblen Regeln plus Querschnittsmessungen.
     *
     * Diese Tabelle schliesst die Lücke: Zu jedem bewerteten Coin wird
     * festgehalten, was danach WIRKLICH geschah. Erst damit lässt sich fragen,
     * ob die Note etwas taugt — und erst dann ist jede weitere Feinjustierung
     * mehr als Geschmackssache.
     *
     * Bewusst eine Zeile je Horizont statt einer breiten Zeile: Die Messungen
     * fallen zu verschiedenen Zeiten an, und eine offene Zeile ist der
     * einfachste Auftrag für den Takt.
     */
    if (!(await knex.schema.hasTable('radar_ergebnisse'))) {
        await knex.schema.createTable('radar_ergebnisse', (t) => {
            t.increments('id').primary()
            t.string('art').notNullable()            // coinradar | hype
            t.integer('laufId').defaultTo(0)
            t.string('symbol').notNullable()
            t.string('chain').defaultTo('')          // nur beim Hype-Radar
            t.string('contract').defaultTo('')
            // Was die Seite BEHAUPTET hat — eingefroren, damit ein späterer
            // Gewichtswechsel die Vergangenheit nicht umschreibt.
            t.integer('rang').defaultTo(0)
            t.integer('note')
            t.integer('noteAusfuehrung')
            t.integer('safetyScore')
            t.string('horizont').notNullable()       // 15m | 1h | 4h | 1d | 7d | 30d
            t.bigInteger('erstelltAm').notNullable() // Zeitpunkt der Aussage
            t.bigInteger('faelligAm').notNullable()  // wann gemessen werden soll
            t.bigInteger('gemessenAm').defaultTo(0)
            t.string('status').defaultTo('offen')    // offen | gemessen | fehlgeschlagen
            // Was danach geschah. Alles nullable — „nicht gemessen" ist eine
            // eigene Aussage und darf nicht als 0 erscheinen (siehe R-10).
            t.double('preisStart')
            t.double('preisEnde')
            t.double('renditePct')
            t.double('maePct')                       // schlechtester Punkt dazwischen
            t.double('mfePct')                       // bester Punkt dazwischen
            t.double('liquiditaetStart')
            t.double('liquiditaetEnde')
            t.integer('nochHandelbar')               // 1/0/null
            t.text('fehler').defaultTo('')
            t.unique(['art', 'laufId', 'symbol', 'horizont'], 'uq_radar_erg')
            t.index(['status', 'faelligAm'], 'idx_radar_erg_faellig')
        })
        console.log(' -> Created table: radar_ergebnisse')
    }

    // ── KI-Verbrauch ─────────────────────────────────────────────────────

    /*
     * Eine Zeile je KI-Aufruf — die einzige Stelle, an der Verbrauch vollständig
     * steht.
     *
     * Vorher lagen Token und Kosten in acht Tabellen mit drei verschiedenen
     * Namen (`totalTokens`/`tokens`/`aiReviewTotalTokens`, `costUsd`/`kostenUsd`),
     * und nur sechs der siebzehn Verbraucher schrieben überhaupt Kosten: alles,
     * was nicht über `callLLMJson` lief, kannte nur Token. Die Frage „was kostet
     * mich die KI diesen Monat" war damit nicht zu beantworten — nicht schwer,
     * sondern unmöglich.
     *
     * Die alten Spalten bleiben, wo sie sind: sie hängen an ihren Fachobjekten
     * (ein Bericht kennt seine Token) und sind die Historie. Diese Tabelle ist
     * die Buchhaltung daneben, nicht ihr Ersatz.
     *
     * `funktion` ist bewusst eine freie Zeichenkette und keine Fremdschlüssel-
     * beziehung: sie benennt einen Vorgang im Haus („lagebericht", „agent"),
     * und ein neuer Verbraucher soll eine Zeile schreiben können, ohne dass
     * vorher ein Schema wächst.
     */
    if (!(await knex.schema.hasTable('ai_usage'))) {
        await knex.schema.createTable('ai_usage', (t) => {
            t.increments('id').primary()
            t.bigInteger('erstelltAm').notNullable()
            t.string('funktion').notNullable()       // bericht | agent | lagebericht | video …
            t.string('ausloeser').defaultTo('auto')  // auto | manuell
            t.string('provider').defaultTo('')
            t.string('modell').defaultTo('')
            t.integer('promptTokens').defaultTo(0)
            t.integer('completionTokens').defaultTo(0)
            t.integer('totalTokens').defaultTo(0)
            // Bilderzeugung hat keine Token, aber sehr wohl einen Preis —
            // deshalb steht die Kostenspalte nicht von Token abhängig da.
            t.double('kostenUsd').defaultTo(0)
            t.string('bezugTyp').defaultTo('')       // bericht | instanz | digest …
            t.string('bezugId').defaultTo('')
            t.index(['erstelltAm'], 'idx_aiusage_zeit')
            t.index(['funktion'], 'idx_aiusage_funktion')
        })
        console.log(' -> Created table: ai_usage')
    }

    // ── Hype-Radar ───────────────────────────────────────────────────────

    /*
     * Kandidaten eines Suchlaufs.
     *
     * Ein Kandidat ist ein Fund, keine Empfehlung: gesammelt in Stufe 1,
     * bewertet in Stufe 2, in Stufe 3 hart auf Betrugsmuster geprüft. Die
     * verworfenen bleiben bewusst stehen — „warum kam der nicht in den
     * Bericht" ist die Frage, die Vertrauen schafft, und ohne gespeicherten
     * Grund ist sie nicht zu beantworten.
     *
     * Roh-, Bewertungs- und Sicherheitsdaten stehen getrennt, damit die
     * Oberfläche jede Teilnote einzeln aufschlüsseln kann.
     */
    if (!(await knex.schema.hasTable('hype_candidates'))) {
        await knex.schema.createTable('hype_candidates', (t) => {
            t.increments('id').primary()
            t.string('symbol').notNullable()
            t.text('name').defaultTo('')
            t.string('chain').defaultTo('')          // solana | ethereum | base | bsc …
            t.string('contractAddress').defaultTo('')
            t.string('pairAddress').defaultTo('')    // für spätere Nachschläge
            t.string('narrative').defaultTo('')      // ai-agents | rwa | depin | meme …
            t.text('quellen').defaultTo('[]')        // JSON: [{quelle,rang,url,geholtAm}]
            t.text('marktDaten').defaultTo('{}')     // JSON: preis, vol24h, liq, fdv, pairAlter
            t.text('sozialDaten').defaultTo('{}')    // JSON: erwaehnungen, velocity, Teilnoten
            t.text('sicherheitsDaten').defaultTo('{}') // JSON: GoPlus-Rohdaten + Flags
            t.integer('hypeScore').defaultTo(0)      // 0–100
            t.integer('safetyScore').defaultTo(0)    // 0–100
            t.string('status').defaultTo('neu')      // neu | bewertet | bestanden | verworfen | berichtet
            t.text('verworfenGrund').defaultTo('')   // honeypot | lp_offen | liq_zu_klein …
            t.bigInteger('erstelltAm').defaultTo(0)
            t.bigInteger('aktualisiertAm').defaultTo(0)
            t.index(['contractAddress'], 'idx_hype_contract')
            t.index(['erstelltAm'], 'idx_hype_kand_zeit')
        })
        console.log(' -> Created table: hype_candidates')
    }

    /*
     * Berichte. Wie beim Lagebericht strukturiert statt als Textblock: die
     * Oberfläche zeichnet daraus Karten, und ein Markdown-Klumpen liesse sich
     * später weder filtern noch nachrechnen. `aussortiert` gehört fest dazu —
     * ein Bericht, der nur die Treffer zeigt, verschweigt die halbe Arbeit.
     */
    if (!(await knex.schema.hasTable('hype_reports'))) {
        await knex.schema.createTable('hype_reports', (t) => {
            t.increments('id').primary()
            t.bigInteger('erstelltAm').notNullable()
            t.text('ueberschrift').defaultTo('')
            t.text('marktkontext').defaultTo('')     // 2–3 Sätze: welche Narrative laufen
            t.text('kandidaten').defaultTo('[]')     // JSON: Top-N mit Urteil und Belegen
            t.text('aussortiert').defaultTo('[]')    // JSON: [{symbol,grund}]
            t.text('meta').defaultTo('{}')           // JSON: Modelle, Token, Quellen-Zustand
            t.integer('anzahlKandidaten').defaultTo(0)
            t.integer('anzahlAussortiert').defaultTo(0)
            t.double('kostenUsd').defaultTo(0)
            t.string('ausloeser').defaultTo('auto')  // auto | manuell
            t.index(['erstelltAm'], 'idx_hype_bericht_zeit')
        })
        console.log(' -> Created table: hype_reports')
    }

    /*
     * Einstellungen als Schlüssel-Wert-Paare statt als dreissig Spalten.
     *
     * Die Stellschrauben sind Listen und Objekte (Gewichte, Schwellen,
     * Narrative, Rollen-Zuordnung) und ändern sich, solange das Feature reift.
     * Jede davon als Spalte anzulegen hiesse, für jede neue Schraube eine
     * Schema-Änderung zu fahren.
     */
    if (!(await knex.schema.hasTable('hype_settings'))) {
        await knex.schema.createTable('hype_settings', (t) => {
            t.increments('id').primary()
            t.string('schluessel').notNullable().unique()
            t.text('wert').defaultTo('')             // JSON-kodiert
            t.bigInteger('aktualisiertAm').defaultTo(0)
        })
        console.log(' -> Created table: hype_settings')
    }

    /*
     * Favoriten. Ein Fund verschwindet mit dem nächsten Lauf aus der Liste —
     * wer einen Coin im Auge behalten will, heftet ihn hier an. Gespeichert
     * wird die Identität (Symbol, Kette, Vertrag), nicht der damalige Stand:
     * die Livedaten holt die Detailansicht bei jedem Öffnen frisch, ein
     * eingefrorener Preis von letzter Woche wäre schlimmer als keiner.
     */
    if (!(await knex.schema.hasTable('hype_favoriten'))) {
        await knex.schema.createTable('hype_favoriten', (t) => {
            t.increments('id').primary()
            t.string('symbol').notNullable()
            t.text('name').defaultTo('')
            t.string('chain').defaultTo('')
            t.string('contractAddress').defaultTo('')
            t.string('pairAddress').defaultTo('')
            t.string('narrative').defaultTo('')
            t.bigInteger('erstelltAm').defaultTo(0)
            t.unique(['symbol', 'chain'], 'uq_hype_fav')
        })
        console.log(' -> Created table: hype_favoriten')
    }

    /*
     * Alarme auf Favoriten. Der Wachhund vergleicht in seinem Takt den
     * Livestand mit dem letzten und schreibt hier hinein, was auffiel — eine
     * Zeile je Auslösung. Die Zustellung (ntfy/Telegram/Webhook) hängt daran,
     * aber die In-App-Liste ist der Kanal, der nie ausfallen kann.
     */
    if (!(await knex.schema.hasTable('hype_alarme'))) {
        await knex.schema.createTable('hype_alarme', (t) => {
            t.increments('id').primary()
            t.integer('favoritId').notNullable()
            t.string('regel').notNullable()          // preisSprung | liqAbfluss | sicherheit …
            t.string('schwere').defaultTo('info')    // info | warnung | kritisch
            t.text('meldung').defaultTo('')
            t.text('daten').defaultTo('{}')          // JSON: vorher/nachher
            t.integer('gelesen').defaultTo(0)
            t.bigInteger('erstelltAm').defaultTo(0)
            t.index(['favoritId'], 'idx_hypal_fav')
            t.index(['erstelltAm'], 'idx_hypal_zeit')
        })
        console.log(' -> Created table: hype_alarme')
    }

    // Was der Wachhund je Favorit zuletzt gesehen hat — die Vergleichsbasis.
    await addColumnIfNotExists('hype_favoriten', 'letzteDaten', (t) => t.text('letzteDaten').defaultTo('{}'))
    await addColumnIfNotExists('hype_favoriten', 'sicherheitsStand', (t) => t.text('sicherheitsStand').defaultTo('{}'))
    // Stumm heisst: beobachten ja, melden nein. Der Favorit bleibt in der
    // Leiste, nur die Alarme schweigen.
    await addColumnIfNotExists('hype_favoriten', 'stumm', (t) => t.integer('stumm').defaultTo(0))

    /*
     * Favoriten dienen beiden Radaren. Der Wachhund muss unterscheiden können,
     * woher ein Coin kommt: für einen Fund vom dezentralen Markt gibt es ein
     * Handelspaar zum Nachschlagen, für ein Bitunix-Symbol nicht.
     *
     * Steht hier und nicht im Coin-Radar-Block: dieser läuft weiter oben, und
     * auf einer frischen Datenbank gibt es die Tabelle dort noch gar nicht.
     */
    await addColumnIfNotExists('hype_favoriten', 'quelle', (t) => t.string('quelle').defaultTo('hype'))

    /*
     * Schlüssel der Zusatzquellen. GoPlus, DexScreener und GeckoTerminal
     * brauchen keinen — sie stehen hier deshalb nicht. Verschlüsselt wie die
     * KI-Schlüssel; die Oberfläche bekommt sie nur maskiert zurück.
     */
    await addColumnIfNotExists('settings', 'hypeKeyCryptopanic', (t) => t.text('hypeKeyCryptopanic').defaultTo(''))
    await addColumnIfNotExists('settings', 'hypeKeyLunarcrush', (t) => t.text('hypeKeyLunarcrush').defaultTo(''))
    await addColumnIfNotExists('settings', 'hypeKeyCoingecko', (t) => t.text('hypeKeyCoingecko').defaultTo(''))
    // Zustellgeheimnisse des Wachhunds. Die Webhook-Adresse zählt dazu — bei
    // Home Assistant ist die Adresse selbst das Geheimnis.
    await addColumnIfNotExists('settings', 'hypeAlarmNtfyToken', (t) => t.text('hypeAlarmNtfyToken').defaultTo(''))
    await addColumnIfNotExists('settings', 'hypeAlarmTelegramToken', (t) => t.text('hypeAlarmTelegramToken').defaultTo(''))
    await addColumnIfNotExists('settings', 'hypeAlarmWebhookUrl', (t) => t.text('hypeAlarmWebhookUrl').defaultTo(''))

    // Schlüsselspalten der neu aufgenommenen KI-Anbieter (siehe ANBIETER_REG).
    await addColumnIfNotExists('settings', 'aiKeyMoonshot', (t) => t.text('aiKeyMoonshot').defaultTo(''))
    await addColumnIfNotExists('settings', 'aiKeyZai', (t) => t.text('aiKeyZai').defaultTo(''))
    await addColumnIfNotExists('settings', 'aiKeyMinimax', (t) => t.text('aiKeyMinimax').defaultTo(''))

    /*
     * Lern-Karteikasten (Leitner-Prinzip). Zwei Tabellen bewusst getrennt:
     * `quiz_karten` ist der Inhalt (Frage/Antwort), `quiz_fortschritt` ist der
     * Lernzustand (Box, Fälligkeit). Ein Reseed des Starter-Decks über
     * `schluessel` (siehe default-lernkarten.js) darf den Fortschritt nie
     * anfassen — deshalb zwei Tabellen statt einer.
     */
    if (!(await knex.schema.hasTable('quiz_karten'))) {
        await knex.schema.createTable('quiz_karten', (t) => {
            t.increments('id').primary()
            t.string('schluessel').nullable()   // stabiler Key für built-in Karten; null bei eigenen
            t.text('frage').notNullable()
            t.text('antwort').notNullable()
            t.string('kategorie').defaultTo('')
            t.string('herkunft').defaultTo('eigen')   // 'built-in' | 'eigen'
            t.integer('aktiv').defaultTo(1)
            // 1 = App-eigene Grundbegriffe, 2 = vertiefte Konzepte (On-Chain, Derivate-Feinheiten, Risikokennzahlen …)
            t.integer('niveau').defaultTo(1)
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.unique(['schluessel'], 'uq_quiz_karten_schluessel')
        })
        console.log(' -> Created table: quiz_karten')
    }

    if (!(await knex.schema.hasTable('quiz_fortschritt'))) {
        await knex.schema.createTable('quiz_fortschritt', (t) => {
            t.increments('id').primary()
            t.integer('kartenId').notNullable()
            t.integer('box').defaultTo(1)
            t.bigInteger('faelligAm').defaultTo(0)   // unix ms; 0 = sofort fällig
            t.bigInteger('zuletztGesehenAm').defaultTo(0)
            t.integer('richtigStreak').defaultTo(0)
            t.integer('gesamtRichtig').defaultTo(0)
            t.integer('gesamtFalsch').defaultTo(0)
            t.text('historie').defaultTo('[]')
            t.timestamp('createdAt').defaultTo(knex.fn.now())
            t.timestamp('updatedAt').defaultTo(knex.fn.now())
            t.unique(['kartenId'], 'uq_quiz_fortschritt_karte')
            t.index(['faelligAm'], 'idx_quiz_fortschritt_faellig')
        })
        console.log(' -> Created table: quiz_fortschritt')
    }

    // Für Installationen, auf denen quiz_karten schon vor v13 existierte.
    await addColumnIfNotExists('quiz_karten', 'niveau', (t) => t.integer('niveau').defaultTo(1))

    // Starter-Deck nachziehen (nur fehlende Karten, siehe default-lernkarten.js)
    await seedDefaultLernkarten(knex)

    // Modus-Schalter, gleiches Muster wie modusLiveAn/modusResearchAn/modusStrategieAn oben.
    await addColumnIfNotExists('settings', 'modusLernenAn', (t) => t.integer('modusLernenAn').defaultTo(1))

    // ==================== SCHEMA-ANKER ====================
    // Ganz am Ende, damit die Version erst steht, wenn alle Checks durch sind.
    await addColumnIfNotExists('settings', 'schemaVersion', (t) => t.integer('schemaVersion').defaultTo(0))
    const versRow = await knex('settings').select('schemaVersion').where('id', 1).first()
    const dbVersion = Number(versRow?.schemaVersion) || 0
    if (dbVersion > SCHEMA_VERSION) {
        console.warn('\n  ⚠️  WARNUNG: Die Datenbank ist auf Schema-Stand v' + dbVersion + ',')
        console.warn('      dieser Code kennt aber nur v' + SCHEMA_VERSION + '. Ein neuerer Prozess (NAS oder')
        console.warn('      Dev-Rechner) hat das Schema bereits weiterentwickelt — dieser ältere')
        console.warn('      Codestand kann Spalten falsch behandeln. Bitte diesen Stand aktualisieren.\n')
    } else if (dbVersion < SCHEMA_VERSION) {
        await knex('settings').where('id', 1).update({ schemaVersion: SCHEMA_VERSION })
    }
}
