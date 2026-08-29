/**
 * Selbsttest der Radar-Aufbewahrungsgrenze.
 *
 *   node server/__selftest-radar-aufraeumen.mjs
 *
 * Diese Routine LÖSCHT. Ein Fehler in der Grenzziehung fällt nicht als
 * Absturz auf, sondern als Lücke in der Beständigkeits-Anzeige — Monate
 * später und ohne Spur. Deshalb läuft der Test gegen eine echte
 * In-Memory-SQLite und prüft das erzeugte SQL, nicht nur die Arithmetik.
 *
 * Die wichtigere Richtung ist die zweite: nicht „wird Altes gelöscht",
 * sondern „bleibt Junges liegen".
 */
import knexLib from 'knex'
import { raeumeRadarAuf, VERWORFEN_TAGE, BEWERTET_TAGE, ERGEBNIS_TAGE, KANDIDAT_TAGE, KANDIDAT_BERICHTET_TAGE } from './radar-aufraeumen.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const TAG = 24 * 3600 * 1000
const JETZT = 1_756_000_000_000   // fester Zeitpunkt, kein Date.now()

const knex = knexLib({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
})

await knex.schema.createTable('coinradar_laeufe', (t) => {
    t.increments('id').primary()
    t.bigInteger('erstelltAm').defaultTo(0)
    t.string('status').defaultTo('fertig')
})
await knex.schema.createTable('coinradar_zeilen', (t) => {
    t.increments('id').primary()
    t.integer('laufId')
    t.string('symbol')
    t.string('status')
    t.bigInteger('erstelltAm').defaultTo(0)
})
await knex.schema.createTable('radar_ergebnisse', (t) => {
    t.increments('id').primary()
    t.string('status')
    t.bigInteger('faelligAm').defaultTo(0)
})
await knex.schema.createTable('hype_candidates', (t) => {
    t.increments('id').primary()
    t.string('symbol')
    t.string('status')
    t.bigInteger('erstelltAm').defaultTo(0)
})

const alter = (tage) => JETZT - tage * TAG

// Ein Lauf je Altersstufe, damit die Lauf-Aufräumung prüfbar wird.
await knex('coinradar_laeufe').insert([
    { id: 1, erstelltAm: alter(200) },   // uralt
    { id: 2, erstelltAm: alter(30) },    // mittelalt, hat noch bewertete Zeilen
    { id: 3, erstelltAm: alter(1) },     // frisch
])

await knex('coinradar_zeilen').insert([
    // verworfen — Grenze VERWORFEN_TAGE
    { laufId: 1, symbol: 'ALT1', status: 'huerde', erstelltAm: alter(VERWORFEN_TAGE + 1) },
    { laufId: 3, symbol: 'NEU1', status: 'huerde', erstelltAm: alter(VERWORFEN_TAGE - 1) },
    // bewertet — Grenze BEWERTET_TAGE
    { laufId: 1, symbol: 'ALT2', status: 'bewertet', erstelltAm: alter(BEWERTET_TAGE + 1) },
    { laufId: 2, symbol: 'MITTEL', status: 'bewertet', erstelltAm: alter(30) },
    { laufId: 3, symbol: 'NEU2', status: 'bewertet', erstelltAm: alter(1) },
])

await knex('radar_ergebnisse').insert([
    { status: 'gemessen', faelligAm: alter(ERGEBNIS_TAGE + 1) },
    { status: 'gemessen', faelligAm: alter(ERGEBNIS_TAGE - 1) },
    // offen und uralt: eine Messung, die nie eingelöst wurde, ist ein Hinweis
    // auf einen Fehler — sie stillschweigend zu löschen verwischt ihn.
    { status: 'offen', faelligAm: alter(ERGEBNIS_TAGE + 10) },
])

/*
 * Hype-Kandidaten. Der längste Messhorizont des Hype-Radars ist 30 Tage —
 * vorher darf nichts weg, sonst misst die Erfolgskontrolle ins Leere.
 */
await knex('hype_candidates').insert([
    { symbol: 'ALTVERWORFEN', status: 'verworfen', erstelltAm: alter(KANDIDAT_TAGE + 1) },
    { symbol: 'JUNGVERWORFEN', status: 'verworfen', erstelltAm: alter(KANDIDAT_TAGE - 1) },
    { symbol: 'BERICHTETMITTEL', status: 'berichtet', erstelltAm: alter(KANDIDAT_TAGE + 10) },
    { symbol: 'BERICHTETALT', status: 'berichtet', erstelltAm: alter(KANDIDAT_BERICHTET_TAGE + 1) },
    { symbol: 'BESTANDEN', status: 'bestanden', erstelltAm: alter(200) },
])

console.log('\nRadar aufräumen\n')

const b = await raeumeRadarAuf({ jetzt: JETZT, knex, blockGroesse: 2 })

