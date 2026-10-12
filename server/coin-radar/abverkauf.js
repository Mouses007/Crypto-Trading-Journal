/**
 * Abverkaufs-Wache — Abrufen, Speichern, Melden.
 *
 * Oft wird ein Coin hochgepumpt und danach abverkauft. Diese Wache sieht alle
 * paar Minuten über die Binance-Perpetuals, nimmt die stark gestiegenen, sieht
 * jeden davon genau an und meldet, sobald ein überdehnter Coin zu kippen
 * beginnt — als Anlass, einen Short zu prüfen, nicht als Auftrag dazu.
 *
 * Woher die Zahlen kommen, je Kandidat (alles öffentlich, ohne Schlüssel):
 *
 *   marktweit     24h-Anstieg, Umsatz, Funding mit Takt (`holeMarktweit`,
 *                 mit Lauf, Einzelprüfung und Wachhund geteilt)
 *   Kerzen        1h und 15m der Futures, 1h des Spotmarkts (gebremst)
 *   Open Interest `openInterestHist` 1h und 5m — in KONTRAKTEN, nicht in USD:
 *                 der USD-Wert steigt im Pump mit dem Kurs, auch wenn keine
 *                 einzige Position dazukommt
 *   Positionierung globale Konten-Quote und Top-Trader-Positionen
 *   Kaufdruck     `takerlongshortRatio` 5m
 *   Liquidationen eigene Aufzeichnung (nur, wo das Symbol aufgezeichnet wird)
 *   Listungen     die neuen Listungen des Börsen-Beobachters
 *   Börsen        ob das Perpetual auf Bitunix oder Bitget handelbar ist
 *
 * Gerechnet wird in `abverkauf-bewertung.js`; hier steht nur der Weg.
 */

import { getKnex } from '../database.js'
import { logWarn } from '../logger.js'
import { beansprucheAufgabe, meldeFehler } from '../db-claim.js'
import { holeJson } from '../marktradar-api.js'
import { getClosedCandles } from '../market-data.js'
import { warteAufGewicht } from '../binance-takt.js'
import { holeMarktweit } from './daten.js'
import { BOERSEN as AUSFUEHRUNG } from './boersen.js'
import { leseEinstellungen } from './einstellungen.js'
import { leseEinstellungen as leseHypeEinstellungen } from '../hype-radar/einstellungen.js'
import { stelleZu } from '../hype-radar/zustellung.js'
import { leseLiquidationen } from '../live-recorder.js'
import { bewerteAbverkauf, vorauswahl, waehlePartner, NACHLAUF_MS, ABVERKAUF_VORGABEN } from './abverkauf-bewertung.js'

const FAPI = 'https://fapi.binance.com'

/** Je Coin höchstens eine Kipp-Meldung in dieser Zeit. */
const MELDE_SPERRE_MS = 6 * 3600e3

/** Erfolgskontrolle: wann nachgemessen wird. */
export const ABVERKAUF_HORIZONTE = { '1h': 3600e3, '4h': 4 * 3600e3, '24h': 24 * 3600e3 }

const sicherJson = (t, r) => { try { return JSON.parse(t) ?? r } catch { return r } }
const zahl = (w) => (w !== null && w !== undefined && w !== '' && Number.isFinite(Number(w)) ? Number(w) : null)

let laeuft = false
let letzter = null

/** Der letzte Lauf dieses Prozesses — für die Anzeige. */
export function abverkaufStand() {
    return { laeuft, letzter }
}

/** Die Einstellungen der Wache, mit Vorgaben aufgefüllt. */
export async function leseAbverkaufEinst() {
    const e = await leseEinstellungen()
    return { ...ABVERKAUF_VORGABEN, an: true, intervallMin: 10, vorwarnung: false, ...(e.abverkauf || {}) }
}

