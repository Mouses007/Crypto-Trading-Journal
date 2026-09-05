/**
 * Selbsttest: Zeitplan des Lageberichts.
 *
 * Läuft ohne Netz und ohne Datenbank. Anlass war ein ausgefallener Tagesbericht:
 * Der Takt traf nur die EXAKTE Stunde, und der Anspruch wurde vor der Arbeit
 * gestempelt und bei Fehlschlag nie zurückgegeben — zusammen ergab das einen
 * ganzen Tag ohne Bericht, ohne jede Meldung.
 *
 * Geprüft wird die reine Entscheidungslogik: Wann ist der Bericht dran, und wo
 * liegt der Tagesbeginn in der Zeitzone des Journals.
 *
 * Aufruf: node server/__selftest-news-takt.mjs
 */
import {
    sollBerichtLaufen, tagesbeginn, istOhneInhalt,
    anspruchsNachlauf, BERICHT_SCHLUESSEL, BERICHT_MANUELL, UPDATE_SCHLUESSEL,
    leseRhythmus, leseUpdateStunden, faelligerUpdatePlatz, basisTaugtFuerUpdate,
    kompaktVorbericht, berichtAlsMailText, berichtsKette, aufbewahrungMs,
    waehleBeitraege, abdeckungText, aktualitaetFuer, leseChartFrische, CHART_FRISCHE,
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

console.log('Zeitplan des Lageberichts')

/** Ortszeit-Datum bauen (Monat 1-basiert, wie man es liest). */
const zeit = (jahr, monat, tag, stunde, minute = 0) => new Date(jahr, monat - 1, tag, stunde, minute)

// ── 1) Täglich: Stunde erreicht oder überschritten ───────────────────────
// 17.08.2026 ist ein Montag.
pruefe('vor der Stunde: nein',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 17, 11, 59), stunde: 12 }) === false)
pruefe('zur vollen Stunde: ja',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 17, 12, 0), stunde: 12 }) === true)
pruefe('innerhalb der Stunde: ja',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 17, 12, 50), stunde: 12 }) === true)
// Der Kern des Fehlers: ein Neustart um 14:00 hat den Slot früher verschluckt.
pruefe('zwei Stunden später wird nachgeholt',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 17, 14, 5), stunde: 12 }) === true)
pruefe('spät abends noch immer nachholbar',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 17, 23, 59), stunde: 12 }) === true)
pruefe('Mitternacht als Einstellung läuft immer',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 17, 0, 1), stunde: 0 }) === true)

// ── 2) Wöchentlich: nur am eingestellten Wochentag ───────────────────────
// 1 = Montag … 7 = Sonntag
pruefe('Montag bei Einstellung Montag: ja',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 17, 12, 0), stunde: 12, rhythmus: 'woechentlich', wochentag: 1 }) === true)
pruefe('Dienstag bei Einstellung Montag: nein',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 18, 12, 0), stunde: 12, rhythmus: 'woechentlich', wochentag: 1 }) === false)
pruefe('Sonntag ist 7, nicht 0',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 23, 12, 0), stunde: 12, rhythmus: 'woechentlich', wochentag: 7 }) === true)
pruefe('richtiger Wochentag, aber zu früh: nein',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 17, 9, 0), stunde: 12, rhythmus: 'woechentlich', wochentag: 1 }) === false)

// ── 3) Unsinnige Eingaben kippen nicht durch ─────────────────────────────
pruefe('Stunde über 23 wird geklemmt',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 17, 23, 30), stunde: 99 }) === true)
pruefe('Wochentag ausserhalb 1-7 wird geklemmt',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 17, 12, 0), stunde: 12, rhythmus: 'woechentlich', wochentag: 0 }) === true)

// ── 4) Tagesbeginn ───────────────────────────────────────────────────────
const jetzt = Date.now()
const tb = tagesbeginn(jetzt, 'Europe/Zurich')
pruefe('Tagesbeginn liegt in der Vergangenheit', tb <= jetzt)
pruefe('Tagesbeginn ist höchstens 24 h her', jetzt - tb < 25 * 3600000)
pruefe('Tagesbeginn ohne Zeitzone funktioniert auch', tagesbeginn(jetzt) <= jetzt)
// Zwei Zeitzonen mit unterschiedlichem Datum müssen unterschiedliche Grenzen liefern
const tbZuerich = tagesbeginn(Date.UTC(2026, 7, 17, 1, 30), 'Europe/Zurich')   // 03:30 Ortszeit
const tbTokio = tagesbeginn(Date.UTC(2026, 7, 17, 1, 30), 'Asia/Tokyo')        // 10:30 Ortszeit
pruefe('Tokio ist zu diesem Zeitpunkt weiter im Tag', tbTokio < tbZuerich,
    `Zürich ${new Date(tbZuerich).toISOString()} / Tokio ${new Date(tbTokio).toISOString()}`)

