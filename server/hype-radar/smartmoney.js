/**
 * Hype-Radar, Smart Money — was beobachtete Wallets kaufen.
 *
 * Das stärkste Frühsignal, das Terminals wie GMGN, Nansen oder Kolscan
 * verkaufen: Wallets mit nachweislich guter Bilanz kaufen einen jungen Token,
 * bevor jemand darüber redet. Welche Wallets das sind, entscheidet der
 * Mensch — die Liste kommt aus den Einstellungen (Quellen: GMGN-, Kolscan-,
 * Cielo-Bestenlisten). Eine selbstgepflegte Liste ist ehrlicher als eine
 * gekaufte, deren Auswahl man nicht kennt.
 *
 * Gelesen wird über Standard-Solana-RPC, nicht über ein Spezial-API:
 *   getSignaturesForAddress  — was ist seit der zuletzt gelesenen Signatur passiert
 *   getTransaction           — je neue Signatur einmal, gerechnet in
 *                              `kaeufeAusTransaktion` (nur signierte und
 *                              bezahlte Käufe, keine Airdrops)
 * Damit geht jede RPC-Adresse: die öffentliche (gedrosselt, für eine Handvoll
 * Wallets genug) oder eine eigene, etwa die Gratis-Stufe von Helius. Die
 * Adresse kommt vom Nutzer und läuft deshalb durch `net-guard` — sonst wäre
 * das Feld ein bequemer Weg, den Server ins eigene Netz zu schicken.
 *
 * Gegen den öffentlichen Knoten geprüft am 10.10.2026, an Käufen und
 * Verkäufen auf zwei pump.fun-Kurven: Felder wie dokumentiert, Mengen
 * stimmen, und fünf von sechs Transaktionen waren Version 1 — siehe
 * `maxSupportedTransactionVersion` unten.
 */

import { getKnex } from '../database.js'
import { logWarn } from '../logger.js'
import { pruefeOeffentlicheUrl } from '../net-guard.js'
import { handelAusTransaktion, smartSignale, smartWalletListe } from './fruehphase-bewertung.js'

/** Ohne eigene Adresse: der öffentliche Knoten. Gedrosselt, aber ohne Schlüssel. */
const OEFFENTLICH = 'https://api.mainnet-beta.solana.com'

/** Höchstens so viele Transaktionen je Abruf — über alle Wallets. */
const MAX_TX_JE_ABRUF = 120

/** Beim allerersten Blick auf eine Wallet nur die jüngsten paar, nicht ihre Geschichte. */
const ERSTER_BLICK = 10
const NEU_JE_WALLET = 25

/** Zwei Käufe in diesem Abstand sind EIN Signal. */
export const SMART_FENSTER_MS = 6 * 3600e3

const AUFBEWAHREN_MS = 7 * 24 * 3600e3

/*
 * Abstand zwischen zwei Transaktionsabrufen. Der öffentliche Knoten erlaubt
 * rund 40 Aufrufe je Methode in zehn Sekunden; 150 ms (fast 70) liefen am
 * 10.10.2026 in HTTP 429. Eine eigene Adresse (Helius & Co.) darf schneller.
 */
const PAUSE_OEFFENTLICH_MS = 300
const PAUSE_EIGEN_MS = 120

/** Bei HTTP 429 so lange warten, dann erneut — danach gilt der Abruf als gescheitert. */
const WARTEN_BEI_429_MS = [2000, 6000]

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

/** Ein JSON-RPC-Aufruf — ohne Umleitungen, mit harter Zeitgrenze, zweimal geduldig bei 429. */
async function rpc(url, method, params, timeout = 15000) {
    for (let versuch = 0; ; versuch++) {
        const ctrl = new AbortController()
        const uhr = setTimeout(() => ctrl.abort(), timeout)
        try {
            const r = await fetch(url, {
                method: 'POST',
                redirect: 'error',
                signal: ctrl.signal,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            })
            if (r.status === 429 && versuch < WARTEN_BEI_429_MS.length) {
                const sagt = Number(r.headers.get('retry-after')) * 1000
                await pause(Number.isFinite(sagt) && sagt > 0 ? Math.min(sagt, 15000) : WARTEN_BEI_429_MS[versuch])
                continue
            }
            if (!r.ok) throw new Error(`RPC HTTP ${r.status}`)
            const j = await r.json()
            if (j?.error) {
                // Eine Antwort des Knotens, kein Ausfall — der Aufrufer darf sie überspringen.
                throw Object.assign(new Error(`RPC ${j.error.code ?? ''} ${String(j.error.message || '').slice(0, 120)}`), { rpcAntwort: true })
            }
            return j?.result ?? null
        } finally {
            clearTimeout(uhr)
        }
    }
}

/**
 * Neue Käufe aller beobachteten Wallets holen und speichern.
 *
 * @param {object} einst     Hype-Radar-Einstellungen (`smartWallets`)
 * @param {string} rpcUrl    eigene RPC-Adresse, leer = öffentlicher Knoten
 * @returns {Promise<{wallets:number, neu:number, fehler:number}>}
 */
