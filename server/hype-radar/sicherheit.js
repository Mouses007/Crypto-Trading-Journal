/**
 * Hype-Radar, Stufe 3: Sicherheitsprüfung.
 *
 * Das ist die Stufe, die über die Brauchbarkeit des ganzen Features
 * entscheidet. Täglich starten Tausende Token; ein erheblicher Teil ist darauf
 * angelegt, Käufer nicht wieder herauszulassen. Ein Radar ohne diese Prüfung
 * wäre nicht bloss ungenau — er wäre eine Empfehlungsmaschine für Betrug.
 *
 * Zwei Arten von Befunden:
 *
 *   **K.-o.-Kriterien** verwerfen sofort, unabhängig von der Hype-Note. Ein
 *   Token, aus dem man nicht wieder herauskommt, wird nicht dadurch besser,
 *   dass alle darüber reden — im Gegenteil.
 *
 *   **Abzüge** senken die Sicherheitsnote, ohne zu verwerfen. Sie beschreiben
 *   erhöhtes Risiko, nicht Betrug.
 *
 * Der Prüfteil ist rein: er bekommt die Antwort von GoPlus und die Marktdaten
 * und gibt ein Urteil zurück. Das Abrufen steht getrennt darunter — so lässt
 * sich das Urteil mit festen Beispieldaten prüfen, ohne ins Netz zu gehen.
 */

import { holeJson } from './quellen.js'

/** Vorgaben der harten Grenzen. Alle in den Einstellungen änderbar. */
export const STANDARD_SICHERHEIT = {
    minLiquiditaetUsd: 50000,     // darunter bewegt ein einzelner Verkauf den Kurs
    maxTop10Prozent: 40,          // ohne Sperrfrist ist das eine Ausstiegsluke
    maxFdvLiqVerhaeltnis: 100,    // Bewertung ohne Handelstiefe dahinter
    minPaarAlterStunden: 12,      // Schutz vor dem ersten Chaos nach dem Start
    lpMussGesperrtSein: true,
    maxVerkaufssteuerProzent: 10,
}

/** Ketten-Nummern für GoPlus. Solana hat einen eigenen Endpunkt. */
const KETTEN_ID = {
    ethereum: '1', bsc: '56', polygon: '137', arbitrum: '42161',
    avalanche: '43114', base: '8453', optimism: '10',
}

/** „1"/„0"/1/true → boolean. GoPlus antwortet gemischt. */
const jaNein = (w) => w === true || w === 1 || w === '1'

/** Prozentzahl aus einem Feld, das auch „0.05" (=5 %) sein kann. */
function prozent(roh) {
    const z = Number(roh)
    if (!Number.isFinite(z)) return null
    // GoPlus liefert Steuern als Anteil (0.05), nicht als Prozent.
    return z <= 1 ? z * 100 : z
}

/**
 * Urteil über einen Kandidaten — rein, ohne Netz.
 *
 * @param {object} goplus   Rohantwort zu genau diesem Vertrag (kann null sein)
 * @param {object} markt    Marktdaten aus DexScreener
 * @param {object} regeln   Grenzwerte
 * @returns {{status:'bestanden'|'verworfen', grund:string, safetyScore:number, flaggen:object, hinweise:string[]}}
 */
