/**
 * Selbsttest des Starter-Decks (server/default-lernkarten.js).
 *
 * Prüft die STRUKTUR, nicht den Inhalt — Fachaussagen lassen sich nicht per
 * Test verifizieren, ein doppelter `schluessel` oder eine Kategorie, die die
 * Oberfläche nicht kennt, dagegen schon. Beides fällt sonst erst auf, wenn
 * eine Karte in `Lernen.vue` als leeres Label erscheint oder das Seeding an
 * der Unique-Bedingung `uq_quiz_karten_schluessel` scheitert.
 *
 *   node server/__selftest-lernkarten.mjs
 */
import { readFile } from 'node:fs/promises'
import { LERNKARTEN_DEFS } from './default-lernkarten.js'
import { BILDER, bildFuer, OTE } from './lernkarten-bilder.js'
import { BEISPIELE, beispielFuer, zeichneBeispiel } from './lernkarten-beispiele.js'

// Muss deckungsgleich zu KATEGORIEN in src/views/Lernen.vue sein — eine
// Kategorie ohne dortigen Eintrag hat auch keinen i18n-Schlüssel.
const KATEGORIEN = ['indikatoren', 'derivate', 'sentiment', 'chartAnalyse', 'risiko', 'markt', 'onchain']
// Muss deckungsgleich zu NIVEAUS in src/views/Lernen.vue sein — eine Karte
// mit unbekanntem Niveau ist über keinen Filter mehr erreichbar.
const NIVEAUS = [1, 2, 3]

