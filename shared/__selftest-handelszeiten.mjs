/**
 * Selbsttest der Handelszeiten.
 *
 *   node shared/__selftest-handelszeiten.mjs
 *
 * Der Kern dieses Moduls ist nicht „09:30 plus fünf Minuten", sondern die
 * Zeitzonenrechnung. Die USA stellen im Frühjahr am zweiten Sonntag im März
 * um, die EU erst am letzten; im Herbst geht die EU am letzten Sonntag im
 * Oktober zurück, die USA erst am ersten Sonntag im November. In diesen beiden
 * Lücken stimmen alle festen Umrechnungen nicht mehr — und genau dort steht
 * hier die Hälfte der Prüfungen.
 *
 * 2026 sind die Umstellungen: US 08.03. und 01.11., EU 29.03. und 25.10.
 */

import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { lageZu, terminmarktOffen, ZONE_US } from './handelszeiten.js'

dayjs.extend(utc)
dayjs.extend(timezone)

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Wanduhrzeit in einer Zone → ms. */
const ms = (datumZeit, zone = ZONE_US) => dayjs.tz(datumZeit, zone).valueOf()
/** ms → Wanduhrzeit in einer Zone, zum Anschreiben in den Prüfungen. */
const in_ = (t, zone) => dayjs(t).tz(zone).format('HH:mm')

const warnIds = (l) => l.warnungen.map(w => w.id).sort()

console.log('\nHandelszeiten — Selbsttest\n')

// ── Sitzungsphasen an ihren Rändern ──────────────────────────────────────
console.log('Phasen (Montag 17.08.2026)')
{
    check('09:29 ET ist noch Vorbörse',
        lageZu(ms('2026-08-17 09:29')).phase?.id === 'usVorboerse',
        lageZu(ms('2026-08-17 09:29')).phase?.id)

    check('09:30 ET ist Kassa',
        lageZu(ms('2026-08-17 09:30')).phase?.id === 'usKassa')

    check('15:59 ET ist noch Kassa',
        lageZu(ms('2026-08-17 15:59')).phase?.id === 'usKassa')

    check('16:00 ET ist Nachbörse',
        lageZu(ms('2026-08-17 16:00')).phase?.id === 'usNachboerse',
        lageZu(ms('2026-08-17 16:00')).phase?.id)

    const l = lageZu(ms('2026-08-17 10:00'))
    check('Kassa überstimmt London als angeschriebene Phase',
        l.phase?.id === 'usKassa' && l.aktive.includes('london'))
    check('… und die Überlappung ist markiert', l.ueberlappung === true)

    check('03:00 ET ist London (dort ist es 08:00)',
        lageZu(ms('2026-08-17 03:00')).phase?.id === 'london',
        lageZu(ms('2026-08-17 03:00')).phase?.id)

    // Echte Lücke: Tokio schliesst um 02:00 ET, London öffnet um 03:00 ET.
    check('02:30 ET liegt in keiner Sitzung',
        lageZu(ms('2026-08-17 02:30')).phase === null,
        lageZu(ms('2026-08-17 02:30')).phase?.id)
}

// ── Die eigentliche Prüfung: Sommerzeit-Lücken ───────────────────────────
console.log('\nSommerzeit — die beiden Lücken')
{
    // Ausserhalb der Lücken: 09:30 New York ist 15:30 in Zürich.
    for (const tag of ['2026-02-16', '2026-08-17', '2026-11-10']) {
        const t = ms(`${tag} 09:30`)
        check(`${tag}: 09:30 ET = 15:30 Zürich`,
            in_(t, 'Europe/Zurich') === '15:30', in_(t, 'Europe/Zurich'))
    }

    // In den Lücken sind es nur fünf Stunden Differenz statt sechs. Die USA
    // stellen im Frühjahr früher um und im Herbst später zurück — US-Zeiten
    // rutschen im europäischen Kalender also nach VORN, nicht nach hinten.
    for (const tag of ['2026-03-16', '2026-10-27']) {
        const t = ms(`${tag} 09:30`)
        check(`${tag} (Lücke): 09:30 ET = 14:30 Zürich`,
            in_(t, 'Europe/Zurich') === '14:30', in_(t, 'Europe/Zurich'))
    }

    // Gegenprobe aus Sicht der Sitzungen: London öffnet um 08:00 Ortszeit.
    // Das ist normalerweise 03:00 in New York, in den Lücken 04:00.
    const londonAuf = (tag) => {
        const l = lageZu(ms(`${tag} 12:00`, 'Europe/London'))
        const eintrag = l.phasenHeute.find(p => p.id === 'london')
        return in_(eintrag.von, ZONE_US)
    }
    check('2026-02-16: London öffnet um 03:00 ET', londonAuf('2026-02-16') === '03:00', londonAuf('2026-02-16'))
    check('2026-03-16 (Lücke): London öffnet um 04:00 ET', londonAuf('2026-03-16') === '04:00', londonAuf('2026-03-16'))
    check('2026-08-17: London öffnet um 03:00 ET', londonAuf('2026-08-17') === '03:00', londonAuf('2026-08-17'))
    check('2026-10-27 (Lücke): London öffnet um 04:00 ET', londonAuf('2026-10-27') === '04:00', londonAuf('2026-10-27'))
    check('2026-11-10: London öffnet um 03:00 ET', londonAuf('2026-11-10') === '03:00', londonAuf('2026-11-10'))

    // Und die Eröffnungswarnung muss an beiden Tagen zur gleichen ORTSZEIT
    // greifen — das ist der Punkt, an dem eine feste MEZ-Uhrzeit versagt.
    check('Eröffnungswarnung greift auch in der Lücke um 09:28 ET',
        warnIds(lageZu(ms('2026-03-16 09:28'))).includes('eroeffnung'))
}

