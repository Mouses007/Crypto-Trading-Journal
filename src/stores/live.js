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
/*
 * Vorgabe-Preisband. ±0,25 % statt ±0,5 %: der Binance-Snapshot deckt gemessen
 * nur ±0,17 % ab, bei ±0,5 % konnten also von 198 Zeilen nur 68 überhaupt
 * belegt sein — der „Kamm" aus leeren Zeilen. Bei ±0,25 % sind es 69 % statt
 * 34 %. Weiter aufziehen kann man jederzeit, man sieht dann nur, was der
 * Diff-Strom im Fernfeld zufällig geliefert hat.
 */
export const liveViewPct = ref(0.25)
/*
 * Sichtbare Zeitspanne in Minuten; 0 = native Auflösung (eine Ringspalte je
 * Pixel). Das Gegenstück zu Bookmaps 1m/15m/1h.
 *
 * Nicht zu verwechseln mit `liveFrameMs` (wie fein aufgezeichnet wird). Vorher
 * gab es nur den Takt und die Ringlänge — was man SIEHT, ergab sich aus
 * Plotbreite × Takt und war überhaupt nicht einstellbar. Die Ringlänge folgt
 * heute dieser Auswahl (`historieFuer`).
 */
export const liveSpanneMin = ref(15)

/*
 * Ringzeilen je Bildzeile — das Gegenstück zur Zeitspanne auf der Preisachse.
 *
 * 2 als Vorgabe: bei BTC sind das 4 USD je Zone. Mit 1 (voller Ringauflösung,
 * 2 USD) stehen dort haarfeine Striche mit dunklen Lücken, weil ruhende Orders
 * auf runden Preisen sitzen — die Zwischenstufen sind schlicht leer.
 */
export const livePreisFaltung = ref(2)
export const liveFrameMs = ref(500)
/*
 * Wie viel Orderbuch-Historie der Ring aufhebt. **0 = automatisch**, und das
 * ist die Vorgabe.
 *
 * Am 07.09.2026 stand das kurzzeitig als zweite Auswahl neben der Zeitspanne
 * in der Seitenleiste — zu Recht bemängelt: „was macht das für Sinn, wenn ich
 * 15 min wähle und dann auch 15 min Historie wählen soll?". Es sind zwar zwei
 * verschiedene Dinge (was man SIEHT gegen was der Ring AUFHEBT), aber die
 * Antwort auf das zweite ergibt sich fast immer aus dem ersten: genug, um
 * einmal zurückblättern zu können. Also rechnet es die App, und wer es
 * wirklich anders will, stellt es in den Einstellungen fest ein.
 */
export const liveHistoryMin = ref(0)
export const liveRamp = ref('bookmap')
export const liveShowProfile = ref(false)
export const livePauseInBackground = ref(true)
export const liveColorMode = ref('auto')      // 'auto' | 'fixed'
export const liveColorRef = ref(0)            // Sättigungswert bei 'fixed'
/*
 * Vielfaches des Bezugswerts bei voller Sättigung — gilt für BEIDE Modi.
 *
 * 3 statt 10: die Vorgabe 10 stammte aus einer Messung, bei der der Bezugswert
 * noch über das GANZE Sichtfenster gebildet wurde (Fernfeld inklusive, also
 * niedriger). Seit er nur noch aus dem erfassten Band kommt, liegt er höher —
 * dieselbe Zahl ergibt damit ein viel dunkleres Bild. Neu gemessen am erfassten
 * Band: bei Preiszonen 2 sind mit 3× rund 21 % der Zonen gelb oder wärmer, mit
 * 10× nur 1 %. Die Vorlage liegt bei 12–20 %.
 *
 * Eigener Schlüssel statt des alten `liveSatMult`, weil sich die BEDEUTUNG der
 * Zahl geändert hat: der Bezug ist seit dem 07.09.2026 der Median der
 * sichtbaren Mengen, vorher das 95. Perzentil. Ein gespeichertes „2,5" hiesse
 * jetzt etwas ganz anderes und sähe stillschweigend falsch aus.
 */