/** Ein Durchgang. */
export async function abverkaufLauf() {
    if (laeuft) return { beschaeftigt: true }
    laeuft = true
    const beginn = Date.now()
    try {
        const e = await laufIntern()
        letzter = { ...e, am: beginn, dauerMs: Date.now() - beginn }
        return e
    } catch (err) {
        letzter = { fehler: String(err.message || err).slice(0, 200), am: beginn }
        throw err
    } finally {
        laeuft = false
    }
}

async function laufIntern() {
    const knex = getKnex()
    const jetzt = Date.now()
    const einst = await leseAbverkaufEinst()
    const markt = await holeMarktweit()
    if (!markt.jeSymbol.size) throw new Error('Marktdaten von Binance fehlen')

    const alt = new Map((await knex('abverkauf_stand').select('*')).map((z) => [z.symbol, z]))
    // Wer in den letzten Stunden überdehnt war, bleibt im Blick — gerade wenn sein 24h-Anstieg schrumpft.
    const nachlauf = new Set([...alt.values()]
        .filter((z) => Number(z.letzterTreffer) >= jetzt - NACHLAUF_MS).map((z) => z.symbol))
    const kandidaten = vorauswahl(markt.jeSymbol, nachlauf, einst)

    // Wo sich shorten lässt — ein Ausfall heisst „unbekannt", nicht „nirgends".
    const handelbar = {}
    await Promise.all(Object.entries(AUSFUEHRUNG).map(async ([id, b]) => {
        try { handelbar[id] = new Set((await b.holeTicker()).keys()) } catch { handelbar[id] = null }
    }))

    const ergebnisse = []
    // Drei gleichzeitig: genug, um unter einer Minute zu bleiben, wenig genug für die Grenzen der Datenendpunkte.
    for (let i = 0; i < kandidaten.length; i += 3) {
        const teil = await Promise.all(kandidaten.slice(i, i + 3).map(async (m) => {
            try {
                const d = await holeDaten(m, jetzt)
                const r = bewerteAbverkauf(d, { schwelle: einst.schwelle, jetzt })
                return { symbol: m.symbol, r, m, boersen: boersenVon(m.symbol, handelbar) }
            } catch (e) {
                logWarn('abverkauf', `${m.symbol}: ${e.message}`)
                return null
            }
        }))
        ergebnisse.push(...teil.filter(Boolean))
    }

    let gemeldet = 0
    const neuGekippt = []
    for (const e of ergebnisse) {
        const vorher = alt.get(e.symbol)
        const treffer = e.r.phase !== 'keine'
        const zeile = {
            symbol: e.symbol,
            phase: e.r.phase,
            note: e.r.note,
            anstieg24h: zahl(e.r.kennzahlen.anstieg24h),
            ergebnis: JSON.stringify({ ...e.r, boersen: e.boersen }),
            phaseSeit: vorher && vorher.phase === e.r.phase ? Number(vorher.phaseSeit) || jetzt : jetzt,
            letzterTreffer: treffer ? jetzt : (Number(vorher?.letzterTreffer) || 0),
            aktualisiertAm: jetzt,
            alarmiertAm: Number(vorher?.alarmiertAm) || 0,
        }
        const kipptNeu = e.r.phase === 'kippt' && vorher?.phase !== 'kippt'
        const ueberdehntNeu = einst.vorwarnung && e.r.phase === 'ueberdehnt' && (!vorher || vorher.phase === 'keine')
        if ((kipptNeu || ueberdehntNeu)
            && await beansprucheAufgabe(`abverkauf|${kipptNeu ? 'kippt' : 'ueber'}|${e.symbol}`, MELDE_SPERRE_MS)) {
            await melde(knex, e, kipptNeu)
            zeile.alarmiertAm = jetzt
            gemeldet++
            if (kipptNeu) neuGekippt.push(e)
        }
        await knex('abverkauf_stand').insert(zeile).onConflict('symbol').merge()
    }
    // Wer weder angesehen wurde noch im Nachlauf steht, fällt heraus.
    const angesehen = new Set(ergebnisse.map((e) => e.symbol))
    const weg = [...alt.keys()].filter((s) => !angesehen.has(s) && !nachlauf.has(s))
    if (weg.length) await knex('abverkauf_stand').whereIn('symbol', weg).del().catch(() => {})

    if (neuGekippt.length) await legeErfolgskontrolleAn(knex, neuGekippt, ergebnisse, jetzt).catch((e) => logWarn('abverkauf', `Erfolgskontrolle: ${e.message}`))

    return {
        angesehen: ergebnisse.length,
        kippt: ergebnisse.filter((e) => e.r.phase === 'kippt').length,
        ueberdehnt: ergebnisse.filter((e) => e.r.phase === 'ueberdehnt').length,
        gemeldet,
    }
}

