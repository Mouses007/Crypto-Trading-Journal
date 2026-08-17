/**
 * Handelszeiten, Sitzungsphasen und Volatilitätsfenster.
 *
 * Beantwortet die Frage, die im Live-Trading-Fenster über allem steht: *ist
 * jetzt eine gute Zeit zum Handeln, und was kommt als nächstes?* Krypto läuft
 * durch, aber der Takt kommt von den Aktienmärkten — die US-Kassaeröffnung um
 * 9:30 New Yorker Zeit reisst Spreads auf und dreht Kurse, und wer da mitten
 * drin einsteigt, handelt gegen Maschinen.
 *
 * **Reines Modul**: kein Netz, keine Datenbank, kein Vue. Kalendertermine und
 * Feiertage werden von aussen hineingereicht, damit dieselbe Rechnung im
 * Browser (Sekunden-Countdown) und im Server (Benachrichtigung, KI-Prompt)
 * läuft. Selbsttest: `shared/__selftest-handelszeiten.mjs`.
 *
 * ## Warum jede Sitzung ihre eigene Zone trägt
 *
 * Der naheliegende Weg wäre, alles in New Yorker Ortszeit auszudrücken und
 * London und Tokio mit festen Versätzen daranzuhängen. Das ist zwei- bis
 * dreimal im Jahr falsch: die USA stellen am zweiten Sonntag im März um, die
 * EU erst am letzten: dazwischen sind es vier statt fünf Stunden Differenz.
 * Ende Oktober läuft es umgekehrt. Deshalb steht bei jeder Sitzung die Zone
 * dabei, und die Wanduhrzeit wird in genau dieser Zone in einen Zeitpunkt
 * übersetzt.
 */

import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'

// Mehrfaches `extend` ist unschädlich — dayjs prüft selbst, ob ein Plugin
// schon hängt. Das Modul muss eigenständig funktionieren, weil es auch der
// Server lädt, der `src/utils/dayjs-setup.js` nicht kennt.
dayjs.extend(utc)
dayjs.extend(timezone)

export const ZONE_US = 'America/New_York'

const MINUTE = 60 * 1000

/**
 * Handelssitzungen, je in ihrer eigenen Zone als Wanduhrzeit.
 *
 * `rang` entscheidet, welche Sitzung die Kachel als *die* aktuelle Phase
 * anschreibt, wenn mehrere gleichzeitig laufen — die US-Kassa dominiert alles,
 * weil dort das Volumen liegt.
 *
 * `tage` sind Wochentage in der Zone der Sitzung (0 = Sonntag), Vorgabe Mo–Fr.
 */
export const SITZUNGEN = [
    { id: 'asien', zone: 'Asia/Tokyo', von: '09:00', bis: '15:00', rang: 1 },
    { id: 'london', zone: 'Europe/London', von: '08:00', bis: '16:30', rang: 2 },
    { id: 'usVorboerse', zone: ZONE_US, von: '04:00', bis: '09:30', rang: 3 },
    { id: 'usNachboerse', zone: ZONE_US, von: '16:00', bis: '20:00', rang: 3 },
    { id: 'usKassa', zone: ZONE_US, von: '09:30', bis: '16:00', rang: 5 },
]

/**
 * Zeitpunkte, an denen erfahrungsgemäss etwas passiert. Alle in New York,
 * weil sie alle am US-Kalender hängen.
 *
 * `spanne: true` heisst: `bis` gehört dazu (die CME-Pause ist ein Fenster,
 * kein Zeitpunkt).
 */
export const MARKEN = [
    { id: 'makro830', zone: ZONE_US, zeit: '08:30' },
    { id: 'kassaAuf', zone: ZONE_US, zeit: '09:30' },
    { id: 'fomc1400', zone: ZONE_US, zeit: '14:00' },
    { id: 'kassaZu', zone: ZONE_US, zeit: '16:00' },
    { id: 'cmePause', zone: ZONE_US, zeit: '17:00', bis: '18:00', spanne: true, tage: [1, 2, 3, 4] },
]

