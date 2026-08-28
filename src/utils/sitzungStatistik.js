/**
 * Auswertung der Handelssitzungen.
 *
 * Reines Modul: keine Vue-Abhängigkeit, kein Netz, keine Datenbank — dieselbe
 * Trennung wie in `server/marktmechanik.js`, damit die Rechnung einen
 * Selbsttest bekommen kann (`src/utils/__selftest-sitzung-statistik.mjs`).
 *
 * ## Was hier gemessen wird
 *
 * Nicht in erster Linie die Rendite. Die steht im Journal ohnehin genauer.
 * Hier geht es um die Frage, die sonst nirgends beantwortet wird: **hältst du
 * dich an das, was du dir vorgenommen hast — und bringt es etwas?**
 *
 * ## Zwei Regeln, die das Ergebnis ehrlich halten
 *
 * 1. **Archivierte Sitzungen zählen mit.** Eine Disziplinquote, die sich durch
 *    Aufräumen verbessern liesse, wäre wertlos.
 * 2. **Kleine Gruppen sind keine Aussage.** Bei drei Sitzungen an einem
 *    Dienstag ist „Dienstag ist dein schlechter Tag" Rauschen. Jede Gruppe
 *    trägt deshalb `duenn: true`, solange sie unter `MIN_GRUPPE` liegt; die
 *    Oberfläche zeigt solche Werte grau statt als Befund. Dasselbe Muster
 *    benutzt `KachelRegime.vue`.
 */

import { median } from '../../shared/statistik.js'

/** Ab wie vielen Sitzungen eine Gruppe als Aussage gilt. */
export const MIN_GRUPPE = 4

/**
 * Stunde und Wochentag eines Zeitpunkts in einer bestimmten Zeitzone.
 *
 * Hier stand `new Date(ms).getHours()` / `.getDay()`, also die Zeitzone des
 * BROWSERS. Der Rest der App rechnet mit `timeZoneTrade`. Wer auf Reisen oder
 * mit einer abweichend eingestellten Maschine auswertet, bekam „Sitzungen um
 * die US-Eröffnung" im falschen Stundenbalken, und Sitzungen nahe Mitternacht
 * landeten auf dem falschen Wochentag.
 *
 * `Intl` statt dayjs, weil dieses Modul bewusst abhängigkeitsfrei bleibt: es
 * wird von Vue UND vom Selbsttest in Node geladen. Ohne Zeitzone fällt es auf
 * die Maschinenzeit zurück — dasselbe Verhalten wie vorher, nur bewusst.
 *
 * @param {number} ms
 * @param {string} [zone] IANA-Name, z.B. 'Europe/Zurich'
 * @returns {{stunde:number, wochentag:number}} Wochentag 0 = Sonntag
 */
export function stundeUndTag(ms, zone) {
    const d = new Date(ms)
    if (!zone) return { stunde: d.getHours(), wochentag: d.getDay() }
    try {
        const teile = new Intl.DateTimeFormat('en-US', {
            timeZone: zone, hour: 'numeric', hour12: false, weekday: 'short',
        }).formatToParts(d)
        const stunde = Number(teile.find((t) => t.type === 'hour')?.value)
        const kurz = teile.find((t) => t.type === 'weekday')?.value
        const tage = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
        const wochentag = tage[kurz]
        if (!Number.isFinite(stunde) || wochentag === undefined) throw new Error('unlesbar')
        // 24 Uhr gibt es in hour12:false gelegentlich für Mitternacht.
        return { stunde: stunde % 24, wochentag }
    } catch {
        // Unbekannte Zeitzone: lieber Maschinenzeit als gar keine Auswertung.
        return { stunde: d.getHours(), wochentag: d.getDay() }
    }
}

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

const zahl = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}

/** Nur beendete Sitzungen — laufende und abgebrochene haben keine Bilanz. */
export function nurBeendete(sitzungen) {
    return (Array.isArray(sitzungen) ? sitzungen : [])
        .filter(s => s && s.status === 'beendet' && zahl(s.endUnix) > 0)
}

/** Hat die Sitzung überhaupt eine Grenze gesetzt bekommen? */
export function hatPlan(s) {
    return zahl(s?.planMaxVerlustUsd) > 0 || zahl(s?.planMaxTrades) > 0
}

/** Dauer in Minuten. Eine noch laufende Sitzung hat keine. */
export function dauerMin(s) {
    const ende = zahl(s?.endUnix)
    const start = zahl(s?.startUnix)
    if (!(ende > 0) || !(start > 0) || ende <= start) return null
    return Math.round((ende - start) / 60000)
}