// ── Warnfenster an ihren Rändern ─────────────────────────────────────────
console.log('\nWarnfenster')
{
    check('09:24 ET: noch keine Eröffnungswarnung',
        !warnIds(lageZu(ms('2026-08-17 09:24'))).includes('eroeffnung'))
    check('09:25 ET: Warnung beginnt',
        warnIds(lageZu(ms('2026-08-17 09:25'))).includes('eroeffnung'))
    check('09:44 ET: Warnung läuft noch',
        warnIds(lageZu(ms('2026-08-17 09:44'))).includes('eroeffnung'))
    check('09:45 ET: Warnung vorbei',
        !warnIds(lageZu(ms('2026-08-17 09:45'))).includes('eroeffnung'))

    check('Eröffnungswarnung ist Stufe hoch → nicht handelbar',
        lageZu(ms('2026-08-17 09:30')).handelbar === false)
    check('10:30 ET ist handelbar',
        lageZu(ms('2026-08-17 10:30')).handelbar === true)

    check('15:45 ET: Schlusswarnung (Stufe mittel) läuft',
        warnIds(lageZu(ms('2026-08-17 15:45'))).includes('schluss'))
    check('… und mittel macht den Markt nicht unhandelbar',
        lageZu(ms('2026-08-17 15:45')).handelbar === true)
}

// ── Kalendergebundene Warnfenster ────────────────────────────────────────
console.log('\nWarnfenster nur bei echtem Termin')
{
    const ohne = lageZu(ms('2026-08-17 08:31'))
    check('08:31 ET ohne Kalendertermin: keine Makro-Warnung',
        !warnIds(ohne).includes('makro'))

    const mit = lageZu(ms('2026-08-17 08:31'), {
        ereignisse: [{ dateUnix: ms('2026-08-17 08:30'), impact: 'high', titel: 'CPI', land: 'USD' }],
    })
    check('08:31 ET mit High-Impact-Termin: Makro-Warnung da',
        warnIds(mit).includes('makro'))
    check('… und der Termin hängt an der Warnung',
        mit.warnungen.find(w => w.id === 'makro')?.ereignis?.titel === 'CPI')

    const klein = lageZu(ms('2026-08-17 08:31'), {
        ereignisse: [{ dateUnix: ms('2026-08-17 08:30'), impact: 'low', titel: 'Irgendwas' }],
    })
    check('Low-Impact löst keine Warnung aus', !warnIds(klein).includes('makro'))

    const fern = lageZu(ms('2026-08-17 08:31'), {
        ereignisse: [{ dateUnix: ms('2026-08-17 11:00'), impact: 'high', titel: 'Zu spät' }],
    })
    check('Termin ausserhalb der Toleranz zählt nicht', !warnIds(fern).includes('makro'))

    const fomc = lageZu(ms('2026-08-17 14:05'), {
        ereignisse: [{ dateUnix: ms('2026-08-17 14:00'), impact: 'high', titel: 'FOMC' }],
    })
    check('14:05 ET mit FOMC-Termin: Warnung da', warnIds(fomc).includes('fomc'))
}

// ── Terminmarkt: Wochenende und tägliche Pause ───────────────────────────
console.log('\nTerminmarkt (CME)')
{
    check('Mo 16:59 ET offen', terminmarktOffen(ms('2026-08-17 16:59')) === true)
    check('Mo 17:30 ET Pause', terminmarktOffen(ms('2026-08-17 17:30')) === false)
    check('Mo 18:00 ET wieder offen', terminmarktOffen(ms('2026-08-17 18:00')) === true)
    check('Fr 16:59 ET offen', terminmarktOffen(ms('2026-08-21 16:59')) === true)
    check('Fr 17:30 ET zu (Wochenende)', terminmarktOffen(ms('2026-08-21 17:30')) === false)
    check('Sa 12:00 ET zu', terminmarktOffen(ms('2026-08-22 12:00')) === false)
    check('So 17:30 ET noch zu', terminmarktOffen(ms('2026-08-23 17:30')) === false)
    check('So 18:30 ET offen', terminmarktOffen(ms('2026-08-23 18:30')) === true)

    check('Mo 17:30 ET: CME-Warnung läuft',
        warnIds(lageZu(ms('2026-08-17 17:30'))).includes('cme'))
    check('Fr 17:30 ET: keine CME-Pausenwarnung (Wochenende statt Pause)',
        !warnIds(lageZu(ms('2026-08-21 17:30'))).includes('cme'))
}

