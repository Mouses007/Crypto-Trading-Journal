<script setup>
import { ref } from 'vue'
import axios from 'axios'

// setup=true: Erst-Einrichtung im Netzbetrieb — es existiert noch kein
// Passwort, der Server verteilt keine Cookies. Statt „Anmelden" wird hier das
// erste Passwort festgelegt (der Server lässt das ohne Session zu, solange
// das Gate aus ist).
const props = defineProps({ setup: { type: Boolean, default: false } })

const password = ref('')
const passwordWdh = ref('')
const error = ref('')
const info = ref('')
const loading = ref(false)
const resetting = ref(false)

async function submit() {
    if (loading.value) return
    error.value = ''
    info.value = ''
    loading.value = true
    try {
        if (props.setup) {
            if (password.value !== passwordWdh.value) {
                error.value = 'Die Passwörter stimmen nicht überein.'
                return
            }
            const { data } = await axios.post('/api/auth/set-password', { newPassword: password.value })
            if (data.ok) {
                info.value = 'Passwort gesetzt. Seite wird neu geladen…'
                setTimeout(() => window.location.reload(), 800)
                return
            }
            error.value = 'Passwort setzen fehlgeschlagen.'
            return
        }
        const { data } = await axios.post('/api/login', { password: password.value })
        if (data.ok) {
            window.location.reload()
            return
        }
        error.value = 'Anmeldung fehlgeschlagen.'
    } catch (e) {
        error.value = e.response?.data?.error || (props.setup ? 'Passwort setzen fehlgeschlagen.' : 'Anmeldung fehlgeschlagen.')
    } finally {
        loading.value = false
    }
}

async function forgotPassword() {
    if (resetting.value) return
    if (!confirm('Passwortschutz zurücksetzen? Funktioniert nur, wenn du diese Seite direkt am Server (localhost) geöffnet hast.')) return
    error.value = ''
    info.value = ''
    resetting.value = true
    try {
        const { data } = await axios.post('/api/auth/reset')
        if (data.ok) {
            info.value = 'Passwortschutz zurückgesetzt. Seite wird neu geladen…'
            setTimeout(() => window.location.reload(), 1200)
            return
        }
    } catch (e) {
        error.value = e.response?.status === 403
            ? 'Zurücksetzen nur direkt am Server (localhost) möglich.'
            : (e.response?.data?.error || 'Zurücksetzen fehlgeschlagen.')
    } finally {
        resetting.value = false
    }
}
</script>

<template>
    <div class="login-gate">
        <div class="login-card">
            <h3 class="mb-1">Crypto Trading Journal</h3>
            <p v-if="setup" class="login-sub">Der Dienst ist im Netzwerk erreichbar — lege zuerst ein Passwort fest.</p>
            <p v-else class="login-sub">Passwortgeschützt</p>
            <form @submit.prevent="submit">
                <input
                    v-model="password"
                    type="password"
                    class="form-control login-input"
                    :placeholder="setup ? 'Neues Passwort (min. 6 Zeichen)' : 'Passwort'"
                    autofocus
                    :autocomplete="setup ? 'new-password' : 'current-password'"
                />
                <input
                    v-if="setup"
                    v-model="passwordWdh"
                    type="password"
                    class="form-control login-input"
                    placeholder="Passwort wiederholen"
                    autocomplete="new-password"
                />
                <div v-if="error" class="login-error">{{ error }}</div>
                <div v-if="info" class="login-info">{{ info }}</div>
                <button type="submit" class="btn btn-primary login-btn" :disabled="loading || !password">
                    {{ loading ? (setup ? 'Speichern…' : 'Anmelden…') : (setup ? 'Passwort festlegen' : 'Anmelden') }}
                </button>
            </form>
            <button v-if="!setup" type="button" class="login-forgot" :disabled="resetting" @click="forgotPassword">
                {{ resetting ? 'Zurücksetzen…' : 'Passwort vergessen?' }}
            </button>
        </div>
    </div>
</template>

<style scoped>
.login-gate {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--black-bg-2, #14161c);
    z-index: 9999;
}
.login-card {
    background: var(--black-bg-1, #1c1f27);
    padding: 2.5rem;
    border-radius: var(--border-radius, 12px);
    box-shadow: var(--shadow-sm, 0 4px 20px rgba(0, 0, 0, 0.4));
    width: 320px;
    max-width: 90vw;
    text-align: center;
    color: var(--white-1, #e9e9e9);
}
.login-sub {
    color: var(--grey-color, #9aa0aa);
    font-size: 0.9rem;
    margin-bottom: 1.5rem;
}
.login-input {
    margin-bottom: 1rem;
}
.login-btn {
    width: 100%;
}
.login-error {
    color: #ff6b6b;
    font-size: 0.85rem;
    margin-bottom: 0.75rem;
}
.login-info {
    color: #51cf66;
    font-size: 0.85rem;
    margin-bottom: 0.75rem;
}
.login-forgot {
    margin-top: 1rem;
    background: none;
    border: none;
    color: var(--grey-color, #9aa0aa);
    font-size: 0.8rem;
    text-decoration: underline;
    cursor: pointer;
}
.login-forgot:hover {
    color: var(--white-1, #e9e9e9);
}
</style>
