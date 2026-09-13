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

- **Windows 10** atau lebih baru — `.NET Framework 4.8` sudah ikut di dalamnya
- **Chrome/Edge/Brave** atau **Firefox**
- HP dan PC tersambung ke **WiFi yang sama**

Tidak perlu memasang Node.js, tidak perlu `npm install`.

---

## Pasang

### 1. Jalankan Taut.exe di PC

Unduh **`Taut.exe`** dari [halaman Releases](https://github.com/Cyserrex/Taut/releases),
simpan di mana saja, lalu klik dua kali.

Taut muncul sebagai ikon di area notifikasi dekat jam. Tidak ada jendela yang
menghalangi, tidak ada terminal. Satu berkas, tanpa pemasangan.

Saat pertama dijalankan, Windows akan bertanya soal firewall — pilih
**Private networks**, lalu **Allow access**. Tanpa itu HP tidak bisa menemukan
PC-mu.

> **Mau Taut menyala sendiri tiap login?** Klik kanan ikonnya →
> **Jalan saat Windows menyala**. Sekali klik, selesai.

<details>
<summary>Atau jalankan dari kode sumber, dengan Node.js</summary>

Server versi Node.js melakukan hal yang sama persis dan bicara protokol yang
identik — itulah yang dipakai untuk pengembangan dan pengujian.

```bash
git clone https://github.com/Cyserrex/Taut.git
cd Taut
npm start
```

Terminal menampilkan QR code, alamat, dan PIN. Jalankan `npm run autostart`
kalau tidak mau mengetiknya tiap kali; lihat
[Menyalakan Taut otomatis](#menyalakan-taut-otomatis).

Jangan menjalankan keduanya bersamaan — keduanya memakai port yang sama.

</details>

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

Firefox menolak memasang ekstensi yang belum ditandatangani Mozilla, jadi
**jangan** menyeret berkas zip ke `about:addons` — yang muncul hanya
*"Pengaya ini tidak dapat dipasang karena belum diverifikasi"*. Pakai jalur
pengembang:

1. Buka `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on**
3. Pilih **`dist/firefox/manifest.json`** — berkas manifest-nya, bukan folder,
   bukan zip
4. Klik ikon Taut, lalu **Izinkan akses YouTube Music**

Ekstensi yang dimuat begini hilang setiap Firefox ditutup. Untuk yang menetap,
lihat [Menandatangani untuk Firefox](#menandatangani-untuk-firefox) di bawah.

Lalu buka **music.youtube.com** dan putar sebuah lagu. Ikon Taut akan
kehilangan tanda `!` begitu tersambung.

### 3. Pilih remote di HP

**Aplikasi Android** — cara paling ringkas
1. Unduh APK dari [halaman Releases](https://github.com/Cyserrex/Taut/releases)
2. Pasang (Android akan meminta izin memasang dari sumber luar)
3. Buka aplikasi — PC-mu muncul sendiri di daftar
4. Ketuk PC itu, masukkan PIN. Selesai, selamanya.

PIN-nya ada di jendela **Hubungkan HP**: klik dua kali ikon Taut di area
notifikasi. (Kalau memakai versi Node.js, PIN tampil di terminal atau lewat
`npm run info`.)

Sesudah ini kamu tidak perlu tahu alamat IP sama sekali. Kalau router
memberi PC alamat baru, aplikasi mencarinya lagi sendiri.

**Lewat browser HP** — tanpa pasang apa pun
Scan QR code di jendela **Hubungkan HP** dengan kamera HP.

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

**Ikon ekstensi tetap bertanda `!`, popup bilang "Server Taut belum ditemukan"**
Servernya belum jalan. Jalankan `npm start`, atau `npm run autostart` supaya
tidak perlu memikirkannya lagi. Kalau server sudah jalan tapi popup masih
merah, portnya berbeda — ubah di popup itu juga.

Ekstensi mencoba menyambung ulang sendiri tiap setengah menit, jadi tunggu
sebentar sebelum menganggapnya gagal.

**Windows menolak menjalankan Taut.exe / peringatan "Unknown publisher"**

Itu **SmartScreen**, bukan deteksi virus. Taut.exe belum ditandatangani dengan
sertifikat berbayar, jadi Windows belum punya dasar untuk mempercayainya —
peringatan yang sama muncul untuk hampir semua program kecil yang baru dirilis.

Klik **More info** → **Run anyway**.

Kalau ingin memeriksa sendiri lebih dulu:

```powershell
Get-FileHash .\Taut.exe -Algorithm SHA256
```

Bandingkan dengan yang tertera di halaman Releases. Kode sumbernya juga ada di
repositori ini, dan `Taut.exe` dibangun GitHub Actions dari kode itu — bukan
diunggah dari komputer pribadi siapa pun.

**Defender benar-benar menghapus berkasnya?**

Itu berbeda dari peringatan SmartScreen di atas, dan berarti heuristik Defender
salah menilai. Taut memang melakukan tiga hal yang mirip perilaku program jahat:
membuka port jaringan, menulis kunci Run untuk autostart, dan berjalan tanpa
jendela. Kombinasi itu wajar dicurigai mesin.

Laporkan sebagai false positive di
[Microsoft Security Intelligence](https://www.microsoft.com/en-us/wdsi/filesubmission) —
biasanya diperbaiki dalam beberapa hari, dan perbaikannya berlaku untuk semua
orang, bukan cuma komputermu.

**Port 8787 sudah dipakai**

Sejak v1.4.0, Taut.exe menyebutkan sendiri siapa yang memakainya — dan kalau
itu server Taut versi Node.js dari pemasangan sebelumnya, ia menawarkan
menghentikannya sekalian.

Untuk memakai port lain:

```bash
Taut.exe --port 9000
```

atau, kalau menjalankan dari kode sumber:

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
**"Pengaya ini tidak dapat dipasang karena belum diverifikasi"**
Sejak Firefox 48, ekstensi yang dipasang permanen wajib ditandatangani Mozilla.
Pemeriksaan ini **tidak bisa dimatikan** di Firefox biasa maupun Beta —
`xpinstall.signatures.required` di `about:config` diabaikan di sana. Mengganti
nama `.zip` jadi `.xpi` juga tidak menolong, karena yang diperiksa isinya.

Tiga jalan keluar:
- **Sekarang juga** — muat lewat `about:debugging` seperti di atas. Hilang saat
  Firefox ditutup.
- **Menetap** — tandatangani sendiri lewat Mozilla; lihat bagian berikutnya.
- **Menetap, tanpa akun** — pakai Firefox **Developer Edition**, **Nightly**,
  atau **ESR**. Hanya di varian itu `xpinstall.signatures.required` bisa
  disetel `false` lewat `about:config`.

**Ekstensi Firefox hilang setelah browser ditutup**
Itu memang perilaku *Load Temporary Add-on*, bukan kerusakan. Pasang versi
bertanda tangan kalau ingin menetap.

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

## Menyalakan Taut otomatis

Ekstensi browser tidak bisa membuka port dan menunggu koneksi masuk — itu batas
platform, bukan pilihan rancangan. Jadi harus ada sesuatu di PC yang
mendengarkan. Yang bisa dihilangkan adalah keharusan mengetik `npm start`.

```bash
npm run autostart
```

Taut langsung menyala, dan ikut menyala setiap kali Windows login. Tidak ada
jendela terminal, tidak ada yang perlu diingat.

```bash
npm run autostart:off      # copot, tidak lagi menyala otomatis
npm run autostart:status    # lihat keadaannya dan letak berkas log
```

Karena tidak ada terminal, QR code dan PIN tidak terlihat. Tanyakan kapan saja:

```bash
npm run info
```

Perintah itu menampilkan QR code, alamat, dan PIN dari server yang sedang
berjalan. Keterangan rahasia hanya dijawab untuk permintaan dari komputer itu
sendiri — dari jaringan, `/api/info` tetap hanya memberi nama dan versi.

**Cara kerjanya.** Windows tidak punya cara langsung menjalankan program konsol
tanpa memunculkan jendelanya, jadi dipakai dua lapis: `Taut.cmd` menjalankan
server sambil mencatat keluarannya ke berkas log, dan `Taut.vbs` di folder
Startup menjalankan `Taut.cmd` dengan jendela tersembunyi. Keduanya menyimpan
jalur `node` secara penuh, karena PATH saat login bisa berbeda dari PATH di
terminalmu — terutama kalau node dipasang lewat nvm.

Kalau Taut tidak jalan setelah login, berkas log inilah satu-satunya petunjuk;
`npm run autostart:status` menunjukkan letaknya.

Di Linux dan macOS pemasang ini tidak berlaku; buat unit `systemd --user` atau
LaunchAgent yang menjalankan `node server/index.js`.

---

## Menandatangani untuk Firefox

Supaya Taut bisa dipasang menetap di Firefox biasa, berkasnya harus
ditandatangani Mozilla. Kanal yang dipakai di sini **"unlisted"**: add-on
ditandatangani tapi tidak dipublikasikan di addons.mozilla.org — tidak ada
tinjauan manusia, tidak ada halaman publik, hanya berkas `.xpi` untukmu sendiri.
Biasanya selesai dalam hitungan menit.

**1. Ambil kredensial** (sekali saja)

1. Buat akun gratis di [addons.mozilla.org](https://addons.mozilla.org/)
2. Buka [halaman API Key](https://addons.mozilla.org/developers/addon/api/key/)
3. **Generate new credentials** → simpan **JWT issuer** dan **JWT secret**

Secret hanya ditampilkan sekali. Jangan menaruhnya di dalam repositori.

**2. Tandatangani**

```bash
npm run sign:firefox
```

Taut akan menanyakan kedua nilainya satu per satu. Ketikan JWT secret sengaja
tidak ditampilkan, dan tidak disimpan ke berkas mana pun — hanya diteruskan ke
proses penandatanganan lewat environment, bukan lewat argumen perintah yang
bisa tersangkut di riwayat shell.

Kalau lebih suka lewat environment sendiri — misalnya di dalam skrip — Taut
memakainya tanpa bertanya:

```bash
WEB_EXT_API_KEY=user:xxxxx:xxx WEB_EXT_API_SECRET=xxxxx npm run sign:firefox
```

Hasilnya berkas `.xpi` di `dist/`.

**3. Pasang**

`about:addons` → ikon gerigi → **Install Add-on From File…** → pilih `.xpi` tadi.
Kali ini Firefox menerimanya, dan ekstensinya tetap ada setelah browser ditutup.

**Otomatis saat rilis**

Simpan kredensial sebagai secret repositori bernama `AMO_API_KEY` dan
`AMO_API_SECRET`. Setiap tag versi yang didorong akan menghasilkan `.xpi`
bertanda tangan dan melampirkannya ke Release. Tanpa secret itu, langkah
penandatanganan dilewati dan sisa build tetap jalan.

> Setiap nomor versi hanya boleh diunggah sekali ke Mozilla. Kalau
> penandatanganan ditolak karena versi ganda, naikkan `version` di
> `package.json`.

Sebelum menandatangani, `npm run lint:ext` menjalankan validator resmi Mozilla.
Kalau ada error di situ, penandatanganan pasti ditolak.

---

## Pengembangan

```bash
npm test          # uji generator QR dan integrasi server
npm run dev       # server dengan log rinci
npm run mock      # ekstensi tiruan, untuk mengutak-atik tampilan tanpa Chrome
npm run build:ext # susun ekstensi untuk Chrome dan Firefox ke dist/
npm run lint:ext  # periksa ekstensi dengan validator resmi Mozilla
npm run info      # QR code, alamat, dan PIN dari server yang sedang berjalan
npm run build:exe # susun windows/ jadi dist/Taut.exe
npm run test:exe  # jalankan uji protokol terhadap Taut.exe
```

`lint:ext` dan `sign:firefox` memanggil `web-ext` lewat `npx`, jadi alat itu
tidak pernah masuk ke `package.json`. Taut tetap bisa dijalankan tanpa
`npm install`.

`npm run mock` sangat membantu saat mengubah tampilan remote: ia berpura-pura
jadi YouTube Music lengkap dengan lagu berjalan dan tanggapan atas perintah,
jadi kamu tidak perlu login atau memutar musik sungguhan.

### Susunan berkas

```
windows/       Taut.exe — server yang sama, ditulis ulang dengan C#
  src/         .NET Framework 4.8, WinForms untuk ikon tray
  build.js     penyusun; halaman remote ikut ditanam ke dalam .exe
  make-icon.js merakit Taut.ico dari PNG beberapa ukuran
  Taut.ico     ikon berkas dan ikon tray, tujuh ukuran
server/        server penghubung — HTTP, WebSocket, QR, token
  ws.js        implementasi WebSocket (RFC 6455) tanpa dependensi
  qr.js        generator QR code tanpa dependensi
  discovery.js menjawab pertanyaan penemuan lewat UDP
  pairing.js   menukar PIN dengan token
  info.js      tampilkan QR dan PIN dari server yang sedang berjalan
extension/     ekstensi browser (satu sumber, dua varian)
  page.js      satu-satunya berkas yang menyentuh YouTube Music
web/           halaman remote untuk HP (PWA)
android/       aplikasi Android — pembungkus WebView + penemuan PC
build/         penyusun varian ekstensi, penandatangan, pemasang autostart
test/          uji otomatis + ekstensi tiruan
```

APK dibangun oleh GitHub Actions, bukan di mesin lokal — lihat
`.github/workflows/build.yml`. Untuk membangunnya sendiri butuh JDK 17 dan
Android SDK:

```bash
cd android && gradle assembleRelease
```

### Dua server, satu protokol

Taut punya dua server yang melakukan hal yang sama persis: satu ditulis dengan
Node.js (`server/`), satu dengan C# (`windows/`). Yang dipakai pengguna adalah
`Taut.exe`, karena tidak menuntut pemasangan Node.js. Yang Node dipakai untuk
pengembangan — lebih cepat diutak-atik, dan berjalan di sistem apa pun.

Duplikasi seperti ini biasanya ide buruk, dan di sini ditahan oleh satu hal:
**berkas uji yang sama dijalankan terhadap keduanya.**

```bash
node test/server.test.js         # terhadap server Node
node test/server.test.js --exe   # terhadap Taut.exe
```

Kalau salah satu menyimpang, uji itu merah. Ekstensi dan aplikasi Android tidak
tahu — dan tidak perlu tahu — sedang bicara dengan yang mana.

Generator QR juga ada dua kali, dan dijaga dengan cara yang sama: uji
membandingkan keluaran C# dengan keluaran JavaScript bit demi bit, dan versi
JavaScript-nya sendiri sudah diverifikasi dengan decoder sungguhan.

### Catatan rancangan

`extension/page.js` membaca keadaan berlapis, dari yang paling stabil ke yang
paling rapuh: elemen `<video>`, lalu `navigator.mediaSession`, baru tombol DOM
YouTube Music. Kalau YouTube mengubah tampilannya, kontrol utama tetap hidup —
yang hilang paling banter indikator acak/ulangi.

`server/ws.js` ditulis sendiri supaya Taut bisa dijalankan langsung setelah
`git clone`, tanpa `npm install`. Cakupannya sengaja sempit: teks JSON,
ping/pong, dan penutupan yang rapi. Versi C#-nya sama sempitnya.

`Taut.exe` memakai `TcpListener` mentah, bukan `HttpListener` bawaan .NET.
`HttpListener` menuntut pendaftaran URL ACL untuk mendengarkan di alamat selain
localhost, yang berarti Taut harus dijalankan sebagai administrator — untuk
sebuah remote musik, itu harga yang tidak masuk akal.

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
