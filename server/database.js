/**
 * Database initialization with Knex.
 * Supports SQLite (default) and PostgreSQL (optional).
 */
import Knex from 'knex'
import { loadDbConfig } from './db-config.js'
import { seedDefaultTemplates } from './default-templates.js'

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
    const tables = ['notes', 'trades', 'screenshots', 'satisfactions', 'tags', 'excursions', 'incoming_positions', 'diaries', 'playbooks', 'ai_reports', 'ai_report_messages', 'ai_trade_messages', 'live_recordings']
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
    await addColumnIfNotExists('settings', 'aiKeyDeepseek', (t) => t.text('aiKeyDeepseek').defaultTo(''))

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
    await addColumnIfNotExists('settings', 'geminiImageModel', (t) => t.text('geminiImageModel').defaultTo('gemini-2.0-flash-preview-image-generation'))

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
            t.text('exitReason').defaultTo('')          // tp | sl | be | manual | timeout | reverse
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

    // Globale Schalter der Strategie-Agenten (Live-Freigabe und Not-Aus)
    await addColumnIfNotExists('settings', 'strategyLiveEnabled', (t) => t.integer('strategyLiveEnabled').defaultTo(0))
    await addColumnIfNotExists('settings', 'strategyKillSwitch', (t) => t.integer('strategyKillSwitch').defaultTo(0))
    await addColumnIfNotExists('settings', 'strategyMaxLeverage', (t) => t.integer('strategyMaxLeverage').defaultTo(10))
    await addColumnIfNotExists('settings', 'strategyMinPaperTrades', (t) => t.integer('strategyMinPaperTrades').defaultTo(20))
    await addColumnIfNotExists('settings', 'strategyLlmBudgetUsd', (t) => t.float('strategyLlmBudgetUsd').defaultTo(1))
    // Modell-Listen je Anbieter (JSON) — bearbeitbar statt fest im Frontend
    await addColumnIfNotExists('settings', 'aiModels', (t) => t.text('aiModels'))
    // Eigener, OpenAI-kompatibler Anbieter (Groq, OpenRouter, vLLM, LM Studio …)
    await addColumnIfNotExists('settings', 'aiCustomUrl', (t) => t.text('aiCustomUrl'))
    await addColumnIfNotExists('settings', 'aiKeyCustom', (t) => t.text('aiKeyCustom'))
}
