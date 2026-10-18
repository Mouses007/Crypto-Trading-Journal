<script setup>
/**
 * Indikatoren hinzufügen (Liste mit Suche) oder eine Instanz einstellen
 * (Parameter, Farben). Was hier gewählt wird, landet im Layout des aktiven
 * Panels — gerechnet wird in `indikatorRegister.js`.
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { INDIKATOREN, saubereParams, kurzname } from '../../utils/chart/indikatorRegister.js'
import FarbWahl from './FarbWahl.vue'

const props = defineProps({
    instanz: { type: Object, default: null },    // null = hinzufügen
    aktive: { type: Array, default: () => [] },  // Indikatoren des Panels — zum Einstellen und Entfernen
})
const emit = defineEmits(['hinzu', 'speichere', 'schliesse', 'bearbeite', 'entferne', 'umschalten'])
const { t, te } = useI18n()

const suche = ref('')
const feld = ref(null)
function kopie(i) {
    const k = JSON.parse(JSON.stringify(i))
    // Ältere Layouts kennen neu hinzugekommene Einstellungen nicht — mit Vorgaben auffüllen.
    k.params = saubereParams(k.typ, k.params)
    return k
}
const entwurf = ref(props.instanz ? kopie(props.instanz) : null)
const def = computed(() => (entwurf.value ? INDIKATOREN[entwurf.value.typ] : null))

/** Parameter nach `gruppe` geordnet (VWAP Vector hat neun Module); ohne Gruppe eine namenlose. */
/*
 * Parameter nach `gruppe` und in ZEILEN: ein Parameter mit `mit` gehört in die
 * Zeile davor (Schalter · Länge · Zeiteinheit · Farbe nebeneinander statt
 * untereinander). Der Parameter mit `haupt` steht in der Gruppenüberschrift.
 * VWAP Vector hat 114 Einstellungen — als Liste untereinander waren sie
 * nicht mehr zu überblicken.
 */
const gruppen = computed(() => {
    const aus = []
    for (const x of def.value?.params || []) {
        const g = x.gruppe || ''
        let ziel = aus.find((a) => a.id === g)
        if (!ziel) { ziel = { id: g, haupt: null, zeilen: [] }; aus.push(ziel) }
        if (x.haupt) { ziel.haupt = x; continue }
        const letzte = ziel.zeilen[ziel.zeilen.length - 1]
        if (x.mit && letzte) letzte.push(x)
        else ziel.zeilen.push([x])
    }
    return aus
})
// Aufgeklappt: die erste Gruppe; der Rest auf Klick (gemerkt, solange der Dialog offen ist).
const offen = ref(new Set())
watch(gruppen, (g) => { if (!offen.value.size && g[0]) offen.value = new Set([g[0].id]) }, { immediate: true })
function klappe(id) {
    const n = new Set(offen.value)
    if (n.has(id)) n.delete(id); else n.add(id)
    offen.value = n
}
const zeileAus = (z) => z[0].typ === 'schalter' && z.length > 1 && entwurf.value.params[z[0].key] === false
const gruppeAus = (g) => g.haupt && entwurf.value.params[g.haupt.key] === false
const hilfe = (key) => (te('chart.indHilfe.' + key) ? t('chart.indHilfe.' + key) : '')
// Strategie-Parameter (LSOB/GUSS) tragen ihre Beschriftung aus der Strategie mit
const name = (p) => (p.label ? t(p.label) : t('chart.indParam.' + p.key))
const optionName = (p, o) => (p.optionLabel?.[o] ? t(p.optionLabel[o]) : p.roh ? o : t('chart.indWahl.' + o))

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
                <template v-if="aktive.length">
                    <div class="abschnitt">{{ t('chart.indAktiv') }}</div>
                    <div class="aktiveListe">
                        <div v-for="a in aktive" :key="a.id" class="aktiv" :class="{ aus: a.sichtbar === false }">
                            <span class="name">{{ kurzname(a.typ, a.params, t('chart.ind.' + a.typ + '.kurz')) }}</span>
                            <button :title="t(a.sichtbar === false ? 'chart.einblenden' : 'chart.ausblenden')" @click="emit('umschalten', a.id)" :aria-label="t(a.sichtbar === false ? 'chart.einblenden' : 'chart.ausblenden')">
                                <i :class="a.sichtbar === false ? 'uil uil-eye-slash' : 'uil uil-eye'"></i></button>
                            <button :title="t('chart.einstellungen')" @click="emit('bearbeite', a.id)" :aria-label="t('chart.einstellungen')"><i class="uil uil-setting"></i></button>
                            <button class="weg" :title="t('chart.entfernen')" @click="emit('entferne', a.id)" :aria-label="t('chart.entfernen')"><i class="uil uil-trash-alt"></i></button>
                        </div>
                    </div>
                    <div class="abschnitt">{{ t('chart.indHinzu') }}</div>
                </template>
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
                    <section v-for="g in gruppen" :key="g.id" class="gruppe" :class="{ zu: g.id && !offen.has(g.id) }">
                        <div v-if="g.id" class="gKopf" @click="klappe(g.id)">
                            <i class="uil uil-angle-right pfeil"></i>
                            <span class="gName">{{ t('chart.indGruppe.' + g.id) }}</span>
                            <input v-if="g.haupt" v-model="entwurf.params[g.haupt.key]" type="checkbox" class="form-check-input schalter"
                                :title="t('chart.indParam.' + g.haupt.key)" @click.stop />
                        </div>
                        <div v-show="!g.id || offen.has(g.id)" class="gInhalt" :class="{ aus: gruppeAus(g) }">
                            <div v-for="z in g.zeilen" :key="z[0].key" class="zeile" :class="{ aus: zeileAus(z) }" :title="hilfe(z[0].key)">
                                <span class="zName">{{ name(z[0]) }}<i v-if="hilfe(z[0].key)" class="uil uil-info-circle hinweisI"></i></span>
                                <span class="regler">
                                    <template v-for="p in z" :key="p.key">
                                        <input v-if="p.typ === 'zahl'" v-model.number="entwurf.params[p.key]" type="number"
                                            class="form-control form-control-sm zahl" :min="p.min" :max="p.max" :step="p.schritt"
                                            :title="name(p)" />
                                        <input v-else-if="p.typ === 'schalter'" v-model="entwurf.params[p.key]" type="checkbox"
                                            class="form-check-input schalter" :title="name(p)" />
                                        <FarbWahl v-else-if="p.typ === 'farbe'" v-model="entwurf.params[p.key]"
                                            :titel="t('chart.indParam.' + p.key)" />
                                        <select v-else v-model="entwurf.params[p.key]" class="form-select form-select-sm wahl"
                                            :title="name(p)">
                                            <option v-for="o in p.optionen" :key="o" :value="o">{{ optionName(p, o) }}</option>
                                        </select>
                                    </template>
                                </span>
                            </div>
                        </div>
                    </section>
                    <div v-if="def.ausgaben.length" class="trenner">{{ t('chart.farben') }}</div>
                    <div v-for="a in def.ausgaben" :key="a.key" class="zeile">
                        <span>{{ t('chart.indAusgabe.' + a.key) }}</span>
                        <FarbWahl :model-value="hexFuer(farbeVon(a))" :titel="t('chart.indAusgabe.' + a.key)" @update:model-value="(f) => setzeFarbe(a.key, f)" />
                    </div>
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
    width: 460px;
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

