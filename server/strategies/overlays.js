/**
 * Was eine Strategie im Chart zeigen kann, ohne dass ein Setup entsteht.
 *
 * `detect()` liefert Setups — Kandidaten, die alle Bedingungen erfüllen. Wer
 * im Chart verstehen will, WARUM an einer Stelle kein Setup kam, braucht das
 * Gerüst dahinter: welche Zonen die Strategie gerade führt, wie gut sie sie
 * bewertet, welchen Trend sie auf beiden Ebenen sieht. Das gibt `detect()`
 * nicht aus; diese Datei holt es aus denselben Funktionen, die `detect()`
 * benutzt (`zonenLage` in `set_and_forget.js`), nicht aus einer Nachbildung.
 *
 * Rein: Kerzen und Parameter rein, Overlay-Daten raus. Zeiten in ms.
 */
import { zonenLage } from './set_and_forget.js'

/**
 * @param {string} strategyId
 * @param {{candles: Array, params: object, htfCandles?: Array}} eingabe
 * @returns {{ zonen?: Array, trend?: {ebene1:number, ebene2:number}, hinweis?: string }}
 */
export function overlaysFuer(strategyId, { candles, params, htfCandles = null }) {
    if (strategyId !== 'set_and_forget') return {}
    if (!Array.isArray(candles) || !candles.length) return {}
    const lage = zonenLage({ candles, params, htfCandles })
    if (lage.htfFehlt) return { hinweis: 'htfFehlt' }
    const { basis, zonen, trend1, trend2 } = lage
    return {
        trend: { ebene1: trend1, ebene2: trend2 },
        zonen: zonen.map((z) => {
            const indizes = (z.stellen || []).map((s) => s.index).filter((i) => i >= 0 && i < basis.length)
            return {
                tief: z.tief,
                hoch: z.hoch,
                mitte: z.mitte,
                punkte: z.punkte,
                guete: Number.isFinite(z.guete) ? z.guete : null,
                // Ab dem ersten Wendepunkt, der die Zone begründet — davor gab
                // es sie für die Strategie nicht.
                vonT: indizes.length ? basis[Math.min(...indizes)].t : basis[0].t,
                letzteT: basis[Math.min(z.letzterIndex, basis.length - 1)]?.t ?? null,
                stellen: (z.stellen || [])
                    .filter((s) => s.index >= 0 && s.index < basis.length)
                    .map((s) => ({ t: basis[s.index].t, p: s.price, art: s.art })),
            }
        }),
    }
}
