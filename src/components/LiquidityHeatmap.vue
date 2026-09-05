<script setup>
/**
 * Vue-Hülle um LiveFeed (Daten) und HeatmapRenderer (Zeichnen).
 *
 * Bewusst KEINE Reaktivität auf Ring, Orderbuch oder Renderer: Vue würde
 * Proxies um die TypedArrays legen und der Hot Path bräche zusammen. Reaktiv
 * sind nur Skalare für die Statusanzeige.
 *
 * Einstellungen kommen direkt aus dem Live-Store (wie SidebarFilters die
 * Journal-Filter liest), nicht über Props — die Bedienelemente sitzen im
 * Seitenmenü und in der Kopfzeile, also in ganz anderen Komponenten.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { LiveFeed } from '../utils/liveFeed.js'
import { HeatmapRenderer } from '../utils/heatmapRenderer.js'
import { loadReplay, loadReplayLiquidations } from '../utils/replaySource.js'
import { TradeRing } from '../utils/tradeRing.js'
import { followMid } from '../../shared/priceBins.js'
import { timeZoneTrade } from '../stores/ui.js'
import {
    liveSymbol, liveMarket, liveViewPct, liveFrameMs, liveHistoryMin, liveRamp,
    liveShowProfile, livePauseInBackground, liveColorMode, liveColorRef, liveSatMult,
    liveAutoFollow, liveFrozen, liveAutoRefValue, liveThreshold, liveShowLiquidations, liveDotStep, liveProfileW, liveShowVolumeBars,
    liveShowDelta, liveShowAbsorption,
    liveMode, replayFrom, replayTo, livePrefillMin, VIEW_PCT_OPTIONS,
    replayEntry, replayExit, replayFokus, replayZoom,
} from '../stores/live.js'
import dayjs from '../utils/dayjs-setup.js'

const emit = defineEmits(['status'])

const { t, locale } = useI18n()

/**
 * Der Renderer ist Vue-frei und kann kein useI18n(). Die Canvas-Texte werden
 * ihm deshalb hier übersetzt übergeben — einmal beim Einhängen und erneut,
 * wenn die Sprache wechselt.
 */
const canvasLabels = () => ({
    coverage: t('live.coverage'), traded: t('live.traded'), max: t('live.max'),
    liquidity: t('live.liquidity'), toMid: t('live.toMid'),
    noRecording: t('live.noRecording'), volumePer: t('live.volumePer', { n: '{n}' }),
    bought: t('live.bought'), sold: t('live.sold'), sum: t('live.sum'),
    buyerShare: t('live.buyerShare'),
})

const wrapEl = ref(null)
const heatEl = ref(null)
const overlayEl = ref(null)
const uiEl = ref(null)

const status = ref('idle')
const statusDetail = ref('')
/** Wie weit horizontal zurückgezogen wurde, in ms — nur fürs Badge, siehe colOffset. */
const panMs = ref(0)
/** Scrub-Position in der Wiedergabe: 0 = Anfang, 1 = Ende des Zeitfensters. */
const replayPos = ref(1)
const replayCols = ref(0)
const replayTimeLabel = ref('')
/** Auflösung der geladenen Wiedergabe, für die Beschriftung in der Kopfzeile. */
const replayAufloesung = ref('')
/**
 * Tatsächlich geladener Ausschnitt. Nicht dasselbe wie replayFrom/replayTo —
 * beim Zoomen auf Ein- oder Ausstieg ist er ein Teilstück davon, und die
 * Kopfzeile soll zeigen, was man sieht.
 */
const replayFensterLabel = ref('')
/** Kauf-/Verkaufsvolumen nahe am Mid — { bidQty, askQty, buyShare } oder null. */
const bookImbalance = ref(null)

defineExpose({ replayPos, replayCols, replayTimeLabel, replayAufloesung, replayFensterLabel, bookImbalance })

// Nicht-reaktiver Zustand
let feed = null
let replay = null          // { ring, frameMs, cols } im Wiedergabe-Modus
let replayLiqRing = null   // aufgezeichnete Liquidationen zum selben Fenster
let replayLauf = 0         // Zähler gegen verspätete Antworten alter Läufe
let replayBreite = 0       // Plotbreite, mit der die Wiedergabe geladen wurde
// Zuletzt angefragte Kombination. Beim Einstieg aus dem Journal laufen Mount,
// Watcher und die erste Grössenmessung fast gleichzeitig los — ohne diesen
// Schlüssel holt jede davon dieselben (grossen) Daten erneut.
let replaySchluessel = ''
// Takt der Aufzeichnung (nicht der Live-Einstellung). Erst nach dem ersten
// Laden sicher bekannt, der Standard der Aufzeichnung ist 1 s.
let quellTaktMs = 1000
let emptyTrades = new TradeRing(1)
let renderer = null
let ro = null
let raf = null
let resizeTimer = null
let normTimer = null
let view = null            // { lo, hi } in absoluten Bucket-Indizes
let cursor = null
// Basiswährung fürs Etikett im Profil-Tooltip: BTCUSDT → BTC. Die Mengen aus
// dem Trade-Stream sind in dieser Einheit, nicht in USDT.
const baseAsset = computed(
    () => (liveSymbol.value || '').replace(/(USDT|USDC|BUSD|USD)$/, '') || '')
