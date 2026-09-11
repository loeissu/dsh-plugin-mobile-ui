# verify-android-resources.ps1
#
# Validate the Phase 2 launch-screen resources with aapt2 alone — no Rust, no
# Gradle project wiring, no MSVC.
#
# Why this exists: the real APK build needs the Tauri CLI to generate
# tauri.settings.gradle and then needs the MSVC linker for the Rust half. Both
# are heavyweight. But the launch screen is purely Android resources, and the
# failure modes that matter are all catchable by the resource compiler:
#
#   - an XML resource that does not parse or compile
#   - a malformed <vector> (bad pathData, unknown attribute)
#   - a theme item referencing an undefined attribute or color
#   - `windowSplashScreen*` used without the core-splashscreen attributes present
#
# The last one is the real question: those attribute names come from the
# androidx library, so the link step must include the AAR's own resources or the
# check would report a false failure.

param(
  [string]$AppRes      = 'H:\DSH\_work\src\dsh-tether-main\app\src-tauri\gen\android\app\src\main\res',
  [string]$Manifest    = 'H:\DSH\_work\src\dsh-tether-main\app\src-tauri\gen\android\app\src\main\AndroidManifest.xml',
  [string]$AarDir      = 'H:\DSH\_work\splashscreen-aar',
  [string]$AndroidJar  = 'H:\DevTools\AndroidSDK\platforms\android-36\android.jar',
  [string]$Aapt2       = 'H:\DevTools\AndroidSDK\build-tools\36.0.0\aapt2.exe',
  [string]$Work        = 'H:\DSH\_work\aapt2-check'
)

$ErrorActionPreference = 'Stop'
Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Work | Out-Null

function Step($msg) { Write-Host "== $msg" }

# ── preflight ───────────────────────────────────────────────────────────────
foreach ($p in @($AppRes, $Manifest, $AarDir, $AndroidJar, $Aapt2)) {
  if (-not (Test-Path $p)) { throw "missing required input: $p" }
}

# ── 1. compile the app's resources ──────────────────────────────────────────
#
# One external parent theme is stubbed for this check: the base theme inherits
# Theme.MaterialComponents.* from com.google.android.material, which is not part
# of the launch-screen change and would drag in appcompat, core, and their
# transitive AARs. Everything this check exists to prove — the splash theme, its
# core-splashscreen attributes, the colors, and the vector mark — is unaffected,
# and the real dependency is resolved normally by Gradle in a real build.
Step 'stage app resources (stub the Material parent theme)'
$staged = Join-Path $Work 'res'
Copy-Item $AppRes $staged -Recurse -Force
# Two unrelated third-party dependencies are excluded so the link step can run
# standalone; neither is part of the launch-screen change:
#   - Theme.MaterialComponents.* comes from com.google.android.material
#   - activity_main.xml is Tauri's unused template layout and needs
#     androidx.constraintlayout (MainActivity never calls setContentView)
# A real Gradle build resolves both normally.
$stagedLayout = Join-Path $staged 'layout'
if (Test-Path $stagedLayout) { Remove-Item $stagedLayout -Recurse -Force }
$themesPath = Join-Path $staged 'values\themes.xml'
$themesNightPath = Join-Path $staged 'values-night\themes.xml'
foreach ($tp in @($themesPath, $themesNightPath)) {
  $t = Get-Content $tp -Raw
  $t = $t -replace 'parent="Theme\.MaterialComponents\.DayNight\.NoActionBar"', 'parent="android:Theme.Material.Light.NoActionBar"'
  [System.IO.File]::WriteAllText($tp, $t, (New-Object System.Text.UTF8Encoding($false)))
}
Write-Host '   ok'

Step 'aapt2 compile (app resources)'
$appZip = Join-Path $Work 'app-res.zip'
& $Aapt2 compile --dir $staged -o $appZip 2>&1 | ForEach-Object { "   $_" }
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed on the app resources' }
Write-Host "   ok: $((Get-Item $appZip).Length) bytes"

# ── 2. compile the library's resources (attribute definitions) ──────────────
Step 'aapt2 compile (core-splashscreen resources)'
$aarRes = Join-Path $AarDir 'res'
if (-not (Test-Path $aarRes)) { throw "the AAR has no res/ directory: $aarRes" }
$aarZip = Join-Path $Work 'aar-res.zip'
& $Aapt2 compile --dir $aarRes -o $aarZip 2>&1 | ForEach-Object { "   $_" }
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed on the library resources' }
Write-Host "   ok: $((Get-Item $aarZip).Length) bytes"

