'use strict';
/**
 * Taut — jembatan antara halaman YouTube Music dan service worker ekstensi.
 *
 * page.js tidak boleh bicara langsung ke chrome.runtime (ia berjalan di dunia
 * halaman), dan service worker tidak bisa menyentuh DOM. Berkas ini duduk di
 * tengah: menerima window.postMessage, meneruskannya lewat port, dan sebaliknya.
 */

(() => {
  const CHANNEL = 'taut';
  const RECONNECT_DELAY = 1000;

  let port = null;

  function openPort() {
    try {
      port = chrome.runtime.connect({ name: 'taut-ytm' });
    } catch {
      // Ekstensi baru saja dimuat ulang — coba lagi sebentar.
      setTimeout(openPort, RECONNECT_DELAY);
      return;
    }

    port.onMessage.addListener((message) => {
      if (message?.type !== 'command') return;
      window.postMessage(
        { channel: CHANNEL, type: 'command', action: message.action, value: message.value },
        location.origin
      );
    });

    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(openPort, RECONNECT_DELAY);
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data?.channel !== CHANNEL) return;
    if (data.type !== 'state' && data.type !== 'ready') return;

    try {
      port?.postMessage(data.type === 'state' ? { type: 'state', state: data.state } : { type: 'ready' });
    } catch {
      // Port mati di tengah jalan; onDisconnect akan menyambung ulang.
      port = null;
    }
  });

  openPort();
})();
