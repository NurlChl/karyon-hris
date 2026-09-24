# HRIS — aplikasi perusahaan

Proyek mandiri: jalankan seluruh perintah di folder ini. Tidak memerlukan folder website atau agent untuk mode Community.

> Status publikasi: **gunakan repository private dahulu sampai lisensi open-source dan review ekspor diputuskan**. Implementasi Pro yang tersedia telah dipindahkan ke modul privat; folder ini mempertahankan model/tipe kompatibilitas dan endpoint penolakan fitur Pro, bukan mesin Pro. Jangan mempublikasikan history Git workspace lama karena masih dapat berisi source privat (commit awal repository ini masih memuatnya). `private: true` di package.json tidak membuat repository GitHub otomatis private.

Community tidak mengaktifkan Pro melalui environment bypass. Slip payroll yang sudah diterbitkan tetap dapat dibaca; kalkulasi payroll lanjutan, biometrik, kasus disiplin, multi-cabang, analitik lanjutan, API key/webhook, dan scheduler memerlukan distribusi Pro. Monitor kehadiran + notifikasi, ekspor Excel/CSV, dan impor CSV tersedia di Community. Dataset demo dapat memuat data historis Pro untuk uji kompatibilitas; keberadaan data bukan akses ke mesinnya. Untuk upgrade, gunakan image Pro dan pertahankan database, volume upload serta seluruh kunci enkripsi.

## Instalasi cepat (Docker)

Prasyarat: Docker Engine 24+ atau Docker Desktop, Docker Compose 2.24+, `curl`, `openssl`. Linux/macOS/WSL.

Installer meniru quick start AnythingMCP: mengambil `compose.image.yml`, membuat `.env` berisi secret acak (mode 600), menjalankan PostgreSQL 18 + HRIS, menunggu health check, lalu membuat superadmin pertama dengan password acak yang ditampilkan **sekali**. Aplikasi hanya terikat ke `127.0.0.1` sampai Anda menaruh reverse proxy HTTPS di depannya.

```sh
# Pelanggan: installer disajikan website lisensi (alamat server lisensi dan image Community sudah terisi).
curl -fsSL https://LICENSE-WEBSITE/install.sh | sh -s -- --url https://hr.perusahaan.co.id --trust-proxy 1

# Dari checkout source ini (image dibangun lokal):
sh install.sh --build .

# Dari image yang Anda publikasikan sendiri:
sh install.sh --image ghcr.io/OWNER/hris:VERSION --license-server https://LICENSE-WEBSITE
```

### Upgrade ke Pro (distribusi hibrida)

1. Superadmin membuka **Lisensi & Paket**, menempel license key, klik **Aktifkan**. Aplikasi memanggil `HRIS_LICENSE_SERVER` langsung (tanpa agent); installation id, activation secret, dan lease bertanda tangan disimpan terenkripsi (`ENCRYPTION_KEY`) di tabel pengaturan.
2. Klik **Buat perintah upgrade**. Server lisensi membuat kode sekali pakai (15 menit) yang terikat ke instalasi dan lisensi aktif.
3. Jalankan perintah di folder instalasi: `curl -fsSL https://LICENSE-WEBSITE/install.sh | sh -s -- --upgrade-code XXXX-XXXX-XXXX-XXXX`. Installer menukar kode menjadi kredensial pull khusus instalasi (`docker login --password-stdin`), mengganti `HRIS_IMAGE` ke image Pro di registry privat, menyimpan image lama di `HRIS_PREVIOUS_IMAGE`, lalu pull + restart. Jika pull atau health check gagal, image sebelumnya dipulihkan otomatis.

Registry privat hanya memberi token pull 5 menit selama lisensi aktif, sehingga kredensial yang bocor tidak berguna setelah langganan berakhir. Build Pro memverifikasi lease dengan public key yang ditanam saat perakitan, sehingga lease palsu tidak membuka fitur.