// Ein Zeitpunkt kurz nach Mitternacht Ortszeit: Grenze muss dicht davor liegen.
// Tokio liegt neun Stunden vor UTC — 15:10 UTC ist dort 00:10 des Folgetags.
const kurzNachMitternacht = Date.UTC(2026, 7, 17, 15, 10)
const tbKnapp = tagesbeginn(kurzNachMitternacht, 'Asia/Tokyo')
pruefe('kurz nach Mitternacht liegt die Grenze ~10 min zurück',
    kurzNachMitternacht - tbKnapp === 10 * 60000,
    String(kurzNachMitternacht - tbKnapp))

// ── 5) Leermeldung der Videoanalyse ──────────────────────────────────────
// Seit die Zusammenfassung als Stichpunktliste angefordert wird, antwortet das
// Modell formtreu mit „- OHNE INHALT". Ein `startsWith` griff da nicht mehr,
// und der Sentinel landete als echte Zusammenfassung in der Datenbank.
for (const t of ['OHNE INHALT', '- OHNE INHALT', '  -   ohne inhalt', '• Ohne Inhalt',
    '– OHNE INHALT, nichts Marktrelevantes', '*OHNE INHALT*']) {
    pruefe(`„${t}" gilt als leer`, istOhneInhalt(t) === true)
}
for (const t of ['- Bitcoin faellt unter 60k', 'Ohne Zweifel ein starker Bericht',
    '- Ohne klare Richtung, aber hohes Volumen', '', null]) {
    pruefe(`„${t}" gilt als Inhalt`, istOhneInhalt(t) === false)
}

// ── 5) Was ein beendeter Lauf am Anspruch hinterlässt ────────────────────
// Kern: der Bericht von Hand darf den Mittagslauf nicht abwürgen. Vorher
// stempelte JEDER gelungene Lauf den Tages-Schlüssel — ein Bericht um 06:18
// von Hand liess den 12-Uhr-Lauf still ausfallen (gesehen am 19.08.2026).
{
    const auto = anspruchsNachlauf({ manuell: false })
    pruefe('automatisch + gelungen → Tag erledigt', auto.stempeln === BERICHT_SCHLUESSEL, JSON.stringify(auto))
    pruefe('automatisch + gelungen → nichts freigeben', auto.freigeben === null)

    const hand = anspruchsNachlauf({ manuell: true })
    pruefe('von Hand + gelungen → Tages-Schlüssel bleibt unberührt', hand.stempeln === null, JSON.stringify(hand))
    pruefe('von Hand + gelungen → kein Fehlervermerk', hand.fehlerAn === null)

    const autoLeer = anspruchsNachlauf({ manuell: false, ohneInhalt: true })
    pruefe('nichts zu berichten → Tag bleibt offen', autoLeer.freigeben === BERICHT_SCHLUESSEL && autoLeer.stempeln === null)

    const handLeer = anspruchsNachlauf({ manuell: true, ohneInhalt: true })
    pruefe('nichts zu berichten von Hand → nur die Knopfbremse zurück',
        handLeer.freigeben === BERICHT_MANUELL && handLeer.stempeln === null)

    const autoFehler = anspruchsNachlauf({ manuell: false, geworfen: true })
    pruefe('Fehler automatisch → Vermerk am Tages-Schlüssel', autoFehler.fehlerAn === BERICHT_SCHLUESSEL)

    const handFehler = anspruchsNachlauf({ manuell: true, geworfen: true })
    pruefe('Fehler von Hand → Vermerk NICHT am Tages-Schlüssel', handFehler.fehlerAn === BERICHT_MANUELL,
        'sonst erlaubt ein gescheiterter Handlauf einen Lauf zu viel')
    pruefe('Fehler → weder stempeln noch freigeben',
        handFehler.stempeln === null && handFehler.freigeben === null && autoFehler.stempeln === null)

    pruefe('die beiden Schlüssel sind verschieden', BERICHT_SCHLUESSEL !== BERICHT_MANUELL)

    // Aktualisierungen tragen ihren Fehler am EIGENEN Platz — sonst schaltete
    // ein gescheiterter Nachtrag am Tages-Schlüssel eine Wiederholung des
    // Berichts frei, die niemand angefordert hat.
    const up2 = anspruchsNachlauf({ manuell: false, autoSchluessel: UPDATE_SCHLUESSEL(2) })
    pruefe('Aktualisierung gelungen → eigener Platz gestempelt', up2.stempeln === UPDATE_SCHLUESSEL(2))
    const up2Fehler = anspruchsNachlauf({ manuell: false, geworfen: true, autoSchluessel: UPDATE_SCHLUESSEL(2) })
    pruefe('Aktualisierung gescheitert → Vermerk am eigenen Platz',
        up2Fehler.fehlerAn === UPDATE_SCHLUESSEL(2) && up2Fehler.fehlerAn !== BERICHT_SCHLUESSEL)
    pruefe('die beiden Plätze sind verschieden', UPDATE_SCHLUESSEL(1) !== UPDATE_SCHLUESSEL(2))
    pruefe('unsinnige Platznummern werden geklemmt',
        UPDATE_SCHLUESSEL(0) === UPDATE_SCHLUESSEL(1) && UPDATE_SCHLUESSEL(9) === UPDATE_SCHLUESSEL(2))
}

