/**
 * Golden-Master-Test des Journal-Kerns.
 *
 *   node src/utils/__selftest-journal.mjs                 # vergleichen
 *   JOURNAL_GOLDEN_SCHREIBEN=1 node src/utils/__selftest-journal.mjs   # Stand einfrieren
 *
 * Wozu: Der Journal-Kern (Import → Tageszeilen → Filter → Summen → Gruppen →
 * Gewinnanalyse → Diagramm-Daten → Kalender) hatte keinen einzigen Test, und
 * er wird neu geschrieben (LIZENZ-PLAN.md, Pakete A–E). Ein Neubau darf
 * anders aussehen, aber er muss dieselben Zahlen liefern. Dieser Test friert
 * ein, was der HEUTIGE Code aus einem festen Datensatz macht, und meldet
 * jede Abweichung mit ihrem Pfad.
 *
 * Er prüft nicht, ob die Zahlen RICHTIG sind — nur, dass sie gleich bleiben.
 * Ein bekannter Fehler im heutigen Code steht deshalb mit im Golden Master;
 * wer ihn beim Neubau behebt, schreibt den Stand bewusst neu und sagt im
 * Commit, welche Zahl sich warum geändert hat.
 *
 * Bekannt und mit eingefroren (19.10.2026): `useGroupTrades` setzt die
 * Tag-Gruppen (`groups.group_*`) nicht zurück. Ein Szenario sieht dort die
 * Trades des VORHERIGEN — im Szenario „nurAgent" (1 Trade) stehen 36 bzw. 49
 * fremde Trades in group_1/group_2. Im Dashboard heisst das: nach einem
 * Filterwechsel zeigen die Tag-Diagramme noch den alten Filter. Die
 * Reihenfolge der Szenarien ist deshalb Teil des Golden Masters.
 *
 * Datensatz: synthetisch und deterministisch (fester Zufallskeim), damit keine
 * echten Kontodaten ins Repo gelangen. Er läuft durch den ECHTEN Importpfad
 * (`useQuickApiImport` mit nachgebauten Börsenantworten von Bitunix, Bitget
 * und Pionex), deckt Sommerzeitwechsel in EU und USA, Schliessungen um
 * Mitternacht UTC, Break-even, Funding beider Vorzeichen, Bot- und
 * Agent-Trades, Tag-, Zufriedenheits-, Exkursions- und Notizzeilen ab.
 *
 * Die Attrappen für DB, Netz, ECharts, Kontostand und i18n stehen in
 * `__journal-attrappen.mjs`.
 */

// Vor allem anderen: `dayjs.unix(x).day()` im Gruppieren rechnet in der
// Zeitzone des PROZESSES. Ohne feste Zone hinge das Ergebnis vom Rechner ab.
process.env.TZ = 'Europe/Zurich'

import { register } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

register('./__journal-attrappen.mjs', import.meta.url)

const GOLDEN = fileURLToPath(new URL('./fixtures/journal-golden.json', import.meta.url))
const SCHREIBEN = process.env.JOURNAL_GOLDEN_SCHREIBEN === '1'

// ---------------------------------------------------------------------------
// Browser-Umgebung, soweit der Kern sie anfasst
// ---------------------------------------------------------------------------

const ablage = new Map()
globalThis.localStorage = {
    getItem: (k) => (ablage.has(k) ? ablage.get(k) : null),
    setItem: (k, v) => { ablage.set(k, String(v)) },
    removeItem: (k) => { ablage.delete(k) },
}

// Diagramm-Elemente, wie sie Dashboard.vue anlegt. Sichtbar (clientWidth > 0),
// sonst überspringt useECharts sie wie einen versteckten Bootstrap-Tab.
const DIAGRAMM_IDS = [
    'pieChart1', 'pieChart2', 'pieChart3', 'perfChart1', 'feesChart1', 'symbolChart1', 'weekdayChart1',
    'entryTimeChart1', 'durationChart1', 'positionChart1', 'strategyChart1', 'lineBarChart1',
    'barChart1', 'barChart2', 'barChartNegative12', 'barChartNegative14', 'heatmapChart1',
]
const element = (id) => ({ id, clientWidth: 600, clientHeight: 300, style: {}, addEventListener() {} })
globalThis.window = { addEventListener() {}, removeEventListener() {}, innerHeight: 900, innerWidth: 1400, performance: globalThis.performance }
globalThis.document = {
    getElementById: (id) => element(id),
    querySelectorAll: (sel) => {
        const m = /^\[id\^="([^"]+)"\]$/.exec(sel)
        return m ? DIAGRAMM_IDS.filter(id => id.startsWith(m[1])).map(element) : []
    },
    documentElement: { setAttribute() {} },
    // Vue legt beim Laden ein <template> an
    createElement: () => ({ setAttribute() {}, content: {}, style: {} }),
}

