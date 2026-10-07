/**
 * Hype-Radar, Stufe 3: Sicherheitsprüfung.
 *
 * Das ist die Stufe, die über die Brauchbarkeit des ganzen Features
 * entscheidet. Täglich starten Tausende Token; ein erheblicher Teil ist darauf
 * angelegt, Käufer nicht wieder herauszulassen. Ein Radar ohne diese Prüfung
 * wäre nicht bloss ungenau — er wäre eine Empfehlungsmaschine für Betrug.
 *
 * Zwei Arten von Befunden:
 *
 *   **K.-o.-Kriterien** verwerfen sofort, unabhängig von der Hype-Note. Ein
 *   Token, aus dem man nicht wieder herauskommt, wird nicht dadurch besser,
 *   dass alle darüber reden — im Gegenteil.
 *
 *   **Abzüge** senken die Sicherheitsnote, ohne zu verwerfen. Sie beschreiben
 *   erhöhtes Risiko, nicht Betrug.
 *
 * Der Prüfteil ist rein: er bekommt die Antwort von GoPlus und die Marktdaten
 * und gibt ein Urteil zurück. Das Abrufen steht getrennt darunter — so lässt
 * sich das Urteil mit festen Beispieldaten prüfen, ohne ins Netz zu gehen.
 */

import { holeJson } from './quellen.js'

/** Vorgaben der harten Grenzen. Alle in den Einstellungen änderbar. */
export const STANDARD_SICHERHEIT = {
    minLiquiditaetUsd: 50000,     // darunter bewegt ein einzelner Verkauf den Kurs
    maxTop10Prozent: 40,          // ohne Sperrfrist ist das eine Ausstiegsluke
    maxFdvLiqVerhaeltnis: 100,    // Bewertung ohne Handelstiefe dahinter
    minPaarAlterStunden: 12,      // Schutz vor dem ersten Chaos nach dem Start
    lpMussGesperrtSein: true,
    maxVerkaufssteuerProzent: 10,
}

/** Ketten-Nummern für GoPlus. Solana hat einen eigenen Endpunkt. */
const KETTEN_ID = {
    ethereum: '1', bsc: '56', polygon: '137', arbitrum: '42161',
    avalanche: '43114', base: '8453', optimism: '10',
}

/** „1"/„0"/1/true → boolean. GoPlus antwortet gemischt. */
const jaNein = (w) => w === true || w === 1 || w === '1'

/**
 * „1"/„0" → true/false, alles andere → null (= die Quelle hat nichts gesagt).
 *
 * `jaNein` kennt nur zwei Antworten, und für die K.-o.-Felder ist das richtig:
 * fehlt `hidden_owner`, gibt es keinen Beleg für einen verdeckten Eigentümer.
 * Bei `is_open_source` ist dieselbe Lesart gefährlich — „fehlt" hiesse dort
 * „quelloffen" —, deshalb hat diese Funktion eine dritte Antwort.
 */
const dreiwertig = (w) => {
    if (w === true || w === 1 || w === '1') return true
    if (w === false || w === 0 || w === '0') return false
    return null
}

/*
 * In welcher Skala eine Quelle Anteile angibt.
 *
 * Bis zum 07.10.2026 wurde geraten: `summe <= 1 ? summe * 100 : summe`. Für
 * GoPlus (Bruchteile) stimmt das, für RugCheck (Prozent) nicht — dort wurden
 * 0,9 % gesperrte Liquidität als 90 % gelesen und BESTANDEN die Sperrprüfung,
 * und eine Top-10-Ballung von 0,7 % wurde zu 70 %. Ein kleiner Wert in
 * Prozentskala und ein grosser in Bruchskala sehen gleich aus; raten lässt
 * sich das nicht. Jede Übersetzung setzt die Skala deshalb ausdrücklich, und
 * ohne Angabe gilt die Sprache, die `pruefe` spricht: GoPlus, also Bruchteile.
 */
export const SKALA_BRUCH = 'bruch'
export const SKALA_PROZENT = 'prozent'
const prozentFaktor = (skala) => (skala === SKALA_PROZENT ? 1 : 100)

/** Prozentzahl aus einem Feld, das auch „0.05" (=5 %) sein kann. */
function prozent(roh) {
    /*
     * Die leere Zeichenkette ist der Normalfall, wenn GoPlus die Steuer nicht
     * ermitteln konnte — und `Number('')` ist 0. Bis zum 20.08.2026 galt ein
     * Token mit unbekannter Verkaufssteuer damit als steuerfrei und bestand
     * die Prüfung. Dieselbe Falle wie bei `Number(null)` an vier anderen
     * Stellen dieses Hauses; hier ist sie am teuersten, weil eine hohe
     * Verkaufssteuer genau das Muster ist, gegen das die Stufe gebaut wurde.
     */
    if (roh === '' || roh === null || roh === undefined) return null
    const z = Number(roh)
    if (!Number.isFinite(z)) return null
    // GoPlus liefert Steuern als Anteil (0.05), nicht als Prozent.
    return z <= 1 ? z * 100 : z
}

