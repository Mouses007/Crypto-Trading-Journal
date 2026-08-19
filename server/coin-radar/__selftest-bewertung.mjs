/**
 * Selbsttest: Kennzahlen und Bewertung des Coin-Radars.
 *
 * Ohne Netz und ohne Datenbank. Hier entsteht die Rangfolge, nach der später
 * echtes Geld eingesetzt wird — geprüft wird deshalb beides: dass Gutes
 * hochkommt UND dass die Hürden halten, was sie versprechen.
 *
 * Aufruf: node server/coin-radar/__selftest-bewertung.mjs
 */
import { rechneZeiteinheit, fundingJahresRate } from './kennzahlen.js'
import {
    bewerte, pruefeHuerden, vergibRaenge, rangkorrelation,
    STANDARD_GEWICHTE, STANDARD_HUERDEN, ANKER,
} from './bewertung.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Coin-Radar: Kennzahlen & Bewertung')

/** Kerzenreihe bauen: gleichmässige Spanne, wählbares Volumen am Ende. */
function kerzen({ n = 60, preis = 100, spanne = 2, vol = 1000, letztesVol = null } = {}) {
    const raus = []
    for (let i = 0; i < n; i++) {
        const c = preis
        raus.push({
            t: i * 3600000,
            o: c, h: c + spanne / 2, l: c - spanne / 2, c,
            v: (letztesVol !== null && i === n - 1) ? letztesVol : vol,
        })
    }
    return raus
}

// ── Kennzahlen ──────────────────────────────────────────────────────────
const k = rechneZeiteinheit(kerzen({ preis: 100, spanne: 2 }))
p('ATR% wird relativ zum Preis gerechnet',
    k.atrPct > 1.5 && k.atrPct < 2.5, String(k.atrPct))

/*
 * Derselbe Coin, hundertfacher Preis, hundertfache Spanne: Der Prozentwert
 * MUSS gleich bleiben. Sonst rankt die Liste teure Coins nach oben, nur weil
 * ihre Zahlen grösser sind — der Fehler, den ATR% verhindern soll.
 */
const teuer = rechneZeiteinheit(kerzen({ preis: 10000, spanne: 200 }))
p('ATR% ist preisunabhängig',
    Math.abs(teuer.atrPct - k.atrPct) < 0.01, `${k.atrPct} vs ${teuer.atrPct}`)

const ruhig = rechneZeiteinheit(kerzen({ vol: 1000, letztesVol: 1000 }))
p('gleichbleibendes Volumen ergibt RVOL um 1',
    Math.abs(ruhig.rvol - 1) < 0.05, String(ruhig.rvol))

const ausbruch = rechneZeiteinheit(kerzen({ vol: 1000, letztesVol: 5000 }))
p('fünffaches Volumen ergibt RVOL um 5',
    Math.abs(ausbruch.rvol - 5) < 0.2, String(ausbruch.rvol))

/*
 * Der Vergleichsschnitt darf die aktuelle Kerze NICHT enthalten — sonst
 * dämpft ein Ausreisser seinen eigenen Massstab und meldet 4 statt 20.
 */
const extrem = rechneZeiteinheit(kerzen({ vol: 100, letztesVol: 2000 }))
p('Ausreisser dämpft seinen eigenen Massstab nicht',
    extrem.rvol > 15, String(extrem.rvol))

p('zu wenige Kerzen ergeben keine Kennzahlen',
    rechneZeiteinheit(kerzen({ n: 5 })).atrPct === null)
p('leere Eingabe wirft nicht', rechneZeiteinheit(null).atrPct === null)
p('kaputte Kerzen ergeben null',
    rechneZeiteinheit(Array.from({ length: 40 }, () => ({ c: 'x', h: 'y', l: 'z', v: 'w' }))).atrPct === null)

// ── Funding-Jahresrate ──────────────────────────────────────────────────
// 0,01 % je 8 h → 0,01 × 3 × 365 = 10,95 % im Jahr. Genau diese Zahl steht
// in der Praxisliteratur; sie ist der Grund, warum Funding hochgerechnet wird.
p('0,01 % je 8 h sind knapp 11 % im Jahr',
    Math.abs(fundingJahresRate(0.01, 8) - 10.95) < 0.01, String(fundingJahresRate(0.01, 8)))
p('vierstündliches Funding zählt doppelt',
    Math.abs(fundingJahresRate(0.01, 4) - 21.9) < 0.01)
