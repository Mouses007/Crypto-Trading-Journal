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
    budgetsAus, punkteVorgabe, videoTiefeAus, VIDEO_TIEFEN, bauLagePrompt, laengeFuerUpdate,
    bauVideoAuftrag, MELDUNGS_TIEFEN, meldungsTiefeAus, bauAnweisungPruefPrompt,
    istLiveSeite, istEndgueltig, leseLagebild, eigeneAnweisungen, ZUSATZ_MAX, istBruchstueck,
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
p('kurz ohne Eigenwert', String(budgetsAus('kurz', 0)) === '8000,16000')
p('mittel ohne Eigenwert', String(budgetsAus('mittel', 0)) === '16000,32000')
p('lang ohne Eigenwert', String(budgetsAus('lang', 0)) === '26000,52000')
p('unbekannte Länge fällt auf mittel', String(budgetsAus('quatsch', 0)) === '16000,32000')
p('leerer Wert wie 0', String(budgetsAus('mittel', '')) === '16000,32000')
p('null wie 0', String(budgetsAus('mittel', null)) === '16000,32000')
p('Unsinn wie 0', String(budgetsAus('mittel', 'abc')) === '16000,32000')

// Eigenwert schlägt die Länge, Nachschlag ist das Doppelte.
p('Eigenwert gilt', String(budgetsAus('kurz', 7000)) === '7000,14000')
p('Eigenwert als Text gilt', String(budgetsAus('mittel', '3000')) === '3000,6000')

// Grenzen: unter 1000 Token kommt kein vollständiges JSON zurück, über 60000
// zahlt man für einen Bericht, den niemand liest.
p('Untergrenze 1000', String(budgetsAus('mittel', 5)) === '1000,2000')
p('negativ wie 0', String(budgetsAus('mittel', -400)) === '16000,32000')
p('Obergrenze 60000', String(budgetsAus('mittel', 999999)) === '60000,120000')

// Die Zwischenmeldung ist eine Stufe KÜRZER als der Bericht — sie beantwortet
// „was ist seither passiert", und darauf gibt es um 15:00 selten acht Absätze.
p('lang wird mittel', laengeFuerUpdate('lang') === 'mittel')
p('mittel wird kurz', laengeFuerUpdate('mittel') === 'kurz')
p('kurz bleibt kurz — darunter bliebe nur eine Schlagzeile', laengeFuerUpdate('kurz') === 'kurz')
p('Unsinn wird kurz', laengeFuerUpdate('quatsch') === 'kurz' && laengeFuerUpdate(undefined) === 'kurz')

// Beim Token-Deckel dagegen eine Stufe HÖHER. Gemessen: der Erstversuch mit
// 5000 brach bei genau 5000 ab (0,19 USD für nichts). Der Deckel ist eine
// Obergrenze, keine Bestellung — höher anzusetzen kostet nichts.
p('Aktualisierung überspringt die kleine Stufe',
    String(budgetsAus('mittel', 0, { aktualisierung: true })) === '32000,64000')
p('Aktualisierung kurz', String(budgetsAus('kurz', 0, { aktualisierung: true })) === '16000,32000')
p('Aktualisierung mit Eigenwert', String(budgetsAus('mittel', 3000, { aktualisierung: true })) === '6000,12000')
p('ohne Aktualisierung bleibt alles wie bisher',
    String(budgetsAus('mittel', 0, {})) === '16000,32000')
p('Aktualisierung sprengt die Obergrenze nicht',
    String(budgetsAus('mittel', 999999, { aktualisierung: true })) === '60000,120000')

