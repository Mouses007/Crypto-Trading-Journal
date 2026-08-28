<script setup>
/**
 * Kachel „Offene Trades".
 *
 * Zählt die offenen Positionen des aktiven Brokers und summiert ihren
 * unrealisierten P&L. Darunter eine kompakte Liste (Symbol, Seite, uPnL).
 *
 * Self-supplying: liest aus `incomingPositions`, das die Startseite beim Mount
 * lädt und per Polling (`useStartGlobalPolling`) frisch hält. `daten` bleibt
 * ungenutzt.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { selectedBroker, incomingPositions } from '../../stores/globals.js'

defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
})

const { t } = useI18n()

const broker = computed(() => selectedBroker.value || 'bitunix')

const offene = computed(() =>
    incomingPositions
        .filter(p => p.status === 'open' && (!p.broker || p.broker === broker.value))
        .map(p => ({
            id: p.objectId ?? p.positionId,
            symbol: (p.symbol || '').replace(/USDT$/, ''),
            side: (p.side || '').toUpperCase(),
            upnl: Number(p.unrealizedPNL) || 0,
        }))
        .sort((a, b) => a.upnl - b.upnl),
)

const summe = computed(() => offene.value.reduce((s, p) => s + p.upnl, 0))

const geld = (n) => (n >= 0 ? '+' : '') + Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
</script>

<template>
    <div class="otWrap" :class="{ gross }">
        <div class="otKopf">
            <div class="otAnzahl">{{ offene.length }}</div>
            <div class="otSumme" :class="summe >= 0 ? 'up' : 'down'">{{ geld(summe) }} <span>USDT</span></div>
        </div>

        <div v-if="offene.length" class="otListe">
            <div v-for="p in offene" :key="p.id" class="otZeile">
                <span class="otSym">{{ p.symbol }}</span>
                <span class="otSide" :class="p.side === 'LONG' ? 'long' : 'short'">{{ p.side }}</span>
                <span class="otUpnl" :class="p.upnl >= 0 ? 'up' : 'down'">{{ geld(p.upnl) }}</span>
            </div>
        </div>

        <div v-else class="otLeer">
            <i class="uil uil-check-circle"></i>
            <span>{{ t('startseite.offeneTrades.keine') }}</span>
        </div>
    </div>
</template>

<style scoped>
.otWrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 140px;
    gap: 0.5rem;
}

.otKopf {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
}

.otAnzahl {
    font-size: 1.9rem;
    font-weight: 700;
    color: var(--white-87);
    line-height: 1;
}

.otSumme {
    font-size: 1.05rem;
    font-weight: 600;
}

.otSumme span {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--white-60);
}

.otSumme.up {
    color: rgb(38, 190, 150);
}

.otSumme.down {
    color: rgb(255, 95, 86);
}

.otListe {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    overflow-y: auto;
    flex: 1 1 auto;
}

.otZeile {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.84rem;
    padding: 0.15rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.otSym {
    font-weight: 600;
    color: var(--white-87);
}

.otSide {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.03em;
}

.otSide.long {
    color: rgb(38, 190, 150);
}

.otSide.short {
    color: rgb(255, 95, 86);
}

.otUpnl.up {
    color: rgb(38, 190, 150);
}

.otUpnl.down {
    color: rgb(255, 95, 86);
}

.otLeer {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    flex: 1 1 auto;
    color: var(--white-60);
    font-size: 0.85rem;
}

.otLeer i {
    font-size: 1.6rem;
    color: rgba(38, 190, 150, 0.7);
}
</style>
