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
 *   pump.fun       die neuesten Starts und was gerade auf der Kurve gehandelt
 *                  wird — mit Ersteller, Kommentarzahl und den Links aus den
 *                  Metadaten
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
 * Jede Quelle fällt einzeln aus, ohne die anderen mitzunehmen; was ausfiel,
 * steht im Ergebnis unter `quellenStand`. Der erste echte Lauf (07.10.2026)
 * hat pump.fun (beide Listen, nachgemessen), DexScreener-Profile und
 * -Übernahmen sowie GeckoTerminal `new_pools` bestätigt — und vier Fehler in
 * der Rechnung gefunden, die jetzt an Ort und Stelle beschrieben sind:
 * Altersartefakt im Handelsschub (`jeMinute`), Meldungen aus ein, zwei
 * Teilnoten und ohne Vertragsprüfung (`meldefaehig`), und alte Token aus der
 * Übernahmen-Liste (`MAX_ALTER_STUNDEN`).
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
    erwaehnungenIn, leseBizKatalog, momentaufnahme, naechsterVerlauf, bewerteFrueh, statusFrueh, xNennungen, risikoFrueh,
    risikoUnpruefbar, meldefaehig, hatMessung, verteilePlaetze, MAX_ALTER_STUNDEN,
} from './fruehphase-bewertung.js'
import { ausRugCheck, holeGoPlus } from './sicherheit.js'
import { ladeListungen, pruefeListung } from './listungen.js'
import { smartAbruf, smartKarteLesen } from './smartmoney.js'
import { legeAnFrueh } from '../radar-ergebnisse.js'
import { merke, MERKEN_AB_NOTE } from './gedaechtnis.js'

/** Höchstens so viele Token werden gleichzeitig beobachtet. */
const MAX_BEOBACHTET = 150

/*
 * So viele Plätze je Durchgang gehören NEUEN Token. Bis 07.10.2026 bekamen
 * bekannte Token alle Plätze zuerst: 142 neue im ersten Durchgang, dann 9,
 * dann 4 — bei rund hundert Funden allein von pump.fun je Lauf. Eine Spur,
 * die „früh" heisst, darf nicht nach dem ersten Lauf aufhören zu suchen.
 */
const NEU_PLAETZE = 50

/** So viele der Besten bekommen je Lauf eine Projektprüfung (24 h zwischengespeichert). */
const PROJEKT_JE_LAUF = 8

/** So lange bleibt eine Projektprüfung in `hype_projekt` stehen. */
const PROJEKT_AUFBEWAHREN_MS = 90 * 24 * 3600e3

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

/*
 * Risiko und Halter (RugCheck / GoPlus): die Besten eines Durchgangs, je
 * Token höchstens alle 30 Minuten neu — die Halterzahl bewegt sich in der
 * ersten Stunde schnell, aber nicht im Minutentakt. Ein älteres Urteil gilt
 * sechs Stunden weiter; die Halterzahl NICHT (siehe `momentaufnahme`).
 */
const RISIKO_JE_LAUF = 8
const RISIKO_NEU_MS = 30 * 60e3
const RISIKO_GILT_MS = 6 * 3600e3

/** Derselbe Token wird frühestens nach dieser Zeit erneut gemeldet. */
const ALARM_SPERRE_MS = 12 * 3600e3

const PUMP = 'https://frontend-api-v3.pump.fun'
const DEX = 'https://api.dexscreener.com'
const GECKO = 'https://api.geckoterminal.com/api/v2'

const sicherJson = (t, r) => { try { return JSON.parse(t) ?? r } catch { return r } }
const schluessel = (chain, contract) => `${chain}|${contract}`

/*
 * Zahl oder unbekannt. `Number(null)` ist 0 und `Number.isFinite(0)` wahr —
 * bis 10.10.2026 wurde so ein fehlendes `reserve_in_usd` zu „0 USD
 * Liquidität", eine fehlende Kursänderung zu „Preis steht" (und damit zum
 * halben Wash-Verdacht), eine fehlende Käuferzahl zu „0 Käufer".
 */
const zn = (w) => (w === null || w === undefined || w === '' || !Number.isFinite(Number(w)) ? null : Number(w))

/*
 * Kauf-/Verkaufszahlen eines GeckoTerminal-Pools für ein Stundenfenster. Alle
 * Werte aus DEMSELBEN Pool — Wallets und Transaktionen gehören für den
 * Kreishandel-Vergleich zusammen.
 */
