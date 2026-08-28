<script setup>
/**
 * Das Pult des Live-Trading-Fensters.
 *
 * Die Form steht in `components/pult/PultRahmen.vue` und wird mit dem
 * Marktradar geteilt. Hier stehen nur die drei Stellen, an denen sich diese
 * Seite unterscheidet — und das sind genau die Fragen, die während einer
 * Sitzung zählen:
 *
 *   Band oben   → wie steht es um MICH (Preis, Verlustbudget, Trades, Uhr)
 *   Band unten  → wie lange habe ich noch Ruhe (Sitzungen und Termine)
 *   Fuss        → passiert gerade etwas (Liquidationen)
 *
 * Bühne und Instrumentenleiste kommen aus `config/pult.js`.
 */
import PultRahmen from '../pult/PultRahmen.vue'
import Statusband from './pult/Statusband.vue'
import Zeitband from './pult/Zeitband.vue'
import Tape from './pult/Tape.vue'
import InstrumentFunding from './pult/InstrumentFunding.vue'
import { BUEHNEN, LEISTE } from '../../config/pult.js'

const props = defineProps({
    daten: { type: Object, required: true },
    zustand: { type: Object, required: true },
    stand: { type: Object, required: true },
    kachelParams: { type: Object, default: () => ({}) },
    komponenten: { type: Object, required: true },
    symbol: { type: String, default: '' },
})

const emit = defineEmits(['params', 'anzeige', 'zustand', 'neuladen'])

/** Verdichtete Fassungen. Nur Funding braucht eine — die Kachel ist eine
 *  sortierbare Liste über bis zu hundert Märkte. */
const EIGENE = { funding: InstrumentFunding }
</script>

<template>
    <PultRahmen :daten="daten" :zustand="zustand" :stand="stand" :kachel-params="kachelParams"
        :komponenten="komponenten" :buehnen="BUEHNEN" :leiste="LEISTE"
        :eigene-komponenten="EIGENE" :kontext="{ symbol }"
        speicher="livetrading_pult_buehne"
        @params="(id, w) => emit('params', id, w)"
        @anzeige="(id, w) => emit('anzeige', id, w)"
        @zustand="(id, z, extra) => emit('zustand', id, z, extra)"
        @neuladen="(id) => emit('neuladen', id)">

        <template #bandOben="{ jetzt }">
            <Statusband :positionen="daten.positionen" :funding="daten.funding" :lsoi="daten.lsoi"
                :symbol="symbol" :preis-stand="stand.funding || 0" :jetzt="jetzt" />
        </template>

        <template #bandUnten="{ jetzt }">
            <Zeitband :kalender="daten.kalender" :jetzt="jetzt" />
        </template>

        <template #fuss>
            <Tape :daten="daten.liqticker" />
        </template>
    </PultRahmen>
</template>
