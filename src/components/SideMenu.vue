<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { pageId, screenType } from "../stores/ui.js"
import { currentUser } from "../stores/settings.js"
import { selectedBroker, brokers, selectedTradeCategory, BOT_BROKERS } from "../stores/filters.js"
import SidebarFilters from './SidebarFilters.vue'
import donateBtc from '../assets/donate-btc.png'
import donatePaypal from '../assets/donate-paypal.jpg'

const appVersion = __APP_VERSION__
import { useToggleMobileMenu } from "../utils/utils";
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const showDonateModal = ref(false)

// ── Update System ──
const updateAvailable = ref(false)
const updateInfo = ref(null)
const updateInstalling = ref(false)
const updateError = ref('')
const rollbackAvailable = ref(false)
const rollbackInstalling = ref(false)
const isDocker = ref(false)

async function checkForUpdate() {
    try {
        const { data } = await axios.get('/api/update/check')
        isDocker.value = !!data.isDocker
        if (data.ok && data.updateAvailable) {
            updateAvailable.value = true
            updateInfo.value = data
        }
    } catch (e) {
        // Silent fail
    }
}

/**
 * Holt ein frisches Bestätigungs-Token vom Server (kurzlebig, einmalig).
 * Destruktive Update-Aktionen verlangen dieses Token + localhost.
 */
async function fetchConfirmToken() {
    const { data } = await axios.get('/api/update/check', { params: { force: '1' } })
    return data?.confirmToken || ''
}

async function installUpdate() {
    if (updateInstalling.value) return

    const info = updateInfo.value
    const version = `v${info?.localVersion || '?'} → v${info?.remoteVersion || '?'}`
    const notes = info?.releaseNotes ? `\n\n${t('nav.changes')}\n${info.releaseNotes}` : ''
    const ok = confirm(
        `Update ${version}${notes}\n\n` +
        t('nav.updateBackupWarning') + '\n' +
        t('nav.updateBackupPath') + '\n\n' +
        t('nav.updateConfirm')
    )
    if (!ok) return

    updateInstalling.value = true
    updateError.value = ''
    try {
        const confirmToken = await fetchConfirmToken()
        const { data } = await axios.post('/api/update/install', { confirmToken })
        if (data.ok) {
            // Docker-Recreate dauert laenger als die git-basierte Variante.
            // Statt Fix-Timeout: pollen bis der Server wieder antwortet.
            const initialDelay = data.dockerMode ? 8000 : 4000
            setTimeout(() => waitForServerThenReload(), initialDelay)
        }
    } catch (e) {
        updateError.value = e.response?.data?.error || e.message
        updateInstalling.value = false
    }
}

/**
 * Pollt /api/update/check (leichtgewichtig, kein Fetch-Side-Effekt) bis
 * der Server wieder erreichbar ist, dann Hard-Reload. Gibt nach 90s auf.
 */
async function waitForServerThenReload(startedAt = Date.now()) {
    try {
        const r = await fetch('/api/update/check', { cache: 'no-store' })
        if (r.ok) {
            window.location.reload()
            return
        }
    } catch (_) { /* Server noch nicht da — weiter pollen */ }

    if (Date.now() - startedAt > 90000) {
        // Fallback: trotzdem reloaden
        window.location.reload()
        return
    }
    setTimeout(() => waitForServerThenReload(startedAt), 1500)
}

async function checkRollbackStatus() {
    try {
        const { data } = await axios.get('/api/update/rollback-status')
        rollbackAvailable.value = data.available
    } catch (e) {
        // Silent fail
    }
}

async function rollback() {
    if (rollbackInstalling.value) return
    const ok = confirm(t('nav.rollbackConfirm'))
    if (!ok) return

    rollbackInstalling.value = true
    updateError.value = ''
    try {
        const confirmToken = await fetchConfirmToken()
        const { data } = await axios.post('/api/update/rollback', { confirmToken })
        if (data.ok) {
            setTimeout(() => window.location.reload(), 5000)
        }
    } catch (e) {
        updateError.value = e.response?.data?.error || e.message
        rollbackInstalling.value = false
    }
}

// Passwort-Gate: Abmelden-Eintrag nur zeigen, wenn aktiv
const authEnabled = ref(false)
async function loadAuthStatus() {
    try {
        const { data } = await axios.get('/api/auth/status')
        authEnabled.value = !!data.authEnabled
    } catch (e) {
        authEnabled.value = false
    }
}
async function logout() {
    try {
        await axios.post('/api/logout')
    } catch (e) { /* egal — danach neu laden */ }
    window.location.reload()
}

onMounted(() => {
    checkForUpdate()
    checkRollbackStatus()
    loadAuthStatus()
    // Migration: „Alle" gibt es nicht mehr → auf Futures normalisieren.
    if (selectedTradeCategory.value === 'all' || !selectedTradeCategory.value) {
        selectedTradeCategory.value = 'futures'
        localStorage.setItem('selectedTradeCategory', 'futures')
    }
})

function onBrokerChange(event) {
    const value = event.target.value
    selectedBroker.value = value
    localStorage.setItem('selectedBroker', value)
    window.location.reload()
}

