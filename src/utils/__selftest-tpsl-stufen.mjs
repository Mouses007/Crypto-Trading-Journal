/**
 * Selbsttest: Stop-/Zielverlauf als Stufen (src/utils/chart/tpslStufen.js).
 *
 *   node src/utils/__selftest-tpsl-stufen.mjs
 *
 * Die Fälle haben die Form echter Bitunix-Einträge (tpslHistory, 18.10.2026).
 */
import { tpslStufen } from './chart/tpslStufen.js'

let bestanden = 0
let fehlgeschlagen = 0
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const H = 3_600_000

{
    // Gesetzt vor dem Einstieg, einmal nachgezogen, dann entfernt.
    const v = [
        { t: 0, art: 'SL', aktion: 'set', alt: null, wert: 0.104 },
        { t: 5 * H, art: 'SL', aktion: 'moved', alt: 0.104, wert: 0.10459 },
        { t: 8 * H, art: 'SL', aktion: 'removed', alt: 0.10459, wert: null },
    ]
    const { stufen } = tpslStufen(v, 2 * H, 10 * H)
    check('vor dem Einstieg gesetzt → beginnt am Einstieg', stufen[0]?.von === 2 * H && stufen[0].preis === 0.104, JSON.stringify(stufen))
    check('nachgezogen → zweite Stufe 5h–8h', stufen[1]?.von === 5 * H && stufen[1].bis === 8 * H && stufen[1].preis === 0.10459)
    check('entfernt → danach keine Stufe', stufen.length === 2)
}
{
    // SL und TP zugleich gesetzt, beide verschoben; offen bis jetzt.
    const v = [
        { t: 0, art: 'SL', aktion: 'set', wert: 0.1241, menge: 946, posMenge: 946 },
        { t: 0, art: 'TP', aktion: 'set', wert: 0.08412, menge: 946, posMenge: 946 },
        { t: 3 * H, art: 'SL', aktion: 'moved', alt: 0.1241, wert: 0.11887, menge: 946, posMenge: 946 },
        { t: 3 * H, art: 'TP', aktion: 'moved', alt: 0.08412, wert: 0.10092, menge: 946, posMenge: 946 },
    ]
    const { stufen } = tpslStufen(v, 0, 6 * H)
    const sl = stufen.filter((s) => s.art === 'SL'), tp = stufen.filter((s) => s.art === 'TP')
    check('je zwei Stufen für SL und TP', sl.length === 2 && tp.length === 2, JSON.stringify(stufen))
    check('letzte Stufe reicht bis jetzt', sl[1].bis === 6 * H && tp[1].bis === 6 * H)
    check('volle Menge → kein Anteil', tp[0].anteil === null)
}
{
    // Teil-TP über die halbe Position, Stop ausgelöst.
    const v = [
        { t: 0, art: 'SL', aktion: 'set', wert: 64400, menge: 0.0443, posMenge: 0.0443 },
        { t: 0, art: 'TP', aktion: 'set', wert: 63250.4, menge: 0.0221, posMenge: 0.0443 },
        { t: 2 * H, art: 'SL', aktion: 'triggered', alt: 64400, wert: null },
        { t: 2 * H, art: 'TP', aktion: 'removed', alt: 63250.4, wert: null },
    ]
    const { stufen, ausgeloest } = tpslStufen(v, 0, 2 * H)
    check('Teil-TP trägt seinen Anteil (≈ 50 %)', Math.abs(stufen.find((s) => s.art === 'TP').anteil - 0.4989) < 0.001, JSON.stringify(stufen))
    check('ausgelöster Stop als Marke am alten Preis', ausgeloest.length === 1 && ausgeloest[0].preis === 64400 && ausgeloest[0].t === 2 * H)
}
{
    // Erster Eintrag ist „moved": der alte Wert galt schon ab dem Einstieg.
    const v = [{ t: 4 * H, art: 'SL', aktion: 'moved', alt: 100, wert: 105 }]
    const { stufen } = tpslStufen(v, 1 * H, 9 * H)
    check('moved zuerst → alter Wert ab Einstieg, neuer ab Änderung', stufen.length === 2 && stufen[0].preis === 100 && stufen[0].von === H && stufen[1].preis === 105, JSON.stringify(stufen))
}
{
    check('Änderungen nach dem Ausstieg zählen nicht', tpslStufen([{ t: 0, art: 'SL', aktion: 'set', wert: 1 }, { t: 9 * H, art: 'SL', aktion: 'moved', alt: 1, wert: 2 }], 0, 5 * H).stufen.length === 1)
    check('leerer Verlauf / ungültiges Fenster → nichts', tpslStufen([], 0, H).stufen.length === 0 && tpslStufen([{ t: 0, art: 'SL', aktion: 'set', wert: 1 }], H, H).stufen.length === 0)
}

{
    // 19.10.2026, BTCUSDT: Teil-TP 0.0229 von 0.0302 löst über Nacht aus, die Seite war zu → „removed" mit posQty 0.0073.
    const v = [
        { t: 0, art: 'SL', aktion: 'set', wert: 80350, menge: 0.0302, posMenge: 0.0302 },
        { t: H, art: 'TP', aktion: 'set', wert: 82248.9, menge: 0.0229, posMenge: 0.0302 },
        { t: 9 * H, art: 'TP', aktion: 'removed', alt: 82248.9, wert: null, menge: 0, posMenge: 0.0073 },
    ]
    const { ausgeloest } = tpslStufen(v, 0, 12 * H)
    check('removed + Position um die TP-Menge kleiner → als ausgelöst gezählt', ausgeloest.length === 1 && ausgeloest[0].art === 'TP' && ausgeloest[0].preis === 82248.9, JSON.stringify(ausgeloest))
    const w = [v[0], v[1], { ...v[2], posMenge: 0.0302 }]
    check('Gegenprobe: removed ohne Mengenänderung bleibt entfernt', tpslStufen(w, 0, 12 * H).ausgeloest.length === 0)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) process.exit(1)
