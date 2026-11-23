# ==============================================================================
# sync_companion_repos.ps1 — 1-Click Sync for vaultr-exts, Kittlibr-, anymd-pluginbundles
# Run in Windows PowerShell from your repository root or cloned vaultr directory.
# ==============================================================================

Write-Host "🐾 AnyMD / Kittlibr / Vaultr Patch Synchronization" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$patchDir = Join-Path $scriptDir "patches"

if (-not (Test-Path $patchDir)) {
    Write-Host "❌ Cannot find patches folder at: $patchDir" -ForegroundColor Red
    exit 1
}

function Apply-Patches($repoName, $subfolder) {
    Write-Host "`n📦 Checking $repoName..." -ForegroundColor Yellow
    # Look for candidate local directories
    $candidates = @(
        (Join-Path (Split-Path -Parent $scriptDir) $repoName),
        (Join-Path $HOME $repoName),
        (Join-Path $HOME "Documents\GitHub\$repoName"),
        (Join-Path "C:\Scripts" $repoName)
    )
    
    $targetDir = $null
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c ".git")) {
            $targetDir = $c
            break
        }
    }

    if (-not $targetDir) {
        Write-Host "  ⚠️ Could not auto-detect local git repo for $repoName." -ForegroundColor DarkYellow
        $targetDir = Read-Host "  Please enter the local path to your $repoName folder"
    }

    if ($targetDir -and (Test-Path (Join-Path $targetDir ".git"))) {
        Write-Host "  Applying patches to: $targetDir" -ForegroundColor Green
        $targetPatches = Join-Path $patchDir $subfolder
        $patchFiles = Get-ChildItem -Path $targetPatches -Filter "*.patch" | Sort-Object Name
        
        Push-Location $targetDir
        foreach ($p in $patchFiles) {
            Write-Host "   -> git am $($p.Name)" -ForegroundColor Gray
            git am --3way $p.FullName
        }
        Write-Host "  🚀 Pushing $repoName to GitHub..." -ForegroundColor Cyan
        git push origin main
        Pop-Location
        Write-Host "  ✅ $repoName synced & pushed!" -ForegroundColor Green
    } else {
        Write-Host "  ❌ Skipped $repoName (directory not found or not a git repo)." -ForegroundColor Red
    }
}

Apply-Patches "vaultr-exts" "vaultr-exts"
Apply-Patches "Kittlibr-" "Kittlibr-"
Apply-Patches "anymd-pluginbundles" "anymd-pluginbundles"

Write-Host "`n🎉 All companion repositories updated and pushed to GitHub!" -ForegroundColor Green
