/**
 * Zentrale Seiten- und Modus-Registry.
 *
 * Reines Datenmodul (keine Vue-Abhängigkeit) — wird von Nav.vue (Seitentitel/Icon),
 * SideMenu.vue (Live-Menü) und dem ModeSwitcher genutzt.
 *
 * `id` === route.name === pageId. `group: null` heisst: Seite existiert, taucht
 * aber nicht als Menüeintrag auf (Konten hat eine eigene Pille, /setup und
 * /imports sind Sonderfälle).
 *
 * `flag` nennt eine Einstellungsspalte, die die Seite ein- und ausschaltet.
 * Fehlt das Feld, ist die Seite immer da. Bewusst nur ein Spaltenname und kein
 * Vorgang: dieses Modul bleibt frei von Vue und von Datenbankwissen — wer die
 * Liste rendert, schlägt den Wert in den Einstellungen nach.
 *
 * `nurDesktop` blendet die Seite auf Telefonen aus. Kein Geschmacksurteil,
 * sondern eine Platzfrage: ein Arbeitsplatz aus elf Kacheln, Orderbuch und
 * Kerzenchart lässt sich auf 375 Pixeln nicht bedienen, und ein Werkzeug, das
 * dort nur halb funktioniert, ist schlimmer als eines, das gar nicht erscheint.
 */

export const PAGES = [
    // ── Start ───────────────────────────────────────────────
    // Landing-Page der App, eigener Modus. `group: null` → kein Seitenmenü-
    // Eintrag: die Kacheln sind die Navigation. Der Eintrag existiert trotzdem,
    // damit Nav.vue Titel und Icon der Seite findet.
    { id: 'startseite', mode: 'start', path: '/startseite', icon: 'uil uil-estate', titleKey: 'nav.startseite', group: null },

    // ── Journal ─────────────────────────────────────────────
    { id: 'dashboard', mode: 'journal', path: '/dashboard', icon: 'uil uil-apps', titleKey: 'nav.dashboard', group: 'analyze' },
    { id: 'daily', mode: 'journal', path: '/daily', icon: 'uil uil-signal-alt-3', titleKey: 'nav.dailyView', group: 'analyze' },
    { id: 'calendar', mode: 'journal', path: '/calendar', icon: 'uil uil-calendar-alt', titleKey: 'nav.calendar', group: 'analyze' },
    { id: 'playbook', mode: 'journal', path: '/playbook', icon: 'uil uil-compass', titleKey: 'nav.playbook', group: 'reflect' },
    { id: 'auswertung', mode: 'journal', path: '/auswertung', icon: 'uil uil-chart-pie', titleKey: 'nav.evaluation', group: 'reflect' },
    { id: 'kiAgent', mode: 'journal', path: '/ki-coach', icon: 'uil uil-robot', titleKey: 'nav.kiAgent', group: 'reflect' },
    { id: 'screenshots', mode: 'journal', path: '/screenshots', icon: 'uil uil-image-v', titleKey: 'nav.screenshots', group: 'reflect' },
    { id: 'incoming', mode: 'journal', path: '/incoming', icon: 'uil uil-arrow-circle-down', titleKey: 'nav.pendingTrades', group: 'add' },
    { id: 'addTrades', mode: 'journal', path: '/addTrades', icon: 'uil uil-plus-circle', titleKey: 'nav.manualImport', group: 'add' },
    { id: 'accounts', mode: 'journal', path: '/accounts', icon: 'uil uil-wallet', titleKey: 'nav.accounts', group: null },
    { id: 'addExcursions', mode: 'journal', path: '/addExcursions', icon: 'uil uil-refresh', titleKey: 'nav.addExcursions', group: null },
    { id: 'setup', mode: 'journal', path: '/setup', icon: 'uil uil-rocket', titleKey: 'nav.setup', group: null },

    // ── Live-Analyse ────────────────────────────────────────
    // Reihenfolge nach Nutzerwunsch: vom Überblick ins Detail. Der Marktradar
    // steht vorn und ist zugleich die Startseite des Modus (siehe MODES unten) —
    // er beantwortet in einem Blick, in welcher Lage man sitzt. Danach die
    // Nachrichten, dann die Werkzeuge, die einen einzelnen Markt sezieren.
    { id: 'marktradar', mode: 'live', path: '/marktradar', icon: 'uil uil-dashboard', titleKey: 'nav.marktradar', group: 'liveAnalyze' },
    { id: 'nachrichten', mode: 'live', path: '/nachrichten', icon: 'uil uil-newspaper', titleKey: 'nav.nachrichten', group: 'liveAnalyze' },
    { id: 'openinterest', mode: 'live', path: '/openinterest', icon: 'uil uil-layer-group', titleKey: 'nav.openInterest', group: 'liveAnalyze' },
    { id: 'liquidity', mode: 'live', path: '/liquidity', icon: 'uil uil-chart-line', titleKey: 'nav.liquidity', group: 'liveAnalyze' },
    { id: 'liquidations', mode: 'live', path: '/liquidations', icon: 'uil uil-fire', titleKey: 'nav.liquidations', group: 'liveAnalyze' },
    // Eigene Gruppe, weil Handeln etwas anderes ist als Analysieren: die
    // Seiten darüber beantworten „wie steht der Markt", diese hier begleitet
    // die Stunden, in denen man tatsächlich Geld riskiert.
    // `mobilFlag`: Nur-Desktop-Sperre lässt sich per Einstellung fürs Telefon
    // aufheben (Layout & Stil → „Live-Trading auf dem Handy").
    { id: 'livetrading', mode: 'live', path: '/livetrading', icon: 'uil uil-crosshairs', titleKey: 'nav.livetrading', group: 'liveTrade', flag: 'livetradingAn', nurDesktop: true, mobilFlag: 'livetradingMobil' },
    // Archiv und Auswertung sind bewusst NICHT `nurDesktop`: nachlesen und
    // auswerten geht am Telefon, nur das Handeln selbst braucht Platz.
    { id: 'liveSessions', mode: 'live', path: '/live-sessions', icon: 'uil uil-history', titleKey: 'nav.liveSessions', group: 'liveTrade', flag: 'livetradingAn' },
    { id: 'liveAuswertung', mode: 'live', path: '/live-auswertung', icon: 'uil uil-chart-pie', titleKey: 'nav.liveAuswertung', group: 'liveTrade', flag: 'livetradingAn' },

    // ── Entdecken ───────────────────────────────────────────
    // Der Quadrant und die Kandidatentabelle brauchen Breite: beide leben
    // davon, viele Punkte nebeneinander zu zeigen. Auf 375 px bliebe ein
    // Diagramm übrig, aus dem sich nichts ablesen lässt.
    { id: 'hypeRadar', mode: 'research', path: '/hype-radar', icon: 'uil uil-telescope', titleKey: 'nav.hypeRadar', group: 'discover', nurDesktop: true },

    // ── Agent-Trading ───────────────────────────────────────
    { id: 'agentStrategies', mode: 'agent', path: '/agent/strategies', icon: 'uil uil-processor', titleKey: 'nav.agentStrategies', group: 'agentRun' },
    { id: 'agentSetups', mode: 'agent', path: '/agent/setups', icon: 'uil uil-crosshairs', titleKey: 'nav.agentSetups', group: 'agentRun' },
    { id: 'agentEditor', mode: 'agent', path: '/agent/editor', icon: 'uil uil-cube', titleKey: 'nav.agentEditor', group: 'agentBuild' },
    { id: 'agentBuilder', mode: 'agent', path: '/agent/builder', icon: 'uil uil-file-alt', titleKey: 'nav.agentBuilder', group: 'agentBuild' },
    { id: 'agentPerformance', mode: 'agent', path: '/agent/performance', icon: 'uil uil-chart-pie', titleKey: 'nav.agentPerformance', group: 'agentReview' },
    { id: 'agentLab', mode: 'agent', path: '/agent/lab', icon: 'uil uil-flask', titleKey: 'nav.agentLab', group: 'agentReview' },
    // Die Coin-Rangliste ist eine Auswertung, kein Labor: sie testet eine
    // fertige Strategie gegen viele Münzen, statt an ihr zu schrauben.
    { id: 'coinRangliste', mode: 'agent', path: '/agent/rangliste', icon: 'uil uil-list-ol-alt', titleKey: 'nav.coinRangliste', group: 'agentReview' },

    // ── modusübergreifend ───────────────────────────────────
    { id: 'settings', mode: null, path: '/settings', icon: 'uil uil-sliders-v-alt', titleKey: 'nav.settings', group: null },
]

