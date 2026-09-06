/**
 * Selbsttest des Lagebilds (KI-Kachel „Gesamtlage").
 *
 *   node server/__selftest-lagebild.mjs
 *
 * Zwei Dinge müssen hier stimmen, weil sie im Betrieb still danebengehen:
 *
 *   1. Die EINHEITEN. Die Funding-Kachel liefert die Jahresrate als
 *      Dezimalbruch, die Marktmechanik-Kachel dieselbe Grösse bereits in
 *      Prozent. Beide landen in derselben Zusammenfassung — wer eine davon
 *      falsch umrechnet, legt der KI eine Zahl vor, die um den Faktor 100
 *      danebenliegt, und die Einordnung klingt trotzdem plausibel.
 *   2. Die RICHTUNG der Liquidationen. „Longs liquidiert" und „Shorts
 *      liquidiert" bedeuten das Gegenteil voneinander; eine Vertauschung dreht
 *      die halbe Einordnung um, ohne dass irgendetwas nach Fehler aussieht.
 *
 * Dazu die Absicherung der Antwort: eine erfundene Stimmung oder zwölf Punkte
 * dürfen die Kachel nicht sprengen.
 */

import { baueZeilen, normalisiereAntwort, entdoppleWiderspruch, STIMMUNGEN } from './lagebild.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Zeile einer Kachel aus dem Ergebnis holen (die erste, falls mehrere). */
const zeile = (zeilen, id) => zeilen.find(z => z.id === id)?.text || ''
const alle = (zeilen, id) => zeilen.filter(z => z.id === id).map(z => z.text).join(' | ')

console.log('\nEinheiten')
{
    // Beide Kacheln melden 7,3 % p.a. — in verschiedenen Einheiten
    const zeilen = baueZeilen({
        funding: {
            n: 50,
            oben: [{ symbol: 'BTCUSDT', jahresRate: 0.073 }],
            unten: [{ symbol: 'ENAUSDT', jahresRate: -0.198 }],
            eigene: [
                { symbol: 'BTCUSDT', jahresRate: 0.073, bitunix: { jahresRate: 0.069 } },
                // Ohne Bitunix-Zeile darf kein „n/a" in der Liste stehen
                { symbol: 'ETHUSDT', jahresRate: 0.06, bitunix: null },
            ],
            divergenzen: [{ symbol: 'ZECUSDT', binance: 0.11, bybit: 0.0, rate: 0.0001, intervallStunden: 4 }],
        },
        mechanik: {
            symbol: 'BTCUSDT', fenster: '1h', state: 'NEUTRAL', gruende: [],
            faktoren: { preisDeltaPct: 0.01, oiDeltaPct: -0.11, fundingJahresRate: 7.3, liqVerfuegbar: false },
        },
    })

    check('Funding-Kachel: Dezimalbruch wird zu Prozent',
        zeile(zeilen, 'funding').includes('BTC +7.3 %'), zeile(zeilen, 'funding'))
    check('Funding-Kachel: negative Rate behält ihr Vorzeichen',
        zeile(zeilen, 'funding').includes('ENA -19.8 %'), zeile(zeilen, 'funding'))
    check('Marktmechanik: Prozentwert wird NICHT ein zweites Mal umgerechnet',
        zeile(zeilen, 'mechanik').includes('Funding +7.3 % p.a.'), zeile(zeilen, 'mechanik'))
    check('eigene Märkte: Binance und Bitunix nebeneinander',
        alle(zeilen, 'funding').includes('BTC +7.3 % (Bitunix +6.9 %)'), alle(zeilen, 'funding'))
    check('eigener Markt ohne Bitunix-Zeile bleibt ohne Klammer',
        alle(zeilen, 'funding').includes('ETH +6.0 %,') || alle(zeilen, 'funding').includes('ETH +6.0 % |')
        || /ETH \+6\.0 %$/m.test(alle(zeilen, 'funding')), alle(zeilen, 'funding'))
    check('Divergenz in Prozent statt im Rohbruch',
        alle(zeilen, 'funding').includes('ZEC +11.0 % p.a. vs. 0.0 % p.a.'), alle(zeilen, 'funding'))
    // Ohne Einheit hat ein Prüfer die Jahresrate als Einzelzahlung gelesen und
    // eine richtige Zahl als unmöglich verworfen (21.08.2026).
    check('Divergenz nennt den Takt der Zahlung',
        alle(zeilen, 'funding').includes('(+0.010 % je 4 h)'), alle(zeilen, 'funding'))
    check('Einheitenhinweis steht in der Grundlage',
        /JAHRESRATEN/.test(alle(zeilen, 'funding')), alle(zeilen, 'funding'))
}

