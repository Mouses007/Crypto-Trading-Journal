/**
 * Coin-Radar, Einzelprüfung: ein Symbol auf Zuruf messen.
 *
 * Der Lauf beantwortet „welcher Coin heute", diese Datei beantwortet „und was
 * ist mit DIESEM". Zwei Gründe, warum das kein Luxus ist:
 *
 *  1. DAS UNIVERSUM IST EINE SCHNITTMENGE. Der Lauf misst, was Bitunix führt
 *     UND Binance mit Kerzen versorgt (`lauf.js`, Stufe 1). Gemessen am
 *     04.09.2026: 790 Bitunix-Perpetuals, 524 Binance-Coin-Perpetuals, 499
 *     gemeinsam — 291 auf Bitunix handelbare Paare sieht die Rangliste nie.
 *     Ein Teil davon sind getarnte Aktien (TSLAUSDT, JPMUSDT), die dort auch
 *     nichts verloren haben; der Rest sind echte Coins wie CASHCATUSDT, die
 *     schlicht zu neu oder zu klein für Binance sind.
 *
 *  2. DIE HÜRDEN SIND FÜR EINE LISTE GEBAUT, NICHT FÜR EINE FRAGE. Wer die
 *     Rangliste öffnet, will keine 500 Zeilen; Umsatz unter 10 Mio fliegt
 *     deshalb raus. Wer dagegen ein bestimmtes Symbol eintippt, hat den Coin
 *     schon vor Augen und will die Zahlen sehen — auch und gerade die
 *     schlechten. Hier wird die Hürde also GEPRÜFT und ANGEZEIGT, aber sie
 *     bricht nichts ab.
 *
 * ── Zwei Datenpfade, und die Quelle wird ausgewiesen ────────────────────
 *
 * Führt Binance das Paar, läuft die Messung exakt wie im Lauf (dieselben drei
 * marktweiten Abrufe, dieselben Kerzen) — das Ergebnis ist mit der Rangliste
 * vergleichbar. Führt es nur Bitunix, kommen Ticker, Kerzen, Funding und Buch
 * von dort. Die Zahlen sind dann für sich richtig, aber NICHT direkt gegen die
 * Rangliste zu halten: RVOL misst Volumen gegen das eigene Normalmass, und das
 * Normalmass einer kleineren Börse ist ein anderes. `vergleichbar: false` sagt
 * das, und die Oberfläche schreibt es hin.
 *
 * ⚠ FUNDING-EINHEIT. Binance liefert den Dezimalbruch (0.0001 = 0,01 %),
 * Bitunix liefert Prozent (gemessen 04.09.2026: BTCUSDT −0,004229 bei Bitunix
 * gegen 0,00004235 bei Binance, Faktor 100; Bitunix' `maxFundingRate` von 0,3
 * ergibt nur als Prozent einen Sinn). Wer das verwechselt, rechnet die
 * Kosten-Teilnote um zwei Zehnerpotenzen falsch — und zwar in die Richtung,
 * die einen teuren Coin billig aussehen lässt.
 *
 * Alles, was nicht ans Netz muss, ist als reine Funktion herausgezogen und in
 * `__selftest-einzel.mjs` geprüft.
 */

import { getClosedCandles, TIMEFRAME_MS } from '../market-data.js'
import { holeJson as radarJson } from '../marktradar-api.js'
import { warteAufGewicht } from '../binance-takt.js'
import { holeHandelbar, holeTestbar } from '../coin-universum.js'
import { ladeListungen, pruefeListung } from '../hype-radar/listungen.js'
import { logWarn } from '../logger.js'
import { holeMarktweit, KERZEN_ANZAHL } from './daten.js'
import { BOERSEN, besteBoerse } from './boersen.js'
import { ausfuehrungsGuete, noteAusfuehrung } from './ausfuehrung.js'
import { rechneAlle, fundingJahresRate } from './kennzahlen.js'
import {
    bewerte, pruefeHuerden, STANDARD_GEWICHTE, STANDARD_HUERDEN,
} from './bewertung.js'
import { vergleicheMitBtc, BTC_REFERENZ, BTC_ZEITEINHEIT } from './btc-vergleich.js'

