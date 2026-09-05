/**
 * Selbsttest: der Schalter `kiEmpfehlungenAn`.
 *
 * Ein globaler Schalter, drei Prompts an drei Orten — das ist genau die
 * Anordnung, bei der einer davon beim nächsten Umbau vergessen wird. Deshalb
 * stehen sie hier zusammen und nicht je in ihrer eigenen Testdatei.
 *
 * Zwei Dinge sind wichtiger als die Frage, ob das Verbot verschwindet:
 *
 *   1. WOHIN die erlaubte Aussage soll. Die Antwortschemata haben KEIN Feld
 *      für Kursziele — `normalisiereHandelslage` und `normalisiereAntwort`
 *      werfen weg, was sie nicht kennen. Sagt der Prompt nicht, dass solche
 *      Aussagen in `text`/`bedingungen`/`punkte` gehören, landet die erlaubte
 *      Empfehlung in einem erfundenen Feld und verschwindet stillschweigend:
 *      Der Leser hat den Schalter umgelegt, und nichts ändert sich.
 *
 *   2. Was NICHT mitschaltet. „Erfinde nie eine Zahl" und die BESCHREIBUNGEN
 *      der Messwerte (was ein Liquidations-Cluster ist, was ein
 *      Bewegungsvorrat über 100 % bedeutet) sind keine Verbote, sondern
 *      Erklärungen der Zahl. Fielen sie mit weg, ratet das Modell — und dann
 *      steht die Richtungsaussage da, ohne dass jemand sie erlaubt hat.
 *      Im Kopf von `handelsbild.js` ist genau dieser Fall als passiert
 *      dokumentiert.
 *
 * Aufruf: node server/__selftest-ki-empfehlungen.mjs
 */
import { bauLagePrompt, bauAnweisungPruefPrompt } from './marktradar-news.js'
import { baueSystem as baueHandelsSystem } from './handelslage.js'
import { baueSystem as baueLageSystem } from './marktradar-lage.js'

let ok = 0, fehler = 0
const check = (name, bedingung, zusatz = '') => {
    if (bedingung) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? `\n      ${zusatz}` : ''}`) }
}

console.log('\nHandelslage-Kachel (Live-Trading-Fenster)')
for (const [sprache, englisch] of [['deutsch', false], ['englisch', true]]) {
    const aus = baueHandelsSystem(englisch, false)
    const an = baueHandelsSystem(englisch, true)
    const verbot = englisch ? 'NO trading recommendation' : 'KEINE Handelsempfehlung'

    check(`${sprache}: Vorgabe verbietet Empfehlungen`, aus.includes(verbot))
    check(`${sprache}: eingeschaltet fällt das Verbot`, !an.includes(verbot), an.slice(0, 200))
    check(`${sprache}: eingeschaltet steht, WOHIN die Aussage gehört`,
        an.includes('"text"') && an.includes('"bedingungen"'),
        'ohne das verschwindet sie im Schema')

    // Was in BEIDEN Fassungen stehen bleiben muss.
    const erfinden = englisch ? 'Never invent a number' : 'Erfinde nie eine Zahl'
    check(`${sprache}: „nichts erfinden" gilt weiter`,
        aus.includes(erfinden) && an.includes(erfinden))
    const cluster = englisch ? 'NOT a directional signal' : 'KEIN Richtungssignal'
    check(`${sprache}: die Cluster-Erklärung bleibt`,
        aus.includes(cluster) && an.includes(cluster),
        'sie beschreibt die Zahl, sie verbietet nichts')
    const bedingungen = englisch ? 'Conditions ARE wanted' : 'Bedingungen sind ausdrücklich erwünscht'
    check(`${sprache}: Bedingungen bleiben erwünscht`,
        aus.includes(bedingungen) && an.includes(bedingungen))
}

console.log('\nGesamtlage-Kachel (Marktradar)')
for (const [sprache, englisch] of [['deutsch', false], ['englisch', true]]) {
    const aus = baueLageSystem(englisch, false)
    const an = baueLageSystem(englisch, true)
    const verbot = englisch ? 'NO trading recommendation' : 'KEINE Handelsempfehlung'

    check(`${sprache}: Vorgabe verbietet Empfehlungen`, aus.includes(verbot))
    check(`${sprache}: eingeschaltet fällt das Verbot`, !an.includes(verbot))
    check(`${sprache}: eingeschaltet steht, WOHIN die Aussage gehört`,
        an.includes('"text"') && an.includes('"punkte"'))

    const erfinden = englisch ? 'Never invent a number' : 'Erfinde nie eine Zahl'
    check(`${sprache}: „nichts erfinden" gilt weiter`,
        aus.includes(erfinden) && an.includes(erfinden))
    const widerspruch = englisch ? 'contradictions' : 'Widersprüche'
    check(`${sprache}: Widersprüche zu benennen bleibt der Auftrag`,
        aus.includes(widerspruch) && an.includes(widerspruch))
}

