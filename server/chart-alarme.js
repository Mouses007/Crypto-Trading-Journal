/**
 * Preis-, Linien- und Zonenalarme des Chart-Arbeitsplatzes.
 *
 *   CRUD /api/chart/alarme
 *   POST /api/chart/alarme/test     eine Testmeldung über die Push-Kanäle
 *
 * Der Takt läuft alle 5 s — aber nur, wenn es aktive Alarme gibt, und nur in
 * EINEM Prozess: NAS und Testcontainer teilen eine Datenbank, und zwei Takte
 * meldeten jede Kreuzung doppelt. Die Führung (`db-claim.js`) hat eine TTL
 * von 30 s; fällt der Halter aus, übernimmt der andere nach einer halben
 * Minute.
 *
 * Preise kommen als EIN Sammelabruf je Markt (`ticker/price` ohne Symbol,
 * Gewicht 2 bzw. 4) statt einer Anfrage je Alarm — zwanzig Alarme kosten so
 * dasselbe wie einer.
 *
 * Zugestellt wird über die Push-Kanäle des Hype-Radars (ntfy, Telegram,
 * Webhook — eine Stelle für alle Handy-Meldungen) und, wenn in den
 * Benachrichtigungen eingeschaltet, per Mail (`melde('chartAlarm')`). Die
 * Regeln selbst (Kreuzen, Lücke, Sperrfrist) stehen rein in
 * `chart-alarm-regeln.js`.
 */
import axios from 'axios'
import { getKnex } from './database.js'
import { beansprucheFuehrung } from './db-claim.js'
import { notiereGewicht, melde429, warteAufGewicht } from './binance-takt.js'
import { pruefeAlarm, sperreAbgelaufen } from './chart-alarm-regeln.js'
import { stelleZu } from './hype-radar/zustellung.js'
import { leseEinstellungen } from './hype-radar/einstellungen.js'
import { melde } from './benachrichtigungen.js'
import { logWarn } from './logger.js'

const TAKT_MS = 5000
const FUEHRUNG_KEY = 'chart_alarme'
const FUEHRUNG_TTL_MS = 30_000
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/
const MAX_VERLAUF = 20
const MAX_ALARME = 300

const LINIEN_TYPEN = ['horizontale', 'strahlH', 'trendlinie', 'strahl', 'kanal']
const ZONEN_TYPEN = ['rechteck', 'kanal']
const RICHTUNGEN = { preis: ['ueber', 'unter', 'kreuzt'], linie: ['ueber', 'unter', 'kreuzt'], zone: ['betreten', 'verlassen'] }

const PREIS_URL = {
    futures: 'https://fapi.binance.com/fapi/v1/ticker/price',
    spot: 'https://api.binance.com/api/v3/ticker/price',
}
const PREIS_GEWICHT = { futures: 2, spot: 4 }

function parse(text, ersatz) {
    if (text == null || text === '') return ersatz
    if (typeof text === 'object') return text
    try { return JSON.parse(text) } catch { return ersatz }
}

function alarmZeile(r) {
    return {
        id: r.id, symbol: r.symbol, markt: r.markt, art: r.art,
        bedingung: parse(r.bedingung, {}), zeichnungId: r.zeichnungId == null ? null : Number(r.zeichnungId),
        kanaele: parse(r.kanaele, null), einmalig: Number(r.einmalig) === 1, aktiv: Number(r.aktiv) === 1,
        letzterPreis: r.letzterPreis == null ? null : Number(r.letzterPreis), letzteZeit: Number(r.letzteZeit) || 0,
        ausgeloestAm: Number(r.ausgeloestAm) || 0, anzahlAusgeloest: Number(r.anzahlAusgeloest) || 0,
        verlauf: parse(r.verlauf, []), notiz: r.notiz || '', erstelltAm: Number(r.erstelltAm) || 0,
    }
}

/**
 * Eingabe prüfen. Ein Linienalarm braucht eine Zeichnung, die eine Linie ist —
 * ein Alarm auf ein Fibonacci-Gitter hätte keine eindeutige Linie und löste
 * nie aus, ohne dass jemand erführe, warum.
 */
