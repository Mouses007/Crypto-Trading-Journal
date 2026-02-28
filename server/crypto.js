import crypto from 'crypto'
import os from 'os'

// Verschlüsselungs-Key: bevorzugt aus ENV, Fallback auf maschinenspezifischen Seed
const ENV_SECRET = process.env.CTJ_SECRET
const MACHINE_SEED = `tradenote-${os.hostname()}-${os.userInfo().username}-v1`
const ENCRYPTION_KEY = crypto.createHash('sha256').update(ENV_SECRET || MACHINE_SEED).digest()
const ALGORITHM = 'aes-256-gcm'

if (!ENV_SECRET) {
    console.warn('[CRYPTO] Kein CTJ_SECRET gesetzt – verwende maschinenspezifischen Schlüssel. Für höhere Sicherheit CTJ_SECRET als Umgebungsvariable setzen.')
}

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
    try {
        const parts = encryptedText.split(':')
        if (parts.length !== 3) {
            // Nicht verschlüsselt (Legacy-Klartext) — direkt zurückgeben
            return encryptedText
        }
        const [ivHex, authTagHex, encrypted] = parts
        const iv = Buffer.from(ivHex, 'hex')
        const authTag = Buffer.from(authTagHex, 'hex')
        const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv)
        decipher.setAuthTag(authTag)
        let decrypted = decipher.update(encrypted, 'hex', 'utf8')
        decrypted += decipher.final('utf8')
        return decrypted
    } catch (e) {
        // Falls Entschlüsselung fehlschlägt (z.B. alter Klartext-Key),
        // gib den Originaltext zurück (Abwärtskompatibilität)
        console.warn('[CRYPTO] Entschlüsselung fehlgeschlagen — Klartext-Fallback:', e.message)
        return encryptedText
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