// ── 6) „nur manuell": der Takt erzeugt nichts ────────────────────────────
console.log('\nRhythmus „nur manuell"')
pruefe('manuell erzeugt nie automatisch',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 17, 12, 0), stunde: 12, rhythmus: 'manuell' }) === false)
pruefe('manuell auch spät abends nicht',
    sollBerichtLaufen({ jetztLokal: zeit(2026, 8, 17, 23, 59), stunde: 0, rhythmus: 'manuell' }) === false)
pruefe('unbekannter Rhythmus gilt als täglich', leseRhythmus('quartalsweise') === 'taeglich')
pruefe('leer gilt als täglich', leseRhythmus('') === 'taeglich' && leseRhythmus(null) === 'taeglich')
pruefe('die drei gültigen Werte bleiben stehen',
    leseRhythmus('taeglich') === 'taeglich' && leseRhythmus('woechentlich') === 'woechentlich'
    && leseRhythmus('manuell') === 'manuell')

// ── 7) Aktualisierungen: Stunden lesen und Platz bestimmen ───────────────
console.log('\nAktualisierungen')
pruefe('keine Aktualisierung → leere Liste', leseUpdateStunden('18,21', 0).length === 0)
pruefe('eine Aktualisierung → nur die erste Stunde',
    JSON.stringify(leseUpdateStunden('18,21', 1)) === '[18]')
pruefe('zwei Aktualisierungen → beide Stunden',
    JSON.stringify(leseUpdateStunden('18,21', 2)) === '[18,21]')
// Sortiert, weil die Position die Platznummer IST: „21,18" darf nicht dazu
// führen, dass der Abendlauf den Tages-Anspruch des Nachmittags verbraucht.
pruefe('verdrehte Eingabe wird sortiert',
    JSON.stringify(leseUpdateStunden('21,18', 2)) === '[18,21]')
pruefe('Dubletten fallen weg', JSON.stringify(leseUpdateStunden('18,18', 2)) === '[18]')
pruefe('mehr als zwei werden gekürzt',
    JSON.stringify(leseUpdateStunden('9,15,18,21', 5)) === '[9,15]')
pruefe('Unsinn wird geklemmt statt durchgereicht',
    JSON.stringify(leseUpdateStunden('99,-3', 2)) === '[0,23]')
pruefe('Leeres ergibt keine Stunde', leseUpdateStunden('', 2).length === 0)

const stunden = [18, 21]
pruefe('vor der ersten Stunde: kein Platz',
    faelligerUpdatePlatz({ jetztLokal: zeit(2026, 8, 17, 17, 55), stunden }) === 0)
pruefe('ab 18:00 der erste Platz',
    faelligerUpdatePlatz({ jetztLokal: zeit(2026, 8, 17, 18, 0), stunden }) === 1)
pruefe('um 20:30 immer noch der erste',
    faelligerUpdatePlatz({ jetztLokal: zeit(2026, 8, 17, 20, 30), stunden }) === 1)
// Der ausgelassene Platz wird NICHT nachgeholt: sonst liefen um 21:30 zwei
// bezahlte Nachträge im Abstand einer Minute.
pruefe('ab 21:00 der zweite — der erste wird nicht nachgeholt',
    faelligerUpdatePlatz({ jetztLokal: zeit(2026, 8, 17, 21, 30), stunden }) === 2)
pruefe('ohne eingestellte Stunden: nie',
    faelligerUpdatePlatz({ jetztLokal: zeit(2026, 8, 17, 23, 0), stunden: [] }) === 0)

