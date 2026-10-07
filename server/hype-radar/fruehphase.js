/**
 * Hype-Radar, Frühphase — das Abrufen, Fortschreiben und Melden.
 *
 * Die Hauptprüfung des Radars sieht Token erst ab zwölf Stunden Paaralter und
 * 50 000 USD Liquidität. Diese Spur läuft davor: alle fünfzehn Minuten (Vorgabe)
 * holt sie, was gerade entsteht, schreibt je Token eine Momentaufnahme fort
 * und rechnet aus dem Verlauf die Beschleunigung (`fruehphase-bewertung.js`).
 *
 * Quellen, alle ohne Schlüssel:
 *
 *   pump.fun       die neuesten Starts und die grössten noch auf der Kurve
 *                  (kurz vor dem Abschluss) — mit Ersteller, Kommentarzahl
 *                  und den Links aus den Metadaten
 *   DexScreener    neue Token-Profile (jemand bezahlt dafür) und
 *                  Community-Übernahmen
 *   GeckoTerminal  neue Pools je Kette — mit der Zahl VERSCHIEDENER Käufer
 *   /biz/          4chan-Katalog: wer nennt welche Vertragsadresse
 *   Telegram       eingestellte öffentliche Kanäle, gelesen wie in den News
 *   Reddit         der RSS-Feed aus der Hauptspur
 *
 * Ein Token, der hier reift (alt und liquide genug), wandert beim nächsten
 * Scan als eigene Quelle in die Hauptprüfung (`reifeFunde`). Wer über die
 * Alarmschwelle steigt, wird gemeldet — über dieselben Kanäle wie der Wachhund.
 *
 * ⚠ Gegen die Live-Dienste nicht geprüft (keine Verbindung aus der
 * Entwicklungsumgebung am 07.10.2026): die pump.fun-Sortierung `market_cap`,
 * die DexScreener-Endpunkte `community-takeovers` und GeckoTerminal
 * `new_pools`. Jede Quelle fällt einzeln aus, ohne die anderen mitzunehmen;
 * was ausfiel, steht im Ergebnis unter `quellenStand`.
 */

import { getKnex } from '../database.js'
import { logWarn } from '../logger.js'
import { beansprucheAufgabe, meldeFehler } from '../db-claim.js'
import { holeText as holeGeschuetzt } from '../net-guard.js'
import { leseTelegram, telegramUrl } from '../feed-parser.js'
import { holeJson, dexDetailsViele, linksAusInfo, normChain, normSymbol, ausReddit, fund } from './quellen.js'
import { leseEinstellungen } from './einstellungen.js'
import { stelleZu } from './zustellung.js'
import { pruefeViele, gespeichertePruefung } from './projekt.js'
import { sucheXErwaehnungen } from '../news-recherche.js'
import { ladeLlmConfig, merkeKiGuthaben, istGuthabenFehler } from '../llm.js'
import {
    erwaehnungenIn, leseBizKatalog, momentaufnahme, naechsterVerlauf, bewerteFrueh, statusFrueh, xNennungen,
} from './fruehphase-bewertung.js'

/** Höchstens so viele Token werden gleichzeitig beobachtet. */
const MAX_BEOBACHTET = 150

/** So viele der Besten bekommen je Lauf eine Projektprüfung (24 h zwischengespeichert). */
const PROJEKT_JE_LAUF = 8

/** Nach so langer Funkstille fliegt ein Token aus der Beobachtung. */
const VERGESSEN_MS = 72 * 3600e3

/** Höchstens so viele Zeilen in der Tabelle. */
const MAX_ZEILEN = 3000

/*
 * X über Grok: bezahlt, deshalb mit eigenem, längerem Takt als die Frühphase
 * selbst. Zwischen zwei Abfragen gilt die letzte Messung je Token weiter —
 * sechs Stunden, dann ist sie kein Frühsignal mehr.
 */
const X_GILT_MS = 6 * 3600e3
const X_FENSTER_STUNDEN = 6
const X_TOKEN_JE_ABFRAGE = 15

/** Derselbe Token wird frühestens nach dieser Zeit erneut gemeldet. */
const ALARM_SPERRE_MS = 12 * 3600e3

const PUMP = 'https://frontend-api-v3.pump.fun'
const DEX = 'https://api.dexscreener.com'
const GECKO = 'https://api.geckoterminal.com/api/v2'