export function pruefe(goplus, markt = {}, regeln = STANDARD_SICHERHEIT) {
    const r = { ...STANDARD_SICHERHEIT, ...(regeln || {}) }
    const hinweise = []
    const flaggen = {}

    // ── Marktseitige K.-o.-Kriterien ────────────────────────────────────
    // Sie gelten auch ohne GoPlus-Antwort: zu wenig Liquidität ist zu wenig
    // Liquidität, ganz gleich wie der Vertrag aussieht.
    const liq = Number(markt.liquiditaetUsd) || 0
    if (liq < r.minLiquiditaetUsd) {
        return verworfen('liquiditaet_zu_klein',
            `Liquidität ${Math.round(liq)} USD unter ${r.minLiquiditaetUsd}`, flaggen, hinweise)
    }

    const alter = Number(markt.paarAlterStunden)
    if (Number.isFinite(alter) && alter < r.minPaarAlterStunden) {
        return verworfen('zu_jung',
            `Paar erst ${alter.toFixed(1)} h alt (Mindestalter ${r.minPaarAlterStunden} h)`, flaggen, hinweise)
    }

    // ── Vertragsseitige K.-o.-Kriterien ─────────────────────────────────
    if (!goplus) {
        /*
         * Keine Antwort ist kein Freibrief.
         *
         * Ein Vertrag, über den sich nichts sagen lässt, wird nicht behandelt
         * wie einer, der geprüft wurde — er kommt in den Bericht nur als
         * aussortiert. Die Alternative wäre, ungeprüfte Token unter „Top-
         * Kandidaten" zu führen, und genau das darf nicht passieren.
         */
        return verworfen('ungeprueft',
            'Keine Sicherheitsdaten verfügbar — ungeprüft wird nicht empfohlen', flaggen, hinweise)
    }

    flaggen.honeypot = jaNein(goplus.is_honeypot)
    if (flaggen.honeypot) {
        return verworfen('honeypot', 'Verkauf ist gesperrt (Honeypot)', flaggen, hinweise)
    }

    flaggen.verkaufSperrbar = jaNein(goplus.cannot_sell_all) || jaNein(goplus.transfer_pausable)
    if (flaggen.verkaufSperrbar) {
        return verworfen('verkauf_sperrbar',
            'Übertragung kann angehalten oder der Verkauf begrenzt werden', flaggen, hinweise)
    }

    const verkaufssteuer = prozent(goplus.sell_tax)
    flaggen.verkaufssteuerProzent = verkaufssteuer
    if (verkaufssteuer !== null && verkaufssteuer > r.maxVerkaufssteuerProzent) {
        return verworfen('verkaufssteuer_hoch',
            `Verkaufssteuer ${verkaufssteuer.toFixed(1)} % über ${r.maxVerkaufssteuerProzent} %`, flaggen, hinweise)
    }

    flaggen.praegbar = jaNein(goplus.is_mintable)
    flaggen.eigentuemerAktiv = Boolean(goplus.owner_address)
        && String(goplus.owner_address) !== '0x0000000000000000000000000000000000000000'
    if (flaggen.praegbar && flaggen.eigentuemerAktiv) {
        return verworfen('praegbar',
            'Nachprägung möglich und Eigentümerrechte nicht abgegeben', flaggen, hinweise)
    }

    // Liquiditätssperre. Fehlen die Angaben, wird nicht geraten.
    const lpHalter = Array.isArray(goplus.lp_holders) ? goplus.lp_holders : []
    if (lpHalter.length) {
        const gesperrt = lpHalter.reduce((summe, h) => {
            const anteil = Number(h?.percent) || 0
            const istGesperrt = jaNein(h?.is_locked)
                // Verbrannte Anteile gehen an die Nulladresse — dauerhafter
                // als jede Sperrfrist.
                || /^0x0{40}$/i.test(String(h?.address || ''))
                || /^0x0*dead$/i.test(String(h?.address || ''))
            return summe + (istGesperrt ? anteil : 0)
        }, 0)
        // GoPlus gibt Anteile als 0..1 ODER 0..100 — beides kommt vor.
        flaggen.lpGesperrtProzent = gesperrt <= 1 ? gesperrt * 100 : gesperrt
        if (r.lpMussGesperrtSein && flaggen.lpGesperrtProzent < 50) {
            return verworfen('lp_offen',
                `Nur ${flaggen.lpGesperrtProzent.toFixed(0)} % der Liquidität gesperrt oder verbrannt`,
                flaggen, hinweise)
        }
    } else if (r.lpMussGesperrtSein) {
        /*
         * Unbekannt ist nicht bestanden.
         *
         * Bis zum Audit vom 19.08.2026 stand hier nur ein Hinweis — die
         * Einstellung versprach einen harten Filter und lieferte eine
         * Fussnote. Gemessen kamen dadurch vier von zehn Kandidaten, die
         * diese Prüfung überhaupt erreichten, mit Sicherheitsnote 100 durch,
         * ohne dass die Sperre je geprüft worden wäre.
         *
         * Dieselbe Linie wie ein paar Zeilen weiter oben bei fehlender
         * GoPlus-Antwort: „ungeprüft wird nicht empfohlen". Wer die Sperre
         * nicht zur Pflicht macht, bekommt weiterhin nur den Hinweis.
         */
        return verworfen('lp_unbekannt',
            'Zur Liquiditätssperre liegen keine Angaben vor — ungeprüft wird nicht empfohlen',
            flaggen, hinweise)
    } else {
        hinweise.push('Zur Liquiditätssperre liegen keine Angaben vor')
    }

    // ── Abzüge ──────────────────────────────────────────────────────────
    let note = 100

    const top10 = summeTop10(goplus.holders)
    flaggen.top10Prozent = top10
    /*
     * Beide Zahlen bleiben stehen: die bereinigte entscheidet, die rohe macht
     * die Bereinigung überprüfbar. Weichen sie stark ab, war viel verbrannt
     * oder gesperrt — das ist eine gute Nachricht und soll auch so aussehen.
     */
    flaggen.top10ProzentRoh = summeTop10(goplus.holders, { roh: true })
    const raus = top10Ausgeschlossen(goplus.holders)
    if (raus.length) {
        flaggen.top10Ausgeschlossen = raus
        const anteil = raus.reduce((a, x) => a + x.anteil, 0)
        hinweise.push(`${raus.length} der zehn grössten Halter nicht mitgezählt `
            + `(${raus.map((x) => x.grund).join(', ')})`)
        if (anteil > 0) flaggen.top10AusgeschlossenAnteil = anteil
    }
    if (top10 !== null) {
        if (top10 > r.maxTop10Prozent) {
            // Kein K.o., aber der schwerste Abzug: wenige Halter können den
            // Markt jederzeit überrollen.
            note -= Math.min(40, (top10 - r.maxTop10Prozent) * 1.5)
            hinweise.push(`Die zehn grössten Halter halten ${top10.toFixed(0)} %`)
        }
    } else {
        note -= 10
        hinweise.push('Halterverteilung unbekannt')
    }

    const fdv = Number(markt.fdv) || 0
    if (fdv > 0 && liq > 0) {
        const verhaeltnis = fdv / liq
        flaggen.fdvLiqVerhaeltnis = Math.round(verhaeltnis)
        if (verhaeltnis > r.maxFdvLiqVerhaeltnis) {
            note -= Math.min(25, (verhaeltnis - r.maxFdvLiqVerhaeltnis) / 10)
            hinweise.push(`Bewertung ${Math.round(verhaeltnis)}× über der Liquidität`)
        }
    }

    flaggen.proxy = jaNein(goplus.is_proxy)
    if (flaggen.proxy) {
        note -= 15
        hinweise.push('Proxy-Vertrag — die Logik ist austauschbar')
    }

    const halter = Number(goplus.holder_count) || 0
    flaggen.halterZahl = halter
    if (halter > 0 && halter < 200) {
        note -= 15
        hinweise.push(`Erst ${halter} Halter`)
    }

    /*
     * Handelsmuster. Ein Kauf/Verkauf-Verhältnis weit über 1 sieht auf den
     * ersten Blick gut aus, ist aber genau die Signatur eines Honeypots: viele
     * kommen hinein, kaum jemand wieder heraus. Deshalb Abzug statt Bonus.
     */
    const kv = Number(markt.kaufVerkaufVerhaeltnis)
    if (Number.isFinite(kv) && kv > 5) {
        note -= 20
        hinweise.push(`Auf einen Verkauf kommen ${kv.toFixed(0)} Käufe — auffällig einseitig`)
    }

    return {
        status: 'bestanden',
        grund: '',
        safetyScore: Math.max(0, Math.min(100, Math.round(note))),
        flaggen,
        hinweise,
    }
}