let drag = null            // { y, lo, hi, x, colOffset0, zukunft0, axis } während des Ziehens
let frozenHead = null      // Ring-Position, an der die Ansicht eingefroren wurde
let framesSinceFreeze = 0
// Spalten, um die der Anker gegenüber frozenHead/Live-Kopf zurückversetzt ist —
// wächst beim horizontalen Ziehen, um ältere Wände in der Heatmap zu zeigen.
let colOffset = 0
/*
 * Breite des freien Feldes rechts, in Spalten (= Pixeln).
 *
 * Zieht man den Chart nach LINKS über die Gegenwart hinaus, entsteht dort
 * Platz, in den das aktuelle Buch als waagerechte Linien gezeichnet wird —
 * dieselbe Ansicht wie in Bookmap. In der Historie sind dieselben Orders über
 * die Zeitachse verschmiert; im freien Feld sieht man auf einen Blick, wo die
 * Wände liegen.
 *
 * Getrennt von `colOffset`, weil es zwei verschiedene Dinge sind:
 * `colOffset` blättert in der Vergangenheit, `zukunftCols` schafft Platz für
 * die Gegenwart. Beides in einer Zahl unterzubringen (negativer colOffset)
 * hätte den Anker in einen Bereich gerechnet, den der Ring nicht hat.
 */
let zukunftCols = 0
let dirtyHeat = false
let dirtyOverlay = false
let dirtyUi = false

