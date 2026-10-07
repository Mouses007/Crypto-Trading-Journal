/**
 * Hype-Radar, Frühphase — die reine Rechnung.
 *
 * Die Hauptprüfung des Radars verlangt zwölf Stunden Paaralter und 50 000 USD
 * Liquidität. Das ist richtig für „was lässt sich vertreten" — und schliesst
 * per Bauart alles aus, was wirklich früh ist: Ein pump.fun-Token auf der
 * Bindungskurve hat noch gar keinen Pool. Die Frühphase ist deshalb eine
 * eigene Spur mit eigener Frage: nicht „ist das sicher", sondern „beschleunigt
 * hier gerade etwas, und steht jemand dahinter".
 *
 * Gemessen wird BESCHLEUNIGUNG, nicht Stand — dafür hält jeder beobachtete
 * Token eine Reihe von Momentaufnahmen (`verlauf`). Ein Token mit 500
 * Transaktionen in der Stunde ist nichts Besonderes; einer, der von 40 auf 500
 * springt, schon. Das ist die Lehre aus der Literatur (Santiment: Schub gegen
 * den eigenen Schnitt, nicht Höhe; Qureshi & Zaman 2023: verschiedene Autoren
 * statt Beitragszahl) und aus dem Befund, dass 83 % der Token mit über +100 %
 * Wash-Trading oder Poolmanipulation zeigen (USENIX Security 2026) — deshalb
 * die Abzüge unten.
 *
 * Rein: Momentaufnahmen und Fakten hinein, Note und Befunde heraus.
 */

import { pruefe, summeTop10, SKALA_PROZENT } from './sicherheit.js'

/** Höchstens so viele Momentaufnahmen je Token. Bei 15 min sind das zwölf Stunden. */
export const MAX_VERLAUF = 48

/** Ab hier gilt ein Token als „reif" für die Hauptprüfung (dieselben Werte wie dort). */
export const REIF = { minAlterStunden: 12, minLiquiditaetUsd: 50000 }

const zahl = (w) => (w === null || w === undefined || w === '' ? null
    : (Number.isFinite(Number(w)) ? Number(w) : null))
const klemme = (n) => Math.max(0, Math.min(100, n))

function median(werte) {
    const w = werte.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
    if (!w.length) return null
    const m = Math.floor(w.length / 2)
    return w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2
}

// ── Erwähnungen aus Text ────────────────────────────────────────────────

const EVM = /\b0x[a-fA-F0-9]{40}\b/g
const SOL = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g
const KUERZEL = /(?:^|[^A-Za-z0-9])\$([A-Za-z][A-Za-z0-9]{1,9})\b/g

/*
 * Base58-Zeichenketten, die keine Token sind: Systemprogramme und Wrapped
 * SOL tauchen in jedem zweiten Beitrag auf und würden sonst als „Fund" zählen.
 */
const KEINE_TOKEN = new Set([
    'So11111111111111111111111111111111111111112',
    '11111111111111111111111111111111',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',   // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',   // USDT
])

/**
 * Vertragsadressen und Kürzel aus einem Beitrag.
 *
 * Eine Solana-Adresse ist Base58 von 32 bis 44 Zeichen — dieselbe Form haben
 * Transaktions-Signaturen nicht (88 Zeichen), wohl aber manche Hashes. Ohne
 * Ziffer UND ohne Grossbuchstaben ist es fast immer ein Wort, kein Schlüssel.
 *
 * @returns {{adressen:string[], kuerzel:string[]}}
 */
export function erwaehnungenIn(text) {
    const t = String(text || '')
    const adressen = new Set()
    for (const m of t.matchAll(EVM)) adressen.add(m[0].toLowerCase())
    for (const m of t.matchAll(SOL)) {
        const a = m[0]
        if (KEINE_TOKEN.has(a)) continue
        if (!/\d/.test(a) || !/[A-Z]/.test(a) || !/[a-z]/.test(a)) continue
        adressen.add(a)
    }
    const kuerzel = new Set()
    for (const m of t.matchAll(KUERZEL)) kuerzel.add(m[1].toUpperCase())
    return { adressen: [...adressen], kuerzel: [...kuerzel] }
}

