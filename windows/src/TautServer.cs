using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace Taut
{
    /// <summary>
    /// Server Taut: HTTP untuk halaman remote, WebSocket untuk kendali.
    ///
    /// Ditulis di atas TcpListener alih-alih HttpListener supaya tidak
    /// memerlukan hak administrator (lihat catatan di WebSocketConnection).
    /// Cakupan HTTP-nya sempit dan disengaja: GET berkas statis, dua endpoint
    /// JSON, dan upgrade WebSocket. Setiap jawaban memakai Connection: close,
    /// yang menghilangkan seluruh urusan keep-alive — halaman remote kecil,
    /// jadi biayanya tidak terasa.
    /// </summary>
    internal sealed class TautServer
    {
        public const int DefaultPort = 8787;

        private readonly int _port;
        private readonly Hub _hub = new Hub();
        private readonly SleepTimer _sleepTimer;

        private TcpListener _listener;
        private Thread _acceptThread;
        private Timer _pingTimer;
        private Discovery _discovery;
        private volatile bool _running;

        public Hub Hub { get { return _hub; } }
        public int Port { get { return _port; } }
        public bool IsRunning { get { return _running; } }

        public TautServer(int port)
        {
            _port = port;

            // Saat waktunya habis, perintah jeda dikirim seperti perintah dari
            // HP mana pun — tidak ada jalur khusus yang perlu dipelihara.
            _sleepTimer = new SleepTimer(() => PauseIfPlaying());
            _sleepTimer.Changed += () => _hub.Republish();
        }

        /// <summary>
        /// Jeda pemutar, tapi hanya kalau sedang berbunyi.
        ///
        /// Perintah playPause bersifat menjungkit. Mengirimnya saat musik sudah
        /// berhenti justru MENYALAKAN musik di tengah malam — persis kebalikan
        /// dari yang diminta timer tidur.
        /// </summary>
        private void PauseIfPlaying()
        {
            if (_hub.LastStateWasPlaying)
            {
                _hub.Dispatch("{\"type\":\"command\",\"action\":\"playPause\"}");
            }
        }

        // -------------------------------------------------------- daur hidup

        public void Start()
        {
            _listener = new TcpListener(IPAddress.Any, _port);
            _listener.Start();
            _running = true;

            _acceptThread = new Thread(AcceptLoop) { IsBackground = true, Name = "taut-accept" };
            _acceptThread.Start();

            _pingTimer = new Timer(_ => _hub.PingAll(), null, 20000, 20000);

            _discovery = new Discovery(_port, Version);
            _discovery.Start();

            // Volume Windows bukan urusan ekstensi — ia tidak punya cara
            // mengetahuinya — jadi servernya yang menyisipkan ke setiap
            // keadaan yang disiarkan.
            _hub.ServerFields = ServerFields;
        }

        public void Stop()
        {
            _running = false;

            _sleepTimer.Cancel();
            if (_discovery != null) { _discovery.Stop(); _discovery = null; }
            if (_pingTimer != null) { _pingTimer.Dispose(); _pingTimer = null; }
            try { if (_listener != null) _listener.Stop(); } catch { /* sudah berhenti */ }
        }

        /// <summary>Diturunkan dari package.json saat build; lihat BuildInfo.</summary>
        public static string Version
        {
            get { return BuildInfo.Version; }
        }

        private void AcceptLoop()
        {
            while (_running)
            {
                TcpClient client;
                try
                {
                    client = _listener.AcceptTcpClient();
                }
                catch
                {
                    if (!_running) return;
                    continue;
                }

                var thread = new Thread(() => HandleClient(client))
                {
                    IsBackground = true,
                    Name = "taut-client",
                };
                thread.Start();
            }
        }

        // ------------------------------------------------------------- HTTP

        private void HandleClient(TcpClient client)
        {
            try
            {
                client.NoDelay = true;
                var stream = client.GetStream();

                var request = HttpRequest.Read(stream);
                if (request == null) { client.Close(); return; }

                string remoteAddress = RemoteAddressOf(client);

                if (request.IsWebSocketUpgrade)
                {
                    HandleWebSocket(client, stream, request, remoteAddress);
                    return; // koneksi diambil alih oleh WebSocket
                }

                HandleHttp(stream, request, remoteAddress);
                client.Close();
            }
            catch
            {
                try { client.Close(); } catch { /* sudah tertutup */ }
            }
        }

        private void HandleHttp(NetworkStream stream, HttpRequest request, string remoteAddress)
        {
            if (request.Path == "/api/info")
            {
                WriteJson(stream, 200, BuildInfoJson(IsLoopback(remoteAddress)));
                return;
            }

            if (request.Path == "/api/pair")
            {
                HandlePair(stream, request);
                return;
            }

            WebAssets.Serve(stream, request.Path);
        }

        private void HandlePair(NetworkStream stream, HttpRequest request)
        {
            if (request.Method != "POST")
            {
                WriteJson(stream, 405, "{\"error\":\"gunakan POST\"}");
                return;
            }

            string pin = Json.GetString(request.Body, "pin");
            var result = Config.CheckPin(pin);

            if (result == Config.PinResult.Locked)
            {
                WriteJson(stream, 429,
                    "{\"error\":\"locked\",\"retryAfter\":" + Config.LockoutSecondsLeft + "}");
                return;
            }
            if (result == Config.PinResult.Invalid)
            {
                WriteJson(stream, 401, "{\"error\":\"invalid\"}");
                return;
            }

            WriteJson(stream, 200,
                "{\"token\":" + Json.String(Config.Token) +
                ",\"name\":\"Taut\",\"version\":" + Json.String(Version) + "}");
        }

        private string BuildInfoJson(bool trusted)
        {
            var sb = new StringBuilder();
            sb.Append("{\"name\":\"Taut\",\"version\":").Append(Json.String(Version));
            sb.Append(",\"hostConnected\":").Append(Json.Bool(_hub.HostCount > 0));
            sb.Append(",\"remotes\":").Append(_hub.RemoteCount);

            // PIN dan token hanya untuk yang sudah berada di komputer ini.
            if (trusted)
            {
                sb.Append(",\"pin\":").Append(Json.String(Config.Pin));
                sb.Append(",\"token\":").Append(Json.String(Config.Token));
                sb.Append(",\"port\":").Append(_port);
                sb.Append(",\"addresses\":[");
                sb.Append(string.Join(",", LanAddresses().Select(Json.String).ToArray()));
                sb.Append("]");
            }

            sb.Append("}");
            return sb.ToString();
        }

        private static void WriteJson(NetworkStream stream, int status, string body)
        {
            HttpRequest.WriteResponse(stream, status, "application/json; charset=utf-8",
                Encoding.UTF8.GetBytes(body));
        }

        // -------------------------------------------------------- WebSocket

        private void HandleWebSocket(TcpClient client, NetworkStream stream,
            HttpRequest request, string remoteAddress)
        {
            if (request.Path != "/ws")
            {
                client.Close();
                return;
            }

            string role = request.Query("role") == "host" ? "host" : "remote";
            string token = request.Query("token") ?? string.Empty;

            // Ekstensi selalu berjalan di komputer yang sama, jadi loopback
            // dipercaya tanpa token. Remote dari HP wajib membawa token.
            bool trusted = IsLoopback(remoteAddress) || TokenMatches(token);

            string accept = WebSocketConnection.AcceptKey(request.Header("Sec-WebSocket-Key"));
            var handshake = Encoding.ASCII.GetBytes(
                "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: " + accept + "\r\n\r\n");
            stream.Write(handshake, 0, handshake.Length);
            stream.Flush();

            var socket = new WebSocketConnection(client, remoteAddress);

            if (!trusted)
            {
                socket.Close(4003, "token tidak valid");
                return;
            }

            if (role == "host")
            {
                _hub.AddHost(socket);
                socket.Closed += () => _hub.RemoveHost(socket);
                socket.MessageReceived += message => OnHostMessage(message);
            }
            else
            {
                _hub.AddRemote(socket);
                socket.Closed += () => _hub.RemoveRemote(socket);
                socket.MessageReceived += message => OnRemoteMessage(socket, message);
            }

            socket.ReadLoop();
        }

        private void OnHostMessage(string message)
        {
            if (Json.GetString(message, "type") != "state") return;

            // Objek "state" diteruskan apa adanya; isinya milik ekstensi.
            string state = ExtractObject(message, "state");
            if (state != null) _hub.PublishState(state);
        }

        /// <summary>
        /// Keterangan volume Windows, ikut disisipkan ke setiap keadaan.
        ///
        /// "available" dikirim apa adanya supaya remote tahu harus menampilkan
        /// slider yang mana: tanpa perangkat audio, ia kembali mengatur volume
        /// tab seperti sebelumnya.
        /// </summary>
        private static string SystemVolumeFields()
        {
            float? level = SystemVolume.Get();
            if (!level.HasValue) return "\"systemVolumeAvailable\":false";

            bool muted = SystemVolume.GetMute() ?? false;
            return "\"systemVolumeAvailable\":true"
                 + ",\"systemVolume\":" + Json.Number(Math.Round(level.Value, 3))
                 + ",\"systemMuted\":" + Json.Bool(muted);
        }

        private string ServerFields()
        {
            return SystemVolumeFields()
                 + ",\"sleepTimerSeconds\":" + _sleepTimer.SecondsLeft;
        }

        /// <summary>
        /// Perintah yang dikerjakan server sendiri, bukan diteruskan ke
        /// ekstensi. Mengembalikan false kalau perintahnya bukan urusan server.
        /// </summary>
        private bool HandleLocally(string action, double? value)
        {
            if (action == "sleepTimer")
            {
                _sleepTimer.Start(value ?? 0);
            }
            else if (action == "systemVolume")
            {
                if (!value.HasValue) return true;
                SystemVolume.Set((float)value.Value);
            }
            else if (action == "systemMute")
            {
                SystemVolume.ToggleMute();
            }
            else
            {
                return false;
            }

            // Siarkan segera, supaya slider di HP tidak terasa tertinggal.
            _hub.Republish();
            return true;
        }

        private void OnRemoteMessage(WebSocketConnection socket, string message)
        {
            if (Json.GetString(message, "type") != "command") return;

            string action = Json.GetString(message, "action");
            if (string.IsNullOrEmpty(action)) return;

            if (HandleLocally(action, Json.GetNumber(message, "value"))) return;

            var sb = new StringBuilder();
            sb.Append("{\"type\":\"command\",\"action\":").Append(Json.String(action));

            double? value = Json.GetNumber(message, "value");
            if (value.HasValue) sb.Append(",\"value\":").Append(Json.Number(value.Value));

            sb.Append("}");

            if (_hub.Dispatch(sb.ToString())) return;

            // Tidak ada ekstensi yang menerima. Sebelum menyerah, coba tombol
            // media Windows — kasar, tapi lebih baik daripada tombol yang
            // tidak melakukan apa pun.
            if (MediaKeys.TryHandle(action)) return;

            socket.Send("{\"type\":\"host\",\"connected\":false}");
        }

        /// <summary>
        /// Ambil sebuah objek JSON bersarang apa adanya, dengan menghitung
        /// kurung kurawal. Dipakai agar bentuk "state" dari ekstensi tidak
        /// perlu dipahami server sama sekali.
        /// </summary>
        private static string ExtractObject(string json, string key)
        {
            int index = json.IndexOf("\"" + key + "\"", StringComparison.Ordinal);
            if (index < 0) return null;

            index = json.IndexOf('{', index);
            if (index < 0) return null;

            int depth = 0;
            bool inString = false, escaped = false;

            for (int i = index; i < json.Length; i++)
            {
                char c = json[i];

                if (escaped) { escaped = false; continue; }
                if (c == '\\' && inString) { escaped = true; continue; }
                if (c == '"') { inString = !inString; continue; }
                if (inString) continue;

                if (c == '{') depth++;
                else if (c == '}')
                {
                    depth--;
                    if (depth == 0) return json.Substring(index, i - index + 1);
                }
            }
            return null;
        }

        // ----------------------------------------------------------- utilitas

        private static bool TokenMatches(string candidate)
        {
            string expected = Config.Token;
            if (candidate == null || candidate.Length != expected.Length) return false;

            int diff = 0;
            for (int i = 0; i < candidate.Length; i++) diff |= candidate[i] ^ expected[i];
            return diff == 0;
        }

        private static string RemoteAddressOf(TcpClient client)
        {
            try
            {
                var endpoint = client.Client.RemoteEndPoint as IPEndPoint;
                return endpoint != null ? endpoint.Address.ToString() : string.Empty;
            }
            catch
            {
                return string.Empty;
            }
        }

        public static bool IsLoopback(string address)
        {
            if (string.IsNullOrEmpty(address)) return false;
            if (address.StartsWith("::ffff:", StringComparison.Ordinal)) address = address.Substring(7);
            return address == "::1" || address.StartsWith("127.", StringComparison.Ordinal);
        }

        /// <summary>Alamat IPv4 LAN, yang paling mungkin dipakai HP lebih dulu.</summary>
        public static List<string> LanAddresses()
        {
            var found = new List<string>();
            try
            {
                foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (nic.OperationalStatus != OperationalStatus.Up) continue;
                    if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;

                    foreach (var info in nic.GetIPProperties().UnicastAddresses)
                    {
                        if (info.Address.AddressFamily != AddressFamily.InterNetwork) continue;

                        string ip = info.Address.ToString();
                        // 169.254.x.x muncul pada adapter yang tidak benar-benar
                        // tersambung; menawarkannya cuma menyesatkan.
                        if (ip.StartsWith("169.254.", StringComparison.Ordinal)) continue;
                        found.Add(ip);
                    }
                }
            }
            catch
            {
                // Tidak bisa menyebut antarmuka; daftar kosong sudah menjelaskan.
            }

            // Dahulukan rentang rumahan yang paling umum.
            return found
                .OrderBy(ip => ip.StartsWith("192.168.", StringComparison.Ordinal) ? 0
                             : ip.StartsWith("10.", StringComparison.Ordinal) ? 1 : 2)
                .ToList();
        }

        /// <summary>URL lengkap berikut token, siap dijadikan QR.</summary>
        public string RemoteUrl
        {
            get
            {
                var addresses = LanAddresses();
                string host = addresses.Count > 0 ? addresses[0] : "localhost";
                return "http://" + host + ":" + _port + "/#t=" + Config.Token;
            }
        }
    }
}
