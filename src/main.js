import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import i18n, { starteSprache } from './i18n'

import './assets/style-dark.css'

const app = createApp(App)

app.use(i18n)
app.use(router)

/*
 * Die gespeicherte Sprache steht VOR dem Mount fest: nur Deutsch liegt im
 * Start-Bundle, Englisch wird bei Bedarf nachgeladen. Ohne das Warten blitzte
 * kurz die deutsche Oberflaeche auf. Schlaegt das Laden fehl, startet die App
 * trotzdem — auf Deutsch.
 */
starteSprache().finally(() => app.mount('#app'))