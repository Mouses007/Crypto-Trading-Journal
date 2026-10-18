<script setup>
/**
 * Alarm anlegen oder ändern. Drei Arten:
 *   preis  über/unter/kreuzt einen festen Preis
 *   linie  über/unter/kreuzt eine gezeichnete Linie (auch schräg — der Server
 *          rechnet den Linienpreis zur jeweiligen Zeit)
 *   zone   Rechteck oder Kanal betreten/verlassen
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { legeAlarmAn, aendereAlarm } from '../../stores/chartAlarme.js'

const props = defineProps({
    // Neu: { symbol, markt, art, preis?, zeichnung? } — Ändern: der Alarm selbst (mit id)
    vorlage: { type: Object, required: true },
})
const emit = defineEmits(['schliesse'])
const { t } = useI18n()

const istNeu = !props.vorlage.id
const v = props.vorlage
const zeichnungTyp = v.zeichnung?.typ || null
const art = v.art
const richtung = ref(v.bedingung?.richtung || (art === 'zone' ? 'betreten' : 'kreuzt'))
const preis = ref(v.bedingung?.preis ?? v.preis ?? '')
const kante = ref(v.bedingung?.kante || 'oben')
const einmalig = ref(v.einmalig ?? true)
const sperreMin = ref(v.bedingung?.sperreMin ?? 15)
const schwere = ref(v.bedingung?.schwere || 'warnung')
const push = ref(v.kanaele?.push !== false)
const mail = ref(v.kanaele?.mail !== false)
const notiz = ref(v.notiz || '')
const fehler = ref('')
const speichert = ref(false)

const richtungen = computed(() => (art === 'zone' ? ['betreten', 'verlassen'] : ['kreuzt', 'ueber', 'unter']))

async function speichern() {
    fehler.value = ''
    speichert.value = true
    const bedingung = { richtung: richtung.value, schwere: schwere.value }
    if (art === 'preis') bedingung.preis = Number(preis.value)
    if (zeichnungTyp === 'kanal' && art === 'linie') bedingung.kante = kante.value
    if (!einmalig.value) bedingung.sperreMin = Number(sperreMin.value) || 0
    const gemeinsam = { bedingung, einmalig: einmalig.value, kanaele: { push: push.value, mail: mail.value }, notiz: notiz.value }
    try {
        if (istNeu) {
            await legeAlarmAn({ symbol: v.symbol, markt: v.markt, art, zeichnungId: v.zeichnung?.id ?? null, ...gemeinsam })
        } else {
            await aendereAlarm(v.id, { ...gemeinsam, aktiv: true })
        }
        emit('schliesse')
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        speichert.value = false
    }
}
</script>

<template>
    <div class="dialogHintergrund" @click.self="emit('schliesse')">
        <div class="dialog">
            <div class="kopf">
                <b><i class="uil uil-bell"></i> {{ t(istNeu ? 'chart.alarm.neu' : 'chart.alarm.aendern') }} — {{ v.symbol }}{{ v.markt === 'spot' ? ' Spot' : '' }}</b>
                <button class="zu" @click="emit('schliesse')"><i class="uil uil-times"></i></button>
            </div>
            <div class="art">{{ t('chart.alarm.art.' + art) }}<template v-if="zeichnungTyp"> · {{ t('chart.wz.' + zeichnungTyp) }}</template></div>
            <label class="zeile">
                <span>{{ t('chart.alarm.bedingung') }}</span>
                <select v-model="richtung" class="form-select form-select-sm">
                    <option v-for="r in richtungen" :key="r" :value="r">{{ t('chart.alarm.richtung.' + r) }}</option>
                </select>
            </label>
            <label v-if="art === 'preis'" class="zeile">
                <span>{{ t('chart.alarm.preis') }}</span>
                <input v-model="preis" type="number" step="any" class="form-control form-control-sm" />
            </label>
            <label v-if="art === 'linie' && zeichnungTyp === 'kanal'" class="zeile">
                <span>{{ t('chart.alarm.kante') }}</span>
                <select v-model="kante" class="form-select form-select-sm">
                    <option value="oben">{{ t('chart.alarm.kanten.oben') }}</option>
                    <option value="mitte">{{ t('chart.alarm.kanten.mitte') }}</option>
                    <option value="unten">{{ t('chart.alarm.kanten.unten') }}</option>
                </select>
            </label>
            <label class="haken"><input v-model="einmalig" type="checkbox" /> {{ t('chart.alarm.einmalig') }}</label>
            <label v-if="!einmalig" class="zeile">
                <span>{{ t('chart.alarm.sperre') }}</span>
                <input v-model="sperreMin" type="number" min="0" class="form-control form-control-sm" />
            </label>
            <label class="zeile">
                <span>{{ t('chart.alarm.schwere') }}</span>
                <select v-model="schwere" class="form-select form-select-sm">
                    <option value="info">{{ t('chart.alarm.schweren.info') }}</option>
                    <option value="warnung">{{ t('chart.alarm.schweren.warnung') }}</option>
                    <option value="kritisch">{{ t('chart.alarm.schweren.kritisch') }}</option>
                </select>
            </label>
            <div class="haken">
                <label><input v-model="push" type="checkbox" /> {{ t('chart.alarm.push') }}</label>
                <label><input v-model="mail" type="checkbox" /> {{ t('chart.alarm.mail') }}</label>
            </div>
            <input v-model="notiz" class="form-control form-control-sm" maxlength="300" :placeholder="t('chart.alarm.notiz')" />
            <div class="hinweis">{{ t('chart.alarm.hinweis') }}</div>
            <div v-if="fehler" class="fehler">{{ fehler }}</div>
            <div class="fuss">
                <button class="btn btn-sm btn-outline-secondary" @click="emit('schliesse')">{{ t('chart.alarm.abbrechen') }}</button>
                <button class="btn btn-sm btn-primary" :disabled="speichert || (art === 'preis' && !(Number(preis) > 0))" @click="speichern">
                    {{ t('chart.alarm.speichern') }}</button>
            </div>
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
    width: 380px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--black-bg-5, #1e222d);
    border: 1px solid var(--white-18);
    border-radius: 10px;
    padding: 12px;
    font-size: 12px;
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

.art {
    color: var(--grey-text);
}

.zeile {
    display: grid;
    grid-template-columns: 1fr 170px;
    align-items: center;
    gap: 8px;
}

.haken {
    display: flex;
    gap: 14px;
    align-items: center;
}

.haken label {
    display: flex;
    gap: 6px;
    align-items: center;
}

.hinweis {
    color: var(--grey-text);
    font-size: 11px;
}

.fehler {
    color: var(--red-color);
}

.fuss {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}
</style>