/**
 * Fenster, in denen nicht gehandelt werden sollte.
 *
 * `nurWennEreignis` heisst: das Fenster gilt nur, wenn der Wirtschaftskalender
 * für diesen Zeitpunkt tatsächlich einen wichtigen US-Termin führt. Ohne diese
 * Bedingung stünde jeden Werktag um 8:30 eine Warnung, auch wenn gar nichts
 * veröffentlicht wird — und eine Warnung, die immer leuchtet, liest niemand.
 */
export const WARNFENSTER = [
    { id: 'eroeffnung', marke: 'kassaAuf', vorMin: 5, nachMin: 15, stufe: 'hoch' },
    { id: 'makro', marke: 'makro830', vorMin: 2, nachMin: 10, stufe: 'hoch', nurWennEreignis: true },
    { id: 'fomc', marke: 'fomc1400', vorMin: 2, nachMin: 20, stufe: 'hoch', nurWennEreignis: true },
    { id: 'schluss', marke: 'kassaZu', vorMin: 15, nachMin: 5, stufe: 'mittel' },
    { id: 'cme', marke: 'cmePause', vorMin: 0, nachMin: 0, stufe: 'mittel' },
]

/**
 * Marken, die ohne passenden Kalendertermin gar nicht erst angezeigt werden —
 * abgeleitet aus den Warnfenstern mit `nurWennEreignis`. Die Warnungen waren
 * schon still, aber die Countdown-Liste zeigte trotzdem jeden Tag
 * „FOMC-Fenster (14:00 ET)", auch wenn weit und breit keine Sitzung ist.
 * Eine Marke, die immer da steht, sagt genauso wenig wie eine Warnung, die
 * immer leuchtet.
 */
const MARKEN_NUR_MIT_EREIGNIS = new Set(
    WARNFENSTER.filter((w) => w.nurWennEreignis).map((w) => w.marke)
)

/** Wie weit um eine Marke herum ein Kalendertermin noch als „dieser Termin" gilt. */
const EREIGNIS_TOLERANZ_MS = 20 * MINUTE

/** Wirkungsgrade, die als „wichtig" zählen (ForexFactory-Schreibweise). */
const WICHTIG = new Set(['high', 'holiday'])

/**
 * Wanduhrzeit in einer Zone → Zeitpunkt in ms.
 * @param {string} datum 'YYYY-MM-DD' in der Zielzone
 * @param {string} hhmm  'HH:mm'
 */
function zeitpunkt(datum, hhmm, zone) {
    return dayjs.tz(`${datum} ${hhmm}`, zone).valueOf()
}

/** Kalendertage um `jetzt` herum, in der Zone gelesen — Vortag, heute, Folgetag. */
function tageUm(jetztMs, zone) {
    const heute = dayjs(jetztMs).tz(zone)
    return [-1, 0, 1].map(v => heute.add(v, 'day').format('YYYY-MM-DD'))
}

/** Wochentag eines Kalendertags in seiner Zone (0 = Sonntag). */
function wochentag(datum, zone) {
    return dayjs.tz(`${datum} 12:00`, zone).day()
}

/**
 * Alle Vorkommen einer Sitzung rund um `jetzt`.
 * Sitzungen, die über Mitternacht laufen, enden am Folgetag.
 */
function vorkommenSitzung(sitzung, jetztMs) {
    const tage = sitzung.tage || [1, 2, 3, 4, 5]
    const raus = []
    for (const datum of tageUm(jetztMs, sitzung.zone)) {
        if (!tage.includes(wochentag(datum, sitzung.zone))) continue
        const von = zeitpunkt(datum, sitzung.von, sitzung.zone)
        let bis = zeitpunkt(datum, sitzung.bis, sitzung.zone)
        if (bis <= von) bis = dayjs(bis).add(1, 'day').valueOf()
        raus.push({ id: sitzung.id, rang: sitzung.rang, von, bis })
    }
    return raus
}

