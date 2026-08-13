<script setup>
/**
 * Generisches Parameter-Formular.
 *
 * Rendert AUSSCHLIESSLICH aus dem Schema, das der Server im Manifest der
 * Strategie mitliefert. Damit kostet eine weitere Strategie null Zeilen Vue —
 * und es kann strukturell kein Parameter mehr im Code festverdrahtet werden,
 * weil das Formular gar nicht weiss, welche Strategie es gerade darstellt.
 *
 * Dieselbe Komponente rendert auch die Risiko-Parameter; deren Schema kommt
 * aus derselben Registry.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t, te } = useI18n()

const props = defineProps({
    /** Schema: [{ key, type, default, min, max, step, options, group, labelKey }] */
    schema: { type: Array, default: () => [] },
    /** Gruppen-Beschriftungen: [{ id, labelKey }] */
    groups: { type: Array, default: () => [] },
    modelValue: { type: Object, default: () => ({}) },
    /** Präfix für Übersetzungen, wenn das Schema keinen labelKey mitbringt */
    i18nPrefix: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

/** Übersetzung mit Rückfall auf den Schlüsselnamen — fehlende Texte brechen nichts. */
function beschriftung(p) {
    const key = p.labelKey || (props.i18nPrefix ? `${props.i18nPrefix}.${p.key}` : '')
    if (key && te(key)) return t(key)
    return p.key
}

function hinweis(p) {
    const key = p.hintKey || (props.i18nPrefix ? `${props.i18nPrefix}.${p.key}Hint` : '')
    return key && te(key) ? t(key) : ''
}

function optionText(o) {
    if (typeof o !== 'object') return String(o)
    return o.labelKey && te(o.labelKey) ? t(o.labelKey) : String(o.value)
}
const optionWert = (o) => (typeof o === 'object' ? o.value : o)

/** Parameter nach Gruppen sortiert; alles ohne Gruppe landet in „Sonstiges". */
const gruppiert = computed(() => {
    const map = new Map()
    for (const p of props.schema) {
        const g = p.group || 'other'
        if (!map.has(g)) map.set(g, [])
        map.get(g).push(p)
    }
    return [...map.entries()].map(([id, items]) => {
        const def = props.groups.find((g) => g.id === id)
        const key = def?.labelKey || `strategies.groups.${id}`
        return { id, label: te(key) ? t(key) : id, items }
    })
})

function setzen(p, wert) {
    if (props.disabled) return
    let v = wert
    if (p.type === 'number' || p.type === 'integer') {
        v = v === '' ? p.default : Number(v)
        if (!Number.isFinite(v)) v = p.default
        // Nur weich begrenzen — die harte Prüfung macht der Server gegen dasselbe Schema
        if (p.min !== undefined && v < p.min) v = p.min
        if (p.max !== undefined && v > p.max) v = p.max
        if (p.type === 'integer') v = Math.round(v)
    }
    emit('update:modelValue', { ...props.modelValue, [p.key]: v })
}

const wertVon = (p) => (props.modelValue?.[p.key] !== undefined ? props.modelValue[p.key] : p.default)
const istGeaendert = (p) => wertVon(p) !== p.default

function zuruecksetzen(p) {
    emit('update:modelValue', { ...props.modelValue, [p.key]: p.default })
}
</script>

<template>
    <div class="param-form">
        <div v-for="g in gruppiert" :key="g.id" class="param-group">
            <div class="param-group-title">{{ g.label }}</div>

            <div v-for="p in g.items" :key="p.key" class="row align-items-center param-row">
                <div class="col-12 col-md-5">
                    <label class="param-label" :for="`p-${p.key}`">
                        {{ beschriftung(p) }}
                        <!-- Abweichungen vom Default sichtbar machen: bei 31 Parametern
                             sieht man sonst nicht, woran zuletzt gedreht wurde. -->
                        <button v-if="istGeaendert(p)" type="button" class="param-reset"
                            :title="t('strategies.resetToDefault', { value: String(p.default) })"
                            @click="zuruecksetzen(p)">
                            <i class="uil uil-history"></i>
                        </button>
                    </label>
                    <div v-if="hinweis(p)" class="param-hint">{{ hinweis(p) }}</div>
                </div>

                <div class="col-12 col-md-7">
                    <select v-if="p.type === 'select'" :id="`p-${p.key}`" class="form-select form-select-sm"
                        :disabled="disabled" :value="wertVon(p)"
                        @change="setzen(p, $event.target.value)">
                        <option v-for="o in p.options" :key="optionWert(o)" :value="optionWert(o)">
                            {{ optionText(o) }}
                        </option>
                    </select>

                    <div v-else-if="p.type === 'boolean'" class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" :id="`p-${p.key}`"
                            :disabled="disabled" :checked="!!wertVon(p)"
                            @change="setzen(p, $event.target.checked)" />
                    </div>

                    <input v-else-if="p.type === 'string'" :id="`p-${p.key}`" type="text"
                        class="form-control form-control-sm" :disabled="disabled"
                        :value="wertVon(p)" @input="setzen(p, $event.target.value)" />

                    <div v-else class="d-flex align-items-center gap-2">
                        <input :id="`p-${p.key}`" type="number" class="form-control form-control-sm param-number"
                            :disabled="disabled" :min="p.min" :max="p.max" :step="p.step || 1"
                            :value="wertVon(p)" @change="setzen(p, $event.target.value)" />
                        <small v-if="p.min !== undefined" class="param-range">{{ p.min }}–{{ p.max }}</small>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.param-group {
    margin-bottom: 1.1rem;
}

.param-group-title {
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
    border-bottom: 1px solid var(--white-12, rgba(255, 255, 255, 0.1));
    padding-bottom: 0.25rem;
    margin-bottom: 0.55rem;
}

.param-row {
    margin-bottom: 0.4rem;
}

.param-label {
    font-size: 0.86rem;
    margin-bottom: 0;
}

.param-hint {
    font-size: 0.72rem;
    color: var(--white-50, rgba(255, 255, 255, 0.5));
    line-height: 1.25;
}

.param-number {
    max-width: 9rem;
}

.param-range {
    font-size: 0.68rem;
    color: var(--white-38, rgba(255, 255, 255, 0.38));
    white-space: nowrap;
}

.param-reset {
    background: none;
    border: none;
    padding: 0 0 0 0.3rem;
    color: var(--blue-color, #01B4FF);
    font-size: 0.8rem;
    line-height: 1;
    cursor: pointer;
}
</style>
