package com.tradingjournal.widget

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import com.tradingjournal.widget.model.DisplayData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Fetches the endpoint for every widget instance, writes the result (or error) to
 * Prefs, then re-binds the widgets and reloads the collection. Used by the periodic
 * background job AND directly (goAsync) by the tap-refresh — see refreshAllWidgets().
 */
class RefreshWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        refreshAllWidgets(applicationContext)
        Result.success()
    }

    // Für Expedited-Work: auf API <31 läuft der Job als kurzer Foreground-Service
    // (braucht diese Notification, IMPORTANCE_MIN → praktisch unsichtbar). Ab API 31
    // wird er als Expedited-Job ohne Notification ausgeführt.
    override suspend fun getForegroundInfo(): ForegroundInfo {
        val channelId = "trading_refresh"
        val nm = applicationContext.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(channelId, "Aktualisierung", NotificationManager.IMPORTANCE_MIN)
        )
        val notif: Notification = Notification.Builder(applicationContext, channelId)
            .setSmallIcon(R.drawable.ic_refresh)
            .setContentTitle(applicationContext.getString(R.string.app_name))
            .setContentText(applicationContext.getString(R.string.w_refreshing))
            .build()
        return if (Build.VERSION.SDK_INT >= 34)
            ForegroundInfo(42, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else ForegroundInfo(42, notif)
    }

    companion object {
        /**
         * Blocking refresh of all widget instances. Caller MUST run this off the main
         * thread (CoroutineWorker on Dispatchers.IO, or a plain background thread from
         * a BroadcastReceiver's goAsync()). Network failures are caught per-widget and
         * surfaced as the offline state — it never throws, so the spinner always resets.
         */
        fun refreshAllWidgets(ctx: Context) {
            val awm = AppWidgetManager.getInstance(ctx)
            val ids = awm.getAppWidgetIds(ComponentName(ctx, TradingWidgetProvider::class.java))

            for (id in ids) {
                if (!Prefs.isConfigured(ctx, id)) continue
                try {
                    val json = ApiClient.fetch(
                        Prefs.host(ctx, id), Prefs.port(ctx, id),
                        Prefs.key(ctx, id), Prefs.filter(ctx, id)
                    )
                    DisplayData.parse(json)   // validate before caching
                    Prefs.saveCache(ctx, id, json, System.currentTimeMillis())
                } catch (e: Exception) {
                    Prefs.saveError(ctx, id, e.message ?: "Fehler")
                }
            }

            // Liste über notify neu laden (Factory.onDataSetChanged liest neuen Cache),
            // Kopf/KPIs per Partial-Update — NICHT volles updateWidget (würde den Adapter
            // neu setzen → Liste lädt nicht zuverlässig neu).
            if (ids.isNotEmpty()) awm.notifyAppWidgetViewDataChanged(ids, R.id.list)
            for (id in ids) TradingWidgetProvider.refreshChrome(ctx, awm, id)
        }
    }
}
