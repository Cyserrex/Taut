'use strict';
/**
 * Generator QR Code minimal tanpa dependensi.
 * Cakupan yang dibutuhkan Taut: mode byte, error-correction level L, versi 1-10
 * (cukup untuk 271 karakter — URL LAN paling panjang pun jauh di bawah itu).
 */

// Jumlah codeword data per versi untuk EC level L.
const DATA_CODEWORDS_L = [19, 34, 55, 80, 108, 136, 156, 194, 232, 274];
// Jumlah codeword error-correction per blok, per versi, untuk EC level L.
const EC_PER_BLOCK_L = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
// Jumlah blok per versi untuk EC level L.
const BLOCKS_L = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4];
// Titik tengah pola alignment per versi (versi 1 tidak punya).
const ALIGN_POS = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];
// Bit sisa yang ditambahkan setelah codeword terakhir, per versi.
const REMAINDER_BITS = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

// ---------------------------------------------------------------- Galois field

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // polinomial primitif QR
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** Polinomial generator Reed-Solomon berderajat `degree`. */
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      // Koefisien tersusun menurun, jadi suku x menempati indeks yang sama
      // dan suku konstanta (α^i) turun satu derajat.
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Hitung codeword error-correction untuk satu blok data. */
function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const result = new Array(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < ecLen; i++) {
      result[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return result;
}

// ---------------------------------------------------------------- BCH (format & versi)

/** Sisa pembagian polinomial pada GF(2) — dasar kode BCH. */
function bch(value, poly) {
  let rest = value;
  const genDeg = 31 - Math.clz32(poly);
  for (let i = 31 - Math.clz32(rest); i >= genDeg; i--) {
    if (rest & (1 << i)) rest ^= poly << (i - genDeg);
  }
  return rest;
}

/** 15 bit informasi format untuk EC level L + nomor mask. */
function formatBits(mask) {
  const data = (0b01 << 3) | mask; // 0b01 = EC level L
  const rest = bch(data << 10, 0x537);
  return ((data << 10) | rest) ^ 0x5412;
}

/** 18 bit informasi versi (hanya dipakai versi >= 7). */
function versionBits(version) {
  const rest = bch(version << 12, 0x1f25);
  return (version << 12) | rest;
}

// ---------------------------------------------------------------- Penyusunan data

function buildCodewords(text, version) {
  const bytes = Buffer.from(text, 'utf8');
  const capacity = DATA_CODEWORDS_L[version - 1];
  const countBits = version >= 10 ? 16 : 8;

  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4); // indikator mode byte
  push(bytes.length, countBits);
  for (const byte of bytes) push(byte, 8);

  // Terminator, maksimal 4 bit.
  const totalBits = capacity * 8;
  push(0, Math.min(4, totalBits - bits.length));
  // Padding sampai batas byte.
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  // Byte pad bergantian sampai kapasitas penuh.
  const PAD = [0xec, 0x11];
  for (let i = 0; codewords.length < capacity; i++) {
    codewords.push(PAD[i % 2]);
  }
  return codewords;
}

/** Pecah jadi blok, hitung EC, lalu interleave sesuai spesifikasi QR. */
function interleave(codewords, version) {
  const numBlocks = BLOCKS_L[version - 1];
  const ecLen = EC_PER_BLOCK_L[version - 1];
  const shortLen = Math.floor(codewords.length / numBlocks);
  const numLong = codewords.length % numBlocks;

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < numBlocks; i++) {
    const len = shortLen + (i >= numBlocks - numLong ? 1 : 0);
    const block = codewords.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecLen));
  }

  const result = [];
  const maxData = shortLen + (numLong > 0 ? 1 : 0);
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }
  for (let i = 0; i < ecLen; i++) {
    for (const block of ecBlocks) result.push(block[i]);
  }
  return result;
}

// ---------------------------------------------------------------- Matriks

function createMatrix(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(0));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFn = (r, c, value) => {
    modules[r][c] = value;
    reserved[r][c] = true;
  };

  // Tiga finder pattern + separator.
  const placeFinder = (top, left) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = top + r;
        const cc = left + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFn(rr, cc, inRing || inCore ? 1 : 0);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing pattern.
  for (let i = 8; i < size - 8; i++) {
    const bit = i % 2 === 0 ? 1 : 0;
    setFn(6, i, bit);
    setFn(i, 6, bit);
  }

  // Pola alignment, kecuali yang bertabrakan dengan finder.
  const centers = ALIGN_POS[version - 1];
  for (const r of centers) {
    for (const c of centers) {
      const nearFinder =
        (r <= 8 && c <= 8) ||
        (r <= 8 && c >= size - 9) ||
        (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          setFn(r + dr, c + dc, ring === 1 ? 0 : 1);
        }
      }
    }
  }

  // Modul gelap yang selalu ada.
  setFn(size - 8, 8, 1);

  // Sisakan tempat untuk informasi format.
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) setFn(8, i, 0);
    if (!reserved[i][8]) setFn(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) setFn(8, size - 1 - i, 0);
    if (!reserved[size - 1 - i][8]) setFn(size - 1 - i, 8, 0);
  }

  // Sisakan tempat untuk informasi versi.
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      setFn(b, a, 0);
      setFn(a, b, 0);
    }
  }

  return { modules, reserved, size };
}

/** Isi modul data mengikuti alur zigzag dari kanan-bawah. */
function placeData(matrix, data) {
  const { modules, reserved, size } = matrix;
  let bitIndex = 0;
  const nextBit = () => {
    if (bitIndex >= data.length * 8) return 0;
    const bit = (data[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return bit;
  };

  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // kolom timing vertikal dilewati
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (reserved[row][col]) continue;
        modules[row][col] = nextBit();
      }
    }
    upward = !upward;
  }
}