- Menjalankan ulang installer di folder yang sama **tidak mengubah kunci di `.env`**; hanya memperbarui compose, pull image, dan restart (jalur update).
- `--lifecycle` (Pro, Linux) menambah agent backup/update/rollback otomatis melalui `compose.lifecycle.yml` dengan Docker socket. Socket setara akses root host; default-nya mati. Agent membaca lease dari aplikasi (`/api/v1/license/lease`, Bearer `HRIS_AGENT_TOKEN`) dan memverifikasinya sendiri.
- File compose: `compose.image.yml` (dasar, Community dan Pro) dan `compose.lifecycle.yml` (opt-in). `COMPOSE_FILE` di `.env` menentukan gabungannya, jadi cukup `docker compose ps|logs|up -d` di folder instalasi.
- Database memakai role aplikasi **bukan superuser**; password superuser (`POSTGRES_ADMIN_PASSWORD`) tidak masuk container aplikasi. Database tidak membuka port ke host.
- Setelah mengubah `install.sh` atau compose, jalankan `node scripts/sync-installer.mjs` di folder `website/` agar versi yang disajikan website ikut diperbarui (`--check` untuk CI).

## Development lokal

Prasyarat: Node.js 24 LTS, npm, dan PostgreSQL 18. Server PostgreSQL existing tidak di-upgrade otomatis; lihat [upgrade PostgreSQL 18](../docs/UPGRADE-POSTGRESQL-18.md).

```sh
npm ci
node scripts/setup-env.mjs
# Edit .env: HRIS_DATABASE_URL atau HRIS_DB_*, serta NEXTAUTH_URL.
npm run db:migrate
npm run seed
npm run dev
```

Jika `.env` sudah ada, jangan jalankan setup ulang. Akun bootstrap: `SEED_ADMIN_EMAIL` (default `admin@hris.com`) di http://localhost:3000/auth/admin. Akun demo karyawan `budi@hris.com` (http://localhost:3000/auth/login) hanya dibuat di luar produksi bila `SEED_STAFF_PASSWORD` diisi. Password berasal dari `.env`, bukan password universal. Seed tidak mereset akun existing. Dataset 200 karyawan hanya untuk pengujian: `npm run seed:demo:plan`, lalu `npm run seed:demo`.

## Docker lokal — build source repository ini

```sh
node scripts/setup-env.mjs
# Review .env, jangan mengganti kunci pada instalasi existing. Pastikan POSTGRES_ADMIN_PASSWORD terisi.
docker compose up -d --build
docker compose exec app node db-seed.cjs   # memakai SEED_ADMIN_* dari .env (env_file)
```

Buka http://localhost:3000. Compose membuat PostgreSQL 18 terpisah pada volume `postgres18_data`; tidak memakai database remote dari HRIS_DATABASE_URL. Migrasi dijalankan saat container mulai; seed akun dijalankan secara eksplisit (aman di produksi: hanya data dasar + superadmin). Port aplikasi terikat loopback secara default.

`LOCAL_STORAGE_PATH=/app/storage` memakai volume `uploads`. Jangan menjalankan `docker compose down -v` kecuali memang hendak menghapus seluruh data dan lampiran instalasi ini.

Instalasi lama dengan PostgreSQL 17 (volume `postgres_data`) tidak dipindahkan otomatis. Ikuti [panduan upgrade](../docs/UPGRADE-POSTGRESQL-18.md): dump → database 18 baru → restore.

## Dokploy

### Git/source

1. Push isi proyek ini ke repository **private**. Hubungkan akses GitHub pada Dokploy.
2. Buat layanan Docker Compose dengan repository ini sebagai root dan path `compose.yml`.
3. Isi environment dari `.env.example` (termasuk `POSTGRES_ADMIN_PASSWORD`); sediakan `.env` untuk `env_file` sesuai konfigurasi deployment Dokploy. Untuk workflow tanpa file `.env`, gunakan metode image di bawah.
4. Pasang domain Dokploy ke service `app`, port container `3000`, aktifkan HTTPS, isi `NEXTAUTH_URL` sesuai domain dan `TRUST_PROXY=1` (Traefik Dokploy).
5. Jalankan seed sekali melalui terminal container: `SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... node db-seed.cjs`.

