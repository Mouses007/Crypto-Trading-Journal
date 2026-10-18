<script setup>
/**
 * Chart-Arbeitsplatz — ersetzt seit 18.10.2026 die frühere Übersicht.
 *
 * Deren Marktkacheln stehen alle auch im Marktradar, ihre Journal-Kacheln im
 * Journal selbst; doppelt war sie überflüssig. Was hier stattdessen steht, ist
 * ein Chart im Stil von TradingView — aber mit dem, was TradingView nicht hat:
 * Journal, Strategie-Schicht und eigene Marktdaten im selben Bild.
 *
 * Aufteilung: diese Seite hält den Arbeitsstand (Layout, Watchlists) und die
 * Synchronisation zwischen den Panels; jedes `ChartPanel` holt und zeichnet
 * seine Kerzen selbst. Gespeichert wird in der Datenbank, nicht im
 * localStorage — ein Layout soll auf NAS, Dev-Rechner und Handy dasselbe sein.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import ChartPanel from '../components/chart/ChartPanel.vue'
import ChartKopfleiste from '../components/chart/ChartKopfleiste.vue'
import WatchlistReiter from '../components/chart/WatchlistReiter.vue'
import IndikatorDialog from '../components/chart/IndikatorDialog.vue'
import Zeichenleiste from '../components/chart/Zeichenleiste.vue'
import ObjektReiter from '../components/chart/ObjektReiter.vue'
import StrategieReiter from '../components/chart/StrategieReiter.vue'
import AlarmReiter from '../components/chart/AlarmReiter.vue'
import KiReiter from '../components/chart/KiReiter.vue'
import AlarmDialog from '../components/chart/AlarmDialog.vue'
import { alarme, abonniereAlarme, neueAusloesungen, quittiere } from '../stores/chartAlarme.js'
import { zeichnungenVon, aendere as zeichnungAendern, loesche as zeichnungLoeschen, macheRueckgaengig, macheWiederholen, fehlerMeldung } from '../stores/chartZeichnungen.js'
import { neueInstanz } from '../utils/chart/indikatorRegister.js'
import { useIstTelefon } from '../utils/geraet.js'
import { api, standardLayout, vervollstaendige, passeAnRaster, PANELS_JE_RASTER, STANDARD_WATCHLIST } from '../utils/chart/arbeitsplatz.js'

const { t } = useI18n()
const telefon = useIstTelefon()

const layouts = ref([])
const layoutId = ref(null)
const daten = ref(standardLayout())
const watchlists = ref([])
const bereit = ref(false)
const ladeFehler = ref('')
const kopf = ref(null)
const panelRefs = ref([])

const sichtbareAnzahl = computed(() => (telefon.value ? 1 : PANELS_JE_RASTER[daten.value.raster] || 1))
const sichtbarePanels = computed(() => daten.value.panels.slice(0, sichtbareAnzahl.value))
const aktivIndex = computed(() => Math.min(daten.value.aktiv, sichtbareAnzahl.value - 1))
const aktivesPanel = computed(() => daten.value.panels[aktivIndex.value])
const rasterKlasse = computed(() => (telefon.value ? 'r1' : 'r' + daten.value.raster))

/*
 * Seitenleisten-Reiter. Weitere (Journal, Strategien, Alarme, Objekte) kommen
 * mit ihren Ausbaustufen dazu; ein leerer Reiter wird gar nicht erst gezeigt.
 */
const REITER = [
    { id: 'watchlist', icon: 'uil uil-star' },
    { id: 'objekte', icon: 'uil uil-layer-group' },
    { id: 'strategien', icon: 'uil uil-robot' },
    { id: 'alarme', icon: 'uil uil-bell' },
    { id: 'ki', icon: 'uil uil-brain' },
]

// ── Laden und Speichern ─────────────────────────────────────────────────
let speicherUhr = null
let ignoriereNaechsteAenderung = false

async function lade() {
    try {
        let liste = await api.layouts()
        if (!liste.length) liste = [await api.layoutNeu(t('chart.layoutStandard'), standardLayout(), true)]
        layouts.value = liste
        const aktiv = liste.find((l) => l.aktiv) || liste[0]
        waehleLayout(aktiv)

        let wl = await api.watchlists()
        if (!wl.length) wl = [await api.watchlistNeu(t('chart.watchlistStandard'), STANDARD_WATCHLIST)]
        watchlists.value = wl
        bereit.value = true
    } catch (e) {
        ladeFehler.value = e.response?.data?.error || e.message
    }
}