export const liveSaettigung = ref(3)

/** Buch-Leiter rechts (ruhende Mengen je Preiszone), Gegenstück zu Bookmaps COB. */
export const liveShowBuch = ref(true)
export const liveBuchW = ref(96)              // Breite der Buch-Leiter in px
/*
 * Fremde Börsen (Bybit, OKX) in der Leiter mitzeigen — als eigener Balken,
 * nicht aufaddiert. Warum nicht summiert: siehe server/fremdbuch.js.
 */
export const liveFremdBuch = ref(true)
export const liveAutoFollow = ref(true)
export const liveThreshold = ref(0)           // 0..0.95, blendet schwache Liquidität aus
export const liveShowLiquidations = ref(true) // Zwangsliquidationen einzeichnen (nur Futures)
export const livePrefillMin = ref(15)         // Vorlauf aus der Aufzeichnung, 0 = aus
export const liveDotStep = ref(11)            // Rasterbreite der Handelspunkte in px
export const liveProfileW = ref(74)           // Breite der Volumenprofil-Spur in px
export const liveShowVolumeBars = ref(false)  // Volumen-Säulen unter dem Chart
export const liveShowDelta = ref(false)       // Cumulative-Volume-Delta-Spur unter dem Chart
export const liveShowAbsorption = ref(false)  // Preisstufen markieren, an denen mehr gehandelt als geruht wurde

/* Liquidationskarte (eigene Seite) — Modell, keine Messung. */
export const levMapTier = ref('all')          // 'all' | Kommaliste von Hebelwerten ('50,100'); Altbestand: Index
export const levMapHours = ref(48)            // gewünschtes Zeitfenster
export const levMapSpanPct = ref(8)           // Preisspanne um den Mid, einseitig
export const levMapMmr = ref(0.004)           // Maintenance-Margin-Rate, Stufe 1
export const levMapMmrQuelle = ref('binance') // 'binance' | 'bybit' | 'manuell'
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
/**
 * Ein- und Ausstieg des Trades, für die Sprungknöpfe. 0 = unbekannt (etwa bei
 * einer von Hand gebauten URL). Zustand einer Navigation, deshalb bewusst
 * nicht in FIELDS — das hier gehört nicht in die Einstellungen.
 */
export const replayEntry = ref(0)
export const replayExit = ref(0)
/** Worauf die Wiedergabe zeigt: 'all' = ganzer Trade | 'entry' | 'exit'. */
export const replayFokus = ref('all')
/**
 * Zoomstufe als Bruchteil der Gesamtspanne (1 = alles). Die Stufen sind
 * bewusst relativ und nicht in Minuten: der Server verdichtet auf die
 * Plotbreite, dadurch füllt jede Stufe das Bild exakt aus. Feste Minutenwerte
 * würden auf breiten Bildschirmen eine halb leere Fläche erzeugen.
 */
export const replayZoom = ref(1)
export const REPLAY_ZOOM_OPTIONS = [
    { wert: 1, label: 'Ganz' },
    { wert: 0.5, label: '1/2' },
    { wert: 0.25, label: '1/4' },
    { wert: 0.1, label: '1/10' },
    { wert: 0, label: 'Feinste' },   // 0 = native Auflösung, eine Spalte je Pixel
]
/**
 * Zeitspanne auf das klemmen, was der Ring hergibt. Auch beim Verkürzen der
 * Historie nötig — sonst bliebe eine gespeicherte Stunde neben einem
 * 15-Minuten-Ring stehen.
 */
function klemmeSpanne() {
    if (!(liveHistoryMin.value > 0)) return   // Automatik klemmt nichts
    const erlaubt = spannenOptionen(liveHistoryMin.value)
    if (!erlaubt.includes(liveSpanneMin.value)) {
        liveSpanneMin.value = erlaubt[erlaubt.length - 1] ?? 0
    }
}
watch(liveHistoryMin, () => klemmeSpanne())

