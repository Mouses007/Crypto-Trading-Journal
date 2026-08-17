<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import LoginGate from './components/LoginGate.vue'

const authChecked = ref(false)
const needsLogin = ref(false)
const setupRequired = ref(false)

onMounted(async () => {
    try {
        const { data } = await axios.get('/api/auth/status')
        // setupRequired: netzgebundener Betrieb ohne Passwort — der Server
        // verteilt keine Cookies, zuerst muss ein Passwort festgelegt werden.
        setupRequired.value = !!data.setupRequired
        needsLogin.value = setupRequired.value || (!!data.authEnabled && !data.loggedIn)
    } catch (e) {
        // Im Zweifel App normal laden (Gate ist optional)
        needsLogin.value = false
    } finally {
        authChecked.value = true
    }
})
</script>
<template>
    <LoginGate v-if="authChecked && needsLogin" :setup="setupRequired" />
    <component v-else-if="authChecked" :is="$route.meta.layout || 'div'">
        <RouterView />
    </component>
</template>
