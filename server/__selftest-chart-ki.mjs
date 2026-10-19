/**
 * Selbsttest der KI-Analyse im Chart — Eingabe und Auswahlprüfung, ohne Modell.
 *
 *   node server/__selftest-chart-ki.mjs
 *
 * Seit 18.10.2026 vermisst der Code den Chart und das Modell wählt per ID aus.
 * Das Sieb hier ist die Stelle, die das durchsetzt: Preise und Zeiten kommen
 * NUR aus den Kandidaten, eine erfundene ID oder ein Fantasiepreis im alten
 * Format kommt nicht durch. Zu streng frisst es bezahlte, gute Auswahl — für
 * jede Ablehnung steht deshalb eine Gegenprobe daneben, die durchgehen MUSS.
 */
import { baueChartEingabe, pruefeChartAuswahl, systemText, normAuswahl, filterePaket, auswahlLeer } from './chart-ki.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const H = 3_600_000
const T0 = Date.UTC(2026, 9, 10, 0, 0)
// Welle um 100 mit Volumen — genug für eine Vermessung (≥ 30 Kerzen)
const kerzen = Array.from({ length: 60 }, (_, i) => {
    const m = 100 + 3 * Math.sin(i / 4)
    return { t: T0 + i * H, o: m - 0.3, h: m + 1, l: m - 1, c: m + 0.3, v: 1000 + 10 * i }
})

