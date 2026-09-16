<script setup>
/**
 * Einstellungen von Bookmap und Liquidationskarte als Fenster über dem Cockpit.
 *
 * Auf den eigenen Seiten (/liquidity, /liquidations) stehen diese Regler im
 * Seitenmenü — `LiveSymbolPicker` rendert sie dort. Das Cockpit hat kein
 * Seitenmenü (mit Absicht: während einer Sitzung soll nichts anderes in
 * Reichweite sein), und die Kachel-Kopfzeilen tragen bewusst nur die drei
 * Handgriffe, die man im Handel dauernd braucht. Alles Übrige — Farbskala,
 * Sättigung, Buch-Leiter, Handelspunkte, Hebelstufen, Gewichte, Wartungsmarge —
 * war im Cockpit bisher unerreichbar; man musste das Fenster verlassen
 * (gemeldet 16.09.2026).
 *
 * Es ist DERSELBE `LiveSymbolPicker`, zweimal, ohne Symbolblock. Die Werte
 * sind Modul-Singletons in `stores/live.js`: was hier gestellt wird, gilt
 * sofort in der Kachel und ebenso auf der eigenen Seite. Keine Kopie der
 * Regler — die wäre beim nächsten neuen Regler auseinandergelaufen, und
 * genau dieses Muster (die nicht nachgezogene Kopie) war der häufigste
 * Befund der Audits.
 *
 * Gerüst wie `RadarOverlay`: Teleport an den Body, Esc und Klick daneben
 * schliessen. Die Karten laufen darunter weiter — eine Änderung ist sofort
 * hinter dem Fenster zu sehen.
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import LiveSymbolPicker from '../LiveSymbolPicker.vue'

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
            <div class="radarOverlayBox keBox">
                <div class="radarOverlayHead">
                    <h5><i class="uil uil-setting me-1"></i>{{ t('livetrading.karten.titel') }}</h5>
                    <button type="button" class="radarOverlayClose" :title="t('common.close')"
                        @click="emit('schliessen')">
                        <i class="uil uil-times"></i>
                    </button>
                </div>
                <div class="radarOverlayBody keBody">
                    <section class="keSpalte">
                        <h6><i class="uil uil-chart-line me-1"></i>{{ t('nav.liquidity') }}</h6>
                        <LiveSymbolPicker variant="bookmap" ohne-symbol in-kachel />
                    </section>
                    <section class="keSpalte">
                        <h6><i class="uil uil-fire me-1"></i>{{ t('nav.liquidations') }}</h6>
                        <LiveSymbolPicker variant="levmap" ohne-symbol in-kachel />
                    </section>
                </div>
                <div class="radarOverlayFuss">{{ t('livetrading.karten.hinweis') }}</div>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
/* Schmaler als die Gross-Ansicht einer Kachel: hier stehen Regler, kein Chart. */
.keBox {
    width: min(880px, 100%);
}

/* Zwei Spalten, eine je Karte — unter 768 px übereinander. `minmax(0, 1fr)`
   statt `1fr`, sonst sprengt ein langer Hinweistext die Spalte (siehe
   Kommentar im Stylesheet). */
.keBody {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.2rem;
}

.keSpalte h6 {
    margin: 0 0 0.5rem;
    padding-bottom: 0.35rem;
    font-size: 0.9rem;
    color: var(--white-87);
    border-bottom: 1px solid var(--white-18);
}

@media (max-width: 767.98px) {
    .keBody {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
