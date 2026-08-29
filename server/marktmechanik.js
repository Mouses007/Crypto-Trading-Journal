/**
 * Marktmechanik: regelbasierter Marktzustand aus Preis, Open Interest,
 * Funding und Liquidationen — bewusst OHNE KI, damit derselbe Datensatz
 * immer denselben Zustand ergibt. Eine KI darf den Zustand später erklären
 * (mechanik-erklaerung), aber nie bestimmen.
 *
 * Reines Modul ohne Netz und DB, damit der Selbsttest
 * (__selftest-marktmechanik.mjs) jede Regel einzeln prüfen kann. Die
 * Datenbeschaffung liegt in marktradar-api.js (holeMechanik).
 *
 * Vorbild ist die Vier-Felder-Deutung der Long/Short-Kachel (holeLsOi);
 * hier kommen Funding und Liquidationen als dritte und vierte Achse dazu,
 * denn erst sie unterscheiden „normalen Aufbau" von Squeeze-Gefahr.
 */

/**
 * Schwellen je Zeitfenster. Ausgangspunkt sind die 24h-Schwellen der
 * Long/Short-Deutung (±1 % OI, ±0,3 % Preis), grob mit √t auf kürzere
 * Fenster heruntergerechnet — Feintuning gegen echte Marktphasen ist
 * ausdrücklich vorgesehen und ändert nur diese Tabelle.
 */
export const FENSTER = {
    '15m': { ms: 15 * 60 * 1000, preisSchwelle: 0.15, oiSchwelle: 0.25, oiStark: 0.8 },
    '1h': { ms: 60 * 60 * 1000, preisSchwelle: 0.3, oiSchwelle: 0.5, oiStark: 1.5 },
    '4h': { ms: 4 * 60 * 60 * 1000, preisSchwelle: 0.6, oiSchwelle: 1.0, oiStark: 3.0 },
}

// Funding gilt je 8-h-Intervall und ist damit fensterunabhängig.
// +0,03 % je 8 h ≈ +33 % p.a. — die Long-Seite zahlt dann spürbar dafür,
// im Markt zu bleiben. −0,01 % ist bereits klar unter dem üblichen
// Gleichgewicht von +0,01 %.
export const FUNDING_HOCH = 0.03
export const FUNDING_NEGATIV = -0.01

// Liquidations-Spike: Fenster-Volumen ≥ 2× dem, was in einem
// durchschnittlichen gleich langen Abschnitt der letzten 24 h anfiel.
export const LIQ_SPIKE = 2
// Dominanz: eine Seite trägt mindestens 70 % des liquidierten Volumens.
export const LIQ_DOMINANZ = 0.7

/**
 * Bewertet einen Faktorensatz. Fehlende Faktoren (null/undefined bzw.
 * liqVerfuegbar=false) werfen nicht, sondern überspringen die Regeln, die sie
 * bräuchten — der Rest urteilt weiter, `fehlend` sagt ehrlich, was fehlte.
 *
 * @param {object} f  Faktoren:
 *   preisDeltaPct  Preisänderung im Fenster in %
 *   oiDeltaPct     OI-Änderung im Fenster in %
 *   fundingRate    aktuelle Funding-Rate in % je 8 h (z. B. 0.01)
 *   fundingTrend   -1|0|1 — Vorzeichen von (aktuelle − letzte abgerechnete Rate)
 *   liqLongUsd     liquidiertes Long-Volumen im Fenster (USD)
 *   liqShortUsd    liquidiertes Short-Volumen im Fenster (USD)
 *   liqSpikeFaktor Fenster-Volumen ÷ (Ø 24h-Volumen, skaliert auf Fensterlänge)
 *   liqVerfuegbar  false, wenn für das Symbol keine Aufzeichnung existiert
 * @param {string} fenster  '15m' | '1h' | '4h'
 * @returns {{state: string, gruende: string[], fehlend: string[]}}
 */
