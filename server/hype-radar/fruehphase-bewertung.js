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
        erw: Number(sozial.erwaehnungen) || 0,
        plattformen: Array.isArray(sozial.plattformen) ? sozial.plattformen.length : 0,
    }
}

/** Den Verlauf fortschreiben: anhängen, kappen, älteste zuerst. */
export function naechsterVerlauf(verlauf = [], stand, max = MAX_VERLAUF) {
    const v = (Array.isArray(verlauf) ? verlauf : []).filter((x) => x && Number.isFinite(x.ts))
    return [...v, stand].sort((a, b) => a.ts - b.ts).slice(-max)
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
export function bewerteFrueh({ stand, verlauf = [], projektNote = null, links = null, ersteller = null, profil = false } = {}) {
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
    if (befunde.some((b) => b.schluessel === 'eingebrochen')) return { status: 'verworfen', grund: 'eingebrochen' }
    if (stand?.liq !== null && stand?.liq !== undefined && stand.liq <= 0 && stand.mcap !== null && stand.mcap <= 0) {
        return { status: 'verworfen', grund: 'leer' }
    }
    if (Number(alterStunden) >= REIF.minAlterStunden && Number(stand?.liq) >= REIF.minLiquiditaetUsd) {
        return { status: 'reif', grund: '' }
    }
    return { status: 'beobachtet', grund: '' }
}
