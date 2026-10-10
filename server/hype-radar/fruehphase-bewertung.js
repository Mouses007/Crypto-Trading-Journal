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
import { kanalAus, ordneWebseite } from './projekt-bewertung.js'

/** Höchstens so viele Momentaufnahmen je Token. Bei 15 min sind das zwölf Stunden. */
export const MAX_VERLAUF = 48

/** Ab hier gilt ein Token als „reif" für die Hauptprüfung (dieselben Werte wie dort). */
export const REIF = { minAlterStunden: 12, minLiquiditaetUsd: 50000 }

/*
 * Älter als drei Tage ist ein Token kein Frühphasen-Fund mehr, sondern
 * gestartet. Im ersten Lauf (07.10.2026) kamen alle sechs „reifen" Token aus
 * der DexScreener-Liste der Community-Übernahmen, 20 Stunden bis 85 Tage alt —
 * und einer davon (35 Tage) löste eine „Frühsignal"-Meldung aus.
 */
export const MAX_ALTER_STUNDEN = 72

/** Unter so vielen gemessenen Teilnoten meldet die Frühphase nichts. */
export const MIN_TEILNOTEN_MELDUNG = 3

/** So viele Minuten Handel muss eine Rate abdecken, um als Vergleich zu taugen. */
const MIN_BASIS_MIN = 10

/*
 * So viele Transaktionen muss eine frühere Aufnahme haben, um Vergleichsbasis
 * zu sein — dieselbe Hürde wie beim ersten Blick. Gegen eine Basis aus einem
 * einzigen Handel wurde im Testlauf vom 07.10.2026 ein „Schub 199×".
 */
const MIN_TX_BASIS = 20

/*
 * Kein einziger Handel über so viele Minuten heisst: tot, nicht ruhig. Im Lauf
 * vom 07.10.2026 hatten 100 von 133 beobachteten Token in der letzten Stunde
 * keinen Handel — und hielten ihren Platz bis zu 72 Stunden, während je
 * Durchgang nur noch vier neue Token hineinkamen.
 */
export const STILL_MIN = 30

/*
 * Unter so vielen Marktmessungen (Handel, Beteiligung, Momentum) ist eine Note
 * nicht belastbar, auch wenn drei Teilnoten da sind: Team (aus Links) und
 * Sozial (aus der Abwesenheit von Nennungen) gibt es für fast jeden Token,
 * und eine Frühphasen-Note ohne Bewegung über die Zeit misst nichts.
 */
export const MIN_MARKT_TEILNOTEN = 2
export const MARKT_TEILNOTEN = ['handel', 'beteiligung', 'momentum']

/*
 * Einseitige Käufe zählen erst ab so vielen Transaktionen. Bis 10.10.2026
 * stand hier das Verhältnis aus DexScreener, und das ist bei null Verkäufen
 * 99 — ein Token mit EINEM Kauf bekam „Auf einen Verkauf kommen 99 Käufe"
 * und 15 Punkte Abzug.
 */
const MIN_EINSEITIG_TX = 30
const EINSEITIG_FAKTOR = 8

/** Kreishandel: ab so vielen Transaktionen und so vielen je Wallet. */
const MIN_KREIS_TX = 100
const KREIS_FAKTOR = 8

/** Wash-Verdacht braucht ein Grundvolumen, sonst ist „verfünffacht" Rauschen. */
const MIN_VOL_BASIS_USD = 1000

/*
 * King of the Hill ist ein Ereignis, kein Zustand: Bis 10.10.2026 wurde es
 * fortgeschrieben und zählte als Momentum 60–80, auch Tage später und nach
 * einem Absturz. Es gilt so lange nach dem Erreichen.
 */
const KOTH_GILT_MS = 3 * 3600e3

/*
 * Momentum misst das Wachstum über höchstens dieses Fenster. Vorher war die
 * Basis die älteste gespeicherte Aufnahme — bei 48 Aufnahmen sind das je nach
 * Takt 4 Stunden (5 min) oder 48 Stunden (60 min): dieselbe Bewegung ergab je
 * nach Einstellung eine andere Note.
 */
const MOMENTUM_FENSTER_MS = 12 * 3600e3

/** Ein Pool (keine Bindungskurve) mit weniger Liquidität ist leer. */
const LEER_UNTER_USD = 100

/** Kandidat: Note ab dieser Schwelle (einstellbar, `fruehKandidatAb`). */
export const KANDIDAT_AB = 50

/** Kandidat und Meldung: so viele Transaktionen in der letzten Stunde mindestens. */
export const MIN_TX_AKTIV = 20

const zahl = (w) => (w === null || w === undefined || w === '' ? null
    : (Number.isFinite(Number(w)) ? Number(w) : null))

/** „45 min" / „3 h" — für Befundtexte. */
const dauerText = (ms) => (ms < 90 * 60e3 ? `${Math.max(1, Math.round(ms / 60e3))} min` : `${Math.round(ms / 3600e3)} h`)
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

/**
 * Womit bezahlt wird — kein Kauf, sondern das Geld dafür. Je Mittel der
 * kleinste Betrag, der als Bezahlung zählt; darunter ist es Staub.
 */
const ZAHLMITTEL = new Map([
    ['So11111111111111111111111111111111111111112', 0.005],   // wSOL
    ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1],      // USDC
    ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 1],      // USDT
])

/*
 * Ein neues Token-Konto kostet Rent: 165 Byte, 0,00203928 SOL. Bis 10.10.2026
 * galt „bezahlt", sobald über die Gebühr hinaus 0,001 SOL abflossen — die
 * Rent allein lag darüber. Wer einen Airdrop selbst abholt (signiert, eigenes
 * Konto angelegt), hatte damit „gekauft". Jetzt zählt, was über Gebühr und
 * Rent hinaus bezahlt wurde, und das muss mindestens 0,005 SOL sein.
 */
