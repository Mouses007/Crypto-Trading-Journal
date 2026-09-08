/**
 * Canvas-Renderer für Liquiditäts-Heatmap + Bookmap-Overlay.
 *
 * Framework-frei und ohne Vue-Reaktivität: der Hot Path liest ausschliesslich
 * TypedArrays. Gezeichnet wird auf drei Layer, weil die Auffrischraten weit
 * auseinanderliegen — eine Mausbewegung darf nie die Heatmap neu zeichnen:
 *   heat    ~2 Hz (neue Spalte / verschobenes Preisfenster)
 *   overlay bis 60 Hz (Trades, Mid-Linie, Achsen)
 *   ui      nur bei Mausbewegung (Crosshair, Tooltip)
 *
 * Kern der Heatmap ist ein Offscreen-Canvas mit exakt einem Pixel pro Zelle:
 * einmal als ImageData befüllen, dann hochskaliert blitten. Das ersetzt
 * zehntausende fillRect-Aufrufe durch einen einzigen drawImage.
 */

import { decimalsFor } from '../../shared/priceBins.js'
import { FLAG_LUECKE } from './heatmapRing.js'
import { spaltenProPixel, spaltenFenster } from './heatmapAchse.js'

// Breiter als früher (66), weil die Achsenschrift von 10 auf 12 px gewachsen
// ist: „112345.67" braucht bei 12 px rund 62 px plus Innenabstand.
export const AXIS_W = 78      // Preisachse rechts
export const AXIS_H = 24      // Zeitachse unten
export const VOLUME_H = 56    // Spur mit gehandeltem Volumen je Zeitabschnitt
export const DELTA_H = 40     // Spur mit dem laufenden Kauf-/Verkaufssaldo (CVD)
// Vielfaches der ruhenden Menge, ab dem gehandeltes Volumen an einer Preisstufe
// als Absorption gilt. Bewusst grosszügig gewählt: eine normale Umsatzspitze
// an einer dünnen Zeile soll nicht schon als Wand-Absorption durchgehen.
const ABSORPTION_MULT = 3
export const PROFILE_W = 74   // Vorgabebreite der Volumenprofil-Spur
export const BUCH_W = 96      // Vorgabebreite der Buch-Leiter (ruhende Mengen)
// Rasterbreite der Handelspunkte in Pixeln (über setDotStep einstellbar).
// Muss grösser sein als der Durchmesser eines typischen Punktes (~8 px),
// sonst berühren sie sich lückenlos und ergeben ein Band statt einzelner
// Blasen. Nur die wirklich grossen Punkte überlappen dann noch — was sie zu
// Recht heraushebt. Gegengemessen bei 388 px Plotbreite: 1 px ergab eine
// einzige 270 px lange Kette, 6 px noch 104 px, 11 px höchstens 17 px.
const DOT_STEP_DEFAULT = 11

/*
 * Zeitfenster, über das das freie Feld rechts gemittelt wird.
 *
 * Dort steht kein Zeitverlauf, sondern EIN Buchzustand — über ein Drittel der
 * Fläche wiederholt. Eine Order, die nur einen Takt lang liegt, blitzt damit
 * als 150 px breite Linie auf und wieder weg; in der Historie wäre sie ein
 * Pixel gewesen. Der Mittelwert über zwei Sekunden dämpft genau das: was
 * wirklich liegt, bleibt hell, was zuckt, wird blass statt zu blinken.
 */
const JETZT_FENSTER_MS = 2000

/*
 * Wie weit über das Mittelungsfenster hinaus nach brauchbaren Spalten gesucht
 * wird (als Vielfaches davon).
 *
 * Über Lücken hinweg suchen ist richtig — sonst reisst ein einzelner
 * gekreuzter Takt das Feld leer. Unbegrenzt suchen ist falsch: nach einem
 * längeren Ausfall stünde rechts ein minutenaltes Buch und behauptete,
 * „jetzt" zu sein. Acht Fensterbreiten sind bei 500 ms rund 16 Sekunden;
 * danach bleibt das Feld leer, und die Statuszeile sagt warum.
 */
const JETZT_RUECKBLICK = 8

/**
 * Wie stark eine Preisstufe ausserhalb der Snapshot-Reichweite im freien Feld
 * noch durchkommt (Rest wird zum Grund gemischt).
 *
 * Dort kennt das Buch nur, was sich seit dem Sync geändert hat (siehe
 * `_drawCoverage`). Solche Stufen in voller Helligkeit zu zeichnen macht aus
 * einem einzelnen zugelieferten Level optisch dieselbe Wand wie aus einer
 * vollständig erfassten.
 */
const UNVOLLSTAENDIG_ANTEIL = 0.45

/**
 * Wie stark eine neue Schätzung des Bezugswerts durchschlägt (0..1).
 *
 * Das 95. Perzentil wird aus einer Stichprobe geschätzt und einmal pro Sekunde
 * neu. Ungeglättet setzt jede Schätzung die Skala neu — und weil sich alle
 * Farben gemeinsam daran ausrichten, kippt im Sekundentakt das ganze Bild.
 * Nachziehen statt setzen: echte Marktwechsel kommen in ein paar Sekunden an,
 * das Rauschen der Stichprobe mittelt sich weg.
 */
const REF_GLAETTUNG = 0.25

/*
 * Bezug der automatischen Skala: der MEDIAN der sichtbaren Mengen.
 *
 * Vorgeschichte in zwei Fehlschlägen, beide gemessen:
 *
 *   Bezug p95, Sättigung 2,5× — per Definition liegen 95 % aller Zellen
 *   darunter, die Log-Stauchung drückt sie weiter zusammen: 87 % landeten in
 *   den zwei dunkelsten Blautönen, grün oder wärmer waren 2 %.
 *
 *   Rangabbildung (Perzentil) — verteilt die Farben gleich und ist damit
 *   massstabsfrei, maximiert den Kontrast aber ÜBERALL, auch dort, wo nichts
 *   zu sehen ist. Ein Mengenunterschied von 10 %, also Rauschen, bewegte die
 *   Farbe um 7 % der Rampe; die Karte flimmerte.
 *
 * Der Median löst beides mit dem alten Werkzeug: ein Verhältnismassstab hält
 * „gleiches Verhältnis = gleicher Farbabstand" (10 % Unterschied → 2 % Rampe,
 * dreimal ruhiger als der Rang) und ist über den Median trotzdem auf jedem
 * Symbol richtig eingenordet. Der Fehler war nie die Methode, sondern der
 * Arbeitspunkt.
 *
 * Gemessen an einem echten BTC-Buch, Anteile über die sieben Farbbänder:
 *   p95 / 2,5×      57 / 30 /  8 / 2 / 1 / 1 / 1
 *   Rang, Gamma 1,8 39 / 19 / 15 / 11 / 7 / 7 / 1
 *   Median / 10×    24 / 48 / 18 / 7 / 1 / 1 / 1
 */
const BEZUG_PERZENTIL = 0.5


/**
 * Farbe `a` mit Anteil `f` über den Grund `b` legen (beide ABGR, deckend).
 *
 * Bewusst zum GRUND hin gemischt, nicht zum Schwarz hin abgedunkelt: sonst
 * kann eine zurückgenommene schwache Zelle dunkler werden als der leere
 * Hintergrund, und eine echte Order sähe aus wie weniger als nichts.
 */
function mische(a, b, f) {
    const g = 1 - f
    const r = ((((a & 255) * f + (b & 255) * g) | 0)) & 255
    const gr = (((((a >>> 8) & 255) * f + ((b >>> 8) & 255) * g) | 0)) & 255
    const bl = (((((a >>> 16) & 255) * f + ((b >>> 16) & 255) * g) | 0)) & 255
    return ((a & 0xff000000) | (bl << 16) | (gr << 8) | r) >>> 0
}

const COLORS = {
    grid: 'rgba(255,255,255,0.10)',
    axisText: 'rgba(255,255,255,0.78)',
    midLine: 'rgba(255,255,255,0.75)',
    accent: '#01B4FF',
    // Handelsblasen: deckend statt additiv überblendet, dazu ein dunkler Rand.
    // Additives Blending liess überlappende Blasen zu weissem Brei verlaufen.
    buy: 'rgb(38,190,150)',          // --green
    sell: 'rgb(255,95,86)',          // --red-color
    buyEdge: 'rgba(6,60,48,0.85)',
    sellEdge: 'rgba(70,14,10,0.85)',
    gap: 'rgba(190,190,190,0.34)',
    tooltipBg: 'rgba(18,18,18,0.94)',
}

// Stützpunkte der Farbrampen (t = 0..1)
const RAMPS = {
    // Näher an Bookmaps Klassik: der Übergang nach Gelb/Rot setzt deutlich
    // früher ein, damit mittlere Liquidität nicht im Blau untergeht.
    //
    // Endet bewusst in Rot statt in Weiss. Weiss lag früher bei 1,0, also beim
    // Vierfachen des Bezugswerts — praktisch nie erreicht, und die Beschriftung
    // warb damit für eine Farbe, die man nie zu Gesicht bekam. Die frei
    // gewordenen obersten Prozente stehen jetzt für Rot-Abstufungen zur
    // Verfügung, sodass sich grosse Wände untereinander unterscheiden lassen.
    bookmap: [
        [0, 6, 14, 48], [0.18, 20, 80, 190], [0.38, 24, 190, 205],
        [0.58, 150, 230, 90], [0.74, 250, 215, 55], [0.86, 246, 150, 40],
        [1, 226, 46, 38],
    ],
    journal: [
        [0, 8, 12, 20], [0.35, 1, 90, 150], [0.7, 1, 180, 255], [1, 235, 250, 255],
    ],
    // Viridis — die Rampe, die Coinglass & Co. verwenden: dunkelviolett über
    // Blau und Grün nach Gelb. Wahrnehmungslinear, also sind Helligkeits-
    // unterschiede auch echte Mengenunterschiede.
    viridis: [
        [0, 68, 1, 84], [0.25, 59, 82, 139], [0.5, 33, 145, 140],
        [0.75, 94, 201, 98], [1, 253, 231, 37],
    ],
}

function rampColor(stops, t) {
    for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
            const [t0, r0, g0, b0] = stops[i - 1]
            const [t1, r1, g1, b1] = stops[i]
            const f = (t - t0) / (t1 - t0 || 1)
            return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f]
        }
    }
    const last = stops[stops.length - 1]
    return [last[1], last[2], last[3]]
}

/** 256-Einträge-LUT, gepackt als ABGR für direktes Schreiben in Uint32Array. */
function buildLut(rampName) {
    const stops = RAMPS[rampName] || RAMPS.bookmap
    const lut = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
        const t = i / 255
        const [r, g, b] = rampColor(stops, t)
        /*
         * Deckend, nicht durchscheinend.
         *
         * Bis zum 07.09.2026 stand hier eine Alpha-Rampe (30…255), die schwache
         * Liquidität transparent liess. Damit schlug die schwarze Seite durch,
         * und der Hintergrund der Karte war SCHWARZ statt blau — der auffälligste
         * Unterschied zur Vorlage, und einer, der wie Rauschen aussieht: jede
         * Zelle stand einzeln vor dem Nichts statt in einem Feld.
         *
         * Dunkel wird die untere Rampe schon durch ihre eigene Farbe (6,14,48).
         * Zwei Mechanismen für dieselbe Sache waren einer zu viel.
         */
        lut[i] = (255 << 24) | (b << 16) | (g << 8) | (r & 255)
    }
    return lut
}