const zeilen = await knex('coinradar_zeilen').select('symbol').orderBy('symbol')
const uebrig = zeilen.map((z) => z.symbol)

check('alte verworfene Zeile ist weg', !uebrig.includes('ALT1'), uebrig.join(','))
check('junge verworfene Zeile bleibt', uebrig.includes('NEU1'), uebrig.join(','))
check('alte bewertete Zeile ist weg', !uebrig.includes('ALT2'), uebrig.join(','))
check('bewertete Zeile innerhalb der Frist bleibt', uebrig.includes('MITTEL'), uebrig.join(','))
check('junge bewertete Zeile bleibt', uebrig.includes('NEU2'), uebrig.join(','))
check('Bilanz zählt richtig', b.zeilenVerworfen === 1 && b.zeilenBewertet === 1, JSON.stringify(b))

const erg = await knex('radar_ergebnisse').select('status', 'faelligAm')
check('altes gemessenes Ergebnis ist weg', erg.filter((e) => e.status === 'gemessen').length === 1, JSON.stringify(erg))
check('offene Messung bleibt, auch wenn uralt',
    erg.some((e) => e.status === 'offen'), JSON.stringify(erg))

const laeufe = (await knex('coinradar_laeufe').select('id')).map((l) => l.id).sort()
check('leergeräumter alter Lauf ist weg', !laeufe.includes(1), laeufe.join(','))
check('Lauf mit verbliebenen Zeilen bleibt', laeufe.includes(2), laeufe.join(','))
check('junger Lauf bleibt', laeufe.includes(3), laeufe.join(','))

console.log('\nHype-Kandidaten\n')
{
    const uebrig = (await knex('hype_candidates').select('symbol')).map((k) => k.symbol).sort()
    check('alter verworfener Kandidat ist weg', !uebrig.includes('ALTVERWORFEN'), uebrig.join(','))
    check('junger verworfener bleibt', uebrig.includes('JUNGVERWORFEN'), uebrig.join(','))
    /*
     * Der wichtigste Fall: berichtet UND älter als die Verworfenen-Frist. Wer
     * hier nur nach Alter löscht, reisst die Belege unter den Berichten weg.
     */
    check('berichteter Kandidat überlebt die kürzere Frist', uebrig.includes('BERICHTETMITTEL'), uebrig.join(','))
    check('bestandener Kandidat überlebt ebenfalls', uebrig.includes('BESTANDEN'), uebrig.join(','))
    check('berichteter Kandidat über der langen Frist ist weg', !uebrig.includes('BERICHTETALT'), uebrig.join(','))
    check('Bilanz zählt die Kandidaten', b.kandidaten === 2, JSON.stringify(b))
}

console.log('\nZweiter Durchgang ändert nichts mehr\n')
const b2 = await raeumeRadarAuf({ jetzt: JETZT, knex, blockGroesse: 2 })
check('nichts mehr zu löschen',
    b2.zeilenVerworfen === 0 && b2.zeilenBewertet === 0 && b2.ergebnisse === 0
    && b2.kandidaten === 0 && b2.laeufe === 0,
    JSON.stringify(b2))

console.log('\nBlockweises Löschen erwischt alles\n')
{
    // Blockgrösse 2 bei 7 zu löschenden Zeilen: die Schleife muss mehrfach
    // laufen. Bliebe sie nach dem ersten Block stehen, wüchse die Tabelle
    // trotz Aufräumen weiter — der Fehler, der am längsten unbemerkt bliebe.
    const viele = Array.from({ length: 7 }, (_, i) => ({
        laufId: 3, symbol: `X${i}`, status: 'huerde', erstelltAm: alter(VERWORFEN_TAGE + 5),
    }))
    await knex('coinradar_zeilen').insert(viele)
    const b3 = await raeumeRadarAuf({ jetzt: JETZT, knex, blockGroesse: 2 })
    check('alle sieben in Blöcken zu zwei gelöscht', b3.zeilenVerworfen === 7, JSON.stringify(b3))
    const rest = await knex('coinradar_zeilen').where('symbol', 'like', 'X%').count({ n: '*' })
    check('keine Reste', Number(rest[0].n) === 0, JSON.stringify(rest))
}

console.log('\nGrenzwerte sind plausibel\n')
check('verworfen kürzer als bewertet', VERWORFEN_TAGE < BEWERTET_TAGE)
check('Ergebnisse überleben die Zeilen', ERGEBNIS_TAGE >= BEWERTET_TAGE)
check('Kandidaten überleben den längsten Hype-Horizont (30 Tage)', KANDIDAT_TAGE > 30)
check('berichtete Kandidaten überleben die verworfenen', KANDIDAT_BERICHTET_TAGE > KANDIDAT_TAGE)

await knex.destroy()

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler: ' + fehler.join(', ')); process.exit(1) }