// Trade-Kategorie-Filter (Futures / Bot) als Pillen-Buttons. „Alle" entfällt;
// Spot kann später ergänzt werden.
function setCategory(value) {
    const onAccounts = pageId.value === 'accounts'
    // Auf der Konten-Seite ist keine Trading-Kategorie aktiv → Klick auf
    // Futures/Bot muss zurück zur Trading-Ansicht (Dashboard) führen, auch
    // wenn die Kategorie unverändert bleibt.
    if (selectedTradeCategory.value === value && !onAccounts) return
    selectedTradeCategory.value = value
    localStorage.setItem('selectedTradeCategory', value)
    if (onAccounts) {
        window.location.href = '/dashboard'
    } else {
        window.location.reload()
    }
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
                <label class="fw-lighter">{{ t('nav.tradeCategory') }}</label>
                <div class="category-pills">
                    <!-- Konten-Übersicht: immer sichtbar, links neben den Kategorie-Pillen. -->
                    <a href="/accounts" :class="['cat-pill', 'acc-pill', pageId === 'accounts' ? 'active' : '']">
                        <i class="uil uil-wallet me-1"></i>{{ t('nav.accounts') }}</a>
                    <!-- Futures immer sichtbar; Bot nur bei Börsen mit Bot-API (Pionex).
                         Auf der Konten-Seite ist keine Trading-Kategorie aktiv. -->
                    <button type="button"
                        :class="['cat-pill', (pageId !== 'accounts' && selectedTradeCategory !== 'bot') ? 'active' : '']"
                        @click="setCategory('futures')">Futures</button>
                    <button v-if="BOT_BROKERS.includes(selectedBroker)" type="button"
                        :class="['cat-pill', (pageId !== 'accounts' && selectedTradeCategory === 'bot') ? 'active' : '']"
                        @click="setCategory('bot')">Bot</button>
                </div>
                <SidebarFilters />
            </div>
        </div>

        <div class="sideMenuDiv">
            <div class="sideMenuDivContent">
                <label class="fw-lighter">{{ t('nav.analyze') }}</label>
                <a id="step3" v-bind:class="[pageId === 'dashboard' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/dashboard">
                    <i class="uil uil-apps me-2"></i>{{ t('nav.dashboard') }}</a>
                <a id="step4" v-bind:class="[pageId === 'daily' ? 'activeNavCss' : '', 'nav-link', 'mb-2']" href="/daily">
                    <i class="uil uil-signal-alt-3 me-2"></i>{{ t('nav.dailyView') }}
                </a>
                <a id="step5" v-bind:class="[pageId === 'calendar' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/calendar">
                    <i class="uil uil-calendar-alt me-2"></i>{{ t('nav.calendar') }}</a>
            </div>
        </div>

        <div class="sideMenuDiv">
            <div class="sideMenuDivContent">
                <label class="fw-lighter">{{ t('nav.reflect') }}</label>
                <a v-bind:class="[pageId === 'playbook' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/playbook">
                    <i class="uil uil-compass me-2"></i>{{ t('nav.playbook') }}
                </a>
                <a v-bind:class="[pageId === 'auswertung' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/auswertung">
                    <i class="uil uil-chart-pie me-2"></i>{{ t('nav.evaluation') }}
                </a>
                <a v-if="currentUser?.aiEnabled !== false && currentUser?.aiEnabled !== 0"
                    v-bind:class="[pageId === 'kiAgent' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/ki-coach">
                    <i class="uil uil-robot me-2"></i>{{ t('nav.kiAgent') }}</a>
                <a id="step7" v-bind:class="[pageId === 'screenshots' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/screenshots">
                    <i class="uil uil-image-v me-2"></i>Screenshots
                </a>
            </div>
        </div>

        <div class="sideMenuDiv">
            <div class="sideMenuDivContent">
                <label class="fw-lighter">{{ t('nav.add') }}</label>
                <a v-bind:class="[pageId === 'incoming' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/incoming">
                    <i class="uil uil-arrow-circle-down me-2"></i>{{ t('nav.pendingTrades') }}
                </a>
                <a v-bind:class="[pageId === 'addTrades' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/addTrades">
                    <i class="uil uil-plus-circle me-2"></i>{{ t('nav.manualImport') }}
                </a>
            </div>
        </div>

        <div class="sideMenuDiv">
            <div class="sideMenuDivContent">
                <label class="fw-lighter">{{ t('nav.manage') }}</label>
                <a v-bind:class="[pageId === 'settings' ? 'activeNavCss' : '', 'nav-link', 'mb-2']"
                    href="/settings">
                    <i class="uil uil-setting me-2"></i>{{ t('nav.settings') }}
                </a>
                <a v-if="authEnabled" class="nav-link mb-2 pointerClass" @click="logout">
                    <i class="uil uil-signout me-2"></i>Abmelden
                </a>
            </div>
        </div>

        <div class="mt-auto pt-3 sidebar-footer">
            <a href="https://github.com/Mouses007/Crypto-Trading-Journal" target="_blank" rel="noopener"
                class="footer-version">
                Crypto Trading Journal V.{{ appVersion }}
            </a>
            <!-- Docker: Watchtower zieht automatisch — Link zur Release-Seite -->
            <a v-if="updateAvailable && isDocker" class="footer-update"
                :href="updateInfo?.releaseUrl || 'https://github.com/Mouses007/Crypto-Trading-Journal/releases/latest'"
                target="_blank" rel="noopener"
                :title="'Update v' + updateInfo?.remoteVersion + ' — wird automatisch via Watchtower installiert'">
                <i class="uil uil-docker me-1"></i>Update v{{ updateInfo?.remoteVersion }}
            </a>
            <!-- Non-Docker: normaler Install-Button -->
            <a v-if="updateAvailable && !isDocker && !updateInstalling" class="footer-update" @click.prevent="installUpdate">
                <i class="uil uil-download-alt me-1"></i>Update v{{ updateInfo?.remoteVersion }}
            </a>
            <span v-if="updateInstalling" class="footer-update installing">
                <span class="spinner-border spinner-border-sm me-1"></span>{{ t('nav.installing') }}
            </span>
            <a v-if="rollbackAvailable && !rollbackInstalling" class="footer-rollback" @click.prevent="rollback">
                <i class="uil uil-redo me-1"></i>Rollback
            </a>
            <span v-if="rollbackInstalling" class="footer-update installing">
                <span class="spinner-border spinner-border-sm me-1"></span>{{ t('nav.rollback') }}
            </span>
            <span v-if="updateError" class="footer-update-error">{{ updateError }}</span>
            <a href="#" @click.prevent="showDonateModal = true"
                :class="['footer-donate', { 'footer-donate-highlight': updateAvailable }]">
                <i class="uil uil-heart me-1"></i>{{ t('nav.donate') }}
            </a>
        </div>
    </div>

    <!-- Spenden Modal — Teleport to body to escape sidebar stacking context -->
    <Teleport to="body">
        <div v-if="showDonateModal" class="donate-overlay" @click.self="showDonateModal = false">
            <div class="donate-modal">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h6 class="mb-0"><i class="uil uil-heart me-1"></i>{{ t('nav.donate') }}</h6>
                    <button class="btn btn-sm btn-outline-secondary" @click="showDonateModal = false">
                        <i class="uil uil-times"></i>
                    </button>
                </div>
                <div class="donate-qr-row">
                    <div class="donate-qr-card">
                        <img :src="donateBtc" alt="BTC QR Code" class="donate-qr-img" />
                    </div>
                    <div class="donate-qr-card">
                        <img :src="donatePaypal" alt="PayPal QR Code" class="donate-qr-img" />
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
/* Trade-Kategorie-Pillen (Stil wie die Börsen-Pillen oben) */
.category-pills {
    display: flex;
    gap: 0.55rem;
    margin-top: 0.35rem;
    /* Abstand zwischen Pillen und Filter: 3mm + 0.4rem */
    margin-bottom: calc(3mm + 0.4rem);
    flex-wrap: wrap;
}
.cat-pill {
    font-size: 0.78rem;
    padding: 0.2rem 0.8rem;
    border-radius: 999px;
    border: 1px solid var(--white-18, rgba(255, 255, 255, 0.15));
    background: transparent;
    color: var(--white-70, rgba(255, 255, 255, 0.7));
    line-height: 1.5;
    cursor: pointer;
    transition: all 0.15s ease;
}
.cat-pill:hover {
    border-color: var(--blue-color, #3b82f6);
    color: var(--white-87, rgba(255, 255, 255, 0.9));
}
.cat-pill.active {
    background: var(--blue-color, #3b82f6);
    border-color: var(--blue-color, #3b82f6);
    color: #fff;
    font-weight: 600;
}
/* Konten-Pille: Navigations-Link im Pillen-Stil (kein Unterstrich), dezenter Akzent. */
.acc-pill {
    text-decoration: none;
    display: inline-flex;
    align-items: center;
}

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

.footer-rollback {
    display: block;
    font-size: 0.7rem;
    color: #ff9800;
    cursor: pointer;
    margin: 0.2rem 0;
}
.footer-rollback:hover {
    color: #ffb74d;
    text-decoration: underline;
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

<!-- Unscoped styles for Teleported donate modal -->
<style>
.donate-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
}

.donate-modal {
    background: var(--black-bg-3, #1a1a2e);
    border: 1px solid var(--white-18, rgba(255,255,255,0.18));
    border-radius: var(--border-radius, 6px);
    padding: 1.25rem;
    max-width: 900px;
    width: 95vw;
    max-height: 90vh;
    overflow-y: auto;
}

.donate-qr-row {
    display: flex;
    gap: 200px;
    justify-content: center;
    align-items: center;
}

.donate-qr-card {
    flex: 1;
    min-width: 0;
}

.donate-qr-img {
    width: 100%;
    border-radius: var(--border-radius, 6px);
}

@media (max-width: 500px) {
    .donate-qr-row {
        flex-direction: column;
    }
}
</style>
