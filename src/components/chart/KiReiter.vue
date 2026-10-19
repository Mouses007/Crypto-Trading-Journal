<script setup>
/**
 * Seitenleiste „KI-Analyse": das Modell liest den aktiven Chart und schlägt
 * Linien, Zonen und Bedingungen vor. Im Chart erscheinen sie gestrichelt als
 * Vorschau; was taugt, wird einzeln (oder alles) in die eigenen Zeichnungen
 * übernommen und ist danach eine ganz normale Linie — verschiebbar, mit
 * Alarm belegbar.
 *
 * Erzeugt wird nur auf Knopfdruck (kostet einen KI-Aufruf); beim Öffnen wird
 * die letzte Analyse für Symbol und Zeiteinheit gelesen, falls es eine gibt.
 */
import { letzterStil } from '../../stores/zeichenStil.js'
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { linieAlsZeichnung, zoneAlsZeichnung, profileAlsZeichnungen, istProfilLinie, istProfilZone } from '../../utils/chart/kiZeichnungen.js'
import { legeAn } from '../../stores/chartZeichnungen.js'
import KiChat from './KiChat.vue'

const props = defineProps({
    panel: { type: Object, required: true },
    // rechter Rand des sichtbaren Bereichs (ms) — für den Chat
    sichtbarBis: { type: Function, default: null },
})
const emit = defineEmits(['vorschau'])
const { t } = useI18n()

/*
 * Analyse oder Chat — eine Frage des Bildschirms, nicht des Layouts, daher im
 * Browser gemerkt. Die Vorschau der Analyse bleibt im Chart stehen, während
 * man chattet: der Chat liest dieselbe Analyse mit.
 */
const MODUS_SCHLUESSEL = 'chartKiModus'
function leseModus() { try { return localStorage.getItem(MODUS_SCHLUESSEL) === 'chat' ? 'chat' : 'analyse' } catch { return 'analyse' } }
const modus = ref(leseModus())
function setzeModus(m) { modus.value = m; try { localStorage.setItem(MODUS_SCHLUESSEL, m) } catch { /* kein Speicher */ } }

/*
 * Was die Analyse liefern soll (Kästchen) — eine Vorliebe, kein Layout-Teil,
 * daher im Browser gemerkt. Abgewähltes bekommt die KI gar nicht zu sehen.
 */
const OPTIONEN = ['niveaus', 'trend', 'zonen', 'volumen', 'htf', 'bedingungen', 'hebel']
const optionen = ref((() => {
    const a = Object.fromEntries(OPTIONEN.map((k) => [k, true]))
    try { Object.assign(a, JSON.parse(localStorage.getItem('chartKiOptionen') || '{}')) } catch { /* Vorgabe */ }
    return a
})())
watch(optionen, (v) => { try { localStorage.setItem('chartKiOptionen', JSON.stringify(v)) } catch { /* kein Speicher */ } }, { deep: true })
const keineQuelle = computed(() => !optionen.value.niveaus && !optionen.value.trend && !optionen.value.volumen && !optionen.value.htf)
// Zonen entstehen aus Niveaus, Volumenprofil oder höherer Zeiteinheit
const zonenMoeglich = computed(() => optionen.value.niveaus || optionen.value.volumen || optionen.value.htf)

const analyse = ref(null)
const laeuft = ref(false)
const fehler = ref('')
const uebernommen = ref(new Set())
const uebernimmtAlle = ref(false)

/*
 * Jede Antwort gehört zu dem Panel-Stand, für den sie bestellt wurde. Ein Lauf
 * dauert bis zu 2 × 90 s; wer währenddessen das Symbol wechselt, bekam sonst
 * die BTC-Analyse im ETH-Panel — und „Alle übernehmen" legte BTC-Preise als
 * ETH-Zeichnungen an.
 */
const stand = () => `${props.panel.symbol}|${props.panel.interval}|${props.panel.markt === 'spot' ? 'spot' : 'futures'}`
let nr = 0

async function ladeLetzte() {
    const meine = ++nr
    const fuer = stand()
    fehler.value = ''
    uebernommen.value = new Set()
    try {
        const { data } = await axios.get('/api/chart/ki-analyse', { params: { symbol: props.panel.symbol, interval: props.panel.interval, markt: props.panel.markt } })
        if (meine !== nr || fuer !== stand()) return
        analyse.value = data.leer ? null : data
    } catch { if (meine === nr) analyse.value = null }
    zeigeVorschau(analyse.value)
}

