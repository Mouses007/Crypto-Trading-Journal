import { createI18n } from 'vue-i18n'
import de from './locales/de.json'
import en from './locales/en.json'

// Initial locale: check localStorage first (fast), fall back to 'de'.
// After settings load from DB, the layout will call setLocale() to sync.
const savedLocale = typeof localStorage !== 'undefined'
    ? localStorage.getItem('appLanguage') || 'de'
    : 'de'

const i18n = createI18n({
    legacy: false,           // use Composition API mode
    locale: savedLocale,
    fallbackLocale: 'de',    // German is the complete baseline
    messages: { de, en },
    missingWarn: false,
    fallbackWarn: false,
})

/**
 * Set the active locale and persist to localStorage.
 * Called from Settings when user changes language,
 * and from Dashboard layout after loading settings from DB.
 */
export function setLocale(locale) {
    i18n.global.locale.value = locale
    localStorage.setItem('appLanguage', locale)
    document.documentElement.setAttribute('lang', locale)
}

export default i18n
