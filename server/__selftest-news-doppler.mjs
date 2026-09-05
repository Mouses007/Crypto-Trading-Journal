/**
 * Selbsttest: Doppelungen im Lagebericht.
 *
 * Zwei Richtungen sind gleich wichtig. Ein Durchgang, der nichts findet, ist
 * nutzlos — einer, der zu viel frisst, ist gefährlich: Er löscht Aussagen, die
 * nur zufällig dieselbe Zahl tragen, und niemand merkt es, weil der fehlende
 * Satz nirgends auffällt. Deshalb steht hier zu jeder Fangprobe eine
 * Gegenprobe.
 */
import {
    entdoppleBericht, zahlenAus, woerterAus, saetzeAus, istWiederholung, einordnungTexte,
} from './news-doppler.js'

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

console.log('\nNackte Zahl gegen Zahl mit Einheit')
{
    const m = (t) => ({ text: t, zahlen: zahlenAus(t), woerter: woerterAus(t) })

    // FANGPROBE: dieselbe Messung, einmal unbestimmt, einmal mit Einheit.
    const a = m('Der Fear & Greed Index von 73 zeigt ausgeprägte Gier im Markt.')
    const b = m('Der Fear & Greed Index notiert mit 73 Punkten und zeigt Gier.')
    check('„73" und „73 Punkte" sind dieselbe Zahl', !!istWiederholung(b, [a]))

    // GEGENPROBE: gleiche Ziffern, VERSCHIEDENE Einheiten — bleiben getrennt.
    // Das ist der Fall, für den die Einheit überhaupt an der Marke hängt.
    const c = m('Die BTC-Dominanz im Kryptomarkt liegt bei 58,2 Prozent.')
    const d = m('Die Zuflüsse im Kryptomarkt summierten sich auf 58,2 Mrd. USD.')
    check('GEGENPROBE Prozent und Milliarden bleiben getrennt', !istWiederholung(d, [c]),
        'gleiche Ziffernfolge, zwei verschiedene Messungen')
}

console.log('\nEinordnungskarten als Vergleichsbasis')
{
    // Der reale Fall vom 05.09.2026: Die Gesamtlage-Karte sagt es, die
    // Kapitel-Lage sagt es noch einmal.
    const einordnung = ['Der Markt zeigt mit einem Fear & Greed Index von 73 eine ausgeprägte Gier.']

    const a = entdoppleBericht({
        lage: 'Makrodaten bremsen die Rallye.',
        kapitel: [{
            thema: 'crypto',
            lage: 'Der gemessene Fear & Greed Index notiert mit 73 Punkten im Gier-Bereich.'
                + ' Die ETF-Zuflüsse liefen den dritten Tag in Folge.',
            punkte: [{ titel: 'ETF', text: 'BlackRock sammelte 117 Mio. USD ein.' }],
        }],
    }, { einordnung })
    check('Kapitel-Lage verliert den Satz, den die Einordnung schon sagt',
        !a.bericht.kapitel[0].lage.includes('73 Punkten'), a.bericht.kapitel[0].lage)
    check('der eigene Satz der Kapitel-Lage bleibt',
        a.bericht.kapitel[0].lage.includes('ETF-Zuflüsse'), a.bericht.kapitel[0].lage)

    // GEGENPROBE: dieselbe Zahl, andere Aussage — muss stehen bleiben.
    const b = entdoppleBericht({
        lage: 'Makrodaten bremsen die Rallye.',
        kapitel: [{
            thema: 'crypto',
            lage: 'Beim Emittenten flossen 73 Mio. USD in den Fonds zurück.',
            punkte: [],
        }],
    }, { einordnung })
    check('GEGENPROBE gleiche Zahl, andere Aussage bleibt stehen',
        b.bericht.kapitel[0].lage.includes('73 Mio'), b.bericht.kapitel[0].lage)

    // Kapitel-Lage NUR aus Wiederholung: der Ankersatz darf sie nicht retten.
    const c = entdoppleBericht({
        lage: 'Makrodaten bremsen die Rallye.',
        kapitel: [{ thema: 'crypto', lage: einordnung[0], punkte: [] }],
    }, { einordnung })
    check('Kapitel-Lage ganz aus fremdem Block wird LEER',
        c.bericht.kapitel[0].lage === '', JSON.stringify(c.bericht.kapitel[0].lage))
    check('das Leeren steht im Protokoll',
        c.protokoll.some(p => p.art === 'absatz'), JSON.stringify(c.protokoll))

    // GEGENPROBE: Wiederholung der GESAMTLAGE (nicht fremd) behält den Anker —
    // sonst begänne der Absatz mitten im Gedanken.
    const d = entdoppleBericht({
        lage: 'Die ETF-Zuflüsse summierten sich auf 951 Mio. USD.',
        kapitel: [{
            thema: 'crypto',
            lage: 'Die ETF-Zuflüsse summierten sich auf 951 Mio. USD.',
            punkte: [],
        }],
    })
    check('GEGENPROBE Wiederholung der eigenen Gesamtlage behält den Ankersatz',
        d.bericht.kapitel[0].lage.includes('951'), JSON.stringify(d.bericht.kapitel[0].lage))

    // Die Gesamtlage selbst behält ihren Anker auch gegen die Einordnung:
    // oben auf der Seite und in jeder Mail darf kein Loch stehen.
    const e = entdoppleBericht({ lage: einordnung[0], kapitel: [] }, { einordnung })
    check('Gesamtlage behält ihren Ankersatz auch gegen die Einordnung',
        e.bericht.lage.includes('73'), JSON.stringify(e.bericht.lage))
}