function waehleLayout(layout) {
    ignoriereNaechsteAenderung = true
    layoutId.value = layout.id
    daten.value = vervollstaendige(layout.daten)
}

/*
 * Breite der Seitenleiste: am linken Rand ziehbar. Bewusst im Browser statt im
 * Layout — sie hängt am Bildschirm, nicht am Arbeitsplatz (Handy ≠ Monitor).
 */
const LEISTE_MIN = 200
const LEISTE_MAX = 720
const LEISTE_SCHLUESSEL = 'chartLeisteBreite'
function leseLeistenBreite() {
    try {
        const n = Number(localStorage.getItem(LEISTE_SCHLUESSEL))
        if (n >= LEISTE_MIN && n <= LEISTE_MAX) return n
    } catch { /* kein Speicher */ }
    return 260
}
const leisteBreite = ref(leseLeistenBreite())
let leisteZug = null

function leisteZiehenStart(e) {
    leisteZug = { x: e.clientX, breite: leisteBreite.value }
    e.target.setPointerCapture?.(e.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
}
function leisteZiehen(e) {
    if (!leisteZug) return
    // Griff sitzt links: nach links ziehen macht die Leiste breiter.
    const max = Math.min(LEISTE_MAX, window.innerWidth * 0.6)
    leisteBreite.value = Math.round(Math.max(LEISTE_MIN, Math.min(max, leisteZug.breite + leisteZug.x - e.clientX)))
}
function leisteZiehenEnde() {
    if (!leisteZug) return
    leisteZug = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    try { localStorage.setItem(LEISTE_SCHLUESSEL, String(leisteBreite.value)) } catch { /* kein Speicher */ }
}
function leisteZuruecksetzen() {
    leisteBreite.value = 260
    try { localStorage.removeItem(LEISTE_SCHLUESSEL) } catch { /* kein Speicher */ }
}

watch(daten, () => {
    if (ignoriereNaechsteAenderung) { ignoriereNaechsteAenderung = false; return }
    clearTimeout(speicherUhr)
    speicherUhr = setTimeout(speichere, 800)
}, { deep: true })

async function speichere() {
    if (!layoutId.value) return
    try {
        const neu = await api.layoutSpeichern(layoutId.value, { daten: daten.value })
        const i = layouts.value.findIndex((l) => l.id === neu.id)
        if (i >= 0) layouts.value[i] = { ...layouts.value[i], geaendertAm: neu.geaendertAm }
    } catch { /* nächste Änderung versucht es erneut */ }
}

async function layoutWechsel(id) {
    await speichere()
    const l = layouts.value.find((x) => x.id === id)
    if (!l) return
    // Den gespeicherten Stand frisch holen — ein anderes Gerät kann ihn
    // inzwischen geändert haben.
    const frisch = (await api.layouts()).find((x) => x.id === id) || l
    waehleLayout(frisch)
    await api.layoutSpeichern(id, { aktiv: true })
}

async function layoutNeu(name) {
    await speichere()
    const kopie = JSON.parse(JSON.stringify(daten.value))
    const neu = await api.layoutNeu(name, kopie, true)
    layouts.value = [...layouts.value.map((l) => ({ ...l, aktiv: false })), neu]
    waehleLayout(neu)
}

async function layoutUmbenennen(name) {
    const neu = await api.layoutSpeichern(layoutId.value, { name })
    layouts.value = layouts.value.map((l) => (l.id === neu.id ? { ...l, name: neu.name } : l))
}

async function layoutLoeschen() {
    const weg = layoutId.value
    await api.layoutLoeschen(weg)
    layouts.value = layouts.value.filter((l) => l.id !== weg)
    if (layouts.value.length) await layoutWechsel(layouts.value[0].id)
}

// ── Panels ──────────────────────────────────────────────────────────────
function setzePanel(patch) {
    const d = daten.value
    const ziele = new Set([aktivIndex.value])
    if (d.sync.symbol && (patch.symbol || patch.markt)) d.panels.forEach((_, i) => ziele.add(i))
    if (d.sync.interval && patch.interval) d.panels.forEach((_, i) => ziele.add(i))
    for (const i of ziele) {
        const p = d.panels[i]
        const eigen = i === aktivIndex.value ? patch : {
            ...(d.sync.symbol && patch.symbol ? { symbol: patch.symbol, markt: patch.markt || p.markt } : {}),
            ...(d.sync.interval && patch.interval ? { interval: patch.interval } : {}),
        }
        Object.assign(p, eigen)
    }
}

function setzeRaster(r) {
    passeAnRaster(daten.value, r)
}

function setzeSync(patch) {
    Object.assign(daten.value.sync, patch)
}

function fokus(i) {
    if (daten.value.aktiv !== i) daten.value.aktiv = i
}

// ── Zeichnen ────────────────────────────────────────────────────────────
// Das Werkzeug gilt nur im aktiven Panel; Magnet und „alles verstecken"
// stehen im Layout, damit sie einen Neustart überleben.
const werkzeug = ref(null)
const aktiveZeichnungen = computed(() => zeichnungenVon(aktivesPanel.value.symbol).value)
const aktiveAuswahl = computed(() => panelRefs.value[aktivIndex.value]?.auswahlId ?? null)

function waehleWerkzeug(typ) {
    werkzeug.value = typ
}

function fehlerSchliessen() {
    fehlerMeldung.value = ''
}

function alleLoeschen() {
    const symbol = aktivesPanel.value.symbol
    const liste = aktiveZeichnungen.value.filter((z) => !z.gesperrt)
    if (!liste.length) return
    if (!window.confirm(t('chart.alleLoeschenFrage', { n: liste.length, symbol }, liste.length))) return
    for (const z of liste) zeichnungLoeschen(symbol, z.id)
}

const aktivesPanelRef = computed(() => panelRefs.value[aktivIndex.value] || null)

// ── Alarme ──────────────────────────────────────────────────────────────
const alarmVorlage = ref(null)
let alarmAbo = null

/** Aktive Preis-Alarme je Panel — als Linien im Chart. */
function alarmLinienFuer(p) {
    return alarme.value.filter((a) => a.aktiv && a.art === 'preis' && a.symbol === p.symbol && a.markt === p.markt)
}

function alarmBeiPreis(preis) {
    const p = aktivesPanel.value
    alarmVorlage.value = { symbol: p.symbol, markt: p.markt, art: 'preis', preis }
}

function alarmAufZeichnung(z) {
    const p = aktivesPanel.value
    const art = z.typ === 'rechteck' || z.typ === 'kanal' ? 'zone' : 'linie'
    alarmVorlage.value = { symbol: p.symbol, markt: p.markt, art, zeichnung: z }
}

function alarmBearbeiten(a) {
    alarmVorlage.value = { ...a }
}

const aktuellerKurs = computed(() => {
    const k = panelRefs.value[aktivIndex.value]?.kerzen
    return k?.length ? k[k.length - 1].c : null
})

function strategieFilter(f) {
    daten.value.panels[aktivIndex.value].strategieFilter = f
}

function objektWaehlen(z) {
    if (z.versteckt) zeichnungAendern(z.symbol, z.id, { versteckt: false })
    panelRefs.value[aktivIndex.value]?.waehleZeichnung(z.id)
}

// ── Indikatoren ─────────────────────────────────────────────────────────
// `dialog` = null | { panel, instanz: null (hinzufügen) | Objekt (einstellen) }
const dialog = ref(null)

function oeffneIndikatoren() {
    dialog.value = { panel: aktivIndex.value, instanz: null }
}

function indikatorHinzu(typ) {
    const p = daten.value.panels[dialog.value.panel]
    p.indikatoren = [...(p.indikatoren || []), neueInstanz(typ)]
    dialog.value = null
}

function indikatorSpeichern(instanz) {
    const p = daten.value.panels[dialog.value.panel]
    p.indikatoren = p.indikatoren.map((x) => (x.id === instanz.id ? instanz : x))
    dialog.value = null
}

function indikatorAktion(i, { aktion, id }) {
    const p = daten.value.panels[i]
    const inst = (p.indikatoren || []).find((x) => x.id === id)
    if (!inst) return
    if (aktion === 'entfernen') p.indikatoren = p.indikatoren.filter((x) => x.id !== id)
    else if (aktion === 'umschalten') inst.sichtbar = inst.sichtbar === false
    else if (aktion === 'bearbeiten') dialog.value = { panel: i, instanz: inst }
}

// ── Synchronisation ─────────────────────────────────────────────────────
function kreuz(i, info) {
    if (!daten.value.sync.kreuz) return
    panelRefs.value.forEach((p, j) => { if (j !== i) p?.setzeKreuz(info) })
}

let zeitRahmen = 0
function bereich(i) {
    if (!daten.value.sync.zeit || i !== aktivIndex.value || zeitRahmen) return
    zeitRahmen = requestAnimationFrame(() => {
        zeitRahmen = 0
        const r = panelRefs.value[i]?.sichtbarerZeitraum()
        if (!r) return
        panelRefs.value.forEach((p, j) => { if (j !== i) p?.setzeZeitraum(r.von, r.bis) })
    })
}

// ── Watchlists ──────────────────────────────────────────────────────────
async function watchlistAendern(id, symbole) {
    const neu = await api.watchlistSpeichern(id, { symbole })
    watchlists.value = watchlists.value.map((w) => (w.id === id ? neu : w))
}

async function watchlistNeu(name) {
    const neu = await api.watchlistNeu(name, [])
    watchlists.value = [...watchlists.value, neu]
}

async function watchlistLoeschen(id) {
    await api.watchlistLoeschen(id)
    watchlists.value = watchlists.value.filter((w) => w.id !== id)
}

// ── Sonstiges ───────────────────────────────────────────────────────────
function foto() {
    const leinwand = panelRefs.value[aktivIndex.value]?.bildschirmfoto()
    if (!leinwand) return
    leinwand.toBlob((blob) => {
        if (!blob) return
        const p = aktivesPanel.value
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${p.symbol}_${p.interval}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    })
}

/*
 * Tippen öffnet die Symbolsuche — wie bei TradingView. Nur wenn kein
 * Eingabefeld den Fokus hat, sonst frässe die Suche jede Notiz auf.
 */
function taste(e) {
    const ziel = e.target
    if (ziel && (ziel.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ziel.tagName))) return
    if (dialog.value) return
    const panel = panelRefs.value[aktivIndex.value]
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); macheRueckgaengig() }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); macheWiederholen() }
        return
    }
    if (e.altKey) return
    if (e.key === 'Escape') {
        if (panel?.abbrechen()) return
        werkzeug.value = null
        return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (panel?.loescheAuswahl()) e.preventDefault()
        return
    }
    if (/^[a-z0-9]$/i.test(e.key)) kopf.value?.oeffneSuche()
}

