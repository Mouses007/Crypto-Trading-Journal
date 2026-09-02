/**
 * Coin-Radar, KI-Einordnung: ein Absatz zur Gesamtlage.
 *
 * Kein Bericht, keine Recherche — die Zahlen stehen ja da. Was fehlt, ist der
 * Satz darüber, was sie ZUSAMMEN sagen: bewegt sich heute alles oder nur drei
 * Ausreisser, trendet es oder sägt es marktweit, ist das Feld teuer geworden.
 * Das liest ein Mensch aus zweihundert Zeilen nicht ab, ein Modell schon.
 *
 * Aufgeteilt wie `lagebild.js`: der reine Teil (Zahlen → Textzeilen, Prüfung
 * der Antwort) steht hier oben und ist ohne Netz nachrechenbar; der bezahlte
 * Aufruf steht unten.
 *
 * Die Rollenbelegung kommt aus dem Hype-Radar (`editor`). Zwei getrennte
 * Modellwahlen für zwei Absätze wären eine Einstellung mehr, die niemand
 * pflegen will — es ist dieselbe Aufgabe: kurz und nüchtern zusammenfassen.
 */

import { ladeLlmConfig, callLLMJson } from '../llm.js'
import { rollenAnbieter } from '../hype-radar/stufen.js'
import { leseEinstellungen as leseHypeEinstellungen } from '../hype-radar/einstellungen.js'
import { logWarn } from '../logger.js'
import { ANKER } from './bewertung.js'

/** Wie viele Spitzenreiter das Modell namentlich sieht. */
const TOP_N = 10

const mittel = (werte) => {
    const z = werte.filter((w) => Number.isFinite(w))
    return z.length ? z.reduce((a, b) => a + b, 0) / z.length : null
}

/**
 * Die Zahlen zu Textzeilen verdichten — der rein rechnende Teil.
 *
 * Bewusst aggregiert statt zweihundert Zeilen zu verschicken: Das Modell soll
 * die Lage beschreiben, nicht die Tabelle nacherzählen. Und ein kurzer
 * Anstoss kostet Cents statt Franken.
 *
 * @returns {{zeilen:string[], kennzahlen:object}}
 */
export function baueEinordnungsBasis(bewertet = [], meta = {}) {
    const b = bewertet.filter((z) => z.status === 'bewertet')
    const sortiert = [...b].sort((a, b2) => (a.rang || 9999) - (b2.rang || 9999))

    const kennzahlen = {
        bewertet: b.length,
        verworfen: Number(meta.verworfen) || 0,
        imSpiel: b.filter((z) => Number(z.rvol) >= ANKER.rvolSchwelle).length,
        trendend: b.filter((z) => Number(z.adx) >= 25).length,
        mittelAtrPct: mittel(b.map((z) => Number(z.atrPct))),
        mittelRvol: mittel(b.map((z) => Number(z.rvol))),
        teuresFunding: b.filter((z) => Math.abs(Number(z.fundingJahresRate) || 0) >= ANKER.fundingTeuer).length,
    }

    const zahl = (w, n = 1) => (Number.isFinite(w) ? w.toFixed(n) : '—')
    const zeilen = [
        `Bewertet: ${kennzahlen.bewertet} Coins, an den Liquiditätshürden gescheitert: ${kennzahlen.verworfen}.`,
        /*
         * „Im Spiel" ausgeschrieben. Mit der blossen Abkürzung las das Modell
         * es als Liquiditätsmass und schrieb, so viele Coins „erfüllen die
         * Liquiditätsschwelle" — die haben aber ALLE bewerteten erfüllt, sonst
         * stünden sie nicht in der Liste.
         */
        `Mit erhöhtem Volumen gegenüber dem eigenen Schnitt (RVOL ≥ ${ANKER.rvolSchwelle}): `
        + `${kennzahlen.imSpiel} Coins. Trendend (ADX ≥ 25): ${kennzahlen.trendend}.`,
        `Mittleres ATR: ${zahl(kennzahlen.mittelAtrPct, 2)} %. Mittleres RVOL: ${zahl(kennzahlen.mittelRvol, 2)}.`,
        `Teures Funding (≥ ${ANKER.fundingTeuer} % p. a.): ${kennzahlen.teuresFunding} Coins.`,
        '',
        `Die oberen ${Math.min(TOP_N, sortiert.length)}:`,
    ]
    for (const z of sortiert.slice(0, TOP_N)) {
        zeilen.push(
            `  ${z.rang}. ${z.symbol} — Note ${z.note}, ATR ${zahl(Number(z.atrPct), 2)} %, `
            + `RVOL ${zahl(Number(z.rvol), 1)}, ADX ${zahl(Number(z.adx), 0)}, `
            + `Funding ${zahl(Number(z.fundingJahresRate), 0)} % p. a.`,
        )
    }

    if (Number.isFinite(meta.rangkorrelation)) {
        zeilen.push('')
        zeilen.push(
            `Rangkorrelation zum vorigen Lauf: ${meta.rangkorrelation.toFixed(2)} `
            + `(über ${meta.gemeinsam || 0} gemeinsame Symbole). `
            + '1 = Rangfolge hält, 0 = sie ist Rauschen.',
        )
    }

    return { zeilen, kennzahlen }
}

