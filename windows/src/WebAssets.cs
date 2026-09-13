using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Reflection;
using System.Text;

namespace Taut
{
    /// <summary>
    /// Halaman remote, ikut tertanam di dalam berkas .exe.
    ///
    /// Menanamnya berarti Taut benar-benar satu berkas: tidak ada folder yang
    /// harus ikut disalin, tidak ada jalur yang bisa salah, dan tidak ada yang
    /// bisa terhapus sebagian.
    /// </summary>
    internal static class WebAssets
    {
        private const string Prefix = "Taut.web.";

        private static readonly Dictionary<string, string> MimeTypes =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                { ".html", "text/html; charset=utf-8" },
                { ".css", "text/css; charset=utf-8" },
                { ".js", "text/javascript; charset=utf-8" },
                { ".json", "application/json; charset=utf-8" },
                { ".webmanifest", "application/manifest+json" },
                { ".svg", "image/svg+xml" },
                { ".png", "image/png" },
                { ".ico", "image/x-icon" },
            };

        public static void Serve(NetworkStream stream, string path)
        {
            if (path == "/" || string.IsNullOrEmpty(path)) path = "/index.html";

            byte[] body = Read(path);
            if (body == null)
            {
                HttpRequest.WriteResponse(stream, 404, "text/plain; charset=utf-8",
                    Encoding.UTF8.GetBytes("Tidak ditemukan"));
                return;
            }

            HttpRequest.WriteResponse(stream, 200, MimeFor(path), body);
        }

        /// <summary>Baca satu berkas tertanam, atau null kalau tidak ada.</summary>
        public static byte[] Read(string path)
        {
            string name = ResourceName(path);
            if (name == null) return null;

            var assembly = Assembly.GetExecutingAssembly();
            using (var input = assembly.GetManifestResourceStream(name))
            {
                if (input == null) return null;

                using (var buffer = new MemoryStream())
                {
                    input.CopyTo(buffer);
                    return buffer.ToArray();
                }
            }
        }

        /// <summary>
        /// Ubah jalur URL jadi nama sumber daya tertanam.
        ///
        /// Compiler mengganti pemisah folder jadi titik, jadi "/icons/icon.svg"
        /// menjadi "Taut.web.icons.icon.svg". Jalur yang mengandung ".." atau
        /// karakter aneh ditolak — sumber daya tertanam tidak bisa "keluar
        /// folder", tapi menolaknya lebih awal membuat maksudnya jelas.
        /// </summary>
        private static string ResourceName(string path)
        {
            if (path.IndexOf("..", StringComparison.Ordinal) >= 0) return null;

            string trimmed = path.TrimStart('/');
            if (trimmed.Length == 0) return null;

            foreach (char c in trimmed)
            {
                bool allowed = char.IsLetterOrDigit(c) || c == '.' || c == '-' || c == '_' || c == '/';
                if (!allowed) return null;
            }

            return Prefix + trimmed.Replace('/', '.');
        }

        private static string MimeFor(string path)
        {
            string extension = Path.GetExtension(path);
            string mime;
            return MimeTypes.TryGetValue(extension ?? string.Empty, out mime)
                ? mime
                : "application/octet-stream";
        }
    }
}