async function erstelle() {
    const meine = ++nr
    const fuer = stand()
    laeuft.value = true
    fehler.value = ''
    const beginn = Date.now()
    try {
        const { data } = await axios.post('/api/chart/ki-analyse', {
            symbol: props.panel.symbol, interval: props.panel.interval, markt: props.panel.markt,
            auswahl: { ...optionen.value, zonen: optionen.value.zonen && zonenMoeglich.value },
        })
        // Inzwischen anderes Symbol: verwerfen. Der Server hat sie abgelegt — zurück
        // auf dem alten Symbol zeigt der Reiter sie wieder, ohne neu zu bezahlen.
        if (meine !== nr || fuer !== stand()) return
        analyse.value = data
        uebernommen.value = new Set()
        zeigeVorschau(data)
    } catch (e) {
        // Brach nur der Browser ab, rechnet der Server weiter und legt das Ergebnis ab —
        // dann nachsehen statt einen Fehler für bezahlte Arbeit zu zeigen.
        if (e.code === 'ECONNABORTED' && meine === nr && fuer === stand()) {
            if (await warteAufErgebnis(beginn, meine, fuer)) return
        }
        if (meine === nr && fuer === stand()) fehler.value = e.response?.data?.error || e.message
    } finally {
        laeuft.value = false
    }
}

/** Nach einem Abbruch im Browser bis zu 5 Minuten im Server-Cache nachsehen. */
async function warteAufErgebnis(beginn, meine, fuer) {
    fehler.value = t('chart.ki.dauertLaenger')
    for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 10_000))
        if (meine !== nr || fuer !== stand()) return true
        try {
            const { data } = await axios.get('/api/chart/ki-analyse', { params: { symbol: props.panel.symbol, interval: props.panel.interval, markt: props.panel.markt } })
            // 30 s Spielraum für eine abweichende Server-Uhr
            if (!data.leer && data.stand >= beginn - 30_000) {
                fehler.value = ''
                analyse.value = data
                uebernommen.value = new Set()
                zeigeVorschau(data)
                return true
            }
        } catch { /* weiter warten */ }
    }
    return false
}

async function uebernimm(art, i) {
    const a = analyse.value
    // V-Marken: EIN Profil über den Bereich — einmal anlegen, alle V-Einträge gelten dann als übernommen
    const profil = art === 'linie' ? istProfilLinie(a.linien[i]) : istProfilZone(a.zonen[i])
    if (profil) {
        if (!uebernommen.value.has('profil')) {
            for (const roh of profileAlsZeichnungen(a, letzterStil('volprofil'))) {
                const z = await legeAn({ symbol: a.symbol || props.panel.symbol, ...roh, sichtbarAuf: null, gesperrt: false, versteckt: false })
                if (!z) return
            }
        }
        const v = [...a.linien.map((l, j) => (istProfilLinie(l) ? `linie${j}` : null)), ...a.zonen.map((x, j) => (istProfilZone(x) ? `zone${j}` : null))].filter(Boolean)
        uebernommen.value = new Set([...uebernommen.value, 'profil', ...v])
        return
    }
    // Übernommen ohne ID im Text — „(N4)" bezieht sich nur auf diese Analyse.
    const roh = art === 'linie' ? linieAlsZeichnung({ ...a.linien[i], id: null }) : zoneAlsZeichnung({ ...a.zonen[i], ids: [] }, a.kerzenVon, a.kerzenBis)
    // Übernommen heisst: eigene Linie — durchgezogen statt gestrichelt.
    // Unter dem Symbol der ANALYSE, nicht des Panels — die beiden können auseinanderlaufen.
    const z = await legeAn({ symbol: a.symbol || props.panel.symbol, ...roh, stil: { ...roh.stil, strich: 'voll' }, sichtbarAuf: null, gesperrt: false, versteckt: false })
    if (z) uebernommen.value = new Set([...uebernommen.value, `${art}${i}`])
}

async function alleUebernehmen() {
    if (uebernimmtAlle.value) return     // zweiter Klick während des ersten legte alles doppelt an
    uebernimmtAlle.value = true
    try {
        const a = analyse.value
        for (let i = 0; i < a.linien.length; i++) if (!uebernommen.value.has(`linie${i}`)) await uebernimm('linie', i)
        for (let i = 0; i < a.zonen.length; i++) if (!uebernommen.value.has(`zone${i}`)) await uebernimm('zone', i)
    } finally { uebernimmtAlle.value = false }
}

function verwerfen() {
    analyse.value = null
    zeigeVorschau(null)
}

