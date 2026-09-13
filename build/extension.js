#!/usr/bin/env node
'use strict';
/**
 * Menyiapkan ekstensi untuk Chrome dan Firefox dari satu sumber.
 *
 * Isi kodenya sama persis; yang berbeda hanya manifest:
 *
 *   Chrome  — latar belakang berupa service worker (Manifest V3 baku).
 *   Firefox — belum mendukung service_worker di MV3, jadi memakai
 *             `background.scripts`, dan perlu id ekstensi untuk pemasangan.
 *
 * Hasilnya folder siap pakai di dist/, yang bisa langsung dimuat lewat
 * "Load unpacked" (Chrome) atau "Load Temporary Add-on" (Firefox).
 *
 * Jalankan: npm run build:ext
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'dist');

/** Id ini menjadi identitas ekstensi di Firefox dan harus tetap sama. */
const FIREFOX_ID = 'taut@cyserrex.github.io';

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

function writeManifest(dir, manifest) {
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

function build() {
  const base = JSON.parse(fs.readFileSync(path.join(SOURCE, 'manifest.json'), 'utf8'));
  const version = require(path.join(ROOT, 'package.json')).version;
  base.version = version;

  fs.rmSync(path.join(OUT, 'chrome'), { recursive: true, force: true });
  fs.rmSync(path.join(OUT, 'firefox'), { recursive: true, force: true });

  // --- Chrome: manifest dipakai apa adanya.
  const chromeDir = path.join(OUT, 'chrome');
  copyDir(SOURCE, chromeDir);
  writeManifest(chromeDir, base);

  // --- Firefox: tukar latar belakang, tambahkan identitas.
  const firefoxDir = path.join(OUT, 'firefox');
  copyDir(SOURCE, firefoxDir);

  const firefox = JSON.parse(JSON.stringify(base));
  delete firefox.background.service_worker;
  firefox.background = { scripts: ['background.js'] };
  firefox.browser_specific_settings = {
    gecko: {
      id: FIREFOX_ID,
      strict_min_version: '115.0',
    },
  };
  writeManifest(firefoxDir, firefox);

  console.log(`Taut v${version} — ekstensi siap:`);
  console.log(`  dist/chrome    → chrome://extensions  ▸ Load unpacked`);
  console.log(`  dist/firefox   → about:debugging      ▸ Load Temporary Add-on`);
}

build();