onMounted(() => {
    lade()
    window.addEventListener('keydown', taste)
    alarmAbo = abonniereAlarme()
})
onBeforeUnmount(() => {
    window.removeEventListener('keydown', taste)
    alarmAbo?.()
    clearTimeout(speicherUhr)
    cancelAnimationFrame(zeitRahmen)
    speichere()
})

watch(sichtbareAnzahl, async () => {
    await nextTick()
    panelRefs.value = panelRefs.value.slice(0, sichtbareAnzahl.value)
})
</script>

<template>
    <div class="chartSeite" :class="{ telefon }">
        <div v-if="ladeFehler" class="alert alert-warning m-2">{{ t('chart.arbeitsplatzFehler') }}: {{ ladeFehler }}</div>

        <template v-if="bereit">
            <ChartKopfleiste ref="kopf" :panel="aktivesPanel" :raster="daten.raster" :sync="daten.sync" :layouts="layouts"
                :layout-id="layoutId" :seitenleiste-offen="daten.seitenleiste.offen" :telefon="telefon"
                @panel="setzePanel" @indikatoren="oeffneIndikatoren" @raster="setzeRaster" @sync="setzeSync" @layout-wechsel="layoutWechsel"
                @layout-neu="layoutNeu" @layout-umbenennen="layoutUmbenennen" @layout-loeschen="layoutLoeschen"
                @seitenleiste="daten.seitenleiste.offen = !daten.seitenleiste.offen" @foto="foto" />

            <div v-for="n in neueAusloesungen" :key="n.id + '-' + n.t" class="alert alert-warning py-1 px-2 my-1 small alarmBanner"
                @click="quittiere(n.id)">
                <i class="uil uil-bell"></i> {{ n.text }} <small>({{ t('chart.alarm.quittieren') }})</small></div>
            <div v-if="fehlerMeldung" class="alert alert-warning py-1 px-2 my-1 small" @click="fehlerSchliessen">
                {{ t('chart.zeichnungFehler') }}: {{ fehlerMeldung }}</div>

            <div class="arbeitsflaeche" :class="{ mitLeiste: daten.seitenleiste.offen }"
                :style="{ '--leisteBreite': leisteBreite + 'px' }">
                <Zeichenleiste class="werkzeuge" :werkzeug="werkzeug" :magnet="!!daten.zeichnen?.magnet"
                    :versteckt="!!daten.zeichnen?.versteckt" @werkzeug="waehleWerkzeug"
                    @magnet="daten.zeichnen = { ...(daten.zeichnen || {}), magnet: !daten.zeichnen?.magnet }"
                    @versteckt="daten.zeichnen = { ...(daten.zeichnen || {}), versteckt: !daten.zeichnen?.versteckt }"
                    @alle-loeschen="alleLoeschen" />
                <div class="raster" :class="rasterKlasse">
                    <ChartPanel v-for="(p, i) in sichtbarePanels" :key="layoutId + '-' + i"
                        :ref="(el) => { if (el) panelRefs[i] = el }" :panel="p" :nummer="i"
                        :aktiv="sichtbareAnzahl > 1 && i === aktivIndex" @fokus="fokus(i)" @kreuz="kreuz(i, $event)"
                        @bereich="bereich(i)" @indikator="indikatorAktion(i, $event)"
                        :werkzeug="i === aktivIndex ? werkzeug : null" :magnet="!!daten.zeichnen?.magnet"
                        :zeichnungen-versteckt="!!daten.zeichnen?.versteckt" @werkzeug-fertig="werkzeug = null"
                        :alarm-linien="alarmLinienFuer(p)" @alarm-bei-preis="(x) => { fokus(i); alarmBeiPreis(x) }"
                        @alarm-auf-zeichnung="(z) => { fokus(i); alarmAufZeichnung(z) }"
                        @alle-loeschen="() => { fokus(i); alleLoeschen() }" />
                </div>

                <aside v-if="daten.seitenleiste.offen" class="seitenleiste">
                    <div class="leisteGriff" :title="t('chart.leisteBreite')" @pointerdown.prevent="leisteZiehenStart"
                        @pointermove="leisteZiehen" @pointerup="leisteZiehenEnde" @pointercancel="leisteZiehenEnde"
                        @dblclick="leisteZuruecksetzen"></div>
                    <div v-if="REITER.length > 1" class="reiter">
                        <button v-for="r in REITER" :key="r.id" :class="{ an: daten.seitenleiste.reiter === r.id }"
                            :title="t('chart.reiter.' + r.id)" @click="daten.seitenleiste.reiter = r.id">
                            <i :class="r.icon"></i>
                        </button>
                    </div>
                    <div class="reiterTitel">{{ t('chart.reiter.' + daten.seitenleiste.reiter) }}</div>
                    <WatchlistReiter v-if="daten.seitenleiste.reiter === 'watchlist'" :watchlists="watchlists"
                        :aktives-symbol="aktivesPanel.symbol" :aktiver-markt="aktivesPanel.markt"
                        @waehle="setzePanel({ symbol: $event.symbol, markt: $event.markt })" @aendere="watchlistAendern"
                        @neu="watchlistNeu" @loesche="watchlistLoeschen" />
                    <ObjektReiter v-else-if="daten.seitenleiste.reiter === 'objekte'" :symbol="aktivesPanel.symbol"
                        :zeichnungen="aktiveZeichnungen" :auswahl-id="aktiveAuswahl" @waehle="objektWaehlen"
                        @aendere="(z, patch) => zeichnungAendern(z.symbol, z.id, patch)"
                        @loesche="(z) => zeichnungLoeschen(z.symbol, z.id)" />
                    <StrategieReiter v-else-if="daten.seitenleiste.reiter === 'strategien'" :panel="aktivesPanel"
                        :daten="aktivesPanelRef?.strategieDaten" :vorschau="aktivesPanelRef?.strategieVorschau"
                        :backtest="aktivesPanelRef?.strategieBacktest" @filter="strategieFilter"
                        @vorschau="(v) => aktivesPanelRef?.setzeStrategieVorschau(v)"
                        @backtest="(b) => aktivesPanelRef?.setzeBacktest(b)" />
                    <AlarmReiter v-else-if="daten.seitenleiste.reiter === 'alarme'" :symbol="aktivesPanel.symbol"
                        :markt="aktivesPanel.markt" :kurs="aktuellerKurs" @neu="alarmBeiPreis" @bearbeite="alarmBearbeiten" />
                    <KiReiter v-else-if="daten.seitenleiste.reiter === 'ki'" :panel="aktivesPanel"
                        @vorschau="(a) => aktivesPanelRef?.setzeKiVorschau(a)" />
                    <!-- Lizenzhinweis der Chart-Bibliothek (Apache-2.0): Hersteller und Link
                         auf einer Seite der App — deshalb steht im Chart selbst kein Logo. -->
                    <a class="lizenz" href="https://www.tradingview.com/" target="_blank" rel="noopener">
                        Charts: TradingView Lightweight Charts™ · © TradingView, Inc.</a>
                </aside>
            </div>
        </template>
        <AlarmDialog v-if="alarmVorlage" :vorlage="alarmVorlage" @schliesse="alarmVorlage = null" />
        <IndikatorDialog v-if="dialog" :key="dialog.instanz?.id || 'neu'" :instanz="dialog.instanz"
            :aktive="daten.panels[dialog.panel]?.indikatoren || []" @hinzu="indikatorHinzu" @speichere="indikatorSpeichern"
            @bearbeite="(id) => indikatorAktion(dialog.panel, { aktion: 'bearbeiten', id })"
            @entferne="(id) => indikatorAktion(dialog.panel, { aktion: 'entfernen', id })"
            @umschalten="(id) => indikatorAktion(dialog.panel, { aktion: 'umschalten', id })"
            @schliesse="dialog = null" />
        <div v-else-if="!ladeFehler && !bereit" class="laden"><span class="spinner-border spinner-border-sm"></span></div>
    </div>