/* „Alle Kandidaten zeigen": nicht gewählte Marken grau gepunktet dazu (im Browser gemerkt). */
const alle = ref((() => { try { return localStorage.getItem('chartKiAlle') === '1' } catch { return false } })())
function zeigeVorschau(a) { emit('vorschau', a ? { ...a, _alle: alle.value } : null) }
function schalteAlle() {
    alle.value = !alle.value
    try { localStorage.setItem('chartKiAlle', alle.value ? '1' : '0') } catch { /* kein Speicher */ }
    zeigeVorschau(analyse.value)
}
const ZUSTAND = { 1: 'auf', '-1': 'ab', 0: 'offen' }
const struktur = (a) => {
    const s = a?.auswahl
    if (!s?.struktur) return ''
    const br = s.struktur.bruch
    return t('chart.ki.struktur', {
        tf: a.interval, zustand: t('chart.ki.zustand.' + ZUSTAND[s.struktur.zustand]),
        bruch: br ? t('chart.ki.bruch.' + br.richtung, { p: preis(br.marke), zeit: new Date(br.t).toLocaleDateString() }) : '',
        von: s.spanne ? preis(s.spanne.tief) : '—', bis: s.spanne ? preis(s.spanne.hoch) : '—', pos: s.spanne ? Math.round(s.spanne.positionPct) : '—',
    })
}

const zeit = (ms) => (ms ? new Date(ms).toLocaleString() : '')
const preis = (p) => (Math.abs(p) >= 1000 ? p.toFixed(1) : Math.abs(p) >= 1 ? p.toFixed(3) : p.toPrecision(4))

watch(() => [props.panel.symbol, props.panel.interval, props.panel.markt], ladeLetzte, { immediate: true })
</script>

<template>
    <div class="kiReiter">
        <div class="btn-group btn-group-sm modus" role="group">
            <button type="button" class="btn" :class="modus === 'analyse' ? 'btn-primary' : 'btn-outline-secondary'" @click="setzeModus('analyse')">
                <i class="uil uil-chart-line"></i> {{ t('chart.ki.modusAnalyse') }}</button>
            <button type="button" class="btn" :class="modus === 'chat' ? 'btn-primary' : 'btn-outline-secondary'" @click="setzeModus('chat')">
                <i class="uil uil-comment-dots"></i> {{ t('chart.ki.modusChat') }}</button>
        </div>
        <KiChat v-if="modus === 'chat'" class="chatFlaeche" :panel="panel" :sichtbar-bis="sichtbarBis" />
        <template v-else>
        <button class="btn btn-sm btn-outline-primary" :disabled="laeuft || keineQuelle" @click="erstelle">
            <span v-if="laeuft" class="spinner-border spinner-border-sm"></span>
            <template v-else><i class="uil uil-robot"></i> {{ t('chart.ki.erstellen', { symbol: panel.symbol, tf: panel.interval }) }}</template>
        </button>
        <div class="optionen">
            <label v-for="o in OPTIONEN" :key="o" class="option" :class="{ aus: o === 'zonen' && !zonenMoeglich }" :title="t('chart.ki.optTipp.' + o)">
                <input v-model="optionen[o]" type="checkbox" class="form-check-input" :disabled="o === 'zonen' && !zonenMoeglich" />
                {{ t('chart.ki.opt.' + o) }}
            </label>
        </div>
        <div v-if="keineQuelle" class="fehler">{{ t('chart.ki.optLeer') }}</div>
        <div class="hinweis">{{ t('chart.ki.hinweis') }}</div>
        <div v-if="fehler" class="fehler">{{ fehler }}</div>

        <template v-if="analyse">
            <div class="kopf">
                <small>{{ zeit(analyse.stand) }} · {{ analyse.provider }}/{{ analyse.model }}<template v-if="analyse.costUsd != null">
                        · {{ analyse.costUsd.toFixed(4) }} $</template></small>
            </div>
            <div v-if="analyse.auswahl" class="struktur">{{ struktur(analyse) }}</div>
            <p v-if="analyse.text" class="text">{{ analyse.text }}</p>

            <div v-if="analyse.bedingungen?.length" class="abschnitt">{{ t('chart.ki.bedingungen') }}</div>
            <div v-for="(b, i) in analyse.bedingungen" :key="'b' + i" class="bedingung">
                <b>{{ t('chart.ki.wenn') }}</b> {{ b.wenn }} → {{ b.dann }}<span v-if="b.zielId" class="id">→ {{ b.zielId }}</span>
            </div>

            <div v-if="analyse.linien?.length || analyse.zonen?.length" class="abschnitt">
                {{ t('chart.ki.vorschlaege') }}
                <button class="btn btn-sm btn-link p-0 ms-2" :disabled="uebernimmtAlle" @click="alleUebernehmen">{{ t('chart.ki.alleUebernehmen') }}</button>
                <button v-if="analyse.auswahl" class="btn btn-sm btn-link p-0 ms-2" :class="{ an: alle }" @click="schalteAlle">{{ t(alle ? 'chart.ki.kandidatenAus' : 'chart.ki.kandidatenZeigen') }}</button>
            </div>
            <div v-for="(l, i) in analyse.linien" :key="'l' + i" class="vorschlag">
                <div class="zeile">
                    <span class="art">{{ t('chart.ki.art.' + l.art) }}</span>
                    <span v-if="l.id" class="id" :class="l.gewicht">{{ l.id }}</span>
                    <span class="label">{{ l.label }}</span>
                    <span class="preis">{{ l.p1 === l.p2 ? preis(l.p1) : `${preis(l.p1)} → ${preis(l.p2)}` }}</span>
                    <button class="btn btn-sm btn-link p-0" :disabled="uebernommen.has('linie' + i)" @click="uebernimm('linie', i)">
                        {{ uebernommen.has('linie' + i) ? '✓' : t('chart.ki.uebernehmen') }}</button>
                </div>
                <small>{{ l.grund }}</small>
            </div>
            <div v-for="(z, i) in analyse.zonen" :key="'z' + i" class="vorschlag">
                <div class="zeile">
                    <span class="art">{{ t('chart.ki.zone') }}</span>
                    <span v-if="z.ids?.length" class="id" :class="z.gewicht">{{ z.ids.join('+') }}</span>
                    <span class="label">{{ z.label }}</span>
                    <span class="preis">{{ preis(z.tief) }}–{{ preis(z.hoch) }}</span>
                    <button class="btn btn-sm btn-link p-0" :disabled="uebernommen.has('zone' + i)" @click="uebernimm('zone', i)">
                        {{ uebernommen.has('zone' + i) ? '✓' : t('chart.ki.uebernehmen') }}</button>
                </div>
                <small>{{ z.grund }}</small>
            </div>
            <div v-if="analyse.verworfen?.length" class="verworfen">{{ t('chart.ki.verworfen', { n: analyse.verworfen.length }) }}</div>
            <button class="btn btn-sm btn-link p-0" @click="verwerfen">{{ t('chart.ki.vorschauWeg') }}</button>
        </template>
        </template>
    </div>
