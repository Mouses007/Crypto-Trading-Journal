<script setup>
/**
 * Bedienung der Bookmap-Kachel in ihrer Kopfzeile.
 *
 * Drei Regler, und nur diese drei: **Preisband**, **Zeitspanne** und **Pause**.
 * Alle drei fasst man im Handel dauernd an — das Band, weil ein Sprung von
 * ±0,05 % auf ±0,5 % aus einer Wand ein Muster macht; die Spanne, weil
 * dieselbe Wand über eine Minute und über eine Stunde verschieden viel
 * bedeutet; Pause, um eine Zone abzulesen, ohne dass sie unter der Maus
 * wegläuft. Alles Übrige (Farbskala, Profil, Sättigung, Vorlauf) gehört auf
 * `/liquidity`, wo die Karte den ganzen Bildschirm hat und daneben Platz für
 * dreissig Einstellungen ist.
 *
 * Die Zeitspanne kam am 07.09.2026 dazu. Vorher war die sichtbare Zeit
 * Plotbreite × Takt und damit gar nicht wählbar — bei 500 ms rund sechs
 * Minuten, egal was man wollte.
 *
 * Die Werte kommen aus `stores/live.js` und sind Modul-Singletons: was hier
 * gestellt wird, gilt auch auf der eigenen Seite. Das ist Absicht — es ist
 * dieselbe Karte, nicht eine Kopie. Die Bookmap-Kachel ist bewusst die einzige
 * Instanz (`gross: false`), es kann also keine zweite geben, die dagegenhält.
 */
import { useI18n } from 'vue-i18n'
import {
    liveViewPct, liveSpanneMin, liveFrozen, liveHistoryMin,
    VIEW_PCT_OPTIONS, spannenOptionen,
} from '../../../stores/live.js'
import { computed } from 'vue'

const { t } = useI18n()

/** Nur Spannen, die der Ring aufheben kann (siehe stores/live.js). */
const spannen = computed(() => spannenOptionen(liveHistoryMin.value))

/** „15 m", „1 h", und 0 als „nativ" — Bookmap schreibt es genauso kurz. */
function spanneLabel(min) {
    if (!min) return t('live.spanNative')
    return min >= 60 ? `${min / 60} h` : `${min} m`
}
</script>

<template>
    <select v-model.number="liveViewPct" class="radarCardSel" :title="t('live.bandTitle')">
        <option v-for="p in VIEW_PCT_OPTIONS" :key="p" :value="p">± {{ p }} %</option>
    </select>

    <select v-model.number="liveSpanneMin" class="radarCardSel" :title="t('live.spanTitle')">
        <option v-for="m in spannen" :key="m" :value="m">{{ spanneLabel(m) }}</option>
    </select>

    <!-- Eingefroren ist eine Warnung, kein „aktiv": die Karte zeigt dann nicht
         mehr, was gerade passiert. Die Aufzeichnung läuft weiter. -->
    <button type="button" :class="['radarCardCtl', liveFrozen ? 'warn' : '']"
        :title="liveFrozen ? t('livetrading.bookmapKopf.weiterTitel') : t('livetrading.bookmapKopf.pauseTitel')"
        @click="liveFrozen = !liveFrozen">
        <i :class="liveFrozen ? 'uil uil-play' : 'uil uil-pause'"></i>
        {{ liveFrozen ? t('livetrading.bookmapKopf.weiter') : t('livetrading.bookmapKopf.pause') }}
    </button>
</template>
