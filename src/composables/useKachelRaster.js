/**
 * Kachelraster: laden, takten, verschieben, in der Grösse ziehen.
 *
 * Leitprinzip, das der Marktradar eingeführt hat und das hier festgeschrieben
 * ist: **die Seite holt, die Kachel zeichnet.** Dieses Composable ist die
 * „Seite" — es kennt Endpunkte, Zustände und Zeitpunkte, aber keine einzige
 * Kachel. Die Gross-Ansicht bekommt dieselben Daten gereicht, damit das
 * Aufklappen keine zweite Anfrage auslöst.
 *
 * Herausgezogen aus `Marktradar.vue`, weil das Live-Trading-Fenster dasselbe
 * Raster mit anderer Registry und anderem Takt braucht. Zwei Kopien wären an
 * genau den Stellen auseinandergelaufen, die hier am meisten Kommentar
 * brauchen — der Sortable-Block unten hat einen Richtungsfehler gekostet, den
 * niemand ein zweites Mal finden möchte.
 *
 * Die Sichtbarkeit/Reihenfolge/Grösse liegt weiterhin in `useHiddenCards`;
 * dieses Composable setzt darauf auf.
 *
 * @param {object}   opt
 * @param {string}   opt.storageKey    Basis für Sichtbarkeit/Reihenfolge/Grösse
 * @param {string}   opt.paramKey      localStorage-Schlüssel der Kachel-Parameter
 * @param {Array}    opt.kacheln       Registry der Seite
 * @param {Function} opt.sortiere      `sortiereKacheln` derselben Registry
 * @param {object}   [opt.symbolRef]   Ref auf das Symbol für `symbolAbhaengig`-Kacheln
 * @param {Function} [opt.zusatzParams] `(kachel) => object|null` — Abrufparameter,
 *   die nicht in der Registry stehen können, weil sie vom Zustand der Seite
 *   abhängen (z.B. der Zeitraum der laufenden Handelssitzung). Dasselbe Prinzip
 *   wie `symbolAbhaengig`, nur nicht auf ein einzelnes Feld festgelegt.
 * @param {number}   [opt.standardHoehe=270]
 * @param {number}   [opt.taktMs=30000] Prüfintervall; je Kachel entscheidet `intervallMs`
 * @param {number}   [opt.startVersatzMs=250] Versatz beim Erststart
 * @param {string[]} [opt.standardVersteckt=[]] beim Erststart ausgeblendete Ids
 *   (für Seiten mit grossem Katalog, die aufgeräumt starten — z.B. die Startseite)
 */

import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import axios from 'axios'
import Sortable from 'sortablejs'
import { useHiddenCards } from './useHiddenCards.js'

