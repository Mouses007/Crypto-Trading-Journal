import { getKnex } from './database.js'
import { loadDbConfig, saveDbConfig } from './db-config.js'

const VALID_TABLES = ['trades', 'diaries', 'screenshots', 'satisfactions', 'tags', 'notes', 'excursions', 'incoming_positions']

// Bekannte Spalten pro Tabelle (Whitelist gegen SQL-Injection); ergänzt um Migrations-Spalten
const TABLE_COLUMNS = {
    trades: ['id', 'dateUnix', 'date', 'broker', 'executions', 'trades', 'blotter', 'pAndL', 'cashJournal', 'openPositions', 'video', 'createdAt', 'updatedAt'],
    diaries: ['id', 'dateUnix', 'date', 'diary', 'createdAt', 'updatedAt'],
    screenshots: ['id', 'name', 'symbol', 'side', 'broker', 'originalBase64', 'annotatedBase64', 'original', 'annotated', 'markersOnly', 'maState', 'date', 'dateUnix', 'dateUnixDay', 'createdAt', 'updatedAt'],
    satisfactions: ['id', 'dateUnix', 'tradeId', 'satisfaction', 'createdAt', 'updatedAt'],
    tags: ['id', 'dateUnix', 'tradeId', 'tags', 'closingTags', 'createdAt', 'updatedAt'],
    notes: ['id', 'dateUnix', 'tradeId', 'note', 'title', 'entryStressLevel', 'exitStressLevel', 'entryNote', 'feelings', 'playbook', 'timeframe', 'screenshotId', 'emotionLevel', 'closingNote', 'closingScreenshotId', 'closingStressLevel', 'closingEmotionLevel', 'closingFeelings', 'closingTimeframe', 'closingPlaybook', 'createdAt', 'updatedAt'],
    excursions: ['id', 'dateUnix', 'tradeId', 'stopLoss', 'maePrice', 'mfePrice', 'createdAt', 'updatedAt'],
    incoming_positions: ['id', 'positionId', 'symbol', 'side', 'entryPrice', 'leverage', 'quantity', 'unrealizedPNL', 'markPrice', 'playbook', 'stressLevel', 'feelings', 'screenshotId', 'status', 'bitunixData', 'createdAt', 'updatedAt', 'tags', 'entryNote', 'historyData', 'openingEvalDone', 'entryTimeframe', 'emotionLevel', 'closingNote', 'satisfaction', 'skipEvaluation', 'closingStressLevel', 'closingEmotionLevel', 'closingFeelings', 'closingTimeframe', 'closingTags', 'closingScreenshotId', 'closingPlaybook', 'entryScreenshotId', 'broker']
}

// JSON columns per table that should be parsed on read and stringified on write
const JSON_COLUMNS = {
    trades: ['executions', 'trades', 'blotter', 'pAndL', 'cashJournal'],
    screenshots: ['maState'],
    tags: ['tags', 'closingTags'],
    settings: ['accounts', 'tags', 'apis', 'layoutStyle', 'tradeTimeframes', 'customTimeframes', 'balances'],
    incoming_positions: ['bitunixData', 'tags', 'closingTags', 'historyData'],
}

function parseJsonColumns(tableName, row) {
    if (!row) return row
    const cols = JSON_COLUMNS[tableName] || []
    const parsed = { ...row }
    if (parsed.id !== undefined) {
        parsed.objectId = String(parsed.id)
    }
    for (const col of cols) {
        if (parsed[col] && typeof parsed[col] === 'string') {
            try {
                parsed[col] = JSON.parse(parsed[col])
            } catch (e) {
                // keep as string if parse fails
            }
        }
    }
    return parsed
}

function stringifyJsonColumns(tableName, data) {
    const cols = JSON_COLUMNS[tableName] || []
    const result = { ...data }
    for (const col of cols) {
        if (result[col] !== undefined && typeof result[col] !== 'string') {
            result[col] = JSON.stringify(result[col])
        }
    }
    for (const key of Object.keys(result)) {
        const val = result[key]
        if (typeof val === 'boolean') {
            result[key] = val ? 1 : 0
        } else if (val !== null && val !== undefined && typeof val === 'object' && !Buffer.isBuffer(val)) {
            result[key] = JSON.stringify(val)
        } else if (val === undefined) {
            result[key] = null
        }
    }
    return result
}

/** Nur erlaubte Spaltennamen (Whitelist) – verhindert SQL-Injection. */
function allowedColumn(table, column) {
    const allowed = TABLE_COLUMNS[table]
    return allowed && typeof column === 'string' && allowed.includes(column)
}

