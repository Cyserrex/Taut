using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Taut
{
    /// <summary>
    /// Ikon di area notifikasi — satu-satunya tampilan Taut.
    ///
    /// Taut tidak punya jendela utama dengan sengaja: ia alat yang menunggu,
    /// bukan alat yang dipakai. Yang perlu dijangkau cuma dua hal — apakah
    /// sudah tersambung, dan bagaimana menghubungkan HP baru.
    /// </summary>
    internal sealed class TrayApp : IDisposable
    {
        private static readonly Color Accent = Color.FromArgb(0xFF, 0x2E, 0x63);
        private static readonly Color Background = Color.FromArgb(0x0D, 0x0D, 0x14);

        private readonly TautServer _server;
        private readonly NotifyIcon _icon;
        private readonly ToolStripMenuItem _statusItem;
        private readonly ToolStripMenuItem _autostartItem;

        private QrWindow _qrWindow;

        public TrayApp(TautServer server)
        {
            _server = server;

            _statusItem = new ToolStripMenuItem("Memeriksa…") { Enabled = false };

            _autostartItem = new ToolStripMenuItem("Jalan saat Windows menyala")
            {
                CheckOnClick = true,
                Checked = Autostart.IsEnabled,
            };
            _autostartItem.Click += (s, e) => ToggleAutostart();

            var menu = new ContextMenuStrip();
            menu.Items.Add(_statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Hubungkan HP…", null, (s, e) => ShowQr());
            menu.Items.Add("Buka remote di PC ini", null, (s, e) => OpenInBrowser());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(_autostartItem);
            menu.Items.Add("Perbaiki izin firewall…", null, (s, e) => Firewall.Repair());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Keluar", null, (s, e) => Quit());

            _icon = new NotifyIcon
            {
                Icon = LoadIcon(),
                Text = "Taut",
                ContextMenuStrip = menu,
                Visible = true,
            };
            _icon.DoubleClick += (s, e) => ShowQr();

            _server.Hub.Changed += OnHubChanged;
            UpdateStatus();

            // Taut tidak punya jendela, jadi tanpa ini pengguna tidak punya
            // petunjuk apa pun bahwa ia sudah berjalan.
            _icon.ShowBalloonTip(
                5000,
                "Taut berjalan",
                "Klik ikon ini untuk menghubungkan HP kamu.",
                ToolTipIcon.Info);
        }

        // ------------------------------------------------------------- status

        private void OnHubChanged()
        {
            // Perubahan datang dari thread jaringan; tampilan hanya boleh
            // disentuh dari thread UI.
            if (_icon.ContextMenuStrip.InvokeRequired)
            {
                try { _icon.ContextMenuStrip.BeginInvoke((Action)UpdateStatus); }
                catch { /* sedang ditutup */ }
                return;
            }
            UpdateStatus();
        }

        private void UpdateStatus()
        {
            bool browser = _server.Hub.HostCount > 0;
            int remotes = _server.Hub.RemoteCount;

            string status = browser
                ? "YouTube Music tersambung"
                : "Menunggu YouTube Music di browser";

            if (remotes > 0) status += "  ·  " + remotes + " HP terhubung";

            _statusItem.Text = status;

            // Teks tooltip dibatasi 63 karakter oleh Windows.
            string tip = "Taut — " + (browser ? "siap" : "menunggu browser");
            _icon.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
        }

        // -------------------------------------------------------------- aksi

        private void ShowQr()
        {
            if (_qrWindow == null || _qrWindow.IsDisposed)
            {
                _qrWindow = new QrWindow(_server);
            }

            _qrWindow.Refresh(_server.RemoteUrl, Config.Pin, TautServer.LanAddresses());
            _qrWindow.Show();
            _qrWindow.WindowState = FormWindowState.Normal;
            _qrWindow.Activate();
        }

        private void OpenInBrowser()
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "http://localhost:" + _server.Port + "/#t=" + Config.Token,
                    UseShellExecute = true,
                });
            }
            catch (Exception error)
            {
                MessageBox.Show("Tidak bisa membuka browser.\n\n" + error.Message,
                    "Taut", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void ToggleAutostart()
        {
            bool wanted = _autostartItem.Checked;
            bool ok = wanted ? Autostart.Enable(Program.ExecutablePath) : Autostart.Disable();

            if (!ok)
            {
                _autostartItem.Checked = !wanted;
                MessageBox.Show("Tidak bisa mengubah setelan ini.",
                    "Taut", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void Quit()
        {
            _icon.Visible = false;
            _server.Stop();
            Application.Exit();
        }

        // -------------------------------------------------------------- ikon

        /// <summary>
        /// Ikon Taut, diambil dari berkas .ico yang ditanam di dalam .exe.
        ///
        /// Berkas itu memuat tujuh ukuran, dan Windows memilih sendiri yang
        /// paling pas untuk area notifikasi — termasuk pada layar ber-DPI
        /// tinggi, di mana ikon yang diskalakan terlihat buram.
        ///
        /// Kalau sumber dayanya hilang karena sesuatu, ikon digambar seadanya
        /// supaya Taut tetap punya penanda alih-alih tidak muncul sama sekali.
        /// </summary>
        private static Icon LoadIcon()
        {
            try
            {
                var assembly = System.Reflection.Assembly.GetExecutingAssembly();
                using (var stream = assembly.GetManifestResourceStream("Taut.Taut.ico"))
                {
                    if (stream != null)
                    {
                        return new Icon(stream, SystemInformation.SmallIconSize);
                    }
                }
            }
            catch
            {
                // Jatuh ke ikon gambaran sendiri di bawah.
            }
            return DrawFallbackIcon();
        }

        private static Icon DrawFallbackIcon()
        {
            using (var bitmap = new Bitmap(32, 32))
            {
                using (var g = Graphics.FromImage(bitmap))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);

                    using (var background = new SolidBrush(Background))
                    using (var path = RoundedRectangle(new Rectangle(0, 0, 32, 32), 7))
                    {
                        g.FillPath(background, path);
                    }

                    using (var pen = new Pen(Accent, 2.6f)
                    {
                        StartCap = LineCap.Round,
                        EndCap = LineCap.Round,
                        LineJoin = LineJoin.Round,
                    })
                    {
                        // Batang not, dari kiri-bawah naik lalu miring ke kanan.
                        g.DrawLines(pen, new[]
                        {
                            new PointF(12f, 21f),
                            new PointF(12f, 9f),
                            new PointF(22f, 7f),
                            new PointF(22f, 19f),
                        });
                    }

                    using (var head = new SolidBrush(Accent))
                    {
                        g.FillEllipse(head, 7f, 17f, 8f, 7f);
                        g.FillEllipse(head, 17f, 15f, 8f, 7f);
                    }
                }

                return Icon.FromHandle(bitmap.GetHicon());
            }
        }

        private static GraphicsPath RoundedRectangle(Rectangle bounds, int radius)
        {
            int d = radius * 2;
            var path = new GraphicsPath();

            path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
            path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
            path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
            path.CloseFigure();

            return path;
        }

        public void Dispose()
        {
            _server.Hub.Changed -= OnHubChanged;

            if (_qrWindow != null) _qrWindow.Dispose();
            if (_icon != null)
            {
                _icon.Visible = false;
                _icon.Dispose();
            }
        }
    }
}
