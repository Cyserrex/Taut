'use strict';
/**
 * Uji regresi page.js — lapisan yang menyentuh YouTube Music.
 *
 * Yang dijaga di sini satu hal yang pernah lolos: satu ketukan "berikutnya"
 * harus melompat satu lagu, bukan dua. Memasang ulang ekstensi menyuntikkan
 * page.js yang baru ke tab yang sudah terbuka tanpa mematikan yang lama, dan
 * keduanya lalu menjalankan perintah yang sama.
 *
 * Halaman aslinya tidak ditiru seluruhnya — hanya secukupnya untuk membuat
 * page.js berjalan: sebuah <video>, sebuah pemutar, dan window yang bisa
 * menerima pesan.
 *
 * Jalankan: node test/page.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'extension', 'page.js'), 'utf8');

/**
 * Halaman tiruan.
 *
 * Dibuat sekali lalu dipakai bersama oleh setiap instansi page.js — persis
 * seperti tab sungguhan, tempat suntikan kedua mendarat di window yang sama
 * dengan suntikan pertama.
 */
function createPage() {
  const calls = {
    nextVideo: 0, previousVideo: 0,
    playVideo: 0, pauseVideo: 0,       // pemutar YouTube
    elemenPutar: 0, elemenJeda: 0,     // elemen <video>
    tombolPutar: 0,
  };

  /** Keadaan menurut YouTube Music sendiri: 1 berputar, 2 jeda. */
  let playerState = 1;

  const listeners = new Map();
  const addEventListener = (target) => (name, handler, options) => {
    if (options?.signal?.aborted) return;
    const key = `${target}:${name}`;
    if (!listeners.has(key)) listeners.set(key, []);
    const entry = { handler, aborted: false };
    listeners.get(key).push(entry);
    // AbortController tiruan: cukup menandai, karena yang diperiksa hanyalah
    // apakah pendengarnya masih ikut dipanggil.
    options?.signal?.addEventListener?.('abort', () => {
      entry.aborted = true;
    });
  };

  const fire = (target, name, event) => {
    for (const entry of listeners.get(`${target}:${name}`) || []) {
      if (!entry.aborted) entry.handler(event);
    }
  };

  // Hanya elemen ini yang benar-benar mengeluarkan suara. Memanggil
  // pauseVideo() pada pemutar sengaja TIDAK menyentuhnya — begitulah tab yang
  // sudah tidak sejalan berperilaku.
  const video = {
    paused: false,
    volume: 1,
    muted: false,
    currentTime: 10,
    duration: 200,
    playbackRate: 1,
    ended: false,
    pause() { calls.elemenJeda++; video.paused = true; },
    play() { calls.elemenPutar++; video.paused = false; },
    addEventListener: addEventListener('video'),
  };

  const player = {
    nextVideo: () => calls.nextVideo++,
    previousVideo: () => calls.previousVideo++,
    playVideo: () => calls.playVideo++,
    pauseVideo: () => calls.pauseVideo++,
    getPlayerState: () => playerState,
    getVolume: () => 100,
    isMuted: () => false,
    setVolume: () => {},
  };

  /** Tombol putar/jeda milik YouTube, di dalam player bar. */
  const playButton = { click: () => calls.tombolPutar++ };
  let videoPresent = true;

  const playerBar = {
    querySelector: (selector) =>
      selector === '#play-pause-button' || selector === '.play-pause-button' ? playButton : null,
  };

  const document = {
    querySelector: (selector) => {
      if (selector === 'video') return videoPresent ? video : null;
      if (selector === 'ytmusic-player-bar') return playerBar;
      return playerBar.querySelector(selector);
    },
    getElementById: (id) => (id === 'movie_player' ? player : null),
  };

  let lastState = null;

  const window = {
    addEventListener: addEventListener('window'),
    postMessage: (message) => {
      if (message?.type === 'state') lastState = message.state;
    },
    location: { origin: 'https://music.youtube.com' },
    navigator: { mediaSession: { metadata: null } },
  };
  window.window = window;

  const context = vm.createContext({
    window,
    document,
    navigator: window.navigator,
    location: window.location,
    console,
    setTimeout,
    clearTimeout,
    // Dilepas dari antrean Node, kalau tidak proses ujinya tidak pernah
    // selesai: page.js memasang poll yang memang dirancang berjalan terus.
    setInterval: (fn, ms) => setInterval(fn, ms).unref(),
    clearInterval,
    AbortController,
    JSON,
    Math,
    Number,
    String,
  });

  const page = {
    calls,
    /** Suntikkan satu instansi page.js, seperti sekali pasang ekstensi. */
    inject: () => vm.runInContext(SOURCE, context),
    /** Atur keadaan menurut pemutar YouTube, terlepas dari elemen <video>. */
    setPlayerState: (value) => {
      playerState = value;
    },
    /** Hilangkan elemen <video>, untuk menguji jalur cadangan. */
    hideVideo: () => {
      videoPresent = false;
    },
    /**
     * Paksa page.js melaporkan keadaan sekarang juga.
     *
     * page.js memasang pendengar di elemen <video> yang langsung melapor tiap
     * ada perubahan, jadi memicu salah satunya memberi jawaban seketika —
     * tanpa menunggu poll satu detik.
     */
    publishNow: () => {
      fire('video', 'volumechange');
      return lastState;
    },
    video,
    /** Kirim perintah persis seperti content.js mengirimkannya. */
    command: (action) => page.commandOn('taut/2', action),
    /** Kirim lewat saluran tertentu — untuk menguji saluran yang sudah lewat. */
    commandOn: (channel, action) =>
      fire('window', 'message', {
        source: window,
        data: { channel, type: 'command', action },
      }),
  };
  return page;
}

