'use strict';
/**
 * Taut — service worker ekstensi.
 *
 * Memegang satu koneksi WebSocket ke server Taut di PC yang sama. Semua tab
 * YouTube Music menyambung ke sini lewat port; tab yang terakhir mengirim
 * keadaan dianggap sebagai tab aktif, sehingga perintah dari HP selalu
 * mendarat di pemutar yang benar-benar berbunyi.
 *
 * Catatan soal Manifest V3: service worker bisa dimatikan Chrome saat
 * menganggur. Lalu lintas WebSocket sendiri sudah memperpanjang umurnya,
 * dan alarm di bawah menjadi jaring pengaman kalau tetap tertidur.
 */

const DEFAULT_PORT = 8787;
const KEEPALIVE_ALARM = 'taut-keepalive';
const RETRY_MIN = 1000;
const RETRY_MAX = 15000;

let socket = null;
let retryDelay = RETRY_MIN;
let retryTimer = null;

/** @type {Set<chrome.runtime.Port>} */
const tabs = new Set();
/** Tab yang paling terakhir melaporkan keadaan — target perintah berikutnya. */
let activeTab = null;

// ------------------------------------------------------------------ setelan

async function getServerPort() {
  const stored = await chrome.storage.local.get('port');
  const value = Number(stored.port);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : DEFAULT_PORT;
}

async function setBadge(connected) {
  await chrome.action.setBadgeText({ text: connected ? '' : '!' });
  await chrome.action.setBadgeBackgroundColor({ color: '#ff2e63' });
  await chrome.action.setTitle({
    title: connected ? 'Taut — tersambung ke server' : 'Taut — server belum ditemukan',
  });
}

// ---------------------------------------------------------------- WebSocket

async function connect() {
  if (socket && socket.readyState <= WebSocket.OPEN) return;

  clearTimeout(retryTimer);
  const port = await getServerPort();

  // Server berjalan di komputer yang sama, jadi loopback sudah dipercaya
  // dan tidak perlu token.
  socket = new WebSocket(`ws://127.0.0.1:${port}/ws?role=host`);

  socket.addEventListener('open', () => {
    retryDelay = RETRY_MIN;
    setBadge(true);
    // Minta keadaan terkini supaya HP tidak menunggu siklus poll berikutnya.
    activeTab?.postMessage({ type: 'command', action: 'refresh' });
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message?.type !== 'command') return;

    const target = activeTab ?? [...tabs][0];
    if (!target) return;
    try {
      target.postMessage({ type: 'command', action: message.action, value: message.value });
    } catch {
      // Tab sudah tertutup; daftar akan dibersihkan lewat onDisconnect.
    }
  });

  socket.addEventListener('close', () => {
    socket = null;
    setBadge(false);
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    try {
      socket?.close();
    } catch {
      /* sudah tertutup */
    }
  });
}

function scheduleReconnect() {
  clearTimeout(retryTimer);
  // Tidak perlu mencoba kalau tidak ada tab YouTube Music yang terbuka.
  if (tabs.size === 0) return;
  retryTimer = setTimeout(connect, retryDelay);
  retryDelay = Math.min(retryDelay * 1.8, RETRY_MAX);
}

function sendState(state) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'state', state }));
}

// --------------------------------------------------------------- tab YTM

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'taut-ytm') return;

  tabs.add(port);
  activeTab ??= port;
  connect();

  port.onMessage.addListener((message) => {
    if (message?.type === 'state') {
      // Tab yang sedang berbunyi yang berhak menerima perintah.
      if (message.state?.playing || !activeTab) activeTab = port;
      sendState(message.state);
    }
  });

  port.onDisconnect.addListener(() => {
    tabs.delete(port);
    if (activeTab === port) activeTab = [...tabs][0] ?? null;
    if (tabs.size === 0) {
      clearTimeout(retryTimer);
      try {
        socket?.close();
      } catch {
        /* sudah tertutup */
      }
    }
  });
});

// -------------------------------------------------------------- keepalive

chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) return;
  if (tabs.size > 0 && (!socket || socket.readyState > WebSocket.OPEN)) {
    retryDelay = RETRY_MIN;
    connect();
  }
});

chrome.runtime.onStartup.addListener(() => setBadge(false));
chrome.runtime.onInstalled.addListener(() => setBadge(false));

// Popup menanyakan status dan bisa mengubah port server.
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === 'status') {
    getServerPort().then((port) =>
      respond({
        connected: socket?.readyState === WebSocket.OPEN,
        tabs: tabs.size,
        port,
      })
    );
    return true;
  }

  if (message?.type === 'setPort') {
    const value = Number(message.port);
    if (!Number.isInteger(value) || value <= 0 || value >= 65536) {
      respond({ ok: false });
      return true;
    }
    chrome.storage.local.set({ port: value }).then(() => {
      try {
        socket?.close();
      } catch {
        /* sudah tertutup */
      }
      socket = null;
      retryDelay = RETRY_MIN;
      connect().then(() => respond({ ok: true }));
    });
    return true;
  }

  return false;
});
