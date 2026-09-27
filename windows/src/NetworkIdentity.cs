using System;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;

namespace Taut
{
    /// <summary>
    /// Jaringan mana yang sedang dipakai PC ini.
    ///
    /// Dipakai untuk mengikat izin "tanpa PIN" ke satu jaringan saja. Tanda
    /// pengenalnya adalah alamat MAC router — gateway bawaan — karena itulah
    /// yang benar-benar membedakan WiFi rumah dari WiFi kantor atau kos.
    /// Alamat IP router tidak bisa dipakai: 192.168.1.1 ada di hampir setiap
    /// rumah.
    ///
    /// Semua kegagalan berujung null, dan null berarti izin tanpa PIN tidak
    /// berlaku. Kalau ragu, PIN diminta.
    /// </summary>
    internal static class NetworkIdentity
    {
        [DllImport("iphlpapi.dll")]
        private static extern int GetBestInterface(uint destAddr, out uint bestIfIndex);

        [DllImport("iphlpapi.dll")]
        private static extern int SendARP(uint destIp, uint srcIp, byte[] macAddr, ref uint physAddrLen);

        private static readonly object CacheLock = new object();
        private static readonly TimeSpan CacheAge = TimeSpan.FromSeconds(30);
        private static string _cached;
        private static DateTime _cachedAt = DateTime.MinValue;

        /// <summary>
        /// Seperti Current(), tapi boleh basi beberapa detik.
        ///
        /// Untuk petunjuk yang sering ditanya — jawaban penemuan dan
        /// /api/info — yang tidak boleh menunggu seperempat detik tiap kali.
        /// Keputusan yang sesungguhnya, saat pairing, selalu memakai Current().
        /// </summary>
        public static string CurrentCached()
        {
            lock (CacheLock)
            {
                if (DateTime.UtcNow - _cachedAt < CacheAge) return _cached;
            }
            return Current();
        }

        /// <summary>Tanda pengenal jaringan sekarang, atau null kalau tidak pasti.</summary>
        public static string Current()
        {
            string fresh = Read();
            lock (CacheLock)
            {
                _cached = fresh;
                _cachedAt = DateTime.UtcNow;
            }
            return fresh;
        }

        private static string Read()
        {
            try
            {
                IPAddress gateway = DefaultGateway();
                if (gateway == null) return null;

                var mac = new byte[6];
                uint length = (uint)mac.Length;
                if (SendARP(ToIpAddr(gateway), 0, mac, ref length) != 0 || length < 6) return null;

                // Router yang tidak menjawab ARP mengembalikan nol semua.
                if (mac.All(b => b == 0)) return null;

                return string.Join("-", mac.Select(b => b.ToString("x2")).ToArray());
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Gateway milik antarmuka yang dipakai menuju internet.
        ///
        /// PC bisa punya banyak adapter — Bluetooth, VPN, Ethernet yang tidak
        /// tercolok — dan hanya satu yang benar-benar membawa lalu lintas.
        /// Windows ditanya rutenya ke sebuah alamat publik; tidak ada paket
        /// yang dikirim.
        /// </summary>
        private static IPAddress DefaultGateway()
        {
            uint index;
            if (GetBestInterface(ToIpAddr(IPAddress.Parse("1.1.1.1")), out index) != 0) return null;

            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;

                IPInterfaceProperties properties = nic.GetIPProperties();
                IPv4InterfaceProperties v4;
                try { v4 = properties.GetIPv4Properties(); }
                catch { continue; }

                if (v4 == null || v4.Index != index) continue;

                return properties.GatewayAddresses
                    .Select(g => g.Address)
                    .FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork &&
                                         !a.Equals(IPAddress.Any));
            }
            return null;
        }

        /// <summary>IPAddr versi Win32: byte alamat apa adanya, dibaca sebagai uint.</summary>
        private static uint ToIpAddr(IPAddress address)
        {
            return BitConverter.ToUInt32(address.GetAddressBytes(), 0);
        }
    }
}