// Der Nachschlag muss IMMER grösser sein — sonst wiederholt der zweite Anlauf
// denselben Abbruch und kostet nur ein zweites Mal.
for (const [l, b] of [['kurz', 0], ['mittel', 0], ['lang', 0], ['mittel', 1000], ['mittel', 60000]]) {
    for (const akt of [false, true]) {
        const [e, n] = budgetsAus(l, b, { aktualisierung: akt })
        p(`Nachschlag > Erstversuch (${l}/${b}${akt ? '/Update' : ''})`, n > e, `${e} → ${n}`)
    }
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

// ── Ausführlichkeit je Meldung ───────────────────────────────────────────
// Die Länge regelt, WIE VIELE Meldungen kommen; die Tiefe, wie ausführlich
// jede einzelne ist. Vorher stand die Tiefe fest im Prompt — wer die Anzahl
// selbst vorgab, hatte damit gar keinen Hebel mehr auf den Umfang.
p('drei Stufen in fester Reihenfolge',
    Object.keys(MELDUNGS_TIEFEN).join(',') === 'knapp,normal,ausfuehrlich')
for (const [name, stufe] of Object.entries(MELDUNGS_TIEFEN)) {
    p(`${name}: Auftrag und Kurzform vorhanden`,
        typeof stufe.auftrag === 'string' && stufe.auftrag.length > 40
        && typeof stufe.kurz === 'string' && /S(ä|a)tz/.test(stufe.kurz))
    p(`${name}: Faktor ist eine positive Zahl`, Number.isFinite(stufe.faktor) && stufe.faktor > 0)
}
p('unbekannte Stufe fällt auf normal', meldungsTiefeAus('quatsch') === MELDUNGS_TIEFEN.normal
    && meldungsTiefeAus(undefined) === MELDUNGS_TIEFEN.normal
    && meldungsTiefeAus('') === MELDUNGS_TIEFEN.normal)
p('normal ist der Bestandsfall', MELDUNGS_TIEFEN.normal.faktor === 1)
p('knapp kleiner, ausführlich grösser',
    MELDUNGS_TIEFEN.knapp.faktor < 1 && MELDUNGS_TIEFEN.ausfuehrlich.faktor > 1)

/*
 * Der wichtigste Test des Blocks: Wer nichts einstellt, bekommt exakt dieselben
 * Budgets wie vor dem Umbau. Ein Regler, der den Bestandsfall verschiebt, macht
 * jeden bisherigen Erfahrungswert wertlos.
 */
for (const laenge of ['kurz', 'mittel', 'lang']) {
    p(`${laenge}: ohne Tiefe = mit normal`,
        String(budgetsAus(laenge, 0)) === String(budgetsAus(laenge, 0, { tiefe: 'normal' })))
    p(`${laenge}: auch bei der Aktualisierung`,
        String(budgetsAus(laenge, 0, { aktualisierung: true }))
        === String(budgetsAus(laenge, 0, { aktualisierung: true, tiefe: 'normal' })))
}
p('ausführlich verdoppelt die Stufe',
    String(budgetsAus('mittel', 0, { tiefe: 'ausfuehrlich' })) === '32000,64000')
p('knapp senkt sie', String(budgetsAus('kurz', 0, { tiefe: 'knapp' })) === '5600,11200')

// Ein EIGENER Deckel ist die ausdrückliche Ansage des Lesers — der wird nicht
// hinter seinem Rücken verdoppelt.
p('Eigenwert bleibt ungeskaliert',
    String(budgetsAus('mittel', 7000, { tiefe: 'ausfuehrlich' })) === '7000,14000'
    && String(budgetsAus('mittel', 7000, { tiefe: 'knapp' })) === '7000,14000')

// Die Grenzen halten auch mit Faktor, und der Nachschlag bleibt grösser als
// der Erstversuch — sonst wäre der zweite Anlauf bloss die Wiederholung des
// Abbruchs.
for (const tiefe of ['knapp', 'normal', 'ausfuehrlich']) {
    for (const laenge of ['kurz', 'mittel', 'lang']) {
        for (const aktualisierung of [false, true]) {
            const [erst, nach] = budgetsAus(laenge, 0, { tiefe, aktualisierung })
            p(`${laenge}/${tiefe}${aktualisierung ? '/update' : ''}: Nachschlag grösser`, nach > erst)
            p(`${laenge}/${tiefe}${aktualisierung ? '/update' : ''}: Grenzen halten`,
                erst >= 1000 && erst <= 60000 && nach <= 120000)
        }
    }
}

// Und die Stufe muss im Prompt ankommen — an BEIDEN Stellen. Das Modell hält
// sich am ehesten an das JSON-Schnittmuster, weil es zuletzt kommt.
{
    const tief = bauLagePrompt({ themen: ['crypto'], tiefe: 'ausfuehrlich' })
    p('Prompt trägt den Auftrag der Stufe', tief.includes('sechs bis neun Sätzen'))
    p('Prompt trägt die Kurzform im Schnittmuster', tief.includes('"sechs bis neun Sätze"'))
    p('ohne Angabe bleibt der Bestandstext',
        bauLagePrompt({ themen: ['crypto'] }).includes('drei bis fünf Sätzen'))
    p('knapp verlangt keine Absätze',
        !bauLagePrompt({ themen: ['crypto'], tiefe: 'knapp' }).includes('drei bis fünf Sätzen'))
}

// Die Anweisungs-Prüfung muss denselben Umfang kennen wie der Bericht — sonst
// beurteilt sie „mach die Meldungen kürzer" gegen eine Vorgabe, die es nicht
// gibt. Die eigene Punktzahl fehlte dort bis zu diesem Umbau ganz.
{
    const pruef = bauAnweisungPruefPrompt({ themen: ['crypto'], laenge: 'mittel', punkte: 9, tiefe: 'knapp' })
    p('Prüfung kennt die eigene Punktzahl', pruef.includes('genau 9 Punkte'))
    p('Prüfung kennt die Tiefe', pruef.includes('ein bis zwei Sätze'))
    p('Prüfung ohne Eigenwerte nennt die Vorgaben',
        bauAnweisungPruefPrompt({ themen: ['crypto'], laenge: 'mittel' })
            .includes('vier bis fünf Punkte'))
}

// ── Eigene Anweisungen aus den Einstellungen ─────────────────────────────
// Leer muss WIRKLICH leer bleiben: sonst zahlt jeder Lauf für einen Block,
// der nichts sagt, und der Bestandsbericht ändert sich ohne Zutun.
// ── Bruchstuecke: abgeschnittene Videozusammenfassungen ──────────────────
// Gemessen am 21.08.2026 an der Live-DB: die kaputten lagen bei 33–77 Zeichen,
// die brauchbaren begannen bei 304. Die Gegenprobe ist hier wichtiger als der
// Fund — ein Filter, der zu viel frisst, kostet bezahlte Analysen.
p('leer ist Bruchstueck', istBruchstueck('') && istBruchstueck('   ') && istBruchstueck(null))
p('halber Stichpunkt faellt', istBruchstueck('- Bitcoin stieg durch Short-Squeeze über 70.00'))
p('vollstaendig aussehender Einzelpunkt faellt auch',
    istBruchstueck('- Krypto-Gipfel im Weißen Haus mit Coinbase.'))
p('77 Zeichen fallen', istBruchstueck('- ' + 'x'.repeat(75)))
// Gegenprobe: echte Zusammenfassungen muessen durch.
p('fuenf Stichpunkte bleiben', !istBruchstueck(
    '- Der aktuelle Seitwärtsmarkt zerstört das Sentiment der Anleger.\n'
    + '- Dies führt zu Verkäufererschöpfung und extremen Positionierungen.\n'
    + '- Der genaue Auslöser für die nächste Bewegung ist unwichtig.\n'
    + '- Die Positionierung ist einseitig.\n- Liquidität bleibt duenn.'))
p('kurze Liste mit drei Punkten bleibt',
    !istBruchstueck('- Eins ist so.\n- Zwei ist so.\n- Drei ist so.'))
p('langer Fliesstext ohne Striche bleibt', !istBruchstueck('y'.repeat(300)))

p('leerer Zusatz ergibt nichts', eigeneAnweisungen('') === '')
p('nur Leerzeichen ergeben nichts', eigeneAnweisungen('   \n  ') === '')
p('undefined ergibt nichts', eigeneAnweisungen(undefined) === '')

const zus = eigeneAnweisungen('  Schreib knapper.  ')
p('Text taucht auf', zus.includes('Schreib knapper.'))
p('Text ist getrimmt', !zus.includes('  Schreib knapper.'))
p('Text steht in Klammern', zus.includes('<<<') && zus.includes('>>>'))
// Der springende Punkt: Der Kasten darf Ton und Auswahl steuern, aber die
// Regeln nicht aushebeln — sonst genügt ein Satz, um aus dem Bericht eine
// Handelsempfehlung zu machen.
p('Regeln werden nachgereicht', zus.includes('keine Handelsempfehlungen'))
p('Format wird nachgereicht', zus.includes('JSON'))
// Rangfolge (Nutzerentscheid 21.08.2026): Die Anweisung des Lesers geht den
// EINSTELLUNGEN vor — Umfang, Punktzahl, Reihenfolge. Vorher stand sie unter
// ihnen, und die Prüfung wies Wünsche als „wirkungslos" ab, die der Leser
// ausdrücklich wollte. Unantastbar bleiben nur Regeln und Antwortformat.
p('Anweisung hat Vorrang vor den Einstellungen',
    zus.includes('VORRANG') && zus.includes('gehen den Vorgaben aus den Einstellungen VOR'))
p('Umfang ist ausdrücklich überstimmbar', zus.includes('unter UMFANG etwas anderes steht'))
p('eigener Block wird erfüllt statt abgelehnt',
    zus.includes('LEHNE DAS NICHT AB') && zus.includes('ANFANG des passenden Kapitels'))
p('Deckel greift', eigeneAnweisungen('y'.repeat(ZUSATZ_MAX + 500)).includes('y'.repeat(ZUSATZ_MAX))
    && !eigeneAnweisungen('y'.repeat(ZUSATZ_MAX + 500)).includes('y'.repeat(ZUSATZ_MAX + 1)))

// Im Prompt: der Block steht VOR dem Schnittmuster, nie dahinter — sonst ist
// das Letzte, was das Modell liest, nicht mehr das Antwortformat.
const mitZusatz = bauLagePrompt({ themen: ['crypto'], zusatz: 'Nur Bitcoin.' })
p('Prompt trägt den Zusatz', mitZusatz.includes('Nur Bitcoin.'))
p('Zusatz steht vor dem JSON-Schnittmuster',
    mitZusatz.indexOf('Nur Bitcoin.') < mitZusatz.indexOf('Antworte NUR mit JSON'))
p('Prompt ohne Zusatz bleibt unverändert',
    !bauLagePrompt({ themen: ['crypto'] }).includes('EIGENE ANWEISUNGEN'))

// ── Lagebild: dafür / dagegen / offen, mit Fakt-Marke ────────────────────
// Der wunde Punkt ist die Marke. Fehlt sie oder steht Unsinn drin, MUSS
// „einschaetzung" herauskommen — eine als Fakt ausgegebene Deutung ist der
// einzige Fehler in diesem Bericht, den der Leser nicht mehr erkennen kann.
p('Lagebild ohne Eingabe ist null', leseLagebild(undefined) === null)
p('leere Listen ergeben null', leseLagebild({ dafuer: [], dagegen: [], offen: [] }) === null)
p('Unsinn ergibt null', leseLagebild('kaputt') === null)
p('leere Texte zählen nicht', leseLagebild({ dafuer: [{ art: 'fakt', text: '   ' }] }) === null)

const lb = leseLagebild({
    dafuer: [{ art: 'fakt', text: 'ES hält 7.714.' }, { art: 'FAKT ', text: 'DXY fällt.' }],
    dagegen: [{ art: 'einschaetzung', text: 'Der Long ist nicht sauber.' },
        { text: 'Ohne Marke.' }, { art: 'quatsch', text: 'Falsche Marke.' }],
    offen: ['Nackter Satz ohne Objekt.'],
})
p('dafür übernommen', lb.dafuer.length === 2)
p('Fakt bleibt Fakt', lb.dafuer[0].art === 'fakt')
p('Fakt auch mit Grossschrift und Leerzeichen', lb.dafuer[1].art === 'fakt')
p('fehlende Marke wird Einschätzung', lb.dagegen[1].art === 'einschaetzung')
p('unbekannte Marke wird Einschätzung', lb.dagegen[2].art === 'einschaetzung')
p('nackter Satz wird übernommen', lb.offen[0].text === 'Nackter Satz ohne Objekt.')
p('nackter Satz ist Einschätzung', lb.offen[0].art === 'einschaetzung')

// Deckel: fünf Einträge je Spalte reichen für eine Abwägung; alles darüber ist
// eine Liste, keine Abwägung mehr.
const viele = leseLagebild({ dafuer: Array.from({ length: 9 }, (_, i) => ({ art: 'fakt', text: 'Satz ' + i })) })
p('höchstens fünf je Spalte', viele.dafuer.length === 5)
p('leere Spalten bleiben leer', viele.dagegen.length === 0 && viele.offen.length === 0)
p('Text wird gekürzt', leseLagebild({ offen: [{ text: 'x'.repeat(900) }] }).offen[0].text.length === 400)

// Der Prompt muss das Feld auch verlangen — sonst liefert das Modell es nie.
const promptLb = bauLagePrompt({ themen: ['crypto'], laenge: 'mittel' })
p('Prompt verlangt das Lagebild', promptLb.includes('"lagebild"'))
p('Prompt verbietet Empfehlungen im Lagebild', promptLb.includes('keine Empfehlung'))

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
// ── Videoauftrag: Chartmarken überleben nur, wenn man sie verlangt ───────
// Ein Chartvideo besteht fast nur aus Marken; „was für die Marktlage relevant
// ist" liest ein Modell als Nachrichtenlage und wirft sie weg.
{
    const ohne = bauVideoAuftrag({ tiefe: 'normal' })
    const mit = bauVideoAuftrag({ tiefe: 'normal', mitChart: true })
    p('ohne Chartkapitel keine Chartanweisung', !ohne.text.includes('Unterstützungen'))
    p('mit Chartkapitel werden Marken verlangt',
        mit.text.includes('Unterstützungen') && mit.text.includes('Zeiteinheit'))
    p('auch dann nur wiedergeben, nicht deuten', mit.text.includes('nicht selbst deuten'))
    // Die Grenze bleibt: eine genannte Unterstützung ist eine Aussage des
    // Videos, ein Kursziel wäre eine Empfehlung daraus.
    p('das Kursziel-Verbot bleibt in beiden Fassungen',
        ohne.text.includes('keine Kursziele') && mit.text.includes('keine Kursziele'))
    p('die Leermeldung bleibt in beiden Fassungen',
        ohne.text.includes('OHNE INHALT') && mit.text.includes('OHNE INHALT'))
    p('der Token-Deckel kommt weiter aus der Stufe',
        bauVideoAuftrag({ tiefe: 'knapp' }).tokens === videoTiefeAus('knapp', 0).tokens
        && bauVideoAuftrag({ tiefe: 'knapp', deckel: 1234 }).tokens === 1234)
}

/*
 * Die Kapitel-Lage schreibt über NACHRICHTEN, nicht über Messwerte.
 *
 * Bis zum 05.09.2026 befahl der Prompt das Gegenteil („Der Marktdaten-Block
 * gehört in die Lage dieses Kapitels") und verbot zwei Absätze später die
 * Wiederholung. Das Modell gehorchte dem Befehl: Die Kapitel-Lage vom
 * 05.09.2026 bestand aus Fear & Greed, Dominanz und Funding — und keiner
 * einzigen Meldung.
 */
{
    const mit = bauLagePrompt({ themen: ['crypto'], einordnung: true })
    const ohne = bauLagePrompt({ themen: ['crypto'], einordnung: false })

    p('der alte Befehl steht in keiner Fassung mehr',
        !mit.includes('gehört in die Lage') && !ohne.includes('gehört in die Lage'))
    p('mit Einordnung: Kapitel-Lage NICHT über den Marktdaten-Block',
        mit.includes('NICHT über den Marktdaten-Block'))
    p('mit Einordnung: die Karte wird als vorhanden benannt',
        mit.includes('EIGENE MARKTEINORDNUNG'))
    // GEGENPROBE: Ohne Einordnung deutet sonst niemand den Marktstand —
    // dann darf die GESAMTLAGE einen Satz dazu sagen, die Kapitel-Lage nicht.
    p('GEGENPROBE ohne Einordnung darf die Gesamtlage deuten',
        ohne.includes('der GESAMTLAGE') && !ohne.includes('NICHT über den Marktdaten-Block'))
    p('beide Fassungen schicken die Kapitel-Lage zu den Nachrichten',
        mit.includes('über die NACHRICHTEN') && ohne.includes('über die NACHRICHTEN'))

    // Die Wiederholungsregel muss die unantastbaren Blöcke aufzählen — genau
    // sie fehlten, weshalb das Modell die Doppelung nicht erkennen konnte.
    p('Wiederholungsregel nennt die Marktstand-Tabelle',
        mit.includes('Marktstand-Tabelle') && ohne.includes('Marktstand-Tabelle'))
    p('Wiederholungsregel nennt die Einordnung nur, wenn es sie gibt',
        mit.includes('die eigene Markteinordnung,') && !ohne.includes('die eigene Markteinordnung,'))

    // GEGENPROBE: ein anderes Thema bekommt die Krypto-Sonderregel nicht.
    const fin = bauLagePrompt({ themen: ['finanzen'], einordnung: true })
    p('GEGENPROBE fremdes Thema bekommt die Krypto-Sonderregel nicht',
        !fin.includes('NICHT über den Marktdaten-Block') && !fin.includes('der GESAMTLAGE'))
}

/*
 * Handelsempfehlungen, Kursziele, Prognosen — wählbar seit 05.09.2026
 * (`kiEmpfehlungenAn`, gilt auch für die Gesamtlage- und Handelslage-Kachel).
 *
 * Vorgabe AUS: Der Bericht geht per Mail hinaus, auch an die Empfängerliste.
 * Eingeschaltet bleibt die Pflicht, Bedingung und Widerlegung zu nennen — eine
 * nackte Zahl ist auch dann keine Aussage.
 */
{
    const aus = bauLagePrompt({ themen: ['crypto'] })
    const an = bauLagePrompt({ themen: ['crypto'], empfehlungen: true })

    p('Vorgabe verbietet Empfehlungen wie bisher',
        aus.includes('Keine Handelsempfehlungen, keine Kursziele, keine Prognosen.'))
    p('eingeschaltet sind sie erlaubt',
        an.includes('sind ERLAUBT') && !an.includes('Keine Handelsempfehlungen, keine Kursziele, keine Prognosen.'))
    // Erlaubt heisst nicht schrankenlos: ohne Bedingung und Widerlegung nicht.
    p('erlaubt verlangt Begründung, Marke und Widerlegung',
        an.includes('was die Aussage widerlegt') && an.includes('lässt du weg'))
    p('erlaubt trennt eigene Einschätzung von Fremdprognose',
        an.includes('Prognosen der ZITIERTEN Quellen'))

    // Die Waage stellt Fragen — auch wenn Empfehlungen erlaubt sind. Sonst
    // steht die Antwort in der Spalte, die die Frage stellen soll.
    p('„offen" bleibt in beiden Fassungen eine Frage',
        aus.includes('über 66.000 kaufen') && an.includes('Die Waage wägt ab, sie entscheidet nicht'))

    // Die Prüfung der eigenen Anweisung muss mitziehen, sonst nennt sie eine
    // Anweisung „gegenregel", die der Leser längst erlaubt hat.
    const pruefAus = bauAnweisungPruefPrompt({ themen: ['crypto'] })
    const pruefAn = bauAnweisungPruefPrompt({ themen: ['crypto'], empfehlungen: true })
    p('Anweisungsprüfung kennt das Verbot in der Vorgabe',
        pruefAus.includes('keine Handelsempfehlungen'))
    p('Anweisungsprüfung nennt Empfehlungen dann nicht mehr unverrückbar',
        !pruefAn.includes('keine Handelsempfehlungen') && pruefAn.includes('ERLAUBT'))
    p('Anweisungsprüfung kennt die neue Grenze der Kapitel-Lage',
        pruefAus.includes('bleibt wirkungslos') && pruefAn.includes('bleibt wirkungslos'))
}

console.log(`${anzahl - fehler} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
