/**
 * Selbsttest: Umfangsregler des Lageberichts.
 *
 * Token-Budget, Punkte je Kapitel und Videotiefe standen bis v3.7.1 fest im
 * Quelltext. Jetzt kommen sie aus den Einstellungen — und genau da lauert der
 * teure Fehler: Ein zu kleiner Deckel bricht die Antwort mitten im JSON ab und
 * wirft den ganzen Lauf weg, obwohl die Videoanalyse längst bezahlt ist. Ein
 * zu grosser Deckel auf der Videoseite kostet bei jedem Video Geld.
 *
 * Deshalb wird hier geprüft, was ohne Netz und ohne Datenbank prüfbar ist:
 * dass 0 weiterhin „wie bisher" bedeutet, dass Grenzen greifen, und dass der
 * Nachschlag immer über dem Erstversuch liegt.
 *
 * Aufruf: node server/__selftest-news-umfang.mjs
 */
import {
    budgetsAus, punkteVorgabe, videoTiefeAus, VIDEO_TIEFEN, bauLagePrompt,
    istLiveSeite, istEndgueltig,
} from './marktradar-news.js'

let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) return
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}
let anzahl = 0
const p = (name, bedingung, zusatz) => { anzahl++; pruefe(name, bedingung, zusatz) }

// ── Token-Budget ─────────────────────────────────────────────────────────
// 0 = Vorgabe der Länge. Das ist der Bestandsfall: Wer nie etwas einstellt,
// muss exakt dieselben Werte bekommen wie vor dem Umbau.
p('kurz ohne Eigenwert', String(budgetsAus('kurz', 0)) === '2500,5000')
p('mittel ohne Eigenwert', String(budgetsAus('mittel', 0)) === '5000,10000')
p('lang ohne Eigenwert', String(budgetsAus('lang', 0)) === '9000,18000')
p('unbekannte Länge fällt auf mittel', String(budgetsAus('quatsch', 0)) === '5000,10000')
p('leerer Wert wie 0', String(budgetsAus('mittel', '')) === '5000,10000')
p('null wie 0', String(budgetsAus('mittel', null)) === '5000,10000')
p('Unsinn wie 0', String(budgetsAus('mittel', 'abc')) === '5000,10000')

// Eigenwert schlägt die Länge, Nachschlag ist das Doppelte.
p('Eigenwert gilt', String(budgetsAus('kurz', 7000)) === '7000,14000')
p('Eigenwert als Text gilt', String(budgetsAus('mittel', '3000')) === '3000,6000')

// Grenzen: unter 1000 Token kommt kein vollständiges JSON zurück, über 60000
// zahlt man für einen Bericht, den niemand liest.
p('Untergrenze 1000', String(budgetsAus('mittel', 5)) === '1000,2000')
p('negativ wie 0', String(budgetsAus('mittel', -400)) === '5000,10000')
p('Obergrenze 60000', String(budgetsAus('mittel', 999999)) === '60000,120000')

// Der Nachschlag muss IMMER grösser sein — sonst wiederholt der zweite Anlauf
// denselben Abbruch und kostet nur ein zweites Mal.
for (const [l, b] of [['kurz', 0], ['mittel', 0], ['lang', 0], ['mittel', 1000], ['mittel', 60000]]) {
    const [erst, nach] = budgetsAus(l, b)
    p(`Nachschlag > Erstversuch (${l}/${b})`, nach > erst, `${erst} → ${nach}`)
}

// ── Punkte je Kapitel ────────────────────────────────────────────────────
p('Punkte 0 = Vorgabe kurz', punkteVorgabe('kurz', 0) === 'zwei bis drei Punkte')
p('Punkte 0 = Vorgabe lang', punkteVorgabe('lang', 0) === 'sechs bis acht Punkte')
p('Eigene Zahl gilt', punkteVorgabe('kurz', 4) === 'genau 4 Punkte')
p('Einzahl bei 1', punkteVorgabe('mittel', 1) === 'genau einen Punkt')
p('Deckel bei 12', punkteVorgabe('mittel', 99) === 'genau 12 Punkte')
p('negativ = Vorgabe', punkteVorgabe('mittel', -3) === 'vier bis fünf Punkte')

// Die Zahl muss auch wirklich im Prompt landen, sonst ist der Regler eine
// Attrappe — genau das war der Fehler wert, ihn hier festzunageln.
const prompt = bauLagePrompt({ themen: ['crypto'], laenge: 'kurz', punkte: 6 })
p('Prompt trägt die eigene Punktzahl', prompt.includes('genau 6 Punkte'))
p('Prompt ohne Eigenwert trägt die Vorgabe',
    bauLagePrompt({ themen: ['crypto'], laenge: 'kurz' }).includes('zwei bis drei Punkte'))