async function pruefeEingabe(roh, knex, teilweise = false) {
    const aus = {}
    if (!teilweise || roh.symbol !== undefined) {
        const s = String(roh.symbol || '').toUpperCase()
        if (!SYMBOL_RE.test(s)) return { fehler: 'symbol ungültig' }
        aus.symbol = s
    }
    if (!teilweise || roh.markt !== undefined) aus.markt = roh.markt === 'spot' ? 'spot' : 'futures'
    const art = teilweise ? roh.art : roh.art
    if (!teilweise || art !== undefined) {
        if (!RICHTUNGEN[art]) return { fehler: `art unbekannt: ${art}` }
        aus.art = art
    }
    if (roh.bedingung !== undefined || !teilweise) {
        const b = roh.bedingung && typeof roh.bedingung === 'object' ? roh.bedingung : {}
        const a = aus.art || roh.art
        const bed = {}
        if (b.richtung !== undefined) {
            if (a && !RICHTUNGEN[a]?.includes(b.richtung)) return { fehler: `richtung ${b.richtung} passt nicht zu ${a}` }
            bed.richtung = b.richtung
        }
        if (a === 'preis') {
            const p = Number(b.preis)
            if (!(p > 0)) return { fehler: 'preis fehlt' }
            bed.preis = p
        }
        if (b.kante !== undefined) bed.kante = ['oben', 'unten', 'mitte'].includes(b.kante) ? b.kante : 'oben'
        if (b.sperreMin !== undefined) bed.sperreMin = Math.max(0, Math.min(10080, Number(b.sperreMin) || 0))
        if (b.schwere !== undefined) bed.schwere = ['info', 'warnung', 'kritisch'].includes(b.schwere) ? b.schwere : 'warnung'
        aus.bedingung = JSON.stringify(bed)
    }
    if (!teilweise && (aus.art === 'linie' || aus.art === 'zone')) {
        const id = Number(roh.zeichnungId)
        const z = id ? await knex('chart_zeichnungen').where('id', id).first() : null
        if (!z) return { fehler: 'zeichnung fehlt' }
        const erlaubt = aus.art === 'linie' ? LINIEN_TYPEN : ZONEN_TYPEN
        if (!erlaubt.includes(z.typ)) return { fehler: `ein ${aus.art}-Alarm geht nicht auf ${z.typ}` }
        if (z.symbol !== aus.symbol) return { fehler: 'zeichnung gehört zu einem anderen Symbol' }
        aus.zeichnungId = id
    }
    if (roh.kanaele !== undefined) {
        const k = roh.kanaele && typeof roh.kanaele === 'object' ? roh.kanaele : {}
        aus.kanaele = JSON.stringify({ push: k.push !== false, mail: k.mail !== false })
    }
    if (roh.einmalig !== undefined) aus.einmalig = roh.einmalig ? 1 : 0
    if (roh.aktiv !== undefined) aus.aktiv = roh.aktiv ? 1 : 0
    if (roh.notiz !== undefined) aus.notiz = String(roh.notiz || '').slice(0, 300)
    return { daten: aus }
}

// ── Preise ───────────────────────────────────────────────────────────────
async function holePreise(markt) {
    await warteAufGewicht(PREIS_GEWICHT[markt])
    try {
        const r = await axios.get(PREIS_URL[markt], { timeout: 8000 })
        notiereGewicht(r.headers)
        const karte = new Map()
        for (const x of r.data || []) {
            const p = Number(x.price)
            if (x.symbol && p > 0) karte.set(x.symbol, p)
        }
        return karte
    } catch (e) {
        const status = e.response?.status
        if (status === 429 || status === 418) melde429(status, e.response?.headers)
        throw e
    }
}

// ── Meldung ──────────────────────────────────────────────────────────────
function zahl(p) {
    if (!Number.isFinite(p)) return '—'
    const a = Math.abs(p)
    const stellen = a >= 1000 ? 2 : a >= 1 ? 4 : 8
    return Number(p.toFixed(stellen)).toLocaleString('de-CH', { maximumFractionDigits: stellen })
}

