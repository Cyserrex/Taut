package com.cyserrex.taut

import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException

/**
 * Mencari PC yang menjalankan Taut di jaringan yang sama.
 *
 * Alasan keberadaannya sederhana: alamat IP komputer berubah setiap kali
 * router membagikannya ulang. Kalau aplikasi menyimpan alamat mentah, suatu
 * pagi Taut akan "rusak" tanpa sebab yang jelas bagi pemakainya. Dengan
 * bertanya ke seluruh jaringan, alamat yang berubah tidak lagi jadi masalah.
 */
object Discovery {

    private const val PROBE = "TAUT-DISCOVER"
    private const val REPLY_BUFFER = 512

    data class Server(
        val host: String,
        val name: String,
        val port: Int,
        val version: String,
    )

    /**
     * Sebarkan pertanyaan, kumpulkan jawaban sampai waktunya habis.
     *
     * @param port port tempat server Taut mendengarkan
     * @param timeoutMs lama mendengarkan; 1,5 detik cukup untuk WiFi rumahan
     * @param onDone dipanggil di thread utama dengan daftar PC yang menjawab
     */
    fun scan(
        port: Int,
        timeoutMs: Int = 1500,
        onDone: (List<Server>) -> Unit,
    ) {
        Thread {
            val found = LinkedHashMap<String, Server>()
            var socket: DatagramSocket? = null

            try {
                socket = DatagramSocket().apply {
                    broadcast = true
                    soTimeout = 250
                }

                val probe = PROBE.toByteArray()
                for (address in broadcastAddresses()) {
                    try {
                        socket.send(DatagramPacket(probe, probe.size, address, port))
                    } catch (_: Exception) {
                        // Satu antarmuka jaringan menolak; yang lain tetap dicoba.
                    }
                }

                val deadline = System.currentTimeMillis() + timeoutMs
                val buffer = ByteArray(REPLY_BUFFER)

                while (System.currentTimeMillis() < deadline) {
                    val packet = DatagramPacket(buffer, buffer.size)
                    try {
                        socket.receive(packet)
                    } catch (_: SocketTimeoutException) {
                        continue
                    }

                    parse(packet)?.let { found[it.host] = it }
                }
            } catch (_: Exception) {
                // Jaringan tidak tersedia. Daftar kosong sudah cukup menjelaskan.
            } finally {
                socket?.close()
            }

            val result = found.values.toList()
            Handler(Looper.getMainLooper()).post { onDone(result) }
        }.start()
    }

    private fun parse(packet: DatagramPacket): Server? = try {
        val json = JSONObject(String(packet.data, 0, packet.length))
        if (json.optString("app") != "taut") {
            null
        } else {
            Server(
                host = packet.address.hostAddress ?: return null,
                name = json.optString("name", "PC"),
                port = json.optInt("port", 8787),
                version = json.optString("version", "?"),
            )
        }
    } catch (_: Exception) {
        null
    }

    /**
     * Alamat broadcast tiap antarmuka, ditambah 255.255.255.255 sebagai
     * cadangan. Beberapa perangkat Android mengabaikan alamat umum itu, jadi
     * alamat per-antarmuka yang biasanya benar-benar sampai.
     */
    private fun broadcastAddresses(): List<InetAddress> {
        val addresses = mutableListOf<InetAddress>()

        try {
            for (nic in NetworkInterface.getNetworkInterfaces()) {
                if (!nic.isUp || nic.isLoopback) continue
                for (address in nic.interfaceAddresses) {
                    address.broadcast?.let { addresses.add(it) }
                }
            }
        } catch (_: Exception) {
            // Sebagian ROM membatasi penyebutan antarmuka; cadangan di bawah tetap ada.
        }

        try {
            addresses.add(InetAddress.getByName("255.255.255.255"))
        } catch (_: Exception) {
            // Tidak apa-apa; alamat per-antarmuka di atas sudah cukup.
        }

        return addresses
    }
}
