package com.tradingjournal.widget.model

import org.json.JSONObject

/** A single futures position as returned in openPositions[]. */
data class Position(
    val broker: String,
    val symbol: String,
    val side: String,
    val leverage: Double,
    val entryPrice: Double,
    val markPrice: Double,
    val unrealizedPNL: Double,
    val realizedPNL: Double
)

/** A single running bot as returned in the new bots[] array. PnL/margin in marginCoin. */
data class Bot(
    val symbol: String,
    val side: String,
    val leverage: Double,
    val entryPrice: Double,
    val markPrice: Double,
    val unrealizedPNL: Double,
    val marginCoin: String,
    val liqPrice: Double,
    val coinM: Boolean
)

/** KPIs für eine einzelne Börse (aus dem brokers-Objekt des Endpoints). */
data class BrokerKpis(
    val balance: Double?,
    val todayPnL: Double,
    val totalPnL: Double,
    val winRate: Double
)

/** Parsed payload of GET /api/esp32/display. */
data class DisplayData(
    val balance: Double?,
    val todayPnL: Double,
    val totalPnL: Double,
    val winRate: Double,
    val positions: List<Position>,
    val bots: List<Bot>,
    val primaryBroker: String,
    val brokers: Map<String, BrokerKpis>
) {
    companion object {
        fun parse(json: String): DisplayData {
            val o = JSONObject(json)
            val balance = if (o.isNull("balance")) null else o.optDouble("balance")

            val positions = ArrayList<Position>()
            o.optJSONArray("openPositions")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val p = arr.getJSONObject(i)
                    positions.add(
                        Position(
                            broker = p.optString("broker"),
                            symbol = p.optString("symbol"),
                            side = p.optString("side"),
                            leverage = p.optDouble("leverage", 0.0),
                            entryPrice = p.optDouble("entryPrice", 0.0),
                            markPrice = p.optDouble("markPrice", 0.0),
                            unrealizedPNL = p.optDouble("unrealizedPNL", 0.0),
                            realizedPNL = p.optDouble("realizedPNL", 0.0)
                        )
                    )
                }
            }

            val bots = ArrayList<Bot>()
            o.optJSONArray("bots")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val b = arr.getJSONObject(i)
                    bots.add(
                        Bot(
                            symbol = b.optString("symbol"),
                            side = b.optString("side"),
                            leverage = b.optDouble("leverage", 0.0),
                            entryPrice = b.optDouble("entryPrice", 0.0),
                            markPrice = b.optDouble("markPrice", 0.0),
                            unrealizedPNL = b.optDouble("unrealizedPNL", 0.0),
                            marginCoin = b.optString("marginCoin", "USDT"),
                            liqPrice = b.optDouble("liqPrice", 0.0),
                            coinM = b.optBoolean("coinM", false)
                        )
                    )
                }
            }

            val topToday = o.optDouble("todayPnL", 0.0)
            val topTotal = o.optDouble("totalPnL", 0.0)
            val topWin = o.optDouble("winRate", 0.0)
            val primaryBroker = o.optString("primaryBroker", "bitunix")

            // KPIs je Börse (Reihenfolge wie vom Server: bitunix, bitget, pionex)
            val brokers = LinkedHashMap<String, BrokerKpis>()
            o.optJSONObject("brokers")?.let { bo ->
                val keys = bo.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    val bk = bo.getJSONObject(k)
                    brokers[k] = BrokerKpis(
                        balance = if (bk.isNull("balance")) null else bk.optDouble("balance"),
                        todayPnL = bk.optDouble("todayPnL", 0.0),
                        totalPnL = bk.optDouble("totalPnL", 0.0),
                        winRate = bk.optDouble("winRate", 0.0)
                    )
                }
            }
            // Fallback für ältere Server ohne brokers-Map: Top-Level als Primär-Börse.
            if (brokers.isEmpty()) brokers[primaryBroker] = BrokerKpis(balance, topToday, topTotal, topWin)

            return DisplayData(
                balance = balance,
                todayPnL = topToday,
                totalPnL = topTotal,
                winRate = topWin,
                positions = positions,
                bots = bots,
                primaryBroker = primaryBroker,
                brokers = brokers
            )
        }
    }
}