/**
 * 4chan /biz/ — Katalog lesen (öffentliches JSON, kein Schlüssel).
 *
 * Form laut github.com/4chan/4chan-API: ein Feld von Seiten, jede mit
 * `threads[]`, jeder Faden mit `sub` (Betreff), `com` (HTML-Text des
 * Eröffnungsbeitrags), `replies` und `last_modified`. Gezählt wird je Faden,
 * nicht je Antwort — der Katalog nennt nur den Eröffnungsbeitrag.
 *
 * @returns {Array<{text:string, antworten:number, zeit:number}>}
 */
export function leseBizKatalog(json) {
    const seiten = Array.isArray(json) ? json : []
    const raus = []
    for (const seite of seiten) {
        for (const f of seite?.threads || []) {
            const text = `${f?.sub || ''} ${String(f?.com || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')}`
                .replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<')
            raus.push({ text, antworten: Number(f?.replies) || 0, zeit: (Number(f?.last_modified) || 0) * 1000 })
        }
    }
    return raus
}

/** Ab so vielen verschiedenen Autoren legt X einen bisher unbekannten Token an. */
export const X_MIN_AUTOREN_NEU = 2

/**
 * X-Posts → Nennungen je Token, gezählt nach VERSCHIEDENEN AUTOREN.
 *
 * Die Posts kommen von Grok, also aus einer Modellantwort. Drei Sperren, damit
 * daraus eine Messung wird und keine Behauptung:
 *
 *   1. Nur Posts, die die Suche ZITIERT hat (`zitierteIds`). Ein Post, den das
 *      Modell nennt, aber nie gesehen hat, ist erfunden. Fehlt die Zitatliste
 *      ganz (anderer API-Stand), entfällt diese Sperre — die übrigen bleiben.
 *   2. Gezählt wird, was im TEXT steht (`erwaehnungenIn`), nicht was das
 *      Modell zuordnet.
 *   3. Autoren statt Posts: zehn Posts eines Kontos sind ein Shill, kein
 *      Trend (Qureshi & Zaman 2023). Ein bisher unbekannter Token braucht
 *      mindestens `X_MIN_AUTOREN_NEU` verschiedene Autoren.
 *
 * Ein $KÜRZEL zählt wie überall in der Frühphase nur für einen bekannten
 * Token, dessen Kürzel eindeutig ist.
 *
 * @param {Array<{handle:string, id:string, url:string, text:string}>} posts
 * @param {Set<string>} zitierteIds
 * @param {{adressen:Set<string>, symbole:Map<string, string|null>}} bekannt
 *        Adressen (EVM klein) und Kürzel → Adresse (null = mehrdeutig)
 * @returns {{adressen:Map<string,{autoren:number, belege:string[]}>, verworfen:number, gezaehlt:number}}
 */
export function xNennungen(posts = [], zitierteIds = new Set(), bekannt = {}) {
    const bekannteAdressen = bekannt.adressen || new Set()
    const symbole = bekannt.symbole || new Map()
    const pruefeZitat = zitierteIds && zitierteIds.size > 0
    const je = new Map()
    let verworfen = 0
    let gezaehlt = 0
    for (const p of (Array.isArray(posts) ? posts : [])) {
        if (pruefeZitat && !zitierteIds.has(String(p?.id || ''))) { verworfen++; continue }
        const autor = String(p?.handle || '').toLowerCase()
        if (!autor) { verworfen++; continue }
        const e = erwaehnungenIn(p?.text)
        const ziele = new Set(e.adressen)
        for (const k of e.kuerzel) {
            const adr = symbole.get(k)
            if (adr) ziele.add(adr)
        }
        if (!ziele.size) continue
        gezaehlt++
        for (const adr of ziele) {
            if (!je.has(adr)) je.set(adr, { autoren: new Set(), belege: [] })
            const x = je.get(adr)
            if (!x.autoren.has(autor) && x.belege.length < 3 && p.url) x.belege.push(String(p.url))
            x.autoren.add(autor)
        }
    }
    const adressen = new Map()
    for (const [adr, x] of je) {
        if (!bekannteAdressen.has(adr) && x.autoren.size < X_MIN_AUTOREN_NEU) continue
        adressen.set(adr, { autoren: x.autoren.size, belege: x.belege })
    }
    return { adressen, verworfen, gezaehlt }
}

// ── Smart Money: was beobachtete Wallets kaufen ─────────────────────────

/** Womit bezahlt wird — kein Kauf, sondern das Geld dafür. */
const ZAHLMITTEL = new Set([
    'So11111111111111111111111111111111111111112',   // wSOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  // USDT
])