</template>

<style scoped>
.chartSeite {
    display: flex;
    flex-direction: column;
    height: calc(100dvh - 130px);
    min-height: 460px;
}

.arbeitsflaeche {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px;
}

.arbeitsflaeche.mitLeiste {
    grid-template-columns: auto 1fr var(--leisteBreite, 260px);
}

.raster {
    display: grid;
    gap: 6px;
    min-height: 0;
    min-width: 0;
}

.raster.r1 {
    grid-template: 1fr / 1fr;
}

.raster.r2h {
    grid-template: 1fr / 1fr 1fr;
}

.raster.r2v {
    grid-template: 1fr 1fr / 1fr;
}

.raster.r4 {
    grid-template: 1fr 1fr / 1fr 1fr;
}

.seitenleiste {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    border: 1px solid var(--white-10);
    border-radius: 6px;
    padding: 8px;
    background: var(--black-bg-7, #131722);
    position: relative;
    min-width: 0;
}

/* Griff zum Ziehen der Breite, über dem linken Rand. */
.leisteGriff {
    position: absolute;
    left: -6px;
    top: 0;
    bottom: 0;
    width: 10px;
    cursor: col-resize;
    z-index: 5;
    touch-action: none;
}

.leisteGriff::after {
    content: '';
    position: absolute;
    left: 4px;
    top: 50%;
    width: 2px;
    height: 36px;
    transform: translateY(-50%);
    border-radius: 2px;
    background: var(--white-18, rgba(255, 255, 255, 0.18));
    transition: background 0.15s, height 0.15s;
}

.leisteGriff:hover::after {
    background: var(--blue-color);
    height: 64px;
}

.reiter {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--white-10);
    padding-bottom: 6px;
}

