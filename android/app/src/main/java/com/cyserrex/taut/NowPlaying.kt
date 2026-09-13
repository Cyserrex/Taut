package com.cyserrex.taut

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.net.URL

/**
 * Lagu yang sedang diputar, ditampilkan di layar kunci dan panel notifikasi.
 *
 * Tanpa ini, mengganti lagu berarti membuka kunci HP, mencari aplikasi Taut,
 * lalu menekan tombol — untuk sesuatu yang seharusnya satu ketukan. Android
 * sudah punya tempat baku untuk kendali pemutar, dan Taut memakainya.
 *
 * Sengaja TIDAK memakai foreground service. Sejak Android 14, service
 * bertipe "mediaPlayback" menuntut aplikasinya benar-benar mengeluarkan suara
 * — sementara Taut tidak memutar apa pun, ia hanya remote. Sesinya dimiliki
 * activity, sehingga kendali tersedia selama Taut masih terbuka, termasuk saat
 * layar terkunci. Itu mencakup keadaan yang paling sering: HP diletakkan
 * dengan Taut terbuka.
 *
 * Seluruhnya defensif. Kalau izin notifikasi ditolak atau ada yang gagal,
 * Taut tetap berfungsi penuh — hanya kendali di layar kunci yang tidak muncul.
 */
class NowPlaying(private val context: Context, private val onCommand: (String) -> Unit) {

    private companion object {
        const val CHANNEL_ID = "taut-now-playing"
        const val NOTIFICATION_ID = 1

        /** Aksi tombol di notifikasi; hanya dipakai di dalam aplikasi ini. */
        const val ACTION_COMMAND = "com.cyserrex.taut.MEDIA_COMMAND"
        const val EXTRA_COMMAND = "command"
    }

