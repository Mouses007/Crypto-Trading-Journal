/**
 * Transport und Signatur der Pionex-REST-API.
 *
 * Bewusst aus `pionex-api.js` herausgelöst: dort stehen 900 Zeilen Journal-
 * und Bot-Logik, an denen der Order-Pfad (`server/execution/pionex.js`) nicht
 * hängen soll. Vor allem aber wird `createSignature` dadurch ohne Datenbank
 * und ohne Netz prüfbar — und die Signatur ist die Stelle, an der ein Fehler
 * nicht als Fehler auftritt, sondern als „APIKEY_INVALID". Man sucht dann am
 * Schlüssel statt an der Zeichenkette.
 *
 * Reine Verschiebung; am Verhalten ändert sich nichts.
 */

import crypto from 'crypto'

export const BASE_URL = 'https://api.pionex.com'

/**
 * Pionex-Signatur (HMAC-SHA256 → hex).
 *
 * Signatur-String:  METHOD + PATH + "?" + sortedQuery            (GET)
 *                   METHOD + PATH + "?" + sortedQuery + body     (POST/DELETE)
 * Query-Parameter:  aufsteigend nach ASCII-Key sortiert, mit & verbunden,
 *                   inkl. `timestamp` (ms). Werte NICHT url-encoden.
 * Header:           PIONEX-KEY, PIONEX-SIGNATURE
 *
 * Quelle: https://pionex-doc.gitbook.io/apidocs/restful/general/authentication
 */
export function createSignature(secretKey, method, path, sortedQuery, body) {
    let str = method.toUpperCase() + path
    if (sortedQuery) str += '?' + sortedQuery
    if (body) str += body
    return crypto.createHmac('sha256', secretKey).update(str).digest('hex')
}

/**
 * Baut die sortierte Query-Zeichenkette inklusive `timestamp`.
 *
 * Eigene Funktion, weil genau dieselbe Zeichenkette zweimal gebraucht wird —
 * einmal für die Signatur, einmal für die URL. Liefe das auseinander (etwa
 * weil die URL encodiert und die Signatur nicht), wäre jede Anfrage ungültig
 * und der Grund schwer zu sehen.
 */
export function baueQuery(params = {}, timestamp = Date.now()) {
    const alle = { ...params, timestamp: String(timestamp) }
    return Object.keys(alle).sort().map((k) => `${k}=${alle[k]}`).join('&')
}

/**
 * Authentifizierter Request gegen die Pionex REST API.
 * @returns {object} Envelope: { result:true, data, timestamp }
 */
export async function pionexRequest(method, path, apiKey, secretKey, params = {}, body = null) {
    const sortedQuery = baueQuery(params)

    const bodyString = (body && method !== 'GET') ? JSON.stringify(body) : ''
    const sign = createSignature(secretKey, method, path, sortedQuery, bodyString)

    const url = `${BASE_URL}${path}?${sortedQuery}`
    const headers = {
        'Content-Type': 'application/json',
        'PIONEX-KEY': apiKey,
        'PIONEX-SIGNATURE': sign,
    }

    const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? (bodyString || undefined) : undefined,
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
        const msg = data ? `[${data.code}] ${data.message}` : `${response.status} ${response.statusText}`
        throw new Error(`Pionex API: ${msg}`)
    }
    // Erfolgs-Envelope: result === true
    if (data && data.result === false) {
        throw new Error(`Pionex API: [${data.code}] ${data.message || 'Unbekannter Fehler'}`)
    }
    return data
}
