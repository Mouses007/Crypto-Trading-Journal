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

            android.util.Log.d("TJWidget", "refreshAllWidgets: ${ids.size} Widget(s)")
            for (id in ids) {
                if (!Prefs.isConfigured(ctx, id)) { android.util.Log.d("TJWidget", "  id=$id nicht konfiguriert → skip"); continue }
                val t0 = System.currentTimeMillis()
                android.util.Log.d("TJWidget", "  fetch id=$id → ${Prefs.host(ctx, id)}:${Prefs.port(ctx, id)}")
                try {
                    val json = ApiClient.fetch(
                        Prefs.host(ctx, id), Prefs.port(ctx, id),
                        Prefs.key(ctx, id), Prefs.filter(ctx, id)
                    )
                    DisplayData.parse(json)   // validate before caching
                    Prefs.saveCache(ctx, id, json, System.currentTimeMillis())
                    android.util.Log.d("TJWidget", "  fetch OK id=$id (${json.length}B, ${System.currentTimeMillis() - t0}ms)")
                } catch (e: Exception) {
                    Prefs.saveError(ctx, id, e.message ?: "Fehler")
                    android.util.Log.w("TJWidget", "  fetch FAIL id=$id (${System.currentTimeMillis() - t0}ms): ${e.message}")
                }
            }

            // Volles updateWidget: baut Kopf/KPIs UND die eingebetteten Collection-Items
            // (RemoteCollectionItems) neu aus dem Cache → Liste aktualisiert ohne Service-
            // Binding (kein Freeze-Problem), Spinner wird zurückgesetzt.
            for (id in ids) TradingWidgetProvider.updateWidget(ctx, awm, id)
            android.util.Log.d("TJWidget", "Widgets aktualisiert (${ids.size})")
        }
    }
}