let passed = 0;
const check = (name, run) => {
  try {
    run();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (error) {
    console.error(`  x   ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
};

console.log('\nUji page.js\n');

check('satu instansi: satu perintah, satu lompatan', () => {
  const page = createPage();
  page.inject();
  page.command('next');
  assert.strictEqual(page.calls.nextVideo, 1);
});

check('dua instansi: tetap satu lompatan', () => {
  const page = createPage();
  page.inject();
  page.inject();
  page.command('next');
  assert.strictEqual(page.calls.nextVideo, 1);
});

check('tiga instansi: tetap satu lompatan', () => {
  const page = createPage();
  page.inject();
  page.inject();
  page.inject();
  page.command('next');
  page.command('previous');
  assert.strictEqual(page.calls.nextVideo, 1);
  assert.strictEqual(page.calls.previousVideo, 1);
});

check('saluran lama tidak lagi didengar', () => {
  const page = createPage();
  page.inject();

  // Instansi yang dipasang sebelum perbaikan ini menunggu di saluran "taut".
  // Itulah yang membuat mereka ikut menjalankan perintah meski sudah pensiun;
  // sekarang tidak ada lagi yang mengirim ke sana.
  page.commandOn('taut', 'next');
  assert.strictEqual(page.calls.nextVideo, 0);

  page.command('next');
  assert.strictEqual(page.calls.nextVideo, 1);
});

check('putar/jeda juga tidak berganda', () => {
  const page = createPage();
  page.inject();
  page.inject();

  // Lagu sedang berjalan, jadi satu ketukan berarti satu jeda. Kalau dua
  // instansi ikut menjawab, yang kedua justru memutarnya kembali — ketukannya
  // seolah tidak berpengaruh sama sekali.
  page.command('playPause');
  assert.strictEqual(page.calls.pauseVideo, 1);
  assert.strictEqual(page.calls.playVideo, 0);
});

check('jeda menghentikan elemennya, bukan hanya pemutar', () => {
  const page = createPage();
  page.inject();

  page.command('playPause');
  assert.strictEqual(page.calls.pauseVideo, 1, 'pemutar diberi tahu');
  assert.strictEqual(page.calls.elemenJeda, 1, 'elemen benar-benar dihentikan');
  assert.strictEqual(page.video.paused, true);
});

check('pemutar bilang jeda tapi lagunya masih terdengar: tetap dihentikan', () => {
  const page = createPage();
  page.inject();

  // Tab yang dilaporkan itu: tombol YouTube menunjukkan jeda, tapi suaranya
  // jalan terus dan seekbar-nya ikut berjalan.
  page.setPlayerState(2);
  page.video.paused = false;

  page.command('playPause');
  assert.strictEqual(page.calls.elemenJeda, 1, 'yang terdengar harus berhenti');
  assert.strictEqual(page.video.paused, true);
  assert.strictEqual(page.calls.elemenPutar, 0, 'jangan malah diputar lagi');
  assert.strictEqual(page.calls.playVideo, 0);
});

check('menyalakan lagi setelah dijeda', () => {
  const page = createPage();
  page.inject();

  page.command('playPause');
  assert.strictEqual(page.video.paused, true);

  page.command('playPause');
  assert.strictEqual(page.video.paused, false);
  assert.strictEqual(page.calls.elemenPutar, 1);
  assert.strictEqual(page.calls.playVideo, 1);
});

check('keadaan yang dilaporkan mengikuti yang terdengar', () => {
  const page = createPage();
  page.inject();

  // Pemutar bilang jeda, tapi suaranya jalan. Yang dilaporkan harus "berputar",
  // supaya remote tidak menunjukkan jeda sementara lagunya masih terdengar.
  page.setPlayerState(2);
  page.video.paused = false;
  assert.strictEqual(page.publishNow().playing, true);

  page.video.paused = true;
  assert.strictEqual(page.publishNow().playing, false);
});

check('tanpa elemen <video>, tombol asli YouTube jadi cadangan', () => {
  const page = createPage();
  page.hideVideo();
  page.inject();

  page.command('playPause');
  assert.strictEqual(page.calls.tombolPutar, 1);
});

console.log(`\n${passed} lolos\n`);
