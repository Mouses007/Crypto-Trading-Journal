<template>
    <div class="cr">
        <!-- ── Kopf ──────────────────────────────────────────────────── -->
        <div class="crKopf">
            <!-- Rangliste und Verlauf stehen als eigene Einträge im
                 Seitenmenü. Was bleibt, sind die Einstellungen — und die
                 verhalten sich wie in den Nachrichten: ein Zahnrad und eine
                 Zeile Klartext. Zugeklappt sieht man, was eingestellt ist,
                 ohne dass ein Formular die Rangliste nach unten schiebt. -->
            <div class="crEinstKopf">
                <button type="button" class="ctl-pill klein" :class="{ active: einstOffen }"
                    :aria-expanded="einstOffen"
                    :title="einstOffen ? t('coinradar.eZu') : t('coinradar.eAuf')"
                    @click="einstUmschalten">
                    <i class="uil" :class="einstOffen ? 'uil-angle-down' : 'uil-setting'"></i>
                </button>
                <span v-if="!einstOffen" class="crEinstZeile" @click="einstUmschalten">
                    {{ einstZusammenfassung }}
                </span>
            </div>
            <div class="crKnoepfe">
                <span v-if="laeuft" class="crFortschritt">{{ fortschrittText }}</span>
                <button type="button" class="ctl-pill accent" :disabled="laeuft" @click="starte">
                    <span v-if="laeuft" class="spinner-border spinner-border-sm me-1"></span>
                    <i v-else class="uil uil-sync me-1"></i>{{ t('coinradar.jetztMessen') }}
                </button>
                <PageInfo section="info.coinRadar" />
            </div>
        </div>

        <!-- ══ Einstellungen ═════════════════════════════════════════ -->
        <div v-if="einstOffen" class="mt-3 crEinst">
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

        <div v-if="meldung" class="alert py-2 small mt-2" :class="meldungFehler ? 'alert-danger' : 'alert-info'">
            {{ meldung }}
        </div>

        <!-- ══ Einzelprüfung ═════════════════════════════════════════
             Die Rangliste misst eine Schnittmenge und siebt sie nach Umsatz.
             Beides ist für eine Liste richtig und für eine Frage falsch: Wer
             ein bestimmtes Symbol im Kopf hat, findet es dort meistens nicht
             — 291 der 790 Bitunix-Perpetuals führt Binance gar nicht, und
             von den übrigen bleibt nach der Umsatzhürde rund ein Fünftel.
             Deshalb hier dasselbe Messwerk auf Zuruf, für ein Symbol. -->
        <div v-show="reiter === 'rangliste'" class="crEinzel mt-3">
            <form class="crEinzelKopf" @submit.prevent="epMessen">
                <i class="uil uil-search crEinzelLupe"></i>
                <!-- Die Eingabetaste ausdrücklich am Feld, nicht nur über die
                     implizite Absendung des Formulars: Letztere hängt am
                     Zeichenereignis und ist damit nicht in jeder Umgebung
                     auslösbar. `.prevent` verhindert, dass beide Wege denselben
                     Abruf zweimal starten. -->
                <input v-model="epEingabe" type="text" class="crEinzelFeld"
                    :placeholder="t('coinradar.epPlatzhalter')" :disabled="epLaeuft"
                    spellcheck="false" autocomplete="off"
                    @keydown.enter.prevent="epMessen">
                <button type="submit" class="ctl-pill accent" :disabled="epLaeuft || !epEingabe.trim()">
                    <span v-if="epLaeuft" class="spinner-border spinner-border-sm me-1"></span>
                    <i v-else class="uil uil-search-alt me-1"></i>{{ t('coinradar.epMessen') }}
                </button>
                <button v-if="ep || epFehler" type="button" class="ctl-pill klein"
                    :title="t('coinradar.epSchliessen')" @click="epZuruecksetzen">
                    <i class="uil uil-times"></i>
                </button>
                <span class="crEinzelWink">{{ t('coinradar.epWink') }}</span>
            </form>

            <!-- Nicht gefunden. Ein blosses „unbekannt" ist bei Meme-Tickern
                 die nutzloseste Antwort — deshalb Vorschläge zum Anklicken. -->
            <div v-if="epFehler" class="crEinzelFehler">
                <div>{{ epFehler }}</div>
                <div v-if="epVorschlaege.length" class="crEinzelChips">
                    <span class="crEinzelChipsTitel">{{ t('coinradar.epMeintest') }}</span>
                    <button v-for="v in epVorschlaege" :key="v" type="button"
                        class="crEinzelChip" @click="epNimm(v)">{{ kurz(v) }}</button>
                </div>
            </div>

            <div v-if="ep" class="crEinzelKarte">
                <!-- Kopf: Symbol, Note, Preis — und woher gemessen wurde -->
                <div class="crEinzelTitel">
                    <span class="crEinzelSymbol">{{ kurz(ep.symbol) }}</span>
                    <span v-if="ep.status === 'bewertet'" class="crNote" :class="noteKlasse(ep.note)">
                        {{ ep.note }}
                    </span>
                    <span class="crEinzelPreis">{{ epPreis }}</span>
                    <span class="ms-auto crEinzelQuelle" :class="{ fremd: !ep.vergleichbar }"
                        :title="ep.vergleichbar ? t('coinradar.epQuelleBinanceHilfe') : t('coinradar.epQuelleBitunixHilfe')">
                        {{ ep.vergleichbar ? t('coinradar.epQuelleBinance') : t('coinradar.epQuelleBitunix') }}
                    </span>
                </div>

                <!-- Was an dieser Messung anders ist als in der Rangliste.
                     Steht oben und nicht im Kleingedruckten: Eine Note, die
                     auf einer anderen Börse entstand, darf nicht wie eine
                     Ranglistenzeile gelesen werden. -->
                <p v-if="!ep.vergleichbar" class="crEinzelVermerk">
                    {{ t('coinradar.epNichtVergleichbar') }}
                </p>
                <p v-if="ep.ergaenzt" class="crEinzelVermerk leise">
                    {{ t('coinradar.epErgaenzt', { s: ep.symbol }) }}
                </p>
                <p v-if="!ep.aufBitunix" class="crEinzelVermerk warn">
                    {{ t('coinradar.epNichtAufBitunix') }}
                </p>

                <!-- Die Hürden gelten, aber sie brechen hier nichts ab. -->
                <p v-if="ep.huerde && !ep.huerde.ok" class="crEinzelVermerk warn">
                    {{ t('coinradar.epHuerdeGerissen', { g: grundText(ep.huerde.grund) }) }}
                </p>

                <!-- Zu jung für eine Bewertung: Klartext statt einer Note aus
                     zu wenigen Kerzen. -->
                <div v-if="ep.status !== 'bewertet'" class="crEinzelLeer">
                    <i class="uil uil-hourglass"></i>
                    <div>
                        <div>{{ t('coinradar.epZuJung', { n: ep.kerzenAnzahl, ze: ep.haupt, min: ep.mindestKerzen }) }}</div>
                        <div class="crHinweise">{{ t('coinradar.epZuJungHinweis') }}</div>
                    </div>
                </div>

                <template v-else>
                    <!-- Kennzahlenband -->
                    <div class="crEinzelBand">
                        <div class="crEinzelWert">
                            <div class="crEinzelZahl">{{ n(epHaupt.atrPct, 2) }}<span class="crEinheit"> %</span></div>
                            <div class="crLabel">ATR {{ ep.haupt }}</div>
                        </div>
                        <div class="crEinzelWert">
                            <div class="crEinzelZahl">{{ n(epHaupt.rvol, 2) }}</div>
                            <div class="crLabel">RVOL</div>
                        </div>
                        <div class="crEinzelWert">
                            <div class="crEinzelZahl">{{ n(epHaupt.adx, 0) }}</div>
                            <div class="crLabel">ADX</div>
                        </div>
                        <div class="crEinzelWert">
                            <div class="crEinzelZahl">{{ geld(ep.umsatz24h) }}</div>
                            <div class="crLabel">{{ t('coinradar.epUmsatz') }}</div>
                        </div>
                        <div class="crEinzelWert">
                            <div class="crEinzelZahl">{{ n(ep.spreadBp, 2) }}<span class="crEinheit"> bp</span></div>
                            <div class="crLabel">{{ t('coinradar.spalteSpread') }}</div>
                        </div>
                        <div class="crEinzelWert">
                            <div class="crEinzelZahl" :class="fundingKlasse(ep.fundingJahresRate)">
                                {{ n(ep.fundingJahresRate, 1) }}<span class="crEinheit"> %</span>
                            </div>
                            <div class="crLabel">
                                {{ t('coinradar.spalteFunding') }}
                                <span v-if="ep.fundingIntervallH" class="crEinzelTakt">{{ ep.fundingIntervallH }}h</span>
                            </div>
                        </div>
                    </div>

                    <!-- Ab hier dieselbe Aufteilung wie im aufgeklappten
                         Ranglisteneintrag — dieselben Zahlen, dieselbe
                         Anordnung, damit nichts zweimal gelernt werden muss. -->
                    <div class="crDetailGrid">
                        <div>
                            <div class="crDetailTitel">{{ t('coinradar.teilnoten') }}</div>
                            <div v-for="(wert, feld) in ep.teilnoten" :key="feld" class="crNoteZeile">
                                <span class="crNoteName">{{ t('coinradar.note_' + feld) }}</span>
                                <span class="crBalken"><i :style="{ width: Math.round(wert) + '%' }"></i></span>
                                <span class="crNoteWert">{{ Math.round(wert) }}</span>
                            </div>
                            <p v-if="ep.hinweise?.length" class="crHinweise mb-0 mt-2">
                                {{ ep.hinweise.join(' · ') }}
                            </p>
                        </div>

                        <div>
                            <div class="crDetailTitel">{{ t('coinradar.jeZeiteinheit') }}</div>
                            <table class="crZeTabelle">
                                <tr>
                                    <th></th><th>ATR %</th><th>RVOL</th><th>ADX</th><th>{{ t('coinradar.kerzen') }}</th>
                                </tr>
                                <tr v-for="(m, ze) in ep.jeZeiteinheit" :key="ze">
                                    <td><b>{{ ze }}</b></td>
                                    <td>{{ n(m.atrPct, 2) }}</td>
                                    <td>{{ n(m.rvol, 2) }}</td>
                                    <td>{{ n(m.adx, 0) }}</td>
                                    <td>{{ m.kerzen }}</td>
                                </tr>
                            </table>
                        </div>

                        <div v-if="Object.keys(epBoersen).length">
                            <div class="crDetailTitel">{{ t('coinradar.ausfuehrung5k') }}</div>
                            <table class="crZeTabelle">
                                <tr>
                                    <th></th>
                                    <th>{{ t('coinradar.spKauf') }}</th>
                                    <th>{{ t('coinradar.spVerkauf') }}</th>
                                    <th>{{ t('coinradar.spRund') }}</th>
                                    <th>{{ t('coinradar.spTiefe25') }}</th>
                                </tr>
                                <tr v-for="(v, b) in epBoersen" :key="b"
                                    :class="{ crBeste: b === ep.ausfuehrung?.beste?.boerse }">
                                    <td :title="boerseName(b)"><b>{{ boerseKurz(b) }}</b></td>
                                    <td>{{ n(v.slippageKaufBp, 1) }}</td>
                                    <td>{{ n(v.slippageVerkaufBp, 1) }}</td>
                                    <td>{{ n(v.rundlaufBp, 1) }}</td>
                                    <td>{{ geld(v.tiefe25Bp) }}</td>
                                </tr>
                            </table>
                            <p class="crHinweise mb-0 mt-2">
                                <template v-for="(v, b) in epBoersen" :key="b + 'p'">
                                    <span v-if="!v.passt5k" class="d-block">
                                        {{ t('coinradar.passtNicht', { b: boerseName(b) }) }}
                                    </span>
                                </template>
                            </p>
                        </div>

                        <div>
                            <div class="crDetailTitel">
                                {{ t('coinradar.btcTitel', { ze: ep.btc?.zeiteinheit || konst.btcZeiteinheit }) }}
                                <i class="uil uil-info-circle crInfoWink"
                                    :title="t('coinradar.btcNichtInNote')"></i>
                            </div>
                            <table v-if="ep.btc" class="crZeTabelle">
                                <tr>
                                    <td>{{ t('coinradar.btcKopplung') }}</td>
                                    <td class="text-end">
                                        <b>{{ Math.round(ep.btc.korrelation * 100) }} %</b>
                                        <span class="crHinweisWort">
                                            {{ t('coinradar.kopplung_' + deuteKopplung(epAlsZeile)) }}
                                        </span>
                                    </td>
                                </tr>
                                <tr>
                                    <td>{{ t('coinradar.spalteBeta') }}</td>
                                    <td class="text-end"><b>{{ n(ep.btc.beta, 2) }}</b></td>
                                </tr>
                                <tr>
                                    <td>{{ t('coinradar.btcPunkte') }}</td>
                                    <td class="text-end">{{ ep.btc.punkte }}</td>
                                </tr>
                            </table>
                            <p v-else class="crHinweise mb-0">
                                {{ t('coinradar.epBtc_' + (ep.btcGrund || 'nicht_messbar'), { n: ep.btcKerzen ?? 0 }) }}
                            </p>
                        </div>
                    </div>

                    <!-- Wo der Coin sonst noch liegt. Bei einem Paar, das
                         Binance nicht führt, ist das keine Nebensache: Es ist
                         die Antwort auf „wo kann ich das überhaupt handeln". -->
                    <p v-if="epLinks.length" class="crEinzelListung">
                        <span>{{ t('coinradar.epGelistet') }}</span>
                        <a v-for="e in epLinks" :key="e.boerse" class="crBoerse"
                            :href="boerseUrl(e.boerse, ep.symbol, epChartQuelle)" target="_blank"
                            rel="noopener noreferrer"
                            :title="e.boerse === 'tradingview'
                                ? t('coinradar.epChartOeffnen', { q: epChartQuelle })
                                : t('coinradar.gelistetAuf', { b: BOERSE_LINK_NAME[e.boerse] })">
                            {{ BOERSE_LINK_KURZ[e.boerse] }}
                        </a>
                    </p>
                </template>
            </div>
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
                    <div class="crZelle">
                        <div class="crWert">{{ medianRundlauf }}<span class="crEinheit"> bp</span></div>
                        <div class="crLabel">{{ t('coinradar.kzRundlauf') }}</div>
                        <div class="crExtra">{{ t('coinradar.kzRundlaufExtra') }}</div>
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
                    <!-- Börsenfilter: ODER über die gewählten. Wer Konten bei zwei
                         Börsen hat, will sehen, was er auf EINER davon ausführen
                         kann — die Schnittmenge wäre die seltenere Frage. -->
                    <span class="crChipTrenner"></span>
                    <button v-for="b in BOERSEN" :key="b" class="crChip crChipBoerse"
                        :class="{ aktiv: boersenFilter.has(b) }"
                        :title="t('coinradar.boersenFilterChip', { b: boerseName(b) })"
                        @click="boerseUmschalten(b)">
                        {{ boerseKurz(b) }}
                    </button>
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
                            <!-- role/tabindex/keydown: ein klickbares <i> ist per Tastatur
                                 nicht erreichbar und fuer Screenreader kein Bedienelement. -->
                            <i class="uil crStern" :class="istFav(z) ? 'uil-favorite aktiv' : 'uil-star'"
                                role="button" tabindex="0"
                                :aria-pressed="istFav(z) ? 'true' : 'false'"
                                :title="istFav(z) ? t('coinradar.favEntfernen') : t('coinradar.favHinzu')"
                                @click.stop="favUmschalten(z)"
                                @keydown.enter.stop.prevent="favUmschalten(z)"
                                @keydown.space.stop.prevent="favUmschalten(z)"></i>
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
                        <!-- Am Telefon in eigener Zeile: die Ausführung ist die
                             zweite Aussage und soll nicht zwischen den anderen
                             untergehen. -->
                        <div v-if="z.status === 'bewertet' && z.noteAusfuehrung !== null" class="crKarteZeile">
                            <span class="crPaar">
                                <b>{{ t('coinradar.spalteAusfuehrung') }}</b>
                                <span class="crNote" :class="noteKlasse(z.noteAusfuehrung)">{{ z.noteAusfuehrung }}</span>
                            </span>
                            <span class="crPaar"><b>{{ t('coinradar.spRund') }}</b> {{ n(z.rundlaufBp, 1) }} bp</span>
                            <span v-if="z.besteBoerse" class="crBoerse"
                                :title="t('coinradar.besteBoerseHilfe', { b: boerseName(z.besteBoerse) })">{{ boerseKurz(z.besteBoerse) }}</span>
                        </div>
                        <!-- BTC-Bezug in eigener Zeile, wie die Ausführung: eine
                             dritte Aussage, die zwischen ATR und Funding untergehen
                             würde. -->
                        <div v-if="z.status === 'bewertet' && !ohneWert(z.btcKorrelation)" class="crKarteZeile">
                            <span class="crPaar" :class="kopplungKlasse(z)">
                                <b>BTC</b> {{ btcProzent(z) }} %
                                <i v-if="zerfallen(z)" class="uil uil-exclamation-triangle crWarnZerfall"></i>
                            </span>
                            <span class="crPaar"><b>β</b> {{ n(z.btcBeta, 2) }}</span>
                            <!-- Wie auf dem Desktop klickbar zur Handelsseite — hier ist es
                                 die einzige Stelle am Telefon, wo die Listung überhaupt
                                 steht, deshalb muss der Link auch hierhin. -->
                            <a v-for="e in boersenLinksVon(z)" :key="e.boerse" class="crBoerse"
                                :href="boerseUrl(e.boerse, z.symbol)" target="_blank" rel="noopener noreferrer"
                                :title="t('coinradar.gelistetAuf', { b: BOERSE_LINK_NAME[e.boerse] })"
                                @click.stop>
                                {{ BOERSE_LINK_KURZ[e.boerse] }}
                            </a>
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
                                <!-- Die Rangspalte ist klickbar wie jede andere: Sie ist die
                                     Vorgabe-Sortierung, und ohne Handler kam man nach einem
                                     Ausflug in eine andere Spalte nicht mehr zurück. -->
                                <th class="text-end crSchmal" @click="sortiere('rang')">
                                    #<InfoTipp schluessel="coinradar.spalteRangHilfe" />
                                </th>
                                <th @click="sortiere('symbol')">{{ t('coinradar.spalteSymbol') }}</th>
                                <!-- Drei Achsen stehen nebeneinander und werden nie
                                     verrechnet: „bewegt sich viel", „lässt sich günstig
                                     handeln" und „folgt BTC" sind drei Fragen, deren
                                     Antworten sich oft widersprechen. -->
                                <th class="text-end" @click="sortiere('note')">
                                    {{ t('coinradar.spalteNote') }}<InfoTipp schluessel="coinradar.spalteNoteHilfe" />
                                </th>
                                <th class="text-end" @click="sortiere('noteAusfuehrung')">
                                    {{ t('coinradar.spalteAusfuehrung') }}<InfoTipp schluessel="coinradar.spalteAusfuehrungHilfe" />
                                </th>
                                <th class="text-end" @click="sortiere('atrPct')">
                                    {{ t('coinradar.spalteAtr') }}<InfoTipp schluessel="coinradar.spalteAtrHilfe" />
                                </th>
                                <th class="text-end" @click="sortiere('rvol')">
                                    {{ t('coinradar.spalteRvol') }}<InfoTipp schluessel="coinradar.spalteRvolHilfe" />
                                </th>
                                <th class="text-end" @click="sortiere('adx')">
                                    {{ t('coinradar.spalteAdx') }}<InfoTipp schluessel="coinradar.spalteAdxHilfe" />
                                </th>
                                <!-- Dritte Achse: hängt der Coin an Bitcoin? Beide Spalten
                                     gehen NICHT in die Note ein — „bewegt sich viel",
                                     „lässt sich günstig handeln" und „folgt BTC" sind drei
                                     Fragen, und die Antworten widersprechen sich oft. -->
                                <th class="text-end" @click="sortiere('btcKorrelation')">
                                    {{ t('coinradar.spalteBtc') }}<InfoTipp schluessel="coinradar.spalteBtcHilfe" />
                                </th>
                                <th class="text-end" @click="sortiere('btcBeta')">
                                    {{ t('coinradar.spalteBeta') }}<InfoTipp schluessel="coinradar.spalteBetaHilfe" />
                                </th>
                                <!-- Rundlauf statt Spread: Der Spread ist darin enthalten,
                                     aber allein sagt er nichts über eine Order, die tiefer
                                     ins Buch greift. -->
                                <th class="text-end" @click="sortiere('rundlaufBp')">
                                    {{ t('coinradar.spalteRundlauf') }}<InfoTipp schluessel="coinradar.spalteRundlaufHilfe" />
                                </th>
                                <th class="text-end" @click="sortiere('fundingJahresRate')">
                                    {{ t('coinradar.spalteFunding') }}<InfoTipp schluessel="coinradar.spalteFundingHilfe" />
                                </th>
                                <th class="text-end" @click="sortiere('umsatz24h')">
                                    {{ t('coinradar.spalteUmsatz') }}<InfoTipp schluessel="coinradar.spalteUmsatzHilfe" />
                                </th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <template v-for="z in gefiltert" :key="z.id">
                                <tr v-if="zeigeHuerden" class="crZeile">
                                    <td></td>
                                    <td>
                                        <i class="uil crStern" :class="istFav(z) ? 'uil-favorite aktiv' : 'uil-star'"
                                            role="button" tabindex="0"
                                            :aria-pressed="istFav(z) ? 'true' : 'false'"
                                            :title="istFav(z) ? t('coinradar.favEntfernen') : t('coinradar.favHinzu')"
                                            @click.stop="favUmschalten(z)"
                                            @keydown.enter.stop.prevent="favUmschalten(z)"
                                            @keydown.space.stop.prevent="favUmschalten(z)"></i>
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
                                            role="button" tabindex="0"
                                            :aria-pressed="istFav(z) ? 'true' : 'false'"
                                            :title="istFav(z) ? t('coinradar.favEntfernen') : t('coinradar.favHinzu')"
                                            @click.stop="favUmschalten(z)"
                                            @keydown.enter.stop.prevent="favUmschalten(z)"
                                            @keydown.space.stop.prevent="favUmschalten(z)"></i>
                                        <strong>{{ kurz(z.symbol) }}</strong>
                                        <span v-if="bestaetigt(z)" class="crBestaetigt"
                                            :title="t('coinradar.bestaetigtHilfe')"><i class="uil uil-check-circle"></i></span>
                                        <!-- Wo es den Coin überhaupt gibt. Leise gesetzt: eine
                                             Randnotiz, bis jemand danach filtert. Klickbar direkt
                                             auf die Handelsseite der jeweiligen Börse. -->
                                        <a v-for="e in boersenLinksVon(z)" :key="e.boerse" class="crBoersePunkt"
                                            :href="boerseUrl(e.boerse, z.symbol)" target="_blank" rel="noopener noreferrer"
                                            :title="t('coinradar.gelistetAuf', { b: BOERSE_LINK_NAME[e.boerse] })"
                                            @click.stop>
                                            {{ BOERSE_LINK_KURZ[e.boerse] }}
                                        </a>
                                        <span v-if="boersenUnbekannt(z).length" class="crBoersePunkt crUnbekannt"
                                            :title="t('coinradar.listungUnbekannt', { b: boersenUnbekannt(z).map(boerseName).join(', ') })">?</span>
                                    </td>
                                    <td class="text-end">
                                        <span class="crNote" :class="noteKlasse(z.note)">{{ z.note }}</span>
                                    </td>
                                    <td class="text-end">
                                        <span v-if="z.noteAusfuehrung !== null" class="crNote"
                                            :class="noteKlasse(z.noteAusfuehrung)">{{ z.noteAusfuehrung }}</span>
                                        <span v-else class="text-muted">—</span>
                                        <!-- Wo es günstiger ist. Die Unterschiede sind gross
                                             genug, dass die Börse an die Zeile gehört und
                                             nicht ins Aufklappen. -->
                                        <span v-if="z.besteBoerse" class="crBoerse"
                                            :title="t('coinradar.besteBoerseHilfe', { b: boerseName(z.besteBoerse) })">{{ boerseKurz(z.besteBoerse) }}</span>
                                    </td>
                                    <td class="text-end crZahl">{{ n(z.atrPct, 2) }}</td>
                                    <td class="text-end crZahl" :class="{ 'crStark': istImSpiel(z) }">{{ n(z.rvol, 2) }}</td>
                                    <td class="text-end crZahl" :class="{ 'crStark': istTrendend(z) }">{{ n(z.adx, 0) }}</td>
                                    <td class="text-end crZahl" :class="kopplungKlasse(z)">
                                        {{ btcProzent(z) }}<span v-if="!ohneWert(z.btcKorrelation)"> %</span>
                                        <!-- Der Gleichlauf ist im Zeitraum zerbrochen: Die
                                             Zahl links stimmt als Durchschnitt und taugt
                                             trotzdem nicht als Grundlage. -->
                                        <i v-if="zerfallen(z)" class="uil uil-exclamation-triangle crWarnZerfall"
                                            :title="t('coinradar.zerfallHilfe', {
                                                a: Math.round(z.btcKorrelationH1 * 100),
                                                b: Math.round(z.btcKorrelationH2 * 100) })"></i>
                                    </td>
                                    <td class="text-end crZahl">{{ n(z.btcBeta, 2) }}</td>
                                    <td class="text-end crZahl" :class="rundlaufKlasse(z.rundlaufBp)">{{ n(z.rundlaufBp, 1) }}</td>
                                    <td class="text-end crZahl" :class="fundingKlasse(z.fundingJahresRate)">
                                        {{ n(z.fundingJahresRate, 1) }}
                                    </td>
                                    <td class="text-end crZahl">{{ mio(z.umsatz24h) }}</td>
                                    <td class="text-end">
                                        <i class="uil" :class="offen === z.id ? 'uil-angle-up' : 'uil-angle-down'"></i>
                                    </td>
                                </tr>
                                <tr v-if="offen === z.id && !zeigeHuerden" :key="z.id + '-d'">
                                    <td colspan="13" class="crDetail">
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
                                            <!-- Was eine Order über 5 000 USD wirklich kostet, je
                                                 Börse. Kauf und Verkauf getrennt: Ein Buch, das den
                                                 Einstieg billig und den Ausstieg teuer macht, ist
                                                 eine Falle, die kein Durchschnitt zeigt. -->
                                            <div v-if="Object.keys(jeBoerse(z)).length">
                                                <div class="crDetailTitel">{{ t('coinradar.ausfuehrung5k') }}</div>
                                                <table class="crZeTabelle">
                                                    <tr>
                                                        <th></th>
                                                        <th>{{ t('coinradar.spKauf') }}</th>
                                                        <th>{{ t('coinradar.spVerkauf') }}</th>
                                                        <th>{{ t('coinradar.spRund') }}</th>
                                                        <th>{{ t('coinradar.spTiefe25') }}</th>
                                                    </tr>
                                                    <tr v-for="(v, b) in jeBoerse(z)" :key="b"
                                                        :class="{ crBeste: b === z.besteBoerse }">
                                                        <td :title="boerseName(b)"><b>{{ boerseKurz(b) }}</b></td>
                                                        <td>{{ n(v.slippageKaufBp, 1) }}</td>
                                                        <td>{{ n(v.slippageVerkaufBp, 1) }}</td>
                                                        <td>{{ n(v.rundlaufBp, 1) }}</td>
                                                        <td>{{ geld(v.tiefe25Bp) }}</td>
                                                    </tr>
                                                </table>
                                                <p class="crHinweise mb-0 mt-2">
                                                    <template v-for="(v, b) in jeBoerse(z)" :key="b + 'p'">
                                                        <span v-if="!v.passt5k" class="d-block">
                                                            {{ t('coinradar.passtNicht', { b: boerseName(b) }) }}
                                                        </span>
                                                    </template>
                                                </p>
                                            </div>
                                            <!-- Die dritte Achse ausgeschrieben. Hier steht
                                                 auch, wie viele Renditen dahinterstehen:
                                                 „30 Tage" bei einem Coin, der seit zehn
                                                 Tagen gelistet ist, wäre eine Behauptung. -->
                                            <div v-if="!ohneWert(z.btcKorrelation)">
                                                <div class="crDetailTitel">
                                                    {{ t('coinradar.btcTitel', { ze: konst.btcZeiteinheit }) }}
                                                    <!-- Der Grundsatz „geht nicht in die Note ein" gehört
                                                         dazu, aber nicht als Absatz: Er ist immer gleich
                                                         und stünde bei jedem aufgeklappten Coin erneut da.
                                                         Als Zeichen zum Darüberfahren bleibt er greifbar,
                                                         ohne den Platz zu nehmen, den die Zahlen brauchen. -->
                                                    <i class="uil uil-info-circle crInfoWink"
                                                        :title="t('coinradar.btcNichtInNote')"></i>
                                                </div>
                                                <table class="crZeTabelle">
                                                    <tr>
                                                        <td>{{ t('coinradar.btcKopplung') }}</td>
                                                        <td class="text-end">
                                                            <b>{{ btcProzent(z) }} %</b>
                                                            <span class="crHinweisWort">
                                                                {{ t('coinradar.kopplung_' + deuteKopplung(z)) }}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                    <tr>
                                                        <td>{{ t('coinradar.spalteBeta') }}</td>
                                                        <td class="text-end"><b>{{ n(z.btcBeta, 2) }}</b>
                                                            <span class="crHinweisWort">
                                                                {{ t('coinradar.betaSatz', { p: n(z.btcBeta, 2) }) }}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                    <tr>
                                                        <td>{{ t('coinradar.btcErklaert') }}</td>
                                                        <td class="text-end">
                                                            {{ Math.round(z.btcKorrelation * z.btcKorrelation * 100) }} %
                                                        </td>
                                                    </tr>
                                                    <tr v-if="!ohneWert(z.btcKorrelationH1)">
                                                        <td>{{ t('coinradar.btcHaelften') }}</td>
                                                        <td class="text-end" :class="{ crWarnZerfall: zerfallen(z) }">
                                                            {{ Math.round(z.btcKorrelationH1 * 100) }} %
                                                            → {{ Math.round(z.btcKorrelationH2 * 100) }} %
                                                        </td>
                                                    </tr>
                                                    <tr>
                                                        <td>{{ t('coinradar.btcPunkte') }}</td>
                                                        <td class="text-end">{{ z.btcPunkte ?? '—' }}</td>
                                                    </tr>
                                                </table>
                                                <p v-if="zerfallen(z)" class="crHinweise mb-0 mt-2 crWarnZerfall">
                                                    {{ t('coinradar.zerfallSatz') }}
                                                </p>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            </template>
                            <tr v-if="!gefiltert.length">
                                <td :colspan="zeigeHuerden ? 6 : 13" class="text-center text-muted py-3">
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

            <!-- Wer hält sich oben: die Frage, die eine einzelne Rangliste
                 nicht beantworten kann — deshalb vor der Läufe-Tabelle, nicht
                 danach. Wertet über ALLE fertigen Läufe aus, nicht nur die
                 sichtbaren paar: seit der Lauf automatisch alle paar Stunden
                 startet, wäre eine Begrenzung auf die letzten fünf nur noch
                 ein Tagesausschnitt. -->
            <div v-if="dauerhaft.length" class="crBlock mb-4">
                <h6 class="crTitel">{{ t('coinradar.dauerhaftTitel') }}</h6>
                <p class="crHinweis">{{ t('coinradar.dauerhaftHinweis', { n: dauerhaftMoeglich }) }}</p>
                <div class="crDauerLayout" :class="{ mitInfo: coinInfoSymbol }">
                    <div class="crDauerListe">
                        <button v-for="d in dauerhaft" :key="d.symbol" type="button" class="crDauer"
                            :class="{ aktiv: coinInfoSymbol === d.symbol }" @click="coinInfoOeffnen(d.symbol)">
                            <span class="crDauerSymbol">{{ kurz(d.symbol) }}</span>
                            <span class="crBalken breit"><i :style="{ width: d.anteil + '%' }"></i></span>
                            <span class="crDauerWert">{{ d.male }} / {{ d.moeglich }}</span>
                        </button>
                    </div>

                    <!-- Projekt-Infos zum angeklickten Symbol: was ist das,
                         Links zur Website etc. Quelle ist CoinGecko — die
                         hat KEIN strukturiertes "Team"-Feld mehr, deshalb
                         der Hinweis unten statt einer erfundenen Ja/Nein-Zeile. -->
                    <div v-if="coinInfoSymbol" class="crCoinInfo">
                        <button type="button" class="crCoinInfoZu" @click="coinInfoSymbol = ''">
                            <i class="uil uil-times"></i>
                        </button>
                        <div v-if="coinInfoLaedt" class="text-center py-3">
                            <span class="spinner-border spinner-border-sm"></span>
                        </div>
                        <p v-else-if="coinInfoFehler" class="text-muted small mb-0">{{ coinInfoFehler }}</p>
                        <p v-else-if="coinInfo === null" class="text-muted small mb-0">
                            {{ t('coinradar.coinInfoKeineDaten', { symbol: kurz(coinInfoSymbol) }) }}
                        </p>
                        <template v-else-if="coinInfo">
                            <div class="crCoinInfoKopf">
                                <img v-if="coinInfo.bild" :src="coinInfo.bild" alt="" referrerpolicy="no-referrer">
                                <div>
                                    <strong>{{ coinInfo.name }}</strong>
                                    <span v-if="coinInfo.marketCapRang" class="crCoinInfoRang">
                                        {{ t('coinradar.coinInfoRang', { n: coinInfo.marketCapRang }) }}
                                    </span>
                                </div>
                            </div>
                            <div v-if="coinInfo.kategorien.length" class="crCoinInfoTags">
                                <span v-for="k in coinInfo.kategorien.slice(0, 6)" :key="k" class="crCoinInfoTag">{{ k }}</span>
                            </div>
                            <p v-if="coinInfo.beschreibung" class="crCoinInfoText" :class="{ gekuerzt: !coinInfoVoll }">
                                {{ coinInfo.beschreibung }}
                            </p>
                            <button v-if="coinInfo.beschreibung.length > 320" type="button"
                                class="crCoinInfoMehr" @click="coinInfoVoll = !coinInfoVoll">
                                {{ coinInfoVoll ? t('coinradar.coinInfoWeniger') : t('coinradar.coinInfoMehr') }}
                            </button>
                            <!-- homepage/whitepaper/github/explorer kommen roh von CoinGecko.
                                 twitter/telegram/coingeckoUrl werden serverseitig mit festem
                                 https:// zusammengesetzt und sind schemasicher. -->
                            <div class="crCoinInfoLinks">
                                <a v-if="sichereUrl(coinInfo.homepage)" :href="sichereUrl(coinInfo.homepage)" target="_blank" rel="noopener">
                                    <i class="uil uil-globe"></i>{{ t('coinradar.coinInfoWebsite') }}</a>
                                <a v-if="sichereUrl(coinInfo.whitepaper)" :href="sichereUrl(coinInfo.whitepaper)" target="_blank" rel="noopener">
                                    <i class="uil uil-file-alt"></i>Whitepaper</a>
                                <a v-if="coinInfo.twitter" :href="coinInfo.twitter" target="_blank" rel="noopener">
                                    <i class="uil uil-twitter"></i>X</a>
                                <a v-if="coinInfo.telegram" :href="coinInfo.telegram" target="_blank" rel="noopener">
                                    <i class="uil uil-telegram"></i>Telegram</a>
                                <a v-if="sichereUrl(coinInfo.github)" :href="sichereUrl(coinInfo.github)" target="_blank" rel="noopener">
                                    <i class="uil uil-github"></i>GitHub</a>
                                <a v-if="sichereUrl(coinInfo.explorer)" :href="sichereUrl(coinInfo.explorer)" target="_blank" rel="noopener">
                                    <i class="uil uil-search"></i>Explorer</a>
                                <a :href="coinInfo.coingeckoUrl" target="_blank" rel="noopener">
                                    <i class="uil uil-external-link-alt"></i>CoinGecko</a>
                            </div>
                            <p class="crCoinInfoFuss">{{ coinInfoSichtbarkeitText }}</p>
                        </template>
                    </div>
                </div>
            </div>

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
                        <tr v-for="l in sichtbareLaeufe" :key="l.id" class="crZeile"
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

            <!-- Ältere Läufe bleiben eingeklappt: die Liste wächst mit jedem
                 Lauf, gebraucht werden fast immer nur die letzten paar. -->
            <div v-if="laeufe.length > VERLAUF_SICHTBAR" class="text-center">
                <button class="btn btn-sm crMehr" @click="verlaufOffen = !verlaufOffen">
                    <i class="uil" :class="verlaufOffen ? 'uil-angle-up' : 'uil-angle-down'"></i>
                    {{ verlaufOffen ? t('coinradar.verlaufWeniger') : t('coinradar.verlaufMehr', { n: laeufe.length - VERLAUF_SICHTBAR }) }}
                </button>
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
import { sichereUrl } from '../utils/sanitize.js'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import PageInfo from '../components/PageInfo.vue'
import InfoTipp from '../components/InfoTipp.vue'
import { useKostenAnzeige } from '../utils/formatters.js'
import { useIstTelefon } from '../utils/geraet.js'
import { logWarn } from '../utils/logger.js'
import { currentUser } from '../stores/globals.js'
import {
    BOERSE_KURZ as BOERSE_LINK_KURZ, BOERSE_NAME as BOERSE_LINK_NAME,
    boerseUrl, boersenLinksVon as boersenLinksAus,
} from '../utils/boersenLinks.js'

