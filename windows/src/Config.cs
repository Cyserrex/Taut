using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Taut
{
    /// <summary>
    /// Token akses dan PIN pairing.
    ///
    /// Sengaja membaca berkas yang sama dengan server Node (~/.taut/config.json),
    /// supaya HP yang sudah dipasangkan sebelumnya tetap bekerja setelah pindah
    /// ke versi Windows ini — tidak perlu pairing ulang.
    /// </summary>
    internal static class Config
    {
        private const int PinAttemptsBeforeLockout = 5;
        private static readonly TimeSpan LockoutDuration = TimeSpan.FromSeconds(60);

        private static string _token;
        private static string _pin;

        private static int _failures;
        private static DateTime _lockedUntil = DateTime.MinValue;

        public static string Directory
        {
            get
            {
                // USERPROFILE didahulukan supaya jalurnya sama persis dengan
                // yang dipakai server Node (os.homedir). SpecialFolder.UserProfile
                // bisa mengembalikan string kosong di konteks non-interaktif —
                // dan berkas token yang mendarat di folder berbeda membuat HP
                // yang sudah dipasangkan tiba-tiba ditolak.
                string home = Environment.GetEnvironmentVariable("USERPROFILE");
                if (string.IsNullOrEmpty(home))
                {
                    home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                }
                if (string.IsNullOrEmpty(home))
                {
                    home = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                }

                return Path.Combine(home, ".taut");
            }
        }

        public static string FilePath
        {
            get { return Path.Combine(Directory, "config.json"); }
        }

        /// <summary>Token tersimpan, atau dibuat baru kalau belum ada.</summary>
        public static string Token
        {
            get
            {
                if (_token != null) return _token;

                _token = ReadToken();
                if (_token == null)
                {
                    _token = RandomHex(8);
                    WriteToken(_token);
                }
                return _token;
            }
        }

        /// <summary>PIN dibuat ulang setiap aplikasi dinyalakan.</summary>
        public static string Pin
        {
            get
            {
                if (_pin == null)
                {
                    _pin = RandomDigits(6);
                }
                return _pin;
            }
        }

        /// <summary>Ganti token; semua perangkat lama harus dipasangkan ulang.</summary>
        public static void ResetToken()
        {
            _token = RandomHex(8);
            WriteToken(_token);
        }

        // ------------------------------------------------------------- pairing

        public enum PinResult { Ok, Invalid, Locked }

        /// <summary>
        /// Periksa PIN. Dibatasi agar tidak bisa ditebak beruntun: sesudah
        /// beberapa kali salah, permintaan berikutnya ditolak sebentar.
        /// </summary>
        public static PinResult CheckPin(string candidate)
        {
            if (DateTime.UtcNow < _lockedUntil) return PinResult.Locked;

            string expected = Pin;
            if (!ConstantTimeEquals(candidate, expected))
            {
                _failures++;
                if (_failures >= PinAttemptsBeforeLockout)
                {
                    _lockedUntil = DateTime.UtcNow.Add(LockoutDuration);
                    _failures = 0;
                }
                return PinResult.Invalid;
            }

            _failures = 0;
            return PinResult.Ok;
        }

        public static int LockoutSecondsLeft
        {
            get
            {
                var left = _lockedUntil - DateTime.UtcNow;
                return left > TimeSpan.Zero ? (int)Math.Ceiling(left.TotalSeconds) : 0;
            }
        }

        /// <summary>
        /// Bandingkan tanpa membocorkan berapa banyak karakter awal yang cocok
        /// lewat lamanya perbandingan.
        /// </summary>
        private static bool ConstantTimeEquals(string a, string b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            int diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }

        // -------------------------------------------------------------- berkas

        private static string ReadToken()
        {
            try
            {
                if (!File.Exists(FilePath)) return null;
                string value = Json.GetString(File.ReadAllText(FilePath, Encoding.UTF8), "token");
                return !string.IsNullOrEmpty(value) && value.Length >= 16 ? value : null;
            }
            catch
            {
                return null; // berkas rusak atau tidak terbaca; buat yang baru
            }
        }

        private static void WriteToken(string token)
        {
            try
            {
                System.IO.Directory.CreateDirectory(Directory);
                File.WriteAllText(
                    FilePath,
                    "{\n  \"token\": \"" + Json.Escape(token) + "\"\n}\n",
                    new UTF8Encoding(false));
            }
            catch
            {
                // Tidak bisa menyimpan: Taut tetap jalan, hanya tokennya
                // berubah setiap kali dinyalakan.
            }
        }

        // --------------------------------------------------------------- acak

        private static string RandomHex(int byteCount)
        {
            var bytes = new byte[byteCount];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);

            var sb = new StringBuilder(byteCount * 2);
            foreach (byte b in bytes) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }

        private static string RandomDigits(int count)
        {
            var bytes = new byte[4];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);

            uint value = BitConverter.ToUInt32(bytes, 0) % 1000000;
            return value.ToString("D" + count);
        }
    }
}