.reiter button {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--grey-text);
    padding: 4px;
    border-radius: 4px;
}

.reiter button.an {
    color: var(--blue-color);
    background: rgba(1, 180, 255, 0.1);
}

.lizenz {
    margin-top: auto;
    font-size: 9px;
    color: var(--grey-text);
    opacity: 0.6;
    text-decoration: none;
}

.lizenz:hover {
    opacity: 1;
}

.reiterTitel {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--grey-text);
}

.laden {
    display: flex;
    justify-content: center;
    padding: 40px;
}

/* Telefon: ein Panel, Seitenleiste unter dem Chart statt daneben. */
.chartSeite.telefon {
    height: auto;
}

.chartSeite.telefon .arbeitsflaeche,
.chartSeite.telefon .arbeitsflaeche.mitLeiste {
    grid-template-columns: auto 1fr;
}

.chartSeite.telefon .seitenleiste {
    grid-column: 1 / -1;
}

.chartSeite.telefon .raster {
    height: 62dvh;
    min-height: 340px;
}

.chartSeite.telefon .seitenleiste {
    max-height: 50dvh;
}

.chartSeite.telefon .leisteGriff {
    display: none;
}

@media (max-width: 991px) {
    .arbeitsflaeche,
    .arbeitsflaeche.mitLeiste {
        grid-template-columns: auto 1fr;
    }

    .seitenleiste {
        grid-column: 1 / -1;
    }

    .leisteGriff {
        display: none;
    }

    .chartSeite {
        height: auto;
    }

    .raster {
        height: 62dvh;
        min-height: 340px;
    }
}
</style>
