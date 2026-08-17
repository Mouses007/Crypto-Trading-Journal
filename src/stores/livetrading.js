/**
 * Zustand einer Handelssitzung im Live-Trading-Fenster.
 *
 * Kein Pinia, sondern Modul-Level `ref`s — dasselbe Muster wie `stores/live.js`.
 * Die Wahrheit steht in der Tabelle `live_sessions`; hier liegt nur die gerade
 * laufende Sitzung, damit die Leiste und später die Kacheln sie sehen.
 *
 * ## Warum eine Sitzung überhaupt gespeichert wird
 *
 * Der Plan („höchstens 200 $ Verlust, höchstens 5 Trades") ist nur etwas wert,
 * wenn er VOR der Sitzung festgehalten wird und hinterher nachprüfbar ist.
 * Genau das ist der Zweck: nicht noch eine Statistik, sondern ein Beleg
 * darüber, was man sich vorgenommen hatte, als man noch ruhig war.
 *
 * ## Wiederaufnahme
 *
 * Ein Neuladen der Seite darf die Sitzung nicht verlieren. Die Id liegt
 * deshalb im localStorage; findet sich dort nichts (anderer Browser, anderes
 * Gerät), wird zusätzlich in der Datenbank nach einer noch offenen Sitzung
 * gesucht. Zwei gleichzeitig offene Sitzungen wären Unsinn — wer eine startet,
 * während eine läuft, bekommt die laufende zurück statt einer zweiten.
 */

import { ref, computed } from 'vue'
import { dbCreate, dbUpdate, dbFind } from '../utils/db.js'

const SPEICHER_KEY = 'livetrading_session'

/** Die laufende Sitzung, oder null. Feldnamen wie in der Tabelle. */
export const aktiveSitzung = ref(null)
export const sitzungFehler = ref('')

/** Tickt nur, solange eine Sitzung läuft — sonst zählt niemand mit. */
const jetzt = ref(Date.now())
let uhr = null

function starteUhr() {
    if (uhr) return
    uhr = setInterval(() => { jetzt.value = Date.now() }, 1000)
}

function stoppeUhr() {
    clearInterval(uhr)
    uhr = null
}

export const laufzeitMs = computed(() => {
    if (!aktiveSitzung.value) return 0
    return Math.max(0, jetzt.value - Number(aktiveSitzung.value.startUnix || 0))
})