function boersenVon(symbol, handelbar) {
    const raus = {}
    for (const [id, set] of Object.entries(handelbar)) raus[id] = set ? set.has(symbol) : null
    return raus
}

/** Alle Zahlen eines Kandidaten. Jede Quelle fällt einzeln aus — fehlend heisst unbekannt. */
async function holeDaten(m, jetzt) {
    const sym = m.symbol
    const json = (pfad) => holeJson(`${FAPI}${pfad}`).catch(() => null)
    await warteAufGewicht(6)
    const [k1h, k15m, spot, oi1, oi5, konten, top, taker] = await Promise.all([
        getClosedCandles(sym, '1h', 200).catch(() => []),
        getClosedCandles(sym, '15m', 200).catch(() => []),
        /*
         * Kein Spotmarkt (HTTP 400) ist eine Aussage — der Anstieg ist reiner
         * Hebel —, eine Störung ist keine. Beides als „kein Spot" zu lesen hiesse,
         * bei jedem Netzaussetzer Treibstoff zu erfinden.
         */
        getClosedCandles(sym, '1h', 200, { market: 'spot' })
            .then((k) => (Array.isArray(k) ? k : null))
            .catch((e) => (e?.response?.status === 400 || e?.status === 400 ? [] : null)),
        json(`/futures/data/openInterestHist?symbol=${sym}&period=1h&limit=48`),
        json(`/futures/data/openInterestHist?symbol=${sym}&period=5m&limit=36`),
        json(`/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=1h&limit=2`),
        json(`/futures/data/topLongShortPositionRatio?symbol=${sym}&period=1h&limit=2`),
        json(`/futures/data/takerlongshortRatio?symbol=${sym}&period=5m&limit=36`),
    ])
    const reihe = (a, feld) => (Array.isArray(a) ? a.map((x) => ({ t: Number(x.timestamp), wert: zahl(x[feld]) })) : [])
    return {
        preisAenderung24h: m.preisAenderung24h,
        fundingRate: m.fundingRate,
        fundingIntervallH: m.fundingIntervallH,
        k1h, k15m,
        spot1h: spot,
        oi1h: reihe(oi1, 'sumOpenInterest'),
        oi5m: reihe(oi5, 'sumOpenInterest'),
        lsKonten: Array.isArray(konten) ? konten.map((x) => ({ t: Number(x.timestamp), longPct: zahl(x.longAccount) !== null ? Number(x.longAccount) * 100 : null })) : [],
        lsTop: Array.isArray(top) ? top.map((x) => ({ t: Number(x.timestamp), ratio: zahl(x.longShortRatio) })) : [],
        taker5m: Array.isArray(taker) ? taker.map((x) => ({ t: Number(x.timestamp), ratio: zahl(x.buySellRatio) })) : [],
        liq: await liquidationen(sym, jetzt),
        listung: await listung(sym, jetzt),
    }
}

/**
 * Liquidationen der letzten halben Stunde aus der eigenen Aufzeichnung —
 * nur, wenn das Symbol in den letzten zwei Stunden überhaupt aufgezeichnet
 * wurde. Sonst wären „keine Liquidationen" und „nicht hingesehen" dasselbe.
 */
