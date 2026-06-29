package com.tradingjournal.widget

import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * Minimal networking layer. One GET to the public, key-authenticated ESP32 endpoint.
 * No cookies, no session — the X-ESP32-Key header is the entire auth, so this is
 * unaffected by the journal's optional password gate.
 */
object ApiClient {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    /** Returns the raw JSON body on success, or throws on network/HTTP error. */
    fun fetch(host: String, port: String, key: String, filter: String): String {
        val url = "http://$host:$port/api/esp32/display?filter=$filter"
        val req = Request.Builder()
            .url(url)
            .header("X-ESP32-Key", key)
            .get()
            .build()

        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string() ?: ""
            if (!resp.isSuccessful) {
                val hint = when (resp.code) {
                    401 -> "Key ungültig (401)"
                    404 -> "Endpoint nicht gefunden (404)"
                    else -> "HTTP ${resp.code}"
                }
                throw RuntimeException(hint)
            }
            return body
        }
    }
}