let ok = 0, fehler = 0
function pruefe(name, bedingung, zusatz = '') {
    if (bedingung) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

console.log('\nStarter-Deck der Lernkarten')

const schluessel = LERNKARTEN_DEFS.map(k => k.schluessel)
const doppelt = [...new Set(schluessel.filter((s, i) => schluessel.indexOf(s) !== i))]
pruefe('Jeder schluessel kommt genau einmal vor', doppelt.length === 0, doppelt.join(', '))

const ohneSchluessel = LERNKARTEN_DEFS.filter(k => !k.schluessel || !/^[a-zA-Z0-9]+$/.test(k.schluessel))
pruefe('Jeder schluessel ist gesetzt und alphanumerisch', ohneSchluessel.length === 0,
    ohneSchluessel.map(k => k.frage?.slice(0, 40)).join(' | '))

const leer = LERNKARTEN_DEFS.filter(k => !k.frage?.trim() || !k.antwort?.trim())
pruefe('Keine Karte ohne Frage oder Antwort', leer.length === 0, leer.map(k => k.schluessel).join(', '))

const falscheKat = LERNKARTEN_DEFS.filter(k => !KATEGORIEN.includes(k.kategorie))
pruefe('Jede Kategorie ist der Oberfläche bekannt', falscheKat.length === 0,
    falscheKat.map(k => `${k.schluessel}:${k.kategorie}`).join(', '))

const falschesNiveau = LERNKARTEN_DEFS.filter(k => k.niveau !== undefined && !NIVEAUS.includes(k.niveau))
pruefe('Jedes gesetzte Niveau ist filterbar', falschesNiveau.length === 0,
    falschesNiveau.map(k => `${k.schluessel}:${k.niveau}`).join(', '))

// Eine Frage ohne Fragezeichen ist meist eine versehentlich vertauschte
// Frage/Antwort-Zuordnung — beim Lernen fällt das erst spät auf.
const ohneFrage = LERNKARTEN_DEFS.filter(k => !k.frage.includes('?'))
pruefe('Jede Frage ist als Frage formuliert', ohneFrage.length === 0, ohneFrage.map(k => k.schluessel).join(', '))

// Die Antwort steht auf einer Karteikarte mit fester Höhe (lernen-card-box):
// alles jenseits von rund 300 Zeichen läuft dort aus dem Rahmen.
const zuLang = LERNKARTEN_DEFS.filter(k => k.antwort.length > 300)
pruefe('Keine Antwort sprengt die Karteikarte (max. 300 Zeichen)', zuLang.length === 0,
    zuLang.map(k => `${k.schluessel}:${k.antwort.length}`).join(', '))

// Jedes angebotene Niveau soll Karten haben, sonst zeigt der Filter eine leere
// Seite. Absichtlich NICHT je Kategorie geprüft: `indikatoren` hat kein Niveau
// 2/3 und `onchain` kein Niveau 1, und das ist in Ordnung — gefiltert wird nur
// nach Niveau, nicht nach Niveau × Kategorie.
const besetzt = new Set(LERNKARTEN_DEFS.map(k => k.niveau || 1))
pruefe('Jedes Niveau ist mit Karten belegt', NIVEAUS.every(n => besetzt.has(n)),
    NIVEAUS.filter(n => !besetzt.has(n)).join(', '))

/*
 * Erklärungen — das Feld, das von v14 bis zum 05.09.2026 an drei Stellen
 * zugleich nicht verdrahtet war. Die letzte Prüfung ist die wichtigste: sie
 * liest den Quelltext von `seedDefaultLernkarten`, weil ein fehlendes
 * `erklaerung` dort keinen Fehler wirft, sondern einfach nichts tut — und
 * zwar nur bei bestehenden Installationen, also nirgends, wo man hinschaut.
 */
const mitErklaerung = LERNKARTEN_DEFS.filter(k => String(k.erklaerung || '').trim())

// Der Ausklappbereich verträgt mehr als die Karteikarte, aber keine Aufsätze.
const erklaerungZuLang = mitErklaerung.filter(k => k.erklaerung.length > 600)
pruefe('Keine Erklärung länger als 600 Zeichen', erklaerungZuLang.length === 0,
    erklaerungZuLang.map(k => `${k.schluessel}:${k.erklaerung.length}`).join(', '))

// Eine Erklärung, die mit der Antwort beginnt, erklärt nichts — sie wiederholt.
const nurWiederholung = mitErklaerung.filter(k => {
    const a = k.antwort.slice(0, 60).toLowerCase()
    return k.erklaerung.toLowerCase().startsWith(a)
})
pruefe('Keine Erklärung wiederholt bloss die Antwort', nurWiederholung.length === 0,
    nurWiederholung.map(k => k.schluessel).join(', '))

const seedQuelle = await readFile(new URL('./default-lernkarten.js', import.meta.url), 'utf8')
const seedKoerper = seedQuelle.slice(seedQuelle.indexOf('export async function seedDefaultLernkarten'))
pruefe('seedDefaultLernkarten schreibt erklaerung beim Anlegen UND beim Nachführen',
    (seedKoerper.match(/erklaerung/g) || []).length >= 2,
    'ohne beide Stellen erreichen Erklärungen nur Neuinstallationen')

/*
 * Jedes Feld, das der Nachführ-Abgleich VERGLEICHT, muss auch GELESEN werden.
 *
 * Steht ein Feld nur im `soll`, aber nicht im `.select(...)`, ist `row[feld]`
 * undefined, die Abbruchbedingung `every(...)` trifft nie zu, und jede
 * built-in Karte bekommt bei jedem Serverstart ein UPDATE — samt einer
 * Logzeile, die eine Änderung meldet, wo keine war. Genau so lief es zwischen
 * 5dc4b4d und dem Fix; der Fehler wirft nichts und fällt nur auf, wenn man
 * zweimal hintereinander startet und ins Log sieht.
 */
const auswahl = new Set((seedKoerper.match(/\.select\(([^)]*)\)/)?.[1] || '')
    .split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean))
const sollBlock = seedKoerper.slice(seedKoerper.indexOf('const soll = {'))
const sollFelder = [...sollBlock.slice(0, sollBlock.indexOf('\n        }')).matchAll(/^\s{12}(\w+):/gm)].map(m => m[1])
const ungelesen = sollFelder.filter(f => !auswahl.has(f))
pruefe('Jedes verglichene Feld wird auch gelesen (soll ⊆ select)',
    sollFelder.length > 0 && ungelesen.length === 0,
    sollFelder.length === 0 ? 'soll-Felder nicht erkannt' : 'fehlt im select: ' + ungelesen.join(', '))


