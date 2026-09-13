'use strict';
/**
 * Pairing lewat PIN.
 *
 * Penemuan otomatis membuat aplikasi tahu di mana PC berada, tapi tahu alamat
 * tidak boleh berarti boleh mengendalikan. PIN enam angka yang tampil di
 * terminal PC-lah yang menjadi buktinya: hanya orang yang benar-benar duduk
 * di depan komputer itu yang bisa membacanya.
 *
 * Setelah berhasil sekali, aplikasi menyimpan token dan tidak perlu PIN lagi.
 */

const crypto = require('crypto');

/** Sesudah sekian percobaan gagal, alamat itu diistirahatkan sejenak. */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

/** @type {Map<string, { failures: number, lockedUntil: number }>} */
const attempts = new Map();

let pin = null;

/** PIN dibuat ulang setiap server dinyalakan, jadi tidak menumpuk selamanya. */
function currentPin() {
  if (!pin) {
    pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  }
  return pin;
}

function record(address) {
  const entry = attempts.get(address) || { failures: 0, lockedUntil: 0 };
  entry.failures += 1;
  if (entry.failures >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.failures = 0;
  }
  attempts.set(address, entry);
}

/**
 * Periksa PIN yang dikirim aplikasi.
 *
 * @param {string} candidate
 * @param {string} address alamat pengirim, untuk membatasi tebakan beruntun
 * @returns {{ ok: true } | { ok: false, reason: 'locked' | 'invalid', retryAfter?: number }}
 */
function verify(candidate, address) {
  const entry = attempts.get(address);
  if (entry && entry.lockedUntil > Date.now()) {
    return { ok: false, reason: 'locked', retryAfter: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
  }

  const expected = currentPin();
  const given = typeof candidate === 'string' ? candidate.trim() : '';

  // Bandingkan dengan waktu tetap supaya angka tidak bisa ditebak sedikit demi
  // sedikit dari lamanya jawaban.
  const same =
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));

  if (!same) {
    record(address);
    return { ok: false, reason: 'invalid' };
  }

  attempts.delete(address);
  return { ok: true };
}

module.exports = { currentPin, verify, MAX_ATTEMPTS };
