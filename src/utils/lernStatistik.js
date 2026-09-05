/**
 * Auswertung des Lern-Karteikastens.
 *
 * Reines Modul: keine Vue-Abhängigkeit, kein Netz, keine Datenbank — Selbsttest
 * `src/utils/__selftest-lern-statistik.mjs`.
 *
 * Eingabe ist überall dieselbe Form wie in `Lernen.vue`: eine Liste von
 * `{ karte, fortschritt }`, `fortschritt` darf `null` sein (Karte noch nie
 * bewertet). Die Zeitreihen (Wiederholungen pro Tag, Lernserie) lesen dafür
 * `fortschritt.historie` — dieselbe JSON-Spalte, in die `shared/leitner.js`
 * bei jeder Bewertung `{ t, grad }` schreibt. Kein eigener Netzwerkzugriff:
 * die Karten sind längst geladen, wenn diese Auswertung läuft.
 */

import { BOX_MAX, parseHistorie } from '../../shared/leitner.js'

/** Ab wie vielen Bewertungen eine Kategorie-Quote eine Aussage ist, nicht Zufall. */
export const MIN_GRUPPE = 3

const TAG_MS = 24 * 60 * 60 * 1000

const zahl = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/**
 * Alle Bewertungen einer Fortschrittszeile — der NENNER jeder Quote hier.
 *
 * „Schwer" gehört dazu und zählt nicht als Treffer (siehe `auswerten` in
 * shared/leitner.js). Vor dem 05.09.2026 steckte es in `gesamtRichtig` und
 * hob damit jede Quote genau bei den Karten an, die man noch nicht kann.
 * Zeilen aus der Zeit davor haben kein `gesamtSchwer` — `zahl()` macht daraus
 * eine 0, die Quote bleibt für diesen Altbestand also unverändert, statt zu
 * springen.
 */
function bewertungen(fortschritt) {
    return zahl(fortschritt?.gesamtRichtig) + zahl(fortschritt?.gesamtSchwer) + zahl(fortschritt?.gesamtFalsch)
}

/** Kalendertag in lokaler Zeit als sortierbarer Schlüssel. */
function tagSchluessel(t) {
    const d = new Date(zahl(t))
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/** Alle Bewertungen aus allen Karten zu einer flachen, zeitlich sortierten Liste. */
function historieEintraege(eintraege) {
    const alle = []
    for (const e of (eintraege || [])) {
        const h = parseHistorie(e?.fortschritt?.historie)
        for (const b of h) alle.push({ t: zahl(b?.t), grad: b?.grad, kategorie: e?.karte?.kategorie || '' })
    }
    return alle.sort((a, b) => a.t - b.t)
}

/**
 * 1. Überblick — die vier Kopfzahlen der Statistik-Seite.
 *
 * `erfolgsquote` ist `null`, solange noch keine einzige Karte bewertet wurde
 * (leeres Deck) — 0 % wäre eine falsche Aussage über eine Sitzung, die es
 * noch nicht gab.
 */
export function uebersicht(eintraege) {
    const aktive = (eintraege || []).filter(e => Number(e?.karte?.aktiv) !== 0)
    const mitFortschritt = aktive.filter(e => e.fortschritt)
    const gemeistert = aktive.filter(e => zahl(e.fortschritt?.box) === BOX_MAX).length
    const begonnen = mitFortschritt.filter(e => bewertungen(e.fortschritt) > 0).length
    const richtig = mitFortschritt.reduce((a, e) => a + zahl(e.fortschritt.gesamtRichtig), 0)
    const bewertungenGesamt = mitFortschritt.reduce((a, e) => a + bewertungen(e.fortschritt), 0)

    return {
        gesamt: aktive.length,
        gemeistert,
        gemeistertQuote: aktive.length ? gemeistert / aktive.length : 0,
        begonnen,
        bewertungenGesamt,
        erfolgsquote: bewertungenGesamt ? richtig / bewertungenGesamt : null,
    }
}

/** 2. Wiederholungen der letzten `tage` Tage (heute eingeschlossen), älteste zuerst. */
export function proTag(eintraege, jetztMs, tage = 14) {
    const zaehler = new Map()
    for (const b of historieEintraege(eintraege)) {
        const schl = tagSchluessel(b.t)
        zaehler.set(schl, (zaehler.get(schl) || 0) + 1)
    }
    const ergebnis = []
    for (let i = tage - 1; i >= 0; i--) {
        const schl = tagSchluessel(jetztMs - i * TAG_MS)
        ergebnis.push({ tag: schl, anzahl: zaehler.get(schl) || 0 })
    }
    return ergebnis
}

/**
 * 3. Lernserie — an wie vielen Tagen in Folge zuletzt mindestens eine Karte
 * bewertet wurde. Zählt ab heute, wenn heute schon gelernt wurde, sonst ab
 * gestern — ein Tag, der noch nicht vorbei ist, darf die Serie nicht
 * abbrechen lassen, nur weil man heute noch nicht dazu kam.
 */
export function lernserie(eintraege, jetztMs) {
    const tage = new Set(historieEintraege(eintraege).map(b => tagSchluessel(b.t)))
    let cursor = jetztMs
    if (!tage.has(tagSchluessel(cursor))) cursor -= TAG_MS
    let serie = 0
    while (tage.has(tagSchluessel(cursor))) {
        serie++
        cursor -= TAG_MS
    }
    return serie
}

/**
 * 4. Erfolg nach Kategorie — schwächste zuerst, damit sofort sichtbar ist, wo
 * es hakt. Kategorien ohne jede Bewertung fehlen ganz (nichts zu zeigen ist
 * ehrlicher als eine 0 %, die nur „noch nie versucht" bedeutet); Kategorien
 * unter `MIN_GRUPPE` Bewertungen tragen `duenn: true` statt eine Quote zu
 * behaupten, die noch reiner Zufall sein kann.
 */
export function proKategorie(eintraege) {
    const gruppen = new Map()
    for (const e of (eintraege || [])) {
        const kat = e?.karte?.kategorie
        if (!kat) continue
        const richtig = zahl(e.fortschritt?.gesamtRichtig)
        const gesamt = bewertungen(e.fortschritt)
        if (gesamt === 0) continue
        if (!gruppen.has(kat)) gruppen.set(kat, { richtig: 0, gesamt: 0 })
        const g = gruppen.get(kat)
        g.richtig += richtig
        g.gesamt += gesamt
    }
    return [...gruppen.entries()]
        .map(([kategorie, g]) => {
            const anzahl = g.gesamt
            return { kategorie, anzahl, quote: g.richtig / anzahl, duenn: anzahl < MIN_GRUPPE }
        })
        .sort((a, b) => a.quote - b.quote)
}

/** Alles auf einmal — die Ansicht braucht keine vier Aufrufe. */
export function werteAus(eintraege, jetztMs) {
    return {
        uebersicht: uebersicht(eintraege),
        proTag: proTag(eintraege, jetztMs),
        serie: lernserie(eintraege, jetztMs),
        kategorien: proKategorie(eintraege),
    }
}
