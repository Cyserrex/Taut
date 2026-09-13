# Taut

**Kendalikan YouTube Music di PC dari HP kamu — lewat WiFi lokal, tanpa akun, tanpa internet.**

Taut mengubah HP jadi remote untuk tab YouTube Music yang sedang terbuka di Chrome.
Putar, jeda, ganti lagu, geser posisi, atur volume, sampai tombol suka — semuanya
dari genggaman, tanpa perlu bangkit menghampiri komputer.

```
   HP kamu                    PC kamu
┌─────────────┐        ┌──────────────────────────────────┐
│             │  WiFi  │  server Taut                     │
│  halaman    │◄──────►│  (node, port 8787)               │
│  remote     │   ws    │           ▲                      │
│             │        │           │ ws lokal             │
└─────────────┘        │           ▼                      │
                       │  ekstensi Chrome ──► tab         │
                       │                      YouTube     │
                       │                      Music       │
                       └──────────────────────────────────┘
```

Tidak ada data yang keluar dari jaringan rumahmu. Server hanya meneruskan
perintah; ekstensi yang benar-benar menekan tombol di halaman YouTube Music.

---

## Yang dibutuhkan

- **Node.js 18** atau lebih baru di PC
- **Chrome** (atau Edge, Brave — apa pun yang berbasis Chromium)
- HP dan PC tersambung ke **WiFi yang sama**

Tidak ada dependensi npm sama sekali. Tidak perlu `npm install`.

---

## Pasang

### 1. Jalankan server di PC

```bash
git clone https://github.com/Cyserrex/Taut.git
cd Taut
npm start
```

Terminal akan menampilkan QR code dan alamat seperti `http://192.168.1.5:8787/#t=…`

### 2. Pasang ekstensi di Chrome

1. Buka `chrome://extensions`
2. Nyalakan **Developer mode** (pojok kanan atas)
3. Klik **Load unpacked**, pilih folder `extension/` di dalam Taut
4. Buka **music.youtube.com** dan putar sebuah lagu

Ikon Taut di toolbar akan kehilangan tanda `!` begitu tersambung.

### 3. Buka remote di HP

Scan QR code di terminal dengan kamera HP. Selesai.

> Supaya terasa seperti aplikasi: di Chrome HP, buka menu ⋮ lalu
> **Tambahkan ke layar utama**. Taut akan punya ikonnya sendiri dan terbuka
> tanpa bilah alamat.

---

## Yang bisa dikendalikan

| Kontrol | Keterangan |
|---|---|
| Putar / jeda | Tombol besar di tengah |
| Lagu berikutnya / sebelumnya | |
| Geser posisi lagu | Tarik bilah progres |
| Volume | Volume tab YouTube Music, bukan volume sistem |
| Bisukan | |
| Acak & ulangi | Ulangi berputar: mati → semua → satu lagu |
| Suka / lewati | Tombol jempol milik YouTube Music |

Judul, artis, sampul album, dan posisi lagu ikut tampil dan diperbarui langsung.

---

## Kalau ada yang tidak jalan

**QR code tidak muncul, hanya tulisan alamat**
PC belum dapat alamat WiFi. Periksa koneksi jaringannya.

**HP tidak bisa membuka alamatnya**
Windows Firewall biasanya bertanya saat Taut pertama kali dijalankan — pilih
**Private networks**. Kalau terlanjur diblokir, izinkan Node.js lewat
Windows Defender Firewall → *Allow an app through firewall*.

Pastikan juga HP dan PC benar-benar di WiFi yang sama. WiFi tamu dan beberapa
WiFi kantor memisahkan antar-perangkat (*AP isolation*), jadi tidak akan bisa.

**Ikon ekstensi tetap bertanda `!`**
Server belum jalan, atau portnya berbeda. Klik ikon Taut untuk melihat status
dan mengubah port.

**Port 8787 sudah dipakai**

```bash
npm start -- --port 9000
```

Lalu ubah port di popup ekstensi ke angka yang sama.

**Tampil "Tautan tidak berlaku" di HP**
Token berubah. Scan ulang QR code yang baru.

---

## Keamanan

Server hanya mendengarkan di jaringan lokal, dan setiap remote wajib membawa
token yang tersimpan di `~/.taut/config.json`. Token itulah yang ikut di dalam
QR code, jadi orang lain di WiFi yang sama tidak bisa ikut mengganti lagumu
hanya dengan menebak alamat IP.

Ekstensi tidak perlu token karena berjalan di komputer yang sama (loopback).

Mau mengganti token — misalnya setelah meminjamkan HP — hapus
`~/.taut/config.json`, lalu jalankan ulang Taut dan scan QR yang baru.

**Jangan meneruskan port Taut ke internet.** Taut dirancang untuk jaringan
lokal dan tidak memakai enkripsi.

---

## Pengembangan

```bash
npm test          # uji generator QR dan integrasi server
npm run dev       # server dengan log rinci
npm run mock      # ekstensi tiruan, untuk mengutak-atik tampilan tanpa Chrome
```

`npm run mock` sangat membantu saat mengubah tampilan remote: ia berpura-pura
jadi YouTube Music lengkap dengan lagu berjalan dan tanggapan atas perintah,
jadi kamu tidak perlu login atau memutar musik sungguhan.

### Susunan berkas

```
server/     server penghubung — HTTP, WebSocket, QR, token
  ws.js     implementasi WebSocket (RFC 6455) tanpa dependensi
  qr.js     generator QR code tanpa dependensi
extension/  ekstensi Chrome
  page.js   satu-satunya berkas yang menyentuh YouTube Music
web/        halaman remote untuk HP (PWA)
test/       uji otomatis + ekstensi tiruan
```

### Catatan rancangan

`extension/page.js` membaca keadaan berlapis, dari yang paling stabil ke yang
paling rapuh: elemen `<video>`, lalu `navigator.mediaSession`, baru tombol DOM
YouTube Music. Kalau YouTube mengubah tampilannya, kontrol utama tetap hidup —
yang hilang paling banter indikator acak/ulangi.

`server/ws.js` ditulis sendiri supaya Taut bisa dijalankan langsung setelah
`git clone`, tanpa `npm install`. Cakupannya sengaja sempit: teks JSON,
ping/pong, dan penutupan yang rapi.

---

## Lisensi

[MIT](LICENSE)