// ---------------------------------------------------------------------------
// Deterministischer Datensatz
// ---------------------------------------------------------------------------

function zufall(keim) {
    let a = keim >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
const r = zufall(20261019)
const wahl = (liste) => liste[Math.floor(r() * liste.length)]
const runde = (x, n) => Math.round(x * 10 ** n) / 10 ** n
const ms = (iso) => Date.parse(iso)

const SYMBOLE = [['BTCUSDT', 60000, 3], ['ETHUSDT', 3000, 2], ['SOLUSDT', 150, 2], ['XRPUSDT', 1.5, 4], ['HBARUSDT', 0.12, 5], ['1000PEPEUSDT', 0.011, 6]]

// Zeitraum über beide Sommerzeitwechsel der EU (26.10.2025, 29.03.2026) und
// den der USA (08.03.2026): Kalender und Wochentags-Gruppen zählen dort gern
// eine Stunde doppelt oder gar nicht.
const VON = ms('2025-10-20T00:00:00Z')
const BIS = ms('2026-04-12T00:00:00Z')
const zeitpunkt = () => VON + Math.floor(r() * (BIS - VON))

function preisPaar(basis, stellen) {
    const ein = runde(basis * (0.8 + r() * 0.4), stellen)
    const bewegung = (r() - 0.5) * 0.04
    return [ein, runde(ein * (1 + bewegung), stellen)]
}

function bitunixPosition(n, feste = {}) {
    const [symbol, basis, stellen] = wahl(SYMBOLE)
    const [ein, aus] = preisPaar(basis, stellen)
    const lang = r() < 0.55
    const menge = runde(1000 / ein * (0.5 + r() * 3), 3)
    const brutto = (lang ? aus - ein : ein - aus) * menge
    const gebuehr = runde(menge * (ein + aus) * 0.0006, 6)
    const funding = r() < 0.3 ? runde((r() - 0.5) * 2, 6) : 0
    const auf = zeitpunkt()
    const zu = auf + Math.floor(60_000 + r() * 30 * 3600_000)
    const pos = {
        positionId: String(7800000000000000000n + BigInt(n) * 7919n),
        symbol,
        side: lang ? wahl(['LONG', 'BUY']) : wahl(['SHORT', 'SELL']),
        entryPrice: String(ein),
        closePrice: String(aus),
        maxQty: String(menge),
        fee: String(r() < 0.5 ? -gebuehr : gebuehr),
        funding: String(funding),
        realizedPNL: String(runde(brutto - gebuehr + funding, 8)),
        ctime: String(auf),
        mtime: String(zu),
    }
    return Object.assign(pos, feste)
}

function bitgetPosition(n, feste = {}) {
    const [symbol, basis, stellen] = wahl(SYMBOLE)
    const [ein, aus] = preisPaar(basis, stellen)
    const lang = r() < 0.5
    const menge = runde(800 / ein * (0.5 + r() * 2), 3)
    const pnl = runde((lang ? aus - ein : ein - aus) * menge, 8)
    const openFee = runde(menge * ein * 0.0006, 8)
    const closeFee = runde(menge * aus * 0.0006, 8)
    const funding = r() < 0.4 ? runde((r() - 0.5), 8) : 0
    const auf = zeitpunkt()
    const zu = auf + Math.floor(120_000 + r() * 20 * 3600_000)
    const netto = runde(pnl - openFee - closeFee + funding, 8)
    // Bitget schreibt die Zeitfelder je nach Endpunkt gross oder klein, und
    // netProfit fehlt manchmal oder ist leer — alle vier Fälle kommen vor.
    const gross = r() < 0.5
    const netzFall = n % 4
    const pos = {
        positionId: String(1100000000000000000n + BigInt(n) * 104729n),
        symbol,
        holdSide: lang ? 'long' : wahl(['short', 'SHORT']),
        openAvgPrice: String(ein),
        closeAvgPrice: String(aus),
        openTotalPos: String(menge),
        closeTotalPos: String(menge),
        pnl: String(pnl),
        openFee: String(-openFee),
        closeFee: String(-closeFee),
        totalFunding: String(funding),
        ...(gross ? { cTime: String(auf), uTime: String(zu) } : { ctime: String(auf), utime: String(zu) }),
    }
    if (netzFall === 0) pos.netProfit = String(netto)
    else if (netzFall === 1) pos.netProfit = ''
    else if (netzFall === 2) pos.netProfit = String(runde(netto * 0.98, 8))
    return Object.assign(pos, feste)
}

function pionexBot(n, feste = {}) {
    const [symbol, basis, stellen] = wahl(SYMBOLE.slice(0, 3))
    const [ein, aus] = preisPaar(basis, stellen)
    const auf = zeitpunkt()
    const zu = auf + Math.floor(3600_000 + r() * 72 * 3600_000)
    const gewinn = runde((r() - 0.4) * 40, 6)
    // positionId = buOrderId setzt der Server (pionex-api.js), nicht die Börse
    return Object.assign({
        positionId: `bot-${1000 + n}`,
        buOrderId: `bot-${1000 + n}`,
        botType: 'futures_grid',
        symbol,
        // Richtung liefert der Server mal mit, mal nicht (dann aus den Preisen)
        side: n % 3 === 0 ? undefined : (n % 3 === 1 ? 'LONG' : 'SHORT'),
        totalRealizedProfit: String(gewinn),
        totalFee: String(runde(r() * 3, 6)),
        totalFundingFee: String(runde((r() - 0.5) * 2, 6)),
        totalVolume: String(runde(2000 + r() * 8000, 2)),
        setLeverage: String(wahl([3, 5, 10])),
        positionOpenPrice: String(ein),
        closedPrice: String(aus),
        createTime: String(auf),
        closeTime: String(zu),
        initQuoteInvestment: '500',
        gridProfit: String(runde(gewinn * 0.7, 6)),
        marginCoin: 'USDT',
        pnlUsdt: String(gewinn),
        investUsdt: '500',
        quoteCloseP: String(aus),
    }, feste)
}

function baueBoersenAntworten() {
    const bitunix = Array.from({ length: 70 }, (_, i) => bitunixPosition(i))
    // Randfälle mit festen Werten
    bitunix.push(bitunixPosition(70, { realizedPNL: '0', fee: '0', funding: '0' }))                      // exakt Break-even
    bitunix.push(bitunixPosition(71, { ctime: String(ms('2026-01-14T22:10:00Z')), mtime: String(ms('2026-01-14T23:59:59Z')) })) // letzte Sekunde des UTC-Tages
    bitunix.push(bitunixPosition(72, { ctime: String(ms('2026-01-14T23:50:00Z')), mtime: String(ms('2026-01-15T00:00:01Z')) })) // erste Sekunde des nächsten
    bitunix.push(bitunixPosition(73, { ctime: String(ms('2026-03-29T00:30:00Z')), mtime: String(ms('2026-03-29T01:30:00Z')) })) // EU-Sommerzeitnacht
    bitunix.push(bitunixPosition(74, { ctime: String(ms('2025-10-26T00:20:00Z')), mtime: String(ms('2025-10-26T01:20:00Z')) })) // EU-Winterzeitnacht
    bitunix.push(bitunixPosition(75, { mtime: undefined }))                                                // ohne mtime → ctime
    for (let i = 76; i < 80; i++) bitunix.push(bitunixPosition(i, { ctime: String(ms('2026-02-10T08:00:00Z') + i * 600_000), mtime: String(ms('2026-02-10T09:00:00Z') + i * 600_000) })) // viele an einem Tag

    const bitget = Array.from({ length: 28 }, (_, i) => bitgetPosition(i))

    const pionex = Array.from({ length: 8 }, (_, i) => pionexBot(i))
    pionex.push(pionexBot(8, { botType: 'spot_grid', spotGrid: true, totalRealizedProfit: undefined, totalFundingFee: undefined, gridProfit: '12.5', realizedProfit: '-3.25', totalFeeInQuote: '1.75', usdtInvestment: '800', totalVolume: undefined }))
    pionex.push(pionexBot(9, { coinM: true, marginCoin: 'SOL', pnlUsdt: '41.2', totalRealizedProfit: '0.28' }))
    // reguläre Futures-Position ohne Bot-Kennzeichen
    pionex.push({ positionId: 'px-42', symbol: 'ETHUSDT', positionSide: 'SHORT', realizedPnl: '-7.5', fee: '1.1', fundingFee: '-0.4', netSize: '0.8', avgEntryPrice: '3100', avgClosePrice: '3109', openTime: String(ms('2026-02-20T10:00:00Z')), closeTime: String(ms('2026-02-20T15:00:00Z')) })

    return { bitunix, bitget, pionex }
}

// ---------------------------------------------------------------------------
// Vergleich
// ---------------------------------------------------------------------------

/**
 * Funktionen und Farbverläufe fallen weg, Zahlen bleiben Zahlen. Bei den
 * Diagrammen interessiert nur, WAS gezeichnet wird (Reihen, Kategorien,
 * Legende) — Gestaltung ist Sache des Neubaus.
 */
const sauber = (x) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'function' ? undefined : v)))