const formatTime = (ms) => dayjs(ms).tz(timeZoneTrade.value || dayjs.tz.guess()).format('HH:mm:ss')
/** "12:34 zurück" fürs Badge — nur wenn per Zeitachse zurückgezogen wurde. */
const panLabel = computed(() => {
    if (!panMs.value) return ''
    const total = Math.round(panMs.value / 1000)
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${String(s).padStart(2, '0')}`
})

// Live-Feed und Wiedergabe füllen denselben Ringtyp — der Renderer bekommt
// deshalb in beiden Fällen dieselben Argumente.
const isReplay = () => liveMode.value === 'replay'
/**
 * Das Volumenprofil speist sich aus aggTrades, die nicht mitgeschnitten werden.
 * In der Wiedergabe bleibt die Spur deshalb aus — sonst reservierte sie
 * Plotbreite für eine leere Fläche.
 */
const profilAktiv = () => liveShowProfile.value && !isReplay()
const currentRing = () => (isReplay() ? replay?.ring : feed?.ring)
const currentTrades = () => (isReplay() ? emptyTrades : feed?.trades)
// Liquidationen liegen als eigene Sorte in der Aufzeichnung und werden zum
// Fenster nachgeladen; aggTrades dagegen schneiden wir nicht mit, deshalb
// bleiben die Handelspunkte in der Wiedergabe leer.
const currentLiquidations = () => (isReplay() ? (replayLiqRing || emptyTrades) : feed?.liquidations)
const currentFrameMs = () => (isReplay() ? (replay?.frameMs || liveFrameMs.value) : liveFrameMs.value)

/**
 * Bezugspunkt zum Zeichnen. Live: eingefroren der gemerkte Head, sonst der
 * aktuelle. Wiedergabe: die Scrub-Position auf der Zeitleiste.
 */
const anchor = () => {
    if (isReplay()) {
        const ring = replay?.ring
        if (!ring) return null
        return Math.max(1, Math.min(ring.cap, Math.round(replayPos.value * ring.cap)))
    }
    const base = liveFrozen.value && frozenHead !== null ? frozenHead : null
    const ring = feed?.ring
    if (!colOffset || !ring) return base
    // Bewusst NICHT über colFrom() verkettet: dessen i=0 meint bereits "eine
    // Spalte vor head" (head ist der nächste Schreibplatz, keine Datenspalte).
    // Das Ergebnis von colFrom als neuen head weiterzureichen verschöbe die
    // Ansicht um eine zusätzliche Spalte. Direkt vom head-Zeiger subtrahieren
    // trifft genau die gewünschten colOffset Spalten.
    const head = base ?? ring.head
    return (((head - colOffset) % ring.cap) + ring.cap) % ring.cap
}

/**
 * Anker auf das jüngste bekannte Buch — unabhängig davon, wie weit in der
 * Historie zurückgeblättert wurde.
 *
 * Bei eingefrorener Ansicht ist das der eingefrorene Kopf: Wer anhält, will
 * das Bild von damals festhalten, auch rechts.
 */
const jetztAnchor = () => {
    if (isReplay()) return anchor()
    return liveFrozen.value && frozenHead !== null ? frozenHead : (feed?.ring?.head ?? null)
}

/**
 * Wie weit lässt sich der Anker noch zurückversetzen, ohne dass hinter ihm
 * weniger als eine volle Bildschirmbreite an aufgezeichneten Spalten übrig
 * bliebe — dafür müsste der Renderer sonst mit teils leeren Spalten umgehen.
 *
 * Vor dem ersten vollen Umlauf (count < cap) sind nur die Spalten VOR dem
 * jeweiligen Anker beschrieben, nicht ring.count Spalten insgesamt — sonst
 * würde man bei einem früh eingefrorenen, seither im Hintergrund
 * weitergelaufenen Ring über den Anfang der Aufzeichnung hinaus in
 * unbeschriebene (leere) Spalten ziehen können.
 */
function maxColOffset() {
    const ring = feed?.ring
    if (!ring || !renderer) return 0
    const head = liveFrozen.value && frozenHead !== null ? frozenHead : ring.head
    const available = ring.count >= ring.cap ? ring.cap : head
    return Math.max(0, available - renderer.cols)
}

/**
 * Wiedergabe: nur Spalten bis zum Scrub-Punkt gelten als vorhanden.
 *
 * Der Replay-Ring wird linear befüllt (head = 0), `count` ist also frei
 * verfügbar, um das Ende der „bekannten" Daten zu markieren. Ohne diese
 * Klemme rechnet colFrom() modulo über den ganzen Ring und holt beim
 * Zurückspulen Spalten von NACH dem gewählten Zeitpunkt links ins Bild —
 * Lookahead-Bias: bei Anker 2 und fünf sichtbaren Spalten erschienen die
 * Ringindizes [7,8,9,0,1] statt nur [0,1].
 */
function syncReplayCount() {
    const ring = replay?.ring
    if (!ring) return
    ring.count = anchor() ?? ring.cap
}

/**
 * Mid an der aktuellen Position. In einer Aufzeichnung können Spalten leer sein
 * (Recorder war aus) — dann rückwärts bis zur letzten belegten Spalte suchen,
 * statt das Sichtfenster gar nicht erst zu setzen.
 */
function midAtAnchor(ring) {
    const head = anchor() ?? ring.head
    const grenze = Math.min(ring.count, ring.cap)
    for (let i = 0; i < grenze; i++) {
        const mid = ring.mid[ring.colFrom(head, i)]
        if (mid) return mid
    }
    return 0
}

/** Letzte Spalte mit Daten — Startpunkt der Zeitleiste. */
function letzteDatenSpalte(ring) {
    for (let c = ring.cap - 1; c >= 0; c--) if (ring.mid[c]) return c
    return -1
}

function setStatus(state, detail) {
    status.value = state
    statusDetail.value = detail || ''
    emit('status', { state, detail })
}

/** Sichtfenster nachführen; liefert true, wenn die Heatmap neu gezeichnet werden muss. */
function updateView(force = false) {
    const ring = currentRing()
    if (!ring) return false
    const mid = midAtAnchor(ring)
    if (!mid) return false

    const wanted = Math.round((mid * (liveViewPct.value / 100) * 2) / ring.bucketSize)
    const rowsView = Math.max(20, Math.min(wanted, ring.rows))
    const midBucket = Math.round(mid / ring.bucketSize)

    if (!view || force) {
        const half = rowsView >> 1
        view = { lo: midBucket - half, hi: midBucket + (rowsView - half) }
        return true
    }
    if ((view.hi - view.lo) !== rowsView) {
        // Zoom: Mitte des aktuellen Ausschnitts halten, nicht auf den Mid springen
        const center = Math.round((view.lo + view.hi) / 2)
        const half = rowsView >> 1
        view = { lo: center - half, hi: center + (rowsView - half) }
        return true
    }
    if (!liveAutoFollow.value) return false

    const next = followMid(view, midBucket, rowsView)
    view = { lo: next.lo, hi: next.hi }
    return next.shifted
}

function loop() {
    raf = requestAnimationFrame(loop)
    const ring = currentRing()
    if (document.hidden || !renderer || !ring || !view) return
    const head = anchor()
    const frameMs = currentFrameMs()
    if (dirtyHeat) {
        /*
         * Zweiter Anker fürs freie Feld: dort steht immer das JÜNGSTE bekannte
         * Buch, auch wenn man in der Historie zurückgeblättert hat. Sonst
         * stünde rechts eine zweite Vergangenheit, und die Linien beantworteten
         * die Frage nicht mehr, für die sie da sind.
         */
        renderer.drawHeat(ring, view, head, jetztAnchor())
        dirtyHeat = false
        dirtyOverlay = true
    }
    if (dirtyOverlay) {
        renderer.drawOverlay({
            ring, trades: currentTrades(), liquidations: currentLiquidations(),
            view, anchor: head, frameMs, bucketSize: ring.bucketSize,
            formatTime, showProfile: profilAktiv(),
            showLiquidations: liveShowLiquidations.value,
            // Nur live bekannt — in der Aufzeichnung ist die Reichweite nicht mitgespeichert
            coverage: !isReplay() && feed?.book?.coverLo
                ? { lo: feed.book.coverLo, hi: feed.book.coverHi }
                : null,
        })
        dirtyOverlay = false
        dirtyUi = true
    }
    if (dirtyUi) {
        renderer.drawUi(cursor, {
            ring, view, anchor: head, bucketSize: ring.bucketSize, frameMs, formatTime,
            baseLabel: baseAsset.value,
        })
        dirtyUi = false
    }
}

function applySize() {
    if (!wrapEl.value || !renderer) return
    const rect = wrapEl.value.getBoundingClientRect()
    if (rect.width < 10 || rect.height < 10) return
    renderer.resize(rect.width, rect.height)
    // Der Renderer klemmt das freie Feld auf ein Drittel der neuen Breite —
    // den geklemmten Wert zurückholen, sonst rechnet der nächste Zug mit einem
    // Startwert, den es nicht mehr gibt.
    zukunftCols = renderer.zukunft
    dirtyHeat = true
    // Die Verdichtung der Wiedergabe hängt an der Plotbreite — die steht beim
    // ersten Laden noch nicht immer fest (Layout, ausgeklapptes Seitenmenü).
    // Bei nennenswerter Abweichung neu holen, sonst zeigt die Karte weniger
    // oder gröber als der Platz hergibt. Die Totzone hält das Ziehen am
    // Fensterrand ruhig.
    if (isReplay() && renderer.cols && Math.abs(renderer.cols - replayBreite) > 40) startReplay()
}

/**
 * Zeitfenster der Wiedergabe: das Basisfenster (ganzer Trade plus Puffer),
 * zugeschnitten auf Fokus und Zoomstufe.
 *
 * Die Stufen sind Bruchteile der Gesamtspanne, keine festen Minutenwerte —
 * der Server verdichtet auf die Plotbreite, also füllt jede Stufe das Bild.
 * Die feinste sinnvolle Stufe ist genau eine Quellspalte je Pixel; enger
 * gefasst bliebe nur Leerfläche am Rand übrig.
 */
function replayFenster() {
    const von = replayFrom.value
    const bis = replayTo.value
    const spanne = bis - von
    if (!(spanne > 0)) return { von, bis }

    const feinste = (renderer?.cols || 1200) * quellTaktMs
    const wunsch = replayZoom.value > 0
        ? Math.max(feinste, Math.round(spanne * replayZoom.value))
        : feinste
    // Auf ganze Quellspalten runden. Ohne das ragt ein angebrochener Takt über
    // die Spaltengrenze hinaus, der Server muss zwei Spalten falten und die
    // feinste Stufe wäre plötzlich halb so fein.
    const laenge = Math.max(quellTaktMs, Math.floor(Math.min(spanne, wunsch) / quellTaktMs) * quellTaktMs)
    if (laenge >= spanne) return { von, bis }

    const fokus = replayFokus.value === 'entry' ? replayEntry.value
        : replayFokus.value === 'exit' ? replayExit.value
            : 0
    const mitte = fokus || (von + spanne / 2)
    // Am Rand nicht über das Basisfenster hinauslaufen
    const start = Math.max(von, Math.min(Math.round(mitte - laenge / 2), bis - laenge))
    // Auch der Anfang muss auf einem Takt sitzen, sonst zählt der Server eine
    // angebrochene Spalte am Rand mit.
    const ausgerichtet = Math.floor(start / quellTaktMs) * quellTaktMs
    return { von: ausgerichtet, bis: ausgerichtet + laenge }
}

/** „49 s / Spalte (verdichtet aus 1 s)" für die Kopfzeile. */
function beschreibeAufloesung({ frameMs, quellFrameMs, verdichtet }) {
    const takt = (ms) => (ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`)
    if (!verdichtet || verdichtet <= 1) return `${takt(frameMs)} / Spalte`
    return `${takt(frameMs)} / Spalte (verdichtet aus ${takt(quellFrameMs)})`
}

