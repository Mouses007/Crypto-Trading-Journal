/**
 * Zentrale Seiten- und Modus-Registry.
 *
 * Reines Datenmodul (keine Vue-Abhängigkeit) — wird von Nav.vue (Seitentitel/Icon),
 * SideMenu.vue (Live-Menü) und dem ModeSwitcher genutzt.
 *
 * `id` === route.name === pageId. `group: null` heisst: Seite existiert, taucht
 * aber nicht als Menüeintrag auf (Konten hat eine eigene Pille, /setup und
 * /imports sind Sonderfälle).
 */

export const PAGES = [
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
    { id: 'liquidity', mode: 'live', path: '/liquidity', icon: 'uil uil-chart-line', titleKey: 'nav.liquidity', group: 'liveAnalyze' },
    { id: 'liquidations', mode: 'live', path: '/liquidations', icon: 'uil uil-fire', titleKey: 'nav.liquidations', group: 'liveAnalyze' },
    { id: 'openinterest', mode: 'live', path: '/openinterest', icon: 'uil uil-layer-group', titleKey: 'nav.openInterest', group: 'liveAnalyze' },

    // ── Agent-Trading ───────────────────────────────────────
    { id: 'agentStrategies', mode: 'agent', path: '/agent/strategies', icon: 'uil uil-processor', titleKey: 'nav.agentStrategies', group: 'agentRun' },
    { id: 'agentSetups', mode: 'agent', path: '/agent/setups', icon: 'uil uil-crosshairs', titleKey: 'nav.agentSetups', group: 'agentRun' },
    { id: 'agentEditor', mode: 'agent', path: '/agent/editor', icon: 'uil uil-cube', titleKey: 'nav.agentEditor', group: 'agentBuild' },
    { id: 'agentBuilder', mode: 'agent', path: '/agent/builder', icon: 'uil uil-file-alt', titleKey: 'nav.agentBuilder', group: 'agentBuild' },
    { id: 'agentPerformance', mode: 'agent', path: '/agent/performance', icon: 'uil uil-chart-pie', titleKey: 'nav.agentPerformance', group: 'agentReview' },
    { id: 'agentLab', mode: 'agent', path: '/agent/lab', icon: 'uil uil-flask', titleKey: 'nav.agentLab', group: 'agentReview' },

    // ── modusübergreifend ───────────────────────────────────
    { id: 'settings', mode: null, path: '/settings', icon: 'uil uil-sliders-v-alt', titleKey: 'nav.settings', group: null },
]

/**
 * Top-Level-Modi. `home` = Startseite beim Umschalten.
 * `enabled: false` → Button sichtbar, aber deaktiviert.
 */
export const MODES = [
    { id: 'journal', titleKey: 'modes.journal', icon: 'uil uil-book-alt', home: '/dashboard', enabled: true },
    { id: 'live', titleKey: 'modes.live', icon: 'uil uil-chart-line', home: '/liquidity', enabled: true },
    // Freigegeben als Beta. Der Modus handelt selbstständig, deshalb warnt
    // `BetaHinweis.vue` auf jeder seiner Seiten, und der scharfe Betrieb hängt
    // zusätzlich an der dreifachen Freigabekette (globaler Schalter, Freigabe je
    // Instanz, Mindestzahl Papier-Trades).
    { id: 'agent', titleKey: 'modes.agent', icon: 'uil uil-robot', home: '/agent/strategies', enabled: true, beta: true },
]

export const pageById = (id) => PAGES.find(p => p.id === id) || null

export const pagesForMode = (mode) => PAGES.filter(p => p.mode === mode && p.group)

export const modeHome = (mode) => MODES.find(m => m.id === mode)?.home || '/dashboard'
