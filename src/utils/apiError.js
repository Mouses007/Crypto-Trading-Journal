/**
 * Lesbare Fehlertexte für API-Aufrufe.
 *
 * Hintergrund: Der Express-Server lädt seine Dateien NICHT neu — nur das
 * Frontend hängt am Vite-Hot-Reload. Nach einer Server-Änderung läuft der alte
 * Prozess also weiter und kennt neue Routen nicht. Das äussert sich als 404,
 * und ein generisches „Aktion fehlgeschlagen" schickt einen dann auf die
 * Fehlersuche im eigenen Code, obwohl nur ein Neustart fehlt.
 *
 * Deshalb wird der 404-Fall hier ausdrücklich benannt und der HTTP-Status
 * angehängt, wenn der Server keine eigene Meldung liefert.
 */

/**
 * @param {Error}    e         Axios-Fehler
 * @param {string}   fallback  Text, wenn nichts Genaueres bekannt ist
 * @param {Function} t         i18n-Übersetzer
 */
export function apiFehlerText(e, fallback, t) {
    const status = e?.response?.status
    const vomServer = e?.response?.data?.error

    if (vomServer) return vomServer
    if (status === 404) return t('common.endpointMissing')
    if (status === 401) return t('common.sessionExpired')
    return status ? `${fallback} (HTTP ${status})` : fallback
}
