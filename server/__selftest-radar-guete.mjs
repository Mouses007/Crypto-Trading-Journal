/**
 * Selbsttest: Auswertung der Erfolgskontrolle.
 *
 * Ohne Netz. Diese Zahlen entscheiden, ob man der Rangfolge glaubt — eine
 * geschönte Auswertung wäre schlimmer als gar keine, weil sie Vertrauen
 * erzeugt, das nicht gedeckt ist.
 *
 * Bis zum 07.10.2026 baute jeder Fall hier genau EINEN Lauf mit zwanzig
 * Zeilen — und genau deshalb fielen zwei Fehler nie auf: die „Kontrollgruppe"
 * waren die Plätze 11–20, und über mehrere Läufe hinweg nahm Precision@10 die
 * Platz-1-Zeilen von zehn beliebigen Läufen. Die Fälle unten bauen deshalb
 * mehrere Läufe mit echter Kontrollgruppe.
 *
 * Aufruf: node server/__selftest-radar-guete.mjs
 */
import {
    precisionAt, rangGegenErgebnis, werteAus, werteLaufAus, werteAusHype, spanne, median,
    schwelleFuer, vorzeichenTest, MIN_LAEUFE,
} from './radar-guete.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Radar: Erfolgskontrolle')

const z = (rang, mfe, mae, status = 'gemessen', extra = {}) =>
    ({ rang, mfePct: mfe, maePct: mae, status, gruppe: 'spitze', ...extra })

// ── Spanne ──────────────────────────────────────────────────────────────
p('Spanne ist hoch minus tief', spanne(z(1, 5, -3)) === 8)
p('fehlende Werte ergeben null', spanne(z(1, null, -3)) === null)
p('leere Zeile ergibt null', spanne(undefined) === null)

// ── Schwelle je Horizont ────────────────────────────────────────────────
p('Schwelle wächst mit der Wurzel der Zeit',
    schwelleFuer('15m') === 0.5 && schwelleFuer('1h') === 1 && schwelleFuer('4h') === 2)

// ── Precision (ein Lauf) ────────────────────────────────────────────────
{
    const zeilen = [z(1, 5, -1), z(2, 3, -1), z(3, 0.2, -0.1), z(4, 6, -2)]
    const r = precisionAt(zeilen, 4)
    p('drei von vier bewegten sich genug', r.treffer === 3 && r.n === 4, JSON.stringify(r))
    p('Anteil stimmt', Math.abs(r.wert - 0.75) < 1e-9)
}
p('ohne Messungen kein Wert', precisionAt([]).wert === null)
p('offene Zeilen zählen nicht mit', precisionAt([z(1, 9, -1, 'offen')]).n === 0)
p('die Schwelle ist einstellbar', precisionAt([z(1, 2, -0.5)], 10, 10).treffer === 0)
p('Kontrollzeilen zählen nicht zur Spitze',
    precisionAt([z(30, 9, -1, 'gemessen', { gruppe: 'kontrolle' })]).n === 0)

/*
 * Die Richtung ist ausdrücklich egal. Ein Coin, der 8 % GEFALLEN ist, war
 * genauso handelbar wie einer, der 8 % gestiegen ist — die Seite verspricht
 * Bewegung, nicht Richtung.
 */
p('Bewegung nach unten zählt genauso', precisionAt([z(1, 0.1, -8)], 10).treffer === 1)

// ── Rang gegen Ergebnis (ein Lauf) ──────────────────────────────────────
{
    const perfekt = Array.from({ length: 12 }, (_, i) => z(i + 1, 20 - i, 0))
    p('perfekte Übereinstimmung ergibt +1', Math.abs(rangGegenErgebnis(perfekt).wert - 1) < 1e-9)
    const verkehrt = Array.from({ length: 12 }, (_, i) => z(i + 1, i, 0))
    p('umgekehrte Rangfolge ergibt −1', Math.abs(rangGegenErgebnis(verkehrt).wert + 1) < 1e-9)
}
p('unter zehn Paaren wird nicht gerechnet',
    rangGegenErgebnis(Array.from({ length: 9 }, (_, i) => z(i + 1, i, 0))).wert === null)

