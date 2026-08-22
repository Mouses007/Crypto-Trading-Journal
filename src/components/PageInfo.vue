<script setup>
/**
 * Erklärtafel für die Live-Ansichten.
 *
 * Bewusst als Überlagerung und nicht als Dauertext neben dem Chart: die
 * Erklärung braucht man beim Einarbeiten und dann selten wieder — ständig
 * sichtbar würde sie nur Platz kosten, den die Darstellung besser gebrauchen
 * kann.
 *
 * Die Abschnitte kommen als Übersetzungs-Array (`tm`), damit der Text nicht
 * im Markup klebt und beide Sprachen dieselbe Struktur teilen.
 */
import { ref, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
    /** Schlüsselpräfix, z.B. 'info.bookmap' */
    section: { type: String, required: true },
})

const { t, tm, rt, te } = useI18n()
const offen = ref(false)
const overlayEl = ref(null)

/**
 * Ohne den Fokus läuft die Escape-Taste ins Leere — der Tastendruck landet
 * beim Body und nicht bei der Überlagerung. Gleicher Kniff wie in
 * `RadarOverlay.vue`.
 */
async function oeffnen() {
    offen.value = true
    await nextTick()
    overlayEl.value?.focus()
}

/**
 * `tm` liefert die rohen Nachrichten-Knoten; `rt` macht daraus Text. Ohne
 * diesen Umweg bekäme man bei Arrays Objekte statt Zeichenketten.
 *
 * Optionales `g` setzt vor den Abschnitt eine Gruppenüberschrift. Nötig, seit
 * die längeren Tafeln (Marktradar, Nachrichten) zwanzig Abschnitte haben —
 * ohne Zwischenüberschriften scrollt man durch eine Wand aus Absätzen.
 */
const abschnitte = computed(() => {
    const roh = tm(`${props.section}.sections`)
    if (!Array.isArray(roh)) return []
    return roh.map(a => ({ g: a.g ? rt(a.g) : '', h: rt(a.h), p: rt(a.p) }))
})

function schliessenBeiEsc(e) {
    if (e.key === 'Escape') offen.value = false
}
</script>

<template>
    <button type="button" class="ctl-pill infoBtn" :title="t('info.buttonTitle')"
        @click="oeffnen">
        <i class="uil uil-info-circle"></i>{{ t('info.button') }}
    </button>

    <Teleport to="body">
        <div v-if="offen" ref="overlayEl" class="infoOverlay" tabindex="0"
            @click.self="offen = false" @keydown="schliessenBeiEsc">
            <div class="infoBox">
                <div class="infoHead">
                    <h5>{{ t(`${section}.title`) }}</h5>
                    <button type="button" class="infoClose" :title="t('common.close')"
                        @click="offen = false">
                        <i class="uil uil-times"></i>
                    </button>
                </div>

                <p class="infoIntro">{{ t(`${section}.intro`) }}</p>

                <template v-for="(a, i) in abschnitte" :key="i">
                    <div v-if="a.g" class="infoGroup">{{ a.g }}</div>
                    <div class="infoSection">
                        <div class="infoSectionTitle">{{ a.h }}</div>
                        <p>{{ a.p }}</p>
                    </div>
                </template>

                <p v-if="te(`${section}.caveat`)" class="infoCaveat">{{ t(`${section}.caveat`) }}</p>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
/* Bernstein wie die Beta-Kennzeichnung: der Info-Knopf gehört zur selben
   Familie „lies das, bevor du dich verlässt" — überall, auch in der
   Live-Analyse. Doppelte Klasse, damit die Regel die globale Pill schlägt. */
.ctl-pill.infoBtn {
    gap: 0.25rem;
    background: rgba(240, 196, 25, 0.12);
    border: 1px solid rgba(240, 196, 25, 0.45);
    color: rgba(240, 196, 25, 0.95);
}

.ctl-pill.infoBtn:hover {
    background: rgba(240, 196, 25, 0.22);
    border-color: rgba(240, 196, 25, 0.7);
    color: rgb(240, 196, 25);
}

.infoOverlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    outline: none;
}

.infoBox {
    background: var(--black-bg-2, #14141f);
    border: 1px solid var(--white-18, rgba(255, 255, 255, 0.18));
    border-radius: var(--border-radius, 6px);
    max-width: 46rem;
    width: 100%;
    max-height: 84vh;
    overflow-y: auto;
    /* Oben kein Polster: das übernimmt der mitlaufende Kopf, sonst scrollt
       Text durch den Spalt über ihm hindurch. */
    padding: 0 1.3rem 1.3rem;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
}

/* Bleibt beim Scrollen stehen — die längeren Tafeln sind mehrere Bildschirme
   hoch, ohne das wäre der Schliessen-Knopf nach dem ersten Absatz weg. */
.infoHead {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--black-bg-2, #14141f);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.1rem 0 0.5rem;
}

.infoHead h5 {
    margin: 0;
    color: var(--white-87, rgba(255, 255, 255, 0.87));
    font-weight: 600;
}

.infoClose {
    background: none;
    border: none;
    color: var(--white-60, rgba(255, 255, 255, 0.6));
    font-size: 1.15rem;
    cursor: pointer;
    line-height: 1;
}

.infoClose:hover {
    color: var(--white-87, rgba(255, 255, 255, 0.87));
}

.infoIntro {
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    font-size: 0.9rem;
    margin-bottom: 1rem;
}

.infoSection {
    margin-bottom: 0.9rem;
}

/* Gruppenüberschrift: trennt Bedienung, Inhalt und Praxis voneinander. Linie
   statt Kasten — die Tafel soll ruhig bleiben, nicht gegliedert wirken wie
   ein Formular. */
.infoGroup {
    margin: 1.4rem 0 0.8rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--white-12, rgba(255, 255, 255, 0.12));
    color: var(--white-50, rgba(255, 255, 255, 0.5));
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
}

.infoGroup:first-of-type {
    margin-top: 0.2rem;
    padding-top: 0;
    border-top: none;
}

.infoSectionTitle {
    color: var(--blue-color, #01B4FF);
    font-size: 0.82rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    margin-bottom: 0.15rem;
}

.infoSection p {
    margin: 0;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    font-size: 0.86rem;
    line-height: 1.5;
}

.infoCaveat {
    margin: 1rem 0 0;
    padding: 0.6rem 0.75rem;
    border-radius: var(--border-radius, 6px);
    background: rgba(250, 190, 60, 0.08);
    border: 1px solid rgba(250, 190, 60, 0.35);
    color: rgb(250, 190, 60);
    font-size: 0.82rem;
    line-height: 1.5;
}
</style>
