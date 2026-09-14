/**
 * Stop-Wächter für den scharfen Betrieb auf Börsen ohne Stop-Order.
 *
 * ── Was er ist ──────────────────────────────────────────────────────────────
 * Auf Bitunix liegen Stop und Ziel im Buch der Börse; fällt das Journal aus,
 * greifen sie trotzdem. Pionex kennt keine Stop-Order über die API. Dort ist
 * dieser Takt der Stop — und mit ihm auch Break-Even, Teilausstieg und
 * Zeitausstieg, die für Live-Positionen bisher überhaupt nicht existierten
 * (`stepPaperPositions` ist für sie gesperrt, aus gutem Grund).
 *
 * ── Warum er nicht im Engine-Takt hängt ────────────────────────────────────
 * Die Engine taktet alle 15 s und arbeitet nur bei neuem Kerzenschluss. Ein
 * Stop, der erst zum Schluss der 15m-Kerze auslöst, ist kein Stop. Deshalb ein
 * eigener Takt von 3 s mit eigener Führungssperre und eigener, kürzerer
 * Nachsichtfrist: 20 s statt der 120 s der Engine — eine Zwei-Minuten-
 * Übernahmelücke wäre bei diesem Takt eine Zwei-Minuten-Lücke ohne Stop.
 *
 * ── Warum er auch bei CTJ_NO_ENGINE läuft ──────────────────────────────────
 * Er eröffnet nichts, er schliesst. Stirbt der NAS-Container, soll der
 * Dev-Rechner nach 20 s übernehmen, statt die Positionen ungesichert stehen zu
 * lassen. Abschalten ausdrücklich über `CTJ_NO_GUARD=1`.
 *
 * ── Der einzige Schutz gegen Doppelausführung ──────────────────────────────
 * Engine-Führung (120 s) und Wächter-Führung (20 s) können bei verschiedenen
 * Prozessen liegen; das ist zulässig. Was NICHT zulässig ist, ist eine zweite
 * Schliessorder für dieselbe Position. Davor schützt allein der atomare
 * Status-Claim `open → closing`. Jede neue Schreibstelle an
 * `strategy_positions` muss diesem Muster folgen.
 */

import { getKnex } from '../database.js'
import { ladeInstanz, schliessePositionManuell } from '../strategy-engine.js'
import { kostenAus, bucheTeilausstieg } from '../fill-simulator.js'
import { beansprucheFuehrung, verlaengereFuehrung, gibFuehrungFrei } from '../db-claim.js'
import { timeframeMs } from '../market-data.js'
import { holeAdapter, brauchtStopWaechter } from './index.js'
import { bewerteLiveSchutz } from './stop-regeln.js'
import { gleicheAb, bucheExternGeschlossen } from './abgleich.js'
import { logError, logWarn } from '../logger.js'

const WAECHTER_MS = 3000
const FUEHRUNG_KEY = 'stop_waechter'
const FUEHRUNG_TTL_MS = 20000
/** Nach so vielen vergeblichen Schliessversuchen gilt eine Position als unklar. */
const MAX_SCHLIESSVERSUCHE = 3
/** Jeder wievielte Durchgang gleicht mit der Börse ab (10 × 3 s ≈ 30 s). */
const ABGLEICH_JEDER = 10

let timer = null
let laeuft = false
let gestoppt = false
let hatFuehrung = false
let durchgaenge = 0
let ersterLauf = true
const versuche = new Map()          // positionId → Zahl der Fehlversuche

export const stand = {
    letzterSchlag: 0,
    ueberwacht: 0,
    aktionen: 0,
    fehler: 0,
    letzterFehler: '',
    fuehrung: false,
    letzterAbgleich: 0,
}

/**
 * Ein Durchgang.
 *
 * Bewusst als eigene, exportierte Funktion: so kann ein Selbsttest oder die
 * Inbetriebnahme sie einzeln auslösen, ohne den Takt zu starten.
 */
