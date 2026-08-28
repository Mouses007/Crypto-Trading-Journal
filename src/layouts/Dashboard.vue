<script setup>
import SideMenu from '../components/SideMenu.vue'
import Nav from '../components/Nav.vue'
import Screenshot from '../components/Screenshot.vue'
import ReturnToTopButton from '../components/ReturnToTopButton.vue'
import TradeEvalPopup from '../components/TradeEvalPopup.vue'
import { computed, ref, onBeforeMount, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCreatedDateFormat, useTimeFormat, useHourMinuteFormat } from '../utils/formatters.js'
import { useInitParse, usePageId, useScreenType, useGetTimeZone, useGetPeriods, useSetValues, useCloseMobileMenu } from '../utils/utils.js'
import { screenType, sideMenuMobileOut, pageId, selectedScreenshotIndex, appMode, privacyMode } from '../stores/ui.js'
import { starteZensur } from '../utils/privacy.js'
import { getMore } from '../stores/filters.js'
import { screenshots, selectedScreenshot, screenshot } from '../stores/trades.js'
import { currentUser, aiReportGenerating, aiReportCountBefore, aiReportLabel } from '../stores/settings.js'
import { hydrateLiveSettings } from '../stores/live.js'
import { useSelectedScreenshotFunction } from '../utils/screenshots'
import { useUpdatePendingCounts, useStartGlobalPolling, useStopGlobalPolling } from '../utils/incoming.js'
import { useGetAvailableTags } from '../utils/daily.js'
import { requestNotificationPermission, sendNotification } from '../utils/notify'
import { logWarn } from '../utils/logger.js'
import { ebeneAuf, ebeneZu } from '../composables/useZurueckGeste.js'
import { useImVollbild } from '../utils/geraet.js'
import BetaHinweis from '../components/BetaHinweis.vue'
import PageInfo from '../components/PageInfo.vue'
import { istModusAn, ersterAktiverModus, modeHome } from '../config/menu.js'
import { setLocale } from '../i18n'
import i18n from '../i18n'
import axios from 'axios'

const _t = (key, named) => i18n.global.t(key, named)

const route = useRoute()
// Die Live-Analyse teilt sich das Layout mit dem Journal, braucht aber keine
// Trade-Daten: Perioden, Tags, Pending-Counts und die Popups bleiben dort aus.
const isJournal = computed(() => {
  const mode = route.meta?.mode
  return mode === undefined || mode === 'journal' || mode === 'any'
})

// Der Agent-Modus handelt selbstständig — die Warnung gehört auf JEDE seiner
// Seiten, nicht nur auf die Startseite. Wer über einen Direktlink im Labor
// landet, muss sie genauso sehen.
const isAgent = computed(() => route.meta?.mode === 'agent')

/**
 * Cockpit-Modus: das Live-Trading-Fenster in einem eigenen Browserfenster.
 *
 * Seitenmenü und Navigation fallen weg — sie wären dort nur Wege zurück ins
 * Journal, also genau die Ablenkung, gegen die eine Handelssitzung mit festem
 * Plan gedacht ist. Der Inhalt bekommt dafür die ganze Breite.
 *
 * Bewusst an der URL (`?cockpit=1`) und nicht an einer Einstellung: dasselbe
 * Fenster soll sich auch neu laden lassen und dabei Cockpit bleiben.
 */
const istCockpit = computed(() => String(route.query?.cockpit || '') === '1')

/**
 * Vollbild räumt dieselbe Umgebung weg wie das Cockpit.
 *
 * Ich hatte das zuerst getrennt gehalten mit dem Argument, im Vollbild
 * verschwinde ohnehin nur die Browserleiste. Das ist zwar richtig, aber es geht
 * am Zweck vorbei: wer Vollbild drückt, will die Fläche für die Kacheln — und
 * ein Seitenmenü, das im Vollbild als Einziges stehen bleibt, ist genau der
 * Rand, den man loswerden wollte.
 *
 * Der Weg zurück bleibt immer offen: Esc verlässt das Vollbild, und die
 * Kopfzeile des Live-Fensters trägt weiterhin ihren eigenen Knopf.
 */
const imVollbild = useImVollbild()
const chromeAus = computed(() => istCockpit.value || imVollbild.value)

// ── Datenschutz-/Zensur-Modus ──
// Blendet Zahlen/Kontostände im Journal-Inhalt unkenntlich aus. Nur im Journal:
// im Live-Modus wären verwischte Kurse sinnlos.
const mainEl = ref(null)
let stopZensur = null
function aktualisiereZensur() {
    const an = privacyMode.value && appMode.value === 'journal' && !!mainEl.value
    if (an && !stopZensur) {
        stopZensur = starteZensur(mainEl.value)
    } else if (!an && stopZensur) {
        stopZensur()
        stopZensur = null
    }
}
watch([privacyMode, appMode], aktualisiereZensur)

