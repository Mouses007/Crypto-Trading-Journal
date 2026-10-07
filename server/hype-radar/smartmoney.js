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
 * ⚠ Nicht gegen einen Live-Knoten geprüft (keine Verbindung aus der
 * Entwicklungsumgebung am 07.10.2026). Die Antwortform ist die dokumentierte
 * JSON-RPC-Form; `kaeufeAusTransaktion` ist mit nachgebauten Transaktionen
 * getestet.
 */

import { getKnex } from '../database.js'
import { logWarn } from '../logger.js'
import { pruefeOeffentlicheUrl } from '../net-guard.js'
import { kaeufeAusTransaktion, smartSignale, smartWalletListe } from './fruehphase-bewertung.js'

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
const PAUSE_MS = 150

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

/** Ein JSON-RPC-Aufruf — ohne Umleitungen, mit harter Zeitgrenze. */
async function rpc(url, method, params, timeout = 15000) {
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
        if (!r.ok) throw new Error(`RPC HTTP ${r.status}`)
        const j = await r.json()
        if (j?.error) throw new Error(`RPC ${j.error.code ?? ''} ${String(j.error.message || '').slice(0, 120)}`)
        return j?.result ?? null
    } finally {
        clearTimeout(uhr)
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
    await pruefeOeffentlicheUrl(url)

    const knex = getKnex()
    const staende = new Map((await knex('hype_smart_stand').whereIn('wallet', wallets.map((w) => w.adresse)))
        .map((z) => [z.wallet, z]))
    let budget = MAX_TX_JE_ABRUF
    let neu = 0
    let fehler = 0
    let letzterFehler = ''

    for (const w of wallets) {
        if (budget <= 0) break
        const alt = staende.get(w.adresse)
        try {
            const opts = { limit: alt?.letzteSignatur ? NEU_JE_WALLET : ERSTER_BLICK }
            if (alt?.letzteSignatur) opts.until = alt.letzteSignatur
            const sigs = (await rpc(url, 'getSignaturesForAddress', [w.adresse, opts])) || []
            for (const sg of sigs.filter((x) => !x?.err).slice(0, budget)) {
                budget--
                await pause(PAUSE_MS)
                const tx = await rpc(url, 'getTransaction', [sg.signature,
                    { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }])
                for (const k of kaeufeAusTransaktion(tx, w.adresse)) {
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
                aktualisiertAm: Date.now(), fehler: '',
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
