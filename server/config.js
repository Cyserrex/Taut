'use strict';
/**
 * Token akses Taut.
 *
 * Server hanya hidup di jaringan lokal, tapi "lokal" bisa berarti kafe atau
 * kos dengan WiFi bersama. Token ini memastikan hanya HP yang pernah scan QR
 * yang bisa mengendalikan pemutar — bukan siapa saja yang menebak IP-mu.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = path.join(os.homedir(), '.taut');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

let cachedToken = null;

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(data) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/**
 * Ambil token yang tersimpan, atau buat baru kalau belum ada.
 * Token sengaja dipertahankan antar-sesi supaya HP tidak perlu scan ulang
 * tiap kali server dinyalakan.
 */
function loadOrCreateToken() {
  if (cachedToken) return cachedToken;

  const config = readConfig();
  if (typeof config.token === 'string' && config.token.length >= 16) {
    cachedToken = config.token;
    return cachedToken;
  }

  cachedToken = crypto.randomBytes(8).toString('hex');
  writeConfig({ ...config, token: cachedToken });
  return cachedToken;
}

/** Ganti token — semua HP yang sudah tersimpan harus scan ulang. */
function resetToken() {
  cachedToken = crypto.randomBytes(8).toString('hex');
  writeConfig({ ...readConfig(), token: cachedToken });
  return cachedToken;
}

/** Bandingkan token dengan waktu konstan agar tidak bisa ditebak bertahap. */
function verifyToken(candidate) {
  const expected = loadOrCreateToken();
  if (typeof candidate !== 'string' || candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

module.exports = { loadOrCreateToken, resetToken, verifyToken, CONFIG_FILE };
