/**
 * Broker-Registry — welcher Adapter führt eine Instanz aus?
 *
 * Bis hierher importierte `strategy-engine.js` den Bitunix-Adapter hart, obwohl
 * `strategy_instances.broker` seit jeher existiert und gelesen wird. Die Spalte
 * war damit eine Angabe ohne Wirkung: eine Instanz konnte „pionex" sagen und
 * wäre auf Bitunix gelandet.
 *
 * Der Vertrag ist bewusst der von `bitunix.js` — der steht im Betrieb, also
 * hat er sich das Recht erworben, die Form vorzugeben. Neue Adapter erfüllen
 * ihn oder werden beim Start abgewiesen; ein fehlendes Stück soll nicht bei
 * der ersten echten Order auffallen.
 *
 * **Kein Rückfall auf einen Vorgabe-Broker.** `holeAdapter` wirft bei einem
 * unbekannten Namen. Ein stiller Fallback wäre der teuerste denkbare
 * Tippfehler: eine Order auf der falschen Börse, mit einem Konto, das der
 * Nutzer für unbeteiligt hält.
 */

import * as bitunix from './bitunix.js'
import * as pionex from './pionex.js'
import { logWarn } from '../logger.js'

/** Was jeder Adapter können muss. */
const PFLICHT = [
    'baueOrder',
    'openLivePosition',
    'closeLivePosition',
    'getLiveEquity',
    'getLivePositionId',
]

/**
 * Fähigkeiten, die jeder Adapter beantworten muss — mit Vorgabe `false`, damit
 * ein Adapter nichts durch Schweigen verspricht. Besonders `boersenStop`: wer
 * das Feld vergisst, gilt als „Stop muss überwacht werden", und das ist die
 * sichere Seite.
 */
const FAEHIGKEITEN_VORGABE = {
    boersenStop: false,
    boersenZiel: false,
    positionsEndpunkt: false,
    hebelSetzbar: false,
    margenmodusSetzbar: false,
    echterFillPreis: false,
    orderMeta: false,
    orderPerClientId: false,
}

/**
 * Bitunix trägt seine Kennung nicht selbst — die Datei ist älter als die
 * Registry. Statt sie dafür anzufassen (und damit den einzigen Pfad zu
 * berühren, der im Betrieb steht), wird sie hier beschrieben.
 */
const BESCHREIBUNG = {
    bitunix: {
        modul: bitunix,
        id: 'bitunix',
        label: 'Bitunix',
        faehigkeiten: {
            boersenStop: true,       // SL und TP gehen mit der Order raus
            boersenZiel: true,
            positionsEndpunkt: true,
            echterFillPreis: false,  // kein Fills-Endpunkt angebunden
            orderPerClientId: false, // clientId wird gesendet, aber nicht abgefragt
        },
    },
    pionex: {
        modul: pionex,
        id: pionex.id,
        label: pionex.label,
        faehigkeiten: pionex.faehigkeiten,
    },
}

const REGISTRY = new Map()

for (const [name, b] of Object.entries(BESCHREIBUNG)) {
    const adapter = {
        id: b.id,
        label: b.label,
        faehigkeiten: { ...FAEHIGKEITEN_VORGABE, ...(b.faehigkeiten || {}) },
        ...b.modul,
    }
    const fehlend = PFLICHT.filter((fn) => typeof adapter[fn] !== 'function')
    if (fehlend.length) {
        // Beim Modulimport werfen, nicht beim ersten Handel: ein Adapter, dem
        // `closeLivePosition` fehlt, fällt sonst genau dann auf, wenn eine
        // Position geschlossen werden muss.
        throw new Error(`Broker-Adapter "${name}" ist unvollständig: ${fehlend.join(', ')} fehlt`)
    }
    REGISTRY.set(name, adapter)
}

/**
 * Adapter zu einem Broker-Namen.
 * @throws bei unbekanntem Namen — absichtlich, siehe Dateikopf.
 */
export function holeAdapter(broker) {
    const name = String(broker || '').toLowerCase().trim() || 'bitunix'
    const a = REGISTRY.get(name)
    if (!a) {
        throw new Error(`Unbekannter Broker "${broker}" — bekannt sind: ${[...REGISTRY.keys()].join(', ')}`)
    }
    return a
}

/** Gibt es diesen Broker? Für Eingabeprüfungen, die nicht werfen sollen. */
export function kenntBroker(broker) {
    return REGISTRY.has(String(broker || '').toLowerCase().trim())
}

/** Für die Registry-Route und die Broker-Auswahl in der Oberfläche. */
export function holeAdapterListe() {
    return [...REGISTRY.values()].map((a) => ({
        id: a.id,
        label: a.label,
        faehigkeiten: a.faehigkeiten,
    }))
}

/**
 * Braucht dieser Broker einen Stop-Wächter im Journal?
 * Eigene Funktion, weil die Frage an mehreren Stellen gestellt wird und ein
 * `!faehigkeiten.boersenStop` verstreut im Code leicht zur Negation-Falle wird.
 */
export function brauchtStopWaechter(broker) {
    try {
        return !holeAdapter(broker).faehigkeiten.boersenStop
    } catch {
        logWarn('execution', `Stop-Wächter-Frage für unbekannten Broker "${broker}" — sicherheitshalber ja`)
        return true
    }
}