// ── 8) Grundlage der Aktualisierung ──────────────────────────────────────
const jetztFest = Date.UTC(2026, 7, 17, 20, 0)
const stunde = 3600000
pruefe('Bericht von heute Mittag taugt',
    basisTaugtFuerUpdate({ basisAm: jetztFest - 8 * stunde, jetzt: jetztFest }) === true)
pruefe('Bericht von vorgestern taugt nicht',
    basisTaugtFuerUpdate({ basisAm: jetztFest - 50 * stunde, jetzt: jetztFest }) === false)
pruefe('beim Wochenbericht zählt die Woche',
    basisTaugtFuerUpdate({ basisAm: jetztFest - 50 * stunde, jetzt: jetztFest, rhythmus: 'woechentlich' }) === true)
pruefe('älter als eine Woche taugt auch wöchentlich nicht',
    basisTaugtFuerUpdate({ basisAm: jetztFest - 200 * stunde, jetzt: jetztFest, rhythmus: 'woechentlich' }) === false)
pruefe('ohne Grundlage: nein', basisTaugtFuerUpdate({ basisAm: 0, jetzt: jetztFest }) === false)
pruefe('Grundlage aus der Zukunft: nein',
    basisTaugtFuerUpdate({ basisAm: jetztFest + stunde, jetzt: jetztFest }) === false)

// ── 9) „Bereits berichtet" für die Zwischenmeldung ───────────────────────
// Zwei Zwecke: Das Modell soll nicht wiederholen, was heute Morgen schon
// dastand — und wenn es etwas korrigiert, soll es auf dessen Quelle zeigen
// können. Gespeichert sind aufgelöste Beleg-Objekte, das Modell sieht nur
// Nummern; ohne Rückübersetzung wäre jede Korrektur unbelegt.
{
    const basis = {
        erstelltAm: Date.UTC(2026, 7, 17, 10, 0),
        ueberschrift: 'Ruhiger Vormittag',
        lage: 'Wenig Bewegung.',
        kapitel: JSON.stringify([{
            thema: 'crypto', ueberschrift: 'Krypto', lage: 'Seitwärts.',
            punkte: [{
                titel: 'ETF-Abflüsse', text: 'Dritter Tag in Folge.',
                belege: [{ url: 'https://b.example/2' }, { url: 'https://b.example/1' }],
            }],
        }]),
        beitraegeListe: JSON.stringify([
            { url: 'https://b.example/1', titel: 'eins' },
            { url: 'https://b.example/2', titel: 'zwei' },
        ]),
        punkte: '[]',
    }
    const text = kompaktVorbericht(basis, 10)
    pruefe('Überschrift und Lage stehen drin',
        text.includes('Ruhiger Vormittag') && text.includes('Wenig Bewegung.'))
    pruefe('der Block sagt selbst, dass er nicht wiederholt werden soll',
        text.includes('nicht wiederholen'))
    pruefe('Kapitel und Punkt stehen drin', text.includes('ETF-Abflüsse'))
    // Beleg 2 der alten Liste + Versatz 10 = 12, Beleg 1 = 11 — in der
    // Reihenfolge, in der der Punkt sie führt.
    pruefe('Belege sind auf die neue Nummernreihe umgeschrieben',
        text.includes('[Belege: 12, 11]'), text)
    pruefe('leere Grundlage ergibt leeren Text', kompaktVorbericht(null) === '')
    pruefe('kaputtes JSON wirft nicht',
        typeof kompaktVorbericht({ erstelltAm: 1, kapitel: '{kaputt', punkte: 'x', beitraegeListe: '' }) === 'string')
}

