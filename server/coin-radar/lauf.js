/**
 * Coin-Radar, der Lauf: vom Universum zur Rangfolge.
 *
 * Der Zustand steht in der Datenbank, nicht im Speicher — ein Lauf dauert
 * Minuten und muss einen Neustart überleben. Dasselbe Muster wie bei der
 * Coin-Rangliste, aus demselben Grund; die Wiederaufnahme hängt an
 * `unique(laufId, symbol)`: „was fehlt noch" heisst „welches Symbol hat noch
 * keine Zeile".
 *
 * Die Reihenfolge der Stufen ist der eigentliche Entwurf:
 *
 *   1. Universum — nur was auf Bitunix handelbar UND bei Binance messbar ist
 *   2. Marktweite Hürden — drei Abrufe für alle, Umsatz und Spread sieben aus
 *   3. Kerzen und Kennzahlen — nur noch für die Übriggebliebenen
 *   4. Bewertung und Rangfolge
 *   5. Beharrlichkeit gegen den Vorlauf
 *
 * Stufe 2 vor Stufe 3 ist keine Sparmassnahme, sondern der Grund, warum ein
 * Lauf über sechshundert Coins in einer Minute durch ist statt in zwanzig.
 */

import { getKnex } from '../database.js'
import { logWarn } from '../logger.js'
import { holeHandelbar, holeTestbar } from '../coin-universum.js'
import { holeMarktweit, holeKerzenGebremst } from './daten.js'
import { rechneAlle, fundingJahresRate } from './kennzahlen.js'
import {
    bewerte, pruefeHuerden, vergibRaenge, rangkorrelation,
    STANDARD_GEWICHTE, STANDARD_HUERDEN,
} from './bewertung.js'

/**
 * Obergrenze der zu vermessenden Coins.
 *
 * Nicht aus Angst vor der Rechenzeit, sondern weil eine Rangliste mit
 * dreihundert Einträgen niemand liest — und weil jeder weitere Coin Gewicht
 * kostet, das die Handels-Engine gebrauchen könnte. Sortiert wird vorher nach
 * Umsatz: was ganz unten liegt, war ohnehin nie ein Kandidat.
 */
const MAX_VERMESSEN = 200

/**
 * Einen Lauf durchführen.
 *
 * @param {object} lauf   Zeile aus `coinradar_laeufe`
 * @param {object} einst  Einstellungen
 * @param {function} melde Fortschritt
 * @param {function} abbruch  liefert true, wenn abgebrochen werden soll
 */
