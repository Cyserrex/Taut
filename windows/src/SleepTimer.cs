using System;
using System.Threading;

namespace Taut
{
    /// <summary>
    /// Berhenti memutar setelah sekian menit.
    ///
    /// Seluruhnya dikerjakan server: hitung mundur di sini, lalu satu perintah
    /// jeda ke ekstensi saat waktunya habis. Tidak ada bagian yang membaca
    /// struktur halaman YouTube Music, jadi fitur ini tidak ikut rusak kalau
    /// YouTube mengubah tampilannya.
    ///
    /// Hitung mundurnya memakai waktu berakhir, bukan sisa detik yang
    /// dikurangi berkala: kalau PC tertidur di tengah jalan, timer tetap
    /// berakhir pada waktu yang benar alih-alih tertunda selama PC tidur.
    /// </summary>
    internal sealed class SleepTimer
    {
        private readonly object _lock = new object();
        private readonly Action _onElapsed;

        private Timer _timer;
        private DateTime _endsAt;

        /// <summary>Dipanggil saat timer dipasang, dibatalkan, atau berakhir.</summary>
        public event Action Changed;

        public SleepTimer(Action onElapsed)
        {
            _onElapsed = onElapsed;
        }

        /// <summary>Sisa detik, atau 0 kalau tidak ada timer yang berjalan.</summary>
        public int SecondsLeft
        {
            get
            {
                lock (_lock)
                {
                    if (_timer == null) return 0;

                    var left = _endsAt - DateTime.UtcNow;
                    return left > TimeSpan.Zero ? (int)Math.Ceiling(left.TotalSeconds) : 0;
                }
            }
        }

        public bool IsRunning
        {
            get { lock (_lock) return _timer != null; }
        }

        /// <summary>
        /// Pasang timer. Nol menit atau kurang berarti membatalkan.
        ///
        /// Menerima pecahan menit supaya bisa diuji tanpa menunggu belasan
        /// menit setiap kali.
        /// </summary>
        public void Start(double minutes)
        {
            if (minutes <= 0)
            {
                Cancel();
                return;
            }

            // Batas atas sekadar penjaga kewarasan; tidak ada yang butuh timer
            // tidur dua belas jam.
            minutes = Math.Min(minutes, 720);

            lock (_lock)
            {
                Dispose();
                _endsAt = DateTime.UtcNow.AddMinutes(minutes);

                // Diperiksa berkala, bukan sekali tembak: Timer .NET bisa
                // meleset jauh kalau PC sempat tidur.
                _timer = new Timer(Tick, null, 1000, 1000);
            }

            RaiseChanged();
        }

        public void Cancel()
        {
            bool wasRunning;
            lock (_lock)
            {
                wasRunning = _timer != null;
                Dispose();
            }

            if (wasRunning) RaiseChanged();
        }

        private void Tick(object _)
        {
            lock (_lock)
            {
                if (_timer == null) return;
                if (DateTime.UtcNow < _endsAt) return;
                Dispose();
            }

            try
            {
                _onElapsed();
            }
            catch
            {
                // Ekstensi sudah pergi; tidak ada yang bisa dijeda.
            }

            RaiseChanged();
        }

        /// <summary>Harus dipanggil dari dalam lock.</summary>
        private void Dispose()
        {
            if (_timer == null) return;

            try { _timer.Dispose(); } catch { /* sudah dilepas */ }
            _timer = null;
        }

        private void RaiseChanged()
        {
            var handler = Changed;
            if (handler != null) handler();
        }
    }
}