const BITUNIX = 'https://fapi.bitunix.com'

/**
 * Die Quotes, die eine Eingabe schon mitbringen kann.
 *
 * Alles andere bekommt USDT angehängt: Wer „cashcat" eintippt, meint das
 * USDT-Perpetual — jedes andere Paar ist auf diesen Börsen die Ausnahme.
 */
const QUOTES = ['USDT', 'USDC', 'USD']

/** Wie viele Kerzen Bitunix höchstens herausgibt (gemessen: 200, `limit` wird gedeckelt). */
const BITUNIX_MAX_KERZEN = 200

/**
 * Eine Eingabe in ein Handelssymbol übersetzen.
 *
 * Absichtlich grosszügig: Getippt wird „cashcat", „CASHCAT/USDT",
 * „cashcat-usdt" oder direkt „CASHCATUSDT", und alle vier meinen dasselbe.
 * Was nach dem Säubern kein Symbol mehr ist, wird gemeldet statt stillschweigend
 * zu einer leeren Anfrage zu werden.
 *
 * @returns {{symbol: string, basis: string, ergaenzt: boolean, fehler: string}}
 */
export function normalisiereEingabe(roh) {
    const gesaeubert = String(roh || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!gesaeubert) return { symbol: '', basis: '', ergaenzt: false, fehler: 'leer' }
    if (gesaeubert.length > 24) return { symbol: '', basis: '', ergaenzt: false, fehler: 'zu_lang' }

    const quote = QUOTES.find((q) => gesaeubert.endsWith(q) && gesaeubert.length > q.length)
    if (quote) {
        return { symbol: gesaeubert, basis: gesaeubert.slice(0, -quote.length), ergaenzt: false, fehler: '' }
    }
    /*
     * Eine nackte Basis wird zu <BASIS>USDT. Das ist eine Annahme, und sie
     * wird als solche zurückgemeldet (`ergaenzt`) — die Oberfläche zeigt, was
     * tatsächlich gemessen wurde, damit niemand „usdc" tippt und „USDT" liest.
     */
    return { symbol: `${gesaeubert}USDT`, basis: gesaeubert, ergaenzt: true, fehler: '' }
}

/**
 * Ähnlich geschriebene Symbole — für den Fall, dass es das gesuchte nicht gibt.
 *
 * Ein blosses „nicht gefunden" ist bei einem Tippfehler die nutzloseste aller
 * Antworten, und Tippfehler sind bei Meme-Tickern der Normalfall.
 */
export function vorschlaege(basis, symbole, max = 6) {
    const b = String(basis || '').toUpperCase()
    if (b.length < 2) return []
    const alle = [...(symbole || [])]
    const beginnt = alle.filter((s) => s.startsWith(b))
    const enthaelt = alle.filter((s) => !s.startsWith(b) && s.includes(b))
    // Kurze zuerst: `CATUSDT` ist bei Eingabe „CAT" die bessere Antwort als
    // `CATERPILLARUSDT`, auch wenn beide passen.
    const nachLaenge = (x, y) => x.length - y.length || x.localeCompare(y)
    return [...beginnt.sort(nachLaenge), ...enthaelt.sort(nachLaenge)].slice(0, max)
}

