#!/usr/bin/env node
'use strict';
/**
 * Taut — server penghubung.
 *
 * Perannya sederhana: jadi titik temu antara ekstensi Chrome di PC (yang
 * benar-benar menyentuh halaman YouTube Music) dan remote di HP. Server ini
 * tidak pernah "tahu" cara memutar musik — ia hanya meneruskan perintah
 * dan menyiarkan balik keadaan pemutar.
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ws = require('./ws');
const qr = require('./qr');
const config = require('./config');
const discovery = require('./discovery');
const pairing = require('./pairing');

const VERSION = require('../package.json').version;

const WEB_DIR = path.join(__dirname, '..', 'web');
const PING_INTERVAL = 20_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const VERBOSE = flag('verbose');
const PORT = Number(option('port', process.env.TAUT_PORT || 8787));

// --------------------------------------------------------------- util

const log = (...args) => console.log(...args);
const debug = (...args) => VERBOSE && console.log('  ·', ...args);

/** Alamat IPv4 LAN pertama yang bukan loopback. */
function lanAddresses() {
  const found = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  // Dahulukan rentang rumahan yang paling umum.
  return found.sort((a, b) => {
    const score = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
    return score(a) - score(b);
  });
}

function isLoopback(address = '') {
  const ip = address.replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.');
}

// --------------------------------------------------------------- hub

/**
 * Menyimpan siapa saja yang terhubung dan keadaan pemutar terakhir,
 * supaya remote yang baru buka langsung melihat lagu yang sedang jalan.
 */
class Hub {
  constructor() {
    /** @type {Set<import('./ws').WebSocket>} */
    this.hosts = new Set();
    /** @type {Set<import('./ws').WebSocket>} */
    this.remotes = new Set();
    this.state = { connected: false };
  }

  addHost(socket) {
    this.hosts.add(socket);
    this.broadcastToRemotes({ type: 'host', connected: true });
    debug(`host tersambung (total ${this.hosts.size})`);
  }

  removeHost(socket) {
    this.hosts.delete(socket);
    if (this.hosts.size === 0) {
      this.state = { connected: false };
      this.broadcastToRemotes({ type: 'host', connected: false });
    }
    debug(`host terputus (sisa ${this.hosts.size})`);
  }

  addRemote(socket) {
    this.remotes.add(socket);
    socket.send({ type: 'host', connected: this.hosts.size > 0 });
    // Hanya kirim kalau memang sudah ada laporan dari host. Mengirim keadaan
    // kosong justru membuat remote mengira PC-nya belum siap.
    if (this.state.connected) socket.send({ type: 'state', state: this.state });
    debug(`remote tersambung (total ${this.remotes.size})`);
  }

  removeRemote(socket) {
    this.remotes.delete(socket);
    debug(`remote terputus (sisa ${this.remotes.size})`);
  }

  /** Keadaan baru dari ekstensi → simpan lalu sebar ke semua remote. */
  publishState(state) {
    this.state = { ...state, connected: true };
    this.broadcastToRemotes({ type: 'state', state: this.state });
  }

  /** Perintah dari remote → teruskan ke semua ekstensi yang tersambung. */
  dispatch(command) {
    if (this.hosts.size === 0) return false;
    for (const host of this.hosts) host.send(command);
    return true;
  }

  broadcastToRemotes(message) {
    for (const remote of this.remotes) remote.send(message);
  }
}

const hub = new Hub();

// --------------------------------------------------------------- HTTP

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  // Tolak keluar dari folder web.
  const target = path.join(WEB_DIR, path.normalize(pathname).replace(/^([/\\])+/, ''));
  if (!target.startsWith(WEB_DIR)) {
    res.writeHead(403).end('Terlarang');
    return;
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Tidak ditemukan');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(body));
};

/** Baca badan permintaan JSON, dengan batas ukuran supaya tidak bisa dibanjiri. */
function readJsonBody(req, limit = 4096) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) {
        raw = '';
        req.destroy();
        resolve(null);
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/info') {
    json(res, 200, {
      name: 'Taut',
      version: VERSION,
      hostConnected: hub.hosts.size > 0,
      remotes: hub.remotes.size,
    });
    return;
  }

  // Aplikasi Android menukar PIN yang tampil di terminal dengan token.
  if (url.pathname === '/api/pair') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'gunakan POST' });
      return;
    }

    const body = await readJsonBody(req);
    const address = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const result = pairing.verify(body?.pin, address);

    if (!result.ok) {
      debug(`pairing gagal dari ${address}: ${result.reason}`);
      json(res, result.reason === 'locked' ? 429 : 401, {
        error: result.reason,
        retryAfter: result.retryAfter,
      });
      return;
    }

    log(`  ✓ perangkat baru dipasangkan dari ${address}`);
    json(res, 200, { token: config.loadOrCreateToken(), name: 'Taut', version: VERSION });
    return;
  }

  serveStatic(req, res);
});

