<script setup>
/**
 * Symbolsuche: Binance Futures und Spot, dazu die Kennzeichen, auf welcher
 * Handelsbörse der Coin wirklich gehandelt werden kann (BX/BG/PX).
 *
 * Das Kennzeichen hängt an der Basiswährung, nicht am vollen Symbol — Binance
 * und Bitunix schreiben Kleinstpreis-Coins nicht immer gleich (`1000PEPE` vs.
 * `PEPE`), deshalb wird beides geprüft, wie in `pruefeListung` auf dem Server.
 */
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { loadSymbolMeta } from '../../utils/liveSymbols.js'

const props = defineProps({
    symbol: { type: String, default: '' },
    markt: { type: String, default: 'futures' },
    // Watchlist: ohne eigenen Knopf (geöffnet von aussen) und als Teil der Leiste statt schwebend —
    // eine schwebende Liste würde am Rand der Seitenleiste abgeschnitten.
    ohneKnopf: { type: Boolean, default: false },
    eingebettet: { type: Boolean, default: false },
})
const emit = defineEmits(['waehle', 'zu'])
const { t } = useI18n()

const offen = ref(false)
const suche = ref('')
const feld = ref(null)
const markiert = ref(0)
const futures = ref([])
const spot = ref([])
const handelbar = ref({ bitunix: null, bitget: null, pionex: null })

const BOERSEN = [
    { id: 'bitunix', kurz: 'BX' },
    { id: 'bitget', kurz: 'BG' },
    { id: 'pionex', kurz: 'PX' },
]

const sets = computed(() => {
    const aus = {}
    for (const b of BOERSEN) aus[b.id] = handelbar.value[b.id] ? new Set(handelbar.value[b.id]) : null
    return aus
})

/*
 * Kennzeichen nur für USDT-Perpetuals: Bitunix, Bitget und Pionex führen
 * USDT-margined Kontrakte. Hinge das Kennzeichen nur an der Basis, trüge auch
 * SOLUSDC „BX" — handelbar ist dort aber SOLUSDT.
 */
function boersenFuer(s) {
    if (s.markt !== 'futures' || s.quote !== 'USDT') return []
    const base = s.base
    const ohne = base.replace(/^1000+/, '')
    return BOERSEN.filter((b) => {
        const s = sets.value[b.id]
        return s && (s.has(base) || s.has(ohne) || s.has(`1000${ohne}`))
    })
}

const treffer = computed(() => {
    const q = suche.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    const alle = [
        ...futures.value.map((s) => ({ ...s, markt: 'futures' })),
        ...spot.value.filter((s) => s.quote === 'USDT' || s.quote === 'USDC').map((s) => ({ ...s, markt: 'spot' })),
    ]
    let liste = q ? alle.filter((s) => s.symbol.includes(q)) : alle
    // Genaue und vorn beginnende Treffer zuerst, Futures vor Spot.
    // Rang: genauer Treffer vor Anfangstreffer vor Rest; darin USDT vor
    // anderen Quotes und Futures vor Spot. USDT zuerst, weil das die Paare
    // sind, die auf den eigenen Börsen gehandelt werden.
    liste = liste.map((s) => ({
        ...s,
        rang: (s.symbol === q || s.base === q || s.symbol === q + 'USDT' ? 0 : s.symbol.startsWith(q) || s.base.startsWith(q) ? 1 : 2) * 4
            + (s.quote === 'USDT' ? 0 : 2) + (s.markt === 'futures' ? 0 : 1),
    })).sort((a, b) => a.rang - b.rang || a.symbol.localeCompare(b.symbol))
    return liste.slice(0, 60)
})

watch(suche, () => { markiert.value = 0 })

async function oeffne() {
    offen.value = true
    suche.value = ''
    await nextTick()
    feld.value?.focus()
}

function waehle(s) {
    if (!s) return
    emit('waehle', { symbol: s.symbol, markt: s.markt })
    offen.value = false
}

