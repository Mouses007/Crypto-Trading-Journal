/**
 * Hype-Radar, Projektprüfung — das Abrufen.
 *
 * Für einen Token wird zusammengetragen, was sich ohne Schlüssel über das
 * Projekt dahinter herausfinden lässt:
 *
 *   Webseite      gelesen über `net-guard` — die Adresse stammt von Fremden
 *                 (DexScreener-Profil, pump.fun-Metadaten), und ohne den
 *                 Schutzwall wäre ein Tokenprofil ein bequemer Weg, den Server
 *                 ins eigene Netz zu schicken.
 *   Domain-Alter  über RDAP (`rdap.org` leitet zur zuständigen Registry weiter)
 *   GitHub        Konto, Repository und frühere Projekte desselben Kontos
 *   Ersteller     bei pump.fun: alle Coins derselben Wallet und ob einer davon
 *                 die Kurve geschafft hat — für Token ohne Seite und ohne Code
 *                 ist das die einzige Spur zum „Team".
 *
 * Gerechnet wird in `projekt-bewertung.js`; hier steht nur der Weg dorthin.
 * Jede Prüfung landet 24 Stunden in `hype_projekt`: GitHub erlaubt ohne
 * Schlüssel sechzig Anfragen je STUNDE, und dieselbe Seite ändert sich in
 * einem Tag selten.
 *
 * Die pump.fun-Pfade stammen aus dem inoffiziellen Frontend-API. Live geprüft
 * am 07.10.2026: `/coins/user-created-coins/{wallet}` gibt es dort nicht
 * (404), der Filter `/coins?creator={wallet}` liefert die Starts einer Wallet.
 * `/coins/{mint}` antwortet für jeden Coin mit 404 (10.10.2026), gelesen wird
 * `/coins-v2/{mint}` (`pumpCoin` in quellen.js). Jeder Teil fällt einzeln aus — dann
 * bleibt er „unbekannt" und kostet keine Punkte.
 */

import { getKnex } from '../database.js'
import { logWarn } from '../logger.js'
import { holeText as holeGeschuetzt } from '../net-guard.js'
import { holeJson, dexDetails, linksAusInfo, pumpCoin } from './quellen.js'
import {
    leseWebseite, registrierbareDomain, gratisPlattform, rdapRegistriert, ordneWebseite, ordneAbruffehler,
    kanalAus, seitenBeleg, githubZiel, githubFakten, githubBeleg, erstellerBilanz, bewerteProjekt, PROJEKT_REGELN,
} from './projekt-bewertung.js'

/** So lange gilt eine Prüfung. */
export const PRUEFUNG_GUELTIG_MS = 24 * 3600e3

/** Frühestens so oft darf eine Prüfung von Hand erzwungen werden. */
const ERZWINGEN_AB_MS = 5 * 60e3

/** Wie viel Seitentext für den Bericht aufbewahrt wird. */
const AUSZUG_ZEICHEN = 1500

const PUMP = 'https://frontend-api-v3.pump.fun'

/** EVM-Adressen ohne Rücksicht auf Gross/Klein — DexScreener schreibt sie mit Prüfsumme, andere klein. */
const vertragKern = (c) => (/^0x[0-9a-f]{40}$/i.test(String(c || '')) ? String(c).toLowerCase() : String(c || ''))

export const schluesselFuer = (k) => (k.contract
    ? `${String(k.chain || '?').toLowerCase()}|${vertragKern(k.contract)}`
    : `sym|${String(k.symbol || '').toUpperCase()}`)

/** Wie lange etwas her ist, in Tagen. */
const tageSeit = (ms) => (Number.isFinite(ms) ? Math.max(0, (Date.now() - ms) / 86400e3) : null)

/**
 * Eine gespeicherte Zeile lesen. Nach einer Regeländerung (`PROJEKT_REGELN`)
 * ist sie `veraltet`: ihre Note ist nach Regeln gerechnet, die nicht mehr
 * gelten, und darf weder angezeigt noch weitergerechnet werden.
 */
function ausZeile(z) {
    const e = { ...JSON.parse(z.ergebnis || '{}'), geprueftAm: Number(z.geprueftAm) || 0 }
    if (Number(e.regel) !== PROJEKT_REGELN) e.veraltet = true
    return e
}

/**
 * Gespeicherte Prüfung lesen.
 * @returns {Promise<object|null>} das Ergebnis samt `geprueftAm` (und `veraltet`), oder null
 */
