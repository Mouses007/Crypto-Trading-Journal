/**
 * Selbsttest: Arschlochfilter und Lagebericht-Prompt.
 *
 * Läuft ohne Netz und ohne Datenbank. Prüft die reinen Funktionen des
 * News-Umbaus: die Filterregel (`istGefiltert`), die Wörter-Zerlegung, die
 * Themen-Auswahl und den Prompt-Builder mit seinen Kapitel-/Längen-Varianten.
 *
 * Aufruf: node server/__selftest-news-filter.mjs
 */
import { istGefiltert, istFokusTreffer, zerlegeWoerter, baueRechercheZitate, THEMEN_NAMEN } from './news-recherche.js'
import {
    bauLagePrompt, leseThemen, bauAnweisungPruefPrompt, leseAnweisungPruefung,
} from './marktradar-news.js'

let fehler = 0
// Auch die bestandenen zählen: `scripts/run-selftests.mjs` liest das Zahlenpaar
// aus der Schlussmeldung. Ohne es zählte die ganze Datei als EINE Prüfung —
// die Gesamtsumme des Sammellaufs war dadurch deutlich zu niedrig.
let bestanden = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Arschlochfilter & Lagebericht-Prompt')

// 1) Truth Social fliegt automatisch — unabhängig von der Wörterliste.
pruefe('Truth-Quelle wird ohne Wörter gefiltert',
    istGefiltert({ titel: 'Irgendwas' }, [], { art: 'truth', name: 'Truth Social' }))
pruefe('RSS-Quelle bleibt ohne Wörter stehen',
    !istGefiltert({ titel: 'Irgendwas' }, [], { art: 'rss', name: 'Cointelegraph' }))

// 2) Stichwörter: Titel, Inhalt und Quellenname, ohne Beachtung der Schreibung.
const woerter = zerlegeWoerter('Donald Trump\nMichael Saylor\n\n  ')
pruefe('zerlegeWoerter wirft Leerzeilen raus', woerter.length === 2)
pruefe('zerlegeWoerter versteht auch Kommas',
    JSON.stringify(zerlegeWoerter('Donald Trump, Michael Saylor, '))
    === JSON.stringify(['Donald Trump', 'Michael Saylor']))
pruefe('Treffer im Titel',
    istGefiltert({ titel: 'DONALD TRUMP kündigt an' }, woerter, { art: 'rss', name: 'Feed' }))
pruefe('Treffer im Inhalt',
    istGefiltert({ titel: 'Neues', inhalt: 'Zitat von michael saylor zu BTC' }, woerter, { art: 'rss', name: 'Feed' }))
pruefe('Treffer im Quellennamen',
    istGefiltert({ titel: 'Neues' }, woerter, { art: 'rss', name: 'Michael Saylor Feed' }))
pruefe('Kein Treffer, kein Filter',
    !istGefiltert({ titel: 'ETF-Flüsse steigen', inhalt: 'BlackRock meldet Zufluss' }, woerter, { art: 'rss', name: 'Feed' }))
pruefe('Leere Wörterliste filtert nichts (ausser Truth)',
    !istGefiltert({ titel: 'Donald Trump' }, [], { art: 'rss', name: 'Feed' }))

// 2b) Fokus-Filter: das Gegenstück — leer lässt alles durch, gesetzt nur Treffer.
const fokusWoerter = zerlegeWoerter('Bitcoin\nBTC')
pruefe('Fokus: leere Liste lässt alles durch',
    istFokusTreffer({ titel: 'Irgendwas' }, [], { art: 'rss', name: 'Feed' }))
pruefe('Fokus: Treffer im Titel',
    istFokusTreffer({ titel: 'BTC steigt' }, fokusWoerter, { art: 'rss', name: 'Feed' }))
pruefe('Fokus: Treffer im Inhalt',
    istFokusTreffer({ titel: 'Neues', inhalt: 'Bitcoin überschreitet Marke' }, fokusWoerter, { art: 'rss', name: 'Feed' }))
pruefe('Fokus: Treffer im Quellennamen',
    istFokusTreffer({ titel: 'Neues' }, fokusWoerter, { art: 'rss', name: 'Bitcoin Magazine' }))