/*
 * Skizzen zu den Strukturkarten.
 *
 * Die wichtigste Pruefung ist die erste: Ein Bild haengt ueber den
 * KARTENSCHLUESSEL an seiner Karte. Vertippt man sich dort, verschwindet die
 * Skizze lautlos -- die Karte funktioniert weiter, nur ohne Bild, und niemand
 * vermisst etwas, das er nie gesehen hat.
 */
{
    const schluessel = new Set(LERNKARTEN_DEFS.map(k => k.schluessel))
    const verwaist = Object.keys(BILDER).filter(k => !schluessel.has(k))
    pruefe('jede Skizze gehoert zu einer Karte', verwaist.length === 0, verwaist.join(', '))

    for (const [k, svg] of Object.entries(BILDER)) {
        pruefe(`${k}: ist ein SVG mit Namensraum`,
            svg.startsWith('<svg') && svg.includes('xmlns="http://www.w3.org/2000/svg"'))
        pruefe(`${k}: Tags gehen auf`,
            (svg.match(/</g) || []).length === (svg.match(/>/g) || []).length)
        /*
         * Nichts darf ueber den Rand hinausragen. Ein abgeschnittener Text ist
         * im Quelltext unsichtbar und faellt erst am Bild auf -- genau das ist
         * beim ersten Anlauf zweimal passiert.
         */
        const xWerte = [...svg.matchAll(/\b(?:x|x1|x2|cx)="(-?\d+(?:\.\d+)?)"/g)].map(m => Number(m[1]))
        pruefe(`${k}: nichts links ausserhalb`, xWerte.every(v => v >= 0), String(Math.min(...xWerte)))
        pruefe(`${k}: nichts rechts ausserhalb`, xWerte.every(v => v <= 460), String(Math.max(...xWerte)))
    }

    pruefe('bildFuer liefert leer statt undefined fuer unbekannte Karten',
        bildFuer('gibtsNicht') === '' && bildFuer(undefined) === '' && bildFuer(null) === '')
    pruefe('bildFuer trifft eine bekannte Karte', bildFuer('bosChoch').startsWith('<svg'))
}


/*
 * Echte Marktbeispiele.
 *
 * DIE ZWEITE PRUEFUNG IST DIE WICHTIGE: Die eingezeichnete Marke muss aus den
 * eingefrorenen Kerzen HERVORGEHEN, nicht daneben stehen. Beim Schema lag
 * genau hier der Fehler -- die Bandkante war als "Hoch der 1. Kerze"
 * beschriftet und lag dreissig Punkte daneben. Bei echten Kerzen faellt das
 * noch weniger auf, weil das Bild ja "echt" aussieht.
 */
{
    const schluessel = new Set(LERNKARTEN_DEFS.map(k => k.schluessel))
    for (const [k, b] of Object.entries(BEISPIELE)) {
        pruefe(`${k}: gehoert zu einer Karte`, schluessel.has(k))
        pruefe(`${k}: hat Kerzen`, Array.isArray(b.kerzen) && b.kerzen.length >= 20, String(b.kerzen?.length))
        pruefe(`${k}: Kerzenform [t,o,h,l,c] und h >= l`,
            b.kerzen.every(c => c.length === 5 && c[2] >= c[3] && c[2] >= Math.max(c[1], c[4]) && c[3] <= Math.min(c[1], c[4])))
        pruefe(`${k}: Zeitstempel laufen aufwaerts`,
            b.kerzen.every((c, i) => i === 0 || c[0] > b.kerzen[i - 1][0]))
        pruefe(`${k}: Herkunft steht im Bild`, Boolean(b.symbol && b.intervall && b.regel))

        const svg = zeichneBeispiel(b)
        pruefe(`${k}: ergibt ein SVG`, svg.startsWith('<svg') && svg.includes('xmlns='))
        pruefe(`${k}: Symbol und Regel stehen drin`, svg.includes(b.symbol) && svg.includes(b.regel))

        for (const m of b.marken || []) {
            if (m.art === 'band') {
                /*
                 * Eine Fair Value Gap ist definiert als Luecke zwischen dem
                 * Hoch der ersten und dem Tief der dritten Kerze. `ab` zeigt
                 * auf die dritte; die Bandkanten muessen daher exakt aus
                 * Kerze `ab - 2` und `ab` stammen.
                 */
                const a1 = b.kerzen[m.ab - 2], a3 = b.kerzen[m.ab]
                const bull = a3[3] > a1[2]
                const unten = bull ? a1[2] : a3[2]
                const oben = bull ? a3[3] : a1[3]
                pruefe(`${k}: Bandkanten stammen aus den Kerzen`,
                    m.unten === unten && m.oben === oben,
                    `Bild ${m.unten}/${m.oben}, Kerzen ${unten}/${oben}`)
                pruefe(`${k}: die Luecke ist auch eine`, m.oben > m.unten)
            }
            if (m.art === 'linie') {
                const hoehen = (m.punkte || []).map(i => b.kerzen[i][2])
                pruefe(`${k}: die markierten Punkte liegen auf der Linie`,
                    hoehen.every(h => Math.abs(h - m.preis) / m.preis < 0.001),
                    hoehen.join(' / '))
                pruefe(`${k}: es sind mindestens zwei Punkte`, (m.punkte || []).length >= 2)
            }
        }
    }
    pruefe('beispielFuer liefert leer fuer Karten ohne Beispiel',
        beispielFuer('bosChoch') === '' && beispielFuer('gibtsNicht') === '')
}