export async function gespeichertePruefung(kandidat) {
    try {
        const z = await getKnex()('hype_projekt').where('schluessel', schluesselFuer(kandidat)).first()
        return z ? ausZeile(z) : null
    } catch {
        return null
    }
}

/**
 * Gespeicherte Prüfungen für viele Token auf einmal — eine Abfrage statt einer
 * je Zeile. Abgelaufene kommen mit: eine zwei Tage alte Prüfung ist für die
 * Anzeige besser als keine, und `geprueftAm` sagt, wie alt sie ist. Nicht mit
 * kommen Prüfungen nach alten Regeln — die zeigten Pluspunkte, die es nicht
 * mehr gibt.
 *
 * @returns {Promise<Map<string, object>>} Schlüssel (`schluesselFuer`) → Ergebnis
 */
export async function gespeichertePruefungen(kandidaten = []) {
    const raus = new Map()
    const schluessel = [...new Set(kandidaten.map(schluesselFuer))]
    if (!schluessel.length) return raus
    try {
        const zeilen = await getKnex()('hype_projekt').whereIn('schluessel', schluessel)
        for (const z of zeilen) {
            try {
                const e = ausZeile(z)
                if (!e.veraltet) raus.set(z.schluessel, e)
            } catch { /* eine kaputte Zeile fehlt eben */ }
        }
    } catch { /* Tabelle fehlt: dann gibt es keine */ }
    return raus
}

/**
 * Wie viele ANDERE Token dieselbe Webseite angeben (gezählt nach Vertrag, nicht
 * nach Schlüssel — derselbe Vertrag auf zwei Ketten ist ein Token).
 * Unbekannt (Tabelle ohne Spalte, Datenbank weg) ist 0, nicht „geteilt".
 */
async function geteiltMit(host, kandidat) {
    if (!host) return 0
    try {
        const zeilen = await getKnex()('hype_projekt').where('host', host).select('schluessel')
        const eigen = vertragKern(kandidat.contract)
        const andere = new Set(zeilen
            .map((z) => String(z.schluessel || ''))
            .filter((s) => !s.startsWith('sym|'))
            .map((s) => vertragKern(s.slice(s.indexOf('|') + 1)))
            .filter((c) => c && c !== eigen))
        return andere.size
    } catch {
        return 0
    }
}

/**
 * Ein Projekt prüfen — oder die gespeicherte Prüfung liefern, solange sie gilt.
 *
 * Eine gespeicherte Prüfung gilt nicht mehr, wenn sie abgelaufen ist, nach
 * alten Regeln gerechnet wurde, oder wenn seither ein weiterer Token dieselbe
 * Webseite angibt: Wer zuerst geprüft wurde, sah die Nachahmer noch nicht und
 * behielte sonst einen Tag lang Pluspunkte für eine Seite, die nun drei Token
 * für sich beanspruchen.
 *
 * @param {object} kandidat  {symbol, name, chain, contract, links?, ersteller?, pump?}
 * @param {object} opts      {neu: true} erzwingt eine frische Prüfung (gebremst)
 * @returns {Promise<{note:number|null, befunde:Array, fakten:object, geprueftAm:number}>}
 */
export async function pruefeProjekt(kandidat, opts = {}) {
    const alt = await gespeichertePruefung(kandidat)
    const alter = alt ? Date.now() - alt.geprueftAm : Infinity
    if (alt && !alt.veraltet && alter < (opts.neu ? ERZWINGEN_AB_MS : PRUEFUNG_GUELTIG_MS)) {
        const w = alt.fakten?.webseite || {}
        const bisher = Number(w.geteilt) || 0
        if (!w.host || w.status === 'keine' || await geteiltMit(w.host, kandidat) === bisher) return alt
    }

    const ergebnis = await pruefeFrisch(kandidat)
    try {
        const knex = getKnex()
        const w = ergebnis.fakten?.webseite || {}
        await knex('hype_projekt')
            .insert({
                schluessel: schluesselFuer(kandidat),
                note: ergebnis.note,
                ergebnis: JSON.stringify(ergebnis),
                geprueftAm: ergebnis.geprueftAm,
                // Nur eine geprüfte eigene Seite zählt fürs Teilen — x.com teilen alle.
                host: w.status !== 'keine' && w.host ? w.host : null,
            })
            .onConflict('schluessel')
            .merge(['note', 'ergebnis', 'geprueftAm', 'host'])
    } catch (e) {
        logWarn('hype-projekt', `Prüfung nicht gespeichert: ${e.message}`)
    }
    return ergebnis
}