function geckoFenster(h1) {
    if (!h1) return {}
    const kaeufe = zn(h1.buys)
    const verkaeufe = zn(h1.sells)
    return {
        kaeufe1h: kaeufe, verkaeufe1h: verkaeufe,
        poolTx1h: kaeufe !== null && verkaeufe !== null ? kaeufe + verkaeufe : null,
        // Die Zahl VERSCHIEDENER Wallets — der beste Schutz gegen
        // Kreishandel, den es ohne Schlüssel gibt.
        kaeufer1h: zn(h1.buyers), verkaeufer1h: zn(h1.sellers),
    }
}

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
            erwaehnungen: 0, links: null, ersteller: '', markt: {}, profil: false, erstelltAm: null, kurve: null,
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
    if (f.kurve?.length && !e.kurve) e.kurve = f.kurve
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
        // Die Bindungskurve als Halter — die Risikoprüfung nimmt sie aus der
        // Top-10-Rechnung. Felder aus dem pump.fun-Frontend-API, nicht live geprüft.
        kurve: [c?.bonding_curve, c?.associated_bonding_curve].filter(Boolean).map(String),
        markt: {
            marktKapUsd: Number(c?.usd_market_cap) || null,
            antworten: zn(c?.reply_count),
            graduiert: c?.complete === true,
            kothMin: kothMinuten(c),
            // Millisekunden (live geprüft 10.10.2026) — der Zeitpunkt, nicht nur die Dauer.
            kothAm: Number(c?.king_of_the_hill_timestamp) > 0 ? Number(c.king_of_the_hill_timestamp) : null,
        },
    }
}

/** Minuten vom Start bis „King of the Hill" — null, wenn nie erreicht. */
function kothMinuten(c) {
    const koth = Number(c?.king_of_the_hill_timestamp)
    const start = Number(c?.created_timestamp)
    return koth > 0 && start > 0 && koth >= start ? (koth - start) / 60e3 : null
}

/*
 * pump.fun-Token erkennt man an der Kurve, an der Quelle oder am Handelsplatz —
 * nicht an der Endung „pump": 390 von 1730 Solana-Token mit pump.fun-Kurve
 * endeten anders (gemessen 10.10.2026). Für sie wurde nie eine
 * Ersteller-Bilanz geholt, und die Bindungskurve galt nicht als Kurve.
 */
const istPump = (x, quellenAlt = []) => x.chain === 'solana' && (
    /pump$/i.test(String(x.contract || ''))
    || (Array.isArray(x.kurve) && x.kurve.length > 0)
    || [...(x.quellen || []), ...quellenAlt].some((q) => String(q).startsWith('pumpfun'))
    || ['pumpfun', 'pumpswap'].includes(String(x.markt?.dex || '')))

/**
 * Vertrag und Halter eines Tokens. Solana zuerst bei RugCheck — nur dort gibt
 * es die Insider-Markierung —, GoPlus als Rückfall; EVM bei GoPlus.
 */
