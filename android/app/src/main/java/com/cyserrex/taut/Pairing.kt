package com.cyserrex.taut

import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Menukar PIN yang tampil di terminal PC dengan token yang bisa disimpan.
 *
 * Menemukan PC di jaringan tidak sama dengan berhak mengendalikannya. PIN
 * enam angka itu buktinya: hanya orang yang benar-benar melihat layar
 * komputer tersebut yang bisa membacanya. Setelah berhasil sekali, tokennya
 * disimpan dan PIN tidak pernah diminta lagi.
 */
object Pairing {

    sealed interface Result {
        data class Success(val token: String) : Result
        data class WrongPin(val remaining: String?) : Result
        data class Locked(val retryAfterSeconds: Int) : Result
        data class Unreachable(val message: String) : Result
    }

    /**
     * Tanya PC apakah PIN diperlukan, sebelum menampilkan kolomnya.
     *
     * Dipakai untuk alamat yang dimasukkan manual — yang tidak lewat
     * pencarian, jadi tidak membawa petunjuknya sendiri. Kalau tidak
     * terjawab, anggap perlu.
     */
    fun needsPin(host: String, port: Int, onDone: (Boolean) -> Unit) {
        Thread {
            val needed = askNeedsPin(host, port)
            Handler(Looper.getMainLooper()).post { onDone(needed) }
        }.start()
    }

    private fun askNeedsPin(host: String, port: Int): Boolean {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL("http://$host:$port/api/info").openConnection() as HttpURLConnection).apply {
                connectTimeout = 3000
                readTimeout = 3000
            }
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            JSONObject(body).optBoolean("pinRequired", true)
        } catch (_: Exception) {
            true
        } finally {
            connection?.disconnect()
        }
    }

    fun pair(host: String, port: Int, pin: String, onDone: (Result) -> Unit) {
        Thread {
            val result = request(host, port, pin)
            Handler(Looper.getMainLooper()).post { onDone(result) }
        }.start()
    }

    private fun request(host: String, port: Int, pin: String): Result {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL("http://$host:$port/api/pair").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 4000
                readTimeout = 4000
                setRequestProperty("Content-Type", "application/json")
            }

            connection.outputStream.use {
                it.write(JSONObject().put("pin", pin).toString().toByteArray())
            }

            val code = connection.responseCode
            val body = (if (code in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()
                ?.use { it.readText() }
                .orEmpty()

            when (code) {
                200 -> {
                    val token = JSONObject(body).optString("token")
                    if (token.isEmpty()) {
                        Result.Unreachable("Server menjawab tanpa token")
                    } else {
                        Result.Success(token)
                    }
                }
                429 -> Result.Locked(runCatching { JSONObject(body).optInt("retryAfter", 60) }.getOrDefault(60))
                401 -> Result.WrongPin(null)
                else -> Result.Unreachable("Server menjawab $code")
            }
        } catch (error: Exception) {
            Result.Unreachable(error.message ?: "Tidak bisa menghubungi PC")
        } finally {
            connection?.disconnect()
        }
    }
}