export async function fuehreLaufAus(lauf, einst, melde = () => {}, abbruch = () => false) {
    const knex = getKnex()
    const jetzt = Date.now()
    const zeiteinheiten = einst.zeiteinheiten?.length ? einst.zeiteinheiten : ['1h', '15m']
    const haupt = zeiteinheiten[0]

    // ── Stufe 1: Universum ──────────────────────────────────────────────
    melde({ schritt: 'universum' })
    const [handelbar, testbar] = await Promise.all([holeHandelbar(), holeTestbar()])
    /*
     * Die Schnittmenge, nicht die Vereinigung: Ein Coin, den Bitunix führt,
     * bei Binance aber keine Kerzen hat, lässt sich nicht bewerten. Und einer
     * mit Kerzen, den Bitunix nicht führt, nützt hier nichts — gehandelt wird
     * auf Bitunix.
     */
    const universum = [...handelbar.keys()].filter((s) => testbar.has(s))
    melde({ schritt: 'universum', anzahl: universum.length })

    // ── Stufe 2: marktweite Hürden ──────────────────────────────────────
    melde({ schritt: 'marktweit' })
    const { jeSymbol, quellenStand } = await holeMarktweit()
    const huerden = { ...STANDARD_HUERDEN, ...(einst.huerden || {}) }

    const anwaerter = []
    const gescheitert = []
    for (const symbol of universum) {
        const roh = jeSymbol.get(symbol)
        if (!roh) {
            gescheitert.push({ symbol, grund: 'keine_marktdaten', roh: {} })
            continue
        }
        const urteil = pruefeHuerden(roh, huerden)
        if (urteil.ok) anwaerter.push({ symbol, roh })
        else gescheitert.push({ symbol, grund: urteil.grund, roh })
    }

    // Nach Umsatz absteigend — wer gedeckelt wird, ist der unbedeutendste.
    anwaerter.sort((a, b) => (b.roh.umsatz24h || 0) - (a.roh.umsatz24h || 0))
    const vermessen = anwaerter.slice(0, MAX_VERMESSEN)

    melde({
        schritt: 'gesiebt',
        anzahl: vermessen.length,
        verworfen: gescheitert.length,
        gesamt: universum.length,
    })

    await knex('coinradar_laeufe').where('id', lauf.id).update({
        status: 'laeuft',
        geprueft: universum.length,
        verworfenHuerde: gescheitert.length,
        gesamt: vermessen.length,
        quellenStand: JSON.stringify(quellenStand),
    })

    // Die an der Hürde Gescheiterten sofort ablegen — sie sind fertig, und
    // die Wiederaufnahme soll sie nicht erneut durchgehen.
    await schreibeZeilen(knex, lauf.id, gescheitert.map((g) => ({
        laufId: lauf.id,
        symbol: g.symbol,
        status: 'huerde',
        huerdeGrund: g.grund,
        umsatz24h: g.roh.umsatz24h || 0,
        spreadBp: Number.isFinite(g.roh.spreadBp) ? g.roh.spreadBp : 0,
        tiefeUsd: g.roh.tiefeUsd || 0,
        erstelltAm: jetzt,
    })))

    // ── Stufe 3: Kerzen und Kennzahlen ──────────────────────────────────
    // Bereits vermessene Symbole überspringen (Wiederaufnahme nach Neustart).
    const fertig = new Set((await knex('coinradar_zeilen')
        .select('symbol').where({ laufId: lauf.id, status: 'bewertet' })).map((z) => z.symbol))
    const offen = vermessen.filter((a) => !fertig.has(a.symbol))

    const kerzenJeZe = {}
    for (const ze of zeiteinheiten) {
        if (abbruch()) return { abgebrochen: true }
        melde({ schritt: 'kerzen', zeiteinheit: ze, gesamt: offen.length })
        kerzenJeZe[ze] = await holeKerzenGebremst(
            offen.map((a) => a.symbol), ze,
            (f) => melde({ schritt: 'kerzen', zeiteinheit: ze, ...f }),
        )
    }

    // ── Stufe 4: Bewertung ──────────────────────────────────────────────
    melde({ schritt: 'bewerten', gesamt: offen.length })
    const gewichte = { ...STANDARD_GEWICHTE, ...(einst.gewichte || {}) }
    const zeilen = []

    for (const [i, a] of offen.entries()) {
        if (abbruch()) return { abgebrochen: true }
        try {
            const kerzen = {}
            for (const ze of zeiteinheiten) {
                const k = kerzenJeZe[ze]?.get(a.symbol)
                if (k) kerzen[ze] = k
            }
            const ze = rechneAlle(kerzen)

            /*
             * Ohne Kerzen auf der Hauptzeiteinheit keine Bewertung. Das als
             * Hürde zu führen wäre falsch — der Coin ist nicht illiquide,
             * es fehlen bloss die Daten. Ein eigener Grund macht das sichtbar.
             */
            if (!ze[haupt] || ze[haupt].atrPct === null) {
                zeilen.push({
                    laufId: lauf.id, symbol: a.symbol, status: 'huerde',
                    huerdeGrund: 'keine_kerzen',
                    umsatz24h: a.roh.umsatz24h || 0,
                    spreadBp: a.roh.spreadBp || 0,
                    tiefeUsd: a.roh.tiefeUsd || 0,
                    erstelltAm: jetzt,
                })
                continue
            }

            const jahresRate = fundingJahresRate(a.roh.fundingRate, 8)
            const b = bewerte({ ...a.roh, fundingJahresRate: jahresRate }, ze, gewichte, haupt)

            zeilen.push({
                laufId: lauf.id,
                symbol: a.symbol,
                status: 'bewertet',
                note: b.note,
                umsatz24h: a.roh.umsatz24h || 0,
                spreadBp: a.roh.spreadBp || 0,
                tiefeUsd: a.roh.tiefeUsd || 0,
                fundingJahresRate: jahresRate ?? 0,
                atrPct: ze[haupt].atrPct ?? 0,
                rvol: ze[haupt].rvol ?? 0,
                adx: ze[haupt].adx ?? 0,
                jeZeiteinheit: JSON.stringify({ ...ze, hinweise: b.hinweise, bestaetigt: b.bestaetigt }),
                teilnoten: JSON.stringify(b.teilnoten),
                erstelltAm: jetzt,
            })
        } catch (e) {
            // Ein Coin darf den Lauf nicht mitreissen.
            logWarn('coin-radar', `${a.symbol}: ${e.message}`)
        }
        if ((i + 1) % 20 === 0) melde({ schritt: 'bewerten', fertig: i + 1, gesamt: offen.length })
    }

    vergibRaenge(zeilen)
    await schreibeZeilen(knex, lauf.id, zeilen)

    // ── Stufe 5: Beharrlichkeit ─────────────────────────────────────────
    const vergleich = await beharrlichkeit(knex, lauf.id, zeilen)

    await knex('coinradar_laeufe').where('id', lauf.id).update({
        status: 'fertig',
        beendetAm: Date.now(),
        fortschritt: zeilen.length,
        rangkorrelation: vergleich.wert ?? 0,
        vergleichslauf: vergleich.laufId || 0,
    })

    melde({ schritt: 'fertig', bewertet: zeilen.filter((z) => z.status === 'bewertet').length })
    return {
        bewertet: zeilen.filter((z) => z.status === 'bewertet').length,
        verworfen: gescheitert.length,
        quellenStand,
        rangkorrelation: vergleich,
    }
}

