<script setup>
import { ref } from 'vue'
import { pageId, screenType, currentUser } from "../stores/globals"
import { useToggleMobileMenu } from "../utils/utils";
import { useQuickApiImport } from "../utils/quickImport";

const apiImporting = ref(false)
const apiImportResult = ref(null) // { success, message }

async function quickApiImport() {
    if (apiImporting.value) return
    apiImporting.value = true
    apiImportResult.value = null

    try {
        const result = await useQuickApiImport()
        apiImportResult.value = result
    } catch (error) {
        apiImportResult.value = { success: false, message: error.response?.data?.error || error.message || 'Import fehlgeschlagen' }
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
        <div class="logo-area" :class="{ 'pointerClass': screenType == 'mobile' }" @click="screenType == 'mobile' ? useToggleMobileMenu() : null">
            <div class="d-flex align-items-center">
                <span v-if="currentUser.hasOwnProperty('avatar')"><img class="logoProfileImg me-2" v-bind:src="currentUser.avatar" /></span>
                <span v-else><img class="logoProfileImg me-2" src="../assets/astronaut.png" /></span>
                <div class="logo-text">
                    <div class="logo-title">Trading Journal</div>
                    <div v-if="currentUser.username" class="logo-username">{{ currentUser.username }}</div>
                </div>
            </div>
        </div>
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
                    <i class="uil uil-arrow-circle-down me-2"></i>Offene Trades
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
                <a class="nav-link mb-2 pointerClass" v-on:click="quickApiImport" :class="{ 'text-muted': apiImporting }">
                    <span v-if="apiImporting">
                        <span class="spinner-border spinner-border-sm me-2" role="status"></span>Importiere...
                    </span>
                    <span v-else>
                        <i class="uil uil-cloud-download me-2"></i>API Import
                    </span>
                </a>
                <div v-if="apiImportResult" class="px-2 pb-2">
                    <small :class="apiImportResult.success ? 'text-success' : 'text-danger'">
                        {{ apiImportResult.message }}
                    </small>
                </div>
            </div>
        </div>
    </div>
</template>
