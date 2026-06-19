<#
.SYNOPSIS
  Fetch a python-build-standalone interpreter and stage it for Tauri bundling
  (Windows). This is what makes AutoLyrics "portable Python": the interpreter is
  bundled into the installer so end users do NOT need to install Python.

.DESCRIPTION
  Resolves the matching `*-install_only.tar.gz` asset from the latest
  astral-sh/python-build-standalone release (or a pinned -Tag) for the host
  architecture, downloads + extracts it into
  frontend/src-tauri/resources/python/ (so `python.exe` sits directly there).

  Run this BEFORE `tauri build`. CI (.github/workflows/release.yml) runs it
  automatically. If skipped, the app gracefully falls back to system Python.

.EXAMPLE
  pwsh scripts/fetch-portable-python.ps1
  pwsh scripts/fetch-portable-python.ps1 -PyVersion 3.12 -Tag 20250612
#>
param(
  [string]$PyVersion = "3.12",
  [string]$Triple = "",   # auto-detect from PROCESSOR_ARCHITECTURE if empty
  [string]$Tag = "",      # optional release pin (e.g. "20250612"); default = latest
  [string]$Dest = ""      # default = <repo>/frontend/src-tauri/resources/python
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # huge speedup for Invoke-WebRequest
# Windows PowerShell 5.1 may default to TLS 1.0/1.1; GitHub's API requires 1.2+.
try {
  [Net.ServicePointManager]::SecurityProtocol = `
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = (Resolve-Path (Join-Path $ScriptDir "..")).Path
if (-not $Dest) { $Dest = Join-Path $RepoRoot "frontend\src-tauri\resources\python" }

if (-not $Triple) {
  if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { $Triple = "aarch64-pc-windows-msvc" }
  else { $Triple = "x86_64-pc-windows-msvc" }
}

$apiBase = "https://api.github.com/repos/astral-sh/python-build-standalone/releases"
$apiHeaders = @{ "User-Agent" = "autolyrics-fetch"; "Accept" = "application/vnd.github+json" }
if ($env:GITHUB_TOKEN) { $apiHeaders["Authorization"] = "Bearer $($env:GITHUB_TOKEN)" }

Write-Host "-> Querying python-build-standalone release ($(if ($Tag) {"tag $Tag"} else {"latest"}))..."
$rel = if ($Tag) {
  Invoke-RestMethod "$apiBase/tags/$Tag" -Headers $apiHeaders
} else {
  Invoke-RestMethod "$apiBase/latest" -Headers $apiHeaders
}

$pattern = "cpython-$([regex]::Escape($PyVersion))\.\d+\+\d+-$([regex]::Escape($Triple))-install_only\.tar\.gz$"
$asset = $rel.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
if (-not $asset) {
  throw "No python-build-standalone asset matched /$pattern/ in release $($rel.tag_name). Check -PyVersion / -Triple."
}
Write-Host ("-> {0}  ({1:N1} MB)  from release {2}" -f $asset.name, ($asset.size / 1MB), $rel.tag_name)

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("pbs_" + [System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  $tarball = Join-Path $tmp $asset.name
  # Download with only a User-Agent header (the asset URL redirects to a CDN that
  # rejects/ignores the GitHub auth header).
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tarball -Headers @{ "User-Agent" = "autolyrics-fetch" }

  # bsdtar ships with Windows 10+; handles .tar.gz natively.
  tar -xzf $tarball -C $tmp
  $extractedPy = Join-Path $tmp "python"
  if (-not (Test-Path (Join-Path $extractedPy "python.exe"))) {
    throw "Extraction did not yield python\python.exe under $extractedPy"
  }

  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  # Clear any previous interpreter but preserve .gitkeep.
  Get-ChildItem $Dest -Force | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Recurse -Force
  Copy-Item (Join-Path $extractedPy "*") $Dest -Recurse -Force

  $ver = (& (Join-Path $Dest "python.exe") --version) 2>&1
  Write-Host "[OK] Portable Python staged at $Dest  ($ver)" -ForegroundColor Green
}
finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