pruefe('Fokus: kein Treffer fällt raus',
    !istFokusTreffer({ titel: 'Ethereum-Update', inhalt: 'Layer-2-Neuigkeiten' }, fokusWoerter, { art: 'rss', name: 'Feed' }))
pruefe('Fokus ist unabhängig von Truth Social (keine automatische Sonderregel)',
    istFokusTreffer({ titel: 'BTC News' }, fokusWoerter, { art: 'truth', name: 'Truth Social' }))

// 2c) baueRechercheZitate: Chart-Bilder wandern an den passenden Beleg.
{
    const zitate = baueRechercheZitate(
        ['https://example.com/btc-chart', 'https://andere-seite.com/ohne-bild'],
        [
            { url: 'https://img.example.com/btc.png', quelle: 'https://example.com/btc-chart' },
            { url: 'https://img.example.com/unrelated.png', quelle: 'https://nirgends-zitiert.com/x' },
        ],
        new Map([['https://example.com/btc-chart', '22.08.2026']]),
    )
    pruefe('Zitat mit passendem Bild bekommt es zugeordnet',
        zitate[0].bild === 'https://img.example.com/btc.png')
    pruefe('Zitat ohne passendes Bild bleibt ohne Bild',
        zitate[1].bild === '')
    pruefe('Bild, dessen Herkunft in keinem Zitat steht, taucht nirgends unpassend auf',
        !zitate.some(z => z.bild === 'https://img.example.com/unrelated.png'))
    pruefe('Datum landet im Titel', zitate[0].titel.includes('22.08.2026'))
    pruefe('Trailing Slash bei der Herkunft stört den Abgleich nicht',
        baueRechercheZitate(['https://x.com/a/'], [{ url: 'https://img.x.com/a.png', quelle: 'https://x.com/a' }])[0].bild
            === 'https://img.x.com/a.png')
    pruefe('Ohne Bilder bleibt jedes Zitat bildlos',
        baueRechercheZitate(['https://x.com/a'], [])[0].bild === '')
}

// 3) Themen-Auswahl: feste Reihenfolge, Unbekanntes fliegt, leer fällt zurück.
pruefe('leseThemen behält die Kapitelreihenfolge',
    JSON.stringify(leseThemen('tech,crypto')) === JSON.stringify(['crypto', 'tech']))
pruefe('leseThemen wirft Unbekanntes raus',
    JSON.stringify(leseThemen('crypto,quatsch')) === JSON.stringify(['crypto']))
pruefe('leseThemen fällt auf crypto zurück',
    JSON.stringify(leseThemen('')) === JSON.stringify(['crypto']))
pruefe('Jedes Thema hat einen Namen für den Prompt',
    ['crypto', 'finanzen', 'tech', 'chartanalyse'].every(t => THEMEN_NAMEN[t]))
pruefe('Chartanalyse ist wählbar und steht am Schluss',
    JSON.stringify(leseThemen('chartanalyse,crypto')) === JSON.stringify(['crypto', 'chartanalyse']))

// 4) Prompt-Builder: Kapitel, Längen, Rhythmus.
const p1 = bauLagePrompt({ themen: ['crypto', 'tech'], laenge: 'kurz', rhythmus: 'taeglich' })
pruefe('gewählte Kapitel stehen im Prompt', p1.includes('"crypto"') && p1.includes('"tech"'))
pruefe('nicht gewähltes Kapitel fehlt', !p1.includes('"finanzen"'))
pruefe('kurz heisst zwei bis drei Punkte', p1.includes('zwei bis drei Punkte'))
pruefe('täglich heisst 36 Stunden, solange nichts Genaueres bekannt ist', p1.includes('36 Stunden'))
// Der Zeitraum ist eine Behauptung über die Grundlage: Liegt die wahre
// Abdeckung vor, gilt sie — sonst verspricht der Prompt einen Tag und liefert
// sechs Stunden.
pruefe('gemessene Abdeckung schlägt das eingestellte Fenster',
    bauLagePrompt({ abdeckung: 'der letzten 7 Stunden' }).includes('der letzten 7 Stunden'))