/** Wiedergabe: Zeitraum laden, Ring füllen, ans Ende springen. */
async function startReplay() {
    // Erst prüfen, dann verwerfen: die Wächter unten dürfen keinen bereits
    // geladenen Zustand hinterlassen haben, sonst bliebe die Karte leer.
    const { von, bis } = replayFenster()
    // Symbol und Markt einmal festhalten: zwischen den beiden Abrufen liegt ein
    // await, und die Einstellungen können in der Zwischenzeit hydrieren.
    const symbol = liveSymbol.value
    const market = liveMarket.value
    // Mehr Spalten als Pixel kann die Anzeige nicht zeigen; der Server faltet
    // die Aufzeichnung auf genau diese Breite zusammen. Steht die Breite noch
    // nicht fest, wird nicht auf Verdacht geladen — applySize() holt nach,
    // sobald gemessen ist. Sonst ginge der erste (grosse) Abruf ins Leere.
    if (renderer && !renderer.cols) return
    const breite = renderer?.cols || 0

    const schluessel = `${symbol}|${market}|${von}|${bis}|${breite}`
    if (schluessel === replaySchluessel) return

    stopFeed()
    replay = null
    replayLiqRing = null
    view = null
    replayCols.value = 0
    replayAufloesung.value = ''
    replayFensterLabel.value = ''
    setStatus('loading')
    if (!(bis > von)) { setStatus('empty', 'Kein gültiges Zeitfenster'); return }
    replaySchluessel = schluessel
    replayBreite = breite
    const tag = dayjs(von).tz(timeZoneTrade.value || dayjs.tz.guess()).format('DD.MM.')
    replayFensterLabel.value = `${tag} ${formatTime(von)} – ${formatTime(bis)}`
    // Späte Antworten eines vorherigen Laufs dürfen den aktuellen nicht
    // überschreiben — beim Durchklicken der Stufen passiert genau das sonst.
    const lauf = ++replayLauf
    try {
        const result = await loadReplay({
            symbol, market, from: von, to: bis,
            maxCols: replayBreite || undefined,
        })
        if (lauf !== replayLauf) return
        if (!result.ring) {
            setStatus('empty', result.hinweis)
            return
        }
        replay = result
        replayCols.value = result.cols
        quellTaktMs = result.quellFrameMs || quellTaktMs
        replayAufloesung.value = beschreibeAufloesung(result)

        // Liquidationen zum selben Fenster nachladen. Sie sind Beiwerk — ein
        // Fehler hier darf die Heatmap nicht mitreissen.
        loadReplayLiquidations({ symbol, market, from: von, to: bis })
            .then((ring) => {
                if (lauf !== replayLauf) return
                replayLiqRing = ring
                dirtyOverlay = true
            })
            .catch(() => {})
        // Ans Ende der tatsächlich vorhandenen Daten springen, nicht ans Ende
        // des angefragten Fensters — das kann grösstenteils leer sein.
        const letzte = letzteDatenSpalte(result.ring)
        if (letzte < 0) {
            setStatus('empty', 'Der Zeitraum enthält keine aufgezeichneten Spalten')
            return
        }
        replayPos.value = Math.min(1, (letzte + 1) / result.ring.cap)
        syncReplayCount()
        updateView(true)
        if (view) renderer?.recalcNorm(replay.ring, view, anchor())
        updateReplayLabel()
        dirtyHeat = true
        setStatus('replay', result.hinweis)
    } catch (error) {
        // Schlüssel freigeben, sonst blockiert der Wächter jeden neuen Versuch
        // mit denselben Werten.
        replaySchluessel = ''
        setStatus('error', error.response?.data?.error || error.message)
    }
}