/*
 * Wache für abgeschaltete Modi.
 *
 * Hier und nicht im Router: beim kalten Deep-Link sind die Einstellungen noch
 * nicht geladen, `currentUser` ist null, und eine `beforeEach`-Wache müsste
 * raten. Sie würde falsch raten — jeder Aufruf von /marktradar landete bei
 * langsamem Einstellungsabruf im Journal. Deshalb wartet die Wache: solange
 * nichts geladen ist, leitet sie nichts um.
 *
 * Und hier statt je Seite: das Layout hängt an JEDER Route. Fünf Kopien
 * derselben Watch in fünf Views wären fünf Stellen, die auseinanderlaufen.
 *
 * Beide Quellen werden gebraucht:
 *   `currentUser` — die Einstellungen treffen verspätet ein (Deep-Link).
 *   `route.fullPath` — Navigation innerhalb der App (Zurück-Knopf, altes
 *                      Lesezeichen), wenn die Einstellungen längst da sind.
 *
 * `livetradingAn` bleibt davon unberührt: das ist ein Seiten-Flag und wird
 * weiterhin in `Livetrading.vue` selbst bewacht.
 */
const router = useRouter()
watch([currentUser, () => route.fullPath], ([u]) => {
  if (!u) return
  const modus = route.meta?.mode
  // Modusneutrale Seiten (Einstellungen, Konten) und das Journal haben keinen
  // Schalter — sie sind immer erreichbar.
  if (!modus || modus === 'any' || modus === 'journal') return
  if (istModusAn(modus, u)) return
  router.replace(modeHome(ersterAktiverModus(u)))
}, { immediate: true })
onMounted(aktualisiereZensur)
onUnmounted(() => { if (stopZensur) { stopZensur(); stopZensur = null } })


/*========================================
  Functions used on all Dashboard components
========================================*/
onBeforeMount(async () => {
  usePageId()
  await useInitParse()
  // Sync language from DB settings to i18n. Nur Deutsch liegt im
  // Start-Bundle; eine andere Sprache wird hier nachgeladen.
  await setLocale(currentUser.value?.language || 'de')
  useGetTimeZone()
  useScreenType()
  // Live-Analyse-Einstellungen aus den Settings übernehmen (auch im Journal —
  // die Einstellungen-Seite zeigt sie dort)
  hydrateLiveSettings()

  // Ab hier nur noch Journal-Ballast (Trade-Filter, Bewertungs-Popups, Polling)
  if (!isJournal.value) return

  await useGetPeriods()
  await useSetValues()

  // Load available tags for evaluation popup
  await useGetAvailableTags()

  // Update pending evaluation counters and start polling
  // This runs after currentUser is loaded, so showTradePopups check works.
  // TradeEvalPopup watches evalNotificationShown and shows popup when counts > 0.
  // Request notification permission if enabled
  if (currentUser.value?.browserNotifications !== 0) {
    requestNotificationPermission()
  }

  if (currentUser.value?.showTradePopups !== 0) {
    console.log(' -> Dashboard: updating pending evaluation counts')
    await useUpdatePendingCounts()
    useStartGlobalPolling()
  }
})

// Re-sync dynamic period ranges (thisMonth/thisWeek/...) when the app
// regains focus, so a month rollover while the tab was hidden is picked up.
async function refreshPeriodsOnVisible() {
  if (document.visibilityState !== 'visible' || !isJournal.value) return
  try {
    await useGetPeriods()
    await useSetValues()
  } catch (e) {
    logWarn('Period refresh failed:', e)
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', refreshPeriodsOnVisible)
  window.addEventListener('focus', refreshPeriodsOnVisible)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', refreshPeriodsOnVisible)
  window.removeEventListener('focus', refreshPeriodsOnVisible)
})

onUnmounted(() => {
  useStopGlobalPolling()
})

/**
 * Zurück-Geste schliesst das ausgefahrene Handy-Menü, statt die Seite zu
 * verlassen. Auf dem Desktop läuft das nie an, weil das Menü dort nicht
 * ausfährt und `sideMenuMobileOut` false bleibt.
 */
watch(sideMenuMobileOut, (offen) => {
  if (offen) ebeneAuf(useCloseMobileMenu)
  else ebeneZu(useCloseMobileMenu)
})

