/**
 * Lade-Haken für den Golden-Master-Test des Journal-Kerns
 * (`__selftest-journal.mjs`).
 *
 * Der Journal-Kern (`trades.js`, `addTrades.js`, `calendar.js` …) ist nicht
 * rein: er liest über `db.js` per axios aus der REST-API und schreibt in
 * Vue-Stores. Damit er in Node ohne Server läuft, ersetzt dieser Haken genau
 * fünf Module durch Attrappen und lässt alles andere echt:
 *
 *   - `utils/db.js`              → Speicher-DB in `globalThis.__journalDaten`
 *   - `axios`                    → feste Antworten aus `globalThis.__journalNetz`
 *   - `echarts`                  → merkt sich die Optionen je Element-ID
 *   - `stores/accountBalance.js` → tut nichts (holt den Kontostand übers Netz)
 *   - `i18n/index.js`            → echtes vue-i18n mit `de.json`, ohne
 *                                  `localStorage`/`document`
 *
 * Keine `__selftest`-Datei, damit der Läufer sie nicht als Test startet.
 */

const ATTRAPPEN = {
    // Eine Speicher-DB statt der REST-API. Schreiben ist erlaubt — der Import
    // legt seine Tageszeilen genau so an, wie er es gegen den Server täte, und
    // der Test liest sie danach wie die Dashboard-Seite wieder aus.
    'attrappe:db': `
        const daten = () => (globalThis.__journalDaten ||= {})
        const tabelle = (name) => (daten()[name] ||= [])
        const zahl = (v) => (v == null || v === '' ? v : Number(v))
        const kopie = (z) => JSON.parse(JSON.stringify(z))
        export async function dbFind(name, o = {}) {
            let zeilen = tabelle(name).map(kopie)
            const filter = (feldwerte, pruef) => {
                if (!feldwerte) return
                for (const [feld, wert] of Object.entries(feldwerte)) {
                    zeilen = zeilen.filter(z => pruef(zahl(z[feld]), Number(wert), z[feld], wert))
                }
            }
            filter(o.equalTo, (_a, _b, roh, wert) => String(roh) === String(wert))
            filter(o.greaterThanOrEqualTo, (a, b) => a >= b)
            filter(o.greaterThan, (a, b) => a > b)
            filter(o.lessThanOrEqualTo, (a, b) => a <= b)
            filter(o.lessThan, (a, b) => a < b)
            if (o.containedIn) {
                for (const [feld, werte] of Object.entries(o.containedIn)) {
                    const menge = new Set((werte || []).map(String))
                    zeilen = zeilen.filter(z => menge.has(String(z[feld])))
                }
            }
            // stabil sortieren wie die DB mit Primärschlüssel als zweitem Kriterium
            if (o.ascending) zeilen.sort((a, b) => (zahl(a[o.ascending]) - zahl(b[o.ascending])) || (Number(a.objectId) - Number(b.objectId)))
            if (o.descending) zeilen.sort((a, b) => (zahl(b[o.descending]) - zahl(a[o.descending])) || (Number(a.objectId) - Number(b.objectId)))
            if (o.skip) zeilen = zeilen.slice(o.skip)
            if (o.limit) zeilen = zeilen.slice(0, o.limit)
            if (o.exclude) for (const z of zeilen) for (const f of o.exclude) delete z[f]
            return zeilen
        }
        export async function dbFirst(name, o = {}) { return (await dbFind(name, { ...o, limit: 1 }))[0] || null }
        export async function dbGet(name, id) { const z = tabelle(name).find(z => String(z.objectId) === String(id)); return z ? kopie(z) : null }
        export async function dbCreate(name, werte) {
            const t = tabelle(name)
            // wie api-routes.js: objectId ist die id als Zeichenkette
            const objectId = String(t.reduce((m, z) => Math.max(m, Number(z.objectId)), 0) + 1)
            const zeile = { ...kopie(werte), objectId }
            t.push(zeile)
            return kopie(zeile)
        }
        export async function dbUpdate(name, id, werte) {
            const z = tabelle(name).find(z => String(z.objectId) === String(id))
            if (!z) throw new Error('Attrappe: ' + name + '/' + id + ' gibt es nicht')
            Object.assign(z, kopie(werte))
            return kopie(z)
        }
        export async function dbDelete(name, id) {
            const t = tabelle(name)
            const i = t.findIndex(z => String(z.objectId) === String(id))
            if (i >= 0) t.splice(i, 1)
        }
        export async function dbDeleteWhere(name, o = {}) {
            const weg = new Set((await dbFind(name, o)).map(z => z.objectId))
            daten()[name] = tabelle(name).filter(z => !weg.has(z.objectId))
        }
        export async function dbGetSettings() { return kopie(tabelle('settings')[0] || {}) }
        export async function dbUpdateSettings(werte) {
            const t = tabelle('settings')
            if (!t[0]) t.push({ objectId: '1' })
            Object.assign(t[0], kopie(werte))
            return kopie(t[0])
        }
        export async function dbFindTradeIdByPositionId() { return null }
        export const LANGSAME_PFADE = []
        export function langsameFrist() { return 0 }
    `,
    // Antworten kommen aus globalThis.__journalNetz[url] — alles andere wirft,
    // damit ein neuer Netzaufruf im getesteten Pfad auffällt statt still zu fehlen.
    'attrappe:axios': `
        const antwort = async (url) => {
            const tabelle = globalThis.__journalNetz || {}
            if (!(url in tabelle)) throw new Error('Attrappe: axios-Aufruf ' + url + ' ist im Test nicht vorgesehen')
            return { data: typeof tabelle[url] === 'function' ? tabelle[url]() : tabelle[url] }
        }
        const axios = { get: antwort, post: antwort, put: antwort, delete: antwort, create: () => axios,
            interceptors: { request: { use() {} }, response: { use() {} } }, defaults: { headers: { common: {} } } }
        export default axios
    `,
    // ECharts zeichnet nicht, es merkt sich je Element-ID die letzte Option.
    'attrappe:echarts': `
        const ablage = () => (globalThis.__journalCharts ||= {})
        export function init(el) {
            return { setOption(o) { ablage()[el.id] = o }, clear() {}, dispose() {}, resize() {}, on() {}, off() {}, getOption() { return ablage()[el.id] } }
        }
        export function getInstanceByDom() { return undefined }
        export const graphic = { LinearGradient: class { constructor(...a) { this.verlauf = a } } }
    `,
    'attrappe:kontostand': `
        import { computed } from 'vue'
        const null0 = computed(() => 0)
        export const allTimeNetPnL = null0, allTimeVolume = null0, last30dVolume = null0, displayBonus = null0
        export async function refreshAccountBalance() {}
        export function invalidateAccountBalance() {}
        export async function syncStartBalanceFromBroker() {}
    `,
    'attrappe:i18n': `
        import { createI18n } from 'vue-i18n'
        import { readFileSync } from 'node:fs'
        const de = JSON.parse(readFileSync(new URL('../i18n/locales/de.json', '%s'), 'utf8'))
        const i18n = createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de }, missingWarn: false, fallbackWarn: false })
        export async function ladeSprache() { return true }
        export async function setLocale() {}
        export async function starteSprache() {}
        export default i18n
    `,
}