/**
 * Bitunix-Kerzen in das Hausformat bringen.
 *
 * Drei Unterschiede zu Binance, und jeder einzelne wäre ein stiller Fehler:
 *
 *   REIHENFOLGE  Bitunix liefert die NEUESTE zuerst. Ungedreht rechnete ATR
 *                rückwärts durch die Zeit — die Zahl käme heraus, sie wäre
 *                nur falsch.
 *   LAUFENDE     Die erste Kerze ist die noch offene. `getClosedCandles`
 *                schneidet sie ab; hier muss das von Hand geschehen, sonst
 *                misst RVOL eine halbe Kerze gegen zwanzig volle und meldet
 *                „Volumen eingebrochen", wo nur die Stunde jung ist.
 *   VOLUMEN      `baseVol` ist die Menge in Coins, `quoteVol` der USDT-Umsatz.
 *                Binance liefert an Position 5 die Basismenge — also baseVol,
 *                damit RVOL auf beiden Pfaden dasselbe misst.
 *
 * @param {Array} roh          Antwort von `/market/kline`
 * @param {string} zeiteinheit z. B. '1h'
 * @param {number} jetzt
 * @returns {Array<{t,o,h,l,c,v}>} aufsteigend, nur geschlossene Kerzen
 */
export function kerzenAusBitunix(roh, zeiteinheit, jetzt = Date.now()) {
    const laenge = TIMEFRAME_MS[zeiteinheit] || 0
    const kerzen = (Array.isArray(roh) ? roh : [])
        .map((k) => ({
            t: Number(k?.time),
            o: Number(k?.open),
            h: Number(k?.high),
            l: Number(k?.low),
            c: Number(k?.close),
            v: Number(k?.baseVol),
        }))
        .filter((k) => Number.isFinite(k.t) && Number.isFinite(k.o) && Number.isFinite(k.h)
            && Number.isFinite(k.l) && k.c > 0)
        .sort((a, b) => a.t - b.t)

    if (!laenge) return kerzen
    return kerzen.filter((k) => k.t + laenge <= jetzt)
}

/**
 * Wie viel Kapital an der Spitze des Buchs liegt.
 *
 * Dieselbe Grösse, die `daten.js` für Binance aus dem `bookTicker` zieht, damit
 * die Hürdenprüfung auf beiden Pfaden dasselbe vergleicht. Sie ist ausdrücklich
 * KEIN Liquiditätsmass (siehe `bewertung.js`, `minTiefeUsd`) — sie steht hier,
 * weil `pruefeHuerden` sie erwartet.
 */
export function spitzeAusBuch(buch) {
    const bid = buch?.bids?.[0]
    const ask = buch?.asks?.[0]
    if (!bid || !ask || !(bid[0] > 0) || !(ask[0] > 0)) return null
    const mitte = (bid[0] + ask[0]) / 2
    return Math.min(bid[1] || 0, ask[1] || 0) * mitte
}

/** Bitunix: Kerzen einer Zeiteinheit. */
async function bitunixKerzen(symbol, zeiteinheit, jetzt) {
    const j = await radarJson(`${BITUNIX}/api/v1/futures/market/kline`
        + `?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(zeiteinheit)}`
        + `&limit=${BITUNIX_MAX_KERZEN}`)
    return kerzenAusBitunix(j?.data, zeiteinheit, jetzt)
}

/**
 * Bitunix: Funding samt Takt.
 *
 * Der Takt steht hier tatsächlich in der Antwort (`fundingInterval`) — anders
 * als bei Bitget, wo er im Ticker fehlt und geraten werden müsste. Gemessen:
 * BTCUSDT 8 h, CASHCATUSDT 4 h. Die Rate ist in Prozent (siehe Kopf).
 */
async function bitunixFunding(symbol) {
    const j = await radarJson(`${BITUNIX}/api/v1/futures/market/funding_rate`
        + `?symbol=${encodeURIComponent(symbol)}`)
    const d = j?.data
    if (!d) return { fundingRate: null, fundingIntervallH: null, naechsteZahlung: null }
    const rate = Number(d.fundingRate)
    return {
        fundingRate: Number.isFinite(rate) ? rate : null,
        fundingIntervallH: Number(d.fundingInterval) || 8,
        naechsteZahlung: Number(d.nextFundingTime) || null,
        markPreis: Number(d.markPrice) || null,
    }
}