// ── 10) Der Bericht als Mailtext ─────────────────────────────────────────
// Zwei Fassungen aus denselben Daten. Die kurze ist die Vorgabe: eine Mail,
// die man nicht angefordert hat, soll nicht zwanzig Absätze lang sein.
console.log('\nBericht als Mailtext')
{
    const daten = {
        lage: 'Ruhige Lage.',
        markt: [
            { was: 'Fear & Greed', wert: '62 (greed)', zusatz: '30-Tage-Mittel 30.9' },
            { was: 'Funding-Extreme (8h)', wert: 'oben BTW 0.033 %', zusatz: '' },
        ],
        kapitel: [{
            thema: 'crypto', ueberschrift: 'HYPE zieht an', lage: 'Dünne Nachrichtenlage.',
            punkte: [{
                titel: 'HYPE steigt auf 72 Dollar', text: 'Zwei Sätze dazu.',
                wichtigkeit: 'hoch', korrektur: true,
                kennzahlen: [{ wert: '72 USD', was: 'HYPE-Kurs' }],
                belege: [{ quelle: 'Cointelegraph', url: 'https://example.com/hype' }],
            }],
        }],
        grundlage: 'Grundlage: 12 Beiträge.',
        themenNamen: { crypto: 'Krypto' },
    }

    const kurz = berichtAlsMailText({ ...daten, inhalt: 'kurz' })
    pruefe('kurz: Lage und Grundlage, sonst nichts',
        kurz === 'Ruhige Lage.\n\nGrundlage: 12 Beiträge.', JSON.stringify(kurz))
    pruefe('kurz enthält keine Meldung', !kurz.includes('HYPE'))

    const mittel = berichtAlsMailText({ ...daten, inhalt: 'mittel' })
    pruefe('mittel: Kapitelüberschrift mit Themennamen', mittel.includes('## Krypto — HYPE zieht an'))
    pruefe('mittel: Marktstand als eigener Abschnitt', mittel.includes('## Marktstand'))
    pruefe('mittel: Kapitel-Lage steht drin', mittel.includes('Dünne Nachrichtenlage.'))
    pruefe('mittel enthält KEINE einzelne Meldung', !mittel.includes('### 1. HYPE steigt auf 72 Dollar'))

    const voll = berichtAlsMailText({ ...daten, inhalt: 'voll' })
    pruefe('voll: Kapitelüberschrift mit Themennamen', voll.includes('## Krypto — HYPE zieht an'))
    pruefe('voll: Marktstand als eigener Abschnitt', voll.includes('## Marktstand'))
    pruefe('voll: Meldung nummeriert und als Zwischentitel', voll.includes('### 1. HYPE steigt auf 72 Dollar'))
    pruefe('voll: Marken stehen am Titel', voll.includes('[wichtig, korrigiert]'))
    pruefe('voll: Kennzahl und Beleg im selben Block',
        voll.includes('HYPE-Kurs: 72 USD\nCointelegraph: https://example.com/hype'))
    pruefe('voll: Grundlage steht am Schluss', voll.trimEnd().endsWith('Grundlage: 12 Beiträge.'))

    // Ein Doppelpunkt IM Label würde die Zeile spalten und die Tabelle in der
    // Mail zerreissen — deshalb wird er ersetzt, nicht durchgereicht.
    const heikel = berichtAlsMailText({
        ...daten, inhalt: 'voll',
        markt: [{ was: 'Funding: 8h', wert: '0,01 %' }, { was: 'Dominanz', wert: '58 %' }],
    })
    pruefe('Doppelpunkt im Label wird entschärft',
        heikel.includes('Funding 8h: 0,01 %') && !heikel.includes('Funding: 8h: '))

    // Ein einzelner Marktwert ergibt keine Tabelle — dann lieber weglassen.
    const einzeln = berichtAlsMailText({ ...daten, inhalt: 'voll', markt: [{ was: 'Dominanz', wert: '58 %' }] })
    pruefe('einzelner Marktwert bekommt keinen Abschnitt', !einzeln.includes('## Marktstand'))

    pruefe('leere Eingabe wirft nicht', berichtAlsMailText() === '')
    pruefe('kaputte Kapitel werfen nicht',
        typeof berichtAlsMailText({ lage: 'x', kapitel: [null, { punkte: 'kaputt' }], inhalt: 'voll' }) === 'string')

    /*
     * Die eigene Markteinordnung in der Mail. Bis zum 05.09.2026 war dieser
     * Zweig von keiner Prüfung berührt — fünfzig Zeilen mit vier Verzweigungen
     * in einer Funktion, die ausdrücklich rein gehalten wird, „damit der
     * Selbsttest sie prüfen kann".
     */
    const lagen = {
        gesamt: {
            ueberschrift: 'Gier trifft auf Long-Auflösung',
            text: 'Der Markt zeigt Gier.', widerspruch: 'Sentiment gegen Fluss.',
        },
        handel: {
            symbol: 'BTCUSDT', ueberschrift: 'Enge Wochenend-Spanne',
            text: 'Kaum Dynamik.', spielraum: '12 % der Tagesspanne', zeitfenster: 'CME geschlossen',
            bedingungen: [{ wenn: 'über 79683', dann: 'Test des Vortageshochs' }],
            hinfaellig: ['Bruch des Tagestiefs'],
        },
    }
    const mitLagen = berichtAlsMailText({ ...daten, lagen, inhalt: 'mittel' })
    pruefe('Einordnung bekommt einen eigenen Abschnitt', mitLagen.includes('## Eigene Einordnung'))
    pruefe('beide Blickwinkel als Zwischentitel',
        mitLagen.includes('### Gier trifft auf Long-Auflösung')
        && mitLagen.includes('### BTC: Enge Wochenend-Spanne'), mitLagen)
    pruefe('Bedingung steht als Wenn-Dann-Zeile',
        mitLagen.includes('- Wenn über 79683, dann Test des Vortageshochs'), mitLagen)
    pruefe('Hinfällig-Marke kommt mit', mitLagen.includes('Hinfällig, sobald: Bruch des Tagestiefs'))
    // Die Mail geht ungefragt raus, und auf die Überschrift folgt unmittelbar
    // ein Wenn-Dann-Satz. Ohne die Kennzeichnung liest sich das wie eine
    // Empfehlung — in der Web-Ansicht steht sie unter den Karten, hier fehlte sie.
    pruefe('Warnhinweis steht in der Mail',
        mitLagen.includes('keine Handelsempfehlung'), mitLagen)

    // GEGENPROBE: ohne Einordnung (radarNewsLagenAn = 0) kein leerer Abschnitt.
    pruefe('GEGENPROBE ohne Einordnung fehlt der Abschnitt',
        !berichtAlsMailText({ ...daten, inhalt: 'mittel' }).includes('## Eigene Einordnung'))
    // Randfall: Überschrift ohne Inhalt darf keine verwaiste Überschrift geben.
    pruefe('Karte ohne Inhalt erzeugt keinen leeren Zwischentitel',
        !berichtAlsMailText({ ...daten, inhalt: 'mittel', lagen: { gesamt: { ueberschrift: 'Nur Titel' } } })
            .includes('### Nur Titel'))
    pruefe('kaputte Einordnung wirft nicht',
        typeof berichtAlsMailText({ ...daten, inhalt: 'mittel', lagen: { handel: { ueberschrift: 'x', bedingungen: 'kaputt' } } }) === 'string')
    // Bei „kurz" bleibt die Mail kurz — auch mit Einordnung.
    pruefe('kurz zeigt keine Einordnung',
        !berichtAlsMailText({ ...daten, lagen, inhalt: 'kurz' }).includes('Eigene Einordnung'))

    /*
     * Fehlanzeige-Kapitel wird nicht gedruckt (Altbestand-Netz). Entscheidend
     * sind die PUNKTE, nicht die Lage: Am 04./05.09.2026 stand „chartanalyse"
     * mit einer vollen Lage („Keine technischen Chartanalysen verfügbar") und
     * null Punkten in der Mail — eine Überschrift plus ein Satz, der nichts sagt.
     */
    const mitLeerem = berichtAlsMailText({
        ...daten, inhalt: 'mittel',
        kapitel: [...daten.kapitel, {
            thema: 'chartanalyse', ueberschrift: 'Keine Chartanalysen verfügbar',
            lage: 'Zu den fünf grössten Coins liegen keine Analysen vor.', punkte: [],
        }],
    })
    pruefe('Fehlanzeige-Kapitel erzeugt keine Überschrift',
        !mitLeerem.includes('Keine Chartanalysen verfügbar'), mitLeerem)
    pruefe('GEGENPROBE das Kapitel mit Meldungen bleibt',
        mitLeerem.includes('HYPE zieht an'), mitLeerem)
    // GEGENPROBE: leere Lage, aber ein Punkt — das Kapitel trägt und bleibt.
    pruefe('GEGENPROBE Kapitel ohne Lage, aber mit Meldung bleibt',
        berichtAlsMailText({
            ...daten, inhalt: 'voll',
            kapitel: [{ thema: 'crypto', ueberschrift: 'Trägt doch', lage: '', punkte: [{ titel: 'X', text: 'Y' }] }],
        }).includes('Trägt doch'))
}

