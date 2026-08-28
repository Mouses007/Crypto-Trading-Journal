<script setup>
/**
 * Das Pult des Marktradars.
 *
 * Dieselbe Form wie im Live-Fenster (`components/pult/PultRahmen.vue`), andere
 * Frage. Das Live-Pult beantwortet „wie steht es um meine Sitzung"; hier lautet
 * sie „in welchem Markt bin ich überhaupt". Entsprechend anders belegt sind die
 * drei Stellen, an denen sich die Seiten unterscheiden:
 *
 *   Band oben   → wie ist die Stimmung (Fear & Greed, Altsaison, Dominanz, ETF)
 *   Band unten  → wo im Zyklus stehen wir (Regenbogen, Pi-Cycle)
 *   Fuss        → das Urteil der KI in einer Zeile
 *
 * Sechs Kacheln des Rasters verschwinden dabei als Kasten und erscheinen als
 * Skala in den Bändern. Das ist der eigentliche Gewinn gegenüber dem Raster:
 * eine Zahl auf einer festen Skala braucht keinen Rahmen, sie braucht die
 * Skala — erst darauf sieht man, ob der Wert gewöhnlich oder auffällig ist.
 */
import PultRahmen from '../pult/PultRahmen.vue'
import Stimmungsband from './pult/Stimmungsband.vue'
import Zyklusband from './pult/Zyklusband.vue'
import LageFuss from './pult/LageFuss.vue'
import InstrumentFunding from '../livetrading/pult/InstrumentFunding.vue'
import { BUEHNEN, LEISTE } from '../../config/marktradar-pult.js'

const props = defineProps({
    daten: { type: Object, required: true },
    zustand: { type: Object, required: true },
    stand: { type: Object, required: true },
    kachelParams: { type: Object, default: () => ({}) },
    komponenten: { type: Object, required: true },
    symbol: { type: String, default: '' },
})

const emit = defineEmits(['params', 'anzeige', 'zustand', 'neuladen', 'oeffnen'])

/** Dieselbe verdichtete Funding-Fassung wie im Live-Pult — gleiche Nutzlast,
 *  gleiche Frage, kein Grund für eine zweite. */
const EIGENE = { funding: InstrumentFunding }
</script>

<template>
    <PultRahmen :daten="daten" :zustand="zustand" :stand="stand" :kachel-params="kachelParams"
        :komponenten="komponenten" :buehnen="BUEHNEN" :leiste="LEISTE"
        :eigene-komponenten="EIGENE" :kontext="{ symbol }"
        speicher="marktradar_pult_buehne"
        @params="(id, w) => emit('params', id, w)"
        @anzeige="(id, w) => emit('anzeige', id, w)"
        @zustand="(id, z, extra) => emit('zustand', id, z, extra)"
        @neuladen="(id) => emit('neuladen', id)">

        <template #bandOben>
            <Stimmungsband :fng="daten.fng" :altseason="daten.altseason" :dom="daten.dom" :etf="daten.etf" />
        </template>

        <template #bandUnten>
            <Zyklusband :rainbow="daten.rainbow" :picycle="daten.picycle" />
        </template>

        <!-- Der ganze Bericht steht in der Kachel; der Fuss öffnet sie gross. -->
        <template #fuss>
            <LageFuss :daten="daten.lage" @oeffnen="emit('oeffnen', 'lage')" />
        </template>
    </PultRahmen>
</template>
