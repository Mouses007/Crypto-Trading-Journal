<script setup>
/**
 * Kleines „i" mit Erklärung bei Mouseover (am Telefon: beim Antippen).
 *
 * DIE Art, ab jetzt eine Erklärung an ein einzelnes Element zu hängen.
 * Abgrenzung, damit die beiden Sorten Text nicht durcheinandergeraten:
 *
 *   `title=` sagt, was das Bedienelement IST („Neu laden", „Schliessen").
 *   `InfoTipp` sagt, was die Zahl BEDEUTET.
 *
 * Deshalb bleiben die vorhandenen `title=`-Attribute an nackten Icon-Knöpfen
 * bestehen: sie sind der einzige Name dieser Knöpfe und müssen auch dann noch
 * da sein, wenn jemand die erweiterten Infos abschaltet.
 *
 * BEWUSST OHNE BOOTSTRAP-TOOLTIP. Vier Gründe, der Reihe nach:
 *   1. Bootstrap-Tooltips sind imperative Instanzen. Ein `v-if` auf dem
 *      Element liesse sie verwaist zurück; jede der ~100 Stellen bräuchte
 *      `dispose()` beim Ausblenden und `new` beim Einblenden.
 *   2. `useInitTooltip()` (utils.js) ist nicht idempotent — anders als
 *      `useInitPopover()` prüft es kein `getInstance()`. Jeder Aufruf stapelt
 *      eine weitere Instanz auf dieselben Elemente. Da wollen wir nicht rein.
 *   3. Bootstrap kommt vom CDN. Ohne Netz ist `window.bootstrap` undefined —
 *      Hilfetexte, die ausgerechnet offline verschwinden, sind die falsche
 *      Ausfallart für eine App, die lokal laufen soll.
 *   4. `data-bs-html="true"` schiebt übersetzten Text durch `innerHTML`.
 *      Hier gibt es diesen Pfad gar nicht: `white-space: pre-line` macht aus
 *      einem `\n` in der Übersetzung einen Umbruch, ganz ohne HTML.
 *
 * Positionierung ohne Popper: Teleport an den Körper und feste Position aus
 * `getBoundingClientRect()`. Nötig, weil Kachelköpfe und Einstellungszeilen
 * ihren Überlauf abschneiden — dasselbe Muster und derselbe Grund wie bei
 * `PageInfo.vue` und `RadarOverlay.vue`.
 *
 * Schlüssel-Konvention für die Texte:
 *   - Element hat schon einen Beschriftungsschlüssel `X` → Erklärung `XInfo`.
 *   - Sonst `<seitennamensraum>.info.<element>`.
 * Bestehende Schlüssel werden NICHT umbenannt; `schluessel` wird explizit
 * übergeben, alte Namen wie `dashboard.cumulativePnlTooltip` bleiben gültig.
 */