// ── 11) Die Kette des Tages ──────────────────────────────────────────────
// Tagesbericht und Zwischenmeldungen gehören zusammen: jüngste offen, ältere
// zugeklappt. Um Mitternacht wandert der Tag ins Archiv — aber die Seite bleibt
// nicht leer, sie zeigt den Vortag zugeklappt.
console.log('\nBerichtskette des Tages')
{
    const T = 24 * 3600000
    const heute0 = Date.UTC(2026, 7, 20, 0, 0)
    // Jüngste zuerst, wie die Abfrage sie liefert
    const zeilen = [
        { id: 12, erstelltAm: heute0 + 20 * 3600000, art: 'update', updateNr: 2, basisId: 10 },
        { id: 11, erstelltAm: heute0 + 15 * 3600000, art: 'update', updateNr: 1, basisId: 10 },
        { id: 10, erstelltAm: heute0 + 10 * 3600000, art: 'bericht', updateNr: 0, basisId: 0 },
        { id: 9, erstelltAm: heute0 - 14 * 3600000, art: 'bericht', updateNr: 0, basisId: 0 },
    ]
    const a = berichtsKette(zeilen, { tagesbeginn: heute0 })
    pruefe('nur die Berichte von heute', a.kette.length === 3 && !a.kette.some(z => z.id === 9))
    pruefe('älteste zuerst — die Seite liest sich von oben nach unten',
        a.kette.map(z => z.id).join(',') === '10,11,12')
    pruefe('heute ist nicht vom Vortag', a.vomVortag === false)

    // Nach Mitternacht: heute noch nichts, also die Kette von gestern —
    // vollständig, nicht nur die letzte Zeile.
    const b = berichtsKette(zeilen, { tagesbeginn: heute0 + T })
    pruefe('nach Mitternacht kommt die Kette von gestern', b.vomVortag === true)
    pruefe('die Kette von gestern hängt an ihrem Tagesbericht',
        b.kette.map(z => z.id).join(',') === '10,11,12')
    // Der Bericht von vorgestern gehört NICHT dazu: eigene Kette.
    pruefe('fremde Kette bleibt draussen', !b.kette.some(z => z.id === 9))

    const c = berichtsKette([zeilen[3]], { tagesbeginn: heute0 })
    pruefe('einzelner alter Bericht: Kette von einem', c.kette.length === 1 && c.vomVortag === true)
    pruefe('gar nichts da: leere Kette',
        berichtsKette([], { tagesbeginn: heute0 }).kette.length === 0)
    pruefe('Unsinn wirft nicht', berichtsKette(null).kette.length === 0)
}