const sicherJson = (t, r) => { try { return JSON.parse(t) ?? r } catch { return r } }
const schluessel = (chain, contract) => `${chain}|${contract}`

/**
 * Einen Fund in die Sammelkarte eintragen oder ergänzen.
 */
function eintragen(karte, f) {
    if (!f.contract) return
    const chain = normChain(f.chain) || '?'
    const contract = chain === 'solana' ? String(f.contract) : String(f.contract).toLowerCase()
    const k = schluessel(chain, contract)
    if (!karte.has(k)) {
        karte.set(k, {
            chain, contract, symbol: '', name: '', quellen: new Set(), plattformen: new Set(),
            erwaehnungen: 0, links: null, ersteller: '', markt: {}, profil: false, erstelltAm: null,
        })
    }
    const e = karte.get(k)
    if (f.symbol && !e.symbol) e.symbol = normSymbol(f.symbol)
    if (f.name && !e.name) e.name = String(f.name).slice(0, 120)
    if (f.quelle) e.quellen.add(f.quelle)
    if (f.plattform) { e.plattformen.add(f.plattform); e.erwaehnungen += f.anzahl || 1 }
    if (f.links && !e.links) e.links = f.links
    if (f.ersteller && !e.ersteller) e.ersteller = f.ersteller
    if (f.profil) e.profil = true
    if (f.erstelltAm && !e.erstelltAm) e.erstelltAm = f.erstelltAm
    Object.assign(e.markt, Object.fromEntries(Object.entries(f.markt || {}).filter(([, v]) => v !== null && v !== undefined)))
    return e
}

// ── Quellen ─────────────────────────────────────────────────────────────

/** pump.fun: Coin-Objekt → Fund. */
function ausPumpCoin(c, quelle) {
    return {
        chain: 'solana',
        contract: String(c?.mint || ''),
        symbol: c?.symbol,
        name: c?.name,
        quelle,
        links: linksAusInfo(c),
        ersteller: String(c?.creator || ''),
        erstelltAm: Number(c?.created_timestamp) || null,
        markt: {
            marktKapUsd: Number(c?.usd_market_cap) || null,
            antworten: Number.isFinite(Number(c?.reply_count)) ? Number(c.reply_count) : null,
            graduiert: c?.complete === true,
        },
    }
}

async function pumpfun(einst) {
    const q = einst.fruehQuellen || {}
    const listen = []
    if (q.pumpfunNeu !== false) listen.push(['pumpfun-neu', 'created_timestamp'])
    /*
     * Die grössten Bewertungen, die noch auf der Kurve stehen — die Token
     * kurz vor dem Abschluss. Graduierte fallen heraus: die sind schon eine
     * Stufe weiter und kommen über DexScreener und GeckoTerminal.
     */
    if (q.pumpfunAufstieg !== false) listen.push(['pumpfun-aufstieg', 'market_cap'])
    const antworten = await Promise.allSettled(listen.map(([, sort]) =>
        holeJson(`${PUMP}/coins?limit=50&offset=0&sort=${sort}&order=DESC&includeNsfw=false`)))
    const raus = []
    antworten.forEach((a, i) => {
        if (a.status !== 'fulfilled') return
        for (const c of Array.isArray(a.value) ? a.value : []) {
            if (listen[i][0] === 'pumpfun-aufstieg' && c?.complete === true) continue
            raus.push(ausPumpCoin(c, listen[i][0]))
        }
    })
    // Nur wenn ALLES ausfiel, ist die Quelle ausgefallen.
    if (listen.length && antworten.every((a) => a.status === 'rejected')) throw antworten[0].reason
    return raus
}

async function dexscreenerProfile() {
    const raus = []
    const [profile, cto] = await Promise.allSettled([
        holeJson(`${DEX}/token-profiles/latest/v1`),
        holeJson(`${DEX}/community-takeovers/latest/v1`),
    ])
    for (const [ergebnis, quelle] of [[profile, 'dexscreener-profil'], [cto, 'dexscreener-cto']]) {
        if (ergebnis.status !== 'fulfilled') continue
        for (const p of (Array.isArray(ergebnis.value) ? ergebnis.value : []).slice(0, 40)) {
            raus.push({
                chain: p?.chainId, contract: p?.tokenAddress, quelle, profil: true,
                links: linksAusInfo(p),
            })
        }
    }
    if (profile.status === 'rejected' && cto.status === 'rejected') throw profile.reason
    return raus
}