/** Query-Parameter sicher parsen (JSON); bei Fehler null. */
function safeParseQuery(value) {
    if (value == null) return null
    if (typeof value === 'object') return value
    try {
        return JSON.parse(value)
    } catch {
        return null
    }
}

export function setupApiRoutes(app) {
    const knex = getKnex()

    // ==================== SETTINGS ====================
    app.get('/api/db/settings', async (req, res) => {
        try {
            const row = await knex('settings').where('id', 1).first()
            res.json(parseJsonColumns('settings', row))
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    app.put('/api/db/settings', async (req, res) => {
        try {
            const data = stringifyJsonColumns('settings', req.body)
            const fields = Object.keys(data).filter(k => k !== 'id' && k !== 'objectId')
            if (fields.length === 0) return res.json({ ok: true })

            const updateData = { ...data, updatedAt: knex.fn.now() }
            delete updateData.id
            delete updateData.objectId
            await knex('settings').where('id', 1).update(updateData)
            const row = await knex('settings').where('id', 1).first()
            res.json(parseJsonColumns('settings', row))
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // ==================== SETUP (Installationsassistent) ====================
    app.get('/api/setup/status', async (req, res) => {
        try {
            const row = await knex('settings').where('id', 1).select('setupComplete').first()
            res.json({ setupComplete: row?.setupComplete === 1 })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    app.post('/api/setup/complete', async (req, res) => {
        try {
            await knex('settings').where('id', 1).update({ setupComplete: 1, updatedAt: knex.fn.now() })
            res.json({ ok: true })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // ==================== BITUNIX CONFIG ====================
    // Hinweis: Bitunix-Keys werden über /api/bitunix/* (bitunix-api.js) mit Verschlüsselung verwaltet.
    // Diese Endpoints werden vom Frontend nicht genutzt; Antwort ohne Secret-Key.
    app.get('/api/db/bitunix_config', async (req, res) => {
        try {
            const row = await knex('bitunix_config').where('id', 1).first()
            if (!row) return res.json({})
            // Kein secretKey in Antwort ausliefern
            const { secretKey, ...safe } = row
            res.json({ ...safe, hasSecret: !!secretKey })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    app.put('/api/db/bitunix_config', async (req, res) => {
        try {
            const updateData = { updatedAt: knex.fn.now() }
            // Only update keys if explicitly provided (avoid accidental deletion)
            if (req.body.apiKey !== undefined) updateData.apiKey = req.body.apiKey
            if (req.body.secretKey !== undefined) updateData.secretKey = req.body.secretKey
            // Allow updating other safe fields
            if (req.body.lastHistoryScan !== undefined) updateData.lastHistoryScan = req.body.lastHistoryScan
            if (req.body.lastApiImport !== undefined) updateData.lastApiImport = req.body.lastApiImport
            if (req.body.apiImportStartDate !== undefined) updateData.apiImportStartDate = req.body.apiImportStartDate

            await knex('bitunix_config').where('id', 1).update(updateData)
            const row = await knex('bitunix_config').where('id', 1).first()
            const { secretKey: _s, ...safe } = row || {}
            res.json({ ...safe, hasSecret: !!_s })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // ==================== DB CONFIG ====================
    app.get('/api/db-config', async (req, res) => {
        try {
            const config = loadDbConfig()
            const type = config.client === 'pg' ? 'postgresql' : 'sqlite'
            if (type === 'postgresql') {
                const conn = config.connection || {}
                res.json({
                    type: 'postgresql',
                    host: conn.host || 'localhost',
                    port: conn.port || 5432,
                    user: conn.user || '',
                    database: conn.database || '',
                    hasPassword: !!conn.password
                })
            } else {
                res.json({ type: 'sqlite' })
            }
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    app.put('/api/db-config', async (req, res) => {
        try {
            const { type, host, port, user, password, database } = req.body
            if (type === 'postgresql') {
                // Strip http:// or https:// from host if present
                const cleanHost = (host || 'localhost').replace(/^https?:\/\//, '').replace(/\/+$/, '')

                // If no new password provided, keep the saved one
                let savePassword = password || ''
                if (!savePassword) {
                    const savedConfig = loadDbConfig()
                    if (savedConfig.client === 'pg' && savedConfig.connection?.password) {
                        savePassword = savedConfig.connection.password
                    }
                }

                saveDbConfig({
                    type: 'postgresql',
                    host: cleanHost,
                    port: parseInt(port) || 5432,
                    user: user || '',
                    password: savePassword,
                    database: database || ''
                })
            } else {
                saveDbConfig({ type: 'sqlite' })
            }
            res.json({ ok: true, message: 'Konfiguration gespeichert. Bitte Server neu starten.' })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    app.post('/api/db-config/test', async (req, res) => {
        try {
            const { host, port, user, password, database } = req.body
            // Strip http:// or https:// from host if present
            const cleanHost = (host || 'localhost').replace(/^https?:\/\//, '').replace(/\/+$/, '')

            // If no password provided, use the saved one from db-config.json
            let testPassword = password || ''
            if (!testPassword) {
                const savedConfig = loadDbConfig()
                if (savedConfig.client === 'pg' && savedConfig.connection?.password) {
                    testPassword = savedConfig.connection.password
                }
            }

            const knexTest = (await import('knex')).default({
                client: 'pg',
                connection: {
                    host: cleanHost,
                    port: parseInt(port) || 5432,
                    user: user || '',
                    password: testPassword,
                    database: database || ''
                },
                pool: { min: 0, max: 1 },
                acquireConnectionTimeout: 5000
            })

            await knexTest.raw('SELECT 1')
            await knexTest.destroy()
            res.json({ ok: true, message: 'Verbindung erfolgreich!' })
        } catch (error) {
            res.json({ ok: false, message: `Verbindung fehlgeschlagen: ${error.message}` })
        }
    })

    // ==================== SERVER RESTART ====================
    app.post('/api/restart', async (req, res) => {
        res.json({ ok: true, message: 'Server wird neu gestartet...' })
        // Give the response time to be sent, then exit.
        // systemd / process manager will restart the process automatically.
        setTimeout(() => {
            console.log(' -> Server restart requested via API')
            process.exit(0)
        }, 500)
    })

    // ==================== GENERIC CRUD ====================

    app.get('/api/db/:table', async (req, res) => {
        const { table } = req.params
        if (!VALID_TABLES.includes(table)) {
            return res.status(400).json({ error: `Invalid table: ${table}` })
        }

        try {
            let query = knex(table)

            const eq = safeParseQuery(req.query.equalTo)
            if (eq && typeof eq === 'object') {
                for (const [key, val] of Object.entries(eq)) {
                    if (!allowedColumn(table, key)) continue
                    const v = typeof val === 'boolean' ? (val ? 1 : 0) : val
                    query = query.where(key, v)
                }
            }

            const gte = safeParseQuery(req.query.gte)
            if (gte && typeof gte === 'object') {
                for (const [key, val] of Object.entries(gte)) {
                    if (!allowedColumn(table, key)) continue
                    const n = Number(val)
                    if (!Number.isNaN(n)) query = query.where(key, '>=', n)
                }
            }

            const lt = safeParseQuery(req.query.lt)
            if (lt && typeof lt === 'object') {
                for (const [key, val] of Object.entries(lt)) {
                    if (!allowedColumn(table, key)) continue
                    const n = Number(val)
                    if (!Number.isNaN(n)) query = query.where(key, '<', n)
                }
            }

            const lte = safeParseQuery(req.query.lte)
            if (lte && typeof lte === 'object') {
                for (const [key, val] of Object.entries(lte)) {
                    if (!allowedColumn(table, key)) continue
                    const n = Number(val)
                    if (!Number.isNaN(n)) query = query.where(key, '<=', n)
                }
            }

            const doesNotExist = req.query.doesNotExist
            if (doesNotExist) {
                const fields = Array.isArray(doesNotExist) ? doesNotExist : [doesNotExist]
                for (const field of fields) {
                    if (!allowedColumn(table, field)) continue
                    query = query.where(function () {
                        this.whereNull(field).orWhere(field, '').orWhere(field, '0')
                    })
                }
            }

            const columns = TABLE_COLUMNS[table]
            if (req.query.exclude && columns) {
                const excludeList = Array.isArray(req.query.exclude) ? req.query.exclude : String(req.query.exclude).split(',')
                const selectCols = columns.filter(c => !excludeList.includes(c))
                if (selectCols.length > 0) query = query.select(selectCols)
            }

            const orderCol = req.query.descending || req.query.ascending
            if (orderCol && allowedColumn(table, orderCol)) {
                query = req.query.descending ? query.orderBy(orderCol, 'desc') : query.orderBy(orderCol, 'asc')
            }

            const limit = parseInt(req.query.limit, 10)
            if (Number.isInteger(limit) && limit > 0) query = query.limit(limit)
            const skip = parseInt(req.query.skip, 10)
            if (Number.isInteger(skip) && skip >= 0) query = query.offset(skip)

            const rows = await query
            res.json(rows.map(r => parseJsonColumns(table, r)))
        } catch (error) {
            console.error('DB query error:', error)
            res.status(500).json({ error: error.message })
        }
    })

    app.get('/api/db/:table/:id', async (req, res) => {
        const { table, id } = req.params
        if (!VALID_TABLES.includes(table)) {
            return res.status(400).json({ error: `Invalid table: ${table}` })
        }
        try {
            const row = await knex(table).where('id', id).first()
            if (!row) return res.status(404).json({ error: 'Not found' })
            res.json(parseJsonColumns(table, row))
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    app.post('/api/db/:table', async (req, res) => {
        const { table } = req.params
        if (!VALID_TABLES.includes(table)) {
            return res.status(400).json({ error: `Invalid table: ${table}` })
        }
        const columns = TABLE_COLUMNS[table]
        if (!columns) return res.status(400).json({ error: 'Invalid table' })

        try {
            let data = stringifyJsonColumns(table, req.body)
            delete data.objectId
            delete data.id
            // Nur erlaubte Spalten übernehmen (Schutz vor SQL-Injection)
            data = columns.reduce((acc, col) => {
                if (data[col] !== undefined) acc[col] = data[col]
                return acc
            }, {})
            if (Object.keys(data).length === 0) {
                return res.status(400).json({ error: 'No data provided' })
            }

            const isPg = knex.client.config.client === 'pg'
            const id = isPg
                ? (await knex(table).insert(data).returning('id'))[0]?.id
                : (await knex(table).insert(data))[0]
            const row = await knex(table).where('id', id).first()
            res.status(201).json(parseJsonColumns(table, row))
        } catch (error) {
            console.error('DB insert error:', error)
            res.status(500).json({ error: error.message })
        }
    })

    app.put('/api/db/:table/:id', async (req, res) => {
        const { table, id } = req.params
        if (!VALID_TABLES.includes(table)) {
            return res.status(400).json({ error: `Invalid table: ${table}` })
        }
        const columns = TABLE_COLUMNS[table]
        if (!columns) return res.status(400).json({ error: 'Invalid table' })

        try {
            let data = stringifyJsonColumns(table, req.body)
            delete data.objectId
            delete data.id
            data = columns.reduce((acc, col) => {
                if (data[col] !== undefined) acc[col] = data[col]
                return acc
            }, {})
            if (Object.keys(data).length === 0) {
                return res.status(400).json({ error: 'No data provided' })
            }
            data.updatedAt = knex.fn.now()
            const count = await knex(table).where('id', id).update(data)
            if (count === 0) return res.status(404).json({ error: 'Not found' })
            const row = await knex(table).where('id', id).first()
            res.json(parseJsonColumns(table, row))
        } catch (error) {
            console.error('DB update error:', error)
            res.status(500).json({ error: error.message })
        }
    })

    app.delete('/api/db/:table/:id', async (req, res) => {
        const { table, id } = req.params
        if (!VALID_TABLES.includes(table)) {
            return res.status(400).json({ error: `Invalid table: ${table}` })
        }
        try {
            const count = await knex(table).where('id', id).delete()
            if (count === 0) return res.status(404).json({ error: 'Not found' })
            res.json({ ok: true, deleted: id })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    app.delete('/api/db/:table', async (req, res) => {
        const { table } = req.params
        if (!VALID_TABLES.includes(table)) {
            return res.status(400).json({ error: `Invalid table: ${table}` })
        }
        try {
            let query = knex(table)
            let hasFilter = false

            const eq = safeParseQuery(req.query.equalTo)
            if (eq && typeof eq === 'object') {
                for (const [key, val] of Object.entries(eq)) {
                    if (!allowedColumn(table, key)) continue
                    query = query.where(key, val)
                    hasFilter = true
                }
            }
            const gte = safeParseQuery(req.query.gte)
            if (gte && typeof gte === 'object') {
                for (const [key, val] of Object.entries(gte)) {
                    if (!allowedColumn(table, key)) continue
                    const n = Number(val)
                    if (!Number.isNaN(n)) {
                        query = query.where(key, '>=', n)
                        hasFilter = true
                    }
                }
            }
            const lt = safeParseQuery(req.query.lt)
            if (lt && typeof lt === 'object') {
                for (const [key, val] of Object.entries(lt)) {
                    if (!allowedColumn(table, key)) continue
                    const n = Number(val)
                    if (!Number.isNaN(n)) {
                        query = query.where(key, '<', n)
                        hasFilter = true
                    }
                }
            }
            if (!hasFilter) {
                return res.status(400).json({ error: 'Filters required for bulk delete' })
            }

            const count = await query.delete()
            res.json({ ok: true, deleted: count })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    console.log(' -> API routes initialized')
}
