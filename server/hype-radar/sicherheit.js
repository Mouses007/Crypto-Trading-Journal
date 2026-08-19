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
        hinweise.push('Zur Liquiditätssperre liegen keine Angaben vor')
    }

    // ── Abzüge ──────────────────────────────────────────────────────────
    let note = 100

    const top10 = summeTop10(goplus.holders)
    flaggen.top10Prozent = top10
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
export function summeTop10(halter) {
    if (!Array.isArray(halter) || !halter.length) return null
    const anteile = halter
        .slice(0, 10)
        .map((h) => Number(h?.percent) || 0)
    const summe = anteile.reduce((a, b) => a + b, 0)
    if (summe <= 0) return null
    return summe <= 1 ? summe * 100 : summe
}

/**
 * GoPlus abfragen. Getrennt vom Urteil, damit dieses prüfbar bleibt.
 *
 * @returns {Promise<object|null>} null, wenn die Kette nicht unterstützt wird
 *   oder nichts zu holen war — der Aufrufer behandelt das als „ungeprüft".
 */
export async function holeGoPlus(chain, contract) {
    if (!contract) return null
    const adresse = String(contract).toLowerCase()

    if (chain === 'solana') {
        const j = await holeJson(
            `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${encodeURIComponent(contract)}`)
        const d = j?.result?.[contract] || j?.result?.[adresse]
        if (!d) return null
        /*
         * Solana kennt keine Verkaufssteuer und keinen Eigentümer im
         * EVM-Sinn; stattdessen entscheiden die Vollmachten. Sie werden hier
         * auf dieselben Felder abgebildet, damit `pruefe` nur eine Sprache
         * sprechen muss.
         */
        return {
            is_honeypot: d?.non_transferable === '1' ? 1 : 0,
            is_mintable: d?.mintable?.status === '1' ? 1 : 0,
            owner_address: d?.mintable?.authority?.[0]?.address || '',
            transfer_pausable: d?.transfer_hook?.length ? 1 : 0,
            holder_count: Number(d?.holder_count) || 0,
            holders: (d?.holders || []).map((h) => ({ percent: Number(h?.percent) || 0 })),
            lp_holders: (d?.lp_holders || []).map((h) => ({
                percent: Number(h?.percent) || 0,
                is_locked: h?.is_locked,
                address: h?.address,
            })),
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
