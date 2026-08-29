/**
 * Gewichtsbremse für Binance — damit ein Laborlauf den Livebetrieb nicht aushungert.
 *
 * Binance rechnet nicht in Anfragen, sondern in GEWICHT je IP und Minute:
 * 2 400 für die USDⓈ-M-Schnittstelle, und ein `klines`-Abruf mit `limit=1500`
 * kostet 10. Ein Rangliste-Lauf über 100 Coins braucht davon je nach
 * Zeiteinheit 400 bis 1 200 Abrufe — hintereinander, in wenigen Minuten.
 *
 * Das Problem ist nicht der Lauf selbst, sondern wer sich die IP mit ihm teilt:
 * die Strategie-Engine holt ihre Live-Kerzen über dieselbe Leitung. Läuft das
 * Budget leer, bekommt SIE die 429er — und verpasst Einstiege. Ein zu langsamer
 * Laborlauf ist ärgerlich; ein verpasster Live-Einstieg ist ein Schaden.
 *
 * Deshalb zwei Grundsätze:
 *
 *   1. **Der Livebetrieb wird nie gebremst.** `warteAufGewicht()` steht allein
 *      im Historienpfad. `getClosedCandles` (Engine, Marktradar) läuft
 *      ungebremst weiter und darf jederzeit überholen.
 *   2. **Gezählt wird, was Binance sagt, nicht was wir glauben.** Jeder Abruf
 *      meldet seinen `X-MBX-USED-WEIGHT-1M`-Kopf hierher zurück — auch die des
 *      Livebetriebs. Nur so kennt die Bremse den GESAMTverbrauch der IP.
 *
 * Der Deckel liegt bewusst weit unter dem Limit: die Rangliste hält sich unter
 * 1 000 und geht schlafen, sobald die IP insgesamt über 1 600 kommt. Sie kann
 * die Engine damit nicht aushungern, weil sie sich abschaltet, bevor es eng wird.
 */

import { logWarn } from './logger.js'

/** So viel darf die Rangliste selbst je Minute verbrauchen. */
export const EIGEN_DECKEL = 1000
/** Ab diesem GESAMTverbrauch der IP hält die Rangliste ganz an. */
export const FREMD_GRENZE = 1600
/** Gewicht eines `klines`-Abrufs mit limit > 1000. */
export const GEWICHT_KLINES = 10

const MINUTE = 60000

// Zeit und Warten sind einspeisbar — sonst dauert jeder Test dieser Datei so
// lange wie die Pausen, die er prüfen soll.
let jetzt = () => Date.now()
let schlafe = (ms) => new Promise((f) => setTimeout(f, ms))

/** Nur für Selbsttests: Uhr und Warteschlaf ersetzen. */
export function _setzeUhr(uhr, warten) {
    jetzt = uhr || (() => Date.now())
    schlafe = warten || ((ms) => new Promise((f) => setTimeout(f, ms)))
}

/** Eigene Abrufe: Zeitstempel und Gewicht, älter als eine Minute fällt raus. */
let eigene = []
/** Letzte Meldung von Binance über den Gesamtverbrauch der IP. */
let gemeldet = { gewicht: 0, zeit: 0 }
/** Bis wann eine Strafe (429/418) gilt. */
let gesperrtBis = 0

function aufraeumen() {
    const grenze = jetzt() - MINUTE
    eigene = eigene.filter((e) => e.t > grenze)
}

/** Was die Rangliste in der letzten Minute selbst verbraucht hat. */
export function eigenerVerbrauch() {
    aufraeumen()
    return eigene.reduce((s, e) => s + e.gewicht, 0)
}

/**
 * Verbrauch der GESAMTEN IP laut Binance.
 * Die Meldung veraltet: Binance zählt je Minute, also ist ein Wert, der älter
 * als eine Minute ist, keine Aussage mehr über jetzt.
 */
export function gemeldeterVerbrauch() {
    if (!gemeldet.zeit || jetzt() - gemeldet.zeit > MINUTE) return 0
    return gemeldet.gewicht
}

/**
 * Antwortkopf auswerten — von JEDEM Binance-Abruf aufzurufen, auch aus dem
 * Livepfad. Ohne die Meldungen des Livebetriebs kennt die Bremse nur die halbe
 * Wahrheit und lässt zu viel durch.
 */