function diagrammDaten(option) {
    if (!option) return null
    const liste = (x) => (x == null ? [] : Array.isArray(x) ? x : [x])
    return sauber({
        series: liste(option.series).map(s => ({ name: s.name, type: s.type, data: s.data })),
        xAxis: liste(option.xAxis).map(a => a?.data),
        yAxis: liste(option.yAxis).map(a => a?.data),
        legend: liste(option.legend).map(l => l?.data),
    })
}

// Summenreihenfolge darf sich im Neubau ändern — 1e-9 relativ fängt Rundung,
// nicht echte Abweichungen (die kleinste Gebühr im Datensatz ist ~1e-4).
// Ganze Zahlen (Zeitstempel, Zähler) müssen exakt stimmen: relativ 1e-9 wäre
// bei einem Zeitstempel um 1,7 Mrd. fast zwei Sekunden Spielraum.
function gleichZahl(a, b) {
    if (a === b) return true
    if (Number.isNaN(a) && Number.isNaN(b)) return true
    if (Number.isInteger(a) && Number.isInteger(b)) return false
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
}

function vergleiche(ist, soll, pfad, fehler) {
    if (fehler.length >= 25) return
    if (typeof soll === 'number' && typeof ist === 'number') {
        if (!gleichZahl(ist, soll)) fehler.push(`${pfad}: ${ist} statt ${soll}`)
        return
    }
    if (soll === null || typeof soll !== 'object' || ist === null || typeof ist !== 'object') {
        if (ist !== soll) fehler.push(`${pfad}: ${JSON.stringify(ist)?.slice(0, 80)} statt ${JSON.stringify(soll)?.slice(0, 80)}`)
        return
    }
    if (Array.isArray(soll) !== Array.isArray(ist)) { fehler.push(`${pfad}: Art geändert (Liste ↔ Objekt)`); return }
    const schluessel = new Set([...Object.keys(soll), ...Object.keys(ist)])
    for (const k of schluessel) {
        if (!(k in ist)) { fehler.push(`${pfad}.${k}: fehlt`); continue }
        if (!(k in soll)) { fehler.push(`${pfad}.${k}: neu hinzugekommen`); continue }
        vergleiche(ist[k], soll[k], `${pfad}.${k}`, fehler)
    }
}

