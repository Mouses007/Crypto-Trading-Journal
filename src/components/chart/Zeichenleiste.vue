<script setup>
/**
 * Senkrechte Werkzeugleiste links neben dem Chart, wie bei TradingView.
 * Ein Werkzeug gilt für das aktive Panel und schaltet sich nach dem Zeichnen
 * ab; ein zweiter Klick auf dasselbe Werkzeug bricht ab.
 *
 * Ausklappbar: ausgeklappt steht der Name neben jedem Symbol. Der Zustand
 * bleibt im Browser — er hängt am Bildschirm, nicht am Layout.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { WERKZEUGE } from '../../utils/chart/zeichnungen/werkzeuge.js'

defineProps({
    werkzeug: { type: String, default: null },
    magnet: { type: Boolean, default: false },
    versteckt: { type: Boolean, default: false },
})
const emit = defineEmits(['werkzeug', 'magnet', 'versteckt', 'alleLoeschen'])
const { t } = useI18n()

const SCHLUESSEL = 'chartWerkzeugeOffen'
function lese() {
    try { return localStorage.getItem(SCHLUESSEL) === '1' } catch { return false }
}
const offen = ref(lese())
function umschalten() {
    offen.value = !offen.value
    try { localStorage.setItem(SCHLUESSEL, offen.value ? '1' : '0') } catch { /* kein Speicher */ }
}
</script>

<template>
    <div class="zeichenleiste" :class="{ offen }">
        <button class="w klappe" :title="t(offen ? 'chart.wzKurz.einklappen' : 'chart.wzKurz.ausklappen')" @click="umschalten">
            <i :class="offen ? 'uil uil-angle-double-left' : 'uil uil-angle-double-right'"></i>
            <span v-if="offen" class="name">{{ t('chart.wzKurz.einklappen') }}</span>
        </button>
        <hr />
        <button class="w" :class="{ an: !werkzeug }" :title="t('chart.wz.zeiger')" @click="emit('werkzeug', null)">
            <i class="uil uil-mouse-alt"></i>
            <span v-if="offen" class="name">{{ t('chart.wz.zeiger') }}</span>
        </button>
        <hr />
        <template v-for="(w, i) in WERKZEUGE" :key="w.typ">
            <hr v-if="i > 0 && WERKZEUGE[i - 1].gruppe !== w.gruppe" />
            <button class="w" :class="{ an: werkzeug === w.typ }" :title="t('chart.wz.' + w.typ)"
                @click="emit('werkzeug', werkzeug === w.typ ? null : w.typ)">
                <i :class="w.icon"></i>
                <span v-if="offen" class="name">{{ t('chart.wz.' + w.typ) }}</span>
            </button>
        </template>
        <hr />
        <button class="w" :class="{ an: magnet }" :title="t('chart.wz.magnet')" @click="emit('magnet')">
            <!-- Eigenes Symbol: `uil-magnet` gibt es im geladenen Unicons-Satz nicht (der Knopf war leer). -->
            <svg class="svgSymbol" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 3h4v8a2 2 0 0 0 4 0V3h4v8a6 6 0 0 1-12 0V3z" fill="none" stroke="currentColor" stroke-width="1.8"
                    stroke-linejoin="round" />
                <path d="M6 7h4M14 7h4" stroke="currentColor" stroke-width="1.8" />
            </svg>
            <span v-if="offen" class="name">{{ t('chart.wzKurz.magnet') }}</span>
        </button>
        <button class="w" :class="{ an: versteckt }" :title="t('chart.wz.allesVerstecken')" @click="emit('versteckt')">
            <i :class="versteckt ? 'uil uil-eye-slash' : 'uil uil-eye'"></i>
            <span v-if="offen" class="name">{{ t(versteckt ? 'chart.wzKurz.einblenden' : 'chart.wzKurz.ausblenden') }}</span>
        </button>
        <button class="w" :title="t('chart.wz.alleLoeschen')" @click="emit('alleLoeschen')">
            <i class="uil uil-trash-alt"></i>
            <span v-if="offen" class="name">{{ t('chart.wzKurz.alleLoeschen') }}</span>
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
    overflow-x: hidden;
}

.zeichenleiste.offen {
    align-items: stretch;
    width: 172px;
    padding: 4px;
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

.offen .w {
    width: 100%;
    justify-content: flex-start;
    gap: 8px;
    padding: 0 6px;
}

.offen .w > i,
.offen .w > .svgSymbol {
    width: 18px;
    flex-shrink: 0;
    text-align: center;
}

.name {
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.svgSymbol {
    width: 16px;
    height: 16px;
}

.klappe {
    color: var(--grey-text);
    opacity: 0.8;
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

.offen hr {
    width: auto;
    margin: 3px 4px;
}
</style>
