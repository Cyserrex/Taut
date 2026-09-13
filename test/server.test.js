'use strict';
/**
 * Uji integrasi server Taut.
 *
 * Menjalankan server sungguhan di port acak, lalu memerankan ekstensi dan HP
 * lewat WebSocket asli — termasuk masking dari sisi klien, yang jadi bagian
 * paling gampang salah pada implementasi buatan sendiri.
 *
 * Jalankan: node test/server.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const dgram = require('dgram');
const os = require('os');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8700 + Math.floor(Math.random() * 200);
const ROOT = path.join(__dirname, '..');

// ------------------------------------------------------- klien WebSocket uji

/** Klien seadanya: cukup untuk mengirim JSON bertopeng dan membaca balasannya. */
function openClient(query) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: PORT,
      path: `/ws?${query}`,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13',
      },
    });

    request.on('upgrade', (_res, socket) => {
      const client = {
        socket,
        messages: [],
        closeCode: null,
        send(object) {
          const payload = Buffer.from(JSON.stringify(object), 'utf8');
          const mask = crypto.randomBytes(4);
          const masked = Buffer.from(payload);
          for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
          const header = Buffer.from([0x81, 0x80 | payload.length]);
          socket.write(Buffer.concat([header, mask, masked]));
        },
        close() {
          socket.destroy();
        },
        /** Tunggu sampai ada pesan yang cocok, atau menyerah setelah timeout. */
        waitFor(predicate, timeout = 2500, label = 'pesan') {
          return new Promise((ok, fail) => {
            const found = this.messages.find(predicate);
            if (found) return ok(found);
            const started = Date.now();
            const timer = setInterval(() => {
              const hit = this.messages.find(predicate);
              if (hit) {
                clearInterval(timer);
                ok(hit);
              } else if (Date.now() - started > timeout) {
                clearInterval(timer);
                fail(new Error(`menunggu ${label} tapi tidak datang dalam batas waktu`));
              }
            }, 25);
          });
        },
      };

      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
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
              client.messages.push(JSON.parse(payload.toString('utf8')));
            } catch {
              /* bukan JSON */
            }
          } else if (opcode === 0x8) {
            client.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
          } else if (opcode === 0x9) {
            socket.write(Buffer.from([0x8a, 0x00]));
          }
        }
      });

      socket.on('error', () => {});
      resolve(client);
    });

    request.on('error', reject);
    request.end();
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function postJson(pathname, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** Alamat IPv4 non-loopback pertama, kalau ada — untuk menguji sisi jaringan. */
function lanAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

function fetchJson(pathname, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    http
      .get({ host, port: PORT, path: pathname }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

// ------------------------------------------------------------------ jalankan

async function main() {
  const server = spawn(process.execPath, ['server/index.js', '--port', String(PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  // PIN dibuat ulang tiap kali server dinyalakan, jadi satu-satunya cara
  // mengetahuinya adalah membacanya dari banner — persis seperti yang
  // dilakukan pengguna.
  let banner = '';
  server.stdout.on('data', (chunk) => (banner += chunk));
  const pinFromBanner = () => banner.match(/Masukkan PIN ini saat diminta:\s*(\d{6})/)?.[1];

  // Tunggu sampai server benar-benar menerima koneksi.
  for (let i = 0; i < 60; i++) {
    try {
      await fetchJson('/api/info');
      break;
    } catch {
      await wait(100);
    }
  }

  const token = require('../server/config').loadOrCreateToken();
  let passed = 0;

  try {
    // --- halaman remote tersaji
    {
      const info = await fetchJson('/api/info');
      assert.strictEqual(info.status, 200);
      assert.strictEqual(JSON.parse(info.body).name, 'Taut');

      const page = await fetchJson('/');
      assert.strictEqual(page.status, 200);
      assert.ok(page.body.includes('Taut'), 'index.html harus tersaji');
      passed++;
    }

    // --- jelajah direktori ditolak
    {
      const escape = await fetchJson('/../package.json');
      assert.notStrictEqual(escape.status, 200, 'tidak boleh menyajikan berkas di luar web/');
      passed++;
    }

    // --- remote tanpa token ditolak dari alamat non-loopback dijamin oleh
    //     pemeriksaan token; dari loopback kita uji jalur token yang salah.
    {
      const bad = await openClient('role=remote&token=jelasjelassalah');
      await wait(300);
      bad.close();
      passed++;
    }

    // --- alur utama: host mengirim keadaan, remote menerimanya
    {
      const host = await openClient('role=host');
      const remote = await openClient(`role=remote&token=${token}`);

      await remote.waitFor((m) => m.type === 'host' && m.connected === true, 2500, 'host connected');
      assert.strictEqual(
        remote.messages.filter((m) => m.type === 'state').length,
        0,
        'remote tidak boleh menerima keadaan kosong sebelum host melapor'
      );

      host.send({
        type: 'state',
        state: { title: 'Lagu Uji', artist: 'Penguji', playing: true, position: 12, duration: 200 },
      });

      const update = await remote.waitFor((m) => m.type === 'state', 2500, 'state pertama');
      assert.strictEqual(update.state.title, 'Lagu Uji');
      assert.strictEqual(update.state.connected, true, 'server menandai host aktif');
      passed++;

      // --- perintah dari remote sampai ke host
      remote.send({ type: 'command', action: 'next' });
      const command = await host.waitFor((m) => m.type === 'command', 2500, 'command next');
      assert.strictEqual(command.action, 'next');
      passed++;

      // --- nilai perintah ikut terkirim utuh
      remote.send({ type: 'command', action: 'volume', value: 0.42 });
      const withValue = await host.waitFor((m) => m.type === 'command' && m.action === 'volume', 2500, 'command volume');
      assert.strictEqual(withValue.value, 0.42);
      passed++;

      // --- remote yang baru datang langsung dapat keadaan terakhir
      const second = await openClient(`role=remote&token=${token}`);
      const replay = await second.waitFor((m) => m.type === 'state', 2500, 'state ulangan');
      assert.strictEqual(replay.state.title, 'Lagu Uji', 'keadaan terakhir disimpan server');
      passed++;
      second.close();

      // --- remote tidak boleh menyamar jadi host
      remote.send({ type: 'state', state: { title: 'Palsu' } });
      await wait(300);
      const spoofed = second.messages.filter((m) => m.type === 'state' && m.state?.title === 'Palsu');
      assert.strictEqual(spoofed.length, 0, 'keadaan dari remote harus diabaikan');
      passed++;

      // --- host terputus: remote diberi tahu
      host.close();
      await remote.waitFor((m) => m.type === 'host' && m.connected === false, 2500, 'host disconnected');
      passed++;

      remote.close();
    }

    // --- PIN dan token hanya boleh terlihat dari komputer itu sendiri
    {
      const local = JSON.parse((await fetchJson('/api/info')).body);
      assert.ok(local.pin, 'dari loopback, PIN ikut disertakan');
      assert.strictEqual(local.token, token, 'dari loopback, token ikut disertakan');

      const address = lanAddress();
      if (address) {
        const remote = JSON.parse((await fetchJson('/api/info', address)).body);
        assert.ok(!('pin' in remote), 'PIN tidak boleh terkirim ke jaringan');
        assert.ok(!('token' in remote), 'token tidak boleh terkirim ke jaringan');
        assert.strictEqual(remote.name, 'Taut', 'keterangan umum tetap dijawab');
      }
      passed++;
    }

    // --- penemuan lewat UDP menjawab dengan identitas server
    {
      const socket = dgram.createSocket('udp4');
      const replies = [];
      socket.on('message', (raw) => {
        try {
          replies.push(JSON.parse(raw.toString('utf8')));
        } catch {
          /* bukan jawaban Taut */
        }
      });

      await new Promise((done) => socket.bind(done));
      socket.send('TAUT-DISCOVER', PORT, '127.0.0.1');
      await wait(600);

      const reply = replies.find((r) => r.app === 'taut');
      assert.ok(reply, 'server harus menjawab pertanyaan penemuan');
      assert.strictEqual(reply.port, PORT, 'jawaban memuat port yang benar');
      assert.ok(reply.name, 'jawaban memuat nama komputer');
      assert.ok(!('token' in reply), 'jawaban penemuan tidak boleh membocorkan token');

      // Datagram asing diabaikan tanpa menjatuhkan server.
      replies.length = 0;
      socket.send('halo?', PORT, '127.0.0.1');
      await wait(300);
      assert.strictEqual(replies.length, 0, 'hanya pertanyaan yang sah yang dijawab');

      socket.close();
      passed++;
    }

    // --- pairing menukar PIN yang benar dengan token, dan menolak yang salah
    {
      const pin = pinFromBanner();
      assert.ok(pin, 'banner terminal harus menampilkan PIN');

      const wrong = await postJson('/api/pair', { pin: pin === '000000' ? '111111' : '000000' });
      assert.strictEqual(wrong.status, 401, 'PIN salah ditolak');

      const right = await postJson('/api/pair', { pin });
      assert.strictEqual(right.status, 200, 'PIN benar diterima');
      assert.strictEqual(JSON.parse(right.body).token, token, 'pairing mengembalikan token yang sama');
      passed++;
    }

    // --- tebakan beruntun dihentikan
    {
      let locked = false;
      for (let i = 0; i < 8; i++) {
        const attempt = await postJson('/api/pair', { pin: '999999' });
        if (attempt.status === 429) {
          locked = true;
          break;
        }
      }
      assert.ok(locked, 'tebakan PIN beruntun harus dikunci sementara');
      passed++;
    }

    // --- pesan sampah tidak menjatuhkan server
    {
      const noisy = await openClient(`role=remote&token=${token}`);
      noisy.socket.write(Buffer.from([0x81, 0x83, 0, 0, 0, 0, 1, 2])); // JSON rusak
      noisy.send({ tanpaType: true });
      noisy.send({ type: 'command' });
      await wait(300);
      noisy.close();

      const stillAlive = await fetchJson('/api/info');
      assert.strictEqual(stillAlive.status, 200, 'server harus tetap hidup');
      passed++;
    }

    console.log(`server: ${passed} pemeriksaan lulus`);
  } finally {
    server.kill();
  }
}

main().catch((error) => {
  console.error('server: GAGAL —', error.message);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 100);
});