export async function holeRisiko(chain, contract) {
    if (chain === 'solana') {
        try {
            const r = ausRugCheck(await holeJson(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(contract)}/report`))
            if (r) return r
        } catch { /* GoPlus versuchen */ }
    }
    return holeGoPlus(chain, contract)
}

/** Höchstens drei gleichzeitig — dieselbe Bremse wie bei der Projektprüfung. */
async function jeDrei(liste, fn) {
    let i = 0
    const arbeiter = async () => { while (i < liste.length) await fn(liste[i++]) }
    await Promise.all(Array.from({ length: Math.min(3, liste.length) }, arbeiter))
}

async function pumpfun(einst) {
    const q = einst.fruehQuellen || {}
    const listen = []
    if (q.pumpfunNeu !== false) listen.push(['pumpfun-neu', 'sort=created_timestamp'])
    /*
     * Was gerade auf der Kurve gehandelt wird. Graduierte fallen heraus: die
     * sind schon eine Stufe weiter und kommen über DexScreener und
     * GeckoTerminal.
     *
     * Bis 07.10.2026 stand hier `sort=market_cap` mit der Absicht „die
     * grössten, die noch auf der Kurve stehen". Gemessen liefert das die
     * fünfzig grössten GRADUIERTEN aller Zeiten (oben USDF mit 959 Mio USD),
     * die der Filter danach alle verwarf — die Liste war immer leer, und King
     * of the Hill wurde nie gesehen. Mit `complete=false` kommen Leichen, die
     * seit über 400 Tagen auf der Kurve hängen; ein Altersfilter in der
     * Abfrage (`created_timestamp_gte`) wird ignoriert. Die Sortierung nach
     * dem letzten Handel lieferte 50 Token auf der Kurve, 45 davon jünger als
     * ein Tag; den Rest nimmt `MAX_ALTER_STUNDEN`.
     */
    if (q.pumpfunAufstieg !== false) listen.push(['pumpfun-aufstieg', 'sort=last_trade_timestamp&complete=false'])
    /*
     * Nacheinander, nicht gleichzeitig: Der zweite gleichzeitige Abruf bekam
     * HTTP 429 und fiel still aus — die Quelle gilt erst als ausgefallen, wenn
     * ALLE ihre Abrufe scheitern.
     */
    const raus = []
    let ok = 0
    let letzterFehler = null
    for (const [quelle, abfrage] of listen) {
        try {
            const j = await holeJson(`${PUMP}/coins?limit=50&offset=0&${abfrage}&order=DESC&includeNsfw=false`)
            ok++
            for (const c of Array.isArray(j) ? j : []) {
                if (quelle === 'pumpfun-aufstieg' && c?.complete === true) continue
                raus.push(ausPumpCoin(c, quelle))
            }
        } catch (e) {
            letzterFehler = e
            logWarn('hype-frueh', `pump.fun ${quelle}: ${e.message}`)
        }
    }
    if (listen.length && !ok) throw letzterFehler
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
                // Fehlt das Fenster, bleibt es unbekannt — als 0 hiesse es „kein
                // Handel", und das verwirft einen Token (`still`).
                const h1 = a.transactions?.h1 || null
                const m5 = a.transactions?.m5 || null
                raus.push({
                    chain: kette, contract: basis.address, symbol: basis.symbol, name: basis.name,
                    quelle: 'geckoterminal-neu',
                    erstelltAm: Date.parse(a.pool_created_at || '') || null,
                    markt: {
                        preisUsd: zn(a.base_token_price_usd) || null,
                        liquiditaetUsd: zn(a.reserve_in_usd),
                        volumen1h: zn(a.volume_usd?.h1),
                        marktkapitalisierung: zn(a.market_cap_usd) || zn(a.fdv_usd) || null,
                        transaktionen1h: h1 ? (zn(h1.buys) ?? 0) + (zn(h1.sells) ?? 0) : null,
                        transaktionen5m: m5 ? (zn(m5.buys) ?? 0) + (zn(m5.sells) ?? 0) : null,
                        ...geckoFenster(h1),
                        aenderung1h: zn(a.price_change_percentage?.h1),
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

/** So viele Adressen nimmt GeckoTerminal je Sammelabruf. */
const GECKO_SAMMEL = 30

/**
 * Käufer, Verkäufer und Transaktionen des Hauptpools für ALLE beobachteten
 * Token — `tokens/multi/{adressen}?include=top_pools`, je Kette in Häppchen
 * zu dreissig, auch für pump.fun-Kurven (Dex `pump-fun`, live geprüft am
 * 10.10.2026).
 *
 * Bis dahin kamen diese Zahlen nur aus `new_pools`, also nur im ersten
 * Durchgang eines ganz neuen Pools. Die Teilnote Beteiligung war danach
 * „unbekannt", die Note sprang zwischen zwei Mittelwerten hin und her, und
 * der Kreishandel-Abzug galt nur für Neue — HOTBOT (274 Transaktionen von 11
 * Wallets) und XBC (277 von 10) liefen durch.
 *
 * @returns {Promise<{karte: Map<string, object>, versucht:number, fehler:string}>}
 *          Adresse (klein) → Marktfelder
 */
async function geckoMarkt(eintraege) {
    const karte = new Map()
    const jeNetz = new Map()
    for (const x of eintraege) {
        const netz = GECKO_NETZ[x.chain]
        if (!netz || !x.contract) continue
        if (!jeNetz.has(netz)) jeNetz.set(netz, [])
        jeNetz.get(netz).push(String(x.contract))
    }
    let versucht = 0
    let gescheitert = 0
    let fehler = ''
    let gefragt = 0
    for (const [netz, adressen] of jeNetz) {
        gefragt += adressen.length
        for (let i = 0; i < adressen.length; i += GECKO_SAMMEL) {
            const teil = adressen.slice(i, i + GECKO_SAMMEL)
            versucht++
            try {
                const j = await holeJson(`${GECKO}/networks/${netz}/tokens/multi/${teil.map(encodeURIComponent).join(',')}?include=top_pools`)
                const pools = new Map((Array.isArray(j?.included) ? j.included : [])
                    .filter((p) => p?.type === 'pool').map((p) => [p.id, p]))
                for (const t of Array.isArray(j?.data) ? j.data : []) {
                    const adresse = String(t?.attributes?.address || '').toLowerCase()
                    // Der erste der Hauptpools ist der liquideste — dort findet der Handel statt.
                    const pool = (t?.relationships?.top_pools?.data || []).map((r) => pools.get(r.id)).find(Boolean)
                    const h1 = pool?.attributes?.transactions?.h1 || null
                    if (!adresse || !h1) continue
                    karte.set(adresse, geckoFenster(h1))
                }
            } catch (e) {
                gescheitert++
                fehler = String(e.message).slice(0, 160)
                logWarn('hype-frueh', `GeckoTerminal Käufer ${netz}: ${e.message}`)
            }
        }
    }
    return { karte, versucht, gescheitert, gefragt, fehler }
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
async function xQuelle(einst, bekannt, kuerzelErlaubt = () => false) {
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
        // Kürzel nur eindeutig unter den Bekannten und ohne gelisteten Namensvetter.
        const symbole = new Map()
        for (const z of bekannt) {
            if (!z.symbol || !kuerzelErlaubt(z.symbol)) continue
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

    /*
     * Favoriten (Stern) werden immer gemessen und nie verdrängt: Wer einen
     * Token beobachten will, will ihn auch dann sehen, wenn seine Note fällt.
     */
    const favoriten = await knex('hype_favoriten').select('chain', 'contractAddress')
        .whereNot('quelle', 'coinradar').catch(() => [])
    const favorit = new Set(favoriten.filter((f) => f.contractAddress)
        .map((f) => schluessel(normChain(f.chain), normChain(f.chain) === 'solana' ? f.contractAddress : String(f.contractAddress).toLowerCase())))

    // Die beobachteten Token — vor den Quellen, weil die X-Abfrage nach
    // genau ihnen fragt. Favoriten dazu, auch wenn ihre Note niedrig ist.
    const nachNote = await knex('hype_frueh')
        .whereNot('status', 'verworfen')
        .andWhere('letzterBlick', '>=', jetzt - VERGESSEN_MS)
        .orderBy('note', 'desc')
        .limit(MAX_BEOBACHTET)
    const favZeilen = favorit.size
        ? (await knex('hype_frueh').whereNot('status', 'verworfen').andWhere('letzterBlick', '>=', jetzt - VERGESSEN_MS)
            .whereIn('contract', [...favorit].map((k) => k.split('|')[1])))
            .filter((z) => favorit.has(schluessel(z.chain, z.contract)))
        : []
    const bekannt = [...new Map([...favZeilen, ...nachNote].map((z) => [schluessel(z.chain, z.contract), z])).values()]

    /*
     * Ein $KÜRZEL ist nur dann ein Hinweis auf UNSEREN Token, wenn kein
     * gelisteter Coin so heisst. Bis 10.10.2026 zählte jede „$SOL"-Nennung
     * für einen pump.fun-Klon namens SOL. Ohne Börsenlisten lässt sich das
     * nicht ausschliessen — dann zählen Kürzel gar nicht.
     */
    const listen = await ladeListungen().catch(() => null)
    const kuerzelErlaubt = (sym) => {
        if (!listen || !sym) return false
        const p = pruefeListung(sym, listen)
        return p.unbekannt.length === 0 && p.liste.length === 0
    }

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
        ['x', xFaellig, () => xQuelle(einst, bekannt, kuerzelErlaubt)],
    ].filter(([, an]) => an)

    /*
     * Smart Money: neue Käufe der beobachteten Wallets holen, wenn der eigene
     * Takt es erlaubt — parallel zu den Quellen, weil ein Abruf je neue
     * Transaktion einen RPC-Aufruf braucht und dauert. Gelesen wird das
     * Signal danach in JEDEM Durchgang aus der Datenbank.
     */
    const smartAn = q.smartmoney === true && (einst.smartWallets || []).length > 0
    const smartArbeit = (async () => {
        if (!smartAn) return
        const faellig = await beansprucheAufgabe('hype_frueh_smart',
            Math.max(10, Number(einst.smartIntervallMin) || 30) * 60e3 - 30e3)
        if (!faellig) return
        try {
            const r = await smartAbruf(einst, einst.schluessel?.solanaRpc || '')
            quellenStand.smartmoney = { ok: true, anzahl: r.neu, wallets: r.wallets, fehler: r.fehler ? `${r.fehler} Wallet(s) nicht lesbar` : '' }
        } catch (e) {
            quellenStand.smartmoney = { ok: false, fehler: String(e.message).slice(0, 160) }
        }
    })()

    const [funde, stimmen] = await Promise.all([
        Promise.allSettled(aufgaben.map(([, , f]) => f())),
        Promise.allSettled(sozial.map(([, , f]) => f())),
        smartArbeit,
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

    // ── Smart-Money-Signal; zwei Wallets auf einem Token legen ihn an ────
    const smartKarte = smartAn ? await smartKarteLesen(einst, jetzt) : new Map()
    for (const [mint, sg] of smartKarte) {
        if (sg.wallets >= 2) eintragen(karte, { chain: 'solana', contract: mint, quelle: 'smartmoney' })
    }

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
        /*
         * Kürzel: nur für BEKANNTE Token (mindestens einen Durchgang
         * beobachtet), nur wenn genau einer so heisst, und nur ohne gelisteten
         * Namensvetter (`kuerzelErlaubt`). Bis 10.10.2026 galt jeder Eintrag der
         * Sammelkarte, auch die Neuen dieses Laufs.
         */
        const nachSymbol = new Map()
        for (const z of bekannt) {
            const x = karte.get(schluessel(z.chain, z.contract))
            if (!x?.symbol || !kuerzelErlaubt(x.symbol)) continue
            nachSymbol.set(x.symbol, nachSymbol.has(x.symbol) ? null : x)
        }
        for (const [k, anzahl] of kuerzel) {
            const ziel = nachSymbol.get(k)
            if (ziel) { ziel.plattformen.add(plattform); ziel.erwaehnungen += anzahl; ziel.quellen.add(plattform) }
        }
    })

    // ── Auswahl: Favoriten, Smart Money, Bekannte nach Note, Neue auf reservierten Plätzen ─
    const istBekannt = (x) => bekanntNach.has(schluessel(x.chain, x.contract))
    const istFavorit = (x) => favorit.has(schluessel(x.chain, x.contract))
    /*
     * Zwei beobachtete Wallets auf einem Token sind das stärkste Frühsignal,
     * das der Radar kennt — bis 10.10.2026 stand ein solcher Token unter den
     * Neuen hinten an (Note unbekannt, eine Quelle) und konnte leer ausgehen.
     */
    const istSmart = (x) => (smartKarte.get(String(x.contract))?.wallets || 0) >= 2
    const sortiert = [...karte.values()]
        .sort((a, b) => {
            const na = bekanntNach.get(schluessel(a.chain, a.contract))?.note ?? -1
            const nb = bekanntNach.get(schluessel(b.chain, b.contract))?.note ?? -1
            return (Number(istFavorit(b)) - Number(istFavorit(a))) || (Number(istSmart(b)) - Number(istSmart(a))) || (nb - na)
                || (b.plattformen.size - a.plattformen.size) || (b.quellen.size - a.quellen.size)
        })
    const alle = verteilePlaetze(sortiert.filter(istBekannt), sortiert.filter((x) => !istBekannt(x)),
        MAX_BEOBACHTET, NEU_PLAETZE)

    /*
     * Wer keinen Platz bekommt, fällt aus der Beobachtung. Bis 10.10.2026
     * blieb er bis zu 72 Stunden „beobachtet", ohne gemessen zu werden: 788
     * von 954 Zeilen waren über zwei Stunden alt, 36 der 150 gezeigten
     * veraltet. Verworfen (Grund „verdrängt") verschwindet er nach einem Tag;
     * taucht er in einer Quelle wieder auf, beginnt er neu. Favoriten nie.
     */
    const gewaehlt = new Set(alle.map((x) => schluessel(x.chain, x.contract)))
    try {
        const offen = await knex('hype_frueh').select('id', 'chain', 'contract').whereNot('status', 'verworfen')
        const weg = offen.filter((z) => !gewaehlt.has(schluessel(z.chain, z.contract)) && !favorit.has(schluessel(z.chain, z.contract)))
        for (let i = 0; i < weg.length; i += 500) {
            await knex('hype_frueh').whereIn('id', weg.slice(i, i + 500).map((z) => z.id)).update({ status: 'verworfen', grund: 'verdraengt' })
        }
        quellenStand.verdraengt = { ok: true, anzahl: weg.length }
    } catch (e) {
        logWarn('hype-frueh', `Verdrängen: ${e.message}`)
    }

    // ── Marktdaten nachschlagen (DexScreener, gesammelt) ────────────────
    let details = new Map()
    try {
        // Mit Kette: ohne sie deckelt DexScreener auf dreissig Paare je Antwort,
        // und im Lauf vom 07.10.2026 18:52 fehlten so 62 von 150 Token still.
        details = await dexDetailsViele(alle.map((x) => ({ contract: x.contract, chain: x.chain })))
        quellenStand.details = { ok: true, anzahl: details.size }
    } catch (e) {
        quellenStand.details = { ok: false, fehler: String(e.message).slice(0, 160) }
    }
    /*
     * DexScreener ist für Handel, Liquidität, Preis UND Bewertung die
     * Hauptquelle; bis 10.10.2026 füllte er die Bewertung nur, wo noch nichts
     * stand — je nach Lauf kam sie dann von pump.fun oder von DexScreener.
     */
    const DEX_VORRANG = ['liquiditaetUsd', 'volumen1h', 'transaktionen1h', 'transaktionen5m', 'preisUsd', 'aenderung1h',
        'kaufVerkauf1h', 'marktkapitalisierung', 'fdv']
    for (const x of alle) {
        const d = details.get(String(x.contract).toLowerCase())
        if (!d) continue
        if (x.chain === '?' && d.chain) x.chain = normChain(d.chain)
        if (!x.symbol && d.symbol) x.symbol = d.symbol
        if (!x.name && d.name) x.name = d.name
        if (!x.links && d.markt?.links) x.links = d.markt.links
        for (const [f, w] of Object.entries(d.markt || {})) {
            if (w === null || w === undefined) continue
            // Eine 0 bei der Bewertung ist ein fehlendes Feld, kein Vorrang.
            if ((f === 'marktkapitalisierung' || f === 'fdv') && !(Number(w) > 0)) continue
            if (x.markt[f] === undefined || x.markt[f] === null || DEX_VORRANG.includes(f)) x.markt[f] = w
        }
    }

    // ── Käufer und Pool-Transaktionen (GeckoTerminal, für alle) ─────────
    const gecko = await geckoMarkt(alle)
    for (const x of alle) {
        const g = gecko.karte.get(String(x.contract).toLowerCase())
        if (!g) continue
        // Ersetzt auch, was `new_pools` oder DexScreener gesetzt hat: Wallets und
        // Transaktionen sollen aus demselben, frischen Abruf desselben Pools stammen.
        for (const [f, w] of Object.entries(g)) if (w !== null && w !== undefined) x.markt[f] = w
    }
    if (gecko.versucht) {
        /*
         * Wie viele von wie vielen — und ob Teilabfragen scheiterten. Bis
         * 10.10.2026 stand „ok", sobald irgendeine Antwort kam; im Lauf des
         * Tages fehlten so die Käufer für 90 von 140 Token, unsichtbar.
         */
        const teilweise = gecko.gescheitert ? `${gecko.gescheitert} von ${gecko.versucht} Abfragen gescheitert — ${gecko.fehler}` : ''
        quellenStand.kaeufer = gecko.karte.size || !gecko.fehler
            ? { ok: true, anzahl: gecko.karte.size, von: gecko.gefragt, fehler: teilweise }
            : { ok: false, fehler: gecko.fehler }
    }

    /*
     * Lief in diesem Durchgang eine soziale Quelle? Dann ist „nirgends
     * genannt" eine Messung — für jeden Token. Eine noch gültige X-Messung
     * (fortgeschrieben, `X_GILT_MS`) zählt mit.
     */
    const sozialGeprueft = ['biz', 'telegram', 'reddit', 'x'].some((q) => quellenStand[q]?.ok)
        || Boolean(letzteX?.ok && Number(letzteX.am) >= jetzt - X_GILT_MS)

    // ── Bewerten (erster Durchgang) ─────────────────────────────────────
    const bewerte = (e) => bewerteFrueh({
        stand: e.stand, verlauf: e.verlauf, links: e.x.links, profil: e.x.profil,
        projektNote: e.projektNote, ersteller: e.bilanz, risiko: e.risiko, smart: e.smart, geborenAm: e.geborenAm,
        sozialGeprueft,
    })
    const ergebnisse = []
    let zuAlt = 0
    let ohneDaten = 0
    for (const x of alle.filter((y) => y.chain !== '?' && (y.symbol || y.markt.preisUsd))) {
        const alt = bekanntNach.get(schluessel(x.chain, x.contract))
        const verlauf = sicherJson(alt?.verlauf, [])
        const altStand = sicherJson(alt?.stand, {}) || {}

        /*
         * Das Alter steht vor der Bewertung fest, weil sie es braucht: die
         * Stundenzahlen eines Tokens unter einer Stunde decken nur sein Alter
         * ab. Start von pump.fun oder GeckoTerminal, sonst das Paaralter von
         * DexScreener, sonst der letzte bekannte Wert. Für den Status zählt
         * notfalls der erste Blick — das unterschätzt das Alter, nie umgekehrt.
         */
        const geborenAm = x.erstelltAm
            || (Number.isFinite(x.markt.paarAlterStunden) ? jetzt - x.markt.paarAlterStunden * 3600e3 : null)
            || Number(altStand.geborenAm) || null
        const alterStunden = (jetzt - (geborenAm || Number(alt?.ersterBlick) || jetzt)) / 3600e3
        // Älter als drei Tage ist kein Frühphasen-Fund: neu gar nicht erst anlegen.
        // Ein bekannter wird unten verworfen (`statusFrueh`, Grund „alt").
        if (!alt && alterStunden > MAX_ALTER_STUNDEN) { zuAlt++; continue }
        /*
         * X läuft seltener als die Durchgänge. Ohne Fortschreiben fiele die
         * Plattform zwischen zwei Abfragen aus der Note und kehrte bei der
         * nächsten als „Schub" zurück — ein Sägezahn aus dem Abfragetakt.
         */
        const altX = altStand.x
        x.xInfo = x.xInfo || (altX && Number(altX.am) >= jetzt - X_GILT_MS ? altX : null)
        const plattformen = new Set(x.plattformen)
        let erwaehnungen = x.erwaehnungen
        if (x.xInfo && !plattformen.has('x')) { plattformen.add('x'); erwaehnungen += Number(x.xInfo.autoren) || 0 }

        // Kurve und King of the Hill: aus diesem Lauf, sonst aus dem letzten
        // (ein bekannter Token steht nicht in jeder pump.fun-Liste).
        x.kurve = x.kurve || altStand.kurve || null
        if (x.markt.kothMin === undefined || x.markt.kothMin === null) x.markt.kothMin = altStand.kothMin ?? null
        if (x.markt.kothAm === undefined || x.markt.kothAm === null) x.markt.kothAm = altStand.kothAm ?? null
        const graduiert = x.markt.graduiert === true || altStand.graduiert === true
            || Boolean(x.markt.dex && x.markt.dex !== 'pumpfun')

        /*
         * Wie viele Minuten die Stundenzahlen dieser Aufnahme abdecken: das
         * Alter des PAARS, aus dem sie stammen (DexScreener), höchstens sechzig.
         * Nach dem Abschluss der Kurve ist das der neue Pool, nicht der Token.
         */
        const paarMin = Number.isFinite(x.markt.paarAlterStunden) ? x.markt.paarAlterStunden * 60 : null
        const fenster = paarMin !== null ? Math.min(60, paarMin)
            : (geborenAm ? Math.min(60, (jetzt - geborenAm) / 60e3) : null)

        const stand = momentaufnahme(x.markt, { erwaehnungen, plattformen: [...plattformen] }, jetzt, { fenster })
        // Nichts gemessen ist Funkstille, kein Stand: die letzte Aufnahme bleibt,
        // und nach `VERGESSEN_MS` ohne Messung fällt der Token heraus.
        if (!hatMessung(stand, x.plattformen.size > 0)) { ohneDaten++; continue }
        // Eine Prüfung nach alten Regeln (`veraltet`) zählt nicht — auch nicht
        // über den Umweg der Note, die `hype_frueh` sich von ihr gemerkt hat.
        const gespeichert = await gespeichertePruefung({ chain: x.chain, contract: x.contract })
        const gilt = gespeichert && !gespeichert.veraltet ? gespeichert : null
        const e = {
            x, alt, altStand, verlauf, stand, graduiert, geborenAm, alterStunden,
            pump: istPump(x, sicherJson(alt?.quellen, [])),
            aufKurve: istPump(x, sicherJson(alt?.quellen, [])) && !graduiert,
            projektNote: gilt ? gilt.note : (gespeichert ? null : alt?.projektNote ?? null),
            bilanz: gilt?.fakten?.ersteller || null,
            risiko: altStand.risiko && Number(altStand.risiko.am) >= jetzt - RISIKO_GILT_MS ? altStand.risiko : null,
            smart: smartKarte.get(String(x.contract)) || smartKarte.get(String(x.contract).toLowerCase()) || null,
        }
        e.r = bewerte(e)
        ergebnisse.push(e)
    }

    // ── Risiko und Halter für die Besten ────────────────────────────────
    // Zwei beobachtete Wallets zuerst: deren Meldung wartet auf genau diese Prüfung.
    const zuPruefen = ergebnisse
        .filter((e) => !e.risiko || Number(e.risiko.am) < jetzt - RISIKO_NEU_MS)
        .sort((a, b) => (Number(b.smart?.wallets >= 2) - Number(a.smart?.wallets >= 2)) || (b.r.note - a.r.note))
        .slice(0, RISIKO_JE_LAUF)
    let risikoOk = 0
    let unpruefbar = 0
    let risikoFehler = ''
    await jeDrei(zuPruefen, async (e) => {
        try {
            const roh = await holeRisiko(e.x.chain, e.x.contract)
            const r = risikoFrueh(roh, { kurve: e.x.kurve || [], ersteller: e.x.ersteller, aufKurve: e.aufKurve })
            // Keine Antwort ist kein Fehler, aber auch kein Bestehen — festhalten
            // statt still übergehen, sonst geht die Meldung ungeprüft hinaus.
            if (!r) { e.risiko = risikoUnpruefbar(jetzt); unpruefbar++; return }
            e.risiko = { ...r, am: jetzt }
            e.stand.halter = r.halter
            e.stand.halterQuelle = r.quelle || null
            risikoOk++
        } catch (err) {
            risikoFehler = String(err.message).slice(0, 160)
            logWarn('hype-frueh', `Risiko ${e.x.symbol}: ${err.message}`)
        }
    })
    if (zuPruefen.length) {
        quellenStand.risiko = risikoOk || unpruefbar || !risikoFehler
            ? { ok: true, anzahl: risikoOk, unpruefbar }
            : { ok: false, fehler: risikoFehler }
    }

    // ── Projektprüfung für die Besten ───────────────────────────────────
    if (einst.projektPruefung !== false) {
        const kandidaten = [...ergebnisse].sort((a, b) => b.r.note - a.r.note).slice(0, PROJEKT_JE_LAUF)
        await pruefeViele(kandidaten.map((e) => ({
            symbol: e.x.symbol, name: e.x.name, chain: e.x.chain, contract: e.x.contract,
            links: e.x.links, ersteller: e.x.ersteller, pump: e.pump,
        })), {
            jeFertig: (_, p, fehler, i) => {
                const e = kandidaten[i]
                if (!p) {
                    logWarn('hype-frueh', `Projektprüfung ${e.x.symbol}: ${fehler?.message}`)
                    return
                }
                e.projektNote = p.note
                e.bilanz = p.fakten?.ersteller || e.bilanz
            },
        })
    }

    // ── Endgültig bewerten ──────────────────────────────────────────────
    for (const e of ergebnisse) e.r = bewerte(e)

    // ── Schreiben und melden ────────────────────────────────────────────
    let neu = 0
    let alarme = 0
    const schwelle = Number(einst.fruehAlarmAb) || 0
    // Erfolgskontrolle: wer die Schwelle überschreitet, und wer neu dazukam.
    // Ohne eingestellte Alarmschwelle gilt 70 — gemessen wird trotzdem.
    const messSchwelle = schwelle || 70
    const ueberSchwelle = []
    // Meldefähig, aber unter der Note — aus ihnen kommt der Partner jedes Spitzen-Tokens.
    const vergleichbar = []
    const neuGesehen = []
    const gedaechtnis = []
    for (const e of ergebnisse) {
        const { x, alt, altStand, r, alterStunden } = e
        const erster = Number(alt?.ersterBlick) || jetzt
        const { status, grund } = statusFrueh(e.stand, alterStunden, r.befunde, { aufKurve: e.aufKurve })
        /*
         * „Über der Schwelle" heisst: meldefähig UND über der Note. Gemerkt
         * wird der Zustand, nicht die Note — sonst bliebe ein Token, der
         * ungeprüft über 70 stand und erst danach geprüft wird, für immer
         * stumm, weil seine Note die Schwelle nie mehr „überschreitet".
         * Zeilen ohne den Merker (vor dem 07.10.2026) zählen nach der Note.
         */
        const meldung = meldefaehig({
            status, belastbar: r.belastbar, risiko: e.risiko, tx1h: e.stand.tx1h,
            // Ist die Projektprüfung abgeschaltet, kann sie keine Bedingung sein.
            projektGeprueft: einst.projektPruefung === false || Number.isFinite(e.projektNote),
        })
        const ueber = meldung.ja && r.note >= messSchwelle
        const vorherUeber = typeof altStand?.ueber === 'boolean' ? altStand.ueber : (Number(alt?.note) || 0) >= messSchwelle
        const smartMeldung = e.smart?.wallets >= 2 && meldefaehig({ status, risiko: e.risiko, smart: true }).ja
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
            stand: JSON.stringify({ ...e.stand, alterStunden, geborenAm: e.geborenAm, teilnoten: r.teilnoten, abdeckung: r.abdeckung,
                marktTeilnoten: r.markt, trend: r.trend, x: x.xInfo || null, graduiert: e.graduiert, aufKurve: e.aufKurve, pump: e.pump,
                kurve: x.kurve || null, risiko: e.risiko || null, smart: e.smart || null, ueber, meldung: meldung.grund }),
            verlauf: JSON.stringify(verlauf),
            note: r.note,
            befunde: JSON.stringify(r.befunde),
            projektNote: Number.isFinite(e.projektNote) ? e.projektNote : null,
            status,
            grund,
        }
        await knex('hype_frueh').insert(zeile).onConflict(['chain', 'contract']).merge()
        if (!alt) neu++
        const messung = { chain: x.chain, contract: x.contract, symbol: zeile.symbol, note: r.note,
            preis: e.stand.preis, mcap: e.stand.mcap, liq: e.stand.liq,
            alterStunden, aufKurve: e.aufKurve, graduiert: e.graduiert, pump: e.pump }
        if (ueber && !vorherUeber) ueberSchwelle.push(messung)
        else if (meldung.ja && !ueber) vergleichbar.push(messung)
        if (!alt && !(ueber && !vorherUeber)) neuGesehen.push(messung)
        if (r.note >= MERKEN_AB_NOTE || (e.smart?.wallets >= 2)) {
            /*
             * „Gemeldet" heisst: Es ging eine Meldung hinaus. Bis 10.10.2026
             * zählte die Messschwelle (70, auch bei ausgeschalteten Meldungen) —
             * der Börsen-Beobachter rechnete dann Vorläufe für Meldungen, die
             * nie jemand bekam.
             */
            gedaechtnis.push({ chain: x.chain, contract: x.contract, symbol: zeile.symbol, quelle: 'frueh',
                bewertungUsd: e.stand.mcap, gemeldet: (schwelle > 0 && ueber) || smartMeldung })
        }

        /*
         * Melden beim ÜBERSCHREITEN der Schwelle, nicht solange darüber — und
         * je Token höchstens alle zwölf Stunden, über einen Anspruch in der
         * Datenbank (NAS und Entwicklungsrechner takten beide).
         */
        if (schwelle > 0 && ueber && !vorherUeber
            && await beansprucheAufgabe(`hypfrueh|${x.chain}|${x.contract}`, ALARM_SPERRE_MS)) {
            alarme++
            await melde(knex, zeile, r, einst, jetzt)
        }
        // Zwei beobachtete Wallets auf demselben Token: sofort melden, ganz
        // gleich, wo die Note steht — genau dafür beobachtet man sie. Nur der
        // Vertrag muss geprüft sein.
        if (smartMeldung
            && await beansprucheAufgabe(`hypsmart|${x.contract}`, ALARM_SPERRE_MS)) {
            alarme++
            await melde(knex, zeile, r, einst, jetzt, e.smart)
        }
    }

    await merke(gedaechtnis, jetzt)

    // ── Erfolgskontrolle anlegen ─────────────────────────────────────────
    if (ueberSchwelle.length || neuGesehen.length) {
        try {
            const ids = new Map((await knex('hype_frueh').select('id', 'chain', 'contract')
                .whereIn('contract', [...ueberSchwelle, ...vergleichbar, ...neuGesehen].map((m) => m.contract)))
                .map((z) => [schluessel(z.chain, z.contract), z.id]))
            const mitId = (liste) => liste.map((m) => ({ ...m, id: ids.get(schluessel(m.chain, m.contract)) })).filter((m) => m.id)
            await legeAnFrueh(mitId(ueberSchwelle), mitId(vergleichbar), mitId(neuGesehen))
        } catch (e) {
            logWarn('hype-frueh', `Erfolgskontrolle anlegen: ${e.message}`)
        }
    }

    await raeumeAuf(knex, jetzt)
    return { beobachtet: ergebnisse.length, neu, alarme, zuAlt, ohneDaten, quellenStand }
}

/** Einen Frühphasen-Alarm speichern und zustellen. */
async function melde(knex, zeile, r, einst, jetzt, smart = null) {
    const gruende = r.befunde.filter((b) => b.art === 'plus').slice(0, 3).map((b) => b.text).join('; ')
    const name = zeile.symbol || zeile.contract.slice(0, 8)
    const alarm = {
        regel: smart ? 'smartmoney' : 'fruehsignal',
        schwere: 'warnung',
        meldung: smart
            ? `${name}: ${smart.wallets} beobachtete Wallets gekauft (${smart.namen.slice(0, 3).join(', ')}) — Note ${r.note}`
            : `${name}: Frühsignal ${r.note}${gruende ? ` — ${gruende}` : ''}`,
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
        // Projektprüfungen wuchsen ohne Grenze. Neunzig Tage reichen für die
        // Frage, wer eine Seite schon einmal angegeben hat; gültig ist eine ohnehin nur einen Tag.
        await knex('hype_projekt').where('geprueftAm', '<', jetzt - PROJEKT_AUFBEWAHREN_MS).del()
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
