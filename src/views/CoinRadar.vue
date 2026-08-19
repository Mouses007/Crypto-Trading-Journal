<template>
    <div class="cr">
        <!-- ── Kopf ──────────────────────────────────────────────────── -->
        <div class="crKopf">
            <ul class="nav nav-tabs crNav">
                <li v-for="r in REITER" :key="r.id" class="nav-item">
                    <a class="nav-link" :class="{ active: reiter === r.id }"
                        href="#" @click.prevent="reiter = r.id">
                        <i :class="r.icon" class="me-1"></i>{{ t('coinradar.tab_' + r.id) }}
                    </a>
                </li>
            </ul>
            <div class="crKnoepfe">
                <span v-if="laeuft" class="crFortschritt">{{ fortschrittText }}</span>
                <PageInfo section="info.coinRadar" />
                <button class="btn btn-sm btn-primary" :disabled="laeuft" @click="starte">
                    <span v-if="laeuft" class="spinner-border spinner-border-sm me-1"></span>
                    <i v-else class="uil uil-sync me-1"></i>{{ t('coinradar.jetztMessen') }}
                </button>
            </div>
        </div>

        <div v-if="meldung" class="alert py-2 small mt-2" :class="meldungFehler ? 'alert-danger' : 'alert-info'">
            {{ meldung }}
        </div>

        <!-- ══ Rangliste ═════════════════════════════════════════════ -->
        <div v-show="reiter === 'rangliste'" class="mt-3">

            <div v-if="!lauf && !laeuft" class="text-center text-muted py-5">
                <i class="uil uil-chart-line crLeerIcon"></i>
                <p class="mb-1">{{ t('coinradar.nochNichts') }}</p>
                <p class="small mb-0">{{ t('coinradar.nochNichtsHinweis') }}</p>
            </div>

            <template v-if="lauf">
                <!-- Kennzahlen -->
                <div class="crKennzahlen">
                    <div class="crZelle">
                        <div class="crWert">{{ zeilen.length }}</div>
                        <div class="crLabel">{{ t('coinradar.kzBewertet') }}</div>
                        <div class="crExtra">{{ t('coinradar.kzVonGeprueft', { n: lauf.geprueft }) }}</div>
                    </div>
                    <div class="crZelle">
                        <div class="crWert">{{ imSpielAnzahl }}</div>
                        <div class="crLabel">{{ t('coinradar.kzImSpiel') }}</div>
                        <div class="crExtra">RVOL &ge; 2</div>
                    </div>
                    <div class="crZelle">
                        <div class="crWert">{{ trendendAnzahl }}</div>
                        <div class="crLabel">{{ t('coinradar.kzTrendend') }}</div>
                        <div class="crExtra">ADX &ge; 25</div>
                    </div>
                    <div class="crZelle">
                        <div class="crWert">{{ mittelAtr }}<span class="crEinheit"> %</span></div>
                        <div class="crLabel">{{ t('coinradar.kzMittelAtr') }}</div>
                        <div class="crExtra">{{ hauptZe }}</div>
                    </div>
                    <!-- Die ehrliche Gegenprobe steht gleichberechtigt neben
                         den anderen Zahlen, nicht im Kleingedruckten. -->
                    <div class="crZelle" :class="beharrlichKlasse">
                        <div class="crWert">{{ beharrlichWert }}</div>
                        <div class="crLabel">{{ t('coinradar.kzBeharrlich') }}</div>
                        <div class="crExtra">{{ beharrlichText }}</div>
                    </div>
                    <div class="crZelle">
                        <div class="crWert crWertKlein">{{ zeitpunkt(lauf.erstelltAm) }}</div>
                        <div class="crLabel">{{ t('coinradar.kzStand') }}</div>
                        <div class="crExtra">{{ t('coinradar.ausloeser_' + (lauf.ausloeser || 'auto')) }}</div>
                    </div>
                </div>

                <!-- KI-Einordnung -->
                <div v-if="lauf.einordnung" class="crEinordnung">
                    <i class="uil uil-comment-alt-lines me-2"></i>
                    <div>
                        <p class="mb-0">{{ lauf.einordnung }}</p>
                        <span class="crQuelle">{{ t('coinradar.einordnungQuelle') }}</span>
                    </div>
                </div>

                <!-- Filter -->
                <div class="crFilter">
                    <!-- In der Hürden-Ansicht sind die Filter sinnlos: „im Spiel" setzt
                         eine Messung voraus, die es dort nicht gab. Sie wegzublenden ist
                         ehrlicher, als sie wirkungslos anklickbar zu lassen. -->
                    <template v-if="!zeigeHuerden">
                        <button v-for="f in FILTER" :key="f.id" class="crChip"
                            :class="{ aktiv: filter === f.id }" @click="filter = f.id">
                            {{ t('coinradar.filter_' + f.id) }}
                        </button>
                    </template>
                    <span class="ms-auto"></span>
                    <button class="crChip" :class="{ aktiv: zeigeHuerden }" @click="huerdenUmschalten">
                        <i class="uil uil-filter me-1"></i>{{ t('coinradar.zeigeHuerden', { n: lauf.verworfenHuerde }) }}
                    </button>
                </div>

                <!-- Am Telefon eine Karte je Coin: neun Spalten auf 375 px
                     wären eine waagerechte Rollleiste, in der man mehr sucht
                     als liest. -->
                <div v-if="istTelefon" class="crKarten">
                    <div v-for="z in gefiltert" :key="z.id" class="crKarte"
                        @click="offen = offen === z.id ? null : z.id">
                        <div class="crKarteKopf">
                            <span v-if="z.status === 'bewertet'" class="crRang">{{ z.rang }}</span>
                            <i class="uil crStern" :class="istFav(z) ? 'uil-favorite aktiv' : 'uil-star'"
                                @click.stop="favUmschalten(z)"></i>
                            <strong>{{ kurz(z.symbol) }}</strong>
                            <span v-if="bestaetigt(z)" class="crBestaetigt" :title="t('coinradar.bestaetigtHilfe')">
                                <i class="uil uil-check-circle"></i>
                            </span>
                            <span v-if="z.status === 'bewertet'" class="ms-auto crNote" :class="noteKlasse(z.note)">{{ z.note }}</span>
                            <span v-else class="ms-auto badge bg-secondary crBadge">{{ grundText(z.huerdeGrund) }}</span>
                        </div>
                        <!-- Ein an der Hürde gescheiterter Coin hat keine Kennzahlen — sie
                             wurden nie gerechnet. Vier Nullen hinzuschreiben sähe aus wie
                             eine Messung; gezeigt werden die Werte, an denen er scheiterte. -->
                        <div v-if="z.status !== 'bewertet'" class="crKarteZeile">
                            <span class="crPaar"><b>{{ t('coinradar.spalteUmsatz') }}</b> {{ mio(z.umsatz24h) }}</span>
                            <span class="crPaar"><b>{{ t('coinradar.spalteSpread') }}</b> {{ n(z.spreadBp, 2) }}</span>
                            <span class="crPaar"><b>{{ t('coinradar.spalteTiefe') }}</b> {{ n(z.tiefeUsd, 0) }}</span>
                        </div>
                        <div v-else class="crKarteZeile">
                            <span class="crPaar"><b>ATR</b> {{ n(z.atrPct, 2) }} %</span>
                            <span class="crPaar"><b>RVOL</b> {{ n(z.rvol, 1) }}</span>
                            <span class="crPaar"><b>ADX</b> {{ n(z.adx, 0) }}</span>
                            <span class="crPaar"><b>Funding</b> {{ n(z.fundingJahresRate, 0) }} %</span>
                        </div>
                        <div v-if="offen === z.id && z.status === 'bewertet'" class="crKarteDetail">
                            <div v-for="(wert, feld) in z.teilnoten" :key="feld" class="crNoteZeile">
                                <span class="crNoteName">{{ t('coinradar.note_' + feld) }}</span>
                                <span class="crBalken"><i :style="{ width: Math.round(wert) + '%' }"></i></span>
                                <span class="crNoteWert">{{ Math.round(wert) }}</span>
                            </div>
                            <p v-if="hinweise(z).length" class="crHinweise mb-0">{{ hinweise(z).join(' · ') }}</p>
                        </div>
                    </div>
                </div>

                <div v-else class="table-responsive">
                    <table class="table table-sm align-middle crTabelle">
                        <thead>
                            <!-- Zwei Ansichten, zwei Spaltensätze: Ein gescheiterter Coin
                                 hat keine Kennzahlen, und ein bewerteter braucht die
                                 Orderbuchtiefe nicht. Eine gemeinsame Tabelle hiesse, die
                                 eine Hälfte mit Nullen zu füllen. -->
                            <tr v-if="zeigeHuerden">
                                <th class="crSchmal"></th>
                                <th @click="sortiere('symbol')">{{ t('coinradar.spalteSymbol') }}</th>
                                <th>{{ t('coinradar.spalteGrund') }}</th>
                                <th class="text-end" @click="sortiere('umsatz24h')">{{ t('coinradar.spalteUmsatz') }}</th>
                                <th class="text-end" @click="sortiere('spreadBp')">{{ t('coinradar.spalteSpread') }}</th>
                                <th class="text-end" @click="sortiere('tiefeUsd')">{{ t('coinradar.spalteTiefe') }}</th>
                            </tr>
                            <tr v-else>
                                <th class="text-end crSchmal">#</th>
                                <th @click="sortiere('symbol')">{{ t('coinradar.spalteSymbol') }}</th>
                                <th class="text-end" @click="sortiere('note')">{{ t('coinradar.spalteNote') }}</th>
                                <th class="text-end" @click="sortiere('atrPct')">{{ t('coinradar.spalteAtr') }}</th>
                                <th class="text-end" @click="sortiere('rvol')">{{ t('coinradar.spalteRvol') }}</th>
                                <th class="text-end" @click="sortiere('adx')">{{ t('coinradar.spalteAdx') }}</th>
                                <th class="text-end" @click="sortiere('spreadBp')">{{ t('coinradar.spalteSpread') }}</th>
                                <th class="text-end" @click="sortiere('fundingJahresRate')">{{ t('coinradar.spalteFunding') }}</th>
                                <th class="text-end" @click="sortiere('umsatz24h')">{{ t('coinradar.spalteUmsatz') }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <template v-for="z in gefiltert" :key="z.id">
                                <tr v-if="zeigeHuerden" class="crZeile">
                                    <td></td>
                                    <td>
                                        <i class="uil crStern" :class="istFav(z) ? 'uil-favorite aktiv' : 'uil-star'"
                                            :title="istFav(z) ? t('coinradar.favEntfernen') : t('coinradar.favHinzu')"
                                            @click.stop="favUmschalten(z)"></i>
                                        <strong>{{ kurz(z.symbol) }}</strong>
                                    </td>
                                    <td><span class="badge bg-secondary crBadge">{{ grundText(z.huerdeGrund) }}</span></td>
                                    <td class="text-end crZahl">{{ mio(z.umsatz24h) }}</td>
                                    <td class="text-end crZahl">{{ n(z.spreadBp, 2) }}</td>
                                    <td class="text-end crZahl">{{ n(z.tiefeUsd, 0) }}</td>
                                </tr>
                                <tr v-else class="crZeile" @click="offen = offen === z.id ? null : z.id">
                                    <td class="text-end crRangZelle">{{ z.rang || '—' }}</td>
                                    <td>
                                        <i class="uil crStern" :class="istFav(z) ? 'uil-favorite aktiv' : 'uil-star'"
                                            :title="istFav(z) ? t('coinradar.favEntfernen') : t('coinradar.favHinzu')"
                                            @click.stop="favUmschalten(z)"></i>
                                        <strong>{{ kurz(z.symbol) }}</strong>
                                        <span v-if="bestaetigt(z)" class="crBestaetigt"
                                            :title="t('coinradar.bestaetigtHilfe')"><i class="uil uil-check-circle"></i></span>
                                    </td>
                                    <td class="text-end">
                                        <span class="crNote" :class="noteKlasse(z.note)">{{ z.note }}</span>
                                    </td>
                                    <td class="text-end crZahl">{{ n(z.atrPct, 2) }}</td>
                                    <td class="text-end crZahl" :class="{ 'crStark': z.rvol >= 2 }">{{ n(z.rvol, 2) }}</td>
                                    <td class="text-end crZahl" :class="{ 'crStark': z.adx >= 25 }">{{ n(z.adx, 0) }}</td>
                                    <td class="text-end crZahl">{{ n(z.spreadBp, 2) }}</td>
                                    <td class="text-end crZahl" :class="fundingKlasse(z.fundingJahresRate)">
                                        {{ n(z.fundingJahresRate, 1) }}
                                    </td>
                                    <td class="text-end crZahl">{{ mio(z.umsatz24h) }}</td>
                                    <td class="text-end">
                                        <i class="uil" :class="offen === z.id ? 'uil-angle-up' : 'uil-angle-down'"></i>
                                    </td>
                                </tr>
                                <tr v-if="offen === z.id && !zeigeHuerden" :key="z.id + '-d'">
                                    <td colspan="10" class="crDetail">
                                        <div class="crDetailGrid">
                                            <div>
                                                <div class="crDetailTitel">{{ t('coinradar.teilnoten') }}</div>
                                                <div v-for="(wert, feld) in z.teilnoten" :key="feld" class="crNoteZeile">
                                                    <span class="crNoteName">{{ t('coinradar.note_' + feld) }}</span>
                                                    <span class="crBalken"><i :style="{ width: Math.round(wert) + '%' }"></i></span>
                                                    <span class="crNoteWert">{{ Math.round(wert) }}</span>
                                                </div>
                                            </div>
                                            <div>
                                                <div class="crDetailTitel">{{ t('coinradar.jeZeiteinheit') }}</div>
                                                <table class="crZeTabelle">
                                                    <tr>
                                                        <th></th><th>ATR %</th><th>RVOL</th><th>ADX</th><th>{{ t('coinradar.kerzen') }}</th>
                                                    </tr>
                                                    <tr v-for="(m, ze) in kennzahlenJeZe(z)" :key="ze">
                                                        <td><b>{{ ze }}</b></td>
                                                        <td>{{ n(m.atrPct, 2) }}</td>
                                                        <td>{{ n(m.rvol, 2) }}</td>
                                                        <td>{{ n(m.adx, 0) }}</td>
                                                        <td>{{ m.kerzen }}</td>
                                                    </tr>
                                                </table>
                                                <p v-if="hinweise(z).length" class="crHinweise mb-0 mt-2">
                                                    {{ hinweise(z).join(' · ') }}
                                                </p>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            </template>
                            <tr v-if="!gefiltert.length">
                                <td :colspan="zeigeHuerden ? 6 : 10" class="text-center text-muted py-3">
                                    {{ t('coinradar.keineTreffer') }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </template>
        </div>

        <!-- ══ Verlauf ═══════════════════════════════════════════════ -->
        <div v-show="reiter === 'verlauf'" class="mt-3">
            <p class="crHinweis">{{ t('coinradar.verlaufHinweis') }}</p>

            <div v-if="!laeufe.length" class="text-muted small py-3">{{ t('coinradar.keineLaeufe') }}</div>
            <div v-else class="table-responsive">
                <table class="table table-sm align-middle crTabelle">
                    <thead>
                        <tr>
                            <th>{{ t('coinradar.spalteZeit') }}</th>
                            <th>{{ t('coinradar.spalteStatus') }}</th>
                            <th class="text-end">{{ t('coinradar.spalteBewertet') }}</th>
                            <th class="text-end">{{ t('coinradar.spalteVerworfen') }}</th>
                            <th class="text-end">{{ t('coinradar.spalteBeharrlich') }}</th>
                            <th class="text-end">{{ t('coinradar.spalteKosten') }}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="l in laeufe" :key="l.id" class="crZeile"
                            :class="{ aktiv: lauf && l.id === lauf.id }" @click="laufOeffnen(l)">
                            <td>{{ zeitpunkt(l.erstelltAm) }}</td>
                            <td>
                                <span class="badge crBadge" :class="statusKlasse(l.status)">{{ t('coinradar.status_' + l.status) }}</span>
                                <span class="crKlein ms-1">{{ t('coinradar.ausloeser_' + (l.ausloeser || 'auto')) }}</span>
                            </td>
                            <td class="text-end crZahl">{{ l.gesamt }}</td>
                            <td class="text-end crZahl">{{ l.verworfenHuerde }}</td>
                            <td class="text-end crZahl">
                                <span v-if="l.vergleichslauf">{{ n(l.rangkorrelation, 2) }}</span>
                                <span v-else class="text-muted">—</span>
                            </td>
                            <td class="text-end crZahl">{{ l.kostenUsd ? useKostenAnzeige(l.kostenUsd, 3) : '—' }}</td>
                            <td class="text-end"><i class="uil uil-angle-right"></i></td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Wer hält sich oben: die Frage, die eine einzelne Rangliste
                 nicht beantworten kann. -->
            <div v-if="dauerhaft.length" class="crBlock mt-4">
                <h6 class="crTitel">{{ t('coinradar.dauerhaftTitel') }}</h6>
                <p class="crHinweis">{{ t('coinradar.dauerhaftHinweis', { n: laeufe.length }) }}</p>
                <div class="crDauerListe">
                    <div v-for="d in dauerhaft" :key="d.symbol" class="crDauer">
                        <span class="crDauerSymbol">{{ kurz(d.symbol) }}</span>
                        <span class="crBalken breit"><i :style="{ width: d.anteil + '%' }"></i></span>
                        <span class="crDauerWert">{{ d.male }} / {{ d.moeglich }}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- ══ Einstellungen ═════════════════════════════════════════ -->
        <div v-show="reiter === 'einstellungen'" class="mt-3 crEinst">
            <div class="crBlock">
                <h6 class="crTitel">{{ t('coinradar.eAutomatik') }}</h6>
                <div class="form-check form-switch">
                    <input id="crAktiv" class="form-check-input" type="checkbox"
                        v-model="einst.aktiv" @change="speichern">
                    <label class="form-check-label" for="crAktiv">{{ t('coinradar.eAktiv') }}</label>
                </div>
                <p class="crHinweis">{{ t('coinradar.eAktivHinweis') }}</p>
                <label class="crFeld">
                    <span>{{ t('coinradar.eIntervall') }}</span>
                    <input class="form-control form-control-sm crZahlFeld" type="number" min="1" max="24"
                        v-model.number="einst.intervallStunden" @change="speichern">
                    <span class="crEinheit">{{ t('coinradar.stunden') }}</span>
                </label>
                <div class="form-check form-switch mt-3">
                    <input id="crEinordnung" class="form-check-input" type="checkbox"
                        v-model="einst.einordnungAn" @change="speichern">
                    <label class="form-check-label" for="crEinordnung">{{ t('coinradar.eEinordnung') }}</label>
                </div>
                <p class="crHinweis">{{ t('coinradar.eEinordnungHinweis') }}</p>
            </div>

            <div class="crBlock">
                <h6 class="crTitel">{{ t('coinradar.eHuerden') }}</h6>
                <p class="crHinweis">{{ t('coinradar.eHuerdenHinweis') }}</p>
                <label class="crFeld">
                    <span>{{ t('coinradar.eMinUmsatz') }}</span>
                    <input class="form-control form-control-sm crZahlFeld" type="number" min="0" step="1"
                        v-model.number="umsatzMio" @change="speichern">
                    <span class="crEinheit">{{ t('coinradar.mioUsd') }}</span>
                </label>
                <label class="crFeld">
                    <span>{{ t('coinradar.eMaxSpread') }}</span>
                    <input class="form-control form-control-sm crZahlFeld" type="number" min="0.1" step="0.1"
                        v-model.number="einst.huerden.maxSpreadBp" @change="speichern">
                    <span class="crEinheit">bp</span>
                </label>
                <label class="crFeld">
                    <span>{{ t('coinradar.eMinTiefe') }}</span>
                    <input class="form-control form-control-sm crZahlFeld" type="number" min="0" step="50"
                        v-model.number="einst.huerden.minTiefeUsd" @change="speichern">
                    <span class="crEinheit">USD</span>
                </label>
                <p class="crHinweis mt-2">{{ t('coinradar.eTiefeHinweis') }}</p>
            </div>

            <div class="crBlock">
                <h6 class="crTitel">{{ t('coinradar.eGewichte') }}</h6>
                <p class="crHinweis">{{ t('coinradar.eGewichteHinweis') }}</p>
                <div v-for="feld in GEWICHT_FELDER" :key="feld" class="crRegler">
                    <span class="crReglerName">{{ t('coinradar.note_' + feld) }}</span>
                    <input class="form-range" type="range" min="0" max="60" step="5"
                        v-model.number="einst.gewichte[feld]" @change="speichern">
                    <span class="crReglerWert">{{ einst.gewichte[feld] }}</span>
                </div>
                <p class="crSumme" :class="{ warn: gewichtSumme !== 100 }">
                    {{ t('coinradar.eSumme', { n: gewichtSumme }) }}
                    <span v-if="gewichtSumme !== 100" class="crKlein">{{ t('coinradar.eSummeHinweis') }}</span>
                </p>
            </div>

            <div class="crBlock">
                <h6 class="crTitel">{{ t('coinradar.eZeiteinheiten') }}</h6>
                <p class="crHinweis">{{ t('coinradar.eZeiteinheitenHinweis') }}</p>
                <div class="crFilter">
                    <button v-for="ze in ZE_AUSWAHL" :key="ze" class="crChip"
                        :class="{ aktiv: einst.zeiteinheiten.includes(ze) }" @click="zeUmschalten(ze)">
                        {{ ze }}
                    </button>
                </div>
                <p class="crHinweis mt-2">
                    {{ t('coinradar.eHauptZe', { ze: einst.zeiteinheiten[0] || '—' }) }}
                </p>
            </div>
        </div>
    </div>
</template>

<script setup>
/**
 * Coin-Radar — welche der handelbaren Coins sich gerade handeln lassen.
 *
 * Geschwister des Hype-Radars und bewusst dessen Gegenstück: Der Hype-Radar
 * fragt „was ist neu", diese Seite fragt „was läuft heute". Deshalb dieselbe
 * Bedienung — drei Reiter, Sterne für Favoriten, Teilnoten im Aufklappen —
 * bei völlig anderen Daten.
 *
 * Zwei Entscheidungen prägen die Darstellung:
 *
 *   Jede Note zeigt ihre Herkunft. Vier Teilbalken im Aufklappen, dazu die
 *   Rohwerte je Zeiteinheit. Eine Zahl von 0 bis 100 ohne Herleitung wäre
 *   genau die Art Kennzahl, der man am Ende blind folgt.
 *
 *   Die Beharrlichkeit steht bei den Kennzahlen, nicht im Kleingedruckten.
 *   Sagt der vorige Lauf diesen nicht voraus, ist die Rangliste Rauschen —
 *   und dann soll die Seite das aussprechen, statt eine überzeugend
 *   aussehende Tabelle unkommentiert zu zeigen.
 *
 * Was die Seite ausdrücklich NICHT behauptet: wohin ein Kurs geht. Sie misst
 * einen Zustand.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import PageInfo from '../components/PageInfo.vue'
import { useKostenAnzeige } from '../utils/formatters.js'
import { useIstTelefon } from '../utils/geraet.js'
import { logWarn } from '../utils/logger.js'

const { t } = useI18n()
const istTelefon = useIstTelefon()

const REITER = [
    { id: 'rangliste', icon: 'uil uil-list-ol-alt' },
    { id: 'verlauf', icon: 'uil uil-history' },
    { id: 'einstellungen', icon: 'uil uil-setting' },
]
const FILTER = [{ id: 'alle' }, { id: 'imSpiel' }, { id: 'trendend' }, { id: 'bestaetigt' }]
const GEWICHT_FELDER = ['bewegung', 'imSpiel', 'trend', 'kosten']
const ZE_AUSWAHL = ['5m', '15m', '1h', '4h']

const reiter = ref('rangliste')
const laeuft = ref(false)
const fortschritt = ref(null)
const meldung = ref('')
const meldungFehler = ref(false)
const offen = ref(null)
const filter = ref('alle')
const zeigeHuerden = ref(false)

const lauf = ref(null)
const zeilen = ref([])
const laeufe = ref([])
const favoriten = ref([])
const einst = ref({
    aktiv: false, intervallStunden: 1, zeiteinheiten: ['1h', '15m'],
    gewichte: { bewegung: 30, imSpiel: 30, trend: 25, kosten: 15 },
    huerden: { minUmsatz24hUsd: 10000000, maxSpreadBp: 5, minTiefeUsd: 0 },
    einordnungAn: true,
})
let strom = null

// ── Anzeige-Helfer ──────────────────────────────────────────────────────
const n = (w, s = 2) => (Number.isFinite(Number(w)) ? Number(w).toFixed(s) : '—')
const mio = (w) => (Number(w) ? `${(Number(w) / 1e6).toFixed(0)}` : '—')
/** BTCUSDT liest sich als BTC — das Quotepaar ist bei allen dasselbe. */
const kurz = (s) => String(s || '').replace(/USDT$/, '')

function zeitpunkt(ms) {
    const d = new Date(Number(ms) || 0)
    if (!Number(ms)) return '—'
    return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const noteKlasse = (w) => (w >= 60 ? 'gut' : (w >= 40 ? 'mittel' : 'schwach'))
const fundingKlasse = (w) => {
    const z = Number(w)
    if (!Number.isFinite(z) || Math.abs(z) < 25) return ''
    return Math.abs(z) >= 50 ? 'text-danger' : 'text-warning'
}
const statusKlasse = (s) => ({
    fertig: 'bg-success', laeuft: 'bg-primary',
    abgebrochen: 'bg-secondary', fehler: 'bg-danger',
}[s] || 'bg-secondary')

const grundText = (g) => {
    const s = t('coinradar.grund_' + g)
    return s === 'coinradar.grund_' + g ? g : s
}

/*
 * `jeZeiteinheit` trägt neben den Zeiteinheiten auch `hinweise` und
 * `bestaetigt` — beim Auslesen der Messwerte müssen die wieder heraus, sonst
 * stünden sie als Geisterzeile in der Tabelle.
 */
function kennzahlenJeZe(z) {
    const raus = {}
    for (const [k, v] of Object.entries(z.jeZeiteinheit || {})) {
        if (k === 'hinweise' || k === 'bestaetigt') continue
        raus[k] = v
    }
    return raus
}
const hinweise = (z) => z.jeZeiteinheit?.hinweise || []
const bestaetigt = (z) => z.jeZeiteinheit?.bestaetigt === true

const hauptZe = computed(() => einst.value.zeiteinheiten?.[0] || '1h')

// ── Kennzahlen des Laufs ────────────────────────────────────────────────
const bewertete = computed(() => zeilen.value.filter((z) => z.status === 'bewertet'))
const imSpielAnzahl = computed(() => bewertete.value.filter((z) => Number(z.rvol) >= 2).length)
const trendendAnzahl = computed(() => bewertete.value.filter((z) => Number(z.adx) >= 25).length)
const mittelAtr = computed(() => {
    const w = bewertete.value.map((z) => Number(z.atrPct)).filter(Number.isFinite)
    return w.length ? (w.reduce((a, b) => a + b, 0) / w.length).toFixed(2) : '—'
})

/*
 * Die Beharrlichkeit in Worten, nicht nur als Zahl. „0,12" sagt niemandem
 * etwas; „hält kaum" schon — und genau das ist die Aussage, die den Wert
 * der ganzen Liste bestimmt.
 */
const beharrlichWert = computed(() => {
    if (!lauf.value?.vergleichslauf) return '—'
    return Number(lauf.value.rangkorrelation).toFixed(2)
})
const beharrlichText = computed(() => {
    if (!lauf.value?.vergleichslauf) return t('coinradar.beharrlichKeinVorlauf')
    const r = Number(lauf.value.rangkorrelation)
    if (r >= 0.7) return t('coinradar.beharrlichHoch')
    if (r >= 0.4) return t('coinradar.beharrlichMittel')
    return t('coinradar.beharrlichNiedrig')
})
const beharrlichKlasse = computed(() => {
    if (!lauf.value?.vergleichslauf) return ''
    return Number(lauf.value.rangkorrelation) < 0.4 ? 'warnung' : ''
})

// ── Sortieren & Filtern ─────────────────────────────────────────────────
const sortFeld = ref('rang')
const sortAb = ref(false)

function sortiere(feld) {
    if (sortFeld.value === feld) sortAb.value = !sortAb.value
    else { sortFeld.value = feld; sortAb.value = feld !== 'symbol' }
}

const gefiltert = computed(() => {
    let l = zeilen.value
    if (!zeigeHuerden.value) {
        if (filter.value === 'imSpiel') l = l.filter((z) => Number(z.rvol) >= 2)
        else if (filter.value === 'trendend') l = l.filter((z) => Number(z.adx) >= 25)
        else if (filter.value === 'bestaetigt') l = l.filter(bestaetigt)
    }
    const f = sortFeld.value
    return [...l].sort((a, b) => {
        if (f === 'symbol') {
            const v = String(a.symbol).localeCompare(String(b.symbol))
            return sortAb.value ? -v : v
        }
        const v = (Number(a[f]) || 0) - (Number(b[f]) || 0)
        return sortAb.value ? -v : v
    })
})

/*
 * Wer hält sich oben? Gezählt wird, wie oft ein Symbol in den letzten Läufen
 * unter den ersten zehn stand. Interessant ist nicht der beste Lauf, sondern
 * das, was mehrere überstanden hat.
 */
const dauerhaft = ref([])

// ── Laden ───────────────────────────────────────────────────────────────
async function ladeZeilen(laufId = 0) {
    try {
        const r = await axios.get('/api/coin-radar/zeilen', {
            params: { ...(laufId ? { laufId } : {}), ...(zeigeHuerden.value ? { huerden: 1 } : {}) },
        })
        lauf.value = r.data?.lauf || null
        zeilen.value = r.data?.zeilen || []
    } catch (e) {
        logWarn('coin-radar', 'Rangliste konnte nicht geladen werden', e)
    }
}

async function ladeLaeufe() {
    try {
        const r = await axios.get('/api/coin-radar/laeufe')
        laeufe.value = r.data || []
        await rechneDauerhaft()
    } catch (e) {
        logWarn('coin-radar', 'Läufe konnten nicht geladen werden', e)
    }
}

async function rechneDauerhaft() {
    const fertige = laeufe.value.filter((l) => l.status === 'fertig').slice(0, 5)
    // Unter zwei Läufen gibt es nichts zu vergleichen — eine „Beständigkeit"
    // aus einer einzigen Messung wäre eine Behauptung, keine Beobachtung.
    if (fertige.length < 2) { dauerhaft.value = []; return }
    try {
        const alle = await Promise.all(fertige.map((l) =>
            axios.get('/api/coin-radar/zeilen', { params: { laufId: l.id, limit: 10 } })
                .then((r) => (r.data?.zeilen || []).slice(0, 10).map((z) => z.symbol))
                .catch(() => [])))
        const zaehler = new Map()
        for (const liste of alle) for (const s of liste) zaehler.set(s, (zaehler.get(s) || 0) + 1)
        dauerhaft.value = [...zaehler.entries()]
            .filter(([, male]) => male >= 2)
            .sort((a, b) => b[1] - a[1]).slice(0, 8)
            .map(([symbol, male]) => ({
                symbol, male, moeglich: fertige.length,
                anteil: Math.round((male / fertige.length) * 100),
            }))
    } catch {
        dauerhaft.value = []
    }
}

async function ladeEinstellungen() {
    try {
        const r = await axios.get('/api/coin-radar/einstellungen')
        einst.value = { ...einst.value, ...r.data }
    } catch (e) {
        logWarn('coin-radar', 'Einstellungen konnten nicht geladen werden', e)
    }
}

async function ladeFavoriten() {
    try {
        const r = await axios.get('/api/hype-radar/favoriten')
        favoriten.value = r.data || []
    } catch (e) {
        logWarn('coin-radar', 'Favoriten konnten nicht geladen werden', e)
    }
}

// ── Favoriten ───────────────────────────────────────────────────────────
/*
 * Beide Radare teilen sich eine Favoritenliste — das ist der Gewinn des
 * gemeinsamen Dachs. Ein Bitunix-Coin hat aber keine Kette, deshalb ist der
 * Schlüssel Symbol plus leeres Kettenfeld, und `quelle` sagt dem Wachhund,
 * über welchen Datenweg er ihn prüfen muss.
 */
const istFav = (z) => favoriten.value.some((f) => f.symbol === z.symbol && !f.chain)

async function favUmschalten(z) {
    const vorhanden = favoriten.value.find((f) => f.symbol === z.symbol && !f.chain)
    try {
        if (vorhanden) await axios.delete(`/api/hype-radar/favoriten/${vorhanden.id}`)
        else await axios.post('/api/hype-radar/favoriten', { symbol: z.symbol, quelle: 'coinradar' })
        await ladeFavoriten()
    } catch (e) {
        logWarn('coin-radar', 'Favorit konnte nicht umgeschaltet werden', e)
    }
}

// ── Einstellungen ───────────────────────────────────────────────────────
const gewichtSumme = computed(() =>
    GEWICHT_FELDER.reduce((a, f) => a + (Number(einst.value.gewichte?.[f]) || 0), 0))

/** Millionen sind lesbar, 10000000 ist es nicht. */
const umsatzMio = computed({
    get: () => Math.round((Number(einst.value.huerden?.minUmsatz24hUsd) || 0) / 1e6),
    set: (v) => { einst.value.huerden.minUmsatz24hUsd = (Number(v) || 0) * 1e6 },
})

function zeUmschalten(ze) {
    const l = [...(einst.value.zeiteinheiten || [])]
    const i = l.indexOf(ze)
    if (i >= 0) {
        // Die letzte darf nicht weg — ohne Hauptzeiteinheit gibt es keine Note.
        if (l.length <= 1) return
        l.splice(i, 1)
    } else {
        if (l.length >= 2) l.pop()
        l.push(ze)
    }
    // Die gröbere trägt die Note, die feinere bestätigt.
    const rang = { '5m': 0, '15m': 1, '1h': 2, '4h': 3 }
    l.sort((a, b) => (rang[b] ?? 0) - (rang[a] ?? 0))
    einst.value.zeiteinheiten = l
    speichern()
}

let speicherUhr = null
function speichern() {
    // Sammeln statt bei jedem Reglerpixel schreiben.
    clearTimeout(speicherUhr)
    speicherUhr = setTimeout(async () => {
        try {
            const { vorgaben, ...rest } = einst.value
            const r = await axios.put('/api/coin-radar/einstellungen', rest)
            einst.value = { ...einst.value, ...r.data }
        } catch (e) {
            meldung.value = e.response?.data?.error || e.message
            meldungFehler.value = true
        }
    }, 400)
}

// ── Lauf ────────────────────────────────────────────────────────────────
const fortschrittText = computed(() => {
    const f = fortschritt.value
    if (!f) return ''
    if (f.schritt === 'universum') return t('coinradar.fUniversum', { n: f.anzahl ?? '' })
    if (f.schritt === 'marktweit') return t('coinradar.fMarktweit')
    if (f.schritt === 'gesiebt') return t('coinradar.fGesiebt', { n: f.anzahl, v: f.verworfen })
    if (f.schritt === 'kerzen') return t('coinradar.fKerzen', { ze: f.zeiteinheit, n: f.fertig ?? 0, g: f.gesamt ?? 0 })
    if (f.schritt === 'bewerten') return t('coinradar.fBewerten', { n: f.fertig ?? 0, g: f.gesamt ?? 0 })
    if (f.schritt === 'einordnung') return t('coinradar.fEinordnung')
    return t('coinradar.fLaeuft')
})

async function starte() {
    if (laeuft.value) return
    laeuft.value = true
    meldung.value = ''
    meldungFehler.value = false
    fortschritt.value = { schritt: 'universum' }

    strom = new AbortController()
    try {
        const antwort = await fetch('/api/coin-radar/lauf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            signal: strom.signal,
        })
        if (!antwort.ok) {
            const j = await antwort.json().catch(() => ({}))
            throw new Error(j.error || `HTTP ${antwort.status}`)
        }

        // Zeilenweise lesen — dasselbe Muster wie beim Hype-Radar.
        const leser = antwort.body.getReader()
        const dekoder = new TextDecoder()
        let puffer = ''
        while (true) {
            const { done, value } = await leser.read()
            if (done) break
            puffer += dekoder.decode(value, { stream: true })
            const zl = puffer.split('\n')
            puffer = zl.pop() || ''
            for (const z of zl) {
                if (!z.startsWith('data: ')) continue
                let e
                try { e = JSON.parse(z.slice(6)) } catch { continue }
                verarbeite(e)
            }
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            meldung.value = e.message
            meldungFehler.value = true
        }
    } finally {
        laeuft.value = false
        fortschritt.value = null
        strom = null
    }
}

function verarbeite(e) {
    if (e.type === 'fortschritt') { fortschritt.value = e; return }
    if (e.type === 'fehler') {
        meldung.value = e.fehler
        meldungFehler.value = true
        return
    }
    if (e.type !== 'fertig') return

    if (e.abgebrochen) {
        meldung.value = t('coinradar.abgebrochen')
        return
    }
    const ausgefallen = Object.entries(e.quellenStand || {})
        .filter(([, s]) => !s.ok).map(([q]) => q)
    meldung.value = t('coinradar.laufFertig', { n: e.bewertet, v: e.verworfen })
        + (ausgefallen.length ? ' ' + t('coinradar.quellenAusgefallen', { q: ausgefallen.join(', ') }) : '')
    ladeZeilen()
    ladeLaeufe()
}

function laufOeffnen(l) {
    if (l.status !== 'fertig') return
    zeigeHuerden.value = false
    ladeZeilen(l.id)
    reiter.value = 'rangliste'
}

function huerdenUmschalten() {
    zeigeHuerden.value = !zeigeHuerden.value
    offen.value = null
    sortFeld.value = zeigeHuerden.value ? 'umsatz24h' : 'rang'
    sortAb.value = zeigeHuerden.value
    ladeZeilen(lauf.value?.id || 0)
}

onMounted(async () => {
    await Promise.all([ladeZeilen(), ladeEinstellungen(), ladeFavoriten(), ladeLaeufe()])
})

onBeforeUnmount(() => {
    strom?.abort()
    clearTimeout(speicherUhr)
})
</script>

<style scoped>
.cr {
    padding: .5rem 0;
}

.crKopf {
    display: flex;
    align-items: flex-end;
    gap: 1rem;
    flex-wrap: wrap;
}

.crNav {
    flex: 1 1 auto;
    border-bottom: 1px solid rgba(255, 255, 255, .1);
}

.crKnoepfe {
    display: flex;
    align-items: center;
    gap: .5rem;
    padding-bottom: .35rem;
}

.crFortschritt {
    font-size: .897rem;
    color: var(--grey-color, #9aa0a6);
}

.crLeerIcon {
    font-size: 2.76rem;
    opacity: .3;
    display: block;
    margin-bottom: .5rem;
}

/* ── Kennzahlen ─────────────────────────────────────────── */
.crKennzahlen {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: .75rem;
    margin-bottom: 1.25rem;
}

.crZelle {
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border-radius: var(--border-radius, 8px);
    padding: .7rem .85rem;
}

.crZelle.warnung {
    box-shadow: inset 0 0 0 1px rgba(255, 179, 0, .45);
}

.crWert {
    font-size: 1.495rem;
    font-weight: 600;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
}

.crWertKlein {
    font-size: 1.092rem;
    padding-top: .3rem;
}

.crLabel {
    font-size: .874rem;
    color: var(--grey-color, #9aa0a6);
}

.crExtra {
    font-size: .782rem;
    opacity: .6;
    margin-top: .15rem;
}

.crEinheit {
    font-size: .92rem;
    opacity: .6;
    margin-left: .3rem;
}

/* ── KI-Einordnung ──────────────────────────────────────── */
.crEinordnung {
    display: flex;
    align-items: flex-start;
    gap: .3rem;
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border-left: 3px solid var(--blue-color, #4da3ff);
    border-radius: var(--border-radius, 8px);
    padding: .7rem .9rem;
    margin-bottom: 1.1rem;
    font-size: .977rem;
    line-height: 1.5;
}

.crQuelle {
    font-size: .782rem;
    color: var(--grey-color, #9aa0a6);
    display: block;
    margin-top: .3rem;
}

/* ── Filter ─────────────────────────────────────────────── */
.crFilter {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: .4rem;
    margin-bottom: .8rem;
}

.crChip {
    font-size: .828rem;
    padding: .15rem .6rem;
    border-radius: 999px;
    border: 0;
    background: rgba(255, 255, 255, .06);
    color: inherit;
    cursor: pointer;
    user-select: none;
}

.crChip.aktiv {
    background: var(--blue-color, #4da3ff);
    color: #fff;
}

/* ── Tabelle ────────────────────────────────────────────── */
.crTabelle {
    font-size: .943rem;
}

.crTabelle th {
    font-weight: 600;
    color: var(--grey-color, #9aa0a6);
    font-size: .851rem;
    cursor: pointer;
    white-space: nowrap;
}

.crSchmal {
    width: 2.4rem;
}

.crZeile {
    cursor: pointer;
}

.crZeile:hover {
    background: rgba(255, 255, 255, .03);
}

.crZeile.aktiv {
    background: rgba(77, 163, 255, .08);
}

.crZahl {
    font-variant-numeric: tabular-nums;
}

.crStark {
    color: var(--blue-color, #4da3ff);
    font-weight: 600;
}

.crRangZelle {
    color: var(--grey-color, #9aa0a6);
    font-variant-numeric: tabular-nums;
}

.crNote {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.crNote.gut {
    color: var(--green-color, #4caf50);
}

.crNote.mittel {
    color: var(--orange-color, #ffb300);
}

.crNote.schwach {
    color: var(--grey-color, #9aa0a6);
}

.crBadge {
    font-size: .713rem;
    font-weight: 500;
}

.crStern {
    cursor: pointer;
    margin-right: .35rem;
    color: var(--grey-color, #9aa0a6);
    opacity: .45;
    font-size: .977rem;
}

.crStern:hover {
    opacity: 1;
}

.crStern.aktiv {
    color: #ffb300;
    opacity: 1;
}

.crBestaetigt {
    color: var(--green-color, #4caf50);
    font-size: .92rem;
    margin-left: .3rem;
}

/* ── Aufklappen ─────────────────────────────────────────── */
.crDetail {
    background: rgba(255, 255, 255, .02);
}

.crDetailGrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 1.5rem;
    padding: .3rem .2rem;
}

.crDetailTitel {
    font-size: .805rem;
    color: var(--grey-color, #9aa0a6);
    text-transform: uppercase;
    letter-spacing: .04em;
    margin-bottom: .4rem;
}

.crNoteZeile {
    display: flex;
    align-items: center;
    gap: .5rem;
    margin-bottom: .25rem;
}

.crNoteName {
    font-size: .851rem;
    min-width: 5.5rem;
}

.crBalken {
    flex: 1;
    height: 5px;
    border-radius: 3px;
    background: rgba(255, 255, 255, .08);
    overflow: hidden;
}

.crBalken.breit {
    max-width: 12rem;
}

.crBalken i {
    display: block;
    height: 100%;
    background: var(--blue-color, #4da3ff);
}

.crNoteWert {
    font-size: .851rem;
    min-width: 1.8rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.crZeTabelle {
    font-size: .851rem;
    width: 100%;
}

.crZeTabelle th {
    color: var(--grey-color, #9aa0a6);
    font-weight: 500;
    text-align: right;
    padding-right: .5rem;
}

.crZeTabelle td {
    text-align: right;
    padding-right: .5rem;
    font-variant-numeric: tabular-nums;
}

.crZeTabelle td:first-child,
.crZeTabelle th:first-child {
    text-align: left;
}

.crHinweise {
    font-size: .828rem;
    color: var(--orange-color, #ffb300);
}

/* ── Karten am Telefon ──────────────────────────────────── */
.crKarten {
    display: grid;
    gap: .5rem;
}

.crKarte {
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border-radius: var(--border-radius, 8px);
    padding: .6rem .7rem;
    cursor: pointer;
}

.crKarteKopf {
    display: flex;
    align-items: center;
    gap: .1rem;
    font-size: 1.035rem;
}

.crRang {
    font-size: .805rem;
    color: var(--grey-color, #9aa0a6);
    min-width: 1.5rem;
    font-variant-numeric: tabular-nums;
}

.crKarteZeile {
    display: flex;
    flex-wrap: wrap;
    gap: .75rem;
    margin-top: .35rem;
    font-size: .828rem;
    color: var(--grey-color, #9aa0a6);
}

.crPaar b {
    font-weight: 500;
    opacity: .7;
    margin-right: .2rem;
}

.crKarteDetail {
    margin-top: .5rem;
    padding-top: .5rem;
    border-top: 1px solid rgba(255, 255, 255, .07);
}

/* ── Verlauf ────────────────────────────────────────────── */
.crBlock {
    margin-bottom: 1.75rem;
}

.crTitel {
    font-size: 1.092rem;
    font-weight: 600;
    margin-bottom: .15rem;
}

.crHinweis {
    font-size: .897rem;
    color: var(--grey-color, #9aa0a6);
    margin-bottom: .6rem;
}

.crKlein {
    font-size: .782rem;
    opacity: .75;
}

.crDauerListe {
    display: grid;
    gap: .3rem;
}

.crDauer {
    display: flex;
    align-items: center;
    gap: .6rem;
    font-size: .92rem;
}

.crDauerSymbol {
    min-width: 5rem;
    font-weight: 600;
}

.crDauerWert {
    font-size: .851rem;
    color: var(--grey-color, #9aa0a6);
    font-variant-numeric: tabular-nums;
}

/* ── Einstellungen ──────────────────────────────────────── */
.crEinst {
    max-width: 44rem;
}

.crFeld {
    display: flex;
    align-items: center;
    gap: .6rem;
    margin-top: .6rem;
    font-size: .966rem;
}

.crFeld>span:first-child {
    min-width: 12rem;
}

.crZahlFeld {
    width: 7rem;
}

.crRegler {
    display: flex;
    align-items: center;
    gap: .8rem;
    margin-bottom: .3rem;
}

.crReglerName {
    min-width: 8rem;
    font-size: .966rem;
}

.crRegler .form-range {
    flex: 1;
}

.crReglerWert {
    min-width: 2rem;
    text-align: right;
    font-size: .966rem;
    font-variant-numeric: tabular-nums;
}

.crSumme {
    font-size: .897rem;
    color: var(--grey-color, #9aa0a6);
    margin-top: .5rem;
}

.crSumme.warn {
    color: var(--orange-color, #ffb300);
}

/* ── Schmale Fenster ────────────────────────────────────── */
@media (max-width: 767px) {

    /* Der Kopf stapelt: Reiter über den Knöpfen, damit beide voll
       antippbar bleiben statt sich die Zeile zu teilen. */
    .crKopf {
        align-items: stretch;
    }

    .crKnoepfe {
        padding-bottom: 0;
        padding-top: .5rem;
    }

    .crKnoepfe .btn {
        flex: 1;
    }

    .crFeld {
        flex-wrap: wrap;
    }

    .crFeld>span:first-child {
        min-width: 100%;
    }

    .crReglerName {
        min-width: 6rem;
    }
}
</style>
