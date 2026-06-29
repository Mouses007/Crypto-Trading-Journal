package com.tradingjournal.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.tradingjournal.widget.model.DisplayData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Fetches the endpoint off the main thread for every widget instance, writes the
 * result (or error) to Prefs, then re-binds the widgets and tells the collection
 * to reload. Enqueued periodically (~15 min) and on demand (tap / add).
 */
class RefreshWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val ctx = applicationContext
        val awm = AppWidgetManager.getInstance(ctx)
        val ids = awm.getAppWidgetIds(ComponentName(ctx, TradingWidgetProvider::class.java))

        for (id in ids) {
            if (!Prefs.isConfigured(ctx, id)) continue
            try {
                val json = ApiClient.fetch(
                    Prefs.host(ctx, id), Prefs.port(ctx, id),
                    Prefs.key(ctx, id), Prefs.filter(ctx, id)
                )
                // Validate it parses before caching.
                DisplayData.parse(json)
                Prefs.saveCache(ctx, id, json, System.currentTimeMillis())
            } catch (e: Exception) {
                Prefs.saveError(ctx, id, e.message ?: "Fehler")
            }
        }

        // Re-bind headers/KPIs and reload the list contents for all instances.
        for (id in ids) TradingWidgetProvider.updateWidget(ctx, awm, id)
        if (ids.isNotEmpty()) awm.notifyAppWidgetViewDataChanged(ids, R.id.list)

        Result.success()
    }
}
