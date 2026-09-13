package com.cyserrex.taut

import android.content.Context

/**
 * Ingatan Taut tentang PC yang sudah dipasangkan.
 *
 * Token disimpan terpisah dari alamat: alamat IP boleh berubah kapan saja dan
 * akan diperbarui sendiri lewat pencarian, sementara token tetap berlaku
 * sampai pengguna mengganti token di PC.
 */
class Prefs(context: Context) {

    private val store = context.getSharedPreferences("taut", Context.MODE_PRIVATE)

    var host: String?
        get() = store.getString(KEY_HOST, null)
        set(value) = store.edit().putString(KEY_HOST, value).apply()

    var port: Int
        get() = store.getInt(KEY_PORT, DEFAULT_PORT)
        set(value) = store.edit().putInt(KEY_PORT, value).apply()

    var token: String?
        get() = store.getString(KEY_TOKEN, null)
        set(value) = store.edit().putString(KEY_TOKEN, value).apply()

    /** Nama komputer, sekadar untuk ditampilkan. */
    var serverName: String?
        get() = store.getString(KEY_NAME, null)
        set(value) = store.edit().putString(KEY_NAME, value).apply()

    val isPaired: Boolean
        get() = !host.isNullOrEmpty() && !token.isNullOrEmpty()

    fun save(server: Discovery.Server, token: String) {
        store.edit()
            .putString(KEY_HOST, server.host)
            .putInt(KEY_PORT, server.port)
            .putString(KEY_NAME, server.name)
            .putString(KEY_TOKEN, token)
            .apply()
    }

    /** Simpan alamat baru tanpa menyentuh token — dipakai setelah IP berpindah. */
    fun updateAddress(host: String, port: Int) {
        store.edit().putString(KEY_HOST, host).putInt(KEY_PORT, port).apply()
    }

    fun forget() {
        store.edit().clear().apply()
    }

    val remoteUrl: String
        get() = "http://$host:$port/#t=$token"

    companion object {
        const val DEFAULT_PORT = 8787

        private const val KEY_HOST = "host"
        private const val KEY_PORT = "port"
        private const val KEY_TOKEN = "token"
        private const val KEY_NAME = "name"
    }
}
