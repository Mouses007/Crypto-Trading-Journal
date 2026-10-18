/**
 * Arbeitsstand des Chart-Arbeitsplatzes: Vorgaben und Speicherwege.
 *
 * Ein Layout ist reine Konfiguration — welches Raster, welche Panels mit
 * welchem Symbol, welcher Zeiteinheit und welchen Indikatoren, welche
 * Overlays an sind. Kerzen oder Zeichnungen stehen NICHT darin: Kerzen holt
 * jedes Panel frisch, Zeichnungen hängen am Symbol (`chart_zeichnungen`) und
 * erscheinen so in jedem Layout, das dieses Symbol zeigt.
 */
import axios from 'axios'

export const PANELS_JE_RASTER = { 1: 1, '2h': 2, '2v': 2, 4: 4 }

/** Zeiteinheiten für hinzukommende Panels: dasselbe Symbol, anderer Blick. */
const ZUSATZ_INTERVALLE = ['4h', '15m', '1d']

export function neuesPanel(vorlage = {}) {
    return {
        symbol: vorlage.symbol || 'BTCUSDT',
        markt: vorlage.markt || 'futures',
        interval: vorlage.interval || '1h',
        skala: 'normal',
        indikatoren: [],
        overlays: {},
    }
}

export function standardLayout() {
    return {
        raster: '1',
        aktiv: 0,
        panels: [neuesPanel()],
        sync: { kreuz: true, zeit: false, symbol: false, interval: false },
        seitenleiste: { offen: true, reiter: 'watchlist' },
    }
}

/**
 * Altes oder unvollständiges Layout auf die aktuelle Form bringen. Fehlendes
 * kommt aus den Vorgaben; nichts Unbekanntes wird verworfen, damit ein neuerer
 * Codestand (NAS) seine Felder behält, wenn ein älterer (Testcontainer)
 * dasselbe Layout speichert.
 */
export function vervollstaendige(daten) {
    const std = standardLayout()
    const d = { ...std, ...(daten || {}) }
    d.sync = { ...std.sync, ...(daten?.sync || {}) }
    d.seitenleiste = { ...std.seitenleiste, ...(daten?.seitenleiste || {}) }
    d.panels = Array.isArray(daten?.panels) && daten.panels.length
        ? daten.panels.map((p) => ({ ...neuesPanel(p), ...p }))
        : std.panels
    return passeAnRaster(d, d.raster)
}

/** Panel-Anzahl an das Raster anpassen; überzählige bleiben gemerkt, nicht gelöscht. */
export function passeAnRaster(d, raster) {
    const n = PANELS_JE_RASTER[raster] || 1
    d.raster = raster
    while (d.panels.length < n) {
        const basis = d.panels[0] || neuesPanel()
        d.panels.push(neuesPanel({ ...basis, interval: ZUSATZ_INTERVALLE[(d.panels.length - 1) % ZUSATZ_INTERVALLE.length] }))
    }
    if (d.aktiv >= n) d.aktiv = 0
    return d
}

export const api = {
    layouts: () => axios.get('/api/chart/layouts').then((r) => r.data),
    layoutNeu: (name, daten, aktiv = true) => axios.post('/api/chart/layouts', { name, daten, aktiv }).then((r) => r.data),
    layoutSpeichern: (id, patch) => axios.put(`/api/chart/layouts/${id}`, patch).then((r) => r.data),
    layoutLoeschen: (id) => axios.delete(`/api/chart/layouts/${id}`),
    watchlists: () => axios.get('/api/chart/watchlists').then((r) => r.data),
    watchlistNeu: (name, symbole = []) => axios.post('/api/chart/watchlists', { name, symbole }).then((r) => r.data),
    watchlistSpeichern: (id, patch) => axios.put(`/api/chart/watchlists/${id}`, patch).then((r) => r.data),
    watchlistLoeschen: (id) => axios.delete(`/api/chart/watchlists/${id}`),
}

export const STANDARD_WATCHLIST = [
    { symbol: 'BTCUSDT', markt: 'futures' },
    { symbol: 'ETHUSDT', markt: 'futures' },
    { symbol: 'SOLUSDT', markt: 'futures' },
    { symbol: 'BNBUSDT', markt: 'futures' },
    { symbol: 'XRPUSDT', markt: 'futures' },
]
