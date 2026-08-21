<script setup>
/**
 * Start-, Lauf- und Beenden-Leiste des Live-Trading-Fensters.
 *
 * Drei Zustände, absichtlich streng getrennt:
 *
 *   1. **Vorher** — der Plan wird gefasst. Höchstverlust und Höchstzahl an
 *      Trades stehen hier, weil sie *jetzt* eingetragen werden müssen, solange
 *      man ruhig ist. Wer sie mitten in der Sitzung setzen darf, setzt sie an
 *      den bereits eingetretenen Verlust an — dann sind sie wertlos.
 *   2. **Läuft** — Uhr, Plan zum Nachlesen, Notizfeld.
 *   3. **Beenden** — Fazit eintippen, dann wird ausgewertet.
 *
 * Der Plan bleibt während der Sitzung sichtbar, aber nicht änderbar. Das ist
 * der ganze Punkt an einem Plan.
 *
 * Ein- und ausklappbar, weil die Leiste dem Raster Platz wegnimmt: eingeklappt
 * bleibt die **Kopfzeile** stehen (Uhr, Plan, Beenden) und nur das Ausführliche
 * verschwindet — Notizfeld und Vorsatz. Die Uhr zu verstecken wäre falsch: dass
 * mitgezählt wird, ist der Sinn der Leiste. Der Zustand liegt in `localStorage`,
 * damit das eigene Fenster ihn beim Sitzungsstart mit übernimmt.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import dayjs from '../../utils/dayjs-setup.js'
import { oeffneLivetradingFenster } from '../../utils/livetradingFenster.js'
import { liveSymbol, liveMarket } from '../../stores/live.js'
import {
    aktiveSitzung, sitzungFehler, laufzeitText,
    starteSitzung, beendeSitzung, brichAb, ladeLaufende,
    setzeNotizen, speichereJetzt,
} from '../../stores/livetrading.js'

const { t } = useI18n()
const route = useRoute()

/** Läuft die Seite schon im eigenen Fenster? Dann kein zweites öffnen. */
const istCockpit = computed(() => String(route.query?.cockpit || '') === '1')

const planMaxVerlust = ref('')
const planMaxTrades = ref('')
const planNotiz = ref('')
const fazit = ref('')
const beendenOffen = ref(false)
const beschaeftigt = ref(false)
/** Ergebnis der zuletzt beendeten Sitzung — bleibt stehen, bis man es wegklickt. */
const letzteBilanz = ref(null)

const laeuft = computed(() => !!aktiveSitzung.value)

// ── Ein-/Ausklappen ─────────────────────────────────────────────────────
const SPEICHER = 'livetrading_sitzung_zu'
const zu = ref((() => {
    try { return localStorage.getItem(SPEICHER) === '1' } catch { return false }
})())

function klappe(wert) {
    zu.value = typeof wert === 'boolean' ? wert : !zu.value
    try { localStorage.setItem(SPEICHER, zu.value ? '1' : '0') } catch { /* egal */ }
}

const planText = computed(() => {
    const s = aktiveSitzung.value
    if (!s) return ''
    const teile = []
    if (Number(s.planMaxVerlustUsd) > 0) teile.push(`max. −${Number(s.planMaxVerlustUsd).toFixed(0)} $`)
    if (Number(s.planMaxTrades) > 0) teile.push(`max. ${s.planMaxTrades} Trades`)
    return teile.join(' · ')
})

/**
 * Sitzung starten — und dabei ins eigene Fenster wechseln.
 *
 * Läuft die Seite noch im Journal-Tab, öffnet der Start ein eigenes Fenster im
 * Cockpit-Zustand (ohne Menü, ohne Navigation). Der Grund ist derselbe wie beim
 * Plan: während einer Sitzung soll nichts anderes in Reichweite liegen. Sind
 * wir schon im Cockpit, bleibt alles, wo es ist.
 *
 * Wichtig für die Reihenfolge: die Sitzung wird ZUERST angelegt und erst dann
 * das Fenster geöffnet. Das neue Fenster findet die laufende Sitzung dann über
 * `ladeLaufende()` von selbst — und ein Popup-Blocker kostet höchstens das
 * Fenster, nie die Sitzung.
 */
async function starten() {
    beschaeftigt.value = true
    letzteBilanz.value = null
    await starteSitzung({
        symbol: liveSymbol.value,
        market: liveMarket.value,
        planMaxVerlustUsd: Number(planMaxVerlust.value) || 0,
        planMaxTrades: Number(planMaxTrades.value) || 0,
        planNotiz: planNotiz.value,
        kacheln: leseLayout(),
    })
    beschaeftigt.value = false
    if (!istCockpit.value) oeffneLivetradingFenster()
}