/**
 * Antwort prüfen — rein.
 *
 * Zwei Dinge werden abgelehnt: leere Antworten und Prognosen. Der zweite Punkt
 * ist der wichtigere. Die ganze Seite beruht darauf, dass Volatilität beharrlich
 * ist und Richtung NICHT; ein Modell, das trotz Anweisung „BTC dürfte steigen"
 * schreibt, macht aus einer Zustandsbeschreibung einen Ratschlag.
 *
 * @returns {{ok:boolean, text:string, grund:string}}
 */
export function pruefeEinordnung(roh) {
    const text = String(roh?.text || roh?.einordnung || '').trim()
    if (!text) return { ok: false, text: '', grund: 'leer' }
    if (text.length > 1200) return { ok: true, text: `${text.slice(0, 1200)}…`, grund: 'gekürzt' }

    /*
     * Zwei getrennte Muster, und beide bewusst eng.
     *
     * Der erste Entwurf verwarf jedes Vorkommen von „steigen" und „fallen" —
     * und traf damit „in diese Gruppe fallen 20 Coins", „auffallen" und
     * „steigende Trendstärke". Ein bezahlter, völlig sachlicher Absatz
     * verschwand so wortlos. Eine Prognose steckt nicht im Verb, sondern in
     * der Zukunftsform: es braucht ein „dürfte", ein „wird … steigen", ein
     * Kursziel. Danach wird gesucht.
     */
    const prognose = /\b(dürfte[nst]?|wird\s+(?:wohl\s+)?(?:weiter\s+)?(?:steigen|fallen|klettern|sinken)|werden\s+(?:wohl\s+)?(?:steigen|fallen)|ist\s+zu\s+erwarten|kursziel|prognose|voraussichtlich)/i
    const rat = /\b(kaufen|verkaufen|long\s+gehen|short\s+gehen|einsteigen|empfehl|sollte\s+man)/i

    if (prognose.test(text)) return { ok: false, text, grund: 'prognose' }
    if (rat.test(text)) return { ok: false, text, grund: 'empfehlung' }

    return { ok: true, text, grund: '' }
}

const SYSTEM = `Du beschreibst den aktuellen Zustand eines Krypto-Futures-Marktes für einen erfahrenen Trader.

Regeln, ausnahmslos:
- HÖCHSTENS 4 Sätze. Keine Aufzählung, keine Überschrift.
- Beschreibe NUR den gemessenen Zustand: Wie breit ist die Bewegung, trendet es oder sägt es, ist Funding ein Thema, sticht etwas heraus.
- KEINE Prognose, KEINE Handelsempfehlung, kein Kursziel, kein "dürfte". Wohin es geht, weisst du nicht, und die Zahlen sagen es auch nicht.
- Nenne höchstens drei Symbole, und nur wenn sie sich vom Rest abheben.
- Nüchtern, keine Werbesprache.

Antworte als JSON: {"text": "..."}`