function applyMask(matrix, mask) {
  const { modules, reserved, size } = matrix;
  const out = modules.map((row) => row.slice());
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      let flip = false;
      switch (mask) {
        case 0: flip = (r + c) % 2 === 0; break;
        case 1: flip = r % 2 === 0; break;
        case 2: flip = c % 3 === 0; break;
        case 3: flip = (r + c) % 3 === 0; break;
        case 4: flip = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
        case 5: flip = ((r * c) % 2) + ((r * c) % 3) === 0; break;
        case 6: flip = ((((r * c) % 2) + ((r * c) % 3)) % 2) === 0; break;
        case 7: flip = ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0; break;
      }
      if (flip) out[r][c] ^= 1;
    }
  }
  return out;
}

function drawFormat(modules, size, mask) {
  const bits = formatBits(mask);
  const bit = (i) => (bits >>> i) & 1;

  // Salinan pertama: menaik di kolom 8, lalu membelok ke baris 8.
  for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i <= 14; i++) modules[8][14 - i] = bit(i);

  // Salinan kedua: baris 8 di sisi kanan, lalu kolom 8 di sisi bawah.
  for (let i = 0; i <= 7; i++) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i++) modules[size - 15 + i][8] = bit(i);
}

function drawVersion(modules, size, version) {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const bit = (bits >>> i) & 1;
    const a = Math.floor(i / 3);
    const b = (i % 3) + size - 11;
    modules[b][a] = bit;
    modules[a][b] = bit;
  }
}

/** Skor penalti sesuai empat aturan standar — makin kecil makin baik. */
function penalty(modules, size) {
  let score = 0;

  // Aturan 1: deretan modul sewarna >= 5.
  const runScore = (run) => (run >= 5 ? 3 + (run - 5) : 0);
  for (let i = 0; i < size; i++) {
    let runH = 1;
    let runV = 1;
    for (let j = 1; j < size; j++) {
      if (modules[i][j] === modules[i][j - 1]) {
        runH++;
      } else {
        score += runScore(runH);
        runH = 1;
      }
      if (modules[j][i] === modules[j - 1][i]) {
        runV++;
      } else {
        score += runScore(runV);
        runV = 1;
      }
    }
    score += runScore(runH) + runScore(runV);
  }

  // Aturan 2: blok 2x2 sewarna.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // Aturan 3: pola mirip finder (1:1:3:1:1 dengan area kosong).
  const PATTERN = [1, 0, 1, 1, 1, 0, 1];
  const matches = (get, i) => {
    for (let k = 0; k < 7; k++) if (get(i + k) !== PATTERN[k]) return false;
    return true;
  };
  const hasQuiet = (get, start, end) => {
    for (let k = start; k < end; k++) if (get(k) !== 0) return false;
    return true;
  };
  for (let i = 0; i < size; i++) {
    for (const get of [(j) => (j >= 0 && j < size ? modules[i][j] : 0),
                       (j) => (j >= 0 && j < size ? modules[j][i] : 0)]) {
      for (let j = 0; j <= size - 7; j++) {
        if (!matches(get, j)) continue;
        if (hasQuiet(get, j - 4, j) || hasQuiet(get, j + 7, j + 11)) score += 40;
      }
    }
  }

  // Aturan 4: proporsi modul gelap menjauh dari 50%.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += modules[r][c];
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

// ---------------------------------------------------------------- API publik

/**
 * Encode teks jadi matriks QR (array 2D berisi 0/1).
 * @param {string} text
 * @returns {number[][]}
 */
function encode(text) {
  const byteLen = Buffer.byteLength(text, 'utf8');
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const countBits = v >= 10 ? 16 : 8;
    const capacity = Math.floor((DATA_CODEWORDS_L[v - 1] * 8 - 4 - countBits) / 8);
    if (byteLen <= capacity) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error('Teks terlalu panjang untuk QR versi 1-10');

  const codewords = interleave(buildCodewords(text, version), version);
  const bytes = Buffer.from(codewords);
  const padded = Buffer.concat([bytes, Buffer.alloc(REMAINDER_BITS[version - 1] > 0 ? 1 : 0)]);

  const matrix = createMatrix(version);
  placeData(matrix, padded);

  // Coba kedelapan mask, ambil yang penaltinya paling rendah.
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMask(matrix, mask);
    drawFormat(candidate, matrix.size, mask);
    drawVersion(candidate, matrix.size, version);
    const score = penalty(candidate, matrix.size);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * Render QR sebagai teks untuk terminal, memakai half-block agar tetap persegi.
 * @param {string} text
 * @param {{ quiet?: number }} [opts]
 */
function toTerminal(text, opts = {}) {
  const quiet = opts.quiet ?? 2;
  const matrix = encode(text);
  const size = matrix.length;
  const total = size + quiet * 2;
  const at = (r, c) => {
    const rr = r - quiet;
    const cc = c - quiet;
    if (rr < 0 || rr >= size || cc < 0 || cc >= size) return 0;
    return matrix[rr][cc];
  };

  // Dua baris modul dipetakan ke satu baris teks: gelap = ruang kosong terbalik.
  const lines = [];
  for (let r = 0; r < total; r += 2) {
    let line = '';
    for (let c = 0; c < total; c++) {
      const top = at(r, c);
      const bottom = r + 1 < total ? at(r + 1, c) : 0;
      if (top && bottom) line += ' ';
      else if (top) line += '▄'; // blok bawah
      else if (bottom) line += '▀'; // blok atas
      else line += '█'; // blok penuh
    }
    lines.push(line);
  }
  return lines.join('\n');
}

module.exports = { encode, toTerminal };
