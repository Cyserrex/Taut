'use strict';
/**
 * Penemuan otomatis lewat UDP broadcast.
 *
 * Tanpa ini, aplikasi di HP harus diberi tahu alamat IP PC — dan alamat itu
 * berubah setiap kali router membagikan ulang alamat. Di sini PC cukup
 * menjawab "saya di sini" ketika ada yang bertanya di jaringan yang sama,
 * jadi aplikasi bisa menemukannya sendiri tiap kali dibuka.
 */

const dgram = require('dgram');
const os = require('os');

/** Kata sandi pembuka; aplikasi mengirim ini, server menjawab. */
const PROBE = 'TAUT-DISCOVER';

/** Batas ukuran datagram yang dilayani — pertanyaan yang sah selalu pendek. */
const MAX_PROBE = 64;

/**
 * Mulai mendengarkan pertanyaan penemuan.
 *
 * @param {{ port: number, version: string }} options
 * @returns {{ close: () => void }}
 */
function start({ port, version }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('message', (message, sender) => {
    if (message.length > MAX_PROBE) return;
    if (message.toString('utf8').trim() !== PROBE) return;

    // Sengaja tidak memuat token: siapa pun di jaringan bisa bertanya, tapi
    // untuk benar-benar mengendalikan pemutar tetap harus lewat pairing.
    const reply = Buffer.from(
      JSON.stringify({
        app: 'taut',
        name: os.hostname(),
        port,
        version,
      }),
      'utf8'
    );

    socket.send(reply, sender.port, sender.address, () => {});
  });

  socket.on('error', () => {
    // Port UDP dipakai program lain, atau jaringan menolak. Taut tetap jalan;
    // pengguna masih bisa memasukkan alamat secara manual.
    try {
      socket.close();
    } catch {
      /* sudah tertutup */
    }
  });

  socket.bind(port, () => {
    try {
      socket.setBroadcast(true);
    } catch {
      /* sebagian sistem melarang; menjawab langsung ke pengirim tetap bisa */
    }
  });

  return {
    close() {
      try {
        socket.close();
      } catch {
        /* sudah tertutup */
      }
    },
  };
}

module.exports = { start, PROBE };