/**
 * Urteil über einen Kandidaten — rein, ohne Netz.
 *
 * @param {object} goplus   Rohantwort zu genau diesem Vertrag (kann null sein)
 * @param {object} markt    Marktdaten aus DexScreener
 * @param {object} regeln   Grenzwerte
 * @returns {{status:'bestanden'|'verworfen', grund:string, safetyScore:number, flaggen:object, hinweise:string[]}}
 */
export function pruefe(goplus, markt = {}, regeln = STANDARD_SICHERHEIT) {
    const r = { ...STANDARD_SICHERHEIT, ...(regeln || {}) }
    const hinweise = []
    const flaggen = {}

    // ── Marktseitige K.-o.-Kriterien ────────────────────────────────────
    // Sie gelten auch ohne GoPlus-Antwort: zu wenig Liquidität ist zu wenig
    // Liquidität, ganz gleich wie der Vertrag aussieht.
    const liq = Number(markt.liquiditaetUsd) || 0
    if (liq < r.minLiquiditaetUsd) {
        return verworfen('liquiditaet_zu_klein',
            `Liquidität ${Math.round(liq)} USD unter ${r.minLiquiditaetUsd}`, flaggen, hinweise)
    }

    const alter = Number(markt.paarAlterStunden)
    if (Number.isFinite(alter) && alter < r.minPaarAlterStunden) {
        return verworfen('zu_jung',
            `Paar erst ${alter.toFixed(1)} h alt (Mindestalter ${r.minPaarAlterStunden} h)`, flaggen, hinweise)
    }

    // ── Vertragsseitige K.-o.-Kriterien ─────────────────────────────────
    if (!goplus) {
        /*
         * Keine Antwort ist kein Freibrief.
         *
         * Ein Vertrag, über den sich nichts sagen lässt, wird nicht behandelt
         * wie einer, der geprüft wurde — er kommt in den Bericht nur als
         * aussortiert. Die Alternative wäre, ungeprüfte Token unter „Top-
         * Kandidaten" zu führen, und genau das darf nicht passieren.
         */
        return verworfen('ungeprueft',
            'Keine Sicherheitsdaten verfügbar — ungeprüft wird nicht empfohlen', flaggen, hinweise)
    }

    const faktor = prozentFaktor(goplus.anteilSkala)

    flaggen.honeypot = jaNein(goplus.is_honeypot)
    if (flaggen.honeypot) {
        return verworfen('honeypot', 'Verkauf ist gesperrt (Honeypot)', flaggen, hinweise)
    }

    /*
     * Vollmachten, mit denen der Eigentümer Käufer jederzeit festsetzen oder
     * enteignen kann. Bis zum 07.10.2026 las die Prüfung zehn GoPlus-Felder;
     * diese hier standen in jeder EVM-Antwort und wurden übergangen — ein
     * geschlossener Vertrag mit verdecktem Eigentümer kam auf rund 95 Punkte.
     *
     * Jedes davon ist ein K.o. und kein Abzug: Wer den Kontostand anderer
     * ändern oder die abgegebenen Rechte zurückholen kann, braucht keine
     * zweite Auffälligkeit, um gefährlich zu sein.
     */
    const ko = [
        ['ersteller_honeypots', jaNein(goplus.honeypot_with_same_creator),
            'Derselbe Ersteller hat bereits Honeypots aufgelegt'],
        ['verdeckter_eigentuemer', jaNein(goplus.hidden_owner),
            'Verdeckter Eigentümer — die abgegebenen Rechte sind nur Schein'],
        ['eigentum_rueckholbar', jaNein(goplus.can_take_back_ownership),
            'Abgegebene Eigentümerrechte lassen sich zurückholen'],
        ['saldo_aenderbar', jaNein(goplus.owner_change_balance),
            'Der Eigentümer kann Kontostände anderer ändern'],
        ['selbstzerstoerung', jaNein(goplus.selfdestruct),
            'Der Vertrag kann sich selbst zerstören'],
        ['steuer_je_adresse', jaNein(goplus.personal_slippage_modifiable),
            'Steuer lässt sich je Adresse setzen — gezielter Honeypot möglich'],
    ]
    for (const [grund, gesetzt, text] of ko) {
        flaggen[grund] = gesetzt
        if (gesetzt) return verworfen(grund, text, flaggen, hinweise)
    }

    /*
     * Nicht verifizierter Quelltext: Was der Vertrag tut, lässt sich dann
     * nicht nachlesen — alle übrigen Befunde von GoPlus sind Vermutungen über
     * eine Blackbox. `null` (die Quelle sagt nichts, z. B. Solana) ist kein
     * Befund; ausdrücklich „0" ist einer.
     */
    flaggen.quelloffen = dreiwertig(goplus.is_open_source)
    if (flaggen.quelloffen === false) {
        return verworfen('nicht_quelloffen',
            'Quelltext nicht verifiziert — der Vertrag lässt sich nicht prüfen', flaggen, hinweise)
    }

    /*
     * `cannot_sell_all` stand hier bis zum 20.08.2026 mit in der Prüfung — und
     * existiert in der GoPlus-v1-Antwort GAR NICHT. Neununddreissig Felder,
     * keines heisst so; `jaNein(undefined)` ist immer falsch, die halbe
     * Bedingung war seit jeher tot. Gefunden hat das der Datenvertrags-Test,
     * nicht die Rechnung — die war korrekt, sie rechnete nur mit nichts.
     *
     * `transfer_pausable` gibt es wirklich und trägt die Prüfung allein;
     * `cannot_buy` kommt als zweites echtes Feld dazu: Wer nicht kaufen kann,
     * sitzt zwar nicht fest, aber der Markt ist manipulierbar.
     */
    flaggen.verkaufSperrbar = jaNein(goplus.transfer_pausable)
    flaggen.kaufGesperrt = jaNein(goplus.cannot_buy)
    if (flaggen.verkaufSperrbar) {
        return verworfen('verkauf_sperrbar',
            'Übertragung kann angehalten oder der Verkauf begrenzt werden', flaggen, hinweise)
    }

    const verkaufssteuer = prozent(goplus.sell_tax)
    flaggen.verkaufssteuerProzent = verkaufssteuer
    if (verkaufssteuer !== null && verkaufssteuer > r.maxVerkaufssteuerProzent) {
        return verworfen('verkaufssteuer_hoch',
            `Verkaufssteuer ${verkaufssteuer.toFixed(1)} % über ${r.maxVerkaufssteuerProzent} %`, flaggen, hinweise)
    }
    // Unbekannt ist nicht steuerfrei. Kein K.o. — die Angabe fehlt bei GoPlus
    // regelmässig auch für unauffällige Token —, aber sichtbar muss es sein.
    if (verkaufssteuer === null) hinweise.push('Verkaufssteuer unbekannt')

    flaggen.praegbar = jaNein(goplus.is_mintable)
    flaggen.eigentuemerAktiv = Boolean(goplus.owner_address)
        && String(goplus.owner_address) !== '0x0000000000000000000000000000000000000000'
    if (flaggen.praegbar && flaggen.eigentuemerAktiv) {
        return verworfen('praegbar',
            'Nachprägung möglich und Eigentümerrechte nicht abgegeben', flaggen, hinweise)
    }

    /*
     * Eine änderbare Steuer ist erst mit aktivem Eigentümer eine Waffe: Dann
     * lässt sich die Verkaufssteuer nach dem Einstieg auf 100 % stellen, und
     * die gemessene Steuer von heute sagt darüber nichts. Ohne Eigentümer
     * kann niemand mehr drehen — dann reicht ein Hinweis.
     */
    flaggen.steuerAenderbar = jaNein(goplus.slippage_modifiable)
    if (flaggen.steuerAenderbar && flaggen.eigentuemerAktiv) {
        return verworfen('steuer_aenderbar',
            'Steuer ist änderbar und die Eigentümerrechte sind nicht abgegeben', flaggen, hinweise)
    }
    if (flaggen.steuerAenderbar) hinweise.push('Steuer ist im Vertrag änderbar (ohne aktiven Eigentümer)')

    // Liquiditätssperre. Fehlen die Angaben, wird nicht geraten.
    const lpHalter = Array.isArray(goplus.lp_holders) ? goplus.lp_holders : []
    if (lpHalter.length) {
        const gesperrt = lpHalter.reduce((summe, h) => {
            const anteil = Number(h?.percent) || 0
            const istGesperrt = jaNein(h?.is_locked)
                // Verbrannte Anteile gehen an die Nulladresse — dauerhafter
                // als jede Sperrfrist.
                || /^0x0{40}$/i.test(String(h?.address || ''))
                || /^0x0*dead$/i.test(String(h?.address || ''))
            return summe + (istGesperrt ? anteil : 0)
        }, 0)
        flaggen.lpGesperrtProzent = Math.min(100, gesperrt * faktor)
        if (r.lpMussGesperrtSein && flaggen.lpGesperrtProzent < 50) {
            return verworfen('lp_offen',
                `Nur ${flaggen.lpGesperrtProzent.toFixed(0)} % der Liquidität gesperrt oder verbrannt`,
                flaggen, hinweise)
        }
    } else if (r.lpMussGesperrtSein) {
        /*
         * Unbekannt ist nicht bestanden.
         *
         * Bis zum Audit vom 19.08.2026 stand hier nur ein Hinweis — die
         * Einstellung versprach einen harten Filter und lieferte eine
         * Fussnote. Gemessen kamen dadurch vier von zehn Kandidaten, die
         * diese Prüfung überhaupt erreichten, mit Sicherheitsnote 100 durch,
         * ohne dass die Sperre je geprüft worden wäre.
         *
         * Dieselbe Linie wie ein paar Zeilen weiter oben bei fehlender
         * GoPlus-Antwort: „ungeprüft wird nicht empfohlen". Wer die Sperre
         * nicht zur Pflicht macht, bekommt weiterhin nur den Hinweis.
         */
        return verworfen('lp_unbekannt',
            'Zur Liquiditätssperre liegen keine Angaben vor — ungeprüft wird nicht empfohlen',
            flaggen, hinweise)
    } else {
        hinweise.push('Zur Liquiditätssperre liegen keine Angaben vor')
    }

    // ── Abzüge ──────────────────────────────────────────────────────────
    let note = 100

    if (flaggen.kaufGesperrt) {
        // Kein K.o.: Wer nicht kaufen kann, sitzt nicht fest. Aber ein Markt,
        // in den man nicht hineinkommt, ist auch keiner.
        note -= 25
        hinweise.push('Kauf ist derzeit gesperrt')
    }
    if (verkaufssteuer === null) note -= 5

    /*
     * Fehlt das Ergebnis der Honeypot-Simulation, ist der wichtigste Einzelbefund
     * ungeprüft. `jaNein('')` ergäbe „kein Honeypot" — eine Aussage, die nie
     * getroffen wurde. Kein K.o. (GoPlus simuliert nicht jeden frischen Pool),
     * aber ein spürbarer Abzug mit Begründung.
     */
    if (dreiwertig(goplus.is_honeypot) === null) {
        note -= 15
        hinweise.push('Honeypot-Simulation lieferte kein Ergebnis')
    }

    const kaufsteuer = prozent(goplus.buy_tax)
    flaggen.kaufsteuerProzent = kaufsteuer
    if (kaufsteuer !== null && kaufsteuer > r.maxVerkaufssteuerProzent) {
        note -= 15
        hinweise.push(`Kaufsteuer ${kaufsteuer.toFixed(1)} %`)
    }

    /*
     * Abzüge statt K.o. — und das ist gemessen, nicht vermutet: Das Original
     * PEPE trägt laut GoPlus `is_blacklisted: 1`. Eine Sperrliste ist ein
     * Werkzeug gegen Bots ebenso wie gegen Käufer; sie allein entscheidet
     * nichts, sie gehört aber sichtbar an den Fund.
     */
    const abzuege = [
        ['sperrliste', jaNein(goplus.is_blacklisted), 15, 'Vertrag kann Adressen sperren (Sperrliste)'],
        ['handelspause', jaNein(goplus.trading_cooldown), 10, 'Handelssperre zwischen zwei Transaktionen möglich'],
        ['fremdaufruf', jaNein(goplus.external_call), 10, 'Vertrag ruft fremden Code auf'],
        // Solana: Vollmachten, die heute ruhen, morgen aber greifen können.
        ['schliessbar', jaNein(goplus.closable), 15, 'Token kann geschlossen werden'],
        ['gebuehrEinfuehrbar', jaNein(goplus.transfer_fee_upgradable), 10,
            'Übertragungsgebühr kann nachträglich eingeführt werden'],
        ['hookEinfuehrbar', jaNein(goplus.transfer_hook_upgradable), 10,
            'Übertragungs-Hook kann nachträglich gesetzt werden'],
        ['standardZustandAenderbar', jaNein(goplus.default_account_state_upgradable), 10,
            'Neue Konten können künftig eingefroren starten'],
        ['metadatenAenderbar', jaNein(goplus.metadata_mutable), 5,
            'Name und Bild sind änderbar'],
    ]
    for (const [flagge, gesetzt, punkte, text] of abzuege) {
        flaggen[flagge] = gesetzt
        if (gesetzt) {
            note -= punkte
            hinweise.push(text)
        }
    }

    /*
     * Gefahrenbefunde von RugCheck, gedeckelt. RugCheck benennt Muster, die
     * hier keine eigene Regel haben (Nachahmer-Token, auffällige Erstverteilung)
     * — sie zu verwerfen wäre zu viel, sie zu verschweigen zu wenig.
     */
    const gefahren = Array.isArray(goplus.gefahren) ? goplus.gefahren : []
    if (gefahren.length) {
        flaggen.gefahren = gefahren
        note -= Math.min(30, gefahren.length * 10)
        hinweise.push(`RugCheck: ${gefahren.join(', ')}`)
    }

    const top10 = summeTop10(goplus.holders, { skala: goplus.anteilSkala })
    flaggen.top10Prozent = top10
    /*
     * Beide Zahlen bleiben stehen: die bereinigte entscheidet, die rohe macht
     * die Bereinigung überprüfbar. Weichen sie stark ab, war viel verbrannt
     * oder gesperrt — das ist eine gute Nachricht und soll auch so aussehen.
     */
    flaggen.top10ProzentRoh = summeTop10(goplus.holders, { roh: true, skala: goplus.anteilSkala })
    const raus = top10Ausgeschlossen(goplus.holders, { skala: goplus.anteilSkala })
    if (raus.length) {
        flaggen.top10Ausgeschlossen = raus
        const anteil = raus.reduce((a, x) => a + x.anteil, 0)
        hinweise.push(`${raus.length} der zehn grössten Halter nicht mitgezählt `
            + `(${raus.map((x) => x.grund).join(', ')})`)
        if (anteil > 0) flaggen.top10AusgeschlossenAnteil = anteil
    }
    if (top10 !== null) {
        if (top10 > r.maxTop10Prozent) {
            // Kein K.o., aber der schwerste Abzug: wenige Halter können den
            // Markt jederzeit überrollen.
            note -= Math.min(40, (top10 - r.maxTop10Prozent) * 1.5)
            hinweise.push(`Die zehn grössten Halter halten ${top10.toFixed(0)} %`)
        }
    } else {
        note -= 10
        hinweise.push('Halterverteilung unbekannt')
    }

    const fdv = Number(markt.fdv) || 0
    if (fdv > 0 && liq > 0) {
        const verhaeltnis = fdv / liq
        flaggen.fdvLiqVerhaeltnis = Math.round(verhaeltnis)
        if (verhaeltnis > r.maxFdvLiqVerhaeltnis) {
            note -= Math.min(25, (verhaeltnis - r.maxFdvLiqVerhaeltnis) / 10)
            hinweise.push(`Bewertung ${Math.round(verhaeltnis)}× über der Liquidität`)
        }
    }

    flaggen.proxy = jaNein(goplus.is_proxy)
    if (flaggen.proxy) {
        note -= 15
        hinweise.push('Proxy-Vertrag — die Logik ist austauschbar')
    }

    const halter = Number(goplus.holder_count) || 0
    flaggen.halterZahl = halter
    if (halter > 0 && halter < 200) {
        note -= 15
        hinweise.push(`Erst ${halter} Halter`)
    }

    /*
     * Handelsmuster. Ein Kauf/Verkauf-Verhältnis weit über 1 sieht auf den
     * ersten Blick gut aus, ist aber genau die Signatur eines Honeypots: viele
     * kommen hinein, kaum jemand wieder heraus. Deshalb Abzug statt Bonus.
     */
    const kv = Number(markt.kaufVerkaufVerhaeltnis)
    if (Number.isFinite(kv) && kv > 5) {
        note -= 20
        hinweise.push(`Auf einen Verkauf kommen ${kv.toFixed(0)} Käufe — auffällig einseitig`)
    }

    return {
        status: 'bestanden',
        grund: '',
        safetyScore: Math.max(0, Math.min(100, Math.round(note))),
        flaggen,
        hinweise,
    }
}

