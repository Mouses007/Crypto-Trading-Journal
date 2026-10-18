/**
 * Journal-Trades für den Chart — rein, ohne Datenbank (Selbsttest:
 * `server/__selftest-chart-journal.mjs`).
 *
 * Die Tabelle `trades` hält EINE Zeile je Tag und Broker; die einzelnen Trades
 * stecken als JSON im Feld `trades`. Nach Symbol lässt sich deshalb nur nach
 * dem Auspacken filtern — das tat bisher allein der Browser, Seite für Seite.
 * Hier geschieht es einmal, für das Symbol und den Zeitraum, den der Chart
 * gerade zeigt.
 *
 * Zeiten: im Journal Sekunden, im Chart Millisekunden. Umgerechnet wird beim
 * Auspacken, damit kein Overlay je zwei Zeitbasen sieht.
 */

import { normSymbol } from '../shared/symbol.js'

// Weitergereicht, damit Aufrufer und Selbsttest sie hier finden.
export { normSymbol }

const zahl = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

/** Sekunden oder Millisekunden → Millisekunden. */
function ms(v) {
    const n = zahl(v)
    if (n == null || n <= 0) return null
    return n < 1e12 ? n * 1000 : n
}

function parse(text, ersatz) {
    if (text == null || text === '') return ersatz
    if (typeof text === 'object') return text
    try { return JSON.parse(text) } catch { return ersatz }
}

/**
 * Trades eines Symbols aus den Tageszeilen. Ein Trade gehört dazu, wenn sich
 * [Einstieg, Ausstieg] mit [von, bis] überschneidet — ein Trade, der vor dem
 * sichtbaren Ausschnitt eröffnet und darin geschlossen wurde, soll erscheinen.
 */
export function tradesAusZeilen(zeilen, symbol, von, bis) {
    const ziel = normSymbol(symbol)
    const aus = []
    const gesehen = new Set()
    for (const zeile of zeilen || []) {
        for (const t of parse(zeile.trades, [])) {
            if (!t || normSymbol(t.symbol) !== ziel) continue
            const ein = ms(t.entryTime)
            if (!ein) continue
            const raus = ms(t.exitTime)
            if (raus != null && raus < von) continue
            if (ein > bis) continue
            const id = String(t.id || `${ein}|${t.entryPrice}`)
            if (gesehen.has(id)) continue
            gesehen.add(id)
            const richtung = t.strategy === 'short' || t.side === 'SS' || t.side === 'S' ? 'short' : 'long'
            aus.push({
                id,
                broker: t.broker || zeile.broker || null,
                konto: t.account || null,
                kategorie: t.category || 'futures',
                richtung,
                einstieg: { t: ein, p: zahl(t.entryPrice) },
                ausstieg: raus != null && zahl(t.exitPrice) ? { t: raus, p: zahl(t.exitPrice) } : null,
                menge: zahl(t.buyQuantity) ?? zahl(t.sellQuantity),
                netto: zahl(t.netProceeds),
                brutto: zahl(t.grossProceeds),
                gebuehren: zahl(t.commission),
                funding: zahl(t.fundingFee),
                hebel: zahl(t.leverage),
                tag: zahl(zeile.dateUnix),
            })
        }
    }
    return aus.sort((a, b) => a.einstieg.t - b.einstieg.t)
}

/**
 * Anfangs-Stop eines Trades. R misst man gegen den Stop, mit dem der Trade
 * BEGANN — gegen den zuletzt nachgezogenen gemessen, sähe ein Trade mit
 * Break-even-Stop wie ein Unendlich-R-Gewinner aus.
 *
 * `tpslHistory` hält die Änderungen; der erste SL-Eintrag mit altem Wert
 * verrät den Stop davor, sonst ist der erste gesetzte Wert der Anfang. Ohne
 * Historie bleibt nur der Stop, der beim Schliessen stand.
 */
export function anfangsStop(meta) {
    const hist = Array.isArray(meta?.tpslHistory) ? [...meta.tpslHistory] : []
    const sl = hist.filter((h) => String(h?.type).toUpperCase() === 'SL').sort((a, b) => (a.time || 0) - (b.time || 0))
    if (sl.length) {
        const erster = sl[0]
        const alt = zahl(erster.oldVal)
        if (alt && alt > 0) return alt
        const neu = zahl(erster.newVal)
        if (neu && neu > 0) return neu
    }
    const s = zahl(meta?.sl)
    return s && s > 0 ? s : null
}

/** Ergebnis in R gegen den Anfangs-Stop; null, wenn kein Stop bekannt. */
export function rMultiple(trade, stop) {
    if (!stop || !trade.ausstieg || !trade.einstieg.p) return null
    const e = trade.einstieg.p
    const x = trade.ausstieg.p
    const risiko = trade.richtung === 'long' ? e - stop : stop - e
    if (!(risiko > 0)) return null
    return (trade.richtung === 'long' ? x - e : e - x) / risiko
}

/**
 * Notizen, Metadaten und Tags an die Trades hängen. `notizen` und `tags` sind
 * Zeilen der gleichnamigen Tabellen (Verknüpfung über `tradeId`).
 */
export function mitNotizen(trades, notizen, tags) {
    const nachId = new Map()
    for (const n of notizen || []) nachId.set(String(n.tradeId), n)
    const tagsNachId = new Map()
    for (const t of tags || []) tagsNachId.set(String(t.tradeId), t)
    return trades.map((tr) => {
        const n = nachId.get(tr.id)
        const meta = parse(n?.tradingMetadata, null)
        const stop = anfangsStop(meta)
        const tg = tagsNachId.get(tr.id)
        return {
            ...tr,
            sl: zahl(meta?.sl),
            tp: zahl(meta?.tp),
            breakeven: zahl(meta?.breakeven),
            anfangsStop: stop,
            r: rMultiple(tr, stop),
            fills: Array.isArray(meta?.fills)
                ? meta.fills.map((f) => ({ t: ms(f.time), p: zahl(f.price), menge: zahl(f.qty), reduzierend: !!f.reduceOnly })).filter((f) => f.t && f.p)
                : [],
            tpslVerlauf: Array.isArray(meta?.tpslHistory)
                ? meta.tpslHistory.map((h) => ({ t: ms(h.time), art: String(h.type || '').toUpperCase(), wert: zahl(h.newVal), aktion: h.action || null })).filter((h) => h.t)
                : [],
            notiz: n ? {
                einstieg: n.entryNote || n.note || '',
                ausstieg: n.closingNote || '',
                playbook: n.playbook || '',
                zeiteinheit: n.timeframe || '',
                art: n.tradeType || '',
                regelTreu: n.strategyFollowed == null ? null : Number(n.strategyFollowed),
                screenshots: [n.trendScreenshotId, n.screenshotId, n.closingScreenshotId].filter(Boolean),
            } : null,
            tags: [...parse(tg?.tags, []), ...parse(tg?.closingTags, [])].map(String),
        }
    })
}
