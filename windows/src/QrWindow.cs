using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;

namespace Taut
{
    /// <summary>
    /// Jendela "Hubungkan HP" — QR code, alamat, dan PIN.
    ///
    /// Ini satu-satunya jendela di Taut, dan hanya muncul saat diminta. Yang
    /// ditampilkan cuma tiga hal yang benar-benar dibutuhkan untuk
    /// menghubungkan sebuah HP, masing-masing dengan cara pakainya sendiri:
    /// QR untuk browser HP, PIN untuk aplikasi Android, alamat untuk kalau
    /// keduanya gagal.
    /// </summary>
    internal sealed class QrWindow : Form
    {
        private static readonly Color Background = Color.FromArgb(0x0D, 0x0D, 0x14);
        private static readonly Color Surface = Color.FromArgb(0x1A, 0x1A, 0x23);
        private static readonly Color TextColor = Color.FromArgb(0xF4, 0xF4, 0xF7);
        private static readonly Color DimText = Color.FromArgb(0x9B, 0x9B, 0xA5);
        private static readonly Color Accent = Color.FromArgb(0xFF, 0x2E, 0x63);

        private readonly PictureBox _qr;
        private readonly Label _pin;
        private readonly Label _address;
        private readonly TautServer _server;

        private string _url = string.Empty;

        public QrWindow(TautServer server)
        {
            _server = server;

            Text = "Taut — Hubungkan HP";
            BackColor = Background;
            ForeColor = TextColor;
            Font = new Font("Segoe UI", 9f);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ShowInTaskbar = false;

            // Ikon yang sama dengan berkas .exe, supaya bilah judulnya tidak
            // memakai ikon jendela bawaan Windows.
            try
            {
                var assembly = System.Reflection.Assembly.GetExecutingAssembly();
                using (var stream = assembly.GetManifestResourceStream("Taut.Taut.ico"))
                {
                    if (stream != null) Icon = new System.Drawing.Icon(stream);
                }
            }
            catch
            {
                // Tanpa ikon pun jendelanya tetap berfungsi.
            }

            ClientSize = new Size(380, 540);

            var heading = new Label
            {
                Text = "Aplikasi Android",
                Font = new Font("Segoe UI", 11f, FontStyle.Bold),
                ForeColor = TextColor,
                Location = new Point(24, 20),
                AutoSize = true,
            };

            var androidHint = new Label
            {
                Text = "Buka aplikasi Taut di HP. PC ini muncul sendiri di\n" +
                       "daftar. Ketuk, lalu masukkan PIN di bawah.",
                ForeColor = DimText,
                Location = new Point(24, 46),
                // Tinggi dilebihkan dari kebutuhan: teks Indonesia lebih panjang
                // daripada padanan Inggrisnya, dan label yang pas-pasan memotongnya
                // tanpa tanda apa pun.
                Size = new Size(332, 52),
            };

            _pin = new Label
            {
                Text = "------",
                Font = new Font("Consolas", 26f, FontStyle.Bold),
                ForeColor = Accent,
                BackColor = Surface,
                TextAlign = ContentAlignment.MiddleCenter,
                Location = new Point(24, 104),
                Size = new Size(332, 60),
            };

            var browserHeading = new Label
            {
                Text = "Atau lewat browser HP",
                Font = new Font("Segoe UI", 11f, FontStyle.Bold),
                ForeColor = TextColor,
                Location = new Point(24, 182),
                AutoSize = true,
            };

            var browserHint = new Label
            {
                Text = "Scan dengan kamera HP. Tanpa memasang apa pun.",
                ForeColor = DimText,
                Location = new Point(24, 208),
                Size = new Size(332, 36),
            };

            _qr = new PictureBox
            {
                Location = new Point(90, 250),
                Size = new Size(200, 200),
                BackColor = Color.White,
                SizeMode = PictureBoxSizeMode.Zoom,
            };

            _address = new Label
            {
                Text = string.Empty,
                ForeColor = DimText,
                TextAlign = ContentAlignment.MiddleCenter,
                Location = new Point(24, 458),
                Size = new Size(332, 18),
            };

            var copy = new Button
            {
                Text = "Salin alamat",
                Location = new Point(24, 486),
                Size = new Size(160, 34),
                FlatStyle = FlatStyle.Flat,
                BackColor = Surface,
                ForeColor = TextColor,
            };
            copy.FlatAppearance.BorderColor = Surface;
            copy.Click += (s, e) => CopyAddress();

            var close = new Button
            {
                Text = "Tutup",
                Location = new Point(196, 486),
                Size = new Size(160, 34),
                FlatStyle = FlatStyle.Flat,
                BackColor = Accent,
                ForeColor = Color.White,
            };
            close.FlatAppearance.BorderColor = Accent;
            close.Click += (s, e) => Hide();

            Controls.AddRange(new Control[]
            {
                heading, androidHint, _pin,
                browserHeading, browserHint, _qr,
                _address, copy, close,
            });
        }

        public void Refresh(string url, string pin, List<string> addresses)
        {
            _url = url;
            _pin.Text = pin;

            _address.Text = addresses.Count > 0
                ? addresses[0] + ":" + _server.Port
                : "Tidak ada jaringan WiFi yang terdeteksi";

            var old = _qr.Image;
            _qr.Image = RenderQr(url, 200);
            if (old != null) old.Dispose();
        }

        private void CopyAddress()
        {
            try
            {
                Clipboard.SetText(_url);
            }
            catch
            {
                // Papan klip kadang dikunci program lain; bukan hal serius.
            }
        }

        /// <summary>Gambar matriks QR jadi bitmap hitam-putih dengan quiet zone.</summary>
        private static Bitmap RenderQr(string text, int pixels)
        {
            int[,] matrix;
            try
            {
                matrix = QrCode.Encode(text);
            }
            catch
            {
                return null;
            }

            int size = matrix.GetLength(0);
            const int quiet = 2;
            int total = size + quiet * 2;
            int scale = Math.Max(1, pixels / total);

            var bitmap = new Bitmap(total * scale, total * scale);
            using (var g = Graphics.FromImage(bitmap))
            {
                g.Clear(Color.White);
                using (var dark = new SolidBrush(Color.Black))
                {
                    for (int r = 0; r < size; r++)
                    {
                        for (int c = 0; c < size; c++)
                        {
                            if (matrix[r, c] == 0) continue;
                            g.FillRectangle(dark,
                                (c + quiet) * scale, (r + quiet) * scale, scale, scale);
                        }
                    }
                }
            }
            return bitmap;
        }

        /// <summary>Menutup jendela hanya menyembunyikannya; Taut tetap berjalan di tray.</summary>
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                return;
            }
            base.OnFormClosing(e);
        }
    }
}