p('fehlende Rate ergibt null, nicht null-Komma-null', fundingJahresRate(null) === null)

// ── Hürden ──────────────────────────────────────────────────────────────
const gut = { umsatz24h: 50e6, spreadBp: 1.2, tiefeUsd: 30000 }
p('liquider Coin besteht die Hürden', pruefeHuerden(gut).ok)

p('zu wenig Umsatz fällt durch',
    pruefeHuerden({ ...gut, umsatz24h: 1e6 }).grund === 'umsatz_zu_klein')
p('zu weiter Spread fällt durch',
    pruefeHuerden({ ...gut, spreadBp: 40 }).grund === 'spread_zu_weit')
p('zu wenig Tiefe fällt durch',
    pruefeHuerden({ ...gut, tiefeUsd: 100 }).grund === 'zu_wenig_tiefe')

/*
 * Der wichtigste Hürdenfall: KEIN Spread bekannt. Ungeprüft darf nicht in
 * eine Liste, die „hier kommst du gut rein und raus" behauptet.
 */
p('unbekannter Spread fällt durch, statt durchzurutschen',
    pruefeHuerden({ ...gut, spreadBp: undefined }).grund === 'spread_unbekannt')

p('eigene Hürden greifen',
    pruefeHuerden(gut, { ...STANDARD_HUERDEN, minUmsatz24hUsd: 100e6 }).grund === 'umsatz_zu_klein')

// ── Bewertung ───────────────────────────────────────────────────────────
const rohGut = { umsatz24h: 50e6, spreadBp: 1, tiefeUsd: 30000, fundingJahresRate: 5 }
const stark = bewerte(rohGut, {
    '1h': { atrPct: 3, rvol: 4, adx: 40 },
    '15m': { atrPct: 3, rvol: 3, adx: 35 },
})
p('starker Kandidat bekommt eine hohe Note', stark.note > 85, String(stark.note))
p('vier Teilnoten werden geliefert', Object.keys(stark.teilnoten).length === 4)
p('Bestätigung auf beiden Zeiteinheiten wird erkannt', stark.bestaetigt === true)
p('und im Hinweis benannt', stark.hinweise.some((h) => h.includes('im Spiel')))

const flau = bewerte({ ...rohGut, fundingJahresRate: 0 }, { '1h': { atrPct: 0.1, rvol: 1, adx: 10 } })
p('bewegungsloser Kandidat bekommt eine niedrige Note', flau.note < 25, String(flau.note))
p('Seitwärtslauf wird benannt', flau.hinweise.some((h) => h.includes('sägt')))

/*
 * Teures Funding muss die Note drücken — sonst rankt ein Coin nach oben,
 * dessen Haltekosten den Vorteil auffressen.
 */
const billig = bewerte({ ...rohGut, fundingJahresRate: 2 }, { '1h': { atrPct: 2, rvol: 2, adx: 30 } })
const teuerF = bewerte({ ...rohGut, fundingJahresRate: 120 }, { '1h': { atrPct: 2, rvol: 2, adx: 30 } })
p('teures Funding senkt die Note', teuerF.note < billig.note, `${billig.note} vs ${teuerF.note}`)
p('und wird ausgewiesen', teuerF.hinweise.some((h) => h.includes('Funding')))
// Auch NEGATIVES Funding kostet — nur eben die Gegenseite. Der Betrag zählt.
const negativ = bewerte({ ...rohGut, fundingJahresRate: -120 }, { '1h': { atrPct: 2, rvol: 2, adx: 30 } })
p('negatives Funding wird ebenso als Kosten gewertet', negativ.note === teuerF.note)

/*
 * Unbekanntes Funding darf NICHT als „günstig" durchgehen. Mit `Number(x)||0`
 * bekäme ein Coin ohne Daten die volle Kostenpunktzahl und stünde damit besser
 * da als einer mit gemessen niedrigen Kosten — dieselbe Falle wie bei der
 * Jahresrate, nur eine Ebene höher.
 */
const ohneFunding = bewerte({ ...rohGut, fundingJahresRate: null }, { '1h': { atrPct: 2, rvol: 2, adx: 30 } })
p('unbekanntes Funding bekommt die Mitte, nicht die Bestnote',
    ohneFunding.teilnoten.kosten === 50, String(ohneFunding.teilnoten.kosten))