console.log('\nLagebericht (Nachrichten)')
{
    const aus = bauLagePrompt({ themen: ['crypto'] })
    const an = bauLagePrompt({ themen: ['crypto'], empfehlungen: true })
    check('Vorgabe verbietet Empfehlungen',
        aus.includes('Keine Handelsempfehlungen, keine Kursziele, keine Prognosen.'))
    check('eingeschaltet sind sie erlaubt', an.includes('sind ERLAUBT'))
    check('erlaubt verlangt Marke und Widerlegung', an.includes('was die Aussage widerlegt'))
    check('nichts Erfundenes gilt in beiden Fassungen',
        aus.includes('Nichts erfinden') && an.includes('Nichts erfinden'))

    /*
     * MIT eigenen Anweisungen — die Lücke, durch die der erste Anlauf fiel.
     *
     * `eigeneAnweisungen()` schreibt einen eigenen Block, und der beteuerte
     * unbedingt „keine Handelsempfehlungen, keine Kursziele, keine Prognosen",
     * auch wenn die REGELN oben sie gerade erlaubten. Zwei sich
     * widersprechende Sätze im selben Prompt — derselbe Bautyp, gegen den
     * dieser Schalter überhaupt angetreten ist. Der Selbsttest traf die Stelle
     * nicht, weil er ohne `zusatz` prüfte und der Block dann gar nicht
     * entsteht. Aufgefallen im Audit vom 05.09.2026.
     */
    const mitZusatz = bauLagePrompt({ themen: ['crypto'], empfehlungen: true, zusatz: 'Schreib knapper.' })
    check('mit eigenen Anweisungen kein widersprüchliches Verbot',
        !mitZusatz.includes('keine Handelsempfehlungen, keine Kursziele, keine Prognosen'),
        'der Anweisungsblock beteuert sonst das Gegenteil der REGELN')
    check('der Anweisungsblock steht überhaupt drin', mitZusatz.includes('EIGENE ANWEISUNGEN'))
    check('„nichts erfinden" bleibt auch dort unverrückbar', mitZusatz.includes('nichts\nerfinden'))
    // GEGENPROBE: ausgeschaltet MUSS das Verbot im Anweisungsblock stehen.
    const ausMitZusatz = bauLagePrompt({ themen: ['crypto'], zusatz: 'Schreib knapper.' })
    check('GEGENPROBE ausgeschaltet steht das Verbot im Anweisungsblock',
        ausMitZusatz.includes('keine Handelsempfehlungen, keine Kursziele, keine Prognosen'))

    // Die Anweisungsprüfung darf nicht „gegenregel" sagen zu etwas, das der
    // Leser per Einstellung erlaubt hat.
    check('Anweisungsprüfung zieht mit',
        bauAnweisungPruefPrompt({ themen: ['crypto'] }).includes('keine Handelsempfehlungen')
        && !bauAnweisungPruefPrompt({ themen: ['crypto'], empfehlungen: true }).includes('keine Handelsempfehlungen'))
}

console.log('\nDer Schalter wirkt überall gleich')
{
    // Ein globaler Schalter, der an einem der drei Orte nichts tut, ist die
    // schlimmste Variante: Der Leser sieht zwei Blöcke, die sich
    // widersprechen, und hält den dritten für kaputt.
    const orte = [
        ['Handelslage', baueHandelsSystem(false, false), baueHandelsSystem(false, true)],
        ['Gesamtlage', baueLageSystem(false, false), baueLageSystem(false, true)],
        ['Lagebericht', bauLagePrompt({ themen: ['crypto'] }),
            bauLagePrompt({ themen: ['crypto'], empfehlungen: true })],
    ]
    for (const [name, aus, an] of orte) {
        check(`${name}: der Schalter ändert den Prompt überhaupt`, aus !== an)
        // Gross-/Kleinschreibung unterscheidet sich zwischen den Orten: die
        // Kacheln schreiben „KEINE Handelsempfehlung", der Bericht führt es als
        // Aufzählungspunkt („- Keine Handelsempfehlungen …").
        check(`${name}: ausgeschaltet ist der Bestandsfall`,
            /keine? Handelsempfehlung/i.test(aus), aus.slice(0, 120))
    }
}

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler ? 1 : 0)
