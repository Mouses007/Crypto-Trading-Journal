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
 * „Jetzt" in Millisekunden — als SQL-Ausdruck, gerechnet von der DATENBANK.
 *
 * Vorher verglich jeder Prozess Zeitstempel mit seiner EIGENEN Uhr. NAS und
 * Entwicklungsrechner teilen aber nur die Datenbank, nicht die Uhr: läuft die
 * eine mehr als die TTL vor (Aufzeichner: 180 s, Verlängerung alle 60 s, also
 * ab rund zwei Minuten NTP-Drift), hält sie jede fremde Führung für abgelaufen
 * und übernimmt sie mitten in einer laufenden Aufzeichnung — zwei Sockets,
 * letzter Schreiber gewinnt. Die Datenbank ist die einzige gemeinsame Uhr, die
 * beide Maschinen sicher haben.
 *
 * SQLite rechnet nur sekundengenau; bei Fristen von Minuten ist das belanglos,
 * und im SQLite-Betrieb läuft ohnehin nur ein Prozess.
 */
function jetztSql(knex) {
    return knex.client.config.client === 'pg'
        ? '(EXTRACT(EPOCH FROM now()) * 1000)::bigint'
        : "(CAST(strftime('%s', 'now') AS INTEGER) * 1000)"
}

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

        const nun = jetztSql(knex)
        const treffer = await knex('radar_fetch_state')
            .where('key', key)
            .andWhereRaw(`fetchedAt < ${nun} - ?`, [ttlMs])
            .update({ fetchedAt: knex.raw(nun), claimedBy: INSTANZ_ID, updatedAt: knex.raw(nun) })

        return treffer === 1
    } catch (e) {
        // SQLITE_BUSY oder ein Verbindungsabriss: dann eben nicht beansprucht.
        // Lieber ein Lauf zu wenig als zwei gleichzeitig.
        logWarn('db-claim', `Anspruch auf "${key}" fehlgeschlagen: ${e.message}`)
        return false
    }
}

/**
 * Anspruch für eine Aufgabe, die EINMAL AM TAG gelingen soll.
 *
 * `beansprucheAufgabe` mit rollender Frist reicht dafür nicht, und das ist
 * teuer aufgefallen: Der Lagebericht lief mit 20 Stunden Abstand. Ein abends
 * von Hand erzeugter Bericht schob die Frist damit über den Mittagslauf des
 * Folgetags — und weil der Stempel VOR der Arbeit gesetzt wird, sperrte auch
 * jeder gescheiterte Versuch die vollen 20 Stunden. Ergebnis: einen ganzen Tag
 * kein Bericht, ohne eine einzige Meldung.
 *
 * Hier zählt deshalb der Kalendertag, nicht ein Zeitabstand:
 *   - noch kein Lauf heute                                   → darf laufen
 *   - letzter Lauf heute ist GESCHEITERT und `wiederholungMs`
 *     ist seither vergangen                                  → darf nochmal
 *   - sonst                                                  → fertig für heute
 *
 * Ob der letzte Lauf scheiterte, steht in `lastError` — gesetzt von
 * `merkeAufgabenFehler`, geleert bei Erfolg. Beides bleibt ein einziges
 * bedingtes UPDATE, damit NAS und Entwicklungsrechner sich nicht in die Quere
 * kommen.
 *
 * @param {string} key
 * @param {{tagesbeginn: number, wiederholungMs?: number}} opt
 *        `tagesbeginn` in der Zeitzone des Journals, nicht der des Servers.
 */
export async function beansprucheTagesaufgabe(key, { tagesbeginn, wiederholungMs = 60 * 60 * 1000 } = {}) {
    const jetzt = Date.now()
    try {
        const knex = getKnex()
        await knex('radar_fetch_state').insert({ key, fetchedAt: 0, updatedAt: jetzt })
            .onConflict('key').ignore()

        const nun = jetztSql(knex)
        const treffer = await knex('radar_fetch_state')
            .where('key', key)
            .andWhere(function () {
                // Die Tagesgrenze kommt bewusst weiter von aussen: sie gilt in
                // der Zeitzone des Journals, nicht in der der Datenbank.
                this.where('fetchedAt', '<', tagesbeginn)
                    .orWhere(function () {
                        this.whereNotNull('lastError')
                            .andWhereNot('lastError', '')
                            .andWhereRaw(`fetchedAt < ${nun} - ?`, [wiederholungMs])
                    })
            })
            .update({ fetchedAt: knex.raw(nun), claimedBy: INSTANZ_ID, updatedAt: knex.raw(nun) })

        return treffer === 1
    } catch (e) {
        logWarn('db-claim', `Tages-Anspruch auf "${key}" fehlgeschlagen: ${e.message}`)
        return false
    }
}

