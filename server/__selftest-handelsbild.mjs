/**
 * Selbsttest des Handelsbilds (KI-Kachel „Handelslage").
 *
 *   node server/__selftest-handelsbild.mjs
 *
 * Drei Dinge müssen hier stimmen, weil sie im Betrieb still danebengehen und
 * die Einordnung trotzdem plausibel klingt:
 *
 *   1. Die TAGESGRENZE. Die Tagesspanne wird gegen UTC-Mitternacht gerechnet —
 *      dieselbe Grenze, die Binance für Tageskerzen zieht. Eine Verschiebung um
 *      die lokale Zeitzone zöge Kerzen des Vortags in die heutige Spanne, und
 *      der „Bewegungsvorrat" wäre systematisch zu klein. Nichts daran sähe nach
 *      Fehler aus.
 *   2. Der BEWEGUNGSVORRAT. Er ist der Grund für diese Kachel: heutige Spanne
 *      gegen den MEDIAN der letzten Tage. Mit dem Mittelwert hebt ein einzelner
 *      Absturztag den Massstab so weit an, dass danach jeder normale Tag als
 *      ruhig gilt — der Test deckt genau diesen Fall ab.
 *   3. Die POSITION in der Spanne. 0 ist das Tagestief, 100 das Tageshoch.
 *      Vertauscht liest sich ein Markt am Tief wie einer am Hoch, und die halbe
 *      Einordnung dreht sich um.
 *
 * Dazu die Absicherung der Antwort: erfundene Lagen, halbe Bedingungen oder
 * zwölf Punkte dürfen die Kachel nicht sprengen.
 */

import { rechneTagesbild, baueHandelsZeilen, normalisiereHandelslage, tagesBeginn, LAGEN } from './handelsbild.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const zeile = (zeilen, id) => zeilen.find(z => z.id === id)?.text || ''
const alle = (zeilen, id) => zeilen.filter(z => z.id === id).map(z => z.text).join(' | ')
const nahe = (a, b, tol = 0.01) => Number.isFinite(a) && Math.abs(a - b) <= tol

/** Kerzenreihe bauen: `t` als Öffnungszeit, gleichmässiger Takt. */
function reihe(startMs, taktMs, saetze) {
    return saetze.map((s, i) => ({
        t: startMs + i * taktMs,
        o: s[0], h: s[1], l: s[2], c: s[3], v: s[4] ?? 100,
    }))
}

// Ein fester Zeitpunkt, damit nichts von der Uhr abhängt: 12:00 UTC.
const JETZT = Date.UTC(2026, 8, 3, 12, 0, 0)
const MITTERNACHT = Date.UTC(2026, 8, 3, 0, 0, 0)

console.log('\nTagesgrenze')
{
    // Zwei Kerzen VOR Mitternacht mit extremen Werten, zwei danach mit zahmen.
    // Nur die zahmen dürfen in die Tagesspanne eingehen.
    const k5m = [
        ...reihe(MITTERNACHT - 10 * 60000, 5 * 60000, [
            [100, 200, 50, 150],   // Riesenspanne, gestern
            [150, 190, 60, 100],
        ]),
        ...reihe(MITTERNACHT, 5 * 60000, [
            [100, 104, 99, 103],
            [103, 106, 102, 105],
        ]),
    ]
    const b = rechneTagesbild({ k5m, jetzt: JETZT })
    check('Tagesbeginn ist UTC-Mitternacht', tagesBeginn(JETZT) === MITTERNACHT)
    check('Tageshoch stammt nur aus dem laufenden Tag', b.tag.hoch === 106, `war ${b.tag?.hoch}`)
    check('Tagestief stammt nur aus dem laufenden Tag', b.tag.tief === 99, `war ${b.tag?.tief}`)
    check('Tagesöffnung ist die erste Kerze nach Mitternacht', b.tag.offen === 100)
    check('Spanne in Prozent der Öffnung', nahe(b.tag.spannePct, 7), `war ${b.tag?.spannePct}`)

    // Kerze genau AUF Mitternacht gehört zum neuen Tag (>=, nicht >)
    const grenz = rechneTagesbild({ k5m: reihe(MITTERNACHT, 5 * 60000, [[10, 12, 9, 11]]), jetzt: JETZT })
    check('Kerze exakt auf der Grenze zählt zum neuen Tag', grenz.tag?.hoch === 12)
}