export function useKachelRaster({
    storageKey,
    paramKey,
    kacheln,
    sortiere,
    symbolRef = null,
    zusatzParams = null,
    standardHoehe = 270,
    taktMs = 30000,
    startVersatzMs = 250,
    standardVersteckt = [],
}) {
    const { hiddenCards, reihenfolge, groessen, toggleCard, isVisible, zeigeAlle,
        setzeReihenfolge, setzeGroesse } = useHiddenCards(storageKey, standardVersteckt)

    /*
     * Es gab hier eine Vorbelegung, die schwere Kacheln auf Telefonen vorab
     * ausblendete. Sie ist wieder heraus: das Live-Trading-Fenster ist inzwischen
     * ganz auf den Desktop beschränkt, damit war sie überflüssig — und sie hatte
     * eine unangenehme Eigenschaft. Beim Entwickeln in einem schmalen Fenster
     * (446 px beobachtet) schlug sie zu und schrieb einen dauerhaften Marker;
     * danach blieben Bookmap und Hebelkarte auch im maximierten Browser für
     * immer versteckt. Eine einmalige Messung darf keine Dauerentscheidung
     * treffen. Wenn wieder ein Bedarf entsteht, gehört das an die Seite (die
     * weiss, ob sie mobil taugt), nicht ins Raster.
     */

    /**
     * Zusatzparameter einzelner Kacheln (Zeiteinheit, Quelle …). Kommen aus den
     * Bedienelementen IN der Kachel und überleben das Neuladen — sonst müsste
     * man seine Zeiteinheit nach jedem Seitenwechsel neu einstellen.
     */
    const kachelParams = reactive((() => {
        try {
            const roh = JSON.parse(localStorage.getItem(paramKey) || 'null')
            return roh && typeof roh === 'object' && !Array.isArray(roh) ? roh : {}
        } catch {
            return {}
        }
    })())

    const daten = reactive({})     // id → Nutzlast
    const zustand = reactive({})   // id → 'idle'|'loading'|'ready'|'veraltet'|'error'
    const stand = reactive({})     // id → Zeitpunkt der angezeigten Daten (ms)
    const fehler = reactive({})    // id → Meldung

    const offeneKachel = ref(null)
    const showConfigDropdown = ref(false)
    const configRef = ref(null)
    const gridEl = ref(null)

    let timer = null
    let sortable = null
    const laufendeAnfrage = {}     // id → Zähler, damit alte Antworten nicht gewinnen
    /*
     * Wann WIR eine Kachel zuletzt gefragt haben — nicht zu verwechseln mit
     * `stand`, dem Datenstand des Servers. Die Fälligkeit muss an der eigenen
     * Empfangszeit hängen: liefert der Server einen Altstand (`veraltet:
     * true`), ist `stand` der ALTE Zeitstempel, die Kachel gilt sofort wieder
     * als fällig und der Client hämmert die gestörte Quelle im Prüftakt nach.
     */
    const abgefragt = {}
    const offeneAnfrage = {}       // id → true, solange eine Anfrage läuft

    const alleKacheln = computed(() => sortiere(reihenfolge.value))
    const sichtbareKacheln = computed(() => alleKacheln.value.filter(k => isVisible(k.id)))

    /** Zustandspunkt der Kopfzeile: der schlechteste aller sichtbaren Kacheln. */
    const gesamtZustand = computed(() => {
        const werte = sichtbareKacheln.value.map(k => zustand[k.id] || 'idle')
        for (const stufe of ['error', 'veraltet', 'loading', 'idle']) {
            if (werte.includes(stufe)) return stufe
        }
        return werte.length ? 'ready' : 'idle'
    })

    const offeneDefinition = computed(() =>
        alleKacheln.value.find(k => k.id === offeneKachel.value) || null)

    // ── Laden ───────────────────────────────────────────────────────────

    async function ladeKachel(id, erzwingen = false) {
        const kachel = alleKacheln.value.find(k => k.id === id)
        if (!kachel || !kachel.endpunkt) return

        const meine = (laufendeAnfrage[id] = (laufendeAnfrage[id] || 0) + 1)
        offeneAnfrage[id] = true
        abgefragt[id] = Date.now()
        zustand[id] = daten[id] ? zustand[id] : 'loading'
        try {
            const { data } = await axios.get(kachel.endpunkt, {
                params: {
                    ...(kachel.params || {}),
                    ...(kachel.symbolAbhaengig && symbolRef ? { symbol: symbolRef.value } : {}),
                    ...(zusatzParams?.(kachel) || {}),
                    ...(kachelParams[id] || {}),
                    ...(erzwingen ? { force: 1 } : {}),
                },
            })
            // Eine ältere Antwort darf eine neuere nicht überschreiben
            if (meine !== laufendeAnfrage[id]) return
            daten[id] = data
            stand[id] = data.stand || Date.now()
            fehler[id] = data.hinweis || ''
            zustand[id] = data.veraltet ? 'veraltet' : 'ready'
        } catch (e) {
            if (meine !== laufendeAnfrage[id]) return
            fehler[id] = e.response?.data?.error || e.message
            // Vorhandene Daten stehen lassen — ein Aussetzer soll die Kachel nicht leeren
            zustand[id] = daten[id] ? 'veraltet' : 'error'
        } finally {
            // Auch im Fehlerfall: der Versuch zählt, sonst wäre die Kachel
            // sofort wieder fällig und der Fehler würde im Prüftakt wiederholt.
            abgefragt[id] = Date.now()
            if (meine === laufendeAnfrage[id]) offeneAnfrage[id] = false
        }
    }

    function ladeFaellige(erzwingen = false) {
        if (document.hidden) return
        const jetzt = Date.now()
        for (const kachel of sichtbareKacheln.value) {
            // Läuft die Anfrage noch, nicht nachlegen: eine langsame Quelle
            // (bis 10 s) bekäme sonst im Prüftakt weitere Anfragen derselben
            // Kachel parallel obendrauf.
            if (offeneAnfrage[kachel.id] && !erzwingen) continue
            const alter = jetzt - (abgefragt[kachel.id] || 0)
            if (erzwingen || alter > kachel.intervallMs) ladeKachel(kachel.id, erzwingen)
        }
    }

    /*
     * Rückkehr auf den Reiter: sofort abgleichen. Der Takt pausiert bei
     * `document.hidden`, also stünden nach Stunden im Hintergrund bis zu einem
     * ganzen Prüftakt lang kommentarlos alte Zahlen auf dem Schirm.
     */
    function beiSichtbarkeit() {
        if (!document.hidden) ladeFaellige(false)
    }

    /** Kachel wird eingeblendet → sofort laden, sie hat noch nichts. */
    function beiUmschalten(id) {
        toggleCard(id)
        if (isVisible(id) && !daten[id]) ladeKachel(id)
    }

    /**
     * Anzeige-Einstellungen (Ansicht, Zeitfenster, Flächenmass): werden gemerkt,
     * lösen aber KEINEN neuen Abruf aus — sie ändern nur, wie vorhandene Daten
     * gezeichnet werden. Ein Abruf je Umschaltung würde die Fremdquellen ohne
     * Not belasten.
     */
    function setzeAnzeige(id, wert) {
        kachelParams[id] = { ...(kachelParams[id] || {}), ...wert }
        localStorage.setItem(paramKey, JSON.stringify(kachelParams))
    }

    function setzeParams(id, wert) {
        setzeAnzeige(id, wert)
        ladeKachel(id, true)
    }

    // ── Grösse ziehen ───────────────────────────────────────────────────
    // Sortable hängt am Griff oben links, der Grössen-Anfasser unten rechts hat
    // seine eigene Behandlung — dadurch beissen sich Verschieben und Vergrössern
    // weder mit der Maus noch am Finger.
    let griff = null

    /**
     * Grösse einer Kachel im Raster. Breite zählt in Rasterspalten, Höhe in
     * Pixeln — beides aus dem Ziehen am Eckanfasser, sonst die Vorgabe aus der
     * Registry.
     */
    function stilFuer(kachel) {
        const g = groessen[kachel.id] || {}
        const spalten = g.spalten || kachel.spalten || 1
        return {
            gridColumn: `span ${spalten}`,
            // Gezogene Grösse vor Registry-Vorgabe vor Rasterstandard — damit
            // eine Kachel (Bookmap) eine eigene Standardhöhe mitbringen kann.
            height: `${g.hoehe || kachel.hoehe || standardHoehe}px`,
        }
    }

    function starteGroesse(kachel, ev) {
        if (!gridEl.value) return
        const el = ev.target.closest('[data-kachel]')
        const stil = getComputedStyle(gridEl.value)
        const spaltenBreiten = stil.gridTemplateColumns.split(' ').map(parseFloat)
        const lueckeX = parseFloat(stil.columnGap) || 0
        const g = groessen[kachel.id] || {}

        griff = {
            id: kachel.id,
            x: ev.clientX, y: ev.clientY,
            spalten: g.spalten || kachel.spalten || 1,
            hoehe: el?.getBoundingClientRect().height || standardHoehe,
            maxSpalten: spaltenBreiten.length,
            // Untergrenze aus der Registry: eine Bookmap in einer Spalte ist
            // nicht klein, sondern unlesbar.
            minSpalten: Math.max(1, Math.min(spaltenBreiten.length, kachel.minSpalten || 1)),
            schritt: (spaltenBreiten[0] || 300) + lueckeX,
            el,
        }
        el?.querySelector('.radarCard')?.classList.add('wirdGezogen')
        gridEl.value.classList.add('imGriff')
        window.addEventListener('pointermove', beiGroesse)
        window.addEventListener('pointerup', endeGroesse)
        window.addEventListener('pointercancel', endeGroesse)
    }

    function beiGroesse(ev) {
        if (!griff) return
        const dx = ev.clientX - griff.x
        const dy = ev.clientY - griff.y
        const spalten = Math.max(griff.minSpalten, Math.min(griff.maxSpalten, griff.spalten + Math.round(dx / griff.schritt)))
        const hoehe = Math.max(180, Math.min(1000, Math.round(griff.hoehe + dy)))
        // Während des Ziehens nur im Speicher — geschrieben wird einmal am Ende
        setzeGroesse(griff.id, { spalten, hoehe }, false)
    }

    function endeGroesse() {
        if (griff) {
            setzeGroesse(griff.id, {}, true)
            griff.el?.querySelector('.radarCard')?.classList.remove('wirdGezogen')
        }
        gridEl.value?.classList.remove('imGriff')
        griff = null
        window.removeEventListener('pointermove', beiGroesse)
        window.removeEventListener('pointerup', endeGroesse)
        window.removeEventListener('pointercancel', endeGroesse)
    }

    /** Doppelklick auf den Anfasser: zurück auf die Vorgabe aus der Registry. */
    function setzeGroesseZurueck(kachel) {
        setzeGroesse(kachel.id, null, true)
    }

    function onClickOutside(e) {
        if (showConfigDropdown.value && configRef.value && !configRef.value.contains(e.target)) {
            showConfigDropdown.value = false
        }
    }

    // ── Umsortieren ─────────────────────────────────────────────────────

    /**
     * Sortable arbeitet direkt am DOM; wir lesen danach die Reihenfolge aus den
     * data-Attributen und lassen Vue neu zeichnen — die gespeicherte Liste
     * enthält bewusst ALLE Kacheln, auch ausgeblendete, damit sie beim
     * Einblenden wieder an ihrem Platz erscheinen.
     */
    function initSortable() {
        if (!gridEl.value) return
        sortable = Sortable.create(gridEl.value, {
            // Die ganze Kopfzeile zieht, nicht nur das Punkteraster: das war 14 × 14
            // Pixel gross und damit selbst mit der Maus kaum zu treffen, am Finger
            // gar nicht. Die Knöpfe darin bleiben Knöpfe (filter).
            handle: '.radarCardHead',
            filter: '.radarCardBtn, button, a',
            preventOnFilter: false,
            animation: 150,
            ghostClass: 'radarGhost',
            // Eigene Zieh-Simulation statt HTML5-Drag-and-drop: die native Variante
            // kennt keine Berührung, und ihr Ghost-Bild sieht in einem Raster mit
            // verschieden grossen Kacheln zerrissen aus.
            forceFallback: true,
            fallbackTolerance: 4,
            // Bei neun Kacheln ist die Seite gut 2400 px hoch — ohne mitlaufenden
            // Bildlauf kommt man von der obersten Reihe nie zur untersten. Der
            // Zusatz `forceAutoScrollFallback` ist Pflicht: ohne ihn bleibt das
            // Scrollen in der Ersatz-Zieh-Simulation wirkungslos.
            scroll: true,
            forceAutoScrollFallback: true,
            scrollSensitivity: 90,
            scrollSpeed: 18,
            bubbleScroll: true,
            onEnd: (evt) => {
                const { oldIndex, newIndex } = evt
                if (oldIndex === newIndex || oldIndex == null || newIndex == null) return

                // WICHTIG: Sortable hat die Knoten im DOM bereits verschoben, Vue
                // weiss davon nichts. Ohne Rücknahme patcht Vue beim nächsten
                // Rendern gegen einen DOM, den es nicht selbst gebaut hat — dann
                // springen Kacheln zurück oder erscheinen doppelt. Also: DOM
                // zurückdrehen, Reihenfolge in den Zustand schreiben, neu rendern
                // lassen. Der Zustand ist die Wahrheit, nicht das DOM.
                // Der Knoten steht jetzt an newIndex und muss zurück an oldIndex.
                // Die Bezugsposition unterscheidet sich je Richtung: nach UNTEN
                // verschoben liegt an oldIndex bereits der Nachrücker, nach OBEN
                // verschoben steht dort noch der alte Nachbar.
                //   runter (old < neu):  vor children[oldIndex] einfügen
                //   rauf   (old > neu):  vor children[oldIndex + 1] einfügen
                // Vertauscht man das, landet der Knoten eine Stelle daneben, Vue
                // rendert dagegen an — und die Kachel sprang zurück. Genau das war
                // der Grund, warum sich Kacheln nur nach OBEN verschieben liessen.
                const eltern = evt.from
                const knoten = evt.item
                const bezug = eltern.children[oldIndex + (oldIndex < newIndex ? 0 : 1)]
                eltern.insertBefore(knoten, bezug || null)

                const sichtbar = sichtbareKacheln.value.map(k => k.id)
                const [bewegt] = sichtbar.splice(oldIndex, 1)
                sichtbar.splice(newIndex, 0, bewegt)

                // Ausgeblendete Kacheln behalten ihren Platz am Ende, damit sie
                // beim Wiedereinblenden nicht wahllos irgendwo auftauchen
                const versteckt = alleKacheln.value.map(k => k.id).filter(id => !sichtbar.includes(id))
                setzeReihenfolge([...sichtbar, ...versteckt])
            },
        })
    }

    // ── Lebenszyklus ────────────────────────────────────────────────────

    onMounted(async () => {
        document.addEventListener('click', onClickOutside)
        document.addEventListener('visibilitychange', beiSichtbarkeit)
        // Kacheln ohne Endpunkt versorgen sich selbst. Ohne diese Zeile blieben
        // sie auf 'idle' stehen und zögen den Zustandspunkt der ganzen Seite
        // mit herunter, obwohl bei ihnen nichts fehlt.
        for (const kachel of kacheln) {
            if (!kachel.endpunkt) zustand[kachel.id] = 'ready'
        }
        await nextTick()
        initSortable()
        // Versetzt anfordern statt alle auf einmal: RSI und Altcoin-Saison holen
        // je fünfzig Kerzenreihen, und wenn zwölf Kacheln gleichzeitig loslegen,
        // drosselt Binance — mit halb leeren Kacheln als Ergebnis.
        for (const [i, kachel] of sichtbareKacheln.value.entries()) {
            setTimeout(() => ladeKachel(kachel.id), i * startVersatzMs)
        }
        timer = setInterval(() => ladeFaellige(false), taktMs)
    })

    onBeforeUnmount(() => {
        document.removeEventListener('click', onClickOutside)
        document.removeEventListener('visibilitychange', beiSichtbarkeit)
        endeGroesse()
        clearInterval(timer)
        sortable?.destroy()
        sortable = null
    })

    // Symbolwechsel im Seitenmenü: nur die Kacheln neu holen, die daran hängen
    if (symbolRef) {
        watch(symbolRef, () => {
            for (const kachel of sichtbareKacheln.value) {
                if (kachel.symbolAbhaengig) ladeKachel(kachel.id, true)
            }
        })
    }

    return {
        // Zustand
        gridEl, daten, zustand, stand, fehler, kachelParams,
        hiddenCards, groessen,
        alleKacheln, sichtbareKacheln, gesamtZustand,
        offeneKachel, offeneDefinition,
        showConfigDropdown, configRef,
        // Bedienung
        ladeKachel, ladeFaellige, beiUmschalten, isVisible, zeigeAlle,
        setzeParams, setzeAnzeige,
        stilFuer, starteGroesse, setzeGroesseZurueck,
    }
}
