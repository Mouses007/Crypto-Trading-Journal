<template>
    <div class="hyp">
        <!-- ── Kopf ──────────────────────────────────────────────────── -->
        <div class="hypKopf">
            <!-- Übersicht und Berichte stehen als eigene Einträge im
                 Seitenmenü. Was bleibt, sind die Einstellungen — und die
                 verhalten sich wie in den Nachrichten: ein Zahnrad und eine
                 Zeile Klartext. Zugeklappt sieht man, wonach gesucht wird,
                 ohne dass ein langes Formular die Funde nach unten schiebt. -->
            <div class="hypEinstKopf">
                <button type="button" class="ctl-pill klein" :class="{ active: einstOffen }"
                    :aria-expanded="einstOffen"
                    :title="einstOffen ? t('hype.eZu') : t('hype.eAuf')"
                    @click="einstUmschalten">
                    <i class="uil" :class="einstOffen ? 'uil-angle-down' : 'uil-setting'"></i>
                </button>
                <span v-if="!einstOffen" class="hypEinstZeile" @click="einstUmschalten">
                    {{ einstZusammenfassung }}
                </span>
            </div>
            <div class="hypKnoepfe">
                <span v-if="laeuft" class="hypFortschritt">{{ fortschrittText }}</span>
                <button type="button" class="ctl-pill" :disabled="laeuft" @click="starte(false)">
                    <i class="uil uil-search me-1"></i>{{ t('hype.nurScannen') }}
                </button>
                <button type="button" class="ctl-pill accent" :disabled="laeuft || fehlendeSchluessel.length"
                    :title="fehlendeSchluessel.length ? t('hype.schluesselFehlt', { anbieter: fehlendeSchluessel.join(', ') }) : ''"
                    @click="starte(true)">
                    <span v-if="laeuft" class="spinner-border spinner-border-sm me-1"></span>
                    <i v-else class="uil uil-file-alt me-1"></i>{{ t('hype.scannenUndBericht') }}
                </button>
                <PageInfo section="info.hypeRadar" />
            </div>
        </div>

        <div v-if="meldung" class="alert py-2 small mt-2" :class="meldungFehler ? 'alert-danger' : 'alert-info'">
            {{ meldung }}
        </div>
        <div v-if="fehlendeSchluessel.length" class="alert alert-warning py-2 small mt-2">
            <i class="uil uil-exclamation-triangle me-1"></i>
            {{ t('hype.schluesselFehlt', { anbieter: fehlendeSchluessel.join(', ') }) }}
        </div>

        <!-- ══ Einstellungen ═════════════════════════════════════════ -->
        <div v-if="einstOffen" class="mt-3">
            <div v-if="einst" class="hypEinst">
                <div class="form-check form-switch mb-3">
                    <input id="hypAktiv" class="form-check-input" type="checkbox"
                        v-model="einst.aktiv" @change="speichern">
                    <label class="form-check-label" for="hypAktiv">{{ t('hype.autoAn') }}</label>
                    <div class="hypHinweis">{{ t('hype.autoHinweis') }}</div>
                </div>

                <div class="row g-3 mb-3">
                    <div class="col-auto">
                        <label class="form-label small">{{ t('hype.intervall') }}</label>
                        <select v-model.number="einst.intervallStunden" class="form-select form-select-sm"
                            @change="speichern">
                            <option :value="1">{{ t('hype.stunde1') }}</option>
                            <option :value="3">{{ t('hype.stundeN', { n: 3 }) }}</option>
                            <option :value="6">{{ t('hype.stundeN', { n: 6 }) }}</option>
                            <option :value="12">{{ t('hype.stundeN', { n: 12 }) }}</option>
                            <option :value="24">{{ t('hype.taeglich') }}</option>
                        </select>
                    </div>
                    <div class="col-auto">
                        <label class="form-label small">{{ t('hype.minHype') }}</label>
                        <input v-model.number="einst.minHypeScore" type="number" min="0" max="100"
                            class="form-control form-control-sm hypZahl" @change="speichern">
                    </div>
                    <div class="col-auto">
                        <label class="form-label small">{{ t('hype.topN') }}</label>
                        <input v-model.number="einst.berichtTopN" type="number" min="1" max="20"
                            class="form-control form-control-sm hypZahl" @change="speichern">
                    </div>
                </div>

                <!-- Gewichte -->
                <h6 class="hypTitel">{{ t('hype.gewichteTitel') }}</h6>
                <p class="hypHinweis">{{ t('hype.gewichteHinweis') }}</p>
                <div class="hypRegler">
                    <div v-for="(_, feld) in einst.gewichte" :key="feld" class="hypReglerZeile">
                        <label>{{ t('hype.note_' + feld) }}</label>
                        <input type="range" min="0" max="50" v-model.number="einst.gewichte[feld]"
                            class="form-range" @change="speichern">
                        <span class="hypReglerWert">{{ einst.gewichte[feld] }}</span>
                    </div>
                    <div class="hypSumme" :class="{ falsch: gewichtSumme !== 100 }">
                        {{ t('hype.summe') }}: {{ gewichtSumme }}
                        <span v-if="gewichtSumme !== 100">— {{ t('hype.summeHinweis') }}</span>
                    </div>
                </div>

                <!-- Sicherheit -->
                <h6 class="hypTitel mt-4">{{ t('hype.sicherheitTitel') }}</h6>
                <p class="hypHinweis">{{ t('hype.sicherheitHinweis') }}</p>
                <div class="row g-3">
                    <div class="col-auto">
                        <label class="form-label small">{{ t('hype.minLiq') }}</label>
                        <input v-model.number="einst.sicherheit.minLiquiditaetUsd" type="number"
                            class="form-control form-control-sm hypZahl" @change="speichern">
                    </div>
                    <div class="col-auto">
                        <label class="form-label small">{{ t('hype.maxTop10') }}</label>
                        <input v-model.number="einst.sicherheit.maxTop10Prozent" type="number"
                            class="form-control form-control-sm hypZahl" @change="speichern">
                    </div>
                    <div class="col-auto">
                        <label class="form-label small">{{ t('hype.minAlter') }}</label>
                        <input v-model.number="einst.sicherheit.minPaarAlterStunden" type="number"
                            class="form-control form-control-sm hypZahl" @change="speichern">
                    </div>
                    <div class="col-auto">
                        <label class="form-label small">{{ t('hype.maxSteuer') }}</label>
                        <input v-model.number="einst.sicherheit.maxVerkaufssteuerProzent" type="number"
                            class="form-control form-control-sm hypZahl" @change="speichern">
                    </div>
                </div>
                <div class="form-check form-switch mt-2">
                    <input id="hypLp" class="form-check-input" type="checkbox"
                        v-model="einst.sicherheit.lpMussGesperrtSein" @change="speichern">
                    <label class="form-check-label small" for="hypLp">{{ t('hype.lpPflicht') }}</label>
                </div>

                <!-- Börsenfilter -->
                <h6 class="hypTitel mt-4">{{ t('hype.boersenTitel') }}</h6>
                <div class="form-check form-switch">
                    <input id="hypBoersen" class="form-check-input" type="checkbox"
                        v-model="einst.nurBoersen" @change="speichern">
                    <label class="form-check-label small" for="hypBoersen">{{ t('hype.nurBoersen') }}</label>
                    <div class="hypHinweis">{{ t('hype.nurBoersenHinweis') }}</div>
                </div>

                <!-- Quellen -->
                <h6 class="hypTitel mt-4">{{ t('hype.quellenTitel') }}</h6>
                <div class="hypQuellen">
                    <!-- Alle verbliebenen Quellen laufen ohne Schlüssel. Die drei
                         früheren Zusatzquellen sind am 21.08.2026 entfernt worden,
                         weil keine davon nutzbar war — Begründung im Kopf von
                         `quellen.js`. -->
                    <div v-for="(_, q) in einst.quellen" :key="q" class="form-check form-switch">
                        <input :id="'hypQ' + q" class="form-check-input" type="checkbox"
                            v-model="einst.quellen[q]" @change="speichern">
                        <label class="form-check-label small" :for="'hypQ' + q">
                            {{ q }}
                            <!-- CoinGecko läuft auch ohne Schlüssel, nur mit
                                 engem Limit — „braucht einen Schlüssel" wäre
                                 dort schlicht falsch. -->
                            <span v-if="SCHLUESSEL_QUELLEN[q] && !SCHLUESSEL_QUELLEN[q].optional && !schluesselDa(q)"
                                class="hypHinweisKlein">
                                {{ t('hype.brauchtSchluessel') }}
                            </span>
                        </label>
                    </div>
                </div>

                <!-- Zugangsdaten der Quellen.
                     Sie standen bisher nirgends: Die Schalter oben liessen sich
                     einschalten, der Schlüssel dazu war nicht einzugeben, und
                     der Lauf meldete „kein Schlüssel hinterlegt". Gespeichert
                     wird verschlüsselt; zurück kommt nur eine Maske, und ein
                     Feld mit Maske überschreibt beim Speichern nichts. -->
                <div class="hypSchluessel mt-3">
                    <div v-for="(info, q) in SCHLUESSEL_QUELLEN" :key="q" class="hypSchluesselZeile">
                        <label class="form-label small mb-1">
                            {{ q }}
                            <span class="hypHinweisKlein">{{ info.optional ? t('hype.keyOptional') : t('hype.keyNoetig') }}</span>
                        </label>
                        <div class="hypSchluesselFeld">
                            <input v-model="einst.schluessel[q]" type="password"
                                class="form-control form-control-sm"
                                :placeholder="schluesselDa(q) ? einst.schluessel[q] : t('hype.keyPlatzhalter')"
                                @change="speichern">
                            <a :href="info.url" target="_blank" rel="noopener"
                                class="ctl-pill klein" :title="info.url">
                                <i class="uil uil-external-link-alt"></i>{{ t('hype.keyHolen') }}
                            </a>
                        </div>
                        <div class="hypHinweis">{{ t('hype.keyHinweis.' + q) }}</div>
                    </div>
                </div>

                <!-- Wachhund & Alarme -->
                <h6 class="hypTitel mt-4">{{ t('hype.wachhundTitel') }}</h6>
                <p class="hypHinweis">{{ t('hype.wachhundHinweis') }}</p>
                <p v-if="einst.wachhundIntervallMin === 0" class="hypHinweis hypAus">
                    {{ t('hype.wachhundAusHinweis') }}
                </p>
                <div class="row g-3">
                    <div class="col-auto">
                        <label class="form-label small">{{ t('hype.wachhundTakt') }}</label>
                        <select v-model.number="einst.wachhundIntervallMin" class="form-select form-select-sm"
                            @change="speichern">
                            <!-- „Aus" als eigener Wert. Bis zum 21.08.2026 liess sich der
                                 Wachhund nur stilllegen, indem man alle Sterne entfernte —
                                 das ist ein Nebeneffekt, keine Einstellung. -->
                            <option :value="0">{{ t('hype.wachhundAus') }}</option>
                            <option :value="5">5 min</option>
                            <option :value="15">15 min</option>
                            <option :value="30">30 min</option>
                            <option :value="60">60 min</option>
                        </select>
                    </div>
                    <div class="col-auto">
                        <label class="form-label small">{{ t('hype.regelPreisSprung') }}</label>
                        <input v-model.number="einst.alarmRegeln.preisSprungPct" type="number" min="1"
                            class="form-control form-control-sm hypZahl" @change="speichern">
                    </div>
                    <div class="col-auto">
                        <label class="form-label small">{{ t('hype.regelPreis24h') }}</label>
                        <input v-model.number="einst.alarmRegeln.preisSturz24hPct" type="number" min="1"
                            class="form-control form-control-sm hypZahl" @change="speichern">
                    </div>
                    <div class="col-auto">
                        <label class="form-label small">{{ t('hype.regelLiqAbfluss') }}</label>
                        <input v-model.number="einst.alarmRegeln.liqAbflussPct" type="number" min="1"
                            class="form-control form-control-sm hypZahl" @change="speichern">
                    </div>
                </div>

                <!-- Börsen-Favoriten: eigene Schwellen, weil sie eigene Grössen
                     messen. Ein Bitunix-Perp hat keinen Liquiditätspool, der
                     abfliessen könnte — dort zählen Umsatz, Spread und Funding. -->
                <p class="hypHinweis mt-3 mb-1">{{ t('hype.regelnBoerse') }}</p>
                <div class="row g-3">
                    <div class="col-auto">
                        <label class="form-label small">{{ t('hype.regelUmsatzEinbruch') }}</label>
                        <input v-model.number="einst.alarmRegeln.umsatzEinbruchPct" type="number" min="1"
                            class="form-control form-control-sm hypZahl" @change="speichern">
                    </div>
                    <div class="col-auto">
                        <label class="form-label small">{{ t('hype.regelSpreadWarn') }}</label>
                        <input v-model.number="einst.alarmRegeln.spreadWarnBp" type="number" min="1" step="0.5"
                            class="form-control form-control-sm hypZahl" @change="speichern">
                    </div>
                    <div class="col-auto">
                        <label class="form-label small">{{ t('hype.regelFundingExtrem') }}</label>
                        <input v-model.number="einst.alarmRegeln.fundingExtremPct" type="number" min="1"
                            class="form-control form-control-sm hypZahl" @change="speichern">
                    </div>
                </div>

                <!-- Zustellkanäle -->
                <h6 class="hypTitel mt-4">{{ t('hype.kanaeleTitel') }}</h6>
                <p class="hypHinweis">{{ t('hype.kanaeleHinweis') }}</p>

                <div class="hypKanal">
                    <div class="form-check form-switch">
                        <input id="hypKanNtfy" class="form-check-input" type="checkbox"
                            v-model="einst.alarmKanaele.ntfy.an" @change="speichern">
                        <label class="form-check-label" for="hypKanNtfy"><strong>ntfy</strong></label>
                    </div>
                    <div v-if="einst.alarmKanaele.ntfy.an" class="hypKanalFelder">
                        <input v-model="einst.alarmKanaele.ntfy.url" class="form-control form-control-sm"
                            :placeholder="t('hype.ntfyUrl')" @change="speichern">
                        <input v-model="einst.alarmKanaele.ntfy.topic" class="form-control form-control-sm"
                            placeholder="Topic" @change="speichern">
                        <input v-model="einst.schluessel.ntfyToken" type="password" class="form-control form-control-sm"
                            :placeholder="t('hype.tokenOptional')" @change="speichern">
                        <select v-model="einst.alarmKanaele.ntfy.minSchwere" class="form-select form-select-sm"
                            @change="speichern">
                            <option value="info">{{ t('hype.abInfo') }}</option>
                            <option value="warnung">{{ t('hype.abWarnung') }}</option>
                            <option value="kritisch">{{ t('hype.abKritisch') }}</option>
                        </select>
                    </div>
                </div>

                <div class="hypKanal">
                    <div class="form-check form-switch">
                        <input id="hypKanTg" class="form-check-input" type="checkbox"
                            v-model="einst.alarmKanaele.telegram.an" @change="speichern">
                        <label class="form-check-label" for="hypKanTg"><strong>Telegram</strong></label>
                    </div>
                    <div v-if="einst.alarmKanaele.telegram.an" class="hypKanalFelder">
                        <input v-model="einst.schluessel.telegramToken" type="password" class="form-control form-control-sm"
                            :placeholder="t('hype.botToken')" @change="speichern">
                        <input v-model="einst.alarmKanaele.telegram.chatId" class="form-control form-control-sm"
                            placeholder="Chat-ID" @change="speichern">
                        <select v-model="einst.alarmKanaele.telegram.minSchwere" class="form-select form-select-sm"
                            @change="speichern">
                            <option value="info">{{ t('hype.abInfo') }}</option>
                            <option value="warnung">{{ t('hype.abWarnung') }}</option>
                            <option value="kritisch">{{ t('hype.abKritisch') }}</option>
                        </select>
                    </div>
                </div>

                <div class="hypKanal">
                    <div class="form-check form-switch">
                        <input id="hypKanWh" class="form-check-input" type="checkbox"
                            v-model="einst.alarmKanaele.webhook.an" @change="speichern">
                        <label class="form-check-label" for="hypKanWh">
                            <strong>Webhook</strong>
                            <span class="hypHinweisKlein">{{ t('hype.webhookHa') }}</span>
                        </label>
                    </div>
                    <div v-if="einst.alarmKanaele.webhook.an" class="hypKanalFelder">
                        <input v-model="einst.schluessel.webhookUrl" type="password" class="form-control form-control-sm hypBreit"
                            :placeholder="t('hype.webhookUrl')" @change="speichern">
                        <select v-model="einst.alarmKanaele.webhook.minSchwere" class="form-select form-select-sm"
                            @change="speichern">
                            <option value="info">{{ t('hype.abInfo') }}</option>
                            <option value="warnung">{{ t('hype.abWarnung') }}</option>
                            <option value="kritisch">{{ t('hype.abKritisch') }}</option>
                        </select>
                        <div class="hypHinweis mb-0" style="flex-basis: 100%">{{ t('hype.webhookPayload') }}</div>
                    </div>
                </div>

                <button class="btn btn-sm btn-outline-secondary mt-2" :disabled="testLaeuft" @click="kanaeleTesten">
                    <span v-if="testLaeuft" class="spinner-border spinner-border-sm me-1"></span>
                    {{ t('hype.kanaeleTesten') }}
                </button>
                <span v-if="testErgebnis" class="ms-2 small">{{ testErgebnis }}</span>

                <!-- KI-Stufe -->
                <h6 class="hypTitel mt-4">{{ t('hype.kiTitel') }}</h6>
                <p class="hypHinweis">{{ t('hype.kiHinweis') }}</p>
                <div class="btn-group btn-group-sm mb-2">
                    <button class="btn" :class="ordnung === 'preis' ? 'btn-primary' : 'btn-outline-secondary'"
                        @click="ordnungWechseln('preis')">{{ t('hype.nachPreis') }}</button>
                    <button class="btn" :class="ordnung === 'guete' ? 'btn-primary' : 'btn-outline-secondary'"
                        @click="ordnungWechseln('guete')">{{ t('hype.nachGuete') }}</button>
                </div>
                <div class="hypStufen">
                    <label v-for="s in stufen" :key="s.id" class="hypStufe"
                        :class="{ aktiv: !manuell && einst.llmStufe === s.id }">
                        <!-- Gemeinsames `name`: ohne das bildet jeder Knopf seine
                             eigene Gruppe, bleibt nach dem ersten Klick angehakt,
                             und ein erneuter Klick löst kein `change` mehr aus —
                             die Wahl liesse sich dann nicht zurücknehmen. -->
                        <input type="radio" name="hypStufe" :value="s.id"
                            :checked="!manuell && einst.llmStufe === s.id"
                            @change="stufeGewaehlt(s)">
                        <div class="hypStufeKopf">
                            <strong>{{ t('hype.modus_' + s.modus) }} · {{ t('hype.profil_' + s.profil) }}</strong>
                            <span v-if="s.empfohlen" class="badge bg-primary hypBadge ms-2">{{ t('hype.empfohlen') }}</span>
                            <span class="ms-auto hypStufePreis">~{{ s.usdProMonat[0] }}–{{ s.usdProMonat[1] }} $/{{ t('hype.monat') }}</span>
                        </div>
                        <div class="hypStufeModelle">
                            {{ t('hype.recherche') }}: {{ s.rollen.research.provider }}/{{ s.rollen.research.modell }}
                            · {{ t('hype.redakteur') }}: {{ s.rollen.editor.provider }}/{{ s.rollen.editor.modell }}
                        </div>
                    </label>

                    <!-- Manuell: die drei Rollen einzeln belegen -->
                    <label class="hypStufe" :class="{ aktiv: manuell }">
                        <input type="radio" name="hypStufe" :checked="manuell" @change="manuellWaehlen">
                        <div class="hypStufeKopf">
                            <strong>{{ t('hype.manuell') }}</strong>
                            <span class="ms-auto hypStufePreis">{{ t('hype.manuellPreis') }}</span>
                        </div>
                        <div class="hypStufeModelle">{{ t('hype.manuellHinweis') }}</div>
                    </label>
                </div>

                <div v-if="manuell" class="hypRollen">
                    <div v-for="r in ROLLEN" :key="r.id" class="hypRolle">
                        <div class="hypRolleKopf">
                            <strong>{{ t('hype.rolle_' + r.id) }}</strong>
                            <span class="hypHinweisKlein">{{ t('hype.rolleHinweis_' + r.id) }}</span>
                        </div>
                        <AnbieterWahl
                            :provider="einst.llmRollen?.[r.id]?.provider || ''"
                            :modell="einst.llmRollen?.[r.id]?.modell || ''"
                            :modell-listen="modellListen"
                            :global-provider="globalKi.provider"
                            :global-modell="globalKi.modell"
                            @update:provider="w => rolleSetzen(r.id, 'provider', w)"
                            @update:modell="w => rolleSetzen(r.id, 'modell', w)" />
                    </div>
                    <p v-if="fehlendeSchluessel.length" class="hypHinweis mb-0 mt-2 text-warning">
                        <i class="uil uil-exclamation-triangle me-1"></i>
                        {{ t('hype.schluesselFehlt', { anbieter: fehlendeSchluessel.join(', ') }) }}
                    </p>
                </div>
            </div>
        </div>

        <!-- ══ Dashboard ═════════════════════════════════════════════ -->
        <div v-show="reiter === 'dashboard'" class="mt-3">

            <!-- ── Favoriten ─────────────────────────────────────── -->
            <div v-if="favoriten.length" class="hypFavLeiste">
                <span class="hypFavTitel"><i class="uil uil-star me-1"></i>{{ t('hype.favoriten') }}</span>
                <button v-for="f in sichtbareFavoriten" :key="f.id" class="hypFavChip"
                    :class="{ aktiv: liveOffen?.favorit?.id === f.id, stumm: f.stumm }"
                    @click="liveOeffnen(f)">
                    <i v-if="f.stumm" class="uil uil-bell-slash me-1"></i>{{ f.symbol }}<span class="hypFavKette">{{ f.chain }}</span>
                    <span v-if="ungelesenJeFavorit[f.id]" class="hypAlarmZahl">{{ ungelesenJeFavorit[f.id] }}</span>
                </button>
                <!-- Der Rest steckt hinter einem Knopf. Die Zahl darauf ist
                     die der ungelesenen Alarme in den verborgenen Favoriten —
                     sonst verschwände mit dem Chip auch dessen Alarmzähler. -->
                <button v-if="versteckteFavoriten" class="hypFavChip hypFavMehr" @click="favAlleUmschalten">
                    {{ favAlleZeigen ? t('hype.favWeniger') : t('hype.favMehr', { n: versteckteFavoriten }) }}
                    <span v-if="!favAlleZeigen && verstecktUngelesen" class="hypAlarmZahl">{{ verstecktUngelesen }}</span>
                </button>
            </div>

            <!-- ── Alarme ────────────────────────────────────────── -->
            <div v-if="alarme.length" class="hypBlock">
                <div class="d-flex align-items-center gap-2 mb-2">
                    <h6 class="hypTitel mb-0">
                        <i class="uil uil-bell me-1"></i>{{ t('hype.alarmeTitel') }}
                        <span v-if="ungeleseneAlarme.length" class="badge bg-danger hypBadge ms-1">{{ ungeleseneAlarme.length }}</span>
                    </h6>
                    <button v-if="ungeleseneAlarme.length" class="btn btn-sm btn-outline-secondary py-0 ms-auto"
                        @click="alarmeGelesen">{{ t('hype.alleGelesen') }}</button>
                    <button class="btn btn-sm btn-outline-secondary py-0"
                        :class="[ungeleseneAlarme.length ? '' : 'ms-auto', { hypScharf: alarmAlleScharf }]"
                        :title="t('hype.loeschen')" @click="alarmeAlleLoeschen">
                        {{ alarmAlleScharf ? t('hype.alarmeAlleLoeschenScharf') : t('hype.alarmeAlleLoeschen') }}
                    </button>
                </div>
                <div class="hypAlarmListe">
                    <div v-for="a in sichtbareAlarme" :key="a.id" class="hypAlarm"
                        :class="[a.schwere, { gelesen: a.gelesen }]">
                        <span class="hypAlarmSchwere">{{ t('hype.schwere_' + a.schwere) }}</span>
                        <span class="hypAlarmText">{{ a.meldung }}</span>
                        <span class="hypAlarmZeit">{{ zeitpunkt(a.erstelltAm) }}</span>
                        <span role="button" tabindex="0" class="hypAlarmWeg" :class="{ scharf: alarmLoeschId === a.id }"
                            :title="t('hype.loeschen')" @keydown.enter.stop.prevent="alarmLoeschen(a.id)" @keydown.space.stop.prevent="alarmLoeschen(a.id)" @click.stop="alarmLoeschen(a.id)">
                            <i class="uil uil-trash-alt"></i>
                        </span>
                    </div>
                </div>
                <!-- Die älteren sind geladen, nur nicht gezeigt: vorher waren
                     sie hart abgeschnitten und der Zähler oben zählte trotzdem
                     mit — man sah eine Zahl ohne die zugehörige Zeile. -->
                <button v-if="alarme.length > ALARM_SICHTBAR" class="btn btn-sm btn-outline-secondary py-0 mt-2"
                    @click="alarmeAlleZeigen = !alarmeAlleZeigen">
                    {{ alarmeAlleZeigen ? t('hype.alarmeWeniger')
                        : t('hype.alarmeMehr', { n: alarme.length - ALARM_SICHTBAR }) }}
                </button>
            </div>

            <!-- Kachel-Detail eines Favoriten: Livedaten -->
            <div v-if="liveOffen" class="hypLive">
                <div class="hypLiveKopf">
                    <strong>{{ liveOffen.favorit.symbol }}</strong>
                    <span v-if="liveOffen.favorit.name" class="hypKandidatName">{{ liveOffen.favorit.name }}</span>
                    <span class="hypKette">{{ liveOffen.favorit.chain }}</span>
                    <span v-if="liveLaedt" class="spinner-border spinner-border-sm ms-2"></span>
                    <span v-else class="hypLiveStand">{{ t('hype.liveStand', { z: zeitpunkt(liveOffen.stand) }) }}</span>
                    <span class="ms-auto"></span>
                    <a v-if="liveOffen.dexUrl" class="hypLink me-3" :href="liveOffen.dexUrl"
                        target="_blank" rel="noopener noreferrer">DexScreener ↗</a>
                    <button class="btn btn-sm py-0 me-2"
                        :class="liveOffen.favorit.stumm ? 'btn-warning' : 'btn-outline-secondary'"
                        :title="t('hype.stummHinweis')" @click="stummUmschalten(liveOffen.favorit)">
                        <i class="uil" :class="liveOffen.favorit.stumm ? 'uil-bell-slash' : 'uil-bell'"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger py-0 me-2"
                        :title="t('hype.favEntfernen')" @click="favEntfernen(liveOffen.favorit)">
                        <i class="uil uil-star-half-alt"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-secondary py-0" @click="liveSchliessen">
                        <i class="uil uil-times"></i>
                    </button>
                </div>

                <div class="hypLiveGrid">
                    <div class="hypLiveKachel">
                        <div class="hypLiveWert">{{ preis(liveOffen.markt?.preisUsd) }}</div>
                        <div class="hypLiveLabel">{{ t('hype.livePreis') }}</div>
                        <div class="hypLiveExtra" :class="(liveOffen.markt?.aenderung24h ?? 0) >= 0 ? 'text-success' : 'text-danger'"
                            v-if="liveOffen.markt?.aenderung24h != null">
                            {{ liveOffen.markt.aenderung24h >= 0 ? '+' : '' }}{{ liveOffen.markt.aenderung24h.toFixed(1) }} % / 24h
                        </div>
                    </div>
                    <div class="hypLiveKachel">
                        <div class="hypLiveWert">{{ geld(liveOffen.markt?.liquiditaetUsd) }}</div>
                        <div class="hypLiveLabel">{{ t('hype.spalteLiq') }} (USD)</div>
                    </div>
                    <div class="hypLiveKachel">
                        <div class="hypLiveWert">{{ geld(liveOffen.markt?.volumen24h) }}</div>
                        <div class="hypLiveLabel">{{ t('hype.liveVol24') }}</div>
                        <div class="hypLiveExtra" v-if="liveOffen.markt?.volumen1h">
                            {{ geld(liveOffen.markt.volumen1h) }} {{ t('hype.liveLetzteStunde') }}
                        </div>
                    </div>
                    <div class="hypLiveKachel">
                        <div class="hypLiveWert">{{ kv(liveOffen.markt?.kaufVerkaufVerhaeltnis) }}</div>
                        <div class="hypLiveLabel">{{ t('hype.liveKV') }}</div>
                        <div class="hypLiveExtra" v-if="liveOffen.markt?.transaktionen24h">
                            {{ liveOffen.markt.transaktionen24h.toLocaleString() }} {{ t('hype.liveTrades') }}
                        </div>
                    </div>
                    <div class="hypLiveKachel">
                        <div class="hypLiveWert">{{ alter(liveOffen.markt?.paarAlterStunden) }}</div>
                        <div class="hypLiveLabel">{{ t('hype.spalteAlter') }}</div>
                        <div class="hypLiveExtra" v-if="liveOffen.markt?.dex">{{ liveOffen.markt.dex }}</div>
                    </div>
                    <div class="hypLiveKachel">
                        <div class="hypLiveWert hypLiveBoersen">
                            <template v-if="liveOffen.listungen?.length">
                                <span v-for="l in liveOffen.listungen" :key="l.boerse || l" class="hypBoerse"
                                    :title="listungText(l)">{{ listungKuerzel(l) }}</span>
                            </template>
                            <span v-else class="text-muted">—</span>
                        </div>
                        <div class="hypLiveLabel">{{ t('hype.spalteHandelbar') }}</div>
                        <div class="hypLiveExtra" v-if="liveOffen.listungUnbekannt?.length">
                            {{ t('hype.listungUnbekannt', { b: liveOffen.listungUnbekannt.join(', ') }) }}
                        </div>
                    </div>
                    <div v-if="liveOffen.letzterLauf" class="hypLiveKachel">
                        <div class="hypLiveWert">
                            {{ liveOffen.letzterLauf.hypeScore }}
                            <span class="hypLiveTrenn">/</span>
                            <span :class="liveOffen.letzterLauf.safetyScore >= 70 ? 'text-success' : 'text-warning'">
                                {{ liveOffen.letzterLauf.status === 'verworfen' ? '—' : liveOffen.letzterLauf.safetyScore }}
                            </span>
                        </div>
                        <div class="hypLiveLabel">{{ t('hype.liveNoten') }}</div>
                        <div class="hypLiveExtra">{{ t('hype.liveGeprueft', { z: zeitpunkt(liveOffen.letzterLauf.erstelltAm) }) }}</div>
                    </div>
                </div>
                <div v-if="liveOffen.letzterLauf?.hinweise?.length" class="hypLiveHinweise">
                    <i class="uil uil-shield-exclamation me-1"></i>{{ liveOffen.letzterLauf.hinweise.join(' · ') }}
                </div>
            </div>

            <div class="hypKennzahlen">
                <div class="hypZelle">
                    <div class="hypWert">{{ kandidaten.length }}</div>
                    <div class="hypLabel">{{ t('hype.kandidaten') }}</div>
                </div>
                <div class="hypZelle">
                    <div class="hypWert text-success">{{ bestanden.length }}</div>
                    <div class="hypLabel">{{ t('hype.bestanden') }}</div>
                </div>
                <div class="hypZelle">
                    <div class="hypWert text-danger">{{ verworfen.length }}</div>
                    <div class="hypLabel">{{ t('hype.verworfen') }}</div>
                    <div class="hypLabel hypKlein">{{ t('hype.unterSchwelleN', { n: nurBewertet.length }) }}</div>
                </div>
                <div class="hypZelle">
                    <div class="hypWert">{{ heissestesNarrativ || '—' }}</div>
                    <div class="hypLabel">{{ t('hype.heissestesNarrativ') }}</div>
                </div>
            </div>

            <!-- Divergenz-Quadrant — nur wo Breite da ist. Auf 375 px bliebe
                 ein Diagramm übrig, aus dem sich nichts ablesen lässt. -->
            <div v-if="!istTelefon" class="hypBlock">
                <h6 class="hypTitel">{{ t('hype.quadrantTitel') }}</h6>
                <p class="hypHinweis">{{ t('hype.quadrantHinweis') }}</p>
                <div v-if="bestanden.length || verworfen.length" ref="quadrantEl" class="hypQuadrant"></div>
                <p v-else class="text-muted small">{{ t('hype.nochKeinScan') }}</p>
            </div>

            <!-- Kandidatentabelle -->
            <div class="hypBlock">
                <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                    <h6 class="hypTitel mb-0 me-2">{{ t('hype.tabelleTitel') }}</h6>
                    <span v-for="n in narrativeInDaten" :key="n"
                        class="hypChip" :class="{ aktiv: filterNarrativ === n }"
                        @click="filterNarrativ = filterNarrativ === n ? '' : n">{{ n }}</span>
                    <!-- Namens-Nachahmer ausblenden. Nicht als Vorgabe an: manchmal
                         läuft ein Klon trotzdem, und ihn ungefragt zu verstecken wäre
                         eine andere Art, die Liste zu schönen. -->
                    <span v-if="trittbrettAnzahl" class="hypChip" :class="{ aktiv: ohneTrittbrett }"
                        :title="t('hype.trittbrettHilfe')"
                        @click="ohneTrittbrett = !ohneTrittbrett">
                        <i class="uil uil-copy me-1"></i>{{ t('hype.trittbrettAus', { n: trittbrettAnzahl }) }}
                    </span>
                    <!-- Börsenfilter, gleiche Bedeutung wie im Coin-Radar: ODER über
                         die gewählten Börsen. Der Schalter in den Einstellungen
                         („Nur Funde, die … führen") wirkt auf den ganzen LAUF und
                         kennt keine einzelne Börse — hier wird die vorhandene Liste
                         nachträglich enger gezogen, ohne einen neuen Lauf. -->
                    <span v-for="b in BOERSEN" :key="b" class="hypChip"
                        :class="{ aktiv: boersenFilter.has(b) }"
                        :title="t('hype.boersenFilterChip', { b: boerseName(b) })"
                        @click="boerseUmschalten(b)">{{ BOERSEN_KUERZEL[b] }}</span>
                    <select v-model="filterStatus" class="form-select form-select-sm hypAuswahl ms-auto">
                        <option value="">{{ t('hype.alleStatus') }}</option>
                        <option value="bestanden">{{ t('hype.bestanden') }}</option>
                        <option value="verworfen">{{ t('hype.verworfen') }}</option>
                        <option value="bewertet">{{ t('hype.unterSchwelle') }}</option>
                    </select>
                </div>

                <!-- Am Telefon eine Karte je Fund: neun Spalten auf 375 px
                     wären eine waagerechte Rollleiste, in der man mehr sucht
                     als liest. Gezeigt wird, was die Entscheidung trägt —
                     Noten, Thema, Liquidität, Ausgang. -->
                <div v-if="istTelefon" class="hypKarten">
                    <div v-for="k in gefiltert.slice(0, 40)" :key="k.id" class="hypKarte"
                        @click="offen = offen === k.id ? null : k.id">
                        <div class="hypKarteKopf">
                            <i class="uil hypStern" :class="istFav(k) ? 'uil-favorite aktiv' : 'uil-star'"
                                @click.stop="favUmschalten(k)"></i>
                            <strong>{{ k.symbol }}</strong>
                            <span class="hypKette">{{ k.chain }}</span>
                            <span v-if="trittbrett(k)" class="hypTritt"
                                :title="t('hype.trittbrettHilfeEinzeln', { v: k.sozialDaten.trittbrett.vorbild })">
                                <i class="uil uil-copy"></i></span>
                            <span class="ms-auto hypKarteNoten">
                                {{ k.hypeScore }}<span class="hypLiveTrenn"> / </span>
                                <span :class="k.safetyScore >= 70 ? 'text-success' : 'text-warning'">
                                    {{ k.status === 'verworfen' ? '—' : k.safetyScore }}
                                </span>
                            </span>
                        </div>
                        <div class="hypKarteZeile">
                            <span v-if="k.narrative" class="hypChip klein">{{ k.narrative }}</span>
                            <span class="hypKarteWert">{{ geld(k.marktDaten?.liquiditaetUsd) }} USD</span>
                            <span class="hypKarteWert">{{ alter(k.marktDaten?.paarAlterStunden) }}</span>
                            <span v-for="(l, i) in (k.marktDaten?.listungen || [])" :key="i"
                                class="hypBoerse">{{ listungKuerzel(l) }}</span>
                        </div>
                        <div class="hypKarteZeile">
                            <span v-if="k.status === 'verworfen'" class="badge bg-danger hypBadge">
                                {{ t('hype.grund_' + k.verworfenGrund) !== 'hype.grund_' + k.verworfenGrund ? t('hype.grund_' + k.verworfenGrund) : k.verworfenGrund }}
                            </span>
                            <span v-else-if="k.status === 'bewertet'" class="badge bg-secondary hypBadge">{{ t('hype.unterSchwelle') }}</span>
                            <span v-else class="badge bg-success hypBadge">{{ t('hype.bestanden') }}</span>
                        </div>
                        <div v-if="offen === k.id && k.sicherheitsDaten?.hinweise?.length" class="hypKarteHinweise">
                            {{ k.sicherheitsDaten.hinweise.join(' · ') }}
                        </div>
                    </div>
                    <p v-if="!gefiltert.length" class="text-muted small text-center py-3 mb-0">
                        {{ t('hype.nochKeinScan') }}
                    </p>
                </div>

                <div v-else class="table-responsive">
                    <table class="table table-sm align-middle hypTabelle">
                        <thead>
                            <tr>
                                <th @click="sortiere('symbol')">{{ t('hype.spalteSymbol') }}</th>
                                <th @click="sortiere('hypeScore')" class="text-end">{{ t('hype.spalteHype') }}</th>
                                <th @click="sortiere('safetyScore')" class="text-end">{{ t('hype.spalteSafety') }}</th>
                                <th>{{ t('hype.spalteNarrativ') }}</th>
                                <th class="text-end">{{ t('hype.spalteLiq') }}</th>
                                <th class="text-end">{{ t('hype.spalteAlter') }}</th>
                                <th>{{ t('hype.spalteHandelbar') }}</th>
                                <th>{{ t('hype.spalteStatus') }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <template v-for="k in gefiltert" :key="k.id">
                                <tr class="hypZeile" @click="offen = offen === k.id ? null : k.id">
                                    <td>
                                        <i class="uil hypStern" :class="istFav(k) ? 'uil-favorite aktiv' : 'uil-star'"
                                            :title="istFav(k) ? t('hype.favEntfernen') : t('hype.favHinzu')"
                                            @click.stop="favUmschalten(k)"></i>
                                        <strong>{{ k.symbol }}</strong>
                                        <span class="hypKette">{{ k.chain }}</span>
                                        <span v-if="trittbrett(k)" class="hypTritt"
                                            :title="t('hype.trittbrettHilfeEinzeln', { v: k.sozialDaten.trittbrett.vorbild })">
                                            <i class="uil uil-copy"></i></span>
                                    </td>
                                    <td class="text-end">{{ k.hypeScore }}</td>
                                    <td class="text-end">
                                        <span :class="k.safetyScore >= 70 ? 'text-success' : (k.safetyScore >= 40 ? 'text-warning' : 'text-danger')">
                                            {{ k.status === 'verworfen' ? '—' : k.safetyScore }}
                                        </span>
                                    </td>
                                    <td><span v-if="k.narrative" class="hypChip klein">{{ k.narrative }}</span></td>
                                    <td class="text-end">{{ geld(k.marktDaten?.liquiditaetUsd) }}</td>
                                    <td class="text-end">{{ alter(k.marktDaten?.paarAlterStunden) }}</td>
                                    <td>
                                        <span v-if="k.marktDaten?.dex" class="hypDex">{{ k.marktDaten.dex }}</span>
                                        <span v-for="(l, i) in (k.marktDaten?.listungen || [])" :key="i"
                                            class="hypBoerse" :title="listungText(l)">{{ listungKuerzel(l) }}</span>
                                        <span v-if="!k.marktDaten?.dex && !(k.marktDaten?.listungen || []).length"
                                            class="text-muted">—</span>
                                    </td>
                                    <td>
                                        <span v-if="k.status === 'verworfen'" class="badge bg-danger hypBadge"
                                            :title="k.verworfenGrund">{{ t('hype.grund_' + k.verworfenGrund) !== 'hype.grund_' + k.verworfenGrund ? t('hype.grund_' + k.verworfenGrund) : k.verworfenGrund }}</span>
                                        <span v-else-if="k.status === 'berichtet'" class="badge bg-primary hypBadge">{{ t('hype.imBericht') }}</span>
                                        <span v-else-if="k.status === 'bewertet'" class="badge bg-secondary hypBadge">{{ t('hype.unterSchwelle') }}</span>
                                        <span v-else class="badge bg-success hypBadge">{{ t('hype.bestanden') }}</span>
                                    </td>
                                    <td class="text-end">
                                        <i class="uil" :class="offen === k.id ? 'uil-angle-up' : 'uil-angle-down'"></i>
                                    </td>
                                </tr>
                                <tr v-if="offen === k.id" :key="k.id + '-d'">
                                    <td colspan="9" class="hypDetail">
                                        <div class="hypDetailGrid">
                                            <div>
                                                <div class="hypDetailTitel">{{ t('hype.teilnoten') }}</div>
                                                <div v-for="(wert, feld) in (k.sozialDaten?.teilnoten || {})" :key="feld" class="hypNote">
                                                    <span class="hypNoteName">{{ t('hype.note_' + feld) }}</span>
                                                    <span class="hypBalken"><i :style="{ width: Math.round(wert) + '%' }"></i></span>
                                                    <span class="hypNoteWert">{{ Math.round(wert) }}</span>
                                                </div>
                                                <div class="hypNoteName mt-1">
                                                    {{ t('hype.quellenAnzahl', { n: k.sozialDaten?.quellenAnzahl || 0 }) }}:
                                                    {{ (k.quellen || []).map(q => q.quelle).join(', ') }}
                                                </div>
                                            </div>
                                            <div>
                                                <div class="hypDetailTitel">{{ t('hype.sicherheitsbefunde') }}</div>
                                                <ul v-if="k.sicherheitsDaten?.hinweise?.length" class="hypListe">
                                                    <li v-for="(h, i) in k.sicherheitsDaten.hinweise" :key="i">{{ h }}</li>
                                                </ul>
                                                <p v-else class="text-muted small mb-1">{{ t('hype.keineBefunde') }}</p>
                                                <div class="mt-2">
                                                    <a v-if="k.contractAddress" class="hypLink"
                                                        :href="'https://dexscreener.com/' + k.chain + '/' + k.contractAddress"
                                                        target="_blank" rel="noopener noreferrer">DexScreener ↗</a>
                                                    <a v-if="k.contractAddress" class="hypLink ms-2"
                                                        :href="'https://www.geckoterminal.com/' + k.chain + '/pools/' + (k.pairAddress || k.contractAddress)"
                                                        target="_blank" rel="noopener noreferrer">GeckoTerminal ↗</a>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            </template>
                            <tr v-if="!gefiltert.length">
                                <td colspan="9" class="text-center text-muted py-3">{{ t('hype.nochKeinScan') }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- ══ Berichte ══════════════════════════════════════════════ -->
        <div v-show="reiter === 'berichte'" class="mt-3">
            <div v-if="!berichte.length" class="text-muted small">{{ t('hype.keineBerichte') }}</div>
            <div class="hypBerichtListe">
                <div v-for="b in berichte" :key="b.id" class="hypBerichtKarte"
                    :class="{ aktiv: offenerBericht?.id === b.id }" @click="berichtOeffnen(b.id)">
                    <div class="hypBerichtDatum">{{ zeitpunkt(b.erstelltAm) }}</div>
                    <div class="hypBerichtTitel">{{ b.ueberschrift || '—' }}</div>
                    <div class="hypBerichtMeta">
                        {{ t('hype.berichtMeta', { n: b.anzahlKandidaten, v: b.anzahlAussortiert }) }}
                        <span v-if="b.kostenUsd"> · {{ useKostenAnzeige(b.kostenUsd) }}</span>
                    </div>
                    <span class="hypLoeschen" :class="{ scharf: loeschId === b.id }"
                        :title="t('hype.loeschen')" @click.stop="berichtLoeschen(b.id)">
                        <i class="uil uil-trash-alt"></i>
                    </span>
                </div>
            </div>

            <div v-if="offenerBericht" class="hypBericht">
                <h4 class="hypBerichtUeberschrift">{{ offenerBericht.ueberschrift }}</h4>
                <p class="hypMarktkontext">{{ offenerBericht.marktkontext }}</p>

                <div v-for="k in offenerBericht.kandidaten" :key="k.symbol" class="hypKandidat">
                    <div class="hypKandidatKopf">
                        <strong>{{ k.symbol }}</strong>
                        <span v-if="k.name" class="hypKandidatName">{{ k.name }}</span>
                        <span class="hypKette">{{ k.chain }}</span>
                        <span class="ms-auto hypNoten">
                            {{ t('hype.spalteHype') }} {{ k.hypeScore }} · {{ t('hype.spalteSafety') }} {{ k.safetyScore }}
                        </span>
                        <span class="badge hypBadge ms-2"
                            :class="{ 'bg-success': k.vertrauen === 'hoch', 'bg-secondary': k.vertrauen === 'mittel', 'bg-warning text-dark': k.vertrauen === 'niedrig' }">
                            {{ t('hype.vertrauen_' + k.vertrauen) }}
                        </span>
                    </div>
                    <dl class="hypAbschnitte">
                        <dt>{{ t('hype.einordnung') }}</dt><dd>{{ k.einordnung }}</dd>
                        <dt>{{ t('hype.substanz') }}</dt><dd>{{ k.substanz }}</dd>
                        <dt>{{ t('hype.risiken') }}</dt><dd>{{ k.risiken }}</dd>
                    </dl>
                    <div v-if="k.belege?.length" class="hypBelege">
                        <template v-for="(b, i) in k.belege.slice(0, 6)" :key="i">
                            <!-- Belege stammen aus Perplexity-Zitaten, also aus einer
                                 KI-Antwort. Ein `javascript:`-Schema fuehrt beim Klick
                                 direkt zur Ausfuehrung; ohne gueltiges Schema wird gar
                                 kein Link gerendert. -->
                            <a v-if="sichereUrl(b)" :href="sichereUrl(b)"
                                target="_blank" rel="noopener noreferrer">[{{ i + 1 }}]</a>
                        </template>
                    </div>
                </div>

                <div v-if="offenerBericht.aussortiert?.length" class="hypAussortiert">
                    <h6 class="hypTitel">{{ t('hype.aussortiertTitel') }}</h6>
                    <table class="table table-sm hypTabelle">
                        <tbody>
                            <tr v-for="(a, i) in offenerBericht.aussortiert" :key="i">
                                <td style="width: 8rem"><strong>{{ a.symbol }}</strong></td>
                                <td>{{ t('hype.grund_' + a.grund) !== 'hype.grund_' + a.grund ? t('hype.grund_' + a.grund) : a.grund }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <p class="hypDisclaimer">{{ offenerBericht.hinweis || HINWEIS_RUECKFALL }}</p>
            </div>
        </div>

    </div>
</template>

<script setup>
/**
 * Hype-Radar.
 *
 * Drei Reiter: das Dashboard zeigt den letzten Lauf, „Berichte" die
 * geschriebenen Zusammenfassungen, „Einstellungen" die Stellschrauben.
 *
 * Das Herzstück ist der Divergenz-Quadrant. Er trägt Marktbestätigung gegen
 * Aufmerksamkeit auf: oben links steht, worüber geredet wird, ohne dass der
 * Handel mitzieht — der Fall, den man sehen muss und den eine sortierte Liste
 * nicht zeigt. Die Farbe ist die Sicherheitsnote, damit ein auffälliger
 * Kandidat nicht allein wegen seiner Lage interessant aussieht.
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { sichereUrl } from '../utils/sanitize.js'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import * as echarts from 'echarts'
import { useKostenAnzeige } from '../utils/formatters.js'
import { logWarn } from '../utils/logger.js'
import AnbieterWahl from '../components/AnbieterWahl.vue'
import PageInfo from '../components/PageInfo.vue'
import { useIstTelefon } from '../utils/geraet.js'

const { t, locale } = useI18n()

const HINWEIS_RUECKFALL = 'Keine Anlageberatung. Frühphasen-Token sind hochriskant.'

// Kürzel der eigenen Börsen — kurz genug für eine Tabellenzelle, eindeutig
// genug zum Wiedererkennen. Der volle Name steht im Title-Text.
const BOERSEN_KUERZEL = { bitunix: 'BX', bitget: 'BG', pionex: 'PX' }

/* Ausgeschrieben für alles, was beim Darüberfahren erscheint — ein Kürzel,
 * das man erst lernen muss, ist in einem Filter die falsche Sparsamkeit. */
const BOERSEN_NAME = { bitunix: 'Bitunix', bitget: 'Bitget', pionex: 'Pionex' }
const boerseName = (b) => BOERSEN_NAME[b] || b
const BOERSEN = ['bitunix', 'bitget', 'pionex']

/*
 * Gewählte Börsen. ODER-verknüpft: Wer Konten bei zweien hat, sucht die
 * Vereinigung. Leere Auswahl heisst „alle", nicht „keine".
 */
const boersenFilter = ref(new Set())

function boerseUmschalten(b) {
    const neu = new Set(boersenFilter.value)
    if (neu.has(b)) neu.delete(b)
    else neu.add(b)
    boersenFilter.value = neu
}

/** Der Börsenname einer Listung — sie kommt als Zeichenkette ODER als Objekt. */
const listungBoerse = (l) => (typeof l === 'string' ? l : l?.boerse)

/**
 * Trifft der Börsenfilter zu?
 *
 * Eine ungeklärte Listung lässt durch — genau wie der Laufschalter es tut und
 * aus demselben Grund: Dass eine Börsenliste gerade nicht abrufbar war, ist
 * kein Beleg dafür, dass es den Coin dort nicht gibt.
 */
function passtBoersenfilter(k) {
    const gewaehlt = boersenFilter.value
    if (!gewaehlt.size) return true
    const gelistet = (k.marktDaten?.listungen || []).map(listungBoerse)
    const offen = k.marktDaten?.listungUnbekannt || []
    for (const b of gewaehlt) {
        if (gelistet.includes(b) || offen.includes(b)) return true
    }
    return false
}

/*
 * Eine Listung kommt in zwei Formen an: alte Läufe speicherten den blossen
 * Börsennamen ('bitunix'), neue ein Objekt mit Marktart ({boerse, spot,
 * futures}). Beide müssen sich zeichnen lassen — die alten Zeilen bleiben ja
 * in der Datenbank stehen.
 */
function listungKuerzel(l) {
    if (typeof l === 'string') return BOERSEN_KUERZEL[l] || l
    const kuerzel = BOERSEN_KUERZEL[l.boerse] || l.boerse
    const art = [l.futures ? 'F' : '', l.spot ? 'S' : ''].filter(Boolean).join('·')
    return art ? `${kuerzel} ${art}` : kuerzel
}

function listungText(l) {
    if (typeof l === 'string') return t('hype.gelistetAuf', { b: boerseName(l) })
    const teile = []
    if (l.futures) teile.push(t('hype.marktFutures'))
    if (l.spot) teile.push(t('hype.marktSpot'))
    return `${boerseName(l.boerse)}: ${teile.join(' + ') || '—'}`
}

// ── Favoriten & Livedaten ───────────────────────────────────────────────
const favoriten = ref([])
const liveOffen = ref(null)
const liveLaedt = ref(false)
let liveTakt = null

const favSchluessel = (k) => `${k.symbol}|${k.chain || ''}`
const favNach = computed(() => new Map(favoriten.value.map((f) => [favSchluessel(f), f])))
const istFav = (k) => favNach.value.has(favSchluessel(k))

async function ladeFavoriten() {
    try {
        const r = await axios.get('/api/hype-radar/favoriten')
        favoriten.value = r.data || []
    } catch (e) {
        logWarn('hype-radar', 'Favoriten konnten nicht geladen werden', e)
    }
}

async function favUmschalten(k) {
    const vorhanden = favNach.value.get(favSchluessel(k))
    try {
        if (vorhanden) {
            await axios.delete(`/api/hype-radar/favoriten/${vorhanden.id}`)
            if (liveOffen.value?.favorit?.id === vorhanden.id) liveSchliessen()
        } else {
            await axios.post('/api/hype-radar/favoriten', {
                symbol: k.symbol,
                name: k.name,
                chain: k.chain,
                contractAddress: k.contractAddress,
                pairAddress: k.pairAddress,
                narrative: k.narrative,
            })
        }
        await ladeFavoriten()
    } catch (e) {
        logWarn('hype-radar', 'Favorit konnte nicht umgeschaltet werden', e)
    }
}

async function favEntfernen(f) {
    try {
        await axios.delete(`/api/hype-radar/favoriten/${f.id}`)
        liveSchliessen()
        await ladeFavoriten()
    } catch (e) {
        logWarn('hype-radar', 'Favorit konnte nicht entfernt werden', e)
    }
}

async function liveOeffnen(f) {
    // Zweiter Klick auf denselben Chip schliesst.
    if (liveOffen.value?.favorit?.id === f.id) { liveSchliessen(); return }
    liveSchliessen()
    liveLaedt.value = true
    // Sofort ein Gerüst zeigen, damit der Klick sichtbar ankommt.
    liveOffen.value = { favorit: f, stand: 0, markt: null, listungen: [], letzterLauf: null }
    await liveNachladen(f.id)
    /*
     * Alle 60 s nachladen, solange die Ansicht offen ist — im Takt des
     * Server-Zwischenspeichers. Öfter zu fragen brächte nur denselben Stand.
     */
    liveTakt = setInterval(() => liveNachladen(f.id), 60000)
}

async function liveNachladen(id) {
    try {
        const r = await axios.get(`/api/hype-radar/live/${id}`)
        // Nur übernehmen, wenn die Ansicht noch zu diesem Favoriten gehört.
        if (liveOffen.value?.favorit?.id === id) liveOffen.value = r.data
    } catch (e) {
        logWarn('hype-radar', 'Livedaten konnten nicht geladen werden', e)
    } finally {
        liveLaedt.value = false
    }
}

function liveSchliessen() {
    liveOffen.value = null
    if (liveTakt) { clearInterval(liveTakt); liveTakt = null }
}

// ── Alarme ──────────────────────────────────────────────────────────────
const alarme = ref([])
const testLaeuft = ref(false)
const testErgebnis = ref('')
let alarmTakt = null

const ungeleseneAlarme = computed(() => alarme.value.filter((a) => !a.gelesen))
const ungelesenJeFavorit = computed(() => {
    const zaehler = {}
    for (const a of ungeleseneAlarme.value) zaehler[a.favoritId] = (zaehler[a.favoritId] || 0) + 1
    return zaehler
})

/*
 * Favoritenleiste und Alarmliste sind gedeckelt.
 *
 * Beide wuchsen vorher ungebremst: zwanzig Favoriten umbrachen am Telefon in
 * sieben bis zehn Zeilen und schoben Alarme und Quadrant unter die
 * Bildschirmkante. Der Deckel ist keine Beschränkung der Sache, nur der
 * Ansicht — ausgeklappt steht alles da.
 */
const FAV_SICHTBAR = 8
const ALARM_SICHTBAR = 12

// Die Leiste gehört zum Gerät (kleiner Bildschirm = eher zugeklappt), deshalb
// localStorage. Die Alarmliste dagegen ist ein Blick auf „was gerade war" und
// startet bewusst jedes Mal bei den neuesten zwölf.
const favAlleZeigen = ref(localStorage.getItem('hypeFavAlle') === '1')
const alarmeAlleZeigen = ref(false)

function favAlleUmschalten() {
    favAlleZeigen.value = !favAlleZeigen.value
    localStorage.setItem('hypeFavAlle', favAlleZeigen.value ? '1' : '0')
}

const sichtbareFavoriten = computed(() =>
    (favAlleZeigen.value ? favoriten.value : favoriten.value.slice(0, FAV_SICHTBAR)))
/** Wie viele Chips der Deckel verbirgt — auch ausgeklappt, sonst verschwände der Knopf. */
const versteckteFavoriten = computed(() => Math.max(0, favoriten.value.length - FAV_SICHTBAR))
const verstecktUngelesen = computed(() => favoriten.value.slice(FAV_SICHTBAR)
    .reduce((n, f) => n + (ungelesenJeFavorit.value[f.id] || 0), 0))

const sichtbareAlarme = computed(() =>
    (alarmeAlleZeigen.value ? alarme.value : alarme.value.slice(0, ALARM_SICHTBAR)))

async function ladeAlarme() {
    try {
        const r = await axios.get('/api/hype-radar/alarme')
        alarme.value = r.data || []
    } catch (e) {
        logWarn('hype-radar', 'Alarme konnten nicht geladen werden', e)
    }
}

async function alarmeGelesen() {
    try {
        await axios.patch('/api/hype-radar/alarme/gelesen', { ids: 'alle' })
        await ladeAlarme()
    } catch (e) {
        logWarn('hype-radar', 'Alarme konnten nicht markiert werden', e)
    }
}

/*
 * Löschen: zwei Klicks wie bei den Berichten — der erste schärft, der zweite
 * löscht. Ein eigener Merker je Zeile und einer für „alle", damit das Schärfen
 * einer einzelnen Zeile nicht am Sammelknopf hängenbleibt.
 */
const alarmLoeschId = ref(null)
const alarmAlleScharf = ref(false)

async function alarmLoeschen(id) {
    if (alarmLoeschId.value !== id) {
        alarmLoeschId.value = id
        setTimeout(() => { if (alarmLoeschId.value === id) alarmLoeschId.value = null }, 4000)
        return
    }
    alarmLoeschId.value = null
    try {
        await axios.delete(`/api/hype-radar/alarme/${id}`)
        alarme.value = alarme.value.filter((a) => a.id !== id)
    } catch (e) {
        logWarn('hype-radar', 'Alarm konnte nicht gelöscht werden', e)
    }
}

async function alarmeAlleLoeschen() {
    if (!alarmAlleScharf.value) {
        alarmAlleScharf.value = true
        setTimeout(() => { alarmAlleScharf.value = false }, 4000)
        return
    }
    alarmAlleScharf.value = false
    try {
        await axios.delete('/api/hype-radar/alarme')
        alarme.value = []
    } catch (e) {
        logWarn('hype-radar', 'Alarme konnten nicht gelöscht werden', e)
    }
}

async function stummUmschalten(f) {
    try {
        const r = await axios.patch(`/api/hype-radar/favoriten/${f.id}`, { stumm: !f.stumm })
        f.stumm = r.data.stumm
        await ladeFavoriten()
        if (liveOffen.value?.favorit?.id === f.id) liveOffen.value.favorit.stumm = r.data.stumm
    } catch (e) {
        logWarn('hype-radar', 'Stumm-Schalter fehlgeschlagen', e)
    }
}

async function kanaeleTesten() {
    testLaeuft.value = true
    testErgebnis.value = ''
    try {
        const r = await axios.post('/api/hype-radar/alarme/test')
        testErgebnis.value = Object.entries(r.data)
            .map(([kanal, stand]) => `${kanal}: ${stand}`).join(' · ')
    } catch (e) {
        testErgebnis.value = t('hype.testFehlgeschlagen')
    } finally {
        testLaeuft.value = false
    }
}

const preis = (p) => {
    const z = Number(p)
    if (!Number.isFinite(z) || z === 0) return '—'
    // Kleinstpreise brauchen mehr Stellen, sonst steht da nur „0.00".
    if (z < 0.01) return '$' + z.toPrecision(3)
    if (z < 1000) return '$' + z.toFixed(2)
    return '$' + Math.round(z).toLocaleString()
}

const kv = (v) => {
    const z = Number(v)
    if (!Number.isFinite(z)) return '—'
    return z.toFixed(2)
}

/*
 * Die Rollen in der Reihenfolge, in der sie im Lauf vorkommen.
 *
 * `helper` stand hier bis zum 19.08.2026 und war die schlimmere Hälfte des
 * Befunds: Die Auswahl liess sich bedienen, ein Modell wählen und speichern —
 * gerufen wurde sie nie. Wer ein teures Modell dafür einstellte, bezahlte
 * nichts und bekam nichts; wer den Schlüssel dafür nicht hatte, konnte gar
 * keinen Bericht mehr erzeugen.
 */
const ROLLEN = [
    { id: 'research' },
    { id: 'editor' },
]

// Modell-Listen und globaler Anbieter — dieselben Quellen, aus denen sich
// auch die KI-Einstellungen bedienen.
const modellListen = ref({})
const globalKi = ref({ provider: '', modell: '' })

async function ladeKiQuellen() {
    try {
        const [listen, allgemein] = await Promise.all([
            axios.get('/api/ai/models'),
            axios.get('/api/ai/settings'),
        ])
        // `/api/ai/models` antwortet mit {modelle, standard, ohneSampling,
        // anbieter}; `AnbieterWahl` erwartet die Listen je Anbieter.
        modellListen.value = listen.data?.modelle || {}
        globalKi.value = {
            provider: allgemein.data?.aiProvider || '',
            modell: allgemein.data?.aiModel || '',
        }
    } catch (e) {
        logWarn('hype-radar', 'KI-Modelle konnten nicht geladen werden', e)
    }
}
/*
 * Am Telefon entfallen Quadrant und breite Tabelle. Der Helfer verlangt
 * gemessene Schmalheit UND einen groben Zeiger — ein halb breites
 * Desktop-Fenster gilt also nicht als Telefon.
 */
const istTelefon = useIstTelefon()

/*
 * Welche Ansicht gilt, sagt die Adresse: `/hype-radar` ist die Übersicht,
 * `/hype-radar/berichte` sind die Berichte. Beide teilen sich einen
 * Routen-Eintrag — die Seite wird beim Wechsel also nicht neu aufgebaut, ein
 * laufender Scan samt Fortschrittsstrom überlebt ihn.
 */
const route = useRoute()
const router = useRouter()
const reiter = computed(() => (route.params.reiter === 'berichte' ? 'berichte' : 'dashboard'))

/*
 * Der Quadrant hängt an ECharts und misst beim Zeichnen die Breite seines
 * Containers. Zurück auf der Übersicht ist der wieder sichtbar, also neu
 * zeichnen — vorher stand das in `reiterWechseln`.
 */
watch(reiter, (r) => {
    if (r === 'dashboard') nextTick(zeichne)
})

/*
 * Einstellungen auf- und zugeklappt, wie die Schnell-Einstellungen der
 * Nachrichten. Der Zustand gehört zum Gerät und nicht in die Datenbank.
 */
const einstOffen = ref(localStorage.getItem('hypeEinstOffen') === '1')

function einstUmschalten() {
    einstOffen.value = !einstOffen.value
    localStorage.setItem('hypeEinstOffen', einstOffen.value ? '1' : '0')
}

/**
 * Die Einstellungen als ein Satz — „alle 6 h · ab Hype 60 · Top 10 · …".
 *
 * Zugeklappt ist das die einzige Auskunft darüber, wie die Funde zustande
 * kamen. Deshalb stehen hier Takt, Schwelle und Quellen und nicht die
 * Gewichte: sie entscheiden, was überhaupt in der Liste landet.
 */
const einstZusammenfassung = computed(() => {
    const e = einst.value
    if (!e) return ''
    const quellen = Object.entries(e.quellen || {}).filter(([, an]) => an).map(([q]) => q)
    const kanaele = Object.entries(e.alarmKanaele || {}).filter(([, k]) => k?.an).map(([k]) => k)
    const teile = [
        e.aktiv ? t('hype.zAlle', { n: e.intervallStunden || 1 }) : t('hype.zManuell'),
        t('hype.zMinHype', { n: e.minHypeScore ?? 0 }),
        t('hype.zTop', { n: e.berichtTopN ?? 0 }),
        quellen.length ? t('hype.zQuellen', { q: quellen.join(' + ') }) : t('hype.zKeineQuellen'),
        kanaele.length ? t('hype.zKanaele', { k: kanaele.join(', ') }) : t('hype.zKeineKanaele'),
    ]
    return teile.join(' · ')
})

const kandidaten = ref([])
const berichte = ref([])
const offenerBericht = ref(null)
const einst = ref(null)
const stufen = ref([])
/*
 * Quellen, für die sich ein Schlüssel lohnt — und wo man ihn herbekommt.
 *
 * Die Namen sind dieselben wie in `SCHLUESSEL_SPALTEN` auf dem Server
 * (`server/hype-radar/einstellungen.js`); daran hängt der Schreibweg.
 *
 * Nur noch CoinGecko, und dort ist der Schlüssel OPTIONAL: Er ist gratis und
 * hebt bloss das Abruflimit von etwa 30 auf 500 Aufrufe je Minute. Die
 * Pflicht-Schlüsselquellen sind am 21.08.2026 entfallen.
 */
const SCHLUESSEL_QUELLEN = {
    coingecko: { url: 'https://www.coingecko.com/en/developers/dashboard', optional: true },
}

/** Liegt für diese Quelle schon ein Schlüssel? Erkennbar an der Maske. */
function schluesselDa(q) {
    return String(einst.value?.schluessel?.[q] || '').includes('•')
}

const fehlendeSchluessel = ref([])
const ordnung = ref(localStorage.getItem('hypeOrdnung') || 'preis')

const laeuft = ref(false)
const meldung = ref('')
const meldungFehler = ref(false)
const fortschritt = ref(null)
const offen = ref(null)
const loeschId = ref(null)
const filterNarrativ = ref('')
const filterStatus = ref('')
const sortFeld = ref('hypeScore')
const sortAb = ref(true)

const quadrantEl = ref(null)
let diagramm = null
let strom = null

/*
 * Drei Zustände, nicht zwei. `bewertet` heisst: unter der Schwelle geblieben
 * und deshalb gar nicht sicherheitsgeprüft — das ist etwas anderes als
 * „geprüft und durchgefallen" und darf nicht als bestanden gelten.
 */
const bestanden = computed(() =>
    kandidaten.value.filter((k) => k.status === 'bestanden' || k.status === 'berichtet'))
const verworfen = computed(() => kandidaten.value.filter((k) => k.status === 'verworfen'))
const nurBewertet = computed(() => kandidaten.value.filter((k) => k.status === 'bewertet'))

const narrativeInDaten = computed(() =>
    [...new Set(kandidaten.value.map((k) => k.narrative).filter(Boolean))].sort())

const heissestesNarrativ = computed(() => {
    const zaehler = {}
    for (const k of bestanden.value) {
        if (k.narrative) zaehler[k.narrative] = (zaehler[k.narrative] || 0) + 1
    }
    return Object.entries(zaehler).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
})

/*
 * Trittbrettfahrer: ein Fund, dessen Name einen etablierten enthält und
 * etwas anhängt. Die Bewertung zieht dafür ab und legt das Merkmal in
 * `sozialDaten.trittbrett` ab — die Anzeige holt es von dort.
 */
const trittbrett = (k) => k.sozialDaten?.trittbrett?.ja === true
const trittbrettAnzahl = computed(() => kandidaten.value.filter(trittbrett).length)
const ohneTrittbrett = ref(false)

const gefiltert = computed(() => {
    let liste = kandidaten.value
    if (ohneTrittbrett.value) liste = liste.filter((k) => !trittbrett(k))
    if (filterNarrativ.value) liste = liste.filter((k) => k.narrative === filterNarrativ.value)
    if (filterStatus.value === 'verworfen') liste = liste.filter((k) => k.status === 'verworfen')
    else if (filterStatus.value === 'bewertet') liste = liste.filter((k) => k.status === 'bewertet')
    else if (filterStatus.value === 'bestanden') {
        liste = liste.filter((k) => k.status === 'bestanden' || k.status === 'berichtet')
    }
    liste = liste.filter(passtBoersenfilter)

    const f = sortFeld.value
    return [...liste].sort((a, b) => {
        /*
         * Fehlwerte ans ENDE, in beide Richtungen.
         *
         * Vorher stand hier `a[f] ?? 0`. Ein nicht gemessener Wert wurde damit
         * zur Null und stand aufsteigend ganz oben — bei einer Kostenspalte
         * sah der ungemessene Fund wie der günstigste der Liste aus. Derselbe
         * Fehler steckte im Coin-Radar und ist dort am 21.08.2026 behoben
         * worden; hier blieb er stehen.
         */
        const av = a[f]
        const bv = b[f]
        const aOhne = av === null || av === undefined || av === ''
        const bOhne = bv === null || bv === undefined || bv === ''
        if (aOhne && bOhne) return 0
        if (aOhne) return 1
        if (bOhne) return -1
        const cmp = typeof av === 'string' ? String(av).localeCompare(String(bv)) : av - bv
        return sortAb.value ? -cmp : cmp
    })
})

const gewichtSumme = computed(() =>
    Object.values(einst.value?.gewichte || {}).reduce((a, b) => a + (Number(b) || 0), 0))

const fortschrittText = computed(() => {
    const f = fortschritt.value
    if (!f) return ''
    const s = t('hype.schritt_' + f.schritt)
    if (f.fertig && f.gesamt) return `${s} ${f.fertig}/${f.gesamt}`
    if (f.anzahl !== undefined) return `${s}: ${f.anzahl}`
    if (f.gesamt) return `${s} (${f.gesamt})`
    return s
})

const geld = (n) => {
    const z = Number(n)
    if (!Number.isFinite(z) || z === 0) return '—'
    if (z >= 1e6) return `${(z / 1e6).toFixed(1)} M`
    if (z >= 1e3) return `${Math.round(z / 1e3)} k`
    return String(Math.round(z))
}

const alter = (stunden) => {
    const h = Number(stunden)
    if (!Number.isFinite(h)) return '—'
    if (h < 48) return `${Math.round(h)} h`
    return `${Math.round(h / 24)} d`
}

const zeitpunkt = (ms) => new Date(Number(ms)).toLocaleString(
    locale.value === 'en' ? 'en-GB' : 'de-CH',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function sortiere(feld) {
    if (sortFeld.value === feld) sortAb.value = !sortAb.value
    else { sortFeld.value = feld; sortAb.value = true }
}

// ── Laden ───────────────────────────────────────────────────────────────
async function ladeKandidaten() {
    try {
        const r = await axios.get('/api/hype-radar/kandidaten')
        kandidaten.value = r.data || []
        await nextTick()
        zeichne()
    } catch (e) {
        logWarn('hype-radar', 'Kandidaten konnten nicht geladen werden', e)
    }
}

async function ladeBerichte() {
    try {
        const r = await axios.get('/api/hype-radar/berichte')
        berichte.value = r.data || []
        if (berichte.value.length && !offenerBericht.value) await berichtOeffnen(berichte.value[0].id)
    } catch (e) {
        logWarn('hype-radar', 'Berichte konnten nicht geladen werden', e)
    }
}

async function berichtOeffnen(id) {
    try {
        const r = await axios.get(`/api/hype-radar/berichte/${id}`)
        offenerBericht.value = r.data
    } catch (e) {
        logWarn('hype-radar', 'Bericht konnte nicht geöffnet werden', e)
    }
}

async function berichtLoeschen(id) {
    // Zwei Klicks: der erste schärft, der zweite löscht.
    if (loeschId.value !== id) {
        loeschId.value = id
        setTimeout(() => { if (loeschId.value === id) loeschId.value = null }, 4000)
        return
    }
    loeschId.value = null
    try {
        await axios.delete(`/api/hype-radar/berichte/${id}`)
        if (offenerBericht.value?.id === id) offenerBericht.value = null
        await ladeBerichte()
    } catch (e) {
        logWarn('hype-radar', 'Bericht konnte nicht gelöscht werden', e)
    }
}

async function ladeEinstellungen() {
    try {
        const r = await axios.get(`/api/hype-radar/einstellungen?ordnung=${ordnung.value}`)
        const { stufen: st, fehlendeSchluessel: fs, ...rest } = r.data
        einst.value = rest
        stufen.value = st || []
        fehlendeSchluessel.value = fs || []
    } catch (e) {
        logWarn('hype-radar', 'Einstellungen konnten nicht geladen werden', e)
    }
}

async function speichern() {
    if (!einst.value) return
    try {
        /*
         * Die Geheimnisse gehen MIT: der Server übernimmt nur Werte ohne
         * Maskierungspunkte — ein unangetastetes Feld überschreibt also nie
         * den gespeicherten Schlüssel, ein neu eingetipptes schon.
         */
        const r = await axios.put('/api/hype-radar/einstellungen', einst.value)
        fehlendeSchluessel.value = r.data?.fehlendeSchluessel || []
    } catch (e) {
        logWarn('hype-radar', 'Einstellungen konnten nicht gespeichert werden', e)
    }
}

function ordnungWechseln(o) {
    ordnung.value = o
    localStorage.setItem('hypeOrdnung', o)
    ladeEinstellungen()
}

function stufeGewaehlt(s) {
    einst.value.llmStufe = s.id
    // Die Stufe legt auch die Betriebsart fest — sonst stünde „gründlich"
    // in der Auswahl und der Lauf machte trotzdem einen einzelnen Aufruf.
    einst.value.llmModus = s.modus
    /*
     * Eine Stufe zu wählen hebt die Handbelegung auf. Ohne das bliebe die
     * alte Rollenwahl bestehen und schlüge die Stufe still — der Nutzer sähe
     * eine Stufe markiert und bekäme die Modelle von vorgestern.
     */
    einst.value.llmRollen = {}
    speichern()
}

/*
 * Manuell ist kein eigener Schalter, sondern eine Folge: sobald eine Rolle
 * ausdrücklich belegt ist, schlägt sie die Stufe (so löst der Server auf).
 * Der Zustand wird deshalb abgeleitet und nicht doppelt gespeichert.
 */
const manuell = computed(() =>
    Object.values(einst.value?.llmRollen || {}).some((r) => r?.provider))

function manuellWaehlen() {
    // Beim Umschalten die aktuelle Stufe als Ausgangspunkt übernehmen —
    // ein leeres Formular wäre ein Rückschritt gegenüber dem, was gerade gilt.
    const s = stufen.value.find((x) => x.id === einst.value.llmStufe) || stufen.value[0]
    if (!s) return
    einst.value.llmRollen = JSON.parse(JSON.stringify(s.rollen))
    einst.value.llmModus = s.modus
    speichern()
}

function rolleSetzen(rolle, feld, wert) {
    const rollen = { ...(einst.value.llmRollen || {}) }
    const eintrag = { ...(rollen[rolle] || {}) }
    eintrag[feld] = wert
    // Anbieterwechsel verwirft das Modell — `AnbieterWahl` meldet beides,
    // aber die Reihenfolge der Ereignisse ist nicht zugesichert.
    if (feld === 'provider') eintrag.modell = ''
    rollen[rolle] = eintrag
    einst.value.llmRollen = rollen
    speichern()
}

// ── Lauf ────────────────────────────────────────────────────────────────
async function starte(mitBericht) {
    if (laeuft.value) return
    laeuft.value = true
    meldung.value = ''
    meldungFehler.value = false
    fortschritt.value = { schritt: 'sammeln' }

    strom = new AbortController()
    try {
        const antwort = await fetch(`/api/hype-radar/${mitBericht ? 'bericht' : 'scan'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            signal: strom.signal,
        })
        if (!antwort.ok) {
            const j = await antwort.json().catch(() => ({}))
            throw new Error(j.error || `HTTP ${antwort.status}`)
        }

        // Zeilenweise lesen — dasselbe Muster wie beim KI-Agenten.
        const leser = antwort.body.getReader()
        const dekoder = new TextDecoder()
        let puffer = ''
        while (true) {
            const { done, value } = await leser.read()
            if (done) break
            puffer += dekoder.decode(value, { stream: true })
            const zeilen = puffer.split('\n')
            puffer = zeilen.pop() || ''
            for (const z of zeilen) {
                if (!z.startsWith('data: ')) continue
                let e
                try { e = JSON.parse(z.slice(6)) } catch { continue }
                verarbeite(e, mitBericht)
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

function verarbeite(e, mitBericht) {
    if (e.type === 'fortschritt') { fortschritt.value = e; return }
    if (e.type === 'fehler') {
        meldung.value = e.fehler
        meldungFehler.value = true
        return
    }
    if (e.type !== 'fertig') return

    const ausgefallen = Object.entries(e.quellenStand || {})
        .filter(([, s]) => !s.ok).map(([n]) => n)
    const teil = ausgefallen.length ? ' ' + t('hype.quellenAusgefallen', { q: ausgefallen.join(', ') }) : ''

    if (mitBericht) {
        meldung.value = t('hype.berichtFertig', { n: e.bericht?.kandidaten?.length || 0 }) + teil
        ladeBerichte()
        if (reiter.value !== 'berichte') router.push('/hype-radar/berichte')
    } else {
        meldung.value = t('hype.scanFertig', { b: e.bestanden, v: e.verworfen }) + teil
    }
    ladeKandidaten()
}

/** Ein Wert mit Beschriftung — leere Werte fallen ganz weg. */
function zeile(label, wert) {
    if (wert === null || wert === undefined || wert === '' || wert === '—') return ''
    return `<div style="display:flex;gap:.6rem;justify-content:space-between">`
        + `<span style="opacity:.65">${label}</span><span>${wert}</span></div>`
}

/**
 * Was der Zeiger über einen Punkt sagt.
 *
 * Vorher standen dort die zwei Achsenwerte und die Sicherheitsnote — also
 * genau das, was die Position und die Farbe ohnehin schon zeigten. Alles
 * Übrige (Thema, Liquidität, Alter, Handelsplatz, Verwerfungsgrund) lag im
 * Kandidaten bereit und wurde nicht genutzt.
 */
function zeigerText(k, value = []) {
    const symbol = k?.symbol || value[3] || '?'
    const m = k?.marktDaten || {}
    const tritt = k?.sozialDaten?.trittbrett

    const kopf = `<strong style="font-size:1.05em">${symbol}</strong>`
        + (k?.chain ? `<span style="opacity:.6;margin-left:.4rem">${k.chain}</span>` : '')
        + (k?.name && k.name !== symbol ? `<div style="opacity:.7;font-size:.9em">${k.name}</div>` : '')

    const noten = zeile(t('hype.spalteHype'), k?.hypeScore)
        + zeile(t('hype.spalteSafety'), k?.status === 'verworfen' ? '—' : k?.safetyScore)
        + zeile(t('hype.achseX'), Math.round(Number(value[0]) || 0))
        + zeile(t('hype.achseY'), Math.round(Number(value[1]) || 0))

    const pct = (w) => (Number.isFinite(Number(w))
        ? `<span style="color:${Number(w) >= 0 ? '#4caf50' : '#ef5350'}">`
            + `${Number(w) >= 0 ? '+' : ''}${Number(w).toFixed(1)} %</span>`
        : null)

    const markt = zeile(t('hype.spalteNarrativ'), k?.narrative)
        + zeile(t('hype.spalteLiq'), geld(m.liquiditaetUsd))
        + zeile(t('hype.liveVol24'), geld(m.volumen24h))
        // Die kurzen Fenster zuerst: bei einem frischen Fund sagt die letzte
        // Stunde mehr über das, was gerade läuft, als der Tagesschnitt.
        + zeile('1 h', pct(m.aenderung1h))
        + zeile('6 h', pct(m.aenderung6h))
        + zeile('24 h', pct(m.aenderung24h))
        + zeile(t('hype.spalteAlter'), alter(m.paarAlterStunden))
        + zeile(t('hype.quellenAnzahl', { n: k?.sozialDaten?.quellenAnzahl ?? 0 }),
            (k?.quellen || []).map((q) => q.quelle).join(', '))
        + zeile(t('hype.spalteHandelbar'),
            [m.dex, ...(m.listungen || []).map(listungKuerzel)].filter(Boolean).join(' · '))

    let fuss = ''
    // Gekaufte Sichtbarkeit ist der wichtigste Vorbehalt zu einer hohen
    // Aufmerksamkeit — sie gehört deshalb sichtbar an den Fund, nicht in eine
    // Fussnote der Rechnung.
    if (Number(m.boosts) > 0) {
        fuss += `<div style="color:#ffb300;margin-top:.35rem">`
            + `${t('hype.boostHinweis', { n: m.boosts })}</div>`
    }
    if (k?.status === 'verworfen') {
        const g = t('hype.grund_' + k.verworfenGrund)
        fuss += `<div style="color:#ef5350;margin-top:.35rem">✕ `
            + `${g === 'hype.grund_' + k.verworfenGrund ? k.verworfenGrund : g}</div>`
    }
    if (tritt?.ja) {
        fuss += `<div style="color:#ffb300;margin-top:.2rem">`
            + `${t('hype.trittbrettHilfeEinzeln', { v: tritt.vorbild })}</div>`
    }
    // Der Hinweis auf den Klick gehört hierher: ohne ihn fände niemand
    // heraus, dass sich ein Fund direkt aus dem Bild anheften lässt.
    fuss += `<div style="opacity:.55;margin-top:.4rem;font-size:.9em">`
        + `${istFav(k || {}) ? t('hype.zeigerAbheften') : t('hype.zeigerAnheften')}</div>`

    const trenner = '<div style="border-top:1px solid rgba(255,255,255,.12);margin:.35rem 0"></div>'
    return kopf + trenner + noten + (markt ? trenner + markt : '') + fuss
}

// ── Quadrant ────────────────────────────────────────────────────────────
function zeichne() {
    if (!quadrantEl.value || reiter.value !== 'dashboard') return
    if (!kandidaten.value.length) return

    /*
     * X: Marktbestätigung (Volumen-Teilnote), Y: Aufmerksamkeit (Sozial- und
     * Quellen-Teilnote). Verworfene bleiben drin, aber grau — sie zeigen, wie
     * viel Lärm es gab, ohne dass sie mit einer Sicherheitsfarbe geadelt
     * würden, die sie nicht haben.
     */
    /*
     * Der ganze Kandidat hängt am Punkt, nicht nur die fünf Zahlen fürs
     * Zeichnen. Der Zeiger zeigte vorher vier Werte, obwohl zu jedem Fund ein
     * Dutzend vorliegt — und ohne den Kandidaten liesse sich aus dem Diagramm
     * heraus auch nichts anheften.
     */
    const punkt = (k) => {
        const tn = k.sozialDaten?.teilnoten || {}
        const aufmerksamkeit = ((Number(tn.sozial) || 0) + (Number(tn.quellen) || 0)) / 2
        return {
            value: [Number(tn.volumen) || 0, aufmerksamkeit, k.safetyScore, k.symbol, k.status],
            k,
        }
    }

    const gut = bestanden.value.map(punkt)
    const schlecht = verworfen.value.map(punkt)
    const neutral = nurBewertet.value.map(punkt)

    diagramm?.dispose()
    diagramm = echarts.init(quadrantEl.value)
    /*
     * Klick auf einen Punkt heftet an oder ab — dieselbe Wirkung wie der Stern
     * in der Tabelle. Ohne das müsste man einen auffälligen Punkt erst in
     * einer Liste von hundert Zeilen wiederfinden.
     */
    diagramm.on('click', (p) => { if (p?.data?.k) favUmschalten(p.data.k) })
    diagramm.getZr().on('mousemove', (e) => {
        diagramm.getZr().setCursorStyle(e.target ? 'pointer' : 'default')
    })
    diagramm.setOption({
        /*
         * Rechts mehr Luft: Die stärksten Funde liegen bei 100 auf der
         * Marktbestätigung, und ihr Namensschild ragte über den Rand hinaus.
         * Oben Platz für die Legende.
         */
        grid: { left: 55, right: 65, top: 46, bottom: 45 },
        /*
         * Die Legende erklärt das Farbschema, statt es erraten zu lassen.
         * Ohne sie musste man aus den Punkten schliessen, dass Grün „hat die
         * Sicherheitsprüfung bestanden" heisst — und die Farbe ist hier der
         * einzige Träger dieser Information.
         */
        legend: {
            top: 4, right: 0, icon: 'circle', itemGap: 18,
            textStyle: { color: '#b3b8bd', fontSize: 12 },
            inactiveColor: '#5a5f66',
        },
        tooltip: {
            trigger: 'item',
            confine: true,
            extraCssText: 'max-width:320px;white-space:normal;line-height:1.5;',
            formatter: (p) => zeigerText(p.data?.k, p.value),
        },
        xAxis: {
            type: 'value', min: 0, max: 100, name: t('hype.achseX'), nameLocation: 'middle', nameGap: 28,
            nameTextStyle: { color: '#9aa0a6', fontSize: 12 },
            axisLabel: { color: '#b3b8bd', fontSize: 12 },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,.09)' } },
        },
        yAxis: {
            type: 'value', min: 0, max: 100, name: t('hype.achseY'), nameLocation: 'middle', nameGap: 35,
            nameTextStyle: { color: '#9aa0a6', fontSize: 12 },
            axisLabel: { color: '#b3b8bd', fontSize: 12 },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,.09)' } },
        },
        series: [
            {
                /*
                 * Der Hintergrund: alles, was unter der Schwelle blieb. Ohne
                 * dieses Feld hätte der Quadrant an manchen Tagen zwei Punkte
                 * und zeigte nichts, wovon sich etwas abheben könnte.
                 *
                 * Er darf gedämpft sein, aber nicht unsichtbar: bei 30 %
                 * Deckkraft auf sechs Pixeln war auf schwarzem Grund kaum noch
                 * etwas zu erkennen. Der dunkle Ring trennt zusätzlich die
                 * Punkte, die sich am rechten Rand stapeln.
                 */
                type: 'scatter', name: t('hype.unterSchwelle'), data: neutral,
                symbolSize: 9,
                itemStyle: {
                    color: 'rgba(150,170,200,.6)',
                    borderColor: 'rgba(0,0,0,.7)', borderWidth: 1,
                },
                emphasis: { scale: 1.6 },
            },
            {
                type: 'scatter', name: t('hype.verworfen'), data: schlecht,
                symbolSize: 11,
                itemStyle: {
                    color: 'rgba(239,83,80,.7)',
                    borderColor: 'rgba(0,0,0,.7)', borderWidth: 1,
                },
                emphasis: { scale: 1.5 },
                /*
                 * Auch die Verworfenen bekommen ihren Namen — es sind wenige
                 * (typisch fünf bis fünfzehn), und gerade bei ihnen ist die
                 * Frage „welcher war das?" naheliegend. Die neunzig unter der
                 * Schwelle bleiben unbeschriftet: Namen an jedem Punkt wären
                 * ein Buchstabenbrei, in dem man nichts mehr fände. Für sie
                 * nennt der Zeiger den Namen.
                 */
                label: {
                    show: true, formatter: (p) => p.value[3], position: 'top',
                    color: '#c9a0a0', fontSize: 10,
                    textBorderColor: 'rgba(0,0,0,.9)', textBorderWidth: 3,
                },
                labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
            },
            {
                type: 'scatter', name: t('hype.bestanden'), data: gut,
                symbolSize: (v) => 13 + (Number(v[2]) || 0) / 7,
                itemStyle: {
                    color: (p) => {
                        const s = Number(p.value[2]) || 0
                        return s >= 70 ? '#4caf50' : (s >= 40 ? '#ffb300' : '#ef5350')
                    },
                    // Heller Ring: Diese Punkte sind die Aussage des Bildes und
                    // sollen sich auch dann abheben, wenn sie auf einem Nachbarn
                    // liegen.
                    borderColor: 'rgba(255,255,255,.85)', borderWidth: 1.5,
                    shadowBlur: 8, shadowColor: 'rgba(0,0,0,.6)',
                },
                emphasis: { scale: 1.4 },
                label: {
                    show: true, formatter: (p) => p.value[3], position: 'top',
                    color: '#e6e8ea', fontSize: 11, fontWeight: 600,
                    textBorderColor: 'rgba(0,0,0,.9)', textBorderWidth: 3,
                },
                // Schilder weichen einander aus statt sich zu überlagern; was
                // dann immer noch kollidiert, wird lieber weggelassen als
                // unlesbar übereinandergelegt.
                labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
                // Die Trennlinien machen die vier Felder erst lesbar.
                markLine: {
                    silent: true, symbol: 'none',
                    lineStyle: { color: 'rgba(255,255,255,.22)', type: 'dashed' },
                    label: { show: false },
                    data: [{ xAxis: 50 }, { yAxis: 50 }],
                },
                markArea: {
                    silent: true,
                    itemStyle: { color: 'rgba(255,179,0,.05)' },
                    label: {
                        show: true, position: 'insideTop',
                        color: '#b3b8bd', fontSize: 12,
                    },
                    data: [[
                        { name: t('hype.quadrantObenLinks'), xAxis: 0, yAxis: 50 },
                        { xAxis: 50, yAxis: 100 },
                    ], [
                        { name: t('hype.quadrantObenRechts'), xAxis: 50, yAxis: 50, itemStyle: { color: 'rgba(76,175,80,.06)' } },
                        { xAxis: 100, yAxis: 100 },
                    ]],
                },
            },
        ],
    })
}

const beiGroesse = () => diagramm?.resize()

onMounted(async () => {
    window.addEventListener('resize', beiGroesse)
    await Promise.all([
        ladeKandidaten(), ladeBerichte(), ladeEinstellungen(),
        ladeFavoriten(), ladeAlarme(), ladeKiQuellen(),
    ])
    // Der Wachhund läuft serverseitig weiter — die Liste holt seine Funde in
    // gemächlichem Takt nach, solange die Seite offen ist.
    alarmTakt = setInterval(ladeAlarme, 60000)
})

onBeforeUnmount(() => {
    window.removeEventListener('resize', beiGroesse)
    strom?.abort()
    diagramm?.dispose()
    // Die Takte dürfen die Seite nicht überleben.
    if (liveTakt) clearInterval(liveTakt)
    if (alarmTakt) clearInterval(alarmTakt)
})

watch(locale, () => zeichne())
</script>

<style scoped>
.hyp {
    padding: .5rem 0;
}

.hypKopf {
    display: flex;
    align-items: flex-end;
    gap: 1rem;
    flex-wrap: wrap;
}

/* Zahnrad + Klartextzeile stehen da, wo vorher die Reiter standen. */
.hypEinstKopf {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: .5rem;
    padding-bottom: .35rem;
}

.hypEinstZeile {
    font-size: .76rem;
    color: var(--white-60, rgba(255, 255, 255, .6));
    cursor: pointer;
}

.hypEinstZeile:hover {
    color: var(--white-87);
}

.hypKnoepfe {
    display: flex;
    align-items: center;
    gap: .5rem;
    padding-bottom: .35rem;
}

.hypFortschritt {
    font-size: .897rem;
    color: var(--grey-color, #9aa0a6);
}

.hypKennzahlen {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: .75rem;
    margin-bottom: 1.25rem;
}

.hypZelle {
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border-radius: var(--border-radius, 8px);
    padding: .7rem .85rem;
}

.hypWert {
    font-size: 1.495rem;
    font-weight: 600;
    line-height: 1.2;
}

.hypLabel {
    font-size: .874rem;
    color: var(--grey-color, #9aa0a6);
}

.hypKlein {
    font-size: .782rem;
    opacity: .75;
}

.hypBlock {
    margin-bottom: 1.75rem;
}

.hypTitel {
    font-size: 1.092rem;
    font-weight: 600;
    margin-bottom: .15rem;
}

.hypHinweis {
    font-size: .897rem;
    color: var(--grey-color, #9aa0a6);
    margin-bottom: .6rem;
}

.hypHinweisKlein {
    font-size: .805rem;
    color: var(--grey-color, #9aa0a6);
    margin-left: .35rem;
}

.hypQuadrant {
    width: 100%;
    height: 360px;
}

.hypChip {
    font-size: .828rem;
    padding: .1rem .5rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, .06);
    cursor: pointer;
    user-select: none;
}

.hypChip.aktiv {
    background: var(--blue-color, #4da3ff);
    color: #fff;
}

.hypChip.klein {
    cursor: default;
    font-size: .782rem;
}

/* Abgeschaltet oder nicht verfügbar. Die Klasse wurde an mehreren Stellen
   referenziert, ohne je definiert zu sein — der Hinweis blieb deshalb
   unauffällig genau dort, wo er auffallen sollte. */
.hypAus {
    color: var(--grey-color, #9aa0a6);
    opacity: .85;
}

.hypAuswahl {
    width: auto;
    min-width: 9rem;
}

.hypTabelle {
    font-size: .943rem;
}

.hypTabelle th {
    font-weight: 600;
    color: var(--grey-color, #9aa0a6);
    font-size: .851rem;
    cursor: pointer;
    white-space: nowrap;
}

.hypZeile {
    cursor: pointer;
}

.hypZeile:hover {
    background: rgba(255, 255, 255, .03);
}

.hypTritt {
    color: var(--orange-color, #ffb300);
    opacity: .8;
    margin-left: .35rem;
    font-size: .8rem;
}

.hypKette {
    font-size: .782rem;
    color: var(--grey-color, #9aa0a6);
    margin-left: .4rem;
}

.hypDex {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .805rem;
    color: var(--grey-color, #9aa0a6);
    margin-right: .35rem;
}

.hypStern {
    cursor: pointer;
    margin-right: .35rem;
    color: var(--grey-color, #9aa0a6);
    opacity: .45;
    font-size: .977rem;
}

.hypStern:hover {
    opacity: 1;
}

.hypStern.aktiv {
    color: #ffb300;
    opacity: 1;
}

/* ── Favoriten & Livedaten ──────────────────────────────── */
.hypFavLeiste {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: .4rem;
    margin-bottom: .9rem;
}

.hypFavTitel {
    font-size: .897rem;
    color: var(--grey-color, #9aa0a6);
    margin-right: .3rem;
}

.hypFavChip {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .874rem;
    font-weight: 600;
    padding: .2rem .6rem;
    border-radius: 999px;
    background: var(--black-bg-2, rgba(255, 255, 255, .05));
    border: 1px solid transparent;
    color: inherit;
    cursor: pointer;
}

.hypFavChip:hover {
    border-color: var(--grey-color, #9aa0a6);
}

.hypFavChip.aktiv {
    border-color: var(--blue-color, #4da3ff);
    color: var(--blue-color, #4da3ff);
}

.hypFavKette {
    font-weight: 400;
    font-size: .736rem;
    opacity: .6;
    margin-left: .3rem;
}

.hypFavChip.stumm {
    opacity: .55;
}

/* „+12 mehr" ist ein Knopf und kein Symbol — deshalb ohne Monospace. */
.hypFavMehr {
    font-family: inherit;
    font-weight: 500;
    opacity: .8;
}

.hypFavMehr:hover {
    opacity: 1;
}

/* ── Kartenliste am Telefon ─────────────────────────────── */
.hypKarten {
    display: grid;
    gap: .4rem;
}

.hypKarte {
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border-radius: var(--border-radius, 8px);
    padding: .55rem .7rem;
}

.hypKarteKopf {
    display: flex;
    align-items: center;
    gap: .3rem;
    font-size: 1.035rem;
}

.hypKarteNoten {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .943rem;
    font-variant-numeric: tabular-nums;
}

.hypKarteZeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: .35rem;
    margin-top: .3rem;
}

.hypKarteWert {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .828rem;
    color: var(--grey-color, #9aa0a6);
}

.hypKarteHinweise {
    margin-top: .4rem;
    font-size: .828rem;
    color: var(--orange-color, #ffb300);
}

/* ── Schmale Fenster ────────────────────────────────────── */
@media (max-width: 767px) {
    /* Der Kopf stapelt: Reiter über den Knöpfen, damit beide voll
       antippbar bleiben statt sich die Zeile zu teilen. */
    .hypKopf {
        align-items: stretch;
    }

    .hypKnoepfe {
        padding-bottom: 0;
        padding-top: .5rem;
    }

    .hypKnoepfe .btn {
        flex: 1;
    }

    /* Eingabefelder der Zustellkanäle dürfen die Seite nicht breiter
       machen als das Fenster. */
    .hypKanalFelder {
        padding-left: 0;
    }

    .hypKanalFelder .form-control,
    .hypKanalFelder .form-select,
    .hypKanalFelder .hypBreit {
        width: 100%;
        min-width: 0;
    }

    .hypZahl {
        width: 100%;
    }

    .hypBerichtKarte {
        min-width: 12rem;
    }
}

.hypAlarmZahl {
    display: inline-block;
    min-width: 1.1rem;
    padding: 0 .25rem;
    margin-left: .35rem;
    border-radius: 999px;
    background: var(--red-color, #e06c75);
    color: #fff;
    font-size: .713rem;
    text-align: center;
}

.hypAlarmListe {
    display: grid;
    gap: .3rem;
}

.hypAlarm {
    display: flex;
    align-items: baseline;
    gap: .6rem;
    padding: .4rem .6rem;
    border-radius: 6px;
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border-left: 3px solid var(--grey-color, #9aa0a6);
    font-size: .92rem;
}

.hypAlarm.warnung { border-left-color: var(--orange-color, #ffb300); }
.hypAlarm.kritisch { border-left-color: var(--red-color, #e06c75); }
.hypAlarm.gelesen { opacity: .55; }

.hypAlarmSchwere {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .736rem;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--grey-color, #9aa0a6);
    flex: none;
    width: 4.5rem;
}

.hypAlarm.kritisch .hypAlarmSchwere { color: var(--red-color, #e06c75); }
.hypAlarm.warnung .hypAlarmSchwere { color: var(--orange-color, #ffb300); }

.hypAlarmText { flex: 1; }

.hypAlarmZeit {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .782rem;
    color: var(--grey-color, #9aa0a6);
    flex: none;
}

.hypAlarmWeg {
    flex: none;
    font-size: .92rem;
    opacity: .35;
    cursor: pointer;
}

.hypAlarmWeg:hover { opacity: 1; }

.hypAlarmWeg.scharf {
    color: var(--red-color, #e06c75);
    opacity: 1;
}

/* Geschärfter Sammelknopf: der zweite Klick löscht wirklich alles. */
.btn.hypScharf {
    color: var(--red-color, #e06c75);
    border-color: var(--red-color, #e06c75);
}

.hypKanal {
    padding: .5rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, .06);
}

.hypKanalFelder {
    display: flex;
    flex-wrap: wrap;
    gap: .4rem;
    margin-top: .4rem;
    padding-left: 2.4rem;
}

.hypKanalFelder .form-control,
.hypKanalFelder .form-select {
    width: auto;
    min-width: 9rem;
}

.hypKanalFelder .hypBreit {
    min-width: 22rem;
}

.hypLive {
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border: 1px solid var(--blue-color, #4da3ff);
    border-radius: var(--border-radius, 8px);
    padding: .8rem 1rem;
    margin-bottom: 1.25rem;
}

.hypLiveKopf {
    display: flex;
    align-items: center;
    gap: .35rem;
    flex-wrap: wrap;
    margin-bottom: .7rem;
}

.hypLiveStand {
    font-size: .805rem;
    color: var(--grey-color, #9aa0a6);
    margin-left: .5rem;
}

.hypLiveGrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: .6rem;
}

.hypLiveKachel {
    background: rgba(0, 0, 0, .18);
    border-radius: 6px;
    padding: .55rem .7rem;
}

.hypLiveWert {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 1.208rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.25;
}

.hypLiveBoersen .hypBoerse {
    font-size: .782rem;
}

.hypLiveTrenn {
    opacity: .4;
    font-weight: 400;
}

.hypLiveLabel {
    font-size: .782rem;
    color: var(--grey-color, #9aa0a6);
    margin-top: .1rem;
}

.hypLiveExtra {
    font-size: .805rem;
    color: var(--grey-color, #9aa0a6);
    margin-top: .1rem;
}

.hypLiveHinweise {
    margin-top: .6rem;
    font-size: .851rem;
    color: var(--orange-color, #ffb300);
}

/* Kürzel der eigenen Börsen: gefüllt, damit „hier handelbar" sich von der
   blossen Herkunftsangabe des DEX abhebt. */
.hypBoerse {
    display: inline-block;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .713rem;
    font-weight: 600;
    padding: .06rem .3rem;
    border-radius: 4px;
    background: var(--blue-color, #4da3ff);
    color: #fff;
    margin-right: .25rem;
    vertical-align: middle;
}

.hypBadge {
    font-size: .713rem;
    font-weight: 500;
}

.hypDetail {
    background: rgba(255, 255, 255, .02);
}

.hypDetailGrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1.25rem;
    padding: .35rem .25rem;
}

.hypDetailTitel {
    font-size: .851rem;
    font-weight: 600;
    margin-bottom: .35rem;
}

.hypNote {
    display: flex;
    align-items: center;
    gap: .5rem;
    font-size: .851rem;
    margin-bottom: .15rem;
}

.hypNoteName {
    width: 5.5rem;
    color: var(--grey-color, #9aa0a6);
}

.hypBalken {
    flex: 1;
    height: 5px;
    background: rgba(255, 255, 255, .07);
    border-radius: 3px;
    overflow: hidden;
}

.hypBalken i {
    display: block;
    height: 100%;
    background: var(--blue-color, #4da3ff);
}

.hypNoteWert {
    width: 2rem;
    text-align: right;
}

.hypListe {
    font-size: .874rem;
    padding-left: 1.1rem;
    margin-bottom: .25rem;
}

.hypLink {
    font-size: .851rem;
    text-decoration: none;
}

/* ── Berichte ───────────────────────────────────────────────────── */
.hypBerichtListe {
    display: flex;
    gap: .6rem;
    overflow-x: auto;
    padding-bottom: .4rem;
    margin-bottom: 1.25rem;
}

.hypBerichtKarte {
    position: relative;
    min-width: 15rem;
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border-radius: var(--border-radius, 8px);
    padding: .6rem .8rem;
    cursor: pointer;
    border: 1px solid transparent;
}

.hypBerichtKarte.aktiv {
    border-color: var(--blue-color, #4da3ff);
}

.hypBerichtDatum {
    font-size: .805rem;
    color: var(--grey-color, #9aa0a6);
}

.hypBerichtTitel {
    font-size: .977rem;
    font-weight: 600;
    margin: .1rem 0;
}

.hypBerichtMeta {
    font-size: .805rem;
    color: var(--grey-color, #9aa0a6);
}

.hypLoeschen {
    position: absolute;
    top: .4rem;
    right: .5rem;
    font-size: .92rem;
    opacity: .35;
}

.hypLoeschen:hover {
    opacity: 1;
}

.hypLoeschen.scharf {
    color: var(--red-color, #e06c75);
    opacity: 1;
}

.hypBericht {
    max-width: 62rem;
}

.hypBerichtUeberschrift {
    font-size: 1.552rem;
    font-weight: 700;
}

.hypMarktkontext {
    font-size: 1.058rem;
    color: var(--grey-color, #c9cdd2);
    margin-bottom: 1.25rem;
}

.hypKandidat {
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border-radius: var(--border-radius, 8px);
    padding: .8rem 1rem;
    margin-bottom: .75rem;
}

.hypKandidatKopf {
    display: flex;
    align-items: center;
    gap: .3rem;
    flex-wrap: wrap;
    margin-bottom: .5rem;
}

.hypKandidatName {
    font-size: .92rem;
    color: var(--grey-color, #9aa0a6);
}

.hypNoten {
    font-size: .851rem;
    color: var(--grey-color, #9aa0a6);
}

.hypAbschnitte {
    margin: 0;
    font-size: .966rem;
}

.hypAbschnitte dt {
    font-size: .828rem;
    color: var(--grey-color, #9aa0a6);
    font-weight: 600;
    margin-top: .4rem;
}

.hypAbschnitte dd {
    margin: 0 0 .2rem;
}

.hypBelege a {
    font-size: .828rem;
    margin-right: .3rem;
    text-decoration: none;
}

.hypAussortiert {
    margin-top: 1.5rem;
}

.hypDisclaimer {
    margin-top: 1.5rem;
    padding: .6rem .8rem;
    border-left: 3px solid var(--grey-color, #9aa0a6);
    font-size: .897rem;
    color: var(--grey-color, #9aa0a6);
}

/* ── Einstellungen ──────────────────────────────────────────────── */
.hypEinst {
    max-width: 46rem;
}

.hypZahl {
    width: 8rem;
}

.hypRegler {
    max-width: 26rem;
}

.hypReglerZeile {
    display: flex;
    align-items: center;
    gap: .6rem;
    margin-bottom: .2rem;
}

.hypReglerZeile label {
    width: 6rem;
    font-size: .897rem;
}

.hypReglerWert {
    width: 2rem;
    text-align: right;
    font-size: .897rem;
}

.hypSumme {
    font-size: .874rem;
    color: var(--grey-color, #9aa0a6);
    margin-top: .3rem;
}

.hypSumme.falsch {
    color: var(--orange-color, #ffb300);
}

.hypQuellen {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: .2rem 1rem;
    max-width: 40rem;
}

/* Zugangsdaten der Quellen: eine Zeile je Quelle, Feld und Bezugsquelle
   nebeneinander. Der Link daneben ist kein Schmuck — ohne ihn sucht man die
   Seite, auf der es den Schlüssel gibt, jedes Mal neu. */
.hypSchluessel {
    display: grid;
    gap: .8rem;
    max-width: 40rem;
}

.hypSchluesselFeld {
    display: flex;
    align-items: center;
    gap: .4rem;
}

.hypSchluesselFeld input {
    max-width: 20rem;
}

/* Abgeschaltete Quelle: sichtbar, aber erkennbar nicht wählbar. */
.hypAus {
    opacity: .55;
}

.hypStufen {
    display: grid;
    gap: .4rem;
    max-width: 40rem;
}

.hypStufe {
    display: block;
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border: 1px solid transparent;
    border-radius: var(--border-radius, 8px);
    padding: .5rem .75rem;
    cursor: pointer;
}

.hypStufe.aktiv {
    border-color: var(--blue-color, #4da3ff);
}

.hypStufe input {
    display: none;
}

.hypStufeKopf {
    display: flex;
    align-items: center;
    font-size: .943rem;
}

.hypStufePreis {
    font-size: .851rem;
    color: var(--grey-color, #9aa0a6);
}

.hypStufeModelle {
    font-size: .805rem;
    color: var(--grey-color, #9aa0a6);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.hypRollen {
    max-width: 40rem;
    margin-top: .6rem;
    padding: .75rem .9rem;
    background: var(--black-bg-2, rgba(255, 255, 255, .03));
    border-radius: var(--border-radius, 8px);
}

.hypRolle {
    margin-bottom: .7rem;
}

.hypRolle:last-of-type {
    margin-bottom: 0;
}

.hypRolleKopf {
    display: flex;
    align-items: baseline;
    gap: .5rem;
    font-size: .943rem;
    margin-bottom: .2rem;
}
</style>