const { t } = useI18n()
const istTelefon = useIstTelefon()

const FILTER = [
    { id: 'alle' }, { id: 'imSpiel' }, { id: 'trendend' }, { id: 'bestaetigt' },
    // Die dritte Achse als Filter: läuft der Coin mit BTC oder eigenständig?
    { id: 'btcMit' }, { id: 'btcEigen' },
]

/**
 * Die Börsen, nach denen gefiltert werden kann.
 *
 * Reihenfolge wie im Haus üblich: Bitunix zuerst, weil dort gehandelt wird.
 * Pionex ist dabei — die Börse führt über sechshundert Perpetuals (gemessen
 * am 21.08.2026); dass sie in der AUSFÜHRUNGSmessung fehlt, liegt am fehlenden
 * geprüften Orderbuch-Zugang und nicht an fehlenden Märkten.
 */
const BOERSEN = ['bitunix', 'bitget', 'pionex']

/**
 * Notnagel, falls der Server (noch) keine Konstanten mitgeschickt hat.
 *
 * Die verbindliche Quelle ist `ANKER` auf dem Server, geliefert unter
 * `konstanten`. Diese Werte hier greifen nur zwischen Seitenaufbau und
 * erster Antwort — vorher standen dieselben Zahlen fest verdrahtet mitten im
 * Filtercode, wo niemand sie neben den Serverwerten sah.
 */