pruefe('gemessene Abdeckung verdrängt die 36 Stunden',
    !bauLagePrompt({ abdeckung: 'der letzten 7 Stunden' }).includes('36 Stunden'))
pruefe('Krypto-Kapitel bringt die Marktdaten-Anweisung mit', p1.includes('Marktdaten-Block'))
pruefe('Antwortschema verlangt Kapitel', p1.includes('"kapitel"'))

const p2 = bauLagePrompt({ themen: ['finanzen'], laenge: 'lang', rhythmus: 'woechentlich' })
pruefe('lang heisst sechs bis acht Punkte', p2.includes('sechs bis acht Punkte'))
pruefe('wöchentlich heisst vergangene Woche', p2.includes('vergangenen Woche'))
pruefe('ohne Krypto keine Krypto-Rangfolge', !p2.includes('ETF-Flüsse'))

const p3 = bauLagePrompt()
pruefe('Vorgabe ist mittel/täglich/crypto',
    p3.includes('vier bis fünf Punkte') && p3.includes('36 Stunden') && p3.includes('"crypto"'))

const p4 = bauLagePrompt({ themen: ['crypto', 'chartanalyse'], laenge: 'kurz' })
pruefe('Chartanalyse-Kapitel verbietet eigene Deutung', p4.includes('keine eigene Chartdeutung'))
// Videos sind für dieses Kapitel eine Quelle, Text-Meldungen nicht: Ein
// Chartvideo IST eine Analyse, eine Nachrichtenmeldung ist es nicht.
pruefe('Videos dürfen ins Chartkapitel', p4.includes('Videoinhalten'))
pruefe('Text-Meldungen bleiben draussen', p4.includes('gehören weiterhin NICHT in dieses'))
pruefe('Videomarken brauchen die Quelle', p4.includes('nenne das Video als Quelle'))
pruefe('Widerspruch wird nebeneinandergestellt, nicht entschieden',
    p4.includes('nenne beide Stände nebeneinander'))
pruefe('ohne Chartanalyse keine Chartanalyse-Anweisung', !p1.includes('Chartdeutung'))

// 5) Zwischenmeldung: melden, was dazukam — nicht den Bericht umschreiben.
const p5 = bauLagePrompt({ themen: ['crypto'], laenge: 'kurz', aktualisierung: true })
pruefe('Zwischenmeldung sagt, dass sie kein zweiter Bericht ist',
    p5.includes('KEIN ZWEITER TAGESBERICHT'))
pruefe('Zwischenmeldung bekommt den Tagesbericht als Abgrenzung',
    p5.includes('BEREITS BERICHTET'))
// Der Kern der Sache: nicht wiederholen, was heute Morgen schon dastand.
pruefe('Zwischenmeldung verbietet Wiederholung',
    p5.includes('NICHT noch einmal vor'))
pruefe('Zwischenmeldung kennt die Marke „korrektur"', p5.includes('"korrektur": true'))
pruefe('Zwischenmeldung fragt nach Zahlen', p5.includes('Zahlen sind hier das Wichtigste'))
pruefe('Zwischenmeldung darf kurz ausfallen', p5.includes('Zwei belastbare Punkte'))
pruefe('Zwischenmeldung nennt kein festes Zeitfenster mehr',
    !p5.includes('36 Stunden') && p5.includes('seit dem bisherigen Bericht'))
// Der reguläre Bericht darf davon nichts abbekommen — sonst führte er Marken,
// die für ihn nichts bedeuten, und lüde zum Erfinden von Korrekturen ein.
pruefe('regulärer Bericht kennt keine Zwischenmeldung',
    !p1.includes('BEREITS BERICHTET') && !p1.includes('"korrektur"'))

