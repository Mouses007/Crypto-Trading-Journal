/**
 * Client-side database abstraction layer.
 * Drop-in replacement for Parse SDK calls.
 * All operations go through the Express REST API to SQLite.
 */
import axios from 'axios'

/*
 * Ein hartes Zeitlimit für ALLE Anfragen des Frontends.
 *
 * Axios wartet ohne `timeout` unbegrenzt. Hängt der Server (oder eine
 * Drittquelle dahinter), bleibt die Anfrage für immer offen: der Spinner dreht,
 * die Kachel meldet nie „veraltet", und beim Kachelraster blockiert die
 * laufende Anfrage den nächsten Takt. 20 Sekunden sind grosszügig genug für
 * den langsamsten regulären Endpunkt und kurz genug, dass ein Hänger als
 * Fehler sichtbar wird statt als Stillstand.
 *
 * Einzelne Aufrufe dürfen kürzer setzen — der Orderbuch-Snapshot im LiveFeed
 * tut das mit 8 Sekunden, weil dort jede Sekunde Verzögerung ein veraltetes
 * Buch bedeutet.
 */
axios.defaults.timeout = 20000

/**
 * Pfade, die LÄNGER dauern dürfen als der Hausstandard.
 *
 * Die 20 Sekunden oben sind für Datenabrufe richtig und für KI-Arbeit falsch:
 * Ein Lagebericht schreibt fünf Minuten, die Gesamtlage-Kachel rund dreissig
 * Sekunden, ein Backtest läuft über hunderttausend Kerzen. Der Browser brach
 * ab, während der Server ungerührt weiterrechnete — und die Oberfläche meldete
 * „timeout of 20000ms exceeded" für Arbeit, die gelang und bezahlt wurde.
 *
 * Deshalb EINE Liste statt eines Zeitlimits je Aufrufstelle: Jede neue Kachel,
 * die ein Modell anstösst, erbt die richtige Frist automatisch, und wer die
 * Liste liest, sieht auf einen Blick, was im Haus lange dauert.
 *
 * Ein eigener, GRÖSSERER Wert am Aufruf gewinnt weiterhin — kleinere werden
 * angehoben, weil sie fast immer die geerbte Vorgabe sind und nicht Absicht.
 */
const MIN = 60 * 1000
export const LANGSAME_PFADE = [
    // Lagebericht: gemessen 5 min 49 s (Videoanalyse + Recherche + langer Text)
    { muster: /\/api\/marktradar\/lagebericht\/(erzeugen|aktualisieren)/, ms: 10 * MIN },
    { muster: /\/api\/marktradar\/lagebericht\/anweisung-pruefen/, ms: 2 * MIN },
    { muster: /\/api\/marktradar\/news\/holen/, ms: 3 * MIN },
    // Gesamtlage-Kachel: ~30 s, mit trägem Anbieter auch mehr
    { muster: /\/api\/marktradar\/lage$/, ms: 5 * MIN },
    { muster: /\/api\/marktradar\/mechanik-erklaerung/, ms: 3 * MIN },
    // Radar-Läufe: eigene Fremdabrufe plus KI-Einordnung
    { muster: /\/api\/(coin-radar|hype-radar)\//, ms: 15 * MIN },
    // KI-Berichte, Rückfragen, Agent, Baukasten
    { muster: /\/api\/(ai|ollama)\//, ms: 10 * MIN },
    { muster: /\/api\/strategies\/(builder|backtest)/, ms: 15 * MIN },
    { muster: /\/api\/rangliste\/(ki-vorschlag|laeufe)/, ms: 10 * MIN },
    { muster: /\/api\/flux\//, ms: 5 * MIN },
]

/**
 * Welche Frist gilt für diese Adresse? `null` heisst: die Hausvorgabe.
 *
 * Rein und ohne Axios, damit ein Selbsttest sie prüfen kann.
 */
export function langsameFrist(url) {
    const treffer = LANGSAME_PFADE.find(p => p.muster.test(String(url || '')))
    return treffer ? treffer.ms : null
}

axios.interceptors.request.use((config) => {
    const frist = langsameFrist(config.url)
    if (frist && (!config.timeout || config.timeout < frist)) config.timeout = frist
    return config
})

// Central error handling for API responses
axios.interceptors.response.use(
    response => {
        // Erfolgreiche Antwort → Reload-Sperre zurücksetzen, damit eine spätere
        // echte Session-Expiry wieder genau EINEN Reload auslösen darf.
        try { sessionStorage.removeItem('ctjReloaded401') } catch (e) { /* ignore */ }
        return response
    },
    error => {
        if (error.response) {
            const status = error.response.status
            if (status === 401) {
                console.error('[DB] Nicht autorisiert (401).')
                // Höchstens EIN Reload (über sessionStorage, übersteht den Reload):
                // ohne Passwort-Gate erneuert das das Session-Cookie, mit aktivem
                // Gate zeigt App.vue den Login-Screen. Kein Endlos-Reload mehr.
                let already = false
                try { already = !!sessionStorage.getItem('ctjReloaded401') } catch (e) { /* ignore */ }
                if (!already) {
                    try { sessionStorage.setItem('ctjReloaded401', '1') } catch (e) { /* ignore */ }
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
 * Find the actual trade ID for a given positionId by searching the trades JSON array.
 * Trade IDs follow the format: t${dateUnix}_${index}_${positionId}
 * The index is assigned during import and may not be 0 for multi-trade days.
 *
 * @param {number} dateUnix - The trade day (unix timestamp, start of day)
 * @param {string} positionId - The broker position ID to match
 * @returns {Promise<string>} The matched trade ID, or fallback `t${dateUnix}_0_${positionId}`
 */
export async function dbFindTradeIdByPositionId(dateUnix, positionId) {
    try {
        // `td` ist ein Feld INNERHALB der Trade-Objekte, keine Tabellenspalte —
        // der Server verwarf den Filter still und lieferte die ganze Tabelle.
        // Die Tagesspalte heisst dateUnix.
        const rows = await dbFind('trades', { equalTo: { dateUnix } })
        for (const row of rows) {
            const trades = row.trades || []
            const match = trades.find(t => t.id && String(t.id).endsWith('_' + positionId))
            if (match) return match.id
        }
    } catch (e) {
        console.warn('[DB] dbFindTradeIdByPositionId lookup failed:', e.message)
    }
    return `t${dateUnix}_0_${positionId}`
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
