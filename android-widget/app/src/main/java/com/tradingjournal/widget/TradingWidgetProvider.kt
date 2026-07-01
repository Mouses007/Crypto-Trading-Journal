package com.tradingjournal.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.Constraints
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.tradingjournal.widget.model.DisplayData
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

class TradingWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, awm: AppWidgetManager, ids: IntArray) {
        for (id in ids) updateWidget(context, awm, id)
        scheduleAlarm(context)
        // ENTPRELLT: onUpdate wird vom System auch bei jeder Paket-Änderung neu gefeuert.
        // Der Expedited-Refresh-Job schaltet aber intern eine WorkManager-Komponente
        // an/aus → das IST eine Paket-Änderung → onUpdate → … Endlosschleife. Darum den
        // Auto-Refresh entprellen; der manuelle Tap (ACTION_REFRESH) läuft weiter sofort.
        triggerRefresh(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val awm = AppWidgetManager.getInstance(context)
        when (intent.action) {
            ACTION_REFRESH -> {
                // Sofort-Feedback: Spinner an, dann Expedited-Job (läuft auch im
                // Hintergrund mit Netz — anders als ein normaler Receiver/Worker, den
                // der Pixel einfriert → Spinner drehte endlos).
                android.util.Log.d("TJWidget", "↻ Tap → Refresh angestoßen")
                val ids = awm.getAppWidgetIds(ComponentName(context, TradingWidgetProvider::class.java))
                for (id in ids) setRefreshing(context, awm, id)
                triggerRefresh(context, force = true)   // Nutzer-Tap: nie entprellen
            }
            ACTION_TOGGLE_BALANCE -> {
                val id = intent.getIntExtra(
                    AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
                if (id != AppWidgetManager.INVALID_APPWIDGET_ID) {
                    Prefs.setHideBalance(context, id, !Prefs.hideBalance(context, id))
                    updateWidget(context, awm, id)   // kein Netz nötig, nur Re-Render
                }
            }
            ACTION_SELECT_BROKER -> {
                // Tap auf eine Börsen-Sektion/Position → Kopf-KPIs auf diese Börse
                // umschalten (kein Netz, nur Re-Render). Hält bis zur nächsten Aktualisierung.
                val id = intent.getIntExtra(
                    AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
                val broker = intent.getStringExtra(EXTRA_BROKER)
                if (id != AppWidgetManager.INVALID_APPWIDGET_ID && !broker.isNullOrBlank()) {
                    Prefs.setSelectedBroker(context, id, broker)
                    updateWidget(context, awm, id)
                }
            }
            ACTION_ALARM -> {
                // 15-min-Auto-Refresh: jetzt aktualisieren + nächsten Alarm planen
                // (setAndAllowWhileIdle ist one-shot → muss neu gesetzt werden).
                triggerRefresh(context)
                scheduleAlarm(context)
            }
        }
    }

    override fun onEnabled(context: Context) = scheduleAlarm(context)

    override fun onDisabled(context: Context) {
        cancelAlarm(context)
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        for (id in ids) Prefs.clear(context, id)
    }

    companion object {
        const val ACTION_REFRESH = "com.tradingjournal.widget.ACTION_REFRESH"
        const val ACTION_TOGGLE_BALANCE = "com.tradingjournal.widget.ACTION_TOGGLE_BALANCE"
        const val ACTION_ALARM = "com.tradingjournal.widget.ACTION_ALARM"
        const val ACTION_SELECT_BROKER = "com.tradingjournal.widget.ACTION_SELECT_BROKER"
        const val EXTRA_BROKER = "broker"
        private const val PERIODIC_WORK = "trading_refresh_periodic"
        private const val ONESHOT_WORK = "trading_refresh_oneshot"
        private const val REFRESH_INTERVAL_MS = 15 * 60 * 1000L
        // Mindestabstand zwischen Auto-Refreshes (onUpdate/Alarm) — Loop-Schutz.
        private const val AUTO_REFRESH_DEBOUNCE_MS = 5_000L

        private fun alarmIntent(context: Context): PendingIntent {
            val i = Intent(context, TradingWidgetProvider::class.java).setAction(ACTION_ALARM)
            return PendingIntent.getBroadcast(
                context, 99, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }

        /** Plant den nächsten Auto-Refresh in 15 min. setAndAllowWhileIdle feuert auch
         *  im Doze (eine Wiederholung pro ~9–15 min) — zuverlässiger als WorkManager-
         *  Periodic, ohne Notification/Extra-Berechtigung. One-shot → bei jedem Feuern neu. */
        fun scheduleAlarm(context: Context) {
            val am = context.getSystemService(AlarmManager::class.java) ?: return
            am.setAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + REFRESH_INTERVAL_MS,
                alarmIntent(context)
            )
        }

        fun cancelAlarm(context: Context) {
            context.getSystemService(AlarmManager::class.java)?.cancel(alarmIntent(context))
        }

        /** Zeigt sofort den Lade-Spinner + "Aktualisiere…" (Tap-Feedback). */
        private fun setRefreshing(context: Context, awm: AppWidgetManager, id: Int) {
            val rv = RemoteViews(context.packageName, R.layout.widget_main)
            rv.setViewVisibility(R.id.btn_refresh, View.GONE)
            rv.setViewVisibility(R.id.refreshing, View.VISIBLE)
            rv.setTextViewText(R.id.updated, context.getString(R.string.w_refreshing))
            awm.partiallyUpdateAppWidget(id, rv)
        }


        /** Builds + pushes the RemoteViews for one widget instance (header, KPIs, list adapter). */
        fun updateWidget(context: Context, awm: AppWidgetManager, id: Int) {
            val rv = RemoteViews(context.packageName, R.layout.widget_main)

            // Collection-Items DIREKT einbetten (RemoteCollectionItems, API 31+) — kein
            // RemoteViewsService/Binding (das auf Pixel/Android 14+ durch App-Freezing
            // minutenlang verzögert wurde → Liste lud nicht). Items kommen aus dem Cache.
            rv.setRemoteAdapter(R.id.list, WidgetRows.build(context, id))
            rv.setEmptyView(R.id.list, R.id.empty)

            // Klick-Template für die Listen-Items: jede Zeile liefert per Fill-In-Intent
            // ihre Börse → ACTION_SELECT_BROKER schaltet den Kopf um. MUTABLE, damit der
            // Fill-In die Daten ergänzen kann.
            val selTemplate = Intent(context, TradingWidgetProvider::class.java)
                .setAction(ACTION_SELECT_BROKER)
                .setData(Uri.parse("tradingwidget://select/$id"))
            rv.setPendingIntentTemplate(
                R.id.list,
                PendingIntent.getBroadcast(
                    context, id, selTemplate,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
                )
            )

            // Refresh button → broadcast back to this provider.
            val refreshIntent = Intent(context, TradingWidgetProvider::class.java)
                .setAction(ACTION_REFRESH)
            rv.setOnClickPendingIntent(
                R.id.btn_refresh,
                PendingIntent.getBroadcast(
                    context, id, refreshIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )

            // Eye toggle → broadcast (Saldo zensieren/zeigen), trägt die Widget-id mit.
            val eyeIntent = Intent(context, TradingWidgetProvider::class.java)
                .setAction(ACTION_TOGGLE_BALANCE)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                .setData(Uri.parse("tradingwidget://eye/$id"))
            rv.setOnClickPendingIntent(
                R.id.btn_eye,
                PendingIntent.getBroadcast(
                    context, id, eyeIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )
            rv.setImageViewResource(
                R.id.btn_eye,
                if (Prefs.hideBalance(context, id)) R.drawable.ic_eye_off else R.drawable.ic_eye
            )
            // Refresh-Ruhezustand (Spinner aus) — setRefreshing() schaltet ihn beim Tap an.
            rv.setViewVisibility(R.id.refreshing, View.GONE)
            rv.setViewVisibility(R.id.btn_refresh, View.VISIBLE)

            // Title tap → (re)open the config screen for this widget.
            val cfg = Intent(context, WidgetConfigActivity::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                data = Uri.parse("tradingwidget://config/$id")
            }
            rv.setOnClickPendingIntent(
                R.id.title,
                PendingIntent.getActivity(
                    context, id, cfg,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )

            applyHeader(context, rv, id)
            awm.updateAppWidget(id, rv)
        }

        /** Sets KPI texts + "updated/offline" line from the cached payload. */
        private fun applyHeader(context: Context, rv: RemoteViews, id: Int) {
            if (!Prefs.isConfigured(context, id)) {
                rv.setTextViewText(R.id.empty, context.getString(R.string.w_tap_config))
                rv.setTextViewText(R.id.updated, "")
                rv.setTextViewText(R.id.kpi_broker, "")
                setKpi(context, rv, R.id.kpi_balance, "–", null)
                setKpi(context, rv, R.id.kpi_today, "–", null)
                setKpi(context, rv, R.id.kpi_total, "–", null)
                setKpi(context, rv, R.id.kpi_winrate, "–", null)
                return
            }

            rv.setTextViewText(R.id.empty, context.getString(R.string.w_no_positions))

            val json = Prefs.cachedJson(context, id)
            if (json != null) {
                val d = try { DisplayData.parse(json) } catch (e: Exception) { null }
                if (d != null && d.brokers.isNotEmpty()) {
                    val broker = resolveBroker(context, id, d)
                    val k = d.brokers[broker]!!
                    rv.setTextViewText(R.id.kpi_broker, brokerLabel(broker))

                    val balText = if (Prefs.hideBalance(context, id)) "••••"
                                  else k.balance?.let { fmt(it, 0) + " $" } ?: "–"
                    setKpi(context, rv, R.id.kpi_balance, balText, null)
                    setKpi(context, rv, R.id.kpi_total, signed(k.totalPnL, 0), k.totalPnL)

                    if (broker == "pionex") {
                        // Bots: „Heute/WinRate" sind hier wenig aussagekräftig → ausblenden,
                        // nur Saldo + Gesamt-PnL zeigen.
                        setKpi(context, rv, R.id.kpi_today, "–", null)
                        setKpi(context, rv, R.id.kpi_winrate, "–", null)
                    } else {
                        setKpi(context, rv, R.id.kpi_today, signed(k.todayPnL, 0), k.todayPnL)
                        setKpi(context, rv, R.id.kpi_winrate, fmt(k.winRate, 0) + "%", null)
                    }
                }
            }

            // Immer nur die Uhrzeit der letzten erfolgreichen Aktualisierung. Kein
            // "offline"-Hinweis mehr (verwirrte nur) — bleibt ein Refresh erfolglos,
            // steht einfach die alte Uhrzeit da, das sieht man am Timestamp.
            val ts = Prefs.updatedAt(context, id)
            val tstr = if (ts > 0) SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ts)) else "–"
            rv.setTextViewText(R.id.updated, context.getString(R.string.w_updated, tstr))
        }

        /** Welche Börse oben gezeigt wird: getippte (transient) → Default-Config → Primär → erste. */
        private fun resolveBroker(context: Context, id: Int, d: DisplayData): String {
            val sel = Prefs.selectedBroker(context, id)
            if (sel != null && d.brokers.containsKey(sel)) return sel
            val def = Prefs.defaultBroker(context, id)
            if (def != "auto" && d.brokers.containsKey(def)) return def
            if (d.brokers.containsKey(d.primaryBroker)) return d.primaryBroker
            return d.brokers.keys.first()
        }

        private fun brokerLabel(b: String): String = when (b.lowercase(Locale.ROOT)) {
            "bitunix" -> "Bitunix"
            "bitget"  -> "Bitget"
            "pionex"  -> "Pionex"
            else      -> b.replaceFirstChar { it.uppercase() }
        }

        private fun setKpi(context: Context, rv: RemoteViews, viewId: Int, text: String, signFor: Double?) {
            rv.setTextViewText(viewId, text)
            if (signFor != null) {
                val c = if (signFor >= 0) R.color.profit else R.color.loss
                rv.setTextColor(viewId, ContextCompat.getColor(context, c))
            } else {
                rv.setTextColor(viewId, ContextCompat.getColor(context, R.color.text_primary))
            }
        }

        fun enqueuePeriodic(context: Context) {
            val req = PeriodicWorkRequestBuilder<RefreshWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        // Einmaliger Refresh (Tap / Add / Save) — BEWUSST OHNE Netz-Constraint:
        // sonst wartet der Job bei fehlendem/instabilem Netz (z.B. VPN-Wechsel auf
        // dem Pixel) ewig und der Spinner dreht endlos. Ohne Constraint läuft er
        // sofort, der Fetch hat selbst 10s Timeout, und updateWidget setzt den
        // Spinner danach IMMER zurück (zeigt sonst „⚠ offline").
        fun triggerRefresh(context: Context, force: Boolean = false) {
            // Entprellung: Auto-Refreshes (onUpdate/Alarm) nur zulassen, wenn der letzte
            // Auto-Refresh länger als AUTO_REFRESH_DEBOUNCE_MS her ist. Bricht die
            // onUpdate→Expedited-Work→PackageChanged→onUpdate-Schleife (~1×/s), ohne
            // legitime Refreshes (Widget-Add, 15-min-Alarm, Tap=force) zu behindern.
            val now = System.currentTimeMillis()
            if (!force && now - Prefs.lastAutoRefresh(context) < AUTO_REFRESH_DEBOUNCE_MS) {
                android.util.Log.d("TJWidget", "Auto-Refresh entprellt")
                return
            }
            Prefs.setLastAutoRefresh(context, now)
            val req = OneTimeWorkRequestBuilder<RefreshWorker>()
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(ONESHOT_WORK, ExistingWorkPolicy.REPLACE, req)
        }

        private fun fmt(v: Double, dec: Int) = String.format(Locale.GERMAN, "%,.${dec}f", v)
        private fun signed(v: Double, dec: Int): String {
            val sign = if (v >= 0) "+" else ""
            return sign + String.format(Locale.US, "%.${dec}f", v)
        }
    }
}
