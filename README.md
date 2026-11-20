# rocket_simulator

Starbase Flight Control — simulator Three.js dengan HUD existing, kamera, dan dua monitor penerbangan.

Jalankan `python3 -m http.server 8000` dari folder proyek lalu buka **http://localhost:8000/**. Halaman utama adalah `index.html` asli, yang menggunakan `js/main.js`, `js/world.js`, `js/config.js`, `js/audio.js`, dan `style.css`. Server statis ini tidak memerlukan React atau Vite.

## Lingkungan

Klik **World: Simulator**, masukkan key, lalu **Simpan & buka 3D**. Key disimpan pada `localStorage` browser, tidak di source repository. Gunakan origin `http://localhost:8000` yang sama untuk mempertahankan pengaturan. Untuk menghapus key: `localStorage.removeItem('starbase.googleMapsKey')` di DevTools lalu reload. Penggantian key setelah Maps JS termuat membutuhkan reload.

Ada dua layanan terpisah:

- **Maps JavaScript 3D**: renderer Google live di area kamera utama; model PBR roket dan menara existing diekspor ke glTF Blob sementara di browser. Posisi wahana, flap, carriage, chopsticks, dan QD mengikuti simulator. Monitor kanan tetap menampilkan renderer Three.js dengan plume/gimbal asli. Model Google tidak membawa shader plume, efek bloom, atau cutaway dinamis.
- **Photorealistic 3D Tiles / Map Tiles API**: terrain di scene Three.js jika key memiliki izin layanan ini. Uji key demo yang diberikan pada November 2026 mengembalikan HTTP 403 untuk Tiles, sedangkan library Maps JS 3D dapat dimuat di localhost. Ini bukan jaminan akses layanan lain atau penggunaan produksi; konfigurasi key hanya dapat dipastikan pemilik project Google Cloud.

Tidak ada scraping, penggantian referrer, atau penyimpanan tile Google ke repository. Atribusi Google tetap ditampilkan oleh renderer. Kualitas detail Starbase mengikuti cakupan data Google, bukan model CAD lokasi aktual.

Menara ditempatkan dalam kerangka lokal Starbase (25.997° N, 97.156° W), bukan survei elevasi pad. Jika kunci tidak ada, pemuatan awal gagal, atau belum ada tile setelah 22 detik, simulator memakai lingkungan lokal. Kamera **Orbit Bumi** menggunakan tekstur satelit 8192×4096 lokal, relief dan pantulan laut; tidak memerlukan koneksi Google.

## Penggunaan

Gunakan panel peluncuran atau pilih fase misi. HUD asli meliputi telemetri, panel gimbal, klaster mesin, dua monitor, kamera, timeline, dan time warp. Skenario yang tersedia termasuk pendaratan booster di ASDS dan penangkapan Starship oleh Mechazilla.

Monitor ditumpuk di kanan; **Monitor ON/OFF** mengatur keduanya, **Perbesar** mengubah ukurannya, dan **HUD ON/OFF** menyembunyikan panel kontrol/telemetri. Kamera utama memakai area tersendiri di antara panel dan framing full-body saat memilih kamera. Pada layar kecil, HUD dimulai tersembunyi dan dapat dibuka kembali. Kamera Engine TVC sengaja merupakan close-up.

Starbase memang berada di pesisir Boca Chica, Texas. Pad berada di daratan: fallback menampilkan apron persegi, jalan akses, tangki, dan daratan sampai garis pantai; tidak memindahkan lokasi geografis ke pedalaman.

Tambahan berada di panel existing: **Latihan Booster Catch · Fisika** dan **Cutaway Starship**. Latihan catch memakai integrasi 90 Hz, konsumsi propelan, drag, gravitasi, aktuator gimbal dengan batas laju, dan torsi dari titik mesin. Kontak perlu kedua pin di atas bantalan serta kecepatan vertikal rendah; pendekatan manual dapat gagal. Reset memulihkan tampilan stack.

Skala render 1:10 diterapkan ke scene dan kamera render; state fisika, kamera interaktif, dan HUD tetap dalam meter. Tinggi booster termasuk ring adalah 69 m dan ship 55 m (total 124 m). Nozzle booster menggunakan InstancedMesh; plume tetap mengikuti pivot masing-masing. Bloom hanya pada kamera utama agar dua monitor tetap ringan. Terrain fallback adalah pesisir prosedural, bukan peta survei.

Ini model pendidikan dengan parameter guidance dan propelan ilustratif, bukan rekonstruksi telemetri. Fase orbit/deorbit pada timeline lama masih visualisasi waktu terkompresi; belum simulator orbit enam derajat kebebasan. Jadwal historis tidak menentukan keberhasilan penangkapan berbasis kontak.

## Kredit aset lokal

- `earth.jpg`: [Solar System Scope, Earth day map](https://www.solarsystemscope.com/textures/), CC BY 4.0, berbasis citra NASA.
- `relief.jpg` dan `water.png`: [WebGL Earth demo assets](https://github.com/turban/webgl-earth/tree/master/images), relief dan water mask.
- `sky.hdr`: [Kloofendal 48d Partly Cloudy (Pure Sky), Poly Haven](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky), CC0.
- Tiles dan atribusi penyedia ditampilkan saat data Google aktif.

## Referensi layanan dan lokasi

- [Google Maps JavaScript 3D](https://developers.google.com/maps/documentation/javascript/3d/overview)
- [Model3DElement / model glTF](https://developers.google.com/maps/documentation/javascript/3d/models)
- [Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles)
- [FAA — Boca Chica launch site](https://www.faa.gov/space/stakeholder_engagement/spacex_starship)

Build opsional: `npm install`, `npm run build`; hasil di `dist/`. Server statis di atas tetap jalur utama. Tidak ada aplikasi React terpisah.
