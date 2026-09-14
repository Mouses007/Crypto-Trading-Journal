/**
 * Regelmässige Kontrolle der Börsen-Zugänge.
 *
 * Der Vermerk aus `boersen-status.js` entsteht beim Abrufen — und abgerufen
 * wird nur, solange jemand die pendenten Trades offen hat. Genau dann merkt
 * man einen toten Schlüssel aber ohnehin. Gefragt ist das Gegenteil: dass er
 * auffällt, während man WOANDERS ist. Deshalb klopft diese Wache im
 * Benachrichtigungs-Takt (alle 10 Minuten) selbst an.
 *
 * Bewusst ein eigenes Modul: `boersen-status.js` wird von den drei
 * Börsenmodulen importiert, dürfte sie also nicht selbst importieren.
 *
 * Geprüft wird mit demselben Aufruf, den die Seite benutzt — ein eigener
 * „Test"-Pfad könnte gelingen, während der echte scheitert (andere
 * Berechtigung), und wäre dann eine Wache, die Entwarnung gibt.
 */
import { getDecryptedConfig as bitunixConfig, getPendingPositions } from './bitunix-api.js'
import { getDecryptedBitgetConfig, getCurrentPositions } from './bitget-api.js'
import { getDecryptedPionexConfig, getBalances } from './pionex-api.js'
import { merkeBoersenStatus } from './boersen-status.js'
import { logWarn } from './logger.js'

/**
 * Eine Prüfung je Börse: Zugangsdaten holen, EINEN lesenden Aufruf machen.
 * `null` zurück heisst „nicht eingerichtet" — dann gibt es nichts zu wachen.
 */
const BOERSEN = {
    async bitunix() {
        const c = await bitunixConfig()
        if (!c?.apiKey || !c?.secretKey) return null
        const r = await getPendingPositions(c.apiKey, c.secretKey, {})
        // Bitunix meldet den Fehler IM Rumpf, nicht über den HTTP-Status —
        // ohne diese Zeile gälte „apiKey invalid" als gelungener Abruf.
        if (r?.code !== 0) throw new Error(r?.msg || 'Bitunix API Fehler')
        return true
    },
    async bitget() {
        const c = await getDecryptedBitgetConfig()
        if (!c?.apiKey || !c?.secretKey || !c?.passphrase) return null
        await getCurrentPositions(c.apiKey, c.secretKey, c.passphrase)
        return true
    },
    async pionex() {
        const c = await getDecryptedPionexConfig()
        if (!c?.apiKey || !c?.secretKey) return null
        await getBalances(c.apiKey, c.secretKey)
        return true
    },
}

/**
 * Alle eingerichteten Börsen prüfen und den Vermerk nachführen.
 *
 * Jede Börse einzeln abgesichert: Dass Bitget nicht antwortet, darf die
 * Prüfung von Bitunix nicht verhindern.
 */
export async function pruefeBoersenZugang() {
    for (const [broker, pruefung] of Object.entries(BOERSEN)) {
        try {
            const eingerichtet = await pruefung()
            if (eingerichtet === null) continue
            await merkeBoersenStatus(broker)
        } catch (e) {
            logWarn('boersen-wacht', `${broker}: ${e.message}`)
            await merkeBoersenStatus(broker, e.message)
        }
    }
}
