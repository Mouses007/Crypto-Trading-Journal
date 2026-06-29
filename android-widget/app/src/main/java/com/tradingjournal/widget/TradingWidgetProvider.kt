package com.tradingjournal.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import kotlin.concurrent.thread
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.Constraints
import androidx.work.OneTimeWorkRequestBuilder
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
        enqueuePeriodic(context)
        triggerRefresh(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val awm = AppWidgetManager.getInstance(context)
        when (intent.action) {
            ACTION_REFRESH -> {
                // Sofort-Feedback: Spinner an.
                val ids = awm.getAppWidgetIds(ComponentName(context, TradingWidgetProvider::class.java))
                for (id in ids) setRefreshing(context, awm, id)
                // Direkt im Receiver holen (goAsync) — NICHT über WorkManager, der auf
                // manchen Geräten (z.B. Pixel) den Job nicht zeitnah ausführt → Spinner
                // drehte endlos. refreshAllWidgets fängt Fehler ab → Spinner reset immer.
                val pending = goAsync()
                val appCtx = context.applicationContext
                thread {
                    try { RefreshWorker.refreshAllWidgets(appCtx) }
                    finally { pending.finish() }
                }
            }
            ACTION_TOGGLE_BALANCE -> {
                val id = intent.getIntExtra(
                    AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
                if (id != AppWidgetManager.INVALID_APPWIDGET_ID) {
                    Prefs.setHideBalance(context, id, !Prefs.hideBalance(context, id))
                    updateWidget(context, awm, id)   // kein Netz nötig, nur Re-Render
                }
            }
        }
    }

    override fun onEnabled(context: Context) = enqueuePeriodic(context)

    override fun onDisabled(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        for (id in ids) Prefs.clear(context, id)
    }

    companion object {
        const val ACTION_REFRESH = "com.tradingjournal.widget.ACTION_REFRESH"
        const val ACTION_TOGGLE_BALANCE = "com.tradingjournal.widget.ACTION_TOGGLE_BALANCE"
        private const val PERIODIC_WORK = "trading_refresh_periodic"
        private const val ONESHOT_WORK = "trading_refresh_oneshot"

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

            // Collection adapter — unique data Uri per id so each widget gets its own factory.
            val svc = Intent(context, PositionsRemoteViewsService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            rv.setRemoteAdapter(R.id.list, svc)
            rv.setEmptyView(R.id.list, R.id.empty)

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
                if (d != null) {
                    val balText = if (Prefs.hideBalance(context, id)) "••••"
                                  else d.balance?.let { fmt(it, 0) + " $" } ?: "–"
                    setKpi(context, rv, R.id.kpi_balance, balText, null)
                    setKpi(context, rv, R.id.kpi_today, signed(d.todayPnL, 0), d.todayPnL)
                    setKpi(context, rv, R.id.kpi_total, signed(d.totalPnL, 0), d.totalPnL)
                    setKpi(context, rv, R.id.kpi_winrate,
                        fmt(d.winRate, 0) + "%", null)
                }
            }

            val ts = Prefs.updatedAt(context, id)
            val tstr = if (ts > 0) SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ts)) else "–"
            val err = Prefs.lastError(context, id)
            rv.setTextViewText(
                R.id.updated,
                if (err != null) context.getString(R.string.w_offline, tstr)
                else context.getString(R.string.w_updated, tstr)
            )
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
        fun triggerRefresh(context: Context) {
            val req = OneTimeWorkRequestBuilder<RefreshWorker>().build()
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