console.log('\nRichtung der Liquidationen')
{
    const zeilen = baueZeilen({
        liq24: {
            aktiv: true, stunden: 24,
            gesamt: { longUsd: 1.9e6, shortUsd: 2.1e6, anzahl: 503 },
            symbole: [{ symbol: 'BTCUSDT', longUsd: 1e6, shortUsd: 1e6 }],
        },
    })
    const t = zeile(zeilen, 'liq24')
    check('Longs und Shorts stehen bei ihrem eigenen Betrag',
        t.includes('Longs 1.9 Mio USD') && t.includes('Shorts 2.1 Mio USD'), t)
    check('Ereigniszahl wird mitgegeben', t.includes('503 Ereignisse'), t)
    check('Stichprobencharakter wird angeschrieben', /Stichprobe/.test(t), t)

    // Ausgeschaltete Aufzeichnung heisst NICHT „null Liquidationen"
    const aus = baueZeilen({ liq24: { aktiv: false, stunden: 24, gesamt: { longUsd: 0, shortUsd: 0, anzahl: 0 } } })
    check('ausgeschaltete Aufzeichnung wird als Lücke gemeldet, nicht als Null',
        /ausgeschaltet/.test(zeile(aus, 'liq24')) && !/Longs 0/.test(zeile(aus, 'liq24')),
        zeile(aus, 'liq24'))
}

console.log('\nFehlende Kacheln')
{
    check('leere Eingabe ergibt keine Zeilen und keinen Fehler', baueZeilen({}).length === 0)
    check('ohne Argument ebenso', baueZeilen().length === 0)

    // Eine Kachel ohne Nutzlast darf die übrigen nicht mitreissen
    const zeilen = baueZeilen({
        fng: { aktuell: { wert: 31, klasse: 'fear' }, gestern: { wert: 34 }, mittel30: 34.2 },
        dom: null, funding: null, lsoi: undefined,
        picycle: { jetzt: { abstandPct: -59, ausgeloest: false }, letzteKreuzung: null },
    })
    check('vorhandene Kacheln überleben ausgefallene Nachbarn', zeilen.length === 2, `${zeilen.length}`)
    check('Fear & Greed mit Klasse und Mittelwert',
        zeile(zeilen, 'fng') === 'Fear & Greed: 31 (fear), gestern 34, 30-Tage-Mittel 34.2', zeile(zeilen, 'fng'))
    check('Pi-Cycle nennt den Abstand und den Auslösezustand',
        zeile(zeilen, 'picycle').includes('-59.0 %') && zeile(zeilen, 'picycle').includes('nicht ausgelöst'),
        zeile(zeilen, 'picycle'))

    // Fehlende Einzelwerte werden als Lücke benannt, nicht als 0
    const luecke = baueZeilen({
        lsoi: { symbol: 'BTCUSDT', jetzt: { longPct: 65, oiDelta24hPct: null, preisDelta24hPct: 0.86, deutung: 'shortDeckung' } },
    })
    check('fehlender Einzelwert wird n/a statt 0',
        zeile(luecke, 'lsoi').includes('Open Interest 24 h n/a'), zeile(luecke, 'lsoi'))
}

console.log('\nMarktbreite')
{
    const muenze = (symbol, w24h) => ({ symbol, w24h })
    const zeilen = baueZeilen({
        markt: {
            muenzen: [
                muenze('BTC', 0.9), muenze('ETH', 1.0), muenze('SOL', 0.2),
                muenze('ADA', -1.9), muenze('CC', -2.7), muenze('XXX', null),
            ],
        },
    })
    const t = zeile(zeilen, 'markt')
    check('nur Coins MIT Wert zählen in den Nenner', t.includes('3 von 5 in 24 h im Plus'), t)
    check('stärkster Coin steht vorn', t.includes('vorn ETH +1.0 %'), t)
    check('schwächster Coin steht hinten', t.includes('hinten CC -2.7 %'), t)
}

console.log('\nAntwort der KI absichern')
{
    const gut = normalisiereAntwort({
        stimmung: 'angespannt',
        ueberschrift: 'Hebel steigt, Preis kommt nicht mit',
        text: 'Ein Satz.',
        punkte: [{ titel: 'Funding teuer', text: 'Longs zahlen.', ton: 'schlecht' }],
        widerspruch: 'Dominanz steigt, Altseason auch.',
        achten: ['Funding unter 0'],
    })
    check('gültige Antwort kommt unverändert durch',
        gut.stimmung === 'angespannt' && gut.punkte.length === 1 && gut.punkte[0].ton === 'schlecht')

    const erfunden = normalisiereAntwort({ stimmung: 'bullisch', ueberschrift: 'x', text: 'y' })
    check('erfundene Stimmung fällt auf gemischt zurück', erfunden.stimmung === 'gemischt', erfunden.stimmung)
    check('alle erlaubten Stimmungen überleben',
        STIMMUNGEN.every(s => normalisiereAntwort({ stimmung: s, text: 'x' }).stimmung === s))

    const viel = normalisiereAntwort({
        text: 'x',
        punkte: Array.from({ length: 12 }, (_, i) => ({ titel: `P${i}`, text: 't', ton: 'gut' })),
        achten: ['a', 'b', 'c', 'd', 'e'],
    })
    check('höchstens fünf Punkte', viel.punkte.length === 5, `${viel.punkte.length}`)
    check('höchstens drei Beobachtungspunkte', viel.achten.length === 3, `${viel.achten.length}`)

    const schief = normalisiereAntwort({
        text: 'x',
        punkte: [{ titel: 'A', ton: 'katastrophal' }, { titel: '', text: '' }, null],
        achten: ['  ', 'echt'],
    })
    check('unbekannter Ton wird neutral', schief.punkte[0].ton === 'neutral')
    check('leere Punkte fallen weg', schief.punkte.length === 1, `${schief.punkte.length}`)
    check('leere Beobachtungspunkte fallen weg',
        schief.achten.length === 1 && schief.achten[0] === 'echt')
    check('fehlender Widerspruch ist leerer Text, nicht undefined', schief.widerspruch === '')

    check('ohne Überschrift UND ohne Text gibt es nichts',
        normalisiereAntwort({ stimmung: 'ruhig', punkte: [] }) === null)
    check('kein Objekt ergibt null',
        normalisiereAntwort(null) === null && normalisiereAntwort('text') === null)
}


