/**
 * Selbsttest: LSOB-Boxen (lsobCv) und GUSS-Rücklauf (gussCv) gegen feste
 * Referenzfälle.
 *
 *   node shared/__selftest-cv-indikatoren.mjs
 *
 * Die Referenzen sind am 18.10.2026 im TradingView-Chart des Users abgelesen
 * (Binance-Perpetual, Standardeinstellungen der Indikatoren bzw. die des
 * Users: GUSS-Ziele EMA 50 + EMA 200, 1 Gegenkerze, Bestätigung 0). Die
 * Kerzen dazu liegen unter shared/fixtures/ — der Test läuft ohne Netz.
 * Wer eine Regel ändert, muss diese Fälle weiter treffen; eine neue
 * Abweichung gegen TradingView gehört hier als Fall dazu.
 */
import fs from 'node:fs'
import { lsobCv } from './lsobCv.js'
import { gussCv } from './gussCv.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []
function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
const lade = (datei) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${datei}`, import.meta.url))).kerzen.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const zeit = (t) => new Date(t).toISOString().slice(5, 16).replace('T', ' ')
const ab = (iso) => Date.parse(iso + 'Z')

const eth = lade('ethusdt-1h-2026-09-01_10-18.json')
const btc = lade('btcusdt-4h-2026-04-01_10-18.json')

console.log('\nLSOB — ETHUSDT.P 1h\n')
{
    const r = lsobCv(eth)
    const shortGueltig = r.boxen.filter((b) => b.seite === 'short' && b.gueltig && b.t >= ab('2026-10-05T12:00')).map((b) => zeit(b.t))
    const longGueltig = r.boxen.filter((b) => b.seite === 'long' && b.gueltig && b.t >= ab('2026-10-05T12:00')).map((b) => zeit(b.t))
    check('genau die vier Short-Boxen aus TradingView (06.10. 15:00, 12.10. 07:00, 14.10. 08:00, 16.10. 11:00)',
        JSON.stringify(shortGueltig) === JSON.stringify(['10-06 15:00', '10-12 07:00', '10-14 08:00', '10-16 11:00']), JSON.stringify(shortGueltig))
    check('keine gültige Long-Box (TradingView zeigt keine)', longGueltig.length === 0, JSON.stringify(longGueltig))
    const b = r.boxen.find((x) => zeit(x.t) === '10-16 11:00')
    check('Box = ganze Spanne der Pivot-Kerze (2462,84–2493,48)', b && b.tief === 2462.84 && b.hoch === 2493.48, JSON.stringify(b))
    check('Gegenprobe: 17.10. 10:00 ist ein Pivot-Hoch ohne Sweep → keine Box', !r.boxen.some((x) => zeit(x.t) === '10-17 10:00'))
}

console.log('\nLSOB — BTCUSDT.P 4h\n')
{
    const r = lsobCv(btc)
    const gueltig = r.boxen.filter((b) => b.gueltig && b.t >= ab('2026-09-01T00:00'))
    check('keine gültige Box seit September (TradingView zeigt keine)', gueltig.length === 0, JSON.stringify(gueltig.map((b) => [b.seite, zeit(b.t)])))
    const sig = r.signale.filter((s) => s.t >= ab('2026-09-05T00:00')).map((s) => `${s.seite} ${zeit(s.t)}`)
    for (const erwartet of ['short 09-09 08:00', 'short 09-20 16:00', 'short 10-04 08:00', 'long 10-12 20:00']) {
        check(`Signal wie in TradingView: ${erwartet}`, sig.includes(erwartet), JSON.stringify(sig))
    }
    check('Gegenprobe: kein Signal am 22.09. 20:00 (direkt nach der Bestätigung)', !sig.includes('short 09-22 20:00'))
}

console.log('\nGUSS — ETHUSDT.P 1h (Ziele EMA 50 + 200)\n')
{
    const r = gussCv(eth)
    const ev = r.ereignisse.filter((e) => e.startT >= ab('2026-10-04T00:00')).map((e) => `${e.seite} ${zeit(e.startT)} → ${e.status === 'entry' ? zeit(e.entryT) + ' ' + e.ziel : e.status}`)
    const erwartet = [
        'long 10-05 02:00 → 10-05 04:00 EMA 50',
        'short 10-13 00:00 → 10-13 03:00 EMA 50',
        'short 10-15 13:00 → 10-15 15:00 EMA 50',
        'short 10-17 21:00 → 10-18 03:00 EMA 50',
    ]
    for (const e of erwartet) check(`wie TradingView: ${e}`, ev.includes(e), JSON.stringify(ev))
    check('R-GUSS-Start am 18.10. 16:00 noch offen', ev.includes('short 10-18 16:00 → offen'), JSON.stringify(ev))
    check('Gegenprobe: ohne Trendfilter mehr Starts', gussCv(eth, { trendFilter: false, abstandFilter: false, preisFilter: false }).ereignisse.length > r.ereignisse.length)
}

console.log('\nGUSS — BTCUSDT.P 4h\n')
{
    const ev = gussCv(btc).ereignisse.filter((e) => e.startT >= ab('2026-09-25T00:00')).map((e) => `${e.seite} ${zeit(e.startT)} → ${e.status === 'entry' ? zeit(e.entryT) + ' ' + e.ziel : e.status}`)
    check('GUSS-Start 02.10. 08:00 mit Entry an der EMA 50 (TradingView: Start + Entry am 01./02.10.)', ev.includes('long 10-02 08:00 → 10-02 16:00 EMA 50'), JSON.stringify(ev))
    // Was das Bild zeigt: nur Starts mit Einstieg und der offene (verfallene werden ausgeblendet)
    const sichtbar = gussCv(btc).ereignisse.filter((e) => e.startT >= ab('2026-09-25T00:00') && e.status !== 'verfallen')
    check('sichtbar nur ein GUSS-Start im Bereich (wie TradingView)', sichtbar.filter((e) => e.seite === 'long').length === 1, JSON.stringify(sichtbar.map((e) => zeit(e.startT))))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
