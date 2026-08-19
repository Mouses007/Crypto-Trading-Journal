/**
 * Erfolgskontrolle beider Radare: was aus den Funden wirklich wurde.
 *
 * Der ehrlichste Wert des Coin-Radars war bisher die Rangkorrelation zum
 * Vorlauf. Sie misst aber BEHARRLICHKEIT, nicht Nutzen — eine stabile
 * Rangfolge kann stabil falsch sein. Gewichte, Anker und Schwellen beruhen bis
 * heute auf plausiblen Regeln und Querschnittsmessungen; ob die Note etwas
 * vorhersagt, hat nie jemand geprüft.
 *
 * Zwei getrennte Schritte, und die Trennung ist Absicht:
 *
 *   `legeAn()`   schreibt beim Lauf fest, WAS behauptet wurde — Rang, Note,
 *                Preis. Eingefroren, damit ein späterer Gewichtswechsel die
 *                Vergangenheit nicht umschreibt.
 *   `messeFaellige()`  löst die Aufträge ein, wenn ihre Zeit gekommen ist.
 *
 * Was hier NICHT passiert: eine Optimierung der Gewichte auf denselben
 * Zeitraum. Das wäre die bequemste Art, sich selbst zu belügen — die Auswertung
 * liefert Zahlen, die Entscheidung bleibt beim Menschen.
 */

import { getKnex } from './database.js'
import { logWarn } from './logger.js'
import { getClosedCandles } from './market-data.js'
import { beansprucheAufgabe } from './db-claim.js'

/**
 * Wann gemessen wird.
 *
 * Coin-Radar kurz, Hype-Radar lang — die beiden beantworten verschiedene
 * Fragen. „Lässt sich der Coin heute handeln" entscheidet sich in Stunden;
 * „hat das Projekt Substanz" in Wochen.
 */
export const HORIZONTE = {
    coinradar: { '15m': 15 * 60e3, '1h': 3600e3, '4h': 4 * 3600e3 },
    hype: { '1d': 24 * 3600e3, '7d': 7 * 24 * 3600e3, '30d': 30 * 24 * 3600e3 },
}

/** Wie viele Spitzenplätze je Lauf verfolgt werden. */
const VERFOLGT = 20

/**
 * Aufträge für einen Coin-Radar-Lauf anlegen.
 *
 * Nur die obersten zwanzig: Die Frage ist „taugt die SPITZE der Liste", nicht
 * „was macht Platz 78". Precision@10 und @20 sind die Kennzahlen, die zählen —
 * wer den ganzen Lauf verfolgt, misst vor allem den Markt.
 */
export async function legeAnCoinRadar(laufId) {
    const knex = getKnex()
    const zeilen = await knex('coinradar_zeilen')
        .where({ laufId, status: 'bewertet' })
        .orderBy('rang', 'asc').limit(VERFOLGT)
    if (!zeilen.length) return 0

    const jetzt = Date.now()
    const auftraege = []
    for (const z of zeilen) {
        for (const [horizont, ms] of Object.entries(HORIZONTE.coinradar)) {
            auftraege.push({
                art: 'coinradar',
                laufId,
                symbol: z.symbol,
                rang: z.rang,
                note: z.note,
                noteAusfuehrung: z.noteAusfuehrung,
                horizont,
                erstelltAm: jetzt,
                faelligAm: jetzt + ms,
                status: 'offen',
            })
        }
    }
    return schreibe(knex, auftraege)
}

/** Dasselbe für die Funde des Hype-Radars, die die Sicherheitsprüfung bestanden. */
export async function legeAnHype(erstelltAm) {
    const knex = getKnex()
    const zeilen = await knex('hype_candidates')
        .where('erstelltAm', Number(erstelltAm))
        .whereIn('status', ['bestanden', 'berichtet'])
        .orderBy('hypeScore', 'desc').limit(VERFOLGT)
    if (!zeilen.length) return 0

    const jetzt = Date.now()
    const auftraege = []
    for (const z of zeilen) {
        let markt = {}
        try { markt = JSON.parse(z.marktDaten || '{}') } catch { /* egal */ }
        for (const [horizont, ms] of Object.entries(HORIZONTE.hype)) {
            auftraege.push({
                art: 'hype',
                laufId: 0,
                symbol: z.symbol,
                chain: z.chain || '',
                contract: z.contractAddress || '',
                note: z.hypeScore,
                safetyScore: z.safetyScore,
                horizont,
                erstelltAm: jetzt,
                faelligAm: jetzt + ms,
                status: 'offen',
                preisStart: zahl(markt.preisUsd),
                liquiditaetStart: zahl(markt.liquiditaetUsd),
            })
        }
    }
    return schreibe(knex, auftraege)
}

async function schreibe(knex, auftraege) {
    for (let i = 0; i < auftraege.length; i += 25) {
        await knex('radar_ergebnisse').insert(auftraege.slice(i, i + 25))
            .onConflict(['art', 'laufId', 'symbol', 'horizont']).ignore()
    }
    return auftraege.length
}

const zahl = (w) => (Number.isFinite(Number(w)) && w !== null ? Number(w) : null)

/**
 * Fällige Aufträge einlösen.
 *
 * @param {number} deckel  höchstens so viele je Durchgang — der Takt soll
 *                         kurz sein, nicht vollständig.
 */