# ── 3. manifest: substitute the gradle placeholders ─────────────────────────
Step 'prepare manifest (substitute manifestPlaceholders)'
$manifestText = Get-Content $Manifest -Raw
$manifestText = $manifestText -replace '\$\{usesCleartextTraffic\}', 'false'
$manifestText = $manifestText -replace '\$\{applicationId\}', 'cc.zexa.dshtether'
# aapt2 link still requires a `package` attribute on <manifest>; modern AGP
# supplies it from the gradle `namespace` instead, so it is absent from the
# source manifest and has to be injected for a standalone link.
if ($manifestText -notmatch '<manifest[^>]*\spackage=') {
  $manifestText = $manifestText -replace '<manifest ', '<manifest package="cc.zexa.dshtether" '
}
$tmpManifest = Join-Path $Work 'AndroidManifest.xml'
[System.IO.File]::WriteAllText($tmpManifest, $manifestText, (New-Object System.Text.UTF8Encoding($false)))
Write-Host '   ok'

# ── 4. link ─────────────────────────────────────────────────────────────────
Step 'aapt2 link (resolves every theme item and attribute reference)'
$apk = Join-Path $Work 'linked.apk'
& $Aapt2 link `
  -I $AndroidJar `
  --manifest $tmpManifest `
  --auto-add-overlay `
  -o $apk `
  $appZip $aarZip 2>&1 | ForEach-Object { "   $_" }
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed — a resource or attribute reference does not resolve' }
Write-Host "   ok: $((Get-Item $apk).Length) bytes"

# ── 5. assert the launch-screen pieces survived into the APK ────────────────
Step 'inspect the linked resource table'
$dump = & $Aapt2 dump resources $apk 2>&1 | Out-String
$checks = [ordered]@{
  'color/splash_background'   = 'splash_background'
  'color/splash_mark'         = 'splash_mark'
  'color/window_background'   = 'window_background'
  'drawable/splash_mark'      = 'splash_mark'
  'style/Theme.dsh_tether_app.Splash' = 'Theme.dsh_tether_app.Splash'
  'windowSplashScreenBackground'      = 'windowSplashScreenBackground'
  'windowSplashScreenAnimatedIcon'    = 'windowSplashScreenAnimatedIcon'
  'postSplashScreenTheme'             = 'postSplashScreenTheme'
}
$missing = @()
foreach ($k in $checks.Keys) {
  $present = $dump -match [regex]::Escape($k)
  Write-Host ("   {0,-36} {1}" -f $k, $(if ($present) { 'present' } else { 'MISSING' }))
  if (-not $present) { $missing += $k }
}

# ── 6. assert the night variant actually differs ────────────────────────────
Step 'night-qualified values differ from the default'
$nightSplash = 'H:\DSH\_work\src\dsh-tether-main\app\src-tauri\gen\android\app\src\main\res\values-night\splash.xml'
$daySplash   = 'H:\DSH\_work\src\dsh-tether-main\app\src-tauri\gen\android\app\src\main\res\values\splash.xml'
$night = Get-Content $nightSplash -Raw
$day   = Get-Content $daySplash -Raw
$nightBg = ([regex]::Match($night, 'name="splash_background">([^<]+)<')).Groups[1].Value
$dayBg   = ([regex]::Match($day,   'name="splash_background">([^<]+)<')).Groups[1].Value
Write-Host "   day  splash_background = $dayBg"
Write-Host "   night splash_background = $nightBg"
if ($nightBg -eq $dayBg) { $missing += 'night splash_background does not differ from day' }
# The config split is what makes the night variant selectable at all.
$nightDump = & $Aapt2 dump resources $apk 2>&1 | Out-String
if ($nightDump -notmatch 'night') { $missing += 'no night-qualified configuration in the resource table' }
else { Write-Host '   night configuration present in the resource table' }

Write-Host ''
if ($missing.Count -gt 0) {
  Write-Host "RESULT: $($missing.Count) check(s) FAILED"
  foreach ($m in $missing) { Write-Host "  - $m" }
  exit 1
}
Write-Host 'RESULT: launch-screen resources compile, link and survive into the APK'
exit 0
