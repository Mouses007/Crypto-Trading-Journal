/**
 * Handelsbild — der reine Teil der Kachel „Handelslage".
 *
 * Schwesterdatei zu `lagebild.js`, mit ausdrücklich anderem Horizont. Die
 * „Gesamtlage" beantwortet „wo stehen wir im Zyklus" und zieht dafür Pi-Cycle,
 * Regenbogen, Altcoin-Saison und die eigene Jahresbilanz heran. Für die
 * nächsten drei Stunden ist davon nichts brauchbar: der Regenbogen bewegt sich
 * in Monaten, der Altseason-Index in Wochen. Wer eine Sitzung fährt, braucht
 * andere Zahlen — und die standen bisher nirgends zusammen.
 *
 * Drei Aufgaben, alle ohne Netz und ohne Datenbank, damit der Selbsttest sie
 * prüfen kann:
 *
 *   1. `rechneTagesbild` macht aus Kerzen die Kennzahlen, die den Handelstag
 *      beschreiben: wie gross die Spanne heute schon ist, wo im Tagesbereich
 *      der Preis steht, wie weit die üblichen Marken entfernt sind.
 *   2. `baueHandelsZeilen` giesst alle Quellen in kurze Textzeilen — die
 *      einzige Grundlage, die die KI zu sehen bekommt.
 *   3. `normalisiereHandelslage` bringt die Antwort auf eine feste Form.
 *
 * ── Warum „genutzte Tagesspanne" die wichtigste Zahl hier ist ──────────────
 *
 * Ein Daytrader verdient an Bewegung, nicht an Richtung. Die Frage „ist noch
 * etwas zu holen" entscheidet sich daran, wie viel von der üblichen Tagesspanne
 * schon gelaufen ist. Ein Markt, der um 14 Uhr bereits 130 % seiner normalen
 * Tagesspanne hinter sich hat, ist kein Fortsetzungskandidat mehr, egal wie gut
 * der Trend aussieht — und genau diese Zahl fehlte in jeder bisherigen Kachel.
 * Bezugsgrösse ist der MEDIAN der letzten zehn Tage, nicht der Mittelwert: ein
 * einzelner Absturztag hebt den Schnitt so weit an, dass danach jeder normale
 * Tag „ruhig" aussieht.
 *
 * ── Grenze zur Handelsempfehlung ──────────────────────────────────────────
 *
 * Diese Datei liefert Bedingungen, keine Handlungen. „Fortsetzung trägt,
 * solange X" ist eine Aussage über den Markt; „kaufe bei X" wäre eine über den
 * Nutzer. Der Unterschied steckt im Prompt (`handelslage.js`) und in der Form
 * der Antwort: es gibt Felder für `bedingungen` und `hinfaellig`, aber keines
 * für Einstieg, Ziel oder Positionsgrösse.
 */

import { atr, ema, adx, volumeSma } from './strategies/indicators.js'

/** Erlaubte Lagen. Alles andere fällt auf `unklar` zurück. */
export const LAGEN = ['trend_auf', 'trend_ab', 'spanne', 'quetsche', 'nachrichtenrisiko', 'unklar']

/** Erlaubter Ton eines Einzelpunkts — steuert im Frontend nur die Farbe. */
export const TOENE = ['gut', 'schlecht', 'neutral']

/**
 * Klartext für die Ids aus `shared/handelszeiten.js`.
 *
 * Die Kachel daneben übersetzt sie über i18n; hier steht die KI davor, und
 * `usNachboerse` oder `cmePause` sind für sie beliebige Bezeichner. Gemessen
 * am ersten Probelauf war das der grösste vermeidbare Verlust in der
 * Grundlage: eine Zeitangabe, die niemand einordnen kann, ist keine.
 *
 * Fehlt eine Id, steht sie roh da — das ist immer noch besser, als sie
 * wegzulassen.
 */
