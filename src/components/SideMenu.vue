<script setup>
import { ref } from 'vue'
import { pageId, screenType } from "../stores/ui.js"
import { currentUser } from "../stores/settings.js"

const appVersion = __APP_VERSION__
import { useToggleMobileMenu } from "../utils/utils";
import { useQuickApiImport } from "../utils/quickImport";
import { sendNotification } from "../utils/notify";

const apiImporting = ref(false)
const apiImportResult = ref(null) // { success, message }

function goToDashboard() {
    if (screenType.value === 'mobile') {
        useToggleMobileMenu()
    } else {
        window.location.href = '/dashboard'
    }
}

async function quickApiImport() {
    if (apiImporting.value) return
    apiImporting.value = true
    apiImportResult.value = null

    try {
        const result = await useQuickApiImport()
        apiImportResult.value = result
        sendNotification('API-Import abgeschlossen', result.message || 'Import fertig.')
    } catch (error) {
        apiImportResult.value = { success: false, message: error.response?.data?.error || error.message || 'Import fehlgeschlagen' }
        sendNotification('API-Import fehlgeschlagen', apiImportResult.value.message)
    }

    apiImporting.value = false

    // Auto-hide message after 5 seconds
    setTimeout(() => {
        apiImportResult.value = null
    }, 5000)
}

</script>

<template>
    <div class="col-2 logoDiv">
        <a class="logo-area pointerClass text-decoration-none" href="/dashboard" @click.prevent="goToDashboard">
            <div class="d-flex align-items-center">
                <span v-if="currentUser?.avatar"><img class="logoProfileImg me-2" v-bind:src="currentUser.avatar" /></span>
                <span v-else><img class="logoProfileImg me-2" src="../assets/icon.png" /></span>
                <div class="logo-text">
                    <div class="logo-title">Trading Journal</div>
                    <div v-if="currentUser?.username" class="logo-username">{{ currentUser.username }}</div>
                </div>
            </div>
        </a>
    </div>
    <div id="step2" class="mt-3">
        <div class="sideMenuDiv">
            <div class="sideMenuDivContent">
                <label class="fw-lighter">ANALYSIEREN</label>
                <a id="step3" v-bind:class="[pageId === 'dashboard' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/dashboard">
                    <i class="uil uil-apps me-2"></i>Dashboard</a>
                <a id="step4" v-bind:class="[pageId === 'daily' ? 'activeNavCss' : '', 'nav-link', 'mb-2']" href="/daily">
                    <i class="uil uil-signal-alt-3 me-2"></i>Tages Ansicht
                </a>
                <a id="step5" v-bind:class="[pageId === 'calendar' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/calendar">
                    <i class="uil uil-calendar-alt me-2"></i>Kalender</a>
            </div>
        </div>

        <div class="sideMenuDiv">
            <div class="sideMenuDivContent">
                <label class="fw-lighter mt-3">REFLEKTIEREN</label>
                <a v-bind:class="[pageId === 'playbook' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/playbook">
                    <i class="uil uil-compass me-2"></i>Playbook
                </a>
                <a v-bind:class="[pageId === 'auswertung' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/auswertung">
                    <i class="uil uil-chart-pie me-2"></i>Auswertung
                </a>
                <a v-bind:class="[pageId === 'kiAgent' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/ki-agent">
                    <i class="uil uil-robot me-2"></i>KI-Agent</a>
                <a id="step7" v-bind:class="[pageId === 'screenshots' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/screenshots">
                    <i class="uil uil-image-v me-2"></i>Screenshots
                </a>
            </div>
        </div>

        <div class="sideMenuDiv">
            <div class="sideMenuDivContent">
                <label class="fw-lighter mt-3">HINZUFÜGEN</label>
                <a v-bind:class="[pageId === 'incoming' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/incoming">
                    <i class="uil uil-arrow-circle-down me-2"></i>Pendente Trades
                </a>
                <a v-bind:class="[pageId === 'addTrades' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/addTrades">
                    <i class="uil uil-plus-circle me-2"></i>Manueller Import
                </a>
            </div>
        </div>

        <div class="sideMenuDiv">
            <div class="sideMenuDivContent">
                <label class="fw-lighter mt-3">VERWALTUNG</label>
                <a v-bind:class="[pageId === 'settings' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/settings">
                    <i class="uil uil-setting me-2"></i>Einstellungen
                </a>
            </div>
        </div>

        <div class="mt-auto pt-3">
            <div class="text-start" style="padding-left: 21px;">
                <a href="https://github.com/Mouses007/TJ-Trading-Journal/releases" target="_blank" rel="noopener"
                    class="text-muted text-decoration-none" style="font-size: 0.7rem; opacity: 0.5;"
                    title="Updates auf GitHub prüfen">TJ Beta V.{{ appVersion }}</a>
            </div>
        </div>
    </div>
</template>
