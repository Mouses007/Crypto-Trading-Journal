import crypto from 'crypto'
import os from 'os'

// Verschlüsselungs-Key: bevorzugt aus ENV, Fallback auf maschinenspezifischen Seed
const ENV_SECRET = process.env.CTJ_SECRET
const MACHINE_SEED = `tradenote-${os.hostname()}-${os.userInfo().username}-v1`
const ALGORITHM = 'aes-256-gcm'

if (!ENV_SECRET) {
    // In Produktion ist ein vorhersehbarer Maschinen-Seed nicht akzeptabel:
    // harter Abbruch statt unsicherem Fallback.
    if (process.env.NODE_ENV === 'production') {
        throw new Error('[CRYPTO] CTJ_SECRET ist in Produktion erforderlich (NODE_ENV=production). Setze CTJ_SECRET als Umgebungsvariable.')
    }
    console.warn('[CRYPTO] Kein CTJ_SECRET gesetzt – verwende maschinenspezifischen Schlüssel. Für höhere Sicherheit CTJ_SECRET als Umgebungsvariable setzen.')
}

const ENCRYPTION_KEY = crypto.createHash('sha256').update(ENV_SECRET || MACHINE_SEED).digest()

/**
 * Verschlüsselt einen String mit AES-256-GCM
 * @param {string} text - Klartext
 * @returns {string} - Verschlüsselter Text (iv:authTag:encrypted in hex)
 */
export function encrypt(text) {
    if (!text) return ''
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv)
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    const authTag = cipher.getAuthTag().toString('hex')
    return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

/**
 * Entschlüsselt einen String
 * @param {string} encryptedText - Verschlüsselter Text (iv:authTag:encrypted)
 * @returns {string} - Klartext oder '' bei Fehler
 */
export function decrypt(encryptedText) {
    if (!encryptedText) return ''
    // Legacy-Klartext (Format ≠ iv:authTag:data) unverändert durchreichen —
    // Abwärtskompatibilität für bereits unverschlüsselt gespeicherte Werte.
    if (!isEncrypted(encryptedText)) {
        return encryptedText
    }
    try {
        const [ivHex, authTagHex, encrypted] = encryptedText.split(':')
        const iv = Buffer.from(ivHex, 'hex')
        const authTag = Buffer.from(authTagHex, 'hex')
        const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv)
        decipher.setAuthTag(authTag)
        let decrypted = decipher.update(encrypted, 'hex', 'utf8')
        decrypted += decipher.final('utf8')
        return decrypted
    } catch (e) {
        // Der Wert war verschlüsselt, ließ sich aber nicht entschlüsseln
        // (z.B. falscher Key). KEINEN Ciphertext als Klartext zurückgeben.
        console.warn('[CRYPTO] Entschlüsselung fehlgeschlagen — leeren Wert zurückgeben:', e.message)
        return ''
    }
}

/**
 * Prüft ob ein String verschlüsselt ist (hat das Format iv:authTag:data)
 */
export function isEncrypted(text) {
    if (!text) return false
    const parts = text.split(':')
    return parts.length === 3 && parts[0].length === 32 && parts[1].length === 32
}

/**
 * Maskiert einen (verschlüsselt gespeicherten) Key für die Anzeige:
 * ersten 4 + Punkte + letzte 4 Zeichen. Gibt '' zurück, wenn kein Key.
 * Liefert NIE den vollständigen Klartext aus.
 */
export function maskKey(encryptedKey) {
    if (!encryptedKey) return ''
    const key = decrypt(encryptedKey)
    if (!key) return ''
    if (key.length <= 8) return '•'.repeat(key.length)
    return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 20)) + key.slice(-4)
}
