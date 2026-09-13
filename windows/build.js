#!/usr/bin/env node
'use strict';
/**
 * Membangun Taut.exe.
 *
 * Memakai compiler Roslyn langsung, bukan MSBuild dan berkas .csproj.
 * Alasannya: satu jalur build yang sama persis di mesin siapa pun dan di CI,
 * tanpa bergantung pada Visual Studio yang terpasang atau tidak.
 *
 * Halaman remote ikut ditanam sebagai sumber daya, sehingga hasilnya
 * benar-benar satu berkas .exe tanpa folder pendamping.
 *
 * Jalankan: npm run build:exe
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const SRC = path.join(HERE, 'src');
const WEB = path.join(ROOT, 'web');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_EXE = path.join(OUT_DIR, 'Taut.exe');

/** Versi Roslyn dipatok agar hasil build tidak berubah diam-diam. */
const ROSLYN_VERSION = '4.8.0';
const ROSLYN_DIR = path.join(os.tmpdir(), `taut-roslyn-${ROSLYN_VERSION}`);

function fail(message, hint) {
  console.error(`\n  x ${message}\n`);
  if (hint) console.error(`${hint}\n`);
  process.exit(1);
}

// ------------------------------------------------------------------ compiler

/** Cari csc yang mendukung C# modern; unduh kalau belum ada. */
function findCompiler() {
  const candidates = [
    path.join(ROSLYN_DIR, 'tasks', 'net472', 'csc.exe'),
    // Runner GitHub Actions dan mesin dengan Visual Studio sudah membawanya.
    ...['2022', '2019'].flatMap((year) =>
      ['Enterprise', 'Professional', 'Community', 'BuildTools'].map((edition) =>
        path.join(
          process.env['ProgramFiles'] || 'C:\\Program Files',
          'Microsoft Visual Studio',
          year,
          edition,
          'MSBuild',
          'Current',
          'Bin',
          'Roslyn',
          'csc.exe'
        )
      )
    ),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return downloadRoslyn();
}

function downloadRoslyn() {
  console.log('  Mengunduh compiler Roslyn (sekali saja)...');
  fs.mkdirSync(ROSLYN_DIR, { recursive: true });

  const nupkg = path.join(ROSLYN_DIR, 'roslyn.zip');
  const url = `https://www.nuget.org/api/v2/package/Microsoft.Net.Compilers.Toolset/${ROSLYN_VERSION}`;

  // curl dan tar sudah ikut Windows 10 sejak lama, jadi tidak ada yang
  // perlu dipasang lebih dulu.
  const fetched = spawnSync('curl', ['-sL', '-o', nupkg, url], { stdio: 'inherit' });
  if (fetched.status !== 0) {
    fail('Tidak bisa mengunduh compiler.', '    Periksa koneksi internet, lalu coba lagi.');
  }

  const extracted = spawnSync('tar', ['-xf', nupkg, '-C', ROSLYN_DIR], { stdio: 'inherit' });
  if (extracted.status !== 0) fail('Tidak bisa membuka paket compiler.');

  const csc = path.join(ROSLYN_DIR, 'tasks', 'net472', 'csc.exe');
  if (!fs.existsSync(csc)) fail('Compiler tidak ditemukan di dalam paket.');

  return csc;
}

// -------------------------------------------------------------- sumber daya

/**
 * Kumpulkan berkas halaman remote sebagai sumber daya tertanam.
 *
 * Namanya mengikuti kebiasaan .NET: pemisah folder jadi titik, dengan awalan
 * "Taut.web." — sama dengan yang dicari WebAssets saat melayani permintaan.
 */
function collectWebResources() {
  const resources = [];

  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, `${prefix}${entry.name}.`);
      } else {
        resources.push(`/resource:${full},Taut.web.${prefix}${entry.name}`);
      }
    }
  };

  walk(WEB, '');
  return resources;
}

// ------------------------------------------------------------------ build

/**
 * Tulis nomor versi sebagai berkas sumber.
 *
 * Menuliskannya dua kali — di package.json dan di dalam C# — berarti suatu
 * saat keduanya pasti berbeda, dan yang salah adalah yang tidak dilihat orang.
 */
function writeBuildInfo(outDir) {
  const version = require(path.join(ROOT, 'package.json')).version;
  const file = path.join(outDir, 'BuildInfo.cs');

  const lines = [
    'namespace Taut',
    '{',
    '    /// <summary>Dihasilkan oleh windows/build.js. Jangan disunting.</summary>',
    '    internal static class BuildInfo',
    '    {',
    `        public const string Version = "${version}";`,
    '    }',
    '}',
    '',
  ];

  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

function build() {
  if (process.platform !== 'win32') {
    fail(
      'Taut.exe hanya bisa dibangun di Windows.',
      '    Compiler .NET Framework dan pustaka WinForms tidak tersedia di sistem lain.'
    );
  }

  const csc = findCompiler();
  const sources = fs
    .readdirSync(SRC)
    .filter((name) => name.endsWith('.cs'))
    .map((name) => path.join(SRC, name));


  if (sources.length === 0) fail('Tidak ada berkas sumber di windows/src.');

  const resources = collectWebResources();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const generatedDir = path.join(OUT_DIR, 'generated');
  fs.mkdirSync(generatedDir, { recursive: true });
  sources.push(writeBuildInfo(generatedDir));

  const args = [
    '-nologo',
    '-target:winexe', // tanpa jendela konsol yang menempel
    '-platform:anycpu',
    '-optimize+',
    '-langversion:latest',
    '-warnaserror-',
    `-out:${OUT_EXE}`,
    '-reference:System.dll',
    '-reference:System.Core.dll',
    '-reference:System.Drawing.dll',
    '-reference:System.Windows.Forms.dll',
    ...resources,
    ...sources,
  ];

  console.log(`  Menyusun ${sources.length} berkas sumber dan ${resources.length} sumber daya...`);
  const result = spawnSync(csc, args, { stdio: 'inherit' });

  if (result.status !== 0) fail('Kompilasi gagal.');

  const size = Math.round(fs.statSync(OUT_EXE).size / 1024);
  console.log(`\n  Selesai: dist/Taut.exe (${size} KB)\n`);
}

build();
