/**
 * Eigenes 1-Minuten-Open-Interest-Archiv.
 *
 * Binance kennt kein 1m-OI: `openInterestHist` beginnt bei 5m (und reicht nur
 * 30 Tage zurück), `/fapi/v1/openInterest` liefert nur den Momentwert. Für die
 * Liquidationskarte ist die 5m-Auflösung der grösste blinde Fleck — innerhalb
 * einer Periode öffnen und schliessen Positionen gegeneinander, und dieser
 * Umschlag bleibt im ΔOI-Saldo unsichtbar. Minütliches Selbst-Pollen viertelt
 * ihn.
 *
 * Kosten: je Symbol und Minute ein Abruf mit Gewicht 1 — bei fünf Symbolen
 * 5/min gegen ein Budget von 1600. Gemeldet wird trotzdem an die gemeinsame
 * Bremse (`binance-takt.js`), damit ein 429 der IP auch hier ankommt.
 *
 * Takt über `beansprucheFuehrung`, nicht `beansprucheAufgabe`: NAS-Container
 * und dev-Server teilen eine Datenbank, und bei einem 60-s-Anspruch würde der
 * Schreiber minütlich zwischen den Prozessen flattern. Die Führung bevorzugt
 * den bisherigen Halter; fällt er aus, übernimmt der andere nach spätestens
 * fünf Minuten.
 */

import axios from 'axios'
import { getKnex } from './database.js'
import { beansprucheFuehrung, beansprucheAufgabe } from './db-claim.js'
import { notiereGewicht, melde429, warteAufGewicht, pausiertBis } from './binance-takt.js'
import { logWarn } from './logger.js'

const HTTP_TIMEOUT = 10000
const FUEHRUNG_KEY = 'oi_minute_takt'
const FUEHRUNG_TTL_MS = 5 * 60 * 1000
const TAKT_MS = 60 * 1000
const RETENTION_TAGE = 30
const MAX_SYMBOLE = 10
const VORGABE_SYMBOLE = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']

/**
 * Minutenreihe mit der 5m-Historie zu einer lückenlosen OI-Reihe auffüllen.
 *
 * Stufenfunktion, KEINE Interpolation: ein interpolierter OI-Wert erfände
 * ein ΔOI und damit Einzahlungen in der Karte, die nie stattgefunden haben.
 * Fehlt eine Minute, gilt der letzte bekannte Wert davor (eigene Minute vor
 * 5m-Punkt, weil sie näher dran ist).
 *
 * Pure — kein Netz, keine DB — und deshalb unter node testbar
 * (`server/__selftest-oi-archiv.mjs`).
 *
 * @param {Array<{t:number, oi:number}>} minuten   eigene Punkte, aufsteigend
 * @param {Array<{t:number, oi:number}>} fuenfMin  5m-Stützen, aufsteigend
 * @param {number} vonMs  erste Minutengrenze (einschliesslich)
 * @param {number} bisMs  letzte Minutengrenze (einschliesslich)
 * @returns {{reihe: Array<{t:number, oi:number, eigen:boolean}>, abdeckung: number}}
 *          `abdeckung` = Anteil der Minuten mit EIGENEM Messpunkt (0..1)
 */
export function fuelleOiLuecken(minuten, fuenfMin, vonMs, bisMs) {
    const eigene = new Map(minuten.map(p => [p.t, p.oi]))
    const reihe = []
    let eigenZahl = 0
    let gesamt = 0
    let stufe = 0        // Zeiger in fuenfMin
    let letzter = null   // letzter bekannter OI-Wert (Stufenfunktion)

    for (let t = vonMs; t <= bisMs; t += 60000) {
        gesamt++
        // 5m-Stützen bis t nachziehen — sie sind die Rückfallebene
        while (stufe < fuenfMin.length && fuenfMin[stufe].t <= t) {
            letzter = fuenfMin[stufe].oi
            stufe++
        }
        const eigen = eigene.get(t)
        if (eigen != null && eigen > 0) {
            letzter = eigen
            eigenZahl++
            reihe.push({ t, oi: eigen, eigen: true })
        } else if (letzter != null && letzter > 0) {
            reihe.push({ t, oi: letzter, eigen: false })
        }
        // vor der ersten Stütze: Minute entfällt — ein erfundener Anfangswert
        // würde als riesiges ΔOI in der ersten Kerze landen
    }
    return { reihe, abdeckung: gesamt > 0 ? eigenZahl / gesamt : 0 }
}

// ── Takt ────────────────────────────────────────────────────────────────

let taktTimer = null
let laeuftGerade = false

async function leseSymbole(knex) {
    try {
        const row = await knex('settings').where({ id: 1 }).first()
        const eigene = String(row?.liveRecordSymbols || '')
            .split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
        const liste = eigene.length ? eigene : VORGABE_SYMBOLE
        return liste.slice(0, MAX_SYMBOLE)
    } catch {
        return VORGABE_SYMBOLE
    }
}

async function einTakt() {
    if (laeuftGerade) return           // ein hängender Lauf soll sich nicht stapeln
    laeuftGerade = true
    try {
        const knex = getKnex()
        // Führung statt Aufgabe: der bisherige Halter gewinnt erneut,
        // der Schreiber flattert nicht zwischen NAS und dev.
        if (!(await beansprucheFuehrung(FUEHRUNG_KEY, FUEHRUNG_TTL_MS))) return
        if (pausiertBis() > Date.now()) return   // IP steht unter 429-Strafe

        const symbole = await leseSymbole(knex)
        const minute = Math.floor(Date.now() / 60000) * 60000
        for (const symbol of symbole) {
            try {
                await warteAufGewicht(1)
                const res = await axios.get('https://fapi.binance.com/fapi/v1/openInterest', {
                    params: { symbol }, timeout: HTTP_TIMEOUT,
                })
                notiereGewicht(res.headers)
                const oi = Number(res.data?.openInterest)
                if (!(oi > 0)) continue
                await knex('oi_minute')
                    .insert({ symbol, t: minute, oi })
                    .onConflict(['symbol', 't'])
                    .ignore()
            } catch (fehler) {
                const status = fehler.response?.status
                if (status === 429 || status === 418) {
                    melde429(status, fehler.response?.headers)
                    break   // die Strafe gilt der IP — der Rest der Runde entfällt
                }
                logWarn('oi-archiv', `${symbol}: ${fehler.message}`)
            }
        }

        // Aufräumen einmal täglich, huckepack auf dem Takt
        if (await beansprucheAufgabe('oi_minute_purge', 24 * 60 * 60 * 1000)) {
            const grenze = Date.now() - RETENTION_TAGE * 24 * 60 * 60 * 1000
            const weg = await knex('oi_minute').where('t', '<', grenze).del()
            if (weg > 0) console.log(` -> OI-Archiv: ${weg} Zeilen älter ${RETENTION_TAGE} Tage entfernt`)
        }
    } catch (fehler) {
        logWarn('oi-archiv', `Takt fehlgeschlagen: ${fehler.message}`)
    } finally {
        laeuftGerade = false
    }
}

export function startOiArchivTakt() {
    if (taktTimer) return
    einTakt()
    taktTimer = setInterval(einTakt, TAKT_MS)
    console.log(' -> OI-Archiv-Takt gestartet (1-Minuten-Open-Interest)')
}

export function stopOiArchivTakt() {
    clearInterval(taktTimer)
    taktTimer = null
}