// ── Median ──────────────────────────────────────────────────────────────
p('Median bei ungerader Anzahl', median([3, 1, 2]) === 2)
p('Median bei gerader Anzahl', median([1, 2, 3, 4]) === 2.5)
p('leere Reihe ergibt null', median([]) === null)
p('Fehlwerte fallen heraus', median([1, null, 3]) === 2)

// ── Vorzeichentest ──────────────────────────────────────────────────────
p('10 von 10 vorne ist signifikant', vorzeichenTest(10, 0) < 0.01, String(vorzeichenTest(10, 0)))
p('5 zu 5 ist es nicht', vorzeichenTest(5, 5) === 1)
p('ohne Vergleiche kein Wert', vorzeichenTest(0, 0) === null)

/**
 * Ein Lauf: zehn Spitzenplätze, zehn Kontrollzeilen aus der unteren Hälfte.
 * `oben`/`unten` sind die Spannen, `atr` die eingefrorene ATR% je Zeile.
 */
function lauf(laufId, oben, unten, atr = () => null) {
    return [
        ...oben.map((s, i) => z(i + 1, s, 0, 'gemessen', { laufId, atrPct: atr(i + 1) })),
        ...unten.map((s, i) => z(60 + i, s, 0, 'gemessen', { laufId, gruppe: 'kontrolle', atrPct: atr(60 + i) })),
    ]
}
const reihe = (n, f) => Array.from({ length: n }, (_, i) => f(i))

// ── Gesamtauswertung über mehrere Läufe ─────────────────────────────────
{
    // Oben viel Bewegung, Kontrolle wenig — in jedem Lauf.
    const gut = reihe(8, (l) => lauf(l + 1, reihe(10, (i) => 6 - i * 0.2), reihe(10, (i) => 1 - i * 0.05))).flat()
    const a = werteAus(gut, '1h')
    p('Horizont wird durchgereicht', a.horizont === '1h')
    p('acht Läufe mit Kontrollgruppe', a.laeufe === 8 && a.laeufeMitKontrolle === 8, JSON.stringify(a))
    p('oben bewegt sich mehr als die Kontrolle', a.abstandMedian > 0)
    p('in jedem Lauf vorne', a.obenVorneAnteil === 1)
    p('das Urteil sagt es auch', a.urteil === 'traegt', a.urteil)

    /*
     * Der Fall, für den die Kontrollgruppe existiert: An einem wilden Tag
     * bewegt sich ALLES. Precision@10 sähe glänzend aus, obwohl die Rangfolge
     * nichts leistet — erst der Vergleich mit der Kontrolle entlarvt das.
     */
    const wild = reihe(8, (l) => lauf(l + 1, reihe(10, () => 10), reihe(10, () => 10))).flat()
    const b = werteAus(wild, '1h')
    p('bei gleicher Bewegung überall ist Precision hoch', b.precision10 === 1)
    p('aber das Urteil fällt trotzdem nüchtern aus', b.urteil !== 'traegt', b.urteil)

    /*
     * Der alte Fehler: Platz 11–20 als „unten". Ein Lauf ohne Kontrollgruppe
     * (Altbestand, nur `spitze`) darf in den Vergleich gar nicht eingehen.
     */
    const alt = reihe(8, (l) => reihe(20, (i) => z(i + 1, i < 10 ? 8 : 1, 0, 'gemessen', { laufId: l + 1 }))).flat()
    const c = werteAus(alt, '1h')
    p('Altbestand ohne Kontrolle wird nicht verglichen', c.laeufeMitKontrolle === 0, JSON.stringify(c))
    p('und bekommt kein Urteil', c.urteil === 'zuWenig', c.urteil)

    /*
     * Der zweite alte Fehler: Precision@10 über mehrere Läufe nahm die
     * Platz-1-Zeilen von zehn Läufen. Hier bewegt sich Platz 1 nie, die
     * Plätze 2–10 immer — je Lauf sind das 9 von 10.
     */
    const platz1Lahm = reihe(12, (l) => lauf(l + 1,
        reihe(10, (i) => (i === 0 ? 0.1 : 5)), reihe(10, () => 0.5))).flat()
    const d = werteAus(platz1Lahm, '1h')
    p('Precision wird je Lauf gerechnet, nicht über gemischte Läufe',
        Math.abs(d.precision10 - 0.9) < 1e-9, String(d.precision10))

    const leer = werteAus([])
    p('ohne Daten kein Urteil', leer.urteil === 'zuWenig')
    p('offene und fehlgeschlagene werden gezählt',
        werteAus([z(1, 1, 0, 'offen'), z(2, 1, 0, 'fehlgeschlagen')]).offen === 1)
    p('unter MIN_LAEUFE kein Urteil',
        werteAus(gut.filter((x) => x.laufId < MIN_LAEUFE), '1h').urteil === 'zuWenig')
}

