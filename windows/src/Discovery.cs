using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace Taut
{
    /// <summary>
    /// Menjawab pertanyaan penemuan dari aplikasi Android.
    ///
    /// Tanpa ini, aplikasi harus diberi tahu alamat IP PC — dan alamat itu
    /// berubah setiap kali router membagikannya ulang. Di sini PC cukup
    /// menjawab "saya di sini" kepada siapa pun yang bertanya di jaringan yang
    /// sama, jadi alamat yang berpindah tidak lagi jadi masalah.
    ///
    /// Jawabannya sengaja TIDAK memuat token: siapa pun boleh bertanya, tapi
    /// untuk benar-benar mengendalikan pemutar tetap harus lewat pairing.
    /// </summary>
    internal sealed class Discovery
    {
        private const string Probe = "TAUT-DISCOVER";
        private const int MaxProbeBytes = 64;

        private readonly int _port;
        private readonly string _version;

        private UdpClient _socket;
        private Thread _thread;
        private volatile bool _running;

        public Discovery(int port, string version)
        {
            _port = port;
            _version = version;
        }

        public void Start()
        {
            try
            {
                _socket = new UdpClient();
                _socket.ExclusiveAddressUse = false;
                _socket.Client.SetSocketOption(SocketOptionLevel.Socket,
                    SocketOptionName.ReuseAddress, true);
                _socket.Client.Bind(new IPEndPoint(IPAddress.Any, _port));
                _socket.EnableBroadcast = true;
            }
            catch
            {
                // Port UDP dipakai program lain, atau jaringan menolak. Taut
                // tetap jalan; pengguna masih bisa memasukkan alamat manual.
                _socket = null;
                return;
            }

            _running = true;
            _thread = new Thread(Listen) { IsBackground = true, Name = "taut-discovery" };
            _thread.Start();
        }

        public void Stop()
        {
            _running = false;
            try { if (_socket != null) _socket.Close(); } catch { /* sudah tertutup */ }
            _socket = null;
        }

        private void Listen()
        {
            var any = new IPEndPoint(IPAddress.Any, 0);

            while (_running)
            {
                byte[] datagram;
                try
                {
                    datagram = _socket.Receive(ref any);
                }
                catch
                {
                    if (!_running) return;
                    continue;
                }

                if (datagram.Length == 0 || datagram.Length > MaxProbeBytes) continue;
                if (Encoding.UTF8.GetString(datagram).Trim() != Probe) continue;

                var reply = Encoding.UTF8.GetBytes(
                    "{\"app\":\"taut\",\"name\":" + Json.String(Environment.MachineName) +
                    ",\"port\":" + _port +
                    ",\"version\":" + Json.String(_version) + "}");

                try { _socket.Send(reply, reply.Length, any); }
                catch { /* penanya sudah pergi */ }
            }
        }
    }
}