function verworfen(grund, text, flaggen, hinweise) {
    return { status: 'verworfen', grund, safetyScore: 0, flaggen, hinweise: [...hinweise, text] }
}

/** Adressen, hinter denen niemand steht, der verkaufen könnte. */
const VERBRANNT = [/^0x0{40}$/i, /^0x0*dead$/i, /^1n[cC]1nerator/, /^11111111111111111111111111111111$/]

/**
 * Stichwörter in GoPlus-Tags, die eine Adresse als Systemadresse ausweisen.
 * GoPlus benennt bekannte Adressen selbst — das ist verlässlicher als jede
 * eigene Liste, die man pflegen müsste.
 */
const SYSTEM_TAGS = /burn|null|dead|lock|vest|team|foundation|treasury|binance|coinbase|okx|bybit|kraken|bitget|gate|kucoin|uniswap|pancake|raydium|orca|meteora|pool|router/i

/** Ist dieser Halter jemand, der den Markt überrollen könnte? */
function istGefahr(h) {
    const adresse = String(h?.address || '')
    if (VERBRANNT.some((r) => r.test(adresse))) return false
    // Gesperrt heisst: kann in der Sperrfrist nicht verkaufen.
    if (jaNein(h?.is_locked)) return false
    if (SYSTEM_TAGS.test(String(h?.tag || ''))) return false
    return true
}

