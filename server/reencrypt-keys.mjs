/**
 * Schlüssel umschlüsseln.
 *
 *   node server/reencrypt-keys.mjs                 # nur anzeigen, nichts ändern
 *   CTJ_SECRET=… node server/reencrypt-keys.mjs --apply
 *
 * ── Wozu ────────────────────────────────────────────────────────────────
 * `server/crypto.js` leitet den Schlüssel aus `CTJ_SECRET` ab — fehlt die
 * Variable, aus Rechnername und Benutzer. Wurde dieselbe Datenbank mal mit und
 * mal ohne gesetzte Variable beschrieben, liegen darin Werte unter ZWEI
 * verschiedenen Schlüsseln. Wie man den Dienst auch startet: ein Teil ist
 * unlesbar, und die Oberfläche meldet „nicht konfiguriert", obwohl alles da ist.
 *
 * Dieses Skript liest beide Schlüssel, findet die Werte, die am falschen
 * hängen, und schreibt sie mit dem aktuellen `CTJ_SECRET` neu.
 *
 * ── Was es NICHT anfasst ────────────────────────────────────────────────
 *   - `authPasswordHash` — ein Hash, kein verschlüsselter Wert.
 *   - Werte, die bereits mit dem Ziel-Schlüssel lesbar sind.
 *   - Klartext-Werte: umzuschlüsseln gäbe es da nichts. Sie werden gemeldet,
 *     denn sie gehören verschlüsselt — das passiert beim nächsten Speichern
 *     über die Oberfläche von selbst.
 *   - Werte, die mit KEINEM der beiden Schlüssel lesbar sind. Die sind mit
 *     einem dritten Secret geschrieben worden; sie hier zu überschreiben
 *     würde sie endgültig zerstören.
 *
 * Vor jeder Änderung wird eine Sicherung geschrieben.
 */

import crypto from 'crypto'
import os from 'os'
import fs from 'fs'
import path from 'path'
import knexLib from 'knex'

const ANWENDEN = process.argv.includes('--apply')
const ALGORITHM = 'aes-256-gcm'

// ── Beide Schlüssel ableiten, genau wie crypto.js es tut ────────────────
const zielSecret = process.env.CTJ_SECRET
const maschinenSeed = `tradenote-${os.hostname()}-${os.userInfo().username}-v1`
const schluessel = (seed) => crypto.createHash('sha256').update(seed).digest()

if (!zielSecret) {
    console.error('CTJ_SECRET ist nicht gesetzt. Ohne Ziel-Schlüssel gibt es nichts umzuschlüsseln.')
    console.error('Aufruf: CTJ_SECRET=… node server/reencrypt-keys.mjs [--apply]')
    process.exit(1)
}
if (zielSecret === maschinenSeed) {
    console.error('CTJ_SECRET entspricht dem Maschinen-Seed — dann sind beide Schlüssel gleich.')
    process.exit(1)
}

const ZIEL = schluessel(zielSecret)
const MASCHINE = schluessel(maschinenSeed)

const istVerschluesselt = (t) => {
    if (!t) return false
    const p = String(t).split(':')
    return p.length === 3 && p[0].length === 32 && p[1].length === 32
}

/** @returns {string|null} Klartext, oder null wenn dieser Schlüssel nicht passt. */
function entschluesseln(text, key) {
    try {
        const [ivHex, tagHex, daten] = String(text).split(':')
        const d = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
        d.setAuthTag(Buffer.from(tagHex, 'hex'))
        return d.update(daten, 'hex', 'utf8') + d.final('utf8')
    } catch {
        return null
    }
}

