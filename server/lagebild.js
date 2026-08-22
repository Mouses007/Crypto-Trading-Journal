/**
 * Lagebild — der reine Teil der KI-Kachel „Gesamtlage".
 *
 * Zwei Aufgaben, beide ohne Datenbank und ohne Netz, damit der Selbsttest sie
 * prüfen kann:
 *
 *   1. `baueZeilen` giesst die Nutzlasten der ANDEREN Radar-Kacheln in kurze
 *      Textzeilen. Das ist die einzige Grundlage, die die KI zu sehen bekommt —
 *      sie recherchiert nicht, sie liest ab.
 *   2. `normalisiereAntwort` bringt die Antwort auf eine feste Form. Ein Modell,
 *      das eine Stimmung erfindet oder zwölf Punkte schreibt, darf die Kachel
 *      nicht sprengen.
 *
 * ACHTUNG bei den Funding-Einheiten — hier ist schon einmal eine Zahl um den
 * Faktor 100 verrutscht: die Funding-Kachel liefert `jahresRate` als
 * DEZIMALBRUCH (0,073 = 7,3 %), die Marktmechanik-Kachel dagegen
 * `fundingJahresRate` bereits in PROZENT (7,3). Beide landen in derselben
 * Zusammenfassung, also wird jede an ihrer eigenen Stelle umgerechnet.
 */

/** Erlaubte Gesamtlagen. Alles andere fällt auf `gemischt` zurück. */
export const STIMMUNGEN = ['risiko_auf', 'risiko_ab', 'angespannt', 'gemischt', 'ruhig']

/** Erlaubter Ton eines Einzelpunkts — steuert im Frontend nur die Farbe. */
export const TOENE = ['gut', 'schlecht', 'neutral']

const nz = (v) => typeof v === 'number' && Number.isFinite(v)

/** Vorzeichenbehaftet, für Veränderungen. */
const pz = (v, k = 1) => (nz(v) ? `${v > 0 ? '+' : ''}${v.toFixed(k)} %` : 'n/a')

/** Ohne Vorzeichen, für Anteile und Stände. */
const proz = (v, k = 1) => (nz(v) ? `${v.toFixed(k)} %` : 'n/a')

const geld = (v) => {
    if (!nz(v)) return 'n/a'
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)} Mrd USD`
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)} Mio USD`
    return `${Math.round(v / 1000)}k USD`
}

const kurz = (s) => String(s || '').replace(/USDT$/, '')

const datum = (ms) => (nz(ms) ? new Date(ms).toISOString().slice(0, 10) : 'n/a')

/**
 * Zahlen der einzelnen Kacheln als Textzeilen.
 *
 * Jede Kachel steuert höchstens eine Zeile bei und darf fehlen — eine Quelle,
 * die gerade nicht erreichbar war, kostet eine Zeile, nicht die Einordnung.
 * Die Id bleibt an der Zeile hängen, damit das Frontend die Grundlage unter
 * den Namen der jeweiligen Kachel schreiben kann.
 *
 * @param {object} d Nutzlasten je Kachel-Id (jede einzelne darf null sein)
 * @returns {Array<{id: string, text: string}>}
 */
