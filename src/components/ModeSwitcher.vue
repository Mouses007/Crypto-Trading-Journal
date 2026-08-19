<script setup>
/**
 * Top-Level-Umschalter zwischen den App-Modi (Start, Journal, Live-Analyse,
 * Strategien, Research).
 *
 * - `wide` (Default): breite Pillen mit Icon UND Text nebeneinander, als
 *   horizontale Leiste unter dem Seitentitel. Auf dem Desktop volle
 *   Beschriftung, auf dem Telefon die Kurzform, damit alle fünf in eine Reihe
 *   passen.
 * - `stack`: dieselben Modi als schmales Raster (Icon über Kurzlabel), falls
 *   sie in eine enge Spalte müssen.
 */
import { computed } from 'vue'
import { appMode, screenType, pageId } from '../stores/ui.js'
import { currentUser } from '../stores/settings.js'
import { MODES, modeHome, pageById } from '../config/menu.js'
import { useI18n } from 'vue-i18n'

const props = defineProps({
    variant: { type: String, default: 'wide' },
})

const { t } = useI18n()

// „Beta-Funktionen ausblenden" (Layout & Stil) entfernt die als `versteckbar`
// markierten Modi (Strategien, Research) aus dem Umschalter. Ist die Startseite
// abgeschaltet (`startseiteAn = 0`), fällt zusätzlich der Start-Tab weg.
const sichtbareModi = computed(() => {
    const aus = Number(currentUser.value?.betaAusblenden ?? 0) === 1
    const startAus = Number(currentUser.value?.startseiteAn ?? 1) === 0
    let modi = aus ? MODES.filter(m => !m.versteckbar) : MODES
    if (startAus) modi = modi.filter(m => m.id !== 'start')
    return modi
})

// Breite Variante: volle Beschriftung, ausser auf dem Telefon — dort die
// Kurzform, sonst passen fünf Pillen nicht nebeneinander.
function labelFor(mode) {
    if (props.variant === 'wide' && screenType.value !== 'mobile') return t(mode.titleKey)
    return t(mode.shortKey || mode.titleKey)
}

function switchMode(mode) {
    if (!mode.enabled) return
    // Nur nichts tun, wenn man WIRKLICH schon auf einer Seite dieses Modus ist.
    // Auf modusneutralen Seiten (Einstellungen, Konten) ist appMode zwar noch
    // z.B. „journal", die Seite gehört aber keinem Modus — dann muss ein Klick
    // auf „Journal" zur Journal-Startseite führen, nicht ins Leere.
    const aktuellerSeitenModus = pageById(pageId.value)?.mode ?? null
    if (aktuellerSeitenModus === mode.id) return
    localStorage.setItem('appMode', mode.id)
    appMode.value = mode.id
    // Full-Page-Load wie setCategory()/switchBroker(): beendet zuverlässig offene
    // WebSockets und Timer der Live-Ansicht.
    window.location.href = modeHome(mode.id)
}
</script>

<template>
    <div :class="['mode-switch', variant]" :style="{ '--mode-count': sichtbareModi.length }">
        <button v-for="m in sichtbareModi" :key="m.id" type="button" :disabled="!m.enabled"
            :title="m.enabled ? (m.beta ? t('modes.betaHint') : '') : t('modes.comingSoon')"
            :class="['mode-btn', appMode === m.id ? 'active' : '']" @click="switchMode(m)">
            <i :class="m.icon"></i>
            <span class="mode-label">{{ labelFor(m) }}</span>
            <!-- Klein ausgeschrieben statt nur ein Punkt: macht den Beta-Status
                 lesbar; die ausführliche Warnung steht dann auf der Seite. -->
            <span v-if="m.beta" class="beta-dot">Beta</span>
        </button>
    </div>
</template>

<style scoped>
/* ── Breite Leiste: Pillen mit Icon + Text nebeneinander ── */
.mode-switch.wide {
    display: flex;
    /* Telefon: bricht bei Bedarf auf zwei Reihen um, damit alle fünf sichtbar
       bleiben. Desktop hält sie unten in einer gestreckten Reihe. */
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.4rem;
    /* Unten 6px mehr Luft zwischen Buttons und Trennlinie. */
    padding: 0.2rem 0.75rem calc(0.7rem + 6px);
    border-bottom: 1px solid var(--white-18);
}

.mode-switch.wide .mode-btn {
    /* Telefon: natürliche Breite nebeneinander (kein Abschneiden), notfalls
       scrollt die Leiste. Desktop streckt sie unten auf volle Breite. */
    flex: 0 0 auto;
    flex-direction: row;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.42rem 0.7rem;
    border: 1px solid var(--white-18, rgba(255, 255, 255, 0.15));
    border-radius: 8px;
    white-space: nowrap;
}

@media (min-width: 992px) {
    .mode-switch.wide {
        flex-wrap: nowrap;
    }
    .mode-switch.wide .mode-btn {
        flex: 1 1 0;
    }
}

.mode-switch.wide .mode-btn i {
    font-size: 1.15rem;
}

.mode-switch.wide .mode-label {
    font-size: 0.82rem;
}

.mode-switch.wide .mode-btn.active {
    border-color: var(--blue-color, #01B4FF);
}

.mode-switch.wide .beta-dot {
    position: static;
    flex: 0 0 auto;
}

/* ── Raster-Fassung für schmale Spalten ── */
.mode-switch.stack {
    display: grid;
    grid-template-columns: repeat(var(--mode-count, 5), auto);
    justify-content: space-between;
    gap: 2px;
    padding: 0.5rem 0.3rem;
    border-bottom: 1px solid var(--white-18);
}

.mode-btn {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 0;
    padding: 0.3rem 0.1rem 0.25rem;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    cursor: pointer;
    transition: all 0.15s ease;
}

.mode-btn i {
    font-size: 1.05rem;
    line-height: 1;
}

.mode-label {
    font-size: 0.66rem;
    line-height: 1.3;
    white-space: nowrap;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
}

.mode-btn:hover:not(:disabled) {
    color: var(--white-87);
    background: var(--black-bg-12);
}

.mode-btn.active {
    background: var(--blue-color, #01B4FF);
    color: #fff;
}

.mode-btn.active .mode-label {
    font-weight: 600;
}

.mode-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}

.beta-dot {
    position: absolute;
    top: 2px;
    right: 4px;
    font-size: 0.6rem;
    font-weight: 600;
    line-height: 1;
    padding: 0.12rem 0.3rem;
    border-radius: 0.5rem;
    background: rgba(240, 196, 25, 0.22);
    color: rgba(240, 196, 25, 0.95);
}
</style>
