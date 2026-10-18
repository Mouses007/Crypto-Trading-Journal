<script setup>
/**
 * Indikator-Vorlagen: die Indikatoren des aktiven Charts (mit Einstellungen
 * und Farben) unter einem Namen speichern und auf jeden Chart anwenden — wie
 * „Indicator Templates" bei TradingView.
 *
 * Anwenden ERSETZT die Indikatoren des aktiven Charts; das Plus daneben fügt
 * sie hinzu. Gespeichert wird in der Datenbank (`/api/chart/vorlagen`), damit
 * eine Vorlage auf NAS, Rechner und Handy dieselbe ist.
 *
 * Favoriten (Stern) stehen als Knöpfe direkt in der Kopfleiste — ein Klick
 * wendet sie an, wie die Zeiteinheit-Favoriten. Gemerkt im Browser, wie dort.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../utils/chart/arbeitsplatz.js'

const props = defineProps({
    aktuelle: { type: Array, default: () => [] },   // Indikatoren des aktiven Panels
})
const emit = defineEmits(['anwenden'])
const { t } = useI18n()

const FAV_SCHLUESSEL = 'chartVorlagenFavoriten'
function leseFavoriten() {
    try { const v = JSON.parse(localStorage.getItem(FAV_SCHLUESSEL) || '[]'); return Array.isArray(v) ? v.filter(Number.isFinite) : [] } catch { return [] }
}
const favoriten = ref(leseFavoriten())
function schalteFavorit(v) {
    favoriten.value = favoriten.value.includes(v.id) ? favoriten.value.filter((x) => x !== v.id) : [...favoriten.value, v.id]
    try { localStorage.setItem(FAV_SCHLUESSEL, JSON.stringify(favoriten.value)) } catch { /* kein Speicher */ }
}
// Gelöschte Vorlagen fallen aus den Favoriten einfach heraus (nur Vorhandenes wird gezeigt).
const favoritVorlagen = computed(() => vorlagen.value.filter((v) => favoriten.value.includes(v.id)))

const offen = ref(false)
const vorlagen = ref([])
const fehler = ref('')
const wurzel = ref(null)

async function lade() {
    try { vorlagen.value = await api.vorlagen() } catch { /* Liste bleibt, wie sie war */ }
}

function nurInhalt(liste) {
    return (liste || []).map((i) => ({ typ: i.typ, params: i.params || {}, farben: i.farben || {}, sichtbar: i.sichtbar !== false }))
}

async function speichern() {
    if (!props.aktuelle.length) return
    const n = window.prompt(t('chart.vorlage.nameFrage'), t('chart.vorlage.nameVorgabe'))
    if (!n) return
    fehler.value = ''
    try {
        await api.vorlageNeu(n, nurInhalt(props.aktuelle))
        await lade()
    } catch (e) { fehler.value = e.response?.data?.error || e.message }
}

async function ueberschreiben(v) {
    if (!props.aktuelle.length) return
    if (!window.confirm(t('chart.vorlage.ueberschreibenFrage', { name: v.name }))) return
    try { await api.vorlageSpeichern(v.id, { indikatoren: nurInhalt(props.aktuelle) }); await lade() } catch (e) { fehler.value = e.response?.data?.error || e.message }
}

async function umbenennen(v) {
    const n = window.prompt(t('chart.vorlage.nameFrage'), v.name)
    if (!n || n === v.name) return
    try { await api.vorlageSpeichern(v.id, { name: n }); await lade() } catch (e) { fehler.value = e.response?.data?.error || e.message }
}

async function loeschen(v) {
    if (!window.confirm(t('chart.vorlage.loeschenFrage', { name: v.name }))) return
    try { await api.vorlageLoeschen(v.id); await lade() } catch (e) { fehler.value = e.response?.data?.error || e.message }
}

function anwenden(v, modus) {
    emit('anwenden', { indikatoren: v.indikatoren, modus })
    offen.value = false
}

function umschalten() {
    offen.value = !offen.value
    if (offen.value) { fehler.value = ''; lade() }
}

// Klick ausserhalb schliesst — die anderen Menüs der Kopfleiste bleiben offen, bis man sie zuklickt,
// dieses hat aber Knöpfe, die Dialoge öffnen; ein offen hängendes Menü darüber wirkt kaputt.
function draussen(e) { if (offen.value && wurzel.value && !wurzel.value.contains(e.target)) offen.value = false }
onMounted(() => { lade(); document.addEventListener('mousedown', draussen) })
onBeforeUnmount(() => document.removeEventListener('mousedown', draussen))
</script>

