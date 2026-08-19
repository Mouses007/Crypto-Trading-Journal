/**
 * Selbsttest: Listungsprüfung des Hype-Radars.
 *
 * Ohne Netz — geprüft wird der reine Vergleichsteil. Zwei Dinge müssen
 * stimmen: die Spot/Futures-Unterscheidung (ein Coin nur am Kassamarkt lässt
 * sich nicht shorten) und der Unterschied zwischen „nicht gelistet" und
 * „Liste war nicht abrufbar" — fiele er weg, leerte ein Netzaussetzer mit
 * eingeschaltetem Börsenfilter den ganzen Lauf, und niemand sähe warum.
 *
 * Aufruf: node server/hype-radar/__selftest-listungen.mjs
 */
import { pruefeListung } from './listungen.js'

let fehler = 0
let bestanden = 0
const p = (name, bedingung, zusatz = '') => {
    if (bedingung) { bestanden++; return }
    fehler++
    console.error(`  ✗ ${name}${zusatz ? ' — ' + zusatz : ''}`)
}

console.log('Hype-Radar: Listungen')

const listen = {
    bitunix: { spot: null, futures: new Set(['BTC', 'PEPE', '1000SHIB']) },
    bitget: { spot: new Set(['BTC', 'DOGE', 'NEU']), futures: new Set(['BTC', 'DOGE']) },
    pionex: { spot: new Set(['BTC']), futures: new Set(['BTC']) },
}

// Treffer über mehrere Börsen, mit Marktart
const btc = pruefeListung('BTC', listen)
p('BTC ist überall gelistet', btc.liste.length === 3, JSON.stringify(btc))
p('BTC bei Bitget mit Spot UND Futures',
    btc.liste.find((l) => l.boerse === 'bitget')?.spot === true
    && btc.liste.find((l) => l.boerse === 'bitget')?.futures === true)
p('Bitunix meldet nie Spot (keine Anbindung, keine Behauptung)',
    btc.liste.find((l) => l.boerse === 'bitunix')?.spot === false)

/*
 * Nur Spot ist die halbe Antwort: nicht hebelbar, nicht shortbar. Die
 * Unterscheidung muss durchkommen und darf nicht zu einem blossen
 * „gelistet" verschmelzen.
 */
const neu = pruefeListung('NEU', listen)
p('Nur-Spot-Listung wird als solche gemeldet',
    neu.liste.length === 1 && neu.liste[0].spot === true && neu.liste[0].futures === false,
    JSON.stringify(neu))

// 1000er-Schreibweise: Terminbörsen bündeln Kleinstpreis-Coins.
const shib = pruefeListung('SHIB', listen)
p('SHIB findet 1000SHIB im Futures-Markt',
    shib.liste.find((l) => l.boerse === 'bitunix')?.futures === true, JSON.stringify(shib))

// Kein Treffer ist ein klares Nein, kein Fehler.
const zzz = pruefeListung('ZZZQ', listen)
p('Unbekanntes Symbol: leere Liste, nichts unbekannt',
    zzz.liste.length === 0 && zzz.unbekannt.length === 0)

p('Kleinschreibung trifft trotzdem',
    pruefeListung('pepe', listen).liste.some((l) => l.boerse === 'bitunix'))

/*
 * Der wichtigste Fall: eine Börse ganz ohne Listen (null) landet in
 * `unbekannt`, nicht in „nicht gelistet". Der Filter im Lauf lässt
 * Unbekanntes durch.
 */
const teils = pruefeListung('DOGE', { ...listen, bitget: null })
p('ausgefallene Börse steht als unbekannt', teils.unbekannt.includes('bitget'), JSON.stringify(teils))
p('und taucht nicht als Listung auf', !teils.liste.some((l) => l.boerse === 'bitget'))

// Eine Börse, bei der nur EINE Liste fehlt, ist nicht unbekannt — die andere zählt.
const halb = pruefeListung('NEU', { bitget: { spot: new Set(['NEU']), futures: null } })
p('halb ausgefallene Börse zählt mit dem, was da ist',
    halb.liste.length === 1 && halb.unbekannt.length === 0, JSON.stringify(halb))

// Kaputte Eingaben
p('leeres Symbol gibt leere Antwort', pruefeListung('', listen).liste.length === 0)
p('fehlende Listen werfen nicht', pruefeListung('BTC', undefined).liste.length === 0)

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