function updateReplayLabel() {
    const ring = replay?.ring
    if (!ring) { replayTimeLabel.value = ''; return }
    const col = ring.colFrom(anchor(), 0)
    replayTimeLabel.value = ring.ts[col] ? formatTime(ring.ts[col]) : ''
}

async function startFeed() {
    stopFeed()
    replay = null
    replayLiqRing = null
    // Beim Verlassen der Wiedergabe vergessen, damit ein erneuter Einstieg in
    // dasselbe Fenster wieder lädt.
    replaySchluessel = ''
    view = null
    frozenHead = null
    liveFrozen.value = false
    colOffset = 0
    zukunftCols = 0
    renderer?.setZukunft(0)
    panMs.value = 0
    feed = new LiveFeed({
        symbol: liveSymbol.value,
        market: liveMarket.value,
        frameMs: liveFrameMs.value,
        historyMin: liveHistoryMin.value,
        pauseInBackground: livePauseInBackground.value,
        prefillMin: livePrefillMin.value,
        onStatus: (state, detail) => setStatus(state, detail),
        onFrame: () => {
            if (liveFrozen.value) {
                // Der Ring läuft weiter — irgendwann überschreibt er den
                // eingefrorenen Ausschnitt. Vorher selbst auftauen. Mit
                // Zeitversatz (zurückgezogene Ansicht) reicht der sichtbare
                // Ausschnitt colOffset Spalten weiter zurück — die Marge
                // schrumpft entsprechend, sonst zeigt eine lange eingefrorene,
                // weit zurückgezogene Ansicht irgendwann überschriebene Daten.
                framesSinceFreeze++
                if (framesSinceFreeze > feed.ring.cap - renderer.cols - colOffset - 10) unfreeze()
                return
            }
            const shifted = updateView()
            dirtyHeat = true
            if (shifted) renderer?.recalcNorm(feed.ring, view, anchor())
        },
    })
    await feed.start()
}

function stopFeed() {
    feed?.stop()
    feed = null
}

function unfreeze() {
    liveFrozen.value = false
    frozenHead = null
    framesSinceFreeze = 0
    colOffset = 0
    panMs.value = 0
    updateView()
    dirtyHeat = true
}

// ── Interaktion ─────────────────────────────────────────────

/**
 * Bedient wird mit Zeiger-Ereignissen statt Maus-Ereignissen: dieselbe Logik
 * trägt Maus, Stift und Finger. Auf dem Handy gibt es kein Hover und kein
 * Mausrad — dort ersetzen ein Finger (Schieben + Fadenkreuz), zwei Finger
 * (Zoom) und Doppeltippen (Auto-Achse) die Maus.
 *
 * Der eine Finger bedient zwei Achsen: hoch/runter verschiebt wie bisher die
 * Preisachse, links/rechts (nur live, nicht in der Wiedergabe — die hat ihre
 * eigene Scrub-Leiste) blättert in der bereits gepufferten Vergangenheit der
 * Heatmap zurück. Welche Achse gemeint ist, entscheidet erst die Bewegung
 * nach dem Ansetzen (grösserer Ausschlag gewinnt), nicht der Startpunkt.
 */
