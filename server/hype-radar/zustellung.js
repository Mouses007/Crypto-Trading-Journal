/**
 * Zustellung der Wachhund-Alarme: ntfy, Telegram, Webhook.
 *
 * Die In-App-Liste ist immer da — diese Kanäle bringen den Alarm dorthin, wo
 * man ihn auch sieht, wenn das Journal zu ist: aufs Handy (ntfy, Telegram)
 * oder in die Hausautomatisierung (Webhook → Home Assistant, wo aus einem
 * kritischen Alarm ein rotes Licht werden kann).
 *
 * Jeder Kanal hat eine Mindest-Schwere: Telegram um drei Uhr wegen eines
 * 15-%-Hüpfers ist der schnellste Weg, Alarme ganz abzuschalten — der Nutzer
 * entscheidet je Kanal, was ihn erreichen darf.
 *
 * Ein Kanalausfall wirft nicht: gespeichert ist der Alarm schon, und die
 * übrigen Kanäle sollen ihre Chance behalten.
 */

import { logWarn } from '../logger.js'

const ABRUF_TIMEOUT_MS = 10000
const RANG = { info: 0, warnung: 1, kritisch: 2 }

/** Erreicht die Schwere die Mindest-Schwere des Kanals? */
export function erreichtSchwere(schwere, minSchwere) {
    return (RANG[schwere] ?? 0) >= (RANG[minSchwere] ?? 0)
}

/** Wiederholbar: Netzfehler, Zeitüberschreitung, Überlast und Serverfehler. */
const wiederholbar = (status) => status === undefined || status === 429 || status >= 500

/**
 * POST mit EINER Wiederholung nach kurzer Pause.
 *
 * Bis zum 07.10.2026 gab es keinen zweiten Versuch — und die Sperrfrist des
 * Alarms war beim Zustellen schon verbraucht. Ein einzelner Aussetzer des
 * ntfy-Servers verschluckte damit einen kritischen Alarm für eine Stunde.
 */
async function post(url, { kopf = {}, body }) {
    let letzter
    for (let versuch = 0; versuch < 2; versuch++) {
        const abbruch = new AbortController()
        const uhr = setTimeout(() => abbruch.abort(), ABRUF_TIMEOUT_MS)
        let status
        try {
            const r = await fetch(url, { method: 'POST', headers: kopf, body, signal: abbruch.signal })
            if (r.ok) return
            status = r.status
            letzter = new Error(`HTTP ${r.status}`)
        } catch (e) {
            letzter = e
        } finally {
            clearTimeout(uhr)
        }
        if (!wiederholbar(status) || versuch === 1) break
        await new Promise((f) => setTimeout(f, 2000))
    }
    throw letzter
}

/**
 * ntfy: als JSON an die Wurzel-Adresse, Priorität aus der Schwere.
 * Kritisches klingelt (urgent), Informatives bleibt still einsortiert.
 *
 * JSON statt Kopfzeilen: Ein HTTP-Header darf nur Latin-1 tragen, und ein
 * Titel wie `币安 (liqAbfluss)` oder ein Emoji-Kürzel warf unter Node 22
 * „Cannot convert argument to a ByteString" — der Alarm kam nie an, und der
 * Test-Knopf („TEST") konnte das nicht zeigen. Im JSON-Rumpf ist UTF-8
 * selbstverständlich.
 */
async function ntfy(alarm, fav, kanal, geheim) {
    const basis = String(kanal.url || '').replace(/\/+$/, '')
    const topic = String(kanal.topic || 'hype-radar').trim()
    if (!basis) throw new Error('keine ntfy-Adresse hinterlegt')
    await post(basis, {
        kopf: {
            'Content-Type': 'application/json',
            ...(geheim.ntfyToken ? { Authorization: `Bearer ${geheim.ntfyToken}` } : {}),
        },
        body: JSON.stringify(ntfyNachricht(alarm, fav, topic)),
    })
}

