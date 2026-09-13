'use strict';
/**
 * Uji regresi generator QR.
 *
 * Matriks acuan di bawah sudah diverifikasi dengan decoder sungguhan (jsQR):
 * setiap kasus berhasil dibaca kembali menjadi teks aslinya. Hash di sini
 * menjaga agar perubahan kode tidak diam-diam merusak hasil yang sudah benar.
 *
 * Jalankan: node test/qr.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
const qr = require('../server/qr');

const hash = (matrix) =>
  crypto
    .createHash('sha256')
    .update(matrix.map((row) => row.join('')).join(''))
    .digest('hex')
    .slice(0, 16);

const GOLDEN = [
  ['TAUT', 21, '0f7724382d17a3d0'],
  ['http://192.168.1.100:8787/#t=a1b2c3d4e5f60718', 29, '87b1f5006c38656b'],
  ['x'.repeat(120), 41, '6aa506305c3b4d9c'],
  ['http://10.0.0.5:8787/#t=deadbeefdeadbeef', 29, '905dda1c609f08aa'],
];

let passed = 0;

for (const [text, size, expected] of GOLDEN) {
  const matrix = qr.encode(text);
  assert.strictEqual(matrix.length, size, `ukuran matriks salah untuk ${JSON.stringify(text.slice(0, 20))}`);
  assert.strictEqual(hash(matrix), expected, `matriks berubah untuk ${JSON.stringify(text.slice(0, 20))}`);
  passed++;
}

// Struktur wajib: finder pattern di tiga sudut.
{
  const m = qr.encode('cek struktur');
  const n = m.length;
  for (const [top, left] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    assert.strictEqual(m[top][left], 1, 'sudut finder harus gelap');
    assert.strictEqual(m[top + 1][left + 1], 0, 'cincin finder harus terang');
    assert.strictEqual(m[top + 3][left + 3], 1, 'inti finder harus gelap');
  }
  passed++;
}

// Timing pattern selang-seling pada baris dan kolom 6.
{
  const m = qr.encode('cek timing');
  for (let i = 8; i < m.length - 8; i++) {
    assert.strictEqual(m[6][i], i % 2 === 0 ? 1 : 0, `timing horizontal salah di ${i}`);
    assert.strictEqual(m[i][6], i % 2 === 0 ? 1 : 0, `timing vertikal salah di ${i}`);
  }
  passed++;
}

// Naik versi mengikuti panjang teks, dan menolak teks yang kelewat panjang.
{
  assert.strictEqual(qr.encode('a'.repeat(17)).length, 21, 'versi 1 memuat 17 byte');
  assert.strictEqual(qr.encode('a'.repeat(18)).length, 25, 'versi 2 dipakai pada 18 byte');
  assert.strictEqual(qr.encode('a'.repeat(271)).length, 57, 'versi 10 memuat 271 byte');
  assert.throws(() => qr.encode('a'.repeat(272)), /terlalu panjang/, 'harus menolak 272 byte');
  passed++;
}

// Render terminal menghasilkan blok persegi dengan quiet zone.
{
  const lines = qr.toTerminal('TAUT', { quiet: 2 }).split('\n');
  const width = lines[0].length;
  assert.ok(lines.every((l) => l.length === width), 'semua baris harus sama lebar');
  assert.strictEqual(width, 21 + 4, 'lebar termasuk quiet zone');
  passed++;
}

console.log(`qr: ${passed} pemeriksaan lulus`);
