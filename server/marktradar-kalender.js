/**
 * Wirtschaftskalender.
 *
 * Quelle ist der frei zugängliche Wochen-Feed von ForexFactory. Er hat eine
 * Eigenheit, die den ganzen Aufbau bestimmt: **er führt immer nur die laufende
 * Woche.** Wer ihn bloss durchreicht, hat weder Rückblick noch Vorschau — und
 * am Freitag steht nichts über den kommenden Montag darin.
 *
 * Deshalb wird gesammelt statt durchgereicht: jeder Lauf schreibt die Termine
 * in `calendar_events`. Was einmal drinsteht, bleibt. Sobald der Feed am
 * Wochenende auf die neue Woche umschaltet, ist die Vorschau automatisch da,
 * und die vergangene Woche verschwindet nicht mehr aus der Ansicht.
 *
 * Der Feed ist inoffiziell (er versorgt das Kalender-Widget der Seite). Er kann
 * jederzeit verschwinden — genau deshalb ist der eigene Bestand die Wahrheit
 * und der Abruf nur die Ergänzung.
 */

import crypto from 'crypto'
import { getKnex } from './database.js'
import { logWarn } from './logger.js'
import { beansprucheAufgabe, meldeFehler, leseAufgabe } from './db-claim.js'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { holeJson, sendRadarError } from './marktradar-api.js'

dayjs.extend(utc)
dayjs.extend(timezone)

const FED_URL = 'https://www.federalreserve.gov/json/calendar.json'
/** Fed-Zeiten stehen in New Yorker Ortszeit — Sommer- und Winterzeit inbegriffen. */
const FED_ZONE = 'America/New_York'

const FEEDS = [
    'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    // Gibt es nicht immer — wenn doch, liefert er die Vorschau gratis mit
    'https://nfs.faireconomy.media/ff_calendar_thismonth.json',
]

const TAG = 24 * 60 * 60 * 1000
const ABRUF_TTL = 6 * 60 * 60 * 1000

/** Feed-Stufen auf drei eigene abbilden; alles Unbekannte gilt als niedrig. */
function impactVon(roh) {
    const s = String(roh || '').toLowerCase()
    if (s.startsWith('high')) return 'high'
    if (s.startsWith('med')) return 'medium'
    if (s.startsWith('holiday')) return 'holiday'
    return 'low'
}

/**
 * Fingerabdruck eines Termins. Titel, Land und Zeitpunkt sind stabil —
 * Prognose, Vorwert und Ist ändern sich im Wochenverlauf und dürfen deshalb
 * NICHT in den Schlüssel, sonst entstünde bei jeder Aktualisierung ein
 * Doppeleintrag.
 */
const extId = (land, titel, dateUnix) =>
    crypto.createHash('sha1').update(`${land}|${titel}|${dateUnix}`).digest('hex').slice(0, 24)

function normalisiere(e, quelle) {
    const dateUnix = Date.parse(e.date)
    if (!Number.isFinite(dateUnix)) return null
    const land = String(e.country || '').toUpperCase()
    const titel = String(e.title || '').trim()
    if (!land || !titel) return null
    return {
        extId: extId(land, titel, dateUnix),
        titel, land,
        impact: impactVon(e.impact),
        dateUnix,
        forecast: String(e.forecast ?? ''),
        previous: String(e.previous ?? ''),
        actual: String(e.actual ?? ''),
        quelle,
        updatedAt: Date.now(),
    }
}

/**
 * Termine holen und einpflegen. Vorhandene Zeilen werden aktualisiert, nicht
 * verdoppelt — im Wochenverlauf trägt der Feed erst die Prognose und später
 * den Ist-Wert nach.
 */