    /**
     * Penerima tombol notifikasi.
     *
     * AndroidX punya MediaButtonReceiver bawaan, tapi ia mencari komponen
     * MediaBrowserService yang tidak dipunyai Taut, lalu diam-diam
     * mengembalikan PendingIntent kosong — tombolnya tampil tapi tidak
     * melakukan apa-apa. Penerima sendiri lebih sedikit bagian yang bisa
     * meleset.
     */
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val command = intent?.getStringExtra(EXTRA_COMMAND) ?: return
            onCommand(command)
        }
    }

    private var receiverRegistered = false

    private var session: MediaSessionCompat? = null

    /** Sampul terakhir yang diunduh, supaya tidak diambil ulang tiap detik. */
    private var artworkUrl: String? = null
    private var artwork: Bitmap? = null

    /** Terakhir ditampilkan, untuk menghindari pembaruan yang tidak mengubah apa pun. */
    private var lastSignature: String? = null

    private val main = Handler(Looper.getMainLooper())

    fun start() {
        if (session != null) return

        try {
            createChannel()
            registerReceiver()
            session = MediaSessionCompat(context, "Taut").apply {
                setCallback(object : MediaSessionCompat.Callback() {
                    override fun onPlay() = onCommand("playPause")
                    override fun onPause() = onCommand("playPause")
                    override fun onSkipToNext() = onCommand("next")
                    override fun onSkipToPrevious() = onCommand("previous")
                    override fun onStop() = onCommand("playPause")
                })
                isActive = true
            }
        } catch (_: Exception) {
            // Tanpa sesi media, sisanya tinggal tidak melakukan apa-apa.
            session = null
        }
    }

    /**
     * Perbarui tampilan dari keadaan yang dikirim halaman remote.
     *
     * Keadaan datang setiap detik, jadi yang tidak berubah tidak digambar
     * ulang — notifikasi yang diperbarui terus-menerus membuat panel
     * notifikasi berkedip.
     */
    fun update(title: String, artist: String, artworkUrl: String?, playing: Boolean, durationMs: Long, positionMs: Long) {
        val current = session ?: return

        val signature = "$title|$artist|$artworkUrl|$playing"
        val changed = signature != lastSignature
        lastSignature = signature

        try {
            current.setPlaybackState(
                PlaybackStateCompat.Builder()
                    .setActions(
                        PlaybackStateCompat.ACTION_PLAY or
                            PlaybackStateCompat.ACTION_PAUSE or
                            PlaybackStateCompat.ACTION_PLAY_PAUSE or
                            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                    )
                    .setState(
                        if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                        positionMs,
                        1f
                    )
                    .build()
            )

            if (changed) {
                current.setMetadata(
                    MediaMetadataCompat.Builder()
                        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                        .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
                        .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork)
                        .build()
                )
                loadArtwork(artworkUrl)
            }

            showNotification(title, artist, playing)
        } catch (_: Exception) {
            // Tampilan gagal diperbarui; remote di dalam aplikasi tetap jalan.
        }
    }

    /** Hentikan tampilan — dipakai saat PC terputus atau Taut ditutup. */
    fun clear() {
        lastSignature = null
        try {
            NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
        } catch (_: Exception) {
            // Notifikasi memang belum pernah muncul.
        }
    }

    fun release() {
        clear()
        try {
            session?.isActive = false
            session?.release()
        } catch (_: Exception) {
            // Sudah dilepas.
        }
        session = null
        artwork = null

        if (receiverRegistered) {
            try { context.unregisterReceiver(receiver) } catch (_: Exception) { /* sudah dilepas */ }
            receiverRegistered = false
        }
    }

    // ------------------------------------------------------------ notifikasi

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Lagu yang sedang diputar",
            NotificationManager.IMPORTANCE_LOW // tanpa suara dan tanpa getaran
        ).apply {
            description = "Kendali pemutar di layar kunci"
            setShowBadge(false)
        }

        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    private fun showNotification(title: String, artist: String, playing: Boolean) {
        val session = this.session ?: return

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(artist)
            .setLargeIcon(artwork)
            .setOngoing(playing)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(
                android.R.drawable.ic_media_previous, "Sebelumnya", commandIntent("previous")
            )
            .addAction(
                if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (playing) "Jeda" else "Putar",
                commandIntent("playPause")
            )
            .addAction(
                android.R.drawable.ic_media_next, "Berikutnya", commandIntent("next")
            )
            .setStyle(
                MediaStyle()
                    .setMediaSession(session.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )

        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build())
        } catch (_: SecurityException) {
            // Izin notifikasi ditolak; tidak ada yang bisa ditampilkan.
        }
    }

    private fun commandIntent(command: String): PendingIntent {
        val intent = Intent(ACTION_COMMAND)
            .setPackage(context.packageName)
            .putExtra(EXTRA_COMMAND, command)

        // requestCode dibedakan per perintah; kalau sama, Android memakai
        // ulang intent yang pertama dan ketiga tombolnya melakukan hal sama.
        return PendingIntent.getBroadcast(
            context,
            command.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun registerReceiver() {
        if (receiverRegistered) return

        val filter = IntentFilter(ACTION_COMMAND)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Sejak Android 13, penerima yang didaftarkan saat berjalan wajib
            // menyatakan apakah boleh dipanggil aplikasi lain. Ini tidak.
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }
        receiverRegistered = true
    }

    /**
     * Unduh sampul album di latar belakang.
     *
     * Kalau gagal — jaringan sibuk, URL kedaluwarsa — notifikasinya tetap
     * muncul tanpa gambar, yang jauh lebih baik daripada tidak muncul.
     */
    private fun loadArtwork(url: String?) {
        if (url.isNullOrEmpty() || url == artworkUrl) return
        artworkUrl = url

        Thread {
            val bitmap = try {
                URL(url).openStream().use { BitmapFactory.decodeStream(it) }
            } catch (_: Exception) {
                null
            }

            if (bitmap != null) {
                main.post {
                    artwork = bitmap
                    lastSignature = null // paksa gambar ulang dengan sampulnya
                }
            }
        }.start()
    }
}
