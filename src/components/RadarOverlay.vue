<script setup>
/**
 * Gross-Ansicht einer Kachel.
 *
 * Gleiches Muster wie `PageInfo.vue`: Teleport an den Body, damit weder das
 * Kachelraster noch ein `overflow` der Kopfzeile den Kasten beschneidet.
 * Bewusst kein Bootstrap-Modal — dessen Einblend-Animation ändert die Breite
 * nachträglich, und ein ECharts-Chart darin wäre beim ersten Zeichnen zu schmal.
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

defineProps({
    titel: { type: String, default: '' },
    /** Herkunft der Daten, klein in der Fusszeile */
    quelle: { type: String, default: '' },
})

const emit = defineEmits(['schliessen'])

const { t } = useI18n()
const boxEl = ref(null)

function beiTaste(e) {
    if (e.key === 'Escape') emit('schliessen')
}

onMounted(() => boxEl.value?.focus())
</script>

<template>
    <Teleport to="body">
        <div class="radarOverlay" tabindex="0" ref="boxEl" @click.self="emit('schliessen')" @keydown="beiTaste">
            <div class="radarOverlayBox">
                <div class="radarOverlayHead">
                    <h5>{{ titel }}</h5>
                    <button type="button" class="radarOverlayClose" :title="t('common.close')"
                        @click="emit('schliessen')">
                        <i class="uil uil-times"></i>
                    </button>
                </div>

                <div class="radarOverlayBody">
                    <slot></slot>
                </div>

                <div v-if="quelle" class="radarOverlayFuss">{{ quelle }}</div>
            </div>
        </div>
    </Teleport>
</template>