function verworfen(grund, text, flaggen, hinweise) {
    return { status: 'verworfen', grund, safetyScore: 0, flaggen, hinweise: [...hinweise, text] }
}

/** Anteil der zehn grössten Halter in Prozent, oder null. */
/** Adressen, hinter denen niemand steht, der verkaufen könnte. */
const VERBRANNT = [/^0x0{40}$/i, /^0x0*dead$/i, /^1n[cC]1nerator/, /^11111111111111111111111111111111$/]

/**
 * Stichwörter in GoPlus-Tags, die eine Adresse als Systemadresse ausweisen.
 * GoPlus benennt bekannte Adressen selbst — das ist verlässlicher als jede
 * eigene Liste, die man pflegen müsste.
 */
const SYSTEM_TAGS = /burn|null|dead|lock|vest|team|foundation|treasury|binance|coinbase|okx|bybit|kraken|bitget|gate|kucoin|uniswap|pancake|raydium|orca|meteora|pool|router/i

/** Ist dieser Halter jemand, der den Markt überrollen könnte? */
function istGefahr(h) {
    const adresse = String(h?.address || '')
    if (VERBRANNT.some((r) => r.test(adresse))) return false
    // Gesperrt heisst: kann in der Sperrfrist nicht verkaufen.
    if (jaNein(h?.is_locked)) return false
    if (SYSTEM_TAGS.test(String(h?.tag || ''))) return false
    return true
}

