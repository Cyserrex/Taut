# Taut

**Kendalikan YouTube Music di PC dari HP kamu — lewat WiFi lokal, tanpa akun, tanpa internet.**

Taut mengubah HP jadi remote untuk tab YouTube Music yang sedang terbuka di
browser. Putar, jeda, ganti lagu, geser posisi, atur volume, sampai tombol suka
— semuanya dari genggaman, tanpa perlu bangkit menghampiri komputer.

Tersedia sebagai **aplikasi Android** (yang menemukan PC-mu sendiri) atau
langsung lewat **browser HP**. Ekstensinya jalan di **Chrome maupun Firefox**.

```
   HP kamu                      PC kamu
┌──────────────┐        ┌──────────────────────────────────┐
│  aplikasi    │  WiFi  │  server Taut                     │
│  Android     │◄──────►│  (node, port 8787)               │
│     atau     │   ws   │           ▲                      │
│  browser HP  │        │           │ ws lokal             │
└──────────────┘        │           ▼                      │
                        │  ekstensi browser ──► tab        │
                        │  (Chrome/Firefox)     YouTube    │
                        │                       Music      │
                        └──────────────────────────────────┘
```

Tidak ada data yang keluar dari jaringan rumahmu. Server hanya meneruskan
perintah; ekstensi yang benar-benar menekan tombol di halaman YouTube Music.

---

## Yang dibutuhkan

- **Node.js 18** atau lebih baru di PC
- **Chrome/Edge/Brave** atau **Firefox**
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

Terminal menampilkan QR code, alamat, dan **PIN enam angka**.
Biarkan jendela ini terbuka selama kamu memakai Taut.

### 2. Pasang ekstensi di browser

Susun dulu kedua varian:

```bash
npm run build:ext
```

**Chrome / Edge / Brave**
1. Buka `chrome://extensions`
2. Nyalakan **Developer mode** (pojok kanan atas)
3. **Load unpacked** → pilih folder `dist/chrome`

**Firefox**
1. Buka `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on** → pilih `dist/firefox/manifest.json`
3. Klik ikon Taut, lalu **Izinkan akses YouTube Music**

Lalu buka **music.youtube.com** dan putar sebuah lagu. Ikon Taut akan
kehilangan tanda `!` begitu tersambung.

> Di Firefox, ekstensi yang dimuat lewat *Temporary Add-on* hilang saat
> browser ditutup. Untuk permanen, ekstensi perlu ditandatangani Mozilla —
> lihat [catatan Firefox](#catatan-firefox) di bawah.

### 3. Pilih remote di HP

**Aplikasi Android** — cara paling ringkas
1. Unduh APK dari [halaman Releases](https://github.com/Cyserrex/Taut/releases)
2. Pasang (Android akan meminta izin memasang dari sumber luar)
3. Buka aplikasi — PC-mu muncul sendiri di daftar
4. Ketuk PC itu, masukkan PIN dari terminal. Selesai, selamanya.

Sesudah ini kamu tidak perlu tahu alamat IP sama sekali. Kalau router
memberi PC alamat baru, aplikasi mencarinya lagi sendiri.

**Lewat browser HP** — tanpa pasang apa pun
Scan QR code di terminal dengan kamera HP.

> Supaya terasa seperti aplikasi: di Chrome HP, buka menu ⋮ lalu
> **Tambahkan ke layar utama**.

---

## Aplikasi Android vs browser HP

Isinya tampilan yang sama; aplikasi menambahkan hal-hal yang tidak bisa
dilakukan sebuah halaman web di Android.

| | Aplikasi | Browser HP |
|---|---|---|
| Semua kontrol pemutar | ✓ | ✓ |
| Perlu tahu alamat IP PC | tidak pernah | saat scan QR |
| Alamat PC berubah | dicari ulang sendiri | perlu scan QR lagi |
| Tombol volume fisik HP | mengatur volume PC | — |
| Layar tetap menyala | ✓ | tergantung browser |

Aplikasinya memakai WebView yang memuat halaman remote dari PC-mu, bukan
antarmuka yang ditulis ulang. Artinya perbaikan tampilan cukup dikerjakan
sekali, dan aplikasi ikut mendapatkannya begitu servernya diperbarui —
tanpa perlu memasang ulang APK.

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
Token berubah. Scan ulang QR code yang baru, atau di aplikasi Android pilih
**Lupakan PC ini** lalu pasangkan ulang dengan PIN.

**Aplikasi Android tidak menemukan PC**
Penemuan otomatis memakai UDP broadcast, dan sebagian router memblokirnya.
Ketuk **Masukkan alamat sendiri**, lalu isi alamat IP yang tampil di terminal
PC. Setelah dipasangkan, cara ini tetap bekerja seperti biasa.

**"Aplikasi tidak dapat dipasang" di Android**
APK Taut tidak melewati Play Store, jadi Android memintamu mengizinkannya
secara khusus: *Settings → Apps → Special access → Install unknown apps*, lalu
izinkan aplikasi tempat kamu mengunduh APK (biasanya Chrome atau Files).

<a id="catatan-firefox"></a>
**Ekstensi Firefox hilang setelah browser ditutup**
Itu memang perilaku *Load Temporary Add-on*. Ekstensi yang dipasang permanen
harus ditandatangani Mozilla lebih dulu — proses yang perlu akun pengembang
add-on. Untuk sekarang, muat ulang lewat `about:debugging` setiap kali Firefox
dibuka, atau pakai Chrome yang mengizinkan *Load unpacked* secara permanen.

---

## Keamanan

Server hanya mendengarkan di jaringan lokal, dan setiap remote wajib membawa
token yang tersimpan di `~/.taut/config.json`. Ada dua cara mendapatkannya:

- **QR code** — tokennya memang ada di dalam gambar itu, jadi jangan
  memotretkan layar terminalmu ke orang lain.
- **PIN enam angka** — dipakai aplikasi Android. PIN dibuat ulang setiap server
  dinyalakan, dan setelah lima tebakan salah alamat itu diistirahatkan semenit.

Penemuan otomatis sengaja **tidak** membocorkan token: siapa pun di jaringan
boleh bertanya "ada Taut di sini?", tapi tahu alamat PC bukan berarti boleh
mengendalikannya. Itulah gunanya PIN — hanya orang yang benar-benar duduk di
depan komputer itu yang bisa membacanya.

Ekstensi tidak perlu token karena berjalan di komputer yang sama (loopback).

Mau mencabut semua akses — misalnya setelah meminjamkan HP — hapus
`~/.taut/config.json`, lalu jalankan ulang Taut. Semua perangkat lama harus
dipasangkan ulang.

**Jangan meneruskan port Taut ke internet.** Taut dirancang untuk jaringan
lokal dan tidak memakai enkripsi.

---

## Pengembangan

```bash
npm test          # uji generator QR dan integrasi server
npm run dev       # server dengan log rinci
npm run mock      # ekstensi tiruan, untuk mengutak-atik tampilan tanpa Chrome
npm run build:ext # susun ekstensi untuk Chrome dan Firefox ke dist/
```

`npm run mock` sangat membantu saat mengubah tampilan remote: ia berpura-pura
jadi YouTube Music lengkap dengan lagu berjalan dan tanggapan atas perintah,
jadi kamu tidak perlu login atau memutar musik sungguhan.

### Susunan berkas

```
server/        server penghubung — HTTP, WebSocket, QR, token
  ws.js        implementasi WebSocket (RFC 6455) tanpa dependensi
  qr.js        generator QR code tanpa dependensi
  discovery.js menjawab pertanyaan penemuan lewat UDP
  pairing.js   menukar PIN dengan token