/** Alle Vorkommen einer Marke rund um `jetzt`. */
function vorkommenMarke(marke, jetztMs) {
    const tage = marke.tage || [1, 2, 3, 4, 5]
    const raus = []
    for (const datum of tageUm(jetztMs, marke.zone)) {
        if (!tage.includes(wochentag(datum, marke.zone))) continue
        const t = zeitpunkt(datum, marke.zeit, marke.zone)
        const bis = marke.spanne ? zeitpunkt(datum, marke.bis, marke.zone) : t
        raus.push({ id: marke.id, t, bis, spanne: !!marke.spanne })
    }
    return raus
}

/**
 * Läuft der Terminmarkt (CME-Aktienindex-Futures)?
 *
 * Sonntag 18:00 ET bis Freitag 17:00 ET, mit täglicher Wartungspause von
 * 17:00 bis 18:00. Das ist der Grund, warum ES und NQ nachts europäischer Zeit
 * eine Stunde still stehen und die Bücher davor und danach dünn sind.
 */
export function terminmarktOffen(jetztMs) {
    const ny = dayjs(jetztMs).tz(ZONE_US)
    const tag = ny.day()
    const minuten = ny.hour() * 60 + ny.minute()
    const siebzehn = 17 * 60
    const achtzehn = 18 * 60

    if (tag === 6) return false                                   // Samstag
    if (tag === 0) return minuten >= achtzehn                      // Sonntag: erst ab 18:00
    if (tag === 5) return minuten < siebzehn                       // Freitag: bis 17:00
    return minuten < siebzehn || minuten >= achtzehn               // Mo–Do: Pause 17–18
}

/** Fällt `jetzt` auf einen Feiertag aus der übergebenen Liste? */
function istFeiertag(jetztMs, feiertage) {
    if (!feiertage?.length) return false
    const heute = dayjs(jetztMs).tz(ZONE_US).format('YYYY-MM-DD')
    return feiertage.some(f => {
        const ms = Number(f?.dateUnix ?? f)
        if (!Number.isFinite(ms)) return false
        return dayjs(ms).tz(ZONE_US).format('YYYY-MM-DD') === heute
    })
}

/**
 * Führt der Kalender rund um `tMs` einen wichtigen Termin?
 *
 * Absichtlich grosszügig (±20 min): ForexFactory und der Fed-Kalender legen
 * dieselbe Veröffentlichung gern ein paar Minuten versetzt ab, und ein
 * Warnfenster, das wegen fünf Minuten Versatz ausbleibt, ist schlimmer als
 * eines, das fünf Minuten zu früh kommt.
 */
function ereignisNahe(tMs, ereignisse) {
    if (!ereignisse?.length) return null
    for (const e of ereignisse) {
        const ms = Number(e?.dateUnix)
        if (!Number.isFinite(ms)) continue
        if (Math.abs(ms - tMs) > EREIGNIS_TOLERANZ_MS) continue
        if (!WICHTIG.has(String(e.impact || '').toLowerCase())) continue
        return e
    }
    return null
}

/**
 * Vollständige Lage zu einem Zeitpunkt.
 *
 * @param {number} jetztMs
 * @param {object} [opt]
 * @param {Array}  [opt.ereignisse] Kalendertermine `[{dateUnix, impact, titel, land}]`
 * @param {Array}  [opt.feiertage]  Feiertage `[{dateUnix}]` (oder blanke ms-Zahlen)
 * @returns {{
 *   jetzt:number,
 *   phase:({id:string,von:number,bis:number}|null),
 *   aktive:string[],
 *   ueberlappung:boolean,
 *   phasenHeute:Array<{id:string,von:number,bis:number,aktiv:boolean}>,
 *   naechste:Array<{id:string,art:string,tMs:number,inMs:number}>,
 *   warnungen:Array<{id:string,stufe:string,vonMs:number,bisMs:number,marke:string,ereignis:object|null}>,
 *   terminmarktOffen:boolean,
 *   feiertag:boolean,
 *   feiertagUnbekannt:boolean,
 *   handelbar:boolean
 * }}
 */