/*
 * ── Gegenprobe gegen ATR% allein ────────────────────────────────────────
 * Wenn die Bewegung hinterher genau der ATR% folgt, leistet die Note nichts,
 * was nicht schon die ATR% allein leistete — auch wenn sie „trägt".
 */
{
    // Spanne = ATR% — und die Note ordnet genauso wie die ATR%.
    const gleich = reihe(8, (l) => {
        const atr = (rang) => 30 - rang * 0.3
        return lauf(l + 1, reihe(10, (i) => atr(i + 1)), reihe(10, (i) => atr(60 + i)), atr)
    }).flat()
    const a = werteAus(gleich, '1h')
    p('ATR-Korrelation wird gerechnet', a.atrKorrelation !== null && a.atrKorrelation > 0.9, String(a.atrKorrelation))
    p('ohne Vorsprung vor ATR% sagt das Urteil es',
        a.urteil === 'nichtBesserAlsAtr', a.urteil)

    // Note sortiert richtig, ATR% sortiert verkehrt herum — echter Mehrwert.
    const besser = reihe(8, (l) => {
        const atr = (rang) => rang * 0.3
        return lauf(l + 1, reihe(10, (i) => 6 - i * 0.2), reihe(10, (i) => 1 - i * 0.05), atr)
    }).flat()
    const b = werteAus(besser, '1h')
    p('Mehrwert gegenüber ATR% wird erkannt', b.mehrwertGegenAtr > 0 && b.urteil === 'traegt',
        `${b.mehrwertGegenAtr} ${b.urteil}`)
}

// ── Ein Lauf im Detail ──────────────────────────────────────────────────
{
    const l = werteLaufAus(lauf(7, reihe(10, () => 3), reihe(4, () => 1)), '1h')
    p('zu kleine Kontrollgruppe ergibt keinen Abstand', l.abstand === null)
    p('Lauf-Id wird mitgegeben', l.laufId === 7)
}

/*
 * ── Hype-Radar ──────────────────────────────────────────────────────────
 * Andere Frage: lebt der Fund noch? Drei Gruppen.
 */
{
    const h = (gruppe, lebt, rendite, extra = {}) => ({
        status: 'gemessen', gruppe, nochHandelbar: lebt, renditePct: rendite,
        liquiditaetStart: 100000, liquiditaetEnde: lebt ? 120000 : 0, ...extra,
    })
    const zeilen = [
        ...reihe(12, (i) => h('spitze', i < 9 ? 1 : 0, i < 6 ? 40 : -50)),
        ...reihe(10, (i) => h('verworfen', i < 2 ? 1 : 0, -90)),
        ...reihe(10, (i) => h('feld', i < 5 ? 1 : 0, -20)),
    ]
    const a = werteAusHype(zeilen, '7d')
    p('Überlebensquote der Spitze', Math.abs(a.spitze.ueberlebt - 0.75) < 1e-9, String(a.spitze.ueberlebt))
    p('Überlebensquote der Verworfenen', Math.abs(a.verworfen.ueberlebt - 0.2) < 1e-9)
    p('Liquiditätsänderung in Prozent', a.spitze.medianLiquiditaetAenderung === 20)
    p('Urteil nennt den Filter', a.urteil.includes('filterWirkt'), String(a.urteil))
    p('Urteil nennt die Note', a.urteil.includes('noteWirkt'), String(a.urteil))
    p('ohne Gruppe gilt Spitze (Altbestand)', werteAusHype([h(undefined, 1, 5)]).spitze.n === 1)
    p('zu wenige Messungen', werteAusHype([]).urteil[0] === 'zuWenig')
}

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