async function liquidationen(symbol, jetzt) {
    try {
        const zeile = await getKnex()('live_recordings').where({ symbol, market: 'futures' })
            .whereIn('kind', ['liq', 'liqB']).andWhere('hourStart', '>=', jetzt - 2 * 3600e3).first('id')
        if (!zeile) return { erfasst: false }
        const von = jetzt - 30 * 60e3
        const ereignisse = [
            ...await leseLiquidationen(symbol, von, jetzt).catch(() => []),
            ...await leseLiquidationen(symbol, von, jetzt, { venue: 'bybit' }).catch(() => []),
        ]
        let longUsd = 0
        let shortUsd = 0
        // Seitenkonvention des Hauses: isBuy = 1 heisst „Short liquidiert".
        for (const e of ereignisse) { if (e.isBuy) shortUsd += e.price * e.qty; else longUsd += e.price * e.qty }
        return { erfasst: true, longUsd, shortUsd }
    } catch {
        return { erfasst: false }
    }
}

/** Die jüngste neue Listung dieses Kürzels in den letzten sieben Tagen. */
async function listung(symbol, jetzt) {
    const kuerzel = symbol.replace(/USDT$/, '').replace(/^(1000000|10000|1000|1M)(?=[A-Z])/, '')
    try {
        const z = await getKnex()('hype_listungen_neu').where({ symbol: kuerzel })
            .andWhere('gesehenAm', '>=', jetzt - 7 * 86400e3).orderBy('gesehenAm', 'desc').first('boerse', 'gesehenAm')
        return z ? { boerse: z.boerse, gesehenAm: Number(z.gesehenAm) } : null
    } catch {
        return null
    }
}

/** Meldung über die Alarm-Liste und die Kanäle des Hype-Radars. */
async function melde(knex, e, kippt) {
    const k = e.r.kennzahlen
    const gruende = (kippt ? e.r.kippen : e.r.treibstoff).slice(0, 3).map((x) => x.text).join('; ')
    const ort = Object.entries(e.boersen).filter(([, ja]) => ja).map(([id]) => (id === 'bitunix' ? 'Bitunix' : 'Bitget'))
    const alarm = {
        regel: 'abverkauf',
        schwere: kippt ? 'warnung' : 'info',
        meldung: `${e.symbol.replace(/USDT$/, '')}: ${kippt ? 'Abverkauf beginnt' : 'überdehnt'}`
            + ` — ${k.anstieg24h !== null ? `${k.anstieg24h > 0 ? '+' : ''}${k.anstieg24h} % in 24 h, ` : ''}${gruende}`
            + (e.r.gegen.length ? ` · dagegen: ${e.r.gegen.map((g) => g.text).join('; ')}` : '')
            + (e.r.ungueltigUeber ? ` · hinfällig über ${e.r.ungueltigUeber}` : '')
            + (ort.length ? ` · auf ${ort.join(', ')}` : ' · nicht auf Bitunix/Bitget'),
        daten: { symbol: e.symbol, quelle: 'abverkauf', phase: e.r.phase, preis: k.preis, hoch: e.r.ungueltigUeber },
    }
    try {
        await knex('hype_alarme').insert({
            favoritId: 0, regel: alarm.regel, schwere: alarm.schwere, meldung: alarm.meldung.slice(0, 900),
            daten: JSON.stringify(alarm.daten), erstelltAm: Date.now(),
        })
    } catch (err) {
        logWarn('abverkauf', `Alarm speichern: ${err.message}`)
    }
    await stelleZu(alarm, { symbol: e.symbol.replace(/USDT$/, ''), chain: 'binance' }, await leseHypeEinstellungen())
        .catch((err) => logWarn('abverkauf', `Zustellung: ${err.message}`))
}

/**
 * Erfolgskontrolle: jede gemeldete Kipp-Warnung und ein Vergleichscoin aus
 * demselben Lauf, der nicht gekippt ist. Gemessen wie beim Coin-Radar
 * (`radar-ergebnisse.js`), nach einer, vier und 24 Stunden.
 */
