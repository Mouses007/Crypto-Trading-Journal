<script setup>
/**
 * Das Pult der Startseite — konfigurierbar statt fest.
 *
 * Live-Trading und Marktradar haben eine FESTE Bühne und Leiste: eine kleine,
 * inhaltlich geordnete Kachelmenge, bei der klar ist, welche Kacheln Fläche
 * verdienen. Die Startseite hat das nicht — sie bietet den ganzen frei
 * konfigurierbaren Katalog (Journal-Kacheln plus voller Marktradar-Katalog),
 * und welche davon gerade wichtig ist, weiss nur der Nutzer.
 *
 * ## Bühnenkandidaten sind kuratiert, nicht „alles ist erlaubt"
 *
 * Der erste Entwurf liess JEDE sichtbare Kachel als Bühne zu. Das Ergebnis:
 * wählte man z.B. „Offene Trades" — eine Liste mit ein paar Zeilen —, blieb
 * der grösste Teil der Bühnenfläche einfach leer. Eine Bühne braucht Inhalt,
 * der mit dem Platz mitwächst; eine Stat-Kachel mit einer Zahl tut das nicht,
 * egal wie gross man sie zieht.
 *
 * Deshalb kommen die Bühnenoptionen nur aus Kacheln mit `flaeche: true` in
 * der Registry (Kapitalkurve, Heatmap, Marktübersicht, RSI-Heatmap, Dominanz,
 * Regenbogen — siehe `config/startseite.js`/`config/marktradar.js`). Die
 * Leiste bleibt dagegen offen: ALLE sichtbaren Kacheln ausser der gewählten
 * Bühne landen dort, in der Reihenfolge, die im Raster schon gilt. Ein Text-
 * oder Zahlen-Instrument in einer schmalen Spalte ist kompakt und richtig;
 * dieselbe Kachel als bildschirmfüllende Bühne wäre es nicht.
 *
 * Konfigurierbar bleibt es trotzdem: was sichtbar ist, bestimmt weiterhin das
 * Kachel-Menü, und unter den sichtbaren Flächenkacheln wählt der Nutzer frei.
 * Blendet er ausgerechnet die gewählte Bühne aus (oder alle Flächenkacheln),
 * fällt die Wahl automatisch zurück — im Extremfall auf „keine Bühne", siehe
 * `PultRahmen`s `buehneLeerHinweis`. Deshalb ist die Bühnenwahl hier NICHT
 * wie bei den anderen beiden Pulten `ref` + `localStorage` in dieser
 * Komponente, sondern wird von `PultRahmen` als "controlled" Prop
 * entgegengenommen und hier gegen die sich ändernde Liste nachgeführt.
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PultRahmen from '../pult/PultRahmen.vue'

const props = defineProps({
    daten: { type: Object, required: true },
    zustand: { type: Object, required: true },
    stand: { type: Object, required: true },
    kachelParams: { type: Object, default: () => ({}) },
    komponenten: { type: Object, required: true },
    /** Die sichtbaren Kachel-Objekte aus dem Raster, in Rasterreihenfolge. */
    sichtbareKacheln: { type: Array, required: true },
})

const emit = defineEmits(['params', 'anzeige', 'zustand', 'neuladen', 'oeffnen'])

const { t } = useI18n()

const BUEHNE_KEY = 'startseite_pult_buehne'

const buehne = ref(localStorage.getItem(BUEHNE_KEY) || '')

function setzeBuehne(id) {
    buehne.value = id
    localStorage.setItem(BUEHNE_KEY, id)
}

/*
 * Nachführen, sobald sich die sichtbare Menge ändert: neu geöffnet (leerer
 * Speicher), die gemerkte Bühne wurde ausgeblendet, oder gar nichts mehr
 * sichtbar. `immediate`, damit der erste Aufruf schon die Vorgabe setzt statt
 * eine Lücke zu lassen, bis der Nutzer zum ersten Mal etwas umschaltet.
 */
const buehnenListe = computed(() => props.sichtbareKacheln.filter(k => k.flaeche))

watch(buehnenListe, (liste) => {
    if (liste.some(k => k.id === buehne.value)) return
    setzeBuehne(liste.length ? liste[0].id : '')
}, { immediate: true })

const leiste = computed(() => props.sichtbareKacheln.filter(k => k.id !== buehne.value))
</script>

<template>
    <PultRahmen v-if="sichtbareKacheln.length" :daten="daten" :zustand="zustand" :stand="stand"
        :kachel-params="kachelParams" :komponenten="komponenten" :buehnen="buehnenListe" :leiste="leiste"
        :buehne="buehne" :buehne-leer-hinweis="t('startseite.pult.keineBuehne')" @update:buehne="setzeBuehne"
        @params="(id, w) => emit('params', id, w)"
        @anzeige="(id, w) => emit('anzeige', id, w)"
        @zustand="(id, z, extra) => emit('zustand', id, z, extra)"
        @neuladen="(id) => emit('neuladen', id)" />
</template>
