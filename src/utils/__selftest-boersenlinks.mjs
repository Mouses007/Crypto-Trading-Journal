/**
 * Selbsttest: Handelsseiten der Börsen (Hype-Radar → Börsen).
 *
 * Aufruf: node src/utils/__selftest-boersenlinks.mjs
 */
import { listungUrl, LISTUNG_URL, coingeckoSuche } from './boersenLinks.js'
import { BOERSEN } from '../../server/hype-radar/boersenwacht-bewertung.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}
console.log('Börsen-Links (Listungen)')

// Jede beobachtete Börse ausser Alpha hat ein Muster — eine neue Börse ohne Link fiele sonst still durch.
for (const b of BOERSEN) {
    if (b.id === 'binance-alpha') continue
    p(`Muster für ${b.name}`, typeof LISTUNG_URL[b.id] === 'function')
}
p('OKX in Kleinbuchstaben (live geprüft)', listungUrl('okx', 'xinfq') === 'https://www.okx.com/trade-spot/xinfq-usdt')
p('Gate mit Unterstrich', listungUrl('gate', 'TQQQX') === 'https://www.gate.com/trade/TQQQX_USDT')
p('Binance Futures als Perp', listungUrl('binance-futures', 'zcsh') === 'https://www.binance.com/en/futures/ZCSHUSDT')
p('Alpha ohne Vertrag: kein Link', listungUrl('binance-alpha', 'X') === null)
p('Alpha mit Vertrag: DexScreener', listungUrl('binance-alpha', 'X', { chain: 'bsc', contract: '0xabc' }) === 'https://dexscreener.com/bsc/0xabc')
p('unbekannte Börse: kein Link', listungUrl('irgendwo', 'X') === null)
p('leeres Kürzel: kein Link', listungUrl('okx', '') === null)
p('Sonderzeichen werden kodiert', !/[ /]/.test(listungUrl('mexc', 'A B/C').split('/exchange/')[1]))
p('CoinGecko-Suche', coingeckoSuche('SOL') === 'https://www.coingecko.com/en/search?query=SOL')

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
