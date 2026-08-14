<script setup>
/**
 * Warnbanner für den Agent-Modus.
 *
 * Der Modus handelt selbstständig — auch wenn zunächst nur auf dem Papier.
 * Wer ihn öffnet, muss ohne Nachfragen wissen, woran er ist: unfertig, keine
 * Anlageberatung, Live nur über die dreifache Freigabekette.
 *
 * Das Zuklappen wird pro Browser gemerkt (localStorage), aber bewusst NICHT
 * dauerhaft weggeklickt: bei jedem neuen Sitzungsstart erscheint der Hinweis
 * wieder. Eine Warnung, die man einmal wegklickt und nie wiedersieht, ist keine.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const SCHLUESSEL = 'agentBetaHinweisSitzung'
const offen = ref(sessionStorage.getItem(SCHLUESSEL) !== 'zu')

function zuklappen() {
    offen.value = false
    try { sessionStorage.setItem(SCHLUESSEL, 'zu') } catch (e) { /* privater Modus */ }
}
</script>

<template>
    <div v-if="offen" class="betaHinweis d-flex align-items-start gap-2 p-3 mb-3">
        <i class="uil uil-exclamation-triangle betaIcon"></i>
        <div class="flex-fill">
            <div class="betaTitel mb-1">
                {{ t('strategies.betaTitle') }}
                <span class="betaBadge ms-1">Beta</span>
            </div>
            <p class="mb-1 small">{{ t('strategies.betaBody') }}</p>
            <ul class="mb-0 small ps-3">
                <li>{{ t('strategies.betaPoint1') }}</li>
                <li>{{ t('strategies.betaPoint2') }}</li>
                <li>{{ t('strategies.betaPoint3') }}</li>
            </ul>
        </div>
        <button class="btn btn-sm btn-link text-muted p-0" :title="t('strategies.betaDismiss')"
                @click="zuklappen">
            <i class="uil uil-times"></i>
        </button>
    </div>
</template>

<style scoped>
.betaHinweis {
    border: 1px solid rgba(240, 196, 25, 0.45);
    border-left-width: 3px;
    border-radius: var(--border-radius);
    background: rgba(240, 196, 25, 0.07);
}

.betaIcon {
    color: rgba(240, 196, 25, 0.95);
    font-size: 1.2rem;
    line-height: 1.4;
}

.betaTitel {
    font-weight: 600;
    color: var(--white-87);
}

.betaBadge {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.1rem 0.4rem;
    border-radius: 0.6rem;
    background: rgba(240, 196, 25, 0.2);
    color: rgba(240, 196, 25, 0.95);
    vertical-align: middle;
}
</style>