/** Tatsächlich im Bild abgedeckte Zeit in Minuten — gemeldet vom Renderer. */
export const liveAbdeckungMin = ref(0)

/** Aktueller Auto-Normierungswert, damit die Einstellungen ihn übernehmen können. */
export const liveAutoRefValue = ref(0)

/*
 * Ringspalten je Pixel, wie der Renderer sie gerade rechnet.
 *
 * Nicht gespeichert, sondern gemeldet — die Einstellungen brauchen ihn, um
 * „eine Blase = so viel Zeit" auszurechnen. Seit der wählbaren Zeitspanne ist
 * eine Pixelspalte nicht mehr zwangsläufig eine Ringspalte, und die Angabe
 * stimmte um genau diesen Faktor nicht.
 */
export const liveProPixel = ref(1)

/*
 * Preisbreite einer Ringzeile, wie der Feed sie gerade rechnet. Ebenfalls
 * gemeldet, nicht gespeichert: sie hängt an tickSize, Zeilenzahl und
 * erfasstem Band und ist damit nichts, was man einstellen könnte. Die
 * Einstellungen brauchen sie, um „2 Zeilen" als „4 USD" zu beschriften.
 */
export const liveBucketSize = ref(0)

const FIELDS = {
    liveSymbol, liveMarket, liveViewPct, liveSpanneMin, livePreisFaltung, liveFrameMs, liveHistoryMin, liveRamp,
    liveShowProfile, livePauseInBackground, liveColorMode, liveColorRef, liveSaettigung, liveAutoFollow,
    liveShowBuch, liveBuchW, liveFremdBuch,
    liveThreshold, liveShowLiquidations, livePrefillMin, liveDotStep, liveProfileW, liveShowVolumeBars,
    liveShowDelta, liveShowAbsorption,
    levMapTier, levMapHours, levMapSpanPct, levMapMmr, levMapMmrQuelle, levMapWeights, levMapView,
    levMapThreshold, levMapProfileW,
}
const BOOLEAN_FIELDS = [
    'liveShowProfile', 'livePauseInBackground', 'liveAutoFollow', 'liveShowLiquidations', 'liveShowBuch',
    'liveShowVolumeBars', 'liveShowDelta', 'liveShowAbsorption', 'liveFremdBuch',
]

let hydrated = false
let saveTimer = null
let dirty = {}

/**
 * In der Wiedergabe kommen Symbol und Markt aus der URL, nicht aus den
 * Einstellungen. Die Reihenfolge macht das nötig: das Layout hydriert erst,
 * wenn die Settings aus der DB da sind — also NACH dem Mounten der Seite, die
 * die URL ausgewertet hat. Ohne diese Ausnahme überschreibt der gespeicherte
 * Standard den Trade, den man gerade ansehen will.
 */
const NICHT_IN_WIEDERGABE = ['liveSymbol', 'liveMarket']

