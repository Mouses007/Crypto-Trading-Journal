<script setup>
/**
 * Kachel „Altcoin-Season-Index".
 *
 * Anteil der grössten Altcoins, die Bitcoin über das Zeitfenster geschlagen
 * haben. Über 75 % nennt man das Altcoin-Saison, unter 25 % Bitcoin-Saison —
 * die Schwellen stammen vom ursprünglichen Index und sind gesetzt, nicht
 * hergeleitet.
 *
 * Der Wert allein ist wenig wert, deshalb stehen die Namen daneben: welche
 * Coins die Aussage tragen, kann man so nachprüfen statt glauben.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { liveSymbol } from '../../stores/live.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const emit = defineEmits(['params'])

const { t } = useI18n()

const FENSTER = [30, 90]

const index = computed(() => props.daten?.index ?? null)

/** Farbe folgt der Lage: Bitcoin-Saison orange, Altcoin-Saison blau. */
const farbe = computed(() => {
    const i = index.value
    if (i === null) return 'var(--white-60)'
    if (i >= 75) return '#01B4FF'
    if (i <= 25) return '#f7931a'
    return '#9aa0aa'
})

const proz = (v) => `${v > 0 ? '+' : ''}${v} %`
</script>

<template>
    <div v-if="daten" class="asWrap" :class="{ gross }">
        <div class="asLeiste">
            <span class="asLeisteLabel">{{ t('marktradar.altseason.window') }}</span>
            <button v-for="f in FENSTER" :key="f" type="button"
                :class="['ctl-pill', daten.fenster === f ? 'active' : '']"
                @click.stop="emit('params', { tage: f })">{{ f }} T</button>
        </div>

        <div class="asKopf">
            <span class="asWert" :style="{ color: farbe }">{{ index === null ? '—' : index }}</span>
            <span class="asLage" :style="{ color: farbe }">
                {{ daten.lage ? t('marktradar.altseason.state_' + daten.lage) : '' }}
            </span>
        </div>

        <!-- Skala mit den beiden gesetzten Schwellen -->
        <div class="asSkala">
            <div class="asZone bitcoin"></div>
            <div class="asZone mitte"></div>
            <div class="asZone altcoin"></div>
            <div v-if="index !== null" class="asMarke" :style="{ left: index + '%' }"></div>
        </div>
        <div class="asSkalaText">
            <span>{{ t('marktradar.altseason.state_bitcoin') }}</span>
            <span>25</span><span>75</span>
            <span>{{ t('marktradar.altseason.state_altcoin') }}</span>
        </div>

        <p class="asSatz">
            {{ t('marktradar.altseason.summary', {
                besser: daten.besser, n: daten.gezaehlt, tage: daten.fenster, btc: proz(daten.btcWandel)
            }) }}
        </p>

        <div v-if="gross" class="asListen">
            <div>
                <div class="asTitel">{{ t('marktradar.altseason.best') }}</div>
                <div v-for="w in daten.oben" :key="w.symbol" class="asZeile" @click="liveSymbol = w.perp">
                    <span>{{ w.symbol }}</span><b class="up">{{ proz(w.wandel) }}</b>
                </div>
            </div>
            <div>
                <div class="asTitel">{{ t('marktradar.altseason.worst') }}</div>
                <div v-for="w in daten.unten" :key="w.symbol" class="asZeile" @click="liveSymbol = w.perp">
                    <span>{{ w.symbol }}</span><b class="down">{{ proz(w.wandel) }}</b>
                </div>
            </div>
        </div>

        <p v-if="gross" class="asQuelle">{{ t('marktradar.altseason.source') }}</p>
    </div>
</template>

<style scoped>
.asWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.asLeiste {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding-bottom: 0.35rem;
}

.asLeiste .ctl-pill {
    padding: 0.05rem 0.45rem;
    font-size: 0.74rem;
}

.asLeisteLabel {
    font-size: 0.72rem;
    color: var(--white-60);
    margin-right: 0.15rem;
}

.asKopf {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
}

.asWert {
    font-size: 2.2rem;
    font-weight: 700;
    line-height: 1.1;
}

.asLage {
    font-size: 0.9rem;
    font-weight: 600;
}

.asSkala {
    position: relative;
    display: flex;
    height: 10px;
    margin: 0.5rem 0 0.2rem;
    border-radius: 3px;
    overflow: hidden;
}

.asZone.bitcoin {
    width: 25%;
    background: rgba(247, 147, 26, 0.55);
}

.asZone.mitte {
    width: 50%;
    background: rgba(255, 255, 255, 0.12);
}

.asZone.altcoin {
    width: 25%;
    background: rgba(1, 180, 255, 0.55);
}

/* Der Zeiger sitzt genau auf dem Indexwert */
.asMarke {
    position: absolute;
    top: -3px;
    width: 3px;
    height: 16px;
    margin-left: -1.5px;
    background: #fff;
    border-radius: 2px;
}

.asSkalaText {
    display: flex;
    justify-content: space-between;
    font-size: 0.7rem;
    color: var(--white-60);
}

.asSatz {
    margin: 0.5rem 0 0;
    font-size: 0.82rem;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
}

.asListen {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.2rem;
    margin-top: 0.8rem;
}

.asTitel {
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--white-60);
    margin-bottom: 0.2rem;
}

.asZeile {
    display: flex;
    justify-content: space-between;
    font-size: 0.86rem;
    padding: 0.12rem 0;
    cursor: pointer;
    font-variant-numeric: tabular-nums;
}

.asZeile:hover {
    background: var(--black-bg-12, rgba(255, 255, 255, 0.05));
}

.up {
    color: rgb(38, 190, 150);
}

.down {
    color: rgb(255, 95, 86);
}

.asQuelle {
    margin: 0.7rem 0 0;
    font-size: 0.78rem;
    color: var(--white-60);
}
</style>