/**
 * Mehrere Projekte prüfen, höchstens `parallel` gleichzeitig.
 *
 * Eine Prüfung wartet die meiste Zeit auf fremde Server (Webseite bis zehn
 * Sekunden, RDAP, GitHub, pump.fun). Fünfzehn hintereinander dauerten im
 * ungünstigen Fall mehrere Minuten; drei gleichzeitig dritteln das, ohne
 * GitHub zu überrennen — dessen Eimer in `quellen.js` bremst ohnehin.
 *
 * @param {object[]} kandidaten
 * @param {object} opts  {parallel, jeFertig(i, ergebnis|null, fehler|null)}
 * @returns {Promise<Array<object|null>>} in der Reihenfolge der Kandidaten
 */
export async function pruefeViele(kandidaten = [], { parallel = 3, jeFertig = () => {} } = {}) {
    const raus = new Array(kandidaten.length).fill(null)
    let naechster = 0
    let fertig = 0
    const arbeiter = async () => {
        while (naechster < kandidaten.length) {
            const i = naechster++
            try {
                raus[i] = await pruefeProjekt(kandidaten[i])
                jeFertig(++fertig, raus[i], null, i)
            } catch (e) {
                jeFertig(++fertig, null, e, i)
            }
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, kandidaten.length)) }, arbeiter))
    return raus
}

/** Die eigentliche Prüfung, ohne Zwischenspeicher. */
async function pruefeFrisch(kandidat) {
    const k = { ...kandidat }
    const token = { symbol: String(k.symbol || ''), name: String(k.name || ''), contract: String(k.contract || '') }
    // Die Frühphase weiss es genauer (Kurve, Quelle, Handelsplatz) — die Endung „pump" trägt nur jeder vierte nicht.
    const istPump = k.chain === 'solana' && (k.pump === true || /pump$/i.test(String(k.contract || '')))

    // ── Links und Ersteller zusammentragen ──────────────────────────────
    let links = k.links || null
    let ersteller = String(k.ersteller || '')
    if (istPump && (!links || !ersteller)) {
        // Ausfall von pump.fun: dann eben ohne — die Prüfung soll nicht daran scheitern.
        const coin = await pumpCoin(k.contract).catch((e) => {
            logWarn('hype-projekt', `pump.fun ${String(k.contract).slice(0, 8)}…: ${e.message}`)
            return null
        })
        if (coin) {
            links = links || linksAusInfo(coin)
            ersteller = ersteller || String(coin.creator || '')
        }
    }
    if (!links && k.contract) {
        const d = await dexDetails(k.contract).catch(() => null)
        links = d?.markt?.links || null
    }
    links = links || { webseiten: [], kanaele: [] }

    // ── Webseite ────────────────────────────────────────────────────────
    const webseite = await pruefeWebseite(links.webseiten || [], token)
    if (webseite.status !== 'keine') webseite.geteilt = await geteiltMit(webseite.host, k)
    const beleg = seitenBeleg(webseite, token)
    webseite.beleg = beleg.wie
    webseite.fremd = beleg.fremd

    /*
     * ── Kanäle: aus den Token-Angaben, von der Seite nur, wenn sie seine ist ─
     *
     * Von einer fremden Seite übernommen, gehörten die Kanäle dem, der sie
     * betreibt: Ein Forschungsartikel brachte drei Token das GitHub-Konto des
     * Verlags samt seiner bekannten Repositories ein — Note 92.
     */
    const angegeben = (links.kanaele || []).map((x) => ({ url: x.url, ...kanalAus(x.url) }))
    const vonSeite = beleg.eigen ? (webseite.fakten?.kanaele || {}) : {}
    const erster = (art) => angegeben.find((x) => x.art === art && x.gueltig)?.url
        || (vonSeite[art] || []).find((u) => kanalAus(u).gueltig) || ''
    const kanaele = { x: erster('x'), telegram: erster('telegram'), discord: erster('discord') }
    const verworfen = angegeben.filter((x) => x.art && !x.gueltig && x.art !== 'github')
        .map((x) => ({ art: x.art, grund: x.grund, url: x.url }))

    // ── GitHub: der Link der eigenen Seite zuerst, sonst der angegebene ──
    const ghSeite = (vonSeite.github || []).find((u) => githubZiel(u)) || ''
    const ghLink = ghSeite || angegeben.find((x) => x.art === 'github' && x.gueltig)?.url || ''
    kanaele.github = ghLink
    const github = ghLink ? await pruefeGithub(ghLink) : null
    if (github) {
        github.beleg = githubBeleg(github, {
            vonSeite: Boolean(ghSeite), contract: token.contract, seitenHost: beleg.eigen ? webseite.host : '',
        })
    }

    // ── Ersteller (pump.fun) ────────────────────────────────────────────
    let erstellerFakten = null
    if (istPump && ersteller) {
        /*
         * `/coins/user-created-coins/{wallet}` gibt es auf frontend-api-v3
         * nicht (07.10.2026: „Cannot GET", HTTP 404 bei jeder Wallet) — die
         * Ersteller-Bilanz war deshalb immer leer, und „hat schon Coins durch
         * die Kurve gebracht" fiel nie. Die Coin-Liste nimmt `creator` als
         * Filter: für eine Wallet mit vier Starts kamen genau diese vier. Ein
         * vertippter Filter liefert dagegen still die fünfzig neuesten Coins
         * ALLER Ersteller (gemessen 10.10.2026) — daher die Gegenprobe über
         * `wallet` in `erstellerBilanz`.
         */
        const coins = await holeJson(
            `${PUMP}/coins?creator=${encodeURIComponent(ersteller)}&offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=true`)
            .catch((e) => {
                logWarn('hype-projekt', `Ersteller-Historie ${ersteller.slice(0, 8)}…: ${e.message}`)
                return null
            })
        erstellerFakten = erstellerBilanz(coins, { mint: k.contract, wallet: ersteller })
    }

    const fakten = {
        token,
        webseite,
        kanaele,
        kanaeleVerworfen: verworfen,
        github,
        ersteller: erstellerFakten ? { wallet: ersteller, ...erstellerFakten } : (ersteller ? { wallet: ersteller } : null),
    }
    const urteil = bewerteProjekt({
        token,
        webseite,
        // Kanäle nur dann werten, wenn es überhaupt Angaben zum Token gab.
        kanaele: (links.kanaele?.length || links.webseiten?.length || webseite.status === 'ok') ? kanaele : null,
        kanaeleVerworfen: verworfen,
        github,
        ersteller: erstellerFakten,
    })
    return { ...urteil, regel: PROJEKT_REGELN, fakten, geprueftAm: Date.now() }
}

