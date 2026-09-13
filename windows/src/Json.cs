using System;
using System.Globalization;
using System.Text;

namespace Taut
{
    /// <summary>
    /// JSON secukupnya.
    ///
    /// Taut hanya menukar objek datar berisi string, angka, dan boolean —
    /// keadaan pemutar, perintah, dan keterangan server. Menarik pustaka JSON
    /// penuh untuk itu berarti menambah berkas yang harus ikut disebar,
    /// padahal yang dibutuhkan cuma sekian baris ini.
    ///
    /// Yang TIDAK didukung: objek bersarang saat membaca, dan array. Kalau
    /// suatu saat protokolnya butuh itu, ganti dengan pustaka sungguhan
    /// alih-alih menambal berkas ini.
    /// </summary>
    internal static class Json
    {
        /// <summary>Ubah teks jadi isi string JSON yang aman (tanpa tanda kutip luar).</summary>
        public static string Escape(string value)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;

            var sb = new StringBuilder(value.Length + 8);
            foreach (char c in value)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20 || c == 0x7f)
                        {
                            sb.Append("\\u").Append(((int)c).ToString("x4"));
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            return sb.ToString();
        }

        public static string String(string value)
        {
            return value == null ? "null" : "\"" + Escape(value) + "\"";
        }

        public static string Number(double value)
        {
            return value.ToString("R", CultureInfo.InvariantCulture);
        }

        public static string Bool(bool value)
        {
            return value ? "true" : "false";
        }

        /// <summary>
        /// Ambil nilai string milik sebuah kunci di tingkat mana pun.
        ///
        /// Dicari lewat pemindaian, bukan penguraian penuh: yang dibutuhkan
        /// hanya satu-dua medan dari pesan yang bentuknya sudah diketahui.
        /// </summary>
        public static string GetString(string json, string key)
        {
            int index = IndexOfKey(json, key);
            if (index < 0) return null;

            index = SkipToValue(json, index);
            if (index < 0 || index >= json.Length || json[index] != '"') return null;

            index++;
            var sb = new StringBuilder();
            while (index < json.Length)
            {
                char c = json[index];
                if (c == '"') return sb.ToString();

                if (c == '\\' && index + 1 < json.Length)
                {
                    index++;
                    char escaped = json[index];
                    switch (escaped)
                    {
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'u':
                            if (index + 4 < json.Length)
                            {
                                string hex = json.Substring(index + 1, 4);
                                int code;
                                if (int.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code))
                                {
                                    sb.Append((char)code);
                                }
                                index += 4;
                            }
                            break;
                        default: sb.Append(escaped); break;
                    }
                }
                else
                {
                    sb.Append(c);
                }
                index++;
            }
            return null; // string tidak pernah ditutup
        }

        /// <summary>Ambil nilai angka milik sebuah kunci, atau null kalau tidak ada.</summary>
        public static double? GetNumber(string json, string key)
        {
            int index = IndexOfKey(json, key);
            if (index < 0) return null;

            index = SkipToValue(json, index);
            if (index < 0) return null;

            int start = index;
            while (index < json.Length && (char.IsDigit(json[index]) || "+-.eE".IndexOf(json[index]) >= 0))
            {
                index++;
            }
            if (index == start) return null;

            double value;
            return double.TryParse(json.Substring(start, index - start),
                NumberStyles.Float, CultureInfo.InvariantCulture, out value)
                ? (double?)value
                : null;
        }

        private static int IndexOfKey(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return -1;
            int index = json.IndexOf("\"" + key + "\"", StringComparison.Ordinal);
            return index < 0 ? -1 : index + key.Length + 2;
        }

        private static int SkipToValue(string json, int index)
        {
            while (index < json.Length && (json[index] == ' ' || json[index] == ':' || json[index] == '\t'))
            {
                index++;
            }
            return index < json.Length ? index : -1;
        }
    }
}
