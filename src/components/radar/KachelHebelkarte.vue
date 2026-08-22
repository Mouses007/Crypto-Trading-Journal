<script setup>
/**
 * Kachel „Liquidationskarte".
 *
 * Hülle um `HebelkartenCanvas.vue` — dieselbe Komponente, die auch die eigene
 * Seite zeichnet. Kopf- und Fusszeile der Seite fehlen hier absichtlich: den
 * Zustandspunkt zeigt der Kachelrahmen, und der Hinweis „Modell, nicht Messung"
 * steht in der Gross-Ansicht der Kachel sowie auf der Seite.
 *
 * Wie die Bookmap-Kachel ohne Vergrössern (`gross: false`): die Gross-Ansicht
 * wäre eine zweite Instanz, und die würde eine zweite `LeverageMapSource`
 * aufsetzen — also einen zweiten Abruf der Aufzeichnung und eine zweite
 * Verlaufsmatrix über Zehntausende Zellen.
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import HebelkartenCanvas from '../HebelkartenCanvas.vue'

defineProps({
    daten: { type: Object, default: null },
    gross: { type: Boolean, default: false },
    params: { type: Object, default: () => ({}) },
})

/**
 * Zustand der Karte ans Raster durchreichen.
 *
 * `HebelkartenCanvas` legt `status`, `statusDetail` und `stand` per
 * `defineExpose` offen — beobachtet statt per Ereignis, damit die eigene Seite
 * unverändert bleibt. `LeverageMapSource` meldet `loading`, `ready`, `empty`
 * und `error`; die Übersetzung in die Rasterzustände macht `useKachelRaster`.
 *
 * `empty` ist der interessante Fall: die Karte hat dann eine gültige Antwort,
 * aber keine Open-Interest-Historie zum Zeichnen. Grün wäre gelogen.
 */
const emit = defineEmits(['zustand'])
const karte = ref(null)

watch(
    () => [karte.value?.status, karte.value?.statusDetail, karte.value?.stand],
    ([status, detail, stand]) => {
        if (!status) return
        emit('zustand', status, { stand, fehler: detail })
    },
    { immediate: true },
)

const { t } = useI18n()

/*
 * Daytrading-Vorgabe, unabhängig von der Einstellung der eigenständigen Seite.
 *
 * Das Modell erkennt Positionen nur daran, dass das offene Interesse STEIGT.
 * Alles, was vor dem Fensteranfang eröffnet wurde, bleibt unsichtbar — bei
 * sechs Stunden waren das über 99 % des offenen Interesses, die Karte meldete
 * dann selbst „Abdeckung 0,6 % · Fenster zu kurz".
 *
 * 24 Stunden decken die Positionierung über Nacht ab und brauchen 288
 * Datenpunkte. Das bleibt unter der 500er-Grenze des Endpoints, die Karte
 * behält also die 5-Minuten-Auflösung; ab 48 Stunden fiele sie auf
 * 15-Minuten-Punkte zurück (siehe `pickPeriod` in `leverageMapSource.js`).
 *
 * 2 % Preisband, weil im Handelsfenster die Zonen dicht am Kurs zählen — die
 * erfasste Spanne bleibt davon unberührt und deckt weiterhin die tiefen Hebel ab.
 */
const DAYTRADING_STUNDEN = 24
const DAYTRADING_SPANNE = 2
</script>

<template>
    <div class="hkWrap">
        <div class="hkFlaeche">
            <HebelkartenCanvas ref="karte" :stunden="DAYTRADING_STUNDEN" :spanne-pct="DAYTRADING_SPANNE" />
        </div>
        <a class="hkGanzeSeite" href="/liquidations" @click.stop>
            <i class="uil uil-expand-arrows-alt"></i>{{ t('livetrading.ganzeSeite') }}
        </a>
    </div>
</template>

<style scoped>
.hkWrap {
    position: relative;
    height: 100%;
    min-height: 0;
}

/* `HebelkartenCanvas` bringt `flex: 1 1 auto` mit — in einem Flex-Container
   füllt es damit die Fläche, ohne dass hier Höhen gerechnet werden müssen. */
.hkFlaeche {
    position: absolute;
    inset: 0;
    display: flex;
    overflow: hidden;
    border-radius: var(--border-radius, 6px);
}

.hkGanzeSeite {
    position: absolute;
    right: 0.3rem;
    bottom: 0.3rem;
    z-index: 3;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.12rem 0.4rem;
    border-radius: 999px;
    font-size: 0.68rem;
    text-decoration: none;
    color: var(--white-87);
    background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.16);
}

.hkGanzeSeite:hover {
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
}
</style>
