param(
    [string]$FirebaseServiceAccountJson = "",
    [string]$ProjectRef = "wuvmbxlkxiabydcmbztd",
    [string]$InternalPushSecret = "",
    [switch]$SkipDeploy
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

if ([string]::IsNullOrWhiteSpace($FirebaseServiceAccountJson)) {
    $candidates = @(
        (Join-Path $repoRoot "firebase-service-account.json"),
        "D:\Download\firebase-service-account.json",
        "D:\Download\kasirin-firebase-service-account.json",
        "C:\Users\Acer Swift\Downloads\firebase-service-account.json",
        "C:\Users\Acer Swift\Downloads\kasirin-firebase-service-account.json"
    )

    $FirebaseServiceAccountJson = $candidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
}

if ([string]::IsNullOrWhiteSpace($FirebaseServiceAccountJson) -or !(Test-Path -LiteralPath $FirebaseServiceAccountJson)) {
    throw "Firebase service account JSON belum ditemukan. Download dari Firebase Console > Project settings > Service accounts > Generate new private key, lalu jalankan ulang dengan -FirebaseServiceAccountJson `"path\file.json`"."
}

$supabaseCommand = Get-Command supabase -ErrorAction SilentlyContinue
$supabaseArgsPrefix = @()
if ($null -eq $supabaseCommand) {
    $npxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue
    if ($null -eq $npxCommand) {
        throw "Supabase CLI belum terinstall/terdeteksi di PATH, dan npx.cmd juga tidak tersedia. Install Supabase CLI dulu dari https://supabase.com/docs/guides/cli."
    }
    $supabaseCommandPath = $npxCommand.Source
    $supabaseArgsPrefix = @("--yes", "supabase@latest")
} else {
    $supabaseCommandPath = $supabaseCommand.Source
}

function Invoke-SupabaseCli {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & $supabaseCommandPath @supabaseArgsPrefix @Arguments
    if ($LASTEXITCODE -ne 0) {
        $safeArguments = if ($Arguments.Count -ge 2 -and $Arguments[0] -eq "db" -and $Arguments[1] -eq "query") {
            "db query"
        } else {
            $Arguments -join ' '
        }
        throw "Supabase CLI failed: $safeArguments"
    }
}

function ConvertTo-SqlLiteral {
    param([string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

$serviceAccountRaw = Get-Content -Raw -LiteralPath $FirebaseServiceAccountJson
$serviceAccount = $serviceAccountRaw | ConvertFrom-Json

$requiredFields = @("project_id", "client_email", "private_key")
$missing = $requiredFields | Where-Object { [string]::IsNullOrWhiteSpace([string]$serviceAccount.$_) }
if ($missing.Count -gt 0) {
    throw "Service account JSON tidak valid. Field kosong: $($missing -join ', ')"
}

$projectId = [string]$serviceAccount.project_id
$compactJson = $serviceAccountRaw | ConvertFrom-Json | ConvertTo-Json -Depth 20 -Compress
if ([string]::IsNullOrWhiteSpace($InternalPushSecret)) {
    $secretBytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($secretBytes)
    } finally {
        $rng.Dispose()
    }
    $InternalPushSecret = [Convert]::ToBase64String($secretBytes)
}

$tempEnvFile = Join-Path ([System.IO.Path]::GetTempPath()) "kasirin-fcm-supabase-secrets-$([guid]::NewGuid()).env"
$tempSqlFile = Join-Path ([System.IO.Path]::GetTempPath()) "kasirin-fcm-supabase-vault-$([guid]::NewGuid()).sql"
try {
    @(
        "FIREBASE_PROJECT_ID=$projectId",
        "FIREBASE_SERVICE_ACCOUNT_JSON=$compactJson",
        "KASIRIN_PUSH_INTERNAL_SECRET=$InternalPushSecret"
    ) | Set-Content -LiteralPath $tempEnvFile -Encoding UTF8

    Write-Host "Setting Supabase secrets for project ref $ProjectRef ..."
    Invoke-SupabaseCli secrets set --project-ref $ProjectRef --env-file $tempEnvFile
    Invoke-SupabaseCli link --project-ref $ProjectRef

    $internalSecretLiteral = ConvertTo-SqlLiteral $InternalPushSecret
    $vaultSql = @"
do `$`$
declare
  existing_id uuid;
begin
  select id into existing_id
  from vault.secrets
  where name = 'kasirin_push_internal_secret';

  if existing_id is null then
    perform vault.create_secret($internalSecretLiteral, 'kasirin_push_internal_secret', 'Internal shared secret for Kasirin order push trigger');
  else
    perform vault.update_secret(existing_id, $internalSecretLiteral, 'kasirin_push_internal_secret', 'Internal shared secret for Kasirin order push trigger');
  end if;
end
`$`$;
"@
    $vaultSql | Set-Content -LiteralPath $tempSqlFile -Encoding UTF8
    Write-Host "Setting database vault secret for order push trigger ..."
    Invoke-SupabaseCli db query --linked --file $tempSqlFile

    if (-not $SkipDeploy) {
        Write-Host "Deploying Edge Function register-device-token ..."
        Invoke-SupabaseCli functions deploy register-device-token --project-ref $ProjectRef

        Write-Host "Deploying Edge Function notify-new-order ..."
        Invoke-SupabaseCli functions deploy notify-new-order --project-ref $ProjectRef --no-verify-jwt
    }

    Write-Host "Supabase FCM setup complete."
    Write-Host "Firebase project: $projectId"
} finally {
    if (Test-Path -LiteralPath $tempEnvFile) {
        Remove-Item -LiteralPath $tempEnvFile -Force
    }
    if (Test-Path -LiteralPath $tempSqlFile) {
        Remove-Item -LiteralPath $tempSqlFile -Force
    }
}
