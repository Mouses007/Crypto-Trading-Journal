<script setup>
/**
 * Kachel „Wal-Bewegungen" — grosse Krypto-Transaktionen aus den eigenen
 * Telegram-Quellen (Whale Alert, Lookonchain, …), erkannt von `wal-parser.js`.
 *
 * Farblogik wie bei Liquidationen: rot = potenzieller Verkaufsdruck (die
 * Bewegung geht AUF eine Börse zu, der Coin wird handelbar), grün = potenzielle
 * Verwahrung (die Bewegung geht von einer Börse WEG). Erkennt der Parser keine
 * Seite als Börse, bleibt es grau statt geraten — siehe `richtungAus()` im
 * Server-Parser.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from '../../utils/dayjs-setup.js'

const props = defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()
const emit = defineEmits(['params'])

const ROT = 'rgb(255, 95, 86)'
const GRUEN = 'rgb(38, 190, 150)'

const transaktionen = computed(() => props.daten?.transaktionen || [])
const angezeigt = computed(() => props.gross ? transaktionen.value : transaktionen.value.slice(0, 6))
const fenster = computed(() => props.daten?.fenster || 24)

function setzeFenster(stunden) {
    emit('params', { stunden })
}

const geld = (v) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)} Mrd` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} Mio` : `${Math.round(v / 1000)}k`)

const richtungFarbe = (r) => (r === 'ein' ? ROT : r === 'aus' ? GRUEN : 'var(--white-60)')
const richtungIcon = (r) => (r === 'ein' ? 'uil-arrow-circle-right' : r === 'aus' ? 'uil-arrow-circle-left' : 'uil-question-circle')
const richtungTitel = (r) => t(`marktradar.wal.richtung.${r}`)
</script>

<template>
    <div v-if="daten" class="walWrap" :class="{ gross }">
        <!-- Keine Quelle eingeschaltet ist kein Fehler, sondern die Vorgabe:
             die Kachel liest nur mit, was unter Einstellungen → Nachrichten
             aktiv ist. -->
        <div v-if="!daten.aktiveQuellen" class="walAus">
            <i class="uil uil-anchor"></i>
            <p>{{ t('marktradar.wal.inactive') }}</p>
            <router-link to="/settings" class="ctl-pill">{{ t('marktradar.wal.toSettings') }}</router-link>
        </div>

        <template v-else>
            <div class="walLeiste">
                <span class="walLeisteLabel">{{ t('marktradar.wal.window') }}</span>
                <button type="button" :class="['ctl-pill', fenster === 24 ? 'active' : '']"
                    @click.stop="setzeFenster(24)">24 h</button>
                <button type="button" :class="['ctl-pill', fenster === 168 ? 'active' : '']"
                    @click.stop="setzeFenster(168)">7 T</button>
            </div>

            <p v-if="!transaktionen.length" class="walLeer">
                {{ t('marktradar.wal.empty') }}
            </p>

            <div v-else class="walListe">
                <div v-for="(tx, i) in angezeigt" :key="i" class="walZeile">
                    <i class="uil" :class="richtungIcon(tx.richtung)" :style="{ color: richtungFarbe(tx.richtung) }"
                        :title="richtungTitel(tx.richtung)"></i>
                    <span class="walSymbol">{{ tx.symbol }}</span>
                    <span class="walUsd">{{ geld(tx.usdWert) }} $</span>
                    <span class="walGegenpartei">{{ tx.gegenpartei || '—' }}</span>
                    <span class="walZeit">{{ dayjs(tx.zeit).format('DD.MM. HH:mm') }}</span>
                    <a v-if="tx.url" :href="tx.url" target="_blank" rel="noopener noreferrer" class="walLink"
                        :title="tx.quelle" @click.stop>
                        <i class="uil uil-external-link-alt"></i>
                    </a>
                </div>
            </div>

            <template v-if="gross">
                <p class="walQuelle">
                    {{ t('marktradar.wal.source', { schwelle: geld(daten.schwelle) }) }}
                </p>
            </template>
        </template>
    </div>
</template>

<style scoped>
.walWrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.walAus {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    text-align: center;
    font-size: 0.82rem;
    color: var(--white-60);
}

.walAus i {
    font-size: 1.5rem;
    opacity: 0.5;
}

.walAus p {
    margin: 0;
    max-width: 22rem;
}

.walLeiste {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding-bottom: 0.35rem;
}

.walLeiste .ctl-pill {
    padding: 0.05rem 0.45rem;
    font-size: 0.74rem;
}

.walLeisteLabel {
    font-size: 0.72rem;
    color: var(--white-60);
    margin-right: 0.15rem;
}

.walLeer {
    margin: 0.4rem 0 0;
    font-size: 0.8rem;
    color: var(--white-60);
}

.walListe {
    flex: 1 1 auto;
    overflow-y: auto;
    min-height: 0;
}

.walZeile {
    display: grid;
    grid-template-columns: 1.1rem 3.2rem 4.2rem 1fr auto 1.2rem;
    align-items: center;
    gap: 0.5rem;
    padding: 0.28rem 0;
    font-size: 0.82rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.walZeile:last-child {
    border-bottom: none;
}

.walZeile i {
    font-size: 0.95rem;
}

.walSymbol {
    font-weight: 600;
    color: var(--white-87);
}

.walUsd {
    font-variant-numeric: tabular-nums;
    color: var(--white-87);
}

.walGegenpartei {
    color: var(--white-60);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.walZeit {
    color: var(--white-60);
    font-size: 0.76rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.walLink {
    color: var(--white-60);
    text-decoration: none;
    display: flex;
}

.walLink:hover {
    color: var(--white-87);
}

.walQuelle {
    margin: 0.7rem 0 0;
    font-size: 0.78rem;
    color: var(--white-60);
}
</style>