console.log('\nPosition in der Tagesspanne')
{
    const amTief = rechneTagesbild({
        k5m: reihe(MITTERNACHT, 5 * 60000, [[100, 110, 90, 100], [100, 105, 90, 90]]),
        jetzt: JETZT,
    })
    check('Preis am Tagestief ergibt 0 %', nahe(amTief.tag.positionPct, 0), `war ${amTief.tag?.positionPct}`)

    const amHoch = rechneTagesbild({
        k5m: reihe(MITTERNACHT, 5 * 60000, [[100, 110, 90, 100], [100, 110, 95, 110]]),
        jetzt: JETZT,
    })
    check('Preis am Tageshoch ergibt 100 %', nahe(amHoch.tag.positionPct, 100), `war ${amHoch.tag?.positionPct}`)

    // Ein Markt, der seit Mitternacht exakt steht: die Frage ist sinnlos,
    // nicht „50". Sonst behauptete die Zeile eine Mitte, die es nicht gibt.
    const steht = rechneTagesbild({
        k5m: reihe(MITTERNACHT, 5 * 60000, [[100, 100, 100, 100]]),
        jetzt: JETZT,
    })
    check('ohne Spanne gibt es keine Position', steht.tag.positionPct === null)
}

console.log('\nBewegungsvorrat')
{
    // Neun ruhige Tage (2 % Spanne) und ein Absturztag (40 %). Der MEDIAN ist
    // 2 %, der Mittelwert wäre 5,8 % — bei heute 2 % hiesse das 100 % gegen
    // 34 %, also „Pensum erfüllt" gegen „viel Luft". Genau darum Median.
    const kTag = [
        ...Array.from({ length: 9 }, (_, i) => ({ t: i, o: 100, h: 101, l: 99, c: 100, v: 1 })),
        { t: 9, o: 100, h: 120, l: 80, c: 100, v: 1 },
        { t: 10, o: 100, h: 101, l: 99, c: 100, v: 1 },
    ]
    const b = rechneTagesbild({
        k5m: reihe(MITTERNACHT, 5 * 60000, [[100, 101, 99, 100]]),
        kTag,
        jetzt: JETZT,
    })
    check('übliche Spanne ist der Median, nicht der Mittelwert',
        nahe(b.ueblich.spannePct, 2), `war ${b.ueblich?.spannePct}`)
    check('genutzter Anteil bezieht sich auf den Median',
        nahe(b.ueblich.genutztPct, 100, 0.5), `war ${b.ueblich?.genutztPct}`)
    check('gezählte Tage werden mitgeliefert', b.ueblich.tage === 10, `war ${b.ueblich?.tage}`)

    // Halbe Tagesspanne gelaufen → rund 50 %
    const halb = rechneTagesbild({
        k5m: reihe(MITTERNACHT, 5 * 60000, [[100, 100.5, 99.5, 100]]),
        kTag,
        jetzt: JETZT,
    })
    check('halbe übliche Spanne ergibt rund 50 %',
        nahe(halb.ueblich.genutztPct, 50, 0.5), `war ${halb.ueblich?.genutztPct}`)

    // Die letzte Tageskerze ist der Vortag — nicht der heutige Tag
    check('Vortagsmarken kommen aus der letzten Tageskerze',
        b.vortag.hoch === 101 && b.vortag.tief === 99 && b.vortag.schluss === 100)
    check('Abstand zum Vortagshoch ist vorzeichenbehaftet',
        nahe(b.vortag.abstandHochPct, ((100 - 101) / 101) * 100, 0.001),
        `war ${b.vortag?.abstandHochPct}`)
}

console.log('\nVWAP und Beteiligung')
{
    // Zwei Kerzen, die zweite mit dem neunfachen Volumen: der VWAP muss nahe
    // am zweiten Niveau liegen. Ein ungewichteter Mittelwert läge bei 150.
    const b = rechneTagesbild({
        k5m: [
            { t: MITTERNACHT, o: 100, h: 100, l: 100, c: 100, v: 10 },
            { t: MITTERNACHT + 300000, o: 200, h: 200, l: 200, c: 200, v: 90 },
        ],
        jetzt: JETZT,
    })
    check('VWAP ist volumengewichtet, nicht gemittelt',
        nahe(b.vwap.wert, 190), `war ${b.vwap?.wert}`)
    check('Abstand zum VWAP ist vorzeichenbehaftet (Preis darüber)',
        nahe(b.vwap.abstandPct, ((200 - 190) / 190) * 100, 0.001), `war ${b.vwap?.abstandPct}`)

    // Ohne Volumen kein VWAP — statt einer erfundenen Marke lieber keine
    const ohneVol = rechneTagesbild({
        k5m: [{ t: MITTERNACHT, o: 100, h: 100, l: 100, c: 100, v: 0 }],
        jetzt: JETZT,
    })
    check('ohne Volumen gibt es keinen VWAP', ohneVol.vwap === null)
}

