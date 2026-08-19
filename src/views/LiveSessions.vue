<script setup>
/**
 * Handelssitzungen — was aus den Vorsätzen geworden ist.
 *
 * Die Gegenseite zum Live-Trading-Fenster: dort fasst man den Plan, hier liest
 * man nach, ob er gehalten hat. Deshalb steht die Seite im Journal und nicht im
 * Live-Modus — sie gehört zum Reflektieren, nicht zum Handeln.
 *
 * Die wichtigste Spalte ist nicht die P&L, sondern **Plan eingehalten**. Eine
 * gewonnene Sitzung, in der der Höchstverlust gerissen wurde, ist kein Erfolg,
 * sondern Glück; und eine verlorene, die sich an die Grenzen gehalten hat, war
 * gute Arbeit. Genau diesen Unterschied macht das Journal sonst nirgends
 * sichtbar.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import PageInfo from '../components/PageInfo.vue'
import dayjs from '../utils/dayjs-setup.js'
import { dbFind, dbUpdate, dbDelete } from '../utils/db.js'

const { t } = useI18n()

const sitzungen = ref([])
const laedt = ref(true)
const fehler = ref('')
const offenesProtokoll = ref(null)
/**
 * Archiv. Nach ein paar Wochen findet man die letzten fünf Sitzungen nicht mehr,
 * löschen will man sie aber nicht: die Bilanz über die Disziplin lebt davon,
 * dass alle drinstehen. Deshalb aus der Liste räumen statt wegwerfen —
 * archivierte Sitzungen zählen weiter mit.
 */
const archivZeigen = ref(false)
/** Zwei-Klick-Löschen wie im Nachrichtenarchiv: erst fragen, dann löschen. */
const loeschFrage = ref(null)

async function lade() {
    laedt.value = true
    fehler.value = ''
    try {
        sitzungen.value = await dbFind('live_sessions', { descending: 'startUnix', limit: 200 })
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    } finally {
        laedt.value = false
    }
}

/**
 * Vergessene Sitzung schliessen.
 *
 * Läuft eine Sitzung noch, weil der Browser gewechselt wurde, sind ihre Zahlen
 * ohnehin wertlos — deshalb wird sie als `abgebrochen` geschlossen und nicht
 * ausgewertet. Ohne diesen Knopf blockierte sie für immer den Start einer neuen.
 */
async function schliesseVergessene(s) {
    try {
        await dbUpdate('live_sessions', s.objectId, {
            endUnix: Date.now(), status: 'abgebrochen',
        })
        await lade()
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    }
}

async function archivieren(s, wert) {
    try {
        await dbUpdate('live_sessions', s.objectId, { archiviert: wert ? 1 : 0 })
        // Nur im Speicher nachziehen statt neu zu laden: sonst springt die Liste
        // unter dem Finger weg.
        s.archiviert = wert ? 1 : 0
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    }
}

async function loesche(s) {
    if (loeschFrage.value !== s.objectId) { loeschFrage.value = s.objectId; return }
    try {
        await dbDelete('live_sessions', s.objectId)
        loeschFrage.value = null
        await lade()
    } catch (e) {
        fehler.value = e.response?.data?.error || e.message
    }
}

