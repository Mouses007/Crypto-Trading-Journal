<script setup>
/**
 * Der Fuss des Marktradar-Pults: das Urteil der KI in einer Zeile.
 *
 * Im Live-Pult läuft hier das Liquidations-Band — etwas, das sich im
 * Sekundentakt ändert. Der Marktradar hat nichts dergleichen, und das ist kein
 * Mangel: seine Instrumente ändern sich in Stunden. Was hier hingehört, ist
 * stattdessen die Zusammenfassung — die eine Aussage, auf die alles darüber
 * hinausläuft.
 *
 * ## Erzeugt wird nur auf Knopfdruck
 *
 * `GET /api/marktradar/lage` LIEST bloss, was schon da ist; das Erzeugen ist
 * ein POST und kostet Geld (rund 30 s, ~0,04 $ je Lauf). Deshalb steht hier im
 * Leerfall ein Knopf und keine Automatik — sonst zahlte „Alle aktualisieren"
 * bei jedem Druck eine KI-Anfrage. Der Knopf reicht `neuladen` nach oben durch,
 * die Kachel selbst erledigt den POST.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
    daten: { type: Object, default: null },
})

const emit = defineEmits(['oeffnen'])

const { t } = useI18n()

/* Dieselben fünf Schlüssel und dieselben Farben wie `KachelLage.vue` — eine
   Stimmung, die im Fuss anders eingefärbt wäre als in der Kachel, wäre schlimmer
   als gar keine Farbe. */
const STIMMUNG_FARBE = {
    risiko_auf: '#26be96',
    risiko_ab: '#ff5f56',
    angespannt: '#e8a33d',
    gemischt: '#5a9cff',
    ruhig: 'rgba(255,255,255,0.45)',
}

const leer = computed(() => !props.daten || props.daten.leer || !props.daten.text)

const farbe = computed(() => STIMMUNG_FARBE[props.daten?.stimmung] || 'rgba(255,255,255,0.45)')

/**
 * Erster Satz des Textes. Der Fuss ist eine Zeile hoch — den ganzen Bericht
 * hineinzuquetschen hiesse, ihn unlesbar zu machen; die Kachel im Raster zeigt
 * ihn vollständig. Abgeschnitten wird am Satzende und nicht an einer
 * Zeichenzahl, sonst endet die Zeile mitten im Wort.
 */
const ersterSatz = computed(() => {
    const text = String(props.daten?.text || '').trim()
    if (!text) return ''
    const m = text.match(/^.{20,240}?[.!?](\s|$)/s)
    return (m ? m[0] : text.slice(0, 240)).trim()
})
</script>

<template>
    <div class="lfFuss">
        <div class="lfKopf">{{ t('marktradar.lage.title') }}</div>

        <template v-if="!leer">
            <span class="lfPunkt" :style="{ background: farbe }"></span>
            <span class="lfStimmung" :style="{ color: farbe }">
                {{ daten.stimmung ? t('marktradar.lage.stimmung_' + daten.stimmung) : '' }}
            </span>
            <span class="lfText">{{ ersterSatz }}</span>
            <button type="button" class="lfMehr" @click="emit('oeffnen')">
                {{ t('marktradar.pult.ganzerText') }}<i class="uil uil-angle-right"></i>
            </button>
        </template>

        <template v-else>
            <span class="lfLeer">{{ t('marktradar.pult.lageLeer') }}</span>
            <button type="button" class="lfMehr" @click="emit('oeffnen')">
                {{ t('marktradar.pult.lageErzeugen') }}<i class="uil uil-angle-right"></i>
            </button>
        </template>
    </div>
</template>

<style scoped>
.lfFuss {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 34px;
    padding-right: 0.7rem;
    border-top: 1px solid var(--pTrenn);
    background: var(--pChrom);
    overflow: hidden;
}

.lfKopf {
    flex: none;
    display: flex;
    align-items: center;
    height: 100%;
    padding: 0 0.7rem;
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    /* Dieselbe Titel-Farbe wie im Rest des Pults — siehe `--pTitel` in PultRahmen.vue */
    color: var(--pTitel);
    border-right: 1px solid var(--pTrenn);
}

.lfPunkt {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
}

.lfStimmung {
    flex: none;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

/* Eine Zeile, Rest abgeschnitten: der ganze Bericht steht in der Kachel. */
.lfText {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 0.78rem;
    color: var(--white-60);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.lfLeer {
    flex: 1 1 auto;
    font-size: 0.78rem;
    color: var(--white-38);
}

.lfMehr {
    flex: none;
    background: transparent;
    border: 0;
    padding: 0;
    font-size: 0.72rem;
    color: var(--white-60);
}

.lfMehr:hover { color: var(--blue-color); }
</style>
