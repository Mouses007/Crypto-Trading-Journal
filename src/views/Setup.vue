<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const router = useRouter()

const step = ref(1)
const dbType = ref('sqlite')
const pgHost = ref('localhost')
const pgPort = ref(5432)
const pgUser = ref('postgres')
const pgPassword = ref('')
const pgDatabase = ref('tradejournal')
const testResult = ref(null)
const testLoading = ref(false)
const saving = ref(false)
const error = ref('')

// Pruefen ob Setup bereits abgeschlossen
onMounted(async () => {
    try {
        const { data } = await axios.get('/api/setup/status')
        if (data.setupComplete) {
            router.replace('/dashboard')
        }
    } catch (e) {
        // ignore — proceed with setup
    }
})

async function testConnection() {
    testLoading.value = true
    testResult.value = null
    try {
        const { data } = await axios.post('/api/db-config/test', {
            host: pgHost.value,
            port: pgPort.value,
            user: pgUser.value,
            password: pgPassword.value,
            database: pgDatabase.value
        })
        testResult.value = data
    } catch (e) {
        testResult.value = { ok: false, message: t('common.connectionError') + (e.response?.data?.message || e.message) }
    }
    testLoading.value = false
}

async function saveDbConfig() {
    error.value = ''
    try {
        if (dbType.value === 'postgresql') {
            await axios.put('/api/db-config', {
                type: 'postgresql',
                host: pgHost.value,
                port: pgPort.value,
                user: pgUser.value,
                password: pgPassword.value,
                database: pgDatabase.value
            })
        } else {
            await axios.put('/api/db-config', { type: 'sqlite' })
        }
    } catch (e) {
        error.value = t('common.errorSaving') + (e.response?.data?.error || e.message)
    }
}

async function nextStep() {
    if (step.value === 1) {
        step.value = 2
    } else if (step.value === 2) {
        // DB-Config speichern
        saving.value = true
        await saveDbConfig()
        saving.value = false
        if (!error.value) {
            step.value = 3
        }
    }
}

async function completeSetup() {
    saving.value = true
    try {
        await axios.post('/api/setup/complete')
        // Bei PostgreSQL-Wechsel: Neustart-Hinweis
        if (dbType.value === 'postgresql') {
            step.value = 4 // Neustart-Schritt
        } else {
            // Reload damit Router setupComplete neu lädt
            window.location.href = '/dashboard'
        }
    } catch (e) {
        error.value = t('common.errorPrefix') + (e.response?.data?.error || e.message)
    }
    saving.value = false
}

/** Setup als abgeschlossen markieren und zum Dashboard (für Nutzer, die schon alles konfiguriert haben). */
async function skipSetup() {
    saving.value = true
    error.value = ''
    try {
        await axios.post('/api/setup/complete')
        // Vollständiger Reload, damit der Router setupComplete neu lädt und nicht mehr zu /setup umleitet
        window.location.href = '/dashboard'
    } catch (e) {
        error.value = t('common.errorPrefix') + (e.response?.data?.error || e.message)
    }
    saving.value = false
}
</script>

