/**
 * Börsen-Beobachter — das Abrufen, Vergleichen und Melden.
 *
 * Alle dreissig Minuten (Vorgabe) werden die öffentlichen Marktlisten der
 * grossen und mittleren Börsen und die Token-Liste von Binance Alpha geholt,
 * mit dem letzten guten Stand verglichen und neue Einträge festgehalten. Zu
 * jeder neuen Listung steht, ob und seit wann der Radar den Token kannte
 * (`gedaechtnis.js`) — das ist die Antwort auf die eigentliche Frage: Waren wir
 * vorher drin?
 *
 * Gemeldet wird
 *   - eine neue Listung eines Radar-Tokens (sicherer oder plausibler Treffer),
 *   - die Aufnahme eines Radar-Tokens in Binance Alpha — die Vorstufe, das
 *     eigentliche Frühsignal für ein späteres Spot-Listing.
 *
 * Gerechnet wird in `boersenwacht-bewertung.js`; hier steht nur der Weg.
 *
 * ⚠ Die Endpunkte sind die öffentlich dokumentierten Marktlisten; gegen die
 * Live-Dienste nicht geprüft (keine Verbindung aus der Entwicklungsumgebung am
 * 07.10.2026). Der Binance-Alpha-Endpunkt ist der des Binance-Web-Frontends,
 * nicht offiziell dokumentiert. Jede Börse fällt einzeln aus; ein Ausfall oder
 * eine halbe Antwort überschreibt nie den letzten guten Stand.
 */

import { getKnex } from '../database.js'
import { logWarn } from '../logger.js'
import { beansprucheAufgabe, meldeFehler } from '../db-claim.js'
import { holeJson, dexDetailsViele } from './quellen.js'
import { leseEinstellungen } from './einstellungen.js'
import { stelleZu } from './zustellung.js'
import { radarWissen } from './gedaechtnis.js'
import {
    BOERSEN, BOERSE_NACH_ID, LESER, STARTS, neueEintraege, ordneZu, istTreffer, leiterFuer, vorlaufStatistik,
    eintragSchluessel, kuerzel, auchGelistetAuf,
} from './boersenwacht-bewertung.js'

export const QUELLEN = {
    'binance-alpha': 'https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list',
    'binance-spot': 'https://api.binance.com/api/v3/ticker/price',
    // exchangeInfo statt ticker/price: nur sie nennt Startzeit und angekündigte Kontrakte (Gewicht 1)
    'binance-futures': 'https://fapi.binance.com/fapi/v1/exchangeInfo',
    coinbase: 'https://api.exchange.coinbase.com/products',
    upbit: 'https://api.upbit.com/v1/market/all',
    okx: 'https://www.okx.com/api/v5/public/instruments?instType=SPOT',
    bybit: 'https://api.bybit.com/v5/market/instruments-info?category=spot',
    kraken: 'https://api.kraken.com/0/public/AssetPairs',
    kucoin: 'https://api.kucoin.com/api/v2/symbols',
    gate: 'https://api.gateio.ws/api/v4/spot/currency_pairs',
    mexc: 'https://api.mexc.com/api/v3/defaultSymbols',
    bitget: 'https://api.bitget.com/api/v2/spot/public/symbols',
}

/** Eine Listung wird je Börse und Kürzel höchstens einmal gemeldet. */
const MELDE_SPERRE_MS = 30 * 24 * 3600e3

/** Wie lange erkannte Listungen in der Liste bleiben. */
const AUFBEWAHREN_MS = 180 * 24 * 3600e3

const sicherJson = (t, r) => { try { return JSON.parse(t) ?? r } catch { return r } }

let laeuft = false
let letzter = null

/** Der letzte Lauf dieses Prozesses — für die Anzeige. */
export function boersenStand() {
    return { laeuft, letzter }
}

/**
 * Die Stände aller Börsen als Mengen — für `leiterFuer`. Kurz zwischen-
 * gespeichert: die Seite fragt sie bei jedem Laden.
 */
let staendeCache = null
export async function ladeStaende() {
    if (staendeCache && Date.now() - staendeCache.ts < 5 * 60e3) return staendeCache.karte
    const karte = new Map()
    try {
        for (const z of await getKnex()('hype_boersen_stand').select('boerse', 'eintraege')) {
            karte.set(z.boerse, new Set(sicherJson(z.eintraege, []).map(eintragSchluessel)))
        }
    } catch { /* Tabelle fehlt: leer */ }
    staendeCache = { ts: Date.now(), karte }
    return karte
}