const dauerText = (s) => {
    const ende = Number(s.endUnix) || Date.now()
    const min = Math.max(0, Math.round((ende - Number(s.startUnix)) / 60000))
    const h = Math.floor(min / 60)
    return h > 0 ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`
}

const geld = (v) => `${Number(v) >= 0 ? '+' : '−'}${Math.abs(Number(v) || 0).toFixed(2)} $`
const farbe = (v) => (Number(v) || 0) >= 0 ? 'greenTrade' : 'redTrade'

const hatPlan = (s) => Number(s.planMaxVerlustUsd) > 0 || Number(s.planMaxTrades) > 0

// Der Plan als Text. Beträge bleiben in Dollar — das Journal rechnet
// durchgehend in USDT —, aber „Trades" ist Sprache und gehört übersetzt.
const planText = (s) => {
    const teile = []
    if (Number(s.planMaxVerlustUsd) > 0) {
        teile.push(t('liveSessions.planMaxVerlust', { betrag: `${Number(s.planMaxVerlustUsd).toFixed(0)} $` }))
    }
    if (Number(s.planMaxTrades) > 0) {
        teile.push(t('liveSessions.planMaxTrades', { anzahl: s.planMaxTrades }))
    }
    return teile.join(' · ')
}

const istArchiviert = (s) => Number(s.archiviert) === 1

/**
 * Alle Münzen, die in der Sitzung auf dem Schirm lagen.
 *
 * Eine Sitzung ist ein Zeitraum, kein Markt: `symbol` trägt nur die zuletzt
 * gewählte, die Abfolge steht im Protokoll. Nur die letzte zu zeigen würde eine
 * gemischte Sitzung als reine BTC-Sitzung ausgeben.
 */
function symbole(s) {
    const gesehen = []
    for (const e of s.protokoll || []) {
        if (e.art !== 'symbol' && e.art !== 'start') continue
        // „BTCUSDT → ETHUSDT" bzw. „Sitzung gestartet — BTCUSDT"
        for (const treffer of String(e.text || '').matchAll(/\b([A-Z0-9]{2,15}USDT)\b/g)) {
            const kurz = treffer[1].replace(/USDT$/, '')
            if (!gesehen.includes(kurz)) gesehen.push(kurz)
        }
    }
    const letzte = String(s.symbol || '').replace(/USDT$/, '')
    if (letzte && !gesehen.includes(letzte)) gesehen.push(letzte)
    return gesehen
}

/** Was in der Liste steht. Eine laufende Sitzung bleibt immer sichtbar. */
const sichtbare = computed(() => sitzungen.value.filter(s =>
    archivZeigen.value || !istArchiviert(s) || s.status === 'laufend'))

const archivAnzahl = computed(() => sitzungen.value.filter(istArchiviert).length)

/**
 * Kurze Bilanz über alle beendeten Sitzungen — Disziplin, nicht Rendite.
 * Rechnet bewusst über ALLE, auch archivierte: eine Disziplinquote, die sich
 * durch Wegräumen verbessern lässt, wäre wertlos.
 */
const bilanz = computed(() => {
    const fertige = sitzungen.value.filter(s => s.status === 'beendet')
    const mitPlan = fertige.filter(hatPlan)
    return {
        anzahl: fertige.length,
        mitPlan: mitPlan.length,
        gehalten: mitPlan.filter(s => !Number(s.planVerletzt)).length,
        pnl: fertige.reduce((n, s) => n + (Number(s.pnlUsd) || 0), 0),
    }
})

onMounted(lade)
</script>

<template>
    <div class="lsWrap">
        <div class="liveHeader">
            <div class="liveTitle">
                <span class="liveSymbol">{{ t('liveSessions.title') }}</span>
            </div>
            <div class="liveActions">
                <button v-if="archivAnzahl" type="button"
                    :class="['ctl-pill', archivZeigen ? 'active' : '']"
                    @click="archivZeigen = !archivZeigen">
                    <i class="uil uil-archive"></i>{{ t('liveSessions.archivZeigen', { n: archivAnzahl }) }}
                </button>
                <button type="button" class="ctl-pill" @click="lade">
                    <i class="uil uil-sync"></i>{{ t('marktradar.refreshAll') }}
                </button>
                <span class="ctl-sep"></span>
                <PageInfo section="info.liveSessions" />
            </div>
        </div>

        <!-- Bilanz über die Disziplin, bewusst vor der Liste -->
        <div v-if="bilanz.anzahl" class="lsBilanz">
            <span>{{ t('liveSessions.bilanzAnzahl', { n: bilanz.anzahl }) }}</span>
            <span v-if="bilanz.mitPlan" class="lsDisziplin">
                {{ t('liveSessions.bilanzDisziplin', { gehalten: bilanz.gehalten, von: bilanz.mitPlan }) }}
            </span>
            <span :class="farbe(bilanz.pnl)">{{ geld(bilanz.pnl) }}</span>
        </div>

        <div v-if="fehler" class="lsFehler">{{ fehler }}</div>
        <div v-if="laedt" class="lsLeer"><span class="spinner-border spinner-border-sm"></span></div>
        <div v-else-if="!sitzungen.length" class="lsLeer">{{ t('liveSessions.keine') }}</div>
        <div v-else-if="!sichtbare.length" class="lsLeer">{{ t('liveSessions.alleArchiviert') }}</div>

        <div v-for="s in sichtbare" :key="s.objectId" class="lsKarte"
            :class="{ laufend: s.status === 'laufend', verletzt: Number(s.planVerletzt),
                      archiviert: istArchiviert(s) }">
            <div class="lsZeile1">
                <span class="lsDatum">{{ dayjs(Number(s.startUnix)).format('DD.MM.YYYY HH:mm') }}</span>
                <span class="lsSymbol">{{ symbole(s).join(' · ') || '—' }}</span>
                <span class="lsDauer">{{ dauerText(s) }}</span>

                <span v-if="s.status === 'laufend'" class="lsStatusLaufend">
                    {{ t('liveSessions.laufend') }}
                </span>
                <span v-else-if="s.status === 'abgebrochen'" class="lsStatusAbbruch">
                    {{ t('liveSessions.abgebrochen') }}
                </span>
                <template v-else>
                    <span :class="['lsPnl', farbe(s.pnlUsd)]">{{ geld(s.pnlUsd) }}</span>
                    <span class="lsTrades">{{ t('liveSessions.trades', { n: s.tradeAnzahl || 0 }) }}</span>
                </template>

                <span class="lsLuecke"></span>

                <button v-if="s.status === 'laufend'" type="button" class="ctl-pill"
                    @click="schliesseVergessene(s)">
                    {{ t('liveSessions.schliessen') }}
                </button>
                <button type="button" class="ctl-pill"
                    @click="offenesProtokoll = offenesProtokoll === s.objectId ? null : s.objectId">
                    {{ t('liveSessions.protokoll') }}
                </button>
                <button v-if="s.status !== 'laufend'" type="button" class="ctl-pill"
                    @click="archivieren(s, !istArchiviert(s))">
                    <i class="uil" :class="istArchiviert(s) ? 'uil-upload-alt' : 'uil-archive'"></i>
                    {{ istArchiviert(s) ? t('liveSessions.hervorholen') : t('liveSessions.archivieren') }}
                </button>
                <button type="button" :class="['ctl-pill', loeschFrage === s.objectId ? 'lsLoeschScharf' : '']"
                    @click="loesche(s)">
                    {{ loeschFrage === s.objectId ? t('liveSessions.wirklich') : t('common.delete') }}
                </button>
            </div>

            <div v-if="hatPlan(s)" class="lsPlan">
                <span class="lsPlanText">{{ planText(s) }}</span>
                <span v-if="s.status === 'beendet'"
                    :class="Number(s.planVerletzt) ? 'lsPlanWeg' : 'lsPlanOk'">
                    {{ Number(s.planVerletzt) ? t('liveSessions.planVerletzt') : t('liveSessions.planGehalten') }}
                </span>
            </div>

            <div v-if="s.planNotiz" class="lsVorsatz">
                <i class="uil uil-notes"></i>{{ s.planNotiz }}
            </div>
            <div v-if="s.notizen" class="lsNotizen">{{ s.notizen }}</div>
            <div v-if="s.fazit" class="lsFazit">{{ s.fazit }}</div>

            <div v-if="offenesProtokoll === s.objectId" class="lsProtokoll">
                <div v-for="(e, i) in (s.protokoll || [])" :key="i" class="lsProtoZeile">
                    <span class="lsProtoZeit">{{ dayjs(e.t).format('HH:mm:ss') }}</span>
                    <span class="lsProtoArt">{{ e.art }}</span>
                    <span class="lsProtoText">{{ e.text }}</span>
                </div>
                <div v-if="!(s.protokoll || []).length" class="lsProtoLeer">
                    {{ t('liveSessions.protokollLeer') }}
                </div>

                <!-- Die eingefrorenen Trades: was am Ende der Sitzung gezählt wurde -->
                <div v-if="(s.trades || []).length" class="lsTradeListe">
                    <div v-for="(x, i) in s.trades" :key="'t' + i" class="lsTradeZeile">
                        <span class="lsProtoZeit">{{ dayjs(x.exitTime * 1000).format('HH:mm:ss') }}</span>
                        <span class="lsTradeSym">{{ String(x.symbol || '').replace(/USDT$/, '') }}</span>
                        <span class="lsTradeSeite">{{ x.side }}</span>
                        <span :class="['lsTradePnl', farbe(x.netProceeds)]">{{ geld(x.netProceeds) }}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.lsWrap {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 300px;
}

.lsBilanz {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 0.85rem;
    padding: 0.4rem 0.6rem;
    border-radius: var(--border-radius);
    background: rgba(255, 255, 255, 0.04);
}

.lsDisziplin { color: var(--white-60); }

.lsKarte {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem 0.6rem;
    border-radius: var(--border-radius);
    background: rgba(255, 255, 255, 0.03);
    border-left: 3px solid transparent;
}

.lsKarte.laufend { border-left-color: #4ec9a0; }
.lsKarte.verletzt { border-left-color: #ff6b7a; }

/* Archiviert bleibt lesbar, tritt aber zurück — sonst wäre das Einblenden des
   Archivs optisch nicht vom normalen Bestand zu unterscheiden. */
.lsKarte.archiviert {
    opacity: 0.6;
    background: rgba(255, 255, 255, 0.015);
}

.lsZeile1 {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
    font-size: 0.84rem;
}

.lsLuecke { flex: 1; }
.lsDatum { font-variant-numeric: tabular-nums; color: var(--white-87); }
.lsSymbol { font-weight: 700; color: var(--blue-color, #01B4FF); }
.lsDauer { color: var(--white-60); font-size: 0.76rem; }
.lsPnl { font-weight: 700; font-variant-numeric: tabular-nums; }
.lsTrades { color: var(--white-60); font-size: 0.76rem; }

.lsStatusLaufend { color: #4ec9a0; font-weight: 600; }
.lsStatusAbbruch { color: var(--white-60); font-style: italic; }

.lsLoeschScharf { color: #ff6b7a; border-color: rgba(255, 107, 122, 0.5); }

.lsPlan {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    font-size: 0.78rem;
}

.lsPlanText { color: var(--white-60); }
.lsPlanOk { color: #4ec9a0; font-weight: 600; }
.lsPlanWeg { color: #ff6b7a; font-weight: 600; }

.lsVorsatz {
    display: flex;
    gap: 0.3rem;
    align-items: center;
    font-size: 0.8rem;
    color: var(--white-60);
}

.lsNotizen {
    font-size: 0.8rem;
    color: var(--white-87);
    white-space: pre-wrap;
}

.lsFazit {
    font-size: 0.82rem;
    font-style: italic;
    color: var(--white-87);
}

.lsProtokoll {
    margin-top: 0.3rem;
    padding-top: 0.3rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    gap: 0.08rem;
}

.lsProtoZeile, .lsTradeZeile {
    display: flex;
    gap: 0.5rem;
    font-size: 0.76rem;
    font-variant-numeric: tabular-nums;
}

.lsProtoZeit { color: var(--white-60); min-width: 4.2rem; }
.lsProtoArt { color: var(--white-60); min-width: 4.5rem; }
.lsProtoText { flex: 1; min-width: 0; }
.lsProtoLeer { font-size: 0.76rem; color: var(--white-60); }

.lsTradeListe {
    margin-top: 0.3rem;
    padding-top: 0.3rem;
    border-top: 1px dashed rgba(255, 255, 255, 0.08);
}

.lsTradeSym { font-weight: 700; min-width: 3rem; }
.lsTradeSeite { color: var(--white-60); min-width: 3.5rem; }
.lsTradePnl { font-weight: 600; }

.lsLeer {
    padding: 1.5rem;
    text-align: center;
    color: var(--white-60);
}

.lsFehler {
    font-size: 0.82rem;
    color: #ff6b7a;
}
</style>
