<script setup>
/**
 * Statusband des Pults — die oberste Zeile, vier Felder nebeneinander.
 *
 * ## Warum das Budget die Kopfzahl ist und nicht der Gewinn
 *
 * Im Raster steht das Ergebnis in einer Kachel unter vielen. Hier steht es
 * bewusst NEBEN den beiden Balken und nicht über ihnen: Was in einer Sitzung
 * über Erfolg entscheidet, ist nicht die Zahl, die gerade dasteht, sondern ob
 * der vorher gefasste Plan noch trägt. Deshalb sind die Balken das grösste
 * bewegte Element im Band, und nur sie dürfen Bernstein werden.
 *
 * Gerechnet wird hier nichts — `plan.verlustAnteil`/`tradeAnteil` kommen fertig
 * aus `server/sitzung-rechnung.js`. Zwei Eigenschaften von dort sind wichtig
 * und werden hier nicht wegvereinfacht: `null` heisst „keine Grenze gesetzt"
 * (nicht 0, der Balken bleibt dann leer statt bei null zu stehen), und der
 * Anteil kann über 1 gehen — dann läuft der Balken über, statt bei 100 % zu
 * lügen.
 *
 * ## Der Preis ist Markpreis und wird alt angeschrieben
 *
 * Die Seite hat keine eigene Kursverbindung; der einzige belastbare absolute
 * Preis liegt in der Funding-Kachel (Binance-Markpreis, Takt 60 s). Eine
 * minutenalte Zahl in 26 Pixeln neben einem laufenden Orderbuch ist gefährlich,
 * deshalb steht das Alter daneben und die Zahl ergraut, sobald sie älter als
 * `PREIS_FRISCH_MS` ist. Lieber sichtbar alt als unsichtbar falsch.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { aktiveSitzung, laufzeitText } from '../../../stores/livetrading.js'

const props = defineProps({
    positionen: { type: Object, default: null },
    funding: { type: Object, default: null },
    lsoi: { type: Object, default: null },
    symbol: { type: String, default: '' },
    preisStand: { type: Number, default: 0 },
    jetzt: { type: Number, default: 0 },
})

const { t } = useI18n()

/** Ab hier gilt der Markpreis als zu alt zum Vertrauen. */
const PREIS_FRISCH_MS = 90 * 1000

const kurz = computed(() => String(props.symbol || '').replace(/USDT$/, ''))

/**
 * Markpreis des gewählten Symbols. Zuerst in den eigenen Märkten suchen (die
 * stehen immer in der Antwort), dann in der Rangliste — ein Symbol ausserhalb
 * der Top-N hat dort keine Zeile, und dann gibt es eben keinen Preis.
 */
const preis = computed(() => {
    const f = props.funding
    if (!f || !props.symbol) return null
    const treffer = (f.eigene || []).find(r => r.symbol === props.symbol)
        || (f.alle || []).find(r => r.symbol === props.symbol)
    return Number(treffer?.markPreis) || null
})

const preisAlterMs = computed(() =>
    props.preisStand ? Math.max(0, props.jetzt - props.preisStand) : 0)

const preisVeraltet = computed(() => preisAlterMs.value > PREIS_FRISCH_MS)

/**
 * Ganzzahl und Nachkomma getrennt: die Nachkommastellen laufen kleiner und
 * blasser mit. Bei einem fünfstelligen Kurs sind sie Rauschen, das die
 * Ablesbarkeit der vorderen Stellen kostet — wegzulassen wären sie aber
 * falsch, weil ein Tick genau dort passiert.
 */
const preisTeile = computed(() => {
    const p = preis.value
    if (p == null) return null
    const stellen = p >= 1000 ? 2 : p >= 1 ? 3 : 6
    const [ganz, rest] = p.toFixed(stellen).split('.')
    return { ganz: Number(ganz).toLocaleString('de-CH').replace(/'/g, ' '), rest }
})

const delta24 = computed(() => {
    const v = props.lsoi?.jetzt?.preisDelta24hPct
    return v === null || v === undefined ? null : Number(v)
})

const plan = computed(() => props.positionen?.plan || {})

/*
 * Die Grenzen selbst stehen in der Sitzung, nicht in der Rechnung — die liefert
 * nur die Anteile. Sie aus dem Anteil zurückzurechnen wäre der naheliegende
 * Kurzschluss und bei null Trades eine Division durch null.
 */
const maxVerlust = computed(() => Number(aktiveSitzung.value?.planMaxVerlustUsd) || 0)
const maxTrades = computed(() => Number(aktiveSitzung.value?.planMaxTrades) || 0)
const verbraucht = computed(() => Math.max(0, -(Number(props.positionen?.realisiertUsd) || 0)))

/** Über 100 % läuft der Balken über — gekappt wird nur die Zeichenbreite. */
const breite = (anteil) => anteil == null ? 0 : Math.min(100, anteil * 100)
const ueber = (anteil) => anteil != null && anteil > 1

function stufe(anteil) {
    if (anteil == null) return ''
    if (anteil >= 1) return 'pbUeber'
    if (anteil >= 0.7) return 'pbNah'
    return ''
}

const geld = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(Number(v) || 0).toFixed(2)}`

/** Alter in der gröbsten Einheit, die noch stimmt. */
const alterText = computed(() => {
    const s = Math.round(preisAlterMs.value / 1000)
    if (!props.preisStand) return '—'
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`
})
</script>

