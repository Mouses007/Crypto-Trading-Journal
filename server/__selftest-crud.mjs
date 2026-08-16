/**
 * Selbsttest der generischen REST-CRUD-Schicht — gegen eine Wegwerf-SQLite.
 *
 *   node server/__selftest-crud.mjs
 *
 * Läuft als ECHTER HTTP-Server auf einem freien Port: die Whitelists, das
 * objectId-Mapping und der JSON-Roundtrip sind Express-Middleware-Verhalten,
 * das man nicht sinnvoll „trocken" prüfen kann. `CTJ_DB_FILE=:memory:` sorgt
 * dafür, dass NIE die konfigurierte echte Datenbank angefasst wird — der
 * Umweg über die Umgebungsvariable MUSS vor dem ersten DB-Import stehen.
 */

process.env.CTJ_DB_FILE = ':memory:'

const { initDb } = await import('./database.js')
const { setupApiRoutes } = await import('./api-routes.js')
const express = (await import('express')).default

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

await initDb()

const app = express()
app.use(express.json({ limit: '5mb' }))
setupApiRoutes(app)

const server = await new Promise((fertig) => {
    const s = app.listen(0, '127.0.0.1', () => fertig(s))
})
const basis = `http://127.0.0.1:${server.address().port}`

const api = async (methode, pfad, body) => {
    const r = await fetch(basis + pfad, {
        method: methode,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    let json = null
    try { json = await r.json() } catch { /* leere Antworten */ }
    return { status: r.status, json }
}

console.log('\nAnlegen und JSON-Roundtrip\n')

let tradeId
{
    // `trades.trades` ist eine JSON-Spalte: rein als Objekt, in SQLite als
    // TEXT, raus wieder als Objekt. Genau dieser Roundtrip trug jahrelang
    // das ganze Journal — ungetestet.
    const nutzlast = {
        dateUnix: 1754006400,
        date: '2026-08-01',
        trades: [{ id: 't1', symbol: 'BTCUSDT', netProceeds: 16.56 }],
        executions: [{ id: 't1', trade: 't1' }],
        pAndL: { grossProceeds: 17.6, trades: 1 },
        blotter: [{ symbol: 'BTCUSDT' }],
        broker: 'bitunix',
    }
    const { status, json } = await api('POST', '/api/db/trades', nutzlast)
    check('POST legt an (201)', status === 201, String(status))
    // Das Mapping ERGÄNZT objectId (als Text, Parse-Erbe) — id bleibt daneben stehen.
    check('Antwort trägt objectId = String(id)', json?.objectId !== undefined && json.objectId === String(json.id), JSON.stringify(json)?.slice(0, 120))
    check('JSON-Spalte kommt als Objekt zurück, nicht als Text',
        Array.isArray(json?.trades) && json.trades[0]?.symbol === 'BTCUSDT', typeof json?.trades)
    tradeId = json?.objectId

    const { json: gelesen } = await api('GET', `/api/db/trades/${tradeId}`)
    check('GET by id liefert denselben Datensatz', gelesen?.objectId === tradeId && gelesen?.pAndL?.trades === 1)
}

console.log('\nWhitelist\n')

{
    const { status } = await api('GET', '/api/db/kein_solcher_name')
    check('unbekannte Tabelle → 400', status === 400, String(status))

    // Fremdspalten dürfen NIE in die Datenbank durchschlagen.
    const { status: s2, json } = await api('POST', '/api/db/trades', {
        dateUnix: 1754092800, boeseSpalte: 'DROP TABLE', broker: 'bitunix',
    })
    check('Fremdspalte wird verworfen, Rest gespeichert', s2 === 201 && json?.boeseSpalte === undefined, JSON.stringify(json)?.slice(0, 120))

    // Nur-Fremdspalten: nichts übrig → 400 statt leerer Insert
    const { status: s3 } = await api('POST', '/api/db/trades', { boeseSpalte: 1 })
    check('nur Fremdspalten → 400', s3 === 400, String(s3))

    // Read-only-Tabellen sind über die generische Route gesperrt
    const { status: s4 } = await api('POST', '/api/db/strategy_trades', { symbol: 'X' })
    check('Read-only-Tabelle verweigert Schreiben', s4 === 400, String(s4))

    // Filter auf nicht existenter Spalte wird ignoriert, nicht 500
    const { status: s5, json: liste } = await api('GET', '/api/db/trades?equalTo=' + encodeURIComponent('{"gibtEsNicht":"x"}'))
    check('Filter auf Fremdspalte wird ignoriert', s5 === 200 && Array.isArray(liste), String(s5))
}

console.log('\nAbfragen\n')

{
    const { json } = await api('GET', '/api/db/trades?equalTo=' + encodeURIComponent('{"dateUnix":1754006400}'))
    check('equalTo filtert', json?.length === 1 && json[0].dateUnix === 1754006400, String(json?.length))

    const { json: bereich } = await api('GET', '/api/db/trades?gte=' + encodeURIComponent('{"dateUnix":1754000000}') + '&lt=' + encodeURIComponent('{"dateUnix":1754050000}'))
    check('gte/lt grenzen den Bereich ein', bereich?.length === 1, String(bereich?.length))

    const { json: sortiert } = await api('GET', '/api/db/trades?descending=dateUnix&limit=1')
    check('descending + limit greifen', sortiert?.length === 1 && sortiert[0].dateUnix === 1754092800, JSON.stringify(sortiert?.map(r => r.dateUnix)))

    const { json: schlank } = await api('GET', '/api/db/trades?exclude=trades,executions,blotter,pAndL')
    check('exclude lässt schwere Spalten weg', schlank?.length >= 1 && schlank[0].trades === undefined)
}

console.log('\nÄndern und Löschen\n')

{
    const { status, json } = await api('PUT', `/api/db/trades/${tradeId}`, { broker: 'bitget' })
    check('PUT aktualisiert', status === 200 && json?.broker === 'bitget', `${status} ${json?.broker}`)

    // Bulk-Delete OHNE Filter muss verweigert werden — das ist die Zeile
    // zwischen „Aufräumen" und „ganze Tabelle weg".
    const { status: s2 } = await api('DELETE', '/api/db/trades')
    check('Bulk-Delete ohne Filter → 400', s2 === 400, String(s2))

    const { status: s3 } = await api('DELETE', '/api/db/trades?equalTo=' + encodeURIComponent('{"dateUnix":1754092800}'))
    check('Bulk-Delete mit Filter läuft', s3 === 200, String(s3))

    const { status: s4 } = await api('DELETE', `/api/db/trades/${tradeId}`)
    const { status: s5 } = await api('GET', `/api/db/trades/${tradeId}`)
    check('Einzel-Delete entfernt den Datensatz', s4 === 200 && s5 === 404, `${s4}/${s5}`)
}

console.log('\nEinstellungen\n')

{
    // Sensible Felder dürfen weder rein (PUT) noch raus (GET).
    await api('PUT', '/api/db/settings', { timeZone: 'Europe/Zurich', aiApiKey: 'sk-boese' })
    const { json } = await api('GET', '/api/db/settings')
    check('normale Einstellung wird gespeichert', json?.timeZone === 'Europe/Zurich', json?.timeZone)
    check('sensibles Feld wird nicht übernommen/ausgeliefert',
        json?.aiApiKey === undefined || json?.aiApiKey === '' || json?.aiApiKey === '[REDACTED]',
        String(json?.aiApiKey))
}

server.close()

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
process.exit(0)