import { ref, computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { erweiterteInfos } from '../composables/useErweiterteInfos.js'
import { useIstTelefon } from '../utils/geraet.js'
import { ebeneAuf, ebeneZu } from '../composables/useZurueckGeste.js'

const props = defineProps({
    /** i18n-Schlüssel des Erklärtexts. */
    schluessel: { type: String, default: '' },
    /** Literaltext — Notausgang für berechnete Prosa. Schlägt `schluessel`. */
    text: { type: String, default: '' },
    /** 'auto' | 'oben' | 'unten' */
    platz: { type: String, default: 'auto' },
    /** Breitere Box für längere Erklärungen. */
    breit: { type: Boolean, default: false },
})

const { t, te } = useI18n()
const istTelefon = useIstTelefon()

const ausloeser = ref(null)
const offen = ref(false)
const pos = ref({ top: 0, left: 0, kippt: false })
let oeffnenTimer = null

/*
 * `te()` vor `t()` ist Pflicht, nicht Vorsicht: `t()` gibt bei fehlendem
 * Schlüssel den Schlüssel selbst zurück, und `missingWarn: false` in
 * `src/i18n/index.js` verschluckt jede Warnung. Genau so stand jahrelang
 * „info.coinRadar.caveat" wörtlich in der Oberfläche. Fehlt der Text, kommt
 * hier gar kein Symbol — dann darf Markup auch vor seiner Übersetzung
 * existieren, ohne dass jemand einen nackten Schlüssel zu sehen bekommt.
 */
const inhalt = computed(() => {
    if (props.text) return props.text
    if (!props.schluessel) return ''
    return te(props.schluessel) ? t(props.schluessel) : ''
})

const zeigen = computed(() => erweiterteInfos.value && !!inhalt.value)

const BREITE = 300
const BREITE_GROSS = 460

function messen() {
    const el = ausloeser.value
    if (!el) return
    const r = el.getBoundingClientRect()
    const breite = props.breit ? BREITE_GROSS : BREITE
    // Waagerecht mittig über dem Symbol, aber in den Bildschirm geklemmt —
    // sonst hängt die Box an einer Kachel ganz rechts zur Hälfte draussen.
    let left = r.left + r.width / 2 - breite / 2
    left = Math.max(8, Math.min(left, window.innerWidth - breite - 8))
    // Nach unten kippen, wenn oben kein Platz ist. 200 px ist die Höhe, die
    // eine mehrzeilige Erklärung typischerweise braucht.
    const kippt = props.platz === 'unten' || (props.platz !== 'oben' && r.top < 200)
    pos.value = { top: kippt ? r.bottom + 8 : r.top - 8, left, kippt }
}

function auf() {
    if (!zeigen.value) return
    messen()
    offen.value = true
    // Eine feste Position, die beim Öffnen berechnet wurde, wandert mit, wenn
    // darunter gescrollt wird. Bei einer Box, die Sekunden lebt, ist
    // Schliessen die ehrlichere Antwort als Nachrechnen.
    window.addEventListener('scroll', zu, true)
    window.addEventListener('resize', zu)
    if (istTelefon.value) {
        document.addEventListener('click', zu, { once: true })
        ebeneAuf(zu)   // Android-Zurück schliesst die Box, statt die Seite zu verlassen
    }
}

function zu() {
    if (!offen.value) return
    offen.value = false
    window.removeEventListener('scroll', zu, true)
    window.removeEventListener('resize', zu)
    if (istTelefon.value) ebeneZu(zu)
}

function betreten() {
    if (istTelefon.value) return
    // Kurze Verzögerung: sonst blitzt die Box auf, wenn der Zeiger das Symbol
    // nur überquert, um woandershin zu kommen.
    clearTimeout(oeffnenTimer)
    oeffnenTimer = setTimeout(auf, 120)
}

function verlassen() {
    clearTimeout(oeffnenTimer)
    zu()
}

function tippen() {
    if (!istTelefon.value) return
    if (offen.value) zu()
    // Der `once`-Zuhörer aus auf() würde denselben Klick gleich wieder
    // schlucken; deshalb erst im nächsten Takt öffnen.
    else setTimeout(auf, 0)
}

onBeforeUnmount(() => {
    clearTimeout(oeffnenTimer)
    zu()
})
</script>

<template>
    <span v-if="zeigen" ref="ausloeser" class="infoTipp" tabindex="0" role="note"
        @mouseenter="betreten" @mouseleave="verlassen" @focus="auf" @blur="zu"
        @click.stop="tippen" @keydown.esc="zu">
        <i class="uil uil-info-circle"></i>

        <Teleport to="body">
            <span v-if="offen" class="infoTippBox" :class="{ 'infoTippBox--breit': breit, 'infoTippBox--unten': pos.kippt }"
                :style="{ top: pos.top + 'px', left: pos.left + 'px' }">{{ inhalt }}</span>
        </Teleport>
    </span>
</template>

<style scoped>
/* Neutral, nicht bernstein: Bernstein heisst in dieser App „lies das, bevor du
   dich darauf verlässt" (Info-Tafel, Beta-Marke). Hundert bernsteinfarbene
   Symbole würden dieses Signal ersäufen. */
.infoTipp {
    display: inline-flex;
    align-items: center;
    color: var(--white-38, rgba(255, 255, 255, 0.38));
    font-size: 0.85rem;
    line-height: 1;
    cursor: help;
    outline: none;
    flex: 0 0 auto;
}

.infoTipp:hover,
.infoTipp:focus-visible {
    color: var(--blue-color, #4a9eff);
}

.infoTipp:focus-visible {
    box-shadow: 0 0 0 2px var(--blue-color, #4a9eff);
    border-radius: 50%;
}
</style>

<style>
/* Nicht scoped: die Box hängt per Teleport am Körper und läge sonst ausserhalb
   der Reichweite der Attributauswahl. */
.infoTippBox {
    position: fixed;
    z-index: 2100;
    width: 300px;
    max-width: calc(100vw - 16px);
    transform: translateY(-100%);
    background: var(--black-bg-12, #1f1f1f);
    border: 1px solid var(--white-18, rgba(255, 255, 255, 0.18));
    border-radius: var(--border-radius, 6px);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
    padding: 0.6rem 0.75rem;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    font-size: 0.8rem;
    font-weight: 400;
    line-height: 1.45;
    /* Ein `\n` in der Übersetzung wird zum Umbruch — kein HTML im Spiel. */
    white-space: pre-line;
    pointer-events: none;
}

.infoTippBox--breit {
    width: 460px;
}

/* Nach unten gekippt: dann keine Verschiebung um die eigene Höhe. */
.infoTippBox--unten {
    transform: none;
}
</style>
