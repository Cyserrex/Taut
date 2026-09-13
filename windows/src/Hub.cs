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

        /// <summary>Keadaan pemutar terakhir dari ekstensi, apa adanya.</summary>
        private string _rawState;

        /// <summary>
        /// Apakah laporan terakhir menyebut musik sedang berbunyi.
        ///
        /// Perintah playPause bersifat menjungkit, jadi apa pun yang ingin
        /// "menghentikan" pemutar harus tahu keadaannya lebih dulu.
        /// </summary>
        public bool LastStateWasPlaying
        {
            get
            {
                lock (_lock)
                {
                    return _rawState != null
                        && _rawState.IndexOf("\"playing\":true", StringComparison.Ordinal) >= 0;
                }
            }
        }

        /// <summary>
        /// Medan tambahan milik server, disisipkan ke setiap keadaan yang
        /// disiarkan — volume Windows, misalnya, yang tidak diketahui ekstensi.
        ///
        /// Disisipkan saat mengirim, bukan saat menyimpan, supaya nilainya
        /// selalu segar meski keadaan pemutarnya belum berubah.
        /// </summary>
        public Func<string> ServerFields;

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
                if (empty) _rawState = null;
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
                state = _rawState;
            }

            socket.Send("{\"type\":\"host\",\"connected\":" + Json.Bool(hostConnected) + "}");

            // Hanya kirim kalau memang sudah ada laporan dari ekstensi. Keadaan
            // kosong justru membuat remote mengira PC-nya belum siap.
            if (state != null) socket.Send(StateMessage(state));

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
            lock (_lock) _rawState = stateJson;
            BroadcastToRemotes(StateMessage(stateJson));
        }

        /// <summary>
        /// Siarkan ulang keadaan terakhir tanpa menunggu laporan berikutnya
        /// dari ekstensi — dipakai setelah server sendiri mengubah sesuatu,
        /// supaya tampilan di HP langsung menyusul.
        /// </summary>
        public void Republish()
        {
            string state;
            lock (_lock) state = _rawState;

            if (state != null) BroadcastToRemotes(StateMessage(state));
        }

        private string StateMessage(string rawState)
        {
            return "{\"type\":\"state\",\"state\":" + Decorate(rawState) + "}";
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
        /// Sisipkan medan milik server ke dalam objek keadaan dari ekstensi.
        ///
        /// Keadaan itu diteruskan apa adanya tanpa diurai, karena isinya bisa
        /// berubah kapan saja mengikuti YouTube Music. Yang ditambahkan hanya
        /// beberapa medan di awal objek.
        /// </summary>
        private string Decorate(string stateJson)
        {
            var prefix = new System.Text.StringBuilder("{\"connected\":true");

            var fields = ServerFields;
            if (fields != null)
            {
                string extra = null;
                try { extra = fields(); }
                catch { /* medan tambahan tidak boleh menjatuhkan siaran */ }

                if (!string.IsNullOrEmpty(extra)) prefix.Append(',').Append(extra);
            }

            string trimmed = (stateJson ?? string.Empty).Trim();
            if (trimmed.Length < 2 || !trimmed.StartsWith("{", StringComparison.Ordinal))
            {
                return prefix.Append('}').ToString();
            }
            if (trimmed == "{}") return prefix.Append('}').ToString();

            return prefix.Append(',').Append(trimmed.Substring(1)).ToString();
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
