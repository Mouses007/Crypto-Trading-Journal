/**
 * Selbsttest der Broker-Registry — ohne Netz, ohne Datenbank.
 *
 *   node server/execution/__selftest-broker-registry.mjs
 *
 * Zwei Dinge sollen hier knallen, bevor sie Geld kosten:
 *
 * 1. Ein Adapter, dem eine Vertragsfunktion fehlt. Das faellt sonst erst auf,
 *    wenn genau diese Funktion gebraucht wird — bei `closeLivePosition` also
 *    dann, wenn eine Position geschlossen werden MUSS.
 * 2. Ein unbekannter Broker-Name, der still auf Bitunix zurueckfaellt. Eine
 *    Instanz mit Tippfehler wuerde dann auf einer Boerse handeln, die der
 *    Nutzer fuer unbeteiligt haelt.
 */

import { holeAdapter, holeAdapterListe, kenntBroker, brauchtStopWaechter } from './index.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}
function wirft(fn) { try { fn(); return false } catch { return true } }

const PFLICHT = ['baueOrder', 'openLivePosition', 'closeLivePosition', 'getLiveEquity', 'getLivePositionId']

console.log('\nVertrag\n')
{
    const liste = holeAdapterListe()
    check('mindestens zwei Adapter registriert', liste.length >= 2, String(liste.length))

    for (const eintrag of liste) {
        const a = holeAdapter(eintrag.id)
        const fehlend = PFLICHT.filter((fn) => typeof a[fn] !== 'function')
        check(`${eintrag.id}: alle Pflichtfunktionen vorhanden`, fehlend.length === 0, fehlend.join(', '))
    }

    const ids = liste.map((a) => a.id)
    check('Kennungen sind eindeutig', new Set(ids).size === ids.length, ids.join(', '))
    check('jeder Adapter hat eine Beschriftung', liste.every((a) => a.label && a.label.length > 0))
}

console.log('\nFaehigkeiten sind vollstaendig beantwortet\n')
{
    const SCHLUESSEL = ['boersenStop', 'boersenZiel', 'positionsEndpunkt', 'hebelSetzbar',
        'margenmodusSetzbar', 'echterFillPreis', 'orderMeta', 'orderPerClientId']
    for (const eintrag of holeAdapterListe()) {
        const fehlend = SCHLUESSEL.filter((k) => typeof eintrag.faehigkeiten[k] !== 'boolean')
        check(`${eintrag.id}: keine unbeantwortete Faehigkeit`, fehlend.length === 0, fehlend.join(', '))
    }
}

console.log('\nAufloesung\n')
{
    check('bitunix aufloesbar', holeAdapter('bitunix').id === 'bitunix')
    check('pionex aufloesbar', holeAdapter('pionex').id === 'pionex')
    check('Grossschreibung und Leerraum stoeren nicht', holeAdapter('  PIONEX ').id === 'pionex')
    // Altbestand: Instanzen von vor der Broker-Spalte haben dort leer stehen.
    check('leerer Broker ist Altbestand → bitunix', holeAdapter('').id === 'bitunix')
    check('null ebenso', holeAdapter(null).id === 'bitunix')

    // Das Kernversprechen der Registry.
    check('unbekannter Broker WIRFT, statt auf bitunix zu fallen',
        wirft(() => holeAdapter('binance')))
    check('Tippfehler wirft ebenfalls', wirft(() => holeAdapter('pionx')))
    check('die Fehlermeldung nennt die bekannten Broker', (() => {
        try { holeAdapter('quatsch'); return false } catch (e) {
            return e.message.includes('bitunix') && e.message.includes('pionex')
        }
    })())

    check('kenntBroker antwortet ohne zu werfen',
        kenntBroker('pionex') === true && kenntBroker('binance') === false)
}

console.log('\nStop-Waechter-Bedarf\n')
{
    // Der ganze Grund fuer den Waechter: Pionex hat keine Stop-Order.
    check('Pionex braucht den Waechter', brauchtStopWaechter('pionex') === true)
    check('Bitunix braucht ihn nicht (Stop geht mit der Order raus)',
        brauchtStopWaechter('bitunix') === false)
    // Unbekannt heisst „sicherheitshalber ja" — nie „nein".
    check('unbekannter Broker gilt als waechterpflichtig',
        brauchtStopWaechter('binance') === true)
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