export async function resolve(spezifizierer, kontext, weiter) {
    if (spezifizierer.startsWith('attrappe:')) return { url: spezifizierer, shortCircuit: true }
    if (spezifizierer === 'axios') return { url: 'attrappe:axios', shortCircuit: true }
    if (spezifizierer === 'echarts') return { url: 'attrappe:echarts', shortCircuit: true }
    const eltern = kontext.parentURL || ''
    // Attrappen haben keine Datei-URL — ihre eigenen Importe (vue, node:fs)
    // werden so aufgelöst, als stünden sie neben dieser Datei.
    if (eltern.startsWith('attrappe:')) return weiter(spezifizierer, { ...kontext, parentURL: import.meta.url })
    if (eltern.includes('/src/') && !eltern.startsWith('attrappe:')) {
        if (/(^|\/)db\.js$/.test(spezifizierer) && /utils\/db\.js$/.test(new URL(spezifizierer, eltern).pathname)) {
            return { url: 'attrappe:db', shortCircuit: true }
        }
        if (/accountBalance\.js$/.test(spezifizierer)) return { url: 'attrappe:kontostand', shortCircuit: true }
        if (/(^|\/)i18n(\/index\.js)?$/.test(spezifizierer)) return { url: 'attrappe:i18n', shortCircuit: true }
    }
    return weiter(spezifizierer, kontext)
}

export async function load(url, kontext, weiter) {
    if (url in ATTRAPPEN) return { format: 'module', source: ATTRAPPEN[url].replace('%s', import.meta.url), shortCircuit: true }
    return weiter(url, kontext)
}