console.log('\nEingabe\n')
{
    const e = baueChartEingabe({
        symbol: 'SOLUSDT', interval: '1h', kerzen,
        zeichnungen: [{ typ: 'horizontale', punkte: [{ t: T0, p: 102 }], stil: { text: 'Wochenhoch' } }, { typ: 'fib', punkte: [] }],
        hebelzonen: { oben: [{ preis: 110, usd: 12e6 }], unten: [{ preis: 95, usd: 8e6 }] },
        trades: [{ richtung: 'long', einstieg: { t: T0 + 5 * H, p: 100.4 }, ausstieg: null }],
    })
    check('Kandidaten mit IDs statt Roh-Kerzen', /^N1 \|/m.test(e) && /VOLUMENPROFILE je Abschnitt/.test(e) && /^A1 .*V1 POC/m.test(e))
    check('nur die letzten 12 Kerzen roh, nicht alle 60', e.split('\n').filter((z) => /^\d{4}-\d\d-\d\d \d\d:\d\dZ,/.test(z)).length === 12)
    check('eigene Linie als U-Bezug mit Beschriftung, Fibonacci weggelassen', /U1 \| horizontale bei 102 „Wochenhoch"/.test(e) && !/fib/.test(e))
    check('Hebelzonen als Modell gekennzeichnet', e.includes('Modell') && e.includes('~12 Mio USD Shorts'))
    check('offener eigener Trade als offen', e.includes('(offen)'))
    check('Eingabe deutlich kürzer als 60 Roh-Kerzen-Zeilen hätten', e.length < 4000, String(e.length))
    check('System ohne Empfehlungen verbietet Prognosen', systemText(false, false).includes('KEINE Prognose'))
    check('System mit Empfehlungen lässt die Sperre weg', !systemText(false, true).includes('KEINE Prognose'))
    check('System verlangt IDs statt Preise', systemText(false, false).includes('NUR IDs aus der Liste'))
    const mitVp = baueChartEingabe({ symbol: 'X', interval: '1h', kerzen, zeichnungen: [{ typ: 'volprofil', punkte: [{ t: kerzen[10].t, p: 0 }, { t: kerzen[30].t, p: 0 }], stil: {} }] })
    check('gezogenes Volumenprofil erscheint als U-Bezug', /U1 \| Volumenprofil/.test(mitVp))
}

// Ein fest gebautes Paket: Kurs 100, ATR 1
const paket = {
    kurs: 100, atr: 1, vonT: T0, bisT: T0 + 59 * H, interval: '1h', intervalHtf: '4h',
    spanne: { tief: 94, hoch: 111, breiteAtr: 17, positionPct: 35, kerzen: 30 },
    struktur: { hochs: [], tiefs: [], zustand: -1, bruch: null },
    roh: [{ h: 100.5, l: 99.5 }],
    nutzer: [{ id: 'U1', typ: 'horizontale', punkte: [{ t: T0, p: 103 }], text: '' }],
    kandidaten: [
        { id: 'N1', quelle: 'niveau', preis: 110, tief: 109.7, hoch: 110.3, t1: T0 + 2 * H, rolle: 'widerstand', beruehrungen: 3 },
        { id: 'N2', quelle: 'niveau', preis: 105, tief: 104.8, hoch: 105.2, t1: T0 + 10 * H, rolle: 'widerstand', beruehrungen: 4 },
        { id: 'N3', quelle: 'niveau', preis: 103.5, tief: 103.3, hoch: 103.7, t1: T0 + 11 * H, rolle: 'widerstand', beruehrungen: 2 },
        { id: 'N4', quelle: 'niveau', preis: 98, tief: 97.8, hoch: 98.2, t1: T0 + 20 * H, rolle: 'unterstuetzung', beruehrungen: 3 },
        { id: 'N5', quelle: 'niveau', preis: 95, tief: 94.8, hoch: 95.2, t1: T0 + 30 * H, rolle: 'unterstuetzung', beruehrungen: 2 },
        { id: 'V1', quelle: 'volumenprofil', name: 'POC', preis: 105.1, tief: 104.95, hoch: 105.25, t1: T0 },
        { id: 'T1', quelle: 'trend', seite: 'hoch', richtung: 'ab', t1: T0 + 5 * H, p1: 112, t2: T0 + 40 * H, p2: 108, wertJetzt: 106, abstandAtr: 6, beruehrungen: 3 },
        { id: 'D1', quelle: 'htf', preis: 92, tief: 91.5, hoch: 92.5, t1: T0, beruehrungen: 2 },
    ],
}

console.log('\nAuswahl abbilden\n')
{
    const gut = pruefeChartAuswahl({
        text: 'Der Kurs pendelt zwischen [N4] und [N2]. Darüber liegt [T1].',
        linien: [
            { id: 'N2', label: 'Widerstand', grund: 'viermal abgewiesen, deckt sich mit [V1]', gewicht: 'stark' },
            { id: 'T1', label: 'Abwärtslinie', grund: 'drei Berührungen' },
            { id: 'N4', label: 'Boden', grund: 'drei Tiefs' },
        ],
        zonen: [{ ids: ['N5'], label: 'Bodenzone', grund: 'Tiefs', gewicht: 'mittel' }],
        bedingungen: [{ id: 'N2', richtung: 'ueber', dann: 'wäre der Weg bis [N1] frei', ziel: 'N1' }],
    }, paket)
    check('sachliche Auswahl kommt vollständig durch', gut.linien.length === 3 && gut.zonen.length === 1 && gut.bedingungen.length === 1 && gut.text, JSON.stringify(gut.verworfen))
    check('Preise exakt aus den Kandidaten (N2 = 105, waagerecht)', gut.linien[0].p1 === 105 && gut.linien[0].p2 === 105 && gut.linien[0].t1 === T0 + 10 * H)
    check('Trendlinie mit den Ankern des Kandidaten', gut.linien[1].art === 'trend' && gut.linien[1].p1 === 112 && gut.linien[1].t2 === T0 + 40 * H)
    check('Platzhalter im Text eingesetzt', gut.text.includes('98 (N4)') && gut.text.includes('105 (N2)') && gut.text.includes('Trendlinie T1 (jetzt 106)'), gut.text)
    check('Platzhalter im Grund eingesetzt', gut.linien[0].grund.includes('105.1 (V1)'), gut.linien[0].grund)
    check('Gewicht übernommen, ohne Angabe „mittel"', gut.linien[0].gewicht === 'stark' && gut.linien[1].gewicht === 'mittel')
    check('„wenn" baut der Code, mit Zahl und ID', gut.bedingungen[0].wenn === '1h-Schluss über 105 (N2)', gut.bedingungen[0].wenn)
    check('Zone aus einer ID = deren Band, ab erster Berührung', gut.zonen[0].tief === 94.8 && gut.zonen[0].hoch === 95.2 && gut.zonen[0].vonT === T0 + 30 * H)
}
{
    const art = pruefeChartAuswahl({ linien: [{ id: 'N2', label: 'x' }, { id: 'N4', label: 'y' }] }, paket)
    check('Art folgt der Lage zum Kurs, nicht dem Modell', art.linien[0].art === 'widerstand' && art.linien[1].art === 'unterstuetzung')
    const norm = pruefeChartAuswahl({ linien: [{ id: ' n2 ', label: 'x' }, { id: '[N4]', label: 'y' }] }, paket)
    check('Gegenprobe: IDs in Kleinschreibung / mit Klammern werden normalisiert', norm.linien.length === 2, JSON.stringify(norm.verworfen))
}
{
    const fremd = pruefeChartAuswahl({ linien: [{ id: 'N99', label: 'gibt es nicht' }, { art: 'widerstand', t1: '2026-10-10T05:00Z', p: 104, label: 'altes Format' }, { id: 'U1', label: 'eigene' }] }, paket)
    check('unbekannte ID verworfen', fremd.verworfen.some((v) => v.grund === 'unbekannteId' && v.inhalt === 'N99'))
    check('altes Format mit eigenem Preis kommt nicht durch (kein Fantasiepreis)', fremd.linien.length === 0)
    check('eigene Linie (U) nicht als Linie wählbar', !fremd.linien.some((l) => l.id === 'U1'))
}
{
    const doppelt = pruefeChartAuswahl({ linien: [{ id: 'N2', label: 'a' }, { id: 'N2', label: 'a2' }, { id: 'V1', label: 'POC' }, { id: 'N5', label: 'b' }], zonen: [{ ids: ['N5'], label: 'z' }] }, paket)
    check('dieselbe ID zweimal → einmal', doppelt.linien.filter((l) => l.id === 'N2').length === 1)
    check('V1 0,1 ATR neben N2 → nur eine Linie (doppelt)', !doppelt.linien.some((l) => l.id === 'V1') && doppelt.verworfen.some((v) => v.inhalt === 'V1' && v.grund === 'doppelt'))
    check('ID als Linie und Zone → die Zone bleibt', !doppelt.linien.some((l) => l.id === 'N5') && doppelt.zonen.length === 1)
}
{
    const z = pruefeChartAuswahl({ zonen: [
        { ids: ['N2', 'N4'], label: 'nicht benachbart' },
        { ids: ['N1', 'N2'], label: 'zu breit' },
        { ids: ['T1'], label: 'aus Trend' },
        { ids: ['N2', 'N3'], label: 'ok' },
    ] }, paket)
    check('Zone aus nicht benachbarten IDs verworfen', z.verworfen.some((v) => v.grund === 'nichtBenachbart'))
    check('Zone breiter als 2 ATR verworfen', z.verworfen.some((v) => v.grund === 'zoneZuBreit'))
    check('Zone aus Trendlinie verworfen', z.verworfen.some((v) => v.grund === 'zoneAusTrend'))
    check('Gegenprobe: benachbart und 1,9 ATR breit bleibt', z.zonen.length === 1 && z.zonen[0].tief === 103.3 && z.zonen[0].hoch === 105.2, JSON.stringify(z.zonen))
}
{
    const b = pruefeChartAuswahl({ bedingungen: [
        { id: 'N2', richtung: 'ueber', dann: 'x', ziel: 'N4' },
        { id: 'N4', richtung: 'unter', dann: 'läge [N5] als nächste Marke an', ziel: 'N5' },
        { id: 'N4', richtung: 'ueber', dann: 'hält der Boden' },
    ] }, paket)
    check('Ziel gegen die Richtung verworfen', b.verworfen.some((v) => v.grund === 'zielGegenRichtung'))
    check('Gegenprobe: Ziel in Richtung bleibt', b.bedingungen.some((x) => x.id === 'N4' && x.zielId === 'N5'))
    check('Kurs schon auf der Seite → „solange …"', b.bedingungen.some((x) => x.wenn.startsWith('solange 1h-Schlüsse über 98 (N4)')), JSON.stringify(b.bedingungen.map((x) => x.wenn)))
}
{
    const viele = pruefeChartAuswahl({ linien: ['N1', 'N2', 'N3', 'N4', 'N5', 'T1', 'D1', 'V1', 'N1'].map((id) => ({ id, label: id })) }, paket)
    check('höchstens 6 Linien', viele.linien.length <= 6, String(viele.linien.length))
    const satz = pruefeChartAuswahl({ text: 'Erster Satz mit [N2]. Zweiter mit [N99]. Dritter.' }, paket)
    check('unbekannte ID im Text entfernt nur ihren Satz', satz.text.includes('105 (N2)') && satz.text.includes('Dritter') && !satz.text.includes('Zweiter'), satz.text)
    const zahl = pruefeChartAuswahl({ linien: [{ id: 'N2', label: 'a', grund: 'Abpraller bei 160' }, { id: 'N4', label: 'b', grund: 'Tief bei 98,1' }] }, paket)
    check('fremde Zahl im Grund → Warnung (nur protokolliert)', zahl.warnungen.some((w) => w.zahl === 160) && zahl.linien.length === 2)
    check('Gegenprobe: Zahl 0,1 neben N4 ohne Warnung', !zahl.warnungen.some((w) => Math.abs(w.zahl - 98.1) < 1e-9))
}

console.log('\nAuswahl (Kästchen im Reiter)\n')
{
    check('ohne Angabe: alles an', Object.values(normAuswahl(null)).every(Boolean))
    check('ohne Niveaus, Volumenprofil und höhere Zeiteinheit gibt es keine Zonen', normAuswahl({ niveaus: false, volumen: false, htf: false }).zonen === false)
    check('nur Zonen ohne Quellen → leer (Knopf gesperrt)', auswahlLeer(normAuswahl({ niveaus: false, trend: false, volumen: false, htf: false })))
    const nurTrend = filterePaket(paket, normAuswahl({ niveaus: false, volumen: false, htf: false }))
    check('Paket ohne Niveaus/V/D enthält nur noch Trendlinien', nurTrend.kandidaten.every((k) => k.quelle === 'trend') && nurTrend.kandidaten.length === 1)
    const sys = systemText(false, false, normAuswahl({ zonen: false, bedingungen: false, trend: false }))
    check('System ohne Zonen/Bedingungen sagt es und nennt T nicht als Linie', sys.includes('Keine Zonen') && sys.includes('Keine Bedingungen') && !sys.includes('T (Trendlinie)'))
    check('Gegenprobe: Standard-System nennt Zonen und Bedingungen', systemText(false, false).includes('"ids"') && systemText(false, false).includes('"richtung"'))
    const ohne = pruefeChartAuswahl({ linien: [{ id: 'N2', label: 'a' }], zonen: [{ ids: ['N5'], label: 'z' }], bedingungen: [{ id: 'N2', richtung: 'ueber', dann: 'x' }] }, paket, { auswahl: { zonen: false, bedingungen: false } })
    check('abgewählte Zonen und Bedingungen werden nicht übernommen, auch wenn das Modell sie liefert', ohne.zonen.length === 0 && ohne.bedingungen.length === 0 && ohne.linien.length === 1)
    const ohneHebel = baueChartEingabe({ symbol: 'X', interval: '1h', kerzen, hebelzonen: null })
    check('Liquidationszonen abgewählt → nicht in der Eingabe', !ohneHebel.includes('LIQUIDATIONSZONEN'))
}

console.log('\nWächter\n')
{
    const schlecht = pruefeChartAuswahl({
        text: 'SOL dürfte in den nächsten Stunden steigen.',
        linien: [{ id: 'N2', label: 'Kursziel 120', grund: 'Kursziel nach Ausbruch' }],
        bedingungen: [{ id: 'N2', richtung: 'ueber', dann: 'jetzt kaufen' }],
    }, paket)
    check('Prognose im Text verworfen', schlecht.text === '')
    check('Kursziel in Beschriftung verworfen', schlecht.verworfen.some((v) => v.grund === 'prognose' && v.art === 'linie'))
    check('Empfehlung in Bedingung verworfen', schlecht.bedingungen.length === 0)
    check('ganz leer → leer = true', schlecht.leer === true)
    const negiert = pruefeChartAuswahl({ text: 'Eine Prognose lässt sich daraus nicht ableiten; die Spanne ist eng.' }, paket)
    check('Gegenprobe: verneinte „Prognose" geht durch', negiert.text !== '')
    const erlaubt = pruefeChartAuswahl({ text: 'SOL dürfte steigen.' }, paket, { empfehlungen: true })
    check('mit freigeschalteten Empfehlungen keine Sperre', erlaubt.text !== '')
    check('fehlende Antwort bricht nichts', pruefeChartAuswahl(null, paket).leer === true)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
