/**
 * Selbsttest der Pionex-Kontraktdaten — gegen ECHTE, aufgezeichnete Antworten.
 *
 *   node server/execution/__selftest-pionex-meta.mjs
 *
 * Anders als die uebrigen Tests prueft dieser nicht Arithmetik, sondern das
 * VERSTAENDNIS einer fremden Antwort. Die Fixtures unter `server/fixtures/`
 * stammen aus einem echten Abruf (14.09.2026, `scripts/pionex-probe.mjs`) —
 * genau die Sorte Test, die im Projekt schon einmal eine monatelang
 * unbemerkte Luecke gefunden hat (GoPlus `lp_holders`).
 *
 * Der teuerste Einzelfall steht im Abschnitt „Einheit": BTC hat eine Stufe mit
 * `maxLeverage 1` und `maintMarginRatio 0.5`. Das sind 50 % Wartungsmarge und
 * sieht zugleich aus wie eine Prozentzahl. Wer das falsch deutet, liegt um
 * Faktor 100 daneben — und das Margen-Netz waere eine Zahl ohne Deckung.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { meteAus, stufenAus, deuteEinheit, deuteMmr } from './pionex-meta.js'
import { hebelHaltbar } from '../../shared/liquidation.js'

const hier = path.dirname(fileURLToPath(import.meta.url))
const fixDir = path.join(hier, '..', 'fixtures')

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
function lies(datei) {
    try { return JSON.parse(fs.readFileSync(path.join(fixDir, datei), 'utf8')) } catch { return null }
}

console.log('\nKontraktdaten aus der echten Symbolliste\n')
{
    const roh = lies('pionex-symbols-perp.json')
    const liste = roh?.data?.symbols || []
    check('Fixture vorhanden', liste.length > 0,
        'server/fixtures/pionex-symbols-perp.json fehlt — scripts/pionex-probe.mjs laufen lassen')

    if (liste.length) {
        const e = liste[0]
        // Die Felder, auf die sich der Order-Pfad verlaesst. Verschwindet eines,
        // rechnet der Code mit 0 weiter statt zu scheitern — deshalb hier.
        for (const feld of ['symbol', 'baseStep', 'quoteStep', 'minSizeLimit',
            'maxSizeLimit', 'minSizeMarket', 'maxSizeMarket', 'minNotional', 'status']) {
            check(`Feld ${feld} existiert`, e[feld] !== undefined, JSON.stringify(Object.keys(e)))
        }

        const m = meteAus(e)
        check('Uebersetzung in die Feldnamen der Risk-Engine',
            m.stepSize > 0 && m.tickSize > 0 && m.minQty > 0)
        check('Werte sind Zahlen, keine Strings',
            typeof m.stepSize === 'number' && typeof m.minNotional === 'number')

        /*
         * Pionex fuehrt GETRENNTE Grenzen fuer Limit- und Marktorders. Der
         * Einstieg geht als MARKET_QTY raus — gemessen ist `maxSizeMarket` bei
         * BTC ein Fuenftel von `maxSizeLimit`. Wer die Limit-Werte nimmt, baut
         * eine Order, die die Boerse ablehnt.
         */
        check('maxQty kommt von der MARKT-Grenze, nicht von der Limit-Grenze',
            m.maxQty === Number(e.maxSizeMarket), `${m.maxQty} vs ${e.maxSizeMarket}`)
        check('die Limit-Grenzen bleiben getrennt verfuegbar (fuer die Ziel-Order)',
            m.maxQtyLimit === Number(e.maxSizeLimit))
        check('sie sind wirklich verschieden (sonst prueft das hier nichts)',
            Number(e.maxSizeMarket) !== Number(e.maxSizeLimit),
            `beide ${e.maxSizeMarket} — Fixture mit anderem Symbol pruefen`)

        check('status TRADING heisst handelbar', m.handelbar === (e.status === 'TRADING'))
        check('kaputte Eintraege → null', meteAus(null) === null && meteAus({}) === null)
    }
}