/** GeckoTerminal-Kette ↔ unsere Kette. */
const GECKO_NETZ = { solana: 'solana', ethereum: 'eth', base: 'base', bsc: 'bsc' }

async function geckoNeu(einst) {
    const raus = []
    const ketten = (einst.ketten || ['solana', 'eth', 'base', 'bsc']).map(normChain)
    let versucht = 0
    let letzterFehler = null
    for (const kette of ketten) {
        const netz = GECKO_NETZ[kette]
        if (!netz) continue
        versucht++
        try {
            const j = await holeJson(`${GECKO}/networks/${netz}/new_pools?include=base_token&page=1`)
            const tokens = new Map((Array.isArray(j?.included) ? j.included : [])
                .filter((t) => t?.type === 'token').map((t) => [t.id, t.attributes || {}]))
            for (const p of (Array.isArray(j?.data) ? j.data : []).slice(0, 30)) {
                const a = p?.attributes || {}
                const basis = tokens.get(p?.relationships?.base_token?.data?.id) || {}
                const h1 = a.transactions?.h1 || {}
                const m5 = a.transactions?.m5 || null
                raus.push({
                    chain: kette, contract: basis.address, symbol: basis.symbol, name: basis.name,
                    quelle: 'geckoterminal-neu',
                    erstelltAm: Date.parse(a.pool_created_at || '') || null,
                    markt: {
                        preisUsd: Number(a.base_token_price_usd) || null,
                        liquiditaetUsd: Number.isFinite(Number(a.reserve_in_usd)) ? Number(a.reserve_in_usd) : null,
                        volumen1h: Number.isFinite(Number(a.volume_usd?.h1)) ? Number(a.volume_usd.h1) : null,
                        marktkapitalisierung: Number(a.market_cap_usd) || Number(a.fdv_usd) || null,
                        transaktionen1h: (Number(h1.buys) || 0) + (Number(h1.sells) || 0),
                        transaktionen5m: m5 ? (Number(m5.buys) || 0) + (Number(m5.sells) || 0) : null,
                        // Die Zahl VERSCHIEDENER Wallets — der beste Schutz
                        // gegen Kreishandel, den es ohne Schlüssel gibt.
                        kaeufer1h: Number.isFinite(Number(h1.buyers)) ? Number(h1.buyers) : null,
                        verkaeufer1h: Number.isFinite(Number(h1.sellers)) ? Number(h1.sellers) : null,
                        aenderung1h: Number.isFinite(Number(a.price_change_percentage?.h1)) ? Number(a.price_change_percentage.h1) : null,
                    },
                })
            }
        } catch (e) {
            letzterFehler = e
            logWarn('hype-frueh', `GeckoTerminal ${kette}: ${e.message}`)
        }
    }
    // Alle Ketten ausgefallen ist ein Ausfall, nicht „nichts Neues".
    if (versucht && !raus.length && letzterFehler) throw letzterFehler
    return raus
}

/**
 * Erwähnungen aus Texten — nur Vertragsadressen legen einen Token an.
 *
 * Ein Kürzel allein („$FROG") ist mehrdeutig; es zählt nur für einen Token,
 * den die Frühphase schon kennt, und nur, wenn genau einer so heisst.
 */
function erwaehnungen(texte, plattform) {
    const adressen = new Map()
    const kuerzel = new Map()
    for (const t of texte) {
        const e = erwaehnungenIn(t)
        for (const a of e.adressen) adressen.set(a, (adressen.get(a) || 0) + 1)
        for (const k of e.kuerzel) kuerzel.set(k, (kuerzel.get(k) || 0) + 1)
    }
    return { plattform, adressen, kuerzel }
}

async function biz() {
    const j = await holeJson('https://a.4cdn.org/biz/catalog.json')
    return erwaehnungen(leseBizKatalog(j).map((f) => f.text), 'biz')
}