export async function holeKalender({ manuell = false } = {}) {
    // Von Hand angestossen darf öfter, aber nicht beliebig oft
    const ttl = manuell ? 5 * 60 * 1000 : ABRUF_TTL
    if (!(await beansprucheAufgabe('kalender_ff', ttl))) {
        return { uebersprungen: true }
    }

    const knex = getKnex()
    let neu = 0, aktualisiert = 0, gesehen = 0
    let letzterFehler = ''

    for (const url of FEEDS) {
        let roh
        try {
            roh = await holeJson(url, 15000)
        } catch (e) {
            // Der Monats-Feed existiert nicht immer — das ist kein Fehlerfall
            if (url.includes('thismonth')) continue
            letzterFehler = e.message
            logWarn('kalender', `${url} nicht abrufbar: ${e.message}`)
            continue
        }
        if (!Array.isArray(roh)) continue

        const quelle = url.includes('thismonth') ? 'ff-monat' : 'ff-woche'
        const zeilen = roh.map(e => normalisiere(e, quelle)).filter(Boolean)
        gesehen += zeilen.length

        // In Blöcken schreiben statt Zeile für Zeile: bei rund hundert Terminen
        // je Lauf wären das sonst zweihundert Hin- und Rückwege zur Datenbank —
        // über Netz zum NAS dauert das spürbar. `merge` trägt Prognose und
        // Ist-Wert nach, ohne den Termin zu verdoppeln.
        const vorher = Number((await knex('calendar_events').count('* as c').first())?.c || 0)
        for (let i = 0; i < zeilen.length; i += 50) {
            const block = zeilen.slice(i, i + 50).map(z => ({ ...z, fetchedAt: Date.now() }))
            await knex('calendar_events').insert(block)
                .onConflict('extId').merge(['impact', 'forecast', 'previous', 'actual', 'updatedAt'])
        }
        const nachher = Number((await knex('calendar_events').count('* as c').first())?.c || 0)
        neu += nachher - vorher
        aktualisiert += zeilen.length - (nachher - vorher)
    }

    // Zweite Quelle: amtliche Fixtermine mit langem Vorlauf. Ein Fehler hier
    // darf den Wochen-Feed nicht mitreissen — die beiden hängen nicht zusammen.
    let fed = { gesehen: 0, neu: 0 }
    try {
        fed = await holeFedTermine(knex)
        neu += fed.neu
        gesehen += fed.gesehen
    } catch (e) {
        logWarn('kalender', `Fed-Kalender: ${e.message}`)
    }

    // Erfolg löscht den Fehler wieder. Sonst bleibt der Eintrag stehen, bis
    // irgendwann der nächste Lauf scheitert — die Statusanzeige zeigte dann
    // tagelang ein „HTTP 429", das längst vorbei ist.
    if (gesehen) await meldeFehler('kalender_ff', '')
    else if (letzterFehler) await meldeFehler('kalender_ff', letzterFehler)
    console.log(` -> Kalender: ${gesehen} Termine gesehen, ${neu} neu, ${aktualisiert} aktualisiert`
        + ` (davon Fed: ${fed.gesehen} mit langem Vorlauf)`)
    return { gesehen, neu, aktualisiert, fed: fed.gesehen, fehler: letzterFehler }
}

/**
 * Amtliche Fixtermine der US-Notenbank.
 *
 * Warum eine zweite Quelle: Der ForexFactory-Feed führt **nur die laufende
 * Woche**. Wer wissen will, wann die übernächste Zinsentscheidung ansteht,
 * findet dort nichts — die Fed selbst veröffentlicht ihren Kalender dagegen
 * Monate im Voraus, als JSON, amtlich und frei verwendbar (Behördenwerk).
 *
 * Was sie NICHT liefert: Prognosen. Die stammen aus Umfragen unter
 * Volkswirten und sind genau das, was die Bezahlanbieter verkaufen. Beide
 * Quellen ergänzen sich also, statt sich zu ersetzen:
 *
 *   ForexFactory  → diese Woche, viele Termine, mit Prognose und Vorwert
 *   Fed           → Monate voraus, wenige Termine, ohne Prognose
 *
 * Damit sie sich nicht ins Gehege kommen, werden Fed-Termine erst **jenseits
 * der laufenden Woche** übernommen. Im Nahbereich gewinnt die reichere Quelle.
 */