const ZEIT_NAME = {
    asien: 'Asien (Tokio)',
    london: 'London',
    usVorboerse: 'US-Vorbörse',
    usKassa: 'US-Kassahandel',
    usNachboerse: 'US-Nachbörse',
    makro830: 'US-Makrodaten 08:30 ET',
    kassaAuf: 'Eröffnung US-Kassahandel',
    fomc1400: 'FOMC-Fenster 14:00 ET',
    kassaZu: 'Schluss US-Kassahandel',
    cmePause: 'CME-Handelspause (17–18 Uhr ET)',
    eroeffnung: 'Eröffnungsfenster',
    makro: 'Makrodaten-Fenster',
    fomc: 'FOMC-Fenster',
    schluss: 'Schlussfenster',
    cme: 'CME-Pause',
}

const zeitName = (id) => ZEIT_NAME[id] || String(id || '')

/**
 * So viele abgeschlossene Tage bilden die „übliche" Tagesspanne.
 *
 * Zehn ist ein Kompromiss: weniger reagiert zu heftig auf einen einzelnen
 * wilden Tag, mehr schleppt ein altes Regime mit (nach einem Volatilitäts-
 * einbruch stünde wochenlang eine zu grosse Bezugsspanne in der Zeile).
 */
const SPANNE_TAGE = 10

const nz = (v) => typeof v === 'number' && Number.isFinite(v)

/** Vorzeichenbehaftet, für Veränderungen. */
const pz = (v, k = 1) => (nz(v) ? `${v > 0 ? '+' : ''}${v.toFixed(k)} %` : 'n/a')

/** Ohne Vorzeichen, für Anteile und Stände. */
const proz = (v, k = 1) => (nz(v) ? `${v.toFixed(k)} %` : 'n/a')

const geld = (v) => {
    if (!nz(v)) return 'n/a'
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)} Mrd USD`
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)} Mio USD`
    if (v >= 1e3) return `${Math.round(v / 1000)}k USD`
    return `${Math.round(v)} USD`
}

const kurz = (s) => String(s || '').replace(/USDT$/, '')

/** Preise ohne feste Nachkommastellen — BTC braucht keine, ein Meme-Coin fünf. */
const preisText = (v) => {
    if (!nz(v)) return 'n/a'
    if (v >= 1000) return v.toFixed(0)
    if (v >= 10) return v.toFixed(2)
    if (v >= 0.1) return v.toFixed(4)
    return v.toFixed(6)
}

/** Minuten in „2 h 15 min" — Countdowns liest niemand gern in Minuten. */
const dauer = (ms) => {
    if (!nz(ms)) return 'n/a'
    const min = Math.round(Math.abs(ms) / 60000)
    if (min < 60) return `${min} min`
    return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}

