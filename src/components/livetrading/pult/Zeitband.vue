<script setup>
/**
 * Zeitband — Handelssitzungen und Termine auf EINER Achse.
 *
 * Im Raster sind das zwei Kacheln: „Handelszeiten" beantwortet „welche Sitzung
 * läuft", „Termine" beantwortet „was kommt gleich". Nebeneinander gelesen muss
 * man die beiden Antworten im Kopf zusammenrechnen — und genau das ist die
 * Frage, die während einer Sitzung wirklich gestellt wird: *wie lange habe ich
 * noch Ruhe?* Auf einer gemeinsamen Achse steht sie direkt da: der Abstand
 * zwischen der Nadel und dem nächsten Strich IST die Antwort.
 *
 * Beide Datenquellen sind bereits vorhanden und werden nicht neu geholt:
 * `lageZu()` aus `shared/handelszeiten.js` rechnet lokal (dieselbe Rechnung wie
 * auf dem Server, deshalb liegt sie in `shared/`), die Termine kommen aus der
 * Kalender-Kachel des Rasters.
 *
 * ## Warum das Fenster hinten anfängt
 *
 * Eine Stunde Vergangenheit bleibt sichtbar. Wer um 14:35 auf das Band schaut,
 * will sehen, dass der Termin um 14:30 GERADE war — ein Band, das bei „jetzt"
 * beginnt, verschweigt die Ursache der Bewegung, die man vor sich hat.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from '../../../utils/dayjs-setup.js'
import { lageZu } from '../../../../shared/handelszeiten.js'

const props = defineProps({
    /** Nutzlast der Kalender-Kachel (`/api/livetrading/kalender-countdown`). */
    kalender: { type: Object, default: null },
    jetzt: { type: Number, required: true },
})

const { t } = useI18n()

const VOR_MS = 1 * 60 * 60 * 1000     // sichtbare Vergangenheit
const NACH_MS = 7 * 60 * 60 * 1000    // sichtbare Zukunft

const von = computed(() => props.jetzt - VOR_MS)
const bis = computed(() => props.jetzt + NACH_MS)

/** Zeitpunkt → Position auf der Achse in Prozent. */
const pos = (t) => ((t - von.value) / (bis.value - von.value)) * 100
const imFenster = (t) => t >= von.value && t <= bis.value

const ereignisse = computed(() => props.kalender?.ereignisse || [])

const lage = computed(() => lageZu(props.jetzt, {
    ereignisse: ereignisse.value,
    // Feiertage stecken im selben Bestand — `impact: 'holiday'`. Ohne Kalender
    // bleibt die Liste null, und `lageZu` behauptet dann bewusst nichts.
    feiertage: props.kalender ? ereignisse.value.filter(
        e => String(e.impact || '').toLowerCase() === 'holiday') : null,
}))

/**
 * Sitzungsblöcke, auf das Fenster zugeschnitten. Eine Sitzung, die vor dem
 * Fensteranfang begann, wird am Rand abgeschnitten statt weggelassen — sonst
 * verschwände ausgerechnet die gerade laufende.
 */
const bloecke = computed(() => lage.value.phasenHeute
    .filter(p => p.bis > von.value && p.von < bis.value)
    .map(p => ({
        id: p.id,
        aktiv: p.aktiv,
        links: Math.max(0, pos(p.von)),
        breite: Math.min(100, pos(p.bis)) - Math.max(0, pos(p.von)),
    }))
    .filter(p => p.breite > 0))

/** Termine als Striche. Nur was Wirkung hat — der Rest ist Rauschen. */
const striche = computed(() => ereignisse.value
    .filter(e => Number(e.dateUnix) && imFenster(Number(e.dateUnix)))
    .filter(e => ['high', 'medium'].includes(String(e.impact || '').toLowerCase()))
    .map(e => ({
        id: e.extId || `${e.titel}-${e.dateUnix}`,
        titel: e.titel,
        land: e.land,
        hoch: String(e.impact).toLowerCase() === 'high',
        vorbei: Number(e.dateUnix) < props.jetzt,
        links: pos(Number(e.dateUnix)),
        zeit: dayjs(Number(e.dateUnix)).format('HH:mm'),
    }))
    .sort((a, b) => a.links - b.links))

const jetztPos = computed(() => pos(props.jetzt))
const jetztText = computed(() => dayjs(props.jetzt).format('HH:mm'))

/** Volle Stunden als Skala — ohne sie ist das Band eine Fläche ohne Mass. */
const stunden = computed(() => {
    const out = []
    const erste = Math.ceil(von.value / 3600000) * 3600000
    for (let t = erste; t <= bis.value; t += 3600000) {
        out.push({ t, links: pos(t), text: dayjs(t).format('HH') })
    }
    return out
})

