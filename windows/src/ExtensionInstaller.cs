using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using Microsoft.Win32;

namespace Taut
{
    /// <summary>
    /// Memasang ekstensi browser dari dalam Taut.
    ///
    /// Memasang ekstensi selama ini jadi langkah paling merepotkan: menyusun
    /// berkas, membuka halaman tersembunyi di browser, menyalakan mode
    /// pengembang. Taut sudah membawa ekstensinya di dalam .exe, jadi sebagian
    /// besar itu bisa dihapus.
    ///
    /// Tapi hanya sebagian. Kedua browser memperlakukan ini sangat berbeda:
    ///
    ///   Firefox menerima berkas .xpi yang diserahkan lewat baris perintah dan
    ///   menampilkan dialog pemasangannya sendiri. Satu klik di sini, satu
    ///   konfirmasi di sana — dan konfirmasi itu memang seharusnya ada.
    ///
    ///   Chrome tidak punya jalan seperti itu. Sejak lama Chrome menolak
    ///   memasang ekstensi dari luar Web Store lewat cara apa pun yang bisa
    ///   diotomatiskan — itu justru pertahanan terhadap program yang menyusupkan
    ///   ekstensi tanpa sepengetahuan pemakainya. Yang bisa dilakukan Taut cuma
    ///   menyiapkan foldernya dan membukakan jalan.
    /// </summary>
    internal static class ExtensionInstaller
    {
        private const string XpiResource = "Taut.Taut.xpi";
        private const string ChromePrefix = "Taut.chrome.";

        /// <summary>Folder tempat ekstensi Chrome dikeluarkan.</summary>
        public static string ChromeFolder
        {
            get
            {
                string data = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                return Path.Combine(data, "Taut", "ekstensi-chrome");
            }
        }

        public static bool HasFirefoxPackage
        {
            get { return ReadResource(XpiResource) != null; }
        }

        // ---------------------------------------------------------- Firefox

        public enum Result { Ok, NoBrowser, NoPackage, Failed }

        /// <summary>
        /// Serahkan .xpi ke Firefox. Firefox sendiri yang menampilkan dialog
        /// pemasangannya — Taut tidak pernah memasang apa pun diam-diam.
        /// </summary>
        public static Result InstallInFirefox(out string detail)
        {
            detail = null;

            var package = ReadResource(XpiResource);
            if (package == null) return Result.NoPackage;

            string browser = FindBrowser("firefox.exe");
            if (browser == null) return Result.NoBrowser;

            try
            {
                // Ditulis ke folder data Taut, bukan folder sementara: Firefox
                // membaca berkasnya setelah dialognya dijawab, yang bisa lama.
                string folder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Taut");
                Directory.CreateDirectory(folder);

                string file = Path.Combine(folder, "Taut.xpi");
                File.WriteAllBytes(file, package);

                Process.Start(new ProcessStartInfo
                {
                    FileName = browser,
                    Arguments = "\"" + file + "\"",
                    UseShellExecute = false,
                });

                detail = file;
                return Result.Ok;
            }
            catch (Exception error)
            {
                detail = error.Message;
                return Result.Failed;
            }
        }

        // ----------------------------------------------------------- Chrome

        /// <summary>
        /// Keluarkan ekstensi Chrome ke sebuah folder, lalu buka folder itu.
        ///
        /// Folder lama dibersihkan lebih dulu: berkas sisa versi sebelumnya
        /// yang tidak lagi dipakai bisa membuat Chrome menolak memuatnya.
        /// </summary>
        public static Result PrepareForChrome(out string detail)
        {
            detail = null;

            try
            {
                string folder = ChromeFolder;
                if (Directory.Exists(folder)) Directory.Delete(folder, true);
                Directory.CreateDirectory(folder);

                var assembly = Assembly.GetExecutingAssembly();
                int written = 0;

                foreach (string name in assembly.GetManifestResourceNames())
                {
                    if (!name.StartsWith(ChromePrefix, StringComparison.Ordinal)) continue;

                    var data = ReadResource(name);
                    if (data == null) continue;

                    string target = Path.Combine(folder, RelativePathOf(name));
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    File.WriteAllBytes(target, data);
                    written++;
                }

                if (written == 0) return Result.NoPackage;

                Process.Start(new ProcessStartInfo
                {
                    FileName = "explorer.exe",
                    Arguments = "\"" + folder + "\"",
                    UseShellExecute = true,
                });

                detail = folder;
                return Result.Ok;
            }
            catch (Exception error)
            {
                detail = error.Message;
                return Result.Failed;
            }
        }

        /// <summary>
        /// Ubah nama sumber daya kembali jadi jalur berkas.
        ///
        /// Compiler mengganti pemisah folder jadi titik, sehingga
        /// "Taut.chrome.icons.icon-16.png" tidak lagi menyimpan batas antara
        /// folder dan nama berkas. Yang bisa dipulihkan dengan pasti hanyalah
        /// ekstensi berkasnya — titik terakhir — dan satu tingkat folder di
        /// depannya, yang cukup untuk bentuk ekstensi Taut.
        /// </summary>
        private static string RelativePathOf(string resourceName)
        {
            string rest = resourceName.Substring(ChromePrefix.Length);

            int lastDot = rest.LastIndexOf('.');
            if (lastDot < 0) return rest;

            string extension = rest.Substring(lastDot);      // ".png"
            string stem = rest.Substring(0, lastDot);        // "icons.icon-16"

            int folderDot = stem.LastIndexOf('.');
            if (folderDot < 0) return stem + extension;

            string folder = stem.Substring(0, folderDot).Replace('.', Path.DirectorySeparatorChar);
            string file = stem.Substring(folderDot + 1);

            return Path.Combine(folder, file + extension);
        }

        // --------------------------------------------------------- utilitas

        /// <summary>Jalur program browser menurut daftar App Paths milik Windows.</summary>
        private static string FindBrowser(string executable)
        {
            string[] roots =
            {
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\",
                @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\",
            };

            foreach (string root in roots)
            {
                try
                {
                    using (var key = Registry.LocalMachine.OpenSubKey(root + executable))
                    {
                        string path = key?.GetValue(null) as string;
                        if (!string.IsNullOrEmpty(path) && File.Exists(path)) return path;
                    }
                }
                catch
                {
                    // Kunci registri tidak terbaca; coba tempat berikutnya.
                }
            }
            return null;
        }

        private static byte[] ReadResource(string name)
        {
            try
            {
                var assembly = Assembly.GetExecutingAssembly();
                using (var stream = assembly.GetManifestResourceStream(name))
                {
                    if (stream == null) return null;

                    using (var buffer = new MemoryStream())
                    {
                        stream.CopyTo(buffer);
                        return buffer.ToArray();
                    }
                }
            }
            catch
            {
                return null;
            }
        }
    }
}
