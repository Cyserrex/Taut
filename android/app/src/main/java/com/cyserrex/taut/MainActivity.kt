package com.cyserrex.taut

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.JavascriptInterface
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.cyserrex.taut.databinding.ActivityMainBinding
import org.json.JSONObject

/**
 * Layar remote.
 *
 * Isinya halaman remote yang sama persis dengan yang dibuka lewat browser,
 * dimuat di dalam WebView. Yang ditambahkan aplikasi ini adalah hal-hal yang
 * tidak bisa dilakukan sebuah halaman web di Android:
 *
 *   · menemukan PC lagi sendiri ketika alamat IP-nya berpindah,
 *   · memakai tombol volume fisik HP untuk mengatur volume di PC,
 *   · menjaga layar tetap menyala selama lagu berputar.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var views: ActivityMainBinding
    private lateinit var prefs: Prefs

    /** Dinaikkan setiap sekali tekan tombol volume — terasa pas saat dicoba. */
    private val volumeStep = 5

    /** Menahan agar pencarian ulang tidak berjalan dua kali bersamaan. */
    private var recovering = false

    /**
     * Halaman remote melapor kira-kira sekali sedetik selama tersambung.
     * Diam lebih lama dari ini berarti ada yang perlu diperiksa.
     */
    private val silenceBeforeProbe = 20_000L

    /** Selang pemeriksaan. Yang mahal hanya probe, dan itu jarang terjadi. */
    private val watchInterval = 5_000L

    /** Jeda sebelum mencari lagi setelah pencarian sebelumnya gagal. */
    private val pauseAfterFailure = 30_000L

    private val clock = Handler(Looper.getMainLooper())

    /** Kapan halaman remote terakhir melapor. */
    private var lastReportAt = 0L

    /** Tidak memeriksa apa pun sebelum waktu ini — dipakai setelah gagal. */
    private var quietUntil = 0L

    private var probing = false

    private var networkWatch: ConnectivityManager.NetworkCallback? = null

    private lateinit var nowPlaying: NowPlaying

    /**
     * Meminta izin notifikasi.
     *
     * Hasilnya sengaja tidak ditindaklanjuti: kalau ditolak, Taut tetap
     * berfungsi penuh — hanya kendali di layar kunci yang tidak muncul, dan
     * memaksa pengguna memutuskannya dua kali tidak mengubah apa pun.
     */
    private val askNotificationPermission =
        registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)

        if (!prefs.isPaired) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }

        views = ActivityMainBinding.inflate(layoutInflater)
        setContentView(views.root)

        nowPlaying = NowPlaying(this) { command -> sendToRemote(command) }
        nowPlaying.start()
        requestNotificationPermission()

        setUpWebView()
        views.offlineRetry.setOnClickListener { recover() }
        views.offlineForget.setOnClickListener {
            prefs.forget()
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
        }

        watchNetwork()
        lastReportAt = SystemClock.elapsedRealtime()
        views.web.loadUrl(prefs.remoteUrl)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWebView() {
        // Halaman remote melapor ke sini setiap kali keadaannya berubah.
        views.web.addJavascriptInterface(Bridge(), "TautAndroid")

        views.web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        views.web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                showOffline(false)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                // Hanya kegagalan halaman utama yang berarti PC-nya hilang;
                // gambar sampul yang gagal dimuat bukan urusan kita.
                if (request?.isForMainFrame == true) recover()
            }
        }
    }

    // ------------------------------------------------- mencari PC yang pindah

    /**
     * Alamat tersimpan tidak menjawab. Sebelum menyerah, cari lagi di jaringan:
     * biasanya PC-nya masih di sana, hanya dapat alamat baru dari router.
     */
    private fun recover() {
        if (recovering) return
        recovering = true

        showOffline(true, getString(R.string.reconnecting), busy = true)

        Discovery.scan(prefs.port) { servers ->
            if (isFinishing) return@scan

            val match = servers.firstOrNull()
            if (match == null) {
                recovering = false
                // Jangan langsung mencari lagi: kalau PC-nya memang mati,
                // mengulanginya tiap beberapa detik hanya membuat tampilan
                // berkedip tanpa hasil.
                quietUntil = SystemClock.elapsedRealtime() + pauseAfterFailure
                showOffline(true, getString(R.string.lost_server), busy = false)
                return@scan
            }

            // Token tetap berlaku; yang berubah hanya alamatnya.
            prefs.updateAddress(match.host, match.port)
            prefs.serverName = match.name
            recovering = false
            lastReportAt = SystemClock.elapsedRealtime()
            views.web.loadUrl(prefs.remoteUrl)
        }
    }

    // ------------------------------------------------ menjaga sambungan hidup

    private val watchLink = object : Runnable {
        override fun run() {
            probeIfSilent()
            clock.postDelayed(this, watchInterval)
        }
    }

    /**
     * Kalau halaman sudah lama diam, pastikan dulu PC-nya benar-benar hilang
     * sebelum mengganggu tampilan.
     *
     * Halaman remote menyambung ulang sendiri, tapi selalu ke alamat yang sama
     * — kalau router memberi PC alamat baru, ia akan mengetuk alamat lama itu
     * selamanya dan tidak ada yang memulai pencarian. Di sinilah pencarian itu
     * dimulai.
     *
     * Diamnya halaman saja belum cukup jadi alasan: kalau YouTube Music
     * sekadar belum dibuka, halaman juga diam padahal PC-nya baik-baik saja.
     * Karena itu ditanya dulu, dan memuat ulang hanya kalau memang tidak ada
     * yang menjawab.
     */
    private fun probeIfSilent() {
        if (recovering || probing) return

        val now = SystemClock.elapsedRealtime()
        if (now < quietUntil) return
        if (now - lastReportAt < silenceBeforeProbe) return

        val host = prefs.host ?: return
        probing = true
        Reachability.check(host, prefs.port) { alive ->
            probing = false
            if (isFinishing) return@check

            if (alive) {
                // Masih menjawab: berarti hanya YouTube Music yang belum
                // dibuka. Dianggap saja baru melapor, supaya tidak ditanya
                // berulang-ulang selama lagunya memang tidak diputar.
                lastReportAt = SystemClock.elapsedRealtime()
            } else {
                recover()
            }
        }
    }

    /**
     * Jaringan kembali — misalnya HP baru sampai rumah dan menyambung ke WiFi.
     *
     * Tanpa ini yang tersisa hanya percobaan ulang halaman remote ke alamat
     * lama, dan menunggu giliran pemeriksaan berikutnya. Izin
     * ACCESS_NETWORK_STATE di manifest memang untuk ini.
     */
    private fun watchNetwork() {
        val manager = getSystemService(ConnectivityManager::class.java) ?: return

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread { onNetworkBack() }
            }
        }

        try {
            manager.registerDefaultNetworkCallback(callback)
            networkWatch = callback
        } catch (_: Exception) {
            // Tanpa pemberitahuan jaringan, pemeriksaan berkala tetap jalan.
        }
    }

    private fun onNetworkBack() {
        if (recovering || isFinishing || !this::views.isInitialized) return

        // Jaringan yang baru datang membatalkan jeda kegagalan sebelumnya:
        // kegagalan itu terjadi di jaringan yang sudah tidak berlaku lagi.
        quietUntil = 0

        if (views.offline.visibility == View.VISIBLE) recover() else probeIfSilent()
    }

    /**
     * Layar ditahan hanya selama lagu berputar.
     *
     * Remote memang sering diletakkan di meja sambil dilihat sesekali, tapi
     * menahannya juga saat musik berhenti berarti Taut yang tertinggal
     * terbuka di saku akan menyalakan layar sampai baterai habis.
     */
    private fun keepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun showOffline(visible: Boolean, title: String? = null, busy: Boolean = false) {
        views.offline.visibility = if (visible) View.VISIBLE else View.GONE
        if (!visible) return

        title?.let { views.offlineTitle.text = it }
        views.offlineSpinner.visibility = if (busy) View.VISIBLE else View.GONE
        views.offlineHint.visibility = if (busy) View.GONE else View.VISIBLE
        views.offlineRetry.visibility = if (busy) View.GONE else View.VISIBLE
        views.offlineForget.visibility = if (busy) View.GONE else View.VISIBLE
    }

    // ------------------------------------------------------- tombol volume HP

    /**
     * Tombol volume fisik diarahkan ke volume PC, bukan volume HP — remote ini
     * tidak mengeluarkan suara apa pun, jadi mengatur volume HP tidak ada
     * gunanya. Kalau halaman remote belum siap, biarkan Android menanganinya
     * seperti biasa.
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        val step = when (keyCode) {
            KeyEvent.KEYCODE_VOLUME_UP -> volumeStep
            KeyEvent.KEYCODE_VOLUME_DOWN -> -volumeStep
            else -> return super.onKeyDown(keyCode, event)
        }

        views.web.evaluateJavascript(
            "window.tautNative && window.tautNative.nudgeVolume($step)",
            null
        )
        return true
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            return true
        }
        return super.onKeyUp(keyCode, event)
    }

    // ------------------------------------------------------------------ daur hidup

    /**
     * Pengawas berjalan hanya selama layar ini terlihat.
     *
     * Saat Taut di latar belakang, halaman remote tetap hidup dan kendali di
     * layar kunci tetap bekerja; yang ditunda cuma pencarian ulang, dan itu
     * langsung dikejar begitu layarnya dibuka lagi.
     */
    override fun onStart() {
        super.onStart()
        if (!this::views.isInitialized) return

        // Beri halaman kesempatan melapor dulu sebelum dicurigai.
        lastReportAt = SystemClock.elapsedRealtime()
        clock.postDelayed(watchLink, watchInterval)
    }

    override fun onStop() {
        clock.removeCallbacks(watchLink)
        super.onStop()
    }

    override fun onDestroy() {
        clock.removeCallbacks(watchLink)

        networkWatch?.let { callback ->
            try {
                getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(callback)
            } catch (_: Exception) {
                // Sudah dilepas sistem.
            }
        }
        networkWatch = null

        if (this::nowPlaying.isInitialized) nowPlaying.release()

        // Kalau perangkat belum dipasangkan, onCreate keluar lebih awal dan
        // tampilan tidak pernah dibuat.
        if (this::views.isInitialized) views.web.destroy()
        super.onDestroy()
    }

    // ------------------------------------------- jembatan dengan halaman remote

    /**
     * Dipanggil dari JavaScript di dalam halaman remote.
     *
     * Method ini berjalan di thread milik WebView, bukan thread tampilan, jadi
     * apa pun yang menyentuh tampilan harus dipindahkan dulu.
     */
    private inner class Bridge {
        @JavascriptInterface
        fun onState(json: String) {
            runOnUiThread {
                try {
                    val state = JSONObject(json)
                    lastReportAt = SystemClock.elapsedRealtime()
                    quietUntil = 0
                    keepScreenOn(state.optBoolean("playing", false))
                    nowPlaying.update(
                        title = state.optString("title", "Taut"),
                        artist = state.optString("artist", ""),
                        artworkUrl = state.optString("artwork", null),
                        playing = state.optBoolean("playing", false),
                        durationMs = (state.optDouble("duration", 0.0) * 1000).toLong(),
                        positionMs = (state.optDouble("position", 0.0) * 1000).toLong()
                    )
                } catch (_: Exception) {
                    // Bentuk keadaan berubah; tampilan lama tetap dibiarkan.
                }
            }
        }

        @JavascriptInterface
        fun onDisconnected() {
            runOnUiThread {
                keepScreenOn(false)
                nowPlaying.clear()
            }
        }
    }

    /** Teruskan perintah dari layar kunci ke halaman remote. */
    private fun sendToRemote(action: String) {
        runOnUiThread {
            if (!this::views.isInitialized) return@runOnUiThread
            views.web.evaluateJavascript(
                "window.tautNative && window.tautNative.command('$action')",
                null
            )
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return

        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) askNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}