export async function durchgang() {
    if (gestoppt) return false
    if (laeuft) return false        // ein langsamer Durchgang darf nicht überholt werden
    laeuft = true
    try {
        if (!(await beansprucheFuehrung(FUEHRUNG_KEY, FUEHRUNG_TTL_MS))) {
            if (hatFuehrung) logWarn('stop-waechter', 'Führung verloren — ein anderer Prozess wacht jetzt')
            hatFuehrung = false
            stand.fuehrung = false
            return false
        }
        hatFuehrung = true
        stand.fuehrung = true

        durchgaenge++

        /*
         * Abgleich mit der Börse: beim ERSTEN Lauf zwingend, danach alle ~30 s.
         *
         * Der erste Lauf ist der wichtige. Nach einem Neustart weiss der
         * Wächter nicht, was während des Ausfalls geschehen ist — eine Position
         * kann längst extern geschlossen sein. Würde er ohne Abgleich losgehen,
         * sähe er einen Preis jenseits des Stops und schickte eine
         * Schliessorder für etwas, das es nicht mehr gibt.
         */
        if (ersterLauf || durchgaenge % ABGLEICH_JEDER === 0) {
            ersterLauf = false
            try {
                const r = await gleicheAb({ ladeInstanz, schliesseBuchung: bucheExternGeschlossen })
                stand.letzterAbgleich = Date.now()
                if (r.aktionen) stand.aktionen += r.aktionen
            } catch (e) {
                stand.fehler++
                stand.letzterFehler = e.message
                logError('stop-waechter', 'Abgleich fehlgeschlagen', e)
            }
            await verlaengereFuehrung(FUEHRUNG_KEY).catch(() => {})
        }

        const knex = getKnex()
        // 'closing' kommt mit: eine Zeile, deren Schliessung haengengeblieben
        // ist, muss erneut versucht werden — sonst bleibt sie fuer immer so.
        const zeilen = await knex('strategy_positions')
            .where('mode', 'live')
            .whereIn('status', ['open', 'closing'])

        stand.ueberwacht = zeilen.length
        stand.letzterSchlag = Date.now()
        if (!zeilen.length) return true

        // Nach Instanz gruppieren: Kontostand, Kosten und Parameter sind je
        // Instanz gleich, und die Börsenabfrage liefert ohnehin alle Positionen
        // auf einmal.
        const nachInstanz = new Map()
        for (const z of zeilen) {
            if (!nachInstanz.has(z.instanceId)) nachInstanz.set(z.instanceId, [])
            nachInstanz.get(z.instanceId).push(z)
        }

        for (const [instanceId, liste] of nachInstanz) {
            try {
                await pruefeInstanz(knex, instanceId, liste)
            } catch (e) {
                stand.fehler++
                stand.letzterFehler = e.message
                logError('stop-waechter', `Instanz ${instanceId} fehlgeschlagen`, e)
            }
            await verlaengereFuehrung(FUEHRUNG_KEY).catch(() => {})
        }
        return true
    } finally {
        laeuft = false
    }
}

