/**
 * Der Wachhund: beobachtet die Favoriten und schlägt an, wenn sich etwas
 * Wesentliches ändert.
 *
 * Der Anlass ist dokumentiert: der allererste Favorit sah im Lauf-Schnappschuss
 * noch passabel aus (44 000 USD Liquidität) — beim Öffnen der Detailansicht
 * waren es noch 2 400. Zwischen zwei Blicken auf die Seite kann ein Fund
 * sterben; genau diese Lücke schliesst der Takt hier.
 *
 * Drei Teile, bewusst getrennt:
 *   `pruefeRegeln`  rein — alter Stand, neuer Stand, Regeln hinein, Alarme
 *                   heraus. Ohne Netz prüfbar, und die Schwellen sind
 *                   Einstellungen, keine Konstanten.
 *   `wachhundLauf`  holt die Livedaten, wendet die Regeln an, speichert.
 *   Zustellung      in `zustellung.js` — Kanäle sind austauschbar, Regeln
 *                   nicht.
 *
 * Sperrfristen laufen über `beansprucheAufgabe` (DB-weit): ein volatiler
 * Meme-Coin reisst dieselbe Schwelle sonst in jedem Takt, und aus einem
 * Alarm würde eine Sirene. Kritisches darf sich früher wiederholen als
 * Informatives — wer es stumm haben will, schaltet den Favoriten stumm.
 */

import { getKnex } from '../database.js'
import { logWarn } from '../logger.js'
import { beansprucheAufgabe } from '../db-claim.js'
import { dexDetails } from './quellen.js'
import { pruefe, holeGoPlus } from './sicherheit.js'
import { leseEinstellungen } from './einstellungen.js'
import { stelleZu } from './zustellung.js'

/** Vorgabe-Regeln. Alle Schwellen in den Einstellungen änderbar. */
export const STANDARD_ALARM_REGELN = {
    // Preisbewegung seit dem letzten Wachhund-Blick (nicht 24h: der Vergleich
    // mit dem eigenen letzten Stand meldet auch, was zwischen zwei Tagen liegt).
    preisSprungPct: 15,          // ± seit letztem Blick → info
    preisSturz24hPct: 40,        // ± auf Tagessicht → warnung
    liqAbflussPct: 30,           // Liquidität weg seit letztem Blick → kritisch
    // Sicherheits-Nachprüfung: aus bestanden wird verworfen → kritisch.
    sicherheitsIntervallH: 6,
}

/** Sperrfristen je Schwere — kritisch darf früher wieder anschlagen. */
export const SPERRFRIST_MS = {
    kritisch: 60 * 60 * 1000,
    warnung: 4 * 60 * 60 * 1000,
    info: 4 * 60 * 60 * 1000,
}

/** Prozentuale Veränderung, null wenn nicht rechenbar. */
function deltaPct(alt, neu) {
    const a = Number(alt)
    const b = Number(neu)
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null
    return ((b - a) / Math.abs(a)) * 100
}

/**
 * Die Regeln — rein.
 *
 * @param {object} fav      Favorit (symbol, …)
 * @param {object} alt      letzter Stand {preis, liq, ts} oder leer
 * @param {object} neu      frische Marktdaten aus dexDetails().markt
 * @param {object} sichAlt  letzter Sicherheitsstand {status, grund} oder leer
 * @param {object} sichNeu  neues Urteil aus pruefe() oder null (nicht geprüft)
 * @param {object} regeln   Schwellen
 * @returns {Array<{regel:string, schwere:string, meldung:string, daten:object}>}
 */
export function pruefeRegeln(fav, alt = {}, neu = {}, sichAlt = {}, sichNeu = null, regeln = STANDARD_ALARM_REGELN) {
    const r = { ...STANDARD_ALARM_REGELN, ...(regeln || {}) }
    const alarme = []
    const s = fav?.symbol || '?'

    // ── Preis seit letztem Blick ────────────────────────────────────────
    const dPreis = deltaPct(alt.preis, neu.preisUsd)
    if (dPreis !== null && Math.abs(dPreis) >= r.preisSprungPct) {
        alarme.push({
            regel: 'preisSprung',
            schwere: 'info',
            meldung: `${s}: Preis ${dPreis > 0 ? '+' : ''}${dPreis.toFixed(0)} % seit dem letzten Blick`,
            daten: { vorher: alt.preis, nachher: neu.preisUsd, pct: Math.round(dPreis) },
        })
    }

    // ── Preis auf Tagessicht ────────────────────────────────────────────
    const d24 = Number(neu.aenderung24h)
    if (Number.isFinite(d24) && Math.abs(d24) >= r.preisSturz24hPct) {
        alarme.push({
            regel: 'preis24h',
            schwere: 'warnung',
            meldung: `${s}: ${d24 > 0 ? '+' : ''}${d24.toFixed(0)} % in 24 Stunden`,
            daten: { pct: Math.round(d24) },
        })
    }

    // ── Liquidität ──────────────────────────────────────────────────────
    // Nur der ABFLUSS ist ein Alarm. Zufluss ist erfreulich, aber kein
    // Handlungsdruck — und genau dafür sind Alarme da.
    const dLiq = deltaPct(alt.liq, neu.liquiditaetUsd)
    if (dLiq !== null && dLiq <= -r.liqAbflussPct) {
        alarme.push({
            regel: 'liqAbfluss',
            schwere: 'kritisch',
            meldung: `${s}: Liquidität ${dLiq.toFixed(0)} % — von ${Math.round(alt.liq)} auf ${Math.round(neu.liquiditaetUsd)} USD`,
            daten: { vorher: Math.round(alt.liq), nachher: Math.round(neu.liquiditaetUsd), pct: Math.round(dLiq) },
        })
    }

    // ── Sicherheit ──────────────────────────────────────────────────────
    // Kritisch ist der ÜBERGANG: eben noch in Ordnung, jetzt verworfen. Wer
    // einen bereits verworfenen Fund anheftet, weiss das — ihn in jedem Takt
    // erneut zu alarmieren wäre Lärm ohne Neuigkeit.
    if (sichNeu && sichNeu.status === 'verworfen' && sichAlt?.status !== 'verworfen') {
        alarme.push({
            regel: 'sicherheit',
            schwere: 'kritisch',
            meldung: `${s}: Sicherheitsprüfung schlägt jetzt fehl — ${sichNeu.grund}`,
            daten: { vorher: sichAlt?.status || 'unbekannt', grund: sichNeu.grund, hinweise: sichNeu.hinweise || [] },
        })
    }

    return alarme
}