/**
 * Anspruch zurückgeben, ohne ihn zu verbrauchen.
 *
 * Für den Fall „es gab schlicht nichts zu tun" (keine Quellen, keine neuen
 * Beiträge): Das ist kein Fehler, soll aber den Tag nicht verbrennen — sobald
 * Material da ist, darf der nächste Takt es versuchen.
 */
export async function gibAufgabeFrei(key) {
    try {
        await getKnex()('radar_fetch_state')
            .where({ key, claimedBy: INSTANZ_ID })
            .update({ fetchedAt: 0, lastError: '', updatedAt: Date.now() })
    } catch (e) {
        logWarn('db-claim', `Freigabe von "${key}" fehlgeschlagen: ${e.message}`)
    }
}

/**
 * Ergebnis eines Laufs vermerken. Leerer Text = gelungen.
 *
 * Der Text ist doppelt nützlich: `beansprucheTagesaufgabe` liest ihn, um einen
 * Wiederholungsversuch zu erlauben, und die Oberfläche zeigt ihn an. Ein
 * stiller Fehlschlag war der eigentliche Schaden am alten Aufbau.
 */
export async function merkeAufgabenFehler(key, text = '') {
    try {
        await getKnex()('radar_fetch_state')
            .where('key', key)
            .update({ lastError: String(text).slice(0, 500), updatedAt: Date.now() })
    } catch (e) {
        logWarn('db-claim', `Fehlervermerk für "${key}" fehlgeschlagen: ${e.message}`)
    }
}

/**
 * Aufgabe als „jetzt erledigt" stempeln.
 *
 * Nötig, weil ein Lauf von Hand denselben Tag abschliessen soll wie der
 * automatische — sonst käme mittags ein zweiter Bericht über dieselben
 * Beiträge, obwohl gerade eben einer erzeugt wurde.
 */
export async function stempleAufgabe(key) {
    try {
        const knex = getKnex()
        const nun = jetztSql(knex)
        await knex('radar_fetch_state').insert({ key, fetchedAt: knex.raw(nun), claimedBy: INSTANZ_ID, updatedAt: knex.raw(nun) })
            .onConflict('key').merge(['fetchedAt', 'claimedBy', 'updatedAt'])
        await knex('radar_fetch_state').where('key', key).update({ lastError: '' })
    } catch (e) {
        logWarn('db-claim', `Stempel für "${key}" fehlgeschlagen: ${e.message}`)
    }
}

/** Stand einer Aufgabe lesen — für die Anzeige. */
export async function leseAufgabenStand(key) {
    try {
        const z = await getKnex()('radar_fetch_state').where('key', key).first()
        return z ? { zeit: Number(z.fetchedAt) || 0, fehler: z.lastError || '' } : null
    } catch {
        return null
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

        const nun = jetztSql(knex)
        const treffer = await knex('radar_fetch_state')
            .where('key', key)
            .andWhere(function () {
                // frei (abgelaufen) ODER bereits von diesem Prozess gehalten
                this.whereRaw(`fetchedAt < ${nun} - ?`, [ttlMs]).orWhere('claimedBy', INSTANZ_ID)
            })
            .update({ fetchedAt: knex.raw(nun), claimedBy: INSTANZ_ID, updatedAt: knex.raw(nun) })

        return treffer === 1
    } catch (e) {
        logWarn('db-claim', `Führung "${key}" fehlgeschlagen: ${e.message}`)
        return false
    }
}

/** Halten verlängern. Liefert false, wenn inzwischen ein anderer die Zeile hat. */
export async function verlaengereFuehrung(key) {
    try {
        const knex = getKnex()
        const nun = jetztSql(knex)
        const treffer = await knex('radar_fetch_state')
            .where({ key, claimedBy: INSTANZ_ID })
            .update({ fetchedAt: knex.raw(nun), updatedAt: knex.raw(nun) })
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
