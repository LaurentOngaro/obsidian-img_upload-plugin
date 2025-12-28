# Build script for cloudinary-image-uploader
# Handles version management and incremental build numbering
# Note: Plugin folder is symlinked to vault, so no explicit copy needed

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
$buildTime = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ'
$outputFile = '.\src\generated-build-info.ts'

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

Write-Host 'Building cloudinary-image-uploader'
Write-Host "   Version: v$version"
Write-Host "   Build #: $buildNumber"
Write-Host ''


# Also generate a TypeScript file that's embedded at build time so the plugin
# can read version info in environments where fetch/read is not available
$ts = @"
// Auto-generated at build time. Do not edit by hand.
export const BUILD_INFO = {
  version: '$version',
  buildNumber: $buildNumber,
  buildTime: '$buildTime',
};
"@
$ts | Out-File $outputFile -Encoding UTF8

# Run esbuild
Write-Host 'Running esbuild...'
# Invoke the esbuild CLI directly via Node to avoid any npm script recursion
& node ./node_modules/esbuild/bin/esbuild src/main.ts --bundle --outfile=main.js --platform=browser --format=cjs --external:obsidian

if ($LASTEXITCODE -ne 0) {
  Write-Error 'Build failed'
  exit 1
}

Write-Host ''
Write-Host 'Build complete!'
Write-Host '   Output: main.js'
Write-Host "   Info: $outputFile"
Write-Host ''
Write-Host 'Note: Files automatically synced to vault via symlink'
