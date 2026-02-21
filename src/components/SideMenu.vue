<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { pageId, screenType } from "../stores/ui.js"
import { currentUser } from "../stores/settings.js"
import { selectedBroker, brokers } from "../stores/globals.js"
import SidebarFilters from './SidebarFilters.vue'

const appVersion = __APP_VERSION__
import { useToggleMobileMenu } from "../utils/utils";

// ── Update System ──
const updateAvailable = ref(false)
const updateInfo = ref(null)
const updateInstalling = ref(false)
const updateError = ref('')

async function checkForUpdate() {
    try {
        const { data } = await axios.get('/api/update/check')
        if (data.ok && data.updateAvailable) {
            updateAvailable.value = true
            updateInfo.value = data
        }
    } catch (e) {
        // Silent fail
    }
}

async function installUpdate() {
    if (updateInstalling.value) return
    updateInstalling.value = true
    updateError.value = ''
    try {
        const { data } = await axios.post('/api/update/install')
        if (data.ok) {
            // Server will restart — wait and reload
            setTimeout(() => window.location.reload(), 5000)
        }
    } catch (e) {
        updateError.value = e.response?.data?.error || e.message
        updateInstalling.value = false
    }
}

onMounted(() => {
    checkForUpdate()
})

function onBrokerChange(event) {
    const value = event.target.value
    selectedBroker.value = value
    localStorage.setItem('selectedBroker', value)
    window.location.reload()
}

function goToDashboard() {
    if (screenType.value === 'mobile') {
        useToggleMobileMenu()
    } else {
        window.location.href = '/dashboard'
    }
}

</script>

<template>
    <div class="col-2 logoDiv">
        <a class="logo-area pointerClass text-decoration-none" href="/dashboard" @click.prevent="goToDashboard">
            <div class="d-flex align-items-center">
                <span v-if="currentUser?.avatar"><img class="logoProfileImg me-2" v-bind:src="currentUser.avatar" /></span>
                <span v-else><img class="logoProfileImg me-2" src="../assets/icon.png" /></span>
                <div class="logo-text">
                    <div class="logo-title">Crypto<br>Trading Journal</div>
                    <div v-if="currentUser?.username" class="logo-username">{{ currentUser.username }}</div>
                </div>
            </div>
        </a>
    </div>
    <div id="step2" class="mt-2">
        <div class="sideMenuDiv">
            <div class="sideMenuDivContent">
                <label class="fw-lighter">BÖRSE</label>
                <div class="sidebar-control">
                    <select class="form-select form-select-sm sidebar-select"
                        :value="selectedBroker"
                        @change="onBrokerChange">
                        <option v-for="b in brokers" :key="b.value" :value="b.value">{{ b.label }}</option>
                    </select>
                </div>
                <SidebarFilters />
            </div>
        </div>

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
                <label class="fw-lighter">REFLEKTIEREN</label>
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
                <label class="fw-lighter">HINZUFÜGEN</label>
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
                <label class="fw-lighter">VERWALTUNG</label>
                <a v-bind:class="[pageId === 'settings' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/settings">
                    <i class="uil uil-setting me-2"></i>Einstellungen
                </a>
            </div>
        </div>

        <div class="mt-auto pt-3 sidebar-footer">
            <a href="https://github.com/Mouses007/Crypto-Trading-Journal" target="_blank" rel="noopener"
                class="footer-version">
                Crypto Trading Journal V.{{ appVersion }}
            </a>
            <a v-if="updateAvailable && !updateInstalling" class="footer-update" @click.prevent="installUpdate">
                <i class="uil uil-download-alt me-1"></i>Update v{{ updateInfo?.remoteVersion }}
            </a>
            <span v-if="updateInstalling" class="footer-update installing">
                <span class="spinner-border spinner-border-sm me-1"></span>Installiere...
            </span>
            <span v-if="updateError" class="footer-update-error">{{ updateError }}</span>
            <a href="https://paypal.me/RosenbergManuel" target="_blank" rel="noopener"
                :class="['footer-donate', { 'footer-donate-highlight': updateAvailable }]">
                <i class="uil uil-heart me-1"></i>Spenden
            </a>
        </div>
    </div>
</template>

<style scoped>
/* Sidebar controls – shared style for broker + filter */
.sidebar-control {
    margin-bottom: 0.35rem;
}

.sidebar-select {
    width: 100%;
    background-color: var(--black-bg-7);
    color: var(--white-87);
    border: 1px solid var(--white-18);
    border-radius: 8px;
    font-size: 0.82rem;
    font-weight: 600;
    padding: 0.4rem 0.5rem;
    cursor: pointer;
    transition: all 0.15s;
}

.sidebar-select:hover {
    background: var(--black-bg-12);
    border-color: var(--white-38);
}

.sidebar-select:focus {
    background-color: var(--black-bg-7);
    color: var(--white-87);
    border-color: var(--blue-color);
    box-shadow: 0 0 0 0.1rem rgba(74, 158, 255, 0.15);
}

.sidebar-select option {
    background-color: var(--black-bg-7);
    color: var(--white-87);
}

/* Footer */
.sidebar-footer {
    text-align: center;
    padding-bottom: 0.75rem;
}

.footer-version {
    display: block;
    font-size: 0.75rem;
    color: var(--white-38);
    opacity: 0.6;
    margin-bottom: 0.25rem;
    text-decoration: none;
    transition: opacity 0.2s;
}

.footer-version:hover {
    opacity: 1;
    color: var(--white-60);
}

.footer-donate {
    font-size: 0.68rem;
    color: var(--white-38);
    opacity: 0.4;
    text-decoration: none;
    transition: opacity 0.2s;
}

.footer-donate:hover {
    opacity: 0.8;
    color: var(--white-60);
}

.footer-donate-highlight {
    color: #4caf50 !important;
    opacity: 0.7 !important;
}

.footer-donate-highlight:hover {
    opacity: 1 !important;
    color: #66bb6a !important;
}

.footer-update {
    display: block;
    font-size: 0.72rem;
    font-weight: 600;
    color: #4caf50;
    cursor: pointer;
    margin: 0.35rem 0;
    text-decoration: none;
    transition: all 0.2s;
    animation: updatePulse 2s ease-in-out infinite;
}

.footer-update:hover {
    color: #66bb6a;
    text-decoration: underline;
}

.footer-update.installing {
    cursor: default;
    animation: none;
    opacity: 0.8;
}

.footer-update-error {
    display: block;
    font-size: 0.65rem;
    color: #f44336;
    margin: 0.2rem 0;
}

@keyframes updatePulse {
    0%, 100% { opacity: 0.8; }
    50% { opacity: 1; }
}
</style>
