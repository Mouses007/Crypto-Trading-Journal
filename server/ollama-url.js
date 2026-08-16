/**
 * SSRF-Schutz für Ollama-Adressen.
 *
 * Steht bewusst in einem eigenen Modul: die Prüfung wird sowohl von
 * `ollama-api.js` als auch von `ai-models.js` gebraucht, und solange sie in
 * einem der beiden lag, importierten sich die Dateien gegenseitig. Ein solcher
 * Kreis fällt in ESM erst zur Laufzeit auf — als „Cannot access '…' before
 * initialization", an einer Stelle, die mit der Ursache nichts zu tun hat.
 */

/**
 * Prüft, ob eine URL auf einen lokalen/privaten Host zeigt.
 * Erlaubt: localhost, 127.0.0.1, ::1, 0.0.0.0, 192.168.x.x, 10.x.x.x, 172.16-31.x.x
 * @param {string} url - Die zu prüfende URL
 * @returns {boolean} true wenn lokal/privat, false sonst
 */
export function isAllowedOllamaUrl(url) {
    try {
        const parsed = new URL(url)
        const host = parsed.hostname
        const isLocal = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)
        const isPrivate = host.startsWith('192.168.') || host.startsWith('10.') || host.match(/^172\.(1[6-9]|2\d|3[01])\./)
        return isLocal || isPrivate
    } catch {
        return false
    }
}

/**
 * Wirft, wenn die URL nicht auf einen lokalen/privaten Host zeigt.
 * Vor jedem ausgehenden Ollama-Request aufrufen.
 */
export function assertAllowedOllamaUrl(url) {
    if (!isAllowedOllamaUrl(url)) {
        throw new Error('Nur lokale/private Hosts erlaubt für Ollama-URL')
    }
}

/**
 * Prüfung für frei eingetragene KI-Endpunkte (`aiCustomUrl`, `aiQwenUrl`).
 *
 * Bewusst NICHT „nur öffentliche Hosts" wie bei den Nachrichten-Feeds: ein
 * selbst gehostetes Modell im eigenen Netz ist genau der Zweck dieser Felder.
 * Verboten ist deshalb nur, was niemals ein Modell-Endpunkt sein kann und
 * gleichzeitig gefährlich ist — allen voran die Metadaten-Dienste der Cloud-
 * Anbieter unter 169.254.169.254, die auf simple GET-Anfragen Zugangsdaten
 * herausgeben.
 *
 * @param {string} rawUrl
 * @returns {Promise<void>} wirft mit klartextlicher Begründung
 */
export async function pruefeKiEndpunkt(rawUrl) {
    let url
    try { url = new URL(String(rawUrl || '').trim()) } catch { throw new Error('Keine gültige Adresse') }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Nur http und https sind erlaubt (nicht ${url.protocol.replace(':', '')})`)
    }
    if (url.username || url.password) {
        throw new Error('Zugangsdaten in der Adresse sind nicht erlaubt')
    }

    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
    if (host.endsWith('.internal') || host === 'metadata.google.internal') {
        throw new Error(`„${host}" ist ein Metadaten-Dienst, kein Modell-Endpunkt`)
    }

    // Auch hinter einem harmlosen Namen kann eine Metadaten-Adresse stecken.
    // Schlägt die Auflösung fehl, wird NICHT blockiert: die Anfrage scheitert
    // dann ohnehin, und ein zeitweise defektes DNS soll nicht das Speichern
    // der Einstellungen verhindern.
    let adressen = []
    try {
        const dns = await import('node:dns')
        adressen = await dns.promises.lookup(host, { all: true })
    } catch { return }

    for (const { address, family } of adressen) {
        if (family === 4) {
            const t = address.split('.').map(Number)
            if (t[0] === 169 && t[1] === 254) throw new Error(`„${host}" zeigt auf den Metadaten-Bereich (${address})`)
            if (t[0] >= 224) throw new Error(`„${host}" zeigt auf einen reservierten Bereich (${address})`)
        } else if (family === 6) {
            const s = address.toLowerCase()
            const kopf = parseInt(s.split(':')[0] || '0', 16)
            if ((kopf & 0xffc0) === 0xfe80) throw new Error(`„${host}" zeigt auf eine verbindungslokale Adresse (${address})`)
        }
    }
}
