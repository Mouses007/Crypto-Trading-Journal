<script setup>
/**
 * Senkrechte Werkzeugleiste links neben dem Chart, wie bei TradingView.
 * Ein Werkzeug gilt für das aktive Panel und schaltet sich nach dem Zeichnen
 * ab; ein zweiter Klick auf dasselbe Werkzeug bricht ab.
 */
import { useI18n } from 'vue-i18n'
import { WERKZEUGE } from '../../utils/chart/zeichnungen/werkzeuge.js'

defineProps({
    werkzeug: { type: String, default: null },
    magnet: { type: Boolean, default: false },
    versteckt: { type: Boolean, default: false },
})
const emit = defineEmits(['werkzeug', 'magnet', 'versteckt', 'alleLoeschen'])
const { t } = useI18n()
</script>

<template>
    <div class="zeichenleiste">
        <button class="w" :class="{ an: !werkzeug }" :title="t('chart.wz.zeiger')" @click="emit('werkzeug', null)">
            <i class="uil uil-mouse-alt"></i>
        </button>
        <hr />
        <template v-for="(w, i) in WERKZEUGE" :key="w.typ">
            <hr v-if="i > 0 && WERKZEUGE[i - 1].gruppe !== w.gruppe" />
            <button class="w" :class="{ an: werkzeug === w.typ }" :title="t('chart.wz.' + w.typ)"
                @click="emit('werkzeug', werkzeug === w.typ ? null : w.typ)">
                <i :class="w.icon"></i>
            </button>
        </template>
        <hr />
        <button class="w" :class="{ an: magnet }" :title="t('chart.wz.magnet')" @click="emit('magnet')">
            <i class="uil uil-magnet"></i>
        </button>
        <button class="w" :class="{ an: versteckt }" :title="t('chart.wz.allesVerstecken')" @click="emit('versteckt')">
            <i :class="versteckt ? 'uil uil-eye-slash' : 'uil uil-eye'"></i>
        </button>
        <button class="w" :title="t('chart.wz.alleLoeschen')" @click="emit('alleLoeschen')">
            <i class="uil uil-trash-alt"></i>
        </button>
    </div>
</template>

<style scoped>
.zeichenleiste {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px 2px;
    border: 1px solid var(--white-10);
    border-radius: 6px;
    background: var(--black-bg-7, #131722);
    overflow-y: auto;
}

.w {
    width: 30px;
    height: 28px;
    background: transparent;
    border: none;
    color: var(--grey-text);
    border-radius: 4px;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.w:hover {
    color: var(--white-87, #eee);
    background: var(--white-10);
}

.w.an {
    color: var(--blue-color);
    background: rgba(1, 180, 255, 0.12);
}

hr {
    width: 70%;
    margin: 3px 0;
    border-color: var(--white-18);
}
</style>