const KONSTANTEN_NOTFALL = {
    rvolSchwelle: 2, adxSchwelle: 25, kopplungFest: 0.7, kopplungLose: 0.3, btcZeiteinheit: '4h',
}
const GEWICHT_FELDER = ['bewegung', 'imSpiel', 'trend', 'kosten']
const ZE_AUSWAHL = ['5m', '15m', '1h', '4h']

/*
 * Welche Ansicht gilt, sagt die Adresse: `/coin-radar` ist die Rangliste,
 * `/coin-radar/verlauf` der Verlauf. Beide teilen sich einen Routen-Eintrag,
 * die Seite wird beim Wechsel also nicht neu aufgebaut — die geladene
 * Rangliste bleibt stehen, ein laufender Lauf ebenfalls.
 */
const route = useRoute()
const router = useRouter()
const reiter = computed(() => (route.params.reiter === 'verlauf' ? 'verlauf' : 'rangliste'))
const laeuft = ref(false)
const fortschritt = ref(null)
const meldung = ref('')
const meldungFehler = ref(false)
const offen = ref(null)
const filter = ref('alle')
const zeigeHuerden = ref(false)
/*
 * Gewählte Börsen. ODER-Verknüpfung: Wer Konten bei zwei Börsen hat, will
 * sehen, was er auf EINER davon ausführen kann — nicht nur die Schnittmenge.
 * Leere Auswahl heisst „alle", nicht „keine".
 */