export function bewerteMechanik(f, fenster) {
    const s = FENSTER[fenster]
    if (!s) throw new Error(`Unbekanntes Fenster: ${fenster}`)

    const zahl = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const preis = zahl(f?.preisDeltaPct)
    const oi = zahl(f?.oiDeltaPct)
    const funding = zahl(f?.fundingRate)

    const liqDa = f?.liqVerfuegbar !== false
        && zahl(f?.liqLongUsd) !== null && zahl(f?.liqShortUsd) !== null
    const liqSumme = liqDa ? f.liqLongUsd + f.liqShortUsd : 0
    const liqSpike = liqDa && zahl(f?.liqSpikeFaktor) !== null && f.liqSpikeFaktor >= LIQ_SPIKE
    // Dominanz allein ist bei Kleinstvolumen Rauschen — sie zählt in den
    // Regeln deshalb nur zusammen mit einem Liquidations-Spike
    const liqLongDominanz = liqDa && liqSumme > 0 && f.liqLongUsd / liqSumme >= LIQ_DOMINANZ
    const liqShortDominanz = liqDa && liqSumme > 0 && f.liqShortUsd / liqSumme >= LIQ_DOMINANZ

    const fehlend = []
    if (preis === null) fehlend.push('preis')
    if (oi === null) fehlend.push('oi')
    if (funding === null) fehlend.push('funding')
    if (!liqDa) fehlend.push('liq')

    const fundingHoch = funding !== null && funding >= FUNDING_HOCH
    const fundingNegativ = funding !== null && funding <= FUNDING_NEGATIV

    // Erste zutreffende Regel gewinnt — die Reihenfolge ist Teil des Urteils:
    // laufender Zwangsabbau überstimmt jede Risiko-Warnung, Risiko überstimmt
    // die neutrale Aufbau-Beschreibung.
    const urteil = (state, gruende) => ({ state, gruende, fehlend })

    // 1. Zwangsabbau läuft: OI bricht weg UND Liquidationen spiken.
    if (oi !== null && liqSpike && oi <= -s.oiStark) {
        return urteil('DELEVERAGING', ['oiAbbauStark', 'liqSpike'])
    }

    // 2. Long-Squeeze-Gefahr: Longs drängen teuer nach, der Preis kommt nicht
    //    mit — oder es werden bei fallendem Preis schon überwiegend Longs
    //    zwangsverkauft.
    if (fundingHoch && oi !== null && preis !== null
        && oi >= s.oiSchwelle && preis <= s.preisSchwelle) {
        return urteil('LONG_SQUEEZE_RISK', ['fundingHoch', 'oiAufbau', 'preisTraege'])
    }
    if (liqLongDominanz && liqSpike && preis !== null && preis < 0) {
        return urteil('LONG_SQUEEZE_RISK', ['liqLongDominanz', 'liqSpike', 'preisFaellt'])
    }

    // 3. Short-Squeeze-Gefahr: spiegelbildlich.
    if (fundingNegativ && oi !== null && preis !== null
        && oi >= s.oiSchwelle && preis >= -s.preisSchwelle) {
        return urteil('SHORT_SQUEEZE_RISK', ['fundingNegativ', 'oiAufbau', 'preisTraege'])
    }
    if (liqShortDominanz && liqSpike && preis !== null && preis > 0) {
        return urteil('SHORT_SQUEEZE_RISK', ['liqShortDominanz', 'liqSpike', 'preisSteigt'])
    }

    // 4./5. Gerichteter Aufbau: neues Geld schiebt in Preisrichtung.
    if (oi !== null && preis !== null && oi >= s.oiSchwelle) {
        if (preis >= s.preisSchwelle) return urteil('LONG_AUFBAU', ['oiAufbau', 'preisSteigt'])
        if (preis <= -s.preisSchwelle) return urteil('SHORT_AUFBAU', ['oiAufbau', 'preisFaellt'])
    }

    return urteil('NEUTRAL', [])
}