console.log('\nEinheit der Wartungsmarge — der Faktor-100-Fall\n')
{
    const roh = lies('pionex-risktable.json')
    const eintrag = roh?.data?.symbols?.[0]
    check('Fixture vorhanden und in der erwarteten Huelle (data.symbols[].rows)',
        Array.isArray(eintrag?.rows) && eintrag.rows.length > 0,
        'server/fixtures/pionex-risktable.json fehlt oder hat eine andere Struktur')

    if (eintrag?.rows?.length) {
        check('Einheit wird als BRUCH erkannt', deuteEinheit(eintrag.rows) === 1)

        const stufen = stufenAus(eintrag)
        check('alle Stufen uebernommen', stufen.length === eintrag.rows.length,
            `${stufen.length} von ${eintrag.rows.length}`)
        check('aufsteigend nach Nominalgrenze sortiert',
            stufen.every((s, i) => i === 0 || s.notionalLimit >= stufen[i - 1].notionalLimit))

        /*
         * DIE Pruefung. Die unterste Stufe hat maxLeverage 1 und mmr 0.5.
         * Eine Deutung als Prozent machte daraus 0.005 — und der
         * Liquidationspreis laege voellig woanders.
         */
        const ohneHebel = stufen.find((s) => s.maxLeverage === 1)
        if (ohneHebel) {
            check('Stufe mit Hebel 1: mmr bleibt 0,5 (50 %), wird nicht zu 0,005',
                Math.abs(ohneHebel.mmr - 0.5) < 1e-9, String(ohneHebel.mmr))
        }

        // Jede Stufe muss in sich haltbar sein: sonst waere sie im Moment der
        // Eroeffnung schon liquidiert, und die Boerse koennte sie nicht anbieten.
        const unhaltbar = stufen.filter((s) => s.maxLeverage > 0 && !hebelHaltbar(s.maxLeverage, s.mmr))
        check('jede Stufe ist mit ihrem eigenen Hoechsthebel haltbar',
            unhaltbar.length === 0, JSON.stringify(unhaltbar))

        // Die erste Stufe ist die, mit der real gehandelt wird.
        const erste = stufen[0]
        check('erste Stufe liegt in einer plausiblen Groessenordnung (0,1–5 %)',
            erste.mmr >= 0.001 && erste.mmr <= 0.05, String(erste.mmr))
    }
}

console.log('\nEinheiten-Deutung, konstruierte Faelle\n')
{
    // Prozent-Tabelle: dieselben Verhaeltnisse, Faktor 100 groesser.
    const prozent = [
        { maxLeverage: 100, maintMarginRatio: 0.5 },
        { maxLeverage: 50, maintMarginRatio: 1 },
        { maxLeverage: 1, maintMarginRatio: 50 },
    ]
    check('Prozent-Tabelle wird als Prozent erkannt', deuteEinheit(prozent) === 0.01)
    check('...und korrekt umgerechnet',
        Math.abs(stufenAus({ rows: prozent })[0].mmr - 0.005) < 1e-9)

    const bruch = [
        { maxLeverage: 100, maintMarginRatio: 0.005 },
        { maxLeverage: 50, maintMarginRatio: 0.01 },
    ]
    check('Bruch-Tabelle wird als Bruch erkannt', deuteEinheit(bruch) === 1)

    // Nichts Plausibles → KEINE Stufen. Geratene Wartungsmargen sind
    // schlimmer als gar keine: der Aufrufer lehnt dann wenigstens ab.
    check('unplausible Tabelle liefert keine Einheit',
        deuteEinheit([{ maxLeverage: 10, maintMarginRatio: 500 }]) === null)
    check('...und damit keine Stufen',
        stufenAus({ rows: [{ maxLeverage: 10, maintMarginRatio: 500 }] }).length === 0)
    check('leere Tabelle → keine Stufen', stufenAus({ rows: [] }).length === 0 && deuteEinheit([]) === null)
    check('kaputte Eingabe faellt nicht um', stufenAus(null).length === 0)
}

console.log('\ndeuteMmr (Einzelwert, ohne Tabellenkontext)\n')
{
    check('klarer Bruch bei passendem Hebel', deuteMmr(0.005, 100) === 0.005)
    check('klares Prozent bei passendem Hebel', deuteMmr(4, 10) === 0.04)
    check('ohne Hebel bleibt der Graubereich unbeantwortet', deuteMmr(0.5, 0) === null)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