/** Ein Durchgang. Gibt den Stand je Börse und die Zahl neuer Listungen zurück. */
export async function boersenLauf(einst) {
    if (laeuft) return { beschaeftigt: true }
    laeuft = true
    const beginn = Date.now()
    try {
        const e = await boersenLaufIntern(einst || await leseEinstellungen())
        letzter = { ...e, am: beginn }
        return e
    } catch (err) {
        letzter = { fehler: String(err.message || err).slice(0, 200), am: beginn }
        throw err
    } finally {
        laeuft = false
    }
}

async function boersenLaufIntern(einst) {
    const knex = getKnex()
    const jetzt = Date.now()
    const alt = new Map((await knex('hype_boersen_stand').select('*')).map((z) => [z.boerse, z]))

    // Eine Antwort, zwei Leser: was gelistet ist und — wo die Börse es nennt — seit wann.
    const antworten = await Promise.allSettled(BOERSEN.map(async (b) => {
        const roh = await holeJson(QUELLEN[b.id], { timeout: 20000 })
        return { liste: LESER[b.id](roh), starts: STARTS[b.id] ? STARTS[b.id](roh, jetzt) : null }
    }))

    const quellenStand = {}
    const neue = []
    for (const [i, a] of antworten.entries()) {
        const b = BOERSEN[i]
        const bisher = alt.get(b.id)
        if (a.status !== 'fulfilled') {
            const fehler = String(a.reason?.message || a.reason).slice(0, 160)
            quellenStand[b.id] = { ok: false, fehler }
            await knex('hype_boersen_stand').insert({ boerse: b.id, eintraege: bisher?.eintraege || '[]',
                anzahl: Number(bisher?.anzahl) || 0, aktualisiertAm: Number(bisher?.aktualisiertAm) || 0, fehler })
                .onConflict('boerse').merge(['fehler']).catch(() => {})
            continue
        }
        const { liste, starts } = a.value
        const r = neueEintraege(sicherJson(bisher?.eintraege, []), liste)
        if (r.uebernehmen) {
            await knex('hype_boersen_stand').insert({
                boerse: b.id, eintraege: JSON.stringify(liste), anzahl: liste.length,
                aktualisiertAm: jetzt, fehler: '',
                angekuendigt: JSON.stringify(starts?.angekuendigt || []),
            }).onConflict('boerse').merge()
        } else {
            await knex('hype_boersen_stand').where('boerse', b.id).update({ fehler: r.hinweis }).catch(() => {})
        }
        quellenStand[b.id] = r.uebernehmen
            ? { ok: true, anzahl: liste.length, neu: r.neu.length, hinweis: r.hinweis }
            : { ok: false, anzahl: liste.length, fehler: r.hinweis }
        for (const n of r.neu) {
            const l = typeof n === 'string'
                ? { boerse: b.id, symbol: n }
                : { boerse: b.id, symbol: n.symbol, chain: n.chain, contract: n.contract }
            l.handelsStart = starts?.laufend.get(kuerzel(l.symbol)) ?? null
            neue.push(l)
        }
    }
    staendeCache = null

    /*
     * Bewertungen auffrischen — für jeden gemeldeten Radar-Token, dessen
     * Kürzel irgendwo gelistet ist (neu oder schon länger).
     *
     * Für Kürzel-Treffer zählt die HEUTIGE Bewertung, nicht die vom ersten
     * Blick: Ein Token, den die Frühphase bei 200 000 USD sah, ist beim Listing
     * oft hundertmal so viel wert — und mit der alten Zahl gälte er als
     * Namensvetter. Gesammelte DexScreener-Abrufe, gedeckelt; die frischen
     * Werte gehen ins Gedächtnis zurück, damit auch die Leiter stimmt.
     */
    const wissen = await radarWissen()
    const gelistet = new Set(neue.map((l) => kuerzel(l.symbol)))
    for (const [id, set] of await ladeStaende()) {
        if (BOERSE_NACH_ID.get(id)?.stufe === 'alpha') continue
        for (const s of set) gelistet.add(s)
    }
    const auffrischen = wissen.filter((w) => w.contract && w.ersteMeldung && gelistet.has(kuerzel(w.symbol)))
    const vertraege = [...new Map(auffrischen.map((w) => [w.contract, { contract: w.contract, chain: w.chain }])).values()].slice(0, 90)
    if (vertraege.length) {
        const d = await dexDetailsViele(vertraege).catch(() => new Map())
        for (const w of auffrischen) {
            const x = d.get(String(w.contract).toLowerCase())
            const m = Number(x?.markt?.marktkapitalisierung) || Number(x?.markt?.fdv)
            if (!(m > 0)) continue
            w.bewertungUsd = m
            await knex('hype_gedaechtnis').where({ chain: w.chain, contract: w.contract })
                .update({ bewertungUsd: m }).catch(() => {})
        }
    }

    let gemeldet = 0
    if (neue.length) {

        for (const l of neue) {
            const z = ordneZu(l, wissen)
            const zeile = {
                boerse: l.boerse, symbol: kuerzel(l.symbol),
                chain: z.chain || l.chain || '', contract: z.contract || l.contract || '',
                gesehenAm: jetzt, radarSeit: z.radarSeit, radarGesehen: z.radarGesehen,
                radarQuelle: z.radarQuelle, treffer: z.treffer, bewertungUsd: z.bewertungUsd, gemeldet: 0,
                handelsStart: l.handelsStart,
            }
            await knex('hype_listungen_neu').insert(zeile).onConflict(['boerse', 'symbol']).ignore()
            const alleMelden = einst.boersenAlleMelden === true && BOERSE_NACH_ID.get(l.boerse)?.stufe === 'gross'
            if ((istTreffer(z) || alleMelden)
                && await beansprucheAufgabe(`hyplist|${l.boerse}|${zeile.symbol}`, MELDE_SPERRE_MS)) {
                await melde(knex, zeile, einst)
                gemeldet++
            }
        }
    }

    await knex('hype_listungen_neu').where('gesehenAm', '<', jetzt - AUFBEWAHREN_MS).del().catch(() => {})
    return { quellenStand, neu: neue.length, gemeldet }
}

