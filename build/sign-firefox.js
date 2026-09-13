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
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'dist', 'firefox');
const OUT = path.join(ROOT, 'dist');

const version = require(path.join(ROOT, 'package.json')).version;

function fail(message, hint) {
  console.error(`\n  ✗ ${message}\n`);
  if (hint) console.error(`${hint}\n`);
  process.exit(1);
}

/**
 * Satu antarmuka readline untuk seluruh sesi tanya-jawab, dengan antrean
 * baris sendiri.
 *
 * Dua hal yang tidak bisa diserahkan ke rl.question begitu saja:
 *
 *   · Membuat antarmuka baru tiap pertanyaan terlihat rapi, tapi yang pertama
 *     sudah terlanjur menampung seluruh masukan yang tersedia — menutupnya
 *     ikut membuang baris untuk pertanyaan berikutnya.
 *   · Kalau pengguna menempel dua nilai sekaligus, baris kedua tiba sebelum
 *     pertanyaan keduanya sempat diajukan, dan hilang begitu saja.
 *
 * Menampung sendiri setiap baris yang masuk membuat keduanya tidak jadi soal.
 */
function createPrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  let muted = false;
  const write = rl._writeToOutput?.bind(rl);
  if (write) {
    rl._writeToOutput = (chunk) => {
      if (!muted) write(chunk);
    };
  }

  /** Baris yang sudah tiba tapi belum ada yang memintanya. */
  const queue = [];
  /** Penunggu baris berikutnya, kalau antrean sedang kosong. */
  let waiting = null;

  const deliver = (line) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
    } else {
      queue.push(line);
    }
  };

  rl.on('line', deliver);

  // Masukan habis sementara masih ada yang menunggu: tanpa ini prosesnya
  // berhenti diam-diam dengan kode 0, tanpa pesan apa pun.
  rl.on('close', () => deliver(''));

  const nextLine = () =>
    queue.length > 0
      ? Promise.resolve(queue.shift())
      : new Promise((resolve) => {
          waiting = resolve;
        });

  return {
    /**
     * @param {string} question
     * @param {{ hidden?: boolean }} [options] `hidden` menyembunyikan ketikan,
     *   supaya secret tidak tertinggal di layar atau di rekaman layar.
     */
    async ask(question, { hidden = false } = {}) {
      process.stdout.write(question);

      // Dibisukan untuk SEMUA pertanyaan, bukan hanya yang rahasia. Kalau
      // pengguna menempel kedua nilai sekaligus, baris kedua tiba selagi
      // pertanyaan pertama masih aktif — dan kalau echo masih hidup saat itu,
      // secret-nya ikut tercetak di layar. Jawaban yang boleh terlihat
      // dicetak ulang sendiri begitu barisnya utuh.
      muted = true;
      try {
        const line = String(await nextLine()).trim();
        process.stdout.write(hidden ? '\n' : `${line}\n`);
        return line;
      } finally {
        muted = false;
      }
    },

    close() {
      rl.close();
    },
  };
}

async function credentials() {
  const fromEnv = {
    key: process.env.WEB_EXT_API_KEY,
    secret: process.env.WEB_EXT_API_SECRET,
  };
  if (fromEnv.key && fromEnv.secret) return fromEnv;

  // Tanpa terminal sungguhan tidak ada yang bisa ditanyai — misalnya saat
  // berjalan di CI, yang memang membawa kredensialnya lewat environment.
  if (!process.stdin.isTTY) {
    fail(
      'Kredensial AMO belum disetel.',
      [
        '    Ambil di https://addons.mozilla.org/developers/addon/api/key/',
        '    lalu jalankan:',
        '',
        '      WEB_EXT_API_KEY=user:xxxxx:xxx WEB_EXT_API_SECRET=xxxxx npm run sign:firefox',
        '',
        '    Atau jalankan npm run sign:firefox langsung di terminal, dan',
        '    Taut akan menanyakannya satu per satu.',
      ].join('\n')
    );
  }

  console.log('\n  Kredensial AMO diambil di:');
  console.log('  https://addons.mozilla.org/developers/addon/api/key/\n');

  const prompt = createPrompt();
  let key;
  let secret;
  try {
    key = await prompt.ask('  JWT issuer  : ');
    secret = await prompt.ask('  JWT secret  : ', { hidden: true });
  } finally {
    prompt.close();
  }

  if (!key || !secret) {
    fail('Kredensial kosong.', '    Jalankan lagi dan tempel kedua nilainya.');
  }

  console.log('  (secret tidak ditampilkan dan tidak disimpan ke berkas mana pun)');
  return { key, secret };
}

function listXpi() {
  return fs
    .readdirSync(OUT)
    .filter((name) => name.endsWith('.xpi'))
    .sort();
}

async function main() {
  if (!fs.existsSync(path.join(SOURCE, 'manifest.json'))) {
    fail('dist/firefox belum ada.', '    Jalankan dulu:  npm run build:ext');
  }

  const { key, secret } = await credentials();
  const before = new Set(listXpi());

  console.log(`\n  Menandatangani Taut v${version} lewat Mozilla...`);
  console.log('  Setiap versi hanya boleh diunggah sekali; naikkan versi di');
  console.log('  package.json kalau nomor ini sudah pernah dipakai.\n');

  // web-ext sengaja dipanggil lewat npx, bukan dijadikan dependensi: Taut harus
  // tetap bisa dijalankan tanpa `npm install`, dan alat ini cuma dipakai saat rilis.
  //
  // Di Windows, npx sebenarnya npx.cmd, dan sejak Node 20.12 berkas .cmd tidak
  // boleh dijalankan langsung tanpa shell (menolak dengan EINVAL). Maka di sana
  // perintahnya dilewatkan shell, dan jalur berkas dikutip supaya nama folder
  // yang mengandung spasi tidak terpecah.
  const useShell = process.platform === 'win32';
  const quote = (value) => (useShell ? `"${value}"` : value);

  const result = spawnSync(
    'npx',
    [
      '--yes',
      'web-ext@8',
      'sign',
      `--source-dir=${quote(SOURCE)}`,
      `--artifacts-dir=${quote(OUT)}`,
      '--channel=unlisted',
    ],
    {
      stdio: 'inherit',
      cwd: ROOT,
      shell: useShell,
      // Kredensial dilewatkan lewat environment proses anak, bukan lewat
      // argumen perintah: argumen terlihat di daftar proses sistem dan bisa
      // tersimpan di riwayat shell.
      env: { ...process.env, WEB_EXT_API_KEY: key, WEB_EXT_API_SECRET: secret },
    }
  );

  if (result.status !== 0) {
    fail(
      'Penandatanganan gagal.',
      [
        '    Sebab yang paling sering:',
        '      - versi ini sudah pernah diunggah; naikkan versi di package.json',
        '      - kredensial salah atau sudah dicabut',
        '      - validasi Mozilla menolak; jalankan "npm run lint:ext" untuk melihatnya',
      ].join('\n')
    );
  }

  // Tunjukkan hanya berkas yang baru muncul, supaya sisa penandatanganan
  // sebelumnya tidak ikut disebut sebagai hasil kali ini.
  const fresh = listXpi().filter((name) => !before.has(name));
  const signed = fresh.length > 0 ? fresh : listXpi();

  console.log('\n  Selesai. Berkas bertanda tangan:');
  for (const name of signed) console.log(`      dist/${name}`);
  console.log('\n  Pasang di Firefox: buka about:addons > ikon gerigi >');
  console.log('  "Install Add-on From File..." > pilih berkas .xpi di atas.\n');
}

main().catch((error) => fail(error.message || String(error)));