/**
 * Beenden: speichern, Bilanz zeigen — und im eigenen Fenster zumachen.
 *
 * Die Reihenfolge ist Absicht. Sofort zu schliessen verschluckt das Ergebnis;
 * zwei Sekunden reichen, um „+42,50 $ · Plan eingehalten" zu lesen, bevor das
 * Fenster geht. Geschlossen wird nur nach ERFOLGREICHEM Speichern — sonst wäre
 * die Sitzung weg und man wüsste nicht, dass sie nie ankam.
 *
 * `window.close()` wirkt nur bei Fenstern, die ein Skript geöffnet hat; unseres
 * ist so eines. Klappt es doch nicht (direkt aufgerufener Tab), bleibt die
 * Bilanz einfach stehen. Dafür gibt es bewusst keine Fehlermeldung: ein nicht
 * geschlossenes Fenster ist kein Fehler.
 */
async function beenden() {
    beschaeftigt.value = true
    const fertig = await beendeSitzung(fazit.value)
    beschaeftigt.value = false
    beendenOffen.value = false
    fazit.value = ''
    if (!fertig) return
    letzteBilanz.value = fertig
    if (istCockpit.value) {
        setTimeout(() => { try { window.close() } catch { /* egal */ } }, 2000)
    }
}

/** Das Fazit-Feld gehört zum Ausführlichen — wer beenden will, sieht es. */
function beendenUmschalten() {
    beendenOffen.value = !beendenOffen.value
    if (beendenOffen.value) klappe(false)
}

async function abbrechen() {
    beschaeftigt.value = true
    await brichAb()
    beschaeftigt.value = false
    beendenOffen.value = false
}

/** Layout-Schnappschuss: womit man in der Sitzung tatsächlich gearbeitet hat. */
function leseLayout() {
    try {
        return {
            versteckt: JSON.parse(localStorage.getItem('livetrading_hidden_cards') || '[]'),
            reihenfolge: JSON.parse(localStorage.getItem('livetrading_hidden_cards_order') || '[]'),
            groessen: JSON.parse(localStorage.getItem('livetrading_hidden_cards_size') || '{}'),
        }
    } catch {
        return {}
    }
}