/*
 * Jede Karte nennt ihre Stufe AUSDRUECKLICH.
 *
 * `seedDefaultLernkarten` setzt `def.niveau || 1` -- 51 Karten lebten deshalb
 * von einer unsichtbaren Vorgabe. Inhaltlich war sie richtig (es sind die
 * Grundbegriffe), aber eine Stufe, die niemand hingeschrieben hat, laesst sich
 * auch nicht bestreiten. Seit die Sitzung nach Stufen filtert, entscheidet sie
 * ausserdem mit, was ueberhaupt drankommt.
 */
{
    const ohne = LERNKARTEN_DEFS.filter(k => !k.niveau).map(k => k.schluessel)
    pruefe('jede Karte nennt ihre Stufe', ohne.length === 0, ohne.slice(0, 8).join(', '))
    pruefe('nur die Stufen 1 bis 3',
        LERNKARTEN_DEFS.every(k => [1, 2, 3].includes(k.niveau)),
        [...new Set(LERNKARTEN_DEFS.map(k => k.niveau))].join(', '))
}


/*
 * Die OTE-Skizze: Band und Beschriftung stammen aus DENSELBEN Zahlen.
 *
 * Dreimal ist in diesen Bildern eine Kante von ihrer Beschriftung abgewichen
 * (Fair Value Gap, dann OTE). Der Test prueft deshalb nicht das Ergebnis,
 * sondern dass die Zahl im Text und die Linie im Bild dieselbe Quelle haben.
 */
{
    const svg = BILDER.optimalTradeEntry
    const spanne = OTE.anfangY - OTE.endeY
    const oben = OTE.endeY + OTE.von * spanne
    const unten = OTE.endeY + OTE.bis * spanne
    const rect = svg.match(/<rect x="150" y="([\d.]+)" width="302" height="([\d.]+)"/)
    pruefe('OTE: das Band steht im Bild', Boolean(rect))
    if (rect) {
        pruefe('OTE: Bandoberkante ist der 62-%-Ruecklauf', Math.abs(Number(rect[1]) - oben) < 0.5,
            `${rect[1]} statt ${oben}`)
        pruefe('OTE: Bandhoehe entspricht 62 bis 79 %', Math.abs(Number(rect[2]) - (unten - oben)) < 0.5,
            `${rect[2]} statt ${unten - oben}`)
    }
    pruefe('OTE: die Beschriftung nennt dieselben Prozente',
        svg.includes(`${Math.round(OTE.von * 100)} – ${Math.round(OTE.bis * 100)} %`))
    pruefe('OTE: Anfang liegt unter dem Ende (y waechst nach unten)', OTE.anfangY > OTE.endeY)
}

console.log(`\n${ok} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler ? 1 : 0)