/**
 * Ausführungsgüte auf allen Börsen, die das Symbol führen.
 *
 * Dieselbe Auswertung wie im Lauf (`holeAusfuehrungGebremst`), nur ohne Bremse:
 * Es geht um ein Symbol, also zwei Orderbücher. Ein Symbol, das eine Börse
 * nicht kennt, ist kein Fehler — es ist die Antwort „hier nicht handelbar".
 */
async function holeAusfuehrung(symbol) {
    const jeBoerse = {}
    await Promise.all(Object.entries(BOERSEN).map(async ([name, b]) => {
        try {
            const buch = await b.holeTiefe(symbol)
            const g = ausfuehrungsGuete(buch)
            if (!g) return
            jeBoerse[name] = {
                spreadBp: g.spreadBp,
                rundlaufBp: g.rundlaufBp,
                slippageKaufBp: g.kauf[5000]?.slippageBp ?? null,
                slippageVerkaufBp: g.verkauf[5000]?.slippageBp ?? null,
                passt5k: Boolean(g.kauf[5000]?.vollstaendig && g.verkauf[5000]?.vollstaendig),
                tiefe25Bp: g.tiefe[25],
                note: noteAusfuehrung(g),
                spitzeUsd: spitzeAusBuch(buch),
            }
        } catch (e) {
            logWarn('coin-radar', `Einzelprüfung Buch ${name}/${symbol}: ${e.message}`)
        }
    }))
    return { jeBoerse, beste: besteBoerse(jeBoerse) }
}

/**
 * Ein Symbol messen.
 *
 * @param {string} eingabe  was der Nutzer getippt hat
 * @param {object} einst    Coin-Radar-Einstellungen (Zeiteinheiten, Gewichte, Hürden)
 * @param {object} [quellen] Einspeisbare Abrufe — nur für Tests
 * @returns {Promise<object>} Bericht (siehe Felder unten)
 */