const SOLANA_ADRESSE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/**
 * Wallet-Liste aus der Oberfläche: „Adresse Name" je Zeile oder Objekte.
 * Nur Solana-Adressen, ohne Doppelte, höchstens dreissig.
 */
export function smartWalletListe(roh) {
    const zeilen = Array.isArray(roh) ? roh : String(roh || '').split(/\r?\n/)
    const raus = new Map()
    for (const z of zeilen) {
        const [adresse, ...rest] = typeof z === 'object' && z
            ? [String(z.adresse || '').trim(), String(z.name || '').trim()]
            : String(z || '').trim().split(/[\s,;]+/)
        if (!SOLANA_ADRESSE.test(adresse || '') || raus.has(adresse)) continue
        raus.set(adresse, { adresse, name: rest.join(' ').trim().slice(0, 40) })
    }
    return [...raus.values()].slice(0, 30)
}

/**
 * Käufe einer Wallet in einer Solana-Transaktion (`getTransaction`, jsonParsed).
 *
 * Ein Kauf heisst: Die Wallet hat die Transaktion SELBST signiert, ihr
 * Bestand eines Tokens ist gestiegen, und sie hat dafür bezahlt (SOL über die
 * Gebühr hinaus, oder wSOL/USDC/USDT weniger). Ohne Signatur wäre jeder
 * Airdrop ein „Kauf" — und Betrüger schicken aktiven Wallets laufend Token,
 * genau damit sie in solchen Listen auftauchen.
 *
 * @returns {Array<{mint:string, menge:number, zeit:number|null}>}
 */
export function kaeufeAusTransaktion(tx, wallet) {
    const meta = tx?.meta
    if (!meta || meta.err) return []
    const schluessel = tx?.transaction?.message?.accountKeys || []
    const index = schluessel.findIndex((k) => (typeof k === 'string' ? k : k?.pubkey) === wallet)
    if (index < 0) return []
    const eintrag = schluessel[index]
    // jsonParsed nennt `signer` je Konto; in der Rohform sind die ersten
    // `numRequiredSignatures` Schlüssel die Signierer.
    const signiert = typeof eintrag === 'object' && eintrag !== null && 'signer' in eintrag
        ? eintrag.signer === true
        : index < (Number(tx?.transaction?.message?.header?.numRequiredSignatures) || 1)
    if (!signiert) return []

    const menge = (b) => {
        const t = b?.uiTokenAmount
        const z = Number(t?.uiAmountString ?? t?.uiAmount)
        return Number.isFinite(z) ? z : 0
    }
    const bestand = (liste) => {
        const m = new Map()
        for (const b of liste || []) if (b?.owner === wallet && b?.mint) m.set(b.mint, (m.get(b.mint) || 0) + menge(b))
        return m
    }
    const vor = bestand(meta.preTokenBalances)
    const nach = bestand(meta.postTokenBalances)

    const solVor = Number(meta.preBalances?.[index])
    const solNach = Number(meta.postBalances?.[index])
    const gebuehr = Number(meta.fee) || 0
    const solBezahlt = Number.isFinite(solVor) && Number.isFinite(solNach) && solVor - solNach > gebuehr + 1e6   // > 0,001 SOL
    const geldBezahlt = [...ZAHLMITTEL].some((m) => (vor.get(m) || 0) > (nach.get(m) || 0))
    if (!solBezahlt && !geldBezahlt) return []

    const zeit = Number(tx?.blockTime) > 0 ? Number(tx.blockTime) * 1000 : null
    const raus = []
    for (const [mint, n] of nach) {
        if (ZAHLMITTEL.has(mint)) continue
        const zuwachs = n - (vor.get(mint) || 0)
        if (zuwachs > 0) raus.push({ mint, menge: zuwachs, zeit })
    }
    return raus
}

/**
 * Käufe → Signal je Token: wie viele VERSCHIEDENE beobachtete Wallets im
 * Zeitfenster gekauft haben.
 *
 * @param {Array<{wallet, mint, zeit}>} kaeufe
 * @returns {Map<string, {wallets:number, namen:string[], erste:number}>}
 */
