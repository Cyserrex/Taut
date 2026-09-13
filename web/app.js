'use strict';
/**
 * Taut — remote di HP.
 *
 * Tiga hal yang dikerjakan berkas ini:
 *  1. menjaga koneksi WebSocket tetap hidup (HP sering tidur / pindah WiFi),
 *  2. menggambar ulang tampilan setiap kali ada kabar dari ekstensi,
 *  3. mengirim perintah dengan respons yang terasa instan.
 *
 * Poin (3) penting: menunggu balasan server bikin tombol terasa lemot, jadi
 * tampilan langsung berubah saat ditekan (optimistic) lalu dikoreksi kalau
 * ternyata keadaan sebenarnya berbeda.
 */

// ------------------------------------------------------------------ elemen

const $ = (id) => document.getElementById(id);

const ui = {
  backdrop: $('backdrop'),
  status: $('status'),
  statusText: $('statusText'),
  empty: $('empty'),
  emptyTitle: $('emptyTitle'),
  emptyHint: $('emptyHint'),
  player: $('player'),
  art: $('art'),
  title: $('title'),
  artist: $('artist'),
  seek: $('seek'),
  elapsed: $('elapsed'),
  duration: $('duration'),
  play: $('play'),
  prev: $('prev'),
  next: $('next'),
  shuffle: $('shuffle'),
  repeat: $('repeat'),
  repeatOne: $('repeatOne'),
  mute: $('mute'),
  volume: $('volume'),
  volumeValue: $('volumeValue'),
  volumeScope: $('volumeScope'),
  volumeBox: document.querySelector('.volume'),
  like: $('like'),
  dislike: $('dislike'),
  toast: $('toast'),
};

// ------------------------------------------------------------------- state

/** Keadaan pemutar terakhir yang kita tahu. */
let state = null;
/** Waktu lokal saat `state` diterima — dipakai menebak posisi di antara update. */
let stateAt = 0;
/** Diisi saat pengguna sedang menggeser slider, supaya tidak ditimpa update. */
let scrubbing = null;
let socket = null;
let retryDelay = 500;
let wakeLock = null;

const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';

// -------------------------------------------------------------- utilitas

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Getar singkat sebagai umpan balik sentuh, kalau perangkat mendukung. */
function buzz(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* diabaikan — bukan fitur wajib */
  }
}

let toastTimer = null;
function toast(message, ms = 2400) {
  ui.toast.textContent = message;
  ui.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('is-visible'), ms);
}

/**
 * Apakah slider volume sedang mengatur volume Windows.
 *
 * Server versi Windows bisa mengatur volume sistem; server Node tidak.
 * Membiarkan slider mengatur volume tab saat volume Windows tersedia bikin
 * bingung — plafonnya jadi tidak kelihatan dari HP.
 */
function usingSystemVolume() {
  return Boolean(state?.systemVolumeAvailable);
}

/** Nilai volume yang sedang ditampilkan slider, 0..1. */
function currentVolume() {
  if (!state) return 1;
  return usingSystemVolume() ? (state.systemVolume ?? 1) : (state.volume ?? 1);
}

function currentlyMuted() {
  if (!state) return false;
  return usingSystemVolume()
    ? Boolean(state.systemMuted)
    : Boolean(state.muted) || (state.volume ?? 1) === 0;
}

/** Isi warna track slider mengikuti nilainya (Chrome perlu ini manual). */
function paintRange(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const percent = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--fill', `${percent}%`);
}

// ------------------------------------------------------------------ koneksi

