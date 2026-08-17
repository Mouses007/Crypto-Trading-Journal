<script setup>
/**
 * Kachel „Bookmap".
 *
 * Nur eine Hülle: der ganze Inhalt ist `LiquidityHeatmap.vue`, unverändert
 * dieselbe Komponente wie auf der eigenen Seite. Sie kommt ohne Props aus
 * (alles steht in `stores/live.js`) und füllt per `position: absolute; inset: 0`
 * ihren Container — deshalb braucht es hier nichts als einen positionierten
 * Rahmen.
 *
 * ## Warum diese Kachel sich NICHT vergrössern lässt
 *
 * Die Gross-Ansicht des Rasters ist eine ZWEITE Instanz derselben Komponente.
 * Bei einem Chart ist das harmlos — beide bekommen dieselben Daten gereicht.
 * Hier wäre es fatal: ein zweiter `LiveFeed` öffnet einen zweiten
 * Orderbuch-Socket, einen zweiten Trade-Socket und holt einen zweiten
 * REST-Schnappschuss. Schlimmer noch, `liveFrozen`, `liveAutoFollow` und
 * `liveAutoRefValue` sind Modul-Singletons: beide Instanzen schreiben in
 * dieselben Werte, und Einfrieren in der Kachel würde das Overlay mit
 * einfrieren.
 *
 * Deshalb `gross: false` in der Registry und stattdessen ein Knopf auf die
 * eigene Seite, wo die Karte den ganzen Bildschirm hat und alle Bedienelemente
 * im Seitenmenü stehen.
 */
import { useI18n } from 'vue-i18n'
import LiquidityHeatmap from '../LiquidityHeatmap.vue'

defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
    params: { type: Object, default: () => ({}) },
})

const { t } = useI18n()
</script>

<template>
    <div class="bmWrap">
        <div class="bmFlaeche">
            <LiquidityHeatmap />
        </div>
        <a class="bmGanzeSeite" href="/liquidity" @click.stop>
            <i class="uil uil-expand-arrows-alt"></i>{{ t('livetrading.ganzeSeite') }}
        </a>
    </div>
</template>

<style scoped>
.bmWrap {
    position: relative;
    height: 100%;
    min-height: 0;
}

/* Die Heatmap liegt absolut in diesem Kasten — ohne eigene Positionierung
   würde sie sich am nächsten positionierten Vorfahren aufhängen und aus der
   Kachel laufen. */
.bmFlaeche {
    position: absolute;
    inset: 0;
    background: var(--black-bg-2, #14141f);
    border-radius: var(--border-radius, 6px);
    overflow: hidden;
}

.bmGanzeSeite {
    position: absolute;
    right: 0.3rem;
    bottom: 0.3rem;
    z-index: 3;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.12rem 0.4rem;
    border-radius: 999px;
    font-size: 0.68rem;
    text-decoration: none;
    color: var(--white-87);
    background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.16);
}

.bmGanzeSeite:hover {
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
}
</style>