export function baueZeilen(d = {}) {
    const zeilen = []
    const dazu = (id, text) => { if (text) zeilen.push({ id, text }) }

    // ── Marktmechanik: das einzige fertige Urteil auf der Seite ──────────
    if (d.mechanik) {
        const f = d.mechanik.faktoren || {}
        const teile = [
            `Zustand ${d.mechanik.state}`,
            `Preis ${pz(f.preisDeltaPct, 2)}`,
            `Open Interest ${pz(f.oiDeltaPct, 2)}`,
            // schon in Prozent geliefert (siehe Kopfkommentar)
            `Funding ${pz(f.fundingJahresRate, 1)} p.a.`,
        ]
        if (f.liqVerfuegbar) {
            teile.push(`Liquidationen Longs ${geld(f.liqLongUsd)} / Shorts ${geld(f.liqShortUsd)}`
                + (nz(f.liqSpikeFaktor) ? `, Spike-Faktor ${f.liqSpikeFaktor}` : ''))
        }
        if (d.mechanik.gruende?.length) teile.push(`Gründe: ${d.mechanik.gruende.join(', ')}`)
        dazu('mechanik', `Marktmechanik ${kurz(d.mechanik.symbol)} (${d.mechanik.fenster}): ${teile.join('; ')}`)
    }

    // ── Stimmung ────────────────────────────────────────────────────────
    if (d.fng?.aktuell) {
        const a = d.fng.aktuell
        dazu('fng', `Fear & Greed: ${a.wert} (${a.klasse})`
            + (d.fng.gestern ? `, gestern ${d.fng.gestern.wert}` : '')
            + (nz(d.fng.mittel30) ? `, 30-Tage-Mittel ${d.fng.mittel30}` : ''))
    }

    // ── Dominanz ────────────────────────────────────────────────────────
    if (d.dom?.jetzt) {
        const j = d.dom.jetzt
        dazu('dom', `BTC-Dominanz: ${proz(j.pct, 2)}`
            + (nz(d.dom.delta7) ? ` (7 Tage ${d.dom.delta7 > 0 ? '+' : ''}${d.dom.delta7} Punkte)` : '')
            + (nz(d.dom.eth) ? `, ETH-Dominanz ${proz(d.dom.eth, 2)}` : '')
            + (nz(j.mcapUsd) ? `, Gesamtmarkt ${(j.mcapUsd / 1e12).toFixed(2)} Bio. USD` : ''))
    }

    // ── Funding ─────────────────────────────────────────────────────────
    if (d.funding) {
        /*
         * Einheit IMMER mitschreiben — sonst liest die KI (und jeder Leser
         * nach ihr) eine Jahresrate als Einzelzahlung. Beobachtet am
         * 21.08.2026: „ONG -950,4 % gegen Bybit -27,5 %" landete so im
         * Lagebericht, wurde nachgeprüft und als unmöglich verworfen — zu
         * Recht, denn je Zahlung deckelt Binance bei ±2 %. Die Zahl selbst
         * stimmte: -0,110 % je Stunde sind -963 % p.a.
         *
         * Deshalb steht an jeder Zahl „p.a." und daneben die Rate je Takt.
         */
        // Dezimalbruch → Prozent (siehe Kopfkommentar)
        const takt = (r) => (nz(r.rate) && nz(r.intervallStunden)
            ? ` (${pz(r.rate * 100, 3)} je ${r.intervallStunden} h)` : '')
        const fmt = (r) => `${kurz(r.symbol)} ${pz(nz(r.jahresRate) ? r.jahresRate * 100 : null, 1)} p.a.${takt(r)}`
        const teile = []
        if (d.funding.oben?.length) teile.push(`teuerste Longs: ${d.funding.oben.slice(0, 4).map(fmt).join(', ')}`)
        if (d.funding.unten?.length) teile.push(`teuerste Shorts: ${d.funding.unten.slice(0, 4).map(fmt).join(', ')}`)
        if (teile.length) dazu('funding', `Funding p.a. (Top ${d.funding.n ?? '?'}): ${teile.join('; ')}`)

        if (teile.length || d.funding.divergenzen?.length) {
            dazu('funding', 'Einheit: Funding-Zahlen sind JAHRESRATEN (aktuelle Rate hochgerechnet).'
                + ' Die Zahlung je Takt ist an der Börse gedeckelt (Binance in der Regel ±2 %),'
                + ' dreistellige Jahresraten sind daher normal und kein Datenfehler.')
        }

        if (d.funding.eigene?.length) {
            // Die eigene Börse nur nennen, wenn sie eine Zahl geliefert hat —
            // eine Liste aus einem Dutzend „n/a" liest sich, als wäre der
            // Markt kaputt, dabei fehlt nur der zweite Blickwinkel.
            dazu('funding', 'Eigene Märkte (Funding p.a. auf Binance): ' + d.funding.eigene.map(r =>
                `${kurz(r.symbol)} ${pz(nz(r.jahresRate) ? r.jahresRate * 100 : null, 1)}`
                + (nz(r.bitunix?.jahresRate) ? ` (Bitunix ${pz(r.bitunix.jahresRate * 100, 1)})` : '')).join(', '))
        }
        if (d.funding.divergenzen?.length) {
            dazu('funding', 'Börsen-Divergenz Binance vs. Bybit (Funding p.a.): ' + d.funding.divergenzen.slice(0, 3).map(r =>
                `${kurz(r.symbol)} ${pz(r.binance * 100, 1)} p.a. vs. ${pz(r.bybit * 100, 1)} p.a.${takt(r)}`).join('; '))
        }
    }

    // ── Long/Short + Open Interest ──────────────────────────────────────
    if (d.lsoi?.jetzt) {
        const j = d.lsoi.jetzt
        dazu('lsoi', `Long/Short ${kurz(d.lsoi.symbol)}: ${proz(j.longPct, 1)} der Konten long`
            + `, Open Interest 24 h ${pz(j.oiDelta24hPct, 1)}, Preis 24 h ${pz(j.preisDelta24hPct, 1)}`
            + (j.deutung ? `, Lesart ${j.deutung}` : ''))
    }

    // ── Liquidationen 24 h ──────────────────────────────────────────────
    if (d.liq24?.gesamt) {
        if (!d.liq24.aktiv) {
            dazu('liq24', 'Liquidationen 24 h: eigene Aufzeichnung ist ausgeschaltet — keine Aussage möglich')
        } else {
            const g = d.liq24.gesamt
            const top = (d.liq24.symbole || []).slice(0, 3)
                .map(s => `${kurz(s.symbol)} ${geld(s.longUsd + s.shortUsd)}`).join(', ')
            dazu('liq24', `Liquidationen ${d.liq24.stunden} h: Longs ${geld(g.longUsd)}, Shorts ${geld(g.shortUsd)}`
                + `, ${g.anzahl} Ereignisse` + (top ? `; am stärksten ${top}` : '')
                + ' (Stichprobe der eigenen Aufzeichnung, kein Marktganzes)')
        }
    }

    // ── RSI ─────────────────────────────────────────────────────────────
    if (d.rsi?.punkte?.length) {
        const heiss = d.rsi.punkte.filter(p => p.rsi >= 70).map(p => kurz(p.symbol))
        const kalt = d.rsi.punkte.filter(p => p.rsi <= 30).map(p => kurz(p.symbol))
        dazu('rsi', `RSI ${d.rsi.tf} über ${d.rsi.gezaehlt} Märkte: Schnitt ${d.rsi.schnitt ?? 'n/a'}`
            + `, über 70: ${heiss.length ? heiss.slice(0, 6).join(', ') : 'keiner'}`
            + `, unter 30: ${kalt.length ? kalt.slice(0, 6).join(', ') : 'keiner'}`)
    }

    // ── Marktbreite ─────────────────────────────────────────────────────
    if (d.markt?.muenzen?.length) {
        const m = d.markt.muenzen
        const mitWert = m.filter(c => nz(c.w24h))
        const plus = mitWert.filter(c => c.w24h > 0).length
        const sortiert = [...mitWert].sort((a, b) => b.w24h - a.w24h)
        const nenn = (c) => `${c.symbol} ${pz(c.w24h, 1)}`
        dazu('markt', `Marktbreite Top ${m.length}: ${plus} von ${mitWert.length} in 24 h im Plus`
            + `; vorn ${sortiert.slice(0, 3).map(nenn).join(', ')}`
            + `; hinten ${sortiert.slice(-3).reverse().map(nenn).join(', ')}`)
    }

    // ── Altcoin-Saison ──────────────────────────────────────────────────
    if (d.altseason && d.altseason.index !== null && d.altseason.index !== undefined) {
        dazu('altseason', `Altcoin-Season-Index (${d.altseason.fenster} T): ${d.altseason.index} (${d.altseason.lage})`
            + `, ${d.altseason.besser} von ${d.altseason.gezaehlt} Altcoins schlagen BTC, BTC selbst ${pz(d.altseason.btcWandel, 1)}`)
    }

    // ── Pi-Cycle ────────────────────────────────────────────────────────
    if (d.picycle?.jetzt) {
        dazu('picycle', `Pi-Cycle-Top: kurze Linie ${pz(d.picycle.jetzt.abstandPct, 1)} zur langen`
            + `, ${d.picycle.jetzt.ausgeloest ? 'AUSGELÖST' : 'nicht ausgelöst'}`
            + (d.picycle.letzteKreuzung ? `, letzte Kreuzung ${datum(d.picycle.letzteKreuzung.t)}` : ''))
    }

    // ── Regenbogen ──────────────────────────────────────────────────────
    if (d.rainbow?.jetzt) {
        dazu('rainbow', `Regenbogen-Band: „${d.rainbow.jetzt.band}" bei ${Math.round(d.rainbow.jetzt.preis)} USD`
            + ' (Kurvenanpassung an die Vergangenheit, keine Prognose)')
    }

    // ── Makro ───────────────────────────────────────────────────────────
    if (d.makro?.maerkte?.length) {
        const namen = { sp500: 'S&P 500', nasdaq: 'Nasdaq 100', russell: 'Russell 2000', dxy: 'Dollar-Index' }
        const teile = d.makro.maerkte.filter(m => m.verfuegbar).map(m =>
            `${namen[m.id] || m.id} ${pz(m.deltaPct, 2)}${m.offen === false ? ' (Börse zu)' : ''}`)
        const k = d.makro.korrelation
        if (k && nz(k.nasdaq)) teile.push(`Korrelation BTC↔Nasdaq ${k.nasdaq} (${k.deutung})`)
        if (k && nz(k.russell)) teile.push(`Korrelation BTC↔Russell 2000 ${k.russell}`)
        const s = d.makro.stablecoins
        if (s?.verfuegbar) teile.push(`Stablecoin-Menge ${s.tage} T ${pz(s.deltaPct, 2)} (${geld(Math.abs(s.deltaUsd))} ${s.deltaUsd < 0 ? 'abgeflossen' : 'zugeflossen'})`)
        if (teile.length) dazu('makro', `Makro: ${teile.join('; ')}`)
    }

    // ── Eigene Trades × Marktregime ─────────────────────────────────────
    if (d.regime?.buckets?.length) {
        const mit = d.regime.buckets.filter(b => b.anzahl > 0)
        if (mit.length) {
            dazu('regime', `Eigene Trades der letzten ${d.regime.tage} Tage nach Stimmungslage: `
                + mit.map(b => `${b.id} ${b.anzahl} Trades ${nz(b.summe) ? `${b.summe > 0 ? '+' : ''}${Math.round(b.summe)} USD` : ''}`).join(', ')
                + (d.regime.beste ? `; am besten in ${d.regime.beste}` : ''))
        }
    }

    return zeilen
}

