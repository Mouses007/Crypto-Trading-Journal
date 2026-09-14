/**
 * Selbsttest der Abgleich-Entscheidung — ohne Netz, ohne Datenbank.
 *
 *   node server/execution/__selftest-abgleich.mjs
 *
 * Der Abgleich ist die Stelle, an der das Journal entscheidet, ob eine Position
 * noch im Markt steht. Zwei Fehlerrichtungen, beide teuer und
 * unterschiedlich schlimm:
 *
 *   - **Zu frueh buchen.** Das Journal schliesst den Trade, waehrend die
 *     Position an der Boerse weiterlaeuft — und danach schaut niemand mehr auf
 *     sie. Das ist der schlimmere Fall.
 *   - **Zu spaet buchen.** Die Position blockiert `maxConcurrentPositions`, die
 *     Instanz handelt nicht mehr. Aergerlich, aber ungefaehrlich.
 *
 * Deshalb sind die Pruefungen hier nach dieser Richtung geordnet.
 */

import { entscheideAbgleich, PENDING_GNADE_MS, CLOSING_GNADE_MS } from './abgleich.js'

let bestanden = 0
let fehlgeschlagen = 0
const fehler = []

function check(name, ok, detail) {
    if (ok) { bestanden++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
    else { fehlgeschlagen++; fehler.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`) }
}

const JETZT = 1_700_000_000_000
const zeile = (o = {}) => ({
    id: 1, symbol: 'BTCUSDT', direction: 'long', qty: 0.01,
    status: 'open', entryTime: JETZT - 3600_000, updatedAtMs: JETZT - 3600_000,
    clientOrderId: 'ctj-7-4823', ...o,
})
const pos = (o = {}) => ({ symbol: 'BTCUSDT', direction: 'long', qty: 0.01, positionId: 'p1', ...o })

console.log('\nReservierungen (pending / unknown)\n')
{
    // Eine junge Reservierung gehoert der Engine, die gerade sendet.
    check('junge pending-Zeile wird in Ruhe gelassen',
        entscheideAbgleich({
            zeile: zeile({ status: 'pending', updatedAtMs: JETZT - 5000 }), jetzt: JETZT,
        }).fall === 'warten')

    check('nach der Gnadenfrist wird sie geprueft',
        entscheideAbgleich({
            zeile: zeile({ status: 'pending', updatedAtMs: JETZT - PENDING_GNADE_MS - 1 }), jetzt: JETZT,
        }).fall !== 'warten')

    // 'unknown' entsteht bei einem Transportfehler NACH dem Senden. Es gibt
    // keine Gnadenfrist — der Zustand ist per Definition schon unklar.
    check('unknown wird sofort geprueft, ohne Gnadenfrist',
        entscheideAbgleich({
            zeile: zeile({ status: 'unknown', updatedAtMs: JETZT - 1000 }), jetzt: JETZT,
        }).fall !== 'warten')

    check('Position existiert → Reservierung wird zur offenen Position',
        entscheideAbgleich({
            zeile: zeile({ status: 'unknown' }), boersenPosition: pos(), jetzt: JETZT,
        }).fall === 'oeffnen')

    check('Order gefuellt, aber keine Position mehr → buchen, nicht oeffnen',
        entscheideAbgleich({
            zeile: zeile({ status: 'unknown' }),
            order: { orderId: 'o1', gefuellt: true }, jetzt: JETZT,
        }).fall === 'buchen')

    const offen = entscheideAbgleich({
        zeile: zeile({ status: 'unknown' }),
        order: { orderId: 'o1', gefuellt: false }, jetzt: JETZT,
    })
    check('Order offen und ungefuellt → verwerfen', offen.fall === 'verwerfen')
    check('...und zwar MIT Storno (sonst fuellt sie irgendwann doch)', offen.storno === true)

    const nix = entscheideAbgleich({ zeile: zeile({ status: 'unknown' }), jetzt: JETZT })
    check('keine Order, keine Position → verwerfen', nix.fall === 'verwerfen')
    check('...ohne Storno, es gibt nichts zu stornieren', !nix.storno)
}

console.log('\nOffene Positionen\n')
{
    check('Boerse fuehrt sie, Menge stimmt → nichts tun',
        entscheideAbgleich({ zeile: zeile(), boersenPosition: pos(), jetzt: JETZT }).fall === 'warten')

    check('Boerse fuehrt sie nicht mehr → buchen',
        entscheideAbgleich({ zeile: zeile(), boersenPosition: null, jetzt: JETZT }).fall === 'buchen')

    /*
     * Die BOERSE gewinnt bei abweichender Menge. Eine DB-Zeile, die mehr
     * behauptet, wuerde beim Schliessen zu viel verkaufen — und aus einer
     * geschlossenen Position eine offene GEGENposition machen.
     */
    const ang = entscheideAbgleich({
        zeile: zeile({ qty: 0.01 }), boersenPosition: pos({ qty: 0.005 }), jetzt: JETZT,
    })
    check('abweichende Menge → angleichen', ang.fall === 'angleichen')
    check('...auf den Wert der BOERSE', ang.menge === 0.005)

    // Ein Prozent Toleranz, damit Rundungsreste keinen Schreibzugriff je Takt
    // ausloesen.
    check('Rundungsrest unter 1 % loest nichts aus',
        entscheideAbgleich({
            zeile: zeile({ qty: 0.01 }), boersenPosition: pos({ qty: 0.010005 }), jetzt: JETZT,
        }).fall === 'warten')

    // Menge 0 bei der Boerse ist keine "kleine Abweichung", sondern "weg".
    check('Boersenmenge 0 gilt als geschlossen, nicht als Abweichung',
        entscheideAbgleich({
            zeile: zeile(), boersenPosition: pos({ qty: 0 }), jetzt: JETZT,
        }).fall === 'buchen')
}

console.log('\nHaengende Schliessvorgaenge (closing)\n')
{
    check('Position ist weg → die Schliessung war erfolgreich, buchen',
        entscheideAbgleich({
            zeile: zeile({ status: 'closing' }), boersenPosition: null, jetzt: JETZT,
        }).fall === 'buchen')

    check('Position noch da, Vorgang jung → warten',
        entscheideAbgleich({
            zeile: zeile({ status: 'closing', updatedAtMs: JETZT - 5000 }),
            boersenPosition: pos(), jetzt: JETZT,
        }).fall === 'warten')

    check('Position noch da, Vorgang alt → erneut schliessen',
        entscheideAbgleich({
            zeile: zeile({ status: 'closing', updatedAtMs: JETZT - CLOSING_GNADE_MS - 1 }),
            boersenPosition: pos(), jetzt: JETZT,
        }).fall === 'erneut_schliessen')
}

console.log('\nSeiten und Symbole werden nicht verwechselt\n')
{
    /*
     * Die Zuordnung Boersenposition ↔ Zeile macht der Aufrufer, aber die
     * Entscheidung muss mit einer FALSCH zugeordneten Position sinnvoll
     * umgehen: sie kommt hier als null an, und das heisst "geschlossen".
     * Waere das anders, wuerde eine Gegenposition im selben Symbol eine
     * laengst geschlossene Zeile offen halten.
     */
    check('null-Position heisst geschlossen, egal was sonst im Symbol steht',
        entscheideAbgleich({ zeile: zeile({ direction: 'short' }), boersenPosition: null, jetzt: JETZT }).fall === 'buchen')
}

console.log('\nAbgeschlossene und unbekannte Zustaende\n')
{
    check('closed wird nicht angefasst',
        entscheideAbgleich({ zeile: zeile({ status: 'closed' }), jetzt: JETZT }).fall === 'warten')
    check('unbekannter Status wird nicht angefasst',
        entscheideAbgleich({ zeile: zeile({ status: 'quatsch' }), jetzt: JETZT }).fall === 'warten')
    check('leere Zeile faellt nicht um',
        entscheideAbgleich({ zeile: {}, jetzt: JETZT }).fall === 'warten')
}

console.log('\nJeder Fall nennt einen Grund\n')
{
    const faelle = [
        { zeile: zeile({ status: 'pending', updatedAtMs: JETZT - 1000 }) },
        { zeile: zeile({ status: 'unknown' }), boersenPosition: pos() },
        { zeile: zeile({ status: 'unknown' }), order: { orderId: 'o', gefuellt: true } },
        { zeile: zeile({ status: 'unknown' }), order: { orderId: 'o', gefuellt: false } },
        { zeile: zeile() },
        { zeile: zeile(), boersenPosition: pos({ qty: 0.005 }) },
        { zeile: zeile({ status: 'closing' }), boersenPosition: null },
        { zeile: zeile({ status: 'closing', updatedAtMs: JETZT - 99999 }), boersenPosition: pos() },
    ]
    const ohneGrund = faelle
        .map((f) => entscheideAbgleich({ ...f, jetzt: JETZT }))
        .filter((u) => !u.grund)
    check('alle acht Faelle sind begruendet', ohneGrund.length === 0, `${ohneGrund.length} ohne Grund`)

    const fallNamen = new Set(faelle.map((f) => entscheideAbgleich({ ...f, jetzt: JETZT }).fall))
    check('und decken alle Faelle ab', fallNamen.size >= 6, [...fallNamen].join(', '))
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`)
if (fehlgeschlagen) { console.log('Fehler:', fehler.join(', ')); process.exit(1) }