// ── Wochenende bei den Sitzungen ─────────────────────────────────────────
console.log('\nWochenende')
{
    const sa = lageZu(ms('2026-08-22 10:00'))
    check('Samstag 10:00 ET: keine Sitzung', sa.phase === null, sa.phase?.id)
    check('Samstag: auch keine Warnung', sa.warnungen.length === 0)
    check('Samstag: Terminmarkt zu', sa.terminmarktOffen === false)

    // Sonntagabend New York ist Montagmorgen Tokio — die Woche beginnt in Asien.
    const so = lageZu(ms('2026-08-23 20:00'))
    check('Sonntag 20:00 ET: Terminmarkt läuft schon wieder', so.terminmarktOffen === true)
    check('Sonntag 20:00 ET: Asien hat auf (dort ist Montag 09:00)',
        so.phase?.id === 'asien', so.phase?.id)
    check('Sonntag 20:00 ET: keine US-Sitzung',
        !so.aktive.some(id => id.startsWith('us')), so.aktive.join(','))
}

// ── Feiertage ────────────────────────────────────────────────────────────
console.log('\nFeiertage')
{
    const offen = lageZu(ms('2026-08-17 10:00'), { feiertage: [] })
    check('ohne Feiertag läuft die Kassa', offen.phase?.id === 'usKassa')
    check('leere Liste heisst: wir wissen Bescheid', offen.feiertagUnbekannt === false)

    const zu = lageZu(ms('2026-08-17 10:00'), {
        feiertage: [{ dateUnix: ms('2026-08-17 00:00') }],
    })
    check('am Feiertag findet keine US-Sitzung statt',
        !zu.aktive.some(id => id.startsWith('us')), zu.aktive.join(','))
    // Absicht: über Feiertage in London und Tokio wissen wir nichts, also
    // behaupten wir dort auch nichts.
    check('… London läuft trotzdem weiter', zu.phase?.id === 'london', zu.phase?.id)
    check('… und das Kennzeichen steht', zu.feiertag === true)
    check('… und es gibt keine Eröffnungswarnung',
        !warnIds(lageZu(ms('2026-08-17 09:30'), { feiertage: [{ dateUnix: ms('2026-08-17 00:00') }] })).includes('eroeffnung'))

    check('nackte ms-Zahl wird als Feiertag erkannt',
        lageZu(ms('2026-08-17 10:00'), { feiertage: [ms('2026-08-17 06:00')] }).feiertag === true)

    check('ohne übergebene Liste ist der Feiertag unbekannt',
        lageZu(ms('2026-08-17 10:00')).feiertagUnbekannt === true)
    check('… und dann wird auch nichts abgeschaltet',
        lageZu(ms('2026-08-17 10:00')).phase?.id === 'usKassa')
}

// ── Nächste Ereignisse ───────────────────────────────────────────────────
console.log('\nCountdown')
{
    const l = lageZu(ms('2026-08-17 09:00'))
    check('nächstes Ereignis ist die Kassaeröffnung',
        l.naechste[0]?.id === 'kassaAuf' || l.naechste[0]?.id === 'usKassa',
        l.naechste[0]?.id)
    check('… in 30 Minuten', Math.round(l.naechste[0].inMs / 60000) === 30,
        String(Math.round(l.naechste[0]?.inMs / 60000)))
    check('die Liste ist aufsteigend sortiert',
        l.naechste.every((n, i) => i === 0 || n.tMs >= l.naechste[i - 1].tMs))
    check('alles Vergangene ist raus', l.naechste.every(n => n.inMs > 0))
}

// ── Robustheit ───────────────────────────────────────────────────────────
console.log('\nRobustheit')
{
    check('kaputte Termine werfen nicht',
        (() => {
            try {
                lageZu(ms('2026-08-17 08:31'), { ereignisse: [{}, { dateUnix: 'x' }, null] })
                return true
            } catch { return false }
        })())
    check('kaputte Feiertage werfen nicht',
        (() => {
            try {
                lageZu(ms('2026-08-17 10:00'), { feiertage: [{}, { dateUnix: NaN }] })
                return true
            } catch { return false }
        })())
    check('ohne Optionen kommt eine vollständige Antwort',
        (() => {
            const l = lageZu(Date.now())
            return typeof l.handelbar === 'boolean'
                && Array.isArray(l.warnungen)
                && Array.isArray(l.naechste)
                && Array.isArray(l.phasenHeute)
        })())
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log(`\x1b[31mFehler: ${fehler.join(', ')}\x1b[0m\n`)
    process.exit(1)
}
console.log('')
