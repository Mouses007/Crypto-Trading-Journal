/**
 * Speicherverbrauch je Modul — reine Info für Einstellungen → Allgemein.
 *
 * Liefert Tabellengrössen (inklusive Indizes) und Zeilenzahlen, gruppiert zu
 * den Modulen der Oberfläche, damit man das Wachstum im Blick behält (die
 * grossen Posten sind erfahrungsgemäss Screenshots als Base64 in der DB und
 * die Live-Aufzeichnungen).
 *
 * Zwei bewusste Ungenauigkeiten:
 *  - PostgreSQL-Zeilenzahlen sind die Planer-SCHÄTZUNG (reltuples) — ein
 *    exaktes COUNT(*) über die grossen Tabellen wäre für eine Info-Anzeige
 *    zu teuer. SQLite zählt exakt (dort ist COUNT(*) billig).
 *  - SQLite-Tabellengrössen brauchen das dbstat-Modul; fehlt es im Build,
 *    kommen nur Zeilenzahlen plus die Gesamtgrösse der Datei.
 *
 * Tabellen ohne Modulzuordnung landen in 'system' — neues Wachstum darf nie
 * unsichtbar sein, nur weil jemand die Liste hier nicht nachgezogen hat.
 */

import { getKnex } from './database.js'
import { logWarn } from './logger.js'

/** Modul-Zuordnung; Reihenfolge = Anzeigereihenfolge im Frontend. */
export const SPEICHER_MODULE = {
    journal: ['trades', 'notes', 'tags', 'satisfactions', 'excursions', 'playbooks',
        'diaries', 'incoming_positions', 'share_card_templates'],
    screenshots: ['screenshots'],
    liveAnalyse: ['live_recordings', 'oi_minute', 'live_sessions', 'market_snapshots',
        'calendar_events', 'radar_fetch_state'],
    nachrichten: ['news_items', 'news_digests', 'news_sources', 'news_profile'],
    research: ['hype_candidates', 'hype_reports', 'hype_settings', 'hype_favoriten',
        'hype_alarme', 'coinradar_laeufe', 'coinradar_zeilen', 'coinradar_settings',
        'coin_universen', 'radar_ergebnisse'],
    strategien: ['strategy_backtests', 'strategy_drafts', 'strategy_instances',
        'strategy_param_history', 'strategy_positions', 'strategy_runs',
        'strategy_setups', 'strategy_suggestions', 'strategy_trades',
        'rule_strategies', 'rule_strategy_history', 'rangliste_laeufe', 'rangliste_zeilen'],
    ki: ['ai_reports', 'ai_report_messages', 'ai_trade_messages', 'ai_usage',
        'ai_agent_messages', 'ai_agent_sessions'],
    lernen: ['quiz_karten', 'quiz_fortschritt'],
    system: ['settings', 'bitunix_config', 'bitget_config', 'pionex_config', 'api_cache'],
}

/**
 * Tabellenliste zu Modulen falten — pure, damit sie testbar bleibt.
 *
 * @param {Array<{name: string, bytes: number|null, zeilen: number}>} tabellen
 * @returns {Array<{id: string, bytes: number|null, zeilen: number,
 *                  tabellen: Array<{name, bytes, zeilen}>}>}
 */
export function gruppiereSpeicher(tabellen) {
    const zuModul = new Map()
    for (const [modul, namen] of Object.entries(SPEICHER_MODULE)) {
        for (const name of namen) zuModul.set(name, modul)
    }
    const module = new Map(Object.keys(SPEICHER_MODULE).map((id) => [id, {
        id, bytes: 0, zeilen: 0, bytesBekannt: true, tabellen: [],
    }]))

    for (const t of tabellen) {
        const modul = module.get(zuModul.get(t.name) || 'system')
        modul.tabellen.push(t)
        modul.zeilen += t.zeilen || 0
        if (t.bytes == null) modul.bytesBekannt = false
        else modul.bytes += t.bytes
    }

    const liste = []
    for (const m of module.values()) {
        if (!m.tabellen.length) continue
        m.tabellen.sort((a, b) => (b.bytes || 0) - (a.bytes || 0) || b.zeilen - a.zeilen)
        liste.push({ ...m, bytes: m.bytesBekannt ? m.bytes : null })
    }
    liste.sort((a, b) => (b.bytes || 0) - (a.bytes || 0) || b.zeilen - a.zeilen)
    return liste
}