const WORT = { ueber: 'steigt über', unter: 'fällt unter', betreten: 'läuft in die Zone', verlassen: 'verlässt die Zone' }
const TYP_NAME = { horizontale: 'Horizontale', strahlH: 'Strahl', trendlinie: 'Trendlinie', strahl: 'Strahl', kanal: 'Kanal', rechteck: 'Zone' }

/** Text einer Auslösung — rein, damit er im Selbsttest der Route mitgeprüft werden kann. */
export function meldungsText(alarm, zeichnung, erg, preis) {
    const was = alarm.art === 'zone'
        ? WORT[alarm.bedingung?.richtung || 'betreten']
        : `${WORT[erg.richtung] || 'kreuzt'} ${zahl(erg.niveau)}`
    const wo = alarm.art === 'preis' ? '' : ` (${TYP_NAME[zeichnung?.typ] || 'Zeichnung'}${zeichnung?.stil?.text ? ` „${zeichnung.stil.text}"` : ''})`
    const markt = alarm.markt === 'spot' ? ' Spot' : ''
    const titel = `${alarm.symbol}${markt} ${was}`
    const text = `${titel}${wo} — jetzt ${zahl(preis)}${alarm.notiz ? `\n${alarm.notiz}` : ''}`
    return { titel, text }
}

async function melden(alarm, zeichnung, erg, preis, t) {
    const { titel, text } = meldungsText(alarm, zeichnung, erg, preis)
    const kanaele = alarm.kanaele || { push: true, mail: true }
    if (kanaele.push !== false) {
        try {
            await stelleZu({
                regel: 'chartAlarm', schwere: alarm.bedingung?.schwere || 'warnung',
                meldung: text, titel, quelle: 'chart',
                daten: { alarmId: alarm.id, art: alarm.art, symbol: alarm.symbol, preis, niveau: erg.niveau ?? null },
            }, { symbol: alarm.symbol, chain: alarm.markt }, await leseEinstellungen())
        } catch (e) { logWarn('chart-alarme', `Push: ${e.message}`) }
    }
    if (kanaele.mail !== false) {
        await melde('chartAlarm', { betreff: titel, text, schluessel: `${alarm.id}|${t}`, ttlMs: 60_000 })
    }
}

// ── Takt ─────────────────────────────────────────────────────────────────
let taktUhr = null
let laeuft = false

async function einTakt() {
    if (laeuft) return
    laeuft = true
    try {
        const knex = getKnex()
        const roh = await knex('chart_alarme').where('aktiv', 1)
        if (!roh.length) return
        if (!(await beansprucheFuehrung(FUEHRUNG_KEY, FUEHRUNG_TTL_MS))) return
        const alarme = roh.map(alarmZeile)

        const preise = {}
        for (const markt of new Set(alarme.map((a) => a.markt))) {
            try { preise[markt] = await holePreise(markt) } catch (e) {
                logWarn('chart-alarme', `Preise ${markt}: ${e.message}`)
            }
        }

        const ids = [...new Set(alarme.map((a) => a.zeichnungId).filter(Boolean))]
        const zeichnungen = new Map()
        if (ids.length) {
            for (const z of await knex('chart_zeichnungen').whereIn('id', ids)) {
                zeichnungen.set(Number(z.id), { ...z, punkte: parse(z.punkte, []), stil: parse(z.stil, {}) })
            }
        }

        const t = Date.now()
        for (const a of alarme) {
            const p = preise[a.markt]?.get(a.symbol)
            if (!p) continue
            const z = a.zeichnungId ? zeichnungen.get(a.zeichnungId) : null
            if ((a.art === 'linie' || a.art === 'zone') && !z) {
                // Die Zeichnung ist weg — der Alarm hätte nie wieder etwas zu prüfen.
                await knex('chart_alarme').where('id', a.id).update({ aktiv: 0 })
                continue
            }
            const vorher = a.letzterPreis != null && a.letzteZeit ? { p: a.letzterPreis, t: a.letzteZeit } : null
            const erg = pruefeAlarm(a, z, vorher, { p, t })
            const patch = { letzterPreis: p, letzteZeit: t }
            if (erg.ausloesen && sperreAbgelaufen(a, t)) {
                patch.ausgeloestAm = t
                patch.anzahlAusgeloest = a.anzahlAusgeloest + 1
                patch.verlauf = JSON.stringify([...a.verlauf, { t, p, niveau: erg.niveau ?? null }].slice(-MAX_VERLAUF))
                if (a.einmalig) patch.aktiv = 0
                await knex('chart_alarme').where('id', a.id).update(patch)
                await melden(a, z, erg, p, t)
            } else {
                await knex('chart_alarme').where('id', a.id).update(patch)
            }
        }
    } catch (e) {
        logWarn('chart-alarme', `Takt: ${e.message}`)
    } finally {
        laeuft = false
    }
}

