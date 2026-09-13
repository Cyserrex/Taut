#!/usr/bin/env node
'use strict';
/**
 * Bungkus ekstensi Firefox jadi berkas zip siap unggah ke addons.mozilla.org.
 *
 * Jalur unggah manual tidak memerlukan API key sama sekali — berguna saat
 * pembuatan kredensial sedang dibatasi, atau saat hanya ingin menandatangani
 * sekali tanpa menyiapkan apa pun.
 *
 * Setelah berkasnya disetujui, AMO menyediakan .xpi bertanda tangan untuk
 * diunduh. Taruh berkas itu sebagai windows/Taut.xpi supaya ikut tertanam di
 * dalam Taut.exe.
 *
 * Jalankan: npm run pack:firefox
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'dist', 'firefox');
const OUT_DIR = path.join(ROOT, 'dist');

// ------------------------------------------------------------------- zip

/**
 * Tabel CRC-32, dihitung sekali.
 *
 * Zip menyimpan CRC setiap berkas, dan pengurai yang ketat — termasuk milik
 * Mozilla — menolak berkas yang nilainya tidak cocok.
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Susun berkas zip.
 *
 * Ditulis sendiri, seperti bagian Taut yang lain, supaya tidak ada dependensi
 * npm yang harus dipasang lebih dulu. Cakupannya sempit dan cukup: berkas
 * biasa, tanpa folder kosong, tanpa enkripsi, tanpa zip64.
 */
function buildZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const deflated = zlib.deflateRawSync(entry.data, { level: 9 });

    // Simpan apa adanya kalau memampatkan justru membesarkan.
    const compress = deflated.length < entry.data.length;
    const body = compress ? deflated : entry.data;
    const method = compress ? 8 : 0;
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versi minimum
    local.writeUInt16LE(0, 6); // tanpa penanda khusus
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // waktu; sengaja tetap agar hasilnya berulang
    local.writeUInt16LE(0x21, 12); // tanggal; 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    locals.push(local, nameBytes, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0x21, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);

    central.push(header, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}

// ----------------------------------------------------------------- jalankan

function collect(dir, prefix = '') {
  const entries = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) entries.push(...collect(full, `${prefix}${item.name}/`));
    else entries.push({ name: `${prefix}${item.name}`, data: fs.readFileSync(full) });
  }
  return entries;
}

function main() {
  // Selalu disusun ulang; hasil lama dari versi sebelumnya pernah ikut
  // terbungkus tanpa ada yang menyadarinya.
  const built = spawnSync(process.execPath, [path.join(ROOT, 'build', 'extension.js')], {
    stdio: 'ignore',
  });
  if (built.status !== 0 || !fs.existsSync(SOURCE)) {
    console.error('\n  x Gagal menyusun ekstensi.\n');
    process.exit(1);
  }

  const version = require(path.join(ROOT, 'package.json')).version;
  const entries = collect(SOURCE);

  // manifest.json wajib berada di akar zip, bukan di dalam subfolder —
  // AMO menolak paket yang membungkus isinya dalam satu folder.
  if (!entries.some((entry) => entry.name === 'manifest.json')) {
    console.error('\n  x manifest.json tidak berada di akar paket.\n');
    process.exit(1);
  }

  const target = path.join(OUT_DIR, `taut-firefox-${version}.zip`);
  fs.writeFileSync(target, buildZip(entries));

  const kb = Math.round(fs.statSync(target).size / 1024);
  console.log(`\n  Siap diunggah: dist/taut-firefox-${version}.zip (${kb} KB, ${entries.length} berkas)\n`);
  console.log('  1. Buka https://addons.mozilla.org/developers/addons');
  console.log('  2. Pilih Taut, lalu "Upload a New Version"');
  console.log('  3. Unggah berkas di atas dan pilih distribusi "unlisted"');
  console.log('  4. Setelah disetujui, unduh .xpi bertanda tangannya');
  console.log('  5. Simpan sebagai windows/Taut.xpi agar ikut tertanam di Taut.exe\n');
}

main();