async function messePostgres(knex) {
    const groessen = await knex.raw(`
        SELECT c.relname AS name,
               pg_total_relation_size(c.oid)::bigint AS bytes,
               GREATEST(c.reltuples, 0)::bigint AS zeilen
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = 'public'`)
    const gesamt = await knex.raw('SELECT pg_database_size(current_database())::bigint AS bytes')
    return {
        tabellen: groessen.rows.map((r) => ({
            name: r.name, bytes: Number(r.bytes), zeilen: Number(r.zeilen),
        })),
        gesamtBytes: Number(gesamt.rows?.[0]?.bytes) || null,
        zeilenGeschaetzt: true,
    }
}

async function messeSqlite(knex) {
    const namen = (await knex.raw(
        "SELECT name, tbl_name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'"))
        .map((r) => ({ name: r.name, tabelle: r.tbl_name }))

    // Grössen über dbstat: jede B-Baum-Struktur (Tabelle UND ihre Indizes)
    // wird über sqlite_master ihrer Tabelle zugeschlagen. Ohne dbstat-Modul
    // bleiben die Grössen unbekannt — die Zeilenzahlen tragen dann allein.
    let bytesJeTabelle = null
    try {
        const stat = await knex.raw('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name')
        const zurTabelle = new Map(namen.map((n) => [n.name, n.tabelle]))
        bytesJeTabelle = new Map()
        for (const r of stat) {
            const tabelle = zurTabelle.get(r.name) || r.name
            bytesJeTabelle.set(tabelle, (bytesJeTabelle.get(tabelle) || 0) + Number(r.bytes || 0))
        }
    } catch { /* dbstat nicht einkompiliert */ }

    const tabellen = []
    for (const { name, tabelle } of namen) {
        if (name !== tabelle) continue   // Indizes sind schon zugeschlagen
        const zeilen = Number((await knex(name).count('* as c').first())?.c) || 0
        tabellen.push({ name, bytes: bytesJeTabelle ? (bytesJeTabelle.get(name) || 0) : null, zeilen })
    }

    const seiten = await knex.raw('PRAGMA page_count')
    const groesse = await knex.raw('PRAGMA page_size')
    const gesamtBytes = (Number(seiten?.[0]?.page_count) || 0) * (Number(groesse?.[0]?.page_size) || 0) || null
    return { tabellen, gesamtBytes, zeilenGeschaetzt: false }
}

// Eine Minute Cache: die Messung ist billig, aber die Einstellungsseite soll
// beim Hin- und Herklappen nicht jedes Mal 50 Tabellen abfragen.
let cache = null

export function setupSpeicherRoutes(app) {
    app.get('/api/system/speicher', async (req, res) => {
        try {
            if (cache && Date.now() - cache.ts < 60 * 1000 && req.query.force !== '1') {
                res.setHeader('X-Cache', 'HIT')
                return res.json(cache.payload)
            }
            const knex = getKnex()
            const istPg = knex.client.config.client === 'pg'
            const roh = istPg ? await messePostgres(knex) : await messeSqlite(knex)
            const payload = {
                db: istPg ? 'postgresql' : 'sqlite',
                gesamtBytes: roh.gesamtBytes,
                zeilenGeschaetzt: roh.zeilenGeschaetzt,
                module: gruppiereSpeicher(roh.tabellen),
                stand: Date.now(),
            }
            cache = { ts: Date.now(), payload }
            res.setHeader('X-Cache', 'MISS')
            res.json(payload)
        } catch (fehler) {
            logWarn('speicher', `Messung fehlgeschlagen: ${fehler.message}`)
            res.status(500).json({ error: `Speicher-Messung fehlgeschlagen: ${fehler.message}` })
        }
    })
}
