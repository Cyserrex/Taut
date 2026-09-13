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
const zlib = require('zlib');
const path = require('path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const SRC = path.join(HERE, 'src');
const WEB = path.join(ROOT, 'web');
const OUT_DIR = path.join(ROOT, 'dist');
/**
 * Keluaran bisa diarahkan ke berkas lain lewat --out.
 *
 * Windows mengunci .exe yang sedang berjalan, jadi tanpa ini setiap build
 * memaksa menutup Taut yang sedang dipakai — termasuk saat hanya ingin
 * mencoba perubahan kecil.
 */
const outIndex = process.argv.indexOf('--out');
const OUT_EXE =
  outIndex >= 0 && process.argv[outIndex + 1]
    ? path.resolve(process.argv[outIndex + 1])
    : path.join(OUT_DIR, 'Taut.exe');
const ICON = path.join(HERE, 'Taut.ico');

/**
 * Ekstensi Firefox yang sudah ditandatangani Mozilla.
 *
 * Firefox menolak memasang ekstensi tak bertanda tangan, dan penandatanganan
 * hanya bisa dilakukan pemilik akun AMO. Berkasnya karena itu ikut disimpan di
 * repositori, bukan dibuat saat build — dan wajib diganti setiap kali ekstensi
 * berubah, kalau tidak Taut menawarkan versi yang sudah kedaluwarsa.
 */
const XPI = path.join(HERE, 'Taut.xpi');

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

/**
 * Ekstensi browser, ikut ditanam supaya Taut bisa memasangnya sendiri.
 *
 * Chrome tidak bisa memasang ekstensi lewat baris perintah, jadi yang
 * ditanam adalah berkas mentahnya — Taut mengeluarkannya ke sebuah folder,
 * lalu pengguna memuatnya lewat "Load unpacked".
 */
function collectExtensionResources() {
  const resources = [];

  // Selalu disusun ulang, bukan hanya kalau foldernya belum ada. Hasil lama
  // dari versi sebelumnya akan ikut tertanam tanpa ada yang menyadarinya —
  // dan itu sudah terjadi sekali: Taut 1.6.1 membawa ekstensi 1.6.0.
  const chromeDir = path.join(OUT_DIR, 'chrome');
  const built = spawnSync(process.execPath, [path.join(ROOT, 'build', 'extension.js')], {
    stdio: 'ignore',
  });
  if (built.status !== 0 || !fs.existsSync(chromeDir)) fail('Gagal menyusun ekstensi.');

  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}.`);
      else resources.push(`/resource:${full},Taut.chrome.${prefix}${entry.name}`);
    }
  };
  walk(chromeDir, '');

  if (fs.existsSync(XPI)) {
    const bundled = xpiVersion();
    const wanted = require(path.join(ROOT, 'package.json')).version;

    // Jebakan yang tidak bersuara: Taut memasang ekstensi versi lama tanpa
    // ada yang menyadarinya, sampai seseorang bingung kenapa perbaikan
    // terbaru tidak berlaku.
    if (bundled && bundled !== wanted) {
      console.log(`  ! windows/Taut.xpi berisi versi ${bundled}, sementara Taut ${wanted}`);
      console.log('    Tandatangani ulang dan ganti berkasnya sebelum merilis.');
    }

    resources.push(`/resource:${XPI},Taut.Taut.xpi`);
  } else {
    console.log('  (windows/Taut.xpi tidak ada — tombol pasang Firefox dilewati)');
  }

  return resources;
}

/**
 * Baca versi dari manifest di dalam .xpi.
 *
 * Dibaca lewat direktori pusat zip, bukan header di depan tiap berkas.
 * Berkas yang ditulis secara mengalir menyimpan ukurannya SESUDAH datanya,
 * dan meninggalkan nol di header depan — percobaan pertama memakai header itu
 * gagal tanpa suara, yang justru lebih buruk daripada tidak memeriksa sama
 * sekali: peringatannya tidak pernah muncul dan semua terlihat beres.
 */
function xpiVersion() {
  try {
    const raw = fs.readFileSync(XPI);
    const wanted = Buffer.from('manifest.json');

    // Direktori pusat ditemukan lewat penanda akhir di ekor berkas.
    let end = -1;
    for (let i = raw.length - 22; i >= 0; i--) {
      if (raw.readUInt32LE(i) === 0x06054b50) {
        end = i;
        break;
      }
    }
    if (end < 0) return null;

    let offset = raw.readUInt32LE(end + 16);

    while (offset + 46 <= raw.length && raw.readUInt32LE(offset) === 0x02014b50) {
      const method = raw.readUInt16LE(offset + 10);
      const compressed = raw.readUInt32LE(offset + 20);
      const nameLength = raw.readUInt16LE(offset + 28);
      const extraLength = raw.readUInt16LE(offset + 30);
      const commentLength = raw.readUInt16LE(offset + 32);
      const localOffset = raw.readUInt32LE(offset + 42);

      const name = raw.subarray(offset + 46, offset + 46 + nameLength);
      if (name.equals(wanted)) {
        // Panjang nama dan extra di header lokal bisa berbeda dari yang di
        // direktori pusat, jadi keduanya dibaca ulang dari sana.
        const localNameLength = raw.readUInt16LE(localOffset + 26);
        const localExtraLength = raw.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const data = raw.subarray(dataStart, dataStart + compressed);

        const json =
          method === 0 ? data.toString('utf8') : zlib.inflateRawSync(data).toString('utf8');
        return JSON.parse(json).version;
      }

      offset += 46 + nameLength + extraLength + commentLength;
    }
  } catch {
    // Bentuk berkasnya di luar dugaan; lebih baik diam daripada salah lapor.
  }
  return null;
}

// ------------------------------------------------------------------ build

/**
 * Tulis nomor versi sebagai berkas sumber.
 *
 * Menuliskannya dua kali — di package.json dan di dalam C# — berarti suatu
 * saat keduanya pasti berbeda, dan yang salah adalah yang tidak dilihat orang.
 */
function writeBuildInfo(outDir) {
  const pkg = require(path.join(ROOT, 'package.json'));
  const version = pkg.version;
  const file = path.join(outDir, 'BuildInfo.cs');

  // Versi .xpi yang ikut tertanam ditulis juga, supaya Taut bisa menyebutkannya
  // saat menawarkan pemasangan. Kalau tertinggal dari versi Taut, pengguna
  // melihatnya sendiri alih-alih menebak kenapa perbaikan terbaru tidak ada.
  const bundledXpi = fs.existsSync(XPI) ? xpiVersion() : null;

  // Metadata versi ikut ditulis di sini. Berkas .exe tanpa keterangan apa pun
  // tampil sebagai "Unknown" di dialog Windows dan di Task Manager — dan
  // program tak bernama yang membuka port jaringan memang pantas dicurigai.
  const lines = [
    'using System.Reflection;',
    '',
    // AssemblyTitle jadi FileDescription — teks yang tampil di Task Manager
    // dan di dialog SmartScreen. Di situlah orang memutuskan percaya atau
    // tidak, jadi sebutkan gunanya, bukan cuma namanya.
    '[assembly: AssemblyTitle("Taut - Remote YouTube Music lewat WiFi lokal")]',
    '[assembly: AssemblyProduct("Taut")]',
    `[assembly: AssemblyDescription("${pkg.description}")]`,
    '[assembly: AssemblyCompany("Cyserrex")]',
    '[assembly: AssemblyCopyright("MIT License")]',
    `[assembly: AssemblyVersion("${version}.0")]`,
    `[assembly: AssemblyFileVersion("${version}.0")]`,
    '',
    'namespace Taut',
    '{',
    '    /// <summary>Dihasilkan oleh windows/build.js. Jangan disunting.</summary>',
    '    internal static class BuildInfo',
    '    {',
    `        public const string Version = "${version}";`,
    `        public const string BundledExtensionVersion = ${
      bundledXpi ? `"${bundledXpi}"` : 'null'
    };`,
    '    }',
    '}',
    '',
  ];

  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

/**
 * Petunjuk saat berkas keluaran sedang dikunci prosesnya sendiri.
 *
 * Pesan compiler untuk keadaan ini hanya menyebut "cannot write to output
 * file", yang tidak memberi tahu apa yang harus ditutup. Yang dicari adalah
 * proses yang menjalankan BERKAS ITU, bukan sembarang Taut.exe — salinan uji
 * dan salinan yang dipakai sehari-hari sering berjalan bersamaan, dan menyuruh
 * menutup yang salah malah membuang pekerjaan orang.
 */
function lockHint() {
  const name = path.basename(OUT_EXE);
  const quoted = OUT_EXE.replace(/'/g, "''");

  const running = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "Get-Process -ErrorAction SilentlyContinue | " +
        `Where-Object { $_.Path -eq '${quoted}' } | ` +
        'Select-Object -ExpandProperty Id',
    ],
    { encoding: 'utf8' }
  );

  const pids = (running.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (pids.length === 0) return undefined;

  return (
    `    ${name} sedang berjalan dan mengunci berkasnya (pid ${pids.join(', ')}).\n` +
    '    Tutup lewat ikon di area notifikasi, atau:\n' +
    `      taskkill /PID ${pids[0]} /F`
  );
}

function build() {
  if (process.platform !== 'win32') {
    fail(
      'Taut.exe hanya bisa dibangun di Windows.',
      '    Compiler .NET Framework dan pustaka WinForms tidak tersedia di sistem lain.'
    );
  }

  if (!fs.existsSync(ICON)) {
    fail(
      'windows/Taut.ico tidak ada.',
      '    Rakit ulang dengan: node windows/make-icon.js <folder-png>'
    );
  }

  const csc = findCompiler();
  const sources = fs
    .readdirSync(SRC)
    .filter((name) => name.endsWith('.cs'))
    .map((name) => path.join(SRC, name));


  if (sources.length === 0) fail('Tidak ada berkas sumber di windows/src.');

  const resources = collectWebResources().concat(collectExtensionResources());
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
    // Ikon berkas, yang tampil di File Explorer dan bilah tugas.
    `-win32icon:${ICON}`,
    // Salinan yang sama ditanam sebagai sumber daya, dipakai ikon tray.
    `/resource:${ICON},Taut.Taut.ico`,
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

  if (result.status !== 0) {
    fail('Kompilasi gagal.', lockHint());
  }

  const size = Math.round(fs.statSync(OUT_EXE).size / 1024);
  const shown = path.relative(ROOT, OUT_EXE).replace(/\\/g, '/');
  console.log(`\n  Selesai: ${shown} (${size} KB)\n`);
}

build();