console.log('\nLeere und lückenhafte Eingaben')
{
    const leer = rechneTagesbild({})
    check('ohne Kerzen bleibt alles null', leer.preis === null && leer.tag === null && leer.ueblich === null)

    // Nur 5m-Kerzen: Tagesbild ja, Stundenkennzahlen nein — und zwar als null,
    // nicht als 0. Eine ATR von 0 hiesse „steht völlig still".
    const nur5m = rechneTagesbild({ k5m: reihe(MITTERNACHT, 300000, [[100, 101, 99, 100]]), jetzt: JETZT })
    check('ohne Stundenkerzen ist ATR null, nicht 0', nur5m.atrPct === null)
    check('ohne Stundenkerzen ist RVOL null, nicht 0', nur5m.rvol === null)
    check('ohne Tageskerzen gibt es keinen Bewegungsvorrat', nur5m.ueblich === null)
}

console.log('\nZeilen: Zeit und Termine setzen den Rahmen')
{
    const jetzt = JETZT
    const zeilen = baueHandelsZeilen({
        symbol: 'BTCUSDT',
        zeit: {
            jetzt,
            phase: { id: 'usKassa' },
            ueberlappung: true,
            terminmarktOffen: true,
            feiertag: false,
            naechste: [{ id: 'kassaZu', inMs: 95 * 60000 }],
            warnungen: [{ id: 'fomc', stufe: 'hoch', bisMs: jetzt + 30 * 60000 }],
        },
        termine: {
            stunden: 8,
            gesamtImZeitraum: 3,
            ereignisse: [
                { title: 'CPI', country: 'USD', impact: 'high', inMs: 45 * 60000, vorbei: false },
                { title: 'Alt', country: 'USD', impact: 'low', inMs: -60000, vorbei: true },
            ],
        },
    })
    check('Zeit steht vor allem anderen', zeilen[0].id === 'zeit')
    /*
     * Klartext statt roher Id. Vor der KI steht keine i18n-Schicht, und
     * `usKassa`/`cmePause` sind für sie beliebige Bezeichner — im ersten
     * Probelauf war das der grösste vermeidbare Verlust in der Grundlage.
     */
    check('laufende Sitzung steht im Klartext, nicht als Id',
        zeile(zeilen, 'zeit').includes('US-Kassahandel') && !zeile(zeilen, 'zeit').includes('usKassa'),
        zeile(zeilen, 'zeit'))
    check('auch die nächste Marke steht im Klartext',
        zeile(zeilen, 'zeit').includes('Schluss US-Kassahandel'))
    check('unbekannte Id fällt roh durch, statt zu verschwinden',
        baueHandelsZeilen({ zeit: { jetzt, naechste: [{ id: 'neuesFenster', inMs: 60000 }] } })
            .find(z => z.id === 'zeit').text.includes('neuesFenster'))
    check('Überlappung wird ausdrücklich erwähnt', alle(zeilen, 'zeit').includes('überlappen'))
    check('Countdown steht in Stunden und Minuten', alle(zeilen, 'zeit').includes('1 h 35 min'))
    check('Warnfenster kommt mit Stufe und Klartext',
        alle(zeilen, 'zeit').includes('Stufe hoch') && alle(zeilen, 'zeit').includes('FOMC-Fenster'))
    check('nur offene Termine werden gelistet',
        zeile(zeilen, 'termine').includes('CPI') && !zeile(zeilen, 'termine').includes('Alt'))
    check('Terminabstand in Minuten', zeile(zeilen, 'termine').includes('45 min'))
}

console.log('\nZeilen: „nichts los" ist nicht „alles gefiltert"')
{
    const gefiltert = baueHandelsZeilen({
        symbol: 'BTCUSDT',
        termine: { stunden: 8, gesamtImZeitraum: 5, ereignisse: [] },
    })
    check('herausgefilterte Termine werden als solche benannt',
        zeile(gefiltert, 'termine').includes('herausgefiltert')
        && zeile(gefiltert, 'termine').includes('5'))

    const leer = baueHandelsZeilen({
        symbol: 'BTCUSDT',
        termine: { stunden: 8, gesamtImZeitraum: 0, ereignisse: [] },
    })
    check('wirklich leerer Kalender sagt „keine"',
        zeile(leer, 'termine').includes('keine') && !zeile(leer, 'termine').includes('herausgefiltert'))
}