<template>
    <div class="pStatus">
        <!-- Markt -->
        <div class="pFeld pMarkt">
            <div class="pSymbol">{{ kurz || '—' }}</div>
            <div class="pKlein">{{ t('livetrading.pult.markt') }}</div>
        </div>

        <!-- Preis -->
        <div class="pFeld">
            <div v-if="preisTeile" class="pPreis" :class="{ pAlt: preisVeraltet }">
                {{ preisTeile.ganz }}<span class="pNachkomma">,{{ preisTeile.rest }}</span>
            </div>
            <div v-else class="pPreis pAlt">—</div>
            <div class="pKlein pPreisFuss">
                <span v-if="delta24 !== null" :class="delta24 >= 0 ? 'gut' : 'schlecht'">
                    {{ delta24 >= 0 ? '+' : '' }}{{ delta24.toFixed(2) }} %
                </span>
                <span v-else>—</span>
                <span class="pTrenner">{{ t('livetrading.pult.mark') }}</span>
                <span :class="{ pWarn: preisVeraltet }">{{ alterText }}</span>
            </div>
        </div>

        <!-- Plan: das Herzstück. Drei EIGENE Felder, keine Untergliederung
             in einem — sonst laufen sie auf breiten Schirmen ineinander. -->
        <div class="pFeld pBudgetFeld">
            <div class="pBudgetKopf">
                <span>{{ t('livetrading.pult.verlustbudget') }}</span>
                <span class="pBudgetZahl" :class="stufe(plan.verlustAnteil)">
                    <template v-if="plan.verlustAnteil != null">
                        {{ verbraucht.toFixed(0) }} / {{ maxVerlust.toFixed(0) }} $
                    </template>
                    <template v-else>{{ t('livetrading.pult.ohneGrenze') }}</template>
                </span>
            </div>
            <div class="pSchiene">
                <div class="pBalken" :class="stufe(plan.verlustAnteil)"
                    :style="{ width: breite(plan.verlustAnteil) + '%' }"></div>
                <div class="pMarke"></div>
                <div v-if="ueber(plan.verlustAnteil)" class="pUeberlauf"></div>
            </div>
        </div>

        <div class="pFeld pBudgetFeld">
            <div class="pBudgetKopf">
                <span>{{ t('livetrading.pult.trades') }}</span>
                <span class="pBudgetZahl" :class="stufe(plan.tradeAnteil)">
                    <template v-if="maxTrades">{{ positionen?.tradeAnzahl ?? 0 }} / {{ maxTrades }}</template>
                    <template v-else>{{ positionen?.tradeAnzahl ?? 0 }}</template>
                </span>
            </div>
            <div class="pSchiene">
                <div class="pBalken pBalkenNeutral" :class="stufe(plan.tradeAnteil)"
                    :style="{ width: breite(plan.tradeAnteil) + '%' }"></div>
                <div v-if="maxTrades" class="pMarke"></div>
            </div>
        </div>

        <div class="pFeld pErgebnisFeld">
            <div class="pErgebnis">
                <div class="pKlein">{{ t('livetrading.positionen.realisiert') }}</div>
                <div class="pErgebnisZahl" :class="(positionen?.realisiertUsd ?? 0) >= 0 ? 'gut' : 'schlecht'">
                    {{ positionen ? geld(positionen.realisiertUsd) : '—' }}
                </div>
                <div class="pKlein pOffen">
                    {{ t('livetrading.positionen.unrealisiert') }}
                    <b :class="(positionen?.unrealisiertUsd ?? 0) >= 0 ? 'gut' : 'schlecht'">
                        {{ positionen ? geld(positionen.unrealisiertUsd) : '—' }}
                    </b>
                </div>
            </div>
        </div>

        <!-- Uhr -->
        <div class="pFeld pUhr">
            <div class="pZeit">{{ aktiveSitzung ? laufzeitText : '—:—:—' }}</div>
            <div class="pKlein">
                {{ aktiveSitzung ? t('livetrading.pult.sitzung') : t('livetrading.pult.keineSitzung') }}
            </div>
        </div>
    </div>
</template>