/** Eine Listung melden — über die Kanäle des Wachhunds. */
async function melde(knex, zeile, einst) {
    const b = BOERSE_NACH_ID.get(zeile.boerse)
    const tage = zeile.radarSeit ? Math.max(0, (zeile.gesehenAm - zeile.radarSeit) / 86400e3) : null
    const alpha = b?.stufe === 'alpha'
    const alarm = {
        regel: alpha ? 'alpha' : 'listung',
        schwere: alpha || b?.stufe === 'gross' ? 'warnung' : 'info',
        meldung: `${zeile.symbol}: neu auf ${b?.name || zeile.boerse}`
            + (tage !== null ? ` — der Radar meldete ihn vor ${tage < 1 ? 'weniger als einem Tag' : `${Math.round(tage)} Tagen`}` : '')
            + (zeile.treffer === 'kuerzel' ? ' (Zuordnung über das Kürzel)' : ''),
        daten: { symbol: zeile.symbol, chain: zeile.chain, contract: zeile.contract, boerse: zeile.boerse },
    }
    try {
        await knex('hype_alarme').insert({
            favoritId: 0, regel: alarm.regel, schwere: alarm.schwere, meldung: alarm.meldung,
            daten: JSON.stringify(alarm.daten), erstelltAm: zeile.gesehenAm,
        })
        await knex('hype_listungen_neu').where({ boerse: zeile.boerse, symbol: zeile.symbol }).update({ gemeldet: 1 })
    } catch (e) {
        logWarn('hype-boersen', `Alarm speichern: ${e.message}`)
    }
    await stelleZu(alarm, { symbol: zeile.symbol, chain: zeile.chain }, einst)
        .catch((e) => logWarn('hype-boersen', `Zustellung: ${e.message}`))
}

/**
 * Für die Seite: Stand je Börse, die neuen Listungen, die Vorlaufstatistik
 * und die Leiter — Radar-Token, die schon auf Alpha oder mittleren Börsen
 * stehen, aber noch nicht auf den grossen.
 */