async function telegram(kanaele) {
    const texte = []
    for (const name of (kanaele || []).slice(0, 15)) {
        const url = telegramUrl(name)
        if (!url) continue
        try {
            const html = await holeGeschuetzt(url, { timeout: 10000, versuche: 1 })
            // Nur die letzten sechs Stunden — ältere Rufe sind kein Frühsignal mehr.
            const grenze = Date.now() - 6 * 3600e3
            for (const b of leseTelegram(html)) if (!b.zeit || b.zeit >= grenze) texte.push(b.inhalt)
        } catch (e) {
            logWarn('hype-frueh', `Telegram ${name}: ${e.message}`)
        }
    }
    return erwaehnungen(texte, 'telegram')
}

async function reddit() {
    const funde = await ausReddit()
    const texte = funde.map((f) => `${f.symbol ? `$${f.symbol}` : ''} ${f.contract || ''}`)
    return erwaehnungen(texte, 'reddit')
}

/**
 * X über Grok (`x_search`): eine bezahlte Abfrage nach den bestbeobachteten
 * Token und nach neu beworbenen Adressen. Gezählt wird in `xNennungen` —
 * nur zitierte Posts, nur was im Text steht, Autoren statt Posts.
 *
 * Gibt dieselbe Form wie die übrigen Sozialquellen zurück; `anzahl` ist hier
 * die Zahl VERSCHIEDENER Autoren. `belege` trägt je Adresse bis zu drei
 * Post-Adressen für die Anzeige.
 */
async function xQuelle(einst, bekannt) {
    const beginn = Date.now()
    try {
        const cfg = await ladeLlmConfig({ provider: 'xai' })
        if (!cfg.apiKey) throw new Error('Kein xAI-Schlüssel hinterlegt (Einstellungen → KI)')
        // Dasselbe Modell wie die X-Suche der Nachrichten — eine Einstellung für „X".
        const s = await getKnex()('settings').select('radarNewsXModell').where('id', 1).first().catch(() => null)
        const auswahl = bekannt.filter((z) => z.contract).slice(0, X_TOKEN_JE_ABFRAGE)
        const { posts, zitierteIds, kostenUsd } = await sucheXErwaehnungen({
            token: auswahl.map((z) => ({ symbol: z.symbol, contract: z.contract })),
            stunden: X_FENSTER_STUNDEN,
            apiKey: cfg.apiKey,
            modell: s?.radarNewsXModell || undefined,
        })
        merkeKiGuthaben('xai').catch(() => {})
        const symbole = new Map()
        for (const z of bekannt) {
            if (!z.symbol) continue
            symbole.set(z.symbol, symbole.has(z.symbol) ? null : z.contract)
        }
        const n = xNennungen(posts, zitierteIds, { adressen: new Set(bekannt.map((z) => z.contract)), symbole })
        letzteX = { am: beginn, ok: true, posts: posts.length, gezaehlt: n.gezaehlt, verworfen: n.verworfen,
            token: n.adressen.size, kostenUsd: Math.round(kostenUsd * 10000) / 10000 }
        return {
            plattform: 'x',
            adressen: new Map([...n.adressen].map(([a, x]) => [a, x.autoren])),
            kuerzel: new Map(),
            belege: n.adressen,
        }
    } catch (e) {
        if (istGuthabenFehler(e.message)) await merkeKiGuthaben('xai', e.message).catch(() => {})
        letzteX = { am: beginn, ok: false, fehler: String(e.message || e).slice(0, 200) }
        throw e
    }
}

// ── Der Lauf ────────────────────────────────────────────────────────────

let laeuft = false

/** Der letzte Durchgang dieses Prozesses — für die Anzeige „welche Quelle fiel aus". */
let letzter = null

/** Die letzte X-Abfrage — sie läuft seltener als die Durchgänge und kostet. */
let letzteX = null

/** Stand für die Oberfläche: läuft gerade etwas, wie ging der letzte Durchgang aus, was kostete X. */
export function fruehStand() {
    return { laeuft, letzter, x: letzteX }
}

/**
 * Ein Durchgang der Frühphase.
 * @returns {Promise<{beobachtet:number, neu:number, alarme:number, quellenStand:object}>}
 */
export async function fruehLauf(einst) {
    if (laeuft) return { beschaeftigt: true }
    laeuft = true
    const beginn = Date.now()
    try {
        const e = await fruehLaufIntern(einst || await leseEinstellungen())
        letzter = { ...e, am: beginn, dauerMs: Date.now() - beginn }
        return e
    } catch (e) {
        letzter = { fehler: String(e.message || e).slice(0, 200), am: beginn, dauerMs: Date.now() - beginn }
        throw e
    } finally {
        laeuft = false
    }
}

