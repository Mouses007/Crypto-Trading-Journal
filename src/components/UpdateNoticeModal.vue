<script setup>
/**
 * Einmaliger Hinweis nach einem Update (bzw. bei Erstnutzung): erklärt, wie die
 * Pionex-API für die Bot-Funktionen einzurichten ist. Wird über ein localStorage-
 * Flag genau EINMAL gezeigt und danach nie wieder.
 */
import { ref, onMounted } from 'vue'

const STORAGE_KEY = 'pionexApiNoticeSeen'
const show = ref(false)

onMounted(() => {
    try {
        if (localStorage.getItem(STORAGE_KEY) !== '1') show.value = true
    } catch (_) { /* localStorage nicht verfügbar → nicht zeigen */ }
})

function dismiss() {
    show.value = false
    try { localStorage.setItem(STORAGE_KEY, '1') } catch (_) { /* egal */ }
}

function goToSettings() {
    dismiss()
    window.location.href = '/settings'
}
</script>

<template>
    <Teleport to="body">
        <div v-if="show" class="update-notice-overlay" @click.self="dismiss">
            <div class="update-notice-modal">
                <div class="d-flex align-items-center mb-3">
                    <i class="uil uil-robot me-2" style="font-size:1.5rem;color:#3b82f6;"></i>
                    <h6 class="mb-0">Pionex-API für Bots einrichten</h6>
                </div>

                <p class="notice-intro">
                    Damit deine Trading-Bots automatisch importiert und live verfolgt werden,
                    muss eine Pionex-API hinterlegt werden. Beim Erstellen des API-Keys auf Pionex bitte beachten:
                </p>

                <ul class="notice-list">
                    <li>
                        <i class="uil uil-check-circle"></i>
                        <span>Berechtigung <strong>„Bots nur lesen"</strong> aktivieren (Read-only für Bots).</span>
                    </li>
                    <li>
                        <i class="uil uil-exclamation-circle warn"></i>
                        <span><strong>IP-Beschränkung NICHT aktivieren</strong> — keine IP-Adresse eintragen, sonst schlägt die Verbindung fehl.</span>
                    </li>
                </ul>

                <p class="notice-hint">
                    Den erstellten API-Key &amp; Secret anschließend unter
                    <strong>Einstellungen → Pionex</strong> eintragen.
                </p>

                <div class="d-flex justify-content-end gap-2 mt-3">
                    <button class="btn btn-sm btn-outline-secondary" @click="dismiss">Verstanden</button>
                    <button class="btn btn-sm btn-primary" @click="goToSettings">Zu den Einstellungen</button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.update-notice-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
}

.update-notice-modal {
    background: var(--black-bg-3, #1a1a2e);
    border: 1px solid var(--white-18, rgba(255, 255, 255, 0.18));
    border-radius: var(--border-radius, 10px);
    padding: 1.5rem;
    max-width: 480px;
    width: 100%;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}

.notice-intro {
    font-size: 0.88rem;
    color: var(--white-70, rgba(255, 255, 255, 0.75));
    margin-bottom: 1rem;
}

.notice-list {
    list-style: none;
    padding: 0;
    margin: 0 0 1rem 0;
}

.notice-list li {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    font-size: 0.88rem;
    color: var(--white-87, rgba(255, 255, 255, 0.9));
    padding: 0.4rem 0;
}

.notice-list li i {
    font-size: 1.1rem;
    color: #22c55e;
    flex: 0 0 auto;
    margin-top: 0.05rem;
}

.notice-list li i.warn {
    color: #f59e0b;
}

.notice-hint {
    font-size: 0.82rem;
    color: var(--white-60, rgba(255, 255, 255, 0.6));
    margin: 0;
    padding-top: 0.5rem;
    border-top: 1px solid var(--white-10, rgba(255, 255, 255, 0.1));
}
</style>
