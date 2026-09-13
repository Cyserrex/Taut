package com.cyserrex.taut

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import com.cyserrex.taut.databinding.ActivityMainBinding

/**
 * Layar remote.
 *
 * Isinya halaman remote yang sama persis dengan yang dibuka lewat browser,
 * dimuat di dalam WebView. Yang ditambahkan aplikasi ini adalah hal-hal yang
 * tidak bisa dilakukan sebuah halaman web di Android:
 *
 *   · menemukan PC lagi sendiri ketika alamat IP-nya berpindah,
 *   · memakai tombol volume fisik HP untuk mengatur volume di PC,
 *   · menjaga layar tetap menyala selama remote terbuka.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var views: ActivityMainBinding
    private lateinit var prefs: Prefs

    /** Dinaikkan setiap sekali tekan tombol volume — terasa pas saat dicoba. */
    private val volumeStep = 5

    /** Menahan agar pencarian ulang tidak berjalan dua kali bersamaan. */
    private var recovering = false

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

        // Remote sering diletakkan di meja sambil dilihat sesekali.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        setUpWebView()
        views.offlineRetry.setOnClickListener { recover() }
        views.offlineForget.setOnClickListener {
            prefs.forget()
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
        }

        views.web.loadUrl(prefs.remoteUrl)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWebView() {
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
                showOffline(true, getString(R.string.lost_server), busy = false)
                return@scan
            }

            // Token tetap berlaku; yang berubah hanya alamatnya.
            prefs.updateAddress(match.host, match.port)
            prefs.serverName = match.name
            recovering = false
            views.web.loadUrl(prefs.remoteUrl)
        }
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

    override fun onDestroy() {
        // Kalau perangkat belum dipasangkan, onCreate keluar lebih awal dan
        // tampilan tidak pernah dibuat.
        if (this::views.isInitialized) views.web.destroy()
        super.onDestroy()
    }
}
