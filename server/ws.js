'use strict';
/**
 * Implementasi WebSocket server minimal (RFC 6455) tanpa dependensi.
 * Cukup untuk kebutuhan Taut: teks JSON, ping/pong, close yang rapi.
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BIN = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** Batas ukuran pesan masuk — remote hanya mengirim perintah kecil. */
const MAX_MESSAGE = 1 * 1024 * 1024;

class WebSocket extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.isAlive = true;
    this.closed = false;
    this._buffer = Buffer.alloc(0);
    this._fragments = [];
    this._fragmentOp = null;

    // EventEmitter melempar kalau 'error' tidak punya pendengar sama sekali.
    // Koneksi yang putus mendadak (HP tidur, WiFi pindah) lumrah terjadi dan
    // tidak boleh menjatuhkan server, jadi selalu ada pendengar dasar di sini.
    this.on('error', () => {});

    socket.on('data', (chunk) => this._onData(chunk));
    // 'end' menandai sisi lain berhenti mengirim. Tanpa ini koneksi setengah
    // terbuka baru ketahuan mati saat ping berikutnya — sampai puluhan detik
    // kemudian remote masih mengira PC-nya menyala.
    socket.on('end', () => this._finish());
    socket.on('close', () => this._finish());
    socket.on('error', (err) => {
      this.emit('error', err);
      this._finish();
    });
  }

  get remoteAddress() {
    return this.socket.remoteAddress || '';
  }

  send(data) {
    if (this.closed) return;
    const payload = Buffer.from(
      typeof data === 'string' ? data : JSON.stringify(data),
      'utf8'
    );
    this._write(OP_TEXT, payload);
  }

  ping() {
    if (this.closed) return;
    this._write(OP_PING, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const reasonBuf = Buffer.from(reason, 'utf8');
    const payload = Buffer.alloc(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    this._write(OP_CLOSE, payload);
    this._finish();
    try {
      this.socket.end();
    } catch {
      /* socket sudah lepas */
    }
  }

  terminate() {
    this._finish();
    try {
      this.socket.destroy();
    } catch {
      /* socket sudah lepas */
    }
  }

  _finish() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
    // Tutup sisi kita juga supaya soket benar-benar dilepas.
    try {
      this.socket.end();
    } catch {
      /* sudah lepas */
    }
  }

  _write(opcode, payload) {
    // Frame dari server tidak pernah di-mask (RFC 6455 §5.1).
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode; // FIN + opcode
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch (err) {
      this.emit('error', err);
      this._finish();
    }
  }

  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    // Satu paket TCP bisa memuat banyak frame, atau satu frame terpecah.
    while (this._parseFrame()) {
      /* terus baca selama masih ada frame utuh */
    }
  }

  /** @returns {boolean} true kalau satu frame berhasil dikonsumsi. */
  _parseFrame() {
    const buf = this._buffer;
    if (buf.length < 2) return false;

    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (buf.length < offset + 2) return false;
      len = buf.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buf.length < offset + 8) return false;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(MAX_MESSAGE)) {
        this.close(1009, 'pesan terlalu besar');
        return false;
      }
      len = Number(big);
      offset += 8;
    }

    if (len > MAX_MESSAGE) {
      this.close(1009, 'pesan terlalu besar');
      return false;
    }

    let maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) return false;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + len) return false;

    const payload = Buffer.from(buf.subarray(offset, offset + len));
    this._buffer = buf.subarray(offset + len);

    if (maskKey) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskKey[i & 3];
      }
    }

    this._handleFrame(fin, opcode, payload);
    return true;
  }

  _handleFrame(fin, opcode, payload) {
    switch (opcode) {
      case OP_PING:
        this._write(OP_PONG, payload);
        return;
      case OP_PONG:
        this.isAlive = true;
        return;
      case OP_CLOSE:
        this.close(1000, '');
        return;
      case OP_CONT: {
        if (this._fragmentOp === null) return; // fragmen yatim, abaikan
        this._fragments.push(payload);
        if (!fin) return;
        const full = Buffer.concat(this._fragments);
        const op = this._fragmentOp;
        this._fragments = [];
        this._fragmentOp = null;
        if (op === OP_TEXT) this._emitMessage(full);
        return;
      }
      case OP_TEXT:
      case OP_BIN: {
        if (!fin) {
          this._fragmentOp = opcode;
          this._fragments = [payload];
          return;
        }
        if (opcode === OP_TEXT) this._emitMessage(payload);
        return;
      }
      default:
        this.close(1002, 'opcode tidak dikenal');
    }
  }

  _emitMessage(buf) {
    this.isAlive = true;
    this.emit('message', buf.toString('utf8'));
  }
}

/**
 * Pasang handler upgrade WebSocket pada server HTTP yang sudah ada.
 * @param {import('http').Server} server
 * @param {{ path?: string, onConnection: (ws: WebSocket, req: import('http').IncomingMessage) => void }} opts
 */
function attach(server, opts) {
  const path = opts.path || '/ws';

  // Soket mentah bisa error sebelum sempat dibungkus; tanpa ini prosesnya mati.
  server.on('clientError', (_err, socket) => socket.destroy());

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());

    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== path) {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const accept = crypto
      .createHash('sha1')
      .update(key + GUID)
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);

    const ws = new WebSocket(socket, req);
    if (head && head.length) ws._onData(head);
    opts.onConnection(ws, req);
  });
}

module.exports = { attach, WebSocket };