<template>
    <div ref="wurzel" class="aufklapp">
        <button class="tf" :class="{ an: offen }" :title="t('chart.vorlage.titel')" @click="umschalten" :aria-label="t('chart.vorlage.titel')">
            <i class="uil uil-bookmark"></i> {{ t('chart.vorlage.knopf') }}
        </button>
        <div v-if="offen" class="menue vorlagenMenue">
            <div class="kopf">{{ t('chart.vorlage.titel') }}</div>
            <div v-if="!vorlagen.length" class="leer">{{ t('chart.vorlage.leer') }}</div>
            <div v-for="v in vorlagen" :key="v.id" class="zeile">
                <button class="name" :title="t('chart.vorlage.anwendenTitel', { n: v.indikatoren.length })" @click="anwenden(v, 'ersetzen')" :aria-label="t('chart.vorlage.anwendenTitel', { n: v.indikatoren.length })">
                    {{ v.name }} <small>{{ v.indikatoren.length }}</small>
                </button>
                <button class="mini stern" :class="{ an: favoriten.includes(v.id) }"
                    :title="t(favoriten.includes(v.id) ? 'chart.vorlage.favoritWeg' : 'chart.vorlage.favoritHinzu')"
                    @click="schalteFavorit(v)" :aria-label="t(favoriten.includes(v.id) ? 'chart.vorlage.favoritWeg' : 'chart.vorlage.favoritHinzu')"><i class="uil uil-star"></i></button>
                <button class="mini" :title="t('chart.vorlage.hinzufuegen')" @click="anwenden(v, 'hinzu')" :aria-label="t('chart.vorlage.hinzufuegen')"><i class="uil uil-plus"></i></button>
                <button class="mini" :disabled="!aktuelle.length" :title="t('chart.vorlage.ueberschreiben')" @click="ueberschreiben(v)" :aria-label="t('chart.vorlage.ueberschreiben')"><i class="uil uil-sync"></i></button>
                <button class="mini" :title="t('chart.vorlage.umbenennen')" @click="umbenennen(v)" :aria-label="t('chart.vorlage.umbenennen')"><i class="uil uil-pen"></i></button>
                <button class="mini weg" :title="t('chart.vorlage.loeschen')" @click="loeschen(v)" :aria-label="t('chart.vorlage.loeschen')"><i class="uil uil-trash-alt"></i></button>
            </div>
            <hr />
            <button class="eintrag" :disabled="!aktuelle.length" @click="speichern">
                <i class="uil uil-plus-circle"></i> {{ t('chart.vorlage.speichern', { n: aktuelle.length }) }}
            </button>
            <div v-if="fehler" class="fehler">{{ fehler }}</div>
        </div>
    </div>
    <!-- Favoriten direkt in der Leiste: ein Klick ersetzt die Indikatoren des aktiven Charts. -->
    <button v-for="v in favoritVorlagen" :key="'fav' + v.id" class="tf favorit"
        :title="t('chart.vorlage.anwendenTitel', { n: v.indikatoren.length })" @click="anwenden(v, 'ersetzen')" :aria-label="t('chart.vorlage.anwendenTitel', { n: v.indikatoren.length })">
        <i class="uil uil-star"></i> {{ v.name }}
    </button>
</template>

<style scoped>
/* Dieselben Knöpfe und Menüs wie in der Kopfleiste (deren Stile sind scoped und reichen nicht herein). */
.tf {
    background: transparent;
    border: none;
    color: var(--grey-text);
    font-size: 12px;
    padding: 3px 7px;
    border-radius: 4px;
    white-space: nowrap;
}

.tf:hover {
    color: var(--white-87, #eee);
    background: var(--white-10);
}

.tf.an {
    color: var(--blue-color);
    background: rgba(1, 180, 255, 0.1);
}

.aufklapp {
    position: relative;
}

.menue {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    display: flex;
    gap: 2px;
    background: var(--black-bg-5, #1e222d);
    border: 1px solid var(--white-18);
    border-radius: 8px;
    padding: 6px;
    box-shadow: var(--shadow-sm);
}

.menue hr {
    margin: 4px 0;
    border-color: var(--white-18);
}

.eintrag {
    background: transparent;
    border: none;
    color: var(--white-87, #ddd);
    text-align: left;
    font-size: 12px;
    padding: 5px 8px;
    border-radius: 4px;
}

.eintrag:hover:not(:disabled) {
    background: var(--white-10);
}

.eintrag:disabled {
    opacity: 0.4;
}

.vorlagenMenue {
    flex-direction: column;
    flex-wrap: nowrap;
    width: 280px;
}

.kopf {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--grey-text);
    padding: 0 4px 4px;
}

.leer {
    font-size: 12px;
    color: var(--grey-text);
    padding: 4px;
}

.zeile {
    display: flex;
    align-items: center;
    gap: 2px;
}

.zeile .name {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: transparent;
    border: none;
    color: var(--white-87, #ddd);
    padding: 5px 6px;
    border-radius: 4px;
    font-size: 12px;
}

.zeile .name small {
    color: var(--grey-text);
    margin-left: 4px;
}

.zeile .name:hover,
.mini:hover:not(:disabled) {
    background: var(--white-10);
}

.mini {
    background: transparent;
    border: none;
    color: var(--grey-text);
    padding: 3px 5px;
    border-radius: 4px;
    font-size: 13px;
}

.mini.stern.an,
.mini.stern:hover {
    color: #ffd54f;
}

.favorit {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.favorit i {
    color: #ffd54f;
    font-size: 10px;
}

.mini.weg:hover {
    color: var(--red-color);
}

.mini:disabled {
    opacity: 0.35;
}

.fehler {
    color: var(--red-color);
    font-size: 11px;
    padding: 4px;
}
</style>
