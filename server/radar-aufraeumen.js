/**
 * Aufbewahrungsgrenze für die Radar-Tabellen.
 *
 * Der Coin-Radar schrieb seit seiner Einführung nur — gelöscht wurde nie. An
 * der Live-Postgres gemessen (28.08.2026): `coinradar_zeilen` 1 293 052 Zeilen
 * und 710 MB über 9,1 Tage, also rund 78 MB am Tag. Das ist das 900-fache der
 * `trades`-Tabelle, um die es in diesem Journal eigentlich geht — und weil
 * NAS-Container und Entwicklungsrechner sich EINE Datenbank teilen, geht der
 * Puffer-Cache, den diese Zeilen belegen, dem Journal ab.
 *
 * ZWEI STUFEN, weil die Zeilen ungleich wertvoll sind:
 *
 *   Verworfene Zeilen (`status = 'huerde'`) sind die Masse. Ein Lauf prüft
 *   das ganze Universum und behält davon einen Bruchteil; der Rest ist die
 *   Begründung „warum nicht", und die interessiert nur solange, wie jemand
 *   den Lauf noch anschaut. Wenige Tage.
 *
 *   Bewertete Zeilen tragen die Beständigkeits-Anzeige und `/dauerhaft`
 *   („wie oft stand dieser Coin in den Top 10"). Sie müssen lange genug
 *   liegen, dass diese Aussage etwas wert ist — aber nicht ewig.
 *
 * Die Güte-Messung selbst braucht die Zeilen nur Stunden: die
 * Coin-Radar-Horizonte sind 15m/1h/4h (`radar-ergebnisse.js`). Sie ist also
 * nie der begrenzende Faktor.
 *
 * Läufe werden erst gelöscht, wenn keine Zeile mehr auf sie zeigt — sonst
 * bleiben Zeilen ohne Lauf zurück, und der Join in `/dauerhaft` verliert sie
 * stillschweigend.
 */
import { getKnex } from './database.js'
import { logWarn } from './logger.js'

const TAG_MS = 24 * 3600 * 1000

/** Verworfene Zeilen: nur solange interessant, wie man den Lauf noch ansieht. */
export const VERWORFEN_TAGE = 3
/** Bewertete Zeilen: Grundlage der Beständigkeits-Anzeige. */
export const BEWERTET_TAGE = 90
/** Abgeschlossene Güte-Messungen. */
export const ERGEBNIS_TAGE = 180

/**
 * Einmal aufräumen.
 *
 * Löscht in Blöcken statt in einem Rutsch: der erste Lauf gegen einen
 * gewachsenen Bestand betrifft über eine Million Zeilen, und ein einzelnes
 * DELETE darüber hält die Tabelle für alle anderen Abfragen fest.
 *
 * @param {object} [opt]
 * @param {number} [opt.jetzt]        Zeitpunkt in ms (für den Selbsttest)
 * @param {number} [opt.blockGroesse] Zeilen je DELETE
 * @param {object} [opt.knex]         eigene Verbindung — der Selbsttest gibt eine
 *                                    In-Memory-SQLite herein und prüft damit das
 *                                    echte SQL statt nur die Arithmetik. Eine
 *                                    Routine, die löscht, verdient das.
 * @returns {Promise<{zeilenVerworfen:number, zeilenBewertet:number, ergebnisse:number, laeufe:number}>}
 */
export async function raeumeRadarAuf({ jetzt = Date.now(), blockGroesse = 20000, knex: eigenerKnex } = {}) {
    const knex = eigenerKnex || getKnex()
    const bilanz = { zeilenVerworfen: 0, zeilenBewertet: 0, ergebnisse: 0, laeufe: 0 }

    const loescheInBloecken = async (bauAbfrage) => {
        let gesamt = 0
        for (;;) {
            const ids = (await bauAbfrage().select('id').limit(blockGroesse)).map((r) => r.id)
            if (!ids.length) break
            gesamt += await bauAbfrage().whereIn('id', ids).del()
            if (ids.length < blockGroesse) break
        }
        return gesamt
    }

    try {
        const grenzeVerworfen = jetzt - VERWORFEN_TAGE * TAG_MS
        bilanz.zeilenVerworfen = await loescheInBloecken(() => knex('coinradar_zeilen')
            .whereNot('status', 'bewertet').andWhere('erstelltAm', '<', grenzeVerworfen))

        const grenzeBewertet = jetzt - BEWERTET_TAGE * TAG_MS
        bilanz.zeilenBewertet = await loescheInBloecken(() => knex('coinradar_zeilen')
            .where('status', 'bewertet').andWhere('erstelltAm', '<', grenzeBewertet))

        const grenzeErgebnis = jetzt - ERGEBNIS_TAGE * TAG_MS
        bilanz.ergebnisse = await loescheInBloecken(() => knex('radar_ergebnisse')
            .whereNot('status', 'offen').andWhere('faelligAm', '<', grenzeErgebnis))

        /*
         * Läufe zuletzt und nur die leeren: ein Lauf, auf den noch bewertete
         * Zeilen zeigen, trägt deren Datum und Auslöser. Ihn zu löschen
         * machte die Zeilen unauffindbar, statt Platz zu schaffen.
         */
        bilanz.laeufe = await loescheInBloecken(() => knex('coinradar_laeufe')
            .where('erstelltAm', '<', grenzeVerworfen)
            .whereNotExists(function () {
                // Identifier über ?? binden, damit die Anführungszeichen zu
                // SQLite wie zu PostgreSQL passen.
                this.select('*').from('coinradar_zeilen')
                    .whereRaw('?? = ??', ['coinradar_zeilen.laufId', 'coinradar_laeufe.id'])
            }))
    } catch (e) {
        logWarn('radar-aufraeumen', 'Aufräumen fehlgeschlagen', e)
    }

    return bilanz
}