/**
 * Die Einordnung erzeugen. Kostet — deshalb nur auf ausdrücklichen Wunsch.
 *
 * Ein Fehlschlag darf den Lauf nicht kippen: die Rangliste ist das Produkt,
 * der Absatz ist die Zugabe. Deshalb wird hier gefangen und `null` geliefert.
 *
 * @returns {Promise<{text:string, kostenUsd:number}|null>}
 */
export async function erzeugeEinordnung(bewertet, meta = {}, laufId = 0) {
    try {
        const hype = await leseHypeEinstellungen()
        const { provider, modell } = rollenAnbieter(hype, 'editor')
        if (!provider) return null

        const cfg = await ladeLlmConfig({ provider, model: modell })
        /*
         * Vier Sätze brauchen keine 3000 Token — das Denken davor schon.
         *
         * Mit 400 scheiterte praktisch jeder Lauf: `stopReason=length`, kein
         * verwertbares JSON, Kosten trotzdem gebucht (127 Fehlläufe in 11
         * Stunden, gemessen 02.09.2026). Naheliegend war, der Absatz sei zu
         * lang — falsch. Gemessen gegen deepseek-v4-pro:
         *
         *   max 900  → length, alle 900 Token weg, nichts kam an
         *   max 2000 → stop,  635 Token, 418 Zeichen Text
         *   max 4000 → stop, 1291 Token, 419 Zeichen Text
         *
         * Der ANTWORTTEXT ist konstant ~130 Token. Alles darüber ist der
         * Reasoning-Anteil, und der schwankt um mehr als das Doppelte — er
         * zählt bei OpenRouter in `completion_tokens` mit, steht aber in
         * `message.reasoning` und nicht in `content`. Ein Deckel, der nur den
         * Text bemisst, schneidet deshalb das Denken ab und bekommt eine leere
         * `content`, für die voll bezahlt wird.
         *
         * 3000 gibt dem Reasoning Luft (gemessenes Maximum 1291) und bleibt
         * eine Kostenbremse — abgerechnet wird der Verbrauch, nicht der
         * Deckel. Die Formvorgabe leistet der Prompt, und `pruefeEinordnung`
         * kürzt zusätzlich bei 1200 Zeichen. Dieselbe Begründung wie beim
         * `maxTokens` der Lage-Kachel in `marktradar-lage.js`.
         */
        cfg.maxTokens = 3000

        const { zeilen } = baueEinordnungsBasis(bewertet, meta)
        const antwort = await callLLMJson(cfg, {
            system: SYSTEM,
            user: zeilen.join('\n'),
            zweck: 'coin-radar',
            ausloeser: meta.ausloeser || 'auto',
            // {typ, id} — eine Zeichenkette käme als leerer Rückverweis an.
            bezug: laufId ? { typ: 'coinradar_lauf', id: laufId } : null,
        })

        const geprueft = pruefeEinordnung(antwort?.json)
        if (!geprueft.ok) {
            // Den Text mitloggen: Ein verworfener Absatz ist bezahlt, und ohne
            // ihn lässt sich nicht unterscheiden, ob das Modell entgleist ist
            // oder der Wächter zu scharf steht.
            logWarn('coin-radar', `Einordnung verworfen (${geprueft.grund}): ${geprueft.text.slice(0, 200)}`)
            return null
        }
        /*
         * Die Kosten sind auch dann gebucht, wenn wir den Text verwerfen —
         * bezahlt ist bezahlt. Deshalb kommen sie aus der Antwort und nicht
         * aus einer eigenen Rechnung.
         */
        return { text: geprueft.text, kostenUsd: Number(antwort?.costUsd) || 0 }
    } catch (e) {
        logWarn('coin-radar', `Einordnung fehlgeschlagen: ${e.message}`)
        return null
    }
}
