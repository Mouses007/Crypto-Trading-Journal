<script setup>
/**
 * Alle Zeichnungen des aktiven Symbols — auch die versteckten und die, die
 * nur auf einer anderen Zeiteinheit erscheinen. Ohne diese Liste wäre eine
 * versteckte Linie nicht mehr wiederzufinden.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { stilFuer } from '../../utils/chart/zeichnungen/werkzeuge.js'

const props = defineProps({
    symbol: { type: String, required: true },
    zeichnungen: { type: Array, default: () => [] },
    auswahlId: { type: Number, default: null },
})
const emit = defineEmits(['waehle', 'aendere', 'loesche'])
const { t } = useI18n()

const zeilen = computed(() => [...props.zeichnungen].sort((a, b) => b.erstelltAm - a.erstelltAm))

function preisText(z) {
    const p = z.punkte?.[0]?.p
    if (p == null) return ''
    const s = Math.abs(p) >= 1000 ? 2 : Math.abs(p) >= 1 ? 4 : 6
    return p.toFixed(s)
}

function beschreibung(z) {
    const text = stilFuer(z).text
    return text ? `„${text}"` : preisText(z)
}
</script>

<template>
    <div class="objekte">
        <div v-if="!zeilen.length" class="leer">{{ t('chart.objekteLeer', { symbol }) }}</div>
        <div v-for="z in zeilen" :key="z.id" class="zeile" :class="{ an: z.id === auswahlId, aus: z.versteckt }"
            @click="emit('waehle', z)">
            <span class="punkt" :style="{ background: stilFuer(z).farbe || '#888' }"></span>
            <span class="name">{{ t('chart.wz.' + z.typ) }}</span>
            <span class="info">{{ beschreibung(z) }}</span>
            <span v-if="Array.isArray(z.sichtbarAuf) && z.sichtbarAuf.length" class="tf">{{ z.sichtbarAuf.join(',') }}</span>
            <span class="werkzeug" @click.stop>
                <button :title="t(z.versteckt ? 'chart.einblenden' : 'chart.ausblenden')"
                    @click="emit('aendere', z, { versteckt: !z.versteckt })">
                    <i :class="z.versteckt ? 'uil uil-eye-slash' : 'uil uil-eye'"></i></button>
                <button :title="t(z.gesperrt ? 'chart.stil.entsperren' : 'chart.stil.sperren')"
                    @click="emit('aendere', z, { gesperrt: !z.gesperrt })">
                    <i :class="z.gesperrt ? 'uil uil-lock' : 'uil uil-unlock'"></i></button>
                <button :title="t('chart.entfernen')" @click="emit('loesche', z)"><i class="uil uil-trash-alt"></i></button>
            </span>
        </div>
    </div>
</template>

<style scoped>
.objekte {
    overflow-y: auto;
    min-height: 0;
}

.leer {
    color: var(--grey-text);
    font-size: 12px;
    padding: 8px 4px;
}

.zeile {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
}

.zeile:hover {
    background: var(--white-10);
}

.zeile.an {
    background: rgba(1, 180, 255, 0.1);
}

.zeile.aus {
    opacity: 0.5;
}

.punkt {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}

.name {
    flex-shrink: 0;
}

.info {
    flex: 1;
    color: var(--grey-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tf {
    font-size: 10px;
    color: var(--blue-color);
}

.werkzeug {
    display: flex;
}

.werkzeug button {
    background: transparent;
    border: none;
    color: var(--grey-text);
    padding: 0 3px;
}

.werkzeug button:hover {
    color: var(--white-87, #eee);
}
</style>