/**
 * Anteil der zehn grössten Halter in Prozent — BEREINIGT.
 *
 * Vor dem Audit vom 19.08.2026 wurden die ersten zehn `percent` roh addiert.
 * Verbrannte Anteile, gesperrte Tranchen, Börsen-Sammeladressen und die
 * Liquiditätspools selbst zählten mit — und damit wirkte ausgerechnet eine
 * saubere Aufsetzung riskant. Umgekehrt half das niemandem: Wer die Verteilung
 * wirklich kontrolliert, verteilt sie auf mehrere Wallets, und dagegen hilft
 * kein Summieren.
 *
 * Ausgeschlossen wird nur, was nachweislich nicht verkaufen KANN oder wem der
 * Anbieter selbst einen Namen gegeben hat. Eine unbekannte Adresse bleibt
 * verdächtig — das ist die Linie des Hauses.
 *
 * @param {Array} halter
 * @param {object} opts  `{roh: true}` liefert die unbereinigte Summe;
 *                       `skala` sagt, ob `percent` Bruchteil oder Prozent ist
 * @returns {number|null} Prozent, oder null wenn nichts zu rechnen war
 */
export function summeTop10(halter, opts = {}) {
    if (!Array.isArray(halter) || !halter.length) return null
    const genommen = halter.slice(0, 10).filter((h) => opts.roh || istGefahr(h))
    const summe = genommen.reduce((a, h) => a + (Number(h?.percent) || 0), 0)
    // Kein Halter mehr übrig heisst: alles verbrannt, gesperrt oder benannt.
    // Das ist eine Aussage (0 %), keine fehlende Messung.
    if (!genommen.length) return halter.length ? 0 : null
    if (summe <= 0) return null
    return summe * prozentFaktor(opts.skala)
}