// 6) Anweisungen prüfen: der Prompt muss die Grenzen NENNEN, sonst bestätigt
// die Prüfung Wünsche, an die sich der Bericht später nicht hält.
const pp = bauAnweisungPruefPrompt({ themen: ['crypto', 'tech'], laenge: 'kurz' })
pruefe('Prüfprompt schreibt keinen Bericht', pp.includes('KEINEN Bericht'))
pruefe('Prüfprompt nennt die Kapitel', pp.includes('crypto, tech'))
pruefe('Prüfprompt nennt den Umfang der Länge', pp.includes('zwei bis drei Punkte'))
pruefe('Prüfprompt nennt die unverrückbaren Regeln',
    pp.includes('keine Handelsempfehlungen') && pp.includes('nichts Erfundenes'))
pruefe('Prüfprompt kennt die drei Marken',
    pp.includes('"wirkt"') && pp.includes('"wirkungslos"') && pp.includes('"gegenregel"'))
pruefe('Prüfprompt verlangt eine geschärfte Fassung', pp.includes('"vorschlag"'))
pruefe('Prüfprompt ohne Quellen behauptet keine', pp.includes('AKTUELL keine.'))

// Die eingerichteten Quellen müssen im Prompt STEHEN. Ohne die Liste rät das
// Modell, ob ein genannter Kanal erreichbar ist — und riet am 21.08.2026
// „keine eingerichtete Quelle" bei einem Kanal, der seit Monaten aktiv ist.
const pq = bauAnweisungPruefPrompt({
    themen: ['crypto'], laenge: 'kurz',
    quellen: [
        { name: 'Bitbull', art: 'youtube', videoAnalyse: 1 },
        { name: 'Coin Bureau', art: 'youtube', videoAnalyse: 0 },
        { name: 'Cointelegraph', art: 'rss' },
    ],
})
pruefe('Prüfprompt nennt die eingerichteten Quellen',
    pq.includes('Bitbull') && pq.includes('Cointelegraph'))
pruefe('Prüfprompt kennzeichnet die Videoauswertung',
    pq.includes('Bitbull (youtube, Videos werden ausgewertet)')
    && pq.includes('Coin Bureau (youtube)'))
pruefe('Prüfprompt verbietet „wirkungslos" für vorhandene Quellen',
    pq.includes('nenne es nicht wirkungslos'))
// Gleiche Rangfolge auf der Prüfseite: Was der Bericht dem Leser zugesteht,
// muss die Prüfung ihm auch zusagen — sonst warnt sie vor etwas, das wirkt.
pruefe('Prüfung stellt den Umfang unter die Anweisung',
    pp.includes('die Anweisung des Lesers geht ihr VOR'))
pruefe('Prüfung nennt den Weg zur eigenen Kachel',
    pp.includes('eigenen Kachel') && pp.includes('statt abzulehnen'))

const pr = leseAnweisungPruefung({
    befunde: [
        { art: 'wirkt', text: 'Nur Bitcoin-Themen' },
        { art: 'quatsch', text: 'unbekannte Marke' },
        'nackter Satz',
        { art: 'gegenregel', text: '' },
    ],
    vorschlag: '  Schreibe nur über Bitcoin.  ',
})
pruefe('drei brauchbare Befunde bleiben', pr.befunde.length === 3, JSON.stringify(pr.befunde))
// Im Zweifel die harmlose Marke: eine als „wirkt" ausgegebene Fehleinschätzung
// wäre der teure Fehler — der Leser verlässt sich darauf.
pruefe('unbekannte Marke wird zu wirkungslos', pr.befunde[1].art === 'wirkungslos')
pruefe('nackter Satz überlebt als wirkungslos',
    pr.befunde[2].art === 'wirkungslos' && pr.befunde[2].text === 'nackter Satz')
pruefe('leerer Befund fällt weg', !pr.befunde.some(b => !b.text))
pruefe('Vorschlag wird getrimmt', pr.vorschlag === 'Schreibe nur über Bitcoin.')
pruefe('Vorschlag wird auf die Feldlänge gekürzt',
    leseAnweisungPruefung({ vorschlag: 'x'.repeat(5000) }, { maxLaenge: 2000 }).vorschlag.length === 2000)
pruefe('Unsinn wirft nicht',
    leseAnweisungPruefung(null).befunde.length === 0 && leseAnweisungPruefung('kaputt').vorschlag === '')

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