async function pruefeInstanz(knex, instanceId, zeilen) {
    const row = await knex('strategy_instances').where('id', instanceId).first()
    const instance = row ? ladeInstanz(row) : null
    if (!instance) {
        // Eine offene Live-Position ohne lauffähige Instanz ist der
        // gefährlichste Zustand überhaupt: niemand schliesst sie. Deshalb laut,
        // bei jedem Takt.
        logError('stop-waechter', `Instanz ${instanceId} nicht ladbar, ${zeilen.length} Live-Position(en) unbewacht!`)
        return
    }
    if (!brauchtStopWaechter(instance.broker)) return    // Bitunix: die Börse hält den Stop

    const adapter = holeAdapter(instance.broker)
    const costs = kostenAus(instance.risk)

    // Ein Abruf für alle Positionen der Instanz: der Positions-Endpunkt liefert
    // den MARK-Preis mit, also genau den Preis, gegen den die Börse liquidiert.
    let boerse
    try {
        boerse = await adapter.holeOffenePositionen()
    } catch (e) {
        // Kein Preis heisst NICHT „nichts tun ist sicher" — aber blind
        // schliessen wäre schlimmer. Laut melden und beim nächsten Takt erneut.
        stand.fehler++
        stand.letzterFehler = e.message
        logError('stop-waechter', `Positionen von ${instance.broker} nicht abrufbar — Stops ungeprüft!`, e)
        return
    }

    const jetzt = Date.now()
    for (const zeile of zeilen) {
        const pos = boerse.find((p) => p.symbol === zeile.symbol && p.direction === zeile.direction && p.qty > 0)

        // Die Börse führt sie nicht mehr: extern geschlossen (Ziel-Limit,
        // Liquidation, Handgriff). Das löst der Abgleich auf, nicht der
        // Wächter — er würde sonst mit einem Marktpreis buchen, den es für
        // diesen Ausstieg nie gab.
        if (!pos) continue

        await knex('strategy_positions').where('id', zeile.id)
            .update({ guardAt: jetzt }).catch(() => {})

        const preis = Number(pos.markPrice) || Number(pos.entryPrice) || 0
        const urteil = bewerteLiveSchutz(zeile, preis, {
            costs,
            breakEvenAtR: instance.params.breakEvenAtR ?? instance.strategie?.regeln?.breakEvenAtR ?? 0,
            maxHoldMs: ((instance.params.maxHoldCandles ?? instance.strategie?.regeln?.maxHoldCandles ?? 0) || 0)
                * timeframeMs(zeile.timeframe || instance.timeframe),
            partialTpR: instance.params.partialTpR,
            partialTpPct: instance.params.partialTpPct,
            liqPreis: Number(pos.liquidationPrice) || 0,
            jetzt,
        })

        await handle({ knex, instance, zeile, pos, urteil, costs, jetzt })
    }
}

async function handle({ knex, instance, zeile, pos, urteil, costs, jetzt }) {
    switch (urteil.aktion) {
        case 'halten':
            // Break-Even-Nachzug ist kein Ausstieg, sondern eine Verbesserung.
            // Er geht ohne Claim, weil er nichts schliesst — und weil ein
            // verlorener Nachzug beim nächsten Takt wiederkommt.
            if (urteil.neuerStop > 0) {
                await knex('strategy_positions').where('id', zeile.id)
                    .update({ stopLoss: urteil.neuerStop, breakEvenDone: 1, updatedAt: knex.fn.now() })
                stand.aktionen++
            }
            return

        case 'liquidation':
            // Nicht schliessen — die Börse tut das gerade selbst, zu ihrem
            // Preis. Hier nur laut sein: der Stop hat versagt, das Margen-Netz
            // greift, und das ist ein Vorfall, kein Betriebsereignis.
            logError('stop-waechter',
                `${zeile.symbol}: Liquidationspreis erreicht (${urteil.preis}) — der Stop bei ${zeile.stopLoss} hat NICHT gegriffen`)
            return

        case 'teilausstieg':
            await teilausstieg({ knex, instance, zeile, urteil })
            return

        case 'stop':
        case 'ziel':
        case 'timeout':
            await schliesse({ knex, instance, zeile, urteil, costs, jetzt })
            return

        default:
            return
    }
}

/**
 * Vollständiges Schliessen.
 *
 * Reihenfolge wie beim Eröffnen, nur andersherum gedacht: ZUERST die Zeile
 * beanspruchen, dann die Börsen-Order. Wer zuerst sendet und dann beansprucht,
 * sendet bei einem Absturz dazwischen im nächsten Takt ein zweites Mal — und
 * `reduceOnly` schützt davor nur, solange die erste schon durch ist.
 */