// ── Videotiefe ───────────────────────────────────────────────────────────
p('drei Stufen vorhanden', Object.keys(VIDEO_TIEFEN).join(',') === 'knapp,normal,ausfuehrlich')
p('normal ist der Bestandswert', videoTiefeAus('normal', 0).tokens === 400)
p('knapp ist kleiner', videoTiefeAus('knapp', 0).tokens < videoTiefeAus('normal', 0).tokens)
p('ausführlich ist grösser', videoTiefeAus('ausfuehrlich', 0).tokens > videoTiefeAus('normal', 0).tokens)
p('unbekannte Stufe fällt auf normal', videoTiefeAus('quatsch', 0).tokens === 400)
p('leere Stufe fällt auf normal', videoTiefeAus(undefined, 0).tokens === 400)
p('eigener Deckel schlägt die Stufe', videoTiefeAus('knapp', 900).tokens === 900)
p('Deckel-Untergrenze 80', videoTiefeAus('normal', 3).tokens === 80)
p('Deckel-Obergrenze 4000', videoTiefeAus('normal', 99999).tokens === 4000)

// Jede Stufe braucht einen Auftrag — ein leerer Prompt liefert Gemini nichts,
// wofür es das Video überhaupt ansehen sollte.
for (const [name, stufe] of Object.entries(VIDEO_TIEFEN)) {
    p(`Auftrag vorhanden (${name})`, typeof stufe.auftrag === 'string' && stufe.auftrag.length > 40)
    p(`Deutsch verlangt (${name})`, /Deutsch/.test(stufe.auftrag))
}
// Nur die ausführliche Stufe darf zu Fliesstext auffordern; die knappen Stufen
// müssen Stichpunkte bleiben, sonst platzt ihr enger Token-Deckel.
p('ausführlich fordert Sätze', /Sätzen/.test(VIDEO_TIEFEN.ausfuehrlich.auftrag))
p('knapp bleibt Stichpunkte', /Stichpunkten/.test(VIDEO_TIEFEN.knapp.auftrag))

// ── Livestream-Erkennung ─────────────────────────────────────────────────
// Ein laufender Stream wird von Gemini mit 403 abgelehnt, die Aufzeichnung
// kostet nach Länge ein Vermögen. Beides muss VOR dem Absenden auffallen.
p('laufender Stream erkannt', istLiveSeite('{"videoDetails":{"isLiveContent":true}}'))
p('Stream mit Leerzeichen im JSON', istLiveSeite('{"isLiveContent" : true}'))
p('isLiveNow erkannt', istLiveSeite('...,"isLiveNow":true,...'))
p('liveBroadcastDetails erkannt', istLiveSeite('"liveBroadcastDetails":{"isLiveNow":false}'))
p('normales Video nicht erkannt', istLiveSeite('{"videoDetails":{"isLiveContent":false}}') === false)
p('leere Seite nicht erkannt', istLiveSeite('') === false)
p('null nicht erkannt', istLiveSeite(null) === false)
// Der Wortlaut allein darf nicht reichen — sonst wäre jedes Video über
// Livestreams selbst ein Livestream.
p('blosse Erwähnung reicht nicht', istLiveSeite('Titel: Was ist isLiveContent?') === false)

// ── Endgültige Fehler ────────────────────────────────────────────────────
// Ein 403 darf keinen Wiederholungsversuch bekommen: er verbrennt sonst
// zweimal einen der drei Videoplätze vor einem Video, das funktioniert hätte.
p('403 ist endgültig', istEndgueltig('Gemini HTTP 403: {"error":{"code":403}}'))
p('PERMISSION_DENIED ist endgültig', istEndgueltig('PERMISSION_DENIED'))
p('kleingeschrieben erkannt', istEndgueltig('permission_denied'))
p('500 ist nicht endgültig', istEndgueltig('Gemini HTTP 500') === false)
p('Zeitüberschreitung ist nicht endgültig', istEndgueltig('This operation was aborted') === false)
p('leer ist nicht endgültig', istEndgueltig('') === false)
p('undefined ist nicht endgültig', istEndgueltig(undefined) === false)

// Format bewusst so: `scripts/run-selftests.mjs` liest genau dieses Zahlenpaar
// heraus, sonst taucht die Datei in der Gesamtsumme mit „keine Zählung" auf.
console.log(`${anzahl - fehler} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