const geld = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} $`

onMounted(ladeLaufende)
// Was noch im Puffer liegt, beim Verlassen der Seite wegschreiben
onBeforeUnmount(speichereJetzt)
</script>

<template>
    <div class="stLeiste">
        <!-- ── 1. Vorher: der Plan ── -->
        <template v-if="!laeuft">
            <div class="stZeile">
                <span class="stTitel">{{ t('livetrading.sitzung.neu') }}</span>
                <span class="stLuecke"></span>
                <button type="button" class="stKlapp" :title="t(zu ? 'livetrading.sitzung.ausklappen' : 'livetrading.sitzung.einklappen')"
                    @click="klappe()">
                    <i class="uil" :class="zu ? 'uil-angle-down' : 'uil-angle-up'"></i>
                </button>
            </div>
            <div v-if="!zu" class="stZeile stPlan">
                <label class="stFeld">
                    <span>{{ t('livetrading.sitzung.maxVerlust') }}</span>
                    <input v-model="planMaxVerlust" type="number" min="0" step="10" class="stInput" placeholder="200" />
                </label>
                <label class="stFeld">
                    <span>{{ t('livetrading.sitzung.maxTrades') }}</span>
                    <input v-model="planMaxTrades" type="number" min="0" step="1" class="stInput stInputSchmal" placeholder="5" />
                </label>
                <label class="stFeld stFeldBreit">
                    <span>{{ t('livetrading.sitzung.planNotiz') }}</span>
                    <input v-model="planNotiz" type="text" class="stInput"
                        :placeholder="t('livetrading.sitzung.planNotizHint')" />
                </label>
                <button type="button" class="ctl-pill stStart" :disabled="beschaeftigt" @click="starten">
                    <i class="uil uil-play"></i>{{ t('livetrading.sitzung.starten') }}
                </button>
            </div>
        </template>

        <!-- ── 2. Läuft ── -->
        <template v-else>
            <div class="stZeile">
                <span class="stPunkt"></span>
                <span class="stUhr">{{ laufzeitText }}</span>
                <!-- Kein Symbol mehr: eine Sitzung ist ein ZEITRAUM, kein Markt.
                     Welche Münze gerade auf den Kacheln liegt, steht mittig in
                     der Kopfzeile und darf während der Sitzung wechseln —
                     jeder Wechsel landet im Protokoll. -->
                <span v-if="planText" class="stPlanText">{{ planText }}</span>
                <span class="stSeit">{{ t('livetrading.sitzung.seit', { zeit: dayjs(Number(aktiveSitzung.startUnix)).format('HH:mm') }) }}</span>
                <span class="stLuecke"></span>
                <button type="button" class="ctl-pill" :disabled="beschaeftigt" @click="beendenUmschalten">
                    <i class="uil uil-square"></i>{{ t('livetrading.sitzung.beenden') }}
                </button>
                <button type="button" class="stKlapp" :title="t(zu ? 'livetrading.sitzung.ausklappen' : 'livetrading.sitzung.einklappen')"
                    @click="klappe()">
                    <i class="uil" :class="zu ? 'uil-angle-down' : 'uil-angle-up'"></i>
                </button>
            </div>

            <div v-if="aktiveSitzung.planNotiz && !zu" class="stPlanNotiz">
                <i class="uil uil-notes"></i>{{ aktiveSitzung.planNotiz }}
            </div>

            <textarea v-if="!zu" class="stNotizen" :value="aktiveSitzung.notizen"
                :placeholder="t('livetrading.sitzung.notizenHint')"
                @input="setzeNotizen($event.target.value)"></textarea>

            <!-- Beenden: Fazit vor der Auswertung, nicht danach -->
            <div v-if="beendenOffen" class="stBeenden">
                <input v-model="fazit" type="text" class="stInput"
                    :placeholder="t('livetrading.sitzung.fazitHint')" />
                <button type="button" class="ctl-pill stStart" :disabled="beschaeftigt" @click="beenden">
                    {{ t('livetrading.sitzung.auswerten') }}
                </button>
                <button type="button" class="ctl-pill stAbbruch" :disabled="beschaeftigt" @click="abbrechen">
                    {{ t('livetrading.sitzung.verwerfen') }}
                </button>
            </div>
        </template>

        <!-- ── 3. Bilanz der letzten Sitzung ── -->
        <div v-if="letzteBilanz" class="stBilanz" :class="{ verletzt: letzteBilanz.planVerletzt }">
            <span class="stBilanzPnl" :class="letzteBilanz.pnlUsd >= 0 ? 'greenTrade' : 'redTrade'">
                {{ geld(letzteBilanz.pnlUsd) }}
            </span>
            <span>{{ t('livetrading.sitzung.bilanzTrades', { n: letzteBilanz.tradeAnzahl }) }}</span>
            <span v-if="letzteBilanz.planVerletzt" class="stBilanzWarn">
                {{ t('livetrading.sitzung.planVerletzt') }}
            </span>
            <span v-else-if="Number(letzteBilanz.planMaxVerlustUsd) || Number(letzteBilanz.planMaxTrades)">
                {{ t('livetrading.sitzung.planGehalten') }}
            </span>
            <span class="stLuecke"></span>
            <button type="button" class="radarCardBtn" @click="letzteBilanz = null">
                <i class="uil uil-times"></i>
            </button>
        </div>

        <div v-if="sitzungFehler" class="stFehler">{{ sitzungFehler }}</div>
    </div>
</template>

<style scoped>
.stLeiste {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem 0.7rem;
    margin-bottom: 0.7rem;
    background: var(--black-bg-soft, rgba(255, 255, 255, 0.03));
    border-radius: var(--border-radius);
}

.stZeile {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
}

.stLuecke { flex: 1; }

.stTitel {
    font-weight: 600;
    color: var(--white-87);
}

.stSymbol {
    font-weight: 600;
    color: var(--blue-color, #01B4FF);
}

.stUhr {
    font-variant-numeric: tabular-nums;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--white-87);
}

/* Ein laufender Punkt, damit man auf einen Blick sieht, dass mitgezählt wird */
.stPunkt {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #4ec9a0;
    animation: stPuls 2s ease-in-out infinite;
}

@keyframes stPuls {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
}

.stPlanText {
    font-size: 0.8rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--white-60);
}

.stSeit, .stPlan span {
    font-size: 0.78rem;
    color: var(--white-60);
}

.stFeld {
    display: flex;
    align-items: center;
    gap: 0.35rem;
}

.stFeldBreit { flex: 1; min-width: 12rem; }

.stInput {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: var(--border-radius);
    color: var(--white-87);
    padding: 0.2rem 0.45rem;
    font-size: 0.85rem;
    width: 100%;
    min-width: 5rem;
}

.stInputSchmal { max-width: 5rem; }

.stStart { background: rgba(78, 201, 160, 0.18); color: #4ec9a0; }
.stAbbruch { color: #ff6b7a; }

.stPlanNotiz {
    font-size: 0.82rem;
    color: var(--white-60);
    display: flex;
    gap: 0.35rem;
    align-items: center;
}

.stNotizen {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--border-radius);
    color: var(--white-87);
    padding: 0.35rem 0.5rem;
    font-size: 0.85rem;
    resize: vertical;
    min-height: 2.4rem;
}

.stBeenden {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
}

.stBilanz {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.85rem;
    padding: 0.35rem 0.5rem;
    border-radius: var(--border-radius);
    background: rgba(255, 255, 255, 0.05);
}

.stBilanz.verletzt { background: rgba(220, 53, 69, 0.14); }

.stBilanzPnl {
    font-size: 1.05rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
}

.stBilanzWarn { color: #ff6b7a; font-weight: 600; }

/* Der Umschalter sitzt in der Kopfzeile und soll dort nicht mitreden:
   gleiche Höhe wie die Pillen, aber ohne Fläche. */
.stKlapp {
    background: none;
    border: none;
    color: var(--white-60);
    padding: 0 0.2rem;
    line-height: 1;
    font-size: 1.1rem;
    cursor: pointer;
}

.stKlapp:hover { color: var(--white-87); }

.stFehler {
    font-size: 0.8rem;
    color: #ff6b7a;
}
</style>