export function startChartAlarmTakt() {
    if (taktUhr) return
    taktUhr = setInterval(einTakt, TAKT_MS)
}

export function stopChartAlarmTakt() {
    clearInterval(taktUhr)
    taktUhr = null
}

// ── Routen ───────────────────────────────────────────────────────────────
export function setupChartAlarmRoutes(app) {
    app.get('/api/chart/alarme', async (req, res) => {
        try {
            let q = getKnex()('chart_alarme').orderBy('id', 'desc')
            const symbol = String(req.query.symbol || '').toUpperCase()
            if (symbol) q = q.where('symbol', symbol)
            res.json((await q.limit(MAX_ALARME)).map(alarmZeile))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.post('/api/chart/alarme', async (req, res) => {
        try {
            const knex = getKnex()
            const { fehler, daten } = await pruefeEingabe(req.body || {}, knex)
            if (fehler) return res.status(400).json({ error: fehler })
            const [zeile] = await knex('chart_alarme').insert({
                einmalig: 1, aktiv: 1, kanaele: JSON.stringify({ push: true, mail: true }),
                ...daten, erstelltAm: Date.now(),
            }).returning('id')
            const id = typeof zeile === 'object' ? zeile.id : zeile
            res.json(alarmZeile(await knex('chart_alarme').where('id', id).first()))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.put('/api/chart/alarme/:id', async (req, res) => {
        try {
            const id = Number(req.params.id)
            const knex = getKnex()
            const alt = await knex('chart_alarme').where('id', id).first()
            if (!alt) return res.status(404).json({ error: 'Alarm nicht gefunden' })
            const { fehler, daten } = await pruefeEingabe({ art: alt.art, ...req.body }, knex, true)
            if (fehler) return res.status(400).json({ error: fehler })
            delete daten.art
            // Wieder eingeschaltet: neu ansetzen. Der gespeicherte Preis ist
            // womöglich Tage alt, und ein Vergleich damit wäre eine Kreuzung,
            // die niemand gesehen hat.
            if (daten.aktiv === 1 && Number(alt.aktiv) !== 1) { daten.letzterPreis = null; daten.letzteZeit = 0 }
            await knex('chart_alarme').where('id', id).update(daten)
            res.json(alarmZeile(await knex('chart_alarme').where('id', id).first()))
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.delete('/api/chart/alarme/:id', async (req, res) => {
        try {
            await getKnex()('chart_alarme').where('id', Number(req.params.id)).del()
            res.json({ ok: true })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })

    app.post('/api/chart/alarme/test', async (_req, res) => {
        try {
            await stelleZu({
                regel: 'chartAlarm', schwere: 'kritisch', quelle: 'chart',
                titel: 'Chart-Alarm: Test', meldung: 'Testmeldung vom Chart-Arbeitsplatz — die Zustellung funktioniert.',
                daten: { test: true },
            }, { symbol: 'TEST', chain: '—' }, await leseEinstellungen())
            res.json({ ok: true })
        } catch (e) { res.status(500).json({ error: e.message }) }
    })
}