export function lageZu(jetztMs, opt = {}) {
    const { ereignisse = null, feiertage = null } = opt
    const feiertag = istFeiertag(jetztMs, feiertage)

    // ── Sitzungen ────────────────────────────────────────────────────────
    const alleSitzungen = []
    for (const s of SITZUNGEN) alleSitzungen.push(...vorkommenSitzung(s, jetztMs))

    // An einem US-Feiertag finden die US-Sitzungen nicht statt. Asien und
    // London laufen weiter — deren Feiertage kennen wir hier nicht und
    // behaupten deshalb auch nichts.
    const sitzungen = alleSitzungen.filter(s =>
        !(feiertag && s.id.startsWith('us')))

    const laufend = sitzungen
        .filter(s => jetztMs >= s.von && jetztMs < s.bis)
        .sort((a, b) => b.rang - a.rang)

    const phase = laufend.length
        ? { id: laufend[0].id, von: laufend[0].von, bis: laufend[0].bis }
        : null
    const aktive = laufend.map(s => s.id)
    const ueberlappung = aktive.includes('london') && aktive.includes('usKassa')

    // Band für die Anzeige: die Vorkommen des laufenden bzw. kommenden Tages
    const phasenHeute = sitzungen
        .filter(s => s.bis > jetztMs - 12 * 60 * MINUTE && s.von < jetztMs + 24 * 60 * MINUTE)
        .sort((a, b) => a.von - b.von)
        .map(s => ({ id: s.id, von: s.von, bis: s.bis, aktiv: jetztMs >= s.von && jetztMs < s.bis }))

    // ── Marken ───────────────────────────────────────────────────────────
    const marken = []
    for (const m of MARKEN) marken.push(...vorkommenMarke(m, jetztMs))
    const markenAktiv = feiertag
        ? marken.filter(m => m.id === 'cmePause')
        : marken

    const naechste = []
    for (const s of sitzungen) {
        if (s.von > jetztMs) naechste.push({ id: s.id, art: 'sitzung', tMs: s.von, inMs: s.von - jetztMs })
    }
    for (const m of markenAktiv) {
        if (m.t <= jetztMs) continue
        // FOMC-/Makro-Marke nur mit tatsächlichem Kalendertermin anzeigen —
        // ohne übergebene Termine bleibt sie stumm (gleiche Linie wie bei den
        // Warnfenstern: lieber nichts behaupten als täglich falsch warnen).
        if (MARKEN_NUR_MIT_EREIGNIS.has(m.id) && !ereignisNahe(m.t, ereignisse)) continue
        naechste.push({ id: m.id, art: 'marke', tMs: m.t, inMs: m.t - jetztMs })
    }
    naechste.sort((a, b) => a.tMs - b.tMs)

    // ── Warnfenster ──────────────────────────────────────────────────────
    const warnungen = []
    for (const w of WARNFENSTER) {
        for (const m of markenAktiv) {
            if (m.id !== w.marke) continue
            const vonMs = m.t - (w.vorMin || 0) * MINUTE
            const bisMs = (m.spanne ? m.bis : m.t) + (w.nachMin || 0) * MINUTE
            if (jetztMs < vonMs || jetztMs >= bisMs) continue

            const ereignis = ereignisNahe(m.t, ereignisse)
            if (w.nurWennEreignis && !ereignis) continue

            warnungen.push({ id: w.id, stufe: w.stufe, vonMs, bisMs, marke: m.id, ereignis })
        }
    }
    warnungen.sort((a, b) => a.vonMs - b.vonMs)

    return {
        jetzt: jetztMs,
        phase,
        aktive,
        ueberlappung,
        phasenHeute,
        naechste: naechste.slice(0, 4),
        warnungen,
        terminmarktOffen: terminmarktOffen(jetztMs),
        feiertag,
        // Ohne übergebene Liste können wir einen Feiertag nicht ausschliessen.
        // Das anzuschreiben ist ehrlicher, als „offen" zu behaupten.
        feiertagUnbekannt: !feiertage,
        handelbar: !warnungen.some(w => w.stufe === 'hoch'),
    }
}