function taste(e) {
    if (e.key === 'ArrowDown') { markiert.value = Math.min(markiert.value + 1, treffer.value.length - 1); e.preventDefault() }
    else if (e.key === 'ArrowUp') { markiert.value = Math.max(markiert.value - 1, 0); e.preventDefault() }
    else if (e.key === 'Enter') waehle(treffer.value[markiert.value])
    else if (e.key === 'Escape') offen.value = false
}

onMounted(async () => {
    const [f, s] = await Promise.all([loadSymbolMeta('futures'), loadSymbolMeta('spot')])
    futures.value = f
    spot.value = s
    try {
        const { data } = await axios.get('/api/chart/handelbar')
        handelbar.value = data
    } catch { /* ohne Kennzeichen weiter */ }
})

defineExpose({ oeffne, schliesse: () => { offen.value = false }, istOffen: () => offen.value })
</script>

<template>
    <div class="symbolSuche">
        <button v-if="!ohneKnopf" class="knopf" @click="oeffne" :title="t('chart.symbolSuchen')">
            <i class="uil uil-search"></i>
            <span class="sym">{{ symbol }}</span>
            <span class="markt">{{ markt === 'spot' ? 'Spot' : 'Perp' }}</span>
        </button>
        <div v-if="offen && !eingebettet" class="hintergrund" @click="offen = false"></div>
        <div v-if="offen" class="liste" :class="{ eingebettet }">
            <input ref="feld" v-model="suche" class="form-control form-control-sm" :placeholder="t('chart.symbolPlatzhalter')"
                @keydown="taste" />
            <div class="zeilen">
                <div v-for="(s, i) in treffer" :key="s.markt + s.symbol" class="zeile" :class="{ markiert: i === markiert }"
                    @mouseenter="markiert = i" @click="waehle(s)">
                    <span class="sym">{{ s.symbol }}</span>
                    <span class="chip" :class="s.markt">{{ s.markt === 'spot' ? 'Spot' : 'Perp' }}</span>
                    <span class="boersen">
                        <span v-for="b in boersenFuer(s)" :key="b.id" class="badge"
                            :title="t('chart.handelbarAuf', { boerse: b.id })">{{ b.kurz }}</span>
                    </span>
                </div>
                <div v-if="!treffer.length" class="leer">{{ t('chart.keinTreffer') }}</div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.symbolSuche {
    position: relative;
}

.knopf {
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 1px solid var(--white-10);
    border-radius: 6px;
    padding: 3px 10px;
    color: var(--white-87, #eee);
    font-size: 13px;
}

.knopf .sym {
    font-weight: 600;
}

.knopf .markt {
    color: var(--grey-text);
    font-size: 11px;
}

.hintergrund {
    position: fixed;
    inset: 0;
    z-index: 40;
}

.liste {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 41;
    width: 340px;
    max-width: calc(100vw - 32px);
    background: var(--black-bg-5, #1e222d);
    border: 1px solid var(--white-18);
    border-radius: 8px;
    padding: 8px;
    box-shadow: var(--shadow-sm);
}

.liste.eingebettet {
    position: static;
    width: 100%;
    max-width: none;
    box-shadow: none;
}

.zeilen {
    max-height: 360px;
    overflow-y: auto;
    margin-top: 6px;
}

.zeile {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}

.zeile.markiert {
    background: rgba(1, 180, 255, 0.12);
}

.zeile .sym {
    flex: 1;
    font-weight: 500;
}

.chip {
    font-size: 10px;
    padding: 0 5px;
    border-radius: 3px;
    background: var(--white-10);
    color: var(--grey-text);
}

.chip.futures {
    color: var(--blue-color);
}

.badge {
    font-size: 9px;
    margin-left: 3px;
    background: rgba(38, 166, 154, 0.2);
    color: var(--green);
}

.leer {
    color: var(--grey-text);
    padding: 8px;
    font-size: 12px;
}
</style>
