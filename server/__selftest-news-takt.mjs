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
import { sollBerichtLaufen, tagesbeginn, istOhneInhalt } from './marktradar-news.js'

let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) return
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

console.log(fehler === 0 ? '  ✓ alle Prüfungen bestanden' : `  ${fehler} Fehler`)
process.exit(fehler === 0 ? 0 : 1)