async function fruehLaufIntern(einst) {
    const knex = getKnex()
    const jetzt = Date.now()
    const q = einst.fruehQuellen || {}
    const quellenStand = {}
    const karte = new Map()

    // Die beobachteten Token — vor den Quellen, weil die X-Abfrage nach
    // genau ihnen fragt.
    const bekannt = await knex('hype_frueh')
        .whereNot('status', 'verworfen')
        .andWhere('letzterBlick', '>=', jetzt - VERGESSEN_MS)
        .orderBy('note', 'desc')
        .limit(MAX_BEOBACHTET)

    // X ist bezahlt und hat seinen eigenen Takt (Anspruch in der Datenbank).
    const xFaellig = q.x === true && await beansprucheAufgabe('hype_frueh_x',
        Math.max(30, Number(einst.fruehXIntervallMin) || 120) * 60e3 - 30e3)

    // ── Quellen parallel; jede fällt für sich aus ───────────────────────
    const aufgaben = [
        ['pumpfun', q.pumpfunNeu !== false || q.pumpfunAufstieg !== false, () => pumpfun(einst)],
        ['dexscreener', q.dexscreenerProfile !== false, dexscreenerProfile],
        ['geckoterminal', q.geckoterminalNeu !== false, () => geckoNeu(einst)],
    ].filter(([, an]) => an)
    const sozial = [
        ['biz', q.biz !== false, biz],
        ['telegram', (einst.fruehTelegram || []).length > 0 && q.telegram !== false, () => telegram(einst.fruehTelegram)],
        ['reddit', q.reddit === true, reddit],
        ['x', xFaellig, () => xQuelle(einst, bekannt)],
    ].filter(([, an]) => an)

    const [funde, stimmen] = await Promise.all([
        Promise.allSettled(aufgaben.map(([, , f]) => f())),
        Promise.allSettled(sozial.map(([, , f]) => f())),
    ])
    funde.forEach((e, i) => {
        const name = aufgaben[i][0]
        if (e.status === 'fulfilled') {
            quellenStand[name] = { ok: true, anzahl: e.value.length }
            for (const f of e.value) eintragen(karte, f)
        } else {
            quellenStand[name] = { ok: false, fehler: String(e.reason?.message || e.reason).slice(0, 160) }
        }
    })

    // ── Bekannte Token dazunehmen ───────────────────────────────────────
    const bekanntNach = new Map(bekannt.map((z) => [schluessel(z.chain, z.contract), z]))
    for (const z of bekannt) {
        eintragen(karte, {
            chain: z.chain, contract: z.contract, symbol: z.symbol, name: z.name,
            links: sicherJson(z.links, null), ersteller: z.ersteller,
        })
    }

    // ── Soziale Erwähnungen zuordnen ────────────────────────────────────
    stimmen.forEach((e, i) => {
        const name = sozial[i][0]
        if (e.status !== 'fulfilled') {
            quellenStand[name] = { ok: false, fehler: String(e.reason?.message || e.reason).slice(0, 160) }
            return
        }
        const { plattform, adressen, kuerzel, belege } = e.value
        quellenStand[name] = { ok: true, anzahl: adressen.size, kuerzel: kuerzel.size }
        if (plattform === 'x') quellenStand[name] = { ...quellenStand[name], kostenUsd: letzteX?.kostenUsd ?? null }
        // Adressen: unbekannte Kette ist Solana (Base58) oder EVM (0x…) — die
        // Kette steht erst nach dem Detailabruf fest.
        for (const [adresse, anzahl] of adressen) {
            const passend = [...karte.values()].find((x) => (adresse.startsWith('0x')
                ? x.contract.toLowerCase() === adresse : x.contract === adresse))
            const eintrag = eintragen(karte, {
                chain: passend?.chain || (adresse.startsWith('0x') ? '?' : 'solana'),
                contract: passend?.contract || adresse, quelle: plattform, plattform, anzahl,
            })
            const beleg = belege?.get(adresse)
            if (eintrag && beleg) eintrag.xInfo = { autoren: beleg.autoren, belege: beleg.belege, am: jetzt }
        }
        const nachSymbol = new Map()
        for (const x of karte.values()) {
            if (!x.symbol) continue
            nachSymbol.set(x.symbol, nachSymbol.has(x.symbol) ? null : x)
        }
        for (const [k, anzahl] of kuerzel) {
            const ziel = nachSymbol.get(k)
            if (ziel) { ziel.plattformen.add(plattform); ziel.erwaehnungen += anzahl; ziel.quellen.add(plattform) }
        }
    })

    // ── Auswahl: Bekannte zuerst, dann Neue ─────────────────────────────
    const alle = [...karte.values()]
        .sort((a, b) => {
            const na = bekanntNach.get(schluessel(a.chain, a.contract))?.note ?? -1
            const nb = bekanntNach.get(schluessel(b.chain, b.contract))?.note ?? -1
            return (nb - na) || (b.plattformen.size - a.plattformen.size) || (b.quellen.size - a.quellen.size)
        })
        .slice(0, MAX_BEOBACHTET)

    // ── Marktdaten nachschlagen (DexScreener, gesammelt) ────────────────
    let details = new Map()
    try {
        details = await dexDetailsViele(alle.map((x) => x.contract))
    } catch (e) {
        quellenStand.details = { ok: false, fehler: String(e.message).slice(0, 160) }
    }
    for (const x of alle) {
        const d = details.get(String(x.contract).toLowerCase())
        if (!d) continue
        if (x.chain === '?' && d.chain) x.chain = normChain(d.chain)
        if (!x.symbol && d.symbol) x.symbol = d.symbol
        if (!x.name && d.name) x.name = d.name
        if (!x.links && d.markt?.links) x.links = d.markt.links
        // GeckoTerminal-Käuferzahlen nicht mit `null` aus DexScreener überschreiben.
        for (const [f, w] of Object.entries(d.markt || {})) {
            if (w === null || w === undefined) continue
            if (x.markt[f] === undefined || x.markt[f] === null) x.markt[f] = w
            else if (['liquiditaetUsd', 'volumen1h', 'transaktionen1h', 'transaktionen5m', 'preisUsd', 'aenderung1h', 'kaufVerkauf1h'].includes(f)) {
                x.markt[f] = w   // DexScreener ist für diese Felder die aktuellere Quelle
            }
        }
    }

    // ── Bewerten (erster Durchgang) ─────────────────────────────────────
    const ergebnisse = []
    for (const x of alle.filter((y) => y.chain !== '?' && (y.symbol || y.markt.preisUsd))) {
        const alt = bekanntNach.get(schluessel(x.chain, x.contract))
        const verlauf = sicherJson(alt?.verlauf, [])
        /*
         * X läuft seltener als die Durchgänge. Ohne Fortschreiben fiele die
         * Plattform zwischen zwei Abfragen aus der Note und kehrte bei der
         * nächsten als „Schub" zurück — ein Sägezahn aus dem Abfragetakt.
         */
        const altX = sicherJson(alt?.stand, {})?.x
        x.xInfo = x.xInfo || (altX && Number(altX.am) >= jetzt - X_GILT_MS ? altX : null)
        const plattformen = new Set(x.plattformen)
        let erwaehnungen = x.erwaehnungen
        if (x.xInfo && !plattformen.has('x')) { plattformen.add('x'); erwaehnungen += Number(x.xInfo.autoren) || 0 }
        const stand = momentaufnahme(x.markt, { erwaehnungen, plattformen: [...plattformen] }, jetzt)
        const gespeichert = await gespeichertePruefung({ chain: x.chain, contract: x.contract })
        const r = bewerteFrueh({
            stand, verlauf, links: x.links, profil: x.profil,
            projektNote: gespeichert?.note ?? alt?.projektNote ?? null,
            ersteller: gespeichert?.fakten?.ersteller || null,
        })
        ergebnisse.push({ x, alt, verlauf, stand, r, projektNote: gespeichert?.note ?? alt?.projektNote ?? null })
    }

    // ── Projektprüfung für die Besten, dann neu bewerten ────────────────
    if (einst.projektPruefung !== false) {
        const kandidaten = [...ergebnisse].sort((a, b) => b.r.note - a.r.note).slice(0, PROJEKT_JE_LAUF)
        await pruefeViele(kandidaten.map((e) => ({
            symbol: e.x.symbol, name: e.x.name, chain: e.x.chain, contract: e.x.contract,
            links: e.x.links, ersteller: e.x.ersteller,
        })), {
            jeFertig: (_, p, fehler, i) => {
                const e = kandidaten[i]
                if (!p) {
                    logWarn('hype-frueh', `Projektprüfung ${e.x.symbol}: ${fehler?.message}`)
                    return
                }
                e.projektNote = p.note
                e.r = bewerteFrueh({
                    stand: e.stand, verlauf: e.verlauf, links: e.x.links, profil: e.x.profil,
                    projektNote: p.note, ersteller: p.fakten?.ersteller || null,
                })
            },
        })
    }

    // ── Schreiben und melden ────────────────────────────────────────────
    let neu = 0
    let alarme = 0
    const schwelle = Number(einst.fruehAlarmAb) || 0
    for (const e of ergebnisse) {
        const { x, alt, r } = e
        const erster = Number(alt?.ersterBlick) || jetzt
        const geboren = x.erstelltAm || (Number.isFinite(x.markt.paarAlterStunden) ? jetzt - x.markt.paarAlterStunden * 3600e3 : erster)
        const alterStunden = (jetzt - geboren) / 3600e3
        const { status, grund } = statusFrueh(e.stand, alterStunden, r.befunde)
        const verlauf = naechsterVerlauf(e.verlauf, { ...e.stand, note: r.note })
        const quellenAlt = sicherJson(alt?.quellen, [])
        const zeile = {
            chain: x.chain,
            contract: x.contract,
            symbol: x.symbol || alt?.symbol || '',
            name: x.name || alt?.name || '',
            quellen: JSON.stringify([...new Set([...quellenAlt, ...x.quellen])].slice(0, 20)),
            links: JSON.stringify(x.links || sicherJson(alt?.links, {}) || {}),
            ersteller: x.ersteller || alt?.ersteller || '',
            ersterBlick: erster,
            letzterBlick: jetzt,
            stand: JSON.stringify({ ...e.stand, alterStunden, teilnoten: r.teilnoten, trend: r.trend, x: x.xInfo || null,
                graduiert: x.markt.graduiert === true }),
            verlauf: JSON.stringify(verlauf),
            note: r.note,
            befunde: JSON.stringify(r.befunde),
            projektNote: Number.isFinite(e.projektNote) ? e.projektNote : null,
            status,
            grund,
        }
        await knex('hype_frueh').insert(zeile).onConflict(['chain', 'contract']).merge()
        if (!alt) neu++

        /*
         * Melden beim ÜBERSCHREITEN der Schwelle, nicht solange darüber — und
         * je Token höchstens alle zwölf Stunden, über einen Anspruch in der
         * Datenbank (NAS und Entwicklungsrechner takten beide).
         */
        const vorher = Number(alt?.note) || 0
        if (schwelle > 0 && status !== 'verworfen' && r.note >= schwelle && vorher < schwelle
            && await beansprucheAufgabe(`hypfrueh|${x.chain}|${x.contract}`, ALARM_SPERRE_MS)) {
            alarme++
            await melde(knex, zeile, r, einst, jetzt)
        }
    }

    await raeumeAuf(knex, jetzt)
    return { beobachtet: ergebnisse.length, neu, alarme, quellenStand }
}

