using System;
using System.Collections.Generic;
using System.Linq;

namespace Taut
{
    /// <summary>
    /// Titik temu antara ekstensi browser dan remote di HP.
    ///
    /// Hub tidak pernah "tahu" cara memutar musik. Ia hanya meneruskan
    /// perintah ke ekstensi, dan menyiarkan balik keadaan pemutar ke setiap
    /// remote — sambil menyimpan keadaan terakhir, supaya remote yang baru
    /// dibuka langsung melihat lagu yang sedang berjalan.
    /// </summary>
    internal sealed class Hub
    {
        private readonly object _lock = new object();
        private readonly List<WebSocketConnection> _hosts = new List<WebSocketConnection>();
        private readonly List<WebSocketConnection> _remotes = new List<WebSocketConnection>();

        /// <summary>Keadaan pemutar terakhir, apa adanya sebagai JSON.</summary>
        private string _stateJson;

        /// <summary>Diberi tahu saat jumlah sambungan berubah, untuk memperbarui tampilan.</summary>
        public event Action Changed;

        public int HostCount { get { lock (_lock) return _hosts.Count; } }
        public int RemoteCount { get { lock (_lock) return _remotes.Count; } }

        // ---------------------------------------------------------------- host

        public void AddHost(WebSocketConnection socket)
        {
            lock (_lock) _hosts.Add(socket);
            BroadcastToRemotes("{\"type\":\"host\",\"connected\":true}");
            RaiseChanged();
        }

        public void RemoveHost(WebSocketConnection socket)
        {
            bool empty;
            lock (_lock)
            {
                _hosts.Remove(socket);
                empty = _hosts.Count == 0;
                if (empty) _stateJson = null;
            }

            if (empty) BroadcastToRemotes("{\"type\":\"host\",\"connected\":false}");
            RaiseChanged();
        }

        // -------------------------------------------------------------- remote

        public void AddRemote(WebSocketConnection socket)
        {
            string state;
            bool hostConnected;

            lock (_lock)
            {
                _remotes.Add(socket);
                hostConnected = _hosts.Count > 0;
                state = _stateJson;
            }

            socket.Send("{\"type\":\"host\",\"connected\":" + Json.Bool(hostConnected) + "}");

            // Hanya kirim kalau memang sudah ada laporan dari ekstensi. Keadaan
            // kosong justru membuat remote mengira PC-nya belum siap.
            if (state != null) socket.Send("{\"type\":\"state\",\"state\":" + state + "}");

            RaiseChanged();
        }

        public void RemoveRemote(WebSocketConnection socket)
        {
            lock (_lock) _remotes.Remove(socket);
            RaiseChanged();
        }

        // ----------------------------------------------------------- lalu lintas

        /// <summary>Keadaan baru dari ekstensi: simpan, lalu sebarkan.</summary>
        public void PublishState(string stateJson)
        {
            // Tandai tersambung di dalam keadaan itu sendiri, seperti yang
            // diharapkan halaman remote.
            string withFlag = InsertConnectedFlag(stateJson);

            lock (_lock) _stateJson = withFlag;
            BroadcastToRemotes("{\"type\":\"state\",\"state\":" + withFlag + "}");
        }

        /// <summary>Perintah dari remote diteruskan ke semua ekstensi.</summary>
        public bool Dispatch(string commandJson)
        {
            WebSocketConnection[] hosts;
            lock (_lock) hosts = _hosts.ToArray();

            if (hosts.Length == 0) return false;
            foreach (var host in hosts) host.Send(commandJson);
            return true;
        }

        private void BroadcastToRemotes(string message)
        {
            WebSocketConnection[] remotes;
            lock (_lock) remotes = _remotes.ToArray();

            foreach (var remote in remotes) remote.Send(message);
        }

        /// <summary>
        /// Sisipkan "connected": true ke dalam objek keadaan.
        ///
        /// Keadaan dari ekstensi diteruskan apa adanya tanpa diurai, karena
        /// isinya bisa berubah kapan saja mengikuti YouTube Music. Yang
        /// ditambahkan hanya satu medan di awal objek.
        /// </summary>
        private static string InsertConnectedFlag(string stateJson)
        {
            if (string.IsNullOrEmpty(stateJson)) return "{\"connected\":true}";

            string trimmed = stateJson.Trim();
            if (!trimmed.StartsWith("{", StringComparison.Ordinal)) return "{\"connected\":true}";
            if (trimmed == "{}") return "{\"connected\":true}";

            return "{\"connected\":true," + trimmed.Substring(1);
        }

        // -------------------------------------------------------- pemeliharaan

        /// <summary>
        /// Putuskan koneksi yang sudah mati diam-diam — HP yang tertidur atau
        /// berpindah WiFi tidak selalu mengirim pesan penutup.
        /// </summary>
        public void PingAll()
        {
            WebSocketConnection[] all;
            lock (_lock) all = _hosts.Concat(_remotes).ToArray();

            foreach (var socket in all)
            {
                if (!socket.IsAlive)
                {
                    socket.Terminate();
                    continue;
                }
                socket.IsAlive = false;
                socket.Ping();
            }
        }

        private void RaiseChanged()
        {
            var handler = Changed;
            if (handler != null) handler();
        }
    }
}