// ── 12) Aufbewahrung der Berichte ────────────────────────────────────────
pruefe('manuell heisst: nichts löschen', aufbewahrungMs('manuell') === null)
pruefe('unbekannt heisst ebenfalls nichts löschen', aufbewahrungMs('irgendwas') === null && aufbewahrungMs('') === null)
pruefe('ein Tag', aufbewahrungMs('tag') === 24 * 3600000)
pruefe('eine Woche', aufbewahrungMs('woche') === 7 * 24 * 3600000)
pruefe('ein Monat', aufbewahrungMs('monat') === 30 * 24 * 3600000)

// ── 13) Auswahl der Beiträge: Deckel ja, heimliche Zeitgrenze nein ───────
// Gemessen am 20.08.2026: 326 Beiträge im 36-Stunden-Fenster, die 60 jüngsten
// reichten sechs Stunden zurück. Der Prompt versprach 36 Stunden.
console.log('\nAuswahl der Beiträge')
{
    const jetzt = Date.UTC(2026, 7, 20, 18, 0)
    const fenster = 36 * 3600000
    // 300 Beiträge, aber vier Fünftel davon in den letzten sechs Stunden —
    // genau die Verteilung, die der Deckel vorher zur Zeitgrenze machte.
    const zeilen = []
    for (let i = 0; i < 240; i++) zeilen.push({ id: `neu${i}`, publishedAt: jetzt - (i * 90000) })          // 0–6 h
    for (let i = 0; i < 60; i++) zeilen.push({ id: `alt${i}`, publishedAt: jetzt - 7 * 3600000 - i * 1800000 }) // 7–37 h
    zeilen.sort((a, b) => b.publishedAt - a.publishedAt)

    const alt = zeilen.slice(0, 60)
    pruefe('ohne Verteilung reicht die Auswahl nur sechs Stunden',
        (jetzt - alt[alt.length - 1].publishedAt) / 3600000 < 7)

    const neu = waehleBeitraege(zeilen, { limit: 60, fensterMs: fenster, jetzt })
    pruefe('der Deckel bleibt eingehalten', neu.length === 60, String(neu.length))
    pruefe('die Auswahl reicht jetzt über das halbe Fenster',
        (jetzt - neu[neu.length - 1].publishedAt) / 3600000 > 18,
        `${((jetzt - neu[neu.length - 1].publishedAt) / 3600000).toFixed(1)} h`)
    pruefe('die jüngsten sind trotzdem dabei', neu[0].id === zeilen[0].id)
    pruefe('nichts doppelt', new Set(neu.map(b => b.id)).size === neu.length)
    pruefe('Reihenfolge bleibt jüngste zuerst',
        neu.every((b, i) => i === 0 || b.publishedAt <= neu[i - 1].publishedAt))

    // Weniger Beiträge als der Deckel: nichts wegwerfen, nichts umsortieren.
    const wenig = zeilen.slice(0, 12)
    pruefe('unter dem Deckel bleibt alles', waehleBeitraege(wenig, { limit: 60, fensterMs: fenster, jetzt }).length === 12)
    // Kurzes Fenster (Zwischenmeldung): ein Korb, also schlicht die jüngsten.
    const kurz = waehleBeitraege(zeilen, { limit: 10, fensterMs: 2 * 3600000, jetzt })
    pruefe('kurzes Fenster nimmt die jüngsten', kurz.length === 10 && kurz[0].id === zeilen[0].id)
    pruefe('Unsinn wirft nicht', waehleBeitraege(null).length === 0)
}