const median = (werte) => {
    const s = werte.filter(nz).sort((a, b) => a - b)
    if (!s.length) return null
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const letzter = (reihe) => {
    if (!Array.isArray(reihe)) return null
    for (let i = reihe.length - 1; i >= 0; i--) if (nz(reihe[i])) return reihe[i]
    return null
}

/** Beginn des laufenden UTC-Tages — dieselbe Grenze, die Binance für Tageskerzen zieht. */
export function tagesBeginn(jetzt) {
    const d = new Date(jetzt)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Kerzen zu Kennzahlen des Handelstages.
 *
 * Jede Teilrechnung darf `null` liefern; eine fehlende Kerzenreihe kostet ein
 * Feld, nie das ganze Bild. Alle Eingaben sind GESCHLOSSENE Kerzen im Format
 * `{t,o,h,l,c,v}` — die laufende Kerze fehlt bewusst, sonst schwankte die
 * Tagesspanne im Sekundentakt.
 *
 * @param {object} opt
 * @param {Array} opt.k5m   5-Minuten-Kerzen, mindestens der laufende Tag
 * @param {Array} opt.k1h   1-Stunden-Kerzen, mindestens 60 für ATR und ADX
 * @param {Array} opt.kTag  Tageskerzen, mindestens `SPANNE_TAGE` + 1
 * @param {number} opt.jetzt
 */
export function rechneTagesbild({ k5m = [], k1h = [], kTag = [], jetzt = Date.now() } = {}) {
    const bild = {
        preis: null, tag: null, ueblich: null, vortag: null,
        vwap: null, atrPct: null, rvol: null, trend: null, bewegung: null,
    }

    const preis = k5m.length ? k5m[k5m.length - 1].c : (k1h.length ? k1h[k1h.length - 1].c : null)
    if (!nz(preis) || preis <= 0) return bild
    bild.preis = preis

    // ── Der laufende Tag ────────────────────────────────────────────────
    const beginn = tagesBeginn(jetzt)
    const heute = k5m.filter(k => k.t >= beginn)
    if (heute.length) {
        const hoch = Math.max(...heute.map(k => k.h))
        const tief = Math.min(...heute.map(k => k.l))
        const offen = heute[0].o
        const spanne = hoch - tief
        bild.tag = {
            hoch, tief, offen,
            spannePct: offen > 0 ? (spanne / offen) * 100 : null,
            // Wo im heutigen Bereich steht der Preis: 0 = am Tief, 100 = am Hoch.
            // Bei einer Spanne von exakt null (ein Markt, der seit Mitternacht
            // steht) ist die Frage sinnlos, nicht „50".
            positionPct: spanne > 0 ? ((preis - tief) / spanne) * 100 : null,
            seitOffenPct: offen > 0 ? ((preis - offen) / offen) * 100 : null,
            // Wie weit der Tag ist — ohne das steht „40 % der Spanne genutzt"
            // ohne Massstab da: um 02:00 wäre das viel, um 22:00 wenig.
            stundenGelaufen: (jetzt - beginn) / 3600000,
        }

        // Tages-VWAP: das Niveau, um das der Tag bisher gehandelt hat. Wichtig
        // genug für eine eigene Zeile, weil es die einzige Marke ist, die aus
        // dem heutigen Handel selbst kommt statt aus der Vergangenheit.
        let pv = 0
        let vol = 0
        for (const k of heute) {
            const tp = (k.h + k.l + k.c) / 3
            if (nz(tp) && nz(k.v)) { pv += tp * k.v; vol += k.v }
        }
        if (vol > 0) {
            const v = pv / vol
            bild.vwap = { wert: v, abstandPct: ((preis - v) / v) * 100 }
        }
    }

    // ── Übliche Tagesspanne und Vortag ──────────────────────────────────
    // Die letzte Tageskerze ist der letzte ABGESCHLOSSENE Tag, also der Vortag.
    if (kTag.length >= 2) {
        const v = kTag[kTag.length - 1]
        bild.vortag = {
            hoch: v.h, tief: v.l, schluss: v.c,
            abstandHochPct: ((preis - v.h) / v.h) * 100,
            abstandTiefPct: ((preis - v.l) / v.l) * 100,
            abstandSchlussPct: ((preis - v.c) / v.c) * 100,
        }
    }
    if (kTag.length >= 3) {
        const spannen = kTag.slice(-SPANNE_TAGE).map(k => (k.o > 0 ? ((k.h - k.l) / k.o) * 100 : null))
        const m = median(spannen)
        if (nz(m) && m > 0) {
            bild.ueblich = {
                spannePct: m,
                tage: spannen.filter(nz).length,
                // Die Kernzahl: wie viel der normalen Tagesbewegung ist durch.
                // Über 100 % heisst nicht „Ende", aber es heisst, dass die
                // Fortsetzung teurer wird als der Rückweg.
                genutztPct: nz(bild.tag?.spannePct) ? (bild.tag.spannePct / m) * 100 : null,
            }
        }
    }

    // ── Stundenraster: Volatilität, Trend, Beteiligung ──────────────────
    if (k1h.length >= 30) {
        const a = letzter(atr(k1h, 14))
        if (nz(a)) bild.atrPct = (a / preis) * 100

        const e20 = letzter(ema(k1h, 20))
        const e50 = letzter(ema(k1h, 50))
        const dx = adx(k1h, 14)
        const adxWert = letzter(dx.adx)
        const plus = letzter(dx.plusDI)
        const minus = letzter(dx.minusDI)
        if (nz(e20) || nz(adxWert)) {
            bild.trend = {
                ema20: e20, ema50: e50,
                ueberEma20: nz(e20) ? preis > e20 : null,
                emaLage: nz(e20) && nz(e50) ? (e20 > e50 ? 'auf' : 'ab') : null,
                adx: adxWert,
                richtung: nz(plus) && nz(minus) ? (plus > minus ? 'auf' : 'ab') : null,
            }
        }

        /*
         * RVOL gegen die 20 Kerzen VOR den verglichenen — sonst dämpft ein
         * Ausreisser seinen eigenen Massstab. Dieselbe Begründung wie im
         * Coin-Radar (`kennzahlen.js`), deshalb hier bewusst dieselbe Form.
         */
        const ohneLetzte = k1h.slice(0, -3)
        const basis = letzter(volumeSma(ohneLetzte, 20))
        const jung = k1h.slice(-3).map(k => k.v).filter(nz)
        if (nz(basis) && basis > 0 && jung.length) {
            bild.rvol = (jung.reduce((s, v) => s + v, 0) / jung.length) / basis
        }

        const wandel = (n) => {
            if (k1h.length <= n) return null
            const a0 = k1h[k1h.length - 1 - n].c
            return a0 > 0 ? ((preis - a0) / a0) * 100 : null
        }
        bild.bewegung = { h1: wandel(1), h4: wandel(4), h24: wandel(24) }
    }

    return bild
}

/**
 * Alle Quellen als Textzeilen.
 *
 * Reihenfolge ist Absicht und nicht Geschmack: Zeit und Termine zuerst, weil
 * sie den Rahmen setzen, in dem alles andere gilt — eine perfekte Trendlage
 * zwanzig Minuten vor einer Zinsentscheidung ist keine Trendlage. Danach das
 * Tagesbild des gehandelten Symbols, dann die Mechanik, dann der breite Markt.
 * Die KI liest von oben nach unten und gewichtet erfahrungsgemäss entsprechend.
 *
 * @param {object} d Nutzlasten je Quelle (jede einzelne darf null sein)
 * @returns {Array<{id: string, text: string}>}
 */
export function baueHandelsZeilen(d = {}) {
    const zeilen = []
    const dazu = (id, text) => { if (text) zeilen.push({ id, text }) }
    const sym = kurz(d.symbol || '')

    // ── Wo im Handelstag stehen wir ─────────────────────────────────────
    if (d.zeit) {
        const z = d.zeit
        const teile = []
        if (z.phase?.id) teile.push(`laufende Sitzung ${zeitName(z.phase.id)}`)
        else teile.push('keine Hauptsitzung aktiv')
        if (z.ueberlappung) teile.push('London und US überlappen (umsatzstärkste Phase)')
        if (z.terminmarktOffen === false) teile.push('CME-Terminmarkt geschlossen')
        if (z.feiertag) teile.push('US-Feiertag')
        const naechste = (z.naechste || []).slice(0, 2)
            .map(n => `${zeitName(n.id)} in ${dauer(n.inMs)}`)
        if (naechste.length) teile.push(`als Nächstes ${naechste.join(', ')}`)
        dazu('zeit', `Handelstag: ${teile.join('; ')}`)

        if (z.warnungen?.length) {
            dazu('zeit', 'Zeitfenster mit erhöhtem Risiko: ' + z.warnungen
                .map(w => `${zeitName(w.id)} (Stufe ${w.stufe}, noch ${dauer(w.bisMs - z.jetzt)})`).join(', '))
        }
    }

    // ── Was in den nächsten Stunden ansteht ─────────────────────────────
    if (d.termine) {
        const offen = (d.termine.ereignisse || []).filter(e => !e.vorbei).slice(0, 4)
        if (offen.length) {
            dazu('termine', `Termine der nächsten ${d.termine.stunden} h: ` + offen
                .map(e => `${e.country || ''} ${e.title} in ${dauer(e.inMs)} (Bedeutung ${e.impact})`.trim())
                .join('; '))
        } else if (d.termine.gesamtImZeitraum > 0) {
            // „Nichts los" und „alles weggefiltert" sind zwei verschiedene
            // Aussagen. Die Kalender-Kachel unterscheidet sie, also auch hier.
            dazu('termine', `Termine der nächsten ${d.termine.stunden} h: keiner in der gewählten Bedeutungsstufe`
                + ` (${d.termine.gesamtImZeitraum} insgesamt im Zeitraum, herausgefiltert)`)
        } else {
            dazu('termine', `Termine der nächsten ${d.termine.stunden} h: keine`)
        }
    }

    // ── Das Tagesbild des gehandelten Symbols ───────────────────────────
    if (d.tagesbild?.preis) {
        const b = d.tagesbild
        dazu('tagesbild', `${sym} Kurs ${preisText(b.preis)} USD`
            + (b.bewegung ? `; 1 h ${pz(b.bewegung.h1, 2)}, 4 h ${pz(b.bewegung.h4, 2)}, 24 h ${pz(b.bewegung.h24, 2)}` : ''))

        if (b.tag) {
            dazu('tagesbild', `Tagesspanne (seit 00:00 UTC, ${b.tag.stundenGelaufen.toFixed(1)} h gelaufen): `
                + `Hoch ${preisText(b.tag.hoch)} / Tief ${preisText(b.tag.tief)}`
                + `, Spanne ${proz(b.tag.spannePct, 2)}`
                + (nz(b.tag.positionPct)
                    ? `, Preis steht bei ${b.tag.positionPct.toFixed(0)} % der Spanne (0 = Tagestief, 100 = Tageshoch)`
                    : '')
                + `, seit Tagesbeginn ${pz(b.tag.seitOffenPct, 2)}`)
        }

        if (b.ueblich) {
            /*
             * Diese Zeile trägt am meisten Bedeutung und wird deshalb erklärt
             * statt nur beziffert: eine nackte Prozentzahl „genutzt 118 %" hat
             * ein Modell in einem früheren Entwurf als „Kursanstieg von 118 %"
             * gelesen und daraus einen Blow-off-Top gemacht.
             */
            dazu('tagesbild', `Bewegungsvorrat: die heutige Spanne entspricht `
                + `${nz(b.ueblich.genutztPct) ? b.ueblich.genutztPct.toFixed(0) : '?'} % einer üblichen Tagesspanne `
                + `(Median der letzten ${b.ueblich.tage} Tage: ${proz(b.ueblich.spannePct, 2)}). `
                + 'Über 100 % heisst: der Markt hat sein normales Tagespensum bereits abgearbeitet — '
                + 'das ist keine Richtungsaussage, sondern eine über den verbleibenden Spielraum.')
        }

        if (b.vortag) {
            dazu('tagesbild', `Marken aus dem Vortag: Hoch ${preisText(b.vortag.hoch)} (${pz(b.vortag.abstandHochPct, 2)} entfernt)`
                + `, Tief ${preisText(b.vortag.tief)} (${pz(b.vortag.abstandTiefPct, 2)})`
                + `, Schluss ${preisText(b.vortag.schluss)} (${pz(b.vortag.abstandSchlussPct, 2)})`)
        }

        if (b.vwap) {
            dazu('tagesbild', `Tages-VWAP ${preisText(b.vwap.wert)}, Preis liegt ${pz(b.vwap.abstandPct, 2)} davon entfernt`
                + ` (${b.vwap.abstandPct >= 0 ? 'darüber' : 'darunter'})`)
        }

        const feld = []
        if (nz(b.atrPct)) feld.push(`ATR(14) auf 1 h ${proz(b.atrPct, 2)} vom Kurs`)
        if (nz(b.rvol)) feld.push(`Volumen der letzten 3 h ${b.rvol.toFixed(2)}× der 20-Stunden-Norm`)
        if (b.trend) {
            const t = b.trend
            if (nz(t.adx)) feld.push(`ADX(14) 1 h ${t.adx.toFixed(0)} (unter 20 richtungslos, über 25 Trend)`)
            if (t.emaLage) feld.push(`EMA20 ${t.emaLage === 'auf' ? 'über' : 'unter'} EMA50 auf 1 h`)
            if (t.ueberEma20 !== null && t.ueberEma20 !== undefined) {
                feld.push(`Preis ${t.ueberEma20 ? 'über' : 'unter'} EMA20`)
            }
        }
        if (feld.length) dazu('tagesbild', `Bewegungsart ${sym}: ${feld.join('; ')}`)
    }

    // ── Mechanik auf zwei Fenstern ──────────────────────────────────────
    // Zwei statt eines: 15 Minuten ist der Takt, in dem ein Daytrader arbeitet,
    // 1 Stunde der Rahmen. Widersprechen sie sich, ist genau das der Befund.
    for (const [id, m] of [['mechanik15', d.mechanik15], ['mechanik1h', d.mechanik1h]]) {
        if (!m) continue
        const f = m.faktoren || {}
        const teile = [
            `Zustand ${m.state}`,
            `Preis ${pz(f.preisDeltaPct, 2)}`,
            `Open Interest ${pz(f.oiDeltaPct, 2)}`,
            // schon in Prozent geliefert (siehe `lagebild.js`, gleiche Falle)
            `Funding ${pz(f.fundingJahresRate, 1)} p.a.`,
        ]
        if (f.liqVerfuegbar) {
            teile.push(`Liquidationen Longs ${geld(f.liqLongUsd)} / Shorts ${geld(f.liqShortUsd)}`
                + (nz(f.liqSpikeFaktor) ? `, Spike-Faktor ${f.liqSpikeFaktor}` : ''))
        }
        if (m.gruende?.length) teile.push(`Gründe: ${m.gruende.join(', ')}`)
        dazu(id, `Marktmechanik ${kurz(m.symbol)} über ${m.fenster}: ${teile.join('; ')}`)
    }

    // ── Was gerade liquidiert wird ──────────────────────────────────────
    if (d.liqJetzt) {
        const l = d.liqJetzt
        if (l.anzahl > 0) {
            dazu('liqJetzt', `Liquidationen der letzten ${l.minuten} min`
                + (l.symbol ? ` in ${kurz(l.symbol)}` : ' marktweit')
                + `: Longs ${geld(l.longUsd)}, Shorts ${geld(l.shortUsd)}, ${l.anzahl} Ereignisse`
                + (l.groesstes ? `; grösstes ${geld(l.groesstes)}` : '')
                + ' (eigene Aufzeichnung, Binance drosselt auf eine Meldung je Sekunde und Symbol —'
                + ' die Beträge sind eine Stichprobe, ihr Verhältnis ist aussagekräftiger als ihre Höhe)')
        } else {
            dazu('liqJetzt', `Liquidationen der letzten ${l.minuten} min: keine aufgezeichnet`)
        }
    }

    // ── Positionierung ──────────────────────────────────────────────────
    if (d.lsoi?.jetzt) {
        const j = d.lsoi.jetzt
        dazu('lsoi', `Long/Short ${kurz(d.lsoi.symbol)}: ${proz(j.longPct, 1)} der Konten long`
            + `, Open Interest 24 h ${pz(j.oiDelta24hPct, 1)}, Preis 24 h ${pz(j.preisDelta24hPct, 1)}`
            + (j.deutung ? `, Lesart ${j.deutung}` : ''))
    }

    if (d.funding) {
        const takt = (r) => (nz(r.rate) && nz(r.intervallStunden)
            ? ` (${pz(r.rate * 100, 3)} je ${r.intervallStunden} h)` : '')
        const fmt = (r) => `${kurz(r.symbol)} ${pz(nz(r.jahresRate) ? r.jahresRate * 100 : null, 1)} p.a.${takt(r)}`
        // Nur die Ränder — die vollständige Liste ist eine Positionsbestimmung,
        // hier zählt bloss, ob eine Seite gerade überfüllt bezahlt wird.
        const teile = []
        if (d.funding.oben?.length) teile.push(`teuerste Longs: ${d.funding.oben.slice(0, 3).map(fmt).join(', ')}`)
        if (d.funding.unten?.length) teile.push(`teuerste Shorts: ${d.funding.unten.slice(0, 3).map(fmt).join(', ')}`)
        if (teile.length) {
            dazu('funding', `Funding-Ränder (Jahresraten, Zahlung je Takt ist an der Börse gedeckelt —`
                + ` dreistellige Jahresraten sind normal): ${teile.join('; ')}`)
        }
        const eigen = (d.funding.eigene || []).find(r => kurz(r.symbol) === sym)
        if (eigen) {
            dazu('funding', `Funding ${sym}: ${pz(nz(eigen.jahresRate) ? eigen.jahresRate * 100 : null, 1)} p.a.`
                + (nz(eigen.bitunix?.jahresRate) ? ` (Bitunix ${pz(eigen.bitunix.jahresRate * 100, 1)} p.a.)` : ''))
        }
    }

    // ── Der breite Markt, knapp ─────────────────────────────────────────
    if (d.rsi?.punkte?.length) {
        const heiss = d.rsi.punkte.filter(p => p.rsi >= 70).map(p => kurz(p.symbol))
        const kalt = d.rsi.punkte.filter(p => p.rsi <= 30).map(p => kurz(p.symbol))
        const eigen = d.rsi.punkte.find(p => kurz(p.symbol) === sym)
        dazu('rsi', `RSI ${d.rsi.tf} über ${d.rsi.gezaehlt} Märkte: Schnitt ${d.rsi.schnitt ?? 'n/a'}`
            + (eigen ? `, ${sym} selbst ${eigen.rsi}` : '')
            + `, über 70: ${heiss.length ? heiss.slice(0, 5).join(', ') : 'keiner'}`
            + `, unter 30: ${kalt.length ? kalt.slice(0, 5).join(', ') : 'keiner'}`)
    }

    if (d.markt?.muenzen?.length) {
        const mitWert = d.markt.muenzen.filter(c => nz(c.w24h))
        const plus = mitWert.filter(c => c.w24h > 0).length
        dazu('markt', `Marktbreite: ${plus} von ${mitWert.length} grossen Münzen in 24 h im Plus`
            + ` (${mitWert.length ? Math.round((plus / mitWert.length) * 100) : 0} %)`)
    }

    if (d.makro?.maerkte?.length) {
        const namen = { sp500: 'S&P 500', nasdaq: 'Nasdaq 100', russell: 'Russell 2000', dxy: 'Dollar-Index' }
        const teile = d.makro.maerkte.filter(m => m.verfuegbar).map(m =>
            `${namen[m.id] || m.id} ${pz(m.deltaPct, 2)}${m.offen === false ? ' (Börse zu)' : ''}`)
        const k = d.makro.korrelation
        if (k && nz(k.nasdaq)) teile.push(`Korrelation BTC↔Nasdaq ${k.nasdaq} (${k.deutung})`)
        if (teile.length) dazu('makro', `Makro: ${teile.join('; ')}`)
    }

    // ── Wo sonst Bewegung ist ───────────────────────────────────────────
    if (d.coinradar?.zeilen?.length) {
        const z = d.coinradar.zeilen.slice(0, 5).map(r =>
            `${kurz(r.symbol)} (ATR ${proz(r.atrPct, 1)}, RVOL ${nz(r.rvol) ? r.rvol.toFixed(1) : '?'}×)`)
        dazu('coinradar', `Bewegteste handelbare Münzen laut Coin-Radar (Stand ${d.coinradar.alter}): ${z.join(', ')}`)
    }

    // ── Die eigene Sitzung ──────────────────────────────────────────────
    /*
     * Bewusst zuletzt und bewusst dabei: „ist heute noch etwas zu holen" hat
     * eine andere Antwort, wenn der eigene Plan kaum noch Raum lässt.
     *
     * Nur der PLAN, nicht der laufende Stand — das laufende Ergebnis steht
     * während einer Sitzung nirgends verlässlich (siehe `holeSitzung` in
     * `handelslage.js`). Jedes Feld einzeln geprüft: „0 Trades von höchstens
     * null" wäre schlimmer als die kürzere Zeile.
     */
    if (d.sitzung) {
        const s = d.sitzung
        const teile = [`seit ${dauer(s.dauerMs)}`]
        if (nz(s.maxTrades) && s.maxTrades > 0) teile.push(`geplantes Trade-Höchstmass ${s.maxTrades}`)
        if (nz(s.maxVerlust) && s.maxVerlust > 0) teile.push(`Verlustdeckel ${s.maxVerlust} USD`)
        if (s.vorhaben) teile.push(`Vorhaben: ${s.vorhaben}`)
        dazu('sitzung', `Laufende Sitzung des Nutzers: ${teile.join(', ')}`)
    }

    return zeilen
}

/**
 * Antwort der KI auf eine feste Form bringen.
 *
 * Wie `normalisiereAntwort` in `lagebild.js`, aber mit den Feldern dieser
 * Kachel. `bedingungen` und `hinfaellig` sind der Kern des Unterschieds: sie
 * zwingen das Modell, seine Einordnung an Zahlen zu binden, statt sie nur zu
 * behaupten. Eine Bedingung ohne `wenn` ist keine — sie fällt raus.
 *
 * @returns {object|null}
 */
export function normalisiereHandelslage(json) {
    if (!json || typeof json !== 'object') return null

    const ueberschrift = String(json.ueberschrift || '').trim().slice(0, 140)
    const text = String(json.text || '').trim()
    if (!ueberschrift && !text) return null

    const punkte = (Array.isArray(json.punkte) ? json.punkte : [])
        .map(p => ({
            titel: String(p?.titel || '').trim().slice(0, 90),
            text: String(p?.text || '').trim(),
            ton: TOENE.includes(p?.ton) ? p.ton : 'neutral',
        }))
        .filter(p => p.titel || p.text)
        .slice(0, 5)

    const bedingungen = (Array.isArray(json.bedingungen) ? json.bedingungen : [])
        .map(b => ({
            wenn: String(b?.wenn || '').trim(),
            dann: String(b?.dann || '').trim(),
        }))
        .filter(b => b.wenn && b.dann)
        .slice(0, 4)

    const hinfaellig = (Array.isArray(json.hinfaellig) ? json.hinfaellig : [])
        .map(h => String(h || '').trim())
        .filter(Boolean)
        .slice(0, 3)

    return {
        lage: LAGEN.includes(json.lage) ? json.lage : 'unklar',
        ueberschrift,
        text,
        spielraum: String(json.spielraum || '').trim(),
        zeitfenster: String(json.zeitfenster || '').trim(),
        punkte,
        bedingungen,
        hinfaellig,
        widerspruch: String(json.widerspruch || '').trim(),
    }
}