p('und wird ausgewiesen', ohneFunding.hinweise.some((h) => h.includes('unbekannt')))
p('ein Coin mit sehr günstigem Funding steht besser da als einer ohne Daten',
    billig.teilnoten.kosten > ohneFunding.teilnoten.kosten,
    `${billig.teilnoten.kosten} vs ${ohneFunding.teilnoten.kosten}`)

const nurKurz = bewerte(rohGut, {
    '1h': { atrPct: 2, rvol: 1.1, adx: 30 },
    '15m': { atrPct: 2, rvol: 5, adx: 30 },
})
p('nur kurzfristiger Ausschlag wird als solcher benannt',
    nurKurz.hinweise.some((h) => h.includes('kurzfristiger')), JSON.stringify(nurKurz.hinweise))
p('und bekommt keinen Bestätigungszuschlag', nurKurz.bestaetigt === false)

// Grenzen und kaputte Eingaben
p('Note bleibt zwischen 0 und 100',
    stark.note <= 100 && flau.note >= 0)
const murks = bewerte({ fundingJahresRate: 'viel' }, { '1h': { atrPct: 'x', rvol: null, adx: undefined } })
p('unbrauchbare Eingaben ergeben eine gültige Zahl',
    Number.isFinite(murks.note) && murks.note >= 0, String(murks.note))

const schief = bewerte(rohGut, { '1h': { atrPct: 3, rvol: 4, adx: 40 } },
    { bewegung: 10, imSpiel: 10, trend: 10, kosten: 10 })
p('krumme Gewichtssumme bleibt im Bereich',
    schief.note >= 0 && schief.note <= 100, String(schief.note))

p('Standardgewichte summieren auf 100',
    Object.values(STANDARD_GEWICHTE).reduce((a, b) => a + b, 0) === 100)

// ── Ränge ───────────────────────────────────────────────────────────────
const zeilen = [
    { symbol: 'AAA', note: 80, status: 'bewertet' },
    { symbol: 'BBB', note: 90, status: 'bewertet' },
    { symbol: 'CCC', note: 90, status: 'bewertet' },
    { symbol: 'DDD', note: 99, status: 'huerde' },
]
vergibRaenge(zeilen)
p('bester bewerteter Coin bekommt Rang 1',
    zeilen.find((z) => z.symbol === 'BBB').rang === 1)
p('Gleichstand wird nach Symbol entschieden (stabile Anzeige)',
    zeilen.find((z) => z.symbol === 'CCC').rang === 2)
p('an der Hürde gescheiterte bekommen keinen Rang',
    zeilen.find((z) => z.symbol === 'DDD').rang === 0)

// ── Rangkorrelation ─────────────────────────────────────────────────────
const machListe = (reihenfolge) => reihenfolge.map((s, i) => ({ symbol: s, rang: i + 1 }))
const zwoelf = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']

const gleich = rangkorrelation(machListe(zwoelf), machListe(zwoelf))
p('identische Rangfolge ergibt Korrelation 1', Math.abs(gleich.wert - 1) < 0.001, String(gleich.wert))

const umgekehrt = rangkorrelation(machListe(zwoelf), machListe([...zwoelf].reverse()))
p('umgekehrte Rangfolge ergibt -1', Math.abs(umgekehrt.wert + 1) < 0.001, String(umgekehrt.wert))

/*
 * Zu wenige gemeinsame Symbole: lieber KEINE Zahl als eine, die aus drei
 * Punkten stammt und wie ein Befund aussieht.
 */
const duenn = rangkorrelation(machListe(['A', 'B', 'C']), machListe(['A', 'B', 'C']))
p('unter zehn gemeinsamen Symbolen gibt es keine Zahl', duenn.wert === null)
p('die Anzahl wird trotzdem gemeldet', duenn.gemeinsam === 3)

/*
 * Nur die Schnittmenge zählt — sonst misst man Zu- und Abgänge zwischen den
 * Läufen statt Beharrlichkeit.
 */
const anders = rangkorrelation(
    machListe([...zwoelf, 'X', 'Y']),
    machListe(['Z', ...zwoelf]),
)
p('nur gemeinsame Symbole gehen ein', anders.gemeinsam === 12)
p('und die Reihenfolge darunter ist unverändert', Math.abs(anders.wert - 1) < 0.001, String(anders.wert))

p('Anker sind gesetzt und plausibel',
    ANKER.rvolSchwelle === 2 && ANKER.adxUnten === 20 && ANKER.adxVoll > ANKER.adxUnten)

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