export const RENT_KONTO_LAMPORTS = 2039280
export const MIN_KAUF_LAMPORTS = 5e6

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
 * Käufe UND Abgänge einer Wallet in einer Solana-Transaktion (`getTransaction`,
 * jsonParsed). `menge` positiv ist ein Kauf, negativ ein Abgang.
 *
 * Ein Kauf heisst: Die Wallet hat die Transaktion SELBST signiert, ihr
 * Bestand eines Tokens ist gestiegen, und sie hat dafür bezahlt — SOL über
 * Gebühr und Rent neuer Konten hinaus (mindestens `MIN_KAUF_LAMPORTS`), oder
 * wSOL/USDC/USDT über den Staub hinaus. Ohne Signatur wäre jeder Airdrop ein
 * „Kauf" — und Betrüger schicken aktiven Wallets laufend Token, genau damit
 * sie in solchen Listen auftauchen.
 *
 * Ein Abgang ist jede Abnahme eines Bestands in einer selbst signierten
 * Transaktion — Verkauf, Weitergabe, Verbrennen. Für das Signal ist gleich,
 * wohin: Die Wallet hält den Token nicht mehr.
 *
 * @returns {Array<{mint:string, menge:number, zeit:number|null}>}
 */
export function handelAusTransaktion(tx, wallet) {
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

    // Rent: neue Konten kosten sie, geschlossene geben sie zurück.
    const neueKonten = [...nach.keys()].filter((m) => !vor.has(m)).length
    const geschlossen = [...vor.keys()].filter((m) => !nach.has(m)).length
    const solVor = Number(meta.preBalances?.[index])
    const solNach = Number(meta.postBalances?.[index])
    const gebuehr = Number(meta.fee) || 0
    const netto = solVor - solNach - gebuehr - neueKonten * RENT_KONTO_LAMPORTS + geschlossen * RENT_KONTO_LAMPORTS
    const solBezahlt = Number.isFinite(solVor) && Number.isFinite(solNach) && netto >= MIN_KAUF_LAMPORTS
    const geldBezahlt = [...ZAHLMITTEL].some(([m, mindest]) => (vor.get(m) || 0) - (nach.get(m) || 0) >= mindest)

    const zeit = Number(tx?.blockTime) > 0 ? Number(tx.blockTime) * 1000 : null
    const raus = []
    for (const mint of new Set([...vor.keys(), ...nach.keys()])) {
        if (ZAHLMITTEL.has(mint)) continue
        const d = (nach.get(mint) || 0) - (vor.get(mint) || 0)
        if (d > 0 && (solBezahlt || geldBezahlt)) raus.push({ mint, menge: d, zeit })
        else if (d < 0) raus.push({ mint, menge: d, zeit })
    }
    return raus
}

/** Nur die Käufe — für Aufrufer, die Abgänge nicht brauchen. */
export function kaeufeAusTransaktion(tx, wallet) {
    return handelAusTransaktion(tx, wallet).filter((k) => k.menge > 0)
}

/** Wer im Fenster mindestens so viel wieder abgegeben hat, wie er kaufte, zählt nicht. */
const ABGANG_ZAEHLT_AB = 0.5

/**
 * Käufe → Signal je Token: wie viele VERSCHIEDENE beobachtete Wallets im
 * Zeitfenster gekauft haben — und den Token noch halten.
 *
 * Eine Wallet, die kauft und fünf Minuten später alles verkauft, ist ein
 * Sniper, keine Überzeugung; bis 10.10.2026 blieb sie sechs Stunden lang
 * „Smart Money kauft" und löste eine Meldung aus, die von der Abdeckungsregel
 * ausgenommen ist. Jetzt zählt eine Wallet nicht mehr, sobald sie im Fenster
 * mindestens die Hälfte ihrer Käufe wieder abgegeben hat (`verkauft`).
 * Zeilen ohne Menge (Bestand vor dem 10.10.2026) gelten als Kauf.
 *
 * @param {Array<{wallet, mint, zeit, menge?}>} kaeufe
 * @returns {Map<string, {wallets:number, namen:string[], erste:number, verkauft:number}>}
 */
export function smartSignale(kaeufe = [], { jetzt = Date.now(), fensterMs = 6 * 3600e3, namen = new Map() } = {}) {
    const je = new Map()
    for (const k of kaeufe) {
        if (!k?.mint || !k?.wallet || !(Number(k.zeit) >= jetzt - fensterMs)) continue
        const m = Number(k.menge)
        const abgang = Number.isFinite(m) && m < 0
        if (!je.has(k.mint)) je.set(k.mint, new Map())
        const w = je.get(k.mint)
        if (!w.has(k.wallet)) w.set(k.wallet, { kauf: 0, kaeufe: 0, abgang: 0, erste: Infinity })
        const x = w.get(k.wallet)
        if (abgang) {
            x.abgang += -m
        } else {
            x.kaeufe++
            x.kauf += Number.isFinite(m) ? m : 0
            x.erste = Math.min(x.erste, Number(k.zeit))
        }
    }
    const raus = new Map()
    for (const [mint, w] of je) {
        const halten = []
        let verkauft = 0
        for (const [wallet, x] of w) {
            if (!x.kaeufe) continue
            if (x.abgang > 0 && x.abgang >= ABGANG_ZAEHLT_AB * x.kauf) { verkauft++; continue }
            halten.push([wallet, x])
        }
        if (!halten.length && !verkauft) continue
        raus.set(mint, {
            wallets: halten.length,
            namen: halten.map(([a]) => namen.get(a) || `${a.slice(0, 4)}…${a.slice(-4)}`),
            erste: halten.length ? Math.min(...halten.map(([, x]) => x.erste)) : null,
            verkauft,
        })
    }
    return raus
}

// ── Momentaufnahme ──────────────────────────────────────────────────────

/**
 * Eine Momentaufnahme aus den Marktdaten bauen — nur, was gerechnet wird.
 * Fehlendes bleibt `null`; eine 0 wäre eine erfundene Messung.
 *
 * @param {object} opts  `fenster`: wie viele Minuten die Stundenzahlen dieser
 *        Aufnahme abdecken (min(60, Alter des Paars)) — gespeichert, damit
 *        spätere Durchgänge die Rate einer alten Aufnahme nicht mit einem
 *        inzwischen anderen Alter neu rechnen.
 */