/** Kennzahlen einer Gruppe von Sitzungen. */
function bilanz(gruppe) {
    const n = gruppe.length
    const pnl = gruppe.reduce((a, s) => a + zahl(s.pnlUsd), 0)
    const trades = gruppe.reduce((a, s) => a + zahl(s.tradeAnzahl), 0)
    const mitPlan = gruppe.filter(hatPlan)
    const gehalten = mitPlan.filter(s => !zahl(s.planVerletzt)).length
    return {
        anzahl: n,
        pnlUsd: pnl,
        /** Durchschnitt je Sitzung — vergleichbar über verschieden grosse Gruppen. */
        pnlJeSitzung: n ? pnl / n : 0,
        /**
         * Median je Sitzung — der belastbarere der beiden Werte.
         *
         * PnL-Verteilungen sind stark schief: vier Verlustsitzungen und ein
         * Ausreisser nach oben ergeben einen positiven Durchschnitt, obwohl
         * vier von fünf Sitzungen Geld gekostet haben. Das Schwestermodul
         * `radar-guete.js` rechnet für dieselbe Frage bewusst mit dem Median;
         * beide holen ihn jetzt aus `shared/statistik.js`.
         */
        pnlMedian: median(gruppe.map((s) => zahl(s.pnlUsd))),
        trades,
        gewinner: gruppe.filter(s => zahl(s.pnlUsd) > 0).length,
        mitPlan: mitPlan.length,
        gehalten,
        /** null statt 0, wenn keine Sitzung der Gruppe eine Grenze hatte. */
        disziplin: mitPlan.length ? gehalten / mitPlan.length : null,
        duenn: n < MIN_GRUPPE,
    }
}

/**
 * 1. Disziplin über die Zeit.
 *
 * Aufsteigend nach Startzeit, mit laufender Quote — die Frage ist „werde ich
 * besser", und die beantwortet nur ein Verlauf, kein Mittelwert. Zusätzlich
 * getrennt danach, WELCHE Grenze gerissen ist: wer die Trade-Zahl reisst,
 * handelt zu viel; wer die Verlustgrenze reisst, hält zu lange fest.
 */
export function disziplinVerlauf(sitzungen) {
    const mitPlan = nurBeendete(sitzungen).filter(hatPlan)
        .sort((a, b) => zahl(a.startUnix) - zahl(b.startUnix))

    let gehalten = 0
    const punkte = mitPlan.map((s, i) => {
        if (!zahl(s.planVerletzt)) gehalten++
        return {
            t: zahl(s.startUnix),
            gehalten: !zahl(s.planVerletzt),
            quote: gehalten / (i + 1),
            pnlUsd: zahl(s.pnlUsd),
        }
    })

    // Woran es lag, wenn der Plan gerissen ist
    let verlust = 0
    let zuVieleTrades = 0
    for (const s of mitPlan) {
        if (!zahl(s.planVerletzt)) continue
        const grenzeVerlust = zahl(s.planMaxVerlustUsd)
        const grenzeTrades = zahl(s.planMaxTrades)
        if (grenzeVerlust > 0 && -zahl(s.pnlUsd) > grenzeVerlust) verlust++
        if (grenzeTrades > 0 && zahl(s.tradeAnzahl) > grenzeTrades) zuVieleTrades++
    }

    return {
        punkte,
        anzahl: mitPlan.length,
        gehalten,
        quote: mitPlan.length ? gehalten / mitPlan.length : null,
        gruende: { verlust, trades: zuVieleTrades },
        duenn: mitPlan.length < MIN_GRUPPE,
    }
}

/**
 * 2. P&L nach Tageszeit und Wochentag.
 *
 * Gruppiert nach der Startzeit der Sitzung. Deckt auf, ob bestimmte
 * Handelszeiten systematisch kosten — die Sitzungen um die US-Eröffnung sind
 * der klassische Verdacht.
 */
export function nachZeit(sitzungen, zone) {
    const fertige = nurBeendete(sitzungen)

    const proStunde = new Map()
    const proTag = new Map()
    for (const s of fertige) {
        const { stunde: h, wochentag: w } = stundeUndTag(zahl(s.startUnix), zone)
        if (!proStunde.has(h)) proStunde.set(h, [])
        if (!proTag.has(w)) proTag.set(w, [])
        proStunde.get(h).push(s)
        proTag.get(w).push(s)
    }

    return {
        stunden: [...proStunde.entries()]
            .map(([stunde, g]) => ({ stunde, ...bilanz(g) }))
            .sort((a, b) => a.stunde - b.stunde),
        wochentage: [...proTag.entries()]
            .map(([tag, g]) => ({ tag, name: WOCHENTAGE[tag], ...bilanz(g) }))
            // Montag zuerst, Sonntag zuletzt — so liest man eine Woche
            .sort((a, b) => ((a.tag + 6) % 7) - ((b.tag + 6) % 7)),
    }
}

