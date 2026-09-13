using System;
using System.Diagnostics;
using System.Windows.Forms;

namespace Taut
{
    /// <summary>
    /// Membuka jalan lewat Windows Firewall.
    ///
    /// Biasanya tidak perlu: saat Taut pertama kali mendengarkan, Windows
    /// sendiri yang bertanya, dan menjawab "Private networks" sudah cukup.
    /// Ini untuk keadaan yang tidak biasa — kotak itu terlanjur ditutup, atau
    /// dijawab "Cancel", sehingga aturan penolakan ikut tersimpan dan HP tidak
    /// pernah bisa menyambung tanpa penjelasan apa pun.
    /// </summary>
    internal static class Firewall
    {
        private const string RuleName = "Taut";

        public static void Repair()
        {
            var answer = MessageBox.Show(
                "Windows akan meminta izin administrator untuk mengizinkan Taut\n" +
                "menerima sambungan dari HP di jaringan lokal.\n\n" +
                "Lanjutkan?",
                "Taut — izin firewall",
                MessageBoxButtons.OKCancel,
                MessageBoxIcon.Information);

            if (answer != DialogResult.OK) return;

            string exe = Program.ExecutablePath;

            // Aturan lama dihapus lebih dulu supaya aturan penolakan yang
            // terlanjur tersimpan tidak terus mengalahkan aturan baru.
            bool ok = RunElevated("advfirewall firewall delete rule name=\"" + RuleName + "\"")
                   && RunElevated(
                        "advfirewall firewall add rule name=\"" + RuleName + "\" " +
                        "dir=in action=allow program=\"" + exe + "\" " +
                        "profile=private,domain enable=yes");

            MessageBox.Show(
                ok
                    ? "Izin firewall sudah dipasang.\n\nCoba hubungkan HP-mu lagi."
                    : "Tidak bisa mengubah aturan firewall.\n\n" +
                      "Kalau HP tetap tidak bisa menyambung, tambahkan izin secara manual\n" +
                      "lewat Windows Defender Firewall ▸ Allow an app through firewall.",
                "Taut",
                MessageBoxButtons.OK,
                ok ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        }

        /// <summary>
        /// Jalankan netsh dengan hak administrator. Penghapusan aturan yang
        /// memang belum ada juga dianggap berhasil — yang penting keadaan
        /// akhirnya benar, bukan tiap langkahnya.
        /// </summary>
        private static bool RunElevated(string arguments)
        {
            try
            {
                var info = new ProcessStartInfo
                {
                    FileName = "netsh",
                    Arguments = arguments,
                    UseShellExecute = true,
                    Verb = "runas", // memicu permintaan izin administrator
                    WindowStyle = ProcessWindowStyle.Hidden,
                };

                using (var process = Process.Start(info))
                {
                    if (process == null) return false;
                    process.WaitForExit(15000);
                    return true;
                }
            }
            catch
            {
                // Pengguna menolak permintaan izin administrator.
                return false;
            }
        }
    }
}