export function momentaufnahme(markt = {}, sozial = {}, ts = Date.now(), { fenster = null } = {}) {
    // Eine Bewertung von 0 ist keine Messung, sondern ein fehlendes Feld —
    // als Zahl genommen, sähe jeder Token danach „eingebrochen" aus.
    const positiv = (...w) => w.map(zahl).find((x) => x !== null && x > 0) ?? null
    return {
        ts,
        /*
         * Bewertung in fester Reihenfolge: DexScreener bzw. GeckoTerminal vor
         * pump.fun. Bis 10.10.2026 kam pump.fun zuerst, sobald der Token in
         * einer pump.fun-Liste stand — und ein Token rutscht von Lauf zu Lauf
         * in diese Listen hinein und wieder heraus. Momentum und Einbruch
         * rechneten dann zwischen zwei Quellen statt über die Zeit.
         */
        mcap: positiv(markt.marktkapitalisierung, markt.fdv, markt.marktKapUsd),
        liq: zahl(markt.liquiditaetUsd),
        preis: zahl(markt.preisUsd),
        vol1h: zahl(markt.volumen1h),
        tx1h: zahl(markt.transaktionen1h),
        tx5m: zahl(markt.transaktionen5m),
        kv1h: zahl(markt.kaufVerkauf1h),
        // Rohe Zahl der Käufe und Verkäufe (nicht Wallets) — für „einseitig".
        kaeufe1h: zahl(markt.kaeufe1h),
        verkaeufe1h: zahl(markt.verkaeufe1h),
        // Verschiedene Wallets und die Transaktionen DESSELBEN Pools — für
        // Beteiligung und Kreishandel; beides aus GeckoTerminal, nie gemischt.
        kaeufer1h: zahl(markt.kaeufer1h),
        verkaeufer1h: zahl(markt.verkaeufer1h),
        poolTx1h: zahl(markt.poolTx1h),
        aend1h: zahl(markt.aenderung1h),
        antworten: zahl(markt.antworten),
        // Halter: nur, wenn in DIESEM Durchgang gemessen (Risikoprüfung) —
        // eine fortgeschriebene Zahl sähe aus wie Stillstand.
        halter: positiv(markt.halter),
        // King of the Hill (pump.fun-Startseite): Minuten ab Start, und wann.
        kothMin: zahl(markt.kothMin),
        kothAm: zahl(markt.kothAm),
        fenster: Number.isFinite(fenster) && fenster > 0 ? fenster : null,
        erw: Number(sozial.erwaehnungen) || 0,
        plattformen: Array.isArray(sozial.plattformen) ? sozial.plattformen.length : 0,
    }
}

/**
 * Plätze eines Durchgangs verteilen: Neue bekommen bis zu `neuPlaetze`
 * reserviert, Bekannte den Rest (in der übergebenen Reihenfolge, also nach
 * Note), und was eine Seite nicht braucht, bekommt die andere.
 *
 * Bis 07.10.2026 gingen alle Plätze zuerst an Bekannte: 142 neue Token im
 * ersten Durchgang, dann 9, dann 4.
 *
 * @param {Array} bekannte  sortiert, beste zuerst
 * @param {Array} neue      sortiert, beste zuerst
 */
export function verteilePlaetze(bekannte = [], neue = [], max = 150, neuPlaetze = 50) {
    const alte = bekannte.slice(0, Math.max(0, max - Math.min(neuPlaetze, neue.length)))
    return [...alte, ...neue.slice(0, max - alte.length)]
}

/**
 * Hat diese Momentaufnahme überhaupt etwas gemessen?
 *
 * Im Lauf vom 07.10.2026 18:52 kamen für 62 von 150 Token keine Marktdaten an
 * (der DexScreener-Deckel, siehe `dexNachfassen` in quellen.js). Die Aufnahme
 * bestand aus lauter `null`, die Note nur noch aus der Team-Teilnote — und die
 * ist bei Webseite plus X-Konto 50. So standen 22 tote Token mit „50 ↗" oben
 * in der Liste. Eine Aufnahme ohne Messung ist kein Stand, sondern
 * Funkstille: Sie wird nicht geschrieben, die letzte bleibt stehen, und nach
 * `VERGESSEN_MS` fällt der Token heraus.
 *
 * Nicht mitgezählt wird, was aus dem letzten Stand übernommen ist — King of
 * the Hill und die X-Nennungen werden fortgeschrieben und sähen sonst aus wie
 * eine Messung. Nennungen aus DIESEM Durchgang gibt der Aufrufer mit.
 */
