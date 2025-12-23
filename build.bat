@echo off
REM Build script for obsidian-img_upload-plugin (Windows)
echo Building obsidian-img_upload-plugin...
npm install
if %ERRORLEVEL% NEQ 0 (
  echo npm install failed with exit code %ERRORLEVEL%.
  exit /b %ERRORLEVEL%
)
npm run build
if %ERRORLEVEL% NEQ 0 (
  echo Build failed with exit code %ERRORLEVEL%.
  exit /b %ERRORLEVEL%
)
echo Build completed successfully.
exit /b 0