// ---------------------------------------------------------------------------
// Lauf
// ---------------------------------------------------------------------------

const stilleLog = console.log
const fehlerMeldungen = []
console.log = () => {}
console.time = () => {}
console.timeEnd = () => {}
console.warn = () => {}
console.error = (...a) => { fehlerMeldungen.push(a.map(x => (x instanceof Error ? x.stack : String(x))).join(' ')) }

const ui = await import('../stores/ui.js')
const filter = await import('../stores/filters.js')
const st = await import('../stores/trades.js')
const { currentUser } = await import('../stores/settings.js')
const quick = await import('./quickImport.js')
const kern = await import('./trades.js')
const tage = await import('./daily.js')
const kalender = await import('./calendar.js')
const charts = await import('./charts.js')

const netz = baueBoersenAntworten()
globalThis.__journalDaten = {
    trades: [],
    settings: [{
        objectId: '1',
        accounts: [{ value: 'bitunix', label: 'bitunix' }],
        tags: [
            { id: 'group_1', name: 'Strategie', color: '#026b00', tags: [{ id: 'tag_1', name: 'LSOB' }, { id: 'tag_2', name: 'GUSS' }, { id: 'tag_3', name: 'Breakout' }] },
            { id: 'group_2', name: 'Fehler', color: '#f77118', tags: [{ id: 'tag_4', name: 'FOMO' }, { id: 'tag_5', name: 'SL verschoben' }] },
        ],
    }],
    incoming_positions: [],
    notes: [], tags: [], satisfactions: [], excursions: [],
}
currentUser.value = { accounts: [{ value: 'bitunix', label: 'bitunix' }] }

