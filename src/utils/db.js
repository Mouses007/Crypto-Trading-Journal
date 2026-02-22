/**
 * Client-side database abstraction layer.
 * Drop-in replacement for Parse SDK calls.
 * All operations go through the Express REST API to SQLite.
 */
import axios from 'axios'

// Central error handling for API responses
axios.interceptors.response.use(
    response => response,
    error => {
        if (error.response) {
            const status = error.response.status
            if (status === 401) {
                console.error('[DB] Session abgelaufen (401). Bitte Seite neu laden.')
                // Avoid spamming alerts — show once
                if (!window._dbSessionExpiredShown) {
                    window._dbSessionExpiredShown = true
                    alert('Sitzung abgelaufen. Bitte Seite neu laden.')
                    window.location.reload()
                }
            } else if (status >= 500) {
                console.error(`[DB] Server-Fehler (${status}):`, error.response.data?.error || error.message)
            }
        } else if (error.request) {
            console.error('[DB] Netzwerk-Fehler: Server nicht erreichbar', error.message)
        }
        return Promise.reject(error)
    }
)

/**
 * Query records from a table.
 * Replaces: Parse.Object.extend(className) + new Parse.Query() + query.find()
 *
 * @param {string} className - Table name (trades, diaries, etc.)
 * @param {object} options - Query options
 * @param {object} options.equalTo - { field: value } exact match filters
 * @param {object} options.greaterThanOrEqualTo - { field: value } >= filters
 * @param {object} options.lessThan - { field: value } < filters
 * @param {object} options.lessThanOrEqualTo - { field: value } <= filters
 * @param {string|string[]} options.doesNotExist - field(s) that should be null/empty
 * @param {string} options.descending - field name to sort descending
 * @param {string} options.ascending - field name to sort ascending
 * @param {number} options.limit - max results
 * @param {number} options.skip - offset for pagination
 * @param {string[]} options.exclude - columns to exclude from results
 * @returns {Promise<Array>} Array of result objects
 */
export async function dbFind(className, options = {}) {
    const params = {}

    if (options.equalTo) {
        params.equalTo = JSON.stringify(options.equalTo)
    }
    if (options.greaterThanOrEqualTo) {
        params.gte = JSON.stringify(options.greaterThanOrEqualTo)
    }
    if (options.lessThan) {
        params.lt = JSON.stringify(options.lessThan)
    }
    if (options.lessThanOrEqualTo) {
        params.lte = JSON.stringify(options.lessThanOrEqualTo)
    }
    if (options.doesNotExist) {
        params.doesNotExist = options.doesNotExist
    }
    if (options.descending) {
        params.descending = options.descending
    }
    if (options.ascending) {
        params.ascending = options.ascending
    }
    if (options.limit !== undefined) {
        params.limit = options.limit
    }
    if (options.skip !== undefined) {
        params.skip = options.skip
    }
    if (options.exclude) {
        params.exclude = options.exclude.join(',')
    }

    const response = await axios.get(`/api/db/${className}`, { params })
    return response.data
}

/**
 * Get a single record by ID.
 * @param {string} className - Table name
 * @param {string|number} id - Record ID
 * @returns {Promise<object>} Single record
 */
export async function dbGet(className, id) {
    const response = await axios.get(`/api/db/${className}/${id}`)
    return response.data
}

/**
 * Get the first record matching filters.
 * Replaces: query.first()
 *
 * @param {string} className - Table name
 * @param {object} options - Same as dbFind options
 * @returns {Promise<object|null>} First matching record or null
 */
export async function dbFirst(className, options = {}) {
    const results = await dbFind(className, { ...options, limit: 1 })
    return results.length > 0 ? results[0] : null
}

/**
 * Create a new record.
 * Replaces: new Parse.Object() + object.set() + object.save()
 *
 * @param {string} className - Table name
 * @param {object} data - Record data
 * @returns {Promise<object>} Created record with id/objectId
 */
export async function dbCreate(className, data) {
    const response = await axios.post(`/api/db/${className}`, data)
    return response.data
}

/**
 * Update an existing record.
 * Replaces: query.first() + result.set() + result.save()
 *
 * @param {string} className - Table name
 * @param {string|number} id - Record ID
 * @param {object} data - Fields to update
 * @returns {Promise<object>} Updated record
 */
export async function dbUpdate(className, id, data) {
    const response = await axios.put(`/api/db/${className}/${id}`, data)
    return response.data
}

/**
 * Delete a record.
 * Replaces: query.first() + result.destroy()
 *
 * @param {string} className - Table name
 * @param {string|number} id - Record ID
 * @returns {Promise<object>} Deletion confirmation
 */
export async function dbDelete(className, id) {
    const response = await axios.delete(`/api/db/${className}/${id}`)
    return response.data
}

/**
 * Delete multiple records matching filters.
 *
 * @param {string} className - Table name
 * @param {object} options - Filter options (equalTo, gte, lt)
 * @returns {Promise<object>} Deletion confirmation with count
 */
export async function dbDeleteWhere(className, options = {}) {
    const params = {}
    if (options.equalTo) params.equalTo = JSON.stringify(options.equalTo)
    if (options.greaterThanOrEqualTo) params.gte = JSON.stringify(options.greaterThanOrEqualTo)
    if (options.lessThan) params.lt = JSON.stringify(options.lessThan)
    const response = await axios.delete(`/api/db/${className}`, { params })
    return response.data
}

/**
 * Get app settings (replaces Parse.User.current()).
 * @returns {Promise<object>} Settings object
 */
export async function dbGetSettings() {
    const response = await axios.get('/api/db/settings')
    return response.data
}

/**
 * Update app settings (replaces user.set() + user.save()).
 * @param {object} data - Settings fields to update
 * @returns {Promise<object>} Updated settings
 */
export async function dbUpdateSettings(data) {
    const response = await axios.put('/api/db/settings', data)
    return response.data
}
