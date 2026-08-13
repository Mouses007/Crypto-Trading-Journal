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
            <i :class="m.icon"></i><span>{{ t(m.titleKey) }}</span>
        </button>
    </div>
</template>

<style scoped>
/* Segmented Control statt Pillen — drei gleich breite Felder brechen nicht um. */
.mode-switch {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.25rem;
    margin: 0.6rem 0 0.2rem;
    padding: 0.2rem;
    border: 1px solid var(--white-18, rgba(255, 255, 255, 0.15));
    border-radius: 999px;
    background: var(--black-bg-7);
}

.mode-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    font-size: 0.74rem;
    padding: 0.22rem 0.3rem;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    line-height: 1.4;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
}

.mode-btn i {
    font-size: 0.9rem;
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