async function legeErfolgskontrolleAn(knex, gekippt, alle, jetzt) {
    const uebrige = alle.filter((e) => e.r.phase !== 'kippt')
    const mitAnstieg = (e) => ({ ...e, anstieg24h: Number(e.r.kennzahlen.anstieg24h) || 0 })
    const paare = waehlePartner(gekippt.map(mitAnstieg), uebrige.map(mitAnstieg))
    // Sekunden statt ms: `laufId` ist eine Ganzzahl-Spalte.
    const laufId = Math.floor(jetzt / 1000)
    const auftraege = []
    const lege = (e, gruppe, rang) => {
        for (const [horizont, ms] of Object.entries(ABVERKAUF_HORIZONTE)) {
            auftraege.push({
                art: 'abverkauf', laufId, symbol: e.symbol, rang, note: e.r.note, gruppe, horizont,
                erstelltAm: jetzt, faelligAm: jetzt + ms, status: 'offen',
            })
        }
    }
    gekippt.forEach((e, i) => {
        lege(e, 'spitze', i + 1)
        const p = paare.find(([t]) => t.symbol === e.symbol)
        if (p) lege(p[1], 'kontrolle', i + 1)
    })
    for (let i = 0; i < auftraege.length; i += 25) {
        await knex('radar_ergebnisse').insert(auftraege.slice(i, i + 25)).onConflict(['art', 'laufId', 'symbol', 'horizont']).ignore()
    }
}

/** Für die Seite: alle angesehenen Coins, nach Dringlichkeit, dazu die Erfolgskontrolle. */
export async function abverkaufUebersicht() {
    const knex = getKnex()
    const zeilen = await knex('abverkauf_stand').select('*').catch(() => [])
    const rang = { kippt: 0, ueberdehnt: 1, keine: 2 }
    const coins = zeilen.map((z) => ({
        symbol: z.symbol, phase: z.phase, note: Number(z.note) || 0, phaseSeit: Number(z.phaseSeit) || 0,
        aktualisiertAm: Number(z.aktualisiertAm) || 0, alarmiertAm: Number(z.alarmiertAm) || 0,
        ...sicherJson(z.ergebnis, {}),
    })).sort((a, b) => (rang[a.phase] - rang[b.phase]) || (b.note - a.note))
    const kontrolle = await knex('radar_ergebnisse').where({ art: 'abverkauf' })
        .select('gruppe', 'horizont', 'renditePct', 'mfePct', 'status', 'symbol', 'erstelltAm')
        .orderBy('erstelltAm', 'desc').limit(3000).catch(() => [])
    const { abverkaufGuete } = await import('./abverkauf-bewertung.js')
    return {
        stand: abverkaufStand(),
        einst: await leseAbverkaufEinst(),
        coins,
        guete: abverkaufGuete(kontrolle),
        offen: kontrolle.filter((z) => z.status === 'offen').length,
    }
}

/**
 * Der Takt: alle fünf Minuten nachsehen, ob ein Durchgang fällig ist. Der
 * Anspruch in der Datenbank hält das Intervall über alle Prozesse (NAS und
 * Testcontainer teilen eine Datenbank).
 */
export function startAbverkaufTakt() {
    const uhr = setInterval(async () => {
        try {
            const einst = await leseAbverkaufEinst()
            if (!einst.an) return
            const minuten = Math.max(5, Number(einst.intervallMin) || 10)
            if (!(await beansprucheAufgabe('coinradar_abverkauf', minuten * 60e3 - 30e3))) return
            const e = await abverkaufLauf()
            if (e?.gemeldet) console.log(` -> Abverkaufs-Wache: ${e.kippt} kippt, ${e.gemeldet} gemeldet`)
        } catch (e) {
            logWarn('abverkauf', `Takt: ${e.message}`)
            await meldeFehler('coinradar_abverkauf', e.message).catch(() => {})
        }
    }, 5 * 60e3)
    uhr.unref?.()
    return () => clearInterval(uhr)
}
