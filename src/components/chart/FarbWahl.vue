<script setup>
/**
 * Farbfeld mit Vorschlägen wie bei TradingView: ein Klick öffnet eine Palette
 * (Grautöne und zehn Farbtöne in vier Helligkeiten), darunter „Eigene Farbe"
 * mit dem Farbwähler des Systems. Vorher gab es nur diesen — für „dasselbe
 * Gelb wie die EMA daneben" musste man Werte abtippen.
 *
 * Die Palette hängt per Teleport am <body> mit festen Koordinaten (wie
 * InfoTipp/PageInfo): im Dialog scrollt die Formularspalte und schnitte sie ab.
 */
import { ref, computed, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
    modelValue: { type: String, default: '#29b6f6' },
    titel: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])
const { t } = useI18n()

const GRAU = ['#ffffff', '#d1d4dc', '#b2b5be', '#9598a1', '#787b86', '#5d606b', '#434651', '#2a2e39', '#1e222d', '#000000']
const TOENE = ['#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63']

function mische(hex, ziel, anteil) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(ziel.slice(1), 16)
    const k = (x, s) => (x >> s) & 255
    const m = (s) => Math.round(k(a, s) + (k(b, s) - k(a, s)) * anteil)
    return '#' + [16, 8, 0].map((s) => m(s).toString(16).padStart(2, '0')).join('')
}
const ZEILEN = [
    GRAU,
    TOENE.map((h) => mische(h, '#ffffff', 0.6)),
    TOENE.map((h) => mische(h, '#ffffff', 0.3)),
    TOENE,
    TOENE.map((h) => mische(h, '#000000', 0.35)),
]

/** rgba(…)/kurze Formen → #rrggbb für den System-Farbwähler. */
function alsHex(f) {
    if (/^#[0-9a-f]{6}$/i.test(f || '')) return f.toLowerCase()
    const m = String(f || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (m) return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')
    return '#29b6f6'
}
const hex = computed(() => alsHex(props.modelValue))

const offen = ref(false)
const knopf = ref(null)
const pos = ref({ top: 0, left: 0 })
const BREITE = 236

async function oeffne() {
    if (offen.value) { offen.value = false; return }
    const r = knopf.value.getBoundingClientRect()
    const links = Math.min(window.innerWidth - BREITE - 8, Math.max(8, r.right - BREITE))
    const unten = r.bottom + 6
    pos.value = { top: unten + 190 > window.innerHeight ? Math.max(8, r.top - 196) : unten, left: links }
    offen.value = true
    await nextTick()
    document.addEventListener('mousedown', draussen, true)
    document.addEventListener('keydown', esc, true)
}
function zu() {
    offen.value = false
    document.removeEventListener('mousedown', draussen, true)
    document.removeEventListener('keydown', esc, true)
}
function draussen(e) {
    if (e.target.closest?.('.farbPalette') || knopf.value?.contains(e.target)) return
    zu()
}
// Esc schliesst nur die Palette, nicht den Dialog dahinter
function esc(e) { if (e.key === 'Escape') { e.stopPropagation(); zu() } }
function waehle(f) { emit('update:modelValue', f); zu() }
onBeforeUnmount(zu)
</script>

<template>
    <button ref="knopf" type="button" class="farbFeld" :title="titel" :aria-label="titel" @click="oeffne">
        <span :style="{ background: modelValue }"></span>
    </button>
    <Teleport to="body">
        <div v-if="offen" class="farbPalette" :style="{ top: pos.top + 'px', left: pos.left + 'px', width: BREITE + 'px' }">
            <div v-for="(zeile, i) in ZEILEN" :key="i" class="pZeile">
                <button v-for="f in zeile" :key="f" type="button" class="pFeld" :class="{ an: f === hex }" :style="{ background: f }"
                    :title="f" :aria-label="f" @click="waehle(f)"></button>
            </div>
            <label class="eigene">
                <input type="color" :value="hex" @input="emit('update:modelValue', $event.target.value)" />
                {{ t('chart.farbeEigene') }}
            </label>
        </div>
    </Teleport>
</template>

<style scoped>
.farbFeld {
    width: 46px;
    height: 26px;
    padding: 3px;
    border-radius: 6px;
    border: 1px solid var(--white-18);
    background: var(--black-bg-5, #1e222d);
    cursor: pointer;
}

.farbFeld span {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 3px;
}

.farbPalette {
    position: fixed;
    z-index: 3000;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid var(--white-18);
    background: var(--black-bg-5, #1e222d);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 3px;
}

.pZeile {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: 3px;
}

.pFeld {
    aspect-ratio: 1;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 0;
    cursor: pointer;
}

.pFeld:hover {
    transform: scale(1.15);
}

.pFeld.an {
    outline: 2px solid #fff;
    outline-offset: 1px;
}

.eigene {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--grey-text);
    cursor: pointer;
}

.eigene input {
    width: 28px;
    height: 20px;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
}
</style>