export async function boersenUebersicht({ tage = 60 } = {}) {
    const knex = getKnex()
    const seit = Date.now() - tage * 86400e3
    const staendeRoh = await knex('hype_boersen_stand').select('boerse', 'anzahl', 'aktualisiertAm', 'fehler', 'angekuendigt').catch(() => [])
    const nach = new Map(staendeRoh.map((z) => [z.boerse, z]))
    const listungen = await knex('hype_listungen_neu').where('gesehenAm', '>=', seit).orderBy('gesehenAm', 'desc').limit(300)

    const staende = await ladeStaende()
    const alleWissen = await radarWissen()
    const wissen = alleWissen.filter((w) => w.ersteMeldung)
    // Wo dasselbe Kürzel sonst noch steht — für neue wie für angekündigte Listungen.
    for (const z of listungen) z.auchAuf = auchGelistetAuf(z, staende)
    /*
     * Angekündigt: angelegt, aber noch nicht offen — mit Startzeit, wo die
     * Börse sie nennt. Was schon begonnen hat, fällt beim nächsten Abgleich
     * heraus und steht dann unter den neuen Listungen.
     */
    const angekuendigt = []
    for (const z of staendeRoh) {
        for (const a of sicherJson(z.angekuendigt, [])) {
            const r = ordneZu({ boerse: z.boerse, symbol: a.symbol }, alleWissen)
            angekuendigt.push({ boerse: z.boerse, symbol: a.symbol, start: a.start ?? null,
                auchAuf: auchGelistetAuf({ boerse: z.boerse, symbol: a.symbol }, staende),
                treffer: r.treffer, radarSeit: r.radarSeit, radarGesehen: r.radarGesehen })
        }
    }
    angekuendigt.sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity))
    // Je Vertrag einmal, mit der grössten bekannten Bewertung.
    const jeVertrag = new Map()
    for (const w of wissen) {
        const k = `${w.chain}|${w.contract}`
        const a = jeVertrag.get(k)
        if (!a || (Number(w.bewertungUsd) || 0) > (Number(a.bewertungUsd) || 0)) jeVertrag.set(k, w)
    }
    const leiter = []
    for (const w of jeVertrag.values()) {
        const l = leiterFuer(w, staende)
        if (!l.alpha && !l.mittel.length) continue
        leiter.push({ symbol: w.symbol, chain: w.chain, contract: w.contract, bewertungUsd: w.bewertungUsd,
            radarSeit: w.ersteMeldung, quelle: w.quelle, ...l })
    }
    // Wer noch NICHT oben ist, zuerst — das ist die Liste, auf die es ankommt.
    leiter.sort((a, b) => (a.gross.length - b.gross.length) || ((b.alpha ? 1 : 0) - (a.alpha ? 1 : 0))
        || (Number(a.radarSeit) - Number(b.radarSeit)))

    return {
        stand: { ...boersenStand() },
        boersen: BOERSEN.map((b) => ({
            ...b,
            anzahl: Number(nach.get(b.id)?.anzahl) || 0,
            aktualisiertAm: Number(nach.get(b.id)?.aktualisiertAm) || 0,
            fehler: nach.get(b.id)?.fehler || '',
        })),
        listungen,
        angekuendigt,
        statistik: vorlaufStatistik(listungen),
        leiter: leiter.slice(0, 50),
    }
}

/**
 * Der Takt: alle fünf Minuten nachsehen, ob ein Abgleich fällig ist.
 * Der Anspruch in der Datenbank hält das eingestellte Intervall.
 */
export function startBoersenTakt() {
    const uhr = setInterval(async () => {
        try {
            const einst = await leseEinstellungen()
            if (!einst.boersenwachtAn) return
            const minuten = Math.max(15, Number(einst.boersenwachtIntervallMin) || 30)
            if (!(await beansprucheAufgabe('hype_boersenwacht', minuten * 60e3 - 30e3))) return
            const e = await boersenLauf(einst)
            if (e?.gemeldet) console.log(` -> Börsen-Beobachter: ${e.neu} neue Listung(en), ${e.gemeldet} gemeldet`)
        } catch (e) {
            logWarn('hype-boersen', `Takt: ${e.message}`)
            await meldeFehler('hype_boersenwacht', e.message).catch(() => {})
        }
    }, 5 * 60e3)
    uhr.unref?.()
    return () => clearInterval(uhr)
}