export function hatMessung(stand, sozialDiesmal = false) {
    if (!stand) return false
    return sozialDiesmal || ['mcap', 'liq', 'preis', 'vol1h', 'tx1h', 'tx5m', 'kaeufer1h', 'antworten']
        .some((k) => stand[k] !== null && stand[k] !== undefined)
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
export const RISIKO_GRENZEN = { insiderProzent: 15, insiderNetzProzent: 5, top10Prozent: 50, top10UmlaufProzent: 80, devProzent: 10 }
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
    const n = Number(sicherheit.holder_count)
    const halter = n > 0 ? n : null

    /*
     * Insider: bei RugCheck der Anteil, den die erkannten Netzwerke
     * verbundener Wallets halten (`insider_anteil_pct`, siehe `ausRugCheck`).
     * Bis 10.10.2026 summierte die Frühphase die Markierung `insider` der
     * Top-Halter — die war in 136 Prüfungen nie gesetzt, der Anteil stand
     * immer auf 0. GoPlus kennt Insider nicht: dort unbekannt, nicht 0.
     */
    const insiderPct = sicherheit.quelle === 'rugcheck'
        ? zahl(sicherheit.insider_anteil_pct)
        : (ohneKurve.some((h) => h?.tag === 'insider') ? anteil(ohneKurve.filter((h) => h?.tag === 'insider')) : null)
    const netze = Number(sicherheit.insider_netzwerke) || 0
    const top10Pct = kurveErkannt && ohneKurve.length ? summeTop10(ohneKurve, { skala: sicherheit.anteilSkala }) : null
    /*
     * Auf der Kurve gehört das meiste Angebot noch der Kurve; halten kann man
     * nur den verkauften Teil. Ein Bündel, das bei 20 % Fortschritt den ganzen
     * Umlauf hält, steht gegen das Gesamtangebot bei 20 % — gegen den Umlauf
     * bei 100 %. Gewertet wird das erst ab `MIN_HALTER_UMLAUF` Haltern: bei
     * zehn Käufern hält die Spitze den Umlauf naturgemäss.
     */
    const kurvenAnteil = aufKurve && kurveErkannt ? anteil(alle.filter((h) => !ohneKurve.includes(h))) : null
    const umlauf = kurvenAnteil !== null ? 100 - kurvenAnteil : null
    const top10UmlaufPct = top10Pct !== null && umlauf !== null && umlauf > 0 ? Math.min(100, (top10Pct / umlauf) * 100) : null

    /*
     * Ersteller: RugCheck nennt seinen Bestand selbst (`creatorBalance`) — das
     * gilt, wenn RugCheck denselben Ersteller meint. Sonst wird er unter den
     * Top-Haltern gesucht; ist er dort nicht, ist sein Anteil KLEINER als der
     * des kleinsten Top-Halters, aber nicht 0 — bis 10.10.2026 stand dann
     * „Dev 0 %" da, in 119 von 134 Prüfungen erfunden.
     */
    const dev = String(ersteller || '')
    const rcDev = sicherheit.quelle === 'rugcheck' && (!dev || !sicherheit.ersteller || sicherheit.ersteller === dev)
        ? zahl(sicherheit.ersteller_anteil_pct) : null
    const devTreffer = dev ? ohneKurve.filter((h) => h?.address === dev || h?.owner === dev) : []
    const devPct = rcDev !== null ? rcDev : (devTreffer.length ? anteil(devTreffer) : null)
    const kleinster = ohneKurve.length >= 10 ? Math.min(...ohneKurve.slice(0, 10).map((h) => (Number(h?.percent) || 0) * faktor)) : null
    const devUnterPct = devPct === null && dev && kleinster !== null ? kleinster : null

    if (insiderPct !== null && insiderPct >= RISIKO_GRENZEN.insiderProzent) {
        minus('insider', `Insider-Netzwerke halten ${insiderPct.toFixed(0)} %`)
    } else if (netze > 0 && (insiderPct === null || insiderPct >= RISIKO_GRENZEN.insiderNetzProzent)) {
        minus('insiderNetz', `RugCheck erkennt ${netze} Netzwerk(e) verbundener Insider-Wallets`
            + (insiderPct !== null ? ` mit ${insiderPct.toFixed(1)} %` : ''))
    } else if (netze > 0) {
        info('insiderNetz', `RugCheck erkennt ${netze} Netzwerk(e) verbundener Wallets, zusammen ${insiderPct.toFixed(1)} %`)
    }
    if (top10Pct !== null && top10Pct >= RISIKO_GRENZEN.top10Prozent) {
        minus('top10', `Die zehn grössten Halter halten ${top10Pct.toFixed(0)} %${aufKurve ? ' (ohne Bindungskurve)' : ''}`)
    } else if (top10UmlaufPct !== null && top10UmlaufPct >= RISIKO_GRENZEN.top10UmlaufProzent && halter !== null && halter >= MIN_HALTER_UMLAUF) {
        minus('top10', `Die zehn grössten Halter halten ${top10UmlaufPct.toFixed(0)} % des Umlaufs (ohne Bindungskurve)`)
    }
    if (devPct !== null && devPct >= RISIKO_GRENZEN.devProzent) {
        minus('devAnteil', `Der Ersteller hält selbst ${devPct.toFixed(0)} %`)
    }
    if (aufKurve && !kurveErkannt) info('top10Unbekannt', 'Top-10-Anteil nicht bestimmbar: die Bindungskurve ist unter den Haltern nicht erkennbar')

    return {
        ko, halter, quelle: sicherheit.quelle || '', insiderPct, top10Pct, top10UmlaufPct, devPct, devUnterPct, abzug, befunde,
    }
}

/** Ab so vielen Haltern zählt die Konzentration im Umlauf (auf der Kurve). */
const MIN_HALTER_UMLAUF = 50

// ── Bewertung ───────────────────────────────────────────────────────────

/** Gewichte der Teilnoten — Setzungen, die sich an der Erfolgskontrolle bewähren müssen. */
export const FRUEH_GEWICHTE = { handel: 25, beteiligung: 20, sozial: 25, team: 20, momentum: 10 }

/** Ab diesem Faktor gilt ein Schub als voll ausgeschlagen. */
const SCHUB_VOLL = 4

/*
 * Die Stundenzahlen der Quellen (`tx1h`, `vol1h`, `kaeufer1h`) zählen die
 * letzten sechzig Minuten — bei einem Token, der erst 18 Minuten existiert,
 * also nur diese 18. Unumgerechnet wächst jede solche Zahl mit dem Alter, und
 * gleichmässiger Handel sieht aus wie ein Schub: Im ersten Lauf (07.10.2026)
 * zeigten 28 von 43 Token unter einer Stunde „Handel ≥ 2×", zwei der drei
 * Meldungen beruhten darauf. Deshalb wird je Minute gerechnet, über das
 * Fenster, das die Zahl wirklich abdeckt.
 *
 * Das Fenster steht in der Aufnahme selbst (`fenster`, seit 10.10.2026);
 * ältere Aufnahmen rechnen es aus dem Alter. Ohne beides bleibt es bei der
 * Stunde (das alte Verhalten) — für einen Token über einer Stunde ist das
 * ohnehin dasselbe.
 */
function fensterVon(aufnahme, geborenAm) {
    if (Number.isFinite(aufnahme?.fenster) && aufnahme.fenster > 0) return aufnahme.fenster
    if (Number.isFinite(geborenAm)) return Math.min(60, (aufnahme.ts - geborenAm) / 60e3)
    return null
}

