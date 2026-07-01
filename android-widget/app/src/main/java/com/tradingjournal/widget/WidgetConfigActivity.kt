package com.tradingjournal.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.tradingjournal.widget.model.DisplayData
import kotlin.concurrent.thread

/**
 * Configuration screen. Opened automatically when the widget is added, and again
 * when the user taps the widget title. Stores host/port/key/filter per appWidgetId.
 */
class WidgetConfigActivity : AppCompatActivity() {

    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    // Spinner-Werte (Position ↔ gespeicherter Wert)
    private val filterVals  = listOf("all", "month", "week", "year")
    private val filterNames = listOf("Gesamt", "Monat", "Woche", "Jahr")
    private val brokerVals  = listOf("auto", "bitunix", "bitget", "pionex")
    private val brokerNames = listOf("Automatisch (Primär)", "Bitunix", "Bitget", "Pionex")

    private fun setupSpinner(spinner: Spinner, names: List<String>) {
        spinner.adapter = ArrayAdapter(this, R.layout.spinner_item, names).apply {
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }
    }


    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Default result = canceled, so dismissing the dialog removes a freshly-added widget.
        setResult(Activity.RESULT_CANCELED)
        setContentView(R.layout.activity_config)

        widgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }

        val host = findViewById<EditText>(R.id.in_host)
        val port = findViewById<EditText>(R.id.in_port)
        val key = findViewById<EditText>(R.id.in_key)
        val filterSpin = findViewById<Spinner>(R.id.in_filter)
        val brokerSpin = findViewById<Spinner>(R.id.in_broker)
        val status = findViewById<TextView>(R.id.status)

        setupSpinner(filterSpin, filterNames)
        setupSpinner(brokerSpin, brokerNames)

        // Prefill from any existing config.
        host.setText(Prefs.host(this, widgetId))
        if (Prefs.port(this, widgetId).isNotBlank()) port.setText(Prefs.port(this, widgetId))
        key.setText(Prefs.key(this, widgetId))
        filterSpin.setSelection(filterVals.indexOf(Prefs.filter(this, widgetId)).coerceAtLeast(0))
        brokerSpin.setSelection(brokerVals.indexOf(Prefs.defaultBroker(this, widgetId)).coerceAtLeast(0))

        findViewById<Button>(R.id.btn_test).setOnClickListener {
            val h = host.text.toString().trim()
            val p = port.text.toString().trim().ifBlank { "8080" }
            val k = key.text.toString().trim()
            if (h.isBlank() || k.isBlank()) {
                status.text = getString(R.string.cfg_need_fields); return@setOnClickListener
            }
            val f = filterVals[filterSpin.selectedItemPosition.coerceAtLeast(0)]
            status.text = getString(R.string.cfg_testing)
            thread {
                val msg = try {
                    ApiClient.fetch(h, p, k, f)
                    getString(R.string.cfg_test_ok)
                } catch (e: Exception) {
                    getString(R.string.cfg_test_fail, e.message ?: "?")
                }
                runOnUiThread { status.text = msg }
            }
        }

        findViewById<Button>(R.id.btn_save).setOnClickListener {
            val h = host.text.toString().trim()
            val p = port.text.toString().trim().ifBlank { "8080" }
            val k = key.text.toString().trim()
            if (h.isBlank() || k.isBlank()) {
                status.text = getString(R.string.cfg_need_fields); return@setOnClickListener
            }
            val f = filterVals[filterSpin.selectedItemPosition.coerceAtLeast(0)]
            val db = brokerVals[brokerSpin.selectedItemPosition.coerceAtLeast(0)]
            Prefs.saveConfig(this, widgetId, h, p, k, f, db)
            status.text = getString(R.string.cfg_testing)

            // Daten gleich hier holen + cachen, damit das Widget sofort befüllt
            // ist — unabhängig davon, ob der WorkManager-Job (Hintergrund) auf
            // diesem Gerät zeitnah/überhaupt läuft (Akku-Restriktionen etc.).
            thread {
                try {
                    val json = ApiClient.fetch(h, p, k, f)
                    DisplayData.parse(json)
                    Prefs.saveCache(applicationContext, widgetId, json, System.currentTimeMillis())
                    Prefs.clearSelectedBroker(applicationContext, widgetId)
                } catch (e: Exception) {
                    Prefs.saveError(applicationContext, widgetId, e.message ?: "Fehler")
                }
                runOnUiThread {
                    val awm = AppWidgetManager.getInstance(applicationContext)
                    TradingWidgetProvider.updateWidget(applicationContext, awm, widgetId)
                    TradingWidgetProvider.triggerRefresh(applicationContext, force = true)
                    setResult(Activity.RESULT_OK, Intent().putExtra(
                        AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
                    finish()
                }
            }
        }
    }
}
