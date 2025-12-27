# Build Process Documentation

## Overview

The plugin uses a version management system that tracks:

- **Version**: Defined in `manifest.json` (e.g., `1.0.2`)
- **Build Number**: Auto-incrementing counter that increases with each build

## Build System

### Windows (PowerShell)

```bash
npm run build:win
```

This uses `build.ps1` which:

1. Reads the version from `manifest.json`
2. Increments the build number stored in `VERSION` file
3. Generates `build-info.json` with metadata
4. Runs esbuild to bundle the plugin

### Linux/Mac (Standard)

```bash
npm run build
```

This runs esbuild directly without version management.

## Files Generated

After running `build.ps1`:

- **`build-info.json`** - Generated metadata file containing:

  ```json
  {
    "version": "1.0.2",
    "buildNumber": 3,
    "buildTime": "2025-12-27T18:42:12Z"
  }
  ```

- **`VERSION`** - Simple text file containing just the build number (e.g., `3`)

- **`main.js`** - The bundled plugin (as usual)

## Display in Settings

The plugin displays the build version in the bottom of the Settings tab as:

```
build v1.0.2 #3
```

Where:

- `1.0.2` comes from `manifest.json`
- `3` is the auto-incrementing build number

## Git Configuration

Both `VERSION` and `build-info.json` are in `.gitignore` and should NOT be committed, as they change with every build.

## Version Increment Strategy

The build number:

- Starts at 0
- Increments by 1 with each build using `build.ps1`
- Resets to 0 if you manually delete the `VERSION` file
- Is NOT affected by `npm run build` (standard esbuild without version management)

## Example Workflow

```powershell
# Initial state
$ cat VERSION
# 0

# First Windows build
$ npm run build:win
# VERSION → 1
# build-info.json generated with buildNumber: 1

# Second Windows build
$ npm run build:win
# VERSION → 2
# build-info.json generated with buildNumber: 2

# Standard build (does not increment)
$ npm run build
# VERSION unchanged (still 2)
# build-info.json NOT generated
```