export function smartSignale(kaeufe = [], { jetzt = Date.now(), fensterMs = 6 * 3600e3, namen = new Map() } = {}) {
    const je = new Map()
    for (const k of kaeufe) {
        if (!k?.mint || !k?.wallet || !(Number(k.zeit) >= jetzt - fensterMs)) continue
        if (!je.has(k.mint)) je.set(k.mint, { wallets: new Set(), erste: Number(k.zeit) })
        const x = je.get(k.mint)
        x.wallets.add(k.wallet)
        x.erste = Math.min(x.erste, Number(k.zeit))
    }
    const raus = new Map()
    for (const [mint, x] of je) {
        raus.set(mint, {
            wallets: x.wallets.size,
            namen: [...x.wallets].map((w) => namen.get(w) || `${w.slice(0, 4)}…${w.slice(-4)}`),
            erste: x.erste,
        })
    }
    return raus
}

// ── Momentaufnahme ──────────────────────────────────────────────────────

/**
 * Eine Momentaufnahme aus den Marktdaten bauen — nur, was gerechnet wird.
 * Fehlendes bleibt `null`; eine 0 wäre eine erfundene Messung.
 */
export function momentaufnahme(markt = {}, sozial = {}, ts = Date.now()) {
    // Eine Bewertung von 0 ist keine Messung, sondern ein fehlendes Feld —
    // als Zahl genommen, sähe jeder Token danach „eingebrochen" aus.
    const positiv = (...w) => w.map(zahl).find((x) => x !== null && x > 0) ?? null
    return {
        ts,
        mcap: positiv(markt.marktKapUsd, markt.marktkapitalisierung, markt.fdv),
        liq: zahl(markt.liquiditaetUsd),
        preis: zahl(markt.preisUsd),
        vol1h: zahl(markt.volumen1h),
        tx1h: zahl(markt.transaktionen1h),
        tx5m: zahl(markt.transaktionen5m),
        kv1h: zahl(markt.kaufVerkauf1h),
        kaeufer1h: zahl(markt.kaeufer1h),
        verkaeufer1h: zahl(markt.verkaeufer1h),
        aend1h: zahl(markt.aenderung1h),
        antworten: zahl(markt.antworten),
        // Halter: nur, wenn in DIESEM Durchgang gemessen (Risikoprüfung) —
        // eine fortgeschriebene Zahl sähe aus wie Stillstand.
        halter: positiv(markt.halter),
        // Minuten vom Start bis „King of the Hill" (pump.fun-Startseite).
        kothMin: zahl(markt.kothMin),
        erw: Number(sozial.erwaehnungen) || 0,
        plattformen: Array.isArray(sozial.plattformen) ? sozial.plattformen.length : 0,
    }
}

/** Den Verlauf fortschreiben: anhängen, kappen, älteste zuerst. */
export function naechsterVerlauf(verlauf = [], stand, max = MAX_VERLAUF) {
    const v = (Array.isArray(verlauf) ? verlauf : []).filter((x) => x && Number.isFinite(x.ts))
    return [...v, stand].sort((a, b) => a.ts - b.ts).slice(-max)
}

// ── Risiko: Vertrag und Halter ──────────────────────────────────────────

/*
 * Prüfregeln der Frühphase: nur der Vertrag, nicht der Markt. Mindest-
 * liquidität, Mindestalter und LP-Sperre sind genau die Hürden, VOR denen die
 * Frühphase läuft; die K.-o.-Regeln des Vertrags (Honeypot, Mint, Freeze,
 * verdeckte Eigentümer …) gelten dagegen von der ersten Minute an.
 */
const FRUEH_REGELN = {
    minLiquiditaetUsd: 0, minPaarAlterStunden: 0, lpMussGesperrtSein: false,
    maxTop10Prozent: 100, maxFdvLiqVerhaeltnis: Number.POSITIVE_INFINITY,
}

/** Ab hier kostet ein Halterbild Punkte. Setzungen wie die Gewichte. */
export const RISIKO_GRENZEN = { insiderProzent: 15, top10Prozent: 50, devProzent: 10 }
const RISIKO_ABZUG = { sicherheitKo: 60, insider: 15, top10: 10, devAnteil: 10, insiderNetz: 10 }

/**
 * Insider, Top-10, Dev-Anteil und die Vertrags-K.-o.-Regeln — das, was
 * Trading-Terminals (GMGN, Axiom) bei einem neuen Token zuerst zeigen.
 *
 * Bei pump.fun-Token auf der Kurve hält die BINDUNGSKURVE selbst den grössten
 * Teil des Angebots. Sie muss aus der Top-10-Rechnung heraus — und ist sie
 * nicht als Halter erkennbar, bleibt der Top-10-Anteil unbekannt, statt mit
 * 80 % jeden Kurven-Token als „Klumpen" zu verwerfen.
 *
 * @param {object|null} sicherheit  Antwort in GoPlus-Sprache (`ausRugCheck`, `holeGoPlus`)
 * @param {object} opts  {kurve: Adressen der Bindungskurve, ersteller, aufKurve}
 * @returns {null|{ko, halter, insiderPct, top10Pct, devPct, abzug, befunde}}
 */