export function notiereGewicht(headers) {
    if (!headers) return
    const lies = (k) => (typeof headers.get === 'function' ? headers.get(k) : headers[k])
    const roh = lies('x-mbx-used-weight-1m') ?? lies('X-MBX-USED-WEIGHT-1M')
    const w = Number(roh)
    if (Number.isFinite(w) && w > 0) gemeldet = { gewicht: w, zeit: jetzt() }
}

/**
 * Eine Strafe von Binance verarbeiten.
 * 429 = zu schnell, 418 = gesperrt. `Retry-After` steht in SEKUNDEN und wird
 * respektiert, wenn er da ist — eine geratene Pause ist entweder zu kurz (und
 * die nächste Strafe folgt) oder unnötig lang.
 */
export function melde429(status, headers) {
    const lies = (k) => (headers && typeof headers.get === 'function' ? headers.get(k) : headers?.[k])
    const retry = Number(lies('retry-after') ?? lies('Retry-After'))
    const wartenMs = Number.isFinite(retry) && retry > 0
        ? retry * 1000
        : (status === 418 ? 5 * MINUTE : 30000)
    gesperrtBis = jetzt() + wartenMs
    logWarn('binance-takt', `Binance ${status} — Historienabrufe pausieren ${Math.round(wartenMs / 1000)} s`)
    return wartenMs
}

/** Steht gerade eine Strafe an? (Für die Statusanzeige eines Laufs.) */
export function pausiertBis() {
    return gesperrtBis > jetzt() ? gesperrtBis : 0
}

/**
 * Vor einem Historienabruf warten, bis wieder Kopfraum da ist.
 *
 * Drei Gründe zu warten, in dieser Reihenfolge:
 *   1. eine Strafe läuft noch
 *   2. die IP ist insgesamt über `FREMD_GRENZE` — dann arbeitet jemand anders
 *      (die Engine), und die Rangliste tritt zurück
 *   3. der eigene Verbrauch der letzten Minute erreicht `EIGEN_DECKEL`
 *
 * Gewartet wird immer nur bis zum nächsten Prüfpunkt, nie blind eine feste
 * Zeit — so läuft es sofort weiter, wenn sich die Lage entspannt.
 */
export async function warteAufGewicht(kosten = GEWICHT_KLINES) {
    for (let runde = 0; runde < 600; runde++) {
        const t = jetzt()

        if (gesperrtBis > t) { await schlafe(Math.min(gesperrtBis - t, 5000)); continue }

        if (gemeldeterVerbrauch() >= FREMD_GRENZE) { await schlafe(2000); continue }

        aufraeumen()
        const eigen = eigene.reduce((s, e) => s + e.gewicht, 0)
        if (eigen + kosten > EIGEN_DECKEL) {
            // Bis der älteste Eintrag aus dem Minutenfenster fällt — dann ist
            // garantiert wieder Platz, und keine Sekunde früher.
            const aeltester = eigene[0]?.t || t
            await schlafe(Math.max(50, aeltester + MINUTE - t))
            continue
        }

        eigene.push({ t, gewicht: kosten })
        return
    }
    // 600 Runden entsprechen mindestens zehn Minuten Warten. Dann stimmt etwas
    // Grundsätzliches nicht, und weiterzuwarten hilft niemandem.
    throw new Error('Binance-Gewichtsbudget bleibt blockiert')
}

/** Alles zurücksetzen — nur für Selbsttests. */
export function _zuruecksetzen() {
    eigene = []
    gemeldet = { gewicht: 0, zeit: 0 }
    gesperrtBis = 0
}

/**
 * Wie oft darf ein fehlgeschlagener Abruf wiederholt werden?
 *
 * Ein 400 („Invalid symbol") ist endgültig — den Coin gibt es dort nicht, und
 * ihn dreimal zu erfragen ändert daran nichts. Es wäre der schlimmste Fall von
 * Hartnäckigkeit: 99 andere Coins warten darauf, dass dieser eine aufgibt.
 */
export function istWiederholbar(status) {
    if (status === 400 || status === 401 || status === 403 || status === 404) return false
    return true
}

/** Wartezeiten der Wiederholungen — 1 s, 4 s, 16 s, dann aufgeben. */
export const WIEDERHOLUNGEN = [1000, 4000, 16000]
