/**
 * Selbsttest: Listungsprüfung des Hype-Radars.
 *
 * Ohne Netz — geprüft wird der reine Vergleichsteil. Wichtigster Fall: die
 * Unterscheidung zwischen „nicht gelistet" und „Liste war nicht abrufbar".
 * Fiele sie weg, würde der Börsenfilter bei einem Netzaussetzer den ganzen
 * Lauf leeren, und niemand sähe warum.
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
    bitunix: new Set(['BTC', 'PEPE', '1000SHIB']),
    bitget: new Set(['BTC', 'DOGE']),
    pionex: new Set(['BTC']),
}

// Treffer über mehrere Börsen
const btc = pruefeListung('BTC', listen)
p('BTC ist überall gelistet', btc.liste.length === 3, JSON.stringify(btc))
p('nichts unbekannt', btc.unbekannt.length === 0)

// Treffer auf einer Börse
const doge = pruefeListung('DOGE', listen)
p('DOGE nur auf Bitget', doge.liste.length === 1 && doge.liste[0] === 'bitget')

/*
 * Die 1000er-Schreibweise. Terminbörsen bündeln Kleinstpreis-Coins
 * (1000SHIB); wer nur das blanke Symbol vergleicht, hält genau die
 * Meme-Coins für ungelistet, um die es meistens geht.
 */
const shib = pruefeListung('SHIB', listen)
p('SHIB findet 1000SHIB', shib.liste.includes('bitunix'), JSON.stringify(shib))

// Kein Treffer ist ein klares Nein, kein Fehler.
const zzz = pruefeListung('ZZZQ', listen)
p('Unbekanntes Symbol: leere Liste, nichts unbekannt',
    zzz.liste.length === 0 && zzz.unbekannt.length === 0)

// Schreibweise egal
p('Kleinschreibung trifft trotzdem', pruefeListung('pepe', listen).liste.includes('bitunix'))

/*
 * Der wichtigste Fall: eine Börse ohne Liste (null) landet in `unbekannt`,
 * nicht in „nicht gelistet". Der Filter im Lauf lässt Unbekanntes durch.
 */
const teils = pruefeListung('DOGE', { ...listen, bitget: null })
p('ausgefallene Börse steht als unbekannt', teils.unbekannt.includes('bitget'), JSON.stringify(teils))
p('und taucht nicht als Listung auf', !teils.liste.includes('bitget'))

// Kaputte Eingaben
p('leeres Symbol gibt leere Antwort', pruefeListung('', listen).liste.length === 0)
p('fehlende Listen werfen nicht', pruefeListung('BTC', undefined).liste.length === 0)

console.log(`  ${bestanden} bestanden, ${fehler} fehlgeschlagen`)
process.exit(fehler === 0 ? 0 : 1)
