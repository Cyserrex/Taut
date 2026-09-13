using System;
using Microsoft.Win32;

namespace Taut
{
    /// <summary>
    /// Menyalakan Taut saat Windows login.
    ///
    /// Memakai kunci Run milik pengguna, bukan Task Scheduler atau folder
    /// Startup: tidak perlu hak administrator, tidak ada berkas perantara yang
    /// bisa tertinggal, dan pengguna bisa melihat serta mematikannya sendiri
    /// lewat Task Manager ▸ Startup.
    /// </summary>
    internal static class Autostart
    {
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string ValueName = "Taut";

        public static bool IsEnabled
        {
            get
            {
                try
                {
                    using (var key = Registry.CurrentUser.OpenSubKey(RunKey))
                    {
                        if (key == null) return false;
                        return key.GetValue(ValueName) != null;
                    }
                }
                catch
                {
                    return false;
                }
            }
        }

        public static bool Enable(string exePath)
        {
            try
            {
                using (var key = Registry.CurrentUser.CreateSubKey(RunKey))
                {
                    if (key == null) return false;
                    // Dikutip supaya jalur yang mengandung spasi tidak terpecah.
                    key.SetValue(ValueName, "\"" + exePath + "\"");
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        public static bool Disable()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey, true))
                {
                    if (key == null) return true;
                    key.DeleteValue(ValueName, false);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }
    }
}