// --------------------------------------------------------------- WebSocket

ws.attach(server, {
  path: '/ws',
  onConnection(socket, req) {
    const url = new URL(req.url, 'http://localhost');
    const role = url.searchParams.get('role') === 'host' ? 'host' : 'remote';
    const token = url.searchParams.get('token') || '';

    // Ekstensi selalu berjalan di PC yang sama, jadi loopback dipercaya
    // tanpa token. Remote dari HP wajib membawa token yang benar.
    const trusted = isLoopback(socket.remoteAddress) || config.verifyToken(token);
    if (!trusted) {
      debug(`ditolak: token salah dari ${socket.remoteAddress}`);
      socket.close(4003, 'token tidak valid');
      return;
    }

    if (role === 'host') hub.addHost(socket);
    else hub.addRemote(socket);

    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return; // bukan JSON — abaikan saja
      }
      if (!message || typeof message.type !== 'string') return;

      if (role === 'host') {
        if (message.type === 'state') hub.publishState(message.state || {});
        return;
      }

      // Dari remote: hanya perintah kontrol yang diteruskan.
      if (message.type === 'command') {
        debug(`perintah ${message.action}`, message.value ?? '');
        const delivered = hub.dispatch({
          type: 'command',
          action: message.action,
          value: message.value,
        });
        if (!delivered) socket.send({ type: 'host', connected: false });
      }
    });

    socket.on('close', () => {
      if (role === 'host') hub.removeHost(socket);
      else hub.removeRemote(socket);
    });

    socket.on('error', () => {
      /* penutupan ditangani lewat event close */
    });
  },
});

// Putuskan koneksi yang sudah mati diam-diam (HP masuk mode tidur, WiFi pindah).
setInterval(() => {
  for (const socket of [...hub.hosts, ...hub.remotes]) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, PING_INTERVAL).unref();

// --------------------------------------------------------------- start

function printBanner(token) {
  const addresses = lanAddresses();
  const host = addresses[0];

  log('');
  log('  ╭───────────────────────────────╮');
  log('  │  ♪  T A U T                   │');
  log('  │     remote YouTube Music      │');
  log('  ╰───────────────────────────────╯');
  log('');

  if (!host) {
    log('  ⚠  Tidak ada alamat WiFi/LAN yang terdeteksi.');
    log('     Pastikan PC tersambung ke jaringan, lalu jalankan ulang.');
    log('');
    log(`  Sementara ini bisa diakses lokal: http://localhost:${PORT}/#t=${token}`);
    log('');
    return;
  }

  const remoteUrl = `http://${host}:${PORT}/#t=${token}`;

  log('  Scan QR ini dengan kamera HP:');
  log('');
  log(
    qr
      .toTerminal(remoteUrl, { quiet: 2 })
      .split('\n')
      .map((line) => '  ' + line)
      .join('\n')
  );
  log('');
  log(`  atau buka manual:  ${remoteUrl}`);
  if (addresses.length > 1) {
    log(`  alamat lain:       ${addresses.slice(1).join(', ')}`);
  }
  log('');
  log(`  Pakai aplikasi Android? Aplikasi akan menemukan PC ini sendiri.`);
  log(`  Masukkan PIN ini saat diminta:   ${pairing.currentPin()}`);
  log('');
  log('  Berikutnya: pasang ekstensi Taut di browser, lalu buka music.youtube.com');
  log('  Tekan Ctrl+C untuk berhenti.');
  log('');
}

const token = config.loadOrCreateToken();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ Port ${PORT} sudah dipakai program lain.`);
    console.error(`    Coba port lain:  node server/index.js --port ${PORT + 1}\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '0.0.0.0', () => {
  discovery.start({ port: PORT, version: VERSION });
  printBanner(token);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('\n  Taut berhenti. Sampai jumpa!\n');
    process.exit(0);
  });
}