/**
 * 3. Mit Plan gegen ohne Plan.
 *
 * Die Frage, die den ganzen Sitzungsgedanken trägt. Bewusst je Sitzung und
 * nicht als Summe: mit ungleich grossen Gruppen wäre eine Summe irreführend.
 *
 * Verglichen werden die MEDIANE, nicht die Durchschnitte. Der Durchschnitt
 * stand hier bis zum Audit vom 28.08.2026 und beantwortete die Frage falsch,
 * sobald eine Seite einen Ausreisser hatte: vier Verlustsitzungen und ein
 * grosser Gewinn meldeten „mit Plan 40 USD besser je Sitzung". Der
 * Durchschnitt bleibt als `unterschiedDurchschnitt` daneben stehen — weichen
 * beide stark voneinander ab, IST das die Auskunft (die Gruppe hängt an
 * wenigen Sitzungen).
 */
export function planWirkung(sitzungen) {
    const fertige = nurBeendete(sitzungen)
    const mit = bilanz(fertige.filter(hatPlan))
    const ohne = bilanz(fertige.filter(s => !hatPlan(s)))
    /** null, solange eine der beiden Seiten zu dünn ist — sonst liest man Zufall als Befund. */
    const zuDuenn = mit.duenn || ohne.duenn
    const beideMediane = mit.pnlMedian !== null && ohne.pnlMedian !== null
    return {
        mit,
        ohne,
        unterschiedJeSitzung: (zuDuenn || !beideMediane)
            ? null
            : mit.pnlMedian - ohne.pnlMedian,
        unterschiedDurchschnitt: zuDuenn
            ? null
            : mit.pnlJeSitzung - ohne.pnlJeSitzung,
    }
}

/**
 * 4. Dauer und Überhandeln.
 *
 * Zeigt, ob die Ergebnisse nach der dritten Stunde oder dem fünften Trade
 * kippen. Die Grenzen sind gesetzt, nicht hergeleitet — sie sollen lesbar sein,
 * nicht optimal.
 */
export const DAUER_STUFEN = [
    { id: 'bis60', label: 'bis 1 h', max: 60 },
    { id: 'bis120', label: '1–2 h', max: 120 },
    { id: 'bis240', label: '2–4 h', max: 240 },
    { id: 'ueber240', label: 'über 4 h', max: Infinity },
]

export const TRADE_STUFEN = [
    { id: 't0', label: 'keine', max: 0 },
    { id: 't1_2', label: '1–2', max: 2 },
    { id: 't3_5', label: '3–5', max: 5 },
    { id: 't6plus', label: '6 und mehr', max: Infinity },
]

export function nachUmfang(sitzungen) {
    const fertige = nurBeendete(sitzungen)

    const inStufe = (stufen, wert) => stufen.find(st => wert <= st.max) || stufen[stufen.length - 1]

    const proDauer = new Map()
    const proTrades = new Map()
    for (const s of fertige) {
        const min = dauerMin(s)
        if (min != null) {
            const st = inStufe(DAUER_STUFEN, min)
            if (!proDauer.has(st.id)) proDauer.set(st.id, [])
            proDauer.get(st.id).push(s)
        }
        const st2 = inStufe(TRADE_STUFEN, zahl(s.tradeAnzahl))
        if (!proTrades.has(st2.id)) proTrades.set(st2.id, [])
        proTrades.get(st2.id).push(s)
    }

    return {
        dauer: DAUER_STUFEN
            .filter(st => proDauer.has(st.id))
            .map(st => ({ id: st.id, label: st.label, ...bilanz(proDauer.get(st.id)) })),
        trades: TRADE_STUFEN
            .filter(st => proTrades.has(st.id))
            .map(st => ({ id: st.id, label: st.label, ...bilanz(proTrades.get(st.id)) })),
    }
}

/** Alles auf einmal — die Ansicht braucht keine vier Aufrufe. */
export function werteAus(sitzungen, zone) {
    const fertige = nurBeendete(sitzungen)
    return {
        gesamt: bilanz(fertige),
        disziplin: disziplinVerlauf(sitzungen),
        zeit: nachZeit(sitzungen, zone),
        plan: planWirkung(sitzungen),
        umfang: nachUmfang(sitzungen),
    }
}
