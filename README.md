# HTTP-FLV Multipart Rolling Buffer Demo

Demo browser untuk memainkan beberapa HTTP-FLV sebagai satu timeline, menyimpan raw
byte FLV di RAM, dan memutar hasil remux melalui `flv.js`, Media Source Extensions
(MSE), dan elemen HTML `<video>`.

Browser juga menjadi pengontrol FFmpeg. Saat **Connect & Play** ditekan, browser
meminta Node membuka file FLV pertama. Ketika sebuah segmen dianggap selesai,
browser meminta Node membuka file berikutnya dari playlist.

## Arsitektur

```text
Browser
  POST /open-stream { filename }
        |
        v
Node controller (127.0.0.1:3000)
  menjalankan FFmpeg -re -c copy
        |
        v
RTMP server (127.0.0.1:1935)
        |
        v
HTTP-FLV endpoint (127.0.0.1:8000)
        |
        v
CachedFetchLoader -> raw FLV cache
        |
        v
flv.js -> demux -> remux fMP4 -> MSE -> <video>
```

`RollingSegmentCache` menyimpan salinan `Uint8Array` raw FLV. Raw FLV tidak dapat
langsung dimasukkan ke MSE; `flv.js` melakukan demux dan remux menjadi fragmented
MP4 sebelum data ditambahkan ke `SourceBuffer`.

## Prasyarat

- Node.js yang mendukung ES modules dan built-in `fetch`.
- FFmpeg tersedia melalui command `ffmpeg`.
- RTMP server listen di `rtmp://127.0.0.1:1935/live`.
- Server tersebut menyediakan HTTP-FLV di
  `http://127.0.0.1:8000/live/<stream-name>.flv`.
- Browser mendukung Media Source Extensions.
- Koneksi internet untuk memuat `flv.js` dari CDN yang digunakan `index.html`.

## Menyiapkan file FLV

Simpan file input di direktori `live/` dengan pola nama berikut:

```text
live/test-000.flv
live/test-001.flv
live/test-002.flv
```

Node membaca daftar file saat server dimulai. File yang ditambahkan setelah
`npm start` tidak tersedia sampai server direstart.

Direktori `live/` masuk `.gitignore`, sehingga file video lokal tidak diunggah ke
repository.

Input antarsegmen sebaiknya menggunakan codec dan parameter track yang kompatibel:

- Video H.264/AVC.
- Audio AAC, atau tanpa audio.
- Resolusi, audio sample rate, dan konfigurasi codec konsisten.
- Setiap file dimulai dengan keyframe yang sesuai untuk perpindahan segmen.

## Menjalankan

Pastikan RTMP/HTTP-FLV server sudah aktif, lalu jalankan controller:

```bash
npm start
```

Node listen di:

```text
http://127.0.0.1:3000
```

Saat Node baru hidup, belum ada proses FFmpeg. Buka halaman lalu tekan
**Connect & Play**. Browser akan memanggil `/open-stream` untuk file pertama.

Frontend dapat disajikan oleh Node di port `3000`, atau oleh development server
lokal lain seperti port `8080`. API controller tetap berada di port `3000`.
Jangan membuka halaman melalui `file://`.

Tekan `Ctrl+C` pada proses Node untuk menghentikan server dan semua child process
FFmpeg yang masih aktif.

## Format playlist

Playlist ditulis sebagai JSON array. `duration` menggunakan satuan detik dan dapat
berbeda untuk setiap segmen:

```json
[
  {
    "url": "http://127.0.0.1:8000/live/test-000.flv",
    "duration": 15
  },
  {
    "url": "http://127.0.0.1:8000/live/test-001.flv",
    "duration": 15
  },
  {
    "url": "http://127.0.0.1:8000/live/test-002.flv",
    "duration": 15
  }
]
```

Nama file terakhir pada URL harus cocok dengan file yang tersedia di direktori
`live/`. URL harus berbeda dan diurutkan sesuai timeline playback.

## API membuka stream

Node menyediakan satu endpoint:

```http
POST /open-stream
Content-Type: application/json

{
  "filename": "test-000.flv"
}
```

Contoh dengan `curl`:

```bash
curl \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"filename":"test-000.flv"}' \
  http://127.0.0.1:3000/open-stream
```

Node memvalidasi filename terhadap file `live/test-NNN.flv` yang ditemukan saat
startup. Path seperti `../video.flv` dan nama yang tidak ada dalam allowlist akan
ditolak.

Untuk file `test-000.flv`, Node menjalankan command ekuivalen berikut tanpa shell:

```bash
ffmpeg \
  -re \
  -i ./live/test-000.flv \
  -c copy \
  -f flv \
  rtmp://127.0.0.1:1935/live/test-000
```

