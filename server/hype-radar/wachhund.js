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
/*
 * Der Börsenpfad borgt sich die Datenbeschaffung des Coin-Radars. Kein Kreis:
 * `coin-radar/daten.js` und `kennzahlen.js` sind reine Beschaffung und
 * Rechnung und importieren nichts aus dem Hype-Radar zurück.
 */
import { holeMarktweit } from '../coin-radar/daten.js'
import { fundingJahresRate } from '../coin-radar/kennzahlen.js'

/** Vorgabe-Regeln. Alle Schwellen in den Einstellungen änderbar. */
export const STANDARD_ALARM_REGELN = {
    // Preisbewegung seit dem letzten Wachhund-Blick (nicht 24h: der Vergleich
    // mit dem eigenen letzten Stand meldet auch, was zwischen zwei Tagen liegt).
    preisSprungPct: 15,          // ± seit letztem Blick → info
    preisSturz24hPct: 40,        // ± auf Tagessicht → warnung
    liqAbflussPct: 30,           // Liquidität weg seit letztem Blick → kritisch
    // Sicherheits-Nachprüfung: aus bestanden wird verworfen → kritisch.
    sicherheitsIntervallH: 6,

    /*
     * Schwellen des Börsenpfads (Coin-Radar-Favoriten). Eigene Werte, weil
     * sie eigene Grössen messen — ein Bitunix-Perp hat keinen Liquiditätspool,
     * der abfliessen könnte.
     */
    umsatzEinbruchPct: 50,       // Umsatz halbiert seit letztem Blick → warnung
    spreadWarnBp: 10,            // Ausführung wird teuer → warnung
    fundingExtremPct: 50,        // Jahresrate, ab hier kostet Halten ernsthaft
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

/**
 * Die Regeln des BÖRSENPFADS — ebenfalls rein.
 *
 * Ein Coin-Radar-Favorit ist ein Bitunix-Symbol ohne Vertragsadresse. Für ihn
 * gibt es kein Handelspaar auf einer dezentralen Börse, keinen
 * Liquiditätspool, der abfliessen könnte, und keine Vertragsseite, die auf
 * Honeypot prüfbar wäre. Die Hälfte der Regeln oben ist auf ihn schlicht
 * nicht anwendbar.
 *
 * Was bleibt, sind die Grössen, die ein handelbares Perp gefährden: Der Preis
 * bewegt sich — dieselbe Frage wie oben, deshalb dieselben Schwellen. Der
 * Umsatz bricht weg, dann wird der Ausstieg teuer. Der Spread geht auf,
 * dasselbe früher. Und das Funding kippt ins Extreme, dann frisst das Halten
 * den Vorteil.
 *
 * @param {object} fav     Favorit
 * @param {object} alt     letzter Stand {preis, umsatz, spreadBp, funding}
 * @param {object} neu     {preisUsd, aenderung24h, umsatz24h, spreadBp, fundingJahresRate}
 * @param {object} regeln  Schwellen
 */
export function pruefeRegelnBoerse(fav, alt = {}, neu = {}, regeln = STANDARD_ALARM_REGELN) {
    const r = { ...STANDARD_ALARM_REGELN, ...(regeln || {}) }
    const alarme = []
    const s = String(fav?.symbol || '?').replace(/USDT$/, '')

    const dPreis = deltaPct(alt.preis, neu.preisUsd)
    if (dPreis !== null && Math.abs(dPreis) >= r.preisSprungPct) {
        alarme.push({
            regel: 'preisSprung',
            schwere: 'info',
            meldung: `${s}: Preis ${dPreis > 0 ? '+' : ''}${dPreis.toFixed(0)} % seit dem letzten Blick`,
            daten: { vorher: alt.preis, nachher: neu.preisUsd, pct: Math.round(dPreis) },
        })
    }

    const d24 = Number(neu.aenderung24h)
    if (Number.isFinite(d24) && Math.abs(d24) >= r.preisSturz24hPct) {
        alarme.push({
            regel: 'preis24h',
            schwere: 'warnung',
            meldung: `${s}: ${d24 > 0 ? '+' : ''}${d24.toFixed(0)} % in 24 Stunden`,
            daten: { pct: Math.round(d24) },
        })
    }

    /*
     * Nur der Einbruch. Ein Umsatzanstieg ist eine gute Nachricht und steht
     * ohnehin in der Rangliste — Alarme sind für das, was Handlungsdruck
     * erzeugt.
     */
    const dUms = deltaPct(alt.umsatz, neu.umsatz24h)
    if (dUms !== null && dUms <= -r.umsatzEinbruchPct) {
        alarme.push({
            regel: 'umsatzEinbruch',
            schwere: 'warnung',
            meldung: `${s}: Umsatz ${dUms.toFixed(0)} % — von ${mioText(alt.umsatz)} auf ${mioText(neu.umsatz24h)}`,
            daten: { vorher: Math.round(alt.umsatz), nachher: Math.round(neu.umsatz24h), pct: Math.round(dUms) },
        })
    }

    /*
     * Der Spread wird gemeldet, wenn er die Schwelle ÜBERSCHREITET — nicht,
     * solange er darüber liegt. Sonst schlüge ein dauerhaft weiter Coin bei
     * jedem Takt an, und die Sperrfrist verwandelte das bloss in ein
     * langsameres Dauerpiepen statt in eine Nachricht.
     */
    const spreadAlt = Number(alt.spreadBp)
    const spreadNeu = Number(neu.spreadBp)
    if (Number.isFinite(spreadNeu) && spreadNeu >= r.spreadWarnBp
        && (!Number.isFinite(spreadAlt) || spreadAlt < r.spreadWarnBp)) {
        alarme.push({
            regel: 'spreadWeit',
            schwere: 'warnung',
            meldung: `${s}: Spread auf ${spreadNeu.toFixed(1)} bp gestiegen — Ausführung wird teuer`,
            daten: { vorher: Number.isFinite(spreadAlt) ? Number(spreadAlt.toFixed(2)) : null, nachher: Number(spreadNeu.toFixed(2)) },
        })
    }

    // Ebenfalls beim Überschreiten, und aus demselben Grund.
    const fAlt = Number(alt.funding)
    const fNeu = Number(neu.fundingJahresRate)
    if (Number.isFinite(fNeu) && Math.abs(fNeu) >= r.fundingExtremPct
        && (!Number.isFinite(fAlt) || Math.abs(fAlt) < r.fundingExtremPct)) {
        alarme.push({
            regel: 'fundingExtrem',
            schwere: 'info',
            meldung: `${s}: Funding bei ${fNeu > 0 ? '+' : ''}${fNeu.toFixed(0)} % p. a. — `
                + `${fNeu > 0 ? 'Long zahlt' : 'Short zahlt'}`,
            daten: { vorher: Number.isFinite(fAlt) ? Math.round(fAlt) : null, nachher: Math.round(fNeu) },
        })
    }

    return alarme
}

const mioText = (usd) => {
    const z = Number(usd)
    if (!Number.isFinite(z)) return '—'
    return z >= 1e6 ? `${(z / 1e6).toFixed(0)} Mio` : `${Math.round(z / 1e3)} Tsd`
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

    /*
     * Die Börsendaten für ALLE Coin-Radar-Favoriten in einem Zug.
     *
     * `holeMarktweit` liefert jedes Perpetual auf einmal — ein Abruf statt
     * einem je Favorit. Bei einem Takt alle fünfzehn Minuten wäre der
     * Unterschied zwischen einem und zwanzig Abrufen nicht dramatisch, aber
     * es gibt keinen Grund, das Binance-Kontingent dafür anzuzapfen, wenn ein
     * Sammelabruf ohnehin alles enthält.
     *
     * Erst holen, wenn es überhaupt solche Favoriten gibt: Wer nur den
     * Hype-Radar benutzt, soll dafür keine Fremdanfrage bezahlen.
     */
    const boersenFavs = favoriten.filter((f) => f.quelle === 'coinradar')
    let jeSymbol = new Map()
    if (boersenFavs.length) {
        try {
            ({ jeSymbol } = await holeMarktweit())
        } catch (e) {
            logWarn('hype-wachhund', `Börsendaten nicht abrufbar: ${e.message}`)
        }
    }

    for (const fav of favoriten) {
        try {
            // ── Börsenpfad ──────────────────────────────────────────────
            if (fav.quelle === 'coinradar') {
                const roh = jeSymbol.get(fav.symbol)
                // Kein Eintrag heisst: Binance führt das Symbol nicht (mehr).
                // Den Favoriten stillschweigend zu überspringen ist richtig —
                // ein Alarm „keine Daten" bei jedem Takt wäre nur Lärm.
                if (!roh) continue

                const altB = sicherJson(fav.letzteDaten, {})
                const neuB = {
                    preisUsd: roh.preis,
                    aenderung24h: roh.preisAenderung24h,
                    umsatz24h: roh.umsatz24h,
                    spreadBp: roh.spreadBp,
                    fundingJahresRate: fundingJahresRate(roh.fundingRate, roh.fundingIntervallH),
                }

                const alarmeB = fav.stumm ? [] : pruefeRegelnBoerse(fav, altB, neuB, regeln)
                ausgeloest += await meldeAlarme(knex, fav, alarmeB, einst, jetzt)

                await knex('hype_favoriten').where('id', fav.id).update({
                    letzteDaten: JSON.stringify({
                        preis: neuB.preisUsd,
                        umsatz: neuB.umsatz24h,
                        spreadBp: neuB.spreadBp,
                        funding: neuB.fundingJahresRate,
                        ts: jetzt,
                    }),
                })
                continue
            }

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
            ausgeloest += await meldeAlarme(knex, fav, alarme, einst, jetzt)

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

/**
 * Alarme speichern und zustellen — für beide Pfade derselbe Weg.
 *
 * Gemeinsam, weil hier nichts pfadspezifisch ist: Ein Preissprung ist ein
 * Preissprung, egal ob er von einem Handelspaar oder von Bitunix kommt. Die
 * Unterscheidung gehört in die Regeln, nicht in die Zustellung.
 *
 * @returns {Promise<number>} tatsächlich ausgelöste Alarme
 */
async function meldeAlarme(knex, fav, alarme, einst, jetzt) {
    let n = 0
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
        n++
        // Zustellung nach dem Speichern: die In-App-Liste ist der Kanal, der
        // nie ausfallen kann — was dort steht, ist gemeldet.
        await stelleZu(a, fav, einst).catch((e) =>
            logWarn('hype-wachhund', `Zustellung ${fav.symbol}/${a.regel}: ${e.message}`))
    }
    return n
}