function verschluesseln(text, key) {
    const iv = crypto.randomBytes(16)
    const c = crypto.createCipheriv(ALGORITHM, key, iv)
    const daten = c.update(text, 'utf8', 'hex') + c.final('hex')
    return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${daten}`
}

// ── Wo überall Secrets liegen ───────────────────────────────────────────
// `authPasswordHash` steht bewusst NICHT hier: das ist ein Hash.
const FELDER = [
    ['settings', 'id', [
        'aiApiKey', 'aiKeyOpenai', 'aiKeyAnthropic', 'aiKeyGemini', 'aiKeyDeepseek',
        'fluxApiKey', 'geminiImageApiKey', 'esp32ApiKey',
    ]],
    ['bitunix_config', 'id', ['apiKey', 'secretKey']],
    ['bitget_config', 'id', ['apiKey', 'secretKey', 'passphrase']],
    ['pionex_config', 'id', ['apiKey', 'secretKey']],
]

// ── Datenbank ───────────────────────────────────────────────────────────
function baueKnex() {
    const pfad = path.resolve('./db-config.json')
    if (fs.existsSync(pfad)) {
        const c = JSON.parse(fs.readFileSync(pfad, 'utf8'))
        if ((c.type || c.client) === 'postgresql' || c.host) {
            return knexLib({
                client: 'pg',
                connection: {
                    host: c.host, port: c.port, user: c.user,
                    password: c.password, database: c.database,
                },
            })
        }
    }
    return knexLib({
        client: 'better-sqlite3',
        connection: { filename: path.resolve('./tradenote.db') },
        useNullAsDefault: true,
    })
}

const knex = baueKnex()
const kurz = (s) => (s.length <= 8 ? '•'.repeat(s.length) : `${s.slice(0, 4)}…${s.slice(-3)}`)

const befunde = []

for (const [tabelle, idSpalte, spalten] of FELDER) {
    if (!(await knex.schema.hasTable(tabelle))) continue
    let zeilen
    try { zeilen = await knex(tabelle).select('*') } catch { continue }

    for (const zeile of zeilen) {
        for (const spalte of spalten) {
            const wert = zeile[spalte]
            if (!wert) continue

            let zustand
            let klartext = null
            if (!istVerschluesselt(wert)) {
                zustand = 'klartext'
                klartext = String(wert)
            } else if ((klartext = entschluesseln(wert, ZIEL)) !== null) {
                zustand = 'ok'
            } else if ((klartext = entschluesseln(wert, MASCHINE)) !== null) {
                zustand = 'umzuschluesseln'
            } else {
                zustand = 'fremd'
            }

            befunde.push({
                tabelle, idSpalte, id: zeile[idSpalte], spalte, zustand,
                klartext, laenge: klartext?.length || 0,
            })
        }
    }
}

// ── Bericht ─────────────────────────────────────────────────────────────
const BESCHRIFTUNG = {
    ok: '✓ bereits richtig',
    umzuschluesseln: '→ wird umgeschlüsselt',
    klartext: '! liegt im Klartext',
    fremd: '✗ mit keinem der beiden Schlüssel lesbar',
}

console.log(`\nDatenbank: ${knex.client.config.client}`)
console.log(`Ziel-Schlüssel: CTJ_SECRET (${zielSecret.slice(0, 6)}…)\n`)

for (const zustand of ['umzuschluesseln', 'fremd', 'klartext', 'ok']) {
    const treffer = befunde.filter((b) => b.zustand === zustand)
    if (!treffer.length) continue
    console.log(`${BESCHRIFTUNG[zustand]} (${treffer.length})`)
    for (const b of treffer) {
        const wo = `${b.tabelle}.${b.spalte}`.padEnd(34)
        console.log(`  ${wo} ${b.laenge ? `${b.laenge} Zeichen (${kurz(b.klartext)})` : ''}`)
    }
    console.log('')
}

const zuTun = befunde.filter((b) => b.zustand === 'umzuschluesseln')

if (!zuTun.length) {
    console.log('Nichts umzuschlüsseln.\n')
    await knex.destroy()
    process.exit(0)
}

if (!ANWENDEN) {
    console.log(`Testlauf — nichts geändert. Zum Ausführen: --apply anhängen.\n`)
    await knex.destroy()
    process.exit(0)
}

// ── Sicherung, dann schreiben ───────────────────────────────────────────
const sicherung = path.resolve(`./_schluessel-sicherung-${Date.now()}.json`)
fs.writeFileSync(sicherung, JSON.stringify(
    await Promise.all(FELDER.map(async ([t, idSpalte, spalten]) => ({
        tabelle: t,
        idSpalte,
        zeilen: (await knex.schema.hasTable(t)) ? await knex(t).select('*') : [],
        spalten,
    }))), null, 2))
fs.chmodSync(sicherung, 0o600)
console.log(`Sicherung: ${sicherung} (enthält die alten Werte — nach dem Prüfen löschen)\n`)

let geschrieben = 0
for (const b of zuTun) {
    await knex(b.tabelle).where(b.idSpalte, b.id)
        .update({ [b.spalte]: verschluesseln(b.klartext, ZIEL) })
    console.log(`  umgeschlüsselt: ${b.tabelle}.${b.spalte}`)
    geschrieben++
}

// ── Gegenprobe: alles muss jetzt mit dem Ziel-Schlüssel lesbar sein ─────
console.log('\nGegenprobe:')
let fehler = 0
for (const b of zuTun) {
    const zeile = await knex(b.tabelle).where(b.idSpalte, b.id).first()
    const jetzt = entschluesseln(zeile[b.spalte], ZIEL)
    const gleich = jetzt === b.klartext
    if (!gleich) fehler++
    console.log(`  ${gleich ? '✓' : '✗'} ${b.tabelle}.${b.spalte}${gleich ? '' : ' — WEICHT AB, Sicherung zurückspielen!'}`)
}

console.log(`\n${geschrieben} umgeschlüsselt, ${fehler} fehlerhaft.`)
if (!fehler) console.log('Dienst neu starten, damit die Werte neu gelesen werden.\n')

await knex.destroy()
process.exit(fehler ? 1 : 0)
