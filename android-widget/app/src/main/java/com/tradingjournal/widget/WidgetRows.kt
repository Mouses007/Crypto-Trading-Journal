package com.tradingjournal.widget

import android.content.Context
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import com.tradingjournal.widget.model.Bot
import com.tradingjournal.widget.model.DisplayData
import com.tradingjournal.widget.model.Position
import java.util.Locale

/**
 * Baut die Listen-Items als [RemoteViews.RemoteCollectionItems] (ab Android 12) und
 * bettet sie DIREKT in die Widget-RemoteViews ein — KEIN RemoteViewsService.
 *
 * Grund: Mit einem RemoteViewsService muss sich der Launcher an unseren Prozess
 * binden, um die Liste zu füllen. Auf Geräten mit aggressivem App-Freezer (Pixel/
 * Android 14+) ist unser Prozess eingefroren → die Bindung verzögert sich um bis zu
 * Minuten (logcat: "Slow delivery ... ServiceCollectionCache$ConnectionTask") → die
 * Liste aktualisiert nicht. Eingebettete Items brauchen kein Binding.
 */
object WidgetRows {

    /** Baut die Collection für ein Widget aus dem gecachten Payload. */
    fun build(ctx: Context, widgetId: Int): RemoteViews.RemoteCollectionItems {
        val builder = RemoteViews.RemoteCollectionItems.Builder()
            .setHasStableIds(false)
            .setViewTypeCount(3)   // header / future / bot

        val json = Prefs.cachedJson(ctx, widgetId)
        val data = json?.let { try { DisplayData.parse(it) } catch (e: Exception) { null } }
        if (data != null) {
            var id = 0L
            // Futures nach Börse gruppiert (alphabetisch), je Sektion mit Summen-PnL.
            data.positions.groupBy { it.broker.ifBlank { "?" } }.toSortedMap()
                .forEach { (broker, list) ->
                    val total = list.sumOf { it.unrealizedPNL }
                    builder.addItem(id++, header(ctx, brokerLabel(broker), signed(total, 2) + " USDT"))
                    list.forEach { builder.addItem(id++, renderFuture(ctx, it)) }
                }
            // Bots (Pionex) als eigene Sektion darunter.
            if (data.bots.isNotEmpty()) {
                builder.addItem(id++, header(ctx,
                    brokerLabel("pionex") + " " + ctx.getString(R.string.w_bots),
                    data.bots.size.toString()))
                data.bots.forEach { builder.addItem(id++, renderBot(ctx, it)) }
            }
        }
        return builder.build()
    }

    private fun header(ctx: Context, title: String, total: String) =
        RemoteViews(ctx.packageName, R.layout.widget_row_header).apply {
            setTextViewText(R.id.header_title, title)
            setTextViewText(R.id.header_total, total)
        }

    private fun renderFuture(ctx: Context, p: Position): RemoteViews {
        val rv = RemoteViews(ctx.packageName, R.layout.widget_row_future)
        rv.setTextViewText(R.id.row_symbol, p.symbol)
        rv.setTextViewText(R.id.row_sub,
            "${sideLabel(p.side)} · ${lev(p.leverage)} · @${price(p.entryPrice)} → ${price(p.markPrice)}")
        rv.setTextViewText(R.id.row_pnl, signed(p.unrealizedPNL, 2))
        rv.setTextColor(R.id.row_pnl, pnlColor(ctx, p.unrealizedPNL))
        rv.setTextViewText(R.id.row_pnl2, if (p.realizedPNL != 0.0) "real ${signed(p.realizedPNL, 2)}" else "")
        return rv
    }

    private fun renderBot(ctx: Context, b: Bot): RemoteViews {
        val rv = RemoteViews(ctx.packageName, R.layout.widget_row_bot)
        rv.setTextViewText(R.id.row_symbol, b.symbol)
        val liq = if (b.liqPrice > 0) " · Liq ${price(b.liqPrice)}" else ""
        rv.setTextViewText(R.id.row_sub,
            "${sideLabel(b.side)} · ${lev(b.leverage)} · Ø${price(b.entryPrice)}$liq")
        val dec = if (b.marginCoin == "USDT") 2 else 4
        rv.setTextViewText(R.id.row_pnl, "${signed(b.unrealizedPNL, dec)} ${b.marginCoin}")
        rv.setTextColor(R.id.row_pnl, pnlColor(ctx, b.unrealizedPNL))
        return rv
    }

    // --- formatting helpers ---
    private fun pnlColor(ctx: Context, v: Double) =
        ContextCompat.getColor(ctx, if (v >= 0) R.color.profit else R.color.loss)

    private fun brokerLabel(b: String): String = when (b.lowercase(Locale.ROOT)) {
        "bitunix" -> "Bitunix"
        "bitget"  -> "Bitget"
        "pionex"  -> "Pionex"
        else      -> b.replaceFirstChar { it.uppercase() }
    }

    private fun sideLabel(side: String): String {
        val s = side.lowercase(Locale.ROOT)
        return if (s == "buy" || s == "long") "long" else if (s == "sell" || s == "short") "short" else side
    }

    private fun lev(l: Double): String =
        if (l <= 0) "–" else "${if (l % 1.0 == 0.0) l.toInt().toString() else l.toString()}x"

    private fun price(v: Double): String = when {
        v <= 0 -> "–"
        v >= 1000 -> String.format(Locale.GERMAN, "%,.0f", v)
        v >= 1 -> String.format(Locale.US, "%.4f", v)
        else -> String.format(Locale.US, "%.6f", v)
    }

    private fun signed(v: Double, dec: Int): String =
        (if (v >= 0) "+" else "") + String.format(Locale.US, "%.${dec}f", v)
}