</template>

<style scoped>
.kiReiter {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    min-height: 0;
    height: 100%;
    font-size: 12px;
}

.kiReiter:has(.chatFlaeche) {
    overflow: hidden;
}

.optionen {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    flex-shrink: 0;
}

.option {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--white-87, #ddd);
    cursor: pointer;
    white-space: nowrap;
}

.option input {
    margin: 0;
    width: 12px;
    height: 12px;
}

.option.aus {
    opacity: 0.45;
}

.struktur {
    color: var(--grey-text);
    font-size: 11px;
}

.id {
    font-size: 10px;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--white-10);
    color: var(--grey-text);
    margin: 0 2px;
}

.id.stark {
    background: rgba(245, 197, 66, 0.25);
    color: #f5c542;
}

.id.schwach {
    opacity: 0.6;
}

.btn-link.an {
    font-weight: 600;
}

.modus {
    display: flex;
    flex-shrink: 0;
}

.modus .btn {
    flex: 1;
    font-size: 12px;
}

.hinweis,
.kopf small,
.verworfen {
    color: var(--grey-text);
    font-size: 11px;
}

.fehler {
    color: var(--red-color);
}

.text {
    margin: 0;
    line-height: 1.45;
}

.abschnitt {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--grey-text);
    margin-top: 6px;
}

.bedingung {
    line-height: 1.4;
}

.bedingung b {
    color: var(--blue-color);
    font-weight: 500;
}

.vorschlag {
    border-left: 2px solid #ab47bc;
    padding-left: 6px;
}

.vorschlag .zeile {
    display: flex;
    gap: 6px;
    align-items: center;
}

.vorschlag .art {
    font-size: 10px;
    color: #ab47bc;
}

.vorschlag .label {
    flex: 1;
}

.vorschlag .preis {
    font-variant-numeric: tabular-nums;
    color: var(--grey-text);
}

.vorschlag small {
    color: var(--grey-text);
}
</style>
