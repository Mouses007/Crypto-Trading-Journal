package com.tradingjournal.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import androidx.core.content.ContextCompat
import com.tradingjournal.widget.model.Bot
import com.tradingjournal.widget.model.DisplayData
import com.tradingjournal.widget.model.Position
import java.util.Locale

class PositionsRemoteViewsService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        val id = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID
        )
        return PositionsFactory(applicationContext, id)
    }
}

/** Item types in the flat list the collection renders. */
private sealed class Row {
    data class Header(val title: String, val total: String) : Row()
    data class Future(val p: Position) : Row()
    data class BotRow(val b: Bot) : Row()
}

private const val TYPE_HEADER = 0
private const val TYPE_FUTURE = 1
private const val TYPE_BOT = 2

private class PositionsFactory(
    private val ctx: Context,
    private val widgetId: Int
) : RemoteViewsService.RemoteViewsFactory {

    private var rows: List<Row> = emptyList()

    override fun onCreate() {}
    override fun onDestroy() { rows = emptyList() }

    override fun onDataSetChanged() {
        rows = buildRows()
    }

    private fun buildRows(): List<Row> {
        val json = Prefs.cachedJson(ctx, widgetId) ?: return emptyList()
        val data = try { DisplayData.parse(json) } catch (e: Exception) { return emptyList() }
        val out = ArrayList<Row>()

        if (data.positions.isNotEmpty()) {
            val total = data.positions.sumOf { it.unrealizedPNL }
            out.add(Row.Header(ctx.getString(R.string.w_futures), signed(total, 2) + " USDT"))
            data.positions.forEach { out.add(Row.Future(it)) }
        }
        if (data.bots.isNotEmpty()) {
            out.add(Row.Header(ctx.getString(R.string.w_bots), data.bots.size.toString()))
            data.bots.forEach { out.add(Row.BotRow(it)) }
        }
        return out
    }

    override fun getCount(): Int = rows.size
    override fun getViewTypeCount(): Int = 3
    override fun hasStableIds(): Boolean = false
    override fun getItemId(position: Int): Long = position.toLong()
    override fun getLoadingView(): RemoteViews? = null

    override fun getViewAt(position: Int): RemoteViews {
        return when (val row = rows[position]) {
            is Row.Header -> RemoteViews(ctx.packageName, R.layout.widget_row_header).apply {
                setTextViewText(R.id.header_title, row.title)
                setTextViewText(R.id.header_total, row.total)
            }
            is Row.Future -> renderFuture(row.p)
            is Row.BotRow -> renderBot(row.b)
        }
    }

    private fun renderFuture(p: Position): RemoteViews {
        val rv = RemoteViews(ctx.packageName, R.layout.widget_row_future)
        rv.setTextViewText(R.id.row_symbol, p.symbol)
        val sub = "${sideLabel(p.side)} · ${lev(p.leverage)} · @${price(p.entryPrice)} → ${price(p.markPrice)}"
        rv.setTextViewText(R.id.row_sub, sub)
        rv.setTextViewText(R.id.row_pnl, signed(p.unrealizedPNL, 2))
        rv.setTextColor(R.id.row_pnl, pnlColor(p.unrealizedPNL))
        if (p.realizedPNL != 0.0) {
            rv.setTextViewText(R.id.row_pnl2, "real ${signed(p.realizedPNL, 2)}")
        } else {
            rv.setTextViewText(R.id.row_pnl2, "")
        }
        return rv
    }

    private fun renderBot(b: Bot): RemoteViews {
        val rv = RemoteViews(ctx.packageName, R.layout.widget_row_bot)
        rv.setTextViewText(R.id.row_symbol, b.symbol)
        val liq = if (b.liqPrice > 0) " · Liq ${price(b.liqPrice)}" else ""
        val sub = "${sideLabel(b.side)} · ${lev(b.leverage)} · Ø${price(b.entryPrice)}$liq"
        rv.setTextViewText(R.id.row_sub, sub)
        val dec = if (b.marginCoin == "USDT") 2 else 4
        rv.setTextViewText(R.id.row_pnl, "${signed(b.unrealizedPNL, dec)} ${b.marginCoin}")
        rv.setTextColor(R.id.row_pnl, pnlColor(b.unrealizedPNL))
        return rv
    }

    // --- formatting helpers (mirror the desklet) ---
    private fun pnlColor(v: Double) =
        ContextCompat.getColor(ctx, if (v >= 0) R.color.profit else R.color.loss)

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

    private fun signed(v: Double, dec: Int): String {
        val sign = if (v >= 0) "+" else ""
        return sign + String.format(Locale.US, "%.${dec}f", v)
    }
}
