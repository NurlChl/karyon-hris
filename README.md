<div align="center">

<img src="public/brand/karyon-logo.webp" alt="Karyon" height="72" />

# Karyon HRIS

**HRIS self-hosted untuk perusahaan Indonesia.** Presensi foto dan GPS, cuti, payroll BPJS dan PPh 21, KPI, rekrutmen, dan inventaris, dijalankan di server milik perusahaan Anda sendiri.

[Website](https://karyon.lifistudio.com/) · [Dokumentasi](https://karyon.lifistudio.com/docs) · [Fitur](https://karyon.lifistudio.com/features) · [Harga](https://karyon.lifistudio.com/pricing) · [Blog](https://karyon.lifistudio.com/blog)

</div>

---

## Kenapa Karyon HRIS

- **Data tetap di server Anda.** Database, lampiran, dan kunci enkripsi tidak pernah dikirim ke server kami. Server lisensi hanya menerima identitas instalasi, alamat website, dan status langganan.
- **Gratis untuk mulai.** Edisi Community gratis selamanya, tanpa batas jumlah karyawan.
- **Bayar per instalasi, bukan per karyawan.** Edisi Pro dibayar per alamat website HRIS, bulanan atau tahunan.
- **Upgrade tanpa instal ulang.** Tempel license key di aplikasi, jalankan satu perintah, dan fitur Pro aktif. Data, akun, dan kunci tidak berubah. Jika langganan berakhir, aplikasi kembali ke Community tanpa menghapus data.
- **Satu perintah untuk memasang.** Installer menyiapkan PostgreSQL 18, secret acak, health check, dan akun superadmin pertama.

## Fitur

| Fitur | Community | Pro |
| --- | :---: | :---: |
| Presensi foto, GPS, dan radius cabang | ✓ | ✓ |
| Monitor hadir, belum absen, alpha, dan notifikasi | ✓ | ✓ |
| Cuti, izin, jadwal, shift, dan tukar libur | ✓ | ✓ |
| Payroll dasar, BPJS, PPh 21, dan slip gaji | ✓ | ✓ |
| KPI, kontrak, rekrutmen (pipeline drag & drop), inventaris (scan barcode lewat kamera) | ✓ | ✓ |
| Ekspor Excel/CSV dan impor CSV | ✓ | ✓ |
| Multi-cabang dan analitik lanjutan | | ✓ |
| Face recognition dengan anti-spoof | | ✓ |
| Payroll lanjutan dan simulator kebijakan | | ✓ |
| Workflow disiplin (SP, pembinaan, PHK) | | ✓ |
| REST API dengan API key dan webhook | | ✓ |
| Backup, update, dan rollback otomatis (agent, server Linux) | | ✓ |
| Logo perusahaan sendiri di dashboard, portal, dan halaman masuk | | ✓ |
| Dukungan | Komunitas & dokumentasi | Email hari kerja |

Daftar lengkap dan perbandingannya ada di [halaman fitur](https://karyon.lifistudio.com/features).

## Instalasi cepat

Prasyarat: Docker Engine 24+ atau Docker Desktop, Docker Compose 2.24+. Aplikasi hanya terikat ke `127.0.0.1` sampai Anda memasang reverse proxy HTTPS di depannya.

**Linux dan macOS**

```sh
curl -fsSL https://karyon.lifistudio.com/install.sh | sh
```

**Windows (PowerShell)**

```powershell
& ([scriptblock]::Create((Invoke-RestMethod "https://karyon.lifistudio.com/install.ps1")))
```

Installer mengambil file compose, membuat `.env` berisi secret acak (mode 600), menjalankan PostgreSQL 18 dan HRIS, menunggu health check, lalu menampilkan password superadmin pertama **satu kali**. Buka `http://localhost:3000/auth/admin` dan segera ganti password tersebut.

Untuk domain produksi:

```sh
curl -fsSL https://karyon.lifistudio.com/install.sh | sh -s -- --url https://hr.perusahaan.co.id --trust-proxy 1
```

Panduan per sistem operasi, database eksternal, Dokploy, dan pemecahan masalah ada di [dokumentasi instalasi](https://karyon.lifistudio.com/docs#install). Anda juga bisa membaca isi skrip sebelum menjalankannya: [install.sh](https://karyon.lifistudio.com/install.sh) · [install.ps1](https://karyon.lifistudio.com/install.ps1).

### Menjalankan ulang dan memperbarui

Menjalankan installer lagi di folder yang sama **tidak mengubah kunci di `.env`**. Installer hanya memperbarui file compose, menarik image terbaru, dan me-restart aplikasi.

### Upgrade ke Pro

1. Beli lisensi di [halaman harga](https://karyon.lifistudio.com/pricing). License key muncul di dashboard pelanggan setelah pembayaran terkonfirmasi.
2. Di HRIS, buka **Lisensi & Paket**, tempel license key, lalu klik **Aktifkan**.
3. Klik **Buat perintah upgrade** dan jalankan perintah yang ditampilkan di folder instalasi. Kode berlaku 15 menit dan hanya untuk instalasi tersebut.

Installer menukar kode menjadi kredensial pull khusus instalasi, beralih ke image Pro, lalu memeriksa kesehatan aplikasi. Jika pull atau health check gagal, image sebelumnya dipulihkan otomatis. License key bisa diganti atau dilepas dari menu yang sama saat pindah server.

Opsi `--lifecycle` (Pro, khusus Linux) menambahkan agent untuk backup, update, dan rollback terjadwal. Agent memerlukan akses Docker socket, jadi opsi ini mati secara default.

## Logo

Community dan Pro memakai logo Karyon bawaan dari `public/brand/`:

| File | Dipakai untuk |
| --- | --- |
| `karyon-logo.webp` | Logo tema terang (sidebar, halaman masuk, beranda) |
| `karyon-logo-dark.webp` | Logo tema gelap |
| `karyon-mark.webp` | Simbol untuk ruang sempit (karier, dokumentasi) |
| `karyon-icon.png`, `karyon-apple-icon.png`, `src/app/favicon.ico` | Favicon dan ikon aplikasi |

Ganti file-file tersebut (nama sama) untuk mengubah logo bawaan pada rilis berikutnya; Community tidak menyediakan pengaturan logo. Pada HRIS Pro dengan lisensi aktif, superadmin dapat mengunggah logo perusahaan di **Admin → Logo & Tampilan**. Bila lisensi berakhir, logo bawaan tampil kembali dan logo yang diunggah tetap tersimpan.

## Keamanan

- Database memakai role aplikasi yang **bukan superuser** dan tidak membuka port ke host.
- Data sensitif karyawan dienkripsi dengan `ENCRYPTION_KEY`. Simpan `.env` bersama backup database dan lampiran; backup tanpa kunci tidak bisa dipulihkan.
- Fitur Pro diverifikasi dengan lease bertanda tangan, bukan variabel environment, sehingga tidak bisa diaktifkan dengan mengubah konfigurasi.
- `TRUST_PROXY` menentukan jumlah proxy tepercaya (1 untuk Traefik/nginx, 2 untuk Cloudflare → Traefik). IP klien untuk rate limit dan audit diambil dari entri `X-Forwarded-For` milik proxy tersebut.

Temukan celah keamanan? Laporkan secara privat melalui [halaman kontak](https://karyon.lifistudio.com/contact), jangan lewat issue publik.

## Backup dan pemulihan

```sh
docker compose exec -T postgres pg_dump -U postgres -Fc hris > hris-$(date +%F).dump
```

Cadangkan juga `.env` dan volume `uploads`. Gunakan tag atau digest image yang tetap, backup sebelum update, dan uji proses restore secara berkala. Rollback image tidak membatalkan perubahan schema database.

## Development

Prasyarat: Node.js 24 LTS, npm, dan PostgreSQL 18.

```sh
npm ci
node scripts/setup-env.mjs     # hanya bila .env belum ada
# Isi HRIS_DATABASE_URL (atau HRIS_DB_*) dan NEXTAUTH_URL di .env
npm run db:migrate
npm run seed
npm run dev
```

Akun bootstrap memakai `SEED_ADMIN_EMAIL` di http://localhost:3000/auth/admin. Password berasal dari `.env`, dan seed tidak mereset akun yang sudah ada. Dataset demo 200 karyawan tersedia untuk pengujian: `npm run seed:demo:plan`, lalu `npm run seed:demo`.

### Docker dari source

```sh
node scripts/setup-env.mjs
docker compose up -d --build
docker compose exec app node db-seed.cjs
```

Compose membuat PostgreSQL 18 terpisah pada volume `postgres18_data`. Jangan menjalankan `docker compose down -v` kecuali memang ingin menghapus seluruh data dan lampiran. Instalasi lama dengan PostgreSQL 17 perlu dipindahkan manual (dump → database baru → restore).

### Pemeriksaan

```sh
npm run typecheck
npm run lint
npm run build
npm run test:postgres
npm run test:security
npm run test:barcode
```

### Struktur

| Folder | Isi |
| --- | --- |
| `src/` | Aplikasi Next.js (App Router): halaman admin, portal karyawan, dan API `/api/v1` |
| `packages/database` | Lapisan SQL milik aplikasi (model, schema, migrasi) |
| `scripts/` | Migrasi, seed, dan build |
| `install.sh`, `install.ps1`, `compose.*.yml` | Installer dan file compose yang disajikan website |
| `installer-manager/` | Sidecar kecil yang menukar kode upgrade Pro |
| `storage/` | Berkas privat saat development (tidak masuk Git) |

Setelah mengubah `install.sh`, `install.ps1`, atau file compose, jalankan `node scripts/sync-installer.mjs` di folder `website/` agar versi yang disajikan website ikut diperbarui.

## Deploy di Dokploy

Ikuti [panduan Dokploy Raw Compose](docs/DOKPLOY-RAW-COMPOSE.md) atau bagian [Instalasi Dokploy](https://karyon.lifistudio.com/docs#dokploy) di dokumentasi. Pasang domain ke service `app` port `3000`, aktifkan HTTPS, isi `NEXTAUTH_URL` sesuai domain, dan `TRUST_PROXY=1`.

## Catatan pengelola

- Implementasi Pro berada di modul privat terpisah. Repository ini hanya memuat edisi Community beserta tipe kompatibilitas dan endpoint penolakan fitur Pro.
- Jangan mempublikasikan repository ini atau history Git workspace lama sebelum ekstraksi modul Pro dan review ekspor selesai. `private: true` di `package.json` tidak membuat repository GitHub menjadi private.
- Sebelum push, periksa `git status` dan pastikan `.env`, storage, dump, kunci, serta kredensial tidak ikut masuk Git.

---

<div align="center">

[karyon.lifistudio.com](https://karyon.lifistudio.com/) · [Blog](https://karyon.lifistudio.com/blog) · [Kontak](https://karyon.lifistudio.com/contact)

</div>