export function risikoFrueh(sicherheit, { kurve = [], ersteller = '', aufKurve = false } = {}) {
    if (!sicherheit || typeof sicherheit !== 'object') return null
    const befunde = []
    let abzug = 0
    const minus = (schluessel, text) => { abzug += RISIKO_ABZUG[schluessel] || 0; befunde.push({ art: 'minus', schluessel, text }) }
    const info = (schluessel, text) => befunde.push({ art: 'info', schluessel, text })

    const urteil = pruefe(sicherheit, {}, FRUEH_REGELN)
    const ko = urteil.status === 'verworfen' ? { grund: urteil.grund, text: urteil.hinweise[urteil.hinweise.length - 1] || urteil.grund } : null
    if (ko) minus('sicherheitKo', ko.text)

    const faktor = sicherheit.anteilSkala === SKALA_PROZENT ? 1 : 100
    const ausnahmen = new Set((kurve || []).filter(Boolean).map(String))
    const alle = Array.isArray(sicherheit.holders) ? sicherheit.holders : []
    const ohneKurve = alle.filter((h) => !ausnahmen.has(String(h?.address || '')) && !ausnahmen.has(String(h?.owner || '')))
    const kurveErkannt = !aufKurve || ohneKurve.length < alle.length
    const anteil = (liste) => liste.reduce((a, h) => a + (Number(h?.percent) || 0) * faktor, 0)

    // RugCheck markiert Insider je Halter; GoPlus kennt das Merkmal nicht —
    // dort bleibt der Anteil unbekannt statt 0.
    const insiderPct = sicherheit.quelle === 'rugcheck'
        ? anteil(ohneKurve.filter((h) => h?.tag === 'insider'))
        : (ohneKurve.some((h) => h?.tag === 'insider') ? anteil(ohneKurve.filter((h) => h?.tag === 'insider')) : null)
    const top10Pct = kurveErkannt && ohneKurve.length ? summeTop10(ohneKurve, { skala: sicherheit.anteilSkala }) : null
    const dev = String(ersteller || '')
    // Nicht unter den grössten Haltern heisst: weniger als der kleinste davon.
    const devPct = dev && alle.length ? anteil(ohneKurve.filter((h) => h?.address === dev || h?.owner === dev)) : null

    if (insiderPct !== null && insiderPct >= RISIKO_GRENZEN.insiderProzent) {
        minus('insider', `Als Insider markierte Wallets halten ${insiderPct.toFixed(0)} %`)
    }
    if (top10Pct !== null && top10Pct >= RISIKO_GRENZEN.top10Prozent) {
        minus('top10', `Die zehn grössten Halter halten ${top10Pct.toFixed(0)} %${aufKurve ? ' (ohne Bindungskurve)' : ''}`)
    }
    if (devPct !== null && devPct >= RISIKO_GRENZEN.devProzent) {
        minus('devAnteil', `Der Ersteller hält selbst ${devPct.toFixed(0)} %`)
    }
    if (Number(sicherheit.insider_netzwerke) > 0) {
        minus('insiderNetz', `RugCheck erkennt ${Number(sicherheit.insider_netzwerke)} Netzwerk(e) verbundener Insider-Wallets`)
    }
    if (aufKurve && !kurveErkannt) info('top10Unbekannt', 'Top-10-Anteil nicht bestimmbar: die Bindungskurve ist unter den Haltern nicht erkennbar')

    const n = Number(sicherheit.holder_count)
    return { ko, halter: n > 0 ? n : null, insiderPct, top10Pct, devPct, abzug, befunde }
}

// ── Bewertung ───────────────────────────────────────────────────────────

/** Gewichte der Teilnoten — Setzungen, die sich an der Erfolgskontrolle bewähren müssen. */
export const FRUEH_GEWICHTE = { handel: 25, beteiligung: 20, sozial: 25, team: 20, momentum: 10 }

/** Ab diesem Faktor gilt ein Schub als voll ausgeschlagen. */
const SCHUB_VOLL = 4

