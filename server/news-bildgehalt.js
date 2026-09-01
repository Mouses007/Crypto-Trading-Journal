/**
 * Substanzprüfung für Chartbild-Beschreibungen des Lageberichts.
 *
 * Das Problem, das dieses Modul löst: Perplexitys Bildersuche liefert Charts zu
 * beliebigen Artikeln, und `pruefeChartBilder` liess sie sich vom Vision-Modell
 * beschreiben. Die Frage lautete „ein Satz, was zu sehen ist" — und man bekam,
 * wonach man fragte: eine FORM-Beschreibung. „Ein Preis-Chart mit farblich
 * hervorgehobenen Unterstützungs- und Widerstandszonen sowie markierten Kerzen"
 * stand am 30.08.2026 als Bildunterschrift auf der Seite. Das beschreibt, dass
 * ein Chart ein Chart ist — für einen Trader wertlos.
 *
 * Der Prompt fragt jetzt nach konkreten Kursmarken und einer Richtungsaussage.
 * Hier steht die Prüfung, ob die Antwort das auch geliefert hat: enthält sie
 * abgelesene Kursniveaus, oder ist es wieder nur Formvokabular ohne eine einzige
 * Zahl? Ein Bild ohne verwertbare Aussage soll gar nicht erst mit einer
 * Leerformel unter der Bildunterschrift erscheinen — lieber keine Grafik als
 * eine, die nichts sagt.
 *
 * Rein und ohne Netz, nach dem Muster von `istBruchstueck`/`istOhneInhalt`
 * (Videozusammenfassungen) und `news-doppler.js`, damit der Selbsttest daneben
 * beide Richtungen prüfen kann: die Floskel fällt, die konkrete Aussage bleibt.
 */
import { zahlenAus } from './news-doppler.js'

/**
 * Formvokabular — die Wörter, mit denen man ein Chart beschreibt, ohne etwas
 * über den Kurs zu sagen. Ihre Anwesenheit allein verurteilt nichts; erst das
 * Fehlen JEDER konkreten Zahl daneben macht daraus eine Leerformel.
 */
const FORMWOERTER = /(zonen?|kerzen?|candles?|unterst[üu]tzung|widerstand|support|resistance|trend(linien?)?|linien?|chart|grafik|abbildung|preis(chart)?|markiert|hervorgehoben|dargestellt|zu sehen|zeigt eine?n?|horizontal)/i

/** Reine Zeiteinheit-Marke wie „1W", „4H", „1D" — ein Timeframe, kein Kursniveau. */
const NUR_TIMEFRAME = /^\s*\d+\s*[mhdwy]\s*$/i

/**
 * Die konkreten Kursniveaus aus dem `marken`-Feld als vergleichbare Menge.
 *
 * Jeder Eintrag geht durch `zahlenAus` (aus dem Doppler), das Zeitspannen,
 * Datumsangaben und Indikator-Perioden ausschliesst — „200 EMA" ist eine
 * Einstellung, kein Level. Reine Timeframes („1W") werden vorab verworfen,
 * weil `zahlenAus` das „W" nicht als Nicht-Messwert kennt.
 */
export function marktMarken(urteil) {
    const set = new Set()
    for (const roh of (Array.isArray(urteil?.marken) ? urteil.marken : [])) {
        const m = String(roh || '').trim()
        if (!m || NUR_TIMEFRAME.test(m)) continue
        for (const z of zahlenAus(m)) set.add(z)
    }
    return set
}

/**
 * Ist der Text eine Leerformel — Formvokabular ohne eine einzige konkrete Zahl?
 *
 * Eine einzige abgelesene Kursmarke reicht, damit es keine Floskel mehr ist:
 * „Bruch über 46.000" ist konkret, auch wenn sonst nur Formwörter drumherum
 * stehen. Erst wenn gar keine Zahl auftaucht UND Formvokabular da ist, war es
 * eine reine Formbeschreibung.
 */
export function istFormfloskel(text) {
    const t = String(text || '').trim()
    if (!t) return true
    if (zahlenAus(t).size > 0) return false
    return FORMWOERTER.test(t)
}

/**
 * Urteil des Vision-Modells zu einem Bild bewerten: `pass`, `grenzfall`, `fail`.
 *
 * - `fail`: kein Chart, oder keine Marke UND (keine/floskelhafte Aussage). Fliegt raus.
 * - `pass`: echter Chart, mindestens zwei abgelesene Marken UND eine Aussage mit
 *   Zahl, die keine Floskel ist. Wird ohne zweiten Modellaufruf übernommen.
 * - `grenzfall`: alles dazwischen — genau eine Marke, oder eine zahlhaltige
 *   Aussage ohne befülltes Markenfeld. Diese gehen an den KI-Judge, der
 *   semantisch entscheidet, statt sie pauschal durchzuwinken oder zu verwerfen.
 *
 * @param {{istChart?:boolean, marken?:Array, aussage?:string}} urteil
 * @returns {'pass'|'grenzfall'|'fail'}
 */
export function bewerteChartGehalt(urteil) {
    if (urteil?.istChart !== true) return 'fail'
    const aussage = String(urteil?.aussage || '').trim()
    const marken = marktMarken(urteil)
    const floskel = istFormfloskel(aussage)
    if (marken.size === 0 && (!aussage || floskel)) return 'fail'
    const aussageHatZahl = zahlenAus(aussage).size > 0
    if (marken.size >= 2 && aussageHatZahl && !floskel) return 'pass'
    return 'grenzfall'
}