<template>
    <div class="setup-container">
        <div class="setup-card">
            <!-- Header -->
            <div class="setup-header">
                <img src="@/assets/icon.png" alt="Crypto Trading Journal" class="setup-logo" onerror="this.style.display='none'" />
                <h2>Crypto Trading Journal</h2>
                <!-- Step indicator -->
                <div class="step-indicator">
                    <div class="step-dot" :class="{ active: step >= 1, done: step > 1 }">1</div>
                    <div class="step-line" :class="{ active: step > 1 }"></div>
                    <div class="step-dot" :class="{ active: step >= 2, done: step > 2 }">2</div>
                    <div class="step-line" :class="{ active: step > 2 }"></div>
                    <div class="step-dot" :class="{ active: step >= 3 }">3</div>
                </div>
            </div>

            <!-- Step 1: Willkommen -->
            <div v-if="step === 1" class="setup-body">
                <h3>{{ t('setup.welcome') }}</h3>
                <p class="text-muted">
                    {{ t('setup.welcomeText') }}
                </p>
                <div class="feature-list">
                    <div class="feature-item">
                        <i class="uil uil-chart-line"></i>
                        <div>
                            <strong>{{ t('setup.featureAnalysis') }}</strong>
                            <small>{{ t('setup.featureDashboard') }}</small>
                        </div>
                    </div>
                    <div class="feature-item">
                        <i class="uil uil-book-open"></i>
                        <div>
                            <strong>{{ t('setup.featureJournal') }}</strong>
                            <small>{{ t('setup.featureDiary') }}</small>
                        </div>
                    </div>
                    <div class="feature-item">
                        <i class="uil uil-robot"></i>
                        <div>
                            <strong>{{ t('setup.featureAiReports') }}</strong>
                            <small>{{ t('setup.featureKi') }}</small>
                        </div>
                    </div>
                    <div class="feature-item">
                        <i class="uil uil-import"></i>
                        <div>
                            <strong>{{ t('setup.featureBitunixImport') }}</strong>
                            <small>{{ t('setup.featureImport') }}</small>
                        </div>
                    </div>
                </div>
                <button class="btn btn-primary btn-lg w-100 mt-4" @click="nextStep">
                    {{ t('common.next') }} <i class="uil uil-arrow-right ms-1"></i>
                </button>
                <p class="mt-3 mb-0 text-center">
                    <button type="button" class="btn btn-link btn-sm text-muted p-0" @click="skipSetup">
                        {{ t('setup.skipSetup') }}
                    </button>
                </p>
            </div>

            <!-- Step 2: Datenbank waehlen -->
            <div v-if="step === 2" class="setup-body">
                <h3>{{ t('setup.chooseDatabase') }}</h3>
                <p class="text-muted mb-3">
                    {{ t('setup.chooseDatabaseText') }}
                </p>

                <!-- SQLite -->
                <div class="db-option" :class="{ selected: dbType === 'sqlite' }" @click="dbType = 'sqlite'">
                    <div class="db-option-header">
                        <div class="form-check">
                            <input class="form-check-input" type="radio" v-model="dbType" value="sqlite" id="dbSqlite">
                            <label class="form-check-label" for="dbSqlite">
                                <strong>SQLite</strong>
                                <span class="badge bg-success ms-2">{{ t('setup.recommended') }}</span>
                            </label>
                        </div>
                    </div>
                    <p class="small text-muted mb-0 ms-4">
                        {{ t('setup.sqliteDescription') }}
                    </p>
                </div>

                <!-- PostgreSQL -->
                <div class="db-option mt-3" :class="{ selected: dbType === 'postgresql' }" @click="dbType = 'postgresql'">
                    <div class="db-option-header">
                        <div class="form-check">
                            <input class="form-check-input" type="radio" v-model="dbType" value="postgresql" id="dbPg">
                            <label class="form-check-label" for="dbPg">
                                <strong>PostgreSQL</strong>
                            </label>
                        </div>
                    </div>
                    <p class="small text-muted mb-0 ms-4">
                        {{ t('setup.postgresDescription') }}
                    </p>

                    <!-- PostgreSQL Felder -->
                    <div v-if="dbType === 'postgresql'" class="pg-fields mt-3 ms-4">
                        <div class="row g-2">
                            <div class="col-8">
                                <label class="form-label small">{{ t('settings.host') }}</label>
                                <input type="text" class="form-control form-control-sm" v-model="pgHost" placeholder="localhost">
                            </div>
                            <div class="col-4">
                                <label class="form-label small">{{ t('settings.port') }}</label>
                                <input type="number" class="form-control form-control-sm" v-model="pgPort" placeholder="5432">
                            </div>
                        </div>
                        <div class="row g-2 mt-1">
                            <div class="col-6">
                                <label class="form-label small">{{ t('settings.user') }}</label>
                                <input type="text" class="form-control form-control-sm" v-model="pgUser" placeholder="postgres">
                            </div>
                            <div class="col-6">
                                <label class="form-label small">{{ t('settings.password') }}</label>
                                <input type="password" class="form-control form-control-sm" v-model="pgPassword" :placeholder="t('settings.password')">
                            </div>
                        </div>
                        <div class="mt-2">
                            <label class="form-label small">{{ t('settings.databaseName') }}</label>
                            <input type="text" class="form-control form-control-sm" v-model="pgDatabase" placeholder="tradejournal">
                        </div>
                        <button class="btn btn-outline-secondary btn-sm mt-2" @click.stop="testConnection" :disabled="testLoading">
                            <span v-if="testLoading" class="spinner-border spinner-border-sm me-1"></span>
                            {{ t('common.testConnection') }}
                        </button>
                        <div v-if="testResult" class="mt-2">
                            <div v-if="testResult.ok" class="text-success small">
                                <i class="uil uil-check-circle"></i> {{ testResult.message }}
                            </div>
                            <div v-else class="text-danger small">
                                <i class="uil uil-exclamation-triangle"></i> {{ testResult.message }}
                            </div>
                        </div>
                    </div>
                </div>

                <div v-if="error" class="alert alert-danger mt-3 py-2 small">{{ error }}</div>

                <div class="d-flex gap-2 mt-4">
                    <button class="btn btn-outline-secondary" @click="step = 1">
                        <i class="uil uil-arrow-left me-1"></i> {{ t('common.back') }}
                    </button>
                    <button class="btn btn-primary flex-grow-1" @click="nextStep" :disabled="saving">
                        <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
                        {{ t('common.next') }} <i class="uil uil-arrow-right ms-1"></i>
                    </button>
                </div>
            </div>

            <!-- Step 3: Fertig -->
            <div v-if="step === 3" class="setup-body text-center">
                <div class="success-icon">
                    <i class="uil uil-check-circle"></i>
                </div>
                <h3>{{ t('setup.setupComplete') }}</h3>
                <p class="text-muted">
                    {{ t('setup.configSaved') }}
                    <span v-if="dbType === 'sqlite'">{{ t('setup.sqliteAutoCreated') }}</span>
                    <span v-else>{{ t('setup.postgresUsedOnRestart') }}</span>
                </p>

                <div class="next-steps">
                    <p class="small text-muted mb-2"><strong>{{ t('setup.nextSteps') }}</strong></p>
                    <ul class="small text-muted text-start">
                        <li v-html="t('setup.nextStepSettings', { settings: '<strong>' + t('nav.settings') + '</strong>' })"></li>
                        <li v-html="t('setup.nextStepImport', { csv: '<strong>CSV-Upload</strong>', api: '<strong>Bitunix-API</strong>' })"></li>
                    </ul>
                </div>

                <button class="btn btn-primary btn-lg w-100 mt-3" @click="completeSetup" :disabled="saving">
                    <span v-if="saving" class="spinner-border spinner-border-sm me-1"></span>
                    {{ t('setup.goToDashboard') }} <i class="uil uil-arrow-right ms-1"></i>
                </button>

                <div v-if="error" class="alert alert-danger mt-3 py-2 small">{{ error }}</div>
            </div>

            <!-- Step 4: Neustart (nur bei PostgreSQL) -->
            <div v-if="step === 4" class="setup-body text-center">
                <div class="restart-icon">
                    <i class="uil uil-redo"></i>
                </div>
                <h3>{{ t('setup.serverRestartRequired') }}</h3>
                <p class="text-muted">
                    {{ t('setup.postgresChosen') }}
                    {{ t('setup.restartServer') }}
                </p>
                <div class="alert alert-info small">
                    <strong>{{ t('setup.restartInstructions') }}</strong><br>
                    1. {{ t('setup.restartStep1') }}<br>
                    2. {{ t('setup.restartStep2') }}
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.setup-container {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--black-bg-color, #0d1117);
    padding: 2rem;
}