export async function pruefeEinzeln(eingabe, einst = {}, quellen = {}) {
    const jetzt = quellen.jetzt || Date.now()
    const norm = normalisiereEingabe(eingabe)
    if (norm.fehler) return { gefunden: false, fehler: norm.fehler, eingabe: String(eingabe || '') }

    const symbol = norm.symbol
    const zeiteinheiten = einst.zeiteinheiten?.length ? einst.zeiteinheiten : ['1h', '15m']
    const haupt = zeiteinheiten[0]

    const [handelbar, testbar] = await Promise.all([
        (quellen.handelbar || holeHandelbar)(),
        (quellen.testbar || holeTestbar)(),
    ])
    const aufBitunix = handelbar.has(symbol)
    const beiBinance = testbar.has(symbol)

    if (!aufBitunix && !beiBinance) {
        /*
         * Nicht gefunden — und das ist der Moment, in dem eine Liste ähnlicher
         * Symbole mehr wert ist als jede Fehlermeldung. Vorgeschlagen wird aus
         * BEIDEN Börsen, sonst fehlten in der Antwort genau die 291 Paare,
         * derentwegen es diese Seite gibt.
         */
        return {
            gefunden: false,
            fehler: 'unbekannt',
            symbol,
            eingabe: String(eingabe || ''),
            vorschlaege: vorschlaege(norm.basis, new Set([...handelbar.keys(), ...testbar])),
        }
    }

    /*
     * Die Quelle: Binance, wenn möglich — dann ist das Ergebnis mit der
     * Rangliste vergleichbar. Sonst Bitunix, mit Vermerk.
     */
    const quelle = beiBinance ? 'binance' : 'bitunix'
    const bericht = {
        gefunden: true,
        symbol,
        eingabe: String(eingabe || ''),
        ergaenzt: norm.ergaenzt,
        quelle,
        vergleichbar: beiBinance,
        aufBitunix,
        beiBinance,
        haupt,
        zeiteinheiten,
        gemessenAm: jetzt,
        hinweise: [],
    }

    // ── Marktdaten ──────────────────────────────────────────────────────
    let roh = {}
    if (beiBinance) {
        const { jeSymbol } = await (quellen.marktweit || holeMarktweit)()
        roh = { ...(jeSymbol.get(symbol) || {}) }
    } else {
        const ticker = await (quellen.bitunixTicker || BOERSEN.bitunix.holeTicker)()
        const t = ticker.get(symbol) || {}
        const f = await (quellen.bitunixFunding || bitunixFunding)(symbol)
        roh = {
            symbol,
            umsatz24h: t.umsatz24h ?? null,
            preis: t.preis ?? f.markPreis ?? null,
            // Spread und Spitze hat der Bitunix-Ticker nicht; sie kommen unten
            // aus dem Orderbuch, das für die Ausführungsgüte ohnehin geholt wird.
            spreadBp: null,
            tiefeUsd: null,
            fundingRate: f.fundingRate,
            fundingIntervallH: f.fundingIntervallH,
            naechsteZahlung: f.naechsteZahlung,
        }
    }

    // ── Ausführungsgüte (und, auf dem Bitunix-Pfad, der Spread) ─────────
    const ausfuehrung = await (quellen.ausfuehrung || holeAusfuehrung)(symbol)
    if (!beiBinance) {
        const b = ausfuehrung.jeBoerse.bitunix
        if (b) {
            roh.spreadBp = b.spreadBp ?? null
            roh.tiefeUsd = b.spitzeUsd ?? null
        }
    }

    // ── Kerzen und Kennzahlen ───────────────────────────────────────────
    const kerzen = {}
    for (const ze of zeiteinheiten) {
        try {
            kerzen[ze] = beiBinance
                ? await (quellen.binanceKerzen || holeBinanceKerzen)(symbol, ze)
                : await (quellen.bitunixKerzen || bitunixKerzen)(symbol, ze, jetzt)
        } catch (e) {
            logWarn('coin-radar', `Einzelprüfung Kerzen ${symbol} ${ze}: ${e.message}`)
            kerzen[ze] = []
        }
    }
    const ze = rechneAlle(kerzen)
    bericht.jeZeiteinheit = ze

    const jahresRate = fundingJahresRate(roh.fundingRate, roh.fundingIntervallH)
    Object.assign(bericht, {
        preis: zahl(roh.preis) ?? zahl(ze[haupt]?.preis),
        umsatz24h: zahl(roh.umsatz24h),
        spreadBp: zahl(roh.spreadBp),
        tiefeUsd: zahl(roh.tiefeUsd),
        fundingRate: zahl(roh.fundingRate),
        fundingIntervallH: zahl(roh.fundingIntervallH),
        fundingJahresRate: zahl(jahresRate),
        naechsteZahlung: zahl(roh.naechsteZahlung),
        ausfuehrung,
    })

    /*
     * Die Hürden werden geprüft und mitgeteilt, aber sie brechen nichts ab —
     * das ist der Unterschied zwischen einer Liste und einer Frage. Wer
     * CASHCATUSDT eintippt, hat 2,5 Mio Tagesumsatz nicht übersehen, er will
     * wissen, wie es darunter aussieht.
     */
    const huerden = { ...STANDARD_HUERDEN, ...(einst.huerden || {}) }
    bericht.huerde = pruefeHuerden(roh, huerden)

    /*
     * Ohne Kerzen auf der Hauptzeiteinheit gibt es keine Note — und
     * ausdrücklich keine erfundene. Bei einem frisch gelisteten Coin ist das
     * der Normalfall und nicht der Ausnahmefall: CASHCATUSDT hatte am
     * 04.09.2026 auf 1h ganze 32 Kerzen, auf 4h acht.
     */
    if (!ze[haupt] || ze[haupt].atrPct === null) {
        bericht.status = 'keine_kerzen'
        bericht.kerzenAnzahl = ze[haupt]?.kerzen ?? 0
        bericht.mindestKerzen = 30
        return bericht
    }

    // ── Bewertung ───────────────────────────────────────────────────────
    const gewichte = { ...STANDARD_GEWICHTE, ...(einst.gewichte || {}) }
    const b = bewerte({ ...roh, fundingJahresRate: jahresRate }, ze, gewichte, haupt)
    bericht.status = 'bewertet'
    bericht.note = b.note
    bericht.teilnoten = b.teilnoten
    bericht.bestaetigt = b.bestaetigt
    bericht.hinweise = b.hinweise

    // ── BTC-Vergleich ───────────────────────────────────────────────────
    bericht.btc = null
    bericht.btcGrund = ''
    /*
     * Die Referenz mit sich selbst zu vergleichen ergibt r = 1, β = 1 — eine
     * Zahl, die nichts misst und wie ein Befund aussieht. In der Rangliste
     * fällt das nicht auf, weil BTC dort eine Zeile unter hunderten ist; als
     * alleiniges Ergebnis einer Einzelprüfung wäre es irreführend.
     */
    if (symbol === BTC_REFERENZ) {
        bericht.btcGrund = 'referenz'
        return bericht
    }
    try {
        const [coin4h, btc4h] = await Promise.all([
            beiBinance
                ? (quellen.binanceKerzen || holeBinanceKerzen)(symbol, BTC_ZEITEINHEIT)
                : (quellen.bitunixKerzen || bitunixKerzen)(symbol, BTC_ZEITEINHEIT, jetzt),
            (quellen.binanceKerzen || holeBinanceKerzen)(BTC_REFERENZ, BTC_ZEITEINHEIT),
        ])
        const v = vergleicheMitBtc(coin4h, btc4h)
        /*
         * Die 4h-Kerzen beider Börsen liegen auf demselben UTC-Gitter (geprüft:
         * Bitunix-Zeitstempel sind restlos durch 14 400 000 teilbar), deshalb
         * findet `paareRenditen` die gemeinsamen Punkte auch über Börsengrenzen
         * hinweg. Zu wenige davon heisst „zu jung", nicht „entkoppelt".
         */
        if (v) bericht.btc = { ...v, zeiteinheit: BTC_ZEITEINHEIT }
        else bericht.btcGrund = coin4h.length < 30 ? 'zu_jung' : 'nicht_messbar'
        bericht.btcKerzen = coin4h.length
    } catch (e) {
        logWarn('coin-radar', `Einzelprüfung BTC-Vergleich ${symbol}: ${e.message}`)
        bericht.btcGrund = 'nicht_messbar'
    }

    // ── Wo sonst noch gelistet ──────────────────────────────────────────
    try {
        const listen = await (quellen.listungen || ladeListungen)()
        if (listen) {
            const basis = symbol.replace(/USDT$|USDC$|USD$/, '').replace(/^1000+/, '')
            bericht.boersen = pruefeListung(basis, listen)
        }
    } catch (e) {
        logWarn('coin-radar', `Einzelprüfung Listungen ${symbol}: ${e.message}`)
    }

    return bericht
}

/**
 * Binance-Kerzen für ein Symbol.
 *
 * Mit Gewichtsanmeldung, obwohl es nur ein Abruf ist: `getClosedCandles` ist
 * der ungebremste Livepfad (siehe `daten.js`), und eine Einzelprüfung, die
 * jemand fünfmal hintereinander anstösst, soll der Handels-Engine nicht das
 * Kontingent wegnehmen.
 */
async function holeBinanceKerzen(symbol, zeiteinheit) {
    await warteAufGewicht(2)
    return getClosedCandles(symbol, zeiteinheit, KERZEN_ANZAHL)
}

/** `null` bleibt `null` — `Number(null)` wäre 0 und damit eine Behauptung. */
function zahl(w) {
    if (w === null || w === undefined || w === '') return null
    const n = Number(w)
    return Number.isFinite(n) ? n : null
}