/**
 * Welche der zehn grössten Halter warum nicht mitgezählt wurden.
 * Für die Anzeige: Ein Abzug, dessen Herkunft man nicht sieht, ist eine
 * Behauptung.
 */
export function top10Ausgeschlossen(halter, opts = {}) {
    if (!Array.isArray(halter)) return []
    return halter.slice(0, 10).filter((h) => !istGefahr(h)).map((h) => ({
        adresse: String(h?.address || '').slice(0, 10),
        anteil: (Number(h?.percent) || 0) * prozentFaktor(opts.skala),
        grund: jaNein(h?.is_locked) ? 'gesperrt'
            : (VERBRANNT.some((r) => r.test(String(h?.address || ''))) ? 'verbrannt' : String(h?.tag || 'benannt')),
    }))
}

/**
 * RugCheck-Antwort auf die GoPlus-Form bringen — rein, ohne Netz.
 *
 * `pruefe` spricht eine Sprache (die GoPlus-Felder); eine zweite Quelle muss
 * sich ihr anpassen, nicht umgekehrt. Getrennt exportiert, damit die
 * Übersetzung mit festen Beispieldaten prüfbar ist.
 *
 * Solana-Eigenheiten: `rugged` heisst, der Teppich ist BEREITS gezogen — das
 * wird wie ein Honeypot behandelt. Eine gesetzte Freeze-Authority kann jede
 * Übertragung anhalten; eine gesetzte Mint-Authority kann nachprägen.
 *
 * RugCheck nennt Anteile in PROZENT (`pct: 1.83` heisst 1,83 %), GoPlus in
 * Bruchteilen — die Skala steht deshalb ausdrücklich am Ergebnis.
 */