/**
 * Die angegebene Webseite einordnen, lesen und das Alter ihrer Domain bestimmen.
 *
 * Von mehreren Adressen zählt die erste, die eine eigene Seite sein kann.
 * Steht keine solche da, wird die aussagekräftigste fremde benannt: die Seite
 * eines ANDEREN Tokens vor der Seite dieses Tokens vor einer Plattform.
 *
 * @returns {Promise<object>} {status:'keine'|'fehler'|'geschuetzt'|'unpruefbar'|'ok', grund?, url, host,
 *                             fakten?, domain, domainAlterTage, plattform}
 */
async function pruefeWebseite(webseiten, token) {
    if (!webseiten.length) return { status: 'keine' }
    const geordnet = webseiten.map((url) => ({ url, ...ordneWebseite(url, token.contract) }))
    const eigene = geordnet.find((x) => !x.grund)
    if (!eigene) {
        const RANG = { fremderToken: 0, tokenSeite: 1, plattform: 2, ungueltig: 3 }
        const x = [...geordnet].sort((a, b) => RANG[a.grund] - RANG[b.grund])[0]
        return {
            status: 'keine', grund: x.grund, url: x.url, host: x.host,
            plattform: x.plattform || '', art: x.art || '', adresse: x.adresse || '',
        }
    }
    const { url, host } = eigene
    const plattform = gratisPlattform(host)
    const domain = registrierbareDomain(host)

    let html
    try {
        html = await holeGeschuetzt(url, { timeout: 10000, versuche: 2 })
    } catch (e) {
        /*
         * Bot-Schutz ist kein toter Link, eine Zeitüberschreitung auch nicht —
         * `ordneAbruffehler` zieht die Grenze: nur was sagt „diese Seite gibt
         * es nicht", kostet Punkte.
         */
        const nxdomain = e?.art === 'dns' && e?.code === 'ENOTFOUND' ? await nxdomainLaut(host) : null
        return { ...ordneAbruffehler(e, { nxdomain }), url, host, plattform, domain }
    }
    const f = leseWebseite(html, { contract: token.contract, url })

    // Domain-Alter nur bei eigener Domain — bei einer Gratis-Plattform wäre
    // es das Alter der Plattform, bei einer Sammelseite das des Betreibers.
    let domainAlterTage = null
    if (domain && !plattform && !f.sammelseite) {
        try {
            const rdap = JSON.parse(await holeGeschuetzt(`https://rdap.org/domain/${encodeURIComponent(domain)}`,
                { timeout: 8000, versuche: 1 }))
            domainAlterTage = tageSeit(rdapRegistriert(rdap))
        } catch (e) {
            // Manche Endungen (.xyz und viele Länderendungen) haben kein
            // öffentliches RDAP — dann bleibt das Alter unbekannt.
            logWarn('hype-projekt', `RDAP ${domain}: ${e.message}`)
        }
    }

    return {
        status: 'ok', url, host, domain, plattform, domainAlterTage,
        fakten: { ...f, textAuszug: f.textAuszug.slice(0, AUSZUG_ZEICHEN) },
    }
}