const boersenFilter = ref(new Set())

const lauf = ref(null)
const zeilen = ref([])
const laeufe = ref([])
/* Wie viele Läufe ohne Aufklappen zu sehen sind. */
const VERLAUF_SICHTBAR = 5
const verlaufOffen = ref(false)
const sichtbareLaeufe = computed(() => (verlaufOffen.value ? laeufe.value : laeufe.value.slice(0, VERLAUF_SICHTBAR)))
const favoriten = ref([])
const einst = ref({
    aktiv: false, intervallStunden: 1, zeiteinheiten: ['1h', '15m'],
    gewichte: { bewegung: 30, imSpiel: 30, trend: 25, kosten: 15 },
    huerden: { minUmsatz24hUsd: 10000000, maxSpreadBp: 5, minTiefeUsd: 0 },
    einordnungAn: true,
})
let strom = null

// ── Anzeige-Helfer ──────────────────────────────────────────────────────
/*
 * `null` heisst unbekannt und muss als Strich erscheinen, nicht als Null.
 *
 * `Number(null)` ist 0 und damit endlich — die alte Fassung zeigte für einen
 * Wert, zu dem gar keine Quelle geantwortet hatte, brav „0.00". Bei Funding
 * las sich das als gemessene Kostenfreiheit, bei Spread als perfekter Markt.
 * Beides das Gegenteil dessen, was der Fall war.
 */