const ergebnis = {}

// --- 1. Import -------------------------------------------------------------
// Bitunix in zwei Stücken, das zweite überlappt das erste: Doppelte müssen
// verworfen, neue an bestehende Tage angehängt werden.
const bx = netz.bitunix
globalThis.__journalDaten.incoming_positions.push({
    objectId: '1', status: 'open', positionId: bx[3].positionId, symbol: bx[3].symbol,
    stressLevel: 3, feelings: 'ruhig', playbook: '<p>Plan eingehalten</p>',
})
const importe = []
for (const [boerse, positionen] of [['bitunix', bx.slice(0, 45)], ['bitunix', bx.slice(30)], ['bitget', netz.bitget], ['pionex', netz.pionex], ['pionex', netz.pionex]]) {
    globalThis.__journalNetz = { [`/api/${boerse}/quick-import`]: { ok: true, positions: positionen } }
    const antwort = await quick.useQuickApiImport(boerse)
    importe.push({ boerse, ...antwort })
}
// Leere Antwort und Fehlerantwort
globalThis.__journalNetz = { '/api/bitget/quick-import': { ok: true, positions: [] } }
importe.push({ boerse: 'bitget-leer', ...(await quick.useQuickApiImport('bitget')) })
globalThis.__journalNetz = { '/api/bitget/quick-import': { ok: false, error: 'Schlüssel abgelaufen' } }
try { await quick.useQuickApiImport('bitget'); importe.push({ boerse: 'bitget-fehler', geworfen: false }) }
catch (e) { importe.push({ boerse: 'bitget-fehler', geworfen: true, meldung: e.message }) }

// Manueller Trade auf einen bestehenden und einen neuen Tag
const erster = globalThis.__journalDaten.trades.find(z => z.broker === 'bitunix')
for (const [td, symbol, gross] of [[erster.dateUnix, 'BTCUSDT', 25.5], [ms('2026-04-05T00:00:00Z') / 1000, 'SOLUSDT', -12.25]]) {
    await quick.saveManualTrade(quick.buildTradeObj({
        id: `t${td}_m_${symbol}`, broker: 'bitunix', td, side: gross > 0 ? 'B' : 'SS', quantity: 2,
        entryTime: td + 3600, exitTime: td + 7200, entryPrice: 100, exitPrice: 101, symbol,
        grossPL: gross, netPL: gross - 0.5, fee: 0.5, tradingFee: 0.5, fundingFee: 0,
        isGrossWin: gross > 0, isNetWin: gross - 0.5 > 0,
    }))
}

// Agent-Tag (Papierhandel der Strategie-Schicht): darf nur bei Kategorie
// „agent" sichtbar sein, nie in „alle".
{
    const td = ms('2026-03-03T00:00:00Z') / 1000
    const t = quick.buildTradeObj({ id: `t${td}_a_1`, broker: 'bitunix', td, side: 'B', quantity: 1, entryTime: td + 100, exitTime: td + 5000,
        entryPrice: 50, exitPrice: 55, symbol: 'ETHUSDT', grossPL: 999, netPL: 998, fee: 1, tradingFee: 1, fundingFee: 0, isGrossWin: true, isNetWin: true })
    t.category = 'agent'
    globalThis.__journalDaten.trades.push({ objectId: '9001', date: '2026-03-03', dateUnix: td, broker: 'bitunix', trades: [t], executions: [{ ...t, trade: t.id }], blotter: [], pAndL: {}, openPositions: false })
}

const zeilen = globalThis.__journalDaten.trades.slice().sort((a, b) => a.dateUnix - b.dateUnix || a.broker.localeCompare(b.broker))
ergebnis.import = sauber({
    antworten: importe,
    konten: globalThis.__journalDaten.settings[0].accounts,
    notizen: globalThis.__journalDaten.notes,
    offeneIncoming: globalThis.__journalDaten.incoming_positions.length,
    tageszeilen: zeilen.map(({ objectId, ...rest }) => rest),
})