export function ausRugCheck(j) {
    if (!j || typeof j !== 'object') return null
    return {
        quelle: 'rugcheck',
        anteilSkala: SKALA_PROZENT,
        is_honeypot: j?.rugged ? 1 : 0,
        transfer_pausable: j?.token?.freezeAuthority ? 1 : 0,
        is_mintable: j?.token?.mintAuthority ? 1 : 0,
        owner_address: j?.token?.mintAuthority || '',
        holder_count: Number(j?.totalHolders) || 0,
        holders: (Array.isArray(j?.topHolders) ? j.topHolders : [])
            .map((h) => ({
                percent: Number(h?.pct) || 0,
                address: String(h?.address || h?.owner || ''),
                // RugCheck kennt keine Tags, aber `insider` — die Antwort auf
                // dieselbe Frage aus der anderen Richtung.
                tag: h?.insider ? 'insider' : '',
                is_locked: 0,
                is_contract: 0,
            })),
        lp_holders: lpAusRugCheck(j?.markets),
        sell_tax: steuerAusRugCheck(j?.transferFee),
        is_proxy: 0,
        gefahren: (Array.isArray(j?.risks) ? j.risks : [])
            .filter((r) => String(r?.level || '').toLowerCase() === 'danger')
            .map((r) => String(r?.name || '').slice(0, 80))
            .filter(Boolean),
    }
}

/**
 * Gesperrter Anteil der Liquidität über ALLE Märkte, nach Dollar gewichtet.
 *
 * Bis zum 07.10.2026 zählte nur `markets[0]` — und welcher Markt dort steht,
 * sagt RugCheck nicht. Ein gesperrter Kleinstpool vorn und ein offener
 * Hauptpool dahinter ergaben „100 % gesperrt". Ohne Dollarangaben wird der
 * liquideste Markt genommen, den sich bestimmen lässt.
 */
