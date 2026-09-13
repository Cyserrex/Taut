#!/usr/bin/env node
'use strict';
/**
 * Tampilkan QR code, alamat, dan PIN dari server yang sedang berjalan.
 *
 * Kalau Taut dipasang menyala otomatis, servernya berjalan tanpa jendela —
 * dan QR code serta PIN yang biasanya tampil di terminal jadi tidak terlihat.
 * Perintah ini menanyakannya kembali.
 *
 * Keterangan rahasia itu hanya dijawab untuk permintaan dari komputer yang
 * sama, jadi menjalankannya tidak membocorkan apa pun ke jaringan.
 *
 * Jalankan: npm run info
 */

const http = require('http');

const qr = require('./qr');

const argv = process.argv.slice(2);
const portIndex = argv.indexOf('--port');
const PORT = Number(
  portIndex >= 0 && argv[portIndex + 1] ? argv[portIndex + 1] : process.env.TAUT_PORT || 8787
);

function show(info) {
  const host = info.addresses?.[0];

  console.log('');
  console.log('  Taut sedang berjalan.');
  console.log('');
  console.log(`  Ekstensi browser : ${info.hostConnected ? 'tersambung' : 'belum tersambung'}`);
  console.log(`  Remote aktif     : ${info.remotes}`);
  console.log('');

  if (!host) {
    console.log('  Tidak ada alamat WiFi/LAN yang terdeteksi.');
    console.log(`  Akses lokal: http://localhost:${info.port}/#t=${info.token}`);
    console.log('');
    return;
  }

  const remoteUrl = `http://${host}:${info.port}/#t=${info.token}`;

  console.log('  Scan QR ini dengan kamera HP:');
  console.log('');
  console.log(
    qr
      .toTerminal(remoteUrl, { quiet: 2 })
      .split('\n')
      .map((line) => '  ' + line)
      .join('\n')
  );
  console.log('');
  console.log(`  atau buka manual:  ${remoteUrl}`);
  if (info.addresses.length > 1) {
    console.log(`  alamat lain:       ${info.addresses.slice(1).join(', ')}`);
  }
  console.log('');
  console.log(`  PIN untuk aplikasi Android:   ${info.pin}`);
  console.log('');
}

const request = http.get(
  { host: '127.0.0.1', port: PORT, path: '/api/info', timeout: 3000 },
  (res) => {
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => {
      try {
        show(JSON.parse(body));
      } catch {
        console.error('\n  x Jawaban server tidak bisa dibaca.\n');
        process.exitCode = 1;
      }
    });
  }
);

request.on('timeout', () => request.destroy());

request.on('error', () => {
  console.error(`\n  x Tidak ada server Taut di port ${PORT}.\n`);
  console.error('    Nyalakan dengan salah satu:');
  console.error('      npm start          jalankan di jendela ini');
  console.error('      npm run autostart  jalankan tersembunyi, dan ikut menyala saat login\n');
  process.exitCode = 1;
});
