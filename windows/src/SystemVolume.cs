using System;
using System.Runtime.InteropServices;

namespace Taut
{
    /// <summary>
    /// Volume Windows, lewat Core Audio API.
    ///
    /// Slider di HP sebelumnya hanya mengatur elemen &lt;video&gt; di tab YouTube
    /// Music. Kalau volume Windows sedang di 20%, batas atasnya tetap 20% —
    /// dan dari HP tidak ada cara mengetahui itu. Di sinilah gunanya server
    /// berupa program Windows asli: ekstensi browser tidak bisa menyentuh
    /// volume sistem, tapi Taut.exe bisa.
    ///
    /// Seluruh isinya defensif. Kalau perangkat audio tidak ada, atau COM
    /// menolak, Taut tetap berjalan dan slider kembali mengatur volume tab.
    /// </summary>
    internal static class SystemVolume
    {
        // ------------------------------------------------------------- COM

        private static readonly Guid DeviceEnumeratorClsid =
            new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");

        private const int RenderDevice = 0;  // eRender
        private const int ConsoleRole = 0;   // eConsole
        private const int ClsCtxAll = 23;

        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),
         InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDeviceEnumerator
        {
            int NotImplemented_EnumAudioEndpoints();

            [PreserveSig]
            int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        }

        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"),
         InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDevice
        {
            [PreserveSig]
            int Activate(ref Guid iid, int classContext, IntPtr activationParams,
                [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        }

        /// <summary>
        /// Urutan method WAJIB sama persis dengan urutan vtable-nya. Menyisipkan
        /// atau melewatkan satu baris saja membuat panggilan berikutnya
        /// mendarat di alamat yang salah.
        /// </summary>
        [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),
         InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioEndpointVolume
        {
            int NotImplemented_RegisterControlChangeNotify();
            int NotImplemented_UnregisterControlChangeNotify();
            int NotImplemented_GetChannelCount();
            int NotImplemented_SetMasterVolumeLevel();

            [PreserveSig]
            int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);

            int NotImplemented_GetMasterVolumeLevel();

            [PreserveSig]
            int GetMasterVolumeLevelScalar(out float level);

            int NotImplemented_SetChannelVolumeLevel();
            int NotImplemented_SetChannelVolumeLevelScalar();
            int NotImplemented_GetChannelVolumeLevel();
            int NotImplemented_GetChannelVolumeLevelScalar();

            [PreserveSig]
            int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);

            [PreserveSig]
            int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
        }

        // ---------------------------------------------------------- keadaan

        /// <summary>
        /// Antarmuka volume disimpan supaya tidak dibuat ulang tiap perubahan —
        /// slider di HP mengirim puluhan nilai saat digeser.
        /// </summary>
        private static IAudioEndpointVolume _endpoint;
        private static bool _unavailable;

        private static readonly object Lock = new object();
        private static Guid _noEventContext = Guid.Empty;

        /// <summary>Benar kalau volume Windows benar-benar bisa dikendalikan.</summary>
        public static bool IsAvailable
        {
            get { return Endpoint() != null; }
        }

        private static IAudioEndpointVolume Endpoint()
        {
            lock (Lock)
            {
                if (_endpoint != null) return _endpoint;
                if (_unavailable) return null;

                try
                {
                    var enumeratorType = Type.GetTypeFromCLSID(DeviceEnumeratorClsid);
                    var enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(enumeratorType);

                    IMMDevice device;
                    if (enumerator.GetDefaultAudioEndpoint(RenderDevice, ConsoleRole, out device) != 0
                        || device == null)
                    {
                        _unavailable = true;
                        return null;
                    }

                    var iid = typeof(IAudioEndpointVolume).GUID;
                    object instance;
                    if (device.Activate(ref iid, ClsCtxAll, IntPtr.Zero, out instance) != 0)
                    {
                        _unavailable = true;
                        return null;
                    }

                    _endpoint = (IAudioEndpointVolume)instance;
                    return _endpoint;
                }
                catch
                {
                    // Tidak ada perangkat audio, atau COM dibatasi kebijakan sistem.
                    _unavailable = true;
                    return null;
                }
            }
        }

        /// <summary>
        /// Lupakan antarmuka yang tersimpan.
        ///
        /// Perangkat audio bisa berganti di tengah jalan — headset dicabut,
        /// HDMI dilepas — dan antarmuka lama ikut mati bersamanya.
        /// </summary>
        private static void Forget()
        {
            lock (Lock)
            {
                if (_endpoint != null)
                {
                    try { Marshal.ReleaseComObject(_endpoint); } catch { /* sudah lepas */ }
                    _endpoint = null;
                }
                _unavailable = false;
            }
        }

        // ------------------------------------------------------------ publik

        /// <summary>Volume Windows saat ini, 0..1, atau null kalau tidak tersedia.</summary>
        public static float? Get()
        {
            var endpoint = Endpoint();
            if (endpoint == null) return null;

            try
            {
                float level;
                if (endpoint.GetMasterVolumeLevelScalar(out level) != 0) return null;
                return level;
            }
            catch
            {
                Forget();
                return null;
            }
        }

        public static bool Set(float level)
        {
            var endpoint = Endpoint();
            if (endpoint == null) return false;

            float clamped = Math.Min(1f, Math.Max(0f, level));
            try
            {
                if (endpoint.SetMasterVolumeLevelScalar(clamped, ref _noEventContext) != 0) return false;

                // Menaikkan volume saat sedang bisu tidak mengeluarkan suara
                // apa pun; hampir pasti bukan itu yang dimaksud penggunanya.
                if (clamped > 0) SetMute(false);
                return true;
            }
            catch
            {
                Forget();
                return false;
            }
        }

        public static bool? GetMute()
        {
            var endpoint = Endpoint();
            if (endpoint == null) return null;

            try
            {
                bool muted;
                if (endpoint.GetMute(out muted) != 0) return null;
                return muted;
            }
            catch
            {
                Forget();
                return null;
            }
        }

        public static bool SetMute(bool mute)
        {
            var endpoint = Endpoint();
            if (endpoint == null) return false;

            try
            {
                return endpoint.SetMute(mute, ref _noEventContext) == 0;
            }
            catch
            {
                Forget();
                return false;
            }
        }

        public static bool ToggleMute()
        {
            bool? muted = GetMute();
            return muted.HasValue && SetMute(!muted.Value);
        }
    }
}
