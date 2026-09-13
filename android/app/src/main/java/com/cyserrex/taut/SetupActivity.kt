package com.cyserrex.taut

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import com.cyserrex.taut.databinding.ActivitySetupBinding
import com.cyserrex.taut.databinding.ItemServerBinding

/**
 * Layar pertama: temukan PC, lalu buktikan dengan PIN.
 *
 * Hanya muncul sekali. Setelah berhasil, Taut selalu membuka langsung ke
 * remote — bahkan ketika alamat IP PC sudah berganti, karena pencarian
 * dijalankan ulang secara diam-diam dari MainActivity.
 */
class SetupActivity : AppCompatActivity() {

    private lateinit var views: ActivitySetupBinding
    private lateinit var prefs: Prefs

    /** PC yang sedang menunggu PIN; null berarti kita masih di tahap pencarian. */
    private var pending: Discovery.Server? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        views = ActivitySetupBinding.inflate(layoutInflater)
        setContentView(views.root)
        prefs = Prefs(this)

        views.scanAgain.setOnClickListener { scan() }
        views.manualToggle.setOnClickListener { toggleManual() }
        views.manualConnect.setOnClickListener { connectManually() }
        views.pinSubmit.setOnClickListener { submitPin() }
        views.pinCancel.setOnClickListener { showScan() }

        scan()
    }

    // ------------------------------------------------------------- pencarian

    private fun scan() {
        views.serverList.removeAllViews()
        views.emptyHint.visibility = View.GONE
        views.scanningRow.visibility = View.VISIBLE
        views.scanStatus.text = getString(R.string.scanning)
        views.scanAgain.isEnabled = false

        Discovery.scan(Prefs.DEFAULT_PORT) { servers ->
            if (isFinishing) return@scan

            views.scanAgain.isEnabled = true
            views.spinner.visibility = View.GONE

            if (servers.isEmpty()) {
                views.scanStatus.text = getString(R.string.nothing_found)
                views.emptyHint.visibility = View.VISIBLE
                return@scan
            }

            views.scanningRow.visibility = View.GONE
            for (server in servers) addServerRow(server)
        }
    }

    private fun addServerRow(server: Discovery.Server) {
        val row = ItemServerBinding.inflate(layoutInflater, views.serverList, false)
        row.serverName.text = server.name
        row.serverAddress.text = "${server.host}:${server.port}  ·  Taut ${server.version}"
        row.root.setOnClickListener { askForPin(server) }
        views.serverList.addView(row.root)
    }

    // ------------------------------------------------------------ alamat manual

    private fun toggleManual() {
        val showing = views.manualSection.visibility == View.VISIBLE
        views.manualSection.visibility = if (showing) View.GONE else View.VISIBLE
    }

    private fun connectManually() {
        val host = views.manualHost.text.toString().trim()
        if (host.isEmpty()) {
            views.manualHost.error = getString(R.string.manual_host)
            return
        }
        val port = views.manualPort.text.toString().trim().toIntOrNull() ?: Prefs.DEFAULT_PORT
        askForPin(Discovery.Server(host = host, name = host, port = port, version = "?"))
    }

    // ------------------------------------------------------------------- PIN

    private fun askForPin(server: Discovery.Server) {
        pending = server
        views.scanSection.visibility = View.GONE
        views.pinSection.visibility = View.VISIBLE
        views.pinTarget.text = "${server.name} · ${server.host}:${server.port}"
        views.pinError.visibility = View.GONE
        views.pinInput.setText("")
        views.pinInput.requestFocus()
    }

    private fun showScan() {
        pending = null
        views.pinSection.visibility = View.GONE
        views.scanSection.visibility = View.VISIBLE
        views.spinner.visibility = View.VISIBLE
        scan()
    }

    private fun submitPin() {
        val server = pending ?: return
        val pin = views.pinInput.text.toString().trim()

        if (pin.length != 6) {
            showPinError(getString(R.string.pin_wrong))
            return
        }

        views.pinSubmit.isEnabled = false
        views.pinError.visibility = View.GONE

        Pairing.pair(server.host, server.port, pin) { result ->
            if (isFinishing) return@pair
            views.pinSubmit.isEnabled = true

            when (result) {
                is Pairing.Result.Success -> {
                    prefs.save(server, result.token)
                    startActivity(Intent(this, MainActivity::class.java))
                    finish()
                }
                is Pairing.Result.WrongPin -> showPinError(getString(R.string.pin_wrong))
                is Pairing.Result.Locked ->
                    showPinError("Terlalu banyak percobaan. Tunggu ${result.retryAfterSeconds} detik.")
                is Pairing.Result.Unreachable ->
                    showPinError("Tidak bisa menghubungi PC: ${result.message}")
            }
        }
    }

    private fun showPinError(message: String) {
        views.pinError.text = message
        views.pinError.visibility = View.VISIBLE
    }
}
