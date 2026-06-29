package com.tradingjournal.widget

import android.content.Context

/**
 * Thin SharedPreferences wrapper. Everything is keyed per appWidgetId so multiple
 * widget instances (e.g. different filters) stay independent. Stores both the
 * user config (host/port/key/filter) and the last fetched payload (cache).
 */
object Prefs {
    private const val FILE = "trading_widget_prefs"

    private fun sp(ctx: Context) =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    // --- Config ---
    fun host(ctx: Context, id: Int): String = sp(ctx).getString("host_$id", "") ?: ""
    fun port(ctx: Context, id: Int): String = sp(ctx).getString("port_$id", "8080") ?: "8080"
    fun key(ctx: Context, id: Int): String = sp(ctx).getString("key_$id", "") ?: ""
    fun filter(ctx: Context, id: Int): String = sp(ctx).getString("filter_$id", "month") ?: "month"

    fun isConfigured(ctx: Context, id: Int): Boolean =
        host(ctx, id).isNotBlank() && key(ctx, id).isNotBlank()

    fun saveConfig(ctx: Context, id: Int, host: String, port: String, key: String, filter: String) {
        sp(ctx).edit()
            .putString("host_$id", host.trim())
            .putString("port_$id", port.trim().ifBlank { "8080" })
            .putString("key_$id", key.trim())
            .putString("filter_$id", filter)
            .apply()
    }

    // --- Cache (last successful payload) ---
    fun cachedJson(ctx: Context, id: Int): String? = sp(ctx).getString("cache_$id", null)
    fun updatedAt(ctx: Context, id: Int): Long = sp(ctx).getLong("updated_$id", 0L)
    fun lastError(ctx: Context, id: Int): String? = sp(ctx).getString("error_$id", null)

    fun saveCache(ctx: Context, id: Int, json: String, whenMs: Long) {
        sp(ctx).edit()
            .putString("cache_$id", json)
            .putLong("updated_$id", whenMs)
            .remove("error_$id")
            .apply()
    }

    fun saveError(ctx: Context, id: Int, message: String) {
        sp(ctx).edit().putString("error_$id", message).apply()
    }

    // --- Balance-Sichtbarkeit (Augen-Toggle, pro Widget) ---
    fun hideBalance(ctx: Context, id: Int): Boolean = sp(ctx).getBoolean("hidebal_$id", false)
    fun setHideBalance(ctx: Context, id: Int, hide: Boolean) {
        sp(ctx).edit().putBoolean("hidebal_$id", hide).apply()
    }

    fun clear(ctx: Context, id: Int) {
        sp(ctx).edit()
            .remove("host_$id").remove("port_$id").remove("key_$id").remove("filter_$id")
            .remove("cache_$id").remove("updated_$id").remove("error_$id")
            .remove("hidebal_$id")
            .apply()
    }
}
