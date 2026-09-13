#!/usr/bin/env node
'use strict';
/**
 * Merakit windows/Taut.ico dari gambar PNG beberapa ukuran.
 *
 * Windows memilih sendiri ukuran yang paling pas dari dalam satu berkas .ico:
 * 16px untuk bilah judul, 32px untuk area notifikasi, 256px untuk tampilan
 * ikon besar di File Explorer. Menyediakan satu ukuran saja membuat Windows
 * menskalakannya, dan hasilnya buram justru di tempat yang paling sering
 * dilihat.
 *
 * Sejak Windows Vista, data PNG boleh ditaruh langsung di dalam .ico, jadi
 * tidak perlu mengubahnya ke BMP.
 *
 * Berkas .ico hasilnya ikut disimpan di repositori — perakitannya butuh
 * browser untuk merender SVG, dan itu tidak tersedia di CI.
 *
 * Jalankan: node windows/make-icon.js <folder-berisi-png>
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'Taut.ico');

/** Ukuran yang benar-benar dipakai Windows, dari kecil ke besar. */
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;

function build(images) {
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt16LE(0, 0); // cadangan, selalu nol
  header.writeUInt16LE(1, 2); // 1 = ikon (2 = kursor)
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(ENTRY_BYTES * images.length);
  let offset = HEADER_BYTES + directory.length;

  images.forEach((image, index) => {
    const at = index * ENTRY_BYTES;

    // 256 ditulis sebagai 0: medannya hanya satu byte.
    directory[at] = image.size >= 256 ? 0 : image.size;
    directory[at + 1] = image.size >= 256 ? 0 : image.size;
    directory[at + 2] = 0; // jumlah warna palet; 0 untuk truecolor
    directory[at + 3] = 0; // cadangan
    directory.writeUInt16LE(1, at + 4); // color planes
    directory.writeUInt16LE(32, at + 6); // bit per piksel
    directory.writeUInt32LE(image.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);

    offset += image.data.length;
  });

  return Buffer.concat([header, directory, ...images.map((i) => i.data)]);
}

function main() {
  const sourceDir = process.argv[2];
  if (!sourceDir) {
    console.error('\n  x Sebutkan folder berisi PNG: node windows/make-icon.js <folder>\n');
    process.exit(1);
  }

  const images = [];
  for (const size of SIZES) {
    const file = path.join(sourceDir, `${size}.png`);
    if (!fs.existsSync(file)) {
      console.error(`\n  x Tidak ada ${size}.png di ${sourceDir}\n`);
      process.exit(1);
    }
    images.push({ size, data: fs.readFileSync(file) });
  }

  fs.writeFileSync(OUT, build(images));

  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`\n  windows/Taut.ico siap — ${images.length} ukuran, ${kb} KB\n`);
}

main();
