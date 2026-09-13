'use strict';
/**
 * Taut — lapisan yang menyentuh YouTube Music.
 *
 * Berjalan di "MAIN world", jadi bisa memanggil API pemutar milik halaman
 * secara langsung. Berbicara dengan sisa ekstensi lewat window.postMessage.
 *
 * Prinsip yang dipakai: ambil dari yang paling stabil lebih dulu.
 *   1. elemen <video>          — play/jeda, posisi, volume. Tidak pernah berubah.
 *   2. navigator.mediaSession  — judul, artis, sampul. Standar web.
 *   3. tombol di DOM YouTube   — suka, acak, ulangi. Paling rapuh, jadi paling akhir.
 *
 * Kalau lapisan (3) rusak karena YouTube ganti tampilan, sisanya tetap jalan.
 */

(() => {
  /**
   * Nama saluran memuat nomor, dan nomornya naik saat berkas ini berubah cara
   * bicaranya. Sebabnya ada di bawah: instansi lama bisa ikut mendengar.
   */
  const CHANNEL = 'taut/2';
  const POLL_INTERVAL = 1000;

  /**
   * Hanya boleh ada satu instansi di satu halaman.
   *
   * Memasang ulang atau memperbarui ekstensi tidak memuat ulang tab yang
   * sedang terbuka — Firefox menyuntikkan content script yang baru ke tab
   * lama, sementara yang lama tetap hidup. Keduanya lalu mendengar perintah
   * yang sama, dan satu ketukan "berikutnya" melompat dua lagu. Tiga kali
   * pasang, tiga lagu.
   *
   * Jadi instansi baru mematikan pendahulunya. Yang dipasang sebelum
   * perubahan ini tidak tahu caranya berhenti — tapi mereka masih menunggu
   * di saluran lama, yang sekarang sudah tidak dipakai lagi, sehingga
   * perintahnya tidak lagi sampai ke mereka.
   */
  window.__tautPage?.stop?.();

  /** Satu tuas untuk melepas semua pendengar sekaligus. */
  const life = new AbortController();
  const listen = (target, name, handler) =>
    target.addEventListener(name, handler, { signal: life.signal });

  // ------------------------------------------------------------- pengambil

  const video = () => document.querySelector('video');
  const playerApi = () => document.getElementById('movie_player');
  const playerBar = () => document.querySelector('ytmusic-player-bar');

  /** Coba beberapa selector, pakai yang pertama ketemu. */
  const pick = (root, selectors) => {
    for (const selector of selectors) {
      const found = root?.querySelector(selector);
      if (found) return found;
    }
    return null;
  };

  const text = (element) => element?.textContent?.trim() || '';

  /**
   * YouTube menyajikan sampul ukuran kecil di player bar. URL-nya memuat
   * ukuran (…=w60-h60-l90-rj), jadi tinggal dinaikkan supaya tajam di HP.
   */
  function upscaleArtwork(url) {
    if (!url) return '';
    return url.replace(/=w\d+-h\d+/, '=w544-h544');
  }

  function readMetadata() {
    const metadata = navigator.mediaSession?.metadata;
    if (metadata?.title) {
      const artwork = metadata.artwork?.length
        ? metadata.artwork[metadata.artwork.length - 1].src
        : '';
      return {
        title: metadata.title,
        artist: [metadata.artist, metadata.album].filter(Boolean).join(' • '),
        artwork: upscaleArtwork(artwork),
      };
    }

    // Cadangan: baca langsung dari player bar.
    const bar = playerBar();
    return {
      title: text(pick(bar, ['.title.ytmusic-player-bar', '.title'])),
      artist: text(pick(bar, ['.byline.ytmusic-player-bar', '.byline'])),
      artwork: upscaleArtwork(pick(bar, ['img.image', 'img'])?.src || ''),
    };
  }

  /** Tombol suka/tidak suka beserta status yang sedang aktif. */
  function readRating() {
    const renderer = pick(playerBar(), ['ytmusic-like-button-renderer']);
    const status = renderer?.getAttribute('like-status');
    if (status === 'LIKE') return 'like';
    if (status === 'DISLIKE') return 'dislike';
    return 'none';
  }

  /**
   * Status acak dan ulangi hanya tersimpan di state internal YouTube Music.
   * Kalau strukturnya berubah, kembalikan null — remote tetap bisa menekan
   * tombolnya, hanya indikator aktif/tidaknya yang tidak muncul.
   */
  function readQueueModes() {
    try {
      const store = playerBar()?.store || document.querySelector('ytmusic-app')?.store;
      const queue = store?.getState?.()?.queue;
      if (!queue) return { shuffle: null, repeat: null };

      const repeatMap = { NONE: 'none', ALL: 'all', ONE: 'one' };
      return {
        shuffle: typeof queue.shuffleEnabled === 'boolean' ? queue.shuffleEnabled : null,
        repeat: repeatMap[queue.repeatMode] ?? null,
      };
    } catch {
      return { shuffle: null, repeat: null };
    }
  }

  /**
   * Volume sebagaimana dipahami YouTube Music, 0..1.
   *
   * TIDAK memakai element.volume, meski itu yang paling gampang dibaca:
   * YouTube mengalikannya dengan faktor normalisasi kenyaringan per lagu.
   * Menyetel 100% pada lagu dengan faktor 0,93 membuat element.volume berhenti
   * di 0,93 — dan dari HP itu terlihat seperti slider yang macet, padahal
   * volumenya memang sudah maksimum.
   *
   * getVolume() milik pemutar mengembalikan angka yang sama dengan slider di
   * halaman YouTube Music, lepas dari koreksi itu.
   */
  function readVolume(element) {
    const level = playerApi()?.getVolume?.();
    if (typeof level === 'number' && Number.isFinite(level)) {
      return Math.min(1, Math.max(0, level / 100));
    }
    return element.volume;
  }

  function readMuted(element) {
    const api = playerApi();
    if (api?.isMuted) {
      try {
        return Boolean(api.isMuted());
      } catch {
        /* pemutar belum siap */
      }
    }
    return element.muted;
  }

  /**
   * Apakah lagunya sedang berputar.
   *
   * TIDAK memakai element.paused sebagai sumber utama. Di tab yang sudah lama
   * terbuka, elemen <video> dan pemutar YouTube bisa tidak lagi sejalan —
   * pernah terlihat playerState=2 (jeda) sementara element.paused=false. Kalau
   * yang dibaca elemennya, remote melaporkan "sedang berputar" terus-menerus
   * dan tombol jeda seolah tidak berfungsi.
   *
   * getPlayerState() adalah anggapan YouTube Music sendiri, yang sama dengan
   * yang ditampilkan tombolnya: 1 berputar, 3 sedang memuat.
   */
  function readPlaying(element) {
    const state = playerApi()?.getPlayerState?.();
    if (typeof state === 'number' && Number.isFinite(state)) {
      return state === 1 || state === 3;
    }
    return !element.paused && !element.ended;
  }

  function readState() {
    const element = video();
    if (!element) return null;

    const metadata = readMetadata();
    const modes = readQueueModes();

    return {
      title: metadata.title,
      artist: metadata.artist,
      artwork: metadata.artwork,
      playing: readPlaying(element),
      position: Number.isFinite(element.currentTime) ? element.currentTime : 0,
      duration: Number.isFinite(element.duration) ? element.duration : 0,
      volume: readVolume(element),
      muted: readMuted(element),
      rating: readRating(),
      shuffle: modes.shuffle,
      repeat: modes.repeat,
    };
  }

  // ---------------------------------------------------------------- aksi

  /** Klik tombol milik YouTube supaya state internalnya ikut terbarui. */
  function clickButton(selectors) {
    const button = pick(playerBar(), selectors) || pick(document, selectors);
    if (!button) return false;
    button.click();
    return true;
  }

  const actions = {
    playPause() {
      // Tombol asli YouTube lebih dulu, dan itu memang yang paling benar:
      // menekannya menggerakkan mesin keadaan YouTube Music sendiri, sehingga
      // elemen <video>, pemutar, dan tampilan halaman ikut selaras. Memanggil
      // pauseVideo() saja pernah gagal di tab yang keduanya sudah tidak
      // sejalan — pemutarnya berhenti, tapi suaranya jalan terus.
      if (clickButton(['#play-pause-button', '.play-pause-button'])) return;

      const element = video();
      if (!element) return;

      const api = playerApi();
      const playing = readPlaying(element);
      if (playing) {
        if (api?.pauseVideo) api.pauseVideo();
        else element.pause();
      } else if (api?.playVideo) {
        api.playVideo();
      } else {
        element.play();
      }
    },

    next() {
      if (playerApi()?.nextVideo) playerApi().nextVideo();
      else clickButton(['.next-button', 'tp-yt-paper-icon-button.next-button']);
    },

    previous() {
      // Tekan sekali saat lagu sudah lewat beberapa detik akan mengulang dari
      // awal — perilaku yang sama dengan menekan tombol di halaman aslinya.
      if (playerApi()?.previousVideo) playerApi().previousVideo();
      else clickButton(['.previous-button', 'tp-yt-paper-icon-button.previous-button']);
    },

    seek(seconds) {
      const target = Number(seconds);
      if (!Number.isFinite(target)) return;
      const api = playerApi();
      if (api?.seekTo) api.seekTo(target, true);
      else if (video()) video().currentTime = target;
    },

    volume(level) {
      const value = Math.min(1, Math.max(0, Number(level)));
      if (!Number.isFinite(value)) return;

      const api = playerApi();
      if (api?.setVolume) {
        // Lewat API pemutar saja. Menyetel element.volume sekaligus membuat
        // keduanya saling menimpa, dan yang terbaca kemudian bukan angka yang
        // dikirim — karena YouTube menerapkan normalisasi kenyaringan di atasnya.
        api.setVolume(Math.round(value * 100));
        if (value > 0) api.unMute?.();
        return;
      }

      const element = video();
      if (!element) return;
      element.volume = value;
      if (value > 0) element.muted = false;
    },

    mute() {
      const api = playerApi();
      if (api?.isMuted && api.mute && api.unMute) {
        if (api.isMuted()) api.unMute();
        else api.mute();
        return;
      }

      const element = video();
      if (!element) return;
      element.muted = !element.muted;
    },

    like() {
      clickButton([
        'ytmusic-like-button-renderer #button-shape-like button',
        'ytmusic-like-button-renderer .like',
        '#like-button-renderer .like',
      ]);
    },

    dislike() {
      clickButton([
        'ytmusic-like-button-renderer #button-shape-dislike button',
        'ytmusic-like-button-renderer .dislike',
        '#like-button-renderer .dislike',
      ]);
    },

    shuffle() {
      clickButton(['.shuffle', 'tp-yt-paper-icon-button.shuffle', 'yt-icon-button.shuffle']);
    },

    repeat() {
      clickButton(['.repeat', 'tp-yt-paper-icon-button.repeat', 'yt-icon-button.repeat']);
    },

    /** Tidak mengubah apa pun — hanya memancing laporan keadaan terbaru. */
    refresh() {},
  };

  // ------------------------------------------------------------- pengiriman

  const post = (payload) => window.postMessage({ channel: CHANNEL, ...payload }, location.origin);

  let lastSerialized = '';

  /**
   * Kirim keadaan hanya kalau ada yang berubah. Posisi lagu sengaja dibulatkan
   * ke detik supaya perubahan milidetik tidak memicu kiriman terus-menerus —
   * remote sudah menghitung sendiri gerak halusnya.
   */
  function publish(force = false) {
    const state = readState();
    if (!state) return;

    const fingerprint = JSON.stringify({ ...state, position: Math.round(state.position) });
    if (!force && fingerprint === lastSerialized) return;
    lastSerialized = fingerprint;

    post({ type: 'state', state });
  }

  listen(window, 'message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.channel !== CHANNEL || data.type !== 'command') return;

    const action = actions[data.action];
    if (!action) return;
    try {
      action(data.value);
    } catch (error) {
      console.warn('[Taut] perintah gagal:', data.action, error);
    }
    // Laporkan hasilnya segera supaya remote tidak menunggu poll berikutnya.
    setTimeout(() => publish(true), 60);
  });

  // Pantau elemen video begitu muncul; YouTube Music membuatnya belakangan.
  let watched = null;
  function watchVideo() {
    const element = video();
    if (!element || element === watched) return;
    watched = element;
    for (const name of ['play', 'pause', 'volumechange', 'seeked', 'ratechange', 'ended']) {
      listen(element, name, () => publish(true));
    }
    publish(true);
  }

  const timer = setInterval(() => {
    watchVideo();
    publish();
  }, POLL_INTERVAL);

  window.__tautPage = {
    stop() {
      life.abort();
      clearInterval(timer);
    },
  };

  watchVideo();
  post({ type: 'ready' });
})();