/** Der ntfy-Rumpf — rein, damit prüfbar. */
export function ntfyNachricht(alarm, fav, topic = 'hype-radar') {
    return {
        topic,
        title: `${fav?.symbol || '?'} (${alarm.regel})`,
        message: alarm.meldung,
        priority: { kritisch: 5, warnung: 4, info: 3 }[alarm.schwere] || 3,
        tags: [alarm.schwere === 'kritisch' ? 'rotating_light' : 'chart_with_downwards_trend'],
    }
}

/** Telegram: die Bot-API braucht nur Token und Chat-Id. */
async function telegram(alarm, fav, kanal, geheim) {
    if (!geheim.telegramToken) throw new Error('kein Bot-Token hinterlegt')
    const chatId = String(kanal.chatId || '').trim()
    if (!chatId) throw new Error('keine Chat-Id hinterlegt')
    const zeichen = { kritisch: '🚨', warnung: '⚠️', info: 'ℹ️' }[alarm.schwere] || ''
    await post(`https://api.telegram.org/bot${geheim.telegramToken}/sendMessage`, {
        kopf: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `${zeichen} ${alarm.meldung}` }),
    })
}

/**
 * Webhook: ein POST mit allem, was eine Automation braucht.
 *
 * Gedacht für den Webhook-Auslöser in Home Assistant — die Adresse
 * (`https://ha.local:8123/api/webhook/<id>`) ist das Geheimnis und liegt
 * deshalb verschlüsselt. Die Automation filtert selbst auf
 * `trigger.json.schwere == 'kritisch'` und lässt dann blinken, was sie will.
 */
async function webhook(alarm, fav, kanal, geheim) {
    if (!geheim.webhookUrl) throw new Error('keine Webhook-Adresse hinterlegt')
    await post(geheim.webhookUrl, {
        kopf: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            quelle: 'hype-radar',
            regel: alarm.regel,
            schwere: alarm.schwere,
            symbol: fav.symbol,
            chain: fav.chain,
            meldung: alarm.meldung,
            daten: alarm.daten || {},
            ts: Date.now(),
        }),
    })
}

const KANAELE = { ntfy, telegram, webhook }

/**
 * Einen Alarm über alle eingeschalteten Kanäle schicken, deren
 * Mindest-Schwere erreicht ist.
 *
 * @param {object} alarm  {regel, schwere, meldung, daten}
 * @param {object} fav    Favorit
 * @param {object} einst  Einstellungen inkl. alarmKanaele und schluessel
 */
export async function stelleZu(alarm, fav, einst) {
    const kanaele = einst?.alarmKanaele || {}
    const geheim = einst?.schluessel || {}
    for (const [name, senden] of Object.entries(KANAELE)) {
        const kanal = kanaele[name]
        if (!kanal?.an) continue
        if (!erreichtSchwere(alarm.schwere, kanal.minSchwere || 'info')) continue
        try {
            await senden(alarm, fav, kanal, geheim)
        } catch (e) {
            // Der Alarm ist gespeichert; ein tauber Kanal ist eine Warnung
            // wert, kein Abbruchgrund für die übrigen.
            logWarn('hype-zustellung', `${name}: ${e.message}`)
        }
    }
}

/** Für den Test-Knopf: eine harmlose Meldung über die echten Kanäle. */
export async function testZustellung(einst) {
    const alarm = {
        regel: 'test',
        schwere: 'info',
        meldung: 'Hype-Radar: Testmeldung — die Zustellung funktioniert.',
        daten: { test: true },
    }
    const fav = { symbol: 'TEST', chain: '—' }
    const ergebnis = {}
    const kanaele = einst?.alarmKanaele || {}
    const geheim = einst?.schluessel || {}
    for (const [name, senden] of Object.entries(KANAELE)) {
        if (!kanaele[name]?.an) { ergebnis[name] = 'aus'; continue }
        try {
            // Der Test ignoriert die Mindest-Schwere mit Absicht: wer auf den
            // Knopf drückt, will wissen, ob der Draht steht — nicht, ob eine
            // Info-Meldung durch seinen Filter käme.
            await senden(alarm, fav, kanaele[name], geheim)
            ergebnis[name] = 'ok'
        } catch (e) {
            ergebnis[name] = String(e.message || e).slice(0, 200)
        }
    }
    return ergebnis
}
