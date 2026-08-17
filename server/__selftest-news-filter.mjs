/**
 * Selbsttest: Arschlochfilter und Lagebericht-Prompt.
 *
 * Läuft ohne Netz und ohne Datenbank. Prüft die reinen Funktionen des
 * News-Umbaus: die Filterregel (`istGefiltert`), die Wörter-Zerlegung, die
 * Themen-Auswahl und den Prompt-Builder mit seinen Kapitel-/Längen-Varianten.
 *
 * Aufruf: node server/__selftest-news-filter.mjs
 */
import { istGefiltert, zerlegeWoerter, THEMEN_NAMEN } from './news-recherche.js'
import { bauLagePrompt, leseThemen } from './marktradar-news.js'

let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) return
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

// 3) Themen-Auswahl: feste Reihenfolge, Unbekanntes fliegt, leer fällt zurück.
pruefe('leseThemen behält die Kapitelreihenfolge',
    JSON.stringify(leseThemen('tech,crypto')) === JSON.stringify(['crypto', 'tech']))
pruefe('leseThemen wirft Unbekanntes raus',
    JSON.stringify(leseThemen('crypto,quatsch')) === JSON.stringify(['crypto']))
pruefe('leseThemen fällt auf crypto zurück',
    JSON.stringify(leseThemen('')) === JSON.stringify(['crypto']))
pruefe('Jedes Thema hat einen Namen für den Prompt',
    ['crypto', 'finanzen', 'tech'].every(t => THEMEN_NAMEN[t]))

// 4) Prompt-Builder: Kapitel, Längen, Rhythmus.
const p1 = bauLagePrompt({ themen: ['crypto', 'tech'], laenge: 'kurz', rhythmus: 'taeglich' })
pruefe('gewählte Kapitel stehen im Prompt', p1.includes('"crypto"') && p1.includes('"tech"'))
pruefe('nicht gewähltes Kapitel fehlt', !p1.includes('"finanzen"'))
pruefe('kurz heisst zwei bis drei Punkte', p1.includes('zwei bis drei Punkte'))
pruefe('täglich heisst 36 Stunden', p1.includes('36 Stunden'))
pruefe('Krypto-Kapitel bringt die Marktdaten-Anweisung mit', p1.includes('Marktdaten-Block'))
pruefe('Antwortschema verlangt Kapitel', p1.includes('"kapitel"'))

const p2 = bauLagePrompt({ themen: ['finanzen'], laenge: 'lang', rhythmus: 'woechentlich' })
pruefe('lang heisst sechs bis acht Punkte', p2.includes('sechs bis acht Punkte'))
pruefe('wöchentlich heisst vergangene Woche', p2.includes('vergangenen Woche'))
pruefe('ohne Krypto keine Krypto-Rangfolge', !p2.includes('ETF-Flüsse'))

const p3 = bauLagePrompt()
pruefe('Vorgabe ist mittel/täglich/crypto',
    p3.includes('vier bis fünf Punkte') && p3.includes('36 Stunden') && p3.includes('"crypto"'))

console.log(fehler === 0 ? '  ✓ alle Prüfungen bestanden' : `  ${fehler} Fehler`)
process.exit(fehler === 0 ? 0 : 1)
