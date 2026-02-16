import { getDb } from './database.js'

const VALID_TABLES = ['trades', 'diaries', 'screenshots', 'satisfactions', 'tags', 'notes', 'excursions', 'incoming_positions']

const MAX_QUERY_LIMIT = 10000
const MAX_QUERY_SKIP = 100000

/** Returns allowed column names for a table (prevents SQL injection via column names). */
function getTableColumns(db, table) {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all()
    return rows.map(r => r.name)
}

// JSON columns per table that should be parsed on read and stringified on write
const JSON_COLUMNS = {
    trades: ['executions', 'trades', 'blotter', 'pAndL', 'cashJournal'],
    screenshots: ['maState'],
    tags: ['tags'],
    settings: ['accounts', 'tags', 'apis', 'layoutStyle', 'tradeTimeframes'],
    incoming_positions: ['bitunixData', 'tags', 'historyData'],
}

function parseJsonColumns(tableName, row) {
    if (!row) return row
    const cols = JSON_COLUMNS[tableName] || []
    const parsed = { ...row }
    // Map SQLite id to objectId for frontend compatibility
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
    // Sanitize remaining values: SQLite3 only accepts numbers, strings, bigints, buffers, and null
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

export function setupApiRoutes(app) {
    const db = getDb()

    // ==================== SETTINGS ====================
    app.get('/api/db/settings', (req, res) => {
        try {
            const row = db.prepare('SELECT * FROM settings WHERE id = 1').get()
            res.json(parseJsonColumns('settings', row))
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    app.put('/api/db/settings', (req, res) => {
        try {
            const data = stringifyJsonColumns('settings', req.body)
            const fields = Object.keys(data).filter(k => k !== 'id' && k !== 'objectId')
            if (fields.length === 0) return res.json({ ok: true })

            const sets = fields.map(f => `${f} = @${f}`).join(', ')
            const stmt = db.prepare(`UPDATE settings SET ${sets}, updatedAt = datetime('now') WHERE id = 1`)
            stmt.run(data)

            const row = db.prepare('SELECT * FROM settings WHERE id = 1').get()
            res.json(parseJsonColumns('settings', row))
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // ==================== BITUNIX CONFIG ====================
    app.get('/api/db/bitunix_config', (req, res) => {
        try {
            const row = db.prepare('SELECT * FROM bitunix_config WHERE id = 1').get()
            res.json(row || {})
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    app.put('/api/db/bitunix_config', (req, res) => {
        try {
            const { apiKey, secretKey } = req.body
            db.prepare(`UPDATE bitunix_config SET apiKey = ?, secretKey = ?, updatedAt = datetime('now') WHERE id = 1`).run(apiKey || '', secretKey || '')
            const row = db.prepare('SELECT * FROM bitunix_config WHERE id = 1').get()
            res.json(row)
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // ==================== GENERIC CRUD ====================

    // GET /api/db/:table - Query with filters
    app.get('/api/db/:table', (req, res) => {
        const { table } = req.params
        if (!VALID_TABLES.includes(table)) {
            return res.status(400).json({ error: `Invalid table: ${table}` })
        }

        try {
            let where = []
            let params = {}

            // equalTo filters: ?equalTo[field]=value
            if (req.query.equalTo) {
                const eq = typeof req.query.equalTo === 'string' ? JSON.parse(req.query.equalTo) : req.query.equalTo
                for (const [key, val] of Object.entries(eq)) {
                    where.push(`${key} = @eq_${key}`)
                    params[`eq_${key}`] = typeof val === 'boolean' ? (val ? 1 : 0) : val
                }
            }

            // greaterThanOrEqualTo: ?gte[field]=value
            if (req.query.gte) {
                const gte = typeof req.query.gte === 'string' ? JSON.parse(req.query.gte) : req.query.gte
                for (const [key, val] of Object.entries(gte)) {
                    where.push(`${key} >= @gte_${key}`)
                    params[`gte_${key}`] = Number(val)
                }
            }

            // lessThan: ?lt[field]=value
            if (req.query.lt) {
                const lt = typeof req.query.lt === 'string' ? JSON.parse(req.query.lt) : req.query.lt
                for (const [key, val] of Object.entries(lt)) {
                    where.push(`${key} < @lt_${key}`)
                    params[`lt_${key}`] = Number(val)
                }
            }

            // lessThanOrEqualTo: ?lte[field]=value
            if (req.query.lte) {
                const lte = typeof req.query.lte === 'string' ? JSON.parse(req.query.lte) : req.query.lte
                for (const [key, val] of Object.entries(lte)) {
                    where.push(`${key} <= @lte_${key}`)
                    params[`lte_${key}`] = Number(val)
                }
            }

            const allowedColumns = getTableColumns(db, table)

            // doesNotExist: ?doesNotExist=field (only allow valid column names)
            if (req.query.doesNotExist) {
                const fields = Array.isArray(req.query.doesNotExist) ? req.query.doesNotExist : [req.query.doesNotExist]
                for (const field of fields) {
                    if (allowedColumns.includes(field)) {
                        where.push(`(${field} IS NULL OR ${field} = '' OR ${field} = '0')`)
                    }
                }
            }

            // Build SELECT with optional exclude
            let selectCols = '*'
            if (req.query.exclude) {
                const excludeList = Array.isArray(req.query.exclude) ? req.query.exclude : req.query.exclude.split(',')
                const includeCols = allowedColumns.filter(c => !excludeList.includes(c))
                selectCols = includeCols.length ? includeCols.join(', ') : '*'
            }

            // Build query
            let sql = `SELECT ${selectCols} FROM ${table}`
            if (where.length > 0) {
                sql += ` WHERE ${where.join(' AND ')}`
            }

            // Sort (only allow valid column names)
            if (req.query.descending && allowedColumns.includes(req.query.descending)) {
                sql += ` ORDER BY ${req.query.descending} DESC`
            } else if (req.query.ascending && allowedColumns.includes(req.query.ascending)) {
                sql += ` ORDER BY ${req.query.ascending} ASC`
            }

            // Limit and skip (bounded integers when provided)
            if (req.query.limit !== undefined && req.query.limit !== '') {
                const limitNum = Math.min(Math.max(0, parseInt(req.query.limit, 10) || 0), MAX_QUERY_LIMIT)
                sql += ` LIMIT ${limitNum}`
            }
            if (req.query.skip !== undefined && req.query.skip !== '') {
                const skipNum = Math.min(Math.max(0, parseInt(req.query.skip, 10) || 0), MAX_QUERY_SKIP)
                sql += ` OFFSET ${skipNum}`
            }

            const rows = db.prepare(sql).all(params)
            res.json(rows.map(r => parseJsonColumns(table, r)))
        } catch (error) {
            console.error('DB query error:', error)
            res.status(500).json({ error: error.message })
        }
    })

    // GET /api/db/:table/:id - Get single record
    app.get('/api/db/:table/:id', (req, res) => {
        const { table, id } = req.params
        if (!VALID_TABLES.includes(table)) {
            return res.status(400).json({ error: `Invalid table: ${table}` })
        }

        try {
            const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
            if (!row) {
                return res.status(404).json({ error: 'Not found' })
            }
            res.json(parseJsonColumns(table, row))
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // POST /api/db/:table - Create record
    app.post('/api/db/:table', (req, res) => {
        const { table } = req.params
        if (!VALID_TABLES.includes(table)) {
            return res.status(400).json({ error: `Invalid table: ${table}` })
        }

        try {
            const data = stringifyJsonColumns(table, req.body)
            // Remove objectId/id if present (auto-increment)
            delete data.objectId
            delete data.id

            const fields = Object.keys(data)
            if (fields.length === 0) {
                return res.status(400).json({ error: 'No data provided' })
            }

            const placeholders = fields.map(f => `@${f}`).join(', ')
            const sql = `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`
            const result = db.prepare(sql).run(data)

            const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(result.lastInsertRowid)
            res.status(201).json(parseJsonColumns(table, row))
        } catch (error) {
            console.error('DB insert error:', error)
            res.status(500).json({ error: error.message })
        }
    })

    // PUT /api/db/:table/:id - Update record
    app.put('/api/db/:table/:id', (req, res) => {
        const { table, id } = req.params
        if (!VALID_TABLES.includes(table)) {
            return res.status(400).json({ error: `Invalid table: ${table}` })
        }

        try {
            const data = stringifyJsonColumns(table, req.body)
            delete data.objectId
            delete data.id

            const fields = Object.keys(data)
            if (fields.length === 0) {
                return res.status(400).json({ error: 'No data provided' })
            }

            const sets = fields.map(f => `${f} = @${f}`).join(', ')
            const sql = `UPDATE ${table} SET ${sets}, updatedAt = datetime('now') WHERE id = @_id`
            data._id = id
            db.prepare(sql).run(data)

            const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
            res.json(parseJsonColumns(table, row))
        } catch (error) {
            console.error('DB update error:', error)
            res.status(500).json({ error: error.message })
        }
    })

    // DELETE /api/db/:table/:id - Delete record
    app.delete('/api/db/:table/:id', (req, res) => {
        const { table, id } = req.params
        if (!VALID_TABLES.includes(table)) {
            return res.status(400).json({ error: `Invalid table: ${table}` })
        }

        try {
            const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
            if (result.changes === 0) {
                return res.status(404).json({ error: 'Not found' })
            }
            res.json({ ok: true, deleted: id })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    // DELETE /api/db/:table - Delete with filters (for bulk delete)
    app.delete('/api/db/:table', (req, res) => {
        const { table } = req.params
        if (!VALID_TABLES.includes(table)) {
            return res.status(400).json({ error: `Invalid table: ${table}` })
        }

        try {
            let where = []
            let params = {}

            if (req.query.equalTo) {
                const eq = typeof req.query.equalTo === 'string' ? JSON.parse(req.query.equalTo) : req.query.equalTo
                for (const [key, val] of Object.entries(eq)) {
                    where.push(`${key} = @eq_${key}`)
                    params[`eq_${key}`] = val
                }
            }

            if (req.query.gte) {
                const gte = typeof req.query.gte === 'string' ? JSON.parse(req.query.gte) : req.query.gte
                for (const [key, val] of Object.entries(gte)) {
                    where.push(`${key} >= @gte_${key}`)
                    params[`gte_${key}`] = Number(val)
                }
            }

            if (req.query.lt) {
                const lt = typeof req.query.lt === 'string' ? JSON.parse(req.query.lt) : req.query.lt
                for (const [key, val] of Object.entries(lt)) {
                    where.push(`${key} < @lt_${key}`)
                    params[`lt_${key}`] = Number(val)
                }
            }

            if (where.length === 0) {
                return res.status(400).json({ error: 'Filters required for bulk delete' })
            }

            const sql = `DELETE FROM ${table} WHERE ${where.join(' AND ')}`
            const result = db.prepare(sql).run(params)
            res.json({ ok: true, deleted: result.changes })
        } catch (error) {
            res.status(500).json({ error: error.message })
        }
    })

    console.log(' -> API routes initialized')
}
