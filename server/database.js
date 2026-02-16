import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DB_PATH = path.join(__dirname, '..', 'tradenote.db')

let db

export function getDb() {
    if (!db) {
        db = new Database(DB_PATH)
        db.pragma('journal_mode = WAL')
        db.pragma('foreign_keys = ON')
        initSchema()
    }
    return db
}

function initSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY DEFAULT 1,
            timeZone TEXT DEFAULT 'Europe/Brussels',
            accounts TEXT DEFAULT '[]',
            tags TEXT DEFAULT '[]',
            apis TEXT DEFAULT '[]',
            layoutStyle TEXT DEFAULT '[]',
            avatar TEXT DEFAULT '',
            createdAt TEXT DEFAULT (datetime('now')),
            updatedAt TEXT DEFAULT (datetime('now'))
        );

        INSERT OR IGNORE INTO settings (id) VALUES (1);

        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dateUnix INTEGER NOT NULL,
            date TEXT,
            executions TEXT DEFAULT '[]',
            trades TEXT DEFAULT '[]',
            blotter TEXT DEFAULT '{}',
            pAndL TEXT DEFAULT '{}',
            cashJournal TEXT DEFAULT '{}',
            openPositions INTEGER DEFAULT 0,
            video TEXT DEFAULT '',
            createdAt TEXT DEFAULT (datetime('now')),
            updatedAt TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS diaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dateUnix INTEGER NOT NULL,
            date TEXT,
            diary TEXT DEFAULT '',
            createdAt TEXT DEFAULT (datetime('now')),
            updatedAt TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS screenshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT DEFAULT '',
            symbol TEXT DEFAULT '',
            side TEXT DEFAULT '',
            originalBase64 TEXT DEFAULT '',
            annotatedBase64 TEXT DEFAULT '',
            original TEXT DEFAULT '',
            annotated TEXT DEFAULT '',
            markersOnly INTEGER DEFAULT 1,
            maState TEXT DEFAULT '{}',
            date TEXT,
            dateUnix INTEGER,
            dateUnixDay INTEGER,
            createdAt TEXT DEFAULT (datetime('now')),
            updatedAt TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS playbooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dateUnix INTEGER,
            date TEXT,
            playbook TEXT DEFAULT '',
            createdAt TEXT DEFAULT (datetime('now')),
            updatedAt TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS satisfactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dateUnix INTEGER NOT NULL,
            tradeId TEXT DEFAULT '',
            satisfaction INTEGER DEFAULT 0,
            createdAt TEXT DEFAULT (datetime('now')),
            updatedAt TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dateUnix INTEGER,
            tradeId TEXT DEFAULT '',
            tags TEXT DEFAULT '[]',
            createdAt TEXT DEFAULT (datetime('now')),
            updatedAt TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dateUnix INTEGER,
            tradeId TEXT DEFAULT '',
            note TEXT DEFAULT '',
            createdAt TEXT DEFAULT (datetime('now')),
            updatedAt TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS excursions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dateUnix INTEGER,
            tradeId TEXT DEFAULT '',
            stopLoss REAL DEFAULT 0,
            maePrice REAL DEFAULT 0,
            mfePrice REAL DEFAULT 0,
            createdAt TEXT DEFAULT (datetime('now')),
            updatedAt TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS bitunix_config (
            id INTEGER PRIMARY KEY DEFAULT 1,
            apiKey TEXT DEFAULT '',
            secretKey TEXT DEFAULT '',
            createdAt TEXT DEFAULT (datetime('now')),
            updatedAt TEXT DEFAULT (datetime('now'))
        );

        INSERT OR IGNORE INTO bitunix_config (id) VALUES (1);

        CREATE TABLE IF NOT EXISTS incoming_positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            positionId TEXT NOT NULL UNIQUE,
            symbol TEXT DEFAULT '',
            side TEXT DEFAULT '',
            entryPrice REAL DEFAULT 0,
            leverage REAL DEFAULT 0,
            quantity REAL DEFAULT 0,
            unrealizedPNL REAL DEFAULT 0,
            markPrice REAL DEFAULT 0,
            playbook TEXT DEFAULT '',
            stressLevel INTEGER DEFAULT 0,
            feelings TEXT DEFAULT '',
            screenshotId TEXT DEFAULT '',
            status TEXT DEFAULT 'open',
            bitunixData TEXT DEFAULT '{}',
            createdAt TEXT DEFAULT (datetime('now')),
            updatedAt TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_incoming_positionId ON incoming_positions(positionId);
        CREATE INDEX IF NOT EXISTS idx_incoming_status ON incoming_positions(status);

        CREATE INDEX IF NOT EXISTS idx_trades_dateUnix ON trades(dateUnix);
        CREATE INDEX IF NOT EXISTS idx_diaries_dateUnix ON diaries(dateUnix);
        CREATE INDEX IF NOT EXISTS idx_screenshots_dateUnix ON screenshots(dateUnix);
        CREATE INDEX IF NOT EXISTS idx_screenshots_dateUnixDay ON screenshots(dateUnixDay);
        CREATE INDEX IF NOT EXISTS idx_playbooks_dateUnix ON playbooks(dateUnix);
        CREATE INDEX IF NOT EXISTS idx_satisfactions_dateUnix ON satisfactions(dateUnix);
        CREATE INDEX IF NOT EXISTS idx_satisfactions_tradeId ON satisfactions(tradeId);
        CREATE INDEX IF NOT EXISTS idx_tags_dateUnix ON tags(dateUnix);
        CREATE INDEX IF NOT EXISTS idx_tags_tradeId ON tags(tradeId);
        CREATE INDEX IF NOT EXISTS idx_notes_tradeId ON notes(tradeId);
        CREATE INDEX IF NOT EXISTS idx_excursions_tradeId ON excursions(tradeId);
    `)

    // Migration: add lastApiImport column to bitunix_config (may already exist)
    try {
        db.exec(`ALTER TABLE bitunix_config ADD COLUMN lastApiImport INTEGER DEFAULT 0`)
    } catch (e) {
        // Column already exists, ignore
    }

    // Migration: add tags column to incoming_positions (may already exist)
    try {
        db.exec(`ALTER TABLE incoming_positions ADD COLUMN tags TEXT DEFAULT '[]'`)
    } catch (e) {
        // Column already exists, ignore
    }

    // Migration: add evaluation popup columns to incoming_positions
    try { db.exec(`ALTER TABLE incoming_positions ADD COLUMN entryNote TEXT DEFAULT ''`) } catch (e) {}
    try { db.exec(`ALTER TABLE incoming_positions ADD COLUMN historyData TEXT DEFAULT '{}'`) } catch (e) {}
    try { db.exec(`ALTER TABLE incoming_positions ADD COLUMN openingEvalDone INTEGER DEFAULT 0`) } catch (e) {}
    try { db.exec(`ALTER TABLE incoming_positions ADD COLUMN entryTimeframe TEXT DEFAULT ''`) } catch (e) {}

    // Migration: add showTradePopups setting
    try { db.exec(`ALTER TABLE settings ADD COLUMN showTradePopups INTEGER DEFAULT 1`) } catch (e) {}

    // Migration: add username to settings
    try { db.exec(`ALTER TABLE settings ADD COLUMN username TEXT DEFAULT ''`) } catch (e) {}

    // Migration: add startBalance and currentBalance to settings
    try { db.exec(`ALTER TABLE settings ADD COLUMN startBalance REAL DEFAULT 0`) } catch (e) {}
    try { db.exec(`ALTER TABLE settings ADD COLUMN startBalanceDate INTEGER DEFAULT 0`) } catch (e) {}
    try { db.exec(`ALTER TABLE settings ADD COLUMN currentBalance REAL DEFAULT 0`) } catch (e) {}
    try { db.exec(`ALTER TABLE settings ADD COLUMN tradeTimeframes TEXT DEFAULT '[]'`) } catch (e) {}

    // Migration: add structured metadata columns to notes table (for Playbook)
    try { db.exec(`ALTER TABLE notes ADD COLUMN title TEXT DEFAULT ''`) } catch (e) {}
    try { db.exec(`ALTER TABLE notes ADD COLUMN entryStressLevel INTEGER DEFAULT 0`) } catch (e) {}
    try { db.exec(`ALTER TABLE notes ADD COLUMN exitStressLevel INTEGER DEFAULT 0`) } catch (e) {}
    try { db.exec(`ALTER TABLE notes ADD COLUMN entryNote TEXT DEFAULT ''`) } catch (e) {}
    try { db.exec(`ALTER TABLE notes ADD COLUMN feelings TEXT DEFAULT ''`) } catch (e) {}
    try { db.exec(`ALTER TABLE notes ADD COLUMN playbook TEXT DEFAULT ''`) } catch (e) {}
    try { db.exec(`ALTER TABLE notes ADD COLUMN timeframe TEXT DEFAULT ''`) } catch (e) {}
    try { db.exec(`ALTER TABLE notes ADD COLUMN screenshotId TEXT DEFAULT ''`) } catch (e) {}
    try { db.exec(`ALTER TABLE notes ADD COLUMN emotionLevel INTEGER DEFAULT 0`) } catch (e) {}

    // Migration: add emotionLevel to incoming_positions
    try { db.exec(`ALTER TABLE incoming_positions ADD COLUMN emotionLevel INTEGER DEFAULT 0`) } catch (e) {}

    // Migration: add enableBinanceChart to settings
    try { db.exec(`ALTER TABLE settings ADD COLUMN enableBinanceChart INTEGER DEFAULT 0`) } catch (e) {}

    // Migration: add closingNote to notes and incoming_positions
    try { db.exec(`ALTER TABLE notes ADD COLUMN closingNote TEXT DEFAULT ''`) } catch (e) {}
    try { db.exec(`ALTER TABLE incoming_positions ADD COLUMN closingNote TEXT DEFAULT ''`) } catch (e) {}

    // Migration: add satisfaction to incoming_positions
    try { db.exec(`ALTER TABLE incoming_positions ADD COLUMN satisfaction INTEGER DEFAULT -1`) } catch (e) {}

    // Migration: add skipEvaluation to incoming_positions
    try { db.exec(`ALTER TABLE incoming_positions ADD COLUMN skipEvaluation INTEGER DEFAULT 0`) } catch (e) {}

    // AI Reports table
    db.exec(`
        CREATE TABLE IF NOT EXISTS ai_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT DEFAULT '',
            startDate INTEGER NOT NULL,
            endDate INTEGER NOT NULL,
            provider TEXT DEFAULT '',
            model TEXT DEFAULT '',
            report TEXT DEFAULT '',
            reportData TEXT DEFAULT '{}',
            createdAt TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ai_reports_created ON ai_reports(createdAt);
    `)

    // Migration: AI settings
    try { db.exec(`ALTER TABLE settings ADD COLUMN aiProvider TEXT DEFAULT 'ollama'`) } catch (e) {}
    try { db.exec(`ALTER TABLE settings ADD COLUMN aiModel TEXT DEFAULT ''`) } catch (e) {}
    try { db.exec(`ALTER TABLE settings ADD COLUMN aiApiKey TEXT DEFAULT ''`) } catch (e) {}
    try { db.exec(`ALTER TABLE settings ADD COLUMN aiTemperature REAL DEFAULT 0.7`) } catch (e) {}
    try { db.exec(`ALTER TABLE settings ADD COLUMN aiMaxTokens INTEGER DEFAULT 1500`) } catch (e) {}
    try { db.exec(`ALTER TABLE settings ADD COLUMN aiOllamaUrl TEXT DEFAULT 'http://localhost:11434'`) } catch (e) {}
    try { db.exec(`ALTER TABLE settings ADD COLUMN aiScreenshots INTEGER DEFAULT 0`) } catch (e) {}

    // Migration: add token tracking to ai_reports
    try { db.exec(`ALTER TABLE ai_reports ADD COLUMN promptTokens INTEGER DEFAULT 0`) } catch (e) {}
    try { db.exec(`ALTER TABLE ai_reports ADD COLUMN completionTokens INTEGER DEFAULT 0`) } catch (e) {}
    try { db.exec(`ALTER TABLE ai_reports ADD COLUMN totalTokens INTEGER DEFAULT 0`) } catch (e) {}

    // Migration: separate API key per provider (encrypted)
    try { db.exec(`ALTER TABLE settings ADD COLUMN aiKeyOpenai TEXT DEFAULT ''`) } catch (e) {}
    try { db.exec(`ALTER TABLE settings ADD COLUMN aiKeyAnthropic TEXT DEFAULT ''`) } catch (e) {}
    try { db.exec(`ALTER TABLE settings ADD COLUMN aiKeyGemini TEXT DEFAULT ''`) } catch (e) {}
    try { db.exec(`ALTER TABLE settings ADD COLUMN aiKeyDeepseek TEXT DEFAULT ''`) } catch (e) {}

    // Migration: migrate old aiApiKey to provider-specific column
    try {
        const row = db.prepare('SELECT aiApiKey, aiProvider FROM settings WHERE id = 1').get()
        if (row && row.aiApiKey) {
            const col = { openai: 'aiKeyOpenai', anthropic: 'aiKeyAnthropic', gemini: 'aiKeyGemini' }[row.aiProvider]
            if (col) {
                const current = db.prepare(`SELECT ${col} FROM settings WHERE id = 1`).get()
                if (!current[col]) {
                    db.prepare(`UPDATE settings SET ${col} = ? WHERE id = 1`).run(row.aiApiKey)
                    console.log(` -> Migrated API key to ${col}`)
                }
            }
        }
    } catch (e) {}

    console.log(' -> SQLite database initialized at', DB_PATH)
}

export function closeDb() {
    if (db) {
        db.close()
        db = null
    }
}