const zeiger = new Map()   // pointerId → {x, y} in Bildschirmkoordinaten
let pinch = null           // { dist, index } beim Ansetzen des zweiten Fingers
let letzterTipp = 0

const fingerAbstand = () => {
    const [a, b] = [...zeiger.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
}

const viewPctIndex = () => {
    const index = VIEW_PCT_OPTIONS.indexOf(liveViewPct.value)
    return index >= 0 ? index : VIEW_PCT_OPTIONS.findIndex(v => v >= liveViewPct.value)
}

function setViewPctIndex(index) {
    const next = Math.max(0, Math.min(VIEW_PCT_OPTIONS.length - 1, index))
    liveViewPct.value = VIEW_PCT_OPTIONS[next]
}

function onPointerMove(event) {
    if (!wrapEl.value) return
    if (zeiger.has(event.pointerId)) zeiger.set(event.pointerId, { x: event.clientX, y: event.clientY })

    // Zwei Finger: Auseinanderziehen holt das Preisband enger heran
    if (pinch && zeiger.size >= 2) {
        const ratio = fingerAbstand() / pinch.dist
        if (ratio > 0) setViewPctIndex(pinch.index - Math.round(Math.log2(ratio) * 2))
        return
    }

    // getBoundingClientRect statt offsetX: bleibt bei Transformationen korrekt
    const rect = wrapEl.value.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    // currentRing() statt feed: in der Wiedergabe gibt es keinen Feed, geschoben
    // werden darf dort trotzdem
    if (drag && currentRing() && view && renderer) {
        // Erst ab ein paar Pixeln wird aus dem Antippen ein Schieben — sonst
        // schaltet schon ein Tipp aufs Fadenkreuz die Auto-Achse ab.
        if (!drag.aktiv) {
            const dx = x - drag.x
            const dy = y - drag.y
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) { cursor = { x, y }; dirtyUi = true; return }
            drag.aktiv = true
            drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
            if (drag.axis === 'y') {
                // Ziehen heisst: der Nutzer will selbst bestimmen, wo die Achse steht
                if (liveAutoFollow.value) liveAutoFollow.value = false
            }
            /*
             * Früher wurde hier pauschal eingefroren, sobald die Achse 'x' war.
             * Das ist nur für das ZURÜCKBLÄTTERN richtig — beim Platzschaffen
             * fürs aktuelle Buch wäre es falsch: Dort will man ja gerade
             * zusehen, wie sich die Wände verschieben. Das Einfrieren passiert
             * jetzt unten, wenn `colOffset` tatsächlich über null geht.
             */
        }
        if (drag.axis === 'x') {
            if (isReplay()) return
            /*
             * Der Zug wird von rechts nach links auf eine durchgehende Achse
             * gelegt: Erst wird das freie Feld aufgebraucht, dann beginnt das
             * Zurückblättern. So fühlt sich das Ziehen wie EINE Bewegung an,
             * obwohl dahinter zwei verschiedene Grössen stehen.
             */
            /*
             * EINE Achse für zwei Grössen, Vorzeichen ist hier alles:
             *   nach RECHTS ziehen (dx > 0) → in der Historie zurückblättern
             *   nach LINKS ziehen  (dx < 0) → Platz fürs aktuelle Buch schaffen
             * Das entspricht der Leserichtung: Die Vergangenheit liegt links,
             * man holt sie sich nach rechts ins Bild; das freie Feld gehört
             * rechts hin, also schiebt man die Historie nach links weg.
             */
            const roh = drag.colOffset0 - drag.zukunft0 + Math.round(x - drag.x)
            if (roh >= 0) {
                colOffset = Math.min(maxColOffset(), roh)
                zukunftCols = 0
                // Erst hier einfrieren: sonst rutscht der Ausschnitt unter dem
                // Finger weg, weil der Live-Rand weiterläuft.
                if (colOffset > 0 && !isReplay() && !liveFrozen.value) liveFrozen.value = true
            } else {
                colOffset = 0
                zukunftCols = -roh
            }
            renderer?.setZukunft(zukunftCols)
            panMs.value = colOffset * currentFrameMs()
            dirtyHeat = true
            return
        }
        const rowsView = view.hi - view.lo
        const rowH = renderer.plotH / rowsView
        const shift = Math.round((y - drag.y) / rowH)
        view = { lo: drag.lo + shift, hi: drag.hi + shift }
        dirtyHeat = true
        return
    }
    cursor = { x, y }
    dirtyUi = true
}

function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    zeiger.set(event.pointerId, { x: event.clientX, y: event.clientY })
    // Zeiger einfangen, damit Schieben auch ausserhalb der Fläche weiterläuft
    try { wrapEl.value?.setPointerCapture(event.pointerId) } catch { /* egal */ }

    if (zeiger.size === 2) {
        drag = null
        pinch = { dist: fingerAbstand(), index: viewPctIndex() }
        return
    }
    if (!view) return
    const rect = wrapEl.value.getBoundingClientRect()
    drag = {
        y: event.clientY - rect.top, lo: view.lo, hi: view.hi,
        x: event.clientX - rect.left, colOffset0: colOffset, zukunft0: zukunftCols,
        aktiv: false, axis: null,
    }
    // Ohne Hover braucht der Finger sofort ein Fadenkreuz
    cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    dirtyUi = true
}

