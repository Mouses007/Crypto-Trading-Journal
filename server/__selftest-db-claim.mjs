/**
 * Selbsttest: Bezeichner-Quoting in db-claim.
 *
 * Hintergrund ist ein Fehler, den kein bestehender Test sehen KONNTE: In
 * Knex' Builder-Methoden werden Spaltennamen automatisch gequotet, in
 * `whereRaw` nicht. SQLite trifft `fetchedAt` auch ungequotet — PostgreSQL
 * faltet ungequotete Namen zu Kleinbuchstaben und fand `fetchedat` nicht.
 * Ergebnis am 19.08.2026: JEDER Anspruch und JEDE Führung scheiterte auf
 * PostgreSQL still (db-claim schluckt Fehler mit Absicht), und die
 * Selbsttests blieben grün, weil keiner die pg-Grammatik ansah.
 *
 * Dieser Test tut genau das — auf zwei Wegen, beide ohne Datenbank:
 *   1. Quelltext-Wache: kein camelCase-Bezeichner darf blank in einem
 *      whereRaw-Baustein von db-claim.js stehen.
 *   2. Grammatik-Beweis: Knex mit pg-Grammatik übersetzt `??` in den
 *      gequoteten Namen — die Zusage, auf der der Fix beruht, kompiliert
 *      ohne Verbindung.
 *
 * Aufruf: node server/__selftest-db-claim.mjs
 */
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'
import knexLib from 'knex'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('db-claim: Bezeichner-Quoting')

// ── 1. Quelltext-Wache ──────────────────────────────────────────────────
const hier = path.dirname(fileURLToPath(import.meta.url))
const quelle = await readFile(path.join(hier, 'db-claim.js'), 'utf8')

/*
 * Gesucht: whereRaw/andWhereRaw-Bausteine, in deren Vorlage ein Wort mit
 * Binnengrossbuchstaben steht (fetchedAt, claimedBy …). Solche Namen gehören
 * als `??`-Bindung hinein, nie als blanker Text.
 */
const rohBausteine = [...quelle.matchAll(/[Ww]hereRaw\(\s*`([^`]*)`/g)].map((m) => m[1])
p('db-claim nutzt überhaupt rohe Where-Bausteine (sonst prüft dieser Test nichts)',
    rohBausteine.length >= 3, String(rohBausteine.length))

const verdaechtig = rohBausteine.filter((b) => /\b[a-z]+[A-Z]\w*\b/.test(b))
p('kein camelCase-Name steht blank in einem rohen Baustein',
    verdaechtig.length === 0, JSON.stringify(verdaechtig))

p('die Bausteine binden ihre Namen über ??',
    rohBausteine.every((b) => !/\b[a-z]+[A-Z]/.test(b) || b.includes('??')))

// ── 2. Grammatik-Beweis ─────────────────────────────────────────────────
// Knex kompiliert Abfragen ohne Verbindung — `toSQL()` braucht keinen Server.
const pg = knexLib({ client: 'pg' })
const sqlPg = pg('radar_fetch_state').whereRaw('?? < ?', ['fetchedAt', 1]).toSQL().sql
p('pg-Grammatik quotet die ??-Bindung', sqlPg.includes('"fetchedAt"'), sqlPg)

const sqlLite = knexLib({ client: 'better-sqlite3', useNullAsDefault: true })('radar_fetch_state')
    .whereRaw('?? < ?', ['fetchedAt', 1]).toSQL().sql
p('sqlite-Grammatik kommt mit derselben Bindung zurecht',
    sqlLite.includes('`fetchedAt`') || sqlLite.includes('"fetchedAt"'), sqlLite)

// Und der Gegenbeweis, damit klar ist, WOGEGEN die Wache steht: blanker Text
// bleibt in pg ungequotet — genau das war der Fehler.
const sqlKaputt = pg('radar_fetch_state').whereRaw('fetchedAt < ?', [1]).toSQL().sql
p('blanker camelCase bleibt in pg ungequotet (der Fehlerfall existiert wirklich)',
    sqlKaputt.includes('fetchedAt') && !sqlKaputt.includes('"fetchedAt"'), sqlKaputt)

await pg.destroy().catch(() => {})

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
