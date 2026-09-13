#!/usr/bin/env node
'use strict';
/**
 * Menandatangani ekstensi Firefox lewat addons.mozilla.org.
 *
 * Firefox menolak memasang ekstensi tak bertanda tangan secara permanen, dan
 * tidak seperti Chrome, pemeriksaan itu tidak bisa dimatikan di versi biasa.
 * Satu-satunya jalan adalah menitipkan berkasnya ke Mozilla untuk ditandatangani.
 *
 * Kanal yang dipakai "unlisted": add-on-nya ditandatangani tapi TIDAK
 * dipublikasikan di addons.mozilla.org. Tidak ada tinjauan manusia, tidak ada
 * halaman publik — hanya berkas .xpi bertanda tangan yang bisa kamu pasang.
 *
 * Perlu kredensial AMO; lihat README bagian "Menandatangani untuk Firefox".
 *
 *   WEB_EXT_API_KEY      JWT issuer dari halaman API Key AMO
 *   WEB_EXT_API_SECRET   JWT secret dari halaman yang sama
 *
 * Jalankan: npm run sign:firefox
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'dist', 'firefox');
const OUT = path.join(ROOT, 'dist');

const version = require(path.join(ROOT, 'package.json')).version;

function fail(message, hint) {
  console.error(`\n  ✗ ${message}\n`);
  if (hint) console.error(`${hint}\n`);
  process.exit(1);
}

if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
  fail(
    'Kredensial AMO belum disetel.',
    [
      '    Ambil di https://addons.mozilla.org/developers/addon/api/key/',
      '    lalu jalankan:',
      '',
      '      WEB_EXT_API_KEY=user:xxxxx:xxx WEB_EXT_API_SECRET=xxxxx npm run sign:firefox',
      '',
      '    Di PowerShell:',
      '',
      '      $env:WEB_EXT_API_KEY="user:xxxxx:xxx"',
      '      $env:WEB_EXT_API_SECRET="xxxxx"',
      '      npm run sign:firefox',
    ].join('\n')
  );
}

if (!fs.existsSync(path.join(SOURCE, 'manifest.json'))) {
  fail('dist/firefox belum ada.', '    Jalankan dulu:  npm run build:ext');
}

console.log(`\n  Menandatangani Taut v${version} lewat Mozilla…`);
console.log('  Setiap versi hanya boleh diunggah sekali; naikkan versi di');
console.log('  package.json kalau nomor ini sudah pernah dipakai.\n');

// web-ext sengaja dipanggil lewat npx, bukan dijadikan dependensi: Taut harus
// tetap bisa dijalankan tanpa `npm install`, dan alat ini cuma dipakai saat rilis.
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    '--yes',
    'web-ext@8',
    'sign',
    `--source-dir=${SOURCE}`,
    `--artifacts-dir=${OUT}`,
    '--channel=unlisted',
  ],
  { stdio: 'inherit', cwd: ROOT }
);

if (result.status !== 0) {
  fail(
    'Penandatanganan gagal.',
    [
      '    Sebab yang paling sering:',
      '      · versi ini sudah pernah diunggah — naikkan versi di package.json',
      '      · kredensial salah atau sudah dicabut',
      '      · validasi Mozilla menolak; jalankan "npm run lint:ext" untuk melihatnya',
    ].join('\n')
  );
}

const signed = fs
  .readdirSync(OUT)
  .filter((name) => name.endsWith('.xpi'))
  .sort();

console.log('\n  ✓ Selesai. Berkas bertanda tangan:');
for (const name of signed) console.log(`      dist/${name}`);
console.log('\n  Pasang di Firefox: buka about:addons ▸ ikon gerigi ▸');
console.log('  "Install Add-on From File…" ▸ pilih berkas .xpi di atas.\n');
