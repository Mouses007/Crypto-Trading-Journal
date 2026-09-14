/**
 * Lesende Probe gegen die echte Pionex-API.
 *
 *   CTJ_SECRET=… node scripts/pionex-probe.mjs
 *
 * Bewusst KEIN Selbsttest (liegt deshalb nicht unter `server/`, wo
 * `run-selftests.mjs` sucht): die Prüfungen dort müssen ohne Netz laufen.
 * Diese Datei tut das Gegenteil — sie fragt die Börse, wie ihre Antworten
 * wirklich aussehen, und schreibt sie als Fixtures weg.
 *
 * Sie SCHREIBT NICHTS an der Börse. Nur GET.
 *
 * Geklärt werden damit die Punkte, die sich aus der Dokumentation allein nicht
 * beantworten lassen: die echten Feldnamen, die Einheit der Wartungsmarge
 * (Bruch oder Prozent), die Symbolschreibweise und der Kontomodus.
 */

import fs from 'fs'
import path from 'path'

const symbolArg = process.argv[2] || 'BTCUSDT'

const { pionexRequest, BASE_URL } = await import('../server/pionex-transport.js')
const { journalSymbol, pionexSymbol } = await import('../server/pionex-symbole.js')

let cfg = null
try {
    const { getDecryptedPionexConfig } = await import('../server/pionex-api.js')
    const { initDb } = await import('../server/database.js')
    await initDb()
    cfg = await getDecryptedPionexConfig()
} catch (e) {
    console.log(`\x1b[33mKeine Zugangsdaten lesbar (${e.message}) — nur die öffentlichen Aufrufe.\x1b[0m`)
}

const hatKeys = Boolean(cfg?.apiKey && cfg?.secretKey)
const fixDir = path.join(process.cwd(), 'server', 'fixtures')
fs.mkdirSync(fixDir, { recursive: true })

function zeig(titel, d) {
    console.log(`\n\x1b[36m── ${titel}\x1b[0m`)
    console.log(JSON.stringify(d, null, 2).slice(0, 1800))
}
function sichere(name, d) {
    fs.writeFileSync(path.join(fixDir, name), JSON.stringify(d, null, 2) + '\n')
    console.log(`  \x1b[90m→ server/fixtures/${name}\x1b[0m`)
}
async function oeffentlich(pfad) {
    const r = await fetch(`${BASE_URL}${pfad}`)
    return r.json()
}

// ── 1. Symbole (öffentlich) ─────────────────────────────────────────────
try {
    const d = await oeffentlich('/api/v1/common/symbols?type=PERP')
    const liste = d?.data?.symbols || d?.data || []
    console.log(`\n\x1b[36m── Perp-Symbole: ${Array.isArray(liste) ? liste.length : '?'}\x1b[0m`)
    if (Array.isArray(liste) && liste.length) {
        console.log('  Felder eines Eintrags:', Object.keys(liste[0]).join(', '))
        zeig('Beispiel', liste[0])
        const treffer = liste.find((e) => journalSymbol(e.symbol) === symbolArg.toUpperCase())
        console.log(`\n  Übersetzung ${symbolArg} → ${treffer ? treffer.symbol : '\x1b[31mNICHT GEFUNDEN\x1b[0m'}`)
        if (treffer) zeig(`Kontraktdaten ${treffer.symbol}`, treffer)
        sichere('pionex-symbols-perp.json', { data: { symbols: liste.slice(0, 5) } })
    }
} catch (e) { console.log('\x1b[31mSymbole:', e.message, '\x1b[0m') }

// ── 2. Risikotabelle (öffentlich) ───────────────────────────────────────
try {
    const psym = pionexSymbol(symbolArg)
    const d = await oeffentlich(`/api/v1/common/riskTable?symbol=${encodeURIComponent(psym)}`)
    zeig(`Risikotabelle ${psym}`, d)
    const rows = d?.data?.riskTable?.[0]?.rows || d?.data?.rows || d?.data?.[0]?.rows
    if (Array.isArray(rows) && rows.length) {
        const r = rows[0]
        const roh = Number(r.maintMarginRatio ?? r.mmr)
        console.log(`\n  \x1b[33mEINHEITENFRAGE:\x1b[0m maintMarginRatio = ${roh}, maxLeverage = ${r.maxLeverage}`)
        console.log(`  1/maxLeverage = ${(1 / Number(r.maxLeverage)).toFixed(5)}`)
        console.log(`  → als Bruch ${roh < 1 / Number(r.maxLeverage) ? '\x1b[32mplausibel\x1b[0m' : '\x1b[31munmöglich\x1b[0m'}`)
        console.log(`  → als Prozent ${roh / 100 < 1 / Number(r.maxLeverage) ? '\x1b[32mplausibel\x1b[0m' : '\x1b[31munmöglich\x1b[0m'}`)
    }
    sichere('pionex-risktable.json', d)
} catch (e) { console.log('\x1b[31mRisikotabelle:', e.message, '\x1b[0m') }

if (!hatKeys) {
    console.log('\n\x1b[33mOhne Zugangsdaten endet die Probe hier.\x1b[0m')
    process.exit(0)
}

// ── 3. Signierte Aufrufe ────────────────────────────────────────────────
const k = [cfg.apiKey, cfg.secretKey]
const psym = pionexSymbol(symbolArg)

for (const [titel, pfad, params, datei] of [
    ['Futures-Guthaben', '/uapi/v1/account/balances', {}, 'pionex-balances.json'],
    ['Offene Positionen', '/uapi/v1/account/positions', {}, 'pionex-positions.json'],
    ['Kontomodus', '/uapi/v1/account/positionMode', {}, null],
    ['Hebel', '/uapi/v1/account/leverage', { symbol: psym }, null],
    ['Margenmodus', '/uapi/v1/trade/isolatedMode', { symbol: psym }, null],
    ['Offene Orders', '/uapi/v1/trade/openOrders', {}, null],
]) {
    try {
        const d = await pionexRequest('GET', pfad, ...k, params)
        zeig(titel, d)
        if (datei) sichere(datei, d)
    } catch (e) {
        console.log(`\n\x1b[31m── ${titel}: ${e.message}\x1b[0m`)
    }
}

// Fills nur, wenn es welche gibt — sonst ist die Fixture leer und wertlos.
try {
    const d = await pionexRequest('GET', '/uapi/v1/trade/fills', ...k, {
        symbol: psym, startTime: Date.now() - 30 * 86400000, endTime: Date.now(), limit: 10,
    })
    zeig(`Fills ${psym} (30 Tage)`, d)
    if ((d?.data?.fills || []).length) sichere('pionex-fills.json', d)
    else console.log('  \x1b[33mkeine Fills — Fixture nicht geschrieben\x1b[0m')
} catch (e) { console.log('\n\x1b[31mFills:', e.message, '\x1b[0m') }

console.log('\n\x1b[32mProbe beendet. Es wurde nichts geschrieben und nichts gehandelt.\x1b[0m')
process.exit(0)