export class HeatmapRenderer {
    constructor({ heat, overlay, ui }) {
        this.heatEl = heat
        this.overlayEl = overlay
        this.uiEl = ui
        this.heatCtx = heat.getContext('2d')
        this.overlayCtx = overlay.getContext('2d')
        this.uiCtx = ui.getContext('2d')

        this.cssW = 0
        this.cssH = 0
        this.plotW = 0
        this.plotH = 0
        this.profileW = 0
        this.axisW = AXIS_W
        this.axisX = 0
        this.cols = 0
        /*
         * Spalten, die rechts für das AKTUELLE Buch frei bleiben.
         *
         * Bookmap hält dort Luft und zeichnet hinein, was gerade im Buch liegt.
         * In der Historie sind dieselben Orders über die Zeitachse verschmiert
         * und von Handelsspuren überlagert; im freien Raum stehen sie als
         * klare waagerechte Linien, und man sieht auf einen Blick, wo die
         * Wände liegen.
         *
         * 0 heisst: alles wie bisher, die Gegenwart klebt am rechten Rand.
         */
        this.zukunft = 0

        /*
         * Sichtbare Zeitspanne in Millisekunden; 0 = native Auflösung.
         *
         * Bis zum 07.09.2026 gab es das nicht: eine Ringspalte war immer genau
         * ein Pixel, die sichtbare Spanne also Plotbreite × Takt — bei 800 px
         * und 500 ms sechseinhalb Minuten, und mehr war nicht einstellbar.
         * Die Ringlänge bestimmte nur, was AUFGEHOBEN wird, nicht was gezeigt
         * wird; an den Rest kam man ausschliesslich durch Ziehen. Heute folgt
         * sie der Spanne (`historieFuer` in stores/live.js).
         *
         * Jetzt wird gefaltet (mehrere Spalten je Pixel) oder gestreckt (eine
         * Spalte über mehrere Pixel) — gemittelt und über den PREIS, nicht über
         * die Zeile, weil der Anker `base` von Spalte zu Spalte mit dem Kurs
         * wandert. Dieselbe Regel wie in `sliceRange` der Wiedergabe.
         */
        this.spanneMs = 0
        this._achseCache = null

        /*
         * Ringzeilen je Bildzeile.
         *
         * Das Gegenstück zur Zeitspanne, auf der Preisachse. Eine Ringzeile ist
         * bei BTC 2 USD; ruhende Orders sitzen aber auf runden Preisen, mit
         * Lücken dazwischen. Ungefaltet ergibt das haarfeine Striche mit
         * dunklen Zwischenräumen statt der Zonen, die man in der Vorlage sieht
         * — gemeldet am 07.09.2026 als „die Zonen sind ziemlich schmal".
         *
         * Gefaltet wird beim ZEICHNEN, nicht im Ring: so bleibt die feine
         * Aufzeichnung erhalten und die Auflösung ist im Betrieb umstellbar,
         * ohne den Ring (und damit die Historie) neu zu bauen.
         */
        this.preisFaltung = 1

        /*
         * Reichweite des letzten Snapshots, vom Zeichnen mitgeschrieben.
         *
         * Liegt hier, weil `recalcNorm` sie braucht (Bezugswert nur aus dem
         * vollständig erfassten Bereich) und getrennt vom Zeichnen aufgerufen
         * wird — als zweiter Parameter durch drei Aufrufstellen geschleift
         * wäre sie irgendwann an einer davon vergessen worden.
         */
        this.coverage = null

        this.off = document.createElement('canvas')
        this.offCtx = this.off.getContext('2d')
        this.img = null
        this.buf32 = null

        this.lut = buildLut('bookmap')
        this.ref = 1
        this.refGesetzt = false   // erste Schätzung setzt hart, danach wird geglättet
        this._refPhase = 0        // rotierender Versatz der Stichprobe
        this._jetztBuf = null     // Summenspalte des freien Felds
        this.satMult = 2.5
        this.invLogMax = 1 / Math.log1p(this.satMult)
        this.cursor = null
        this.colorMode = 'auto'   // 'auto' = rollendes p95, 'fixed' = gesetzter Wert
        this.threshold = 0        // 0..0.95 — blendet schwache Liquidität ganz aus
        this.dotStep = DOT_STEP_DEFAULT
        this.profileWanted = PROFILE_W
        this.profileVisible = false
        /*
         * Buch-Leiter rechts: was gerade an ruhenden Mengen im Buch liegt,
         * je Preiszone, als Balken mit Zahl.
         *
         * Nicht dasselbe wie das Volumenprofil daneben — das zeigt, was
         * GEHANDELT wurde, die Leiter zeigt, was LIEGT. Und nicht dasselbe wie
         * das freie Feld: dort steht dieselbe Grösse als Farbe über die Zeit
         * verlängert, hier als Zahl und nach Seite getrennt (Gebot/Brief).
         */
        this.buchVisible = false
        this.buchWanted = BUCH_W
        this.buchW = 0
        this.buchX = 0
        this.buchZonen = null     // Werte der Leiter, für den Tooltip
        this.profileBins = null   // Werte der Spur, für den Tooltip
        this.volumeH = 0          // Höhe der Volumen-Spur unten (0 = aus)
        this.volumeBins = null    // Werte der Säulen, für den Tooltip
        this.deltaH = 0           // Höhe der Delta-Spur (CVD) unten (0 = aus)
        this.absorptionOn = false // Preisstufen mit auffälliger Absorption markieren
        // Beschriftungen der Canvas-Texte. Der Renderer ist bewusst Vue-frei und
        // kann kein useI18n() — die Komponente reicht die übersetzten Texte
        // durch. Die Vorgaben hier sind nur ein Notnagel, falls setLabels()
        // ausbleibt, damit nie ein leeres Etikett gezeichnet wird.
        this.labels = {
            coverage: '', traded: 'traded', max: 'max', liquidity: 'Liquidity',
            toMid: '% to mid', noRecording: '—', volumePer: 'Volume / {n}',
            bought: 'Bought', sold: 'Sold', sum: 'Total', buyerShare: 'Buyer share',
            book: 'Book', bid: 'Bid', ask: 'Ask', otherVenues: 'Other venues', share: 'Binance',
        }
        this.rampName = 'bookmap'
    }

    /** Zellen unterhalb dieses Anteils der Farbskala werden nicht gezeichnet. */
    setThreshold(value) {
        this.threshold = Math.max(0, Math.min(0.95, Number(value) || 0))
    }

    /**
     * Beim Wievielfachen des Bezugswerts ('auto': rollendes 95. Perzentil) eine
     * Zelle voll gesättigt ist. Kleiner lässt Wände schneller heiss aufleuchten,
     * grösser hält die Skala zurückhaltender — der bisherige Fixwert 4 liess nur
     * die obersten ~5 % aller Mengen je Farbe zeigen.
     */
    setSaturationMult(value) {
        this.satMult = Math.max(1.2, Math.min(8, Number(value) || 2.5))
        this.invLogMax = 1 / Math.log1p(this.satMult)
    }

    /** Rasterbreite der Handelspunkte in Pixeln (1 = jede Spalte einzeln). */
    setDotStep(value) {
        this.dotStep = Math.max(1, Math.min(120, Math.round(Number(value)) || DOT_STEP_DEFAULT))
    }

    /** Übersetzte Canvas-Texte setzen (siehe this.labels). */
    setLabels(labels) {
        if (labels) Object.assign(this.labels, labels)
    }

    setRamp(name) {
        this.rampName = RAMPS[name] ? name : 'bookmap'
        this.lut = buildLut(this.rampName)
    }

    /**
     * 'auto': Farbe wird laufend auf das 95. Perzentil der sichtbaren Mengen
     * normiert — gut lesbar, aber die Helligkeit bedeutet je nach Marktlage
     * etwas anderes. 'fixed': fester Sättigungsbezug, damit Bilder über Zeit und
     * zwischen Symbolen vergleichbar bleiben.
     */
    setColorScale(mode, value) {
        const vorher = this.colorMode
        this.colorMode = mode === 'fixed' ? 'fixed' : 'auto'
        if (this.colorMode === 'fixed' && value > 0) this.ref = value
        // Zurück auf 'auto': die nächste Schätzung soll hart setzen. Sonst
        // kröche die Skala vom festen Wert aus sekundenlang auf den echten zu.
        if (this.colorMode === 'auto' && vorher === 'fixed') this.refGesetzt = false
    }

    /**
     * Farbskala neu einrasten lassen (Symbolwechsel, neue Wiedergabe).
     * Ohne das würde die Glättung den Bezugswert des alten Symbols mitziehen.
     */
    resetNorm() {
        this.refGesetzt = false
    }

    /** Aktueller Normierungswert — Vorschlag für „Auto-Wert übernehmen". */
    get currentRef() {
        return this.ref
    }

    /**
     * Das Volumenprofil bekommt eine eigene Spur zwischen Heatmap und
     * Preisachse. Es über die Heatmap zu legen verdeckte ausgerechnet die
     * neuesten Spalten und liess sich kaum von Liquiditätsbändern unterscheiden.
     */
    setProfileVisible(visible) {
        this.profileVisible = !!visible
        if (this.cssW) this.resize(this.cssW, this.cssH)
    }

    /**
     * Breite der Volumenprofil-Spur in CSS-Pixeln. Ab etwa 120 px ist Platz für
     * Zahlen neben den Balken — darunter blieben sie nur ein Balkendiagramm
     * ohne Massstab.
     */
    /**
     * Spur mit gehandeltem Volumen je Zeitabschnitt unter dem Chart. Grün, wenn
     * Käufer aggressiver waren, sonst rot — daran liest man den Wechsel der
     * Initiative ab, der in den Blasen nur schwer zu sehen ist.
     */
    setVolumeBarsVisible(visible) {
        const wanted = visible ? VOLUME_H : 0
        if (this.volumeH === wanted) return
        this.volumeH = wanted
        if (this.cssW) this.resize(this.cssW, this.cssH)
    }

    /** Spur mit dem laufenden Kauf-/Verkaufssaldo (Cumulative Volume Delta). */
    setDeltaVisible(visible) {
        const wanted = visible ? DELTA_H : 0
        if (this.deltaH === wanted) return
        this.deltaH = wanted
        if (this.cssW) this.resize(this.cssW, this.cssH)
    }

    /** Preisstufen markieren, an denen deutlich mehr gehandelt als geruht wurde. */
    setAbsorptionVisible(visible) {
        this.absorptionOn = !!visible
    }

    setProfileWidth(px) {
        this.profileWanted = Math.max(40, Math.min(320, Math.round(Number(px)) || PROFILE_W))
        if (!this.profileVisible) return
        if (this.cssW) this.resize(this.cssW, this.cssH)
    }

    /** Buch-Leiter ein-/ausblenden (ruhende Mengen je Preiszone). */
    setBuchVisible(visible) {
        const wert = !!visible
        if (wert === this.buchVisible) return
        this.buchVisible = wert
        if (this.cssW) this.resize(this.cssW, this.cssH)
    }

    setBuchWidth(px) {
        this.buchWanted = Math.max(48, Math.min(240, Math.round(Number(px)) || BUCH_W))
        if (!this.buchVisible) return
        if (this.cssW) this.resize(this.cssW, this.cssH)
    }