// --- 2. Begleitzeilen zu den importierten Trades ----------------------------
const alleTrades = zeilen.flatMap(z => z.trades).filter(t => t.category !== 'agent').sort((a, b) => a.id.localeCompare(b.id))
alleTrades.forEach((t, i) => {
    const d = globalThis.__journalDaten
    if (i % 3 === 0) d.tags.push({ objectId: String(d.tags.length + 1), tradeId: t.id, dateUnix: t.entryTime, tags: [wahl(['tag_1', 'tag_2', 'tag_3']), ...(i % 6 === 0 ? ['tag_4'] : [])] })
    if (i % 4 === 1) d.satisfactions.push({ objectId: String(d.satisfactions.length + 1), tradeId: t.id, dateUnix: t.td, satisfaction: i % 8 === 1 ? 1 : 0 })
    if (i % 5 === 2) d.excursions.push({ objectId: String(d.excursions.length + 1), tradeId: t.id, dateUnix: t.td, stopLoss: runde(t.entryPrice * (t.strategy === 'long' ? 0.98 : 1.02), 6), maePrice: runde(t.entryPrice * 0.99, 6), mfePrice: i % 10 === 2 ? null : runde(t.entryPrice * 1.015, 6) })
    if (i % 7 === 3) d.notes.push({ objectId: String(d.notes.length + 1), tradeId: t.id, dateUnix: t.td, tradeType: wahl(['scalp', 'day', 'swing']), note: 'x' })
})
for (const [i, z] of zeilen.entries()) {
    const d = globalThis.__journalDaten
    if (i % 5 === 0) d.tags.push({ objectId: String(d.tags.length + 1), tradeId: '', dateUnix: z.dateUnix, tags: ['tag_5'] })
    if (i % 3 === 0) d.satisfactions.push({ objectId: String(d.satisfactions.length + 1), tradeId: '', dateUnix: z.dateUnix, satisfaction: i % 2 })
}

// --- 3. Dashboard-Lauf -------------------------------------------------------
const rohTrades = new Map(ergebnis.import.tageszeilen.flatMap(z => z.trades).map(t => [t.id, t]))
const ALLE_TAGS = ['tag_1', 'tag_2', 'tag_3', 'tag_4', 'tag_5', 't000t']
const monat = (iso) => ({ start: dayjsUnix(iso), end: dayjsUnix(iso, 1) })
function dayjsUnix(iso, plusMonate = 0) {
    const [j, m] = iso.split('-').map(Number)
    const d = new Date(Date.UTC(j, m - 1 + plusMonate, 1))
    // Monatsgrenze in der Handelszeitzone (Europe/Zurich): UTC-Mitternacht minus Versatz
    const versatz = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Zurich' })) - new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))
    return (d.getTime() - versatz) / 1000
}

function stelleEin(e) {
    ui.pageId.value = e.seite || 'dashboard'
    ui.timeZoneTrade.value = e.zone || 'Europe/Zurich'
    ui.hasData.value = false
    filter.selectedRange.value = e.zeitraum || { start: 0, end: 0 }
    filter.selectedPositions.value = e.richtungen || ['long', 'short']
    filter.selectedAccounts.value = e.konten || []
    filter.selectedTags.value = e.tags || ALLE_TAGS
    filter.selectedBroker.value = e.boerse ?? ''
    filter.selectedTradeCategory.value = e.kategorie || 'all'
    filter.amountCase.value = 'net'
    st.timeFrame.value = e.zeitrahmen || 15
    ui.barChartNegativeTagGroups.value = []
}

/**
 * Trades kommen in den Ergebnissen dutzendfach vor (jeder Tag, jede Gruppe,
 * jedes Szenario) — voll ausgeschrieben wären das 10 MB. Ein Trade wird daher
 * auf seine Kennung reduziert plus jedes Feld, das die Pipeline GEGENÜBER DEM
 * IMPORTIERTEN Trade hinzugefügt oder verändert hat (Tags, Zufriedenheit,
 * Exkursion, tradeType, priceVar …). Was gleich blieb, steht schon im Teil
 * „import" und ist dort festgehalten.
 */
