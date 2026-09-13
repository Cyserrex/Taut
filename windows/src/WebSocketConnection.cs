using System;
using System.IO;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace Taut
{
    /// <summary>
    /// Satu koneksi WebSocket (RFC 6455), ditulis di atas TcpClient biasa.
    ///
    /// .NET Framework punya WebSocket lewat HttpListener, tapi HttpListener
    /// menuntut pendaftaran URL ACL (netsh http add urlacl) untuk mendengarkan
    /// di alamat selain localhost — artinya Taut harus dijalankan sebagai
    /// administrator, atau pemasangannya jadi berbelit. Soket mentah
    /// menghindari keduanya sepenuhnya.
    ///
    /// Cakupannya sengaja sempit, sama seperti versi JavaScript-nya: pesan
    /// teks JSON, ping/pong, dan penutupan yang rapi.
    /// </summary>
    internal sealed class WebSocketConnection
    {
        private const string HandshakeGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
        private const int MaxMessageBytes = 1024 * 1024;

        private const int OpContinuation = 0x0;
        private const int OpText = 0x1;
        private const int OpBinary = 0x2;
        private const int OpClose = 0x8;
        private const int OpPing = 0x9;
        private const int OpPong = 0xa;

        private readonly TcpClient _client;
        private readonly NetworkStream _stream;
        private readonly object _writeLock = new object();

        private bool _closed;

        public event Action<string> MessageReceived;
        public event Action Closed;

        /// <summary>Ditandai false sebelum ping, dan true lagi saat ada balasan.</summary>
        public bool IsAlive = true;

        public string RemoteAddress { get; private set; }

        public WebSocketConnection(TcpClient client, string remoteAddress)
        {
            _client = client;
            _stream = client.GetStream();
            RemoteAddress = remoteAddress;
        }

        /// <summary>Jawaban handshake yang membuktikan server memahami protokolnya.</summary>
        public static string AcceptKey(string clientKey)
        {
            using (var sha1 = SHA1.Create())
            {
                var hash = sha1.ComputeHash(Encoding.ASCII.GetBytes(clientKey + HandshakeGuid));
                return Convert.ToBase64String(hash);
            }
        }

        public void Send(string text)
        {
            if (_closed) return;
            WriteFrame(OpText, Encoding.UTF8.GetBytes(text));
        }

        public void Ping()
        {
            if (_closed) return;
            WriteFrame(OpPing, new byte[0]);
        }

        public void Close(ushort code = 1000, string reason = "")
        {
            if (_closed) return;

            var reasonBytes = Encoding.UTF8.GetBytes(reason ?? string.Empty);
            var payload = new byte[2 + reasonBytes.Length];
            payload[0] = (byte)(code >> 8);
            payload[1] = (byte)(code & 0xff);
            Buffer.BlockCopy(reasonBytes, 0, payload, 2, reasonBytes.Length);

            WriteFrame(OpClose, payload);
            Finish();
        }

        public void Terminate()
        {
            Finish();
        }

        private void Finish()
        {
            if (_closed) return;
            _closed = true;

            try { _client.Close(); } catch { /* sudah tertutup */ }

            var handler = Closed;
            if (handler != null) handler();
        }

        private void WriteFrame(int opcode, byte[] payload)
        {
            // Frame dari server tidak pernah di-mask (RFC 6455 §5.1).
            byte[] header;
            int length = payload.Length;

            if (length < 126)
            {
                header = new byte[2];
                header[1] = (byte)length;
            }
            else if (length < 65536)
            {
                header = new byte[4];
                header[1] = 126;
                header[2] = (byte)(length >> 8);
                header[3] = (byte)(length & 0xff);
            }
            else
            {
                header = new byte[10];
                header[1] = 127;
                for (int i = 0; i < 8; i++) header[9 - i] = (byte)((long)length >> (8 * i));
            }
            header[0] = (byte)(0x80 | opcode); // FIN + opcode

            try
            {
                lock (_writeLock)
                {
                    _stream.Write(header, 0, header.Length);
                    if (length > 0) _stream.Write(payload, 0, length);
                    _stream.Flush();
                }
            }
            catch
            {
                Finish(); // pihak lain sudah pergi
            }
        }

        /// <summary>Baca frame sampai koneksi berakhir. Memblokir; jalankan di thread sendiri.</summary>
        public void ReadLoop()
        {
            var fragments = new MemoryStream();
            int fragmentOpcode = -1;

            try
            {
                while (!_closed)
                {
                    var head = ReadExactly(2);
                    if (head == null) break;

                    bool fin = (head[0] & 0x80) != 0;
                    int opcode = head[0] & 0x0f;
                    bool masked = (head[1] & 0x80) != 0;
                    long length = head[1] & 0x7f;

                    if (length == 126)
                    {
                        var ext = ReadExactly(2);
                        if (ext == null) break;
                        length = (ext[0] << 8) | ext[1];
                    }
                    else if (length == 127)
                    {
                        var ext = ReadExactly(8);
                        if (ext == null) break;
                        length = 0;
                        for (int i = 0; i < 8; i++) length = (length << 8) | ext[i];
                    }

                    if (length > MaxMessageBytes)
                    {
                        Close(1009, "pesan terlalu besar");
                        break;
                    }

                    byte[] mask = null;
                    if (masked)
                    {
                        mask = ReadExactly(4);
                        if (mask == null) break;
                    }

                    var payload = ReadExactly((int)length);
                    if (payload == null) break;

                    if (mask != null)
                    {
                        for (int i = 0; i < payload.Length; i++) payload[i] ^= mask[i & 3];
                    }

                    if (opcode == OpPing)
                    {
                        WriteFrame(OpPong, payload);
                        continue;
                    }
                    if (opcode == OpPong)
                    {
                        IsAlive = true;
                        continue;
                    }
                    if (opcode == OpClose)
                    {
                        Close();
                        break;
                    }

                    if (opcode == OpContinuation)
                    {
                        if (fragmentOpcode < 0) continue; // fragmen yatim
                        fragments.Write(payload, 0, payload.Length);
                        if (!fin) continue;

                        if (fragmentOpcode == OpText) Deliver(fragments.ToArray());
                        fragments.SetLength(0);
                        fragmentOpcode = -1;
                        continue;
                    }

                    if (opcode == OpText || opcode == OpBinary)
                    {
                        if (!fin)
                        {
                            fragmentOpcode = opcode;
                            fragments.SetLength(0);
                            fragments.Write(payload, 0, payload.Length);
                            continue;
                        }
                        if (opcode == OpText) Deliver(payload);
                        continue;
                    }

                    Close(1002, "opcode tidak dikenal");
                    break;
                }
            }
            catch
            {
                // Koneksi putus di tengah jalan; ditangani seperti penutupan biasa.
            }
            finally
            {
                Finish();
            }
        }

        private void Deliver(byte[] payload)
        {
            IsAlive = true;
            var handler = MessageReceived;
            if (handler != null) handler(Encoding.UTF8.GetString(payload));
        }

        /// <summary>Baca tepat sekian byte, atau null kalau koneksi berakhir lebih dulu.</summary>
        private byte[] ReadExactly(int count)
        {
            if (count == 0) return new byte[0];

            var buffer = new byte[count];
            int read = 0;
            while (read < count)
            {
                int got = _stream.Read(buffer, read, count - read);
                if (got <= 0) return null;
                read += got;
            }
            return buffer;
        }
    }
}
