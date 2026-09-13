#!/usr/bin/env node
'use strict';
/**
 * Menyalakan server Taut otomatis saat Windows login — tanpa jendela terminal.
 *
 * Ekstensi browser tidak bisa membuka port dan menunggu koneksi masuk; itu
 * batas platform, bukan pilihan rancangan. Jadi harus ada sesuatu di PC yang
 * mendengarkan. Yang bisa dihilangkan adalah keharusan mengetik `npm start`
 * setiap kali.
 *
 * Cara kerjanya dua lapis, karena Windows tidak punya cara langsung
 * menjalankan program konsol tanpa memunculkan jendelanya:
 *
 *   Taut.cmd  menjalankan server dan mencatat keluarannya ke berkas log
 *   Taut.vbs  menjalankan Taut.cmd dengan jendela tersembunyi
 *
 * Taut.vbs diletakkan di folder Startup, jadi ikut jalan saat login.
 *
 *   npm run autostart         pasang dan langsung nyalakan
 *   npm run autostart:off     copot
 *   npm run autostart:status  lihat keadaannya
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server', 'index.js');

const DATA_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), 'Taut');
const LOG_FILE = path.join(DATA_DIR, 'server.log');
const CMD_FILE = path.join(DATA_DIR, 'Taut.cmd');

const STARTUP_DIR = path.join(
  process.env.APPDATA || os.homedir(),
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup'
);
const VBS_FILE = path.join(STARTUP_DIR, 'Taut.vbs');

function bail(message, hint) {
  console.error(`\n  x ${message}\n`);
  if (hint) console.error(`${hint}\n`);
  process.exit(1);
}

if (process.platform !== 'win32') {
  bail(
    'Pemasang ini khusus Windows.',
    [
      '    Di Linux, buat unit systemd --user yang menjalankan:',
      `      ${process.execPath} ${SERVER}`,
      '',
      '    Di macOS, buat berkas LaunchAgent dengan perintah yang sama.',
    ].join('\n')
  );
}

/** Kutip ganda di dalam string VBScript ditulis dengan menggandakannya. */
const vbsQuote = (value) => `"${value.replace(/"/g, '""')}"`;

function install() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(STARTUP_DIR, { recursive: true });

  // Jalur node ditulis apa adanya, bukan mengandalkan PATH: saat login, PATH
  // bisa berbeda dari yang ada di terminalmu — terutama kalau node dipasang
  // lewat nvm.
  const cmd = [
    '@echo off',
    'rem Dibuat otomatis oleh Taut (npm run autostart).',
    'rem Jangan disunting; jalankan npm run autostart:off untuk mencopotnya.',
    `cd /d "${ROOT}"`,
    `echo. >> "${LOG_FILE}"`,
    `echo ==== Taut dinyalakan %DATE% %TIME% ==== >> "${LOG_FILE}"`,
    `"${process.execPath}" "${SERVER}" >> "${LOG_FILE}" 2>&1`,
    '',
  ].join('\r\n');

  const vbs = [
    "' Dibuat otomatis oleh Taut (npm run autostart).",
    "' Menjalankan Taut.cmd tanpa jendela; hapus lewat npm run autostart:off.",
    'Dim shell',
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run ${vbsQuote(vbsQuote(CMD_FILE))}, 0, False`,
    '',
  ].join('\r\n');

  fs.writeFileSync(CMD_FILE, cmd, 'utf8');
  fs.writeFileSync(VBS_FILE, vbs, 'utf8');

  console.log('\n  Taut akan menyala sendiri saat Windows login.\n');
  console.log(`      peluncur : ${VBS_FILE}`);
  console.log(`      log      : ${LOG_FILE}\n`);
}

function uninstall() {
  let removed = 0;
  for (const file of [VBS_FILE, CMD_FILE]) {
    try {
      fs.unlinkSync(file);
      removed++;
    } catch {
      // Sudah tidak ada; tidak apa-apa.
    }
  }

  console.log(
    removed > 0
      ? '\n  Taut tidak lagi menyala otomatis.\n  Server yang sedang berjalan tidak ikut dimatikan.\n'
      : '\n  Taut memang belum dipasang untuk menyala otomatis.\n'
  );
}

/** Nyalakan sekarang lewat peluncur yang sama, supaya tidak perlu login ulang. */
function launch() {
  const result = spawnSync('wscript.exe', [VBS_FILE], { windowsHide: true });
  if (result.error) {
    console.log('  (tidak bisa menyalakan sekarang; akan jalan saat login berikutnya)\n');
    return;
  }
  console.log('  Server juga sudah dinyalakan sekarang.\n');
}

function status() {
  const installed = fs.existsSync(VBS_FILE);
  console.log(
    installed
      ? `\n  Menyala otomatis : ya\n  Peluncur         : ${VBS_FILE}`
      : '\n  Menyala otomatis : tidak'
  );

  // Log terakhir sering jadi satu-satunya petunjuk kalau server gagal menyala
  // di latar belakang — tidak ada jendela yang memperlihatkannya.
  if (fs.existsSync(LOG_FILE)) {
    const size = fs.statSync(LOG_FILE).size;
    console.log(`  Log              : ${LOG_FILE} (${Math.round(size / 1024)} KB)`);
  }
  console.log('');
}

const action = process.argv[2] || 'install';

if (action === 'install') {
  install();
  launch();
} else if (action === 'uninstall') {
  uninstall();
} else if (action === 'status') {
  status();
} else {
  bail(`Perintah tidak dikenal: ${action}`, '    Pakai: install | uninstall | status');
}
