/**
 * Die sechs Kombinationen aus Modus und Profil — mit Preis und Rangfolge.
 *
 * Warum das als eigene Tabelle existiert: Die Wahl „welches Modell schreibt
 * meinen Bericht" ist für den Nutzer keine Modellwahl, sondern eine Abwägung
 * zwischen Kosten und Tiefe. Rollen einzeln zu belegen setzt voraus, dass man
 * die Anbieterlandschaft kennt. Sechs benannte Stufen mit Preisschild setzen
 * das nicht voraus.
 *
 * Die Beträge sind Schätzungen für einen Lauf mit sieben Kandidaten, gerechnet
 * aus den Listenpreisen in `ai-preise.js` (Stand August 2026). Was ein Lauf
 * wirklich gekostet hat, steht hinterher in `ai_usage` — die Oberfläche zeigt
 * beides nebeneinander, damit die Schätzung überprüfbar bleibt.
 *
 * Zwei Muster, die aus den Zahlen folgen und im Hilfetext stehen sollten:
 *   - „Gründlich" schlägt „Einfach" bei gleichem Profil in der Tiefe UND ist
 *     oft billiger, weil jeder Recherche-Aufruf einen kurzen Auftrag hat statt
 *     eines langen Sammelkontexts.
 *   - „Einfach + teuer" ist die schlechteste Wahl von allen: der höchste Preis
 *     bei nur mittlerer Tiefe.
 */

/**
 * Die zwei Rollen.
 *
 * `research` pro Kandidat eine Web-Recherche — Zuverlässigkeit zählt
 * `editor`  schreibt den Bericht; hier entsteht die Qualität
 *
 * Es gab eine dritte, `helper`, gedacht für Entdopplung und Zuordnung. Sie ist
 * am 19.08.2026 entfernt worden, weil sie nie gerufen wurde: Diese Arbeit
 * erledigt `fuehreZusammen` deterministisch — nachrechenbar, kostenlos und
 * ohne Lauf-zu-Lauf-Schwankung. Ein Sprachmodell wäre dafür die schlechtere
 * Lösung gewesen.
 *
 * Stehen bleiben durfte sie trotzdem nicht: `benoetigteAnbieter` verlangte
 * einen Schlüssel für sie, und ein fehlender DeepSeek-Schlüssel blockierte
 * damit manuelle wie automatische Berichte — für eine Rolle, die nichts tut.
 * Zusätzlich bot die Oberfläche eine Modellwahl dafür an, die folgenlos blieb.
 */
export const ROLLEN = ['research', 'editor']

/**
 * Belegung je Profil.
 *
 * Ollama fehlt in allen Presets mit Absicht: was ein lokal betriebenes Modell
 * leistet, hängt von der Maschine ab und lässt sich nicht zusichern. Ein
 * Preset muss verlässlich sein — wer Ollama will, wählt „manuell".
 */
export const PROFILE = {
    guenstig: {
        research: { provider: 'deepseek', modell: 'deepseek-v4-flash' },
        editor: { provider: 'deepseek', modell: 'deepseek-v4-pro' },
    },
    mittel: {
        research: { provider: 'moonshot', modell: 'kimi-k2.6' },
        editor: { provider: 'anthropic', modell: 'claude-sonnet-5' },
    },
    teuer: {
        research: { provider: 'zai', modell: 'glm-5.2' },
        editor: { provider: 'anthropic', modell: 'claude-opus-5' },
    },
}

/**
 * Die sechs Stufen.
 *
 * `preisRang` 1 = billigste, `guteRang` 1 = beste. Dass die beiden Ordnungen
 * nicht gegenläufig sind, ist der eigentliche Inhalt dieser Tabelle: die
 * zweitbeste Stufe ist erst die dritt-teuerste.
 */
export const STUFEN = [
    {
        id: 'einfach-guenstig', modus: 'einfach', profil: 'guenstig',
        preisRang: 1, guteRang: 6,
        usdProLauf: [0.05, 0.10], usdProMonat: [2, 3],
    },
    {
        id: 'gruendlich-guenstig', modus: 'gruendlich', profil: 'guenstig',
        preisRang: 2, guteRang: 5,
        usdProLauf: [0.08, 0.15], usdProMonat: [3, 5],
    },
    {
        id: 'gruendlich-mittel', modus: 'gruendlich', profil: 'mittel',
        preisRang: 3, guteRang: 2, empfohlen: true,
        usdProLauf: [0.25, 0.40], usdProMonat: [8, 12],
    },
    {
        id: 'einfach-mittel', modus: 'einfach', profil: 'mittel',
        preisRang: 4, guteRang: 4,
        usdProLauf: [0.40, 0.60], usdProMonat: [12, 18],
    },
    {
        id: 'gruendlich-teuer', modus: 'gruendlich', profil: 'teuer',
        preisRang: 5, guteRang: 1,
        usdProLauf: [0.80, 1.20], usdProMonat: [25, 35],
    },
    {
        id: 'einfach-teuer', modus: 'einfach', profil: 'teuer',
        preisRang: 6, guteRang: 3,
        usdProLauf: [1.50, 2.50], usdProMonat: [45, 75],
    },
]

/** Stufen sortiert — nach Preis oder nach Güte. */
export function stufenNach(ordnung = 'preis') {
    const feld = ordnung === 'guete' ? 'guteRang' : 'preisRang'
    return [...STUFEN].sort((a, b) => a[feld] - b[feld])
        .map((s) => ({ ...s, rollen: PROFILE[s.profil] }))
}

/** Eine Stufe samt Rollenbelegung. */
export function stufe(id) {
    const s = STUFEN.find((x) => x.id === id)
    if (!s) return null
    return { ...s, rollen: PROFILE[s.profil] }
}

/**
 * Welcher Anbieter bedient eine Rolle.
 *
 * Reihenfolge: was ausdrücklich für die Rolle eingestellt ist, schlägt die
 * Stufe. So bleibt „manuell" möglich, ohne dass die Stufenlogik davon weiss.
 */
export function rollenAnbieter(einstellungen, rolle) {
    const eigen = einstellungen?.llmRollen?.[rolle]
    if (eigen?.provider) return { provider: eigen.provider, modell: eigen.modell || '' }
    const s = stufe(einstellungen?.llmStufe || 'gruendlich-mittel')
    return s ? s.rollen[rolle] : PROFILE.mittel[rolle]
}

/**
 * Welche Anbieter braucht eine Einstellung — für die Schlüsselprüfung.
 *
 * Die Oberfläche blockiert den Start, wenn einer davon keinen Schlüssel hat.
 * Ein stiller Ausweichanbieter wäre schlimmer: der Nutzer wundert sich später
 * über Qualität oder Kosten und findet den Grund nicht.
 */
export function benoetigteAnbieter(einstellungen) {
    const modus = einstellungen?.llmModus
        || stufe(einstellungen?.llmStufe || 'gruendlich-mittel')?.modus
        || 'gruendlich'
    // Im einfachen Modus recherchiert und schreibt dasselbe Modell.
    const rollen = modus === 'einfach' ? ['editor'] : ROLLEN
    return [...new Set(rollen.map((r) => rollenAnbieter(einstellungen, r).provider).filter(Boolean))]
}
