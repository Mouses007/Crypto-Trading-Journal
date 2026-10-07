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
 * ⚠ Nicht gegen die Live-Dienste geprüft (die Entwicklungsumgebung hatte am
 * 07.10.2026 keinen Zugang): die pump.fun-Pfade `/coins/{mint}` und
 * `/coins/user-created-coins/{wallet}` sind dem inoffiziellen Frontend-API
 * entnommen. Jeder Teil fällt einzeln aus — dann bleibt er „unbekannt" und
 * kostet keine Punkte.
 */

import { getKnex } from '../database.js'
import { logWarn } from '../logger.js'
import { holeText as holeGeschuetzt } from '../net-guard.js'
import { holeJson, dexDetails, linksAusInfo } from './quellen.js'
import {
    leseWebseite, registrierbareDomain, gratisPlattform, rdapRegistriert,
    githubZiel, githubFakten, erstellerBilanz, bewerteProjekt,
} from './projekt-bewertung.js'

/** So lange gilt eine Prüfung. */
export const PRUEFUNG_GUELTIG_MS = 24 * 3600e3

/** Frühestens so oft darf eine Prüfung von Hand erzwungen werden. */
const ERZWINGEN_AB_MS = 5 * 60e3

/** Wie viel Seitentext für den Bericht aufbewahrt wird. */
const AUSZUG_ZEICHEN = 1500

const PUMP = 'https://frontend-api-v3.pump.fun'

export const schluesselFuer = (k) => (k.contract
    ? `${String(k.chain || '?').toLowerCase()}|${String(k.contract)}`
    : `sym|${String(k.symbol || '').toUpperCase()}`)

/** Wie lange etwas her ist, in Tagen. */
const tageSeit = (ms) => (Number.isFinite(ms) ? Math.max(0, (Date.now() - ms) / 86400e3) : null)

/**
 * Gespeicherte Prüfung lesen.
 * @returns {Promise<object|null>} das Ergebnis samt `geprueftAm`, oder null
 */
export async function gespeichertePruefung(kandidat) {
    try {
        const z = await getKnex()('hype_projekt').where('schluessel', schluesselFuer(kandidat)).first()
        if (!z) return null
        return { ...JSON.parse(z.ergebnis || '{}'), geprueftAm: Number(z.geprueftAm) || 0 }
    } catch {
        return null
    }
}

/**
 * Gespeicherte Prüfungen für viele Token auf einmal — eine Abfrage statt einer
 * je Zeile. Abgelaufene kommen mit: eine zwei Tage alte Prüfung ist für die
 * Anzeige besser als keine, und `geprueftAm` sagt, wie alt sie ist.
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
                raus.set(z.schluessel, { ...JSON.parse(z.ergebnis || '{}'), geprueftAm: Number(z.geprueftAm) || 0 })
            } catch { /* eine kaputte Zeile fehlt eben */ }
        }
    } catch { /* Tabelle fehlt: dann gibt es keine */ }
    return raus
}

/**
 * Ein Projekt prüfen — oder die gespeicherte Prüfung liefern, solange sie gilt.
 *
 * @param {object} kandidat  {symbol, name, chain, contract, links?, ersteller?}
 * @param {object} opts      {neu: true} erzwingt eine frische Prüfung (gebremst)
 * @returns {Promise<{note:number|null, befunde:Array, fakten:object, geprueftAm:number}>}
 */
