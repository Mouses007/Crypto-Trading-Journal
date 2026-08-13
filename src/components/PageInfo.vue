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
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
    /** Schlüsselpräfix, z.B. 'info.bookmap' */
    section: { type: String, required: true },
})

const { t, tm, rt } = useI18n()
const offen = ref(false)

/**
 * `tm` liefert die rohen Nachrichten-Knoten; `rt` macht daraus Text. Ohne
 * diesen Umweg bekäme man bei Arrays Objekte statt Zeichenketten.
 */
const abschnitte = computed(() => {
    const roh = tm(`${props.section}.sections`)
    if (!Array.isArray(roh)) return []
    return roh.map(a => ({ h: rt(a.h), p: rt(a.p) }))
})

function schliessenBeiEsc(e) {
    if (e.key === 'Escape') offen.value = false
}
</script>

<template>
    <button type="button" class="ctl-pill infoBtn" :title="t('info.buttonTitle')"
        @click="offen = true">
        <i class="uil uil-info-circle"></i>{{ t('info.button') }}
    </button>

    <Teleport to="body">
        <div v-if="offen" class="infoOverlay" tabindex="0"
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

                <div v-for="(a, i) in abschnitte" :key="i" class="infoSection">
                    <div class="infoSectionTitle">{{ a.h }}</div>
                    <p>{{ a.p }}</p>
                </div>

                <p class="infoCaveat">{{ t(`${section}.caveat`) }}</p>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.infoBtn {
    gap: 0.25rem;
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
    padding: 1.1rem 1.3rem 1.3rem;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
}

.infoHead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
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