console.log('\nZeilen: Einheiten des Fundings')
{
    /*
     * Dieselbe Falle wie in `lagebild.js`, deshalb hier derselbe Test: die
     * Funding-Kachel liefert die Jahresrate als DEZIMALBRUCH, die Mechanik-
     * Kachel dieselbe Grösse bereits in PROZENT. Wer eine davon falsch
     * umrechnet, legt der KI eine Zahl vor, die um Faktor 100 danebenliegt.
     */
    const zeilen = baueHandelsZeilen({
        symbol: 'BTCUSDT',
        funding: {
            oben: [{ symbol: 'BTCUSDT', jahresRate: 0.073, rate: 0.0000833, intervallStunden: 1 }],
            unten: [{ symbol: 'ENAUSDT', jahresRate: -0.198 }],
            eigene: [{ symbol: 'BTCUSDT', jahresRate: 0.073, bitunix: { jahresRate: 0.069 } }],
        },
        mechanik1h: {
            symbol: 'BTCUSDT', fenster: '1h', state: 'longAufbau',
            faktoren: { preisDeltaPct: 1.2, oiDeltaPct: 0.8, fundingJahresRate: 7.3, liqVerfuegbar: false },
        },
    })
    check('Funding-Kachel: Dezimalbruch wird zu 7,3 %',
        zeile(zeilen, 'funding').includes('+7.3 % p.a.'), zeile(zeilen, 'funding'))
    check('Mechanik-Kachel: Prozent bleibt Prozent',
        zeile(zeilen, 'mechanik1h').includes('+7.3 % p.a.'), zeile(zeilen, 'mechanik1h'))
    check('eigene Zeile nennt Bitunix daneben',
        alle(zeilen, 'funding').includes('Bitunix +6.9 % p.a.'))
    check('der Deckel je Takt wird erklärt',
        alle(zeilen, 'funding').includes('gedeckelt'))
}

console.log('\nZeilen: Richtung der Liquidationen')
{
    // „Longs liquidiert" und „Shorts liquidiert" bedeuten das Gegenteil
    // voneinander. Eine Vertauschung dreht die halbe Einordnung um.
    const zeilen = baueHandelsZeilen({
        symbol: 'BTCUSDT',
        liqJetzt: { minuten: 30, symbol: 'BTCUSDT', longUsd: 5_000_000, shortUsd: 1_200_000, anzahl: 42, groesstes: 900_000 },
    })
    const t = zeile(zeilen, 'liqJetzt')
    check('Longs mit ihrem Betrag', t.includes('Longs 5.0 Mio USD'), t)
    check('Shorts mit ihrem Betrag', t.includes('Shorts 1.2 Mio USD'), t)
    check('die Drossel wird angeschrieben', t.includes('Stichprobe'))

    const keine = baueHandelsZeilen({ symbol: 'BTCUSDT', liqJetzt: { minuten: 30, anzahl: 0, longUsd: 0, shortUsd: 0 } })
    check('keine Liquidationen ist eine eigene Aussage',
        zeile(keine, 'liqJetzt').includes('keine aufgezeichnet'))
}

console.log('\nZeilen: der Bewegungsvorrat wird erklärt, nicht nur beziffert')
{
    const zeilen = baueHandelsZeilen({
        symbol: 'BTCUSDT',
        tagesbild: {
            preis: 43210,
            tag: { hoch: 43500, tief: 42800, offen: 43000, spannePct: 1.63, positionPct: 58.6, seitOffenPct: 0.49, stundenGelaufen: 12 },
            ueblich: { spannePct: 1.4, tage: 10, genutztPct: 116 },
            vortag: { hoch: 43800, tief: 42500, schluss: 43000, abstandHochPct: -1.3, abstandTiefPct: 1.7, abstandSchlussPct: 0.5 },
            vwap: { wert: 43100, abstandPct: 0.26 },
            atrPct: 0.45, rvol: 1.8,
            trend: { ema20: 43150, ema50: 42900, ueberEma20: true, emaLage: 'auf', adx: 28, richtung: 'auf' },
            bewegung: { h1: 0.2, h4: 0.9, h24: 1.4 },
        },
    })
    const vorrat = alle(zeilen, 'tagesbild')
    check('der genutzte Anteil steht als Zahl da', vorrat.includes('116 %'), vorrat)
    check('über 100 % wird ausdrücklich eingeordnet', vorrat.includes('Tagespensum bereits abgearbeitet'))
    check('es wird als Spielraum-, nicht als Richtungsaussage gekennzeichnet',
        vorrat.includes('keine Richtungsaussage'))
    check('Position in der Spanne wird erklärt (0 = Tief, 100 = Hoch)',
        vorrat.includes('0 = Tagestief'))
    check('Vortagsmarken kommen mit Abstand', vorrat.includes('Hoch 43800') && vorrat.includes('-1.30 %'))
    check('VWAP sagt darüber oder darunter', vorrat.includes('darüber'))
    check('ADX bekommt seine Schwellen mitgeliefert', vorrat.includes('unter 20 richtungslos'))
    check('wie weit der Tag ist, steht dabei', vorrat.includes('12.0 h gelaufen'))
}