console.log('\nMarktdaten-Tabelle gegen die Kapitel-Lage')
{
    const markt = [{ was: 'Fear & Greed', wert: '73 (Gier)', zusatz: '30-Tage-Mittel 53' }]
    const satz = 'Der Fear & Greed Index liegt bei 73 und damit im Bereich Gier.'

    const a = entdoppleBericht({
        lage: 'Ruhige Lage.',
        kapitel: [{ thema: 'crypto', lage: `${satz} Die Zuflüsse hielten an.`, punkte: [] }],
    }, { markt })
    check('Kapitel-Lage verliert den Satz, der nur die Tabelle nacherzählt',
        !a.bericht.kapitel[0].lage.includes('73'), a.bericht.kapitel[0].lage)

    // GEGENPROBE 1: In einer MELDUNG ist der Messwert Beleg, nicht Wiederholung.
    const b = entdoppleBericht({
        lage: 'Ruhige Lage.',
        kapitel: [{ thema: 'crypto', lage: 'Die Zuflüsse hielten an.', punkte: [{ titel: 'Stimmung', text: satz }] }],
    }, { markt })
    check('GEGENPROBE Meldung darf die Tabellenzahl nennen',
        b.bericht.kapitel[0].punkte.length === 1, JSON.stringify(b.bericht.kapitel[0].punkte))

    // GEGENPROBE 2: Die Gesamtlage ist bei abgeschalteter Einordnung der
    // einzige erlaubte Deutungsort — die Tabelle darf sie nicht leerräumen.
    const c = entdoppleBericht({ lage: satz, kapitel: [] }, { markt })
    check('GEGENPROBE Gesamtlage darf die Tabellenzahl deuten',
        c.bericht.lage.includes('73'), c.bericht.lage)
}

console.log('\neinordnungTexte')
{
    check('leere Eingaben ergeben eine leere Liste',
        einordnungTexte(null).length === 0 && einordnungTexte({}).length === 0
        && einordnungTexte(undefined).length === 0)
    const t = einordnungTexte({
        gesamt: { text: 'Gier trifft auf Long-Auflösung.', widerspruch: 'Sentiment gegen Fluss.' },
        handel: {
            text: 'Enge Spanne.', spielraum: '12 % der Tagesspanne', zeitfenster: 'CME zu',
            bedingungen: [{ wenn: 'über 79683', dann: 'Test des Vortageshochs' }, { wenn: 'x' }],
        },
    })
    check('alle Teile kommen mit', t.length === 6, JSON.stringify(t))
    check('unvollständige Bedingung fällt weg', !t.some(x => x === 'Wenn x, dann undefined.'))
    check('Bedingung wird zu einem Satz', t.some(x => x.startsWith('Wenn über 79683, dann')))
}

console.log('\nRückwärtskompatibilität')
{
    // Der zweiargumentige Aufruf ohne `einordnung` muss sich verhalten wie
    // bisher — die ganze Datei ruft so auf, das darf nicht kippen.
    const ohne = entdoppleBericht({
        lage: 'Erster Satz. Zweiter Satz.',
        kapitel: [{ thema: 'crypto', lage: 'Eigener Text.', punkte: [] }],
    })
    check('ohne Einordnung bleibt alles stehen',
        ohne.bericht.lage.includes('Erster') && ohne.bericht.kapitel[0].lage === 'Eigener Text.',
        JSON.stringify(ohne.bericht))
    check('ohne Einordnung ist das Protokoll leer', ohne.protokoll.length === 0,
        JSON.stringify(ohne.protokoll))
}

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