// KI-Bericht Polling: Wenn ein Bericht generiert wird und der User NICHT auf der KI-Agent-Seite ist,
// pollen wir ob der Server den Bericht schon gespeichert hat und senden eine Benachrichtigung.
// Wir watchen BEIDE Refs: aiReportGenerating UND pageId — damit das Polling auch startet,
// wenn der User erst nach dem Start des Berichts die Seite wechselt.
let aiPollInterval = null
let lastAiPollErrorTs = 0
watch([aiReportGenerating, pageId], ([generating, page]) => {
  if (generating && isJournal.value && page !== 'kiAgent' && currentUser.value?.aiEnabled !== false && currentUser.value?.aiEnabled !== 0) {
    // Polling starten (falls noch nicht aktiv)
    if (!aiPollInterval) {
      aiPollInterval = setInterval(async () => {
        try {
          const res = await axios.get('/api/ai/reports')
          if (res.data.length > aiReportCountBefore.value) {
            // Neuer Report gefunden — Benachrichtigung senden und Polling stoppen
            sendNotification('kiBerichtFertig', _t('notifications.reportReady'), _t('notifications.reportCreated', { label: aiReportLabel.value || 'Zeitraum' }))
            aiReportGenerating.value = false
            clearInterval(aiPollInterval)
            aiPollInterval = null
          }
        } catch (e) {
          // Throttle logging to avoid console spam during temporary outages
          const now = Date.now()
          if (now - lastAiPollErrorTs > 15000) {
            logWarn('dashboard-layout', 'KI-Report-Polling fehlgeschlagen', e)
            lastAiPollErrorTs = now
          }
        }
      }, 5000)
    }
  } else if (!generating && aiPollInterval) {
    clearInterval(aiPollInterval)
    aiPollInterval = null
  }
})
</script>
<template>
  <ReturnToTopButton />
  <div v-cloak class="container-fluid g-0">
    <div class="row g-0">
      <div v-if="!chromeAus" id="sideMenu" v-bind:class="'min-vh-100 ' +
        (screenType == 'computer' ? 'sideMenu col-2' : 'sideMenuMobile')
        ">
        <SideMenu />
      </div>
      <div :class="[chromeAus ? 'col-12' : 'col-12 col-lg-10', 'position-relative']">
        <!-- Tippen neben das ausgefahrene Menü schliesst es. Vorher stand hier
             ein Name, den es im Setup nie gab — der Klick lief ins Leere. -->
        <div v-show="sideMenuMobileOut" class="sideMenuMobileOut position-absolute" v-on:click="useCloseMobileMenu"></div>
        <Nav v-if="!chromeAus" />
        <main ref="mainEl">
          <div v-if="isAgent" class="ps-3 pe-3 pt-3">
            <!-- Die Anleitung hängt am Layout statt an einer Seite: sie ist
                 damit von JEDER Agent-Seite aus erreichbar — auch wenn der
                 Beta-Hinweis für die Sitzung weggeklickt wurde. -->
            <div class="d-flex justify-content-end mb-2">
              <PageInfo section="info.agent" />
            </div>
            <BetaHinweis />
          </div>
          <slot />
        </main>
      </div>
      <!--footer-->
    </div>
  </div>
  <!-- Modal -->
  <div class="modal fade" id="fullScreenModal" tabindex="-1" aria-labelledby="fullScreenModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-fullscreen">
      <div class="modal-content">
        <div class="modal-body">
          <Screenshot v-if="Object.keys(selectedScreenshot).length > 0" :index="selectedScreenshotIndex" source="fullScreen" :screenshot-data="selectedScreenshot" />
        </div>
        <div class="modal-footer">
          <!-- NEXT / PREVIOUS -->
          
            <div class="text-start">
              <button v-if="selectedScreenshotIndex - 1 >= 0" class="btn btn-outline-primary btn-sm ms-3 mb-2"
                v-on:click="useSelectedScreenshotFunction((selectedScreenshotIndex - 1), 'fullScreen')">
                <i class="fa fa-chevron-left me-2"></i></button>
            </div>
            <div v-if="selectedScreenshotIndex + 1 > 0 && screenshots[selectedScreenshotIndex + 1]"
              class="ms-auto text-end">
              <button class="btn btn-outline-primary btn-sm me-3 mb-2"
                v-on:click="useSelectedScreenshotFunction((selectedScreenshotIndex + 1), 'fullScreen')"
                :disabled="getMore"><span v-if="!getMore"><i class="fa fa-chevron-right ms-2"></i></span>
                <span v-else>
                  <div class="spinner-border spinner-border-sm" role="status">
                  </div>
                </span>
              </button>
            </div>
          
        </div>
      </div>
    </div>
  </div>
  <!-- Trade Evaluation Popup -->
  <TradeEvalPopup v-if="isJournal" />
</template>