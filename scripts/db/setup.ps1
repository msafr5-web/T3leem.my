<#
.SYNOPSIS
  One-time local setup of the t3leem PostgreSQL 18 databases.

.DESCRIPTION
  - Prompts for the `postgres` superuser password (used only in this process, never saved).
  - Creates roles t3leem_owner / t3leem_app with fresh random passwords.
  - Creates databases t3leem and t3leem_test and locks down privileges.
  - Generates an RS256 JWT key pair in ./keys (git-ignored).
  - Writes the connection strings and public key into ./.env (git-ignored).

  Safe to re-run: it rotates the two role passwords and updates .env accordingly.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\db\setup.ps1
#>
param(
  [string]$PgBin = "C:\Program Files\PostgreSQL\18\bin",
  [string]$PgHost = "localhost",
  [int]$PgPort = 5432,
  [string]$SuperUser = "postgres"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$psql = Join-Path $PgBin "psql.exe"
if (-not (Test-Path $psql)) { throw "psql.exe not found at $psql. Pass -PgBin <path to PostgreSQL bin>." }

function New-Secret([int]$bytes = 24) {
  $buf = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
  # Hex keeps the password URL-safe inside DATABASE_URL.
  return -join ($buf | ForEach-Object { $_.ToString("x2") })
}

function Invoke-Psql([string]$database, [string]$file, [string[]]$extra = @()) {
  $psqlArgs = @("-h", $PgHost, "-p", $PgPort, "-U", $SuperUser, "-d", $database, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", $file) + $extra
  & $psql @psqlArgs
  if ($LASTEXITCODE -ne 0) { throw "psql failed on $file ($database)" }
}

# --- 1. Superuser password (in-memory only) ---------------------------------
# Non-interactive runs (CI, automation) may pass it via PGPASSWORD; otherwise prompt.
if (-not $env:PGPASSWORD) {
  $secure = Read-Host "Password for PostgreSQL user '$SuperUser'" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

try {
  & $psql -h $PgHost -p $PgPort -U $SuperUser -d postgres -X -q -t -c "SELECT 1" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not connect as '$SuperUser'. Check the password." }

  # --- 2. Roles + databases ---------------------------------------------------
  $ownerPassword = New-Secret
  $appPassword = New-Secret
  Write-Host "Creating roles and databases..." -ForegroundColor Cyan
  Invoke-Psql "postgres" (Join-Path $PSScriptRoot "01_roles_and_databases.sql") @("-v", "owner_password=$ownerPassword", "-v", "app_password=$appPassword")

  # --- 3. Per-database privileges ---------------------------------------------
  foreach ($db in @("t3leem", "t3leem_test")) {
    Write-Host "Securing database $db..." -ForegroundColor Cyan
    Invoke-Psql $db (Join-Path $PSScriptRoot "02_database_privileges.sql")
  }
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

# --- 4. JWT RS256 key pair ----------------------------------------------------
$keysDir = Join-Path $root "keys"
$privateKeyPath = Join-Path $keysDir "jwt-private.pem"
$publicKeyPath = Join-Path $keysDir "jwt-public.pem"
if (-not (Test-Path $privateKeyPath)) {
  Write-Host "Generating RS256 key pair in ./keys ..." -ForegroundColor Cyan
  New-Item -ItemType Directory -Force $keysDir | Out-Null
  $js = "const c=require('crypto'),fs=require('fs');const k=c.generateKeyPairSync('rsa',{modulusLength:2048});" +
        "fs.writeFileSync(process.argv[1],k.privateKey.export({type:'pkcs8',format:'pem'}));" +
        "fs.writeFileSync(process.argv[2],k.publicKey.export({type:'spki',format:'pem'}));"
  & node -e $js $privateKeyPath $publicKeyPath
  if ($LASTEXITCODE -ne 0) { throw "Key generation failed" }
}
$publicKeyB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($publicKeyPath))

# --- 5. .env --------------------------------------------------------------------
$envPath = Join-Path $root ".env"
if (-not (Test-Path $envPath)) { Copy-Item (Join-Path $root ".env.example") $envPath }
$lines = [System.Collections.Generic.List[string]]([IO.File]::ReadAllLines($envPath))

function Set-EnvLine([string]$key, [string]$value) {
  $idx = -1
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^$key=") { $idx = $i; break } }
  if ($idx -ge 0) { $lines[$idx] = "$key=$value" } else { $lines.Add("$key=$value") }
}

$base = "${PgHost}:$PgPort"
Set-EnvLine "DATABASE_URL" "postgresql://t3leem_app:$appPassword@$base/t3leem?schema=public&connection_limit=10"
Set-EnvLine "DIRECT_DATABASE_URL" "postgresql://t3leem_owner:$ownerPassword@$base/t3leem?schema=public"
Set-EnvLine "TEST_DATABASE_URL" "postgresql://t3leem_app:$appPassword@$base/t3leem_test?schema=public"
Set-EnvLine "TEST_DIRECT_DATABASE_URL" "postgresql://t3leem_owner:$ownerPassword@$base/t3leem_test?schema=public"
Set-EnvLine "JWT_PUBLIC_KEY_BASE64" $publicKeyB64
Set-EnvLine "JWT_PRIVATE_KEY_PATH" "keys/jwt-private.pem"

# UTF-8 without BOM: a BOM would corrupt the first variable name.
[IO.File]::WriteAllLines($envPath, $lines, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Done. Databases t3leem and t3leem_test are ready; .env updated." -ForegroundColor Green
Write-Host "Next: npm run db:migrate ; npm run db:migrate:test ; npm run db:seed"
