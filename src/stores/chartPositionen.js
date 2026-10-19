/**
 * Offene Positionen, die im Chart ausgeblendet sind (Reiter „Offene Trades").
 * Je Position über ihre positionId, im Browser gemerkt — eine Vorliebe dieses
 * Bildschirms, nichts, was ins Layout oder die Datenbank gehört.
 */
import { ref } from 'vue'

const SCHLUESSEL = 'ctj.chart.positionenAus'

function lies() {
    try { return new Set(JSON.parse(localStorage.getItem(SCHLUESSEL) || '[]').map(String)) } catch { return new Set() }
}

export const positionenAus = ref(lies())

export function schaltePosition(id) {
    const neu = new Set(positionenAus.value)
    const k = String(id)
    if (neu.has(k)) neu.delete(k)
    else neu.add(k)
    positionenAus.value = neu
    try { localStorage.setItem(SCHLUESSEL, JSON.stringify([...neu])) } catch { /* privat */ }
}
