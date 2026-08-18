<script setup>
/**
 * Symbolwahl in der Kopfzeile des Live-Trading-Fensters.
 *
 * Der grosse Symbolblock aus dem Seitenmenü (`LiveSymbolPicker`) taugt hier
 * nicht: im eigenen Fenster gibt es gar kein Seitenmenü, und er bringt neben
 * dem Symbol noch Preisband, Takt und ein Dutzend Regler mit, die zur
 * Liquidationskarte gehören — nicht in eine Kopfzeile.
 *
 * Deshalb dasselbe Prinzip, aber klein: Favoriten als Knöpfe, Suchfeld für
 * alles andere. Die Symbolliste kommt aus derselben Quelle
 * (`utils/liveSymbols.js`), damit es nicht zwei Wahrheiten darüber gibt, was
 * handelbar ist.
 *
 * Geschrieben wird in `liveSymbol` — denselben Wert lesen auch Bookmap,
 * Hebelkarte und die symbolabhängigen Kacheln. Ein Wechsel hier gilt sofort
 * überall.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { liveSymbol, FAVORITE_SYMBOLS } from '../../stores/live.js'
import { loadSymbolMeta } from '../../utils/liveSymbols.js'

const { t } = useI18n()

const offen = ref(false)
const suche = ref('')
const symbole = ref([])
const laedt = ref(false)
const wurzel = ref(null)

const kurz = (s) => String(s || '').replace(/USDT$/, '')

const treffer = computed(() => {
    const q = suche.value.trim().toUpperCase()
    if (!q) return []
    const alle = symbole.value
    const vorn = alle.filter(s => s.symbol.startsWith(q))
    const rest = alle.filter(s => !s.symbol.startsWith(q) && s.symbol.includes(q))
    return [...vorn, ...rest].slice(0, 12)
})

async function ladeSymbole() {
    if (symbole.value.length || laedt.value) return
    laedt.value = true
    try {
        const alle = await loadSymbolMeta('futures')
        symbole.value = alle.filter(s => s.quote === 'USDT')
    } finally {
        laedt.value = false
    }
}

function waehle(symbol) {
    liveSymbol.value = symbol
    suche.value = ''
    offen.value = false
}

function umschalten() {
    offen.value = !offen.value
    if (offen.value) ladeSymbole()
}

/** Klick daneben schliesst — sonst bleibt die Liste über den Kacheln stehen. */
function beiKlickAussen(e) {
    if (offen.value && wurzel.value && !wurzel.value.contains(e.target)) offen.value = false
}

onMounted(() => document.addEventListener('click', beiKlickAussen))
onBeforeUnmount(() => document.removeEventListener('click', beiKlickAussen))
</script>

<template>
    <div ref="wurzel" class="swWrap">
        <button type="button" class="swAktuell" @click.stop="umschalten">
            <i class="uil uil-coins"></i>
            <b>{{ kurz(liveSymbol) }}</b>
            <i class="uil" :class="offen ? 'uil-angle-up' : 'uil-angle-down'"></i>
        </button>

        <div v-if="offen" class="swListe" @click.stop>
            <div class="swFavoriten">
                <button v-for="s in FAVORITE_SYMBOLS" :key="s" type="button"
                    :class="['swPille', s === liveSymbol ? 'active' : '']"
                    @click="waehle(s)">{{ kurz(s) }}</button>
            </div>
            <input v-model="suche" type="text" class="swSuche"
                :placeholder="t('live.search')" @focus="ladeSymbole" />
            <div v-if="laedt" class="swHinweis">{{ t('live.loading') }}</div>
            <div v-else-if="suche && !treffer.length" class="swHinweis">{{ t('live.noMatch') }}</div>
            <button v-for="s in treffer" :key="s.symbol" type="button"
                :class="['swEintrag', s.symbol === liveSymbol ? 'active' : '']"
                @click="waehle(s.symbol)">{{ kurz(s.symbol) }}</button>
        </div>
    </div>
</template>

<style scoped>
.swWrap {
    position: relative;
}

.swAktuell {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    color: var(--white-87);
    padding: 0.12rem 0.55rem;
    font-size: 0.9rem;
    cursor: pointer;
}

.swAktuell b { color: var(--blue-color, #01B4FF); }
.swAktuell:hover { background: rgba(255, 255, 255, 0.12); }

.swListe {
    position: absolute;
    top: calc(100% + 4px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    width: 15rem;
    padding: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    background: var(--black-bg-2, #14141f);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: var(--border-radius, 6px);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
    max-height: 20rem;
    overflow-y: auto;
}

.swFavoriten {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
}

.swPille {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--white-60);
    font-size: 0.74rem;
    padding: 0.08rem 0.4rem;
    cursor: pointer;
}

.swPille.active,
.swEintrag.active {
    background: rgba(1, 180, 255, 0.18);
    border-color: rgba(1, 180, 255, 0.4);
    color: #01B4FF;
}

.swSuche {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: var(--border-radius, 6px);
    color: var(--white-87);
    padding: 0.18rem 0.4rem;
    font-size: 0.8rem;
}

.swEintrag {
    text-align: left;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--white-87);
    font-size: 0.8rem;
    padding: 0.1rem 0.35rem;
    cursor: pointer;
}

.swEintrag:hover { background: rgba(255, 255, 255, 0.08); }

.swHinweis {
    font-size: 0.74rem;
    color: var(--white-60);
    padding: 0.1rem 0.35rem;
}
</style>
