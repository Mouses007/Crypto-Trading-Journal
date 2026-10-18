<script setup>
/**
 * Indikatoren hinzufügen (Liste mit Suche) oder eine Instanz einstellen
 * (Parameter, Farben). Was hier gewählt wird, landet im Layout des aktiven
 * Panels — gerechnet wird in `indikatorRegister.js`.
 */
import { ref, computed, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { INDIKATOREN, saubereParams } from '../../utils/chart/indikatorRegister.js'

const props = defineProps({
    instanz: { type: Object, default: null },    // null = hinzufügen
})
const emit = defineEmits(['hinzu', 'speichere', 'schliesse'])
const { t } = useI18n()

const suche = ref('')
const feld = ref(null)
const entwurf = ref(props.instanz ? JSON.parse(JSON.stringify(props.instanz)) : null)
const def = computed(() => (entwurf.value ? INDIKATOREN[entwurf.value.typ] : null))

const liste = computed(() => {
    const q = suche.value.trim().toLowerCase()
    return Object.keys(INDIKATOREN)
        .map((typ) => ({ typ, name: t(`chart.ind.${typ}.name`), text: t(`chart.ind.${typ}.text`), ort: INDIKATOREN[typ].ort }))
        .filter((x) => !q || x.name.toLowerCase().includes(q) || x.typ.toLowerCase().includes(q))
})

/*
 * Farbwähler arbeiten nur mit #rrggbb. Vorgaben wie `rgba(…)` werden für den
 * Wähler angenähert; erst eine Änderung durch den Nutzer schreibt eine eigene
 * Farbe ins Layout.
 */
function hexFuer(farbe) {
    if (/^#[0-9a-f]{6}$/i.test(farbe)) return farbe
    const m = String(farbe).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (!m) return '#888888'
    return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')
}

function farbeVon(a) {
    return entwurf.value.farben?.[a.key] || a.farbe
}

function setzeFarbe(key, wert) {
    entwurf.value.farben = { ...(entwurf.value.farben || {}), [key]: wert }
}

function speichere() {
    entwurf.value.params = saubereParams(entwurf.value.typ, entwurf.value.params)
    emit('speichere', entwurf.value)
}

function standard() {
    entwurf.value.params = saubereParams(entwurf.value.typ, {})
    entwurf.value.farben = {}
}

onMounted(async () => {
    await nextTick()
    feld.value?.focus()
})
</script>

<template>
    <div class="dialogHintergrund" @click.self="emit('schliesse')" @keydown.esc="emit('schliesse')" tabindex="-1">
        <div class="dialog">
            <!-- Hinzufügen -->
            <template v-if="!entwurf">
                <div class="kopf">
                    <b>{{ t('chart.indikatoren') }}</b>
                    <button class="zu" @click="emit('schliesse')"><i class="uil uil-times"></i></button>
                </div>
                <input ref="feld" v-model="suche" class="form-control form-control-sm" :placeholder="t('chart.indSuchen')" />
                <div class="liste">
                    <button v-for="x in liste" :key="x.typ" class="eintrag" @click="emit('hinzu', x.typ)">
                        <span class="name">{{ x.name }}</span>
                        <span class="ort">{{ t('chart.indOrt.' + x.ort) }}</span>
                        <small>{{ x.text }}</small>
                    </button>
                </div>
            </template>

            <!-- Einstellen -->
            <template v-else>
                <div class="kopf">
                    <b>{{ t(`chart.ind.${entwurf.typ}.name`) }}</b>
                    <button class="zu" @click="emit('schliesse')"><i class="uil uil-times"></i></button>
                </div>
                <div class="form">
                    <label v-for="p in def.params" :key="p.key" class="zeile">
                        <span>{{ t('chart.indParam.' + p.key) }}</span>
                        <input v-if="p.typ === 'zahl'" v-model.number="entwurf.params[p.key]" type="number"
                            class="form-control form-control-sm" :min="p.min" :max="p.max" :step="p.schritt" />
                        <select v-else v-model="entwurf.params[p.key]" class="form-select form-select-sm">
                            <option v-for="o in p.optionen" :key="o" :value="o">{{ t('chart.indWahl.' + o) }}</option>
                        </select>
                    </label>
                    <div class="trenner">{{ t('chart.farben') }}</div>
                    <label v-for="a in def.ausgaben" :key="a.key" class="zeile">
                        <span>{{ t('chart.indAusgabe.' + a.key) }}</span>
                        <input type="color" :value="hexFuer(farbeVon(a))" @input="setzeFarbe(a.key, $event.target.value)" />
                    </label>
                </div>
                <div class="fuss">
                    <button class="btn btn-sm btn-outline-secondary" @click="standard">{{ t('chart.standard') }}</button>
                    <button class="btn btn-sm btn-primary" @click="speichere">{{ t('chart.uebernehmen') }}</button>
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped>
.dialogHintergrund {
    position: fixed;
    inset: 0;
    z-index: 1050;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 10vh 16px 16px;
}

.dialog {
    width: 420px;
    max-width: 100%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--black-bg-5, #1e222d);
    border: 1px solid var(--white-18);
    border-radius: 10px;
    padding: 12px;
    box-shadow: var(--shadow-sm);
}

.kopf {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.zu {
    background: transparent;
    border: none;
    color: var(--grey-text);
}

.liste {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
}

.eintrag {
    display: grid;
    grid-template-columns: 1fr auto;
    text-align: left;
    gap: 0 8px;
    background: transparent;
    border: none;
    border-radius: 6px;
    padding: 6px 8px;
    color: var(--white-87, #ddd);
}

.eintrag:hover {
    background: var(--white-10);
}

.eintrag .name {
    font-weight: 500;
    font-size: 13px;
}

.eintrag .ort {
    font-size: 10px;
    color: var(--grey-text);
}

.eintrag small {
    grid-column: 1 / -1;
    color: var(--grey-text);
    font-size: 11px;
}

.form {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.zeile {
    display: grid;
    grid-template-columns: 1fr 140px;
    align-items: center;
    gap: 8px;
    font-size: 12px;
}

.zeile input[type='color'] {
    width: 48px;
    height: 24px;
    padding: 0;
    border: none;
    background: transparent;
    justify-self: end;
}

.trenner {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--grey-text);
    margin-top: 6px;
}

.fuss {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}
</style>