function lpAusRugCheck(maerkte) {
    const liste = (Array.isArray(maerkte) ? maerkte : []).filter((m) => m?.lp)
    if (!liste.length) return []
    const tiefe = (m) => (Number(m.lp.baseUSD) || 0) + (Number(m.lp.quoteUSD) || 0)
    const gesamt = liste.reduce((a, m) => a + tiefe(m), 0)
    const gesperrtUsd = liste.reduce((a, m) => a + (Number(m.lp.lpLockedUSD) || 0), 0)
    if (gesamt > 0 && liste.every((m) => Number.isFinite(Number(m.lp.lpLockedUSD)))) {
        const pct = Math.min(100, (gesperrtUsd / gesamt) * 100)
        return [{ percent: pct, is_locked: 1, address: 'rugcheck' }]
    }
    const hauptmarkt = [...liste].sort((a, b) => tiefe(b) - tiefe(a))[0]
    const pct = Number(hauptmarkt?.lp?.lpLockedPct)
    return Number.isFinite(pct) ? [{ percent: pct, is_locked: 1, address: 'rugcheck' }] : []
}

/**
 * Übertragungsgebühr (Token-2022) als Bruchteil, wie `prozent()` sie erwartet.
 *
 * Fehlt die Angabe, bleibt sie unbekannt (`''`) — bis zum 07.10.2026 stand
 * hier eine feste 0 mit dem Vermerk „kennt Solana nicht". Solana kennt sie
 * sehr wohl, seit Token-2022.
 */
function steuerAusRugCheck(gebuehr) {
    const pct = Number(gebuehr?.pct)
    if (!gebuehr || typeof gebuehr !== 'object' || !Number.isFinite(pct)) return ''
    return pct / 100
}

/**
 * GoPlus-Solana-Antwort auf die gemeinsame Form bringen — rein, ohne Netz.
 *
 * Solana kennt keinen Eigentümer im EVM-Sinn; stattdessen entscheiden die
 * Vollmachten (`authority`). Jede wird hier auf das Feld abgebildet, das
 * `pruefe` für dieselbe Gefahr schon kennt.
 *
 * Bis zum 07.10.2026 wurden nur vier Felder gelesen. `freezable` fehlte — und
 * damit das häufigste Solana-Betrugsmuster: Antwortete GoPlus, kam ein Token
 * mit aktiver Freeze-Authority durch; nur wenn GoPlus ausfiel, fing RugCheck
 * ihn. `sell_tax` stand fest auf 0, also galt jede Token-2022-Gebühr als
 * bekannt und null.
 *
 * @param {object} d          Eintrag aus `result` der GoPlus-Antwort
 * @param {Array} lpHolders   Liquiditätssperre (kommt von RugCheck)
 */
export function ausGoPlusSolana(d, lpHolders = []) {
    if (!d || typeof d !== 'object') return null
    const aktiv = (feld) => String(feld?.status ?? '') === '1'
    const standardEingefroren = String(d?.default_account_state ?? '') === '2'
    return {
        quelle: 'goplus-solana',
        anteilSkala: SKALA_BRUCH,
        is_honeypot: d?.non_transferable === '1' ? 1 : 0,
        is_mintable: aktiv(d?.mintable) ? 1 : 0,
        owner_address: d?.mintable?.authority?.[0]?.address || '',
        /*
         * Drei Wege, Käufer festzusetzen, ein Befund: eine Freeze-Authority,
         * ein Übertragungs-Hook (eigener Code bei jeder Übertragung) und Konten,
         * die eingefroren starten.
         */
        transfer_pausable: (aktiv(d?.freezable) || d?.transfer_hook?.length || standardEingefroren) ? 1 : 0,
        // Wer Kontostände ändern kann, braucht keinen Honeypot.
        owner_change_balance: aktiv(d?.balance_mutable_authority) ? 1 : 0,
        closable: aktiv(d?.closable) ? 1 : 0,
        transfer_fee_upgradable: aktiv(d?.transfer_fee_upgradable) ? 1 : 0,
        transfer_hook_upgradable: aktiv(d?.transfer_hook_upgradable) ? 1 : 0,
        default_account_state_upgradable: aktiv(d?.default_account_state_upgradable) ? 1 : 0,
        metadata_mutable: aktiv(d?.metadata_mutable) ? 1 : 0,
        holder_count: Number(d?.holder_count) || 0,
        /*
         * Die Merkmale bleiben erhalten (R-09). Die Adresse steht bei Solana
         * unter `account` (dem Besitzer), nicht unter `address` — mit `address`
         * war jede Halteradresse leer und kein verbrannter Anteil erkennbar.
         */
        holders: (d?.holders || []).map((h) => ({
            percent: Number(h?.percent) || 0,
            address: String(h?.address || h?.account || h?.token_account || ''),
            tag: String(h?.tag || ''),
            is_locked: h?.is_locked,
            is_contract: h?.is_contract,
        })),
        lp_holders: lpHolders,
        sell_tax: steuerAusGoPlusSolana(d?.transfer_fee),
        is_proxy: 0,
    }
}

