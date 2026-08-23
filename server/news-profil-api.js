/**
 * News-Profile: benannte Sammlungen aller Nachrichten-Einstellungen.
 *
 * Ein Profil schnappt beim Anlegen die gerade LIVE stehenden Werte ein
 * (`NEWS_PROFIL_FELDER` aus `settings` plus `enabled`/`laerm` je Quelle aus
 * `news_sources`) — der Client schickt nur den Namen, nie die Feldwerte
 * selbst. Das Anwenden schreibt genau diese Werte zurück, direkt per Knex
 * statt über die generische `/api/db/settings`-Route: die macht ausser dem
 * Whitelist-Filter und einem `updatedAt`-Stempel nichts, das hier fehlen
 * dürfte (keine Cache-Invalidierung, keine Cron-Neuregistrierung) — der
 * News-Takt liest die Settings-Zeile ohnehin bei jedem Tick frisch.
 */

import { getKnex } from './database.js'
import { logWarn } from './logger.js'
import { NEWS_PROFIL_FELDER } from './news-profil-felder.js'

function sicherParse(text, rueckfall) {
    try {
        const j = JSON.parse(text)
        return j ?? rueckfall
    } catch {
        return rueckfall
    }
}

/** Die Felder + Quellen, wie sie gerade LIVE stehen — Grundlage für Anlegen und Aktualisieren. */
async function schnappeAktuellesEin(knex) {
    const zeile = await knex('settings').where('id', 1).first()
    const einstellungen = {}
    for (const feld of NEWS_PROFIL_FELDER) einstellungen[feld] = zeile?.[feld] ?? null

    const quellenZeilen = await knex('news_sources').select('id', 'name', 'enabled', 'laerm')
    const quellen = {}
    // `name` steht nur für die "fehlende Quellen"-Meldung mit im Snapshot —
    // beim Anwenden zieht ausschliesslich die id, der Name ist reine Anzeige.
    for (const q of quellenZeilen) quellen[q.id] = { name: q.name, enabled: q.enabled, laerm: q.laerm }

    return { einstellungen, quellen }
}