export async function pruefeProjekt(kandidat, opts = {}) {
    const alt = await gespeichertePruefung(kandidat)
    const alter = alt ? Date.now() - alt.geprueftAm : Infinity
    if (alt && (alter < (opts.neu ? ERZWINGEN_AB_MS : PRUEFUNG_GUELTIG_MS))) return alt

    const ergebnis = await pruefeFrisch(kandidat)
    try {
        const knex = getKnex()
        await knex('hype_projekt')
            .insert({
                schluessel: schluesselFuer(kandidat),
                note: ergebnis.note,
                ergebnis: JSON.stringify(ergebnis),
                geprueftAm: ergebnis.geprueftAm,
            })
            .onConflict('schluessel')
            .merge(['note', 'ergebnis', 'geprueftAm'])
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
    const istPump = k.chain === 'solana' && /pump$/i.test(String(k.contract || ''))

    // ── Links und Ersteller zusammentragen ──────────────────────────────
    let links = k.links || null
    let ersteller = String(k.ersteller || '')
    if (istPump && (!links || !ersteller)) {
        const coin = await holeJson(`${PUMP}/coins/${encodeURIComponent(k.contract)}`).catch(() => null)
        if (coin && typeof coin === 'object') {
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
    const webseite = await pruefeWebseite(links.webseiten?.[0] || '', k.contract)

    // ── Kanäle: aus den Token-Angaben UND von der Seite ─────────────────
    const typen = (re) => (links.kanaele || []).filter((x) => re.test(x.typ) || re.test(x.url)).map((x) => x.url)
    const vonSeite = webseite.fakten?.kanaele || {}
    const kanaele = {
        x: [...typen(/twitter|x\.com/i), ...(vonSeite.x || [])][0] || '',
        telegram: [...typen(/telegram|t\.me/i), ...(vonSeite.telegram || [])][0] || '',
        discord: [...typen(/discord/i), ...(vonSeite.discord || [])][0] || '',
        github: [...typen(/github/i), ...(vonSeite.github || [])][0] || '',
    }

    // ── GitHub ──────────────────────────────────────────────────────────
    const github = kanaele.github ? await pruefeGithub(kanaele.github) : null

    // ── Ersteller (pump.fun) ────────────────────────────────────────────
    let erstellerFakten = null
    if (istPump && ersteller) {
        const coins = await holeJson(
            `${PUMP}/coins/user-created-coins/${encodeURIComponent(ersteller)}?offset=0&limit=50&includeNsfw=true`)
            .catch((e) => {
                logWarn('hype-projekt', `Ersteller-Historie ${ersteller.slice(0, 8)}…: ${e.message}`)
                return null
            })
        erstellerFakten = erstellerBilanz(coins, { mint: k.contract })
    }

    const fakten = {
        webseite,
        kanaele,
        github,
        ersteller: erstellerFakten ? { wallet: ersteller, ...erstellerFakten } : (ersteller ? { wallet: ersteller } : null),
    }
    const urteil = bewerteProjekt({
        webseite,
        // Kanäle nur dann werten, wenn es überhaupt Angaben zum Token gab.
        kanaele: (links.kanaele?.length || links.webseiten?.length || webseite.status === 'ok') ? kanaele : null,
        github,
        ersteller: erstellerFakten,
    })
    return { ...urteil, fakten, geprueftAm: Date.now() }
}

/**
 * Webseite lesen und das Alter ihrer Domain bestimmen.
 * @returns {Promise<object>} {status:'keine'|'fehler'|'ok', url, host, fakten?, domain, domainAlterTage, plattform}
 */
async function pruefeWebseite(url, contract) {
    if (!url) return { status: 'keine' }
    let host = ''
    try { host = new URL(url).hostname.toLowerCase() } catch { return { status: 'fehler', url, fehler: 'ungültige Adresse' } }
    const plattform = gratisPlattform(host)
    const domain = registrierbareDomain(host)

    let html
    try {
        html = await holeGeschuetzt(url, { timeout: 10000, versuche: 2 })
    } catch (e) {
        /*
         * Bot-Schutz ist kein toter Link. Hinter Cloudflare antworten auch
         * gepflegte Seiten einem Server ohne Browser mit 403 oder 503 — das ist
         * „nicht prüfbar", nicht „nicht erreichbar", und kostet keine Punkte.
         */
        const status = [401, 403, 429, 503].includes(Number(e.status)) ? 'geschuetzt' : 'fehler'
        return { status, url, host, plattform, domain, fehler: String(e.message || e).slice(0, 80) }
    }
    const f = leseWebseite(html, { contract, url })

    // Domain-Alter nur bei eigener Domain — bei einer Gratis-Plattform wäre
    // es das Alter der Plattform.
    let domainAlterTage = null
    if (domain && !plattform) {
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
            ? { url: w.url, titel: w.fakten?.titel || '', domainAlterTage: w.domainAlterTage, plattform: w.plattform }
            : { url: w.url || '', status: w.status },
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
