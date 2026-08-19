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

async function post(url, { kopf = {}, body }) {
    const abbruch = new AbortController()
    const uhr = setTimeout(() => abbruch.abort(), ABRUF_TIMEOUT_MS)
    try {
        const r = await fetch(url, { method: 'POST', headers: kopf, body, signal: abbruch.signal })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
    } finally {
        clearTimeout(uhr)
    }
}

/**
 * ntfy: POST an <url>/<topic>, Priorität aus der Schwere.
 * Kritisches klingelt (urgent), Informatives bleibt still einsortiert.
 */
async function ntfy(alarm, fav, kanal, geheim) {
    const basis = String(kanal.url || '').replace(/\/+$/, '')
    const topic = String(kanal.topic || 'hype-radar').trim()
    if (!basis) throw new Error('keine ntfy-Adresse hinterlegt')
    const prioritaet = { kritisch: '5', warnung: '4', info: '3' }[alarm.schwere] || '3'
    await post(`${basis}/${encodeURIComponent(topic)}`, {
        kopf: {
            Title: `${fav.symbol} (${alarm.regel})`,
            Priority: prioritaet,
            Tags: alarm.schwere === 'kritisch' ? 'rotating_light' : 'chart_with_downwards_trend',
            ...(geheim.ntfyToken ? { Authorization: `Bearer ${geheim.ntfyToken}` } : {}),
        },
        body: alarm.meldung,
    })
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