/**
 * Handelsschub: die letzte Stunde gegen den eigenen Verlauf — oder, solange
 * es keinen gibt, die letzten fünf Minuten gegen die Stunde (×12).
 */
function handelsSchub(stand, frueher) {
    const basis = median(frueher.map((s) => s.tx1h).filter((x) => x !== null && x > 0))
    if (stand.tx1h !== null && basis) {
        return { faktor: stand.tx1h / basis, quelle: 'verlauf' }
    }
    if (stand.tx5m !== null && stand.tx1h !== null && stand.tx1h >= 20) {
        return { faktor: (stand.tx5m * 12) / stand.tx1h, quelle: 'innerhalb' }
    }
    return null
}

/**
 * Note und Befunde der Frühphase.
 *
 * @param {object} e
 * @param {object} e.stand        jüngste Momentaufnahme
 * @param {Array}  e.verlauf      frühere Momentaufnahmen (ohne `stand`)
 * @param {number} e.projektNote  Substanz-Note der Projektprüfung (oder null)
 * @param {object} e.links        {webseiten, kanaele}
 * @param {object} e.ersteller    Ersteller-Bilanz (oder null)
 * @param {boolean} e.profil      bezahltes DexScreener-Profil / Community-Übernahme
 * @returns {{note:number, teilnoten:object, befunde:Array, trend:string}}
 */