function jeMinute(wert, aufnahme, geborenAm) {
    if (wert === null || wert === undefined || !(wert >= 0)) return null
    const fenster = fensterVon(aufnahme, geborenAm) ?? 60
    if (fenster < MIN_BASIS_MIN) return null
    return wert / fenster
}

/**
 * Handelsschub: die letzte Stunde gegen den eigenen Verlauf — oder, solange
 * es keinen gibt, die letzten fünf Minuten gegen die Minuten DAVOR.
 *
 * Bis 07.10.2026 hiess der zweite Weg „fünf Minuten ×12 gegen die Stunde":
 * Die Stunde enthält die fünf Minuten selbst, und bei einem jungen Token ist
 * sie kürzer als sechzig — ein sechs Minuten alter Token kam bei
 * gleichmässigem Handel auf 10×.
 */
function handelsSchub(stand, frueher, geborenAm) {
    const basis = median(frueher.filter((s) => s.tx1h >= MIN_TX_BASIS)
        .map((s) => jeMinute(s.tx1h, s, geborenAm)).filter((x) => x !== null && x > 0))
    const jetzt = jeMinute(stand.tx1h, stand, geborenAm)
    if (jetzt !== null && basis) {
        return { faktor: jetzt / basis, quelle: 'verlauf' }
    }
    // Ohne Alter keine Aussage: die „Stunde" eines Unbekannten kann zwei Minuten lang sein.
    const fenster = fensterVon(stand, geborenAm)
    if (stand.tx5m === null || stand.tx1h === null || stand.tx1h < MIN_TX_BASIS || fenster === null) return null
    if (fenster - 5 < MIN_BASIS_MIN) return null
    // Mindestens ein Handel davor: aus der Stille heraus ist ein Schub echt, aber nicht unendlich.
    const davor = Math.max(1, stand.tx1h - stand.tx5m) / (fenster - 5)
    return { faktor: (stand.tx5m / 5) / davor, quelle: 'innerhalb' }
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
 * @param {number} e.geborenAm    Startzeit des Tokens (ms) oder null — rechnet
 *                                die Stundenzahlen junger Token auf ihr Alter um
 * @param {boolean} e.sozialGeprueft  lief in diesem Durchgang mindestens eine
 *                                soziale Quelle? Dann ist „nirgends genannt" eine
 *                                Messung (0) — für JEDEN Token gleich
 * @returns {{note:number, teilnoten:object, abdeckung:number, markt:number, belastbar:boolean, befunde:Array, trend:string}}
 */
export function bewerteFrueh({ stand, verlauf = [], projektNote = null, links = null, ersteller = null, profil = false, risiko = null, smart = null, geborenAm = null, sozialGeprueft = false } = {}) {
    const befunde = []
    const plus = (schluessel, text) => befunde.push({ art: 'plus', schluessel, text })
    const minus = (schluessel, text) => befunde.push({ art: 'minus', schluessel, text })
    const info = (schluessel, text) => befunde.push({ art: 'info', schluessel, text })
    const frueher = (verlauf || []).filter((s) => s && s.ts < stand.ts)
    const vorige = frueher[frueher.length - 1] || null
    const teilnoten = {}

    // ── Handel: beschleunigt er? ────────────────────────────────────────
    const schub = handelsSchub(stand, frueher, geborenAm)
    if (schub) {
        teilnoten.handel = klemme(Math.min(schub.faktor, SCHUB_VOLL) / SCHUB_VOLL * 100)
        if (schub.faktor >= 2) {
            // Gegen eine fast leere Basis ist die genaue Zahl Zufall („53,4×"); die Richtung nicht.
            const wieviel = schub.faktor > 10 ? 'über 10' : schub.faktor.toFixed(1)
            plus('handelSchub', `Handel ${wieviel}× ${schub.quelle === 'verlauf' ? 'über dem eigenen Schnitt' : 'schneller als in der Stunde zuvor'}`)
        }
    } else {
        teilnoten.handel = null
    }
    /*
     * Still: kein einziger Handel über mindestens `STILL_MIN` Minuten. Mit
     * bekanntem Alter genügt eine Aufnahme (die Stunde eines jungen Tokens
     * reicht bis zu seinem Start zurück), ohne Alter braucht es zwei, die
     * so weit auseinanderliegen. `null` ist unbekannt, nicht „kein Handel".
     */
    if (stand.tx1h === 0) {
        const fenster = fensterVon(stand, geborenAm)
        const vorMitTx = [...frueher].reverse().find((s) => s.tx1h !== null && s.tx1h !== undefined) || null
        if (fenster !== null && fenster >= STILL_MIN) {
            minus('still', `Kein einziger Handel in ${Math.round(fenster)} Minuten`)
        } else if (fenster === null && vorMitTx?.tx1h === 0 && stand.ts - vorMitTx.ts >= STILL_MIN * 60e3) {
            minus('still', `Kein einziger Handel in zwei Aufnahmen über ${Math.round((stand.ts - vorMitTx.ts) / 60e3)} Minuten`)
        }
    }

    // ── Beteiligung: viele verschiedene Käufer, nicht viele Klicks ──────
    if (stand.kaeufer1h !== null) {
        // 50 verschiedene Käufer in der Stunde: spürbar; 250: breit getragen.
        teilnoten.beteiligung = klemme((stand.kaeufer1h / 250) * 100)
        // Verglichen wird je Minute: bei einem jungen Token wächst die Stundenzahl allein mit dem Alter.
        const vorRate = vorige ? jeMinute(vorige.kaeufer1h, vorige, geborenAm) : null
        const nunRate = jeMinute(stand.kaeufer1h, stand, geborenAm)
        if (vorRate && nunRate !== null && nunRate >= vorRate * 2 && stand.kaeufer1h >= 30) {
            plus('kaeuferSchub', `Verschiedene Käufer ${vorige.kaeufer1h} → ${stand.kaeufer1h} je Stunde`)
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
    /*
     * Nur Zahlen derselben Quelle: RugCheck zählte für DPG 28 811 Halter,
     * GoPlus 10 872 — ein Wechsel zum Rückfall wäre sonst ein „Schwund" um
     * zwei Drittel, und zurück ein „Schub". Ältere Aufnahmen ohne Quelle
     * werden nicht verglichen.
     */
    const vorHalter = [...frueher].reverse().find((s) => zahl(s.halter) !== null
        && (s.halterQuelle || null) === (stand.halterQuelle || null) && stand.halterQuelle) || null
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
    /*
     * Gemessen ist Sozial, wenn in diesem Durchgang eine soziale Quelle lief —
     * dann heisst „nirgends genannt" 0, und zwar für JEDEN Token. Bis
     * 10.10.2026 entschied die pump.fun-Kommentarzahl: pump.fun-Token hatten
     * sie (meist 0) und bekamen Sozial = 0, alle anderen „unbekannt" — ein
     * Nachteil von bis zu einem Viertel des Gewichts, allein wegen der Herkunft.
     * Ein Kommentar-Zuwachs ist ein positiver Beleg und zählt immer.
     */
    let kommentareJeStunde = null
    if (vorige?.antworten !== null && vorige?.antworten !== undefined && stand.antworten !== null) {
        kommentareJeStunde = (stand.antworten - vorige.antworten) / Math.max(0.25, (stand.ts - vorige.ts) / 3600e3)
    }
    const kommentarSchub = kommentareJeStunde !== null && kommentareJeStunde >= 20
    if (sozialGeprueft || stand.plattformen > 0 || kommentarSchub) {
        let s = Math.min(60, stand.plattformen * 20)
        if (vorige && stand.erw >= 2 && stand.erw >= (vorige.erw || 0) * 2) {
            s += 25
            plus('sozialSchub', `Erwähnungen ${vorige.erw || 0} → ${stand.erw}`)
        }
        if (kommentarSchub) {
            s += 15
            plus('kommentare', `${Math.round(kommentareJeStunde)} neue Kommentare je Stunde auf pump.fun`)
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
        /*
         * Ohne Projektprüfung dieselben Massstäbe wie in ihr: Ein Tweet, ein
         * TikTok-Video oder die Coin-Seite auf pump.fun ist keine Webseite, ein
         * Link auf einen einzelnen Beitrag oder einen Handelsbot kein Kanal.
         */
        const kanaele = new Set((links?.kanaele || []).map((k) => kanalAus(k?.url))
            .filter((k) => k.gueltig && ['x', 'telegram', 'discord'].includes(k.art)).map((k) => k.art)).size
        const seite = (links?.webseiten || []).some((u) => !ordneWebseite(u).grund)
        teilnoten.team = klemme((seite ? 30 : 0) + Math.min(40, kanaele * 20))
        if (!seite && !kanaele) minus('keineSpuren', 'Weder eigene Webseite noch Kanäle angegeben')
    }
    /*
     * Ein bezahltes DexScreener-Profil ist ein Werbebudget, kein Beleg für ein
     * Team — Betrüger kaufen es genauso. Bis 07.10.2026 brachte es +30 auf die
     * Team-Teilnote und einen Pluspunkt; 13 der besten 20 hatten eines. Jetzt
     * nur noch ein Hinweis. Webseite und Kanäle aus dem Profil zählen weiter,
     * über `links`.
     */
    if (profil) info('profil', 'Bezahltes DexScreener-Profil oder Community-Übernahme — Werbebudget, kein Beleg für ein Team')
    if (ersteller?.graduiert > 0) plus('erstellerErfolg', `Ersteller hat schon ${ersteller.graduiert} Coin(s) durch die Kurve gebracht`)

    // ── Momentum: Bewertung über höchstens zwölf Stunden ────────────────
    const erste = frueher.find((s) => s.mcap !== null && s.ts >= stand.ts - MOMENTUM_FENSTER_MS) || null
    if (erste && stand.mcap !== null && erste.mcap > 0) {
        const wachstum = (stand.mcap - erste.mcap) / erste.mcap
        teilnoten.momentum = klemme((wachstum / 2) * 100)       // +200 % → voll
        if (wachstum >= 1) plus('momentum', `Bewertung +${Math.round(wachstum * 100)} % in ${dauerText(stand.ts - erste.ts)}`)
    } else {
        teilnoten.momentum = null
    }
    /*
     * King of the Hill: der Token stand oben auf der pump.fun-Startseite —
     * genug Kaufdruck, um alle anderen Starts der Stunde zu überholen. Ohne
     * Verlauf ist das die einzige Momentum-Messung, die es gibt — aber nur
     * kurz nach dem Erreichen (`KOTH_GILT_MS`). Ohne Zeitpunkt (Aufnahmen vor
     * dem 10.10.2026) zählt es nicht mehr.
     */
    const kothAm = zahl(stand.kothAm)
    if (stand.kothMin !== null && stand.kothMin !== undefined && kothAm !== null && stand.ts - kothAm <= KOTH_GILT_MS) {
        const schnell = stand.kothMin <= 30
        teilnoten.momentum = Math.max(teilnoten.momentum ?? 0, schnell ? 80 : 60)
        plus('koth', `King of the Hill auf pump.fun nach ${Math.max(1, Math.round(stand.kothMin))} min, vor ${dauerText(stand.ts - kothAm)}`)
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
    /*
     * Gemittelt wird nur über das Gemessene — richtig, denn Unbekanntes ist
     * keine 0. Die Kehrseite: je weniger gemessen, desto extremer die Note.
     * Im ersten Lauf kam die 89 aus zwei Teilnoten, eine 70 aus einer
     * einzigen. Die Note bleibt, wie sie ist; gemeldet und als Kandidat
     * geführt wird nur, was `belastbarkeit` besteht.
     */
    const b = belastbarkeit(teilnoten)
    if (gewicht && !b.ok) {
        info('duenn', b.abdeckung < MIN_TEILNOTEN_MELDUNG
            ? `Note aus nur ${b.abdeckung} von ${Object.keys(FRUEH_GEWICHTE).length} Teilnoten — zu wenig für eine Meldung`
            : (b.markt === 0
                ? 'Keine Marktmessung (Handel, Beteiligung, Momentum) — zu wenig für eine Meldung'
                : `Nur ${b.markt} Marktmessung (Handel, Beteiligung, Momentum) — zu wenig für eine Meldung`))
    }

    // ── Abzüge: Muster, die nach Inszenierung aussehen ──────────────────
    /*
     * Einseitig: viele Käufe, kaum Verkäufe. Sieht nach Nachfrage aus, ist
     * aber die Signatur eines Honeypots oder gebündelter Käufe. Gezählt
     * werden rohe Käufe und Verkäufe, und erst ab `MIN_EINSEITIG_TX` — drei
     * Käufe ohne Verkauf in den ersten Minuten sind keine Signatur.
     */
    const kaeufe = stand.kaeufe1h ?? null
    const verkaeufe = stand.verkaeufe1h ?? null
    if (kaeufe !== null && verkaeufe !== null && kaeufe + verkaeufe >= MIN_EINSEITIG_TX
        && (verkaeufe === 0 || kaeufe / verkaeufe > EINSEITIG_FAKTOR)) {
        note -= 15
        minus('einseitig', verkaeufe === 0
            ? `${kaeufe} Käufe und kein einziger Verkauf — auffällig einseitig`
            : `Auf einen Verkauf kommen ${Math.round(kaeufe / verkaeufe)} Käufe — auffällig einseitig`)
    }
    /*
     * Wenige Wallets, viele Transaktionen: dieselben Adressen handeln im
     * Kreis. Transaktionen und Wallets aus DEMSELBEN Pool (GeckoTerminal) —
     * bis 10.10.2026 kamen die Transaktionen von DexScreener und die Wallets
     * von GeckoTerminal, und das nur für ganz neue Pools: HOTBOT mit 274
     * Transaktionen von 11 Wallets lief unerkannt durch.
     */
    const wallets = (stand.kaeufer1h ?? 0) + (stand.verkaeufer1h ?? 0)
    const poolTx = stand.poolTx1h ?? null
    if (poolTx !== null && stand.kaeufer1h !== null && stand.kaeufer1h !== undefined && wallets > 0
        && poolTx >= MIN_KREIS_TX && poolTx / wallets > KREIS_FAKTOR) {
        note -= 15
        minus('kreishandel', `${poolTx} Transaktionen von nur ${wallets} Wallets — Verdacht auf Kreishandel`)
    }
    /*
     * Volumen springt, Preis bleibt stehen: das klassische Wash-Trading-
     * Muster (Bitquery: Volumen +500 % bei weniger als 5 % Preisbewegung).
     * Die Basis braucht ein Grundvolumen — gegen ein paar Dollar ist jede
     * Stunde eine Verfünffachung.
     */
    const volBasis = median(frueher.filter((s) => s.vol1h >= MIN_VOL_BASIS_USD)
        .map((s) => jeMinute(s.vol1h, s, geborenAm)).filter((x) => x !== null && x > 0))
    const volJetzt = jeMinute(stand.vol1h, stand, geborenAm)
    if (volBasis && volJetzt !== null && volJetzt > volBasis * 5
        && stand.aend1h !== null && Math.abs(stand.aend1h) < 5) {
        note -= 10
        minus('washVerdacht', 'Volumen verfünffacht, Preis kaum bewegt — Verdacht auf Wash-Trading')
    }
    /*
     * Serien-Ersteller: Die Projektprüfung zieht dafür schon ab (−20 Serie,
     * −10 Masse), und ihre Note IST die Team-Teilnote. Ein zweiter Abzug hier
     * strafte dasselbe doppelt, ein Ersteller-Erfolg zählte dagegen nur
     * einmal. Abgezogen wird nur noch, wenn keine Projektnote vorliegt.
     */
    if (ersteller && ersteller.graduiert === 0 && ersteller.andere >= 10) {
        const text = `Ersteller hat ${ersteller.andere}${ersteller.vollstaendig === false ? '+' : ''} Coins aufgelegt, keiner kam durch die Kurve`
        if (Number.isFinite(Number(projektNote)) && projektNote !== null) {
            info('erstellerSerie', text)
        } else {
            note -= 20
            minus('erstellerSerie', text)
        }
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
    return { note, teilnoten, abdeckung: b.abdeckung, markt: b.markt, belastbar: b.ok, befunde, trend }
}

/**
 * Ist eine Note belastbar? Mindestens `MIN_TEILNOTEN_MELDUNG` gemessene
 * Teilnoten, davon mindestens `MIN_MARKT_TEILNOTEN` aus dem Markt (Handel,
 * Beteiligung, Momentum). Eine Quelle für Meldung, Kandidat und Liste.
 */
export function belastbarkeit(teilnoten) {
    const gemessen = (k) => teilnoten?.[k] !== null && teilnoten?.[k] !== undefined
    const abdeckung = Object.keys(FRUEH_GEWICHTE).filter(gemessen).length
    const markt = MARKT_TEILNOTEN.filter(gemessen).length
    return { abdeckung, markt, ok: abdeckung >= MIN_TEILNOTEN_MELDUNG && markt >= MIN_MARKT_TEILNOTEN }
}

/**
 * Beruht die Note eines gespeicherten Stands auf zu wenigen Messungen? Für
 * die Liste: Solche Noten stehen unten und grau, statt die belastbaren zu
 * verdrängen — im Testlauf vom 07.10.2026 stand eine 79 aus EINER Teilnote
 * ganz oben. Gezählt wird aus den gespeicherten Teilnoten.
 */
export function istDuenn(stand) {
    return !belastbarkeit(stand?.teilnoten).ok
}

/**
 * Kein Prüfdienst kennt diesen Vertrag — eine Kette ohne RugCheck und GoPlus
 * (im ersten Lauf: Robinhood), oder der Token ist zu neu, um erfasst zu sein.
 * Kein Abzug, denn das ist keine Aussage über den Vertrag; aber auch keine
 * Meldung, denn ungeprüft ist nicht bestanden. Bis 07.10.2026 fiel dieser Fall
 * still durch (`if (!r) return`), und zwei der drei Meldungen des ersten Laufs
 * gingen für ungeprüfte Robinhood-Token hinaus.
 */
export function risikoUnpruefbar(am) {
    return {
        unpruefbar: true, ko: null, halter: null, insiderPct: null, top10Pct: null, devPct: null, abzug: 0, am,
        befunde: [{ art: 'info', schluessel: 'risikoUnpruefbar', text: 'Vertrag nicht prüfbar (kein Prüfdienst kennt ihn) — deshalb keine Meldung' }],
    }
}

/**
 * Darf dieser Stand gemeldet werden? Dieselbe Antwort entscheidet, ob der
 * Token in der Erfolgskontrolle und im Gedächtnis als „gemeldet" zählt — sonst
 * misst die Kontrolle Meldungen, die nie hinausgingen — und sie ist die
 * Grundlage der Kandidatenliste (`kandidatStatus`): Gemeldet wird nur, was
 * auch Kandidat sein könnte.
 *
 * Gesperrt ist, der Reihe nach: was verworfen ist; was nicht geprüft werden
 * konnte; eine Note, die nicht belastbar ist (`belastbarkeit`); ein Token,
 * dessen Projekt noch nicht geprüft ist (die Team-Teilnote stünde sonst nur
 * auf Links); und einer ohne laufenden Handel (`MIN_TX_AKTIV`). Smart Money
 * (zwei beobachtete Wallets) ist ein eigenes Signal und braucht nur die
 * Vertragsprüfung.
 *
 * @returns {{ja:boolean, grund:''|'verworfen'|'ungeprueft'|'duenn'|'projekt'|'handel'}}
 */
export function meldefaehig({ status, belastbar = false, risiko = null, smart = false, projektGeprueft = true, tx1h = null } = {}) {
    if (status === 'verworfen' || risiko?.ko) return { ja: false, grund: 'verworfen' }
    if (!risiko || risiko.unpruefbar) return { ja: false, grund: 'ungeprueft' }
    if (smart) return { ja: true, grund: '' }
    if (!belastbar) return { ja: false, grund: 'duenn' }
    if (!projektGeprueft) return { ja: false, grund: 'projekt' }
    if (!(Number(tx1h) >= MIN_TX_AKTIV)) return { ja: false, grund: 'handel' }
    return { ja: true, grund: '' }
}

/**
 * Ist eine gespeicherte Zeile ein Kandidat? Meldefähig, im letzten Durchgang
 * gemessen, und die Note mindestens `schwelle` — oder zwei beobachtete
 * Wallets haben gekauft. Rein: Die Route übergibt Zeile und Zeitpunkt des
 * letzten Durchgangs, gerechnet wird nur aus dem Gespeicherten.
 *
 * @param {object} z  Zeile aus `hype_frueh` mit geparstem `stand`
 * @returns {{ja:boolean, grund:string}}  `grund` wie `meldefaehig`, dazu
 *          'veraltet' (nicht im letzten Durchgang gemessen) und 'note'
 */
export function kandidatStatus(z, { letzterLauf = 0, schwelle = KANDIDAT_AB, projektPflicht = true } = {}) {
    const s = z?.stand || {}
    if (!(Number(z?.letzterBlick) >= Number(letzterLauf) - 1000)) return { ja: false, grund: 'veraltet' }
    const smart = Number(s.smart?.wallets) >= 2
    const m = meldefaehig({
        status: z?.status, belastbar: belastbarkeit(s.teilnoten).ok, risiko: s.risiko || null, smart,
        projektGeprueft: !projektPflicht || (z?.projektNote !== null && z?.projektNote !== undefined), tx1h: s.tx1h,
    })
    if (m.grund === 'verworfen') return m
    /*
     * Die Note vor den Prüfungen. Vertrag und Projekt werden je Durchgang nur
     * für die Besten geprüft (je acht) — stand „Vertrag ungeprüft" vorn, sah der
     * Trichter aus, als sei die Prüfung der Engpass: am 10.10.2026 auf der NAS
     * „125 Vertrag noch ungeprüft", obwohl fast alle davon schlicht zu schwach waren.
     */
    if (!smart && !(Number(z?.note) >= Number(schwelle))) return { ja: false, grund: 'note' }
    if (!m.ja) return m
    return { ja: true, grund: '' }
}

/**
 * Status in der Frühphase.
 *
 * `reif`: alt und liquide genug für die Hauptprüfung — der Token wandert
 * beim nächsten Scan als eigene Quelle hinein. `verworfen`: unsicher,
 * eingebrochen, still, leer oder älter als `MAX_ALTER_STUNDEN`; er wird nicht
 * weiter verfolgt.
 *
 * `aufKurve`: Ein Token auf der pump.fun-Bindungskurve hat keinen Pool, also
 * auch keine Liquidität im Sinn von „leer".
 */
export function statusFrueh(stand, alterStunden, befunde = [], { aufKurve = false } = {}) {
    if (befunde.some((b) => b.schluessel === 'sicherheitKo')) return { status: 'verworfen', grund: 'sicherheit' }
    if (befunde.some((b) => b.schluessel === 'eingebrochen')) return { status: 'verworfen', grund: 'eingebrochen' }
    if (befunde.some((b) => b.schluessel === 'still')) return { status: 'verworfen', grund: 'still' }
    /*
     * Leer: Bis 10.10.2026 verlangte die Regel zusätzlich eine Bewertung von
     * höchstens 0 — die gibt es nie (eine 0 wird beim Einlesen zu „unbekannt"),
     * die Regel griff also nie.
     */
    if (!aufKurve && stand?.liq !== null && stand?.liq !== undefined && stand.liq < LEER_UNTER_USD) {
        return { status: 'verworfen', grund: 'leer' }
    }
    if (Number(alterStunden) > MAX_ALTER_STUNDEN) return { status: 'verworfen', grund: 'alt' }
    if (Number(alterStunden) >= REIF.minAlterStunden && Number(stand?.liq) >= REIF.minLiquiditaetUsd) {
        return { status: 'reif', grund: '' }
    }
    return { status: 'beobachtet', grund: '' }
}