/**
 * Token-2022-Übertragungsgebühr aus GoPlus.
 *
 * Ein leeres Objekt heisst: keine Gebühr (gemessen am Fixture). Steht etwas
 * darin, ist die Einheit nicht an einer echten Antwort mit Gebühr geprüft —
 * dann wird nicht geraten: Basispunkte sind eindeutig, alles andere bleibt
 * unbekannt (Abzug und Hinweis), statt eine erfundene Zahl zu liefern.
 */
function steuerAusGoPlusSolana(gebuehr) {
    if (!gebuehr || typeof gebuehr !== 'object') return ''
    if (!Object.keys(gebuehr).length) return 0
    const bp = Number(gebuehr?.current_fee_rate?.transfer_fee_basis_points
        ?? gebuehr?.transfer_fee_basis_points ?? gebuehr?.fee_basis_points)
    if (Number.isFinite(bp)) return bp / 10000
    return ''
}

/**
 * Sicherheitsdaten abfragen. Getrennt vom Urteil, damit dieses prüfbar bleibt.
 *
 * Solana hat zwei Quellen: GoPlus zuerst, bei Ausfall RugCheck. Der Grund ist
 * kein Misstrauen gegen GoPlus, sondern ein 504 im Test vom 19.08.2026 — und
 * fast alle Meme-Funde leben auf Solana. Hinge der ganze Trichter an einem
 * einzigen wackligen Endpunkt, wäre „ungeprüft → verworfen" der Normalzustand.
 *
 * @returns {Promise<object|null>} null, wenn die Kette nicht unterstützt wird
 *   oder nichts zu holen war — der Aufrufer behandelt das als „ungeprüft".
 */
export async function holeGoPlus(chain, contract) {
    if (!contract) return null
    const adresse = String(contract).toLowerCase()

    if (chain === 'solana') {
        let d = null
        try {
            const j = await holeJson(
                `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${encodeURIComponent(contract)}`)
            d = j?.result?.[contract] || j?.result?.[adresse]
        } catch {
            // GoPlus klemmt — RugCheck übernimmt.
        }
        if (!d) {
            const r = await holeJson(
                `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(contract)}/report`)
            return ausRugCheck(r)
        }
        /*
         * Die Liquiditätssperre muss von RugCheck kommen — auch wenn GoPlus
         * geantwortet hat.
         *
         * Gemessen am 19.08.2026: Die Solana-Antwort von GoPlus kennt das Feld
         * `lp_holders` NICHT (es ist EVM-Sprache). RugCheck kennt es sehr wohl
         * und meldete für DPG `lpLockedPct: 100`. Da der Ausweichpfad nur bei
         * einem GoPlus-AUSFALL griff, wurde die Angabe nie geholt — und weil
         * fehlende Angaben nur einen Hinweis erzeugten, kam jeder Solana-Fund
         * mit voller Sicherheitsnote durch die Sperr-Pflicht.
         *
         * Ein zusätzlicher Abruf je Solana-Kandidat, höchstens vierzig pro
         * Lauf. Das ist der Preis dafür, dass die Einstellung „LP muss
         * gesperrt sein" auf Solana überhaupt etwas bedeutet. Die Skala der
         * RugCheck-Zahl (Prozent) unterscheidet sich von der GoPlus-Skala
         * (Bruchteil) — umgerechnet wird hier, damit am Ergebnis nur eine gilt.
         */
        let lpHolders = (d?.lp_holders || []).map((h) => ({
            percent: Number(h?.percent) || 0,
            is_locked: h?.is_locked,
            address: h?.address,
        }))
        if (!lpHolders.length) {
            try {
                const rc = await holeJson(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(contract)}/report`)
                lpHolders = (ausRugCheck(rc)?.lp_holders || [])
                    .map((h) => ({ ...h, percent: h.percent / 100 }))
            } catch {
                // Bleibt leer — und „unbekannt" ist ab jetzt ein echter Befund.
            }
        }

        return ausGoPlusSolana(d, lpHolders)
    }

    const kette = KETTEN_ID[chain]
    if (!kette) return null
    const j = await holeJson(
        `https://api.gopluslabs.io/api/v1/token_security/${kette}?contract_addresses=${encodeURIComponent(adresse)}`)
    const d = j?.result?.[adresse]
    // Die EVM-Antwort IST die Sprache von `pruefe` — nur Herkunft und Skala
    // kommen dazu, damit nichts mehr geraten werden muss.
    return d ? { ...d, quelle: 'goplus-evm', anteilSkala: SKALA_BRUCH } : null
}
