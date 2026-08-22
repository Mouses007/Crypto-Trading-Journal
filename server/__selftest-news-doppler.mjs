/**
 * Selbsttest: Doppelungen im Lagebericht.
 *
 * Zwei Richtungen sind gleich wichtig. Ein Durchgang, der nichts findet, ist
 * nutzlos — einer, der zu viel frisst, ist gefährlich: Er löscht Aussagen, die
 * nur zufällig dieselbe Zahl tragen, und niemand merkt es, weil der fehlende
 * Satz nirgends auffällt. Deshalb steht hier zu jeder Fangprobe eine
 * Gegenprobe.
 */
import { entdoppleBericht, zahlenAus, woerterAus, saetzeAus, istWiederholung } from './news-doppler.js'

let ok = 0, fehler = 0
const check = (name, bedingung, zusatz = '') => {
    if (bedingung) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? `\n      ${zusatz}` : ''}`) }
}

console.log('\nZahlen erkennen')
{
    const z = (t) => [...zahlenAus(t)]
    check('Prozent in beiden Schreibweisen ist dieselbe Marke',
        z('58,2 %')[0] === z('58.2 Prozent')[0], `${z('58,2 %')} / ${z('58.2 Prozent')}`)
    check('Tausenderpunkt zählt nicht als Komma', z('1.234 Mrd')[0] === '1234mrd', z('1.234 Mrd'))
    check('nackte Zahl bleibt erhalten', z('bei 63 gestanden').includes('63'), z('bei 63'))
    check('Jahreszahl ohne Einheit ist kein Messwert', !z('im Jahr 2026').length, z('im Jahr 2026'))
    check('Jahreszahl MIT Einheit bleibt', z('2026 USD').length === 1, z('2026 USD'))
    check('Vorzeichen gehört zur Marke', z('-29.000 BTC')[0] === '-29000', z('-29.000 BTC'))
}

console.log('\nSätze trennen')
{
    check('Abkürzung beendet keinen Satz',
        saetzeAus('Es flossen 1,2 Mrd. USD ab. Danach war Ruhe.').length === 2)
    check('Währung am Satzende beendet ihn sehr wohl',
        saetzeAus('Das kostet 1.000 USD. Danach war Ruhe.').length === 2)
    check('Zahl mit Punkt trennt nicht',
        saetzeAus('Der Kurs lag bei 1.234,50 USD und hielt.').length === 1)
}

console.log('\nWiederholung erkennen — Fangprobe')
{
    const a = { zahlen: zahlenAus('Der Fear-&-Greed-Index steht bei 63.'), woerter: woerterAus('Der Fear-&-Greed-Index steht bei 63.') }
    const b = { zahlen: zahlenAus('Fear & Greed liegt mit 63 im Gier-Bereich.'), woerter: woerterAus('Fear & Greed liegt mit 63 im Gier-Bereich.') }
    check('gleiche Zahl + gleiche Wörter = Doppelung', !!istWiederholung(b, [a]))
}

console.log('\nWiederholung erkennen — Gegenprobe')
{
    const a = { zahlen: zahlenAus('Die BTC-Dominanz liegt bei 58,2 %.'), woerter: woerterAus('Die BTC-Dominanz liegt bei 58,2 %.') }
    const b = { zahlen: zahlenAus('58,2 % der Konten halten Long-Positionen.'), woerter: woerterAus('58,2 % der Konten halten Long-Positionen.') }
    check('gleiche Zahl, andere Aussage bleibt stehen', !istWiederholung(b, [a]),
        'Dominanz und Kontenquote dürfen dieselbe Zahl tragen')

    const c = { zahlen: zahlenAus('Bitcoin fiel um 3 %.'), woerter: woerterAus('Bitcoin fiel um 3 %.') }
    const d = { zahlen: zahlenAus('Ether stieg um 7 %.'), woerter: woerterAus('Ether stieg um 7 %.') }
    check('andere Zahl, ähnliche Wörter bleibt stehen', !istWiederholung(d, [c]))
}

console.log('\nZeit ist kein Messwert')
{
    const a = marke => marke
    const s1 = 'Die 222 Mio. USD Short-Liquidationen binnen einer Stunde waren nur ein Ausschnitt der 24 Stunden.'
    const s2 = 'Auf 24 Stunden gerechnet summieren sich die Liquidationen auf 2,975 Mrd. USD.'
    const m1 = { zahlen: zahlenAus(s1), woerter: woerterAus(s1) }
    const m2 = { zahlen: zahlenAus(s2), woerter: woerterAus(s2) }
    check('„24 Stunden" verbindet zwei verschiedene Aussagen nicht', !istWiederholung(m2, [m1]),
        `${[...m1.zahlen]} / ${[...m2.zahlen]}`)
    check('Datum ist kein Messwert', !zahlenAus('am 19. August').size, [...zahlenAus('am 19. August')])
    check('Indikator-Periode hinter dem Wort ist kein Messwert',
        !zahlenAus('die abgestuften EMAs 20/50/100/200').size, [...zahlenAus('die abgestuften EMAs 20/50/100/200')])
    check('Indikator-Periode vor dem Wort ebenso',
        [...zahlenAus('der 20-Tage-EMA bei 1.872,69 USD')].join() === '1872.69usd',
        [...zahlenAus('der 20-Tage-EMA bei 1.872,69 USD')])
    check('Bio. bleibt ein Wert', zahlenAus('2,61 Bio. USD').has('2.61bio'), [...zahlenAus('2,61 Bio. USD')])
    check('Bio. beendet keinen Satz', saetzeAus('Der Markt steht bei 2,61 Bio. USD und hält.').length === 1)
}

console.log('\nGanzer Bericht')
{
    const { bericht, protokoll } = entdoppleBericht({
        lage: 'Der Fear-&-Greed-Index steht bei 63 und zeigt Gier. Die Lage bleibt angespannt.',
        lagebild: {
            dafuer: [
                { art: 'fakt', text: 'Der Fear-&-Greed-Index steht bei 63, die Stimmung ist gierig.' },
                { art: 'einschaetzung', text: 'Ein Fear-&-Greed-Index von 63 zeigt eine gierige Stimmung.' },
            ],
            dagegen: [{ art: 'einschaetzung', text: 'Die ETF-Abflüsse halten an.' }],
            // Die Frage zur Zahl aus „dafuer" — sie ist der Sinn der Spalte
            offen: [{ art: 'einschaetzung', text: 'Ob der Fear-&-Greed-Index von 63 sich hält oder kippt.' }],
        },
        kapitel: [{
            thema: 'crypto',
            lage: 'Der Markt handelt fest. Fear & Greed liegt bei 63 und damit im Gier-Bereich.',
            punkte: [
                {
                    titel: 'Stimmung', text: 'Die Stimmung ist gierig. Der Fear-&-Greed-Index steht bei 63.',
                    kennzahlen: [{ wert: '63', was: 'Fear & Greed' }, { wert: '-29.000 BTC', was: 'Apparent Demand' }],
                },
                {
                    titel: 'Stimmung', text: 'Noch einmal dasselbe.',
                    kennzahlen: [],
                },
            ],
        }],
    }, {
        markt: [{ was: 'Fear & Greed', wert: '63 (Gier)', zusatz: '30-Tage-Mittel 55' }],
    })

    const k = bericht.kapitel[0]
    check('Gesamtlage behält ihre erste Nennung', bericht.lage.includes('63'), bericht.lage)
    // Die Waage darf sagen, was im Text steht — sie wägt es ab. Doppelt ist
    // nur, was zweimal IN DER WAAGE steht.
    check('Abwägung behält ihren Eintrag trotz gleicher Zahl im Text',
        bericht.lagebild.dafuer.length === 1, JSON.stringify(bericht.lagebild.dafuer))
    check('zweiter Waage-Eintrag mit derselben Aussage fliegt',
        !bericht.lagebild.dafuer.some(e => e.art === 'einschaetzung'), JSON.stringify(bericht.lagebild.dafuer))
    check('andere Abwägungszeile bleibt', bericht.lagebild.dagegen.length === 1)
    check('„offen" darf nach einer Zahl aus „dafuer" fragen',
        bericht.lagebild.offen.length === 1, JSON.stringify(bericht.lagebild.offen))
    check('Kapitel-Lage verliert den doppelten Satz', !k.lage.includes('63'), k.lage)
    check('Kapitel-Lage behält ihren eigenen Satz', k.lage.includes('handelt fest'), k.lage)
    check('Meldung mit gleichem Titel fliegt', k.punkte.length === 1, JSON.stringify(k.punkte.map(p => p.titel)))
    check('Chip, der nur die Marktdaten-Tabelle wiederholt, fliegt',
        !k.punkte[0].kennzahlen.some(z => z.wert === '63'), JSON.stringify(k.punkte[0].kennzahlen))
    check('eigener Chip bleibt',
        k.punkte[0].kennzahlen.some(z => z.was === 'Apparent Demand'), JSON.stringify(k.punkte[0].kennzahlen))
    check('flache Liste folgt den Kapiteln', bericht.punkte.length === 1)
    check('Protokoll nennt, was fehlt', protokoll.length >= 3, JSON.stringify(protokoll))
}

console.log('\nGrenzfälle')
{
    const leer = entdoppleBericht(null)
    check('kein Bericht ergibt kein Ergebnis, aber keinen Absturz',
        leer.bericht.lage === '' && leer.bericht.punkte.length === 0)

    const einSatz = entdoppleBericht({
        lage: 'Der Fear-&-Greed-Index steht bei 63.',
        kapitel: [{ thema: 'crypto', lage: 'Der Fear-&-Greed-Index steht bei 63.', punkte: [] }],
    })
    check('ein einzelner Satz wird nie zu einem leeren Absatz',
        einSatz.bericht.kapitel[0].lage.trim().length > 0, einSatz.bericht.kapitel[0].lage)

    const update = entdoppleBericht({
        kapitel: [{
            thema: 'crypto', lage: '',
            punkte: [
                { titel: 'Alt', text: 'Die ETF-Abflüsse summieren sich auf 1,2 Mrd USD.' },
                { titel: 'Neu', text: 'Die Notenbank entscheidet am Mittwoch über den Leitzins.' },
            ],
        }],
    }, { vorherige: ['Die ETF-Abflüsse summieren sich auf 1,2 Mrd USD.'] })
    check('Zwischenmeldung wiederholt den Tagesbericht nicht',
        update.bericht.punkte.length === 1 && update.bericht.punkte[0].titel === 'Neu',
        JSON.stringify(update.bericht.punkte.map(p => p.titel)))
}

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