function kompakt(x, basis = rohTrades) {
    if (Array.isArray(x)) return x.map(v => kompakt(v, basis))
    if (!x || typeof x !== 'object') return x
    const roh = typeof x.id === 'string' ? basis.get(x.id) : undefined
    if (roh && 'entryTime' in x) {
        const aus = { id: x.id }
        for (const [k, v] of Object.entries(x)) {
            if (k !== 'id' && JSON.stringify(v) !== JSON.stringify(roh[k])) aus[k] = v
        }
        for (const k of Object.keys(roh)) if (!(k in x)) aus[k] = '—entfernt—'
        return aus
    }
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, kompakt(v, basis)]))
}

async function dashboard(e) {
    stelleEin(e)
    await Promise.all([tage.useGetExcursions(), tage.useGetSatisfactions(), tage.useGetTags()])
    await tage.useGetAvailableTags()
    await kern.useGetFilteredTrades()
    await kern.useTotalTrades()
    await kern.useGroupTrades()
    await kern.useCalculateProfitAnalysis()
    for (const g of st.availableTags) {
        if (Object.keys(st.groups).includes(g.id)) ui.barChartNegativeTagGroups.value.push({ id: g.id, name: g.name })
    }
    const diagramme = {}
    for (const art of ['net', 'gross']) {
        filter.amountCase.value = art
        globalThis.__journalCharts = {}
        await charts.useECharts('init')
        for (const id of ['barChartNegative1', 'barChartNegative2', 'barChartNegative3', 'barChartNegative4', 'barChartNegative7',
            'barChartNegative13', 'barChartNegative16', 'barChartNegative17', 'barChartNegative18']) charts.useBarChartNegative(id)
        diagramme[art] = Object.fromEntries(Object.entries(globalThis.__journalCharts).sort().map(([id, o]) => [id, diagrammDaten(o)]))
    }
    // Gruppen vergleichen gegen den GEFILTERTEN Trade: so bleibt dort nur,
    // was das Gruppieren selbst hinzufügt (tagName, tagGroupName …).
    const gefiltert = new Map(sauber(st.filteredTradesTrades).map(t => [t.id, t]))
    return {
        ...kompakt(sauber({
            hasData: ui.hasData.value,
            filteredTrades: st.filteredTrades,
            totals: st.totals,
            totalsByDate: st.totalsByDate,
            profitAnalysis: st.profitAnalysis,
            diagramme,
        })),
        groups: kompakt(sauber(st.groups), gefiltert),
    }
}

const SZENARIEN = {
    alles: {},
    bitunixJanuar: { boerse: 'bitunix', zeitraum: monat('2026-01') },
    bitgetMaerzUSA: { boerse: 'bitget', zeitraum: monat('2026-03'), zone: 'America/New_York' },
    nurBots: { kategorie: 'bot' },
    nurFutures: { kategorie: 'futures', zeitrahmen: 60 },
    nurAgent: { kategorie: 'agent' },
    nurShortsKonto: { richtungen: ['short'], konten: ['bitget'] },
    tagFilter: { tags: ['tag_1', 'tag_4'] },
    ohneTagsNurUngetaggt: { tags: ['t000t'] },
}
ergebnis.dashboard = {}
for (const [name, e] of Object.entries(SZENARIEN)) ergebnis.dashboard[name] = await dashboard(e)

// --- 4. Tagesansicht ---------------------------------------------------------
stelleEin({ seite: 'daily', zeitraum: monat('2026-02') })
await Promise.all([tage.useGetExcursions(), tage.useGetSatisfactions(), tage.useGetTags(), tage.useGetAvailableTags()])
await kern.useGetFilteredTrades()
globalThis.__journalCharts = {}
filter.amountCase.value = 'net'
charts.useRenderDoubleLineChart()
charts.useRenderPieChart()
ergebnis.tagesansicht = kompakt(sauber({
    filteredTrades: st.filteredTrades,
    diagramme: Object.fromEntries(Object.entries(globalThis.__journalCharts).sort().map(([id, o]) => [id, diagrammDaten(o)])),
}))