/**
 * Antwort der KI auf eine feste Form bringen.
 *
 * Alles, was die Kachel zeichnet, muss hier durch: unbekannte Stimmung wird zu
 * `gemischt`, überzählige Punkte fallen weg, leere Felder werden zu leeren
 * Zeichenketten statt `undefined`. Fehlt sowohl Überschrift als auch Text,
 * gibt es nichts anzuzeigen — dann `null`, damit der Aufrufer einen ehrlichen
 * Fehler melden kann statt eine leere Kachel.
 *
 * @returns {object|null}
 */
export function normalisiereAntwort(json) {
    if (!json || typeof json !== 'object') return null

    const ueberschrift = String(json.ueberschrift || '').trim().slice(0, 140)
    const text = String(json.text || '').trim()
    if (!ueberschrift && !text) return null

    const punkte = (Array.isArray(json.punkte) ? json.punkte : [])
        .map(p => ({
            titel: String(p?.titel || '').trim().slice(0, 90),
            text: String(p?.text || '').trim(),
            ton: TOENE.includes(p?.ton) ? p.ton : 'neutral',
        }))
        .filter(p => p.titel || p.text)
        .slice(0, 5)

    const achten = (Array.isArray(json.achten) ? json.achten : [])
        .map(a => String(a || '').trim())
        .filter(Boolean)
        .slice(0, 3)

    return {
        stimmung: STIMMUNGEN.includes(json.stimmung) ? json.stimmung : 'gemischt',
        ueberschrift,
        text,
        punkte,
        widerspruch: String(json.widerspruch || '').trim(),
        achten,
    }
}
