/**
 * Kleiner Store nur für die Journal-Kacheln der Startseite.
 *
 * Hält die broker-weiten Trade-Tage (all-time), aus denen Kapitalkurve,
 * Kalender-Heatmap und die Performance-Splits rechnen. Bewusst getrennt von der
 * Filter-Pipeline des Journals: die hängt an einer App-Init-Reihenfolge, die im
 * `start`-Modus nicht läuft. Die Startseite befüllt diesen Store beim Mount und
 * im Takt (`Startseite.vue`), die Kacheln lesen nur.
 *
 * Jede Zeile ist ein Tages-Datensatz wie ihn `dbFind('trades', …)` liefert:
 *   { dateUnix, pAndL: { netProceeds, … }, trades: [ { netProceeds, symbol,
 *     entryTime, exitTime, side, strategy, … }, … ], … }
 */
import { reactive } from 'vue'

export const journalTage = reactive([])

/** Ersetzt den Inhalt in-place, damit bestehende Referenzen reaktiv bleiben. */
export function setzeJournalTage(tage) {
    journalTage.length = 0
    if (Array.isArray(tage)) journalTage.push(...tage)
}