/**
 * Anteil der zehn grössten Halter in Prozent — BEREINIGT.
 *
 * Vor dem Audit vom 19.08.2026 wurden die ersten zehn `percent` roh addiert.
 * Verbrannte Anteile, gesperrte Tranchen, Börsen-Sammeladressen und die
 * Liquiditätspools selbst zählten mit — und damit wirkte ausgerechnet eine
 * saubere Aufsetzung riskant. Umgekehrt half das niemandem: Wer die Verteilung
 * wirklich kontrolliert, verteilt sie auf mehrere Wallets, und dagegen hilft
 * kein Summieren.
 *
 * Ausgeschlossen wird nur, was nachweislich nicht verkaufen KANN oder wem der
 * Anbieter selbst einen Namen gegeben hat. Eine unbekannte Adresse bleibt
 * verdächtig — das ist die Linie des Hauses.
 *
 * @param {Array} halter
 * @param {object} opts  `{roh: true}` liefert die unbereinigte Summe
 * @returns {number|null} Prozent, oder null wenn nichts zu rechnen war
 */
export function summeTop10(halter, opts = {}) {
    if (!Array.isArray(halter) || !halter.length) return null
    const genommen = halter.slice(0, 10).filter((h) => opts.roh || istGefahr(h))
    const summe = genommen.reduce((a, h) => a + (Number(h?.percent) || 0), 0)
    // Kein Halter mehr übrig heisst: alles verbrannt, gesperrt oder benannt.
    // Das ist eine Aussage (0 %), keine fehlende Messung.
    if (!genommen.length) return halter.length ? 0 : null
    if (summe <= 0) return null
    // GoPlus gibt Anteile als 0..1 ODER 0..100 — beides kommt vor.
    return summe <= 1 ? summe * 100 : summe
}

/**
 * Welche der zehn grössten Halter warum nicht mitgezählt wurden.
 * Für die Anzeige: Ein Abzug, dessen Herkunft man nicht sieht, ist eine
 * Behauptung.
 */
export function top10Ausgeschlossen(halter) {
    if (!Array.isArray(halter)) return []
    return halter.slice(0, 10).filter((h) => !istGefahr(h)).map((h) => ({
        adresse: String(h?.address || '').slice(0, 10),
        anteil: Number(h?.percent) || 0,
        grund: jaNein(h?.is_locked) ? 'gesperrt'
            : (VERBRANNT.some((r) => r.test(String(h?.address || ''))) ? 'verbrannt' : String(h?.tag || 'benannt')),
    }))
}

/**
 * RugCheck-Antwort auf die GoPlus-Form bringen — rein, ohne Netz.
 *
 * `pruefe` spricht eine Sprache (die GoPlus-Felder); eine zweite Quelle muss
 * sich ihr anpassen, nicht umgekehrt. Getrennt exportiert, damit die
 * Übersetzung mit festen Beispieldaten prüfbar ist.
 *
 * Solana-Eigenheiten: `rugged` heisst, der Teppich ist BEREITS gezogen — das
 * wird wie ein Honeypot behandelt. Eine gesetzte Freeze-Authority kann jede
 * Übertragung anhalten; eine gesetzte Mint-Authority kann nachprägen.
 */
export function ausRugCheck(j) {
    if (!j || typeof j !== 'object') return null
    const lpGesperrtPct = Number(j?.markets?.[0]?.lp?.lpLockedPct)
    return {
        is_honeypot: j?.rugged ? 1 : 0,
        transfer_pausable: j?.token?.freezeAuthority ? 1 : 0,
        is_mintable: j?.token?.mintAuthority ? 1 : 0,
        owner_address: j?.token?.mintAuthority || '',
        holder_count: Number(j?.totalHolders) || 0,
        // RugCheck gibt Prozentwerte 0..100 — `summeTop10` erkennt das selbst.
        holders: (Array.isArray(j?.topHolders) ? j.topHolders : [])
            .map((h) => ({
                percent: Number(h?.pct) || 0,
                address: String(h?.address || h?.owner || ''),
                // RugCheck kennt keine Tags, aber `insider` — die Antwort auf
                // dieselbe Frage aus der anderen Richtung.
                tag: h?.insider ? 'insider' : '',
                is_locked: 0,
                is_contract: 0,
            })),
        lp_holders: Number.isFinite(lpGesperrtPct)
            ? [{ percent: lpGesperrtPct, is_locked: 1, address: 'rugcheck' }]
            : [],
        sell_tax: 0,     // kennt Solana nicht
        is_proxy: 0,
    }
}

