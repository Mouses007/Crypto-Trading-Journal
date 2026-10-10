/**
 * Selbsttest: Tiefensuche des Coin-Radars (die reinen Teile).
 *
 * Aufruf: node server/coin-radar/__selftest-tiefensuche.mjs
 */
import { vertraegeAus, waehleVertrag, vertragsAnteilTop10 } from './tiefensuche.js'
import { seitenBeleg } from '../hype-radar/projekt-bewertung.js'
import { ausRugCheck } from '../hype-radar/sicherheit.js'

let fehler = 0
let bestanden = 0
const p = (name, ok, zusatz = '') => {
    if (ok) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}
console.log('Coin-Radar: Tiefensuche')

// ── Verträge aus CoinGecko ──────────────────────────────────────────────
const v = vertraegeAus({ 'binance-smart-chain': '0xBB', ethereum: '0xEE', unichain: '0xUU', 'optimistic-ethereum': '0xOO', solana: '' })
p('Ketten vereinheitlicht, leere weg', v.map((x) => x.chain).join() === 'ethereum,bsc,optimism,unichain', v.map((x) => x.chain).join())
p('nicht prüfbare Kette markiert und hinten', v[3].pruefbar === false)

// ── Welcher Vertrag zählt ───────────────────────────────────────────────
p('der mit der meisten DEX-Liquidität', waehleVertrag([
    { chain: 'ethereum', pruefbar: true, liquiditaetUsd: 8000 }, { chain: 'bsc', pruefbar: true, liquiditaetUsd: 90000 },
])?.chain === 'bsc')
p('ohne Liquiditätsangabe der erste prüfbare', waehleVertrag([{ chain: 'x', pruefbar: false }, { chain: 'base', pruefbar: true }])?.chain === 'base')
p('nichts Prüfbares: keiner', waehleVertrag([{ chain: 'x', pruefbar: false }]) === null)

// ── Halter in Verträgen (LUMIA, 10.10.2026: zwei Verträge 89 %) ─────────
const h = [{ percent: 0.704, is_contract: 1 }, { percent: 0.185, is_contract: 1 }, { percent: 0.044, is_contract: 0 }]
p('Vertragsanteil der Top-10 (GoPlus-Bruchteile)', Math.round(vertragsAnteilTop10(h)) === 89, String(vertragsAnteilTop10(h)))
p('ohne Vertragsmerkmal unbekannt', vertragsAnteilTop10([{ percent: 0.5 }]) === null)

// ── Webseite von CoinGecko zugeordnet: belegt ───────────────────────────
const w = { status: 'ok', host: 'lumia.org', url: 'https://lumia.org/', domainAlterTage: 9000,
    fakten: { vertragAufSeite: 'fehlt', titel: 'Lumia', cashtags: [], titelCashtags: [], handelsLinks: 0 } }
p('ohne Quelle: alte Seite ohne Bezug gilt als fremd', seitenBeleg(w, { symbol: 'LUMIA' }).fremd === 'alteSeite')
p('mit CoinGecko-Zuordnung: belegt', seitenBeleg(w, { symbol: 'LUMIA', seiteBelegt: 'lumia.org' }).wie === 'quelle')
p('… auch wenn sie den Vertrag einer anderen Kette nennt',
    seitenBeleg({ ...w, fakten: { ...w.fakten, vertragAufSeite: 'fremd' } }, { symbol: 'LUMIA', seiteBelegt: 'www.lumia.org' }).eigen === true)
p('die Zuordnung gilt nur für genau diesen Host', seitenBeleg(w, { symbol: 'LUMIA', seiteBelegt: 'andere.org' }).wie !== 'quelle')

// ── Insider über dem Angebot ist kein Anteil (WIF: „307 %") ─────────────
const rc = (holding) => ({ token: { supply: 1000, decimals: 6 }, topHolders: [], markets: [], insiderNetworks: [{ currentHolding: holding }] })
p('Insider-Netze über dem Angebot: unbekannt', ausRugCheck(rc(3000))?.insider_anteil_pct === null)
p('Insider-Netze im Angebot: Anteil', ausRugCheck(rc(32))?.insider_anteil_pct === 3.2)

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