.abschnitt {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--grey-text);
}

/* Die aktiven Indikatoren schrumpfen NICHT — vorher drückte der lange Katalog darunter
   sie im 80vh-Dialog auf zwei Zeilen mit eigener Mini-Scrollleiste. Scrollen soll nur der
   Katalog; die Aktiv-Liste erst ab 40vh (sehr viele Indikatoren). */
.aktiveListe {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
    max-height: 40vh;
    overflow-y: auto;
}

.kopf, .abschnitt, .dialog > input {
    flex-shrink: 0;
}

.aktiv {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 6px;
    border-radius: 6px;
    background: var(--white-10);
    font-size: 12px;
}

.aktiv.aus {
    opacity: 0.5;
}

.aktiv .name {
    flex: 1;
}

.aktiv button {
    background: transparent;
    border: none;
    color: var(--grey-text);
    padding: 0 4px;
}

.aktiv button:hover {
    color: var(--white-87, #eee);
}

.aktiv button.weg:hover {
    color: var(--red-color);
}

.liste {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 120px;
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
    grid-template-columns: 1fr auto;
    min-height: 26px;
    align-items: center;
    gap: 8px;
    font-size: 12px;
}

.gruppe {
    border: 1px solid var(--white-10);
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.02);
}

.gruppe:not(:has(.gKopf)) {
    border: none;
    background: transparent;
}

.gKopf {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    cursor: pointer;
    user-select: none;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--white-87, #ddd);
}

.gKopf:hover {
    background: var(--white-10);
    border-radius: 7px;
}

.gKopf .pfeil {
    transition: transform 0.15s;
    transform: rotate(90deg);
    color: var(--grey-text);
}

.gruppe.zu .gKopf .pfeil {
    transform: rotate(0deg);
}

.gName {
    flex: 1;
}

.gInhalt {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 10px 8px;
}

.gruppe:not(:has(.gKopf)) .gInhalt {
    padding: 0;
}

.gInhalt.aus,
.zeile.aus .regler > :not(:first-child) {
    opacity: 0.4;
}

.zeile .regler {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
}

.regler .zahl {
    width: 68px;
}

.regler .wahl {
    width: auto;
    min-width: 70px;
}

.zeile .schalter {
    justify-self: end;
    margin: 0;
}

.hinweisI {
    margin-left: 4px;
    opacity: 0.5;
    font-size: 11px;
}

.regler input[type='color'] {
    width: 30px;
    height: 22px;
    padding: 0;
    border: none;
    background: transparent;
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