export function bewerteFrueh({ stand, verlauf = [], projektNote = null, links = null, ersteller = null, profil = false, risiko = null, smart = null } = {}) {
    const befunde = []
    const plus = (schluessel, text) => befunde.push({ art: 'plus', schluessel, text })
    const minus = (schluessel, text) => befunde.push({ art: 'minus', schluessel, text })
    const info = (schluessel, text) => befunde.push({ art: 'info', schluessel, text })
    const frueher = (verlauf || []).filter((s) => s && s.ts < stand.ts)
    const vorige = frueher[frueher.length - 1] || null
    const teilnoten = {}

    // ── Handel: beschleunigt er? ────────────────────────────────────────
    const schub = handelsSchub(stand, frueher)
    if (schub) {
        teilnoten.handel = klemme(Math.min(schub.faktor, SCHUB_VOLL) / SCHUB_VOLL * 100)
        if (schub.faktor >= 2) {
            plus('handelSchub', `Handel ${schub.faktor.toFixed(1)}× ${schub.quelle === 'verlauf' ? 'über dem eigenen Schnitt' : 'schneller als in der Stunde zuvor'}`)
        }
    } else {
        teilnoten.handel = null
    }

    // ── Beteiligung: viele verschiedene Käufer, nicht viele Klicks ──────
    if (stand.kaeufer1h !== null) {
        // 50 verschiedene Käufer in der Stunde: spürbar; 250: breit getragen.
        teilnoten.beteiligung = klemme((stand.kaeufer1h / 250) * 100)
        const vorKaeufer = vorige?.kaeufer1h
        if (vorKaeufer && stand.kaeufer1h >= vorKaeufer * 2 && stand.kaeufer1h >= 30) {
            plus('kaeuferSchub', `Verschiedene Käufer ${vorKaeufer} → ${stand.kaeufer1h} je Stunde`)
        }
    } else {
        teilnoten.beteiligung = null
    }
    /*
     * Halterwachstum — die Zahl, die jedes Terminal neben den Käufern zeigt.
     * Verglichen mit der letzten Momentaufnahme, die eine Halterzahl hatte
     * (gemessen wird nur bei den Besten eines Durchgangs). +100 Halter je
     * Stunde gilt als voll; die bessere der beiden Beteiligungs-Messungen zählt.
     */
    const vorHalter = [...frueher].reverse().find((s) => zahl(s.halter) !== null) || null
    if (stand.halter !== null && stand.halter !== undefined && vorHalter && vorHalter.halter > 0) {
        const stunden = Math.max(0.25, (stand.ts - vorHalter.ts) / 3600e3)
        const zuwachs = (stand.halter - vorHalter.halter) / stunden
        teilnoten.beteiligung = Math.max(teilnoten.beteiligung ?? 0, klemme(zuwachs))
        if (zuwachs >= 30 && stand.halter >= vorHalter.halter * 1.5) {
            plus('halterSchub', `Halter ${vorHalter.halter} → ${stand.halter} (+${Math.round(zuwachs)} je Stunde)`)
        } else if (stand.halter < vorHalter.halter * 0.8) {
            minus('halterSchwund', `Halter ${vorHalter.halter} → ${stand.halter} — es wird verkauft`)
        }
    }

    // ── Sozial: mehr Plattformen, mehr Erwähnungen als zuvor ────────────
    const sozialMessbar = stand.plattformen > 0 || stand.antworten !== null
    if (sozialMessbar) {
        let s = Math.min(60, stand.plattformen * 20)
        if (vorige && stand.erw >= 2 && stand.erw >= (vorige.erw || 0) * 2) {
            s += 25
            plus('sozialSchub', `Erwähnungen ${vorige.erw || 0} → ${stand.erw}`)
        }
        // pump.fun-Kommentare: Zuwachs je Stunde seit der letzten Aufnahme.
        if (vorige?.antworten !== null && vorige?.antworten !== undefined && stand.antworten !== null) {
            const stunden = Math.max(0.25, (stand.ts - vorige.ts) / 3600e3)
            const jeStunde = (stand.antworten - vorige.antworten) / stunden
            if (jeStunde >= 20) {
                s += 15
                plus('kommentare', `${Math.round(jeStunde)} neue Kommentare je Stunde auf pump.fun`)
            }
        }
        teilnoten.sozial = klemme(s)
        if (stand.plattformen >= 2) plus('plattformen', `Erwähnt auf ${stand.plattformen} unabhängigen Plattformen`)
    } else {
        teilnoten.sozial = null
    }

    // ── Team: Substanz-Note, sonst die Spuren, die ein Team hinterlässt ─
    if (projektNote !== null && projektNote !== undefined && Number.isFinite(Number(projektNote))) {
        teilnoten.team = klemme(Number(projektNote))
    } else {
        const kanaele = (links?.kanaele || []).length
        const seite = (links?.webseiten || []).length
        teilnoten.team = klemme((seite ? 30 : 0) + Math.min(40, kanaele * 20) + (profil ? 30 : 0))
        if (!seite && !kanaele) minus('keineSpuren', 'Weder Webseite noch Kanäle angegeben')
    }
    if (profil) plus('profil', 'Bezahltes DexScreener-Profil oder Community-Übernahme — jemand investiert in Sichtbarkeit')
    if (ersteller?.graduiert > 0) plus('erstellerErfolg', `Ersteller hat schon ${ersteller.graduiert} Coin(s) durch die Kurve gebracht`)

    // ── Momentum: Bewertung seit dem ersten Blick ───────────────────────
    const erste = frueher.find((s) => s.mcap !== null) || null
    if (erste && stand.mcap !== null && erste.mcap > 0) {
        const wachstum = (stand.mcap - erste.mcap) / erste.mcap
        teilnoten.momentum = klemme((wachstum / 2) * 100)       // +200 % → voll
        if (wachstum >= 1) plus('momentum', `Bewertung seit dem ersten Blick +${Math.round(wachstum * 100)} %`)
    } else {
        teilnoten.momentum = null
    }
    /*
     * King of the Hill: der Token stand oben auf der pump.fun-Startseite —
     * genug Kaufdruck, um alle anderen Starts der Stunde zu überholen. Ohne
     * Verlauf ist das die einzige Momentum-Messung, die es gibt.
     */
    if (stand.kothMin !== null && stand.kothMin !== undefined) {
        const schnell = stand.kothMin <= 30
        teilnoten.momentum = Math.max(teilnoten.momentum ?? 0, schnell ? 80 : 60)
        plus('koth', `King of the Hill auf pump.fun nach ${Math.max(1, Math.round(stand.kothMin))} min`)
    }

    // ── Gewichtete Note über das, was messbar war ───────────────────────
    let summe = 0
    let gewicht = 0
    for (const [k, g] of Object.entries(FRUEH_GEWICHTE)) {
        if (teilnoten[k] === null || teilnoten[k] === undefined) continue
        summe += teilnoten[k] * g
        gewicht += g
    }
    let note = gewicht ? summe / gewicht : 0

    // ── Abzüge: Muster, die nach Inszenierung aussehen ──────────────────
    /*
     * Einseitig: viele Käufe, kaum Verkäufe. Sieht nach Nachfrage aus, ist
     * aber die Signatur eines Honeypots oder gebündelter Käufe.
     */
    if (stand.kv1h !== null && stand.kv1h > 8) {
        note -= 15
        minus('einseitig', `Auf einen Verkauf kommen ${Math.round(stand.kv1h)} Käufe — auffällig einseitig`)
    }
    /*
     * Wenige Wallets, viele Transaktionen: dieselben Adressen handeln im
     * Kreis. Gemessen gegen die Zahl der VERSCHIEDENEN Käufer und Verkäufer.
     */
    const wallets = (stand.kaeufer1h || 0) + (stand.verkaeufer1h || 0)
    if (stand.tx1h !== null && wallets > 0 && stand.tx1h / wallets > 8 && stand.tx1h >= 100) {
        note -= 15
        minus('kreishandel', `${stand.tx1h} Transaktionen von nur ${wallets} Wallets — Verdacht auf Kreishandel`)
    }
    /*
     * Volumen springt, Preis bleibt stehen: das klassische Wash-Trading-
     * Muster (Bitquery: Volumen +500 % bei weniger als 5 % Preisbewegung).
     */
    const volBasis = median(frueher.map((s) => s.vol1h).filter((x) => x !== null && x > 0))
    if (volBasis && stand.vol1h !== null && stand.vol1h > volBasis * 5
        && stand.aend1h !== null && Math.abs(stand.aend1h) < 5) {
        note -= 10
        minus('washVerdacht', 'Volumen verfünffacht, Preis kaum bewegt — Verdacht auf Wash-Trading')
    }
    if (ersteller && ersteller.graduiert === 0 && ersteller.andere >= 10) {
        note -= 20
        minus('erstellerSerie', `Ersteller hat ${ersteller.andere} Coins aufgelegt, keiner kam durch die Kurve`)
    }
    // Eingebrochen: vom Höchststand der Beobachtung um mehr als 80 % gefallen.
    const hoch = Math.max(0, ...frueher.map((s) => s.mcap || 0), stand.mcap || 0)
    if (hoch > 0 && stand.mcap !== null && stand.mcap < hoch * 0.2) {
        note -= 30
        minus('eingebrochen', `Bewertung ${Math.round((1 - stand.mcap / hoch) * 100)} % unter dem Höchststand der Beobachtung`)
    }
    // Vertrag und Halter (`risikoFrueh`): Abzüge stehen dort, hier nur verbucht.
    if (risiko) {
        note -= Number(risiko.abzug) || 0
        befunde.push(...(risiko.befunde || []))
    }
    /*
     * Smart Money: beobachtete Wallets haben gekauft. Eine allein ist ein
     * Hinweis, zwei unabhängige auf denselben Token das stärkste Frühsignal,
     * das es ohne Insiderwissen gibt.
     */
    if (smart?.wallets > 0) {
        note += smart.wallets >= 2 ? 20 : 8
        plus('smartMoney', `${smart.wallets} beobachtete Wallet(s) gekauft${smart.namen?.length ? ': ' + smart.namen.slice(0, 3).join(', ') : ''}`)
    }
    if (!gewicht) info('zuWenig', 'Noch zu wenige Messungen für eine Einschätzung')

    note = Math.round(klemme(note))
    const vorNote = zahl(vorige?.note)
    const trend = vorNote === null ? 'neu' : (note > vorNote + 5 ? 'steigt' : (note < vorNote - 5 ? 'faellt' : 'gleich'))
    return { note, teilnoten, befunde, trend }
}

/**
 * Status in der Frühphase.
 *
 * `reif`: alt und liquide genug für die Hauptprüfung — der Token wandert
 * beim nächsten Scan als eigene Quelle hinein. `verworfen`: eingebrochen oder
 * tot; er wird nicht weiter verfolgt.
 */
export function statusFrueh(stand, alterStunden, befunde = []) {
    if (befunde.some((b) => b.schluessel === 'sicherheitKo')) return { status: 'verworfen', grund: 'sicherheit' }
    if (befunde.some((b) => b.schluessel === 'eingebrochen')) return { status: 'verworfen', grund: 'eingebrochen' }
    if (stand?.liq !== null && stand?.liq !== undefined && stand.liq <= 0 && stand.mcap !== null && stand.mcap <= 0) {
        return { status: 'verworfen', grund: 'leer' }
    }
    if (Number(alterStunden) >= REIF.minAlterStunden && Number(stand?.liq) >= REIF.minLiquiditaetUsd) {
        return { status: 'reif', grund: '' }
    }
    return { status: 'beobachtet', grund: '' }
}