.setup-card {
    background: var(--black-bg-2-color, #161b22);
    border-radius: 12px;
    border: 1px solid var(--white-10, rgba(255, 255, 255, 0.1));
    max-width: 520px;
    width: 100%;
    overflow: hidden;
}

.setup-header {
    text-align: center;
    padding: 2rem 2rem 1rem;
    border-bottom: 1px solid var(--white-10, rgba(255, 255, 255, 0.1));
}

.setup-logo {
    width: 48px;
    height: 48px;
    margin-bottom: 0.5rem;
}

.setup-header h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--white-color, #e6edf3);
    margin-bottom: 1rem;
}

.step-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
}

.step-dot {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 600;
    border: 2px solid var(--white-10, rgba(255, 255, 255, 0.15));
    color: var(--white-10, rgba(255, 255, 255, 0.3));
    transition: all 0.3s;
}

.step-dot.active {
    border-color: var(--blue-color, #58a6ff);
    color: var(--blue-color, #58a6ff);
    background: rgba(88, 166, 255, 0.1);
}

.step-dot.done {
    border-color: #3fb950;
    color: #3fb950;
    background: rgba(63, 185, 80, 0.1);
}

.step-line {
    width: 40px;
    height: 2px;
    background: var(--white-10, rgba(255, 255, 255, 0.1));
    transition: all 0.3s;
}

.step-line.active {
    background: var(--blue-color, #58a6ff);
}

.setup-body {
    padding: 2rem;
}

.setup-body h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--white-color, #e6edf3);
    margin-bottom: 0.5rem;
}

.feature-list {
    margin-top: 1.5rem;
}

.feature-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--white-10, rgba(255, 255, 255, 0.05));
}

