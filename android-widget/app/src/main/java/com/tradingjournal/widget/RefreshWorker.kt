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
 * Fetches the endpoint for every widget instance, writes the result (or error) to
 * Prefs, then re-binds the widgets and reloads the collection. Used by the periodic
 * background job AND directly (goAsync) by the tap-refresh — see refreshAllWidgets().
 */
class RefreshWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        refreshAllWidgets(applicationContext)
        Result.success()
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

            for (id in ids) TradingWidgetProvider.updateWidget(ctx, awm, id)
            if (ids.isNotEmpty()) awm.notifyAppWidgetViewDataChanged(ids, R.id.list)
        }
    }
}