const fehlt = (w) => w === null || w === undefined || w === ''
const n = (w, s = 2) => (!fehlt(w) && Number.isFinite(Number(w)) ? Number(w).toFixed(s) : '—')
/** Nicht vergleichbar — weder gemessen noch als Zahl lesbar. */
const ohneWert = (w) => fehlt(w) || !Number.isFinite(Number(w))

/** Die Schwellen kommen vom Server; siehe `KONSTANTEN_NOTFALL`. */
const konst = computed(() => ({ ...KONSTANTEN_NOTFALL, ...(einst.value.konstanten || {}) }))
const mio = (w) => (!fehlt(w) && Number(w) ? `${(Number(w) / 1e6).toFixed(0)}` : '—')

/**
 * Ein Geldbetrag mit passender Einheit.
 *
 * `mio()` ist für die Umsatzspalte gedacht, wo alles in Millionen liegt. Auf
 * die Orderbuchtiefe angewandt ergab sie „0": ein mittelgrosser Coin hat
 * zwanzig- bis fünfzigtausend Dollar innerhalb von 25 Basispunkten, und
 * 32'714 / 1e6 rundet auf null. Eine Null dort behauptet ein leeres Buch.
 */
function geld(w) {
    if (fehlt(w) || !Number.isFinite(Number(w))) return '—'
    const z = Number(w)
    if (z >= 1e6) return `${(z / 1e6).toFixed(1)} M`
    if (z >= 1e3) return `${(z / 1e3).toFixed(0)} k`
    return String(Math.round(z))
}
/** BTCUSDT liest sich als BTC — das Quotepaar ist bei allen dasselbe. */
const kurz = (s) => String(s || '').replace(/USDT$/, '')