function setStatus(kind, text) {
  ui.status.dataset.state = kind;
  ui.statusText.textContent = text;
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws?role=remote&token=${encodeURIComponent(token)}`;

  socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    retryDelay = 500;
    setStatus('waiting', 'Tersambung');
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === 'state') applyState(message.state);
    else if (message.type === 'host') setHostConnected(message.connected);
  });

  socket.addEventListener('close', (event) => {
    socket = null;
    if (event.code === 4003) {
      setStatus('offline', 'Token salah');
      showEmpty('Tautan tidak berlaku', 'Scan ulang QR code yang muncul di terminal PC kamu.');
      return;
    }
    setStatus('offline', 'Terputus');
    scheduleReconnect();
  });

  socket.addEventListener('error', () => socket?.close());
}

function scheduleReconnect() {
  // Mundur bertahap sampai 5 detik supaya tidak membanjiri server saat PC mati.
  setTimeout(connect, retryDelay);
  retryDelay = Math.min(retryDelay * 1.6, 5000);
}

function send(action, value) {
  if (socket?.readyState !== WebSocket.OPEN) {
    toast('Belum tersambung ke PC');
    return false;
  }
  socket.send(JSON.stringify({ type: 'command', action, value }));
  return true;
}

// ------------------------------------------------------------------ render

function setHostConnected(connected) {
  if (connected) {
    setStatus('online', 'Terhubung');
  } else {
    setStatus('waiting', 'Menunggu PC');
    state = null;
    showEmpty(
      'Menunggu YouTube Music',
      'Buka <strong>music.youtube.com</strong> di Chrome pada PC kamu, lalu putar sebuah lagu.'
    );
  }
}

function showEmpty(title, html) {
  ui.emptyTitle.textContent = title;
  ui.emptyHint.innerHTML = html;
  ui.empty.hidden = false;
  ui.player.hidden = true;
  ui.backdrop.classList.remove('is-visible');
}

function applyState(next) {
  if (!next || !next.connected) {
    setHostConnected(false);
    return;
  }

  state = next;
  stateAt = Date.now();
  setStatus('online', 'Terhubung');

  ui.empty.hidden = true;
  ui.player.hidden = false;

  ui.title.textContent = next.title || 'Tidak ada lagu';
  ui.artist.textContent = next.artist || '';
  document.title = next.title ? `${next.title} — Taut` : 'Taut';

  setArtwork(next.artwork);

  ui.player.classList.toggle('is-playing', Boolean(next.playing));
  ui.play.setAttribute('aria-label', next.playing ? 'Jeda' : 'Putar');

  ui.shuffle.setAttribute('aria-pressed', String(Boolean(next.shuffle)));
  ui.repeat.setAttribute('aria-pressed', String(next.repeat && next.repeat !== 'none'));
  ui.repeatOne.hidden = next.repeat !== 'one';

  ui.like.setAttribute('aria-pressed', String(next.rating === 'like'));
  ui.dislike.setAttribute('aria-pressed', String(next.rating === 'dislike'));

  if (document.activeElement !== ui.volume) {
    const percent = Math.round(currentVolume() * 100);
    ui.volume.value = String(percent);
    ui.volumeValue.textContent = String(percent);
    paintRange(ui.volume);
  }
  ui.volumeBox.classList.toggle('is-muted', currentlyMuted());
  ui.volumeScope.textContent = usingSystemVolume() ? 'Volume Windows' : 'Volume tab';

  renderProgress();
}

let lastArtwork = null;
function setArtwork(url) {
  if (url === lastArtwork) return;
  lastArtwork = url;

  if (!url) {
    ui.art.classList.remove('is-loaded');
    ui.art.removeAttribute('src');
    ui.backdrop.classList.remove('is-visible');
    return;
  }

  ui.art.classList.remove('is-loaded');
  ui.art.onload = () => {
    ui.art.classList.add('is-loaded');
    ui.backdrop.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
    ui.backdrop.classList.add('is-visible');
  };
  ui.art.onerror = () => ui.backdrop.classList.remove('is-visible');
  ui.art.src = url;
}

/** Posisi lagu sekarang, ditebak dari update terakhir + waktu yang berlalu. */
function currentPosition() {
  if (!state) return 0;
  const base = state.position ?? 0;
  if (!state.playing) return base;
  const elapsed = (Date.now() - stateAt) / 1000;
  return Math.min(base + elapsed, state.duration ?? base);
}

function renderProgress() {
  if (!state || scrubbing !== null) return;

  const duration = state.duration ?? 0;
  const position = currentPosition();

  ui.elapsed.textContent = formatTime(position);
  ui.duration.textContent = formatTime(duration);

  ui.seek.value = String(duration > 0 ? Math.round((position / duration) * 1000) : 0);
  ui.seek.disabled = duration <= 0;
  paintRange(ui.seek);
}

// Jalan terus supaya bar bergerak halus walau update dari PC hanya tiap detik.
setInterval(renderProgress, 250);

// ------------------------------------------------------------------ aksi

/** Ubah tampilan dulu, kirim perintah setelahnya — terasa lebih responsif. */
function optimistic(patch) {
  if (!state) return;
  // Posisi ikut maju sendiri, jadi hitung ulang kecuali memang sedang diubah.
  const position = patch.position ?? currentPosition();
  state = { ...state, ...patch, position };
  stateAt = Date.now();
  applyState(state);
}

ui.play.addEventListener('click', () => {
  buzz();
  optimistic({ playing: !state?.playing });
  send('playPause');
});

ui.prev.addEventListener('click', () => {
  buzz();
  send('previous');
});

ui.next.addEventListener('click', () => {
  buzz();
  send('next');
});

ui.shuffle.addEventListener('click', () => {
  buzz();
  optimistic({ shuffle: !state?.shuffle });
  send('shuffle');
});

ui.repeat.addEventListener('click', () => {
  buzz();
  const order = ['none', 'all', 'one'];
  const nextMode = order[(order.indexOf(state?.repeat || 'none') + 1) % order.length];
  optimistic({ repeat: nextMode });
  send('repeat');
});

ui.like.addEventListener('click', () => {
  buzz();
  optimistic({ rating: state?.rating === 'like' ? 'none' : 'like' });
  send('like');
});

ui.dislike.addEventListener('click', () => {
  buzz();
  optimistic({ rating: state?.rating === 'dislike' ? 'none' : 'dislike' });
  send('dislike');
});

ui.mute.addEventListener('click', () => {
  buzz();
  if (usingSystemVolume()) {
    optimistic({ systemMuted: !state?.systemMuted });
    send('systemMute');
  } else {
    optimistic({ muted: !state?.muted });
    send('mute');
  }
});

// --- slider volume: kirim sambil digeser, tapi dibatasi agar tidak membanjiri

let volumeThrottle = 0;
ui.volume.addEventListener('input', () => {
  const percent = Number(ui.volume.value);
  ui.volumeValue.textContent = String(percent);
  paintRange(ui.volume);
  ui.volumeBox.classList.toggle('is-muted', percent === 0);

  const now = Date.now();
  if (now - volumeThrottle < 60) return;
  volumeThrottle = now;
  sendVolume(percent / 100);
});

ui.volume.addEventListener('change', () => {
  sendVolume(Number(ui.volume.value) / 100);
});

function sendVolume(level) {
  return usingSystemVolume() ? send('systemVolume', level) : send('volume', level);
}

// --- slider posisi: tahan update dari server selama jari masih menempel

function beginScrub() {
  if (!state?.duration) return;
  scrubbing = Number(ui.seek.value);
}

function updateScrub() {
  if (scrubbing === null) return;
  scrubbing = Number(ui.seek.value);
  paintRange(ui.seek);
  ui.elapsed.textContent = formatTime((scrubbing / 1000) * (state?.duration ?? 0));
}

let lastSeekSent = { value: null, at: 0 };
function endScrub() {
  if (scrubbing === null) return;
  const seconds = (scrubbing / 1000) * (state?.duration ?? 0);
  scrubbing = null;

  // pointerup dan change bisa dua-duanya menutup gerakan yang sama.
  const now = Date.now();
  if (lastSeekSent.value === seconds && now - lastSeekSent.at < 400) return;
  lastSeekSent = { value: seconds, at: now };

  buzz();
  optimistic({ position: seconds });
  send('seek', seconds);
}

ui.seek.addEventListener('pointerdown', beginScrub);
ui.seek.addEventListener('input', updateScrub);
ui.seek.addEventListener('pointerup', endScrub);
ui.seek.addEventListener('pointercancel', endScrub);
// Keyboard dan pembaca layar tidak memicu pointer event, jadi `change` tetap
// diperlukan. Urutan pointerup/change berbeda antar browser, sehingga endScrub
// menyaring sendiri kiriman ganda.
ui.seek.addEventListener('change', () => {
  if (scrubbing === null) scrubbing = Number(ui.seek.value);
  endScrub();
});

// --- pintasan papan tik, berguna kalau remote dibuka dari laptop kedua

document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  const actions = {
    ' ': () => ui.play.click(),
    ArrowRight: () => ui.next.click(),
    ArrowLeft: () => ui.prev.click(),
    l: () => ui.like.click(),
    m: () => ui.mute.click(),
  };
  const action = actions[event.key];
  if (action) {
    event.preventDefault();
    action();
  }
});

// ------------------------------------------------- jembatan aplikasi Android

/**
 * Dipanggil dari kode Kotlin saat tombol volume fisik HP ditekan.
 *
 * Sengaja diletakkan di `window` alih-alih mendengarkan event keyboard:
 * Android tidak meneruskan tombol volume ke halaman web, jadi aplikasi
 * harus menangkapnya sendiri lalu memanggil ke sini.
 */
window.tautNative = {
  nudgeVolume(step) {
    if (!state) return false;
    const next = Math.min(100, Math.max(0, Number(ui.volume.value) + Number(step)));
    ui.volume.value = String(next);
    ui.volumeValue.textContent = String(next);
    paintRange(ui.volume);
    ui.volumeBox.classList.toggle('is-muted', next === 0);

    const scope = usingSystemVolume() ? 'Windows' : 'tab';
    toast(next === 0 ? `Volume ${scope} dibisukan` : `Volume ${scope} ${next}%`, 1200);
    return sendVolume(next / 100);
  },

  /** Aplikasi memakai ini untuk tahu apakah remote sudah benar-benar siap. */
  isConnected() {
    return socket?.readyState === WebSocket.OPEN && Boolean(state);
  },
};

// ------------------------------------------------------- layar tetap nyala

async function keepScreenAwake() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    /* ditolak browser atau baterai lemah — tidak apa-apa */
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  keepScreenAwake();
  // HP yang baru bangun sering membawa socket yang sudah mati diam-diam.
  if (!socket || socket.readyState > WebSocket.OPEN) {
    retryDelay = 500;
    connect();
  }
});

// ------------------------------------------------------------------ mulai

if (!token) {
  setStatus('offline', 'Tanpa token');
  showEmpty(
    'Tautan belum lengkap',
    'Buka Taut lewat QR code atau alamat lengkap yang ditampilkan di terminal PC kamu.'
  );
} else {
  setStatus('waiting', 'Menyambung…');
  connect();
  keepScreenAwake();
}

paintRange(ui.seek);
paintRange(ui.volume);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* mode offline opsional */
  });
}
