import { createRouter, createWebHistory } from 'vue-router'
import axios from 'axios'
import DashboardLayout from '../layouts/Dashboard.vue'
import i18n from '../i18n'

const router = createRouter({
    history: createWebHistory(
        import.meta.env.BASE_URL),
    routes: [{
        path: '/',
        redirect: '/dashboard'
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
        path: '/ki-agent',
        name: 'kiAgent',
        meta: {
            title: "KI-Agent", titleKey: "nav.kiAgent",
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
            layout: DashboardLayout
        },
        component: () =>
            import('../views/Settings.vue')
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

    next()
})

export default router
