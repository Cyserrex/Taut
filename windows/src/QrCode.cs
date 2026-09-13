using System;
using System.Collections.Generic;
using System.Text;

namespace Taut
{
    /// <summary>
    /// Generator QR Code, dipindahkan dari server/qr.js.
    ///
    /// Cakupannya sama: mode byte, error-correction level L, versi 1-10 —
    /// cukup untuk 271 karakter, jauh di atas panjang URL LAN terpanjang.
    ///
    /// Hasilnya wajib identik dengan versi JavaScript. Uji regresi
    /// membandingkan keduanya bit demi bit, karena kesalahan kecil di sini
    /// menghasilkan gambar yang terlihat benar tapi tidak bisa dipindai.
    /// </summary>
    internal static class QrCode
    {
        // Jumlah codeword data per versi untuk EC level L.
        private static readonly int[] DataCodewordsL = { 19, 34, 55, 80, 108, 136, 156, 194, 232, 274 };
        // Jumlah codeword error-correction per blok, per versi.
        private static readonly int[] EcPerBlockL = { 7, 10, 15, 20, 26, 18, 20, 24, 30, 18 };
        // Jumlah blok per versi.
        private static readonly int[] BlocksL = { 1, 1, 1, 1, 1, 2, 2, 2, 2, 4 };
        // Bit sisa setelah codeword terakhir, per versi.
        private static readonly int[] RemainderBits = { 0, 7, 7, 7, 7, 7, 0, 0, 0, 0 };

        // Titik tengah pola alignment per versi; versi 1 tidak punya.
        private static readonly int[][] AlignPos =
        {
            new int[0],
            new[] { 6, 18 },
            new[] { 6, 22 },
            new[] { 6, 26 },
            new[] { 6, 30 },
            new[] { 6, 34 },
            new[] { 6, 22, 38 },
            new[] { 6, 24, 42 },
            new[] { 6, 26, 46 },
            new[] { 6, 28, 50 },
        };

        // ------------------------------------------------------------ Galois field

        private static readonly byte[] GfExp = new byte[512];
        private static readonly byte[] GfLog = new byte[256];

        static QrCode()
        {
            int x = 1;
            for (int i = 0; i < 255; i++)
            {
                GfExp[i] = (byte)x;
                GfLog[x] = (byte)i;
                x <<= 1;
                if ((x & 0x100) != 0) x ^= 0x11d; // polinomial primitif QR
            }
            for (int i = 255; i < 512; i++) GfExp[i] = GfExp[i - 255];
        }

        private static int GfMul(int a, int b)
        {
            if (a == 0 || b == 0) return 0;
            return GfExp[GfLog[a] + GfLog[b]];
        }

        /// <summary>Polinomial generator Reed-Solomon berderajat tertentu.</summary>
        private static int[] RsGenerator(int degree)
        {
            var poly = new[] { 1 };
            for (int i = 0; i < degree; i++)
            {
                var next = new int[poly.Length + 1];
                for (int j = 0; j < poly.Length; j++)
                {
                    // Koefisien tersusun menurun, jadi suku x menempati indeks
                    // yang sama dan suku konstanta turun satu derajat.
                    next[j] ^= poly[j];
                    next[j + 1] ^= GfMul(poly[j], GfExp[i]);
                }
                poly = next;
            }
            return poly;
        }

        private static int[] RsEncode(IList<int> data, int ecLen)
        {
            var gen = RsGenerator(ecLen);
            var result = new int[ecLen];

            foreach (int b in data)
            {
                int factor = b ^ result[0];
                Array.Copy(result, 1, result, 0, ecLen - 1);
                result[ecLen - 1] = 0;
                for (int i = 0; i < ecLen; i++) result[i] ^= GfMul(gen[i + 1], factor);
            }
            return result;
        }

        // ------------------------------------------------ BCH (format & versi)

        /// <summary>Sisa pembagian polinomial pada GF(2) — dasar kode BCH.</summary>
        private static int Bch(int value, int poly)
        {
            int rest = value;
            int genDeg = HighestBit(poly);
            for (int i = HighestBit(rest); i >= genDeg; i--)
            {
                if ((rest & (1 << i)) != 0) rest ^= poly << (i - genDeg);
            }
            return rest;
        }

