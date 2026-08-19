/**
 * Selbsttest: die reinen Teile der KI-Einordnung.
 *
 * Ohne Netz, ohne Datenbank, ohne Modell. Geprüft wird das, was auch ohne
 * Modell falsch sein kann: die Verdichtung der Zahlen zum Anstoss und die
 * Annahme der Antwort. Der zweite Punkt ist der wichtigere — die Seite sagt
 * ausdrücklich nichts über die Richtung, und ein Modell, das trotzdem eine
 * Prognose liefert, würde genau diese Zusage brechen.
 *
 * Aufruf: node server/coin-radar/__selftest-einordnung.mjs
 */
import { baueEinordnungsBasis, pruefeEinordnung } from './einordnung.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Coin-Radar: Einordnung')

const zeile = (o) => ({
    status: 'bewertet', symbol: 'AAAUSDT', rang: 1, note: 70,
    atrPct: 2, rvol: 3, adx: 30, fundingJahresRate: 10, ...o,
})

// ── Verdichtung ─────────────────────────────────────────────────────────
{
    const { kennzahlen } = baueEinordnungsBasis([
        zeile({ symbol: 'A', rang: 1, rvol: 3, adx: 30 }),
        zeile({ symbol: 'B', rang: 2, rvol: 1.2, adx: 15 }),
        zeile({ symbol: 'C', rang: 3, rvol: 2.0, adx: 25 }),
    ], { verworfen: 44 })

    p('bewertet gezählt', kennzahlen.bewertet === 3, `war ${kennzahlen.bewertet}`)
    p('verworfen durchgereicht', kennzahlen.verworfen === 44)
    // RVOL 2,0 zählt als „im Spiel" — die Schwelle ist inklusiv, sonst fiele
    // genau der Grenzfall unter den Tisch, den die Praxis als Schwelle nennt.
    p('im Spiel zählt Grenzfall mit', kennzahlen.imSpiel === 2, `war ${kennzahlen.imSpiel}`)
    p('trendend zählt ADX ≥ 25', kennzahlen.trendend === 2, `war ${kennzahlen.trendend}`)
    p('mittleres RVOL gemittelt', Math.abs(kennzahlen.mittelRvol - 2.0667) < 0.01)
}

{
    // Hürden-Zeilen dürfen die Mittelwerte nicht verwässern.
    const { kennzahlen } = baueEinordnungsBasis([
        zeile({ symbol: 'A', atrPct: 4 }),
        { status: 'huerde', symbol: 'Z', atrPct: 0, rvol: 0, adx: 0 },
    ])
    p('Hürden-Zeilen zählen nicht mit', kennzahlen.bewertet === 1 && kennzahlen.mittelAtrPct === 4,
        `bewertet=${kennzahlen.bewertet} atr=${kennzahlen.mittelAtrPct}`)
}

{
    // Ein leerer Lauf darf keine Division durch null erzeugen.
    const { zeilen, kennzahlen } = baueEinordnungsBasis([], {})
    p('leerer Lauf ohne NaN', kennzahlen.mittelAtrPct === null && kennzahlen.mittelRvol === null)
    p('leerer Lauf liefert trotzdem Zeilen', Array.isArray(zeilen) && zeilen.length > 0)
    p('leerer Lauf schreibt kein NaN in den Text', !zeilen.join('\n').includes('NaN'))
}

{
    const { zeilen } = baueEinordnungsBasis(
        Array.from({ length: 30 }, (_, i) => zeile({ symbol: `S${i}`, rang: i + 1 })), {})
    const genannt = zeilen.filter((z) => /^\s+\d+\.\s/.test(z))
    p('höchstens zehn Symbole im Anstoss', genannt.length === 10, `waren ${genannt.length}`)
    p('und zwar die obersten', genannt[0].includes('S0') && genannt[9].includes('S9'))
}

{
    const ohne = baueEinordnungsBasis([zeile({})], {}).zeilen.join('\n')
    const mit = baueEinordnungsBasis([zeile({})], { rangkorrelation: 0.42, gemeinsam: 88 }).zeilen.join('\n')
    p('Rangkorrelation nur wenn vorhanden', !ohne.includes('Rangkorrelation'))
    p('Rangkorrelation erscheint im Anstoss', mit.includes('0.42') && mit.includes('88'))
}

// ── Annahme der Antwort ─────────────────────────────────────────────────
{
    const gut = pruefeEinordnung({ text: 'Die Bewegung ist breit, 40 von 120 Coins liegen über RVOL 2.' })
    p('sachliche Antwort angenommen', gut.ok && gut.text.startsWith('Die Bewegung'))

    p('leere Antwort abgelehnt', !pruefeEinordnung({ text: '   ' }).ok)
    p('fehlende Antwort abgelehnt', !pruefeEinordnung(null).ok)
    p('Alternativfeld akzeptiert', pruefeEinordnung({ einordnung: 'Ruhiger Markt, wenig Umsatz.' }).ok)

    for (const satz of [
        'BTC dürfte weiter steigen.',
        'Kursziel 80 000 Dollar.',
        'Voraussichtlich bleibt es ruhig.',
        'Der Markt wird wohl weiter fallen.',
    ]) {
        const u = pruefeEinordnung({ text: satz })
        p(`Prognose abgelehnt: „${satz}"`, !u.ok && u.grund === 'prognose', u.grund)
    }

    for (const satz of [
        'Hier lohnt es sich, ETH zu kaufen.',
        'Bei SOL würde ich long gehen.',
        'In diese Lage sollte man einsteigen.',
    ]) {
        const u = pruefeEinordnung({ text: satz })
        p(`Empfehlung abgelehnt: „${satz}"`, !u.ok && u.grund === 'empfehlung', u.grund)
    }

    /*
     * Die andere Richtung, und sie ist die teurere: Der erste Wächter verwarf
     * jedes „steigen" und „fallen" — und traf damit ganz gewöhnliche
     * Beschreibungen. Ein bezahlter, völlig sachlicher Absatz verschwand
     * wortlos. Diese Sätze MÜSSEN durchkommen.
     */
    for (const satz of [
        'In diese Gruppe fallen 20 Coins.',
        'Auffallend ist das hohe Volumen bei BTC.',
        'Steigende Trendstärke bei drei Werten.',
        'Zwölf Coins fallen unter die Umsatzschwelle.',
        'Das Kauf-Verkaufs-Verhältnis liegt bei 1,2.',
        'Die Bewegung hat gegenüber gestern nachgelassen.',
    ]) {
        const u = pruefeEinordnung({ text: satz })
        p(`sachliche Beschreibung kommt durch: „${satz}"`, u.ok, u.grund)
    }

    const lang = pruefeEinordnung({ text: 'Ruhig. '.repeat(400) })
    p('zu lange Antwort gekürzt statt verworfen', lang.ok && lang.text.length <= 1201 && lang.grund === 'gekürzt')
}

console.log(`\n${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