async function schliesse({ knex, instance, zeile, urteil, costs, jetzt }) {
    const beansprucht = await knex('strategy_positions')
        .where('id', zeile.id).where('status', 'open')
        .update({ status: 'closing', exitGrund: urteil.grund, updatedAt: knex.fn.now() })

    // 0 Zeilen heisst: ein anderer Prozess (oder die HTTP-Route) ist schon
    // dran. Dann NICHT senden.
    if (!beansprucht && zeile.status !== 'closing') return

    const ergebnis = await schliessePositionManuell({
        instance,
        // Der Status in der uebergebenen Zeile muss zum DB-Stand passen, sonst
        // scheitert der Claim in `closePaperPositionManually` an sich selbst.
        positionRow: { ...zeile, status: 'closing' },
        price: urteil.preis,
        time: jetzt,
        costs,
        reason: urteil.grund,
    }).catch((e) => ({ ok: false, reason: e.message }))

    if (!ergebnis.ok) {
        const n = (versuche.get(zeile.id) || 0) + 1
        versuche.set(zeile.id, n)
        if (n >= MAX_SCHLIESSVERSUCHE) {
            // Nach drei Versuchen ist es kein Aussetzer mehr. 'unknown' hält
            // die Zeile aus allen automatischen Pfaden heraus und verlangt
            // eine Handprüfung — der Abgleich löst sie später auf.
            await knex('strategy_positions').where('id', zeile.id)
                .update({ status: 'unknown', updatedAt: knex.fn.now() })
            logError('stop-waechter',
                `${zeile.symbol}: ${n} Schliessversuche fehlgeschlagen (${ergebnis.reason}) — Position steht auf 'unknown', an der Börse prüfen!`)
        } else {
            // Zurück auf 'open', damit der nächste Takt es erneut versucht.
            await knex('strategy_positions').where('id', zeile.id)
                .where('status', 'closing')
                .update({ status: 'open', updatedAt: knex.fn.now() })
            logWarn('stop-waechter', `${zeile.symbol}: Schliessen fehlgeschlagen (${ergebnis.reason}), Versuch ${n}`)
        }
        stand.fehler++
        stand.letzterFehler = ergebnis.reason || 'close_failed'
        return
    }

    versuche.delete(zeile.id)
    stand.aktionen++

    // Ein stehengebliebenes Ziel-Limit im Buch wäre eine Order ohne Position.
    // `reduceOnly` sollte sie schützen — darauf verlassen wir uns nicht.
    if (zeile.externalTpOrderId) {
        const adapter = holeAdapter(instance.broker)
        if (typeof adapter.storniereOrder === 'function') {
            await adapter.storniereOrder({
                symbol: zeile.symbol, orderId: zeile.externalTpOrderId, mode: 'live',
            }).catch((e) => logWarn('stop-waechter', `Ziel-Order-Storno ${zeile.symbol}: ${e.message}`))
        }
    }
}

/**
 * Teilausstieg: einen Anteil der Position schliessen, den Rest laufen lassen.
 *
 * Reihenfolge wie überall in diesem Modul: ZUERST reservieren
 * (`partialDone = 1`), dann die Börsen-Order. Ohne die Reservierung nimmt
 * jeder 3-Sekunden-Takt einen weiteren Anteil, und die Position wäre binnen
 * einer Minute aufgelöst.
 *
 * Gebucht wird mit `bucheTeilausstieg` aus dem Fill-Simulator — derselben
 * Funktion, die Backtest und Papierbetrieb benutzen. Eine eigene Rechnung für
 * Live würde genau die Vergleichbarkeit zerstören, auf der die Freigabe-Tore
 * beruhen. Sie bekommt den ECHTEN Fill-Preis und rechnet nur die Aufteilung.
 */
