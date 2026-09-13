'use strict';
/** Panel kecil untuk memastikan Taut sudah nyambung, dan mengubah port kalau perlu. */

const serverDot = document.getElementById('serverDot');
const serverText = document.getElementById('serverText');
const tabDot = document.getElementById('tabDot');
const tabText = document.getElementById('tabText');
const portInput = document.getElementById('port');
const saveButton = document.getElementById('save');
const hint = document.getElementById('hint');

function render(status) {
  serverDot.classList.toggle('ok', status.connected);
  serverText.textContent = status.connected
    ? `Server tersambung (port ${status.port})`
    : 'Server Taut belum ditemukan';

  tabDot.classList.toggle('ok', status.tabs > 0);
  tabText.textContent =
    status.tabs > 0
      ? `${status.tabs} tab YouTube Music aktif`
      : 'Belum ada tab YouTube Music';

  if (document.activeElement !== portInput) portInput.value = String(status.port);

  if (status.connected && status.tabs > 0) {
    hint.textContent = 'Semua siap. Kendalikan dari HP lewat halaman Taut.';
  } else if (!status.connected) {
    hint.innerHTML =
      'Jalankan <code>npm start</code> di folder Taut pada PC ini, lalu scan QR code yang muncul di terminal.';
  } else {
    hint.textContent = 'Buka music.youtube.com di tab baru, lalu putar sebuah lagu.';
  }
}

function refresh() {
  chrome.runtime.sendMessage({ type: 'status' }, (status) => {
    if (chrome.runtime.lastError || !status) return;
    render(status);
  });
  checkSitePermission();
}

// --------------------------------------------------------------- izin situs

const YTM_ORIGINS = { origins: ['https://music.youtube.com/*'] };
const grantBox = document.getElementById('grantBox');
const grantButton = document.getElementById('grant');

/**
 * Di Firefox, izin situs pada Manifest V3 bersifat opsional — ekstensi
 * terpasang tapi belum boleh menyentuh YouTube Music sampai diizinkan.
 * Chrome memberikannya di awal, jadi tombol ini tidak pernah muncul di sana.
 */
function checkSitePermission() {
  if (!chrome.permissions?.contains) return;
  chrome.permissions.contains(YTM_ORIGINS, (granted) => {
    if (chrome.runtime.lastError) return;
    grantBox.hidden = granted !== false;
  });
}

grantButton?.addEventListener('click', () => {
  // Firefox untuk Android belum punya permissions.request. Taut memang alat
  // desktop — yang dikendalikan tab di komputer — tapi lebih baik memberi
  // penjelasan daripada gagal diam-diam.
  if (!chrome.permissions?.request) {
    hint.textContent = 'Browser ini tidak mendukung pemberian izin situs dari popup.';
    return;
  }

  chrome.permissions.request(YTM_ORIGINS, (granted) => {
    if (chrome.runtime.lastError || !granted) return;
    grantBox.hidden = true;
    hint.textContent = 'Izin diberikan. Muat ulang tab YouTube Music kamu.';
    // Skrip Taut baru ikut termuat setelah tab dibuka ulang.
    chrome.tabs?.query({ url: 'https://music.youtube.com/*' }, (tabs) => {
      if (chrome.runtime.lastError || !tabs) return;
      for (const tab of tabs) chrome.tabs.reload(tab.id);
    });
  });
});

saveButton.addEventListener('click', () => {
  const port = Number(portInput.value);
  saveButton.disabled = true;
  chrome.runtime.sendMessage({ type: 'setPort', port }, (result) => {
    saveButton.disabled = false;
    if (chrome.runtime.lastError) return;
    if (!result?.ok) {
      portInput.focus();
      portInput.select();
      return;
    }
    setTimeout(refresh, 400);
  });
});

portInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') saveButton.click();
});

refresh();
setInterval(refresh, 1500);