function onPointerUp(event) {
    if (event?.pointerId !== undefined) zeiger.delete(event.pointerId)
    else zeiger.clear()
    if (zeiger.size < 2) pinch = null

    // Doppeltippen ersetzt den Doppelklick — der wird auf Touch nicht überall
    // erzeugt, und ohne ihn käme man aus der festen Preisachse nicht heraus.
    if (event?.pointerType && event.pointerType !== 'mouse' && drag && !drag.aktiv) {
        const jetzt = Date.now()
        if (jetzt - letzterTipp < 320) { onDoubleClick(); letzterTipp = 0 }
        else letzterTipp = jetzt
    }
    drag = null
}

function onPointerLeave(event) {
    // Beim Loslassen eines Fingers meldet der Browser ebenfalls „leave" —
    // dann ist der Zustand schon in onPointerUp aufgeräumt.
    if (event?.pointerType === 'mouse') drag = null
    cursor = null
    dirtyUi = true
}

function onWheel(event) {
    event.preventDefault()
    setViewPctIndex(viewPctIndex() + (event.deltaY > 0 ? 1 : -1))
}

function onDoubleClick() {
    liveAutoFollow.value = true
    if (liveFrozen.value) unfreeze()
    colOffset = 0
    // Doppelklick ist die Geste für „alles auf Anfang" — dazu gehört das freie
    // Feld rechts. Beim blossen Auftauen bleibt es dagegen stehen: Es ist eine
    // Ansichtseinstellung wie eine Zoomstufe, kein Zeitversatz.
    zukunftCols = 0
    renderer?.setZukunft(0)
    panMs.value = 0
    updateView(true)
    dirtyHeat = true
}

// ── Lebenszyklus ────────────────────────────────────────────

onMounted(async () => {
    renderer = new HeatmapRenderer({ heat: heatEl.value, overlay: overlayEl.value, ui: uiEl.value })
    renderer.setRamp(liveRamp.value)
    renderer.setColorScale(liveColorMode.value, liveColorRef.value)
    renderer.setThreshold(liveThreshold.value)
    renderer.setSaturationMult(liveSatMult.value)
    renderer.setDotStep(liveDotStep.value)
    renderer.setLabels(canvasLabels())
    renderer.setProfileWidth(liveProfileW.value)
    renderer.setVolumeBarsVisible(liveShowVolumeBars.value)
    renderer.setDeltaVisible(liveShowDelta.value)
    renderer.setAbsorptionVisible(liveShowAbsorption.value)
    renderer.setProfileVisible(profilAktiv())
    await nextTick()
    applySize()

    ro = new ResizeObserver(() => {
        // Während des Ziehens feuert der Observer sehr oft — die Reallokation
        // des Offscreen-Canvas deshalb entprellen.
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(applySize, 100)
    })
    ro.observe(wrapEl.value)

    normTimer = setInterval(() => {
        const ring = currentRing()
        if (!ring || !view || !renderer) return
        renderer?.recalcNorm(ring, view, anchor())
        // Vorschlagswert für „Auto-Wert übernehmen" in den Einstellungen
        liveAutoRefValue.value = renderer.currentRef
        // Orderbuch-Tiefe wird nicht aufgezeichnet — in der Wiedergabe bleibt
        // die Anzeige deshalb leer statt einen alten Stand vorzutäuschen.
        bookImbalance.value = isReplay() ? null : (feed?.book?.topImbalance() ?? null)
    }, 1000)

    window.addEventListener('pointerup', onPointerUp)
    loop()
    await (isReplay() ? startReplay() : startFeed())
})

onBeforeUnmount(() => {
    cancelAnimationFrame(raf)
    raf = null
    ro?.disconnect()
    ro = null
    clearTimeout(resizeTimer)
    clearInterval(normTimer)
    window.removeEventListener('pointerup', onPointerUp)
    stopFeed()
    renderer = null
    view = null
})