/** Einen Frühphasen-Alarm speichern und zustellen. */
async function melde(knex, zeile, r, einst, jetzt) {
    const gruende = r.befunde.filter((b) => b.art === 'plus').slice(0, 3).map((b) => b.text).join('; ')
    const alarm = {
        regel: 'fruehsignal',
        schwere: 'warnung',
        meldung: `${zeile.symbol || zeile.contract.slice(0, 8)}: Frühsignal ${r.note}${gruende ? ` — ${gruende}` : ''}`,
        daten: { symbol: zeile.symbol, chain: zeile.chain, contract: zeile.contract, note: r.note },
    }
    try {
        // Ohne Favorit: `favoritId` 0. Die Liste zeigt das Symbol aus `daten`.
        await knex('hype_alarme').insert({
            favoritId: 0, regel: alarm.regel, schwere: alarm.schwere, meldung: alarm.meldung,
            daten: JSON.stringify(alarm.daten), erstelltAm: jetzt,
        })
        await knex('hype_frueh').where({ chain: zeile.chain, contract: zeile.contract }).update({ alarmiertAm: jetzt })
    } catch (e) {
        logWarn('hype-frueh', `Alarm speichern: ${e.message}`)
    }
    await stelleZu(alarm, { symbol: zeile.symbol, chain: zeile.chain }, einst)
        .catch((e) => logWarn('hype-frueh', `Zustellung: ${e.message}`))
}