.feature-item:last-child {
    border-bottom: none;
}

.feature-item i {
    font-size: 1.5rem;
    color: var(--blue-color, #58a6ff);
    flex-shrink: 0;
    margin-top: 2px;
}

.feature-item strong {
    display: block;
    color: var(--white-color, #e6edf3);
    font-size: 0.9rem;
}

.feature-item small {
    color: var(--white-50, rgba(255, 255, 255, 0.5));
    font-size: 0.8rem;
}

.db-option {
    border: 2px solid var(--white-10, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    padding: 1rem;
    cursor: pointer;
    transition: all 0.2s;
}

.db-option:hover {
    border-color: var(--white-30, rgba(255, 255, 255, 0.2));
}

.db-option.selected {
    border-color: var(--blue-color, #58a6ff);
    background: rgba(88, 166, 255, 0.05);
}

.pg-fields {
    border-top: 1px solid var(--white-10, rgba(255, 255, 255, 0.1));
    padding-top: 0.75rem;
}

.pg-fields .form-control {
    background: var(--black-bg-color, #0d1117);
    border-color: var(--white-10, rgba(255, 255, 255, 0.15));
    color: var(--white-color, #e6edf3);
}

.pg-fields .form-label {
    color: var(--white-50, rgba(255, 255, 255, 0.5));
    margin-bottom: 0.2rem;
}

.success-icon {
    font-size: 4rem;
    color: #3fb950;
    margin-bottom: 0.5rem;
}

.restart-icon {
    font-size: 4rem;
    color: var(--blue-color, #58a6ff);
    margin-bottom: 0.5rem;
}

.next-steps {
    background: var(--black-bg-color, #0d1117);
    border-radius: 8px;
    padding: 1rem;
    margin-top: 1rem;
}

.next-steps ul {
    padding-left: 1.2rem;
    margin-bottom: 0;
}

.next-steps li {
    margin-bottom: 0.3rem;
}
</style>