/*
 * Gegenprobe für „Name gibt es nicht": zwei unabhängige Resolver über HTTPS.
 * Die eigene Namensauflösung meldete am 10.10.2026 für bestehende Domains
 * vorübergehend ENOTFOUND — ohne Gegenprobe kostete das zehn Punkte und stand
 * einen Tag lang als „Webseite tot" da. Feste Adressen, keine Nutzereingabe.
 */
const DOH = [
    ['https://dns.google/resolve?type=A&name=', {}],
    ['https://cloudflare-dns.com/dns-query?type=A&name=', { accept: 'application/dns-json' }],
]

/** @returns {Promise<boolean|null>} true = NXDOMAIN bestätigt, false = Name existiert, null = unbekannt */
async function nxdomainLaut(host) {
    for (const [basis, kopf] of DOH) {
        try {
            const r = await fetch(basis + encodeURIComponent(host), { headers: kopf, signal: AbortSignal.timeout(6000) })
            if (!r.ok) continue
            const status = Number((await r.json())?.Status)
            if (status === 3) return true
            if (status === 0) return false
        } catch { /* nächster Resolver */ }
    }
    return null
}

/** GitHub: Konto, Repository, frühere Projekte. Höchstens drei Anfragen. */
async function pruefeGithub(link) {
    const ziel = githubZiel(link)
    if (!ziel) return null
    const api = 'https://api.github.com'
    const kopf = { Accept: 'application/vnd.github+json' }
    const [konto, repo, repos] = await Promise.all([
        holeJson(`${api}/users/${encodeURIComponent(ziel.konto)}`, { kopf }).catch(() => null),
        ziel.repo ? holeJson(`${api}/repos/${encodeURIComponent(ziel.konto)}/${encodeURIComponent(ziel.repo)}`, { kopf }).catch(() => null) : null,
        holeJson(`${api}/users/${encodeURIComponent(ziel.konto)}/repos?per_page=100&sort=updated`, { kopf }).catch(() => []),
    ])
    if (!konto && !repo) return null
    return { link, ...githubFakten({ konto, repo, repos }) }
}

/**
 * Für die Anzeige und den Bericht: die Prüfung ohne die Rohtexte.
 * Der Seitenauszug bleibt dem Bericht vorbehalten.
 */
export function kurzfassung(ergebnis) {
    if (!ergebnis) return null
    const w = ergebnis.fakten?.webseite || {}
    return {
        note: ergebnis.note,
        befunde: ergebnis.befunde || [],
        geprueftAm: ergebnis.geprueftAm || 0,
        webseite: w.status === 'ok'
            ? {
                url: w.url, titel: w.fakten?.titel || '', domainAlterTage: w.domainAlterTage, plattform: w.plattform,
                beleg: w.beleg || '', fremd: w.fremd || '', geteilt: Number(w.geteilt) || 0,
            }
            : { url: w.url || '', status: w.status, grund: w.grund || '', plattform: w.plattform || '', geteilt: Number(w.geteilt) || 0 },
        kanaele: ergebnis.fakten?.kanaele || {},
        github: ergebnis.fakten?.github ? {
            link: ergebnis.fakten.github.link,
            konto: ergebnis.fakten.github.konto,
            repo: ergebnis.fakten.github.repo,
            fruehereProjekte: ergebnis.fakten.github.fruehereProjekte,
        } : null,
        ersteller: ergebnis.fakten?.ersteller || null,
    }
}
