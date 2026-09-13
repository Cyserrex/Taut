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
}

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