export function setupNewsProfilRoutes(app) {
    app.get('/api/marktradar/news-profile', async (req, res) => {
        try {
            const zeilen = await getKnex()('news_profile')
                .select('id', 'name', 'erstelltAm', 'aktualisiertAm')
                .orderBy('name', 'asc')
            res.json(zeilen)
        } catch (e) {
            logWarn('news-profil', `Liste lesen: ${e.message}`)
            res.status(500).json({ error: 'Profile konnten nicht geladen werden' })
        }
    })

    app.post('/api/marktradar/news-profile', async (req, res) => {
        try {
            const name = String(req.body?.name || '').trim()
            if (!name) return res.status(400).json({ error: 'Name fehlt' })

            const knex = getKnex()
            const { einstellungen, quellen } = await schnappeAktuellesEin(knex)
            const jetzt = Date.now()
            const isPg = knex.client.config.client === 'pg'
            const datensatz = {
                name,
                einstellungen: JSON.stringify(einstellungen),
                quellen: JSON.stringify(quellen),
                erstelltAm: jetzt,
                aktualisiertAm: jetzt,
            }
            const id = isPg
                ? (await knex('news_profile').insert(datensatz).returning('id'))[0]?.id
                : (await knex('news_profile').insert(datensatz))[0]
            res.status(201).json({ id, name, erstelltAm: jetzt, aktualisiertAm: jetzt })
        } catch (e) {
            logWarn('news-profil', `Anlegen: ${e.message}`)
            res.status(500).json({ error: 'Profil konnte nicht angelegt werden' })
        }
    })

    app.put('/api/marktradar/news-profile/:id', async (req, res) => {
        try {
            const knex = getKnex()
            const vorhanden = await knex('news_profile').where('id', req.params.id).first()
            if (!vorhanden) return res.status(404).json({ error: 'Profil nicht gefunden' })

            const aktualisierung = { aktualisiertAm: Date.now() }
            if (req.body?.name !== undefined) {
                const name = String(req.body.name || '').trim()
                if (!name) return res.status(400).json({ error: 'Name fehlt' })
                aktualisierung.name = name
            }
            if (req.body?.uebernehmen) {
                const { einstellungen, quellen } = await schnappeAktuellesEin(knex)
                aktualisierung.einstellungen = JSON.stringify(einstellungen)
                aktualisierung.quellen = JSON.stringify(quellen)
            }
            await knex('news_profile').where('id', req.params.id).update(aktualisierung)
            const zeile = await knex('news_profile').where('id', req.params.id).first()
            res.json({ id: zeile.id, name: zeile.name, erstelltAm: zeile.erstelltAm, aktualisiertAm: zeile.aktualisiertAm })
        } catch (e) {
            logWarn('news-profil', `Ändern: ${e.message}`)
            res.status(500).json({ error: 'Profil konnte nicht geändert werden' })
        }
    })

    app.delete('/api/marktradar/news-profile/:id', async (req, res) => {
        try {
            const knex = getKnex()
            const id = Number(req.params.id)
            await knex('news_profile').where('id', id).delete()
            /*
             * War es das gerade aktive Profil, muss die Referenz mit weg —
             * sonst zeigt `radarNewsAktivesProfil` auf eine Zeile, die es
             * nicht mehr gibt, und das Dropdown auf der Nachrichten-Seite
             * bliebe auf einer Geister-Auswahl stehen.
             */
            await knex('settings').where('id', 1).andWhere('radarNewsAktivesProfil', id)
                .update({ radarNewsAktivesProfil: 0 })
            res.json({ ok: true })
        } catch (e) {
            logWarn('news-profil', `Löschen: ${e.message}`)
            res.status(500).json({ error: 'Profil konnte nicht gelöscht werden' })
        }
    })

    /*
     * Mail-Empfänger und Modellwahl sind die zwei Feldgruppen, bei denen ein
     * stiller Wechsel überraschen würde — ein Profilwechsel "nur für heute
     * weniger Rauschen" soll nicht nebenbei die Mailadresse tauschen, ohne
     * dass es auffällt. `geaendert` macht das für die Oberfläche sichtbar,
     * ohne den Schreibvorgang selbst zu blockieren.
     */
    const AUFFAELLIGE_FELDER = new Set([
        'radarNewsMailAktiv', 'radarNewsMailAn', 'radarNewsMailVoll',
        'radarNewsModel', 'radarNewsXModell', 'radarNewsRechercheModell',
        'radarNewsBerichtProvider', 'radarNewsBerichtModell',
    ])

    app.post('/api/marktradar/news-profile/:id/anwenden', async (req, res) => {
        try {
            const knex = getKnex()
            const profil = await knex('news_profile').where('id', req.params.id).first()
            if (!profil) return res.status(404).json({ error: 'Profil nicht gefunden' })

            const einstellungen = sicherParse(profil.einstellungen, {})
            const quellen = sicherParse(profil.quellen, {})
            const vorher = await knex('settings').where('id', 1).first()

            const schreibbar = {}
            for (const feld of NEWS_PROFIL_FELDER) {
                if (einstellungen[feld] !== undefined && einstellungen[feld] !== null) schreibbar[feld] = einstellungen[feld]
            }
            schreibbar.radarNewsAktivesProfil = profil.id
            await knex('settings').where('id', 1).update(schreibbar)

            const geaendert = {}
            for (const feld of Object.keys(schreibbar)) {
                if (feld === 'radarNewsAktivesProfil') continue
                if (String(vorher?.[feld] ?? '') !== String(schreibbar[feld] ?? '') && AUFFAELLIGE_FELDER.has(feld)) {
                    geaendert[feld] = { von: vorher?.[feld] ?? null, nach: schreibbar[feld] }
                }
            }

            const quellenIds = (await knex('news_sources').select('id', 'name')).reduce((m, q) => (m.set(q.id, q.name), m), new Map())
            const fehlendeQuellen = []
            for (const [id, werte] of Object.entries(quellen)) {
                if (!quellenIds.has(Number(id))) { fehlendeQuellen.push(werte.name || `#${id}`); continue }
                await knex('news_sources').where('id', Number(id))
                    .update({ enabled: werte.enabled ? 1 : 0, laerm: werte.laerm ? 1 : 0, updatedAt: Date.now() })
            }

            res.json({ ok: true, geaendert, fehlendeQuellen })
        } catch (e) {
            logWarn('news-profil', `Anwenden: ${e.message}`)
            res.status(500).json({ error: 'Profil konnte nicht angewendet werden' })
        }
    })
}