function zeitpunkt(ms) {
    const d = new Date(Number(ms) || 0)
    if (!Number(ms)) return '—'
    return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const noteKlasse = (w) => (w >= 60 ? 'gut' : (w >= 40 ? 'mittel' : 'schwach'))

/** Börsennamen kurz — in einer Tabellenzelle zählt jedes Zeichen. */
const BOERSE_KURZ = { bitunix: 'BX', bitget: 'BG', pionex: 'PX' }
const boerseKurz = (b) => BOERSE_KURZ[b] || b

/*
 * Ausgeschrieben — für alles, was beim Darüberfahren erscheint.
 *
 * Sichtbar bleiben die Kürzel: In einer Zeile mit dreizehn Spalten kostet
 * „Bitunix" den Platz, den die Zahlen brauchen. Aber ein Kürzel, das man erst
 * lernen muss, ist in einem Filter die falsche Sparsamkeit — dort steht der
 * Name deshalb voll da.
 */
const BOERSE_NAME = { bitunix: 'Bitunix', bitget: 'Bitget', pionex: 'Pionex' }
const boerseName = (b) => BOERSE_NAME[b] || b

/**
 * Die Messwerte je Börse, beste zuerst.
 *
 * Sortiert nach Rundlauf, damit die günstigste oben steht — bei zwei Zeilen
 * scheint das übertrieben, aber die Reihenfolge ist die Aussage, und eine
 * dritte Börse würde sie sonst zufällig einsortieren.
 */
function jeBoerse(z) {
    let roh = {}
    try { roh = typeof z.jeBoerse === 'string' ? JSON.parse(z.jeBoerse || '{}') : (z.jeBoerse || {}) } catch { roh = {} }
    return Object.fromEntries(Object.entries(roh)
        .sort((a, b) => (a[1].rundlaufBp ?? 1e9) - (b[1].rundlaufBp ?? 1e9)))
}

/*
 * Der Rundlauf in Farbe. Die Anker stammen aus derselben Messung wie die Note
 * in `ausfuehrung.js`: unter 5 bp ist ausgezeichnet, ab 30 wird es teuer, ab 60
 * geht ein Scalp nicht mehr auf.
 */
const rundlaufKlasse = (w) => {
    const x = Number(w)
    if (!Number.isFinite(x) || fehlt(w)) return ''
    if (x <= 5) return 'crStark'
    if (x >= 30) return 'text-danger'
    if (x >= 15) return 'text-warning'
    return ''
}
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
const imSpielAnzahl = computed(() => bewertete.value.filter(istImSpiel).length)
const trendendAnzahl = computed(() => bewertete.value.filter(istTrendend).length)
/*
 * Der mittlere Rundlauf des Laufs — die Antwort auf „wie teuer ist das Feld
 * heute". Median statt Mittelwert: Ein einzelner Coin mit fünfzig Basispunkten
 * verzerrt einen Schnitt, und die Frage lautet nicht „was kostet der teuerste",
 * sondern „was kostet der typische".
 */
const medianRundlauf = computed(() => {
    const w = bewertete.value.map((z) => z.rundlaufBp)
        .filter((x) => !fehlt(x) && Number.isFinite(Number(x))).map(Number)
        .sort((a, b) => a - b)
    if (!w.length) return '—'
    const m = Math.floor(w.length / 2)
    return (w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2).toFixed(1)
})

const mittelAtr = computed(() => {
    // Fehlwerte RAUS, nicht als 0 mitgemittelt: `Number(null)` ist 0 und
    // besteht `Number.isFinite` — ein Coin ohne Messung hätte den Schnitt
    // nach unten gezogen, als bewegte er sich gar nicht.
    const w = bewertete.value.map((z) => z.atrPct).filter((x) => !fehlt(x) && Number.isFinite(Number(x)))
    return w.length ? (w.reduce((a, b) => a + Number(b), 0) / w.length).toFixed(2) : '—'
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

/**
 * Sortierrichtung beim ERSTEN Klick auf eine Spalte.
 *
 * Bei Kennzahlen ist gross gut, also absteigend. Bei Symbol und Rang nicht:
 * A steht vor Z, und Rang 1 ist der beste — absteigend zu beginnen zeigte dort
 * das Schlechteste zuerst und sähe nach einem Fehler aus.
 */
const AUFSTEIGEND_ZUERST = new Set(['symbol', 'rang'])

function sortiere(feld) {
    if (sortFeld.value === feld) sortAb.value = !sortAb.value
    else { sortFeld.value = feld; sortAb.value = !AUFSTEIGEND_ZUERST.has(feld) }
}

/*
 * Die Schwellenfragen an einer Stelle. `ohneWert` VOR dem Vergleich: Ein
 * `Number(null)` ist 0, und 0 ist kleiner als jede Schwelle — ein ungemessener
 * Coin fiele also stillschweigend in „nein" statt in „unbekannt".
 */
const istImSpiel = (z) => !ohneWert(z.rvol) && Number(z.rvol) >= konst.value.rvolSchwelle
const istTrendend = (z) => !ohneWert(z.adx) && Number(z.adx) >= konst.value.adxSchwelle
const laeuftMitBtc = (z) => !ohneWert(z.btcKorrelation)
    && Number(z.btcKorrelation) >= konst.value.kopplungFest
const istEigenstaendig = (z) => !ohneWert(z.btcKorrelation)
    && Math.abs(Number(z.btcKorrelation)) <= konst.value.kopplungLose

/**
 * Auf welchen Börsen der Coin handelbar ist.
 *
 * `unbekannt` bleibt erhalten und wird NICHT zu „nein": Antwortet eine Börse
 * gerade nicht, ist das kein Beleg dafür, dass sie den Coin nicht führt.
 */
const boersenVon = (z) => (Array.isArray(z.boersen?.liste) ? z.boersen.liste : [])
const boersenUnbekannt = (z) => (Array.isArray(z.boersen?.unbekannt) ? z.boersen.unbekannt : [])
const handelbarAuf = (z, boerse) => boersenVon(z).some((e) => e.boerse === boerse)

/**
 * Verlinkungen, die für diesen Coin tatsächlich angezeigt werden: gelistete
 * Börsen, gefiltert auf das, was in den Einstellungen aktiviert ist, plus
 * TradingView (kein Listungscheck — jeder Coin hier kommt von Binance).
 */
const boersenLinksVon = (z) => boersenLinksAus(z, currentUser.value?.boersenLinks)

/**
 * Trifft der Börsenfilter zu? ODER über die gewählten Börsen.
 *
 * Eine Zeile, deren Listung bei einer GEWÄHLTEN Börse unbekannt ist, bleibt
 * stehen — sonst leert ein Netzaussetzer bei einer Quelle die halbe Liste,
 * und zwar wortlos.
 */
function passtBoersenfilter(z) {
    const gewaehlt = boersenFilter.value
    if (!gewaehlt.size) return true
    for (const b of gewaehlt) {
        if (handelbarAuf(z, b)) return true
        if (boersenUnbekannt(z).includes(b)) return true
    }
    return false
}

const gefiltert = computed(() => {
    let l = zeilen.value
    if (!zeigeHuerden.value) {
        if (filter.value === 'imSpiel') l = l.filter(istImSpiel)
        else if (filter.value === 'trendend') l = l.filter(istTrendend)
        else if (filter.value === 'bestaetigt') l = l.filter(bestaetigt)
        else if (filter.value === 'btcMit') l = l.filter(laeuftMitBtc)
        else if (filter.value === 'btcEigen') l = l.filter(istEigenstaendig)
    }
    l = l.filter(passtBoersenfilter)

    const f = sortFeld.value
    return [...l].sort((a, b) => {
        if (f === 'symbol') {
            const v = String(a.symbol).localeCompare(String(b.symbol))
            return sortAb.value ? -v : v
        }
        /*
         * Fehlwerte ans ENDE, und zwar in beide Richtungen.
         *
         * Vorher stand hier `(Number(a[f]) || 0) - (Number(b[f]) || 0)`.
         * `Number(null)` ist 0, also sortierte ein nie gemessener Coin
         * aufsteigend nach ganz oben — beim Rundlauf sah er damit aus wie der
         * billigste der Liste. Mit der BTC-Korrelation wäre daraus ein Coin
         * geworden, der sich angeblich unabhängig von Bitcoin bewegt, obwohl
         * für ihn nie eine Kerze verglichen wurde.
         */
        const aOhne = ohneWert(a[f])
        const bOhne = ohneWert(b[f])
        if (aOhne && bOhne) return 0
        if (aOhne) return 1
        if (bOhne) return -1
        const v = Number(a[f]) - Number(b[f])
        return sortAb.value ? -v : v
    })
})

/** Korrelation als ganze Prozent — die Nachkommastelle täuscht Genauigkeit vor. */
const btcProzent = (z) => (ohneWert(z.btcKorrelation) ? '—' : Math.round(Number(z.btcKorrelation) * 100))

/**
 * Ist der Gleichlauf im Messzeitraum zerbrochen?
 *
 * Der Server hat das bereits entschieden (Fisher-z gegen 1,96) und liefert
 * das z mit. Hier nur noch die Schwelle, nicht die Rechnung — sonst stünde die
 * Statistik an zwei Orten.
 */
const zerfallen = (z) => !ohneWert(z.btcZerfallZ) && Number(z.btcZerfallZ) > 1.96

/**
 * Die Einordnung in Worten — dieselben Schlüssel wie serverseitig in
 * `btc-vergleich.js`, gebildet aus den Schwellen, die von dort kommen.
 * `unbekannt` ist ein eigener Fall und fällt NICHT mit „eigenständig"
 * zusammen: Ein ungemessener Coin ist nicht nachweislich unabhängig.
 */
function deuteKopplung(z) {
    if (ohneWert(z.btcKorrelation)) return 'unbekannt'
    const r = Number(z.btcKorrelation)
    if (r >= konst.value.kopplungFest) return 'laeuftMit'
    if (r <= -konst.value.kopplungFest) return 'laeuftGegen'
    if (Math.abs(r) <= konst.value.kopplungLose) return 'eigenstaendig'
    return 'teilweise'
}

const kopplungKlasse = (z) => {
    if (ohneWert(z.btcKorrelation)) return ''
    const r = Number(z.btcKorrelation)
    if (r >= konst.value.kopplungFest) return 'crStark'
    if (Math.abs(r) <= konst.value.kopplungLose) return 'crEigen'
    return ''
}

/** Chip an oder aus. Ein Set, damit die Reihenfolge des Anklickens egal ist. */
function boerseUmschalten(b) {
    const neu = new Set(boersenFilter.value)
    if (neu.has(b)) neu.delete(b)
    else neu.add(b)
    boersenFilter.value = neu
}

/*
 * Wer hält sich oben? Gezählt wird, wie oft ein Symbol in den letzten Läufen
 * unter den ersten zehn stand. Interessant ist nicht der beste Lauf, sondern
 * das, was mehrere überstanden hat.
 */
const dauerhaft = ref([])
/** Über wie viele fertige Läufe die Beständigkeit oben gerechnet ist. */
const dauerhaftMoeglich = ref(0)

// ── Coin-Info (Projektdaten zum angeklickten Symbol) ───────────────────────
const coinInfoSymbol = ref('')
const coinInfo = ref(undefined)   // undefined = noch nicht geladen, null = kein Treffer
const coinInfoLaedt = ref(false)
const coinInfoFehler = ref('')
const coinInfoVoll = ref(false)
let coinInfoLauf = 0   // gegen überholende Antworten beim schnellen Umklicken

/*
 * "Team vorhanden" ist bei CoinGecko keine strukturierte Angabe mehr — aber
 * OB ein Projekt öffentliche Kanäle hinterlegt hat, ist selbst ein Hinweis:
 * ein öffentliches GitHub-Repo bedeutet sichtbaren, arbeitenden Code statt
 * einer blossen Behauptung. Gezählt wird aus Feldern, die ohnehin schon da
 * sind — kein zusätzlicher API-Aufruf, kein erfundenes Ja/Nein.
 */
const COIN_INFO_KANAELE = ['homepage', 'whitepaper', 'twitter', 'telegram', 'github']
const coinInfoSichtbarkeitText = computed(() => {
    const c = coinInfo.value
    if (!c) return ''
    const n = COIN_INFO_KANAELE.filter((f) => c[f]).length
    const kanaeleTxt = t('coinradar.coinInfoKanaeleHinweis', { n, gesamt: COIN_INFO_KANAELE.length })
    const githubTxt = t(c.github ? 'coinradar.coinInfoGithubJa' : 'coinradar.coinInfoGithubNein')
    return `${kanaeleTxt} ${githubTxt}`
})

async function coinInfoOeffnen(symbol) {
    if (coinInfoSymbol.value === symbol) { coinInfoSymbol.value = ''; return }
    coinInfoSymbol.value = symbol
    coinInfo.value = undefined
    coinInfoFehler.value = ''
    coinInfoVoll.value = false
    coinInfoLaedt.value = true
    const eigenerLauf = ++coinInfoLauf
    try {
        const { data } = await axios.get('/api/coin-radar/coin-info', { params: { symbol } })
        if (eigenerLauf !== coinInfoLauf) return   // zwischenzeitlich ein anderes Symbol angeklickt
        coinInfo.value = data?.info ?? null
    } catch (e) {
        if (eigenerLauf !== coinInfoLauf) return
        coinInfoFehler.value = e.response?.data?.error || e.message
    } finally {
        if (eigenerLauf === coinInfoLauf) coinInfoLaedt.value = false
    }
}

// ── Einzelprüfung ───────────────────────────────────────────────────────
/*
 * Ein Symbol auf Zuruf messen — die Frage, die die Rangliste konstruktiv nicht
 * beantwortet. Sie zeigt die Schnittmenge aus Bitunix und Binance, nach Umsatz
 * gesiebt; wer ein bestimmtes Paar sucht, findet es dort meistens nicht. Der
 * Server misst dann über Bitunix und schreibt dazu, dass die Zahlen aus einer
 * anderen Quelle stammen (`vergleichbar`).
 */
const epEingabe = ref('')
const epLaeuft = ref(false)
const ep = ref(null)
const epFehler = ref('')
const epVorschlaege = ref([])

/** Die Kennzahlen der Zeiteinheit, welche die Note trägt. */
const epHaupt = computed(() => ep.value?.jeZeiteinheit?.[ep.value.haupt] || {})

/*
 * Der Preis mit so vielen Stellen, wie der Coin braucht. Ein Meme-Coin steht
 * bei 0,0000042 — mit zwei Nachkommastellen wäre er kostenlos, und genau die
 * Coins, für die es diese Prüfung gibt, stehen tief.
 */
const epPreis = computed(() => {
    const w = Number(ep.value?.preis)
    if (!Number.isFinite(w) || w <= 0) return '—'
    const stellen = w >= 100 ? 2 : (w >= 1 ? 4 : (w >= 0.01 ? 5 : 8))
    return w.toFixed(stellen)
})

/** Dieselbe Sortierung (günstigster Rundlauf zuerst) wie in der Rangliste. */
const epBoersen = computed(() => jeBoerse({ jeBoerse: ep.value?.ausfuehrung?.jeBoerse || {} }))

/*
 * Der BTC-Vergleich kommt hier als eigenes Objekt, in der Rangliste als flache
 * Spalten. Statt `deuteKopplung` zu verdoppeln, bekommt es die Form, die die
 * Funktion erwartet — eine zweite Fassung derselben Schwellen ist genau der
 * Fehler, den `KONSTANTEN` auf dem Server abgestellt hat.
 */
const epAlsZeile = computed(() => ({ btcKorrelation: ep.value?.btc?.korrelation ?? null }))

/*
 * Dieselben Links wie in der Rangliste — gelistete Börsen plus TradingView,
 * gefiltert nach der Einstellung `boersenLinks`. `boersenLinksVon` erwartet
 * genau die Form, die der Bericht mitbringt (`boersen.liste`), deshalb keine
 * zweite Umrechnung: Eine eigene Liste hier hätte TradingView weggelassen und
 * die Einstellung ignoriert — beides ist beim ersten Entwurf passiert.
 */
const epLinks = computed(() => (ep.value ? boersenLinksVon(ep.value) : []))

/*
 * Woher TradingView seine Kerzen nehmen soll.
 *
 * Nicht kosmetisch: `BINANCE:CASHCATUSDT.P` gibt es nicht — Binance führt das
 * Paar nicht, und TradingView antwortet mit „This symbol doesn't exist"
 * (live geprüft am 04.09.2026, ebenso dass `BITUNIX:CASHCATUSDT.P` lädt).
 * Der Chart folgt deshalb derselben Quelle wie die Messung.
 */
const epChartQuelle = computed(() => (ep.value?.quelle === 'bitunix' ? 'BITUNIX' : 'BINANCE'))

function epZuruecksetzen() {
    ep.value = null
    epFehler.value = ''
    epVorschlaege.value = []
}

/** Vorschlag angeklickt: übernehmen und sofort messen. */
function epNimm(symbol) {
    epEingabe.value = symbol
    epMessen()
}

async function epMessen() {
    const eingabe = epEingabe.value.trim()
    if (!eingabe || epLaeuft.value) return
    epLaeuft.value = true
    epFehler.value = ''
    epVorschlaege.value = []
    try {
        const r = await axios.get('/api/coin-radar/einzel', { params: { symbol: eingabe } })
        const b = r.data?.bericht
        if (!b?.gefunden) {
            ep.value = null
            epVorschlaege.value = b?.vorschlaege || []
            /*
             * Der Grund wird übersetzt, nicht durchgereicht: `unbekannt`,
             * `leer` und `zu_lang` sind Schlüssel des Servers und für sich
             * keine Meldung.
             */
            epFehler.value = t('coinradar.epFehler_' + (b?.fehler || 'unbekannt'), { s: b?.symbol || eingabe })
            return
        }
        ep.value = b
    } catch (e) {
        ep.value = null
        epFehler.value = e.response?.data?.error || e.message
    } finally {
        epLaeuft.value = false
    }
}

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
    // Server rechnet über ALLE fertigen Läufe in einer Abfrage — Vorgänger
    // holte je Lauf einzeln die Top-10 und zählte im Browser; bei Läufen alle
    // paar Stunden wären das mit der Zeit hunderte parallele Anfragen.
    try {
        const r = await axios.get('/api/coin-radar/dauerhaft')
        dauerhaft.value = r.data?.dauerhaft || []
        dauerhaftMoeglich.value = r.data?.moeglich || 0
        // Vorbelegt mit dem ersten Coin, statt einer leeren Fläche —
        // nur beim allerersten Laden, damit ein erneuter Aufruf (z.B. nach
        // einem frischen Lauf) nicht die eigene Auswahl des Lesers verwirft.
        if (dauerhaft.value.length && !coinInfoSymbol.value) {
            coinInfoOeffnen(dauerhaft.value[0].symbol)
        }
    } catch (e) {
        logWarn('coin-radar', 'Beständigkeit konnte nicht geladen werden', e)
        dauerhaft.value = []
        dauerhaftMoeglich.value = 0
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
/*
 * Auf- und zugeklappt wie die Schnell-Einstellungen der Nachrichten. Der
 * Zustand gehört zum Gerät und nicht in die Datenbank, deshalb localStorage.
 */
const einstOffen = ref(localStorage.getItem('crEinstOffen') === '1')

function einstUmschalten() {
    einstOffen.value = !einstOffen.value
    localStorage.setItem('crEinstOffen', einstOffen.value ? '1' : '0')
}

/**
 * Die Einstellungen als ein Satz — „alle 1 h · ab 10 Mio USD · max 5 bp · …".
 *
 * Zugeklappt ist das die einzige Auskunft darüber, wonach gemessen wurde;
 * deshalb stehen hier die Hürden und nicht die Gewichte: eine Hürde entscheidet,
 * ob ein Coin überhaupt in der Liste auftaucht.
 */
const einstZusammenfassung = computed(() => {
    const e = einst.value || {}
    const h = e.huerden || {}
    const teile = [
        e.aktiv ? t('coinradar.eZAlle', { n: e.intervallStunden || 1 }) : t('coinradar.eZManuell'),
        t('coinradar.eZUmsatz', { n: Math.round((Number(h.minUmsatz24hUsd) || 0) / 1e6) }),
        t('coinradar.eZSpread', { n: n(h.maxSpreadBp, 1) }),
        (e.zeiteinheiten || []).join(' + ') || '—',
        e.einordnungAn ? t('coinradar.eZEinordnung') : t('coinradar.eZOhne'),
    ]
    return teile.join(' · ')
})

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
    if (f.schritt === 'ausfuehrung') return t('coinradar.fAusfuehrung', { n: f.fertig ?? 0, g: f.gesamt ?? 0 })
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
    if (reiter.value !== 'rangliste') router.push('/coin-radar')
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

/* Zahnrad + Klartextzeile stehen da, wo vorher die Reiter standen. */
.crEinstKopf {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: .5rem;
    padding-bottom: .35rem;
}

.crEinstZeile {
    font-size: .76rem;
    color: var(--white-60, rgba(255, 255, 255, .6));
    cursor: pointer;
}

.crEinstZeile:hover {
    color: var(--white-87);
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

/* Börsen-Chips setzen sich ab: sie schliessen anders aus als die Filter
   links davon — nicht „welche Coins", sondern „wo handelbar". */
.crChipTrenner {
    width: 1px;
    align-self: stretch;
    margin: .1rem .25rem;
    background: rgba(255, 255, 255, .12);
}

.crChipBoerse {
    font-variant-numeric: tabular-nums;
    letter-spacing: .02em;
}

/* ── Dritte Achse: BTC ──────────────────────────────────── */
.crEigen {
    color: var(--grey-color, #9aa0a6);
}

/* Der Gleichlauf ist im Zeitraum zerbrochen. Warnfarbe, weil die
   Durchschnittszahl daneben für sich genommen richtig aussieht. */
.crWarnZerfall {
    color: #e0a33e;
}

/* Unaufdringlich: Das Zeichen erklärt einen Grundsatz, es meldet nichts. */
.crInfoWink {
    margin-left: .35rem;
    color: var(--grey-color, #9aa0a6);
    cursor: help;
    font-size: .9em;
}

.crHinweisWort {
    margin-left: .4rem;
    color: var(--grey-color, #9aa0a6);
    font-weight: 400;
}

/* Leise Marke am Symbol: wo es den Coin gibt. Kleiner als die
   Ausführungsbörse daneben — das ist eine Randnotiz, keine Messung.
   Als Link zur Handelsseite ohne den Look eines Links: nur der Hover
   zeigt, dass sich dahinter etwas anklicken lässt. */
.crBoersePunkt {
    display: inline-block;
    margin-left: .25rem;
    padding: 0 .22rem;
    border-radius: 3px;
    background: rgba(255, 255, 255, .05);
    color: var(--grey-color, #9aa0a6);
    font-size: .68rem;
    vertical-align: middle;
    text-decoration: none;
}

a.crBoersePunkt:hover {
    background: var(--blue-color, #4da3ff);
    color: #fff;
}

.crBoersePunkt.crUnbekannt {
    background: transparent;
    border: 1px dashed rgba(255, 255, 255, .2);
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

.crBoerse {
    display: inline-block;
    margin-left: .35rem;
    padding: 0 .3rem;
    border-radius: 3px;
    background: rgba(255, 255, 255, .08);
    color: var(--grey-color, #9aa0a6);
    font-size: .69rem;
    letter-spacing: .03em;
    text-decoration: none;
}

/* Als Link grösserer Tastbereich als der reine Text hergibt — auf einem
   echten Finger, nicht nur der Maus, geht sonst der Tipp am Badge vorbei
   und trifft die Karte dahinter statt des Links. */
a.crBoerse {
    padding: .3rem .4rem;
    margin: -.3rem -.05rem;
}

a.crBoerse:hover, a.crBoerse:active {
    background: var(--blue-color, #4da3ff);
    color: #fff;
}

.crZeTabelle tr.crBeste {
    color: var(--green-color, #4caf50);
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
    padding: .2rem .5rem .2rem 0;
    font-variant-numeric: tabular-nums;
}

.crZeTabelle td:first-child,
.crZeTabelle th:first-child {
    text-align: left;
    padding-left: .4rem;
}

.crZeTabelle tr:nth-child(even) {
    background: rgba(255, 255, 255, .035);
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

.crMehr {
    color: var(--grey-color, #9aa0a6);
    font-size: .85rem;
    border: 1px solid var(--black-bg-soft, #2a2a2a);
    border-radius: var(--border-radius, 6px);
    padding: .25rem .8rem;
}

.crMehr:hover {
    color: var(--white-color, #e8eaed);
    border-color: var(--blue-color, #4f8bff);
}

.crKlein {
    font-size: .782rem;
    opacity: .75;
}

/* Liste links, Projekt-Infos rechts — nur wenn ein Symbol angeklickt ist.
   Auf schmalem Schirm untereinander statt nebeneinander. */
.crDauerLayout {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    align-items: start;
}

@media (min-width: 700px) {
    .crDauerLayout.mitInfo {
        grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    }
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
    /* Reset gegenüber dem Standard-<button> — sieht sonst wie ein Formularfeld aus */
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--border-radius, 6px);
    padding: .2rem .4rem;
    margin: -.2rem -.4rem;
    text-align: left;
    color: inherit;
    cursor: pointer;
    width: 100%;
}

.crDauer:hover {
    background: rgba(255, 255, 255, .04);
}

.crDauer.aktiv {
    background: rgba(79, 139, 255, .1);
    border-color: var(--blue-color, #4f8bff);
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

/* ── Coin-Info-Feld ─────────────────────────────────────── */
.crCoinInfo {
    position: relative;
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border: 1px solid var(--black-bg-soft, #2a2a2a);
    border-radius: var(--border-radius, 8px);
    padding: .9rem 1rem;
    font-size: .87rem;
}

.crCoinInfoZu {
    position: absolute;
    top: .5rem;
    right: .5rem;
    background: transparent;
    border: 0;
    color: var(--grey-color, #9aa0a6);
    cursor: pointer;
    padding: .2rem;
}

.crCoinInfoZu:hover {
    color: var(--white-color, #e8eaed);
}

.crCoinInfoKopf {
    display: flex;
    align-items: center;
    gap: .6rem;
    margin-bottom: .5rem;
    padding-right: 1.5rem;
}

.crCoinInfoKopf img {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    flex-shrink: 0;
}

.crCoinInfoRang {
    display: block;
    font-size: .76rem;
    color: var(--grey-color, #9aa0a6);
}

.crCoinInfoTags {
    display: flex;
    flex-wrap: wrap;
    gap: .3rem;
    margin-bottom: .6rem;
}

.crCoinInfoTag {
    font-size: .68rem;
    padding: .1rem .45rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, .06);
    color: var(--grey-color, #9aa0a6);
}

.crCoinInfoText {
    line-height: 1.5;
    margin-bottom: .3rem;
    white-space: pre-line;
}

.crCoinInfoText.gekuerzt {
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.crCoinInfoMehr {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--blue-color, #4f8bff);
    font-size: .8rem;
    cursor: pointer;
    margin-bottom: .6rem;
}

.crCoinInfoLinks {
    display: flex;
    flex-wrap: wrap;
    gap: .4rem;
    margin-bottom: .6rem;
}

.crCoinInfoLinks a {
    display: inline-flex;
    align-items: center;
    gap: .3rem;
    font-size: .78rem;
    padding: .2rem .55rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, .06);
    color: var(--white-70, rgba(255, 255, 255, .7));
    text-decoration: none;
}

.crCoinInfoLinks a:hover {
    background: var(--blue-color, #4f8bff);
    color: #fff;
}

.crCoinInfoFuss {
    font-size: .72rem;
    color: var(--grey-color, #9aa0a6);
    margin: .4rem 0 0;
    line-height: 1.4;
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
/* ── Einzelprüfung ──────────────────────────────────────────────────────
   Bewusst als abgesetzte Karte über der Rangliste und nicht als weiterer
   Filter darin: Es ist eine andere Frage („was ist mit DIESEM Coin") und ein
   anderer Datenstand — die Karte kann aus einer anderen Quelle stammen als
   die Tabelle darunter. Zwei Fragen, zwei Flächen. */
.crEinzel {
    margin-bottom: 1rem;
}

.crEinzelKopf {
    display: flex;
    align-items: center;
    gap: .5rem;
    flex-wrap: wrap;
    background: var(--black-bg-soft, rgba(255, 255, 255, .03));
    border: 1px solid var(--grey-color, rgba(255, 255, 255, .12));
    border-radius: var(--border-radius, 8px);
    padding: .5rem .75rem;
}

.crEinzelLupe {
    opacity: .6;
    font-size: 1.1rem;
}

.crEinzelFeld {
    flex: 1 1 12rem;
    min-width: 0;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--grey-color, rgba(255, 255, 255, .18));
    color: inherit;
    padding: .25rem .25rem;
    font-size: .9rem;
    text-transform: uppercase;
}

.crEinzelFeld:focus {
    outline: none;
    border-bottom-color: var(--blue-color, #4a9eff);
}

.crEinzelFeld::placeholder {
    text-transform: none;
    opacity: .45;
}

.crEinzelWink {
    flex: 1 1 100%;
    font-size: .72rem;
    opacity: .55;
}

.crEinzelFehler {
    margin-top: .5rem;
    padding: .6rem .75rem;
    border-radius: var(--border-radius, 8px);
    background: rgba(255, 193, 7, .1);
    border: 1px solid rgba(255, 193, 7, .3);
    font-size: .85rem;
}

.crEinzelChips {
    display: flex;
    align-items: center;
    gap: .35rem;
    flex-wrap: wrap;
    margin-top: .5rem;
}

.crEinzelChipsTitel {
    font-size: .75rem;
    opacity: .6;
}

.crEinzelChip {
    background: rgba(255, 255, 255, .06);
    border: 1px solid var(--grey-color, rgba(255, 255, 255, .15));
    border-radius: 999px;
    padding: .1rem .55rem;
    font-size: .75rem;
    color: inherit;
}

.crEinzelChip:hover {
    border-color: var(--blue-color, #4a9eff);
}

.crEinzelKarte {
    margin-top: .5rem;
    padding: .85rem 1rem 1rem;
    border-radius: var(--border-radius, 8px);
    background: var(--black-bg-soft, rgba(255, 255, 255, .03));
    border: 1px solid var(--grey-color, rgba(255, 255, 255, .12));
}

.crEinzelTitel {
    display: flex;
    align-items: center;
    gap: .6rem;
    flex-wrap: wrap;
}

.crEinzelSymbol {
    font-size: 1.15rem;
    font-weight: 600;
}

.crEinzelPreis {
    opacity: .75;
    font-variant-numeric: tabular-nums;
}

/* Die Herkunft der Zahlen, nicht als Fussnote. Eine auf Bitunix gemessene
   Note steht neben einer Rangliste aus Binance-Daten — wer das übersieht,
   vergleicht zwei verschiedene Messungen. */
.crEinzelQuelle {
    font-size: .72rem;
    padding: .1rem .5rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, .07);
    opacity: .8;
}

.crEinzelQuelle.fremd {
    background: rgba(255, 193, 7, .15);
    color: #ffc107;
    opacity: 1;
}

.crEinzelVermerk {
    margin: .5rem 0 0;
    font-size: .78rem;
    opacity: .8;
}

.crEinzelVermerk.leise {
    opacity: .55;
}

.crEinzelVermerk.warn {
    color: #ffc107;
    opacity: 1;
}

.crEinzelLeer {
    display: flex;
    align-items: flex-start;
    gap: .6rem;
    margin-top: .75rem;
    font-size: .85rem;
}

.crEinzelLeer i {
    font-size: 1.3rem;
    opacity: .5;
}

.crEinzelBand {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(7rem, 100%), 1fr));
    gap: .5rem;
    margin: .85rem 0;
}

.crEinzelWert {
    text-align: center;
    padding: .4rem .25rem;
    border-radius: var(--border-radius, 8px);
    background: rgba(255, 255, 255, .04);
}

.crEinzelZahl {
    font-size: 1.05rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.crEinzelTakt {
    opacity: .6;
}

.crEinzelListung {
    display: flex;
    align-items: center;
    gap: .35rem;
    flex-wrap: wrap;
    margin: .85rem 0 0;
    font-size: .78rem;
    opacity: .85;
}


@media (max-width: 767px) {
    /* Auf dem Telefon passen Feld und beide Knöpfe nicht in eine Zeile —
       ohne diese Regel bricht der Schliessen-Knopf allein um und steht
       verloren unter dem Suchfeld. Feld über die volle Breite, Knöpfe
       darunter nebeneinander. */
    .crEinzelFeld {
        flex-basis: 100%;
        order: -1;
    }

    .crEinzelLupe {
        display: none;
    }



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
