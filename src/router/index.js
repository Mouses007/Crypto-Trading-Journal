import { createRouter, createWebHistory } from 'vue-router'
import axios from 'axios'
import DashboardLayout from '../layouts/Dashboard.vue'
import i18n from '../i18n'
import { appMode } from '../stores/globals.js'

const router = createRouter({
    history: createWebHistory(
        import.meta.env.BASE_URL),
    routes: [{
        path: '/',
        // Landing-Page: normalerweise die Startseite. Ist sie in den
        // Einstellungen abgeschaltet (`startseiteAn = 0`), landet man wie früher
        // im Journal. Der Wert wird beim App-Start nach localStorage gespiegelt
        // (siehe useInitApp), damit hier synchron entschieden werden kann.
        redirect: () => (localStorage.getItem('startseiteAn') === '0' ? '/dashboard' : '/startseite'),
    },
    {
        // Startseite: frei konfigurierbares Kachelraster, die Landing-Page der
        // App. Eigener Modus `start` (siehe menu.js) — deshalb lädt das
        // Dashboard-Layout hier KEINE Journal-Daten; die Seite versorgt ihre
        // Journal-Kacheln selbst.
        path: '/startseite',
        name: 'startseite',
        meta: {
            title: "Start", titleKey: "nav.startseite",
            mode: 'start',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Startseite.vue')
    },
    {
        path: '/setup',
        name: 'setup',
        meta: {
            title: "Setup", titleKey: "nav.setup",
            skipSetupCheck: true
        },
        component: () =>
            import('../views/Setup.vue')
    },
    {
        path: '/dashboard',
        name: 'dashboard',
        meta: {
            title: "Dashboard", titleKey: "nav.dashboard",
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Dashboard.vue')
    },
    {
        path: '/accounts',
        name: 'accounts',
        meta: {
            title: "Konten", titleKey: "nav.accounts",
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Accounts.vue')
    },
    {
        path: '/calendar',
        name: 'calendar',
        meta: {
            title: "Calendar", titleKey: "nav.calendar",
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Calendar.vue')
    },
    {
        path: '/daily',
        name: 'daily',
        meta: {
            title: "Daily", titleKey: "nav.dailyView",
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Daily.vue')
    },
    {
        path: '/incoming',
        name: 'incoming',
        meta: {
            title: "Pendente Trades", titleKey: "nav.pendingTrades",
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Incoming.vue')
    },
    {
        path: '/diary',
        redirect: '/incoming'
    },
    {
        path: '/screenshots',
        name: 'screenshots',
        meta: {
            title: "Screenshots", titleKey: "nav.screenshots",
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Screenshots.vue')
    },
    {
        // Lern-Karteikasten: Sitzung und Kartenverwaltung teilen sich eine
        // Route (wie Hype-/Coin-Radar), damit eine laufende Sitzung beim
        // Wechsel zwischen den Menüeinträgen nicht verloren geht.
        path: '/lernen/:reiter?',
        name: 'lernen',
        meta: {
            title: "Lernen", titleKey: "nav.lernen",
            mode: 'lernen',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Lernen.vue')
    },
    {
        path: '/playbook',
        name: 'playbook',
        meta: {
            title: "Playbook", titleKey: "nav.playbook",
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Playbook.vue')
    },
    {
        path: '/auswertung',
        name: 'auswertung',
        meta: {
            title: "Auswertung", titleKey: "nav.evaluation",
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Auswertung.vue')
    },
    {
        // Archiv und Auswertung stehen im Live-Modus unter „Handeln", nicht im
        // Journal: alles zum Live-Trading an einem Ort, ein Weg zu einer Sache.
        path: '/live-sessions',
        name: 'liveSessions',
        meta: {
            title: "Archiv", titleKey: "nav.liveSessions",
            mode: 'live',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/LiveSessions.vue')
    },
    {
        path: '/live-auswertung',
        name: 'liveAuswertung',
        meta: {
            title: "Auswertung", titleKey: "nav.liveAuswertung",
            mode: 'live',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/LiveAuswertung.vue')
    },
    {
        path: '/ki-coach',
        name: 'kiAgent',
        meta: {
            title: "KI-Coach", titleKey: "nav.kiAgent",
            layout: DashboardLayout
        },
        component: () =>
            import('../views/KiAgent.vue')
    },
    {
        path: '/addTrades',
        name: 'addTrades',
        meta: {
            title: "Manueller Trade Import", titleKey: "nav.manualImport",
            layout: DashboardLayout
        },
        component: () =>
            import('../views/AddTrades.vue')

    },
    {
        path: '/addDiary',
        redirect: '/incoming'
    },
    {
        path: '/addPlaybook',
        redirect: '/daily'
    },
    {
        path: '/addScreenshot',
        redirect: '/screenshots'
    },
    {
        path: '/addExcursions',
        name: 'addExcursions',
        meta: {
            title: "Add Excursions", titleKey: "nav.addExcursions",
            layout: DashboardLayout
        },
        component: () =>
            import('../views/AddExcursions.vue')
    },
    {
        path: '/settings',
        name: 'settings',
        meta: {
            title: "Settings", titleKey: "nav.settings",
            // Einstellungen sind aus jedem Modus erreichbar und wechseln ihn nicht
            mode: 'any',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Settings.vue')
    },
    {
        // Live-Analyse: Binance-Orderbuch-Heatmap / Bookmap.
        // `mode` steuert, welches Seitenmenü gerendert wird; alle Routen ohne
        // dieses Feld gelten als 'journal' (siehe beforeEach).
        path: '/liquidity',
        name: 'liquidity',
        meta: {
            title: "Live-Analyse", titleKey: "nav.liquidity",
            mode: 'live',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Liquidity.vue')
    },
    {
        path: '/liquidations',
        name: 'liquidations',
        meta: {
            title: "Liquidationskarte", titleKey: "nav.liquidations",
            mode: 'live',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Liquidations.vue')
    },
    {
        path: '/openinterest',
        name: 'openinterest',
        meta: {
            title: "Open Interest", titleKey: "nav.openInterest",
            mode: 'live',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/OpenInterest.vue')
    },
    {
        // Hype-Radar: was gerade neu gehypt wird — gesammelt, bewertet und
        // hart auf Betrugsmuster gefiltert, bevor es überhaupt angezeigt wird.
        //
        // Der optionale Abschnitt ist der frühere Seiten-Reiter: Übersicht und
        // Berichte stehen jetzt als eigene Einträge im Seitenmenü. Bewusst ein
        // Parameter und keine zweite Route — derselbe Routen-Eintrag heisst,
        // dass die Seite beim Wechsel NICHT neu aufgebaut wird: ein laufender
        // Scan (SSE-Strom) überlebt den Wechsel, die Kandidatentabelle behält
        // Filter und aufgeklappte Zeilen.
        path: '/hype-radar/:reiter?',
        name: 'hypeRadar',
        meta: {
            title: "Hype-Radar", titleKey: "nav.hypeRadar",
            mode: 'research',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/HypeRadar.vue')
    },
    {
        // Coin-Radar: Geschwister des Hype-Radars mit der umgekehrten Frage —
        // nicht „was ist neu", sondern „welcher der handelbaren Coins lässt
        // sich gerade am besten handeln".
        // Abschnitt wie beim Hype-Radar: Rangliste und Verlauf sind
        // Menüeinträge, teilen sich aber einen Routen-Eintrag und damit die
        // geladene Rangliste.
        path: '/coin-radar/:reiter?',
        name: 'coinRadar',
        meta: {
            title: "Coin-Radar", titleKey: "nav.coinRadar",
            mode: 'research',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/CoinRadar.vue')
    },
    {
        // Marktradar: Kachelraster mit Stimmung, Positionierung und eigenen
        // Kennzahlen — der Blick auf die Marktlage, bevor man in die Tiefe geht.
        path: '/marktradar',
        name: 'marktradar',
        meta: {
            title: "Marktradar", titleKey: "nav.marktradar",
            mode: 'live',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Marktradar.vue')
    },
    {
        // Live-Trading-Fenster: der Arbeitsplatz für die Stunden, in denen
        // tatsächlich gehandelt wird. Eigenes Kachelraster mit eigenem Layout,
        // damit der Marktradar seine Übersicht behält.
        //
        // Abschaltbar über `livetradingAn`. Die Prüfung sitzt in der Seite und
        // NICHT hier: beim ersten Aufruf eines Deep-Links sind die
        // Einstellungen unter Umständen noch nicht geladen, und ein
        // Router-Guard würde dann fälschlich umleiten.
        path: '/livetrading',
        name: 'livetrading',
        meta: {
            title: "Live-Trading", titleKey: "nav.livetrading",
            mode: 'live',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Livetrading.vue')
    },
    {
        // Nachrichten: Lagebericht, Wirtschaftskalender und Beiträge. Bewusst
        // eine eigene Seite — Text liest man anders als Zahlen, und der
        // Wirtschaftskalender ist eine Nachricht mit Datum, keine Kennzahl.
        path: '/nachrichten',
        name: 'nachrichten',
        meta: {
            title: "Nachrichten", titleKey: "nav.nachrichten",
            mode: 'live',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Nachrichten.vue')
    },
    {
        path: '/agent/strategies',
        name: 'agentStrategies',
        meta: {
            title: "Strategien", titleKey: "nav.agentStrategies",
            mode: 'agent',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/AgentStrategies.vue')
    },
    {
        path: '/agent/setups',
        name: 'agentSetups',
        meta: {
            title: "Setups", titleKey: "nav.agentSetups",
            mode: 'agent',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/AgentSetups.vue')
    },
    {
        path: '/agent/performance',
        name: 'agentPerformance',
        meta: {
            title: "Agent-Auswertung", titleKey: "nav.agentPerformance",
            mode: 'agent',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/AgentPerformance.vue')
    },
    {
        path: '/agent/editor',
        name: 'agentEditor',
        meta: {
            title: "Strategie-Editor", titleKey: "nav.agentEditor",
            mode: 'agent',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/AgentEditor.vue')
    },
    {
        path: '/agent/builder',
        name: 'agentBuilder',
        meta: {
            title: "Neue Strategie", titleKey: "nav.agentBuilder",
            mode: 'agent',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/AgentBuilder.vue')
    },
    {
        path: '/agent/lab',
        name: 'agentLab',
        meta: {
            title: "Labor", titleKey: "nav.agentLab",
            mode: 'agent',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/AgentLab.vue')
    },
    {
        path: '/agent/rangliste',
        name: 'coinRangliste',
        meta: {
            title: "Coin-Rangliste", titleKey: "nav.coinRangliste",
            mode: 'agent',
            layout: DashboardLayout
        },
        component: () =>
            import('../views/CoinRangliste.vue')
    },
    {
        path: '/imports',
        redirect: '/settings'
    }
    ]
})

// Cache fuer Setup-Status (wird einmal geladen)
let setupChecked = false
let setupComplete = false

router.beforeEach(async (to, from, next) => {
    if (to.meta.titleKey) {
        document.title = i18n.global.t(to.meta.titleKey)
    } else if (to.meta.title) {
        document.title = to.meta.title
    }

    // Setup-Seite selbst braucht keinen Check
    if (to.meta.skipSetupCheck) {
        return next()
    }

    // Setup-Status pruefen (nur einmal pro Session)
    if (!setupChecked) {
        try {
            const { data } = await axios.get('/api/setup/status')
            setupComplete = !!data.setupComplete
        } catch (e) {
            // Bei Fehler Setup ueberspringen (z.B. alter Server ohne Endpoint)
            setupComplete = true
        }
        setupChecked = true
    }

    // Zum Setup weiterleiten wenn nicht abgeschlossen
    if (!setupComplete) {
        return next('/setup')
    }

    // Die Route bestimmt den Modus, nicht umgekehrt: ein Deep-Link auf
    // /liquidity schaltet still auf 'live' um, damit das Seitenmenü schon beim
    // ersten Paint stimmt. Routen ohne meta.mode gehören zum Journal.
    const wantedMode = to.meta.mode === 'any' ? appMode.value : (to.meta.mode || 'journal')
    if (appMode.value !== wantedMode) {
        appMode.value = wantedMode
        localStorage.setItem('appMode', wantedMode)
    }

    next()
})

export default router