export async function messeFaellige(deckel = 30) {
    const knex = getKnex()
    const faellig = await knex('radar_ergebnisse')
        .where('status', 'offen')
        .andWhere('faelligAm', '<=', Date.now())
        .orderBy('faelligAm', 'asc').limit(deckel)
    if (!faellig.length) return { gemessen: 0, fehlgeschlagen: 0 }

    let gemessen = 0
    let fehlgeschlagen = 0
    for (const a of faellig) {
        try {
            const werte = a.art === 'coinradar'
                ? await messeCoin(a)
                : await messeHype(a)
            await knex('radar_ergebnisse').where('id', a.id).update({
                ...werte, status: 'gemessen', gemessenAm: Date.now(),
            })
            gemessen++
        } catch (e) {
            /*
             * Ein Fehlschlag wird VERMERKT, nicht wiederholt. Sonst hinge ein
             * delistetes Symbol für immer in der Warteschlange und verdrängte
             * die Messungen, auf die es ankommt.
             */
            await knex('radar_ergebnisse').where('id', a.id).update({
                status: 'fehlgeschlagen', gemessenAm: Date.now(),
                fehler: String(e.message).slice(0, 200),
            }).catch(() => {})
            fehlgeschlagen++
        }
    }
    return { gemessen, fehlgeschlagen }
}

/**
 * Coin-Radar: Rendite, MAE und MFE aus den Kerzen seit der Aussage.
 *
 * MAE und MFE sind wichtiger als die blosse Rendite. Ein Coin, der erst 8 %
 * gegen einen läuft und dann 2 % ins Plus dreht, ist ein anderes Geschäft als
 * einer, der schnurgerade 2 % steigt — und nur die eine Zahl unterscheidet die
 * beiden nicht.
 */
async function messeCoin(a) {
    const spanne = Date.now() - Number(a.erstelltAm)
    // Feine Auflösung für kurze Horizonte, gröbere für lange.
    const ze = spanne <= 2 * 3600e3 ? '1m' : (spanne <= 8 * 3600e3 ? '5m' : '15m')
    const kerzen = await getClosedCandles(a.symbol, ze, 500)
    if (!Array.isArray(kerzen) || !kerzen.length) throw new Error('keine Kerzen')

    const seit = kerzen.filter((k) => Number(k.t) >= Number(a.erstelltAm))
    if (seit.length < 2) throw new Error('zu wenige Kerzen seit der Aussage')

    const start = Number(seit[0].o)
    const ende = Number(seit[seit.length - 1].c)
    if (!(start > 0)) throw new Error('kein Startpreis')

    const hoch = Math.max(...seit.map((k) => Number(k.h)))
    const tief = Math.min(...seit.map((k) => Number(k.l)))

    return {
        preisStart: start,
        preisEnde: ende,
        renditePct: ((ende - start) / start) * 100,
        mfePct: ((hoch - start) / start) * 100,
        maePct: ((tief - start) / start) * 100,
        nochHandelbar: 1,
    }
}

/** Hype-Radar: lebt der Fund noch, und was ist aus Preis und Liquidität geworden? */
async function messeHype(a) {
    if (!a.contract) throw new Error('keine Vertragsadresse')
    const { dexDetails } = await import('./hype-radar/quellen.js')
    const d = await dexDetails(a.contract)
    if (!d?.markt) {
        /*
         * Kein Paar mehr — das ist keine fehlgeschlagene Messung, sondern das
         * härteste Ergebnis, das es gibt: der Fund ist weg.
         */
        return { nochHandelbar: 0, preisEnde: null, liquiditaetEnde: 0 }
    }
    const start = zahl(a.preisStart)
    const ende = zahl(d.markt.preisUsd)
    return {
        preisEnde: ende,
        renditePct: start > 0 && ende !== null ? ((ende - start) / start) * 100 : null,
        liquiditaetEnde: zahl(d.markt.liquiditaetUsd),
        nochHandelbar: (Number(d.markt.liquiditaetUsd) || 0) > 0 ? 1 : 0,
    }
}

/**
 * Der Takt. Alle fünf Minuten nachsehen, ob etwas fällig ist.
 *
 * Der DB-Anspruch verhindert wie überall den Doppellauf von NAS und
 * Entwicklungsrechner — zwei Prozesse würden dieselben Aufträge messen und
 * einander die Ergebnisse überschreiben.
 */
export function startErgebnisTakt() {
    const TAKT_MS = 5 * 60 * 1000
    let laeuft = false

    const uhr = setInterval(async () => {
        if (laeuft) return
        try {
            if (!(await beansprucheAufgabe('radar_ergebnisse', TAKT_MS - 30000))) return
            laeuft = true
            const { gemessen, fehlgeschlagen } = await messeFaellige()
            if (gemessen || fehlgeschlagen) {
                console.log(` -> Radar-Erfolgskontrolle: ${gemessen} gemessen, ${fehlgeschlagen} fehlgeschlagen`)
            }
        } catch (e) {
            logWarn('radar-ergebnisse', `Takt: ${e.message}`)
        } finally {
            laeuft = false
        }
    }, TAKT_MS)

    uhr.unref?.()
    return () => clearInterval(uhr)
}