/**
 * Zeilen in Stücken schreiben — SQLite deckelt die Platzhalter je Anweisung.
 * `onConflict().merge()` macht den Schreibvorgang wiederholbar.
 */
async function schreibeZeilen(knex, laufId, zeilen) {
    for (let i = 0; i < zeilen.length; i += 25) {
        await knex('coinradar_zeilen')
            .insert(zeilen.slice(i, i + 25))
            .onConflict(['laufId', 'symbol'])
            .merge()
    }
}

/**
 * Sagt der vorige Lauf diesen voraus?
 *
 * Verglichen wird mit dem letzten FERTIGEN Lauf — ein abgebrochener hat eine
 * halbe Rangfolge, und die zu vergleichen ergäbe eine Zahl, die nur aussagt,
 * wie weit er gekommen ist.
 */
async function beharrlichkeit(knex, laufId, neueZeilen) {
    try {
        const vorher = await knex('coinradar_laeufe')
            .where('status', 'fertig').andWhere('id', '<', laufId)
            .orderBy('id', 'desc').first()
        if (!vorher) return { wert: null, gemeinsam: 0, laufId: 0 }

        const alt = await knex('coinradar_zeilen')
            .select('symbol', 'rang').where({ laufId: vorher.id, status: 'bewertet' })
        const r = rangkorrelation(alt, neueZeilen)
        return { ...r, laufId: vorher.id }
    } catch (e) {
        logWarn('coin-radar', `Beharrlichkeit nicht rechenbar: ${e.message}`)
        return { wert: null, gemeinsam: 0, laufId: 0 }
    }
}
