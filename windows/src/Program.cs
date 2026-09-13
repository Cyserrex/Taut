using System;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

namespace Taut
{
    internal static class Program
    {
        /// <summary>
        /// Menjaga hanya ada satu Taut yang berjalan.
        ///
        /// Tanpa ini, menyalakan Taut dua kali akan membuat yang kedua gagal
        /// mengikat port dengan pesan yang membingungkan — padahal yang terjadi
        /// cuma "sudah jalan, kok".
        /// </summary>
        private static Mutex _onlyOne;

        [STAThread]
        private static int Main(string[] args)
        {
            bool console = args.Contains("--console", StringComparer.OrdinalIgnoreCase);
            int port = ReadPort(args);

            bool isFirst;
            _onlyOne = new Mutex(true, "Global\\TautSingleInstance", out isFirst);
            if (!isFirst && !console)
            {
                MessageBox.Show(
                    "Taut sudah berjalan. Lihat ikonnya di area notifikasi, dekat jam.",
                    "Taut",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return 0;
            }

            var server = new TautServer(port);
            if (!TryStart(server, port, console)) return 1;

            if (console) return RunConsole(server);

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Jalur pemeriksaan tampilan: gambarkan jendela ke berkas PNG lalu
            // keluar. Tampilan adalah satu-satunya bagian Taut yang tidak bisa
            // diuji lewat jaringan, dan ini membuatnya bisa diperiksa tanpa
            // seseorang harus duduk melihat layar.
            int renderIndex = Array.FindIndex(args,
                a => string.Equals(a, "--render", StringComparison.OrdinalIgnoreCase));
            if (renderIndex >= 0 && renderIndex + 1 < args.Length)
            {
                int code = RenderPreview(server, args[renderIndex + 1]);
                server.Stop();
                return code;
            }

            using (var tray = new TrayApp(server))
            {
                Application.Run();
            }

            server.Stop();
            return 0;
        }

        /// <summary>
        /// Nyalakan server; kalau portnya terpakai, jelaskan oleh siapa.
        ///
        /// Penyebab tersering justru Taut sendiri — versi Node.js yang masih
        /// berjalan dari pemasangan sebelumnya. Menyebut "port terpakai" saja
        /// membuat pengguna buntu, padahal perbaikannya satu klik.
        /// </summary>
        private static bool TryStart(TautServer server, int port, bool console)
        {
            try
            {
                server.Start();
                return true;
            }
            catch (Exception error)
            {
                var holder = PortConflict.Identify(port);

                if (!console && holder.IsTaut && OfferToReplace(holder, port))
                {
                    try
                    {
                        server.Start();
                        return true;
                    }
                    catch
                    {
                        // Jatuh ke pesan di bawah dengan keterangan apa adanya.
                    }
                }

                Complain(holder, port, error, console);
                return false;
            }
        }

        /// <summary>Tawarkan menghentikan server Taut lain yang memegang port.</summary>
        private static bool OfferToReplace(PortConflict.Holder holder, int port)
        {
            bool hasAutostart = PortConflict.NodeAutostartExists;

            string message =
                "Server Taut lain sudah berjalan di port " + port +
                (holder.Version != null ? " (versi " + holder.Version + ")" : "") + ".\n\n" +
                "Biasanya ini Taut versi Node.js dari pemasangan sebelumnya.\n" +
                (hasAutostart
                    ? "Versi itu juga disetel menyala sendiri tiap Windows login.\n\n"
                    : "\n") +
                "Hentikan dan pakai Taut.exe ini?";

            var answer = MessageBox.Show(message, "Taut", MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (answer != DialogResult.Yes) return false;

            try
            {
                if (holder.Process != null)
                {
                    holder.Process.Kill();
                    holder.Process.WaitForExit(5000);
                }
            }
            catch
            {
                return false; // tidak boleh menghentikannya
            }

            // Tanpa ini, bentrokan yang sama kembali sendiri di login berikutnya.
            if (hasAutostart) PortConflict.RemoveNodeAutostart();

            // Beri waktu Windows melepas portnya.
            Thread.Sleep(500);
            return true;
        }

        private static void Complain(PortConflict.Holder holder, int port,
            Exception error, bool console)
        {
            var message = new System.Text.StringBuilder();
            message.Append("Tidak bisa memakai port ").Append(port).Append(".\n\n");

            string name = holder.ProcessName;
            if (holder.IsTaut)
            {
                message.Append("Server Taut lain sedang memakainya. Tutup dulu server itu,\n");
                message.Append("lalu jalankan Taut.exe lagi.\n\n");
            }
            else if (name != null)
            {
                message.Append("Port itu dipakai oleh: ").Append(name).Append("\n\n");
                message.Append("Tutup program tersebut, atau jalankan Taut di port lain:\n");
                message.Append("    Taut.exe --port ").Append(port + 1).Append("\n\n");
            }
            else
            {
                message.Append("Ada program lain yang memakainya. Coba port lain:\n");
                message.Append("    Taut.exe --port ").Append(port + 1).Append("\n\n");
            }

            message.Append(error.Message);

            if (console) Console.Error.WriteLine(message.ToString());
            else MessageBox.Show(message.ToString(), "Taut", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }

        /// <summary>Gambarkan jendela "Hubungkan HP" ke berkas PNG, untuk diperiksa.</summary>
        private static int RenderPreview(TautServer server, string outputPath)
        {
            try
            {
                using (var window = new QrWindow(server))
                {
                    window.Refresh(server.RemoteUrl, Config.Pin, TautServer.LanAddresses());

                    // Jendela harus sempat dibuat sebelum bisa digambar; dipindah
                    // ke luar layar supaya tidak berkedip di depan siapa pun.
                    window.StartPosition = FormStartPosition.Manual;
                    window.Location = new System.Drawing.Point(-4000, -4000);
                    window.Show();
                    Application.DoEvents();

                    using (var bitmap = new System.Drawing.Bitmap(window.Width, window.Height))
                    {
                        window.DrawToBitmap(bitmap, new System.Drawing.Rectangle(
                            0, 0, window.Width, window.Height));
                        bitmap.Save(outputPath, System.Drawing.Imaging.ImageFormat.Png);
                    }
                }
                Console.Error.WriteLine("tersimpan: " + outputPath);
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("gagal menggambar: " + error.Message);
                return 1;
            }
        }

        /// <summary>
        /// Mode konsol dipakai pengujian otomatis: keluarannya bisa dibaca,
        /// dan tidak ada jendela yang menunggu ditutup manusia.
        /// </summary>
        private static int RunConsole(TautServer server)
        {
            // Taut dibangun sebagai winexe supaya tidak ada jendela hitam yang
            // menempel saat dipakai normal. Konsekuensinya, saat mode konsol
            // dipakai untuk pengujian tidak selalu ada console handle — menulis
            // ke keluaran yang dialihkan tetap bisa, tapi mengatur encoding-nya
            // tidak.
            try { Console.OutputEncoding = System.Text.Encoding.UTF8; }
            catch { /* keluaran dialihkan ke berkas atau pipa */ }

            Console.WriteLine();
            Console.WriteLine("  Taut v" + TautServer.Version + " berjalan di port " + server.Port);
            Console.WriteLine();
            Console.WriteLine("  " + server.RemoteUrl);
            Console.WriteLine("  PIN: " + Config.Pin);
            Console.WriteLine();
            Console.WriteLine("  Tekan Ctrl+C untuk berhenti.");
            Console.WriteLine();

            // Keluaran yang dialihkan ke pipa ikut tertahan di penyangga;
            // tanpa ini pembacanya bisa menunggu lama tanpa sebab.
            Console.Out.Flush();

            var stop = new ManualResetEvent(false);
            Console.CancelKeyPress += (s, e) =>
            {
                e.Cancel = true;
                stop.Set();
            };
            stop.WaitOne();

            server.Stop();
            return 0;
        }

        private static int ReadPort(string[] args)
        {
            int index = Array.FindIndex(args,
                a => string.Equals(a, "--port", StringComparison.OrdinalIgnoreCase));

            int port;
            if (index >= 0 && index + 1 < args.Length && int.TryParse(args[index + 1], out port)
                && port > 0 && port < 65536)
            {
                return port;
            }
            return TautServer.DefaultPort;
        }

        public static string ExecutablePath
        {
            get { return Process.GetCurrentProcess().MainModule.FileName; }
        }
    }
}