### Raw Compose / image

Build dan push image milikmu lebih dahulu (ganti OWNER dan VERSION):

```sh
docker build -t ghcr.io/OWNER/hris:VERSION .
docker push ghcr.io/OWNER/hris:VERSION
```

Salin isi `compose.image.yml` ke editor Compose Dokploy. Isi `HRIS_IMAGE=ghcr.io/OWNER/hris:VERSION` dan seluruh environment wajib yang tercantum di Compose. Konfigurasikan akses registry jika image private. Jangan mengubah image menjadi public sebelum pemisahan Pro selesai. Untuk Pro, isi `HRIS_IMAGE` dengan image Pro dan konfigurasikan kredensial registry dari kode upgrade (lihat di atas); aktivasi lisensi tetap dari menu Lisensi & Paket.

## Reverse proxy dan IP klien

`TRUST_PROXY` adalah jumlah proxy tepercaya di depan aplikasi (1 untuk Traefik/nginx, 2 untuk Cloudflare → Traefik). IP klien untuk rate limit dan audit diambil dari entri `X-Forwarded-For` yang ditambahkan proxy tersebut, bukan entri paling kiri yang bisa dipalsukan. Tanpa proxy, biarkan `0`.

## Backup, update, rollback

Gunakan backup PostgreSQL dan volume Dokploy/server. Simpan juga `.env`/kunci enkripsi secara aman di luar repository. Backup database tanpa kunci enkripsi dan lampiran belum cukup untuk pemulihan lengkap. Gunakan tag/digest image yang tetap, backup sebelum migrasi, dan uji restore. Rollback image tidak membatalkan perubahan schema database.

```sh
docker compose exec -T postgres pg_dump -U postgres -Fc hris > hris-$(date +%F).dump
```

Agent tidak dibutuhkan untuk lisensi. Agent lifecycle (opsional, Pro) memakai `HRIS_AGENT_TOKEN` (min. 32 karakter) untuk membaca lease dari aplikasi; agent tidak membuka port, dan Docker socket hanya dipasang bila `--lifecycle` dipilih.

## Integrasi API (Pro)

Community tidak menerima API key dan tidak menyediakan `/api-docs` maupun `/api/v1/openapi`; halamannya menampilkan informasi paket Pro. Pada distribusi Pro, admin membuat API key di **Admin → Integrasi API**, lalu sistem lain memanggil `/api/v1/...` dengan `Authorization: Bearer hris_…`. Scope berformat `modul:aksi` sesuai matriks RBAC (modul `settings` tidak tersedia), tidak boleh melebihi izin pembuat, dan dicek ulang pada setiap request. Key tidak memiliki tautan karyawan sehingga hanya melihat data yang pembuatnya boleh lihat se-perusahaan; endpoint pribadi menolak key.

## Pemeriksaan

```sh
npm run build
npm run typecheck
npm run lint
npm run test:postgres
npm run test:security
npm run test:api-docs
npm run test:birthdays
```

Pemindaian statis NVIDIA SkillSpector (hanya temuan baru di luar `.skillspector-baseline.yaml`):

```sh
git archive --format=zip HEAD -o /tmp/hris-src.zip
skillspector scan /tmp/hris-src.zip --no-llm --baseline .skillspector-baseline.yaml
```

`packages/database` adalah sumber lapisan SQL milik aplikasi; data PostgreSQL tidak disimpan di folder tersebut. `scripts` untuk migrasi/build, `dist` hasil bundling CLI, `storage` berkas privat. Semua berada dalam proyek ini.

Sebelum push: periksa `git status` dan pastikan `.env`, storage, dump, kunci, serta kredensial tidak masuk Git. Jangan menyalin `.git` monorepo ke repository publik.