async function holeFedTermine(knex) {
    const roh = await holeJson(FED_URL, 15000)
    const ereignisse = Array.isArray(roh?.events) ? roh.events : []
    if (!ereignisse.length) throw new Error('Fed-Kalender ohne Termine')

    // Nur was Märkte bewegt. Reden einzelner Mitglieder sind zu zahlreich und
    // zu ungleich gewichtig, um sie ungefiltert danebenzustellen.
    const ARTEN = { FOMC: 'high', Beige: 'medium' }

    const grenze = Date.now() + 7 * TAG
    const zeilen = []

    for (const e of ereignisse) {
        const stufe = ARTEN[e.type]
        if (!stufe || !e.month || !e.days) continue

        // "9" oder "8-9" — bei mehrtägigen Sitzungen zählt der letzte Tag,
        // denn dann fällt die Entscheidung
        const tag = String(e.days).split('-').pop().trim()

        // "2:00 p.m." → 14:00 New Yorker Ortszeit
        const zeitText = String(e.time || '2:00 p.m.').toLowerCase().replace(/[\s.]/g, '')
        const m = zeitText.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/)
        let stunde = m ? Number(m[1]) % 12 : 14
        const minute = m ? Number(m[2] || 0) : 0
        if (m && m[3] === 'pm') stunde += 12

        const stempel = `${e.month}-${String(tag).padStart(2, '0')} `
            + `${String(stunde).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
        const zeit = dayjs.tz(stempel, 'YYYY-MM-DD HH:mm', FED_ZONE)
        if (!zeit.isValid()) continue

        const dateUnix = zeit.valueOf()
        if (dateUnix < grenze) continue          // Nahbereich gehört ForexFactory

        const titel = String(e.title || e.type).trim()
        if (!titel) continue

        zeilen.push({
            extId: extId('USD', titel, dateUnix),
            titel, land: 'USD', impact: stufe, dateUnix,
            forecast: '', previous: '', actual: '',
            quelle: 'fed', updatedAt: Date.now(), fetchedAt: Date.now(),
        })
    }

    if (!zeilen.length) return { neu: 0, gesehen: 0 }

    const vorher = Number((await knex('calendar_events').count('* as c').first())?.c || 0)
    for (let i = 0; i < zeilen.length; i += 50) {
        await knex('calendar_events').insert(zeilen.slice(i, i + 50))
            .onConflict('extId').merge(['impact', 'updatedAt'])
    }
    const nachher = Number((await knex('calendar_events').count('* as c').first())?.c || 0)
    return { gesehen: zeilen.length, neu: nachher - vorher }
}

/** Bestand aus der eigenen Datenbank — der Feed wird hier nicht angefasst. */
export async function leseKalender({ von, bis, laender, impact }) {
    const knex = getKnex()
    const jetzt = Date.now()
    const vonMs = Number(von) || jetzt - 3 * TAG
    const bisMs = Number(bis) || jetzt + 14 * TAG

    let q = knex('calendar_events')
        .whereBetween('dateUnix', [vonMs, bisMs])
        .orderBy('dateUnix', 'asc')

    const landListe = String(laender || '').split(/[,\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean)
    if (landListe.length) q = q.whereIn('land', landListe)

    // „medium" heisst: mittel UND hoch. Eine Untergrenze ist gemeint, keine
    // Punktauswahl — sonst müsste man beide Stufen einzeln anklicken.
    const stufe = String(impact || 'all').toLowerCase()
    if (stufe === 'high') q = q.where('impact', 'high')
    else if (stufe === 'medium') q = q.whereIn('impact', ['medium', 'high'])

    const zeilen = await q.select(
        'extId', 'titel', 'land', 'impact', 'dateUnix', 'forecast', 'previous', 'actual')

    // Wie viele Termine lägen ohne Filter im Zeitraum? Nur so lässt sich
    // „nichts los" von „alles weggefiltert" unterscheiden.
    const gesamt = Number((await knex('calendar_events')
        .whereBetween('dateUnix', [vonMs, bisMs]).count('* as c').first())?.c || 0)

    const zustand = await leseAufgabe('kalender_ff')
    return {
        ereignisse: zeilen.map(z => ({ ...z, dateUnix: Number(z.dateUnix) })),
        gesamtImZeitraum: gesamt,
        letzterAbruf: Number(zustand?.fetchedAt) || null,
        letzterFehler: zustand?.lastError || '',
        // Ohne diese Angabe wüsste niemand, ob eine leere Vorschau bedeutet
        // „nichts los" oder „der Feed hat die neue Woche noch nicht"
        bestandBis: zeilen.length ? Number(zeilen[zeilen.length - 1].dateUnix) : null,
    }
}

let takt = null

export function setupKalenderRoutes(app) {
    app.get('/api/marktradar/kalender', async (req, res) => {
        try {
            const knex = getKnex()
            const s = await knex('settings').where('id', 1).first().catch(() => null)
            const daten = await leseKalender({
                von: req.query.von,
                bis: req.query.bis,
                laender: req.query.laender ?? s?.radarKalenderLaender ?? 'USD,JPY',
                impact: req.query.impact ?? s?.radarKalenderImpact ?? 'medium',
            })
            res.set('Cache-Control', 'no-store')
            res.json({ stand: daten.letzterAbruf || Date.now(), veraltet: false, ...daten })
        } catch (e) {
            sendRadarError(res, e, 'Wirtschaftskalender')
        }
    })

    app.post('/api/marktradar/kalender/holen', async (req, res) => {
        try {
            res.json(await holeKalender({ manuell: true }))
        } catch (e) {
            sendRadarError(res, e, 'Wirtschaftskalender')
        }
    })

    // Beim Start einmal, danach alle zwei Stunden nachfassen. Der Anspruch
    // sorgt dafür, dass daraus höchstens alle sechs Stunden ein echter Abruf
    // wird — auch wenn mehrere Instanzen laufen.
    holeKalender().catch(() => { })
    takt = setInterval(() => holeKalender().catch(() => { }), 2 * 60 * 60 * 1000)

    console.log(' -> Kalender routes initialized')
}

export function stopKalender() {
    clearInterval(takt)
    takt = null
}
