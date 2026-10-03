param(
  [string]$Dir = '',
  [string]$Image = '__HRIS_COMMUNITY_IMAGE__',
  [string]$ManagerImage = '__HRIS_MANAGER_IMAGE__',
  [string]$LicenseServer = '__HRIS_LICENSE_SERVER__',
  [string]$RawBase = '__HRIS_RAW_BASE__',
  [string]$Url = 'http://localhost:3000',
  [ValidateRange(1,65535)][int]$Port = 3000,
  [ValidatePattern('^[a-z0-9][a-z0-9_-]{0,62}$')][string]$ProjectName = 'hris',
  [string]$AdminEmail = 'admin@hris.local',
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
if ($env:HRIS_COMMUNITY_IMAGE) { $Image = $env:HRIS_COMMUNITY_IMAGE }
if ($env:HRIS_MANAGER_IMAGE) { $ManagerImage = $env:HRIS_MANAGER_IMAGE }
if ($env:HRIS_LICENSE_SERVER) { $LicenseServer = $env:HRIS_LICENSE_SERVER }
if ($env:HRIS_RAW_BASE) { $RawBase = $env:HRIS_RAW_BASE }
foreach ($value in @($Image,$ManagerImage)) { if ($value -notmatch '^[a-zA-Z0-9][a-zA-Z0-9./:_@-]{0,254}$') { throw 'Image belum dikonfigurasi. Gunakan installer dari website atau isi -Image dan -ManagerImage.' } }
foreach ($value in @($Url,$LicenseServer)) { if ($value -notmatch '^(https://[a-zA-Z0-9.-]+(:[0-9]+)?|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)/?$') { throw 'Alamat wajib HTTPS, atau localhost untuk penggunaan lokal.' } }
if ($AdminEmail -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw 'Email administrator tidak valid.' }
if (!$Dir) { $Dir = if ((Test-Path -LiteralPath '.env') -and (Test-Path -LiteralPath 'compose.image.yml')) { (Get-Location).Path } else { Join-Path (Get-Location).Path 'hris' } }
$installPath = [IO.Path]::GetFullPath($Dir)
if (!(Test-Path -LiteralPath $installPath)) { [void](New-Item -ItemType Directory -Path $installPath) }
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-InstallFile([string]$Name,[string]$Value) { [IO.File]::WriteAllText((Join-Path $installPath $Name),$Value,$utf8) }
function Random-Hex([int]$Bytes = 32) { $buffer = New-Object byte[] $Bytes; $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }; return ([BitConverter]::ToString($buffer)).Replace('-','').ToLowerInvariant() }
function Read-Setting([string]$Name) { $entry = [regex]::Match([IO.File]::ReadAllText((Join-Path $installPath '.env')),"(?m)^$Name=(.*)$"); return $entry.Groups[1].Value.Trim() }
function Set-Setting([string]$Name,[string]$Value) {
  if ($Value.Contains("`n") -or $Value.Contains("`r")) { throw 'Nilai environment tidak valid.' }
  $content = [IO.File]::ReadAllText((Join-Path $installPath '.env'))
  $pattern = "(?m)^$Name=[^\r\n]*"
  if ([regex]::IsMatch($content,$pattern)) { $content = [regex]::Replace($content,$pattern,[System.Text.RegularExpressions.MatchEvaluator]{ param($m) "$Name=$Value" }) } else { $content += "`n$Name=$Value`n" }
  Write-InstallFile '.env' $content
}
function Docker-Run([string[]]$Arguments) { & docker @Arguments; if ($LASTEXITCODE -ne 0) { throw 'Docker gagal. Periksa Docker Desktop dan docker compose logs app.' } }
foreach ($name in @('compose.image.yml','compose.manager.yml','compose.external.yml')) {
  $local = if ($PSScriptRoot) { Join-Path $PSScriptRoot $name } else { '' }
  if ($local -and (Test-Path -LiteralPath $local)) { $content = [IO.File]::ReadAllText($local) }
  else {
    if ($RawBase -notmatch '^(https://[a-zA-Z0-9.-]+(:[0-9]+)?|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)/[a-zA-Z0-9/._-]+$') { throw 'Alamat unduhan installer belum dikonfigurasi.' }
    $download = Invoke-WebRequest -UseBasicParsing -Uri "$RawBase/$name"
    # PowerShell returns byte[] for application/yaml. Casting that array to
    # string writes "35 32 ..." instead of the actual Compose document.
    $content = if ($download.Content -is [byte[]]) {
      [System.Text.UTF8Encoding]::new($false,$true).GetString($download.Content)
    } else { [string]$download.Content }
  }
  if ($content -notmatch '(?m)^services:\s*$') { throw "File $name bukan konfigurasi Docker Compose yang valid. Periksa $RawBase/$name." }
  Write-InstallFile $name $content
}
$newInstall = !(Test-Path -LiteralPath (Join-Path $installPath '.env'))
if ($newInstall) {
  if ($Url -eq 'http://localhost:3000') { $Url = "http://localhost:$Port" }
  $settings = [ordered]@{ COMPOSE_PROJECT_NAME=$ProjectName; HRIS_IMAGE=$Image; HRIS_EDITION='community'; BIND_ADDRESS='127.0.0.1'; APP_PORT=$Port; NEXTAUTH_URL=$Url.TrimEnd('/'); TRUST_PROXY='0'; HRIS_LICENSE_SERVER=$LicenseServer.TrimEnd('/'); HRIS_DB_NAME='hris'; HRIS_DB_USER='hris'; HRIS_DATABASE_URL=''; HRIS_DB_SSL='disable' }
  foreach ($key in @('POSTGRES_ADMIN_PASSWORD','HRIS_DB_PASSWORD','AUTH_SECRET','ENCRYPTION_KEY','STORAGE_SIGNING_SECRET','CRON_SECRET','HRIS_MANAGER_TOKEN','HRIS_AGENT_TOKEN')) { $settings[$key] = Random-Hex }
  foreach ($entry in @(@('EMAIL_PROVIDER','smtp'),@('EMAIL_FROM',''),@('SMTP_HOST',''),@('SMTP_PORT','587'),@('SMTP_USER',''),@('SMTP_PASS',''),@('RESEND_API_KEY',''))) { $settings[$entry[0]] = $entry[1] }
  $envHeader = "# Dibuat oleh installer HRIS. Simpan privat dan backup bersama database.`n# Secret inti diisi otomatis; jangan diganti setelah data tersimpan.`n# Email opsional saat instalasi, tetapi wajib dikonfigurasi sebelum mengirim OTP/notifikasi.`n# Pilih SMTP atau Resend dan gunakan alamat pengirim dari domain yang sudah diverifikasi.`n"
  Write-InstallFile '.env' ($envHeader + (($settings.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"))
  Write-InstallFile '.bootstrap-pending' $AdminEmail
}
if ((Read-Setting 'COMPOSE_FILE') -like '*compose.lifecycle.yml*') { throw 'Instalasi memakai agent lifecycle lama. Pertahankan konfigurasi tersebut; migrasikan overlay sebelum mengaktifkan manager baru.' }
foreach ($key in @('HRIS_MANAGER_TOKEN','HRIS_AGENT_TOKEN')) { if (!(Read-Setting $key)) { Set-Setting $key (Random-Hex) } }
if (!(Read-Setting 'HRIS_LICENSE_SERVER')) { Set-Setting 'HRIS_LICENSE_SERVER' $LicenseServer.TrimEnd('/') }
Set-Setting 'HRIS_MANAGER_IMAGE' $ManagerImage
$separator = if ([Environment]::OSVersion.Platform -eq 'Win32NT') { ';' } else { ':' }
$composeFiles = @('compose.image.yml','compose.manager.yml')
if ((Read-Setting 'HRIS_DATABASE_URL').Trim("'",'"')) { $composeFiles += 'compose.external.yml' }
Set-Setting 'COMPOSE_FILE' ($composeFiles -join $separator)
if ($composeFiles -contains 'compose.external.yml') { Write-Host "Konfigurasi siap di $installPath. Memakai PostgreSQL dari HRIS_DATABASE_URL." } else { Write-Host "Konfigurasi siap di $installPath. Database PostgreSQL bawaan disiapkan otomatis; tidak perlu menyiapkan database sendiri." }
if ($NoStart) { Write-Host 'Isi HRIS_DATABASE_URL di .env jika memakai database sendiri, lalu jalankan installer lagi dengan -Dir yang sama.'; return }
if (!(Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Pasang dan jalankan Docker Desktop, lalu jalankan installer ini kembali. Tidak perlu membuka WSL.' }
Push-Location $installPath
try {
  Docker-Run @('info','--format','{{.OSType}}')
  Docker-Run @('compose','version')
  Docker-Run @('compose','pull')
  & docker compose up -d
  if ($LASTEXITCODE -ne 0) { throw "Container belum bisa dijalankan. Jika pesan di atas menyebut 'port is already allocated', port $(Read-Setting 'APP_PORT') sudah dipakai aplikasi lain: ubah APP_PORT (dan NEXTAUTH_URL bila memakai localhost) di $installPath\.env ke port lain, lalu jalankan 'docker compose up -d' di folder itu." }
  $healthy = $false
  for ($attempt=0; $attempt -lt 60; $attempt++) {
    # Windows PowerShell 5.1 can turn native stderr into terminating errors.
    # A starting container is expected to fail this probe temporarily.
    $probePreference=$ErrorActionPreference
    try {
      $ErrorActionPreference='Continue'
      & docker compose exec -T app wget -q -O /dev/null http://127.0.0.1:3000/api/v1/health 2>$null
      $probeExit=$LASTEXITCODE
    } finally { $ErrorActionPreference=$probePreference }
    if ($probeExit -eq 0) { $healthy = $true; break }
    Start-Sleep -Seconds 3
  }
  if (!$healthy) { throw 'HRIS belum siap. Periksa: docker compose logs app' }
  $pending = Join-Path $installPath '.bootstrap-pending'
  if (Test-Path -LiteralPath $pending) {
    $oldEmail=$env:SEED_ADMIN_EMAIL; $oldPassword=$env:SEED_ADMIN_PASSWORD
    try {
      $env:SEED_ADMIN_EMAIL=[IO.File]::ReadAllText($pending).Trim(); $env:SEED_ADMIN_PASSWORD=Random-Hex 18
      Docker-Run @('compose','exec','-T','-e','SEED_ADMIN_EMAIL','-e','SEED_ADMIN_PASSWORD','app','node','db-seed.cjs')
      Write-Host "Login: $(Read-Setting 'NEXTAUTH_URL')/auth/admin"
      Write-Host "Email: $env:SEED_ADMIN_EMAIL"
      Write-Host "Password awal (simpan sekarang): $env:SEED_ADMIN_PASSWORD"
      Remove-Item -LiteralPath $pending
    } finally { $env:SEED_ADMIN_EMAIL=$oldEmail; $env:SEED_ADMIN_PASSWORD=$oldPassword }
  }
  Write-Host 'HRIS siap. Untuk Pro, beli lisensi lalu tempel di menu Lisensi & Paket. Upgrade diproses otomatis.'
  if ($composeFiles -notcontains 'compose.external.yml') { Write-Host 'Ingin memakai PostgreSQL sendiri nanti? Isi HRIS_DATABASE_URL di .env, pindahkan data lama (pg_dump/pg_restore), lalu jalankan installer ini lagi di folder yang sama.' }
} finally { Pop-Location }