watch([liveSymbol, liveMarket, liveFrameMs, liveHistoryMin], () => {
    if (!isReplay()) startFeed()
})
watch([liveMode, replayFrom, replayTo], () => {
    renderer?.setProfileVisible(profilAktiv())
    isReplay() ? startReplay() : startFeed()
})
// Fokus und Zoomstufe ändern das angefragte Fenster — die Auflösung entsteht
// im Server, es muss also neu geladen werden.
watch([replayFokus, replayZoom], () => { if (isReplay()) startReplay() })
watch(replayPos, () => {
    syncReplayCount()
    updateView()
    updateReplayLabel()
    dirtyHeat = true
})
watch(liveRamp, (name) => { renderer?.setRamp(name); dirtyHeat = true })
watch([liveColorMode, liveColorRef], ([mode, value]) => {
    renderer?.setColorScale(mode, value)
    dirtyHeat = true
})
watch(liveThreshold, (value) => { renderer?.setThreshold(value); dirtyHeat = true })
watch(liveSatMult, (value) => { renderer?.setSaturationMult(value); dirtyHeat = true })
// Punkte liegen auf der Overlay-Ebene — die Heatmap muss dafür nicht neu
watch(liveDotStep, (value) => { renderer?.setDotStep(value); dirtyOverlay = true })
watch(locale, () => { renderer?.setLabels(canvasLabels()); dirtyOverlay = true })
// Breite ändert die Plotbreite → Heatmap muss komplett neu
watch(liveProfileW, (value) => { renderer?.setProfileWidth(value); dirtyHeat = true })
// Säulen nehmen Höhe vom Chart → Heatmap muss neu
watch(liveShowVolumeBars, (v) => { renderer?.setVolumeBarsVisible(v); dirtyHeat = true })
// Delta-Spur nimmt ebenfalls Höhe vom Chart → Heatmap muss neu
watch(liveShowDelta, (v) => { renderer?.setDeltaVisible(v); dirtyHeat = true })
// Absorption ist reine Overlay-Zeichnung ohne Höhenänderung
watch(liveShowAbsorption, (v) => { renderer?.setAbsorptionVisible(v); dirtyOverlay = true })
watch(liveViewPct, () => { updateView(); dirtyHeat = true })
watch(liveShowProfile, () => {
    // Die Spur ändert die Plotbreite → Heatmap muss komplett neu gezeichnet werden
    renderer?.setProfileVisible(profilAktiv())
    dirtyHeat = true
})
watch(liveShowLiquidations, () => { dirtyOverlay = true })
watch(liveAutoFollow, (on) => { if (on) { updateView(true); dirtyHeat = true } })
watch(liveFrozen, (frozen) => {
    if (frozen) {
        frozenHead = feed?.ring?.head ?? null
        framesSinceFreeze = 0
    } else {
        frozenHead = null
        framesSinceFreeze = 0
        // Auch beim manuellen "Weiter"-Knopf (Liquidity.vue) und nicht nur
        // über unfreeze() hier drin: der Zeitversatz muss immer mit dem
        // Auftauen enden, egal woher es ausgelöst wurde.
        colOffset = 0
        panMs.value = 0
        updateView()
    }
    dirtyHeat = true
})
</script>

<template>
    <div ref="wrapEl" class="heatWrap" @pointermove="onPointerMove" @pointerdown="onPointerDown"
        @pointerup="onPointerUp" @pointercancel="onPointerUp" @pointerleave="onPointerLeave"
        @wheel="onWheel" @dblclick="onDoubleClick"
        :class="{ dragging: !!drag }">
        <canvas ref="heatEl" class="layer layerHeat"></canvas>
        <canvas ref="overlayEl" class="layer layerOverlay"></canvas>
        <canvas ref="uiEl" class="layer layerUi"></canvas>

        <div v-if="status !== 'live' && status !== 'replay'" class="heatBadge">
            <span v-if="status === 'error'" class="text-danger">{{ statusDetail || 'Fehler' }}</span>
            <span v-else-if="status === 'empty'" class="text-warning">
                <i class="uil uil-info-circle me-1"></i>{{ statusDetail || 'Keine Aufzeichnung' }}
            </span>
            <span v-else>
                <span class="spinner-border spinner-border-sm me-2"></span>
                <span v-if="status === 'connecting'">Verbinde…</span>
                <span v-else-if="status === 'syncing'">Synchronisiere Orderbuch…</span>
                <span v-else-if="status === 'reconnecting'">Verbindung verloren — neuer Versuch…</span>
                <span v-else-if="status === 'paused'">Pausiert (Tab im Hintergrund)</span>
                <span v-else-if="status === 'loading'">Lade Aufzeichnung…</span>
                <span v-else>Starte…</span>
            </span>
        </div>
        <div v-if="liveFrozen" class="heatBadge frozen">
            <i class="uil uil-pause me-1"></i>Eingefroren — Aufzeichnung läuft weiter
            <span v-if="panLabel"> · vor {{ panLabel }} Min</span>
        </div>
        <div v-else-if="!liveAutoFollow" class="heatBadge manual">
            <i class="uil uil-lock me-1"></i>Feste Preisachse — Doppelklick für Auto
        </div>
    </div>
</template>

<style scoped>
.heatWrap {
    position: absolute;
    inset: 0;
    cursor: crosshair;
    /* Der Finger schiebt die Preisachse und zoomt — die Geste darf nicht
       vorher als Seitenscroll oder Browser-Zoom abgefangen werden. */
    touch-action: none;
}

.heatWrap.dragging {
    cursor: grabbing;
}

.layer {
    position: absolute;
    inset: 0;
    display: block;
}

.layerHeat { z-index: 1; }
.layerOverlay { z-index: 2; }
.layerUi { z-index: 3; }

.heatBadge {
    position: absolute;
    top: 0.6rem;
    left: 0.7rem;
    z-index: 4;
    font-size: 0.78rem;
    color: var(--white-70);
    background: rgba(0, 0, 0, 0.55);
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
    pointer-events: none;
}

.heatBadge.frozen {
    color: #ffc107;
}

.heatBadge.manual {
    color: var(--white-60);
}
</style>
