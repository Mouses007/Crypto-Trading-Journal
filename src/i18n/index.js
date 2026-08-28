import { createI18n } from 'vue-i18n'
import de from './locales/de.json'

/*
 * Nur DEUTSCH liegt im Start-Bundle.
 *
 * Vorher waren beide Sprachdateien statisch importiert und landeten damit in
 * den Chunks, die `index.html` vorlaedt — 480 kB roh, von denen die Haelfte
 * nie gebraucht wird, weil niemand zwei Sprachen gleichzeitig liest.
 *
 * Deutsch bleibt statisch, und zwar aus zwei Gruenden: es ist die vollstaendige
 * Basis und damit `fallbackLocale`, und es ist die Vorgabe. Wer Deutsch nutzt
 * — der Normalfall — laedt jetzt genau eine Sprachdatei statt zwei. Englisch
 * kommt per dynamischem Import dazu, sobald es gebraucht wird.
 */
const savedLocale = typeof localStorage !== 'undefined'
    ? localStorage.getItem('appLanguage') || 'de'
    : 'de'

const i18n = createI18n({
    legacy: false,           // use Composition API mode
    locale: 'de',            // wird unten auf `savedLocale` gehoben, sobald geladen
    fallbackLocale: 'de',    // German is the complete baseline
    messages: { de },
    missingWarn: false,
    fallbackWarn: false,
})

/** Sprachen, die bereits im Speicher liegen. */
const geladen = new Set(['de'])

/**
 * Eine Sprachdatei nachladen, falls noch nicht vorhanden.
 *
 * Schlaegt der Import fehl (offline, kaputter Chunk), bleibt es bei Deutsch —
 * eine Oberflaeche in der falschen Sprache ist besser als keine.
 *
 * @param {string} locale
 * @returns {Promise<boolean>} ob die Sprache jetzt verfuegbar ist
 */
export async function ladeSprache(locale) {
    if (geladen.has(locale)) return true
    try {
        const modul = await import(`./locales/${locale}.json`)
        i18n.global.setLocaleMessage(locale, modul.default || modul)
        geladen.add(locale)
        return true
    } catch (e) {
        console.warn(`[i18n] Sprache ${locale} konnte nicht geladen werden:`, e?.message)
        return false
    }
}

/**
 * Set the active locale and persist to localStorage.
 * Called from Settings when user changes language,
 * and from Dashboard layout after loading settings from DB.
 *
 * Laedt die Sprachdatei nach, falls noetig — der Aufrufer muss nichts wissen.
 */
export async function setLocale(locale) {
    const ok = await ladeSprache(locale)
    if (!ok) return
    i18n.global.locale.value = locale
    localStorage.setItem('appLanguage', locale)
    document.documentElement.setAttribute('lang', locale)
}

/**
 * Die gespeicherte Sprache herstellen, BEVOR die App montiert wird.
 *
 * Ohne das blitzte bei englischer Einstellung kurz die deutsche Oberflaeche
 * auf. Setzt nebenbei `<html lang>` — das stand bis zum Audit vom 28.08.2026
 * auf "en", bis die Einstellungen aus der Datenbank kamen, und auf der
 * Login-Seite dauerhaft.
 */
export async function starteSprache() {
    document.documentElement.setAttribute('lang', savedLocale)
    if (savedLocale !== 'de') await setLocale(savedLocale)
}

export default i18n
