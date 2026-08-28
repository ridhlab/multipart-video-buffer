# HTTP-FLV Multipart Rolling Buffer Demo

Demo ini memainkan daftar file HTTP-FLV berdurasi 30 detik sebagai satu timeline. Satu custom loader menyimpan raw byte FLV yang sama dengan byte yang diteruskan ke `flv.js`. Sepuluh segmen selesai terakhir (lima menit) dipertahankan di RAM.

## Menjalankan

```bash
npm start
```

Node menyajikan halaman di `http://127.0.0.1:3000` tanpa langsung menjalankan FFmpeg.
Buka URL tersebut, ubah JSON array URL bila perlu, lalu tekan **Connect & play**.
Browser memanggil `POST /api/streams/start` agar Node menjalankan `live/test-000.flv`.
Ketika browser mendeteksi akhir sebuah segmen, halaman
memanggil `POST /api/streams/next` dan Node menjalankan file `test-NNN.flv` berikutnya.
Tekan `Ctrl+C` pada proses Node untuk menghentikan seluruh child process FFmpeg.

Node mengharapkan RTMP server di `rtmp://127.0.0.1:1935/live` dan HTTP-FLV tersedia
di `http://127.0.0.1:8000/live/<stream>.flv`.

Jangan membuka `index.html` melalui `file://`. Server FLV harus mengizinkan origin halaman, misalnya:

```http
Access-Control-Allow-Origin: http://127.0.0.1:3000
```

Jika server memakai `Access-Control-Allow-Origin: *`, request tidak boleh membutuhkan credential/cookie. Halaman HTTPS juga tidak dapat mengambil stream HTTP karena mixed-content blocking.

## Asumsi input

- Setiap URL mengembalikan satu file FLV valid dan mencapai EOF.
- Durasi logis setiap segmen adalah 30.000 ms.
- URL berbeda dan sudah diurutkan sesuai timeline.
- Video menggunakan H.264; audio opsional menggunakan AAC.
- Codec, resolusi, dan parameter track kompatibel antarsegmen.

`flv.js` menangani demux, remux ke fragmented MP4, MediaSource, dan timestamp multipart. `RollingSegmentCache` hanya menyimpan byte FLV asli; byte FLV tidak pernah dimasukkan langsung ke MSE.

## Rolling cache dan seek

Cache disimpan di RAM sebagai kumpulan `Uint8Array`. Setelah segmen ke-11 selesai, segmen selesai paling lama dihapus. Slider aplikasi dibatasi ke timeline 10 segmen terakhir. Jika `flv.js` meminta ulang byte range dari segmen yang masih tersimpan, custom loader memberikannya dari RAM tanpa fetch jaringan baru.

DevTools Network dapat digunakan untuk memastikan setiap URL hanya diminta sekali saat playback maju. Log pada halaman menandai `download complete` dan `served from cache`.

## Tes otomatis

```bash
npm test
```

Tes mencakup penyimpanan chunk, salinan byte independen, range read lintas batas chunk, eviction 10 segmen, validasi URL, clamp seek, forward loader, cache hit, dan abort.

## Checklist perangkat

1. Pastikan ketiga URL membuka response `200` dan masing-masing berakhir setelah sekitar 30 detik.
2. Pastikan request muncul berurutan di DevTools Network.
3. Pastikan video melewati batas 00:30 dan 01:00 tanpa membuat player baru.
4. Setelah lebih dari 10 segmen, pastikan counter tetap `10 / 10` dan retained timeline bergeser.
5. Seek mundur dalam retained timeline dan pastikan log menampilkan cache hit ketika loader meminta ulang data.
6. Tekan Disconnect dan pastikan request aktif berhenti serta ukuran cache kembali `0 B`.

## Verification

- Automated tests: 10/10 lulus pada Node.js 22.21.1 di environment pengembangan.
- Browser/device playback: belum diverifikasi karena membutuhkan endpoint FLV perangkat yang aktif dan browser MSE.
- Codec: belum diketahui; akan dilaporkan melalui event `MEDIA_INFO` saat stream berhasil dimuat.