/**
 * Top-Level-Modi. `home` = Startseite beim Umschalten.
 * `enabled: false` → Button sichtbar, aber deaktiviert.
 */
/**
 * `shortKey` ist das Label im Umschalter: die Tabs sind bei fünf Modi nur
 * ~45px breit, „Live-Analyse" und „Strategien" passen dort nicht mehr rein.
 * Ohne shortKey gilt titleKey.
 */
// `versteckbar: true` → wird von der Einstellung „Beta-Funktionen ausblenden"
// (Layout & Stil) aus dem Umschalter entfernt. Momentan Strategien und Research.
export const MODES = [
    // Landing-Page der App: frei konfigurierbares Kachelraster (Kontostand,
    // Marktlage, News-Zusammenfassung …).
    { id: 'start', titleKey: 'modes.start', icon: 'uil uil-estate', home: '/startseite', enabled: true },
    { id: 'journal', titleKey: 'modes.journal', icon: 'uil uil-book-alt', home: '/dashboard', enabled: true },
    { id: 'live', titleKey: 'modes.live', shortKey: 'modes.liveShort', icon: 'uil uil-chart-line', home: '/marktradar', enabled: true },
    // Freigegeben als Beta. Der Modus handelt selbstständig, deshalb warnt
    // `BetaHinweis.vue` auf jeder seiner Seiten, und der scharfe Betrieb hängt
    // zusätzlich an der dreifachen Freigabekette (globaler Schalter, Freigabe je
    // Instanz, Mindestzahl Papier-Trades).
    { id: 'agent', titleKey: 'modes.agent', shortKey: 'modes.agentShort', icon: 'uil uil-robot', home: '/agent/strategies', enabled: true, beta: true, versteckbar: true },
    /*
     * Entdecken: was es noch nicht ins Journal geschafft hat. Bislang ein
     * Platzhalter, jetzt vom Hype-Radar bewohnt. Bleibt versteckbar — wer nur
     * sein Journal führt, braucht den Modus nicht.
     */
    { id: 'research', titleKey: 'modes.research', icon: 'uil uil-telescope', home: '/hype-radar', enabled: true, versteckbar: true },
]

export const pageById = (id) => PAGES.find(p => p.id === id) || null

export const pagesForMode = (mode) => PAGES.filter(p => p.mode === mode && p.group)

export const modeHome = (mode) => MODES.find(m => m.id === mode)?.home || '/dashboard'
