/**
 * Einstellungen der Live-Analyse (Heatmap / Bookmap).
 *
 * Quelle der Wahrheit ist die settings-Tabelle — die Werte stehen damit auch auf
 * der Einstellungen-Seite und überleben einen Browserwechsel. Geschrieben wird
 * gebündelt und verzögert, damit ein Zug am Zoom nicht zwanzig PUTs auslöst.
 */
import { ref, watch } from 'vue'
import { currentUser } from './settings.js'
import { dbUpdateSettings } from '../utils/db.js'
import { logWarn } from '../utils/logger.js'

export const liveSymbol = ref('BTCUSDT')
export const liveMarket = ref('futures')
export const liveViewPct = ref(0.5)
export const liveFrameMs = ref(500)
export const liveHistoryMin = ref(30)
export const liveRamp = ref('bookmap')
export const liveShowProfile = ref(false)
export const livePauseInBackground = ref(true)
export const liveColorMode = ref('auto')      // 'auto' | 'fixed'
export const liveColorRef = ref(0)            // Sättigungswert bei 'fixed'
export const liveAutoFollow = ref(true)
export const liveThreshold = ref(0)           // 0..0.95, blendet schwache Liquidität aus
export const liveShowLiquidations = ref(true) // Zwangsliquidationen einzeichnen (nur Futures)
export const livePrefillMin = ref(15)         // Vorlauf aus der Aufzeichnung, 0 = aus
export const liveDotStep = ref(11)            // Rasterbreite der Handelspunkte in px
export const liveProfileW = ref(74)           // Breite der Volumenprofil-Spur in px
export const liveShowVolumeBars = ref(false)  // Volumen-Säulen unter dem Chart

/* Liquidationskarte (eigene Seite) — Modell, keine Messung. */
export const levMapTier = ref('all')          // 'all' | Index in LEVERAGE_TIERS
export const levMapHours = ref(48)            // gewünschtes Zeitfenster
export const levMapSpanPct = ref(8)           // Preisspanne um den Mid, einseitig
export const levMapMmr = ref(0.004)           // Maintenance-Margin-Rate (ohne Key nicht abrufbar)
export const levMapProfileW = ref(74)         // Breite der Profilspur im Verlauf
export const levMapThreshold = ref(0)         // blendet schwache Zonen aus (0..0.9)
export const levMapView = ref('dist')         // 'dist' = Verteilung | 'history' = Verlauf
export const levMapWeights = ref('40,30,20,10')  // Gewichte der Stufen bei „Alle"

/** Nur zur Laufzeit — wird nicht gespeichert. */
export const liveFrozen = ref(false)
/** 'live' | 'replay' — Wiedergabe wird per Link aus dem Journal gesetzt. */
export const liveMode = ref('live')
export const replayFrom = ref(0)
export const replayTo = ref(0)
export const replayLabel = ref('')
/** Aktueller Auto-Normierungswert, damit die Einstellungen ihn übernehmen können. */
export const liveAutoRefValue = ref(0)

const FIELDS = {
    liveSymbol, liveMarket, liveViewPct, liveFrameMs, liveHistoryMin, liveRamp,
    liveShowProfile, livePauseInBackground, liveColorMode, liveColorRef, liveAutoFollow,
    liveThreshold, liveShowLiquidations, livePrefillMin, liveDotStep, liveProfileW, liveShowVolumeBars,
    levMapTier, levMapHours, levMapSpanPct, levMapMmr, levMapWeights, levMapView,
    levMapThreshold, levMapProfileW,
}
const BOOLEAN_FIELDS = ['liveShowProfile', 'livePauseInBackground', 'liveAutoFollow', 'liveShowLiquidations', 'liveShowVolumeBars']

let hydrated = false
let saveTimer = null
let dirty = {}

/** Werte aus den geladenen Settings übernehmen (einmal pro Seitenaufruf). */
export function hydrateLiveSettings() {
    const settings = currentUser.value
    if (!settings) return
    hydrated = false   // Watcher während des Befüllens stumm schalten
    for (const [key, target] of Object.entries(FIELDS)) {
        const value = settings[key]
        if (value === undefined || value === null || value === '') continue
        target.value = BOOLEAN_FIELDS.includes(key) ? !!Number(value) : value
    }
    hydrated = true
}

function scheduleSave(key, value) {
    if (!hydrated) return
    dirty[key] = BOOLEAN_FIELDS.includes(key) ? (value ? 1 : 0) : value
    clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
        const payload = dirty
        dirty = {}
        try {
            await dbUpdateSettings(payload)
            if (currentUser.value) Object.assign(currentUser.value, payload)
        } catch (e) {
            logWarn('live-settings', 'Speichern fehlgeschlagen', e)
        }
    }, 600)
}

// flush: 'sync' ist hier wesentlich: Vue führt Watcher sonst erst beim nächsten
// Tick aus — dann steht `hydrated` längst wieder auf true und jedes Befüllen aus
// der DB löste ein sofortiges Zurückschreiben aus.
for (const [key, target] of Object.entries(FIELDS)) {
    watch(target, (value) => scheduleSave(key, value), { flush: 'sync' })
}

/** Auswahlmöglichkeiten für die Bedienelemente. */
// Bookmap zeigt eine Handvoll Ticks — erst bei diesen engen Stufen werden
// aus den Preiszeilen fette Balken statt haarfeiner Striche.
export const VIEW_PCT_OPTIONS = [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2]
export const FRAME_MS_OPTIONS = [250, 500, 1000]
export const HISTORY_MIN_OPTIONS = [15, 30, 60, 120]
export const FAVORITE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']
export const RAMP_OPTIONS = [
    { id: 'viridis', label: 'Viridis' },
    { id: 'bookmap', label: 'Klassisch' },
    { id: 'journal', label: 'Journal' },
]
