/**
 * Wartungsmarge für das gerade betrachtete Symbol holen und in den Store legen.
 *
 * Die Liquidationskarte hing an einer einzigen Zahl für alle Coins. Wer von
 * BTC auf einen kleinen Coin wechselte, bekam dessen Zonen mit BTC-Marge
 * gezeichnet — sichtbar plausibel, aber um ein Vielfaches zu nah am Kurs.
 *
 * Die Herkunft wird mitgeführt und angezeigt: eine Zahl, die still von einer
 * anderen Börse stammt oder aus einem alten Cache, wäre schlimmer als die alte
 * Vorgabe, weil man ihr ansieht, dass sie „echt" ist.
 */
import axios from 'axios'
import { ref } from 'vue'
import { levMapMmr, levMapMmrQuelle } from '../stores/live.js'
import { logWarn } from './logger.js'

/**
 * Was zuletzt geantwortet hat — rein zur Anzeige.
 * `zustand`: 'leer' | 'laedt' | 'da' | 'fehler'
 */
export const mmrHerkunft = ref({ zustand: 'leer', symbol: '', quelle: '', ersatz: false, veraltet: false, obergrenze: 0, maxHebel: 0, stufen: 0 })

let laufendeAnfrage = 0

/**
 * Holt die Rate und schreibt sie in `levMapMmr`. Bei Quelle 'manuell' passiert
 * nichts — dann gilt, was im Feld steht.
 *
 * @param {string} symbol z.B. BTCUSDT
 */
export async function aktualisiereMarginRate(symbol) {
    if (levMapMmrQuelle.value === 'manuell' || !symbol) {
        mmrHerkunft.value = { ...mmrHerkunft.value, zustand: 'leer', symbol }
        return
    }

    // Ein schneller Symbolwechsel darf nicht die Antwort des vorigen erben.
    const meine = ++laufendeAnfrage
    mmrHerkunft.value = { ...mmrHerkunft.value, zustand: 'laedt', symbol }

    try {
        const { data } = await axios.get('/api/margin-rate', {
            params: { symbol, quelle: levMapMmrQuelle.value },
        })
        if (meine !== laufendeAnfrage) return
        if (!(data?.mmr > 0)) throw new Error('Antwort ohne Rate')

        levMapMmr.value = data.mmr
        mmrHerkunft.value = {
            zustand: 'da',
            symbol,
            quelle: data.quelle || '',
            ersatz: !!data.ersatz,
            veraltet: !!data.veraltet,
            obergrenze: data.obergrenze || 0,
            maxHebel: data.maxHebel || 0,
            stufen: data.stufen || 0,
        }
    } catch (fehler) {
        if (meine !== laufendeAnfrage) return
        logWarn('marginRate', `Wartungsmarge für ${symbol} nicht abrufbar: ${fehler.message}`)
        // Der zuletzt gesetzte Wert bleibt stehen. Ihn auf die Vorgabe
        // zurückzusetzen wäre die schlechtere Lüge: 0,004 ist für die meisten
        // Coins weiter weg von der Wahrheit als die Rate des Vorgängersymbols.
        mmrHerkunft.value = { ...mmrHerkunft.value, zustand: 'fehler', symbol }
    }
}
