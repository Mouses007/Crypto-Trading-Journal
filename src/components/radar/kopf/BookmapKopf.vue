<script setup>
/**
 * Bedienung der Bookmap-Kachel in ihrer Kopfzeile.
 *
 * Zwei Regler, und nur diese zwei: das **Preisband** und **Pause**. Beides
 * fasst man im Handel dauernd an — das Band, weil ein Sprung von ±0,05 % auf
 * ±0,5 % aus einer Wand ein Muster macht, und Pause, um eine Zone abzulesen,
 * ohne dass sie unter der Maus wegläuft. Alles Übrige (Farbskala, Profil,
 * Sättigung, Vorlauf) gehört auf `/liquidity`, wo die Karte den ganzen
 * Bildschirm hat und daneben Platz für dreissig Einstellungen ist.
 *
 * Die Werte kommen aus `stores/live.js` und sind Modul-Singletons: was hier
 * gestellt wird, gilt auch auf der eigenen Seite. Das ist Absicht — es ist
 * dieselbe Karte, nicht eine Kopie. Die Bookmap-Kachel ist bewusst die einzige
 * Instanz (`gross: false`), es kann also keine zweite geben, die dagegenhält.
 */
import { useI18n } from 'vue-i18n'
import { liveViewPct, liveFrozen, VIEW_PCT_OPTIONS } from '../../../stores/live.js'

const { t } = useI18n()
</script>

<template>
    <select v-model.number="liveViewPct" class="radarCardSel" :title="t('live.bandTitle')">
        <option v-for="p in VIEW_PCT_OPTIONS" :key="p" :value="p">± {{ p }} %</option>
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
