/**
 * Database configuration.
 * Reads DB type from db-config.json in project root.
 * Default: SQLite (zero config).
 * Optional: PostgreSQL (host, port, user, password, database).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const CONFIG_PATH = path.join(__dirname, '..', 'db-config.json')
const DB_PATH = path.join(__dirname, '..', 'tradenote.db')

/**
 * Load DB config from db-config.json.
 * Returns knex connection config object.
 */
export function loadDbConfig() {
    let config = null
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
        }
    } catch (e) {
        console.warn(' -> Warning: Could not read db-config.json, using SQLite default')
    }

    if (config && config.type === 'postgresql') {
        return {
            client: 'pg',
            connection: {
                host: config.host || 'localhost',
                port: config.port || 5432,
                user: config.user || 'tradenote',
                password: config.password || '',
                database: config.database || 'tradenote'
            },
            pool: { min: 0, max: 7 }
        }
    }

    // Default: SQLite
    return {
        client: 'better-sqlite3',
        connection: {
            filename: DB_PATH
        },
        useNullAsDefault: true
    }
}

/**
 * Save DB config to db-config.json.
 */
export function saveDbConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * Get the config file path (for API routes to read/write).
 */
export function getConfigPath() {
    return CONFIG_PATH
}