Filename yang sama hanya dibuka sekali dalam satu sesi Node untuk mencegah trigger
ganda. Restart `npm start` jika ingin mengulang playlist yang sama dari awal.

## Urutan trigger browser

1. **Connect & Play** memanggil `/open-stream` untuk URL playlist pertama.
2. Node menjalankan FFmpeg untuk filename tersebut.
3. `flv.js` meminta HTTP-FLV dan meneruskan raw chunk melalui custom loader.
4. Custom loader menyimpan chunk di cache sekaligus meneruskannya ke `flv.js`.
5. Browser memantau batas akhir `video.buffered`.
6. Ketika buffer berada maksimal 2 detik sebelum akhir logis segmen dan tidak
   bertambah selama 1 detik, segmen dianggap selesai.
7. Browser memanggil `/open-stream` untuk filename berikutnya.
8. Setelah Node menerima trigger, loader lama diselesaikan dan `flv.js` membuka URL
   HTTP-FLV berikutnya.

Pada segmen terakhir, browser tidak membuka file baru dan hanya menyelesaikan loader
aktif.

## Raw cache dan seek

Cache dipertahankan berdasarkan durasi total maksimal lima menit:

```js
const MAX_CACHE_DURATION_MS = 5 * 60 * 1000;
```

Saat batas tersebut terlewati, segmen selesai yang paling lama dikeluarkan dari raw
cache. Selama data masih tersimpan, custom loader dapat melayani byte range dari RAM
tanpa fetch jaringan baru.

`video.buffered` dan raw cache adalah dua hal berbeda:

- Raw cache berisi byte container FLV asli dari jaringan.
- `video.buffered` menunjukkan rentang fMP4 yang telah diproses `flv.js` dan berhasil
  ditambahkan ke MSE.

`autoCleanupSourceBuffer: false` digunakan agar browser tidak otomatis membersihkan
rentang MSE selama demo. Browser tetap dapat menerapkan batas memorinya sendiri.

## Port dan CORS

| Komponen | Alamat default |
|---|---|
| Node controller/API | `http://127.0.0.1:3000` |
| Frontend alternatif | `http://127.0.0.1:8080` |
| RTMP ingest | `rtmp://127.0.0.1:1935/live` |
| HTTP-FLV playback | `http://127.0.0.1:8000/live` |

Endpoint `/open-stream` mengizinkan origin HTTP lokal dengan hostname `127.0.0.1`
atau `localhost`. Server HTTP-FLV juga harus mengizinkan origin frontend, misalnya:

```http
Access-Control-Allow-Origin: http://127.0.0.1:8080
```

Jika halaman disajikan melalui HTTPS tetapi stream masih HTTP, browser dapat
memblokir request sebagai mixed content.

## Menjalankan test

```bash
npm test
```

Test mencakup parsing playlist, continuous timeline, raw chunk cache, range read,
eviction lima menit, custom loader, forced completion, controller FFmpeg, validasi
filename, endpoint `/open-stream`, dan CORS preflight.

## Troubleshooting

### `CodecUnsupported: Unsupported codec in video frame: 2`

Video menggunakan codec FLV1/Sorenson Spark. Konversikan video menjadi H.264 dan
audio menjadi AAC sebelum digunakan oleh `flv.js`.

### Request `/open-stream` terkena CORS

Pastikan Node controller berjalan di port `3000` dan frontend berasal dari origin
HTTP lokal seperti `http://127.0.0.1:8080`. Restart Node setelah mengubah server.

### HTTP-FLV mengembalikan 404 atau tidak dapat diputar

Pastikan RTMP/HTTP-FLV server sudah aktif dan nama stream sama persis dengan basename
file, tanpa ekstensi. `test-001.flv` dipublish sebagai `/live/test-001` dan dimainkan
melalui `/live/test-001.flv`.

### Trigger mengembalikan `already-opened`

Filename tersebut sudah pernah dijalankan dalam sesi Node saat ini. Restart Node
untuk memulai ulang playlist yang sama.

### `reader.read()` tidak pernah menghasilkan `done: true`

Beberapa HTTP-FLV server mempertahankan koneksi walaupun FFmpeg input sudah mendekati
akhir. Demo menggunakan `video.buffered`, toleransi akhir dua detik, dan stabilitas
satu detik untuk menyelesaikan loader secara terkontrol.

## Catatan operasional

- Tombol **Disconnect** menghancurkan player dan menghapus raw cache browser, tetapi
  tidak menghentikan FFmpeg di Node.
- `Ctrl+C` pada Node menghentikan semua child process FFmpeg yang masih aktif.
- Cache berada di RAM dan hilang saat halaman direload atau player di-disconnect.
- `.DS_Store` dan direktori `live/` diabaikan oleh Git.
