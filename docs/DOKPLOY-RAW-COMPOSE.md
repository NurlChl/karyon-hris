# Instalasi dan update HRIS Community lewat Dokploy Raw Compose

Panduan ini untuk **HRIS Community** dengan PostgreSQL terpisah yang sudah tersedia di Dokploy. YAML lengkap yang bisa disalin ada di halaman **Dokumentasi → Instalasi Dokploy** pada website lisensi (`/docs#dokploy`). Jangan menempel [`compose.image.yml`](../compose.image.yml) tanpa modifikasi: file installer tersebut memetakan port aplikasi ke `127.0.0.1`, sedangkan domain Compose Dokploy harus mencapai service melalui jaringan container.

## Instalasi pertama

1. Siapkan PostgreSQL yang dapat diakses lewat hostname **internal** Dokploy. Pastikan layanan Compose dan database berada pada jaringan internal yang saling terhubung. Buat database dan pengguna aplikasi yang dapat membuat tabel/migrasi. Simpan kredensialnya; jangan buka port PostgreSQL ke internet. Jika database sudah berisi data HRIS, jangan membuat database baru atau menjalankan seed seolah-olah instalasi baru.
2. Di Dokploy buat layanan **Compose**, pilih sumber **Raw**, dan tipe **Docker Compose**, bukan Docker Stack. Salin YAML dari `/docs#dokploy` ke editor Compose. Template hanya memiliki service `app`, named volume `hris_uploads`, dan jaringan eksternal `dokploy-network`; tidak membuka port host.
3. Pada tab **Environment**, isi `HRIS_IMAGE` dengan image Community yang benar-benar sudah diterbitkan, `HRIS_DATABASE_URL` (misalnya `postgresql://user:password@host-internal:5432/hris`), `AUTH_SECRET`, `ENCRYPTION_KEY`, `STORAGE_SIGNING_SECRET`, `CRON_SECRET`, `NEXTAUTH_URL`, `TRUST_PROXY=1`, dan `HRIS_LICENSE_SERVER` (URL HTTPS website lisensi). Gunakan nilai rahasia acak **berbeda** untuk tiap kunci. Persen-encode karakter khusus dalam password URL. `HRIS_DB_SSL=disable` hanya untuk jaringan internal tepercaya; koneksi eksternal perlu TLS dan sertifikat yang sesuai. Atur SMTP atau Resend bila akan mengirim email.
4. Di tab **Domains**, pilih service `app`, path `/`, port container `3000`, aktifkan HTTPS, dan samakan domain dengan `NEXTAUTH_URL`. Pastikan DNS domain menuju server Dokploy. Deploy, lalu periksa log `app` hingga migrasi selesai dan aplikasi sehat. Variabel Dokploy di tab Environment digunakan untuk substitusi `${VAR}`; variabel yang tidak dirujuk oleh YAML tidak otomatis masuk ke container.
5. Untuk **database kosong saja**, buat Superadmin sekali: isi sementara `SEED_ADMIN_EMAIL` dan `SEED_ADMIN_PASSWORD` (minimal 12 karakter) pada Environment, redeploy agar diteruskan ke `app`, lalu jalankan `node db-seed.cjs` pada terminal container `app`. Setelah berhasil, hapus dua variabel sementara dan redeploy. Segera masuk dan ganti password. Jangan menaruh password awal di Git atau membagikan log/screenshot yang memuat rahasia.

Jaga nama layanan Compose/proyek dan nama volume tetap stabil. Mengubah identitas proyek dapat membuat Dokploy menggunakan volume baru sehingga data tampak hilang, meski volume lama mungkin masih ada.

## Update rilis Community

1. Baca catatan rilis dan periksa apakah migrasi database kompatibel. Cadangkan database PostgreSQL, named volume `hris_uploads`, serta semua nilai Environment/kunci. Uji pemulihan backup di lingkungan terpisah.
2. Catat tag/digest `HRIS_IMAGE` yang sedang dipakai. Di tab Environment ubah **hanya** `HRIS_IMAGE` ke tag/digest rilis Community baru yang telah diterbitkan. Pertahankan `HRIS_DATABASE_URL`, kunci, nama project/service/volume, dan domain.
3. Klik **Redeploy** di Dokploy. Jangan pilih opsi yang menghapus/reset volume (`freshVolumes` atau sejenisnya). Tag versi eksplisit lebih mudah diaudit daripada `latest`; bila memakai tag bergerak, pastikan image baru benar-benar ditarik.
4. Periksa log `app`, status container, login, data, dan halaman lisensi. Jika bermasalah, jangan hapus volume. Kembali ke image lama hanya aman bila skema database masih kompatibel; rollback image **tidak** mengembalikan migrasi database. Gunakan backup dan prosedur rilis bila pemulihan data diperlukan.

Perubahan domain layanan Compose juga perlu redeploy. Jangan menjalankan `install.ps1`/`install.sh` milik instalasi standalone di atas layanan yang dikelola Dokploy.

## Batas Pro pada Raw Compose

Template Raw Compose ini **tidak** memasang installation manager. Menempel lisensi pada image Community tidak otomatis menarik image Pro di Dokploy. Registry privat saat ini memakai token pull sementara, bukan password registry permanen untuk pelanggan. Pro di Dokploy memerlukan alur distribusi privat dan penggantian image yang dikelola administrator; jangan menaruh token sementara atau publisher token pada Environment jangka panjang. Untuk instalasi **baru** yang memerlukan alur Pro otomatis dari dashboard, gunakan installer Compose resmi pada host yang Anda kelola. Memindahkan instalasi Dokploy yang sudah berisi data memerlukan backup dan rencana migrasi tersendiri.

## Rujukan Dokploy

- [Docker Compose, Environment, dan named volumes](https://docs.dokploy.com/docs/core/docker-compose)
- [Sumber Raw Compose](https://docs.dokploy.com/docs/core/providers)
- [Domain untuk Compose](https://docs.dokploy.com/docs/core/docker-compose/domains)