export const laufzeitText = computed(() => {
    const s = Math.floor(laufzeitMs.value / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
})

// ── Protokoll ────────────────────────────────────────────────────────────

/**
 * Ereignis ins Sitzungsprotokoll schreiben.
 *
 * Wird gebündelt gespeichert: während einer Sitzung fallen Einträge in
 * Schüben an (Warnfenster beginnt, Zustand kippt, Notiz getippt), und für
 * jeden einzeln zu schreiben hiesse, die Datenbank im Sekundentakt zu
 * beschäftigen.
 */
export function protokolliere(art, text, daten = null) {
    if (!aktiveSitzung.value) return
    const eintrag = { t: Date.now(), art, text }
    if (daten) eintrag.daten = daten
    aktiveSitzung.value.protokoll = [...(aktiveSitzung.value.protokoll || []), eintrag]
    planeSpeichern()
}

let speicherTimer = null

/** 2 s Ruhe nach der letzten Änderung — Tippen im Notizfeld soll nicht senden. */
function planeSpeichern() {
    clearTimeout(speicherTimer)
    speicherTimer = setTimeout(speichereJetzt, 2000)
}

export async function speichereJetzt() {
    clearTimeout(speicherTimer)
    const s = aktiveSitzung.value
    if (!s?.objectId) return
    try {
        await dbUpdate('live_sessions', s.objectId, {
            notizen: s.notizen || '',
            protokoll: s.protokoll || [],
            planMaxVerlustUsd: Number(s.planMaxVerlustUsd) || 0,
            planMaxTrades: Number(s.planMaxTrades) || 0,
            planNotiz: s.planNotiz || '',
        })
    } catch (e) {
        sitzungFehler.value = e.response?.data?.error || e.message
    }
}

/**
 * Symbolwechsel während der Sitzung festhalten.
 *
 * Eine Sitzung ist ein Zeitraum, kein Markt — man schaut sich mehrere Münzen
 * an. Damit die Sitzung hinterher trotzdem nachspielbar bleibt, wandert jeder
 * Wechsel ins Protokoll, und `symbol` folgt der zuletzt gewählten: der
 * Wiedergabe-Knopf im Journal soll das zeigen, worauf man zuletzt gesehen hat.
 */
export function merkeSymbol(symbol) {
    const s = aktiveSitzung.value
    if (!s || !symbol || s.symbol === symbol) return
    const vorher = s.symbol
    s.symbol = symbol
    aktiveSitzung.value = { ...s }
    protokolliere('symbol', vorher ? `${vorher} → ${symbol}` : String(symbol))
}

/** Aus dem Notizfeld: merkt sich den Text und speichert verzögert. */
export function setzeNotizen(text) {
    if (!aktiveSitzung.value) return
    aktiveSitzung.value.notizen = text
    planeSpeichern()
}

// ── Starten, Beenden, Wiederaufnehmen ────────────────────────────────────

export async function starteSitzung({ symbol, market = 'futures', planMaxVerlustUsd = 0, planMaxTrades = 0, planNotiz = '', kacheln = {} }) {
    sitzungFehler.value = ''
    // Läuft schon eine? Dann die zurückgeben statt eine zweite anzulegen.
    const offen = await sucheOffene()
    if (offen) {
        aktiveSitzung.value = offen
        merkeId(offen.objectId)
        starteUhr()
        return offen
    }

    const jetztMs = Date.now()
    const daten = {
        startUnix: jetztMs,
        endUnix: 0,
        symbol: symbol || '',
        market,
        status: 'laufend',
        planMaxVerlustUsd: Number(planMaxVerlustUsd) || 0,
        planMaxTrades: Number(planMaxTrades) || 0,
        planNotiz,
        notizen: '',
        fazit: '',
        protokoll: [{ t: jetztMs, art: 'start', text: `Sitzung gestartet — ${symbol || 'ohne Symbol'}` }],
        kacheln,
        trades: [],
        pnlUsd: 0,
        tradeAnzahl: 0,
        planVerletzt: 0,
    }
    try {
        const angelegt = await dbCreate('live_sessions', daten)
        aktiveSitzung.value = { ...daten, objectId: angelegt.objectId ?? angelegt.id }
        merkeId(aktiveSitzung.value.objectId)
        starteUhr()
        return aktiveSitzung.value
    } catch (e) {
        sitzungFehler.value = e.response?.data?.error || e.message
        return null
    }
}

/**
 * Sitzung beenden: Trades im Zeitfenster einfrieren, P&L rechnen, schreiben.
 *
 * Ein Trade zählt zu der Sitzung, in der er GESCHLOSSEN wurde — dann ist die
 * P&L entstanden. Ein Trade, der vor der Sitzung eröffnet und während ihr
 * geschlossen wurde, gehört also dazu; einer, der noch offen ist, nicht.
 */
export async function beendeSitzung(fazit = '') {
    const s = aktiveSitzung.value
    if (!s?.objectId) return null
    const endeMs = Date.now()

    let trades = []
    let pnl = 0
    try {
        trades = await tradesImFenster(Number(s.startUnix), endeMs)
        pnl = trades.reduce((n, t) => n + (Number(t.netProceeds) || 0), 0)
    } catch (e) {
        // Die Sitzung trotzdem sauber schliessen — ein Abruffehler darf sie
        // nicht auf ewig als „laufend" stehen lassen.
        sitzungFehler.value = e.response?.data?.error || e.message
    }

    const maxVerlust = Number(s.planMaxVerlustUsd) || 0
    const maxTrades = Number(s.planMaxTrades) || 0
    const verletzt = (maxVerlust > 0 && pnl < -maxVerlust) || (maxTrades > 0 && trades.length > maxTrades)

    const daten = {
        endUnix: endeMs,
        status: 'beendet',
        fazit,
        notizen: s.notizen || '',
        protokoll: [...(s.protokoll || []), { t: endeMs, art: 'ende', text: 'Sitzung beendet' }],
        trades,
        pnlUsd: pnl,
        tradeAnzahl: trades.length,
        planVerletzt: verletzt ? 1 : 0,
    }
    try {
        await dbUpdate('live_sessions', s.objectId, daten)
    } catch (e) {
        sitzungFehler.value = e.response?.data?.error || e.message
        return null
    }
    const fertig = { ...s, ...daten }
    aktiveSitzung.value = null
    vergissId()
    stoppeUhr()
    return fertig
}

/**
 * Trades, die im Fenster geschlossen wurden.
 *
 * Das Journal legt Trades als TAGESZEILEN mit einem JSON-Array ab, deshalb
 * wird grosszügig auf Tagesebene geholt und danach auf die Sekunde geschnitten.
 * `entryTime`/`exitTime` stehen in Sekunden, nicht in Millisekunden.
 */
async function tradesImFenster(vonMs, bisMs) {
    const tagVon = Math.floor(vonMs / 1000 / 86400) * 86400
    const tagBis = Math.floor(bisMs / 1000 / 86400) * 86400
    const zeilen = await dbFind('trades', {
        greaterThanOrEqualTo: { dateUnix: tagVon },
        lessThanOrEqualTo: { dateUnix: tagBis },
    })
    const vonSek = Math.floor(vonMs / 1000)
    const bisSek = Math.ceil(bisMs / 1000)
    const raus = []
    for (const zeile of zeilen || []) {
        for (const t of zeile.trades || []) {
            const ende = Number(t.exitTime)
            if (!Number.isFinite(ende) || ende < vonSek || ende > bisSek) continue
            raus.push({
                symbol: t.symbol, side: t.side, strategy: t.strategy,
                entryTime: Number(t.entryTime) || 0, exitTime: ende,
                entryPrice: t.entryPrice, exitPrice: t.exitPrice,
                netProceeds: Number(t.netProceeds) || 0,
                grossProceeds: Number(t.grossProceeds) || 0,
                commission: Number(t.commission) || 0,
            })
        }
    }
    raus.sort((a, b) => a.exitTime - b.exitTime)
    return raus
}

/** Offene Sitzung suchen — erst über die gemerkte Id, dann in der Datenbank. */
async function sucheOffene() {
    try {
        const offene = await dbFind('live_sessions', {
            equalTo: { status: 'laufend' },
            descending: 'startUnix',
            limit: 1,
        })
        return offene?.[0] || null
    } catch {
        return null
    }
}

/**
 * Beim Betreten der Seite aufrufen. Findet eine noch offene Sitzung wieder —
 * auch dann, wenn der localStorage weg ist (anderer Browser).
 */
export async function ladeLaufende() {
    if (aktiveSitzung.value) return aktiveSitzung.value
    const offen = await sucheOffene()
    if (!offen) { vergissId(); return null }
    aktiveSitzung.value = offen
    merkeId(offen.objectId)
    starteUhr()
    return offen
}

/**
 * Sitzung abbrechen, ohne sie auszuwerten. Für den Fall, dass eine alte
 * Sitzung vergessen wurde und seit Stunden mitläuft — die Zahlen wären dann
 * ohnehin wertlos.
 */
export async function brichAb() {
    const s = aktiveSitzung.value
    if (!s?.objectId) return
    const endeMs = Date.now()
    try {
        await dbUpdate('live_sessions', s.objectId, {
            endUnix: endeMs, status: 'abgebrochen',
        })
    } catch (e) {
        sitzungFehler.value = e.response?.data?.error || e.message
    }
    aktiveSitzung.value = null
    vergissId()
    stoppeUhr()
}

const merkeId = (id) => localStorage.setItem(SPEICHER_KEY, String(id))
const vergissId = () => localStorage.removeItem(SPEICHER_KEY)