/**
 * Sicherheitsdaten abfragen. Getrennt vom Urteil, damit dieses prüfbar bleibt.
 *
 * Solana hat zwei Quellen: GoPlus zuerst, bei Ausfall RugCheck. Der Grund ist
 * kein Misstrauen gegen GoPlus, sondern ein 504 im Test vom 19.08.2026 — und
 * fast alle Meme-Funde leben auf Solana. Hinge der ganze Trichter an einem
 * einzigen wackligen Endpunkt, wäre „ungeprüft → verworfen" der Normalzustand.
 *
 * @returns {Promise<object|null>} null, wenn die Kette nicht unterstützt wird
 *   oder nichts zu holen war — der Aufrufer behandelt das als „ungeprüft".
 */
export async function holeGoPlus(chain, contract) {
    if (!contract) return null
    const adresse = String(contract).toLowerCase()

    if (chain === 'solana') {
        let d = null
        try {
            const j = await holeJson(
                `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${encodeURIComponent(contract)}`)
            d = j?.result?.[contract] || j?.result?.[adresse]
        } catch {
            // GoPlus klemmt — RugCheck übernimmt.
        }
        if (!d) {
            const r = await holeJson(
                `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(contract)}/report`)
            return ausRugCheck(r)
        }
        /*
         * Solana kennt keine Verkaufssteuer und keinen Eigentümer im
         * EVM-Sinn; stattdessen entscheiden die Vollmachten. Sie werden hier
         * auf dieselben Felder abgebildet, damit `pruefe` nur eine Sprache
         * sprechen muss.
         */
        /*
         * Die Liquiditätssperre muss von RugCheck kommen — auch wenn GoPlus
         * geantwortet hat.
         *
         * Gemessen am 19.08.2026: Die Solana-Antwort von GoPlus kennt das Feld
         * `lp_holders` NICHT (es ist EVM-Sprache). RugCheck kennt es sehr wohl
         * und meldete für DPG `lpLockedPct: 100`. Da der Ausweichpfad nur bei
         * einem GoPlus-AUSFALL griff, wurde die Angabe nie geholt — und weil
         * fehlende Angaben nur einen Hinweis erzeugten, kam jeder Solana-Fund
         * mit voller Sicherheitsnote durch die Sperr-Pflicht.
         *
         * Ein zusätzlicher Abruf je Solana-Kandidat, höchstens vierzig pro
         * Lauf. Das ist der Preis dafür, dass die Einstellung „LP muss
         * gesperrt sein" auf Solana überhaupt etwas bedeutet.
         */
        let lpHolders = (d?.lp_holders || []).map((h) => ({
            percent: Number(h?.percent) || 0,
            is_locked: h?.is_locked,
            address: h?.address,
        }))
        if (!lpHolders.length) {
            try {
                const rc = await holeJson(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(contract)}/report`)
                lpHolders = ausRugCheck(rc)?.lp_holders || []
            } catch {
                // Bleibt leer — und „unbekannt" ist ab jetzt ein echter Befund.
            }
        }

        return {
            is_honeypot: d?.non_transferable === '1' ? 1 : 0,
            is_mintable: d?.mintable?.status === '1' ? 1 : 0,
            owner_address: d?.mintable?.authority?.[0]?.address || '',
            transfer_pausable: d?.transfer_hook?.length ? 1 : 0,
            holder_count: Number(d?.holder_count) || 0,
            /*
             * Die Merkmale bleiben erhalten.
             *
             * Bis zum Audit vom 19.08.2026 wurde hier alles ausser `percent`
             * weggeworfen — und damit genau das, was einen grossen Halter
             * einordnet: `is_locked` (Sperrfrist), `tag` (GoPlus benennt
             * bekannte Adressen wie Börsen oder Null-Adresse) und
             * `is_contract`. Ohne sie wirkte eine saubere Verteilung riskant,
             * weil verbrannte und gesperrte Anteile mitzählten.
             */
            holders: (d?.holders || []).map((h) => ({
                percent: Number(h?.percent) || 0,
                address: String(h?.address || ''),
                tag: String(h?.tag || ''),
                is_locked: h?.is_locked,
                is_contract: h?.is_contract,
            })),
            lp_holders: lpHolders,
            sell_tax: 0,
            is_proxy: 0,
        }
    }

    const kette = KETTEN_ID[chain]
    if (!kette) return null
    const j = await holeJson(
        `https://api.gopluslabs.io/api/v1/token_security/${kette}?contract_addresses=${encodeURIComponent(adresse)}`)
    return j?.result?.[adresse] || null
}
