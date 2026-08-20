/**
 * Selbsttest: der Risiko-Kontext gilt ZUM ZEITPUNKT der Auslösekerze.
 *
 *   node server/__selftest-risikokontext.mjs
 *
 * Hintergrund ist ein Fehler, den keine Rechenprüfung sehen konnte, weil die
 * Rechnung stimmte — bloss die Eingabe war aus der falschen Zeit. `now` ist
 * die Kerzenzeit des Auslösers; beim ersten Lauf über ein Symbol liegt sie bis
 * zu 200 Kerzen in der Vergangenheit. Die drei Abfragen lasen dagegen den
 * jetzigen Stand der Datenbank.
 *
 * Sichtbar wurde es an der Sperrfrist: eingestellt waren 60 Minuten, gemeldet
 * wurden „noch 34380 min" (24 Tage), weil der letzte Ausstieg NACH der
 * Auslösekerze lag und die Wartezeit negativ wurde. 76 von 79
 * Sperrfrist-Ablehnungen am 20.08.2026 waren von dieser Sorte.
 *
 * Geprüft wird hier ohne Datenbank: Knex übersetzt die Builder mit
 * PostgreSQL-Grammatik, und im erzeugten SQL müssen die Zeitschranken stehen.
 * Gegenprobe gemacht — entfernt man eine der drei, schlägt der Test fehl.
 */
import knexLib from 'knex'
import { risikoKontextAbfragen } from './strategy-engine.js'

let bestanden = 0
let fehler = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehler++; console.log(`  \x1b[31m✗\x1b[0m ${name}${zusatz ? ' — ' + zusatz : ''}`) }
}

console.log('\nRisiko-Kontext: Stand zum Zeitpunkt der Auslösekerze')

const knex = knexLib({ client: 'pg' })
const NOW = 1_700_000_000_000
const a = risikoKontextAbfragen(knex, 42, NOW)
const sql = Object.fromEntries(Object.entries(a).map(([k, q]) => [k, q.toString()]))

// --- Sperrfrist: nur Ausstiege BIS zur Auslösekerze ------------------------
pruefe('letzte Ausstiege sind nach oben begrenzt',
    /"exitTime"\s*<=\s*1700000000000/.test(sql.letzte), sql.letzte)
pruefe('…und weiterhin je Symbol und Zeiteinheit gruppiert',
    /group by "symbol", "timeframe"/i.test(sql.letzte) && /max\("exitTime"\)/i.test(sql.letzte), sql.letzte)

// --- Tagesverlust: Tagesbeginn UND Auslösekerze ---------------------------
pruefe('Tages-PnL ist beidseitig begrenzt',
    /"exitTime" between \d+ and 1700000000000/i.test(sql.heute), sql.heute)
{
    // Der Tagesbeginn muss der Tag VON now sein, nicht der von heute.
    const tagesBeginn = Date.UTC(2023, 10, 14)   // 14.11.2023, der Tag zu NOW
    pruefe('Tagesbeginn stammt aus now, nicht aus der Systemzeit',
        sql.heute.includes(String(tagesBeginn)), `erwartet ${tagesBeginn} in ${sql.heute}`)
}

// --- Offene Positionen: offen ZUM ZEITPUNKT now ---------------------------
pruefe('nur bis zur Auslösekerze eingestiegene Positionen',
    /"entryTime"\s*<=\s*1700000000000/.test(sql.offen), sql.offen)
pruefe('bis dahin geschlossene Positionen fallen heraus',
    /not exists/i.test(sql.offen) && /"strategy_trades"\."exitTime"\s*<=\s*1700000000000/.test(sql.offen), sql.offen)
pruefe('Reservierungen (pending) zählen weiterhin nicht als Position',
    /"status" in \('open', 'closed'\)/i.test(sql.offen), sql.offen)
pruefe('kein Join — eine Position kann nicht doppelt gezählt werden',
    !/join/i.test(sql.offen), sql.offen)

// --- Die Lehre aus db-claim: camelCase muss gequotet sein -----------------
pruefe('Bezeichner der Unterabfrage sind gequotet (pg faltet sonst klein)',
    sql.offen.includes('"strategy_trades"."positionId" = "strategy_positions"."id"'), sql.offen)

// --- Der Fall, der den Fehler ausgelöst hat -------------------------------
// Ausstieg um 12:00, Auslösekerze um 09:00: der Ausstieg darf für diese
// Entscheidung noch nicht existieren.
{
    const neun = Date.UTC(2023, 10, 14, 9)
    const s = risikoKontextAbfragen(knex, 42, neun).letzte.toString()
    const zwoelf = Date.UTC(2023, 10, 14, 12)
    pruefe('ein späterer Ausstieg liegt ausserhalb der Schranke',
        s.includes(String(neun)) && !s.includes(String(zwoelf)) && neun < zwoelf)
}

await knex.destroy()
console.log(`\n${fehler === 0 ? '✓' : '✗'} ${bestanden} bestanden, ${fehler} fehlgeschlagen\n`)
process.exit(fehler === 0 ? 0 : 1)