const sicherJson = (text, rueckfall) => {
    try { return JSON.parse(text) ?? rueckfall } catch { return rueckfall }
}

/**
 * Ein Wachhund-Durchgang über alle nicht stummen Favoriten.
 *
 * @returns {Promise<{geprueft:number, ausgeloest:number}>}
 */
export async function wachhundLauf() {
    const knex = getKnex()
    const einst = await leseEinstellungen()
    const regeln = { ...STANDARD_ALARM_REGELN, ...(einst.alarmRegeln || {}) }
    const favoriten = await knex('hype_favoriten').select('*')
    if (!favoriten.length) return { geprueft: 0, ausgeloest: 0 }

    let ausgeloest = 0
    const jetzt = Date.now()

    for (const fav of favoriten) {
        try {
            if (!fav.contractAddress) continue
            const details = await dexDetails(fav.contractAddress)
            if (!details?.markt) continue
            const neu = details.markt

            const alt = sicherJson(fav.letzteDaten, {})
            const sichAlt = sicherJson(fav.sicherheitsStand, {})

            /*
             * Sicherheits-Nachprüfung nur im eigenen, langsameren Takt: die
             * Vertragsseite ändert sich über Stunden, nicht über Minuten, und
             * GoPlus/RugCheck sollen nicht in jedem Marktblick mitlaufen.
             */
            let sichNeu = null
            const sichAlter = Number(sichAlt.geprueftAm) || 0
            if (jetzt - sichAlter >= regeln.sicherheitsIntervallH * 3600 * 1000) {
                try {
                    const rohdaten = await holeGoPlus(fav.chain, fav.contractAddress)
                    const urteil = pruefe(rohdaten, neu, einst.sicherheit)
                    sichNeu = { status: urteil.status, grund: urteil.grund, hinweise: urteil.hinweise }
                } catch (e) {
                    logWarn('hype-wachhund', `Sicherheits-Nachprüfung ${fav.symbol}: ${e.message}`)
                }
            }

            const alarme = fav.stumm ? [] : pruefeRegeln(fav, alt, neu, sichAlt, sichNeu, regeln)

            for (const a of alarme) {
                /*
                 * Sperrfrist je Favorit UND Regel, über die Datenbank: der
                 * NAS-Container und der Entwicklungsrechner takten beide, und
                 * derselbe Abfluss soll genau einmal gemeldet werden.
                 */
                const frist = SPERRFRIST_MS[a.schwere] || SPERRFRIST_MS.info
                if (!(await beansprucheAufgabe(`hypal|${fav.id}|${a.regel}`, frist))) continue

                await knex('hype_alarme').insert({
                    favoritId: fav.id,
                    regel: a.regel,
                    schwere: a.schwere,
                    meldung: a.meldung,
                    daten: JSON.stringify(a.daten || {}),
                    erstelltAm: jetzt,
                })
                ausgeloest++
                // Zustellung nach dem Speichern: die In-App-Liste ist der
                // Kanal, der nie ausfallen kann — was dort steht, ist gemeldet.
                await stelleZu(a, fav, einst).catch((e) =>
                    logWarn('hype-wachhund', `Zustellung ${fav.symbol}/${a.regel}: ${e.message}`))
            }

            // Vergleichsbasis fortschreiben — auch bei stummen Favoriten,
            // sonst schlägt nach dem Entstummen alles auf einmal an.
            const stand = {
                preis: neu.preisUsd,
                liq: neu.liquiditaetUsd,
                vol24: neu.volumen24h,
                ts: jetzt,
            }
            const sichStand = sichNeu
                ? { ...sichNeu, geprueftAm: jetzt }
                : sichAlt
            await knex('hype_favoriten').where('id', fav.id).update({
                letzteDaten: JSON.stringify(stand),
                sicherheitsStand: JSON.stringify(sichStand),
            })
        } catch (e) {
            logWarn('hype-wachhund', `${fav.symbol}: ${e.message}`)
        }
    }

    return { geprueft: favoriten.length, ausgeloest }
}
