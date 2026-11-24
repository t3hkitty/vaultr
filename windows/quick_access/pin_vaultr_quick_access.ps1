# PowerShell script to pin Vaultr Dynamic Folders to Windows Explorer Quick Access (left navigation pane)
# Run in PowerShell: powershell -ExecutionPolicy Bypass -File .\pin_vaultr_quick_access.ps1

$ErrorActionPreference = "SilentlyContinue"

Write-Host "⚡ Pinning Vaultr & Dynamic Shelves to Windows File Explorer Quick Access..." -ForegroundColor Cyan

# Default Vault location
$vaultPath = "C:\meow-vault"
if (-not (Test-Path $vaultPath)) {
    $vaultPath = Join-Path $HOME "meow-vault"
    if (-not (Test-Path $vaultPath)) {
        New-Item -ItemType Directory -Path $vaultPath -Force | Out-Null
    }
}

# Ensure dynamic shelves directories exist for direct Explorer pinning
$shelves = @("Inbox Review", "Reading Queue", "New (24h)", "Quarantine")
foreach ($shelf in $shelves) {
    $shelfDir = Join-Path $vaultPath $shelf
    if (-not (Test-Path $shelfDir)) {
        New-Item -ItemType Directory -Path $shelfDir -Force | Out-Null
    }
}

# COM Automation with Windows Shell.Application
$shell = New-Object -ComObject Shell.Application

# Function to pin a folder to Quick Access
function Pin-ToQuickAccess($targetPath) {
    if (Test-Path $targetPath) {
        $folder = $shell.Namespace($targetPath)
        $folder.Self.InvokeVerb("pintohome")
        Write-Host "  ✅ Pinned to Quick Access: $targetPath" -ForegroundColor Green
    }
}

# 1. Pin the Root Vault
Pin-ToQuickAccess $vaultPath

# 2. Pin dynamic folders
foreach ($shelf in $shelves) {
    Pin-ToQuickAccess (Join-Path $vaultPath $shelf)
}

# 3. Copy Saved Searches to user's Searches directory ($env:USERPROFILE\Searches)
$searchesTarget = Join-Path $env:USERPROFILE "Searches"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$savedSearchesSource = Join-Path (Split-Path $scriptDir -Parent) "saved_searches"

if (Test-Path $savedSearchesSource) {
    Get-ChildItem -Path $savedSearchesSource -Filter "*.search-ms" | ForEach-Object {
        $dest = Join-Path $searchesTarget $_.Name
        Copy-Item -Path $_.FullName -Destination $dest -Force
        Write-Host "  🔍 Installed Windows Saved Search: $($_.Name)" -ForegroundColor Yellow
    }
}

Write-Host "`n🎉 Vaultr Windows File Explorer integration installed successfully!" -ForegroundColor Cyan
Write-Host "Open Windows File Explorer (Win + E) -> Check Quick Access in the left sidebar."
