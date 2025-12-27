# Cloud Image Uploader for Obsidian

[![Release](https://img.shields.io/github/v/release/LaurentOngaro/obsidian-img_upload-plugin?sort=semver)](https://github.com/LaurentOngaro/obsidian-img_upload-plugin/releases) [![Latest release](https://img.shields.io/github/v/release/LaurentOngaro/obsidian-img_upload-plugin?label=latest%20release&sort=semver)](https://github.com/LaurentOngaro/obsidian-img_upload-plugin/releases)

This plugin uploads images to [Cloudinary](https://cloudinary.com/) instead of just storing them locally in your vault.

## Features

- Paste images from clipboard directly to Cloudinary
- Support for different image MIME types (PNG, JPEG, GIF...) from clipboard
- Support for unsigned uploads via `upload_preset` (recommended) or server-signed uploads
- **Optional:** Auto-upload newly added image files in the vault to Cloudinary (disabled by default)
- **Optional:** Make a local copy of newly added image files into a configurable folder in the vault (disabled by default)
- When auto-upload is enabled, the plugin can replace local file references in the active note with the Cloudinary URL after upload

## Installation

Install the plugin via the Community Plugins tab within Obsidian (or place the plugin folder in your vault's `plugins/` directory during development).

### Install from GitHub (manual)

You can install this plugin directly from the GitHub repository:

1. Clone or download the repository:
   - git clone https://github.com/LaurentOngaro/obsidian-img_upload-plugin.git
2. Build the plugin:
   - Install dependencies: `npm install`
   - Windows: run `build.bat` at the repository root
   - Or run: `npm run build`
3. Copy the plugin to your vault:
   - Create (if needed) `<your-vault>/.obsidian/plugins/obsidian-img_upload-plugin`
   - Copy the repository contents (including `main.js`, `manifest.json`) into that folder
4. In Obsidian: Settings → Community Plugins → disable Safe Mode if enabled → enable **Cloud Image Uploader** in the list of installed plugins.

Notes:

- You can also download a release ZIP (if available) instead of cloning. When we tag a release (`v*.*.*`) this repo runs a build workflow that creates a ZIP release asset containing `main.js`, `manifest.json`, `README.md`, `LICENSE` and `package.json`.
- The `build.bat` script is a simple convenience for Windows that runs `npm install` and `npm run build` (you can also use `npm run build:win`).
- For signed uploads prefer a server-side signing endpoint; see the `examples/signing-server` snippet in this repo.
  CI / releases

- A GitHub Action builds and publishes a ZIP release asset when you push a **tag** like `v1.2.3` (see `.github/workflows/release.yml`).
- Additionally, a draft release is automatically created on every push to `main` (see `.github/workflows/draft-release.yml`) — this is a convenience so you can inspect artifacts and promote a draft to a normal release when ready.

## Getting started

1. Create a Cloudinary account at https://cloudinary.com/
2. Go to _Console → Dashboard_ to obtain your **Cloud name** and **API key** (and API secret if you plan to sign uploads server-side).

3. Recommended (no secret exposure): create an **unsigned upload preset** in Cloudinary (under _Settings → Upload_ → _Upload presets_) and use that preset name in the plugin settings.

   To create an unsigned preset:

   - Open Cloudinary Console → Settings → Upload presets.
   - Click **Create preset**.
   - Give the preset a name and **uncheck** the box for "Signed only" so it is unsigned.
   - Use the preset name in the plugin's **Upload preset** setting.

   Note: The plugin includes a **Create preset (auto)** button on the Upload preset setting which can attempt to create an unsigned preset named `obsidian_auto_unsigned` for you — this requires that you have enabled **Allow storing API Secret (dangerous)** and provided both **API Key** and **API Secret**.

> Note on CORS: creating upload presets from a renderer/Browser context may be blocked by CORS (you may see preflight failures in DevTools like "No 'Access-Control-Allow-Origin' header" or "Failed to fetch"). If this happens, the recommended approaches are:
>
> - Create the unsigned upload preset manually in the Cloudinary Console (Settings → Upload presets) and paste the name into the plugin settings (recommended).
> - Or run a small server-side script (example included at `src/server/create-preset-example.js`) and call that server from your local environment; server-side requests are not subject to browser CORS and can create the preset on your behalf.
> 
> See the Troubleshooting & Limitations section below for an example and a short guide.

Configure the following values in plugin settings:

- **Cloud Name** — your Cloudinary cloud name
- **API Key** — public API key (optional for unsigned uploads, but required for some setups)
- **Upload preset** — recommended for unsigned uploads (safer than storing your API secret in the plugin)
- **API Secret** — _Not recommended_ to store in the plugin. Signed uploads must be created by your backend and are not performed from the frontend plugin.

> ⚠️ For security: do NOT store `API Secret` in a local plugin for general use; prefer unsigned upload presets or a small signing endpoint.

## Usage

- Use the command **Paste image to Cloudinary** or the hotkey (Ctrl+Shift+V) to upload an image from your clipboard.
- If the active pane is a Markdown note, the plugin inserts a Markdown image link `![image](URL)` where the cursor is.

- To enable automatic behavior, open plugin settings and:
  - Toggle **Auto upload on file add** to upload new images automatically when they are added to the vault.
  - Toggle **Enable local copy** and set **Local copy folder** (path relative to vault root) to copy new images into a specified folder.
  - Both options are disabled by default for safety; enabling either will cause the plugin to act on newly created image files in the vault.
- When auto-upload is enabled and an active note contains a reference to the local file path, the plugin will attempt to replace that local reference with the uploaded Cloudinary URL in the active editor.

## Troubleshooting & Limitations

- If `navigator.clipboard.read()` is not available in your environment, clipboard paste might fail — Obsidian/Electron environments differ by version.
- Animated GIFs from clipboard may be converted to static images by some OS clipboards. Use drag-and-drop if you need animated gif uploads.
- If you need signed uploads, implement a small server endpoint that generates Cloudinary upload signatures (recommended). The plugin also supports a second option: you may choose to store your `API Secret` locally and use signed uploads directly from the plugin, but this is dangerous and **strongly discouraged** unless you fully accept the risk.

### Example: minimal Express signing server

Below is a tiny example you can run to provide signatures to the plugin (or to any trusted client). **Run it only on a trusted server and over HTTPS.**

- Create file `examples/signing-server/server.js` and set the env var `CLOUDINARY_API_SECRET` before running.

```js
// Minimal example (express)
const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

app.post('/sign', (req, res) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1').update(`timestamp=${timestamp}${process.env.CLOUDINARY_API_SECRET}`).digest('hex');
  res.json({ timestamp, signature });
});

app.listen(3000);
```

How to use it (conceptually):

- Your plugin (or client) requests `/sign` from your trusted server.
- The server replies `{ timestamp, signature }` computed with the server-side secret.
- The client includes `timestamp`, `signature`, and `api_key` (and `file`/`upload_preset` as needed) when POSTing to `https://api.cloudinary.com/v1_1/<cloud>/image/upload`.

Security notes:

- Do **not** expose your `CLOUDINARY_API_SECRET` publicly. Run this service over HTTPS, restrict access, and prefer server-side signing instead of embedding the secret in local settings.
- The above example signs `timestamp` only; if you need to sign additional parameters (folder, public_id, ...) include them in the string to sign following Cloudinary's signing rules.

## Security & validation

The plugin offers two choices for uploads to Cloudinary:

1. **Unsigned uploads (recommended)** — do **not** store `api_secret` in the plugin; configure **Cloud Name** + **Upload preset** and uploads will be unsigned.

2. **Signed uploads (dangerous)** — enable **Allow storing API Secret (dangerous)** in the plugin settings and enter your **API Secret**.
   - The plugin will use the secret to compute request signatures locally and perform signed uploads.
   - **Warning:** storing the secret in your local settings exposes it to anyone with access to your vault or machine.
   - Use this only if you understand and accept the security implications.

Other validations and safety measures:

- The local copy folder must be a relative path; paths containing `..`, absolute paths (starting with `/`) or Windows drive letters (`C:\`) are rejected.
- Automatic uploads respect a maximum file size (configurable in settings, default **10 MB**). Files larger than that are skipped when auto-upload is enabled.
- Automatic behavior (auto-upload / local copy) is **disabled by default**.

## Contributing

Pull requests and issues welcome. If you want signed upload examples, ask and I can add a tiny Node/Express example to the repo.

Pre-commit checks

- This repository installs a Git pre-commit hook (via Husky) that runs the same CI checks as our GitHub Actions: it runs the e2e tests and builds the plugin. Commits will be blocked if tests or build fail.
- To enable hooks locally, run `npm install` (this runs `husky install` via the `prepare` script). You can bypass pre-commit hooks with `git commit --no-verify` (not recommended).

---

If you want, I can also add an example server snippet for signed uploads and automated tests for the clipboard handling.

## Testing (E2E)

Run end-to-end tests (using Vitest + jsdom):

1. Install dev dependencies: `npm install --save-dev vitest`.
2. Run: `npm run test:e2e`.

The tests simulate clipboard contents and mock the Cloudinary upload step.