export async function smartAbruf(einst, rpcUrl = '') {
    const wallets = smartWalletListe(einst?.smartWallets)
    if (!wallets.length) return { wallets: 0, neu: 0, fehler: 0 }
    const url = String(rpcUrl || '').trim() || OEFFENTLICH
    const abstand = url === OEFFENTLICH ? PAUSE_OEFFENTLICH_MS : PAUSE_EIGEN_MS
    await pruefeOeffentlicheUrl(url)

    const knex = getKnex()
    const staende = new Map((await knex('hype_smart_stand').whereIn('wallet', wallets.map((w) => w.adresse)))
        .map((z) => [z.wallet, z]))
    let budget = MAX_TX_JE_ABRUF
    let neu = 0
    let fehler = 0
    let letzterFehler = ''

    /*
     * Reihum: die am längsten nicht gelesene Wallet zuerst. Bis 10.10.2026 galt
     * die Reihenfolge der Liste — zwei rege Wallets oben verbrauchten das
     * Budget von 120 Transaktionen, und die Wallets weiter unten kamen nie dran.
     */
    const reihe = [...wallets].sort((a, b) =>
        (Number(staende.get(a.adresse)?.aktualisiertAm) || 0) - (Number(staende.get(b.adresse)?.aktualisiertAm) || 0))

    for (const w of reihe) {
        if (budget <= 0) break
        const alt = staende.get(w.adresse)
        try {
            const opts = { limit: alt?.letzteSignatur ? NEU_JE_WALLET : ERSTER_BLICK }
            if (alt?.letzteSignatur) opts.until = alt.letzteSignatur
            const sigs = (await rpc(url, 'getSignaturesForAddress', [w.adresse, opts])) || []
            let unlesbar = ''
            for (const sg of sigs.filter((x) => !x?.err).slice(0, budget)) {
                budget--
                await pause(abstand)
                /*
                 * Version 1: Gemessen am 10.10.2026 waren fünf von sechs
                 * pump.fun-Käufen v1-Transaktionen. Mit „höchstens 0" lehnt der
                 * Knoten jede davon ab (-32015) — und weil der Fehler die ganze
                 * Wallet abbrach, rückte ihr Lesezeichen nie vor: Sie hing für
                 * immer an derselben Transaktion.
                 */
                let tx
                try {
                    tx = await rpc(url, 'getTransaction', [sg.signature,
                        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }])
                } catch (e) {
                    // Der Knoten antwortet, kann aber DIESE Transaktion nicht liefern
                    // (künftige Version, übersprungener Slot): überspringen statt festhängen.
                    // Netz- und HTTP-Fehler brechen die Wallet ab; das Lesezeichen bleibt.
                    if (!e.rpcAntwort) throw e
                    unlesbar = e.message
                    continue
                }
                // Käufe UND Abgänge (negative Menge) — ein Kauf, der fünf Minuten
                // später wieder verkauft ist, darf nicht sechs Stunden lang zählen.
                for (const k of handelAusTransaktion(tx, w.adresse)) {
                    await knex('hype_smart_kaeufe').insert({
                        wallet: w.adresse, mint: k.mint, signatur: sg.signature,
                        zeit: k.zeit || (Number(sg.blockTime) > 0 ? Number(sg.blockTime) * 1000 : Date.now()),
                        menge: k.menge,
                    }).onConflict(['signatur', 'mint']).ignore()
                    neu++
                }
            }
            /*
             * Die jüngste Signatur als Lesezeichen — auch wenn das Budget
             * nicht für alle reichte. Ältere, ungelesene Käufe gehen dann
             * verloren; für ein FRÜHsignal ist das das kleinere Übel als eine
             * Warteschlange, die immer weiter hinterherläuft.
             */
            await knex('hype_smart_stand').insert({
                wallet: w.adresse, letzteSignatur: sigs[0]?.signature || alt?.letzteSignatur || '',
                aktualisiertAm: Date.now(), fehler: unlesbar ? `Transaktion übersprungen: ${unlesbar}`.slice(0, 200) : '',
            }).onConflict('wallet').merge()
        } catch (e) {
            fehler++
            letzterFehler = e.message
            logWarn('hype-smart', `${w.name || w.adresse.slice(0, 6)}: ${e.message}`)
            await knex('hype_smart_stand').insert({
                wallet: w.adresse, letzteSignatur: alt?.letzteSignatur || '',
                aktualisiertAm: Date.now(), fehler: String(e.message).slice(0, 200),
            }).onConflict('wallet').merge().catch(() => {})
        }
    }

    await knex('hype_smart_kaeufe').where('zeit', '<', Date.now() - AUFBEWAHREN_MS).del().catch(() => {})
    if (fehler && fehler >= wallets.length) throw new Error(letzterFehler)
    return { wallets: wallets.length, neu, fehler }
}

/**
 * Das Signal je Token aus den gespeicherten Käufen — jeder Durchgang liest es,
 * auch wenn gerade kein Abruf fällig war.
 *
 * @returns {Promise<Map<string, {wallets:number, namen:string[], erste:number}>>}
 */
export async function smartKarteLesen(einst, jetzt = Date.now()) {
    const wallets = smartWalletListe(einst?.smartWallets)
    if (!wallets.length) return new Map()
    try {
        const zeilen = await getKnex()('hype_smart_kaeufe')
            .where('zeit', '>=', jetzt - SMART_FENSTER_MS)
            .whereIn('wallet', wallets.map((w) => w.adresse))
        return smartSignale(zeilen, {
            jetzt, fensterMs: SMART_FENSTER_MS,
            namen: new Map(wallets.map((w) => [w.adresse, w.name])),
        })
    } catch {
        return new Map()
    }
}

/** Für die Oberfläche: je Wallet der letzte Abruf und ob er klappte. */
export async function smartWalletStand(einst) {
    const wallets = smartWalletListe(einst?.smartWallets)
    if (!wallets.length) return []
    const zeilen = await getKnex()('hype_smart_stand').whereIn('wallet', wallets.map((w) => w.adresse)).catch(() => [])
    const nach = new Map(zeilen.map((z) => [z.wallet, z]))
    return wallets.map((w) => ({
        ...w,
        aktualisiertAm: Number(nach.get(w.adresse)?.aktualisiertAm) || 0,
        fehler: nach.get(w.adresse)?.fehler || '',
    }))
}