const name = (id) => t(`livetrading.handelszeiten.${id}`)
</script>

<template>
    <div class="zBand">
        <div class="zKopf">
            <div class="zTitel">{{ t('livetrading.pult.zeitband') }}</div>
            <div class="zSpanne">8 h</div>
        </div>

        <div class="zAchse">
            <!-- Stundenraster ganz hinten -->
            <div v-for="s in stunden" :key="s.t" class="zStunde" :style="{ left: s.links + '%' }">
                <span class="zStundeText">{{ s.text }}</span>
            </div>

            <!-- Sitzungen -->
            <div v-for="b in bloecke" :key="b.id" class="zBlock" :class="{ zAktiv: b.aktiv }"
                :style="{ left: b.links + '%', width: b.breite + '%' }">
                <span class="zBlockText">{{ name(b.id) }}</span>
            </div>

            <!-- Überlappung London/New York: die dichteste Stunde des Tages -->
            <div v-if="lage.ueberlappung" class="zUeberlappung">
                {{ t('livetrading.handelszeiten.ueberlappung') }}
            </div>

            <!-- Termine -->
            <div v-for="e in striche" :key="e.id" class="zTermin"
                :class="{ zHoch: e.hoch, zVorbei: e.vorbei }" :style="{ left: e.links + '%' }"
                :title="`${e.zeit} · ${e.land} · ${e.titel}`">
                <span class="zTerminText">{{ e.zeit }} {{ e.titel }}</span>
            </div>

            <!-- Nadel: das einzige Weiss auf dem Band -->
            <div class="zNadel" :style="{ left: jetztPos + '%' }">
                <span class="zNadelZeit">{{ jetztText }}</span>
            </div>
        </div>
    </div>
</template>

<style scoped>
.zBand {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--pTrenn);
}

.zKopf {
    flex: none;
    padding: 0.35rem 0.6rem;
    border-right: 1px solid var(--pTrenn);
    white-space: nowrap;
}

.zTitel {
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--white-38);
}

.zSpanne {
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    color: var(--white-60);
    margin-top: 0.1rem;
}

.zAchse {
    position: relative;
    flex: 1 1 auto;
    height: 58px;
    min-width: 0;
    overflow: hidden;
}

/* Stundenraster: so schwach wie möglich, es ist Mass und nicht Inhalt. */
.zStunde {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(255, 255, 255, 0.05);
}

.zStundeText {
    position: absolute;
    top: 1px;
    left: 3px;
    font-size: 0.6rem;
    font-variant-numeric: tabular-nums;
    color: var(--white-38);
}

/* Sitzungen als flache Bänder, die laufende in Akzentfarbe. */
.zBlock {
    position: absolute;
    top: 17px;
    height: 10px;
    background: rgba(255, 255, 255, 0.11);
}

.zBlock.zAktiv { background: rgba(1, 180, 255, 0.3); }

.zBlockText {
    position: absolute;
    top: 12px;
    left: 2px;
    font-size: 0.62rem;
    color: var(--white-38);
    white-space: nowrap;
}

.zBlock.zAktiv .zBlockText { color: var(--white-60); }

.zUeberlappung {
    position: absolute;
    top: 1px;
    right: 4px;
    font-size: 0.58rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--blue-color);
}

/*
 * Termine als Striche, nicht als Punkte: ein Termin ist ein Zeitpunkt, und ein
 * Strich zeigt den Zeitpunkt auf der Achse genauer an als jede Form mit Fläche.
 */
.zTermin {
    position: absolute;
    top: 11px;
    height: 22px;
    width: 2px;
    background: #e8a33d;
}

.zTermin.zHoch { background: #ff5f56; }
.zTermin.zVorbei { opacity: 0.3; }

.zTerminText {
    position: absolute;
    top: 24px;
    left: 4px;
    font-size: 0.62rem;
    font-variant-numeric: tabular-nums;
    color: #e8a33d;
    white-space: nowrap;
    max-width: 190px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.zTermin.zHoch .zTerminText { color: #ff5f56; }
.zTermin.zVorbei .zTerminText { color: var(--white-38); }

.zNadel {
    position: absolute;
    top: 6px;
    bottom: 4px;
    width: 1px;
    background: #fff;
    z-index: 3;
}

.zNadelZeit {
    position: absolute;
    top: -5px;
    left: -16px;
    font-size: 0.62rem;
    font-variant-numeric: tabular-nums;
    color: #fff;
}
</style>