extension/     ekstensi browser (satu sumber, dua varian)
  page.js      satu-satunya berkas yang menyentuh YouTube Music
web/           halaman remote untuk HP (PWA)
android/       aplikasi Android — pembungkus WebView + penemuan PC
build/         penyusun varian ekstensi
test/          uji otomatis + ekstensi tiruan
```

APK dibangun oleh GitHub Actions, bukan di mesin lokal — lihat
`.github/workflows/build.yml`. Untuk membangunnya sendiri butuh JDK 17 dan
Android SDK:

```bash
cd android && gradle assembleRelease
```

### Catatan rancangan

`extension/page.js` membaca keadaan berlapis, dari yang paling stabil ke yang
paling rapuh: elemen `<video>`, lalu `navigator.mediaSession`, baru tombol DOM
YouTube Music. Kalau YouTube mengubah tampilannya, kontrol utama tetap hidup —
yang hilang paling banter indikator acak/ulangi.

`server/ws.js` ditulis sendiri supaya Taut bisa dijalankan langsung setelah
`git clone`, tanpa `npm install`. Cakupannya sengaja sempit: teks JSON,
ping/pong, dan penutupan yang rapi.

Ekstensi menyuntikkan `page.js` lewat tag `<script>` alih-alih memakai
`world: "MAIN"` di manifest. Cara manifest lebih ringkas, tapi hanya berlaku di
Chrome dan Firefox versi baru; penyuntikan berlaku di keduanya sejak lama —
satu jalur kode untuk semua browser.

Aplikasi Android memuat halaman remote dari server, bukan menyalinnya ke dalam
APK. Konsekuensinya disengaja: memperbaiki tampilan cukup di satu tempat, dan
pengguna tidak perlu memasang ulang APK tiap kali ada perbaikan kecil.

**Kunci penandatanganan APK ikut di dalam repositori** (`android/keystore/`)
dengan kata sandi yang tertulis terbuka di `gradle.properties`. Itu disengaja
dan hanya punya satu guna: menjaga agar APK versi baru bisa dipasang menimpa
yang lama. Kunci ini **bukan** bukti keaslian — siapa pun bisa memakainya untuk
menandatangani APK lain. Kalau kamu membangun Taut untuk disebarkan sungguhan,
ganti dengan kunci milikmu sendiri yang tidak pernah dibagikan.

---

## Lisensi

[MIT](LICENSE)