async function teilausstieg({ knex, instance, zeile, urteil }) {
    const adapter = holeAdapter(instance.broker)
    if (typeof adapter.reduziere !== 'function') {
        logWarn('stop-waechter',
            `${zeile.symbol}: Teilausstieg fällig, aber ${instance.broker} kann nicht reduzieren — Position läuft unverändert weiter`)
        return
    }

    const beansprucht = await knex('strategy_positions')
        .where('id', zeile.id).where('partialDone', 0)
        .update({ partialDone: 1, updatedAt: knex.fn.now() })
    if (!beansprucht) return        // ein anderer Prozess war schneller

    const r = await adapter.reduziere({
        symbol: zeile.symbol,
        direction: zeile.direction,
        menge: urteil.menge,
        mode: 'live',
    }).catch((e) => ({ ok: false, reason: e.message }))

    if (!r.ok) {
        // Reservierung zurücknehmen, damit der nächste Takt es erneut versucht.
        // Ausnahme: eine Menge unter der Mindestgrösse wird nie gehen — die
        // Sperre bleibt stehen, sonst scheitert es bei jedem Takt aufs Neue.
        const aussichtslos = r.reason === 'unter_mindestmenge' || r.reason === 'menge_zu_klein'
        if (!aussichtslos) {
            await knex('strategy_positions').where('id', zeile.id)
                .update({ partialDone: 0, updatedAt: knex.fn.now() })
        }
        stand.fehler++
        stand.letzterFehler = r.reason || 'partial_failed'
        logWarn('stop-waechter', `${zeile.symbol}: Teilausstieg fehlgeschlagen (${r.reason})${aussichtslos ? ' — dauerhaft übersprungen' : ''}`)
        return
    }

    // Die Aufteilung durch dieselbe Funktion wie Backtest und Papier rechnen
    // lassen — sie schreibt partialQty/-Price/-Gross/-Fee und kürzt `qty`.
    const pos = {
        direction: zeile.direction,
        entryPrice: Number(zeile.entryPrice),
        qty: Number(zeile.qty),
        initialQty: Number(zeile.initialQty) || Number(zeile.qty),
    }
    const fillPreis = Number(r.fill?.price) || urteil.preis
    // `bucheTeilausstieg` erwartet einen Prozentsatz der RESTmenge; hier steht
    // die tatsächlich ausgeführte Menge fest, also wird sie zurückgerechnet.
    const anteilPct = pos.qty > 0 ? (r.menge / pos.qty) * 100 : 0
    bucheTeilausstieg(pos, fillPreis, anteilPct, kostenAus(instance.risk), Date.now())

    // Die echte Gebühr schlägt die gerechnete, wenn die Börse sie nennt.
    const gebuehr = Number.isFinite(Number(r.fill?.fee)) ? Number(r.fill.fee) : pos.partialFee

    await knex('strategy_positions').where('id', zeile.id).update({
        qty: pos.qty,
        partialQty: pos.partialQty,
        partialPrice: pos.partialPrice,
        partialGross: pos.partialGross,
        partialFee: gebuehr,
        updatedAt: knex.fn.now(),
    })
    stand.aktionen++
    logWarn('stop-waechter',
        `${zeile.symbol}: Teilausstieg ${r.menge} zu ${fillPreis} gebucht, Rest ${pos.qty}`)
}

// ── Takt ─────────────────────────────────────────────────────────────────

export function startStopWaechter() {
    if (process.env.CTJ_NO_GUARD === '1') {
        logWarn('stop-waechter', 'Durch CTJ_NO_GUARD=1 abgeschaltet — Live-Stops werden hier NICHT überwacht')
        return
    }
    if (timer) return
    gestoppt = false
    timer = setInterval(() => {
        durchgang().catch((e) => {
            stand.fehler++
            stand.letzterFehler = e.message
            logError('stop-waechter', 'Durchgang fehlgeschlagen', e)
        })
    }, WAECHTER_MS)
    if (typeof timer.unref === 'function') timer.unref()
}

export async function stopStopWaechter() {
    gestoppt = true
    ersterLauf = true          // nach einem Neustart wieder zwingend abgleichen
    if (timer) { clearInterval(timer); timer = null }
    if (hatFuehrung) {
        await gibFuehrungFrei(FUEHRUNG_KEY).catch(() => {})
        hatFuehrung = false
    }
}

/** Für die Statusanzeige in der Oberfläche. */
export function waechterStatus() {
    return {
        ...stand,
        laeuft: Boolean(timer),
        abgeschaltet: process.env.CTJ_NO_GUARD === '1',
        taktMs: WAECHTER_MS,
        alter: stand.letzterSchlag ? Date.now() - stand.letzterSchlag : null,
    }
}
