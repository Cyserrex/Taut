'use strict';
/**
 * Service worker Taut.
 *
 * Tujuannya bukan bekerja offline sungguhan — tanpa PC menyala tidak ada yang
 * bisa dikendalikan. Yang dibutuhkan adalah kerangka aplikasi muncul seketika
 * saat ikon ditekan, supaya terasa seperti aplikasi asli, bukan halaman web
 * yang harus memuat ulang tiap kali.
 */

const CACHE = 'taut-v1';
const SHELL = [
  '.',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Status pemutar harus selalu segar; hanya kerangka aplikasi yang di-cache.
  if (url.pathname.startsWith('/api/')) return;

  // Jaringan lebih dulu, cache sebagai jaring pengaman. Dengan begitu
  // pembaruan Taut langsung terpakai tanpa perlu menghapus data aplikasi.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('index.html')))
  );
});
