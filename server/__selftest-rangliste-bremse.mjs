/**
 * Selbsttest der Binance-Gewichtsbremse.
 *
 *   node server/__selftest-rangliste-bremse.mjs
 *
 * Was hier schiefgeht, merkt man nicht am Laborlauf, sondern erst Tage später
 * an verpassten Live-Einstiegen: die Strategie-Engine teilt sich die IP mit der
 * Rangliste, und wenn das Gewichtsbudget leerläuft, bekommt SIE die 429er.
 *
 * Uhr und Warteschlaf werden eingespeist — der Test dauert Millisekunden statt
 * Minuten und prüft die WARTEZEITEN, nicht das Warten selbst.
 */

import {
    warteAufGewicht, notiereGewicht, melde429, istWiederholbar,
    eigenerVerbrauch, gemeldeterVerbrauch, pausiertBis,
    _setzeUhr, _zuruecksetzen,
    EIGEN_DECKEL, FREMD_GRENZE, GEWICHT_KLINES, WIEDERHOLUNGEN,
} from './binance-takt.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ── Gefälschte Uhr: Zeit vergeht nur, wenn jemand wartet ─────────────────
let uhr = 1000000
let geschlafen = []
function neueUmgebung() {
    uhr = 1000000
    geschlafen = []
    _setzeUhr(() => uhr, async (ms) => { geschlafen.push(ms); uhr += ms })
    _zuruecksetzen()
}

console.log('\nBinance-Gewichtsbremse — Selbsttest\n')

// ── Der Deckel hält ──────────────────────────────────────────────────────
console.log('Eigener Deckel')
{
    neueUmgebung()
    const erlaubt = Math.floor(EIGEN_DECKEL / GEWICHT_KLINES)
    let hoechster = 0
    for (let i = 0; i < erlaubt * 3; i++) {
        await warteAufGewicht()
        hoechster = Math.max(hoechster, eigenerVerbrauch())
    }
    check(`${erlaubt * 3} Abrufe überschreiten den Deckel von ${EIGEN_DECKEL} nie`,
        hoechster <= EIGEN_DECKEL, `höchster Stand ${hoechster}`)
    check('dafür musste gewartet werden', geschlafen.length > 0, `${geschlafen.length} Pausen`)
    check('die ersten Abrufe liefen ohne Pause durch',
        geschlafen.length < erlaubt * 3, `${geschlafen.length} Pausen bei ${erlaubt * 3} Abrufen`)
}

// ── Das Minutenfenster läuft ab ──────────────────────────────────────────
console.log('\nMinutenfenster')
{
    neueUmgebung()
    for (let i = 0; i < 10; i++) await warteAufGewicht()
    check('zehn Abrufe stehen im Fenster', eigenerVerbrauch() === 10 * GEWICHT_KLINES,
        String(eigenerVerbrauch()))
    uhr += 61000
    check('nach einer Minute ist das Fenster leer', eigenerVerbrauch() === 0,
        String(eigenerVerbrauch()))
}

// ── Fremdverbrauch: die Rangliste tritt zurück ───────────────────────────
console.log('\nFremdverbrauch (der Livebetrieb hat Vorrang)')
{
    neueUmgebung()
    notiereGewicht({ 'x-mbx-used-weight-1m': String(FREMD_GRENZE + 100) })
    check('der gemeldete Gesamtverbrauch wird übernommen',
        gemeldeterVerbrauch() === FREMD_GRENZE + 100, String(gemeldeterVerbrauch()))

    // Der nächste Abruf muss warten — im Test läuft die Uhr dabei weiter, und
    // nach einer Minute veraltet die Meldung, also kommt er irgendwann durch.
    await warteAufGewicht()
    check('bei hoher IP-Last wird gewartet, statt weiterzurennen',
        geschlafen.length > 0, `${geschlafen.length} Pausen`)

    neueUmgebung()
    notiereGewicht({ 'x-mbx-used-weight-1m': '200' })
    await warteAufGewicht()
    check('bei niedriger Last läuft es ohne Pause durch', geschlafen.length === 0,
        JSON.stringify(geschlafen))

    // Eine Meldung von vor über einer Minute ist keine Aussage über jetzt.
    neueUmgebung()
    notiereGewicht({ 'x-mbx-used-weight-1m': '2000' })
    uhr += 61000
    check('eine veraltete Meldung wird nicht mehr geglaubt', gemeldeterVerbrauch() === 0,
        String(gemeldeterVerbrauch()))

    // Kopf-Objekte kommen mal als Map, mal als schlichtes Objekt
    neueUmgebung()
    notiereGewicht(new Map([['x-mbx-used-weight-1m', '500']]))
    check('Header als Map werden auch gelesen', gemeldeterVerbrauch() === 500,
        String(gemeldeterVerbrauch()))
    notiereGewicht(null)
    check('fehlende Header kippen nicht um', gemeldeterVerbrauch() === 500)
}

