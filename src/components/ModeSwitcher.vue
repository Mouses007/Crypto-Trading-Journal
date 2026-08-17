<script setup>
/**
 * Top-Level-Umschalter zwischen Journal, Live-Analyse und (später) Agent-Trading.
 * Sitzt im SideMenu direkt unter dem Logo — der Modus steht über der Navigation,
 * nicht neben dem Seitentitel, und erbt hier das Mobile-Off-Canvas-Verhalten.
 */
import { appMode } from '../stores/ui.js'
import { MODES, modeHome } from '../config/menu.js'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

function switchMode(mode) {
    if (!mode.enabled || appMode.value === mode.id) return
    localStorage.setItem('appMode', mode.id)
    appMode.value = mode.id
    // Full-Page-Load wie setCategory()/switchBroker(): beendet zuverlässig offene
    // WebSockets und Timer der Live-Ansicht.
    window.location.href = modeHome(mode.id)
}
</script>

<template>
    <div class="mode-switch">
        <button v-for="m in MODES" :key="m.id" type="button" :disabled="!m.enabled"
            :title="m.enabled ? '' : t('modes.comingSoon')"
            :class="['mode-btn', appMode === m.id ? 'active' : '']" @click="switchMode(m)">
            <!-- Kein Symbol: bei 72 px je Feld frassen Symbol und Abstand 19 px,
                 und dann passte „Live-Analyse" nicht mehr hinein. Die drei
                 Beschriftungen sind eindeutig genug, und die aktive Fläche ist
                 ohnehin farbig hervorgehoben. -->
            <span class="mode-label" :title="t(m.titleKey)">{{ t(m.titleKey) }}</span>
            <!-- Ein PUNKT, kein Wort: „Beta" ausgeschrieben machte diesen Knopf
                 rund 30 px breiter als die anderen beiden und schob den
                 Umschalter über die Seitenleiste hinaus. Die Bedeutung trägt
                 der Titel, die ausführliche Warnung steht auf der Seite. -->
            <span v-if="m.beta" class="beta-dot" :title="t('modes.betaHint')"></span>
        </button>
    </div>
</template>

<style scoped>
/* Segmented Control statt Pillen — drei gleich breite Felder brechen nicht um. */
.mode-switch {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.15rem;
    margin: 0.6rem 0 0.2rem;
    padding: 0.2rem;
    border: 1px solid var(--white-18, rgba(255, 255, 255, 0.15));
    border-radius: 999px;
    background: var(--black-bg-7);
}

/* Fester kleiner Punkt: er darf die Breite des Knopfes nicht beeinflussen. */
.beta-dot {
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(240, 196, 25, 0.95);
}

.mode-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    font-size: 0.72rem;
    /* Waagrecht knapp: „Live-Analyse" ist die längste Beschriftung und lag mit
       0.2rem Innenabstand genau 1 px über dem Platz. Ein Pixel Reserve ist
       keine Reserve — bei anderer Schriftglättung kürzt es doch. */
    padding: 0.22rem 0.1rem;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    line-height: 1.4;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    /*
     * ENTSCHEIDEND: Rasterelemente haben von Haus aus `min-width: auto` und
     * schrumpfen deshalb nie unter ihre Inhaltsbreite. Zusammen mit `nowrap`
     * ergaben die drei Knöpfe 294 px in einem 234 px breiten Behälter — der
     * dritte ragte über die Seitenleiste hinaus. Mit `min-width: 0` gilt `1fr`
     * wirklich, und die Beschriftung kürzt sich zur Not selbst.
     */
    min-width: 0;
    overflow: hidden;
}

.mode-label {
    overflow: hidden;
    text-overflow: ellipsis;
}

.mode-btn i {
    font-size: 0.9rem;
    flex: 0 0 auto;
}

.mode-btn:hover:not(:disabled) {
    color: var(--white-87);
    background: var(--black-bg-12);
}

.mode-btn.active {
    background: var(--blue-color, #01B4FF);
    color: #fff;
    font-weight: 600;
}

.mode-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}
</style>