console.log('\nZeilen: die Sitzung nennt nur, was da ist')
{
    const voll = baueHandelsZeilen({
        symbol: 'BTCUSDT',
        sitzung: { dauerMs: 75 * 60000, maxTrades: 3, maxVerlust: 120, vorhaben: 'nur Ausbrüche' },
    })
    const t = zeile(voll, 'sitzung')
    check('Dauer, Deckel und Vorhaben stehen drin',
        t.includes('1 h 15 min') && t.includes('3') && t.includes('120 USD') && t.includes('nur Ausbrüche'), t)

    const duenn = baueHandelsZeilen({ symbol: 'BTCUSDT', sitzung: { dauerMs: 5 * 60000 } })
    check('ohne Plan keine erfundenen Nullen',
        !zeile(duenn, 'sitzung').includes('null') && !zeile(duenn, 'sitzung').includes('0 USD'),
        zeile(duenn, 'sitzung'))
}

console.log('\nAntwort absichern')
{
    const gut = normalisiereHandelslage({
        lage: 'trend_auf',
        ueberschrift: 'Klarer Aufwärtsschub bei hoher Beteiligung',
        text: 'Drei Sätze.',
        spielraum: 'Noch etwa ein Drittel.',
        zeitfenster: 'US-Kasse öffnet in einer Stunde.',
        punkte: [{ titel: 'Beteiligung', text: 'RVOL 1,8×', ton: 'gut' }],
        bedingungen: [
            { wenn: 'OI weiter über +0,8 %', dann: 'die Bewegung ist getragen' },
            { wenn: 'nur ein wenn', dann: '' },
            { dann: 'nur ein dann' },
        ],
        hinfaellig: ['unter 42800', ''],
        widerspruch: 'Funding gegen Preis.',
    })
    check('gültige Lage bleibt stehen', gut.lage === 'trend_auf')
    check('halbe Bedingungen fallen raus', gut.bedingungen.length === 1, JSON.stringify(gut.bedingungen))
    check('leere Marken fallen raus', gut.hinfaellig.length === 1)

    const schief = normalisiereHandelslage({
        lage: 'mondphase',
        ueberschrift: 'x',
        punkte: Array.from({ length: 12 }, (_, i) => ({ titel: `p${i}`, text: 't', ton: 'super' })),
        bedingungen: Array.from({ length: 9 }, () => ({ wenn: 'a', dann: 'b' })),
        hinfaellig: ['a', 'b', 'c', 'd', 'e'],
    })
    check('erfundene Lage fällt auf unklar zurück', schief.lage === 'unklar')
    check('alle erlaubten Lagen sind bekannt', LAGEN.includes('quetsche') && LAGEN.length === 6)
    check('höchstens fünf Punkte', schief.punkte.length === 5)
    check('erfundener Ton wird neutral', schief.punkte.every(p => p.ton === 'neutral'))
    check('höchstens vier Bedingungen', schief.bedingungen.length === 4)
    check('höchstens drei Marken', schief.hinfaellig.length === 3)
    check('fehlende Textfelder sind leere Zeichenketten, nicht undefined',
        schief.widerspruch === '' && schief.spielraum === '' && schief.zeitfenster === '')

    check('ohne Überschrift UND ohne Text gibt es nichts',
        normalisiereHandelslage({ lage: 'spanne', punkte: [] }) === null)
    check('kein Objekt ergibt null',
        normalisiereHandelslage(null) === null && normalisiereHandelslage('text') === null)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) {
    console.log('Fehlgeschlagen:')
    for (const f of fehler) console.log(`  - ${f}`)
    process.exit(1)
}