        private static int HighestBit(int value)
        {
            int bit = -1;
            while (value != 0)
            {
                bit++;
                value >>= 1;
            }
            return bit;
        }

        private static int FormatBits(int mask)
        {
            int data = (0x01 << 3) | mask; // 0b01 = EC level L
            int rest = Bch(data << 10, 0x537);
            return ((data << 10) | rest) ^ 0x5412;
        }

        private static int VersionBits(int version)
        {
            int rest = Bch(version << 12, 0x1f25);
            return (version << 12) | rest;
        }

        // ------------------------------------------------------ penyusunan data

        private static List<int> BuildCodewords(byte[] bytes, int version)
        {
            int capacity = DataCodewordsL[version - 1];
            int countBits = version >= 10 ? 16 : 8;

            var bits = new List<int>();
            Action<int, int> push = (value, length) =>
            {
                for (int i = length - 1; i >= 0; i--) bits.Add((value >> i) & 1);
            };

            push(0x4, 4); // indikator mode byte
            push(bytes.Length, countBits);
            foreach (byte b in bytes) push(b, 8);

            int totalBits = capacity * 8;
            push(0, Math.Min(4, totalBits - bits.Count)); // terminator
            while (bits.Count % 8 != 0) bits.Add(0);

            var codewords = new List<int>();
            for (int i = 0; i < bits.Count; i += 8)
            {
                int b = 0;
                for (int j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
                codewords.Add(b);
            }

            int[] pad = { 0xec, 0x11 };
            for (int i = 0; codewords.Count < capacity; i++) codewords.Add(pad[i % 2]);

            return codewords;
        }

        private static List<int> Interleave(List<int> codewords, int version)
        {
            int numBlocks = BlocksL[version - 1];
            int ecLen = EcPerBlockL[version - 1];
            int shortLen = codewords.Count / numBlocks;
            int numLong = codewords.Count % numBlocks;

            var dataBlocks = new List<List<int>>();
            var ecBlocks = new List<int[]>();
            int offset = 0;

            for (int i = 0; i < numBlocks; i++)
            {
                int len = shortLen + (i >= numBlocks - numLong ? 1 : 0);
                var block = codewords.GetRange(offset, len);
                offset += len;
                dataBlocks.Add(block);
                ecBlocks.Add(RsEncode(block, ecLen));
            }

            var result = new List<int>();
            int maxData = shortLen + (numLong > 0 ? 1 : 0);
            for (int i = 0; i < maxData; i++)
            {
                foreach (var block in dataBlocks)
                {
                    if (i < block.Count) result.Add(block[i]);
                }
            }
            for (int i = 0; i < ecLen; i++)
            {
                foreach (var block in ecBlocks) result.Add(block[i]);
            }
            return result;
        }

        // ------------------------------------------------------------- matriks

        private sealed class Matrix
        {
            public int[,] Modules;
            public bool[,] Reserved;
            public int Size;
        }

        private static Matrix CreateMatrix(int version)
        {
            int size = version * 4 + 17;
            var m = new Matrix
            {
                Modules = new int[size, size],
                Reserved = new bool[size, size],
                Size = size,
            };

            Action<int, int, int> set = (r, c, value) =>
            {
                m.Modules[r, c] = value;
                m.Reserved[r, c] = true;
            };

            // Finder pattern beserta separatornya.
            Action<int, int> placeFinder = (top, left) =>
            {
                for (int r = -1; r <= 7; r++)
                {
                    for (int c = -1; c <= 7; c++)
                    {
                        int rr = top + r, cc = left + c;
                        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
                        bool inRing = (r >= 0 && r <= 6 && (c == 0 || c == 6))
                                   || (c >= 0 && c <= 6 && (r == 0 || r == 6));
                        bool inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
                        set(rr, cc, inRing || inCore ? 1 : 0);
                    }
                }
            };
            placeFinder(0, 0);
            placeFinder(0, size - 7);
            placeFinder(size - 7, 0);

            // Timing pattern.
            for (int i = 8; i < size - 8; i++)
            {
                int bit = i % 2 == 0 ? 1 : 0;
                set(6, i, bit);
                set(i, 6, bit);
            }

            // Pola alignment, kecuali yang bertabrakan dengan finder.
            var centers = AlignPos[version - 1];
            foreach (int r in centers)
            {
                foreach (int c in centers)
                {
                    bool nearFinder = (r <= 8 && c <= 8)
                                   || (r <= 8 && c >= size - 9)
                                   || (r >= size - 9 && c <= 8);
                    if (nearFinder) continue;

                    for (int dr = -2; dr <= 2; dr++)
                    {
                        for (int dc = -2; dc <= 2; dc++)
                        {
                            int ring = Math.Max(Math.Abs(dr), Math.Abs(dc));
                            set(r + dr, c + dc, ring == 1 ? 0 : 1);
                        }
                    }
                }
            }

            set(size - 8, 8, 1); // modul gelap yang selalu ada

            // Tempat untuk informasi format.
            for (int i = 0; i < 9; i++)
            {
                if (!m.Reserved[8, i]) set(8, i, 0);
                if (!m.Reserved[i, 8]) set(i, 8, 0);
            }
            for (int i = 0; i < 8; i++)
            {
                if (!m.Reserved[8, size - 1 - i]) set(8, size - 1 - i, 0);
                if (!m.Reserved[size - 1 - i, 8]) set(size - 1 - i, 8, 0);
            }

            // Tempat untuk informasi versi.
            if (version >= 7)
            {
                for (int i = 0; i < 18; i++)
                {
                    int a = i / 3;
                    int b = (i % 3) + size - 11;
                    set(b, a, 0);
                    set(a, b, 0);
                }
            }

            return m;
        }

        private static void PlaceData(Matrix m, byte[] data)
        {
            int bitIndex = 0;
            Func<int> nextBit = () =>
            {
                if (bitIndex >= data.Length * 8) return 0;
                int bit = (data[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
                bitIndex++;
                return bit;
            };

            bool upward = true;
            for (int right = m.Size - 1; right >= 1; right -= 2)
            {
                if (right == 6) right = 5; // kolom timing vertikal dilewati
                for (int step = 0; step < m.Size; step++)
                {
                    int row = upward ? m.Size - 1 - step : step;
                    for (int k = 0; k < 2; k++)
                    {
                        int col = right - k;
                        if (m.Reserved[row, col]) continue;
                        m.Modules[row, col] = nextBit();
                    }
                }
                upward = !upward;
            }
        }

        private static int[,] ApplyMask(Matrix m, int mask)
        {
            var outModules = (int[,])m.Modules.Clone();
            for (int r = 0; r < m.Size; r++)
            {
                for (int c = 0; c < m.Size; c++)
                {
                    if (m.Reserved[r, c]) continue;

                    bool flip;
                    switch (mask)
                    {
                        case 0: flip = (r + c) % 2 == 0; break;
                        case 1: flip = r % 2 == 0; break;
                        case 2: flip = c % 3 == 0; break;
                        case 3: flip = (r + c) % 3 == 0; break;
                        case 4: flip = ((r / 2) + (c / 3)) % 2 == 0; break;
                        case 5: flip = ((r * c) % 2) + ((r * c) % 3) == 0; break;
                        case 6: flip = ((((r * c) % 2) + ((r * c) % 3)) % 2) == 0; break;
                        default: flip = ((((r + c) % 2) + ((r * c) % 3)) % 2) == 0; break;
                    }
                    if (flip) outModules[r, c] ^= 1;
                }
            }
            return outModules;
        }

        private static void DrawFormat(int[,] modules, int size, int mask)
        {
            int bits = FormatBits(mask);
            Func<int, int> bit = i => (bits >> i) & 1;

            // Salinan pertama: menaik di kolom 8, lalu membelok ke baris 8.
            for (int i = 0; i <= 5; i++) modules[i, 8] = bit(i);
            modules[7, 8] = bit(6);
            modules[8, 8] = bit(7);
            modules[8, 7] = bit(8);
            for (int i = 9; i <= 14; i++) modules[8, 14 - i] = bit(i);

            // Salinan kedua: baris 8 di sisi kanan, kolom 8 di sisi bawah.
            for (int i = 0; i <= 7; i++) modules[8, size - 1 - i] = bit(i);
            for (int i = 8; i <= 14; i++) modules[size - 15 + i, 8] = bit(i);
        }

        private static void DrawVersion(int[,] modules, int size, int version)
        {
            if (version < 7) return;
            int bits = VersionBits(version);
            for (int i = 0; i < 18; i++)
            {
                int b = (bits >> i) & 1;
                int a = i / 3;
                int c = (i % 3) + size - 11;
                modules[c, a] = b;
                modules[a, c] = b;
            }
        }

        /// <summary>Skor penalti sesuai empat aturan standar; makin kecil makin baik.</summary>
        private static int Penalty(int[,] modules, int size)
        {
            int score = 0;
            Func<int, int> runScore = run => run >= 5 ? 3 + (run - 5) : 0;

            // Aturan 1: deretan modul sewarna >= 5.
            for (int i = 0; i < size; i++)
            {
                int runH = 1, runV = 1;
                for (int j = 1; j < size; j++)
                {
                    if (modules[i, j] == modules[i, j - 1]) runH++;
                    else { score += runScore(runH); runH = 1; }

                    if (modules[j, i] == modules[j - 1, i]) runV++;
                    else { score += runScore(runV); runV = 1; }
                }
                score += runScore(runH) + runScore(runV);
            }

            // Aturan 2: blok 2x2 sewarna.
            for (int r = 0; r < size - 1; r++)
            {
                for (int c = 0; c < size - 1; c++)
                {
                    int v = modules[r, c];
                    if (v == modules[r, c + 1] && v == modules[r + 1, c] && v == modules[r + 1, c + 1])
                    {
                        score += 3;
                    }
                }
            }

            // Aturan 3: pola mirip finder dengan area kosong di sisinya.
            int[] pattern = { 1, 0, 1, 1, 1, 0, 1 };
            Func<Func<int, int>, int, bool> matches = (get, i) =>
            {
                for (int k = 0; k < 7; k++) if (get(i + k) != pattern[k]) return false;
                return true;
            };
            Func<Func<int, int>, int, int, bool> hasQuiet = (get, start, end) =>
            {
                for (int k = start; k < end; k++) if (get(k) != 0) return false;
                return true;
            };

            for (int i = 0; i < size; i++)
            {
                int row = i;
                Func<int, int>[] getters =
                {
                    j => (j >= 0 && j < size) ? modules[row, j] : 0,
                    j => (j >= 0 && j < size) ? modules[j, row] : 0,
                };

                foreach (var get in getters)
                {
                    for (int j = 0; j <= size - 7; j++)
                    {
                        if (!matches(get, j)) continue;
                        if (hasQuiet(get, j - 4, j) || hasQuiet(get, j + 7, j + 11)) score += 40;
                    }
                }
            }

            // Aturan 4: proporsi modul gelap menjauh dari 50%.
            int dark = 0;
            for (int r = 0; r < size; r++)
            {
                for (int c = 0; c < size; c++) dark += modules[r, c];
            }
            double percent = dark * 100.0 / (size * size);
            score += (int)(Math.Abs(percent - 50) / 5) * 10;

            return score;
        }

        // -------------------------------------------------------------- publik

        /// <summary>Encode teks jadi matriks QR berisi 0 dan 1.</summary>
        public static int[,] Encode(string text)
        {
            var bytes = Encoding.UTF8.GetBytes(text);

            int version = 0;
            for (int v = 1; v <= 10; v++)
            {
                int countBits = v >= 10 ? 16 : 8;
                int capacity = (DataCodewordsL[v - 1] * 8 - 4 - countBits) / 8;
                if (bytes.Length <= capacity) { version = v; break; }
            }
            if (version == 0) throw new ArgumentException("Teks terlalu panjang untuk QR versi 1-10");

            var codewords = Interleave(BuildCodewords(bytes, version), version);
            var padded = new byte[codewords.Count + (RemainderBits[version - 1] > 0 ? 1 : 0)];
            for (int i = 0; i < codewords.Count; i++) padded[i] = (byte)codewords[i];

            var matrix = CreateMatrix(version);
            PlaceData(matrix, padded);

            // Coba kedelapan mask, ambil yang penaltinya paling rendah.
            int[,] best = null;
            int bestScore = int.MaxValue;
            for (int mask = 0; mask < 8; mask++)
            {
                var candidate = ApplyMask(matrix, mask);
                DrawFormat(candidate, matrix.Size, mask);
                DrawVersion(candidate, matrix.Size, version);
                int score = Penalty(candidate, matrix.Size);
                if (score < bestScore)
                {
                    bestScore = score;
                    best = candidate;
                }
            }
            return best;
        }
    }
}
