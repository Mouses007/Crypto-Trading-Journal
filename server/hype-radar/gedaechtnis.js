/**
 * Das Gedächtnis des Hype-Radars: welcher Vertrag wann zuerst gesehen und
 * wann zuerst gemeldet wurde.
 *
 * Der Börsen-Beobachter fragt bei jeder neuen Listung: „Kannten wir den
 * vorher, und seit wann?" Die Frühphase vergisst nach 72 Stunden Funkstille,
 * Listings kommen oft Wochen später — ohne eigenes Gedächtnis gäbe es auf
 * die wichtigste Frage des Radars keine Antwort.
 *
 * Gespeichert wird nicht alles, was der Radar sieht (das wären Tausende am
 * Tag), sondern was ihm auffiel: Frühphasen-Note ab 40 oder ein bestandener
 * Scan. „Gemeldet" ist strenger: Schwelle überschritten bzw. bestanden.
 */

import { getKnex } from '../database.js'
import { logWarn } from '../logger.js'

/** Ab dieser Frühphasen-Note merkt sich der Radar einen Token. */
export const MERKEN_AB_NOTE = 40

const NIE_GEMELDET_VERGESSEN_MS = 30 * 24 * 3600e3
const GEMELDET_VERGESSEN_MS = 365 * 24 * 3600e3

const normVertrag = (chain, c) => (chain === 'solana' ? String(c || '') : String(c || '').toLowerCase())

/**
 * Token ins Gedächtnis schreiben.
 *
 * `ersterBlick` und `ersteMeldung` werden nie überschrieben — der erste
 * Zeitpunkt ist der, auf den es ankommt. Fortgeschrieben werden nur Symbol,
 * letzter Blick und Bewertung (eine fehlende Bewertung löscht die bekannte
 * nicht). `letzterBlick` heisst „zuletzt AUFFÄLLIG": gemerkt wird nur, wer ab
 * Note 40 steht oder bestanden hat; ein Token, der danach darunter fällt, behält
 * seinen alten Wert, während der Börsen-Beobachter die Bewertung weiter nachträgt.
 *
 * @param {Array<{chain, contract, symbol, quelle, bewertungUsd, gemeldet}>} eintraege
 * @param {number} jetzt  Zeitpunkt des Durchgangs — derselbe, den seine Alarme
 *   tragen. Mit `Date.now()` am Ende des Durchgangs lag die „erste Meldung"
 *   um die Laufzeit NACH dem Alarm (gesehen 10.10.2026 bei CLANKER, zwei Minuten).
 */
export async function merke(eintraege = [], jetzt = Date.now()) {
    const liste = eintraege.filter((e) => e?.chain && e?.contract && e.chain !== '?')
    if (!liste.length) return
    const knex = getKnex()
    try {
        const zeilen = liste.map((e) => ({
            chain: e.chain,
            contract: normVertrag(e.chain, e.contract),
            symbol: String(e.symbol || '').slice(0, 30),
            quelle: e.quelle || '',
            ersterBlick: jetzt,
            ersteMeldung: e.gemeldet ? jetzt : null,
            letzterBlick: jetzt,
            bewertungUsd: Number(e.bewertungUsd) > 0 ? Number(e.bewertungUsd) : null,
        }))
        for (let i = 0; i < zeilen.length; i += 50) {
            await knex('hype_gedaechtnis').insert(zeilen.slice(i, i + 50))
                .onConflict(['chain', 'contract'])
                .merge({
                    symbol: knex.raw('excluded.symbol'),
                    letzterBlick: knex.raw('excluded."letzterBlick"'),
                    bewertungUsd: knex.raw('COALESCE(excluded."bewertungUsd", hype_gedaechtnis."bewertungUsd")'),
                })
        }
        // Erste Meldung nachtragen, wo der Token bisher nur gesehen war.
        const gemeldet = zeilen.filter((z) => z.ersteMeldung)
        for (const z of gemeldet) {
            await knex('hype_gedaechtnis').where({ chain: z.chain, contract: z.contract })
                .whereNull('ersteMeldung').update({ ersteMeldung: jetzt })
        }
        await knex('hype_gedaechtnis').whereNull('ersteMeldung')
            .andWhere('letzterBlick', '<', jetzt - NIE_GEMELDET_VERGESSEN_MS).del()
        await knex('hype_gedaechtnis').where('letzterBlick', '<', jetzt - GEMELDET_VERGESSEN_MS).del()
    } catch (e) {
        logWarn('hype-gedaechtnis', `Schreiben: ${e.message}`)
    }
}

/**
 * Alles, was der Radar über Token weiss — Gedächtnis und Favoriten — in der
 * Form, die `ordneZu` erwartet.
 */
export async function radarWissen() {
    const knex = getKnex()
    const raus = []
    try {
        for (const z of await knex('hype_gedaechtnis').select('*')) {
            raus.push({
                symbol: z.symbol, chain: z.chain, contract: z.contract, quelle: z.quelle,
                ersterBlick: Number(z.ersterBlick) || null, ersteMeldung: Number(z.ersteMeldung) || null,
                bewertungUsd: Number(z.bewertungUsd) || null,
            })
        }
        // Ein Stern ist eine Meldung von Hand — ab dem Tag, an dem er gesetzt wurde.
        for (const f of await knex('hype_favoriten').select('symbol', 'chain', 'contractAddress', 'erstelltAm')) {
            const t = Number(f.erstelltAm) || null
            raus.push({ symbol: f.symbol, chain: f.chain, contract: f.contractAddress, quelle: 'favorit',
                ersterBlick: t, ersteMeldung: t, bewertungUsd: null })
        }
    } catch (e) {
        logWarn('hype-gedaechtnis', `Lesen: ${e.message}`)
    }
    return raus
}
