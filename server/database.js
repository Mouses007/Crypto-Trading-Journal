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
    const tables = ['notes', 'trades', 'screenshots', 'satisfactions', 'tags', 'excursions', 'incoming_positions', 'diaries', 'playbooks', 'ai_reports', 'ai_report_messages', 'ai_trade_messages']
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
}
