/**
 * Selbsttest: Wartungsmargen-Parser (`margin-rates.js`).
 *
 * Läuft ohne Netz — geprüft wird nur, ob aus den beiden Antwortformaten die
 * richtige STUFE gezogen wird. Genau das ist die Stelle, an der ein Fehler
 * nicht auffällt: eine Rate aus Stufe 3 sieht aus wie eine gültige Zahl, und
 * die Karte zeichnet damit anstandslos Zonen an der falschen Stelle.
 *
 * Die Beispieldaten sind gekürzte Antworten vom 17.08.2026.
 *
 * Aufruf: node server/__selftest-margin-rates.mjs
 */
import { parseBinanceKlammern, parseBybitRisikolimit } from './margin-rates.js'

let fehler = 0
// Auch die bestandenen zählen: `scripts/run-selftests.mjs` liest das Zahlenpaar
// aus der Schlussmeldung. Ohne es zählte die ganze Datei als EINE Prüfung.
let bestanden = 0
const pruefe = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Wartungsmargen-Parser')

// ── Binance ────────────────────────────────────────────────────────────
const binanceRoh = {
    data: {
        brackets: [
            {
                symbol: 'BTCUSDT',
                riskBrackets: [
                    { bracketSeq: 1, bracketNotionalFloor: 0, bracketNotionalCap: 300000, bracketMaintenanceMarginRate: 0.004, maxOpenPosLeverage: 150 },
                    { bracketSeq: 2, bracketNotionalFloor: 300000, bracketNotionalCap: 4000000, bracketMaintenanceMarginRate: 0.005, maxOpenPosLeverage: 100 },
                ],
            },
            {
                // Umgekehrte Reihenfolge: die Nummer ist Anzeige, die
                // Untergrenze ist die Aussage.
                symbol: 'WIFUSDT',
                riskBrackets: [
                    { bracketSeq: 2, bracketNotionalFloor: 5000, bracketNotionalCap: 25000, bracketMaintenanceMarginRate: 0.025, maxOpenPosLeverage: 50 },
                    { bracketSeq: 1, bracketNotionalFloor: 0, bracketNotionalCap: 5000, bracketMaintenanceMarginRate: 0.01, maxOpenPosLeverage: 75 },
                ],
            },
            // Unbrauchbar: keine Stufe mit Untergrenze 0
            { symbol: 'KAPUTTUSDT', riskBrackets: [{ bracketSeq: 2, bracketNotionalFloor: 1000, bracketNotionalCap: 5000, bracketMaintenanceMarginRate: 0.02 }] },
            // Unbrauchbar: Rate 0
            { symbol: 'NULLUSDT', riskBrackets: [{ bracketSeq: 1, bracketNotionalFloor: 0, bracketNotionalCap: 5000, bracketMaintenanceMarginRate: 0 }] },
        ],
    },
}

const tabelle = parseBinanceKlammern(binanceRoh)
pruefe('BTC nimmt Stufe 1', tabelle.get('BTCUSDT')?.mmr === 0.004, `bekam ${tabelle.get('BTCUSDT')?.mmr}`)
pruefe('BTC-Obergrenze', tabelle.get('BTCUSDT')?.obergrenze === 300000)
pruefe('BTC-Stufenzahl', tabelle.get('BTCUSDT')?.stufen === 2)
pruefe('WIF trotz verdrehter Reihenfolge', tabelle.get('WIFUSDT')?.mmr === 0.01, `bekam ${tabelle.get('WIFUSDT')?.mmr}`)
pruefe('Symbol ohne Stufe 1 fällt raus', !tabelle.has('KAPUTTUSDT'))
pruefe('Rate 0 fällt raus', !tabelle.has('NULLUSDT'))
pruefe('Leere Antwort ergibt leere Tabelle', parseBinanceKlammern({}).size === 0)
pruefe('null ergibt leere Tabelle', parseBinanceKlammern(null).size === 0)

// ── Bybit ──────────────────────────────────────────────────────────────
const bybitRoh = {
    result: {
        list: [
            { symbol: 'SOLUSDT', riskLimitValue: '100000', maintenanceMargin: '0.0056', maxLeverage: '90.00', isLowestRisk: 0 },
            { symbol: 'SOLUSDT', riskLimitValue: '50000', maintenanceMargin: '0.005', maxLeverage: '100.00', isLowestRisk: 1 },
        ],
    },
}
const sol = parseBybitRisikolimit(bybitRoh)
pruefe('Bybit nimmt die markierte Stufe 1', sol?.mmr === 0.005, `bekam ${sol?.mmr}`)
pruefe('Bybit-Obergrenze', sol?.obergrenze === 50000)
pruefe('Bybit-Stufenzahl', sol?.stufen === 2)
pruefe('Bybit-Maxhebel', sol?.maxHebel === 100)

// Ohne Markierung gilt die kleinste Obergrenze — nicht die erste Zeile.
const ohneMarkierung = parseBybitRisikolimit({
    result: {
        list: [
            { riskLimitValue: '200000', maintenanceMargin: '0.02' },
            { riskLimitValue: '20000', maintenanceMargin: '0.01' },
        ],
    },
})
pruefe('Ohne isLowestRisk zählt die kleinste Grenze', ohneMarkierung?.mmr === 0.01, `bekam ${ohneMarkierung?.mmr}`)

pruefe('Leere Liste ergibt null', parseBybitRisikolimit({ result: { list: [] } }) === null)
pruefe('Fehlende Antwort ergibt null', parseBybitRisikolimit(null) === null)
pruefe('Rate 0 ergibt null', parseBybitRisikolimit({ result: { list: [{ riskLimitValue: '1', maintenanceMargin: '0', isLowestRisk: 1 }] } }) === null)

// ── Die beiden Börsen sind NICHT austauschbar ──────────────────────────
// Steht hier als Merkposten: wer hier später mitteln will, bricht diesen Test.
pruefe('Binance und Bybit weichen bei BTC ab', tabelle.get('BTCUSDT').mmr !== 0.005)

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
if (fehler) process.exit(1)
