# Batch screenshots for apex-miniapp UI work.
# Renders real WXML + real WXSS + real page data to HTML (tools/preview.mjs),
# then screenshots with headless Edge. ASCII-only on purpose: Windows
# PowerShell 5.1 mis-decodes UTF-8 without a BOM and then fails to parse.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\shot.ps1 -OutDir preview\before -Tag before
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\shot.ps1 -OutDir preview\after  -Tag after -Pages maps
param(
  [string]$OutDir = "preview/before",
  [string]$Tag = "before",
  [string[]]$Pages = @("maps", "predator", "stats"),
  [string[]]$Themes = @("dark", "light"),
  [string]$Lang = "zh",
  [int]$Width = 390,
  [int]$Height = 2400
)

# Continue, not Stop: Edge writes crashpad warnings to stderr (it cannot open
# the default user profile from a confined process), and with Stop those
# warnings abort the whole batch after the first page.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$outAbs = Join-Path $root $OutDir
New-Item -ItemType Directory -Path $outAbs -Force | Out-Null
# Edge needs a writable profile directory; the real one is not writable here.
$profileDir = Join-Path $outAbs "_edge-profile"
New-Item -ItemType Directory -Path $profileDir -Force | Out-Null

foreach ($p in $Pages) {
  foreach ($t in $Themes) {
    $html = Join-Path $outAbs "$Tag-$p-$t.html"
    $png = Join-Path $outAbs "$Tag-$p-$t.png"
    Push-Location $root
    & node tools/preview.mjs $p $Lang $t $html 2>&1 | Write-Host
    Pop-Location
    $uri = "file:///" + ($html -replace '\\', '/')
    # Legacy --headless, not --headless=new: the new mode hangs forever under
    # this sandbox (never exits, no PNG), legacy finishes in ~6s.
    # --noerrdialogs / --disable-breakpad: without them Edge pops a modal
    # "Error launching CrashSender.exe" dialog and waits for a click forever.
    $edgeArgs = @("--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
      "--no-first-run", "--noerrdialogs", "--disable-breakpad",
      "--disable-features=Crashpad", "--disable-crash-reporter",
      "--user-data-dir=$profileDir",
      "--force-device-scale-factor=2", "--window-size=$Width,$Height", "--screenshot=$png", $uri)
    $proc = Start-Process -FilePath $edge -ArgumentList $edgeArgs -PassThru -Wait -WindowStyle Hidden
    if (Test-Path $png) {
      $kb = [math]::Round((Get-Item $png).Length / 1KB, 1)
      Write-Host ("  -> " + (Split-Path -Leaf $png) + "  " + $kb + " KB")
    } else {
      Write-Host ("  !! screenshot failed: " + $png)
    }
  }
}
Write-Host "done: $outAbs"