// ── 14) Der Zeitraum im Prompt ist eine Behauptung — sie muss stimmen ────
{
    const jetzt = Date.UTC(2026, 7, 20, 18, 0)
    pruefe('sechs Stunden Grundlage heissen sechs Stunden',
        abdeckungText([{ publishedAt: jetzt - 6 * 3600000 }, { publishedAt: jetzt }], { jetzt })
        === 'der letzten 6 Stunden')
    pruefe('unter einer Stunde eigene Formulierung',
        abdeckungText([{ publishedAt: jetzt - 10 * 60000 }], { jetzt }) === 'der letzten Stunde')
    pruefe('mehr als zwei Tage werden zu Tagen',
        abdeckungText([{ publishedAt: jetzt - 5 * 24 * 3600000 }], { jetzt }) === 'der letzten 5 Tage')
    pruefe('ohne Zeitstempel keine Behauptung',
        abdeckungText([{ publishedAt: 0 }]) === '' && abdeckungText([]) === '')
}

// ── 15) Frische der Recherche ────────────────────────────────────────────
// Gemessen: ohne Filter kamen Fundstellen von 2019, 2020 und 2022 neben den
// heutigen — als gleichwertiger Beleg nummeriert.
console.log('\nFrische der Recherche')
pruefe('Tagesbericht sucht nur im Tag', aktualitaetFuer({ thema: 'crypto' }) === 'day')
pruefe('Zwischenmeldung ebenso', aktualitaetFuer({ thema: 'crypto', istUpdate: true }) === 'day')
pruefe('Wochenbericht sucht in der Woche',
    aktualitaetFuer({ thema: 'finanzen', rhythmus: 'woechentlich' }) === 'week')
// Chartanalysen erscheinen nicht täglich; ein Tagesfilter liesse das Kapitel
// an ruhigen Tagen leer ausgehen.
pruefe('Chartanalyse ohne Wahl: eine Woche', aktualitaetFuer({ thema: 'chartanalyse' }) === 'week')
pruefe('Chartanalyse auch in der Zwischenmeldung',
    aktualitaetFuer({ thema: 'chartanalyse', istUpdate: true }) === 'week')
// Wählbar: kurzfristig, mittelfristig, übergeordnet. Die Wahl steuert BEIDES —
// Alter der Fundstellen und Horizont der Frage.
pruefe('kurzfristig sucht im Tag',
    aktualitaetFuer({ thema: 'chartanalyse', chartFrische: 'tag' }) === 'day')
pruefe('übergeordnet sucht im Monat',
    aktualitaetFuer({ thema: 'chartanalyse', chartFrische: 'monat' }) === 'month')
pruefe('die Wahl gilt auch in der Zwischenmeldung',
    aktualitaetFuer({ thema: 'chartanalyse', istUpdate: true, chartFrische: 'tag' }) === 'day')
pruefe('Unsinn fällt auf die Wochensicht',
    aktualitaetFuer({ thema: 'chartanalyse', chartFrische: 'quartal' }) === 'week'
    && leseChartFrische('quartal') === 'woche' && leseChartFrische('') === 'woche')
pruefe('jede Stufe hat Filter und Horizont',
    Object.values(CHART_FRISCHE).every(x => x.filter && x.horizont))
// Nur die Chartanalyse ist wählbar — die Nachrichtenkapitel bleiben am Rhythmus.
pruefe('die Wahl greift nicht auf andere Kapitel über',
    aktualitaetFuer({ thema: 'crypto', chartFrische: 'monat' }) === 'day')
pruefe('nie ohne Filter — das war der Fehler',
    ['crypto', 'finanzen', 'tech', 'chartanalyse'].every(t => aktualitaetFuer({ thema: t })))

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