/** Vergessen, was lange still ist, und die Tabelle deckeln. */
async function raeumeAuf(knex, jetzt) {
    try {
        await knex('hype_frueh').where('letzterBlick', '<', jetzt - VERGESSEN_MS).del()
        await knex('hype_frueh').where('status', 'verworfen').andWhere('letzterBlick', '<', jetzt - 24 * 3600e3).del()
        const n = Number((await knex('hype_frueh').count({ n: '*' }).first())?.n) || 0
        if (n > MAX_ZEILEN) {
            const weg = await knex('hype_frueh').select('id').orderBy('letzterBlick', 'asc').limit(n - MAX_ZEILEN)
            await knex('hype_frueh').whereIn('id', weg.map((z) => z.id)).del()
        }
    } catch (e) {
        logWarn('hype-frueh', `Aufräumen: ${e.message}`)
    }
}

/** Plattformen, auf denen Menschen reden — im Gegensatz zu Ketten, die handeln. */
const SOZIALE_PLATTFORMEN = ['telegram', 'biz', 'reddit', 'x']

/**
 * Reife Token als Funde für die Hauptprüfung.
 *
 * Eigene Quelle `fruehphase` (Domäne onchain: der Token wurde über Stunden
 * gehandelt gesehen). Wo er in Telegram-Kanälen oder auf /biz/ genannt wurde,
 * (oder auf X) kommt je Plattform ein Fund der Domäne `social` dazu — die Belege aus der
 * Beobachtung sollen nicht verloren gehen. Reddit nicht: das fragt die
 * Hauptprüfung selbst, ein zweiter Fund wäre dieselbe Stimme doppelt.
 *
 * `sozial.fruehPlattformen` trägt die Zahl der Plattformen in die
 * Sozial-Teilnote (`noteSozial`).
 */
