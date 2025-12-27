# Build script for obsidian-img_upload-plugin
# Handles version management and incremental build numbering

param(
  [switch]$Clean = $false
)

# Get the manifest version
$manifestPath = '.\manifest.json'
if (-not (Test-Path $manifestPath)) {
  Write-Error 'manifest.json not found'
  exit 1
}

$manifest = Get-Content $manifestPath | ConvertFrom-Json
$version = $manifest.version

# Initialize or read build number from VERSION file
$versionFile = '.\VERSION'
$buildNumber = 1

if (Test-Path $versionFile) {
  $buildNumber = [int](Get-Content $versionFile).Trim() + 1
} else {
  Write-Host 'Creating new VERSION file with build #1'
}

# Save incremented build number
$buildNumber | Out-File $versionFile -NoNewline -Encoding UTF8

Write-Host '📦 Building obsidian-img_upload-plugin'
Write-Host "   Version: v$version"
Write-Host "   Build #: $buildNumber"
Write-Host ''

# Create build-info.json for the plugin to read
$buildInfo = @{
  version     = $version
  buildNumber = $buildNumber
  buildTime   = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ'
} | ConvertTo-Json

$buildInfo | Out-File '.\build-info.json' -Encoding UTF8

# Run esbuild
Write-Host '▶️  Running esbuild...'
& npm run build

if ($LASTEXITCODE -ne 0) {
  Write-Error 'Build failed'
  exit 1
}

Write-Host ''
Write-Host '✅ Build complete!'
Write-Host '   Output: main.js'
Write-Host '   Info: build-info.json'