// --- 5. Kalender ---------------------------------------------------------------
ergebnis.kalender = {}
for (const [name, iso, zone] of [['maerz', '2026-03', 'Europe/Zurich'], ['oktober', '2025-10', 'Europe/Zurich'], ['maerzUSA', '2026-03', 'America/New_York']]) {
    const m = monat(iso)
    stelleEin({ seite: 'calendar', zone })
    filter.selectedMonth.value = m
    filter.selectedRange.value = { start: monat(`${iso.slice(0, 4)}-01`).start, end: m.end }
    await Promise.all([tage.useGetTags(), tage.useGetAvailableTags()])
    await kern.useGetFilteredTrades()
    await kalender.useLoadCalendar()
    ergebnis.kalender[name] = kompakt(sauber({ calendarData: st.calendarData, miniCalendarsData: st.miniCalendarsData }))
}

console.log = stilleLog

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------

let ok = 0, schlecht = 0
const pruefe = (name, bedingung, detail = '') => {
    if (bedingung) { ok++; console.log(`  ✓ ${name}`) } else { schlecht++; console.log(`  ✗ ${name}${detail ? '\n      ' + detail : ''}`) }
}

console.log('Journal-Kern (Golden Master)')

// Plausibilität unabhängig vom eingefrorenen Stand — sonst friert man einen
// Lauf ein, der gar nichts gerechnet hat.
pruefe('keine Fehlermeldung während des Laufs', fehlerMeldungen.length === 0, fehlerMeldungen.slice(0, 3).join('\n      '))
pruefe('Import hat Tageszeilen angelegt', ergebnis.import.tageszeilen.length > 50, `${ergebnis.import.tageszeilen.length} Zeilen`)
{
    // Kennung = t<Tag>_<Index>_<Positions-ID>; manuelle (_m_) und Agent-Trades (_a_) zählen nicht
    const kennungen = ergebnis.import.tageszeilen.flatMap(z => z.trades)
        .filter(t => !/_[ma]_/.test(t.id)).map(t => `${t.broker}:${t.id.split('_').slice(2).join('_')}`)
    pruefe('Überlappender Import bucht keine Position doppelt', new Set(kennungen).size === kennungen.length && kennungen.length === 80 + 28 + 11,
        `${kennungen.length} Trades, ${new Set(kennungen).size} verschiedene`)
}
pruefe('Szenario „alles" hat Trades', ergebnis.dashboard.alles.totals.trades > 100, `totals.trades = ${ergebnis.dashboard.alles.totals.trades}`)
pruefe('Agent-Trade fehlt in „alles"', !JSON.stringify(ergebnis.dashboard.alles.filteredTrades).includes('_a_1'))
pruefe('Agent-Trade erscheint nur unter „agent"', JSON.stringify(ergebnis.dashboard.nurAgent.filteredTrades).includes('_a_1'))
pruefe('Diagramme wurden gezeichnet', Object.keys(ergebnis.dashboard.alles.diagramme.net).length >= 15, Object.keys(ergebnis.dashboard.alles.diagramme.net).join(', '))
pruefe('Kalender hat Monatsdaten', Object.keys(ergebnis.kalender.maerz.calendarData).length > 0)

if (SCHREIBEN) {
    mkdirSync(dirname(GOLDEN), { recursive: true })
    writeFileSync(GOLDEN, JSON.stringify(ergebnis) + '\n')
    console.log(`  → Golden Master geschrieben: ${GOLDEN}`)
} else {
    let soll
    try { soll = JSON.parse(readFileSync(GOLDEN, 'utf8')) } catch {
        pruefe('Golden Master vorhanden', false, 'erst mit JOURNAL_GOLDEN_SCHREIBEN=1 erzeugen')
    }
    if (soll) {
        const teile = [
            ['Import: Tageszeilen, Konten, Notizen', 'import'],
            ...Object.keys(SZENARIEN).map(n => [`Dashboard „${n}"`, `dashboard.${n}`]),
            ['Tagesansicht', 'tagesansicht'],
            ...['maerz', 'oktober', 'maerzUSA'].map(n => [`Kalender „${n}"`, `kalender.${n}`]),
        ]
        const hole = (o, pfad) => pfad.split('.').reduce((x, k) => x?.[k], o)
        for (const [name, pfad] of teile) {
            const fehler = []
            vergleiche(hole(ergebnis, pfad), hole(soll, pfad), pfad, fehler)
            pruefe(`${name} unverändert`, fehler.length === 0, fehler.join('\n      '))
        }
    }
}

console.log(`\njournal: ${ok} bestanden, ${schlecht} fehlgeschlagen`)
process.exit(schlecht ? 1 : 0)