console.log('\nWiderspruch — die Karte darf sich nicht selbst aufsagen')
{
    /*
     * Der echte Fall vom 06.09.2026. Der `text` trug die Spannung bereits
     * („verharrt jedoch"), der `widerspruch` sagte dieselben vier Zahlen in
     * anderer Reihenfolge noch einmal — und verdoppelte damit jede Zahl auf
     * der Seite und in jeder Mail.
     */
    const text = 'Der Markt zeigt mit 47 von 50 Werten im Plus und einem Fear-&-Greed-Index von 73 '
        + 'deutliche Risikobereitschaft bei Altcoins. Bitcoin selbst verharrt jedoch bei einem '
        + '24-Stunden-Plus von lediglich 0,1 % und verzeichnet rückläufiges Open Interest (-0,9 %).'
    const echt = 'Während der Fear & Greed Index mit 73 deutliche Gier signalisiert und 47 von 50 '
        + 'Werten steigen, bewegt sich Bitcoin mit +0,1 % auf 24 Stunden kaum von der Stelle und '
        + 'verliert parallel an Open Interest (-0,9 %).'
    check('die Wiederholung vom 06.09.2026 fällt weg', entdoppleWiderspruch(text, echt) === '',
        entdoppleWiderspruch(text, echt))

    /*
     * DIE GEGENPROBEN SIND HIER DIE WICHTIGERE HÄLFTE. Ein Durchgang, der zu
     * viel schluckt, nimmt der Karte die einzige Stelle, an der sie auf eine
     * Spannung hinweist — und das merkt niemand, denn was fehlt, sieht man
     * nicht.
     */
    check('eine NEUE Zahl rettet den Satz',
        entdoppleWiderspruch(text, 'Die ETF-Zuflüsse von 340 Mio USD stehen dem gegenüber.').length > 0)
    check('das Minus ist keine Schreibweise, sondern eine andere Aussage',
        entdoppleWiderspruch(text, 'Das Open Interest legte um 0,9 % zu und stützt die Bewegung.').length > 0)
    check('ein Satz ganz ohne Zahlen bleibt',
        entdoppleWiderspruch(text, 'Die Marktbreite trägt die Bewegung nicht.').length > 0)
    check('ohne Text bleibt der Widerspruch unangetastet',
        entdoppleWiderspruch('', echt) === echt)
    check('leerer Widerspruch bleibt leer',
        entdoppleWiderspruch(text, '') === '' && entdoppleWiderspruch(text, null) === '')

    /*
     * Das FÜHRENDE PLUS ist reine Schreibweise. Genau daran scheiterte der
     * erste Anlauf: „+0,1 %" gegen „0,1 %" galt als neue Messung und rettete
     * den Satz, obwohl vier von fünf Zahlen identisch waren.
     */
    /*
     * Hier ist ALLES gleich ausser dem Pluszeichen — so und nur so misst der
     * Fall das Vorzeichen und nicht nebenbei die Wortregel. Der erste Anlauf
     * prüfte es mit zwei unterschiedlich formulierten Sätzen und schlug fehl,
     * obwohl der Code stimmte: Dort trennten die WÖRTER die beiden, und der
     * Satz blieb völlig zu Recht stehen.
     */
    const satz = (v) => `Bitcoin bewegt sich mit ${v} auf 24 Stunden kaum von der Stelle.`
    check('+0,1 % und 0,1 % sind dieselbe Messung',
        entdoppleWiderspruch(satz('0,1 %'), satz('+0,1 %')) === '',
        entdoppleWiderspruch(satz('0,1 %'), satz('+0,1 %')))
    check('-0,1 % ist es NICHT',
        entdoppleWiderspruch(satz('0,1 %'), satz('-0,1 %')).length > 0)

    // Und der Weg durch die Normalisierung, nicht nur die Funktion allein.
    const n = normalisiereAntwort({ stimmung: 'gemischt', ueberschrift: 'Lage', text, widerspruch: echt })
    check('normalisiereAntwort wendet den Abgleich an', n.widerspruch === '', n.widerspruch)
    check('der Text selbst bleibt unangetastet', n.text === text)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log('Fehlgeschlagen:')
    for (const f of fehler) console.log(`  - ${f}`)

    process.exit(1)
}
