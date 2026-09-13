using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Text;

namespace Taut
{
    /// <summary>
    /// Satu permintaan HTTP, diurai seadanya dari soket mentah.
    ///
    /// Yang perlu dipahami Taut cuma: baris permintaan, beberapa header, dan
    /// badan JSON pendek. Tidak ada chunked encoding, tidak ada keep-alive —
    /// setiap jawaban menutup koneksinya, sehingga tidak ada keadaan yang
    /// perlu dijaga antar-permintaan.
    /// </summary>
    internal sealed class HttpRequest
    {
        private const int MaxHeaderBytes = 16 * 1024;
        private const int MaxBodyBytes = 64 * 1024;

        private readonly Dictionary<string, string> _headers =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, string> _query =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public string Method { get; private set; }
        public string Path { get; private set; }
        public string Body { get; private set; }

        public string Header(string name)
        {
            string value;
            return _headers.TryGetValue(name, out value) ? value : null;
        }

        public string Query(string name)
        {
            string value;
            return _query.TryGetValue(name, out value) ? value : null;
        }

        public bool IsWebSocketUpgrade
        {
            get
            {
                string upgrade = Header("Upgrade");
                return upgrade != null
                    && upgrade.IndexOf("websocket", StringComparison.OrdinalIgnoreCase) >= 0
                    && !string.IsNullOrEmpty(Header("Sec-WebSocket-Key"));
            }
        }

        /// <summary>Baca satu permintaan, atau null kalau bentuknya tidak masuk akal.</summary>
        public static HttpRequest Read(NetworkStream stream)
        {
            var head = new MemoryStream();
            var one = new byte[1];
            int matched = 0; // berapa banyak karakter dari "\r\n\r\n" yang sudah cocok

            while (matched < 4)
            {
                int got;
                try { got = stream.Read(one, 0, 1); }
                catch { return null; }
                if (got <= 0) return null;

                head.WriteByte(one[0]);
                if (head.Length > MaxHeaderBytes) return null;

                char expected = matched == 0 || matched == 2 ? '\r' : '\n';
                matched = one[0] == expected ? matched + 1 : (one[0] == '\r' ? 1 : 0);
            }

            var lines = Encoding.ASCII.GetString(head.ToArray())
                .Split(new[] { "\r\n" }, StringSplitOptions.None);
            if (lines.Length == 0) return null;

            var parts = lines[0].Split(' ');
            if (parts.Length < 2) return null;

            var request = new HttpRequest { Method = parts[0] };

            string target = parts[1];
            int queryStart = target.IndexOf('?');
            if (queryStart >= 0)
            {
                request.ParseQuery(target.Substring(queryStart + 1));
                target = target.Substring(0, queryStart);
            }
            // Fragmen (#...) tidak pernah dikirim browser, tapi klien lain bisa.
            int hash = target.IndexOf('#');
            if (hash >= 0) target = target.Substring(0, hash);

            request.Path = Uri.UnescapeDataString(target);

            for (int i = 1; i < lines.Length; i++)
            {
                string line = lines[i];
                if (line.Length == 0) continue;

                int colon = line.IndexOf(':');
                if (colon <= 0) continue;

                request._headers[line.Substring(0, colon).Trim()] = line.Substring(colon + 1).Trim();
            }

            request.ReadBody(stream);
            return request;
        }

        private void ParseQuery(string query)
        {
            foreach (string pair in query.Split('&'))
            {
                if (pair.Length == 0) continue;

                int equals = pair.IndexOf('=');
                string key = equals < 0 ? pair : pair.Substring(0, equals);
                string value = equals < 0 ? string.Empty : pair.Substring(equals + 1);

                try { _query[Uri.UnescapeDataString(key)] = Uri.UnescapeDataString(value); }
                catch { /* persentase yang rusak; lewati saja */ }
            }
        }

        private void ReadBody(NetworkStream stream)
        {
            string lengthHeader = Header("Content-Length");
            int length;
            if (lengthHeader == null || !int.TryParse(lengthHeader, out length) || length <= 0)
            {
                Body = string.Empty;
                return;
            }
            if (length > MaxBodyBytes)
            {
                Body = string.Empty;
                return;
            }

            var buffer = new byte[length];
            int read = 0;
            while (read < length)
            {
                int got;
                try { got = stream.Read(buffer, read, length - read); }
                catch { break; }
                if (got <= 0) break;
                read += got;
            }

            Body = Encoding.UTF8.GetString(buffer, 0, read);
        }

        // ---------------------------------------------------------- jawaban

        private static string StatusText(int status)
        {
            switch (status)
            {
                case 200: return "OK";
                case 401: return "Unauthorized";
                case 403: return "Forbidden";
                case 404: return "Not Found";
                case 405: return "Method Not Allowed";
                case 429: return "Too Many Requests";
                default: return "OK";
            }
        }

        public static void WriteResponse(NetworkStream stream, int status, string contentType, byte[] body)
        {
            var header = new StringBuilder();
            header.Append("HTTP/1.1 ").Append(status).Append(' ').Append(StatusText(status)).Append("\r\n");
            header.Append("Content-Type: ").Append(contentType).Append("\r\n");
            header.Append("Content-Length: ").Append(body.Length).Append("\r\n");
            header.Append("Cache-Control: no-cache\r\n");
            header.Append("Connection: close\r\n\r\n");

            var headerBytes = Encoding.ASCII.GetBytes(header.ToString());

            try
            {
                stream.Write(headerBytes, 0, headerBytes.Length);
                if (body.Length > 0) stream.Write(body, 0, body.Length);
                stream.Flush();
            }
            catch
            {
                // Klien menutup lebih dulu; tidak ada yang perlu dilakukan.
            }
        }
    }
}