// ── Strafen ──────────────────────────────────────────────────────────────
console.log('\nStrafen von Binance')
{
    neueUmgebung()
    const mitKopf = melde429(429, { 'retry-after': '5' })
    check('429 mit Retry-After wartet genau diese 5 s', mitKopf === 5000, String(mitKopf))

    neueUmgebung()
    check('429 ohne Retry-After wartet 30 s', melde429(429, {}) === 30000)

    neueUmgebung()
    check('418 (Bann) wartet 5 Minuten', melde429(418, {}) === 5 * 60000)

    neueUmgebung()
    melde429(429, { 'retry-after': '5' })
    check('während der Strafe steht eine Sperrzeit', pausiertBis() > uhr)
    await warteAufGewicht()
    check('der nächste Abruf verschläft die Strafe',
        geschlafen.reduce((s, x) => s + x, 0) >= 5000,
        JSON.stringify(geschlafen))
    check('danach ist die Sperre vorbei', pausiertBis() === 0)
}

// ── Wiederholbarkeit ─────────────────────────────────────────────────────
console.log('\nWiederholen — und wann nicht')
{
    // Der wichtigste Fall: ein Symbol, das Binance nicht kennt. Dreimal zu
    // fragen ändert daran nichts, und 99 andere Coins warten darauf, dass
    // dieser eine aufgibt.
    check('400 (unbekanntes Symbol) wird NICHT wiederholt', istWiederholbar(400) === false)
    check('404 wird nicht wiederholt', istWiederholbar(404) === false)
    check('401/403 werden nicht wiederholt',
        istWiederholbar(401) === false && istWiederholbar(403) === false)
    check('503 wird wiederholt', istWiederholbar(503) === true)
    check('ein Netzfehler ohne Status wird wiederholt', istWiederholbar(undefined) === true)
    check('die Wartezeiten steigen: 1 s, 4 s, 16 s',
        WIEDERHOLUNGEN.join(',') === '1000,4000,16000', WIEDERHOLUNGEN.join(','))
}

// ── Kein Deckel ohne Ausweg ──────────────────────────────────────────────
console.log('\nRobustheit')
{
    neueUmgebung()
    // Dauerhafte Fremdlast: die Bremse darf nicht ewig hängen, sondern muss
    // irgendwann aufgeben — sonst blockiert ein Lauf für immer.
    let geworfen = false
    _setzeUhr(() => uhr, async (ms) => {
        geschlafen.push(ms)
        uhr += ms
        // Die Meldung wird ständig erneuert: die IP bleibt heiss
        notiereGewicht({ 'x-mbx-used-weight-1m': String(FREMD_GRENZE + 500) })
    })
    notiereGewicht({ 'x-mbx-used-weight-1m': String(FREMD_GRENZE + 500) })
    try { await warteAufGewicht() } catch (e) { geworfen = true }
    check('bei dauerhafter Fremdlast wird nach endlicher Zeit aufgegeben', geworfen)
}

// Uhr zurückgeben, damit ein nachfolgender Import die echte benutzt
_setzeUhr(null, null)
_zuruecksetzen()

// ── Die Regeln werden auch WIRKLICH angewendet ───────────────────────────
//
// `istWiederholbar` und `WIEDERHOLUNGEN` waren zwei Tage lang exportiert,
// getestet — und nirgends benutzt. Der Test oben prüfte die Regel isoliert und
// gab damit falsche Sicherheit: in Wirklichkeit schrieb ein einziger
// 10-Sekunden-Zeitüberschritt einen Coin sofort als Fehler ab. Diese Prüfung
// sichert die VERDRAHTUNG, nicht die Regel.
console.log('\nVerdrahtung im Abrufpfad')
{
    const quelle = await import('node:fs').then((fs) => fs.readFileSync('server/market-data.js', 'utf8'))
    check('getHistoricalCandles wiederholt fehlgeschlagene Seiten',
        /mitWiederholung\(/.test(quelle), 'kein Aufruf von mitWiederholung gefunden')
    check('die Wiederholung nutzt die hiesige Regel',
        /istWiederholbar\(status\)/.test(quelle))
    check('sie nutzt die hiesigen Wartezeiten',
        /WIEDERHOLUNGEN\[versuch\]/.test(quelle))
    check('vor jedem Historienabruf wird angestanden',
        /await warteAufGewicht\(\)/.test(quelle))
    check('jeder Abruf meldet sein Gewicht zurück',
        /notiereGewicht\(antwort\.headers\)/.test(quelle))
    // Genau abgrenzen statt mit einem Fenster raten: der erste Versuch suchte
    // „warteAufGewicht irgendwo nach getClosedCandles" und schlug an, weil die
    // NÄCHSTE Funktion es enthält. Ein Test, der über Funktionsgrenzen hinweg
    // sucht, meldet Fehler, die es nicht gibt.
    const livePfad = quelle.slice(
        quelle.indexOf('export async function getClosedCandles'),
        quelle.indexOf('async function mitWiederholung'),
    )
    check('der Livepfad (getClosedCandles) bleibt ungebremst',
        livePfad.length > 500 && !livePfad.includes('warteAufGewicht'),
        `${livePfad.length} Zeichen abgegrenzt`)
}

console.log(`\n${fehlgeschlagen === 0 ? '\x1b[32m' : '\x1b[31m'}${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen\x1b[0m`)
if (fehlgeschlagen) { console.log('Fehlgeschlagen:'); for (const f of fehler) console.log(`  · ${f}`) }
process.exit(fehlgeschlagen ? 1 : 0)
