package com.cyserrex.taut

import android.os.Handler
import android.os.Looper
import java.net.HttpURLConnection
import java.net.URL

/**
 * Apakah PC-nya masih menjawab di alamat yang tersimpan.
 *
 * Diperlukan untuk membedakan dua keadaan yang dari luar terlihat sama:
 * halaman remote sama-sama berhenti melapor ketika PC-nya hilang, dan ketika
 * PC-nya baik-baik saja tapi YouTube Music sedang tidak terbuka. Yang pertama
 * harus dicari ulang alamatnya; yang kedua tidak boleh diapa-apakan, karena
 * memuat ulang halaman hanya akan mengedipkan tampilan tanpa guna.
 *
 * Yang ditanya /api/info, dan jawabannya sengaja tidak dibaca — cukup tahu
 * ada yang menjawab. Dari luar loopback, endpoint itu memang tidak memuat
 * PIN maupun token.
 */
object Reachability {

    /** Sengaja pendek: ini berjalan berkala, bukan sekali seumur hidup. */
    private const val TIMEOUT_MS = 3000

    fun check(host: String, port: Int, onDone: (Boolean) -> Unit) {
        Thread {
            val alive = ask(host, port)
            Handler(Looper.getMainLooper()).post { onDone(alive) }
        }.start()
    }

    private fun ask(host: String, port: Int): Boolean {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL("http://$host:$port/api/info").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
            }
            // Kode apa pun berarti ada yang menjawab di sana. Yang menandakan
            // PC hilang adalah sambungan yang gagal, bukan jawaban yang aneh.
            connection.responseCode > 0
        } catch (_: Exception) {
            false
        } finally {
            connection?.disconnect()
        }
    }
}
