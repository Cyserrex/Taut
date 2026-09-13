using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;

namespace Taut
{
    /// <summary>
    /// Mencari tahu siapa yang sedang memakai port Taut.
    ///
    /// "Tidak bisa memakai port 8787" adalah pesan yang tidak menolong siapa
    /// pun: pengguna tidak punya cara mengetahui apa yang harus ditutup.
    /// Penyebab yang paling sering justru Taut sendiri — versi Node.js yang
    /// masih berjalan, atau salinan lain yang dinyalakan lewat autostart.
    ///
    /// Cara mengenalinya sederhana: tanya saja ke port itu. Kalau yang
    /// menjawab adalah server Taut, ia akan memperkenalkan diri lewat
    /// /api/info.
    /// </summary>
    internal static class PortConflict
    {
        public sealed class Holder
        {
            /// <summary>Benar kalau yang memegang port ternyata server Taut juga.</summary>
            public bool IsTaut;

            /// <summary>Versi server Taut yang menjawab, kalau ada.</summary>
            public string Version;

            /// <summary>Proses pemegang port, atau null kalau tidak terlacak.</summary>
            public Process Process;

            public string ProcessName
            {
                get
                {
                    try { return Process != null ? Process.ProcessName : null; }
                    catch { return null; }
                }
            }
        }

        public static Holder Identify(int port)
        {
            var holder = new Holder();

            string info = AskWhoIsThere(port);
            if (info != null && Json.GetString(info, "name") == "Taut")
            {
                holder.IsTaut = true;
                holder.Version = Json.GetString(info, "version");
            }

            holder.Process = FindListener(port);
            return holder;
        }

        /// <summary>Tanya ke port: kalau Taut yang di sana, ia menyebutkan namanya.</summary>
        private static string AskWhoIsThere(int port)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(
                    "http://127.0.0.1:" + port + "/api/info");
                request.Timeout = 1500;
                request.ReadWriteTimeout = 1500;

                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    return reader.ReadToEnd();
                }
            }
            catch
            {
                return null; // bukan HTTP, atau tidak menjawab
            }
        }

        /// <summary>
        /// Proses yang mendengarkan di port tersebut, lewat netstat.
        ///
        /// Membaca tabel TCP lewat P/Invoke akan lebih rapi, tapi ini cuma
        /// dipakai sekali untuk menyusun pesan kesalahan — tidak sepadan
        /// dengan kerumitannya.
        /// </summary>
        private static Process FindListener(int port)
        {
            try
            {
                var info = new ProcessStartInfo
                {
                    FileName = "netstat",
                    Arguments = "-ano -p TCP",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true,
                };

                using (var netstat = Process.Start(info))
                {
                    if (netstat == null) return null;

                    string output = netstat.StandardOutput.ReadToEnd();
                    netstat.WaitForExit(5000);

                    string suffix = ":" + port;
                    foreach (string line in output.Split('\n'))
                    {
                        var parts = line.Split(new[] { ' ', '\t', '\r' },
                            StringSplitOptions.RemoveEmptyEntries);

                        if (parts.Length < 5) continue;
                        if (!parts[1].EndsWith(suffix, StringComparison.Ordinal)) continue;
                        if (parts[3] != "LISTENING") continue;

                        int pid;
                        if (!int.TryParse(parts[parts.Length - 1], out pid)) continue;

                        try { return Process.GetProcessById(pid); }
                        catch { return null; } // sudah berhenti di antara dua langkah
                    }
                }
            }
            catch
            {
                // netstat tidak tersedia atau dibatasi kebijakan sistem.
            }
            return null;
        }

        /// <summary>
        /// Autostart server Node.js yang dipasang versi sebelumnya.
        ///
        /// Ini penyebab bentrok yang paling menjengkelkan, karena kembali
        /// sendiri setiap login meski prosesnya sudah dihentikan.
        /// </summary>
        public static string NodeAutostartPath
        {
            get
            {
                try
                {
                    return Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.Startup),
                        "Taut.vbs");
                }
                catch
                {
                    return null;
                }
            }
        }

        public static bool NodeAutostartExists
        {
            get
            {
                string path = NodeAutostartPath;
                return path != null && File.Exists(path);
            }
        }

        public static void RemoveNodeAutostart()
        {
            try { File.Delete(NodeAutostartPath); }
            catch { /* sudah hilang, atau tidak boleh dihapus */ }
        }
    }
}