/** Werte aus den geladenen Settings übernehmen (einmal pro Seitenaufruf). */
export function hydrateLiveSettings() {
    const settings = currentUser.value
    if (!settings) return
    hydrated = false   // Watcher während des Befüllens stumm schalten
    const wiedergabe = liveMode.value === 'replay'
    for (const [key, target] of Object.entries(FIELDS)) {
        if (wiedergabe && NICHT_IN_WIEDERGABE.includes(key)) continue
        const value = settings[key]
        if (value === undefined || value === null || value === '') continue
        target.value = BOOLEAN_FIELDS.includes(key) ? !!Number(value) : value
    }
    /*
     * Gespeicherte Werte, die es nicht mehr gibt, auf die nächstkleinere Stufe
     * ziehen. Ohne das stünde nach der Kürzung von VIEW_PCT_OPTIONS bei allen,
     * die ±2 % gewählt hatten, ein leeres Auswahlfeld — und der Ring zeigte
     * trotzdem nur, was er hoch ist.
     */
    if (!VIEW_PCT_OPTIONS.includes(liveViewPct.value)) {
        const passend = [...VIEW_PCT_OPTIONS].reverse().find(v => v <= liveViewPct.value)
        liveViewPct.value = passend ?? VIEW_PCT_OPTIONS[VIEW_PCT_OPTIONS.length - 1]
    }
    klemmeSpanne()
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
//
// Nach oben bei 1 % Schluss: der Ring erfasst 900 Zeilen à 2 USD, also ±1,14 %
// (siehe RING_ROWS_WUNSCH in liveFeed.js). ±2 % stand hier zwar zur Auswahl,
// wurde aber still auf die Ringhöhe geklemmt — eine Option anzubieten, die
// nicht liefert, ist schlechter als sie wegzulassen.
export const VIEW_PCT_OPTIONS = [0.02, 0.05, 0.1, 0.25, 0.5, 1]
/*
 * Auswahl der Zeitspanne. 0 steht vorn, weil es der Zustand vor dem 07.09.2026
 * ist — wer die bisherige Ansicht will, findet sie dort.
 */
const SPANNE_MIN_ALLE = [0, 1, 3, 5, 15, 30, 60, 120]

/**
 * Nur Spannen anbieten, die der Ring auch aufheben KANN.
 *
 * Der Ring ist `liveHistoryMin` lang; alles darüber ergibt eine Ansicht, die
 * zu einem grossen Teil aus schwarzer Fläche besteht — gemeldet am 07.09.2026
 * mit einem Screenshot und der Frage „was das?". Genau derselbe Fehler wie
 * beim früheren ±2 %-Band: eine Auswahl anbieten, die stillschweigend nicht
 * liefert. Ob die Zeit dann tatsächlich schon aufgezeichnet IST, ist eine
 * zweite Frage — dafür gibt es die Abdeckungs-Anzeige.
 */
export function spannenOptionen(historyMin) {
    // Automatik: der Ring folgt der Spanne, also ist keine Spanne verwehrt.
    const grenze = Number(historyMin) > 0 ? Number(historyMin) : SPANNE_MIN_ALLE[SPANNE_MIN_ALLE.length - 1]
    return SPANNE_MIN_ALLE.filter(m => m <= grenze)
}

/**
 * Ringlänge zu einer Spanne: die kleinste angebotene Stufe, die mindestens das
 * DOPPELTE der sichtbaren Zeit fasst.
 *
 * Das Doppelte, weil man genau einmal um eine volle Bildbreite zurückblättern
 * können soll — mehr kostet Speicher und (über den Deckel in `liveFeed.js`)
 * Preisauflösung, weniger macht das Zurückziehen sinnlos.
 *
 * @param {number} spanneMin  gewählte Zeitspanne (0 = nativ)
 * @param {number} gesetzt    fester Wert aus den Einstellungen, 0 = automatisch
 */
export function historieFuer(spanneMin, gesetzt) {
    if (Number(gesetzt) > 0) return Number(gesetzt)
    const noetig = (Number(spanneMin) || 0) * 2
    return HISTORY_MIN_STUFEN.find(h => h >= noetig) ?? HISTORY_MIN_STUFEN[HISTORY_MIN_STUFEN.length - 1]
}
export const PREIS_FALTUNG_OPTIONS = [1, 2, 3, 4, 6, 8, 12]
export const FRAME_MS_OPTIONS = [250, 500, 1000]
/** Wählbare Ringlängen ohne die Automatik — auch die Zielwerte von `historieFuer`. */
export const HISTORY_MIN_STUFEN = [15, 30, 60, 120]
/** Für die Einstellungen: 0 = automatisch. */
export const HISTORY_MIN_OPTIONS = [0, ...HISTORY_MIN_STUFEN]
export const FAVORITE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']
export const RAMP_OPTIONS = [
    { id: 'viridis', label: 'Viridis' },
    { id: 'bookmap', label: 'Klassisch' },
    { id: 'journal', label: 'Journal' },
]
