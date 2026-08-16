/**
 * Anspruch auf periodische Aufgaben — über die Datenbank statt im Prozess.
 *
 * Warum es das braucht: alle übrigen Sperren im Projekt (`agentRunning` im
 * KI-Agenten, die `running`-Map der Strategie-Engine, die `active`-Map des
 * Aufzeichners) leben in EINEM Node-Prozess. Der NAS-Container und der
 * Entwicklungsrechner zeigen aber auf dieselbe PostgreSQL — jeder
 * Hintergrundtakt liefe dort doppelt. Für lesende Abrufe ist das egal, für
 * schreibende nicht: zwei Schnappschüsse pro Tag sind kein Problem, doppelt
 * bezahlte KI-Zusammenfassungen schon.
 *
 * Der Kniff ist ein bedingtes UPDATE: die Zeile wird nur umgeschrieben, wenn
 * der letzte Lauf lange genug her ist. Beide Backends serialisieren das
 * (PostgreSQL über die Zeilensperre, SQLite über den einen Schreiber), also
 * gewinnt genau ein Aufrufer.
 *
 * WICHTIG: Der Anspruch schützt das SCHREIBEN, nicht das Lesen. Wer eine
 * Fremdquelle nur abfragt, um sie anzuzeigen, braucht ihn nicht.
 */

import os from 'os'
import crypto from 'crypto'
import { getKnex } from './database.js'
import { logWarn } from './logger.js'

// Zufallsteil, weil Betriebssysteme PIDs wiederverwenden: ohne ihn könnte ein
// neu gestarteter Prozess mit demselben PID die Führung eines abgestürzten
// Vorgängers verlängern, statt die TTL abzuwarten.
const INSTANZ_ID = `${os.hostname()}/${process.pid}/${crypto.randomBytes(3).toString('hex')}`

/**
 * @param {string} key    Name der Aufgabe, z.B. 'snap_global'
 * @param {number} ttlMs  Mindestabstand zwischen zwei Läufen
 * @returns {Promise<boolean>} true = dieser Prozess darf laufen
 */
export async function beansprucheAufgabe(key, ttlMs) {
    const jetzt = Date.now()
    try {
        const knex = getKnex()
        // Zeile anlegen, falls es sie noch nicht gibt — mit fetchedAt 0, damit
        // der erste Anspruch sofort greift.
        await knex('radar_fetch_state').insert({ key, fetchedAt: 0, updatedAt: jetzt })
            .onConflict('key').ignore()

        const treffer = await knex('radar_fetch_state')
            .where('key', key)
            .andWhere('fetchedAt', '<', jetzt - ttlMs)
            .update({ fetchedAt: jetzt, claimedBy: INSTANZ_ID, updatedAt: jetzt })

        return treffer === 1
    } catch (e) {
        // SQLITE_BUSY oder ein Verbindungsabriss: dann eben nicht beansprucht.
        // Lieber ein Lauf zu wenig als zwei gleichzeitig.
        logWarn('db-claim', `Anspruch auf "${key}" fehlgeschlagen: ${e.message}`)
        return false
    }
}

/**
 * Führungs-Sperre für Arbeit, die LÄNGER dauern kann als ihr eigener Takt.
 *
 * Unterschied zu `beansprucheAufgabe`: hier gewinnt auch, wer die Zeile bereits
 * hält. Das ist genau der Zweig, der oben absichtlich fehlt — `beansprucheAufgabe`
 * soll „einmal je Intervall" bedeuten und darf sich deshalb nicht selbst
 * verlängern, sonst liefe der Tagesschnappschuss bei jedem Takt.
 *
 * Ablauf für einen langen Durchgang:
 *   if (!(await beansprucheFuehrung('engine_tick', 60_000))) return
 *   try { … lange Arbeit, dabei regelmässig verlaengereFuehrung('engine_tick') … }
 *   finally { await gibFuehrungFrei('engine_tick') }
 *
 * Die TTL ist die Nachsicht-Frist: stürzt der Halter ab, ohne freizugeben,
 * darf ein anderer nach Ablauf übernehmen. Sie muss also deutlich grösser sein
 * als der Abstand zwischen zwei Verlängerungen.
 */
export async function beansprucheFuehrung(key, ttlMs) {
    const jetzt = Date.now()
    try {
        const knex = getKnex()
        await knex('radar_fetch_state').insert({ key, fetchedAt: 0, updatedAt: jetzt })
            .onConflict('key').ignore()

        const treffer = await knex('radar_fetch_state')
            .where('key', key)
            .andWhere(function () {
                // frei (abgelaufen) ODER bereits von diesem Prozess gehalten
                this.where('fetchedAt', '<', jetzt - ttlMs).orWhere('claimedBy', INSTANZ_ID)
            })
            .update({ fetchedAt: jetzt, claimedBy: INSTANZ_ID, updatedAt: jetzt })

        return treffer === 1
    } catch (e) {
        logWarn('db-claim', `Führung "${key}" fehlgeschlagen: ${e.message}`)
        return false
    }
}

/** Halten verlängern. Liefert false, wenn inzwischen ein anderer die Zeile hat. */
export async function verlaengereFuehrung(key) {
    const jetzt = Date.now()
    try {
        const treffer = await getKnex()('radar_fetch_state')
            .where({ key, claimedBy: INSTANZ_ID })
            .update({ fetchedAt: jetzt, updatedAt: jetzt })
        return treffer === 1
    } catch (e) {
        logWarn('db-claim', `Verlängern von "${key}" fehlgeschlagen: ${e.message}`)
        return false
    }
}

/**
 * Führung freigeben. `fetchedAt` wird auf 0 gesetzt, damit der nächste Takt
 * sofort übernehmen kann statt die TTL abzuwarten.
 */
export async function gibFuehrungFrei(key) {
    try {
        await getKnex()('radar_fetch_state')
            .where({ key, claimedBy: INSTANZ_ID })
            .update({ fetchedAt: 0, claimedBy: '', updatedAt: Date.now() })
    } catch {
        // Nicht freigeben zu können ist kein Grund, den Durchgang scheitern zu
        // lassen — nach Ablauf der TTL übernimmt ohnehin der nächste.
    }
}

/** Fehler vermerken, ohne den Zeitstempel anzufassen (sonst wäre der Takt verschoben). */
export async function meldeFehler(key, meldung) {
    try {
        await getKnex()('radar_fetch_state').where('key', key)
            .update({ lastError: String(meldung || '').slice(0, 500), updatedAt: Date.now() })
    } catch {
        // Ein misslungener Fehlereintrag darf nichts weiter auslösen
    }
}

/** Zustand einer Aufgabe — für Statusanzeigen in der Oberfläche. */
export async function leseAufgabe(key) {
    try {
        return (await getKnex()('radar_fetch_state').where('key', key).first()) || null
    } catch {
        return null
    }
}

export { INSTANZ_ID }
