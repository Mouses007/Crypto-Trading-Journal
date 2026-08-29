<script setup>
/**
 * Mail-Konfiguration (SMTP) — extrahiert aus Settings.vue (Bereich
 * Benachrichtigungen), dort self-contained über /api/mail/settings und
 * /api/mail/test. Wiederverwendet im Onboarding-Assistenten und weiterhin
 * in Settings.vue.
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import InfoTipp from '../InfoTipp.vue'

const { t } = useI18n()

/*
 * v-model statt eigenem State: Settings.vue liest `mail.mailAktiv`/`mailAn`
 * an zwei weiteren Stellen (News-Mailversand-Hinweis, Kanal-Checkbox) und
 * braucht deshalb dieselbe Referenz. Ohne gebundenes v-model (Onboarding-
 * Kontext) liefert `defineModel` automatisch einen lokalen Fallback-Ref.
 */
const mail = defineModel('mail', {
    default: () => ({
        mailAktiv: 0, mailHost: '', mailPort: 587, mailSicherheit: 'starttls',
        mailUser: '', mailVon: '', mailAn: '', mailPasswort: '', mailPasswortSet: false,
        mailSchriftGroesse: 'gross',
    }),
})
const mailTestLaeuft = ref(false)
const mailMeldung = ref('')
const mailFehler = ref(false)

const MAIL_VORLAGEN = [
    { name: 'Gmail', mailHost: 'smtp.gmail.com', mailPort: 465, mailSicherheit: 'tls' },
    { name: 'Outlook', mailHost: 'smtp-mail.outlook.com', mailPort: 587, mailSicherheit: 'starttls' },
    { name: 'GMX', mailHost: 'mail.gmx.net', mailPort: 587, mailSicherheit: 'starttls' },
]

function mailVorlage(v) {
    mail.value.mailHost = v.mailHost
    mail.value.mailPort = v.mailPort
    mail.value.mailSicherheit = v.mailSicherheit
}

async function ladeMailKonfig() {
    try {
        const { data } = await axios.get('/api/mail/settings')
        mail.value = { ...data, mailPasswort: data.mailPasswortSet ? '••••••••' : '' }
    } catch (e) {
        console.error(' -> Mail-Einstellungen nicht ladbar:', e)
    }
}

async function speichereMail() {
    mailMeldung.value = ''
    try {
        await axios.post('/api/mail/settings', mail.value)
        mailFehler.value = false
        mailMeldung.value = 'Gespeichert.'
        await ladeMailKonfig()
    } catch (e) {
        mailFehler.value = true
        mailMeldung.value = e.response?.data?.error || e.message
    }
}

async function testeMail() {
    mailTestLaeuft.value = true
    mailMeldung.value = ''
    try {
        await axios.post('/api/mail/settings', mail.value)
        await axios.post('/api/mail/test')
        mailFehler.value = false
        mailMeldung.value = 'Testmail verschickt — schau ins Postfach.'
    } catch (e) {
        mailFehler.value = true
        mailMeldung.value = e.response?.data?.error || e.message
    } finally {
        mailTestLaeuft.value = false
    }
}

onMounted(ladeMailKonfig)
</script>

<template>
    <div>
        <div class="form-check form-switch mt-2">
            <input class="form-check-input" type="checkbox" id="mailAktivToggleOnboarding"
                :checked="mail.mailAktiv === 1"
                @change="mail.mailAktiv = $event.target.checked ? 1 : 0; speichereMail()">
            <label class="form-check-label" for="mailAktivToggleOnboarding">
                {{ t('settings.benachrichtigungen.mailAktiv') }}
            </label>
        </div>

        <div class="d-flex align-items-center gap-2 flex-wrap mt-3">
            <span class="text-muted" style="font-size:0.8rem;">{{ t('settings.benachrichtigungen.vorlage') }}</span>
            <button v-for="v in MAIL_VORLAGEN" :key="v.name" type="button"
                class="btn btn-sm btn-outline-secondary" @click="mailVorlage(v)">{{ v.name }}</button>
        </div>

        <div class="row align-items-center mt-2">
            <div class="col-12 col-md-4">{{ t('settings.benachrichtigungen.schrift') }}<InfoTipp schluessel="settings.info.mailSchrift" /></div>
            <div class="col-12 col-md-8">
                <select class="form-select" style="max-width:14rem;"
                    v-model="mail.mailSchriftGroesse" @change="speichereMail">
                    <option value="normal">{{ t('settings.benachrichtigungen.schriftNormal') }}</option>
                    <option value="gross">{{ t('settings.benachrichtigungen.schriftGross') }}</option>
                    <option value="sehrGross">{{ t('settings.benachrichtigungen.schriftSehrGross') }}</option>
                </select>
            </div>
        </div>

        <div class="row align-items-center mt-3">
            <div class="col-12 col-md-4">{{ t('settings.benachrichtigungen.host') }}<InfoTipp schluessel="settings.info.mailSicherheit" /></div>
            <div class="col-12 col-md-8 d-flex gap-2 flex-wrap">
                <input type="text" class="form-control" style="max-width:18rem;"
                    v-model="mail.mailHost" placeholder="smtp.example.com" />
                <input type="number" class="form-control" style="max-width:7rem;"
                    v-model.number="mail.mailPort" placeholder="587" />
                <select class="form-select" style="max-width:11rem;" v-model="mail.mailSicherheit">
                    <option value="tls">TLS (465)</option>
                    <option value="starttls">STARTTLS (587)</option>
                    <option value="keine">{{ t('settings.benachrichtigungen.mailSecurityNone') }}</option>
                </select>
            </div>
        </div>

        <div class="row align-items-center mt-2">
            <div class="col-12 col-md-4">{{ t('settings.benachrichtigungen.zugang') }}</div>
            <div class="col-12 col-md-8 d-flex gap-2 flex-wrap">
                <input type="text" class="form-control" style="max-width:18rem;"
                    v-model="mail.mailUser" :placeholder="t('settings.benachrichtigungen.benutzer')" />
                <input type="password" class="form-control" style="max-width:14rem;"
                    v-model="mail.mailPasswort" :placeholder="t('settings.benachrichtigungen.passwort')" />
            </div>
        </div>

        <div class="row align-items-center mt-2">
            <div class="col-12 col-md-4">{{ t('settings.benachrichtigungen.adressen') }}</div>
            <div class="col-12 col-md-8 d-flex gap-2 flex-wrap">
                <input type="email" class="form-control" style="max-width:18rem;"
                    v-model="mail.mailVon" :placeholder="t('settings.benachrichtigungen.von')" />
                <input type="email" class="form-control" style="max-width:18rem;"
                    v-model="mail.mailAn" :placeholder="t('settings.benachrichtigungen.an')" />
            </div>
        </div>

        <div class="d-flex align-items-center gap-2 flex-wrap mt-3">
            <button type="button" class="btn btn-sm btn-primary" @click="speichereMail">
                {{ t('settings.benachrichtigungen.speichern') }}
            </button>
            <button type="button" class="btn btn-sm btn-outline-primary"
                :disabled="mailTestLaeuft" @click="testeMail">
                {{ mailTestLaeuft ? t('settings.benachrichtigungen.testLaeuft') : t('settings.benachrichtigungen.test') }}
            </button>
            <span v-if="mailMeldung" :class="mailFehler ? 'text-danger' : 'text-success'"
                style="font-size:0.85rem;">{{ mailMeldung }}</span>
        </div>
        <p class="fw-lighter mt-2" style="font-size:0.8rem;">
            {{ t('settings.benachrichtigungen.passwortHinweis') }}
        </p>
    </div>
</template>
