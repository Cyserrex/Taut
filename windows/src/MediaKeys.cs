using System;
using System.Runtime.InteropServices;

namespace Taut
{
    /// <summary>
    /// Tombol media Windows — jaring pengaman, bukan jalur utama.
    ///
    /// Taut mengendalikan YouTube Music lewat ekstensi browser, yang bisa
    /// menyentuh persis pemutar yang dimaksud. Tapi ekstensi itu bergantung
    /// pada struktur halaman YouTube, dan struktur itu bukan milik kita: suatu
    /// hari ia akan berubah, dan sebagian kendali akan berhenti bekerja.
    ///
    /// Tombol media adalah cara Windows sendiri mengatakan "putar/jeda" ke
    /// aplikasi mana pun yang sedang memutar suara. Kasar — ia tidak tahu tab
    /// mana yang dimaksud, dan bisa mendarat di Spotify kalau Spotify yang
    /// terakhir berbunyi — tapi tidak akan pernah rusak karena YouTube
    /// mengubah tampilannya.
    ///
    /// Dipakai hanya ketika tidak ada ekstensi yang tersambung. Selama ekstensi
    /// ada, jalur yang tepat selalu lebih baik.
    /// </summary>
    internal static class MediaKeys
    {
        private const byte PlayPause = 0xB3; // VK_MEDIA_PLAY_PAUSE
        private const byte NextTrack = 0xB0; // VK_MEDIA_NEXT_TRACK
        private const byte PrevTrack = 0xB1; // VK_MEDIA_PREV_TRACK

        private const uint ExtendedKey = 0x0001;
        private const uint KeyUp = 0x0002;

        /// <summary>
        /// keybd_event dipakai alih-alih SendInput.
        ///
        /// SendInput butuh struktur INPUT yang memuat union, dan menyusunnya
        /// lewat interop ternyata mudah meleset: percobaan pertama ditolak
        /// Windows dengan ERROR_INVALID_PARAMETER meski ukuran strukturnya
        /// sudah benar. keybd_event tidak punya struktur sama sekali — hanya
        /// empat argumen — dan untuk tombol media hasilnya sama saja.
        /// </summary>
        [DllImport("user32.dll", SetLastError = true)]
        private static extern void keybd_event(byte virtualKey, byte scanCode,
            uint flags, UIntPtr extraInfo);

        /// <summary>
        /// Kirim satu tombol media.
        ///
        /// Dikirim sebagai pasangan tekan-lepas: sebagian aplikasi mengabaikan
        /// penekanan yang tidak pernah dilepas.
        /// </summary>
        private static bool Send(byte virtualKey)
        {
            try
            {
                keybd_event(virtualKey, 0, ExtendedKey, UIntPtr.Zero);
                keybd_event(virtualKey, 0, ExtendedKey | KeyUp, UIntPtr.Zero);
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Terjemahkan perintah Taut jadi tombol media.
        ///
        /// Hanya tiga perintah yang punya padanan. Volume, geser posisi, suka,
        /// acak, dan ulangi tidak punya tombol media — untuk itu memang harus
        /// ada ekstensi.
        /// </summary>
        public static bool TryHandle(string action)
        {
            switch (action)
            {
                case "playPause": return Send(PlayPause);
                case "next": return Send(NextTrack);
                case "previous": return Send(PrevTrack);
                default: return false;
            }
        }
    }
}
