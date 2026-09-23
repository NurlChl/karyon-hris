# HRIS — aplikasi perusahaan

Proyek mandiri: jalankan seluruh perintah di folder ini. Tidak memerlukan folder website atau agent untuk mode Community.

> Status publikasi: **gunakan repository private dahulu**. Pemisahan direktori sudah dilakukan, tetapi sebagian implementasi fitur Pro masih berada di source aplikasi ini dengan pemeriksaan lisensi. Jangan menerbitkan repository ini sebagai Community open source sebelum ekstraksi Pro dan penetapan lisensi open source selesai. `private: true` di package.json tidak membuat repository GitHub otomatis private.

## Development lokal

Prasyarat: Node.js 22, npm, dan PostgreSQL 17. Server PostgreSQL existing tidak di-upgrade oleh perubahan struktur ini.

```sh
npm ci
node scripts/setup-env.mjs
# Edit .env: HRIS_DATABASE_URL atau HRIS_DB_*, serta NEXTAUTH_URL.
npm run db:migrate
npm run seed
npm run dev
```

Jika `.env` sudah ada, jangan jalankan setup ulang. Akun bootstrap: `admin@hris.com` di http://localhost:3000/auth/admin dan `budi@hris.com` di http://localhost:3000/auth/login. Password berasal dari `SEED_ADMIN_PASSWORD` dan `SEED_STAFF_PASSWORD` di `.env`, bukan password universal. Seed tidak mereset akun existing. Dataset 200 karyawan hanya untuk pengujian: `npm run seed:demo:plan`, lalu `npm run seed:demo`.

## Docker lokal — build source repository ini

Prasyarat: Docker Engine + Compose atau Docker Desktop dengan Linux containers.

```sh
node scripts/setup-env.mjs
# Review .env, jangan mengganti kunci pada instalasi existing.
docker compose up -d --build
docker compose exec app node db-seed.cjs
```

Buka http://localhost:3000. Compose membuat PostgreSQL terpisah pada volume lokal; tidak memakai database remote dari HRIS_DATABASE_URL. Migrasi dijalankan saat container mulai; seed akun dijalankan secara eksplisit. Database tidak membuka port ke host. Port aplikasi terikat loopback secara default.

`LOCAL_STORAGE_PATH=/app/storage` memakai volume `uploads`. Jangan menjalankan `docker compose down -v` kecuali memang hendak menghapus seluruh data dan lampiran instalasi ini.

## Dokploy

### Git/source

1. Push isi proyek ini ke repository **private**. Hubungkan akses GitHub pada Dokploy.
2. Buat layanan Docker Compose dengan repository ini sebagai root dan path `compose.yml`.
3. Isi environment dari `.env.example`; sediakan `.env` untuk `env_file` sesuai konfigurasi deployment Dokploy. Untuk workflow tanpa file `.env`, gunakan metode image di bawah.
4. Pasang domain Dokploy ke service `app`, port container `3000`, aktifkan HTTPS, isi `NEXTAUTH_URL` sesuai domain.
5. Jalankan seed sekali melalui terminal container: `node db-seed.cjs`.

### Raw Compose / image

Build dan push image milikmu lebih dahulu (ganti OWNER dan VERSION):

```sh
docker build -t ghcr.io/OWNER/hris:VERSION .
docker push ghcr.io/OWNER/hris:VERSION
```

Salin isi `compose.image.yml` ke editor Compose Dokploy. Isi `HRIS_IMAGE=ghcr.io/OWNER/hris:VERSION` dan seluruh environment wajib yang tercantum di Compose. Konfigurasikan akses registry jika image private. Jangan mengubah image menjadi public sebelum pemisahan Pro selesai.

Untuk instalasi dengan file image Compose lokal:

```sh
docker compose --env-file .env -f compose.image.yml up -d
docker compose --env-file .env -f compose.image.yml exec app node db-seed.cjs
```

Setelah repository distribusi tersedia, file ini dapat diunduh lewat URL raw GitHub milikmu. Tidak ada URL/image publik HRIS siap-pakai yang sudah diterbitkan oleh perubahan ini.

## Backup, update, rollback

Gunakan backup PostgreSQL dan volume Dokploy/server. Simpan juga `.env`/kunci enkripsi secara aman di luar repository. Backup database tanpa kunci enkripsi dan lampiran belum cukup untuk pemulihan lengkap. Gunakan tag/digest image yang tetap, backup sebelum migrasi, dan uji restore. Rollback image tidak membatalkan perubahan schema database.

Agent tidak dibutuhkan untuk Community. Integrasi Pro existing memakai `HRIS_AGENT_URL` dan `HRIS_AGENT_TOKEN`; jangan membuka agent atau Docker socket ke internet.

## Pemeriksaan

```sh
npm run build
npm run typecheck
npm run lint
npm run test:postgres
npm run test:security
```

`packages/database` adalah sumber lapisan SQL milik aplikasi; data PostgreSQL tidak disimpan di folder tersebut. `scripts` untuk migrasi/build, `dist` hasil bundling CLI, `storage` berkas privat. Semua berada dalam proyek ini.

Sebelum push: periksa `git status` dan pastikan `.env`, storage, dump, kunci, serta kredensial tidak masuk Git. Jangan menyalin `.git` monorepo ke repository publik.