    /**
     * @param {number} cssW  Breite in CSS-Pixeln
     * @param {number} cssH  Höhe in CSS-Pixeln
     */
    resize(cssW, cssH) {
        // Über 2 lohnt die DPR-Auflösung bei einer Heatmap nicht mehr
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        this.cssW = cssW
        this.cssH = cssH
        // Auf dem Handy sind Achse und Profilspur zusammen breiter als die
        // Heatmap selbst. Beide werden deshalb an der verfügbaren Breite
        // gemessen statt an festen Vorgaben — die Spalten bleiben lesbar.
        this.axisW = cssW < 520 ? 64 : AXIS_W
        this.profileW = this.profileVisible
            ? Math.max(36, Math.min(this.profileWanted, Math.floor(cssW * 0.22)))
            : 0
        // Die Leiter teilt sich den Rand mit dem Profil. Beide zusammen dürfen
        // nicht mehr als 44 % nehmen, sonst bleibt von der Karte zu wenig.
        this.buchW = this.buchVisible
            ? Math.max(48, Math.min(this.buchWanted, Math.floor(cssW * 0.22)))
            : 0
        if (this.profileW + this.buchW > cssW * 0.44) {
            this.buchW = Math.max(0, Math.floor(cssW * 0.44 - this.profileW))
        }
        this.plotW = Math.max(50, Math.floor(cssW - this.axisW - this.profileW - this.buchW))
        this.plotH = Math.max(50, Math.floor(cssH - AXIS_H - this.volumeH - this.deltaH))
        this.buchX = this.plotW + this.profileW
        this.axisX = this.buchX + this.buchW
        this.cols = this.plotW
        this._klemmeZukunft()
        this._achseCache = null

        for (const el of [this.heatEl, this.overlayEl, this.uiEl]) {
            el.width = Math.floor(cssW * dpr)
            el.height = Math.floor(cssH * dpr)
            el.style.width = cssW + 'px'
            el.style.height = cssH + 'px'
            // setTransform statt scale — scale würde sich bei jedem Resize aufaddieren
            el.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0)
        }
    }

    _ensureOffscreen(rowsView) {
        if (!this._jetztBuf || this._jetztBuf.length !== rowsView) {
            this._jetztBuf = new Float32Array(rowsView)
            this._spaltenBuf = new Float32Array(rowsView)
        }
        if (this.off.width === this.cols && this.off.height === rowsView && this.buf32) return
        this.off.width = this.cols
        this.off.height = rowsView
        this.img = this.offCtx.createImageData(this.cols, rowsView)
        this.buf32 = new Uint32Array(this.img.data.buffer)
    }

    /**
     * Normierung auf das 95. Perzentil der sichtbaren Mengen. Ohne Log-Stauchung
     * wäre alles ausser den grössten Wänden schwarz — Orderbuch-Liquidität
     * unterscheidet sich um Grössenordnungen.
     */
    /**
     * Breite, in der HISTORIE gezeichnet wird. Alles rechts davon gehört dem
     * aktuellen Buch.
     */
    get histCols() { return Math.max(1, this.cols - this.zukunft) }

    /** Höchstens ein Drittel der Fläche; darunter bliebe von der Historie zu wenig. */
    _klemmeZukunft() {
        const max = Math.floor(this.cols / 3)
        this.zukunft = Math.max(0, Math.min(max, Math.round(this.zukunft)))
    }

    /** Ringzeilen je Bildzeile (1 = volle Auflösung des Rings). */
    setPreisFaltung(n) {
        this.preisFaltung = Math.max(1, Math.min(32, Math.round(Number(n)) || 1))
    }

    /** Sichtbare Zeitspanne in ms setzen; 0 = eine Ringspalte je Pixel. */
    setSpanne(ms) {
        const wert = Math.max(0, Number(ms) || 0)
        if (wert === this.spanneMs) return
        this.spanneMs = wert
        this._achseCache = null
    }

    /**
     * Ringspalten je Ausgabepixel. Unter 1 heisst hineingezoomt (eine Spalte
     * über mehrere Pixel), über 1 gefaltet.
     *
     * Geklemmt, weil beide Enden entarten: unter 1/16 wäre eine Spalte 16 px
     * breit und das Bild eine Treppe, über 64 fiele eine Minute in ein Pixel
     * und die Mittelung löschte jede Wand aus.
     */
    _spaltenProPixel(frameMs) {
        return spaltenProPixel(this.spanneMs, frameMs, this.histCols)
    }

    /** Ringspalten je Pixel — für Zuglogik und Einfrier-Marge ausserhalb. */
    spaltenProPixel(frameMs) { return this._spaltenProPixel(frameMs) }

    /**
     * Zeit, die im Bild tatsächlich mit Aufzeichnung belegt ist (ms).
     *
     * Nicht dasselbe wie die gewählte Spanne: der Ring kann jünger sein als
     * sie. Ohne diese Zahl steht links schwarze Fläche ohne Erklärung — genau
     * das war die Frage „was das?" am 07.09.2026.
     */
    abdeckungMs(frameMs) {
        const a = this._achseCache
        if (!a || !(frameMs > 0)) return 0
        return Math.max(0, (this.histCols - a.ersterPx) * a.k * frameMs)
    }

    /** Ringspalten, die die Historie im Bild gerade abdeckt. */
    sichtbareSpalten(frameMs) {
        return Math.max(1, Math.round(this.histCols * this._spaltenProPixel(frameMs)))
    }

    /**
     * Zeitachse: welche Ringspalten liegen hinter welchem Ausgabepixel.
     *
     * `jung[px]` ist der jüngste, `alt[px]` der älteste Beitrag (beide als
     * Abstand von `head`, also 0 = neueste Spalte), `ts[px]` die Zeit des
     * jüngsten. -1 heisst: für dieses Pixel gibt es keine Daten.
     *
     * Wird pro Bild einmal gebaut und von Heat, Overlay und Tooltip geteilt —
     * dreimal dieselbe Rechnung war schon vor der Faltung fehleranfällig,
     * mit ihr wäre es sicher auseinandergelaufen.
     */
    _achse(ring, head, frameMs) {
        const n = this.histCols
        const k = this._spaltenProPixel(frameMs)
        const c = this._achseCache
        if (c && c.n === n && c.head === head && c.k === k && c.count === ring.count) return c

        const a = (c && c.n === n) ? c : {
            n, jung: new Int32Array(n), alt: new Int32Array(n), ts: new Float64Array(n),
        }
        a.head = head
        a.k = k
        a.count = ring.count
        a.ersterPx = n
        for (let px = 0; px < n; px++) {
            const { jung, alt: altRoh } = spaltenFenster(px, n, k)
            if (jung >= ring.count) { a.jung[px] = -1; a.alt[px] = -1; a.ts[px] = 0; continue }
            const alt = Math.min(altRoh, ring.count - 1)
            a.jung[px] = jung
            a.alt[px] = alt
            a.ts[px] = ring.ts[ring.colFrom(head, jung)]
            if (px < a.ersterPx) a.ersterPx = px
        }
        this._achseCache = a
        return a
    }

    /**
     * Wie viele Spalten rechts freibleiben sollen.
     * @returns {number} der tatsächlich gesetzte Wert (geklemmt)
     */
    setZukunft(spalten) {
        this.zukunft = Number(spalten) || 0
        this._klemmeZukunft()
        return this.zukunft
    }

    recalcNorm(ring, view, anchor, { sofort = false } = {}) {
        if (!ring || !ring.count || this.colorMode === 'fixed') return
        const head = anchor ?? ring.head
        const sample = []
        const maxCols = Math.min(this.histCols, ring.count)
        /*
         * Rotierender Versatz der Stichprobe.
         *
         * Abgetastet wird jede 7. Spalte und jeder 3. Bucket — bei festem
         * Startpunkt trifft das immer dasselbe Gitter. Wandert das Sichtfenster
         * um eine Zeile, liegt das Gitter plötzlich auf anderen Preisstufen,
         * und die Schätzung springt, obwohl sich am Markt nichts geändert hat.
         * Mit wechselndem Versatz sieht jede Runde andere Zellen; zusammen mit
         * der Glättung unten ergibt das ein stabiles Perzentil statt eines
         * zufällig herausgegriffenen.
         */
        const phase = (this._refPhase = (this._refPhase + 1) % 21)
        const pf = this.preisFaltung
        const rowsSample = Math.max(1, view.hi - view.lo)
        /*
         * Nur INNERHALB der Snapshot-Reichweite messen.
         *
         * Draussen liefert der Diff-Strom eine verzerrte Stichprobe: dort steht
         * nur, was sich seit dem Sync bewegt hat — viele leere Zeilen, dazwischen
         * einzelne, oft grosse Level. Die in den Median zu mischen zog ihn nach
         * unten, und der vollständig erfasste Kern lief dadurch einheitlich warm
         * an, statt sich innerlich zu gliedern. Der erfasste Bereich ist die
         * einzige unverzerrte Stichprobe, die es gibt; alles andere wird an
         * demselben Massstab gemessen, was genau richtig ist.
         */
        const cov = this.coverage
        const bs0 = ring.bucketSize
        let yVon = 0
        let yBis = rowsSample
        if (cov && cov.lo > 0 && cov.hi > 0) {
            const a = view.hi - 1 - Math.round(cov.hi / bs0)
            const b = view.hi - 1 - Math.round(cov.lo / bs0)
            const v = Math.max(0, Math.min(rowsSample, a))
            const w = Math.max(0, Math.min(rowsSample, b + 1))
            // Nur übernehmen, wenn davon überhaupt etwas im Bild liegt
            if (w - v >= pf * 4) { yVon = v; yBis = w }
        }
        for (let x = phase % 7; x < maxCols; x += 7) {
            const col = ring.colFrom(head, x)
            // Leere Spalten (kein oder gekreuztes Buch) tragen nichts bei und
            // würden die Stichprobe nur verkleinern.
            if (!ring.hatBuch(col)) continue
            /*
             * Gruppenweise abtasten, exakt wie gezeichnet wird. Der Bezugswert
             * ist ein Median ÜBER DAS, WAS IM BILD STEHT — würde hier die
             * ungefaltete Einzelzeile gemessen, wäre er bei Preisfaltung 4
             * grob viermal zu klein und das ganze Bild liefe rot an.
             */
            for (let g = phase % 3; yVon + g * pf < yBis; g += 3) {
                const y0 = yVon + g * pf
                const y1 = y0 + pf < yBis ? y0 + pf : yBis
                let v = 0
                for (let y = y0; y < y1; y++) v += ring.valueAt(col, view.hi - 1 - y)
                if (v > 0) sample.push(v)
            }
        }
        if (!sample.length) return
        sample.sort((a, b) => a - b)
        const hart = sofort || !this.refGesetzt

        const neu = Math.max(sample[Math.floor(sample.length * BEZUG_PERZENTIL)] || 0, 1e-9)
        if (hart) this.ref = neu
        else this.ref += (neu - this.ref) * REF_GLAETTUNG
        this.refGesetzt = true
    }

    /**
     * Menge → Stufe 0..255 auf der Farbrampe.
     *
     * Ein Verhältnismassstab: gleiches Mengenverhältnis ergibt überall
     * denselben Farbabstand. Das ist der Grund, warum die Karte ruhig bleibt —
     * 10 % Mengenunterschied sind rund 2 % der Rampe, egal an welcher Stelle.
     * Eine Rangabbildung hatte an derselben Stelle 7 %, und genau das sah man.
     */
    _stufe(v) {
        const t = Math.log1p(v / this.ref) * this.invLogMax
        return t >= 1 ? 255 : (t * 255) | 0
    }

    /**
     * @param {HeatmapRing} ring
     * @param {{lo:number,hi:number}} view
     * @param {number} [anchor]       Anker der HISTORIE (eingefrorene Ansicht)
     * @param {number} [jetztAnchor]  Anker des freien Felds (immer das jüngste Buch)
     * @param {object} [opts]
     * @param {number} [opts.frameMs]   Takt einer Spalte — bestimmt die Mittelungsbreite
     * @param {{lo:number,hi:number}} [opts.coverage]  Reichweite des letzten Snapshots
     */
    drawHeat(ring, view, anchor, jetztAnchor, opts = {}) {
        const ctx = this.heatCtx
        ctx.clearRect(0, 0, this.cssW, this.cssH)
        if (!ring || !ring.count) return
        const head = anchor ?? ring.head

        const rowsView = Math.max(1, view.hi - view.lo)
        this._ensureOffscreen(rowsView)
        const buf = this.buf32
        buf.fill(0)

        const lut = this.lut
        // Die Schwelle wird gegen die 256er-Rampe geprüft, nicht gegen ein t —
        // beide Skalen ('auto' und 'fixed') enden dort, also gilt sie für beide.
        const thr255 = this.threshold * 255
        const histCols = this.histCols
        const achse = this._achse(ring, head, opts.frameMs)
        const acc = this._spaltenBuf
        const pf = this.preisFaltung
        // Für recalcNorm mitschreiben — die Skala soll sich an den
        // vollständig erfassten Zeilen ausrichten, nicht am Fernfeld.
        this.coverage = opts.coverage || null

        /*
         * Zeilengrenzen der Snapshot-Reichweite.
         *
         * `y` läuft von oben (hoher Preis) nach unten, also gehört der HÖCHSTE
         * erfasste Preis zum KLEINSTEN y. Vertauscht sieht das Ergebnis
         * plausibel aus und markiert genau die falsche Hälfte.
         */
        const cov = opts.coverage
        const bsRing = ring.bucketSize
        const yCovHi = cov && cov.hi > 0 ? (view.hi - 1 - Math.round(cov.hi / bsRing)) : -Infinity
        const yCovLo = cov && cov.lo > 0 ? (view.hi - 1 - Math.round(cov.lo / bsRing)) : Infinity
        const unvollstaendig = (y) => y < yCovHi || y > yCovLo

        /*
         * Grundfarbe: eine leere Zelle bekommt den untersten Rampenton, nicht
         * „nichts".
         *
         * Bis zum 07.09.2026 blieben leere Zellen transparent, und weil die
         * Seite schwarz ist, stand jede gezeichnete Zelle einzeln vor dem
         * Nichts — das las sich als Rauschen, nicht als Karte. Die Vorlage hat
         * dort ein durchgehendes blaues Feld, und das ist auch die ehrlichere
         * Aussage: eine Preisstufe ohne ruhende Order trägt sehr wenig
         * Liquidität, und genau das heisst der unterste Rampenton.
         *
         * Links von `ersterPx` wird NICHT gefüllt: dort gibt es keine
         * Aufzeichnung, und „sehr wenig" wäre dann eine Behauptung über
         * Zeit, die nie erfasst wurde.
         */
        const grund = lut[0]
        for (let y = 0; y < rowsView; y++) {
            const zeile = y * this.cols
            for (let px = achse.ersterPx; px < this.cols; px++) buf[zeile + px] = grund
        }

        /*
         * Zwei Faltungen, nacheinander: erst über die ZEIT (mehrere Ringspalten
         * in ein Pixel, gemittelt), dann über den PREIS (mehrere Ringzeilen in
         * eine Bildzeile, summiert).
         *
         * Der Unterschied zwischen Mittel und Summe ist keine Geschmacksfrage.
         * Über die Zeit gesehen ist dieselbe Wand in zehn Takten zehnmal
         * DIESELBE Order — mitteln. Über den Preis gesehen sind zwei Stufen
         * zwei VERSCHIEDENE Orders — summieren, genau wie es ein gröberer
         * Bucket im Ring täte.
         *
         * Zeitlich wird über den PREIS gesammelt, nicht über die Zeile: `base`
         * wandert von Spalte zu Spalte mit dem Kurs, und wer stur dieselbe
         * Zeile mittelt, verschmiert eine Wand über das halbe Band. Dieselbe
         * Falle wie in `sliceRange` der Wiedergabe.
         */
        for (let px = achse.ersterPx; px < histCols; px++) {
            const jung = achse.jung[px]
            if (jung < 0) continue
            const alt = achse.alt[px]

            acc.fill(0)
            let anzahl = 0
            for (let i = jung; i <= alt; i++) {
                const col = ring.colFrom(head, i)
                const base = ring.base[col]
                const offset = col * ring.rows
                for (let y = 0; y < rowsView; y++) {
                    const r = (view.hi - 1 - y) - base
                    if (r < 0 || r >= ring.rows) continue
                    acc[y] += ring.data[offset + r]
                }
                anzahl++
            }
            if (!anzahl) continue
            const inv = 1 / anzahl

            for (let y0 = 0; y0 < rowsView; y0 += pf) {
                const y1 = y0 + pf < rowsView ? y0 + pf : rowsView
                let v = 0
                for (let y = y0; y < y1; y++) v += acc[y]
                if (v <= 0) continue
                const stufe = this._stufe(v * inv)
                if (stufe < thr255) continue     // schwache Liquidität ausblenden
                /*
                 * Auch in der HISTORIE zurücknehmen, nicht nur im freien Feld.
                 *
                 * Ausserhalb der Reichweite kennt das Buch nur, was sich seit
                 * dem Sync geändert hat — ein einzelnes zugeliefertes Level
                 * stand dort bisher so kräftig da wie eine vollständig erfasste
                 * Wand. Im Vergleich mit der Vorlage war das der auffälligste
                 * Rest: dort ist das Fernfeld ein ruhiges blaues Feld, bei uns
                 * leuchteten einzelne Linien quer durchs Bild.
                 *
                 * Die Reichweite gilt rückwirkend fürs ganze Bild, weil sie
                 * sich nur bei einem Resync ändert — innerhalb der 30 Minuten
                 * Ring ist das normalerweise dieselbe.
                 */
                const farbe = unvollstaendig(y0)
                    ? mische(lut[stufe], grund, UNVOLLSTAENDIG_ANTEIL)
                    : lut[stufe]
                for (let y = y0; y < y1; y++) buf[y * this.cols + px] = farbe
            }
        }

        /*
         * Das freie Feld rechts: der AKTUELLE Buchzustand, über die ganze
         * Breite wiederholt. So werden aus Punkten waagerechte Linien — man
         * sieht, wo die Wände liegen, statt sie aus der verschmierten
         * Historie herauslesen zu müssen.
         *
         * Genommen wird `jetztAnchor`, NICHT `anchor`: Blättert man in der
         * Historie zurück, soll rechts weiter das jüngste bekannte Buch
         * stehen. Sonst hätte man eine zweite Historie neben der Historie,
         * und die Linien beantworteten die Frage nicht mehr, für die sie da
         * sind („wo liegt jetzt Widerstand").
         */
        if (this.zukunft > 0) {
            const jetzt = jetztAnchor ?? head
            const frameMs = opts.frameMs > 0 ? opts.frameMs : 500
            /*
             * Über mehrere Takte mitteln statt einen einzigen zu zeigen.
             *
             * Ein Takt ist 500 ms Buchzustand, hier auf ein Drittel der Fläche
             * aufgeblasen. Ungemittelt wird daraus ein Stroboskop: jede Order,
             * die kurz liegt und wieder verschwindet, schlägt als volle Linie
             * durch. Gemittelt bleibt eine Wand, die wirklich liegt, hell —
             * und eine, die zuckt, wird blass. Genau das soll man sehen.
             */
            const fenster = Math.max(1, Math.round(JETZT_FENSTER_MS / frameMs))
            const acc = this._jetztBuf
            acc.fill(0)
            let genommen = 0
            /*
             * Leere Spalten überspringen statt mitzuzählen. Bei gekreuztem oder
             * noch nicht synchronisiertem Buch schreibt der Ring eine Spalte
             * ohne Daten — die als Null mitzumitteln (oder, schlimmer, als
             * einzige Quelle zu nehmen) liess das ganze Feld für einen Takt
             * schwarz werden.
             */
            const rueckblick = Math.min(ring.count, fenster * JETZT_RUECKBLICK)
            for (let i = 0; i < rueckblick && genommen < fenster; i++) {
                const col = ring.colFrom(jetzt, i)
                if (!ring.hatBuch(col)) continue
                const base = ring.base[col]
                const offset = col * ring.rows
                for (let y = 0; y < rowsView; y++) {
                    const r = (view.hi - 1 - y) - base
                    if (r < 0 || r >= ring.rows) continue
                    acc[y] += ring.data[offset + r]
                }
                genommen++
            }

            if (genommen > 0) {
                const inv = 1 / genommen
                // Dieselbe Preisfaltung wie in der Historie — sonst stünden
                // links Zonen und rechts Striche, und beide meinten dasselbe.
                for (let y0 = 0; y0 < rowsView; y0 += pf) {
                    const y1 = y0 + pf < rowsView ? y0 + pf : rowsView
                    let v = 0
                    for (let y = y0; y < y1; y++) v += acc[y]
                    if (v <= 0) continue
                    const stufe = this._stufe(v * inv)
                    if (stufe < thr255) continue
                    const farbe = unvollstaendig(y0)
                        ? mische(lut[stufe], grund, UNVOLLSTAENDIG_ANTEIL)
                        : lut[stufe]
                    for (let y = y0; y < y1; y++) {
                        const zeile = y * this.cols
                        for (let px = histCols; px < this.cols; px++) buf[zeile + px] = farbe
                    }
                }
            }
        }

        this.offCtx.putImageData(this.img, 0, 0)
        ctx.imageSmoothingEnabled = false   // harte Zellkanten statt Weichzeichner
        ctx.drawImage(this.off, 0, 0, this.cols, rowsView, 0, 0, this.plotW, this.plotH)
    }

    /**
     * @param {object} p
     * @param {HeatmapRing} p.ring
     * @param {TradeRing} p.trades
     * @param {{lo:number,hi:number}} p.view
     * @param {number} p.frameMs
     * @param {number} p.bucketSize
     * @param {function} p.formatTime  (ms) => string
     * @param {boolean} [p.showProfile]
     */
    drawOverlay({ ring, trades, liquidations, view, frameMs, bucketSize, formatTime, showProfile, showLiquidations, coverage, anchor, buch }) {
        const ctx = this.overlayCtx
        ctx.clearRect(0, 0, this.cssW, this.cssH)
        if (!ring || !ring.count) return

        const head = anchor ?? ring.head
        const rowsView = Math.max(1, view.hi - view.lo)
        const rowH = this.plotH / rowsView
        // Alles Gezeichnete bezieht sich auf die HISTORIE; das freie Feld
        // rechts gehört dem aktuellen Buch und bekommt weder Handelspunkte
        // noch Mid-Linie — dort ist keine Zeit vergangen.
        const histCols = this.histCols
        const achse = this._achse(ring, head, frameMs)
        // Zeit, die das ganze Bild abdeckt — vor der Faltung war das schlicht
        // die Spaltenzahl mal Takt.
        const spanneMs = histCols * achse.k * frameMs
        const tRight = ring.ts[ring.colFrom(head, 0)]
        // Rechte Zeitgrenze: bei eingefrorener Ansicht laufen die Trade-Puffer
        // weiter — Ereignisse NACH der letzten sichtbaren Spalte gehören nicht
        // ins Bild, sonst sammeln sie sich am rechten Rand einer Vergangenheit,
        // zu der sie nie gehörten. (+frameMs: die letzte Spalte deckt ihr
        // volles Zeitfenster ab.)
        const tMax = tRight + frameMs

        // Zelle für Bucket b belegt [ (hi-1-b)*rowH , (hi-b)*rowH ) — die -0.5
        // trifft deren Mitte, sonst läge die Mid-Linie eine halbe Zelle daneben.
        const yFor = (price) => (view.hi - price / bucketSize - 0.5) * rowH

        /*
         * Pixelspalte für einen Zeitpunkt — über die ECHTEN Spaltenzeiten in
         * `achse.ts`, nicht linear aus tRight gerechnet.
         *
         * Die Zeitachse hinter dem Bild ist nicht gleichmässig: pausiert der
         * Feed (Tab im Hintergrund), werden für diese Zeit gar keine Spalten
         * geschrieben, und der Zeitstempel springt zwischen zwei benachbarten
         * Pixeln um Minuten. Eine lineare Umrechnung schob die Handelspunkte
         * dann um genau diese Differenz nach links, bei längerer Pause
         * komplett aus dem Bild — sichtbar als „Heatmap da, aber keine Blasen
         * mehr".
         */
        const xForTs = (ts) => {
            let lo = achse.ersterPx, hi = histCols - 1
            if (hi < lo) return -1
            while (lo < hi) {
                const mid = (lo + hi) >> 1
                if (achse.ts[mid] < ts) lo = mid + 1
                else hi = mid
            }
            /*
             * Gegenprobe: Gibt es für diesen Zeitpunkt überhaupt eine Spalte?
             *
             * Läuft die Seite im Hintergrund, drosselt der Browser die Timer;
             * der Feed schreibt dann KEINE Spalten (für die verpasste Zeit gibt
             * es kein Orderbuch), die Trades kommen über den Socket aber weiter
             * an. Beim Zurückschalten fand die Suche oben für alle diese Trades
             * dieselbe erste Spalte nach der Lücke — und stapelte Minuten an
             * Handel als eine Kette fetter Blasen auf EINE Pixelspalte. Das sah
             * aus wie ein einzelner Grossausbruch und war die gefährlichste
             * Sorte falsch: plausibel.
             *
             * Ein Zeitpunkt, für den keine Spalte existiert, hat auf dieser
             * Achse keinen Ort. Also wird er nicht gezeichnet; die Lücke ist
             * als Streifen markiert und sagt, dass dort Zeit fehlt. Das
             * Volumenprofil behält ihn — es fragt nach Preisen, nicht nach
             * Zeitpunkten, und lügt damit über nichts.
             *
             * Eine Spalte über den ältesten Beitrag hinaus wird mitgeprüft:
             * die Suche liefert „erste Spalte, die nicht VOR dem Trade liegt",
             * ein Trade im letzten Takt des linken Nachbarn landet also
             * regulär hier und ist keine Lücke.
             */
            const bis = Math.min(achse.alt[lo] + 1, ring.count - 1)
            for (let i = achse.jung[lo]; i <= bis; i++) {
                const t0 = ring.ts[ring.colFrom(head, i)]
                if (ts >= t0 && ts < t0 + frameMs) return lo
            }
            return -1
        }

        // Lücken (Tab war im Hintergrund) sichtbar machen. Bei Faltung gilt ein
        // Pixel nur dann als Lücke, wenn ALLE seine Spalten eine sind — sonst
        // streifte ein einzelner ausgelassener Takt neun Pixel durch.
        for (let px = achse.ersterPx; px < histCols; px++) {
            const jung = achse.jung[px]
            if (jung < 0) continue
            let alleLuecke = true
            for (let i = jung; i <= achse.alt[px]; i++) {
                if (!(ring.flags[ring.colFrom(head, i)] & FLAG_LUECKE)) { alleLuecke = false; break }
            }
            if (!alleLuecke) continue
            /*
             * Zwei Pixel und deutlich sichtbar. Eine Hintergrundpause von
             * Minuten hinterlässt genau EINE Spalte — bei einem Pixel mit 18 %
             * Deckkraft sah man davon nichts, und seit die Blasen dieser Zeit
             * nicht mehr gezeichnet werden, ist dieser Streifen der einzige
             * Hinweis darauf, dass dort Zeit fehlt.
             */
            ctx.fillStyle = COLORS.gap
            ctx.fillRect(px, 0, 2, this.plotH)
        }

        // Mid-Preis-Linie — je Pixel der Mid der JÜNGSTEN Spalte darin. Ein
        // Mittelwert wäre hier falsch: die Linie soll den Kursverlauf zeigen,
        // und ein gemittelter Preis stand nie im Buch.
        ctx.beginPath()
        ctx.strokeStyle = COLORS.midLine
        ctx.lineWidth = 1
        let started = false
        for (let px = achse.ersterPx; px < histCols; px++) {
            const jung = achse.jung[px]
            const mid = jung >= 0 ? ring.mid[ring.colFrom(head, jung)] : 0
            if (!mid) { started = false; continue }
            const py = yFor(mid)
            if (!started) { ctx.moveTo(px + 0.5, py); started = true }
            else ctx.lineTo(px + 0.5, py)
        }
        ctx.stroke()

        /*
         * Trades zu Punkten zusammenfassen — über BEIDE Achsen, in Pixeln.
         *
         * Einzelne Fills übereinander zu zeichnen ergäbe nur einen weissen
         * Schlauch; aggregiert entstehen unterscheidbare Punkte, deren Fläche
         * dem gehandelten Volumen entspricht.
         *
         * ⚠ Bis zum 07.09.2026 rasterte nur die ZEIT über `dotStep`, der Preis
         * dagegen auf den vollen Ring-Bucket (bei BTC 2 USD ≈ 5 px). Eine Zelle
         * war damit 43 px breit und 5 px hoch, während der Punkt darin bis zu
         * 32 px Radius bekam — der Regler machte die Blasen also nur fetter und
         * schob sie senkrecht ineinander, statt sie zusammenzufassen. Genau so
         * gemeldet: „macht einfach alle grösser".
         *
         * Jetzt ist die Zelle ein QUADRAT von `dotStep` Pixeln. Gerastert wird
         * in Bildschirmkoordinaten und nicht in Preisstufen, weil die Frage
         * eine der Darstellung ist: zwei Punkte, die sich überlappen, sind
         * einer zu viel — unabhängig davon, wie viele Ticks dazwischen liegen.
         *
         * Linke Grenze aus der ältesten sichtbaren Spalte statt linear
         * gerechnet — sonst würden nach einer Feed-Pause Trades verworfen,
         * deren Spalte noch im Bild steht.
         */
        const tLeft = achse.ts[achse.ersterPx] || (tRight - spanneMs)
        const dotStep = this.dotStep
        const cells = new Map()
        for (let i = 0; i < trades.count; i++) {
            const idx = trades.idxFromEnd(i)
            const ts = trades.ts[idx]
            if (ts >= tMax) continue      // neuer als die (ggf. eingefrorene) Ansicht
            if (ts < tLeft) break
            // Erst prüfen, dann rastern: Math.round(-1/11)*11 ergibt 0, ein
            // verworfener Trade landete sonst am linken Rand.
            const px = xForTs(ts)
            if (px < 0) continue
            const x = Math.round(px / dotStep) * dotStep
            const preis = trades.price[idx]
            const yZelle = Math.round(yFor(preis) / dotStep) * dotStep
            const key = x * 1e7 + yZelle
            let cell = cells.get(key)
            if (!cell) { cell = { x, buy: 0, sell: 0, pSumme: 0, menge: 0 }; cells.set(key, cell) }
            const q = trades.qty[idx]
            if (trades.buy[idx]) cell.buy += q
            else cell.sell += q
            // Gezeichnet wird am mengengewichteten Mittelpreis, nicht in der
            // Rastermitte: der Punkt soll dort sitzen, wo tatsächlich gehandelt
            // wurde, sonst rastet er sichtbar an einem Gitter ein, das es im
            // Markt nicht gibt.
            cell.pSumme += preis * q
            cell.menge += q
        }

        if (cells.size) {
            // Radius auf das 75. Perzentil der Zellsummen normieren, damit sich
            // die Punkte untereinander unterscheiden statt am Anschlag zu kleben.
            //
            // Weil die Normierung RELATIV ist, ändert stärkeres Zusammenfassen
            // für sich genommen gar nichts an der Grösse: alle Zellsummen wachsen
            // mit, der Bezugswert wächst mit, der Radius bleibt. Deshalb hängt
            // der Massstab am Raster — nur so macht der Schieber die Blasen auch
            // wirklich fetter und nicht bloss weiter auseinander.
            /*
             * Bezugsgrösse aus den EINZELNEN Geschäften, nicht aus den Zellen.
             *
             * Das ist der Kern: eine Zell-Normierung wächst mit dem Raster mit
             * (mehr Trades je Zelle → grössere Zellsummen → grösserer
             * Bezugswert → gleicher Radius), und dann fasst der Schieber zwar
             * zusammen, aber die Blasen bleiben gleich gross. Genau das war
             * die Beschwerde. Die Einzelgrössen ändern sich durch das Raster
             * NICHT — bezogen auf sie wird eine Blase, die vier Geschäfte
             * bündelt, auch doppelt so breit.
             *
             * Gemessen an 1000 echten aggTrades: von 11 auf 80 px Raster
             * wächst die typische Zellsumme um das 11,8-Fache, der Durchmesser
             * damit von 11 auf 38 px.
             *
             * p90 statt Mittelwert, weil Einzelgrössen extrem schief verteilt
             * sind (gemessen p50 = 0,002, max = 11,1 BTC) — der Mittelwert
             * hinge an einem einzigen Grossgeschäft.
             */
            const einzeln = []
            for (let i = 0; i < trades.count; i++) {
                const idx = trades.idxFromEnd(i)
                const ts = trades.ts[idx]
                if (ts >= tMax) continue
                if (ts < tLeft) break
                einzeln.push(trades.qty[idx])
            }
            einzeln.sort((a, b) => a - b)
            const ref = Math.max(einzeln[Math.floor(einzeln.length * 0.9)] || 0, 1e-9)
            /*
             * Fester Massstab in Pixeln: ein Geschäft der Bezugsgrösse ergibt
             * `SCALE` Radius, die Fläche wächst mit der Menge. Nichts hier
             * hängt am Raster — das Wachstum kommt allein daraus, dass eine
             * Zelle bei grösserem Raster mehr Geschäfte enthält.
             */
            const scale = 2.5
            // Obergrenze: eine Blase füllt höchstens ihre eigene Zelle, sonst
            // verdeckt sie Nachbarn, die es wirklich gibt. Bei kleinem Raster
            // bindet dieser Deckel fast immer — das ergibt die dichte Kette
            // feiner Punkte, bei grossem Raster die wenigen fetten.
            const cap = Math.max(4, dotStep * 0.5)
            // Deckend mit dunklem Rand statt additiv: beim Überblenden liefen
            // sich überlappende Blasen zu weissem Brei zusammen, und die Farbe
            // sagte nichts mehr über die Richtung. Grosse zuerst, damit kleine
            // Blasen nicht hinter grossen verschwinden.
            ctx.lineWidth = 1
            const sortiert = [...cells.values()].sort(
                (a, b) => (b.buy + b.sell) - (a.buy + a.sell))
            for (const cell of sortiert) {
                const total = cell.buy + cell.sell
                const y = yFor(cell.menge > 0 ? cell.pSumme / cell.menge : 0)
                if (y < -10 || y > this.plotH + 10) continue
                const r = Math.max(1.5, Math.min(cap, Math.sqrt(total / ref) * scale))
                const kauf = cell.buy >= cell.sell
                ctx.beginPath()
                ctx.arc(cell.x, y, r, 0, Math.PI * 2)
                ctx.fillStyle = kauf ? COLORS.buy : COLORS.sell
                ctx.fill()
                if (r >= 3) {
                    ctx.strokeStyle = kauf ? COLORS.buyEdge : COLORS.sellEdge
                    ctx.stroke()
                }
            }
        }

        if (this.buchW) this._drawBuch(ctx, buch, { view, bucketSize, rowH })
        if (coverage) this._drawCoverage(ctx, coverage, yFor)
        if (showLiquidations && liquidations) this._drawLiquidations(ctx, liquidations, { yFor, xForTs, tLeft, tMax })
        if (showProfile) this._drawVolumeProfile(ctx, trades, { yFor, tLeft, tMax })
        if (this.volumeH) this._drawVolumeBars(ctx, trades, { xForTs, tLeft, tMax, dotStep })
        if (this.deltaH) this._drawDelta(ctx, trades, { xForTs, tLeft, tMax })
        // Absorption ist ein lokales, kein Gesamtfenster-Phänomen — nur die
        // letzte Minute (oder das ganze Fenster, falls kürzer) zählt.
        if (this.absorptionOn) {
            this._drawAbsorption(ctx, ring, {
                view, bucketSize, yFor, trades,
                windowMs: Math.min(60000, spanneMs), tMax, head,
            })
        }
        this._drawLegend(ctx)

        this._drawAxes(ctx, { ring, view, bucketSize, rowH, achse, tRight, formatTime, head })
    }

    /**
     * Buch-Leiter rechts: ruhende Mengen je Preiszone, nach Seite getrennt.
     *
     * Das Gegenstück zu Bookmaps COB-Spalte. Drei Dinge, die die Karte selbst
     * nicht leisten kann:
     *   – ZAHLEN. Farbe sagt „viel", die Leiter sagt „83,1 BTC".
     *   – SEITE. In der Heatmap sind Gebot und Brief dieselbe Farbe, weil dort
     *     die Menge zählt; hier steht grün unter und rot über dem Mittelkurs.
     *   – JETZT. Die Karte zeigt Verlauf, die Leiter genau den Stand von eben.
     *
     * Gebinnt wird auf dieselben Preiszonen wie die Heatmap — sonst stünde
     * neben einer Zone eine Zahl, die zu einer anderen gehört.
     */
    _drawBuch(ctx, buch, { view, bucketSize, rowH }) {
        const x0 = this.buchX
        const w = this.buchW
        ctx.fillStyle = 'rgba(0,0,0,0.45)'
        ctx.fillRect(x0, 0, w, this.plotH)
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'
        ctx.beginPath()
        ctx.moveTo(x0 + 0.5, 0); ctx.lineTo(x0 + 0.5, this.plotH)
        ctx.stroke()

        this.buchZonen = null
        if (!buch || !buch.bids || !buch.asks) return

        const pf = this.preisFaltung
        const rowsView = Math.max(1, view.hi - view.lo)
        const zonen = Math.ceil(rowsView / pf)
        const bid = new Float64Array(zonen)
        const ask = new Float64Array(zonen)
        const einsortieren = (map, ziel) => {
            for (const [preis, menge] of map) {
                const y = view.hi - 1 - Math.round(preis / bucketSize)
                if (y < 0 || y >= rowsView) continue
                ziel[(y / pf) | 0] += menge
            }
        }
        einsortieren(buch.bids, bid)
        einsortieren(buch.asks, ask)

        /*
         * Fremde Börsen als eigener Balken dahinter, NICHT aufaddiert.
         *
         * Die Frage, die sie beantworten, ist „steht diese Wand nur hier?" —
         * und die verlangt zwei Zahlen, keine Summe. Zusammengezählt würden
         * sie die Wand ausserdem verschmieren, weil die Mittelkurse der Börsen
         * um mehrere Dollar auseinanderliegen (siehe server/fremdbuch.js).
         * Gebinnt wird auf ABSOLUTE Preise: eine Order bei 79180 liegt bei
         * 79180, gleich auf welcher Börse.
         */
        /*
         * Nur im gemeinsamen Bereich vergleichen (`fremdBereich`, gebildet in
         * LiquidityHeatmap.vue). Ausserhalb melden die fremden Börsen gar
         * nichts, und ein fehlender Balken hiesse dort „nicht erfasst", nicht
         * „nichts da". Der Anteil in der Kopfzeile rechnet aus demselben Grund
         * nur über diese Zonen.
         */
        const fb = buch.fremdBereich
        const fremd = buch.fremd && fb ? new Float64Array(zonen) : null
        let fbVon = 0
        let fbBis = zonen
        if (fremd) {
            fbVon = Math.max(0, Math.floor((view.hi - 1 - Math.round(fb.hi / bucketSize)) / pf))
            fbBis = Math.min(zonen, Math.ceil((view.hi - 1 - Math.round(fb.lo / bucketSize)) / pf) + 1)
            for (const boerse of buch.fremd) {
                einsortieren(boerse.bids, fremd)
                einsortieren(boerse.asks, fremd)
            }
        }

        /*
         * Massstab aus dem 90. Perzentil, nicht aus dem Maximum.
         *
         * Gemessen am laufenden Buch: Maximum 138,8 bei einem Median um 10 —
         * eine einzige Grossorder drückte damit ALLE anderen Balken auf ein bis
         * zwei Pixel, und die Leiter zeigte nur noch, dass irgendwo oben etwas
         * Grosses liegt. Das 90. Perzentil lässt die zehn Prozent grössten
         * anschlagen (sie sind ohnehin als „voll" erkennbar) und macht den Rest
         * vergleichbar. Der echte Höchstwert steht in der Überschrift.
         */
        const werte = []
        let max = 0
        for (let g = 0; g < zonen; g++) {
            // Massstab über BEIDE Balken, sonst schlüge der fremde ständig an
            const v = Math.max(bid[g] + ask[g], fremd ? fremd[g] : 0)
            if (v > 0) werte.push(v)
            if (v > max) max = v
        }
        if (!werte.length) return
        werte.sort((a, b) => a - b)
        const bezug = Math.max(werte[Math.floor(werte.length * 0.9)] || 0, 1e-9)
        this.buchZonen = { bid, ask, fremd, max, bezug, pf, rowH }

        /*
         * Überschrift, und zwar zwingend: seit die Leiter neben dem
         * Volumenprofil steht, sind das zwei schmale Balkenspuren, die sich
         * zum Verwechseln ähnlich sehen. Ohne Beschriftung sagt keine von
         * beiden, ob sie gehandeltes oder ruhendes Volumen zeigt — genau so
         * gemeldet am 07.09.2026.
         */
        ctx.font = '11px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        /*
         * Anteil im Kopf, sobald fremde Bücher da sind: die eigentliche
         * Auskunft ist nicht „so viel liegt bei Binance", sondern „so viel
         * davon liegt bei Binance". Ohne die Zahl liest man die blassen
         * Balken als Rauschen.
         */
        let anteil = ''
        if (fremd) {
            let eigen = 0
            let andere = 0
            for (let g = fbVon; g < fbBis; g++) { eigen += bid[g] + ask[g]; andere += fremd[g] }
            const gesamt = eigen + andere
            if (gesamt > 0) {
                // Die Bandbreite gehört dazu: ein Anteil ohne den Bereich, für
                // den er gilt, lädt dazu ein, ihn für das ganze Bild zu halten.
                const mid = (fb.lo + fb.hi) / 2
                const pct = (((fb.hi - fb.lo) / 2) / mid) * 100
                anteil = ` · ${this.labels.share} ${Math.round((eigen / gesamt) * 100)} % (±${pct.toFixed(2)} %)`
            }
        }
        const kopf = `${this.labels.book} · ${this.labels.max} ${formatQty(max)}${anteil}`
        // Plättchen dahinter: die Balken laufen sonst durch die Schrift
        const kopfB = ctx.measureText(kopf).width
        ctx.fillStyle = 'rgba(12,12,12,0.82)'
        ctx.fillRect(x0 + 1, 1, Math.min(w - 2, kopfB + 8), 15)
        ctx.fillStyle = 'rgba(255,255,255,0.62)'
        ctx.fillText(kopf, x0 + 4, 4)

        /*
         * Balken wachsen nach RECHTS zur Preisachse hin, die Zahl steht links.
         *
         * Das Volumenprofil daneben wächst andersherum. Zwei schmale
         * Balkenspuren nebeneinander sind sonst auch mit Beschriftung schwer
         * auseinanderzuhalten — gespiegelt sieht man den Unterschied, bevor man
         * die Überschrift gelesen hat. Und es entspricht der Vorlage, deren
         * COB-Balken ebenfalls an der Achse hängen.
         */
        const zoneH = rowH * pf
        /*
         * Zahlen nur, wenn sie lesbar sind UND etwas sagen.
         *
         * Bei engem Band ist eine Zone knapp neun Pixel hoch; vierzig
         * gestapelte Kleinstwerte sind dann Rauschen, kein Wert. Also nur die
         * Zonen beschriften, die auf der Skala überhaupt anschlagen — der Rest
         * steht im Tooltip.
         */
        const zahlen = zoneH >= 9
        const zahlAb = bezug * 0.25
        const balken = Math.max(10, zahlen ? w - 46 : w - 4)
        const rechts = x0 + w - 1
        ctx.font = '10px system-ui, sans-serif'
        ctx.textBaseline = 'middle'
        for (let g = 0; g < zonen; g++) {
            const gesamt = bid[g] + ask[g]
            if (gesamt <= 0) continue
            const y = g * zoneH
            if (y > this.plotH) break
            const h = Math.max(1, Math.min(zoneH - 1, zoneH * 0.82))
            const len = Math.max(1, Math.min(1, gesamt / bezug) * balken)
            // Seite aus dem Übergewicht: eine Zone kann beides enthalten, die
            // Frage ist, welche Seite sie trägt.
            const kauf = bid[g] >= ask[g]
            // Fremdbörsen zuerst und blass dahinter: der Überhang nach links
            // ist die Antwort auf „steht das auch anderswo".
            if (fremd && g >= fbVon && g < fbBis && fremd[g] > 0) {
                const lf = Math.max(1, Math.min(1, fremd[g] / bezug) * balken)
                ctx.fillStyle = 'rgba(255,255,255,0.20)'
                ctx.fillRect(rechts - lf, y + (zoneH - h) / 2, lf, h)
            }
            ctx.fillStyle = kauf ? 'rgba(38,190,150,0.75)' : 'rgba(255,95,86,0.75)'
            ctx.fillRect(rechts - len, y + (zoneH - h) / 2, len, h * (fremd ? 0.62 : 1))
            if (fremd && (g === fbVon || g === fbBis - 1)) {
                // Kante des Vergleichsbereichs — sonst liest man das Fehlen
                // blasser Balken darüber und darunter als „nichts da".
                ctx.fillStyle = 'rgba(255,193,7,0.55)'
                ctx.fillRect(x0 + 1, g === fbVon ? y : y + zoneH - 1, w - 2, 1)
            }
            if (zahlen && gesamt >= zahlAb) {
                ctx.fillStyle = 'rgba(255,255,255,0.82)'
                ctx.textAlign = 'left'
                ctx.fillText(formatQty(gesamt), x0 + 4, y + zoneH / 2)
            }
        }
    }

    /** Werte einer Zone der Buch-Leiter am Mauszeiger. */
    _drawBuchTooltip(ctx, x, y, { view, bucketSize, baseLabel }) {
        const b = this.buchZonen
        if (!b) return
        const zoneH = b.rowH * b.pf
        const g = Math.floor(y / zoneH)
        if (g < 0 || g >= b.bid.length) return
        const gebot = b.bid[g]
        const brief = b.ask[g]
        if (gebot + brief <= 0) return

        // Preisspanne der Zone — die Leiter zeigt eine Zone, keinen Preis
        const oben = (view.hi - 1 - g * b.pf) * bucketSize
        const unten = (view.hi - g * b.pf - b.pf) * bucketSize
        const dez = decimalsFor(bucketSize)
        const einheit = baseLabel ? ' ' + baseLabel : ''
        const lines = [
            `${unten.toFixed(dez)} – ${oben.toFixed(dez)}`,
            `${this.labels.bid} ${formatQty(gebot)}${einheit}`,
            `${this.labels.ask} ${formatQty(brief)}${einheit}`,
        ]
        if (b.fremd) lines.push(`${this.labels.otherVenues} ${formatQty(b.fremd[g])}${einheit}`)

        ctx.fillStyle = 'rgba(255,255,255,0.14)'
        ctx.fillRect(this.buchX, g * zoneH, this.buchW, zoneH)

        ctx.font = '12px system-ui, sans-serif'
        ctx.textBaseline = 'top'
        const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14
        const boxH = lines.length * 15 + 8
        const bx = Math.max(0, this.buchX - boxW - 6)
        const by = Math.min(Math.max(0, y - boxH / 2), this.plotH - boxH)
        ctx.fillStyle = COLORS.tooltipBg
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect(bx, by, boxW, boxH)
        ctx.strokeRect(bx + 0.5, by + 0.5, boxW, boxH)
        ctx.textAlign = 'left'
        lines.forEach((line, i) => {
            ctx.fillStyle = i === 1 ? COLORS.buy : (i === 2 ? COLORS.sell : 'rgba(255,255,255,0.87)')
            ctx.fillText(line, bx + 7, by + 5 + i * 15)
        })
    }

    /**
     * Markiert, wie weit der Orderbuch-Snapshot gereicht hat.
     *
     * Binance liefert höchstens 1000 Preisstufen je Seite; bei einem dichten
     * Buch sind das nur wenige Zehntel Prozent um den Mittelkurs. Ausserhalb
     * dieser Linien stammt alles ausschliesslich aus laufenden Änderungen —
     * echte Werte, aber unvollständig: Orders, die seit dem Sync unverändert
     * liegen, fehlen dort. Die Linien sagen also „ab hier dünner werdend".
     */
    _drawCoverage(ctx, coverage, yFor) {
        if (!coverage.lo || !coverage.hi) return
        ctx.save()
        /*
         * Bewusst anders als das Fadenkreuz.
         *
         * Beide waren weiss gestrichelt ([3,4] gegen [3,3]) und damit im Bild
         * nicht zu unterscheiden — gemeldet am 07.09.2026 als „da sind ja drei
         * Linien". Die dritte war der Mauszeiger. Bernstein und ein längerer
         * Strich sagen: das ist keine Messung im Bild, sondern eine Grenze der
         * Datenlage. Dieselbe Farbe markiert in der Legende die Ausblendschwelle.
         */
        ctx.setLineDash([8, 5])
        ctx.strokeStyle = 'rgba(255,193,7,0.45)'
        ctx.lineWidth = 1
        let beschriftet = false
        for (const preis of [coverage.hi, coverage.lo]) {
            const y = yFor(preis)
            if (y < 6 || y > this.plotH - 4) continue
            ctx.beginPath()
            ctx.moveTo(0, y + 0.5)
            ctx.lineTo(this.plotW, y + 0.5)
            ctx.stroke()
            if (beschriftet) continue

            // Die Beschriftung liegt über der Heatmap und war ohne Unterlage
            // je nach Untergrund kaum zu lesen — dunkles Plättchen dahinter.
            ctx.setLineDash([])
            ctx.font = '12px system-ui, sans-serif'
            ctx.textAlign = 'left'
            ctx.textBaseline = 'bottom'
            const text = this.labels.coverage
            const breite = ctx.measureText(text).width
            ctx.fillStyle = 'rgba(12,12,12,0.82)'
            ctx.fillRect(4, y - 16, breite + 10, 15)
            ctx.fillStyle = 'rgba(255,193,7,0.85)'
            ctx.fillText(text, 9, y - 3)
            ctx.setLineDash([8, 5])
            beschriftet = true
        }
        ctx.restore()
    }

    /**
     * Zwangsliquidationen als Rauten mit heller Kontur — bewusst anders geformt
     * als die runden Trade-Punkte, damit man sie auch in einem Cluster erkennt.
     * `buy` = eine Short-Position wurde liquidiert (Kauf schliesst sie).
     */
    _drawLiquidations(ctx, liquidations, { yFor, xForTs, tLeft, tMax }) {
        if (!liquidations.count) return
        const ref = liquidations.quantile(0.9) || 1
        for (let i = 0; i < liquidations.count; i++) {
            const idx = liquidations.idxFromEnd(i)
            const ts = liquidations.ts[idx]
            if (ts >= tMax) continue
            if (ts < tLeft) break
            const x = xForTs(ts)
            const y = yFor(liquidations.price[idx])
            if (x < 0 || y < -10 || y > this.plotH + 10) continue
            const r = Math.max(4, Math.min(16, Math.sqrt(liquidations.qty[idx] / ref) * 6))
            ctx.beginPath()
            ctx.moveTo(x, y - r)
            ctx.lineTo(x + r, y)
            ctx.lineTo(x, y + r)
            ctx.lineTo(x - r, y)
            ctx.closePath()
            // Short-Liquidation = Kaufdruck (grün), Long-Liquidation = Verkaufsdruck (rot)
            ctx.fillStyle = liquidations.buy[idx] ? 'rgba(38,166,154,0.75)' : 'rgba(255,105,96,0.75)'
            ctx.fill()
            ctx.strokeStyle = 'rgba(255,255,255,0.9)'
            ctx.lineWidth = 1
            ctx.stroke()
        }
    }

    /**
     * Umkehrung von `_stufe`: welche Menge landet auf Rampenposition `t` (0..1)?
     * Nur für die Legende — nichts im Zeichenpfad braucht sie.
     */
    _wertBeiStufe(t) {
        return this.ref * Math.expm1(t / this.invLogMax)
    }

    /**
     * Farbskala unten links: ohne sie sagt die Helligkeit nichts über die Menge.
     * Zeigt zusätzlich, wo die Ausblend-Schwelle liegt.
     */
    _drawLegend(ctx) {
        const w = 11
        const h = Math.min(110, this.plotH * 0.4)
        const x = 10
        const y = this.plotH - h - 26

        for (let i = 0; i < h; i++) {
            const t = 1 - i / (h - 1)
            const [r, g, b] = rampColor(RAMPS[this.rampName], t)
            ctx.fillStyle = t < this.threshold
                ? 'rgba(255,255,255,0.06)'          // ausgeblendeter Bereich
                : `rgb(${r | 0},${g | 0},${b | 0})`
            ctx.fillRect(x, y + i, w, 1)
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'
        ctx.lineWidth = 1
        ctx.strokeRect(x + 0.5, y + 0.5, w, h)

        ctx.font = '11px system-ui, sans-serif'
        ctx.fillStyle = COLORS.axisText
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        /*
         * Beschriftet wird die Rampe an drei Stellen mit den Mengen, die dort
         * tatsächlich landen — nicht mit einer Formel. In 'auto' sind das die
         * Quantile der sichtbaren Verteilung, in 'fixed' die Umkehrung der
         * Verhältnisskala. Vorher stand hier fest „Bezugswert × 4", was seit
         * der einstellbaren Sättigung (Vorgabe 2,5) schlicht falsch war.
         */
        ctx.fillText(formatQty(this._wertBeiStufe(1)), x + w + 4, y + 4)
        ctx.fillText(formatQty(this._wertBeiStufe(0.5)), x + w + 4, y + h / 2)
        ctx.fillText(formatQty(this._wertBeiStufe(0)), x + w + 4, y + h - 3)
        if (this.threshold > 0) {
            const ty = y + (1 - this.threshold) * h
            ctx.strokeStyle = '#ffc107'
            ctx.beginPath()
            ctx.moveTo(x - 3, ty + 0.5)
            ctx.lineTo(x + w + 2, ty + 0.5)
            ctx.stroke()
        }
    }

    _drawVolumeProfile(ctx, trades, { yFor, tLeft, tMax }) {
        if (!this.profileW) return
        const width = this.profileW - 8
        const x0 = this.plotW + 4
        const bins = 60

        // Eigener Hintergrund + Trennlinie, damit die Spur nicht als
        // Fortsetzung der Heatmap gelesen wird
        ctx.fillStyle = 'rgba(0,0,0,0.45)'
        ctx.fillRect(this.plotW, 0, this.profileW, this.plotH)
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'
        ctx.beginPath()
        ctx.moveTo(this.plotW + 0.5, 0)
        ctx.lineTo(this.plotW + 0.5, this.plotH)
        ctx.stroke()
        const buy = new Float64Array(bins)
        const sell = new Float64Array(bins)
        let max = 0
        for (let i = 0; i < trades.count; i++) {
            const idx = trades.idxFromEnd(i)
            if (trades.ts[idx] >= tMax) continue
            if (trades.ts[idx] < tLeft) break
            const y = yFor(trades.price[idx])
            if (y < 0 || y > this.plotH) continue
            const bin = Math.min(bins - 1, Math.floor((y / this.plotH) * bins))
            if (trades.buy[idx]) buy[bin] += trades.qty[idx]
            else sell[bin] += trades.qty[idx]
            max = Math.max(max, buy[bin], sell[bin])
        }
        if (!max) return
        const binH = this.plotH / bins

        // Bewusst KEINE Dauerbeschriftung: bei sechzig Zeilen überschreiben sich
        // die Zahlen gegenseitig, und ohne Einheit sagen sie ohnehin wenig. Die
        // Werte wandern in den Tooltip — dort ist Platz für Menge UND Gegenwert.
        this.profileBins = { buy, sell, bins, max }
        const balkenW = width

        for (let b = 0; b < bins; b++) {
            const y = b * binH
            if (buy[b] > 0) {
                ctx.fillStyle = COLORS.buy
                ctx.fillRect(x0, y + binH * 0.15, (buy[b] / max) * balkenW, binH * 0.35)
            }
            if (sell[b] > 0) {
                ctx.fillStyle = COLORS.sell
                ctx.fillRect(x0, y + binH * 0.55, (sell[b] / max) * balkenW, binH * 0.35)
            }
        }
        // Beschriftung, damit klar ist, dass hier gehandeltes Volumen steht —
        // nicht ruhende Liquidität wie in der Heatmap
        ctx.font = '11px system-ui, sans-serif'
        ctx.fillStyle = COLORS.axisText
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        // Auf die eigene Spur beschneiden: seit die Buch-Leiter danebensteht,
        // lief diese Zeile sonst in deren Überschrift hinein und beide waren
        // unlesbar.
        ctx.save()
        ctx.beginPath()
        ctx.rect(this.plotW, 0, this.profileW, 20)
        ctx.clip()
        ctx.fillText(`${this.labels.traded} · ${this.labels.max} ${formatQty(max)}`, this.plotW + 4, 4)
        ctx.restore()
    }

    _drawAxes(ctx, { ring, view, bucketSize, rowH, achse, tRight, formatTime, head }) {
        const decimals = decimalsFor(bucketSize)
        ctx.font = '12px system-ui, sans-serif'
        ctx.textBaseline = 'middle'

        // Preisachse rechts
        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.fillRect(this.axisX, 0, this.axisW, this.plotH)
        const targetLines = Math.max(2, Math.floor(this.plotH / 46))
        const step = Math.max(1, Math.round((view.hi - view.lo) / targetLines))
        ctx.textAlign = 'left'
        for (let abs = Math.ceil(view.lo / step) * step; abs < view.hi; abs += step) {
            const y = (view.hi - abs - 0.5) * rowH
            if (y < 8 || y > this.plotH - 4) continue
            ctx.strokeStyle = COLORS.grid
            ctx.beginPath()
            ctx.moveTo(0, y + 0.5)
            ctx.lineTo(this.plotW, y + 0.5)
            ctx.stroke()
            ctx.fillStyle = COLORS.axisText
            ctx.fillText((abs * bucketSize).toFixed(decimals), this.axisX + 5, y)
        }

        // aktueller Mid als Badge
        const mid = ring.mid[ring.colFrom(head, 0)]
        if (mid) {
            const y = (view.hi - mid / bucketSize - 0.5) * rowH
            if (y > 0 && y < this.plotH) {
                ctx.fillStyle = COLORS.accent
                ctx.fillRect(this.axisX, y - 8, this.axisW, 16)
                ctx.fillStyle = '#001018'
                ctx.fillText(mid.toFixed(decimals), this.axisX + 5, y)
            }
        }

        // Zeitachse unten
        ctx.fillStyle = COLORS.axisText
        ctx.textAlign = 'center'
        const labelEvery = Math.max(60, Math.floor(this.plotW / 8))
        for (let x = this.histCols - 1; x >= achse.ersterPx; x -= labelEvery) {
            // Zeitstempel des Pixels lesen statt linear hochrechnen — nach einer
            // Feed-Pause fehlen Spalten, die Achse würde sonst eine gleichmässige
            // Zeit vortäuschen, die es nie gab.
            const ts = achse.ts[x] || tRight
            ctx.fillText(formatTime(ts), x, this.plotH + this.volumeH + this.deltaH + AXIS_H / 2)
        }

        /*
         * Grenze zum freien Feld. Ohne sie liest man die Linien rechts als
         * Fortsetzung der Zeitachse, also als Messung einer Zukunft, die es
         * nicht gibt — die Achse behauptete sonst etwas, das nirgends steht.
         */
        if (this.zukunft > 0) {
            ctx.save()
            ctx.strokeStyle = 'rgba(255,255,255,0.35)'
            ctx.setLineDash([2, 3])
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(this.histCols + 0.5, 0)
            ctx.lineTo(this.histCols + 0.5, this.plotH)
            ctx.stroke()
            ctx.setLineDash([])
            ctx.fillStyle = 'rgba(255,255,255,0.55)'
            ctx.textAlign = 'left'
            ctx.font = '11px system-ui, sans-serif'
            ctx.fillText('Buch jetzt', this.histCols + 4, this.plotH + this.volumeH + this.deltaH + AXIS_H / 2)
            ctx.restore()
        }
    }

    /** Crosshair + Tooltip; `cursor` = {x, y} in CSS-Pixeln oder null. */
    drawUi(cursor, { ring, view, bucketSize, frameMs, formatTime, anchor, baseLabel }) {
        const ctx = this.uiCtx
        ctx.clearRect(0, 0, this.cssW, this.cssH)
        if (!cursor || !ring || !ring.count) return
        const { x, y } = cursor

        // Zeiger über den Volumen-Säulen: eigener Tooltip mit den Mengen dieses
        // Zeitabschnitts. Muss VOR der plotH-Prüfung stehen, die Spur liegt
        // unterhalb des Charts.
        if (this.volumeH && y > this.plotH && y <= this.plotH + this.volumeH
            && x >= 0 && x <= this.plotW) {
            this._drawVolumeTooltip(ctx, x, y, { ring, anchor, baseLabel, formatTime, frameMs })
            return
        }
        if (y < 0 || y > this.plotH) return

        const head = anchor ?? ring.head
        const rowsView = Math.max(1, view.hi - view.lo)
        const rowH = this.plotH / rowsView

        // Zeiger über der Spur „gehandelt": eigener Tooltip mit den Mengen
        // dieser Zeile. Das ersetzt die früheren Dauerzahlen — hier ist Platz
        // für Einheit und Gegenwert, statt nackter Ziffern im Balken.
        if (this.profileW && x > this.plotW && x <= this.plotW + this.profileW) {
            this._drawProfileTooltip(ctx, x, y, { ring, head, view, bucketSize, baseLabel })
            return
        }
        /*
         * Über der Buch-Leiter: eigener Tooltip mit Gebot, Brief und Summe.
         *
         * Nötig, weil die Zahlen im Bild nur passen, wenn eine Preiszone
         * mindestens neun Pixel hoch ist — bei engem Band und feinen Zonen ist
         * sie das nicht, und dann stünden dort nur namenlose Balken. In den
         * Karten-Tooltip zu fallen wäre falsch: dessen Menge kommt aus der
         * Heatmap-Spalte, nicht aus dem aktuellen Buch.
         */
        if (this.buchW && x > this.buchX && x <= this.buchX + this.buchW) {
            this._drawBuchTooltip(ctx, x, y, { view, bucketSize, baseLabel })
            return
        }
        if (x < 0 || x > this.plotW) return
        /*
         * Auf die gezeichnete Gruppe einrasten. Ohne das nennt der Tooltip die
         * Menge EINER Ringzeile, während darunter die Summe von `pf` Zeilen
         * gemalt ist — dieselbe Stelle, zwei verschiedene Zahlen.
         */
        const pf = this.preisFaltung
        const yRoh = Math.max(0, Math.min(rowsView - 1, Math.floor(y / rowH)))
        const y0 = Math.floor(yRoh / pf) * pf
        const y1 = y0 + pf < rowsView ? y0 + pf : rowsView
        const absBucket = view.hi - 1 - y0
        const price = absBucket * bucketSize
        const histCols = this.histCols
        /*
         * Im freien Feld rechts steht das aktuelle Buch, dort ist keine Zeit
         * vergangen — also wird von dort auch die JÜNGSTE Spalte gelesen
         * (colFromRight 0) statt eine negative, die es nicht gibt.
         */
        /*
         * ⚠ Stille Kopplung, benannt statt behoben (Audit 05.09.2026): Hier
         * wird aus `anchor` gelesen, gezeichnet wird das Feld aber aus
         * `jetztAnchor`. Beide sind heute identisch, WEIL die Zuglogik in
         * `LiquidityHeatmap.vue` `colOffset` und `zukunftCols` gegenseitig
         * ausschliesst — man kann nicht gleichzeitig zurückblättern und Platz
         * schaffen. Fällt diese Bedingung, zeigt der Tooltip im freien Feld
         * Zahlen aus einer anderen Spalte als das Bild darunter, ohne dass
         * etwas kaputtgeht: die Anzeige wird still falsch.
         */
        const imFeld = x >= histCols
        const achse = this._achse(ring, head, frameMs)
        const px = Math.max(0, Math.min(histCols - 1, Math.round(x)))
        // Links des aufgezeichneten Bereichs gibt es schlicht nichts. Den Index
        // dorthin zu klemmen zeigte die Werte der ältesten Spalte — also Zahlen,
        // die zu einem ganz anderen Zeitpunkt gehören.
        const colFromRight = imFeld ? 0 : achse.jung[px]
        const hasData = colFromRight >= 0
        const col = hasData ? ring.colFrom(head, colFromRight) : -1
        let qty = 0
        if (hasData) for (let yy = y0; yy < y1; yy++) qty += ring.valueAt(col, view.hi - 1 - yy)
        const mid = hasData ? (ring.mid[col] || 0) : 0
        const decimals = decimalsFor(bucketSize)

        ctx.setLineDash([3, 3])
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, y + 0.5); ctx.lineTo(this.plotW, y + 0.5)
        ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, this.plotH)
        ctx.stroke()
        ctx.setLineDash([])

        const lines = hasData
            ? [
                price.toFixed(decimals),
                `${this.labels.liquidity} ${qty ? formatQty(qty) : '—'}`,
                mid ? `${(((price - mid) / mid) * 100).toFixed(2)} ${this.labels.toMid}` : '',
                formatTime(ring.ts[col]),
            ].filter(Boolean)
            : [price.toFixed(decimals), this.labels.noRecording]

        ctx.font = '12px system-ui, sans-serif'
        const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14
        const boxH = lines.length * 15 + 8
        const bx = Math.min(x + 12, this.plotW - boxW)
        const by = Math.min(y + 12, this.plotH - boxH)
        ctx.fillStyle = COLORS.tooltipBg
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect(bx, by, boxW, boxH)
        ctx.strokeRect(bx + 0.5, by + 0.5, boxW, boxH)
        ctx.fillStyle = 'rgba(255,255,255,0.87)'
        ctx.textAlign = 'left'
        lines.forEach((line, i) => ctx.fillText(line, bx + 7, by + 11 + i * 13))
    }

    /**
     * Volumen je Zeitabschnitt als Säulen unter dem Chart. Die Farbe folgt der
     * Seite mit dem Übergewicht: grün = Käufer waren die Aggressoren, rot =
     * Verkäufer. Der Umschlag von grün auf rot ist genau das, was man in
     * Bookmap als Wechsel der Initiative liest.
     */
    _drawVolumeBars(ctx, trades, { xForTs, tLeft, tMax, dotStep }) {
        const y0 = this.plotH
        const h = this.volumeH

        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.fillRect(0, y0, this.plotW, h)
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'
        ctx.beginPath()
        ctx.moveTo(0, y0 + 0.5); ctx.lineTo(this.plotW, y0 + 0.5)
        ctx.stroke()

        // Dieselbe Rasterbreite wie die Handelspunkte, damit Säule und Blase
        // denselben Zeitabschnitt meinen — sonst liest man sie gegeneinander.
        const step = Math.max(2, dotStep)
        const bins = new Map()
        let max = 0
        for (let i = 0; i < trades.count; i++) {
            const idx = trades.idxFromEnd(i)
            const ts = trades.ts[idx]
            if (ts >= tMax) continue
            if (ts < tLeft) break
            const px = xForTs(ts)
            if (px < 0) continue
            const x = Math.round(px / step) * step
            let bin = bins.get(x)
            if (!bin) bins.set(x, bin = { buy: 0, sell: 0 })
            if (trades.buy[idx]) bin.buy += trades.qty[idx]
            else bin.sell += trades.qty[idx]
            max = Math.max(max, bin.buy + bin.sell)
        }
        if (!max) return
        this.volumeBins = { bins, max, step }

        const breite = Math.max(1, step - 1)
        for (const [x, bin] of bins) {
            const total = bin.buy + bin.sell
            const bh = Math.max(1, (total / max) * (h - 12))
            ctx.fillStyle = bin.buy >= bin.sell ? COLORS.buy : COLORS.sell
            ctx.fillRect(x - breite / 2, y0 + h - bh, breite, bh)
        }

        ctx.font = '11px system-ui, sans-serif'
        ctx.fillStyle = COLORS.axisText
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(`${this.labels.volumePer.replace('{n}', step)} · ${this.labels.max} ${formatQty(max)}`, 4, y0 + 3)
    }

    /**
     * Cumulative Volume Delta: laufende Summe aus Kauf- minus Verkaufsmenge
     * über die sichtbare Breite. Pro Bildschirmspalte einzeln aufsummiert
     * (feiner als das dotStep-Raster der Blasen) — die Linie soll auf jede
     * einzelne Ausführung reagieren, nicht erst auf ein gebündeltes Fenster.
     */
    _drawDelta(ctx, trades, { xForTs, tLeft, tMax }) {
        const y0 = this.plotH + this.volumeH
        const h = this.deltaH

        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.fillRect(0, y0, this.plotW, h)
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'
        ctx.beginPath()
        ctx.moveTo(0, y0 + 0.5); ctx.lineTo(this.plotW, y0 + 0.5)
        ctx.stroke()

        const perCol = new Float64Array(this.plotW)
        for (let i = 0; i < trades.count; i++) {
            const idx = trades.idxFromEnd(i)
            const ts = trades.ts[idx]
            if (ts >= tMax) continue
            if (ts < tLeft) break
            const roh = xForTs(ts)
            if (roh < 0) continue   // Zeitpunkt ohne Spalte (siehe xForTs)
            const x = Math.min(this.plotW - 1, Math.max(0, Math.round(roh)))
            perCol[x] += trades.buy[idx] ? trades.qty[idx] : -trades.qty[idx]
        }
        const cum = new Float64Array(this.plotW)
        let running = 0
        let min = 0, max = 0
        for (let x = 0; x < this.plotW; x++) {
            running += perCol[x]
            cum[x] = running
            if (running < min) min = running
            if (running > max) max = running
        }
        const span = Math.max(max - min, 1e-9)
        const yFor = (v) => y0 + h - ((v - min) / span) * (h - 6) - 3

        // Nulllinie gehört zum Panel-Rahmen und läuft bewusst über die volle
        // Breite — anders als der Verlauf darunter, der an `histCols` endet.
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.beginPath()
        ctx.moveTo(0, yFor(0) + 0.5); ctx.lineTo(this.plotW, yFor(0) + 0.5)
        ctx.stroke()

        /*
         * Die Linie endet an `histCols`, nicht am Plotrand.
         *
         * Rechts davon liegt das freie Feld mit dem aktuellen Buch; dort ist
         * keine Zeit vergangen, und die Achse schreibt „Buch jetzt" darunter.
         * Bis zum Audit vom 05.09.2026 lief die Linie flach durch dieses Feld
         * hindurch und behauptete damit einen Verlauf, den es dort nicht gibt.
         *
         * Der Wert selbst war nie falsch: `perCol` wird über `xForTs` befüllt,
         * das seit dem Umbau höchstens `histCols - 1` liefert — die Zellen
         * dahinter sind immer null. Falsch war nur, sie zu zeichnen.
         */
        const bis = Math.min(this.plotW, this.histCols)
        ctx.beginPath()
        ctx.strokeStyle = running >= 0 ? COLORS.buy : COLORS.sell
        ctx.lineWidth = 1.5
        for (let x = 0; x < bis; x++) {
            const py = yFor(cum[x])
            if (x === 0) ctx.moveTo(x + 0.5, py)
            else ctx.lineTo(x + 0.5, py)
        }
        ctx.stroke()

        const sign = running < 0 ? '-' : '+'
        ctx.font = '11px system-ui, sans-serif'
        ctx.fillStyle = COLORS.axisText
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(`Δ ${sign}${formatQty(Math.abs(running))}`, 4, y0 + 3)
    }

    /**
     * Markiert Preisstufen, an denen im letzten kurzen Fenster deutlich mehr
     * gehandelt wurde als die Heatmap an ruhender Menge zeigt — ein Hinweis
     * auf eine versteckte grosse (Iceberg-)Order, die die Aufträge absorbiert.
     * Der Mindest-Bezug auf `this.ref` (statt einer festen Zahl) macht die
     * Schwelle automatisch symbolabhängig, ohne einen weiteren Regler zu
     * brauchen.
     */
    _drawAbsorption(ctx, ring, { view, bucketSize, yFor, trades, windowMs, tMax, head }) {
        const rowsView = view.hi - view.lo
        if (rowsView <= 0 || rowsView > 4000) return
        const traded = new Float64Array(rowsView)
        const tFrom = tMax - windowMs
        for (let i = 0; i < trades.count; i++) {
            const idx = trades.idxFromEnd(i)
            const ts = trades.ts[idx]
            if (ts >= tMax) continue
            if (ts < tFrom) break
            const bucket = Math.round(trades.price[idx] / bucketSize)
            const row = bucket - view.lo
            if (row < 0 || row >= rowsView) continue
            traded[row] += trades.qty[idx]
        }

        const newestCol = ring.colFrom(head, 0)
        const minRuhend = this.ref * 0.15
        let beschriftet = false
        for (let row = 0; row < rowsView; row++) {
            const gehandelt = traded[row]
            if (!gehandelt) continue
            const bucket = view.lo + row
            const ruhend = ring.valueAt(newestCol, bucket)
            if (ruhend < minRuhend) continue
            if (gehandelt < ABSORPTION_MULT * ruhend) continue
            const y = yFor(bucket * bucketSize)
            if (y < 4 || y > this.plotH - 4) continue

            ctx.save()
            ctx.setLineDash([2, 3])
            ctx.strokeStyle = 'rgba(255,193,7,0.85)'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.moveTo(0, y + 0.5); ctx.lineTo(this.plotW, y + 0.5)
            ctx.stroke()
            ctx.restore()

            if (!beschriftet) {
                ctx.font = '11px system-ui, sans-serif'
                ctx.fillStyle = 'rgba(255,193,7,0.95)'
                ctx.textAlign = 'right'
                ctx.textBaseline = 'bottom'
                ctx.fillText('Absorption', this.plotW - 4, y - 2)
                beschriftet = true   // nur einmal beschriften, sonst überladen bei mehreren Treffern
            }
        }
    }

    /** Tooltip für die Volumen-Säulen: Mengen und Übergewicht des Abschnitts. */
    _drawVolumeTooltip(ctx, x, y, { ring, anchor, baseLabel, formatTime, frameMs }) {
        const v = this.volumeBins
        if (!v) return
        const head = anchor ?? ring.head
        const bx = Math.round(x / v.step) * v.step
        const bin = v.bins.get(bx)
        if (!bin) return

        const kauf = bin.buy, verkauf = bin.sell, total = kauf + verkauf
        const mid = ring.mid[ring.colFrom(head, 0)] || 0
        const einheit = baseLabel || ''
        const wert = (q) => mid ? ` ≈ ${formatUsd(q * mid)}` : ''

        // Zeit dieses Abschnitts aus der Zeitachse lesen, nicht hochrechnen
        const achse = this._achse(ring, head, frameMs)
        const px = Math.max(0, Math.min(this.histCols - 1, Math.round(bx)))
        const ts = achse.ts[px] || 0

        // Säule hervorheben
        ctx.fillStyle = 'rgba(255,255,255,0.14)'
        ctx.fillRect(bx - v.step / 2, this.plotH, v.step, this.volumeH)

        const anteil = total ? Math.round((kauf / total) * 100) : 0
        const lines = [
            ts ? formatTime(ts) : '',
            `${this.labels.bought} ${formatQty(kauf)} ${einheit}${wert(kauf)}`,
            `${this.labels.sold} ${formatQty(verkauf)} ${einheit}${wert(verkauf)}`,
            `${this.labels.sum} ${formatQty(total)} ${einheit}${wert(total)}`,
            `${this.labels.buyerShare} ${anteil} %`,
        ].filter(Boolean)

        ctx.font = '12px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14
        const boxH = lines.length * 15 + 8
        // Über der Spur aufklappen — darunter ist die Zeitachse
        const tx = Math.max(4, Math.min(x + 12, this.plotW - boxW))
        const ty = Math.max(4, this.plotH - boxH - 4)
        ctx.fillStyle = COLORS.tooltipBg
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect(tx, ty, boxW, boxH)
        ctx.strokeRect(tx + 0.5, ty + 0.5, boxW, boxH)
        ctx.fillStyle = 'rgba(255,255,255,0.87)'
        lines.forEach((line, i) => ctx.fillText(line, tx + 7, ty + 15 + i * 13))
    }

    /** Tooltip für die Volumenprofil-Spur: Menge in Basiswährung + Gegenwert. */
    _drawProfileTooltip(ctx, x, y, { ring, head, view, bucketSize, baseLabel }) {
        const b = this.profileBins
        if (!b || !b.bins) return
        const bin = Math.min(b.bins - 1, Math.max(0, Math.floor((y / this.plotH) * b.bins)))
        const binH = this.plotH / b.bins
        const kauf = b.buy[bin] || 0
        const verkauf = b.sell[bin] || 0

        // Preisspanne dieser Zeile — eine Profilzeile deckt mehrere Preisstufen ab
        const rowsView = Math.max(1, view.hi - view.lo)
        const oben = (view.hi - (bin * binH / this.plotH) * rowsView) * bucketSize
        const unten = (view.hi - ((bin + 1) * binH / this.plotH) * rowsView) * bucketSize
        const decimals = decimalsFor(bucketSize)
        const mid = ring.mid[ring.colFrom(head, 0)] || 0
        const einheit = baseLabel || ''
        const wert = (q) => mid ? ` ≈ ${formatUsd(q * mid)}` : ''

        // Zeile hervorheben, damit klar ist, welcher Balken gemeint ist
        ctx.fillStyle = 'rgba(255,255,255,0.10)'
        ctx.fillRect(this.plotW, bin * binH, this.profileW, binH)

        const lines = [
            `${unten.toFixed(decimals)} – ${oben.toFixed(decimals)}`,
            `${this.labels.bought} ${formatQty(kauf)} ${einheit}${wert(kauf)}`,
            `${this.labels.sold} ${formatQty(verkauf)} ${einheit}${wert(verkauf)}`,
            `${this.labels.sum} ${formatQty(kauf + verkauf)} ${einheit}${wert(kauf + verkauf)}`,
        ]

        ctx.font = '12px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14
        const boxH = lines.length * 15 + 8
        // Nach links aufklappen — rechts ist die Preisachse im Weg
        const bx = Math.max(4, Math.min(x - boxW - 10, this.cssW - boxW - 4))
        const by = Math.min(Math.max(0, y - boxH / 2), this.plotH - boxH)
        ctx.fillStyle = COLORS.tooltipBg
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect(bx, by, boxW, boxH)
        ctx.strokeRect(bx + 0.5, by + 0.5, boxW, boxH)
        ctx.fillStyle = 'rgba(255,255,255,0.87)'
        lines.forEach((line, i) => ctx.fillText(line, bx + 7, by + 15 + i * 13))
    }
}

/** Gegenwert in USD, kurz gehalten — der Tooltip soll nicht zur Tabelle werden. */
function formatUsd(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(2) + ' Mio $'
    if (v >= 1e3) return Math.round(v / 1e3) + 'k $'
    return Math.round(v) + ' $'
}

function formatQty(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
    if (v >= 1e3) return (v / 1e3).toFixed(2) + 'k'
    return v.toFixed(v < 10 ? 3 : 1)
}
