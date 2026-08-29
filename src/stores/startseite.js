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
import { reactive, ref } from 'vue'

export const journalTage = reactive([])

/**
 * Zustand des letzten Abrufs: 'laedt' | 'da' | 'fehler'.
 *
 * Ein leeres `journalTage` hiess bis zum Audit vom 28.08.2026 zweierlei — „noch
 * keine Trades erfasst" und „der Abruf ist gescheitert". Fünf Kacheln zeigten
 * denselben freundlichen Leertext, während der Zustandspunkt der Seite auf
 * grün stand. Das ist genau das Schadensmodell dieses Projekts: nicht die
 * fehlende Zahl, sondern die falsche, die vertrauenswürdig aussieht.
 *
 * Der Kommentar in `useKachelRaster.js` warnt seit dem Live-Trading-Fenster
 * vor exakt diesem Muster — dort aber nur für Kacheln mit eigenem Datenstrom.
 */
export const journalZustand = ref('laedt')

/** Ersetzt den Inhalt in-place, damit bestehende Referenzen reaktiv bleiben. */
export function setzeJournalTage(tage) {
    journalTage.length = 0
    if (Array.isArray(tage)) journalTage.push(...tage)
    journalZustand.value = 'da'
}

/** Der Abruf ist gescheitert — der bisherige Bestand bleibt stehen. */
export function meldeJournalFehler() {
    journalZustand.value = 'fehler'
}
