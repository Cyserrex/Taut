'use strict';
/**
 * Ekstensi tiruan untuk mencoba Taut tanpa membuka Chrome.
 *
 * Menyambung ke server sebagai "host", memutar lagu palsu, dan menanggapi
 * perintah persis seperti ekstensi sungguhan. Berguna saat mengubah tampilan
 * remote atau memeriksa server.
 *
 * Jalankan: node test/mock-host.js [port]
 */

const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.argv[2]) || 8787;

/** Sampul palsu, dibuat langsung sebagai data URI supaya tidak perlu unduhan. */
const cover = (from, to) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">` +
      `<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
      `</linearGradient></defs><rect width="400" height="400" fill="url(#a)"/></svg>`
  );

const TRACKS = [
  {
    title: 'LOS DOL (Versi Jepang)',
    artist: 'Andi Adinata • MAHA5',
    duration: 289,
    artwork: cover('#ff6b6b', '#4834d4'),
  },
  {
    title: 'Surat Cinta Untuk Starla',
    artist: 'Virgoun • Cover',
    duration: 267,
    artwork: cover('#f9ca24', '#eb4d4b'),
  },
  {
    title: 'Semua Tentang Kita',
    artist: 'Peterpan • Versi Jepang',
    duration: 254,
    artwork: cover('#7ed6df', '#22a6b3'),
  },
];

const player = {
  index: 0,
  position: 42,
  playing: true,
  volume: 0.7,
  muted: false,
  rating: 'none',
  shuffle: false,
  repeat: 'none',
};

const snapshot = () => ({
  ...TRACKS[player.index],
  playing: player.playing,
  position: player.position,
  volume: player.volume,
  muted: player.muted,
  rating: player.rating,
  shuffle: player.shuffle,
  repeat: player.repeat,
});

// --------------------------------------------------- klien WebSocket ringkas

function connect(onOpen, onMessage) {
  const key = crypto.randomBytes(16).toString('base64');
  const request = http.request({
    port: PORT,
    host: '127.0.0.1',
    path: '/ws?role=host',
    headers: {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Key': key,
      'Sec-WebSocket-Version': '13',
    },
  });

  request.on('upgrade', (_res, socket, head) => {
    const send = (object) => {
      const payload = Buffer.from(JSON.stringify(object), 'utf8');
      const mask = crypto.randomBytes(4);
      const masked = Buffer.from(payload);
      for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];

      let header;
      if (payload.length < 126) {
        header = Buffer.from([0x81, 0x80 | payload.length]);
      } else {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(payload.length, 2);
      }
      socket.write(Buffer.concat([header, mask, masked]));
    };

    let buffer = Buffer.alloc(0);
    const consume = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Server tidak pernah mask, dan pesannya selalu kecil.
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        let len = buffer[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buffer.length < 4) return;
          len = buffer.readUInt16BE(2);
          offset = 4;
        }
        if (buffer.length < offset + len) return;
        const payload = buffer.subarray(offset, offset + len);
        buffer = buffer.subarray(offset + len);
        if (opcode === 0x1) {
          try {
            onMessage(JSON.parse(payload.toString('utf8')), send);
          } catch {
            /* abaikan */
          }
        } else if (opcode === 0x9) {
          socket.write(Buffer.from([0x8a, 0x00])); // balas ping
        }
      }
    };

    socket.on('data', consume);

    // Sisa byte yang terlanjur terbaca bersama handshake ada di `head`.
    if (head && head.length) consume(head);

    socket.on('close', () => {
      console.log('  terputus dari server, mencoba lagi…');
      setTimeout(() => connect(onOpen, onMessage), 1500);
    });

    onOpen(send);
  });

  request.on('error', () => {
    console.log(`  server belum hidup di port ${PORT}, mencoba lagi…`);
    setTimeout(() => connect(onOpen, onMessage), 1500);
  });

  request.end();
}

// ------------------------------------------------------------------ jalankan

connect(
  (send) => {
    console.log(`  ✓ host tiruan tersambung ke port ${PORT}`);
    send({ type: 'state', state: snapshot() });

    setInterval(() => {
      if (player.playing) {
        player.position += 1;
        if (player.position >= TRACKS[player.index].duration) {
          player.position = 0;
          player.index = (player.index + 1) % TRACKS.length;
        }
      }
      send({ type: 'state', state: snapshot() });
    }, 1000);
  },
  (message, send) => {
    if (message.type !== 'command') return;

    const { action, value } = message;
    if (action === 'playPause') player.playing = !player.playing;
    else if (action === 'next') {
      player.index = (player.index + 1) % TRACKS.length;
      player.position = 0;
    } else if (action === 'previous') {
      player.index = (player.index - 1 + TRACKS.length) % TRACKS.length;
      player.position = 0;
    } else if (action === 'seek') player.position = Number(value) || 0;
    else if (action === 'volume') {
      player.volume = Number(value) || 0;
      if (player.volume > 0) player.muted = false;
    } else if (action === 'mute') player.muted = !player.muted;
    else if (action === 'like') player.rating = player.rating === 'like' ? 'none' : 'like';
    else if (action === 'dislike') player.rating = player.rating === 'dislike' ? 'none' : 'dislike';
    else if (action === 'shuffle') player.shuffle = !player.shuffle;
    else if (action === 'repeat') {
      const order = ['none', 'all', 'one'];
      player.repeat = order[(order.indexOf(player.repeat) + 1) % order.length];
    }

    console.log(`  ← ${action}${value !== undefined ? ' ' + JSON.stringify(value) : ''}`);
    send({ type: 'state', state: snapshot() });
  }
);