<style scoped>
/*
 * Kein Kartenrahmen, keine Rundung, kein Schatten: die Felder werden nur durch
 * Haarlinien getrennt, die bis an den Rand laufen. Das ist der sichtbare
 * Unterschied zum Raster — dort ist jede Kachel ein Objekt, hier ist die ganze
 * Zeile ein Gerät.
 */
.pStatus {
    display: grid;
    /*
     * Sechs Felder, jedes mit eigener Aufgabe. Die beiden Budget-Felder sind
     * bewusst FEST und nicht `1fr`: als Bruchteil gezogen wurden die Balken auf
     * einem breiten Schirm über 500 px lang, und ein Balken, dessen Ende man
     * nicht zusammen mit seinem Anfang sieht, ist keine Anzeige mehr.
     */
    grid-template-columns: 110px 190px 230px 190px 1fr 136px;
    border-bottom: 1px solid var(--pTrenn);
    background: var(--pChrom);
}

.pFeld {
    padding: 0.35rem 0.6rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
}

/* Die Rinne zwischen zwei Feldern ist das einzige Trennmittel — keine Karten,
   keine Schatten. Dann muss sie aber auch sichtbar sein. */
.pFeld + .pFeld { border-left: 1px solid var(--pTrenn); }

/* Beschriftung klein und gesperrt, Wert gross: der Sprung dazwischen macht
   die Ablesbarkeit aus, nicht die Farbe. */
.pKlein {
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--white-38);
    white-space: nowrap;
}

.pSymbol {
    font-size: 1.25rem;
    letter-spacing: 0.05em;
    color: var(--white-87);
    line-height: 1.1;
    font-weight: 600;
}

/* Tabellenziffern: ohne sie springen die Stellen bei jedem Tick seitlich, und
   genau daran erkennt man eine Webseite statt eines Instruments. */
.pPreis {
    font-size: 1.6rem;
    font-variant-numeric: tabular-nums;
    color: var(--white-87);
    line-height: 1.1;
}

.pPreis.pAlt { color: var(--white-38); }
.pNachkomma { font-size: 0.95rem; color: var(--white-38); }

.pPreisFuss { display: flex; gap: 0.5rem; margin-top: 0.15rem; }
.pTrenner { color: var(--white-38); }
.pWarn { color: #e8a33d; }

.gut { color: #26be96; }
.schlecht { color: #ff5f56; }

/* ── Plan ───────────────────────────────────────────────────────────── */
.pBudgetKopf {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--white-38);
}

.pBudgetZahl { font-variant-numeric: tabular-nums; color: var(--white-60); }
.pBudgetZahl.pbNah { color: #e8a33d; }
.pBudgetZahl.pbUeber { color: #ff5f56; }

.pSchiene {
    position: relative;
    height: 7px;
    margin-top: 0.3rem;
    background: rgba(255, 255, 255, 0.07);
}

/*
 * Segmentiert statt durchgezogen. Ein voller Balken ist eine Fläche, ein
 * Segmentband ist eine Skala — man liest ab, wie viele Striche noch übrig
 * sind, statt eine Länge zu schätzen.
 */
.pBalken {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    background: repeating-linear-gradient(90deg, #e8a33d 0 5px, transparent 5px 7px);
    transition: width 0.3s ease;
}

.pBalkenNeutral { background: repeating-linear-gradient(90deg, var(--white-60) 0 5px, transparent 5px 7px); }

/* Die Trade-Zählung läuft neutral mit und färbt sich erst an denselben zwei
   Schwellen wie das Verlustbudget — sonst wäre der eine Balken eine Warnung
   und der andere Dekoration. */
.pBalken.pbNah { background: repeating-linear-gradient(90deg, #e8a33d 0 5px, transparent 5px 7px); }
.pBalken.pbUeber { background: repeating-linear-gradient(90deg, #ff5f56 0 5px, transparent 5px 7px); }

/* Vorwarnstrich bei 70 % — dieselbe Schwelle, ab der die Kachel gelb wird. */
.pMarke {
    position: absolute;
    top: -2px;
    bottom: -2px;
    left: 70%;
    width: 1px;
    background: var(--white-38);
}

/* Über der Grenze: ein Strich am rechten Ende, damit „drüber" nicht wie
   „genau voll" aussieht. */
.pUeberlauf {
    position: absolute;
    top: -3px;
    bottom: -3px;
    right: 0;
    width: 2px;
    background: #ff5f56;
}

.pErgebnisFeld { align-items: flex-end; }
.pErgebnis { text-align: right; }
.pErgebnisZahl {
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
}
.pOffen { margin-top: 0.1rem; }
.pOffen b { font-variant-numeric: tabular-nums; margin-left: 0.25rem; }

.pUhr { text-align: right; }
.pZeit {
    font-size: 1.3rem;
    font-variant-numeric: tabular-nums;
    color: var(--white-87);
    line-height: 1.1;
}
</style>