export async function reifeFunde() {
    try {
        const zeilen = await getKnex()('hype_frueh').where('status', 'reif')
            .andWhere('letzterBlick', '>=', Date.now() - 24 * 3600e3)
            .orderBy('note', 'desc').limit(20)
        const funde = []
        zeilen.forEach((z, i) => {
            const quellen = sicherJson(z.quellen, [])
            const sozial = SOZIALE_PLATTFORMEN.filter((p) => quellen.includes(p))
            const basis = {
                symbol: z.symbol, name: z.name, chain: z.chain, contract: z.contract, rang: i + 1,
                markt: { links: sicherJson(z.links, null), ersteller: z.ersteller || '' },
            }
            funde.push(fund({ ...basis, quelle: 'fruehphase',
                sozial: sozial.length ? { fruehPlattformen: sozial.length } : {} }))
            for (const p of ['telegram', 'biz', 'x']) if (sozial.includes(p)) funde.push(fund({ ...basis, quelle: p }))
        })
        return funde
    } catch {
        return []
    }
}

/**
 * Der Takt: alle fünf Minuten nachsehen, ob ein Durchgang fällig ist.
 * Der Anspruch in der Datenbank hält das eingestellte Intervall.
 */
export function startFruehTakt() {
    const uhr = setInterval(async () => {
        try {
            const einst = await leseEinstellungen()
            if (!einst.fruehAktiv) return
            const minuten = Math.max(5, Number(einst.fruehIntervallMin) || 15)
            if (!(await beansprucheAufgabe('hype_frueh', minuten * 60e3 - 30e3))) return
            const e = await fruehLauf(einst)
            if (e?.alarme) console.log(` -> Hype-Frühphase: ${e.beobachtet} beobachtet, ${e.alarme} gemeldet`)
        } catch (e) {
            logWarn('hype-frueh', `Takt: ${e.message}`)
            await meldeFehler('hype_frueh', e.message).catch(() => {})
        }
    }, 5 * 60e3)
    uhr.unref?.()
    return () => clearInterval(uhr)
}
