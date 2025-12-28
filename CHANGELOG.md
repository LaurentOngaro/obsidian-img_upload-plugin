# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2025-12-28

### Added

- **Duplicate detection for local copies**: When uploading from cache (cache hit), the plugin now scans the configured local copy folder for identical images before creating new files, preventing accidental duplicates in the attachment folder.
- **Automatic deletion of source files**: New optional setting "Delete original after upload" allows automatic cleanup of source images after successful upload and local copy completion. Useful for paste/drag-drop workflows where files land at vault root.
- **Configurable local copy folder**: Duplicate detection now respects the user-configured local copy folder (instead of hard-coded `_Illustrations`) and auto-creates the folder if needed.
- **Cross-platform build system**: Replaced Windows-only PowerShell build with cross-platform Node.js script (`scripts/build.js`) for CI/CD compatibility. Windows users can still use `npm run build:win` for PowerShell-based builds.
- **Comprehensive e2e and unit tests with debug logging**: All tests now enable debug logs by default for better visibility into plugin behavior during CI/CD and troubleshooting.

### Changed

- **Improved crypto fallback**: SHA-1 hashing now falls back gracefully from WebCrypto → Node crypto.createHash, ensuring tests and builds work in all environments (browser, Node, CI runners).
- **Stricter editor validation**: Reference replacement now validates that the editor has a `setValue` function before attempting to modify notes, improving robustness in mock/test environments.
- **Build versioning**: VERSION file and build number now track accurately across builds with incremental numbering.

### Fixed

- **CI test failures**: Resolved "crypto is not defined" and "WebCrypto not available" errors in GitHub Actions by using Node crypto as a fallback.
- **Build script portability**: Fixed `powershell: not found` error in non-Windows CI environments by switching to Node.js build script for default `npm run build`.
- **TypeScript warnings in mocks**: Added default initializers to TFile mock properties to satisfy strict type checking.
- **Duplicate cache entries**: Removed duplicate cache write statements that were causing redundant disk writes.

### Security

- No breaking changes; all security best practices remain:
  - Unsigned uploads via `upload_preset` remain recommended.
  - API secrets can be optionally stored locally with clear warnings (not recommended).
  - Local copy folder paths are validated against `..`, absolute paths, and Windows drive letters.
  - Auto-upload respects file size limits and active note references to prevent accidental uploads.

### Documentation

- Updated README with new features: duplicate detection, source file deletion, and configurable local copy folder.
- Added troubleshooting tips for paste/drag-drop workflows with auto-delete enabled.
- Clarified that auto-upload only processes images referenced in open notes to avoid unrelated file uploads.

### Development

- Migrated build from PowerShell (`build.ps1`) to Node.js (`scripts/build.js`) for cross-platform CI/CD.
- All e2e tests now include debug logging enabled (`debugLogs: true`) for better diagnostics.
- Test suite covers duplicate detection, cache hits, local copy with deduplication, and source file deletion scenarios.
- Pre-commit hooks (Husky) continue to enforce test and build success before commits.

---

## [1.0.3] - Previous release

See git history for earlier changes.
