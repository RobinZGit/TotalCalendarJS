param(
  [switch]$Parallel
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

$GradleVersion = "9.4.1"
$GradleDistName = "gradle-$GradleVersion-bin.zip"
$GradleDistUrl = "https://services.gradle.org/distributions/$GradleDistName"
$ToolsDir = Join-Path $RepoRoot ".tools"
$GradleDir = Join-Path $ToolsDir "gradle-$GradleVersion"
$GradleZipPath = Join-Path $ToolsDir $GradleDistName
$AndroidProjectDir = Join-Path $RepoRoot "android"

if (!(Test-Path -LiteralPath $AndroidProjectDir)) {
  throw "Android project not found at: $AndroidProjectDir"
}

Write-Host "Using Gradle $GradleVersion (local cache: $ToolsDir)"

New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null

if (!(Test-Path -LiteralPath $GradleDir)) {
  if (!(Test-Path -LiteralPath $GradleZipPath)) {
    Write-Host "Downloading $GradleDistUrl"
    Invoke-WebRequest -Uri $GradleDistUrl -OutFile $GradleZipPath -UseBasicParsing
  } else {
    Write-Host "Found cached Gradle ZIP: $GradleZipPath"
  }

  $ExtractDir = Join-Path $ToolsDir "extract"
  if (Test-Path -LiteralPath $ExtractDir) { Remove-Item -Recurse -Force $ExtractDir }
  New-Item -ItemType Directory -Force -Path $ExtractDir | Out-Null

  Write-Host "Extracting Gradle..."
  Expand-Archive -LiteralPath $GradleZipPath -DestinationPath $ExtractDir -Force

  $ExtractedGradleRoot = Join-Path $ExtractDir "gradle-$GradleVersion"
  if (!(Test-Path -LiteralPath $ExtractedGradleRoot)) {
    throw "Unexpected Gradle ZIP layout. Missing: $ExtractedGradleRoot"
  }

  Move-Item -Force -LiteralPath $ExtractedGradleRoot -Destination $GradleDir
  Remove-Item -Recurse -Force $ExtractDir
}

$GradleExe = Join-Path $GradleDir "bin\\gradle.bat"
if (!(Test-Path -LiteralPath $GradleExe)) {
  throw "Gradle executable not found at: $GradleExe"
}

if (-not (Get-Command java -ErrorAction SilentlyContinue) -and -not $env:JAVA_HOME) {
  throw "Java not found. Install JDK 17 and set JAVA_HOME (or add java to PATH)."
}

if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
  Write-Warning "ANDROID_HOME / ANDROID_SDK_ROOT is not set. If build fails, install Android SDK and set ANDROID_SDK_ROOT."
}

Write-Host "Building signed Android release APK..."
& $GradleExe -p $AndroidProjectDir ":app:assembleRelease" --no-daemon
if ($LASTEXITCODE -ne 0) {
  throw "Gradle build failed with exit code $LASTEXITCODE."
}

$BuiltApk = Join-Path $AndroidProjectDir "app\\build\\outputs\\apk\\release\\app-release.apk"
if (!(Test-Path -LiteralPath $BuiltApk)) {
  throw "APK not found after build: $BuiltApk"
}

$OutApk = Join-Path $RepoRoot "TotalCalendar.apk"
Copy-Item -Force -LiteralPath $BuiltApk -Destination $OutApk
Write-Host "APK written to: $OutApk"

if ($Parallel) {
  Write-Host "Building parallel compare APK (side-by-side install)..."
  & $GradleExe -p $AndroidProjectDir ":app:assembleRelease" -PtcjsParallelInstall=true --no-daemon
  if ($LASTEXITCODE -ne 0) {
    throw "Parallel Gradle build failed with exit code $LASTEXITCODE."
  }
  $ParallelOut = Join-Path $RepoRoot "TotalCalendar-parallel.apk"
  Copy-Item -Force -LiteralPath $BuiltApk -Destination $ParallelOut
  Write-Host "Parallel APK written to: $ParallelOut"
}

